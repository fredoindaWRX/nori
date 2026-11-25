import hashlib,json
from pathlib import Path
from build_calendar_visuals import scene_art
root=Path('C:/Nori/streaming/channel-operator')
items={
 'W3-S1':{
  'title':'Your AI Says It’s Ready… Then Forgets the Brain','asset':'AI-Running-Not-Ready-Fredo.mp4','overlay':'GREEN LIGHT. NO BRAIN.',
  'groups':[
   ('EXCELLENT TEAMWORK','Green light. No brain. Excellent teamwork.'),
   ('MODEL: MISSING','Your AI can answer a health check while the model it needs is missing.'),
   ('THE LIGHT IS ON','Liveness means the service is alive.'),
   ('CAN IT DO THE JOB?','Readiness means it can handle the useful request.'),
   ('WHERE IS THE CHEF?',"That's the difference between a restaurant being open and actually having a chef."),
   ('TEST ONE REAL REQUEST','Before trusting that green light, send one harmless request and inspect the result.'),
   ('NEXT NORI BUILD','Follow for the next Nori build.')],
  'intro':'Green light, missing model: that’s the joke—and the useful check. Liveness and readiness ask different questions. Before trusting a status light, try one harmless request and inspect its actual result.',
  'tags':['Building Nori','local AI','AI readiness','AI health checks'],'hashtags':'#BuildingNori #LocalAI #AIProjects'},
 'W3-S2':{
  'title':'12 AI Roles, One Brain? Group Project Energy','asset':'AI-Roles-Not-Loaded-Models-Fredo.mp4','overlay':'GROUP PROJECT ENERGY',
  'groups':[
   ('GROUP PROJECT ENERGY','12 job titles. One brain. Group project energy.'),
   ('NAME TAGS ARE NOT MODELS','AI roles describe responsibilities. They do not automatically mean separate loaded models.'),
   ('SHARED INFERENCE','The documented Nori service host groups active roles in one process and shares a local model service.'),
   ('CHECK WHO SHOWED UP','Check which roles are actually active and which model is loaded.'),
   ('COUNT THE REAL REQUESTS','A long roster does not prove every task runs at once.'),
   ('MEASURE BEFORE BRAGGING','Measure memory and latency before bragging about performance.'),
   ('NEXT NORI BUILD','Follow for the next Nori build.')],
  'intro':'AI roles describe responsibilities; loaded models describe inference resources. Nori’s documented service host uses one shared process and a shared local model service. Active roles, loaded models, request limits, memory and latency still need to be checked separately.',
  'tags':['Building Nori','AI agents','local AI','model memory'],'hashtags':'#BuildingNori #AIAgents #LocalAI'},
 'W4-S1':{
  'title':'Your AI Agent Team Has Great Arrows. Where’s the Work?','asset':'Agent-Diagram-Needs-Evidence-Fredo.mp4','overlay':'NICE ARROWS. NOW WHAT?',
  'groups':[
   ('NICE ARROWS. NOW WHAT?','Nice arrows. Did anybody actually do the job?'),
   ('SUPERHERO TEAM?',"An agent diagram can look like a superhero team and still leave the task sitting in reception."),
   ('DELIVER THE TASK','Picking a worker is one step. Delivering the request is another.'),
   ('ACCEPTED IS NOT FINISHED','A queue accepting a task does not prove it finished.'),
   ('FOLLOW THE WHOLE PATH','Trace input, delivery, action, and checked output.'),
   ('SHOW THE RECEIPT','If the path stops, name the missing step. Then show the actual result.'),
   ('NEXT NORI BUILD','Follow for the next Nori build.')],
  'intro':'A useful AI agent diagram should connect to an observable task path: input, recipient, delivery, action and checked output. A route selection or accepted queue item alone doesn’t prove the work finished.',
  'tags':['Building Nori','AI agents','agent workflows','AI projects'],'hashtags':'#BuildingNori #AIAgents #AIProjects'},
 'W4-S2':{
  'title':'Your AI Said “Trust Me Bro.” Test It Anyway','asset':'First-AI-Project-Test-Fredo.mp4','overlay':'TRUST ME BRO?',
  'groups':[
   ('TRUST ME BRO?','Your AI said, trust me bro. Test it anyway.'),
   ('ONE HARMLESS TASK','Pick one harmless task and define exactly what passing looks like.'),
   ('CONFIDENCE IS NOT PROOF','If the answer sounds confident, congratulations. You have confidence. You still need evidence.'),
   ('KEEP THE RECEIPTS','Record the input, the request path, and the actual output.'),
   ('BREAK ONE THING','Then test one failure, like a missing dependency or an invalid request.'),
   ('START SMALL','Keep the task small enough to explain and the result easy to inspect.'),
   ('NEXT NORI BUILD','Follow for the next Nori build.')],
  'intro':'Define one harmless AI task with a result you can inspect. Record the input, request path and output, then test one failure case. The acceptance check should match your task, rather than how confident the answer sounds.',
  'tags':['Building Nori','AI testing','AI projects','acceptance testing'],'hashtags':'#BuildingNori #AITesting #AIProjects'}
}
sources=['C:/Nori/nori/shared/model-service/README.md','C:/Nori/nori/shared/orchestration/README.md','C:/Nori/NORI_ARCHITECTURE.txt',
 'https://kubernetes.io/docs/concepts/workloads/pods/probes/']
