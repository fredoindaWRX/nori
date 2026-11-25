import csv,json,re,zipfile
from pathlib import Path
root=Path('C:/Nori/streaming/channel-operator');folder=root/'02-Calendar/Week-1/W1-S2'
def read(p):return json.loads(p.read_text(encoding='utf-8-sig'))
def write(p,x):p.write_text(json.dumps(x,indent=2,ensure_ascii=False)+'\n',encoding='utf-8')
package=read(folder/'publishing-package.json')
record={'calendar_id':'W1-S2','youtube_video_id':'1qvYNBZrjz4','title':package['title'],'url':'https://www.youtube.com/shorts/1qvYNBZrjz4','visibility':'Scheduled','scheduled_publish':'2026-10-03T18:00:00-04:00','timezone':'America/New_York','youtube_confirmation':'Your video will be set to public on October 3, 2026 at 6:00 PM','copyright_initial_check':'No issues found','community_guidelines_initial_check':'No issues found','playlist':'Creator Tools','playlist_id':'PLKwzclKlwEk8','related_video_id':'WqziO-CB6f8','cover':'TAKE A REAL BREAK; custom cover uploaded','captions':'Fourteen timed cues burned into final export; SRT imported and saved in Studio','duration_seconds':27.01,'presenter':'Animated explanatory illustrations; HeyGen avatar remains unconfigured','voice':'User-selected Fish fred voice through S2.1 Pro Free','paid_spend':0,'license_status':package['license_status'],'human_voice_likeness_review':'Not claimed; actual normalized spoken sequence matches source.','schedule_proof':'06-Archive-Audit/break-short-scheduled-confirmation.jpg','growth_measured':False}
write(folder/'publication-record.json',record)
record['processing']={'standard_definition':'complete','high_definition':'complete'}
record['saved_details_verification']='Studio details shows Scheduled, Creator Tools membership, uploaded thumbnail, exact related-video title, disabled Save and SD/HD complete.'
record['details_proof']='06-Archive-Audit/break-short-scheduled-details.jpg'
write(folder/'publication-record.json',record)
package.update(actual_upload_status='Uploaded and scheduled, YouTube confirmation verified',youtube_video_id=record['youtube_video_id'],youtube_url=record['url'],publication_record='publication-record.json');write(folder/'publishing-package.json',package)
p=folder/'Take-A-Real-Break-Fredo.verification.json';x=read(p);x['publication_status']='Uploaded and scheduled for October 3, 2026 18:00 America/New_York; YouTube confirmation verified.';x['youtube_initial_checks']={'copyright':'No issues found','community_guidelines':'No issues found'};write(p,x)
p=root/'calendar.csv'
with p.open(encoding='utf-8-sig',newline='') as f:r=csv.DictReader(f);fields=r.fieldnames;rows=list(r)
for row in rows:
 if row['ID']=='W1-S2':row.update(PublishDate='2026-10-03',Day='Saturday',WorkingTitle=record['title'],Visibility='Scheduled in YouTube; verified',MediaStatus='Final illustrated MP4 verified; uploaded and scheduled; user-selected Fish narration')
