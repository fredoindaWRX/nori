"""
Nori Task Scheduler Utility

Provides task scheduling and automation for Nori system.
Supports recurring tasks, cron-like scheduling, and task dependency management.
"""
import json
import sys
import time
import threading
from pathlib import Path
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Callable
from enum import Enum


class TaskStatus(Enum):
    """Task execution status."""
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class Task:
    """Represents a scheduled task."""
    
    def __init__(self, task_id: str, name: str, func: Callable, schedule: str = None):
        self.task_id = task_id
        self.name = name
        self.func = func
        self.schedule = schedule  # cron-like expression or interval in seconds
        self.status = TaskStatus.PENDING
        self.last_run = None
        self.next_run = None
        self.run_count = 0
        self.fail_count = 0
        self.last_error = None
        self.enabled = True
    
    def should_run(self) -> bool:
        """Check if task should run now."""
        if not self.enabled or self.status == TaskStatus.RUNNING:
            return False
        
        if self.next_run is None:
            return True
        
        return datetime.now() >= self.next_run
    
    def calculate_next_run(self):
        """Calculate next run time based on schedule."""
        if self.schedule is None:
            self.next_run = None
            return
        
        try:
            # If schedule is a number, treat as interval in seconds
            interval = int(self.schedule)
            self.next_run = datetime.now() + timedelta(seconds=interval)
        except ValueError:
            # For cron-like expressions, use simple implementation
            # This is a simplified version - full cron parsing would be more complex
            self.next_run = None
    
    def run(self) -> Dict:
        """Execute the task."""
        self.status = TaskStatus.RUNNING
        start_time = datetime.now()
        
        try:
            result = self.func()
            self.status = TaskStatus.COMPLETED
            self.run_count += 1
            self.last_run = start_time
            self.last_error = None
            
            return {
                "success": True,
                "task_id": self.task_id,
                "result": result,
                "duration": (datetime.now() - start_time).total_seconds()
            }
        except Exception as e:
            self.status = TaskStatus.FAILED
            self.fail_count += 1
            self.last_run = start_time
            self.last_error = str(e)
            
            return {
                "success": False,
                "task_id": self.task_id,
                "error": str(e),
                "duration": (datetime.now() - start_time).total_seconds()
            }
        finally:
            self.calculate_next_run()


