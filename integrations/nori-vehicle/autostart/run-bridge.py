"""Logon launcher for the vehicle bridge.

If the bridge is already serving on port 9090, do nothing (so logging out and back in, or any
second trigger, never starts a duplicate). Otherwise run bridge.py in THIS python.exe process,
so the Windows Firewall rule that allows python.exe keeps letting the tablet reach port 9090.
(Run through python.exe, never pythonw.exe: the firewall allows the former and blocks the
latter from the tablet.)
"""
import os
import runpy
import socket
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
BRIDGE = os.path.normpath(os.path.join(HERE, os.pardir, "bridge.py"))


def already_serving(port=9090):
    try:
        with socket.create_connection(("127.0.0.1", port), 1.5):
            return True
    except OSError:
        return False


if already_serving():
    sys.exit(0)

os.chdir(os.path.dirname(BRIDGE))
runpy.run_path(BRIDGE, run_name="__main__")
