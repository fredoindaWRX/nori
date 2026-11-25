$ErrorActionPreference = 'Stop'
$appRoot = Split-Path -Parent $PSScriptRoot
$noriRoot = Split-Path -Parent (Split-Path -Parent $appRoot)
$launcher = Join-Path $PSScriptRoot 'launch-current-desktop.vbs'
$hostExe = Join-Path ([Environment]::GetFolderPath('System')) 'wscript.exe'
$desktop = [Environment]::GetFolderPath('DesktopDirectory')
$shortcutPath = Join-Path $desktop 'Nori.exe - Shortcut.lnk'
$oldTarget = Join-Path $appRoot 'release\native-desktop-live-20261004030826697\win-unpacked\Nori.exe'
if (-not (Test-Path -LiteralPath $shortcutPath -PathType Leaf)) { throw 'Expected existing shortcut missing; nothing changed.' }
$resolved = & cscript.exe //Nologo $launcher --inspect
if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath ([string]$resolved) -PathType Leaf)) { throw 'Selected package did not resolve; nothing changed.' }
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
if ($shortcut.TargetPath -ne $oldTarget) { throw 'Shortcut changed since inspection; preserve it and review first.' }
$backupDirectory = Join-Path $noriRoot 'recovery\desktop-shortcut-20261006'
if (Test-Path -LiteralPath $backupDirectory) { throw 'Recovery destination already exists; do not overwrite.' }
$originalHash = (Get-FileHash -LiteralPath $shortcutPath -Algorithm SHA256).Hash
New-Item -ItemType Directory -Path $backupDirectory | Out-Null
$backup = Join-Path $backupDirectory 'Nori.exe - Shortcut.lnk'
Copy-Item -LiteralPath $shortcutPath -Destination $backup
if ((Get-FileHash -LiteralPath $backup -Algorithm SHA256).Hash -ne $originalHash) { throw 'Backup verification failed; original shortcut unchanged.' }
$shortcut.TargetPath = $hostExe
$shortcut.Arguments = '"' + $launcher + '"'
$shortcut.WorkingDirectory = $appRoot
$shortcut.IconLocation = ([string]$resolved) + ',0'
$shortcut.Description = 'Nori — launch the selected build from the main Nori folder'
$shortcut.Save()
$verified = $shell.CreateShortcut($shortcutPath)
if ($verified.TargetPath -ne $hostExe -or $verified.Arguments -ne ('"' + $launcher + '"')) { throw 'Shortcut verification failed; recoverable original is in the reported backup folder.' }
[pscustomobject]@{Shortcut=$shortcutPath;Launcher=$launcher;SelectedExecutable=[string]$resolved;Backup=$backup;BackupSHA256=$originalHash;AppLaunched=$false} | Format-List
