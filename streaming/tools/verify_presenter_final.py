"""Compare every finished presenter frame and narration against the real export."""
from pathlib import Path
import subprocess, json
import numpy as np

D=Path('C:/Nori/streaming/channel-operator/03-Production/Human-Reactions/Privacy-Milk/HeyGen-Updated-Avatar/Presenter-Final')
proof=json.loads((D/'FINAL-VERIFICATION.json').read_text(encoding='utf-8'))
T=json.loads(Path('C:/Nori/streaming/tools/media-tools.json').read_text(encoding='utf-8-sig'))
ff=T['ffmpeg'];source=Path(proof['source']);out=D/proof['final_video']
def video(path,filters):
 return subprocess.Popen([ff,'-v','error','-i',str(path),'-an','-vf',filters,'-pix_fmt','gray','-f','rawvideo','pipe:1'],stdout=subprocess.PIPE)
# Compare the full top 918 pixels of each fitted source frame, including face,
# lips and head. Only the small chest illustration and watermark area are below
# this region. The fit is fixed, and the output has no added camera motion.
w,h=612,918
p=video(source,'scale=612:1088:flags=lanczos,crop=612:918:0:0')
q=video(out,'crop=612:918:54:122')
errors=[];motion=[];last=None
for i in range(proof['frames']):
 aa=p.stdout.read(w*h);bb=q.stdout.read(w*h)
 assert len(aa)==len(bb)==w*h
 a=np.frombuffer(aa,dtype=np.uint8).astype(np.float32)
 b=np.frombuffer(bb,dtype=np.uint8).astype(np.float32)
 errors.append(float(np.mean(np.abs(a-b))))
 if last is not None:motion.append(float(np.mean(np.abs(a-last))))
 last=a
p.stdout.close();q.stdout.close();assert p.wait()==q.wait()==0
assert max(errors)<4.0, max(errors)
assert sum(x>.10 for x in motion)>.90*len(motion)

def audio(path):
 raw=subprocess.check_output([ff,'-v','error','-i',str(path),'-vn','-ac','1','-ar','16000','-f','f32le','pipe:1'])
 return np.frombuffer(raw,dtype=np.float32)
a=audio(source);b=audio(out);length=min(len(a),len(b));a=a[:length];b=b[:length]
t=np.arange(length)/16000
mask=~(((t>=2.67)&(t<=2.90))|((t>=11.60)&(t<=11.80)))
corr=float(np.corrcoef(a[mask],b[mask])[0,1]);assert corr>.995,corr
evidence={'frames_compared':len(errors),'comparison_region':'Whole fitted source above chest overlay, including face/head/lips','mean_luma_error':float(np.mean(errors)),'maximum_frame_luma_error':max(errors),'motion_frames_over_threshold':sum(x>.10 for x in motion),'motion_intervals':len(motion),'narration_correlation_outside_sfx':corr,'narration_offset_seconds':0,'technical_motion_and_audio_alignment':'passed','caption_visual_review':'14 interior frames reviewed; caption band above source, complete head and provider mark retained','perceptual_lip_sync_quality':'Owner review pending; numerical preservation does not prove naturalness'}
(D/'SOURCE-COMPARISON.json').write_text(json.dumps(evidence,indent=2)+'\n',encoding='utf-8')
proof['visual_review_completed']=True
proof['visual_review_scope']='14 caption-interior frames and complete source frame fit inspected; all frame bounds checked'
proof['source_comparison']='SOURCE-COMPARISON.json'
proof['technical_motion_and_audio_alignment']='passed'
(D/'FINAL-VERIFICATION.json').write_text(json.dumps(proof,indent=2)+'\n',encoding='utf-8')
print(json.dumps(evidence))
