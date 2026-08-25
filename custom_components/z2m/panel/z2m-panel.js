/**
 * Zigbee panel: Settings > Devices & Services > Zigbee > Configure.
 *
 * Built out of Home Assistant's OWN components -- hass-subpage, ha-card, ha-md-list,
 * ha-md-list-item, ha-svg-icon, ha-icon-next, ha-alert, ha-button -- laid out the way
 * HA's own ZHA and Z-Wave config pages are laid out, so it reads as part of Home
 * Assistant rather than as a bolt-on. Nothing here re-implements a component HA
 * already ships, and most of the top level is delegation into HA's own device and
 * entity tables.
 *
 * Deliberately plain DOM: no Lit, no bundler, no CDN, no dependencies at all. The
 * cost of that choice is two small hand-written passes -- a template string per view,
 * then one hydration pass that assigns the JS properties markup cannot carry
 * (`.path`, `.hass`, `.backCallback`, `.topology`, `.scan`) and wires events.
 *
 * Availability of those components is a runtime condition. On a cold load straight
 * onto this URL, HA may not yet have fetched ha-md-list or hass-subpage. The panel
 * paints with the elements that already exist, then upgrades naturally as the rest
 * arrive. Loading helpers are strictly opportunistic: a helper promise that never
 * settles must never delay data reads or first paint.

 * There is deliberately no whole-page "components unavailable" screen. A missing
 * list container falls back to a neutral semantic wrapper while the genuine HA list
 * rows remain in place, and a missing page shell uses HA header tokens rather than
 * inventing a second visual system.
 */

/* MDI paths, taken from Home Assistant's own icon set so the iconography matches the
 * rest of Settings exactly. Several are the very paths HA's ZHA page uses. */
const MDI = {
  check: 'M21,7L9,19L3.5,13.5L4.91,12.09L9,16.17L19.59,5.59L21,7Z',
  back: 'M20,11V13H8L13.5,18.5L12.08,19.92L4.16,12L12.08,4.08L13.5,5.5L8,11H20Z',
  alert: 'M11,15H13V17H11V15M11,7H13V13H11V7M12,2C6.47,2 2,6.5 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10,10 0 0,0 12,2M12,20A8,8 0 0,1 4,12A8,8 0 0,1 12,4A8,8 0 0,1 20,12A8,8 0 0,1 12,20Z',
  devices: 'M3 6H21V4H3C1.9 4 1 4.9 1 6V18C1 19.1 1.9 20 3 20H7V18H3V6M13 12H9V13.78C8.39 14.33 8 15.11 8 16C8 16.89 8.39 17.67 9 18.22V20H13V18.22C13.61 17.67 14 16.88 14 16S13.61 14.33 13 13.78V12M11 17.5C10.17 17.5 9.5 16.83 9.5 16S10.17 14.5 11 14.5 12.5 15.17 12.5 16 11.83 17.5 11 17.5M22 8H16C15.5 8 15 8.5 15 9V19C15 19.5 15.5 20 16 20H22C22.5 20 23 19.5 23 19V9C23 8.5 22.5 8 22 8M21 18H17V10H21V18Z',
  entities: 'M11,13.5V21.5H3V13.5H11M12,2L17.5,11H6.5L12,2M17.5,13C20,13 22,15 22,17.5C22,20 20,22 17.5,22C15,22 13,20 13,17.5C13,15 15,13 17.5,13Z',
  groups: 'M22,4A2,2 0 0,1 24,6V16A2,2 0 0,1 22,18H6A2,2 0 0,1 4,16V4A2,2 0 0,1 6,2H12L14,4H22M2,6V20H20V22H2A2,2 0 0,1 0,20V11H0V6H2M6,6V16H22V6H6Z',
  options: 'M3,17V19H9V17H3M3,5V7H13V5H3M13,21V19H21V17H13V15H11V21H13M7,9V11H3V13H7V15H9V9H7M21,13V11H11V13H21M15,9H17V7H21V5H17V3H15V9Z',
  info: 'M11,9H13V7H11M12,20C7.59,20 4,16.41 4,12C4,7.59 7.59,4 12,4C16.41,4 20,7.59 20,12C20,16.41 16.41,20 12,20M12,2A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10,10 0 0,0 12,2M11,17H13V11H11V17Z',
  download: 'M5,20H19V18H5M19,9H15V3H9V9H5L12,16L19,9Z',
  plus: 'M19,13H13V19H11V13H5V11H11V5H13V11H19V13Z',
  map: 'M2 3V9H4.95L6.95 15H6V21H12V16.41L17.41 11H22V5H16V9.57L10.59 15H9.06L7.06 9H8V3M4 5H6V7H4M18 7H20V9H18M8 17H10V19H8Z',
  logs: 'M6,2A2,2 0 0,0 4,4V20A2,2 0 0,0 6,22H18A2,2 0 0,0 20,20V8L14,2H6M6,4H13V9H18V20H6V4M8,12V14H16V12H8M8,16V18H13V16H8Z',
  diagnostics: 'M19,8C19.56,8 20,8.43 20,9A1,1 0 0,1 19,10C18.43,10 18,9.55 18,9C18,8.43 18.43,8 19,8M2,2V11C2,13.96 4.19,16.5 7.14,16.91C7.76,19.92 10.42,22 13.5,22A6.5,6.5 0 0,0 20,15.5V11.81C21.16,11.39 22,10.29 22,9A3,3 0 0,0 19,6A3,3 0 0,0 16,9C16,10.29 16.84,11.4 18,11.81V15.41C18,17.91 16,19.91 13.5,19.91C11.5,19.91 9.82,18.7 9.22,16.9C12,16.3 14,13.8 14,11V2H10V5H12V11A4,4 0 0,1 8,15A4,4 0 0,1 4,11V5H6V2H2Z',
  firmware: 'M5.12,5L5.93,4H17.93L18.87,5M12,17.5L6.5,12H10V10H14V12H17.5L12,17.5M20.54,5.23L19.15,3.55C18.88,3.21 18.47,3 18,3H6C5.53,3 5.12,3.21 4.84,3.55L3.46,5.23C3.17,5.57 3,6 3,6.5V19A2,2 0 0,0 5,21H19A2,2 0 0,0 21,19V6.5C21,6 20.83,5.57 20.54,5.23Z',
  restart: 'M12,4C14.1,4 16.1,4.8 17.6,6.3C20.7,9.4 20.7,14.5 17.6,17.6C15.8,19.5 13.3,20.2 10.9,19.9L11.4,17.9C13.1,18.1 14.9,17.5 16.2,16.2C18.5,13.9 18.5,10.1 16.2,7.7C15.1,6.6 13.5,6 12,6V10.6L7,5.6L12,0.6V4M6.3,17.6C3.7,15 3.3,11 5.1,7.9L6.6,9.4C5.5,11.6 5.9,14.4 7.8,16.2C8.3,16.7 8.9,17.1 9.6,17.4L9,19.4C8,19 7.1,18.4 6.3,17.6Z',
  search: 'M9.5,3A6.5,6.5 0 0,1 16,9.5C16,11.11 15.41,12.59 14.44,13.73L14.71,14H15.5L20.5,19L19,20.5L14,15.5V14.71L13.73,14.44C12.59,15.41 11.11,16 9.5,16A6.5,6.5 0 0,1 3,9.5A6.5,6.5 0 0,1 9.5,3M9.5,5C7,5 5,7 5,9.5C5,12 7,14 9.5,14C12,14 14,12 14,9.5C14,7 12,5 9.5,5Z',
  refresh: 'M17.65,6.35C16.2,4.9 14.21,4 12,4A8,8 0 0,0 4,12A8,8 0 0,0 12,20C15.73,20 18.84,17.45 19.73,14H17.65C16.83,16.33 14.61,18 12,18A6,6 0 0,1 6,12A6,6 0 0,1 12,6C13.66,6 15.14,6.69 16.22,7.78L13,11H20V4L17.65,6.35Z',
  battery: 'M16,20H8V6H16M16.67,4H15V2H9V4H7.33A1.33,1.33 0 0,0 6,5.33V20.67C6,21.4 6.6,22 7.33,22H16.67A1.33,1.33 0 0,0 18,20.67V5.33C18,4.6 17.4,4 16.67,4Z',
  rename: 'M20.71,7.04C21.1,6.65 21.1,6 20.71,5.63L18.37,3.29C18,2.9 17.35,2.9 16.96,3.29L15.12,5.12L18.87,8.87M3,17.25V21H6.75L17.81,9.93L14.06,6.18L3,17.25Z',
  remove: 'M19,4H15.5L14.5,3H9.5L8.5,4H5V6H19M6,19A2,2 0 0,0 8,21H16A2,2 0 0,0 18,19V7H6V19Z',
  wrench: 'M22.7,19L13.6,9.9C14.5,7.6 14,4.9 12.1,3C10.1,1 7.1,0.6 4.7,1.7L9,6L6,9L1.6,4.7C0.4,7.1 0.9,10.1 2.9,12.1C4.8,14 7.5,14.5 9.8,13.6L18.9,22.7C19.3,23.1 19.9,23.1 20.3,22.7L22.6,20.4C23.1,20 23.1,19.3 22.7,19Z',
  radar: 'M19.07,4.93L17.66,6.34C19.1,7.79 20,9.79 20,12A8,8 0 0,1 12,20A8,8 0 0,1 4,12C4,7.92 7.05,4.56 11,4.07V6.09C8.16,6.57 6,9.03 6,12A6,6 0 0,0 12,18A6,6 0 0,0 18,12C18,10.34 17.33,8.84 16.24,7.76L14.83,9.17C15.55,9.9 16,10.9 16,12A4,4 0 0,1 12,16A4,4 0 0,1 8,12C8,10.14 9.28,8.59 11,8.14V10.28C10.4,10.63 10,11.26 10,12A2,2 0 0,0 12,14A2,2 0 0,0 14,12C14,11.26 13.6,10.62 13,10.28V2H12A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12C22,9.24 20.88,6.74 19.07,4.93Z',
  health: 'M7.5,4A5.5,5.5 0 0,0 2,9.5C2,10 2.09,10.5 2.22,11H6.3L7.57,7.63C7.87,6.83 9.05,6.75 9.43,7.63L11.5,13L12.09,11.58C12.22,11.25 12.57,11 13,11H21.78C21.91,10.5 22,10 22,9.5A5.5,5.5 0 0,0 16.5,4C14.64,4 13,4.93 12,6.34C11,4.93 9.36,4 7.5,4V4M3,12.5A1,1 0 0,0 2,13.5A1,1 0 0,0 3,14.5H5.44L11,20C12,20.9 12,20.9 13,20L18.56,14.5H21A1,1 0 0,0 22,13.5A1,1 0 0,0 21,12.5H13.4L12.47,14.8C12.07,15.81 10.92,15.67 10.55,14.83L8.5,9.5L7.54,11.83C7.39,12.21 7.05,12.5 6.6,12.5H3Z',
  unlinked: 'M4,1C2.89,1 2,1.89 2,3V7C2,8.11 2.89,9 4,9H1V11H13V9H10C11.11,9 12,8.11 12,7V3C12,1.89 11.11,1 10,1H4M4,3H10V7H4V3M14,13C12.89,13 12,13.89 12,15V19C12,20.11 12.89,21 14,21H11V23H23V21H20C21.11,21 22,20.11 22,19V15C22,13.89 21.11,13 20,13H14M3.88,13.46L2.46,14.88L4.59,17L2.46,19.12L3.88,20.54L6,18.41L8.12,20.54L9.54,19.12L7.41,17L9.54,14.88L8.12,13.46L6,15.59L3.88,13.46M14,15H20V19H14V15Z',
  updating: 'M13,2.03C17.73,2.5 21.5,6.25 21.95,11C22.5,16.5 18.5,21.38 13,21.93V19.93C16.64,19.5 19.5,16.61 19.96,12.97C20.5,8.58 17.39,4.59 13,4.05V2.05L13,2.03M11,2.06V4.06C9.57,4.26 8.22,4.84 7.1,5.74L5.67,4.26C7.19,3 9.05,2.25 11,2.06M4.26,5.67L5.69,7.1C4.8,8.23 4.24,9.58 4.05,11H2.05C2.25,9.04 3,7.19 4.26,5.67M2.06,13H4.06C4.24,14.42 4.81,15.77 5.69,16.9L4.27,18.33C3.03,16.81 2.26,14.96 2.06,13M7.1,18.37C8.23,19.25 9.58,19.82 11,20V22C9.04,21.79 7.18,21 5.67,19.74L7.1,18.37M12,16.5L7.5,12H11V8H13V12H16.5L12,16.5Z',
};

/* Home Assistant components this page is built from. Every one of them is OPTIONAL:
 * the list is what we wait for, not what we demand. */
const HA_ELEMENTS = [
  'ha-card',
  'ha-md-list',
  'ha-md-list-item',
  'ha-svg-icon',
  'ha-icon-next',
  'ha-icon-button',
  'ha-alert',
  'ha-button',
  'hass-subpage',
];

/* The page chrome. Present when the operator arrives from Devices & Services, absent
 * on a cold load straight onto the panel URL. */
