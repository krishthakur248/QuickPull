// API Configuration — Always uses Render backend
// ================================================

const RENDER_SERVER_URL = 'https://myrepo-6n3c.onrender.com';

// Always point at Render — no localhost detection delay
let API_BASE_URL      = `${RENDER_SERVER_URL}/api`;
let SOCKET_SERVER_URL = RENDER_SERVER_URL;
let ACTIVE_SERVER_URL = RENDER_SERVER_URL;
let IS_LOCAL_SERVER   = false;

function getSocketClientUrl(serverUrl = SOCKET_SERVER_URL) {
  if (!serverUrl) return '';
  return `${serverUrl.replace(/\/$/, '')}/socket.io/socket.io.js`;
}

function loadSocketIoClient() {
  if (typeof window === 'undefined') {
    return Promise.resolve(null);
  }

  if (typeof window.io === 'function') {
    return Promise.resolve(window.io);
  }

  if (window.__socketIoLoaderPromise) {
    return window.__socketIoLoaderPromise;
  }

  const clientUrl = getSocketClientUrl(SOCKET_SERVER_URL);

  window.__socketIoLoaderPromise = new Promise((resolve, reject) => {
    const existingScript = document.querySelector('script[data-socket-io-loader="true"]');

    if (existingScript) {
      existingScript.addEventListener('load', () => resolve(window.io), { once: true });
      existingScript.addEventListener('error', () => reject(new Error(`Socket.IO client failed to load from ${clientUrl}`)), { once: true });
      return;
    }

    const script = document.createElement('script');
    script.src = clientUrl;
    script.async = true;
    script.setAttribute('data-socket-io-loader', 'true');

    script.onload = () => {
      if (typeof window.io === 'function') {
        resolve(window.io);
      } else {
        reject(new Error('Socket.IO client loaded but is not available on window.io'));
      }
    };

    script.onerror = () => {
      reject(new Error(`Socket.IO client failed to load from ${clientUrl}`));
    };

    document.head.appendChild(script);
  });

  return window.__socketIoLoaderPromise;
}

console.log(`✅ [API-CONFIG] Using RENDER backend: ${RENDER_SERVER_URL}`);

// ─── Endpoints ────────────────────────────────────────────────────────────────
const API_ENDPOINTS = {
  // Authentication
  register:       `${API_BASE_URL}/auth/register`,
  login:          `${API_BASE_URL}/auth/login`,
  getProfile:     `${API_BASE_URL}/auth/profile`,
  updateProfile:  `${API_BASE_URL}/auth/profile`,
  updateLocation: `${API_BASE_URL}/auth/location`,
  verifyPhone:    `${API_BASE_URL}/auth/verify-phone`,
  verifyID:       `${API_BASE_URL}/auth/verify-id`,
  changePassword: `${API_BASE_URL}/auth/change-password`,

  // Users
  getUser:          (id) => `${API_BASE_URL}/users/${id}`,
  getUserRatings:   (id) => `${API_BASE_URL}/users/${id}/ratings`,
  getNearbyDrivers: `${API_BASE_URL}/users/nearby-drivers`,
  getDriverInfo:    (id) => `${API_BASE_URL}/users/${id}/driver-info`,
  addRating:        (id) => `${API_BASE_URL}/users/${id}/add-rating`,

  // Reviews
  reviewsPending: `${API_BASE_URL}/reviews/pending`,
  reviewSubmit:   `${API_BASE_URL}/reviews/submit`,
  reviewSkip:     `${API_BASE_URL}/reviews/skip`,
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
function getEndpoint(key, ...args) {
  return typeof API_ENDPOINTS[key] === 'function'
    ? API_ENDPOINTS[key](...args)
    : API_ENDPOINTS[key];
}

function getServerInfo() {
  return {
    activeServer:  ACTIVE_SERVER_URL,
    isLocal:       IS_LOCAL_SERVER,
    apiBaseUrl:    API_BASE_URL,
    socketUrl:     SOCKET_SERVER_URL,
    isDevelopment: false
  };
}

// Expose globally so other scripts can read it
const API_CONFIG = {
  API_BASE_URL,
  SOCKET_SERVER_URL,
  SOCKET_CLIENT_URL: getSocketClientUrl(SOCKET_SERVER_URL),
  RENDER_SERVER_URL,
  IS_LOCAL_SERVER
};
