import csv,json,shutil
from pathlib import Path
root=Path('C:/Nori/streaming/channel-operator')
inventory=json.loads((root/'LIVE-VIDEO-INVENTORY.json').read_text(encoding='utf-8-sig'))
revisions=[v for v in inventory['videos'] if v['version']=='Fred voice revision']
assert len(inventory['videos'])==16 and len(revisions)==4
records=[]
for video in revisions:
 path=root/Path(video['proof_record'].replace('\\','/'))
 record=json.loads(path.read_text(encoding='utf-8-sig'))
 assert any(record.get(k) is True for k in ['native_publication_verified','native_publication_confirmed','native_publication_modal_verified'])
 assert record['public_playback_verified'] is True
 assert record.get('url',record.get('youtube_url'))==video['url'] and record['visibility']=='Public'
 assert (path.parent/'YouTube-published.jpg').is_file() and (path.parent/'YouTube-public-player.jpg').is_file()
 records.append({'calendar_id':video['calendar_id'],'title':record['title'],'url':video['url'],
   'visibility':record['visibility'],'narrator':record.get('narrator',record.get('voice')),
   'published_date':record.get('published_date','2026-09-30')})
calendar=root/'calendar.csv'
with calendar.open(encoding='utf-8-sig',newline='') as f:
 reader=csv.DictReader(f); fields=reader.fieldnames; rows=list(reader)
assert len(rows)==12
revision_urls={v['calendar_id']:v['url'] for v in revisions}
for row in rows:
 if row['ID'] in revision_urls: row['RevisionURL']=revision_urls[row['ID']]
with calendar.open('w',encoding='utf-8',newline='') as f:
 writer=csv.DictWriter(f,fieldnames=fields);writer.writeheader();writer.writerows(rows)
with (root/'04-Publishing/fred-revisions.csv').open('w',encoding='utf-8',newline='') as f:
 writer=csv.DictWriter(f,fieldnames=['calendar_id','title','published_date','visibility','url','narrator'])
 writer.writeheader();writer.writerows({k:r[k] for k in writer.fieldnames} for r in records)
status='''FREDOINDAWRX CHANNEL — CURRENT VERIFIED STATUS, OCTOBER 1, 2026

16 batch uploads are Public: all 12 calendar videos (8 Shorts and 4 full episodes), plus 4 Fred-voiced Short revisions. Zero scheduled. Original uploads remain available. The calendar, LIVE-VIDEO-INVENTORY.json and 04-Publishing/fred-revisions.csv contain links.

CURRENT NARRATOR
MiniMax fred is the owner's existing voice clone, explicitly selected by the owner. W3 and W4 full episodes and all four W3/W4 Short revisions use Fred. Nori's own voice is separate. Earlier Ethan and Jordan local exports are superseded and unpublished. Older Fish narration still needs quality review.

FRED SHORT REVISIONS
'''+''.join(r['title']+'\n'+r['url']+'\n' for r in records)+'''
FULL FRED EPISODES
Before I Trust My AI, I Check These 3 Things
https://www.youtube.com/watch?v=34dGUmC_4U0
Your AI Says Done. Where Is the Actual Work?
https://www.youtube.com/watch?v=ntKcYA5jqtM

STREAM ASSISTANCE
08-Stream-Assistant contains the producer desk, setup instructions, answer evidence and local checks. Selected public questions can be answered by the local engine and loaded into a draft for owner review. No live YouTube chat feed, automatic moderation or OBS control is connected. This requires the existing C:/Nori installation on this computer.

VERIFICATION
Final MP4 exports passed full decode. Public players and related full-episode links were checked for all four Fred revisions. Four full episodes have native subtitle publication confirmations and saved end screens. Burned captions are included; public availability of optional native CC remains unverified. Local question-answer inference completed and the engine stopped. Six answer logic checks and eight timer/clip checks passed; updated producer browser visuals remain unverified.

AUDIENCE EVIDENCE
Newest Short TpGpkDOQPZ0: one realtime view, retention processing at the October 1 check. Content list showed two views. Different reporting surfaces and processing delay prevent a reliable performance conclusion. No measured channel growth or owner acceptance of finished voice quality is claimed.

REMAINING WORK
Review and improve older narration and storytelling. Complete the owner avatar input/integration. Verify actual microphone/Discord recording and monitor capture behavior. Connect and verify live stream-assistance/moderation. Review older replays further and assess retention with enough data. Whole original goal remains incomplete.
'''
for name in ['START-HERE.txt','PRODUCTION-PROGRESS.txt','03-Production/PRODUCTION-PROGRESS.txt']:
 (root/name).write_text(status,encoding='utf-8')
progress_path=root/'03-Production/LONG-FORM-PROGRESS.json'
progress=json.loads(progress_path.read_text(encoding='utf-8-sig'))
progress['additional_fred_short_revisions_public']=4
progress['total_batch_public']=16
progress_path.write_text(json.dumps(progress,indent=2)+'\n',encoding='utf-8')
stream=root/'08-Stream-Assistant';stream.mkdir(exist_ok=True)
for original in ['producer.html','STREAM-ASSISTANT.txt']:
 shutil.copy2(root.parent/original,stream/original)
for name in ['stream-answer-verified.json','producer-answer-verification.json','producer-clip-verification.json']:
 shutil.copy2(root.parent/'preview-images'/name,stream/name)
(stream/'START-HERE.txt').write_text('''Open C:/Nori/streaming/producer.html on this computer. Add a selected public viewer question and choose Export for Nori. Drag the downloaded question file onto C:/Nori/streaming/tools/Connect-Nori-Answer.cmd. Load the resulting answer JSON in the panel, review it, and use it as an editable draft. Nothing is posted automatically.
The copied producer.html is included for reference and local use. Its graphics preview is at C:/Nori/streaming/preview.html. Local inference requires the existing C:/Nori runtime and model. Browser visual review was unavailable; logic checks and actual inference are documented in this folder.
''',encoding='utf-8')
analytics={'video_id':'TpGpkDOQPZ0','checked_date':'2026-10-01','studio_content_list_views':2,'overview_headline_views':1,'realtime_last_60_minutes_views':1,'metric_card_views':None,'subscribers_net_change':None,'audience_retention':'not available; processing can take up to two days','traffic_source':'Shorts feed 100% (one realtime view)','decision':'Keep current publication unchanged; insufficient sample to assess hook/voice quality or growth.','source':'YouTube Studio authenticated UI','screenshot':'newest-short-early-overview-2026-10-01.png'}
(root/'07-Analytics/newest-short-early-overview-2026-10-01.json').write_text(json.dumps(analytics,indent=2)+'\n',encoding='utf-8')
audit_path=root/'COMPLETION-AUDIT.json'
audit=json.loads(audit_path.read_text(encoding='utf-8-sig'))
audit['delivery_reconciliation']={'date':'2026-10-01','calendar_rows':12,'public_revision_proof_records_checked':4,'total_public_upload_records':16,'stream_assistance_included':True,'newest_short_retention_ready':False,'whole_goal_complete':False}
audit['last_goal_turn']={'date':'2026-10-01','progress':'Reconciled all four verified Fred revisions into the calendar and delivery files; included local answer workflow and current early analytics evidence. Full objective remains incomplete.'}
audit_path.write_text(json.dumps(audit,indent=2)+'\n',encoding='utf-8')
print(json.dumps(audit['delivery_reconciliation']))