with p.open('w',encoding='utf-8-sig',newline='') as f:w=csv.DictWriter(f,fieldnames=fields,quoting=csv.QUOTE_ALL);w.writeheader();w.writerows(rows)
p=root/'COMPLETION-AUDIT.json';x=read(p);x['phase3'].update(calendar_mp4_count=2,illustrated_final_edits_count=2,other_eleven_videos=None,remaining_ten_videos='not rendered',heygen_private_avatar_count=0)
x['phase4'].update(new_calendar_uploads=2,public_calendar_videos=1,scheduled_calendar_videos=1,scheduled_videos=[record],planned_dates='W1-S1 public Sep30, W1-S2 scheduled Oct3. Other ten calendar entries remain planning slots, not actual schedules.')
x['last_goal_turn']='progress: second actual final MP4 produced, technically and visually reviewed, uploaded and scheduled; no blockers prevented this Short.'
x['blocking_condition']['consecutive_goal_turns_observed']=0;write(p,x)
p=folder/'production-package.txt';text=p.read_text(encoding='utf-8')
text=re.sub(r'DESCRIPTION COPY:\n.*?\n\nTAGS:',lambda m:'DESCRIPTION COPY:\n'+package['description']+'\n\nTAGS:',text,flags=re.S)
text=re.sub(r'^STATUS:.*$', 'STATUS: Final illustrated MP4 verified, uploaded and scheduled for October 3, 2026 at 18:00 America/New_York. Full HeyGen presenter request remains incomplete.',text,flags=re.M)
p.write_text(text,encoding='utf-8')
update='''\nLATEST VERIFIED UPDATE — SECOND CALENDAR SHORT SCHEDULED
OBS Break Scene Still Has Audio? Check This
https://www.youtube.com/shorts/1qvYNBZrjz4
YouTube confirmed publication for October 3, 2026 at 18:00 America/New_York. Video remains private until release. Added to public Creator Tools playlist; related-video link points to first released OBS Short WqziO-CB6f8. Actual 27.01s final export, 1080x1920, 30fps H264/AAC, seven moving illustrations, fourteen timed captions and original synthesized music/cut sounds. Final audio -16.95 LUFS and -1.43 dBTP. Full decode passed; fourteen actual export frames inspected. Hook completes at 2.58s. Normalized spoken sequence exactly matches script, accounting for ASR splitting hyphenated words and a punctuation-only trailing token. Human voice-likeness listening review not claimed.
Both YouTube initial checks found no issues. No paid spend. Free Fish model and owner-selected voice used; license classification remains documented separately. No HeyGen avatar configured in fresh private-avatar listing. Ten remaining calendar MP4s are unproduced. Total new uploads now two: one public, one scheduled. Overall Phases 3 and 4 remain incomplete.
'''
for p in [root/'START-HERE.txt',root/'PRODUCTION-PROGRESS.txt',root/'03-Production/PRODUCTION-PROGRESS.txt',root/'06-Archive-Audit/changes-2026-09-30.txt']:
 text=p.read_text(encoding='utf-8').replace('other eleven are not rendered, uploaded or scheduled','other ten are not rendered, uploaded or scheduled').replace('other eleven are not rendered','other ten are not rendered').replace('Other eleven calendar MP4s are not rendered or uploaded.','Other ten calendar MP4s are not rendered or uploaded.')
 p.write_text(text.rstrip()+'\n'+update,encoding='utf-8')
p=root/'03-Production/NARRATION-STATUS.txt';p.write_text(p.read_text(encoding='utf-8').replace('Other eleven narration scripts are not generated.','W1-S2 revised final narration generated and verified: 27.01s, 77 words. Other ten narration scripts are not generated.'),encoding='utf-8')
p=root/'03-Production/FISH-AUDIO-VOICE.json';x=read(p);x['current_status']='Signed in; selected fred voice operational. Two calendar Shorts have verified final narration and MP4 edits. W1-S1 public; W1-S2 scheduled. No paid model used.';x['calendar_audio_files']=['02-Calendar/Week-1/W1-S1/narration-fred-final.mp3','02-Calendar/Week-1/W1-S2/narration-fred-final.mp3'];write(p,x)
archive=Path('C:/Nori/streaming/channel-operator-2026-09-30.zip')
with zipfile.ZipFile(archive,'w',compression=zipfile.ZIP_DEFLATED) as z:
 for p in root.rglob('*'):
  if p.is_file():z.write(p,p.relative_to(root))
with zipfile.ZipFile(archive) as z:assert z.testzip() is None
assert read(root/'COMPLETION-AUDIT.json')['phase4']['new_calendar_uploads']==2
print(json.dumps({'calendar_mp4s':2,'public':1,'scheduled':1,'remaining_mp4s':10,'package_integrity':'passed','goal_complete':False}))
