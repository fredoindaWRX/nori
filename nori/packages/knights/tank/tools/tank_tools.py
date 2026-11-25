"""Gated device boundary. Drivers must be kept private to the trusted host."""
import inspect
from copy import deepcopy
from hardware.device_drivers import PROTOCOLS

class TankTools:
    def __init__(self,*,authorize,safety_gate,killed,schema_lookup=None,edition='home',watchman_gate=None):
        if edition not in {'home','server','robotics'}:raise ValueError('Unknown edition')
        self.authorize,self.safety_gate,self.killed=authorize,safety_gate,killed
        self.schema_lookup=schema_lookup;self.devices={}
        self.edition,self.watchman_gate=edition,watchman_gate
    def register(self,id,protocol,driver,schema,capabilities=None):
        if id in self.devices or protocol not in PROTOCOLS:raise ValueError('Invalid device registration')
        inferred={'read'} if callable(getattr(driver,'read',None)) else set()
        if callable(getattr(driver,'write',None)):inferred.add('write')
        capabilities=set(capabilities or inferred)
        if not capabilities or not capabilities<={'read','write'}:raise ValueError('Invalid device capabilities')
        if 'read' in capabilities and not callable(getattr(driver,'read',None)):raise ValueError('Driver read required')
        if 'write' in capabilities and not callable(getattr(driver,'write',None)):raise ValueError('Driver write required')
        self.devices[id]=(protocol,driver,deepcopy(schema),frozenset(capabilities))
    async def execute(self,device,operation,parameters,session):
        if operation not in {'device_read','device_write'} or not isinstance(parameters,dict):raise ValueError('Invalid device operation')
        if device not in self.devices:raise ValueError('Device is not registered')
        protocol,driver,schema,capabilities=self.devices[device]
        needed='read' if operation=='device_read' else 'write'
        if needed not in capabilities:return {'status':'denied','reason':'driver_capability_unavailable'}
        request={'device':device,'protocol':protocol,'operation':operation,'parameters':deepcopy(parameters)}
        def deny(reason):
            if operation=='device_write' and self.edition=='robotics' and self.watchman_gate is not None:
                self.watchman_gate.stop()
            return {'status':'denied','reason':reason}
        try:
            authorized=not self.killed() and self.authorize(session,deepcopy(request)) is True
        except Exception:
            return deny('authorization_fault')
        if not authorized:return deny('authorization_or_kill_switch')
        if operation=='device_write':
            # Require an explicit boolean safety decision for this exact action.
            try:decision=self.safety_gate(session,deepcopy(request),deepcopy(schema))
            except Exception:return deny('safety_gate_fault')
            if decision is not True:return deny('safety_gate')
        if self.killed():return deny('kill_switch')
        if operation=='device_write' and self.edition=='robotics':
            # Robotics writers cannot fall through to raw CAN/BLE/serial/GPIO.
            # The Watchman middleware owns the final write, not a boolean pass.
            if self.watchman_gate is None:return {'status':'denied','reason':'watchman_unavailable'}
            parameters=request['parameters']
            if set(parameters)!={'torque_nm','speed_rad_s','position_rad'}:
                self.watchman_gate.stop()
                return {'status':'denied','reason':'unsupported_robotics_command'}
            result=self.watchman_gate.write({'actuator':device,**parameters},session)
            return {'status':'completed' if result.get('status')=='applied' else 'denied',
                    'device':device,'protocol':protocol,'result':result,
                    'meaning':'watchman_mock_result_only'}
        method=driver.read if operation=='device_read' else driver.write
        try:
            value=method(**request['parameters'])
            if inspect.isawaitable(value):value=await value
            return {'status':'completed','device':device,'protocol':protocol,'result':value,'meaning':'transport_result_only'}
        except Exception as exc:
            return {'status':'failed','device':device,'error_type':type(exc).__name__,'write_outcome':'unknown' if operation=='device_write' else None}
    def reference(self,query):
        if not self.schema_lookup:return {'status':'unconfigured'}
        return self.schema_lookup(query)

class GPIO:
    """Host-injected board implementation; no assumed pins or output defaults."""
    def __init__(self,read_pin,write_pin):self.read_pin,self.write_pin=read_pin,write_pin
    def read(self,pin):return {'pin':pin,'value':self.read_pin(pin)}
    def write(self,pin,value):
        if value not in (0,1):raise ValueError('Digital GPIO requires 0 or 1')
        self.write_pin(pin,value);return {'pin':pin,'value':value}
