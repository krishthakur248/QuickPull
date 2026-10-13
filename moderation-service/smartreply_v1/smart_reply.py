"""
smart_reply.py  –  Suggests contextual replies from a fixed bank.

Uses sentence-transformers/all-MiniLM-L6-v2 to embed an incoming message,
then returns the top-k replies from reply_bank.csv whose cosine similarity
exceeds the configured threshold.

The bank embeddings are pre-computed and cached in bank_embeddings.npy so
startup is fast (no recompute on every request).

Thread safety: SmartReplier.suggest() is protected by a threading.Lock
around the encode step, as required by the service design.
"""

import csv
import json
import logging
import os
import threading
import time
from pathlib import Path

import numpy as np

log = logging.getLogger("smart-reply")

_BASE = Path(__file__).parent


def _cosine_sim(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    """Return cosine similarity between vector a and each row of matrix b."""
    a_norm = a / (np.linalg.norm(a) + 1e-9)
    b_norms = np.linalg.norm(b, axis=1, keepdims=True) + 1e-9
    return (b / b_norms) @ a_norm


class SmartReplier:
    """
    Loads the model and reply bank once; exposes suggest(message, recipient_role).

    Parameters
    ----------
    model_dir : str | Path
        Path to the offline sentence-transformers model directory.
        If None, falls back to the ``model/`` sub-directory next to this file.
    config_path : str | Path
        Path to replies_config.json.  Defaults to the file next to this script.
    bank_path : str | Path
        Path to reply_bank.csv.
    embeddings_path : str | Path
        Path to pre-computed bank_embeddings.npy.  If the file does not exist
        it is computed from the bank and saved there.
    """

    def __init__(
        self,
        model_dir=None,
        config_path=None,
        bank_path=None,
        embeddings_path=None,
    ):
        # -- Load config -------------------------------------------------------
        cfg_path = Path(config_path or _BASE / "replies_config.json")
        with open(cfg_path, encoding="utf-8") as f:
            cfg = json.load(f)
        self._threshold: float = float(cfg.get("threshold", 0.30))
        self._k: int = int(cfg.get("k", 3))
        log.info(f"[SmartReply] threshold={self._threshold}  k={self._k}")

        # -- Load reply bank ---------------------------------------------------
        bank_file = Path(bank_path or _BASE / "reply_bank.csv")
        self._replies: list = []
        with open(bank_file, newline="", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            for row in reader:
                self._replies.append(
                    {
                        "id": str(row.get("id", row.get("ID", len(self._replies)))),
                        "text": str(row.get("text", row.get("Text", ""))).strip(),
                        "role": str(row.get("role", row.get("Role", "any"))).strip().lower(),
                    }
                )
        log.info(f"[SmartReply] Loaded {len(self._replies)} replies from bank")

        # -- Load model --------------------------------------------------------
        mdir = Path(model_dir or _BASE / "model")
        t0 = time.time()
        from sentence_transformers import SentenceTransformer  # type: ignore

        self._model = SentenceTransformer(str(mdir))
        log.info(f"[SmartReply] Model loaded in {time.time()-t0:.1f}s from {mdir}")

        # -- Load / compute bank embeddings ------------------------------------
        emb_path = Path(embeddings_path or _BASE / "bank_embeddings.npy")
        texts = [r["text"] for r in self._replies]
        if emb_path.exists():
            self._bank_emb = np.load(str(emb_path)).astype(np.float32)
            if self._bank_emb.shape[0] != len(self._replies):
                log.warning(
                    "[SmartReply] bank_embeddings.npy row count mismatch – recomputing"
                )
                self._bank_emb = self._compute_and_save(texts, emb_path)
        else:
            log.info("[SmartReply] bank_embeddings.npy not found – computing...")
            self._bank_emb = self._compute_and_save(texts, emb_path)

        # -- Inference lock (kept only around encode()) -----------------------
        self._lock = threading.Lock()
        log.info("[SmartReply] Ready")

    # -- Internal helpers ------------------------------------------------------

    def _compute_and_save(self, texts, path):
        emb = self._model.encode(texts, convert_to_numpy=True, show_progress_bar=False)
        emb = emb.astype(np.float32)
        np.save(str(path), emb)
        log.info(f"[SmartReply] Saved {emb.shape[0]} embeddings -> {path}")
        return emb

    # -- Public API ------------------------------------------------------------

    def suggest(self, message: str, recipient_role: str) -> list:
        """
        Return up to self._k reply suggestions whose cosine similarity
        to *message* exceeds self._threshold.

        Parameters
        ----------
        message        : incoming chat text
        recipient_role : "driver" or "rider" - the person who will send the reply

        Returns
        -------
        list of {"id": str, "text": str}, at most k items
        """
        if not message or not message.strip():
            return []

        # Encode with lock so the encode step is not run concurrently
        with self._lock:
            q_emb = self._model.encode(
                [message], convert_to_numpy=True, show_progress_bar=False
            )[0].astype(np.float32)

        # Filter bank by role (replies tagged "any" are always included)
        role = (recipient_role or "").strip().lower()
        mask = [r["role"] in (role, "any") for r in self._replies]
        if not any(mask):
            return []

        bank_sub = self._bank_emb[mask]
        replies_sub = [r for r, m in zip(self._replies, mask) if m]

        sims = _cosine_sim(q_emb, bank_sub)

        # Get indices of top-k above threshold, sorted descending
        order = sims.argsort()[::-1]
        results = []
        for idx in order:
            if float(sims[idx]) < self._threshold:
                break
            results.append({"id": replies_sub[idx]["id"], "text": replies_sub[idx]["text"]})
            if len(results) >= self._k:
                break

        return results

    def warm_up(self):
        """Run one inference to JIT-compile and load weights into cache."""
        self.suggest("hello, are you there?", "driver")
        log.info("[SmartReply] Warm-up done")
