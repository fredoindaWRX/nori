function Resolve-NoriLocationRuntime {
    param([string]$NoriRoot = (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)))
    $root = (Get-Item -LiteralPath $NoriRoot).FullName
    $sourceRuntime = Join-Path $root 'runtime\electron\v44.4.5\electron.exe'
    if (Test-Path -LiteralPath $sourceRuntime -PathType Leaf) {
        $target = $sourceRuntime
    } elseif ((Split-Path -Leaf $root) -eq 'NoriSuite' -and
              (Split-Path -Leaf (Split-Path -Parent $root)) -eq 'resources') {
        $target = Join-Path (Split-Path -Parent (Split-Path -Parent $root)) 'Nori.exe'
    } else {
        throw 'Bundled Nori runtime is missing; system Node is not adopted.'
    }
    $info = Get-Item -LiteralPath $target -Force
    if (-not $info.PSIsContainer -and -not ($info.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
        $ancestor = Split-Path -Parent $target
        while ($ancestor) {
            $item = Get-Item -LiteralPath $ancestor -Force
            if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Linked Nori runtime refused.' }
            $next = Split-Path -Parent $ancestor
            if ($next -eq $ancestor) { break }
            $ancestor = $next
        }
        return $info.FullName
    }
    throw 'Bundled Nori runtime is not an unlinked executable.'
}
