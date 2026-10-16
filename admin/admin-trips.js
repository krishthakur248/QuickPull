/**
 * admin-trips.js
 * ─────────────────────────────────────────────────────────────────────────────
 * All JavaScript for the Trip Management section of the admin dashboard.
 *
 * Loaded by dashboard.html after admin-api.js.
 *
 * Features:
 *   - Paginated trips table with status + date-range + code-search filters
 *   - Clicking a row opens a slide-in detail drawer
 *   - Drawer shows: driver info, route, vehicle, fare, rider list with statuses
 *   - Force Complete button (active trips only) — confirm dialog
 *   - Force Cancel button (active trips only) — reason modal
 *   - Toast notification on success/failure
 */

// ─── State ────────────────────────────────────────────────────────────────────
let tripsPage       = 1;
let tripsTotalPages = 1;
let tripsFilters    = { status: '', dateRange: '', search: '' };
let searchTripTimer = null; // debounce timer for the search box

// ─── Entry point ──────────────────────────────────────────────────────────────
// Called by admin-app.js the first time the Trips section is opened.
function initTripsSection() {
  // Search input debounce
  const searchInput = document.getElementById('trip-search');
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      clearTimeout(searchTripTimer);
      searchTripTimer = setTimeout(() => {
        tripsFilters.search = searchInput.value.trim();
        loadTrips(1);
      }, 400);
    });
  }

  // Filter dropdowns — re-fetch on change
  ['trip-filter-status', 'trip-filter-date'].forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('change', () => {
      tripsFilters[el.dataset.filter] = el.value;
      loadTrips(1);
    });
  });

  // Drawer close button
  document.getElementById('trip-drawer-close')?.addEventListener('click', closeTripDrawer);

  // Force-cancel modal cancel button
  document.getElementById('fcancel-modal-cancel')?.addEventListener('click', closeForceCancelModal);

  // Close drawer and modals on Escape
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeTripDrawer();
      closeForceCancelModal();
    }
  });

  // Load first page
  loadTrips(1);
}

