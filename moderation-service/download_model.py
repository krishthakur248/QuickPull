"""
download_model.py  –  Download DistilBERT weights from a private Hugging Face
                       repo at container startup.

WHY THIS APPROACH?
  The model weights file (model.safetensors) is ~268 MB.
  Committing it to a normal git repo would make the repo massive.
  Instead:
    - You upload the model folder to a PRIVATE Hugging Face model repo.
    - At startup, this script pulls it down using your HF_TOKEN.
    - On Render, the container's /app/model_files folder is the download target.
    - Subsequent restarts re-download (fast because Render keeps the container
      alive between requests on paid plans). If you want to avoid re-downloading,
      use a Render "Disk" (persistent disk) mounted at /app/model_files.

ENV VARS NEEDED:
  HF_REPO   – e.g. "your-hf-username/quickpull-moderation"
  HF_TOKEN  – your Hugging Face read token (keep it secret!)

If model_files/ already exists and has the model, we skip the download.
"""

import os
import sys
import logging
from pathlib import Path

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger("download_model")

MODEL_DIR = Path("/app/model_files")
SENTINEL = MODEL_DIR / "model" / "model.safetensors"   # if this file exists, skip download

HF_REPO = os.environ.get("HF_REPO", "")
HF_TOKEN = os.environ.get("HF_TOKEN", "")


def main():
    if SENTINEL.exists():
        log.info(f"Model already present at {MODEL_DIR}, skipping download.")
        return

    if not HF_REPO or not HF_TOKEN:
        log.error(
            "HF_REPO and HF_TOKEN env vars are required to download the model. "
            "Please set them in Render's environment settings."
        )
        sys.exit(1)

    log.info(f"Downloading model from HuggingFace repo: {HF_REPO}")

    try:
        # huggingface_hub is installed as a dependency of transformers
        from huggingface_hub import snapshot_download

        snapshot_download(
            repo_id=HF_REPO,
            token=HF_TOKEN,
            local_dir=str(MODEL_DIR),
            local_dir_use_symlinks=False,   # copy real files, not symlinks
            ignore_patterns=["*.msgpack", "flax_model*", "tf_model*"],  # skip non-PyTorch weights
        )
        log.info(f"Model downloaded successfully to {MODEL_DIR}")

    except Exception as e:
        log.error(f"Failed to download model: {e}")
        sys.exit(1)


if __name__ == "__main__":
    main()
