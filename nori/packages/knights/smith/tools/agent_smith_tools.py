"""Guarded file tools and read-only local status; other APIs need typed adapters.

Code execution requires an isolated host runner. Generic local control APIs,
including model downloads, are not authorized by an approved origin alone.
"""
from pathlib import Path
import sqlite3
import time
from urllib.request import Request
from urllib.parse import urlsplit
from ..safety.command_filter import filter_command
from security.hard_floor import (assert_file_allowed,
                                 assert_output_safe, load_hard_floor, open_url,
                                 require_isolated_execution)

class SmithTools:
    def __init__(self,workspace,*,killed,approved_scripts=None,api_origins=(),bash_path=None):
        load_hard_floor()
        self.root=Path(workspace).resolve()
        self.killed=killed;self.scripts=dict(approved_scripts or {});self.origins=set(api_origins)
        self.bash_path=bash_path
        self.db=self.root/'.smith-schedules.sqlite3'
        assert_file_allowed(self.db, operation='write')
        self.root.mkdir(parents=True,exist_ok=True)
        with sqlite3.connect(self.db) as db:db.execute('CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY, request TEXT, interval REAL, due REAL, state TEXT)')
    def guard(self):
        if self.killed():raise PermissionError('Sentinel kill switch active')
    def path(self,value,operation='read'):
        if not isinstance(value,str) or Path(value).is_absolute() or '..' in Path(value).parts:raise ValueError('Relative workspace path required')
        p=(self.root/value).resolve()
        if self.root not in p.parents or p==self.db:raise PermissionError('Protected or outside workspace path')
        assert_file_allowed(self.root/value, operation=operation)
        return p
    def process(self,args,timeout=30):
        self.guard()
        if type(timeout) is not int or not 1<=timeout<=300:raise ValueError('Timeout must be 1 to 300 seconds')
        require_isolated_execution('smith_subprocess')
    def bash(self,command,timeout=30):
        import shlex
        args=filter_command(command)
        if not self.bash_path:raise RuntimeError('Host must configure a compatible Bash executable')
        return self.process([self.bash_path,'--noprofile','--norc','-c',shlex.join(args)],timeout)
    def python_exec(self,path,arguments=None,timeout=30):
        self.guard()
        # A matching script hash grants no OS isolation or restricted egress.
        require_isolated_execution('smith_python')
    def file_ops(self,operation,path,destination=None):
        self.guard();p=self.path(path)
        if operation=='read':
            if p.stat().st_size>512000:raise ValueError('File too large')
            content=p.read_text(encoding='utf-8');assert_output_safe(content)
            return {'status':'completed','content':content}
        if operation=='copy':
            target=self.path(destination,operation='write')
            if p.stat().st_size>512000:raise ValueError('File too large')
            data=p.read_bytes();assert_output_safe(data.decode('utf-8',errors='replace'))
            # Inspect the complete source before creating even an empty target.
            with target.open('xb') as f:f.write(data)
        elif operation=='delete':
            assert_file_allowed(self.root/path, operation='delete')
            if not p.is_file():raise ValueError('Only a single regular file can be deleted')
            p.unlink()
        else:raise ValueError('Supported file operations: read, copy, delete')
        return {'status':'completed'}
    def api_call(self,url,method='GET',body=None):
        self.guard();u=urlsplit(url)
        if u.scheme not in {'http','https'} or u.username or u.password or u.fragment:raise ValueError('Invalid API URL')
        if f'{u.scheme}://{u.netloc}' not in self.origins:raise PermissionError('API origin not approved by host')
        # Local services can execute privileged effects. This generic helper
        # has no purpose-specific authority for downloads or control requests.
        if method!='GET' or body is not None or u.query or u.path not in {'/health','/live','/api/tags','/api/ps'}:
            raise PermissionError('hard_floor_typed_api_adapter_required')
        assert_output_safe(url)
        request=Request(url,method='GET')
        with open_url(request,timeout=10) as r:
            raw=r.read(1000001)
            if len(raw)>1000000:raise ValueError('Response too large')
            content=raw.decode(errors='replace');assert_output_safe(content)
            result={'status':'completed','http_status':r.status,'body':content}
        self.guard();return result
    def cron(self,request,interval_seconds):
        self.guard()
        if type(interval_seconds) is not int or not 60<=interval_seconds<=31536000:raise ValueError('Interval must be at least 60 seconds')
        if not isinstance(request,dict) or request.get('tool') not in {'python_exec','bash'}:raise ValueError('Only execution tasks can be scheduled')
        require_isolated_execution('smith_scheduled_execution')
    def run_due(self):
        self.guard();results=[]
        with sqlite3.connect(self.db) as db:
            db.execute('BEGIN IMMEDIATE')
            rows=db.execute("SELECT id,request,interval FROM jobs WHERE state='waiting' AND due<=?",(time.time(),)).fetchall()
            db.executemany("UPDATE jobs SET state='running' WHERE id=?",[(r[0],) for r in rows])
        for id,raw,interval in rows:
            try:
                self.guard();require_isolated_execution('smith_scheduled_execution')
            except PermissionError as exc:result={'status':'denied','reason':str(exc)}
            except Exception as exc:result={'status':'failed','error_type':type(exc).__name__}
            # Legacy jobs remain inspectable and are stopped instead of being
            # rescheduled forever or dispatched with ordinary host authority.
            with sqlite3.connect(self.db) as db:db.execute("UPDATE jobs SET state='blocked' WHERE id=?",(id,))
            results.append({'id':id,'result':result})
        return results
