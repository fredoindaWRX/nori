import json, subprocess, hashlib
from pathlib import Path
from datetime import datetime, timezone
import numpy as np

root = Path('C:/Nori/streaming/channel-operator')
folder = root/'03-Production/Human-Reactions/Privacy-Milk/HeyGen-Updated-Avatar'
ffmpeg = 'C:/Nori/streaming/tools/ffmpeg/ffmpeg-9.0.2-essentials_build/bin/ffmpeg.exe'
def audio(path):
    result = subprocess.run([ffmpeg, '-v','error','-i',str(path),'-vn','-ac','1','-ar','16000','-f','f32le','pipe:1'],capture_output=True,check=True)
    return np.frombuffer(result.stdout,dtype='<f4')
source=folder/'HeyGen-Owner-Avatar-Original.mp4'
final=folder/'Keep-The-Group-Chat-Off-Stream-HeyGen-Final.mp4'
a,b=audio(source),audio(final)
length=min(len(a),len(b)); a,b=a[:length],b[:length]
mask=np.ones(length,dtype=bool)
for start,end in [(2.6,3.0),(8.35,8.7)]: mask[int(start*16000):int(end*16000)]=False
correlation=float(np.corrcoef(a[mask],b[mask])[0,1])
assert correlation>.98, correlation
now=datetime.now(timezone.utc).isoformat()
def read(path): return json.loads(path.read_text(encoding='utf-8-sig'))
def write(path,value): path.write_text(json.dumps(value,indent=2,ensure_ascii=False)+'\n',encoding='utf-8')
qa=read(folder/'FINAL-VERIFICATION.json')
qa.update(audio_alignment_correlation=correlation,audio_alignment_scope='Zero-offset original versus final audio, excluding two added sound-effect windows; not a perceptual voice or lip-sync approval', verified_at_utc=now)
write(folder/'FINAL-VERIFICATION.json',qa)
job=read(folder/'GENERATION-JOB-RECORD.json')
job.update(final_mp4_verified=True,official_native_download_verified=True,provider_download_available=True,inline_player_download_available=False,source_file=source.name,final_file=final.name,source_sha256=hashlib.sha256(source.read_bytes()).hexdigest(),final_sha256=hashlib.sha256(final.read_bytes()).hexdigest(),source_bytes=source.stat().st_size,final_bytes=final.stat().st_size,record_source='Root witnessed completed provider job, authenticated official native 720P export, local full decode and final frame review.',status_evidence='Completed job exported via native HeyGen Download Video; local source and captioned final MP4 verified.',export_verified_at_utc=now)
write(folder/'GENERATION-JOB-RECORD.json',job)
audit=read(root/'COMPLETION-AUDIT.json')
audit['phase3'].update(heygen_replacement_render_processing=False,heygen_replacement_final_mp4_verified=True)
audit['owner_quality_revision']['heygen_replacement_generation_processing']=False
audit['avatar_setup_progress'].update(current_generation_status='completed',generation_final_mp4_verified=True,finished_postable_mp4_verified=True,official_native_export_available=True,heygen_workflow_complete=True,next_step='Owner-facing final video delivered; quality feedback pending. Live stream integration and older content review remain incomplete.')
audit['blocking_condition'].update(condition='Replacement source and finished HeyGen MP4 are complete; quality acceptance, live stream integration and older-content review remain incomplete.',safe_production_next_action='Use finished verified HeyGen export; incorporate owner feedback. Continue audio/live assistance and archive review independently.')
audit['last_goal_turn'].update(classification='progress',progress='Verified zero-offset narration preservation against official source, reconciled completed native export and finished edit records; owner acceptance remains unconfirmed.')
audit['delivery_reconciliation']['archive_is_current']=False
write(root/'COMPLETION-AUDIT.json',audit)
start=root/'START-HERE.txt'
text=start.read_text(encoding='utf-8-sig')
text=text.replace('HEYGEN REPLACEMENT - PROCESSING','HEYGEN REPLACEMENT - FINISHED LOCAL VIDEO; NOT PUBLISHED')
text=text.replace('Inline player is tracking processing. No completed render, verified final MP4 or new YouTube upload is claimed. Do not duplicate this generation.','Generation completed. Official native 720P video and captions exported. The finished 13.68-second MP4 preserves source motion and speaking speed, with 14 captions, two quiet original reaction sounds and a short illustrative two-monitor inset. Full decode and frame review passed; source/final narration alignment checked. Delivered for owner review; voice quality and perceptual lip sync remain unaccepted. No new YouTube upload. Do not duplicate this generation. Final: 03-Production/Human-Reactions/Privacy-Milk/HeyGen-Updated-Avatar/Keep-The-Group-Chat-Off-Stream-HeyGen-Final.mp4.')
text=text.replace('existing processing HeyGen replacement job record','completed HeyGen replacement export, final edit and verification records')
start.write_text(text,encoding='utf-8')
print(json.dumps({'audio_zero_offset_correlation':correlation,'source_bytes':source.stat().st_size,'final_bytes':final.stat().st_size,'records_reconciled':True,'owner_acceptance':False,'youtube_published':False}))
