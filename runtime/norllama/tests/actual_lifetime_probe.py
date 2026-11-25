"""Real owned-launcher loss and runtime-crash cleanup on Windows;not unit discovery."""
import ctypes
from ctypes import wintypes
import json
import os
from pathlib import Path
import queue
import subprocess
import threading

root = Path(__file__).resolve().parents[3]
module = root / "apps/desktop/desktop/native-service.cjs"
node = Path(r"C:\Program Files\nodejs\node.exe")
kernel = ctypes.WinDLL("kernel32", use_last_error=True)
kernel.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
kernel.OpenProcess.restype = wintypes.HANDLE
kernel.WaitForSingleObject.argtypes = [wintypes.HANDLE, wintypes.DWORD]
kernel.WaitForSingleObject.restype = wintypes.DWORD
kernel.TerminateProcess.argtypes = [wintypes.HANDLE, wintypes.UINT]
kernel.TerminateProcess.restype = wintypes.BOOL
kernel.CloseHandle.argtypes = [wintypes.HANDLE]
kernel.CloseHandle.restype = wintypes.BOOL
code = ("const {startNativeService}=require(" + json.dumps(str(module)) + ");"
        "startNativeService({root:" + json.dumps(str(root)) + "}).then(service=>{"
        "console.log(JSON.stringify(service.status));"
        "service.exited.then(()=>process.exit(0));setInterval(()=>{},60000);"
        "}).catch(()=>process.exit(1));")

for failure in ("owner_exit", "runtime_crash"):
    owner = subprocess.Popen([str(node), "-e", code], cwd=str(root),
                             stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                             creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    handles = []
    try:
        inbox = queue.Queue(maxsize=1)
        reader = threading.Thread(target=lambda: inbox.put(owner.stdout.readline(4097)), daemon=True)
        reader.start()
        raw = inbox.get(timeout=35)
        assert raw.endswith(b"\n") and len(raw) <= 4096, "bounded owned startup record missing"
        status = json.loads(raw)
        assert status["backend"] == "norama-independent"
        for name in ("runtimePid", "workerPid"):
            handle = kernel.OpenProcess(0x100000 | 0x0001, False, status[name])
            if not handle:
                raise ctypes.WinError(ctypes.get_last_error())
            handles.append(handle)
            assert kernel.WaitForSingleObject(handle, 0) == 258, "owned child already exited"
        if failure == "owner_exit":
            owner.terminate()  # Exact known probe launcher,not any user's service.
            owner.wait(timeout=5)
        else:
            # Retained original handle prevents targeting a recycled PID.
            assert kernel.TerminateProcess(handles[0], 17), "owned runtime termination failed"
        assert kernel.WaitForSingleObject(handles[0], 10000) == 0, "runtime orphan after owner loss"
        assert kernel.WaitForSingleObject(handles[1], 5000) == 0, "GPU worker orphan after runtime death"
        if owner.poll() is None:
            owner.wait(timeout=5)
        print(json.dumps({"owned_lifetime": "PASS", "failure_case": failure,
                          "runtime_pid": status["runtimePid"], "worker_pid": status["workerPid"],
                          "runtime_stopped": True, "gpu_worker_stopped": True}))
    finally:
        if owner.poll() is None:
            owner.terminate()
            owner.wait(timeout=5)
        for handle in handles:
            kernel.CloseHandle(handle)
        owner.stdout.close()
