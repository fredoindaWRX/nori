"""Read-only sensor registry, isolated polling cadence and cached world snapshots."""
from copy import deepcopy
from datetime import datetime, timezone
import json
import math
import re
import threading
import time

TYPES = frozenset(('vision', 'position', 'motion', 'range', 'ambient', 'network', 'audio', 'vehicle'))


class SensoryLayer:
    def __init__(self, sensors, adapters, publish=None, clock=time.monotonic):
        self._clock = clock
        self._publish = publish
        self._lock = threading.RLock()
        self._stop = threading.Event()
        self._threads = []
        self._sensors = {}
        self._readers = {}
        self._latest = {}
        self._observed = {}
        for raw in sensors:
            spec = deepcopy(raw)
            if spec.get('enabled', True) is False:
                continue
            sid = spec.get('id')
            interval = spec.get('interval', 1)
            if not isinstance(sid, str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,64}', sid):
                raise ValueError('Invalid sensor ID')
            if sid in self._sensors or spec.get('type') not in TYPES:
                raise ValueError('Duplicate sensor or unsupported type')
            if type(interval) not in (int, float) or not math.isfinite(interval) or not .05 <= interval <= 3600:
                raise ValueError('Sensor interval must be between .05 and 3600 seconds')
            spec['interval'] = float(interval)
            self._sensors[sid] = spec
            self._readers[sid] = adapters.get(spec.get('driver'))

    def poll(self, sensor_id):
        spec = self._sensors[sensor_id]
        status, data, reason = 'ok', {}, None
        reader = self._readers[sensor_id]
        try:
            if reader is None:
                raise LookupError('driver_unavailable')
            data = reader(deepcopy(spec))
            if not isinstance(data, dict):
                raise ValueError('invalid_sensor_data')
            encoded = json.dumps(data, allow_nan=False)
            if len(encoded.encode('utf-8')) > 65536:
                raise ValueError('sensor_payload_too_large')
            data = json.loads(encoded)
        except Exception as error:
            status, data = 'degraded', {}
            reason = 'driver_unavailable' if reader is None else type(error).__name__
        item = {'sensor_id': sensor_id, 'type': spec['type'],
                'timestamp': datetime.now(timezone.utc).isoformat(), 'data': data, 'status': status}
        if reason:
            item['reason'] = reason
        with self._lock:
            self._latest[sensor_id] = item
            self._observed[sensor_id] = self._clock()
        if self._publish:
            try:
                self._publish({'event': 'SENSOR_DATA', **deepcopy(item)})
            except Exception:
                # Delivery failure must not kill sensor polling or falsify hardware state.
                with self._lock:
                    self._latest[sensor_id]['delivery_status'] = 'failed'
        return deepcopy(item)

    def query(self, type='all'):
        if type != 'all' and type not in TYPES:
            raise ValueError('Unsupported sensory query')
        with self._lock:
            readings = []
            for sid, spec in self._sensors.items():
                if type != 'all' and spec['type'] != type:
                    continue
                item = deepcopy(self._latest.get(sid, {
                    'sensor_id': sid, 'type': spec['type'], 'timestamp': None,
                    'data': {}, 'status': 'unavailable', 'reason': 'not_polled'}))
                if sid in self._observed:
                    age = max(0, self._clock() - self._observed[sid])
                    item['age_seconds'] = age
                    if item['status'] == 'ok' and age > max(1, spec['interval'] * 3):
                        item['status'] = 'stale'
                readings.append(item)
        grouped = {}
        for item in readings:
            grouped.setdefault(item['type'], []).append(item)
        return {'timestamp': datetime.now(timezone.utc).isoformat(),
                'sensors_active': [r['sensor_id'] for r in readings if r['status'] == 'ok'],
                'sensors_degraded': [r['sensor_id'] for r in readings if r['status'] != 'ok'],
                'data': grouped}

    def _loop(self, sid):
        while not self._stop.is_set():
            started = self._clock()
            self.poll(sid)
            self._stop.wait(max(.01, self._sensors[sid]['interval'] - (self._clock() - started)))

    def start(self):
        if self._threads:
            raise RuntimeError('Sensory layer already started')
        self._stop.clear()
        for sid in self._sensors:
            thread = threading.Thread(target=self._loop, args=(sid,), daemon=True, name='sensor-' + sid)
            self._threads.append(thread)
            thread.start()

    def stop(self, timeout=3):
        self._stop.set()
        deadline = time.monotonic() + timeout
        for thread in self._threads:
            thread.join(max(0, deadline - time.monotonic()))
        alive = [t.name for t in self._threads if t.is_alive()]
        if not alive:
            self._threads.clear()
        return {'stopped': not alive, 'blocked_drivers': alive}
