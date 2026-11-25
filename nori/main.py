"""Start NORI's twelve local worker services, or one container worker."""
import argparse
import asyncio
import hmac
import json
import os
from pathlib import Path
import subprocess
import sys
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import socket
from urllib.request import Request, urlopen
from nori_installation_paths import core_installation_root
from security.hard_floor import load_hard_floor, assert_network_allowed, open_url

ROOT = core_installation_root(Path(__file__).resolve().parent)
sys.path.insert(0, str(ROOT / "shared"))


class CouncilHTTPServer(ThreadingHTTPServer):
    """Never allow two Windows council instances to share a listening port."""
    allow_reuse_address = os.name != 'nt'

    def server_bind(self):
        if os.name == 'nt':
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        super().server_bind()


async def run_round_table(factories, stop_event=None, on_ready=None, startup_timeout=30, watchdog=None):
    """Run host-provided lifecycle adapters together on one shared bus.

    Each factory takes the bus. Adapters expose async start()/stop() and a
    listener_task that remains alive while receiving messages. Sentinel also
    implements check()/log_denial(). This does not invent missing adapters or
    perform TPM enrollment. The existing HTTP launcher remains separate.
    """
    from bus import AgentName, MessageBus
    from bus_watchdog import BusWatchdog
    order = list(AgentName)
    factories = {AgentName(name): factory for name, factory in factories.items()}
    if set(factories) != set(order):
        raise ValueError("Provide lifecycle adapters for all twelve Knights")
    watchdog = watchdog or BusWatchdog(ROOT / "runtime-data" / "bus-watchdog.jsonl")
    bus = MessageBus(watchdog=watchdog)
    watchdog.start()
    started = []
    stop_waiter = None
    try:
        for name in order:
            agent = factories[name](bus)
            started.append(agent)  # Also clean up a partially started adapter.
            await asyncio.wait_for(agent.start(), timeout=startup_timeout)
            listener = agent.listener_task
            if not isinstance(listener, asyncio.Task) or listener.done():
                raise RuntimeError(f"{name.value} has no running listener")
            if name == AgentName.SENTINEL:
                if not callable(getattr(agent, "check", None)) or not callable(getattr(agent, "log_denial", None)):
                    raise TypeError("Sentinel adapter needs check and log_denial")
                bus.sentinel = agent
        # A previously started listener could have failed during later startup.
        if any(agent.listener_task.done() for agent in started):
            raise RuntimeError("A listener exited during council startup")
        if on_ready is not None:
            on_ready(bus)
        stop_waiter = asyncio.create_task((stop_event or asyncio.Event()).wait())
        done, _ = await asyncio.wait(
            [stop_waiter] + [agent.listener_task for agent in started],
            return_when=asyncio.FIRST_COMPLETED)
        if any(agent.listener_task in done for agent in started):
            raise RuntimeError("A Knight listener exited; shutting down the council")
    finally:
        if stop_waiter is not None:
            stop_waiter.cancel()
            await asyncio.gather(stop_waiter, return_exceptions=True)
        # Continue cleanup even if an adapter fails to stop; Sentinel stays last.
        for agent in reversed(started):
            try:
                await asyncio.wait_for(agent.stop(), timeout=10)
            except Exception as exc:
                print(f"Adapter shutdown failed: {type(exc).__name__}", file=sys.stderr)
            finally:
                listener = getattr(agent, "listener_task", None)
                if isinstance(listener, asyncio.Task):
                    listener.cancel()
                    await asyncio.gather(listener, return_exceptions=True)
        bus.sentinel = None
        try:
            watchdog.stop()
        except Exception:
            pass


