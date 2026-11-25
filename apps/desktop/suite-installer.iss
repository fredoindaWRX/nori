; Recovered from historical tool records dated 2026-09-27 and 2026-09-28.
; Candidate only: not compiled or validated as an installer yet.
#define MyAppName "N.O.R.I."
#define MyAppVersion "1.0.0"
#define MyAppPublisher "N.O.R.I."
#define MyAppExeName "Nori.exe"
#ifndef BuildRoot
  #define BuildRoot "."
#endif

[Setup]
AppId={{6CB18C76-1A3F-4A15-AF16-FF098C2B91B4}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={autopf}\Nori
DefaultGroupName=Nori
DisableProgramGroupPage=yes
PrivilegesRequired=admin
UsePreviousAppDir=no
ArchitecturesAllowed=x64
ArchitecturesInstallIn64BitMode=x64
Uninstallable=yes
UninstallDisplayIcon={app}\{#MyAppExeName}
AppModifyPath="{app}\{#MyAppExeName}" --manage-installation
OutputDir=release
OutputBaseFilename=Nori-Suite-Setup-x64
#ifndef CompileOnlyFixture
SetupIconFile=public\nori-icon.ico
#endif
Compression=none
SolidCompression=no
DiskSpanning=yes
DiskSliceSize=1800000000
SlicesPerDisk=26
WizardStyle=modern
CloseApplications=yes
RestartApplications=no

[Types]
Name: "standard"; Description: "Standard N.O.R.I. suite"
Name: "full"; Description: "Standard suite + optional Deep model (20B)"
Name: "custom"; Description: "Custom installation"; Flags: iscustom

[Components]
Name: "core"; Description: "N.O.R.I. desktop, local models, voice, Council, and image studio"; Types: standard full custom; Flags: fixed
Name: "deep"; Description: "Deep reasoning model — GPT-OSS 20B (13 GB)"; Types: full custom

[Files]
Source: "{#BuildRoot}\release\suite-desktop\win-unpacked\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "{#BuildRoot}\release\suite-payload\model-store\*"; DestDir: "{app}\resources\NoriSuite\models"; Components: core; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "{#BuildRoot}\release\suite-payload\deep-model-store\*"; DestDir: "{app}\resources\NoriSuite\models"; Components: deep; Flags: ignoreversion recursesubdirs createallsubdirs

[Dirs]
; Only the private model store is writable, not executable directories.
Name: "{app}\resources\NoriSuite\models"; Permissions: users-modify

[Icons]
Name: "{autoprograms}\Nori"; Filename: "{app}\{#MyAppExeName}"
Name: "{autodesktop}\N.O.R.I."; Filename: "{app}\{#MyAppExeName}"

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "Launch N.O.R.I."; Flags: nowait postinstall skipifsilent

[Code]
procedure RebaseVenv(const ConfigPath, PythonHome: string);
var
  Contents: AnsiString;
  LineStart, LineEnd, RemainingLength: Integer;
begin
  if not FileExists(ConfigPath) then
    Exit;
  if not LoadStringFromFile(ConfigPath, Contents) then
    RaiseException('Could not read the portable Python environment settings: ' + ConfigPath);
  LineStart := Pos('home = ', Contents);
  if LineStart = 0 then
    RaiseException('The portable Python environment is missing its home setting: ' + ConfigPath);
  RemainingLength := Length(Contents) - LineStart + 1;
  LineEnd := Pos(#10, Copy(Contents, LineStart, RemainingLength));
  if LineEnd = 0 then
    LineEnd := RemainingLength + 1;
  Delete(Contents, LineStart, LineEnd);
  Insert('home = ' + PythonHome + #13#10, Contents, LineStart);
  if not SaveStringToFile(ConfigPath, Contents, False) then
    RaiseException('Could not configure the portable Python environment: ' + ConfigPath);
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  SuiteRoot: string;
begin
  if CurStep <> ssPostInstall then
    Exit;
  SuiteRoot := ExpandConstant('{app}\resources\NoriSuite');
  RebaseVenv(SuiteRoot + '\nori\.venv-architect\pyvenv.cfg', SuiteRoot + '\python\Python310');
  RebaseVenv(SuiteRoot + '\tools\ComfyUI\.venv\pyvenv.cfg', SuiteRoot + '\python\Python311');
  RebaseVenv(SuiteRoot + '\apps\NoriV2\.venv-stt\pyvenv.cfg', SuiteRoot + '\python\Python311');
  RebaseVenv(SuiteRoot + '\data\voice-runtime\pyvenv.cfg', SuiteRoot + '\python\Python310');
end;
