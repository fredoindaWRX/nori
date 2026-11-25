; Native-suite candidate. Not release-qualified until install/modify/uninstall
; and private-state migration pass on Windows. Legacy installer is preserved.
#ifndef NativeDesktopRoot
  #error NativeDesktopRoot must identify an integrity-verified win-unpacked candidate
#endif
#ifndef NativeInstallerOutput
  #error NativeInstallerOutput must identify a fresh build output directory
#endif

[Setup]
AppId={{6CB18C76-1A3F-4A15-AF16-FF098C2B91B4}
AppName=N.O.R.I.
AppVersion=1.0.0
AppPublisher=N.O.R.I.
DefaultDirName={autopf}\Nori
DefaultGroupName=Nori
DisableProgramGroupPage=yes
PrivilegesRequired=admin
ArchitecturesAllowed=x64
ArchitecturesInstallIn64BitMode=x64
Uninstallable=yes
UninstallDisplayIcon={app}\Nori.exe
AppModifyPath="{app}\Nori.exe" --manage-installation
OutputDir={#NativeInstallerOutput}
OutputBaseFilename=Nori-Native-Suite-Setup-x64
Compression=none
SolidCompression=no
DiskSpanning=yes
; Keep installer slices large enough for the 12.1 GB GPT-OSS weight file.
; The USB bundle is still split into manageable multi-GB slices rather than
; forcing every individual runtime/model file through a 1.8 GB ceiling.
DiskSliceSize=16000000000
WizardStyle=modern
CloseApplications=yes
RestartApplications=no

[Files]
; Probe evidence and private state must not become distribution contents.
; Extended-length destination preserves deeply nested third-party license paths.
; Keep the public app path and shortcuts normal; only file IO needs the prefix.
Source: "{#NativeDesktopRoot}\*"; DestDir: "\\?\{app}"; Excludes: "resources\NoriSuite\verification\*,resources\NoriSuite\state\*,resources\NoriSuite\native-payload-receipt.json"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autoprograms}\Nori"; Filename: "{app}\Nori.exe"
Name: "{autodesktop}\N.O.R.I."; Filename: "{app}\Nori.exe"

[Run]
Filename: "{app}\Nori.exe"; Description: "Launch N.O.R.I."; Flags: nowait postinstall skipifsilent runasoriginaluser

; No blanket users-modify permission on models or executable directories.
; No private-data deletion hooks. Optional 20B installation is intentionally
; not advertised until native engine support and verified payload exist.
