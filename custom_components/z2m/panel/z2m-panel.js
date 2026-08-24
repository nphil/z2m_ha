/**
 * Zigbee panel.
 *
 * Deliberately plain DOM: no Lit, no bundler, no CDN. Everything is styled with Home
 * Assistant's own CSS custom properties, so theming, dark mode, density and touch
 * target sizing are inherited rather than reimplemented -- which is what makes it
 * behave on phones and wall tablets as well as desktop.
 */

const ICONS = {
  devices: 'M3 5h8v6H3zm10 0h8v6h-8zM3 13h8v6H3zm10 0h8v6h-8z',
  add: 'M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6z',
  group: 'M12 5.5A3.5 3.5 0 1 1 8.5 9 3.5 3.5 0 0 1 12 5.5M5 8a2.5 2.5 0 1 1-2.5 2.5A2.5 2.5 0 0 1 5 8m14 0a2.5 2.5 0 1 1-2.5 2.5A2.5 2.5 0 0 1 19 8m-7 6c2.7 0 5 1.3 5 3v2H7v-2c0-1.7 2.3-3 5-3',
  ota: 'M12 2 4 6v6c0 5 3.4 9.7 8 10 4.6-.3 8-5 8-10V6zm0 5 4 4h-2.5v4h-3v-4H8z',
  log: 'M3 4h18v2H3zm0 5h18v2H3zm0 5h12v2H3zm0 5h12v2H3z',
  info: 'M11 9h2V7h-2m1 13a8 8 0 1 1 8-8 8 8 0 0 1-8 8m0-18a10 10 0 1 0 10 10A10 10 0 0 0 12 2m-1 15h2v-6h-2z',
  map: 'M15 19l-6-2V5l6 2zm2-.5 4 1.5V6l-4-1.5zM7 18.5 3 20V6l4-1.5z',
  restart: 'M12 4V1L8 5l4 4V6a6 6 0 1 1-6 6H4a8 8 0 1 0 8-8',
  backup: 'M14 3v5h5l-7 7-7-7h5V3zM5 18h14v2H5z',
  health: 'M12 21.35 10.55 20C5.4 15.36 2 12.28 2 8.5A5.5 5.5 0 0 1 12 5.09 5.5 5.5 0 0 1 22 8.5c0 3.78-3.4 6.86-8.55 11.54z',
  chevron: 'M8.6 16.6 13.2 12 8.6 7.4 10 6l6 6-6 6z',
  back: 'M20 11H7.8l5.6-5.6L12 4l-8 8 8 8 1.4-1.4L7.8 13H20z',
  refresh: 'M17.65 6.35A8 8 0 1 0 19.73 14h-2.08A6 6 0 1 1 12 6a5.9 5.9 0 0 1 4.22 1.78L13 11h7V4z',
  search: 'M9.5 3A6.5 6.5 0 0 1 16 9.5c0 1.61-.59 3.09-1.56 4.23l.27.27h.79l5 5-1.5 1.5-5-5v-.79l-.27-.27A6.5 6.5 0 1 1 9.5 3m0 2A4.5 4.5 0 1 0 14 9.5 4.5 4.5 0 0 0 9.5 5',
};

const svg = (path, size = 24) =>
  `<svg viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true"><path d="${path}"/></svg>`;

class Z2MPanel extends HTMLElement {
  constructor() {
    super();
    this._view = { name: 'dashboard' };
    this._summary = null;
    this._devices = [];
    this._groups = [];
    this._filter = '';
    this._busy = false;
    this._unsub = null;
    this._built = false;
  }

  /* ------------------------------------------------------------ HA plumbing */

  set hass(hass) {
    const first = !this._hass;
    this._hass = hass;
    if (first) this._boot();
    // HA re-sets `hass` on every state change; refresh only the firmware card so
    // live update progress appears without re-rendering the whole view.
    else this._syncFw();
  }
  set narrow(v) {
    this._narrow = v;
    if (this._built) this._render();
  }
  set route(_v) {}
  set panel(v) {
    this._panel = v;
  }

