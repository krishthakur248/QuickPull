/**
 * admin.trips.controller.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Trip-management endpoints for the admin panel.
 *
 * Routes (all under /api/admin, protected by verifyAdminToken):
 *   GET  /trips                    — paginated list, with status/date/search filters
 *   GET  /trips/:id                — single trip detail with populated driver + riders
 *   PUT  /trips/:id/force-complete — admin marks an active trip as completed
 *   PUT  /trips/:id/force-cancel   — admin cancels an active trip (reason required)
 *
 * Rules enforced here (not just in the UI):
 *   - Only ACTIVE trips can be force-completed or force-cancelled
 *   - A reason is required for force-cancel
 *   - Every action is written to the AdminLog collection
 *   - We never touch fare calculations, ETA, or review logic
 */

const Trip     = require('../models/Trip');
const AdminLog = require('../models/AdminLog');

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/admin/trips
//
// Query params:
//   page      — page number (default 1)
//   limit     — per page, max 50 (default 20)
//   status    — 'active' | 'completed' | 'cancelled'  (empty = all)
//   dateRange — 'today' | 'week' | 'month'            (empty = all time)
//   search    — substring match on tripCode
// ─────────────────────────────────────────────────────────────────────────────
exports.listTrips = async (req, res) => {
  try {
    const page  = Math.max(1, parseInt(req.query.page  || '1',  10));
    const limit = Math.min(50, parseInt(req.query.limit || '20', 10));
    const skip  = (page - 1) * limit;

    const filter = {};

    // ── Status filter ─────────────────────────────────────────────────────
    if (req.query.status && ['active', 'completed', 'cancelled'].includes(req.query.status)) {
      filter.status = req.query.status;
    }

    // ── Date range filter ─────────────────────────────────────────────────
    if (req.query.dateRange) {
      const now   = new Date();
      let   since = null;
      if (req.query.dateRange === 'today') {
        // Start of today in IST (offset +5:30 = 330 minutes)
        since = new Date(now);
        since.setHours(0, 0, 0, 0);
      } else if (req.query.dateRange === 'week') {
        since = new Date(now.getTime() - 7  * 24 * 60 * 60 * 1000);
      } else if (req.query.dateRange === 'month') {
        since = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      }
      if (since) filter.createdAt = { $gte: since };
    }

    // ── Trip code search ──────────────────────────────────────────────────
    if (req.query.search && req.query.search.trim()) {
      filter.tripCode = new RegExp(req.query.search.trim(), 'i');
    }

    // ── Fetch trips with driver name populated ────────────────────────────
    const [trips, total] = await Promise.all([
      Trip.find(filter)
        .select('tripCode driver status vehicle startTime endTime riders occupiedSeats availableSeats totalFare createdAt')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('driver', 'firstName lastName'),   // just the name for the list
      Trip.countDocuments(filter),
    ]);

    return res.json({
      success: true,
      total,
      page,
      pages: Math.ceil(total / limit),
      trips,
    });

  } catch (err) {
    console.error('[ADMIN TRIPS] listTrips error:', err.message);
    return res.status(500).json({ success: false, message: 'Server error fetching trips.' });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/admin/trips/:id
//
// Returns the full trip document with driver and each rider's User data
// populated so the admin can see names, phones, and statuses.
// ─────────────────────────────────────────────────────────────────────────────
exports.getTripDetail = async (req, res) => {
  try {
    const trip = await Trip.findById(req.params.id)
      .populate('driver', 'firstName lastName phone email rating')
      .populate('riders.riderId', 'firstName lastName phone email');

    if (!trip) {
      return res.status(404).json({ success: false, message: 'Trip not found.' });
    }

    return res.json({ success: true, trip });

  } catch (err) {
    console.error('[ADMIN TRIPS] getTripDetail error:', err.message);
    return res.status(500).json({ success: false, message: 'Server error fetching trip detail.' });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/admin/trips/:id/force-complete
//
// Marks an ACTIVE trip as completed. Sets endTime to now.
// Also marks all riders that are still 'ongoing' as 'completed'.
// Does NOT recalculate fares or trigger reviews — that is the normal flow.
// ─────────────────────────────────────────────────────────────────────────────
exports.forceComplete = async (req, res) => {
  try {
    const trip = await Trip.findById(req.params.id);
    if (!trip) {
      return res.status(404).json({ success: false, message: 'Trip not found.' });
    }

    // Guard: only active trips can be force-completed
    if (trip.status !== 'active') {
      return res.status(400).json({
        success: false,
        message: `Cannot force-complete a trip that is already "${trip.status}".`,
      });
    }

    const now = new Date();

    // Mark all ongoing riders as completed
    trip.riders.forEach((r) => {
      if (['matched', 'confirmed', 'ongoing'].includes(r.status)) {
        r.status = 'completed';
      }
    });

    // Mark the trip itself as completed
    trip.status  = 'completed';
    trip.endTime = now;

    await trip.save();

    // ── Audit log ─────────────────────────────────────────────────────────
    await AdminLog.create({
      adminId:    req.admin.id,
      action:     'FORCE_COMPLETE_TRIP',
      targetType: 'trip',
      targetId:   trip._id,
      details: {
        tripCode:   trip.tripCode,
        riderCount: trip.riders.length,
        completedAt: now,
      },
      ip: req.ip,
    });

    return res.json({
      success: true,
      message: `Trip ${trip.tripCode} marked as completed.`,
    });

  } catch (err) {
    console.error('[ADMIN TRIPS] forceComplete error:', err.message);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/admin/trips/:id/force-cancel
//
// Body: { reason: string (required) }
//
// Cancels an ACTIVE trip. A reason is mandatory.
// Also marks all active riders as 'cancelled'.
// Does NOT trigger any payment or review logic.
// ─────────────────────────────────────────────────────────────────────────────
exports.forceCancel = async (req, res) => {
  try {
    const { reason } = req.body;

    if (!reason?.trim()) {
      return res.status(400).json({ success: false, message: 'A reason is required for force-cancel.' });
    }

    const trip = await Trip.findById(req.params.id);
    if (!trip) {
      return res.status(404).json({ success: false, message: 'Trip not found.' });
    }

    // Guard: only active trips can be cancelled
    if (trip.status !== 'active') {
      return res.status(400).json({
        success: false,
        message: `Cannot force-cancel a trip that is already "${trip.status}".`,
      });
    }

    // Mark all pending riders as cancelled
    trip.riders.forEach((r) => {
      if (['matched', 'confirmed', 'ongoing'].includes(r.status)) {
        r.status = 'cancelled';
      }
    });

    trip.status = 'cancelled';

    await trip.save();

    // ── Audit log ─────────────────────────────────────────────────────────
    await AdminLog.create({
      adminId:    req.admin.id,
      action:     'FORCE_CANCEL_TRIP',
      targetType: 'trip',
      targetId:   trip._id,
      details: {
        tripCode:   trip.tripCode,
        reason:     reason.trim(),
        riderCount: trip.riders.length,
      },
      ip: req.ip,
    });

    return res.json({
      success: true,
      message: `Trip ${trip.tripCode} has been cancelled.`,
    });

  } catch (err) {
    console.error('[ADMIN TRIPS] forceCancel error:', err.message);
    return res.status(500).json({ success: false, message: 'Server error.' });
  }
};
