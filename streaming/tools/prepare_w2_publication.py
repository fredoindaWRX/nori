import json,math
from pathlib import Path
P=Path('C:/Nori/streaming/channel-operator/02-Calendar/Week-2/W2-MAIN')
plan=json.loads((P/'SHOT-PLAN.json').read_text(encoding='utf-8'));qa=json.loads((P/'narration-alignment-check.json').read_text(encoding='utf-8'))
title='OBS Mic + Discord: Separate Audio Without the Echo';assert len(title)<60
labels=['One loud friend','Separate controls for each voice','The Sonar and Discord configuration','Select the microphone device','Keep voice processing natural','Target Discord and use headphones','Test each voice and mute','Avoid duplicate audio capture','Mixer controls versus recording tracks','Select the recording tracks you need','Listen to a real test recording','Next build and monitor setup']
def stamp(t):
 n=math.floor(t);return f'{n//60:02}:{n%60:02}'
chapters=[{'time':stamp(s['start_seconds']),'seconds':s['start_seconds'],'label':label} for s,label in zip(plan['shots'],labels)]
assert chapters[0]['time']=='00:00'
assert all(chapters[i+1]['seconds']-chapters[i]['seconds']>=10 for i in range(len(chapters)-1))
description=("One loud Discord guest should not take over your whole stream. This OBS walkthrough explains how separate microphone and application-audio sources give each voice its own control—and why separate controls do not automatically mean separate tracks in your recording.\n\n"
 "The setup shown uses SteelSeries Sonar Microphone and a Discord application-audio source. We inspect the saved source assignments and the actual OBS recording settings, then walk through the listening test to run before going live.\n\n"
 "This is a configuration walkthrough with original animated illustrations and an actual settings screenshot. It does not show a completed live guest test or a verified multitrack recording from this computer. In the displayed profile, recording is set to track 1 only.\n\n"
 "CHAPTERS\n"+'\n'.join(f"{c['time']} {c['label']}" for c in chapters)+"\n\n"
 "WATCH NEXT\nOBS dual-monitor setup without the mirror effect:\nhttps://www.youtube.com/watch?v=wQCuI-5i0iQ\n\n"
 "Which part causes you trouble: choosing the microphone, capturing Discord, or saving separate tracks? Leave it in the comments. Subscribe for projects, Nori builds, and practical creator fixes.\n\n"
 "Narration uses my AI voice clone. Visuals, reaction cards, and the quiet music motif were created for this episode. Short cutaways come from my own channel.\n\n"
 "#OBS #Discord #StreamingSetup #Nori\n")
(P/'title.txt').write_text(title+'\n',encoding='utf-8');(P/'description.txt').write_text(description,encoding='utf-8')
package={'episode':'W2-MAIN','title':title,'title_characters':len(title),'description':description,
 'tags':['OBS microphone Discord','OBS separate audio tracks','Discord audio capture','SteelSeries Sonar OBS','streaming audio setup'],
 'thumbnail':str(P/'thumbnail.png'),'thumbnail_text':'TURN THAT GUY DOWN','video':str(P/'Separate-Mic-Discord-OBS-Fredo.mp4'),
 'captions':str(P/'captions.srt'),'caption_language':'English (United States)',
 'playlist':'Creator Tools','playlist_id':'PLKwzclKlwEk8','category':'Science & Technology',
 'audience':'Not made for kids','paid_promotion':False,'altered_content_disclosure':True,
 'visibility':'Public','schedule':None,'chapters':chapters,
 'end_screen':{'start_seconds':qa['duration_seconds']-20,'end_seconds':qa['duration_seconds'],
 'elements':[{'type':'video','video_id':'wQCuI-5i0iQ','title':'OBS Dual-Monitor Setup Without the Mirror Effect'},{'type':'subscribe','channel':'FredoIndaWRX'}]},
 'publication_status':'Not uploaded','requires_before_upload':'Final MP4 decode, exported-frame review and measured audio mix check'}
(P/'publishing-package.json').write_text(json.dumps(package,indent=2),encoding='utf-8')
print(json.dumps({'title':title,'characters':len(title),'chapters':chapters,'visibility':'Public'}))
