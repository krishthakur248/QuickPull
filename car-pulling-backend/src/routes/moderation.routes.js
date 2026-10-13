/**
 * moderation.routes.js  –  Admin-only routes for chat moderation review.
 *
 * All routes require:
 *   1. verifyToken  – must be a logged-in user
 *   2. verifyAdmin  – the user's isAdmin flag must be true (see middleware below)
 *
 * Base path (registered in server.js): /api/moderation
 */

const express = require('express');
const router  = express.Router();
const moderationController = require('../controllers/moderation.controller');
const { verifyToken } = require('../middleware/auth');

/**
 * Admin check middleware (async – looks up isAdmin from the database).
 *
 * The JWT only carries { id }, so we fetch the user from MongoDB to check
 * the isAdmin flag.  This means revoking admin takes effect immediately
 * without waiting for the token to expire.
 *
 * To grant yourself admin access, run in MongoDB Atlas / Compass shell:
 *   db.users.updateOne({ email: "your@email.com" }, { $set: { isAdmin: true } })
 */
const User = require('../models/User');

const verifyAdmin = async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id).select('isAdmin');
    if (!user || !user.isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Admin access required',
      });
    }
    next();
  } catch (err) {
    console.error('[MODERATION] verifyAdmin error:', err.message);
    res.status(500).json({ success: false, message: 'Error checking admin status' });
  }
};


// All routes below need a valid JWT AND admin flag
router.use(verifyToken);
router.use(verifyAdmin);

// GET  /api/moderation/flags           – list flags (pending by default)
router.get('/flags', moderationController.listFlags);

// PUT  /api/moderation/flags/:id/review – mark one flag as reviewed
router.put('/flags/:id/review', moderationController.reviewFlag);

module.exports = router;
