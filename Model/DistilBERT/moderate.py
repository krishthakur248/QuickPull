import json, os, torch
from transformers import AutoTokenizer, AutoModelForSequenceClassification

def load_moderator(folder):
    cfg = json.load(open(os.path.join(folder, "moderation_config.json")))
    mdir = os.path.join(folder, "model")
    tok = AutoTokenizer.from_pretrained(mdir)
    model = AutoModelForSequenceClassification.from_pretrained(mdir).to("cpu").eval()
    thr, max_len = cfg["threshold"], cfg["max_length"]
    def moderate(text):
        # empty or non-text input is never flagged
        if not isinstance(text, str) or not text.strip():
            return {"flagged": False, "score": 0.0, "threshold": thr}
        text = " ".join(text.split())[:2000]   # clean spaces, cut very long text
        enc = tok(text, truncation=True, max_length=max_len, return_tensors="pt")
        with torch.no_grad():
            p = torch.softmax(model(**enc).logits, dim=-1)[0, 1].item()
        return {"flagged": bool(p >= thr), "score": round(p, 4), "threshold": thr}
    return moderate