const CHROME = 'hass-subpage';


/* Matches the backend's own ring buffer, so the view can never claim more history
 * than z2m/logs is able to replay after a reload. */
const LOG_MAX = 300;

const LOG_LEVELS = ['error', 'warning', 'info', 'debug'];

const PAIR_OPEN_SECONDS = 254;
const PAIR_LOG_MAX = 24;

const esc = (s) =>
  String(s ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );

/** `.path` is assigned as a JS property during hydration; markup carries data-* only. */
const icon = (path, slot = 'start') =>
  `<ha-svg-icon${slot ? ` slot="${slot}"` : ''} data-path="${path}"></ha-svg-icon>`;

/**
 * One HA list row. `href` produces a real link row -- HA's own tables then do the
 * work; `go` navigates inside the panel; `act` fires a command. A row that carries
 * its own button must not itself be a button, so `end` suppresses that.
 */
const row = (o) => {
  // `tap` marks a row whose own click is handled in JS (a device row, say). It still
  // has to be type="button", or HA's row renders as inert text: no ripple, no focus
  // ring, no keyboard activation.
  const kind = o.href
    ? ` type="link" href="${esc(o.href)}"`
    : o.go
      ? ` type="button" data-go="${esc(o.go)}"`
      : o.act && o.end === undefined
        ? ` type="button" data-act="${esc(o.act)}"`
        : o.tap
          ? ' type="button"'
          : '';
  const end =
    o.end !== undefined
      ? o.end
      : o.href || o.go || o.act || o.tap
        ? '<ha-icon-next slot="end"></ha-icon-next>'
        : '';
  return `
      <ha-md-list-item${kind}${o.data || ''}>
        ${o.icon ? icon(o.icon) : ''}
        <div slot="headline">${o.headline}</div>
        ${o.text ? `<div slot="supporting-text">${o.text}</div>` : ''}
        ${end}
      </ha-md-list-item>`;
};

/**
 * HA's own list container when it is defined, otherwise a neutral role="list"
 * wrapper. HA's ha-md-list is itself a thin md-list wrapper, so this substitution is
 * semantics and layout only: the ROWS stay genuine ha-md-list-item, which is where
 * the visual identity actually lives. On a cold panel load this is the one element
 * that is reliably missing while its own list item is present.
 */
const list = (rows) =>
  customElements.get('ha-md-list')
    ? `<ha-md-list>${rows}</ha-md-list>`
    : `<div role="list" class="mdlist">${rows}</div>`;

const card = (body, cls = 'nav-card') =>
  `<ha-card class="${cls}"><div class="card-content">${body}</div></ha-card>`;

const rowButton = (label, act, appearance = 'plain') =>
  `<ha-button appearance="${appearance}" size="s" slot="end" data-act="${esc(act)}">${esc(
    label
  )}</ha-button>`;

class Z2MPanel extends HTMLElement {
  constructor() {
    super();
    this._view = { name: 'dashboard' };
    this._summary = null;
    this._devices = [];
    this._groups = [];
    this._feedErrors = { info: null, devices: null, groups: null };
    this._feedVersions = { info: 0, devices: 0, groups: 0 };
    this._feedRequests = { info: 0, devices: 0, groups: 0 };
    this._filter = '';
    // Group writes report locally: a refused rename must not blank the dashboard.
    this._groupError = null;
    this._groupNotice = null;
    this._busy = false;
    this._subs = {};
    this._logs = [];
    this._logMin = 'all';
    this._logPinned = true;
    this._logTimer = null;
    this._resetMap();
    this._resetPairing();
    this._diag = { health: null, routers: null, error: null, checked: false };
    this._ticker = null;
    this._counts = '';
  }

  /**
   * The map's own state. `el` outlives every re-render -- it owns the physics, the
   * pinned layout and the selection -- and `scan` is the single object the element
   * reads its age and progress from.
   */
  _resetMap() {
    this._map = {
      el: null,
      topology: null,
      error: null,
      first: true,
      scan: { generated: null, scanning: false, phase: null, done: 0, total: 0 },
    };
  }

  _resetPairing() {
    const old = this._pairing;
    if (old && old.wait) clearTimeout(old.wait);
    this._pairing = {
      run: ((old && old.run) || 0) + 1,
      active: false,
      opening: false,
      subscribed: false,
      ownsPermit: false,
      closing: false,
      pairing: null,
      target: null,
      phase: 'idle',
      supported: null,
      definition: null,
      logs: [],
      error: null,
      notice: null,
      setup: { saving: false, completed: false, device: null },
      wait: null,
    };
  }

  /* ------------------------------------------------------------ HA plumbing */

  set hass(hass) {
    const first = !this._hass;
    this._hass = hass;
    if (first) {
      this._boot();
      return;
    }
    // HA re-sets `hass` on every state change, and the registry collections it
    // carries are how the delegation rows are counted. Patch what reads from it
    // rather than re-rendering: a full render would clobber typing, the log scroll
    // position and the map's own physics.
    if (this._map.el) this._map.el.hass = hass;
    // The label is applied asynchronously after setup, so the counts legitimately
    // change under us once. Re-render only when they actually move.
    if (this._view.name === 'dashboard' && this._countKey() !== this._counts) {
      this._render();
      return;
    }
    this._syncFw();
  }

  set narrow(v) {
    this._narrow = v;
    if (this._hass) this._render();
  }

  set route(_v) {}

  set panel(v) {
    this._panel = v;
  }

  connectedCallback() {
    if (!this.shadowRoot) this.attachShadow({ mode: 'open' });
  }

  disconnectedCallback() {
    this._leavePairing();
    Object.keys(this._subs).forEach((k) => this._unsub(k));
    this._stopTicker();
    if (this._logTimer) {
      clearTimeout(this._logTimer);
      this._logTimer = null;
    }
  }

  _boot() {
    if (!this.shadowRoot) this.attachShadow({ mode: 'open' });

    // Paint before any network or helper work. A cold panel is useful immediately,
    // even while the individual feeds are still being read.
    this._render();
    this._warmUp();

    // Retained feeds make command responses authoritative without a guessed delay.
    // They stay independent: one unavailable bridge topic never blanks the others.
    this._sub('summary', { type: 'z2m/subscribe' }, (ev) => {
      if (!ev || !ev.summary) return;
      this._applyFeed('info', ev.summary);
    }).catch((err) => this._failFeed('info', err));
    this._sub('devices', { type: 'z2m/devices/subscribe' }, (ev) => {
      this._receiveDevices(ev);
    }).catch((err) => this._failFeed('devices', err));
    this._sub('groups', { type: 'z2m/groups/subscribe' }, (ev) => {
      this._receiveGroups(ev);
    }).catch((err) => this._failFeed('groups', err));
    this._refresh();
  }

  /**
   * Warm-up must be wholly nonblocking. Late component definitions simply request a
   * new render; neither a missing custom element nor a never-settling card-helper
   * promise is allowed to stand between the operator and the panel.
   */
  _warmUp() {
    try {
      const warm =
        typeof window !== 'undefined' && window.loadCardHelpers && window.loadCardHelpers();
      Promise.resolve(warm).catch(() => {});
    } catch (_) {
      /* helper warm-up is optional */
    }
    HA_ELEMENTS.forEach((name) => {
      Promise.resolve(customElements.whenDefined(name))
        .then(() => {
          if (this._hass) this._render();
        })
        .catch(() => {});
    });
  }

  _has(name) {
    return !!customElements.get(name);
  }

  async _call(type, extra = {}) {
    return this._hass.connection.sendMessagePromise({ type, ...extra });
  }

  _sub(key, msg, cb) {
    this._unsub(key);
    try {
      const subscription = Promise.resolve(this._hass.connection.subscribeMessage(cb, msg));
      this._subs[key] = subscription;
      return subscription;
    } catch (err) {
      const failed = Promise.reject(err);
      // Keep a rejected subscription observable to callers without letting a
      // fire-and-forget global feed create an unhandled rejection.
      failed.catch(() => {});
      this._subs[key] = failed;
      return failed;
    }
  }

  _unsub(key) {
    const p = this._subs[key];
    if (!p) return;
    delete this._subs[key];
    Promise.resolve(p)
      .then((u) => u && u())
      .catch(() => {});
  }

  _feedMessage(err, fallback) {
    return (err && (err.message || err.code)) || fallback;
  }

  _applyFeed(key, value) {
    if (key === 'info') this._summary = value || null;
    else if (key === 'devices') this._devices = Array.isArray(value) ? value : [];
    else if (key === 'groups') this._groups = Array.isArray(value) ? value : [];
    this._feedVersions[key] += 1;
    this._feedErrors[key] = null;
    this._renderFeedUpdate();
  }

  _failFeed(key, err) {
    this._feedErrors[key] = this._feedMessage(err, `Could not load ${key}`);
    this._renderFeedUpdate();
  }

  _renderFeedUpdate() {
    // The map and standalone log viewer own live DOM that a feed refresh cannot
    // improve. Pairing and group views, on the other hand, need retained updates.
    if (this._view.name !== 'map' && this._view.name !== 'logs') this._render();
  }

  _arrayPayload(ev, key) {
    if (Array.isArray(ev)) return ev;
    return ev && Array.isArray(ev[key]) ? ev[key] : null;
  }

  _receiveDevices(ev) {
    const devices = this._arrayPayload(ev, 'devices');
    if (!devices) return;
    this._applyFeed('devices', devices);
    this._onPairDevices(devices);
  }

  _receiveGroups(ev) {
    const groups = this._arrayPayload(ev, 'groups');
    if (!groups) return;
    this._applyFeed('groups', groups);
    // The retained list is the authoritative answer to a write, so a stale refusal
    // must not sit on screen next to membership that has since changed.
    this._groupError = null;
  }

  _refresh() {
    return Promise.allSettled([
      this._refreshFeed('info', 'z2m/info'),
      this._refreshFeed('devices', 'z2m/devices'),
      this._refreshFeed('groups', 'z2m/groups'),
    ]);
  }

  async _refreshFeed(key, type) {
    const request = ++this._feedRequests[key];
    const version = this._feedVersions[key];
    try {
      const value = await this._call(type);
      if (request !== this._feedRequests[key] || version !== this._feedVersions[key]) return;
      this._applyFeed(key, value);
    } catch (err) {
      if (request !== this._feedRequests[key] || version !== this._feedVersions[key]) return;
      this._failFeed(key, err);
    }
  }

  /* ---------------------------------------------------------------- helpers */

  _dev(ieee) {
    return this._devices.find((d) => d.ieee_address === ieee);
  }

  /** Z2M reports when joining ends, not how long is left. */
  _joinLeft() {
    const end = Number((this._summary || {}).permit_join_end);
    if (!end) return null;
    return Math.max(0, Math.round((end - Date.now()) / 1000));
  }

  /**
   * Counts for the two delegation rows. Both of HA's tables filter on the row's OWN
   * registry labels -- no device-to-entity inheritance anywhere in the filter path --
   * so count exactly the same way the linked page does. A row that disagrees with the
   * page it opens is worse than a missing row, because it looks authoritative.
   */
  _labelled() {
    const label = (this._summary || {}).label_id;
    if (!label) return null;
    const h = this._hass || {};
    const count = (m) => Object.values(m || {}).filter((x) => (x.labels || []).includes(label)).length;
    return { label, devices: count(h.devices), entities: count(h.entities) };
  }

  _countKey() {
    const l = this._labelled();
    return l ? `${l.label}:${l.devices}:${l.entities}` : '';
  }

  /* ----------------------------------------------------------------- styles */

