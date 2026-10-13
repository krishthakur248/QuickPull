/**
 * moderation.js  -  Talks to the Python moderation service asynchronously.
 *
 * HOW IT WORKS
 * ─────────────
 * 1. The caller (sendMessage) saves the message and sends the HTTP response
 *    to the user FIRST.  Only then it calls moderateMessage().
 * 2. moderateMessage() calls the Python service with a strict AbortController
 *    timeout (MODERATION_TIMEOUT_MS, default 2000 ms).
 * 3. If the service is down, slow, or returns an error → "fail open":
 *    chat is never delayed or blocked; we just log one short warning.
 * 4. Circuit breaker (3 failures → 30 s cooldown) prevents hammering a dead
 *    service. SEPARATE from the smart-replies circuit breaker.
 * 5. If flagged → set isFlagged on the message, save ModerationFlag record,
 *    emit ONE gentle warning to the sender, emit message-flagged badge event.
 *
 * ENV VARS (set in your .env file):
 *   MODERATION_ENABLED       - "true" / "false"  (default: "true")
 *   MODERATION_URL           - base URL of the Python service
 *   MODERATION_API_KEY       - shared secret that the Python service checks
 *   MODERATION_TIMEOUT_MS    - HTTP timeout in ms (default: 2000)
 *   MODERATION_WARN_SENDER   - "true" / "false" - show gentle warning (default: "true")
 */

const ModerationFlag = require('../models/ModerationFlag');
const Message        = require('../models/Message');

// Read all settings from environment variables.
const ENABLED     = process.env.MODERATION_ENABLED !== 'false'; // default ON
const SERVICE_URL = (process.env.MODERATION_URL || '').replace(/\/$/, '');
const API_KEY     = process.env.MODERATION_API_KEY || '';
const TIMEOUT_MS  = parseInt(process.env.MODERATION_TIMEOUT_MS || '2000', 10);
const WARN_SENDER = process.env.MODERATION_WARN_SENDER !== 'false'; // default ON

// ── Circuit breaker state (SEPARATE from smart-replies) ───────────────────────
const MOD_BREAKER = {
  failures:  0,
  openUntil: 0,   // epoch ms when the cooldown expires
  THRESHOLD: 3,
  COOLDOWN_MS: 30_000,
};

function modBreakerOpen() {
  if (MOD_BREAKER.openUntil > Date.now()) return true;
  if (MOD_BREAKER.openUntil > 0 && MOD_BREAKER.openUntil <= Date.now()) {
    // Cooldown expired – reset and try again
    MOD_BREAKER.failures  = 0;
    MOD_BREAKER.openUntil = 0;
  }
  return false;
}

function modBreakerFail() {
  MOD_BREAKER.failures += 1;
  if (MOD_BREAKER.failures >= MOD_BREAKER.THRESHOLD) {
    MOD_BREAKER.openUntil = Date.now() + MOD_BREAKER.COOLDOWN_MS;
    console.warn(
      `[MODERATION] Circuit breaker OPEN – skipping for ${MOD_BREAKER.COOLDOWN_MS / 1000}s`
    );
  }
}

function modBreakerSuccess() {
  MOD_BREAKER.failures  = 0;
  MOD_BREAKER.openUntil = 0;
}

/**
 * Call the Python moderation service for a single text string.
 * Returns the service response or null if the call failed.
 *
 * @param {string} text
 * @returns {Promise<{flagged, score, threshold, reasons}|null>}
 */
async function callModerationService(text) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(`${SERVICE_URL}/moderate`, {
      method:  'POST',
      headers: {
        'Content-Type':              'application/json',
        'X-API-Key':                 API_KEY,
        'ngrok-skip-browser-warning':'true',
      },
      body:    JSON.stringify({ text }),
      signal:  controller.signal,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();
    if (typeof data.flagged !== 'boolean') {
      throw new Error('Invalid JSON response from /moderate');
    }

    modBreakerSuccess();
    return data;
  } catch (err) {
    const label = err.name === 'AbortError' ? `timeout after ${TIMEOUT_MS}ms` : err.message;
    console.warn(`[MODERATION] Service error: ${label} – failing open`);
    modBreakerFail();
    return null; // null = treat as "not flagged"
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Main entry point.  Called AFTER the message has been saved and delivered.
 *
 * @param {object} opts
 * @param {import('mongoose').Document} opts.message     - the saved Message document
 * @param {string}                      opts.rawSenderId - sender ID before populate
 * @param {import('socket.io').Server}  opts.io          - Socket.io instance
 * @returns {Promise<{flagged: boolean}>}  resolved with flag result for caller
 */
async function moderateMessage({ message, rawSenderId, io }) {
  // Feature switch - if MODERATION_ENABLED=false, do nothing at all
  if (!ENABLED) {
    return { flagged: false };
  }

  // Guard: if no URL is configured, warn once and skip
  if (!SERVICE_URL) {
    console.warn('[MODERATION] MODERATION_URL is not set - skipping moderation');
    return { flagged: false };
  }

  // Circuit breaker
  if (modBreakerOpen()) {
    console.warn('[MODERATION] Circuit breaker open - skipping');
    return { flagged: false };
  }

  const result = await callModerationService(message.messageText);

  // Service was down or timed out → fail open
  if (!result) {
    return { flagged: false };
  }

  // Message is clean → do nothing
  if (!result.flagged) {
    return { flagged: false };
  }

  // ── Message was flagged ────────────────────────────────────────────────────
  const senderIdStr = rawSenderId || message.senderId.toString();

  console.log(
    `[MODERATION] Message flagged: id=${message._id} ` +
    `score=${result.score} reasons=${result.reasons.join(',')}`
  );

  // Save ModerationFlag and mark message isFlagged in DB
  try {
    await ModerationFlag.create({
      messageId: message._id,
      tripId:    message.tripId,
      senderId:  senderIdStr,
      text:      message.messageText,
      score:     result.score,
      reasons:   result.reasons,
      status:    'pending_review',
    });
    await Message.findByIdAndUpdate(message._id, { isFlagged: true });
    console.log(`[MODERATION] Flag saved and message marked flagged for ${message._id}`);
  } catch (dbErr) {
    // Never let a DB error affect the user experience
    console.error(`[MODERATION] Failed to save flag: ${dbErr.message}`);
  }

  // ── Emit warning to sender + flag badge event ─────────────────────────────
  if (io) {
    const msgIdStr  = message._id.toString();
    const tripIdStr = message.tripId ? message.tripId.toString() : null;

    if (WARN_SENDER) {
      const warningPayload = {
        type:      'moderation-warning',
        tripId:    tripIdStr,
        messageId: msgIdStr,
        score:     result.score,
        reasons:   result.reasons,
      };
      console.log(`[MODERATION] Emitting warning to user_${senderIdStr}`);
      io.to(`user_${senderIdStr}`).emit('moderation-warning', warningPayload);
    }

    // Badge event to sender only (spec: "🚩 Flagged" on SENDER's own bubble)
    const flagPayload = { messageId: msgIdStr, tripId: tripIdStr };
    io.to(`user_${senderIdStr}`).emit('message-flagged', flagPayload);
  }

  return { flagged: true };
}

module.exports = { moderateMessage };
