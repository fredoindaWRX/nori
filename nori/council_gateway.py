"""Single-process HTTP bridge: one Sentinel and one bus for twelve routes.

This is application-level enforcement, not TPM identity or OS process isolation.
Only Machine's listener performs model generation. Tokens never enter audit logs.
"""
import asyncio
from contextlib import contextmanager
import hmac
import json
import sqlite3
import time
from pathlib import Path
from uuid import uuid4
from bus import AgentName, Message, MessageBus
from security.hard_floor import load_hard_floor, assert_output_safe

class SentinelGate:
    def __init__(self, token, audit_path):
        load_hard_floor()
        if len(token) < 32: raise ValueError('Strong local token required')
        self.token = token
        self.audit_path = Path(audit_path)
        self.audit_path.parent.mkdir(parents=True, exist_ok=True)
        self.locked = False
        with self.connect() as db:
            db.execute('CREATE TABLE IF NOT EXISTS messages (id TEXT, sender TEXT, recipient TEXT, operation TEXT, outcome TEXT, created TEXT DEFAULT CURRENT_TIMESTAMP)')
    @contextmanager
    def connect(self):
        connection = sqlite3.connect(self.audit_path)
        try:
            with connection:
                yield connection
        finally:
            # sqlite3's transaction context commits/rolls back but does not
            # close the connection. Windows retains the audit file otherwise.
            connection.close()
    def log(self, msg, outcome):
        with self.connect() as db:
            db.execute('INSERT INTO messages(id,sender,recipient,operation,outcome) VALUES (?,?,?,?,?)',
                (msg.payload.get('_id'),msg.from_agent.value,msg.to_agent.value,msg.task,outcome))
    async def check(self, msg):
        credential = msg.payload.get('_credential')
        allowed = not self.locked and isinstance(credential,str) and hmac.compare_digest(credential,self.token)
        if allowed: self.log(msg,'authenticated')
        return allowed
    async def log_denial(self,msg): self.log(msg,'denied')
    async def approve_actuator(self,msg): return False  # No physical safety authority provisioned.

