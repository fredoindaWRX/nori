"""
Nori Data Cleanup Utility

Provides cleanup functionality for Nori system data.
Cleans old logs, cache files, temporary files, and orphaned data.
"""
import json
import sys
from pathlib import Path
from datetime import datetime, timedelta
from typing import Dict, List, Optional


class DataCleaner:
    """Cleans up Nori system data."""
    
    def __init__(self, root: Path = None):
        self.root = root or Path(__file__).resolve().parent.parent
        self.data_dir = self.root / "nori" / "runtime-data"
        self.workspace_data = self.root / "workspace"
        self.cleanup_report = {
            "timestamp": datetime.now().isoformat(),
            "cleaned_files": [],
            "total_size_freed": 0,
            "errors": []
        }
    
    def cleanup_logs(self, keep_days: int = 7) -> Dict:
        """Clean up old log files."""
        log_dir = self.data_dir / "logs"
        if not log_dir.exists():
            return {"files_cleaned": 0, "size_freed": 0}
        
        cutoff = datetime.now() - timedelta(days=keep_days)
        files_cleaned = 0
        size_freed = 0
        
        for log_file in log_dir.glob("*.log*"):
            if log_file.stat().st_mtime < cutoff.timestamp():
                try:
                    size = log_file.stat().st_size
                    log_file.unlink()
                    files_cleaned += 1
                    size_freed += size
                    self.cleanup_report["cleaned_files"].append({
                        "path": str(log_file),
                        "size": size,
                        "type": "log"
                    })
                except Exception as e:
                    self.cleanup_report["errors"].append({
                        "path": str(log_file),
                        "error": str(e)
                    })
        
        return {"files_cleaned": files_cleaned, "size_freed": size_freed}
    
    def cleanup_cache(self, keep_days: int = 30) -> Dict:
        """Clean up cache files."""
        cache_dirs = [
            self.data_dir / "cache",
            self.root / "nori" / ".venv-architect" / "Lib" / "site-packages" / "__pycache__",
            self.root / "nori" / ".venv-architect" / "Lib" / "site-packages" / "*.dist-info"
        ]
        
        files_cleaned = 0
        size_freed = 0
        
        for cache_dir in cache_dirs:
            if not cache_dir.exists():
                continue
            
            cutoff = datetime.now() - timedelta(days=keep_days)
            
            for cache_file in cache_dir.rglob("*"):
                if cache_file.is_file() and cache_file.stat().st_mtime < cutoff.timestamp():
                    try:
                        size = cache_file.stat().st_size
                        cache_file.unlink()
                        files_cleaned += 1
                        size_freed += size
                        self.cleanup_report["cleaned_files"].append({
                            "path": str(cache_file),
                            "size": size,
                            "type": "cache"
                        })
                    except Exception as e:
                        self.cleanup_report["errors"].append({
                            "path": str(cache_file),
                            "error": str(e)
                        })
        
        return {"files_cleaned": files_cleaned, "size_freed": size_freed}
    
    def cleanup_temp_files(self) -> Dict:
        """Clean up temporary files."""
        temp_patterns = [
            "*.tmp",
            "*.temp",
            "*.bak",
            "*.swp",
            "*~"
        ]
        
        files_cleaned = 0
        size_freed = 0
        
        for pattern in temp_patterns:
            for temp_file in self.root.rglob(pattern):
                if temp_file.is_file():
                    try:
                        size = temp_file.stat().st_size
                        temp_file.unlink()
                        files_cleaned += 1
                        size_freed += size
                        self.cleanup_report["cleaned_files"].append({
                            "path": str(temp_file),
                            "size": size,
                            "type": "temp"
                        })
                    except Exception as e:
                        self.cleanup_report["errors"].append({
                            "path": str(temp_file),
                            "error": str(e)
                        })
        
        return {"files_cleaned": files_cleaned, "size_freed": size_freed}
    
    def cleanup_old_backups(self, keep_count: int = 5) -> Dict:
        """Clean up old backup files."""
        backup_dir = self.root / "backups"
        if not backup_dir.exists():
            return {"files_cleaned": 0, "size_freed": 0}
        
        # Get all backup files sorted by modification time
        backups = sorted(
            backup_dir.glob("nori_backup_*.zip"),
            key=lambda x: x.stat().st_mtime,
            reverse=True
        )
        
        # Keep only the most recent backups
        backups_to_delete = backups[keep_count:]
        
        files_cleaned = 0
        size_freed = 0
        
        for backup in backups_to_delete:
            try:
                size = backup.stat().st_size
                backup.unlink()
                files_cleaned += 1
                size_freed += size
                self.cleanup_report["cleaned_files"].append({
                    "path": str(backup),
                    "size": size,
                    "type": "backup"
                })
            except Exception as e:
                self.cleanup_report["errors"].append({
                    "path": str(backup),
                    "error": str(e)
                })
        
        return {"files_cleaned": files_cleaned, "size_freed": size_freed}
    
    def cleanup_orphaned_pyc(self) -> Dict:
        """Clean up orphaned .pyc files."""
        files_cleaned = 0
        size_freed = 0
        
        for pyc_file in self.root.rglob("*.pyc"):
            # Check if corresponding .py file exists
            py_file = pyc_file.with_suffix('.py')
            if not py_file.exists():
                try:
                    size = pyc_file.stat().st_size
                    pyc_file.unlink()
                    files_cleaned += 1
                    size_freed += size
                    self.cleanup_report["cleaned_files"].append({
                        "path": str(pyc_file),
                        "size": size,
                        "type": "orphaned_pyc"
                    })
                except Exception as e:
                    self.cleanup_report["errors"].append({
                        "path": str(pyc_file),
                        "error": str(e)
                    })
        
        return {"files_cleaned": files_cleaned, "size_freed": size_freed}
    
    def cleanup_empty_directories(self) -> Dict:
        """Clean up empty directories."""
        dirs_cleaned = 0
        
        for directory in self.root.rglob("*"):
            if directory.is_dir():
                try:
                    # Check if directory is empty
                    if not any(directory.iterdir()):
                        directory.rmdir()
                        dirs_cleaned += 1
                        self.cleanup_report["cleaned_files"].append({
                            "path": str(directory),
                            "size": 0,
                            "type": "empty_dir"
                        })
                except:
                    # Directory not empty or permission error
                    pass
        
        return {"dirs_cleaned": dirs_cleaned}
    
    def cleanup_all(self, keep_logs_days: int = 7, keep_cache_days: int = 30, keep_backups: int = 5) -> Dict:
        """Run all cleanup operations."""
        self.cleanup_report = {
            "timestamp": datetime.now().isoformat(),
            "cleaned_files": [],
            "total_size_freed": 0,
            "errors": []
        }
        
        # Run all cleanup operations
        logs_result = self.cleanup_logs(keep_logs_days)
        cache_result = self.cleanup_cache(keep_cache_days)
        temp_result = self.cleanup_temp_files()
        backup_result = self.cleanup_old_backups(keep_backups)
        pyc_result = self.cleanup_orphaned_pyc()
        dir_result = self.cleanup_empty_directories()
        
        # Calculate totals
        total_size = (
            logs_result["size_freed"] +
            cache_result["size_freed"] +
            temp_result["size_freed"] +
            backup_result["size_freed"] +
            pyc_result["size_freed"]
        )
        
        total_files = (
            logs_result["files_cleaned"] +
            cache_result["files_cleaned"] +
            temp_result["files_cleaned"] +
            backup_result["files_cleaned"] +
            pyc_result["files_cleaned"]
        )
        
        self.cleanup_report["total_size_freed"] = total_size
        self.cleanup_report["total_files_cleaned"] = total_files
        self.cleanup_report["total_dirs_cleaned"] = dir_result["dirs_cleaned"]
        
        return self.cleanup_report
    
    def save_report(self, report_path: Optional[Path] = None):
        """Save cleanup report to file."""
        if report_path is None:
            report_path = self.data_dir / "cleanup_report.json"
        
        report_path.parent.mkdir(parents=True, exist_ok=True)
        with open(report_path, 'w', encoding='utf-8') as f:
            json.dump(self.cleanup_report, f, indent=2)


