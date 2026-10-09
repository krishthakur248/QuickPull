const express = require('express');
const router  = express.Router();
const reviewController = require('../controllers/review.controller');
const { verifyToken } = require('../middleware/auth');

// All review routes require authentication
router.use(verifyToken);

// GET pending reviews for the current user
router.get('/pending', reviewController.getPendingReviews);

// POST submit a review
router.post('/submit', reviewController.submitReview);

// POST skip (dismiss) a review
router.post('/skip', reviewController.skipReview);

module.exports = router;
