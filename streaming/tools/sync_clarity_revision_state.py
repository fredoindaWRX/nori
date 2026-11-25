import csv,json,shutil
from pathlib import Path
r=Path('C:/Nori/streaming/channel-operator')
e=r/'02-Calendar/Week-4/W4-MAIN'
plan=json.loads((e/'SHOT-PLAN.json').read_text(encoding='utf-8-sig'))
chunks=r/'03-Production/Fish-Ready-Scripts/W4-MAIN'
backup=Path('C:/Nori/streaming/tools/verification/pre-clarity-revision/W4MAIN/original-canonical-fish-chunks')
backup.mkdir(parents=True,exist_ok=True)
for p in chunks.glob('speech-*.txt'):
    if not (backup/p.name).exists(): shutil.move(str(p),str(backup/p.name))
    else: raise RuntimeError('Already synchronized; preserve existing files')
for shot in plan['shots']:
    (chunks/f"speech-{shot['index']:02d}.txt").write_text(shot['voice_text']+'\n',encoding='utf-8')
queuefile=r/'03-Production/Fish-Ready-Scripts/GENERATION-QUEUE.json'
queue=json.loads(queuefile.read_text(encoding='utf-8-sig'))
for item in queue:
    if item['video_id']=='W4-MAIN':
        item.update(model_id=None,voice_name='Male narrator — candidate pending',chunks=5,characters_per_chunk=[len(x['voice_text']) for x in plan['shots']],script_sha256=plan['script_sha256'],status='Revised conversational script and scoped source evidence saved; acceptable narration and MP4 incomplete',engine='s2.1-pro-free')
    if item['video_id']=='W3-MAIN':
        item.update(status='Technically valid Ethan export retained; owner rejected voice as robotic; unpublished and narration revision required',owner_accepted=False,publication_ready=False)
queuefile.write_text(json.dumps(queue,indent=2),encoding='utf-8')
calendar=r/'calendar.csv'
with calendar.open(encoding='utf-8-sig',newline='') as f:
    reader=csv.DictReader(f); fields=reader.fieldnames; rows=list(reader)
for row in rows:
    if row['ID']=='W4-MAIN':
        row.update(WorkingTitle=(e/'title.txt').read_text().strip(),Visibility='Public immediately after production QA; not scheduled',MediaStatus='Conversational script revised; narration, scene art and final MP4 incomplete')
    if row['ID']=='W3-MAIN': row['MediaStatus']='Technical export retained; owner rejected Ethan voice; unpublished; voice revision required'
with calendar.open('w',encoding='utf-8-sig',newline='') as f:
    writer=csv.DictWriter(f,fieldnames=fields,quoting=csv.QUOTE_ALL);writer.writeheader();writer.writerows(rows)
print('Updated canonical speech inputs, generation queue and calendar without marking either unfinished episode complete.')
