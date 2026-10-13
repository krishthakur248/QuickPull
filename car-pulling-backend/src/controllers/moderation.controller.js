/**
 * moderation.controller.js  –  Admin endpoints for reviewing flagged messages.
 *
 * These routes are protected by verifyToken + verifyAdmin middleware.
 * Normal users will get a 403 if they try to access them.
 *
 * Endpoints (all prefixed with /api/moderation):
 *   GET  /flags           – list pending flags (newest first), paginated
 *   PUT  /flags/:id/review – mark a flag as reviewed with an optional note
 */

const ModerationFlag = require('../models/ModerationFlag');

/**
 * GET /api/moderation/flags
 *
 * Query params:
 *   status  – "pending_review" | "reviewed" | "all"  (default: "pending_review")
 *   page    – page number (default: 1)
 *   limit   – results per page (default: 20, max: 100)
 */
exports.listFlags = async (req, res) => {
  try {
    const status = req.query.status || 'pending_review';
    const page   = Math.max(1, parseInt(req.query.page  || '1',  10));
    const limit  = Math.min(100, parseInt(req.query.limit || '20', 10));
    const skip   = (page - 1) * limit;

    // Build query filter
    const filter = status === 'all' ? {} : { status };

    const [flags, total] = await Promise.all([
      ModerationFlag.find(filter)
        .sort({ createdAt: -1 })   // newest first
        .skip(skip)
        .limit(limit)
        .populate('senderId', 'firstName lastName email phone')
        .populate('tripId',   'origin destination')
        .populate('reviewedBy', 'firstName lastName'),
      ModerationFlag.countDocuments(filter),
    ]);

    res.status(200).json({
      success: true,
      total,
      page,
      pages: Math.ceil(total / limit),
      flags,
    });
  } catch (err) {
    console.error('[MODERATION] listFlags error:', err);
    res.status(500).json({ success: false, message: 'Error fetching flags', error: err.message });
  }
};

/**
 * PUT /api/moderation/flags/:id/review
 *
 * Body (optional):
 *   { "adminNote": "Reviewed – slang, not a real threat" }
 *
 * Marks the flag as "reviewed" and records who reviewed it.
 */
exports.reviewFlag = async (req, res) => {
  try {
    const { id } = req.params;
    const adminNote = req.body.adminNote || null;

    const flag = await ModerationFlag.findById(id);
    if (!flag) {
      return res.status(404).json({ success: false, message: 'Flag not found' });
    }

    flag.status     = 'reviewed';
    flag.reviewedBy = req.user.id;   // from verifyToken middleware
    flag.reviewedAt = new Date();
    flag.adminNote  = adminNote;

    await flag.save();

    res.status(200).json({
      success: true,
      message: 'Flag marked as reviewed',
      flag,
    });
  } catch (err) {
    console.error('[MODERATION] reviewFlag error:', err);
    res.status(500).json({ success: false, message: 'Error reviewing flag', error: err.message });
  }
};
