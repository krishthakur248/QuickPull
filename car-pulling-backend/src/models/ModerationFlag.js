const mongoose = require('mongoose');

/**
 * ModerationFlag  –  one document per flagged chat message.
 *
 * Status lifecycle:
 *   "pending_review"  →  admin sees it in the dashboard
 *   "reviewed"        →  admin has looked at it and acted (or dismissed)
 *
 * We NEVER auto-ban anyone. An admin must make a manual decision.
 */
const moderationFlagSchema = new mongoose.Schema(
  {
    // Which message was flagged
    messageId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Message',
      required: true,
    },

    // Context: which trip and who sent it
    tripId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Trip',
      required: true,
    },
    senderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },

    // The exact text that was flagged (kept for audit)
    text: {
      type: String,
      required: true,
    },

    // Score from the ML model (0.0 – 1.0)
    score: {
      type: Number,
      required: true,
    },

    // Which checks triggered the flag, e.g. ["model_score", "keyword_match"]
    reasons: {
      type: [String],
      default: [],
    },

    // Review state
    status: {
      type: String,
      enum: ['pending_review', 'reviewed'],
      default: 'pending_review',
    },

    // Admin who reviewed (filled in when status → reviewed)
    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    reviewedAt: {
      type: Date,
      default: null,
    },

    // Optional note left by admin
    adminNote: {
      type: String,
      default: null,
    },
  },
  {
    timestamps: true, // adds createdAt and updatedAt automatically
  }
);

// Index for the admin dashboard query (most common access pattern)
moderationFlagSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model('ModerationFlag', moderationFlagSchema);
