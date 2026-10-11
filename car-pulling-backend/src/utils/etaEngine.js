/**
 * etaEngine.js
 * Pure Node.js ETA inference engine.
 *
 * The LightGBM model was exported to JSON by export_lgbm.py (run once).
 * This file loads that JSON once at startup and exposes two functions:
 *
 *   predictEta(options)       — returns { eta_seconds, source, reason }
 *   computeRideEta(trip, rider, io) — gets OSRM data, runs model, saves to DB, emits socket
 *
 * NO Python, NO HTTP calls, NO extra npm packages needed for inference.
 */

'use strict';

const path = require('path');
const fs   = require('fs');
const User = require('../models/User');
const Trip = require('../models/Trip');
const { getRouteSummary } = require('./osrmSummary');

// ── Settings (all can be overridden with environment variables) ────────────
// If OSRM duration is below this, the model's floor is too high — use raw OSRM time instead.
const MIN_MODEL_ROUTE_SECONDS = parseInt(process.env.MIN_MODEL_ROUTE_SECONDS || '120', 10);
const MODEL_VERSION = 'lgbm-4feat-b-v1';

// ── Model state (loaded once on first call) ────────────────────────────────
let MODEL       = null;   // parsed lgbm_model.json
let INPUT_RANGES = null;  // parsed input_ranges.json

// Feature order must exactly match the training order in features_contract.json
const FEATURE_NAMES = ['osrm_duration', 'osrm_distance', 'haversine_km', 'osrm_speed_kmh'];

/**
 * Load the model JSON and input ranges from disk.
 * Called automatically on first use — safe to call multiple times.
 */
function loadModel() {
  if (MODEL) return; // already loaded, nothing to do

  const modelPath  = path.join(__dirname, '..', '..', '..', 'Model', 'lgbm_model.json');
  const rangesPath = path.join(__dirname, '..', '..', '..', 'Model', 'LightGBM', 'input_ranges.json');

  if (!fs.existsSync(modelPath)) {
    throw new Error(
      `ETA model file not found at ${modelPath}. ` +
      'Run: python export_lgbm.py (from the project root) to generate it.'
    );
  }

  console.log('[ETA-ENGINE] Loading model from', modelPath);
  MODEL        = JSON.parse(fs.readFileSync(modelPath, 'utf8'));
  INPUT_RANGES = JSON.parse(fs.readFileSync(rangesPath, 'utf8'));
  console.log('[ETA-ENGINE] Model loaded —', MODEL.tree_info.length, 'trees,', FEATURE_NAMES.length, 'features');
}

// ── Tree traversal ─────────────────────────────────────────────────────────

/**
 * Walk one decision tree and return the leaf value for the given feature array.
 * @param {object} node — a node from model.tree_info[i].tree_structure
 * @param {number[]} features — [osrm_duration, osrm_distance, haversine_km, osrm_speed_kmh]
 * @returns {number}
 */
function traverseNode(node, features) {
  // Leaf node: it has "leaf_value" but no "split_feature"
  if ('leaf_value' in node) {
    return node.leaf_value;
  }

  const featureVal = features[node.split_feature]; // feature index (0-3)

  // Handle NaN/missing: go left or right based on the model's recorded preference
  if (!isFinite(featureVal) || isNaN(featureVal)) {
    return node.default_left
      ? traverseNode(node.left_child, features)
      : traverseNode(node.right_child, features);
  }

  // Normal split: threshold is already a float in the exported JSON
  if (featureVal <= node.threshold) {
    return traverseNode(node.left_child, features);
  } else {
    return traverseNode(node.right_child, features);
  }
}

/**
 * Sum leaf values from all 209 trees (raw log1p prediction).
 * @param {number[]} features
 * @returns {number} raw log1p(seconds)
 */
function predictRaw(features) {
  let sum = 0;
  for (const tree of MODEL.tree_info) {
    sum += traverseNode(tree.tree_structure, features);
  }
  // average_output is false for this model, so no division needed
  return sum;
}

// ── Feature engineering ────────────────────────────────────────────────────

/**
 * Haversine straight-line distance in km.
 * Uses Earth radius 6371 km — exactly as in training (notebook cell 34).
 * ALL arguments must be passed by name to avoid lat/lng mix-ups.
 *
 * @param {object} p
 * @param {number} p.pickup_lat
 * @param {number} p.pickup_lon
 * @param {number} p.dropoff_lat
 * @param {number} p.dropoff_lon
 * @returns {number} km
 */