// ─── Load trips list ──────────────────────────────────────────────────────────
async function loadTrips(page = 1) {
  tripsPage = page;

  const tbody    = document.getElementById('trips-tbody');
  const pageInfo = document.getElementById('trips-page-info');
  const prevBtn  = document.getElementById('trips-prev');
  const nextBtn  = document.getElementById('trips-next');
  const countEl  = document.getElementById('trips-count');

  if (!tbody) return;

  tbody.innerHTML = '<tr><td colspan="7" class="table-placeholder">Loading…</td></tr>';

  // Build query string from current filters
  const params = new URLSearchParams({ page, limit: 20 });
  if (tripsFilters.status)    params.set('status',    tripsFilters.status);
  if (tripsFilters.dateRange) params.set('dateRange', tripsFilters.dateRange);
  if (tripsFilters.search)    params.set('search',    tripsFilters.search);

  try {
    const data = await AdminAPI.get(`/trips?${params.toString()}`);

    tripsTotalPages = data.pages || 1;

    if (countEl)  countEl.textContent  = `${data.total} trip${data.total !== 1 ? 's' : ''}`;
    if (pageInfo) pageInfo.textContent = `Page ${data.page} of ${data.pages}`;
    if (prevBtn)  prevBtn.disabled     = data.page <= 1;
    if (nextBtn)  nextBtn.disabled     = data.page >= data.pages;

    if (!data.trips || data.trips.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" class="table-placeholder">No trips match the current filters.</td></tr>';
      return;
    }

    tbody.innerHTML = data.trips.map(buildTripRow).join('');

    // Click handler for each row
    tbody.querySelectorAll('.trip-row-clickable').forEach((row) => {
      row.addEventListener('click', () => openTripDrawer(row.dataset.tripId, row.dataset.driverId));
    });

  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="7" class="table-placeholder table-error">Error: ${err.message}</td></tr>`;
  }
}

// ─── Build a single table row ─────────────────────────────────────────────────
function buildTripRow(t) {
  const driver    = t.driver ? `${t.driver.firstName} ${t.driver.lastName}` : '—';
  const driverId  = t.driver?._id || (typeof t.driver === 'string' ? t.driver : '');
  const riderCnt  = t.riders?.length ?? 0;
  const vehicleIcon = { car: '🚗', bike: '🏍️', ev: '⚡' }[t.vehicle] || '🚗';
  const statusBadge = tripStatusBadgeClass(t.status);
  const startTime = t.startTime
    ? new Date(t.startTime).toLocaleString('en-IN', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' })
    : '—';
  const fare = t.totalFare != null ? `₹${t.totalFare.toFixed(0)}` : '—';

  return `
    <tr class="trip-row-clickable log-row" data-trip-id="${t._id}" data-driver-id="${driverId}" title="Click to view trip detail">
      <td class="cell-mono" style="font-weight:600">${escTripHtml(t.tripCode || '—')}</td>
      <td>${escTripHtml(driver)}</td>
      <td>${riderCnt} rider${riderCnt !== 1 ? 's' : ''}</td>
      <td>${vehicleIcon} ${t.vehicle}</td>
      <td><span class="badge ${statusBadge}">${t.status}</span></td>
      <td class="cell-mono text-muted">${startTime}</td>
      <td>
        <button class="btn-sm btn-view" onclick="event.stopPropagation(); openTripDrawer('${t._id}', '${driverId}')">View →</button>
      </td>
    </tr>
  `;
}

// ─── Map & Coordinates helpers ────────────────────────────────────────────────
let currentTripMap = null;

function destroyTripMap() {
  if (currentTripMap) {
    try {
      currentTripMap.remove();
    } catch (e) {
      console.warn('Error removing trip map:', e);
    }
    currentTripMap = null;
  }
}

/**
 * Safely extracts { lat, lng } from various coordinate representations:
 * GeoJSON Point [lng, lat], array [lng, lat], or object { lat, lng }.
 */
function extractCoords(loc) {
  if (!loc) return null;
  // GeoJSON Point: { coordinates: [lng, lat] } or { coordinates: { coordinates: [lng, lat] } }
  if (loc.coordinates) {
    if (Array.isArray(loc.coordinates.coordinates) && loc.coordinates.coordinates.length >= 2) {
      const [lng, lat] = loc.coordinates.coordinates;
      const nLat = Number(lat), nLng = Number(lng);
      if (!isNaN(nLat) && !isNaN(nLng) && (nLat !== 0 || nLng !== 0)) return { lat: nLat, lng: nLng };
    }
    if (Array.isArray(loc.coordinates) && loc.coordinates.length >= 2) {
      const [lng, lat] = loc.coordinates;
      const nLat = Number(lat), nLng = Number(lng);
      if (!isNaN(nLat) && !isNaN(nLng) && (nLat !== 0 || nLng !== 0)) return { lat: nLat, lng: nLng };
    }
    if (loc.coordinates.lat && loc.coordinates.lng) {
      const nLat = Number(loc.coordinates.lat), nLng = Number(loc.coordinates.lng);
      if (!isNaN(nLat) && !isNaN(nLng)) return { lat: nLat, lng: nLng };
    }
  }
  // Direct lat / lng properties
  if (loc.lat && loc.lng) {
    const nLat = Number(loc.lat), nLng = Number(loc.lng);
    if (!isNaN(nLat) && !isNaN(nLng)) return { lat: nLat, lng: nLng };
  }
  return null;
}

// ─── Detail drawer ────────────────────────────────────────────────────────────
async function openTripDrawer(tripId, hintDriverId = null) {
  const wrapper  = document.getElementById('trip-drawer-wrapper');
  const content  = document.getElementById('trip-drawer-content');
  if (!wrapper || !content) return;

  destroyTripMap();

  wrapper.classList.add('drawer-open');
  content.innerHTML = '<div class="drawer-loading">Loading…</div>';

  try {
    // Fetch trip details and driver user profile concurrently
    const [tripData, hintUserData] = await Promise.all([
      AdminAPI.get(`/trips/${tripId}`),
      hintDriverId ? AdminAPI.get(`/users/${hintDriverId}`).catch(() => null) : Promise.resolve(null),
    ]);

    const trip = tripData.trip;
    const resolvedDriverId = hintDriverId || trip.driver?._id || (typeof trip.driver === 'string' ? trip.driver : null);

    let driverFlags = (trip.driver && trip.driver.flagCount != null)
      ? trip.driver.flagCount
      : (tripData.driverFlagCount != null ? tripData.driverFlagCount : null);

    // If driverFlags is missing or 0, check hintUserData or fetch user profile from /users/:id to guarantee accurate flag count
    if ((driverFlags == null || driverFlags === 0) && resolvedDriverId) {
      if (hintUserData && hintUserData.flagCount != null) {
        driverFlags = hintUserData.flagCount;
      } else {
        try {
          const userRes = await AdminAPI.get(`/users/${resolvedDriverId}`);
          if (userRes && userRes.flagCount != null) {
            driverFlags = userRes.flagCount;
          }
        } catch (uErr) {
          console.warn('[ADMIN TRIPS] Could not fetch driver flags from /users/:id:', uErr);
        }
      }
    }

    if (driverFlags != null) {
      if (trip.driver && typeof trip.driver === 'object') {
        trip.driver.flagCount = driverFlags;
      }
      trip.driverFlagCount = driverFlags;
    }

    content.innerHTML = buildTripDrawerContent(trip);
    wireTripDrawerButtons(trip);
    initTripMap(trip);
  } catch (err) {
    content.innerHTML = `<div class="drawer-error">Error: ${err.message}</div>`;
  }
}

function closeTripDrawer() {
  destroyTripMap();
  const wrapper = document.getElementById('trip-drawer-wrapper');
  if (wrapper) wrapper.classList.remove('drawer-open');
}

// ─── Initialize Leaflet Map ───────────────────────────────────────────────────
async function initTripMap(trip) {
  destroyTripMap();

  const mapContainer = document.getElementById('admin-trip-map');
  if (!mapContainer) return;

  if (typeof L === 'undefined') {
    mapContainer.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--text-dim);font-size:.75rem;">Loading map…</div>';
    return;
  }

  const pickupCoords  = extractCoords(trip.pickupLocation);
  const dropoffCoords = extractCoords(trip.dropoffLocation);

  if (!pickupCoords || !dropoffCoords) {
    mapContainer.innerHTML = `
      <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;gap:.35rem;color:var(--text-dim);font-size:.8125rem;text-align:center;padding:1rem;">
        <span>🗺️ Map coordinates unavailable</span>
        <span style="font-size:.6875rem;color:var(--text-dim);">${escTripHtml(trip.pickupLocation?.address || 'Pickup')} → ${escTripHtml(trip.dropoffLocation?.address || 'Dropoff')}</span>
      </div>`;
    return;
  }

  mapContainer.innerHTML = '';

  const centerLat = (pickupCoords.lat + dropoffCoords.lat) / 2;
  const centerLng = (pickupCoords.lng + dropoffCoords.lng) / 2;

  currentTripMap = L.map(mapContainer, {
    zoomControl: true,
    attributionControl: false,
    dragging: true,
    scrollWheelZoom: false, // Prevents interfering with drawer scrolling
    doubleClickZoom: true,
  }).setView([centerLat, centerLng], 12);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 18,
    keepBuffer: 6,
    crossOrigin: true
  }).addTo(currentTripMap);

  // Colored markers matching AddRide-Connected.html
  const blueIcon = L.icon({
    iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-blue.png',
    shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png',
    iconSize: [22, 36], iconAnchor: [11, 36], popupAnchor: [1, -30], shadowSize: [36, 36]
  });

  const redIcon = L.icon({
    iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-red.png',
    shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png',
    iconSize: [22, 36], iconAnchor: [11, 36], popupAnchor: [1, -30], shadowSize: [36, 36]
  });

  const greenIcon = L.icon({
    iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-green.png',
    shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png',
    iconSize: [22, 36], iconAnchor: [11, 36], popupAnchor: [1, -30], shadowSize: [36, 36]
  });

  const orangeIcon = L.icon({
    iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-orange.png',
    shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png',
    iconSize: [18, 30], iconAnchor: [9, 30], popupAnchor: [1, -26], shadowSize: [30, 30]
  });

  // Pickup marker (blue)
  L.marker([pickupCoords.lat, pickupCoords.lng], { icon: blueIcon })
    .addTo(currentTripMap)
    .bindPopup(`<strong>📍 Pickup</strong><br/>${escTripHtml(trip.pickupLocation?.address || 'Pickup Point')}`);

  // Dropoff marker (red)
  L.marker([dropoffCoords.lat, dropoffCoords.lng], { icon: redIcon })
    .addTo(currentTripMap)
    .bindPopup(`<strong>🏁 Dropoff</strong><br/>${escTripHtml(trip.dropoffLocation?.address || 'Destination')}`);

  // Confirmed / matched riders markers (orange)
  if (Array.isArray(trip.riders)) {
    trip.riders.forEach((r) => {
      const rCoords = extractCoords(r.pickupPoint);
      if (rCoords) {
        const rName = r.riderId ? `${r.riderId.firstName} ${r.riderId.lastName}` : 'Rider';
        L.marker([rCoords.lat, rCoords.lng], { icon: orangeIcon })
          .addTo(currentTripMap)
          .bindPopup(`<strong>👤 ${escTripHtml(rName)}</strong><br/>${escTripHtml(r.pickupPoint?.address || 'Rider Pickup')}`);
      }
    });
  }

  // Driver live location (green) if available
  const driverCoords = extractCoords(trip.driverLocation) || extractCoords(trip.driver?.currentLocation);
  if (driverCoords) {
    const driverName = trip.driver ? `${trip.driver.firstName} ${trip.driver.lastName}` : 'Driver';
    L.marker([driverCoords.lat, driverCoords.lng], { icon: greenIcon })
      .addTo(currentTripMap)
      .bindPopup(`<strong>🚗 ${escTripHtml(driverName)}</strong><br/>Live Location`);
  }

  // Fallback straight line
  const drawFallback = () => {
    if (!currentTripMap) return;
    const line = L.polyline(
      [[pickupCoords.lat, pickupCoords.lng], [dropoffCoords.lat, dropoffCoords.lng]],
      { color: '#06b6d4', weight: 3, dashArray: '6, 6', opacity: 0.8 }
    ).addTo(currentTripMap);
    currentTripMap.fitBounds(line.getBounds(), { padding: [30, 30] });
  };

  // OSRM Driving Route
  try {
    const osrmUrl = `https://router.project-osrm.org/route/v1/driving/${pickupCoords.lng},${pickupCoords.lat};${dropoffCoords.lng},${dropoffCoords.lat}?overview=full&geometries=geojson`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 6000);

    const resp = await fetch(osrmUrl, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (resp.ok) {
      const routeData = await resp.json();
      if (routeData.code === 'Ok' && routeData.routes && routeData.routes.length > 0) {
        const coords = routeData.routes[0].geometry.coordinates;
        const latLngs = coords.map(c => [c[1], c[0]]);
        const routeLine = L.polyline(latLngs, {
          color: '#06b6d4',
          weight: 4,
          opacity: 0.9,
          lineCap: 'round',
          lineJoin: 'round',
        }).addTo(currentTripMap);

        currentTripMap.fitBounds(routeLine.getBounds(), { padding: [30, 30] });
      } else {
        drawFallback();
      }
    } else {
      drawFallback();
    }
  } catch (err) {
    drawFallback();
  }

  // Recalculate dimensions once drawer transition finishes
  setTimeout(() => {
    if (currentTripMap) {
      currentTripMap.invalidateSize();
    }
  }, 280);
}

// ─── Build trip drawer HTML ───────────────────────────────────────────────────
function buildTripDrawerContent(t) {
  const driver    = t.driver   ? `${t.driver.firstName} ${t.driver.lastName}` : '—';
  const driverPh  = t.driver?.phone || '—';
  const driverRating = t.driver?.rating ? `${t.driver.rating.toFixed(1)} ⭐` : '—';
  const driverFlags  = (t.driver && t.driver.flagCount != null) ? t.driver.flagCount : (t.driverFlagCount || 0);
  const driverFlagDisplay = driverFlags > 0
    ? `<span class="flag-count ${driverFlags >= 3 ? 'flag-high' : 'flag-low'}">🚩 ${driverFlags} flag${driverFlags !== 1 ? 's' : ''}</span>`
    : '<span class="text-dim">0 flags</span>';

  const fmt = (d) => d
    ? new Date(d).toLocaleString('en-IN', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' })
    : '—';

  // Pickup / dropoff addresses
  const pickupAddr  = t.pickupLocation?.address  || 'Pickup Location';
  const dropoffAddr = t.dropoffLocation?.address || 'Dropoff Destination';

  // Fare info
  const fareRows = [
    t.baseFare     != null ? `<div class="drawer-field"><span class="field-label">Base Fare</span><span class="field-value">₹${t.baseFare.toFixed(2)}</span></div>` : '',
    t.distanceFare != null ? `<div class="drawer-field"><span class="field-label">Distance Fare</span><span class="field-value">₹${t.distanceFare.toFixed(2)}</span></div>` : '',
    t.totalFare    != null ? `<div class="drawer-field"><span class="field-label">Total Fare</span><span class="field-value" style="color:var(--cyan)">₹${t.totalFare.toFixed(2)}</span></div>` : '',
    t.distance     != null ? `<div class="drawer-field"><span class="field-label">Distance</span><span class="field-value">${t.distance.toFixed(1)} km</span></div>` : '',
    t.duration     != null ? `<div class="drawer-field"><span class="field-label">Duration</span><span class="field-value">${t.duration} min</span></div>` : '',
  ].filter(Boolean).join('');

  // Riders list
  const ridersHtml = !t.riders || t.riders.length === 0
    ? '<div class="trip-empty">No riders on this trip.</div>'
    : t.riders.map((r) => {
        const rName  = r.riderId ? `${r.riderId.firstName} ${r.riderId.lastName}` : 'Unknown Rider';
        const rPhone = r.riderId?.phone || '—';
        const rFare  = r.fare != null ? `₹${r.fare.toFixed(0)}` : '—';
        const rBadge = riderStatusBadge(r.status);
        return `
          <div class="rider-item">
            <div class="rider-name">${escTripHtml(rName)}</div>
            <div class="rider-meta">
              <span class="cell-mono text-muted" style="font-size:.75rem">${escTripHtml(rPhone)}</span>
              <span class="badge ${rBadge}">${r.status}</span>
              <span style="font-size:.8125rem;color:var(--cyan);font-weight:600">${rFare}</span>
            </div>
          </div>
        `;
      }).join('');

  // Force-action buttons (only for active trips)
  const actionButtons = t.status === 'active' ? `
    <div class="trip-actions-card">
      <div class="drawer-section-title" style="margin-top:0;padding-bottom:.25rem;color:#fb7185">⚠️ Admin Override Actions</div>
      <div style="font-size:.75rem;color:var(--text-muted);margin-bottom:.5rem">
        Use only when a trip is stuck or driver/riders disconnected. These actions are permanent and recorded in the audit log.
      </div>
      <div class="trip-action-row">
        <button
          id="trip-force-complete-btn"
          class="btn-action btn-trip-complete"
          data-trip-id="${t._id}"
          data-trip-code="${escTripHtml(t.tripCode)}"
        >✓ Force Complete</button>
        <button
          id="trip-force-cancel-btn"
          class="btn-action btn-trip-cancel"
          data-trip-id="${t._id}"
          data-trip-code="${escTripHtml(t.tripCode)}"
        >✕ Force Cancel</button>
      </div>
    </div>
  ` : '';

  return `
    <!-- Trip header -->
    <div class="trip-drawer-header">
      <div>
        <div style="font-size:.6875rem;color:var(--text-dim);text-transform:uppercase;font-weight:600;letter-spacing:.05em">Trip Code</div>
        <div class="trip-code-large">${escTripHtml(t.tripCode || '—')}</div>
      </div>
      <div style="display:flex;align-items:center;gap:.5rem">
        <span class="badge ${tripStatusBadgeClass(t.status)}">${t.status}</span>
        <span class="badge" style="background:rgba(255,255,255,.05);border:1px solid var(--border-hi);color:var(--text-muted)">${t.vehicle}</span>
      </div>
    </div>

    <!-- Route & Interactive Map -->
    <div class="drawer-section-title">Route & Live Map</div>
    <div class="route-grid">
      <div class="route-card route-card-pickup">
        <div class="route-card-label">📍 Pickup</div>
        <div class="route-card-addr">${escTripHtml(pickupAddr)}</div>
      </div>
      <div class="route-card route-card-dropoff">
        <div class="route-card-label">🏁 Dropoff</div>
        <div class="route-card-addr">${escTripHtml(dropoffAddr)}</div>
      </div>
    </div>

    <!-- Leaflet Map Container -->
    <div class="trip-map-container">
      <div id="admin-trip-map"></div>
    </div>

    <!-- Map Legend -->
    <div class="map-legend-bar">
      <div class="map-legend-items">
        <div class="map-legend-item"><span style="color:#3B8BEB;font-size:1rem">●</span> Pickup</div>
        <div class="map-legend-item"><span style="color:#ef4444;font-size:1rem">●</span> Dropoff</div>
        <div class="map-legend-item"><span style="color:#f59e0b;font-size:1rem">●</span> Riders</div>
      </div>
      ${t.distance != null ? `<span style="font-family:'JetBrains Mono',monospace;color:var(--cyan)">${t.distance.toFixed(1)} km</span>` : ''}
    </div>

    <!-- Timeline -->
    <div class="drawer-section-title">Timeline</div>
    <div class="drawer-grid">
      <div class="drawer-field"><span class="field-label">Started</span><span class="field-value">${fmt(t.startTime)}</span></div>
      <div class="drawer-field"><span class="field-label">Ended</span><span class="field-value">${fmt(t.endTime)}</span></div>
    </div>

    <!-- Driver -->
    <div class="drawer-section-title">Driver Information</div>
    <div class="drawer-grid">
      <div class="drawer-field"><span class="field-label">Name</span><span class="field-value">${escTripHtml(driver)}</span></div>
      <div class="drawer-field"><span class="field-label">Phone</span><span class="field-value cell-mono">${escTripHtml(driverPh)}</span></div>
      <div class="drawer-field"><span class="field-label">Rating</span><span class="field-value">${driverRating}</span></div>
      <div class="drawer-field"><span class="field-label">Vehicle</span><span class="field-value" style="text-transform:capitalize">${t.vehicle}</span></div>
      <div class="drawer-field"><span class="field-label">Available Seats</span><span class="field-value">${t.occupiedSeats || 0} / ${(t.availableSeats || 0) + (t.occupiedSeats || 0)}</span></div>
      <div class="drawer-field"><span class="field-label">Flags</span><span class="field-value">${driverFlagDisplay}</span></div>
    </div>

    <!-- Fare -->
    ${fareRows ? `<div class="drawer-section-title">Fare Details</div><div class="drawer-grid">${fareRows}</div>` : ''}

    <!-- Riders -->
    <div class="drawer-section-title">Riders (${t.riders?.length ?? 0})</div>
    <div class="riders-list">${ridersHtml}</div>

    <!-- Admin actions (Force Complete / Force Cancel) -->
    ${actionButtons}
  `;
}

// ─── Wire drawer action buttons ───────────────────────────────────────────────
function wireTripDrawerButtons(trip) {
  // Force complete
  document.getElementById('trip-force-complete-btn')?.addEventListener('click', (e) => {
    const { tripId, tripCode } = e.currentTarget.dataset;
    const ok = window.confirm(`Force-complete trip ${tripCode}?\n\nThis marks the trip and all active riders as "completed". This action is permanent and logged.`);
    if (ok) handleForceComplete(tripId, tripCode);
  });

  // Force cancel — open modal for reason
  document.getElementById('trip-force-cancel-btn')?.addEventListener('click', (e) => {
    const { tripId, tripCode } = e.currentTarget.dataset;
    openForceCancelModal(tripId, tripCode);
  });
}

// ─── Force Complete ───────────────────────────────────────────────────────────
async function handleForceComplete(tripId, tripCode) {
  try {
    const result = await AdminAPI.put(`/trips/${tripId}/force-complete`, {});
    showTripToast(result.message, 'success');
    closeTripDrawer();
    loadTrips(tripsPage);
  } catch (err) {
    showTripToast(err.message, 'error');
  }
}

// ─── Force Cancel modal ───────────────────────────────────────────────────────
function openForceCancelModal(tripId, tripCode) {
  const modal = document.getElementById('fcancel-modal');
  if (!modal) return;

  document.getElementById('fcancel-trip-code').textContent = tripCode;

  const textarea = document.getElementById('fcancel-reason-input');
  if (textarea) textarea.value = '';

  // Attach submit handler (clone to avoid stacking)
  const confirmBtn = document.getElementById('fcancel-modal-confirm');
  if (confirmBtn) {
    const newBtn = confirmBtn.cloneNode(true);
    confirmBtn.parentNode.replaceChild(newBtn, confirmBtn);
    newBtn.addEventListener('click', () => submitForceCancel(tripId, tripCode));
  }

  modal.classList.add('modal-open');
  setTimeout(() => textarea?.focus(), 50);
}

function closeForceCancelModal() {
  const modal = document.getElementById('fcancel-modal');
  if (modal) modal.classList.remove('modal-open');
}

async function submitForceCancel(tripId, tripCode) {
  const reason = document.getElementById('fcancel-reason-input')?.value?.trim();
  if (!reason) {
    showTripToast('Please enter a reason before cancelling.', 'error');
    return;
  }

  try {
    const result = await AdminAPI.put(`/trips/${tripId}/force-cancel`, { reason });
    showTripToast(result.message, 'success');
    closeForceCancelModal();
    closeTripDrawer();
    loadTrips(tripsPage);
  } catch (err) {
    showTripToast(err.message, 'error');
  }
}

// ─── Toast ────────────────────────────────────────────────────────────────────
// Uses the same showToast function from admin-users.js if it exists,
// otherwise falls back to a local copy.
function showTripToast(message, type = 'info') {
  if (typeof showToast === 'function') {
    showToast(message, type);
    return;
  }
  alert(message); // fallback if admin-users.js isn't loaded
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function tripStatusBadgeClass(status) {
  if (status === 'completed') return 'badge-success';
  if (status === 'cancelled') return 'badge-danger';
  return 'badge-info'; // active
}

function riderStatusBadge(status) {
  if (['completed'].includes(status))           return 'badge-success';
  if (['cancelled'].includes(status))           return 'badge-danger';
  if (['ongoing', 'confirmed'].includes(status)) return 'badge-info';
  return 'badge-dim'; // matched / pending
}

function escTripHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ─── Pagination buttons (called from HTML onclick) ─────────────────────────
function tripsPrev() { if (tripsPage > 1)             loadTrips(tripsPage - 1); }
function tripsNext() { if (tripsPage < tripsTotalPages) loadTrips(tripsPage + 1); }
