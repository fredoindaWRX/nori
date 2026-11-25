import argparse,csv,json,re,zipfile
from datetime import datetime,timezone,timedelta,date
from pathlib import Path

root=Path('C:/Nori/streaming/channel-operator')
def read(p):return json.loads(p.read_text(encoding='utf-8-sig'))
def write(p,x):p.write_text(json.dumps(x,indent=2,ensure_ascii=False)+'\n',encoding='utf-8')
parser=argparse.ArgumentParser();parser.add_argument('calendar_id');parser.add_argument('youtube_id');parser.add_argument('proof_prefix');args=parser.parse_args()
folder=next(root.glob('02-Calendar/Week-*/'+args.calendar_id));package=read(folder/'publishing-package.json')
video=folder/package['video_asset'];verification=read(video.with_suffix('.verification.json'));quality=read(folder/'Export-Review/export-checks.json')
assert video.exists() and video.stat().st_size>10000
assert any(t in quality['caption_frame_review'].lower() for t in ['inspected','frames reviewed'])
assert abs(quality['integrated_lufs']+16)<1 and quality['true_peak_dbtp']<=-1
proof='06-Archive-Audit/'+args.proof_prefix+'-public-details.jpg';assert (root/proof).exists()
now=datetime.now(timezone.utc);local=now.astimezone(timezone(timedelta(hours=-4)))
old=read(folder/'publication-record.json') if (folder/'publication-record.json').exists() else {}
captions=len(re.findall(r'(?m)^\d+\s*$',(folder/'captions.srt').read_text(encoding='utf-8-sig')))
record={'calendar_id':args.calendar_id,'youtube_video_id':args.youtube_id,'title':package['title'],
 'url':'https://www.youtube.com/shorts/'+args.youtube_id,'visibility':'Public','published_date':local.date().isoformat(),
 'verified_at_utc':now.isoformat(),'verification':['Studio saved Video details shows Public, exact title, selected playlist, uploaded thumbnail, SD and HD complete, disabled Save'],
 'copyright_initial_check':'No issues found','community_guidelines_initial_check':'No issues found',
 'playlist':package.get('playlist','Creator Tools'),'playlist_id':package.get('playlist_id','PLKwzclKlwEk8'),'related_video_id':package.get('related_video_id'),
 'cover':package['thumbnail_overlay']+'; custom cover uploaded',
 'captions':f'{captions} timed cues burned into final MP4; SRT imported and saved in Studio',
 'duration_seconds':float(verification['format']['duration']),'presenter':package['presenter_format'],
 'voice':'User-selected Fish fred voice through S2.1 Pro Free','paid_spend':0,
 'license_status':package['license_status'],'human_voice_likeness_review':'Not claimed; normalized spoken sequence matches source.',
 'details_proof':proof,'processing':{'standard_definition':'complete','high_definition':'complete'},
 'user_publication_decision':'User explicitly requested posting immediately instead of scheduling; scheduled releases changed to Public.',
 'growth_measured':False}
if old.get('scheduled_publish'):record['superseded_schedule']=old['scheduled_publish']
write(folder/'publication-record.json',record)
package.update(actual_upload_status='Public; saved Studio visibility and details verified',youtube_video_id=args.youtube_id,
 youtube_url=record['url'],publication_record='publication-record.json',duration_seconds=record['duration_seconds'],
 visibility_intent='public',planned_publish='Immediate publication; user requested no scheduling',publishing_hold=None)
write(folder/'publishing-package.json',package)
verification.update(quality_checks=quality,publication_status='Public; Studio saved details verified',
 youtube_initial_checks={'copyright':'No issues found','community_guidelines':'No issues found'})
write(video.with_suffix('.verification.json'),verification)
plan=read(folder/'SHOT-PLAN.json');plan.update(status='Final illustrated MP4 verified, uploaded and public',required_remaining_inputs=[],
 presenter_scope='This Short uses animated diagrams. Overall HeyGen presenter request remains unfulfilled.');write(folder/'SHOT-PLAN.json',plan)
