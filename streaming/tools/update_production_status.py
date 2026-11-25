"""Save the verified production state and package only the current deliverables."""
import json
from pathlib import Path
import re
import shutil
import subprocess
import zipfile

ops=Path('C:/Nori/streaming/channel-operator')
production=ops/'03-Production'
short=ops/'02-Calendar/Week-1/W1-S1'
archive=Path('C:/Nori/streaming/tools/verification/superseded-w1-edits')
archive.mkdir(parents=True,exist_ok=True)
for name in ['obs-mirror-fredo.mp4','obs-mirror-fredo.ass','obs-mirror-fredo.verification.json','obs-mirror-caption-corrected.mp4','obs-mirror-caption-corrected.ass','obs-mirror-caption-corrected.verification.json','narration-fred.mp3','narration-fred.transcript.json']:
    path=short/name
    if path.exists():
        destination=archive/name
        assert not destination.exists()
        shutil.move(str(path),str(destination))
review=json.loads((short/'Export-Review/export-checks.json').read_text(encoding='utf-8'))
review.update(caption_frame_review='Ten actual exported frames reviewed; readable captions, no overlap, all five scenes present.',human_listening_review='Not claimed; automated spoken word match passed.')
(short/'Export-Review/export-checks.json').write_text(json.dumps(review,indent=2),encoding='utf-8')
tools=json.loads(Path('C:/Nori/streaming/tools/media-tools.json').read_text(encoding='utf-8-sig'))
final=short/'OBS-Is-Showing-Itself-Fredo.mp4'
probe=json.loads(subprocess.check_output([tools['ffprobe'],'-v','error','-show_streams','-show_format','-of','json',str(final)]))
subprocess.run([tools['ffmpeg'],'-v','error','-xerror','-i',str(final),'-f','null','-'],check=True)
probe.update(quality_checks=review,publication_status='Local edited video; not cleared for commercial publication, not uploaded or scheduled.',presenter='Illustrated explanatory format with Nori branding; no HeyGen avatar.')
final.with_suffix('.verification.json').write_text(json.dumps(probe,indent=2),encoding='utf-8')
voice=json.loads((production/'FISH-AUDIO-VOICE.json').read_text(encoding='utf-8-sig'))
voice.update(current_status='Signed in. User approved creation of one Playground API key. Two takes in website editor and two in free developer playground generated. Final clarified narration downloaded and used in W1-S1.',plan='My Team Free; no purchases or paid model calls made. API dashboard shows $0.00 total cost.',selected_engine='s2.1-pro-free',audio_file=str(short/'narration-fred-final.mp3'),rights='Unresolved for commercial channel operation: current Terms reserve commercial use for Paid Services; free API announcement is less explicit. No commercial publishing performed.',rights_sources=['https://fish.audio/terms/','https://fish.audio/blog/s2-1-pro-free-api/'],credential_storage='Key remains in Fish account/playground. No secret stored in deliverable files or printed.')
(production/'FISH-AUDIO-VOICE.json').write_text(json.dumps(voice,indent=2),encoding='utf-8')
progress='''PRODUCTION PROGRESS — 2026-09-30

ACTUAL EDITED VIDEO
02-Calendar/Week-1/W1-S1/OBS-Is-Showing-Itself-Fredo.mp4
22.83 seconds, 1080x1920, 30fps, H264/AAC, fast-start MP4.
User's fred voice generated with Fish S2.1 Pro Free. Exact source word sequence matched by local speech recognition after punctuation normalization. Hook ends at 2.48 seconds. Thirteen real timed caption cues, five illustrated scenes with subtle movement, original synthesized music and four cut sounds. Caption overlap was corrected during review. Exported audio measured -16.83 LUFS and -1.39 dBTP. Full video decode passed. Ten actual frames inspected across all five scenes. Human listening/voice-likeness review has not been claimed.

PUBLISHING HOLD
No video uploaded or scheduled. Fish's current Terms reserve commercial use for paid services. Its free developer announcement describes some commercial restrictions but does not establish clear rights for this account's monetized channel production. No paid service, credits or subscription purchased. This local edit must not be represented as cleared for commercial publishing.
For a wholly free commercial route, the original user-recorded voice reference is needed to configure a local clone with suitable licensing. Generated Fish output must not be used to train a competing voice model.
The originally requested HeyGen presenter format also lacks a configured user avatar. This first edit uses diagrams and Nori branding, with no invented human likeness.

OTHER VERIFIED WORK
All 12 scripts and 108 scene PNGs prepared. All dimensions verified and 12 scene contact sheets inspected. These are illustrations, not live test or application footage.
Twelve thumbnails/Short covers prepared. Three reusable brand MP4s previously fully decoded and verified.
Channel's new metallic N profile picture verified on the public channel, matching the existing published banner.

PHASE STATUS
Strategy and organization complete as planning deliverables. Full video production incomplete: one actual calendar edit exists with publishing rights and presenter requirements unresolved; other eleven not rendered. Phase 4 copy exists but live uploads and scheduling remain incomplete. Calendar dates are planning slots.
'''
for path in [production/'PRODUCTION-PROGRESS.txt',ops/'PRODUCTION-PROGRESS.txt']:
    path.write_text(progress,encoding='utf-8')
