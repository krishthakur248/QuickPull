/**
 * admin-api.js
 * ─────────────────────────────────────────────────────────────────────────────
 * HTTP client for all admin panel API calls.
 *
 * KEY DIFFERENCE from the regular api-client.js:
 *   - Token is stored under 'qp_admin_token' (NOT 'authToken')
 *   - Admin user info is stored under 'qp_admin_user' (NOT 'user')
 *   - All requests go to /api/admin/* endpoints
 *   - On a 401 or 403, it clears the token and sends the user to admin login
 *
 * This file does NOT import or modify the regular user's token in any way.
 */

// Storage keys — separate from the normal user's storage keys
const ADMIN_TOKEN_KEY = 'qp_admin_token';
const ADMIN_USER_KEY  = 'qp_admin_user';

// Backend base URL — read from api-config.js which is loaded before this script.
// Falls back to the hard-coded Render URL if api-config.js is not available.
const ADMIN_API_BASE = (typeof API_BASE_URL !== 'undefined')
  ? API_BASE_URL
  : 'https://myrepo-6n3c.onrender.com/api';

// ─── Admin API class ──────────────────────────────────────────────────────────
const AdminAPI = {

  // ── Token management ────────────────────────────────────────────────────────
  getToken() {
    return localStorage.getItem(ADMIN_TOKEN_KEY);
  },

  setToken(token) {
    if (token) localStorage.setItem(ADMIN_TOKEN_KEY, token);
  },

  clearToken() {
    localStorage.removeItem(ADMIN_TOKEN_KEY);
    localStorage.removeItem(ADMIN_USER_KEY);
  },

  // ── Admin user profile (cached in localStorage) ─────────────────────────────
  setAdminUser(user) {
    if (user) localStorage.setItem(ADMIN_USER_KEY, JSON.stringify(user));
  },

  getAdminUser() {
    try {
      const raw = localStorage.getItem(ADMIN_USER_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  },

  // ── Auth state helpers ───────────────────────────────────────────────────────
  isLoggedIn() {
    return !!this.getToken();
  },

  /**
   * Call this at the top of every protected admin page.
   * If the token is missing, redirect to the login page immediately.
   */
  requireLogin() {
    if (!this.isLoggedIn()) {
      window.location.href = './index.html';
      return false;
    }
    return true;
  },

  /** Clear the token and go to the login page */
  logout() {
    this.clearToken();
    window.location.href = './index.html';
  },

  // ── HTTP request helper ──────────────────────────────────────────────────────
  /**
   * Makes a fetch request to /api/admin/<endpoint>.
   * Attaches the admin token as a Bearer header.
   * On 401 or 403, clears the token and redirects to login.
   */
  async request(method, endpoint, body = null) {
    const headers = { 'Content-Type': 'application/json' };

    const token = this.getToken();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const options = { method, headers };
    if (body !== null) {
      options.body = JSON.stringify(body);
    }

    let response;
    try {
      response = await fetch(`${ADMIN_API_BASE}/admin${endpoint}`, options);
    } catch (networkError) {
      throw new Error('Network error — check your connection.');
    }

    const data = await response.json().catch(() => ({ message: 'Invalid server response.' }));

    // If the server says the session is invalid or forbidden:
    //   - For the LOGIN endpoint itself (/login): just throw the error so the
    //     login page can catch it and show the red error box. Do NOT redirect.
    //   - For every OTHER protected endpoint: clear the token and go to login,
    //     because it means the session has expired.
    if (response.status === 401 || response.status === 403) {
      if (endpoint !== '/login') {
        // Protected endpoint — session expired or token invalid
        this.clearToken();
        window.location.href = './index.html';
      }
      // For both cases: throw so the caller's catch block handles the message
      throw new Error(data.message || 'Session expired. Please log in again.');
    }

    if (!response.ok) {
      throw new Error(data.message || `Request failed (${response.status})`);
    }

    return data;
  },

  // ── Convenience methods ───────────────────────────────────────────────────────
  get(endpoint)          { return this.request('GET',    endpoint); },
  post(endpoint, body)   { return this.request('POST',   endpoint, body); },
  put(endpoint, body)    { return this.request('PUT',    endpoint, body); },
  patch(endpoint, body)  { return this.request('PATCH',  endpoint, body); },
  delete(endpoint, body) { return this.request('DELETE', endpoint, body); },
};
