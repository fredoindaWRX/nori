"""Connect typed dispatch to each active Core role's owned service.

Call once during startup, after the primary memory service is installed and
before accepting requests. This does not change inference or permission gates.
"""

ROLE_SERVICES = {
    'architect': 'architect_worker', 'merovingian': 'memory_worker',
    'sentinel': 'sentinel_worker', 'tank': 'tank_worker',
    'machine': 'machine_worker', 'oracle': 'oracle_worker',
    'keymaker': 'keymaker_worker', 'trinity': 'trinity_worker',
    'neo': 'neo_worker', 'morpheus': 'morpheus_worker',
    'smith': 'smith_worker', 'apoc': 'apoc_worker',
}


def connect_native_workers(workers):
    # Resolve every dependency before mutation: an incomplete roster must not
    # leave a partially connected Core. Preserve each owner's service policy.
    runtimes = {role: workers[role].runtime for role in ROLE_SERVICES}
    services = {field: getattr(runtimes[role], field)
                for role, field in ROLE_SERVICES.items()}
    learning = runtimes['merovingian'].learning_runtime
    if any(service is None for service in services.values()) or learning is None:
        raise ValueError('Native Core service is missing')
    for runtime in runtimes.values():
        for field, service in services.items():
            setattr(runtime, field, service)
        runtime.learning_runtime = learning
    services['keymaker_worker'].oracle = services['oracle_worker']
