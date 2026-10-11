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

        // ── ETA sub-document (populated at driver-accept time) ──────────
        // pickupSeconds / tripSeconds are what we show the user.
        // osrm* fields are the raw OSRM values used as model input.
        // source tells you whether the model or OSRM fallback was used.
        eta: {
          pickupSeconds    : Number,  // model or OSRM pickup leg duration (s)
          tripSeconds      : Number,  // model or OSRM trip leg duration (s)
          osrmPickupSeconds: Number,  // raw OSRM pickup leg duration (s)
          osrmTripSeconds  : Number,  // raw OSRM trip leg duration (s)
          osrmPickupMeters : Number,  // raw OSRM pickup leg distance (m)
          osrmTripMeters   : Number,  // raw OSRM trip leg distance (m)
          pickupSource     : String,  // 'model' or 'osrm_fallback'
          tripSource       : String,  // 'model' or 'osrm_fallback'
          reason           : String,  // human-readable explanation
          modelVersion     : String,  // which model version was used
          computedAt       : Date,    // when the ETA was computed
        },

        // ── completedAt — set when the trip is completed ────────────────
        // Lets us compare predicted ETA vs real duration on Indian roads.
        completedAt: Date,
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
