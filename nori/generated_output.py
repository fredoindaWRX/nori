"""Admit bounded generated PNG/text output from a recorded successful run."""
import base64
import io
import json
from pathlib import Path


def decode_output(execution, filename):
    if not execution.get('executed') or execution.get('status')!='completed' or execution.get('exit_code')!=0 or execution.get('output_truncated'):
        raise ValueError('Export requires a successful, non-truncated execution')
    payload=json.loads(execution['stdout'])
    if not isinstance(payload,dict) or set(payload)!={'encoding','content'} or payload['encoding']!='base64':
        raise ValueError('Script stdout must contain only JSON with encoding=base64 and content')
    if not isinstance(payload['content'],str) or len(payload['content'])>120000:
        raise ValueError('Generated export exceeds 90 KB binary limit')
    raw=base64.b64decode(payload['content'],validate=True)
    if not raw or len(raw)>90000: raise ValueError('Generated output must contain 1 to 90000 bytes')
    suffix=Path(filename).suffix.lower()
    if suffix=='.png':
        from PIL import Image
        if not raw.startswith(b'\x89PNG\r\n\x1a\n'): raise ValueError('Output is not PNG')
        with Image.open(io.BytesIO(raw)) as image:
            if image.format!='PNG' or image.width*image.height>4_000_000: raise ValueError('PNG dimensions exceed limit')
            image.verify()
        validation='png_structure_and_readback; visual_accuracy_not_verified'
    elif suffix in {'.txt','.csv','.json'}:
        text=raw.decode('utf-8')
        if suffix=='.json': json.loads(text)
        validation='utf8_readback'
    else: raise ValueError('Generated export supports PNG, TXT, CSV and JSON')
    return raw,validation
