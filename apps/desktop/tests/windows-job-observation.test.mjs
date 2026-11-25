import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {spawnSync} from 'node:child_process'

const host=fileURLToPath(new URL('../scripts/probe-windows-owned-job.ps1',import.meta.url))
const source=readFileSync(host,'utf8')
// Exercise the actual polling body with a controlled job object, not a second
// implementation of the decision. No native Job, process launch or GUI runs.
const loop=source.match(/    while \(\$true\) \{([\s\S]*?)\r?\n    \}\r?\n    if \(-not \$job\.RootExited/)
assert.ok(loop,'Owned Job polling loop must remain identifiable')
const powershell=process.platform==='win32'
  ? join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe') : null
const windows={skip:process.platform!=='win32'}

function observe(scenario){
  const command=`
    $ErrorActionPreference = 'Stop'
    $spec = [pscustomobject]@{mode='argv';fault='none';timeoutMs=1000}
    $inputTask = [pscustomobject]@{IsCompleted=$false}
    $clock = [pscustomobject]@{ElapsedMilliseconds=0}
    $rootExitedWithDescendants = $false
    $forced = $false
    $forceReason = $null
    $membershipSent = $false
    $job = [pscustomobject]@{
      Scenario='${scenario}';SyntheticRootExited=('${scenario}' -ne 'root-race');CountReads=0;
      Trace=[System.Collections.Generic.List[string]]::new()
    }
    $job | Add-Member -MemberType ScriptProperty -Name RootExited -Value {
      $this.Trace.Add('root')
      return $this.SyntheticRootExited
    }
    $job | Add-Member -MemberType ScriptMethod -Name ActiveProcesses -Value {
      param($fault)
      $this.Trace.Add('active')
      $this.CountReads += 1
      if($this.Scenario -eq 'query-failure'){throw 'synthetic accounting failure'}
      if($this.CountReads -eq 1){
        # Model the root terminating after its pre-exit count was sampled.
        # In the old active-then-root order this stale count falsely qualified.
        $this.SyntheticRootExited = $true
        return 1
      }
      return 0
    }
    $failure = $null
    try {
      while($true){${loop[1]}
      }
    } catch {$failure=$_.Exception.Message}
    [ordered]@{rootExitedWithDescendants=$rootExitedWithDescendants;
      countReads=$job.CountReads;trace=@($job.Trace);failure=$failure;forced=$forced} |
      ConvertTo-Json -Compress
  `
  const result=spawnSync(powershell,['-NoProfile','-Command',command],
    {encoding:'utf8',windowsHide:true,shell:false,timeout:5000})
  assert.equal(result.error,undefined)
  assert.equal(result.status,0,result.stderr)
  return JSON.parse(result.stdout.trim())
}

test('a lone root exit between observations cannot qualify as a surviving descendant',windows,()=>{
  const result=observe('root-race')
  assert.equal(result.rootExitedWithDescendants,false)
  assert.equal(result.failure,null)
  assert.equal(result.countReads,2)
  assert.deepEqual(result.trace,['root','active','root','active'])
  assert.equal(result.forced,false)
})

test('an active member observed after proven root exit can qualify',windows,()=>{
  const result=observe('surviving-member')
  assert.equal(result.rootExitedWithDescendants,true)
  assert.equal(result.failure,null)
  assert.equal(result.countReads,2)
  assert.deepEqual(result.trace,['root','active','root','active'])
})

test('failed accounting cannot qualify a descendant observation',windows,()=>{
  const result=observe('query-failure')
  assert.equal(result.rootExitedWithDescendants,false)
  assert.match(result.failure,/synthetic accounting failure/)
  assert.equal(result.countReads,1)
  assert.deepEqual(result.trace,['root','active'])
})
