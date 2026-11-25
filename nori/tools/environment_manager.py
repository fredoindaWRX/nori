"""
Nori Environment Variable Manager

Manages environment variables for Nori system.
Provides loading, saving, and validation of environment configurations.
"""
import json
import os
import sys
from pathlib import Path
from datetime import datetime
from typing import Dict, List, Optional


class EnvironmentManager:
    """Manages environment variables for Nori."""
    
    def __init__(self, env_file: Optional[Path] = None):
        self.env_file = env_file or Path(__file__).resolve().parent.parent / "nori" / ".env"
        self.variables = {}
        self._load_from_os()
    
    def _load_from_os(self):
        """Load current environment variables."""
        # Nori-specific variables
        nori_vars = {
            "NORI_ROOT": None,
            "NORI_HOME": None,
            "NORI_DATA_DIR": None,
            "NORI_MEMORY_DIR": None,
            "NORI_LOG_LEVEL": None,
            "NORI_CONFIG_PATH": None,
            "OLLAMA_URL": None,
            "LETTA_URL": None,
            "LOCALAI_URL": None,
            "HF_HUB_OFFLINE": None,
            "TRANSFORMERS_OFFLINE": None
        }
        
        for var_name, default in nori_vars.items():
            self.variables[var_name] = os.environ.get(var_name, default)
    
    def load_from_file(self, env_file: Optional[Path] = None) -> Dict:
        """Load environment variables from file."""
        if env_file is None:
            env_file = self.env_file
        
        if not env_file.exists():
            return {
                "success": False,
                "error": f"Environment file not found: {env_file}"
            }
        
        try:
            with open(env_file, 'r', encoding='utf-8') as f:
                for line in f:
                    line = line.strip()
                    if line and not line.startswith('#') and '=' in line:
                        key, value = line.split('=', 1)
                        key = key.strip()
                        value = value.strip()
                        
                        # Remove quotes if present
                        if value.startswith('"') and value.endswith('"'):
                            value = value[1:-1]
                        elif value.startswith("'") and value.endswith("'"):
                            value = value[1:-1]
                        
                        self.variables[key] = value
                        os.environ[key] = value
            
            return {
                "success": True,
                "loaded_count": len(self.variables)
            }
        except Exception as e:
            return {
                "success": False,
                "error": str(e)
            }
    
    def save_to_file(self, env_file: Optional[Path] = None) -> Dict:
        """Save environment variables to file."""
        if env_file is None:
            env_file = self.env_file
        
        try:
            with open(env_file, 'w', encoding='utf-8') as f:
                f.write("# Nori Environment Variables\n")
                f.write(f"# Generated: {datetime.now().isoformat()}\n\n")
                
                for key, value in self.variables.items():
                    if value is not None:
                        f.write(f"{key}={value}\n")
            
            return {
                "success": True,
                "path": str(env_file)
            }
        except Exception as e:
            return {
                "success": False,
                "error": str(e)
            }
    
    def set(self, key: str, value: str, persist: bool = False) -> Dict:
        """Set an environment variable."""
        self.variables[key] = value
        os.environ[key] = value
        
        if persist:
            return self.save_to_file()
        
        return {
            "success": True,
            "key": key,
            "value": value
        }
    
    def get(self, key: str, default: Optional[str] = None) -> Optional[str]:
        """Get an environment variable."""
        return self.variables.get(key, default)
    
    def unset(self, key: str, persist: bool = False) -> Dict:
        """Unset an environment variable."""
        if key in self.variables:
            del self.variables[key]
        
        if key in os.environ:
            del os.environ[key]
        
        if persist:
            return self.save_to_file()
        
        return {
            "success": True,
            "key": key
        }
    
    def validate(self) -> Dict:
        """Validate environment variables."""
        errors = []
        warnings = []
        
        # Check required variables
        required_vars = ["NORI_ROOT"]
        for var in required_vars:
            if not self.variables.get(var):
                errors.append(f"Required variable not set: {var}")
        
        # Check URLs if set
        url_vars = ["OLLAMA_URL", "LETTA_URL", "LOCALAI_URL"]
        for var in url_vars:
            value = self.variables.get(var)
            if value and not value.startswith("http"):
                warnings.append(f"{var} should start with http:// or https://")
        
        # Check boolean variables
        bool_vars = ["HF_HUB_OFFLINE", "TRANSFORMERS_OFFLINE"]
        for var in bool_vars:
            value = self.variables.get(var)
            if value and value.lower() not in ["true", "false", "1", "0"]:
                warnings.append(f"{var} should be true/false or 1/0")
        
        return {
            "success": len(errors) == 0,
            "errors": errors,
            "warnings": warnings
        }
    
    def list_all(self) -> Dict:
        """List all environment variables."""
        return {
            "variables": dict(self.variables),
            "count": len(self.variables)
        }
    
    def reset_to_defaults(self) -> Dict:
        """Reset to default values."""
        defaults = {
            "NORI_ROOT": str(Path(__file__).resolve().parent.parent),
            "NORI_LOG_LEVEL": "INFO",
            "OLLAMA_URL": "http://127.0.0.1:11434",
            "LETTA_URL": "http://127.0.0.1:8283",
            "LOCALAI_URL": "http://127.0.0.1:8080",
            "HF_HUB_OFFLINE": "1",
            "TRANSFORMERS_OFFLINE": "1"
        }
        
        for key, value in defaults.items():
            self.set(key, value)
        
        return {
            "success": True,
            "reset_count": len(defaults)
        }
    
    def export_for_shell(self, shell: str = "bash") -> str:
        """Export variables for shell script."""
        lines = []
        
        if shell == "bash":
            for key, value in self.variables.items():
                if value is not None:
                    lines.append(f"export {key}=\"{value}\"")
        elif shell == "powershell":
            for key, value in self.variables.items():
                if value is not None:
                    lines.append(f"$env:{key}=\"{value}\"")
        elif shell == "cmd":
            for key, value in self.variables.items():
                if value is not None:
                    lines.append(f"set {key}={value}")
        
        return "\n".join(lines)


