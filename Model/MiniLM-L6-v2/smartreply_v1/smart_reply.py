"""Smart replies for QuickPull. Usage:
    from smart_reply import SmartReplier
    sr = SmartReplier("path/to/smartreply_v1")
    sr.suggest("where are you?", recipient_role="driver", flagged=False)
recipient_role = the person who RECEIVES the message and will send the reply.
"""
import os, csv, json
import numpy as np
from sentence_transformers import SentenceTransformer


class SmartReplier:
    def __init__(self, folder):
        self.cfg = json.load(open(os.path.join(folder, "replies_config.json")))
        with open(os.path.join(folder, "reply_bank.csv"), newline="", encoding="utf-8") as f:
            self.bank = list(csv.DictReader(f))
        self.emb = np.load(os.path.join(folder, "bank_embeddings.npy"))
        self.model = SentenceTransformer(os.path.join(folder, "model"), device="cpu")
        self.rows = {r: [i for i, b in enumerate(self.bank) if b["role"] == r]
                     for r in ("driver", "rider")}

    def suggest(self, message, recipient_role, flagged=False, k=None, threshold=None):
        k = k or self.cfg["k"]
        threshold = self.cfg["threshold"] if threshold is None else threshold
        if flagged or not isinstance(message, str) or recipient_role not in self.rows:
            return []
        message = message.strip()[: self.cfg["max_chars"]]
        if not message:
            return []
        idx = self.rows[recipient_role]
        q = self.model.encode([message], normalize_embeddings=True,
                              convert_to_numpy=True, show_progress_bar=False)[0]
        scores = self.emb[idx] @ q
        best = {}  # best reply per intent
        for i, s in zip(idx, scores):
            intent = self.bank[i]["intent"]
            if intent not in best or s > best[intent][0]:
                best[intent] = (float(s), i)
        ranked = sorted(best.values(), key=lambda x: x[0], reverse=True)
        if not ranked or ranked[0][0] < threshold:
            return []
        return [{"id": self.bank[i]["id"], "intent": self.bank[i]["intent"],
                 "text": self.bank[i]["text"], "score": round(s, 3)}
                for s, i in ranked[:k] if s >= threshold]


if __name__ == "__main__":
    sr = SmartReplier(os.path.dirname(os.path.abspath(__file__)))
    print(sr.suggest("where are you?", "driver"))
