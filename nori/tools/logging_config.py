"""
Nori Logging Configuration Utility

Provides centralized logging configuration for Nori system components.
Supports multiple log levels, file rotation, and structured logging.
"""
import json
import logging
import logging.config
import logging.handlers
import sys
from pathlib import Path
from datetime import datetime
from typing import Dict, Optional


class NoriLogger:
    """Centralized logger for Nori system."""
    
    _loggers = {}
    _initialized = False
    _root = None
    
    @classmethod
    def initialize(cls, config: Optional[Dict] = None, root: Optional[Path] = None):
        """Initialize logging system."""
        requested_root = (root or Path(__file__).resolve().parent.parent).resolve()
        if cls._initialized and cls._root == requested_root:
            return
        if cls._initialized and cls._root != requested_root:
            # Close handlers bound to the previous temporary/test root before
            # switching destinations; Windows otherwise keeps those files
            # locked and prevents cleanup.
            logging.shutdown()
            for logger in [logging.getLogger()] + [value for value in logging.root.manager.loggerDict.values()
                                                    if isinstance(value, logging.Logger)]:
                for handler in list(logger.handlers):
                    try:
                        handler.close()
                    finally:
                        logger.removeHandler(handler)
            cls._loggers.clear()
        
        root = requested_root
        log_dir = root / "nori" / "runtime-data" / "logs"
        log_dir.mkdir(parents=True, exist_ok=True)
        
        if config is None:
            config = {
                "version": 1,
                "disable_existing_loggers": False,
                "formatters": {
                    "standard": {
                        "format": "%(asctime)s [%(levelname)s] %(name)s: %(message)s",
                        "datefmt": "%Y-%m-%d %H:%M:%S"
                    },
                    "detailed": {
                        "format": "%(asctime)s [%(levelname)s] %(name)s:%(lineno)d: %(message)s",
                        "datefmt": "%Y-%m-%d %H:%M:%S"
                    }
                },
                "handlers": {
                    "console": {
                        "class": "logging.StreamHandler",
                        "level": "INFO",
                        "formatter": "standard",
                        "stream": "ext://sys.stdout"
                    },
                    "file": {
                        "class": "logging.handlers.RotatingFileHandler",
                        "level": "DEBUG",
                        "formatter": "detailed",
                        "filename": str(log_dir / "nori.log"),
                        "maxBytes": 10485760,  # 10MB
                        "backupCount": 5,
                        "encoding": "utf-8"
                    },
                    "error_file": {
                        "class": "logging.handlers.RotatingFileHandler",
                        "level": "ERROR",
                        "formatter": "detailed",
                        "filename": str(log_dir / "errors.log"),
                        "maxBytes": 10485760,  # 10MB
                        "backupCount": 5,
                        "encoding": "utf-8"
                    }
                },
                "loggers": {
                    "nori": {
                        "level": "DEBUG",
                        "handlers": ["console", "file", "error_file"],
                        "propagate": False
                    },
                    "council": {
                        "level": "INFO",
                        "handlers": ["console", "file", "error_file"],
                        "propagate": False
                    },
                    "workspace": {
                        "level": "INFO",
                        "handlers": ["console", "file"],
                        "propagate": False
                    }
                },
                "root": {
                    "level": "WARNING",
                    "handlers": ["console"]
                }
            }
        
        logging.config.dictConfig(config)
        cls._initialized = True
        cls._root = root
    
    @classmethod
    def get_logger(cls, name: str) -> logging.Logger:
        """Get a logger instance."""
        if not cls._initialized:
            cls.initialize()
        
        if name not in cls._loggers:
            cls._loggers[name] = logging.getLogger(name)
        
        return cls._loggers[name]
    
    @classmethod
    def set_level(cls, logger_name: str, level: str):
        """Set log level for a specific logger."""
        logger = cls.get_logger(logger_name)
        logger.setLevel(level.upper())
    
    @classmethod
    def get_log_files(cls, root: Optional[Path] = None) -> Dict[str, Path]:
        """Get paths to log files."""
        root = root or Path(__file__).resolve().parent.parent
        log_dir = root / "nori" / "runtime-data" / "logs"
        
        return {
            "main": log_dir / "nori.log",
            "errors": log_dir / "errors.log",
            "council": log_dir / "council.log",
            "workspace": log_dir / "workspace.log"
        }
    
    @classmethod
    def clear_logs(cls, root: Optional[Path] = None, keep_days: int = 7):
        """Clear old log files."""
        root = root or Path(__file__).resolve().parent.parent
        log_dir = root / "nori" / "runtime-data" / "logs"
        
        if not log_dir.exists():
            return
        
        cutoff = datetime.now().timestamp() - (keep_days * 86400)
        
        for log_file in log_dir.glob("*.log*"):
            if log_file.stat().st_mtime <= cutoff:
                log_file.unlink()


def configure_logging(config_file: Optional[Path] = None, root: Optional[Path] = None):
    """Configure logging from file or use defaults."""
    if config_file and config_file.exists():
        with open(config_file, 'r', encoding='utf-8') as f:
            config = json.load(f)
        NoriLogger.initialize(config, root)
    else:
        NoriLogger.initialize(None, root)


def main():
    """Command-line interface for logging configuration."""
    import argparse
    
    parser = argparse.ArgumentParser(description="Nori Logging Configuration")
    subparsers = parser.add_subparsers(dest="command", help="Available commands")
    
    # Initialize command
    init_parser = subparsers.add_parser("init", help="Initialize logging")
    init_parser.add_argument("--config", help="Config file path")
    
    # Set level command
    level_parser = subparsers.add_parser("set-level", help="Set log level")
    level_parser.add_argument("logger", help="Logger name")
    level_parser.add_argument("level", help="Log level (DEBUG, INFO, WARNING, ERROR)")
    
    # List logs command
    subparsers.add_parser("list", help="List log files")
    
    # Clear logs command
    clear_parser = subparsers.add_parser("clear", help="Clear old logs")
    clear_parser.add_argument("--keep-days", type=int, default=7, help="Days to keep")
    
    args = parser.parse_args()
    
    if args.command == "init":
        config_file = Path(args.config) if args.config else None
        configure_logging(config_file)
        print("Logging initialized")
    
    elif args.command == "set-level":
        NoriLogger.initialize()
        NoriLogger.set_level(args.logger, args.level)
        print(f"Set {args.logger} to {args.level}")
    
    elif args.command == "list":
        log_files = NoriLogger.get_log_files()
        print("Log files:")
        for name, path in log_files.items():
            exists = "✓" if path.exists() else "✗"
            print(f"  {exists} {name}: {path}")
    
    elif args.command == "clear":
        NoriLogger.clear_logs(keep_days=args.keep_days)
        print(f"Cleared logs older than {args.keep_days} days")
    
    else:
        parser.print_help()


if __name__ == "__main__":
    import logging.config
    main()
