param()
$ErrorActionPreference='Stop'
$compilerSetup='C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat'
$cudaCompiler='C:\Program Files\NVIDIA GPU Computing Toolkit\CUDA\v13.3\bin\nvcc.exe'
foreach($dependency in @($compilerSetup,$cudaCompiler)) {
    if(-not(Test-Path -LiteralPath $dependency -PathType Leaf)){throw "Existing compiler unavailable: $dependency. Nothing installed."}
}
Push-Location -LiteralPath $PSScriptRoot
try {
    # Separate diagnostic binary; never rebuilds/replaces the production worker.
    & cmd.exe /d /c "`"$compilerSetup`" && `"$cudaCompiler`" -std=c++17 -Xcompiler=/O2 -arch=sm_89 src\dualtrace.cu bcrypt.lib -o norama-dualtrace.exe"
    if($LASTEXITCODE -ne 0){throw 'DualTrace compilation failed.'}
    & cmd.exe /d /c "`"$compilerSetup`" && `"$cudaCompiler`" -std=c++17 -Xcompiler=/O2 -arch=sm_89 src\dualtrace_worker.cu bcrypt.lib -o norama-dualtrace-worker.exe"
    if($LASTEXITCODE -ne 0){throw 'DualTrace resident-worker compilation failed.'}
} finally {Pop-Location}