class CouncilGateway:
    def __init__(self, workers, token, audit_path, memory_adapter=None, watchdog=None,
                 model_scheduler=None):
        self.workers = workers
        self.memory_adapter = memory_adapter
        self.sentinel = SentinelGate(token,audit_path)
        from bus_watchdog import BusWatchdog
        self.watchdog = watchdog or BusWatchdog(Path(audit_path).parent / 'bus-watchdog.jsonl')
        self.bus = MessageBus(self.sentinel, watchdog=self.watchdog)
        self.pending = {}
        self.listeners = []
        self.jobs = set()
        self.request_jobs = {}
        self.model_scheduler = model_scheduler
        for worker in workers.values():
            if hasattr(worker.runtime, 'architect_worker'):
                worker.runtime.architect_worker.dispatcher = self.dispatch_typed
        self.inference_lock = asyncio.Lock()  # Desktop hardware: one loaded generation at a time.
    def dispatch_typed(self, request):
        if not isinstance(request,dict) or set(request) != {'capability','request'}:
            raise ValueError('Invalid dispatch')
        runtime=self.workers['architect'].runtime
        resolved=runtime.registry.resolve(request['capability'],runtime.edition)
        if not resolved: raise ValueError('No active Knight')
        knight,fallback=resolved
        operation = 'learning' if request['capability'] == 'learning' else 'task'
        result=self.submit(knight.id,operation,request['request'],self.sentinel.token)
        return {'dispatch_id':uuid4().hex,'knight':knight.id,'fallback':fallback,'result':result}

    async def start(self):
        self.loop = asyncio.get_running_loop()
        self.watchdog.start()
        self.listeners = [asyncio.create_task(self.listen(name)) for name in AgentName]
    async def stop(self):
        self.sentinel.locked = True
        for future in self.pending.values():
            if not future.done(): future.set_exception(RuntimeError('Council stopped'))
        for task in self.listeners + list(self.jobs): task.cancel()
        await asyncio.gather(*self.listeners,*self.jobs,return_exceptions=True)
        try:
            self.watchdog.stop()
        except Exception:
            pass
        close = getattr(self.model_scheduler, 'close', None)
        if callable(close):
            close()
    async def request(self, recipient, operation, body, credential, sender=AgentName.ARCHITECT):
        if len(self.pending) >= 64: raise RuntimeError('Council queue full')
        request_id = uuid4().hex
        future = self.loop.create_future()
        self.pending[request_id] = future
        try:
            msg = Message(sender,AgentName(recipient),operation,{'body':body,'_id':request_id,'_credential':credential})
            if not await self.bus.send(msg): raise PermissionError('Sentinel denied request')
            return await asyncio.wait_for(future,190)
        finally:
            if future.cancelled() and operation in {'chat', 'infer'}:
                job = self.request_jobs.get(request_id)
                if job is not None and not job.done():
                    job.cancel()
                    await asyncio.shield(asyncio.gather(job, return_exceptions=True))
            self.pending.pop(request_id,None)
    def submit(self, recipient, operation, body, credential):
        future = asyncio.run_coroutine_threadsafe(self.request(recipient,operation,body,credential),self.loop)
        try: return future.result(timeout=195)
        except BaseException:
            future.cancel()
            raise
    async def listen(self,name):
        while True:
            msg=await self.bus.receive(name)
            task=asyncio.create_task(self.execute(msg))
            self.jobs.add(task)
            task.add_done_callback(self.jobs.discard)
            request_id = msg.payload.get('_id')
            self.request_jobs[request_id] = task
            def discard_request(finished, request_id=request_id):
                if self.request_jobs.get(request_id) is finished:
                    self.request_jobs.pop(request_id, None)
            task.add_done_callback(discard_request)
    async def generate_inference(self, worker, goal, **kwargs):
        from machine_transport import generate
        if getattr(worker, 'native_inference', None) is None:
            return await asyncio.to_thread(generate, worker, goal, **kwargs)
        from threading import Event
        cancel = Event()
        task = asyncio.create_task(asyncio.to_thread(generate, worker, goal, cancel_event=cancel, **kwargs))
        try:
            return await asyncio.shield(task)
        except asyncio.CancelledError:
            cancel.set()
            # Keep the inference lock held while the owned request drains.
            try:
                await asyncio.shield(task)
            except Exception:
                pass
            raise
    async def execute(self,msg):
        started=time.perf_counter()
        await self._execute(msg)
        future=self.pending.get(msg.payload['_id'])
        outcome='unknown'
        if future is not None and future.done() and not future.cancelled():
            error=future.exception()
            if error is not None:
                outcome='denied' if isinstance(error, PermissionError) else 'failed'
            else:
                result=future.result()
                outcome=result.get('status','unknown') if isinstance(result,dict) else 'unknown'
        with self.sentinel.connect() as db:
            db.execute('CREATE TABLE IF NOT EXISTS tool_timings (request_id TEXT, knight TEXT, operation TEXT, outcome TEXT, duration_ms REAL, created TEXT DEFAULT CURRENT_TIMESTAMP)')
            db.execute('INSERT INTO tool_timings(request_id,knight,operation,outcome,duration_ms) VALUES (?,?,?,?,?)',
                       (msg.payload['_id'],msg.to_agent.value,msg.task,outcome,round((time.perf_counter()-started)*1000,3)))

    async def _execute(self,msg):
        future=self.pending.get(msg.payload['_id'])
        if future is None or future.done(): return
        try:
            if self.sentinel.locked: raise PermissionError('Council stopped')
            body=msg.payload['body']; worker=self.workers[msg.to_agent.value]
            if msg.task == 'SENSOR_DATA':
                if msg.from_agent != AgentName.TANK or msg.to_agent != AgentName.MEROVINGIAN:
                    raise PermissionError('Sensor publication requires Tank to Merovingian route')
                from hardware.sensory import TYPES
                if (not isinstance(body, dict) or body.get('event') != 'SENSOR_DATA'
                        or body.get('type') not in TYPES or not isinstance(body.get('sensor_id'), str)
                        or body.get('status') not in {'ok', 'degraded'}):
                    raise ValueError('Invalid sensor event')
                encoded = json.dumps(body, allow_nan=False)
                if len(encoded) > 16384:
                    raise ValueError('Sensor event too large')
                result = await asyncio.to_thread(worker.runtime.run_memory,
                    {'operation': 'remember', 'scope': 'sensor-history', 'content': encoded,
                     'tags': ['SENSOR_DATA', body['type'], body['sensor_id']]})
            elif msg.task == 'task' and body == {'operation':'tool_status'}:
                from tool_capabilities import inventory
                manager=getattr(self,'work_sessions',None)
                result=inventory(manager is not None and manager.python_runner is not None)
            elif msg.task == 'task' and body.get('operation') in {
                    'google_status','google_read','google_gmail_list','google_gmail_read','google_calendar_list'}:
                if msg.to_agent != AgentName.TRINITY: raise ValueError('Google connector dispatch belongs to Trinity')
                from google_connection import status, read_operation, typed_read
                if body=={'operation':'google_status'}:
                    result=status()
                elif set(body)=={'operation','google_operation','parameters'} and body['operation']=='google_read':
                    readiness=status()
                    if readiness['blockers']:
                        result={'status':'blocked','reason':'Google setup incomplete','blockers':readiness['blockers']}
                    else:
                        result=await asyncio.to_thread(read_operation,body['google_operation'],body['parameters'])
                elif set(body)=={'operation','parameters'}:
                    typed_names={'google_gmail_list':'gmail_list','google_gmail_read':'gmail_read',
                                 'google_calendar_list':'calendar_list'}
                    google_operation=typed_names.get(body['operation'])
                    if google_operation is None: raise ValueError('Invalid typed Google connector request')
                    readiness=status()
                    if readiness['blockers']:
                        result={'status':'blocked','reason':'Google setup incomplete','blockers':readiness['blockers']}
                    else:
                        result=await asyncio.to_thread(typed_read,google_operation,body['parameters'])
                else: raise ValueError('Invalid Google connector request')
            elif msg.task == 'task' and body.get('operation') == 'review_source':
                if msg.to_agent != AgentName.TRINITY: raise ValueError('Structured review belongs to Trinity')
                source=body.get('source')
                if not isinstance(source,str) or not source.strip() or len(source)>32000:
                    raise ValueError('Review source must contain 1 to 32000 characters')
                result=await self.request(AgentName.MACHINE,'infer',
                    {'goal':'Review supplied source','knight':worker.knight,'review_source':source},
                    msg.payload['_credential'],sender=msg.to_agent)
            elif msg.task == 'task' and msg.to_agent == AgentName.KEYMAKER and body.get('operation') == 'report' and 'urls' in body:
                if set(body) - {'operation','question','limit','urls'}:
                    raise ValueError('Invalid online research request')
                urls = body.get('urls')
                if (not isinstance(urls, list) or not 1 <= len(urls) <= 5
                        or any(not isinstance(url, str) for url in urls)
                        or len(set(urls)) != len(urls)):
                    raise ValueError('Online research requires 1 to 5 unique URLs')
                web_sources = []
                for url in urls:
                    inspected = await self.request(AgentName.APOC, 'task',
                        {'operation':'inspect','url':url}, msg.payload['_credential'], sender=msg.to_agent)
                    if not isinstance(inspected, dict) or inspected.get('status') != 'completed':
                        raise RuntimeError('Apoc did not return completed evidence')
                    evidence = inspected.get('result')
                    if not isinstance(evidence, dict):
                        raise ValueError('Apoc returned invalid evidence')
                    web_sources.append(evidence)
                report_request = {key:body[key] for key in ('operation','question','limit') if key in body}
                result = await asyncio.to_thread(worker.runtime.keymaker_worker.run_with_web,
                                                  report_request, web_sources)
            elif msg.task == 'task' and body.get('operation') == 'review_coverage':
                if msg.to_agent != AgentName.TRINITY:
                    raise ValueError('Coverage review belongs to Trinity')
                from artifact_review import checklist_prompt
                coverage = {'requirements': body.get('requirements'), 'content': body.get('content')}
                checklist_prompt(**coverage)
                result = await self.request(AgentName.MACHINE, 'infer',
                    {'goal': 'Review artifact coverage', 'knight': worker.knight, 'coverage_review': coverage},
                    msg.payload['_credential'], sender=msg.to_agent)
            elif msg.task == 'chat':
                goal=body.get('goal')
                if not isinstance(goal,str) or not goal.strip(): raise ValueError('Nonempty goal required')
                result=await self.request(AgentName.MACHINE,'infer',{'goal':goal,'knight':worker.knight},
                    msg.payload['_credential'],sender=msg.to_agent)
            elif msg.task == 'infer' and msg.to_agent == AgentName.MACHINE:
                source=body['knight']
                if source != msg.from_agent.value: raise PermissionError('Inference source mismatch')
                async with self.inference_lock:
                    if self.sentinel.locked: raise PermissionError('Council stopped')
                    from machine_transport import generate
                    scheduled = ({'scheduler': self.model_scheduler,
                                  'model_tier': self._model_tier(source),
                                  'task_id': msg.payload['_id']}
                                 if self.model_scheduler is not None else {})
                    if 'coverage_review' in body:
                        if source != 'trinity' or 'review_source' in body:
                            raise ValueError('Invalid coverage review route')
                        result=await self.generate_inference(self.workers[source],body['goal'],coverage_review=body['coverage_review'],**scheduled)
                    elif 'review_source' in body:
                        result=await self.generate_inference(self.workers[source],body['goal'],review_source=body['review_source'],**scheduled)
                    else:
                        result=await self.generate_inference(self.workers[source],body['goal'],**scheduled)
            elif msg.task == 'task' and msg.to_agent == AgentName.MEROVINGIAN and body.get('operation','').startswith(('letta_', 'document_')):
                if self.memory_adapter is None: raise RuntimeError('Memory adapter unavailable')
                operation=body.get('operation')
                # PrimaryMemoryStore owns this namespace and its schema/journal.
                # Raw document writes must not bypass those recovery invariants.
                if operation in {'letta_write', 'document_write', 'letta_read', 'document_read'}:
                    block = body.get('block')
                    if type(block) is not str or block.startswith('memory-'):
                        raise ValueError('Recovery-managed memory document is protected')
                if operation in {'letta_write','document_write'}: result={'status':'completed','id':await asyncio.to_thread(self.memory_adapter.write,body['block'],body['content'])}
                elif operation in {'letta_read','document_read'}: result={'status':'completed','content':await asyncio.to_thread(self.memory_adapter.read,body['block'])}
                elif operation in {'letta_search','document_search'}: result={'status':'completed','matches':await asyncio.to_thread(self.memory_adapter.search,body['query'])}
                else: raise ValueError('Unknown document operation')
                result['backend'] = getattr(self.memory_adapter, 'backend', 'letta')
            elif msg.task == 'learning' and msg.to_agent == AgentName.MEROVINGIAN:
                result=await asyncio.to_thread(worker.runtime.run_learning,body)
            elif msg.task == 'task' and msg.to_agent == AgentName.SMITH and body.get('operation') == 'run_workspace_python':
                manager = getattr(self, 'work_sessions', None)
                if manager is None: raise RuntimeError('Work session service unavailable')
                result = await manager.execute_python(body, msg.payload['_credential'])
            elif msg.task == 'task':
                method='run_memory' if worker.knight=='merovingian' else 'run_'+worker.knight
                result=await asyncio.to_thread(getattr(worker.runtime,method),body)
            else: raise ValueError('Unknown operation')
            assert_output_safe(json.dumps(result, ensure_ascii=False))
            status = result.get('status') if isinstance(result, dict) else None
            outcome = 'denied' if status == 'denied' else 'failed' if status in {'failed', 'cancelled', 'blocked', 'incomplete', 'evidence_rejected'} else 'review_candidate' if status == 'review_candidate' else 'completed'
            self.sentinel.log(msg,outcome)
            if not future.done(): future.set_result(result)
        except Exception as exc:
            self.sentinel.log(msg,'denied' if isinstance(exc, PermissionError) else 'failed')
            if not future.done(): future.set_exception(exc)

    @staticmethod
    def _model_tier(knight):
        from desktop_task_graph import WORKER_MODEL_TIER
        # Architect owns planning/conversation and uses the general tier. The
        # Machine never asks itself to generate.
        return 'general_8b' if knight in {'sentinel', 'architect'} else WORKER_MODEL_TIER[knight]
