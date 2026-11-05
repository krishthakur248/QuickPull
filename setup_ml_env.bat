@echo off
:: ============================================================
:: setup_ml_env.bat
:: One-time setup for the QuickPull ML service.
:: Run this ONCE on any new PC before using start_moderation.bat
:: ============================================================

echo.
echo  ====================================================
echo    QuickPull ML Service - One-Time Setup
echo  ====================================================
echo.

cd /d "%~dp0"

:: Check Python
python --version >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Python not found. Download from https://python.org/downloads
    echo         Make sure to tick "Add Python to PATH" during install.
    pause & exit /b 1
)
for /f "tokens=*" %%v in ('python --version') do echo [OK] %%v found

:: Create virtual environment
echo.
echo [1/3] Creating virtual environment (.venv)...
if exist ".venv\Scripts\activate.bat" (
    echo        .venv already exists, skipping creation.
) else (
    python -m venv .venv
    echo        .venv created successfully.
)

:: Activate and install torch first (from PyTorch index), then rest
echo.
echo [2/3] Installing PyTorch CPU wheel...
echo        This downloads ~220 MB, please wait...
call ".venv\Scripts\activate.bat"
pip install torch==2.6.0+cpu --index-url https://download.pytorch.org/whl/cpu

echo.
echo [3/3] Installing remaining packages (fastapi, uvicorn, transformers, etc.)...
pip install transformers==4.51.3 scikit-learn==1.6.1 numpy==2.1.3 pandas==2.2.3 fastapi==0.115.12 "uvicorn[standard]==0.34.3" pydantic==2.11.4 "sentence-transformers>=2.7.0" python-multipart==0.0.20

echo.
echo  ====================================================
echo.
echo   Setup complete!
echo.
echo   BEFORE RUNNING start_moderation.bat, make sure you have:
echo     1. Model weights at:
echo        Model\DistilBERT\model\model.safetensors  (267 MB)
echo        moderation-service\smartreply_v1\model\   (MiniLM model folder)
echo        moderation-service\smartreply_v1\bank_embeddings.npy
echo.
echo     2. ngrok.exe at C:\ngrok\ngrok.exe
echo        (or update the path in start_moderation.bat line 20)
echo.
echo   Then double-click start_moderation.bat to start the service.
echo  ====================================================
echo.
pause