  connectedCallback() {
    if (!this.shadowRoot) this.attachShadow({ mode: 'open' });
    this._built = false;
  }
  disconnectedCallback() {
    if (this._unsub) {
      this._unsub.then((u) => u && u()).catch(() => {});
      this._unsub = null;
    }
  }

  async _boot() {
    if (!this.shadowRoot) this.attachShadow({ mode: 'open' });
    await this._refresh();
    // Push updates: the backend fires on every retained bridge topic change.
    this._unsub = this._hass.connection.subscribeMessage(
      (ev) => {
        if (ev && ev.summary) {
          this._summary = ev.summary;
          this._render();
        }
      },
      { type: 'z2m/subscribe' }
    );
  }

  async _call(type, extra = {}) {
    return this._hass.connection.sendMessagePromise({ type, ...extra });
  }

  async _refresh() {
    try {
      const [summary, devices, groups] = await Promise.all([
        this._call('z2m/info'),
        this._call('z2m/devices'),
        this._call('z2m/groups'),
      ]);
      this._summary = summary;
      this._devices = devices || [];
      this._groups = groups || [];
      this._error = null;
    } catch (err) {
      this._error = (err && (err.message || err.code)) || 'Unknown error';
    }
    this._render();
  }

  /* ----------------------------------------------------------------- styles */

  _styles() {
    return `
      :host { display:block; background:var(--primary-background-color); min-height:100%;
              color:var(--primary-text-color);
              font-family:var(--paper-font-body1_-_font-family, Roboto, sans-serif); }
      .bar { position:sticky; top:0; z-index:2; display:flex; align-items:center; gap:8px;
             height:56px; padding:0 8px; background:var(--app-header-background-color, var(--primary-color));
             color:var(--app-header-text-color, #fff); }
      .bar h1 { font-size:20px; font-weight:400; margin:0; flex:1; }
      .iconbtn { display:inline-flex; align-items:center; justify-content:center;
                 width:40px; height:40px; border:0; border-radius:50%; cursor:pointer;
                 background:transparent; color:inherit; }
      .iconbtn:hover { background:rgba(255,255,255,.12); }
      .iconbtn svg { fill:currentColor; }
      .wrap { max-width:800px; margin:0 auto; padding:16px 16px 48px; box-sizing:border-box; }
      ha-card, .card { display:block; background:var(--card-background-color,#fff);
              border-radius:var(--ha-card-border-radius,12px);
              box-shadow:var(--ha-card-box-shadow, 0 2px 4px rgba(0,0,0,.1));
              border:var(--ha-card-border-width,1px) solid var(--ha-card-border-color,transparent);
              margin-bottom:16px; overflow:hidden; }
      .row { display:flex; align-items:center; gap:16px; padding:14px 16px;
             min-height:48px; text-decoration:none; color:inherit; }
      .row + .row { border-top:1px solid var(--divider-color); }
      .row.tap { cursor:pointer; }
      .row.tap:hover { background:var(--secondary-background-color); }
      .row svg { fill:var(--state-icon-color, var(--secondary-text-color)); flex:0 0 auto; }
      .grow { flex:1; min-width:0; }
      .title { font-size:16px; }
      .sub { font-size:13px; color:var(--secondary-text-color); margin-top:2px; }
      .trail { color:var(--secondary-text-color); font-size:14px; white-space:nowrap; }
      .hdr { display:flex; align-items:center; gap:16px; padding:16px; }
      .hdr .big { font-size:20px; }
      .ok { color:var(--success-color,#0f9d58); }
      .bad { color:var(--error-color,#db4437); }
      .warn { color:var(--warning-color,#ffa600); }
      .sectionhdr { display:flex; align-items:center; justify-content:space-between;
                    padding:16px 16px 8px; }
      .sectionhdr h2 { margin:0; font-size:20px; font-weight:400; }
      button.pill { display:inline-flex; align-items:center; gap:8px; height:36px;
              padding:0 16px; border:0; border-radius:18px; cursor:pointer;
              background:var(--primary-color); color:var(--text-primary-color,#fff);
              font-size:14px; font-family:inherit; }
      button.pill.ghost { background:var(--secondary-background-color);
              color:var(--primary-color); }
      button.pill svg { fill:currentColor; }
      button.pill:disabled { opacity:.5; cursor:default; }
      .search { display:flex; align-items:center; gap:8px; padding:8px 16px;
                border-bottom:1px solid var(--divider-color); }
      .search input { flex:1; border:0; outline:none; background:transparent;
                font-size:16px; color:var(--primary-text-color); font-family:inherit;
                min-width:0; padding:8px 0; }
      .search svg { fill:var(--secondary-text-color); }
      .chip { display:inline-block; font-size:11px; line-height:18px; padding:0 8px;
              border-radius:9px; background:var(--secondary-background-color);
              color:var(--secondary-text-color); }
      .chip.off { background:var(--error-color,#db4437); color:#fff; }
      .chip.warn { background:var(--warning-color,#ffa600); color:#000; }
      .empty { padding:32px 16px; text-align:center; color:var(--secondary-text-color); }
      .field { display:flex; align-items:center; gap:12px; padding:12px 16px; }
      .field + .field { border-top:1px solid var(--divider-color); }
      .field label { flex:1; font-size:15px; }
      .field .hint { font-size:12px; color:var(--secondary-text-color); }
      .field input[type=text], .field input[type=number], .field select {
              font-size:15px; padding:8px; border-radius:6px; font-family:inherit;
              border:1px solid var(--divider-color);
              background:var(--card-background-color); color:var(--primary-text-color);
              max-width:50%; }
      .banner { padding:12px 16px; border-radius:8px; margin-bottom:16px;
                background:var(--error-color,#db4437); color:#fff; font-size:14px; }
      .kv { display:flex; padding:10px 16px; font-size:14px; gap:16px; }
      .kv + .kv { border-top:1px solid var(--divider-color); }
      .kv .k { color:var(--secondary-text-color); flex:0 0 45%; }
      .kv .v { flex:1; word-break:break-word; font-family:var(--code-font-family,monospace); }
      @media (max-width:600px) {
        .wrap { padding:8px 8px 40px; }
        .field { flex-wrap:wrap; }
        .field input[type=text], .field input[type=number], .field select { max-width:100%; width:100%; }
        .kv { flex-direction:column; gap:2px; }
        .kv .k { flex:none; }
      }
    `;
  }

