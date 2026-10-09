/**
 * Bayesian Rating Configuration
 *
 * Driver scores are shown out-of-10 using Bayesian smoothing so that a single
 * 5-star review does NOT instantly show a perfect 10.
 *
 * Formula:
 *   avg5   = ratingSum / ratingCount
 *   score10 = ((C * PRIOR10) + (ratingSum * 2)) / (C + ratingCount)
 *
 * Tweak C and PRIOR10 here — no other file needs to change.
 */

/** Confidence weight — acts like C "virtual" prior reviews */
const BAYESIAN_C = 5;

/** Prior score out of 10 — new drivers start near this value */
const BAYESIAN_PRIOR10 = 7.0;

/**
 * Compute the Bayesian-smoothed driver score out of 10.
 * @param {number} ratingSum   – sum of all 1-5 star ratings
 * @param {number} ratingCount – total number of ratings
 * @returns {string|null} "8.6" formatted string, or null when no reviews
 */
function computeScore10(ratingSum, ratingCount) {
  if (!ratingCount || ratingCount === 0) return null;
  const score = ((BAYESIAN_C * BAYESIAN_PRIOR10) + (ratingSum * 2)) / (BAYESIAN_C + ratingCount);
  return score.toFixed(1);
}

module.exports = { BAYESIAN_C, BAYESIAN_PRIOR10, computeScore10 };
