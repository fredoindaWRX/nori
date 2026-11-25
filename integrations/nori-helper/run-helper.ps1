# Starts Nori's helper model on the second graphics card (owner request 2026-11-11: "set up the helper
# model on the second card"). It is a separate small model server; it is not part of the installed Nori app
# and nothing in the app uses it until a reviewed change points something at it.
#
#   Model   : the 9B at Q6_K, 32K context (owner 2026-11-12: "whichever is most advanced"; measured 7.4 GB of
#             the card's 8 GB, 12.2 tokens/s, prompts 96 tokens/s). Q6_K does not fit 64K on 8 GB. Every job sent
#             here is small (trimmed hand-offs, stream chat, daily journal). Previous: Q4_K_M at 64K (13.6 tok/s);
#             fastest measured: i1-Q4_0 (14.6). Benchmark: C:\Nori\.work\rx480-quants-20261112
#   Card    : the AMD card only. It is found by name; if it is missing the helper does not start, so it can
#             never land on the main NVIDIA card and take memory from Nori's main model.
#   Address : http://127.0.0.1:18795, loopback only, OpenAI-style /v1/chat/completions
#   Key     : every request needs the key in %LOCALAPPDATA%\NoriHelper\api-key.txt (Authorization: Bearer ...).
#             Without it any web page open in a browser could use the model. This script never prints the key.
#
# Stop it:  .\run-helper.ps1 -Stop
param([switch]$Stop, [int]$Port = 18795, [int]$Context = 32768)
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$exe = Join-Path $here 'runtime\llama-server.exe'
$model = 'C:\Nori\models\language\huihui-qwen3.5-9b-q6k-mradermacher\Huihui-Qwen3.5-9B-abliterated.Q6_K.gguf'
$data = Join-Path $env:LOCALAPPDATA 'NoriHelper'
$pidFile = Join-Path $data 'helper.pid'
$keyFile = Join-Path $data 'api-key.txt'
$log = Join-Path $data 'logs\helper.log'
New-Item -ItemType Directory -Force (Split-Path $log) | Out-Null

function Get-Helper {
  if (-not (Test-Path $pidFile)) { return $null }
  $saved = [int](Get-Content $pidFile -TotalCount 1)
  $p = Get-CimInstance Win32_Process -Filter "ProcessId=$saved" -ErrorAction SilentlyContinue
  # Only treat it as ours when it really is this server on this port; a reused number is left alone.
  if ($p -and $p.Name -eq 'llama-server.exe' -and $p.CommandLine -match "--port\s+$Port\b" -and $p.ExecutablePath -eq $exe) { return $p }
  return $null
}

$running = Get-Helper
if ($Stop) {
  if ($running) { Stop-Process -Id $running.ProcessId -Force; 'helper stopped' } else { 'helper was not running' }
  Remove-Item $pidFile -ErrorAction SilentlyContinue
  return
}
if ($running) { "helper already running (process $($running.ProcessId))"; return }
foreach ($need in $exe, $model) { if (-not (Test-Path $need)) { throw "missing: $need" } }

# Find the discrete AMD card by name among ALL Vulkan devices (2026-11-22): the CPU's built-in "AMD Radeon(TM)
# Graphics" reappeared as Vulkan1 and the user-wide GGML_VK_VISIBLE_DEVICES=1 then pointed at it, so the helper
# ran on the iGPU in system RAM while the RX 580 sat idle. The filter is cleared for this process only.
Remove-Item Env:GGML_VK_VISIBLE_DEVICES -ErrorAction SilentlyContinue
$device = (& $exe --list-devices 2>&1 | Select-String -Pattern '^\s*(Vulkan\d+):\s*(.*Radeon.*\bRX\b.*)$' | Select-Object -First 1)
if (-not $device) { throw 'The AMD RX card was not found. The helper does not start on any other card (not the CPU graphics, not the NVIDIA card).' }
$deviceName = $device.Matches[0].Groups[1].Value

if (-not (Test-Path $keyFile)) {
  # Written to run under Windows PowerShell 5.1 as well (the sign-in shortcut uses it).
  $bytes = New-Object byte[] 32
  $rng = [Security.Cryptography.RandomNumberGenerator]::Create(); $rng.GetBytes($bytes); $rng.Dispose()
  [IO.File]::WriteAllText($keyFile, ([BitConverter]::ToString($bytes) -replace '-', '').ToLowerInvariant())
}

if (Test-Path $log) { Move-Item $log "$log.previous" -Force }
$arguments = @('--model', $model, '--alias', 'nori-helper-9b', '--device', $deviceName, '--n-gpu-layers', '99',
  '--ctx-size', $Context, '--parallel', '1', '--host', '127.0.0.1', '--port', $Port, '--api-key-file', $keyFile, '--no-webui',
  # No copy of the model file in system RAM (2026-11-22): with the default memory map the helper kept ~7-13 GB of RAM
  # while running on the RX 580 (1.3 GB free with it, 14.2 GB without), which starves Nori's main model.
  '--load-mode', 'none')
$p = Start-Process $exe -ArgumentList $arguments -WindowStyle Hidden -PassThru -RedirectStandardError $log -RedirectStandardOutput "$log.out"
Set-Content $pidFile $p.Id -Encoding ascii

$deadline = (Get-Date).AddSeconds(180)
while ((Get-Date) -lt $deadline -and -not $p.HasExited) {
  try { if ((Invoke-RestMethod "http://127.0.0.1:$Port/health" -TimeoutSec 3).status -eq 'ok') { "helper ready on $deviceName, port $Port, process $($p.Id)"; return } } catch {}
  Start-Sleep -Seconds 2
}
if (-not $p.HasExited) { Stop-Process -Id $p.Id -Force }
Remove-Item $pidFile -ErrorAction SilentlyContinue
throw "The helper did not become ready. See $log"