  _styles() {
    // This shadow root deliberately uses HA's public design tokens instead of a
    // panel-local palette. That keeps density, contrast, type and dark mode aligned
    // with the surrounding Settings surfaces.
    return `
      :host { display:block; height:100%; overflow:auto;
              background:var(--primary-background-color);
              color:var(--primary-text-color);
              font-family:var(--ha-font-family-body, var(--paper-font-body1_-_font-family, sans-serif)); }
      .container { padding:var(--ha-space-2, 8px) var(--ha-space-4, 16px)
                   calc(var(--ha-space-16, 64px) + var(--safe-area-inset-bottom, 0px)); }
      ha-card { display:block; max-width:600px; margin:var(--ha-space-4, 16px) auto 0; }
      .nav-card { overflow:hidden; }
      .card-header { display:flex; align-items:center; justify-content:space-between;
                     gap:var(--ha-space-2, 8px); padding:var(--ha-space-3, 12px) var(--ha-space-4, 16px);
                     color:var(--ha-card-header-color, var(--primary-text-color));
                     font-size:var(--ha-font-size-xl, 20px);
                     font-weight:var(--ha-font-weight-normal, 400);
                     line-height:var(--ha-line-height-condensed, 1.2); }
      .nav-card > .card-header { padding-bottom:var(--ha-space-2, 8px); }
      .card-content { padding:var(--ha-space-4, 16px); }
      .nav-card .card-content { padding:0; }
      ha-md-list, .mdlist { display:block; padding:0; background:none; }
      ha-md-list-item { --md-item-overflow:visible; }
      ha-alert { display:block; margin-bottom:var(--ha-space-3, 12px); }
      .header-actions { display:flex; flex-wrap:wrap; align-items:center; justify-content:flex-end;
                        gap:var(--ha-space-2, 8px); }
      .network-status .heading { display:flex; align-items:center; column-gap:var(--ha-space-4, 16px); }
      .network-status .heading .icon { display:flex; align-items:center; justify-content:center;
              position:relative; flex-shrink:0; width:var(--ha-touch-target-min-size, 40px);
              height:var(--ha-touch-target-min-size, 40px); overflow:hidden;
              border-radius:var(--ha-border-radius-2xl, 28px); --icon-color:var(--primary-color); }
      .network-status .heading .icon.success { --icon-color:var(--success-color); }
      .network-status .heading .icon.error { --icon-color:var(--error-color); }
      .network-status .heading .icon:before { position:absolute; inset:0; display:block;
              content:""; background-color:var(--icon-color); opacity:var(--ha-opacity-disabled, .2); }
      .network-status .heading .icon ha-svg-icon { z-index:1; width:var(--ha-icon-size-m, 24px);
              height:var(--ha-icon-size-m, 24px); color:var(--icon-color); }
      .network-status .details { flex:1; min-width:0; color:var(--primary-text-color);
              font-size:var(--ha-font-size-xl, 20px); line-height:var(--ha-line-height-condensed, 1.2); }
      .network-status small, .supporting { color:var(--secondary-text-color);
              font-size:var(--ha-font-size-m, 14px); line-height:var(--ha-line-height-condensed, 1.2); }
      .network-status small.offline { color:var(--error-color); }
      .network-status .version { align-self:flex-start; color:var(--secondary-text-color);
              font-size:var(--ha-font-size-m, 14px); white-space:nowrap; }
      .kv { display:flex; gap:var(--ha-space-4, 16px); padding:var(--ha-space-3, 12px) var(--ha-space-4, 16px);
            font-size:var(--ha-font-size-m, 14px); }
      .kv + .kv { border-top:var(--ha-border-width, 1px) solid var(--divider-color); }
      .kv .k { flex:0 0 45%; color:var(--secondary-text-color); }
      .kv .v { flex:1; min-width:0; overflow-wrap:anywhere; font-family:var(--ha-font-family-code, monospace); }
      .empty { padding:var(--ha-space-8, 32px) var(--ha-space-4, 16px); text-align:center;
               color:var(--secondary-text-color); }
      .note { padding:var(--ha-space-3, 12px) var(--ha-space-4, 16px);
              color:var(--secondary-text-color); font-size:var(--ha-font-size-m, 14px); }
      .actions { display:flex; flex-wrap:wrap; justify-content:flex-end; gap:var(--ha-space-2, 8px);
                 padding:var(--ha-space-2, 8px) var(--ha-space-4, 16px) var(--ha-space-4, 16px); }
      .search { display:flex; align-items:center; gap:var(--ha-space-3, 12px);
                padding:var(--ha-space-2, 8px) var(--ha-space-4, 16px);
                border-bottom:var(--ha-border-width, 1px) solid var(--divider-color); }
      .search input { flex:1; min-width:0; padding:var(--ha-space-2, 8px) 0; border:0; outline:0;
                background:transparent; color:var(--primary-text-color); font:inherit;
                font-size:var(--ha-font-size-l, 16px); }
      .search .grow { flex:1; font-size:var(--ha-font-size-m, 14px); }
      .search ha-svg-icon { color:var(--secondary-text-color); }
      .chip { display:inline-block; padding:0 var(--ha-space-2, 8px); border:var(--ha-border-width, 1px) solid;
              border-radius:var(--ha-border-radius-pill, 999px); color:var(--secondary-text-color);
              font-size:var(--ha-font-size-xs, 12px); line-height:var(--ha-line-height-normal, 1.5);
              white-space:nowrap; }
      .chip.off { color:var(--error-color); }
      .chip.warn { color:var(--warning-color); }
      .chip.ok { color:var(--success-color); }
      .chip[hidden] { display:none; }
      input[type=text], input[type=number], select { box-sizing:border-box; max-width:var(--ha-control-max-width, 220px);
              min-height:var(--ha-touch-target-min-size, 40px); padding:var(--ha-space-2, 8px);
              border:var(--ha-border-width, 1px) solid var(--divider-color);
              border-radius:var(--ha-border-radius-md, 8px); background:var(--card-background-color);
              color:var(--primary-text-color); font:inherit; font-size:var(--ha-font-size-m, 14px); }
      input[type=checkbox] { width:var(--ha-touch-target-min-size, 20px);
              height:var(--ha-touch-target-min-size, 20px); accent-color:var(--primary-color); }
      input:focus-visible, select:focus-visible, ha-button:focus-visible, ha-icon-button:focus-visible {
              outline:var(--ha-outline-width, 2px) solid var(--primary-color);
              outline-offset:var(--ha-space-1, 4px); }
      .form-row { display:flex; align-items:center; gap:var(--ha-space-3, 12px);
                  padding:var(--ha-space-3, 12px) var(--ha-space-4, 16px); }
      .form-row > label { flex:1; min-width:0; color:var(--secondary-text-color);
                          font-size:var(--ha-font-size-m, 14px); }
      .form-row > input, .form-row > select { flex:1; min-width:0; }
      .pair-state { display:grid; gap:var(--ha-space-2, 8px); padding:var(--ha-space-4, 16px); }
      .pair-identity { padding:var(--ha-space-3, 12px) var(--ha-space-4, 16px);
                       border-top:var(--ha-border-width, 1px) solid var(--divider-color); }
      .pair-identity strong, .pair-identity code { display:block; overflow-wrap:anywhere; }
      .pair-log { max-height:var(--ha-log-max-height, 240px); overflow:auto;
                  border-top:var(--ha-border-width, 1px) solid var(--divider-color); }
      .pair-log .log { padding-inline:var(--ha-space-4, 16px); }
      .recovery { border-top:var(--ha-border-width, 1px) solid var(--divider-color); }
      .container.mapview { padding:0; }
      .stage { height:calc(100vh - var(--header-height,56px)); min-height:360px; }
      .logwrap { min-height:280px; height:calc(100vh - 320px); overflow:auto;
                 border-top:var(--ha-border-width, 1px) solid var(--divider-color); }
      .log { display:flex; gap:var(--ha-space-2, 8px); padding:var(--ha-space-1, 4px) var(--ha-space-4, 16px);
             font-family:var(--ha-font-family-code, monospace); font-size:var(--ha-font-size-s, 12px);
             white-space:pre-wrap; overflow-wrap:anywhere; }
      .log .t { flex:0 0 auto; color:var(--secondary-text-color); }
      .log .l { flex:0 0 var(--ha-log-level-width, 60px); text-transform:uppercase; }
      .log.error .l { color:var(--error-color); }
      .log.warning .l { color:var(--warning-color); }
      .log.info .l { color:var(--info-color, var(--primary-color)); }
      .log.debug .l { color:var(--secondary-text-color); }
      .log .m { flex:1; min-width:0; }
      .toolbar { position:sticky; top:0; z-index:2; display:flex; align-items:center;
                 gap:var(--ha-space-2, 8px); box-sizing:border-box; height:var(--header-height, 56px);
                 padding:var(--ha-space-2, 8px) var(--ha-space-3, 12px);
                 background-color:var(--app-header-background-color, var(--primary-color));
                 color:var(--app-header-text-color, var(--primary-text-color));
                 border-bottom:var(--app-header-border-bottom, none); }
      .toolbar ha-icon-button { color:var(--app-header-text-color, var(--primary-text-color)); }
      .maintitle { flex:1; min-width:0; margin-inline-start:var(--ha-space-2, 8px);
                   overflow-wrap:anywhere; font-size:var(--ha-font-size-xl, 20px);
                   font-weight:var(--ha-font-weight-normal, 400); line-height:var(--ha-line-height-normal, 1.4); }
      @media (max-width:600px) {
        .container { padding:var(--ha-space-1, 4px) var(--ha-space-2, 8px)
                     calc(var(--ha-space-12, 48px) + var(--safe-area-inset-bottom, 0px)); }
        .card-header { align-items:flex-start; }
        .header-actions { justify-content:flex-start; }
        .kv { flex-direction:column; gap:var(--ha-space-1, 4px); }
        .kv .k { flex:none; }
        .form-row { align-items:stretch; flex-direction:column; }
        input[type=text], input[type=number], select { max-width:none; width:100%; }
        .logwrap { height:calc(100vh - 280px); }
      }
    `;
  }

  /* ----------------------------------------------------------------- render */

  /**
   * Which failed feeds this view actually depends on. The old panel read all three
   * in one Promise.all and put a single "Unknown error" above every page, so one
   * broken command made the whole integration look dead. A feed the current view
   * does not use is not this view's error.
   */
  _feedAlert() {
    const relevant = { info: true };
    if (['dashboard', 'devices', 'device', 'ota', 'group', 'pairing'].includes(this._view.name))
      relevant.devices = true;
    if (['dashboard', 'groups', 'group'].includes(this._view.name)) relevant.groups = true;

    const failed = Object.keys(relevant).filter((k) => this._feedErrors[k]);
    if (!failed.length) return '';
    return failed
      .map(
        (k) =>
          `<ha-alert alert-type="error" title="${
            k === 'info' ? 'Bridge unavailable' : `Could not read Zigbee ${k}`
          }">${esc(this._feedErrors[k])}</ha-alert>`
      )
      .join('');
  }

  _render() {
    if (!this.shadowRoot) return;

    this._counts = this._countKey();
    const body = `<div class="container${this._view.name === 'map' ? ' mapview' : ''}">
        ${this._error ? `<ha-alert alert-type="error">${esc(this._error)}</ha-alert>` : ''}
        ${this._feedAlert()}
        ${this._bodyFor()}
      </div>`;

    const top = this._view.name === 'dashboard';
    const markup = `<style>${this._styles()}</style>${
      this._has(CHROME) ? this._subpageChrome(body, top) : this._plainChrome(body, top)
    }`;

    // Pushes arrive on every retained bridge topic change, and per-device
    // availability across a 45-device mesh means most of them change nothing on
    // screen. Rebuilding anyway would recreate HA's components, drop the scroll
    // position and steal the caret, so a render that would produce identical markup
    // is simply not performed.
    if (markup === this._markup) return;
    this._markup = markup;

    // The operator may be mid-word in the device search when a push lands.
    const focused = this.shadowRoot.activeElement;
    const focusId = focused && focused.id;
    let caret = null;
    try {
      caret = focused ? focused.selectionStart : null;
    } catch (_) {
      caret = null; // inputs that do not support selection throw on read
    }

    this.shadowRoot.innerHTML = markup;
    this._hydrate();

    if (focusId) {
      const again = this.shadowRoot.getElementById(focusId);
      if (again && again.focus) {
        again.focus();
        try {
          if (caret !== null && again.setSelectionRange) again.setSelectionRange(caret, caret);
        } catch (_) {
          /* selection is a nicety; focus is the part that matters */
        }
      }
    }

    this._enter();
  }

  /** HA's own page chrome: header, back arrow and refresh action. */
  _subpageChrome(body, top) {
    return `<hass-subpage id="page" header="${esc(this._title())}"${top ? ' main-page' : ''}${
      this._narrow ? ' narrow' : ''
    }>
        <ha-icon-button id="reload" slot="toolbar-icon" data-act="refresh"
          data-path="${MDI.refresh}" data-label="Refresh"></ha-icon-button>
        ${body}
      </hass-subpage>`;
  }

  /**
   * Chrome for a cold load straight onto the panel URL, where hass-subpage's chunk
   * has not been fetched. The content and action hierarchy stay the same; only the
   * native page shell is temporarily unavailable.
   */
  _plainChrome(body, top) {
    return `<div class="toolbar">
        ${
          top
            ? ''
            : `<ha-icon-button id="back" data-act="back" data-path="${MDI.back}"
                 data-label="Back"></ha-icon-button>`
        }
        <div class="maintitle">${esc(this._title())}</div>
        <ha-icon-button id="reload" data-act="refresh" data-path="${MDI.refresh}"
          data-label="Refresh"></ha-icon-button>
      </div>
      ${body}`;
  }

  _title() {
    switch (this._view.name) {
      case 'devices':
        return 'Devices';
      case 'device':
        return (this._dev(this._view.ieee) || {}).friendly_name || 'Device';
      case 'groups':
        return 'Groups';
      case 'group':
        return (this._group(this._view.group) || {}).friendly_name || 'Group';
      case 'pairing':
        return 'Add device';
      case 'network':
        return 'Network information';
      case 'ota':
        return 'Firmware';
      case 'map':
        return 'Network map';
      case 'logs':
        return 'Logs';
      case 'diagnostics':
        return 'Diagnostics';
      case 'options':
        return 'Options';
      default:
        return 'Zigbee';
    }
  }

  _bodyFor() {
    switch (this._view.name) {
      case 'devices':
        return this._devicesView();
      case 'device':
        return this._deviceView(this._view.ieee);
      case 'groups':
        return this._groupsView();
      case 'group':
        return this._groupView(this._view.group);
      case 'pairing':
        return this._pairingView();
      case 'network':
        return this._networkView();
      case 'ota':
        return this._otaView();
      case 'map':
        return this._mapView();
      case 'logs':
        return this._logsView();
      case 'diagnostics':
        return this._diagView();
      case 'options':
        return this._optionsView();
      default:
        return this._dashboard();
    }
  }

