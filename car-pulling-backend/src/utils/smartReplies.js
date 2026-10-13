/**
 * smartReplies.js  -  Calls the Python /smart-replies endpoint.
 *
 * HOW IT WORKS
 * ─────────────
 * 1. This module is called AFTER a message is saved and delivered.
 * 2. It calls the Python service with a strict AbortController timeout.
 * 3. If the service is down, slow, or returns an error → "fail open":
 *    no suggestions are emitted, no error shown to the user.
 * 4. A separate circuit breaker (3 failures → 30 s cooldown) prevents
 *    hammering an offline service. It is completely independent of the
 *    moderation circuit breaker.
 * 5. Returns the suggestions array; the CALLER (message.controller.js)
 *    decides whether to emit them (e.g., discards them if the message
 *    was flagged by moderation).
 *
 * ENV VARS (same .env / Render env as moderation):
 *   MODERATION_ENABLED      - "false" disables ALL ML calls
 *   MODERATION_URL          - base URL (no trailing slash)
 *   MODERATION_API_KEY      - shared secret for X-API-Key header
 *   MODERATION_TIMEOUT_MS   - HTTP timeout in ms (default 2000)
 */

// Read settings once at module load (same source as moderation.js)
const ENABLED     = process.env.MODERATION_ENABLED !== 'false';
const SERVICE_URL = (process.env.MODERATION_URL || '').replace(/\/$/, '');
const API_KEY     = process.env.MODERATION_API_KEY || '';
const TIMEOUT_MS  = parseInt(process.env.MODERATION_TIMEOUT_MS || '2000', 10);

// ── Circuit breaker state (SEPARATE from moderation's) ──────────────────────
const SR_BREAKER = {
  failures:  0,
  openUntil: 0,   // epoch ms when the cooldown expires
  THRESHOLD: 3,
  COOLDOWN_MS: 30_000,
};

function srBreakerOpen() {
  if (SR_BREAKER.openUntil > Date.now()) return true;
  if (SR_BREAKER.openUntil > 0 && SR_BREAKER.openUntil <= Date.now()) {
    // Cooldown expired – half-open: reset and try again
    SR_BREAKER.failures  = 0;
    SR_BREAKER.openUntil = 0;
  }
  return false;
}

function srBreakerFail() {
  SR_BREAKER.failures += 1;
  if (SR_BREAKER.failures >= SR_BREAKER.THRESHOLD) {
    SR_BREAKER.openUntil = Date.now() + SR_BREAKER.COOLDOWN_MS;
    console.warn(
      `[SMART-REPLIES] Circuit breaker OPEN – skipping for ${SR_BREAKER.COOLDOWN_MS / 1000}s`
    );
  }
}

function srBreakerSuccess() {
  SR_BREAKER.failures  = 0;
  SR_BREAKER.openUntil = 0;
}

/**
 * Call POST /smart-replies on the Python service.
 *
 * @param {string} messageText
 * @param {string} recipientRole  "driver" | "rider"
 * @returns {Promise<Array>}  array of {id, text} suggestions; empty on failure
 */
async function callSmartReplies(messageText, recipientRole) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(`${SERVICE_URL}/smart-replies`, {
      method:  'POST',
      headers: {
        'Content-Type':              'application/json',
        'X-API-Key':                 API_KEY,
        'ngrok-skip-browser-warning':'true',
      },
      body:    JSON.stringify({ message: messageText, recipient_role: recipientRole, flagged: false }),
      signal:  controller.signal,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();
    if (!data || !Array.isArray(data.suggestions)) {
      throw new Error('Invalid JSON response from /smart-replies');
    }

    srBreakerSuccess();
    return data.suggestions;
  } catch (err) {
    const label = err.name === 'AbortError' ? `timeout after ${TIMEOUT_MS}ms` : err.message;
    console.warn(`[SMART-REPLIES] Service error: ${label} – failing open`);
    srBreakerFail();
    return [];
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Main entry point – called from the background task in message.controller.js.
 * Returns the suggestions array; does NOT emit to socket (caller decides).
 *
 * @param {string} messageText
 * @param {'driver'|'rider'} recipientRole
 * @returns {Promise<Array>}  [{id, text}, ...] or []
 */
async function runSmartReplies(messageText, recipientRole) {
  // Feature switch
  if (!ENABLED) return [];

  // Config guard
  if (!SERVICE_URL) return [];

  // Circuit breaker
  if (srBreakerOpen()) {
    console.warn('[SMART-REPLIES] Circuit breaker open – skipping');
    return [];
  }

  return callSmartReplies(messageText, recipientRole);
}


module.exports = { runSmartReplies };
