param([Parameter(Mandatory=$true)][string]$Root)
$ErrorActionPreference = 'Stop'
$verification = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..\..\verification'))
$fixture = [IO.Path]::GetFullPath($Root)
if ((Split-Path -Parent $fixture) -ne $verification -or
    (Split-Path -Leaf $fixture) -notmatch '^\.native-job-guardian-[\w-]+$') { throw 'Generated Nori Job fixture required.' }
$ancestor = $fixture
while ($ancestor) {
    $item = Get-Item -LiteralPath $ancestor -Force
    if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Linked Job fixture refused.' }
    $next = Split-Path -Parent $ancestor
    if ($next -eq $ancestor) { break }; $ancestor = $next
}
$manifestPath = Join-Path $fixture 'launch-spec.json'
$manifestInfo = Get-Item -LiteralPath $manifestPath -Force
if ($manifestInfo.Length -gt 65536 -or ($manifestInfo.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Invalid Job fixture manifest.' }
$spec = [IO.File]::ReadAllText($manifestPath) | ConvertFrom-Json
$allowedFields = @('schema','nonce','mode','fault','argv','timeoutMs','desktopLayout','profileFixture','layoutFixture','browserCookieMode','browserFixtureUrl')
foreach ($name in $spec.PSObject.Properties.Name) {
    if ($allowedFields -cnotcontains $name) { throw 'Unknown exact Job fixture field.' }
}
if ($spec.schema -isnot [int] -or $spec.schema -ne 1 -or $spec.nonce -isnot [string] -or $spec.nonce -cnotmatch '^[a-f0-9]{64}$' -or
    $spec.mode -cnotin @('delayed','argv','hang','desktop') -or $spec.fault -cnotin @('none','assignment','query') -or
    $spec.timeoutMs -isnot [int] -or $spec.argv -isnot [Array] -or @($spec.argv).Count -gt 32 -or
    $spec.timeoutMs -lt 50 -or $spec.timeoutMs -gt 120000 -or
    ($spec.mode -ne 'desktop' -and $spec.timeoutMs -gt 30000)) { throw 'Invalid Job fixture protocol.' }
foreach ($argument in $spec.argv) {
    if ($argument -isnot [string] -or $argument.Length -gt 4096 -or $argument.Contains([string][char]0)) { throw 'Invalid bounded Job argv.' }
}
$executable = Join-Path $fixture 'job-fixture.exe'
$desktopReadiness = $null
if ($spec.mode -eq 'desktop') {
    if ($spec.fault -ne 'none' -or @($spec.argv).Count -ne 0) { throw 'Invalid source desktop Job fixture.' }
    if ($spec.desktopLayout -ceq 'isolated-v1') {
        if ($spec.profileFixture -isnot [string] -or $spec.profileFixture -cnotmatch '^\.native-desktop-probe-job-[\w-]+$' -or
            $spec.PSObject.Properties.Name -ccontains 'layoutFixture') { throw 'Invalid isolated desktop Job state selector.' }
        $desktopReadiness = Join-Path $verification ($spec.profileFixture+'\desktop-readiness.json')
    } elseif ($spec.desktopLayout -ceq 'consolidated-v1') {
        if ($spec.layoutFixture -isnot [string] -or $spec.layoutFixture -cnotmatch '^\.native-browser-migration-job-[\w-]+$' -or
            $spec.PSObject.Properties.Name -ccontains 'profileFixture') { throw 'Invalid consolidated desktop Job state selector.' }
        $desktopReadiness = Join-Path $verification ($spec.layoutFixture+'\state\private\desktop\desktop-readiness.json')
    } else { throw 'Unknown desktop Job state layout; no fallback permitted.' }
    $hasStorageMode = $spec.PSObject.Properties.Name -ccontains 'browserCookieMode'
    $hasStorageUrl = $spec.PSObject.Properties.Name -ccontains 'browserFixtureUrl'
    if ($hasStorageMode -ne $hasStorageUrl) { throw 'Paired browser storage fixture required.' }
    if ($hasStorageMode) {
        if ($spec.desktopLayout -cne 'consolidated-v1' -or $spec.browserCookieMode -cnotin @('seed','check') -or
            $spec.browserFixtureUrl -isnot [string] -or
            $spec.browserFixtureUrl -cnotmatch '^http://127\.0\.0\.1:[0-9]{1,5}/nori-storage-fixture\?fixture=[a-f0-9]{64}$') { throw 'Invalid synthetic browser storage fixture.' }
        $storageUri = [Uri]$spec.browserFixtureUrl
        if ($storageUri.Port -lt 1 -or $storageUri.Port -gt 65535) { throw 'Invalid browser storage fixture port.' }
    }
    # Fixed consolidated runtime only. No arbitrary executable/argv manifest,
    # package activation, source install, sensor or owner-profile access.
    $executable = Join-Path $verification '..\runtime\electron\v44.4.5\electron.exe'
    if ($env:ELECTRON_RUN_AS_NODE -ne '1') { throw 'Isolated Node entry requires explicit Electron Node mode.' }
}
elseif ($spec.PSObject.Properties.Name -ccontains 'browserCookieMode' -or $spec.PSObject.Properties.Name -ccontains 'browserFixtureUrl') {
    throw 'Browser storage fixture is desktop-only.'
}
if (-not (Test-Path -LiteralPath $executable) -or
    ((Get-Item -LiteralPath $executable -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Owned fixture executable required.' }
Add-Type -Path (Join-Path $PSScriptRoot 'windows-owned-job.cs')
if ($spec.mode -eq 'desktop') {
    $ancestor = [IO.Path]::GetFullPath($executable)
    while ($ancestor) {
        if ((Get-Item -LiteralPath $ancestor -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Linked source Electron path refused.' }
        $next = Split-Path -Parent $ancestor
        if ($next -eq $ancestor) { break }; $ancestor = $next
    }
}
$job = $null
$launchResumed = $false
try {
    $argv = if ($spec.mode -eq 'desktop') {
        [string[]]@((Join-Path $PSScriptRoot 'job-desktop-entry.mjs'),$fixture)
    } else { [string[]](@($fixture,$spec.mode) + @($spec.argv)) }
    $job = [Nori.ProcessOwnership.OwnedJob]::new($executable,$argv,$fixture,($spec.fault -eq 'assignment'))
    [Console]::Out.WriteLine(([ordered]@{kind='owned-job-ready';nonce=$spec.nonce;rootPid=$job.RootPid;
        creationTimeAssociation=$true;breakawayEnabled=$false;jobHandleInherited=$false} | ConvertTo-Json -Compress))
    [Console]::Out.Flush()
    $job.Resume()
    $launchResumed = $true
    $inputTask = [Nori.ProcessOwnership.OwnedJob]::ReadControl()
    $clock = [Diagnostics.Stopwatch]::StartNew()
    $rootExitedWithDescendants = $false; $forced = $false; $forceReason = $null; $membershipSent = $false
    while ($true) {
        # Observe root exit BEFORE sampling membership. A count taken before
        # exit can include the root itself, not a surviving descendant.
        $rootExited = $job.RootExited
        $active = $job.ActiveProcesses(($spec.fault -eq 'query'))
        if ($spec.mode -eq 'desktop' -and -not $membershipSent -and
            (Test-Path -LiteralPath $desktopReadiness)) {
            [Console]::Out.WriteLine(([ordered]@{kind='owned-job-members';nonce=$spec.nonce;rootPid=$job.RootPid;
                processIds=@($job.ProcessIds());syntheticOnly=$true} | ConvertTo-Json -Compress))
            [Console]::Out.Flush();$membershipSent = $true
        }
        if ($rootExited -and $active -gt 0) { $rootExitedWithDescendants = $true }
        if ($rootExited -and $active -eq 0) { break }
        if ($inputTask.IsCompleted -or $clock.ElapsedMilliseconds -ge $spec.timeoutMs) {
            $forced = $true
            $forceReason = if ($inputTask.IsCompleted) { 'control-closed' } else { 'deadline' }
            $job.TerminateAndDrain(5000)
            break
        }
        [Threading.Thread]::Sleep(10)
    }
    if (-not $job.RootExited -or $job.ActiveProcesses($false) -ne 0) { throw 'Owned Job exit not proven.' }
    [Console]::Out.WriteLine(([ordered]@{kind='owned-job-drained';nonce=$spec.nonce;rootPid=$job.RootPid;
        rootHandleExited=$true;activeProcesses=0;totalProcesses=$job.TotalProcesses;rootExitCode=$job.RootExitCode;
        rootExitedWithDescendants=$rootExitedWithDescendants;forced=$forced;forceReason=$forceReason;syntheticOnly=$true} | ConvertTo-Json -Compress))
    [Console]::Out.Flush()
} catch {
    # Query/launch failure is never successful drain evidence. Exact Job cleanup
    # is attempted while handle remains open; Node must preserve all leases.
    $cleanupVerified = $false
    if ($job) { try { $job.TerminateAndDrain(5000);$cleanupVerified=$true } catch {} }
    [Console]::Out.WriteLine(([ordered]@{kind='owned-job-failed';nonce=$spec.nonce;
        cleanupVerified=$cleanupVerified;launchResumed=$launchResumed;syntheticOnly=$true} | ConvertTo-Json -Compress))
    [Console]::Out.Flush()
    exit 1
} finally { if ($job) { $job.Dispose() } }