  /** Assign the JS properties and listeners markup cannot carry. */
  _hydrate() {
    const r = this.shadowRoot;

    r.querySelectorAll('[data-path]').forEach((el) => {
      el.path = el.dataset.path;
      if (el.dataset.label) el.label = el.dataset.label;
    });

    const page = r.getElementById('page');
    if (page) {
      page.hass = this._hass;
      // Sub-views step back through the panel's own view state. The top level has no
      // in-panel parent, so it shows HA's menu button instead of a back arrow.
      page.backCallback = this._view.name === 'dashboard' ? undefined : () => this._back();
    }

    r.querySelectorAll('[data-go]').forEach((el) => {
      el.onclick = () => this._go({ name: el.dataset.go });
    });
    r.querySelectorAll('[data-ieee]').forEach((el) => {
      el.onclick = () => this._go({ name: 'device', ieee: el.dataset.ieee });
    });
    r.querySelectorAll('[data-group]').forEach((el) => {
      el.onclick = () => this._go({ name: 'group', group: el.dataset.group });
    });
    r.querySelectorAll('[data-act]').forEach((el) => {
      el.onclick = () => this._dispatch(el.dataset.act, el);
    });
    r.querySelectorAll('[data-change]').forEach((el) => {
      el.onchange = () => this._change(el.dataset.change, el);
    });

    const q = r.getElementById('q');
    // _render restores focus and caret for whatever was focused, so typing here just
    // needs to update the filter.
    if (q) q.oninput = () => {
      this._filter = q.value;
      this._render();
    };

    const scroll = r.getElementById('logscroll');
    if (scroll) {
      scroll.onscroll = () => {
        this._logPinned = scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 48;
        const chip = this.shadowRoot.getElementById('logpaused');
        if (chip) chip.hidden = this._logPinned;
      };
    }

    const stage = r.getElementById('mapstage');
    if (stage && !stage._z2mWired) {
      stage._z2mWired = true;
      // The Re-scan control lives inside the map's own canvas, and so does the node
      // detail panel it opens on a selection -- there is nothing for the shell to
      // draw, so it listens for the one event it acts on.
      stage.addEventListener('z2m-rescan', () => this._startScan());
    }

    if (this._view.name === 'device') this._lastFw = this._fwInner(this._dev(this._view.ieee) || {});
    this._startTicker();
  }

  _back() {
    if (this._view.name === 'device') this._go({ name: 'devices' });
    else if (this._view.name === 'group') this._go({ name: 'groups' });
    else this._go({ name: 'dashboard' });
  }

  _go(view) {
    this._leave();
    this._view = view;
    this._filter = '';
    this._render();
    this.shadowRoot.scrollTop = 0;
  }

  /** Tear down whatever the view being left had running. */
  _leave() {
    if (this._view.name === 'logs') this._unsub('logs');
    if (this._view.name === 'pairing') this._leavePairing();
    if (this._view.name === 'map') {
      this._unsub('map');
      this._unsub('scan');
      this._map.scan.scanning = false;
      this._map.scan.phase = null;
    }
    this._stopTicker();
  }

  /** Start whatever the freshly rendered view needs. */
  _enter() {
    if (this._view.name === 'logs' && !this._subs.logs) this._openLogs();
    if (this._view.name === 'pairing' && !this._pairing.active) this._openPairing();
    // Re-hosting on every render matters: the element instance is retained, so a
    // render caused by (say) a scan error has to put it back where it was.
    if (this._view.name === 'map') {
      if (this._subs.map) this._mountMap();
      else this._openMap();
    }
    if (this._view.name === 'diagnostics' && !this._diag.checked) this._runCoordinatorCheck();
  }

  /* ---------------------------------------------------------------- ticker */

  /** One second tick, only while something on screen actually counts. */
  _needsTicker() {
    if (this._view.name === 'map') return true;
    if (this._view.name === 'pairing') return !!this._pairing.active;
    return this._view.name === 'dashboard' && !!(this._summary || {}).permit_join;
  }

  _startTicker() {
    this._stopTicker();
    if (!this._needsTicker()) return;
    this._ticker = setInterval(() => this._tick(), 1000);
  }

  _stopTicker() {
    if (this._ticker) {
      clearInterval(this._ticker);
      this._ticker = null;
    }
  }

  _tick() {
    const r = this.shadowRoot;
    if (!r) return;
    const join = r.getElementById('joinstate');
    if (join) join.textContent = this._joinText();
    const pairTime = r.getElementById('pairtime');
    if (pairTime) pairTime.textContent = this._pairingCountdown();
    if (this._view.name === 'map') this._syncScan();
  }

  /* -------------------------------------------------------------- dashboard */

  _joinText() {
    const s = this._summary || {};
    if (!s.permit_join) return 'Joining closed';
    const left = this._joinLeft();
    return left ? `Joining open \u2014 ${left}s left` : 'Joining open';
  }

  _dashboard() {
    return this._statusCard() + this._networkCard() + this._toolsCard() + this._backupCard();
  }

  _statusCard() {
    const s = this._summary || {};
    const online = s.state === 'online';
    const offline = s.offline_count || 0;
    const c = s.coordinator || {};
    const rev = (c.meta && (c.meta.revision || c.meta.version)) || null;
    return `
      <ha-card class="content network-status">
        ${
          s.restart_required
            ? `<ha-alert alert-type="warning" title="Restart required">
                 Zigbee2MQTT is holding pending changes until it restarts.
                 <ha-button slot="action" appearance="plain" size="s" data-act="restart">Restart</ha-button>
               </ha-alert>`
            : ''
        }
        <div class="card-content">
          <div class="heading">
            <div class="icon ${online ? 'success' : 'error'}">
              ${icon(online ? MDI.check : MDI.alert, '')}
            </div>
            <div class="details">
              ${online ? 'Online' : 'Offline'}<br>
              <small>${s.device_count || 0} device${(s.device_count || 0) === 1 ? '' : 's'}</small>
              ${offline ? `<small class="offline">(${offline} offline)</small>` : ''}
              <br><small id="joinstate">${esc(this._joinText())}</small>
              ${rev ? `<br><small>Coordinator ${esc(c.type || '')} ${esc(String(rev))}</small>` : ''}
            </div>
            <span class="version">Zigbee2MQTT ${esc(String(s.version || '?'))}</span>
          </div>
        </div>
      </ha-card>`;
  }

  _networkCard() {
    const s = this._summary || {};
    const l = this._labelled();
    const rows = [
      l
        ? row({
            icon: MDI.devices,
            headline: `${l.devices} device${l.devices === 1 ? '' : 's'}`,
            // Deliberately not repeating the offline count from the status card
            // above. This number is one higher than the card's on purpose: the
            // table includes the coordinator, the mesh count does not. Saying so
            // here is cheaper than leaving the operator to spot the discrepancy.
            text: 'In Home Assistant\u2019s device table, incl. coordinator',
            href: `/config/devices/dashboard?historyBack=1&label=${encodeURIComponent(l.label)}`,
          })
        : row({
            // No label yet is a real state on a fresh install, so route to the
            // panel's own list rather than emitting label=null.
            icon: MDI.devices,
            headline: `${s.device_count || 0} device${(s.device_count || 0) === 1 ? '' : 's'}`,
            text: s.offline_count ? `${s.offline_count} offline` : '',
            go: 'devices',
          }),
      l
        ? row({
            icon: MDI.entities,
            headline: `${l.entities} entit${l.entities === 1 ? 'y' : 'ies'}`,
            text: 'In Home Assistant\u2019s entity table',
            href: `/config/entities/dashboard?historyBack=1&label=${encodeURIComponent(l.label)}`,
          })
        : '',
      row({
        icon: MDI.groups,
        headline: `${s.group_count || 0} group${(s.group_count || 0) === 1 ? '' : 's'}`,
        go: 'groups',
      }),
    ].join('');

    // Add device sits here, next to Show map, rather than in a floating corner
    // button. The old FAB was an ha-button pretending to be one, it overlapped the
    // content it floated over, and it toggled the radio directly -- so "Add device"
    // opened the network with nothing on screen to watch. Both actions now belong
    // to the network they act on, and Add device opens the pairing helper.
    return `
      <ha-card class="nav-card">
        <div class="card-header">My network
          <span class="header-actions">
            <ha-button appearance="plain" data-act="map">${icon(MDI.map)}Show map</ha-button>
            <ha-button appearance="filled" data-act="pair">${icon(MDI.plus)}Add device</ha-button>
          </span>
        </div>
        <div class="card-content">${list(rows)}</div>
      </ha-card>`;
  }

  _toolsCard() {
    const s = this._summary || {};
    const cap = this._devices.filter((d) => d.update_entity);
    const avail = cap.filter((d) => (this._fw(d) || {}).available).length;
    const unassessed = cap.filter((d) => !(this._fw(d) || {}).assessed).length;
    const fwText = avail
      ? `${avail} update${avail === 1 ? '' : 's'} available`
      : unassessed
        ? `${unassessed} of ${cap.length} not assessed yet`
        : `${cap.length} devices, all up to date`;

    return card(
      list(
        // The row above delegates to HA's device table. This one is a different
        // capability: the Zigbee side of each device -- rename, reconfigure,
        // re-interview, remove, per-device Z2M options -- which HA's own device page
        // knows nothing about.
        row({
          icon: MDI.devices,
          headline: 'Zigbee devices',
          text: 'Rename, reconfigure, re-interview, remove, per-device settings',
          go: 'devices',
        }) +
          row({
            icon: MDI.options,
            headline: 'Options',
            text: `Log level, permit join and restart${
              s.log_level ? ` \u00b7 now ${esc(s.log_level)}` : ''
            }`,
            go: 'options',
          }) +
          row({
            icon: MDI.diagnostics,
            headline: 'Diagnostics',
            text: 'Health check and coordinator routing table',
            go: 'diagnostics',
          }) +
          row({
            icon: MDI.logs,
            headline: 'Logs',
            go: 'logs',
          }) +
          row({
            icon: MDI.firmware,
            headline: 'Firmware',
            text: fwText,
            go: 'ota',
          }) +
          row({
            icon: MDI.info,
            headline: 'Network information',
            text: 'Coordinator, channel, PAN ID and adapter',
            go: 'network',
          })
      )
    );
  }

  _backupCard() {
    return card(
      list(
        row({
          icon: MDI.download,
          headline: 'Download backup',
          text: 'Asks Zigbee2MQTT for a fresh coordinator backup and saves the archive',
          act: 'backup',
          end: rowButton('Download', 'backup'),
        })
      )
    );
  }

  /* ---------------------------------------------------------------- devices */

  _devicesView() {
    const f = this._filter.toLowerCase();
    const matches = this._devices.filter(
      (d) =>
        !f ||
        (d.friendly_name || '').toLowerCase().includes(f) ||
        (d.model || '').toLowerCase().includes(f) ||
        (d.vendor || '').toLowerCase().includes(f)
    );

    const rows = matches
      .map((d) => {
        const off = d.availability === 'offline';
        const batt = d.power_source && d.power_source !== 'Mains (single phase)';
        return row({
          icon: batt ? MDI.battery : MDI.devices,
          headline: esc(d.friendly_name || d.ieee_address),
          text: esc([d.vendor, d.model].filter(Boolean).join(' \u00b7 ') || 'Unknown model'),
          data: ` data-ieee="${esc(d.ieee_address)}"`,
          tap: true,
          end: `${
            off ? '<span slot="end" class="chip off">offline</span>' : ''
          }<ha-icon-next slot="end"></ha-icon-next>`,
        });
      })
      .join('');

    return `<ha-card class="nav-card">
        <div class="search">${icon(MDI.search, '')}
          <input id="q" type="text" placeholder="Search ${this._devices.length} devices"
            value="${esc(this._filter)}">
        </div>
        <div class="card-content">${
          rows
            ? list(rows)
            : `<div class="empty">No devices match &ldquo;${esc(this._filter)}&rdquo;.</div>`
        }</div>
      </ha-card>`;
  }

  /* ----------------------------------------------------------- device detail */

