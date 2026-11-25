"""Inspect caption frames and measure the finished audio mix."""
import json
from pathlib import Path
import subprocess
from PIL import Image, ImageDraw, ImageFont

folder=Path('C:/Nori/streaming/channel-operator/02-Calendar/Week-1/W1-S1')
tools=json.loads(Path('C:/Nori/streaming/tools/media-tools.json').read_text(encoding='utf-8-sig'))
ffmpeg=tools['ffmpeg']
video=folder/'OBS-Is-Showing-Itself-Fredo.mp4'
out=folder/'Export-Review';out.mkdir(exist_ok=True)
times=[.7,2.2,4.9,7.9,10.7,12.3,14.7,16.7,19.5,21.7]
sheet=Image.new('RGB',(1500,1120),'#0b111b')
font=ImageFont.truetype('C:/Windows/Fonts/segoeui.ttf',18)
draw=ImageDraw.Draw(sheet)
for i,t in enumerate(times):
    path=out/f'frame-{i+1:02}.png'
    subprocess.run([ffmpeg,'-v','error','-y','-ss',str(t),'-i',str(video),'-frames:v','1',str(path)],check=True)
    image=Image.open(path);assert image.size==(1080,1920)
    image.thumbnail((280,510))
    x=(i%5)*300;y=(i//5)*560
    sheet.paste(image,(x+(300-image.width)//2,y+30))
    draw.text((x+10,y+5),f'{t:.1f} seconds',font=font,fill='white')
sheet.save(out/'caption-and-scene-review.jpg',quality=94)
result=subprocess.run([ffmpeg,'-hide_banner','-i',str(video),'-af','loudnorm=I=-16:TP=-1:LRA=11:print_format=json','-f','null','-'],capture_output=True,text=True,check=True)
levels=json.loads(result.stderr[result.stderr.rfind('{'):result.stderr.rfind('}')+1])
status={'integrated_lufs':float(levels['input_i']),'true_peak_dbtp':float(levels['input_tp']),'loudness_range':float(levels['input_lra']),'frames_checked':len(times),'full_decode':'passed in assembly','word_match':'exact after punctuation normalization','caption_frame_review':'pending','publishing_rights':'unresolved; no upload authorized by technical verification alone'}
print(json.dumps(status))
assert abs(status['integrated_lufs']+16)<1.0
assert status['true_peak_dbtp']<=-1
(out/'export-checks.json').write_text(json.dumps(status,indent=2),encoding='utf-8')
print(json.dumps(status))
