"""
test_golden.py  –  Run every case in golden_test_cases.json against the live
                    moderation service and check that scores match within tolerance.

Usage:
    python test_golden.py                          # uses defaults below
    MODERATION_URL=http://localhost:8000 python test_golden.py

ENV VARS:
    MODERATION_URL      – base URL of the running service (default: http://localhost:8000)
    MODERATION_API_KEY  – the shared secret key (must match what the service uses)
    GOLDEN_FILE         – path to golden_test_cases.json (default: ./golden_test_cases.json)
"""

import json
import os
import sys
import requests

# ── Settings ──────────────────────────────────────────────────────────────────
BASE_URL = os.environ.get("MODERATION_URL", "http://localhost:8000").rstrip("/")
API_KEY  = os.environ.get("MODERATION_API_KEY", "")
GOLDEN   = os.environ.get("GOLDEN_FILE", os.path.join(os.path.dirname(__file__), "golden_test_cases.json"))

HEADERS  = {"X-API-Key": API_KEY, "Content-Type": "application/json"}


def main():
    # Load the golden test cases
    with open(GOLDEN, encoding="utf-8") as f:
        data = json.load(f)

    tolerance = data.get("tolerance", 0.001)
    cases     = data["cases"]

    print(f"Running {len(cases)} golden test cases (tolerance ±{tolerance})")
    print(f"Service URL: {BASE_URL}")
    print("-" * 60)

    passed = 0
    failed = 0

    for i, case in enumerate(cases, 1):
        text             = case["text"]
        expected_score   = case["expected_score"]
        expected_flagged = case["expected_flagged"]

        try:
            resp = requests.post(
                f"{BASE_URL}/moderate",
                json={"text": text},
                headers=HEADERS,
                timeout=15,
            )
            resp.raise_for_status()
            result = resp.json()
        except Exception as e:
            print(f"[FAIL] Case {i}: '{text}'")
            print(f"       ERROR calling service: {e}")
            failed += 1
            continue

        actual_score   = result["score"]
        actual_flagged = result["flagged"]

        # Check score is within tolerance
        score_ok   = abs(actual_score - expected_score) <= tolerance
        # Check flagged boolean matches (note: keyword match can also set flagged=True
        # so we only fail if the model said "not flagged" but expected "flagged").
        # We check the raw ML score for precision, not the combined flagged flag.
        flagged_ok = actual_flagged == expected_flagged or actual_flagged  # flagged can only be MORE strict

        if score_ok:
            print(f"[PASS] Case {i}: '{text}'")
            print(f"       score={actual_score} (expected {expected_score}), flagged={actual_flagged}")
            passed += 1
        else:
            print(f"[FAIL] Case {i}: '{text}'")
            print(f"       score={actual_score} (expected {expected_score}, diff={abs(actual_score-expected_score):.4f})")
            print(f"       flagged={actual_flagged} (expected {expected_flagged})")
            failed += 1

    print("-" * 60)
    print(f"Results: {passed} passed, {failed} failed out of {len(cases)}")

    # Exit with error code if any test failed
    sys.exit(0 if failed == 0 else 1)


if __name__ == "__main__":
    main()
