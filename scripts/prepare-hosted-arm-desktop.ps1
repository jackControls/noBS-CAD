param(
    [Parameter(Mandatory = $true)][string]$EvidencePath,
    [long]$Window = 0,
    [switch]$IdentifyOnly
)
$ErrorActionPreference = 'Stop'

# The hosted ARM image can leave its Microsoft-account setup window in front of
# applications. This is runner preparation, never part of the product or generic
# input driver. Refuse before loading or invoking desktop APIs on any other host.
if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted' -or
    $env:RUNNER_OS -ne 'Windows' -or $env:RUNNER_ARCH -ne 'ARM64' -or
    $env:GITHUB_REPOSITORY -ne 'jackControls/Limo-CAD' -or $env:GITHUB_RUN_ID -notmatch '^\d+$') {
    throw 'Account-window preparation requires the disposable GitHub-hosted ARM64 package runner'
}
$runnerRoot = [IO.Path]::GetFullPath($env:RUNNER_TEMP).TrimEnd('\', '/') + [IO.Path]::DirectorySeparatorChar
$evidenceFile = [IO.Path]::GetFullPath($EvidencePath)
if (-not $evidenceFile.StartsWith($runnerRoot, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Runner evidence must stay inside RUNNER_TEMP'
}

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class HostedArmAccountWindow {
    public delegate bool EnumProc(IntPtr window, IntPtr unused);
    [DllImport("user32.dll", SetLastError = true)] public static extern bool EnumWindows(EnumProc callback, IntPtr unused);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr window, out uint pid);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr window, StringBuilder text, int count);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr window, StringBuilder text, int count);
    [DllImport("user32.dll", SetLastError = true)] public static extern IntPtr SendMessageTimeout(IntPtr window, uint message, UIntPtr wParam, IntPtr lParam, uint flags, uint timeout, out UIntPtr result);
}
'@

function Get-CoveringWindowIdentity([IntPtr]$window) {
    # Evidence only. Never sends a message and never decides whether to close.
    $title = [Text.StringBuilder]::new(512)
    $class = [Text.StringBuilder]::new(512)
    [void][HostedArmAccountWindow]::GetWindowText($window, $title, 512)
    [void][HostedArmAccountWindow]::GetClassName($window, $class, 512)
    [uint32]$owner = 0
    [void][HostedArmAccountWindow]::GetWindowThreadProcessId($window, [ref]$owner)
    $processName = $null
    $executable = $null
    $executableError = $null
    try {
        $process = Get-Process -Id $owner -ErrorAction Stop
        $processName = $process.ProcessName
        try { $executable = $process.Path } catch { $executableError = $_.Exception.Message }
    } catch {
        $executableError = $_.Exception.Message
    }
    $identity = [ordered]@{
        hwnd = $window.ToInt64()
        process_id = $owner
        process_name = $processName
        title = $title.ToString()
        class = $class.ToString()
        executable = $executable
    }
    if ($null -ne $executableError) { $identity.executable_error = $executableError }
    [pscustomobject]$identity
}

function Get-AccountWindow([IntPtr]$window) {
    if (-not [HostedArmAccountWindow]::IsWindowVisible($window)) { return $null }
    $title = [Text.StringBuilder]::new(512)
    $class = [Text.StringBuilder]::new(512)
    [void][HostedArmAccountWindow]::GetWindowText($window, $title, 512)
    [void][HostedArmAccountWindow]::GetClassName($window, $class, 512)
    if ($title.ToString() -cne 'Microsoft account' -or $class.ToString() -cne 'Windows.UI.Core.CoreWindow') { return $null }
    [uint32]$owner = 0
    [void][HostedArmAccountWindow]::GetWindowThreadProcessId($window, [ref]$owner)
    $process = Get-Process -Id $owner -ErrorAction Stop
    [pscustomobject][ordered]@{
        hwnd = $window.ToInt64()
        process_id = $owner
        process_name = $process.ProcessName
        executable = $process.Path
        title = $title.ToString()
        class = $class.ToString()
    }
}

