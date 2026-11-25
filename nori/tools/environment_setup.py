"""
Nori Environment Setup Script

Automated environment setup for Nori development and production.
Handles Python environment, dependencies, and configuration validation.
"""
import json
import sys
import subprocess
from pathlib import Path
from typing import Dict, List, Optional


class EnvironmentSetup:
    """Manages Nori environment setup."""
    
    def __init__(self, root: Path = None):
        self.root = root or Path(__file__).resolve().parent.parent
        self.venv_path = self.root / "nori" / ".venv-architect"
        self.requirements_file = self.root / "nori" / "requirements.txt"
        self.config_file = self.root / "nori" / "config.yaml"
        self.setup_log = []
    
    def log(self, message: str):
        """Log a message."""
        self.setup_log.append(message)
        print(message)
    
    def check_python_version(self) -> Dict:
        """Check Python version compatibility."""
        version = f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}"
        required = "3.10"
        
        self.log(f"Python version: {version}")
        
        if sys.version_info.major != 3 or sys.version_info.minor < 10:
            return {
                "success": False,
                "version": version,
                "required": required,
                "error": f"Python {required}+ required, found {version}"
            }
        
        return {
            "success": True,
            "version": version,
            "required": required
        }
    
    def create_venv(self) -> Dict:
        """Create Python virtual environment."""
        if self.venv_path.exists():
            self.log(f"Virtual environment already exists at {self.venv_path}")
            return {
                "success": True,
                "path": str(self.venv_path),
                "message": "Virtual environment already exists"
            }
        
        self.log(f"Creating virtual environment at {self.venv_path}")
        
        try:
            subprocess.run(
                [sys.executable, "-m", "venv", str(self.venv_path)],
                check=True,
                capture_output=True,
                text=True
            )
            
            self.log("Virtual environment created successfully")
            return {
                "success": True,
                "path": str(self.venv_path)
            }
        except subprocess.CalledProcessError as e:
            return {
                "success": False,
                "error": f"Failed to create venv: {e.stderr}"
            }
    
    def install_dependencies(self) -> Dict:
        """Install Python dependencies."""
        if not self.venv_path.exists():
            return {
                "success": False,
                "error": "Virtual environment does not exist"
            }
        
        if not self.requirements_file.exists():
            return {
                "success": False,
                "error": f"Requirements file not found: {self.requirements_file}"
            }
        
        # Get pip path
        if sys.platform == "win32":
            pip_path = self.venv_path / "Scripts" / "pip.exe"
        else:
            pip_path = self.venv_path / "bin" / "pip"
        
        self.log(f"Installing dependencies from {self.requirements_file}")
        
        try:
            result = subprocess.run(
                [str(pip_path), "install", "-r", str(self.requirements_file)],
                check=True,
                capture_output=True,
                text=True
            )
            
            self.log("Dependencies installed successfully")
            return {
                "success": True,
                "output": result.stdout
            }
        except subprocess.CalledProcessError as e:
            return {
                "success": False,
                "error": f"Failed to install dependencies: {e.stderr}"
            }
    
    def create_directories(self) -> Dict:
        """Create required directories."""
        directories = [
            self.root / "nori" / "runtime-data" / "logs",
            self.root / "nori" / "runtime-data" / "performance",
            self.root / "nori" / "runtime-data" / "cache",
            self.root / "data",
            self.root / "memory",
            self.root / "apps",
            self.root / "backups"
        ]
        
        created = []
        
        for directory in directories:
            if not directory.exists():
                directory.mkdir(parents=True, exist_ok=True)
                created.append(str(directory))
                self.log(f"Created directory: {directory}")
        
        return {
            "success": True,
            "created": created
        }
    
    def validate_config(self) -> Dict:
        """Validate configuration file."""
        if not self.config_file.exists():
            return {
                "success": False,
                "error": f"Configuration file not found: {self.config_file}"
            }
        
        self.log(f"Validating configuration at {self.config_file}")
        
        try:
            # Import the config validator
            sys.path.insert(0, str(self.root / "nori" / "tools"))
            from config_validator import ConfigValidator
            
            validator = ConfigValidator(self.config_file)
            result = validator.validate()
            
            if result["valid"]:
                self.log("Configuration is valid")
            else:
                self.log(f"Configuration validation failed: {len(result['errors'])} errors")
                for error in result["errors"]:
                    self.log(f"  - {error}")
            
            return result
        except ImportError:
            self.log("Config validator not available, skipping validation")
            return {
                "success": True,
                "warning": "Config validator not available"
            }
    
    def check_ollama(self) -> Dict:
        """Check if Ollama is installed and running."""
        self.log("Checking Ollama status")
        
        try:
            import requests
            response = requests.get("http://127.0.0.1:11434/api/tags", timeout=5)
            
            if response.status_code == 200:
                models = response.json().get("models", [])
                self.log(f"Ollama is running with {len(models)} models")
                return {
                    "success": True,
                    "running": True,
                    "model_count": len(models)
                }
            else:
                self.log("Ollama is not running")
                return {
                    "success": True,
                    "running": False
                }
        except Exception as e:
            self.log(f"Ollama check failed: {e}")
            return {
                "success": True,
                "running": False,
                "error": str(e)
            }
    
    def setup_all(self, skip_venv: bool = False, skip_deps: bool = False) -> Dict:
        """Run complete environment setup."""
        self.setup_log = []
        self.log("Starting Nori environment setup")
        self.log(f"Root directory: {self.root}")
        
        results = {
            "timestamp": str(Path.cwd()),
            "steps": {}
        }
        
        # Check Python version
        python_check = self.check_python_version()
        results["steps"]["python_version"] = python_check
        if not python_check["success"]:
            return results
        
        # Create virtual environment
        if not skip_venv:
            venv_result = self.create_venv()
            results["steps"]["venv"] = venv_result
            if not venv_result["success"]:
                return results
        
        # Install dependencies
        if not skip_deps:
            deps_result = self.install_dependencies()
            results["steps"]["dependencies"] = deps_result
            if not deps_result["success"]:
                return results
        
        # Create directories
        dirs_result = self.create_directories()
        results["steps"]["directories"] = dirs_result
        
        # Validate configuration
        config_result = self.validate_config()
        results["steps"]["config"] = config_result
        
        # Check Ollama
        ollama_result = self.check_ollama()
        results["steps"]["ollama"] = ollama_result
        
        # Overall success
        results["success"] = all(
            step.get("success", True) for step in results["steps"].values()
        )
        
        if results["success"]:
            self.log("Environment setup completed successfully")
        else:
            self.log("Environment setup completed with errors")
        
        return results
    
    def save_setup_log(self, log_path: Optional[Path] = None):
        """Save setup log to file."""
        if log_path is None:
            log_path = self.root / "nori" / "runtime-data" / "setup_log.txt"
        
        log_path.parent.mkdir(parents=True, exist_ok=True)
        with open(log_path, 'w', encoding='utf-8') as f:
            f.write('\n'.join(self.setup_log))


def main():
    """Command-line interface for environment setup."""
    import argparse
    
    parser = argparse.ArgumentParser(description="Nori Environment Setup")
    parser.add_argument("--skip-venv", action="store_true", help="Skip virtual environment creation")
    parser.add_argument("--skip-deps", action="store_true", help="Skip dependency installation")
    parser.add_argument("--root", help="Nori root directory")
    
    args = parser.parse_args()
    
    root = Path(args.root) if args.root else None
    setup = EnvironmentSetup(root)
    
    results = setup.setup_all(skip_venv=args.skip_venv, skip_deps=args.skip_deps)
    
    print("\n" + "=" * 60)
    print("SETUP SUMMARY")
    print("=" * 60)
    
    for step_name, step_result in results["steps"].items():
        status = "✓" if step_result.get("success", True) else "✗"
        print(f"{status} {step_name}")
        if not step_result.get("success", True) and "error" in step_result:
            print(f"  Error: {step_result['error']}")
    
    print("=" * 60)
    
    if results["success"]:
        print("Setup completed successfully!")
        setup.save_setup_log()
    else:
        print("Setup completed with errors. Check the log above.")
    
    sys.exit(0 if results["success"] else 1)


if __name__ == "__main__":
    main()
