from __future__ import annotations

import csv
import json
import math
from pathlib import Path
import subprocess
import sys
import wave

import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = Path('C:/Nori/streaming')
OPS = ROOT / 'channel-operator'
KIT = OPS / '03-Production/Brand-Kit'
KIT.mkdir(parents=True, exist_ok=True)
TOOLS = json.loads((ROOT / 'tools/media-tools.json').read_text(encoding='utf-8-sig'))
FFMPEG, FFPROBE = TOOLS['ffmpeg'], TOOLS['ffprobe']
FONT = 'C:/Windows/Fonts/bahnschrift.ttf'
BODY = 'C:/Windows/Fonts/segoeui.ttf'
CYAN, PURPLE, WHITE = '#58e4ff', '#ab91ff', '#f2f6ff'
LOGO = Image.open(ROOT / 'assets/nori-symbol-3d.png').convert('RGBA')
LOGO = LOGO.crop(LOGO.getbbox())


def font(size: int, body: bool = False):
    return ImageFont.truetype(BODY if body else FONT, size)


def centered(draw, text, y, size, color=WHITE, width=1920):
    f = font(size)
    draw.text((width/2, y), text, fill=color, font=f, anchor='mt')


def wrap(draw, text, size, max_width):
    lines, current = [], ''
    for word in text.split():
        test = f'{current} {word}'.strip()
        if draw.textlength(test, font=font(size)) > max_width and current:
            lines.append(current)
            current = word
        else:
            current = test
    if current:
        lines.append(current)
    return lines


def background(w: int, h: int):
    yy, xx = np.mgrid[0:h, 0:w]
    glow_c = np.exp(-(((xx-w*.2)/(w*.55))**2 + ((yy-h*.34)/(h*.58))**2)*3)
    glow_p = np.exp(-(((xx-w*.83)/(w*.5))**2 + ((yy-h*.7)/(h*.6))**2)*3)
    array = np.stack([8+8*glow_c+18*glow_p, 12+21*glow_c+7*glow_p, 19+29*glow_c+24*glow_p], axis=-1)
    im = Image.fromarray(array.astype('uint8'), 'RGB').convert('RGBA')
    d = ImageDraw.Draw(im)
    step = 120 if w > h else 90
    for x in range(0,w,step):
        d.line((x,0,x,h),fill=(32,44,57,150),width=1)
    for y in range(0,h,step):
        d.line((0,y,w,y),fill=(32,44,57,150),width=1)
    d.line((50,50,w-50,50),fill=CYAN,width=3)
    d.line((50,h-50,w-50,h-50),fill=PURPLE,width=3)
    return im


def sound(path: Path, seconds: float):
    sr = 48000
    t = np.arange(round(sr*seconds)) / sr
    rng = np.random.default_rng(7)
    noise = rng.standard_normal(len(t))
    # Original short sweep and three harmonic pulses; no third-party recordings.
    sweep = np.sin(2*np.pi*(190*t + 310*t*t)) * np.exp(-10*t)
    pulse = np.zeros_like(t)
    for onset, hz in [(0.22,220),(.29,330),(.36,440)]:
        u = np.maximum(t-onset,0)
        gate = (t>=onset).astype(float)
        pulse += gate*np.sin(2*np.pi*hz*u)*np.exp(-8*u)*.35
    signal = .10*sweep + .055*pulse + .018*noise*np.exp(-16*t)
    signal *= np.minimum(t/.015,1)*np.minimum((seconds-t)/.05,1)
    stereo = np.stack((signal, signal*.94),axis=1)
    with wave.open(str(path),'wb') as out:
        out.setnchannels(2); out.setsampwidth(2); out.setframerate(sr)
        out.writeframes((np.clip(stereo,-.95,.95)*32767).astype('<i2').tobytes())