function haversineKm({ pickup_lat, pickup_lon, dropoff_lat, dropoff_lon }) {
  const R       = 6371;
  const toRad   = (deg) => deg * Math.PI / 180;
  const dLat    = toRad(dropoff_lat - pickup_lat);
  const dLon    = toRad(dropoff_lon - pickup_lon);
  const sinHalf = (x) => Math.sin(x / 2);
  const a = sinHalf(dLat) ** 2
    + Math.cos(toRad(pickup_lat)) * Math.cos(toRad(dropoff_lat)) * sinHalf(dLon) ** 2;
  return R * 2 * Math.asin(Math.sqrt(Math.min(1.0, a)));
}

/**
 * Build the 4-element feature array in training order.
 * All arguments are named to prevent lat/lng array confusion.
 *
 * @param {object} p
 * @param {number} p.pickup_lat
 * @param {number} p.pickup_lon
 * @param {number} p.dropoff_lat
 * @param {number} p.dropoff_lon
 * @param {number} p.osrm_duration_s  seconds
 * @param {number} p.osrm_distance_m  metres
 * @returns {number[]} [osrm_duration, osrm_distance, haversine_km, osrm_speed_kmh]
 */
function buildFeatures({ pickup_lat, pickup_lon, dropoff_lat, dropoff_lon,
                         osrm_duration_s, osrm_distance_m }) {
  // Validate lat/lon ranges (same check as notebook)
  if (Math.abs(pickup_lat) > 90 || Math.abs(dropoff_lat) > 90)
    throw new Error('latitude out of range');
  if (Math.abs(pickup_lon) > 180 || Math.abs(dropoff_lon) > 180)
    throw new Error('longitude out of range');

  // Speed: cap duration at 1 s minimum (same rule as training)
  const durationForSpeed = Math.max(osrm_duration_s, 1.0);
  const osrm_speed_kmh   = (osrm_distance_m / 1000.0) / (durationForSpeed / 3600.0);

  return [
    osrm_duration_s,                                                          // index 0
    osrm_distance_m,                                                          // index 1
    haversineKm({ pickup_lat, pickup_lon, dropoff_lat, dropoff_lon }),        // index 2
    osrm_speed_kmh                                                            // index 3
  ];
}

/**
 * Check whether any feature is outside the training min/max.
 * Returns an array of out-of-range feature names (empty = all OK).
 * @param {number[]} features
 * @returns {string[]}
 */
function checkRanges(features) {
  const bad = [];
  for (let i = 0; i < FEATURE_NAMES.length; i++) {
    const range = INPUT_RANGES[FEATURE_NAMES[i]];
    if (features[i] < range.min || features[i] > range.max) {
      bad.push(FEATURE_NAMES[i]);
    }
  }
  return bad;
}

// ── Main prediction function ───────────────────────────────────────────────

/**
 * Predict ETA for a single route leg.
 *
 * Decision order (same as notebook + your spec):
 *   1. Validate OSRM values (not NaN, not negative, both numbers)
 *   2. Short-route guard: if osrm_duration_s < MIN_MODEL_ROUTE_SECONDS → OSRM fallback
 *   3. Range check against input_ranges.json
 *   4. Run the 209-tree model
 *   5. Clamp result to >= 0
 *
 * @param {object} p
 * @param {number} p.pickup_lat
 * @param {number} p.pickup_lon
 * @param {number} p.dropoff_lat
 * @param {number} p.dropoff_lon
 * @param {number} p.osrm_duration_s
 * @param {number} p.osrm_distance_m
 * @returns {{ eta_seconds: number|null, source: string, reason: string }}
 */
