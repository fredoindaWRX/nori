"""Save verified channel edits and reconcile remaining production requirements."""
from pathlib import Path
import csv,json,shutil,zipfile
root=Path('C:/Nori/streaming/channel-operator')
audit=root/'06-Archive-Audit'
rows=[
 {'video_id':'6aqBDV0Ztks','before':'If you know ,you know #arcraiders #nightraid #gaming #live',
  'after':'Found the Tempest Again | ARC Raiders','related_video_id':'_6fNe90lhLY',
  'review_evidence':'Visible Found The Tempest Again overlay and inventory scenes; no transcript available',
  'public_proof':'tempest-short-public-related-guide.jpg','views_at_edit':1105},
 {'video_id':'OdFRx1liGpo','before':'Watch till the end #arcraiderslive #arcraiders #gaminglive #gaming #blueprinthunt',
  'after':"ARC Raiders: That 'Oh No' Moment",'related_video_id':'ldNIFZaw-BA',
  'review_evidence':'Gameplay frame and original auto-caption Oh no at 0:04',
  'public_proof':'oh-no-short-public-related-clip.jpg','views_at_edit':169},
 {'video_id':'v2g6kn3Ib2Y','before':'Watch till the end #arcraiderslive #arcraiders #gaminglive #gaming #blueprinthunt',
  'after':"ARC Raiders: From 'Oh No' to 'Help'",'related_video_id':'ldNIFZaw-BA',
  'review_evidence':'Gameplay frame and original auto-caption Oh no at 0:01 and Help at 0:11',
  'public_proof':'help-short-public-related-clip.jpg','views_at_edit':539}
]
for row in rows:
 row.update({'description_updated':True,'hashtag_count':3,'visibility':'Public','verification':'Studio All changes saved; public Shorts player displays new title and related-video button','growth_measured':False})
(audit/'shorts-edits-verified.json').write_text(json.dumps(rows,indent=2),encoding='utf-8')
shutil.copyfile('C:/Users/Studio/AppData/Local/Temp/browser-use/exports/youtube-OdFRx1liGpo-96cf4c57-f202-4709-b426-89ffcf681e97.txt',audit/'oh-no-short-original-transcript.txt')
shutil.copyfile('C:/Users/Studio/AppData/Local/Temp/browser-use/exports/youtube-v2g6kn3Ib2Y-9384ee0b-4d2e-4565-b907-4ac6bafdcef8.txt',audit/'help-short-original-transcript.txt')
with (root/'calendar.csv').open(encoding='utf-8-sig',newline='') as f:
 reader=csv.DictReader(f); fields=reader.fieldnames; calendar=list(reader)
for row in calendar:
 row['Visibility']='Planned scheduled publication; not uploaded'
 if row['ID']=='W1-S1':row['MediaStatus']='Local edit verified; commercial rights and presenter requirements unresolved'
with (root/'calendar.csv').open('w',encoding='utf-8-sig',newline='') as f:
 writer=csv.DictWriter(f,fieldnames=fields,quoting=csv.QUOTE_ALL);writer.writeheader();writer.writerows(calendar)
with (root/'idea-bank.csv').open(encoding='utf-8-sig',newline='') as f:ideas=list(csv.DictReader(f))
packages=list((root/'02-Calendar').glob('Week-*/*/production-package.txt'))
phase2_checks=[]
for p in packages:
 text=p.read_text(encoding='utf-8-sig')
 phase2_checks.append({'video_id':p.parent.name,'hook_outline_cta_end_screen_defined':all(x in text for x in ['FIRST FIVE SECONDS:','SECTIONS:','CTA:','END SCREEN:'])})