def logo_frame(base, t, duration, loop):
    im = base.copy()
    w,h = im.size
    vertical = h>w
    d = ImageDraw.Draw(im)
    cy = h*.43 if vertical else h*.39
    side = 570 if vertical else 480
    phase = t/duration*math.tau
    # Gentle perspective-like motion of the established raster emblem.
    tilt = math.sin(phase)*2 if loop else -5*math.exp(-t*4)
    bob = math.sin(phase)*9 if loop else 35*math.exp(-t*5)
    visibility = 1 if loop else min(t/.35,1)
    lw = max(1, round(side*(.97+.03*math.cos(phase))))
    logo = LOGO.resize((lw,side),Image.Resampling.LANCZOS).rotate(tilt,Image.Resampling.BICUBIC,expand=True)
    if visibility < 1:
        logo.putalpha(logo.getchannel('A').point(lambda a:round(a*visibility)))
    radius = side*.7
    box = (w/2-radius,cy-radius,w/2+radius,cy+radius)
    d.arc(box,phase*180/math.pi,phase*180/math.pi+85,fill=CYAN,width=3)
    d.arc(box,phase*180/math.pi+180,phase*180/math.pi+240,fill=PURPLE,width=2)
    im.alpha_composite(logo,(round(w/2-logo.width/2),round(cy-logo.height/2+bob)))
    d = ImageDraw.Draw(im)
    centered(d,'FredoIndaWRX',h*.70 if vertical else h*.72,76 if vertical else 88,width=w)
    centered(d,'BUILDING NORI',h*.77 if vertical else h*.82,38 if vertical else 32,CYAN,w)
    if vertical:
        centered(d,'Games, projects,',h*.83,31,width=w)
        centered(d,'and whatever comes next',h*.86,31,width=w)
    else:
        centered(d,'Games, projects, and whatever comes next',h*.9,27,width=w)
    # Slow short line accents, closed at the loop boundary.
    for i in range(7):
        px = (i*239 + 67*math.sin(phase+i)) % (w-160)+80
        py = (i*181) % (h-200)+100
        d.line((px,py,px+20,py),fill=CYAN if i%2==0 else PURPLE,width=2)
    return im.convert('RGB')


