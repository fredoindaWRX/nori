param([ValidateSet('status','enable','pause')][string]$Action = 'status', [string]$StateRoot = '')
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'private-state-path.ps1')
$credentialRoot = Resolve-NoriLocationCredentialRoot -StateRoot $StateRoot
$credentialFile = Join-Path $credentialRoot 'credentials.clixml'
foreach ($credentialTarget in @($credentialRoot, $credentialFile)) {
    if ((Get-Item -LiteralPath $credentialTarget).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Refusing linked credential storage.' }
}
$saved = Import-Clixml -LiteralPath $credentialFile
if ($saved.owner -isnot [Management.Automation.PSCredential] -or $saved.owner.UserName -ne 'owner') { throw 'Invalid owner credential.' }
$authorization = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes('owner:' + $saved.owner.GetNetworkCredential().Password))
try {
    $headers = @{ Authorization = 'Basic ' + $authorization }
    if ($Action -ne 'status') {
        $result = Invoke-RestMethod -Uri 'http://127.0.0.1:8791/location/control' -Method Post -Headers $headers -ContentType 'application/json' -Body (@{action=$Action} | ConvertTo-Json -Compress) -TimeoutSec 5
        $expected = $Action -eq 'enable'
        if ($result.enabled -isnot [bool] -or $result.enabled -ne $expected) { throw 'Receiver did not confirm the requested state.' }
    }
    $state = Invoke-RestMethod -Uri 'http://127.0.0.1:8791/location/current' -Method Get -Headers $headers -TimeoutSec 5
    if ($state.enabled -isnot [bool]) { throw 'Invalid receiver status.' }
    # Never print coordinates, timestamps, passwords or raw receiver responses.
    [pscustomobject]@{SharingEnabled=$state.enabled;HasLatestUpdate=($null -ne $state.location);Stale=$state.stale}
    if ($Action -eq 'pause') { Write-Output 'Receiver paused and latest location cleared. Pause monitoring in OwnTracks separately to stop phone GPS updates.' }
} finally {
    $authorization = $null; $headers = $null; $saved = $null; $state = $null; $result = $null
}
