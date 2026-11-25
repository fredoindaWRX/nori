"""NORI-owned Knight task execution through the local NORI model service.

This is the native task layer, not an implementation of upstream worker frameworks.
Model responses are proposals; they do not automatically execute tools.
"""
import json
from pathlib import Path
from nori_installation_paths import core_installation_root
from uuid import uuid4
from urllib.parse import urlsplit
from urllib.request import Request, build_opener, ProxyHandler, HTTPRedirectHandler
from audit.nori_audit import record
from orchestration.knight_registry import KnightRegistry, WATCHMAN_ONLY_CAPABILITIES
from orchestration.nori_orchestrator import Orchestrator, WorkerSpec
from orchestration.merovingian_worker import MerovingianWorker
from orchestration.sentinel_worker import SentinelWorker
from orchestration.tank_worker import TankWorker
from orchestration.machine_worker import MachineWorker
from orchestration.oracle_worker import OracleWorker
from orchestration.keymaker_worker import KeymakerWorker
from orchestration.trinity_worker import TrinityWorker
from orchestration.neo_worker import NeoWorker
from orchestration.morpheus_worker import MorpheusWorker
from orchestration.smith_worker import SmithWorker
from orchestration.apoc_worker import ApocWorker
from orchestration.architect_worker import ArchitectWorker
from learning.learning_runtime import LearningRuntime
from nori_memory import MemoryStore

DEFAULT_ROSTER = core_installation_root(Path(__file__).resolve().parents[2]) / 'shared/orchestration/knights.json'

_DISPATCH_HANDLERS = {
    'orchestration': {'architect': 'run_architect'},
    'memory': {'merovingian': 'run_memory'},
    'learning': {'merovingian': 'run_learning'},
    'events': {'sentinel': 'run_sentinel'},
    'hardware': {'tank': 'run_tank', 'machine': 'run_machine'},
    'inference': {'machine': 'run_machine'},
    'knowledge': {'oracle': 'run_oracle'},
    'research': {'keymaker': 'run_keymaker', 'oracle': 'run_oracle'},
    'plugins': {'trinity': 'run_trinity'},
    'coding': {'neo': 'run_neo'},
    'ide': {'morpheus': 'run_morpheus', 'neo': 'run_neo'},
    'execution': {'smith': 'run_smith'},
    'browser': {'apoc': 'run_apoc'},
}

class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None

