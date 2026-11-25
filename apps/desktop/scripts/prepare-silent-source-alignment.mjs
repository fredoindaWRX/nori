import assert from 'node:assert/strict';
import{readFileSync,writeFileSync,mkdirSync,existsSync}from'node:fs';
import{createHash}from'node:crypto';
import{createRequire}from'node:module';
const ts=createRequire(import.meta.url)('typescript'),base='C:/Nori/apps/desktop/',stage='C:/Nori/.work/silent-source-alignment';if(!existsSync(stage))mkdirSync(stage);
const hash=s=>createHash('sha256').update(s).digest('hex');
const changes=[];
function add(path,next){const before=readFileSync(base+path);assert.equal(ts.createSourceFile(path,next,ts.ScriptTarget.Latest,true,path.endsWith('.tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS).parseDiagnostics.length,0);const n=changes.length;writeFileSync(stage+'/'+n+'.next',next);changes.push({path:base+path,before:hash(before),after:hash(Buffer.from(next)),source:stage+'/'+n+'.next',backup:stage+'/'+n+'.previous'})}
add('src/ui/Ignition.tsx',`import { useEffect, useRef } from 'react'\n\n/** Enter the same Nori workspace without an introduction or audio. */\nexport function Ignition({ onSkip }: { onStart: () => void; onSkip: () => void }) {\n  const open = useRef(onSkip)\n  open.current = onSkip\n  useEffect(() => { open.current() }, [])\n  return null\n}\n`);
add('src/lib/music.ts',`/** Background music is disabled. Voice and interface sounds use separate modules. */\nexport function enable() {}\nexport function stopAll() {}\nexport function working(_on: boolean) {}\nexport function duck(_on: boolean) {}\n`);
let app=readFileSync(base+'src/App.tsx','utf8');assert.equal(app.split("    if (!skip) sfx.play('boot')").length,2);app=app.replace("    if (!skip) sfx.play('boot')",'    // Startup remains silent; explicit voice and Read aloud are separate.');
const begin=app.indexOf('    if (!skip) {\n      const introduction = createSpeaker()');assert.ok(begin>0);const end=app.indexOf('\n    watchPanels',begin);assert.ok(end>begin);app=app.slice(0,begin)+app.slice(end);add('src/App.tsx',app);
let hud=readFileSync(base+'src/ui/Hud.tsx','utf8');const anchor="          {busy || phase === 'speaking'";assert.equal(hud.split(anchor).length,2);
const button=`          <button type="button" className="textbar-attach"\n            style={{ width: 44, height: 44, flexShrink: 0, borderRadius: 22, color: muted ? 'inherit' : '#82efd3', background: muted ? 'transparent' : '#153a36' }}\n            aria-label={muted ? 'Enable voice input' : 'Disable voice input'}\n            aria-pressed={!muted}\n            title={muted ? 'Enable voice input - then say Hey Nori' : 'Turn microphone off'}\n            onClick={() => setMuted(!muted)}>\n            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">\n              <path d="M4 10v4m4-8v12m4-15v18m4-15v12m4-8v4" />\n            </svg>\n          </button>\n`;
hud=hud.replace(anchor,button+anchor);add('src/ui/Hud.tsx',hud);
writeFileSync(stage+'/plan.json',JSON.stringify(changes,null,2));console.log(JSON.stringify({syntaxChecks:changes.length,prepared:true}));
