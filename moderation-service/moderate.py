"""
moderate.py  –  exactly copied from your QuickPull_moderation_deploy folder.
Load the DistilBERT classifier once and expose a moderate(text) function.
"""

import json
import os
import torch
from transformers import AutoTokenizer, AutoModelForSequenceClassification


def load_moderator(folder: str):
    """
    Load the model and tokenizer from `folder`.
    Returns a callable: moderate(text) -> {"flagged": bool, "score": float, "threshold": float}
    """
    # Read the config so we can pick up threshold and max_length without hardcoding them
    cfg = json.load(open(os.path.join(folder, "moderation_config.json")))
    mdir = os.path.join(folder, "model")

    tok = AutoTokenizer.from_pretrained(mdir)
    model = (
        AutoModelForSequenceClassification.from_pretrained(mdir)
        .to("cpu")
        .eval()
    )

    thr = cfg["threshold"]        # 0.5
    max_len = cfg["max_length"]   # 128

    def moderate(text: str) -> dict:
        # Empty / non-string input is never toxic
        if not isinstance(text, str) or not text.strip():
            return {"flagged": False, "score": 0.0, "threshold": thr}

        # Collapse whitespace and cap at 2000 chars (service-level limit)
        text = " ".join(text.split())[:2000]

        enc = tok(text, truncation=True, max_length=max_len, return_tensors="pt")
        with torch.no_grad():
            p = torch.softmax(model(**enc).logits, dim=-1)[0, 1].item()

        return {"flagged": bool(p >= thr), "score": round(p, 4), "threshold": thr}

    return moderate
