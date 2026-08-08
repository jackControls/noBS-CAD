param(
  [Parameter(Mandatory = $true)]
  [string]$PackageDirectory,
  [Parameter(Mandatory = $true)]
  [string]$DiagnosticsDirectory
)

$ErrorActionPreference = "Stop"
New-Item -ItemType Directory -Path $DiagnosticsDirectory -Force | Out-Null

$probePath = Join-Path $DiagnosticsDirectory "native-viewport-probe.json"
$windowPath = Join-Path $DiagnosticsDirectory "native-window.json"
$screenshotPath = Join-Path $DiagnosticsDirectory "windows-viewport.png"
$stderrPath = Join-Path $DiagnosticsDirectory "application-stderr.txt"
$executable = Join-Path $PackageDirectory "noBS-CAD.exe"
if (-not (Test-Path $executable -PathType Leaf)) {
  throw "Packaged executable was not found: $executable"
}

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

public static class NbcadNativeWindow {
  [StructLayout(LayoutKind.Sequential)]
  public struct RECT {
    public int Left;
    public int Top;
    public int Right;
    public int Bottom;
  }

  [DllImport("user32.dll", CharSet = CharSet.Unicode)]
  public static extern IntPtr FindWindowEx(
    IntPtr parent,
    IntPtr childAfter,
    string className,
    string windowTitle
  );

  [DllImport("user32.dll")]
  [return: MarshalAs(UnmanagedType.Bool)]
  public static extern bool IsWindowVisible(IntPtr window);

  [DllImport("user32.dll")]
  [return: MarshalAs(UnmanagedType.Bool)]
  public static extern bool GetClientRect(IntPtr window, out RECT rect);

  [DllImport("user32.dll")]
  [return: MarshalAs(UnmanagedType.Bool)]
  public static extern bool GetWindowRect(IntPtr window, out RECT rect);

  [DllImport("user32.dll")]
  [return: MarshalAs(UnmanagedType.Bool)]
  public static extern bool ShowWindow(IntPtr window, int command);

  [DllImport("user32.dll")]
  [return: MarshalAs(UnmanagedType.Bool)]
  public static extern bool SetForegroundWindow(IntPtr window);
}
"@

$env:NBCAD_VIEWPORT_PROBE_FILE = $probePath
$process = Start-Process `
  -FilePath $executable `
  -WorkingDirectory $PackageDirectory `
  -RedirectStandardError $stderrPath `
  -PassThru

try {
  $deadline = (Get-Date).AddSeconds(60)
  do {
    Start-Sleep -Milliseconds 500
    $process.Refresh()
    if ($process.HasExited) {
      throw "Portable application exited during viewport startup (code $($process.ExitCode))"
    }
  } while (-not (Test-Path $probePath -PathType Leaf) -and (Get-Date) -lt $deadline)

  if (-not (Test-Path $probePath -PathType Leaf)) {
    throw "Native viewport did not report ready or failed within 60 seconds"
  }

  $probe = Get-Content $probePath -Raw | ConvertFrom-Json
  Write-Host (Get-Content $probePath -Raw)
  if ($probe.status -ne "ready") {
    throw "Native viewport startup failed: $($probe.error)"
  }
  if ($probe.physicalWidth -lt 100 -or $probe.physicalHeight -lt 100) {
    throw "Native viewport reported an invalid surface size: $($probe.physicalWidth)x$($probe.physicalHeight)"
  }

  $mainWindow = [IntPtr]::Zero
  do {
    $process.Refresh()
    $mainWindow = $process.MainWindowHandle
    if ($mainWindow -eq [IntPtr]::Zero) {
      Start-Sleep -Milliseconds 250
    }
  } while ($mainWindow -eq [IntPtr]::Zero -and (Get-Date) -lt $deadline)
  if ($mainWindow -eq [IntPtr]::Zero) {
    throw "Application did not expose a top-level window"
  }

  [NbcadNativeWindow]::ShowWindow($mainWindow, 9) | Out-Null
  [NbcadNativeWindow]::SetForegroundWindow($mainWindow) | Out-Null
  Start-Sleep -Seconds 2

  $nativeWindow = [NbcadNativeWindow]::FindWindowEx(
    $mainWindow,
    [IntPtr]::Zero,
    "noBS.CAD.BevyViewport",
    $null
  )
  if ($nativeWindow -eq [IntPtr]::Zero) {
    throw "The Bevy viewport child HWND was not attached to the Tauri window"
  }

  $clientRect = New-Object NbcadNativeWindow+RECT
  if (-not [NbcadNativeWindow]::GetClientRect($nativeWindow, [ref]$clientRect)) {
    throw "Could not read the Bevy viewport client rectangle"
  }
  $nativeWidth = $clientRect.Right - $clientRect.Left
  $nativeHeight = $clientRect.Bottom - $clientRect.Top
  $nativeVisible = [NbcadNativeWindow]::IsWindowVisible($nativeWindow)
  [ordered]@{
    mainWindow = $mainWindow.ToInt64()
    nativeWindow = $nativeWindow.ToInt64()
    visible = $nativeVisible
    clientWidth = $nativeWidth
    clientHeight = $nativeHeight
  } | ConvertTo-Json | Set-Content -Path $windowPath -Encoding UTF8
  Write-Host (Get-Content $windowPath -Raw)

  if (-not $nativeVisible) {
    throw "The Bevy viewport HWND exists but is hidden"
  }
  if ($nativeWidth -lt 100 -or $nativeHeight -lt 100) {
    throw "The Bevy viewport HWND has an invalid client size: ${nativeWidth}x${nativeHeight}"
  }

  try {
    Add-Type -AssemblyName System.Drawing
    $windowRect = New-Object NbcadNativeWindow+RECT
    if ([NbcadNativeWindow]::GetWindowRect($mainWindow, [ref]$windowRect)) {
      $width = $windowRect.Right - $windowRect.Left
      $height = $windowRect.Bottom - $windowRect.Top
      $bitmap = New-Object System.Drawing.Bitmap($width, $height)
      $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
      try {
        $graphics.CopyFromScreen(
          $windowRect.Left,
          $windowRect.Top,
          0,
          0,
          (New-Object System.Drawing.Size($width, $height))
        )
        $bitmap.Save($screenshotPath, [System.Drawing.Imaging.ImageFormat]::Png)
      } finally {
        $graphics.Dispose()
        $bitmap.Dispose()
      }
    }
  } catch {
    Write-Warning "Could not capture Windows viewport screenshot: $_"
  }
} finally {
  if (-not $process.HasExited) {
    Stop-Process -Id $process.Id -Force
  }
  Remove-Item Env:NBCAD_VIEWPORT_PROBE_FILE -ErrorAction SilentlyContinue
}
