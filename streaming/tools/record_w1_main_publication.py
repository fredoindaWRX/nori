import csv,json,zipfile
from datetime import datetime,timezone
from pathlib import Path
R=Path('C:/Nori/streaming/channel-operator');F=R/'02-Calendar/Week-1/W1-MAIN'
def read(p):return json.loads(p.read_text(encoding='utf-8-sig'))
def write(p,x):p.write_text(json.dumps(x,indent=2,ensure_ascii=False)+'\n',encoding='utf-8')
qa=read(F/'FINAL-QA.json');p=read(F/'publishing-package.json');assert qa['local_render_ready']
proof='06-Archive-Audit/obs-main-public-details.jpg';assert (R/proof).exists()
record={'calendar_id':'W1-MAIN','youtube_video_id':'wQCuI-5i0iQ','title':p['title'],'url':'https://www.youtube.com/watch?v=wQCuI-5i0iQ','visibility':'Public','published_date':'2026-09-30','verified_at_utc':datetime.now(timezone.utc).isoformat(),'verification':['Video published confirmation','Saved Studio details show exact title, Public, Creator Tools playlist, Uploaded thumbnail, SD and HD complete, disabled Save','124 timed captions imported and saved; English (United States) by you visible','Native end screen saved: specific microphone/Discord video 5KxXhG6FNNA and subscribe, 4:10 to 4:30'],'duration_seconds':qa['duration_seconds'],'format':'Long-form / 1920x1080 / 30fps / H264 AAC','copyright_initial_check':'No issues found','community_guidelines_initial_check':'No issues found','playlist':'Creator Tools','playlist_id':'PLKwzclKlwEk8','cover':'STOP THE OBS MIRROR; thumbnail.png uploaded','captions':'124 timed cues, burned in and native SRT saved','end_screen_video_id':'5KxXhG6FNNA','voice':'User-selected Fish fred, S2.1 Pro Free; edited for clarity','presenter':'Original animated diagrams and reactions with actual OBS settings and graphics-only recording; no owner avatar','paid_spend':0,'memes':4,'own_channel_video_cutaways':3,'details_proof':proof,'growth_measured':False,'license_status':'User publication authorization retained; no claim of separate commercial service-license clearance.'}
write(F/'publication-record.json',record);write(F/'PUBLICATION.json',record)
p.update(publication_status='Public; saved native details verified',youtube_video_id=record['youtube_video_id'],youtube_url=record['url'],duration_seconds=qa['duration_seconds'],scheduled=False,native_captions_status='Saved',native_end_screen_status='Saved');write(F/'publishing-package.json',p)
qa.update(published=True,watch_url=record['url'],native_end_screen_and_captions='Saved and verified in upload flow');write(F/'FINAL-QA.json',qa)
plan=read(F/'SHOT-PLAN.json');plan.update(status='Verified final animated long-form MP4 published Public with native captions and end screen.',required_remaining_inputs=['Owner HeyGen avatar for the originally requested presenter format remains unconfigured.'],presenter_scope='This episode is an original animated tutorial with actual OBS captures. Overall owner-avatar requirement is not complete.');write(F/'SHOT-PLAN.json',plan)
(F/'production-package.txt').write_text(f'''ID: W1-MAIN
PUBLISHED: Public, September 30, 2026. {record['url']}
TITLE: {p['title']}
FORMAT: Long-form, 4 minutes 30 seconds, 1920x1080 / 30fps / H264 AAC.
VOICE: Owner-authorized fred clone through Fish S2.1 Pro Free; no paid spend. Clip edits and separate recognitions retained for narration verification. Human voice-likeness listening not claimed.
EDIT: 48 original animated visual beats, 4 original meme reactions, 3 muted cutaways from the channel's own Shorts, quiet original music and transition accents.
CAPTIONS: 124 timed cues burned in; native English (United States) SRT imported and saved.
END SCREEN: Native subscribe and specific microphone/Discord video 5KxXhG6FNNA; 4:10 to 4:30, aligned to the outro.
THUMBNAIL: STOP THE OBS MIRROR, original graphic, uploaded.
VERIFICATION: Full final audio-normalized MP4 decode passed; 60 exported frames inspected, revised monitor-switch timing checked; audio -16.12 LUFS, -1.24 dBTP. Saved Studio shows Public, SD/HD complete, exact title and Creator Tools playlist. Initial YouTube checks found no issues.
ACTUAL CAPTURE LIMIT: 18.9-second Starting Soon to Break recording tests graphics transitions only. Active microphone/Discord routing was not tested by that capture. Private monitor previews are not included.
AVATAR: Owner HeyGen account inspected: free plan, no private avatar groups. Requested owner presenter format remains incomplete.
DESCRIPTION:
{p['description']}
''',encoding='utf-8')
with (R/'calendar.csv').open(encoding='utf-8-sig',newline='') as f:rows=list(csv.DictReader(f));fields=list(rows[0])
for row in rows:
 if row['ID']=='W1-MAIN':row.update(PublishDate='2026-09-30',Time='',Day='Wednesday',Visibility='Public; published and verified',MediaStatus='Verified animated full-length MP4 published; 124 captions and native end screen saved')
