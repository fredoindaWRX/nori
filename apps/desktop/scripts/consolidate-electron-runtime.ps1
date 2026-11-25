param([switch]$Apply)
$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..\..'))
$source = Join-Path $env:LOCALAPPDATA 'electron\Cache\bfa62fe1b54e5e709b522b5f731c7644136b8ab3a8123f8d2facc4ecf2b925fe\electron-v44.4.5-win32-x64.zip'
$target = Join-Path $root 'runtime\electron\v44.4.5'
$expected = '11C395820A5AAA8EBCC0686B476D0AC98A730274EBFBDC8CF5538A7C2815CB5D'
if ((Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash -ne $expected) { throw 'Cached Electron ZIP checksum differs from the pinned official release.' }
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [IO.Compression.ZipFile]::OpenRead($source)
try {
    if ($archive.Entries.Count -gt 1000) { throw 'Electron archive exceeds file bound.' }
    $bytes = 0L
    $names = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    foreach ($entry in $archive.Entries) {
        $name = $entry.FullName.Replace('/', '\')
        $resolved = [IO.Path]::GetFullPath((Join-Path $target $name))
        if ([IO.Path]::IsPathRooted($name) -or $name.Contains(':') -or -not $resolved.StartsWith($target + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe Electron archive member.' }
        if (-not $names.Add($resolved)) { throw 'Duplicate Electron archive target.' }
        $bytes += $entry.Length
        if ($bytes -gt 1GB) { throw 'Electron archive exceeds byte bound.' }
    }
    if (-not $Apply) { [pscustomobject]@{Action='PLAN';Target=$target;Files=$archive.Entries.Count;Bytes=$bytes;SHA256=$expected}; return }
    if (Test-Path -LiteralPath $target) { throw 'Electron target already exists; no replacement or cleanup was attempted.' }
    $ancestor = Split-Path -Parent $target
    while (-not (Test-Path -LiteralPath $ancestor)) { $ancestor = Split-Path -Parent $ancestor }
    $check = Get-Item -LiteralPath $ancestor
    while ($check.FullName.Length -ge $root.Length) {
        if ($check.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Electron destination ancestor is a link.' }
        if ($check.FullName -eq $root) { break }
        $check = Get-Item -LiteralPath (Split-Path -Parent $check.FullName)
    }
    [IO.Directory]::CreateDirectory($target) | Out-Null
    [IO.Compression.ZipFileExtensions]::ExtractToDirectory($archive, $target)
    $receipt = [ordered]@{version='44.4.5';source=$source;archive_sha256=$expected;target=$target;files=$archive.Entries.Count;bytes=$bytes;checksum_source='https://github.com/electron/electron/releases/download/v44.4.5/SHASUMS256.txt';licenses_retained=$true}
    $receiptPath = Join-Path $target 'nori-runtime-provenance.json'
    $stream = [IO.File]::Open($receiptPath,[IO.FileMode]::CreateNew)
    try { $writer = [IO.StreamWriter]::new($stream); $writer.Write(($receipt | ConvertTo-Json)); $writer.Flush(); $stream.Flush($true) } finally { if ($writer) { $writer.Dispose() }; $stream.Dispose() }
    $receipt | ConvertTo-Json -Compress
} finally { $archive.Dispose() }
