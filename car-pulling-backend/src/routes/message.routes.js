const express = require('express');
const router = express.Router();
const messageController = require('../controllers/message.controller');
const { verifyToken, requireActiveUser } = require('../middleware/auth');

// All message routes require: (1) a valid JWT, and (2) an active, non-blocked account.
router.use(verifyToken, requireActiveUser);

// Send a message
router.post('/send', messageController.sendMessage);

// Get all messages for a trip
router.get('/trip/:tripId', messageController.getMessages);

// Get unread message count for a trip
router.get('/unread/:tripId', messageController.getUnreadCount);

// Mark messages as read
router.put('/mark-read/:tripId', messageController.markAsRead);

module.exports = router;
