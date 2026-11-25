"""Structural reader for observed Foxwell NDS v1 recordings.

Units and ranges are scanner metadata, not validated service specifications.
Sample order is preserved; no sampling frequency or wall-clock time is inferred.
"""
import hashlib
import struct
import json
import math
import statistics


def recording_report(data):
    decoded = decode_recording(data)
    lines = ['Foxwell live-data recording',
             'Source SHA-256: ' + decoded['source_sha256'],
             f"Samples: {len(decoded['samples'])}; channels: {len(decoded['channels'])}",
             'Validation: structure only; NOT compared against scanner playback.',
             'Values are scanner-reported, possibly asynchronous. No fixed sample rate is assumed.',
             'Units are supplied by the scanner. These are observations, not service specifications or a diagnosis.',
             'All samples contribute to numeric summaries; first/last are sample order, not timestamps.']
    for index, channel in enumerate(decoded['channels']):
        values = [row[index] for row in decoded['samples']]
        numbers = []
        for value in values:
            try:
                number = float(value)
                if math.isfinite(number): numbers.append(number)
            except ValueError:
                pass
        item = {'index': index, 'channel': channel['name'], 'unit': channel['unit'], 'first': values[0], 'last': values[-1]}
        if numbers:
            item.update(numeric_samples=len(numbers), minimum=min(numbers), maximum=max(numbers), median=statistics.median(numbers))
        else:
            unique = list(dict.fromkeys(values))
            item.update(states=unique[:12], states_truncated=len(unique)>12)
        lines.append(json.dumps(item, ensure_ascii=False))
    report = '\n'.join(lines)
    if len(report) > 40000:
        raise ValueError('Recording summary exceeds report limit; no partial report imported')
    tail = []
    used = len(report) + 400
    for index in range(len(decoded['samples'])-1, max(-1, len(decoded['samples'])-51), -1):
        row = json.dumps({'sample_index': index, 'values': decoded['samples'][index]}, ensure_ascii=False, separators=(',', ':'))
        if used + len(row) + 1 > 40000: break
        tail.append(row)
        used += len(row) + 1
    report += ('\nFinal recorded samples in original order; values map to channel indices above. '
               f'Showing {len(tail)} of {len(decoded["samples"])} samples. '
               'Earlier rows are summarized above, not reproduced. This is not a synchronized waveform.\n' + '\n'.join(reversed(tail)))
    return {'report': report, 'sample_count': len(decoded['samples']), 'channel_count': len(decoded['channels']),
            'source_sha256': decoded['source_sha256'], 'playback_verified': False, 'detail_sample_count': len(tail)}


def decode_recording(data):
    if not isinstance(data, bytes) or not 28 <= len(data) <= 20 * 1024 * 1024:
        raise ValueError('Recording must contain 28 bytes to 20 MB')
    version, count, reserved, index = struct.unpack_from('>fIII', data)
    if version != 1.0 or reserved != 0 or not 1 <= count <= 100000:
        raise ValueError('Unsupported recording header')
    if index < 28 or index + count * 4 != len(data):
        raise ValueError('Truncated recording or invalid sample index')
    position = 16
    blocks = []
    for _ in range(3):
        if position + 4 > index:
            raise ValueError('Truncated metadata')
        size = struct.unpack_from('>I', data, position)[0]
        position += 4
        if size > 65536 or position + size > index:
            raise ValueError('Invalid metadata length')
        blocks.append(data[position:position + size].decode('utf-8'))
        position += size
    if not blocks[0].startswith('NDS\u258e'):
        raise ValueError('Unsupported recording type')
    channels = [entry.split('\u258f') for entry in blocks[2].split('\u258e')]
    if not 1 <= len(channels) <= 512 or any(len(c) != 5 for c in channels):
        raise ValueError('Invalid channel definitions')
    if [c[0] for c in channels] != [str(i) for i in range(len(channels))]:
        raise ValueError('Channel identifiers are not sequential')
    lengths = struct.unpack_from('<' + 'I' * count, data, index)
    if any(n == 0 for n in lengths) or sum(lengths) != index - position:
        raise ValueError('Sample lengths do not account for the data')
    samples = []
    for size in lengths:
        values = data[position:position + size].decode('utf-8').split('\u258e')
        position += size
        if len(values) != len(channels):
            raise ValueError('Sample does not match channel count')
        samples.append(values)
    return {'source_sha256': hashlib.sha256(data).hexdigest(),
            'channels': [{'name': c[1], 'display_range': c[2], 'unit': c[3]} for c in channels],
            'samples': samples, 'validation': 'structural_only',
            'playback_verified': False}
