# Starts Nori's helper model at sign-in (owner-approved 2026-11-11: "Yes, at sign-in"). Runs from the
# Startup-folder shortcut "Nori Helper Model". To turn it off: Task Manager > Startup apps, or remove
# that shortcut. To stop the helper now: run-helper.ps1 -Stop
#
# run-helper.ps1 only starts on the AMD card and does nothing when the helper is already running.
param([int]$DelaySeconds = 75)
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$log = Join-Path $env:LOCALAPPDATA 'NoriHelper\logs\signin-start.log'
New-Item -ItemType Directory -Force (Split-Path $log) | Out-Null
function Note($text) { Add-Content -Path $log -Encoding utf8 -Value "$((Get-Date).ToString('s')) $text" }
try {
  if ($DelaySeconds -gt 0) { Start-Sleep -Seconds $DelaySeconds }   # let sign-in and the graphics drivers settle
  & (Join-Path $here 'run-helper.ps1') | ForEach-Object { Note $_ }
} catch { Note "failed: $($_.Exception.Message)"; exit 1 }
