param(
    [Parameter(Mandatory=$true)][string]$Root,
    [Parameter(Mandatory=$true)][ValidatePattern('^[a-fA-F0-9]{64}$')][string]$ExpectedSha256,
    [Parameter(Mandatory=$true)][ValidateRange(1,2147483647)][int]$ExpectedPid,
    [switch]$Apply
)
$ErrorActionPreference = 'Stop'
# Exact orphan recovery only. No process termination, profile copying, ACL
# changes, guardian recovery, launch activation, or backup overwrite.
if (-not [IO.Path]::IsPathRooted($Root) -or $Root.StartsWith('\\')) { throw 'Local absolute state root required.' }
$resolvedRoot = [IO.Path]::GetFullPath($Root).TrimEnd('\')
if ($resolvedRoot.Length -lt 4) { throw 'Drive root recovery refused.' }
Add-Type -TypeDefinition @'
using System;
using System.IO;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;
using Microsoft.Win32.SafeHandles;
public static class NoriOwnerRecovery {
    [StructLayout(LayoutKind.Sequential)] public struct Info {
        public uint Attributes; public System.Runtime.InteropServices.ComTypes.FILETIME Created, Accessed, Written;
        public uint Volume, SizeHigh, SizeLow, Links, IndexHigh, IndexLow;
    }
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
    static extern SafeFileHandle CreateFile(string name,uint access,uint share,IntPtr security,uint creation,uint flags,IntPtr template);
    [DllImport("kernel32.dll", SetLastError=true)] static extern bool GetFileInformationByHandle(SafeFileHandle file,out Info info);
    [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
    static extern uint GetFinalPathNameByHandle(SafeFileHandle file,StringBuilder path,uint size,uint flags);
    [DllImport("kernel32.dll", SetLastError=true)]
    static extern bool SetFileInformationByHandle(SafeFileHandle file,int kind,IntPtr data,uint size);
    public static SafeFileHandle Open(string path,bool directory) {
        // No DELETE sharing: pinned ancestors cannot be renamed/replaced while
        // held. The record itself is exclusively opened with read+rename rights.
        var handle=CreateFile(path,directory?0x80u:0x80010000u,directory?3u:0u,IntPtr.Zero,3,0x02200000,IntPtr.Zero);
        if(handle.IsInvalid) { int e=Marshal.GetLastWin32Error();handle.Dispose();throw new Win32Exception(e,"Exclusive recovery path refused"); }
        try {
            Info info; if(!GetFileInformationByHandle(handle,out info))throw new Win32Exception(Marshal.GetLastWin32Error());
            if((info.Attributes&0x400)!=0 || ((info.Attributes&0x10)!=0)!=directory ||
               (!directory&&(info.SizeHigh!=0||info.SizeLow==0||info.SizeLow>4096||info.Links!=1)))
                throw new IOException("Linked, nonregular, empty, oversized or multiply-linked recovery entry refused");
            var final=new StringBuilder(32768);
            uint length=GetFinalPathNameByHandle(handle,final,(uint)final.Capacity,0);
            if(length==0||length>=final.Capacity)throw new IOException("Recovery final path unavailable");
            string actual=final.ToString(); if(actual.StartsWith(@"\\?\"))actual=actual.Substring(4);
            if(!String.Equals(actual.TrimEnd('\\'),Path.GetFullPath(path).TrimEnd('\\'),StringComparison.OrdinalIgnoreCase))
                throw new IOException("Redirected recovery path refused");
            return handle;
        } catch {handle.Dispose();throw;}
    }
    public static void Rename(SafeFileHandle file,string destination) {
        byte[] name=Encoding.Unicode.GetBytes(destination);
        int nameOffset=IntPtr.Size==8?20:12;
        int length=nameOffset+name.Length+2;
        IntPtr buffer=Marshal.AllocHGlobal(length);
        try {
            Marshal.Copy(new byte[length],0,buffer,length);
            // ReplaceIfExists is FALSE; RootDirectory is null; absolute target.
            Marshal.WriteInt32(buffer,IntPtr.Size==8?16:8,name.Length);
            Marshal.Copy(name,0,IntPtr.Add(buffer,nameOffset),name.Length);
            if(!SetFileInformationByHandle(file,3,buffer,(uint)length))
                throw new Win32Exception(Marshal.GetLastWin32Error(),"Exclusive backup rename refused");
        } finally {Marshal.FreeHGlobal(buffer);}
    }
}
'@
$handles = [Collections.Generic.List[IDisposable]]::new()
$stream = $null
function Assert-OwnerAbsent {
    try {
        $observed = [Diagnostics.Process]::GetProcessById($ExpectedPid)
        try { if (-not $observed.HasExited) { throw 'Recorded owner process is live; preserved.' } }
        finally { $observed.Dispose() }
    } catch [ArgumentException] { return }
}
try {
    $ancestors = [Collections.Generic.List[string]]::new()
    $current = $resolvedRoot
    while ($current) {
        $ancestors.Insert(0,$current)
        $parent = [IO.Directory]::GetParent($current)
        if ($null -eq $parent) { break }
        $current = $parent.FullName
    }
    foreach ($ancestor in $ancestors) { $handles.Add([NoriOwnerRecovery]::Open($ancestor,$true)) }
    $guardian = Join-Path $resolvedRoot '.nori-state-guardian.json'
    if (Test-Path -LiteralPath $guardian) { throw 'State guardian present; recovery refused.' }
    $marker = Join-Path $resolvedRoot '.nori-state-owner.json'
    $handle = [NoriOwnerRecovery]::Open($marker,$false)
    $handles.Add($handle)
    $stream = [IO.FileStream]::new($handle,[IO.FileAccess]::Read,4096,$false)
    $bytes = New-Object byte[] 4097
    $length = 0
    do { $count=$stream.Read($bytes,$length,$bytes.Length-$length);$length+=$count } while ($count -gt 0 -and $length -lt $bytes.Length)
    if ($length -eq 0 -or $length -gt 4096) { throw 'Ownership record exceeded bound.' }
    $sha = [Security.Cryptography.SHA256]::Create()
    try { $actualHash=[BitConverter]::ToString($sha.ComputeHash($bytes,0,$length)).Replace('-','').ToLowerInvariant() }
    finally { $sha.Dispose() }
    if ($actualHash -ne $ExpectedSha256.ToLowerInvariant()) { throw 'Ownership record changed; preserved.' }
    $record = [Text.UTF8Encoding]::new($false,$true).GetString($bytes,0,$length) | ConvertFrom-Json
    $keys = @($record.PSObject.Properties.Name | Sort-Object) -join ','
    $ownerId = [Guid]::Empty
    if ($keys -ne 'owner,pid,purpose,schema' -or $record.schema -ne 1 -or
        $record.pid -ne $ExpectedPid -or $record.purpose -notin @('desktop','core','migration') -or
        -not [Guid]::TryParse([string]$record.owner,[ref]$ownerId)) { throw 'Unsupported ownership record; preserved.' }
    Assert-OwnerAbsent
    if (Test-Path -LiteralPath $guardian) { throw 'State guardian present; recovery refused.' }
    $backup = $null
    if ($Apply) {
        $backup = Join-Path $resolvedRoot ('.nori-state-owner.recovered-'+[Guid]::NewGuid().ToString('N')+'.json')
        Assert-OwnerAbsent
        [NoriOwnerRecovery]::Rename($handle,$backup)
    }
    [pscustomobject]@{Schema=1;OwnerPid=$ExpectedPid;OwnerProcessAbsent=$true;ExactRecordVerified=$true;
        ExclusiveHandleVerified=$true;Applied=[bool]$Apply;BackupPath=$backup;MarkerSha256=$actualHash;
        ProfileCopied=$false;QuiescenceVerified=$false;ActivationAuthorized=$false;SourceRemovalAuthorized=$false} | ConvertTo-Json -Compress
} finally {
    if ($stream) { $stream.Dispose() }
    for ($i=$handles.Count-1;$i -ge 0;$i--) { $handles[$i].Dispose() }
}