  _deviceView(ieee) {
    const d = this._dev(ieee);
    if (!d) return `<div class="empty">Device not found.</div>`;

    const opts = (d.options || []).filter((o) =>
      ['numeric', 'binary', 'enum', 'text'].includes(o.type)
    );

    return `
      <ha-card class="nav-card">${this._kvs([
        ['Friendly name', d.friendly_name],
        ['IEEE address', d.ieee_address],
        ['Network address', d.network_address],
        ['Vendor', d.vendor],
        ['Model', d.model],
        ['Description', d.description],
        ['Type', d.type],
        ['Power source', d.power_source],
        ['Availability', d.availability || 'unknown'],
        ['Firmware build', d.software_build_id],
        ['Firmware date', d.date_code],
        ['Supported by Z2M', d.supported === false ? 'NO - custom converter needed' : 'yes'],
      ])}</ha-card>

      <ha-card class="nav-card">
        <div class="card-header">Rename</div>
        <div class="card-content">${list(
          row({
            icon: MDI.rename,
            headline: 'Friendly name',
            text: 'Changes the MQTT topic, so Home Assistant entity IDs regenerate',
            end: `<input slot="end" id="rn" type="text" value="${esc(d.friendly_name || '')}">`,
          })
        )}</div>
        <div class="actions">
          <ha-button appearance="filled" size="s" data-act="rename">Rename</ha-button>
        </div>
      </ha-card>

      ${
        opts.length
          ? `<ha-card class="nav-card">
               <div class="card-header">Device settings</div>
               <div class="card-content">${list(
                 opts.map((o) => this._optionField(o)).join('')
               )}</div>
               <div class="note">Written straight to Zigbee2MQTT.</div>
               <div class="actions">
                 <ha-button appearance="filled" size="s" data-act="options">Save settings</ha-button>
               </div>
             </ha-card>`
          : ''
      }

      <ha-card class="nav-card"><div id="fwbox">${this._fwInner(d)}</div></ha-card>

      <ha-card class="nav-card">
        <div class="card-header">Maintenance</div>
        <div class="card-content">${list(
          row({
            icon: MDI.wrench,
            headline: 'Reconfigure',
            text: 'Re-apply reporting configuration and bindings',
            end: rowButton('Reconfigure', 'configure'),
          }) +
            row({
              icon: MDI.radar,
              headline: 'Re-interview',
              text: 'Rebuild what Zigbee2MQTT knows about this device',
              end: rowButton('Interview', 'interview'),
            }) +
            row({
              icon: MDI.remove,
              headline: 'Remove from network',
              text:
                'Force removal does not tell the device to leave, so it needs a factory reset before it can pair again',
              end: rowButton('Remove', 'remove'),
            })
        )}</div>
      </ha-card>`;
  }

  _kvs(pairs) {
    return pairs
      .filter(([k, v]) => k && v !== undefined && v !== null && v !== '')
      .map(
        ([k, v]) =>
          `<div class="kv"><div class="k">${esc(k)}</div><div class="v">${esc(String(v))}</div></div>`
      )
      .join('');
  }

  /**
   * Z2M ships an `options` schema per device, so the form is generated from it rather
   * than hard-coded per model. The controls are plain form controls hosted in HA's own
   * row component: HA ships no form-control set a non-Lit panel can drive without
   * importing Lit, and a hand-rolled imitation of one would drift.
   */
  _optionField(o) {
    const attrs = ` id="opt_${esc(o.property)}" slot="end" data-prop="${esc(o.property)}"`;
    let control;
    if (o.type === 'binary') {
      control = `<input${attrs} data-kind="binary" type="checkbox">`;
    } else if (o.type === 'enum') {
      const values = (o.values || [])
        .map((v) => `<option value="${esc(String(v))}">${esc(String(v))}</option>`)
        .join('');
      control = `<select${attrs} data-kind="enum"><option value=""></option>${values}</select>`;
    } else if (o.type === 'numeric') {
      control =
        `<input${attrs} data-kind="numeric" type="number"` +
        `${o.value_min !== undefined ? ` min="${esc(o.value_min)}"` : ''}` +
        `${o.value_max !== undefined ? ` max="${esc(o.value_max)}"` : ''}` +
        `${o.value_step !== undefined ? ` step="${esc(o.value_step)}"` : ''}>`;
    } else {
      control = `<input${attrs} data-kind="text" type="text">`;
    }
    const range =
      o.type === 'numeric' && o.value_min !== undefined && o.value_max !== undefined
        ? ` (${esc(o.value_min)}\u2013${esc(o.value_max)})`
        : '';
    return row({
      headline: `${esc(o.label || o.name || o.property)}${range}`,
      text: o.description ? esc(o.description) : '',
      end: control,
    });
  }

  /* --------------------------------------------------------------- firmware */
  //
  // Firmware state is read from Home Assistant's own `update` entity for the device
  // rather than parsed a second time from MQTT. Z2M already feeds installed_version /
  // latest_version / in_progress / update_percentage into it, so this cannot disagree
  // with what HA's native update UI shows.

  _fw(d) {
    const eid = d && d.update_entity;
    if (!eid || !this._hass || !this._hass.states) return null;
    const s = this._hass.states[eid];
    if (!s) return null;
    const a = s.attributes || {};
    // Z2M publishes -1 for "never assessed" -- it has not asked the OTA index yet.
    const unset = (v) => v === null || v === undefined || String(v) === '-1';
    return {
      entity: eid,
      available: s.state === 'on',
      unavailable: s.state === 'unavailable',
      installed: a.installed_version,
      latest: a.latest_version,
      assessed: !(unset(a.installed_version) || unset(a.latest_version)),
      inProgress: !!a.in_progress,
      pct: a.update_percentage,
    };
  }

  _fwInner(d) {
    const battery = d.power_source && d.power_source !== 'Mains (single phase)';
    const f = this._fw(d);

    if (!f) {
      return `<div class="card-header">Firmware</div>
        <div class="note">This device reports no OTA support, so Zigbee2MQTT exposes no
        update entity for it.</div>`;
    }

    let status = 'Up to date';
    let chip = 'ok';
    if (f.inProgress) {
      status = `Updating${f.pct != null ? ` \u2014 ${f.pct}%` : ''}`;
      chip = 'warn';
    } else if (f.unavailable) {
      status = 'Device unreachable';
      chip = 'off';
    } else if (!f.assessed) {
      status = 'Not assessed';
      chip = '';
    } else if (f.available) {
      status = 'Update available';
      chip = 'warn';
    }

    const ver = (v) =>
      v === null || v === undefined || String(v) === '-1' ? '\u2014' : esc(String(v));

    const buttons = f.inProgress
      ? '<ha-button appearance="plain" size="s" data-act="fwabort">Abort</ha-button>'
      : '<ha-button appearance="plain" size="s" data-act="fwcheck">Check</ha-button>' +
        (f.available && !battery
          ? '<ha-button appearance="filled" size="s" data-act="fwinstall">Install</ha-button>'
          : '') +
        (f.available && battery
          ? '<ha-button appearance="plain" size="s" data-act="fwunsched">Cancel schedule</ha-button>' +
            '<ha-button appearance="filled" size="s" data-act="fwsched">Schedule</ha-button>'
          : '');

    return `
      <div class="card-header">Firmware <span class="chip ${chip}">${esc(status)}</span></div>
      ${this._kvs([
        ['Installed', ver(f.installed)],
        ['Latest known', ver(f.latest)],
        f.inProgress && f.pct != null ? ['Progress', `${f.pct}%`] : ['', ''],
      ])}
      <div class="note">${
        !f.assessed
          ? 'Zigbee2MQTT has never asked the OTA index about this device. Check to populate it. '
          : ''
      }${
        battery
          ? 'Battery device: schedule the update and it applies when the device next wakes.'
          : 'Checking only contacts the firmware index; it never installs.'
      }</div>
      <div class="actions">${buttons}</div>`;
  }

  /** Patch only the firmware surface, so a state push cannot clobber typing elsewhere. */
  _syncFw() {
    const r = this.shadowRoot;
    if (!r) return;
    if (this._view.name === 'ota') {
      const box = r.getElementById('otalist');
      if (!box) return;
      const html = this._otaRows();
      if (html === this._lastOta) return;
      this._lastOta = html;
      box.innerHTML = html;
      this._hydrate();
      return;
    }
    if (this._view.name !== 'device') return;
    const box = r.getElementById('fwbox');
    if (!box) return;
    const d = this._dev(this._view.ieee);
    if (!d) return;
    const html = this._fwInner(d);
    if (html === this._lastFw) return;
    this._lastFw = html;
    box.innerHTML = html;
    this._hydrate();
  }

  /* -------------------------------------------------------------- ota fleet */

  _otaRows() {
    const cap = this._devices.filter((d) => d.update_entity);
    if (!cap.length) return '<div class="empty">No OTA-capable devices.</div>';
    return list(
      cap
        .map((d) => {
          const f = this._fw(d) || {};
          let chip = '<span slot="end" class="chip">not assessed</span>';
          let ico = MDI.firmware;
          if (f.inProgress) {
            chip = `<span slot="end" class="chip warn">${esc(f.pct ?? 0)}%</span>`;
            ico = MDI.updating;
          } else if (f.unavailable) chip = '<span slot="end" class="chip off">offline</span>';
          else if (f.available) chip = '<span slot="end" class="chip warn">update</span>';
          else if (f.assessed) chip = '<span slot="end" class="chip ok">up to date</span>';
          return row({
            icon: ico,
            headline: esc(d.friendly_name),
            text: esc([d.vendor, d.model].filter(Boolean).join(' \u00b7 ')),
            data: ` data-ieee="${esc(d.ieee_address)}"`,
            tap: true,
            end: `${chip}<ha-icon-next slot="end"></ha-icon-next>`,
          });
        })
        .join('')
    );
  }

  _otaView() {
    const n = this._devices.filter((d) => d.update_entity).length;
    return (
      card(
        list(
          row({
            icon: MDI.refresh,
            headline: `Check all ${n} devices`,
            text:
              'Staggered a few seconds apart on purpose: a burst of queries is heavy on the coordinator',
            end: rowButton('Check all', 'checkall'),
          })
        )
      ) + `<ha-card class="nav-card"><div id="otalist">${this._otaRows()}</div></ha-card>`
    );
  }

  /* -------------------------------------------------------- network / groups */

  _networkView() {
    const s = this._summary || {};
    const c = s.coordinator || {};
    const n = s.network || {};
    return (
      `<ha-card class="nav-card">${this._kvs([
        ['Zigbee2MQTT version', s.version],
        ['Coordinator type', c.type],
        ['Coordinator IEEE', c.ieee_address],
        ['Coordinator firmware', (c.meta && (c.meta.revision || c.meta.version)) || ''],
        ['Serial / adapter', s.serial],
        ['Channel', n.channel],
        ['PAN ID', n.pan_id],
        [
          'Extended PAN ID',
          Array.isArray(n.extended_pan_id) ? n.extended_pan_id.join(':') : n.extended_pan_id,
        ],
        ['MQTT base topic', s.base_topic],
        ['Log level', s.log_level],
      ])}</ha-card>` + card('<div class="note">The network key is deliberately not shown here.</div>')
    );
  }

  /* ----------------------------------------------------------------- groups */

  /** A group by its id, tolerating the string ids that arrive from the DOM. */
  _group(id) {
    const key = String(id);
    return (this._groups || []).find((g) => String(g.id) === key) || null;
  }

  /** Every device endpoint, as the member picker's candidate list. */
  _memberCandidates(group) {
    const taken = new Set(
      (group.members || []).map((m) => `${m.ieee_address}|${m.endpoint}`)
    );
    const out = [];
    for (const d of this._devices) {
      // A device with no endpoint projection can still be grouped on its first
      // endpoint, which is what Z2M means by "default".
      const endpoints = (d.endpoints || []).length ? d.endpoints : ['default'];
      for (const endpoint of endpoints) {
        if (taken.has(`${d.ieee_address}|${endpoint}`)) continue;
        out.push({ device: d, endpoint });
      }
    }
    return out;
  }

  _groupsView() {
    const rows = (this._groups || [])
      .map((g) => {
        const members = (g.members || []).length;
        return row({
          icon: MDI.groups,
          headline: esc(g.friendly_name || String(g.id)),
          text: `ID ${esc(String(g.id))} \u00b7 ${members} member${
            members === 1 ? '' : 's'
          }`,
          data: ` data-group="${esc(String(g.id))}"`,
          tap: true,
        });
      })
      .join('');

    // Create stays reachable when the list is empty, which is the state a first
    // group is made from.
    return (
      (this._groupError
        ? `<ha-alert alert-type="error">${esc(this._groupError)}</ha-alert>`
        : '') +
      `<ha-card class="nav-card">
        <div class="card-header">Zigbee groups
          <span class="header-actions">
            <ha-button appearance="filled" size="s" data-act="groupadd">${icon(
              MDI.plus
            )}New group</ha-button>
          </span>
        </div>
        <div class="form-row">
          <label for="gname">Name</label>
          <input id="gname" type="text" placeholder="Kitchen downlights">
        </div>
        <div class="card-content">${
          rows ? list(rows) : '<div class="empty">No Zigbee groups yet.</div>'
        }</div>
        <div class="note">A Zigbee group switches its members from the radio itself,
        so they respond together instead of one after another.</div>
      </ha-card>`
    );
  }

