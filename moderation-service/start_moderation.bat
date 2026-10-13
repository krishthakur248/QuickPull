@echo off
:: ============================================================
:: start_moderation.bat
:: Double-click this before your demo to start the moderation service.
:: ============================================================

echo.
echo  ===================================================
echo    QuickPull Moderation Service - Local Launcher
echo  ===================================================
echo.

:: ── EDIT THESE TWO LINES ────────────────────────────────────
:: Put the secret key you set in Render's env vars here
set MODERATION_API_KEY=QuickPull_Mod_2026_Secret!

:: Put the path to ngrok.exe here
set NGROK_PATH=C:\ngrok\ngrok.exe

:: Put your free ngrok static domain here (from ngrok dashboard)
set NGROK_DOMAIN=spotty-cheddar-unretired.ngrok-free.dev
:: ─────────────────────────────────────────────────────────────

:: Go to the moderation-service folder (same folder as this .bat file)
cd /d "%~dp0"

echo [1/2] Starting local moderation service on port 8000...
echo       (Model loading takes ~20-40 seconds, please wait)
echo.

:: Start the Python FastAPI service in a new window (activating .venv if available)
start "QuickPull Moderation" cmd /k "cd /d ""%~dp0"" && (if exist ""..\.venv\Scripts\activate.bat"" call ""..\.venv\Scripts\activate.bat"") && set MODERATION_API_KEY=%MODERATION_API_KEY% && python -m uvicorn main:app --host 0.0.0.0 --port 8000"

:: Wait 5 seconds for Python to start before launching ngrok
timeout /t 5 /nobreak >nul

echo [2/2] Starting ngrok tunnel...
echo       Public URL: https://%NGROK_DOMAIN%
echo.

:: Start ngrok with your fixed static domain in a new window
start "ngrok Tunnel" cmd /k "%NGROK_PATH% http --domain=%NGROK_DOMAIN% 8000"

echo.
echo  ===================================================
echo   Both windows are now open.
echo   Wait ~30 seconds for the model to finish loading.
echo   Then test with: curl https://%NGROK_DOMAIN%/health
echo.
echo   To STOP moderation: just close both windows.
echo   Chat will keep working normally without it.
echo  ===================================================
echo.
pause