function predictEta({ pickup_lat, pickup_lon, dropoff_lat, dropoff_lon,
                      osrm_duration_s, osrm_distance_m }) {
  // Ensure model is loaded
  loadModel();

  // Helper: return a fallback result with the raw OSRM time
  function fallback(reason) {
    const v = (typeof osrm_duration_s === 'number' && isFinite(osrm_duration_s))
      ? osrm_duration_s
      : null;
    return { eta_seconds: v, source: 'osrm_fallback', reason };
  }

  // ── Rule 1: validate OSRM inputs ──────────────────────────────────────
  if (typeof osrm_duration_s !== 'number' || typeof osrm_distance_m !== 'number') {
    return fallback('osrm values are not numbers');
  }
  if (!isFinite(osrm_duration_s) || !isFinite(osrm_distance_m)) {
    return fallback('osrm values are not finite');
  }
  if (osrm_duration_s < 0 || osrm_distance_m < 0) {
    return fallback('osrm values are negative');
  }

  // ── Rule 2: short-route guard ─────────────────────────────────────────
  // The model has a high floor for very short routes (see known problem in spec).
  if (osrm_duration_s < MIN_MODEL_ROUTE_SECONDS) {
    return fallback(
      `route too short (${osrm_duration_s.toFixed(0)}s < ${MIN_MODEL_ROUTE_SECONDS}s minimum)`
    );
  }

  try {
    // ── Rule 3: build features and check ranges ────────────────────────
    const features = buildFeatures({
      pickup_lat, pickup_lon, dropoff_lat, dropoff_lon,
      osrm_duration_s, osrm_distance_m
    });

    const outOfRange = checkRanges(features);
    if (outOfRange.length > 0) {
      return fallback(`outside training range: ${outOfRange.join(', ')}`);
    }

    // ── Rule 4: run the model ──────────────────────────────────────────
    const rawLog1p  = predictRaw(features);         // log1p(seconds)
    const etaSeconds = Math.expm1(rawLog1p);         // seconds

    // ── Rule 5: never return negative ─────────────────────────────────
    return {
      eta_seconds  : Math.max(0, etaSeconds),
      source       : 'model',
      reason       : 'inputs inside training range',
      model_version: MODEL_VERSION
    };

  } catch (err) {
    return fallback(`prediction error: ${err.message}`);
  }
}

// ── computeRideEta — the high-level function called by the controller ──────

/**
 * Computes, saves, and emits the ETA for one rider in a trip.
 *
 * Call this AFTER a successful driver accept, but do NOT await it in the
 * HTTP handler — run it in the background so accepting can never fail because of ETA.
 *
 * Flow:
 *   1. Find driver's current location (User.currentLocation, fallback to trip pickup)
 *   2. OSRM summary: driver → rider pickup   (pickup leg)
 *   3. OSRM summary: rider pickup → rider dropoff   (trip leg)
 *   4. Run predictEta for both legs
 *   5. Save riders[].eta to the Trip document
 *   6. Emit 'eta-update' to both user_${driverId} and user_${riderId}
 *
 * @param {object} trip    — mongoose Trip document (populated)
 * @param {object} rider   — the rider sub-document from trip.riders
 * @param {object} io      — Socket.IO server instance
 */
