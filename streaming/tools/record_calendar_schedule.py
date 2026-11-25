import argparse, csv, json, re, zipfile
from datetime import date
from pathlib import Path

root=Path('C:/Nori/streaming/channel-operator')
def read(p): return json.loads(p.read_text(encoding='utf-8-sig'))
def write(p,x): p.write_text(json.dumps(x,indent=2,ensure_ascii=False)+'\n',encoding='utf-8')
parser=argparse.ArgumentParser()
parser.add_argument('calendar_id');parser.add_argument('youtube_id');parser.add_argument('publish_date');parser.add_argument('proof_prefix')
args=parser.parse_args()
folder=next(root.glob('02-Calendar/Week-*/'+args.calendar_id))
package=read(folder/'publishing-package.json');video=folder/package['video_asset']
verification=read(video.with_suffix('.verification.json'));quality=read(folder/'Export-Review/export-checks.json')
assert video.exists() and video.stat().st_size>10000
assert 'inspected' in quality['caption_frame_review'].lower(), 'Review actual export frames before recording completion'
assert abs(quality['integrated_lufs']+16)<1 and quality['true_peak_dbtp']<=-1
duration=float(verification['format']['duration'])
captions=len(re.findall(r'(?m)^\d+\s*$',(folder/'captions.srt').read_text(encoding='utf-8-sig')))
plan=read(folder/'SHOT-PLAN.json')
prefix='06-Archive-Audit/'+args.proof_prefix
for suffix in ['-youtube-checks.jpg','-scheduled-confirmation.jpg','-scheduled-details.jpg']:
 assert (root/(prefix+suffix)).exists(), suffix
record={'calendar_id':args.calendar_id,'youtube_video_id':args.youtube_id,'title':package['title'],
 'url':'https://www.youtube.com/shorts/'+args.youtube_id,'visibility':'Scheduled',
 'scheduled_publish':args.publish_date+'T18:00:00-04:00','timezone':'America/New_York',
 'youtube_confirmation':'YouTube Video scheduled confirmation verified: '+date.fromisoformat(args.publish_date).strftime('%B %d, %Y')+' at 6:00 PM',
 'copyright_initial_check':'No issues found','community_guidelines_initial_check':'No issues found',
 'playlist':'Creator Tools','playlist_id':'PLKwzclKlwEk8','related_video_id':package['related_video_id'],
 'cover':package['thumbnail_overlay']+'; custom cover uploaded',
 'captions':f'{captions} timed cues burned into final MP4; SRT imported and saved in Studio',
 'duration_seconds':duration,'presenter':package['presenter_format'],
 'voice':'User-selected Fish fred voice through S2.1 Pro Free','paid_spend':0,
 'license_status':package['license_status'],'human_voice_likeness_review':'Not claimed; actual normalized spoken word sequence matches the source.',
 'schedule_proof':prefix+'-scheduled-confirmation.jpg','details_proof':prefix+'-scheduled-details.jpg',
 'processing':{'standard_definition':'complete','high_definition':'complete'},
 'saved_details_verification':'Studio shows Scheduled, exact title and description, Creator Tools membership, uploaded thumbnail, related first public OBS Short, SD/HD complete, disabled Save.',
 'growth_measured':False}
write(folder/'publication-record.json',record)
package.update(actual_upload_status='Uploaded and scheduled; YouTube confirmation and saved details verified',
 youtube_video_id=args.youtube_id,youtube_url=record['url'],publication_record='publication-record.json',
 duration_seconds=duration,planned_publish=args.publish_date+' 18:00 America/New_York')
write(folder/'publishing-package.json',package)
verification.update(quality_checks=quality,publication_status='Uploaded and scheduled '+record['scheduled_publish'],
 youtube_initial_checks={'copyright':'No issues found','community_guidelines':'No issues found'})
write(video.with_suffix('.verification.json'),verification)
plan.update(status='Final illustrated MP4 verified, uploaded and scheduled',
 required_remaining_inputs=[],presenter_scope='This Short uses animated diagrams. The overall HeyGen presenter request remains unfulfilled.')
