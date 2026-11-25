"""Bleak GATT wrapper; caller manages async connection lifecycle."""
class BLE:
    def __init__(self,client):self.client=client
    @classmethod
    async def open(cls,address):
        from bleak import BleakClient
        client=BleakClient(address,timeout=10)
        await client.connect();return cls(client)
    async def read(self,characteristic):return {'data':list(await self.client.read_gatt_char(characteristic))}
    async def write(self,characteristic,data):
        await self.client.write_gatt_char(characteristic,bytes(data),response=True)
        return {'sent_bytes':len(data)}
    async def close(self):await self.client.disconnect()
