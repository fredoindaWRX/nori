"""
Nori Service Management Utility

Provides service management for Nori system components.
Supports starting, stopping, restarting, and checking status of services.
"""
import json
import sys
import subprocess
import time
from pathlib import Path
from datetime import datetime
from typing import Dict, List, Optional


class ServiceManager:
    """Manages Nori system services."""
    
    def __init__(self, root: Path = None):
        # service_manager.py lives at <NORI_ROOT>/nori/tools.  The previous
        # parent.parent default pointed at <NORI_ROOT>/nori and silently
        # created a second ``nori`` tree for PID files and working paths.
        self._discover_ports = root is None
        self.root = root or Path(__file__).resolve().parents[2]
        interpreter = str(self.root / 'nori' / '.venv-architect' / 'Scripts' / 'python.exe')
        self.services = {
            "council": {
                "name": "Council",
                "port": 9107,
                "start_cmd": [interpreter, "main.py"],
                "work_dir": self.root / "nori",
                "health_url": "http://127.0.0.1:9107/health"
            },
            "workspace": {
                "name": "Workspace",
                "port": 9444,
                "start_cmd": [interpreter, "server.py"],
                "work_dir": self.root / "workspace",
                "health_url": "http://127.0.0.1:9444/api/status"
            },
            "moshi": {
                "name": "Moshi Voice Engine",
                "start_cmd": [interpreter, "nori/shared/moshi/moshi_orchestrator.py", "--headless"],
                "work_dir": self.root,
                "health_url": None # Audio stream, use PID/Log check
            }
        }
        self.pid_file = self.root / "nori" / "runtime-data" / "service_pids.json"
        self.pids = self._load_pids()
        self.voice_engine = "moshi" # Default engine: moshi | windows_speech_kokoro | fallback
    
    def _load_pids(self) -> Dict:
        """Load service PIDs from file."""
        candidates = [self.pid_file]
        # Read the legacy nested location once so an upgrade can manage a
        # service started by the pre-fix manager; new writes use the canonical
        # path above.
        legacy = self.root / "nori" / "nori" / "runtime-data" / "service_pids.json"
        if legacy != self.pid_file:
            candidates.append(legacy)
        for path in candidates:
            if not path.exists():
                continue
            try:
                with open(path, 'r', encoding='utf-8') as f:
                    return json.load(f)
            except:
                continue
        return {}
    
    def _save_pids(self):
        """Save service PIDs to file."""
        self.pid_file.parent.mkdir(parents=True, exist_ok=True)
        with open(self.pid_file, 'w', encoding='utf-8') as f:
            json.dump(self.pids, f, indent=2)
    
    def start_service(self, service_name: str) -> Dict:
        """Start a service."""
        if service_name not in self.services:
            return {
                "success": False,
                "error": f"Unknown service: {service_name}"
            }
        
        service = self.services[service_name]
        
        # Check if already running
        if service_name in self.pids:
            if self._is_process_running(self.pids[service_name]):
                return {
                    "success": False,
                    "error": f"Service {service_name} is already running"
                }

        # A RuntimeServiceAuthority-managed process may not have a PID entry
        # in this utility's file.  Refuse to create a second listener and
        # adopt the live PID discovered from the service port.
        port_pid = self._pid_for_port(service.get("port"))
        if port_pid is not None:
            self.pids[service_name] = {
                "pid": port_pid,
                "started_at": datetime.now().isoformat(),
            }
            self._save_pids()
            return {"success": False, "error": f"Service {service_name} is already running"}
        
        # Start service
        try:
            process = subprocess.Popen(
                service["start_cmd"],
                cwd=service["work_dir"],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE
            )
            
            self.pids[service_name] = {
                "pid": process.pid,
                "started_at": datetime.now().isoformat()
            }
            self._save_pids()
            
            # Wait a moment for service to start
            time.sleep(2)
            
            # Check if process is still running
            if not self._is_process_running(process.pid):
                return {
                    "success": False,
                    "error": f"Service {service_name} failed to start"
                }
            
            return {
                "success": True,
                "service": service_name,
                "pid": process.pid,
                "started_at": self.pids[service_name]["started_at"]
            }
        except Exception as e:
            return {
                "success": False,
                "error": str(e)
            }
    
    def stop_service(self, service_name: str) -> Dict:
        """Stop a service."""
        if service_name not in self.services:
            return {
                "success": False,
                "error": f"Unknown service: {service_name}"
            }
        
        if service_name not in self.pids:
            return {
                "success": False,
                "error": f"Service {service_name} is not running"
            }
        
        pid = self.pids[service_name]["pid"]
        
        try:
            # Try graceful shutdown first
            process = subprocess.Popen(
                ["taskkill", "/PID", str(pid), "/T"],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE
            )
            process.wait(timeout=10)
            
            del self.pids[service_name]
            self._save_pids()
            
            return {
                "success": True,
                "service": service_name,
                "pid": pid
            }
        except Exception as e:
            return {
                "success": False,
                "error": str(e)
            }
    
    def restart_service(self, service_name: str) -> Dict:
        """Restart a service."""
        # Stop if running
        if service_name in self.pids:
            stop_result = self.stop_service(service_name)
            if not stop_result["success"]:
                return stop_result
        
        # Wait a moment
        time.sleep(1)
        
        # Start again
        return self.start_service(service_name)
    
    def get_status(self, service_name: Optional[str] = None) -> Dict:
        """Get status of services."""
        if service_name:
            if service_name not in self.services:
                return {
                    "success": False,
                    "error": f"Unknown service: {service_name}"
                }
            
            return self._get_service_status(service_name)
        else:
            # Get status of all services
            return {
                "services": {
                    name: self._get_service_status(name)
                    for name in self.services.keys()
                }
            }
    
    def _get_service_status(self, service_name: str) -> Dict:
        """Get status of a single service."""
        service = self.services[service_name]
        
        if service_name not in self.pids:
            port_pid = self._pid_for_port(service.get("port"))
            if port_pid is not None:
                self.pids[service_name] = {"pid": port_pid, "started_at": None}
                self._save_pids()
            else:
                return {
                    "name": service["name"],
                    "running": False,
                    "pid": None
                }

        if service_name not in self.pids:
            return {
                "name": service["name"],
                "running": False,
                "pid": None
            }
        
        pid = self.pids[service_name]["pid"]
        running = self._is_process_running(pid)

        if not running:
            replacement = self._pid_for_port(service.get("port"))
            if replacement is not None:
                pid = replacement
                running = True
                self.pids[service_name] = {
                    "pid": replacement,
                    "started_at": self.pids[service_name].get("started_at"),
                }
                self._save_pids()

        status = {
            "name": service["name"],
            "running": running,
            "pid": pid if running else None,
            "started_at": self.pids[service_name]["started_at"] if running else None
        }
        
        if running:
            # Try to check health endpoint
            try:
                import requests
                response = requests.get(service["health_url"], timeout=2)
                status["healthy"] = response.status_code == 200
            except:
                status["healthy"] = False
        
        return status

    def _pid_for_port(self, port: Optional[int]) -> Optional[int]:
        """Return the local TCP listener PID without requiring CIM permissions."""
        if not self._discover_ports or not isinstance(port, int):
            return None
        try:
            output = subprocess.check_output(
                ["netstat", "-ano", "-p", "tcp"],
                stderr=subprocess.DEVNULL,
                text=True,
                encoding="utf-8",
                errors="replace",
            )
        except (OSError, subprocess.SubprocessError):
            return None
        suffix = f":{port}"
        for line in output.splitlines():
            fields = line.split()
            if len(fields) < 5 or fields[0].upper() != "TCP":
                continue
            if fields[1].endswith(suffix) and fields[3].upper() == "LISTENING":
                try:
                    pid = int(fields[4])
                except ValueError:
                    continue
                if pid > 0:
                    return pid
        return None
    
    def _is_process_running(self, pid: int) -> bool:
        """Check if a process is running."""
        try:
            process = subprocess.Popen(
                ["tasklist", "/FI", f"PID eq {pid}"],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE
            )
            stdout, _ = process.communicate()
            return str(pid) in stdout.decode('utf-8')
        except:
            return False
    
    def start_all(self) -> Dict:
        """Start all services."""
        results = {}
        for service_name in self.services.keys():
            results[service_name] = self.start_service(service_name)
        return results
    
    def stop_all(self) -> Dict:
        """Stop all services."""
        results = {}
        for service_name in list(self.pids.keys()):
            results[service_name] = self.stop_service(service_name)
        return results


