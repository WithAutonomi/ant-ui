# Wipe all Autonomi GUI and ant daemon/node state so the next run starts
# from a clean setup. Windows counterpart of scripts/reset-state.sh.
#
# This uninstalls the Autonomi MSI (so it no longer appears in Add/Remove
# Programs) and deletes: GUI settings, upload history, datamaps, the node
# registry, node data and logs, the cached ant-node binaries, and the
# saorsa-core bootstrap-peer cache (the P2P stack auto-creates one in
# %LOCALAPPDATA%\saorsa\bootstrap\, so old testnet peers persist there
# otherwise). Wallet keys are NOT persisted on disk (they come from the
# SECRET_KEY env var), so nothing secret is at risk.

[CmdletBinding()]
param(
    [switch]$Yes
)

$ErrorActionPreference = "Stop"

# PowerShell 6+ defines $IsWindows; Windows PowerShell 5.1 does not but only runs on Windows.
if ((Test-Path variable:IsWindows) -and -not $IsWindows) {
    Write-Error "reset-state.ps1 is Windows-only. Use scripts/reset-state.sh on Linux or macOS."
    exit 1
}

$AppData = $env:APPDATA
if (-not $AppData) {
    $AppData = Join-Path $env:USERPROFILE "AppData\Roaming"
}
$LocalAppData = $env:LOCALAPPDATA
if (-not $LocalAppData) {
    $LocalAppData = Join-Path $env:USERPROFILE "AppData\Local"
}

$GuiState     = Join-Path $AppData "autonomi\ant-gui"
$AntData      = Join-Path $AppData "ant"
$SaorsaCache  = Join-Path $LocalAppData "saorsa"

# Find MSI-installed Autonomi entries in the Windows uninstall registry.
# Tauri's WiX bundle registers under one of these three hives depending on
# per-user vs per-machine install and 32- vs 64-bit view.
function Get-AutonomiInstalls {
    $roots = @(
        'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall',
        'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall',
        'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall'
    )
    $results = @()
    foreach ($root in $roots) {
        if (-not (Test-Path $root)) { continue }
        Get-ChildItem -LiteralPath $root -ErrorAction SilentlyContinue | ForEach-Object {
            $entry = Get-ItemProperty -LiteralPath $_.PSPath -ErrorAction SilentlyContinue
            if ($entry -and $entry.DisplayName -like 'Autonomi*') {
                $results += [pscustomobject]@{
                    DisplayName  = $entry.DisplayName
                    ProductCode  = $_.PSChildName
                    RegistryRoot = $root
                }
            }
        }
    }
    return $results
}

$Installs = Get-AutonomiInstalls

# Collect custom node paths referenced by the registry before we wipe it,
# so nodes created with --data-dir-path / --log-dir-path outside the
# default ant tree are also removed.
$CustomPaths = @()
$Registry = Join-Path $AntData "node_registry.json"
if (Test-Path $Registry) {
    try {
        $reg = Get-Content -Raw -Path $Registry | ConvertFrom-Json
        if ($reg.nodes) {
            foreach ($prop in $reg.nodes.PSObject.Properties) {
                $node = $prop.Value
                foreach ($field in @('data_dir','log_dir')) {
                    $p = $node.$field
                    if ($p -and ("$p" -notlike "$AntData*")) {
                        $CustomPaths += "$p"
                    }
                }
            }
        }
    } catch {
        Write-Warning "Could not parse $Registry - custom node paths (if any) will not be wiped: $_"
    }
}

$Targets = @($GuiState, $AntData, $SaorsaCache) + $CustomPaths

Write-Host "The following actions will run:"
if ($Installs.Count -gt 0) {
    foreach ($i in $Installs) {
        Write-Host "  - uninstall MSI: $($i.DisplayName) $($i.ProductCode)"
    }
} else {
    Write-Host "  - uninstall MSI: (no Autonomi install found in Add/Remove Programs)"
}
foreach ($t in $Targets) {
    if (Test-Path -LiteralPath $t) {
        Write-Host "  - delete: $t"
    } else {
        Write-Host "  - delete: $t  (not present)"
    }
}

if (-not $Yes) {
    $reply = Read-Host "Continue? [y/N]"
    if ($reply -notmatch '^(y|yes)$') {
        Write-Host "Aborted."
        exit 1
    }
}

# Warn if a per-machine install is present but we're not elevated. msiexec
# will fail with 1625/1620 under those conditions; better to surface it up front.
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator
)
$perMachine = $Installs | Where-Object { $_.RegistryRoot -like 'HKLM:*' }
if ($perMachine -and -not $isAdmin) {
    Write-Warning "A per-machine Autonomi install was found but this shell is not elevated."
    Write-Warning "msiexec will likely fail; re-run this script from an Administrator PowerShell."
}

Write-Host ""
Write-Host "Stopping Autonomi GUI and ant processes..."
foreach ($name in @('Autonomi','ant-gui','ant','ant-node')) {
    Get-Process -Name $name -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
}

# Extra daemon cleanup via PID file, in case a detached daemon is still up.
$PidFile = Join-Path $AntData "daemon.pid"
if (Test-Path -LiteralPath $PidFile) {
    $raw = (Get-Content -Raw -Path $PidFile).Trim()
    $daemonPid = 0
    if ([int]::TryParse($raw, [ref]$daemonPid) -and $daemonPid -gt 0) {
        Get-Process -Id $daemonPid -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    }
}

# Uninstall each matching MSI entry.
$UninstallFailed = $false
foreach ($i in $Installs) {
    Write-Host ""
    Write-Host "Uninstalling $($i.DisplayName) ($($i.ProductCode))..."
    if ($i.ProductCode -notmatch '^\{[0-9A-Fa-f-]+\}$') {
        Write-Warning "  skipping: not an MSI ProductCode (entry key: $($i.ProductCode))"
        $UninstallFailed = $true
        continue
    }
    $proc = Start-Process -FilePath 'msiexec.exe' `
        -ArgumentList '/x', $i.ProductCode, '/qn', '/norestart' `
        -Wait -PassThru -NoNewWindow
    if ($proc.ExitCode -eq 0 -or $proc.ExitCode -eq 3010) {
        # 3010 = success but reboot required; still a successful uninstall.
        Write-Host "  msiexec exit code: $($proc.ExitCode)"
    } else {
        Write-Warning "  msiexec exit code: $($proc.ExitCode) (uninstall may have failed)"
        $UninstallFailed = $true
    }
}

Write-Host ""
Write-Host "Deleting directories..."
$DeleteFailed = $false
foreach ($t in $Targets) {
    if (Test-Path -LiteralPath $t) {
        try {
            Remove-Item -LiteralPath $t -Recurse -Force -ErrorAction Stop
            Write-Host "  removed: $t"
        } catch {
            Write-Host "  FAILED:  $t ($($_.Exception.Message))"
            $DeleteFailed = $true
        }
    }
}

Write-Host ""
if ($UninstallFailed -or $DeleteFailed) {
    Write-Host "Reset finished with errors - see messages above."
    exit 1
}
Write-Host "Reset complete."
