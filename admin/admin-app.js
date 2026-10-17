/**
 * admin-app.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Master orchestrator for the QuickPull Admin Console (admin/dashboard.html).
 * Follows Apple Design HIG for fluid interfaces, responsive navigation,
 * and live executive operations telemetry.
 *
 * Core Features:
 *   - Auth guard & auto-redirect
 *   - macOS-style sidebar navigation with tactile active feedback
 *   - Executive Operations Dashboard with live database aggregate telemetry
 *   - Audit Log table with pagination & action categorization
 *   - Dynamic user profile & RBAC management
 *   - Real-time ride dispatch & Leaflet tracking
 */

// ═══════════════════════════════════════════════════════════════════════════
// APPLE APPEARANCE & THEME MANAGEMENT (apple-design skill §10, §14)
// ═══════════════════════════════════════════════════════════════════════════
window.initThemeSwitcher = function initThemeSwitcher() {
  const lightBtn = document.getElementById('theme-btn-light');
  const darkBtn  = document.getElementById('theme-btn-dark');

  function setTheme(theme, save = true) {
    document.documentElement.setAttribute('data-theme', theme);
    if (save) {
      try {
        localStorage.setItem('admin_theme', theme);
      } catch (e) { }
    }

    const isDark = theme === 'dark';
    if (darkBtn) {
      darkBtn.classList.toggle('active', isDark);
      darkBtn.setAttribute('aria-checked', String(isDark));
    }
    if (lightBtn) {
      lightBtn.classList.toggle('active', !isDark);
      lightBtn.setAttribute('aria-checked', String(!isDark));
    }

    // Refresh Leaflet map tiles if active
    if (window.currentTripMap && typeof window.currentTripMap.invalidateSize === 'function') {
      setTimeout(() => window.currentTripMap.invalidateSize(), 150);
    }
  }

  // Read current theme: document attribute > localStorage > system preference
  const currentTheme = document.documentElement.getAttribute('data-theme') ||
    localStorage.getItem('admin_theme') ||
    (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');

  setTheme(currentTheme, false);

  lightBtn?.addEventListener('click', (e) => {
    e.preventDefault();
    setTheme('light', true);
  });

  darkBtn?.addEventListener('click', (e) => {
    e.preventDefault();
    setTheme('dark', true);
  });

  // Listen for system appearance change if user has not set an explicit override
  if (window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
      if (!localStorage.getItem('admin_theme')) {
        setTheme(e.matches ? 'dark' : 'light', false);
      }
    });
  }
}

document.addEventListener('DOMContentLoaded', async () => {

  // ── Auth guard ─────────────────────────────────────────────────────────────
  if (!AdminAPI.requireLogin()) return;

  // ── Admin Identity in Sidebar ─────────────────────────────────────────────
  const adminUser = AdminAPI.getAdminUser();
  if (adminUser) {
    const nameEl   = document.getElementById('sidebar-admin-name');
    const emailEl  = document.getElementById('sidebar-admin-email');
    const avatarEl = document.getElementById('sidebar-admin-avatar');

    const fullName = `${adminUser.firstName || 'System'} ${adminUser.lastName || 'Admin'}`.trim();
    if (nameEl)  nameEl.textContent  = fullName;
    if (emailEl) emailEl.textContent = adminUser.email || 'admin@quickpull.com';

    if (avatarEl) {
      const f = (adminUser.firstName || 'A')[0];
      const l = (adminUser.lastName || '')[0] || '';
      avatarEl.textContent = `${f}${l}`.toUpperCase();
    }
  }

  // ── Sign Out Button ───────────────────────────────────────────────────────
  document.getElementById('logout-btn')?.addEventListener('click', () => {
    if (window.confirm('Are you sure you want to sign out of the QuickPull Admin Console?')) {
      AdminAPI.logout();
    }
  });

  // ── Sidebar Section Navigation ───────────────────────────────────────────
  document.querySelectorAll('[data-section]').forEach((link) => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const sectionId = link.dataset.section;
      showSection(sectionId);

      // Update active nav styling
      document.querySelectorAll('[data-section]').forEach((l) => l.classList.remove('nav-active'));
      link.classList.add('nav-active');
    });
  });

  // Start on Dashboard overview (Executive Command Center)
  showSection('dashboard');
  document.querySelector('[data-section="dashboard"]')?.classList.add('nav-active');

  // ── Initialize Apple Appearance & Theme Mode ──────────────────────────────
  initThemeSwitcher();
});

// ─── Section Switcher ───────────────────────────────────────────────────────
const SECTION_TITLES = {
  'dashboard': 'Operations Overview',
  'users':     'User Management & RBAC',
  'trips':     'Trip Management & Dispatch',
  'audit-log': 'Security Audit Log',
};

