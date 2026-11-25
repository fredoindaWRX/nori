"""Reconcile verified local voice setup and channel audit into the operator package."""
import json
from pathlib import Path
import shutil
import zipfile
root=Path('C:/Nori/streaming/channel-operator')
voice=Path('C:/Nori/streaming/voice-clone')
runtime=json.loads((voice/'SETUP-STATUS.json').read_text())
transcript=json.loads((voice/'verification/runtime-check-generic-example.transcript.json').read_text())
import re
normalize=lambda s:re.findall(r"[a-z0-9]+",s.lower())
recognized=' '.join(s['text'].strip() for s in transcript['segments'])
if normalize(recognized)!=normalize(runtime['script']):
    raise RuntimeError('Local verification speech does not match its script')
runtime['verification_transcript']=recognized
runtime['verification_script_words_match']=True
(voice/'SETUP-STATUS.json').write_text(json.dumps(runtime,indent=2),encoding='utf-8')
(voice/'inputs').mkdir(exist_ok=True)
free={**runtime,'owner_voice_verified':False,'owner_reference_status':'original_recording_needed',
      'commercial_software_license':'Apache-2.0; original voice and content rights remain owner responsibility',
      'model_manifest':str(voice/'MODEL-MANIFEST.json'),'usage_cost':'No subscription or per-character API bill; local hardware and electricity',
      'not_a_video_deliverable':True}
(root/'03-Production/FREE-LOCAL-VOICE.json').write_text(json.dumps(free,indent=2),encoding='utf-8')
addition='''
FREE LOCAL VOICE — VERIFIED ENGINE, ORIGINAL REFERENCE STILL NEEDED
Qwen3-TTS-12Hz-1.7B-Base installed in C:/Nori/streaming/voice-clone. Official Apache-2.0 model revision fd4b254389122332181a7c3db7f27e918eec64e3 downloaded and hashed. Offline GPU inference passed on RTX 4080 SUPER. A 6.08-second internal check using Qwen's published example reference matched its script with local speech recognition. The check uses a generic example voice, NOT Fredo's voice, and is excluded from channel deliverables.
No original owner voice reference has been obtained. The Tempest guide has a solo host introduction and narration around 0:03–1:25, but the browser blocked YouTube's official original-video export. A transcript was saved; no media file was downloaded. Original uploaded filename: 0127 (1)(1).mp4. The original recording used for Fish would also work. No Fish-generated audio was used for the local model.

NEW CHANNEL ORGANIZATION
ARC Raiders Guides created as a public playlist with the Tempest guide as its first video (playlist PLRvmfUySVRWc). Description now accurately describes a recorded solo night run and avoids guaranteed-drop claims. Existing title retained. Studio showed All changes saved and disabled Save; playlist inventory showed Public and one video. No deletion, privacy change or new calendar upload performed.
'''
for f in [root/'PRODUCTION-PROGRESS.txt',root/'03-Production/PRODUCTION-PROGRESS.txt']:
    text=f.read_text(encoding='utf-8')
    if 'FREE LOCAL VOICE — VERIFIED ENGINE' not in text:
        f.write_text(text.rstrip()+'\n'+addition,encoding='utf-8')
requirements=root/'03-Production/INPUT-REQUIREMENTS.txt'
text=requirements.read_text(encoding='utf-8').replace('Local clone setup remains unverified and incomplete; no claim of a working alternative.',
    'Local engine setup and offline GPU speech generation are now verified. An original owner recording is still needed; the personal voice clone is not yet verified. See FREE-LOCAL-VOICE.json.')
requirements.write_text(text,encoding='utf-8')
start=root/'START-HERE.txt'
text=start.read_text(encoding='utf-8')+'\nFree local voice engine installation and actual offline GPU inference are verified; original owner recording remains needed before personal clone generation. See 03-Production/FREE-LOCAL-VOICE.json. The Tempest guide is now organized in a dedicated public ARC Raiders Guides playlist.\n'
start.write_text(text,encoding='utf-8')
audit=root/'06-Archive-Audit'
shutil.copyfile('C:/Users/Studio/AppData/Local/Temp/browser-use/exports/youtube-_6fNe90lhLY-8820488c-d6ab-450b-bc8a-6cb339b19471.txt',audit/'tempest-original-transcript.txt')
shutil.copyfile('C:/Users/Studio/AppData/Local/Temp/browser-use/exports/youtube-cepozKWqrd4-abd2e6ec-06b2-423f-a0d6-dd64bca3f619.txt',audit/'appreciate-it-original-transcript.txt')
changes=audit/'changes-2026-09-30.txt'
text=changes.read_text(encoding='utf-8')
before="Publishing prompted Verify it's you. Public profile change is NOT confirmed; identity verification is pending in Studio tab."
after='Publishing previously prompted identity verification. The new profile picture is now verified on the public channel; see channel-profile-published-verified.jpg.'
text=text.replace(before,after).replace("No newly planned MP4 rendered,decoded or uploaded. The user's ElevenLabs clone and HeyGen avatar remain unavailable.",
    'One actual calendar Short rendered and fully decoded: 02-Calendar/Week-1/W1-S1/OBS-Is-Showing-Itself-Fredo.mp4. It uses approved free Fish narration but is held from commercial publishing. No calendar video uploaded. HeyGen avatar remains unavailable.')
changes.write_text(text.rstrip()+'\n'+addition,encoding='utf-8')
(audit/'tempest-guide-audit.json').write_text(json.dumps({'video_id':'_6fNe90lhLY','title_retained':'Tempest Blueprint Spawn Location! 🔵 | ARC Raiders Guide',
    'review_scope':'Original auto-caption transcript, source metadata, selected gameplay frames; not complete auditory review',
    'original_filename':'0127 (1)(1).mp4','candidate_host_narration_seconds':[3,85],
    'download_status':'official export blocked by browser; no original media obtained',
    'changes':['Accurate description','Three relevant hashtags','Added to public ARC Raiders Guides playlist'],
    'playlist_id':'PLRvmfUySVRWc','verification':'All changes saved; Save disabled; public playlist inventory reports one video',
    'voice_reference_ready':False},indent=2),encoding='utf-8')
archive=Path('C:/Nori/streaming/channel-operator-2026-09-30.zip')
with zipfile.ZipFile(archive,'w',compression=zipfile.ZIP_DEFLATED) as z:
    for p in root.rglob('*'):
        if p.is_file():z.write(p,p.relative_to(root))
with zipfile.ZipFile(archive) as z:
    failure=z.testzip()
    if failure:raise RuntimeError(f'Archive integrity failure: {failure}')
print(json.dumps({'local_engine_verified':True,'owner_voice_verified':False,'channel_playlist_verified':True,'archive_integrity':'passed','zip':str(archive)}))
