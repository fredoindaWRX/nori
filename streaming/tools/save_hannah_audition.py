import json, shutil, subprocess, hashlib
from pathlib import Path

out=Path('C:/Nori/streaming/channel-operator/03-Production/Narrator-Comparison/Hannah')
out.mkdir(parents=True, exist_ok=True)
source=Path('C:/Users/Studio/Downloads/544a4a63-5210-43f2-a711-0d51d77f64ab.mp3')
audio=out/'Hannah-Conversational-Sample.mp3'
assert not audio.exists(), 'Preserve existing audition'
shutil.copy2(source,audio)
text="Okay, Nori says it's ready. Cool. Ready to do what? Because a green light doesn't mean the job got done. So here's the test: one tiny task, one real answer. No twelve-agent group project. Just do the thing. And if it breaks? Show me what broke. That's actually useful."
(out/'sample.txt').write_text(text,encoding='utf-8')
bin=Path('C:/Nori/streaming/tools/ffmpeg/ffmpeg-9.0.2-essentials_build/bin')
probe=json.loads(subprocess.check_output([str(bin/'ffprobe.exe'),'-v','error','-show_format','-show_streams','-of','json',str(audio)],text=True))
subprocess.run([str(bin/'ffmpeg.exe'),'-v','error','-i',str(audio),'-f','null','-'],check=True)
qa=dict(voice='Hannah',voice_id='9a9cf47702da476aa4629e2506d4a857',provider='Fish Official',model='s2.1-pro-free',paid_spend=0,source_blob_id='544a4a63-5210-43f2-a711-0d51d77f64ab',duration_seconds=float(probe['format']['duration']),full_decode_passed=True,tempo_changed=False,pitch_changed=False,owner_accepted=False,subjective_naturalness_verified=False,role='Short voice audition; not a calendar deliverable',sha256=hashlib.sha256(audio.read_bytes()).hexdigest())
(out/'AUDIO-QA.json').write_text(json.dumps(qa,indent=2),encoding='utf-8')
print(json.dumps(qa,indent=2))
