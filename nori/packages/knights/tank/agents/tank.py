"""Typed hardware steward: no LLM-generated actuation."""
from pathlib import Path
from ..tools.tank_tools import TankTools
ROOT=Path(__file__).resolve().parents[4]

class TankAgent:
    def __init__(self,*,owner_fingerprint,authorize,safety_gate,killed,schema_lookup=None,edition='home',watchman_gate=None):
        if not owner_fingerprint or not all(callable(f) for f in (authorize,safety_gate,killed)):raise ValueError('Authenticated host and safety callbacks required')
        self.owner=owner_fingerprint;self.model='phi4'
        self.tools=TankTools(authorize=authorize,safety_gate=safety_gate,killed=killed,schema_lookup=schema_lookup,edition=edition,watchman_gate=watchman_gate)
    @property
    def system_prompt(self):
        return (ROOT/'prompts/covenant.md').read_text().replace('[Name]','Tank').replace('[owner fingerprint]',self.owner)+'\n'+(Path(__file__).resolve().parents[1]/'prompts/tank.md').read_text()
    async def run(self,request,session):
        if not isinstance(request,dict) or set(request)!={'device','operation','parameters'}:raise ValueError('Typed device request required')
        return await self.tools.execute(session=session,**request)