  /* ----------------------------------------------------------------- render */

  _render() {
    if (!this.shadowRoot) return;
    const s = this._summary || {};
    let body;
    if (this._view.name === 'devices') body = this._devicesView();
    else if (this._view.name === 'device') body = this._deviceView(this._view.ieee);
    else if (this._view.name === 'network') body = this._networkView();
    else if (this._view.name === 'groups') body = this._groupsView();
    else if (this._view.name === 'ota') body = this._otaView();
    else body = this._dashboard();

    const title =
      this._view.name === 'dashboard'
        ? 'Zigbee'
        : this._view.name === 'device'
          ? (this._dev(this._view.ieee) || {}).friendly_name || 'Device'
          : this._view.name.charAt(0).toUpperCase() + this._view.name.slice(1);

    this.shadowRoot.innerHTML = `
      <style>${this._styles()}</style>
      <div class="bar">
        <button class="iconbtn" id="back" title="Back">${svg(ICONS.back)}</button>
        <h1>${esc(title)}</h1>
        <button class="iconbtn" id="reload" title="Refresh">${svg(ICONS.refresh)}</button>
      </div>
      <div class="wrap">
        ${this._error ? `<div class="banner">${esc(this._error)}</div>` : ''}
        ${s.restart_required ? `<div class="banner">Zigbee2MQTT needs a restart for pending changes to apply.</div>` : ''}
        ${body}
      </div>`;

    this.shadowRoot.getElementById('reload').onclick = () => this._refresh();
    this.shadowRoot.getElementById('back').onclick = () => {
      if (this._view.name === 'device') this._go({ name: 'devices' });
      else if (this._view.name === 'dashboard') history.back();
      else this._go({ name: 'dashboard' });
    };
    this._wire();
  }

  _go(view) {
    this._view = view;
    this._filter = '';
    this._render();
    this.shadowRoot.scrollTop = 0;
  }

  _dev(ieee) {
    return this._devices.find((d) => d.ieee_address === ieee);
  }

