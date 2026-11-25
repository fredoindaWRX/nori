import hashlib,json,shutil
from pathlib import Path
R=Path('C:/Nori/streaming/channel-operator');P=R/'02-Calendar/Week-2/W2-MAIN';V=P/'voice-performance-inputs'
current=R/'03-Production/Fish-Ready-Scripts/W2-MAIN'
backup=Path('C:/Nori/streaming/tools/verification/pre-performance-revision/W2-MAIN/original-canonical-fish-chunks')
assert current.resolve().is_relative_to(R.resolve())
assert backup.resolve().is_relative_to(Path('C:/Nori/streaming/tools/verification').resolve())
assert not backup.exists();current.rename(backup);current.mkdir()
for i in range(1,5):shutil.copy2(V/f'speech-{i:02}.txt',current/f'speech-{i:02}.txt')
qpath=R/'03-Production/Fish-Ready-Scripts/GENERATION-QUEUE.json';queue=json.loads(qpath.read_text(encoding='utf-8-sig'))
plan=json.loads((P/'SHOT-PLAN.json').read_text(encoding='utf-8'));qa=json.loads((P/'narration-alignment-check.json').read_text(encoding='utf-8'))
for row in queue:
 if row['video_id']=='W2-MAIN':row.update(chunks=4,characters_per_chunk=[len((V/f'performance-{i:02}.txt').read_text(encoding='utf-8')) for i in range(1,5)],script_sha256=plan['script_sha256'],engine='s2.1-pro-free',status='Four full voice sections generated; 340.13-second clear master assembled. Recognition flags, final MP4 and owner avatar remain incomplete.',actual_generation_record='02-Calendar/Week-2/W2-MAIN/voice-performance-inputs/GENERATION-RECORD.json')
qpath.write_text(json.dumps(queue,indent=2),encoding='utf-8')
progresspath=R/'03-Production/LONG-FORM-PROGRESS.json';progress=json.loads(progresspath.read_text(encoding='utf-8'))
progress['current_work']={'id':'W2-MAIN','voice_duration_seconds':qa['duration_seconds'],'voice_master_decode_passed':True,
 'script_words':plan['word_count'],'visual_beats':48,'original_memes':4,'captions':qa['caption_cues'],
 'actual_recording_settings_screenshot':True,'wording_review_flags':len(qa['recognition_flags']),
 'status':'Voice and assets assembled; recognition review and video render/publishing remain incomplete'}
progresspath.write_text(json.dumps(progress,indent=2),encoding='utf-8')
state={'episode':'W2-MAIN','working_title':'Separate Your Mic and Discord in OBS',
 'script_complete':True,'free_voice_sections_generated':4,'clear_master_seconds':qa['duration_seconds'],
 'raw_audio_preserved':True,'caption_cues':qa['caption_cues'],'hook_end_seconds':qa['hook_end_seconds'],
 'visual_beats':48,'original_memes':4,'actual_obs_configuration_captured':True,
 'final_mp4':False,'publication_status':'Not uploaded','owner_voice_listening_verified':False,
 'next_required':['Review recognition flags against source recordings and independent recognizer evidence','Finish timed animated edit with own-channel cutaways and subdued music','Full MP4 decode and exported frame/audio review','Publish Public with captions and end screen'],
 'channel_totals':{'public_shorts':8,'public_main_videos':1,'scheduled':0}}
(P/'PRODUCTION-STATE.json').write_text(json.dumps(state,indent=2),encoding='utf-8')
gpath=V/'GENERATION-RECORD.json';g=json.loads(gpath.read_text(encoding='utf-8'))
for i,chunk in enumerate(g['chunks'],1):chunk['words']=len((V/f'speech-{i:02}.txt').read_text(encoding='utf-8').split())
g['generation_download_ids']=['064747f9-c429-47e9-a260-dad967d9be26','f955b6c8-569b-4de2-b541-be501229eeba','6ab017f6-2045-493e-b784-e55fb5767d32','4f001fc9-b7ed-4e0c-a32d-b792a565e1e9']
gpath.write_text(json.dumps(g,indent=2),encoding='utf-8')
print(json.dumps(state))
