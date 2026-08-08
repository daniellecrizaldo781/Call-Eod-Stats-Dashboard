@echo off
setlocal
cd /d "%~dp0"
echo ===============================================
echo   Call EOD Dashboard - pulling Google Sheets
echo ===============================================
echo.
call python sync_sheets.py
if errorlevel 1 goto fail

echo.
echo Done. Opening the dashboard...
start "" "%~dp0index.html"
echo.
pause
exit /b 0

:fail
echo.
echo *** Sync failed - your existing dashboard data was NOT changed. ***
echo Check that both sheets are shared as "Anyone with the link can view".
echo.
pause
exit /b 1
