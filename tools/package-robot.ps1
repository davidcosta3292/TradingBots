# Rebuild the source archive served by the office site. It contains no robot
# token or account credentials. Run after changing any OfficeRobot source file.
$root = Split-Path -Parent $PSScriptRoot
$source = Join-Path $root 'robot\OfficeRobot'
$outputDir = Join-Path $root 'office\downloads'
New-Item -ItemType Directory -Path $outputDir -Force | Out-Null
$destination = Join-Path $outputDir 'OfficeRobot-source.zip'
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
if (Test-Path $destination) { Remove-Item -LiteralPath $destination -Force }
$archive = [System.IO.Compression.ZipFile]::Open($destination, [System.IO.Compression.ZipArchiveMode]::Create)
try {
    Get-ChildItem -LiteralPath $source -File |
        Where-Object { $_.Extension -in '.mq5', '.mqh' } |
        ForEach-Object {
            [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
                $archive, $_.FullName, "OfficeRobot/$($_.Name)") | Out-Null
        }
} finally {
    $archive.Dispose()
}
Write-Host "Created $destination"
