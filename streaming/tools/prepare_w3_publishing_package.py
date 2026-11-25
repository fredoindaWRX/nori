import json
from pathlib import Path
from PIL import Image,ImageDraw,ImageFont
P=Path('C:/Nori/streaming/channel-operator/02-Calendar/Week-3/W3-MAIN');title='Before I Trust My AI, I Check These 3 Things';assert len(title)<60
description="""A green light is easy to trust. I checked whether Nori's configured local AI connection would respond—and both read-only requests failed to connect.

This build update explains three different questions with one small example: does the app respond, can it use its model, and does it give the right answer? The actual checks stop at the connection. No successful AI answer or missing-model diagnosis is claimed.

00:00 One tiny job
00:25 The actual connection result
01:02 Three different questions
01:48 Make failure useful
02:27 Show what actually happened

What is one small task you would want Nori to handle first? Tell me in the comments. Subscribe to follow the projects, fixes, and things that refuse to cooperate.

More Nori builds:
https://www.youtube.com/shorts/uPH3jiIR2Ug

Source-code summaries and original cartoons explain the checks. Math answers shown in the examples are illustrations, not generated Nori responses. Narration uses a synthetic narrator, Ethan, through Fish Audio. The animation and reactions are original.

#Nori #AIProjects #BuildInPublic #AITesting
"""
tags=['Nori AI project','AI readiness checks','AI project testing','building an AI assistant','AI debugging']
package={'video_id':'W3-MAIN','title':title,'title_characters':len(title),'description':description,'tags':tags,'visibility':'Public immediately; no schedule','scheduled':False,'playlist':'Building Nori','playlist_id':'PLO6jtLWEmiAo','thumbnail_text':'GREEN LIGHT? / PROVE IT.','narrator':'Ethan','voice_id':'536d3a5e000945adb7038665781a4aca','engine':'s2.1-pro-free','paid_spend':0,'video_file':str(P/'Nori-One-Task-Three-Checks-Ethan.mp4'),'captions_file':str(P/'captions.srt'),'native_end_screen_plan':'Subscribe plus own AI readiness Short uPH3jiIR2Ug, last 20 seconds','publication_status':'Not uploaded','owner_quality_feedback_on_revision_received':False,'successful_ai_answer_verified':False,'owner_avatar_used':False}
(P/'title.txt').write_text(title+'\n',encoding='utf-8');(P/'description.txt').write_text(description,encoding='utf-8');(P/'publishing-package.json').write_text(json.dumps(package,indent=2)+'\n',encoding='utf-8')
im=Image.new('RGB',(1280,720),'#f1eee7');d=ImageDraw.Draw(im)
def font(n):return ImageFont.truetype('C:/Windows/Fonts/seguisb.ttf',n)
d.rectangle((0,0,1280,65),fill='#172128');d.text((45,15),'FredoIndaWRX / NORI',font=font(24),fill='#ffffff')
d.text((500,170),'GREEN LIGHT?',font=font(82),fill='#172128');d.text((500,285),'PROVE IT.',font=font(115),fill='#b63d40')
d.rounded_rectangle((100,190,400,500),radius=50,fill='#172128',outline='#167b79',width=10);d.line((250,190,250,135),fill='#167b79',width=12);d.ellipse((235,105,265,135),fill='#b9780a')
for x in [180,320]:d.ellipse((x-20,280,x+20,320),fill='#f1eee7')
d.arc((195,335,310,425),0,180,fill='#f1eee7',width=9);d.text((250,455),'N',font=font(36),fill='#f1eee7',anchor='mm')
d.text((505,490),'ONE JOB. ONE RESULT.',font=font(34),fill='#167b79');d.text((505,580),'3 checks before you trust the answer',font=font(31),fill='#172128');im.save(P/'thumbnail.png')
plan=json.loads((P/'SHOT-PLAN.json').read_text(encoding='utf-8'));plan['title']=title;plan['remaining_inputs']=['Final export visual and audio technical verification','Native upload, captions and end screen','Owner quality feedback on the revised presentation','Owner avatar remains unconfigured'];(P/'SHOT-PLAN.json').write_text(json.dumps(plan,indent=2)+'\n',encoding='utf-8')
print(json.dumps({'title':title,'title_characters':len(title),'chapters':5,'native_tags':len(tags),'thumbnail':str(P/'thumbnail.png'),'published':False}))
