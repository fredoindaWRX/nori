// Read actual installed app result envelopes using synthetic local documents.
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,existsSync,statSync} from 'node:fs'
import {join,resolve} from 'node:path'
import {tmpdir} from 'node:os'
import {createNoriArtCraftMcpTools} from '../bridge/artcraft-mcp-tools.mjs'
import {callThroughNeuralese} from '../bridge/neuralese-project-tools.mjs'

const root='C:/Program Files/Nori/resources/NoriSuite'
const workspace=mkdtempSync(join(tmpdir(),'nori-result-handles-'))
const report={syntheticOnly:true,installedAppBinaries:true,modelPlannerTested:false,passed:false,results:{}}
const graphProbe=process.argv.includes('--isolated-graph')
const modelProbe=process.argv.includes('--isolated-model')
if(graphProbe&&modelProbe)throw Error('Select one probe mode')
const graph=graphProbe?await import('file:///C:/Nori/dev/worktrees/neuralese-artcraft-results/apps/desktop/bridge/neuralese-artcraft-plan.mjs'):null
report.graphImplementation=graphProbe||modelProbe?'isolated-worktree':'none'
let session
function pdfFixture(){
  const stream='BT /F1 16 Tf 30 100 Td (Nori handle proof) Tj ET\n'
  const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 180] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}endstream`,'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>']
  let body='%PDF-1.4\n';const offsets=[0]
  for(let index=0;index<objects.length;index++){offsets.push(Buffer.byteLength(body));body+=`${index+1} 0 obj\n${objects[index]}\nendobj\n`}
  const xref=Buffer.byteLength(body)
  body+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`
  for(const offset of offsets.slice(1))body+=`${String(offset).padStart(10,'0')} 00000 n \n`
  return body+`trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
}
try{
  for(const appId of modelProbe?['pdfcraft']:['pdfcraft','designcraft']){
    const goal=appId==='pdfcraft'?'Use PDFCraft to open handle.pdf, extract the text from page 1, and save a copy as handle-copy.pdf.':'Create a brochure text frame and inspect its story'
    session=await createNoriArtCraftMcpTools(appId,{noriRoot:root,workspaceRoot:workspace,goal,timeoutMs:60000})
    let serial=0
    const call=async(name,args)=>JSON.parse(await callThroughNeuralese(session,name,args,{maxBytes:8192},`result_probe_${appId}_${++serial}`,goal))
    if(appId==='pdfcraft'){
      const inputs=join(workspace,'integrations/artcraft/workspaces/app-sandboxes/pdfcraft/inputs')
      mkdirSync(inputs,{recursive:true});writeFileSync(join(inputs,'handle.pdf'),pdfFixture(),'ascii')
      if(graphProbe||modelProbe){
        // Occupy the first app handle so a guessed ID of 1 cannot pass.
        writeFileSync(join(inputs,'warmup.pdf'),pdfFixture(),'ascii')
        await call('artcraft_pdfcraft_doc_open',{path:'warmup.pdf'})
        const actions=[{name:'artcraft_pdfcraft_doc_open',args:{path:'handle.pdf'}},
          {name:'artcraft_pdfcraft_text_extract',args:{doc:{result_of:'n0',field:'doc'},pages:[1]}},
          {name:'artcraft_pdfcraft_doc_save',args:{doc:{result_of:'n0',field:'doc'},path:'handle-copy.pdf'}}]
        let receipts
        if(modelProbe){
          Object.assign(process.env,{NORI_ROOT:root,NORI_APP_DATA_ROOT:workspace,NORI_INFERENCE_RUNTIME:'gpt-oss',
            NORI_GPT_OSS_ENABLED:'1',NORI_GPT_OSS_HERETIC:'0',NORI_GPT_OSS_SERVER_MODEL:'gpt-oss-20b',
            NORI_GPT_OSS_URL:'http://127.0.0.1:18788',NORI_GPT_OSS_CONTEXT_TOKENS:'8192'})
          const {localChat}=await import('file:///C:/Nori/dev/worktrees/neuralese-artcraft-results/apps/desktop/bridge/local-chat.mjs')
          const observed=[],owned=session,response=[]
          report.modelPlannerTested=true
          for await(const part of localChat({goal,turns:[],modelSelection:'gpt-oss:20b',profile:'balanced',
            signal:AbortSignal.timeout(300000),
            artCraftMcpFactory:async()=>({definitions:owned.definitions,async call(name,args,options){
              const raw=await owned.call(name,args,options);observed.push({tool:name,args,result:JSON.parse(raw)});return raw
            },close:async()=>{}})}))response.push(String(part))
          report.modelPlannerTested=true;report.response=response.join('')
          receipts=observed
          if(receipts.length!==3)throw Error('Model did not execute exactly open, extract and save: '+report.response)
          const opened=receipts[0].result.structuredContent?.doc
          if(receipts[1].args.doc!==opened||receipts[2].args.doc!==opened)throw Error('Model graph did not bind the actual opened document handle')
        }else{
          const plan=graph.translateNeuraleseArtCraftActions({appId,goal,actions,definitions:session.definitions})
          receipts=await graph.dispatchNeuraleseArtCraftPlan({plan,tools:session,goal})
        }
        const returned=receipts[0].result.structuredContent.doc
        if(returned===1||!Number.isSafeInteger(returned))throw Error('PDF probe did not allocate a new handle')
        if(!receipts[1].result.content.some(item=>String(item.text).includes('Nori handle proof')))throw Error('PDF extraction lost the requested text')
        const output=join(workspace,'integrations/artcraft/workspaces/app-sandboxes/pdfcraft/outputs/handle-copy.pdf')
        if(!existsSync(output)||statSync(output).size===0)throw Error('PDF copy was not saved')
        report.results.pdfcraft={passed:true,returnedHandle:returned,actions:receipts.length,savedBytes:statSync(output).size,bindings:receipts.slice(1).map(item=>item.bindings)}
      }else report.results.pdfcraft=await call('artcraft_pdfcraft_doc_open',{path:'handle.pdf'})
    }else{
      await call('artcraft_designcraft_new_document',{title:'Synthetic handle proof',preset:'A4'})
      const create={name:'artcraft_designcraft_execute',args:{command:'frame.create',params:{rect:[36,36,420,180],content:'text',text:'Nori handle proof'}}}
      if(graphProbe){
        const actions=[create,{name:'artcraft_designcraft_get_story',args:{story:{result_of:'n0',field:'story'}}}]
        const plan=graph.translateNeuraleseArtCraftActions({appId,goal,actions,definitions:session.definitions})
        const receipts=await graph.dispatchNeuraleseArtCraftPlan({plan,tools:session,goal})
        if(!receipts[1].result.content.some(item=>String(item.text).includes('Nori handle proof')))throw Error('DesignCraft story text was not recovered')
        report.results.designcraft={passed:true,actions:receipts.length,returnedStory:JSON.parse(receipts[0].result.content[0].text).story,bindings:receipts[1].bindings}
      }else report.results.designcraft=await call(create.name,create.args)
    }
    await session.close();session=null
  }
  report.passed=true
}catch(error){
  report.error=String(error.stack??error).slice(0,2000)
  process.exitCode=1
}finally{
  if(session)await session.close()
  if(!resolve(workspace).startsWith(resolve(tmpdir())+'\\')||!workspace.includes('nori-result-handles-'))throw Error('Unexpected fixture cleanup path')
  rmSync(workspace,{recursive:true,force:true})
}
console.log(JSON.stringify(report))
