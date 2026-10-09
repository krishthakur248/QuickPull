const Trip = require('../models/Trip');
const User = require('../models/User');
const { generateUniqueCode, calculateDistance, checkRouteOverlap, getOSRMRoute } = require('../utils/helpers');
const { matchRoutes, calculateFareSplit } = require('../utils/matchingEngine');
const { computeScore10 } = require('../config/ratingConfig');

// Per-km rates by vehicle type (in ₹)
const RATE_PER_KM = {
    bike: 20,
    car: 30,
    ev: 40
};

/**
 * Get the per-km rate for a vehicle type
 * @param {String} vehicleType - 'bike', 'car', or 'ev'
 * @returns {Number} rate in ₹/km
 */
function getRatePerKm(vehicleType) {
    const type = (vehicleType || 'car').toLowerCase();
    return RATE_PER_KM[type] || RATE_PER_KM.car;
}

// Start a new trip (driver creates ride offer)
exports.startTrip = async (req, res) => {
    try {
        const userId = req.user.id;
        const {
            pickupLocation,
            dropoffLocation,
            startTime,
            availableSeats,
            vehicleInfo,
            estimatedFare,
            routePreference
        } = req.body;

        // Validate required fields
        if (!pickupLocation || !dropoffLocation || !availableSeats) {
            return res.status(400).json({
                success: false,
                message: 'Missing required fields: pickupLocation, dropoffLocation, availableSeats'
            });
        }

        // Validate and normalize coordinates - handle both array [lng, lat] and object {coordinates: [lng, lat]} formats
        let pickupCoords = Array.isArray(pickupLocation) ? pickupLocation : pickupLocation.coordinates;
        let dropoffCoords = Array.isArray(dropoffLocation) ? dropoffLocation : dropoffLocation.coordinates;

        if (!Array.isArray(pickupCoords) || !Array.isArray(dropoffCoords) ||
            pickupCoords.length !== 2 || dropoffCoords.length !== 2) {
            return res.status(400).json({
                success: false,
                message: 'Invalid location format. Expected coordinates array [longitude, latitude]'
            });
        }

        // Get driver info
        const driver = await User.findById(userId);
        if (!driver) {
            return res.status(404).json({ success: false, message: 'Driver not found' });
        }

        console.log(`\n[START-TRIP] 📍 Driver: ${driver.firstName} ${driver.lastName}`);
        console.log(`[START-TRIP] Pickup: [${pickupCoords}]`);
        console.log(`[START-TRIP] Dropoff: [${dropoffCoords}]`);

        // Get real road route from OSRM
        console.log(`[START-TRIP] 🗺️  Fetching real road route from OSRM...`);
        const osrmWaypoints = await getOSRMRoute(pickupCoords, dropoffCoords);

        // Convert waypoints to routeHistory format
        let routeHistory = [];
        if (osrmWaypoints && osrmWaypoints.length > 0) {
            console.log(`[START-TRIP] ✅ OSRM returned ${osrmWaypoints.length} waypoints`);
            routeHistory = osrmWaypoints.map((point, index) => ({
                latitude: point[0],
                longitude: point[1],
                timestamp: new Date()
            }));
        } else {
            console.log(`[START-TRIP] ⚠️  OSRM failed, falling back to pickup/dropoff only`);
            routeHistory = [
                {
                    latitude: pickupCoords[1],
                    longitude: pickupCoords[0],
                    timestamp: new Date()
                },
                {
                    latitude: dropoffCoords[1],
                    longitude: dropoffCoords[0],
                    timestamp: new Date()
                }
            ];
        }

        // Create trip with populated routeHistory
        const trip = new Trip({
            tripCode: generateUniqueCode(),
            driver: userId,
            pickupLocation: {
                address: 'Current Location',
                coordinates: {
                    type: 'Point',
                    coordinates: pickupCoords
                }
            },
            dropoffLocation: {
                address: 'Destination',
                coordinates: {
                    type: 'Point',
                    coordinates: dropoffCoords
                }
            },
            startTime: startTime || new Date(),
            route: [], // Empty for now, will be populated later if needed
            routeHistory: routeHistory, // Pre-populated with OSRM waypoints!
            availableSeats,
            occupiedSeats: 1, // Driver occupies 1 seat
            riders: [],
            vehicle: vehicleInfo || driver.vehicle || 'car', // Default to 'car' if no info
            baseFare: (() => {
                // Calculate distance-based fare: driver pickup → driver dropoff
                const vehicleType = vehicleInfo || driver.vehicle || 'car';
                const tripDistanceKm = calculateDistance(
                    pickupCoords[1], pickupCoords[0],  // lat, lng from [lng, lat]
                    dropoffCoords[1], dropoffCoords[0]
                );
                const rate = getRatePerKm(vehicleType);
                const calculatedFare = Math.round(tripDistanceKm * rate);
                console.log(`[START-TRIP] 💰 Fare calculation: ${tripDistanceKm.toFixed(2)}km × ₹${rate}/km (${vehicleType}) = ₹${calculatedFare}`);
                return estimatedFare || calculatedFare || 100;
            })(),
            distance: calculateDistance(
                pickupCoords[1], pickupCoords[0],
                dropoffCoords[1], dropoffCoords[0]
            ),
            status: 'active',
            driverConsent: true
        });

        await trip.save();

        console.log(`[START-TRIP] ✅ Trip created: ${trip.tripCode}`);
        console.log(`[START-TRIP] Route waypoints stored: ${trip.routeHistory.length}`);

        res.status(201).json({
            success: true,
            message: 'Trip created successfully',
            trip
        });
    } catch (error) {
        console.error('Start trip error:', error);
        res.status(500).json({
            success: false,
            message: 'Error creating trip',
            error: error.message
        });
    }
};

