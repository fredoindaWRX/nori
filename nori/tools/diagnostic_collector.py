"""
Nori Diagnostic Information Collector

Collects comprehensive diagnostic information for troubleshooting.
Gathers system specs, environment details, configuration, and runtime state.
"""
import json
import sys
import platform
from pathlib import Path
from datetime import datetime
from typing import Dict, Optional


class DiagnosticCollector:
    """Collects diagnostic information for Nori."""
    
    def __init__(self, root: Path = None):
        self.root = root or Path(__file__).resolve().parent.parent
        self.diagnostics = {
            "timestamp": datetime.now().isoformat(),
            "system": {},
            "python": {},
            "nori": {},
            "services": {},
            "errors": []
        }
    
    def collect_all(self) -> Dict:
        """Collect all diagnostic information."""
        self.diagnostics["system"] = self._collect_system_info()
        self.diagnostics["python"] = self._collect_python_info()
        self.diagnostics["nori"] = self._collect_nori_info()
        self.diagnostics["services"] = self._collect_service_info()
        
        return self.diagnostics
    
    def _collect_system_info(self) -> Dict:
        """Collect system information."""
        info = {
            "platform": platform.platform(),
            "system": platform.system(),
            "release": platform.release(),
            "version": platform.version(),
            "machine": platform.machine(),
            "processor": platform.processor(),
            "python_version": platform.python_version()
        }
        
        # Try to get CPU info
        try:
            import psutil
            info["cpu_count"] = psutil.cpu_count(logical=True)
            info["cpu_count_physical"] = psutil.cpu_count(logical=False)
            info["cpu_percent"] = psutil.cpu_percent(interval=1)
            
            # Memory info
            memory = psutil.virtual_memory()
            info["memory_total_gb"] = round(memory.total / (1024**3), 2)
            info["memory_available_gb"] = round(memory.available / (1024**3), 2)
            info["memory_percent"] = memory.percent
            
            # Disk info
            disk = psutil.disk_usage(str(self.root))
            info["disk_total_gb"] = round(disk.total / (1024**3), 2)
            info["disk_free_gb"] = round(disk.free / (1024**3), 2)
            info["disk_percent"] = disk.percent
        except ImportError:
            info["psutil_not_available"] = True
        
        return info
    
    def _collect_python_info(self) -> Dict:
        """Collect Python environment information."""
        info = {
            "version": sys.version,
            "version_info": f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}",
            "executable": sys.executable,
            "path": sys.path[:10],  # First 10 paths
            "platform": sys.platform
        }
        
        # Try to get installed packages
        try:
            import pkg_resources
            packages = []
            for dist in pkg_resources.working_set:
                packages.append({
                    "name": dist.project_name,
                    "version": dist.version
                })
            info["installed_packages"] = packages[:20]  # First 20 packages
            info["total_packages"] = len(packages)
        except ImportError:
            info["pkg_resources_not_available"] = True
        
        return info
    
    def _collect_nori_info(self) -> Dict:
        """Collect Nori-specific information."""
        info = {
            "root": str(self.root),
            "directories": {},
            "config": {},
            "files": {}
        }
        
        # Check key directories
        key_dirs = [
            "nori",
            "nori/shared",
            "nori/packages",
            "workspace",
            "nori/runtime-data",
            "data",
            "memory"
        ]
        
        for dir_name in key_dirs:
            dir_path = self.root / dir_name
            info["directories"][dir_name] = {
                "exists": dir_path.exists(),
                "is_dir": dir_path.is_dir() if dir_path.exists() else False
            }
        
        # Check configuration
        config_path = self.root / "nori" / "config.yaml"
        info["config"]["exists"] = config_path.exists()
        if config_path.exists():
            try:
                import yaml
                with open(config_path, 'r', encoding='utf-8') as f:
                    config = yaml.safe_load(f)
                info["config"]["valid"] = True
                info["config"]["sections"] = list(config.keys()) if config else []
            except Exception as e:
                info["config"]["valid"] = False
                info["config"]["error"] = str(e)
        
        # Check key files
        key_files = [
            "nori/main.py",
            "nori/config.yaml",
            "workspace/server.py",
            "nori_launcher.py"
        ]
        
        for file_name in key_files:
            file_path = self.root / file_name
            info["files"][file_name] = {
                "exists": file_path.exists(),
                "size_bytes": file_path.stat().st_size if file_path.exists() else 0
            }
        
        return info
    
    def _collect_service_info(self) -> Dict:
        """Collect service information."""
        info = {
            "ollama": {},
            "council": {},
            "workspace": {}
        }
        
        # Check Ollama
        try:
            import requests
            response = requests.get("http://127.0.0.1:11434/api/tags", timeout=5)
            if response.status_code == 200:
                data = response.json()
                info["ollama"]["running"] = True
                info["ollama"]["model_count"] = len(data.get("models", []))
            else:
                info["ollama"]["running"] = False
        except Exception as e:
            info["ollama"]["running"] = False
            info["ollama"]["error"] = str(e)
        
        # Check Council
        try:
            response = requests.get("http://127.0.0.1:9107/api/status", timeout=5)
            info["council"]["running"] = response.status_code == 200
            if response.status_code == 200:
                info["council"]["status"] = response.json()
        except Exception as e:
            info["council"]["running"] = False
            info["council"]["error"] = str(e)
        
        # Check Workspace
        try:
            response = requests.get("http://127.0.0.1:9444/api/status", timeout=5)
            info["workspace"]["running"] = response.status_code == 200
            if response.status_code == 200:
                info["workspace"]["status"] = response.json()
        except Exception as e:
            info["workspace"]["running"] = False
            info["workspace"]["error"] = str(e)
        
        return info
    
    def save_diagnostics(self, output_path: Optional[Path] = None) -> Path:
        """Save diagnostics to file."""
        if output_path is None:
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            output_path = self.root / "nori" / "runtime-data" / f"diagnostics_{timestamp}.json"
        
        output_path.parent.mkdir(parents=True, exist_ok=True)
        with open(output_path, 'w', encoding='utf-8') as f:
            json.dump(self.diagnostics, f, indent=2)
        
        return output_path
    
    def print_summary(self):
        """Print diagnostic summary."""
        print("=" * 60)
        print("NORI DIAGNOSTIC SUMMARY")
        print("=" * 60)
        print(f"Timestamp: {self.diagnostics['timestamp']}")
        
        # System info
        print("\nSystem:")
        print(f"  Platform: {self.diagnostics['system'].get('platform', 'Unknown')}")
        print(f"  CPU: {self.diagnostics['system'].get('cpu_count', 'Unknown')} cores")
        print(f"  Memory: {self.diagnostics['system'].get('memory_total_gb', 'Unknown')} GB")
        print(f"  Disk: {self.diagnostics['system'].get('disk_total_gb', 'Unknown')} GB")
        
        # Python info
        print("\nPython:")
        print(f"  Version: {self.diagnostics['python'].get('version_info', 'Unknown')}")
        print(f"  Executable: {self.diagnostics['python'].get('executable', 'Unknown')}")
        print(f"  Packages: {self.diagnostics['python'].get('total_packages', 'Unknown')}")
        
        # Nori info
        print("\nNori:")
        print(f"  Root: {self.diagnostics['nori'].get('root', 'Unknown')}")
        print(f"  Config exists: {self.diagnostics['nori']['config'].get('exists', False)}")
        
        # Service info
        print("\nServices:")
        print(f"  Ollama: {'Running' if self.diagnostics['services']['ollama'].get('running') else 'Not running'}")
        print(f"  Council: {'Running' if self.diagnostics['services']['council'].get('running') else 'Not running'}")
        print(f"  Workspace: {'Running' if self.diagnostics['services']['workspace'].get('running') else 'Not running'}")
        
        print("=" * 60)


def main():
    """Command-line interface for diagnostic collection."""
    import argparse
    
    parser = argparse.ArgumentParser(description="Nori Diagnostic Collector")
    parser.add_argument("--output", help="Output file path")
    parser.add_argument("--print", action="store_true", help="Print summary")
    parser.add_argument("--root", help="Nori root directory")
    
    args = parser.parse_args()
    
    root = Path(args.root) if args.root else None
    collector = DiagnosticCollector(root)
    
    diagnostics = collector.collect_all()
    
    if args.print:
        collector.print_summary()
    
    output_path = collector.save_diagnostics(Path(args.output) if args.output else None)
    print(f"Diagnostics saved to: {output_path}")


if __name__ == "__main__":
    main()
