"""
Nori Dependency Management Utility

Manages Python dependencies for Nori project.
Supports checking, updating, and analyzing dependencies.
"""
import json
import sys
import subprocess
from pathlib import Path
from typing import Dict, List, Optional, Tuple
import re


class DependencyManager:
    """Manages Python dependencies."""
    
    def __init__(self, root: Path = None, venv_path: Path = None):
        self.root = root or Path(__file__).resolve().parent.parent
        self.venv_path = venv_path or self.root / "nori" / ".venv-architect"
        self.requirements_file = self.root / "nori" / "requirements.txt"
    
    def _get_pip_path(self) -> Path:
        """Get pip executable path."""
        if sys.platform == "win32":
            return self.venv_path / "Scripts" / "pip.exe"
        else:
            return self.venv_path / "bin" / "pip"
    
    def _run_pip(self, args: List[str]) -> Tuple[bool, str, str]:
        """Run pip command and return result."""
        pip_path = self._get_pip_path()
        
        try:
            result = subprocess.run(
                [str(pip_path)] + args,
                check=False,
                capture_output=True,
                text=True
            )
            return result.returncode == 0, result.stdout, result.stderr
        except OSError as e:
            return False, "", str(e)
    
    def list_installed(self) -> Dict:
        """List all installed packages."""
        success, stdout, stderr = self._run_pip(["list", "--format=json"])
        
        if not success:
            return {
                "success": False,
                "error": stderr
            }
        
        try:
            packages = json.loads(stdout)
            return {
                "success": True,
                "packages": [
                    {
                        "name": pkg["name"],
                        "version": pkg["version"]
                    }
                    for pkg in packages
                ]
            }
        except json.JSONDecodeError:
            return {
                "success": False,
                "error": "Failed to parse pip output"
            }
    
    def list_outdated(self) -> Dict:
        """List outdated packages."""
        success, stdout, stderr = self._run_pip(["list", "--outdated", "--format=json"])
        
        if not success:
            return {
                "success": False,
                "error": stderr
            }
        
        try:
            packages = json.loads(stdout)
            return {
                "success": True,
                "outdated": [
                    {
                        "name": pkg["name"],
                        "current_version": pkg["version"],
                        "latest_version": pkg["latest_version"]
                    }
                    for pkg in packages
                ]
            }
        except json.JSONDecodeError:
            return {
                "success": False,
                "error": "Failed to parse pip output"
            }
    
    def check_requirements(self) -> Dict:
        """Check if requirements are satisfied."""
        if not self.requirements_file.exists():
            return {
                "success": False,
                "error": f"Requirements file not found: {self.requirements_file}"
            }
        
        success, stdout, stderr = self._run_pip(["check"])
        
        if success:
            return {
                "success": True,
                "satisfied": True,
                "message": "All requirements satisfied"
            }
        else:
            return {
                "success": True,
                "satisfied": False,
                "message": stderr
            }
    
    def install_package(self, package: str, version: Optional[str] = None) -> Dict:
        """Install a package."""
        spec = f"{package}=={version}" if version else package
        success, stdout, stderr = self._run_pip(["install", spec])
        
        if success:
            return {
                "success": True,
                "package": spec,
                "message": f"Successfully installed {spec}"
            }
        else:
            return {
                "success": False,
                "package": spec,
                "error": stderr
            }
    
    def uninstall_package(self, package: str) -> Dict:
        """Uninstall a package."""
        success, stdout, stderr = self._run_pip(["uninstall", "-y", package])
        
        if success:
            return {
                "success": True,
                "package": package,
                "message": f"Successfully uninstalled {package}"
            }
        else:
            return {
                "success": False,
                "package": package,
                "error": stderr
            }
    
    def update_package(self, package: str) -> Dict:
        """Update a package to latest version."""
        success, stdout, stderr = self._run_pip(["install", "--upgrade", package])
        
        if success:
            return {
                "success": True,
                "package": package,
                "message": f"Successfully updated {package}"
            }
        else:
            return {
                "success": False,
                "package": package,
                "error": stderr
            }
    
    def freeze_requirements(self) -> Dict:
        """Generate frozen requirements."""
        success, stdout, stderr = self._run_pip(["freeze"])
        
        if success:
            return {
                "success": True,
                "requirements": stdout.strip()
            }
        else:
            return {
                "success": False,
                "error": stderr
            }
    
    def analyze_dependencies(self, package: str) -> Dict:
        """Analyze package dependencies."""
        success, stdout, stderr = self._run_pip(["show", package])
        
        if not success:
            return {
                "success": False,
                "error": stderr
            }
        
        # Parse output
        dependencies = []
        requires_match = re.search(r"Requires: (.+)", stdout)
        if requires_match:
            deps_str = requires_match.group(1)
            if deps_str.strip():
                dependencies = [d.strip() for d in deps_str.split(",")]
        
        return {
            "success": True,
            "package": package,
            "dependencies": dependencies
        }
    
    def get_dependency_tree(self) -> Dict:
        """Get dependency tree for all packages."""
        success, stdout, stderr = self._run_pip(["deptree"])
        
        if not success:
            # deptree might not be installed
            return {
                "success": False,
                "error": "pipdeptree not installed. Install with: pip install pipdeptree"
            }
        
        return {
            "success": True,
            "tree": stdout
        }
    
    def check_security(self) -> Dict:
        """Check for security vulnerabilities using pip-audit."""
        # Try to run pip-audit
        try:
            success, stdout, stderr = self._run_pip(["audit"])
            
            if success:
                return {
                    "success": True,
                    "vulnerabilities": stdout,
                    "has_vulnerabilities": "Vulnerability found" in stdout
                }
            else:
                return {
                    "success": False,
                    "error": "pip-audit not installed. Install with: pip install pip-audit"
                }
        except:
            return {
                "success": False,
                "error": "pip-audit not installed. Install with: pip install pip-audit"
            }


