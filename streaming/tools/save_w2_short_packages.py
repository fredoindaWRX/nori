import json
from pathlib import Path
root=Path('C:/Nori/streaming/channel-operator/02-Calendar/Week-2')
items={
 'W2-S1':{'title':'Stop Mixing Discord and Your Mic in OBS','video_asset':'Separate-Mic-Discord-Fredo.mp4','date':'2026-10-06','overlay':'TWO SOURCES','intro':'Separate your microphone and Discord audio in OBS so you can control their levels independently. Test the microphone and Discord one at a time, check for duplicate desktop capture, and listen to a short recording.','tags':['OBS','Discord audio','microphone audio','streaming setup'],'hashtags':'#OBS #DiscordAudio #StreamingSetup'},
 'W2-S2':{'title':'OBS Audio Looks Fine? Check the Recording','video_asset':'Test-The-Recording-Fredo.mp4','date':'2026-10-10','overlay':'LISTEN BACK','intro':'Meters show that audio reaches OBS; the recording is what you actually deliver. Record yourself alone, a guest alone, and both together. Listen for missing speech, doubled audio and clipping, then inspect any separate recording tracks.\n\nStandard media players normally play one audio track at a time. Keep a combined mix track if you need both voices together in ordinary playback.','tags':['OBS','OBS recording audio','audio tracks','streaming setup'],'hashtags':'#OBS #AudioRecording #StreamingSetup'}
}
for id,item in items.items():
 folder=root/id;file=folder/item['video_asset']
 description=item['intro']+'\n\nExplained with diagrams. Narration is AI-generated from my own voice.\n\nFor another OBS setup fix, watch the related video: OBS Is Showing Itself? Fix This First.\n\nFollow FredoIndaWRX for practical creator tools, projects, and Building Nori.\n\n'+item['hashtags']
 package={'video_id':id,'title':item['title'],'description':description,'tags':item['tags'],'thumbnail_overlay':item['overlay'],'cover_asset':'cover-frame.png','video_asset':item['video_asset'],'caption_asset':'captions.srt','related_video_id':'WqziO-CB6f8','chapter_timestamps':'Omitted for this Short.','planned_publish':item['date']+' 18:00 America/New_York','visibility_intent':'scheduled','schedule_decision':'Next Tuesday and Saturday slots after Oct3 release, maintaining a steady Shorts cadence. Supersedes old later planning slot.','actual_upload_status':'Not uploaded or scheduled yet.','publishing_hold':None,'license_status':'User authorized Fish narration; service-license commercial classification unresolved. No paid spend.','presenter_format':'Animated explanatory diagrams; owner HeyGen avatar remains unconfigured.'}
 assert len(package['title'])<60
 if file.exists():
  quality=json.loads((folder/'Export-Review/export-checks.json').read_text());quality['caption_frame_review']='All twelve actual caption frames inspected across seven scenes; readable, no overlap or clipping.' if id=='W2-S1' else 'pending';(folder/'Export-Review/export-checks.json').write_text(json.dumps(quality,indent=2),encoding='utf-8')
  p=file.with_suffix('.verification.json');verification=json.loads(p.read_text());verification['quality_checks']=quality;p.write_text(json.dumps(verification,indent=2),encoding='utf-8')
  package['duration_seconds']=float(verification['format']['duration'])
 (folder/'publishing-package.json').write_text(json.dumps(package,indent=2,ensure_ascii=False),encoding='utf-8')
 print(json.dumps({'id':id,'title':package['title'],'planned_publish':package['planned_publish'],'render_exists':file.exists()}))
