"""Windows process lifetime containment,not an OS security sandbox.

The runtime owns this Job Object handle. Windows closes it on runtime death and
kills only the native worker assigned to it. No process enumeration/name killing.
"""
import ctypes
from ctypes import wintypes
import os


class _BasicLimits(ctypes.Structure):
    _fields_ = [("process_time", ctypes.c_int64), ("job_time", ctypes.c_int64),
                ("flags", wintypes.DWORD), ("minimum_working_set", ctypes.c_size_t),
                ("maximum_working_set", ctypes.c_size_t), ("active_process_limit", wintypes.DWORD),
                ("affinity", ctypes.c_size_t), ("priority", wintypes.DWORD), ("scheduling", wintypes.DWORD)]


class _IoCounters(ctypes.Structure):
    _fields_ = [(name, ctypes.c_uint64) for name in
                ("read_operations", "write_operations", "other_operations", "read_bytes", "write_bytes", "other_bytes")]


class _ExtendedLimits(ctypes.Structure):
    _fields_ = [("basic", _BasicLimits), ("io", _IoCounters),
                ("process_memory", ctypes.c_size_t), ("job_memory", ctypes.c_size_t),
                ("peak_process_memory", ctypes.c_size_t), ("peak_job_memory", ctypes.c_size_t)]


class OwnedProcessJob:
    def __init__(self, process):
        if os.name != "nt":
            raise OSError("NorLlama currently requires Windows process containment")
        kernel = ctypes.WinDLL("kernel32", use_last_error=True)
        kernel.CreateJobObjectW.argtypes = [ctypes.c_void_p, wintypes.LPCWSTR]
        kernel.CreateJobObjectW.restype = wintypes.HANDLE
        kernel.SetInformationJobObject.argtypes = [wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD]
        kernel.SetInformationJobObject.restype = wintypes.BOOL
        kernel.AssignProcessToJobObject.argtypes = [wintypes.HANDLE, wintypes.HANDLE]
        kernel.AssignProcessToJobObject.restype = wintypes.BOOL
        kernel.CloseHandle.argtypes = [wintypes.HANDLE]
        kernel.CloseHandle.restype = wintypes.BOOL
        self.kernel, self.handle = kernel, kernel.CreateJobObjectW(None, None)
        if not self.handle:
            raise ctypes.WinError(ctypes.get_last_error())
        try:
            limits = _ExtendedLimits()
            limits.basic.flags = 0x2000  # JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
            if not kernel.SetInformationJobObject(self.handle, 9, ctypes.byref(limits), ctypes.sizeof(limits)):
                raise ctypes.WinError(ctypes.get_last_error())
            # Popen retains the original process HANDLE;do not open by a PID
            # that could be recycled after a fast startup failure.
            if not kernel.AssignProcessToJobObject(self.handle, wintypes.HANDLE(int(process._handle))):
                raise ctypes.WinError(ctypes.get_last_error())
        except Exception:
            self.close()
            raise

    def close(self):
        if self.handle:
            self.kernel.CloseHandle(self.handle)
            self.handle = None
