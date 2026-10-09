const mongoose = require('mongoose');

/**
 * Review – one star-rating left by a passenger for a driver.
 *
 * Unique constraint on (bookingId, passengerId) prevents double-submits.
 * bookingId  = the Trip _id  (one trip = one bookable slot per passenger)
 * passengerId = the rider's User _id
 */
const reviewSchema = new mongoose.Schema(
  {
    tripId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Trip',
      required: true,
      index: true,
    },
    // Composite natural key — stored separately for fast look-ups
    bookingId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Trip',
      required: true,
    },
    driverId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    passengerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },

    // 1-5 integer star rating
    rating: {
      type: Number,
      required: true,
      min: 1,
      max: 5,
      validate: {
        validator: Number.isInteger,
        message: 'Rating must be an integer',
      },
    },

    // Optional short comment (max 300 chars, sanitised server-side)
    comment: {
      type: String,
      default: '',
      maxlength: 300,
      trim: true,
    },

    // What triggered the review popup
    trigger: {
      type: String,
      enum: ['completed', 'cancelled_after_accept'],
      required: true,
    },

    createdAt: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true }
);

// One review per passenger per booking – prevents duplicate submissions
reviewSchema.index({ bookingId: 1, passengerId: 1 }, { unique: true });

module.exports = mongoose.model('Review', reviewSchema);
