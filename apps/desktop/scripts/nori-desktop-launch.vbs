Option Explicit
Dim shell, env
Set shell = CreateObject("WScript.Shell")
Set env = shell.Environment("PROCESS")
env.Remove "ELECTRON_RUN_AS_NODE"
env("NORI_INFERENCE_RUNTIME") = "norllama"
env("NORI_ALLOW_WRITES") = "0"
shell.Run Chr(34) & shell.ExpandEnvironmentStrings("%SystemRoot%\System32\wscript.exe") & Chr(34) & " " & Chr(34) & "C:\Nori\apps\desktop\scripts\launch-current-desktop.vbs" & Chr(34), 1, False
