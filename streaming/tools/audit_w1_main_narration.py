import difflib
import hashlib
import json
from pathlib import Path
import re
import subprocess
import zipfile

root=Path('C:/Nori/streaming/channel-operator')
folder=root/'02-Calendar/Week-1/W1-MAIN'
perf=folder/'voice-performance-inputs'
bins=Path('C:/Nori/streaming/tools/ffmpeg/ffmpeg-9.0.2-essentials_build/bin')
record=json.loads((perf/'GENERATION-RECORD.json').read_text(encoding='utf-8'))
total=0.0
for block in record['blocks']:
    stem=f"speech-{block['index']:02d}-fred"
    audio=perf/(stem+'.mp3')
    transcript=json.loads((perf/(stem+'.transcript.json')).read_text(encoding='utf-8'))
    spoken=(folder/block['spoken_file']).read_text(encoding='utf-8').strip()
    recognized=' '.join(s['text'].strip() for s in transcript['segments'])
    tok=lambda s: re.findall(r'[a-z0-9]+',s.lower())
    left,right=tok(spoken),tok(recognized)
    differences=[]
    for op,a,b,c,d in difflib.SequenceMatcher(None,left,right,autojunk=False).get_opcodes():
        if op!='equal': differences.append({'source':' '.join(left[max(0,a-3):min(len(left),b+3)]),'recognized':' '.join(right[max(0,c-3):min(len(right),d+3)]),'operation':op})
    probe=json.loads(subprocess.check_output([str(bins/'ffprobe.exe'),'-v','error','-show_entries','format=duration:stream=codec_type,codec_name','-of','json',str(audio)]))
    assert any(s['codec_type']=='audio' for s in probe['streams'])
    subprocess.run([str(bins/'ffmpeg.exe'),'-v','error','-i',str(audio),'-f','null','-'],check=True,capture_output=True)
    duration=float(probe['format']['duration']);total+=duration
    block.update(audio_asset=str(audio.relative_to(folder)).replace('\\','/'),duration_seconds=duration,audio_sha256=hashlib.sha256(audio.read_bytes()).hexdigest(),full_audio_decode='passed',normalized_source_word_match=not differences,recognizer_review_flags=differences,status='Generated with S2.1 Pro Free; speech differences need editorial review.' if differences else 'Generated and normalized spoken sequence matched; final listening and mix remain pending.')
record.update(total_generated_duration_seconds=round(total,3),human_listening_or_voice_likeness_verified=False,finished_video=False,note='Automated recognition flags are review signals, not definitive proof of TTS substitutions. Do not publish before resolving them.')
(perf/'GENERATION-RECORD.json').write_text(json.dumps(record,indent=2)+'\n',encoding='utf-8')
plan=json.loads((folder/'SHOT-PLAN.json').read_text(encoding='utf-8'))
plan.update(hook_text="Your OBS preview is eating itself. Let's fix that.",status='All four long-form narration blocks generated and decoded; word-review flags unresolved. Actual OBS Starting Soon to Break footage captured and decoded. Full edited MP4 not assembled or published.')
plan['required_remaining_inputs']=['Resolve the automated spoken-word review flags','Revise scene art to match the new conversational script and assemble the final 16:9 visual edit','Align captions and chapters to the verified final narration','Configured owner avatar for the originally requested HeyGen presenter format','Full final MP4 review and immediate Public publication']
(folder/'SHOT-PLAN.json').write_text(json.dumps(plan,indent=2,ensure_ascii=False)+'\n',encoding='utf-8')
qa_path=folder/'live-captures/obs-recording-verification.json'
qa=json.loads(qa_path.read_text(encoding='utf-8'))
qa.update(visual_review_status='Five actual extracted frames inspected; Starting Soon and Break framing visible, no missing frame or private screen in these sampled frames.',audio_review_limit='The graphics-only sample measured silence at the detector floor; it does not test active microphone/Discord audio.')
qa_path.write_text(json.dumps(qa,indent=2)+'\n',encoding='utf-8')
package=folder/'production-package.txt'
package.write_text('''ID: W1-MAIN
FORMAT: Long-form, 1920x1080, 30fps; actual final duration pending edit.
TITLE: OBS Dual-Monitor Setup Without the Mirror Effect
HOOK: Your OBS preview is eating itself. Let's fix that.
THUMBNAIL TEXT: STOP THE MIRROR
VOICE: User-authorized fred clone, Fish S2.1 Pro Free. Four narration sections generated. No paid speech calls.
EDIT: Conversational explanation and original jokes; 16:9 monitor diagrams, actual OBS UI details, actual Starting Soon to Break recording. Keep the original source captures honest and distinguish instructions from performed tests. Use short timed captions, useful zooms, and original restrained sound effects.
VISIBILITY: Public immediately after final QA, per user's later instruction. Planning dates are not a scheduling instruction.
CTA: Watch the microphone/Discord video next; comment with capture, framing or sound problem; subscribe for practical builds and Nori progress.
END SCREEN: Final 20 seconds reserved for subscribe and the released microphone/Discord video. Final timestamps and native elements require the finished MP4.
THUMBNAIL: Actual useful capture detail or original illustrated monitor comparison. No fake result screen.
DISCLOSURE: AI-generated narration using the owner's voice clone. Apply any additional realistic avatar disclosure if that presenter format is used.
AVATAR: Owner HeyGen avatar remains unconfigured; do not claim this input or the originally requested presenter format is complete.
CAPTURE CHECK: Actual OBS Starting Soon to Break local recording decoded and five extracted frames reviewed. This sample did not test both monitor switches or audible microphone/Discord audio.
VOICE CHECK: Complete generated audio blocks decoded. Automated speech-recognition review flags remain unresolved; no human listening/voice-likeness verification claimed.
TIMESTAMPS: Generate from the verified final edit. Do not upload placeholder chapter times.
STATUS: LONG-FORM PRODUCTION IN PROGRESS. No final edited MP4; not uploaded or published.
''',encoding='utf-8')
status={'date':'2026-09-30','shorts_public':8,'shorts_scheduled':0,'long_form_final_mp4s':0,'long_form_planned':4,'first_long_form':{'id':'W1-MAIN','title':'OBS Dual-Monitor Setup Without the Mirror Effect','script_words':len((folder/'narration.txt').read_text(encoding='utf-8').split()),'narration_blocks_generated':4,'narration_seconds':round(total,3),'live_capture_seconds':qa['duration'],'finished_video':False},'original_avatar_format_complete':False,'goal_complete':False}
(root/'03-Production/LONG-FORM-PROGRESS.json').write_text(json.dumps(status,indent=2)+'\n',encoding='utf-8')
print(json.dumps({'duration_seconds':round(total,3),'blocks_generated':4,'blocks_with_review_flags':sum(bool(b['recognizer_review_flags']) for b in record['blocks']),'final_video':False,'public_shorts':8}))