const initialisedSections = new Set();

function showSection(sectionId) {
  document.querySelectorAll('.content-section').forEach((s) => {
    s.style.display = 'none';
  });

  const target = document.getElementById(`section-${sectionId}`);
  if (target) {
    target.style.display = 'block';
  }

  // Update topbar title
  const titleEl = document.getElementById('topbar-title');
  if (titleEl) {
    titleEl.textContent = SECTION_TITLES[sectionId] || sectionId;
  }

  // Section-specific loader
  if (sectionId === 'dashboard') {
    initDashboardSection();
  } else if (sectionId === 'users' && !initialisedSections.has('users')) {
    initialisedSections.add('users');
    if (typeof initUsersSection === 'function') initUsersSection();
  } else if (sectionId === 'trips' && !initialisedSections.has('trips')) {
    initialisedSections.add('trips');
    if (typeof initTripsSection === 'function') initTripsSection();
  } else if (sectionId === 'audit-log' && !initialisedSections.has('audit-log')) {
    initialisedSections.add('audit-log');
    loadAuditLog(1);
  }
}

// ─── Executive Dashboard Telemetry Loader ───────────────────────────────────
async function initDashboardSection() {
  const syncBtn        = document.getElementById('dash-sync-btn');
  if (syncBtn) {
    syncBtn.disabled = true;
    syncBtn.innerHTML = '<span class="loading-spinner"></span> Syncing…';
  }

  const elTotalUsers   = document.getElementById('dash-total-users');
  const elDrivers      = document.getElementById('dash-drivers-count');
  const elRiders       = document.getElementById('dash-riders-count');
  const fill1          = document.getElementById('dash-ratio-drivers');
  const fill2          = document.getElementById('dash-ratio-riders');

  const elTotalTrips   = document.getElementById('dash-total-trips');
  const elActiveTrips  = document.getElementById('dash-active-trips');
  const elCompletedTrips = document.getElementById('dash-completed-trips');

  const elTotalLogs    = document.getElementById('dash-total-logs');
  const elBlocked      = document.getElementById('dash-blocked-users');
  const elVerified     = document.getElementById('dash-verified-users');

  try {
    // Concurrently fetch aggregate metrics from live database
    const [
      usersRes,
      blockedRes,
      driversRes,
      ridersRes,
      bothRes,
      verifiedIdRes,
      verifiedPhoneRes,
      tripsRes,
      activeTripsRes,
      completedTripsRes,
      logsRes
    ] = await Promise.allSettled([
      AdminAPI.get('/users?limit=1'),
      AdminAPI.get('/users?blocked=true&limit=1'),
      AdminAPI.get('/users?userType=driver&limit=1'),
      AdminAPI.get('/users?userType=rider&limit=1'),
      AdminAPI.get('/users?userType=both&limit=1'),
      AdminAPI.get('/users?idVerified=true&limit=1'),
      AdminAPI.get('/users?phoneVerified=true&limit=1'),
      AdminAPI.get('/trips?limit=5'),
      AdminAPI.get('/trips?status=active&limit=1'),
      AdminAPI.get('/trips?status=completed&limit=1'),
      AdminAPI.get('/logs?limit=1')
    ]);

    const totalUsers     = usersRes.status === 'fulfilled' ? (usersRes.value.total ?? 0) : 0;
    const blockedUsers   = blockedRes.status === 'fulfilled' ? (blockedRes.value.total ?? 0) : 0;
    const driversOnly    = driversRes.status === 'fulfilled' ? (driversRes.value.total ?? 0) : 0;
    const ridersOnly     = ridersRes.status === 'fulfilled' ? (ridersRes.value.total ?? 0) : 0;
    const bothUsers      = bothRes.status === 'fulfilled' ? (bothRes.value.total ?? 0) : 0;

    // In QuickPull, users with userType='both' can offer trips as driver and book trips as rider
    const totalDrivers   = driversOnly + bothUsers;
    const totalRiders    = ridersOnly + bothUsers;
    const verifiedId     = verifiedIdRes.status === 'fulfilled' ? (verifiedIdRes.value.total ?? 0) : 0;
    const verifiedPhone  = verifiedPhoneRes.status === 'fulfilled' ? (verifiedPhoneRes.value.total ?? 0) : 0;

    const totalTrips     = tripsRes.status === 'fulfilled' ? (tripsRes.value.total ?? 0) : 0;
    const activeTrips    = activeTripsRes.status === 'fulfilled' ? (activeTripsRes.value.total ?? 0) : 0;
    const completedTrips = completedTripsRes.status === 'fulfilled' ? (completedTripsRes.value.total ?? 0) : 0;
    const recentTrips    = (tripsRes.status === 'fulfilled' && Array.isArray(tripsRes.value.trips)) ? tripsRes.value.trips : [];

    const totalLogs      = logsRes.status === 'fulfilled' ? (logsRes.value.total ?? 0) : 0;

    // ── Metric Card 1: Users & Driver/Rider Distribution ─────────────────────
    if (elTotalUsers) elTotalUsers.textContent = Number(totalUsers).toLocaleString();
    if (elDrivers) {
      elDrivers.textContent = `Drivers: ${Number(totalDrivers).toLocaleString()}${bothUsers > 0 && bothUsers === totalUsers ? ' (Dual-Role)' : ''}`;
    }
    if (elRiders) {
      elRiders.textContent = `Riders: ${Number(totalRiders).toLocaleString()}`;
    }

    if (fill1 && fill2) {
      const sum = totalDrivers + totalRiders;
      const driverPercent = sum > 0 ? Math.round((totalDrivers / sum) * 100) : 50;
      fill1.style.width = `${driverPercent}%`;
      fill2.style.width = `${100 - driverPercent}%`;
    }

    // ── Metric Card 2: Fleet Activity ────────────────────────────────────────
    if (elTotalTrips)     elTotalTrips.textContent     = Number(totalTrips).toLocaleString();
    if (elActiveTrips)    elActiveTrips.textContent    = `Active: ${Number(activeTrips).toLocaleString()}`;
    if (elCompletedTrips) elCompletedTrips.textContent = `Completed: ${Number(completedTrips).toLocaleString()}`;

    // ── Metric Card 3: Security Logs ─────────────────────────────────────────
    if (elTotalLogs)      elTotalLogs.textContent      = Number(totalLogs).toLocaleString();

    // ── Metric Card 4: Moderation & Identity ─────────────────────────────────
    if (elBlocked)        elBlocked.textContent        = Number(blockedUsers).toLocaleString();
    if (elVerified)       elVerified.textContent       = `ID Verified: ${Number(verifiedId).toLocaleString()}`;

    // ── Right Panel: Platform & Security Vitals ──────────────────────────────
    const idRate    = totalUsers > 0 ? Math.round((verifiedId / totalUsers) * 100) : 0;
    const phoneRate = totalUsers > 0 ? Math.round((verifiedPhone / totalUsers) * 100) : 0;
    const tripRate  = totalTrips > 0 ? Math.round((completedTrips / totalTrips) * 100) : 0;

    const elIdRate    = document.getElementById('dash-vital-id-rate');
    const elIdBar     = document.getElementById('dash-vital-id-bar');
    const elPhoneRate = document.getElementById('dash-vital-phone-rate');
    const elPhoneBar  = document.getElementById('dash-vital-phone-bar');
    const elTripRate  = document.getElementById('dash-vital-trip-rate');
    const elTripBar   = document.getElementById('dash-vital-trip-bar');

    if (elIdRate)    elIdRate.textContent    = `${idRate}% (${verifiedId}/${totalUsers})`;
    if (elIdBar)     elIdBar.style.width     = `${Math.max(idRate, 4)}%`;
    if (elPhoneRate) elPhoneRate.textContent = `${phoneRate}% (${verifiedPhone}/${totalUsers})`;
    if (elPhoneBar)  elPhoneBar.style.width  = `${Math.max(phoneRate, 4)}%`;
    if (elTripRate)  elTripRate.textContent  = `${tripRate}% (${completedTrips}/${totalTrips})`;
    if (elTripBar)   elTripBar.style.width   = `${Math.max(tripRate, 4)}%`;

    // ── Left Panel: Live Dispatch Activity Stream ────────────────────────────
    const elRecentList = document.getElementById('dash-recent-trips');
    if (elRecentList) {
      if (recentTrips.length === 0) {
        elRecentList.innerHTML = '<div class="table-placeholder">No dispatch activity recorded yet.</div>';
      } else {
        elRecentList.innerHTML = recentTrips.map((t) => {
          const driverName = t.driver ? `${t.driver.firstName || ''} ${t.driver.lastName || ''}`.trim() : 'Unassigned';
          const driverId = t.driver?._id || (typeof t.driver === 'string' ? t.driver : '');
          const vehicleIcon = { car: '🚗', bike: '🏍️', ev: '⚡' }[t.vehicle] || '🚗';
          const statusClass = (typeof tripStatusBadgeClass === 'function') ? tripStatusBadgeClass(t.status) : 'badge-info';
          const time = t.startTime ? new Date(t.startTime).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
          const fare = t.totalFare != null ? `₹${Number(t.totalFare).toFixed(0)}` : '—';
          const pickupShort = (t.pickupLocation?.address || 'Pickup').split(',')[0];
          const dropoffShort = (t.dropoffLocation?.address || 'Dropoff').split(',')[0];

          return `
            <div class="recent-trip-item" onclick="openTripDrawer('${t._id}', '${driverId}')" title="Click to view full route and driver details">
              <div style="display:flex;align-items:center;gap:.75rem;min-width:0;">
                <div style="font-size:1.25rem;flex-shrink:0;">${vehicleIcon}</div>
                <div style="min-width:0;">
                  <div style="display:flex;align-items:center;gap:.5rem;flex-wrap:wrap;">
                    <span class="cell-mono" style="font-weight:700;color:var(--cyan);font-size:.8125rem;">${t.tripCode || '—'}</span>
                    <span style="font-size:.75rem;color:var(--text);font-weight:600;">${driverName}</span>
                  </div>
                  <div style="font-size:.6875rem;color:var(--text-dim);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:280px;margin-top:.15rem;">
                    📍 ${pickupShort} → 🏁 ${dropoffShort}
                  </div>
                </div>
              </div>
              <div style="display:flex;flex-direction:column;align-items:flex-end;gap:.25rem;flex-shrink:0;">
                <span class="badge ${statusClass}" style="font-size:.625rem;">${t.status}</span>
                <span style="font-size:.6875rem;color:var(--text-dim);font-family:var(--font-mono);">${time} · <strong style="color:var(--text)">${fare}</strong></span>
              </div>
            </div>
          `;
        }).join('');
      }
    }

  } catch (err) {
    console.warn('Dashboard telemetry fetch notice:', err.message);
  } finally {
    if (syncBtn) {
      syncBtn.disabled = false;
      syncBtn.innerHTML = '<span>⟳</span> Sync Telemetry';
    }
  }
}

