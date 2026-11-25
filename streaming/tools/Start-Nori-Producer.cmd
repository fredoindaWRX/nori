@echo off
setlocal
echo Open http://127.0.0.1:8769 in your browser.
echo Keep this window running while you use the producer. Close it to stop.
"C:\Program Files\nodejs\node.exe" "%~dp0nori-producer-server.mjs"
