"""Build review sheets and verify every calendar scene's dimensions."""
import json
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

root = Path('C:/Nori/streaming/channel-operator')
out = root/'03-Production/Visual-Review'
out.mkdir(exist_ok=True)
font = ImageFont.truetype('C:/Windows/Fonts/segoeui.ttf', 19)
results = []
for folder in sorted((root/'02-Calendar').glob('Week-*/*')):
    scenes = sorted((folder/'visuals').glob('scene-*.png'))
    if not scenes:
        continue
    expected = (1920,1080) if folder.name.endswith('MAIN') else (1080,1920)
    cell_w, cell_h = (480,315) if expected[0] > expected[1] else (270,510)
    cols = 3 if expected[0] > expected[1] else 4
    sheet = Image.new('RGB',(cols*cell_w,((len(scenes)+cols-1)//cols)*cell_h),'#0b111b')
    draw = ImageDraw.Draw(sheet)
    for i,path in enumerate(scenes):
        with Image.open(path) as im:
            assert im.size == expected, (path,im.size,expected)
            im = im.convert('RGB')
            im.thumbnail((cell_w-20,cell_h-40))
            x,y = (i%cols)*cell_w,(i//cols)*cell_h
            sheet.paste(im,(x+(cell_w-im.width)//2,y+30))
            draw.text((x+10,y+5),f'{folder.name} / {i+1}',font=font,fill='white')
    output = out/(folder.name+'.jpg')
    sheet.save(output,quality=93)
    results.append({'video_id':folder.name,'scenes':len(scenes),'dimensions':expected,'contact_sheet':str(output),'visual_review':'pending'})
assert len(results)==12
assert sum(row['scenes'] for row in results)==108
(out/'checks.json').write_text(json.dumps(results,indent=2),encoding='utf-8')
print('12 review sheets created; 108 scene dimensions verified.')
