"""Replace the unpublished test Short with a performed comedy script."""
from pathlib import Path
import hashlib,json,shutil
root=Path('C:/Nori/streaming/channel-operator')
folder=root/'02-Calendar/Week-4/W4-S2'
plan=json.loads((folder/'SHOT-PLAN.json').read_text(encoding='utf-8'))
package=json.loads((folder/'publishing-package.json').read_text(encoding='utf-8'))
assert not (folder/package['video_asset']).exists()
backup=Path('C:/Nori/streaming/tools/verification/pre-performance-revision/W4-S2')
backup.mkdir(parents=True,exist_ok=True)
for name in ['narration.txt','SHOT-PLAN.json','publishing-package.json']:
 if not (backup/name).exists():shutil.copy2(folder/name,backup/name)
groups=[
 ('TRUST ME BRO','When your AI says, trust me bro...'),
 ('RED FLAG WITH WI-FI','that is a red flag with Wi-Fi.'),
 ('ONE TINY JOB','Give it one tiny job with a clear pass check.'),
 ('SHOW ME THE RESULT','Check the actual result.'),
 ('BAD REQUEST','Then try one bad request.'),
 ('PERFECT?','If it still says, perfect...'),
 ('CONFIDENCE: MAXIMUM','congratulations. Your computer is lying with confidence.')]
script=' '.join(g[1] for g in groups)
for shot,(title,voice) in zip(plan['shots'],groups):
 shot.update(title=title,voice_text=voice,asset_role='Original animated comedy metaphor; hypothetical example, not a live Nori test')
plan.update(script_sha256=hashlib.sha256(script.encode()).hexdigest(),status='Revised for conversational comic performance and action editing',timing_status='Awaiting new expressive speech alignment',performance_direction='Conversational setup, sarcastic reaction, confident practical check, suspicious failure test, surprised pause, deadpan punchline',technical_sources=['C:/Nori/nori/shared/model-service/README.md','C:/Nori/nori/shared/orchestration/README.md'],source_review='Hypothetical comic. One harmless test with an expected result and one invalid request; no completed owner-system test or performance result claimed.')
(folder/'narration.txt').write_text(script+'\n',encoding='utf-8')
(folder/'SHOT-PLAN.json').write_text(json.dumps(plan,indent=2,ensure_ascii=False),encoding='utf-8')
package.update(title="Your AI Said Trust Me Bro. That's the Red Flag",description="When your AI says 'trust me bro,' ask for the result. Try one harmless task with a clear pass check, inspect what actually happened, then try one invalid request. Confidence alone is not evidence.\n\nAn original animated Nori comedy with a hypothetical test. Narration is AI-generated from my own voice.\n\nSubscribe for the next Building Nori episode.\n\n#BuildingNori #AIComedy #LocalAI",thumbnail_overlay='TRUST ME BRO',actual_upload_status='Not uploaded; revision requested before further publication',publishing_hold='Quality revision in progress: conversational voice, comic action, new render and review',edit_direction='Seven visually distinct comic setups, animated props, expression changes, spoken-word highlights, music dropout before punchline')
(folder/'publishing-package.json').write_text(json.dumps(package,indent=2,ensure_ascii=False),encoding='utf-8')
print(json.dumps({'revised':str(folder),'spoken_words':len(script.split()),'existing_published_videos':'unchanged'}))
