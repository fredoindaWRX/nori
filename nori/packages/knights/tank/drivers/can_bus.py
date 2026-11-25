"""python-can transport; registration/opening is a host responsibility."""
class CanBus:
    def __init__(self,bus):self.bus=bus
    @classmethod
    def open(cls,**config):
        import can
        return cls(can.Bus(**config))
    def read(self,timeout=1):
        if not 0<=timeout<=10:raise ValueError('Invalid timeout')
        m=self.bus.recv(timeout)
        return None if m is None else {'arbitration_id':m.arbitration_id,'data':list(m.data),'extended':m.is_extended_id,'fd':m.is_fd}
    def write(self,arbitration_id,data,extended=False,fd=False):
        import can
        m=can.Message(arbitration_id=arbitration_id,data=bytes(data),is_extended_id=extended,is_fd=fd,check=True)
        self.bus.send(m,timeout=1);return {'sent_bytes':len(m.data)}
    def close(self):self.bus.shutdown()