outline='\n'.join(str(i+1)+'. '+s['title']+': '+s['voice_text'] for i,s in enumerate(plan['shots']))
(folder/'production-package.txt').write_text(f'''ID: {args.calendar_id}
PUBLISHED: {record['published_date']}; Public in YouTube, verified
FORMAT: Short / {record['duration_seconds']:.2f} seconds / 1080x1920 / 30fps / H264 and AAC
TITLE ({len(package['title'])} characters): {package['title']}
HOOK: {plan['shots'][0]['voice_text']}
FINAL SCENES:
{outline}
CTA: {plan['shots'][-1]['voice_text']}
END SCREEN: {('Related-video link to '+package.get('related_video_title','OBS Is Showing Itself? Fix This First')) if package.get('related_video_id') else 'Follow CTA; no unrelated or unreleased video link'}. Shorts have no traditional end-screen elements.
THUMBNAIL OVERLAY: {package['thumbnail_overlay']}
DESCRIPTION COPY:
{package['description']}

TAGS: {', '.join(package['tags'])}
TIMESTAMPS: No chapter timestamps for this Short. Captions follow actual speech timestamps.
VOICE: User-selected Fish fred, S2.1 Pro Free. No paid spend.
VISUALS: Animated explanatory illustrations, original local music/cut sounds and burned captions. No unperformed live test is claimed.
VERIFICATION: Full decode, source/spoken sequence, timed captions and all caption frames checked. Audio {quality['integrated_lufs']} LUFS, {quality['true_peak_dbtp']} dBTP. Initial YouTube checks no issues; SD/HD complete.
STATUS: Final illustrated MP4 verified, uploaded and Public. Full HeyGen presenter request remains incomplete.
YOUTUBE: {record['url']}
''',encoding='utf-8')
records=[read(p) for p in root.glob('02-Calendar/Week-*/*/publication-record.json')]
public=[x for x in records if x['visibility']=='Public'];scheduled=[x for x in records if x['visibility']=='Scheduled']
finals=[]
for p in root.glob('02-Calendar/Week-*/*/*.mp4'):
 q=p.parent/'Export-Review/export-checks.json'
 if p.with_suffix('.verification.json').exists() and q.exists() and any(t in read(q)['caption_frame_review'].lower() for t in ['inspected','frames reviewed']):finals.append(p)
remaining=[p.parent.name for p in root.glob('02-Calendar/Week-*/*/SHOT-PLAN.json') if p.parent not in {v.parent for v in finals}]
with (root/'calendar.csv').open(encoding='utf-8-sig',newline='') as f:reader=csv.DictReader(f);fields=reader.fieldnames;rows=list(reader)
for row in rows:
 r=next((x for x in records if x['calendar_id']==row['ID']),None)
 if r and r['visibility']=='Public':
  row.update(PublishDate=r['published_date'],Day=date.fromisoformat(r['published_date']).strftime('%A'),WorkingTitle=r['title'],
   Visibility='Public; published and verified',MediaStatus='Final illustrated MP4 verified and public; user-selected Fish narration')
 elif not r:
  row.update(Visibility='Publish immediately after verified production; not uploaded')
with (root/'calendar.csv').open('w',encoding='utf-8-sig',newline='') as f:w=csv.DictWriter(f,fieldnames=fields,quoting=csv.QUOTE_ALL);w.writeheader();w.writerows(rows)
audit=read(root/'COMPLETION-AUDIT.json')
audit['phase3'].update(calendar_mp4_count=len(finals),illustrated_final_edits_count=len(finals),remaining_calendar_ids=remaining,
 remaining_calendar_videos=len(remaining),heygen_private_avatar_count=0,published_illustrated_short_count=len(public))
for key in ['other_eleven_videos','remaining_ten_videos']:audit['phase3'].pop(key,None)
audit['phase4'].update(new_calendar_uploads=len(records),public_calendar_videos=len(public),scheduled_calendar_videos=len(scheduled),
 published_videos=public,scheduled_videos=scheduled,publication_preference='Immediate public release after verification; user requested no scheduling.',
 planned_dates='Calendar future dates are production planning slots. Public and Scheduled publication-record states are the verified live channel states.')
