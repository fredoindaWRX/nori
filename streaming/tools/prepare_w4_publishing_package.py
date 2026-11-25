import json,re
from pathlib import Path
P=Path('C:/Nori/streaming/channel-operator/02-Calendar/Week-4/W4-MAIN')
tr=json.loads((P/'narration-jordan.transcript.json').read_text());plan=json.loads((P/'SHOT-PLAN.json').read_text())
words=[w for s in tr['segments'] for w in s['words']]
flat=[(t,w['start']) for w in words for t in re.findall(r"[a-z0-9']+",w['word'].lower())]
def when(p):
    target=re.findall(r"[a-z0-9']+",p.lower())
    for i in range(len(flat)-len(target)+1):
        if [t for t,_ in flat[i:i+len(target)]]==target:return flat[i][1]
    raise ValueError(p)
starts=[0,when('First somebody'),when('Now comes'),when("Here's the real"),when("Here's the checklist")]
def stamp(t):return f'{int(t)//60:02d}:{int(t)%60:02d}'
chapters=[dict(start_seconds=t,title=s['title'],timestamp=stamp(t)) for t,s in zip(starts,plan['shots'])]
assert all(b-a>=10 for a,b in zip(starts,starts[1:]))
title=(P/'title.txt').read_text().strip();assert len(title)<60
description="""An AI team can have impressive job titles and still leave the actual job unfinished. In this Building Nori episode, follow one simple checklist request through assignment, delivery, creation, and checking the result.

The chef, package, and pizza scenes are original illustrated examples. The checklist is an example, not a task we are claiming Nori completed. The real project evidence is a narrowly scoped source check of the worker request handler's chat/task branch; it does not prove a successful live task or every Nori request path.

"""+'\n'.join(c['timestamp']+' '+c['title'].title() for c in chapters)+"""

What should Nori prove first: make a checklist, summarize a document, or help prepare a stream? Tell us in the comments.

Watch the AI readiness Short: https://www.youtube.com/shorts/uPH3jiIR2Ug
Subscribe: https://www.youtube.com/@fredoindaWRX?sub_confirmation=1

This video uses synthetic male narration and an illustrated animated Nori mascot. It does not change Nori's own speaking voice.

#Nori #AIAgents #AIProjects #BuildInPublic
"""
(P/'description.txt').write_text(description,encoding='utf-8')
package=dict(video_id='W4-MAIN',title=title,title_characters=len(title),description=description,tags=['Nori AI project','AI agents explained','AI task verification','building an AI assistant','AI workflow'],thumbnail='thumbnail.png',thumbnail_text='AI SAYS DONE. / WHERE’S THE FILE?',chapters=chapters,playlist='Building Nori',playlist_id='PLO6jtLWEmiAo',visibility='Public immediately when the final production checks are satisfied; never scheduled',not_made_for_kids=True,synthetic_content_disclosure=True,captions='captions.srt',end_screen=dict(start_seconds=tr['duration']-20,end_seconds=tr['duration'],elements=['Subscribe','AI readiness Short'],watch_next_youtube_id='uPH3jiIR2Ug'),voice='Jordan',voice_id='79d0bd3e4e5444b18f7b6d89b5927bf1',voice_engine='s2.1-pro-free',paid_spend=0,nori_character_voice_changed=False,owner_avatar_configured=False,publication_ready=False,owner_voice_feedback_received=False)
(P/'publishing-package.json').write_text(json.dumps(package,indent=2),encoding='utf-8')
for s,t in zip(plan['shots'],starts):s['start_seconds']=t
plan['shots'][-1]['end_seconds']=tr['duration']
for i in range(len(plan['shots'])-1):plan['shots'][i]['end_seconds']=starts[i+1]
(P/'SHOT-PLAN.json').write_text(json.dumps(plan,indent=2),encoding='utf-8')
print(json.dumps(dict(title=title,chapters=chapters,final_publication=False)))
