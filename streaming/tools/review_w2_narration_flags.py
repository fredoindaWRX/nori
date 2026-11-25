"""Record editorial decisions without rewriting raw speech-recognition evidence."""
import json,re
from pathlib import Path
P=Path('C:/Nori/streaming/channel-operator/02-Calendar/Week-2/W2-MAIN')
path=P/'narration-alignment-check.json';qa=json.loads(path.read_text(encoding='utf-8'))
decisions=[]
for flag in qa['recognition_flags']:
 source=flag['source'];recognized=flag['recognized']
 if source=='a':basis='Unchanged source section is recognized as a group decision in its original transcription and the independent full-master check.'
 elif source=='Pause.':basis='Original section-two transcription recognizes Pause at this location. The audio is unchanged apart from tempo and equalization; final recognizer omitted this brief word.'
 elif source=='multitrack':basis='Hyphenation/tokenization difference; the recognized phrase has the same spoken content.'
 elif source=='saved':basis='Technical pickup recognizes saved setup/file. The master drops the final d in recognition; instructions and track assignments remain intact.'
 elif source in ['effects.','scenes.']:basis='Minor singular/plural recognition difference. No device, routing or track assignment is changed. Retain the written source form as conventional caption spelling; do not claim exact recognition.'
 elif source=='then':basis='Generated audio is recognized as and compare in both section and master. Same instructional meaning; captions are corrected to match the consistently recognized conjunction.'
 else:raise RuntimeError('Unreviewed flag: '+str(flag))
 decisions.append({'flag':flag,'decision':'Accepted after editorial wording review','basis':basis})
# Correct the conjunction only at the measured flagged location.
words=json.loads((P/'spoken-words.json').read_text(encoding='utf-8'))
for flag in qa['recognition_flags']:
 if flag['source']=='then':
  a,b=flag['source_indices'];assert b-a==1;words[a]['word']='and';words[a]['alignment']='Consistent recognized wording; editorial caption correction'
(P/'spoken-words.json').write_text(json.dumps(words,indent=2),encoding='utf-8')
srt=(P/'captions.srt').read_text(encoding='utf-8')
# The sentence appears once and the subtitle split places the conjunction in this cue.
srt=re.sub(r'then(?=\s+compare it)', 'and', srt)
(P/'captions.srt').write_text(srt,encoding='utf-8')
qa.update(editorial_review_complete=True,remaining_material_instruction_flags=0,
 all_words_exactly_verified=False,human_listening_verified=False,
 review_decisions=decisions,review_note='Two unclear technical passages were regenerated and inserted with clip provenance. Remaining minor recognition differences reviewed transparently; raw outputs preserved. This is not a human voice-likeness assessment.')
path.write_text(json.dumps(qa,indent=2),encoding='utf-8')
print(json.dumps({'reviewed_flags':len(decisions),'material_instruction_flags':0,'exact_word_match_claimed':False}))
