import json,hashlib,subprocess,csv
from pathlib import Path
R=Path('C:/Nori/streaming/channel-operator');P=R/'02-Calendar/Week-4/W4-MAIN';video=P/'Nori-Where-Is-The-Actual-Work-Jordan.mp4'
T=json.loads(Path('C:/Nori/streaming/tools/media-tools.json').read_text(encoding='utf-8-sig'))
verification=json.loads((P/'render-verification.json').read_text());assert verification['full_decode_passed']
review=json.loads((P/'clear-review/REVIEW.json').read_text());assert len(review['actual_export_frames'])==30
levels=subprocess.run([T['ffmpeg'],'-hide_banner','-i',str(video),'-af','loudnorm=I=-16:TP=-2:LRA=8:print_format=json','-f','null','-'],capture_output=True,text=True,check=True).stderr
levels=json.loads(levels[levels.rfind('{'):levels.rfind('}')+1]);assert float(levels['input_tp'])<=-1
streams=verification['probe']['streams'];v=next(s for s in streams if s['codec_type']=='video');a=next(s for s in streams if s['codec_type']=='audio')
assert (v['width'],v['height'],v['codec_name'])==(1920,1080,'h264');assert a['codec_name']=='aac'
duration=float(verification['probe']['format']['duration']);assert abs(duration-221.779604)<.2
qa=dict(status='Complete technical export and actual-frame visual review; not uploaded',video=str(video),video_sha256=hashlib.sha256(video.read_bytes()).hexdigest(),duration_seconds=duration,resolution=[1920,1080],full_decode_passed=True,actual_final_frames_reviewed=30,visual_review='Inspected all three contact sheets: text stays in frame, captions remain in the lower band, mascot blinks, source labels distinguish illustrations, last 20 seconds reserve end-screen spaces',final_audio_measurement=levels,caption_cues=108,source_check='demonstration-evidence/SOURCE-CHECK.json',successful_nori_task_claimed=False,owner_avatar_used=False,nori_character_voice_changed=False,owner_voice_feedback_received=False,human_naturalness_verified=False,publication_ready=False,publication_status='Not uploaded')
(P/'FINAL-QA.json').write_text(json.dumps(qa,indent=2),encoding='utf-8')
review.update(visual_inspection_status='30 actual final-export frames inspected across 3 contact sheets',human_audio_listening_verified=False)
(P/'clear-review/REVIEW.json').write_text(json.dumps(review,indent=2),encoding='utf-8')
verification.update(exported_frame_review='30 actual final frames inspected',publication_ready=False)
(P/'render-verification.json').write_text(json.dumps(verification,indent=2),encoding='utf-8')
plan=json.loads((P/'SHOT-PLAN.json').read_text());plan.update(status=qa['status'],final_video=str(video),actual_video_duration_seconds=duration,publication_ready=False)
(P/'SHOT-PLAN.json').write_text(json.dumps(plan,indent=2),encoding='utf-8')
auditfile=R/'COMPLETION-AUDIT.json';audit=json.loads(auditfile.read_text(encoding='utf-8-sig'))
audit['phase3'].update(calendar_mp4_count=12,illustrated_final_edits_count=12,remaining_calendar_ids=[],remaining_calendar_videos=0,status='incomplete',local_engine='Fish fred in older uploads; Ethan W3 rejected; Jordan W4 technically verified. Natural male narrator quality remains under review.',owner_accepted_revised_video_count=0)
audit['phase4'].update(main_video_final_timestamps='W1/W2: twelve measured chapters each. W3/W4: five measured chapters each; both remain unpublished.',remaining_public_calendar_ids=['W3-MAIN','W4-MAIN'])
audit['owner_quality_revision'].update(current_candidate='Jordan / Fish Official / S2.1 Pro Free',male_narrator_separate_from_nori_voice=True,hannah_feedback='Natural enough, but I want a male voice',jordan_owner_feedback_received=False)
audit['blocking_condition']['safe_production_next_action']='Continue natural male narrator comparison, revise rejected W3 and older uploads, then publish final pending episodes; original avatar and live demonstration requirements remain incomplete.'
audit['last_goal_turn']='W4 full Jordan MP4 exported, decoded, measured and 30 actual final frames reviewed. All 12 calendar MP4s exist locally; only 10 are Public. W3 rejected voice and W4 narrator comparison remain pending.'
auditfile.write_text(json.dumps(audit,indent=2),encoding='utf-8')
progressfile=R/'03-Production/LONG-FORM-PROGRESS.json';progress=json.loads(progressfile.read_text(encoding='utf-8-sig'));progress.update(long_form_final_mp4s=4,remaining_render_main_ids=[],current_work=dict(id='W4-MAIN',status=qa['status'],voice='Jordan',duration_seconds=duration,local_render_ready=True,publication_status='Not uploaded',publication_ready=False));progressfile.write_text(json.dumps(progress,indent=2),encoding='utf-8')
queuefile=R/'03-Production/Fish-Ready-Scripts/GENERATION-QUEUE.json';queue=json.loads(queuefile.read_text(encoding='utf-8-sig'))
for item in queue:
    if item['video_id']=='W4-MAIN':item.update(status=qa['status'],model_id='79d0bd3e4e5444b18f7b6d89b5927bf1',voice_name='Jordan',narration_master=str(P/'narration-jordan.wav'),duration_seconds=duration,publication_ready=False)
queuefile.write_text(json.dumps(queue,indent=2),encoding='utf-8')
calendar=R/'calendar.csv'
with calendar.open(encoding='utf-8-sig',newline='') as f:reader=csv.DictReader(f);fields=reader.fieldnames;rows=list(reader)
for row in rows:
    if row['ID']=='W4-MAIN':row['MediaStatus']='Complete local MP4 technically verified; Jordan narrator comparison pending; not uploaded'
with calendar.open('w',encoding='utf-8-sig',newline='') as f:writer=csv.DictWriter(f,fieldnames=fields,quoting=csv.QUOTE_ALL);writer.writeheader();writer.writerows(rows)
for name in ['START-HERE.txt','PRODUCTION-PROGRESS.txt','03-Production/PRODUCTION-PROGRESS.txt']:
    p=R/name;text=p.read_text(encoding='utf-8-sig');p.write_text(text+'\nCURRENT VERIFIED STATUS: 12 local technical MP4s, 10 Public videos, 0 scheduled. W4 Jordan is a full 3m42s local export with 108 captions and 30 reviewed frames; unpublished. W3 Ethan remains rejected and unpublished. Technical export counts do not establish natural voice acceptance or completion of original avatar/live demonstration requirements.\n',encoding='utf-8')
print(json.dumps(dict(local_mp4s=12,public_videos=10,duration_seconds=duration,actual_frames_reviewed=30,final_lufs=levels['input_i'],final_true_peak=levels['input_tp'],goal_complete=False)))
