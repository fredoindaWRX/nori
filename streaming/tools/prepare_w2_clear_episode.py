"""Prepare the complete mic/Discord episode against observed OBS configuration."""
import hashlib,json,shutil
from pathlib import Path

P=Path('C:/Nori/streaming/channel-operator/02-Calendar/Week-2/W2-MAIN')
backup=Path('C:/Nori/streaming/tools/verification/pre-performance-revision/W2-MAIN')
backup.mkdir(parents=True,exist_ok=True)
for name in ['narration.txt','SHOT-PLAN.json']:
    assert not (backup/name).exists(), 'Original backup already exists; inspect before rerunning.'
    shutil.copy2(P/name,backup/name)
rows=[
('ONE LOUD FRIEND', "Put your microphone and Discord on separate volume controls. Otherwise, one loud friend takes over the whole stream. Give your microphone one source. Give Discord another. Now you can turn your friend down without turning yourself down. Finally. A volume knob for that one guy."),
('TWO CONTROLS, TWO JOBS', "Here is the goal. Your voice stays clear. Your guests stay easy to hear. And when somebody starts eating chips directly into the microphone, you have an actual control for that. A single combined source makes every adjustment a group decision. Separate sources give each sound its own job. But there is one catch. A moving meter does not prove the recording sounds right. We are going to check the source, check the destination, and then listen to the file."),
('THE SETUP ON THIS COMPUTER', "On this computer, the microphone source uses SteelSeries Sonar Microphone. The guest source targets the Discord application. Their names are Mic and Guests in the instructions, because nobody wants to solve a device-name escape room during a stream. The saved collection has both sources muted right now. This is a walkthrough of the configuration. It is not a recording of a real guest conversation. Before your own stream, you still need the short listening test we will do at the end."),
('PICK THE ACTUAL MICROPHONE', "Start with the microphone source in OBS. Open its properties and select the microphone you actually use. In this setup, that is the Sonar microphone endpoint. Speak from your normal position. Pause. Then say another sentence. Watch the microphone meter respond to your voice. If a different source moves instead, stop and check the device selection. If normal speech pushes the meter into the red, turn the level down before you add effects. The goal is a clear voice, not a red bar with confidence."),
('KEEP THE VOICE NATURAL', "Now check what reaches OBS before you process it again. Sonar may already be changing the microphone sound. Listen for heavy noise removal, a thin voice, or an effect you forgot to turn off. Start with a natural voice and make small changes. Stacking several aggressive filters can make every word sound like it was assembled in a microwave. Record a sentence with the processing on, then compare it with a simpler setting. Choose what sounds clearer. A longer filter list does not automatically make a better microphone."),
('TARGET DISCORD', "For guests, use an application audio capture source and check its target. This collection points at Discord. Make sure the intended app is running, and inspect the source properties if guests are missing. Adding three more sources before checking the first one usually creates three more mysteries. Use headphones during the test. Otherwise, your microphone can pick up the guest audio coming from your speakers. Then your friend gets to appear twice. Once as a guest. Once as a haunted echo."),
('CHECK ONE VOICE AT A TIME', "For the real test, have the guest speak while you stay quiet. Watch the guest meter. Then speak while the guest stays quiet. Watch the microphone meter. Adjust the guest source and confirm your own level stays steady. Mute the microphone and check that you have muted the microphone. Repeat for the guest source. Keep the instructions boring and the jokes in the edit. You want to find mistakes while you are testing, before your audience starts typing that they cannot hear anybody."),
('DO NOT CAPTURE IT TWICE', "Next, look for duplicate capture. If Discord is coming through the application source and through a broad desktop audio source, the same sound can arrive by two routes. That is a reason to inspect the routing, not a reason to blame Discord immediately. This saved collection has no default desktop audio source. That reduces one obvious route for duplicate sound. It does not prove every other setting is correct. Check the sources you actually use, including sources hidden inside scenes. One guest does not need a backup guest made of echo."),
('CONTROLS ARE NOT RECORDING TRACKS', "Here is the part that trips people up. Separate mixer controls and separate recording tracks are different things. The saved source assignments put the microphone on tracks one and two. Guests are on tracks one and three. But this OBS profile is in Simple output mode and is set to record track one only. So the saved file has the shared mix selected. Those other source assignments do not magically create extra audio tracks. It is like putting three plates on the table and only serving one. The configuration has to agree at both ends."),
('PLAN THE FILE YOU WANT', "If you want a shared mix plus individual voices for editing, choose a recording setup that saves the tracks you need. Check Advanced Audio Properties for the source assignments. Then check the recording output settings for the selected tracks. In the arrangement shown here, track one is the shared mix, track two is the microphone, and track three is the guests. That is the intended arrangement, not a verified multitrack recording from this computer. After changing settings, make a short file and open it in an editor that can inspect each audio track."),
('THE RECORDING IS THE WITNESS', "Use a simple test. Record your voice alone. Record the guest alone. Then record a short exchange. Try each mute control. Switch to your break scene and return. Stop the recording and listen with headphones. Check for missing speech, a doubled voice, crackling, and a guest who is much louder than you. If you are saving separate tracks, listen to those separately too. Change one thing, and repeat the part that failed. The meter is a clue. The recording is the witness. And the witness gets the final vote."),
('NEXT BUILD', "That gives you two useful things. Clear controls while you stream, and evidence of what the saved file actually contains. Keep music underneath the voices, not competing with them. Leave some room for people to get louder when something funny happens. The next build gets into Nori and the checks that prove an AI system is actually ready. For the monitor setup, use the video on screen. Subscribe for more projects, practical creator fixes, and the occasional volume knob for that one guy.")
]
text='\n\n'.join(t for _,t in rows)+'\n'
(P/'narration.txt').write_text(text,encoding='utf-8')
shots=[{'index':i+1,'title':title,'voice_text':t,'asset':f'edit-plates/scene-{i+1:02}.png',
    'asset_role':'Original explanatory illustration; actual configuration claims verified from saved OBS files.'} for i,(title,t) in enumerate(rows)]
