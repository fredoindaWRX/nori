import hashlib,json
from pathlib import Path
from build_calendar_visuals import scene_art
root=Path('C:/Nori/streaming/channel-operator/02-Calendar/Week-2')
revisions={
 'W2-S1':[
 'Discord should not drown out your microphone.',
 'Give your microphone its own source in OBS, and capture Discord through a separate application audio source.',
 'Talk alone, then ask someone on Discord to talk alone.',
 'Check which meter responds in each case.',
 'Now you can adjust Discord and your voice separately.',
 'Look for duplicate desktop capture, then record and listen to a short exchange.',
 'Follow for the next practical build.'
 ],
 'W2-S2':[
 "A moving meter doesn't prove your recording sounds right.",
 'The microphone can reach OBS while the wrong recording track ends up in the file.',
 'Record three short sections: your voice alone, a guest alone, then both of you.',
 'Stop and listen back with headphones.',
 'Check for missing speech, double sound, and clipping.',
 'If you record separate tracks, inspect each track.',
 'Standard players play one audio track at a time.',
 'Follow for the next practical build.'
 ]
}
for id,groups in revisions.items():
 folder=root/id;plan=json.loads((folder/'SHOT-PLAN.json').read_text(encoding='utf-8'));script=' '.join(groups)
 assert len(groups)==len(plan['shots'])
 for shot,text in zip(plan['shots'],groups):
  shot['voice_text']=text
  if shot['index']==len(groups):shot['title']='BUILD THE NEXT THING'
  if id=='W2-S2' and shot['index']==7:shot['title']='CHECK THE PLAYBACK TRACK'
  scene_art(id,shot['title'],'' if shot['index']==1 else text,shot['index'])
 (folder/'narration.txt').write_text(script+'\n',encoding='utf-8')
 plan['script_sha256']=hashlib.sha256(script.encode()).hexdigest()
 plan['technical_sources']=['https://obsproject.com/kb/application-audio-capture-guide','https://obsproject.com/kb/multiple-audio-track-recording-guide']
 plan['source_review']='Current official OBS documentation checked. Separate application sources support independent controls and duplicate desktop capture can cause echo. Standard players play one recording track at a time. No unperformed recording or audio test is claimed.'
 (folder/'SHOT-PLAN.json').write_text(json.dumps(plan,indent=2),encoding='utf-8')
 print(json.dumps({'id':id,'characters':len(script),'words':len(script.split()),'script':script}))
