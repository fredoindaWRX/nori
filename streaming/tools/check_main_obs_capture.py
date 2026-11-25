import json
from pathlib import Path
import shutil
import subprocess
from PIL import Image, ImageDraw

bin_dir=Path('C:/Nori/streaming/tools/ffmpeg/ffmpeg-9.0.2-essentials_build/bin')
folder=Path('C:/Nori/streaming/channel-operator/02-Calendar/Week-1/W1-MAIN/live-captures')
folder.mkdir(parents=True,exist_ok=True)
original=Path('C:/Users/Studio/Videos/2026-09-30 19-47-02.mp4')
copy=folder/'obs-starting-to-break-actual.mp4'
if not copy.exists():
    shutil.copy2(original,copy)
def run(*args):
    return subprocess.run([str(bin_dir/args[0]),*args[1:]],check=True,capture_output=True,text=True)
probe=json.loads(run('ffprobe.exe','-v','error','-show_streams','-show_format','-of','json',str(copy)).stdout)
run('ffmpeg.exe','-v','error','-i',str(copy),'-f','null','-')
audio=run('ffmpeg.exe','-hide_banner','-i',str(copy),'-vn','-af','volumedetect','-f','null','-').stderr
points=[2.0,5.0,6.0,10.0,17.0]
sheet=Image.new('RGB',(1280,820),'#121522')
d=ImageDraw.Draw(sheet)
for i,t in enumerate(points):
    frame=folder/f'obs-recording-review-{i+1:02d}.png'
    run('ffmpeg.exe','-v','error','-ss',str(t),'-i',str(copy),'-frames:v','1','-y',str(frame))
    im=Image.open(frame).convert('RGB').resize((620,349))
    x=10+(i%2)*640;y=20+(i//2)*270
    im.thumbnail((620,240))
    sheet.paste(im,(x,y));d.text((x,y+241),f'Actual local recording, {t:.1f}s',fill='white')
sheet.save(folder/'obs-recording-review-contact.jpg',quality=94)
record={'source':'Actual OBS local recording; Starting Soon to Break only.','file':str(copy),'duration':float(probe['format']['duration']),'video':next(s for s in probe['streams'] if s['codec_type']=='video'),'audio_volume_observation':[line.strip() for line in audio.splitlines() if 'volume:' in line],'whole_decode':'passed','review_frame_times':points,'visual_review_status':'Awaiting inspection of generated review contact sheet','limits':'No monitor switching, microphone audibility, Discord audibility, or end-to-end live broadcast was tested by this sample.'}
(folder/'obs-recording-verification.json').write_text(json.dumps(record,indent=2)+'\n',encoding='utf-8')
print(json.dumps({k:v for k,v in record.items() if k!='video'}))
