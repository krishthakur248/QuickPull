"""
main.py  -  FastAPI moderation + smart-reply service for QuickPull chat.

Models
------
1. DistilBERT  (POST /moderate)   - English toxic-comment classifier
2. all-MiniLM-L6-v2 (POST /smart-replies) - cosine-similarity reply suggester

Key design points
-----------------
* Both models are loaded ONCE at startup in separate try/except blocks so a
  failure in one never prevents the other from loading.
* All endpoints are plain `def` (sync) - FastAPI runs them in a thread pool
  automatically, so a slow inference cannot freeze /health.
* The SmartReplier.suggest() call is protected by a threading.Lock inside the
  class itself; moderation inference uses its own internal state.
* torch.set_num_threads() is called once at startup with the value from env
  ML_TORCH_THREADS (default: half the logical CPU count, at least 1).
  NOTE: this affects ALL torch operations in the process, including the
  DistilBERT tokenizer/model. In practice it helps both models share CPU
  resources fairly. If you need to isolate the moderation model's threading
  entirely, move torch.set_num_threads() into moderate.py before inference.
* API key check (X-API-Key header) applies to BOTH /moderate and
  /smart-replies. If MODERATION_API_KEY is unset, both endpoints warn and
  remain open (dev-only fallback, backward-compatible).

Environment variables
---------------------
  MODERATION_API_KEY  - shared secret for X-API-Key header
  ML_TORCH_THREADS    - int, number of torch inter-op threads (default: auto)
  SR_DISABLE          - set to "1" to force smart-reply load to fail (test flag)

Endpoints
---------
  GET  /health         - {"moderation": bool, "smart_replies": bool}
  POST /moderate       - existing endpoint, unchanged
  POST /smart-replies  - new: {"message": str, "recipient_role": str, "flagged": bool}
"""

import json
import logging
import os
import re
import sys
import time
import multiprocessing
from contextlib import asynccontextmanager
from pathlib import Path

import torch
from fastapi import FastAPI, HTTPException, Header, Depends
from pydantic import BaseModel

from moderate import load_moderator

# -- Logging -------------------------------------------------------------------
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
log = logging.getLogger("moderation-service")

# -- torch thread count --------------------------------------------------------
_raw_threads = os.environ.get("ML_TORCH_THREADS", "").strip()
if _raw_threads.isdigit() and int(_raw_threads) > 0:
    _torch_threads = int(_raw_threads)
