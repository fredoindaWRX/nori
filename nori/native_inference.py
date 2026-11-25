"""Explicit qualified native Core boot configuration, not a model alias map."""
import os
from pathlib import Path
import sys


def configure_native_inference(config, environment=None):
    environment = os.environ if environment is None else environment
    native = config.get('native_inference')
    mode = environment.get('NORI_INFERENCE_RUNTIME', 'norllama' if native else 'ollama-rollback')
    if mode == 'ollama-rollback':
        if native:
            raise ValueError('native Core configuration cannot silently use rollback')
        return None
    if mode != 'norllama' or not isinstance(native, dict) or set(native) != {'model_id', 'assignments'}:
        raise ValueError('explicit native Core model assignments required')
    assignments = native['assignments']
    if (not isinstance(assignments, dict) or set(assignments) != set(config['knights'])
            or any(model != native['model_id'] for model in assignments.values())):
        raise ValueError('each Knight needs an explicit qualified native model assignment')
    # Module location derives from installed Nori, never current working directory.
    source = Path(__file__).resolve().parents[1] / 'runtime' / 'norllama'
    if str(source) not in sys.path:
        sys.path.insert(0, str(source))
    from core_client import NativeInferenceClient
    client = NativeInferenceClient(environment.get('NORI_RUNTIME_URL', ''),
                                   environment.get('NORI_RUNTIME_API_KEY', ''), native['model_id'])
    client.health()  # Fail before tool workers, listener ports or production state.
    return client
