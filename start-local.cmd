@echo off
setlocal
cd /d "%~dp0"
set "ELECTRON_RUN_AS_NODE="
set "CUTAWAN_USER_DATA=%~dp0.tmp\dev-profile"
call npm run dev
if errorlevel 1 pause