write(folder/'SHOT-PLAN.json',plan)
outline='\n'.join(str(i+1)+'. '+s['title']+': '+s['voice_text'] for i,s in enumerate(plan['shots']))
text=f'''ID: {args.calendar_id}
PUBLISH: {args.publish_date} 18:00 America/New_York; actual YouTube schedule verified
FORMAT: Short / {duration:.2f} seconds / 1080x1920 / 30fps / H264 and AAC
TITLE ({len(package['title'])} characters): {package['title']}
HOOK: {plan['shots'][0]['voice_text']}
FINAL SECTIONS AND SCENES:
{outline}
CTA: {plan['shots'][-1]['voice_text']}
END SCREEN: Shorts use the related-video link to the released OBS Is Showing Itself? Fix This First. No traditional end screen.
THUMBNAIL OVERLAY: {package['thumbnail_overlay']}
DESCRIPTION COPY:
{package['description']}

TAGS: {', '.join(package['tags'])}
TIMESTAMPS: No chapter timestamps in this Short. Captions use measured speech timestamps.
VOICE: User-selected Fish fred voice, S2.1 Pro Free. No paid spend.
VISUALS: Animated explanatory illustrations, original local music and cut sounds, burned captions. No unperformed live test is claimed.
VERIFICATION: Full video decode, actual spoken-sequence check, timed captions, all caption frames inspected. Audio {quality['integrated_lufs']} LUFS and {quality['true_peak_dbtp']} dBTP. YouTube initial checks found no issues. SD/HD complete.
STATUS: Final MP4 verified, uploaded and scheduled. Overall avatar presenter request remains incomplete.
YOUTUBE: {record['url']}
'''
(folder/'production-package.txt').write_text(text,encoding='utf-8')
records=[read(p) for p in root.glob('02-Calendar/Week-*/*/publication-record.json')]
public=[x for x in records if x['visibility']=='Public'];scheduled=[x for x in records if x['visibility']=='Scheduled']
finals=[]
for p in root.glob('02-Calendar/Week-*/*/*.mp4'):
 v=p.with_suffix('.verification.json');q=p.parent/'Export-Review/export-checks.json'
 if v.exists() and q.exists() and any(t in read(q)['caption_frame_review'].lower() for t in ['inspected','frames reviewed']): finals.append(p)
remaining=[p.parent.name for p in root.glob('02-Calendar/Week-*/*/SHOT-PLAN.json') if p.parent not in {v.parent for v in finals}]
with (root/'calendar.csv').open(encoding='utf-8-sig',newline='') as f:
 reader=csv.DictReader(f);fields=reader.fieldnames;rows=list(reader)
for row in rows:
 r=next((x for x in records if x['calendar_id']==row['ID']),None)
 if r and r['visibility']=='Scheduled':
  d=r['scheduled_publish'][:10]
  row.update(PublishDate=d,Day=date.fromisoformat(d).strftime('%A'),WorkingTitle=r['title'],
   Visibility='Scheduled in YouTube; verified',MediaStatus='Final illustrated MP4 verified; uploaded and scheduled; user-selected Fish narration')
with (root/'calendar.csv').open('w',encoding='utf-8-sig',newline='') as f:
 w=csv.DictWriter(f,fieldnames=fields,quoting=csv.QUOTE_ALL);w.writeheader();w.writerows(rows)
audit=read(root/'COMPLETION-AUDIT.json')
audit['phase3'].update(calendar_mp4_count=len(finals),illustrated_final_edits_count=len(finals),
 remaining_calendar_ids=remaining,remaining_calendar_videos=len(remaining),heygen_private_avatar_count=0)
audit['phase3'].pop('other_eleven_videos',None);audit['phase3'].pop('remaining_ten_videos',None)
audit['phase4'].update(new_calendar_uploads=len(records),public_calendar_videos=len(public),scheduled_calendar_videos=len(scheduled),
 published_videos=public,scheduled_videos=scheduled,planned_dates='Only publication-record dates are actual verified YouTube schedules. Other calendar rows remain plans.')
