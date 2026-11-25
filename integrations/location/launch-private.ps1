param([switch]$InitializeOnly, [switch]$VerifyNative, [string]$PrivateHost = '', [string]$StateRoot = '')
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'private-state-path.ps1')
$credentialRoot = Resolve-NoriLocationCredentialRoot -StateRoot $StateRoot
$credentialFile = Join-Path $credentialRoot 'credentials.clixml'
if ($StateRoot -and -not (Test-Path -LiteralPath $credentialFile -PathType Leaf)) {
    throw 'Consolidated pairing credentials are missing. Migrate the existing credential file under the same Windows account; no new credentials were created.'
}
$receiverSource = Join-Path $PSScriptRoot 'start.mjs'
. (Join-Path $PSScriptRoot 'runtime-path.ps1')
$nodePath = Resolve-NoriLocationRuntime
if ($VerifyNative -and -not (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'probe-native.mjs') -PathType Leaf)) {
    throw 'Native location integration probe is not included in this package. Verification was not performed; credentials were not changed.'
}
if ($PrivateHost -and $PrivateHost -notmatch '^[a-z0-9-]+\.[a-z0-9-]+\.ts\.net$') { throw 'Invalid private tailnet hostname.' }
if (-not (Test-Path -LiteralPath $nodePath -PathType Leaf)) { throw 'Node runtime is unavailable.' }
if ($VerifyNative -and (-not (Test-Path -LiteralPath $credentialRoot -PathType Container) -or
                        -not (Test-Path -LiteralPath $credentialFile -PathType Leaf))) {
    throw 'Verification requires existing pairing credentials. No credentials were created or changed.'
}
function Test-LocationListener {
    # Do not rely on NetTCPIP module auto-loading in a bundled-runtime child.
    return @([Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties().GetActiveTcpListeners() |
        Where-Object { $_.Port -eq 8791 }).Count -gt 0
}
if (-not $VerifyNative -and (Test-LocationListener)) {
    throw 'A receiver is already listening. Stop the existing receiver before initializing or launching; credentials have not been changed.'
}
if (Test-Path -LiteralPath $credentialRoot) {
    if ((Get-Item -LiteralPath $credentialRoot).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Credential directory must not be a link.' }
} else { New-Item -ItemType Directory -Path $credentialRoot | Out-Null }
$identitySid = [Security.Principal.WindowsIdentity]::GetCurrent().User
$existingAcl = [IO.Directory]::GetAccessControl($credentialRoot)
$accessRules = @($existingAcl.Access)
$alreadyPrivate = $existingAcl.AreAccessRulesProtected -and $accessRules.Count -eq 1 -and
    $accessRules[0].IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value -eq $identitySid.Value -and
    $accessRules[0].AccessControlType -eq [Security.AccessControl.AccessControlType]::Allow -and
    $accessRules[0].FileSystemRights -eq [Security.AccessControl.FileSystemRights]::FullControl
if (-not $alreadyPrivate -and -not $VerifyNative) {
    $directoryAcl = $existingAcl
    $directoryAcl.SetAccessRuleProtection($true, $false)
    foreach ($existingRule in @($directoryAcl.Access)) { $directoryAcl.RemoveAccessRuleSpecific($existingRule) }
    $rule = New-Object Security.AccessControl.FileSystemAccessRule($identitySid, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
    $directoryAcl.AddAccessRule($rule)
    [IO.Directory]::SetAccessControl($credentialRoot, $directoryAcl)
}

if (-not (Test-Path -LiteralPath $credentialFile) -and -not $VerifyNative) {
    $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
    try {
        $bundle = @{}
        foreach ($role in @('phone','owner')) {
            $secretBytes = New-Object byte[] 32
            $rng.GetBytes($secretBytes)
            $secretText = ([BitConverter]::ToString($secretBytes)).Replace('-', '').ToLowerInvariant()
            $secure = [Security.SecureString]::new()
            foreach ($character in $secretText.ToCharArray()) { $secure.AppendChar($character) }
            $secure.MakeReadOnly()
            $bundle[$role] = New-Object Management.Automation.PSCredential($role, $secure)
            [Array]::Clear($secretBytes, 0, $secretBytes.Length)
            $secretText = $null
        }
        # Windows Export-Clixml protects SecureString values with user-bound DPAPI.
        $bundle | Export-Clixml -LiteralPath $credentialFile
    } finally { $rng.Dispose() }
}
$info = Get-Item -LiteralPath $credentialFile
if ($info.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Credential file must not be a link.' }
$saved = Import-Clixml -LiteralPath $credentialFile
if ($saved.phone -isnot [Management.Automation.PSCredential] -or $saved.owner -isnot [Management.Automation.PSCredential]) { throw 'Invalid location credentials.' }
if ($InitializeOnly) {
    Write-Output 'Location credentials initialized and readable by this Windows account. Receiver not started; sharing remains off.'
    exit 0
}
$previousPhone = $env:NORI_LOCATION_PHONE_PASSWORD
$previousOwner = $env:NORI_LOCATION_OWNER_PASSWORD
$previousHost = $env:NORI_LOCATION_PRIVATE_HOST
$previousLocationUrl = $env:NORI_LOCATION_URL
$previousRunAsNode = $env:ELECTRON_RUN_AS_NODE
try {
    $env:ELECTRON_RUN_AS_NODE = '1'
    $env:NORI_LOCATION_PHONE_PASSWORD = $saved.phone.GetNetworkCredential().Password
    $env:NORI_LOCATION_OWNER_PASSWORD = $saved.owner.GetNetworkCredential().Password
    $env:NORI_LOCATION_PRIVATE_HOST = $PrivateHost
    if ($VerifyNative) {
        $env:NORI_LOCATION_URL = 'http://127.0.0.1:8791'
        & $nodePath (Join-Path $PSScriptRoot 'probe-native.mjs')
        if ($LASTEXITCODE -ne 0) { throw 'Native location probe failed.' }
        return
    }
    if (Test-LocationListener) { throw 'A receiver is already listening; refusing to launch a duplicate.' }
    # Start-Process joins ArgumentList into a command line; quote paths for
    # Program Files installations rather than splitting the module filename.
    $child = Start-Process -FilePath $nodePath -ArgumentList @('"' + $receiverSource + '"') -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -PassThru
    Write-Output "Location receiver launched as process $($child.Id). Loopback only; sharing starts paused."
} finally {
    $env:NORI_LOCATION_PHONE_PASSWORD = $previousPhone
    $env:NORI_LOCATION_OWNER_PASSWORD = $previousOwner
    $env:NORI_LOCATION_PRIVATE_HOST = $previousHost
    $env:NORI_LOCATION_URL = $previousLocationUrl
    $env:ELECTRON_RUN_AS_NODE = $previousRunAsNode
}