def verify(path: Path, w: int, h: int, duration: float, audio: bool):
    report = json.loads(subprocess.check_output([FFPROBE,'-v','error','-show_streams','-show_format','-of','json',str(path)]))
    videos = [s for s in report['streams'] if s['codec_type']=='video']
    sounds = [s for s in report['streams'] if s['codec_type']=='audio']
    assert len(videos)==1 and videos[0]['width']==w and videos[0]['height']==h
    assert videos[0]['codec_name']=='h264' and videos[0]['pix_fmt']=='yuv420p'
    assert abs(float(report['format']['duration'])-duration)<.12
    assert bool(sounds)==audio
    if audio:
        assert sounds[0]['codec_name']=='aac'
    subprocess.run([FFMPEG,'-v','error','-xerror','-i',str(path),'-f','null','-'],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
    report['verification'] = {'full_decode':'passed','dimensions':'passed','duration':'passed','audio_expected':audio,'role':'Reusable brand asset, not a completed calendar episode'}
    path.with_suffix('.verification.json').write_text(json.dumps(report,indent=2),encoding='utf-8')


def render_animation(name,w,h,duration,loop):
    base = background(w,h)
    output = KIT/f'{name}.mp4'
    fps = 30
    args = [FFMPEG,'-y','-v','error','-f','rawvideo','-pix_fmt','rgb24','-s',f'{w}x{h}','-r',str(fps),'-i','pipe:0']
    if not loop:
        wav = KIT/'nori-original-sting.wav'
        if not wav.exists(): sound(wav,duration)
        args += ['-i',str(wav)]
    args += ['-c:v','libx264','-preset','fast','-crf','18','-pix_fmt','yuv420p']
    if not loop: args += ['-c:a','aac','-b:a','192k']
    args += ['-t',str(duration),'-movflags','+faststart',str(output)]
    with (KIT/f'{name}.render.log').open('wb') as log:
        proc = subprocess.Popen(args,stdin=subprocess.PIPE,stderr=log)
        try:
            for index in range(round(duration*fps)):
                frame=logo_frame(base,index/fps,duration,loop)
                proc.stdin.write(frame.tobytes())
        finally:
            proc.stdin.close()
        if proc.wait()!=0:
            raise RuntimeError(f'Render failed: {name}; see render log.')
    logo_frame(base,duration*.4,duration,loop).save(KIT/f'{name}-poster.jpg',quality=94)
    verify(output,w,h,duration,not loop)
    print(f'Verified {output.name}',flush=True)


def thumbnail(identifier, overlay, vertical=False):
    w,h=(1080,1920) if vertical else (1280,720)
    im=background(w,h)
    d=ImageDraw.Draw(im)
    small=LOGO.resize((95,95),Image.Resampling.LANCZOS)
    im.alpha_composite(small,(70,95) if vertical else (55,42))
    d.text((190 if vertical else 170,119 if vertical else 64),'FredoIndaWRX',font=font(31 if vertical else 24),fill=WHITE)
    category='BUILDING NORI' if identifier.startswith(('W3','W4')) else 'CREATOR SYSTEMS'
    d.text((75,h*.22 if vertical else 175),category,font=font(30 if vertical else 24),fill=CYAN)
    size=105 if vertical else 86
    lines=wrap(d,overlay,size,w-145 if vertical else w*.7)
    y=h*.3 if vertical else 238
    for line in lines:
        d.text((70,y),line,font=font(size),fill=WHITE)
        y+=size*1.1
    # Clearly graphical topic diagrams, rather than invented application captures.
    if vertical:
        bx,by,bw,bh=80,1000,780,425
    else:
        bx,by,bw,bh=870,285,310,220
    diagram_topic(im,(bx,by,bw,bh),identifier)
    d=ImageDraw.Draw(im)
    d.text((75,h-170 if vertical else h-100),'PROJECTS / EXPERIMENTS / FIXES',font=font(24 if vertical else 21),fill=CYAN)
    out=OPS/'02-Calendar'/f'Week-{identifier[1]}'/identifier/('cover-frame.png' if vertical else 'thumbnail.png')
    im.convert('RGB').save(out)
    return out


def diagram_topic(im,box,identifier):
    d=ImageDraw.Draw(im)
    x,y,w,h=box
    scale=w/310
    d.rounded_rectangle((x,y,x+w,y+h),radius=22,fill='#131e2d',outline=PURPLE,width=3)
    if identifier=='W1-S2':
        for xx in [x+100*scale,x+167*scale]:
            d.rounded_rectangle((xx,y+35*scale,xx+43*scale,y+130*scale),radius=5,fill=CYAN)
        d.text((x+w/2,y+h-42*scale),'BREAK SCENE',font=font(round(24*scale)),fill=WHITE,anchor='mt')
    elif identifier.startswith('W1'):
        for j in range(4):
            xx=x+25*scale+j*16*scale
            yy=y+28*scale+j*16*scale
            ww=w-50*scale-j*37*scale
            hh=h-70*scale-j*30*scale
            d.rounded_rectangle((xx,yy,xx+max(ww,12),yy+max(hh,12)),radius=7,outline=CYAN,width=max(2,round(3*scale)))
        d.text((x+25*scale,y+h-33*scale),'OBS',font=font(round(20*scale)),fill=WHITE)
    elif identifier=='W2-S2':
        for j in range(14):
            xx=x+(22+j*20)*scale
            amplitude=(15+25*abs(math.sin(j*.8)))*scale
            d.line((xx,y+h*.42-amplitude,xx,y+h*.42+amplitude),fill=CYAN,width=max(2,round(6*scale)))
        d.text((x+w/2,y+h-49*scale),'PLAY IT BACK',font=font(round(23*scale)),fill=WHITE,anchor='mt')
    elif identifier.startswith('W2'):
        for j,(label,color) in enumerate([('MIC',CYAN),('DISCORD',PURPLE)]):
            xx=x+(25+j*140)*scale
            d.text((xx,y+22*scale),label,font=font(round(17*scale)),fill=WHITE)
            for i in range(6):
                yy=y+h-32*scale-i*20*scale
                d.rounded_rectangle((xx,yy,xx+58*scale,yy+12*scale),radius=3,fill=color if i<(5 if j==0 else 3) else '#2a384a')
    elif identifier=='W3-S2':
        for j in range(3):
            yy=y+(28+j*52)*scale
            d.rounded_rectangle((x+25*scale,yy,x+80*scale,yy+35*scale),radius=5,outline=CYAN,width=round(3*scale))
            d.line((x+80*scale,yy+18*scale,x+185*scale,y+h*.5),fill=PURPLE,width=round(2*scale))
        d.rounded_rectangle((x+185*scale,y+62*scale,x+285*scale,y+147*scale),radius=7,fill='#223149',outline=PURPLE,width=round(3*scale))
        d.text((x+235*scale,y+94*scale),'MODEL',font=font(round(18*scale)),fill=WHITE,anchor='mt')
        d.text((x+18*scale,y+7*scale),'WORKERS',font=font(round(14*scale)),fill=WHITE)
    elif identifier.startswith('W3'):
        for j,(label,color) in enumerate([('ALIVE',CYAN),('READY?', '#ffa378')]):
            yy=y+(28+j*88)*scale
            d.ellipse((x+25*scale,yy,x+51*scale,yy+26*scale),fill=color)
            d.text((x+67*scale,yy-2*scale),label,font=font(round(24*scale)),fill=WHITE)
            d.line((x+70*scale,yy+37*scale,x+w-25*scale,yy+37*scale),fill=color,width=round(3*scale))
    else:
        centers=[(x+55*scale,y+60*scale),(x+w-55*scale,y+60*scale),(x+w/2,y+h-50*scale)]
        d.line((centers[0],centers[1],centers[2],centers[0]),fill=PURPLE,width=round(4*scale))
        for j,(xx,yy) in enumerate(centers):
            rr=22*scale
            d.ellipse((xx-rr,yy-rr,xx+rr,yy+rr),fill='#20354a',outline=CYAN,width=round(3*scale))
            d.text((xx,yy),str(j+1),font=font(round(21*scale)),fill=WHITE,anchor='mm')


def short_visuals():
    out=OPS/'02-Calendar/Week-1/W1-S1/visuals'
    out.mkdir(parents=True,exist_ok=True)
    headings=['OBS IN OBS?', 'SPLIT THE SCREENS', 'CHECK THE DISPLAY', 'RECORD. WATCH. CHECK.', 'BUILD THE NEXT THING']
    notes=['The preview is on the screen being captured.', 'Controls on one screen. Your work on the other.', 'Select the display that contains your work.', 'Review a short recording before you go live.', 'Follow FredoIndaWRX for the next practical build.']
    for index,(heading,note) in enumerate(zip(headings,notes),start=1):
        im=background(1080,1920)
        d=ImageDraw.Draw(im)
        d.text((85,160),'FredoIndaWRX  /  CREATOR SYSTEMS',font=font(30),fill=CYAN)
        d.text((85,290),f'{index:02d}',font=font(76),fill=PURPLE)
        lines=wrap(d,heading,91,880)
        yy=430
        for line in lines:
            d.text((80,yy),line,font=font(91),fill=WHITE)
            yy+=103
        if index==1:
            diagram_topic(im,(110,790,770,460),'W1-S1')
        elif index in [2,3]:
            for j,(label,color) in enumerate([('OBS + CONTROLS',PURPLE),('YOUR WORK',CYAN)]):
                xx=85+j*450
                d.rounded_rectangle((xx,850,xx+370,1140),radius=20,fill='#152334',outline=color,width=5)
                d.line((xx+185,1140,xx+185,1190),fill=color,width=8)
                d.line((xx+115,1190,xx+255,1190),fill=color,width=8)
                d.text((xx+185,960),label,font=font(28),fill=WHITE,anchor='mm')
                d.text((xx+185,1235),'CONTROL SCREEN' if j==0 else 'CAPTURE THIS',font=font(29),fill=color,anchor='mt')
            if index==3:
                d.rounded_rectangle((535,815,905,1175),radius=24,outline=CYAN,width=7)
        elif index==4:
            for j,check in enumerate(['Your work is visible', 'No repeating preview', 'Private windows off-screen']):
                yy=835+j*130
                d.rectangle((100,yy,138,yy+38),outline=CYAN,width=3)
                d.text((170,yy-2),check,font=font(42),fill=WHITE)
        else:
            logo=LOGO.resize((500,500),Image.Resampling.LANCZOS)
            im.alpha_composite(logo,(290,795))
        d=ImageDraw.Draw(im)
        yy=1310
        for line in wrap(d,note,43,820):
            d.text((85,yy),line,font=font(43),fill=WHITE)
            yy+=58
        d.text((85,1740),'BUILDING NORI / GAMES / PROJECTS',font=font(27),fill=CYAN)
        im.convert('RGB').save(out/f'scene-{index:02d}.png')
    (out/'SCENE-NOTES.txt').write_text('Finished illustration assets for the first Short. These are explanatory diagrams, not screen captures or proof that a live recording passed. Timing and spoken captions must be aligned to the actual Fish Audio narration before the final MP4 is rendered.\n',encoding='utf-8')


def main():
    paths=[]
    with (OPS/'calendar.csv').open(encoding='utf-8-sig',newline='') as file:
        for item in csv.DictReader(file):
            package=OPS/'02-Calendar'/f"Week-{item['ID'][1]}"/item['ID']/'production-package.txt'
            overlay=next(line.split(': ',1)[1] for line in package.read_text(encoding='utf-8-sig').splitlines() if line.startswith('THUMBNAIL OVERLAY:'))
            paths.append(str(thumbnail(item['ID'],overlay,item['Format']=='Short')))
    print(f'Created {len(paths)} thumbnail/cover assets',flush=True)
    short_visuals()
    if '--graphics-only' in sys.argv:
        return
    render_animation('nori-sting-horizontal',1920,1080,2.4,False)
    render_animation('nori-sting-vertical',1080,1920,2.4,False)
    render_animation('nori-loop-horizontal',1920,1080,8,True)
    (KIT/'ASSET-REGISTER.json').write_text(json.dumps({'thumbnails_and_covers':paths,'animations':['nori-sting-horizontal.mp4','nori-sting-vertical.mp4','nori-loop-horizontal.mp4'],'sound':'nori-original-sting.wav','copyright':'Original synthesized sound; established channel emblem and graphics.','status':'Reusable brand assets complete; calendar episodes remain incomplete pending voice and content.'},indent=2),encoding='utf-8')


if __name__=='__main__':
    main()
