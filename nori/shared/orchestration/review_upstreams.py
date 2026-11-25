"""Collect pinned upstream license evidence; never execute upstream code."""
import base64, concurrent.futures, hashlib, json
from datetime import datetime, timezone
from pathlib import Path
from urllib.request import Request, urlopen
REPOS={'neo':'OpenHands/OpenHands','trinity':'block/goose','morpheus':'cline/cline','apoc':'browser-use/browser-use','oracle':'khoj-ai/khoj','merovingian':'letta-ai/letta','architect':'crewAIInc/crewAI','keymaker':'assafelovic/gpt-researcher','smith':'OpenInterpreter/open-interpreter','tank':'agent0ai/agent-zero','machine':'mudler/LocalAI','sentinel':'openclaw/openclaw'}
ROOT=Path(__file__).resolve().parent/'upstream-records'
def fetch(url):
 with urlopen(Request(url,headers={'User-Agent':'NORI-source-review','Accept':'application/vnd.github+json'}),timeout=30) as response: return json.load(response)
def inspect(item):
 knight,repo=item
 result={'knight':knight,'requested_repository':repo,'checked_at':datetime.now(timezone.utc).isoformat(),'implementation_status':'planned','import_approved':False}
 try:
  meta=fetch('https://api.github.com/repos/'+repo)
  result['repository']=meta['full_name'];result['url']=meta['html_url']
  commit=fetch('https://api.github.com/repos/'+meta['full_name']+'/commits/'+meta['default_branch'])['sha']
  result['commit']=commit
  license=fetch('https://api.github.com/repos/'+meta['full_name']+'/license?ref='+commit)
  raw=base64.b64decode(license['content'])
  folder=ROOT/knight;folder.mkdir(parents=True,exist_ok=True)
  (folder/'LICENSE-ORIGINAL').write_bytes(raw)
  result.update(license_id=license.get('license',{}).get('spdx_id','UNKNOWN'),license_path=license['path'],license_sha256=hashlib.sha256(raw).hexdigest(),license_url=license['html_url'],review_status='root_license_captured_scope_review_pending')
 except Exception as error: result.update(review_status='incomplete',error=str(error))
 return result
if __name__=='__main__':
 ROOT.mkdir(parents=True,exist_ok=True)
 with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool: results=list(pool.map(inspect,REPOS.items()))
 (ROOT/'inventory.json').write_text(json.dumps(results,indent=2)+'\n',encoding='utf-8')
 for row in results: print(row['knight'],row.get('license_id'),row['review_status'],row.get('error',''))
