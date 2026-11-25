"""Explicit pymavlink telemetry and COMMAND_LONG writes, without auto-arming."""
class MAVLink:
    def __init__(self,connection):self.connection=connection
    @classmethod
    def open(cls,endpoint,**config):
        from pymavlink import mavutil
        return cls(mavutil.mavlink_connection(endpoint,**config))
    def read(self,message_type=None,timeout=1):
        if not 0<=timeout<=10:raise ValueError('Invalid timeout')
        msg=self.connection.recv_match(type=message_type,blocking=True,timeout=timeout)
        return None if msg is None else msg.to_dict()
    def write(self,command,parameters,target_system,target_component):
        import math
        if type(command) is not int or not 0<=command<=65535 or len(parameters)!=7:raise ValueError('Invalid COMMAND_LONG')
        if any(not isinstance(x,(float,int)) or not math.isfinite(x) for x in parameters):raise ValueError('Invalid parameters')
        if any(type(x) is not int or not 1<=x<=255 for x in (target_system,target_component)):raise ValueError('Explicit non-broadcast targets required')
        self.connection.mav.command_long_send(target_system,target_component,command,0,*parameters)
        return {'sent':True,'acknowledged':False}
    def close(self):self.connection.close()
