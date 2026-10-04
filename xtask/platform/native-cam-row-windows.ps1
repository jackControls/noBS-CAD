# Dot-sourced only after native-input-windows.ps1 has resolved/focused one
# owned Winit window and loaded its SendInput declarations.
param([int]$CamOwnedPid, [IntPtr]$CamWindow)
$camRequest = [Console]::In.ReadToEnd() | ConvertFrom-Json
$camClientRect = [NativePlatformInput+RECT]::new()
if (-not [NativePlatformInput]::GetClientRect($CamWindow, [ref]$camClientRect)) { throw 'Cannot locate owned CAM client' }
function Assert-CamFinite($value) {
    if ($null -eq $value -or $value -is [bool] -or -not ($value -is [ValueType]) -or [double]::IsNaN([double]$value) -or [double]::IsInfinity([double]$value)) { throw 'CAM gesture coordinates must be finite numbers' }
}
foreach ($value in @($camRequest.client.x,$camRequest.client.y,$camRequest.client.width,$camRequest.client.height)) { Assert-CamFinite $value }
if ($camRequest.client.width -le 0 -or $camRequest.client.height -le 0) { throw 'CAM client dimensions must be positive' }
$camScaleX = $camClientRect.right / [double]$camRequest.client.width
$camScaleY = $camClientRect.bottom / [double]$camRequest.client.height
if ($camScaleX -lt .5 -or $camScaleX -gt 4 -or $camScaleY -lt .5 -or $camScaleY -gt 4 -or [Math]::Abs($camScaleX-$camScaleY) -gt .01) { throw 'Owned CAM client scale differs from published bounds' }
if ($camRequest.cancel -isnot [bool]) { throw 'CAM cancel must be a boolean' }
$camWaypoints = @($camRequest.points)
if ($camWaypoints.Count -lt 1 -or $camWaypoints.Count -gt 8) { throw 'CAM drag requires 1..8 bounded waypoints' }
$camTotalHold = 0
foreach ($waypoint in $camWaypoints) {
    Assert-CamFinite $waypoint.hold_ms
    if ($waypoint.hold_ms -lt 0 -or $waypoint.hold_ms -gt 800 -or [Math]::Floor($waypoint.hold_ms) -ne $waypoint.hold_ms) { throw 'CAM waypoint hold must be 0..800 integral milliseconds' }
    $camTotalHold += $waypoint.hold_ms
}
if ($camTotalHold -gt 1600) { throw 'CAM total dwell exceeds 1600 milliseconds' }
function Resolve-CamPoint($x, $y) {
    Assert-CamFinite $x
    Assert-CamFinite $y
    $localX = [double]$x - $camRequest.client.x
    $localY = [double]$y - $camRequest.client.y
    if ($localX -lt 0 -or $localY -lt 0 -or $localX -ge $camRequest.client.width -or $localY -ge $camRequest.client.height) { throw 'CAM gesture point lies outside the owned client' }
    $point = [NativePlatformInput+POINT]::new()
    $point.x = [int][Math]::Round($localX * $camScaleX)
    $point.y = [int][Math]::Round($localY * $camScaleY)
    if ($point.x -lt 0 -or $point.y -lt 0 -or $point.x -ge $camClientRect.right -or $point.y -ge $camClientRect.bottom) { throw 'Rounded CAM gesture point lies outside the owned client' }
    $logical = @(($camRequest.client.x + $point.x / $camScaleX), ($camRequest.client.y + $point.y / $camScaleY))
    if (-not [NativePlatformInput]::ClientToScreen($CamWindow, [ref]$point)) { throw 'Cannot map owned CAM client coordinate' }
    return [pscustomobject]@{ point=$point; logical=$logical; requested=@([double]$x,[double]$y) }
}
function Read-CamCursor {
    $point = [NativePlatformInput+POINT]::new()
    $ok = [NativePlatformInput]::GetCursorPos([ref]$point)
    $errorCode = if (-not $ok) { [Runtime.InteropServices.Marshal]::GetLastWin32Error() } else { $null }
    return [pscustomobject]@{ point=$point; ok=$ok; error=$errorCode }
}
function Stop-CamPointer($reason, $stage, $resolved, $cursor=$null, $setOk=$null, $setError=$null, $clientError=$null) {
    if ($null -eq $cursor) { $cursor = Read-CamCursor }
    $foreground = [NativePlatformInput]::GetForegroundWindow()
    [uint32]$foregroundOwner = 0
    [void][NativePlatformInput]::GetWindowThreadProcessId($foreground, [ref]$foregroundOwner)
    $clip = [NativePlatformInput+RECT]::new()
    $clipOk = [NativePlatformInput]::GetClipCursor([ref]$clip)
    $clipError = if (-not $clipOk) { [Runtime.InteropServices.Marshal]::GetLastWin32Error() } else { $null }
    $origin = [NativePlatformInput+POINT]::new()
    $originOk = [NativePlatformInput]::ClientToScreen($CamWindow, [ref]$origin)
    $originError = if (-not $originOk) { [Runtime.InteropServices.Marshal]::GetLastWin32Error() } else { $null }
    $currentRect = [NativePlatformInput+RECT]::new()
    $rectOk = [NativePlatformInput]::GetClientRect($CamWindow, [ref]$currentRect)
    $rectError = if (-not $rectOk) { [Runtime.InteropServices.Marshal]::GetLastWin32Error() } else { $null }
    $actualPhysical = $null
    $actualLogical = $null
    $actualWindow = $null
    [uint32]$actualOwner = 0
    if ($cursor.ok) {
        $actualPhysical = @($cursor.point.x,$cursor.point.y)
        $actualWindow = [NativePlatformInput]::WindowFromPoint($cursor.point)
        [void][NativePlatformInput]::GetWindowThreadProcessId($actualWindow, [ref]$actualOwner)
        if ($originOk) {
            $actualLogical = @(($camRequest.client.x + ($cursor.point.x-$origin.x)/$camScaleX), ($camRequest.client.y + ($cursor.point.y-$origin.y)/$camScaleY))
        }
    }
    $diagnostic = [ordered]@{
        reason=$reason;stage=$stage;pid=$CamOwnedPid;window=$CamWindow.ToInt64();
        requested_logical=$resolved.requested;rounded_logical=$resolved.logical;requested_physical=@($resolved.point.x,$resolved.point.y);
        actual_physical=$actualPhysical;actual_logical=$actualLogical;
        set_cursor_ok=$setOk;set_cursor_error=$setError;get_cursor_ok=$cursor.ok;get_cursor_error=$cursor.error;
        foreground_window=$foreground.ToInt64();foreground_pid=$foregroundOwner;
        actual_window=$(if ($null -ne $actualWindow) { $actualWindow.ToInt64() } else { $null });actual_pid=$actualOwner;
        clip_rect=$(if ($clipOk) { @($clip.left,$clip.top,$clip.right,$clip.bottom) } else { $null });clip_ok=$clipOk;clip_error=$clipError;
        client=$camRequest.client;scale=@($camScaleX,$camScaleY);window_dpi=[NativePlatformInput]::GetDpiForWindow($CamWindow);
        client_origin=$(if ($originOk) { @($origin.x,$origin.y) } else { $null });client_origin_error=$originError;
        client_rect=$(if ($rectOk) { @($currentRect.left,$currentRect.top,$currentRect.right,$currentRect.bottom) } else { $null });client_rect_error=$rectError;
        original_client_error=$clientError;dpi_context_previous=$nativeDpiContextPrevious.ToInt64();dpi_context_error=$nativeDpiContextError
    }
    [Console]::Error.WriteLine('NBCAD_CAM_POINTER_DIAGNOSTIC ' + ($diagnostic | ConvertTo-Json -Depth 8 -Compress))
    throw "$reason (stage=$stage, wanted=$($resolved.point.x),$($resolved.point.y), actual=$($actualPhysical -join ','))"
}
function Assert-CamRecipient($resolved, $stage) {
    $point = $resolved.point
    $currentRect = [NativePlatformInput+RECT]::new()
    $rectOk = [NativePlatformInput]::GetClientRect($CamWindow, [ref]$currentRect)
    $rectError = if (-not $rectOk) { [Runtime.InteropServices.Marshal]::GetLastWin32Error() } else { $null }
    if (-not $rectOk -or $currentRect.right -ne $camClientRect.right -or $currentRect.bottom -ne $camClientRect.bottom) { Stop-CamPointer 'Owned CAM client changed size during gesture' $stage $resolved -clientError $rectError }
    [uint32]$owner = 0
    $recipient = [NativePlatformInput]::WindowFromPoint($point)
    [void][NativePlatformInput]::GetWindowThreadProcessId($recipient, [ref]$owner)
    if ($owner -ne $CamOwnedPid -or $recipient -ne $CamWindow -or [NativePlatformInput]::GetForegroundWindow() -ne $CamWindow) { Stop-CamPointer 'Owned CAM target is occluded or lost focus; no further input sent' $stage $resolved }
}
function Assert-CamCurrentPointer($x, $y, $stage) {
    $resolved = Resolve-CamPoint $x $y
    $cursor = Read-CamCursor
    if (-not $cursor.ok -or $cursor.point.x -ne $resolved.point.x -or $cursor.point.y -ne $resolved.point.y) { Stop-CamPointer 'Owned CAM pointer moved before input; no further input sent' $stage $resolved $cursor }
    Assert-CamRecipient $resolved $stage
}
function Move-CamPoint($x, $y, $stage) {
    $resolved = Resolve-CamPoint $x $y
    Assert-CamRecipient $resolved $stage
    $setOk = [NativePlatformInput]::SetCursorPos($resolved.point.x, $resolved.point.y)
    $setError = if (-not $setOk) { [Runtime.InteropServices.Marshal]::GetLastWin32Error() } else { $null }
    if (-not $setOk) { Stop-CamPointer 'Cannot move owned CAM pointer' $stage $resolved -setOk $setOk -setError $setError }
    $cursor = Read-CamCursor
    if (-not $cursor.ok -or $cursor.point.x -ne $resolved.point.x -or $cursor.point.y -ne $resolved.point.y) { Stop-CamPointer 'Owned CAM pointer did not reach its physical target' $stage $resolved $cursor $setOk $setError }
    Start-Sleep -Milliseconds 35
}
# Validate all coordinates and recipients before pressing the button. Guard
# them again during each step/dwell in case another window takes ownership.
$camStart = Resolve-CamPoint $camRequest.x $camRequest.y
Assert-CamRecipient $camStart 'preflight-start'
foreach ($waypoint in $camWaypoints) { $resolved = Resolve-CamPoint $waypoint.x $waypoint.y; Assert-CamRecipient $resolved 'preflight-waypoint' }
Move-CamPoint $camRequest.x $camRequest.y 'move-start'
Assert-CamCurrentPointer $camRequest.x $camRequest.y 'before-mouse-down'
[NativePlatformInput]::Mouse(2)
try {
    $fromX = [double]$camRequest.x
    $fromY = [double]$camRequest.y
    $waypointIndex = 0
    foreach ($waypoint in $camWaypoints) {
        $waypointIndex++
        for ($step=1; $step -le 6; $step++) {
            Move-CamPoint ($fromX + ($waypoint.x-$fromX)*$step/6) ($fromY + ($waypoint.y-$fromY)*$step/6) "waypoint-$waypointIndex-step-$step"
        }
        $deadline = [DateTime]::UtcNow.AddMilliseconds($waypoint.hold_ms)
        do {
            $resolved = Resolve-CamPoint $waypoint.x $waypoint.y
            Assert-CamRecipient $resolved "waypoint-$waypointIndex-dwell"
            if ([DateTime]::UtcNow -lt $deadline) { Start-Sleep -Milliseconds 20 }
        } while ([DateTime]::UtcNow -lt $deadline)
        $fromX = $waypoint.x
        $fromY = $waypoint.y
    }
    if ($camRequest.cancel) {
        Assert-CamCurrentPointer $fromX $fromY 'before-escape'
        [NativePlatformInput]::Key(0x1B, $false)
        [NativePlatformInput]::Key(0x1B, $true)
        Start-Sleep -Milliseconds 100
    }
    Assert-CamCurrentPointer $fromX $fromY 'before-mouse-up'
} finally { [NativePlatformInput]::Mouse(4) }
Start-Sleep -Milliseconds 150
$camEnd = Resolve-CamPoint $fromX $fromY
[pscustomobject]@{source='Windows SendInput';pid=$CamOwnedPid;window=$CamWindow.ToInt64();operation='cam-row-drag';cancel=$camRequest.cancel;
    client=$camRequest.client;scale=@($camScaleX,$camScaleY);points=$camWaypoints;logical_start=$camStart.logical;logical_end=$camEnd.logical;
    physical_start=@($camStart.point.x,$camStart.point.y);physical_end=@($camEnd.point.x,$camEnd.point.y)} | ConvertTo-Json -Depth 8 -Compress