def load_config(path):
    # This config uses JSON syntax, a strict subset of YAML 1.2.
    config = json.loads(Path(path).read_text(encoding="utf-8"))
    from orchestration.knight_registry import EXPECTED_KNIGHTS
    if set(config["knights"]) != EXPECTED_KNIGHTS:
        raise ValueError("Configuration must contain all twelve Knights")
    order = config.get("startup_order", [])
    if len(order) != 12 or set(order) != EXPECTED_KNIGHTS or order[0] != "sentinel":
        raise ValueError("startup_order must contain each Knight once, Sentinel first")
    ports = [k["port"] for k in config["knights"].values()]
    if len(set(ports)) != 12 or any(type(p) is not int or not 1024 <= p <= 65535 for p in ports):
        raise ValueError("Knight ports must be distinct and between 1024 and 65535")
    models = config.get("models", {})
    if "assignments" in models and models["assignments"] != {n:k["model"] for n,k in config["knights"].items()}:
        raise ValueError("Model assignments disagree with worker configuration")
    for section, field, legacy in (("models", "ollama_base", "ollama_url"),
                                   ("memory", "letta_base", "letta_url"),
                                   ("memory", "chroma_base", "chroma_url")):
        if legacy in config and field in config.get(section, {}) and config[section][field] != config[legacy]:
            raise ValueError(f"{section}.{field} disagrees with {legacy}")
    bus = config.get("bus", {})
    if bus and (bus.get("sentinel_gate") is not True or
                type(bus.get("max_concurrent_tasks")) is not int or
                not 1 <= bus["max_concurrent_tasks"] <= 12):
        raise ValueError("Bus requires Sentinel and concurrency between 1 and 12")
    compute = config.get("compute", {})
    if compute:
        from packages.knights.machine.inference.compute_nodes import ComputeNodeRegistry
        registry = ComputeNodeRegistry.from_config(compute.get("nodes"))
        routing = compute.get("routing")
        if not isinstance(routing, dict) or not routing:
            raise ValueError("Compute routing must be a non-empty object")
        for task_type, route in routing.items():
            if (not isinstance(task_type, str) or not task_type or not isinstance(route, dict)
                    or set(route) != {"capability", "minimum_memory_gb", "prefer"}):
                raise ValueError("Compute route is invalid")
            # Validation also proves that each active route has a current node,
            # except future large-model tiers that are intentionally unassigned.
            if task_type != "large_reasoning":
                registry.select(route["capability"], route["minimum_memory_gb"], route["prefer"])
    hierarchy = config.get("models", {}).get("hierarchy")
    if hierarchy:
        from packages.knights.machine.inference.model_hierarchy import ModelHierarchy
        ModelHierarchy.from_config(hierarchy)
    return config


def model_ready(endpoint, model):
    try:
        from urllib.parse import urlsplit
        address = urlsplit(endpoint)
        if address.path not in {'', '/'} or address.query or address.fragment:
            return False
        with open_url(endpoint.rstrip('/') + "/api/tags", timeout=3) as response:
            models = json.load(response)["models"]
        return any(m["name"] in {model, model + ":latest"} for m in models)
    except Exception:
        return False


class Worker:
    def __init__(self, config, knight, native_inference=None):
        from orchestration.knight_runtime import KnightRuntime
        from permissions.nori_policy import Policy
        from orchestration.wsl_python_runner import CONFIG as WSL_RUNNER_CONFIG, WslPythonRunner
        self.knight, self.spec = knight, dict(config["knights"][knight])
        self.native_inference = native_inference
        if native_inference is not None:
            self.spec['model'] = config['native_inference']['assignments'][knight]
        self.endpoint = (native_inference.endpoint if native_inference is not None
                         else os.getenv("OLLAMA_URL", config["ollama_url"]).rstrip("/"))
        assert_network_allowed(self.endpoint)
        data = Path(os.getenv("NORI_DATA_ROOT", str(ROOT / "runtime-data"))) / knight
        # Typed tools use the existing runtime; chat uses Ollama's native API below.
        python_runner = WslPythonRunner.configured() if WSL_RUNNER_CONFIG.is_file() else None
        self.runtime = KnightRuntime(self.endpoint, self.spec["model"],
            Policy(self.spec["grants"]), data / "audit.jsonl", workspace_root=data / "workspace",
            owned_role=knight if native_inference is not None else None,
            python_runner=python_runner, compute_config=None if native_inference is not None else {**config.get("compute", {}),
                "model_hierarchy": config.get("models", {}).get("hierarchy")})
        self.runtime.configure_edition("home")
        if knight == "neo":
            # The installed project, not a model-provided path, selects the source root.
            self.runtime.neo_worker.project_root = ROOT.parent.resolve()
        from prompts.covenant import build_system_prompt
        self.prompt = build_system_prompt(knight, self.spec['role'], os.getenv('NORI_OWNER_FINGERPRINT'))

    def chat(self, goal):
        raise RuntimeError("Use the Sentinel-gated council gateway")