def main():
    """Command-line interface for service management."""
    import argparse
    
    parser = argparse.ArgumentParser(description="Nori Service Management")
    subparsers = parser.add_subparsers(dest="command", help="Available commands")
    
    # Start command
    start_parser = subparsers.add_parser("start", help="Start a service")
    start_parser.add_argument("service", help="Service name (council, workspace)")
    
    # Stop command
    stop_parser = subparsers.add_parser("stop", help="Stop a service")
    stop_parser.add_argument("service", help="Service name (council, workspace)")
    
    # Restart command
    restart_parser = subparsers.add_parser("restart", help="Restart a service")
    restart_parser.add_argument("service", help="Service name (council, workspace)")
    
    # Status command
    status_parser = subparsers.add_parser("status", help="Get service status")
    status_parser.add_argument("service", nargs="?", help="Service name (optional)")
    
    # Start all command
    subparsers.add_parser("start-all", help="Start all services")
    
    # Stop all command
    subparsers.add_parser("stop-all", help="Stop all services")
    
    args = parser.parse_args()
    
    manager = ServiceManager()
    
    if args.command == "start":
        result = manager.start_service(args.service)
        if result["success"]:
            print(f"Started {args.service} (PID: {result['pid']})")
        else:
            print(f"Failed to start {args.service}: {result['error']}")
    
    elif args.command == "stop":
        result = manager.stop_service(args.service)
        if result["success"]:
            print(f"Stopped {args.service}")
        else:
            print(f"Failed to stop {args.service}: {result['error']}")
    
    elif args.command == "restart":
        result = manager.restart_service(args.service)
        if result["success"]:
            print(f"Restarted {args.service} (PID: {result['pid']})")
        else:
            print(f"Failed to restart {args.service}: {result['error']}")
    
    elif args.command == "status":
        result = manager.get_status(args.service)
        if "services" in result:
            print("Service Status:")
            for name, status in result["services"].items():
                running_icon = "OK" if status["running"] else "--"
                print(f"  {running_icon} {status['name']}: {'Running' if status['running'] else 'Stopped'}")
                if status["running"]:
                    print(f"    PID: {status['pid']}")
                    print(f"    Healthy: {status.get('healthy', 'Unknown')}")
        else:
            running_icon = "OK" if result["running"] else "--"
            print(f"{running_icon} {result['name']}: {'Running' if result['running'] else 'Stopped'}")
            if result["running"]:
                print(f"  PID: {result['pid']}")
                print(f"  Healthy: {result.get('healthy', 'Unknown')}")
    
    elif args.command == "start-all":
        results = manager.start_all()
        for service, result in results.items():
            if result["success"]:
                print(f"Started {service} (PID: {result['pid']})")
            else:
                print(f"Failed to start {service}: {result['error']}")
    
    elif args.command == "stop-all":
        results = manager.stop_all()
        for service, result in results.items():
            if result["success"]:
                print(f"Stopped {service}")
            else:
                print(f"Failed to stop {service}: {result['error']}")
    
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
