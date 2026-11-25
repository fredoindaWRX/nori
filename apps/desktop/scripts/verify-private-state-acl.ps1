param([Parameter(Mandatory=$true)][string]$Root)
$ErrorActionPreference = 'Stop'
$rootItem = Get-Item -LiteralPath $Root -Force
if (-not $rootItem.PSIsContainer) { throw 'Private ACL root is not a directory.' }
$ancestor = $rootItem.FullName
while ($ancestor) {
    if ((Get-Item -LiteralPath $ancestor -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Linked private state refused.' }
    $next = Split-Path -Parent $ancestor
    if ($next -eq $ancestor) { break }
    $ancestor = $next
}
$sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$allowed = @($sid, 'S-1-5-18', 'S-1-5-32-544')
$count = 0
function Test-PrivateEntry($item, $isRoot) {
    if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Linked private state refused.' }
    if ($item.PSIsContainer) { $acl = [IO.Directory]::GetAccessControl($item.FullName) }
    else { $acl = [IO.File]::GetAccessControl($item.FullName) }
    if ($isRoot -and -not $acl.AreAccessRulesProtected) { throw 'Private ACL root is not protected.' }
    if ($acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $sid) { throw 'Private entry owner differs from current account.' }
    $seen = @()
    foreach ($rule in $acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])) {
        $principal = $rule.IdentityReference.Value
        if ($principal -notin $allowed -or $rule.AccessControlType -ne 'Allow') { throw 'Unexpected private ACL principal or denial.' }
        if (($rule.FileSystemRights -band [Security.AccessControl.FileSystemRights]::FullControl) -ne [Security.AccessControl.FileSystemRights]::FullControl) { throw 'Private ACL permissions incomplete.' }
        if ($item.PSIsContainer -and ($rule.InheritanceFlags -ne [Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit' -or
            $rule.PropagationFlags -ne [Security.AccessControl.PropagationFlags]::None)) { throw 'Private ACL child inheritance incomplete.' }
        $seen += $principal
    }
    if (@($seen | Select-Object -Unique).Count -ne $allowed.Count) { throw 'Private ACL principal set incomplete.' }
    $script:count++
    if ($item.PSIsContainer) {
        foreach ($child in Get-ChildItem -LiteralPath $item.FullName -Force) { Test-PrivateEntry $child $false }
    }
}
Test-PrivateEntry $rootItem $true
[pscustomobject]@{AclVerified=$true; EntriesVerified=$count; StateModified=$false; ActivationAuthorized=$false}
