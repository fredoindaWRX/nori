param(
  [switch]$CheckOnly
)

$ErrorActionPreference = 'Stop'
$candidate = 'remote-access-shell-20261009-v25'
$appRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\release\native-desktop-$candidate\win-unpacked"))
$exe = Join-Path $appRoot 'Nori.exe'
$receiptPath = Join-Path (Split-Path $appRoot -Parent) 'native-desktop-receipt.json'

if (-not (Test-Path -LiteralPath $exe -PathType Leaf)) {
  throw "Remote-only Nori executable is missing: $exe"
}
if (-not (Test-Path -LiteralPath $receiptPath -PathType Leaf)) {
  throw "Remote-only Nori package receipt is missing: $receiptPath"
}
$receipt = Get-Content -LiteralPath $receiptPath -Raw | ConvertFrom-Json
if ($receipt.candidate -ne $candidate -or $receipt.packagedPayloadMatches -ne $true) {
  throw 'Remote-only Nori package identity or payload verification failed.'
}

if ($CheckOnly) {
  [pscustomobject]@{
    Candidate = $candidate
    Executable = $exe
    PayloadVerified = $receipt.packagedPayloadMatches
    RemoteControlOnly = $true
    LaunchPerformed = $false
  }
  exit 0
}

$env:NORI_REMOTE_CONTROL_ONLY = '1'
$env:NORI_ALLOW_WRITES = '0'
$env:NORI_INFERENCE_RUNTIME = 'norllama'
$env:NORI_MINI_AUTO_MODEL = '1'
Start-Process -FilePath $exe -WorkingDirectory $appRoot
