"""
main.py  –  FastAPI moderation service for QuickPull chat.

Two checks run on every message:
  1. DistilBERT ML model  (English toxic-comment classifier)
  2. Hindi-in-English-letters keyword list  (simple word-boundary match)

Either check can set flagged=True.
The model is loaded ONCE at startup so requests are fast.

Endpoints:
  POST /moderate   – run both checks (needs X-API-Key header)
  GET  /health     – returns "ok" only after model is fully loaded
"""

import json
import os
import re
import time
import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, Header, Depends
from pydantic import BaseModel

# We import our own moderate.py which is in the same folder
from moderate import load_moderator

# ── Logging ──────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
log = logging.getLogger("moderation-service")

# ── Config ────────────────────────────────────────────────────────────────────
# The model lives in a sub-folder called "model_files" which we populate at
# startup from Hugging Face (see README for the HF_REPO env var approach).
BASE_DIR = Path(__file__).parent            # same folder as this file
MODEL_DIR = BASE_DIR / "model_files"        # where model/ and moderation_config.json live

# Hard limit: reject text longer than this before even touching the model
MAX_TEXT_CHARS = 2000

# API key from environment – never stored in code
EXPECTED_API_KEY: str = os.environ.get("MODERATION_API_KEY", "")

# ── Shared state (loaded once at startup) ─────────────────────────────────────
state: dict = {
    "moderate": None,          # the callable returned by load_moderator()
    "keywords": [],            # list of Hindi keyword phrases
    "ready": False,            # /health returns ok only when this is True
}

# ── Lifespan: load everything before the server accepts requests ───────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    FastAPI lifespan context.  Runs startup code before yielding,
    then teardown code (if any) after the yield.
    """
    log.info("=== Moderation service starting up ===")
    t0 = time.time()

    # 1) Load keyword list
    kw_path = BASE_DIR / "hindi_keywords.json"
    if kw_path.exists():
        with open(kw_path, encoding="utf-8") as f:
            state["keywords"] = json.load(f)
        log.info(f"Loaded {len(state['keywords'])} Hindi keywords from {kw_path}")
    else:
        log.warning(f"hindi_keywords.json not found at {kw_path}; keyword check disabled")

    # 2) Load the ML model  (this takes several seconds the first time)
    log.info(f"Loading DistilBERT model from {MODEL_DIR} …")
    state["moderate"] = load_moderator(str(MODEL_DIR))
    elapsed = time.time() - t0
    log.info(f"Model loaded in {elapsed:.1f}s – service is ready")

    state["ready"] = True

    yield  # --- server is running here ---

    log.info("=== Moderation service shutting down ===")


# ── FastAPI app ────────────────────────────────────────────────────────────────
app = FastAPI(
    title="QuickPull Moderation Service",
    description="Checks chat messages for toxic content using DistilBERT + Hindi keyword list",
    version="1.0.0",
    lifespan=lifespan,
)


# ── Request / Response schemas ────────────────────────────────────────────────
class ModerateRequest(BaseModel):
    text: str


class ModerateResponse(BaseModel):
    flagged: bool
    score: float
    threshold: float
    reasons: list[str]   # e.g. ["model_score", "keyword_match"]


# ── API key dependency ────────────────────────────────────────────────────────
def check_api_key(x_api_key: str = Header(..., alias="X-API-Key")):
    """
    Reads the X-API-Key header and compares it to MODERATION_API_KEY env var.
    Raises 403 if wrong or missing.
    """
    if not EXPECTED_API_KEY:
        # If the env var is not set, warn loudly but allow (dev-only fallback)
        log.warning("MODERATION_API_KEY env var is not set – endpoint is unprotected!")
        return
    if x_api_key != EXPECTED_API_KEY:
        raise HTTPException(status_code=403, detail="Invalid or missing API key")


# ── Keyword matching helper ───────────────────────────────────────────────────
def keyword_flagged(text: str) -> bool:
    """
    Returns True if any phrase from hindi_keywords.json appears in `text`
    as a whole word (case-insensitive, word-boundary match).
    Multi-word phrases like "maar dunga" are matched as a unit.
    """
    lower = text.lower()
    for phrase in state["keywords"]:
        # \b works for ASCII word boundaries; for space-separated phrases
        # we anchor the whole phrase between word boundaries.
        pattern = r"\b" + re.escape(phrase.lower()) + r"\b"
        if re.search(pattern, lower):
            return True
    return False


# ── Routes ────────────────────────────────────────────────────────────────────
@app.get("/health")
def health():
    """
    Returns {"status": "ok"} only after the model has loaded.
    Render uses this as the readiness probe.
    """
    if not state["ready"]:
        raise HTTPException(status_code=503, detail="Model is still loading")
    return {"status": "ok"}


@app.post("/moderate", response_model=ModerateResponse, dependencies=[Depends(check_api_key)])
def moderate(req: ModerateRequest):
    """
    Runs two checks on the provided text:
      1. ML model score (DistilBERT)
      2. Hindi keyword list (word-boundary match)

    Returns flagged=True if either check triggers.
    Empty text is never flagged.
    Text over 2000 chars is rejected with HTTP 400.
    """
    text = req.text

    # --- Input validation ------------------------------------------------
    # Reject text that is too long (above our service limit)
    if len(text) > MAX_TEXT_CHARS:
        raise HTTPException(
            status_code=400,
            detail=f"Text exceeds maximum length of {MAX_TEXT_CHARS} characters",
        )

    # Empty text: safe, return immediately
    if not text or not text.strip():
        return ModerateResponse(flagged=False, score=0.0, threshold=0.5, reasons=[])

    # --- Model not ready -------------------------------------------------
    if not state["ready"]:
        raise HTTPException(status_code=503, detail="Model is not ready yet")

    reasons: list[str] = []

    # --- Check 1: ML model -----------------------------------------------
    result = state["moderate"](text)   # {"flagged": bool, "score": float, "threshold": float}
    model_flagged = result["flagged"]
    score = result["score"]
    threshold = result["threshold"]

    if model_flagged:
        reasons.append("model_score")

    # --- Check 2: Hindi keyword list ------------------------------------
    if keyword_flagged(text):
        reasons.append("keyword_match")

    flagged = model_flagged or ("keyword_match" in reasons)

    log.info(
        f"moderate() text_len={len(text)} score={score} "
        f"flagged={flagged} reasons={reasons}"
    )

    return ModerateResponse(
        flagged=flagged,
        score=score,
        threshold=threshold,
        reasons=reasons,
    )
