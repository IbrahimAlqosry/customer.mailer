<#
  Stops and removes the Customer Mailer Node server task. Run as Administrator:
    powershell -ExecutionPolicy Bypass -File .\uninstall-service.ps1
#>
$ErrorActionPreference = 'Stop'
$TaskName = 'CustomerMailer API'
$Script = Join-Path $PSScriptRoot 'server.js'

if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
  Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" |
    Where-Object { $_.CommandLine -like "*$Script*" } |   # only this app's server, not other node apps
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
  Write-Host "Task '$TaskName' removed."
} else {
  Write-Host "Task '$TaskName' is not installed."
}
