import assert from'node:assert/strict';import{createRequire}from'node:module';import{readFileSync,writeFileSync,mkdirSync,existsSync}from'node:fs';import{createHash}from'node:crypto';
const a=createRequire(import.meta.url)('@electron/asar'),stage='C:/Nori/.work/rea-route-repair',root='C:/Nori/apps/desktop/',archive='C:/Program Files/Nori/resources/app.asar';assert.ok(!existsSync(stage));mkdirSync(stage);const ns=a.listPackage(archive),h=b=>createHash('sha256').update(b).digest('hex');
function patchRea(s){
 const old="&& /\\b(?:analy[sz]e|inspect|reverse[- ]engine(?:er|ing)|use|run|invoke)\\b/i.test(text)";
 assert.equal(s.split(old).length,2);
 s=s.replace(old,"&& (/\\b(?:analy[sz]e|inspect|reverse[- ]engine(?:er|ing)|use|run|invoke)\\b/i.test(text)\n      || /^\\s*(?:please\\s+)?rea\\s+(?!(?:is|was|has|can|means|supports|version|tools?)\\b)\\S/i.test(text))");
 const anchor='export function requestsNoriReaSetup(goal) {';assert.equal(s.split(anchor).length,2);
 const helper=`export function resolveNoriReaIntent(goal, turns = []) {\n  const input = String(goal ?? '').trim()\n  if (requestsNoriRea(input)) return input\n  let target = input\n  if (['"', "'", '\\x60'].includes(input[0]) && input.at(-1) === input[0]) target = input.slice(1, -1)\n  if (target.length > 1024 || !/^[A-Za-z]:\\\\[^<>:"|?*\\r\\n'\\x60]+\\.(?:exe|dll|asar)$/i.test(target)) return input\n  const users = (Array.isArray(turns) ? turns : []).filter(turn => turn?.role === 'user' && typeof turn.text === 'string')\n  if (users.at(-1)?.text.trim() === input) users.pop()\n  const previous = users.at(-1)?.text\n  if (!previous || !requestsNoriRea(previous) || requestedNoriReaTarget(previous)?.needsPath !== true) return input\n  return 'Use REA to statically inspect "' + target + '". Do not launch or modify the target.'\n}\n\n`;
 return s.replace(anchor,helper+anchor)
}
function patchChat(s){const from='noriReaSetupResponse, requestedNoriReaTarget, requestsNoriRea, requestsNoriReaSetup';assert.equal(s.split(from).length,2);s=s.replace(from,from+', resolveNoriReaIntent');const old='const intentGoal = splitNativeWorkspaceBackground(goal).request';assert.equal(s.split(old).length,2);return s.replace(old,'const intentGoal = resolveNoriReaIntent(splitNativeWorkspaceBackground(goal).request, turns)')}
const sourcePlan=[];
for(const [file,patch]of [['rea-tools.mjs',patchRea],['local-chat.mjs',patchChat]]){
 const n=ns.find(x=>x.endsWith('bridge\\'+file)),b=a.extractFile(archive,n.slice(1)),next=patch(b.toString());writeFileSync(stage+'/'+file,next);
 const p=root+'bridge/'+file,old=readFileSync(p),sourceNext=patch(old.toString()),incoming=stage+'/source-'+file;writeFileSync(incoming,sourceNext);sourcePlan.push({path:p,before:h(old),after:h(Buffer.from(sourceNext)),source:incoming,backup:stage+'/source-'+file+'.previous'})
}
writeFileSync(stage+'/source-plan.json',JSON.stringify(sourcePlan,null,2));console.log('Prepared installed and source REA routing corrections');
