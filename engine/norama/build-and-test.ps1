param(
    [ValidatePattern('^sm_[0-9]{2,3}$')][string]$CudaArchitecture = 'sm_89',
    [string]$CheckpointPath = '',
    [string]$NormalizationTensor = 'blk.0.attn_norm.weight',
    [string]$ProjectionTensor = '',
    [uint32[]]$ProbeTokenIds = @()
)
$ErrorActionPreference = 'Stop'
$projectRoot = $PSScriptRoot
$compilerSetup = 'C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat'
$cudaCompiler = 'C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA\v13.3\bin\nvcc.exe'
$nodeRuntime = 'C:\Program Files\nodejs\node.exe'
foreach ($dependency in @($compilerSetup, $cudaCompiler, $nodeRuntime)) {
    if (-not (Test-Path -LiteralPath $dependency -PathType Leaf)) {
        throw "Required existing build dependency is missing: $dependency. Nothing was installed."
    }
}
Push-Location -LiteralPath $projectRoot
try {
    $builds = @(
        'cl /nologo /EHsc /std:c++17 src\gguf_header.cpp /Fe:norama-header.exe /Fo:gguf_header.obj',
        'cl /nologo /EHsc /std:c++17 tests\gguf_range_test.cpp /Fe:norama-range-test.exe /Fo:gguf_range_test.obj',
        'cl /nologo /EHsc /std:c++17 tests\math_test.cpp /Fe:norama-math-test.exe /Fo:math_test.obj',
        'cl /nologo /EHsc /O2 /std:c++17 tests\numerical_probe_metrics_test.cpp /Fe:norama-numerical-metrics-test.exe /Fo:numerical_probe_metrics_test.obj',
        'cl /nologo /EHsc /std:c++17 tests\attention_test.cpp /Fe:norama-attention-test.exe /Fo:attention_test.obj',
        'cl /nologo /EHsc /std:c++17 tests\block_test.cpp /Fe:norama-block-test.exe /Fo:block_test.obj',
        'cl /nologo /EHsc /std:c++17 tests\model_graph_test.cpp /Fe:norama-model-test.exe /Fo:model_graph_test.obj',
        'cl /nologo /EHsc /std:c++17 tests\weight_decode_test.cpp /Fe:norama-weight-test.exe /Fo:weight_decode_test.obj',
        'cl /nologo /EHsc /O2 /std:c++17 tests\checkpoint_graph_test.cpp /Fe:norama-checkpoint-test.exe /Fo:checkpoint_graph_test.obj',
        'cl /nologo /EHsc /O2 /std:c++17 tests\actual_import_budget_test.cpp /Fe:norama-import-budget-test.exe /Fo:actual_import_budget_test.obj',
        'cl /nologo /EHsc /O2 /std:c++17 src\tokenizer_cli.cpp /Fe:norama-tokenizer.exe /Fo:tokenizer_cli.obj',
        'cl /nologo /EHsc /O2 /std:c++17 tests\worker_protocol_test.cpp /Fe:norama-worker-protocol-test.exe /Fo:worker_protocol_test.obj',
        'cl /nologo /EHsc /O2 /std:c++17 tests\json_prefix_test.cpp /Fe:norama-json-prefix-test.exe /Fo:json_prefix_test.obj',
        'cl /nologo /EHsc /O2 /std:c++17 tests\contract_prefix_test.cpp /Fe:norama-contract-prefix-test.exe /Fo:contract_prefix_test.obj',
        "`"$cudaCompiler`" -std=c++17 -arch=$CudaArchitecture tests\cuda_matvec_test.cu -o norama-cuda-test.exe",
        "`"$cudaCompiler`" -std=c++17 -arch=$CudaArchitecture src\gpu_engine.cu tests\cuda_attention_test.cu -o norama-cuda-attention-test.exe",
        "`"$cudaCompiler`" -std=c++17 -arch=$CudaArchitecture src\gpu_engine.cu tests\gpu_engine_test.cu -o norama-engine-test.exe",
        "`"$cudaCompiler`" -std=c++17 -arch=$CudaArchitecture src\gpu_engine.cu tests\cuda_block_test.cu -o norama-cuda-block-test.exe",
        "`"$cudaCompiler`" -std=c++17 -arch=$CudaArchitecture src\gpu_engine.cu tests\cuda_model_graph_test.cu -o norama-cuda-model-test.exe",
        "`"$cudaCompiler`" -std=c++17 -arch=$CudaArchitecture src\gpu_engine.cu tests\cuda_checkpoint_probe.cu -o norama-checkpoint-probe.exe",
        "`"$cudaCompiler`" -std=c++17 -Xcompiler=/O2 -arch=$CudaArchitecture src\gpu_engine.cu tests\cuda_checkpoint_graph_probe.cu -o norama-model-probe.exe",
        "`"$cudaCompiler`" -std=c++17 -Xcompiler=/O2 -arch=$CudaArchitecture src\gpu_engine.cu src\resident_matrix.cu tests\resident_matrix_test.cu -o norama-resident-matrix-test.exe",
        "`"$cudaCompiler`" -std=c++17 -Xcompiler=/O2 -arch=$CudaArchitecture src\gpu_engine.cu src\resident_matrix.cu tests\resident_graph_test.cu -o norama-resident-graph-test.exe",
        "`"$cudaCompiler`" -std=c++17 -Xcompiler=/O2 -arch=$CudaArchitecture src\gpu_engine.cu src\resident_matrix.cu tests\cuda_cache_test.cu -o norama-cache-test.exe",
        "`"$cudaCompiler`" -std=c++17 -Xcompiler=/O2 -arch=$CudaArchitecture src\gpu_engine.cu src\resident_matrix.cu tests\cached_graph_test.cu -o norama-cached-graph-test.exe",
        "`"$cudaCompiler`" -std=c++17 -Xcompiler=/O2 -arch=$CudaArchitecture src\gpu_engine.cu src\resident_matrix.cu tests\actual_numerical_probe.cu -o norama-numerical-probe.exe",
        "`"$cudaCompiler`" -std=c++17 -Xcompiler=/O2 -arch=$CudaArchitecture src\gpu_engine.cu src\resident_matrix.cu tests\long_context_probe.cu -o norama-long-context-probe.exe",
        "`"$cudaCompiler`" -std=c++17 -Xcompiler=/O2 -arch=$CudaArchitecture src\gpu_engine.cu src\resident_matrix.cu src\generate.cu -o norama-generate.exe",
        "`"$cudaCompiler`" -std=c++17 -Xcompiler=/O2 -arch=$CudaArchitecture src\gpu_engine.cu src\resident_matrix.cu src\worker.cu -o norama-worker.exe"
    )
    foreach ($build in $builds) {
        & cmd.exe /d /c "`"$compilerSetup`" && $build"
        if ($LASTEXITCODE -ne 0) { throw "Compilation failed (exit $LASTEXITCODE). Tests were not accepted." }
    }
    foreach ($test in @('norama-math-test.exe','norama-numerical-metrics-test.exe','norama-attention-test.exe','norama-cuda-test.exe',
                         'norama-cuda-attention-test.exe','norama-engine-test.exe',
                         'norama-block-test.exe','norama-cuda-block-test.exe',
                         'norama-model-test.exe','norama-cuda-model-test.exe','norama-weight-test.exe',
                         'norama-resident-matrix-test.exe','norama-cache-test.exe','norama-worker-protocol-test.exe','norama-json-prefix-test.exe','norama-contract-prefix-test.exe')) {
        & (Join-Path $projectRoot $test)
        if ($LASTEXITCODE -ne 0) { throw "Test failed: $test (exit $LASTEXITCODE)" }
    }
    & $nodeRuntime --test tests\header.test.mjs tests\checkpoint.test.mjs tests\tokenizer.test.mjs tests\generate.test.mjs tests\json_prefix.test.mjs
    if ($LASTEXITCODE -ne 0) { throw "GGUF parser tests failed (exit $LASTEXITCODE)" }
    if ($CheckpointPath) {
        & $nodeRuntime tests\actual_tokenizer_probe.mjs $CheckpointPath
        if ($LASTEXITCODE -ne 0) { throw "Actual checkpoint tokenizer probe failed (exit $LASTEXITCODE)" }
        $probeArguments = @($CheckpointPath, $NormalizationTensor)
        if ($ProjectionTensor) { $probeArguments += $ProjectionTensor }
        & (Join-Path $projectRoot 'norama-checkpoint-probe.exe') @probeArguments
        if ($LASTEXITCODE -ne 0) { throw "Actual checkpoint GPU probe failed (exit $LASTEXITCODE)" }
        if ($ProbeTokenIds.Count) {
            $graphArguments = @($CheckpointPath) + @($ProbeTokenIds | ForEach-Object { $_.ToString() })
            & (Join-Path $projectRoot 'norama-model-probe.exe') @graphArguments
            if ($LASTEXITCODE -ne 0) { throw "Complete checkpoint token-ID probe failed (exit $LASTEXITCODE)" }
        }
    }
    Write-Output 'Norama.cpp compiled-source CPU/GPU/import/tokenizer validation passed. This does not qualify model semantics or installed end-to-end Nori operation.'
} finally {
    Pop-Location
}
