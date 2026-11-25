import test from 'node:test'
import assert from 'node:assert/strict'
const source=process.env.NORI_SKILL_STATUS_AUDIT_MODULE?new URL(process.env.NORI_SKILL_STATUS_AUDIT_MODULE):new URL('../bridge/skill-catalog-status.mjs',import.meta.url)
const {requestsInstalledSkillCatalog}=await import(source)
export const liveRequest='List your verified installed instruction skills from your managed local catalog. Include integrity/provenance and whether they can execute code. Do not install or change anything.'
test('exact live execution-status request remains a read-only catalog query',()=>{
 for(const request of [liveRequest,'List your installed skills. Include whether they can run code. Do not install anything or edit files.','Show your skill catalog; do not install or change anything.','Do not install or change anything. List your installed skills.','List your managed skills and tell me if these skills can execute code.','Which of your installed skills can execute code?','What installed skills can run code?'])assert.equal(requestsInstalledSkillCatalog(request),true,request)
})
test('capability metadata cannot hide positive execute/install or independent file actions',()=>{
 for(const request of ['List your installed skills. Include whether they can execute code. Then execute code.','List your installed skills and run code.','List your installed skills. Can they execute code? Then do it.','List your installed skills. Include whether they can run code, then install a package.','List your installed skills. Do not install or change anything. Read calculator.py.','List your installed skills. Can they run code? Open the selected project.'])assert.equal(requestsInstalledSkillCatalog(request),false,request)
})
test('metadata/no-mutation language never overrides a negated catalog read',()=>{
 for(const request of ['Do not show your installed skills. Include whether they can execute code.','Never list your skill catalog. Do not install or change anything.','Do not use tools to list your installed skills. Include whether they can run code.','Do not install or change anything.'])assert.equal(requestsInstalledSkillCatalog(request),false,request)
})