  /** Z2M reports when joining ends, not how long is left. */
  _joinLeft(s) {
    const end = Number(s.permit_join_end);
    if (!end) return 'Open';
    const left = Math.max(0, Math.round((end - Date.now()) / 1000));
    return left ? `${left}s` : 'Open';
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
    const iv = a.installed_version;
    const lv = a.latest_version;
    // Z2M publishes -1 for "never assessed" -- it has not asked the OTA index yet.
    const unset = (v) => v === null || v === undefined || String(v) === '-1';
    return {
      entity: eid,
      available: s.state === 'on',
      unavailable: s.state === 'unavailable',
      installed: iv,
      latest: lv,
      assessed: !(unset(iv) || unset(lv)),
      inProgress: !!a.in_progress,
      pct: a.update_percentage,
    };
  }

  _fwInner(d) {
    const battery = d.power_source && d.power_source !== 'Mains (single phase)';
    const f = this._fw(d);

    if (!f) {
      return `<div class="sectionhdr"><h2>Firmware</h2></div>
        <div class="row"><div class="grow sub">This device reports no OTA support,
        so Zigbee2MQTT exposes no update entity for it.</div></div>`;
    }

    let status, cls = '';
    if (f.inProgress) {
      status = `Updating${f.pct != null ? ` — ${f.pct}%` : ''}`;
    } else if (f.unavailable) {
      status = 'Device unreachable';
      cls = 'bad';
    } else if (!f.assessed) {
      status = 'Not assessed';
    } else if (f.available) {
      status = 'Update available';
      cls = 'warn';
    } else {
      status = 'Up to date';
      cls = 'ok';
    }

    const ver = (v) => (v === null || v === undefined || String(v) === '-1' ? '—' : esc(String(v)));

    return `
      <div class="sectionhdr"><h2>Firmware</h2>
        <span class="chip ${cls === 'bad' ? 'off' : ''}">${esc(status)}</span></div>
      <div class="kv"><div class="k">Installed</div><div class="v">${ver(f.installed)}</div></div>
      <div class="kv"><div class="k">Latest known</div><div class="v">${ver(f.latest)}</div></div>
      ${f.inProgress && f.pct != null ? `
        <div class="kv"><div class="k">Progress</div><div class="v">${f.pct}%</div></div>` : ''}
      ${!f.assessed ? `
        <div class="row"><div class="grow sub">Zigbee2MQTT has never asked the OTA index
        about this device. Check to populate it.</div></div>` : ''}
      <div class="row">
        <div class="grow sub">${battery
          ? 'Battery device: schedule the update and it applies when the device next wakes.'
          : 'Checking only contacts the firmware index; it never installs.'}</div>
        ${f.inProgress
          ? `<button class="pill ghost" id="fwabort">Abort</button>`
          : `<button class="pill ghost" id="fwcheck">Check</button>
             ${f.available && !battery ? `<button class="pill" id="fwinstall">Install</button>` : ''}
             ${f.available && battery ? `<button class="pill" id="fwsched">Schedule</button>` : ''}`}
      </div>`;
  }

  _wireFw(d) {
    const r = this.shadowRoot;
    const on = (id, fn) => { const el = r.getElementById(id); if (el) el.onclick = fn; };
    const device = d.ieee_address;
    on('fwcheck', () => this._act('z2m/ota/check', { device }));
    on('fwabort', () => {
      if (confirm('Abort the firmware update in progress?')) this._act('z2m/ota/abort', { device });
    });
    on('fwinstall', () => {
      if (!confirm(`Install firmware on ${d.friendly_name}?\n\n`
        + 'Do not cut power during an update. A mains device is unusable while it flashes.'))
        return;
      this._act('z2m/ota/update', { device });
    });
    on('fwsched', () => this._act('z2m/ota/schedule', { device }));
  }

  /** Patch only the firmware card, so a state push cannot clobber typing elsewhere. */
  _syncFw() {
    const r = this.shadowRoot;
    if (!r) return;
    if (this._view.name === 'ota') { this._render(); return; }
    const box = r.getElementById('fwbox');
    if (!box || this._view.name !== 'device') return;
    const d = this._dev(this._view.ieee);
    if (!d) return;
    const html = this._fwInner(d);
    if (html === this._lastFw) return;
    this._lastFw = html;
    box.innerHTML = html;
    this._wireFw(d);
  }

