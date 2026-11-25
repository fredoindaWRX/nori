import test from 'node:test'
import a from 'node:assert/strict'
import { nativeCodingAdmission } from '../bridge/native-coding.mjs'
// Actual admission and worker-submission modules; only generation and the
// submit boundary are injected. The injected submit prevents token/HTTP access.
const code = null
async function fixture() {
  const calls=[]
  return {calls,async run(goal,proposal,overrides={}) {
    const output=[]
    for await (const value of nativeCodingAdmission({goal,workspace:'C:/Synthetic/project',environment:{},
      generate:async function*(){yield JSON.stringify(proposal)},
      submit:async order=>{calls.push(order);return JSON.stringify({task_id:'a'.repeat(32),status:'awaiting_approval',completed:false})},...overrides})) output.push(value)
    return output
  }}
}
const ready=(allowed,context=[])=>({status:'ready',allowed_files:allowed,context_files:context,question:''});
const TASK='Implement add(a, b) in calculator.py. Preserve multiply(a, b). Edit only calculator.py. Read test_add.py and test_calculator.py without changing them.';
async function reject(goal,proposal,pattern){const f=await fixture(code);await a.rejects(f.run(goal,proposal),pattern);a.equal(f.calls.length,0)}
test('exact task rejects broad editable proposal before submission',()=>reject(TASK,ready(['calculator.py','test_add.py','test_calculator.py']),/(?:exact|explicit) editable/));
test('exact task restores owner readonly context omitted by model and remains pending',async()=>{const f=await fixture(code),out=await f.run(TASK,ready(['calculator.py']));a.deepEqual(Array.from(f.calls[0].allowed),['calculator.py']);a.deepEqual(Array.from(f.calls[0].context),['test_add.py','test_calculator.py']);a.match(out.at(-1),/Review and confirm/);a.doesNotMatch(out.at(-1),/completed|changed successfully/)});
for(const restriction of ['Only edit calculator.py.','Edit only calculator.py.','Please modify only calculator.py.','Only update calculator.py.'])test('equivalent restriction '+restriction,()=>reject('Fix the project. '+restriction,ready(['test_add.py']),/(?:exact|explicit) editable/));
test('model context cannot expand owner readonly scope',()=>reject(TASK,ready(['calculator.py'],['secrets.py']),/cannot expand/));
test('owner readonly file cannot be editable without only-edit declaration',()=>reject('Fix calculator.py. Read test_add.py without changing it.',ready(['test_add.py']),/disjoint/));
for(const suffix of ['Edit only calculator.py and test_add.py.','Edit only calculator.py. Edit only test_add.py.','Read calculator.py without changing it. Edit only calculator.py.'])test('conflicting owner scope '+suffix,async()=>{const f=await fixture(code);let generated=false;await a.rejects(f.run('Fix the project. '+suffix,ready(['calculator.py']),{generate:async function*(){generated=true;yield JSON.stringify(ready(['calculator.py']))}}),/unclear|conflicting|both editable/);a.equal(generated,false);a.equal(f.calls.length,0)});
test('comma before but do not change binds readonly file',async()=>{const f=await fixture(code);await f.run('Fix calculator.py. Edit only calculator.py. Read test_calculator.py, but do not change it.',ready(['calculator.py']));a.deepEqual(Array.from(f.calls[0].context),['test_calculator.py'])});
for(const list of ['test_calculator.py,, test_add.py','test_calculator.py,,'])test('empty owner context component '+list,()=>reject('Fix calculator.py. Edit only calculator.py. Read '+list+' without changing them.',ready(['calculator.py']),/read-only context files/));
test('quoted directives do not establish owner scope',async()=>{const f=await fixture(code);await f.run('Fix the project. The example says "Edit only test_add.py."',ready(['calculator.py']));a.deepEqual(Array.from(f.calls[0].allowed),['calculator.py'])});
for(const model of ['qwen3.5-9b','qwen3.8-27b','nori-auto','gpt-oss-20b'])test('host scope and pending review remain intact for synthetic model '+model,async()=>{const f=await fixture(code);const out=await f.run(TASK,ready(['calculator.py']),{environment:{NORI_GPT_OSS_SERVER_MODEL:model,NORI_AIDER_TASK_APPROVED:'1',NORI_AIDER_CAPABILITY_APPROVED:'1'}});a.equal(f.calls.length,1);a.deepEqual(Array.from(f.calls[0].context),['test_add.py','test_calculator.py']);a.match(out.at(-1),/Review and confirm/)});
test('generic bounded multi-file proposal remains possible and pending',async()=>{const f=await fixture(code),out=await f.run('Fix the project.',ready(['calculator.py','other.py'],['test_add.py']));a.deepEqual(Array.from(f.calls[0].allowed),['calculator.py','other.py']);a.match(out.at(-1),/Review and confirm/)});
test('model editable and model readonly scopes must be disjoint',()=>reject('Fix the project.',ready(['calculator.py'],['calculator.py']),/disjoint/));
test('malformed JSON produces no admission',async()=>{const f=await fixture(code);await a.rejects(f.run('Fix the project.',null,{generate:async function*(){yield '{bad'}}),/malformed/);a.equal(f.calls.length,0)});
test('extra proposal fields produce no admission',()=>reject('Fix the project.',{...ready(['calculator.py']),approved:true},/failed validation/));
test('invalid absolute model path produces no admission',()=>reject('Fix the project.',ready(['C:/outside.py']),/Invalid native coding path/));
test('clarification is not admission',async()=>{const f=await fixture(code),out=await f.run('Fix the project.',{status:'clarify',allowed_files:[],context_files:[],question:'Which file?'});a.equal(f.calls.length,0);a.equal(out.at(-1),'Which file?')});
test('pre-aborted turn does not generate or submit',async()=>{const f=await fixture(code),c=new AbortController();c.abort(new Error('test abort'));let generated=false;await a.rejects(f.run('Fix the project.',ready(['calculator.py']),{signal:c.signal,generate:async function*(){generated=true;yield '{}'}}),/test abort/);a.equal(generated,false);a.equal(f.calls.length,0)});
test('abort during generation cannot submit even if model ignores cancellation',async()=>{const f=await fixture(code),c=new AbortController();await a.rejects(f.run('Fix the project.',null,{signal:c.signal,generate:async function*(){c.abort(new Error('test abort'));yield JSON.stringify(ready(['calculator.py']))}}),/test abort/);a.equal(f.calls.length,0)});
test('overbound model output produces no admission',async()=>{const f=await fixture(code);await a.rejects(f.run('Fix the project.',null,{generate:async function*(){yield 'x'.repeat(16385)}}),/output bound/);a.equal(f.calls.length,0)});

// Windows owner paths are compared conservatively without changing submitted spelling.
test('Windows readonly case alias cannot be editable',()=>reject('Fix calculator.py. Read test_add.py without changing it.',ready(['TEST_ADD.PY']),/disjoint/));
test('Windows editable and readonly case aliases conflict before generation',async()=>{const f=await fixture();let generated=false;await a.rejects(f.run('Fix calculator.py. Edit only calculator.py. Read CALCULATOR.PY without changing it.',ready(['calculator.py']),{generate:async function*(){generated=true;yield JSON.stringify(ready(['calculator.py']))}}),/both editable/);a.equal(generated,false);a.equal(f.calls.length,0)});
test('Windows context alias preserves owner spelling',async()=>{const f=await fixture();await f.run('Fix calculator.py. Read test_add.py without changing it.',ready(['calculator.py'],['TEST_ADD.PY']));a.deepEqual(Array.from(f.calls[0].context),['test_add.py'])});
