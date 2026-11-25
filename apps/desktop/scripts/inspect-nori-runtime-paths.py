"""Read only whitelisted filesystem/runtime path variables from canonical Nori."""
import ctypes as c,sys,json
from ctypes import wintypes as w
assert c.sizeof(c.c_void_p)==8
pid=int(sys.argv[1]);k=c.WinDLL('kernel32',use_last_error=True);nt=c.WinDLL('ntdll')
k.OpenProcess.argtypes=[w.DWORD,w.BOOL,w.DWORD];k.OpenProcess.restype=w.HANDLE;k.CloseHandle.argtypes=[w.HANDLE]
k.ReadProcessMemory.argtypes=[w.HANDLE,c.c_void_p,c.c_void_p,c.c_size_t,c.POINTER(c.c_size_t)]
k.QueryFullProcessImageNameW.argtypes=[w.HANDLE,w.DWORD,w.LPWSTR,c.POINTER(w.DWORD)]
class PBI(c.Structure):_fields_=[('reserved',c.c_void_p),('peb',c.c_void_p),('other',c.c_void_p*2),('pid',c.c_size_t),('last',c.c_void_p)]
nt.NtQueryInformationProcess.argtypes=[w.HANDLE,w.ULONG,c.c_void_p,w.ULONG,c.POINTER(w.ULONG)]
h=k.OpenProcess(0x410,False,pid)
if not h:raise OSError(c.get_last_error(),'Cannot read Nori runtime paths')
try:
 image=c.create_unicode_buffer(32768);length=w.DWORD(len(image));assert k.QueryFullProcessImageNameW(h,0,image,c.byref(length));assert image.value.lower()==r'c:\program files\nori\nori.exe'
 def read(addr,count):
  b=c.create_string_buffer(count);n=c.c_size_t();ok=k.ReadProcessMemory(h,addr,b,count,c.byref(n))
  if not ok or n.value!=count:raise OSError(c.get_last_error(),'Nori path-variable read failed')
  return b.raw
 info=PBI();ret=w.ULONG();assert nt.NtQueryInformationProcess(h,0,c.byref(info),c.sizeof(info),c.byref(ret))==0
 params=int.from_bytes(read(info.peb+0x20,8),'little');env=int.from_bytes(read(params+0x80,8),'little');data=b''
 for offset in range(0,65536,512):
  data+=read(env+offset,512);text=data.decode('utf-16-le',errors='replace')
  if '\0\0' in text:break
 else:raise ValueError('Nori environment exceeds bounded path diagnostic')
 allowed={'LOCALAPPDATA','APPDATA','NORI_APP_DATA_ROOT','NORI_SETTINGS_DIR','NORI_REA_SCRIPT','NORI_REA_NODE','GHIDRA_INSTALL_DIR','NORI_GHIDRA_INSTALL_DIR','JAVA_HOME','NORI_JAVA_HOME'}
 output={}
 for item in text.split('\0\0',1)[0].split('\0'):
  key,sep,value=item.partition('=')
  if sep and key in allowed:output[key]=value
 print(json.dumps({'pid':pid,'path_variables':output}))
finally:k.CloseHandle(h)
