[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$DataDirectory,

  [ValidateRange(1, 65535)]
  [int]$Port = 3000,

  [switch]$SkipBuild,
  [switch]$AllowInsecureHttp,
  [switch]$ValidateOnly
)

$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Split-Path $PSScriptRoot -Parent)).TrimEnd('\', '/')

if (-not [IO.Path]::IsPathRooted($DataDirectory)) {
  throw 'DataDirectory must be an absolute path outside the project repository.'
}

$dataRoot = [IO.Path]::GetFullPath($DataDirectory).TrimEnd('\', '/')
$projectPrefix = $projectRoot + [IO.Path]::DirectorySeparatorChar
$insideProject = $dataRoot.Equals($projectRoot, [StringComparison]::OrdinalIgnoreCase) -or
  $dataRoot.StartsWith($projectPrefix, [StringComparison]::OrdinalIgnoreCase)

if ($insideProject) {
  throw 'DataDirectory must be outside the project repository.'
}

if ($ValidateOnly) {
  [pscustomobject]@{
    ProjectRoot = $projectRoot
    DataDirectory = $dataRoot
    Port = $Port
    SecureCookie = -not $AllowInsecureHttp
  }
  exit 0
}

New-Item -ItemType Directory -Path $dataRoot -Force | Out-Null
$env:MINTGALLERY_DATA_DIR = $dataRoot
$env:MINTGALLERY_HOST = '127.0.0.1'
$env:MINTGALLERY_PORT = [string]$Port
$env:MINTGALLERY_COOKIE_SECURE = if ($AllowInsecureHttp) { 'false' } else { 'true' }

Push-Location $projectRoot
try {
  if (-not $SkipBuild) {
    npm run build
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  }

  npm run start
  exit $LASTEXITCODE
} finally {
  Pop-Location
}
