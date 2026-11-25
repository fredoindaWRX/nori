"""Build the Nori monitor-test Short from free Fred narration and animated evidence cards."""
from pathlib import Path
import json, math, subprocess
from PIL import Image, ImageDraw, ImageFont

ROOT = Path('C:/Nori/streaming/channel-operator/03-Production/Nori-Real-Test')
FF = 'C:/Nori/streaming/tools/ffmpeg/ffmpeg-9.0.2-essentials_build/bin/ffmpeg.exe'
FP = 'C:/Nori/streaming/tools/ffmpeg/ffmpeg-9.0.2-essentials_build/bin/ffprobe.exe'
audio = ROOT / 'fred-narration.mp3'
sting = Path('C:/Nori/streaming/channel-operator/03-Production/Brand-Kit/nori-original-sting.wav')
transcript = json.loads((ROOT / 'fred-narration.transcript.json').read_text(encoding='utf-8'))
out = ROOT / 'Nori-Monitor-Test-Final.mp4'
assert audio.exists() and sting.exists()
assert not out.exists(), 'Preserve existing exports'

probe = json.loads(subprocess.check_output([FP, '-v', 'error', '-show_format', '-show_streams', '-of', 'json', str(audio)]))
duration = float(probe['format']['duration'])
W, H, FPS = 1080, 1920, 30
intro = 2.40
total = intro + duration

FONT = 'C:/Windows/Fonts/seguisb.ttf'
REG = 'C:/Windows/Fonts/segoeui.ttf'
bold_92 = ImageFont.truetype(FONT, 92)
bold_66 = ImageFont.truetype(FONT, 66)
bold_48 = ImageFont.truetype(FONT, 48)
bold_38 = ImageFont.truetype(FONT, 38)
regular_34 = ImageFont.truetype(REG, 34)
regular_30 = ImageFont.truetype(REG, 30)
regular_26 = ImageFont.truetype(REG, 26)

def stamp(t):
    ms = round(t * 1000)
    return f'{ms//3600000:02d}:{ms//60000%60:02d}:{ms//1000%60:02d},{ms%1000:03d}'

# Captions use the locally recognized speech, grouped into readable phrases.
words = [w for seg in transcript['segments'] for w in seg.get('words', [])]
groups = []
for i in range(0, len(words), 5):
    chunk = words[i:i+5]
    if chunk:
        groups.append((intro + float(chunk[0]['start']), intro + float(chunk[-1]['end']), ' '.join(w['word'].strip() for w in chunk)))
(ROOT / 'captions.srt').write_text('\n\n'.join(f'{i+1}\n{stamp(a)} --> {stamp(b)}\n{text}' for i,(a,b,text) in enumerate(groups))+'\n', encoding='utf-8')

def ease(x):
    x = max(0.0, min(1.0, x))
    return x*x*(3-2*x)

def fit_text(draw, text, font, max_width):
    if draw.textbbox((0,0), text, font=font)[2] <= max_width:
        return text
    parts, line = [], ''
    for token in text.split():
        trial = (line + ' ' + token).strip()
        if draw.textbbox((0,0), trial, font=font)[2] > max_width and line:
            parts.append(line); line = token
        else:
            line = trial
    if line: parts.append(line)
    return '\n'.join(parts)

def rounded(draw, box, fill, outline=None, width=1, radius=24):
    draw.rounded_rectangle(box, radius=radius, fill=fill, outline=outline, width=width)

def card(draw, box, title, body, accent, tag):
    rounded(draw, box, '#101c2a', accent, 4, 28)
    x1,y1,x2,y2 = box
    draw.text((x1+34,y1+30), tag.upper(), font=bold_38, fill=accent)
    draw.text((x1+34,y1+112), fit_text(draw, title, bold_48, x2-x1-68), font=bold_48, fill='white', spacing=10)
    draw.text((x1+34,y1+250), fit_text(draw, body, regular_34, x2-x1-68), font=regular_34, fill='#d9e4ef', spacing=12)

