// Read-only inventory. Not a secret scanner, staging tool or upload approval.
import {spawnSync} from 'node:child_process'
import {lstatSync,readFileSync,realpathSync} from 'node:fs'
import {resolve,join} from 'node:path'

const root=realpathSync(resolve(import.meta.dirname,'..'))
const result=spawnSync('git',['ls-files','-z','--cached','--others','--exclude-standard'],
  {cwd:root,encoding:'utf8',windowsHide:true,maxBuffer:64*1024*1024,timeout:30000})
if(result.error || result.status!==0)throw new Error('Git source inventory failed: '+(result.error?.code??result.status))
const denied=/^(?:state|data|recovery|python|node_modules|\.git)\/|(?:^|\/)(?:node_modules|\.venv[^/]*|site-packages|__pycache__|secrets|runtime-data|logs|dist|release|build)\/|^runtime\/(?:electron|voice\/(?:python310|packages))\/|^verification\/\./i
const sensitive=/(?:^|\/)(?:\.env(?:\..*)?|credentials[^/]*|client_secret[^/]*|[^/]*\.(?:key|pem|pfx|p12|token))$/i
// Bundled broadcast tools, personal recordings and voice samples are not source.
const broadcastPrivateOrVendored=/^streaming\/(?:obs|tools|recordings|voice-clone)\//i
const binary=/\.(?:exe|dll|lib|obj|pdb|gguf|onnx|safetensors|nori|ndt|bin|zip|7z|sqlite3?|db)$/i
const paths=[...new Set(result.stdout.split('\0').filter(Boolean))]
const textExtension=/\.(?:py|js|mjs|cjs|ts|tsx|json|yaml|yml|toml|ini|cfg|txt|md|ps1|iss|xml|html|css|sh)$/i
const credentialShape=/(?:-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bgh[pousr]_[A-Za-z0-9]{30,}|\bgithub_pat_[A-Za-z0-9_]{30,}|\bsk-(?:proj-)?[A-Za-z0-9_-]{30,}|\bAKIA[0-9A-Z]{16}\b)/
let scannedTextFiles=0,unscannedFiles=0
const credentialCandidates=[]
let total=0,bytes=0
const excluded=[],oversize=[],links=[],missing=[],groups={}
for(const path of paths){
  const normalized=path.replaceAll('\\','/')
  if(denied.test(normalized) || sensitive.test(normalized) || binary.test(normalized) || broadcastPrivateOrVendored.test(normalized)){
    excluded.push(normalized);continue
  }
  let stat
  try{stat=lstatSync(join(root,path))}catch{missing.push(normalized);continue}
  if(stat.isSymbolicLink() || !stat.isFile()){links.push(normalized);continue}
  const physical=realpathSync(join(root,path))
  const expected=resolve(root,path)
  const canonical=value=>process.platform==='win32'?value.toLowerCase():value
  if(canonical(physical)!==canonical(expected)){
    links.push(normalized);continue
  }
  if(stat.size>=50*1024*1024){oversize.push({path:normalized,bytes:stat.size});continue}
  total++;bytes+=stat.size
  if(textExtension.test(normalized) && stat.size<=5*1024*1024){
    scannedTextFiles++
    if(credentialShape.test(readFileSync(join(root,path),'utf8')))credentialCandidates.push(normalized)
  }else unscannedFiles++
  const group=normalized.includes('/')?normalized.split('/')[0]:'root'
  groups[group]=(groups[group]||0)+1
}
console.log(JSON.stringify({root,candidate_files:total,candidate_bytes:bytes,groups,
  excluded_count:excluded.length,oversize,links,missing,
  credential_shape_scan:{scanned_text_files:scannedTextFiles,unscanned_files:unscannedFiles,
    flagged_paths:credentialCandidates,values_printed:false,comprehensive:false},
  content_secret_scan_completed:false,license_review_completed:false,
  staged:false,committed:false,uploaded:false,
  warning:'Candidate counts are not a safe-to-publish determination. Contents and parent symlinks still require review; Git history is not assessed.'},null,2))
