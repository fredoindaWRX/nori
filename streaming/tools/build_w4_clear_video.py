import json,re,math,subprocess,hashlib
from pathlib import Path
P=Path('C:/Nori/streaming/channel-operator/02-Calendar/Week-4/W4-MAIN');O=P/'clear-visuals';V=P/'render-work-clear';V.mkdir(exist_ok=True)
T=json.loads(Path('C:/Nori/streaming/tools/media-tools.json').read_text(encoding='utf-8-sig'));FF=T['ffmpeg'];FP=T['ffprobe']
tr=json.loads((P/'narration-jordan.transcript.json').read_text());duration=tr['duration'];words=[w for s in tr['segments'] for w in s['words']]
for i,w in enumerate(words[:-2]):
    if w['word'].strip().lower()=="it's" and words[i+1]['word'].strip().lower()=='real' and words[i+2]['word'].strip().lower()=='result':w['word']=' its'
def tok(t):return ['12' if x=='twelve' else x for x in re.findall(r"[a-z0-9']+",t.lower().replace('’',"'"))]
flat=[(t,w['start'],w['end']) for w in words for t in tok(w['word'])]
def when(phrase):
    target=tok(phrase)
    for i in range(len(flat)-len(target)+1):
        if [x[0] for x in flat[i:i+len(target)]]==target:return flat[i][1]
    raise ValueError('Unrecognized timing phrase: '+phrase)
art=json.loads((P/'SCENE-ART-MANIFEST.json').read_text());end_start=duration-20
manifest=[]
for s in art['scenes']:
    start=when(s['timing_phrase'])
    if start<end_start:manifest.append(dict(s,start=start))
manifest.append(dict(index=len(manifest)+1,start=end_start,title='WHAT SHOULD NORI PROVE NEXT?',kind='end',tag='WATCH NEXT',asset=art['end_screen']))
manifest.sort(key=lambda s:s['start'])
for i,s in enumerate(manifest):s['end']=manifest[i+1]['start'] if i+1<len(manifest) else duration
assert manifest[0]['start']<1
manifest[0]['start']=0
def run(args):
    p=subprocess.run(args,capture_output=True)
    if p.returncode:(V/'last-error.txt').write_bytes(p.stderr);raise RuntimeError(p.stderr.decode(errors='replace')[-2500:])
parts=[];last=0;total=math.ceil(duration*30)
for s in manifest:
    stop=round(s['end']*30) if s!=manifest[-1] else total;n=stop-last;assert n>0
    part=V/f"scene-{s['index']:02d}.mp4"
    if not part.exists():
        zoom="1+0.024*exp(-on/14)+0.006*on/"+str(n) if s['kind'] in ['pizza','chef','managers'] else '1+0.008*on/'+str(n)
        vf=f"zoompan=z='{zoom}':x='iw/2-iw/zoom/2':y='ih/2-ih/zoom/2':d=1:s=1920x1080:fps=30,format=yuv420p"
        run([FF,'-v','error','-loop','1','-framerate','30','-i',s['asset'],'-vf',vf,'-frames:v',str(n),'-an','-c:v','libx264','-preset','veryfast','-crf','20','-threads','4',str(part)])
    parts.append(part);last=stop;print(json.dumps(dict(scene=s['index'],frames=n)),flush=True)
lst=V/'concat.txt';lst.write_text(''.join("file '"+p.as_posix()+"'\n" for p in parts),encoding='utf-8');base=V/'base.mp4'
if not base.exists():run([FF,'-v','error','-f','concat','-safe','0','-i',str(lst),'-c','copy',str(base)])
def stamp(t):
    ms=round(t*1000);return f'{ms//3600000:02}:{ms//60000%60:02}:{ms//1000%60:02},{ms%1000:03}'
groups=[];cur=[]
for w in words:
    if cur and (len(cur)>=7 or w['end']-cur[0]['start']>3.3):groups.append(cur);cur=[]
    cur.append(w)
    if w['word'].strip().endswith(('.', '?','!')) and len(cur)>=3:groups.append(cur);cur=[]
if cur:groups.append(cur)
srt='';ass='[Script Info]\nScriptType: v4.00+\nPlayResX: 1920\nPlayResY: 1080\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,Segoe UI Semibold,46,&H00FFFFFF,&H00FFFFFF,&H00282117,&H00282117,-1,0,0,0,100,100,0,0,1,2,0,2,100,100,42,1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n'
def ast(t):return f'{int(t)//3600}:{int(t)//60%60:02}:{int(t)%60:02}.{int(t*100)%100:02}'
for i,g in enumerate(groups):
    a=max(0,g[0]['start']-.04);b=max(a+.55,g[-1]['end']+.08)
    if i+1<len(groups):b=min(b,groups[i+1][0]['start'])
    caption=' '.join(w['word'].strip() for w in g);srt+=f'{i+1}\n{stamp(a)} --> {stamp(b)}\n{caption}\n\n';ass+=f'Dialogue: 0,{ast(a)},{ast(b)},Default,,0,0,0,,{caption}\n'
(P/'captions.srt').write_text(srt,encoding='utf-8');(P/'captions.ass').write_text(ass,encoding='utf-8')
out=P/'Nori-Where-Is-The-Actual-Work-Jordan.mp4';assert not out.exists(),'Preserve existing full export'
escaped=(P/'captions.ass').as_posix().replace(':','\\:');robot=O/'robot'
graph=f"[0:v][2:v]overlay=55:360:enable='lt(t,{end_start})':shortest=1[v];[v]ass=filename='{escaped}',format=yuv420p[out]"
run([FF,'-v','error','-i',str(base),'-i',str(P/'narration-jordan.wav'),'-stream_loop','-1','-framerate','8','-i',str(robot/'frame-%03d.png'),'-filter_complex',graph,'-map','[out]','-map','1:a','-t',str(duration),'-c:v','libx264','-preset','veryfast','-crf','19','-threads','6','-c:a','aac','-b:a','192k','-ar','48000','-movflags','+faststart',str(out)])
run([FF,'-v','error','-xerror','-i',str(out),'-f','null','-'])
probe=json.loads(subprocess.check_output([FP,'-v','error','-show_format','-show_streams','-of','json',str(out)]))
(P/'EDIT-MANIFEST.json').write_text(json.dumps(dict(scenes=manifest,original_character_animation_frames=32,captions=len(groups),music='None; narration remains unobstructed',third_party_clips_used=False,actual_evidence='Scoped source-code check; task examples labeled illustrations',successful_ai_task_shown=False,owner_avatar_used=False,human_voice_naturalness_verified=False,nori_character_voice_changed=False),indent=2),encoding='utf-8')
(P/'render-verification.json').write_text(json.dumps(dict(probe=probe,full_decode_passed=True,video_sha256=hashlib.sha256(out.read_bytes()).hexdigest(),exported_frame_review='pending',publication_ready=False),indent=2),encoding='utf-8')
print(json.dumps(dict(video=str(out),full_decode_passed=True,caption_cues=len(groups),visual_review_pending=True)),flush=True)
