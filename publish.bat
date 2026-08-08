@echo off
REM ============================================================
REM  Call EOD Dashboard - sync data + publish to GitHub Pages
REM  Double-click this whenever you want the team link updated.
REM ============================================================
cd /d "%~dp0"

echo [1/3] Pulling latest rows from Google Sheets...
python sync_sheets.py
if errorlevel 1 (
  echo.
  echo *** Sheet sync failed - nothing was published. ***
  echo Check both sheets are shared as "Anyone with the link can view".
  pause
  exit /b 1
)

echo.
echo [2/3] Committing changes...
git add -A
git diff --cached --quiet && (
  echo No changes to publish - data is already up to date.
) || (
  git commit -m "Update dashboard data %date% %time%"
)

echo.
echo [3/3] Pushing to GitHub...
git push origin main
if errorlevel 1 (
  echo.
  echo *** Push failed. If this is the first time, sign in to GitHub
  echo *** in the popup window, then run this file again.
  pause
  exit /b 1
)

echo.
echo ============================================================
echo  Published. Your team link is live in about a minute:
echo  https://daniellecrizaldo781.github.io/Call-Eod-Stats-Dashboard/
echo ============================================================
echo.
pause
