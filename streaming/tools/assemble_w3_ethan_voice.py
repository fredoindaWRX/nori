import json,hashlib,subprocess
from pathlib import Path
R=Path('C:/Nori/streaming/channel-operator');F=R/'02-Calendar/Week-3/W3-MAIN';V=F/'voice-performance-inputs'
tools=json.loads(Path('C:/Nori/streaming/tools/media-tools.json').read_text(encoding='utf-8-sig'));ff=tools['ffmpeg'];fp=tools['ffprobe']
sources=[V/f'speech-{i:02d}.mp3' for i in range(1,4)];assert all(p.exists() for p in sources)
raw=F/'narration-ethan-original-rate.wav';assert not raw.exists()
inputs=[]
for p in sources:inputs+=['-i',str(p)]
subprocess.run([ff,'-v','error',*inputs,'-filter_complex','[0:a][1:a][2:a]concat=n=3:v=0:a=1[out]','-map','[out]','-ar','48000','-ac','1','-c:a','pcm_s24le',str(raw)],check=True)
def measure(path):
 p=subprocess.run([ff,'-hide_banner','-i',str(path),'-af','loudnorm=I=-16:TP=-2:LRA=8:print_format=json','-f','null','-'],capture_output=True,text=True,check=True)
 return json.loads(p.stderr[p.stderr.rfind('{'):p.stderr.rfind('}')+1])
levels=measure(raw)
chain=f"loudnorm=I=-16:TP=-2:LRA=8:measured_I={levels['input_i']}:measured_TP={levels['input_tp']}:measured_LRA={levels['input_lra']}:measured_thresh={levels['input_thresh']}:offset={levels['target_offset']}:linear=false"
master=F/'narration-ethan.wav';subprocess.run([ff,'-v','error','-i',str(raw),'-af',chain,'-ar','48000','-ac','1','-c:a','pcm_s24le',str(master)],check=True)
out=F/'Ethan-Complete-Episode-Narration.mp3';subprocess.run([ff,'-v','error','-i',str(master),'-c:a','libmp3lame','-b:a','192k',str(out)],check=True)
subprocess.run([ff,'-v','error','-xerror','-i',str(master),'-f','null','-'],check=True)
probe=json.loads(subprocess.check_output([fp,'-v','error','-show_format','-show_streams','-of','json',str(master)]));final=measure(master)
assert float(final['input_tp']) <= -1.0
qa={'voice':'Ethan','voice_id':'536d3a5e000945adb7038665781a4aca','engine':'s2.1-pro-free','paid_spend':0,'tempo':1.0,'pitch_changed':False,'processing':'Loudness normalization only','full_decode_passed':True,'duration_seconds':float(probe['format']['duration']),'measured_mix':final,'source_hashes':[hashlib.sha256(p.read_bytes()).hexdigest() for p in sources],'master_sha256':hashlib.sha256(master.read_bytes()).hexdigest(),'human_listening_verified':False,'subjective_naturalness_verified':False,'video_rendered':False}
(F/'NARRATION-QA.json').write_text(json.dumps(qa,indent=2)+'\n',encoding='utf-8')
record=json.loads((V/'GENERATION-RECORD.json').read_text(encoding='utf-8'));record['generated_chunks']=[{'index':i,'file':str(p),'blob_id':b} for i,(p,b) in enumerate(zip(sources,['d4bc6ac2-077c-41ba-94eb-0205fb775479','b6d4bd42-fa2b-42ab-9cb6-71c21a94a4d6',json.loads((V/'last-block-download.json').read_text())['blob_id']]),1)];record.update(all_chunks_exported=True,assembled_master=str(master),duration_seconds=qa['duration_seconds']);(V/'GENERATION-RECORD.json').write_text(json.dumps(record,indent=2)+'\n',encoding='utf-8')
plan=json.loads((F/'SHOT-PLAN.json').read_text(encoding='utf-8'));plan.update(status='Complete revised Ethan narration exported and technically verified; video assembly pending',actual_narration_duration_seconds=qa['duration_seconds']);(F/'SHOT-PLAN.json').write_text(json.dumps(plan,indent=2)+'\n',encoding='utf-8')
progress=json.loads((R/'03-Production/LONG-FORM-PROGRESS.json').read_text(encoding='utf-8-sig'));progress['current_work']={'id':'W3-MAIN','status':plan['status'],'voice':'Ethan','voice_duration_seconds':qa['duration_seconds'],'voice_tempo':1.0,'local_render_ready':False,'publication_status':'Not uploaded'};(R/'03-Production/LONG-FORM-PROGRESS.json').write_text(json.dumps(progress,indent=2)+'\n',encoding='utf-8')
queue_path=R/'03-Production/Fish-Ready-Scripts/GENERATION-QUEUE.json';queue=json.loads(queue_path.read_text(encoding='utf-8-sig'))
for entry in queue:
 if entry['video_id']=='W3-MAIN':entry.update(status='Complete revised Ethan narration exported and technically checked; final MP4 pending',narration_master=str(master),duration_seconds=qa['duration_seconds'])
queue_path.write_text(json.dumps(queue,indent=2)+'\n',encoding='utf-8')
print(json.dumps({'voice':'Ethan','duration_seconds':qa['duration_seconds'],'loudness':final['input_i'],'true_peak':final['input_tp'],'full_decode_passed':True,'mp4_complete':False}))
