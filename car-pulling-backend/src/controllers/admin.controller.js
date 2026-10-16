const jwt       = require('jsonwebtoken');
const bcrypt     = require('bcryptjs');
const mongoose   = require('mongoose');
const User       = require('../models/User');
const AdminLog   = require('../models/AdminLog');

// ─────────────────────────────────────────────────────────────────────────────
// In-memory rate limiter for the admin login endpoint.
//
// We store each IP in a Map: ip → { count: number, lockedUntil: number|null }
// This resets when the server restarts. That is acceptable for a demo / low-
// traffic deployment where express-rate-limit is not installed.
//
// Settings are read from environment variables so you can tune them without
// touching this file:
//   ADMIN_LOGIN_MAX_ATTEMPTS  (default: 5)
//   ADMIN_LOGIN_LOCKOUT_MS    (default: 300000 — 5 minutes)
// ─────────────────────────────────────────────────────────────────────────────
const loginAttempts = new Map();

/** Returns { limited: false } or { limited: true, secondsLeft: N } */
function checkRateLimit(ip) {
  const maxAttempts = parseInt(process.env.ADMIN_LOGIN_MAX_ATTEMPTS, 10) || 5;
  const lockoutMs   = parseInt(process.env.ADMIN_LOGIN_LOCKOUT_MS,   10) || 5 * 60 * 1000;

  const record = loginAttempts.get(ip);
  if (!record) return { limited: false };

  // If locked but the lockout period has expired, clear the record
  if (record.lockedUntil && Date.now() >= record.lockedUntil) {
    loginAttempts.delete(ip);
    return { limited: false };
  }

  // Still locked
  if (record.lockedUntil) {
    const secondsLeft = Math.ceil((record.lockedUntil - Date.now()) / 1000);
    return { limited: true, secondsLeft };
  }

  return { limited: false };
}

/** Increment the failed-attempt counter for this IP and lock if limit reached */
function recordFailedAttempt(ip) {
  const maxAttempts = parseInt(process.env.ADMIN_LOGIN_MAX_ATTEMPTS, 10) || 5;
  const lockoutMs   = parseInt(process.env.ADMIN_LOGIN_LOCKOUT_MS,   10) || 5 * 60 * 1000;

  const record = loginAttempts.get(ip) || { count: 0, lockedUntil: null };
  record.count += 1;

  if (record.count >= maxAttempts) {
    record.lockedUntil = Date.now() + lockoutMs;
    const minutes = Math.round(lockoutMs / 60000);
    console.warn(`[ADMIN] IP ${ip} locked out for ${minutes} min after ${record.count} failed attempts`);
  }

  loginAttempts.set(ip, record);
}