record={'video_id':'W2-MAIN','voice_provider':'Fish Audio','model_id':'b27ff51a95a14d02973baec32ba7a643',
    'generation_model':'s2.1-pro-free','script_sha256':hashlib.sha256(text.encode()).hexdigest(),
    'shots':shots,'word_count':len(text.split()),'status':'Complete script; narration and video generation in progress',
    'configuration_evidence':{'sources_muted':True,'mic_mixers_bitmask':3,'guest_mixers_bitmask':5,
    'output_mode':'Simple','recording_tracks':'1','default_desktop_audio_sources':0},
    'not_yet_verified':['Real microphone and guest recording','Separate recording tracks','Owner approval of new voice clarity'],
    'editing_direction':'Original relatable memes, own-channel cutaways, kinetic words; subdued music under clear narration.'}
(P/'SHOT-PLAN.json').write_text(json.dumps(record,indent=2),encoding='utf-8')
voice=P/'voice-performance-inputs'; voice.mkdir(exist_ok=True)
chunks=[]
for n in range(4):
    selected=shots[n*3:n*3+3]
    plain='\n\n'.join(s['voice_text'] for s in selected)
    performance='[calm] '+plain
    (voice/f'speech-{n+1:02}.txt').write_text(plain+'\n',encoding='utf-8')
    (voice/f'performance-{n+1:02}.txt').write_text(performance+'\n',encoding='utf-8')
    chunks.append({'chunk':n+1,'scenes':[s['index'] for s in selected],'words':len(plain.split()),'status':'Awaiting generation'})
(voice/'GENERATION-RECORD.json').write_text(json.dumps({'voice_id':record['model_id'],'model':'s2.1-pro-free','chunks':chunks},indent=2),encoding='utf-8')
print(json.dumps({'episode':'W2-MAIN','words':record['word_count'],'shots':len(shots),'chunks':chunks}))
