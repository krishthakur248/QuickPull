/**
 * QuickPull Apple Appearance & Theme Management System
 * Conforms to Apple Human Interface Guidelines & apple-design skill
 * Provides instant zero-flash sync, persistence across all pages, and Leaflet map synchronization.
 */
(function () {
  const THEME_KEYS = ['quickpull_theme', 'admin_theme', 'theme'];

  function getSavedTheme() {
    for (const key of THEME_KEYS) {
      try {
        const val = localStorage.getItem(key);
        if (val === 'dark' || val === 'light') return val;
      } catch (e) {}
    }
    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) {
      return 'light';
    }
    return 'dark'; // Default QuickPull theme is dark obsidian
  }

  function applyTheme(theme, save = true) {
    const isDark = theme === 'dark';
    document.documentElement.setAttribute('data-theme', theme);
    document.documentElement.classList.toggle('dark', isDark);

    if (save) {
      THEME_KEYS.forEach((key) => {
        try { localStorage.setItem(key, theme); } catch (e) {}
      });
    }

    // Update segmented appearance buttons
    const lightBtns = document.querySelectorAll('#theme-btn-light, .theme-btn-light');
    const darkBtns = document.querySelectorAll('#theme-btn-dark, .theme-btn-dark');

    lightBtns.forEach((btn) => {
      btn.classList.toggle('active', !isDark);
      btn.setAttribute('aria-checked', String(!isDark));
    });
    darkBtns.forEach((btn) => {
      btn.classList.toggle('active', isDark);
      btn.setAttribute('aria-checked', String(isDark));
    });

    // Invalidate Leaflet maps so tile redraws smoothly
    const maps = [window.dashboardMap, window.routeMap, window.currentTripMap, window.activeTripMap, window.pickerMap];
    maps.forEach((m) => {
      if (m && typeof m.invalidateSize === 'function') {
        setTimeout(() => { try { m.invalidateSize(); } catch (e) {} }, 150);
      }
    });

    // Dispatch event
    window.dispatchEvent(new CustomEvent('quickpull:themechange', { detail: { theme, isDark } }));
  }

  window.QuickPullTheme = {
    get: getSavedTheme,
    set: (t) => applyTheme(t, true),
    init: function () {
      const current = getSavedTheme();
      applyTheme(current, false);

      // Event delegation for theme segmented buttons
      document.addEventListener('click', (e) => {
        const lightTarget = e.target.closest('#theme-btn-light, .theme-btn-light');
        if (lightTarget) {
          e.preventDefault();
          applyTheme('light', true);
          return;
        }
        const darkTarget = e.target.closest('#theme-btn-dark, .theme-btn-dark');
        if (darkTarget) {
          e.preventDefault();
          applyTheme('dark', true);
          return;
        }
      });

      // Listen for OS scheme change if user hasn't chosen manually
      if (window.matchMedia) {
        window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
          let hasExplicit = false;
          THEME_KEYS.forEach((k) => {
            try { if (localStorage.getItem(k)) hasExplicit = true; } catch (err) {}
          });
          if (!hasExplicit) {
            applyTheme(e.matches ? 'dark' : 'light', false);
          }
        });
      }
    }
  };

  // Immediate anti-flash execution
  try {
    const t = getSavedTheme();
    document.documentElement.setAttribute('data-theme', t);
    document.documentElement.classList.toggle('dark', t === 'dark');
  } catch (e) {}

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => window.QuickPullTheme.init());
  } else {
    window.QuickPullTheme.init();
  }
})();
