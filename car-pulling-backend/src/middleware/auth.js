const jwt  = require('jsonwebtoken');
const User = require('../models/User');

const verifyToken = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];

  console.log('🔐 Auth Middleware: Checking token');
  console.log('📋 Authorization header:', req.headers.authorization ? 'Present' : 'Missing');

  if (!token) {
    console.warn('⚠️ No token provided');
    return res.status(401).json({
      success: false,
      message: "No token provided. Please login first.",
    });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    console.log('✅ Token verified, user ID:', decoded.id || decoded.userId);
    next();
  } catch (error) {
    console.error("❌ Token verification error:", error.message);
    return res.status(401).json({
      success: false,
      message: "Invalid or expired token. Please login again.",
    });
  }
};

const verifyTokenOptional = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];

  if (token) {
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      req.user = decoded;
    } catch (error) {
      // Token invalid but optional, continue
    }
  }

  next();
};

/**
 * requireActiveUser — use AFTER verifyToken on trip and message routes.
 *
 * verifyToken only checks the JWT signature. It does NOT re-read the database.
 * That means a blocked user keeps their 7-day token and can still call the API.
 *
 * This middleware does one fast database lookup to check:
 *   - isBlocked  → 403 if true (blocking now takes effect immediately)
 *   - isActive   → 403 if false
 *
 * We only add this to trip and message routes — not to auth routes — so a
 * blocked user can still call /api/auth/login and see the "blocked" message.
 */
const requireActiveUser = async (req, res, next) => {
  try {
    // req.user.id is set by verifyToken which must run before this middleware
    const user = await User.findById(req.user.id).select('isBlocked isActive blockReason');

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    if (!user.isActive) {
      return res.status(403).json({ success: false, message: 'Account is inactive.' });
    }

    if (user.isBlocked) {
      return res.status(403).json({
        success: false,
        message: `Account blocked. Reason: ${user.blockReason || 'Contact support.'}`,
      });
    }

    next();
  } catch (err) {
    console.error('[AUTH] requireActiveUser error:', err.message);
    return res.status(500).json({ success: false, message: 'Authorization error.' });
  }
};

module.exports = { verifyToken, verifyTokenOptional, requireActiveUser };