(ops/'START-HERE.txt').write_text('''FREDOINDAWRX CHANNEL OPERATOR — 2026-09-30

Assumptions: six hours/week, English audience, projects and Nori first, gaming on the side. Keep channel name and handle. Four-week calendar dates are planning slots, not confirmed YouTube schedules. No paid spend authorized.

Phase 1: strategy complete as a planning deliverable, including 20 ideas and five priority choices.
Phase 2: calendar and folder organization complete as local planning deliverables.
Phase 3: INCOMPLETE. One actual edited video exists at 02-Calendar/Week-1/W1-S1/OBS-Is-Showing-Itself-Fredo.mp4. It has the user's fred narration, moving diagrams, timed captions, original music and sounds. Technical, speech-word and frame checks passed. Commercial usage rights and the requested HeyGen presenter remain unresolved. Other eleven calendar videos are not rendered. No phase marked complete from reusable brand animations.
Phase 4: copy and covers prepared. No calendar video uploaded, published or scheduled. Actual final-cut timestamps remain pending for main videos. Shorts omit chapter timestamps.

All 12 scripts, 108 checked scene PNGs, 12 cover/thumbnail assets and three verified reusable brand animations are included. Fish account is now signed in. The free developer speech model generated and exported successfully, using one user-approved Playground API key. No credential secret is included here. See PRODUCTION-PROGRESS.txt for the publishing limitation and required original voice reference for a free local alternative.
Channel profile picture and existing banner were verified on the public channel. No videos were deleted.
''',encoding='utf-8')
(production/'INPUT-REQUIREMENTS.txt').write_text('''VOICE AND PUBLISHING INPUTS — 2026-09-30

Fish Audio voice fred, b27ff51a95a14d02973baec32ba7a643, is connected and working. Signing in is complete. One Playground API key was created with explicit user approval; only s2.1-pro-free requests were used. First Short's audio is generated, exported and incorporated into the actual local MP4.

Current blocker: Fish's current Terms reserve commercial uses for paid services. No purchase is authorized, and no clear commercial grant for this Free account has been verified. No commercial YouTube publishing performed.
Free alternative requires the original voice recording used to create fred, or one clean original reference recording. It is a one-time voice reference, not narration recordings for each video. Local clone setup remains unverified and incomplete; no claim of a working alternative.
Do not use Fish-generated speech as training data for a competing model.

No ready user-owned HeyGen avatar was available at the last check. First video uses diagrams/Nori branding. No real presenter likeness is fabricated.
Real demonstration footage remains needed for the main videos' intended walkthrough format. Planned publish dates are not actual schedules.
''',encoding='utf-8')
counts=[]
for path in sorted((ops/'02-Calendar').glob('Week-*/*/narration.txt')):
    counts.append(f'{path.parent.name}: {len(path.read_text(encoding="utf-8-sig").split())} words')
(production/'NARRATION-STATUS.txt').write_text('All 12 scripts complete. Counts below are actual script counts, not delivered durations.\n'+'\n'.join(counts)+'\n\nW1-S1 final audio: 22.83 seconds. Spoken words matched the source after punctuation normalization. Captions use real word timestamps. Other eleven narration scripts are not generated. Full phase production remains incomplete.\n',encoding='utf-8')
for package in (ops/'02-Calendar').glob('Week-*/*/production-package.txt'):
    text=package.read_text(encoding='utf-8-sig')
    text=text.replace('Voice model verified on the public page; generation is pending browser sign-in.','Voice model verified, signed in and working through the free developer playground. First Short audio generated; other entries pending.')
    if package.parent.name=='W1-S1':
        text=text.replace('FORMAT: Short 30–45 seconds /1080x1920 /30fps','FORMAT: Short, actual final edit 22.83 seconds /1080x1920 /30fps')
        text=re.sub(r'^STATUS: .+$','STATUS: LOCAL EDIT RENDERED AND TECHNICALLY CHECKED; COMMERCIAL RIGHTS AND REQUESTED AVATAR UNRESOLVED; NOT UPLOADED; NOT SCHEDULED.',text,flags=re.M)
    package.write_text(text,encoding='utf-8')
checks_path=production/'Visual-Review/checks.json'
checks=json.loads(checks_path.read_text(encoding='utf-8'))
for row in checks: row['visual_review']='Contact sheet inspected; no clipped content or missing artwork observed. Illustrations need final-edit timing and relevant live evidence.'
checks_path.write_text(json.dumps(checks,indent=2),encoding='utf-8')
(ops/'06-Archive-Audit/profile-update-verification.txt').write_text('2026-09-30: Studio profile shows metallic N image with Publish disabled (saved state). Public channel opened through View channel and matching metallic N portrait confirmed in saved screenshot channel-profile-published-verified.jpg. No further upload or identity action performed this turn.\n',encoding='utf-8')
zip_path=Path('C:/Nori/streaming/channel-operator-2026-09-30.zip')
with zipfile.ZipFile(zip_path,'w',zipfile.ZIP_DEFLATED) as bundle:
    for path in sorted(ops.rglob('*')):
        if path.is_file(): bundle.write(path,path.relative_to(ops.parent))
with zipfile.ZipFile(zip_path) as bundle: assert bundle.testzip() is None
print('Production records updated. Current edited MP4 fully decoded. Deliverable ZIP verified; superseded edits kept separately.')
