const mongoose = require('mongoose');

/**
 * AdminLog — one document per admin action.
 *
 * Every login (success or failure), block, unblock, verify, force-complete, etc.
 * is written here so we have a permanent, tamper-evident record of what
 * each admin did and when.
 *
 * Fields:
 *   adminId     — the admin who performed the action (null for failed logins
 *                 where no matching user was found at all)
 *   action      — short uppercase string, e.g. 'LOGIN_SUCCESS', 'BLOCK_USER'
 *   targetType  — what kind of entity was affected: 'user', 'trip', null
 *   targetId    — the MongoDB ObjectId of that entity, if any
 *   details     — a free-form object for extra context (reason, email, etc.)
 *   ip          — the request IP address
 *   createdAt   — when it happened (from timestamps:true)
 */
const adminLogSchema = new mongoose.Schema(
  {
    // Which admin performed the action.
    // May be null for failed logins where no matching user was found.
    adminId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },

    // Short uppercase label for the action.
    // Examples: 'LOGIN_SUCCESS', 'LOGIN_FAILED', 'BLOCK_USER', 'UNBLOCK_USER',
    //           'VERIFY_ID', 'UNVERIFY_PHONE', 'FORCE_COMPLETE_TRIP'
    action: {
      type: String,
      required: [true, 'Action is required'],
      trim: true,
    },

    // What kind of entity was affected (null if not entity-specific)
    targetType: {
      type: String,
      enum: ['user', 'trip', 'message', 'flag', null],
      default: null,
    },

    // The MongoDB ObjectId of the affected entity
    targetId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },

    // Free-form object — store anything useful for auditing.
    // Examples: { reason: "spam", attemptedEmail: "x@x.com", oldValue: false }
    details: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },

    // Request IP address
    ip: {
      type: String,
      default: null,
    },
  },
  {
    // Adds createdAt and updatedAt automatically.
    timestamps: true,
  }
);

// Most common query: "show me all logs, newest first"
adminLogSchema.index({ createdAt: -1 });

// Secondary query: "what did admin X do?"
adminLogSchema.index({ adminId: 1, createdAt: -1 });

module.exports = mongoose.model('AdminLog', adminLogSchema);