// Find matching trips for a rider
exports.findMatches = async (req, res) => {
    try {
        console.log('\n\n🚀🚀🚀 ========== FIND-MATCHES ENDPOINT CALLED ==========');
        console.log('Timestamp:', new Date().toISOString());

        const userId = req.user.id;
        const {
            pickupLocation,
            dropoffLocation,
            maxDistance = 10,   // increased default to 10 km
            timeWindow = 30
        } = req.body;

        if (!pickupLocation || !dropoffLocation) {
            return res.status(400).json({
                success: false,
                message: 'Missing required fields: pickupLocation, dropoffLocation'
            });
        }

        // [lng, lat] array from frontend
        const riderPickupCoords  = Array.isArray(pickupLocation)  ? pickupLocation  : pickupLocation.coordinates;
        const riderDropoffCoords = Array.isArray(dropoffLocation) ? dropoffLocation : dropoffLocation.coordinates;

        console.log(`[FIND-MATCHES] STEP-A: Rider Pickup coords  = [${riderPickupCoords}]`);
        console.log(`[FIND-MATCHES] STEP-A: Rider Dropoff coords = [${riderDropoffCoords}]`);

        // ── Step 1: Spatial candidate query ──────────────────────────────────
        let candidates = await Trip.find({
            status: 'active',
            $expr: { $lt: ['$occupiedSeats', '$availableSeats'] },
            driver: { $ne: userId },
            'pickupLocation.coordinates': {
                $near: {
                    $geometry: { type: 'Point', coordinates: riderPickupCoords },
                    $maxDistance: maxDistance * 1000
                }
            }
        })
        .populate('driver', 'firstName lastName rating totalRides vehicle vehicleNumber vehicleColor profileImage ratingSum ratingCount')
        .limit(30);

        console.log(`[FIND-MATCHES] STEP-B: $near (${maxDistance}km) returned ${candidates.length} candidate(s)`);

        // ── Fallback: widen to 50 km if nothing found ─────────────────────
        if (candidates.length === 0) {
            console.log('[FIND-MATCHES] STEP-B2: No candidates — widening to 50 km...');
            // Also check total active trips to diagnose DB issues
            const totalActive = await Trip.countDocuments({ status: 'active', driver: { $ne: userId } });
            console.log(`[FIND-MATCHES] STEP-B2: Total active trips in DB (excl. self): ${totalActive}`);

            candidates = await Trip.find({
                status: 'active',
                $expr: { $lt: ['$occupiedSeats', '$availableSeats'] },
                driver: { $ne: userId },
                'pickupLocation.coordinates': {
                    $near: {
                        $geometry: { type: 'Point', coordinates: riderPickupCoords },
                        $maxDistance: 50000
                    }
                }
            })
            .populate('driver', 'firstName lastName rating totalRides vehicle vehicleNumber vehicleColor profileImage')
            .limit(30);
            console.log(`[FIND-MATCHES] STEP-B2: 50-km fallback returned ${candidates.length} candidate(s)`);
        }

        // Log every candidate found
        candidates.forEach((c, i) => {
            console.log(`[FIND-MATCHES] STEP-B candidate[${i}]: tripId=${c._id} driver=${c.driver?.firstName} routeHistoryLen=${c.routeHistory?.length || 0} seats=${c.occupiedSeats}/${c.availableSeats}`);
            console.log(`  pickup  DB coords: [${c.pickupLocation?.coordinates?.coordinates}]`);
            console.log(`  dropoff DB coords: [${c.dropoffLocation?.coordinates?.coordinates}]`);
        });

        // ── Step 2: Route-matching filter ─────────────────────────────────
        const riderRoute = [
            [riderPickupCoords[1],  riderPickupCoords[0]],
            [riderDropoffCoords[1], riderDropoffCoords[0]]
        ];
        console.log(`[FIND-MATCHES] STEP-C: riderRoute (lat,lng) = [[${riderRoute[0]}],[${riderRoute[1]}]]`);

        const turf = require('@turf/turf');
        const riderPickupPt  = turf.point(riderPickupCoords);
        const riderDropoffPt = turf.point(riderDropoffCoords);

        const matchedTrips = [];

        for (const trip of candidates) {
            try {
                const pickupCoords  = trip.pickupLocation?.coordinates?.coordinates;  // [lng, lat]
                const dropoffCoords = trip.dropoffLocation?.coordinates?.coordinates; // [lng, lat]

                console.log(`\n[FIND-MATCHES] STEP-D: Processing trip ${trip._id}`);

                if (!pickupCoords || !dropoffCoords) {
                    console.log(`[FIND-MATCHES] STEP-D: ❌ SKIP — missing coords (pickup=${JSON.stringify(pickupCoords)} dropoff=${JSON.stringify(dropoffCoords)})`);
                    continue;
                }
                console.log(`[FIND-MATCHES] STEP-D: driver pickup  DB = [${pickupCoords}]  → latLng=[${pickupCoords[1]},${pickupCoords[0]}]`);
                console.log(`[FIND-MATCHES] STEP-D: driver dropoff DB = [${dropoffCoords}] → latLng=[${dropoffCoords[1]},${dropoffCoords[0]}]`);

                // Build driver route in [lat, lng] format
                let driverRoute;
                let routeSource = 'unknown';
                if (trip.routeHistory && trip.routeHistory.length >= 2) {
                    driverRoute = trip.routeHistory.map(p => [p.latitude, p.longitude]);
                    routeSource = `routeHistory(${driverRoute.length}pts)`;
                } else {
                    console.log(`[FIND-MATCHES] STEP-D: routeHistory has ${trip.routeHistory?.length || 0} pts — trying OSRM...`);
                    try {
                        const osrmWaypoints = await getOSRMRoute(pickupCoords, dropoffCoords);
                        if (osrmWaypoints && osrmWaypoints.length >= 2) {
                            driverRoute = osrmWaypoints;
                            routeSource = `OSRM(${driverRoute.length}pts)`;
                        } else {
                            console.log(`[FIND-MATCHES] STEP-D: OSRM returned no waypoints`);
                        }
                    } catch (osrmErr) {
                        console.log(`[FIND-MATCHES] STEP-D: OSRM error: ${osrmErr.message}`);
                    }

                    if (!driverRoute) {
                        driverRoute = [
                            [pickupCoords[1],  pickupCoords[0]],
                            [dropoffCoords[1], dropoffCoords[0]]
                        ];
                        routeSource = 'straight-line-fallback';
                    }
                }
                console.log(`[FIND-MATCHES] STEP-D: driverRoute source=${routeSource}  points=${driverRoute.length}`);
                console.log(`[FIND-MATCHES] STEP-D: driverRoute[0]=[${driverRoute[0]}]  driverRoute[-1]=[${driverRoute[driverRoute.length-1]}]`);

                // Run matching algorithm
                const matchResult = matchRoutes(driverRoute, riderRoute, { baseFare: trip.baseFare || 100 });
                console.log(`[FIND-MATCHES] STEP-E: matchResult matched=${matchResult.matched} reason=${matchResult.reason}`);
                if (matchResult.overlapRatio !== undefined) {
                    console.log(`[FIND-MATCHES] STEP-E: overlapRatio=${(matchResult.overlapRatio*100).toFixed(1)}% overlapKm=${matchResult.overlapDistanceKm?.toFixed(3)}`);
                }

                if (!matchResult.matched) {
                    console.log(`[FIND-MATCHES] STEP-E: ❌ NO MATCH — ${matchResult.reason} / ${matchResult.message || ''}`);
                    continue;
                }

                // ── Compute distances for frontend cards ──────────────────
                // pickupDistance: how far the rider's pickup is from the driver's current pickup
                const driverPickupPt = turf.point(pickupCoords);
                const pickupDistance = turf.distance(riderPickupPt, driverPickupPt, { units: 'kilometers' });

                const driverDropoffPt = turf.point(dropoffCoords);
                const dropoffDistance = turf.distance(riderDropoffPt, driverDropoffPt, { units: 'kilometers' });

                // ── Calculate rider fare ──
                // Distance = rider pickup → min(rider dropoff, driver dropoff)
                // i.e. whichever dropoff is closer to rider pickup
                const riderToRiderDropoffKm = turf.distance(riderPickupPt, riderDropoffPt, { units: 'kilometers' });
                const riderToDriverDropoffKm = turf.distance(riderPickupPt, driverDropoffPt, { units: 'kilometers' });
                const tripDistanceKm = Math.min(riderToRiderDropoffKm, riderToDriverDropoffKm);
                const vehicleType = trip.vehicle || 'car';
                const ratePerKm = getRatePerKm(vehicleType);
                const estimatedFare = Math.round(tripDistanceKm * ratePerKm);

                console.log(`[FIND-MATCHES] 💰 Fare: riderPickup→riderDropoff=${riderToRiderDropoffKm.toFixed(2)}km, riderPickup→driverDropoff=${riderToDriverDropoffKm.toFixed(2)}km, used=${tripDistanceKm.toFixed(2)}km × ₹${ratePerKm}/km (${vehicleType}) = ₹${estimatedFare}`);

                // matchScore: 0-100 derived from overlapRatio
                const matchScore = Math.round((matchResult.overlapRatio || 0.5) * 100);

                const tripObj = trip.toObject();

                // Compute Bayesian score for driver card display
                const driverRatingSum   = trip.driver ? (trip.driver.ratingSum || 0)   : 0;
                const driverRatingCount = trip.driver ? (trip.driver.ratingCount || 0) : 0;
                const driverScore10 = computeScore10(driverRatingSum, driverRatingCount);

                matchedTrips.push({
                    ...tripObj,
                    matchScore,
                    overlapDistanceKm: parseFloat((matchResult.overlapDistanceKm || 0).toFixed(2)),
                    pickupDistance:    parseFloat(pickupDistance.toFixed(2)),
                    dropoffDistance:   parseFloat(dropoffDistance.toFixed(2)),
                    pickupPoint:       matchResult.pickupPoint,
                    dropoffPoint:      matchResult.dropoffPoint,
                    fareSplit:         matchResult.fareSplit,
                    estimatedFare:     estimatedFare,
                    estimatedDistance: parseFloat(tripDistanceKm.toFixed(2)),
                    ratePerKm:         ratePerKm,
                    // Driver rating fields for card display
                    driverScore10,
                    driverRatingCount
                });

                console.log(`[FIND-MATCHES] ✓ MATCHED  score=${matchScore}% overlap=${matchResult.overlapDistanceKm?.toFixed(2)}km`);

            } catch (tripErr) {
                console.error(`[FIND-MATCHES] Error on trip ${trip._id}:`, tripErr.message);
            }
        }

        // Sort best match first
        matchedTrips.sort((a, b) => b.matchScore - a.matchScore);

        console.log(`\n[FIND-MATCHES] RESULT: ${matchedTrips.length} / ${candidates.length} trips matched`);
        console.log('[FIND-MATCHES] ========== END ==========\n');

        res.status(200).json({
            success: true,
            message: `Found ${matchedTrips.length} matching trips`,
            matches: matchedTrips
        });
    } catch (error) {
        console.error('Find matches error:', error);
        res.status(500).json({
            success: false,
            message: 'Error finding matches',
            error: error.message
        });
    }
};

