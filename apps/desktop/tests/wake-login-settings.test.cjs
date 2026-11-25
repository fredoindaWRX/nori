const test=require('node:test')
const assert=require('node:assert/strict')
const {RUN_KEY,createWindowsRunRegistry,createWakeLoginSettings}=require('../desktop/wake-login-settings.cjs')

function fixture(){
  let value=null
  const registry={read:()=>value,setExact:command=>{if(value!==null&&value!==command)throw Error('foreign');value=command;return true},
    removeExact:command=>{if(value!==null&&value!==command)throw Error('foreign');value=null;return true}}
  return {registry,value:()=>value}
}
test('wake sign-in registration uses exact packaged executable and fixed args',()=>{
  const f=fixture(),target='C:\\Program Files\\Nori\\Nori.exe'
  const settings=createWakeLoginSettings({app:{isPackaged:true},executable:target,platform:'win32',registry:f.registry})
  assert.equal(settings.isEnabled(),false)
  assert.equal(settings.setEnabled(true),true)
  assert.equal(f.value(),'"C:\\Program Files\\Nori\\Nori.exe" --nori-wake-resident --nori-wake-autostart')
  assert.equal(settings.setEnabled(false),true)
  assert.equal(f.value(),null)
})
test('wake sign-in registration refuses nonpackaged, non-Windows and alternate executables',()=>{
  const f=fixture(),app={isPackaged:true}
  assert.throws(()=>createWakeLoginSettings({app:{isPackaged:false},executable:'C:\\Nori\\Nori.exe',platform:'win32',registry:f.registry}))
  assert.throws(()=>createWakeLoginSettings({app,executable:'C:\\Nori\\Nori.exe',platform:'linux',registry:f.registry}))
  assert.throws(()=>createWakeLoginSettings({app,executable:'C:\\Nori\\other.exe',platform:'win32',registry:f.registry}))
  assert.throws(()=>createWakeLoginSettings({app,executable:'Nori.exe',platform:'win32',registry:f.registry}))
})
test('wake sign-in registry preserves a conflicting existing value',()=>{
  const f=fixture(),settings=createWakeLoginSettings({app:{isPackaged:true},
    executable:'C:\\Nori\\Nori.exe',platform:'win32',registry:f.registry})
  f.registry.setExact('"C:\\Other\\Nori.exe" --foreign')
  assert.throws(()=>settings.setEnabled(true),/foreign/)
  assert.throws(()=>settings.setEnabled(false),/foreign/)
  assert.equal(f.value(),'"C:\\Other\\Nori.exe" --foreign')
})
test('native registry adapter uses fixed HKCU value, no shell, and verifies add/delete',()=>{
  let value=null
  const calls=[]
  const runner=(exe,args,options)=>{
    calls.push({exe,args,options})
    if(args[0]==='QUERY'&&!args.includes('/v'))return {status:0,stdout:RUN_KEY,stderr:''}
    if(args[0]==='QUERY')return value===null?{status:1,stdout:'',stderr:''}:
      {status:0,stdout:`\r\n${RUN_KEY}\r\n    Nori Wake    REG_SZ    ${value}\r\n`,stderr:''}
    if(args[0]==='ADD'){value=args[args.indexOf('/d')+1];return {status:0,stdout:'',stderr:''}}
    if(args[0]==='DELETE'){value=null;return {status:0,stdout:'',stderr:''}}
    throw Error('unexpected')
  }
  const registry=createWindowsRunRegistry({runner,systemRoot:'C:\\Windows'})
  const command='"C:\\Nori\\Nori.exe" --nori-wake-resident --nori-wake-autostart'
  assert.equal(registry.setExact(command),true);assert.equal(registry.read(),command)
  assert.equal(registry.removeExact(command),true);assert.equal(registry.read(),null)
  assert.ok(calls.every(call=>call.options.shell===false&&call.args.includes('/reg:64')))
  assert.ok(calls.every(call=>call.exe==='C:\\Windows\\System32\\reg.exe'))
})
test('failed add acknowledgement removes only the exact newly written entry',()=>{
  let value=null
  const runner=(_exe,args)=>{
    if(args[0]==='QUERY'&&!args.includes('/v'))return {status:0,stdout:RUN_KEY}
    if(args[0]==='QUERY')return value===null?{status:1,stdout:''}:
      {status:0,stdout:`    Nori Wake    REG_SZ    ${value}\r\n`}
    if(args[0]==='ADD'){value=args[args.indexOf('/d')+1];return {status:1,stdout:''}}
    if(args[0]==='DELETE'){value=null;return {status:0,stdout:''}}
    throw Error('unexpected')
  }
  const registry=createWindowsRunRegistry({runner,systemRoot:'C:\\Windows'})
  assert.throws(()=>registry.setExact('"C:\\Nori\\Nori.exe" --nori-wake-resident'),/registration failed/)
  assert.equal(value,null)
})
test('unreadable registry is refused before any startup mutation',()=>{
  const calls=[]
  const registry=createWindowsRunRegistry({systemRoot:'C:\\Windows',runner:(_exe,args)=>{
    calls.push(args);return {status:1,stdout:'',stderr:'access denied'}
  }})
  assert.throws(()=>registry.setExact('"C:\\Nori\\Nori.exe" --nori-wake-resident'),/absence could not be verified/)
  assert.ok(calls.every(args=>args[0]==='QUERY'))
})
test('failed value query cannot hide an existing value of another type',()=>{
  const registry=createWindowsRunRegistry({systemRoot:'C:\\Windows',runner:(_exe,args)=>
    args.includes('/v')?{status:1,stdout:''}:{status:0,stdout:'    Nori Wake    REG_BINARY    0102\r\n'}})
  assert.throws(()=>registry.read(),/value unreadable/)
})
