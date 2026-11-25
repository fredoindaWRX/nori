import json, shutil, subprocess
from pathlib import Path

root=Path('C:/Nori/streaming/channel-operator')
source=root/'02-Calendar/Week-4/W4-MAIN'
target=source/'Fred-MiniMax'
target.mkdir(exist_ok=True)
tools=Path('C:/Nori/streaming/tools')
media=json.loads((tools/'media-tools.json').read_text(encoding='utf-8-sig'))
audio=source/'narration-fred-minimax-original.wav'
assert audio.exists()
normalized=target/'narration-fred.wav'
if not normalized.exists():
    subprocess.run([media['ffmpeg'],'-v','error','-i',str(audio),'-af','loudnorm=I=-16:TP=-2:LRA=11','-ar','48000','-c:a','pcm_s16le',str(normalized)],check=True)
transcript=audio.with_suffix('.transcript.json')
if transcript.exists(): shutil.copy2(transcript,target/'narration-fred.transcript.json')
for name in ['SCENE-ART-MANIFEST.json','narration.txt','thumbnail.png']:
    shutil.copy2(source/name,target/name)
script=(tools/'build_w4_clear_video.py').read_text()
script=script.replace("P=Path('C:/Nori/streaming/channel-operator/02-Calendar/Week-4/W4-MAIN');O=P/'clear-visuals';V=P/'render-work-clear'", "P=Path('C:/Nori/streaming/channel-operator/02-Calendar/Week-4/W4-MAIN/Fred-MiniMax');O=P.parent/'clear-visuals';V=P/'render-work-clear'")
script=script.replace('narration-jordan','narration-fred').replace('Nori-Where-Is-The-Actual-Work-Jordan.mp4','Nori-Where-Is-The-Actual-Work-Fred.mp4')
(tools/'build_w4_fred_video.py').write_text(script)
direction=root/'03-Production/NARRATOR-DIRECTION.json'
previous=json.loads(direction.read_text())
(root/'03-Production/NARRATOR-DIRECTION-before-MiniMax-Fred.json').write_text(json.dumps(previous,indent=2)) if not (root/'03-Production/NARRATOR-DIRECTION-before-MiniMax-Fred.json').exists() else None
direction.write_text(json.dumps({'voice_name':'fred','provider':'MiniMax existing owner voice clone','model':'speech-2.8-hd','owner_instruction':'use fred thats my voice in there','nori_character_voice_change_authorized':False,'owner_preference':'Fred narrates videos; Nori retains her separate voice','quality_accepted':False,'full_episode_audio_downloaded':True,'previous_ethan_rejected':True,'status':'Full narration exported; rebuilding video and checking timing'},indent=2))
(target/'GENERATION-RECORD.json').write_text(json.dumps({'voice':'fred','model':'speech-2.8-hd','credits_before':9542,'credits_after':5836,'credits_used':3706,'purchase_made':False,'speed':1,'pitch':0,'volume':1,'downloaded_source':str(audio),'owner_authorized_clone_use':True,'render_complete':False,'published':False},indent=2))
print(json.dumps({'revision_directory':str(target),'transcript_ready':transcript.exists(),'audio_ready':normalized.exists()}))
