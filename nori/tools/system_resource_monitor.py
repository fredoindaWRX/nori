"""
Nori System Resource Monitor

Monitors system resources in real-time.
Tracks CPU, memory, disk, network, and custom Nori metrics.
"""
import json
import time
import sys
from pathlib import Path
from datetime import datetime
from typing import Dict, List, Optional
from collections import deque


class SystemResourceMonitor:
    """Monitors system resources for Nori."""
    
    def __init__(self, history_size: int = 60):
        self.history_size = history_size
        self.cpu_history = deque(maxlen=history_size)
        self.memory_history = deque(maxlen=history_size)
        self.disk_history = deque(maxlen=history_size)
        self.custom_metrics = {}
    
    def get_cpu_usage(self) -> Dict:
        """Get current CPU usage."""
        try:
            import psutil
            cpu_percent = psutil.cpu_percent(interval=0.1)
            cpu_count = psutil.cpu_count()
            cpu_freq = psutil.cpu_freq()
            
            return {
                "percent": cpu_percent,
                "count": cpu_count,
                "frequency_mhz": cpu_freq.current if cpu_freq else None,
                "load_avg": list(psutil.getloadavg()) if hasattr(psutil, 'getloadavg') else None
            }
        except ImportError:
            return {"error": "psutil not installed"}
    
    def get_memory_usage(self) -> Dict:
        """Get current memory usage."""
        try:
            import psutil
            memory = psutil.virtual_memory()
            swap = psutil.swap_memory()
            
            return {
                "total_gb": round(memory.total / (1024**3), 2),
                "available_gb": round(memory.available / (1024**3), 2),
                "used_gb": round(memory.used / (1024**3), 2),
                "percent": memory.percent,
                "swap_total_gb": round(swap.total / (1024**3), 2),
                "swap_used_gb": round(swap.used / (1024**3), 2),
                "swap_percent": swap.percent
            }
        except ImportError:
            return {"error": "psutil not installed"}
    
    def get_disk_usage(self, path: str = "/") -> Dict:
        """Get disk usage for a path."""
        try:
            import psutil
            disk = psutil.disk_usage(path)
            
            return {
                "total_gb": round(disk.total / (1024**3), 2),
                "used_gb": round(disk.used / (1024**3), 2),
                "free_gb": round(disk.free / (1024**3), 2),
                "percent": disk.percent
            }
        except ImportError:
            return {"error": "psutil not installed"}
    
    def get_network_stats(self) -> Dict:
        """Get network statistics."""
        try:
            import psutil
            net_io = psutil.net_io_counters()
            
            return {
                "bytes_sent": net_io.bytes_sent,
                "bytes_recv": net_io.bytes_recv,
                "packets_sent": net_io.packets_sent,
                "packets_recv": net_io.packets_recv,
                "errin": net_io.errin,
                "errout": net_io.errout,
                "dropin": net_io.dropin,
                "dropout": net_io.dropout
            }
        except ImportError:
            return {"error": "psutil not installed"}
    
    def get_process_info(self, pid: int) -> Dict:
        """Get information about a specific process."""
        try:
            import psutil
            process = psutil.Process(pid)
            
            return {
                "pid": pid,
                "name": process.name(),
                "cpu_percent": process.cpu_percent(),
                "memory_mb": round(process.memory_info().rss / (1024**2), 2),
                "num_threads": process.num_threads(),
                "status": process.status()
            }
        except psutil.NoSuchProcess:
            return {"error": "Process not found"}
        except ImportError:
            return {"error": "psutil not installed"}
    
    def collect_all_metrics(self) -> Dict:
        """Collect all system metrics."""
        return {
            "timestamp": datetime.now().isoformat(),
            "cpu": self.get_cpu_usage(),
            "memory": self.get_memory_usage(),
            "disk": self.get_disk_usage(),
            "network": self.get_network_stats()
        }
    
    def record_history(self):
        """Record current metrics to history."""
        metrics = self.collect_all_metrics()
        
        if "error" not in metrics["cpu"]:
            self.cpu_history.append({
                "timestamp": metrics["timestamp"],
                "percent": metrics["cpu"]["percent"]
            })
        
        if "error" not in metrics["memory"]:
            self.memory_history.append({
                "timestamp": metrics["timestamp"],
                "percent": metrics["memory"]["percent"]
            })
        
        if "error" not in metrics["disk"]:
            self.disk_history.append({
                "timestamp": metrics["timestamp"],
                "percent": metrics["disk"]["percent"]
            })
    
    def get_average_cpu(self, samples: int = 10) -> Optional[float]:
        """Get average CPU usage over samples."""
        if len(self.cpu_history) < samples:
            return None
        
        recent = list(self.cpu_history)[-samples:]
        return sum(item["percent"] for item in recent) / len(recent)
    
    def get_average_memory(self, samples: int = 10) -> Optional[float]:
        """Get average memory usage over samples."""
        if len(self.memory_history) < samples:
            return None
        
        recent = list(self.memory_history)[-samples:]
        return sum(item["percent"] for item in recent) / len(recent)
    
    def add_custom_metric(self, name: str, value: float):
        """Add a custom metric."""
        if name not in self.custom_metrics:
            self.custom_metrics[name] = deque(maxlen=self.history_size)
        
        self.custom_metrics[name].append({
            "timestamp": datetime.now().isoformat(),
            "value": value
        })
    
    def get_custom_metric(self, name: str) -> Optional[List[Dict]]:
        """Get custom metric history."""
        return self.custom_metrics.get(name)
    
    def check_thresholds(self, cpu_threshold: float = 80, memory_threshold: float = 80) -> Dict:
        """Check if resources exceed thresholds."""
        metrics = self.collect_all()
        alerts = []
        
        if "error" not in metrics["cpu"] and metrics["cpu"]["percent"] > cpu_threshold:
            alerts.append({
                "type": "cpu",
                "current": metrics["cpu"]["percent"],
                "threshold": cpu_threshold,
                "message": f"CPU usage {metrics['cpu']['percent']}% exceeds threshold {cpu_threshold}%"
            })
        
        if "error" not in metrics["memory"] and metrics["memory"]["percent"] > memory_threshold:
            alerts.append({
                "type": "memory",
                "current": metrics["memory"]["percent"],
                "threshold": memory_threshold,
                "message": f"Memory usage {metrics['memory']['percent']}% exceeds threshold {memory_threshold}%"
            })
        
        return {
            "alerts": alerts,
            "has_alerts": len(alerts) > 0
        }
    
    def save_metrics(self, output_path: Optional[Path] = None) -> Path:
        """Save current metrics to file."""
        if output_path is None:
            output_path = Path(__file__).resolve().parent.parent / "nori" / "runtime-data" / "performance" / f"metrics_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
        
        output_path.parent.mkdir(parents=True, exist_ok=True)
        
        data = {
            "timestamp": datetime.now().isoformat(),
            "current": self.collect_all_metrics(),
            "history": {
                "cpu": list(self.cpu_history),
                "memory": list(self.memory_history),
                "disk": list(self.disk_history)
            },
            "custom_metrics": {k: list(v) for k, v in self.custom_metrics.items()}
        }
        
        with open(output_path, 'w', encoding='utf-8') as f:
            json.dump(data, f, indent=2)
        
        return output_path


