import json, shutil, subprocess
from pathlib import Path
tools=Path('C:/Nori/streaming/tools')
source=Path('C:/Nori/streaming/channel-operator/02-Calendar/Week-3/W3-MAIN')
target=source/'Fred-MiniMax';target.mkdir(exist_ok=True)
media=json.loads((tools/'media-tools.json').read_text(encoding='utf-8-sig'))
audio=target/'narration-fred-original.wav'
assert audio.exists()
normalized=target/'narration-fred.wav'
if not normalized.exists():subprocess.run([media['ffmpeg'],'-v','error','-i',str(audio),'-af','loudnorm=I=-16:TP=-2:LRA=11','-ar','48000','-c:a','pcm_s16le',str(normalized)],check=True)
transcript=audio.with_suffix('.transcript.json')
if transcript.exists():shutil.copy2(transcript,target/'narration-fred.transcript.json')
shutil.copytree(source/'demonstration-evidence',target/'demonstration-evidence',dirs_exist_ok=True)
if (source/'thumbnail.png').exists():shutil.copy2(source/'thumbnail.png',target/'thumbnail.png')
script=(tools/'build_w3_clear_video.py').read_text(encoding='utf-8')
script=script.replace('Week-3/W3-MAIN','Week-3/W3-MAIN/Fred-MiniMax').replace('narration-ethan','narration-fred').replace('Nori-One-Task-Three-Checks-Ethan.mp4','Nori-One-Task-Three-Checks-Fred.mp4')
script=script.replace('when("Today\'s actual")',"when('That recorded check')").replace('TODAY: CONNECTION FAILED','EARLIER CHECK: CONNECTION FAILED')
(tools/'build_w3_fred_video.py').write_text(script,encoding='utf-8')
print(json.dumps({'normalized_audio_ready':normalized.exists(),'transcript_ready':transcript.exists()}))
