@echo off
setlocal
if "%~1"=="" (
  echo Drag your selected nori-viewer-question.json file onto this launcher.
  pause
  exit /b 1
)
"C:\Program Files\nodejs\node.exe" "%~dp0nori-stream-answer.mjs" "%~f1" "%~dp1nori-answer-%RANDOM%-%RANDOM%.json"
if errorlevel 1 (
  echo No answer was completed. Read the error above.
  pause
  exit /b 1
)
echo Import the new nori-answer file in the producer panel and review it.
pause
