/**
 * QuickPull Apple Modal & Dialog System
 * Conforms to Apple Human Interface Guidelines & apple-design skill
 * Provides fluid physics-based modals for Settings and My Profile.
 */
(function () {
  'use strict';

  // ══════════════════════════════════════════════════════════════════════════
  // §13 MULTIMODAL AUDIO FEEDBACK (apple-design skill §13)
  // Subtle synthesized audio feedback via Web Audio API (Zero external assets)
  // ══════════════════════════════════════════════════════════════════════════
  let audioCtx = null;

  function getAudioContext() {
    if (!audioCtx && (window.AudioContext || window.webkitAudioContext)) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      audioCtx = new AudioContextClass();
    }
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume().catch(() => {});
    }
    return audioCtx;
  }

  function playAppleHaptic(type = 'toggle') {
    const settings = getSettings();
    if (!settings.soundEnabled) return;

    try {
      const ctx = getAudioContext();
      if (!ctx) return;

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);

      const now = ctx.currentTime;

      if (type === 'toggle') {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(800, now);
        osc.frequency.exponentialRampToValueAtTime(320, now + 0.035);
        gain.gain.setValueAtTime(0.04, now);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.035);
        osc.start(now);
        osc.stop(now + 0.035);
      } else if (type === 'success') {
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(523.25, now); // C5
        osc.frequency.setValueAtTime(659.25, now + 0.06); // E5
        gain.gain.setValueAtTime(0.06, now);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);
        osc.start(now);
        osc.stop(now + 0.18);
      } else if (type === 'dismiss') {
        osc.type = 'sine';
        osc.frequency.setValueAtTime(360, now);
        osc.frequency.exponentialRampToValueAtTime(140, now + 0.028);
        gain.gain.setValueAtTime(0.03, now);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.028);
        osc.start(now);
        osc.stop(now + 0.028);
      }
    } catch (e) {
      // Audio autoplay or permissions restriction silently ignored
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // SETTINGS REPOSITORY
  // ══════════════════════════════════════════════════════════════════════════
  const DEFAULT_SETTINGS = {
    soundEnabled: true,
    rideAlerts: true,
    hapticsEnabled: true,
    autoAccept: false,
    highAccuracyGps: true,
    shareLiveLocation: true
  };

  function getSettings() {
    try {
      const raw = localStorage.getItem('quickpull_settings');
      if (raw) {
        return Object.assign({}, DEFAULT_SETTINGS, JSON.parse(raw));
      }
    } catch (e) {}
    return Object.assign({}, DEFAULT_SETTINGS);
  }

  function saveSettings(partial) {
    try {
      const current = getSettings();
      const updated = Object.assign({}, current, partial);
      localStorage.setItem('quickpull_settings', JSON.stringify(updated));
      return updated;
    } catch (e) {
      return DEFAULT_SETTINGS;
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // USER PROFILE REPOSITORY
  // ══════════════════════════════════════════════════════════════════════════
  function getCurrentUser() {
    try {
      if (window.AuthService && typeof window.AuthService.getCurrentUser === 'function') {
        const u = window.AuthService.getCurrentUser();
        if (u) return u;
      }
      const raw = localStorage.getItem('user');
      if (raw) return JSON.parse(raw);
    } catch (e) {}

    // Graceful default profile if running without active login session
    return {
      firstName: 'Alex',
      lastName: 'Morgan',
      email: 'alex.morgan@quickpull.io',
      phone: '+91 98765 43210',
      userType: 'both',
      vehicle: 'car',
      vehicleNumber: 'DL 01 AB 7890',
      vehicleColor: 'Midnight Silver',
      rating: 4.9,
      totalRides: 14
    };
  }

  function saveUserLocal(userData) {
    try {
      const existing = getCurrentUser() || {};
      const merged = Object.assign({}, existing, userData);
      localStorage.setItem('user', JSON.stringify(merged));

      // Sync header displays immediately
      const emailEls = document.querySelectorAll('#profileEmail, .user-display-email');
      emailEls.forEach(el => {
        el.textContent = merged.email || 'User';
      });

      const nameEls = document.querySelectorAll('.user-display-name, #profileName');
      nameEls.forEach(el => {
        el.textContent = `${merged.firstName || ''} ${merged.lastName || ''}`.trim() || 'User';
      });

      return merged;
    } catch (e) {
      console.warn('[QuickPull] Could not save user to localStorage:', e);
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // APPLE TOAST NOTIFICATION
  // ══════════════════════════════════════════════════════════════════════════
  let toastTimer = null;
  function showAppleToast(message, icon = 'check_circle') {
    let toast = document.getElementById('appleToast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'appleToast';
      toast.className = 'apple-toast';
      document.body.appendChild(toast);
    }

    toast.innerHTML = `
      <span class="material-symbols-outlined" style="font-size: 18px; color: #34c759;">${icon}</span>
      <span>${message}</span>
    `;

    toast.classList.add('is-visible');
    playAppleHaptic('success');

    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toast.classList.remove('is-visible');
    }, 2800);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // MODAL DOM INJECTION
  // ══════════════════════════════════════════════════════════════════════════
  function ensureModalsInjected() {
    if (!document.getElementById('quickpullSettingsModal')) {
      injectSettingsModal();
    }
    if (!document.getElementById('quickpullProfileModal')) {
      injectProfileModal();
    }
  }

  function injectSettingsModal() {
    const markup = `
      <div id="quickpullSettingsModal" class="apple-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="settingsModalTitle">
        <div class="apple-modal-sheet" onclick="event.stopPropagation()">
          <div class="apple-sheet-grab-bar sm:hidden"></div>
          
          <!-- Header -->
          <div class="apple-modal-header">
            <div>
              <h2 id="settingsModalTitle" class="apple-modal-title">Settings</h2>
              <p class="apple-modal-subtitle">Preferences &amp; System Controls</p>
            </div>
            <button type="button" class="apple-modal-close-btn" onclick="closeSettingsModal()" aria-label="Close Settings">
              <span class="material-symbols-outlined" style="font-size: 18px;">close</span>
            </button>
          </div>

          <!-- Body -->
          <div class="apple-modal-body">
            
            <!-- Appearance Section -->
            <div class="apple-grouped-section">
              <span class="apple-section-label">Appearance</span>
              <div class="apple-grouped-inset">
                <div class="apple-inset-row">
                  <div class="apple-row-left">
                    <div class="apple-row-icon blue">
                      <span class="material-symbols-outlined" style="font-size: 18px;">palette</span>
                    </div>
                    <div class="apple-row-text">
                      <span class="apple-row-title">Color Theme</span>
                      <span class="apple-row-subtitle">Obsidian dark &amp; frosted light</span>
                    </div>
                  </div>
                  <div class="theme-segmented-control" id="settingsThemeControl">
                    <button type="button" class="theme-seg-btn" id="modal-theme-btn-light" data-theme-target="light">
                      <svg viewBox="0 0 24 24" class="theme-seg-icon">
                        <circle cx="12" cy="12" r="4"></circle>
                        <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"></path>
                      </svg>
                      <span class="theme-seg-label">Light</span>
                    </button>
                    <button type="button" class="theme-seg-btn" id="modal-theme-btn-dark" data-theme-target="dark">
                      <svg viewBox="0 0 24 24" class="theme-seg-icon">
                        <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>
                      </svg>
                      <span class="theme-seg-label">Dark</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <!-- Sound & Haptics Section -->
            <div class="apple-grouped-section">
              <span class="apple-section-label">Sound &amp; Audio Feedback</span>
              <div class="apple-grouped-inset">
                <div class="apple-inset-row">
                  <div class="apple-row-left">
                    <div class="apple-row-icon green">
                      <span class="material-symbols-outlined" style="font-size: 18px;">volume_up</span>
                    </div>
                    <div class="apple-row-text">
                      <span class="apple-row-title">Sound Effects</span>
                      <span class="apple-row-subtitle">Tactile UI clicks &amp; chime</span>
                    </div>
                  </div>
                  <label class="apple-switch" title="Toggle Sound Effects">
                    <input type="checkbox" id="settingSoundToggle" checked>
                    <span class="apple-switch-slider"></span>
                  </label>
                </div>

                <div class="apple-inset-row">
                  <div class="apple-row-left">
                    <div class="apple-row-icon amber">
                      <span class="material-symbols-outlined" style="font-size: 18px;">notifications_active</span>
                    </div>
                    <div class="apple-row-text">
                      <span class="apple-row-title">Ride Status Audio Alerts</span>
                      <span class="apple-row-subtitle">Notification chime when driver arrives</span>
                    </div>
                  </div>
                  <label class="apple-switch" title="Toggle Ride Alerts">
                    <input type="checkbox" id="settingAlertsToggle" checked>
                    <span class="apple-switch-slider"></span>
                  </label>
                </div>
              </div>
            </div>

            <!-- Ride & Navigation Preferences -->
            <div class="apple-grouped-section">
              <span class="apple-section-label">Ride &amp; Location Preferences</span>
              <div class="apple-grouped-inset">
                <div class="apple-inset-row">
                  <div class="apple-row-left">
                    <div class="apple-row-icon purple">
                      <span class="material-symbols-outlined" style="font-size: 18px;">my_location</span>
                    </div>
                    <div class="apple-row-text">
                      <span class="apple-row-title">High Accuracy GPS</span>
                      <span class="apple-row-subtitle">Continuous position precision</span>
                    </div>
                  </div>
                  <label class="apple-switch" title="Toggle High Accuracy GPS">
                    <input type="checkbox" id="settingGpsToggle" checked>
                    <span class="apple-switch-slider"></span>
                  </label>
                </div>


                <div class="apple-inset-row">
                  <div class="apple-row-left">
                    <div class="apple-row-icon amber">
                      <span class="material-symbols-outlined" style="font-size: 18px;">bolt</span>
                    </div>
                    <div class="apple-row-text">
                      <span class="apple-row-title">Auto-Accept Requests</span>
                      <span class="apple-row-subtitle">For verified drivers only</span>
                    </div>
                  </div>
                  <label class="apple-switch" title="Toggle Auto Accept">
                    <input type="checkbox" id="settingAutoAcceptToggle">
                    <span class="apple-switch-slider"></span>
                  </label>
                </div>
              </div>
            </div>

            <!-- Privacy & Reset Section -->
            <div class="apple-grouped-section">
              <span class="apple-section-label">Data &amp; Privacy</span>
              <div class="apple-grouped-inset">
                <div class="apple-inset-row">
                  <div class="apple-row-left">
                    <div class="apple-row-icon rose">
                      <span class="material-symbols-outlined" style="font-size: 18px;">delete_sweep</span>
                    </div>
                    <div class="apple-row-text">
                      <span class="apple-row-title">Clear Search Cache</span>
                      <span class="apple-row-subtitle">Reset cached coordinates &amp; routes</span>
                    </div>
                  </div>
                  <button type="button" class="apple-btn-secondary" id="btnResetCache" style="padding: 5px 12px; font-size: 0.8rem;">
                    Clear
                  </button>
                </div>
              </div>
            </div>

            

          </div>

          <!-- Footer -->
          <div class="apple-modal-footer">
            <button type="button" class="apple-btn-primary" onclick="closeSettingsModal()">
              Done
            </button>
          </div>
        </div>
      </div>
    `;

    document.body.insertAdjacentHTML('beforeend', markup);
    bindSettingsEvents();
  }

  function injectProfileModal() {
    const markup = `
      <div id="quickpullProfileModal" class="apple-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="profileModalTitle">
        <div class="apple-modal-sheet" onclick="event.stopPropagation()">
          <div class="apple-sheet-grab-bar sm:hidden"></div>

          <!-- Header -->
          <div class="apple-modal-header">
            <div>
              <h2 id="profileModalTitle" class="apple-modal-title">My Profile</h2>
              <p class="apple-modal-subtitle">Personal Details &amp; Vehicle Information</p>
            </div>
            <div style="display: flex; align-items: center; gap: 8px;">
              <button type="button" id="profileEditBtn" onclick="toggleProfileEditMode()" class="apple-btn-secondary" style="padding: 5px 12px; font-size: 0.8rem; font-weight: 600; display: inline-flex; align-items: center; gap: 4px;" title="Edit Personal Information">
                <span class="material-symbols-outlined" style="font-size: 15px;">edit</span>
                <span id="profileEditBtnText">Edit</span>
              </button>
              <button type="button" class="apple-modal-close-btn" onclick="closeProfileModal()" aria-label="Close Profile">
                <span class="material-symbols-outlined" style="font-size: 18px;">close</span>
              </button>
            </div>
          </div>

          <!-- Body -->
          <form id="appleProfileForm" onsubmit="handleSaveProfile(event)" class="apple-modal-body">

            <!-- Avatar & Hero Card -->
            <div class="apple-avatar-card">
              <div class="apple-avatar-wrapper">
                <div class="apple-avatar-circle" id="profileModalAvatar">
                  AM
                </div>
                <button type="button" id="profileAvatarEditBadge" class="apple-avatar-edit-badge" title="Change Avatar" onclick="cycleAvatarGradient()" style="display: none;">
                  <span class="material-symbols-outlined" style="font-size: 14px;">photo_camera</span>
                </button>
              </div>
              <div style="flex: 1; min-width: 0;">
                <h3 id="profileModalFullName" style="font-size: 1.1rem; font-weight: 700; color: var(--text); margin: 0; line-height: 1.2;">
                  Alex Morgan
                </h3>
                <div style="display: flex; align-items: center; gap: 6px; margin-top: 4px;">
                  <span id="profileModalRoleBadge" style="display: inline-block; padding: 2px 8px; border-radius: 999px; background: var(--accent-blue-glass); color: var(--accent-blue); font-size: 0.72rem; font-weight: 600;">
                    Rider &amp; Driver
                  </span>
                  <span style="display: inline-flex; align-items: center; gap: 2px; font-size: 0.74rem; color: #ff9f0a; font-weight: 600;">
                    <span class="material-symbols-outlined" style="font-size: 13px;">star</span> 4.9
                  </span>
                </div>
                <div class="apple-profile-stats">
                  <div class="apple-stat-card">
                    <div class="apple-stat-val" id="profileStatRides">14</div>
                    <div class="apple-stat-lbl">Rides</div>
                  </div>
                  <div class="apple-stat-card">
                    <div class="apple-stat-val">2024</div>
                    <div class="apple-stat-lbl">Joined</div>
                  </div>
                  <div class="apple-stat-card">
                    <div class="apple-stat-val" style="color: #34c759;">100%</div>
                    <div class="apple-stat-lbl">Safety</div>
                  </div>
                </div>
              </div>
            </div>

            <!-- Personal Information Inset -->
            <div class="apple-grouped-section">
              <div style="display: flex; justify-content: space-between; align-items: center; padding: 0 12px 2px 12px;">
                <span class="apple-section-label" style="padding-left: 0;">Account Details</span>
                <span id="profileEditStatusBadge" style="display: none; font-size: 0.72rem; font-weight: 600; color: #0a84ff; letter-spacing: 0.02em;">● Editing Active</span>
              </div>
              <div class="apple-grouped-inset" style="padding: 14px 16px; display: flex; flex-direction: column; gap: 12px;">
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
                  <div>
                    <label class="apple-label" for="profileFirstName">First Name</label>
                    <input type="text" id="profileFirstName" name="firstName" required readonly class="apple-input-field apple-field-locked" placeholder="First name">
                  </div>
                  <div>
                    <label class="apple-label" for="profileLastName">Last Name</label>
                    <input type="text" id="profileLastName" name="lastName" required readonly class="apple-input-field apple-field-locked" placeholder="Last name">
                  </div>
                </div>

                <div>
                  <label class="apple-label" for="profilePhone">Phone Number</label>
                  <input type="tel" id="profilePhone" name="phone" readonly class="apple-input-field apple-field-locked" placeholder="+91 98765 43210">
                </div>

                <div>
                  <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 5px;">
                    <label class="apple-label" for="profileEmailInput" style="margin-bottom: 0;">Email Address</label>
                    <span style="font-size: 0.72rem; color: #34c759; font-weight: 600; display: inline-flex; align-items: center; gap: 3px;">
                      <span class="material-symbols-outlined" style="font-size: 13px;">verified</span> Verified
                    </span>
                  </div>
                  <input type="email" id="profileEmailInput" name="email" readonly class="apple-input-field apple-field-locked" placeholder="email@address.com">
                </div>
              </div>
            </div>

            <!-- Role & Vehicle Information Inset -->
            <div class="apple-grouped-section">
              <span class="apple-section-label">Role &amp; Vehicle</span>
              <div class="apple-grouped-inset" style="padding: 14px 16px; display: flex; flex-direction: column; gap: 12px;">
                <div>
                  <label class="apple-label">User Role</label>
                  <div class="theme-segmented-control" style="width: 100%; display: flex; pointer-events: none;" id="profileRoleSelector">
                    <button type="button" class="theme-seg-btn" style="flex: 1; justify-content: center;" data-role="rider">
                      Rider
                    </button>
                    <button type="button" class="theme-seg-btn" style="flex: 1; justify-content: center;" data-role="driver">
                      Driver
                    </button>
                    <button type="button" class="theme-seg-btn active" style="flex: 1; justify-content: center;" data-role="both">
                      Both
                    </button>
                  </div>
                </div>

                <div id="profileVehicleSection" style="display: flex; flex-direction: column; gap: 10px;">
                  <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
                    <div>
                      <label class="apple-label" for="profileVehicleType">Vehicle Type</label>
                      <select id="profileVehicleType" name="vehicle" disabled class="apple-input-field apple-field-locked">
                        <option value="car">Car (Sedan/Hatch)</option>
                        <option value="ev">Electric Vehicle (EV)</option>
                        <option value="bike">Motorbike</option>
                      </select>
                    </div>
                    <div>
                      <label class="apple-label" for="profileVehicleNumber">Plate Number</label>
                      <input type="text" id="profileVehicleNumber" name="vehicleNumber" readonly class="apple-input-field apple-field-locked" placeholder="DL 01 AB 1234">
                    </div>
                  </div>

                  <div>
                    <label class="apple-label" for="profileVehicleColor">Vehicle Color</label>
                    <input type="text" id="profileVehicleColor" name="vehicleColor" readonly class="apple-input-field apple-field-locked" placeholder="e.g. Midnight Silver, White">
                  </div>
                </div>
              </div>
            </div>

            <!-- View Mode Footer (Default when opened) -->
            <div id="profileViewFooter" class="apple-modal-footer" style="padding: 0; border: none; background: transparent; margin-top: 8px; display: flex; justify-content: space-between; align-items: center;">
              <button type="button" class="apple-btn-secondary" onclick="toggleProfileEditMode()" style="display: inline-flex; align-items: center; gap: 5px;">
                <span class="material-symbols-outlined" style="font-size: 16px;">edit</span>
                Edit Profile
              </button>
              <button type="button" class="apple-btn-primary" onclick="closeProfileModal()">
                Done
              </button>
            </div>

            <!-- Edit Mode Footer (Shown when editing) -->
            <div id="profileEditFooter" class="apple-modal-footer" style="padding: 0; border: none; background: transparent; margin-top: 8px; display: none; justify-content: flex-end; gap: 10px;">
              <button type="button" class="apple-btn-secondary" onclick="toggleProfileEditMode()">
                Cancel
              </button>
              <button type="submit" id="profileSaveBtn" class="apple-btn-primary">
                <span class="material-symbols-outlined" style="font-size: 18px;">check</span>
                Save Changes
              </button>
            </div>

          </form>
        </div>
      </div>
    `;

    document.body.insertAdjacentHTML('beforeend', markup);
    bindProfileEvents();
  }

  // ══════════════════════════════════════════════════════════════════════════
  // EVENT BINDINGS FOR SETTINGS
  // ══════════════════════════════════════════════════════════════════════════
  function bindSettingsEvents() {
    const soundToggle = document.getElementById('settingSoundToggle');
    const alertsToggle = document.getElementById('settingAlertsToggle');
    const gpsToggle = document.getElementById('settingGpsToggle');
    const autoAcceptToggle = document.getElementById('settingAutoAcceptToggle');
    const btnReset = document.getElementById('btnResetCache');

    // Load initial settings
    const current = getSettings();
    if (soundToggle) soundToggle.checked = !!current.soundEnabled;
    if (alertsToggle) alertsToggle.checked = !!current.rideAlerts;
    if (gpsToggle) gpsToggle.checked = !!current.highAccuracyGps;
    if (autoAcceptToggle) autoAcceptToggle.checked = !!current.autoAccept;

    // Sync appearance buttons inside settings modal
    updateModalThemeButtons();

    // Toggle listeners with haptic click
    [soundToggle, alertsToggle, gpsToggle, autoAcceptToggle].forEach(input => {
      if (input) {
        input.addEventListener('change', () => {
          playAppleHaptic('toggle');
          saveSettings({
            soundEnabled: soundToggle ? soundToggle.checked : true,
            rideAlerts: alertsToggle ? alertsToggle.checked : true,
            highAccuracyGps: gpsToggle ? gpsToggle.checked : true,
            autoAccept: autoAcceptToggle ? autoAcceptToggle.checked : false
          });
        });
      }
    });

    if (btnReset) {
      btnReset.addEventListener('click', () => {
        playAppleHaptic('toggle');
        // Clear cached coordinates and route history
        try {
          sessionStorage.clear();
          localStorage.removeItem('cached_routes');
          localStorage.removeItem('quickpull_recent_searches');
        } catch (e) {}
        showAppleToast('Search cache reset successfully');
      });
    }

    // Modal theme buttons delegation
    const themeCtrl = document.getElementById('settingsThemeControl');
    if (themeCtrl) {
      themeCtrl.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-theme-target]');
        if (!btn) return;
        const targetTheme = btn.getAttribute('data-theme-target');
        if (window.QuickPullTheme && typeof window.QuickPullTheme.set === 'function') {
          window.QuickPullTheme.set(targetTheme);
        } else {
          document.documentElement.setAttribute('data-theme', targetTheme);
          document.documentElement.classList.toggle('dark', targetTheme === 'dark');
        }
        playAppleHaptic('toggle');
        updateModalThemeButtons();
      });
    }
  }

  function updateModalThemeButtons() {
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark' ||
                   document.documentElement.classList.contains('dark');
    const lightBtn = document.getElementById('modal-theme-btn-light');
    const darkBtn = document.getElementById('modal-theme-btn-dark');

    if (lightBtn && darkBtn) {
      lightBtn.classList.toggle('active', !isDark);
      darkBtn.classList.toggle('active', isDark);
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // EVENT BINDINGS FOR PROFILE & EDIT MODE (apple-design skill §16)
  // ══════════════════════════════════════════════════════════════════════════
  let selectedUserRole = 'both';
  let isProfileEditing = false;
  const AVATAR_GRADIENTS = [
    'linear-gradient(135deg, #0a84ff 0%, #5e5ce6 100%)',
    'linear-gradient(135deg, #30d158 0%, #0a84ff 100%)',
    'linear-gradient(135deg, #ff9f0a 0%, #ff3b30 100%)',
    'linear-gradient(135deg, #bf5af2 0%, #ff375f 100%)'
  ];
  let gradientIndex = 0;

  function cycleAvatarGradient() {
    if (!isProfileEditing) return;
    gradientIndex = (gradientIndex + 1) % AVATAR_GRADIENTS.length;
    const avatar = document.getElementById('profileModalAvatar');
    if (avatar) {
      avatar.style.background = AVATAR_GRADIENTS[gradientIndex];
    }
    playAppleHaptic('toggle');
  }
  window.cycleAvatarGradient = cycleAvatarGradient;

  function setProfileEditMode(editing) {
    isProfileEditing = !!editing;
    const editBtnText = document.getElementById('profileEditBtnText');
    const editBtn = document.getElementById('profileEditBtn');
    const editIcon = editBtn ? editBtn.querySelector('.material-symbols-outlined') : null;
    const statusBadge = document.getElementById('profileEditStatusBadge');
    const viewFooter = document.getElementById('profileViewFooter');
    const editFooter = document.getElementById('profileEditFooter');
    const avatarBadge = document.getElementById('profileAvatarEditBadge');

    const fnInput = document.getElementById('profileFirstName');
    const lnInput = document.getElementById('profileLastName');
    const phoneInput = document.getElementById('profilePhone');
    const vType = document.getElementById('profileVehicleType');
    const vNum = document.getElementById('profileVehicleNumber');
    const vColor = document.getElementById('profileVehicleColor');
    const roleSelector = document.getElementById('profileRoleSelector');

    if (isProfileEditing) {
      // Enter Edit Mode
      if (editBtnText) editBtnText.textContent = 'Cancel';
      if (editIcon) editIcon.textContent = 'close';
      if (statusBadge) statusBadge.style.display = 'inline-block';
      if (viewFooter) viewFooter.style.display = 'none';
      if (editFooter) editFooter.style.display = 'flex';
      if (avatarBadge) avatarBadge.style.display = 'flex';

      [fnInput, lnInput, phoneInput, vNum, vColor].forEach(input => {
        if (input) {
          input.removeAttribute('readonly');
          input.classList.remove('apple-field-locked');
          input.classList.add('apple-field-editable');
        }
      });

      if (vType) {
        vType.removeAttribute('disabled');
        vType.classList.remove('apple-field-locked');
        vType.classList.add('apple-field-editable');
      }

      if (roleSelector) {
        roleSelector.style.pointerEvents = 'auto';
      }

      if (fnInput) {
        setTimeout(() => fnInput.focus(), 60);
      }
    } else {
      // Exit Edit Mode (Read-only View)
      if (editBtnText) editBtnText.textContent = 'Edit';
      if (editIcon) editIcon.textContent = 'edit';
      if (statusBadge) statusBadge.style.display = 'none';
      if (viewFooter) viewFooter.style.display = 'flex';
      if (editFooter) editFooter.style.display = 'none';
      if (avatarBadge) avatarBadge.style.display = 'none';

      [fnInput, lnInput, phoneInput, vNum, vColor].forEach(input => {
        if (input) {
          input.setAttribute('readonly', 'true');
          input.classList.add('apple-field-locked');
          input.classList.remove('apple-field-editable');
        }
      });

      if (vType) {
        vType.setAttribute('disabled', 'true');
        vType.classList.add('apple-field-locked');
        vType.classList.remove('apple-field-editable');
      }

      if (roleSelector) {
        roleSelector.style.pointerEvents = 'none';
      }
    }
  }

  function toggleProfileEditMode() {
    playAppleHaptic('toggle');
    if (isProfileEditing) {
      // Cancel edit mode -> restore saved values
      populateProfileForm();
      setProfileEditMode(false);
    } else {
      // Unlock fields for editing
      setProfileEditMode(true);
    }
  }
  window.toggleProfileEditMode = toggleProfileEditMode;
  window.setProfileEditMode = setProfileEditMode;

  function bindProfileEvents() {
    const roleSelector = document.getElementById('profileRoleSelector');
    if (roleSelector) {
      roleSelector.addEventListener('click', (e) => {
        if (!isProfileEditing) return; // Disallow changing role when viewing
        const btn = e.target.closest('[data-role]');
        if (!btn) return;
        selectedUserRole = btn.getAttribute('data-role');
        roleSelector.querySelectorAll('.theme-seg-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        playAppleHaptic('toggle');

        // Toggle vehicle details section smoothly
        const vehicleSection = document.getElementById('profileVehicleSection');
        if (vehicleSection) {
          vehicleSection.style.display = (selectedUserRole === 'rider') ? 'none' : 'flex';
        }
      });
    }
  }

  function populateProfileForm() {
    const user = getCurrentUser();
    if (!user) return;

    const fnInput = document.getElementById('profileFirstName');
    const lnInput = document.getElementById('profileLastName');
    const phoneInput = document.getElementById('profilePhone');
    const emailInput = document.getElementById('profileEmailInput');
    const vehicleType = document.getElementById('profileVehicleType');
    const vehicleNumber = document.getElementById('profileVehicleNumber');
    const vehicleColor = document.getElementById('profileVehicleColor');
    const fullNameEl = document.getElementById('profileModalFullName');
    const avatarEl = document.getElementById('profileModalAvatar');
    const roleBadge = document.getElementById('profileModalRoleBadge');
    const ridesEl = document.getElementById('profileStatRides');

    if (fnInput) fnInput.value = user.firstName || '';
    if (lnInput) lnInput.value = user.lastName || '';
    if (phoneInput) phoneInput.value = user.phone || '';
    if (emailInput) emailInput.value = user.email || '';
    if (vehicleType) vehicleType.value = user.vehicle || 'car';
    if (vehicleNumber) vehicleNumber.value = user.vehicleNumber || '';
    if (vehicleColor) vehicleColor.value = user.vehicleColor || '';

    const first = (user.firstName || '').trim();
    const last = (user.lastName || '').trim();
    const initials = ((first ? first[0] : '') + (last ? last[0] : '')).toUpperCase() || 'QP';

    if (avatarEl) avatarEl.textContent = initials;
    if (fullNameEl) fullNameEl.textContent = `${first} ${last}`.trim() || 'QuickPull User';
    if (ridesEl) ridesEl.textContent = String(user.totalRides || 14);

    selectedUserRole = user.userType || 'both';
    const roleSelector = document.getElementById('profileRoleSelector');
    if (roleSelector) {
      roleSelector.querySelectorAll('.theme-seg-btn').forEach(btn => {
        const matches = btn.getAttribute('data-role') === selectedUserRole;
        btn.classList.toggle('active', matches);
      });
    }

    if (roleBadge) {
      roleBadge.textContent = (selectedUserRole === 'driver') ? 'Driver' :
                              (selectedUserRole === 'rider') ? 'Rider' : 'Rider & Driver';
    }

    const vehicleSection = document.getElementById('profileVehicleSection');
    if (vehicleSection) {
      vehicleSection.style.display = (selectedUserRole === 'rider') ? 'none' : 'flex';
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // SAVE PROFILE LOGIC
  // ══════════════════════════════════════════════════════════════════════════
  async function handleSaveProfile(e) {
    if (e) e.preventDefault();

    const saveBtn = document.getElementById('profileSaveBtn');
    const originalText = saveBtn ? saveBtn.innerHTML : 'Save Changes';

    if (saveBtn) {
      saveBtn.disabled = true;
      saveBtn.innerHTML = `
        <span class="material-symbols-outlined animate-spin" style="font-size: 18px;">progress_activity</span>
        Saving...
      `;
    }

    const firstName = (document.getElementById('profileFirstName')?.value || '').trim();
    const lastName = (document.getElementById('profileLastName')?.value || '').trim();
    const phone = (document.getElementById('profilePhone')?.value || '').trim();
    const vehicle = document.getElementById('profileVehicleType')?.value || 'car';
    const vehicleNumber = (document.getElementById('profileVehicleNumber')?.value || '').trim();
    const vehicleColor = (document.getElementById('profileVehicleColor')?.value || '').trim();

    const updatePayload = {
      firstName,
      lastName,
      phone,
      userType: selectedUserRole,
      vehicle,
      vehicleNumber,
      vehicleColor
    };

    try {
      // 1. Try Backend API via AuthService if available
      if (window.AuthService && typeof window.AuthService.updateProfile === 'function') {
        try {
          await window.AuthService.updateProfile(updatePayload);
        } catch (apiErr) {
          console.warn('[QuickPull] Remote profile update failed, falling back to local sync:', apiErr);
        }
      }

      // 2. Optimistic & Local Storage update
      saveUserLocal(updatePayload);

      // 3. Return to locked View Mode with updated data
      setProfileEditMode(false);
      populateProfileForm();

      // 4. Multimodal feedback
      showAppleToast('Profile updated successfully');
    } catch (err) {
      console.error('[QuickPull] Profile update error:', err);
      showAppleToast('Saved locally');
      setProfileEditMode(false);
      populateProfileForm();
    } finally {
      if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.innerHTML = originalText;
      }
    }
  }
  window.handleSaveProfile = handleSaveProfile;

  // ══════════════════════════════════════════════════════════════════════════
  // OPEN & CLOSE CONTROLLERS
  // ══════════════════════════════════════════════════════════════════════════
  function openSettingsModal() {
    ensureModalsInjected();
    updateModalThemeButtons();
    const modal = document.getElementById('quickpullSettingsModal');
    if (!modal) return;

    modal.classList.add('is-open');
    document.body.style.overflow = 'hidden';
    playAppleHaptic('toggle');

    // Close any open profile dropdown
    const dropdown = document.getElementById('profileDropdown');
    if (dropdown) dropdown.classList.add('hidden');
  }

  function closeSettingsModal() {
    const modal = document.getElementById('quickpullSettingsModal');
    if (!modal) return;
    modal.classList.remove('is-open');
    document.body.style.overflow = '';
    playAppleHaptic('dismiss');
  }

  function openProfileModal() {
    ensureModalsInjected();
    populateProfileForm();
    setProfileEditMode(false); // ALWAYS start in read-only view mode
    const modal = document.getElementById('quickpullProfileModal');
    if (!modal) return;

    modal.classList.add('is-open');
    document.body.style.overflow = 'hidden';
    playAppleHaptic('toggle');

    // Close any open profile dropdown
    const dropdown = document.getElementById('profileDropdown');
    if (dropdown) dropdown.classList.add('hidden');
  }

  function closeProfileModal() {
    const modal = document.getElementById('quickpullProfileModal');
    if (!modal) return;
    modal.classList.remove('is-open');
    document.body.style.overflow = '';
    playAppleHaptic('dismiss');
  }

  // Export globals
  window.openSettingsModal = openSettingsModal;
  window.closeSettingsModal = closeSettingsModal;
  window.openProfileModal = openProfileModal;
  window.closeProfileModal = closeProfileModal;
  window.showAppleToast = showAppleToast;
  window.playAppleHaptic = playAppleHaptic;

  // ══════════════════════════════════════════════════════════════════════════
  // GLOBAL LISTENERS (Escape key, outside click, auto-wire buttons)
  // ══════════════════════════════════════════════════════════════════════════
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const openModal = document.querySelector('.apple-modal-backdrop.is-open');
      if (openModal) {
        if (openModal.id === 'quickpullSettingsModal') closeSettingsModal();
        if (openModal.id === 'quickpullProfileModal') closeProfileModal();
      }
    }
  });

  // Auto-wire buttons once DOM is loaded
  function initAutoWire() {
    ensureModalsInjected();

    // Backdrop click handlers
    const settingsModal = document.getElementById('quickpullSettingsModal');
    if (settingsModal) {
      settingsModal.addEventListener('click', (e) => {
        if (e.target === settingsModal) closeSettingsModal();
      });
    }

    const profileModal = document.getElementById('quickpullProfileModal');
    if (profileModal) {
      profileModal.addEventListener('click', (e) => {
        if (e.target === profileModal) closeProfileModal();
      });
    }

    // Settings buttons
    document.querySelectorAll('#settingsBtn, .btn-settings, [title="Settings"]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        openSettingsModal();
      });
    });

    // Profile buttons
    document.querySelectorAll('#myProfileBtn, .btn-my-profile').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        openProfileModal();
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAutoWire);
  } else {
    initAutoWire();
  }

})();