with (R/'calendar.csv').open('w',encoding='utf-8-sig',newline='') as f:w=csv.DictWriter(f,fieldnames=fields,quoting=csv.QUOTE_ALL);w.writeheader();w.writerows(rows)
audit=read(R/'COMPLETION-AUDIT.json');remaining=['W2-MAIN','W3-MAIN','W4-MAIN']
audit['phase3'].update(status='incomplete',calendar_mp4_count=9,illustrated_final_edits_count=9,published_illustrated_short_count=8,published_animated_long_form_count=1,remaining_calendar_ids=remaining,remaining_calendar_videos=3,local_engine='Selected owner Fish fred clone, S2.1 Pro Free, local edited-word alignment, FFmpeg assembly and verification.',live_demonstration_footage='W1 includes actual OBS source selectors and graphics-transition recording. Active audio and full monitor-switch recording remain unverified; other main episodes still require specific demonstrations.')
audit['phase4'].update(status='incomplete',new_calendar_uploads=9,public_calendar_videos=9,scheduled_calendar_videos=0,main_video_final_timestamps='W1-MAIN has twelve measured chapter timestamps; other three main videos unfinished.')
audit['phase4']['published_videos']=[r for r in audit['phase4'].get('published_videos',[]) if r.get('calendar_id')!='W1-MAIN']+[record]
audit['last_goal_turn']='Meaningful progress: first verified 4m30s long-form video publicly published with memes, own-channel callbacks, native captions and end screen. Nine calendar videos public; three main videos and owner avatar requirement remain.'
audit['blocking_condition'].update(consecutive_goal_turns_observed=0,condition='Free Fish voice is operational. No private owner HeyGen avatar exists; this does not block continued original visual production.',safe_production_next_action='Produce the remaining three main videos with clear voice, useful actual demonstrations and original comic editing; owner avatar setup remains a separate unmet prerequisite.')
write(R/'COMPLETION-AUDIT.json',audit)
progress={'shorts_public':8,'long_form_planned':4,'long_form_final_mp4s':1,'long_form_public':1,'shorts_scheduled':0,'first_long_form':{'id':'W1-MAIN','title':p['title'],'duration_seconds':qa['duration_seconds'],'local_render_ready':True,'publication_status':'Public','url':record['url']},'remaining_main_ids':remaining,'original_avatar_format_complete':False,'goal_complete':False};write(R/'03-Production/LONG-FORM-PROGRESS.json',progress)
records=[read(q) for q in R.glob('02-Calendar/Week-*/*/publication-record.json')];public=[r for r in records if r.get('visibility')=='Public'];assert len(public)==9
status='FREDOINDAWRX CHANNEL — VERIFIED STATUS\n\n9 of 12 calendar videos are rendered, verified and Public: eight Shorts plus the first longer video. Zero scheduled. Phases 3 and 4 remain incomplete. Projects and Nori first, gaming on the side.\n\n'
for r in sorted(public,key=lambda x:x['calendar_id']):status+=r['title']+'\n'+r['url']+'\nPublic — '+r.get('published_date','')+'\n\n'
status+='W1 main: 48 original motion beats, four meme reactions, three own-video cutaways, actual safe OBS settings and graphics recording, 124 timed captions, native subscribe/video end screen. Three longer videos remain. No private owner HeyGen avatar configured. No paid speech, paid promotion or measured growth claimed. Older uploads preserved.\n'
for q in [R/'START-HERE.txt',R/'PRODUCTION-PROGRESS.txt',R/'03-Production/PRODUCTION-PROGRESS.txt']:q.write_text(status,encoding='utf-8')
with (R/'06-Archive-Audit/changes-2026-09-30.txt').open('a',encoding='utf-8') as f:f.write('\nVERIFIED PUBLIC LONG-FORM: '+p['title']+' — '+record['url']+'. Four meme reactions, three own-video cutaways, actual OBS captures, 124 captions and native end-screen saved.\n')
print(json.dumps({'public_shorts':8,'public_long_form':1,'remaining_main_videos':3,'goal_complete':False}))
