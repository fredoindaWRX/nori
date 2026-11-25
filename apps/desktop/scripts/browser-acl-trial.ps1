param([Parameter(Mandatory=$true)][string]$Root)
$ErrorActionPreference = 'Stop'
$fixture = Get-Item -LiteralPath $Root -Force
if (-not $fixture.PSIsContainer -or -not $fixture.Name.StartsWith('nori-browser-acl-') -or
    ($fixture.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Synthetic browser ACL fixture required.' }
& (Join-Path $PSScriptRoot 'provision-private-state.ps1') -Root $fixture.FullName -Apply -StorageClass browser | Out-Null
$browser = Join-Path $fixture.FullName 'state\browser'
$verify = Join-Path $PSScriptRoot 'verify-browser-state-acl.ps1'
. (Join-Path $PSScriptRoot 'browser-capability-sid.ps1')
$capability = [Security.Principal.SecurityIdentifier]::new([NoriBrowserCapabilityNative]::GetNetworkSid())
$network = [IO.Directory]::CreateDirectory((Join-Path $browser 'Network')).FullName
$privateLike = [IO.Directory]::CreateDirectory((Join-Path $browser 'Local Storage')).FullName
function Add-TrialRule($path,$principal,$rights,$expectedError,$accessType='Allow') {
    $acl = [IO.Directory]::GetAccessControl($path)
    $original = $acl.GetSecurityDescriptorSddlForm([Security.AccessControl.AccessControlSections]::Access)
    $rule = [Security.AccessControl.FileSystemAccessRule]::new($principal,
        [Security.AccessControl.FileSystemRights]$rights,[Security.AccessControl.InheritanceFlags]::None,
        [Security.AccessControl.PropagationFlags]::None,[Security.AccessControl.AccessControlType]$accessType)
    $acl.AddAccessRule($rule)
    [IO.Directory]::SetAccessControl($path,$acl)
    try {
        if ($expectedError) {
            $rejected = $false
            try { & $verify -Root $browser | Out-Null }
            catch { if ($_.Exception.Message -notmatch $expectedError) { throw }; $rejected=$true }
            if (-not $rejected) { throw 'Synthetic unexpected ACL was accepted.' }
        } else { & $verify -Root $browser | Out-Null }
    } finally {
        $restored = [Security.AccessControl.DirectorySecurity]::new()
        $restored.SetSecurityDescriptorSddlForm($original,[Security.AccessControl.AccessControlSections]::Access)
        [IO.Directory]::SetAccessControl($path,$restored)
    }
}
& $verify -Root $browser | Out-Null
Add-TrialRule $network $capability 1245631 $null
Add-TrialRule $network $capability ([int][Security.AccessControl.FileSystemRights]::FullControl) 'permissions'
Add-TrialRule $browser $capability 1245631 'outside approved'
Add-TrialRule $privateLike $capability 1245631 'outside approved'
Add-TrialRule $network ([Security.Principal.SecurityIdentifier]::new('S-1-1-0')) 1245631 'principal'
Add-TrialRule $network ([Security.Principal.SecurityIdentifier]::new('S-1-15-3-1')) 1245631 'principal'
Add-TrialRule $network $capability 1245631 'denial' 'Deny'
& $verify -Root $browser | Out-Null
[pscustomobject]@{SyntheticBrowserAclTrial=$true;ReadOnlyVerifier=$true;ForeignPrincipalRejected=$true;
    WidenedCapabilityRejected=$true;OutsideScopeRejected=$true;ActivationAuthorized=$false} | ConvertTo-Json -Compress
