param(
    [string]$BambuStudio = 'C:/Program Files/Bambu Studio/bambu-studio.exe',
    [string]$OrcaSlicer = 'C:/Program Files/OrcaSlicer/orca-slicer.exe'
)
$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path -Parent $PSScriptRoot
Push-Location $taskRoot
try {
    $taskResults = Join-Path $taskRoot 'target/slicer-acceptance'
    New-Item -ItemType Directory -Force -Path $taskResults | Out-Null
    $env:NBCAD_3MF_FIXTURE = Join-Path $taskRoot 'target/multipart-acceptance.3mf'
    & cargo test --locked -p nbcad-export portable_scene_preserves_nested_parts --lib
    if ($LASTEXITCODE -ne 0) { throw 'Fixture generation failed' }
    foreach ($taskSlicer in @(@{name='bambu'; exe=$BambuStudio}, @{name='orca'; exe=$OrcaSlicer})) {
        if (!(Test-Path -LiteralPath $taskSlicer.exe)) { throw "Missing slicer: $($taskSlicer.exe)" }
        $taskOutput = Join-Path $taskResults "$($taskSlicer.name)-roundtrip.3mf"
        # Remove only the previous result so a failed CLI cannot pass on old bytes.
        if (Test-Path -LiteralPath $taskOutput) { Remove-Item -LiteralPath $taskOutput }
        $taskProcess = Start-Process -FilePath $taskSlicer.exe -ArgumentList @(
            '--debug', '3', '--arrange', '0', '--export-3mf', "`"$taskOutput`"", "`"$env:NBCAD_3MF_FIXTURE`""
        ) -WorkingDirectory $taskResults -WindowStyle Hidden -PassThru
        if (!$taskProcess.WaitForExit(60000)) { $taskProcess.Kill(); throw "$($taskSlicer.name) timed out" }
        if ($taskProcess.ExitCode -ne 0 -or !(Test-Path -LiteralPath $taskOutput)) { throw "$($taskSlicer.name) import/export failed" }
        $taskLog = Join-Path $taskResults '00000.log'
        if (Test-Path -LiteralPath $taskLog) { Copy-Item -LiteralPath $taskLog -Destination (Join-Path $taskResults "$($taskSlicer.name).log") -Force }
    }
    $env:NBCAD_SLICER_RESULTS = $taskResults
    & cargo test --locked -p nbcad-export installed_slicer_roundtrips -- --ignored
    if ($LASTEXITCODE -ne 0) { throw 'Slicer roundtrip validation failed' }
} finally {
    Remove-Item Env:NBCAD_3MF_FIXTURE -ErrorAction SilentlyContinue
    Remove-Item Env:NBCAD_SLICER_RESULTS -ErrorAction SilentlyContinue
    Pop-Location
}
