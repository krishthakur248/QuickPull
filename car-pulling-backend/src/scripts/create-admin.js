#!/usr/bin/env node
/**
 * create-admin.js
 * ───────────────
 * Creates a brand-new admin account OR promotes an existing user to admin.
 *
 * HOW TO RUN (from the car-pulling-backend directory):
 *   node src/scripts/create-admin.js
 *
 * The script will prompt for email, first name, last name, and password
 * interactively in the terminal. No credentials are stored in this file.
 *
 * ALTERNATIVE (non-interactive, useful for one-liners):
 *   Set the ADMIN_SETUP_PASSWORD env var before running:
 *   ADMIN_SETUP_PASSWORD=MySecret123 node src/scripts/create-admin.js
 *   The script will still ask for email and name, but skip the password prompt.
 *
 * REQUIREMENTS:
 *   - MONGODB_URI must be set in .env (the script loads it automatically)
 *   - ADMIN_JWT_SECRET should be set in .env before the admin panel is used
 */

'use strict';

// ── Node 18+ DNS fix ─────────────────────────────────────────────────────────
// Node 18 changed the default DNS lookup order to IPv6-first, which breaks
// MongoDB Atlas SRV record lookups in standalone scripts.
// The live server is fine because it resolves DNS at startup when IPv6 is cached.
// This one line forces IPv4-first lookups so the SRV record resolves correctly.
const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');

// Load .env from the project root (two levels up from src/scripts/)
require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });

const mongoose = require('mongoose');
const readline = require('readline');

// ─── Simple terminal prompt helper ───────────────────────────────────────────
// Opens a readline interface, asks a question, returns the answer, then closes.
// 'hidden' = true for password: the typed characters will not echo.
function ask(question, hidden = false) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input:  process.stdin,
      output: process.stdout,
    });

    if (hidden && process.stdout.isTTY) {
      // On real terminals, suppress echoing so the password is not shown
      process.stdout.write(question);
      let value = '';

      process.stdin.setRawMode(true);
      process.stdin.resume();
      process.stdin.setEncoding('utf8');

      const onData = (char) => {
        if (char === '\r' || char === '\n') {
          // Enter pressed — finish
          process.stdin.setRawMode(false);
          process.stdin.pause();
          process.stdin.removeListener('data', onData);
          process.stdout.write('\n');
          rl.close();
          resolve(value);
        } else if (char === '\u0003') {
          // Ctrl+C — exit cleanly
          process.stdout.write('\n');
          process.exit(0);
        } else if (char === '\u007f') {
          // Backspace — remove last character
          value = value.slice(0, -1);
        } else {
          value += char;
        }
      };

      process.stdin.on('data', onData);
    } else {
      // Non-TTY (piped input) or non-hidden: plain readline
      rl.question(question, (answer) => {
        rl.close();
        resolve(answer.trim());
      });
    }
  });
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  QuickPull — Create / Promote Admin');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  // ── Pre-flight checks ────────────────────────────────────────────────────
  if (!process.env.MONGODB_URI) {
    console.error('❌  MONGODB_URI is not set. Check your .env file.');
    process.exit(1);
  }

  if (!process.env.ADMIN_JWT_SECRET) {
    // Warn but don't block — the DB account can be created now and the secret added later
    console.warn('⚠️   ADMIN_JWT_SECRET is not set in .env.');
    console.warn('    The account will be created, but logins will fail until you add it.\n');
  }

  // ── Collect inputs ───────────────────────────────────────────────────────
  const email     = (await ask('Admin email address : ')).toLowerCase();
  const firstName = await ask('First name          : ');
  const lastName  = await ask('Last name           : ');

  // Password: from env var (CI/CD) or prompted interactively
  let password = process.env.ADMIN_SETUP_PASSWORD || '';
  if (!password) {
    password = await ask('Password (min 8 chars, input hidden): ', true);
  } else {
    console.log('Using password from ADMIN_SETUP_PASSWORD env var.');
  }

  // ── Input validation ─────────────────────────────────────────────────────
  if (!email) {
    console.error('\n❌  Email is required.');
    process.exit(1);
  }

  if (password.length < 8) {
    console.error('\n❌  Password must be at least 8 characters long.');
    process.exit(1);
  }

  // ── Connect to MongoDB ───────────────────────────────────────────────────
  console.log('\n🔌  Connecting to MongoDB...');
  // serverSelectionTimeoutMS: fail fast (10s) instead of hanging for 30s
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
  console.log('✅  Connected.\n');

  // We require User after mongoose connects so the model is ready
  const User = require('../models/User');

  // ── Check if user already exists ─────────────────────────────────────────
  const existingUser = await User.findOne({ email });

  if (existingUser) {
    // ── Promote existing user ─────────────────────────────────────────────
    console.log(`👤  Found existing user: ${existingUser.firstName} ${existingUser.lastName} (${existingUser.email})`);

    if (existingUser.isAdmin) {
      console.log('ℹ️   This user is already an admin. No changes made.');
    } else {
      existingUser.isAdmin = true;
      await existingUser.save();
      console.log('✅  User promoted to admin successfully!');
    }
  } else {
    // ── Create new admin account ──────────────────────────────────────────
    if (!firstName || !lastName) {
      console.error('❌  First name and last name are required when creating a new account.');
      await mongoose.disconnect();
      process.exit(1);
    }

    // The phone field is required by the User schema (unique).
    // Admin accounts are never used in the rider/driver flow, so we use
    // a timestamped placeholder that satisfies the uniqueness constraint.
    const phone = `ADMIN-${Date.now()}`;

    // Create the user. The pre-save hook in User.js will hash the password.
    const newAdmin = new User({
      firstName,
      lastName,
      email,
      phone,
      password,         // hashed by the pre-save hook before storing
      userType: 'both', // required by enum; irrelevant for admin accounts
      isAdmin:      true,
      isSimulation: false,
      isActive:     true,
      isBlocked:    false,
    });

    await newAdmin.save();
    console.log(`✅  Admin account created: ${firstName} ${lastName} (${email})`);
  }

  console.log('\n🎉  Done. You can now log in at the admin panel (/admin/index.html).');
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('\n❌  Script failed:', err.message);
  process.exit(1);
});
