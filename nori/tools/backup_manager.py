"""
Nori Backup and Restore Utility

Provides backup and restore functionality for Nori system data and configuration.
Supports selective backups, scheduling, and verification.
"""
import json
import shutil
import sys
from pathlib import Path
from datetime import datetime
from typing import List, Dict, Optional
import zipfile
import hashlib


class BackupManager:
    """Manages Nori system backups."""
    
    def __init__(self, root: Path = None, backup_dir: Path = None):
        self.root = root or Path(__file__).resolve().parent.parent
        self.backup_dir = backup_dir or self.root / "backups"
        self.backup_dir.mkdir(parents=True, exist_ok=True)
    
    def create_backup(self, name: Optional[str] = None, include: Optional[List[str]] = None) -> Dict:
        """Create a backup of Nori system."""
        if name is None:
            name = f"nori_backup_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
        
        backup_path = self.backup_dir / f"{name}.zip"
        
        # Define what to backup
        backup_targets = self._get_backup_targets(include)
        
        # Create backup
        with zipfile.ZipFile(backup_path, 'w', zipfile.ZIP_DEFLATED) as zipf:
            manifest = []
            
            for target in backup_targets:
                if target.exists():
                    self._add_to_zip(zipf, target, target.name, manifest)
                else:
                    manifest.append({
                        "path": str(target),
                        "status": "skipped",
                        "reason": "not found"
                    })
        
            # Add the manifest while the archive is still open.  Writing it
            # after the context manager closes the archive raises
            # ``ValueError: ZIP archive that was already closed`` and makes
            # every backup unusable.
            manifest_json = json.dumps(manifest, indent=2)
            zipf.writestr("manifest.json", manifest_json)
        
        # Calculate hash
        backup_hash = self._calculate_hash(backup_path)
        
        return {
            "name": name,
            "path": str(backup_path),
            "size_bytes": backup_path.stat().st_size,
            "hash": backup_hash,
            "timestamp": datetime.now().isoformat(),
            "files_count": len(manifest)
        }
    
    def _get_backup_targets(self, include: Optional[List[str]] = None) -> List[Path]:
        """Get list of files/directories to backup."""
        targets = []
        
        # Always backup configuration
        targets.append(self.root / "nori" / "config.yaml")
        
        # Backup data if not excluded
        if not include or "data" in include:
            targets.append(self.root / "data")
        
        # Backup memory if not excluded
        if not include or "memory" in include:
            targets.append(self.root / "memory")
        
        # Backup apps if not excluded
        if not include or "apps" in include:
            targets.append(self.root / "apps")
        
        # Backup source if not excluded
        if not include or "source" in include:
            targets.append(self.root / "nori")
        
        # Backup workspace if not excluded
        if not include or "workspace" in include:
            targets.append(self.root / "workspace")
        
        return targets
    
    def _add_to_zip(self, zipf: zipfile.ZipFile, source: Path, arcname: str, manifest: List[Dict]):
        """Add file or directory to zip archive."""
        if source.is_file():
            zipf.write(source, arcname)
            manifest.append({
                "path": str(source),
                "arcname": arcname,
                "status": "backed_up",
                "size": source.stat().st_size
            })
        elif source.is_dir():
            for item in source.rglob("*"):
                if item.is_file():
                    relative_path = item.relative_to(source.parent)
                    zipf.write(item, str(relative_path))
                    manifest.append({
                        "path": str(item),
                        "arcname": str(relative_path),
                        "status": "backed_up",
                        "size": item.stat().st_size
                    })
    
    def _calculate_hash(self, file_path: Path) -> str:
        """Calculate SHA256 hash of file."""
        sha256 = hashlib.sha256()
        with open(file_path, 'rb') as f:
            for chunk in iter(lambda: f.read(8192), b''):
                sha256.update(chunk)
        return sha256.hexdigest()
    
    def list_backups(self) -> List[Dict]:
        """List all available backups."""
        backups = []
        
        # ``create_backup(name=...)`` deliberately allows a caller-supplied
        # name, so listing must include those archives as well as generated
        # ``nori_backup_*`` names.  The directory is dedicated to backups.
        for backup_file in self.backup_dir.glob("*.zip"):
            try:
                stat = backup_file.stat()
                # Extract manifest to get info
                with zipfile.ZipFile(backup_file, 'r') as zipf:
                    try:
                        manifest_json = zipf.read("manifest.json").decode('utf-8')
                        manifest = json.loads(manifest_json)
                        files_count = len(manifest)
                    except:
                        files_count = 0
                
                backups.append({
                    "name": backup_file.stem,
                    "path": str(backup_file),
                    "size_bytes": stat.st_size,
                    "created": datetime.fromtimestamp(stat.st_ctime).isoformat(),
                    "files_count": files_count
                })
            except Exception:
                continue
        
        return sorted(backups, key=lambda x: x["created"], reverse=True)
    
    def restore_backup(self, backup_name: str, restore_dir: Optional[Path] = None) -> Dict:
        """Restore from a backup."""
        backup_path = self.backup_dir / f"{backup_name}.zip"
        
        if not backup_path.exists():
            return {
                "success": False,
                "error": f"Backup not found: {backup_name}"
            }
        
        restore_path = restore_dir or self.root
        
        try:
            with zipfile.ZipFile(backup_path, 'r') as zipf:
                # Verify manifest first
                try:
                    manifest_json = zipf.read("manifest.json").decode('utf-8')
                    manifest = json.loads(manifest_json)
                except:
                    return {
                        "success": False,
                        "error": "Invalid or missing manifest"
                    }
                
                # Extract files
                for file_info in zipf.infolist():
                    if file_info.filename == "manifest.json":
                        continue
                    
                    zipf.extract(file_info, restore_path)
                
            return {
                "success": True,
                "backup_name": backup_name,
                "restore_path": str(restore_path),
                "files_restored": len(manifest)
            }
        except Exception as e:
            return {
                "success": False,
                "error": str(e)
            }
    
    def delete_backup(self, backup_name: str) -> bool:
        """Delete a backup."""
        backup_path = self.backup_dir / f"{backup_name}.zip"
        
        if backup_path.exists():
            backup_path.unlink()
            return True
        return False
    
    def verify_backup(self, backup_name: str) -> Dict:
        """Verify backup integrity."""
        backup_path = self.backup_dir / f"{backup_name}.zip"
        
        if not backup_path.exists():
            return {
                "valid": False,
                "error": "Backup not found"
            }
        
        try:
            current_hash = self._calculate_hash(backup_path)
            
            with zipfile.ZipFile(backup_path, 'r') as zipf:
                # Try to read manifest
                try:
                    manifest_json = zipf.read("manifest.json").decode('utf-8')
                    manifest = json.loads(manifest_json)
                    
                    # Check if all files are accessible
                    test_file = zipf.namelist()[0]
                    zipf.read(test_file)
                    
                    return {
                        "valid": True,
                        "hash": current_hash,
                        "files_count": len(manifest)
                    }
                except Exception as e:
                    return {
                        "valid": False,
                        "error": f"Backup verification failed: {e}"
                    }
        except Exception as e:
            return {
                "valid": False,
                "error": str(e)
            }


