param([ValidatePattern('^[a-zA-Z0-9_\\-]+$')][string]$BuildDirectory = 'builds\phase1')
$ErrorActionPreference = 'Stop'
$neuraleseCompilerSetup = 'C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat'
$neuraleseCuda = 'C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA\v13.3\bin\nvcc.exe'
foreach ($neuraleseDependency in @($neuraleseCompilerSetup, $neuraleseCuda)) {
    if (-not (Test-Path -LiteralPath $neuraleseDependency -PathType Leaf)) { throw "Existing compiler missing: $neuraleseDependency" }
}
$neuraleseBuildRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot $BuildDirectory))
if (-not $neuraleseBuildRoot.StartsWith($PSScriptRoot + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Build must remain inside the experiment.' }
if (Test-Path -LiteralPath $neuraleseBuildRoot) { throw 'Existing build directory preserved; choose a fresh name.' }
New-Item -ItemType Directory -Path $neuraleseBuildRoot | Out-Null
$neuraleseSourceRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..\engine\norama\src'))
$neuraleseProjectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
function Get-NeuraleseSourceHashes {
    $neuraleseHashes = [ordered]@{}
    $neuraleseFiles = @(
        Get-ChildItem -LiteralPath $neuraleseSourceRoot -File | Where-Object { $_.Extension -in @('.hpp','.cuh') }
        Get-Item -LiteralPath (Join-Path $neuraleseSourceRoot 'gpu_engine.cu'), (Join-Path $neuraleseSourceRoot 'resident_matrix.cu')
        Get-Item -LiteralPath (Join-Path $PSScriptRoot 'probe.cu'), (Join-Path $PSScriptRoot 'baseline.cu'), $PSCommandPath
    )
    foreach ($neuraleseInput in ($neuraleseFiles | Sort-Object FullName -Unique)) {
        $neuraleseRelative = $neuraleseInput.FullName.Substring($neuraleseProjectRoot.Length + 1)
        $neuraleseHashes[$neuraleseRelative] = (Get-FileHash -LiteralPath $neuraleseInput.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
    }
    return $neuraleseHashes
}
$neuraleseSourceBefore = Get-NeuraleseSourceHashes
$neuraleseCompilerBefore = [ordered]@{
    cuda_path = $neuraleseCuda
    cuda_sha256 = (Get-FileHash -LiteralPath $neuraleseCuda).Hash.ToLowerInvariant()
    setup_path = $neuraleseCompilerSetup
    setup_sha256 = (Get-FileHash -LiteralPath $neuraleseCompilerSetup).Hash.ToLowerInvariant()
}
$neuraleseRecipes = [ordered]@{}
Push-Location -LiteralPath $neuraleseBuildRoot
try {
    # Isolated binary; never replaces the production worker or installed Nori.
    foreach ($neuraleseMode in @('baseline', 'probe')) {
        $neuraleseDefine = if ($neuraleseMode -eq 'probe') { '-DNORI_EXPERIMENTAL_NEURALESE' } else { '' }
        $neuraleseSource = Join-Path $PSScriptRoot ($neuraleseMode + '.cu')
        $neuraleseCommand = "`"$neuraleseCuda`" -std=c++17 -Xcompiler=/O2 $neuraleseDefine -arch=sm_89 `"$neuraleseSourceRoot\gpu_engine.cu`" `"$neuraleseSourceRoot\resident_matrix.cu`" `"$neuraleseSource`" -o neuralese-$neuraleseMode.exe -lpsapi"
        $neuraleseRecipes[$neuraleseMode] = $neuraleseCommand
        & cmd.exe /d /c "`"$neuraleseCompilerSetup`" && $neuraleseCommand"
        if ($LASTEXITCODE -ne 0) { throw 'Isolated build failed; production binary unchanged.' }
    }
    $neuraleseSourceAfter = Get-NeuraleseSourceHashes
    if (($neuraleseSourceBefore | ConvertTo-Json -Compress) -cne ($neuraleseSourceAfter | ConvertTo-Json -Compress)) {
        throw 'Source changed during compilation; no qualified build receipt will be written.'
    }
    foreach ($neuraleseKind in @('cuda','setup')) {
        if ((Get-FileHash -LiteralPath $neuraleseCompilerBefore[$neuraleseKind + '_path']).Hash.ToLowerInvariant() -cne $neuraleseCompilerBefore[$neuraleseKind + '_sha256']) {
            throw 'Build tool changed during compilation; build is not qualified.'
        }
    }
    $neuraleseBinaries = [ordered]@{}
    foreach ($neuraleseBinary in @('neuralese-baseline.exe','neuralese-probe.exe')) {
        $neuraleseBinaries[$neuraleseBinary] = (Get-FileHash -LiteralPath (Join-Path $neuraleseBuildRoot $neuraleseBinary)).Hash.ToLowerInvariant()
    }
    $neuraleseEvidence = [ordered]@{
        schema_version = 1; kind = 'nori-neuralese-build'; project_root = $neuraleseProjectRoot
        build_directory = $neuraleseBuildRoot; created_at = [DateTimeOffset]::UtcNow.ToString('o')
        source_hashes = $neuraleseSourceBefore; binary_hashes = $neuraleseBinaries
        compiler = $neuraleseCompilerBefore; recipes = $neuraleseRecipes
    }
    # Machine-generated, bounded evidence, only inside this newly owned build.
    $neuraleseReceipt = $neuraleseEvidence | ConvertTo-Json -Depth 6
    if ([Text.Encoding]::UTF8.GetByteCount($neuraleseReceipt) -gt 65536) { throw 'Build evidence exceeded bound.' }
    [IO.File]::WriteAllText((Join-Path $neuraleseBuildRoot 'build-evidence.json'), $neuraleseReceipt, [Text.UTF8Encoding]::new($false))
    Write-Output "Isolated experiment and feature-disabled baseline: $neuraleseBuildRoot"
} finally { Pop-Location }
