const mongoose = require('mongoose');
const Review   = require('../models/Review');
const Trip     = require('../models/Trip');
const User     = require('../models/User');
const { computeScore10 } = require('../config/ratingConfig');

// ─── GET /api/reviews/pending ────────────────────────────────────────────────
// Returns all pending review requests for the current authenticated user.
// A "pending" booking is one where trip.riders[].reviewPending === true
// for the requesting user, and no Review document yet exists for that booking.
exports.getPendingReviews = async (req, res) => {
  try {
    const userId = req.user.id;

    // Skip simulation users entirely
    const user = await User.findById(userId).select('isSimulation firstName lastName');
    if (!user) return res.status(404).json({ success: false, message: 'User not found' });
    if (user.isSimulation) {
      return res.json({ success: true, pending: [] });
    }

    // Find all trips where this rider has a pending review flag
    const trips = await Trip.find({
      'riders': {
        $elemMatch: {
          riderId: userId,
          reviewPending: true
        }
      }
    }).populate('driver', 'firstName lastName profileImage ratingSum ratingCount');

    const pending = [];
    for (const trip of trips) {
      const riderEntry = trip.riders.find(
        r => r.riderId && r.riderId.toString() === userId
      );
      if (!riderEntry || !riderEntry.reviewPending) continue;

      // Double-check no review already exists (idempotency guard)
      const already = await Review.findOne({
        bookingId: trip._id,
        passengerId: userId
      });
      if (already) {
        // Clean up stale flag
        riderEntry.reviewPending = false;
        await trip.save();
        continue;
      }

      const driver = trip.driver;
      const score10 = computeScore10(
        driver ? driver.ratingSum : 0,
        driver ? driver.ratingCount : 0
      );

      pending.push({
        tripId:    trip._id,
        bookingId: trip._id,
        trigger:   riderEntry.reviewTrigger || 'completed',
        driver: driver ? {
          _id:        driver._id,
          firstName:  driver.firstName,
          lastName:   driver.lastName,
          profileImage: driver.profileImage,
          score10,
          ratingCount: driver.ratingCount || 0
        } : null
      });
    }

    return res.json({ success: true, pending });
  } catch (error) {
    console.error('[REVIEW] getPendingReviews error:', error);
    return res.status(500).json({ success: false, message: 'Error fetching pending reviews', error: error.message });
  }
};

// ─── POST /api/reviews/submit ────────────────────────────────────────────────
// Submit a star review for a driver. Atomically increments ratingSum / ratingCount
// on the driver document so we never need a full recompute.
exports.submitReview = async (req, res) => {
  try {
    const passengerId = req.user.id;
    const { bookingId, rating, comment } = req.body;

    // ── Validate input ──────────────────────────────────────────────────────
    if (!bookingId) {
      return res.status(400).json({ success: false, message: 'bookingId is required' });
    }
    if (!rating || !Number.isInteger(Number(rating)) || Number(rating) < 1 || Number(rating) > 5) {
      return res.status(400).json({ success: false, message: 'rating must be an integer 1–5' });
    }
    const safeRating  = Number(rating);
    const safeComment = comment ? String(comment).slice(0, 300).trim() : '';

    // ── Security: passenger must exist and not be a simulation account ──────
    const passenger = await User.findById(passengerId).select('isSimulation');
    if (!passenger) return res.status(404).json({ success: false, message: 'User not found' });
    if (passenger.isSimulation) {
      return res.status(403).json({ success: false, message: 'Simulation users cannot submit reviews' });
    }

    // ── Security: find the trip and verify passenger was on it ──────────────
    const trip = await Trip.findById(bookingId).populate('driver', 'isSimulation');
    if (!trip) return res.status(404).json({ success: false, message: 'Trip not found' });

    const riderEntry = trip.riders.find(
      r => r.riderId && r.riderId.toString() === passengerId
    );
    if (!riderEntry) {
      return res.status(403).json({ success: false, message: 'You were not a passenger on this trip' });
    }

    // ── Security: booking must be in a reviewable state ─────────────────────
    const eligibleStatuses = ['confirmed', 'completed', 'cancelled'];
    if (!eligibleStatuses.includes(riderEntry.status) && !riderEntry.reviewPending) {
      return res.status(400).json({ success: false, message: 'This booking is not eligible for review' });
    }

    // ── Security: driver must not be a simulation account ───────────────────
    const driver = trip.driver;
    if (driver && driver.isSimulation) {
      return res.status(403).json({ success: false, message: 'Cannot review simulation drivers' });
    }

    // ── Security: driver cannot review themselves ────────────────────────────
    if (trip.driver && trip.driver._id && trip.driver._id.toString() === passengerId) {
      return res.status(403).json({ success: false, message: 'Drivers cannot review themselves' });
    }

    const driverId = trip.driver ? trip.driver._id : trip.driver;

    // ── Create review (unique constraint catches duplicates) ─────────────────
    let review;
    try {
      review = await Review.create({
        tripId:      trip._id,
        bookingId:   trip._id,
        driverId,
        passengerId,
        rating:      safeRating,
        comment:     safeComment,
        trigger:     riderEntry.reviewTrigger || 'completed'
      });
    } catch (dupErr) {
      if (dupErr.code === 11000) {
        // Already reviewed — clear the pending flag if still set
        riderEntry.reviewPending = false;
        await trip.save();
        return res.status(409).json({ success: false, message: 'You have already reviewed this trip' });
      }
      throw dupErr;
    }

    // ── Atomically update driver's aggregate rating ──────────────────────────
    // Only update for real (non-simulation) passengers reviewing real drivers.
    await User.findByIdAndUpdate(
      driverId,
      {
        $inc: { ratingSum: safeRating, ratingCount: 1, totalReviews: 1 }
      },
      { new: true }
    );

    // ── Clear pending flag on booking ────────────────────────────────────────
    riderEntry.reviewPending = false;
    await trip.save();

    return res.status(201).json({
      success: true,
      message: 'Review submitted successfully',
      reviewId: review._id
    });
  } catch (error) {
    console.error('[REVIEW] submitReview error:', error);
    return res.status(500).json({ success: false, message: 'Error submitting review', error: error.message });
  }
};

// ─── POST /api/reviews/skip ──────────────────────────────────────────────────
// Passenger dismisses the popup without rating. Clears the pending flag so
// they are NOT nagged again for this booking.
exports.skipReview = async (req, res) => {
  try {
    const passengerId = req.user.id;
    const { bookingId } = req.body;

    if (!bookingId) {
      return res.status(400).json({ success: false, message: 'bookingId is required' });
    }

    const trip = await Trip.findById(bookingId);
    if (!trip) return res.status(404).json({ success: false, message: 'Trip not found' });

    const riderEntry = trip.riders.find(
      r => r.riderId && r.riderId.toString() === passengerId
    );
    if (!riderEntry) {
      return res.status(403).json({ success: false, message: 'You were not a passenger on this trip' });
    }

    riderEntry.reviewPending = false;
    await trip.save();

    return res.json({ success: true, message: 'Review skipped' });
  } catch (error) {
    console.error('[REVIEW] skipReview error:', error);
    return res.status(500).json({ success: false, message: 'Error skipping review', error: error.message });
  }
};
