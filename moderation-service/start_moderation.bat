@echo off
:: ============================================================
:: start_moderation.bat
:: Double-click this before your demo to start the moderation
:: service (DistilBERT) AND smart replies (all-MiniLM-L6-v2).
:: Both models load inside the same uvicorn process.
:: ============================================================

echo.
echo  ===================================================
echo    QuickPull ML Service - Moderation + Smart Replies
echo  ===================================================
echo.

:: ── EDIT THESE LINES ────────────────────────────────────────
:: Put the secret key you set in Render's env vars here
set MODERATION_API_KEY=QuickPull_Mod_2026_Secret!

:: Put the path to ngrok.exe here
set NGROK_PATH=C:\ngrok\ngrok.exe

:: Put your free ngrok static domain here (from ngrok dashboard)
set NGROK_DOMAIN=spotty-cheddar-unretired.ngrok-free.dev
:: ─────────────────────────────────────────────────────────────

:: Suppress the HuggingFace symlink warning on Windows
set HF_HUB_DISABLE_SYMLINKS_WARNING=1

:: Go to the moderation-service folder (same folder as this .bat file)
cd /d "%~dp0"

:: ── Check ngrok existence ───────────────────────────────────
if not exist "%NGROK_PATH%" (
    where ngrok >nul 2>&1 && set "NGROK_PATH=ngrok"
)

:: ── Locate virtual environment (.venv) ──────────────────────
set "VENV_DIR="
if exist "%~dp0..\.venv\Scripts\activate.bat" set "VENV_DIR=%~dp0..\.venv"
if exist "%~dp0.venv\Scripts\activate.bat" set "VENV_DIR=%~dp0.venv"

echo [1/2] Starting ML service on port 8000...
echo       Loading DistilBERT (moderation) + all-MiniLM-L6-v2 (smart replies)
echo       First load takes ~30-60 seconds. Subsequent starts are faster.
echo.

if defined VENV_DIR (
    echo [venv] Using virtual environment at: %VENV_DIR%
    start "QuickPull ML Service" cmd /k "cd /d "%~dp0" && call "%VENV_DIR%\Scripts\activate.bat" && set "MODERATION_API_KEY=%MODERATION_API_KEY%" && set "HF_HUB_DISABLE_SYMLINKS_WARNING=1" && python -m uvicorn main:app --host 0.0.0.0 --port 8000 --workers 1"
) else (
    echo [WARN] No .venv found, using system Python.
    start "QuickPull ML Service" cmd /k "cd /d "%~dp0" && set "MODERATION_API_KEY=%MODERATION_API_KEY%" && set "HF_HUB_DISABLE_SYMLINKS_WARNING=1" && python -m uvicorn main:app --host 0.0.0.0 --port 8000 --workers 1"
)

:: Wait for the service to come up before launching ngrok
echo       Waiting 50 seconds for both models to load...
timeout /t 50 /nobreak >nul 2>&1 || ping -n 51 127.0.0.1 >nul

echo [2/2] Starting ngrok tunnel...
echo       Public URL: https://%NGROK_DOMAIN%
echo.

:: Start ngrok with your fixed static domain in a new window
start "ngrok Tunnel" cmd /k "%NGROK_PATH% http --domain=%NGROK_DOMAIN% 8000"

echo.
echo  ===================================================
echo.
echo   ML service:  http://localhost:8000
echo   Tunnel URL:  https://%NGROK_DOMAIN%
echo.
echo   Test health (should show both true):
echo     curl https://%NGROK_DOMAIN%/health
echo     -> {"moderation":true,"smart_replies":true}
echo.
echo   Render env vars to set:
echo     MODERATION_URL     = https://%NGROK_DOMAIN%
echo     MODERATION_ENABLED = true
echo     MODERATION_API_KEY = %MODERATION_API_KEY%
echo.
echo   To STOP: close both windows.
echo   Chat keeps working normally without the ML service.
echo  ===================================================
echo.
pause
