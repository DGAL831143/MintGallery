[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$DataDirectory,

  [Parameter(Mandatory = $true)]
  [string]$NodePath,

  [ValidateRange(1, 65535)]
  [int]$Port = 3000,

  [string]$TaskName = 'MintGallery'
)

$ErrorActionPreference = 'Stop'
$isAdministrator = [Security.Principal.WindowsPrincipal]::new(
  [Security.Principal.WindowsIdentity]::GetCurrent()
).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdministrator) {
  throw 'Run this installer from a Windows PowerShell window opened as administrator.'
}

$runner = Join-Path $PSScriptRoot 'run-private-server.ps1'
$dataRoot = [IO.Path]::GetFullPath($DataDirectory)
$nodeExecutable = [IO.Path]::GetFullPath($NodePath)
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
$trigger = New-ScheduledTaskTrigger -AtStartup
$principal = New-ScheduledTaskPrincipal `
  -UserId 'SYSTEM' `
  -LogonType ServiceAccount `
  -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -RestartCount 3 `
  -RestartInterval (New-TimeSpan -Minutes 1) `
  -ExecutionTimeLimit (New-TimeSpan -Seconds 0) `
  -MultipleInstances IgnoreNew

Register-ScheduledTask `
  -TaskName $TaskName `
  -Action $action `
  -Trigger $trigger `
  -Principal $principal `
  -Settings $settings `
  -Description 'Starts MintGallery on loopback for Tailscale Serve.' `
  -ErrorAction Stop `
  -Force | Out-Null

Get-ScheduledTask -TaskName $TaskName -ErrorAction Stop | Select-Object TaskName,State,Author
