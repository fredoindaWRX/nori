import json
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT=Path('C:/Nori/streaming')
OPS=ROOT/'channel-operator'
OUT=ROOT/'tools/verification'
OUT.mkdir(parents=True,exist_ok=True)
font=ImageFont.truetype('C:/Windows/Fonts/segoeui.ttf',22)
paths=sorted((OPS/'02-Calendar').glob('Week-*/*/thumbnail.png'))+sorted((OPS/'02-Calendar').glob('Week-*/*/cover-frame.png'))
assert len(paths)==12
sheet=Image.new('RGB',(1600,1800),'#0b111b')
d=ImageDraw.Draw(sheet)
for i,path in enumerate(paths):
    image=Image.open(path)
    expect=(1280,720) if path.name=='thumbnail.png' else (1080,1920)
    assert image.size==expect
    image.thumbnail((370,520))
    x=(i%4)*400+(400-image.width)//2
    y=(i//4)*600+45
    sheet.paste(image,(x,y))
    d.text(((i%4)*400+20,(i//4)*600+10),path.parent.name,font=font,fill='white')
sheet.save(OUT/'all-12-cover-assets.jpg',quality=94)
scenes=sorted((OPS/'02-Calendar/Week-1/W1-S1/visuals').glob('scene-*.png'))
assert len(scenes)==5
sheet=Image.new('RGB',(1500,600),'#0b111b')
for i,path in enumerate(scenes):
    image=Image.open(path); assert image.size==(1080,1920)
    image.thumbnail((280,530)); sheet.paste(image,(i*300+10,45))
    ImageDraw.Draw(sheet).text((i*300+10,10),path.stem,font=font,fill='white')
sheet.save(OUT/'first-short-scenes.jpg',quality=94)
(OUT/'graphics-checks.json').write_text(json.dumps({'cover_assets':12,'first_short_illustrations':5,'dimensions':'passed','visual_review':'See saved contact sheets'},indent=2),encoding='utf-8')