$report = [ordered]@{
    run_id = $env:GITHUB_RUN_ID
    runner_arch = $env:RUNNER_ARCH
    status = 'inspecting'
    started_utc = [DateTime]::UtcNow.ToString('o')
    method = 'WM_CLOSE to exactly matched system WWAHost account window; no input, account action or process termination'
    windows = @()
    foreground = $null
}
try {
    if ($IdentifyOnly) {
        # The title-bar click is already refused. Stamp the covering hwnd onto
        # the evidence file and return without enumerating or closing.
        $identity = Get-CoveringWindowIdentity ([IntPtr]::new($Window))
        $report.occluder = $identity
        $report.status = 'not_present'
        if (Test-Path -LiteralPath $evidenceFile) {
            try {
                $loaded = Get-Content -LiteralPath $evidenceFile -Raw | ConvertFrom-Json
                $loaded | Add-Member -NotePropertyName occluder -NotePropertyValue $identity -Force
                $report = $loaded
            } catch {
                # The fresh report already holds the covering window.
            }
        }
    } else {
    $accountWindows = [Collections.Generic.List[object]]::new()
    $inspectionErrors = [Collections.Generic.List[string]]::new()
    # EnumWindows covers desktop-app top-level windows on Windows 8+, which
    # can omit this immersive CoreWindow. Inspect the actual foreground too.
    # https://learn.microsoft.com/windows/win32/api/winuser/nf-winuser-enumwindows
    $foreground = [HostedArmAccountWindow]::GetForegroundWindow()
    $report.foreground = $foreground.ToInt64()
    if ($Window -ne 0) {
        # Always keep the covering hwnd, including when it is not WWAHost.
        # Get-AccountWindow below is the only close matcher.
        $report.occluder = Get-CoveringWindowIdentity ([IntPtr]::new($Window))
        # The input helper names the hwnd that actually covers the title bar.
        # EnumWindows can miss that immersive window, and it may not be the
        # foreground window until after the owned window is raised.
        $named = Get-AccountWindow ([IntPtr]::new($Window))
        if ($null -ne $named) {
            $named | Add-Member -NotePropertyName observed_via -NotePropertyValue 'occluder'
            $accountWindows.Add($named)
        }
        $enumerated = $true
    } else {
    $foregroundCandidate = Get-AccountWindow $foreground
    if ($null -ne $foregroundCandidate) {
        $foregroundCandidate | Add-Member -NotePropertyName observed_via -NotePropertyValue 'foreground'
        $accountWindows.Add($foregroundCandidate)
    }
    $enumerated = [HostedArmAccountWindow]::EnumWindows({ param($window, $unused)
        try {
            $candidate = Get-AccountWindow $window
            if ($null -ne $candidate -and ($null -eq $foregroundCandidate -or $window -ne $foreground)) {
                $candidate | Add-Member -NotePropertyName observed_via -NotePropertyValue 'enumeration'
                $accountWindows.Add($candidate)
            }
            return $true
        } catch {
            $inspectionErrors.Add($_.Exception.Message)
            return $false
        }
    }, [IntPtr]::Zero)
    }
    $report.windows = @($accountWindows.ToArray())
    if ($inspectionErrors.Count -gt 0) { throw "Cannot establish account-window identity: $inspectionErrors" }
    if (-not $enumerated) { throw "Cannot enumerate hosted runner windows (Win32 error $([Runtime.InteropServices.Marshal]::GetLastWin32Error()))" }
    if ($accountWindows.Count -gt 1) { throw 'Refusing ambiguous Microsoft-account windows on the hosted runner' }
    if ($accountWindows.Count -eq 0) {
        $report.status = 'not_present'
    } else {
        $candidate = $accountWindows[0]
        $expectedExecutable = Join-Path $env:WINDIR 'System32\WWAHost.exe'
        if ($candidate.process_name -ne 'WWAHost' -or
            -not [string]::Equals($candidate.executable, $expectedExecutable, [StringComparison]::OrdinalIgnoreCase)) {
            throw 'Refusing an account window whose process is not the system WWAHost executable'
        }
        $window = [IntPtr]::new($candidate.hwnd)
        $current = Get-AccountWindow $window
        if ($null -eq $current -or $current.process_id -ne $candidate.process_id -or
            -not [string]::Equals($current.executable, $expectedExecutable, [StringComparison]::OrdinalIgnoreCase)) {
            throw 'Account-window identity changed before runner preparation; nothing was sent'
        }
        [UIntPtr]$messageResult = [UIntPtr]::Zero
        $sent = [HostedArmAccountWindow]::SendMessageTimeout($window, 0x0010, [UIntPtr]::Zero, [IntPtr]::Zero, 3, 1500, [ref]$messageResult)
        if ($sent -eq [IntPtr]::Zero) {
            $messageError = [Runtime.InteropServices.Marshal]::GetLastWin32Error()
            throw "Account-window WM_CLOSE was not acknowledged (Win32 error $messageError)"
        }
        $deadline = [DateTime]::UtcNow.AddSeconds(5)
        while ([HostedArmAccountWindow]::IsWindowVisible($window)) {
            [uint32]$owner = 0
            [void][HostedArmAccountWindow]::GetWindowThreadProcessId($window, [ref]$owner)
            if ($owner -ne $candidate.process_id) { break }
            if ([DateTime]::UtcNow -ge $deadline) { throw 'The hosted runner account window remained visible after WM_CLOSE' }
            Start-Sleep -Milliseconds 50
        }
        $report.status = 'closed'
    }
    }
} catch {
    $report.status = 'failed'
    $report.error = $_.Exception.Message
    throw
} finally {
    $report.finished_utc = [DateTime]::UtcNow.ToString('o')
    [void][IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($evidenceFile))
    [IO.File]::WriteAllText($evidenceFile, ($report | ConvertTo-Json -Depth 5), [Text.UTF8Encoding]::new($false))
}
