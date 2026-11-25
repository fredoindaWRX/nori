import hashlib,json
from pathlib import Path
from build_calendar_visuals import scene_art
folder=Path('C:/Nori/streaming/channel-operator/02-Calendar/Week-1/W1-S2')
groups=[
 'Your Break scene should stop your microphone and Discord.',
 'A Break graphic does not mute audio just because it covers the screen.',
 'Check global audio devices, which can stay active across scenes. Use scene-specific microphone and Discord sources, and leave them out of Break.',
 'Record a rehearsal: talk, switch to Break, then return.',
 'Listen back and check what the file contains.',
 'Fix any audio that leaks through before you go live.',
 'Follow for the next practical build.'
]
script=' '.join(groups)
(folder/'narration.txt').write_text(script+'\n',encoding='utf-8')
plan=json.loads((folder/'SHOT-PLAN.json').read_text(encoding='utf-8'))
labels=['TAKE A REAL BREAK','A GRAPHIC IS NOT A MUTE','GLOBAL OR SCENE?','RECORD THE SCENE SWITCH','LISTEN TO THE RESULT','FIX BEFORE LIVE','BUILD THE NEXT THING']
for shot,title,text in zip(plan['shots'],labels,groups):
 shot.update(title=title,voice_text=text)
 scene_art('W1-S2',title,'' if shot['index']==1 else text,shot['index'])
plan['script_sha256']=hashlib.sha256(script.encode()).hexdigest()
plan['technical_sources']=['https://obsproject.com/kb/audio-sources','C:/Users/Studio/AppData/Roaming/obs-studio/basic/scenes/Nori_Animated_Monitors.json']
plan['source_review']='Official OBS audio source documentation confirms scene-specific versus global capture. Installed Nori collection has null channel1-4 global devices and Break containing only Graphics — Break. Tutorial explains general checks, not an unrecorded successful audio rehearsal.'
plan['status']='Revised production script and illustrations ready; narration and export pending.'
(folder/'SHOT-PLAN.json').write_text(json.dumps(plan,indent=2),encoding='utf-8')
p=folder/'production-package.txt';text=p.read_text(encoding='utf-8-sig')
text=text.replace('Watch the matching full walkthrough through the related-video link.','Follow for the next practical build.')
text=text.replace('No traditional end-screen elements in Shorts; use a related-video link to the released parent.','No traditional end-screen elements in Shorts. Add a related walkthrough only after its release; no nonexistent link is promised.')
p.write_text(text,encoding='utf-8')
print(json.dumps({'characters':len(script),'words':len(script.split()),'scenes':len(groups),'script':script}))