def compose(t):
    im = Image.new('RGB', (W,H), '#07101b')
    d = ImageDraw.Draw(im)
    # Slow background motion keeps the whole Short alive while evidence changes.
    drift = int(14 * math.sin(t * 0.55))
    for y in range(H):
        r = int(7 + 5*y/H); g = int(16 + 12*y/H); b = int(27 + 22*y/H)
        d.line((0, y, W, y), fill=(r, max(0,g+drift//3), max(0,b+drift)))
    d.ellipse((760+drift, -160, 1240+drift, 320), fill='#102b45')
    d.ellipse((-240-drift, 1350, 260-drift, 1850), fill='#13253d')
    # Brand line and progress rail.
    d.text((56, 52), 'FREDOINDAWRX  ×  NORI TEST', font=regular_26, fill='#93a8bc')
    d.line((56, 108, W-56, 108), fill='#29445b', width=4)
    d.line((56, 108, 56 + int((W-112)*min(t/total,1)), 108), fill='#83ffd0', width=4)

    if t < intro:
        pulse = 1 + 0.05*math.sin(t*8)
        cx, cy = W//2, 720
        rr = int(180*pulse)
        d.ellipse((cx-rr,cy-rr,cx+rr,cy+rr), fill='#102b45', outline='#83ffd0', width=6)
        d.text((cx, cy-18), 'NORI', font=bold_92, fill='#83ffd0', anchor='mm')
        d.text((cx, cy+110), 'REAL TEST', font=bold_38, fill='white', anchor='mm')
        d.text((cx, 1030), 'One useful answer.\nOne bad explanation.', font=bold_48, fill='white', anchor='mm', align='center', spacing=8)
    elif t < intro + 6.2:
        slide = ease((t-intro)/1.0)
        x = int((1-slide)*W + 42*slide)
        card(d, (x, 300, x+996, 960), 'The warning was useful.', '“Private Discord on screen 2?”\nNori said: don’t leave it exposed.', '#83ffd0', 'First answer')
        d.text((54, 1090), 'The problem was the explanation underneath.', font=bold_48, fill='#ffd08c')
    elif t < intro + 11.6:
        slide = ease((t-(intro+6.2))/1.0)
        x = int((1-slide)*W + 42*slide)
        card(d, (x, 300, x+996, 960), '“Screen 1 captures screen 2.”', 'That sentence was wrong.\nThe first result is kept as a rejected test.', '#ff7d8a', 'Rejected answer')
        rounded(d, (56, 1080, 1024, 1390), '#20151d', '#ff7d8a', 3, 22)
        d.text((88, 1125), 'BAD EXPLANATION', font=bold_38, fill='#ff7d8a')
        d.text((88, 1205), 'Useful warning ≠ reliable answer', font=bold_48, fill='white')
    elif t < intro + 17.7:
        slide = ease((t-(intro+11.6))/1.0)
        x = int((1-slide)*W + 42*slide)
        card(d, (x, 260, x+996, 910), 'Each source has a selected screen.', 'Monitor 1 capture → Monitor 1\nMonitor 2 capture → Monitor 2\nA scene with both can show both.', '#83ffd0', 'Retest passed')
        # Animated two-monitor diagram.
        y1,y2=1070,1420; gap=55; mw=460
        for idx,(label,color) in enumerate([('MONITOR 1','#83ffd0'),('MONITOR 2','#ffd08c')]):
            x1=54+idx*(mw+gap); x2=x1+mw
            active = (idx==0 and int(t*2)%2==0) or (idx==1 and int(t*2)%2==1)
            rounded(d,(x1,y1,x2,y2),'#101c2a',color if active else '#38536b',6 if active else 3,18)
            d.text(((x1+x2)//2,y1+74),label,font=bold_38,fill=color,anchor='mm')
            d.text(((x1+x2)//2,y1+180),'VISIBLE WINDOWS',font=regular_26,fill='#d9e4ef',anchor='mm')
            d.text(((x1+x2)//2,y1+260),'can appear',font=bold_38,fill='white',anchor='mm')
            if active: d.text(((x1+x2)//2,y2-40),'ACTIVE CAPTURE',font=regular_26,fill=color,anchor='mm')
    else:
        slide = ease((t-(intro+17.7))/1.0)
        d.text((W//2, 430), 'GOOD WARNING.', font=bold_92, fill='#83ffd0', anchor='mm')
        d.text((W//2, 590), 'BAD EXPLANATION.', font=bold_66, fill='#ff7d8a', anchor='mm')
        rounded(d,(80,850,1000,1250),'#101c2a','#83ffd0',4,28)
        d.text((W//2, 930), 'Check both monitors', font=bold_66, fill='white', anchor='mm')
        d.text((W//2, 1050), 'before you go live.', font=bold_66, fill='white', anchor='mm')
        d.text((W//2, 1450), 'Nori is useful when the owner checks it.', font=regular_34, fill='#d9e4ef', anchor='mm')
    # Caption box uses actual local ASR words, offset after the brand sting.
    for a,b,text in groups:
        if a <= t < b:
            box=(42,1540,1038,1818)
            rounded(d,box,'#03070d',None,0,24)
            cap=fit_text(d,text.upper(),bold_38,930)
            d.multiline_text((W//2,1680),cap,font=bold_38,fill='white',anchor='mm',align='center',spacing=8,stroke_width=2,stroke_fill='#07101b')
            break
    return im

decoder = subprocess.Popen([FF,'-v','error','-f','lavfi','-i',f'color=black:s={W}x{H}:r={FPS}','-t',str(total),'-f','rawvideo','-pix_fmt','rgb24','pipe:1'], stdout=subprocess.PIPE)
video_tmp = ROOT / 'motion-visuals.raw.mp4'
encoder = subprocess.Popen([FF,'-v','error','-f','rawvideo','-pix_fmt','rgb24','-s',f'{W}x{H}','-r',str(FPS),'-i','pipe:0','-c:v','libx264','-crf','18','-preset','fast','-pix_fmt','yuv420p','-an','-movflags','+faststart',str(video_tmp)], stdin=subprocess.PIPE)
frames = math.ceil(total*FPS)
for i in range(frames):
    encoder.stdin.write(compose(i/FPS).tobytes())
encoder.stdin.close(); assert encoder.wait()==0
decoder.stdout.close(); decoder.kill()

# Intro sting plus delayed narration; the sting is the existing Nori brand sound.
subprocess.run([FF,'-v','error','-i',str(sting),'-i',str(audio),'-filter_complex',f'[0:a]apad,atrim=0:{total},volume=0.75[sting];[1:a]adelay={round(intro*1000)}:all=1,apad,atrim=0:{total},volume=1.0[voice];[sting][voice]amix=inputs=2:duration=longest:normalize=0[a]','-i',str(video_tmp),'-map','2:v','-map','[a]','-c:v','copy','-c:a','aac','-b:a','192k','-t',str(total),'-movflags','+faststart',str(out)],check=True)
video_tmp.unlink(missing_ok=True)
subprocess.run([FF,'-v','error','-xerror','-i',str(out),'-map','0','-f','null','-'],check=True)
final=json.loads(subprocess.check_output([FP,'-v','error','-show_streams','-show_format','-of','json',str(out)]))
v=next(s for s in final['streams'] if s['codec_type']=='video'); a=next(s for s in final['streams'] if s['codec_type']=='audio')
assert (v['width'],v['height'],v['codec_name'],a['codec_name'],v['r_frame_rate'])==(W,H,'h264','aac','30/1')
proof={'full_decode':'passed','source_audio':'fred-narration.mp3','source_audio_decode':'passed','source_audio_duration_seconds':duration,'final_video':out.name,'resolution':[W,H],'fps':FPS,'duration_seconds':float(final['format']['duration']),'video_codec':'h264','audio_codec':'aac','caption_groups':len(groups),'caption_source':'Local small.en word timestamps from downloaded Fish audio','nori_sting_used':True,'evidence_cards_animated':True,'actual_private_chat_shown':False,'fish_voice':'fred','paid_spend':0,'owner_quality_acceptance':False,'youtube_published':False}
(ROOT/'FINAL-VERIFICATION.json').write_text(json.dumps(proof,indent=2)+'\n',encoding='utf-8')
print(json.dumps(proof))
