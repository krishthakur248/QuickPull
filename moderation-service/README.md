# QuickPull Chat Moderation

A two-part chat moderation system for QuickPull.  
**It never auto-bans or blocks anyone.** Every flag is queued for a human admin to review.

---

## How it works

```
User sends message
       │
       ▼
 Node backend saves message + delivers to recipient   ←── user never waits
       │
       ▼  (fire-and-forget, 2 s timeout)
 Python moderation service  (Render)
  │  Check 1: DistilBERT ML model score
  │  Check 2: Hindi keyword word-boundary match
       │
       ▼  if flagged
 MongoDB  moderation_flags  collection  (status: pending_review)
       │
       ▼  optionally
 Socket.io gentle warning to sender only
       │
       ▼
 Admin reviews via  GET /api/moderation/flags
```

---

## Known accuracy limits

The ML model was trained on English Wikipedia comments.  
- It **wrongly flags** innocent slang ("killing me", "hell"): **6 / 30 normal messages**  
- It **misses** implied threats and **all Hindi-in-English-letters abuse**: **14 / 30 abusive messages**  

The keyword list partially covers the Hindi gap, but is intentionally conservative.  
**This system is an aid to human review, not an automated enforcement tool.**

---

## Part 1 — Python Moderation Service (`moderation-service/`)

### Folder contents

| File | Purpose |
|------|---------|
| `main.py` | FastAPI app, `/moderate` and `/health` endpoints |
| `moderate.py` | Wraps the DistilBERT model (unchanged from training) |
| `download_model.py` | Downloads model weights from HuggingFace at container startup |
| `hindi_keywords.json` | Editable list of Hindi-in-English abusive words/phrases |
| `golden_test_cases.json` | Expected scores for regression testing |
| `test_golden.py` | Test runner – calls service with every golden case |
| `requirements.txt` | Pinned Python deps (CPU-only torch) |
| `Dockerfile` | Container build instructions |
| `render.yaml` | Render Blueprint config |
| `.gitignore` | Keeps model weights out of git |

### How model weights are handled (plain words)

The weights file (`model.safetensors`) is **268 MB** — too big for a normal git repo.  

**Chosen approach: upload to a private Hugging Face repo, download at startup.**

1. You upload the `model/` folder contents (4 files) to a **private** repo at https://huggingface.co  
2. On startup, `download_model.py` runs first and downloads the files using your token.  
3. The container caches them in `/app/model_files/` for the life of the container.  
4. Nothing secret is in the code or the git repo.

> **Alternative (if you want to avoid re-downloading on every restart):**  
> Add a Render "Disk" (persistent storage) mounted at `/app/model_files`. Then the  
> first startup downloads, and every subsequent restart just reads from disk. This  
> is more reliable but costs a bit extra on Render.

### Minimum Render instance memory

**Standard plan (2 GB RAM)** is the minimum.  
DistilBERT needs ~600 MB RAM just to load, plus Python + FastAPI overhead.  
The free/starter 512 MB tier **will crash** when loading the model.

---

## Deploy to Render (step by step)

### Step 1 — Upload model to Hugging Face

1. Go to https://huggingface.co → click your avatar → "New Model"
2. Name it (e.g. `quickpull-moderation`) and set it to **Private**
3. Upload these four files from `Model/DistilBERT/model/`:
   - `config.json`
   - `model.safetensors`
   - `tokenizer.json`
   - `tokenizer_config.json`
4. Also upload `moderation_config.json` from `Model/DistilBERT/`
5. Go to https://huggingface.co/settings/tokens → create a **Read** token → copy it

### Step 2 — Push moderation-service to GitHub

```bash
cd QuickPull
git init moderation-service   # or push to your main repo in a sub-folder
cd moderation-service
git add .
git commit -m "Add moderation service"
git remote add origin https://github.com/YOUR_USERNAME/quickpull-moderation
git push -u origin main
```

> ⚠️ The `.gitignore` already excludes `model_files/` and `*.safetensors`.  
> Never commit the weights file.

### Step 3 — Create the service on Render

Option A — **Blueprint (automatic)**:
1. Go to https://render.com → Dashboard → "New" → "Blueprint"
2. Connect your GitHub repo
3. Render reads `render.yaml` and creates the service automatically

Option B — **Manual**:
1. New → "Web Service" → connect GitHub repo
2. Runtime: **Docker**
3. Plan: **Standard** (2 GB RAM)
4. Health check path: `/health`

### Step 4 — Add environment variables in Render dashboard

Go to the service → "Environment" tab → add these:

| Variable | Value |
|----------|-------|
| `MODERATION_API_KEY` | any long random string (e.g. generate with `openssl rand -hex 32`) |
| `HF_TOKEN` | your Hugging Face read token |
| `HF_REPO` | `your-hf-username/quickpull-moderation` |

### Step 5 — Enable in Node backend

In `car-pulling-backend/.env` (or your Render env for the Node service):

```env
MODERATION_ENABLED=true
MODERATION_URL=https://quickpull-moderation.onrender.com
MODERATION_API_KEY=<same value as the Python service>
MODERATION_TIMEOUT_MS=2000
MODERATION_WARN_SENDER=true
```

Restart the Node backend.

---

## Part 2 — Node backend changes

### Files changed / added

| File | What changed |
|------|-------------|
| `src/controllers/message.controller.js` | Calls `moderateMessage()` **after** sending the HTTP response (fire-and-forget) |
| `src/utils/moderation.js` | **New** – async helper that calls the Python service and saves flags |
| `src/models/ModerationFlag.js` | **New** – Mongoose model for the `moderation_flags` collection |
| `src/models/User.js` | Added `isAdmin: Boolean` field |
| `src/controllers/moderation.controller.js` | **New** – admin endpoints to list and review flags |
| `src/routes/moderation.routes.js` | **New** – `/api/moderation/flags` routes (admin only) |
| `src/server.js` | Registers `/api/moderation` routes |
| `.env` | Added 5 new `MODERATION_*` env vars (default: disabled) |
| `src/scripts/test_failopen.js` | **New** – test that chat works when moderation is off/unreachable |

### Admin endpoints

> All require a JWT from a user with `isAdmin: true` in the database.
> To grant yourself admin access, run in MongoDB Atlas / Compass:
> ```
> db.users.updateOne({ email: "you@example.com" }, { $set: { isAdmin: true } })
> ```

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/moderation/flags?status=pending_review&page=1&limit=20` | List flagged messages |
| PUT | `/api/moderation/flags/:id/review` | Mark a flag as reviewed |

PUT body (optional):
```json
{ "adminNote": "Looked at it – normal slang, no action needed" }
```

---

## Running the tests

### Golden score test (Python)
```bash
cd moderation-service
# Start the service first (or point at Render)
python test_golden.py
# Or with custom URL:
MODERATION_URL=https://quickpull-moderation.onrender.com \
MODERATION_API_KEY=your_key \
python test_golden.py
```

### Fail-open test (Node)
```bash
cd car-pulling-backend
node src/scripts/test_failopen.js
```

---

## Turning moderation off

Set in your `.env` (or Render environment):
```env
MODERATION_ENABLED=false
```

Restart the Node backend. No messages will be moderated. Chat works exactly as before.

---

## Editing the Hindi keyword list

Open `moderation-service/hindi_keywords.json` and add or remove phrases.  
Rules:
- One phrase per line in the JSON array
- Matching is case-insensitive and word-boundary based (whole words only)
- Keep the list conservative — false flags are worse than misses for a chat system
- Redeploy the Python service after editing (or just restart it)
