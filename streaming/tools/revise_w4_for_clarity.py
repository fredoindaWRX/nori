import hashlib,json,shutil
from pathlib import Path
root=Path('C:/Nori/streaming/channel-operator')
episode=root/'02-Calendar/Week-4/W4-MAIN'
backup=Path('C:/Nori/streaming/tools/verification/pre-clarity-revision/W4MAIN')
backup.mkdir(parents=True,exist_ok=True)
for name in ['narration.txt','SHOT-PLAN.json','title.txt','description.txt']:
    p=episode/name
    if p.exists() and not (backup/name).exists(): shutil.copy2(p,backup/name)
sections=[
('WHERE IS THE RESULT?', """Your AI team has a planner, a researcher, a coder, and a reviewer. Great. Who actually did the job?

Because sometimes you ask for one thing, and get an organization chart. Congratulations. Your unfinished task has management now.

Here's the question for this Nori episode: when an AI says it's done, what should we be able to see? Let's follow one pretend request all the way through. Make a file with a three-item checklist. That's it. No giant mission. No twelve-agent meeting about the meeting.

This checklist example is an illustration. We're not claiming Nori completed it. We'll also look at one real connection in the project code, and keep those two things separate."""),
('GIVE SOMEBODY THE JOB', """First, somebody needs to get the job. Calling an AI the coder tells it what role to play. It doesn't automatically give it a file editor.

It's like handing somebody a chef's hat, then wondering why dinner hasn't arrived. The hat is fantastic. The kitchen is still missing.

Next, pick the worker. A system can say, send this to the coder. That's a useful decision. But picking a worker isn't the same as sending the request.

Think about a package. Writing the address is step one. You still have to hand it to the delivery person. If all we have is an address, we don't have a delivered package.

For our checklist, I want to see which worker got the request, and whether that worker actually received it. One task. One destination. Show the handoff."""),
('DO THE THING', """Now comes the bit we actually wanted: make the file.

The worker needs a way to write it, and permission to write in the right place. A beautifully worded answer explaining how to make a checklist doesn't create the checklist.

That would be like ordering a pizza and getting an essay called, The Importance of Cheese. Incredible enthusiasm. Still hungry.

So our example has a clear finish line. A file exists where we asked for it. Open it. Read the three items. Check that they're the items we requested.

If the worker can't write files, say that. If it got stuck waiting for a tool, say that too. We can fix a specific problem. We can't fix, everything is great, trust me."""),
('WHAT THE NORI CODE SHOWS', """Here's the real part I checked in Nori's worker request handler. The chat and task requests in this particular code path call the council gateway. If that gateway is missing, the handler returns an error.

That tells us a connection is written into this handler. It doesn't show a finished checklist, and it doesn't tell us every tool is ready. There are other request paths in the project too, so this is one piece of the system.

We'll put the code summary on screen and label it as a source check. The package and pizza examples stay labeled as illustrations.

The next useful recording would show a real request going in and its real result coming out. If it stops halfway, show where. A failure with a clear stopping point gives us something useful to work on."""),
('ONE JOB, ONE RECEIPT', """Here's the checklist for checking the checklist. Who got the job? Did they receive it? Did they create the file? Did we open it and check it?

That's the whole path. Fancy arrows can explain it, but the arrows aren't the receipt. The actual result is.

Once one worker can finish one small job, then we have something worth building on. Adding more workers before that can just give the same unfinished task more people to disappoint.

For Nori, I want the videos to show what happened, including the part that didn't work. A useful result beats a dramatic done message.

What small job would you want Nori to prove first: make a checklist, summarize a document, or help prepare a stream? Pick one in the comments. Subscribe to follow the next test, and watch the readiness episode next for the checks that come before the job."""),
]
script='\n\n'.join(text for _,text in sections)+'\n'
title='Your AI Says Done. Where Is the Actual Work?'
assert len(title)<60
(episode/'narration.txt').write_text(script,encoding='utf-8')
(episode/'title.txt').write_text(title+'\n',encoding='utf-8')
plan=dict(video_id='W4-MAIN',voice_provider='Fish Audio',narrator_direction='Male narrator separate from Nori character voice; candidate not yet accepted',voice_id=None,script_sha256=hashlib.sha256(script.encode()).hexdigest(),shots=[dict(index=i,title=heading,voice_text=text,asset_role='Clearly labeled illustration, except narrowly scoped source-code summary in section 4') for i,(heading,text) in enumerate(sections,1)],timing_status='Align to actual accepted narration; no final timing assigned',status='Script revised for clarity; narration and final MP4 incomplete',required_remaining_inputs=['Acceptable male narrator','Generated narration and word-aligned captions','Finished visual edit and complete MP4 QA','Native publishing metadata, thumbnail, captions and end screen','Configured owner avatar for original presenter requirement'],source_claim_scope='main.py worker do_POST chat/task branch only; not proof of live execution or every Nori request path')
(episode/'SHOT-PLAN.json').write_text(json.dumps(plan,indent=2),encoding='utf-8')
evidence=episode/'demonstration-evidence'
evidence.mkdir(exist_ok=True)
source=Path('C:/Nori/nori/main.py').read_text(encoding='utf-8-sig')
lines=source.splitlines()
excerpt='\n'.join(f'{i+1}: {lines[i]}' for i in range(252,272))+'\n'
(evidence/'worker-request-source-excerpt.txt').write_text(excerpt,encoding='utf-8')
record=dict(source_file='C:/Nori/nori/main.py',source_sha256=hashlib.sha256(source.encode()).hexdigest(),excerpt_lines=[253,272],verified=['handle_work is attempted before this branch','gateway missing returns 503 council_gateway_required','chat/task branch calls gateway.submit'],live_execution_verified=False,illustrated_checklist_created_by_nori=False)
(evidence/'SOURCE-CHECK.json').write_text(json.dumps(record,indent=2),encoding='utf-8')
(episode/'VISUAL-BEATS.json').write_text(json.dumps(dict(status='Production edit specification; scene art and render incomplete',beats=[{'section':1,'visual':'One request surrounded by four managers; unfinished checklist stays blank','label':'ILLUSTRATION','joke':'Your unfinished task has management now.'},{'section':2,'visual':'Robot wearing chef hat beside an empty counter','label':'ILLUSTRATION','joke':'The kitchen is still missing.'},{'section':2,'visual':'Package with address label, followed by a handoff; no fake app UI','label':'ILLUSTRATION'},{'section':3,'visual':'Pizza box opens to an essay titled The Importance of Cheese','label':'ILLUSTRATION','joke':'Still hungry.'},{'section':3,'visual':'Open a clearly labeled example checklist and check three items','label':'EXAMPLE — NOT A NORI TASK RESULT'},{'section':4,'visual':'Faithful three-line summary of the verified worker request branch','label':'SOURCE CODE SUMMARY'},{'section':4,'visual':'Source code and live task result shown as separate evidence types','label':'EXPLANATION'},{'section':5,'visual':'Four simple checks followed by watch-next and subscribe end screen','label':'EXPLANATION'}]),indent=2),encoding='utf-8')
print(json.dumps(dict(title=title,title_chars=len(title),words=len(script.split()),sections=len(sections),source_claim_verified=True,final_video_complete=False)))
