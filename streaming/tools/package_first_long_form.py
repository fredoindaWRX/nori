import hashlib,json,zipfile
from pathlib import Path
R=Path('C:/Nori/streaming/channel-operator');F=R/'02-Calendar/Week-1/W1-MAIN';P=F/'voice-performance-inputs'
queue_path=R/'03-Production/Fish-Ready-Scripts/GENERATION-QUEUE.json';queue=json.loads(queue_path.read_text(encoding='utf-8-sig'))
for block in range(1,5):
 text=(P/f'speech-{block:02d}.txt').read_text(encoding='utf-8');(R/f'03-Production/Fish-Ready-Scripts/W1-MAIN/speech-{block:02d}.txt').write_text(text,encoding='utf-8')
for row in queue:
 if row['video_id']=='W1-MAIN':
  row.update(script_sha256=hashlib.sha256((F/'narration.txt').read_text(encoding='utf-8').strip().encode()).hexdigest(),characters_per_chunk=[len((P/f'speech-{i:02d}.txt').read_text(encoding='utf-8').strip()) for i in range(1,5)],status='Final animated long-form tutorial verified and publicly published. No narration regeneration pending.',youtube_url='https://www.youtube.com/watch?v=wQCuI-5i0iQ',engine='s2.1-pro-free')
queue_path.write_text(json.dumps(queue,indent=2)+'\n',encoding='utf-8')
(R/'03-Production/EDITING-STYLE.txt').write_text('''FREDO / NORI — ACTIVE EDITING DIRECTION

User wants relatable meme humor, quick cutaways from different videos, action and words appearing on screen. Both Shorts and longer videos. Projects and Nori first, gaming on the side. Publish verified finished videos immediately, not on a schedule.

Use an immediate concrete hook, a useful demonstration, and short original reaction beats tied to the spoken joke. Make key words large and readable. Keep the explanation easy to follow; comic inserts must land on the actual spoken phrase. Avoid announcer delivery and unnatural wording. Fish fred through S2.1 Pro Free only; no purchases.

First longer release uses four original memes (multiverse, premium tunnel, aspect-ratio vacation, kitchen podcast), three muted snippets from the channel's own published Shorts, and 48 visual beats. Each cutaway supports the surrounding point. Retain provenance and label actual captures versus illustrations. Do not imply a hypothetical diagram proves a live test.

Use the owner's existing clips when they fit. Third-party reference videos inform rhythm and humor; their footage, music, voices and dialogue have not been copied into the release. No measured growth result is claimed.

Verify the full exported MP4, caption timing, actual frames, audio levels, publishing fields, and saved Public status. Add native accessible captions and relevant end-screen or related-video links. Preserve older uploads unless a specific deletion is approved when required.
''',encoding='utf-8')
qa=json.loads((F/'FINAL-QA.json').read_text(encoding='utf-8'));qa['public_playback_verified']='Public player loaded and playback advanced to 2:10; native captions displayed. Paused at an aspect-ratio meme beat for the user.';qa['public_player_proof']='06-Archive-Audit/obs-main-public-meme-player.jpg';(F/'FINAL-QA.json').write_text(json.dumps(qa,indent=2)+'\n',encoding='utf-8')
record=json.loads((F/'publication-record.json').read_text(encoding='utf-8'));record['verification'].append(qa['public_playback_verified']);record['public_player_proof']=qa['public_player_proof'];(F/'publication-record.json').write_text(json.dumps(record,indent=2,ensure_ascii=False)+'\n',encoding='utf-8')
archive=Path('C:/Nori/streaming/channel-operator-2026-09-30.zip')
with zipfile.ZipFile(archive,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=5) as z:
 for p in R.rglob('*'):
  if p.is_file() and 'render-work' not in p.relative_to(R).parts:z.write(p,p.relative_to(R))
with zipfile.ZipFile(archive) as z:assert z.testzip() is None;count=len(z.infolist())
print(json.dumps({'package_integrity':'passed','files':count,'public_videos':9,'remaining_long_form':3,'render_caches_excluded':True,'goal_complete':False}))
