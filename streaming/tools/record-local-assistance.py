import json
from pathlib import Path
root=Path('C:/Nori/streaming')
path=root/'channel-operator/COMPLETION-AUDIT.json'
data=json.loads(path.read_text(encoding='utf-8-sig'))
data['stream_assistance_progress']={
 'status':'Local on-demand question answering verified; live chat and OBS automation incomplete',
 'panel':str(root/'producer.html'),
 'local_question_assistant':str(root/'tools/nori-stream-answer.mjs'),
 'launcher':str(root/'tools/Connect-Nori-Answer.cmd'),
 'actual_native_answer':str(root/'preview-images/stream-answer-verified.json'),
 'logic_verification':str(root/'preview-images/producer-answer-verification.json'),
 'question_answering_checks_passed':6,
 'clip_timer_checks_passed':8,
 'model':'llama3.2-3b-instruct','backend':'norama-independent',
 'native_engine_started_answered_and_stopped':True,
 'nori_desktop_bridge_running':False,
 'live_chat_connected':False,'obs_remote_connected':False,
 'automatic_posting':False,'visual_browser_review':False,
 'owner_audio_rehearsal_verified':False}
data['last_goal_turn']={'date':'2026-10-01','progress':'Actual native local answer plus selected-question export and answer import workflow; six answer logic checks and eight clip checks passed. Full channel/stream objective remains incomplete.'}
path.write_text(json.dumps(data,indent=2)+'\n',encoding='utf-8')
notes=root/'STREAM-ASSISTANT.txt'
with notes.open('a',encoding='utf-8') as f:
 f.write('''\nLOCAL NORI ANSWERS — verified October 1, 2026\nEach queued viewer question now has Export for Nori. Download that one question, then drag the JSON file onto tools/Connect-Nori-Answer.cmd. The supported local NorLlama lifecycle starts its imported llama3.2-3b-instruct model, produces an answer JSON next to your question, and shuts down. No cloud speech credits are used.\nLoad the new answer JSON with Load Nori answer in producer.html. It must match a question still in your queue. Review it, use it as a message draft, and copy it yourself. The answer is model generated and may need correction.\nThe assistant receives only the selected question and a blank topic; it does not receive session notes, drafts, private windows or other queued questions. No desktop tools, OBS controls, chat posting or moderation privileges are exposed.\nActual local inference was verified using the OBS monitor question; the first vague answer was retained as a diagnostic, and the revised stream-context answer is in preview-images/stream-answer-verified.json. Six answer logic checks and eight existing clip/timer checks passed. Browser visual review remains unavailable; no live chat connection is claimed.\n''')
