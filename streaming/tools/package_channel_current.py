import json,zipfile
from pathlib import Path
R=Path('C:/Nori/streaming/channel-operator')
archive=Path('C:/Nori/streaming/channel-operator-2026-09-30.zip')
with zipfile.ZipFile(archive,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=5) as z:
 for p in R.rglob('*'):
  if p.is_file() and not any(part.startswith('render-work') for part in p.relative_to(R).parts):z.write(p,p.relative_to(R))
with zipfile.ZipFile(archive) as z:
 assert z.testzip() is None
 audit=json.loads(z.read('COMPLETION-AUDIT.json').decode('utf-8-sig'))
 print(json.dumps({'integrity':'passed','files':len(z.infolist()),'public_videos':audit['phase4']['public_calendar_videos'],'remaining_main_videos':audit['phase3']['remaining_calendar_videos'],'render_caches_excluded':True,'whole_goal_complete':False}))
