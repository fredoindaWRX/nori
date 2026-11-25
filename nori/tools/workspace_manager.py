"""
Nori Workspace Management Utility

Manages the Nori workspace directory and related operations.
Provides workspace health checks, cleanup, and maintenance functions.
"""
import json
import sys
import shutil
from pathlib import Path
from datetime import datetime
from typing import Dict, List, Optional


class WorkspaceManager:
    """Manages Nori workspace operations."""
    
    def __init__(self, workspace_path: Optional[Path] = None):
        self.workspace_path = workspace_path or Path(__file__).resolve().parent.parent / "workspace"
        self.nori_root = self.workspace_path.parent
        self.health_report = {
            "timestamp": datetime.now().isoformat(),
            "status": "unknown",
            "checks": {}
        }
    
    def check_health(self) -> Dict:
        """Check workspace health."""
        self.health_report["status"] = "healthy"
        self.health_report["checks"] = {}
        
        # Check directory exists
        self.health_report["checks"]["directory_exists"] = self.workspace_path.exists()
        if not self.health_report["checks"]["directory_exists"]:
            self.health_report["status"] = "unhealthy"
        
        # Check key files
        key_files = [
            "server.py",
            "wake.py",
            "voice.py"
        ]
        
        for file_name in key_files:
            file_path = self.workspace_path / file_name
            self.health_report["checks"][f"file_{file_name}"] = file_path.exists()
            if not file_path.exists():
                self.health_report["status"] = "degraded"
        
        # Check static directory
        static_dir = self.workspace_path / "static"
        self.health_report["checks"]["static_dir"] = static_dir.exists()
        
        # Check for lock files
        lock_files = list(self.workspace_path.glob("*.lock"))
        self.health_report["checks"]["lock_files"] = len(lock_files)
        
        return self.health_report
    
    def clean_temp_files(self) -> Dict:
        """Clean temporary files in workspace."""
        if not self.workspace_path.exists():
            return {
                "success": False,
                "error": "Workspace directory does not exist"
            }
        
        temp_patterns = ["*.tmp", "*.temp", "*.bak", "*.swp"]
        cleaned_count = 0
        total_size = 0
        
        for pattern in temp_patterns:
            for temp_file in self.workspace_path.glob(pattern):
                try:
                    size = temp_file.stat().st_size
                    temp_file.unlink()
                    cleaned_count += 1
                    total_size += size
                except Exception:
                    pass
        
        return {
            "success": True,
            "files_cleaned": cleaned_count,
            "size_freed": total_size
        }
    
    def clean_cache(self) -> Dict:
        """Clean workspace cache."""
        cache_dirs = [
            self.workspace_path / "__pycache__",
            self.workspace_path / ".pytest_cache"
        ]
        
        cleaned_count = 0
        
        for cache_dir in cache_dirs:
            if cache_dir.exists():
                try:
                    shutil.rmtree(cache_dir)
                    cleaned_count += 1
                except Exception:
                    pass
        
        return {
            "success": True,
            "directories_cleaned": cleaned_count
        }
    
    def get_size(self) -> Dict:
        """Get workspace size information."""
        if not self.workspace_path.exists():
            return {
                "success": False,
                "error": "Workspace directory does not exist"
            }
        
        total_size = 0
        file_count = 0
        dir_count = 0
        
        for item in self.workspace_path.rglob("*"):
            if item.is_file():
                total_size += item.stat().st_size
                file_count += 1
            elif item.is_dir():
                dir_count += 1
        
        return {
            "success": True,
            "total_bytes": total_size,
            "total_mb": round(total_size / (1024**2), 2),
            "file_count": file_count,
            "directory_count": dir_count
        }
    
    def list_files(self, pattern: str = "*") -> List[Dict]:
        """List files in workspace matching pattern."""
        if not self.workspace_path.exists():
            return []
        
        files = []
        for file_path in self.workspace_path.glob(pattern):
            if file_path.is_file():
                files.append({
                    "name": file_path.name,
                    "path": str(file_path),
                    "size_bytes": file_path.stat().st_size,
                    "modified": datetime.fromtimestamp(file_path.stat().st_mtime).isoformat()
                })
        
        return sorted(files, key=lambda x: x["name"])
    
    def reset_workspace(self) -> Dict:
        """Reset workspace to clean state (WARNING: destructive)."""
        if not self.workspace_path.exists():
            return {
                "success": False,
                "error": "Workspace directory does not exist"
            }
        
        # Backup current workspace
        backup_path = self.nori_root / "backups" / f"workspace_backup_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
        
        try:
            shutil.copytree(self.workspace_path, backup_path)
            
            # Remove workspace contents except key files
            key_files = ["server.py", "wake.py", "voice.py"]
            
            for item in self.workspace_path.glob("*"):
                if item.name not in key_files and item.is_dir():
                    shutil.rmtree(item)
                elif item.name not in key_files and item.is_file():
                    item.unlink()
            
            return {
                "success": True,
                "backup_path": str(backup_path),
                "message": "Workspace reset successfully (backup created)"
            }
        except Exception as e:
            return {
                "success": False,
                "error": str(e)
            }
    
    def verify_server_config(self) -> Dict:
        """Verify workspace server configuration."""
        server_file = self.workspace_path / "server.py"
        
        if not server_file.exists():
            return {
                "success": False,
                "error": "server.py not found"
            }
        
        try:
            content = server_file.read_text(encoding='utf-8')
            
            checks = {
                "has_port_config": "PORT" in content or "port" in content,
                "has_council_config": "council" in content.lower(),
                "has_voice_config": "voice" in content.lower(),
                "has_wake_config": "wake" in content.lower()
            }
            
            return {
                "success": True,
                "checks": checks,
                "all_present": all(checks.values())
            }
        except Exception as e:
            return {
                "success": False,
                "error": str(e)
            }
    
    def get_revision(self) -> Dict:
        """Get workspace bridge revision."""
        server_file = self.workspace_path / "server.py"
        
        if not server_file.exists():
            return {
                "success": False,
                "error": "server.py not found"
            }
        
        try:
            content = server_file.read_text(encoding='utf-8')
            
            # Look for BRIDGE_REVISION
            import re
            match = re.search(r'BRIDGE_REVISION\s*=\s*[\'"]([^\'"]+)[\'"]', content)
            
            if match:
                return {
                    "success": True,
                    "revision": match.group(1)
                }
            else:
                return {
                    "success": False,
                    "error": "BRIDGE_REVISION not found"
                }
        except Exception as e:
            return {
                "success": False,
                "error": str(e)
            }
    
    def save_health_report(self, output_path: Optional[Path] = None):
        """Save health report to file."""
        if output_path is None:
            output_path = self.workspace_path / "health_report.json"
        
        with open(output_path, 'w', encoding='utf-8') as f:
            json.dump(self.health_report, f, indent=2)


