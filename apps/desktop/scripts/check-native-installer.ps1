param(
    [string]$Directory = $PSScriptRoot,
    [string]$ReceiptPath = ''
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# Read-only corruption check using Windows PowerShell 5.1 and .NET only.
# No setup launch, execution-policy change, repair, deletion or network request.
function Assert-PlainPath([string]$Path, [bool]$IsDirectory) {
    $absolute = [IO.Path]::GetFullPath($Path)
    if ($absolute.StartsWith('\\')) { throw 'Network installer paths are not supported by this local checker' }
    $item = Get-Item -LiteralPath $absolute -Force
    if ($item.PSIsContainer -ne $IsDirectory) { throw 'Unexpected installer path type' }
    $current = $item
    while ($null -ne $current) {
        if (($current.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
            throw 'Linked installer paths are refused'
        }
        $parent = [IO.Directory]::GetParent($current.FullName)
        if ($null -eq $parent) { break }
        $current = Get-Item -LiteralPath $parent.FullName -Force
    }
    return $item
}

function Test-Manifest($Manifest, [string[]]$Required, [string]$Root) {
    if ($null -eq $Manifest -or ($Manifest.schema_version -isnot [int] -and $Manifest.schema_version -isnot [long]) -or
        $Manifest.schema_version -ne 1 -or $Manifest.algorithm -cne 'sha256' -or
        $Manifest.files -isnot [Array] -or $Manifest.files.Count -ne $Required.Count -or $Required.Count -eq 0) {
        throw 'Invalid installer component manifest'
    }
    $expected = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    foreach ($name in $Required) { if (-not $expected.Add($name)) { throw 'Duplicate required installer file' } }
    $seen = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    [long]$bytes = 0
    foreach ($entry in $Manifest.files) {
        if ($null -eq $entry -or $entry.path -isnot [string] -or -not $expected.Contains($entry.path) -or
            -not $seen.Add($entry.path) -or
            ($entry.bytes -isnot [int] -and $entry.bytes -isnot [long]) -or $entry.bytes -le 0 -or
            $entry.sha256 -isnot [string] -or $entry.sha256 -cnotmatch '^[a-f0-9]{64}$') {
            throw 'Invalid installer component entry or required file set'
        }
        # Membership in the explicitly enumerated leaf-name set prevents
        # traversal, alternate streams and arbitrary receipt-selected paths.
        $file = Assert-PlainPath (Join-Path $Root $entry.path) $false
        if ($file.Length -ne $entry.bytes) { throw ('Component size mismatch: ' + $entry.path) }
        $stream = [IO.File]::OpenRead($file.FullName)
        $sha = [Security.Cryptography.SHA256]::Create()
        try {
            if ($stream.Length -ne $entry.bytes) { throw ('Component size mismatch: ' + $entry.path) }
            $hash = [BitConverter]::ToString($sha.ComputeHash($stream)).Replace('-', '').ToLowerInvariant()
        } finally {
            $sha.Dispose()
            $stream.Dispose()
        }
        if ($hash -cne $entry.sha256) { throw ('Component integrity mismatch: ' + $entry.path) }
        $bytes += $entry.bytes
        if ($bytes -ge 128000000000) { throw 'Installer exceeds the Nori size limit' }
    }
    return $bytes
}

try {
    $root = (Assert-PlainPath $Directory $true).FullName
    if ([string]::IsNullOrEmpty($ReceiptPath)) { $ReceiptPath = Join-Path $root 'native-installer-receipt.json' }
    $receiptFile = Assert-PlainPath $ReceiptPath $false
    if ($receiptFile.Length -eq 0 -or $receiptFile.Length -gt 2097152) { throw 'Unsafe installer receipt size' }
    $receipt = Get-Content -LiteralPath $receiptFile.FullName -Raw -Encoding UTF8 | ConvertFrom-Json
    if (($receipt.schema -isnot [int] -and $receipt.schema -isnot [long]) -or $receipt.schema -ne 1 -or
        $receipt.compiled -isnot [bool] -or $receipt.compiled -ne $true -or
        $receipt.setupLaunched -isnot [bool] -or $receipt.setupLaunched -ne $false -or
        $receipt.candidate -isnot [string] -or $receipt.candidate -cnotmatch '^[a-z0-9][a-z0-9-]{0,63}$' -or
        $receipt.installerRecipeSha256 -isnot [string] -or $receipt.installerRecipeSha256 -cnotmatch '^[a-f0-9]{64}$') {
        throw 'Invalid native installer build receipt'
    }
    $stem = 'Nori-Native-Suite-Setup-x64'
    $slicePattern = '^' + [regex]::Escape($stem) + '-[1-9][0-9]*[a-z]?\.bin$'
    $tools = @('verify-native-installer.mjs', 'component-integrity.mjs', 'check-native-installer.ps1')
    $auxiliary = @('native-installer-receipt.json') + $tools
    $paths = @(Get-ChildItem -LiteralPath $root -Force | Where-Object { $_.Name -cnotin $auxiliary } | ForEach-Object { $_.Name })
    if ($paths -cnotcontains ($stem + '.exe') -or
        ($paths -cnotcontains ($stem + '-1a.bin') -and $paths -cnotcontains ($stem + '-1.bin')) -or
        @($paths | Where-Object { $_ -cne ($stem + '.exe') -and $_ -cnotmatch $slicePattern }).Count -ne 0) {
        throw 'Installer executable or first disk slice missing, or unexpected output present'
    }
    [long]$total = (Test-Manifest $receipt.manifest $paths $root) + (Test-Manifest $receipt.verifierManifest $tools $root)
    if ($total -ge 128000000000) { throw 'Installer exceeds the Nori size limit' }
    [ordered]@{ installerIntegrityVerified = $true; verifierIntegrityVerified = $true; files = $paths.Count;
        totalBytes = $total; sourceTreeRequired = $false; additionalRuntimeRequired = $false;
        publisherAuthenticated = $false; extractionVerified = $false;
        installedSuiteVerified = $false; releaseVerified = $false } | ConvertTo-Json -Compress
    exit 0
} catch {
    [ordered]@{ verified = $false; error = $_.Exception.Message } | ConvertTo-Json -Compress | Write-Output
    exit 1
}
