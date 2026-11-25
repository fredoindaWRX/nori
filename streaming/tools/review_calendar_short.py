import argparse,json,math,re,subprocess
from pathlib import Path
from PIL import Image,ImageDraw,ImageFont
parser=argparse.ArgumentParser();parser.add_argument('video',type=Path);args=parser.parse_args()
video=args.video;folder=video.parent
ffmpeg=json.loads(Path('C:/Nori/streaming/tools/media-tools.json').read_text(encoding='utf-8-sig'))['ffmpeg']
out=folder/'Export-Review';out.mkdir(exist_ok=True)
def seconds(s):
 h,m,secs=s.replace(',','.').split(':');return int(h)*3600+int(m)*60+float(secs)
matches=re.findall(r'(\d\d:\d\d:\d\d,\d\d\d) --> (\d\d:\d\d:\d\d,\d\d\d)',(folder/'captions.srt').read_text())
times=[(seconds(a)+seconds(b))/2 for a,b in matches]
columns=5;rows=math.ceil(len(times)/columns)
sheet=Image.new('RGB',(columns*300,rows*560),'#0b111b');draw=ImageDraw.Draw(sheet);font=ImageFont.truetype('C:/Windows/Fonts/segoeui.ttf',18)
for i,t in enumerate(times):
 path=out/f'frame-{i+1:02}.png';subprocess.run([ffmpeg,'-v','error','-y','-ss',str(t),'-i',str(video),'-frames:v','1',str(path)],check=True)
 image=Image.open(path);assert image.size==(1080,1920);image.thumbnail((280,510));x=(i%columns)*300;y=(i//columns)*560
 sheet.paste(image,(x+(300-image.width)//2,y+30));draw.text((x+10,y+5),f'{t:.2f} seconds',font=font,fill='white')
sheet.save(out/'caption-and-scene-review.jpg',quality=94)
result=subprocess.run([ffmpeg,'-hide_banner','-i',str(video),'-af','loudnorm=I=-16:TP=-1:LRA=11:print_format=json','-f','null','-'],capture_output=True,text=True,check=True)
levels=json.loads(result.stderr[result.stderr.rfind('{'):result.stderr.rfind('}')+1])
status={'integrated_lufs':float(levels['input_i']),'true_peak_dbtp':float(levels['input_tp']),'loudness_range':float(levels['input_lra']),'frames_checked':len(times),'full_decode':'passed in assembly','word_match':'exact after punctuation and hyphen normalization','caption_frame_review':'pending visual inspection','publishing_rights':'User authorized Fish narration; license classification unresolved'}
assert abs(status['integrated_lufs']+16)<1.0;assert status['true_peak_dbtp']<=-1
(out/'export-checks.json').write_text(json.dumps(status,indent=2),encoding='utf-8')
print(json.dumps(status))
