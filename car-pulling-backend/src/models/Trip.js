const mongoose = require('mongoose');

const tripSchema = new mongoose.Schema(
  {
    // Trip Basic Info
    tripCode: {
      type: String,
      unique: true,
      required: true,
    },

    // Driver Info
    driver: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },

    // Route Info
    pickupLocation: {
      address: String,
      coordinates: {
        type: {
          type: String,
          enum: ['Point'],
          default: 'Point',
        },
        coordinates: [Number], // [longitude, latitude]
      },
    },
    dropoffLocation: {
      address: String,
      coordinates: {
        type: {
          type: String,
          enum: ['Point'],
          default: 'Point',
        },
        coordinates: [Number],
      },
    },

    // GPS Trajectory (array of GPS points)
    route: [
      {
        latitude: Number,
        longitude: Number,
        timestamp: Date,
      },
    ],

    // Real-time Route History (for advanced matching algorithm)
    routeHistory: [
      {
        latitude: Number,
        longitude: Number,
        timestamp: {
          type: Date,
          default: Date.now,
        },
      },
    ],

    // Trip Status
    status: {
      type: String,
      enum: ['active', 'completed', 'cancelled'],
      default: 'active',
    },

    // Riders in this trip
    riders: [
      {
        riderId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'User',
        },
        pickupPoint: {
          address: String,
          coordinates: {
            type: {
              type: String,
              enum: ['Point'],
              default: 'Point',
            },
            coordinates: [Number],
          },
        },
        dropoffPoint: {
          address: String,
          coordinates: {
            type: {
              type: String,
              enum: ['Point'],
              default: 'Point',
            },
            coordinates: [Number],
          },
        },
        fare: Number,
        joinedAt: Date,
        status: {
          type: String,
          enum: ['matched', 'confirmed', 'ongoing', 'completed', 'cancelled'],
          default: 'matched',
        },
        paymentStatus: {
          type: String,
          enum: ['pending', 'paid', 'cancelled'],
          default: 'pending',
        },
        // Review-related flags — persisted so popup survives tab close / disconnect
        reviewPending: {
          type: Boolean,
          default: false,
        },
        reviewTrigger: {
          type: String,
          enum: ['completed', 'cancelled_after_accept', null],
          default: null,
        },
      },
    ],

    // Vehicle Info
    vehicle: {
      type: String,
      enum: ['car', 'bike', 'ev'],
      required: true,
    },
    availableSeats: {
      type: Number,
      default: 3,
    },
    occupiedSeats: {
      type: Number,
      default: 1, // Driver takes 1 seat
    },

    // Fare Calculation
    baseFare: Number,
    distanceFare: Number,
    totalFare: Number,
    distance: Number, // in km
    duration: Number, // in minutes

    // Trip Timeline
    startTime: {
      type: Date,
      required: true,
    },
    endTime: Date,
    estimatedEndTime: Date,

    // Safety & Compliance
    driverConsent: {
      type: Boolean,
      default: false,
    },
    ridersConsent: [
      {
        riderId: mongoose.Schema.Types.ObjectId,
        consented: Boolean,
        consentTime: Date,
      },
    ],

    // Timestamps
    createdAt: {
      type: Date,
      default: Date.now,
    },
    updatedAt: {
      type: Date,
      default: Date.now,
    },
  },
  {
    timestamps: true,
  }
);

// Geospatial index for location-based queries
tripSchema.index({ 'pickupLocation.coordinates': '2dsphere' });
tripSchema.index({ 'dropoffLocation.coordinates': '2dsphere' });

module.exports = mongoose.model('Trip', tripSchema);
