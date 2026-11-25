"""
Nori Process Monitor Utility

Monitors processes related to Nori system.
Tracks process status, resource usage, and provides health information.
"""
import json
import sys
import subprocess
import time
from pathlib import Path
from datetime import datetime
from typing import Dict, List, Optional
from collections import defaultdict


class ProcessMonitor:
    """Monitors Nori-related processes."""
    
    def __init__(self):
        self.nori_processes = {
            "council": ["python", "main.py"],
            "workspace": ["python", "server.py"],
            "ollama": ["ollama"]
        }
        self.process_info = {}
    
    def _get_process_list(self) -> List[Dict]:
        """Get list of all processes."""
        try:
            if sys.platform == "win32":
                # Windows: use tasklist
                result = subprocess.run(
                    ["tasklist", "/FO", "CSV"],
                    capture_output=True,
                    text=True,
                    timeout=10
                )
                
                processes = []
                lines = result.stdout.split('\n')[1:]  # Skip header
                for line in lines:
                    if line.strip():
                        parts = line.split(',')
                        if len(parts) >= 2:
                            processes.append({
                                "name": parts[0].strip('"'),
                                "pid": parts[1].strip('"'),
                                "memory": parts[4].strip('"') if len(parts) > 4 else "0"
                            })
                return processes
            else:
                # Unix: use ps
                result = subprocess.run(
                    ["ps", "aux"],
                    capture_output=True,
                    text=True,
                    timeout=10
                )
                
                processes = []
                lines = result.stdout.split('\n')[1:]  # Skip header
                for line in lines:
                    if line.strip():
                        parts = line.split()
                        if len(parts) >= 11:
                            processes.append({
                                "name": parts[10],
                                "pid": parts[1],
                                "memory": parts[5]
                            })
                return processes
        except Exception as e:
            return []
    
    def find_nori_processes(self) -> Dict:
        """Find Nori-related processes."""
        all_processes = self._get_process_list()
        nori_processes = defaultdict(list)
        
        for process in all_processes:
            process_name = process["name"].lower()
            pid = process["pid"]
            
            for service, search_terms in self.nori_processes.items():
                for term in search_terms:
                    if term.lower() in process_name:
                        nori_processes[service].append({
                            "pid": pid,
                            "name": process["name"],
                            "memory": process["memory"]
                        })
                        break
        
        return dict(nori_processes)
    
    def get_process_details(self, pid: str) -> Optional[Dict]:
        """Get detailed information about a specific process."""
        try:
            if sys.platform == "win32":
                result = subprocess.run(
                    ["tasklist", "/FI", f"PID eq {pid}", "/FO", "LIST"],
                    capture_output=True,
                    text=True,
                    timeout=10
                )
                
                details = {}
                for line in result.stdout.split('\n'):
                    if ':' in line:
                        key, value = line.split(':', 1)
                        details[key.strip()] = value.strip()
                
                return details
            else:
                result = subprocess.run(
                    ["ps", "-p", pid, "-o", "pid,ppid,%cpu,%mem,etime,comm"],
                    capture_output=True,
                    text=True,
                    timeout=10
                )
                
                if result.returncode == 0:
                    parts = result.stdout.strip().split()
                    if len(parts) >= 6:
                        return {
                            "pid": parts[0],
                            "ppid": parts[1],
                            "cpu": parts[2],
                            "memory": parts[3],
                            "time": parts[4],
                            "command": parts[5]
                        }
        except Exception:
            return None
    
    def check_process_health(self, pid: str) -> Dict:
        """Check if a process is healthy."""
        details = self.get_process_details(pid)
        
        if not details:
            return {
                "pid": pid,
                "running": False,
                "status": "not_found"
            }
        
        return {
            "pid": pid,
            "running": True,
            "status": "healthy",
            "details": details
        }
    
    def get_resource_usage(self, pid: str) -> Dict:
        """Get resource usage for a process."""
        details = self.get_process_details(pid)
        
        if not details:
            return {
                "pid": pid,
                "error": "Process not found"
            }
        
        return {
            "pid": pid,
            "memory": details.get("memory", "Unknown"),
            "cpu": details.get("cpu", "Unknown") if sys.platform != "win32" else "Unknown"
        }
    
    def kill_process(self, pid: str) -> Dict:
        """Kill a process."""
        try:
            if sys.platform == "win32":
                result = subprocess.run(
                    ["taskkill", "/PID", pid, "/F"],
                    capture_output=True,
                    text=True,
                    timeout=10
                )
                
                return {
                    "success": result.returncode == 0,
                    "pid": pid,
                    "message": result.stdout if result.returncode == 0 else result.stderr
                }
            else:
                result = subprocess.run(
                    ["kill", "-9", pid],
                    capture_output=True,
                    text=True,
                    timeout=10
                )
                
                return {
                    "success": result.returncode == 0,
                    "pid": pid,
                    "message": "Process killed" if result.returncode == 0 else "Failed to kill"
                }
        except Exception as e:
            return {
                "success": False,
                "pid": pid,
                "error": str(e)
            }
    
    def monitor_all(self) -> Dict:
        """Monitor all Nori processes."""
        nori_processes = self.find_nori_processes()
        
        status = {
            "timestamp": datetime.now().isoformat(),
            "services": {}
        }
        
        for service, processes in nori_processes.items():
            status["services"][service] = {
                "running": len(processes) > 0,
                "processes": []
            }
            
            for process in processes:
                health = self.check_process_health(process["pid"])
                status["services"][service]["processes"].append(health)
        
        return status
    
    def get_process_tree(self, pid: str) -> Dict:
        """Get process tree for a given PID."""
        try:
            if sys.platform == "win32":
                # Windows: use wmic to get parent/child relationships
                result = subprocess.run(
                    ["wmic", "process", "where", f"ProcessId={pid}", "get", "ParentProcessId"],
                    capture_output=True,
                    text=True,
                    timeout=10
                )
                
                parent_pid = None
                for line in result.stdout.split('\n'):
                    if '=' in line:
                        key, value = line.split('=', 1)
                        if key.strip() == "ParentProcessId":
                            parent_pid = value.strip()
                            break
                
                return {
                    "pid": pid,
                    "parent_pid": parent_pid,
                    "children": []  # Would need more complex logic to find children
                }
            else:
                # Unix: use pstree
                result = subprocess.run(
                    ["pstree", "-p", pid],
                    capture_output=True,
                    text=True,
                    timeout=10
                )
                
                return {
                    "pid": pid,
                    "tree": result.stdout if result.returncode == 0 else "pstree not available"
                }
        except Exception as e:
            return {
                "pid": pid,
                "error": str(e)
            }
    
    def save_status(self, output_path: Optional[Path] = None) -> Path:
        """Save process status to file."""
        if output_path is None:
            output_path = Path(__file__).resolve().parent.parent / "nori" / "runtime-data" / "process_status.json"
        
        output_path.parent.mkdir(parents=True, exist_ok=True)
        status = self.monitor_all()
        
        with open(output_path, 'w', encoding='utf-8') as f:
            json.dump(status, f, indent=2)
        
        return output_path


