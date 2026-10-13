@echo off
setlocal enabledelayedexpansion
:: ============================================================
:: run_demo_moderation.bat
:: Double-click to start the full QuickPull ML service (moderation +
:: smart replies) and open an ngrok tunnel to it.
::
:: HOW TO CREATE A VIRTUAL ENVIRONMENT (one-time setup):
::   cd /d "C:\Users\Asus\Desktop\QuickPull"
::   python -m venv .venv
::   .venv\Scripts\activate
::   pip install -r moderation-service\requirements.txt
::
:: USAGE:
::   1. Fill in moderation-service\.env (copy from .env.example).
::   2. Double-click this file.
::   3. Two windows open: the FastAPI server and the ngrok tunnel.
::   4. Copy the MODERATION_URL printed here into your Render dashboard.
::   5. To stop everything, close both windows.
:: ============================================================

echo.
echo  ====================================================================
echo    QuickPull  ^|  ML Service Demo Launcher  (moderation + smart-replies)
echo  ====================================================================
echo.

:: ── Locate this script's directory ──────────────────────────────────────────
set "SCRIPT_DIR=%~dp0"
set "SERVICE_DIR=%SCRIPT_DIR%moderation-service"

:: ── Load .env (moderation-service\.env) ─────────────────────────────────────
set "ENV_FILE=%SERVICE_DIR%\.env"
if exist "%ENV_FILE%" (
    for /f "usebackq tokens=1,* delims==" %%A in ("%ENV_FILE%") do (
        set "line=%%A"
        if not "!line:~0,1!" == "#" (
            if not "%%A" == "" (
                set "%%A=%%B"
            )
        )
    )
    echo [env]  Loaded settings from %ENV_FILE%
) else (
    echo [WARN] %ENV_FILE% not found. Copy .env.example to that path and fill in values.
    echo        Continuing with current environment variables.
)

:: Strip leading/trailing spaces that Windows batch can leave on values
if defined MODERATION_API_KEY set "MODERATION_API_KEY=%MODERATION_API_KEY: =%"
if defined NGROK_DOMAIN      set "NGROK_DOMAIN=%NGROK_DOMAIN: =%"
if defined NGROK_PATH        set "NGROK_PATH=%NGROK_PATH: =%"

:: ── Default ngrok location ───────────────────────────────────────────────────
if not defined NGROK_PATH (
    where ngrok >nul 2>&1
    if !errorlevel! == 0 (
        set "NGROK_PATH=ngrok"
    ) else (
        set "NGROK_PATH=C:\ngrok\ngrok.exe"
    )
)

:: ── Check Python ─────────────────────────────────────────────────────────────
echo [1/4] Checking prerequisites...
python --version >nul 2>&1
if errorlevel 1 (
    echo.
    echo  [ERROR] Python is not installed or not on PATH.
    echo  Download it from https://www.python.org/downloads/
    echo.
    pause & exit /b 1
)
for /f "tokens=*" %%v in ('python --version 2^>^&1') do echo        Python: %%v

:: ── Check ngrok ──────────────────────────────────────────────────────────────
if exist "%NGROK_PATH%" (
    echo        ngrok: found at %NGROK_PATH%
) else (
    "%NGROK_PATH%" version >nul 2>&1
    if errorlevel 1 (
        echo.
        echo  [ERROR] ngrok not found at "%NGROK_PATH%".
        echo  Download from https://ngrok.com/download and either:
        echo    a) Put ngrok.exe in C:\ngrok\ , or
        echo    b) Set NGROK_PATH=C:\path\to\ngrok.exe in moderation-service\.env
        echo.
        pause & exit /b 1
    )
    echo        ngrok: found on PATH
)

:: ── Activate venv if it exists ────────────────────────────────────────────────
echo.
echo [2/4] Checking virtual environment...
set "VENV_ACTIVATE=%SCRIPT_DIR%.venv\Scripts\activate.bat"
if exist "%VENV_ACTIVATE%" (
    echo        Found .venv at %SCRIPT_DIR%.venv — will activate inside service window.
    set "ACTIVATE_CMD=call \"%VENV_ACTIVATE%\" ^&^& "
) else (
    echo        No .venv found — using system Python. Install deps if needed:
    echo        pip install -r moderation-service\requirements.txt
    set "ACTIVATE_CMD="
)

:: ── Start FastAPI server ──────────────────────────────────────────────────────
echo.
echo [3/4] Starting FastAPI ML service (moderation + smart-replies) on port 8000...
echo        (Model loading takes 20-60 seconds — wait for the health check.)

start "QuickPull ML Service" cmd /k "cd /d "%SERVICE_DIR%" && %ACTIVATE_CMD%set MODERATION_API_KEY=%MODERATION_API_KEY% && python -m uvicorn main:app --host 0.0.0.0 --port 8000 --workers 1"

:: ── Wait for /health to respond (max 90 s, 3-s intervals) ────────────────────
echo        Waiting for http://localhost:8000/health to respond (max 90s)...
set /a TRIES=0
:HEALTH_LOOP
timeout /t 3 /nobreak >nul
set /a TRIES+=1
curl -s --max-time 2 "http://localhost:8000/health" >nul 2>&1
if !errorlevel! == 0 (
    echo        ^[OK^] Service is ready!
    goto HEALTH_OK
)
if !TRIES! GEQ 30 (
    echo.
    echo  [WARN] Service did not respond after 90s. Check the service window for errors.
    echo         Continuing anyway — ngrok will start, but /health may not be green yet.
    goto HEALTH_OK
)
set /p _dummy="        Still loading... (%TRIES%/30, %TRIES:~0,1%0s elapsed)"<nul
echo.
goto HEALTH_LOOP

:HEALTH_OK

:: ── Start ngrok ───────────────────────────────────────────────────────────────
echo.
echo [4/4] Starting ngrok tunnel for localhost:8000...
if defined NGROK_DOMAIN (
    set "NGROK_CMD=%NGROK_PATH% http --domain=%NGROK_DOMAIN% 8000"
    set "PUBLIC_URL=https://%NGROK_DOMAIN%"
) else (
    set "NGROK_CMD=%NGROK_PATH% http 8000"
    set "PUBLIC_URL=https://<random>.ngrok-free.app  (check the ngrok window)"
)

start "ngrok Tunnel" cmd /k "%NGROK_CMD%"

:: ── Print instructions ────────────────────────────────────────────────────────
echo.
echo  ====================================================================
echo.
echo   ML service:  http://localhost:8000
echo   Tunnel URL:  %PUBLIC_URL%
echo.
echo   SET THIS on Render  (Environment tab):
echo     MODERATION_URL  =  %PUBLIC_URL%
echo     MODERATION_ENABLED = true
echo.
echo   Test endpoints:
echo     curl http://localhost:8000/health
echo     curl -X POST http://localhost:8000/smart-replies \
echo          -H "X-API-Key: %MODERATION_API_KEY%" \
echo          -H "Content-Type: application/json" \
echo          -d "{\"message\":\"where are you?\",\"recipient_role\":\"driver\",\"flagged\":false}"
echo.
echo   To STOP everything: close the "QuickPull ML Service" and "ngrok Tunnel" windows.
echo   Chat will keep working normally without the ML service (fail-open).
echo.
echo  ====================================================================
echo.
pause
