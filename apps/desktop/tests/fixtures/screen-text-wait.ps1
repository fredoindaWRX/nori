# Fixed lifecycle fixture: no capture, files, network, descendants or credentials.
Start-Sleep -Seconds 10
[Console]::Out.WriteLine('late-output-must-not-be-accepted')
