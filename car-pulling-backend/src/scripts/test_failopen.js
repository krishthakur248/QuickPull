/**
 * test_failopen.js  –  Tests that chat still works when the moderation
 *                       service is switched off or unreachable.
 *
 * This is a standalone script (no Jest needed). Run with:
 *   node test_failopen.js
 *
 * It directly calls the moderateMessage() helper with MODERATION_ENABLED=false
 * and MODERATION_URL pointing at a non-existent port, and checks that it
 * resolves without throwing and in under 100 ms.
 */

// ── Set env vars BEFORE requiring anything ──────────────────────────────────
// Test 1: feature switch off
process.env.MODERATION_ENABLED = 'false';
process.env.MODERATION_URL     = 'http://localhost:9'; // port 9 = discard (always refused)
process.env.MODERATION_API_KEY = 'test_key';
process.env.MODERATION_TIMEOUT_MS = '500';

// We need dotenv loaded so the module doesn't crash on missing vars
// but we override the values above first.
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

// Re-apply overrides after dotenv (dotenv won't overwrite existing env vars)
process.env.MODERATION_ENABLED = 'false';
process.env.MODERATION_URL     = 'http://localhost:9';

const { moderateMessage } = require('../src/utils/moderation');

// Fake mongoose document – enough to satisfy moderateMessage()
function fakeMessage(text) {
  return {
    _id: '000000000000000000000001',
    tripId: '000000000000000000000002',
    senderId: '000000000000000000000003',
    messageText: text,
  };
}

async function runTests() {
  let passed = 0;
  let failed = 0;

  // ── Test 1: MODERATION_ENABLED=false → returns immediately ──────────────
  {
    const start = Date.now();
    try {
      await moderateMessage({ message: fakeMessage('hello world'), io: null });
      const elapsed = Date.now() - start;
      if (elapsed < 100) {
        console.log(`[PASS] Test 1: feature switch off – resolved in ${elapsed}ms (fast, no network call)`);
        passed++;
      } else {
        console.log(`[FAIL] Test 1: feature switch off – took ${elapsed}ms (expected < 100ms)`);
        failed++;
      }
    } catch (err) {
      console.log(`[FAIL] Test 1: feature switch off – threw an error: ${err.message}`);
      failed++;
    }
  }

  // ── Test 2: MODERATION_ENABLED=true but service unreachable → fail open ─
  {
    process.env.MODERATION_ENABLED = 'true'; // turn it back on
    // We need to re-require the module to pick up the new env (simple trick)
    // For a real test suite you'd use dependency injection. Here we just
    // call the underlying axios logic via a fresh require.
    const moderationModule = require('../src/utils/moderation');

    const start = Date.now();
    try {
      // This should NOT throw even though the service is unreachable
      await moderationModule.moderateMessage({ message: fakeMessage('test message'), io: null });
      const elapsed = Date.now() - start;
      console.log(`[PASS] Test 2: service unreachable – resolved in ${elapsed}ms (fail-open, no throw)`);
      passed++;
    } catch (err) {
      console.log(`[FAIL] Test 2: service unreachable – threw an error: ${err.message}`);
      failed++;
    }
  }

  // ── Summary ─────────────────────────────────────────────────────────────
  console.log('');
  console.log(`Results: ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

runTests();