  /* ------------------------------------------------------------- ota view */

  _otaView() {
    const rows = this._devices
      .filter((d) => d.update_entity)
      .map((d) => {
        const f = this._fw(d) || {};
        let tag = '<span class="chip">not assessed</span>';
        if (f.inProgress) tag = `<span class="chip warn">${f.pct ?? 0}%</span>`;
        else if (f.unavailable) tag = '<span class="chip off">offline</span>';
        else if (f.available) tag = '<span class="chip warn">update</span>';
        else if (f.assessed) tag = '<span class="chip">up to date</span>';
        return `<div class="row tap" data-ieee="${esc(d.ieee_address)}">
          ${svg(ICONS.ota, 20)}
          <div class="grow">
            <div class="title">${esc(d.friendly_name)}</div>
            <div class="sub">${esc([d.vendor, d.model].filter(Boolean).join(' · '))}</div>
          </div>${tag}${svg(ICONS.chevron, 20)}</div>`;
      })
      .join('');

    const n = this._devices.filter((d) => d.update_entity).length;
    return `
      <div class="card">
        <div class="row">
          <div class="grow"><div class="title">Check all ${n} devices</div>
          <div class="sub">Staggered a few seconds apart on purpose: a burst of queries
          is heavy on the coordinator.</div></div>
          <button class="pill ghost" id="checkall">Check all</button>
        </div>
      </div>
      <div class="card">${rows || '<div class="empty">No OTA-capable devices.</div>'}</div>`;
  }

  /* -------------------------------------------------------------- dashboard */

  _dashboard() {
    const s = this._summary || {};
    const online = s.state === 'online';
    const offline = s.offline_count || 0;
    const hasMap = true; // Zigbee Map panel, linked rather than reimplemented.
    return `
      <div class="card">
        <div class="hdr">
          <span class="${online ? 'ok' : 'bad'}">${svg(ICONS.health, 28)}</span>
          <div class="grow">
            <div class="big">${online ? 'Online' : 'Offline'}</div>
            <div class="sub">${s.device_count || 0} devices${offline ? ` (${offline} offline)` : ''}</div>
          </div>
          <span class="chip">Z2M ${esc((s.version || '?').toString())}</span>
        </div>
      </div>

      <div class="card">
        <div class="sectionhdr">
          <h2>My network</h2>
          ${hasMap ? `<button class="pill ghost" id="showmap">${svg(ICONS.map, 18)} Show map</button>` : ''}
        </div>
        <div class="row tap" data-go="devices">
          ${svg(ICONS.devices)}<div class="grow"><div class="title">${s.device_count || 0} devices</div></div>
          <span class="trail">${offline ? `${offline} offline` : ''}</span>${svg(ICONS.chevron, 20)}
        </div>
        <div class="row tap" data-go="groups">
          ${svg(ICONS.group)}<div class="grow"><div class="title">${s.group_count || 0} groups</div></div>
          ${svg(ICONS.chevron, 20)}
        </div>
      </div>

      <div class="card">
        <div class="row tap" id="permit">
          ${svg(ICONS.add)}
          <div class="grow"><div class="title">Add device</div>
            <div class="sub">${s.permit_join ? 'Joining is OPEN — tap to close' : 'Open the network for pairing'}</div></div>
          <span class="trail">${s.permit_join ? this._joinLeft(s) : 'Off'}</span>${svg(ICONS.chevron, 20)}
        </div>
        <div class="row tap" data-go="ota">
          ${svg(ICONS.ota)}
          <div class="grow"><div class="title">Firmware</div>
            <div class="sub">${(() => {
              const cap = this._devices.filter((x) => x.update_entity);
              const avail = cap.filter((x) => (this._fw(x) || {}).available).length;
              const unass = cap.filter((x) => !(this._fw(x) || {}).assessed).length;
              if (avail) return `${avail} update${avail > 1 ? 's' : ''} available`;
              if (unass) return `${unass} of ${cap.length} not assessed yet`;
              return `${cap.length} devices, all up to date`;
            })()}</div></div>
          ${svg(ICONS.chevron, 20)}
        </div>
        <div class="row tap" data-go="network">
          ${svg(ICONS.info)}
          <div class="grow"><div class="title">Network information</div>
            <div class="sub">Coordinator, channel, PAN ID and Z2M version</div></div>
          ${svg(ICONS.chevron, 20)}
        </div>
        <a class="row tap" href="/zigbee-log">
          ${svg(ICONS.log)}
          <div class="grow"><div class="title">Logs</div>
            <div class="sub">Live Zigbee traffic and Z2M log</div></div>
          ${svg(ICONS.chevron, 20)}
        </a>
        <div class="row tap" id="health">
          ${svg(ICONS.health)}
          <div class="grow"><div class="title">Health check</div>
            <div class="sub">Ask Z2M to re-check every device</div></div>
          ${svg(ICONS.chevron, 20)}
        </div>
      </div>

      <div class="card">
        <div class="row">
          ${svg(ICONS.backup)}
          <div class="grow"><div class="title">Coordinator backup</div>
            <div class="sub">Writes a fresh backup inside Zigbee2MQTT</div></div>
          <button class="pill ghost" id="backup">Create</button>
        </div>
        <div class="row">
          ${svg(ICONS.restart)}
          <div class="grow"><div class="title">Restart Zigbee2MQTT</div>
            <div class="sub">Brief loss of all Zigbee devices</div></div>
          <button class="pill ghost" id="restart">Restart</button>
        </div>
      </div>`;
  }