def main():
    """Command-line interface for environment management."""
    import argparse
    
    parser = argparse.ArgumentParser(description="Nori Environment Variable Manager")
    parser.add_argument("--env-file", help="Environment file path")
    subparsers = parser.add_subparsers(dest="command", help="Available commands")
    
    # Load command
    load_parser = subparsers.add_parser("load", help="Load from file")
    load_parser.add_argument("--file", help="Environment file path")
    
    # Save command
    subparsers.add_parser("save", help="Save to file")
    
    # Set command
    set_parser = subparsers.add_parser("set", help="Set a variable")
    set_parser.add_argument("key", help="Variable name")
    set_parser.add_argument("value", help="Variable value")
    set_parser.add_argument("--persist", action="store_true", help="Persist to file")
    
    # Get command
    get_parser = subparsers.add_parser("get", help="Get a variable")
    get_parser.add_argument("key", help="Variable name")
    
    # Unset command
    unset_parser = subparsers.add_parser("unset", help="Unset a variable")
    unset_parser.add_argument("key", help="Variable name")
    unset_parser.add_argument("--persist", action="store_true", help="Persist to file")
    
    # List command
    subparsers.add_parser("list", help="List all variables")
    
    # Validate command
    subparsers.add_parser("validate", help="Validate variables")
    
    # Reset command
    subparsers.add_parser("reset", help="Reset to defaults")
    
    # Export command
    export_parser = subparsers.add_parser("export", help="Export for shell")
    export_parser.add_argument("--shell", default="bash", help="Shell type (bash, powershell, cmd)")
    
    args = parser.parse_args()
    
    env_file = Path(args.env_file) if args.env_file else None
    manager = EnvironmentManager(env_file)
    
    if args.command == "load":
        file_path = Path(args.file) if args.file else None
        result = manager.load_from_file(file_path)
        if result["success"]:
            print(f"Loaded {result['loaded_count']} variables")
        else:
            print(f"Error: {result['error']}")
    
    elif args.command == "save":
        result = manager.save_to_file()
        if result["success"]:
            print(f"Saved to: {result['path']}")
        else:
            print(f"Error: {result['error']}")
    
    elif args.command == "set":
        result = manager.set(args.key, args.value, args.persist)
        print(f"Set {args.key}={args.value}")
    
    elif args.command == "get":
        value = manager.get(args.key)
        if value is not None:
            print(f"{args.key}={value}")
        else:
            print(f"{args.key} is not set")
    
    elif args.command == "unset":
        result = manager.unset(args.key, args.persist)
        print(f"Unset {args.key}")
    
    elif args.command == "list":
        result = manager.list_all()
        print(f"Total variables: {result['count']}")
        for key, value in result["variables"].items():
            if value is not None:
                print(f"  {key}={value}")
    
    elif args.command == "validate":
        result = manager.validate()
        if result["success"]:
            print("✓ All variables valid")
        else:
            print("✗ Validation failed")
            for error in result["errors"]:
                print(f"  Error: {error}")
        
        if result["warnings"]:
            print("\nWarnings:")
            for warning in result["warnings"]:
                print(f"  ⚠ {warning}")
    
    elif args.command == "reset":
        result = manager.reset_to_defaults()
        print(f"Reset {result['reset_count']} variables to defaults")
    
    elif args.command == "export":
        export = manager.export_for_shell(args.shell)
        print(export)
    
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
