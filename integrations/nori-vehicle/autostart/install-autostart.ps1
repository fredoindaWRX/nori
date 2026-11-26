# Installs the Nori vehicle bridge as a hidden logon item (no admin needed).
# It drops a tiny loader in your Startup folder that runs start-bridge-hidden.vbs at each logon.
# Remove with:  Remove-Item "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Startup\NoriVehicleBridge.vbs"
$vbs = Join-Path $PSScriptRoot 'start-bridge-hidden.vbs'
if (-not (Test-Path $vbs)) { throw "launcher not found: $vbs" }

$startup = [Environment]::GetFolderPath('Startup')
$loader  = Join-Path $startup 'NoriVehicleBridge.vbs'
$content = 'CreateObject("WScript.Shell").Run "wscript.exe ""' + $vbs + '""", 0, False'
Set-Content -Path $loader -Value $content -Encoding ASCII

Write-Host "Installed logon item: $loader"
Write-Host "The vehicle bridge (port 9090) will now start hidden at each logon."
Write-Host "Start it now without logging out:  wscript `"$vbs`""