  _groupView(id) {
    const g = this._group(id);
    if (!g) {
      return `<ha-card class="nav-card"><div class="empty">This group no longer exists.</div></ha-card>`;
    }

    const members = g.members || [];
    const memberRows = members
      .map((m) => {
        const dev = this._dev(m.ieee_address);
        return row({
          icon: MDI.devices,
          headline: esc((dev && dev.friendly_name) || m.ieee_address),
          text: `Endpoint ${esc(String(m.endpoint))}${
            dev && dev.model ? ` \u00b7 ${esc(dev.model)}` : ''
          }`,
          end: `<ha-button slot="end" appearance="plain" size="s"
                  data-act="memberremove"
                  data-device="${esc(m.ieee_address)}"
                  data-endpoint="${esc(String(m.endpoint))}">Remove</ha-button>`,
        });
      })
      .join('');

    const candidates = this._memberCandidates(g);
    const options = candidates
      .map(
        (c) =>
          `<option value="${esc(`${c.device.ieee_address}|${c.endpoint}`)}">${esc(
            c.device.friendly_name || c.device.ieee_address
          )}${(c.device.endpoints || []).length > 1 ? ` \u2014 endpoint ${esc(String(c.endpoint))}` : ''}</option>`
      )
      .join('');

    return (
      (this._groupError
        ? `<ha-alert alert-type="error">${esc(this._groupError)}</ha-alert>`
        : '') +
      (this._groupNotice
        ? `<ha-alert alert-type="success">${esc(this._groupNotice)}</ha-alert>`
        : '') +
      `<ha-card class="nav-card">
        ${this._kvs([
          ['Group ID', g.id],
          ['Members', members.length],
        ])}
        <div class="form-row">
          <label for="grn">Name</label>
          <input id="grn" type="text" value="${esc(g.friendly_name || '')}">
        </div>
        <div class="actions">
          <ha-button appearance="plain" size="s" data-act="grouprename">Rename</ha-button>
        </div>
      </ha-card>` +
      `<ha-card class="nav-card">
        <div class="card-header">Members</div>
        <div class="card-content">${
          memberRows ? list(memberRows) : '<div class="empty">No members yet.</div>'
        }</div>
        ${
          candidates.length
            ? `<div class="form-row">
                 <label for="gmember">Add</label>
                 <select id="gmember">${options}</select>
                 <ha-button appearance="filled" size="s" data-act="memberadd">Add</ha-button>
               </div>`
            : '<div class="note">Every device endpoint is already in this group.</div>'
        }
        <div class="note">Membership is per endpoint, because that is what the radio
        binds. A multi-endpoint device can have one endpoint in the group and not
        another.</div>
      </ha-card>` +
      `<ha-card class="nav-card recovery">
        <div class="card-header">Delete</div>
        <div class="card-content">${list(
          row({
            icon: MDI.groups,
            headline: 'Delete this group',
            text: 'Tells each member to leave the group, then removes it',
            end: rowButton('Delete', 'groupremove'),
          }) +
            row({
              icon: MDI.alert,
              headline: 'Force delete',
              text: 'Recovery only \u2014 deletes the group without telling the devices, so they stay programmed with its address',
              end: rowButton('Force', 'groupforce'),
            })
        )}</div>
      </ha-card>`
    );
  }

  /* ---------------------------------------------------------------- pairing */
  //
  // Completion is decided by Zigbee2MQTT's bridge/event stream, never by reading
  // the log. The log is shown because it is the only place a failing join
  // explains itself, but a line of text is not a state machine: `device_joined`
  // then `device_interview successful` is what "paired" means, and the interview
  // carries whether Z2M has a converter for the thing that just joined.

  /** Seconds left in the join window, from Z2M's own end timestamp. */
  _pairingCountdown() {
    const left = this._joinLeft();
    if (!(this._summary || {}).permit_join) return 'closed';
    return left ? `${left}s left` : 'open';
  }

  /**
   * Subscribe FIRST, then open the radio. The events are not retained, so a
   * subscription established after the request can miss the join it was opened for.
   */
  async _openPairing() {
    const p = this._pairing;
    if (p.active) return;
    p.active = true;
    const run = p.run;

    try {
      await Promise.all([
        this._sub('pairing', { type: 'z2m/pairing/subscribe' }, (ev) =>
          this._onPairingEvent(run, ev)
        ),
        this._sub('pairlogs', { type: 'z2m/logs/subscribe' }, (entry) =>
          this._onPairLog(run, entry)
        ),
      ]);
    } catch (err) {
      if (this._pairing.run !== run) return;
      p.error = this._feedMessage(err, 'Could not watch the pairing stream');
      this._render();
      return;
    }
    if (this._pairing.run !== run) return;
    p.subscribed = true;
    await this._openJoinWindow();
  }

  async _openJoinWindow() {
    const p = this._pairing;
    const run = p.run;
    p.opening = true;
    p.error = null;
    p.notice = null;
    this._render();
    try {
      await this._call('z2m/permit_join', { time: PAIR_OPEN_SECONDS });
      if (this._pairing.run !== run) return;
      // Only a window this helper opened is a window this helper may close.
      p.ownsPermit = true;
      p.phase = 'waiting';
    } catch (err) {
      if (this._pairing.run !== run) return;
      p.error = this._feedMessage(err, 'Zigbee2MQTT refused to open the network');
    } finally {
      if (this._pairing.run === run) {
        p.opening = false;
        this._render();
      }
    }
  }

  /** Close the window only when we opened it, so another tab is left alone. */
  async _closeJoinWindow() {
    const p = this._pairing;
    if (!p.ownsPermit || p.closing) return;
    p.closing = true;
    p.ownsPermit = false;
    try {
      await this._call('z2m/permit_join', { time: 0 });
    } catch (_) {
      // The window expires by itself after PAIR_OPEN_SECONDS, so a failed close
      // is not worth an error banner over a device that just paired.
    } finally {
      p.closing = false;
    }
  }

  _leavePairing() {
    const p = this._pairing;
    if (!p) return;
    this._unsub('pairing');
    this._unsub('pairlogs');
    if (p.ownsPermit) this._closeJoinWindow();
    this._resetPairing();
  }

  _onPairLog(run, entry) {
    const p = this._pairing;
    if (p.run !== run || !entry || !entry.message) return;
    p.logs.push(entry);
    if (p.logs.length > PAIR_LOG_MAX) p.logs.splice(0, p.logs.length - PAIR_LOG_MAX);
    // Patch the log box in place: a full render would drop the operator's typing
    // in the name field once a device has joined.
    const box = this.shadowRoot && this.shadowRoot.getElementById('pairlog');
    if (box) box.innerHTML = this._pairLogRows();
  }

  _pairLogRows() {
    return this._pairing.logs
      .map(
        (e) =>
          `<div class="log ${esc(e.level || 'info')}"><span class="l">${esc(
            e.level || 'info'
          )}</span><span class="m">${esc(e.message)}</span></div>`
      )
      .join('');
  }

  /**
   * One pairing envelope. A snapshot replaces what we know; an event is only ours
   * if it concerns the device this session already latched onto, or is the first
   * join of the session. Two people pairing at once must not each see the other's
   * device.
   */
  _onPairingEvent(run, ev) {
    const p = this._pairing;
    if (p.run !== run || !ev) return;

    if (ev.kind === 'snapshot') {
      p.pairing = ev.pairing || null;
      // Adopt an in-flight device after a reload: the events that named it are
      // gone, but the snapshot still carries its phase.
      if (!p.target && p.pairing && Array.isArray(p.pairing.sessions)) {
        const live = p.pairing.sessions.find((s) => s.phase !== 'failed');
        if (live) this._adoptPairSession(live);
      }
      this._render();
      return;
    }
    if (ev.kind !== 'event' || !ev.event) return;
    const event = ev.event;
    if (p.target && event.ieee_address !== p.target) return;
    this._adoptPairSession(event);
  }

  _adoptPairSession(event) {
    const p = this._pairing;
    p.target = event.ieee_address;
    p.event = event;
    p.phase = event.phase;
    if ('supported' in event) p.supported = event.supported;
    if (event.definition) p.definition = event.definition;

    if (event.phase === 'successful') {
      // Paired. Close the radio immediately rather than leaving it open for the
      // rest of the window: an open network is an open network.
      this._closeJoinWindow();
    }
    this._render();
  }

  /** The freshly paired device, once the retained inventory has caught up. */
  _pairDevice() {
    const ieee = this._pairing.target;
    return ieee ? this._dev(ieee) : null;
  }

  _onPairDevices() {
    // A joined device appears in the inventory a moment after the event, which is
    // what fills in its model, endpoints and Home Assistant device id.
    if (this._view.name === 'pairing' && this._pairing.target) this._render();
  }

  _pairStatusText() {
    const p = this._pairing;
    switch (p.phase) {
      case 'joined':
        return 'Device joined \u2014 interviewing';
      case 'interview_started':
        return 'Interviewing the device';
      case 'successful':
        return p.supported === false
          ? 'Paired, but Zigbee2MQTT has no converter for this model'
          : 'Paired';
      case 'failed':
        return 'The interview failed';
      case 'waiting':
        return 'Waiting for a device to join';
      default:
        return 'Opening the network';
    }
  }

  _pairingView() {
    const p = this._pairing;
    const done = p.phase === 'successful';
    const dev = this._pairDevice();
    const definition = p.definition || {};
    const areas = Object.values((this._hass && this._hass.areas) || {});

    const identity = p.target
      ? `<div class="pair-identity">
           <strong>${esc(
             (dev && dev.friendly_name) || (p.event && p.event.friendly_name) || p.target
           )}</strong>
           <code class="supporting">${esc(p.target)}</code>
           ${
             definition.vendor || definition.model
               ? `<div class="supporting">${esc(definition.vendor || '')} ${esc(
                   definition.model || ''
                 )}</div>`
               : ''
           }
           ${
             definition.description
               ? `<div class="supporting">${esc(definition.description)}</div>`
               : ''
           }
         </div>`
      : '';

    const status = `<ha-card class="nav-card">
        <div class="pair-state">
          <strong>${esc(this._pairStatusText())}</strong>
          <span class="supporting">Joining ${
            done ? 'closed' : `<span id="pairtime">${esc(this._pairingCountdown())}</span>`
          }</span>
          ${
            done
              ? ''
              : `<span class="supporting">Put the device into pairing mode now \u2014 usually a
                 long press, or power-cycling it a few times.</span>`
          }
        </div>
        ${identity}
        ${
          p.supported === false && done
            ? `<ha-alert alert-type="warning">The device is on the network. Zigbee2MQTT has no
               converter for it, so it has no entities until one is added.</ha-alert>`
            : ''
        }
        ${
          p.phase === 'failed'
            ? `<ha-alert alert-type="error">The interview failed. The device is on the network
               but incompletely known; re-interview it from its device page, or pair it
               closer to a mains-powered device.</ha-alert>`
            : ''
        }
        <div class="actions">
          ${
            done
              ? `<ha-button appearance="plain" data-act="pairagain">Add another</ha-button>`
              : `<ha-button appearance="plain" data-act="pairstop">Stop</ha-button>`
          }
          ${
            !done && !(this._summary || {}).permit_join && !p.opening
              ? `<ha-button appearance="filled" data-act="pairretry">Open again</ha-button>`
              : ''
          }
        </div>
      </ha-card>`;

    // Naming and area are Home Assistant's own registry fields, applied through
    // HA's own websocket command. The Zigbee friendly name is Z2M's, and both are
    // set from this one form so the operator does not have to know that.
    const setup =
      done && p.target
        ? `<ha-card class="nav-card">
             <div class="card-header">Name and place it</div>
             <div class="form-row">
               <label for="pairname">Name</label>
               <input id="pairname" type="text" value="${esc(
                 (dev && dev.friendly_name) || (p.event && p.event.friendly_name) || ''
               )}">
             </div>
             <div class="form-row">
               <label for="pairarea">Area</label>
               <select id="pairarea">
                 <option value="">No area</option>
                 ${areas
                   .map(
                     (a) =>
                       `<option value="${esc(a.area_id)}"${
                         dev && dev.device_id && a.area_id === this._deviceArea(dev.device_id)
                           ? ' selected'
                           : ''
                       }>${esc(a.name)}</option>`
                   )
                   .join('')}
               </select>
             </div>
             ${
               p.setup.completed
                 ? '<ha-alert alert-type="success">Saved.</ha-alert>'
                 : ''
             }
             <div class="actions">
               ${
                 dev && dev.device_id
                   ? `<ha-button appearance="plain" data-act="pairopen">Open device</ha-button>`
                   : '<span class="supporting">Waiting for Home Assistant to register it\u2026</span>'
               }
               <ha-button appearance="filled" data-act="pairsave"${
                 p.setup.saving ? ' disabled' : ''
               }>${p.setup.saving ? 'Saving\u2026' : 'Save'}</ha-button>
             </div>
           </ha-card>`
        : '';

    return (
      (p.error ? `<ha-alert alert-type="error">${esc(p.error)}</ha-alert>` : '') +
      (p.notice ? `<ha-alert alert-type="success">${esc(p.notice)}</ha-alert>` : '') +
      status +
      setup +
      `<ha-card class="nav-card">
         <div class="card-header">Zigbee2MQTT log</div>
         <div class="pair-log" id="pairlog">${this._pairLogRows()}</div>
         <div class="note">Diagnostics only. Pairing is judged by Zigbee2MQTT\u2019s own
         join and interview events, not by this text.</div>
       </ha-card>`
    );
  }

  /** The area a registry device currently sits in, directly or via its own area. */
  _deviceArea(deviceId) {
    const devices = (this._hass && this._hass.devices) || {};
    const entry = devices[deviceId];
    return (entry && entry.area_id) || '';
  }

