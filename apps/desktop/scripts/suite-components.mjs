import {lstatSync,readFileSync,realpathSync} from 'node:fs'
import {join,relative,isAbsolute,dirname} from 'node:path'

// Product inventory, not a claim that every component is release-qualified.
export function suiteComponents(desktopRoot) {
  const root=realpathSync(desktopRoot)
  const unlinked=absolute=>{
    let cursor=absolute
    while(cursor!==root){
      if(lstatSync(cursor).isSymbolicLink())throw Error('Unsafe suite component link')
      const parent=dirname(cursor)
      if(parent===cursor)throw Error('Unsafe suite component root')
      cursor=parent
    }
  }
  const entry=(id,kind,path)=>{
    const absolute=join(root,path),info=lstatSync(absolute)
    unlinked(absolute)
    const delta=relative(root,realpathSync(absolute))
    if(info.isSymbolicLink()||delta.startsWith('..')||isAbsolute(delta)||
      (!info.isFile()&&!info.isDirectory()))throw Error('Unsafe suite component')
    if(info.isFile()&&info.size===0)throw Error('Empty suite component')
    return {id,kind,path,releaseQualified:false}
  }
  const prefix='resources/NoriSuite/'
  const interpreted=(id,kind,path,entryPoint)=>{
    // Directory presence alone is not evidence of a runnable component.
    const script=entry(id+'-entry','python-source',prefix+entryPoint)
    const interpreter=entry('python-entry','executable',prefix+'python/Python311/python.exe')
    if(!lstatSync(join(root,script.path)).isFile()||!lstatSync(join(root,interpreter.path)).isFile())
      throw Error('Suite execution entry must be a regular file')
    return {...entry(id,kind,prefix+path),execution:{mode:'interpreted-python',
      entryPoint:script.path,interpreter:interpreter.path,compiled:false}}
  }
  const configPath=join(root,prefix,'runtime/norllama/config.json')
  unlinked(configPath)
  const configInfo=lstatSync(configPath)
  if(!configInfo.isFile()||configInfo.size>1024*1024)throw Error('Unsafe suite configuration')
  const config=JSON.parse(readFileSync(configPath,'utf8'))
  if(config.engine_binary!=='engine/norama/norama-worker.exe'||
    typeof config.model_path!=='string'||!/^models\/language\/[a-zA-Z0-9._/-]+$/.test(config.model_path)||
    config.model_path.split('/').includes('..'))throw Error('Unqualified suite model configuration')
  return {schema:1,product:'N.O.R.I.',releaseVerified:false,
    components:[entry('desktop','executable','Nori.exe'),
      entry('desktop-application','archive','resources/app.asar'),
      interpreted('norllama','bundled-python-runtime','runtime/norllama','runtime/norllama/norllama.py'),
      entry('norama','native-executable',prefix+config.engine_binary),
      {...entry('language-model','imported-model-weights',prefix+config.model_path),modelId:config.model_id},
      entry('python','bundled-interpreter',prefix+'python/Python311'),
      interpreted('nori-core-and-knights','bundled-python-components','nori','nori/main.py'),
      entry('speech-recognition','bundled-component',prefix+'runtime/stt'),
      entry('speech-output','bundled-component',prefix+'runtime/voice'),
      entry('phone-location','bundled-component',prefix+'integrations/location'),
      entry('project-monitor','read-only-companion',prefix+'integrations/project-monitor'),
      entry('backup-verification','maintenance-component','backup-tools'),
      entry('state-maintenance','maintenance-component','maintenance')],
    privateState:{included:false,note:'Private state is provisioned separately; never distribution contents.'}}
}