class KnightRuntime:
    def __init__(self, endpoint, model, policy, audit_path, roster_path=None, memory_root=None, knowledge_root=None, plugin_root=None, workspace_root=None, project_root=None, learning_root=None, python_runner=None, compute_config=None, owned_role=None):
        from orchestration.core_workers import ROLE_SERVICES
        if owned_role is not None and owned_role not in ROLE_SERVICES:
            raise ValueError('Unknown owned Core role')
        address=urlsplit(endpoint)
        if address.scheme!='http' or address.hostname not in ('127.0.0.1','::1') or address.username or address.password or address.path not in ('','/') or address.query or address.fragment:
            raise ValueError('A literal loopback NORI service address is required')
        self.endpoint=endpoint.rstrip('/')
        self.model=model
        self.policy=policy
        self.audit_path=Path(audit_path)
        self.orchestrator=Orchestrator(policy)
        self.orchestrator.audit_path=self.audit_path
        self.registry=KnightRegistry(Path(roster_path) if roster_path else DEFAULT_ROSTER)
        self.edition=None
        self.opener=build_opener(ProxyHandler({}),NoRedirect())
        # Managed Core constructs each owner's service once, then connects the
        # complete graph before admission. Standalone runtimes retain all tools.
        factories = {
            'memory_worker': lambda: MerovingianWorker(MemoryStore(memory_root or self.audit_path.parent/'memory', policy, self.audit_path)),
            'sentinel_worker': lambda: SentinelWorker(policy, self.audit_path),
            'tank_worker': lambda: TankWorker(policy, self.audit_path),
            'machine_worker': lambda: MachineWorker(endpoint, policy, self.audit_path, compute_config=compute_config),
            'oracle_worker': lambda: OracleWorker(knowledge_root or self.audit_path.parent/'knowledge', policy, self.audit_path),
            'keymaker_worker': lambda: KeymakerWorker(self.oracle_worker, policy, self.audit_path),
            'trinity_worker': lambda: TrinityWorker(plugin_root or self.audit_path.parent/'plugins', policy, self.audit_path),
            'neo_worker': lambda: NeoWorker(workspace_root or self.audit_path.parent/'workspace', policy, self.audit_path),
            'morpheus_worker': lambda: MorpheusWorker(project_root or workspace_root or self.audit_path.parent/'workspace', policy, self.audit_path),
            'smith_worker': lambda: SmithWorker(workspace_root or self.audit_path.parent/'workspace', policy, self.audit_path, python_runner=python_runner),
            'apoc_worker': lambda: ApocWorker(policy, self.audit_path),
            'architect_worker': lambda: ArchitectWorker(policy, self.audit_path, self.dispatch),
        }
        for field in factories: setattr(self, field, None)
        for field, factory in factories.items():
            if owned_role is None or ROLE_SERVICES[owned_role] == field:
                setattr(self, field, factory())
        self.learning_runtime = (LearningRuntime(learning_root or self.audit_path.parent/'learning', policy)
                                 if owned_role in (None, 'merovingian') else None)

    def enable_architect(self):
        knight=self.registry.knights['architect']
        if not knight.activatable:
            raise ValueError('architect is not implemented')
        self._register(knight)

    def configure_edition(self, edition):
        """Activate only implemented Knights assigned to a NORI edition."""
        knights=self.registry.for_edition(edition)
        self.orchestrator.workers.clear()
        for knight in knights:
            self._register(knight)
        self.edition=edition
        record(self.audit_path,'knight_edition',edition,'configured',
               {'workers':[knight.id for knight in knights]})
        return tuple(knight.id for knight in knights)

    def _register(self, knight):
        self.orchestrator.register(WorkerSpec(
            knight.id,
            self.model,
            permissions=list(knight.permissions),
            capabilities=list(knight.capabilities),
        ))

    def run(self, task, capability='orchestration', max_tokens=256):
        if not isinstance(task,str) or not task.strip(): raise ValueError('task is required')
        if type(max_tokens) is not int or not 1 <= max_tokens <= 4096: raise ValueError('invalid token limit')
        task_id=str(uuid4())
        plan=self.orchestrator.plan(task,capability)
        worker=self.orchestrator.workers.get(plan['worker'])
        allowed=plan['allowed'] and self.policy.decide('infer').allowed and worker and 'infer' in worker.permissions
        if not allowed:
            record(self.audit_path,'knight_task',task_id,'denied',{'capability':capability})
            return {'task_id':task_id,'status':'denied','worker':plan['worker']}
        record(self.audit_path,'knight_task',task_id,'started',{'worker':worker.name})
        prompt=(f'You are NORI {worker.name.title()}. Produce a concise implementation proposal using only the supplied facts. '
                'Distinguish unverified assumptions. Never claim to have executed tools or made changes. Task:\n'+task)
        body={'model':worker.model_id,'prompt':prompt,'max_tokens':max_tokens}
        request=Request(self.endpoint+'/v1/chat',data=json.dumps(body).encode(),headers={'Content-Type':'application/json'})
        try:
            with self.opener.open(request,timeout=250) as response:
                payload=json.load(response)
            if payload.get('model')!=worker.model_id or not isinstance(payload.get('response'),str) or not payload['response'].strip():
                raise ValueError('Invalid model service response')
            record(self.audit_path,'knight_task',task_id,'completed',{'worker':worker.name})
            return {'task_id':task_id,'status':'completed','worker':worker.name,'proposal':payload['response'],'executed_tools':[]}
        except Exception as error:
            record(self.audit_path,'knight_task',task_id,'failed',{'worker':worker.name,'error_type':type(error).__name__})
            raise

    def run_memory(self, request):
        """Run a typed Merovingian request without routing it through inference."""
        if 'merovingian' not in self.orchestrator.workers:
            raise ValueError('merovingian is not active for this edition')
        return self.memory_worker.run(request)

    def run_learning(self, request):
        """Record and evaluate local experience through the Chronicler."""
        if 'merovingian' not in self.orchestrator.workers:
            raise ValueError('merovingian is not active for this edition')
        return self.learning_runtime.run(request)

    def run_sentinel(self, request):
        """Run a typed local Sentinel event request without inference."""
        if 'sentinel' not in self.orchestrator.workers:
            raise ValueError('sentinel is not active for this edition')
        return self.sentinel_worker.run(request)

    def run_tank(self, request):
        """Run Tank's typed read-only hardware capability request."""
        if 'tank' not in self.orchestrator.workers:
            raise ValueError('tank is not active for this edition')
        return self.tank_worker.run(request)

    def run_machine(self, request):
        """Run typed read-only Seth inspection and model preflight requests."""
        if 'machine' not in self.orchestrator.workers:
            raise ValueError('machine is not active for this edition')
        return self.machine_worker.run(request)

    def run_oracle(self, request):
        """Run a typed private-document Oracle request without inference."""
        if 'oracle' not in self.orchestrator.workers:
            raise ValueError('oracle is not active for this edition')
        return self.oracle_worker.run(request)

    def run_keymaker(self, request):
        """Run a cited local-evidence report through Keymaker."""
        if 'keymaker' not in self.orchestrator.workers:
            raise ValueError('keymaker is not active for this edition')
        return self.keymaker_worker.run(request)

    def run_trinity(self, request):
        """Run a typed local NORI plugin request through Trinity."""
        if 'trinity' not in self.orchestrator.workers:
            raise ValueError('trinity is not active for this edition')
        return self.trinity_worker.run(request)

    def run_neo(self, request):
        if 'neo' not in self.orchestrator.workers: raise ValueError('neo is not active for this edition')
        return self.neo_worker.run(request)

    def run_morpheus(self, request):
        """Run NORI's bounded local code navigation worker."""
        if 'morpheus' not in self.orchestrator.workers: raise ValueError('morpheus is not active for this edition')
        return self.morpheus_worker.run(request)

    def run_smith(self, request):
        """Run a bounded, shell-free local Smith task."""
        if 'smith' not in self.orchestrator.workers: raise ValueError('smith is not active for this edition')
        return self.smith_worker.run(request)

    def run_apoc(self, request):
        """Run NORI's read-only public-web Scout."""
        if 'apoc' not in self.orchestrator.workers: raise ValueError('apoc is not active for this edition')
        return self.apoc_worker.run(request)

    def run_architect(self, request):
        """Run a validated Council graph through active typed Knights."""
        if 'architect' not in self.orchestrator.workers:
            raise ValueError('architect is not active for this edition')
        return self.architect_worker.run(request)

    def dispatch(self, request):
        """Route one typed request to an active NORI Knight.

        This is NORI's own edition-aware dispatch boundary.  It accepts a
        declared capability and data object, does not infer a capability from
        natural language, and preserves each worker's own typed limits.
        """
        if not isinstance(request, dict) or set(request) != {'capability', 'request'}:
            raise ValueError('invalid_knight_dispatch')
        capability, payload = request['capability'], request['request']
        if not isinstance(capability, str) or not isinstance(payload, dict):
            raise ValueError('invalid_knight_dispatch')
        if capability in WATCHMAN_ONLY_CAPABILITIES:
            raise ValueError('watchman_authority_required')
        handler_names = _DISPATCH_HANDLERS.get(capability)
        if handler_names is None:
            raise ValueError('unsupported_knight_capability')
        resolved = self.registry.resolve(capability, self.edition) if self.edition else None
        if resolved is None:
            raise ValueError('knight_not_active_for_edition')
        selected, fallback = resolved
        knight = selected.id
        handler_name = handler_names.get(knight)
        handler = getattr(self, handler_name, None) if handler_name else None
        if handler is None:
            raise ValueError('knight_handler_contract_missing')
        dispatch_id = str(uuid4())
        record(self.audit_path, 'knight_dispatch', dispatch_id, 'started',
               {'edition': self.edition, 'capability': capability, 'knight': knight,
                'fallback': fallback})
        try:
            result = handler(payload)
        except Exception as error:
            record(self.audit_path, 'knight_dispatch', dispatch_id, 'failed',
                   {'edition': self.edition, 'capability': capability,
                    'knight': knight, 'error_type': type(error).__name__})
            raise
        status = result.get('status') if isinstance(result, dict) else None
        outcome = status if isinstance(status, str) and status in {'completed', 'indexed', 'queued', 'ready',
            'denied', 'failed', 'cancelled', 'blocked', 'incomplete', 'review_candidate'} else 'unqualified_result'
        record(self.audit_path, 'knight_dispatch', dispatch_id, outcome,
               {'edition': self.edition, 'capability': capability, 'knight': knight})
        return {'schema': 'nori.knight-dispatch.v1', 'dispatch_id': dispatch_id,
                'edition': self.edition, 'knight': knight, 'fallback': fallback,
                'result': result}
