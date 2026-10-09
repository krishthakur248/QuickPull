const User = require('../models/User');

// GET USER BY ID
exports.getUserById = async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select('-password');

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    res.json({
      success: true,
      user,
    });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching user',
      error: error.message,
    });
  }
};

// GET USER RATINGS
exports.getUserRatings = async (req, res) => {
  try {
    const { computeScore10 } = require('../config/ratingConfig');
    const user = await User.findById(req.params.id).select('rating totalRides totalReviews firstName lastName profileImage ratingSum ratingCount');

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    const score10 = computeScore10(user.ratingSum || 0, user.ratingCount || 0);

    res.json({
      success: true,
      ratings: {
        rating:       user.rating,
        totalRides:   user.totalRides,
        totalReviews: user.totalReviews,
        ratingSum:    user.ratingSum   || 0,
        ratingCount:  user.ratingCount || 0,
        score10,  // null when ratingCount === 0
      },
    });
  } catch (error) {
    console.error('Get ratings error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching ratings',
      error: error.message,
    });
  }
};

// FIND NEARBY DRIVERS
exports.findNearbyDrivers = async (req, res) => {
  try {
    const { latitude, longitude, maxDistance = 5 } = req.body;

    if (latitude === undefined || longitude === undefined) {
      return res.status(400).json({
        success: false,
        message: 'Latitude and longitude are required',
      });
    }

    const drivers = await User.find({
      userType: { $in: ['driver', 'both'] },
      currentLocation: {
        $near: {
          $geometry: {
            type: 'Point',
            coordinates: [longitude, latitude],
          },
          $maxDistance: maxDistance * 1000, // Convert km to meters
        },
      },
    })
      .select('firstName lastName rating profileImage vehicle currentLocation')
      .limit(10);

    res.json({
      success: true,
      count: drivers.length,
      drivers,
    });
  } catch (error) {
    console.error('Find nearby drivers error:', error);
    res.status(500).json({
      success: false,
      message: 'Error finding nearby drivers',
      error: error.message,
    });
  }
};

// GET DRIVER INFO
exports.getDriverInfo = async (req, res) => {
  try {
    const user = await User.findById(req.params.driverId).select(
      'firstName lastName email phone profileImage rating vehicle vehicleNumber vehicleColor licenseNumber totalRides phoneVerified idVerified'
    );

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'Driver not found',
      });
    }

    res.json({
      success: true,
      driver: user,
    });
  } catch (error) {
    console.error('Get driver info error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching driver info',
      error: error.message,
    });
  }
};

// ADD RATING TO USER
exports.addRating = async (req, res) => {
  try {
    const { rating } = req.body;

    if (!rating || rating < 1 || rating > 5) {
      return res.status(400).json({
        success: false,
        message: 'Rating must be between 1 and 5',
      });
    }

    const user = await User.findById(req.params.userId);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    // Update rating (simple average)
    const totalRating = user.rating * user.totalReviews + rating;
    user.totalReviews += 1;
    user.rating = totalRating / user.totalReviews;

    await user.save();

    res.json({
      success: true,
      message: 'Rating added successfully',
      user: {
        rating: user.rating,
        totalReviews: user.totalReviews,
      },
    });
  } catch (error) {
    console.error('Add rating error:', error);
    res.status(500).json({
      success: false,
      message: 'Error adding rating',
      error: error.message,
    });
  }
};
