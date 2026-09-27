# Rebuild the source archive served by the office site. It contains no robot
# token or account credentials. Run after changing any OfficeRobot source file.
$root = Split-Path -Parent $PSScriptRoot
$source = Join-Path $root 'robot\OfficeRobot'
$outputDir = Join-Path $root 'office\downloads'
New-Item -ItemType Directory -Path $outputDir -Force | Out-Null
$destination = Join-Path $outputDir 'OfficeRobot-source.zip'
Compress-Archive -LiteralPath $source -DestinationPath $destination -Force
Write-Host "Created $destination"
