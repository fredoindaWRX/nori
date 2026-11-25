"""Produce a separate finished cut with readable captions; preserve source performance."""
from pathlib import Path
import shutil

base = Path('C:/Nori/streaming/channel-operator/03-Production/Human-Reactions/Privacy-Milk/HeyGen-Updated-Avatar')
revision = base / 'Readable-Revision'
revision.mkdir(exist_ok=True)
source = revision / 'HeyGen-Owner-Avatar-Original.mp4'
if not source.exists():
    shutil.copy2(base / source.name, source)
script = Path('C:/Nori/streaming/tools/build_heygen_privacy_short.py').read_text(encoding='utf-8')
script = script.replace("D=Path('C:/Nori/streaming/channel-operator/03-Production/Human-Reactions/Privacy-Milk/HeyGen-Updated-Avatar')", f'D=Path({str(revision.as_posix())!r})')
start = script.index('cues=[')
end = script.index('\n\ndef stamp', start)
script = script[:start] + """cues=[
 (0,2.60,'Your group chat did not apply\\nto be your co-host.'),
 (3.14,4.90,'If OBS captures\\nyour whole monitor,'),
 (5.28,6.54,'private windows\\ncan show up too.'),
 (7.00,8.40,'Use Game Capture\\nwhen it works,'),
 (8.70,11.50,'then record ten seconds\\nand watch it before going live.'),
 (12.08,13.32,'Save the chaos\\nfor the game.')]
""" + script[end:]
script = script.replace("d.text((360,64),s,font=caption_font,fill=color,anchor='mm',stroke_width=3,stroke_fill='#07101b')", "d.multiline_text((360,82),s,font=caption_font,fill=color,anchor='mm',align='center',spacing=8,stroke_width=3,stroke_fill='#07101b')")
script = script.replace('if 7<=t<8.40:', 'if 7<=t<11.50:')
script = script.replace("'caption_cues':14", "'caption_cues':len(cues)")
script = script.replace("'caption_timing_source':'Local word timestamps from completed source audio'", "'caption_timing_source':'Complete phrase groups bounded by measured source word timestamps'")
script = script.replace("'music_bed':False", "'readability_revision':True,'capture_diagram_duration_seconds':4.5,'music_bed':False")
exec(compile(script, str(Path(__file__)), 'exec'))
