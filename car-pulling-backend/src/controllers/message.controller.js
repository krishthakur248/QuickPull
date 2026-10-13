const Message = require('../models/Message');
const Trip = require('../models/Trip');
const User = require('../models/User');
// Async moderation helper – called AFTER the message is delivered
const { moderateMessage } = require('../utils/moderation');

// Send a message
exports.sendMessage = async (req, res) => {
    try {
        const senderId = req.user.id;
        const { tripId, recipientId, messageText, messageType = 'text' } = req.body;

        // Validate required fields
        if (!tripId || !recipientId || !messageText) {
            return res.status(400).json({
                success: false,
                message: 'Missing required fields: tripId, recipientId, messageText'
            });
        }

        // Verify trip exists
        const trip = await Trip.findById(tripId);
        if (!trip) {
            return res.status(404).json({
                success: false,
                message: 'Trip not found'
            });
        }

        // Verify user is part of the trip (driver or rider)
        const isDriver = trip.driver.toString() === senderId;
        const isRider = trip.riders.some(r => r.riderId.toString() === senderId);

        if (!isDriver && !isRider) {
            return res.status(403).json({
                success: false,
                message: 'User is not part of this trip'
            });
        }

        // Verify recipient is in the trip
        const recipientIsDriver = trip.driver.toString() === recipientId;
        const recipientIsRider = trip.riders.some(r => r.riderId.toString() === recipientId);

        if (!recipientIsDriver && !recipientIsRider) {
            return res.status(403).json({
                success: false,
                message: 'Recipient is not part of this trip'
            });
        }

        // Create message
        const message = new Message({
            tripId,
            senderId,
            recipientId,
            messageText,
            messageType,
            createdAt: new Date()
        });

        await message.save();

        // Capture the raw senderId string BEFORE populate overwrites it with the User object
        const rawSenderId = message.senderId.toString();

        // Populate sender info
        await message.populate('senderId', 'firstName lastName profileImage');

        // Emit real-time notification via Socket.io
        const io = req.app.get('io');
        if (io) {
            // Notify recipient in real-time
            io.to(`trip_${tripId}_user_${recipientId}`).emit('new-message', {
                success: true,
                message: message,
                tripId: tripId,
                sender: message.senderId
            });

            // Emit notification event
            io.to(`user_${recipientId}`).emit('notification', {
                type: 'new-message',
                tripId: tripId,
                senderId: senderId,
                senderName: `${message.senderId.firstName} ${message.senderId.lastName}`,
                messagePreview: messageText.substring(0, 50),
                timestamp: new Date()
            });
        }

        res.status(201).json({
            success: true,
            message: 'Message sent',
            data: message
        });

        // ── Async moderation (fire-and-forget) ────────────────────────────────
        // We do NOT await this – it must never delay the HTTP response.
        // If the moderation service is down, moderateMessage() fails open
        // (just logs a warning) and chat continues normally.
        moderateMessage({ message, rawSenderId, io }).catch(err => {
            console.error('[MODERATION] Unexpected error in moderateMessage:', err.message);
        });
    } catch (error) {
        console.error('Send message error:', error);
        res.status(500).json({
            success: false,
            message: 'Error sending message',
            error: error.message
        });
    }
};

// Get all messages for a trip
exports.getMessages = async (req, res) => {
    try {
        const userId = req.user.id;
        const { tripId } = req.params;

        // Verify trip exists
        const trip = await Trip.findById(tripId);
        if (!trip) {
            return res.status(404).json({
                success: false,
                message: 'Trip not found'
            });
        }

        // Verify user is part of the trip
        const isDriver = trip.driver.toString() === userId;
        const isRider = trip.riders.some(r => r.riderId.toString() === userId);

        if (!isDriver && !isRider) {
            return res.status(403).json({
                success: false,
                message: 'You are not part of this trip'
            });
        }

        // Get all messages for this trip
        const messages = await Message.find({ tripId })
            .populate('senderId', 'firstName lastName profileImage')
            .populate('recipientId', 'firstName lastName profileImage')
            .sort({ createdAt: 1 });

        // Mark messages as read for current user
        await Message.updateMany(
            { tripId, recipientId: userId, isRead: false },
            { isRead: true, readAt: new Date() }
        );

        res.status(200).json({
            success: true,
            messages: messages
        });
    } catch (error) {
        console.error('Get messages error:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching messages',
            error: error.message
        });
    }
};

// Get unread message count for a trip
exports.getUnreadCount = async (req, res) => {
    try {
        const userId = req.user.id;
        const { tripId } = req.params;

        const unreadCount = await Message.countDocuments({
            tripId,
            recipientId: userId,
            isRead: false
        });

        res.status(200).json({
            success: true,
            unreadCount: unreadCount
        });
    } catch (error) {
        console.error('Get unread count error:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching unread count',
            error: error.message
        });
    }
};

// Mark messages as read
exports.markAsRead = async (req, res) => {
    try {
        const userId = req.user.id;
        const { tripId } = req.params;

        await Message.updateMany(
            { tripId, recipientId: userId, isRead: false },
            { isRead: true, readAt: new Date() }
        );

        res.status(200).json({
            success: true,
            message: 'Messages marked as read'
        });
    } catch (error) {
        console.error('Mark as read error:', error);
        res.status(500).json({
            success: false,
            message: 'Error marking messages as read',
            error: error.message
        });
    }
};
