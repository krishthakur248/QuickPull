const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema(
  {
    // Basic Info
    firstName: {
      type: String,
      required: [true, 'First name is required'],
      trim: true,
    },
    lastName: {
      type: String,
      required: [true, 'Last name is required'],
      trim: true,
    },
    email: {
      type: String,
      required: [true, 'Email is required'],
      unique: true,
      lowercase: true,
      match: [/^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/, 'Invalid email format'],
    },
    password: {
      type: String,
      required: [true, 'Password is required'],
      minlength: 6,
      select: false,
    },
    phone: {
      type: String,
      required: [true, 'Phone number is required'],
      unique: true,
    },
    profileImage: {
      type: String,
      default: null,
    },

    // User Type
    userType: {
      type: String,
      enum: ['driver', 'rider', 'both'],
      default: 'both',
    },

    // Location & Preferences
    currentLocation: {
      type: {
        type: String,
        enum: ['Point'],
        default: 'Point',
      },
      coordinates: {
        type: [Number], // [longitude, latitude]
        default: [0, 0],
      },
    },

    // Safety & Verification
    phoneVerified: {
      type: Boolean,
      default: false,
    },
    idVerified: {
      type: Boolean,
      default: false,
    },
    idDocument: {
      type: String,
      default: null,
    },

    // Driver Info
    vehicle: {
      type: String,
      enum: ['car', 'bike', 'ev', null],
      default: null,
    },
    vehicleNumber: {
      type: String,
      default: null,
    },
    vehicleColor: {
      type: String,
      default: null,
    },
    licenseNumber: {
      type: String,
      default: null,
    },

    // Rating & Reviews
    rating: {
      type: Number,
      default: 5.0,
      min: 0,
      max: 5,
    },
    totalRides: {
      type: Number,
      default: 0,
    },
    totalReviews: {
      type: Number,
      default: 0,
    },
    // Bayesian rating fields — updated atomically on each review submit.
    // ratingSum is the raw sum of all 1-5 star values; ratingCount is the count.
    // score10 = ((C * PRIOR10) + ratingSum*2) / (C + ratingCount)
    ratingSum: {
      type: Number,
      default: 0,
    },
    ratingCount: {
      type: Number,
      default: 0,
    },
    // Set true for simulation / admin-created accounts so we skip review popups
    // and exclude their reviews from real driver aggregates.
    isSimulation: {
      type: Boolean,
      default: false,
    },

    // Account Status
    isActive: {
      type: Boolean,
      default: true,
    },
    isBlocked: {
      type: Boolean,
      default: false,
    },
    blockReason: {
      type: String,
      default: null,
    },

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

// Hash password before saving
userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();

  try {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (error) {
    next(error);
  }
});

// Method to compare passwords
userSchema.methods.comparePassword = async function (enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

// Geospatial index for location-based queries
userSchema.index({ currentLocation: '2dsphere' });

module.exports = mongoose.model('User', userSchema);
