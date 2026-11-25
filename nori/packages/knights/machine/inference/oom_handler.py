"""One bounded CPU fallback for explicit memory exhaustion."""
from copy import deepcopy
import re

class BackendError(RuntimeError):
    def __init__(self,message,status=None):super().__init__(message);self.status=status

class OOMHandler:
    def __init__(self,notify=None):self.notify=notify;self.events=[]
    @staticmethod
    def is_oom(error):
        return isinstance(error,BackendError) and bool(re.search(r'out of memory|cuda.*alloc|requires more.*memory|unable to allocate.*memory',str(error),re.I))
    def flag(self,event):
        self.events.append(deepcopy(event))
        if self.notify:
            try:self.notify(deepcopy(event))
            except Exception as exc:event['notification_error']=type(exc).__name__
    def execute(self,call,path,payload):
        try:return {'result':call(path,deepcopy(payload)),'fallback':False}
        except BackendError as exc:
            if not self.is_oom(exc):raise
            event={'destination':'architect','event':'model_oom','model':payload['model'],'action':'retry_cpu'}
            self.flag(event)
            cpu=deepcopy(payload);cpu['options']={**cpu.get('options',{}),'num_gpu':0}
            try:result=call(path,cpu)
            except Exception as failure:
                self.flag({'destination':'architect','event':'cpu_fallback_failed','model':payload['model'],'error_type':type(failure).__name__})
                raise
            return {'result':result,'fallback':True,'execution_requested':'cpu','event':event}
