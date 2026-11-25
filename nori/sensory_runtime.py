"""Council lifecycle integration for Tank's cached read-only senses."""
import asyncio
import json
import queue
import threading
from bus import AgentName
from hardware.sensory import SensoryLayer


class SensoryRuntime:
    def __init__(self, config, gateway, adapters):
        self.gateway = gateway
        self.events = queue.Queue(maxsize=128)
        self.stop_event = threading.Event()
        self.thread = None
        self.dropped_events = 0
        self.delivery_failures = 0
        self.layer = SensoryLayer(config.get('sensors', []), adapters, self.publish)
        self.tank = gateway.workers['tank'].runtime.tank_worker
        self.tank.sensory = self.layer

    def status(self):
        """Return runtime health without returning sensor payloads."""
        return {
            'running': self.thread is not None and self.thread.is_alive(),
            'configured_sensors': [
                {'id': spec['id'], 'type': spec['type'], 'driver': spec.get('driver'),
                 'enabled': True}
                for spec in self.layer._sensors.values()
            ],
            'configured_count': len(self.layer._sensors),
            'publisher_queue_dropped': self.dropped_events,
            'publisher_delivery_failures': self.delivery_failures,
        }

    def publish(self, event):
        try:
            self.events.put_nowait(event)
        except queue.Full:
            self.dropped_events += 1

    def _deliver(self):
        while not self.stop_event.is_set():
            try:
                event = self.events.get(timeout=.2)
            except queue.Empty:
                continue
            future = asyncio.run_coroutine_threadsafe(
                self.gateway.request('merovingian', 'SENSOR_DATA', event,
                                     self.gateway.sentinel.token, sender=AgentName.TANK),
                self.gateway.loop)
            try:
                future.result(timeout=5)
            except Exception:
                future.cancel()
                self.delivery_failures += 1
            finally:
                self.events.task_done()

    def start(self):
        if not self.tank.policy.decide('hardware_read').allowed:
            raise PermissionError('Tank hardware_read permission required for sensor polling')
        if self.thread is not None:
            raise RuntimeError('Sensory runtime already started')
        self.thread = threading.Thread(target=self._deliver, daemon=True, name='sensor-bus-publisher')
        self.thread.start()
        self.layer.start()

    def stop(self):
        self.stop_event.set()
        result = self.layer.stop()
        if self.thread:
            self.thread.join(6)
        return {**result, 'dropped_events': self.dropped_events,
                'delivery_failures': self.delivery_failures,
                'publisher_stopped': self.thread is None or not self.thread.is_alive()}
