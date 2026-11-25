import test from 'node:test'
import assert from 'node:assert/strict'
const moduleUrl=process.env.NORI_RESEARCH_AUDIT_MODULE?new URL(process.env.NORI_RESEARCH_AUDIT_MODULE):new URL('../bridge/research-tools.mjs',import.meta.url)
const {requestsResearch}=await import(moduleUrl)
test('ordinary research and search discussion never grants action routing',()=>{
 for(const input of ['Research tools are useful','Research is interesting','Research methods can help','Research papers are useful','Search tools have limits','News is useful','Can you explain why research is useful?','What research tools can you use?','I want research tools to be faster','"Research Python"','```research Python```','sure run it','good evening'])assert.equal(requestsResearch(input),false,input)
})
test('explicit research/search commands, polite requests, news and scoped follow-ups remain actionable',()=>{
 for(const input of ['Research the official Python documentation','Research whether this approach is useful','Research tools that work offline','Search the web for Python docs','Search for more about that','Look up Python docs','Look that up','Look it up','Could you research Python?','Can you please search the web?','I want you to research Python','I need research on battery life','Use your local research tools to read the docs','Can you use research tools to read this page?','I need to use your research tools to read the docs','Find the latest updates','Can you tell me my local news?','Please show me the latest news','What is the latest news?','Check the local news'])assert.equal(requestsResearch(input),true,input)
})
test('no-search constraints dominate positive research wording',()=>{
 for(const input of ["Don't research this",'Do not search the web','Never look up this information','Research this offline without searching','Research this but do not browse','No web searches please','Avoid online research','Stop searching','Could you research this? Do not search the web.'])assert.equal(requestsResearch(input),false,input)
})
