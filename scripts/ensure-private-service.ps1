[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$DataDirectory,

  [Parameter(Mandatory = $true)]
  [string]$NodePath,

  [ValidateRange(1, 65535)]
  [int]$Port = 3000,

  [string]$TaskName = 'MintGallery',

  [string]$TailscalePath = 'F:\Tailscale\tailscale.exe',

  [string]$LogDirectory,

  [switch]$ReportOnly,

  [switch]$SkipTailscaleServeRepair,

  [switch]$Json
)

$ErrorActionPreference = 'Stop'

function Resolve-FullPath {
  param([Parameter(Mandatory = $true)][string]$Path)
  [IO.Path]::GetFullPath($Path).TrimEnd([char[]]@('\', '/'))
}

function Test-Endpoint {
  param([Parameter(Mandatory = $true)][string]$Uri)

  try {
    $response = Invoke-RestMethod -Uri $Uri -TimeoutSec 5
    return @{
      Ok = [bool]$response.ok
      Version = [string]$response.version
      Error = $null
    }
  } catch {
    return @{
      Ok = $false
      Version = $null
      Error = $_.Exception.Message
    }
  }
}

function Write-HealthLog {
  param([Parameter(Mandatory = $true)][string]$Message)
  $timestamp = Get-Date -Format o
  Add-Content -LiteralPath $healthLog -Value "[$timestamp] $Message"
}

$projectRoot = Resolve-FullPath (Split-Path $PSScriptRoot -Parent)
$dataRoot = Resolve-FullPath $DataDirectory
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

if (-not $LogDirectory) {
  $LogDirectory = Join-Path (Split-Path $dataRoot -Parent) 'logs'
}
$logRoot = [IO.Path]::GetFullPath($LogDirectory)
New-Item -ItemType Directory -Path $logRoot -Force | Out-Null
$healthLog = Join-Path $logRoot 'health-check.log'

$healthUri = "http://127.0.0.1:$Port/api/health"
$actions = @()
$errors = @()
$taskState = $null
$lastTaskResult = $null

try {
  $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction Stop
  $taskState = [string]$task.State
  try {
    $taskInfo = Get-ScheduledTaskInfo -TaskName $TaskName -ErrorAction Stop
    $lastTaskResult = $taskInfo.LastTaskResult
  } catch {
    $errors += "Scheduled task info unavailable: $($_.Exception.Message)"
  }
} catch {
  $errors += "Scheduled task unavailable: $($_.Exception.Message)"
}

$health = Test-Endpoint -Uri $healthUri
if (-not $health.Ok -and -not $ReportOnly) {
  Write-HealthLog "Health check failed: $($health.Error)"
  try {
    if ($taskState -eq 'Running') {
      $actions += "restart scheduled task $TaskName"
      Write-HealthLog "Restarting scheduled task $TaskName after failed health check."
      Stop-ScheduledTask -TaskName $TaskName -ErrorAction Stop
      Start-Sleep -Seconds 3
    } else {
      $actions += "start scheduled task $TaskName"
      Write-HealthLog "Starting scheduled task $TaskName after failed health check."
    }
    Start-ScheduledTask -TaskName $TaskName -ErrorAction Stop
    Start-Sleep -Seconds 12
    $health = Test-Endpoint -Uri $healthUri
  } catch {
    $errors += "Task repair failed: $($_.Exception.Message)"
    Write-HealthLog "Task repair failed: $($_.Exception.Message)"
  }
}

$serveOk = $false
$serveOutput = $null
if (Test-Path -LiteralPath $TailscalePath -PathType Leaf) {
  try {
    $serveOutput = (& $TailscalePath serve status 2>&1 | Out-String).Trim()
    $expectedProxy = "proxy http://127.0.0.1:$Port"
    $serveOk = $serveOutput.Contains($expectedProxy)
    if (-not $serveOk -and -not $ReportOnly -and -not $SkipTailscaleServeRepair) {
      $actions += "repair tailscale serve"
      Write-HealthLog "Repairing Tailscale Serve proxy to port $Port."
      & $TailscalePath serve --bg --yes $Port | Out-Null
      $serveOutput = (& $TailscalePath serve status 2>&1 | Out-String).Trim()
      $serveOk = $serveOutput.Contains($expectedProxy)
    }
  } catch {
    $errors += "Tailscale Serve check failed: $($_.Exception.Message)"
    Write-HealthLog "Tailscale Serve check failed: $($_.Exception.Message)"
  }
} else {
  $errors += "Tailscale executable not found: $TailscalePath"
}

try {
  $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction Stop
  $taskState = [string]$task.State
  try {
    $taskInfo = Get-ScheduledTaskInfo -TaskName $TaskName -ErrorAction Stop
    $lastTaskResult = $taskInfo.LastTaskResult
  } catch {
    $errors += "Scheduled task info refresh unavailable: $($_.Exception.Message)"
  }
} catch {
  $errors += "Scheduled task refresh unavailable: $($_.Exception.Message)"
}

$result = [pscustomobject]@{
  Timestamp = (Get-Date -Format o)
  HealthOk = $health.Ok
  Version = $health.Version
  HealthUri = $healthUri
  TaskName = $TaskName
  TaskState = $taskState
  LastTaskResult = $lastTaskResult
  TailscaleServeOk = $serveOk
  Actions = $actions
  Errors = $errors
  LogFile = $healthLog
}

Write-HealthLog "result health=$($result.HealthOk) version=$($result.Version) task=$($result.TaskState) serve=$($result.TailscaleServeOk) actions=$($actions -join ', ') errors=$($errors -join ' | ')"

if ($Json) {
  $result | ConvertTo-Json -Compress
} else {
  $result
}
