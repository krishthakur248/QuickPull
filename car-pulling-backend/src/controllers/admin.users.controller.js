/**
 * admin.users.controller.js
 * ─────────────────────────────────────────────────────────────────────────────
 * All user-management endpoints for the admin panel.
 *
 * Routes (all under /api/admin, protected by verifyAdminToken):
 *   GET  /users            — paginated list with search and filters
 *   GET  /users/:id        — single user detail with flag count and recent trips
 *   PUT  /users/:id/verify — toggle idVerified or phoneVerified
 *   PUT  /users/:id/block  — block or unblock a user
 *
 * Rules enforced here (not just in the UI):
 *   - Password is never returned
 *   - Admin accounts are never visible or editable through these endpoints
 *   - An admin cannot block themselves or another admin
 */

const User           = require('../models/User');
const Trip           = require('../models/Trip');
const ModerationFlag = require('../models/ModerationFlag');
const AdminLog       = require('../models/AdminLog');

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/admin/users
//
// Query params:
//   page        — page number (default 1)
//   limit       — per page, max 50 (default 20)
//   search      — substring match on firstName, lastName, email, phone
//   userType    — 'driver' | 'rider' | 'both'
//   idVerified  — 'true' | 'false'
//   phoneVerified — 'true' | 'false'
//   blocked     — 'true' | 'false'
//   simulation  — 'true' | 'false' | '' (empty = include all)
// ─────────────────────────────────────────────────────────────────────────────
exports.listUsers = async (req, res) => {
  try {
    const page  = Math.max(1, parseInt(req.query.page  || '1',  10));
    const limit = Math.min(50, parseInt(req.query.limit || '20', 10));
    const skip  = (page - 1) * limit;

    // Build the MongoDB filter object from query params
    const filter = {};

    // Always hide admin accounts from this list
    filter.isAdmin = { $ne: true };

    // ── Text search across name, email, phone ─────────────────────────────
    if (req.query.search && req.query.search.trim()) {
      const re = new RegExp(req.query.search.trim(), 'i');
      filter.$or = [
        { firstName: re },
        { lastName:  re },
        { email:     re },
        { phone:     re },
      ];
    }

    // ── Dropdown filters ──────────────────────────────────────────────────
    if (req.query.userType && ['driver', 'rider', 'both'].includes(req.query.userType)) {
      filter.userType = req.query.userType;
    }

    if (req.query.idVerified !== undefined && req.query.idVerified !== '') {
      filter.idVerified = req.query.idVerified === 'true';
    }

    if (req.query.phoneVerified !== undefined && req.query.phoneVerified !== '') {
      filter.phoneVerified = req.query.phoneVerified === 'true';
    }

    if (req.query.blocked !== undefined && req.query.blocked !== '') {
      filter.isBlocked = req.query.blocked === 'true';
    }

    if (req.query.simulation !== undefined && req.query.simulation !== '') {
      filter.isSimulation = req.query.simulation === 'true';
    }

    // ── Fetch users + total count in parallel ─────────────────────────────
    const [users, total] = await Promise.all([
      User.find(filter)
        .select('-password')           // NEVER return password hash
        .sort({ createdAt: -1 })       // newest first
        .skip(skip)
        .limit(limit),
      User.countDocuments(filter),
    ]);

    // ── Attach flag counts from chat moderation ───────────────────────────
    // We do one aggregation query for ALL users on this page at once,
    // so we don't do N individual queries.
    const userIds = users.map((u) => u._id);
    const flagAgg = await ModerationFlag.aggregate([
      { $match: { senderId: { $in: userIds } } },
      { $group: { _id: '$senderId', count: { $sum: 1 } } },
    ]);

    // Build userId → flagCount map
    const flagMap = {};
    flagAgg.forEach((f) => { flagMap[f._id.toString()] = f.count; });

    // Merge flag counts into user objects
    const usersWithFlags = users.map((u) => ({
      ...u.toObject(),
      flagCount: flagMap[u._id.toString()] || 0,
    }));

    return res.json({
      success: true,
      total,
      page,
      pages: Math.ceil(total / limit),
      users: usersWithFlags,
    });

  } catch (err) {
    console.error('[ADMIN USERS] listUsers error:', err.message);
    return res.status(500).json({ success: false, message: 'Server error fetching users.' });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/admin/users/:id
//
// Returns full user profile (no password), recent trips as driver and rider,
// and the total count of chat moderation flags for this user.
// ─────────────────────────────────────────────────────────────────────────────
exports.getUserDetail = async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select('-password');

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    // Admin accounts must not be exposed through user management
    if (user.isAdmin) {
      return res.status(403).json({ success: false, message: 'Cannot view admin accounts.' });
    }

    // ── Recent trips: last 5 as driver ────────────────────────────────────
    const recentAsDriver = await Trip.find({ driver: user._id })
      .sort({ createdAt: -1 })
      .limit(5)
      .select('tripCode status startTime vehicle totalFare riders');

    // ── Recent trips: last 5 as rider ─────────────────────────────────────
    const recentAsRider = await Trip.find({ 'riders.riderId': user._id })
      .sort({ createdAt: -1 })
      .limit(5)
      .select('tripCode status startTime vehicle driver')
      .populate('driver', 'firstName lastName');

    // ── Total chat moderation flags for this user ─────────────────────────
    const flagCount = await ModerationFlag.countDocuments({ senderId: user._id });

    return res.json({
      success: true,
      user,
      recentAsDriver,
      recentAsRider,
      flagCount,
    });

  } catch (err) {
    console.error('[ADMIN USERS] getUserDetail error:', err.message);
    return res.status(500).json({ success: false, message: 'Server error fetching user detail.' });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/admin/users/:id/verify
//
// Body: { field: 'id' | 'phone', action: 'verify' | 'unverify' }
//
// Toggles idVerified or phoneVerified on a user.
// Every change is written to the audit log.
// ─────────────────────────────────────────────────────────────────────────────
exports.verifyUser = async (req, res) => {
  try {
    const { field, action } = req.body;

    // ── Input validation ──────────────────────────────────────────────────
    if (!['id', 'phone'].includes(field)) {
      return res.status(400).json({ success: false, message: 'field must be "id" or "phone".' });
    }
    if (!['verify', 'unverify'].includes(action)) {
      return res.status(400).json({ success: false, message: 'action must be "verify" or "unverify".' });
    }

    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }
    if (user.isAdmin) {
      return res.status(403).json({ success: false, message: 'Cannot modify admin accounts.' });
    }

    // Which field to update, and what value to set
    const fieldName = field === 'id' ? 'idVerified' : 'phoneVerified';
    const newValue  = action === 'verify';

    await User.findByIdAndUpdate(user._id, { [fieldName]: newValue });

    // ── Audit log ─────────────────────────────────────────────────────────
    const logAction = `${action === 'verify' ? 'VERIFY' : 'UNVERIFY'}_${field.toUpperCase()}`;
    await AdminLog.create({
      adminId:    req.admin.id,
      action:     logAction,
      targetType: 'user',
      targetId:   user._id,
      details: {
        field:    fieldName,
        newValue,
        userName: `${user.firstName} ${user.lastName}`,
        email:    user.email,
      },
      ip: req.ip,
    });

    return res.json({
      success: true,
      message: `${fieldName} set to ${newValue} for ${user.firstName} ${user.lastName}.`,
    });

  } catch (err) {
    console.error('[ADMIN USERS] verifyUser error:', err.message);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/admin/users/:id/block
//
// Body: { action: 'block' | 'unblock', reason: string (required for block) }
//
// Sets isBlocked and blockReason on a user.
// Protections: cannot block yourself, cannot block other admins.
// Every change is written to the audit log.
// ─────────────────────────────────────────────────────────────────────────────
exports.blockUser = async (req, res) => {
  try {
    const { action, reason } = req.body;

    // ── Input validation ──────────────────────────────────────────────────
    if (!['block', 'unblock'].includes(action)) {
      return res.status(400).json({ success: false, message: 'action must be "block" or "unblock".' });
    }
    if (action === 'block' && !reason?.trim()) {
      return res.status(400).json({ success: false, message: 'A reason is required when blocking a user.' });
    }

    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found.' });
    }

    // ── Safety guards ─────────────────────────────────────────────────────
    if (user.isAdmin) {
      return res.status(403).json({ success: false, message: 'Cannot block admin accounts.' });
    }
    if (user._id.toString() === req.admin.id.toString()) {
      return res.status(403).json({ success: false, message: 'You cannot block your own account.' });
    }

    // Apply the update
    const update = action === 'block'
      ? { isBlocked: true,  blockReason: reason.trim() }
      : { isBlocked: false, blockReason: null };

    await User.findByIdAndUpdate(user._id, update);

    // ── Audit log ─────────────────────────────────────────────────────────
    await AdminLog.create({
      adminId:    req.admin.id,
      action:     action === 'block' ? 'BLOCK_USER' : 'UNBLOCK_USER',
      targetType: 'user',
      targetId:   user._id,
      details: {
        userName: `${user.firstName} ${user.lastName}`,
        email:    user.email,
        reason:   action === 'block' ? reason.trim() : null,
      },
      ip: req.ip,
    });

    return res.json({
      success: true,
      message: `User ${action}ed successfully.`,
    });

  } catch (err) {
    console.error('[ADMIN USERS] blockUser error:', err.message);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};
