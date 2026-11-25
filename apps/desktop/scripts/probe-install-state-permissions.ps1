param([string]$Root = 'C:\Nori')
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

# Disposable permission contract probe only. Never provision the real install,
# copy owner state or elevate. Restoration/cleanup targets only our new fixture.
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
if ($principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Run the permission probe with a non-elevated Windows token'
}
$rootItem = Get-Item -LiteralPath $Root -Force
if (-not $rootItem.PSIsContainer) { throw 'Nori root must be a directory' }
$verification = Join-Path $rootItem.FullName 'verification'
$ancestor = Get-Item -LiteralPath $verification -Force
while ($null -ne $ancestor) {
    if (($ancestor.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Linked probe ancestor refused' }
    $parent = [IO.Directory]::GetParent($ancestor.FullName)
    if ($null -eq $parent) { break }
    $ancestor = Get-Item -LiteralPath $parent.FullName -Force
}
$target = [IO.Path]::GetFullPath((Join-Path $verification ('.install-state-permissions-' + [Guid]::NewGuid().ToString('N'))))
if (-not $target.StartsWith($verification.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase) -or
    (Test-Path -LiteralPath $target)) { throw 'Permission probe requires a fresh contained target' }
$sid = $identity.User
function Descriptor([Security.AccessControl.FileSystemRights]$OwnerRights) {
    $acl = [Security.AccessControl.DirectorySecurity]::new()
    $acl.SetAccessRuleProtection($true, $false)
    $acl.SetOwner($sid)
    foreach ($entry in @(
        @($sid, $OwnerRights),
        @([Security.Principal.SecurityIdentifier]::new('S-1-5-18'), [Security.AccessControl.FileSystemRights]::FullControl),
        @([Security.Principal.SecurityIdentifier]::new('S-1-5-32-544'), [Security.AccessControl.FileSystemRights]::FullControl)
    )) {
        $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($entry[0], $entry[1],
            [Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit',
            [Security.AccessControl.PropagationFlags]::None, [Security.AccessControl.AccessControlType]::Allow))
    }
    return $acl
}
function Assert-WriteDenied([string]$Path) {
    $denied = $false
    try { [IO.File]::WriteAllText($Path, 'must not write') }
    catch [UnauthorizedAccessException] { $denied = $true }
    if (-not $denied) { throw 'Standard account unexpectedly wrote outside private state' }
}
$originalAcl = $null
$created = $false
$passed = $false
try {
    [IO.Directory]::CreateDirectory($target, (Descriptor ([Security.AccessControl.FileSystemRights]::FullControl))) | Out-Null
    $created = $true
    $originalAcl = [IO.Directory]::GetAccessControl($target)
    $models = Join-Path $target 'models'
    [IO.Directory]::CreateDirectory($models) | Out-Null
    $private = Join-Path $target 'state\private'
    [IO.Directory]::CreateDirectory($private, (Descriptor ([Security.AccessControl.FileSystemRights]::FullControl))) | Out-Null
    $executable = Join-Path $target 'Nori.exe'
    $model = Join-Path $models 'synthetic.gguf'
    [IO.File]::WriteAllText($executable, 'synthetic executable bytes; never launch')
    [IO.File]::WriteAllText($model, 'synthetic model bytes; never load')
    [IO.Directory]::SetAccessControl($target, (Descriptor ([Security.AccessControl.FileSystemRights]::ReadAndExecute)))
    Assert-WriteDenied (Join-Path $target 'unauthorized-new-file')
    Assert-WriteDenied $executable
    Assert-WriteDenied $model
    if ([IO.File]::ReadAllText($executable) -ne 'synthetic executable bytes; never launch' -or
        [IO.File]::ReadAllText($model) -ne 'synthetic model bytes; never load') { throw 'Protected fixture changed' }
    $core = Join-Path $private 'core'
    $desktop = Join-Path $private 'desktop'
    [IO.Directory]::CreateDirectory($core) | Out-Null
    [IO.Directory]::CreateDirectory($desktop) | Out-Null
    [IO.File]::WriteAllText((Join-Path $core 'synthetic-memory.json'), '{"synthetic":true}')
    [IO.File]::WriteAllText((Join-Path $desktop 'synthetic-settings.json'), '{"synthetic":true}')
    & (Join-Path $PSScriptRoot 'verify-private-state-acl.ps1') -Root $private | Out-Null
    $passed = $true
} finally {
    if ($created) {
        # We still own this fixture, so Windows permits restoring its DACL.
        # No ACL on the user's real Nori tree, model or profile is modified.
        if ($null -ne $originalAcl) {
            $restored = [IO.Directory]::GetAccessControl($target)
            $restored.SetSecurityDescriptorBinaryForm($originalAcl.GetSecurityDescriptorBinaryForm(),
                [Security.AccessControl.AccessControlSections]::Access)
            [IO.Directory]::SetAccessControl($target, $restored)
        }
        $resolved = [IO.Path]::GetFullPath($target)
        if (-not $resolved.StartsWith($verification.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase) -or
            [IO.Path]::GetFileName($resolved) -notmatch '^\.install-state-permissions-[a-f0-9]{32}$' -or
            ((Get-Item -LiteralPath $resolved -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
            throw 'Permission fixture cleanup target changed; preserve for review'
        }
        [IO.Directory]::Delete($resolved, $true)
    }
}
[ordered]@{ passed = $passed; elevated = $false; privateWritesVerified = $true;
    executableWriteDenied = $true; modelWriteDenied = $true; privateAclVerified = $true;
    fixtureRemoved = -not (Test-Path -LiteralPath $target); installedSuiteVerified = $false;
    ownerStateUsed = $false; activationAuthorized = $false } | ConvertTo-Json -Compress
