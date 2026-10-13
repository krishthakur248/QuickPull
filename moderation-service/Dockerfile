# ──────────────────────────────────────────────────────────────────────────────
# Dockerfile for the QuickPull Moderation Service
# ──────────────────────────────────────────────────────────────────────────────
#
# This builds a CPU-only image (no CUDA) to keep size manageable (~1.5 GB).
# The model weights (~268 MB) are downloaded at container START from a private
# Hugging Face repo using the HF_TOKEN env var (see README for details).
#
# Minimum Render instance: Standard (2 GB RAM) or higher.
# The 512 MB "Starter" instance is NOT enough – DistilBERT needs ~600 MB RAM
# just to load, plus Python overhead.
# ──────────────────────────────────────────────────────────────────────────────

FROM python:3.11-slim

# Prevents Python from writing .pyc files and buffering stdout/stderr
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

# Install OS packages needed by torch / transformers
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Create a non-root user for security
RUN useradd --create-home appuser
WORKDIR /app

# ── Install Python deps ────────────────────────────────────────────────────────
# We install CPU-only torch from PyTorch's own index (much smaller than the
# default index which serves the CUDA wheel).
COPY requirements.txt .
RUN pip install --upgrade pip && \
    pip install --no-cache-dir \
        torch==2.6.0+cpu \
        --index-url https://download.pytorch.org/whl/cpu && \
    pip install --no-cache-dir -r requirements.txt

# ── Copy application code ──────────────────────────────────────────────────────
COPY main.py moderate.py hindi_keywords.json ./

# Also copy the startup script that downloads model weights from HuggingFace
COPY download_model.py ./

# Switch to non-root user
USER appuser

# ── Expose port ────────────────────────────────────────────────────────────────
EXPOSE 8000

# ── Start command ──────────────────────────────────────────────────────────────
# 1) download_model.py checks if model_files/ already exists; if not, downloads
#    from HuggingFace using HF_TOKEN.  This is the only place secrets are used.
# 2) Then uvicorn starts the FastAPI app.
CMD python download_model.py && uvicorn main:app --host 0.0.0.0 --port 8000
