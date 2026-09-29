@echo off
cd /d "%~dp0"
if not exist "news\config.json" (
  echo Add the Analyst token to news\config.json first. See README.md.
  pause
  exit /b 1
)
node "news\analyst.mjs"
pause
