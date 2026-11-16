@echo off
setlocal
title Shengkan

cd /d "%~dp0app"

if not exist "node_modules\electron\dist\electron.exe" (
  echo Installing dependencies...
  call npm install
)

set NEED_BUILD=0
if not exist "dist\index.html" set NEED_BUILD=1

if "%NEED_BUILD%"=="0" (
  powershell -NoProfile -ExecutionPolicy Bypass -Command "$latest=(Get-ChildItem src,electron -Recurse -File | Measure-Object LastWriteTime -Maximum).Maximum; if ($latest -gt (Get-Item dist\index.html).LastWriteTime) { exit 1 }"
  if errorlevel 1 set NEED_BUILD=1
)

if "%NEED_BUILD%"=="1" (
  echo Building UI...
  call npm run build
)

start "" "node_modules\electron\dist\electron.exe" .
