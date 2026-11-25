// Explicitly requested Nori memory update. Requires a quiescent desktop profile.
import {execFileSync} from 'node:child_process'
import {join} from 'node:path'

const processes=execFileSync(join(process.env.SystemRoot||'C:/Windows','System32/WindowsPowerShell/v1.0/powershell.exe'),
  ['-NoProfile','-NonInteractive','-Command',"@(Get-Process -Name Nori -ErrorAction SilentlyContinue).Count"],
  {encoding:'utf8',windowsHide:true}).trim()
if(processes!=='0')throw Error('Quit Nori before saving this preference; the live bridge owns its memory.')
process.env.NORI_LEARNING_FILE='C:/Users/Studio/AppData/Local/Nori/settings/learned-guidance.json'
const {learnFromUserText,learnedContext,learningMemoryPath}=await import('../bridge/nori-learning.mjs')
const lesson='From now on, when Will asks to refine something Nori just created, preserve the original scene and prior refinements and use the appropriate creative tool to carry out the request. Treat confirmations such as yes do it exactly like that as requests to execute the agreed refinement. Only report successful generation after the tool finishes and the output is delivered.'
const result=learnFromUserText(lesson)
if(result.kind!=='preference'||!learnedContext().includes(lesson))throw Error('Creative follow-up preference was not saved and retrieved')
console.log(JSON.stringify({saved:true,path:learningMemoryPath(),kind:result.kind,lesson}))