async function computeRideEta(trip, rider, io) {
  const TAG = '[ETA]';

  try {
    const tripId  = trip._id.toString();
    const riderId = rider.riderId.toString ? rider.riderId.toString()
                                           : rider.riderId._id?.toString();
    const driverId = trip.driver.toString ? trip.driver.toString()
                                          : trip.driver._id?.toString();

    console.log(`${TAG} Computing ETA for trip=${tripId} rider=${riderId}`);

    // ── Step 1: Driver's current location ─────────────────────────────
    // User.currentLocation is [longitude, latitude] (GeoJSON order)
    const driverUser = await User.findById(driverId).select('currentLocation').lean();

    let driverLng, driverLat;

    if (driverUser?.currentLocation?.coordinates
        && driverUser.currentLocation.coordinates[0] !== 0
        && driverUser.currentLocation.coordinates[1] !== 0) {
      // GeoJSON stores [longitude, latitude]
      driverLng = driverUser.currentLocation.coordinates[0];
      driverLat = driverUser.currentLocation.coordinates[1];
      console.log(`${TAG} Driver location from User.currentLocation: lat=${driverLat}, lng=${driverLng}`);
    } else {
      // Fallback: driver's trip pickup (where they started the trip)
      const pickupCoords = trip.pickupLocation?.coordinates?.coordinates;
      if (!pickupCoords) {
        console.warn(`${TAG} Cannot determine driver location — no currentLocation and no trip pickupLocation`);
        return;
      }
      driverLng = pickupCoords[0]; // [lng, lat] in MongoDB
      driverLat = pickupCoords[1];
      console.log(`${TAG} Driver location fallback to trip pickup: lat=${driverLat}, lng=${driverLng}`);
    }

    // ── Step 2: Rider's pickup and dropoff coordinates ─────────────────
    // MongoDB stores coordinates as [longitude, latitude]
    const riderPickupCoords  = rider.pickupPoint?.coordinates?.coordinates
                            || rider.pickupPoint?.coordinates;
    const riderDropoffCoords = rider.dropoffPoint?.coordinates?.coordinates
                            || rider.dropoffPoint?.coordinates;

    if (!riderPickupCoords || !riderDropoffCoords) {
      console.warn(`${TAG} Rider pickup/dropoff coordinates missing — skipping ETA`);
      return;
    }

    // Extract lat/lng clearly — coordinates are [lng, lat]
    const riderPickupLng  = riderPickupCoords[0];
    const riderPickupLat  = riderPickupCoords[1];
    const riderDropoffLng = riderDropoffCoords[0];
    const riderDropoffLat = riderDropoffCoords[1];

    console.log(`${TAG} Rider pickup: lat=${riderPickupLat}, lng=${riderPickupLng}`);
    console.log(`${TAG} Rider dropoff: lat=${riderDropoffLat}, lng=${riderDropoffLng}`);

    // ── Step 3: Get OSRM summaries for both legs ───────────────────────
    // getRouteSummary takes [lng, lat] arrays (OSRM format)
    const [pickupLeg, tripLeg] = await Promise.all([
      getRouteSummary(
        [driverLng, driverLat],
        [riderPickupLng, riderPickupLat],
        'pickup-leg'
      ),
      getRouteSummary(
        [riderPickupLng, riderPickupLat],
        [riderDropoffLng, riderDropoffLat],
        'trip-leg'
      )
    ]);

    console.log(`${TAG} Pickup leg OSRM: ${pickupLeg?.durationSeconds?.toFixed(0)}s, ${pickupLeg?.distanceMeters?.toFixed(0)}m`);
    console.log(`${TAG} Trip leg OSRM:   ${tripLeg?.durationSeconds?.toFixed(0)}s,   ${tripLeg?.distanceMeters?.toFixed(0)}m`);

    if (!pickupLeg || !tripLeg) {
      console.warn(`${TAG} OSRM failed for one or both legs — saving no ETA`);
      return;
    }

    // ── Step 4: Run predictions for both legs ──────────────────────────
    const pickupResult = predictEta({
      pickup_lat     : driverLat,
      pickup_lon     : driverLng,
      dropoff_lat    : riderPickupLat,
      dropoff_lon    : riderPickupLng,
      osrm_duration_s: pickupLeg.durationSeconds,
      osrm_distance_m: pickupLeg.distanceMeters
    });

    const tripResult = predictEta({
      pickup_lat     : riderPickupLat,
      pickup_lon     : riderPickupLng,
      dropoff_lat    : riderDropoffLat,
      dropoff_lon    : riderDropoffLng,
      osrm_duration_s: tripLeg.durationSeconds,
      osrm_distance_m: tripLeg.distanceMeters
    });

    console.log(`${TAG} Pickup ETA: ${pickupResult.eta_seconds?.toFixed(0)}s (${pickupResult.source})`);
    console.log(`${TAG} Trip ETA:   ${tripResult.eta_seconds?.toFixed(0)}s (${tripResult.source})`);

    // ── Step 5: Save eta sub-document to the Trip ──────────────────────
    // We use findOneAndUpdate to avoid any conflict with other in-flight saves
    const etaDoc = {
      pickupSeconds    : pickupResult.eta_seconds,
      tripSeconds      : tripResult.eta_seconds,
      osrmPickupSeconds: pickupLeg.durationSeconds,
      osrmTripSeconds  : tripLeg.durationSeconds,
      osrmPickupMeters : pickupLeg.distanceMeters,
      osrmTripMeters   : tripLeg.distanceMeters,
      pickupSource     : pickupResult.source,
      tripSource       : tripResult.source,
      reason           : [pickupResult.reason, tripResult.reason].join(' | '),
      modelVersion     : MODEL_VERSION,
      computedAt       : new Date()
    };

    await Trip.updateOne(
      { _id: tripId, 'riders.riderId': rider.riderId },
      { $set: { 'riders.$.eta': etaDoc } }
    );

    console.log(`${TAG} ETA saved to Trip document`);

    // ── Step 6: Emit eta-update to rider and driver ────────────────────
    if (io) {
      const payload = {
        tripId       : tripId,
        riderId      : riderId,
        pickupSeconds: pickupResult.eta_seconds,
        tripSeconds  : tripResult.eta_seconds,
        pickupSource : pickupResult.source,
        tripSource   : tripResult.source,
        computedAt   : etaDoc.computedAt
      };

      // Send to the rider's personal room (always joined)
      io.to(`user_${riderId}`).emit('eta-update', payload);
      // Send to the driver's personal room (always joined)
      io.to(`user_${driverId}`).emit('eta-update', payload);

      console.log(`${TAG} Emitted eta-update to rider user_${riderId} and driver user_${driverId}`);
    }

  } catch (err) {
    // An ETA failure must never crash the accept flow
    console.error('[ETA] computeRideEta failed (non-fatal):', err.message);
  }
}

module.exports = { predictEta, computeRideEta, haversineKm, buildFeatures };
