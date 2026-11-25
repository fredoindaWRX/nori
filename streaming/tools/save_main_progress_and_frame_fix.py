import json
from pathlib import Path
import shutil
import zipfile

stream=Path('C:/Nori/streaming')
root=stream/'channel-operator'
active=Path('C:/Users/Studio/AppData/Roaming/obs-studio/basic/scenes/Nori_Animated_Monitors.json')
scene=json.loads(active.read_text(encoding='utf-8-sig'))
captures={s['name']:s['settings']['monitor_id'] for s in scene['sources'] if s['id']=='monitor_capture'}
assert len(captures)==2 and len(set(captures.values()))==2
assert 'SAM7177' in captures['Capture — Monitor 1'] and 'HWP3337' in captures['Capture — Monitor 2']
matched=[]
for source in scene['sources']:
    if source['id']=='scene' and source['name'] in ['Coding — Monitor 1','Coding — Monitor 2','Nori Demo — Monitor 1','Nori Demo — Monitor 2']:
        item=next(i for i in source['settings']['items'] if i['name'].startswith('Capture — Monitor '))
        assert item['bounds_type']==2
        assert abs(item['bounds']['x']-1824)<.1 and abs(item['bounds']['y']-840)<.1
        assert abs(item['pos']['x']-48)<.1 and abs(item['pos']['y']-136)<.1
        matched.append(source['name'])
assert len(matched)==4
shutil.copy2(active,stream/'obs/Nori-Animated-Monitors.json')
path=stream/'obs/monitor-frame-fit-verification.json'
report=json.loads(path.read_text(encoding='utf-8'))
report.update(verification_status='OBS reopened and actual Coding and Nori Demo monitor previews inspected; complete desktop fits inside the content frame. Saved active collection has all four aspect-preserving bounds and two distinct connected display targets.',connected_display_names={'Monitor 1':'LS28AG700N: 3840x2160 @ 0,0 (Primary Monitor)','Monitor 2':'HP Pavilion32: 2560x1440 @ -2560,0'},corrected_relative_transform_compatibility='Removed stale pos_rel, scale_rel and bounds_rel before reload so OBS 32.2.2 converts the corrected absolute values, per its native loader.',preview_privacy='Full monitor previews contained private app content and were inspected locally only; they were not exported into channel assets or published.',local_recording={'file':'channel-operator/02-Calendar/Week-1/W1-MAIN/live-captures/obs-starting-to-break-actual.mp4','duration_seconds':18.9,'decode':'passed','actual_frames_inspected':5,'audio_scope':'Graphics-only sample silent; no active microphone or guest audibility verification.'},audio_and_stream_settings_changed=False)
path.write_text(json.dumps(report,indent=2,ensure_ascii=False)+'\n',encoding='utf-8')
workspace=stream/'WORKSPACE.txt'
text=workspace.read_text(encoding='utf-8')
text=text.replace('Both monitors are 2560x1440, fitted proportionally into the 1080p scene frame.','Monitor 1 is LS28AG700N at 3840x2160; Monitor 2 is HP Pavilion32 at 2560x1440.\nAll four monitor scenes fit the actual capture into the 1824x840 content frame\nwith aspect ratio preserved. Connected display targets and previews inspected.\nThe original fixed-scale capture could overrun the frame on the 4K monitor;\nthis was corrected and verified in the reopened OBS collection.')
text=text.replace('Streaming and recording were not started. OBS is left on Starting Soon.','Streaming was not started. An actual 18.9-second local Starting Soon to Break\nrecording was decoded and five extracted frames reviewed. It contains graphics\nonly and does not verify active microphone/Discord audibility.\nOBS is left on Starting Soon after monitor checks.')
workspace.write_text(text,encoding='utf-8')
voice_dir=root/'03-Production/Fish-Ready-Scripts/W1-MAIN'
retired=stream/'tools/verification/pre-performance-revision/W1-MAIN/fish-ready-formal-script'
retired.mkdir(parents=True,exist_ok=True)
for old in sorted(voice_dir.glob('speech-*.txt')):
    target=retired/old.name
    if not target.exists(): shutil.copy2(old,target)
    if old.name not in [f'speech-{i:02d}.txt' for i in range(1,5)]:
        resolved=old.resolve();assert resolved.is_relative_to(voice_dir.resolve())
        destination=retired/('retired-'+old.name)
        if not destination.exists(): shutil.move(str(resolved),str(destination))
perf=root/'02-Calendar/Week-1/W1-MAIN/voice-performance-inputs'
for i in range(1,5):
    shutil.copy2(perf/f'speech-{i:02d}.txt',voice_dir/f'speech-{i:02d}.txt')
queue_path=root/'03-Production/Fish-Ready-Scripts/GENERATION-QUEUE.json'
queue=json.loads(queue_path.read_text(encoding='utf-8'))
for entry in queue:
    if entry['video_id']=='W1-MAIN':
        actual=json.loads((perf/'GENERATION-RECORD.json').read_text(encoding='utf-8'))
        entry.update(chunks=4,characters_per_chunk=[len((perf/f'speech-{i:02d}.txt').read_text(encoding='utf-8').strip()) for i in range(1,5)],script_sha256=actual['script_sha256'],status='All four revised narration blocks generated with S2.1 Pro Free; word-review flags pending. Finished long-form MP4 not yet produced.',actual_generation_record='02-Calendar/Week-1/W1-MAIN/voice-performance-inputs/GENERATION-RECORD.json')
queue_path.write_text(json.dumps(queue,indent=2)+'\n',encoding='utf-8')
readme=root/'03-Production/Fish-Ready-Scripts/README.txt'
readme.write_text('Eight Shorts are Public with verified final MP4s. W1-MAIN now uses four conversational narration blocks generated with the existing fred voice and S2.1 Pro Free; automated word-review flags are unresolved. Its earlier formal chunks were retired outside the deliverable. W2-MAIN, W3-MAIN and W4-MAIN still require conversational script revision and narration. Consult each actual generation record and final export gate rather than treating prepared text as finished audio or video. No paid speech, avatar or credit purchase is authorized. Publish finished videos Public immediately after verification; do not schedule.\n',encoding='utf-8')
out=stream/'channel-operator-2026-09-30.zip'
with zipfile.ZipFile(out,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=5) as archive:
    for file in sorted(root.rglob('*')):
        if file.is_file(): archive.write(file,str(file.relative_to(root.parent)))
with zipfile.ZipFile(out) as archive:
    assert archive.testzip() is None
    files=len(archive.namelist())
print(json.dumps({'monitor_scenes_verified':matched,'connected_displays':2,'first_long_form_narration_blocks_generated':4,'final_long_form_mp4s':0,'zip_verified':True,'zip_files':files,'goal_complete':False}))
