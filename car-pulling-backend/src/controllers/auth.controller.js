const User = require('../models/User');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

// Generate JWT Token
const generateToken = (userId) => {
  return jwt.sign({ id: userId }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRE || '7d',
  });
};

// REGISTER NEW USER
exports.register = async (req, res) => {
  try {
    const { firstName, lastName, email, phone, password, userType } = req.body;

    // Validation
    if (!firstName || !lastName || !email || !phone || !password) {
      return res.status(400).json({
        success: false,
        message: 'Please provide all required fields: firstName, lastName, email, phone, password',
      });
    }

    // Check if user already exists
    const existingUser = await User.findOne({
      $or: [{ email }, { phone }],
    });

    if (existingUser) {
      return res.status(409).json({
        success: false,
        message: existingUser.email === email
          ? 'Email already registered'
          : 'Phone number already registered',
      });
    }

    // Create new user
    const newUser = new User({
      firstName,
      lastName,
      email,
      phone,
      password,
      userType: userType || 'both',
    });

    // Save user (password will be hashed automatically by schema pre-save hook)
    await newUser.save();

    // Generate token
    const token = generateToken(newUser._id);

    // Return response without password
    const userResponse = newUser.toObject();
    delete userResponse.password;

    res.status(201).json({
      success: true,
      message: 'User registered successfully',
      token,
      user: userResponse,
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({
      success: false,
      message: 'Error registering user',
      error: error.message,
    });
  }
};

// LOGIN USER
exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;

    // Validation
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Please provide both email and password',
      });
    }

    // Find user and include password field for comparison
    const user = await User.findOne({ email }).select('+password');

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password',
      });
    }

    // Check if user is blocked
    if (user.isBlocked) {
      return res.status(403).json({
        success: false,
        message: `Account blocked. Reason: ${user.blockReason || 'Security issue'}`,
      });
    }

    // Compare passwords
    const isPasswordValid = await user.comparePassword(password);

    if (!isPasswordValid) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password',
      });
    }

    // Generate token
    const token = generateToken(user._id);

    // Return response without password
    const userResponse = user.toObject();
    delete userResponse.password;

    res.json({
      success: true,
      message: 'Login successful',
      token,
      user: userResponse,
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      success: false,
      message: 'Error during login',
      error: error.message,
    });
  }
};

// GET USER PROFILE
exports.getProfile = async (req, res) => {
  try {
    console.log('📝 getProfile called, user ID:', req.user.id);
    const user = await User.findById(req.user.id).select('-password');

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
    console.error('Get profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching profile',
      error: error.message,
    });
  }
};

// UPDATE USER PROFILE
exports.updateProfile = async (req, res) => {
  try {
    const { firstName, lastName, phone, userType, profileImage, vehicle, vehicleNumber, vehicleColor, licenseNumber } = req.body;

    console.log('📝 updateProfile called');
    console.log('🔐 req.user:', req.user);
    console.log('📦 Update data:', { firstName, lastName, phone, userType, profileImage, vehicle, vehicleNumber, vehicleColor, licenseNumber });

    const updateData = {};
    if (firstName) updateData.firstName = firstName;
    if (lastName) updateData.lastName = lastName;
    if (phone) updateData.phone = phone;
    if (userType) updateData.userType = userType;
    if (profileImage) updateData.profileImage = profileImage;
    if (vehicle) updateData.vehicle = vehicle;
    if (vehicleNumber) updateData.vehicleNumber = vehicleNumber;
    if (vehicleColor) updateData.vehicleColor = vehicleColor;
    if (licenseNumber) updateData.licenseNumber = licenseNumber;

    updateData.updatedAt = new Date();

    console.log('🔍 Looking for user with ID:', req.user.id);

    const userId = req.user.id;

    const user = await User.findByIdAndUpdate(
      userId,
      updateData,
      { new: true, runValidators: true }
    ).select('-password');

    console.log('✅ User found:', !!user);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found',
      });
    }

    res.json({
      success: true,
      message: 'Profile updated successfully',
      user,
    });
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating profile',
      error: error.message,
    });
  }
};

// VERIFY PHONE NUMBER (Placeholder for Phase 2.5)
exports.verifyPhone = async (req, res) => {
  try {
    const { otp } = req.body;

    if (!otp) {
      return res.status(400).json({
        success: false,
        message: 'OTP is required',
      });
    }

    // TODO: Implement OTP verification logic with Twilio
    // For now, just mark as verified

    const user = await User.findByIdAndUpdate(
      req.user.id,
      { phoneVerified: true },
      { new: true }
    ).select('-password');

    res.json({
      success: true,
      message: 'Phone verified successfully',
      user,
    });
  } catch (error) {
    console.error('Verify phone error:', error);
    res.status(500).json({
      success: false,
      message: 'Error verifying phone',
      error: error.message,
    });
  }
};

// VERIFY ID DOCUMENT (Placeholder for Phase 2.5)
exports.verifyID = async (req, res) => {
  try {
    const { idDocument } = req.body;

    if (!idDocument) {
      return res.status(400).json({
        success: false,
        message: 'ID document is required',
      });
    }

    // TODO: Implement ID verification with document upload and verification service

    const user = await User.findByIdAndUpdate(
      req.user.id,
      { idDocument, idVerified: true },
      { new: true }
    ).select('-password');

    res.json({
      success: true,
      message: 'ID verified successfully',
      user,
    });
  } catch (error) {
    console.error('Verify ID error:', error);
    res.status(500).json({
      success: false,
      message: 'Error verifying ID',
      error: error.message,
    });
  }
};

// UPDATE LOCATION
exports.updateLocation = async (req, res) => {
  try {
    const { latitude, longitude } = req.body;

    if (latitude === undefined || longitude === undefined) {
      return res.status(400).json({
        success: false,
        message: 'Latitude and longitude are required',
      });
    }

    const user = await User.findByIdAndUpdate(
      req.user.id,
      {
        currentLocation: {
          type: 'Point',
          coordinates: [longitude, latitude], // GeoJSON format: [longitude, latitude]
        },
        updatedAt: new Date(),
      },
      { new: true }
    ).select('-password');

    res.json({
      success: true,
      message: 'Location updated successfully',
      user,
    });
  } catch (error) {
    console.error('Update location error:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating location',
      error: error.message,
    });
  }
};

// CHANGE PASSWORD
exports.changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        success: false,
        message: 'Current password and new password are required',
      });
    }

    const user = await User.findById(req.user.id).select('+password');

    // Verify current password
    const isMatch = await user.comparePassword(currentPassword);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: 'Current password is incorrect',
      });
    }

    // Update password
    user.password = newPassword;
    await user.save();

    res.json({
      success: true,
      message: 'Password changed successfully',
    });
  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({
      success: false,
      message: 'Error changing password',
      error: error.message,
    });
  }
};
