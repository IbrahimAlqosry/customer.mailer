<#
  Installs the Customer Mailer Node server as a Windows scheduled task that:
    - starts when Windows starts (no one needs to be logged in),
    - runs as SYSTEM, from this folder,
    - restarts automatically if it stops with an error,
    - writes its output to logs\server.log.
  Run once, in an elevated PowerShell (Run as administrator), from this folder:
    powershell -ExecutionPolicy Bypass -File .\install-service.ps1
  Running it again updates the task and restarts the server (use this after copying a new version).
#>
$ErrorActionPreference = 'Stop'
$TaskName = 'CustomerMailer API'
$Here = $PSScriptRoot
$Script = Join-Path $Here 'server.js'

if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw 'Please run this script as Administrator.'
}

$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { throw 'Node.js was not found. Install Node.js LTS from https://nodejs.org and run this script again.' }
if (-not (Test-Path (Join-Path $Here '.env'))) { throw "Missing .env in $Here. Copy .env.example to .env and fill it in." }
if (-not (Test-Path (Join-Path $Here 'node_modules'))) { throw "Missing node_modules in $Here. Copy the full folder from the publish output." }

New-Item -ItemType Directory -Force -Path (Join-Path $Here 'logs') | Out-Null

# cmd.exe redirects the server's output into the log file.
$action = New-ScheduledTaskAction -Execute 'cmd.exe' `
  -Argument "/c `"`"$node`" `"$Script`" >> `"$Here\logs\server.log`" 2>&1`"" `
  -WorkingDirectory $Here
$trigger = New-ScheduledTaskTrigger -AtStartup
$settings = New-ScheduledTaskSettingsSet `
  -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) `
  -ExecutionTimeLimit ([TimeSpan]::Zero) `
  -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -MultipleInstances IgnoreNew
$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest

if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
  Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  # Make sure the old node process has exited before starting the new one.
  Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" |
    Where-Object { $_.CommandLine -like "*$Script*" } |   # only this app's server, not other node apps
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal `
  -Description 'Customer Mailer email API (Node.js) behind the CustomerMailerApi IIS application.' | Out-Null
Start-ScheduledTask -TaskName $TaskName

Write-Host "Task '$TaskName' installed and started. Checking the server..."
Start-Sleep -Seconds 4
try {
  $health = Invoke-RestMethod -Uri 'http://127.0.0.1:3000/api/health' -TimeoutSec 10
  if ($health.ok) { Write-Host 'OK: the API is running on http://127.0.0.1:3000' -ForegroundColor Green }
} catch {
  Write-Host "The API did not answer yet. Check $Here\logs\server.log" -ForegroundColor Yellow
}