class TaskScheduler:
    """Manages task scheduling and execution."""
    
    def __init__(self, storage_path: Optional[Path] = None):
        self.storage_path = storage_path or Path(__file__).resolve().parent.parent / "nori" / "runtime-data" / "tasks.json"
        self.tasks: Dict[str, Task] = {}
        self.running = False
        self.scheduler_thread = None
        self.stop_event = threading.Event()
        self._load_tasks()
    
    def _load_tasks(self):
        """Load tasks from storage."""
        if self.storage_path.exists():
            try:
                with open(self.storage_path, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                
                for task_data in data.get("tasks", []):
                    # Recreate tasks without functions (persistent storage only)
                    task = Task(
                        task_data["task_id"],
                        task_data["name"],
                        None,  # Function not persisted
                        task_data.get("schedule")
                    )
                    task.enabled = task_data.get("enabled", True)
                    task.run_count = task_data.get("run_count", 0)
                    task.fail_count = task_data.get("fail_count", 0)
                    task.last_run = task_data.get("last_run")
                    task.next_run = task_data.get("next_run")
                    self.tasks[task.task_id] = task
            except Exception:
                pass
    
    def _save_tasks(self):
        """Save tasks to storage."""
        self.storage_path.parent.mkdir(parents=True, exist_ok=True)
        
        tasks_data = []
        for task in self.tasks.values():
            tasks_data.append({
                "task_id": task.task_id,
                "name": task.name,
                "schedule": task.schedule,
                "enabled": task.enabled,
                "run_count": task.run_count,
                "fail_count": task.fail_count,
                "last_run": task.last_run.isoformat() if task.last_run else None,
                "next_run": task.next_run.isoformat() if task.next_run else None
            })
        
        data = {
            "tasks": tasks_data,
            "last_updated": datetime.now().isoformat()
        }
        
        with open(self.storage_path, 'w', encoding='utf-8') as f:
            json.dump(data, f, indent=2)
    
    def add_task(self, task_id: str, name: str, func: Callable, schedule: str = None) -> Task:
        """Add a new task."""
        task = Task(task_id, name, func, schedule)
        task.calculate_next_run()
        self.tasks[task_id] = task
        self._save_tasks()
        return task
    
    def remove_task(self, task_id: str) -> bool:
        """Remove a task."""
        if task_id in self.tasks:
            del self.tasks[task_id]
            self._save_tasks()
            return True
        return False
    
    def enable_task(self, task_id: str) -> bool:
        """Enable a task."""
        if task_id in self.tasks:
            self.tasks[task_id].enabled = True
            self.tasks[task_id].calculate_next_run()
            self._save_tasks()
            return True
        return False
    
    def disable_task(self, task_id: str) -> bool:
        """Disable a task."""
        if task_id in self.tasks:
            self.tasks[task_id].enabled = False
            self._save_tasks()
            return True
        return False
    
    def get_task_status(self, task_id: str) -> Optional[Dict]:
        """Get status of a specific task."""
        if task_id not in self.tasks:
            return None
        
        task = self.tasks[task_id]
        return {
            "task_id": task.task_id,
            "name": task.name,
            "status": task.status.value,
            "enabled": task.enabled,
            "schedule": task.schedule,
            "last_run": task.last_run.isoformat() if task.last_run else None,
            "next_run": task.next_run.isoformat() if task.next_run else None,
            "run_count": task.run_count,
            "fail_count": task.fail_count,
            "last_error": task.last_error
        }
    
    def get_all_status(self) -> Dict:
        """Get status of all tasks."""
        return {
            "tasks": {
                task_id: self.get_task_status(task_id)
                for task_id in self.tasks.keys()
            },
            "scheduler_running": self.running
        }
    
    def _scheduler_loop(self):
        """Main scheduler loop."""
        while not self.stop_event.is_set():
            for task_id, task in self.tasks.items():
                if task.should_run():
                    result = task.run()
                    self._save_tasks()
            
            # Sleep for 1 second before checking again
            self.stop_event.wait(1)
    
    def start(self):
        """Start the scheduler."""
        if self.running:
            return
        
        self.running = True
        self.stop_event.clear()
        self.scheduler_thread = threading.Thread(target=self._scheduler_loop, daemon=True)
        self.scheduler_thread.start()
    
    def stop(self):
        """Stop the scheduler."""
        if not self.running:
            return
        
        self.running = False
        self.stop_event.set()
        
        if self.scheduler_thread:
            self.scheduler_thread.join(timeout=5)
    
    def run_task_now(self, task_id: str) -> Dict:
        """Run a task immediately, ignoring schedule."""
        if task_id not in self.tasks:
            return {
                "success": False,
                "error": f"Task not found: {task_id}"
            }
        
        task = self.tasks[task_id]
        return task.run()


def main():
    """Command-line interface for task scheduling."""
    import argparse
    
    parser = argparse.ArgumentParser(description="Nori Task Scheduler")
    subparsers = parser.add_subparsers(dest="command", help="Available commands")
    
    # List command
    subparsers.add_parser("list", help="List all tasks")
    
    # Status command
    status_parser = subparsers.add_parser("status", help="Get task status")
    status_parser.add_argument("task_id", nargs="?", help="Task ID (optional)")
    
    # Start command
    subparsers.add_parser("start", help="Start scheduler")
    
    # Stop command
    subparsers.add_parser("stop", help="Stop scheduler")
    
    # Enable command
    enable_parser = subparsers.add_parser("enable", help="Enable a task")
    enable_parser.add_argument("task_id", help="Task ID")
    
    # Disable command
    disable_parser = subparsers.add_parser("disable", help="Disable a task")
    disable_parser.add_argument("task_id", help="Task ID")
    
    # Run now command
    run_parser = subparsers.add_parser("run", help="Run task now")
    run_parser.add_argument("task_id", help="Task ID")
    
    args = parser.parse_args()
    
    scheduler = TaskScheduler()
    
    if args.command == "list":
        status = scheduler.get_all_status()
        print(f"Scheduler running: {status['scheduler_running']}")
        print(f"Total tasks: {len(status['tasks'])}")
        for task_id, task_status in status["tasks"].items():
            print(f"  {task_id}: {task_status['status']} (enabled: {task_status['enabled']})")
    
    elif args.command == "status":
        if args.task_id:
            task_status = scheduler.get_task_status(args.task_id)
            if task_status:
                print(json.dumps(task_status, indent=2))
            else:
                print(f"Task not found: {args.task_id}")
        else:
            print(json.dumps(scheduler.get_all_status(), indent=2))
    
    elif args.command == "start":
        scheduler.start()
        print("Scheduler started")
    
    elif args.command == "stop":
        scheduler.stop()
        print("Scheduler stopped")
    
    elif args.command == "enable":
        if scheduler.enable_task(args.task_id):
            print(f"Enabled task: {args.task_id}")
        else:
            print(f"Task not found: {args.task_id}")
    
    elif args.command == "disable":
        if scheduler.disable_task(args.task_id):
            print(f"Disabled task: {args.task_id}")
        else:
            print(f"Task not found: {args.task_id}")
    
    elif args.command == "run":
        result = scheduler.run_task_now(args.task_id)
        print(json.dumps(result, indent=2))
    
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
