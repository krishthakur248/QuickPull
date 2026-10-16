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
      row.addEventListener('click', () => openTripDrawer(row.dataset.tripId));
    });

  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="7" class="table-placeholder table-error">Error: ${err.message}</td></tr>`;
  }
}

// ─── Build a single table row ─────────────────────────────────────────────────
function buildTripRow(t) {
  const driver    = t.driver ? `${t.driver.firstName} ${t.driver.lastName}` : '—';
  const riderCnt  = t.riders?.length ?? 0;
  const vehicleIcon = { car: '🚗', bike: '🏍️', ev: '⚡' }[t.vehicle] || '🚗';
  const statusBadge = tripStatusBadgeClass(t.status);
  const startTime = t.startTime
    ? new Date(t.startTime).toLocaleString('en-IN', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' })
    : '—';
  const fare = t.totalFare != null ? `₹${t.totalFare.toFixed(0)}` : '—';

  return `
    <tr class="trip-row-clickable log-row" data-trip-id="${t._id}" title="Click to view trip detail">
      <td class="cell-mono" style="font-weight:600">${escTripHtml(t.tripCode || '—')}</td>
      <td>${escTripHtml(driver)}</td>
      <td>${riderCnt} rider${riderCnt !== 1 ? 's' : ''}</td>
      <td>${vehicleIcon} ${t.vehicle}</td>
      <td><span class="badge ${statusBadge}">${t.status}</span></td>
      <td class="cell-mono text-muted">${startTime}</td>
      <td>
        <button class="btn-sm btn-view" onclick="event.stopPropagation(); openTripDrawer('${t._id}')">View →</button>
      </td>
    </tr>
  `;
}

// ─── Detail drawer ────────────────────────────────────────────────────────────
async function openTripDrawer(tripId) {
  const wrapper  = document.getElementById('trip-drawer-wrapper');
  const content  = document.getElementById('trip-drawer-content');
  if (!wrapper || !content) return;

  wrapper.classList.add('drawer-open');
  content.innerHTML = '<div class="drawer-loading">Loading…</div>';

  try {
    const data = await AdminAPI.get(`/trips/${tripId}`);
    content.innerHTML = buildTripDrawerContent(data.trip);
    wireTripDrawerButtons(data.trip);
  } catch (err) {
    content.innerHTML = `<div class="drawer-error">Error: ${err.message}</div>`;
  }
}

function closeTripDrawer() {
  const wrapper = document.getElementById('trip-drawer-wrapper');
  if (wrapper) wrapper.classList.remove('drawer-open');
}

// ─── Build trip drawer HTML ───────────────────────────────────────────────────
function buildTripDrawerContent(t) {
  const driver    = t.driver   ? `${t.driver.firstName} ${t.driver.lastName}` : '—';
  const driverPh  = t.driver?.phone || '—';
  const driverRating = t.driver?.rating ? `${t.driver.rating.toFixed(1)} ⭐` : '—';

  const fmt = (d) => d
    ? new Date(d).toLocaleString('en-IN', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' })
    : '—';

  // Pickup / dropoff addresses
  const pickupAddr  = t.pickupLocation?.address  || '—';
  const dropoffAddr = t.dropoffLocation?.address || '—';

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
        const rName  = r.riderId ? `${r.riderId.firstName} ${r.riderId.lastName}` : 'Unknown';
        const rPhone = r.riderId?.phone || '—';
        const rFare  = r.fare != null ? `₹${r.fare.toFixed(0)}` : '—';
        const rBadge = riderStatusBadge(r.status);
        return `
          <div class="rider-item">
            <div class="rider-name">${escTripHtml(rName)}</div>
            <div class="rider-meta">
              <span class="cell-mono text-muted" style="font-size:.75rem">${escTripHtml(rPhone)}</span>
              <span class="badge ${rBadge}">${r.status}</span>
              <span style="font-size:.8125rem;color:var(--cyan)">${rFare}</span>
            </div>
          </div>
        `;
      }).join('');

  // Force-action buttons (only for active trips)
  const actionButtons = t.status === 'active' ? `
    <div class="drawer-section-title">Admin Actions</div>
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
      >✗ Force Cancel</button>
    </div>
    <div style="font-size:.75rem;color:var(--text-dim);margin-top:.5rem">
      These actions are permanent and logged. Use only when a trip is stuck.
    </div>
  ` : '';

  return `
    <!-- Trip header -->
    <div class="trip-drawer-header">
      <div>
        <div class="trip-code-large">${escTripHtml(t.tripCode || '—')}</div>
        <span class="badge ${tripStatusBadgeClass(t.status)}">${t.status}</span>
      </div>
    </div>

    <!-- Route -->
    <div class="drawer-section-title">Route</div>
    <div class="route-block">
      <div class="route-point route-from">
        <span class="route-dot dot-green"></span>
        <span>${escTripHtml(pickupAddr)}</span>
      </div>
      <div class="route-line"></div>
      <div class="route-point route-to">
        <span class="route-dot dot-rose"></span>
        <span>${escTripHtml(dropoffAddr)}</span>
      </div>
    </div>

    <!-- Timeline -->
    <div class="drawer-section-title">Timeline</div>
    <div class="drawer-grid">
      <div class="drawer-field"><span class="field-label">Started</span><span class="field-value">${fmt(t.startTime)}</span></div>
      <div class="drawer-field"><span class="field-label">Ended</span><span class="field-value">${fmt(t.endTime)}</span></div>
    </div>

    <!-- Driver -->
    <div class="drawer-section-title">Driver</div>
    <div class="drawer-grid">
      <div class="drawer-field"><span class="field-label">Name</span><span class="field-value">${escTripHtml(driver)}</span></div>
      <div class="drawer-field"><span class="field-label">Phone</span><span class="field-value">${escTripHtml(driverPh)}</span></div>
      <div class="drawer-field"><span class="field-label">Rating</span><span class="field-value">${driverRating}</span></div>
      <div class="drawer-field"><span class="field-label">Vehicle</span><span class="field-value">${t.vehicle}</span></div>
      <div class="drawer-field"><span class="field-label">Seats</span><span class="field-value">${t.occupiedSeats}/${t.availableSeats + t.occupiedSeats}</span></div>
    </div>

    <!-- Fare -->
    ${fareRows ? `<div class="drawer-section-title">Fare</div><div class="drawer-grid">${fareRows}</div>` : ''}

    <!-- Riders -->
    <div class="drawer-section-title">Riders (${t.riders?.length ?? 0})</div>
    <div class="riders-list">${ridersHtml}</div>

    <!-- Admin actions -->
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