  /* ---------------------------------------------------------------- devices */

  _devicesView() {
    const f = this._filter.toLowerCase();
    const list = this._devices.filter(
      (d) =>
        !f ||
        (d.friendly_name || '').toLowerCase().includes(f) ||
        (d.model || '').toLowerCase().includes(f) ||
        (d.vendor || '').toLowerCase().includes(f)
    );
    const rows =
      list
        .map((d) => {
          const off = d.availability === 'offline';
          const batt = d.power_source && d.power_source !== 'Mains (single phase)';
          return `<div class="row tap" data-ieee="${esc(d.ieee_address)}">
            ${svg(ICONS.devices, 20)}
            <div class="grow">
              <div class="title">${esc(d.friendly_name || d.ieee_address)}</div>
              <div class="sub">${esc([d.vendor, d.model].filter(Boolean).join(' · ') || 'Unknown model')}</div>
            </div>
            ${off ? '<span class="chip off">offline</span>' : ''}
            ${batt ? '<span class="chip">battery</span>' : ''}
            ${svg(ICONS.chevron, 20)}
          </div>`;
        })
        .join('') || `<div class="empty">No devices match “${esc(this._filter)}”.</div>`;
    return `<div class="card">
        <div class="search">${svg(ICONS.search, 20)}
          <input id="q" type="text" placeholder="Search ${this._devices.length} devices" value="${esc(this._filter)}">
        </div>${rows}</div>`;
  }

  /* ----------------------------------------------------------- device detail */

