/**
 * admin-users.js
 * ─────────────────────────────────────────────────────────────────────────────
 * All JavaScript for the User Management section of the admin dashboard.
 *
 * Loaded by dashboard.html. Requires admin-api.js to already be loaded.
 *
 * Features:
 *   - Search input with debounce (waits 400ms after typing before fetching)
 *   - Filter dropdowns: userType, idVerified, phoneVerified, blocked, simulation
 *   - Paginated user table
 *   - Clicking a row opens a slide-in detail drawer
 *   - Drawer: full profile, flag count, verify/unverify toggles, block/unblock button
 *   - Block action requires a reason (collected via a modal overlay)
 */

// ─── State ────────────────────────────────────────────────────────────────────
// These variables track the current page and filters for the users list.
let usersPage       = 1;
let usersTotalPages = 1;
let usersFilters    = {
  search:       '',
  userType:     '',
  idVerified:   '',
  phoneVerified: '',
  blocked:      '',
  simulation:   '',
};

// Debounce timer for the search input
let searchDebounceTimer = null;

// Currently open user (stored so the drawer can refresh itself after an action)
let currentDrawerUserId = null;

// ─── Entry point ──────────────────────────────────────────────────────────────
// Called by admin-app.js after the DOM is ready.
function initUsersSection() {
  // Wire up the search input with a 400ms debounce so we don't fire on every keystroke
  const searchInput = document.getElementById('user-search');
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      clearTimeout(searchDebounceTimer);
      searchDebounceTimer = setTimeout(() => {
        usersFilters.search = searchInput.value.trim();
        loadUsers(1); // Reset to page 1 on new search
      }, 400);
    });
  }

  // Wire up filter dropdowns — each change immediately re-fetches page 1
  ['filter-usertype', 'filter-idverified', 'filter-phoneverified',
   'filter-blocked', 'filter-simulation'].forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('change', () => {
      usersFilters[el.dataset.filter] = el.value;
      loadUsers(1);
    });
  });

  // Drawer close button
  document.getElementById('drawer-close-btn')?.addEventListener('click', closeDrawer);

  // Block modal cancel button
  document.getElementById('block-modal-cancel')?.addEventListener('click', closeBlockModal);

  // Load the first page
  loadUsers(1);
}

