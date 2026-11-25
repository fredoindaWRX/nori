"""Read-only bounded SQLite queries, intended for the isolated worker."""
import hashlib
import json
from pathlib import Path
import sqlite3
import time


def query_database(path, query, parameters):
    path = Path(path).resolve(strict=True)
    if path.stat().st_size > 512*1024: raise ValueError('Database exceeds 512 KB import limit')
    if not isinstance(query,str) or not 1 <= len(query) <= 4000: raise ValueError('Invalid SQL length')
    if not isinstance(parameters,list) or len(parameters)>50 or any(type(v) not in (str,int,float,type(None)) for v in parameters):
        raise ValueError('Use a list of scalar SQL parameters')
    allowed_functions={'count','sum','avg','min','max','abs','round','length','lower','upper','coalesce','ifnull','nullif','substr','substring','date','datetime','strftime','total'}
    def authorize(action, first, second, database, trigger):
        if action in {sqlite3.SQLITE_SELECT,sqlite3.SQLITE_READ}: return sqlite3.SQLITE_OK
        if action==sqlite3.SQLITE_FUNCTION and (second or '').lower() in allowed_functions: return sqlite3.SQLITE_OK
        return sqlite3.SQLITE_DENY
    conn=sqlite3.connect(path.as_uri()+'?mode=ro',uri=True,timeout=1)
    try:
        conn.execute('PRAGMA query_only=ON')
        conn.enable_load_extension(False)
        conn.set_authorizer(authorize)
        deadline=time.monotonic()+2
        conn.set_progress_handler(lambda: int(time.monotonic()>deadline),1000)
        cursor=conn.execute(query,parameters)
        if cursor.description is None: raise ValueError('A result-producing read query is required')
        columns=[c[0] for c in cursor.description]
        if len(columns)>100: raise ValueError('Too many columns')
        rows=cursor.fetchmany(101)
        truncated=len(rows)>100
        rows=rows[:100]
        if any(isinstance(value,bytes) for row in rows for value in row): raise ValueError('Binary columns are not supported')
        result={'status':'completed','columns':columns,'rows':rows,'truncated':truncated,'source_sha256':hashlib.sha256(path.read_bytes()).hexdigest()}
        if len(json.dumps(result))>24000: raise ValueError('Query result exceeds 24000 characters; narrow the query')
        return result
    finally: conn.close()


if __name__ == '__main__':
    request=json.loads(Path('query.json').read_text())
    print(json.dumps(query_database('document.sqlite',request['query'],request['parameters'])))
