/* Nori's chat-first coding status. Host receipts supply facts; this UI grants no task authority. */
;(function () {
  'use strict'
  const ID = /^[a-f0-9]{32}$/
  const PHASES = new Set(['registered','inspecting','awaiting_session_consent','scope_ready','queued','editing','verifying','completed','blocked','failed','cancelled'])
  const TERMINAL = new Set(['completed','blocked','failed','cancelled'])
  const bytes = value => new TextEncoder().encode(value).byteLength
  function binding(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || !ID.test(value.ownerTurnId)
        || !ID.test(value.runId) || value.taskId !== value.runId) return null
    return {ownerTurnId:value.ownerTurnId,runId:value.runId,taskId:value.taskId}
  }
  function event(value, expected) {
    if (!expected || !value || value.schema !== 'nori.coding-run-event.v1' || value.owner_turn_id !== expected.ownerTurnId
        || value.run_id !== expected.runId || value.task_id !== expected.taskId || !PHASES.has(value.phase)
        || !Number.isSafeInteger(value.sequence) || value.sequence < 1 || value.sequence > 1e9
        || typeof value.message !== 'string' || value.message.length > 2000) return null
    if (value.diff !== undefined && (typeof value.diff !== 'string' || bytes(value.diff)>32768)) return null
    if (value.changed_files !== undefined && (!Array.isArray(value.changed_files) || value.changed_files.length>24
        || value.changed_files.some(path=>typeof path!=='string'||!path||path.length>240||/[\x00-\x1f\x7f\\:]/.test(path)
          ||path.startsWith('/')||path.split('/').some(part=>!part||part==='.'||part==='..')))) return null
    if (value.verification !== undefined) {
      const v=value.verification
      if (!v || typeof v!=='object' || !['not_run','running','passed','failed','cancelled','blocked'].includes(v.status)
          || !['python-unittest','node-test'].includes(v.runner) || !(v.exit_code===null||Number.isSafeInteger(v.exit_code))
          || typeof v.stdout!=='string'||bytes(v.stdout)>65536||typeof v.stderr!=='string'||bytes(v.stderr)>65536
          || typeof v.output_truncated!=='boolean'||typeof v.process_tree_stopped!=='boolean') return null
    }
    return value
  }
  function install(document,window) {
    if (window !== window.top || window.noriCodingChat) return window.noriCodingChat || null
    const api=window.noriCodingSession
    if(typeof api?.registerTurn!=='function')return null
    const workspaceApi=window.noriWorkerWorkspace,runs=new Map(),root=document.createElement('section')
    root.id='nori-coding-chat';root.setAttribute('aria-label','Coding work in this conversation')
    const style=document.createElement('style');style.textContent='#nori-coding-chat{margin:12px 0;padding:12px;border:1px solid #355750;border-radius:10px;color:inherit;font:13px/1.5 system-ui,sans-serif}#nori-coding-chat button{font:inherit;border:1px solid #426c64;background:#18332e;color:#c6f4eb;border-radius:7px;padding:7px 10px;margin:4px;cursor:pointer}#nori-coding-chat button:disabled{opacity:.5;cursor:default}#nori-coding-chat pre{white-space:pre-wrap;overflow-wrap:anywhere;max-height:24rem;overflow:auto;font:12px/1.5 ui-monospace,monospace}#nori-coding-chat article{border-top:1px solid #355750;margin-top:10px;padding-top:10px}#nori-coding-chat details{margin-top:8px}'
    style.textContent+='#nori-coding-composer-host{position:absolute;z-index:15;pointer-events:auto;left:50%;bottom:120px;transform:translateX(-50%);width:min(680px,70vw);max-height:40vh;overflow:auto}.nori-workspace #nori-coding-composer-host{left:calc((100vw - var(--workspace-sidebar) - var(--workspace-inspector)) / 2 + var(--workspace-sidebar));width:calc(100vw - var(--workspace-sidebar) - var(--workspace-inspector) - 64px);max-width:1100px}html[data-workspace="span"] #nori-coding-composer-host{left:calc(var(--workspace-home-x) + var(--workspace-home-w) / 2);top:calc(var(--workspace-home-y) + var(--workspace-home-h) - 150px);bottom:auto;transform:translate(-50%,-100%);max-width:calc(var(--workspace-home-w) - 120px)}'
    // Claude Code style (owner, 2026-11-16): no form. A remembered project starts at once; each run is a task list.
    style.textContent+="section#nori-coding-chat.ncc-v2{border:0;background:none;padding:6px 0;font:13px/1.45 'Segoe UI',system-ui,sans-serif;color:#c4d8fa}section#nori-coding-chat.ncc-v2>strong{display:none}section#nori-coding-chat.ncc-v2>p{margin:2px 0;color:#7f97c2;font-size:12px}section#nori-coding-chat.ncc-v2>button{all:unset;cursor:pointer;color:#8fc0ff;font-size:12px;margin:0 12px 4px 0;text-decoration:underline;text-underline-offset:2px}section#nori-coding-chat.ncc-v2>button:disabled{opacity:.45;cursor:default}section#nori-coding-chat.ncc-v2[data-allowed='1']>.ncc-session,section#nori-coding-chat.ncc-v2[data-allowed='1']>.ncc-grant{display:none}section#nori-coding-chat.ncc-v2[data-allowed='0']>.ncc-revoke{display:none}section#nori-coding-chat.ncc-v2 article{margin:8px 0;padding:12px 14px;border:1px solid rgba(120,170,255,.2);border-radius:14px;background:rgba(7,13,26,.72)}section#nori-coding-chat.ncc-v2 article>strong{display:block;color:#e6f0ff;font-weight:600;margin-bottom:4px}section#nori-coding-chat.ncc-v2 article p{margin:4px 0;color:#b9cff5}section#nori-coding-chat.ncc-v2 article button{all:unset;cursor:pointer;color:#ff9c9c;font-size:12px;text-decoration:underline;margin-top:6px}section#nori-coding-chat.ncc-v2 article button:disabled{opacity:.4;cursor:default}.ncc-steps{list-style:none;margin:6px 0;padding:0}.ncc-steps li{display:flex;gap:10px;align-items:center;padding:3px 0;color:#9fb8e6}.ncc-steps li::before{content:'';flex:0 0 15px;width:15px;height:15px;box-sizing:border-box;border-radius:50%;border:1.5px dashed #5f7fb0;display:inline-flex;align-items:center;justify-content:center;font-size:11px;line-height:1}.ncc-steps li.done{color:#9fb8e6}.ncc-steps li.done::before{content:'\\2713';color:#6fd3a6;border:0}.ncc-steps li.now{color:#f0f6ff;font-weight:500}.ncc-steps li.now::before{border:2px solid rgba(143,192,255,.25);border-top-color:#8fc0ff;animation:ncc-spin .9s linear infinite}@keyframes ncc-spin{to{transform:rotate(360deg)}}.ncc-steps li.bad{color:#ffb0b0}.ncc-steps li.bad::before{content:'\\2715';color:#ff8a8a;border:0}";root.classList.add('ncc-v2');root.dataset.allowed='0'
    const STEPS=[['registered','Read the request'],['inspecting','Look at the project'],['scope_ready','Pick the files'],['queued','Hand off to the coder'],['editing','Edit the code'],['verifying','Run the tests'],['completed','Done']]
    function paintSteps(list,phase){const at=phase==='awaiting_session_consent'?1:STEPS.findIndex(([name])=>name===phase),failed=at<0;if(!list.children.length)for(const [,label] of STEPS){const li=document.createElement('li');li.textContent=label;list.appendChild(li)}const reached=failed?Number(list.dataset.at||0):at;if(!failed)list.dataset.at=String(at);[...list.children].forEach((li,i)=>{li.className=failed?(i<reached?'done':i===reached?'bad':''):phase==='completed'?'done':i<at?'done':i===at?'now':''})}
    root.appendChild(style)
    const node=(tag,text)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;return n}
    root.appendChild(node('strong','Coding work'))
    const project=node('p','Coding project: checking…'),choose=node('button','Choose coding project'),history=node('button','Task history')
    choose.type=history.type='button';history.setAttribute('aria-expanded','false')
    const session=node('p','Coding permission has not been checked. Each request stays bound to the selected project.')
    const grant=node('button','Allow coding in this project…'),revoke=node('button','Stop allowing this project'),feedback=node('p'),held=node('div'),cards=node('div')
    session.className='ncc-session';grant.className='ncc-grant';revoke.className='ncc-revoke'
    grant.type=revoke.type='button';feedback.setAttribute('role','status');feedback.setAttribute('aria-live','polite')
    root.appendChild(project);root.appendChild(choose);root.appendChild(session);root.appendChild(grant);root.appendChild(revoke);root.appendChild(history);root.appendChild(feedback);root.appendChild(held);root.appendChild(cards)
    let disposed=false,generation=0,pending=null,consentBusy=false,projectBusy=false,projectGeneration=0,historyOpen=false,unsubscribe=null
    function syncHistory(){const legacy=document.getElementById('nori-neurons-activity');if(legacy&&legacy.hidden!==!historyOpen)legacy.hidden=!historyOpen;history.setAttribute('aria-expanded',String(historyOpen));// Write only on change: mount() runs from a subtree MutationObserver, so an unconditional text write re-triggers it forever.
const label=historyOpen?'Hide task history':'Task history';if(history.textContent!==label)history.textContent=label}
    function mount(){if(disposed)return;const holder=document.getElementById('nori-inline-coding-host')||document.getElementById('nori-coding-composer-host');if(holder&&root.parentNode!==holder)holder.appendChild(root);syncHistory()}
    function buttons(){grant.disabled=revoke.disabled=consentBusy||projectBusy;grant.disabled||=typeof api?.grant!=='function';revoke.disabled||=typeof api?.revoke!=='function';choose.disabled=consentBusy||projectBusy||typeof workspaceApi?.select!=='function'}
    function projectResult(value){if(!value||(value.workspace!==null&&(typeof value.workspace!=='string'||value.workspace.length>32767)))throw Error('Invalid project status');project.textContent='Coding project: '+(value.workspace||'Not selected');if(value.error)throw Error('Project status unavailable');if(value.restartRequired)feedback.textContent='This project selection is not active yet. No coding permission is assumed.'}
    async function readProject(){const epoch=++projectGeneration;try{const value=await workspaceApi?.read();if(!disposed&&epoch===projectGeneration)projectResult(value)}catch{if(!disposed&&epoch===projectGeneration)project.textContent='Coding project: unavailable. Use the normal project picker.'}}
    function validSession(value){return value&&typeof value.enabled==='boolean'&&typeof value.active==='boolean'&&value.active===value.enabled&&(value.project===null||typeof value.project==='string')}
    async function sessionStatus(){try{const s=await api?.status();if(!validSession(s))throw Error();root.dataset.allowed=s.enabled?'1':'0';session.textContent=s.enabled?'Coding is allowed for '+s.project+'. Requests remain scoped; tests and real results appear here.':'Allow this selected project once to let Nori carry out routine coding requests here.';return s}catch{session.textContent='Coding session status is unavailable. No coding permission is assumed.';return null}}
    function cancelHeld(message){if(!pending)return;const p=pending;pending=null;held.replaceChildren();p.reject(Error(message))}
    function showHeld(rawGoal){held.replaceChildren();held.appendChild(node('p','This coding request has not been sent. Allow the selected project to continue.'));held.appendChild(node('p',rawGoal.slice(0,1000)));const cancel=node('button','Cancel this unsent request');cancel.type='button';cancel.addEventListener('click',()=>cancelHeld('Coding request canceled before submission.'));held.appendChild(cancel);mount()}
    async function registerTurn({rawGoal,clientTurnId,onCancel}={}) {
      if(disposed||typeof rawGoal!=='string'||typeof clientTurnId!=='string'||!clientTurnId||clientTurnId.length>128)throw Error('Invalid coding turn registration.')
      if(typeof api?.registerTurn!=='function')return null
      const epoch=++generation;cancelHeld('A newer request replaced this unsent coding request.')
      async function register(){
        while(runs.size>=8){const finished=[...runs.entries()].find(([,run])=>run.terminal);if(!finished)throw Error('Too many coding runs are displayed. Stop existing work first.');clearTimeout(finished[1].timer);finished[1].ui.card.remove();runs.delete(finished[0])}
        const result=await api.registerTurn({rawGoal,clientTurnId})
        if(disposed||epoch!==generation)throw Error('The coding request changed before submission.')
        if(result?.clientTurnId!==clientTurnId)throw Error('Coding registration belongs to another request.')
        if(result.registered===false&&result.reason==='not_coding'&&result.coding===false)return null
        if(result.registered===false&&result.reason==='session_consent_required')return 'consent'
        const bound=binding(result)
        if(result.registered!==true||!bound)throw Error('Coding registration was not verified. No request was sent.')
        if(runs.has(bound.runId))throw Error('Coding registration reused an existing run. No new request was sent.')
        const run={binding:bound,ask:clientTurnId,sequence:0,terminal:false,onCancel,polling:false,timer:null,stopped:false}
        runs.set(bound.runId,run);makeCard(run);schedule(run,0);mount();return bound
      }
      const result=await register();if(result!=='consent')return result
      showHeld(rawGoal);feedback.textContent='Waiting for your OK to code in this project.'
      // Ask straight away instead of waiting for a button press: the consent dialog opens once per project.
      window.setTimeout(()=>{void allowProject()},0)
      return new Promise((resolve,reject)=>{pending={epoch,rawGoal,resolve,reject,register}})
    }
    async function allowProject(){
      if(disposed||consentBusy||projectBusy||typeof api?.grant!=='function')return
      consentBusy=true;buttons();const epoch=generation
      try{
        const result=await api.grant()
        if(disposed||epoch!==generation)return
        if(!validSession(result)||!result.enabled){feedback.textContent='Coding permission was not granted. The request has not been sent.';return}
        await sessionStatus();feedback.textContent='Project consent is active. Nori will use only this request’s bounded coding scope.'
        const p=pending
        if(p&&p.epoch===generation){const bound=await p.register();if(bound==='consent'||!bound)throw Error('Fresh coding registration was not verified.');pending=null;held.replaceChildren();p.resolve(bound)}
      }catch{feedback.textContent='Coding permission or registration was not verified. No new request was sent.'}
      finally{consentBusy=false;buttons()}
    }
    function makeCard(run){
      const card=node('article'),title=node('strong','Preparing the coding request'),message=node('p','Owner registration is verified; Nori has not reported code changes.'),files=node('p'),stop=node('button','Stop this coding run'),diff=node('details'),diffLabel=node('summary','Code changes'),diffText=node('pre'),verification=node('p','Tests have not been reported.'),output=node('details'),outputLabel=node('summary','Test output'),outputText=node('pre')
      card.dataset.runId=run.binding.runId;stop.type='button';diff.appendChild(diffLabel);diff.appendChild(diffText);output.appendChild(outputLabel);output.appendChild(outputText);diff.hidden=output.hidden=true
      card.appendChild(title);card.appendChild(message);card.appendChild(files);card.appendChild(verification);card.appendChild(diff);card.appendChild(output);card.appendChild(stop);cards.appendChild(card)
      stop.addEventListener('click',async()=>{if(run.terminal||run.stopped)return;run.stopped=true;stop.disabled=true;const cancelQuery=run.onCancel;try{const result=await api.stop(run.binding);if(result?.event)receive(result.event);if(typeof cancelQuery==='function')cancelQuery();if(result?.stopped!==true)feedback.textContent='Stop is not yet confirmed. Existing edits are not undone.'}catch{feedback.textContent='Stop could not be verified. Existing edits may remain.'}finally{if(!run.terminal){run.stopped=false;stop.disabled=false}}})
      const steps=node('ul');steps.className='ncc-steps';card.insertBefore(steps,message);paintSteps(steps,'registered')
      run.ui={card,title,message,files,stop,diff,diffText,verification,output,outputText,steps}
    }
    function receive(value){
      const run=runs.get(value?.run_id),valid=event(value,run?.binding)
      if(!run||!valid||run.terminal||valid.sequence<=run.sequence)return false
      run.sequence=valid.sequence;const ui=run.ui
      ui.title.textContent='Coding · '+valid.phase.replaceAll('_',' ');ui.message.textContent=valid.message;paintSteps(ui.steps,valid.phase)
      ui.files.textContent=valid.changed_files?.length?'Changed files: '+valid.changed_files.join(', '):''
      ui.diffText.textContent=valid.diff||'';ui.diff.hidden=!valid.diff
      if(valid.verification){const v=valid.verification;ui.verification.textContent='Tests · '+v.status.replaceAll('_',' ')+(v.exit_code===null?'':' · exit '+v.exit_code)+(v.output_truncated?' · output truncated':'');ui.outputText.textContent=v.stdout+(v.stderr?'\n'+v.stderr:'');ui.output.hidden=!ui.outputText.textContent}
      if(TERMINAL.has(valid.phase)){run.terminal=true;clearTimeout(run.timer);ui.stop.disabled=true;run.onCancel=null}
      mount();return true
    }
    function schedule(run,delay=1000){if(disposed||run.terminal||run.timer)return;run.timer=window.setTimeout(async()=>{run.timer=null;if(disposed||run.terminal||run.polling)return;run.polling=true;try{const result=await api.runStatus(run.binding);if(!result?.event||!event(result.event,run.binding))throw Error();receive(result.event)}catch{run.ui.message.textContent='Coding status is unavailable. No completion is assumed.'}finally{run.polling=false;if(!disposed&&!run.terminal)schedule(run)}},delay)}
    function receiveBridge(frame,ask){if(frame?.type!=='coding_run_event'||frame.ask!==ask)return false;const run=runs.get(frame.event?.run_id);return !!run&&run.ask===ask&&receive(frame.event)}
    function finishTurn(ask){for(const run of runs.values())if(run.ask===ask)run.onCancel=null}
    function interrupt(){generation++;cancelHeld('Coding request canceled before submission.');for(const run of runs.values())run.onCancel=null;Promise.resolve(api?.revoke()).then(sessionStatus).catch(()=>{});}
    function reset(){interrupt();for(const run of runs.values())clearTimeout(run.timer);runs.clear();cards.replaceChildren();feedback.textContent='';}
    grant.addEventListener('click',allowProject);revoke.addEventListener('click',()=>{generation++;cancelHeld('Coding request canceled before submission.');for(const run of runs.values())run.onCancel=null;Promise.resolve(api?.revoke({forget:true})).then(sessionStatus).catch(()=>{});feedback.textContent='This project is no longer allowed. Already-started edits are not undone. The next coding request will ask again.'})
    choose.addEventListener('click',async()=>{if(disposed||consentBusy||projectBusy||typeof workspaceApi?.select!=='function')return;projectBusy=true;projectGeneration++;buttons();try{projectResult(await workspaceApi.select());await sessionStatus();feedback.textContent='Project selection checked. Allow coding for this selected project before the next coding request.'}catch{feedback.textContent='Project selection was not verified. Finish or stop pending work before switching.'}finally{projectBusy=false;buttons();await readProject();await sessionStatus()}})
    history.addEventListener('click',()=>{historyOpen=!historyOpen;syncHistory()})
    const observer=new window.MutationObserver(mount);observer.observe(document.documentElement,{childList:true,subtree:true})
    if(typeof api?.subscribe==='function')unsubscribe=api.subscribe(value=>receive(value))
    window.addEventListener('pagehide',()=>{disposed=true;generation++;cancelHeld('Coding view closed before submission.');for(const run of runs.values())clearTimeout(run.timer);observer.disconnect();if(typeof unsubscribe==='function')unsubscribe();Promise.resolve(api?.revoke()).catch(()=>{})},{once:true})
    const client={registerTurn,receiveBridge,finishTurn,interrupt,reset,root,receive,sessionStatus};window.noriCodingChat=client;buttons();mount();void sessionStatus();void readProject();return client
  }
  if(typeof module==='object'&&module.exports)module.exports={binding,event,install}
  if(typeof window==='object'&&typeof document==='object')install(document,window)
})()