  /**
   * Apply the operator's chosen name and area. The Zigbee friendly name goes to
   * Zigbee2MQTT, addressed by ieee so a rename cannot miss; the display name and
   * area are Home Assistant registry fields and go through HA's own command. Entity
   * ids are deliberately left alone -- they belong to MQTT discovery.
   */
  async _savePairSetup() {
    const r = this.shadowRoot;
    const p = this._pairing;
    const nameEl = r && r.getElementById('pairname');
    const areaEl = r && r.getElementById('pairarea');
    const name = nameEl ? String(nameEl.value || '').trim() : '';
    const areaId = areaEl ? areaEl.value || null : null;
    if (!p.target) return;

    p.setup.saving = true;
    p.error = null;
    this._render();
    try {
      const current = this._pairDevice() || {};
      if (name && name !== current.friendly_name) {
        await this._call('z2m/device/rename', { from: p.target, to: name });
      }
      let device = this._pairDevice();
      // The HA device appears via MQTT discovery, which is asynchronous. Wait for
      // it briefly rather than failing a rename the operator just asked for.
      for (let i = 0; i < 10 && !(device && device.device_id); i += 1) {
        await new Promise((done) => setTimeout(done, 600));
        await this._refreshFeed('devices', 'z2m/devices');
        device = this._pairDevice();
      }
      if (device && device.device_id) {
        await this._call('config/device_registry/update', {
          device_id: device.device_id,
          name_by_user: name || null,
          area_id: areaId,
        });
        p.setup.completed = true;
      } else {
        p.error =
          'Renamed in Zigbee2MQTT. Home Assistant has not registered the device yet, so its area was not set.';
      }
    } catch (err) {
      p.error = this._feedMessage(err, 'Could not save the device');
    } finally {
      p.setup.saving = false;
      this._render();
    }
  }

  /* ---------------------------------------------------------------- options */

  _optionsView() {
    const s = this._summary || {};
    const levels = LOG_LEVELS.map(
      (l) => `<option value="${l}"${s.log_level === l ? ' selected' : ''}>${l}</option>`
    ).join('');
    return (
      card(
        list(
          row({
            icon: MDI.logs,
            headline: 'Log level',
            text: 'Applied to Zigbee2MQTT immediately; debug is very chatty',
            end: `<select slot="end" id="loglevel" data-change="loglevel">${levels}</select>`,
          }) +
            row({
              icon: MDI.plus,
              headline: 'Permit joining',
              text: s.permit_join
                ? 'Open \u2014 any Zigbee device may join right now'
                : 'Closed \u2014 devices cannot join',
              end: rowButton(s.permit_join ? 'Close' : 'Open for 254s', 'permit'),
            }) +
            row({
              icon: MDI.restart,
              headline: 'Restart Zigbee2MQTT',
              text: 'Brief loss of all Zigbee devices',
              end: rowButton('Restart', 'restart'),
            })
        )
      ) +
      card(
        list(
          row({
            icon: MDI.options,
            headline: 'Integration settings',
            text: 'MQTT base topic and entry options',
            href: '/config/integrations/integration/z2m',
          })
        )
      )
    );
  }

  /* ------------------------------------------------------------ diagnostics */

  _diagView() {
    const d = this._diag;
    const routers = d.routers;

    let routerBody;
    if (!d.checked) {
      routerBody = '<div class="note">Asking the coordinator for its routing table\u2026</div>';
    } else if (routers === null) {
      routerBody = '<div class="note">The coordinator table could not be read.</div>';
    } else if (!routers.length) {
      routerBody =
        '<ha-alert alert-type="success">Every router is present in the coordinator\u2019s table.</ha-alert>';
    } else {
      routerBody = list(
        routers
          .map((r) =>
            row({
              icon: MDI.unlinked,
              headline: esc(r.name || r.ieee),
              text: esc(r.ieee),
              data: ` data-ieee="${esc(r.ieee)}"`,
              tap: true,
            })
          )
          .join('')
      );
    }

    return (
      (d.error ? `<ha-alert alert-type="error">${esc(d.error)}</ha-alert>` : '') +
      card(
        list(
          row({
            icon: MDI.health,
            headline: 'Health check',
            text: 'Asks Zigbee2MQTT to report its own state and per-device counters',
            end: rowButton('Run', 'health'),
          })
        )
      ) +
      (d.health ? this._healthCard(d.health) : '') +
      `<ha-card class="nav-card">
         <div class="card-header">Routers missing from the coordinator
           <ha-button appearance="plain" size="s" data-act="coordcheck">Re-check</ha-button>
         </div>
         <div class="card-content">${routerBody}</div>
         <div class="note">A router the coordinator cannot see is still reachable through its
         neighbours, but it will not be offered as a parent for devices that join next.</div>
       </ha-card>`
    );
  }

  /** Z2M's health payload is version dependent, so render whatever it actually sent. */
  _healthCard(health) {
    const flat = [];
    const walk = (obj, prefix) => {
      Object.keys(obj || {}).forEach((k) => {
        const v = obj[k];
        const label = prefix ? `${prefix} \u203a ${k}` : k;
        if (v && typeof v === 'object' && !Array.isArray(v)) walk(v, label);
        else flat.push([label, Array.isArray(v) ? v.join(', ') : String(v)]);
      });
    };
    walk(health, '');
    const healthy = health && health.healthy;
    return `<ha-card class="nav-card">
        <div class="card-header">Health${
          healthy === undefined
            ? ''
            : ` <span class="chip ${healthy ? 'ok' : 'off'}">${
                healthy ? 'healthy' : 'unhealthy'
              }</span>`
        }</div>
        ${
          flat.length
            ? this._kvs(flat)
            : '<div class="note">Zigbee2MQTT returned an empty payload.</div>'
        }
      </ha-card>`;
  }

  async _runCoordinatorCheck() {
    this._diag.checked = true;
    try {
      const res = await this._call('z2m/coordinator_check');
      this._diag.routers = (res && res.missing_routers) || [];
      this._diag.error = null;
    } catch (err) {
      this._diag.routers = null;
      this._diag.error = (err && (err.message || err.code)) || 'Coordinator check failed';
    }
    if (this._view.name === 'diagnostics') this._render();
  }

  /* ------------------------------------------------------------------- logs */

  _logsView() {
    const levels = ['all']
      .concat(LOG_LEVELS)
      .map((l) => `<option value="${l}"${this._logMin === l ? ' selected' : ''}>${l}</option>`)
      .join('');
    return (
      `<ha-card class="nav-card">
        <div class="search">
          ${icon(MDI.logs, '')}
          <div class="grow">Minimum level</div>
          <select id="logmin" data-change="logmin">${levels}</select>
          <span class="chip warn" id="logpaused"${this._logPinned ? ' hidden' : ''}>paused</span>
          <ha-button appearance="plain" size="s" data-act="logbottom">Latest</ha-button>
        </div>
        <div class="logwrap" id="logscroll"><div id="loglist">${this._logHtml()}</div></div>
      </ha-card>` +
      // The scroll behaviour is visible on screen; what is NOT visible is that this
      // filter is local to the view, so that is the only part worth saying.
      card(
        '<div class="note">This filter only changes what is shown here -- Options sets what ' +
          'Zigbee2MQTT actually emits.</div>'
      )
    );
  }

  _visibleLogs() {
    if (this._logMin === 'all') return this._logs;
    const max = LOG_LEVELS.indexOf(this._logMin);
    return this._logs.filter((e) => {
      const i = LOG_LEVELS.indexOf(String(e.level || '').toLowerCase());
      return i === -1 || i <= max;
    });
  }

  _logHtml() {
    const entries = this._visibleLogs();
    if (!entries.length) return '<div class="empty">No log entries yet.</div>';
    return entries.map((e) => this._logLine(e)).join('');
  }

  _logLine(e) {
    const t = e.time ? new Date(e.time * 1000).toLocaleTimeString() : '';
    const level = String(e.level || '').toLowerCase();
    return `<div class="log ${esc(level)}"><span class="t">${esc(t)}</span><span class="l">${esc(
      level
    )}</span><span class="m">${esc(e.message)}</span></div>`;
  }

  async _openLogs() {
    // Replay the backend's ring buffer first, then follow it. Subscribing before the
    // replay lands would interleave the two, so the order matters.
    try {
      const res = await this._call('z2m/logs');
      this._logs = ((res && res.entries) || []).slice(-LOG_MAX);
      this._paintLogs();
    } catch (err) {
      this._error = (err && (err.message || err.code)) || 'Could not read the log';
      this._render();
      return;
    }
    if (this._view.name !== 'logs') return;
    this._sub('logs', { type: 'z2m/logs/subscribe' }, (entry) => {
      if (!entry || !entry.message) return;
      this._logs.push(entry);
      if (this._logs.length > LOG_MAX) this._logs.splice(0, this._logs.length - LOG_MAX);
      this._scheduleLogPaint();
    });
  }

  /**
   * Debug logging arrives in bursts, so coalesce paints instead of rewriting the list
   * once per line.
   */
  _scheduleLogPaint() {
    if (this._logTimer) return;
    this._logTimer = setTimeout(() => {
      this._logTimer = null;
      this._paintLogs();
    }, 100);
  }

  _paintLogs() {
    const r = this.shadowRoot;
    if (!r || this._view.name !== 'logs') return;
    const box = r.getElementById('loglist');
    if (!box) return;
    box.innerHTML = this._logHtml();
    if (!this._logPinned) return;
    const scroll = r.getElementById('logscroll');
    if (scroll) scroll.scrollTop = scroll.scrollHeight;
  }

  /* -------------------------------------------------------------------- map */

  _mapView() {
    // Nothing but the map and, when there is one, a real error. Age, progress,
    // Re-scan and node detail are drawn by the element inside its own canvas, which
    // is why it gets the entire area.
    return `${
      this._map.error ? `<ha-alert alert-type="error">${esc(this._map.error)}</ha-alert>` : ''
    }
      <div class="stage" id="mapstage"></div>`;
  }

  /** Overridable seam so the shell can be exercised without the map module present. */
  _loadMapModule() {
    return import('./z2m-map.js');
  }

  /**
   * Opening the map never blocks on the radio. Either a scan is cached, in which
   * case the cached topology is read and drawn, or nothing is cached and a STREAMING
   * scan starts: the retained device list lands first so every device is on screen
   * immediately, then each neighbour table attaches as its reply arrives.
   *
   * The cache is probed through the summary's `map_generated`, never by calling
   * z2m/networkmap blind: that command scans when the cache is absent or stale, and
   * that blocking scan is exactly what this view exists to avoid.
   */
  async _openMap() {
    // Follow the scan lifecycle first, so a scan already running elsewhere shows up.
    this._sub('map', { type: 'z2m/networkmap/subscribe' }, (ev) => this._onMapPhase(ev));

    try {
      await this._loadMapModule();
    } catch (err) {
      this._map.error =
        'The network map module could not be loaded: ' + ((err && err.message) || 'unknown error');
      this._render();
      return;
    }
    if (this._view.name !== 'map') return;

    const cached = !!this._map.topology || !!(this._summary || {}).map_generated;
    if (cached && !this._map.topology) {
      try {
        this._map.topology = await this._call('z2m/networkmap');
        this._map.error = null;
      } catch (err) {
        this._map.error = (err && (err.message || err.code)) || 'Could not read the cached map';
      }
      if (this._view.name !== 'map') return;
    }

    // Mount first either way: the scan's very first event carries every device, and
    // it needs somewhere to land.
    this._mountMap();
    // Deliberately unconditional when nothing is cached, including while another
    // session's scan is already running: z2m/networkmap/scan is single-flight and a
    // second caller attaches to the walk in progress, which is how this view gets
    // the fleet drawn instead of an empty canvas until that scan finishes.
    if (!cached) this._startScan();
  }

  /**
   * The element instance outlives re-renders: it owns the physics, the operator's
   * pinned layout and the current selection, and rebuilding it would throw all three
   * away. `.topology` is therefore assigned only on first mount and after a scan
   * completes, never on a summary push.
   */
  _mountMap() {
    const stage = this.shadowRoot && this.shadowRoot.getElementById('mapstage');
    if (!stage) return;
    let el = this._map.el;
    if (!el) {
      // Never create it before its module has defined it: properties assigned to a
      // not-yet-upgraded element become own properties that shadow the class's own
      // setters, and the map would then silently ignore hass, topology and scan.
      if (!this._has('z2m-network-map')) return;
      el = document.createElement('z2m-network-map');
      this._map.el = el;
      el.hass = this._hass;
      el.diagnostics = true;
      el.reveal = this._map.first;
      this._map.first = false;
      if (this._map.topology) el.topology = this._map.topology;
    }
    stage.appendChild(el);
    this._syncScan();
  }

  /**
   * One property carries the whole status line the map draws for itself. `generated`
   * is handed over as an epoch rather than as text so the element can age it without
   * being told, and the ticker re-pushes it while this view is open so the age stays
   * honest even if the element keeps no clock of its own.
   */
  _syncScan() {
    const el = this._map.el;
    if (!el) return;
    const s = this._map.scan;
    el.scan = {
      generated:
        s.generated ||
        (this._map.topology && this._map.topology.generated) ||
        (this._summary || {}).map_generated ||
        null,
      scanning: !!s.scanning,
      phase: s.phase,
      done: s.done,
      total: s.total,
    };
  }

