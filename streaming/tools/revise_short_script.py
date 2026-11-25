import argparse,hashlib,json
from pathlib import Path
from build_calendar_visuals import scene_art
p=argparse.ArgumentParser();p.add_argument('folder',type=Path);p.add_argument('index',type=int);p.add_argument('text');args=p.parse_args()
assert not list(args.folder.glob('*.mp4')), 'Do not change completed video inputs'
file=args.folder/'SHOT-PLAN.json';plan=json.loads(file.read_text(encoding='utf-8'));shot=plan['shots'][args.index-1];shot['voice_text']=args.text
script=' '.join(s['voice_text'] for s in plan['shots']);(args.folder/'narration.txt').write_text(script+'\n',encoding='utf-8')
plan['script_sha256']=hashlib.sha256(script.encode()).hexdigest();file.write_text(json.dumps(plan,indent=2),encoding='utf-8')
scene_art(plan['video_id'],shot['title'],'' if args.index==1 else args.text,args.index)
print(json.dumps({'id':plan['video_id'],'words':len(script.split()),'characters':len(script)}))
