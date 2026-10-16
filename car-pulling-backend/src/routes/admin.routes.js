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
const adminController  = require('../controllers/admin.controller');
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

module.exports = router;