for id,item in items.items():
 folder=root/'02-Calendar'/('Week-'+id[1])/id
 assert not list(folder.glob('*.mp4')), 'Do not revise published or rendered media inputs'
 script=' '.join(t for _,t in item['groups'])
 shots=[]
 for i,(title,text) in enumerate(item['groups'],1):
  scene_art(id,title,'' if i==1 else text,i)
  shots.append({'index':i,'title':title,'voice_text':text,'asset':f'visuals/scene-{i:02d}.png','asset_role':'Explanatory illustration; not a live demonstration'})
 plan={'video_id':id,'voice_provider':'Fish Audio','model_id':'b27ff51a95a14d02973baec32ba7a643',
  'script_sha256':hashlib.sha256(script.encode()).hexdigest(),'shots':shots,
  'technical_sources':sources,'source_review':'Current local source documentation reviewed. Shared role host and shared inference are documented; no deployment, completed live task or performance result is claimed. Liveness/readiness meaning checked against primary Kubernetes documentation.',
  'timing_status':'Pending actual generated speech alignment','status':'Final script and illustration inputs prepared; MP4 not rendered',
  'required_remaining_inputs':['Fish narration','Measured captions and scene timing','Final MP4 rendering and review']}
 (folder/'narration.txt').write_text(script+'\n',encoding='utf-8');(folder/'SHOT-PLAN.json').write_text(json.dumps(plan,indent=2),encoding='utf-8')
 package={'video_id':id,'title':item['title'],'description':item['intro']+'\n\nBuilding Nori: one useful concept at a time. Explained with diagrams; no unperformed live test is claimed. Narration is AI-generated from my own voice.\n\nSubscribe to FredoIndaWRX for projects, practical creator tools, and the next Nori build.\n\n'+item['hashtags'],
  'tags':item['tags'],'thumbnail_overlay':item['overlay'],'cover_asset':'cover-frame.png','video_asset':item['asset'],'caption_asset':'captions.srt',
  'chapter_timestamps':'Omitted for this Short.','visibility_intent':'public','planned_publish':'Immediate after verified production; user requested no scheduling',
  'actual_upload_status':'Not uploaded','publishing_hold':None,'license_status':'User authorized Fish narration; service-license commercial classification unresolved. No paid spend.',
  'presenter_format':'Original animated Nori comic graphics and explanatory diagrams; owner HeyGen avatar remains unconfigured.',
  'playlist':'Building Nori','playlist_id':None,'related_video_id':None,'related_video_title':None}
 assert len(package['title'])<60
 (folder/'publishing-package.json').write_text(json.dumps(package,indent=2,ensure_ascii=False),encoding='utf-8')
 print(json.dumps({'id':id,'words':len(script.split()),'characters':len(script),'title':item['title']}))
