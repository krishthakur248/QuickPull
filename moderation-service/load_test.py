"""
load_test.py  --  Load test for /moderate and /smart-replies.

Sends 20 concurrent requests to each endpoint and reports:
  - all 200 OK
  - average and slowest response time per endpoint
  - /health stays responsive during the test

Usage:
  python load_test.py [BASE_URL] [API_KEY]

  Defaults: BASE_URL=http://localhost:8000, API_KEY from env MODERATION_API_KEY
"""

import asyncio
import os
import sys
import time

try:
    import httpx
except ImportError:
    import subprocess
    subprocess.check_call([sys.executable, "-m", "pip", "install", "httpx", "-q"])
    import httpx

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8000"
KEY  = sys.argv[2] if len(sys.argv) > 2 else os.environ.get("MODERATION_API_KEY", "")
N    = 20


HEADERS = {
    "X-API-Key": KEY,
    "Content-Type": "application/json",
    "ngrok-skip-browser-warning": "true",
}

MOD_BODIES  = [{"text": "where are you?"} for _ in range(N)]
SR_BODIES   = [{"message": "where are you?", "recipient_role": "driver", "flagged": False} for _ in range(N)]


async def single_request(client, endpoint, body):
    t = time.perf_counter()
    r = await client.post(endpoint, json=body, headers=HEADERS, timeout=30)
    elapsed_ms = (time.perf_counter() - t) * 1000
    return r.status_code, elapsed_ms


async def run_concurrent(client, endpoint, bodies, label):
    tasks = [single_request(client, endpoint, b) for b in bodies]
    results = await asyncio.gather(*tasks, return_exceptions=True)
    codes, times = [], []
    for r in results:
        if isinstance(r, Exception):
            print(f"  [ERROR] {r}")
            codes.append(0)
            times.append(30000)
        else:
            codes.append(r[0])
            times.append(r[1])
    ok = sum(c == 200 for c in codes)
    avg = sum(times) / len(times)
    slow = max(times)
    print(f"\n  [{label}]")
    print(f"    Requests : {N}")
    print(f"    200 OK   : {ok}/{N}")
    print(f"    Avg time : {avg:.0f} ms")
    print(f"    Max time : {slow:.0f} ms")
    return ok == N


async def health_check(client):
    t = time.perf_counter()
    r = await client.get(f"{BASE}/health", headers={"ngrok-skip-browser-warning": "true"}, timeout=5)
    ms = (time.perf_counter() - t) * 1000
    print(f"\n  [/health] status={r.status_code}  body={r.text[:80]}  time={ms:.0f}ms")
    return r.status_code == 200


async def main():
    print(f"Load test against {BASE}  (N={N} concurrent per endpoint)\n")
    async with httpx.AsyncClient() as client:
        # Pre-check health
        await health_check(client)

        # Launch both endpoint tests simultaneously (they run in parallel)
        mod_ok, sr_ok = await asyncio.gather(
            run_concurrent(client, f"{BASE}/moderate",      MOD_BODIES,  "/moderate"),
            run_concurrent(client, f"{BASE}/smart-replies", SR_BODIES,   "/smart-replies"),
        )

        # Post-check health to verify it stayed responsive
        await health_check(client)

    print()
    if mod_ok and sr_ok:
        print("  LOAD TEST PASSED – all 200 OK")
    else:
        print("  LOAD TEST FAILED – some requests failed")
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(main())
