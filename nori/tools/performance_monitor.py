"""
Nori Performance Monitoring Utility

Provides performance monitoring for Nori system components.
Tracks CPU, memory, model performance, and resource usage over time.
"""
import json
import sys
import time
from pathlib import Path
from datetime import datetime
from typing import Dict, List, Optional
import statistics


class PerformanceMonitor:
    """Performance monitor for Nori system."""
    
    def __init__(self, root: Path = None, data_dir: Path = None):
        self.root = root or Path(__file__).resolve().parent.parent
        self.data_dir = data_dir or self.root / "nori" / "runtime-data" / "performance"
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.metrics_file = self.data_dir / "metrics.jsonl"
    
    def collect_metrics(self) -> Dict:
        """Collect current system metrics."""
        metrics = {
            "timestamp": datetime.now().isoformat(),
            "system": self._collect_system_metrics(),
            "nori": self._collect_nori_metrics()
        }
        
        self._save_metrics(metrics)
        return metrics
    
    def _collect_system_metrics(self) -> Dict:
        """Collect system-level metrics."""
        try:
            import psutil
            
            cpu_percent = psutil.cpu_percent(interval=1)
            memory = psutil.virtual_memory()
            disk = psutil.disk_usage(self.root)
            
            return {
                "cpu_percent": cpu_percent,
                "memory": {
                    "total_gb": memory.total / (1024**3),
                    "available_gb": memory.available / (1024**3),
                    "percent_used": memory.percent
                },
                "disk": {
                    "total_gb": disk.total / (1024**3),
                    "free_gb": disk.free / (1024**3),
                    "percent_used": disk.percent
                }
            }
        except ImportError:
            return {
                "error": "psutil not installed"
            }
        except Exception as e:
            return {
                "error": str(e)
            }
    
    def _collect_nori_metrics(self) -> Dict:
        """Collect Nori-specific metrics."""
        metrics = {}
        
        # Check if Ollama is running
        try:
            import requests
            response = requests.get("http://127.0.0.1:11434/api/tags", timeout=2)
            if response.status_code == 200:
                metrics["ollama"] = {
                    "available": True,
                    "model_count": len(response.json().get("models", []))
                }
            else:
                metrics["ollama"] = {"available": False}
        except:
            metrics["ollama"] = {"available": False}
        
        # Check runtime data size
        runtime_data = self.root / "nori" / "runtime-data"
        if runtime_data.exists():
            size = sum(f.stat().st_size for f in runtime_data.rglob("*") if f.is_file())
            metrics["runtime_data_size_mb"] = size / (1024**2)
        
        return metrics
    
    def _save_metrics(self, metrics: Dict):
        """Save metrics to data file."""
        with open(self.metrics_file, 'a', encoding='utf-8') as f:
            f.write(json.dumps(metrics) + '\n')
    
    def get_history(self, limit: int = 100) -> List[Dict]:
        """Get historical metrics."""
        if not self.metrics_file.exists():
            return []
        
        metrics = []
        with open(self.metrics_file, 'r', encoding='utf-8') as f:
            for line in f:
                try:
                    metrics.append(json.loads(line.strip()))
                except:
                    continue
        
        return metrics[-limit:]
    
    def get_statistics(self, time_range_minutes: int = 60) -> Dict:
        """Get statistics over time range."""
        metrics = self.get_history()
        
        if not metrics:
            return {"error": "No metrics available"}
        
        # Filter by time range
        cutoff = datetime.now().timestamp() - (time_range_minutes * 60)
        recent_metrics = [m for m in metrics if datetime.fromisoformat(m["timestamp"]).timestamp() > cutoff]
        
        if not recent_metrics:
            return {"error": "No metrics in time range"}
        
        # Calculate statistics
        cpu_values = []
        memory_values = []
        
        for m in recent_metrics:
            if "system" in m and "cpu_percent" in m["system"]:
                cpu_values.append(m["system"]["cpu_percent"])
            if "system" in m and "memory" in m["system"]:
                memory_values.append(m["system"]["memory"]["percent_used"])
        
        stats = {
            "sample_count": len(recent_metrics),
            "time_range_minutes": time_range_minutes
        }
        
        if cpu_values:
            stats["cpu"] = {
                "average": statistics.mean(cpu_values),
                "max": max(cpu_values),
                "min": min(cpu_values)
            }
        
        if memory_values:
            stats["memory"] = {
                "average": statistics.mean(memory_values),
                "max": max(memory_values),
                "min": min(memory_values)
            }
        
        return stats
    
    def clear_history(self) -> int:
        """Clear metrics history."""
        if self.metrics_file.exists():
            self.metrics_file.unlink()
            return 1
        return 0