def print_process_status(status: Dict):
    """Print formatted process status."""
    print("=" * 60)
    print("NORI PROCESS STATUS")
    print("=" * 60)
    print(f"Timestamp: {status['timestamp']}")
    
    for service, info in status["services"].items():
        running_icon = "✓" if info["running"] else "✗"
        print(f"\n{running_icon} {service}: {'Running' if info['running'] else 'Not running'}")
        
        if info["running"]:
            for process in info["processes"]:
                print(f"  PID {process['pid']}: {process['status']}")
    
    print("=" * 60)


def main():
    """Command-line interface for process monitoring."""
    import argparse
    
    parser = argparse.ArgumentParser(description="Nori Process Monitor")
    subparsers = parser.add_subparsers(dest="command", help="Available commands")
    
    # Monitor command
    subparsers.add_parser("monitor", help="Monitor all Nori processes")
    
    # Find command
    subparsers.add_parser("find", help="Find Nori processes")
    
    # Details command
    details_parser = subparsers.add_parser("details", help="Get process details")
    details_parser.add_argument("pid", help="Process ID")
    
    # Health command
    health_parser = subparsers.add_parser("health", help="Check process health")
    health_parser.add_argument("pid", help="Process ID")
    
    # Kill command
    kill_parser = subparsers.add_parser("kill", help="Kill a process")
    kill_parser.add_argument("pid", help="Process ID")
    
    # Tree command
    tree_parser = subparsers.add_parser("tree", help="Get process tree")
    tree_parser.add_argument("pid", help="Process ID")
    
    # Status command
    subparsers.add_parser("status", help="Show process status")
    
    args = parser.parse_args()
    
    monitor = ProcessMonitor()
    
    if args.command == "monitor":
        status = monitor.monitor_all()
        print_process_status(status)
        monitor.save_status()
    
    elif args.command == "find":
        processes = monitor.find_nori_processes()
        print("Nori processes found:")
        for service, proc_list in processes.items():
            print(f"  {service}: {len(proc_list)} process(es)")
            for proc in proc_list:
                print(f"    PID {proc['pid']}: {proc['name']}")
    
    elif args.command == "details":
        details = monitor.get_process_details(args.pid)
        if details:
            print(f"Process {args.pid} details:")
            for key, value in details.items():
                print(f"  {key}: {value}")
        else:
            print(f"Process {args.pid} not found")
    
    elif args.command == "health":
        health = monitor.check_process_health(args.pid)
        print(f"Process {args.pid} health:")
        print(f"  Running: {health['running']}")
        print(f"  Status: {health['status']}")
    
    elif args.command == "kill":
        result = monitor.kill_process(args.pid)
        if result["success"]:
            print(f"Killed process {args.pid}")
        else:
            print(f"Failed to kill process {args.pid}: {result.get('error', result.get('message'))}")
    
    elif args.command == "tree":
        tree = monitor.get_process_tree(args.pid)
        print(f"Process tree for {args.pid}:")
        print(json.dumps(tree, indent=2))
    
    elif args.command == "status":
        status = monitor.monitor_all()
        print_process_status(status)
    
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
