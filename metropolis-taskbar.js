/**
 * Metropolis Persistent Taskbar (<metropolis-taskbar>)
 * Dynamic Web Component supporting real cross-app preference switching, theme injection,
 * telemetry level controls, and feature toggles across dondlingergc.com subdomains.
 */
class MetropolisTaskbar extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.session = this.parseCookie('metropolis_session');
    this.preferences = this.loadPreferences();
    this.broadcast = new BroadcastChannel('metropolis_session');
  }

  connectedCallback() {
    this.applyPreferencesToHost();
    this.render();
    this.setupListeners();
    this.broadcast.onmessage = (event) => {
      if (event.data?.type === 'SESSION_UPDATE') {
        this.session = this.parseCookie('metropolis_session');
        this.render();
      } else if (event.data?.type === 'PREFS_UPDATE') {
        this.preferences = event.data.preferences;
        this.applyPreferencesToHost();
        this.render();
      }
    };
  }

  loadPreferences() {
    try {
      const stored = localStorage.getItem('metropolis_prefs');
      if (stored) return JSON.parse(stored);
    } catch (e) {}
    return {
      theme: 'cyberpunk-dark',
      telemetry: true,
      highDefRadar: true,
      compactNav: false
    };
  }

  savePreferences(newPrefs) {
    this.preferences = { ...this.preferences, ...newPrefs };
    try {
      localStorage.setItem('metropolis_prefs', JSON.stringify(this.preferences));
    } catch (e) {}
    this.applyPreferencesToHost();
    this.broadcast.postMessage({ type: 'PREFS_UPDATE', preferences: this.preferences });
  }

  applyPreferencesToHost() {
    // Inject dynamic theme variables into host document
    const root = document.documentElement;
    if (this.preferences.theme === 'cyberpunk-dark') {
      root.style.setProperty('--metro-primary', '#6366f1');
      root.style.setProperty('--metro-accent', '#a855f7');
      root.style.setProperty('--metro-bg', '#0f172a');
    } else if (this.preferences.theme === 'high-contrast') {
      root.style.setProperty('--metro-primary', '#facc15');
      root.style.setProperty('--metro-accent', '#38bdf8');
      root.style.setProperty('--metro-bg', '#000000');
    } else if (this.preferences.theme === 'emerald') {
      root.style.setProperty('--metro-primary', '#10b981');
      root.style.setProperty('--metro-accent', '#06b6d4');
      root.style.setProperty('--metro-bg', '#064e3b');
    }
  }

  parseCookie(name) {
    const value = `; ${document.cookie}`;
    const parts = value.split(`; ${name}=`);
    if (parts.length === 2) {
      const val = parts.pop().split(';').shift();
      try {
        const payload = val.split('.')[1];
        if (payload) return JSON.parse(atob(payload));
      } catch (e) {
        return { token: val };
      }
    }
    return null;
  }

  async login(username, password) {
    try {
      const res = await fetch('https://metropolis-gate.dondlingergc.com/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Metropolis-Request': '1'
        },
        credentials: 'include',
        body: JSON.stringify({ username, password })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        this.session = data.user;
        this.broadcast.postMessage({ type: 'SESSION_UPDATE' });
        this.render();
        return true;
      } else {
        alert(data.error || 'Login failed');
        return false;
      }
    } catch (err) {
      console.error('[Metropolis] Auth error:', err);
      alert('Authentication network error');
      return false;
    }
  }

  async logout() {
    try {
      await fetch('https://metropolis-gate.dondlingergc.com/api/auth/logout', {
        method: 'POST',
        headers: { 'X-Metropolis-Request': '1' },
        credentials: 'include'
      });
    } catch (e) {}
    this.session = null;
    this.broadcast.postMessage({ type: 'SESSION_UPDATE' });
    this.render();
  }

  setupListeners() {
    const root = this.shadowRoot;

    root.addEventListener('click', (e) => {
      if (e.target.closest('#btn-login-trigger')) {
        root.querySelector('#auth-modal').classList.add('active');
      } else if (e.target.closest('#btn-modal-close')) {
        root.querySelector('#auth-modal').classList.remove('active');
      } else if (e.target.closest('#btn-settings-toggle')) {
        const drawer = root.querySelector('#settings-drawer');
        drawer.classList.toggle('active');
      } else if (e.target.closest('#btn-logout')) {
        this.logout();
      }
    });

    root.addEventListener('change', (e) => {
      if (e.target.id === 'select-theme') {
        this.savePreferences({ theme: e.target.value });
      } else if (e.target.id === 'chk-telemetry') {
        this.savePreferences({ telemetry: e.target.checked });
      } else if (e.target.id === 'chk-radar') {
        this.savePreferences({ highDefRadar: e.target.checked });
      }
    });

    root.addEventListener('submit', async (e) => {
      if (e.target.id === 'form-login') {
        e.preventDefault();
        const user = e.target.username.value;
        const pass = e.target.password.value;
        const ok = await this.login(user, pass);
        if (ok) {
          root.querySelector('#auth-modal').classList.remove('active');
        }
      }
    });
  }

  render() {
    const currentDomain = window.location.hostname;
    const subdomains = [
      { name: 'WazWeather', host: 'wazweather.dondlingergc.com' },
      { name: 'SkyDrop', host: 'skydrop.dondlingergc.com' },
      { name: 'Tap', host: 'tap.dondlingergc.com' },
      { name: 'Heckler', host: 'heckler.dondlingergc.com' },
      { name: 'Timeline ZLA', host: 'timeline-zla.dondlingergc.com' }
    ];

    const isLoggedIn = !!this.session;
    const username = this.session?.username || 'Guest';
    const tier = this.session?.tier || 'Free';

    this.shadowRoot.innerHTML = `
      <style>
        :host {
          all: initial;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          display: block;
          position: sticky;
          top: 0;
          z-index: 999999;
          width: 100%;
        }

        .bar-container {
          background: rgba(15, 23, 42, 0.85);
          backdrop-filter: blur(14px);
          -webkit-backdrop-filter: blur(14px);
          border-bottom: 1px solid rgba(255, 255, 255, 0.12);
          color: #f8fafc;
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 0.5rem 1.25rem;
          box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);
        }

        .brand-section {
          display: flex;
          align-items: center;
          gap: 0.75rem;
        }

        .logo-badge {
          background: linear-gradient(135deg, var(--metro-primary, #6366f1), var(--metro-accent, #a855f7));
          color: #fff;
          font-weight: 800;
          font-size: 0.75rem;
          padding: 0.25rem 0.6rem;
          border-radius: 6px;
          letter-spacing: 0.05em;
          text-transform: uppercase;
        }

        .domain-switcher {
          display: flex;
          gap: 0.4rem;
        }

        .domain-link {
          color: #94a3b8;
          text-decoration: none;
          font-size: 0.825rem;
          padding: 0.3rem 0.6rem;
          border-radius: 4px;
          transition: all 0.2s ease;
        }

        .domain-link:hover {
          color: #f1f5f9;
          background: rgba(255, 255, 255, 0.08);
        }

        .domain-link.active {
          color: #38bdf8;
          background: rgba(56, 189, 248, 0.15);
          font-weight: 600;
        }

        .user-section {
          display: flex;
          align-items: center;
          gap: 0.6rem;
        }

        .tier-badge {
          background: rgba(34, 197, 94, 0.15);
          color: #4ade80;
          border: 1px solid rgba(34, 197, 94, 0.3);
          font-size: 0.7rem;
          padding: 0.15rem 0.5rem;
          border-radius: 12px;
          font-weight: 600;
        }

        .btn {
          background: rgba(255, 255, 255, 0.08);
          border: 1px solid rgba(255, 255, 255, 0.15);
          color: #fff;
          padding: 0.35rem 0.75rem;
          border-radius: 6px;
          font-size: 0.8rem;
          cursor: pointer;
          transition: all 0.2s ease;
          display: inline-flex;
          align-items: center;
          gap: 0.3rem;
        }

        .btn:hover {
          background: rgba(255, 255, 255, 0.18);
        }

        .btn-primary {
          background: #6366f1;
          border-color: #4f46e5;
        }
        .btn-primary:hover {
          background: #4f46e5;
        }

        /* App Settings Drawer */
        .settings-drawer {
          display: none;
          background: #0f172a;
          border-bottom: 1px solid rgba(255, 255, 255, 0.12);
          padding: 1rem 1.5rem;
          gap: 2rem;
          align-items: center;
        }

        .settings-drawer.active {
          display: flex;
        }

        .setting-item {
          display: flex;
          align-items: center;
          gap: 0.5rem;
          font-size: 0.825rem;
          color: #cbd5e1;
        }

        .setting-item select {
          background: #1e293b;
          color: #fff;
          border: 1px solid #334155;
          padding: 0.3rem 0.5rem;
          border-radius: 4px;
          font-size: 0.8rem;
        }

        /* Auth Modal */
        .modal-overlay {
          display: none;
          position: fixed;
          inset: 0;
          background: rgba(0, 0, 0, 0.65);
          backdrop-filter: blur(4px);
          align-items: center;
          justify-content: center;
          z-index: 1000000;
        }

        .modal-overlay.active {
          display: flex;
        }

        .modal-card {
          background: #0f172a;
          border: 1px solid rgba(255, 255, 255, 0.15);
          border-radius: 12px;
          padding: 1.75rem;
          width: 320px;
          box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5);
          color: #f8fafc;
        }

        .modal-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 1.25rem;
        }

        .modal-title {
          font-size: 1.1rem;
          font-weight: 700;
          margin: 0;
        }

        .form-group {
          margin-bottom: 1rem;
        }

        .form-group label {
          display: block;
          font-size: 0.75rem;
          color: #94a3b8;
          margin-bottom: 0.3rem;
        }

        .form-group input {
          width: 100%;
          box-sizing: border-box;
          background: #1e293b;
          border: 1px solid #334155;
          color: #fff;
          padding: 0.5rem;
          border-radius: 6px;
          font-size: 0.875rem;
        }
      </style>

      <div class="bar-container">
        <div class="brand-section">
          <span class="logo-badge">Metropolis</span>
          <div class="domain-switcher">
            ${subdomains
              .map(
                (d) => `
              <a href="https://${d.host}" 
                 class="domain-link ${currentDomain.includes(d.host.split('.')[0]) ? 'active' : ''}">
                ${d.name}
              </a>
            `
              )
              .join('')}
          </div>
        </div>

        <div class="user-section">
          <button class="btn" id="btn-settings-toggle" title="App Preferences & Settings">
            ⚙️ Options
          </button>
          ${
            isLoggedIn
              ? `
            <span class="tier-badge">${tier}</span>
            <span style="font-size: 0.85rem; color: #cbd5e1;">${username}</span>
            <button class="btn" id="btn-logout">Logout</button>
          `
              : `
            <button class="btn btn-primary" id="btn-login-trigger">Sign In</button>
          `
          }
        </div>
      </div>

      <div class="settings-drawer" id="settings-drawer">
        <div class="setting-item">
          <label>Global Theme:</label>
          <select id="select-theme">
            <option value="cyberpunk-dark" ${this.preferences.theme === 'cyberpunk-dark' ? 'selected' : ''}>Cyberpunk Dark</option>
            <option value="high-contrast" ${this.preferences.theme === 'high-contrast' ? 'selected' : ''}>High Contrast OLED</option>
            <option value="emerald" ${this.preferences.theme === 'emerald' ? 'selected' : ''}>Emerald Glass</option>
          </select>
        </div>

        <div class="setting-item">
          <input type="checkbox" id="chk-telemetry" ${this.preferences.telemetry ? 'checked' : ''} />
          <label for="chk-telemetry">Live Edge Telemetry</label>
        </div>

        <div class="setting-item">
          <input type="checkbox" id="chk-radar" ${this.preferences.highDefRadar ? 'checked' : ''} />
          <label for="chk-radar">Pro HD Radar / Stream Mode</label>
        </div>
      </div>

      <div class="modal-overlay" id="auth-modal">
        <div class="modal-card">
          <div class="modal-header">
            <h3 class="modal-title">Sign In to Metropolis</h3>
            <button class="btn" id="btn-modal-close" style="padding: 0.1rem 0.4rem;">✕</button>
          </div>
          <form id="form-login">
            <div class="form-group">
              <label>Username / Email</label>
              <input type="text" name="username" required autocomplete="username" />
            </div>
            <div class="form-group">
              <label>Password</label>
              <input type="password" name="password" required autocomplete="current-password" />
            </div>
            <button type="submit" class="btn btn-primary" style="width: 100%; margin-top: 0.5rem; padding: 0.6rem;">
              Authenticate
            </button>
          </form>
        </div>
      </div>
    `;
  }
}

customElements.define('metropolis-taskbar', MetropolisTaskbar);
