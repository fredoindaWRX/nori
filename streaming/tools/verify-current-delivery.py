import argparse,csv,hashlib,io,json,zipfile
from pathlib import Path
from urllib.parse import parse_qs,urlsplit

parser=argparse.ArgumentParser(description='Verify current delivery and any published moving-presenter replacement.')
parser.add_argument('--archive',type=Path,default=Path('C:/Nori/streaming/channel-operator-2026-09-30.zip'))
parser.add_argument('--check-only',action='store_true',help='Inspect without writing the verification report')
args=parser.parse_args()
archive=args.archive
root=Path('C:/Nori/streaming/channel-operator')

def require(condition,message):
 if not condition:raise ValueError(message)

def video_id(url):
 p=urlsplit(url)
 require(p.scheme=='https' and p.netloc=='www.youtube.com','Invalid YouTube publication URL')
 if p.path.startswith('/shorts/'):return p.path.split('/')[2]
 require(p.path=='/watch','Unexpected publication URL path')
 return parse_qs(p.query).get('v',[''])[0]

def digest(stream):
 value=hashlib.sha256()
 for chunk in iter(lambda:stream.read(1024*1024),b''):value.update(chunk)
 return value.hexdigest()

with zipfile.ZipFile(archive) as z:
 require(z.testzip() is None,'Archive integrity check failed')
 inventory=json.loads(z.read('LIVE-VIDEO-INVENTORY.json'))
 videos=inventory['videos']
 total=len(videos)
 public_total=sum(v['visibility']=='Public' for v in videos)
 unlisted_total=sum(v['visibility']=='Unlisted' for v in videos)
 require(inventory['total_public_batch_uploads']==public_total,'Inventory Public total differs from current visibility entries')
 require(inventory.get('total_published_batch_uploads',total)==total,'Historical publication total differs from video entries')
 require(inventory.get('unlisted',0)==unlisted_total,'Inventory Unlisted count differs from entries')
 require(inventory['scheduled']==0 and all(v['visibility'] in ('Public','Unlisted') for v in videos),'Inventory contains unpublished or scheduled entries')
 require(inventory.get('moving_revision_visibility_change_pending') is not True,'Moving revision visibility change is still pending')
 require(len({video_id(v['url']) for v in videos})==total,'Duplicate published video IDs')
 rows=list(csv.DictReader(io.StringIO(z.read('calendar.csv').decode('utf-8-sig'))))
 require(len(rows)==12,'Calendar must retain all12 original publications')
 by_id={r['ID']:r for r in rows}
 names=set(z.namelist())
 human='03-Production/Human-Reactions/Privacy-Milk/'
 moving=human+'Moving-Presenter/'
 originals=[v for v in videos if v['version']=='original calendar publication']
 revisions=[v for v in videos if v['version']=='Fred voice revision']
 humans=[v for v in videos if v.get('proof_record','').replace('\\','/')==human+'PUBLICATION-RECORD.json']
 moving_videos=[v for v in videos if v.get('proof_record','').replace('\\','/')==moving+'PUBLICATION-RECORD.json']
 require(len(originals)==12 and len(revisions)==4 and len(humans)==1,'Existing calendar/revision/human publications are missing')
 require(all(v['visibility']=='Public' for v in originals+revisions+humans),'One of the retained17 publications is no longer Public')
 require(len(moving_videos)<=1 and total==len(originals)+len(revisions)+len(humans)+len(moving_videos),'Unverified publication category')
 require(inventory['calendar_public']==len(originals) and inventory['additional_public_revisions']==len(revisions) and inventory['additional_public_human_skits']==len(humans),'Inventory subtotals differ')
 require(len(by_id)==12 and {v['calendar_id'] for v in originals}==set(by_id),'Original publication IDs differ from calendar')
 for v in originals:
  r=by_id[v['calendar_id']]
  require(r['YouTubeURL']==v['url'] and r['YouTubeVideoID']==video_id(v['url']),'Calendar publication URL or ID differs')

 def require_file(name):
  require(name in names and z.getinfo(name).file_size>0,'Missing or empty archive file: '+name)

 def publication(v,record_path):
  require_file(record_path)
  record=json.loads(z.read(record_path))
  url=record.get('url') or record.get('youtube_url')
  ident=record.get('video_id') or record.get('youtube_video_id')
  require(record.get('visibility')==v['visibility'] and record.get('scheduled') is not True,'Current publication visibility differs from inventory: '+record_path)
  require(url==v['url'] and ident==video_id(url),'Publication URL/ID differs from inventory: '+record_path)
  native=('native_publication_verified','native_publication_confirmed','native_publication_modal_verified')
  require(any(record.get(k) is True for k in native),'Missing native publication confirmation: '+record_path)
  require(record.get('public_playback_verified') is True,'Missing public playback confirmation: '+record_path)
  folder=record_path.rsplit('/',1)[0]+'/'
  for stem in ('YouTube-published','YouTube-public-player'):
   screenshots=[folder+stem+ext for ext in ('.png','.jpg','.jpeg') if folder+stem+ext in names]
   require(screenshots,'Missing publication screenshot: '+folder+stem)
   for name in screenshots:require_file(name)
  if v['visibility']=='Unlisted':
   require(record.get('initial_visibility')=='Public','Unlisted entry lacks initial Public publication evidence: '+record_path)
   require(record.get('native_visibility_change_verified') is True,'Unlisted entry lacks native visibility confirmation: '+record_path)
   proof=record.get('visibility_change_proof','')
   require(proof and '/' not in proof and '\\' not in proof,'Invalid Unlisted visibility screenshot name')
   require_file(folder+proof)
  return record

 for v in revisions:
  require(by_id[v['calendar_id']]['RevisionURL']==v['url'],'Calendar Fred revision URL differs')
  record_path=v['proof_record'].replace('\\','/')
  publication(v,record_path)
  folder=record_path.rsplit('/',1)[0]+'/'
  finals=[n for n in names if n.startswith(folder) and n.endswith('-Final.mp4')]
  require(finals,'Missing Fred revision final MP4: '+folder)
  for name in finals:require_file(name)
 for n in ['START-HERE.txt','PRODUCTION-PROGRESS.txt','03-Production/PRODUCTION-PROGRESS.txt']:
  require(f'{public_total} batch uploads are Public' in z.read(n).decode('utf-8'),'Stale current Public count: '+n)
  if unlisted_total:
   require(f'{total} historically published' in z.read(n).decode('utf-8') and f'{unlisted_total} Unlisted' in z.read(n).decode('utf-8'),'Missing historical/Unlisted status: '+n)
 publication(humans[0],human+'PUBLICATION-RECORD.json')
 for n in ['PUBLICATION-RECORD.json','FINAL-VERIFICATION.json','YouTube-published.png','YouTube-public-player.png','Your-Stream-Leaked-The-Group-Chat-Fred-Final.mp4','captions.srt']:
  require_file(human+n)
 require(json.loads(z.read(human+'FINAL-VERIFICATION.json'))['published'] is True,'Still-image skit is not verified published')

 moving_sha256=None
 body_gestures=None
 if moving_videos:
  record=publication(moving_videos[0],moving+'PUBLICATION-RECORD.json')
  final_name='Your-Stream-Leaked-The-Group-Chat-Moving-Fred-Final.mp4'
  source_name='Fredo-Talking-Presenter-Original-Speed.mp4'
  for name in ('FINAL-VERIFICATION.json','MOVING-PRESENTER-VERIFICATION.json',final_name,source_name,'captions.srt','cover-frame.png'):require_file(moving+name)
  final=json.loads(z.read(moving+'FINAL-VERIFICATION.json'))
  motion=json.loads(z.read(moving+'MOVING-PRESENTER-VERIFICATION.json'))
  require(final.get('published') is True,'Moving final is not verified published')
  require(final.get('full_decode')=='passed','Moving final full decode has not passed')
  require(final.get('actual_model_facial_motion') is True and final.get('camera_zoom_substitute') is False,'Moving final does not prove actual facial motion')
  require(final.get('narration_speed_unchanged') is True,'Moving final changed narration speed')
  require(final.get('resolution')==[1080,1920] and final.get('duration_seconds',0)>0 and final.get('video_codec')=='h264' and final.get('audio_codec')=='aac','Moving final format verification is incomplete')
  require(motion.get('actual_neural_facial_motion') is True and motion.get('full_decode_passed') is True and motion.get('generated_face_frame_count',0)>1,'Moving presenter source lacks motion/decode proof')
  require(motion.get('original_speed_preserved') is True and motion.get('camera_zoom_used') is False,'Moving presenter source is a zoom substitute or changed-speed source')
  if final.get('youtube_url'):require(final['youtube_url']==record.get('url',record.get('youtube_url')),'Moving verification publication URL differs')
  local_final=root/moving/final_name
  require(local_final.is_file(),'Locally verified moving final is missing')
  with z.open(moving+final_name) as stream:moving_sha256=digest(stream)
  with local_final.open('rb') as stream:require(moving_sha256==digest(stream),'Packaged moving final differs from the locally verified MP4')
  body_gestures=motion.get('body_gestures_generated',False)

 heygen=human+'HeyGen-Updated-Avatar/'
 for name in ('GENERATION-JOB-RECORD.json','FINAL-VERIFICATION.json','captions.srt','publishing-package.json'):
  require_file(heygen+name)
 job=json.loads(z.read(heygen+'GENERATION-JOB-RECORD.json'))
 heygen_qa=json.loads(z.read(heygen+'FINAL-VERIFICATION.json'))
 require(job['status']=='completed' and job.get('official_native_download_verified') is True,'HeyGen official export is not verified')
 require(heygen_qa.get('full_decode')=='passed' and heygen_qa.get('source_full_decode')=='passed','HeyGen source/final decode proof missing')
 require(heygen_qa.get('actual_source_motion_preserved') is True and heygen_qa.get('speech_speed_changed') is False,'HeyGen source motion or speed changed')
 require(heygen_qa.get('audio_alignment_correlation',0)>.98,'HeyGen narration alignment proof missing')
 for field in ('source','final'):
  name=job[field+'_file']; require_file(heygen+name)
  with z.open(heygen+name) as stream: archived_hash=digest(stream)
  require(archived_hash==job[field+'_sha256'],'HeyGen packaged file differs from official/finished file')
  with (root/heygen/name).open('rb') as stream: require(archived_hash==digest(stream),'HeyGen packaged file differs from local file')
 require(job.get('youtube_published') is False and heygen_qa.get('youtube_published') is False,'Local HeyGen replacement has an unverified publication claim')

 require(json.loads(z.read('08-Stream-Assistant/producer-answer-verification.json'))['status']=='passed','Local answer workflow verification has not passed')
 require(json.loads(z.read('08-Stream-Assistant/stream-answer-verified.json'))['answer'].strip(),'Actual local answer evidence is empty')
 require_file('07-Analytics/newest-short-early-overview-2026-10-01.png')
 result={'status':'passed','archive':str(archive),'archive_bytes':archive.stat().st_size,'files':len(names),'calendar_public':len(originals),'additional_fred_revisions_public':len(revisions),'additional_human_skits_public':len(humans),'additional_moving_presenter_public':sum(v['visibility']=='Public' for v in moving_videos),'moving_presenter_publication_records_retained':len(moving_videos),'total_public':public_total,'total_historically_published':total,'total_unlisted':unlisted_total,'human_short_and_publication_proofs_included':True,'moving_presenter_publication_and_motion_proofs_included':bool(moving_videos),'moving_final_sha256':moving_sha256,'moving_presenter_body_gestures_generated':body_gestures,'all_revision_links_proofs_and_final_mp4s_included':True,'local_answer_workflow_included':True,'latest_analytics_evidence_included':True,'whole_goal_complete':False}
if not args.check_only:
 Path('C:/Nori/streaming/channel-operator-delivery-verification.json').write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8')
print(json.dumps(result))
