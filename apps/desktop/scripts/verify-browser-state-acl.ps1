param([Parameter(Mandatory=$true)][string]$Root)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'browser-capability-sid.ps1')
$capability = [NoriBrowserCapabilityNative]::GetNetworkSid()
$rootItem = Get-Item -LiteralPath $Root -Force
if (-not $rootItem.PSIsContainer) { throw 'Browser ACL root is not a directory.' }
$ancestor = $rootItem.FullName
while ($ancestor) {
    if ((Get-Item -LiteralPath $ancestor -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Linked browser state refused.' }
    $next = Split-Path -Parent $ancestor
    if ($next -eq $ancestor) { break }
    $ancestor = $next
}
$sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$allowed = @($sid, 'S-1-5-18', 'S-1-5-32-544')
$scopes = @('Network', 'Cache', 'Shared Dictionary')
$count = 0
$capabilityRules = 0
function Test-BrowserEntry($item, $isRoot) {
    if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Linked browser state refused.' }
    if ($item.PSIsContainer) { $acl = [IO.Directory]::GetAccessControl($item.FullName) }
    else { $acl = [IO.File]::GetAccessControl($item.FullName) }
    if ($isRoot -and -not $acl.AreAccessRulesProtected) { throw 'Browser ACL root is not protected.' }
    if ($acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $sid) { throw 'Browser owner differs from current account.' }
    $relative = if ($isRoot) { '' } else { $item.FullName.Substring($rootItem.FullName.Length + 1) }
    $scope = ($relative -split '\\')[0]
    $seen = @()
    foreach ($rule in $acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])) {
        $principal = $rule.IdentityReference.Value
        if ($rule.AccessControlType -ne 'Allow') { throw 'Unexpected browser ACL denial.' }
        if ($principal -eq $capability) {
            if ($isRoot -or $scope -notin $scopes) { throw 'Chromium capability outside approved browser scopes.' }
            # Only the exact ACE forms observed from Chromium152/Electron44.4.5.
            # Never grant ownership/DACL control, arbitrary named capabilities,
            # or shared Chromium access to Nori-native private folders.
            $rights = [int64]$rule.FileSystemRights
            $direct = $rights -eq 1245631 -and $rule.InheritanceFlags -eq 'None' -and $rule.PropagationFlags -eq 'None'
            $inheritable = $item.PSIsContainer -and $rights -eq -536805376 -and
                $rule.InheritanceFlags -eq [Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit' -and
                $rule.PropagationFlags -eq [Security.AccessControl.PropagationFlags]::InheritOnly
            if (-not ($direct -or $inheritable)) { throw 'Unexpected Chromium capability permissions.' }
            $script:capabilityRules++
            continue
        }
        if ($principal -notin $allowed) { throw 'Unexpected browser ACL principal.' }
        if (($rule.FileSystemRights -band [Security.AccessControl.FileSystemRights]::FullControl) -ne [Security.AccessControl.FileSystemRights]::FullControl) {
            throw 'Browser base permissions incomplete.'
        }
        if ($item.PSIsContainer -and ($rule.InheritanceFlags -ne [Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit' -or
            $rule.PropagationFlags -ne [Security.AccessControl.PropagationFlags]::None)) { throw 'Browser base inheritance incomplete.' }
        $seen += $principal
    }
    if (@($seen | Select-Object -Unique).Count -ne $allowed.Count) { throw 'Browser base principal set incomplete.' }
    $script:count++
    if ($item.PSIsContainer) { foreach ($child in Get-ChildItem -LiteralPath $item.FullName -Force) { Test-BrowserEntry $child $false } }
}
Test-BrowserEntry $rootItem $true
[pscustomobject]@{BrowserAclVerified=$true;EntriesVerified=$count;CapabilityRulesVerified=$capabilityRules;
    SharedChromiumCapability=$true;NativePrivatePolicyVerified=$false;StateModified=$false;ActivationAuthorized=$false}
