@echo off
cd /d "%~dp0"
echo ===============================================
echo   Call EOD Dashboard - pulling Google Sheets
echo ===============================================
echo.
python sync_sheets.py
echo.
if errorlevel 1 (
  echo *** Sync failed - your existing dashboard data was NOT changed. ***
  echo Check that both sheets are shared as "Anyone with the link can view".
) else (
  echo Done. Opening the dashboard...
  start "" "%~dp0index.html"
)
echo.
pause
