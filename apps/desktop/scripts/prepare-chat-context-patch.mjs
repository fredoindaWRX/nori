import assert from 'node:assert/strict'
import {createRequire} from 'node:module'
import {writeFileSync} from 'node:fs'
const require=createRequire(import.meta.url),asar=require('@electron/asar')
const archive='C:/Program Files/Nori/resources/app.asar'
const name=asar.listPackage(archive).find(n=>n.slice(1).replaceAll('\\','/')==='bridge/local-chat.mjs')
let text=asar.extractFile(archive,name.slice(1)).toString()
const replace=(before,after)=>{assert.equal(text.split(before).length,2,'Expected one integration anchor');text=text.replace(before,after)}
replace("reaEvidenceContext = '', requestContent = null }) {","reaEvidenceContext = '', requestContent = null, contextTokens = GPT_OSS_CONTEXT_TOKENS }) {")
replace('  const budget = Math.min(projectTools ? GPT_OSS_TOOL_PROMPT_BUDGET : GPT_OSS_PROMPT_BUDGET,\n    GPT_OSS_PROMPT_BUDGET - GPT_OSS_JSON_ENVELOPE_RESERVE - serializedToolBytes',
 '  const promptBudget = contextTokens - GPT_OSS_CONTEXT_SAFETY_TOKENS - GPT_OSS_MIN_OUTPUT_TOKENS\n  const toolPromptBudget = contextTokens >= 65536 ? 24000 : contextTokens === 8192 ? 4500 : 3000\n  const budget = Math.min(projectTools ? toolPromptBudget : promptBudget,\n    promptBudget - GPT_OSS_JSON_ENVELOPE_RESERVE - serializedToolBytes')
replace('estimatedGptOssContext(fitted.messages, tools) < GPT_OSS_CONTEXT_TOKENS - GPT_OSS_MIN_OUTPUT_TOKENS','estimatedGptOssContext(fitted.messages, tools) < contextTokens - GPT_OSS_MIN_OUTPUT_TOKENS')
const ts=require('typescript'),syntax=ts.createSourceFile('local-chat.mjs',text,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS)
const fn=syntax.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='gptOssChat')
assert.ok(fn?.body)
const body=text.slice(fn.body.pos,fn.body.end)
assert.equal(body.split('GPT_OSS_CONTEXT_TOKENS').length,10)
text=text.slice(0,fn.body.pos)+body.replaceAll('GPT_OSS_CONTEXT_TOKENS','contextTokens')+text.slice(fn.body.end)
replace("async function* gptOssChat({ endpoint, modelId, messages, maxTokens, signal, projectTools = null, requestIntent = '' })", "async function* gptOssChat({ endpoint, modelId, messages, maxTokens, signal, projectTools = null, requestIntent = '', contextTokens = GPT_OSS_CONTEXT_TOKENS })")
replace("reaEvidenceContext: reaAppAnalysis || '', requestContent })","reaEvidenceContext: reaAppAnalysis || '', requestContent, contextTokens: config.contextTokens })")
replace('gptOssContextLimits(fitted.promptTokens, profile)','gptOssContextLimits(fitted.promptTokens, profile, config.contextTokens)')
replace('messages: fitted.messages, maxTokens, signal, projectTools, requestIntent: intentGoal })','messages: fitted.messages, maxTokens, signal, projectTools, requestIntent: intentGoal, contextTokens: config.contextTokens })')
text="import automaticModelRouting from '../desktop/automatic-text-service.cjs'\n"+text
replace('  const factCheckMessages = messagesForCurrentIntent(messages, requestIntent)',
 "  const requestedKind = automaticModelRouting.classifyTextTask({messages:[{role:'user',content:requestIntent}]})\n  const taskKind = requestedKind === 'conversation' ? projectTools?.aiderWorker ? 'coding' : projectTools?.researchWorker ? 'research' : 'conversation' : requestedKind\n  const factCheckMessages = messagesForCurrentIntent(messages, requestIntent)")
replace("headers: { 'content-type': 'application/json', accept: 'text/event-stream' },",
 "headers: { 'content-type': 'application/json', accept: 'text/event-stream', ...(modelId === 'nori-auto' ? {'x-nori-task-kind':taskKind} : {}) },")
writeFileSync('C:/Nori/.work/model-team-integration/patch/local-chat.mjs',text)
console.log(JSON.stringify({installedBaselinePreserved:true,contextPropagatedTo:['initial fit','reply budget','tool rounds','continuation']}))
