[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$DataDirectory,

  [Parameter(Mandatory = $true)]
  [string]$NodePath,

  [ValidateRange(1, 65535)]
  [int]$Port = 3000,

  [string]$TaskName = 'MintGallery',

  [string]$HealthTaskName,

  [string]$TailscalePath = 'F:\Tailscale\tailscale.exe',

  [ValidateRange(1, 60)]
  [int]$HealthIntervalMinutes = 3
)

$ErrorActionPreference = 'Stop'
$isAdministrator = [Security.Principal.WindowsPrincipal]::new(
  [Security.Principal.WindowsIdentity]::GetCurrent()
).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdministrator) {
  throw 'Run this installer from a Windows PowerShell window opened as administrator.'
}

$runner = Join-Path $PSScriptRoot 'run-private-server.ps1'
$healthRunner = Join-Path $PSScriptRoot 'ensure-private-service.ps1'
$dataRoot = [IO.Path]::GetFullPath($DataDirectory)
$nodeExecutable = [IO.Path]::GetFullPath($NodePath)
if (-not $HealthTaskName) {
  $HealthTaskName = "$TaskName HealthCheck"
}
if (-not (Test-Path -LiteralPath $runner -PathType Leaf)) {
  throw "Runner script not found: $runner"
}
if (-not (Test-Path -LiteralPath $healthRunner -PathType Leaf)) {
  throw "Health check script not found: $healthRunner"
}
if (-not (Test-Path -LiteralPath $nodeExecutable -PathType Leaf)) {
  throw "Node executable not found: $nodeExecutable"
}
$tailscaleExecutable = if ($TailscalePath) { [IO.Path]::GetFullPath($TailscalePath) } else { $null }
$arguments = @(
  '-NoProfile'
  '-ExecutionPolicy Bypass'
  "-File `"$runner`""
  "-DataDirectory `"$dataRoot`""
  "-NodePath `"$nodeExecutable`""
  "-Port $Port"
) -join ' '

$action = New-ScheduledTaskAction `
  -Execute 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe' `
  -Argument $arguments `
  -WorkingDirectory (Split-Path $PSScriptRoot -Parent)
$startupTrigger = New-ScheduledTaskTrigger -AtStartup
$logonTrigger = New-ScheduledTaskTrigger -AtLogOn
$principal = New-ScheduledTaskPrincipal `
  -UserId 'SYSTEM' `
  -LogonType ServiceAccount `
  -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -RestartCount 999 `
  -RestartInterval (New-TimeSpan -Minutes 1) `
  -ExecutionTimeLimit (New-TimeSpan -Seconds 0) `
  -MultipleInstances IgnoreNew

Register-ScheduledTask `
  -TaskName $TaskName `
  -Action $action `
  -Trigger @($startupTrigger, $logonTrigger) `
  -Principal $principal `
  -Settings $settings `
  -Description 'Starts MintGallery on loopback for Tailscale Serve.' `
  -ErrorAction Stop `
  -Force | Out-Null

$healthArguments = @(
  '-NoProfile'
  '-ExecutionPolicy Bypass'
  "-File `"$healthRunner`""
  "-DataDirectory `"$dataRoot`""
  "-NodePath `"$nodeExecutable`""
  "-Port $Port"
  "-TaskName `"$TaskName`""
)
if ($tailscaleExecutable) {
  $healthArguments += "-TailscalePath `"$tailscaleExecutable`""
}
$healthAction = New-ScheduledTaskAction `
  -Execute 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe' `
  -Argument ($healthArguments -join ' ') `
  -WorkingDirectory (Split-Path $PSScriptRoot -Parent)
$healthStartupTrigger = New-ScheduledTaskTrigger -AtStartup
$healthLogonTrigger = New-ScheduledTaskTrigger -AtLogOn
$healthIntervalTrigger = New-ScheduledTaskTrigger `
  -Once `
  -At (Get-Date).AddMinutes(1) `
  -RepetitionInterval (New-TimeSpan -Minutes $HealthIntervalMinutes) `
  -RepetitionDuration (New-TimeSpan -Days 3650)
$healthSettings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -RestartCount 3 `
  -RestartInterval (New-TimeSpan -Minutes 1) `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 2) `
  -MultipleInstances IgnoreNew

Register-ScheduledTask `
  -TaskName $HealthTaskName `
  -Action $healthAction `
  -Trigger @($healthStartupTrigger, $healthLogonTrigger, $healthIntervalTrigger) `
  -Principal $principal `
  -Settings $healthSettings `
  -Description 'Checks MintGallery health and repairs the private Tailscale proxy when needed.' `
  -ErrorAction Stop `
  -Force | Out-Null

Start-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
Start-ScheduledTask -TaskName $HealthTaskName -ErrorAction SilentlyContinue

Get-ScheduledTask -TaskName $TaskName, $HealthTaskName -ErrorAction Stop |
  Select-Object TaskName,State,Author