def print_health_report(report: Dict):
    """Print formatted health report."""
    print("=" * 60)
    print("WORKSPACE HEALTH REPORT")
    print("=" * 60)
    print(f"Timestamp: {report['timestamp']}")
    print(f"Status: {report['status'].upper()}")
    print("\nChecks:")
    
    for check_name, check_value in report["checks"].items():
        status_icon = "✓" if check_value else "✗"
        print(f"  {status_icon} {check_name}: {check_value}")
    
    print("=" * 60)


def main():
    """Command-line interface for workspace management."""
    import argparse
    
    parser = argparse.ArgumentParser(description="Nori Workspace Management")
    parser.add_argument("--workspace", help="Workspace directory path")
    subparsers = parser.add_subparsers(dest="command", help="Available commands")
    
    # Health command
    subparsers.add_parser("health", help="Check workspace health")
    
    # Clean temp command
    subparsers.add_parser("clean-temp", help="Clean temporary files")
    
    # Clean cache command
    subparsers.add_parser("clean-cache", help="Clean cache")
    
    # Size command
    subparsers.add_parser("size", help="Get workspace size")
    
    # List command
    list_parser = subparsers.add_parser("list", help="List files")
    list_parser.add_argument("--pattern", default="*", help="File pattern")
    
    # Reset command
    subparsers.add_parser("reset", help="Reset workspace (WARNING: destructive)")
    
    # Verify command
    subparsers.add_parser("verify", help="Verify server configuration")
    
    # Revision command
    subparsers.add_parser("revision", help="Get bridge revision")
    
    args = parser.parse_args()
    
    workspace_path = Path(args.workspace) if args.workspace else None
    manager = WorkspaceManager(workspace_path)
    
    if args.command == "health":
        report = manager.check_health()
        print_health_report(report)
        manager.save_health_report()
    
    elif args.command == "clean-temp":
        result = manager.clean_temp_files()
        print(f"Cleaned {result['files_cleaned']} temporary files")
        print(f"Freed {result['size_freed']} bytes")
    
    elif args.command == "clean-cache":
        result = manager.clean_cache()
        print(f"Cleaned {result['directories_cleaned']} cache directories")
    
    elif args.command == "size":
        result = manager.get_size()
        if result["success"]:
            print(f"Total size: {result['total_mb']} MB")
            print(f"Files: {result['file_count']}")
            print(f"Directories: {result['directory_count']}")
        else:
            print(f"Error: {result['error']}")
    
    elif args.command == "list":
        files = manager.list_files(args.pattern)
        print(f"Found {len(files)} files:")
        for file_info in files:
            print(f"  {file_info['name']} ({file_info['size_bytes']} bytes)")
    
    elif args.command == "reset":
        print("WARNING: This will reset the workspace to a clean state.")
        print("A backup will be created first.")
        response = input("Continue? (yes/no): ")
        
        if response.lower() == "yes":
            result = manager.reset_workspace()
            if result["success"]:
                print(f"Workspace reset successfully")
                print(f"Backup: {result['backup_path']}")
            else:
                print(f"Reset failed: {result['error']}")
        else:
            print("Reset cancelled")
    
    elif args.command == "verify":
        result = manager.verify_server_config()
        if result["success"]:
            print("Server configuration checks:")
            for check, passed in result["checks"].items():
                status = "✓" if passed else "✗"
                print(f"  {status} {check}: {passed}")
            print(f"\nAll present: {result['all_present']}")
        else:
            print(f"Error: {result['error']}")
    
    elif args.command == "revision":
        result = manager.get_revision()
        if result["success"]:
            print(f"Bridge revision: {result['revision']}")
        else:
            print(f"Error: {result['error']}")
    
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