// Debug: Get all active trips (for debugging matching)
exports.getAllTrips = async (req, res) => {
  try {
    const trips = await Trip.find({ status: 'active' }).populate('driver', 'firstName lastName');
    const tripsData = trips.map(trip => ({
      _id: trip._id,
      driver: trip.driver.firstName + ' ' + trip.driver.lastName,
      pickup: trip.pickupLocation?.coordinates?.coordinates,
      dropoff: trip.dropoffLocation?.coordinates?.coordinates,
      routeHistoryCount: trip.routeHistory?.length || 0,
      routeHistory: trip.routeHistory?.slice(0, 5) || [] // First 5 points
    }));
    res.status(200).json({
      success: true,
      totalTrips: trips.length,
      trips: tripsData
    });
  } catch (error) {
    console.error('Get trips error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// Join a trip (rider requests to join)
exports.joinTrip = async (req, res) => {
    try {
        const userId = req.user.id;
        const { tripId, pickupPoint, dropoffPoint, fare } = req.body;

        // Validate trip exists
        const trip = await Trip.findById(tripId).populate('driver', 'firstName lastName');
        if (!trip) {
            return res.status(404).json({ success: false, message: 'Trip not found' });
        }

        // Check if trip is active
        if (trip.status !== 'active') {
            return res.status(400).json({
                success: false,
                message: `Trip is ${trip.status}. Cannot join.`
            });
        }

        // Check available seats
        if (trip.occupiedSeats >= trip.availableSeats) {
            return res.status(400).json({
                success: false,
                message: 'No available seats in this trip'
            });
        }

        // Check if user already joined
        const alreadyJoined = trip.riders.some(rider => rider.riderId.toString() === userId);
        if (alreadyJoined) {
            return res.status(400).json({
                success: false,
                message: 'You have already joined this trip'
            });
        }

        // Get rider info
        const rider = await User.findById(userId);
        if (!rider) {
            return res.status(404).json({ success: false, message: 'Rider not found' });
        }

        // Normalize pickup and dropoff points to GeoJSON format
        const normalizeLocation = (location, fallback) => {
            if (!location) {
                return fallback;
            }
            // If it's already in GeoJSON format
            if (location.coordinates && location.coordinates.type) {
                return location;
            }
            // If it's an array [lng, lat]
            if (Array.isArray(location) && location.length === 2) {
                return {
                    address: 'Pickup Location',
                    coordinates: {
                        type: 'Point',
                        coordinates: location
                    }
                };
            }
            // If it has coordinates property but not full GeoJSON format
            if (location.coordinates && Array.isArray(location.coordinates)) {
                return {
                    address: location.address || 'Pickup Location',
                    coordinates: {
                        type: 'Point',
                        coordinates: location.coordinates
                    }
                };
            }
            return fallback;
        };

        // Add rider to trip with calculated fare from frontend
        trip.riders.push({
            riderId: userId,
            pickupPoint: normalizeLocation(pickupPoint, trip.pickupLocation),
            dropoffPoint: normalizeLocation(dropoffPoint, trip.dropoffLocation),
            fare: fare || 0, // Distance-based fare: Bike ₹20/km, Car ₹30/km, EV ₹40/km
            status: 'matched', // Initial status when rider joins
            joinedAt: new Date()
        });

        trip.occupiedSeats += 1;
        await trip.save();

        // Populate for response
        await trip.populate([
            { path: 'driver', select: 'firstName lastName rating' },
            { path: 'riders.riderId', select: 'firstName lastName rating' }
        ]);

        // Emit real-time notification to driver via Socket.io
        const io = req.app.get('io');
        if (io) {
            const riderName = `${rider.firstName} ${rider.lastName}`;
            // Notify driver about new rider request
            io.to(`user_${trip.driver._id}`).emit('new-rider-request', {
                tripId: trip._id,
                tripCode: trip.tripCode,
                riderId: userId,
                riderName: riderName,
                riderRating: rider.rating,
                fare: fare || 0,
                message: `New rider ${riderName} joined your trip!`,
                timestamp: new Date()
            });

            // Also emit via trip room for real-time updates
            io.to(`trip_${trip._id}`).emit('rider-joined', {
                tripId: trip._id,
                riderId: userId,
                riderName: riderName,
                fare: fare || 0,
                timestamp: new Date()
            });
        }

        res.status(200).json({
            success: true,
            message: `Successfully joined trip. Waiting for ${trip.driver.firstName}'s acceptance.`,
            trip
        });
    } catch (error) {
        console.error('Join trip error:', error);
        res.status(500).json({
            success: false,
            message: 'Error joining trip',
            error: error.message
        });
    }
};

// Accept or reject rider (driver action)
exports.respondToRider = async (req, res) => {
    try {
        const userId = req.user.id;
        const { tripId, riderId, action } = req.body; // action: 'accept' or 'reject'

        console.log('respondToRider called with:', { userId, tripId, riderId, action });

        if (!['accept', 'reject'].includes(action)) {
            return res.status(400).json({
                success: false,
                message: "Action must be 'accept' or 'reject'"
            });
        }

        const trip = await Trip.findById(tripId)
            .populate('driver', 'firstName lastName')
            .populate('riders.riderId', 'firstName lastName');

        if (!trip) {
            return res.status(404).json({ success: false, message: 'Trip not found' });
        }

        // Verify user is the driver
        if (trip.driver._id.toString() !== userId) {
            return res.status(403).json({
                success: false,
                message: 'Only the driver can accept or reject riders'
            });
        }

        // Find rider in trip - normalize riderId to string for comparison
        const riderIdString = typeof riderId === 'string' ? riderId : riderId?.toString?.() || riderId;
        console.log('Looking for rider:', riderIdString, 'in riders:', trip.riders.map(r => r.riderId._id.toString()));

        const riderIndex = trip.riders.findIndex(r => r.riderId._id.toString() === riderIdString);
        if (riderIndex === -1) {
            return res.status(404).json({
                success: false,
                message: 'Rider not found in this trip'
            });
        }

        let responseMessage = '';
        if (action === 'accept') {
            trip.riders[riderIndex].status = 'confirmed';  // Use 'confirmed' instead of 'accepted'
            // Set driver consent flag (optional, based on model definition)
            trip.driverConsent = true;
            responseMessage = 'Rider accepted';
        } else {
            // Remove rider if rejected
            trip.riders.splice(riderIndex, 1);
            trip.occupiedSeats -= 1;
            responseMessage = 'Rider rejected';
        }

        await trip.save();

        // Emit real-time notification via Socket.io
        const io = req.app.get('io');
        if (io) {
            const driverName = `${trip.driver.firstName} ${trip.driver.lastName}`;

            if (action === 'accept') {
                // Notify rider that they were accepted
                io.to(`user_${riderIdString}`).emit('notification', {
                    type: 'ride-accepted',
                    tripId: tripId,
                    driverId: userId,
                    driverName: driverName,
                    message: `${driverName} accepted your ride request!`,
                    timestamp: new Date()
                });

                io.to(`trip_${tripId}_user_${riderIdString}`).emit('ride-status-update', {
                    tripId: tripId,
                    status: 'accepted',
                    driverName: driverName
                });
            } else {
                // Notify rider that they were rejected
                io.to(`user_${riderIdString}`).emit('notification', {
                    type: 'ride-rejected',
                    tripId: tripId,
                    driverId: userId,
                    driverName: driverName,
                    message: `${driverName} rejected your ride request.`,
                    timestamp: new Date()
                });
            }
        }

        res.status(200).json({
            success: true,
            message: responseMessage,
            trip
        });
    } catch (error) {
        console.error('Respond to rider error:', error);
        res.status(500).json({
            success: false,
            message: 'Error responding to rider',
            error: error.message
        });
    }
};

// Cancel rider request (rider cancels their join request)
exports.cancelRiderRequest = async (req, res) => {
    try {
        const userId = req.user.id;
        const { tripId } = req.params;
        const { riderId } = req.body;

        console.log('cancelRiderRequest called with:', { userId, tripId, riderId });

        const trip = await Trip.findById(tripId)
            .populate('driver', 'firstName lastName profileImage ratingSum ratingCount')
            .populate('riders.riderId', 'firstName lastName isSimulation');

        if (!trip) {
            return res.status(404).json({ success: false, message: 'Trip not found' });
        }

        // Verify that the rider is the one cancelling or they're the driver
        const riderIdToRemove = riderId || userId;
        const riderIdString = typeof riderIdToRemove === 'string' ? riderIdToRemove : riderIdToRemove?.toString?.() || riderIdToRemove;

        if (riderIdString !== userId && trip.driver._id.toString() !== userId) {
            return res.status(403).json({
                success: false,
                message: 'You can only cancel your own request'
            });
        }

        // Find rider in trip
        const riderIndex = trip.riders.findIndex(r => r.riderId._id.toString() === riderIdString);
        if (riderIndex === -1) {
            return res.status(404).json({
                success: false,
                message: 'Rider not found in this trip'
            });
        }

        const removedRider = trip.riders[riderIndex];

        // ── Review trigger logic ──────────────────────────────────────────────
        // Only trigger a review popup if the driver had already accepted the rider.
        // Status 'confirmed' means driver accepted. 'matched' means not yet accepted.
        const driverHadAccepted = removedRider.status === 'confirmed' || removedRider.status === 'ongoing';

        // Check if the passenger cancelling is a simulation user
        const passengerUser = removedRider.riderId;
        const isSimPassenger = passengerUser && passengerUser.isSimulation;

        // Mark reviewPending BEFORE removing from array (we need data for the socket emit)
        const shouldTriggerReview = driverHadAccepted && !isSimPassenger;

        if (shouldTriggerReview) {
            removedRider.reviewPending = true;
            removedRider.reviewTrigger = 'cancelled_after_accept';
            removedRider.status = 'cancelled'; // Update status before removal reference is lost
        }

        // Remove rider from trip
        trip.riders.splice(riderIndex, 1);
        trip.occupiedSeats -= 1;

        await trip.save();

        // Emit real-time notification via Socket.io
        const io = req.app.get('io');
        if (io) {
            // Notify driver that rider cancelled
            io.to(`user_${trip.driver._id.toString()}`).emit('notification', {
                type: 'rider-cancelled',
                tripId: tripId,
                riderId: riderIdString,
                message: 'A rider has cancelled their request',
                timestamp: new Date()
            });

            // ── Send review popup to the cancelling passenger ─────────────────
            if (shouldTriggerReview) {
                const driverDoc = trip.driver;
                const driverScore10 = computeScore10(
                    driverDoc ? driverDoc.ratingSum : 0,
                    driverDoc ? driverDoc.ratingCount : 0
                );

                io.to(`user_${riderIdString}`).emit('show-review-popup', {
                    tripId:    trip._id,
                    bookingId: trip._id,
                    trigger:   'cancelled_after_accept',
                    driver: driverDoc ? {
                        _id:         driverDoc._id,
                        firstName:   driverDoc.firstName,
                        lastName:    driverDoc.lastName,
                        profileImage: driverDoc.profileImage,
                        score10:     driverScore10,
                        ratingCount: driverDoc.ratingCount || 0
                    } : null
                });
            }
        }

        res.status(200).json({
            success: true,
            message: 'Request cancelled successfully',
            trip
        });
    } catch (error) {
        console.error('Cancel rider request error:', error);
        res.status(500).json({
            success: false,
            message: 'Error cancelling request',
            error: error.message
        });
    }
};

// Get trip details
exports.getTripDetails = async (req, res) => {
    try {
        const { tripId } = req.params;

        const trip = await Trip.findById(tripId)
            .populate('driver', 'firstName lastName rating totalRides vehicle vehicleNumber vehicleColor currentLocation')
            .populate('riders.riderId', 'firstName lastName rating totalRides');

        if (!trip) {
            return res.status(404).json({ success: false, message: 'Trip not found' });
        }

        res.status(200).json({
            success: true,
            trip
        });
    } catch (error) {
        console.error('Get trip details error:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching trip details',
            error: error.message
        });
    }
};

// Complete a trip
exports.completeTrip = async (req, res) => {
    try {
        const userId = req.user.id;
        const { tripId, finalRoute } = req.body;

        console.log('🔍 [COMPLETE-TRIP] Request received:');
        console.log('   - User ID from token:', userId, 'Type:', typeof userId);
        console.log('   - Trip ID:', tripId);

        const trip = await Trip.findById(tripId);
        if (!trip) {
            return res.status(404).json({ success: false, message: 'Trip not found' });
        }

        console.log('🔍 [COMPLETE-TRIP] Trip found:');
        console.log('   - Trip driver:', trip.driver, 'Type:', typeof trip.driver);
        console.log('   - Trip driver toString():', trip.driver.toString());
        console.log('   - User ID:', userId);
        console.log('   - Match result:', trip.driver.toString() === userId);

        // Verify user is the driver
        if (trip.driver.toString() !== userId) {
            console.warn('❌ [COMPLETE-TRIP] Authorization failed - user is not the driver');
            return res.status(403).json({
                success: false,
                message: 'Only the driver can complete a trip'
            });
        }

        // Update trip
        trip.status = 'completed';
        trip.endTime = new Date();
        if (finalRoute) {
            trip.route = finalRoute;
        }

        // Fetch driver info for the review popup payload
        const driverUser = await User.findById(userId).select('firstName lastName profileImage ratingSum ratingCount');
        const driverScore10 = computeScore10(
            driverUser ? driverUser.ratingSum : 0,
            driverUser ? driverUser.ratingCount : 0
        );

        // Mark riders as completed AND set reviewPending for eligible riders
        // Eligible = confirmed or ongoing (driver already accepted them)
        trip.riders.forEach(rider => {
            const wasActive = rider.status === 'confirmed' || rider.status === 'ongoing' || rider.status === 'accepted';
            if (wasActive) {
                rider.status = 'completed';
                // Only set review flag if not already reviewed
                if (!rider.reviewPending) {
                    rider.reviewPending = true;
                    rider.reviewTrigger = 'completed';
                }
            }
        });

        await trip.save();

        // Emit socket event to notify all riders that trip is completed
        const io = req.app.get('io');
        if (io) {
            // Notify all riders in this trip
            trip.riders.forEach(rider => {
                const riderIdStr = rider.riderId ? rider.riderId.toString() : null;
                if (!riderIdStr) return;

                io.to(`user_${riderIdStr}`).emit('trip-completed', {
                    tripId: trip._id,
                    status: 'completed',
                    message: `Trip has been completed by the driver`
                });

                // Send review popup to eligible riders (confirmed/completed)
                if (rider.reviewPending) {
                    io.to(`user_${riderIdStr}`).emit('show-review-popup', {
                        tripId:    trip._id,
                        bookingId: trip._id,
                        trigger:   'completed',
                        driver: driverUser ? {
                            _id:         driverUser._id,
                            firstName:   driverUser.firstName,
                            lastName:    driverUser.lastName,
                            profileImage: driverUser.profileImage,
                            score10:     driverScore10,
                            ratingCount: driverUser.ratingCount || 0
                        } : null
                    });
                }
            });

            // Also notify via trip room
            io.to(`trip_${tripId}`).emit('trip-completed', {
                tripId: trip._id,
                status: 'completed',
                message: `Trip has been completed by the driver`
            });
        }

        res.status(200).json({
            success: true,
            message: 'Trip completed successfully',
            trip
        });
    } catch (error) {
        console.error('Complete trip error:', error);
        res.status(500).json({
            success: false,
            message: 'Error completing trip',
            error: error.message
        });
    }
};

// Get active trips for driver
exports.getDriverTrips = async (req, res) => {
    try {
        const userId = req.user.id;

        const trips = await Trip.find({
            driver: userId
        })
        .populate('riders.riderId', 'firstName lastName rating')
        .sort({ startTime: -1 })
        .limit(20);

        res.status(200).json({
            success: true,
            trips
        });
    } catch (error) {
        console.error('Get driver trips error:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching driver trips',
            error: error.message
        });
    }
};

// Get trips rider has joined
exports.getRiderTrips = async (req, res) => {
    try {
        const userId = req.user.id;

        const trips = await Trip.find({
            'riders.riderId': userId
        })
        .populate('driver', 'firstName lastName rating vehicle vehicleNumber vehicleColor currentLocation')
        .populate('riders.riderId', 'firstName lastName phone')
        .sort({ startTime: -1 })
        .limit(20);

        res.status(200).json({
            success: true,
            trips
        });
    } catch (error) {
        console.error('Get rider trips error:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching rider trips',
            error: error.message
        });
    }
};
