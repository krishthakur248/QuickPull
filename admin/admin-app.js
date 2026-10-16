/**
 * admin-app.js
 * ─────────────────────────────────────────────────────────────────────────────
 * JavaScript for the admin dashboard (admin/dashboard.html).
 *
 * Phase 1 features (working now):
 *   - Auth guard: redirects to login if no token
 *   - Shows admin's name in the sidebar
 *   - Sidebar navigation between content sections
 *   - Audit log table with pagination
 *
 * Future sections (Users, Trips, Dashboard) are visible in the nav but
 * show a "Coming in Phase N" placeholder until those phases are built.
 */

document.addEventListener('DOMContentLoaded', async () => {

  // ── Auth guard ───────────────────────────────────────────────────────────────
  // This is a convenience check. The real protection is on the server.
  if (!AdminAPI.requireLogin()) return;

  // ── Show admin's name in the sidebar ────────────────────────────────────────
  const adminUser = AdminAPI.getAdminUser();
  if (adminUser) {
    const nameEl  = document.getElementById('sidebar-admin-name');
    const emailEl = document.getElementById('sidebar-admin-email');
    if (nameEl)  nameEl.textContent  = `${adminUser.firstName} ${adminUser.lastName}`;
    if (emailEl) emailEl.textContent = adminUser.email;
  }

  // ── Logout button ────────────────────────────────────────────────────────────
  document.getElementById('logout-btn')?.addEventListener('click', () => {
    if (confirm('Are you sure you want to log out?')) {
      AdminAPI.logout();
    }
  });

  // ── Section navigation ───────────────────────────────────────────────────────
  // Each nav link has a data-section="<id>" attribute.
  // Clicking it shows #section-<id> and hides all others.
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

  // Start on the audit log section (the only working section in Phase 1)
  showSection('audit-log');
  // Mark Audit Log nav item as active on load
  document.querySelector('[data-section="audit-log"]')?.classList.add('nav-active');

  // Load the first page of the audit log
  await loadAuditLog(1);
});

// ─── Section switcher ─────────────────────────────────────────────────────────
// Section titles shown in the topbar when you switch sections
const SECTION_TITLES = {
  'audit-log': 'Audit Log',
  'users':     'User Management',
  'trips':     'Trip Management',
  'dashboard': 'Dashboard',
};

// Track which sections have already been initialised so we don't double-init
const initialisedSections = new Set();

function showSection(sectionId) {
  document.querySelectorAll('.content-section').forEach((s) => {
    s.style.display = 'none';
  });
  const target = document.getElementById(`section-${sectionId}`);
  if (target) target.style.display = 'block';

  // Update topbar title
  const titleEl = document.getElementById('topbar-title');
  if (titleEl) titleEl.textContent = SECTION_TITLES[sectionId] || sectionId;

  // One-time initialisation for sections that need data fetched
  if (!initialisedSections.has(sectionId)) {
    initialisedSections.add(sectionId);
    if (sectionId === 'users' && typeof initUsersSection === 'function') {
      initUsersSection();
    }
    if (sectionId === 'trips' && typeof initTripsSection === 'function') {
      initTripsSection();
    }
  }
}

// ─── Audit log loader ─────────────────────────────────────────────────────────
let auditPage       = 1;
let auditTotalPages = 1;

async function loadAuditLog(page) {
  auditPage = page;

  const tbody    = document.getElementById('audit-log-tbody');
  const pageInfo = document.getElementById('audit-page-info');
  const prevBtn  = document.getElementById('audit-prev');
  const nextBtn  = document.getElementById('audit-next');

  if (!tbody) return;

  // Show loading state
  tbody.innerHTML = '<tr><td colspan="5" class="table-placeholder">Loading…</td></tr>';

  try {
    const data = await AdminAPI.get(`/logs?page=${page}&limit=20`);

    auditTotalPages = data.pages || 1;

    // Update pagination controls
    if (pageInfo) pageInfo.textContent = `Page ${data.page} of ${data.pages} · ${data.total} total`;
    if (prevBtn)  prevBtn.disabled = data.page <= 1;
    if (nextBtn)  nextBtn.disabled = data.page >= data.pages;

    // Empty state
    if (!data.logs || data.logs.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" class="table-placeholder">No log entries yet.</td></tr>';
      return;
    }

    // Render rows
    tbody.innerHTML = data.logs.map((log) => {
      const adminName = log.adminId
        ? `${log.adminId.firstName} ${log.adminId.lastName}`
        : '—';

      const target = log.targetType
        ? `${log.targetType}`
        : '—';

      const ip   = log.ip  || '—';
      const time = new Date(log.createdAt).toLocaleString('en-IN', {
        day:    '2-digit', month: 'short', year: 'numeric',
        hour:   '2-digit', minute: '2-digit',
      });

      // Pick a badge colour based on the action string
      const action     = log.action || '—';
      const badgeClass = getBadgeClass(action);

      return `
        <tr class="log-row">
          <td class="cell-mono">${time}</td>
          <td>${adminName}</td>
          <td><span class="badge ${badgeClass}">${action}</span></td>
          <td>${target}</td>
          <td class="cell-mono">${ip}</td>
        </tr>
      `;
    }).join('');

  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="5" class="table-placeholder table-error">Error: ${err.message}</td></tr>`;
  }
}

/** Returns the CSS class for the coloured action badge */
function getBadgeClass(action) {
  if (action.includes('FAIL')  || action.includes('BLOCK'))  return 'badge-danger';
  if (action.includes('SUCCESS')|| action.includes('VERIFY')) return 'badge-success';
  if (action.includes('WARN')  || action.includes('FORCE'))  return 'badge-warning';
  return 'badge-info';
}

// Exposed to the HTML buttons (onclick="auditPrev()" / "auditNext()")
function auditPrev() { if (auditPage > 1)            loadAuditLog(auditPage - 1); }
function auditNext() { if (auditPage < auditTotalPages) loadAuditLog(auditPage + 1); }
