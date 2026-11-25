const fs=require('node:fs'),path=require('node:path'),Module=require('node:module')
const TARGET=path.join(__dirname,'local-chat-context-fixture.cjs')
function replaceOnce(text,a,b){if(text.split(a).length!==2)throw Error('Fixture review anchor changed');return text.replace(a,()=>b)}
module.exports=async function activeReviewFixture({capability=false,onImport=null}={}){
 let code=fs.readFileSync(TARGET,'utf8')
 code=replaceOnce(code,"projectToolsRequested:false,...options","projectToolsRequested:null,...options")
 // Always read actual repo Source, irrespective of an unrelated test override.
 code=replaceOnce(code,"source=process.env.NORI_CONTEXT_TEST_SOURCE||path.join(root,'local-chat.mjs')","source=path.join(root,'local-chat.mjs')")
 code=replaceOnce(code,'let forbidden=0;const requests=[]','let forbidden=0;const gateImports=[];const requests=[]')
 code=replaceOnce(code,'isAiderCapabilityQuestion:()=>false','isAiderCapabilityQuestion:()=>'+String(capability)+',aiderCapabilityAnswer:async()=>"CAPABILITY_HOST_FIXTURE"')
 const dynamic=`const ownedOnImport=module.activeReviewOnImport;async function dynamicGate(spec) {
  assert.ok(['./active-project-review-evidence.mjs','./active-own-code-reader.mjs'].includes(spec),'Unexpected lazy dependency');
  gateImports.push(spec);if(ownedOnImport)ownedOnImport(spec);
  const file=path.join(root,spec.slice(2)),text=fs.readFileSync(file,'utf8');
  const m=new vm.SourceTextModule(text,{context,identifier:pathToFileURL(file).href,initializeImportMeta(meta){meta.url=pathToFileURL(file).href}});
  const adapters={'node:fs':{default:new Proxy({},{get:()=>deny})},'node:path':{default:path},'node:crypto':{createHash:require('node:crypto').createHash},'node:url':{fileURLToPath:require('node:url').fileURLToPath},'node:module':{createRequire:deny}};
  await m.link(specifier=>{assert.ok(Object.hasOwn(adapters,specifier),'Unexpected provider dependency');const value=adapters[specifier];return new vm.SyntheticModule(Object.keys(value),function(){for(const [key,v]of Object.entries(value))this.setExport(key,v)},{context})});
  await m.evaluate();return m;
 }
 `
 code=replaceOnce(code,' async function build(text,id,budget=false){',dynamic+' async function build(text,id,budget=false){')
 code=replaceOnce(code,'new vm.SourceTextModule(text,{context,identifier:id,async importModuleDynamically(spec){',"new vm.SourceTextModule(text,{context,identifier:id,initializeImportMeta(meta){meta.url=pathToFileURL(path.join(root,'local-chat.mjs')).href},async importModuleDynamically(spec){ if(!agentFactories)return dynamicGate(spec);")
 code=replaceOnce(code,'return{module:sourceModule,env,requests,fitOptions,run,','return{module:sourceModule,env,requests,fitOptions,run,gateImports,')
 const loaded=new Module(TARGET,module);loaded.filename=TARGET;loaded.paths=Module._nodeModulePaths(path.dirname(TARGET));loaded.activeReviewOnImport=onImport
 loaded._compile(code,TARGET)
 const tools={definitions:['list_dir','read_file','list_skill_catalog'].map(name=>({type:'function',function:{name,parameters:{type:'object',properties:{}}}})),call(){throw Error('Generic reader must not be dispatched')}}
 return loaded.exports.contextFixture({configured:'65536',tools,rounds:[{text:'ORDINARY_CHAT_OK'}]})
}
