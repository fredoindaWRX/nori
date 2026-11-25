"""Read-only local planning benchmark; does not dispatch or execute tasks."""
import json,time,urllib.request
from pathlib import Path
SCHEMA={'type':'object','properties':{'tasks':{'type':'array','items':{'type':'object','properties':{'id':{'type':'string'},'worker':{'type':'string','enum':['neo','smith','oracle','merovingian','trinity']},'task':{'type':'string'},'depends_on':{'type':'array','items':{'type':'string'}}},'required':['id','worker','task','depends_on'],'additionalProperties':False}}},'required':['tasks'],'additionalProperties':False}
CASES=[('Implement a Python helper, run its regression tests after implementation, and only then store the verified outcome in memory. Use exactly three tasks: code by Neo, test by Smith, remember by Merovingian.', ['neo','smith','merovingian']),('Retrieve the warranty terms from local documents, independently retrieve the purchase date from memory, then combine both to answer whether coverage remains. Use exactly three tasks: documents by Oracle, memory by Merovingian, answer by Trinity.', ['oracle','merovingian','trinity'])]
def assess(tasks,case):
 if len(tasks)!=3 or len({t['id'] for t in tasks})!=3:return False
 expected=CASES[case][1]
 if [t['worker'] for t in tasks]!=expected:return False
 ids=[t['id'] for t in tasks]
 dependencies=[[],[ids[0]],[ids[1]]] if case==0 else [[],[],ids[:2]]
 return all(set(t['depends_on'])==set(d) for t,d in zip(tasks,dependencies))
def main():
 rows=[]
 for model in ('gemma4:12b','qwen2.5-coder:14b'):
  for i,(prompt,_) in enumerate(CASES):
   body={'model':model,'stream':False,'think':False,'keep_alive':0,'format':SCHEMA,'options':{'num_ctx':4096,'num_predict':768,'temperature':0},'messages':[{'role':'system','content':'Return a task dependency graph. Do not execute anything. Preserve sequential dependencies and independent tasks.'},{'role':'user','content':prompt}]}
   start=time.monotonic()
   req=urllib.request.Request('http://127.0.0.1:11434/api/chat',data=json.dumps(body).encode(),headers={'Content-Type':'application/json'})
   with urllib.request.urlopen(req,timeout=180) as response:r=json.load(response)
   parsed=json.loads(r['message']['content']);passed=assess(parsed['tasks'],i)
   row={'model':model,'case':i,'passed':passed,'seconds':round(time.monotonic()-start,2),'done_reason':r.get('done_reason'),'plan':parsed}
   rows.append(row);print(json.dumps({k:v for k,v in row.items() if k!='plan'}),flush=True)
 out=Path(__file__).resolve().parents[1]/'runtime-data/planner-model-comparison.json';out.write_text(json.dumps({'scope':'Two read-only dependency planning probes; not a general capability benchmark','results':rows},indent=2))
if __name__=='__main__':main()
