import json, subprocess, hashlib
from pathlib import Path
P=Path('C:/Nori/streaming/channel-operator/02-Calendar/Week-4/W4-MAIN/Fred-MiniMax')
T=json.loads(Path('C:/Nori/streaming/tools/media-tools.json').read_text(encoding='utf-8-sig'))
for name in ['captions.srt','captions.ass']:
    p=P/name
    text=p.read_text().replace("arrows aren't the receive.","arrows aren't the receipt.")
    p.write_text(text,encoding='utf-8')
duration=json.loads((P/'narration-fred.transcript.json').read_text())['duration']
out=P/'Nori-Where-Is-The-Actual-Work-Fred-Final.mp4'
assert not out.exists()
escaped=(P/'captions.ass').as_posix().replace(':','\\:')
graph=f"[0:v][2:v]overlay=55:360:enable='lt(t,{duration-20})':shortest=1[v];[v]ass=filename='{escaped}',format=yuv420p[out]"
subprocess.run([T['ffmpeg'],'-v','error','-i',str(P/'render-work-clear/base.mp4'),'-i',str(P/'narration-fred.wav'),'-stream_loop','-1','-framerate','8','-i',str(P.parent/'clear-visuals/robot/frame-%03d.png'),'-filter_complex',graph,'-map','[out]','-map','1:a','-t',str(duration),'-c:v','libx264','-preset','veryfast','-crf','19','-threads','6','-c:a','aac','-b:a','192k','-ar','48000','-movflags','+faststart',str(out)],check=True)
subprocess.run([T['ffmpeg'],'-v','error','-xerror','-i',str(out),'-f','null','-'],check=True)
probe=json.loads(subprocess.check_output([T['ffprobe'],'-v','error','-show_format','-show_streams','-of','json',str(out)]))
(P/'FINAL-RENDER-VERIFICATION.json').write_text(json.dumps({'probe':probe,'full_decode_passed':True,'caption_receipt_corrected':True,'video_sha256':hashlib.sha256(out.read_bytes()).hexdigest(),'visual_review':'pending','published':False},indent=2))
print(json.dumps({'video':str(out),'full_decode_passed':True}))
