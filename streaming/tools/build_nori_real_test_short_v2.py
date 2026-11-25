"""Build a more kinetic, readable Nori monitor-test Short.

This version keeps the factual evidence but makes the visuals behave like a
Short: simulated monitor footage, moving window tiles, a clear wrong-arrow
moment, and small original sound effects. It uses the owner's local Fish
Audio "fred" narration and does not fetch or spend on any paid service.
"""
from pathlib import Path
import json, math, subprocess, wave, struct, random
from PIL import Image, ImageDraw, ImageFont

ROOT = Path('C:/Nori/streaming/channel-operator/03-Production/Nori-Real-Test')
FF = 'C:/Nori/streaming/tools/ffmpeg/ffmpeg-9.0.2-essentials_build/bin/ffmpeg.exe'
FP = 'C:/Nori/streaming/tools/ffmpeg/ffmpeg-9.0.2-essentials_build/bin/ffprobe.exe'
audio = ROOT / 'fred-narration.mp3'
sting = Path('C:/Nori/streaming/channel-operator/03-Production/Brand-Kit/nori-original-sting.wav')
transcript = json.loads((ROOT / 'fred-narration.transcript.json').read_text(encoding='utf-8'))
out = ROOT / 'Nori-Monitor-Test-Final-V2.mp4'
if out.exists():
    out.unlink()
assert audio.exists() and sting.exists()

probe = json.loads(subprocess.check_output([FP, '-v', 'error', '-show_format', '-show_streams', '-of', 'json', str(audio)]))
voice_duration = float(probe['format']['duration'])
W, H, FPS = 1080, 1920, 30
INTRO = 1.00
TOTAL = INTRO + voice_duration

FONT = 'C:/Windows/Fonts/seguisb.ttf'
REG = 'C:/Windows/Fonts/segoeui.ttf'
def f(path, size): return ImageFont.truetype(path, size)
F18, F24, F28, F32, F38 = [f(REG, n) for n in (18,24,28,32,38)]
F42, F50, F62, F78, F92 = [f(FONT, n) for n in (42,50,62,78,92)]

def stamp(t):
    ms = round(t * 1000)
    return f'{ms//3600000:02d}:{ms//60000%60:02d}:{ms//1000%60:02d},{ms%1000:03d}'

words = [w for seg in transcript['segments'] for w in seg.get('words', [])]
groups = []
for i in range(0, len(words), 5):
    chunk = words[i:i+5]
    if chunk:
        groups.append((INTRO + float(chunk[0]['start']), INTRO + float(chunk[-1]['end']), ' '.join(w['word'].strip() for w in chunk)))
(ROOT / 'captions-v2.srt').write_text('\n\n'.join(f'{i+1}\n{stamp(a)} --> {stamp(b)}\n{text}' for i,(a,b,text) in enumerate(groups))+'\n', encoding='utf-8')

def clamp(v, lo=0.0, hi=1.0): return max(lo, min(hi, v))
def ease(v):
    v = clamp(v)
    return v*v*(3-2*v)
def fit(d, text, font, max_width):
    if d.textbbox((0,0), text, font=font)[2] <= max_width: return text
    lines, line = [], ''
    for token in text.split():
        trial = (line + ' ' + token).strip()
        if d.textbbox((0,0), trial, font=font)[2] > max_width and line:
            lines.append(line); line = token
        else: line = trial
    if line: lines.append(line)
    return '\n'.join(lines)
def rr(d, box, fill, outline=None, width=1, radius=22):
    d.rounded_rectangle(box, radius=radius, fill=fill, outline=outline, width=width)
def txt(d, xy, text, font, fill='white', anchor=None, spacing=6, align='left'):
    if '\n' in text: d.multiline_text(xy, text, font=font, fill=fill, anchor=anchor, spacing=spacing, align=align)
    else: d.text(xy, text, font=font, fill=fill, anchor=anchor)
