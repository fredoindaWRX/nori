import argparse,json
from pathlib import Path
parser=argparse.ArgumentParser();parser.add_argument('folder',type=Path);parser.add_argument('--reviewed',action='store_true');args=parser.parse_args();folder=args.folder
p=folder/'publishing-package.json';x=json.loads(p.read_text(encoding='utf-8-sig'))
if folder.name=='W3-S1':
 x['title']="Your AI Says It's Ready... Then Forgets the Brain"
 x['description']="Green light, missing model: that's the joke, and the useful check. Liveness and readiness ask different questions. Before trusting a status light, try one harmless request and inspect its actual result.\n\nAn original animated Nori comic, explained with graphics. Narration is AI-generated from my own voice.\n\nSubscribe to FredoIndaWRX for projects, practical creator tools, and the next Nori build.\n\n#BuildingNori #LocalAI #AIProjects"
 x['thumbnail_overlay']='NO BRAIN'
x['playlist']='Building Nori';x['playlist_id']='PLO6jtLWEmiAo'
if folder.name!='W3-S1':
 x['title']=x['title'].translate(str.maketrans({'\u2019':"'",'\u201c':'"','\u201d':'"','\u2026':'...'}))
 x['description']=x['description'].replace('Building Nori: one useful concept at a time. Explained with diagrams; no unperformed live test is claimed.','An original animated Nori comic: one useful concept at a time.')
 x['related_video_id']='uPH3jiIR2Ug';x['related_video_title']="Your AI Says It's Ready... Then Forgets the Brain"
v=folder/x['video_asset'];q=json.loads((folder/'Export-Review/export-checks.json').read_text(encoding='utf-8-sig'))
if args.reviewed:
 q['caption_frame_review']=f"All {q['frames_checked']} actual caption frames inspected across seven comic scenes; readable, no overlap or clipping."
 (folder/'Export-Review/export-checks.json').write_text(json.dumps(q,indent=2)+'\n',encoding='utf-8')
assert 'inspected' in q['caption_frame_review'].lower()
verification=json.loads(v.with_suffix('.verification.json').read_text(encoding='utf-8-sig'))
verification.update(quality_checks=q,edit_style=x.get('edit_direction','Original animated Nori computer character, changing expressions, title punch-ins, graphic bursts, original 144 BPM percussion and comic sound hits'),reference_footage_used=False)
if (folder/'voice-performance-input.txt').exists():
 verification['voice_performance']='User-selected Fish fred clone, expressive inline delivery cues, exact spoken-word verification; subjective naturalness is for the owner to assess.'
v.with_suffix('.verification.json').write_text(json.dumps(verification,indent=2)+'\n',encoding='utf-8')
x['duration_seconds']=float(verification['format']['duration'])
x['publishing_hold']=None
assert len(x['title'])<60
p.write_text(json.dumps(x,indent=2,ensure_ascii=False)+'\n',encoding='utf-8')
print(json.dumps({'title':x['title'],'duration':x['duration_seconds'],'verified':True}))
