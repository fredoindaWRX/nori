' Starts the Nori vehicle bridge hidden (no console window) at logon.
' Registered as the scheduled task "NoriVehicleBridge" (see install-autostart.ps1).
Option Explicit
Dim sh, fso, scriptDir, py
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = scriptDir
' Must be python.exe, not pythonw.exe: the firewall allows python.exe and blocks pythonw.exe from the tablet.
py = sh.ExpandEnvironmentStrings("%LOCALAPPDATA%\Programs\Python\Python311\python.exe")
If Not fso.FileExists(py) Then py = "python.exe"
sh.Run """" & py & """ run-bridge.py", 0, False   ' 0 = hidden window, False = don't wait
