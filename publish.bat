@echo off
setlocal
cd /d "%~dp0"

echo [1/3] Pulling latest rows from Google Sheets...
call python sync_sheets.py
if errorlevel 1 goto syncfail

echo.
echo [2/3] Committing changes...
call git add -A
call git diff --cached --quiet
if errorlevel 1 goto commit
echo No changes to publish - data is already up to date.
goto push

:commit
call git commit -m "Update dashboard data %date% %time%"

:push
echo.
echo [3/3] Pushing to GitHub...
call git push origin main
if errorlevel 1 goto pushfail

echo.
echo ============================================================
echo  Pushed to GitHub. Cloudflare Pages redeploys automatically.
echo  Your team link is live in about 30 seconds.
echo  (See CLOUDFLARE-SETUP.md if you have not set this up yet.)
echo ============================================================
echo.
pause
exit /b 0

:syncfail
echo.
echo *** Sheet sync failed - nothing was published. ***
echo Check both sheets are shared as "Anyone with the link can view".
pause
exit /b 1

:pushfail
echo.
echo *** Push failed. If this is the first time, sign in to GitHub
echo *** in the popup window, then run this file again.
pause
exit /b 1
