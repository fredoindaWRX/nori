"""Optional sensor backends. Imports occur only when a configured device polls."""
import asyncio
from datetime import datetime, timezone
import hashlib
import io
import os
from pathlib import Path
import re
import tempfile
import wave


def microphone_reader(frame_root):
    """Capture a bounded mono sample; retain only the latest WAV per sensor."""
    root = Path(frame_root)
    def read(spec):
        import sounddevice as sd
        import numpy as np
        source = spec.get('source')
        if isinstance(source, str) and source.isdigit():
            source = int(source)
        info = sd.query_devices(source, 'input')
        if spec.get('expected_name') and info['name'] != spec['expected_name']:
            raise ValueError('Microphone device index changed; reselect the named device')
        rate = int(info['default_samplerate'])
        if not 8000 <= rate <= 192000:
            raise ValueError('Unsupported microphone sample rate')
        with sd.InputStream(device=source, samplerate=rate, channels=1, dtype='int16') as stream:
            samples, overflow = stream.read(rate)
        if overflow:
            raise RuntimeError('Microphone input overflow')
        output = io.BytesIO()
        with wave.open(output, 'wb') as wav:
            wav.setnchannels(1)
            wav.setsampwidth(2)
            wav.setframerate(rate)
            wav.writeframes(samples.tobytes())
        raw = output.getvalue()
        root.mkdir(parents=True, exist_ok=True)
        path = root / (spec['id'] + '.wav')
        temporary = path.with_suffix('.tmp')
        temporary.write_bytes(raw)
        temporary.replace(path)
        normalized = samples.astype(np.float64) / 32768
        return {'frame_ref': str(path), 'sha256': hashlib.sha256(raw).hexdigest(),
                'duration_seconds': 1, 'sample_rate': rate, 'channels': 1,
                'rms': float(np.sqrt(np.mean(normalized ** 2))),
                'peak': float(np.max(np.abs(normalized))),
                'source_name': info['name'], 'transcript': None,
                'wake_word_detected': None, 'interpretation_status': 'not_analyzed'}
    return read


def opencv_reader(frame_root):
    """Return a single-frame OpenCV reader with bounded, atomic evidence output.

    OpenCV is deliberately imported inside ``read`` so machines without a
    configured vision sensor do not need the optional dependency.  The adapter
    captures and encodes one frame only; image interpretation belongs to a
    separate, explicitly invoked vision capability.
    """
    root = Path(frame_root).resolve()

    def read(spec):
        if 'source' not in spec:
            raise ValueError('OpenCV sensor requires an explicit source')
        source = spec['source']
        if isinstance(source, bool) or source is None:
            raise ValueError('OpenCV sensor source must be a device index or nonempty URI')
        if isinstance(source, str):
            source = source.strip()
            if not source:
                raise ValueError('OpenCV sensor source must be a device index or nonempty URI')
            if source.isdecimal():
                source = int(source)
        elif type(source) is not int:
            raise ValueError('OpenCV sensor source must be a device index or nonempty URI')

        sensor_id = spec.get('id')
        if not isinstance(sensor_id, str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,64}', sensor_id):
            raise ValueError('Invalid OpenCV sensor ID')
        max_pixels = spec.get('max_pixels', 3840 * 2160)
        max_encoded_bytes = spec.get('max_encoded_bytes', 8 * 1024 * 1024)
        if type(max_pixels) is not int or not 1 <= max_pixels <= 33_177_600:
            raise ValueError('OpenCV max_pixels is invalid')
        if type(max_encoded_bytes) is not int or not 1024 <= max_encoded_bytes <= 32 * 1024 * 1024:
            raise ValueError('OpenCV max_encoded_bytes is invalid')

        # Optional dependency: never imported unless this configured sensor polls.
        import cv2

        capture = cv2.VideoCapture()
        source_label = repr(source)
        try:
            # Keep backend buffering and I/O waits bounded where the installed
            # OpenCV backend exposes these properties. Unsupported properties
            # simply return false and are safe to ignore.
            for constant, value in (
                ('CAP_PROP_BUFFERSIZE', 1),
                ('CAP_PROP_OPEN_TIMEOUT_MSEC', 2000),
                ('CAP_PROP_READ_TIMEOUT_MSEC', 2000),
            ):
                prop = getattr(cv2, constant, None)
                if prop is not None:
                    capture.set(prop, value)
            if not capture.open(source) or not capture.isOpened():
                raise OSError(f'OpenCV source {source_label} could not be opened')
            ok, frame = capture.read()
            if not ok or frame is None:
                raise OSError(f'OpenCV source {source_label} returned no frame')
        finally:
            if capture is not None:
                capture.release()

        shape = getattr(frame, 'shape', ())
        if len(shape) not in (2, 3):
            raise ValueError('OpenCV source returned an invalid frame shape')
        height, width = int(shape[0]), int(shape[1])
        channels = 1 if len(shape) == 2 else int(shape[2])
        if width < 1 or height < 1 or channels not in (1, 3, 4):
            raise ValueError('OpenCV source returned invalid frame dimensions')
        if width * height > max_pixels:
            raise ValueError('OpenCV frame exceeds configured pixel limit')

        encoded_ok, encoded = cv2.imencode('.jpg', frame)
        if not encoded_ok or encoded is None:
            raise RuntimeError('OpenCV frame JPEG encoding failed')
        raw = encoded.tobytes()
        if not raw or len(raw) > max_encoded_bytes:
            raise ValueError('OpenCV encoded frame exceeds configured byte limit')

        root.mkdir(parents=True, exist_ok=True)
        path = (root / f'{sensor_id}.jpg').resolve()
        if path.parent != root:
            raise ValueError('OpenCV frame path escaped configured root')
        temporary = None
        try:
            with tempfile.NamedTemporaryFile(
                mode='wb', dir=root, prefix=f'.{sensor_id}-', suffix='.tmp', delete=False
            ) as output:
                temporary = Path(output.name)
                output.write(raw)
                output.flush()
                os.fsync(output.fileno())
            os.replace(temporary, path)
            temporary = None
        finally:
            if temporary is not None:
                temporary.unlink(missing_ok=True)

        return {
            'frame_ref': str(path),
            'sha256': hashlib.sha256(raw).hexdigest(),
            'width': width,
            'height': height,
            'channels': channels,
            'format': 'jpeg',
            'captured_at': datetime.now(timezone.utc).isoformat(),
            'capture': {'driver': 'opencv', 'source_type': 'device' if type(source) is int else 'uri'},
            'interpretation_status': 'not_analyzed',
        }

    return read


