@echo off
rem Opens the Trading Office control page in your browser.
rem Keep the small "Trading Office server" window open while you use the page.
cd /d "%~dp0"
start "Trading Office server" /min python -m http.server 5173 --directory office
timeout /t 2 /nobreak >nul
start "" http://localhost:5173