evidence={
 'phase1':{'status':'planning_deliverables_complete','strategy':'strategy.txt','ideas':len(ideas),'priority_picks':sum(i['Priority']=='HIGH' for i in ideas),'categories':{c:sum(i['Category']==c for i in ideas) for c in sorted({i['Category'] for i in ideas})},'capacity_assumption_hours':6},
 'phase2':{'status':'local_planning_deliverables_complete','calendar_entries':len(calendar),'video_packages':phase2_checks,'project_management_cloud_tool_connected':False},
 'phase3':{'status':'incomplete','calendar_mp4_count':len(list((root/'02-Calendar').rglob('*.mp4'))),'commercial_publication_ready_count':0,'owner_original_voice_files':len(list(Path('C:/Nori/streaming/voice-clone/inputs').glob('*'))),'heygen_private_avatar_count':0,'local_engine':'offline GPU inference and requested-word sequence verified with Qwen official example; personal clone unverified','other_eleven_videos':'not rendered','live_demonstration_footage':'still required for the main video walkthrough format'},
 'phase4':{'status':'incomplete','new_calendar_uploads':0,'scheduled_calendar_videos':0,'planned_dates':'Oct 8–Nov 3, 2026; planning only','main_video_final_timestamps':'not available without actual edits'},
 'archive':{'status':'metadata inventory and selected short-form content reviewed; not all replays watched end-to-end','new_public_shorts_edits':rows,'deleted_videos':0},
 'blocking_condition':{'condition':'Original owner voice reference and configured owner presenter unavailable, preventing requested new-video production and publishing','consecutive_goal_turns_observed':3,'observations':['First free Fish narration edit produced; commercial rights held and original reference/avatar missing','Local engine verified; original voice export blocked and no owner reference obtained','Current private-avatar list empty and creator hasExistingAvatar false; original-input folder empty'], 'safe_production_next_action':'Requires owner original voice file and owner-completed avatar setup; no running training or rendering job to wait for'}
}
(root/'COMPLETION-AUDIT.json').write_text(json.dumps(evidence,indent=2),encoding='utf-8')
update='''
PUBLIC SHORTS LINKS — VERIFIED
Three existing Shorts received descriptive titles, accurate descriptions, three relevant hashtags, and a related-video link. Found the Tempest Again | ARC Raiders (6aqBDV0Ztks) links to the Tempest guide. ARC Raiders: That 'Oh No' Moment (OdFRx1liGpo) and ARC Raiders: From 'Oh No' to 'Help' (v2g6kn3Ib2Y) link to ARC Raiders Funny Moments | Blue Gate. Studio save states and public Shorts players verified. Existing public visibility and ARC Raiders Highlights membership preserved. No subscriber or traffic improvement measured yet.

REMAINING REQUIRED INPUTS
Original user-recorded voice reference remains missing. Local speech engine is installed and verified, but the personal clone has not been generated. Fish-generated audio is not used for the local model. The connected HeyGen account still lists zero private avatars; the existing guided creator was reopened and reports one available avatar slot, no existing avatar. Photo, motion/consent recording and setup actions happen in the user-facing widget. No avatar training or paid generation job started by the agent. Main-video demonstration footage remains unproduced. No new calendar video is uploaded or scheduled.
'''
for f in [root/'PRODUCTION-PROGRESS.txt',root/'03-Production/PRODUCTION-PROGRESS.txt',audit/'changes-2026-09-30.txt']:
 f.write_text(f.read_text(encoding='utf-8').rstrip()+'\n'+update,encoding='utf-8')
(root/'03-Production/HEYGEN-CONNECTION.txt').write_text('''HEYGEN CONNECTION — CURRENT VERIFIED STATE
Private avatar group listing: zero items, no further pages.
Existing creator flow reopened: e0f8a2f2d9c04083b92f89dfe80217ed. Creator reports hasExistingAvatar false and one remaining avatar slot. No avatar created or training/video job started by the agent.
User completes the guided photo, motion footage, consent recording and voice steps in the inline widget. If this client cannot display it, use Avatar Hub in the HeyGen web app. No further tool calls are needed to drive the widget.
User selected Fish Audio after rejecting paid ElevenLabs; the free local alternative is engine-verified but awaits the original voice recording. Keep the selected narration source explicit and do not silently substitute a HeyGen-native voice or stock presenter.
Public channel profile picture is now confirmed; see channel-profile-published-verified.jpg.
''',encoding='utf-8')
p=root/'03-Production/ORIGINAL-VOICE-REFERENCE-STATUS.txt'
text=p.read_text(encoding='utf-8').replace('Local clone setup is incomplete and not represented as working.','Local engine installation and offline GPU inference are verified; the owner-specific clone still requires an original recording and is not represented as working.')
p.write_text(text,encoding='utf-8')
archive=Path('C:/Nori/streaming/channel-operator-2026-09-30.zip')
with zipfile.ZipFile(archive,'w',compression=zipfile.ZIP_DEFLATED) as z:
 for p in root.rglob('*'):
  if p.is_file():z.write(p,p.relative_to(root))
with zipfile.ZipFile(archive) as z:
 if z.testzip() is not None:raise RuntimeError('Package integrity failure')
print(json.dumps({'three_public_short_edits_verified':True,'calendar_status_corrected':True,'full_goal_complete':False,'required_assets_missing':True,'package_integrity':'passed'}))