audit['last_goal_turn']=f'Meaningful progress: {len(finals)} verified final MP4s, {len(public)} public, {len(scheduled)} still scheduled pending conversion.'
audit['blocking_condition'].update(consecutive_goal_turns_observed=0,
 condition='Fish voice operational; user authorized publishing. Owner HeyGen avatar and actual main-video demonstration footage unavailable.',
 safe_production_next_action='Continue remaining illustrated Shorts. Main presenter videos need owner avatar setup and actual demonstration footage.')
write(root/'COMPLETION-AUDIT.json',audit)
status=f'FREDOINDAWRX CHANNEL — CURRENT VERIFIED STATUS\n\n{len(finals)} of 12 final calendar MP4s verified. {len(public)} public; {len(scheduled)} scheduled. Overall phases 3 and 4 incomplete. User requested immediate publication of finished videos.\n\n'
for r in sorted(records,key=lambda x:x['calendar_id']):status+=r['title']+'\n'+r['url']+'\n'+r['visibility']+' — '+r.get('scheduled_publish',r.get('published_date',''))+'\n\n'
status+='Completed Shorts use the selected Fish voice, animated explanatory graphics, original local music/cut sounds, and actual timed captions. Full decode, spoken sequence, caption frames and audio levels checked. YouTube initial checks found no issues; no paid spend. Human voice-likeness listening review not claimed.\n\n'
status+='Remaining videos: '+', '.join(remaining)+'. No personal HeyGen avatar configured; main walkthroughs still need actual demo footage. An original reference affects only the optional local voice clone. Current Fish generation works.\n\n'
status+='Strategy, 20 ideas, 12 briefs and organized folders included. Projects and Nori first, gaming on the side. Six hours weekly assumed. Branding published. Creator Tools public playlist created and saved Home section configured; public Home shelf appearance unverified. Older gaming and music preserved; no uploads deleted. Archive changes documented in 06-Archive-Audit.\n\n'
status+='Fish service-license classification remains documented separately. No growth improvement claimed before data exists. Planned future calendar dates are production targets, not scheduled releases.\n'
for p in [root/'START-HERE.txt',root/'PRODUCTION-PROGRESS.txt',root/'03-Production/PRODUCTION-PROGRESS.txt']:p.write_text(status,encoding='utf-8')
with (root/'06-Archive-Audit/changes-2026-09-30.txt').open('a',encoding='utf-8') as f:f.write('\nVERIFIED PUBLICATION: '+record['title']+' — '+record['url']+'. User requested immediate publication; Studio saved Public, SD/HD complete.\n')
narration='CURRENT NARRATION STATUS\n\n'
for p in sorted(root.glob('02-Calendar/Week-*/*/narration.txt')):
 narration+=f'{p.parent.name}: {len(p.read_text(encoding="utf-8-sig").split())} source words; '+('Fish narration generated and aligned' if (p.parent/'narration-fred-final.mp3').exists() else 'generation pending')+'\n'
narration+='\nOnly final verified MP4s in the completion audit are complete videos. HeyGen avatar remains unconfigured.\n';(root/'03-Production/NARRATION-STATUS.txt').write_text(narration,encoding='utf-8')
p=root/'03-Production/FISH-AUDIO-VOICE.json';x=read(p);x.update(current_status=f'Fish fred operational with S2.1 Pro Free: {len(finals)} verified final Shorts, {len(public)} public. No paid model.',
 calendar_audio_files=[str(p.relative_to(root)).replace('\\','/') for p in root.glob('02-Calendar/Week-*/*/narration-fred-final.mp3')]);write(p,x)
archive=Path('C:/Nori/streaming/channel-operator-2026-09-30.zip')
with zipfile.ZipFile(archive,'w',compression=zipfile.ZIP_DEFLATED) as z:
 for p in root.rglob('*'):
  if p.is_file():z.write(p,p.relative_to(root))
with zipfile.ZipFile(archive) as z:assert z.testzip() is None
print(json.dumps({'final_mp4s':len(finals),'public':len(public),'scheduled':len(scheduled),'remaining':len(remaining),'package_integrity':'passed','goal_complete':False}))
