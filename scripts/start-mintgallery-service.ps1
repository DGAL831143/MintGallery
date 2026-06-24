[CmdletBinding()]
param(
  [string]$DataDirectory = 'F:\MintGallery\data',

  [string]$NodePath = 'F:\nodejs\node.exe',

  [ValidateRange(1, 65535)]
  [int]$Port = 3000,

  [string]$TaskName = 'MintGallery',

  [string]$HealthTaskName,

  [switch]$ReportOnly,

  [switch]$Json
)

$ErrorActionPreference = 'Stop'

if (-not $HealthTaskName) {
  $HealthTaskName = "$TaskName HealthCheck"
}

$ensureScript = Join-Path $PSScriptRoot 'ensure-private-service.ps1'
if (-not (Test-Path -LiteralPath $ensureScript -PathType Leaf)) {
  throw "Health check script not found: $ensureScript"
}

function Invoke-MintGalleryEnsure {
  param([switch]$AsJson)

  $arguments = @{
    DataDirectory = $DataDirectory
    NodePath = $NodePath
    Port = $Port
    TaskName = $TaskName
    SkipTailscaleServiceRepair = $true
  }
  if ($ReportOnly) {
    $arguments.ReportOnly = $true
  }
  if ($AsJson) {
    $arguments.Json = $true
  }
  & $ensureScript @arguments
}

$raw = Invoke-MintGalleryEnsure -AsJson
$result = $raw | ConvertFrom-Json

if (-not $ReportOnly -and -not $result.TailscaleServeOk -and
    $result.TailscaleBackendState -in @('NoState', 'Starting')) {
  Start-ScheduledTask -TaskName $HealthTaskName -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 25
  $raw = Invoke-MintGalleryEnsure -AsJson
  $result = $raw | ConvertFrom-Json
}

if ($Json) {
  $result | ConvertTo-Json -Compress
} else {
  $result
}
