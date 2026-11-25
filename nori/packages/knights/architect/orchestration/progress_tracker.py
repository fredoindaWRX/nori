"""Thread-safe progress snapshots with optional durable report storage."""
from copy import deepcopy
from threading import RLock
from pathlib import Path
import sqlite3,json

class ProgressTracker:
    def __init__(self,path=None):
        self.lock=RLock();self.runs={};self.path=Path(path) if path else None
        if self.path:
            self.path.parent.mkdir(parents=True,exist_ok=True)
            with sqlite3.connect(self.path) as db:
                db.execute('CREATE TABLE IF NOT EXISTS runs(id TEXT PRIMARY KEY, payload TEXT)')
                self.runs={id:json.loads(raw) for id,raw in db.execute('SELECT id,payload FROM runs')}
                for state in self.runs.values():
                    if state['status']=='running':state['status']='interrupted'
    def snapshot(self,id):
        with self.lock:return deepcopy(self.runs[id])
    def save(self,id):
        with self.lock:
            state=self.snapshot(id)
            if self.path:
                with sqlite3.connect(self.path) as db:db.execute('INSERT OR REPLACE INTO runs VALUES (?,?)',(id,json.dumps(state)))
    def task_status(self,id,task_id):return self.snapshot(id)['tasks'][task_id]