// ─── Load users list ──────────────────────────────────────────────────────────
async function loadUsers(page = 1) {
  usersPage = page;

  const tbody    = document.getElementById('users-tbody');
  const pageInfo = document.getElementById('users-page-info');
  const prevBtn  = document.getElementById('users-prev');
  const nextBtn  = document.getElementById('users-next');
  const countEl  = document.getElementById('users-count');

  if (!tbody) return;

  // Show loading placeholder
  tbody.innerHTML = '<tr><td colspan="8" class="table-placeholder">Loading…</td></tr>';

  // Build query string from current filters
  const params = new URLSearchParams({
    page,
    limit: 20,
    ...Object.fromEntries(
      Object.entries(usersFilters).filter(([, v]) => v !== '')
    ),
  });

  try {
    const data = await AdminAPI.get(`/users?${params.toString()}`);

    usersTotalPages = data.pages || 1;

    // Update header count and pagination
    if (countEl)  countEl.textContent  = `${data.total} user${data.total !== 1 ? 's' : ''}`;
    if (pageInfo) pageInfo.textContent = `Page ${data.page} of ${data.pages}`;
    if (prevBtn)  prevBtn.disabled     = data.page <= 1;
    if (nextBtn)  nextBtn.disabled     = data.page >= data.pages;

    // Empty state
    if (!data.users || data.users.length === 0) {
      tbody.innerHTML = '<tr><td colspan="8" class="table-placeholder">No users match the current filters.</td></tr>';
      return;
    }

    // Render table rows
    tbody.innerHTML = data.users.map((u) => buildUserRow(u)).join('');

    // Attach click handlers to each row so clicking opens the detail drawer
    tbody.querySelectorAll('.user-row').forEach((row) => {
      row.addEventListener('click', () => openDrawer(row.dataset.userId));
    });

  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="8" class="table-placeholder table-error">Error: ${err.message}</td></tr>`;
  }
}

// ─── Build a single table row ─────────────────────────────────────────────────
function buildUserRow(u) {
  const name     = `${u.firstName} ${u.lastName}`;
  const typeIcon = u.userType === 'driver' ? '🚗' : u.userType === 'rider' ? '🧍' : '🔄';
  const idBadge  = u.idVerified    ? '<span class="badge badge-success">✓ ID</span>' : '<span class="badge badge-dim">✗ ID</span>';
  const phBadge  = u.phoneVerified ? '<span class="badge badge-success">✓ Ph</span>'  : '<span class="badge badge-dim">✗ Ph</span>';
  const flagCell = u.flagCount > 0
    ? `<span class="flag-count ${u.flagCount >= 3 ? 'flag-high' : 'flag-low'}">🚩 ${u.flagCount}</span>`
    : '<span class="text-dim">—</span>';
  const simBadge = u.isSimulation ? '<span class="badge badge-warning">SIM</span>' : '';
  const statusBadge = u.isBlocked
    ? '<span class="badge badge-danger">Blocked</span>'
    : '<span class="badge badge-success">Active</span>';

  return `
    <tr class="user-row" data-user-id="${u._id}" title="Click to view profile">
      <td>
        <div class="user-name-cell">
          <span class="user-name">${escHtml(name)}</span>
          ${simBadge}
        </div>
      </td>
      <td class="cell-mono text-muted">${escHtml(u.email)}</td>
      <td>${typeIcon} ${u.userType}</td>
      <td>${idBadge} ${phBadge}</td>
      <td>${flagCell}</td>
      <td>${statusBadge}</td>
      <td class="text-dim cell-mono">${new Date(u.createdAt).toLocaleDateString('en-IN')}</td>
      <td>
        <button class="btn-sm btn-view" onclick="event.stopPropagation(); openDrawer('${u._id}')">View →</button>
      </td>
    </tr>
  `;
}

// ─── Detail drawer ────────────────────────────────────────────────────────────
async function openDrawer(userId) {
  currentDrawerUserId = userId;

  const drawer  = document.getElementById('user-drawer');
  const content = document.getElementById('drawer-content');

  if (!drawer || !content) return;

  // Show the drawer with a loading state
  drawer.classList.add('drawer-open');
  content.innerHTML = '<div class="drawer-loading">Loading…</div>';

  try {
    const data = await AdminAPI.get(`/users/${userId}`);
    content.innerHTML = buildDrawerContent(data);

    // Wire up verify / block buttons inside the drawer
    wireDrawerButtons(data.user);

  } catch (err) {
    content.innerHTML = `<div class="drawer-error">Error: ${err.message}</div>`;
  }
}

function closeDrawer() {
  const drawer = document.getElementById('user-drawer');
  if (drawer) drawer.classList.remove('drawer-open');
  currentDrawerUserId = null;
}

// ─── Build drawer inner HTML ──────────────────────────────────────────────────
function buildDrawerContent(data) {
  const u = data.user;
  const name = `${u.firstName} ${u.lastName}`;

  // Helper to format dates
  const fmt = (d) => d ? new Date(d).toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' }) : '—';

  // Block / unblock button
  const blockBtn = u.isBlocked
    ? `<button id="drawer-block-btn" class="btn-action btn-unblock" data-user-id="${u._id}" data-action="unblock">✓ Unblock User</button>`
    : `<button id="drawer-block-btn" class="btn-action btn-block"   data-user-id="${u._id}" data-action="block">🚫 Block User</button>`;

  // Recent trips as driver
  const driverTrips = data.recentAsDriver.length === 0
    ? '<div class="trip-empty">No trips as driver yet.</div>'
    : data.recentAsDriver.map((t) => `
        <div class="trip-row">
          <span class="trip-code">${t.tripCode || '—'}</span>
          <span class="badge ${tripStatusBadge(t.status)}">${t.status}</span>
          <span class="text-dim">${fmt(t.startTime)}</span>
        </div>
      `).join('');

  // Recent trips as rider
  const riderTrips = data.recentAsRider.length === 0
    ? '<div class="trip-empty">No trips as rider yet.</div>'
    : data.recentAsRider.map((t) => {
        const driverName = t.driver ? `${t.driver.firstName} ${t.driver.lastName}` : '—';
        return `
          <div class="trip-row">
            <span class="trip-code">${t.tripCode || '—'}</span>
            <span class="badge ${tripStatusBadge(t.status)}">${t.status}</span>
            <span class="text-dim">Driver: ${escHtml(driverName)}</span>
          </div>
        `;
      }).join('');

  return `
    <!-- Header -->
    <div class="drawer-header">
      <div class="drawer-avatar">${u.firstName[0]}${u.lastName[0]}</div>
      <div>
        <div class="drawer-name">${escHtml(name)}</div>
        <div class="drawer-email">${escHtml(u.email)}</div>
      </div>
    </div>

    <!-- Status row -->
    <div class="drawer-status-row">
      ${u.isBlocked
        ? `<span class="badge badge-danger">⛔ Blocked</span>`
        : `<span class="badge badge-success">✓ Active</span>`}
      ${u.isSimulation ? '<span class="badge badge-warning">Simulation</span>' : ''}
      ${u.isAdmin ? '<span class="badge badge-info">Admin</span>' : ''}
      ${data.flagCount > 0
        ? `<span class="badge ${data.flagCount >= 3 ? 'badge-danger' : 'badge-warning'}">🚩 ${data.flagCount} flag${data.flagCount !== 1 ? 's' : ''}</span>`
        : ''}
    </div>

    ${u.isBlocked && u.blockReason ? `
      <div class="block-reason-box">
        <span class="text-dim">Block reason:</span> ${escHtml(u.blockReason)}
      </div>
    ` : ''}

    <!-- Profile details -->
    <div class="drawer-section-title">Profile</div>
    <div class="drawer-grid">
      <div class="drawer-field"><span class="field-label">Phone</span><span class="field-value">${escHtml(u.phone || '—')}</span></div>
      <div class="drawer-field"><span class="field-label">Type</span><span class="field-value">${u.userType}</span></div>
      <div class="drawer-field"><span class="field-label">Rating</span><span class="field-value">${u.rating ? u.rating.toFixed(1) + ' ⭐' : '—'}</span></div>
      <div class="drawer-field"><span class="field-label">Total Rides</span><span class="field-value">${u.totalRides ?? '—'}</span></div>
      <div class="drawer-field"><span class="field-label">Joined</span><span class="field-value">${fmt(u.createdAt)}</span></div>
    </div>

    <!-- Verification controls -->
    <div class="drawer-section-title">Verification</div>
    <div class="verify-row">
      <div class="verify-item">
        <span class="verify-label">ID Verification</span>
        <span class="badge ${u.idVerified ? 'badge-success' : 'badge-dim'}">${u.idVerified ? '✓ Verified' : '✗ Not verified'}</span>
        <button
          id="btn-verify-id"
          class="btn-sm ${u.idVerified ? 'btn-unverify' : 'btn-verify'}"
          data-user-id="${u._id}"
          data-field="id"
          data-action="${u.idVerified ? 'unverify' : 'verify'}"
        >${u.idVerified ? 'Revoke' : 'Verify'}</button>
      </div>
      <div class="verify-item">
        <span class="verify-label">Phone Verification</span>
        <span class="badge ${u.phoneVerified ? 'badge-success' : 'badge-dim'}">${u.phoneVerified ? '✓ Verified' : '✗ Not verified'}</span>
        <button
          id="btn-verify-phone"
          class="btn-sm ${u.phoneVerified ? 'btn-unverify' : 'btn-verify'}"
          data-user-id="${u._id}"
          data-field="phone"
          data-action="${u.phoneVerified ? 'unverify' : 'verify'}"
        >${u.phoneVerified ? 'Revoke' : 'Verify'}</button>
      </div>
    </div>

    <!-- Block / unblock -->
    <div class="drawer-section-title">Account Status</div>
    <div class="block-action-row">
      ${blockBtn}
    </div>

    <!-- Recent trips as driver -->
    <div class="drawer-section-title">Recent Trips as Driver</div>
    <div class="trips-list">${driverTrips}</div>

    <!-- Recent trips as rider -->
    <div class="drawer-section-title">Recent Trips as Rider</div>
    <div class="trips-list">${riderTrips}</div>
  `;
}

// ─── Wire up buttons inside the drawer ───────────────────────────────────────
function wireDrawerButtons(user) {
  // Verify ID button
  document.getElementById('btn-verify-id')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    await handleVerify(btn.dataset.userId, btn.dataset.field, btn.dataset.action);
  });

  // Verify Phone button
  document.getElementById('btn-verify-phone')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    await handleVerify(btn.dataset.userId, btn.dataset.field, btn.dataset.action);
  });

  // Block / Unblock button
  document.getElementById('drawer-block-btn')?.addEventListener('click', (e) => {
    const btn = e.currentTarget;
    if (btn.dataset.action === 'block') {
      openBlockModal(btn.dataset.userId);
    } else {
      handleUnblock(btn.dataset.userId);
    }
  });
}

// ─── Verify / unverify action ─────────────────────────────────────────────────
async function handleVerify(userId, field, action) {
  const label   = field === 'id' ? 'ID' : 'Phone';
  const confirm = window.confirm(`${action === 'verify' ? 'Mark' : 'Revoke'} ${label} verification for this user?`);
  if (!confirm) return;

  try {
    const result = await AdminAPI.put(`/users/${userId}/verify`, { field, action });
    showToast(result.message, 'success');
    // Refresh the drawer with updated data
    await openDrawer(userId);
    // Also refresh the table row
    loadUsers(usersPage);
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ─── Block modal ──────────────────────────────────────────────────────────────
function openBlockModal(userId) {
  const modal = document.getElementById('block-modal');
  if (!modal) return;

  // Clear previous reason text
  const textarea = document.getElementById('block-reason-input');
  if (textarea) textarea.value = '';

  // Store userId on the confirm button so the submit handler knows which user
  const confirmBtn = document.getElementById('block-modal-confirm');
  if (confirmBtn) {
    confirmBtn.dataset.userId = userId;
    // Replace old listener to avoid stacking multiple listeners
    const newBtn = confirmBtn.cloneNode(true);
    confirmBtn.parentNode.replaceChild(newBtn, confirmBtn);
    newBtn.addEventListener('click', () => submitBlock(userId));
  }

  modal.classList.add('modal-open');
  // Focus the textarea so the admin can type right away
  setTimeout(() => textarea?.focus(), 50);
}

function closeBlockModal() {
  const modal = document.getElementById('block-modal');
  if (modal) modal.classList.remove('modal-open');
}

async function submitBlock(userId) {
  const reason = document.getElementById('block-reason-input')?.value?.trim();
  if (!reason) {
    showToast('Please enter a reason before blocking.', 'error');
    return;
  }

  try {
    const result = await AdminAPI.put(`/users/${userId}/block`, { action: 'block', reason });
    showToast(result.message, 'success');
    closeBlockModal();
    await openDrawer(userId);
    loadUsers(usersPage);
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function handleUnblock(userId) {
  const ok = window.confirm('Unblock this user? They will be able to use the app again.');
  if (!ok) return;

  try {
    const result = await AdminAPI.put(`/users/${userId}/block`, { action: 'unblock', reason: '' });
    showToast(result.message, 'success');
    await openDrawer(userId);
    loadUsers(usersPage);
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ─── Toast notification ───────────────────────────────────────────────────────
// A small notification that slides in from the bottom-right and disappears.
function showToast(message, type = 'info') {
  const existing = document.getElementById('admin-toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.id = 'admin-toast';
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);

  // Trigger slide-in animation after a tiny delay so CSS transition works
  requestAnimationFrame(() => { requestAnimationFrame(() => { toast.classList.add('toast-visible'); }); });

  // Auto-remove after 3 seconds
  setTimeout(() => {
    toast.classList.remove('toast-visible');
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
/** Returns the badge CSS class for a trip status string */
function tripStatusBadge(status) {
  if (status === 'completed') return 'badge-success';
  if (status === 'cancelled') return 'badge-danger';
  return 'badge-info'; // active
}

/** Escapes HTML special chars to prevent XSS when rendering user data */
function escHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ─── Pagination buttons (called from HTML onclick) ────────────────────────────
function usersPrev() { if (usersPage > 1)             loadUsers(usersPage - 1); }
function usersNext() { if (usersPage < usersTotalPages) loadUsers(usersPage + 1); }
