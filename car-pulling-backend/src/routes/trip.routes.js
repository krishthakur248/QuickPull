const express = require('express');
const router = express.Router();
const tripController = require('../controllers/trip.controller');
const { verifyToken, requireActiveUser } = require('../middleware/auth');

// All trip routes require: (1) a valid JWT, and (2) an active, non-blocked account.
// requireActiveUser does a fast DB lookup — this fixes the Phase 0 finding that
// a blocked user could keep using their 7-day token after being blocked.
router.use(verifyToken, requireActiveUser);

// TEST: Simple endpoint to verify matching is working
router.get('/test/check-trips', tripController.getAllTrips);

// Debug: Get all active trips
router.get('/debug/active-trips', tripController.getAllTrips);

// Specific routes first (before parameter routes)
// Get all trips created by driver
router.get('/driver/my-trips', tripController.getDriverTrips);

// Get all trips rider has joined
router.get('/rider/my-trips', tripController.getRiderTrips);

// Post routes
// Start a new trip (driver creates ride offer)
router.post('/start-trip', tripController.startTrip);

// Find matching trips (rider searches)
router.post('/find-matches', tripController.findMatches);

// Join a trip (rider requests to join)
router.post('/join-trip', tripController.joinTrip);

// Respond to rider request (driver accepts/rejects)
router.post('/respond-rider', tripController.respondToRider);

// Complete a trip (driver finishes)
router.post('/complete-trip', tripController.completeTrip);

// Delete routes
// Cancel rider request (rider cancels their join request)
router.delete('/:tripId/cancel-rider', tripController.cancelRiderRequest);

// Parameter routes last
// Get trip details
router.get('/:tripId', tripController.getTripDetails);

module.exports = router;
