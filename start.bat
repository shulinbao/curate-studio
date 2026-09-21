@echo off
setlocal
cd /d "%~dp0"

rem Node resolution order:
rem   1) an explicit NODE variable you set yourself
rem   2) the "node" on your PATH
rem   3) the DeepSeek Harness bundled runtime, when present
if defined NODE goto havenode
where node >nul 2>nul
if not errorlevel 1 set "NODE=node" & goto havenode
if exist "%APPDATA%\io.github.hairyf.deepseek-harness-desktop\runtime\node.exe" set "NODE=%APPDATA%\io.github.hairyf.deepseek-harness-desktop\runtime\node.exe" & goto havenode

echo [ERROR] Node.js 14+ was not found.
echo         Install it from https://nodejs.org/ , or point NODE at your binary:
echo             set "NODE=C:\Program Files\nodejs\node.exe"
pause
exit /b 1

:havenode
echo Using Node: %NODE%
echo Starting Curate Studio ... the browser will open http://localhost:3000
echo Press Ctrl+C to stop the server.

rem open the browser after a short delay
start "" cmd /c "timeout /t 2 /nobreak >nul & start http://localhost:3000"

"%NODE%" server.js
pause
