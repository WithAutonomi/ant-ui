# Download a prebuilt ant daemon sidecar from the WithAutonomi/ant-client
# GitHub releases and place it where Tauri expects it. Mirrors the
# `download ant daemon sidecar` step in .github/workflows/release.yml so
# that building from source works without cloning ant-client too.
#
# Usage:
#   .\scripts\download-sidecar.ps1                   # latest ant-client release
#   $env:ANT_TAG = "ant-cli-v0.1.2"; .\scripts\download-sidecar.ps1
$ErrorActionPreference = "Stop"

$GuiDir = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)

# Tauri target triple (e.g. x86_64-pc-windows-msvc)
$CrossTarget = (rustc -vV | Select-String "^host:").ToString().Split(" ")[1]
if (-not $CrossTarget) {
    Write-Error "Could not determine host triple from rustc"
    exit 1
}

# ant-client publishes musl builds for Linux; map gnu -> musl for the asset name.
$AntTarget = $CrossTarget -replace "unknown-linux-gnu", "unknown-linux-musl"

# Resolve tag (latest by default)
$AntTag = $env:ANT_TAG
if (-not $AntTag) {
    Write-Host "Resolving latest ant-client release..."
    $latest = Invoke-RestMethod -Uri "https://api.github.com/repos/WithAutonomi/ant-client/releases/latest"
    $AntTag = $latest.tag_name
    if (-not $AntTag) {
        Write-Error "Could not resolve latest ant-client release"
        exit 1
    }
}
$AntVersion = $AntTag -replace "^ant-cli-v", ""

# Asset extension differs by OS
$Ext = if ($AntTarget -like "*windows*") { "zip" } else { "tar.gz" }
$Asset = "ant-${AntVersion}-${AntTarget}.${Ext}"

$TmpDir = New-Item -ItemType Directory -Path (Join-Path ([System.IO.Path]::GetTempPath()) ([System.Guid]::NewGuid())) -Force
try {
    $Url = "https://github.com/WithAutonomi/ant-client/releases/download/${AntTag}/${Asset}"
    Write-Host "Downloading $Asset from $AntTag"
    $AssetPath = Join-Path $TmpDir $Asset
    Invoke-WebRequest -Uri $Url -OutFile $AssetPath -UseBasicParsing

    if ($Ext -eq "zip") {
        Expand-Archive -Path $AssetPath -DestinationPath $TmpDir -Force
    } else {
        # tar.exe ships with Windows 10+; same flags as GNU tar for our use.
        tar -xzf $AssetPath -C $TmpDir
    }

    $ExtractedDir = Join-Path $TmpDir "ant-${AntVersion}-${AntTarget}"
    $BinDir = Join-Path $GuiDir "src-tauri\binaries"
    New-Item -ItemType Directory -Force -Path $BinDir | Out-Null

    if ($AntTarget -like "*windows*") {
        Copy-Item (Join-Path $ExtractedDir "ant.exe") `
                  (Join-Path $BinDir "ant-${CrossTarget}.exe") -Force
        Write-Host "Sidecar binary installed: src-tauri\binaries\ant-${CrossTarget}.exe"
    } else {
        Copy-Item (Join-Path $ExtractedDir "ant") `
                  (Join-Path $BinDir "ant-${CrossTarget}") -Force
        Write-Host "Sidecar binary installed: src-tauri\binaries\ant-${CrossTarget}"
    }

    # Bundle the bootstrap_peers.toml that ships with this daemon version so the
    # embedded ant-core client can connect on a fresh install.
    $PeersSrc = Join-Path $ExtractedDir "bootstrap_peers.toml"
    if (Test-Path $PeersSrc) {
        $ResourceDir = Join-Path $GuiDir "src-tauri\resources"
        New-Item -ItemType Directory -Force -Path $ResourceDir | Out-Null
        Copy-Item $PeersSrc (Join-Path $ResourceDir "bootstrap_peers.toml") -Force
        Write-Host "Bootstrap peers refreshed: src-tauri\resources\bootstrap_peers.toml"
    } else {
        Write-Warning "bootstrap_peers.toml not found in $Asset — keeping vendored snapshot"
    }
}
finally {
    Remove-Item -Recurse -Force $TmpDir -ErrorAction SilentlyContinue
}
