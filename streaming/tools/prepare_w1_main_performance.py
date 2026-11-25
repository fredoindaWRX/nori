import hashlib
import json
import re
from pathlib import Path
import shutil

root = Path('C:/Nori/streaming/channel-operator')
folder = root / '02-Calendar/Week-1/W1-MAIN'
assert not (folder / 'publication-record.json').exists()
backup = Path('C:/Nori/streaming/tools/verification/pre-performance-revision/W1-MAIN')
backup.mkdir(parents=True, exist_ok=True)
for name in ('narration.txt', 'SHOT-PLAN.json', 'production-package.txt'):
    target = backup / name
    if not target.exists():
        shutil.copy2(folder / name, target)

sections = [
('STOP THE MIRROR', 'Your OBS preview is eating itself. Let\'s fix that. First, the good news: your computer has not opened a portal. OBS is showing a screen that contains OBS. That preview gets captured again, then again, and suddenly your stream has a family tree. The fix is to give your two monitors different jobs. I\'ll show you what to check, how the scenes are organized, and how to catch a bad setup before viewers do.'),
('GIVE EACH SCREEN A JOB', 'Think of one monitor as the stage. That is where the game, the project, or the thing you are explaining goes. The other monitor is the control room: OBS, your notes, and the buttons you need during a stream. The stage can switch between your two displays. The important part is keeping OBS out of whichever display you are capturing. Adding a fancy border around the tunnel just gives the tunnel a fancy border.'),
('IDENTIFY THE DISPLAY', 'Start with the capture source, not the scene name. Open its Properties and look at the selected display. Monitor numbers can get confusing after you reconnect screens, so give yourself a visual check. Put a harmless test window on one screen. Does that window appear in the preview? Good. You know what the source is actually showing. Check the other screen the same way. A label saying Monitor One is a clue. The preview is the answer.'),
('SELECT YOUR WORK SCREEN', 'Here is how this setup is organized. There are Coding scenes for Monitor One and Monitor Two, plus Nori Demo scenes for both. That gives me a quick way to choose the work screen without rebuilding the whole layout. Before you switch, check where OBS is sitting. If OBS is on Monitor One, share Monitor Two. If you move OBS onto Monitor Two, share Monitor One. Move the controls, then check the preview. No tunnel? We have escaped the portal.'),
('CHECK THE SOURCE', 'If it still repeats, open the display capture Properties again. Make sure the source points to your work screen. Moving OBS to another monitor does not help if the capture is still aimed at the monitor where OBS ended up. Also check that the capture source is visible in the scene. A good scene name cannot rescue the wrong source. This is one of those boring checks that saves you a very entertaining problem.'),
('FIT THE FRAME', 'Now check the size. Your desktop and your streaming canvas may have different resolutions. Right-click the capture source and look under Transform. For a plain full-screen scene, Fit to Screen is a useful starting point. For a layout with a smaller content frame, fit the capture inside that space instead. Do not stretch the picture just to fill every pixel. Your windows should still look like windows. If a circle turns into an egg, the layout needs another look.'),
('CHECK ALL FOUR EDGES', 'Check the top, bottom, left, and right edges. Can viewers see the controls you are talking about? Is the text readable? Is the overlay covering a button or cutting off the bottom of the app? You can have a perfectly working capture that is still hard to watch. Make the important part bigger, and keep the decoration out of its way. Viewers came for the project. They should not need a microscope to follow it.'),
('CLEAR WHAT YOU SHARE', 'Before recording, clear the display you are about to share. Full-display capture shows what is on that screen, including any unrelated window you drag into it. Keep private controls and notifications off the work screen. And remember that switching monitors changes what your audience sees. Treat it like turning a camera toward a different part of the room. Take one second to check the shot before you make the switch.'),
('RECORD A REAL REHEARSAL', 'Then make a short local recording. You do not have to go live to test this. Show the first work screen, switch to the second, and visit your Break scene. Stop recording and open the actual file. Check the picture, the transitions, and the sound. A moving audio meter is useful, but the recording is what your audience will hear. If your microphone or Discord guests disappear, fix that before the stream. A rehearsal is cheaper than live troubleshooting.'),
('BREAK MEANS BREAK', 'Here is the actual Starting Soon to Break recording from this setup. The pictures change, and these two scenes contain graphics only. That is the scene design; it is not proof that every possible audio source is muted. For your own setup, check global audio sources and make a recording with the microphone and guest audio active before you trust a Break scene. A pause screen should not accidentally become a podcast from your kitchen.'),
('KEEP THE JOBS SEPARATE', 'The routine is simple: choose the work screen, keep OBS on the other display, check the framing, and test the recorded file. Repeat the preview check whenever you move windows or change scenes. Once each monitor has a job, switching feels a lot less chaotic. And your stream can finally show one copy of you doing the work. One is plenty.'),
('WHAT SHOULD WE BUILD NEXT?', 'If your picture is sorted but your audio is a mess, watch the microphone and Discord video next. Tell me which part of your setup is fighting you: capture, framing, or sound. Subscribe for more practical builds and the progress on Nori. I want the setup to work, and I want the process to be fun to watch. Now go close the portal.')
]
plan = json.loads((folder/'SHOT-PLAN.json').read_text(encoding='utf-8-sig'))
assert len(sections) == len(plan['shots'])
for shot, (title, voice) in zip(plan['shots'], sections):
    shot.update(title=title, voice_text=voice)
    shot.pop('start', None)
    shot.pop('end', None)
