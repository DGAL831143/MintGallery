[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$DataDirectory,

  [Parameter(Mandatory = $true)]
  [string]$NodePath,

  [ValidateRange(1, 65535)]
  [int]$Port = 3000,

  [string]$LogDirectory
)

$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Split-Path $PSScriptRoot -Parent)).TrimEnd('\', '/')
$dataRoot = [IO.Path]::GetFullPath($DataDirectory).TrimEnd('\', '/')
$nodeExecutable = [IO.Path]::GetFullPath($NodePath)
$projectPrefix = $projectRoot + [IO.Path]::DirectorySeparatorChar

if (-not [IO.Path]::IsPathRooted($DataDirectory) -or
    $dataRoot.Equals($projectRoot, [StringComparison]::OrdinalIgnoreCase) -or
    $dataRoot.StartsWith($projectPrefix, [StringComparison]::OrdinalIgnoreCase)) {
  throw 'DataDirectory must be an absolute path outside the project repository.'
}
if (-not (Test-Path -LiteralPath $nodeExecutable -PathType Leaf)) {
  throw "Node executable not found: $nodeExecutable"
}

$serverEntry = Join-Path $projectRoot 'apps\server\dist\index.js'
if (-not (Test-Path -LiteralPath $serverEntry -PathType Leaf)) {
  throw 'Production build not found. Run npm run build before starting the scheduled service.'
}

if (-not $LogDirectory) {
  $LogDirectory = Join-Path (Split-Path $dataRoot -Parent) 'logs'
}
$logRoot = [IO.Path]::GetFullPath($LogDirectory)
New-Item -ItemType Directory -Path $dataRoot -Force | Out-Null
New-Item -ItemType Directory -Path $logRoot -Force | Out-Null

$env:MINTGALLERY_DATA_DIR = $dataRoot
$env:MINTGALLERY_HOST = '127.0.0.1'
$env:MINTGALLERY_PORT = [string]$Port
$env:MINTGALLERY_COOKIE_SECURE = 'true'

Push-Location $projectRoot
try {
  & $nodeExecutable $serverEntry *>> (Join-Path $logRoot 'scheduled-server.log')
  exit $LASTEXITCODE
} finally {
  Pop-Location
}
