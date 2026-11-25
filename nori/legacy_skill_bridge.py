"""Explicit adapters for original NORI skills; no arbitrary module execution API."""
import importlib.util
from pathlib import Path


def aircrack_inventory():
    source = Path(__file__).resolve().parent.parent / 'aircrack_skill.py'
    spec = importlib.util.spec_from_file_location('nori_original_aircrack', source)
    if spec is None or spec.loader is None:
        raise RuntimeError('Original Aircrack skill unavailable')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    result = module.aircrack_status()
    portable = Path(__file__).resolve().parent / 'tools/portable/aircrack-ng-1.7-win/bin/aircrack-ng.exe'
    return {'status': 'completed', 'skill': 'aircrack', 'adapter_available': True,
            'inventory': result, 'executed_programs': False,
            'portable_executable': str(portable) if portable.is_file() else None,
            'portable_present': portable.is_file(),
            'scope': 'PATH inventory plus known portable executable discovery. Presence does not prove current execution permission or wireless adapter support.'}
