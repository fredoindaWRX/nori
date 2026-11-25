"""Create an editable voice master and a checked, clear narration export."""
import argparse, hashlib, json, shutil, subprocess
from pathlib import Path

p = argparse.ArgumentParser()
p.add_argument('source', type=Path)
p.add_argument('destination', type=Path)
p.add_argument('--tempo', type=float, default=0.94)
a = p.parse_args()
assert 0.85 <= a.tempo <= 1.0
assert a.source.is_file()
a.destination.mkdir(parents=True, exist_ok=True)
tools = json.loads(Path('C:/Nori/streaming/tools/media-tools.json').read_text(encoding='utf-8-sig'))
raw = a.destination / 'fish-original.mp3'
assert not raw.exists(), 'Preserve previous generations; use a new destination.'
shutil.copy2(a.source, raw)
chain = (f'atempo={a.tempo},highpass=f=75,'
         'equalizer=f=250:t=q:w=0.8:g=-2,'
         'equalizer=f=3000:t=q:w=0.8:g=2,'
         'acompressor=threshold=0.18:ratio=2:attack=10:release=100:makeup=1')
measure = subprocess.run([tools['ffmpeg'], '-hide_banner', '-i', str(raw),
    '-af', chain + ',loudnorm=I=-16:TP=-2:LRA=8:print_format=json', '-f', 'null', '-'],
    capture_output=True, text=True, check=True)
levels = json.loads(measure.stderr[measure.stderr.rfind('{'):measure.stderr.rfind('}')+1])
normalize = (f",loudnorm=I=-16:TP=-2:LRA=8:measured_I={levels['input_i']}:"
    f"measured_TP={levels['input_tp']}:measured_LRA={levels['input_lra']}:"
    f"measured_thresh={levels['input_thresh']}:offset={levels['target_offset']}:linear=false")
master = a.destination / 'Fredo-Clear-Narration.wav'
subprocess.run([tools['ffmpeg'], '-v', 'error', '-i', str(raw), '-af', chain + normalize,
    '-ar', '48000', '-ac', '1', '-c:a', 'pcm_s24le', str(master)], check=True)
export = a.destination / 'Fredo-Clear-Narration.mp3'
subprocess.run([tools['ffmpeg'], '-v', 'error', '-i', str(master), '-c:a', 'libmp3lame',
    '-b:a', '192k', str(export)], check=True)
subprocess.run([tools['ffmpeg'], '-v', 'error', '-xerror', '-i', str(export),
    '-f', 'null', '-'], check=True)
final = subprocess.run([tools['ffmpeg'], '-hide_banner', '-i', str(export), '-af',
    'loudnorm=I=-16:TP=-2:LRA=8:print_format=json', '-f', 'null', '-'],
    capture_output=True, text=True, check=True)
final_levels = json.loads(final.stderr[final.stderr.rfind('{'):final.stderr.rfind('}')+1])
probe = json.loads(subprocess.check_output([tools['ffprobe'], '-v', 'error',
    '-show_format', '-show_streams', '-of', 'json', str(export)]))
record = {'voice_id': 'b27ff51a95a14d02973baec32ba7a643',
    'generation_model': 's2.1-pro-free', 'filters': chain + normalize,
    'source_sha256': hashlib.sha256(raw.read_bytes()).hexdigest(),
    'export_sha256': hashlib.sha256(export.read_bytes()).hexdigest(),
    'full_decode_passed': True, 'measured_export': final_levels, 'probe': probe,
    'subjective_clarity': 'Awaiting owner listening; measurements do not establish voice likeness.'}
(a.destination / 'AUDIO-QA.json').write_text(json.dumps(record, indent=2), encoding='utf-8')
print(json.dumps({'export': str(export), 'duration': probe['format']['duration'],
                  'loudness': final_levels['input_i'], 'true_peak': final_levels['input_tp']}))
