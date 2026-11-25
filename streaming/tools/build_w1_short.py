"""Assemble the first Short from its five illustrated scenes and verified narration."""
import argparse
import json
from pathlib import Path
import re
import subprocess

ROOT = Path('C:/Nori/streaming')
VIDEO = ROOT / 'channel-operator/02-Calendar/Week-1/W1-S1'
TOOLS = json.loads((ROOT/'tools/media-tools.json').read_text(encoding='utf-8-sig'))
FFMPEG, FFPROBE = TOOLS['ffmpeg'], TOOLS['ffprobe']


def probe(path):
    return json.loads(subprocess.check_output([FFPROBE,'-v','error','-show_format','-show_streams','-of','json',str(path)]))


def main():
    global VIDEO
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--folder',type=Path,default=VIDEO,help='Calendar episode folder containing the scene illustrations.')
    parser.add_argument('--narration',type=Path,required=True)
    parser.add_argument('--captions',type=Path,required=True,help='Manually verified spoken-word SRT aligned to the narration.')
    parser.add_argument('--timing',type=Path,required=True,help='JSON list of five scene durations derived from the actual audio.')
    parser.add_argument('--output',type=Path,default=VIDEO/'final.mp4')
    parser.add_argument('--bed',type=Path,help='Original music and transition sound track, already mixed quietly.')
    args=parser.parse_args()
    VIDEO=args.folder
    for path in [args.narration,args.captions,args.timing]:
        if not path.is_file(): parser.error(f'Missing production input: {path}')
    if args.output.exists(): parser.error('Choose a new output filename; existing final media will not be overwritten.')
    if '-->' not in args.captions.read_text(encoding='utf-8-sig'):
        parser.error('Captions must be a real timed SRT file, not an untimed script.')
    durations=json.loads(args.timing.read_text(encoding='utf-8-sig'))
    if not isinstance(durations,list) or not 2<=len(durations)<=16 or any(not isinstance(d,(int,float)) or d<=0 for d in durations):
        parser.error('Timing must contain two to sixteen positive scene durations.')
    scene_count=len(durations)
    source=probe(args.narration)
    if not any(s['codec_type']=='audio' for s in source['streams']): parser.error('Narration has no audio stream.')
    duration=float(source['format']['duration'])
    if not 20<=duration<=60: parser.error(f'Narration duration is {duration:.2f}s; review pacing before rendering this Short.')
    if abs(sum(durations)-duration)>.2: parser.error('Scene timing does not match the actual narration duration.')
    captions_text=args.captions.read_text(encoding='utf-8-sig')
    caption_events=[]
    for match in re.finditer(r'(\d\d):(\d\d):(\d\d)[,.](\d\d\d)\s*-->\s*(\d\d):(\d\d):(\d\d)[,.](\d\d\d)\s*\n([^\n]+(?:\n(?!\s*\n|\d+\s*\n)[^\n]+)*)',captions_text):
        values=match.groups()
        start=sum(int(value)*scale for value,scale in zip(values[:4],[3600,60,1,.001]))
        end=sum(int(value)*scale for value,scale in zip(values[4:8],[3600,60,1,.001]))
        if not 0<=start<end<=duration+.2:
            parser.error('Caption timing falls outside the actual audio.')
        words=values[8].strip().splitlines()
        if len(words)>2: parser.error('Use at most two caption lines per cue.')
        def ass_time(seconds):
            ticks=round(seconds*100)
            return f'{ticks//360000}:{ticks//6000%60:02}:{ticks//100%60:02}.{ticks%100:02}'
        safe=r'\N'.join(line.replace('{','').replace('}','').replace('\\','') for line in words)
        caption_events.append(f'Dialogue: 0,{ass_time(start)},{ass_time(end)},Default,,0,0,0,,{safe}')
    if not caption_events: parser.error('No valid caption cues were found.')
    ass_path=args.output.with_suffix('.ass')
    header='''[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 0

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Segoe UI,52,&H00FFFFFF,&H00FFFFFF,&H001B110A,&H001B110A,-1,0,0,0,100,100,0,0,1,4,0,2,85,160,330,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
'''
    ass_path.parent.mkdir(parents=True,exist_ok=True)
    ass_path.write_text(header+'\n'.join(caption_events)+'\n',encoding='utf-8')
    captions=ass_path.resolve().as_posix().replace(':',r'\:').replace("'",r"\'")
    argv=[FFMPEG,'-v','error']
    for index,seconds in enumerate(durations,start=1):
        scene=VIDEO/'visuals'/f'scene-{index:02d}.png'
        if not scene.is_file(): parser.error(f'Missing scene artwork: {scene}')
        argv += ['-loop','1','-framerate','30','-t',str(seconds),'-i',str(scene)]
    argv += ['-i',str(args.narration)]
    if args.bed:
        if not args.bed.is_file(): parser.error('Missing original sound track.')
        argv += ['-i',str(args.bed)]
    streams=[]
    filters=[]
    for index,seconds in enumerate(durations):
        filters.append(f"[{index}:v]zoompan=z='min(1+on*0.00005,1.018)':x='iw/2-iw/zoom/2':y='ih/2-ih/zoom/2':d=1:s=1080x1920:fps=30,setsar=1,trim=duration={seconds},setpts=PTS-STARTPTS[v{index}]")
        streams.append(f'[v{index}]')
    filters.append(''.join(streams)+f'concat=n={scene_count}:v=1:a=0[sequence]')
    filters.append(f"[sequence]ass=filename='{captions}'[finalv]")
    # Normalize from measurements of this actual narration, rather than assumed levels.
    measured=subprocess.run([FFMPEG,'-hide_banner','-i',str(args.narration),'-af','loudnorm=I=-16:TP=-1:LRA=11:print_format=json','-f','null','-'],capture_output=True,text=True,check=True)
    start=measured.stderr.rfind('{'); end=measured.stderr.rfind('}')
    levels=json.loads(measured.stderr[start:end+1])
    normalize=(f"loudnorm=I=-16:TP=-1:LRA=11:measured_I={levels['input_i']}:measured_TP={levels['input_tp']}:"
               f"measured_LRA={levels['input_lra']}:measured_thresh={levels['input_thresh']}:offset={levels['target_offset']}:linear=true")
    if args.bed:
        filters.append(f'[{scene_count}:a]{normalize},aresample=48000[voice]')
        filters.append('[voice]asplit=2[vocal][duck]')
        filters.append(f'[{scene_count+1}:a]aresample=48000[bed]')
        filters.append('[bed][duck]sidechaincompress=threshold=0.025:ratio=4:attack=15:release=150[quietbed]')
        filters.append('[vocal][quietbed]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.89:level=false[finala]')
    else:
        filters.append(f'[{scene_count}:a]{normalize},aresample=48000[finala]')
    argv += ['-filter_complex',';'.join(filters),'-map','[finalv]','-map','[finala]','-c:v','libx264','-preset','medium','-crf','18','-pix_fmt','yuv420p','-c:a','aac','-b:a','192k','-t',str(duration),'-movflags','+faststart',str(args.output)]
    args.output.parent.mkdir(parents=True,exist_ok=True)
    subprocess.run(argv,check=True)
    final=probe(args.output)
    video=next(s for s in final['streams'] if s['codec_type']=='video')
    audio=next(s for s in final['streams'] if s['codec_type']=='audio')
    assert (video['width'],video['height'])==(1080,1920) and video['codec_name']=='h264'
    assert audio['codec_name']=='aac' and abs(float(final['format']['duration'])-duration)<.2
    subprocess.run([FFMPEG,'-v','error','-xerror','-i',str(args.output),'-f','null','-'],check=True,stderr=subprocess.PIPE)
    final['quality_status']='Technical checks passed; full watching, listening, words and applicable publishing rights must be checked before upload.'
    args.output.with_suffix('.verification.json').write_text(json.dumps(final,indent=2),encoding='utf-8')
    print(f'Rendered and technically verified: {args.output}')


if __name__=='__main__': main()
