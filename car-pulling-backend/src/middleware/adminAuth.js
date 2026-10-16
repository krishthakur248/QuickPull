const jwt = require('jsonwebtoken');
const User = require('../models/User');

/**
 * verifyAdminToken — middleware for all /api/admin/* protected routes.
 *
 * It does TWO checks on every request (not just at login):
 *
 *   1. JWT check: the token must be signed with ADMIN_JWT_SECRET and must
 *      carry the claim { type: 'admin' }. A normal user token (signed with
 *      JWT_SECRET) will fail here even if the secrets happen to be the same,
 *      because normal tokens do not carry the type claim.
 *
 *   2. Live database check: we fetch the user from MongoDB to confirm that:
 *      - The account still exists
 *      - isAdmin is still true (revoking admin takes effect immediately)
 *      - isBlocked is false
 *      - isActive is true
 *
 * Why the DB check? If we only trusted the JWT, a blocked admin could keep
 * using their token for up to 2 hours after being blocked.
 *
 * Returns:
 *   401  — token missing, malformed, signed with wrong secret, or expired
 *   403  — token is valid but the user is not admin, is blocked, or is inactive
 */
const verifyAdminToken = async (req, res, next) => {
  // Step 1: Extract the token from the Authorization header
  const token = req.headers.authorization?.split(' ')[1];

  if (!token) {
    return res.status(401).json({
      success: false,
      message: 'No admin token provided.',
    });
  }

  // Step 2: Verify the JWT signature using the SEPARATE admin secret
  let decoded;
  try {
    decoded = jwt.verify(token, process.env.ADMIN_JWT_SECRET);
  } catch (err) {
    // Covers: wrong secret, expired token, malformed token
    return res.status(401).json({
      success: false,
      message: 'Invalid or expired admin token.',
    });
  }

  // Step 3: Check the 'type' claim — admin tokens must carry { type: 'admin' }.
  // This ensures a normal user token can never open an admin route, even if
  // the secrets were misconfigured to be the same.
  if (decoded.type !== 'admin') {
    return res.status(403).json({
      success: false,
      message: 'Forbidden.',
    });
  }

  // Step 4: Live database lookup — do not trust the token alone
  try {
    const user = await User.findById(decoded.id).select('isAdmin isBlocked isActive');

    if (!user) {
      return res.status(403).json({ success: false, message: 'Forbidden.' });
    }

    if (!user.isAdmin) {
      return res.status(403).json({ success: false, message: 'Forbidden.' });
    }

    if (user.isBlocked) {
      return res.status(403).json({ success: false, message: 'Admin account is blocked.' });
    }

    if (!user.isActive) {
      return res.status(403).json({ success: false, message: 'Admin account is inactive.' });
    }

    // All checks passed. Attach the decoded token payload to req.admin
    // so controllers can read the admin's ID without another DB call.
    req.admin = decoded; // { id, type, iat, exp }
    next();
  } catch (err) {
    console.error('[ADMIN AUTH] Database check failed:', err.message);
    return res.status(500).json({ success: false, message: 'Authentication error.' });
  }
};

module.exports = { verifyAdminToken };