narration='\n\n'.join(v for _,v in sections)
(folder/'narration.txt').write_text(narration+'\n',encoding='utf-8')
plan.update(script_sha256=hashlib.sha256(narration.encode()).hexdigest(), status='Conversational long-form script revised; actual narration generation and live demonstration assembly in progress.', timing_status='Pending actual generated speech. No estimated chapter times are final.', performance_direction='Conversational, clear, warm; let the jokes land with brief pauses; no announcer voice or forced shouting.')
plan['required_remaining_inputs']=['Complete own-voice narration and word alignment','Relevant live demonstration footage and visual edit','Configured owner avatar for the originally requested HeyGen presenter format','Full final MP4 review and immediate Public publication']
(folder/'SHOT-PLAN.json').write_text(json.dumps(plan,indent=2,ensure_ascii=False)+'\n',encoding='utf-8')
perf = folder/'voice-performance-inputs'
perf.mkdir(exist_ok=True)
blocks=[]
for i, group in enumerate([sections[0:3],sections[3:6],sections[6:9],sections[9:12]],start=1):
    plain='\n\n'.join(v for _,v in group)
    voiced='[conversational, clear, unhurried] '+plain
    (perf/f'speech-{i:02d}.txt').write_text(plain+'\n',encoding='utf-8')
    (perf/f'performance-{i:02d}.txt').write_text(voiced+'\n',encoding='utf-8')
    blocks.append({'index':i,'spoken_file':f'voice-performance-inputs/speech-{i:02d}.txt','performance_file':f'voice-performance-inputs/performance-{i:02d}.txt','words':len(plain.split()),'characters':len(voiced),'status':'Not yet generated'})
assert ' '.join(' '.join((perf/f'speech-{i:02d}.txt').read_text(encoding='utf-8').split()) for i in range(1,5))==' '.join(narration.split())
(perf/'GENERATION-RECORD.json').write_text(json.dumps({'video_id':'W1-MAIN','voice_name':'fred','voice_id':'b27ff51a95a14d02973baec32ba7a643','speech_model':'S2.1 Pro Free','script_sha256':plan['script_sha256'],'blocks':blocks},indent=2)+'\n',encoding='utf-8')
print(json.dumps({'video_id':'W1-MAIN','words':len(narration.split()),'blocks':blocks,'script_integrity':'passed'}))
