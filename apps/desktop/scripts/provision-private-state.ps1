param(
    [string]$Root = 'C:\Nori',
    [switch]$Apply,
    [switch]$TestOnly,
    [ValidateSet('private','browser')][string]$StorageClass = 'private',
    [string]$ExpectedOwnerSid
)
$ErrorActionPreference = 'Stop'
function Assert-NoriProvisionOwnerContext {
    param([Security.Principal.SecurityIdentifier]$CurrentSid, [bool]$Elevated,
        [string]$ExpectedSid, [bool]$Applying)
    if ($null -eq $CurrentSid -or $CurrentSid.Value -in @('S-1-5-18','S-1-5-19','S-1-5-20')) {
        throw 'Interactive Nori owner context required; no state created.'
    }
    if ($ExpectedSid) {
        $expected = [Security.Principal.SecurityIdentifier]::new($ExpectedSid)
        if ($expected.Value -ne $CurrentSid.Value) {
            throw 'Expected Nori owner differs from current Windows account; no state created.'
        }
    }
    if ($Applying -and $Elevated) {
        throw 'Elevated owner provisioning refused; run under the original non-elevated Nori user. No state created.'
    }
}
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$sid = $identity.User
$elevated = [Security.Principal.WindowsPrincipal]::new($identity).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
# Never accept a caller-selected SID as permission to create somebody else's
# private state. This assertion only binds the executing account; the installer
# must separately establish its original user before invoking this helper.
Assert-NoriProvisionOwnerContext -CurrentSid $sid -Elevated $elevated -ExpectedSid $ExpectedOwnerSid -Applying ([bool]$Apply)
$resolvedRoot = (Get-Item -LiteralPath $Root).FullName
$relative = 'state\' + $StorageClass
if ($TestOnly) { $relative = 'verification\.native-private-acl-' + [Guid]::NewGuid().ToString('N') }
$target = [IO.Path]::GetFullPath((Join-Path $resolvedRoot $relative))
if (-not $target.StartsWith($resolvedRoot + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Private state escapes Nori root.' }
$ancestor = $target
while (-not (Test-Path -LiteralPath $ancestor)) { $ancestor = Split-Path -Parent $ancestor }
while ($ancestor) {
    $item = Get-Item -LiteralPath $ancestor -Force
    if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Private state ancestor is a link.' }
    $next = Split-Path -Parent $ancestor
    if ($next -eq $ancestor) { break }
    $ancestor = $next
}
if (Test-Path -LiteralPath $target) { throw 'Existing private state preserved; provisioning requires a new destination.' }
if (-not $Apply) {
    [pscustomobject]@{Action='PLAN'; Target=$target; OwnerSid=$sid.Value; ExistingStateModified=$false;
        OwnerContextElevated=$elevated; ProvisioningAllowed=(-not $elevated); OriginalInstallerOwnerVerified=$false}
    return
}
$security = [Security.AccessControl.DirectorySecurity]::new()
$security.SetAccessRuleProtection($true, $false)
$security.SetOwner($sid)
foreach ($principal in @($sid, [Security.Principal.SecurityIdentifier]::new('S-1-5-18'), [Security.Principal.SecurityIdentifier]::new('S-1-5-32-544'))) {
    $rule = [Security.AccessControl.FileSystemAccessRule]::new($principal,
        [Security.AccessControl.FileSystemRights]::FullControl,
        [Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit',
        [Security.AccessControl.PropagationFlags]::None,
        [Security.AccessControl.AccessControlType]::Allow)
    $security.AddAccessRule($rule)
}
# Windows PowerShell/.NET Framework creates the directory with its protected
# descriptor, rather than writing secrets into an inherited public directory.
[IO.Directory]::CreateDirectory($target, $security) | Out-Null
$actual = [IO.Directory]::GetAccessControl($target)
$allowed = @($sid.Value, 'S-1-5-18', 'S-1-5-32-544')
if (-not $actual.AreAccessRulesProtected) { throw 'Private ACL inheritance is not protected.' }
$seen = @()
foreach ($rule in $actual.GetAccessRules($true, $true, [Security.Principal.NTAccount])) {
    $principal = $rule.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value
    if ($rule.IsInherited -or $principal -notin $allowed -or $rule.AccessControlType -ne 'Allow') {
        throw 'Private ACL does not match the intended owner/system/administrators policy.'
    }
    if (($rule.FileSystemRights -band [Security.AccessControl.FileSystemRights]::FullControl) -ne [Security.AccessControl.FileSystemRights]::FullControl -or
        $rule.InheritanceFlags -ne [Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit') {
        throw 'Private ACL lacks required directory and child permissions.'
    }
    $seen += $principal
}
if (@($seen | Select-Object -Unique).Count -ne @($allowed | Select-Object -Unique).Count) { throw 'Private ACL principal set is incomplete.' }
if ($actual.GetOwner([Security.Principal.NTAccount]).Value -ne $sid.Translate([Security.Principal.NTAccount]).Value) { throw 'Private folder owner differs from current account.' }
if ($TestOnly) {
    # Exact, freshly created empty test directory only; never recursive cleanup.
    [IO.Directory]::Delete($target, $false)
}
[pscustomobject]@{Action='PROVISIONED'; Target=$target; AclProtected=$true;
    OwnerVerified=$true; TestOnly=[bool]$TestOnly; TestFolderRemoved=[bool]$TestOnly;
    CredentialsCopied=$false; ExistingStateModified=$false;
    OwnerContextElevated=$elevated; ExpectedOwnerMatched=[bool]$ExpectedOwnerSid; OriginalInstallerOwnerVerified=$false}