/** Clear the counter on successful login */
function clearFailedAttempts(ip) {
  loginAttempts.delete(ip);
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/admin/login
//
// Accepts ONLY admin accounts (isAdmin === true).
// Every failure — wrong email, wrong password, not admin, blocked, inactive —
// returns the SAME generic message so an attacker cannot enumerate accounts.
// ─────────────────────────────────────────────────────────────────────────────
exports.adminLogin = async (req, res) => {
  // Get the caller's IP for rate-limiting and audit logging
  const ip = req.ip || req.connection?.remoteAddress || 'unknown';

  // ── Rate limit check ──────────────────────────────────────────────────────
  const { limited, secondsLeft } = checkRateLimit(ip);
  if (limited) {
    return res.status(429).json({
      success: false,
      message: `Too many failed attempts. Try again in ${secondsLeft} seconds.`,
    });
  }

  const { email, password } = req.body;

  // ── Basic input validation ────────────────────────────────────────────────
  // Treat missing fields as a failure (same generic error) to avoid
  // leaking which field is wrong.
  if (!email || !password) {
    recordFailedAttempt(ip);
    return res.status(401).json({ success: false, message: 'Invalid credentials.' });
  }

  try {
    // ── Database lookup ───────────────────────────────────────────────────
    // We explicitly select the password hash (normally hidden by schema)
    // so we can compare it with bcrypt.
    const user = await User.findOne({ email: email.toLowerCase().trim() }).select('+password');

    // ── Centralised failure handler ───────────────────────────────────────
    // Every bad outcome returns the same 401 message and logs the failure.
    // 'reason' goes into the audit log only — the caller never sees it.
    const fail = async (reason) => {
      recordFailedAttempt(ip);

      // Write to the audit log (non-fatal: a logging failure must not block the response)
      AdminLog.create({
        adminId: user?._id || null,   // null if no user found at all
        action:  'LOGIN_FAILED',
        details: { attemptedEmail: email, reason },
        ip,
      }).catch((err) => console.error('[ADMIN LOG] Could not write LOGIN_FAILED:', err.message));

      return res.status(401).json({ success: false, message: 'Invalid credentials.' });
    };

    // Check each condition in order — all failures look the same to the caller
    if (!user)            return fail('user_not_found');
    if (!user.isAdmin)    return fail('not_admin');
    if (user.isBlocked)   return fail('account_blocked');
    if (!user.isActive)   return fail('account_inactive');

    // ── Password comparison ───────────────────────────────────────────────
    const passwordOk = await bcrypt.compare(password, user.password);
    if (!passwordOk) return fail('wrong_password');

    // ── All checks passed — issue an admin JWT ────────────────────────────
    clearFailedAttempts(ip);

    const expiry = process.env.ADMIN_JWT_EXPIRE || '2h';

    // The { type: 'admin' } claim makes admin tokens distinguishable from
    // normal user tokens. The adminAuth middleware checks this claim.
    // We also use a SEPARATE secret (ADMIN_JWT_SECRET) so normal user tokens
    // can never be accepted on admin routes.
    const token = jwt.sign(
      { id: user._id, type: 'admin' },
      process.env.ADMIN_JWT_SECRET,
      { expiresIn: expiry }
    );

    // ── Audit log: successful login ───────────────────────────────────────
    await AdminLog.create({
      adminId: user._id,
      action:  'LOGIN_SUCCESS',
      details: { email: user.email },
      ip,
    });

    // Never return the password hash
    return res.json({
      success: true,
      message: 'Admin login successful.',
      token,
      admin: {
        id:        user._id,
        firstName: user.firstName,
        lastName:  user.lastName,
        email:     user.email,
      },
    });

  } catch (error) {
    console.error('[ADMIN LOGIN] Unexpected error:', error.message);
    return res.status(500).json({ success: false, message: 'Server error during login.' });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/admin/logs?page=1&limit=20
//
// Returns the audit log, newest first, paginated.
// Requires a valid admin token (verifyAdminToken middleware applied in routes).
// ─────────────────────────────────────────────────────────────────────────────
exports.getAuditLogs = async (req, res) => {
  try {
    // Parse pagination params with safe defaults and a hard maximum
    const page  = Math.max(1, parseInt(req.query.page  || '1',  10));
    const limit = Math.min(100, parseInt(req.query.limit || '20', 10));
    const skip  = (page - 1) * limit;

    // Optional: filter by action keyword
    const filter = {};
    if (req.query.action) {
      // Case-insensitive substring match on the action field
      filter.action = new RegExp(req.query.action, 'i');
    }

    // Run count and page fetch in parallel for speed
    const [logs, total] = await Promise.all([
      AdminLog.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        // Populate just the admin's name and email — never the password
        .populate('adminId', 'firstName lastName email'),
      AdminLog.countDocuments(filter),
    ]);

    return res.json({
      success: true,
      total,
      page,
      pages: Math.ceil(total / limit),
      logs,
    });

  } catch (error) {
    console.error('[ADMIN LOGS] Error fetching logs:', error.message);
    return res.status(500).json({ success: false, message: 'Server error fetching audit logs.' });
  }
};
