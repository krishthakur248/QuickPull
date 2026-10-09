require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const express = require('express');
const cors = require('cors');
const connectDB = require('./config/database');
const http = require('http');
const socketIO = require('socket.io');
const jwt = require('jsonwebtoken');

// Initialize Express App
const app = express();
const server = http.createServer(app);
const io = socketIO(server, {
  cors: {
    origin: [
      'http://localhost:3000',
      'http://127.0.0.1:5500',
      'http://localhost:5500',
      'http://127.0.0.1:5501',
      'http://localhost:5501',
      'https://krishthakur248.github.io',
      process.env.CORS_ORIGIN || '*'
    ],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    credentials: true
  },
});

// Connect to MongoDB
connectDB().then(async () => {
  // ── Auto-migration: backfill ratingSum / ratingCount on old User docs ──
  // Uses { $exists: false } filter — idempotent, runs in milliseconds after
  // the first deployment. No Render shell or manual step required.
  try {
    const mongoose = require('mongoose');
    const result = await mongoose.connection.collection('users').updateMany(
      { ratingSum: { $exists: false } },
      { $set: { ratingSum: 0, ratingCount: 0 } }
    );
    if (result.modifiedCount > 0) {
      console.log(`✅ [MIGRATION] Backfilled ratingSum/ratingCount on ${result.modifiedCount} user(s)`);
    }
  } catch (migErr) {
    // Non-fatal — log and continue. Will retry on next restart.
    console.warn('⚠️  [MIGRATION] ratingSum backfill failed (non-fatal):', migErr.message);
  }
});

// Middleware
const corsOptions = {
  origin: [
    'http://localhost:3000',
    'http://127.0.0.1:5500',
    'http://localhost:5500',
    'http://127.0.0.1:5501',
    'http://localhost:5501',
    'https://krishthakur248.github.io',
    process.env.CORS_ORIGIN || '*'
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
};

app.use(cors(corsOptions));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Store io instance globally for use in routes/controllers
app.set('io', io);

// Health Check Route
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    message: 'Car Pulling API is running',
    timestamp: new Date().toISOString(),
  });
});

// Root Route
app.get('/', (req, res) => {
  res.json({
    name: 'Car Pulling Backend API',
    version: '1.0.0',
    description: 'Real-time peer-to-peer ride-sharing system',
    endpoints: {
      health: '/api/health',
      auth: '/api/auth',
      users: '/api/users',
      trips: '/api/trips',
      messages: '/api/messages',
    },
  });
});

// Placeholder Routes (will be filled in later phases)
app.use('/api/auth', require('./routes/auth.routes'));
app.use('/api/users', require('./routes/user.routes'));
app.use('/api/trips', require('./routes/trip.routes'));
app.use('/api/messages', require('./routes/message.routes'));
app.use('/api/reviews', require('./routes/review.routes'));

// Error Handling Middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(err.status || 500).json({
    success: false,
    message: err.message || 'Internal Server Error',
    error: process.env.NODE_ENV === 'development' ? err : {},
  });
});

// 404 Handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: 'Route not found',
  });
});

// WebSocket Connection
io.on('connection', (socket) => {
  console.log(`✅ User connected: ${socket.id}`);

  let userId = null;
  const userToken = socket.handshake.auth.token;

  // Verify JWT token and get user ID
  if (userToken) {
    try {
      const decoded = jwt.verify(userToken, process.env.JWT_SECRET || 'your-secret-key');
      userId = decoded.id;
      socket.join(`user_${userId}`);
      console.log(`User ${userId} authenticated and joined personal room`);
    } catch (error) {
      console.error('Socket authentication error:', error.message);
    }
  }

  // User joins a trip room
  socket.on('join-trip-room', (data) => {
    if (data.tripId) {
      socket.join(`trip_${data.tripId}`);
      if (userId) {
        socket.join(`trip_${data.tripId}_user_${userId}`);
      }
      console.log(`User ${userId} joined trip: ${data.tripId}`);
    }
  });

  // User joins personal notification room
  socket.on('join-user-room', (data) => {
    if (userId) {
      socket.join(`user_${userId}`);
      console.log(`User ${userId} joined personal notification room`);
    }
  });

  // User leaves a trip room
  socket.on('leave-trip-room', (data) => {
    if (data.tripId) {
      socket.leave(`trip_${data.tripId}`);
      if (userId) {
        socket.leave(`trip_${data.tripId}_user_${userId}`);
      }
      console.log(`User ${userId} left trip: ${data.tripId}`);
    }
  });

  // User leaves personal room
  socket.on('leave-user-room', (data) => {
    if (userId) {
      socket.leave(`user_${userId}`);
      console.log(`User ${userId} left personal notification room`);
    }
  });

  // Live Location Update
  socket.on('update-location', (data) => {
    const { tripId, latitude, longitude } = data;
    console.log(`[DEBUG] Location update from user ${userId}: Trip ${tripId}, Lat: ${latitude}, Lng: ${longitude}`);

    // Store route history in Trip model for advanced matching
    if (tripId && latitude && longitude) {
      const Trip = require('./models/Trip');
      Trip.findByIdAndUpdate(
        tripId,
        {
          $push: {
            routeHistory: {
              latitude,
              longitude,
              timestamp: new Date()
            }
          }
        },
        { new: true }
      ).catch(err => console.error('[GPS-HISTORY] Error saving route:', err.message));
    }

    // Emit to all users in the trip room (for ongoing trips)
    io.to(`trip_${tripId}`).emit('location-updated', {
      userId: userId,
      latitude,
      longitude,
      timestamp: new Date(),
    });

    // Also emit driver location specifically for riders in this trip only
    // This allows real-time pickup distance calculation on rider side
    io.to(`trip_${tripId}`).emit('driver-location-update', {
      tripId: tripId,
      driverId: userId,
      lat: latitude,
      lng: longitude,
      timestamp: new Date()
    });
  });

  // Chat Message (via Socket.io for real-time sync)
  socket.on('send-message', (data) => {
    const { tripId, recipientId, message } = data;
    io.to(`trip_${tripId}_user_${recipientId}`).emit('receive-message', {
      senderId: userId,
      message,
      timestamp: new Date(),
    });
  });

  socket.on('disconnect', () => {
    console.log(`❌ User disconnected: ${socket.id}`);
  });
});

// Start Server
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════════╗
║     🚗 Car Pulling Backend Server 🚗       ║
╠════════════════════════════════════════════╣
║ Server running on: http://localhost:${PORT}  ║
║ Environment: ${process.env.NODE_ENV || 'development'} ║
║ MongoDB: Connected ✓                       ║
╚════════════════════════════════════════════╝
  `);
});

module.exports = server;
