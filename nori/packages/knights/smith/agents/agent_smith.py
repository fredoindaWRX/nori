"""No model-generated commands: explicit authenticated execution requests only."""
from pathlib import Path
from ..tools.agent_smith_tools import SmithTools
ROOT=Path(__file__).resolve().parents[4]

class AgentSmith:
    def __init__(self,workspace,*,owner_fingerprint,authorize,killed,**tool_options):
        if not owner_fingerprint or not callable(authorize) or not callable(killed):raise ValueError('Host identity, authorization and kill callback required')
        self.owner=owner_fingerprint;self.authorize=authorize;self.model='phi4'
        self.tools=SmithTools(workspace,killed=killed,**tool_options)
    @property
    def system_prompt(self):
        return (ROOT/'prompts/covenant.md').read_text().replace('[Name]','Agent Smith').replace('[owner fingerprint]',self.owner)+'\n'+(Path(__file__).resolve().parents[1]/'prompts/agent_smith.md').read_text()
    def run(self,request,session):
        if not isinstance(request,dict):raise ValueError('Typed request required')
        if self.authorize(session,request) is not True:return {'status':'denied'}
        tool=request.get('tool')
        if tool not in {'bash','python_exec','file_ops','api_call','cron'}:raise ValueError('Unsupported executor tool')
        try:return getattr(self.tools,tool)(**request.get('arguments',{}))
        except PermissionError as exc:return {'status':'denied','reason':str(exc)}