def format_size(size_bytes: int) -> str:
    """Format size in human-readable format."""
    for unit in ['B', 'KB', 'MB', 'GB']:
        if size_bytes < 1024.0:
            return f"{size_bytes:.2f} {unit}"
        size_bytes /= 1024.0
    return f"{size_bytes:.2f} TB"


def print_cleanup_report(report: Dict):
    """Print formatted cleanup report."""
    print("=" * 60)
    print("NORI DATA CLEANUP REPORT")
    print("=" * 60)
    print(f"Timestamp: {report['timestamp']}")
    print(f"Files cleaned: {report.get('total_files_cleaned', 0)}")
    print(f"Directories cleaned: {report.get('total_dirs_cleaned', 0)}")
    print(f"Size freed: {format_size(report.get('total_size_freed', 0))}")
    print(f"Errors: {len(report.get('errors', []))}")
    
    if report.get('errors'):
        print("\nErrors:")
        for error in report['errors']:
            print(f"  {error['path']}: {error['error']}")
    
    print("=" * 60)


def main():
    """Command-line interface for data cleanup."""
    import argparse
    
    parser = argparse.ArgumentParser(description="Nori Data Cleanup Utility")
    subparsers = parser.add_subparsers(dest="command", help="Available commands")
    
    # Cleanup all command
    all_parser = subparsers.add_parser("all", help="Run all cleanup operations")
    all_parser.add_argument("--keep-logs", type=int, default=7, help="Days to keep logs")
    all_parser.add_argument("--keep-cache", type=int, default=30, help="Days to keep cache")
    all_parser.add_argument("--keep-backups", type=int, default=5, help="Number of backups to keep")
    
    # Cleanup logs command
    logs_parser = subparsers.add_parser("logs", help="Clean up old logs")
    logs_parser.add_argument("--keep-days", type=int, default=7, help="Days to keep")
    
    # Cleanup cache command
    cache_parser = subparsers.add_parser("cache", help="Clean up cache files")
    cache_parser.add_argument("--keep-days", type=int, default=30, help="Days to keep")
    
    # Cleanup temp command
    subparsers.add_parser("temp", help="Clean up temporary files")
    
    # Cleanup backups command
    backups_parser = subparsers.add_parser("backups", help="Clean up old backups")
    backups_parser.add_argument("--keep", type=int, default=5, help="Number to keep")
    
    # Cleanup orphaned pyc command
    subparsers.add_parser("pyc", help="Clean up orphaned .pyc files")
    
    # Cleanup empty dirs command
    subparsers.add_parser("empty-dirs", help="Clean up empty directories")
    
    args = parser.parse_args()
    
    cleaner = DataCleaner()
    
    if args.command == "all":
        report = cleaner.cleanup_all(args.keep_logs, args.keep_cache, args.keep_backups)
        print_cleanup_report(report)
        cleaner.save_report()
    
    elif args.command == "logs":
        result = cleaner.cleanup_logs(args.keep_days)
        print(f"Cleaned {result['files_cleaned']} log files")
        print(f"Freed {format_size(result['size_freed'])}")
    
    elif args.command == "cache":
        result = cleaner.cleanup_cache(args.keep_days)
        print(f"Cleaned {result['files_cleaned']} cache files")
        print(f"Freed {format_size(result['size_freed'])}")
    
    elif args.command == "temp":
        result = cleaner.cleanup_temp_files()
        print(f"Cleaned {result['files_cleaned']} temp files")
        print(f"Freed {format_size(result['size_freed'])}")
    
    elif args.command == "backups":
        result = cleaner.cleanup_old_backups(args.keep)
        print(f"Cleaned {result['files_cleaned']} backup files")
        print(f"Freed {format_size(result['size_freed'])}")
    
    elif args.command == "pyc":
        result = cleaner.cleanup_orphaned_pyc()
        print(f"Cleaned {result['files_cleaned']} orphaned .pyc files")
        print(f"Freed {format_size(result['size_freed'])}")
    
    elif args.command == "empty-dirs":
        result = cleaner.cleanup_empty_directories()
        print(f"Cleaned {result['dirs_cleaned']} empty directories")
    
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
