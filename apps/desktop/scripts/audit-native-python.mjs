import {spawnSync} from 'node:child_process'
import {resolve} from 'node:path'
import {nativePayloadPlan} from './native-payload-plan.mjs'
const root=resolve(import.meta.dirname,'../../..')
const plan=nativePayloadPlan(root)
const paths=plan.files.filter(file=>file.path.startsWith('nori/')&&file.path.endsWith('.py')).map(file=>file.path)
// Compile source to an in-memory code object only: no imports, execution or pyc.
const code=`import json,sys,pathlib
root=pathlib.Path(sys.argv[1]); paths=json.load(sys.stdin); failures=[]
for relative in paths:
 try:
  data=(root/relative).read_bytes()
  compile(data,relative,'exec',dont_inherit=True)
 except (SyntaxError,ValueError,UnicodeError) as error:
  failures.append({'path':relative,'line':getattr(error,'lineno',None),'error':str(error)[:200]})
print(json.dumps({'checked':len(paths),'syntaxFailures':failures,'importsExecuted':False,'releaseVerified':False}))
`
const result=spawnSync(resolve(root,'python/Python311/python.exe'),['-I','-B','-c',code,root],{
 input:JSON.stringify(paths),encoding:'utf8',windowsHide:true,timeout:30000,maxBuffer:1024*1024,
})
if(result.error||result.status!==0)throw Error(result.error?.message??result.stderr)
console.log(result.stdout.trim())