def print_package_list(packages: List[Dict]):
    """Print formatted package list."""
    if not packages:
        print("No packages found")
        return
    
    print(f"Found {len(packages)} packages:")
    for pkg in packages:
        print(f"  {pkg['name']} {pkg['version']}")


def main():
    """Command-line interface for dependency management."""
    import argparse
    
    parser = argparse.ArgumentParser(description="Nori Dependency Management")
    subparsers = parser.add_subparsers(dest="command", help="Available commands")
    
    # List command
    subparsers.add_parser("list", help="List installed packages")
    
    # Outdated command
    subparsers.add_parser("outdated", help="List outdated packages")
    
    # Check command
    subparsers.add_parser("check", help="Check requirements")
    
    # Install command
    install_parser = subparsers.add_parser("install", help="Install a package")
    install_parser.add_argument("package", help="Package name")
    install_parser.add_argument("--version", help="Package version")
    
    # Uninstall command
    uninstall_parser = subparsers.add_parser("uninstall", help="Uninstall a package")
    uninstall_parser.add_argument("package", help="Package name")
    
    # Update command
    update_parser = subparsers.add_parser("update", help="Update a package")
    update_parser.add_argument("package", help="Package name")
    
    # Freeze command
    subparsers.add_parser("freeze", help="Generate frozen requirements")
    
    # Analyze command
    analyze_parser = subparsers.add_parser("analyze", help="Analyze package dependencies")
    analyze_parser.add_argument("package", help="Package name")
    
    # Tree command
    subparsers.add_parser("tree", help="Get dependency tree")
    
    # Security command
    subparsers.add_parser("security", help="Check for security vulnerabilities")
    
    args = parser.parse_args()
    
    manager = DependencyManager()
    
    if args.command == "list":
        result = manager.list_installed()
        if result["success"]:
            print_package_list(result["packages"])
        else:
            print(f"Error: {result['error']}")
    
    elif args.command == "outdated":
        result = manager.list_outdated()
        if result["success"]:
            print_package_list(result["outdated"])
        else:
            print(f"Error: {result['error']}")
    
    elif args.command == "check":
        result = manager.check_requirements()
        if result["satisfied"]:
            print("✓ All requirements satisfied")
        else:
            print("✗ Requirements not satisfied:")
            print(result["message"])
    
    elif args.command == "install":
        result = manager.install_package(args.package, args.version)
        if result["success"]:
            print(f"✓ {result['message']}")
        else:
            print(f"✗ Failed: {result['error']}")
    
    elif args.command == "uninstall":
        result = manager.uninstall_package(args.package)
        if result["success"]:
            print(f"✓ {result['message']}")
        else:
            print(f"✗ Failed: {result['error']}")
    
    elif args.command == "update":
        result = manager.update_package(args.package)
        if result["success"]:
            print(f"✓ {result['message']}")
        else:
            print(f"✗ Failed: {result['error']}")
    
    elif args.command == "freeze":
        result = manager.freeze_requirements()
        if result["success"]:
            print(result["requirements"])
        else:
            print(f"Error: {result['error']}")
    
    elif args.command == "analyze":
        result = manager.analyze_dependencies(args.package)
        if result["success"]:
            print(f"Dependencies of {args.package}:")
            for dep in result["dependencies"]:
                print(f"  - {dep}")
        else:
            print(f"Error: {result['error']}")
    
    elif args.command == "tree":
        result = manager.get_dependency_tree()
        if result["success"]:
            print(result["tree"])
        else:
            print(f"Error: {result['error']}")
    
    elif args.command == "security":
        result = manager.check_security()
        if result["success"]:
            if result.get("has_vulnerabilities"):
                print("⚠ Security vulnerabilities found:")
                print(result["vulnerabilities"])
            else:
                print("✓ No security vulnerabilities found")
        else:
            print(f"Error: {result['error']}")
    
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
