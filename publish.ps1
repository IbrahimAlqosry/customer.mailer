<#
  Builds the two IIS applications into .\publish:
    publish\CustomerMailer      -> frontend (copy to the CustomerMailer IIS application folder)
    publish\CustomerMailerApi   -> backend  (copy to the CustomerMailerApi IIS application folder)
  Usage (from the repo root):
    powershell -ExecutionPolicy Bypass -File .\publish.ps1
    powershell -ExecutionPolicy Bypass -File .\publish.ps1 -FrontendApp CustomerMailer -BackendApp CustomerMailerApi -Origin https://mdev.yemensoft.net:473
#>
param(
  [string]$FrontendApp = 'CustomerMailer',
  [string]$BackendApp = 'CustomerMailerApi',
  [string]$Origin = 'https://mdev.yemensoft.net:473'
)
$ErrorActionPreference = 'Stop'
$Root = $PSScriptRoot
$Out = Join-Path $Root 'publish'
$Front = Join-Path $Out $FrontendApp
$Back = Join-Path $Out $BackendApp

# Windows PowerShell's "-Encoding utf8" adds a BOM, which breaks .env parsing (the first key
# would be read as "﻿SMTP_HOST"); write UTF-8 without a BOM instead.
function Write-Utf8([string]$Path, [string[]]$Lines) {
  [IO.File]::WriteAllLines($Path, $Lines, (New-Object Text.UTF8Encoding $false))
}

# Empty the folder rather than deleting it, so it works even if it's open in Explorer.
if (Test-Path $Out) { Get-ChildItem $Out -Force | Remove-Item -Recurse -Force }
New-Item -ItemType Directory -Force -Path $Front, $Back | Out-Null

# ---------- Frontend ----------
Write-Host "Building frontend for /$FrontendApp/ ..." -ForegroundColor Cyan
Push-Location (Join-Path $Root 'client')
try {
  npx ng build --configuration production --base-href "/$FrontendApp/"
  if ($LASTEXITCODE -ne 0) { throw 'Frontend build failed.' }
} finally { Pop-Location }
Copy-Item (Join-Path $Root 'client\dist\client\browser\*') $Front -Recurse -Force

# Point the frontend at the backend IIS application (same site, so no CORS needed).
Write-Utf8 (Join-Path $Front 'config.js') @(
  '// Runtime settings. Edit on the server without rebuilding the app.',
  "// apiUrl: where the backend API is (the $BackendApp IIS application).",
  'window.APP_CONFIG = {',
  "  apiUrl: '/$BackendApp/api',",
  '};'
)

# ---------- Backend ----------
Write-Host 'Preparing backend ...' -ForegroundColor Cyan
$server = Join-Path $Root 'server'
# Every top-level .js file (so new server modules are picked up automatically) + package files.
Get-ChildItem $server -Filter *.js -File | ForEach-Object { Copy-Item $_.FullName $Back }
'package.json', 'package-lock.json' | ForEach-Object { Copy-Item (Join-Path $server $_) $Back }
Copy-Item (Join-Path $server 'deploy\*') $Back

# Production dependencies only, included so the server needs no internet access.
Push-Location $Back
try {
  npm ci --omit=dev --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { throw 'npm ci failed.' }
} finally { Pop-Location }

# .env: the current settings with production values for the origin.
$envLines = Get-Content (Join-Path $server '.env') |
  Where-Object { $_ -notmatch '^\s*(CLIENT_ORIGIN|HOST|NODE_ENV)\s*=' }
$envLines += "CLIENT_ORIGIN=$Origin", 'HOST=127.0.0.1', 'NODE_ENV=production'
Write-Utf8 (Join-Path $Back '.env') $envLines

# .env.example: same keys, secret values removed, for documentation.
Write-Utf8 (Join-Path $Back '.env.example') ($envLines | ForEach-Object {
  if ($_ -match '^\s*(SMTP_PASS|ADMIN_PASSWORD|AUTH_SECRET)\s*=') { ($_ -split '=', 2)[0] + '=' } else { $_ }
})

Write-Host ''
Write-Host "Done. Copy these folders to the server:" -ForegroundColor Green
Write-Host "  $Front"
Write-Host "  $Back"