  /**
   * A subscription, not a request: the events arrive on this connection while the
   * walk runs. `_sub` replaces whatever was streaming, so Re-scan supersedes a scan
   * in flight rather than queuing behind it.
   */
  _startScan() {
    const hadError = !!this._map.error;
    this._map.error = null;
    this._map.scan = {
      generated: this._map.scan.generated,
      scanning: true,
      phase: null,
      done: 0,
      total: 0,
    };
    this._syncScan();
    this._sub('scan', { type: 'z2m/networkmap/scan' }, (ev) => this._onScanEvent(ev));
    const pending = this._subs.scan;
    Promise.resolve(pending).catch((err) => {
      // A scan that cannot even be started is reported in the same shape as one that
      // fails mid-walk, so there is a single path for it.
      if (this._subs.scan !== pending) return;
      this._onScanEvent({
        phase: 'error',
        error: (err && (err.message || err.code)) || 'The scan could not be started',
      });
    });
    if (hadError) this._render();
  }

  /**
   * One event per device, in the order the replies land. The element owns the
   * animation; this owns the bookkeeping, the final cache, and the one thing that
   * belongs outside the canvas -- a scan that failed outright.
   */
  _onScanEvent(ev) {
    if (!ev) return;
    const s = this._map.scan;
    s.phase = ev.phase || null;
    if (ev.phase === 'start') {
      s.scanning = true;
      s.done = 0;
      s.total = Number(ev.total) || 0;
    } else if (ev.phase === 'device') {
      s.done += 1;
      // A device the start event did not announce still counts: the denominator must
      // never end up smaller than the numerator on screen.
      if (s.total < s.done) s.total = s.done;
    } else if (ev.phase === 'done') {
      s.scanning = false;
      s.generated = ev.generated || null;
      s.total = s.total || s.done;
      s.done = s.total;
      this._map.topology = {
        generated: ev.generated,
        coordinator: ev.coordinator,
        nodes: ev.nodes || [],
        links: ev.links || [],
      };
      this._unsub('scan');
    } else if (ev.phase === 'error') {
      s.scanning = false;
      this._map.error = ev.error || 'The scan failed';
      this._unsub('scan');
    }

    this._syncScan();
    const el = this._map.el;
    if (el && typeof el.applyScanEvent === 'function') el.applyScanEvent(ev);
    // A map that cannot take the stream still gets the finished graph. Assigning
    // `.topology` on top of a streamed build would discard the graph it just built.
    else if (el && ev.phase === 'done') el.topology = this._map.topology;

    // The alert renders above the map without replacing it: _enter re-hosts the very
    // same element after the render.
    if (ev.phase === 'error') this._render();
  }

  /**
   * The lifecycle channel, which reports scans started anywhere -- another browser
   * tab, an automation. Our own stream reports the same lifecycle in far more
   * detail, so while it is running this channel is ignored: re-reading the cache
   * underneath a live stream would throw away the graph it is building.
   */
  _onMapPhase(ev) {
    if (!ev || this._subs.scan) return;
    const s = this._map.scan;
    s.scanning = ev.phase === 'scanning';
    s.phase = ev.phase || null;
    if (ev.error) this._map.error = ev.error;
    if (ev.phase === 'done') {
      // Somebody else's scan finished: pick up the cache it just wrote.
      this._call('z2m/networkmap')
        .then((t) => {
          this._map.topology = t;
          s.generated = (t && t.generated) || null;
          if (this._map.el) this._map.el.topology = t;
          this._syncScan();
        })
        .catch(() => {});
    }
    this._syncScan();
  }

  /* ----------------------------------------------------------------- backup */

  /**
   * Z2M answers bridge/request/backup with a base64 ZIP in `zip`, and the backend
   * hands that response straight through. No archive means the request failed, and
   * the operator needs to be told rather than reassured.
   *
   * The hand-off to the browser follows Home Assistant's own `fileDownload` helper,
   * including its Safari carve-out: Safari aborts a download whose blob URL is
   * revoked in the same turn, and this household drives the panel from iPads.
   */
  async _downloadBackup() {
    const res = await this._call('z2m/backup');
    const b64 = res && res.zip;
    if (!b64) throw new Error('Zigbee2MQTT returned no backup archive');
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/zip' }));
    const a = document.createElement('a');
    a.target = '_blank';
    a.href = url;
    a.download = `zigbee2mqtt-backup-${new Date().toISOString().slice(0, 10)}.zip`;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.dispatchEvent(new MouseEvent('click'));
    document.body.removeChild(a);
    const ua = (typeof navigator !== 'undefined' && navigator.userAgent) || '';
    if (/^((?!chrome|android).)*safari/i.test(ua)) setTimeout(() => URL.revokeObjectURL(url), 10000);
    else URL.revokeObjectURL(url);
  }

  /* ----------------------------------------------------------------- events */

  _change(name, el) {
    if (name === 'logmin') {
      this._logMin = el.value;
      this._paintLogs();
      return;
    }
    if (name === 'loglevel') this._act('z2m/log_level', { value: el.value });
  }

  /**
   * One group write. The command is awaited because Zigbee2MQTT can refuse it --
   * duplicate name, unknown endpoint, a member that did not answer -- and the
   * operator needs to see that. The resulting membership is NOT taken from the
   * response: Z2M republishes bridge/groups after the radio work, and
   * z2m/groups/subscribe delivers that, which is the authoritative version.
   */
  async _groupWrite(type, payload, after) {
    if (this._busy) return;
    this._busy = true;
    this._groupError = null;
    this._groupNotice = null;
    this._render();
    try {
      const res = await this._call(type, payload);
      if (after) after(res);
      else this._render();
    } catch (err) {
      this._groupError = this._feedMessage(err, 'Zigbee2MQTT refused the change');
      this._render();
    } finally {
      this._busy = false;
    }
  }

  /** Navigate with Home Assistant's own router rather than a bare link. */
  _openHaDevice(deviceId) {
    history.pushState(null, '', `/config/devices/device/${deviceId}`);
    window.dispatchEvent(new CustomEvent('location-changed', { detail: { replace: false } }));
  }

  async _dispatch(act, el) {
    const r = this.shadowRoot;
    const d = this._view.name === 'device' ? this._dev(this._view.ieee) : null;
    // `id` is reserved by Home Assistant's websocket envelope, so every
    // device-targeted command carries `device` and the backend maps it onto Z2M's own
    // `id` field. Putting it in `id` here silently loses the device.
    const device = d && d.ieee_address;

    switch (act) {
      case 'refresh':
        return this._refresh();

      // Only reachable from the fallback chrome; hass-subpage owns its own back arrow.
      case 'back':
        return this._back();

      case 'map':
        return this._go({ name: 'map' });

      case 'pair':
        return this._go({ name: 'pairing' });

      // Stop is the honest word: it closes the window this helper opened and goes
      // back, rather than pretending to cancel a join already in flight.
      case 'pairstop':
        return this._back();

      case 'pairretry':
        return this._openJoinWindow();

      case 'pairagain': {
        // A second device in the same visit: new session, new window.
        this._leavePairing();
        return this._openPairing();
      }

      case 'pairsave':
        return this._savePairSetup();

      case 'pairopen': {
        const paired = this._pairDevice();
        if (paired && paired.device_id) this._openHaDevice(paired.device_id);
        return undefined;
      }

      case 'groupadd': {
        const input = r.getElementById('gname');
        const name = input && String(input.value || '').trim();
        if (!name) return undefined;
        return this._groupWrite('z2m/group/add', { name }, (res) => {
          if (input) input.value = '';
          if (res && res.id !== undefined) this._go({ name: 'group', group: res.id });
        });
      }

      case 'grouprename': {
        const input = r.getElementById('grn');
        const to = input && String(input.value || '').trim();
        const group = this._view.group;
        const current = this._group(group);
        if (!to || !current || to === current.friendly_name) return undefined;
        return this._groupWrite('z2m/group/rename', { group, to });
      }

      case 'groupremove':
      case 'groupforce': {
        const group = this._view.group;
        const force = act === 'groupforce';
        const current = this._group(group);
        if (!current) return undefined;
        if (
          !confirm(
            force
              ? `Force delete ${current.friendly_name}?\n\nThe members are NOT told to leave, so they stay programmed with this group address. Use this only when a member cannot be reached.`
              : `Delete ${current.friendly_name}?`
          )
        )
          return undefined;
        return this._groupWrite('z2m/group/remove', { group, force }, () =>
          this._go({ name: 'groups' })
        );
      }

      case 'memberadd': {
        const select = r.getElementById('gmember');
        const value = select && select.value;
        if (!value) return undefined;
        const [ieee, endpoint] = value.split('|');
        return this._groupWrite('z2m/group/members/add', {
          group: this._view.group,
          device: ieee,
          endpoint: endpoint === 'default' ? 'default' : Number(endpoint),
        });
      }

      case 'memberremove': {
        const ieee = el && el.dataset && el.dataset.device;
        const endpoint = el && el.dataset && el.dataset.endpoint;
        if (!ieee || endpoint === undefined) return undefined;
        return this._groupWrite('z2m/group/members/remove', {
          group: this._view.group,
          device: ieee,
          endpoint: endpoint === 'default' ? 'default' : Number(endpoint),
        });
      }

      case 'restart':
        if (!confirm('Restart Zigbee2MQTT? All Zigbee devices are briefly unavailable.')) return;
        return this._act('z2m/restart');

      case 'backup':
        try {
          await this._downloadBackup();
        } catch (err) {
          this._error = (err && (err.message || err.code)) || 'Backup failed';
          this._render();
        }
        return;

      case 'health':
        try {
          this._diag.health = await this._call('z2m/health_check');
          this._diag.error = null;
        } catch (err) {
          this._diag.error = (err && (err.message || err.code)) || 'Health check failed';
        }
        return this._render();

      case 'coordcheck':
        this._diag.routers = null;
        return this._runCoordinatorCheck();

      case 'logbottom': {
        this._logPinned = true;
        const chip = r && r.getElementById('logpaused');
        if (chip) chip.hidden = true;
        return this._paintLogs();
      }

      // Stagger deliberately. A burst of per-device queries is real load on the
      // coordinator, and Z2M serialises them per device with a 10s timeout each.
      case 'checkall': {
        const cap = this._devices.filter((x) => x.update_entity);
        if (
          !confirm(
            `Check firmware on ${cap.length} devices?\n\nSpread ~4s apart to stay gentle on the coordinator.`
          )
        )
          return;
        for (const dev of cap) {
          try {
            await this._call('z2m/ota/check', { device: dev.ieee_address });
          } catch (_) {
            /* one unreachable device must not stop the sweep */
          }
          await new Promise((done) => setTimeout(done, 4000));
        }
        return this._refresh();
      }

      case 'fwcheck':
        return this._act('z2m/ota/check', { device });

      case 'fwabort':
        if (!confirm('Abort the firmware update in progress?')) return;
        return this._act('z2m/ota/abort', { device });

      case 'fwinstall':
        if (
          !confirm(
            `Install firmware on ${d.friendly_name}?\n\nDo not cut power during an update. ` +
              'A mains device is unusable while it flashes.'
          )
        )
          return;
        return this._act('z2m/ota/update', { device });

      case 'fwsched':
        return this._act('z2m/ota/schedule', { device });

      case 'fwunsched':
        return this._act('z2m/ota/unschedule', { device });

      case 'configure':
        return this._act('z2m/device/configure', { device });

      case 'interview':
        return this._act('z2m/device/interview', { device });

      case 'remove': {
        if (!confirm(`Remove ${d.friendly_name} from the Zigbee network?`)) return;
        const force = confirm(
          'Device unreachable? OK = force removal (needs a factory reset before it can pair again).'
        );
        return this._act('z2m/device/remove', { device, force });
      }

      case 'rename': {
        const input = r.getElementById('rn');
        const to = input && String(input.value || '').trim();
        if (!to || to === d.friendly_name) return;
        return this._act('z2m/device/rename', { from: d.friendly_name, to });
      }

      case 'options': {
        const options = {};
        r.querySelectorAll('[data-prop]').forEach((input) => {
          const kind = input.dataset.kind;
          if (kind === 'binary') options[input.dataset.prop] = input.checked;
          else if (input.value !== '')
            options[input.dataset.prop] = kind === 'numeric' ? Number(input.value) : input.value;
        });
        if (!Object.keys(options).length) return;
        return this._act('z2m/device/options', { device, options });
      }

      default:
        return undefined;
    }
  }

  async _act(type, extra = {}) {
    if (this._busy) return;
    this._busy = true;
    try {
      await this._call(type, extra);
      // Z2M answers by republishing its retained topics; give it a beat.
      setTimeout(() => this._refresh(), 1200);
    } catch (err) {
      this._error = (err && (err.message || err.code)) || 'Request failed';
      this._render();
    } finally {
      this._busy = false;
    }
  }
}

customElements.define('z2m-panel', Z2MPanel);