def handler(worker, token, gateway=None):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args): pass
        def native_admission(self):
            if getattr(worker, 'native_inference', None) is None:
                return True
            expected = f'127.0.0.1:{self.server.server_port}'
            if (self.headers.get('Host') != expected
                    or self.headers.get('Origin', f'http://{expected}') != f'http://{expected}'
                    or self.headers.get('Sec-Fetch-Site', 'none') not in {'none', 'same-origin'}):
                self.reply(403, {'error': 'local_origin_required'})
                return False
            if self.path != '/live' and not hmac.compare_digest(self.headers.get('Authorization', ''), 'Bearer ' + token):
                self.reply(401, {'error': 'unauthorized'})
                return False
            return True
        def reply(self, code, body):
            data=json.dumps(body).encode(); self.send_response(code)
            self.send_header("Content-Type","application/json")
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Content-Length",str(len(data))); self.end_headers(); self.wfile.write(data)
        def do_GET(self):
            if not self.native_admission(): return
            from work_http import handle_work
            if handle_work(self, worker, token, gateway): return
            if self.path.startswith('/sensory'):
                if not hmac.compare_digest(self.headers.get("Authorization", ""), "Bearer " + token):
                    if gateway is not None:
                        from bus import Message, AgentName
                        gateway.sentinel.log(Message(AgentName.ARCHITECT, AgentName(worker.knight), 'sensory_query'), 'unauthorized')
                    return self.reply(401, {"error": "unauthorized"})
                if gateway is None or getattr(gateway, 'sensory_runtime', None) is None:
                    return self.reply(503, {"error": "sensory_runtime_unavailable"})
                from urllib.parse import urlsplit, parse_qs
                parsed = urlsplit(self.path)
                if parsed.path != '/sensory':
                    return self.reply(404, {"error": "not_found"})
                query = parse_qs(parsed.query, keep_blank_values=True)
                if set(query) - {'type'} or any(len(values) != 1 for values in query.values()):
                    return self.reply(400, {"error": "invalid_sensory_query"})
                sensor_type = query.get('type', ['all'])[0]
                try:
                    snapshot = gateway.sensory_runtime.tank.sensory.query(sensor_type)
                except ValueError:
                    return self.reply(400, {"error": "unsupported_sensory_type"})
                return self.reply(200, {"status": "completed", "snapshot": snapshot})
            if self.path == "/live":
                return self.reply(200, {"knight":worker.knight, "status":"listening"})
            if self.path != "/health": return self.reply(404,{"error":"not_found"})
            if getattr(worker, 'native_inference', None) is not None:
                try: ready = worker.native_inference.health()['ready']
                except Exception: ready = False
            else:
                ready=model_ready(worker.endpoint, worker.spec["model"])
            self.reply(200, {"status":"ready" if ready else "degraded", "knight":worker.knight,
                "model_ready":ready, "tools":worker.spec["tools"],
                "work_available":worker.knight == "architect" and getattr(gateway, "work_sessions", None) is not None,
                "work_runtime": (gateway.work_sessions.runtime_status() if worker.knight == 'architect'
                    and getattr(gateway, 'work_sessions', None) is not None else None),
                "sensory": (gateway.sensory_runtime.status()
                    if getattr(gateway, 'sensory_runtime', None) is not None else {'running': False, 'configured_count': 0}),
                "memory_reconciliation": (gateway.memory_reconciliation.status()
                    if getattr(gateway, 'memory_reconciliation', None) is not None else {'running': False}),
                "hard_floor":{"rules":14,"local_connections":True,
                              "unrestricted_execution":False,
                              "verified_remote_transport":False,
                              "owner_download_authority":False,
                              "physical_actuation":False}})
        def do_POST(self):
            if not self.native_admission(): return
            from work_http import handle_work
            if handle_work(self, worker, token, gateway): return
            if not hmac.compare_digest(self.headers.get("Authorization", ""), "Bearer " + token):
                if gateway is not None:
                    from bus import Message, AgentName
                    gateway.sentinel.log(Message(AgentName.ARCHITECT,AgentName(worker.knight),'http_request'), 'unauthorized')
                return self.reply(401,{"error":"unauthorized"})
            try:
                size=int(self.headers.get("Content-Length", "0"))
                if not 0 < size <= 1048576: return self.reply(413,{"error":"invalid_body_size"})
                body=json.loads(self.rfile.read(size))
                if not isinstance(body, dict): raise ValueError("Expected object")
                if gateway is None: return self.reply(503,{"error":"council_gateway_required"})
                if self.path in {"/chat", "/task"} or (self.path == '/learning' and worker.knight == 'merovingian'):
                    result=gateway.submit(worker.knight,self.path[1:],body,token)
                else: return self.reply(404,{"error":"not_found"})
                self.reply(200,result)
            except PermissionError:
                self.reply(403,{"error":"policy_denied"})
            except (ValueError, TypeError, KeyError) as exc:
                self.reply(400,{"error":type(exc).__name__})
            except Exception as exc:
                self.reply(503,{"error":type(exc).__name__})
    return Handler


