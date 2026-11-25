const fs=require('fs'),path=require('path');const root=__dirname;
let preview=fs.readFileSync(path.join(root,'preview.html'),'utf8');
if(!preview.includes('data-scene="coding-monitor-1"'))preview=preview.replace('</nav>',['coding','nori-demo'].flatMap(k=>[1,2].map(n=>`<button data-scene="${k}-monitor-${n}">${k==='coding'?'Coding':'Nori Demo'} · Monitor ${n}</button>`)).join('')+'</nav>');
preview=preview.replace('Your selected window','Your selected window').replace('Coding and Demo show a placeholder here.','Coding and Demo show a placeholder here; the monitor scenes capture the selected entire screen in OBS.');
fs.writeFileSync(path.join(root,'preview.html'),preview);
let producer=fs.readFileSync(path.join(root,'producer.html'),'utf8');
if(!producer.includes("'Coding — Monitor 1':"))producer=producer.replace("function save(){",`Object.assign(cues,{'Coding — Monitor 1':'In OBS: Coding — Monitor 1. Everything on Monitor 1 is captured. Move OBS and private windows to Monitor 2. Unmute the intended audio only when ready.','Coding — Monitor 2':'In OBS: Coding — Monitor 2. Everything on Monitor 2 is captured. Move OBS and private windows to Monitor 1. Unmute the intended audio only when ready.','Nori Demo — Monitor 1':'In OBS: Nori Demo — Monitor 1. Use public demo data on Monitor 1; keep OBS/private windows on Monitor 2.','Nori Demo — Monitor 2':'In OBS: Nori Demo — Monitor 2. Use public demo data on Monitor 2; keep OBS/private windows on Monitor 1.'});
function save(){`);
producer=producer.replace('Public coding/demo windows selected and reviewed','Captured monitor cleared of private windows and notifications').replace('Use this on your second monitor beside OBS.','Keep this panel and OBS on the monitor you are not capturing.');
fs.writeFileSync(path.join(root,'producer.html'),producer);
fs.writeFileSync(path.join(root,'WORKSPACE.txt'),`NORI / ANIMATED STREAM WORKSPACE
Updated September 30, 2026.
Active OBS collection: Nori Animated Monitors. Imported and selected in OBS.
Original Untitled OBS collection preserved. YouTube profile/account not changed.
All production assets remain under C:\\Nori\\streaming; Nori core not modified.

10 scenes: Starting Soon; Coding — Monitor 1; Coding — Monitor 2;
Nori Demo — Monitor 1; Nori Demo — Monitor 2; Coding; Nori Demo;
Discord Community; Break; Ending.
The plain Coding/Demo scenes are reserved window layouts without a bound window.
Both full-monitor captures were inspected in OBS and display different monitors.
Both monitors are 2560x1440, fitted proportionally into the 1080p scene frame.
Canvas/output frame rate currently 30 fps. Fade transition 350 ms.

Animation: floating/tilting Nori symbol, moving grid, atmospheric light, twinkling
stars, cyan sweep. Runs locally in OBS Browser Source, without external services.
This is animated artwork made from the rendered symbol, not a 3D model file.

MIC — SteelSeries Sonar: separate source, muted; signal observed in mixer.
GUESTS — Discord: separate application-audio source, muted. Discord was not
running during setup, so a live guest audio test is still required.
No global desktop audio in the new collection. No camera added.
Starting Soon, Break and Ending contain no mic or guest source.
Music licensing notes saved; no track files downloaded/loaded yet.
Streaming and recording were not started. OBS is left on Starting Soon.

preview.html: animated scene previews
producer.html: local manual producer desk; does not remotely operate OBS
obs/Nori-Animated-Monitors.json: imported collection backup
LIVE-SETUP.txt: operation notes and outstanding sound check
assets/nori-symbol-3d.png: transparent Nori artwork
music/LICENSE-NOTES.txt: verified provider license reference

OBS's YouTube control-panel web dock currently shows a sign-in page. This does
not by itself establish the state of OBS's stream-service authorization. No login
or broadcasting was attempted. User may need to sign into the dock themselves.
`);
console.log('Updated preview, producer cues and workspace state.');
