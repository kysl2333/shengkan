@echo off
setlocal
title 声栞 Engine - IndexTTS 2.5

set "PY=D:\APP\IndexTTS-2.0\.venv\Scripts\python.exe"
set "INDEXTTS_CODE_DIR=D:\APP\IndexTTS-2.0"
set "INDEXTTS_MODEL_DIR=S:\AI\IndexTTS-2.5"
set "VOICE_LIB=E:\散应用\音谷\sonicvale\音色库\参考音频"
set "ENGINE_PORT=8290"
set "HF_ENDPOINT=https://hf-mirror.com"
set "PATH=D:\APP\ffmpeg-7.0.2-essentials_build\bin;%PATH%"

if not exist "%PY%" (
  echo [错误] 找不到 IndexTTS 的 Python 环境：
  echo   %PY%
  echo 请先在设置里指定 IndexTTS 目录。
  pause
  exit /b 1
)

echo ============================================================
echo   声栞 Engine  http://127.0.0.1:%ENGINE_PORT%
echo   代码目录  %INDEXTTS_CODE_DIR%
echo   模型目录  %INDEXTTS_MODEL_DIR%
echo   音色库    %VOICE_LIB%
echo ============================================================
echo.

"%PY%" "%~dp0server.py"

echo.
echo Engine exited with code %ERRORLEVEL%.
pause
