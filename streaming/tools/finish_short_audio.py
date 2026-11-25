import argparse,json,subprocess
from pathlib import Path
parser=argparse.ArgumentParser();parser.add_argument('video',type=Path);parser.add_argument('--compress',action='store_true');parser.add_argument('--strong-compress',action='store_true');parser.add_argument('--revision',default='');args=parser.parse_args();video=args.video
tools=json.loads(Path('C:/Nori/streaming/tools/media-tools.json').read_text(encoding='utf-8-sig'))
prefix=('acompressor=threshold=0.09:ratio=4:attack=1:release=90:makeup=1,' if args.strong_compress else ('acompressor=threshold=0.18:ratio=2:attack=5:release=60:makeup=1,' if args.compress else ''))
result=subprocess.run([tools['ffmpeg'],'-hide_banner','-i',str(video),'-af',prefix+'loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json','-f','null','-'],capture_output=True,text=True,check=True)
levels=json.loads(result.stderr[result.stderr.rfind('{'):result.stderr.rfind('}')+1])
filter=prefix+(f"loudnorm=I=-16:TP=-1.5:LRA=11:measured_I={levels['input_i']}:measured_TP={levels['input_tp']}:measured_LRA={levels['input_lra']}:measured_thresh={levels['input_thresh']}:offset={levels['target_offset']}:linear=false")
output=video.with_name(video.stem+'-normalized.mp4')
subprocess.run([tools['ffmpeg'],'-v','error','-i',str(video),'-c:v','copy','-af',filter,'-ar','48000','-c:a','aac','-b:a','192k','-movflags','+faststart',str(output)],check=True)
subprocess.run([tools['ffmpeg'],'-v','error','-xerror','-i',str(output),'-f','null','-'],check=True)
superseded=Path('C:/Nori/streaming/tools/verification/superseded-w1-edits')/(video.stem+'-before-final-audio'+args.revision+'.mp4')
assert not superseded.exists();video.replace(superseded);output.replace(video)
probe=json.loads(subprocess.check_output([tools['ffprobe'],'-v','error','-show_format','-show_streams','-of','json',str(video)]))
probe['quality_status']='Final audio normalization and complete MP4 decode passed. Frame and spoken-word review performed separately.'
video.with_suffix('.verification.json').write_text(json.dumps(probe,indent=2),encoding='utf-8')
print(json.dumps({'final_audio_normalized':str(video),'original_export_preserved':str(superseded)}))
