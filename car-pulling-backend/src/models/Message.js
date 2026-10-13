const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema(
  {
    // Trip Reference
    tripId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Trip',
      required: true,
    },

    // Sender & Receiver
    senderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    recipientId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },

    // Message Content
    messageText: {
      type: String,
      required: true,
      maxlength: 500,
    },
    messageType: {
      type: String,
      enum: ['text', 'location_share', 'photo'],
      default: 'text',
    },

    // Message Status
    isRead: {
      type: Boolean,
      default: false,
    },
    readAt: Date,
    isFlagged: {
      type: Boolean,
      default: false,
    },

    // Timestamps
    createdAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

// Index for retrieving messages by trip
messageSchema.index({ tripId: 1, createdAt: -1 });

module.exports = mongoose.model('Message', messageSchema);
