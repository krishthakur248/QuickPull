/**
 * Migration: backfill ratingSum and ratingCount on all existing User documents.
 *
 * Run ONCE after deploying the new schema:
 *   node car-pulling-backend/src/scripts/backfill-ratings.js
 *
 * What it does:
 *  - For every User that has ratingSum == null/undefined (i.e. old documents),
 *    set ratingSum = 0, ratingCount = 0.
 *  - Existing User.rating and User.totalReviews are preserved untouched.
 *  - Idempotent: safe to re-run; documents already having ratingSum are skipped.
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });
const mongoose = require('mongoose');

const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  console.error('❌ MONGODB_URI not set in .env');
  process.exit(1);
}

async function run() {
  await mongoose.connect(MONGODB_URI);
  console.log('✅ Connected to MongoDB');

  const result = await mongoose.connection.collection('users').updateMany(
    // Only touch documents that don't yet have ratingSum
    { ratingSum: { $exists: false } },
    { $set: { ratingSum: 0, ratingCount: 0 } }
  );

  console.log(`✅ Backfill complete. Documents updated: ${result.modifiedCount}`);
  await mongoose.disconnect();
}

run().catch(err => {
  console.error('❌ Backfill failed:', err);
  process.exit(1);
});