  _deviceView(ieee) {
    const d = this._dev(ieee);
    if (!d) return `<div class="empty">Device not found.</div>`;
    const kv = (k, v) =>
      v === undefined || v === null || v === '' ? '' : `<div class="kv"><div class="k">${esc(k)}</div><div class="v">${esc(String(v))}</div></div>`;

    // Z2M ships an `options` schema per device; generate the form from it rather
    // than hard-coding a form per model.
    const opts = (d.options || [])
      .filter((o) => ['numeric', 'binary', 'enum', 'text'].includes(o.type))
      .map((o) => this._optionField(o))
      .join('');

    return `
      <div class="card">
        ${kv('Friendly name', d.friendly_name)}
        ${kv('IEEE address', d.ieee_address)}
        ${kv('Network address', d.network_address)}
        ${kv('Vendor', d.vendor)}
        ${kv('Model', d.model)}
        ${kv('Description', d.description)}
        ${kv('Type', d.type)}
        ${kv('Power source', d.power_source)}
        ${kv('Availability', d.availability || 'unknown')}
        ${kv('Firmware build', d.software_build_id)}
        ${kv('Firmware date', d.date_code)}
        ${kv('Supported by Z2M', d.supported === false ? 'NO - custom converter needed' : 'yes')}
      </div>

      <div class="card">
        <div class="sectionhdr"><h2>Rename</h2></div>
        <div class="field">
          <label for="rn">Friendly name</label>
          <input id="rn" type="text" value="${esc(d.friendly_name || '')}">
        </div>
        <div class="row"><div class="grow sub">Changes the MQTT topic, so Home Assistant entity IDs regenerate.</div>
          <button class="pill" id="dorename">Rename</button></div>
      </div>

      ${opts ? `<div class="card"><div class="sectionhdr"><h2>Device settings</h2></div>${opts}
        <div class="row"><div class="grow sub">Written straight to Zigbee2MQTT.</div>
        <button class="pill" id="dooptions">Save settings</button></div></div>` : ''}

      <div class="card"><div id="fwbox">${this._fwInner(d)}</div></div>

      <div class="card">
        <div class="sectionhdr"><h2>Maintenance</h2></div>
        <div class="row"><div class="grow"><div class="title">Reconfigure</div>
          <div class="sub">Re-apply reporting and bindings</div></div>
          <button class="pill ghost" id="doconfigure">Reconfigure</button></div>
        <div class="row"><div class="grow"><div class="title">Re-interview</div>
          <div class="sub">Rebuild what Z2M knows about this device</div></div>
          <button class="pill ghost" id="dointerview">Interview</button></div>
      </div>

      <div class="card">
        <div class="row"><div class="grow"><div class="title bad">Remove from network</div>
          <div class="sub">Force removal does not tell the device to leave, so it will need a factory reset before it can pair again.</div></div>
          <button class="pill ghost" id="doremove">Remove</button></div>
      </div>`;
  }

  _optionField(o) {
    const id = `opt_${o.property}`;
    const label = esc(o.label || o.name || o.property);
    const hint = o.description ? `<div class="hint">${esc(o.description)}</div>` : '';
    if (o.type === 'binary') {
      return `<div class="field"><label for="${id}">${label}${hint}</label>
        <input id="${id}" data-prop="${esc(o.property)}" data-kind="binary" type="checkbox"></div>`;
    }
    if (o.type === 'enum') {
      const values = (o.values || []).map((v) => `<option value="${esc(String(v))}">${esc(String(v))}</option>`).join('');
      return `<div class="field"><label for="${id}">${label}${hint}</label>
        <select id="${id}" data-prop="${esc(o.property)}" data-kind="enum"><option value=""></option>${values}</select></div>`;
    }
    if (o.type === 'numeric') {
      const rng = [o.value_min, o.value_max].every((x) => x !== undefined) ? ` (${o.value_min}–${o.value_max})` : '';
      return `<div class="field"><label for="${id}">${label}${rng}${hint}</label>
        <input id="${id}" data-prop="${esc(o.property)}" data-kind="numeric" type="number"
          ${o.value_min !== undefined ? `min="${o.value_min}"` : ''}
          ${o.value_max !== undefined ? `max="${o.value_max}"` : ''}
          ${o.value_step !== undefined ? `step="${o.value_step}"` : ''}></div>`;
    }
    return `<div class="field"><label for="${id}">${label}${hint}</label>
      <input id="${id}" data-prop="${esc(o.property)}" data-kind="text" type="text"></div>`;
  }

  /* ---------------------------------------------------------------- network */

  _networkView() {
    const s = this._summary || {};
    const c = s.coordinator || {};
    const n = s.network || {};
    const kv = (k, v) =>
      v === undefined || v === null || v === '' ? '' : `<div class="kv"><div class="k">${esc(k)}</div><div class="v">${esc(String(v))}</div></div>`;
    return `<div class="card">
        ${kv('Zigbee2MQTT version', s.version)}
        ${kv('Coordinator type', c.type)}
        ${kv('Coordinator firmware', (c.meta && (c.meta.revision || c.meta.version)) || '')}
        ${kv('Serial / adapter', s.serial)}
        ${kv('Channel', n.channel)}
        ${kv('PAN ID', n.pan_id)}
        ${kv('Extended PAN ID', Array.isArray(n.extended_pan_id) ? n.extended_pan_id.join(':') : n.extended_pan_id)}
        ${kv('MQTT base topic', s.base_topic)}
        ${kv('Log level', s.log_level)}
      </div>
      <div class="card"><div class="row"><div class="grow sub">
        The network key is deliberately not shown here.</div></div></div>`;
  }