else:
    _torch_threads = max(1, multiprocessing.cpu_count() // 2)
torch.set_num_threads(_torch_threads)
log.info(f"torch.set_num_threads({_torch_threads})  (ML_TORCH_THREADS={_raw_threads or 'auto'})")

# -- Config --------------------------------------------------------------------
BASE_DIR = Path(__file__).parent

# DistilBERT model location (same logic as before)
if (BASE_DIR / "model_files" / "model").exists():
    MODEL_DIR = BASE_DIR / "model_files"
elif (BASE_DIR.parent / "Model" / "DistilBERT" / "model").exists():
    MODEL_DIR = BASE_DIR.parent / "Model" / "DistilBERT"
else:
    MODEL_DIR = BASE_DIR / "model_files"

MAX_TEXT_CHARS = 2000
MAX_SR_CHARS   = 500

EXPECTED_API_KEY: str = os.environ.get("MODERATION_API_KEY", "").strip()

# -- Shared state (loaded once at startup) -------------------------------------
state = {
    "moderate":      None,   # callable returned by load_moderator()
    "keywords":      [],     # Hindi keyword list
    "mod_ready":     False,  # moderation model ok
    "sr_replier":    None,   # SmartReplier instance
    "sr_ready":      False,  # smart-replies model ok
}

# -- Lifespan: load everything before the server accepts requests --------------
@asynccontextmanager
async def lifespan(app: FastAPI):
    log.info("=== QuickPull ML service starting up ===")

    # 1) Hindi keywords
    kw_path = BASE_DIR / "hindi_keywords.json"
    if kw_path.exists():
        with open(kw_path, encoding="utf-8") as f:
            state["keywords"] = json.load(f)
        log.info(f"Loaded {len(state['keywords'])} Hindi keywords")
    else:
        log.warning(f"hindi_keywords.json not found at {kw_path}; keyword check disabled")

    # 2) Moderation model (DistilBERT) - isolated try/except
    try:
        log.info(f"Loading DistilBERT from {MODEL_DIR} ...")
        t0 = time.time()
        state["moderate"] = load_moderator(str(MODEL_DIR))
        # warm up
        state["moderate"]("hello")
        elapsed = time.time() - t0
        state["mod_ready"] = True
        log.info(f"DistilBERT ready in {elapsed:.1f}s")
    except Exception as exc:
        log.error(f"Moderation model FAILED to load: {exc}  -- /moderate will return 503")

    # 3) Smart-reply model (all-MiniLM-L6-v2) - isolated try/except
    sr_disabled = os.environ.get("SR_DISABLE", "").strip() == "1"
    if sr_disabled:
        log.warning("SR_DISABLE=1 -- smart-reply model intentionally skipped (test mode)")
    else:
        try:
            log.info("Loading SmartReplier (sentence-transformers/all-MiniLM-L6-v2) ...")
            t0 = time.time()
            # Import here so import errors do not crash the process
            from smartreply_v1.smart_reply import SmartReplier
            state["sr_replier"] = SmartReplier()
            state["sr_replier"].warm_up()
            elapsed = time.time() - t0
            state["sr_ready"] = True
            log.info(f"SmartReplier ready in {elapsed:.1f}s")
        except Exception as exc:
            log.error(
                f"SmartReplier FAILED to load: {exc}  -- /smart-replies will return empty list"
            )

    log.info(
        f"=== Service ready  moderation={state['mod_ready']}  "
        f"smart_replies={state['sr_ready']} ==="
    )
    yield
    log.info("=== ML service shutting down ===")


# -- FastAPI app ---------------------------------------------------------------
app = FastAPI(
    title="QuickPull ML Service",
    description="Chat moderation (DistilBERT) + smart replies (MiniLM) for QuickPull",
    version="2.0.0",
    lifespan=lifespan,
)


# -- Schemas -------------------------------------------------------------------
class ModerateRequest(BaseModel):
    text: str


class ModerateResponse(BaseModel):
    flagged: bool
    score: float
    threshold: float
    reasons: list


class SmartReplyRequest(BaseModel):
    message: str
    recipient_role: str   # "driver" | "rider"
    flagged: bool = False


class SmartReplyResponse(BaseModel):
    suggestions: list     # [{"id": str, "text": str}, ...]


# -- API key dependency --------------------------------------------------------
def check_api_key(x_api_key: str = Header(..., alias="X-API-Key")):
    if not EXPECTED_API_KEY:
        log.warning("MODERATION_API_KEY env var is not set - endpoint is unprotected!")
        return
    if (x_api_key or "").strip() != EXPECTED_API_KEY:
        raise HTTPException(status_code=403, detail="Invalid or missing API key")


# -- Keyword matching helper ---------------------------------------------------
def keyword_flagged(text: str) -> bool:
    lower = text.lower()
    for phrase in state["keywords"]:
        pattern = r"\b" + re.escape(phrase.lower()) + r"\b"
        if re.search(pattern, lower):
            return True
    return False


# -- Routes --------------------------------------------------------------------

@app.get("/health")
def health():
    """
    Returns {"moderation": bool, "smart_replies": bool}.
    Always returns HTTP 200 so the caller can inspect per-model availability.
    """
    return {
        "moderation":    state["mod_ready"],
        "smart_replies": state["sr_ready"],
    }


@app.post("/moderate", response_model=ModerateResponse, dependencies=[Depends(check_api_key)])
def moderate(req: ModerateRequest):
    """
    Runs DistilBERT + Hindi keyword check on the provided text.
    Returns flagged=True if either check triggers.
    Response format is UNCHANGED from v1.0.
    """
    text = req.text

    if len(text) > MAX_TEXT_CHARS:
        raise HTTPException(
            status_code=400,
            detail=f"Text exceeds maximum length of {MAX_TEXT_CHARS} characters",
        )

    if not text or not text.strip():
        return ModerateResponse(flagged=False, score=0.0, threshold=0.5, reasons=[])

    if not state["mod_ready"]:
        raise HTTPException(status_code=503, detail="Moderation model is not ready")

    reasons = []

    result = state["moderate"](text)
    model_flagged = result["flagged"]
    score = result["score"]
    threshold = result["threshold"]

    if model_flagged:
        reasons.append("model_score")

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


@app.post("/smart-replies", response_model=SmartReplyResponse, dependencies=[Depends(check_api_key)])
def smart_replies(req: SmartReplyRequest):
    """
    Returns up to 3 contextual reply suggestions for the given message.

    * If flagged=True, returns an empty list (caller should not show suggestions).
    * If the model is not ready, returns an empty list (never an error).
    * If message is empty or > 500 chars, returns an empty list.
    * If recipient_role is not "driver" or "rider", returns an empty list.
    """
    # Guard: flagged messages never get suggestions
    if req.flagged:
        return SmartReplyResponse(suggestions=[])

    # Guard: invalid or empty text
    msg = (req.message or "").strip()
    if not msg or len(msg) > MAX_SR_CHARS:
        return SmartReplyResponse(suggestions=[])

    # Guard: role validation
    role = (req.recipient_role or "").strip().lower()
    if role not in ("driver", "rider"):
        log.warning(f"[SmartReply] Invalid recipient_role={req.recipient_role!r} -- returning empty")
        return SmartReplyResponse(suggestions=[])

    # Guard: model not ready (fail-open)
    if not state["sr_ready"] or state["sr_replier"] is None:
        return SmartReplyResponse(suggestions=[])

    try:
        suggestions = state["sr_replier"].suggest(msg, role)
        log.info(f"[SmartReply] msg_len={len(msg)} role={role} hits={len(suggestions)}")
        return SmartReplyResponse(suggestions=suggestions)
    except Exception as exc:
        log.error(f"[SmartReply] Inference error: {exc}")
        return SmartReplyResponse(suggestions=[])