def main():
    """Command-line interface for resource monitoring."""
    import argparse
    
    parser = argparse.ArgumentParser(description="Nori System Resource Monitor")
    subparsers = parser.add_subparsers(dest="command", help="Available commands")
    
    # Monitor command
    monitor_parser = subparsers.add_parser("monitor", help="Monitor resources")
    monitor_parser.add_argument("--interval", type=int, default=5, help="Interval in seconds")
    monitor_parser.add_argument("--samples", type=int, default=10, help="Number of samples")
    
    # Current command
    subparsers.add_parser("current", help="Show current metrics")
    
    # History command
    history_parser = subparsers.add_parser("history", help="Show history averages")
    history_parser.add_argument("--samples", type=int, default=10, help="Number of samples")
    
    # Check command
    check_parser = subparsers.add_parser("check", help="Check thresholds")
    check_parser.add_argument("--cpu", type=float, default=80, help="CPU threshold")
    check_parser.add_argument("--memory", type=float, default=80, help="Memory threshold")
    
    # Process command
    process_parser = subparsers.add_parser("process", help="Get process info")
    process_parser.add_argument("pid", type=int, help="Process ID")
    
    args = parser.parse_args()
    
    monitor = SystemResourceMonitor()
    
    if args.command == "monitor":
        print(f"Monitoring for {args.samples} samples every {args.interval} seconds...")
        for i in range(args.samples):
            monitor.record_history()
            metrics = monitor.collect_all_metrics()
            print(f"[{i+1}/{args.samples}] CPU: {metrics['cpu'].get('percent', 'N/A')}% | Memory: {metrics['memory'].get('percent', 'N/A')}%")
            time.sleep(args.interval)
        
        print(f"\nAverage CPU: {monitor.get_average_cpu(args.samples):.1f}%")
        print(f"Average Memory: {monitor.get_average_memory(args.samples):.1f}%")
    
    elif args.command == "current":
        metrics = monitor.collect_all_metrics()
        print("Current System Metrics:")
        print(f"  CPU: {metrics['cpu'].get('percent', 'N/A')}%")
        print(f"  Memory: {metrics['memory'].get('percent', 'N/A')}% ({metrics['memory'].get('used_gb', 'N/A')} GB used)")
        print(f"  Disk: {metrics['disk'].get('percent', 'N/A')}% ({metrics['disk'].get('free_gb', 'N/A')} GB free)")
    
    elif args.command == "history":
        monitor.record_history()
        avg_cpu = monitor.get_average_cpu(args.samples)
        avg_memory = monitor.get_average_memory(args.samples)
        print(f"Average CPU (last {args.samples} samples): {avg_cpu:.1f}%")
        print(f"Average Memory (last {args.samples} samples): {avg_memory:.1f}%")
    
    elif args.command == "check":
        result = monitor.check_thresholds(args.cpu, args.memory)
        if result["has_alerts"]:
            print("Alerts:")
            for alert in result["alerts"]:
                print(f"  {alert['message']}")
        else:
            print("No threshold alerts")
    
    elif args.command == "process":
        info = monitor.get_process_info(args.pid)
        if "error" in info:
            print(f"Error: {info['error']}")
        else:
            print(f"Process {args.pid}:")
            print(f"  Name: {info['name']}")
            print(f"  CPU: {info['cpu_percent']}%")
            print(f"  Memory: {info['memory_mb']} MB")
            print(f"  Threads: {info['num_threads']}")
            print(f"  Status: {info['status']}")
    
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
