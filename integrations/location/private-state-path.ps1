function Resolve-NoriLocationCredentialRoot {
    param([string]$StateRoot = '', [string]$NoriRoot = (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)))
    # Preserve current pairing until migration is explicitly selected. An
    # explicit consolidated path must never fall back to old/new credentials.
    if (-not $StateRoot) { return Join-Path $env:LOCALAPPDATA 'Nori\location-private' }
    if (-not [IO.Path]::IsPathRooted($StateRoot)) { throw 'Consolidated location state must be absolute.' }
    $root = (Get-Item -LiteralPath $NoriRoot).FullName
    $target = [IO.Path]::GetFullPath($StateRoot)
    $prefix = Join-Path $root 'state\private'
    if (-not $target.StartsWith($prefix + '\', [StringComparison]::OrdinalIgnoreCase)) {
        throw 'Consolidated location state must remain under Nori state/private.'
    }
    $item = Get-Item -LiteralPath $target -Force
    if (-not $item.PSIsContainer) { throw 'Consolidated state is not a directory.' }
    $ancestor = $target
    while ($ancestor) {
        $info = Get-Item -LiteralPath $ancestor -Force
        if ($info.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Linked consolidated state refused.' }
        $next = Split-Path -Parent $ancestor
        if ($next -eq $ancestor) { break }
        $ancestor = $next
    }
    return Join-Path $target 'location-private'
}
