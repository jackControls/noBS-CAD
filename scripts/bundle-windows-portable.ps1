[CmdletBinding()]
param(
    [string]$Target = "x86_64-pc-windows-msvc",
    [string]$OcctRoot = $env:OCCT_ROOT
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Invoke-Checked {
    param(
        [Parameter(Mandatory = $true)]
        [string]$FilePath,
        [Parameter(Mandatory = $true)]
        [string[]]$Arguments
    )
    & $FilePath @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "$FilePath exited with code $LASTEXITCODE"
    }
}

if ([System.Environment]::OSVersion.Platform -ne [System.PlatformID]::Win32NT) {
    throw "The Windows portable bundle must be built on Windows"
}
if ($Target -ne "x86_64-pc-windows-msvc") {
    throw "Only the x86_64-pc-windows-msvc portable target is currently supported"
}

$projectRoot = Split-Path -Parent $PSScriptRoot
if ([string]::IsNullOrWhiteSpace($OcctRoot)) {
    $OcctRoot = Join-Path $projectRoot "vcpkg_installed\x64-windows"
}
$OcctRoot = [System.IO.Path]::GetFullPath($OcctRoot)

$occtBinCandidates = @(
    (Join-Path $OcctRoot "bin"),
    (Join-Path $OcctRoot "win64\vc17\bin"),
    (Join-Path $OcctRoot "win64\vc16\bin"),
    (Join-Path $OcctRoot "win64\vc15\bin"),
    (Join-Path $OcctRoot "win64\vc14\bin")
)
$occtBin = $occtBinCandidates |
    Where-Object { Test-Path (Join-Path $_ "TKernel.dll") -PathType Leaf } |
    Select-Object -First 1
if (-not $occtBin) {
    throw "TKernel.dll was not found under OCCT_ROOT '$OcctRoot'"
}

$env:OCCT_ROOT = $OcctRoot
$env:VCPKG_TARGET_TRIPLET = "x64-windows"

Push-Location $projectRoot
try {
    Invoke-Checked "npm.cmd" @("run", "build:wasm")
    Invoke-Checked "npx.cmd" @(
        "tauri",
        "build",
        "--target",
        $Target,
        "--no-bundle"
    )

    $executableCandidates = @(
        (Join-Path $projectRoot "src-tauri\target\$Target\release\nbcad.exe"),
        (Join-Path $projectRoot "src-tauri\target\release\nbcad.exe")
    )
    $executable = $executableCandidates |
        Where-Object { Test-Path $_ -PathType Leaf } |
        Select-Object -First 1
    if (-not $executable) {
        throw "Tauri did not produce nbcad.exe in an expected release directory"
    }

    $tauriConfig = Get-Content (Join-Path $projectRoot "src-tauri\tauri.conf.json") -Raw |
        ConvertFrom-Json
    $version = [string]$tauriConfig.version
    $releaseRoot = Split-Path -Parent $executable
    $portableRoot = Join-Path $releaseRoot "bundle\portable"
    $packageName = "noBS-CAD-$version-windows-x64"
    $packageDir = Join-Path $portableRoot $packageName
    $zipPath = Join-Path $portableRoot "$packageName.zip"
    $checksumPath = "$zipPath.sha256"

    if (Test-Path $packageDir) {
        Remove-Item $packageDir -Recurse -Force
    }
    Remove-Item $zipPath, $checksumPath -Force -ErrorAction SilentlyContinue
    New-Item $packageDir -ItemType Directory -Force | Out-Null
    $licenseDir = Join-Path $packageDir "licenses"
    New-Item $licenseDir -ItemType Directory -Force | Out-Null

    Copy-Item $executable (Join-Path $packageDir "noBS-CAD.exe")
    $runtimeDlls = Get-ChildItem $occtBin -Filter "*.dll" -File
    if ($runtimeDlls.Count -eq 0) {
        throw "No runtime DLLs were found in '$occtBin'"
    }
    foreach ($dll in $runtimeDlls) {
        Copy-Item $dll.FullName (Join-Path $packageDir $dll.Name)
    }
    foreach ($required in @("TKernel.dll", "TKDESTEP.dll", "TKFillet.dll", "TKHLR.dll")) {
        if (-not (Test-Path (Join-Path $packageDir $required) -PathType Leaf)) {
            throw "Required OCCT runtime library is missing: $required"
        }
    }

    Copy-Item (Join-Path $projectRoot "LICENSE") `
        (Join-Path $licenseDir "noBS-CAD-LICENSE.txt")
    Copy-Item (Join-Path $projectRoot "THIRD_PARTY_NOTICES.md") $licenseDir
    Copy-Item (Join-Path $projectRoot "node_modules\opencascade.js\LICENSE") `
        (Join-Path $licenseDir "OPENCASCADE_JS_LICENSE.txt")

    $vcpkgShare = Join-Path $OcctRoot "share"
    if (Test-Path $vcpkgShare -PathType Container) {
        foreach ($copyright in Get-ChildItem $vcpkgShare -Filter "copyright" -File -Recurse) {
            $port = Split-Path -Leaf (Split-Path -Parent $copyright.FullName)
            Copy-Item $copyright.FullName (Join-Path $licenseDir "vcpkg-$port.txt")
        }
    }
    if (-not (Test-Path (Join-Path $licenseDir "vcpkg-opencascade.txt"))) {
        throw "The vcpkg OpenCASCADE license notice was not found"
    }

    $sourceCommit = if ([string]::IsNullOrWhiteSpace($env:GITHUB_SHA)) {
        "local working tree"
    } else {
        $env:GITHUB_SHA
    }
    @"
noBS CAD $version — Windows x64 portable build

Run noBS-CAD.exe directly; no installation is required.

System requirements:
- Windows 10 version 1803 or newer, or Windows 11
- Microsoft Edge WebView2 Runtime supplied by Windows
- Microsoft Visual C++ v14 x64 Redistributable
  https://aka.ms/vc14/vc_redist.x64.exe
- A graphics adapter and driver accepted by wgpu's DX12 or Vulkan backend

The Visual C++ runtime is intentionally not copied into this directory.
Microsoft recommends the centrally installed Redistributable so it can receive
security and servicing updates independently.

Source: https://github.com/jackControls/noBS-CAD
Source commit: $sourceCommit
"@ | Set-Content (Join-Path $packageDir "README.txt") -Encoding utf8

    Compress-Archive -Path $packageDir -DestinationPath $zipPath -CompressionLevel Optimal
    $hash = (Get-FileHash $zipPath -Algorithm SHA256).Hash.ToLowerInvariant()
    "$hash  $([System.IO.Path]::GetFileName($zipPath))" |
        Set-Content $checksumPath -Encoding ascii

    Write-Host "Packaged $($runtimeDlls.Count) runtime DLLs"
    Write-Host "Portable ZIP: $zipPath"
    Write-Host "SHA-256: $hash"
} finally {
    Pop-Location
}
