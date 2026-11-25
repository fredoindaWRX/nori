param(
    [string]$DesktopRoot = (Split-Path -Parent $PSScriptRoot),
    [string]$ReceiptPath,
    [ValidateRange(1,3600)][int]$VerificationTimeoutSeconds = 300
)
$ErrorActionPreference = 'Stop'
if (-not $ReceiptPath) { $ReceiptPath = Join-Path (Split-Path -Parent $DesktopRoot) 'native-desktop-receipt.json' }
$executable = Join-Path $DesktopRoot 'Nori.exe'
$verifier = Join-Path $PSScriptRoot 'verify-portable-native.mjs'
foreach ($path in @($DesktopRoot, $ReceiptPath, $executable, $verifier)) {
    $item = Get-Item -LiteralPath $path
    if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Linked backup paths are refused.' }
}
$DesktopRoot = (Get-Item -LiteralPath $DesktopRoot).FullName
$ReceiptPath = (Get-Item -LiteralPath $ReceiptPath).FullName
$arguments = @($verifier, $DesktopRoot, $ReceiptPath) | ForEach-Object {
    if ($_ -match '["\r\n]') { throw 'Unsupported backup path.' }
    '"' + $_ + '"'
}
$priorMode = $env:ELECTRON_RUN_AS_NODE
$priorLog = $env:ELECTRON_LOG_FILE
$priorProgress = $env:NORI_VERIFY_PROGRESS
$diagnostic = [IO.Path]::GetTempFileName()
$outputLog = [IO.Path]::GetTempFileName()
$phaseLog = [IO.Path]::GetTempFileName()
$process = $null
try {
    $env:ELECTRON_RUN_AS_NODE = '1'
    $env:ELECTRON_LOG_FILE = $diagnostic
    $env:NORI_VERIFY_PROGRESS = '1'
    $process = Start-Process -FilePath $executable -ArgumentList $arguments -WindowStyle Hidden -PassThru -RedirectStandardOutput $outputLog -RedirectStandardError $phaseLog
    # Retain the exact process handle before it exits; PowerShell 5.1 can
    # otherwise return a null ExitCode from a Start-Process Process object.
    $null = $process.Handle
    $deadline = [DateTime]::UtcNow.AddSeconds($VerificationTimeoutSeconds)
    $seenPhases = @{}
    $reportPhases = {
        if ((Get-Item -LiteralPath $phaseLog).Length -lt 65536) {
            foreach ($line in @(Get-Content -LiteralPath $phaseLog)) {
                if ($line -match '^\{"phase":"(desktop-inventory|desktop-hashes|native-inventory|native-hashes|size-check)","elapsedMs":([0-9]+)\}$' -and -not $seenPhases.ContainsKey($Matches[1])) {
                    $phase = $Matches[1]
                    $seenPhases[$phase] = $true
                    Write-Output "Backup verification phase: $phase ($($Matches[2]) ms)."
                }
            }
        }
    }
    while (-not $process.WaitForExit(1000)) {
        if ([DateTime]::UtcNow -ge $deadline) {
            throw "Backup verification timed out after $VerificationTimeoutSeconds seconds. Owned verifier will be stopped; no installation was attempted."
        }
        . $reportPhases
    }
    $process.WaitForExit()
    # Drain the final phase after process exit too. Short verifiers can finish
    # between polls; otherwise the hash-completion timestamp is lost.
    . $reportPhases
    if ($process.ExitCode -ne 0) { throw "Backup verification failed (exit $($process.ExitCode)). No installation was attempted." }
    if ((Get-Item -LiteralPath $outputLog).Length -gt 65536) { throw 'Backup verification failed: oversized result.' }
    $evidence = Get-Content -LiteralPath $outputLog -Raw | ConvertFrom-Json
    if ($evidence.desktopIntegrityVerified -ne $true -or $evidence.payloadIntegrityVerified -ne $true -or $evidence.releaseVerified -ne $false) {
        throw 'Backup verification failed: missing integrity evidence.'
    }
    Write-Output 'Backup file integrity passed. Installation and full Nori functionality are not certified by this check.'
} finally {
    $env:ELECTRON_RUN_AS_NODE = $priorMode
    $env:ELECTRON_LOG_FILE = $priorLog
    $env:NORI_VERIFY_PROGRESS = $priorProgress
    if ($process -and -not $process.HasExited) { $process.Kill(); $process.WaitForExit() }
    # Exact test-owned temporary file only; never delete package/profile data.
    foreach ($temporary in @($diagnostic, $outputLog, $phaseLog)) {
        if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary }
    }
}
