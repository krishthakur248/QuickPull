/**
 * moderation.js  –  Talks to the Python moderation service asynchronously.
 *
 * HOW IT WORKS
 * ─────────────
 * 1. The caller (sendMessage) saves the message and sends the HTTP response
 *    to the user FIRST.  Only then it calls moderateMessage().
 * 2. moderateMessage() calls the Python service with a short timeout.
 * 3. If the service is down, slow, or returns an error → we "fail open":
 *    chat is never delayed or blocked; we just log the problem.
 * 4. If flagged → we save a record in ModerationFlag and optionally emit
 *    a gentle Socket.io warning back to the sender.
 *
 * ENV VARS (set in your .env file):
 *   MODERATION_ENABLED       – "true" / "false"  (default: "true")
 *   MODERATION_URL           – base URL of the Python service
 *   MODERATION_API_KEY       – shared secret that the Python service checks
 *   MODERATION_TIMEOUT_MS    – HTTP timeout in ms (default: 2000)
 *   MODERATION_WARN_SENDER   – "true" / "false" – show gentle warning (default: "true")
 */

const axios = require('axios');
const ModerationFlag = require('../models/ModerationFlag');
const Message = require('../models/Message');

// Read all settings from environment variables.
// We read them once here so every call sees the same values.
const ENABLED      = process.env.MODERATION_ENABLED !== 'false'; // default ON
const SERVICE_URL  = (process.env.MODERATION_URL || '').replace(/\/$/, ''); // remove trailing slash
const API_KEY      = process.env.MODERATION_API_KEY || '';
const TIMEOUT_MS   = parseInt(process.env.MODERATION_TIMEOUT_MS || '2000', 10);
const WARN_SENDER  = process.env.MODERATION_WARN_SENDER !== 'false'; // default ON

/**
 * Call the Python moderation service for a single text string.
 * Returns the service response or null if the call failed.
 *
 * @param {string} text
 * @returns {Promise<{flagged, score, threshold, reasons}|null>}
 */
async function callModerationService(text) {
  try {
    const response = await axios.post(
      `${SERVICE_URL}/moderate`,
      { text },
      {
        headers: {
          'Content-Type': 'application/json',
          'X-API-Key': API_KEY,
        },
        timeout: TIMEOUT_MS,
      }
    );
    return response.data;
  } catch (err) {
    // Log the failure but DO NOT throw – we always fail open
    if (err.code === 'ECONNABORTED') {
      console.warn(`[MODERATION] Service timeout after ${TIMEOUT_MS}ms – failing open`);
    } else {
      console.warn(`[MODERATION] Service error: ${err.message} – failing open`);
    }
    return null; // null = treat as "not flagged"
  }
}

/**
 * Main entry point.  Called AFTER the message has been saved and delivered.
 *
 * @param {object} opts
 * @param {import('mongoose').Document} opts.message   – the saved Message document
 * @param {import('socket.io').Server}  opts.io        – Socket.io instance (for warning)
 */
async function moderateMessage({ message, rawSenderId, io }) {
  // Feature switch – if MODERATION_ENABLED=false, do nothing at all
  if (!ENABLED) {
    return;
  }

  // Guard: if no URL is configured, warn once and skip
  if (!SERVICE_URL) {
    console.warn('[MODERATION] MODERATION_URL is not set – skipping moderation');
    return;
  }

  const result = await callModerationService(message.messageText);

  // Service was down or timed out → fail open, nothing to do
  if (!result) {
    return;
  }

  // Message is clean → do nothing
  if (!result.flagged) {
    return;
  }

  // ── Message was flagged ───────────────────────────────────────────────────
  // Use rawSenderId (the string ID captured before populate) for correct room targeting
  const senderIdStr = rawSenderId || message.senderId.toString();

  console.log(
    `[MODERATION] Message flagged: id=${message._id} ` +
    `score=${result.score} reasons=${result.reasons.join(',')}`
  );

  // Save a record in the moderation_flags collection for admin review
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
    // Mark message in database as flagged
    await Message.findByIdAndUpdate(message._id, { isFlagged: true });
    console.log(`[MODERATION] Flag saved and message marked flagged for ${message._id}`);
  } catch (dbErr) {
    // Never let a DB error affect the user experience
    console.error(`[MODERATION] Failed to save flag: ${dbErr.message}`);
  }

  // ── Emit warning to sender + notify chat participants of the flag ───────
  if (io) {
    const msgIdStr = message._id.toString();
    const tripIdStr = message.tripId ? message.tripId.toString() : null;

    if (WARN_SENDER) {
      const warningPayload = {
        type: 'moderation-warning',
        tripId: tripIdStr,
        messageId: msgIdStr,
        score: result.score,
        reasons: result.reasons,
      };
      console.log(`[MODERATION] Emitting warning to user_${senderIdStr}`);
      io.to(`user_${senderIdStr}`).emit('moderation-warning', warningPayload);
    }

    // Broadcast flag event so both sides can display the small red flag badge on the bubble
    const flagPayload = {
      messageId: msgIdStr,
      tripId: tripIdStr,
    };
    io.to(`user_${senderIdStr}`).emit('message-flagged', flagPayload);
    const recipientIdStr = message.recipientId ? (message.recipientId._id || message.recipientId).toString() : null;
    if (recipientIdStr && recipientIdStr !== senderIdStr) {
      io.to(`user_${recipientIdStr}`).emit('message-flagged', flagPayload);
    }
  }
}

module.exports = { moderateMessage };