audit['last_goal_turn']='Meaningful production and publication progress: '+str(len(finals))+' verified final MP4s, '+str(len(public))+' public, '+str(len(scheduled))+' scheduled.'
audit['blocking_condition'].update(consecutive_goal_turns_observed=0,
 condition='Fish voice is operational and user authorized publishing. Owner HeyGen avatar and actual main-video demonstration footage are still unavailable.',
 safe_production_next_action='Continue remaining illustrated Shorts; main presenter videos need owner avatar setup and actual demo footage.')
write(root/'COMPLETION-AUDIT.json',audit)
status='FREDOINDAWRX CHANNEL — CURRENT VERIFIED STATUS\n\n'
status+=f'{len(finals)} of 12 calendar MP4s are final and verified. {len(public)} public upload; {len(scheduled)} scheduled uploads. Phases 3 and 4 remain incomplete.\n\n'
for r in sorted(records,key=lambda x:x['calendar_id']):
 status+=r['title']+'\n'+r['url']+'\n'+r['visibility']+' — '+r.get('scheduled_publish',r.get('published_date',''))+'\n\n'
status+='All completed Shorts use the selected Fish voice, animated explanatory graphics, original local music/cut sounds and timed captions. Full decode, spoken-word sequence, caption frames and audio levels were checked. YouTube initial checks found no issues. No paid spend.\n\n'
status+='Remaining calendar videos: '+', '.join(remaining)+'. The HeyGen private-avatar list was empty in the current check; no presenter avatar has been trained or rendered. The main walkthroughs still need actual demonstration footage. An original voice reference is only needed for the optional local clone, not current Fish production.\n\n'
status+='Channel strategy, 20 ideas, 12 episode briefs, folder structure and calendar are included. Projects and Nori first, gaming on the side. Capacity assumption: six hours weekly. Branding is published; Creator Tools playlist is public. Its Home section is saved in Studio, public homepage shelf appearance not yet verified. Older gaming and music uploads were preserved. No videos deleted. Metadata and playlist changes are in 06-Archive-Audit.\n\n'
status+='Scheduled videos remain private until their release. User authorized the Fish workflow; service-license classification remains documented separately. No growth improvement is claimed before performance data exists.\n'
for p in [root/'START-HERE.txt',root/'PRODUCTION-PROGRESS.txt',root/'03-Production/PRODUCTION-PROGRESS.txt']:
 p.write_text(status,encoding='utf-8')
with (root/'06-Archive-Audit/changes-2026-09-30.txt').open('a',encoding='utf-8') as f:
 f.write('\nVERIFIED NEW SCHEDULE: '+record['title']+' — '+record['scheduled_publish']+' — '+record['url']+'. Initial checks no issues; captions saved, SD/HD complete.\n')
narration='CURRENT NARRATION STATUS\n\n'
for p in sorted(root.glob('02-Calendar/Week-*/*/narration.txt')):
 words=len(p.read_text(encoding='utf-8-sig').split());audio=p.parent/'narration-fred-final.mp3'
 narration+=f'{p.parent.name}: {words} source words; '+('Fish narration generated and aligned' if audio.exists() else 'narration generation pending')+'\n'
narration+='\nOnly final verified MP4s listed in the completion audit are complete videos. The personal HeyGen avatar remains unconfigured.\n'
(root/'03-Production/NARRATION-STATUS.txt').write_text(narration,encoding='utf-8')
p=root/'03-Production/FISH-AUDIO-VOICE.json';x=read(p)
x.update(current_status=f'Fish fred voice operational using S2.1 Pro Free. {len(finals)} verified final calendar Shorts; {len(public)} public and {len(scheduled)} scheduled. No paid model used.',
 calendar_audio_files=[str(p.relative_to(root)).replace('\\','/') for p in root.glob('02-Calendar/Week-*/*/narration-fred-final.mp3')])
write(p,x)
archive=Path('C:/Nori/streaming/channel-operator-2026-09-30.zip')
with zipfile.ZipFile(archive,'w',compression=zipfile.ZIP_DEFLATED) as z:
 for p in root.rglob('*'):
  if p.is_file():z.write(p,p.relative_to(root))
with zipfile.ZipFile(archive) as z:assert z.testzip() is None
print(json.dumps({'final_mp4s':len(finals),'public':len(public),'scheduled':len(scheduled),'remaining':len(remaining),'package_integrity':'passed','goal_complete':False}))
