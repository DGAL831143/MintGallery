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

  [switch]$SkipTailscaleServiceRepair,

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

function Get-TailscaleState {
  param([Parameter(Mandatory = $true)][string]$Path)

  $raw = $null
  try {
    $raw = (& $Path status --json 2>&1 | Out-String).Trim()
    $parsed = $raw | ConvertFrom-Json
    $health = @()
    if ($parsed.Health) {
      $health = @($parsed.Health)
    }
    return @{
      BackendState = [string]$parsed.BackendState
      Online = [bool]$parsed.Self.Online
      DNSName = [string]$parsed.Self.DNSName
      Health = $health
      Error = $null
      Raw = $raw
    }
  } catch {
    return @{
      BackendState = $null
      Online = $false
      DNSName = $null
      Health = @()
      Error = $_.Exception.Message
      Raw = $raw
    }
  }
}

function Test-TailscaleServiceRestartNeeded {
  param(
    [Parameter(Mandatory = $true)]$State,
    [AllowNull()][string]$Output
  )

  if ($State.BackendState -eq 'NeedsLogin') {
    return $false
  }
  if ($State.BackendState -in @('NoState', 'Starting')) {
    return $true
  }
  if ($Output -and ($Output.Contains('unexpected state: NoState') -or $Output.Contains('Tailscale is starting'))) {
    return $true
  }
  return $false
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
$tailscaleBackendState = $null
$tailscaleOnline = $false
$tailscaleDnsName = $null
$tailscaleHealth = @()

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
  $expectedProxy = "proxy http://127.0.0.1:$Port"
  for ($attempt = 0; $attempt -lt 2; $attempt++) {
    $tailscaleState = Get-TailscaleState -Path $TailscalePath
    $tailscaleBackendState = $tailscaleState.BackendState
    $tailscaleOnline = $tailscaleState.Online
    $tailscaleDnsName = $tailscaleState.DNSName
    $tailscaleHealth = $tailscaleState.Health
    if ($tailscaleState.Error) {
      $errors += "Tailscale status check failed: $($tailscaleState.Error)"
      Write-HealthLog "Tailscale status check failed: $($tailscaleState.Error)"
    }

    try {
      $serveOutput = (& $TailscalePath serve status 2>&1 | Out-String).Trim()
      $serveOk = $serveOutput.Contains($expectedProxy)
      if (-not $serveOk -and -not $ReportOnly -and -not $SkipTailscaleServeRepair) {
        if ($actions -notcontains 'repair tailscale serve') {
          $actions += 'repair tailscale serve'
        }
        Write-HealthLog "Repairing Tailscale Serve proxy to port $Port."
        & $TailscalePath serve --bg --yes $Port 2>&1 | Out-Null
        $serveOutput = (& $TailscalePath serve status 2>&1 | Out-String).Trim()
        $serveOk = $serveOutput.Contains($expectedProxy)
      }
    } catch {
      $serveOutput = $_.Exception.Message
      $errors += "Tailscale Serve check failed: $serveOutput"
      Write-HealthLog "Tailscale Serve check failed: $serveOutput"
    }

    $combinedTailscaleOutput = @($tailscaleState.Raw, ($tailscaleHealth -join ' | '), $serveOutput) -join "`n"
    $shouldRestartTailscale = Test-TailscaleServiceRestartNeeded -State $tailscaleState -Output $combinedTailscaleOutput
    if ($serveOk -or $ReportOnly -or $SkipTailscaleServiceRepair -or -not $shouldRestartTailscale -or $attempt -eq 1) {
      break
    }

    try {
      if ($actions -notcontains 'restart tailscale service') {
        $actions += 'restart tailscale service'
      }
      Write-HealthLog "Restarting Tailscale service after backend state $tailscaleBackendState."
      Restart-Service -Name 'Tailscale' -Force -ErrorAction Stop
      Start-Sleep -Seconds 12
    } catch {
      $errors += "Tailscale service restart failed: $($_.Exception.Message)"
      Write-HealthLog "Tailscale service restart failed: $($_.Exception.Message)"
      break
    }
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
  TailscaleBackendState = $tailscaleBackendState
  TailscaleOnline = $tailscaleOnline
  TailscaleDnsName = $tailscaleDnsName
  TailscaleHealth = $tailscaleHealth
  Actions = $actions
  Errors = $errors
  LogFile = $healthLog
}

Write-HealthLog "result health=$($result.HealthOk) version=$($result.Version) task=$($result.TaskState) tailscale=$($result.TailscaleBackendState) serve=$($result.TailscaleServeOk) actions=$($actions -join ', ') errors=$($errors -join ' | ')"

if ($Json) {
  $result | ConvertTo-Json -Compress
} else {
  $result
}
