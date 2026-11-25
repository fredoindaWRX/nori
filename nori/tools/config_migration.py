"""
Nori Configuration Migration Utility

Handles migration of configuration between different versions.
Provides backup, validation, and rollback capabilities.
"""
import json
import sys
import shutil
from pathlib import Path
from datetime import datetime
from typing import Dict, List, Optional
import yaml


class ConfigMigration:
    """Manages configuration migration between versions."""
    
    def __init__(self, config_path: Optional[Path] = None, backup_dir: Optional[Path] = None):
        self.config_path = config_path or Path(__file__).resolve().parent.parent / "nori" / "config.yaml"
        self.backup_dir = backup_dir or Path(__file__).resolve().parent.parent / "backups" / "config"
        self.backup_dir.mkdir(parents=True, exist_ok=True)
        self.migration_log = []
    
    def log(self, message: str):
        """Log a migration message."""
        self.migration_log.append(f"[{datetime.now().isoformat()}] {message}")
    
    def backup_config(self) -> Dict:
        """Create a backup of current configuration."""
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        backup_path = self.backup_dir / f"config_backup_{timestamp}.yaml"
        
        if not self.config_path.exists():
            return {
                "success": False,
                "error": f"Config file not found: {self.config_path}"
            }
        
        try:
            shutil.copy2(self.config_path, backup_path)
            self.log(f"Created backup: {backup_path}")
            return {
                "success": True,
                "backup_path": str(backup_path),
                "timestamp": timestamp
            }
        except Exception as e:
            return {
                "success": False,
                "error": str(e)
            }
    
    def load_config(self) -> Dict:
        """Load current configuration."""
        if not self.config_path.exists():
            return {
                "success": False,
                "error": f"Config file not found: {self.config_path}"
            }
        
        try:
            with open(self.config_path, 'r', encoding='utf-8') as f:
                config = yaml.safe_load(f)
            
            return {
                "success": True,
                "config": config
            }
        except Exception as e:
            return {
                "success": False,
                "error": str(e)
            }
    
    def save_config(self, config: Dict) -> Dict:
        """Save configuration to file."""
        try:
            with open(self.config_path, 'w', encoding='utf-8') as f:
                yaml.dump(config, f, default_flow_style=False)
            
            self.log(f"Saved configuration to: {self.config_path}")
            return {
                "success": True,
                "path": str(self.config_path)
            }
        except Exception as e:
            return {
                "success": False,
                "error": str(e)
            }
    
    def validate_config(self, config: Dict) -> Dict:
        """Validate configuration structure."""
        errors = []
        warnings = []
        
        # Check required sections
        required_sections = ["knights", "compute", "services"]
        for section in required_sections:
            if section not in config:
                errors.append(f"Missing required section: {section}")
        
        # Validate knights
        if "knights" in config:
            for knight_name, knight_config in config["knights"].items():
                if not isinstance(knight_config, dict):
                    errors.append(f"Knight {knight_name} must be a dictionary")
                    continue
                
                if "port" not in knight_config:
                    errors.append(f"Knight {knight_name} missing port")
                elif not isinstance(knight_config["port"], int) or not (1024 <= knight_config["port"] <= 65535):
                    errors.append(f"Knight {knight_name} has invalid port")
                
                if "model" not in knight_config:
                    errors.append(f"Knight {knight_name} missing model")
        
        # Validate compute
        if "compute" in config:
            if "ollama_url" in config["compute"]:
                url = config["compute"]["ollama_url"]
                if not isinstance(url, str) or not url.startswith("http"):
                    errors.append("ollama_url must be a valid HTTP URL")
        
        return {
            "success": len(errors) == 0,
            "errors": errors,
            "warnings": warnings
        }
    
    def migrate_to_v2(self) -> Dict:
        """Migrate configuration to v2 format."""
        self.log("Starting migration to v2")
        
        # Backup current config
        backup_result = self.backup_config()
        if not backup_result["success"]:
            return backup_result
        
        # Load current config
        load_result = self.load_config()
        if not load_result["success"]:
            return load_result
        
        config = load_result["config"]
        
        # Apply v2 migrations
        migrations_applied = []
        
        # Migration 1: Add default memory configuration if missing
        if "memory" not in config:
            config["memory"] = {
                "primary": {
                    "backend": "letta",
                    "url": "http://127.0.0.1:8283"
                },
                "backup": {
                    "backend": "jsonl",
                    "path": "memory/backup.jsonl"
                }
            }
            migrations_applied.append("Added default memory configuration")
        
        # Migration 2: Ensure services section has all required URLs
        if "services" in config:
            required_urls = ["ollama_url", "letta_url", "localai_url"]
            for url in required_urls:
                if url not in config["services"]:
                    if url in config.get("compute", {}):
                        config["services"][url] = config["compute"][url]
                        migrations_applied.append(f"Added {url} to services from compute")
        
        # Validate migrated config
        validation = self.validate_config(config)
        if not validation["success"]:
            return {
                "success": False,
                "error": "Validation failed after migration",
                "validation_errors": validation["errors"]
            }
        
        # Save migrated config
        save_result = self.save_config(config)
        if not save_result["success"]:
            return save_result
        
        return {
            "success": True,
            "migrations_applied": migrations_applied,
            "backup_path": backup_result["backup_path"]
        }
    
    def rollback(self, backup_path: Optional[Path] = None) -> Dict:
        """Rollback configuration from backup."""
        if backup_path is None:
            # Find most recent backup
            backups = sorted(self.backup_dir.glob("config_backup_*.yaml"), reverse=True)
            if not backups:
                return {
                    "success": False,
                    "error": "No backups found"
                }
            backup_path = backups[0]
        
        if not backup_path.exists():
            return {
                "success": False,
                "error": f"Backup not found: {backup_path}"
            }
        
        try:
            shutil.copy2(backup_path, self.config_path)
            self.log(f"Rolled back from: {backup_path}")
            return {
                "success": True,
                "restored_from": str(backup_path)
            }
        except Exception as e:
            return {
                "success": False,
                "error": str(e)
            }
    
    def list_backups(self) -> List[Dict]:
        """List available configuration backups."""
        backups = []
        
        for backup_file in sorted(self.backup_dir.glob("config_backup_*.yaml"), reverse=True):
            stat = backup_file.stat()
            backups.append({
                "path": str(backup_file),
                "timestamp": backup_file.stem.split("_")[-1],
                "size_bytes": stat.st_size,
                "created": datetime.fromtimestamp(stat.st_ctime).isoformat()
            })
        
        return backups
    
    def compare_configs(self, config1: Dict, config2: Dict) -> Dict:
        """Compare two configurations."""
        differences = []
        
        # Check for keys present in one but not the other
        keys1 = set(self._flatten_dict(config1).keys())
        keys2 = set(self._flatten_dict(config2).keys())
        
        only_in_1 = keys1 - keys2
        only_in_2 = keys2 - keys1
        
        if only_in_1:
            differences.append(f"Only in config1: {only_in_1}")
        if only_in_2:
            differences.append(f"Only in config2: {only_in_2}")
        
        # Check for value differences
        common_keys = keys1 & keys2
        flat1 = self._flatten_dict(config1)
        flat2 = self._flatten_dict(config2)
        
        for key in common_keys:
            if flat1[key] != flat2[key]:
                differences.append(f"Different value for {key}: {flat1[key]} vs {flat2[key]}")
        
        return {
            "total_differences": len(differences),
            "differences": differences
        }
    
    def _flatten_dict(self, d: Dict, parent_key: str = "") -> Dict:
        """Flatten nested dictionary."""
        items = {}
        for key, value in d.items():
            new_key = f"{parent_key}.{key}" if parent_key else key
            if isinstance(value, dict):
                items.update(self._flatten_dict(value, new_key))
            else:
                items[new_key] = value
        return items
    
    def save_migration_log(self, output_path: Optional[Path] = None) -> Path:
        """Save migration log to file."""
        if output_path is None:
            timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            output_path = self.backup_dir / f"migration_log_{timestamp}.txt"
        
        with open(output_path, 'w', encoding='utf-8') as f:
            f.write('\n'.join(self.migration_log))
        
        return output_path