  _groupsView() {
    const rows =
      (this._groups || [])
        .map(
          (g) => `<div class="row"><div class="grow">
            <div class="title">${esc(g.friendly_name || String(g.id))}</div>
            <div class="sub">ID ${esc(String(g.id))} · ${(g.members || []).length} members</div>
          </div></div>`
        )
        .join('') || `<div class="empty">No Zigbee groups.</div>`;
    return `<div class="card">${rows}</div>`;
  }

  /* ------------------------------------------------------------------ events */

  _wire() {
    const r = this.shadowRoot;
    r.querySelectorAll('[data-go]').forEach((el) => {
      el.onclick = () => this._go({ name: el.dataset.go });
    });
    r.querySelectorAll('[data-ieee]').forEach((el) => {
      el.onclick = () => this._go({ name: 'device', ieee: el.dataset.ieee });
    });
    const q = r.getElementById('q');
    if (q)
      q.oninput = () => {
        this._filter = q.value;
        const pos = q.selectionStart;
        this._render();
        const nq = this.shadowRoot.getElementById('q');
        if (nq) { nq.focus(); nq.setSelectionRange(pos, pos); }
      };

    const map = r.getElementById('showmap');
    if (map) map.onclick = () => { window.location.href = '/zigbee-map'; };

    const on = (id, fn) => { const el = r.getElementById(id); if (el) el.onclick = fn; };

    on('permit', async () => {
      const s = this._summary || {};
      // Time is the only field Z2M reads; 0 closes the network.
      await this._act('z2m/permit_join', { time: s.permit_join ? 0 : 254 });
    });
    on('health', () => this._act('z2m/health_check'));

    // Stagger deliberately. A burst of per-device queries is real load on the
    // coordinator, and Z2M serialises them per device with a 10s timeout each.
    on('checkall', async () => {
      const cap = this._devices.filter((x) => x.update_entity);
      if (!confirm(`Check firmware on ${cap.length} devices?\n\n`
        + 'Spread ~4s apart to stay gentle on the coordinator.')) return;
      for (const d of cap) {
        try { await this._call('z2m/ota/check', { device: d.ieee_address }); } catch (e) { /* keep going */ }
        await new Promise((r) => setTimeout(r, 4000));
      }
      this._refresh();
    });
    on('backup', () => this._act('z2m/backup'));
    on('restart', () => {
      if (confirm('Restart Zigbee2MQTT? All Zigbee devices are briefly unavailable.'))
        this._act('z2m/restart');
    });

    const d = this._view.name === 'device' ? this._dev(this._view.ieee) : null;
    if (d) {
      on('dorename', async () => {
        const to = r.getElementById('rn').value.trim();
        if (!to || to === d.friendly_name) return;
        await this._act('z2m/device/rename', { from: d.friendly_name, to });
      });
      on('doconfigure', () => this._act('z2m/device/configure', { device: d.ieee_address }));
      on('dointerview', () => this._act('z2m/device/interview', { device: d.ieee_address }));
      this._wireFw(d);
      this._lastFw = this._fwInner(d);
      on('doremove', () => {
        if (!confirm(`Remove ${d.friendly_name} from the Zigbee network?`)) return;
        const force = confirm('Device unreachable? OK = force removal (needs a factory reset before it can pair again).');
        this._act('z2m/device/remove', { device: d.ieee_address, force });
      });
      on('dooptions', async () => {
        const options = {};
        r.querySelectorAll('[data-prop]').forEach((el) => {
          const kind = el.dataset.kind;
          if (kind === 'binary') options[el.dataset.prop] = el.checked;
          else if (el.value !== '') {
            options[el.dataset.prop] = kind === 'numeric' ? Number(el.value) : el.value;
          }
        });
        if (!Object.keys(options).length) return;
        await this._act('z2m/device/options', { device: d.ieee_address, options });
      });
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

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );
}

customElements.define('z2m-panel', Z2MPanel);
