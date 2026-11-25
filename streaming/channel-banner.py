from PIL import Image, ImageDraw, ImageFont
from pathlib import Path
import math
root=Path(r'C:\Nori\streaming\channel-assets');root.mkdir(exist_ok=True)
im=Image.new('RGB',(2560,1440));px=im.load()
for y in range(1440):
 for x in range(2560):
  glow=max(0,1-math.hypot((x-1880)/1500,(y-680)/900))
  px[x,y]=(int(8+12*glow),int(12+15*glow),int(22+24*glow))
d=ImageDraw.Draw(im)
for x in range(-600,3000,160):d.line((x,0,x+650,1440),fill=(23,32,45),width=2)
for y in (360,1080):d.line((0,y,2560,y),fill=(36,46,62),width=2)
# Safe text region kept inside the center 1546 x 423 device crop.
d.line((630,585,800,585),fill=(108,220,229),width=4)
d.line((1760,850,1930,850),fill=(165,137,211),width=4)
bold=ImageFont.truetype(r'C:\Windows\Fonts\arialbd.ttf',112)
regular=ImageFont.truetype(r'C:\Windows\Fonts\arial.ttf',37)
mono=ImageFont.truetype(r'C:\Windows\Fonts\consola.ttf',22)
def center(text,font,y,fill):
 box=d.textbbox((0,0),text,font=font);width=box[2]-box[0];d.text(((2560-width)/2,y),text,font=font,fill=fill)
center('FREDOINDAWRX',bold,620,(238,242,248))
center('Games, projects, and whatever comes next',regular,764,(157,209,217))
center('BUILDING NORI  /  CREATIVE TECH  /  GAMING',mono,828,(173,163,192))
# Architectural framing, intentionally beyond mobile crop.
for x in (430,2130):
 d.line((x,500,x,940),fill=(53,76,90),width=2)
 d.line((x-18,500,x+18,500),fill=(84,129,143),width=3)
 d.line((x-18,940,x+18,940),fill=(84,129,143),width=3)
im.save(root/'fredo-channel-banner.png',optimize=True)
print('Created 2560 x 1440 channel banner with centered mobile-safe text.')