def wait_for_worker(child, name, port, timeout=30):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if child.poll() is not None:
            raise RuntimeError(f"{name} exited during startup")
        try:
            with urlopen(f"http://127.0.0.1:{port}/live", timeout=1) as response:
                if json.load(response).get("knight") == name:
                    return
        except (OSError, ValueError):
            pass
        time.sleep(0.1)
    raise RuntimeError(f"{name} did not start within {timeout} seconds")


def stop_workers(children):
    # Wait for each later worker to exit before stopping Sentinel last.
    for child in reversed(children):
        if child.poll() is None:
            child.terminate()
        try:
            child.wait(timeout=10)
        except subprocess.TimeoutExpired:
            child.kill()
            child.wait()


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--config",default=str(ROOT / "config.yaml"))
    parser.add_argument("--knight")
    parser.add_argument("--check",action="store_true")
    parser.add_argument("--supervised",action="store_true",
                        help="Stop Core gracefully when its owning parent's stdin closes")
    parser.add_argument("--managed-native",action="store_true",
                        help="Owned native desktop candidate: ephemeral ports and no sensors")
    args=parser.parse_args(); config=load_config(args.config)
    load_hard_floor()
    if args.check:
        print("Validated twelve Knights and unique ports"); return
    token=os.getenv("NORI_API_TOKEN", "")
    if len(token)<32: raise SystemExit("Set NORI_API_TOKEN to a random secret of at least 32 characters")
    if args.knight:
        raise SystemExit("Individual HTTP processes are disabled: start main.py for the shared Sentinel bus")
    if args.managed_native:
        if not args.supervised or os.getenv('NORI_INFERENCE_RUNTIME') != 'norllama':
            raise SystemExit('Managed native Core requires supervised NorLlama ownership')
        from core_supervision import managed_native_config
        config = managed_native_config(config, os.getenv('NORI_RUNTIME_MODEL_ID'))
    from threading import Event
    stop_requested = Event()
    if args.supervised:
        from core_supervision import supervise_parent
        supervise_parent(sys.stdin.buffer, stop_requested)
    bind = os.getenv('NORI_BIND', '127.0.0.1')
    if args.managed_native and bind != '127.0.0.1':
        raise SystemExit('Managed native Core binds only IPv4 loopback')
    # Non-local exposure needs a verified transport/listener adapter first.
    from ipaddress import ip_address
    if bind != 'localhost' and not ip_address(bind).is_loopback:
        raise SystemExit('Verified Tailscale listener required for remote Council access')
    from council_gateway import CouncilGateway
    from threading import Thread
    from native_inference import configure_native_inference
    native_provider = configure_native_inference(config)
    workers={name:Worker(config,name,native_provider) for name in config['startup_order']}
    workers['machine'].runtime.machine_worker.native_provider = native_provider
    from memory.backend import configure_memory
    from memory.primary_memory import PrimaryMemoryStore
    from orchestration.merovingian_worker import MerovingianWorker
    merovingian_runtime = workers['merovingian'].runtime
    memory_adapter = configure_memory(config, ROOT, merovingian_runtime.memory_worker.store)
    primary_memory = PrimaryMemoryStore(memory_adapter, merovingian_runtime.memory_worker.store)
    merovingian_runtime.memory_worker = MerovingianWorker(primary_memory)
    from orchestration.core_workers import connect_native_workers
    connect_native_workers(workers)
    from memory.reconciliation_service import MemoryReconciliationService
    memory_reconciliation = MemoryReconciliationService(primary_memory)
    model_scheduler = None
    if native_provider is None:
        from packages.knights.machine.inference.router import OllamaBackend
        from packages.knights.machine.inference.scheduler import ModelScheduler
        model_scheduler = ModelScheduler(OllamaBackend(os.getenv('OLLAMA_URL', config['ollama_url'])))
    gateway=CouncilGateway(workers,token,Path(os.getenv('NORI_DATA_ROOT',str(ROOT/'runtime-data')))/'sentinel'/'bus-audit.sqlite3',memory_adapter=memory_adapter,model_scheduler=model_scheduler)
    gateway.memory_reconciliation = memory_reconciliation
    loop=asyncio.new_event_loop()
    thread=Thread(target=loop.run_forever,daemon=True); thread.start()
    from core_lifecycle import initialize_core_services, close_core_services
    try:
        sensory = initialize_core_services(config, gateway, token, loop,
                    Path(os.getenv('NORI_DATA_ROOT', str(ROOT/'runtime-data'))))
        from work_sessions import WorkSessionManager
        print('Work runtime loaded: ' + WorkSessionManager.RUNTIME_REVISION +
              ' from ' + sys.modules[WorkSessionManager.__module__].__file__, flush=True)
    except BaseException:
        close_core_services(loop, thread, gateway, [], getattr(gateway, 'sensory_runtime', None), memory_reconciliation)
        raise
    servers=[]
    try:
        sensory.start()
        memory_reconciliation.start()
        asyncio.run_coroutine_threadsafe(gateway.proactive_routines.start(), loop).result(10)
        for name in config['startup_order']:
            server=CouncilHTTPServer((bind,workers[name].spec['port']),handler(workers[name],token,gateway))
            servers.append(server)
            Thread(target=server.serve_forever,daemon=True).start()
        print('Twelve HTTP routes connected to shared Sentinel bus; token identity (not TPM)',flush=True)
        if args.managed_native:
            print(json.dumps({'runtime': 'NoriCore', 'backend': 'norama-independent',
                'model_id': native_provider.model_id,
                'ports': {name: server.server_port for name, server in zip(config['startup_order'], servers)},
                'sensors_enabled': 0, 'task_execution_qualified': False}), flush=True)
        while not stop_requested.wait(1):
            pass
    except KeyboardInterrupt: pass
    finally:
        from core_lifecycle import close_core_services
        failures = close_core_services(loop, thread, gateway, servers, sensory, memory_reconciliation)
        if failures:
            print('Core shutdown incomplete: ' + ', '.join(failures), flush=True)

if __name__ == "__main__": main()
