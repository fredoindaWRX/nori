"""
Nori Port Conflict Detector

Detects port conflicts for Nori system services.
Checks which ports are in use and identifies potential conflicts.
"""
import json
import socket
import sys
import subprocess
from pathlib import Path
from datetime import datetime
from typing import Dict, List, Optional, Tuple


class PortDetector:
    """Detects port conflicts for Nori services."""
    
    def __init__(self):
        self.nori_ports = {
            "council": 9107,
            "workspace": 9444,
            "ollama": 11434,
            "letta": 8283,
            "localai": 8080
        }
        self.conflicts = []
    
    def is_port_in_use(self, port: int) -> Tuple[bool, Optional[str]]:
        """Check if a port is in use."""
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                s.settimeout(1)
                result = s.connect_ex(('127.0.0.1', port))
                if result == 0:
                    # Port is in use, try to get process info
                    process_info = self._get_process_on_port(port)
                    return True, process_info
                return False, None
        except Exception:
            return False, None
    
    def _get_process_on_port(self, port: int) -> Optional[str]:
        """Get process information for a port."""
        try:
            if sys.platform == "win32":
                # Windows: use netstat
                result = subprocess.run(
                    ["netstat", "-ano"],
                    capture_output=True,
                    text=True,
                    timeout=10
                )
                
                for line in result.stdout.split('\n'):
                    if f":{port}" in line and "LISTENING" in line:
                        parts = line.split()
                        if len(parts) >= 5:
                            pid = parts[-1]
                            try:
                                # Get process name from PID
                                tasklist = subprocess.run(
                                    ["tasklist", "/FI", f"PID eq {pid}", "/FO", "LIST"],
                                    capture_output=True,
                                    text=True,
                                    timeout=5
                                )
                                for line in tasklist.stdout.split('\n'):
                                    if "python" in line.lower() or "node" in line.lower():
                                        return f"PID {pid}: {line.strip()}"
                            except:
                                return f"PID {pid}"
            else:
                # Unix: use lsof
                result = subprocess.run(
                    ["lsof", "-i", f":{port}"],
                    capture_output=True,
                    text=True,
                    timeout=10
                )
                
                if result.returncode == 0:
                    lines = result.stdout.split('\n')
                    if len(lines) > 1:
                        return lines[1].strip()
        except Exception:
            pass
        
        return None
    
    def check_nori_ports(self) -> Dict:
        """Check all Nori service ports."""
        results = {}
        
        for service, port in self.nori_ports.items():
            in_use, process_info = self.is_port_in_use(port)
            results[service] = {
                "port": port,
                "in_use": in_use,
                "process": process_info
            }
            
            if in_use:
                self.conflicts.append({
                    "service": service,
                    "port": port,
                    "process": process_info
                })
        
        return {
            "timestamp": datetime.now().isoformat(),
            "services": results,
            "conflicts": self.conflicts
        }
    
    def check_port_range(self, start_port: int, end_port: int) -> List[Dict]:
        """Check a range of ports."""
        results = []
        
        for port in range(start_port, end_port + 1):
            in_use, process_info = self.is_port_in_use(port)
            if in_use:
                results.append({
                    "port": port,
                    "process": process_info
                })
        
        return results
    
    def find_available_port(self, start_port: int = 9000, end_port: int = 9999) -> Optional[int]:
        """Find an available port in range."""
        for port in range(start_port, end_port + 1):
            in_use, _ = self.is_port_in_use(port)
            if not in_use:
                return port
        return None
    
    def check_port_availability(self, port: int) -> Dict:
        """Check if a specific port is available."""
        in_use, process_info = self.is_port_in_use(port)
        
        return {
            "port": port,
            "available": not in_use,
            "in_use": in_use,
            "process": process_info
        }
    
    def get_conflict_report(self) -> Dict:
        """Generate conflict report."""
        port_check = self.check_nori_ports()
        
        return {
            "timestamp": datetime.now().isoformat(),
            "has_conflicts": len(self.conflicts) > 0,
            "conflicts": self.conflicts,
            "total_services": len(self.nori_ports),
            "services_checked": port_check["services"]
        }
    
    def resolve_conflict_suggestions(self) -> List[str]:
        """Get suggestions for resolving conflicts."""
        suggestions = []
        
        for conflict in self.conflicts:
            service = conflict["service"]
            port = conflict["port"]
            process = conflict["process"]
            
            suggestions.append(
                f"{service} (port {port}) is in use by {process}. "
                f"Consider stopping the conflicting process or changing the port in config.yaml."
            )
        
        if not suggestions:
            suggestions.append("No port conflicts detected.")
        
        return suggestions


def print_conflict_report(report: Dict):
    """Print formatted conflict report."""
    print("=" * 60)
    print("NORI PORT CONFLICT REPORT")
    print("=" * 60)
    print(f"Timestamp: {report['timestamp']}")
    print(f"Has conflicts: {'Yes' if report['has_conflicts'] else 'No'}")
    print(f"Services checked: {report['total_services']}")
    
    if report['has_conflicts']:
        print("\nConflicts:")
        for conflict in report['conflicts']:
            print(f"  ✗ {conflict['service']} (port {conflict['port']})")
            print(f"    Process: {conflict['process']}")
    else:
        print("\n✓ No port conflicts detected")
    
    print("=" * 60)


def main():
    """Command-line interface for port detection."""
    import argparse
    
    parser = argparse.ArgumentParser(description="Nori Port Conflict Detector")
    subparsers = parser.add_subparsers(dest="command", help="Available commands")
    
    # Check command
    subparsers.add_parser("check", help="Check Nori service ports")
    
    # Range command
    range_parser = subparsers.add_parser("range", help="Check port range")
    range_parser.add_argument("--start", type=int, default=9000, help="Start port")
    range_parser.add_argument("--end", type=int, default=9999, help="End port")
    
    # Available command
    available_parser = subparsers.add_parser("available", help="Find available port")
    available_parser.add_argument("--start", type=int, default=9000, help="Start port")
    available_parser.add_argument("--end", type=int, default=9999, help="End port")
    
    # Check specific port
    port_parser = subparsers.add_parser("port", help="Check specific port")
    port_parser.add_argument("port", type=int, help="Port number")
    
    # Report command
    subparsers.add_parser("report", help="Generate conflict report")
    
    args = parser.parse_args()
    
    detector = PortDetector()
    
    if args.command == "check":
        results = detector.check_nori_ports()
        print("Nori Service Port Status:")
        for service, info in results["services"].items():
            status = "✗ In use" if info["in_use"] else "✓ Available"
            print(f"  {status} {service} (port {info['port']})")
            if info["in_use"]:
                print(f"    Process: {info['process']}")
    
    elif args.command == "range":
        results = detector.check_port_range(args.start, args.end)
        print(f"Ports in use in range {args.start}-{args.end}:")
        for result in results:
            print(f"  Port {result['port']}: {result['process']}")
    
    elif args.command == "available":
        port = detector.find_available_port(args.start, args.end)
        if port:
            print(f"Available port found: {port}")
        else:
            print(f"No available ports in range {args.start}-{args.end}")
    
    elif args.command == "port":
        result = detector.check_port_availability(args.port)
        if result["available"]:
            print(f"Port {args.port} is available")
        else:
            print(f"Port {args.port} is in use by: {result['process']}")
    
    elif args.command == "report":
        report = detector.get_conflict_report()
        print_conflict_report(report)
        
        if report["has_conflicts"]:
            print("\nSuggestions:")
            for suggestion in detector.resolve_conflict_suggestions():
                print(f"  {suggestion}")
    
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
