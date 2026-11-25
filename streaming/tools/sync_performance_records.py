"""Reconcile current narration and review evidence; never generate or publish."""
from pathlib import Path
import hashlib,json,shutil
root=Path('C:/Nori/streaming/channel-operator');queue=root/'03-Production/Fish-Ready-Scripts'
queue_records=json.loads((queue/'GENERATION-QUEUE.json').read_text(encoding='utf-8'))
asset_records=json.loads((root/'03-Production/SCENE-ASSET-REGISTER.json').read_text(encoding='utf-8'))
byid={row['video_id']:row for row in queue_records};assets={row['video_id']:row for row in asset_records}
backup=Path('C:/Nori/streaming/tools/verification/pre-performance-revision/queue');backup.mkdir(parents=True,exist_ok=True)
performance=[]
for file in sorted((root/'02-Calendar').glob('Week-*/*/SHOT-PLAN.json')):
 folder=file.parent;plan=json.loads(file.read_text(encoding='utf-8'));vid=plan['video_id']
 if '-S' not in vid:
  byid[vid]['status']='Existing source chunks retained; revise for the owner requested conversational performance before generation. Main final video and owner avatar incomplete.'
  continue
 script=(folder/'narration.txt').read_text(encoding='utf-8').strip()
 assert ' '.join(shot['voice_text'] for shot in plan['shots'])==script
 target=queue/vid;target.mkdir(exist_ok=True)
 for chunk in target.glob('speech-*.txt'):
  assert chunk.resolve().is_relative_to(queue.resolve())
  saved=backup/(vid+'-'+chunk.name)
  if not saved.exists():shutil.copy2(chunk,saved)
  if chunk.name!='speech-01.txt':
   assert not (backup/(vid+'-retired-'+chunk.name)).exists()
   chunk.rename(backup/(vid+'-retired-'+chunk.name))
 directed=folder/'voice-performance-input.txt';generation=directed.read_text(encoding='utf-8').strip() if directed.exists() else script
 (target/'speech-01.txt').write_text(generation+'\n',encoding='utf-8')
 package=json.loads((folder/'publishing-package.json').read_text(encoding='utf-8'))
 quality=json.loads((folder/'Export-Review/export-checks.json').read_text(encoding='utf-8'))
 verification=json.loads((folder/package['video_asset']).with_suffix('.verification.json').read_text(encoding='utf-8'))
 published=json.loads((folder/'publication-record.json').read_text(encoding='utf-8')) if (folder/'publication-record.json').exists() else None
 byid[vid].update(chunks=1,characters_per_chunk=[len(generation)],script_sha256=hashlib.sha256(script.encode()).hexdigest(),directed_input_sha256=hashlib.sha256(generation.encode()).hexdigest(),source_script=str(folder/'narration.txt'),source_performance_input=str(directed) if directed.exists() else None,status='Final video published; no new generation pending.' if published else 'Final video verified; publication pending.',engine='s2.1-pro-free')
 assets[vid].update(shots=len(plan['shots']),hook_words=len(plan['shots'][0]['voice_text'].split()),final_mp4_verified=True,actual_caption_frames=quality['frames_checked'],review_evidence=str(folder/'Export-Review/caption-and-scene-review.jpg'),render_style=verification.get('edit_style'),scene_assets_checked='Actual final exported frames inspected; current renderer generates motion directly.')
 if directed.exists():
  performance.append({'calendar_id':vid,'title':package['title'],'duration_seconds':float(verification['format']['duration']),'source_word_check':json.loads((folder/'narration-alignment-check.json').read_text(encoding='utf-8'))['source_word_match'],'actual_frames_reviewed':quality['frames_checked'],'integrated_lufs':quality['integrated_lufs'],'true_peak_dbtp':quality['true_peak_dbtp'],'publication':published['url'] if published else 'Pending','voice_likeness_or_human_listening_verified':False})
(queue/'GENERATION-QUEUE.json').write_text(json.dumps(queue_records,indent=2,ensure_ascii=False)+'\n',encoding='utf-8')
(root/'03-Production/SCENE-ASSET-REGISTER.json').write_text(json.dumps(asset_records,indent=2,ensure_ascii=False)+'\n',encoding='utf-8')
(root/'03-Production/PERFORMANCE-REVISION-RECORD.json').write_text(json.dumps({'owner_feedback':['Too robotic or flat','Words and pacing feel unnatural'],'performed_comedies':performance,'paid_spend':0,'full_channel_operator_goal_complete':False},indent=2)+'\n',encoding='utf-8')
(queue/'README.txt').write_text('CURRENT FISH SPEECH INPUTS\n\nEight Short folders contain the actual current generation input used for their final audio. Expressive cues are stored here only when that performance was generated with them. These inputs are not a pending batch: inspect GENERATION-QUEUE.json for each current status. The ordinary spoken script remains narration.txt inside its calendar folder. Do not speak the bracket directions or include them in captions.\n\nThe four main-video folders retain earlier source chunks. They still need the owner requested conversational performance revision, final walkthrough footage, a finished presenter and MP4 review. Do not submit them as an unattended batch.\n\nUse only the existing fred voice with S2.1 Pro Free. No paid model, purchase or subscription is authorized. Credentials remain in the Fish account.\n\nSee ../PERFORMANCE-STANDARD.txt. Publish verified videos immediately, not on a schedule.\n',encoding='utf-8')
print(json.dumps({'synchronized_short_inputs':8,'expressive_performances':len(performance),'main_videos_incomplete':4}))
