"""Record local completion only after actual export images were reviewed."""
import hashlib,json,subprocess
from pathlib import Path
P=Path('C:/Nori/streaming/channel-operator/02-Calendar/Week-2/W2-MAIN');R=P.parents[2]
T=json.loads(Path('C:/Nori/streaming/tools/media-tools.json').read_text(encoding='utf-8-sig'));video=P/'Separate-Mic-Discord-OBS-Fredo.mp4'
rv=json.loads((P/'render-verification.json').read_text());review=json.loads((P/'review/REVIEW.json').read_text());voice=json.loads((P/'narration-alignment-check.json').read_text())
assert rv['full_decode']=='passed';assert len(review['actual_export_frames'])==57
assert voice['editorial_review_complete'] and voice['remaining_material_instruction_flags']==0
assert review['inspection_status']=='Passed: all 57 actual exported frames inspected; muted configuration and speech-timed mute cuts confirmed'
r=subprocess.run([T['ffmpeg'],'-hide_banner','-i',str(video),'-af','loudnorm=I=-16:TP=-2:LRA=8:print_format=json','-f','null','-'],capture_output=True,text=True,check=True)
levels=json.loads(r.stderr[r.stderr.rfind('{'):r.stderr.rfind('}')+1]);assert float(levels['input_tp'])<-1;assert -19<float(levels['input_i'])<-14
(P/'FINAL-MIX-LEVELS.json').write_text(json.dumps(levels,indent=2),encoding='utf-8')
probe=rv['probe'];vs=[s for s in probe['streams'] if s['codec_type']=='video'];aus=[s for s in probe['streams'] if s['codec_type']=='audio']
assert len(vs)==len(aus)==1 and vs[0]['width']==1920 and vs[0]['height']==1080 and vs[0]['codec_name']=='h264' and aus[0]['codec_name']=='aac'
assert (P/'thumbnail.png').exists() and (P/'captions.srt').exists()
qa={'episode':'W2-MAIN','local_export_complete':True,'publication_status':'Not uploaded','video':str(video),
 'video_sha256':hashlib.sha256(video.read_bytes()).hexdigest(),'duration_seconds':float(probe['format']['duration']),
 'format':'1920x1080 H.264 / AAC / 30 fps','full_decode_passed':True,'actual_export_frames_inspected':57,
 'burned_caption_cues':voice['caption_cues'],'native_caption_upload_done':False,
 'music':'Original quiet motif','original_sound_accents':2,'original_memes':4,'own_channel_cutaways':2,
 'measured_mix':levels,'technical_pickups_verified':True,'minor_recognition_differences_reviewed':True,
 'all_source_words_exactly_recognized':False,'human_voice_likeness_review_claimed':False,
 'actual_obs_settings_capture':True,'live_guest_recording_test_verified':False,'owner_avatar_used':False,
 'whole_channel_operator_goal_complete':False}
(P/'FINAL-QA.json').write_text(json.dumps(qa,indent=2),encoding='utf-8')
rv.update(exported_frame_and_audio_review='Passed: frame inspection and audio measurements; no human listening claim',publication_ready=True);(P/'render-verification.json').write_text(json.dumps(rv,indent=2),encoding='utf-8')
m=json.loads((P/'EDIT-MANIFEST.json').read_text());m['publication_ready']=True;(P/'EDIT-MANIFEST.json').write_text(json.dumps(m,indent=2),encoding='utf-8')
s=json.loads((P/'PRODUCTION-STATE.json').read_text());s.update(final_mp4=True,status='Final 1080p MP4 verified locally; native publishing remains',voice_master_matches_current_script=True);(P/'PRODUCTION-STATE.json').write_text(json.dumps(s,indent=2),encoding='utf-8')
pr=R/'03-Production/LONG-FORM-PROGRESS.json';progress=json.loads(pr.read_text());progress['long_form_final_mp4s']=2;progress['current_work'].update(local_render_ready=True,status='Second long-form MP4 verified locally; Public upload pending');pr.write_text(json.dumps(progress,indent=2),encoding='utf-8')
print(json.dumps({'local_export_complete':True,'duration':qa['duration_seconds'],'audio_loudness':levels['input_i'],'true_peak':levels['input_tp'],'publication':'Pending'}))
