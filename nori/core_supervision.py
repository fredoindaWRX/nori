"""Owned-parent lifetime: stdin EOF requests orderly Core shutdown."""
from threading import Thread
from copy import deepcopy
import io
import os
import re


def managed_native_config(config, model_id):
    """Explicit desktop candidate, never an on-disk production-config rewrite.

    Sensors stay disabled until their own acceptance. Port zero asks the OS for
    distinct owned listeners, rather than adopting an existing local Council.
    """
    if not isinstance(model_id, str) or not re.fullmatch(r'[A-Za-z0-9._:-]{1,128}', model_id):
        raise ValueError('Managed Core requires an explicit native model identifier')
    candidate = deepcopy(config)
    candidate['native_inference'] = {'model_id': model_id,
        'assignments': {name: model_id for name in candidate['knights']}}
    candidate['sensors'] = []
    candidate.setdefault('memory', {})['backend'] = 'nori-sqlite'
    for spec in candidate['knights'].values():
        spec['port'] = 0
    return candidate


def watch_parent(stream, stop_event):
    try:
        while stream.read(1):
            pass
    finally:
        stop_event.set()


def supervise_parent(stream, stop_event):
    target = watch_parent
    if os.name == 'nt' and not isinstance(stream, io.BytesIO):
        # Never hold Python's buffered stdin lock in a daemon thread. An early
        # startup exception can otherwise abort interpreter finalization.
        import ctypes
        from ctypes import wintypes
        import msvcrt
        kernel = ctypes.WinDLL('kernel32', use_last_error=True)
        kernel.GetFileType.argtypes = [wintypes.HANDLE]
        kernel.GetFileType.restype = wintypes.DWORD
        kernel.PeekNamedPipe.argtypes = [wintypes.HANDLE, ctypes.c_void_p, wintypes.DWORD,
                                       ctypes.c_void_p, ctypes.POINTER(wintypes.DWORD), ctypes.c_void_p]
        kernel.PeekNamedPipe.restype = wintypes.BOOL
        kernel.ReadFile.argtypes = [wintypes.HANDLE, ctypes.c_void_p, wintypes.DWORD,
                                   ctypes.POINTER(wintypes.DWORD), ctypes.c_void_p]
        kernel.ReadFile.restype = wintypes.BOOL
        handle = wintypes.HANDLE(msvcrt.get_osfhandle(stream.fileno()))
        if kernel.GetFileType(handle) != 3:
            raise ValueError('Supervised Core requires its owning parent pipe')
        def target(_stream, event):
            buffer = ctypes.create_string_buffer(256)
            while not event.is_set():
                available = wintypes.DWORD()
                if not kernel.PeekNamedPipe(handle, None, 0, None, ctypes.byref(available), None):
                    event.set()
                    return
                if available.value:
                    received = wintypes.DWORD()
                    if not kernel.ReadFile(handle, buffer, min(256,available.value), ctypes.byref(received), None):
                        event.set()
                        return
                else:
                    event.wait(0.05)
    watcher = Thread(target=target, args=(stream, stop_event),
                     name='nori-core-parent-lifetime', daemon=True)
    watcher.start()
    return watcher
