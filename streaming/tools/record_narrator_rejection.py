import json
from pathlib import Path

root = Path('C:/Nori/streaming/channel-operator')
direction = root / '03-Production/NARRATOR-DIRECTION.json'
data = json.loads(direction.read_text(encoding='utf-8-sig'))
data.update(owner_feedback='The voice still feels robotic', owner_accepted=False,
            status='Ethan rejected; new short narrator audition required',
            next_candidate='Hannah — Fish Official conversation specialist',
            next_candidate_accepted=False)
direction.write_text(json.dumps(data, indent=2), encoding='utf-8')
p = root / '03-Production/LONG-FORM-PROGRESS.json'
data = json.loads(p.read_text(encoding='utf-8-sig'))
data['current_work'].update(status='Ethan narration rejected by owner; technically valid export retained, voice revision required', publication_ready=False, owner_accepted=False)
p.write_text(json.dumps(data, indent=2), encoding='utf-8')
for relative in ['START-HERE.txt', 'PRODUCTION-PROGRESS.txt', '03-Production/PRODUCTION-PROGRESS.txt', '03-Production/EDITING-STYLE.txt']:
    p = root / relative
    text = p.read_text(encoding='utf-8-sig')
    note = '\nLATEST OWNER FEEDBACK: Ethan still feels robotic. W3 remains unpublished and is not accepted for production. Test a short conversational voice sample before another full rebuild.\n'
    if note.strip() not in text:
        p.write_text(text + note, encoding='utf-8')
print('Recorded Ethan rejection and kept W3 unpublished.')
