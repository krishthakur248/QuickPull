/**
 * osrmSummary.js
 * Lightweight OSRM wrapper that returns only { durationSeconds, distanceMeters }.
 *
 * Key design decisions:
 *  - Uses overview=false&steps=false  →  smallest possible response (no geometry)
 *  - 5-second timeout so a slow OSRM doesn't block ETA computation
 *  - Small in-memory cache (TTL 5 minutes) so repeated calls for the same two
 *    points don't hit the public demo server twice
 *  - Does NOT change or touch getOSRMRoute (used by the matching pipeline)
 *  - Coordinate order is ALWAYS [longitude, latitude] to match OSRM and MongoDB
 */

'use strict';

// ── Simple in-memory cache ─────────────────────────────────────────────────
// Key: "lng1,lat1→lng2,lat2"   Value: { result, expiresAt }
const cache   = new Map();
const TTL_MS  = 5 * 60 * 1000;   // 5 minutes
const MAX_ENTRIES = 500;          // prevent unbounded growth

function cacheKey(fromCoords, toCoords) {
  // Round to 5 decimal places (~1 m precision) to improve cache hit rate
  const fmt = (n) => n.toFixed(5);
  return `${fmt(fromCoords[0])},${fmt(fromCoords[1])}→${fmt(toCoords[0])},${fmt(toCoords[1])}`;
}

function cacheGet(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  return entry.result;
}

function cacheSet(key, result) {
  // Evict oldest entry if cache is full
  if (cache.size >= MAX_ENTRIES) {
    const firstKey = cache.keys().next().value;
    cache.delete(firstKey);
  }
  cache.set(key, { result, expiresAt: Date.now() + TTL_MS });
}

// ── Main function ──────────────────────────────────────────────────────────

/**
 * Fetch duration and distance for a driving route from OSRM.
 *
 * @param {number[]} fromCoords  [longitude, latitude]  — OSRM / MongoDB order
 * @param {number[]} toCoords    [longitude, latitude]
 * @param {string}   [label]     Optional label for log messages
 * @returns {Promise<{durationSeconds: number, distanceMeters: number} | null>}
 *   Returns null if OSRM fails or times out.
 */
async function getRouteSummary(fromCoords, toCoords, label = '') {
  const tag = label ? `[OSRM-SUMMARY ${label}]` : '[OSRM-SUMMARY]';

  // ── Input validation ──────────────────────────────────────────────────
  if (!Array.isArray(fromCoords) || !Array.isArray(toCoords)
      || fromCoords.length !== 2  || toCoords.length !== 2) {
    console.warn(`${tag} Invalid coordinate arrays`);
    return null;
  }

  const [fromLng, fromLat] = fromCoords;  // explicitly named to prevent mix-ups
  const [toLng,   toLat  ] = toCoords;

  if (!isFinite(fromLng) || !isFinite(fromLat) || !isFinite(toLng) || !isFinite(toLat)) {
    console.warn(`${tag} Non-finite coordinates`);
    return null;
  }

  // ── Cache check ───────────────────────────────────────────────────────
  const key    = cacheKey(fromCoords, toCoords);
  const cached = cacheGet(key);
  if (cached) {
    console.log(`${tag} Cache hit — ${cached.durationSeconds.toFixed(0)}s, ${cached.distanceMeters.toFixed(0)}m`);
    return cached;
  }

  // ── Build OSRM URL ────────────────────────────────────────────────────
  // overview=false&steps=false → response has only duration and distance (no geometry)
  // This is a smaller, faster response than what getOSRMRoute uses
  const url = `https://router.project-osrm.org/route/v1/driving/`
            + `${fromLng},${fromLat};${toLng},${toLat}`
            + `?overview=false&steps=false`;

  console.log(`${tag} Requesting: ${url}`);

  // ── Fetch with 5-second timeout ───────────────────────────────────────
  const controller = new AbortController();
  const timeoutId  = setTimeout(() => controller.abort(), 5000);

  try {
    const response = await fetch(url, {
      method : 'GET',
      headers: {
        // Identifying ourselves per OSRM demo server fair-use policy
        'User-Agent': 'QuickPull-App/1.0 (contact via GitHub: krishthakur248/QuickPull)'
      },
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      console.warn(`${tag} HTTP ${response.status} ${response.statusText}`);
      return null;
    }

    const data = await response.json();

    if (data.code !== 'Ok' || !data.routes || data.routes.length === 0) {
      console.warn(`${tag} OSRM returned no route: ${data.message || data.code}`);
      return null;
    }

    const route = data.routes[0];
    const result = {
      durationSeconds: route.duration,   // already in seconds
      distanceMeters : route.distance    // already in metres
    };

    console.log(`${tag} ${result.durationSeconds.toFixed(0)}s, ${result.distanceMeters.toFixed(0)}m`);

    cacheSet(key, result);
    return result;

  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      console.warn(`${tag} Request timed out after 5 s`);
    } else {
      console.warn(`${tag} Fetch error: ${err.message}`);
    }
    return null;
  }
}

module.exports = { getRouteSummary };
