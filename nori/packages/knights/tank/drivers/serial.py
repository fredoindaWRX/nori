"""PySerial wrapper with bounded reads and transport timeouts."""
class Serial:
    def __init__(self,port):self.port=port
    @classmethod
    def open(cls,port,baudrate=115200):
        import serial
        return cls(serial.serial_for_url(port,baudrate=baudrate,timeout=1,write_timeout=1))
    def read(self,size=256):
        if type(size) is not int or not 1<=size<=4096:raise ValueError('Invalid read size')
        return {'data':list(self.port.read(size))}
    def write(self,data):
        payload=bytes(data)
        if len(payload)>4096:raise ValueError('Payload too large')
        return {'sent_bytes':self.port.write(payload)}
    def close(self):self.port.close()
