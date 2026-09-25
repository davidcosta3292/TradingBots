@echo off
rem Opens the Trading Office control page in your browser.
rem Keep the small "Trading Office server" window open while you use the page.
cd /d "%~dp0"
start "Trading Office server" /min python office\serve.py 8765
timeout /t 2 /nobreak >nul
start "" http://localhost:8765
