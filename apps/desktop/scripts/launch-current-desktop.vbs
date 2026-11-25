Option Explicit

Dim fso, shell, env, appRoot, scriptRoot, pointerPath, stream, candidate, re, executablePath, inspectOnly, gptOss, heretic, norllama, codexProvider, argument, launchCommand
inspectOnly = False
gptOss = False
heretic = False
norllama = False
codexProvider = False
For Each argument In WScript.Arguments
  Select Case LCase(argument)
    Case "--inspect"
      If inspectOnly Then WScript.Quit 2
      inspectOnly = True
    Case "--nori-gpt-oss"
      If gptOss Then WScript.Quit 2
      gptOss = True
    Case "--nori-gpt-oss-heretic"
      If heretic Then WScript.Quit 2
      heretic = True
    Case "--nori-norllama"
      If norllama Then WScript.Quit 2
      norllama = True
    Case "--nori-codex-provider"
      If codexProvider Then WScript.Quit 2
      codexProvider = True
    Case Else
      WScript.Quit 2
  End Select
Next
If (gptOss And heretic) Or ((gptOss Or heretic) And norllama) Then WScript.Quit 2
If codexProvider And (Not gptOss Or heretic) Then WScript.Quit 2
Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")
Set env = shell.Environment("PROCESS")
env.Remove "ELECTRON_RUN_AS_NODE"
env("NORI_GPT_OSS_HERETIC") = "0"
env("NORI_CODEX_LOCAL_PROVIDER") = "0"
If env("NORI_ALLOW_WRITES") <> "1" Then env("NORI_ALLOW_WRITES") = "0"
If gptOss Or heretic Then
  If env("NORI_REMOTE_CONTROL_ONLY") = "1" Then WScript.Quit 2
  env("NORI_INFERENCE_RUNTIME") = "gpt-oss"
  env("NORI_ALLOW_WRITES") = "0"
End If
If norllama Then env("NORI_INFERENCE_RUNTIME") = "norllama"
If heretic Then env("NORI_GPT_OSS_HERETIC") = "1"
If codexProvider Then env("NORI_CODEX_LOCAL_PROVIDER") = "1"
executablePath = fso.BuildPath(shell.ExpandEnvironmentStrings("%ProgramFiles%"), "Nori\Nori.exe")
If Not fso.FileExists(executablePath) Then
  Fail "The installed N.O.R.I. desktop executable is missing:" & vbCrLf & executablePath
End If

If inspectOnly Then
  WScript.Echo executablePath
  WScript.Quit 0
End If
shell.CurrentDirectory = fso.GetParentFolderName(executablePath)
launchCommand = """" & executablePath & """"
If gptOss Then launchCommand = launchCommand & " --nori-gpt-oss"
If heretic Then launchCommand = launchCommand & " --nori-gpt-oss-heretic"
If norllama Then launchCommand = launchCommand & " --nori-norllama"
If codexProvider Then launchCommand = launchCommand & " --nori-codex-provider"
shell.Run launchCommand, 1, False

Sub Fail(message)
  If inspectOnly Then
    WScript.Echo message
  Else
    MsgBox message, vbCritical, "N.O.R.I."
  End If
  WScript.Quit 1
End Sub
