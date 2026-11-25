import json
from pathlib import Path
import shutil
import datetime

active=Path('C:/Users/Studio/AppData/Roaming/obs-studio/basic/scenes/Nori_Animated_Monitors.json')
backup_dir=Path('C:/Nori/streaming/obs/backups')
backup_dir.mkdir(parents=True,exist_ok=True)
backup=backup_dir/('Nori-Animated-Monitors-before-auto-fit-'+datetime.datetime.now().strftime('%Y%m%d-%H%M%S')+'.json')
shutil.copy2(active,backup)
collection=json.loads(active.read_text(encoding='utf-8-sig'))
assert collection['name']=='Nori Animated Monitors'
changes=[]
for source in collection['sources']:
    if source['id']!='scene' or source['name'] not in ['Coding — Monitor 1','Coding — Monitor 2','Nori Demo — Monitor 1','Nori Demo — Monitor 2']:
        continue
    capture=[item for item in source['settings']['items'] if item['name'].startswith('Capture — Monitor ')]
    assert len(capture)==1
    item=capture[0]
    old={key:item.get(key) for key in ['pos','scale','bounds_type','bounds_align','bounds','crop_to_bounds','locked']}
    item.update(pos={'x':48.0,'y':136.0},scale={'x':1.0,'y':1.0},bounds_type=2,bounds_align=0,bounds={'x':1824.0,'y':840.0},bounds_crop=False,crop_to_bounds=False,locked=True,align=5,crop_left=0,crop_top=0,crop_right=0,crop_bottom=0)
    # OBS 32 prefers saved relative transforms over legacy absolute values.
    # Omit the stale relative values so its loader converts the new absolute frame.
    for legacy_relative in ('pos_rel','scale_rel','bounds_rel'):
        item.pop(legacy_relative,None)
    changes.append({'scene':source['name'],'capture':item['name'],'before':old,'after':{key:item[key] for key in old}})
assert len(changes)==4
data=json.dumps(collection,indent=2,ensure_ascii=False)+'\n'
active.write_text(data,encoding='utf-8')
Path('C:/Nori/streaming/obs/Nori-Animated-Monitors.json').write_text(data,encoding='utf-8')
report={'date':datetime.datetime.now().isoformat(),'active_collection':str(active),'backup':str(backup),'reason':'Native OBS showed Monitor 1 at 3840x2160 and its item at 2240x1260, extending beyond the 1824x840 content frame. Fit inside the actual overlay content rectangle and preserve aspect ratio regardless of capture resolution.','bounds_type':{'value':2,'name':'OBS_BOUNDS_SCALE_INNER','source':'https://github.com/obsproject/obs-studio/blob/32.2.2/libobs/obs.h'},'changes':changes,'verification_status':'Saved while OBS closed; awaiting native re-open and inspection.','audio_and_stream_settings_changed':False}
Path('C:/Nori/streaming/obs/monitor-frame-fit-verification.json').write_text(json.dumps(report,indent=2,ensure_ascii=False)+'\n',encoding='utf-8')
print(json.dumps({'changed_scenes':len(changes),'backup':str(backup),'bounds':'1824x840 at 48,136; aspect preserved','status':report['verification_status']}))
