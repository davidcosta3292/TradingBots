<#
Copies the robot into MetaTrader 5 and compiles it.

Usage (from the repo folder, in PowerShell):
    .\robot\install.ps1
    .\robot\install.ps1 -DataFolder "C:\Users\you\AppData\Roaming\MetaQuotes\Terminal\<id>"

Find the data folder in MetaTrader: File > Open Data Folder.
#>
param([string]$DataFolder)

$ErrorActionPreference = 'Stop'
$source = Join-Path $PSScriptRoot 'OfficeRobot'
$terminals = Join-Path $env:APPDATA 'MetaQuotes\Terminal'

function Get-InstallPath([string]$folder) {
    $origin = Join-Path $folder 'origin.txt'
    if (Test-Path $origin) { return (Get-Content $origin -Raw -Encoding Unicode).Trim() }
    return $null
}

if (-not $DataFolder) {
    $found = @(Get-ChildItem $terminals -Directory -ErrorAction SilentlyContinue |
        Where-Object { Test-Path (Join-Path $_.FullName 'MQL5') })
    if ($found.Count -eq 0) {
        throw "No MetaTrader 5 data folder found. Install FTMO's MetaTrader 5, open it once, then run this again."
    }
    if ($found.Count -gt 1) {
        Write-Host 'Several MetaTrader installs found. Run again with -DataFolder set to one of these:'
        $found | ForEach-Object { Write-Host "  $($_.FullName)   ($(Get-InstallPath $_.FullName))" }
        exit 1
    }
    $DataFolder = $found[0].FullName
}

$installPath = Get-InstallPath $DataFolder
$editor = if ($installPath) { Join-Path $installPath 'metaeditor64.exe' } else { $null }
$target = Join-Path $DataFolder 'MQL5\Experts\OfficeRobot'

New-Item -ItemType Directory -Force $target | Out-Null
Copy-Item (Join-Path $source '*') $target -Force
Write-Host "Copied the robot to $target"

if (-not $editor -or -not (Test-Path $editor)) {
    Write-Host 'MetaEditor not found: open OfficeRobot.mq5 in MetaEditor and press F7 to compile.'
    exit 0
}

$log = Join-Path $target 'compile.log'
Remove-Item $log -ErrorAction SilentlyContinue
Start-Process -FilePath $editor -ArgumentList "/compile:`"$target\OfficeRobot.mq5`"", "/log:`"$log`"" -Wait -NoNewWindow
$text = if (Test-Path $log) { Get-Content $log -Raw -Encoding Unicode } else { '' }
$text -split "`r?`n" | Where-Object { $_ -match 'error|warning|Result' } | ForEach-Object { Write-Host $_ }

if ($text -match 'Result:\s*0 errors') {
    Write-Host 'Compiled. In MetaTrader, find OfficeRobot under Navigator > Expert Advisors.'
} else {
    Write-Host "Compile failed. Full log: $log"
    exit 1
}
