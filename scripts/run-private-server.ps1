[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$DataDirectory,

  [Parameter(Mandatory = $true)]
  [string]$NodePath,

  [ValidateRange(1, 65535)]
  [int]$Port = 3000,

  [string]$LogDirectory,

  [ValidateRange(1, 3600)]
  [int]$RestartDelaySeconds = 5
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
$serverLog = Join-Path $logRoot 'scheduled-server.log'

function Write-ServerLog {
  param([Parameter(Mandatory = $true)][string]$Message)
  $timestamp = Get-Date -Format o
  Add-Content -LiteralPath $serverLog -Value "[$timestamp] $Message"
}

$env:MINTGALLERY_DATA_DIR = $dataRoot
$env:MINTGALLERY_HOST = '127.0.0.1'
$env:MINTGALLERY_PORT = [string]$Port
$env:MINTGALLERY_COOKIE_SECURE = 'true'
$env:NODE_ENV = 'production'

Push-Location $projectRoot
try {
  Write-ServerLog "Runner started. project=$projectRoot data=$dataRoot port=$Port node=$nodeExecutable"
  while ($true) {
    Write-ServerLog "Starting MintGallery server."
    & $nodeExecutable $serverEntry *>> $serverLog
    $exitCode = if ($null -eq $LASTEXITCODE) { 0 } else { $LASTEXITCODE }
    Write-ServerLog "MintGallery server exited with code $exitCode. Restarting in $RestartDelaySeconds seconds."
    Start-Sleep -Seconds $RestartDelaySeconds
  }
} finally {
  Write-ServerLog 'Runner stopped.'
  Pop-Location
}