def read_ble(spec):
    from bleak import BleakScanner
    async def scan():
        discovered = await BleakScanner.discover(timeout=2, return_adv=True)
        return {'ble_devices': [
            {'address': device.address, 'name': advertisement.local_name or device.name,
             'rssi_dbm': advertisement.rssi,
             'service_uuids': list(advertisement.service_uuids)}
            for device, advertisement in list(discovered.values())[:64]],
            'scan_seconds': 2,
            'identity_verified': False}
    return asyncio.run(scan())


def read_gps(spec):
    import serial
    import pynmea2
    with serial.Serial(spec['source'], baudrate=int(spec.get('baudrate', 9600)), timeout=1) as port:
        line = port.read_until(b'\n', size=1024).decode('ascii').strip()
    sentence = pynmea2.parse(line, check=True)
    if sentence.sentence_type == 'RMC' and sentence.status == 'A':
        return {'lat': sentence.latitude, 'lon': sentence.longitude,
                'speed_kmh': float(sentence.spd_over_grnd or 0) * 1.852,
                'heading': float(sentence.true_course) if sentence.true_course else None,
                'fix_source': 'gps', 'sentence_type': 'RMC'}
    if sentence.sentence_type == 'GGA' and int(sentence.gps_qual or 0) > 0:
        return {'lat': sentence.latitude, 'lon': sentence.longitude,
                'altitude': float(sentence.altitude), 'fix_source': 'gps', 'sentence_type': 'GGA'}
    raise ValueError('No valid GPS fix in received sentence')


def read_host_network(spec):
    """Read local link state without probing the network or exposing addresses."""
    import psutil

    interfaces = []
    for name, stats in sorted(psutil.net_if_stats().items(), key=lambda item: item[0].lower()):
        lowered = name.lower()
        if lowered == 'lo' or 'loopback' in lowered:
            continue
        speed = stats.speed
        interfaces.append({
            'name': str(name)[:80],
            'up': bool(stats.isup),
            'speed_mbps': int(speed) if isinstance(speed, (int, float)) and speed >= 0 else None,
        })
    interfaces = interfaces[:32]
    return {
        'interfaces': interfaces,
        'interface_count': len(interfaces),
        'interfaces_up': sum(1 for interface in interfaces if interface['up']),
        'link_detected': any(interface['up'] for interface in interfaces),
        'scope': 'host_interface_link_only',
    }


def adapter_registry(frame_root=None):
    # The vehicle parser is imported with the registry, but pyserial itself is
    # still imported only when a configured vehicle sensor is actually polled.
    from .vehicle_sensor_adapter import read_vehicle_serial
    from .environment_sensor_adapter import read_environment_serial

    adapters = {
        'bleak': read_ble,
        'pynmea2': read_gps,
        'vehicle_serial': read_vehicle_serial,
        # Preserve the build-plan name without coupling the parser to one
        # scanner vendor. Both names use the same bounded, read-only contract.
        'foxwell_serial': read_vehicle_serial,
        # One explicitly typed, vendor-neutral serial contract for motion,
        # range and ambient frames. The reader never transmits device bytes.
        'environment_serial': read_environment_serial,
        'sensor_serial': read_environment_serial,
        'host_network': read_host_network,
    }
    if frame_root is not None:
        adapters['sounddevice'] = microphone_reader(frame_root)
        adapters['opencv'] = opencv_reader(frame_root)
    return adapters
