/**
 * admin.routes.js
 *
 * All routes are mounted at /api/admin (registered in server.js).
 *
 * Public  (no token needed):
 *   POST   /api/admin/login    — admin login
 *
 * Protected (requires valid admin token — verifyAdminToken middleware):
 *   GET    /api/admin/logs     — read the audit log
 *
 * More routes will be added here in Phases 2, 3, and 4.
 */

const express          = require('express');
const router           = express.Router();
const adminController      = require('../controllers/admin.controller');
const adminUsersController = require('../controllers/admin.users.controller');
const adminTripsController = require('../controllers/admin.trips.controller');
const { verifyAdminToken } = require('../middleware/adminAuth');

// ── Public route ─────────────────────────────────────────────────────────────
// No authentication required — this IS the authentication endpoint.
router.post('/login', adminController.adminLogin);

// ── Protected routes ─────────────────────────────────────────────────────────
// Every route below this line will first pass through verifyAdminToken,
// which checks the JWT and then re-reads the database to confirm admin status.
router.use(verifyAdminToken);

// Audit log — read all admin actions (newest first, paginated)
router.get('/logs', adminController.getAuditLogs);

// ── Phase 2: User management ─────────────────────────────────────────────────
// List users with search, filters, and pagination
router.get('/users', adminUsersController.listUsers);
// Single user detail (profile, recent trips, flag count)
router.get('/users/:id', adminUsersController.getUserDetail);
// Toggle idVerified or phoneVerified
router.put('/users/:id/verify', adminUsersController.verifyUser);
// Block or unblock a user
router.put('/users/:id/block', adminUsersController.blockUser);

// ── Phase 3: Trip management ──────────────────────────────────────────────────
// List trips with status, date-range, and trip-code filters
router.get('/trips', adminTripsController.listTrips);
// Single trip detail (populated driver + riders)
router.get('/trips/:id', adminTripsController.getTripDetail);
// Force-complete an active trip
router.put('/trips/:id/force-complete', adminTripsController.forceComplete);
// Force-cancel an active trip (reason required)
router.put('/trips/:id/force-cancel', adminTripsController.forceCancel);

module.exports = router;