class ModelPerformanceTracker:
    """Track model inference performance."""
    
    def __init__(self, data_dir: Path = None):
        self.data_dir = data_dir or Path(__file__).resolve().parent.parent / "nori" / "runtime-data" / "performance"
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.model_file = self.data_dir / "model_performance.jsonl"
    
    def record_inference(self, model: str, prompt_tokens: int, output_tokens: int, duration_seconds: float):
        """Record model inference performance."""
        record = {
            "timestamp": datetime.now().isoformat(),
            "model": model,
            "prompt_tokens": prompt_tokens,
            "output_tokens": output_tokens,
            "total_tokens": prompt_tokens + output_tokens,
            "duration_seconds": duration_seconds,
            "tokens_per_second": (prompt_tokens + output_tokens) / duration_seconds if duration_seconds > 0 else 0
        }
        
        with open(self.model_file, 'a', encoding='utf-8') as f:
            f.write(json.dumps(record) + '\n')
    
    def get_model_stats(self, model: str, time_range_minutes: int = 60) -> Dict:
        """Get statistics for a specific model."""
        if not self.model_file.exists():
            return {"error": "No model performance data"}
        
        cutoff = datetime.now().timestamp() - (time_range_minutes * 60)
        records = []
        
        with open(self.model_file, 'r', encoding='utf-8') as f:
            for line in f:
                try:
                    record = json.loads(line.strip())
                    if record["model"] == model and datetime.fromisoformat(record["timestamp"]).timestamp() > cutoff:
                        records.append(record)
                except:
                    continue
        
        if not records:
            return {"error": f"No records for model: {model}"}
        
        durations = [r["duration_seconds"] for r in records]
        tps_values = [r["tokens_per_second"] for r in records]
        
        return {
            "model": model,
            "sample_count": len(records),
            "time_range_minutes": time_range_minutes,
            "duration": {
                "average": statistics.mean(durations),
                "max": max(durations),
                "min": min(durations)
            },
            "tokens_per_second": {
                "average": statistics.mean(tps_values),
                "max": max(tps_values),
                "min": min(tps_values)
            }
        }


def main():
    """Command-line interface for performance monitoring."""
    import argparse
    
    parser = argparse.ArgumentParser(description="Nori Performance Monitoring")
    subparsers = parser.add_subparsers(dest="command", help="Available commands")
    
    # Collect metrics command
    subparsers.add_parser("collect", help="Collect current metrics")
    
    # History command
    history_parser = subparsers.add_parser("history", help="Show metrics history")
    history_parser.add_argument("--limit", type=int, default=100, help="Number of records to show")
    
    # Statistics command
    stats_parser = subparsers.add_parser("stats", help="Show performance statistics")
    stats_parser.add_argument("--time-range", type=int, default=60, help="Time range in minutes")
    
    # Clear command
    subparsers.add_parser("clear", help="Clear metrics history")
    
    args = parser.parse_args()
    
    monitor = PerformanceMonitor()
    
    if args.command == "collect":
        metrics = monitor.collect_metrics()
        print("Current Metrics:")
        print(f"  CPU: {metrics['system'].get('cpu_percent', 'N/A')}%")
        if "memory" in metrics["system"]:
            print(f"  Memory: {metrics['system']['memory']['percent_used']}% used")
        print(f"  Ollama: {'Available' if metrics['nori'].get('ollama', {}).get('available') else 'Unavailable'}")
        if "runtime_data_size_mb" in metrics["nori"]:
            print(f"  Runtime Data: {metrics['nori']['runtime_data_size_mb']:.2f} MB")
    
    elif args.command == "history":
        history = monitor.get_history(args.limit)
        print(f"Last {len(history)} metrics:")
        for record in history:
            print(f"  {record['timestamp']}: CPU {record['system'].get('cpu_percent', 'N/A')}%")
    
    elif args.command == "stats":
        stats = monitor.get_statistics(args.time_range)
        print(f"Statistics for last {args.time_range} minutes:")
        print(f"  Sample count: {stats.get('sample_count', 0)}")
        if "cpu" in stats:
            print(f"  CPU Average: {stats['cpu']['average']:.1f}%")
        if "memory" in stats:
            print(f"  Memory Average: {stats['memory']['average']:.1f}%")
    
    elif args.command == "clear":
        cleared = monitor.clear_history()
        print(f"Cleared {cleared} metric records")
    
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
