/**
 * admin-login.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Logic for the admin login page (admin/index.html).
 *
 * What it does:
 *   1. If a valid admin token is already in localStorage, skip the login form
 *      and go straight to the dashboard (convenience, not security).
 *   2. On form submit, call POST /api/admin/login with the email + password.
 *   3. On success, store the token + admin info and redirect to dashboard.
 *   4. On failure, show the server's error message (e.g. "Invalid credentials.",
 *      "Too many failed attempts. Try again in 240 seconds.").
 */

document.addEventListener('DOMContentLoaded', () => {

  // If already logged in, go straight to the dashboard (skip login form)
  if (AdminAPI.isLoggedIn()) {
    window.location.href = './dashboard.html';
    return;
  }

  // ── DOM references ──────────────────────────────────────────────────────────
  const form        = document.getElementById('login-form');
  const emailInput  = document.getElementById('email');
  const passInput   = document.getElementById('password');
  const submitBtn   = document.getElementById('submit-btn');
  const errorBox    = document.getElementById('error-box');

  // ── Helpers ─────────────────────────────────────────────────────────────────
  function showError(msg) {
    errorBox.innerHTML = `<div style="display:flex;align-items:center;gap:.5rem;"><span>⚠️</span><span>${msg}</span></div>`;
    errorBox.style.display = 'block';
    passInput.style.borderColor = 'var(--rose)';
    passInput.focus();
    // Briefly shake the card to draw attention
    errorBox.animate([
      { transform: 'translateX(-4px)' },
      { transform: 'translateX(4px)' },
      { transform: 'translateX(-4px)' },
      { transform: 'translateX(0)' },
    ], { duration: 300 });
  }

  function hideError() {
    errorBox.style.display = 'none';
    errorBox.innerHTML = '';
    passInput.style.borderColor = '';
  }

  function setLoading(loading) {
    if (loading) {
      submitBtn.disabled = true;
      submitBtn.innerHTML = '<span class="loading-spinner"></span>Authenticating…';
    } else {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Sign In';
    }
  }

  // ── Form submission ──────────────────────────────────────────────────────────
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    hideError();

    const email    = emailInput.value.trim();
    const password = passInput.value;

    if (!email || !password) {
      showError('Please enter your email and password.');
      return;
    }

    setLoading(true);

    try {
      // POST /api/admin/login
      const response = await AdminAPI.post('/login', { email, password });

      if (response.success) {
        // Store the admin token and user info in localStorage
        AdminAPI.setToken(response.token);
        AdminAPI.setAdminUser(response.admin);
        // Go to the dashboard
        window.location.href = './dashboard.html';
      }
    } catch (err) {
      // Show the server's message (e.g. "Wrong password...", rate-limit countdown)
      showError(err.message || 'Login failed. Please check your credentials and try again.');
    } finally {
      setLoading(false);
    }
  });
});
