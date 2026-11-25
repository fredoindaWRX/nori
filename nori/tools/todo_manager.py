"""
Nori Todo List Management Tool

Simple todo list management for Nori tasks and projects.
Supports adding, completing, listing, and managing todo items.
"""
import json
from pathlib import Path
from datetime import datetime
from typing import List, Dict, Optional
import uuid


class TodoItem:
    """Represents a single todo item."""
    
    def __init__(self, content: str, priority: str = "medium"):
        self.id = str(uuid.uuid4())[:8]
        self.content = content
        self.priority = priority  # low, medium, high
        self.completed = False
        self.created_at = datetime.now().isoformat()
        self.completed_at = None
        self.tags = []
    
    def to_dict(self) -> Dict:
        """Convert todo item to dictionary."""
        return {
            "id": self.id,
            "content": self.content,
            "priority": self.priority,
            "completed": self.completed,
            "created_at": self.created_at,
            "completed_at": self.completed_at,
            "tags": self.tags
        }
    
    @classmethod
    def from_dict(cls, data: Dict) -> 'TodoItem':
        """Create todo item from dictionary."""
        item = cls(data["content"], data.get("priority", "medium"))
        item.id = data["id"]
        item.completed = data["completed"]
        item.created_at = data["created_at"]
        item.completed_at = data.get("completed_at")
        item.tags = data.get("tags", [])
        return item


class TodoList:
    """Manages a collection of todo items."""
    
    def __init__(self, storage_path: Optional[Path] = None):
        self.storage_path = storage_path or Path("nori/runtime-data/todos.json")
        self.todos: List[TodoItem] = []
        self._load()
    
    def _load(self):
        """Load todos from storage."""
        if self.storage_path.exists():
            try:
                data = json.loads(self.storage_path.read_text(encoding="utf-8"))
                self.todos = [TodoItem.from_dict(item) for item in data]
            except (json.JSONDecodeError, KeyError, ValueError):
                self.todos = []
    
    def _save(self):
        """Save todos to storage."""
        self.storage_path.parent.mkdir(parents=True, exist_ok=True)
        data = [todo.to_dict() for todo in self.todos]
        self.storage_path.write_text(json.dumps(data, indent=2), encoding="utf-8")
    
    def add(self, content: str, priority: str = "medium", tags: Optional[List[str]] = None) -> TodoItem:
        """Add a new todo item."""
        todo = TodoItem(content, priority)
        if tags:
            todo.tags = tags
        self.todos.append(todo)
        self._save()
        return todo
    
    def complete(self, todo_id: str) -> bool:
        """Mark a todo item as completed."""
        for todo in self.todos:
            if todo.id == todo_id:
                todo.completed = True
                todo.completed_at = datetime.now().isoformat()
                self._save()
                return True
        return False
    
    def delete(self, todo_id: str) -> bool:
        """Delete a todo item."""
        for i, todo in enumerate(self.todos):
            if todo.id == todo_id:
                del self.todos[i]
                self._save()
                return True
        return False
    
    def list(self, include_completed: bool = False) -> List[TodoItem]:
        """List todo items."""
        if include_completed:
            return self.todos
        return [todo for todo in self.todos if not todo.completed]
    
    def get_by_priority(self, priority: str) -> List[TodoItem]:
        """Get todos by priority."""
        return [todo for todo in self.todos if todo.priority == priority and not todo.completed]
    
    def get_by_tag(self, tag: str) -> List[TodoItem]:
        """Get todos by tag."""
        return [todo for todo in self.todos if tag in todo.tags and not todo.completed]
    
    def clear_completed(self) -> int:
        """Clear all completed todos."""
        original_count = len(self.todos)
        self.todos = [todo for todo in self.todos if not todo.completed]
        self._save()
        return original_count - len(self.todos)
    
    def get_stats(self) -> Dict:
        """Get todo list statistics."""
        total = len(self.todos)
        completed = sum(1 for todo in self.todos if todo.completed)
        pending = total - completed
        
        by_priority = {
            "high": sum(1 for todo in self.todos if todo.priority == "high" and not todo.completed),
            "medium": sum(1 for todo in self.todos if todo.priority == "medium" and not todo.completed),
            "low": sum(1 for todo in self.todos if todo.priority == "low" and not todo.completed)
        }
        
        return {
            "total": total,
            "completed": completed,
            "pending": pending,
            "by_priority": by_priority
        }


def main():
    """Command-line interface for todo list management."""
    import sys
    
    if len(sys.argv) < 2:
        print("Usage: python todo_manager.py <command> [args]")
        print("Commands: add, list, complete, delete, stats, clear")
        return
    
    command = sys.argv[1]
    todo_list = TodoList()
    
    if command == "add":
        if len(sys.argv) < 3:
            print("Usage: python todo_manager.py add <content> [priority]")
            return
        content = " ".join(sys.argv[2:-1]) if len(sys.argv) > 3 else sys.argv[2]
        priority = sys.argv[-1] if len(sys.argv) > 3 and sys.argv[-1] in ["low", "medium", "high"] else "medium"
        todo = todo_list.add(content, priority)
        print(f"Added todo: {todo.id} - {todo.content}")
    
    elif command == "list":
        todos = todo_list.list(include_completed=False)
        if not todos:
            print("No pending todos")
        else:
            for todo in todos:
                status = "✓" if todo.completed else "○"
                print(f"{status} [{todo.id}] {todo.content} ({todo.priority})")
    
    elif command == "list-all":
        todos = todo_list.list(include_completed=True)
        if not todos:
            print("No todos")
        else:
            for todo in todos:
                status = "✓" if todo.completed else "○"
                print(f"{status} [{todo.id}] {todo.content} ({todo.priority})")
    
    elif command == "complete":
        if len(sys.argv) < 3:
            print("Usage: python todo_manager.py complete <todo_id>")
            return
        todo_id = sys.argv[2]
        if todo_list.complete(todo_id):
            print(f"Completed todo: {todo_id}")
        else:
            print(f"Todo not found: {todo_id}")
    
    elif command == "delete":
        if len(sys.argv) < 3:
            print("Usage: python todo_manager.py delete <todo_id>")
            return
        todo_id = sys.argv[2]
        if todo_list.delete(todo_id):
            print(f"Deleted todo: {todo_id}")
        else:
            print(f"Todo not found: {todo_id}")
    
    elif command == "stats":
        stats = todo_list.get_stats()
        print(f"Total: {stats['total']}")
        print(f"Completed: {stats['completed']}")
        print(f"Pending: {stats['pending']}")
        print(f"By priority: {stats['by_priority']}")
    
    elif command == "clear":
        cleared = todo_list.clear_completed()
        print(f"Cleared {cleared} completed todos")
    
    else:
        print(f"Unknown command: {command}")


if __name__ == "__main__":
    main()
