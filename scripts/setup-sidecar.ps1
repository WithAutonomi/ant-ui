# Build the ant daemon binary for local development.
# Assumes ant-client is in a sibling directory (..\ant-client).
$ErrorActionPreference = "Stop"

$GuiDir = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$ClientDir = if ($env:ANT_CLIENT_DIR) { $env:ANT_CLIENT_DIR } else { Join-Path (Split-Path -Parent $GuiDir) "ant-client" }

if (-not (Test-Path $ClientDir)) {
    Write-Error "ant-client not found at $ClientDir. Set `$env:ANT_CLIENT_DIR or clone it as a sibling directory."
    exit 1
}

Write-Host "Building ant-cli from $ClientDir..."
Push-Location $ClientDir
cargo build --release -p ant-cli
Pop-Location

$Target = (rustc -vV | Select-String "host:").ToString().Split(" ")[1]
$BinDir = Join-Path $GuiDir "src-tauri\binaries"
New-Item -ItemType Directory -Force -Path $BinDir | Out-Null
Copy-Item (Join-Path $ClientDir "target\release\ant.exe") (Join-Path $BinDir "ant-$Target.exe")

Write-Host "Sidecar binary installed: src-tauri\binaries\ant-$Target.exe"
