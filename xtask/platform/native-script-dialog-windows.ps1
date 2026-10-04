param([int]$OwnedPid)
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
$title = $env:NBCAD_SCRIPT_DIALOG_TITLE
if ([string]::IsNullOrWhiteSpace($title)) { throw 'NBCAD_SCRIPT_DIALOG_TITLE is required' }
$path = [Console]::In.ReadToEnd()
if ([string]::IsNullOrWhiteSpace($path)) { throw 'Script dialog requires a path on stdin' }
if ($OwnedPid -le 0) { throw 'An owned native child PID is required' }
Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class OwnedScriptDialog {
    public delegate bool EnumProc(IntPtr window, IntPtr param);
    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc callback, IntPtr param);
    [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr parent, EnumProc callback, IntPtr param);
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr window, out uint pid);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll")] public static extern bool IsWindowEnabled(IntPtr window);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr window, StringBuilder text, int count);
    [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr window, StringBuilder text, int count);
    [DllImport("user32.dll", CharSet=CharSet.Unicode, EntryPoint="SendMessageTimeoutW")]
    public static extern IntPtr SetText(IntPtr window, uint message, UIntPtr wParam, string text, uint flags, uint timeout, out UIntPtr result);
    [DllImport("user32.dll", SetLastError=true)]
    public static extern IntPtr SendMessageTimeout(IntPtr window, uint message, UIntPtr wParam, IntPtr lParam, uint flags, uint timeout, out UIntPtr result);
    public static string Title(IntPtr window) { var s = new StringBuilder(1024); GetWindowText(window, s, 1024); return s.ToString(); }
    public static string Class(IntPtr window) { var s = new StringBuilder(256); GetClassName(window, s, 256); return s.ToString(); }
    public static uint Pid(IntPtr window) { uint pid; GetWindowThreadProcessId(window, out pid); return pid; }
}
'@
$deadline = [DateTime]::UtcNow.AddSeconds(12)
$dialogs = [Collections.Generic.List[IntPtr]]::new()
do {
    if (-not (Get-Process -Id $OwnedPid -ErrorAction SilentlyContinue)) { throw 'Owned script host exited' }
    $dialogs.Clear()
    [void][OwnedScriptDialog]::EnumWindows({ param($window, $unused)
        if ([OwnedScriptDialog]::Pid($window) -eq $OwnedPid -and
            [OwnedScriptDialog]::IsWindowVisible($window) -and
            [OwnedScriptDialog]::Title($window) -eq $title) { $dialogs.Add($window) }
        return $true
    }, [IntPtr]::Zero)
    if ($dialogs.Count -gt 1) { throw 'Multiple owned script dialogs; no input was sent' }
    if ($dialogs.Count -eq 1) { break }
    Start-Sleep -Milliseconds 100
} while ([DateTime]::UtcNow -lt $deadline)
if ($dialogs.Count -ne 1) { throw "No visible owned script dialog titled '$title'; no input was sent" }
$dialog = $dialogs[0]
$edits = [Collections.Generic.List[IntPtr]]::new()
$buttons = [Collections.Generic.List[IntPtr]]::new()
[void][OwnedScriptDialog]::EnumChildWindows($dialog, { param($window, $unused)
    $class = [OwnedScriptDialog]::Class($window)
    if ($class -eq 'Edit' -and [OwnedScriptDialog]::IsWindowVisible($window)) { $edits.Add($window) }
    if ($class -eq 'Button' -and [OwnedScriptDialog]::IsWindowEnabled($window) -and [OwnedScriptDialog]::IsWindowVisible($window)) {
        $label = [OwnedScriptDialog]::Title($window).Replace('&','')
        if ($label -eq 'Open' -or $label -eq 'Save') { $buttons.Add($window) }
    }
    return $true
}, [IntPtr]::Zero)
if ($edits.Count -lt 1) { throw 'Owned script dialog has no visible Edit; no input was sent' }
if ($buttons.Count -ne 1) { throw 'Owned script dialog has no single enabled Open or Save button; no input was sent' }
$edit = $edits[$edits.Count - 1]
[UIntPtr]$setResult = [UIntPtr]::Zero
if ([OwnedScriptDialog]::SetText($edit, 0x000C, [UIntPtr]::Zero, $path, 2, 3000, [ref]$setResult) -eq [IntPtr]::Zero) {
    throw "Could not set the script dialog path: $([Runtime.InteropServices.Marshal]::GetLastWin32Error())"
}
if ([OwnedScriptDialog]::Title($edit) -ne $path) { throw 'Script dialog path did not stick; no button was clicked' }
[UIntPtr]$clickResult = [UIntPtr]::Zero
if ([OwnedScriptDialog]::SendMessageTimeout($buttons[0], 0x00F5, [UIntPtr]::Zero, [IntPtr]::Zero, 2, 3000, [ref]$clickResult) -eq [IntPtr]::Zero) {
    throw "Owned script dialog button click failed: $([Runtime.InteropServices.Marshal]::GetLastWin32Error())"
}
