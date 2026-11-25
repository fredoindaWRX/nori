"""Best-effort ordered Core shutdown; one failure cannot skip later cleanup."""


def initialize_core_services(config, gateway, token, loop, data_root):
    import asyncio
    from pathlib import Path
    from work_sessions import WorkSessionManager
    from orchestration.wsl_python_runner import WslPythonRunner, CONFIG as WSL_RUNNER_CONFIG
    from sensory_runtime import SensoryRuntime
    from hardware.sensor_adapters import adapter_registry
    from proactive_routines import ProactiveRoutineService
    data_root = Path(data_root)
    asyncio.run_coroutine_threadsafe(gateway.start(), loop).result(10)
    runner = WslPythonRunner.configured() if WSL_RUNNER_CONFIG.is_file() else None
    gateway.work_sessions = WorkSessionManager(gateway, data_root / 'work-sessions', python_runner=runner)
    sensory = SensoryRuntime(config, gateway, adapters=adapter_registry(data_root / 'sensory' / 'frames'))
    gateway.sensory_runtime = sensory
    async def dispatch(goal, *, request_id, conversation_id):
        return await gateway.work_sessions.create(goal, token, conversation_id=conversation_id, request_id=request_id)
    async def probe(sensor_type):
        return await gateway.request('tank', 'task', {'operation': 'query_senses', 'type': sensor_type}, token)
    gateway.proactive_routines = ProactiveRoutineService(data_root / 'proactive' / 'routines.sqlite3', dispatch, probe=probe)
    return sensory


def close_core_services(loop, thread, gateway, servers, sensory=None, memory=None):
    failures = []
    def attempt(name, callback):
        try:
            result = callback()
            if result is False:
                failures.append(name)
        except Exception:
            failures.append(name)  # Never include credentials or private exception bodies.
    def stop_async(service, timeout):
        import asyncio
        future = asyncio.run_coroutine_threadsafe(service.stop(), loop)
        try:
            return future.result(timeout)
        except Exception:
            future.cancel()
            raise
    # Refuse new requests before tearing down their dispatch services.
    if getattr(gateway, 'sentinel', None) is not None:
        gateway.sentinel.locked = True
    for server in reversed(servers):
        attempt('http_shutdown', server.shutdown)
        attempt('http_close', server.server_close)
    if memory is not None:
        attempt('memory_reconciliation', memory.stop)
    if sensory is not None:
        def stop_sensory():
            result = sensory.stop()
            return result.get('stopped') is True and result.get('publisher_stopped') is True
        attempt('sensory', stop_sensory)
    for field, timeout in [('proactive_routines', 10), ('work_sessions', 20)]:
        service = getattr(gateway, field, None)
        if service is not None:
            attempt(field, lambda service=service, timeout=timeout: stop_async(service, timeout))
    attempt('gateway', lambda: stop_async(gateway, 15))
    attempt('event_loop_stop', lambda: loop.call_soon_threadsafe(loop.stop))
    attempt('event_loop_join', lambda: thread.join(5))
    if thread.is_alive():
        failures.append('event_loop_still_running')
    else:
        attempt('event_loop_close', loop.close)
    return failures
