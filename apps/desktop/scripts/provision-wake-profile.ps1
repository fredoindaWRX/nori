param([Parameter(Mandatory=$true)][string]$Root,[switch]$Apply)
$ErrorActionPreference = 'Stop'
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$sid = $identity.User
if ($sid.Value -in @('S-1-5-18','S-1-5-19','S-1-5-20') -or
    [Security.Principal.WindowsPrincipal]::new($identity).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Use the original non-elevated Nori owner; no wake profile created.'
}
$resolvedRoot = (Get-Item -LiteralPath $Root -Force).FullName
$privateRoot = Join-Path $resolvedRoot 'state\private'
# Verify the existing parent and its physical ancestors before making any child.
& (Join-Path $PSScriptRoot 'verify-private-state-acl.ps1') -Root $privateRoot | Out-Null
$target = Join-Path $privateRoot 'wake'
if (Test-Path -LiteralPath $target) { throw 'Existing wake profile preserved; no changes made.' }
if (-not $Apply) { [pscustomobject]@{Action='PLAN';Target=$target;ExistingStateModified=$false};return }
$security = [Security.AccessControl.DirectorySecurity]::new()
$security.SetAccessRuleProtection($true,$false)
$security.SetOwner($sid)
foreach ($principal in @($sid,[Security.Principal.SecurityIdentifier]::new('S-1-5-18'),[Security.Principal.SecurityIdentifier]::new('S-1-5-32-544'))) {
    $security.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($principal,
        [Security.AccessControl.FileSystemRights]::FullControl,
        [Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit',
        [Security.AccessControl.PropagationFlags]::None,[Security.AccessControl.AccessControlType]::Allow))
}
# CreateDirectoryW is create-exclusive: a racing existing directory is refused,
# never adopted or assigned our permissions after somebody else created it.
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class NoriWakeDirectory {
  [StructLayout(LayoutKind.Sequential)] public struct Attributes {
    public int Length; public IntPtr Descriptor; public int Inherit;
  }
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  public static extern bool CreateDirectoryW(string path, ref Attributes attributes);
}
'@
$descriptor = $security.GetSecurityDescriptorBinaryForm()
$pinned = [Runtime.InteropServices.GCHandle]::Alloc($descriptor,[Runtime.InteropServices.GCHandleType]::Pinned)
try {
    $attributes = [NoriWakeDirectory+Attributes]::new()
    $attributes.Length = [Runtime.InteropServices.Marshal]::SizeOf($attributes)
    $attributes.Descriptor = $pinned.AddrOfPinnedObject()
    if (-not [NoriWakeDirectory]::CreateDirectoryW($target,[ref]$attributes)) {
        throw 'Exclusive protected wake directory creation refused; existing state preserved.'
    }
} finally { $pinned.Free() }
& (Join-Path $PSScriptRoot 'verify-private-state-acl.ps1') -Root $target | Out-Null
[pscustomobject]@{Action='PROVISIONED';Target=$target;AclVerified=$true;ExistingStateModified=$false;StartupEnabled=$false}
