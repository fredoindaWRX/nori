import hashlib,json,subprocess
from pathlib import Path
F=Path('C:/Nori/streaming/channel-operator/02-Calendar/Week-1/W1-MAIN');T=json.loads(Path('C:/Nori/streaming/tools/media-tools.json').read_text(encoding='utf-8-sig'));plan=json.loads((F/'SHOT-PLAN.json').read_text(encoding='utf-8'))
title='OBS Dual-Monitor Setup Without the Mirror Effect';assert len(title)<60
chapters=[]
for s in plan['shots']:
 sec=int(s['start_seconds']);chapters.append(f'{sec//60:02}:{sec%60:02} {s["title"].title()}')
description='''OBS keeps capturing its own preview? Give your monitors different jobs, check the real display source, and fit the picture without stretching it.

This walkthrough uses my dual-monitor Nori streaming setup, original animated explanations, meme reactions, clips from my own Shorts, and an actual Starting Soon → Break recording. The graphics recording does not test active microphone or Discord audio; record those sources before trusting your own Break scene.

'''+ '\n'.join(chapters)+'''

Watch next — separate your microphone and Discord in OBS:
https://www.youtube.com/shorts/5KxXhG6FNNA

Which part of your setup is fighting you: capture, framing, or sound? Tell me in the comments. Subscribe for practical builds and the progress on Nori.

Narration is AI-generated using my own voice clone. Animated reactions and diagrams are original illustrations; actual OBS captures are labeled in the video.

#OBSStudio #DualMonitors #StreamingSetup #CreatorTools
'''
(F/'description.txt').write_text(description,encoding='utf-8');(F/'title.txt').write_text(title,encoding='utf-8')
package={'id':'W1-MAIN','title':title,'description':description,'tags':['OBS Studio','OBS dual monitor setup','OBS display capture','OBS mirror effect','streaming setup'],'thumbnail_text':'STOP THE OBS MIRROR','thumbnail_asset':'thumbnail.png','video_asset':'OBS-Dual-Monitor-Setup-Fredo.mp4','captions_asset':'captions.srt','language':'English (United States)','playlist':'Creator Tools','visibility':'Public immediately after final QA','scheduled':False,'made_for_kids':False,'end_screen':{'start_seconds':269.9023125-20,'subscribe':True,'specific_video_id':'5KxXhG6FNNA'},'publication_status':'Not uploaded; final MP4 review required.','avatar_used':False,'avatar_requirement_status':'Owner HeyGen account inspected: free plan, zero private avatar groups. Originally requested owner presenter format remains incomplete.'}
(F/'publishing-package.json').write_text(json.dumps(package,indent=2,ensure_ascii=False)+'\n',encoding='utf-8')
print(json.dumps({'title_chars':len(title),'chapters':len(chapters),'hashtags':4,'visibility':'Public','scheduled':False}))
