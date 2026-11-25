param([Parameter(Mandatory=$true)][string]$Plan,[switch]$Continue)
$ErrorActionPreference='Stop'
$taskPlanPath=(Resolve-Path -LiteralPath $Plan).Path
$taskPlan=Get-Content -LiteralPath $taskPlanPath -Raw | ConvertFrom-Json
$taskRoot='C:\Program Files\Nori'
$taskOutput=Split-Path -Parent $taskPlanPath
if ($taskPlan.schema -ne 'nori.aider.desktop-update.v1' -or
    [IO.Path]::GetFullPath($taskPlan.installedRoot) -ne $taskRoot) { throw 'Unexpected update plan or installation' }
function Assert-Stopped {
  $taskProcesses=@(Get-CimInstance Win32_Process | Where-Object {
    $_.Name -eq 'Nori.exe' -or ($_.ExecutablePath -and $_.ExecutablePath.StartsWith($taskRoot+'\',[StringComparison]::OrdinalIgnoreCase))
  })
  if ($taskProcesses.Count) { throw 'Nori or one of her installed workers is still running' }
}
function Hash-File([string]$Path) { (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant() }
function Target-Path([string]$Relative) {
  if ($Relative -match '(^|[\\/])\.\.([\\/]|$)' -or [IO.Path]::IsPathRooted($Relative)) { throw 'Unsafe update path' }
  $taskTarget=[IO.Path]::GetFullPath((Join-Path $taskRoot $Relative))
  if (!$taskTarget.StartsWith($taskRoot+'\',[StringComparison]::OrdinalIgnoreCase)) { throw 'Update escaped Nori installation' }
  $taskAncestor=Split-Path -Parent $taskTarget
  while ($taskAncestor.StartsWith($taskRoot,[StringComparison]::OrdinalIgnoreCase)) {
    if ((Test-Path -LiteralPath $taskAncestor) -and ((Get-Item -LiteralPath $taskAncestor -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Linked update parent refused' }
    if ($taskAncestor -eq $taskRoot) { break }
    $taskAncestor=Split-Path -Parent $taskAncestor
  }
  if ((Test-Path -LiteralPath $taskTarget) -and ((Get-Item -LiteralPath $taskTarget -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Linked update file refused' }
  return $taskTarget
}
Assert-Stopped
$taskRollback=Join-Path $taskRoot 'maintenance\aider-previous'
$taskOriginalEntries=@{}
if (Test-Path -LiteralPath $taskRollback) {
  if (!$Continue) { throw 'Prior coder rollback preserved; review it before another install' }
  $taskOriginal=Get-Content -LiteralPath (Join-Path $taskRollback 'update-plan.json') -Raw | ConvertFrom-Json
  foreach ($taskEntry in $taskOriginal.entries) { $taskOriginalEntries[$taskEntry.relative]=$taskEntry }
  foreach ($taskEntry in $taskPlan.entries) {
    if (!$taskOriginalEntries.ContainsKey($taskEntry.relative)) { throw 'Correction adds a path outside the original update' }
  }
} elseif ($Continue) { throw 'No original update exists to continue' }
foreach ($taskEntry in $taskPlan.entries) {
  $taskTarget=Target-Path $taskEntry.relative
  if ((Hash-File $taskEntry.source) -ne $taskEntry.sha256) { throw ('Update source changed: '+$taskEntry.relative) }
  if ($taskEntry.beforeSha256) {
    if (!(Test-Path -LiteralPath $taskTarget) -or (Hash-File $taskTarget) -ne $taskEntry.beforeSha256) { throw ('Installed file changed: '+$taskEntry.relative) }
  } elseif (Test-Path -LiteralPath $taskTarget) { throw ('Unexpected existing file: '+$taskEntry.relative) }
}
if (!$Continue) {
  New-Item -ItemType Directory -Path $taskRollback | Out-Null
  Copy-Item -LiteralPath $taskPlanPath -Destination (Join-Path $taskRollback 'update-plan.json')
}
foreach ($taskEntry in $(if($Continue){@()}else{$taskPlan.entries})) {
  if ($taskEntry.beforeSha256) {
    $taskBackup=Join-Path $taskRollback $taskEntry.relative
    New-Item -ItemType Directory -Path (Split-Path -Parent $taskBackup) -Force | Out-Null
    Copy-Item -LiteralPath (Target-Path $taskEntry.relative) -Destination $taskBackup
    if ((Hash-File $taskBackup) -ne $taskEntry.beforeSha256) { throw 'Rollback hash mismatch' }
  }
}
$taskApplied=[Collections.Generic.List[object]]::new()
try {
  Assert-Stopped
  foreach ($taskEntry in $taskPlan.entries) {
    $taskTarget=Target-Path $taskEntry.relative
    New-Item -ItemType Directory -Path (Split-Path -Parent $taskTarget) -Force | Out-Null
    $taskTemporary=$taskTarget+'.aider-update.tmp'
    if (Test-Path -LiteralPath $taskTemporary) { throw 'Existing update temporary file preserved' }
    Copy-Item -LiteralPath $taskEntry.source -Destination $taskTemporary
    if ((Hash-File $taskTemporary) -ne $taskEntry.sha256) { throw 'Staged update hash mismatch' }
    Move-Item -LiteralPath $taskTemporary -Destination $taskTarget -Force
    $taskApplied.Add($taskEntry)
  }
  foreach ($taskEntry in $taskPlan.entries) {
    if ((Hash-File (Target-Path $taskEntry.relative)) -ne $taskEntry.sha256) { throw 'Installed update hash mismatch' }
  }
  $taskReceipt=@{schema='nori.aider.installed-update.v1';installed=$true;files=$taskPlan.entries.Count;modelsCopied=0;desktopUiTested=$false;fullReleaseVerified=$false}
  $taskReceipt | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $taskRoot 'maintenance\aider-update-receipt.json') -Encoding utf8
  $taskReceipt | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $taskOutput 'installed-result.json') -Encoding utf8
} catch {
  $taskFailure=$_.Exception.Message
  foreach ($taskEntry in $taskApplied) {
    $taskTarget=Target-Path $taskEntry.relative
    $taskRestore=if($Continue){$taskOriginalEntries[$taskEntry.relative]}else{$taskEntry}
    if ($taskRestore.beforeSha256) { Copy-Item -LiteralPath (Join-Path $taskRollback $taskEntry.relative) -Destination $taskTarget -Force }
    else { Remove-Item -LiteralPath $taskTarget -Force }
  }
  @{installed=$false;error=$taskFailure;rollbackAttempted=$true} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $taskOutput 'installed-result.json') -Encoding utf8
  throw
}