def main():
    """Command-line interface for configuration migration."""
    import argparse
    
    parser = argparse.ArgumentParser(description="Nori Configuration Migration")
    parser.add_argument("--config", help="Configuration file path")
    parser.add_argument("--backup-dir", help="Backup directory path")
    subparsers = parser.add_subparsers(dest="command", help="Available commands")
    
    # Backup command
    subparsers.add_parser("backup", help="Backup current configuration")
    
    # Validate command
    subparsers.add_parser("validate", help="Validate current configuration")
    
    # Migrate command
    subparsers.add_parser("migrate", help="Migrate to v2")
    
    # Rollback command
    rollback_parser = subparsers.add_parser("rollback", help="Rollback from backup")
    rollback_parser.add_argument("--backup", help="Backup file path")
    
    # List backups command
    subparsers.add_parser("list-backups", help="List available backups")
    
    # Compare command
    compare_parser = subparsers.add_parser("compare", help="Compare with backup")
    compare_parser.add_argument("--backup", help="Backup file to compare with")
    
    args = parser.parse_args()
    
    config_path = Path(args.config) if args.config else None
    backup_dir = Path(args.backup_dir) if args.backup_dir else None
    migrator = ConfigMigration(config_path, backup_dir)
    
    if args.command == "backup":
        result = migrator.backup_config()
        if result["success"]:
            print(f"Backup created: {result['backup_path']}")
        else:
            print(f"Backup failed: {result['error']}")
    
    elif args.command == "validate":
        load_result = migrator.load_config()
        if load_result["success"]:
            validation = migrator.validate_config(load_result["config"])
            if validation["success"]:
                print("✓ Configuration is valid")
            else:
                print("✗ Validation failed:")
                for error in validation["errors"]:
                    print(f"  - {error}")
        else:
            print(f"Load failed: {load_result['error']}")
    
    elif args.command == "migrate":
        result = migrator.migrate_to_v2()
        if result["success"]:
            print("Migration successful")
            print(f"Migrations applied: {result['migrations_applied']}")
            print(f"Backup: {result['backup_path']}")
        else:
            print(f"Migration failed: {result['error']}")
    
    elif args.command == "rollback":
        backup_path = Path(args.backup) if args.backup else None
        result = migrator.rollback(backup_path)
        if result["success"]:
            print(f"Rolled back from: {result['restored_from']}")
        else:
            print(f"Rollback failed: {result['error']}")
    
    elif args.command == "list-backups":
        backups = migrator.list_backups()
        print(f"Found {len(backups)} backups:")
        for backup in backups:
            print(f"  {backup['timestamp']}: {backup['path']}")
    
    elif args.command == "compare":
        backup_path = Path(args.backup) if args.backup else None
        if not backup_path:
            print("Error: --backup is required")
        else:
            load_result = migrator.load_config()
            if load_result["success"]:
                with open(backup_path, 'r', encoding='utf-8') as f:
                    backup_config = yaml.safe_load(f)
                
                comparison = migrator.compare_configs(load_result["config"], backup_config)
                print(f"Total differences: {comparison['total_differences']}")
                for diff in comparison["differences"]:
                    print(f"  {diff}")
            else:
                print(f"Load failed: {load_result['error']}")
    
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
