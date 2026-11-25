"""
Nori System Health Check Script

Comprehensive health monitoring for Nori system components.
Checks Ollama, services, memory, configuration, and dependencies.
"""
import json
import sys
from pathlib import Path
import subprocess
import requests
from typing import Dict, List, Tuple
from datetime import datetime


class HealthChecker:
    """Health checker for Nori system components."""
    
    def __init__(self, root: Path = None):
        self.root = root or Path(__file__).resolve().parent.parent
        self.config_path = self.root / "nori" / "config.yaml"
        self.results = {}
    
    def check_all(self) -> Dict:
        """Run all health checks."""
        self.results = {
            "timestamp": datetime.now().isoformat(),
            "checks": {}
        }
        
        # Run individual checks
        self.results["checks"]["ollama"] = self.check_ollama()
        self.results["checks"]["config"] = self.check_config()
        self.results["checks"]["python"] = self.check_python()
        self.results["checks"]["directories"] = self.check_directories()
        self.results["checks"]["dependencies"] = self.check_dependencies()
        self.results["checks"]["memory"] = self.check_memory()
        self.results["checks"]["services"] = self.check_services()
        
        # Calculate overall health
        self.results["overall_health"] = self._calculate_overall_health()
        
        return self.results
    
    def check_ollama(self) -> Dict:
        """Check Ollama service."""
        try:
            response = requests.get("http://127.0.0.1:11434/api/tags", timeout=5)
            if response.status_code == 200:
                data = response.json()
                models = data.get("models", [])
                return {
                    "status": "healthy",
                    "available": True,
                    "model_count": len(models),
                    "models": [model.get("name") for model in models]
                }
        except Exception as e:
            return {
                "status": "unhealthy",
                "available": False,
                "error": str(e)
            }
    
    def check_config(self) -> Dict:
        """Check configuration file."""
        if not self.config_path.exists():
            return {
                "status": "unhealthy",
                "available": False,
                "error": "Config file not found"
            }
        
        try:
            with open(self.config_path, 'r', encoding='utf-8') as f:
                config = json.load(f)
            
            # Check required sections
            required_sections = ["knights", "compute", "ollama_url"]
            missing = [s for s in required_sections if s not in config]
            
            if missing:
                return {
                    "status": "unhealthy",
                    "available": True,
                    "error": f"Missing sections: {missing}"
                }
            
            return {
                "status": "healthy",
                "available": True,
                "sections": list(config.keys())
            }
        except Exception as e:
            return {
                "status": "unhealthy",
                "available": True,
                "error": str(e)
            }
    
    def check_python(self) -> Dict:
        """Check Python environment."""
        return {
            "status": "healthy",
            "available": True,
            "version": f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}",
            "executable": sys.executable
        }
    
    def check_directories(self) -> Dict:
        """Check required directories."""
        required_dirs = [
            self.root / "nori",
            self.root / "nori" / "shared",
            self.root / "nori" / "packages",
            self.root / "workspace",
            self.root / "nori" / "runtime-data"
        ]
        
        missing = []
        for dir_path in required_dirs:
            if not dir_path.exists():
                missing.append(str(dir_path))
        
        if missing:
            return {
                "status": "unhealthy",
                "available": False,
                "error": f"Missing directories: {missing}"
            }
        
        return {
            "status": "healthy",
            "available": True,
            "directories": [str(d) for d in required_dirs]
        }
    
    def check_dependencies(self) -> Dict:
        """Check Python dependencies."""
        required_packages = [
            "httpx",
            "openai",
            "chromadb",
            "sentence_transformers"
        ]
        
        missing = []
        for package in required_packages:
            try:
                __import__(package)
            except ImportError:
                missing.append(package)
        
        if missing:
            return {
                "status": "degraded",
                "available": True,
                "error": f"Missing packages: {missing}"
            }
        
        return {
            "status": "healthy",
            "available": True,
            "packages": required_packages
        }
    
    def check_memory(self) -> Dict:
        """Check memory systems."""
        try:
            import psutil
            mem = psutil.virtual_memory()
            
            # Check if system has sufficient memory
            total_gb = mem.total / (1024**3)
            available_gb = mem.available / (1024**3)
            
            if total_gb < 16:
                return {
                    "status": "degraded",
                    "available": True,
                    "error": f"Insufficient memory: {total_gb:.1f}GB total"
                }
            
            return {
                "status": "healthy",
                "available": True,
                "total_gb": round(total_gb, 1),
                "available_gb": round(available_gb, 1),
                "percent_used": mem.percent
            }
        except ImportError:
            return {
                "status": "unknown",
                "available": False,
                "error": "psutil not installed"
            }
        except Exception as e:
            return {
                "status": "unhealthy",
                "available": False,
                "error": str(e)
            }
    
    def check_services(self) -> Dict:
        """Check if Nori services are running."""
        # Check common ports
        ports = {
            "Council": 9107,
            "Workspace": 9444
        }
        
        running = {}
        for service, port in ports.items():
            try:
                response = requests.get(f"http://127.0.0.1:{port}/api/status", timeout=2)
                running[service] = response.status_code == 200
            except:
                running[service] = False
        
        any_running = any(running.values())
        
        return {
            "status": "healthy" if any_running else "unhealthy",
            "available": True,
            "services": running
        }
    
    def _calculate_overall_health(self) -> str:
        """Calculate overall system health."""
        if not self.results["checks"]:
            return "unknown"
        
        statuses = [check.get("status") for check in self.results["checks"].values()]
        
        if all(s == "healthy" for s in statuses):
            return "healthy"
        elif any(s == "unhealthy" for s in statuses):
            return "unhealthy"
        else:
            return "degraded"


def print_health_report(results: Dict):
    """Print formatted health report."""
    print("=" * 60)
    print("NORI SYSTEM HEALTH REPORT")
    print("=" * 60)
    print(f"Timestamp: {results['timestamp']}")
    print(f"Overall Health: {results['overall_health'].upper()}")
    print("-" * 60)
    
    for check_name, check_result in results["checks"].items():
        status = check_result.get("status", "unknown").upper()
        print(f"\n{check_name.upper()}: {status}")
        
        if check_result.get("error"):
            print(f"  Error: {check_result['error']}")
        
        if check_name == "ollama" and check_result.get("available"):
            print(f"  Models: {check_result.get('model_count', 0)}")
        
        if check_name == "memory" and check_result.get("available"):
            print(f"  Memory: {check_result.get('total_gb', 0)}GB total, {check_result.get('available_gb', 0)}GB available")
        
        if check_name == "services" and check_result.get("available"):
            for service, running in check_result.get("services", {}).items():
                status_icon = "✓" if running else "✗"
                print(f"  {status_icon} {service}")
    
    print("-" * 60)
    print("\nHealth check complete.")


def main():
    """Run health check and print report."""
    import argparse
    
    parser = argparse.ArgumentParser(description="Nori System Health Check")
    parser.add_argument("--json", action="store_true", help="Output JSON format")
    parser.add_argument("--root", help="Nori root directory")
    
    args = parser.parse_args()
    
    root = Path(args.root) if args.root else None
    checker = HealthChecker(root)
    results = checker.check_all()
    
    if args.json:
        print(json.dumps(results, indent=2))
    else:
        print_health_report(results)
    
    # Exit with appropriate code
    sys.exit(0 if results["overall_health"] == "healthy" else 1)


if __name__ == "__main__":
    main()
