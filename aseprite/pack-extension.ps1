<#
.SYNOPSIS
  Empaqueta la extension del connector en un .aseprite-extension instalable.

.DESCRIPTION
  Aseprite espera un zip con package.json y connector.lua en la RAIZ del archivo (no dentro de
  una subcarpeta), renombrado a .aseprite-extension.

.EXAMPLE
  .\aseprite\pack-extension.ps1
  # -> aseprite\asistente-connector.aseprite-extension
#>
$ErrorActionPreference = "Stop"

$here = $PSScriptRoot
$source = Join-Path $here "extension\asistente-connector"
$zip = Join-Path $here "asistente-connector.zip"
$output = Join-Path $here "asistente-connector.aseprite-extension"

if (-not (Test-Path $source)) {
    throw "No existe $source"
}

if (Test-Path $zip) { Remove-Item $zip -Force }
if (Test-Path $output) { Remove-Item $output -Force }

# El comodin \* es lo que mete los ficheros en la raiz del zip en vez de la carpeta contenedora.
Compress-Archive -Path (Join-Path $source "*") -DestinationPath $zip -CompressionLevel Optimal
Rename-Item -Path $zip -NewName (Split-Path $output -Leaf)

Write-Host ""
Write-Host "Extension empaquetada:" -ForegroundColor Green
Write-Host "  $output"
Write-Host ""
Write-Host "Instalala en Aseprite:" -ForegroundColor Cyan
Write-Host "  Edit > Preferences > Extensions > Add Extension  ->  selecciona ese archivo"
Write-Host "  y reinicia Aseprite."
Write-Host ""