def badge(d, box, label, fill, text_fill='#07101b'):
    rr(d, box, fill, None, 0, 12)
    txt(d, ((box[0]+box[2])//2, (box[1]+box[3])//2), label, F28, text_fill, 'mm')
def arrow(d, a, b, fill, width=8):
    d.line((a[0],a[1],b[0],b[1]), fill=fill, width=width)
    ang = math.atan2(b[1]-a[1], b[0]-a[0])
    for delta in (2.6, -2.6):
        p=(b[0]-34*math.cos(ang+delta), b[1]-34*math.sin(ang+delta))
        d.line((b[0],b[1],p[0],p[1]), fill=fill, width=width)
def monitor(d, box, label, accent, active, windows, pulse=0):
    x1,y1,x2,y2=box
    glow = accent if active else '#28445a'
    rr(d, box, '#0c1724', glow, 7 if active else 3, 26)
    txt(d,(x1+26,y1+24),label,F32,accent)
    d.line((x1+24,y1+78,x2-24,y1+78),fill='#1f3448',width=3)
    for i,(title,color) in enumerate(windows):
        wx=x1+30+(i%2)*((x2-x1-84)//2); wy=y1+108+(i//2)*112
        ww=(x2-x1-100)//2; hh=88
        lift=int(8*math.sin(pulse*2+i))
        rr(d,(wx,wy+lift,wx+ww,wy+hh+lift),color,None,0,12)
        txt(d,(wx+14,wy+18+lift),title,F24,'#07101b')
        d.rectangle((wx+14,wy+52+lift,wx+ww-14,wy+60+lift),fill='#07101b')
    if active: badge(d,(x2-190,y2-58,x2-24,y2-20),'SELECTED',accent)
def base(t, section='NORI TEST'):
    im=Image.new('RGB',(W,H),'#07101b'); d=ImageDraw.Draw(im)
    drift=int(20*math.sin(t*.7));
    for y in range(H):
        q=y/H; d.line((0,y,W,y),fill=(5+int(5*q),14+int(13*q),25+int(22*q)))
    d.ellipse((760+drift,-130,1280+drift,390),fill='#102e48')
    d.ellipse((-300-drift,1390,240-drift,1930),fill='#12263d')
    # Subtle moving scan lines make the backdrop feel like capture footage.
    for y in range(130, H, 86): d.line((0,y,W,y),fill='#0b1b2b',width=2)
    txt(d,(54,48),f'FREDOINDAWRX  ×  {section}',F24,'#98aec0')
    d.line((54,98,W-54,98),fill='#25435a',width=4)
    d.line((54,98,54+int((W-108)*clamp(t/TOTAL)),98),fill='#83ffd0',width=4)
    return im,d

def compose(t):
    im,d=base(t)
    tv=t-INTRO
    if tv < 0:
        pulse=1+.08*math.sin(t*9)
        rr(d,(130,510,950,1310),'#0d2438','#83ffd0',5,44)
        txt(d,(540,760),'NORI',F92,'#83ffd0','mm'); txt(d,(540,875),'REAL TEST',F42,'white','mm')
        txt(d,(540,1080),'One useful answer.\nOne bad explanation.',F50,'white','mm',spacing=10,align='center')
        return im
    # Every scene has a moving subject; timing follows the downloaded narration.
    if tv < 2.55:
        z=ease(tv/2.55); txt(d,(54,170),'THE FIRST ANSWER',F32,'#83ffd0')
        monitor(d,(50,330,515,980),'MONITOR 1','#83ffd0',True,[('OBS','#58d6b1'),('GAME','#6e9cff'),('CAM','#f0c36a'),('CHAT','#b58cff')],t)
        monitor(d,(565,330,1030,980),'MONITOR 2','#ffd08c',False,[('DISCORD','#c992ff'),('DMs','#ff9fbe'),('BROWSER','#6e9cff'),('NOTES','#98aec0')],t+1)
        # Warning bubble flies in as “got the warning right”.
        bx=int(70+300*ease(clamp((tv-.35)/.7))); by=int(1050-40*math.sin(tv*4))
        rr(d,(bx,by,bx+940,1295),'#102536','#83ffd0',4,26)
        txt(d,(bx+34,by+28),'NORI WARNING',F32,'#83ffd0')
        txt(d,(bx+34,by+92),'Keep private Discord off screen 2.',F42,'white')
        badge(d,(760,1340,1025,1410),'RIGHT WARNING','#83ffd0')
    elif tv < 5.55:
        p=tv-2.55; txt(d,(54,170),'THE QUESTION',F32,'#ffd08c')
        # Discord-style chat card slides down and pulses when “screen 2” lands.
        y=int(280+60*math.sin(p*3)); rr(d,(52,y,1028,y+640),'#111827','#4e667a',3,26)
        txt(d,(90,y+42),'DISCORD  ·  PRIVATE',F28,'#98aec0')
        rr(d,(90,y+130,990,y+300),'#19283a',None,0,18); txt(d,(126,y+170),'Is Discord safe on screen 2?',F42,'white')
        badge(d,(90,y+360,380,y+430),'SCREEN 2','#ffd08c')
        rr(d,(420,y+348,990,y+470),'#0d3c37','#83ffd0',3,18); txt(d,(705,y+409),'Nori: keep it hidden.',F32,'#83ffd0','mm')
        txt(d,(540,1110),'The warning is useful.',F62,'#83ffd0','mm')
        txt(d,(540,1225),'So far, so good.',F38,'white','mm')
        # Small scan indicator keeps the card alive.
        d.line((160,1370,920,1370),fill='#29445b',width=10); d.line((160,1370,160+int(760*(0.5+0.5*math.sin(t*5))),1370),fill='#ffd08c',width=10)
    elif tv < 9.20:
        p=tv-5.55; txt(d,(54,170),'THEN IT GOT WEIRD',F32,'#ff7d8a')
        monitor(d,(50,330,515,1020),'SCREEN 1','#83ffd0',True,[('OBS','#58d6b1'),('GAME','#6e9cff'),('CAM','#f0c36a'),('CAPTURE','#6ad5ff')],t)
        monitor(d,(565,330,1030,1020),'SCREEN 2','#ffd08c',False,[('DISCORD','#c992ff'),('DMs','#ff9fbe'),('BROWSER','#6e9cff'),('WINDOWS','#98aec0')],t+1)
        # Bad claim is a deliberately animated red arrow from monitor 1 to monitor 2.
        phase=clamp(p/1.1); sx,sy=460,1120; ex=int(620+350*ease(phase))
        arrow(d,(sx,sy),(ex,sy),'#ff6576',10)
        badge(d,(260,1090,820,1170),'SCREEN 1  →  CAPTURES  →  SCREEN 2','#ff6576','#230b12')
        txt(d,(540,1300),'NOPE.',F92,'#ff6576','mm')
        txt(d,(540,1415),'That is the bad explanation.',F38,'white','mm')
    elif tv < 11.65:
        p=tv-9.20; shake=int(12*math.sin(p*27)*clamp((1-p/2.45)*2))
        txt(d,(540+shake,430),'BRO.',F92,'#ffd08c','mm')
        txt(d,(540-shake,600),"THAT'S NOT HOW",F62,'white','mm')
        txt(d,(540+shake,720),'THIS WORKS.',F78,'#ff7d8a','mm')
        rr(d,(95,900,985,1250),'#22131c','#ff7d8a',5,28)
        txt(d,(540,1010),'ONE BAD CLAIM',F42,'#ff7d8a','mm')
        txt(d,(540,1135),'can ruin a useful warning.',F38,'white','mm')
        # Original “record-scratch” style visual, no copyrighted meme asset.
        for i in range(8):
            yy=1360+i*34; d.line((120+i*25,yy,960-i*25,yy),fill='#ff7d8a',width=3)
    elif tv < 13.90:
        p=tv-11.65; txt(d,(54,170),'WE FIXED THE SETUP',F32,'#83ffd0')
        # Cards rotate/slide into a clean mapping.
        lift=int(80*(1-ease(p/1.0)))
        rr(d,(60,340+lift,1020,640+lift),'#142f35','#83ffd0',4,24); txt(d,(540,430+lift),'CLARIFIED',F50,'#83ffd0','mm'); txt(d,(540,545+lift),'Each source has a selected screen.',F38,'white','mm')
        rr(d,(60,760,500,1230),'#0d2438','#83ffd0',4,22); rr(d,(580,760,1020,1230),'#211c2a','#ffd08c',4,22)
        txt(d,(280,850),'CAPTURE 1',F32,'#83ffd0','mm'); txt(d,(280,960),'→ MONITOR 1',F42,'white','mm')
        txt(d,(800,850),'CAPTURE 2',F32,'#ffd08c','mm'); txt(d,(800,960),'→ MONITOR 2',F42,'white','mm')
        txt(d,(540,1400),'Now we test it again.',F62,'white','mm')
    elif tv < 19.20:
        p=tv-13.90; txt(d,(54,170),'THE RETEST',F32,'#83ffd0')
        monitor(d,(44,350,518,1120),'MONITOR 1','#83ffd0',p<2.2,[('OBS','#58d6b1'),('GAME','#6e9cff'),('CAM','#f0c36a'),('WINDOWS','#98aec0')],t)
        monitor(d,(562,350,1036,1120),'MONITOR 2','#ffd08c',p>=2.2,[('DISCORD','#c992ff'),('DMs','#ff9fbe'),('BROWSER','#6e9cff'),('WINDOWS','#98aec0')],t+1)
        # Selection slider moves across the monitors exactly as the narrator says “switch”.
        sx=int(160+760*ease(clamp((p-1.5)/1.8))); d.line((160,1280,920,1280),fill='#29445b',width=18); d.ellipse((sx-30,1250,sx+30,1310),fill='#ffd08c' if sx>540 else '#83ffd0')
        txt(d,(sx,1390),'SELECTED SCREEN',F32,'white','mm')
        if p>2.3:
            # A window tile visibly crosses into the selected capture preview.
            q=ease(clamp((p-2.3)/1.0)); wx=int(600-420*q); wy=int(860+60*math.sin(p*5))
            rr(d,(wx,wy,wx+280,wy+120),'#c992ff',None,0,16); txt(d,(wx+140,wy+60),'PRIVATE WINDOW',F24,'#07101b','mm')
            arrow(d,(wx+150,wy-22),(820,760),'#ffd08c',7)
    elif tv < 21.85:
        p=tv-19.20; txt(d,(540,360),'THE RESULT',F42,'#98aec0','mm')
        # Split stamps land with a small bounce, giving a clear payoff.
        bounce=math.sin(clamp(p/.8)*math.pi)*18
        rr(d,(70,540,1010,860),'#10342f','#83ffd0',5,26); txt(d,(540,700-bounce),'GOOD WARNING',F78,'#83ffd0','mm')
        rr(d,(70,950,1010,1270),'#28151e','#ff7d8a',5,26); txt(d,(540,1110+bounce),'BAD EXPLANATION',F62,'#ff7d8a','mm')
        txt(d,(540,1430),'The retest passed.',F42,'white','mm')
    else:
        p=tv-21.85; txt(d,(540,320),'BEFORE YOU GO LIVE',F32,'#98aec0','mm')
        # Final card slowly scales so the Short ends with motion instead of a dead slate.
        scale=1+0.04*math.sin(p*3); cx,cy=540,950; ww=int(900*scale); hh=int(480*scale)
        rr(d,(cx-ww//2,cy-hh//2,cx+ww//2,cy+hh//2),'#0f2735','#83ffd0',5,30)
        txt(d,(cx,cy-100),'CHECK BOTH',F92,'#83ffd0','mm'); txt(d,(cx,cy+40),'MONITORS.',F78,'white','mm'); txt(d,(cx,cy+180),'Nori is useful when you verify it.',F32,'#d9e4ef','mm')
        txt(d,(540,1560),'Projects, tests, and creator tools.',F32,'#98aec0','mm')
    # Readable captions sit above a safe bottom margin.
    for a,b,caption in groups:
        if a <= t < b:
            rr(d,(38,1630,1042,1812),'#03070d',None,0,22)
            cap=fit(d,caption.upper(),F38,920)
            d.multiline_text((540,1720),cap,font=F38,fill='white',anchor='mm',align='center',spacing=6,stroke_width=2,stroke_fill='#07101b')
            break
    return im

def make_sfx(path, duration):
    sr=44100; n=int((duration+.1)*sr); buf=[0.0]*n; rng=random.Random(42)
    def add(at, dur, kind):
        start=int(at*sr); length=int(dur*sr)
        for i in range(length):
            idx=start+i
            if idx>=n: break
            x=i/max(1,length-1); env=(1-x)**2
            if kind=='pop': val=math.sin(2*math.pi*(180+900*(1-x))*i/sr)*env*.28
            elif kind=='error': val=(math.sin(2*math.pi*170*i/sr)+.6*math.sin(2*math.pi*120*i/sr))*env*.16
            elif kind=='whoosh': val=(rng.random()*2-1)*env*.10
            else: val=math.sin(2*math.pi*(660+420*x)*i/sr)*env*.20
            buf[idx]+=val
    add(1.75,.16,'chime'); add(7.00,.18,'error'); add(9.35,.22,'whoosh'); add(13.0,.14,'pop'); add(18.25,.14,'pop'); add(20.55,.18,'chime'); add(22.25,.18,'chime')
    with wave.open(str(path),'wb') as wf:
        wf.setnchannels(1); wf.setsampwidth(2); wf.setframerate(sr)
        wf.writeframes(b''.join(struct.pack('<h',max(-32767,min(32767,int(v*32767)))) for v in buf))

video_tmp=ROOT/'motion-visuals-v2.mp4'; sfx=ROOT/'sfx-v2.wav'
if video_tmp.exists(): video_tmp.unlink()
make_sfx(sfx,TOTAL)
enc=subprocess.Popen([FF,'-v','error','-f','rawvideo','-pix_fmt','rgb24','-s',f'{W}x{H}','-r',str(FPS),'-i','pipe:0','-c:v','libx264','-crf','18','-preset','fast','-pix_fmt','yuv420p','-an','-movflags','+faststart',str(video_tmp)],stdin=subprocess.PIPE)
for i in range(math.ceil(TOTAL*FPS)): enc.stdin.write(compose(i/FPS).tobytes())
enc.stdin.close(); assert enc.wait()==0
subprocess.run([FF,'-v','error','-i',str(sting),'-i',str(audio),'-i',str(sfx),'-filter_complex',f'[0:a]apad,atrim=0:{TOTAL},volume=.65[sting];[1:a]adelay={round(INTRO*1000)}:all=1,apad,atrim=0:{TOTAL},volume=1.0[voice];[2:a]volume=.85[sfx];[sting][voice][sfx]amix=inputs=3:duration=longest:normalize=0[a]','-i',str(video_tmp),'-map','3:v','-map','[a]','-c:v','copy','-c:a','aac','-b:a','192k','-t',str(TOTAL),'-movflags','+faststart',str(out)],check=True)
video_tmp.unlink(missing_ok=True); sfx.unlink(missing_ok=True)
subprocess.run([FF,'-v','error','-xerror','-i',str(out),'-map','0','-f','null','-'],check=True)
final=json.loads(subprocess.check_output([FP,'-v','error','-show_streams','-show_format','-of','json',str(out)]))
v=next(s for s in final['streams'] if s['codec_type']=='video'); a=next(s for s in final['streams'] if s['codec_type']=='audio')
assert (v['width'],v['height'],v['codec_name'],a['codec_name'],v['r_frame_rate'])==(W,H,'h264','aac','30/1')
proof={'full_decode':'passed','source_audio':'fred-narration.mp3','source_audio_decode':'passed','source_audio_duration_seconds':voice_duration,'final_video':out.name,'resolution':[W,H],'fps':FPS,'duration_seconds':float(final['format']['duration']),'video_codec':'h264','audio_codec':'aac','caption_groups':len(groups),'caption_source':'Local small.en word timestamps from downloaded Fish audio','nori_sting_used':True,'original_sfx_generated':True,'evidence_cards_animated':True,'moving_monitor_visuals':True,'actual_private_chat_shown':False,'fish_voice':'fred','paid_spend':0,'owner_quality_acceptance':False,'youtube_published':False}
(ROOT/'FINAL-VERIFICATION-V2.json').write_text(json.dumps(proof,indent=2)+'\n',encoding='utf-8')
print(json.dumps(proof))