def main():
    """Command-line interface for backup management."""
    import argparse
    
    parser = argparse.ArgumentParser(description="Nori Backup and Restore Utility")
    subparsers = parser.add_subparsers(dest="command", help="Available commands")
    
    # Create backup command
    create_parser = subparsers.add_parser("create", help="Create a backup")
    create_parser.add_argument("--name", help="Backup name")
    create_parser.add_argument("--include", nargs="+", help="What to include (data, memory, apps, source, workspace)")
    
    # List backups command
    subparsers.add_parser("list", help="List all backups")
    
    # Restore backup command
    restore_parser = subparsers.add_parser("restore", help="Restore from backup")
    restore_parser.add_argument("backup_name", help="Backup name to restore")
    restore_parser.add_argument("--to", help="Restore directory (default: current root)")
    
    # Delete backup command
    delete_parser = subparsers.add_parser("delete", help="Delete a backup")
    delete_parser.add_argument("backup_name", help="Backup name to delete")
    
    # Verify backup command
    verify_parser = subparsers.add_parser("verify", help="Verify backup integrity")
    verify_parser.add_argument("backup_name", help="Backup name to verify")
    
    args = parser.parse_args()
    
    manager = BackupManager()
    
    if args.command == "create":
        result = manager.create_backup(args.name, args.include)
        print(f"Backup created: {result['name']}")
        print(f"Path: {result['path']}")
        print(f"Size: {result['size_bytes']} bytes")
        print(f"Files: {result['files_count']}")
        print(f"Hash: {result['hash']}")
    
    elif args.command == "list":
        backups = manager.list_backups()
        if not backups:
            print("No backups found")
        else:
            print(f"Found {len(backups)} backups:")
            for backup in backups:
                print(f"  {backup['name']}")
                print(f"    Created: {backup['created']}")
                print(f"    Size: {backup['size_bytes']} bytes")
                print(f"    Files: {backup['files_count']}")
    
    elif args.command == "restore":
        result = manager.restore_backup(args.backup_name, Path(args.to) if args.to else None)
        if result["success"]:
            print(f"Restored backup: {args.backup_name}")
            print(f"Restore path: {result['restore_path']}")
            print(f"Files restored: {result['files_restored']}")
        else:
            print(f"Restore failed: {result['error']}")
    
    elif args.command == "delete":
        if manager.delete_backup(args.backup_name):
            print(f"Deleted backup: {args.backup_name}")
        else:
            print(f"Backup not found: {args.backup_name}")
    
    elif args.command == "verify":
        result = manager.verify_backup(args.backup_name)
        if result["valid"]:
            print(f"Backup valid: {args.backup_name}")
            print(f"Hash: {result['hash']}")
            print(f"Files: {result['files_count']}")
        else:
            print(f"Backup invalid: {args.backup_name}")
            print(f"Error: {result['error']}")
    
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
