import json
from pathlib import Path
root=Path('C:/Nori/streaming/channel-operator');folder=root/'03-Production/Human-Reactions/Privacy-Milk'
record={'video_id':'sNLx8i3i9KI','url':'https://www.youtube.com/shorts/sNLx8i3i9KI','title':'Your Stream Just Leaked the Group Chat','visibility':'Public','scheduled':False,'published_date':'2026-10-01','native_publication_verified':True,'public_playback_verified':True,'public_seek_progress':[8,69],'public_related_link_verified':True,'related_video_id':'wQCuI-5i0iQ','playlist':'Creator Tools','native_subtitles_saved':'English (United States) by you','public_native_cc_available_verified':False,'ai_disclosure':True,'copyright_check':'No issues found','community_guidelines_check':'No issues found','narrator':'MiniMax fred owner clone','likeness_reference':'User-supplied solo portrait','other_people_used':False,'ai_dramatization':True,'lip_sync':False,'originals_changed':False,'proofs':['YouTube-published.png','YouTube-public-player.png']}
(folder/'PUBLICATION-RECORD.json').write_text(json.dumps(record,indent=2)+'\n',encoding='utf-8')
for name in ['FINAL-VERIFICATION.json','GENERATION-RECORD.json','publishing-package.json']:
 p=folder/name;d=json.loads(p.read_text(encoding='utf-8-sig'));d['published']=True;d['youtube_url']=record['url']
 if name=='FINAL-VERIFICATION.json':d['final_scene_review']=True;d['reviewed_scenes']=7
 p.write_text(json.dumps(d,indent=2)+'\n',encoding='utf-8')
path=root/'LIVE-VIDEO-INVENTORY.json';inv=json.loads(path.read_text(encoding='utf-8-sig'))
if not any(v['url']==record['url'] for v in inv['videos']):
 inv['videos'].append({'calendar_id':'HUMAN-S1','version':'New human reaction skit','title':record['title'],'url':record['url'],'visibility':'Public','proof_record':'03-Production/Human-Reactions/Privacy-Milk/PUBLICATION-RECORD.json'})
inv['additional_public_human_skits']=1;inv['total_public_batch_uploads']=17
assert len(inv['videos'])==17
path.write_text(json.dumps(inv,indent=2)+'\n',encoding='utf-8')
auditpath=root/'COMPLETION-AUDIT.json';audit=json.loads(auditpath.read_text(encoding='utf-8-sig'))
audit['phase4']['additional_public_human_skits']=[record]
audit['phase4']['total_public_batch_uploads']=17
audit['phase3']['owner_photo_reference_received']=True
audit['phase3']['human_reaction_short_public_count']=1
audit['phase3']['owner_photo_reference']='C:/Users/Studio/Pictures/488924936_1977117449486040_3193506081902290240_n.jpg'
audit['phase3']['heygen_private_avatar_count']=0
audit['blocking_condition']['condition']='Owner photo reference is available and used in AI reaction images. HeyGen private avatar creation/consent and live stream integration remain incomplete; other production can continue.'
audit['owner_quality_revision']['latest_visual_direction']='Human likeness from supplied solo photo, original meme sound beats, concise skit and clear practical takeaway; owner quality acceptance pending.'
audit['last_goal_turn']={'date':'2026-10-01','progress':'Finished, reviewed and published human reaction skit using supplied solo photo and Fred narration; 18-second 1080x1920 H264/AAC MP4 passed full decode. Native publication and public playback/link verified. Total public uploads17; whole goal incomplete.'}
audit['delivery_reconciliation']['archive_is_current']=False
audit['delivery_reconciliation']['archive_current_count']=16
auditpath.write_text(json.dumps(audit,indent=2)+'\n',encoding='utf-8')
for name in ['START-HERE.txt','PRODUCTION-PROGRESS.txt','03-Production/PRODUCTION-PROGRESS.txt']:
 p=root/name;s=p.read_text(encoding='utf-8-sig')
 s=s.replace('16 batch uploads are Public: all 12 calendar videos (8 Shorts and 4 full episodes), plus 4 Fred-voiced Short revisions.', '17 batch uploads are Public: all 12 calendar videos (8 Shorts and 4 full episodes), plus 4 Fred-voiced Short revisions and 1 new human reaction skit.')
 s=s.replace('Complete the owner avatar input/integration.', 'Complete HeyGen avatar creation/consent and integration; owner photo references are now supplied.')
 s+='\nNEW HUMAN REACTION SHORT\n'+record['title']+'\n'+record['url']+'\nBased on the supplied solo portrait, with Fred narration, 7 shots, 15 timed captions and original reaction sounds. AI-dramatized animated stills; no lip sync. The previous ZIP contains 16 uploads and has not yet been rebuilt for this new video.\n'
 p.write_text(s,encoding='utf-8')
print(json.dumps({'public_video':record['url'],'total_public':17,'calendar_public':12,'additional_fred_revisions':4,'new_human_skits':1,'whole_goal_complete':False}))
