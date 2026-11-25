import json,hashlib,shutil,subprocess
from pathlib import Path
R=Path('C:/Nori/streaming/channel-operator'); D=R/'03-Production/Narrator-Comparison/Ethan'
D.mkdir(parents=True,exist_ok=True)
source=Path('C:/Users/Studio/Downloads/d4bc6ac2-077c-41ba-94eb-0205fb775479.mp3')
raw=D/'Fish-Ethan-Original.mp3';assert not raw.exists();shutil.copy2(source,raw)
tools=json.loads(Path('C:/Nori/streaming/tools/media-tools.json').read_text(encoding='utf-8-sig'))
measure=subprocess.run([tools['ffmpeg'],'-hide_banner','-i',str(raw),'-af','loudnorm=I=-16:TP=-2:LRA=8:print_format=json','-f','null','-'],capture_output=True,text=True,check=True)
levels=json.loads(measure.stderr[measure.stderr.rfind('{'):measure.stderr.rfind('}')+1])
chain=f"loudnorm=I=-16:TP=-2:LRA=8:measured_I={levels['input_i']}:measured_TP={levels['input_tp']}:measured_LRA={levels['input_lra']}:measured_thresh={levels['input_thresh']}:offset={levels['target_offset']}:linear=false"
out=D/'Ethan-Conversational-Opening.mp3'
subprocess.run([tools['ffmpeg'],'-v','error','-i',str(raw),'-af',chain,'-ar','48000','-ac','1','-c:a','libmp3lame','-b:a','192k',str(out)],check=True)
subprocess.run([tools['ffmpeg'],'-v','error','-xerror','-i',str(out),'-f','null','-'],check=True)
probe=json.loads(subprocess.check_output([tools['ffprobe'],'-v','error','-show_format','-show_streams','-of','json',str(out)]))
text="A green light says your AI is running. Great. But can it actually do anything? Today we're checking one tiny job: answer a question. First, we check whether the app responds. Then, whether it can reach the model. Finally, whether the answer makes sense. Because an app can be awake and still have absolutely nothing going on upstairs. One job. One result. Let's see what actually works."
(D/'opening.txt').write_text(text+'\n',encoding='utf-8')
record={'voice_name':'Ethan','voice_id':'536d3a5e000945adb7038665781a4aca','provider':'Fish Official default voice','model':'s2.1-pro-free','owner_preference':'A different, more natural narrator','source_blob_id':'d4bc6ac2-077c-41ba-94eb-0205fb775479','paid_spend':0,'tempo':1.0,'pitch_changed':False,'effects':'Loudness normalization only; no added music or effects','full_decode_passed':True,'duration_seconds':float(probe['format']['duration']),'source_sha256':hashlib.sha256(raw.read_bytes()).hexdigest(),'export_sha256':hashlib.sha256(out.read_bytes()).hexdigest(),'human_listening_verified':False,'subjective_naturalness_verified':False,'role':'Narrator audition, not a finished calendar video'}
(D/'AUDIO-QA.json').write_text(json.dumps(record,indent=2)+'\n',encoding='utf-8')
style=R/'03-Production/EDITING-STYLE.txt'
with style.open('a',encoding='utf-8') as f:f.write('\nLATEST OWNER CORRECTION: Videos are confusing and robotic. Owner explicitly selected a different, more natural narrator. This overrides the prior fred-only direction for new revisions. Use only S2.1 Pro Free and no purchases. Ethan is the current candidate; subjective listening is not yet verified. Keep original speaking speed, plain language, one visible task and result, brief purposeful reactions, and fewer abstract diagrams. Existing exports passing technical checks do not establish viewer understanding or natural delivery. Review the ten existing uploads for revisions rather than treating their publication as quality approval.\n')
(R/'03-Production/NARRATOR-DIRECTION.json').write_text(json.dumps(record,indent=2)+'\n',encoding='utf-8')
print(json.dumps({'audio':str(out),'duration_seconds':record['duration_seconds'],'voice':'Ethan','full_decode_passed':True}))
