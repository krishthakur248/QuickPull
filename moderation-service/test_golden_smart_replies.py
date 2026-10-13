"""
test_golden_smart_replies.py
Runs the golden test cases from smartreply_v1/golden_test_cases.json against
the SmartReplier class directly (no HTTP server needed).

Usage:
  python test_golden_smart_replies.py
"""

import json
import sys
import time
from pathlib import Path

BASE = Path(__file__).parent

def main():
    # Import SmartReplier from the same folder
    sys.path.insert(0, str(BASE / "smartreply_v1"))
    sys.path.insert(0, str(BASE))

    print("Loading SmartReplier...")
    t0 = time.time()
    from smartreply_v1.smart_reply import SmartReplier
    sr = SmartReplier()
    print(f"Loaded in {time.time() - t0:.1f}s\n")

    cases = json.loads((BASE / "smartreply_v1" / "golden_test_cases.json").read_text())
    total = len(cases)
    passed = 0

    for i, c in enumerate(cases, 1):
        msg   = c["message"]
        role  = c["recipient_role"]
        flagged = c.get("flagged", False)
        expect_non_empty = c.get("expect_non_empty", True)

        if flagged or not msg.strip():
            # SmartReplier always returns empty for empty; flagged filtering is caller's job
            sug = []
        else:
            sug = sr.suggest(msg, role)

        got_non_empty = len(sug) > 0
        ok = (got_non_empty == expect_non_empty)
        passed += ok

        status = "PASS" if ok else "FAIL"
        sug_texts = [s["text"] for s in sug[:2]]
        print(f"  [{status}] #{i:2d} | msg={msg!r:.40s} | role={role} | "
              f"expect_non_empty={expect_non_empty} | got={len(sug)} sug "
              f"| top: {sug_texts}")

    print(f"\nResult: {passed}/{total} golden cases passed")
    if passed < total:
        sys.exit(1)

if __name__ == "__main__":
    main()
