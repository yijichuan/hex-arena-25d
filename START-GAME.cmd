@echo off
setlocal
title Hex Arena - Local Game
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-game.ps1"
if errorlevel 1 (
  echo.
  echo Game startup failed. Keep all extracted files together. See PLAY-README.txt.
  pause
)
endlocal