// ─── Audit Log Loader ───────────────────────────────────────────────────────
let auditPage       = 1;
let auditTotalPages = 1;

async function loadAuditLog(page) {
  auditPage = page;

  const tbody    = document.getElementById('audit-log-tbody');
  const pageInfo = document.getElementById('audit-page-info');
  const prevBtn  = document.getElementById('audit-prev');
  const nextBtn  = document.getElementById('audit-next');

  if (!tbody) return;

  // Apple-style loading state
  tbody.innerHTML = '<tr><td colspan="5" class="table-placeholder">Retrieving security audit ledger…</td></tr>';

  try {
    const data = await AdminAPI.get(`/logs?page=${page}&limit=20`);

    auditTotalPages = data.pages || 1;

    // Update pagination controls
    if (pageInfo) pageInfo.textContent = `Page ${data.page} of ${data.pages} · ${data.total} total events`;
    if (prevBtn)  prevBtn.disabled = data.page <= 1;
    if (nextBtn)  nextBtn.disabled = data.page >= data.pages;

    // Empty state
    if (!data.logs || data.logs.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" class="table-placeholder">No security audit records found.</td></tr>';
      return;
    }

    // Render table rows with Apple badge and tabular numerals
    tbody.innerHTML = data.logs.map((log) => {
      const adminName = log.adminId
        ? `${log.adminId.firstName || ''} ${log.adminId.lastName || ''}`.trim() || 'Admin'
        : '—';

      const target = log.targetType
        ? `${log.targetType}`
        : '—';

      const ip   = log.ip || '—';
      const time = new Date(log.createdAt).toLocaleString('en-IN', {
        day:    '2-digit', month: 'short', year: 'numeric',
        hour:   '2-digit', minute: '2-digit', second: '2-digit'
      });

      const action     = log.action || '—';
      const badgeClass = getBadgeClass(action);

      return `
        <tr class="log-row">
          <td class="cell-mono">${time}</td>
          <td style="font-weight:600;color:var(--text)">${adminName}</td>
          <td><span class="badge ${badgeClass}">${action}</span></td>
          <td class="cell-mono">${target}</td>
          <td class="cell-mono">${ip}</td>
        </tr>
      `;
    }).join('');

  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="5" class="table-placeholder table-error">Ledger retrieval error: ${err.message}</td></tr>`;
  }
}

/** Returns the Apple Design badge class based on action severity */
function getBadgeClass(action) {
  if (action.includes('FAIL')   || action.includes('BLOCK'))  return 'badge-danger';
  if (action.includes('SUCCESS')|| action.includes('VERIFY')) return 'badge-success';
  if (action.includes('WARN')   || action.includes('FORCE'))  return 'badge-warning';
  return 'badge-info';
}

function auditPrev() { if (auditPage > 1)            loadAuditLog(auditPage - 1); }
function auditNext() { if (auditPage < auditTotalPages) loadAuditLog(auditPage + 1); }


