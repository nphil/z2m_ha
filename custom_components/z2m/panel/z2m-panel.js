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
  link: 'M10.59,13.41C11,13.8 11,14.44 10.59,14.83C10.2,15.22 9.56,15.22 9.17,14.83C7.22,12.88 7.22,9.71 9.17,7.76V7.76L12.71,4.22C14.66,2.27 17.83,2.27 19.78,4.22C21.73,6.17 21.73,9.34 19.78,11.29L18.29,12.78C18.3,11.96 18.17,11.14 17.89,10.36L18.36,9.88C19.54,8.71 19.54,6.81 18.36,5.64C17.19,4.46 15.29,4.46 14.12,5.64L10.59,9.17C9.41,10.34 9.41,12.24 10.59,13.41M13.41,9.17C13.8,8.78 14.44,8.78 14.83,9.17C16.78,11.12 16.78,14.29 14.83,16.24V16.24L11.29,19.78C9.34,21.73 6.17,21.73 4.22,19.78C2.27,17.83 2.27,14.66 4.22,12.71L5.71,11.22C5.7,12.04 5.83,12.86 6.11,13.65L5.64,14.12C4.46,15.29 4.46,17.19 5.64,18.36C6.81,19.54 8.71,19.54 9.88,18.36L13.41,14.83C14.59,13.66 14.59,11.76 13.41,10.59C13,10.2 13,9.56 13.41,9.17Z',
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
  'ha-dialog',
  // Form furniture. Every control the operator types into is one of HA's own, because
  // a hand-rolled input hosted in HA's row component is exactly what broke on a phone:
  // the trailing slot took the whole row and the label collapsed to nothing.
  'ha-form',
  'ha-settings-row',
  'ha-select',
  'ha-list-item',
  'ha-textfield',
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

/** Zigbee2MQTT publishes -1 for "never asked the OTA index". That is not a version. */
const fwVersion = (v) =>
  v === null || v === undefined || String(v) === '-1' ? '\u2014' : esc(String(v));

/**
 * Plain English for the Zigbee cluster names, which are the vocabulary of binding and
 * reporting and are otherwise unreadable.
 *
 * The identifier is always shown as well: it is what Zigbee2MQTT, the device's own
 * documentation and every forum post use, so hiding it would make the screen harder
 * to act on, not easier.
 */
const CLUSTER_NAMES = {
  genOnOff: 'On/off',
  genLevelCtrl: 'Brightness',
  genScenes: 'Scenes',
  genGroups: 'Groups',
  genIdentify: 'Identify',
  genPowerCfg: 'Battery and power',
  genBasic: 'Device information',
  genOta: 'Firmware updates',
  lightingColorCtrl: 'Colour',
  closuresWindowCovering: 'Covers',
  closuresDoorLock: 'Locks',
  hvacThermostat: 'Thermostat',
  hvacFanCtrl: 'Fan',
  msIlluminanceMeasurement: 'Light level',
  msTemperatureMeasurement: 'Temperature',
  msRelativeHumidity: 'Humidity',
  msPressureMeasurement: 'Pressure',
  msOccupancySensing: 'Occupancy',
  msSoilMoisture: 'Soil moisture',
  msCO2: 'CO\u2082',
  ssIasZone: 'Alarms',
  seMetering: 'Energy metering',
  haElectricalMeasurement: 'Electrical measurement',
  touchlink: 'Touchlink',
};

/** A cluster as the operator should read it: what it does, and what it is called. */
const clusterLabel = (c) => {
  const friendly = CLUSTER_NAMES[c];
  return friendly ? `${friendly} (${c})` : c;
};

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
    this._resetBinds();

    this._diag = { health: null, routers: null, error: null, checked: false };
    this._ticker = null;
    this._counts = '';
  }

  /**
   * Live `ha-form` state, keyed by what the form is editing.
   *
   * The form owns the operator's edits between renders -- a retained push arriving
   * mid-typing must not reset a field -- so the spec, including its `data`, outlives
   * the markup that hosts it. Keys carry the subject (`opts:<ieee>`) so moving to
   * another device is a different form, not the same one with stale values.
   */
  _formSpec(key, make) {
    if (!this._forms) this._forms = {};
    if (!this._forms[key]) this._forms[key] = make();
    return this._forms[key];
  }

  /**
   * One text field, rendered by `ha-form`.
   *
   * `ha-textfield` is NOT registered in the frontend bundle this panel loads into --
   * measured on 2026.8.3, where `customElements.get('ha-textfield')` is undefined and
   * stays that way, so a page built on it renders an empty row. `ha-form` IS
   * registered, and it brings its own text field with HA's metrics and its own
   * narrow-screen behaviour, so a one-field form is the reliable native control.
   */
  _textField(key, o) {
    const spec = this._formSpec(key, () => ({
      schema: [{ name: 'value', selector: { text: {} } }],
      data: { value: o.value || '' },
      label: () => o.label,
      helper: () => o.helper,
    }));
    spec.label = () => o.label;
    spec.helper = () => o.helper;
    // A value that arrived from the bridge replaces what is on screen only while the
    // operator has not typed into it.
    if (!spec.touched && (o.value || '') !== spec.data.value) spec.data = { value: o.value || '' };
    return `<ha-form data-form="${esc(key)}"></ha-form>`;
  }

  /* ------------------------------------------------------------- bindings */
  //
  // A bind is what makes a remote control a light directly, radio to radio, without
  // the coordinator relaying anything. Zigbee2MQTT reports binds per SOURCE ENDPOINT,
  // so that is how they are shown: an endpoint is the thing that owns a bind.

  _resetBinds() {
    this._binds = {
      ieee: null,
      loading: false,
      error: null,
      notice: null,
      // Z2M's answer to a bind can be a partial success: some clusters bound, others
      // refused. `failed` is that list, and it has to stay on screen.
      failed: [],
      clusters: null,
      binds: null,
      busy: false,
    };
  }

  async _openBinds(ieee) {
    const b = this._binds;
    if (b.loading) return;
    b.ieee = ieee;
    b.loading = true;
    b.error = null;
    this._render();
    try {
      const [clusters, binds] = await Promise.all([
        this._call('z2m/device/clusters', { device: ieee }),
        this._call('z2m/device/binds', { device: ieee }),
      ]);
      if (this._binds.ieee !== ieee) return;
      b.clusters = clusters;
      b.binds = binds;
    } catch (err) {
      if (this._binds.ieee !== ieee) return;
      b.error = this._feedMessage(err, 'Could not read this device\u2019s bindings');
    } finally {
      if (this._binds.ieee === ieee) {
        b.loading = false;
        this._render();
      }
    }
  }

  /** Re-read after a write: Z2M is the authority on what is actually bound now. */
  async _reloadBinds() {
    const ieee = this._binds.ieee;
    if (!ieee) return;
    try {
      const [clusters, binds] = await Promise.all([
        this._call('z2m/device/clusters', { device: ieee }),
        this._call('z2m/device/binds', { device: ieee }),
      ]);
      if (this._binds.ieee !== ieee) return;
      this._binds.clusters = clusters;
      this._binds.binds = binds;
    } catch (_) {
      /* the write already reported its own outcome; a stale list is not a new error */
    }
    this._render();
  }

  /** Everything a bind can point at: the coordinator, a group, or another endpoint. */
  _bindTargets() {
    const self = this._binds.ieee;
    const out = [];
    (this._groups || []).forEach((g) => {
      out.push({ value: `g:${g.id}`, label: `${g.friendly_name || `Group ${g.id}`} (group)` });
    });
    this._devices.forEach((d) => {
      if (d.ieee_address === self) return;
      const eps = (d.endpoints || []).length ? d.endpoints : [1];
      const coordinator = d.type === 'Coordinator';
      eps.forEach((ep) => {
        const epId = typeof ep === 'object' ? ep.endpoint : ep;
        out.push({
          value: `d:${d.ieee_address}:${epId}`,
          label: `${d.friendly_name || d.ieee_address}${
            coordinator ? ' (coordinator)' : eps.length > 1 ? `, endpoint ${epId}` : ''
          }`,
        });
      });
    });
    return out;
  }

  _bindsView(ieee) {
    const b = this._binds;
    const d = this._dev(ieee) || {};
    if (b.error) {
      return `<ha-alert alert-type="error">${esc(b.error)}</ha-alert>` +
        card('<div class="note">Nothing was changed.</div>');
    }
    if (!b.clusters || !b.binds) {
      return card('<div class="note">Reading this device\u2019s endpoints\u2026</div>');
    }

    const endpoints = b.clusters.endpoints || [];
    const existing = b.binds.binds || [];

    // Grouped by source endpoint, because that is what owns the bind.
    const groupsHtml = endpoints
      .map((ep) => {
        const mine = existing.filter((x) => x.endpoint === ep.endpoint);
        if (!mine.length && !(ep.bindable || []).length) return '';
        const rows = mine.length
          ? list(
              mine
                .map((x) => {
                  const t = x.target || {};
                  const target =
                    t.type === 'group'
                      ? `${t.name || `Group ${t.id}`} (group)`
                      : `${t.name || t.ieee_address}${t.coordinator ? ' (coordinator)' : ''}${
                          t.endpoint && !t.coordinator ? `, endpoint ${t.endpoint}` : ''
                        }`;
                  return row({
                    icon: MDI.link,
                    headline: esc(clusterLabel(x.cluster)),
                    text: `to ${esc(target)}${t.name === null ? ' (target no longer known)' : ''}`,
                    end: `<ha-button slot="end" appearance="plain" size="s" data-act="unbind"
                            data-endpoint="${esc(String(ep.endpoint))}"
                            data-cluster="${esc(x.cluster)}"
                            data-target="${esc(
                              t.type === 'group' ? `g:${t.id}` : `d:${t.ieee_address}:${t.endpoint}`
                            )}">Remove</ha-button>`,
                  });
                })
                .join('')
            )
          : '<div class="note">Nothing bound from this endpoint.</div>';
        return `<div class="ota-group">Endpoint ${esc(String(ep.endpoint))}${
          ep.name && ep.name !== String(ep.endpoint) ? ` \u00b7 ${esc(ep.name)}` : ''
        }</div>${rows}`;
      })
      .join('');

    return (
      (b.notice ? `<ha-alert alert-type="success">${esc(b.notice)}</ha-alert>` : '') +
      (b.failed.length
        ? `<ha-alert alert-type="warning">Zigbee2MQTT reported the bind as done, but these
           clusters were refused: ${esc(b.failed.map(clusterLabel).join(', '))}. That usually
           means the device does not speak them, or it was asleep.</ha-alert>`
        : '') +
      `<ha-card class="nav-card">
         <div class="card-header">Bindings for ${esc(d.friendly_name || ieee)}</div>
         <div class="note">A bind sends this device\u2019s commands straight to another device
         or group, without Home Assistant or the coordinator in the path, so it keeps
         working when either is down, and it responds faster.</div>
         ${groupsHtml}
       </ha-card>` +
      this._bindCreateCard(endpoints)
    );
  }

  _bindCreateCard(endpoints) {
    const b = this._binds;
    const bindable = endpoints.filter((ep) => (ep.bindable || []).length);
    if (!bindable.length) {
      return card(
        `<div class="note">None of this device\u2019s endpoints expose a cluster that can be
         bound. Sensors that only report values are the usual case.</div>`
      );
    }

    const key = `bind:${b.ieee}`;
    const spec = this._formSpec(key, () => ({
      schema: [],
      data: { endpoint: String(bindable[0].endpoint), target: '', clusters: [] },
      label: (s) =>
        ({ endpoint: 'From endpoint', target: 'To', clusters: 'Clusters' })[s.name],
      helper: (s) =>
        ({
          endpoint: 'The endpoint on this device whose commands will be sent',
          target: 'The device, group or the coordinator that should receive them',
          clusters: 'Only what this endpoint can actually bind is offered',
        })[s.name],
    }));

    const chosen =
      bindable.find((ep) => String(ep.endpoint) === String(spec.data.endpoint)) || bindable[0];
    spec.schema = [
      {
        name: 'endpoint',
        selector: {
          select: {
            mode: 'dropdown',
            options: bindable.map((ep) => ({
              value: String(ep.endpoint),
              label: `Endpoint ${ep.endpoint}${
                ep.name && ep.name !== String(ep.endpoint) ? ` \u00b7 ${ep.name}` : ''
              }`,
            })),
          },
        },
      },
      {
        name: 'target',
        selector: { select: { mode: 'dropdown', options: this._bindTargets() } },
      },
      {
        name: 'clusters',
        selector: {
          select: {
            multiple: true,
            options: (chosen.bindable || []).map((c) => ({ value: c, label: clusterLabel(c) })),
          },
        },
      },
    ];

    return `<ha-card class="nav-card">
        <div class="card-header">Add a binding</div>
        <div class="card-content pad"><ha-form data-form="${esc(key)}"></ha-form></div>
        <div class="note">A sleeping battery device cannot be bound until it wakes, so a
        refusal here often just means "try again while pressing a button on it".</div>
        <div class="actions">
          <ha-button appearance="filled" size="s" data-act="bind"${
            b.busy ? ' disabled' : ''
          }>${b.busy ? 'Binding\u2026' : 'Bind'}</ha-button>
        </div>
      </ha-card>`;
  }

  /** One bind or unbind, with Z2M's partial-failure list kept. */
  async _bindWrite(type, payload) {
    const b = this._binds;
    if (b.busy) return;
    b.busy = true;
    b.error = null;
    b.notice = null;
    b.failed = [];
    this._render();
    try {
      const res = await this._call(type, payload);
      const failed = (res && res.failed) || [];
      const done = (res && res.clusters) || [];
      b.failed = failed;
      if (done.length) {
        b.notice = `${type === 'z2m/device/bind' ? 'Bound' : 'Unbound'} ${done
          .map(clusterLabel)
          .join(', ')}.`;
      } else if (!failed.length) {
        b.notice = 'Zigbee2MQTT reported no change.';
      }
    } catch (err) {
      b.error = this._feedMessage(err, 'Zigbee2MQTT refused the change');
    } finally {
      b.busy = false;
      await this._reloadBinds();
    }
  }

  /**
   * Turn a picker value back into Zigbee2MQTT's own addressing.
   *
   * A group target is the group id and takes no endpoint; a device target is an ieee
   * address plus the endpoint on that device that should receive the commands.
   */
  _bindTarget(value) {
    const [kind, a, b] = String(value || '').split(':');
    if (kind === 'g') return { to: Number(a) };
    return { to: a, to_endpoint: Number(b) };
  }

  /** What the operator typed into a one-field form, trimmed. */
  _textValue(key) {
    const spec = (this._forms || {})[key];
    return spec ? String(spec.data.value || '').trim() : '';
  }

  /** Home Assistant selectors for one Zigbee2MQTT option, from Z2M's own schema. */
  _optionSelector(o) {
    if (o.type === 'binary') return { boolean: {} };
    if (o.type === 'enum') {
      return {
        select: {
          mode: 'dropdown',
          options: (o.values || []).map((v) => ({ value: String(v), label: String(v) })),
        },
      };
    }
    if (o.type === 'numeric') {
      const number = { mode: 'box', step: o.value_step === undefined ? 'any' : o.value_step };
      if (o.value_min !== undefined) number.min = o.value_min;
      if (o.value_max !== undefined) number.max = o.value_max;
      if (o.unit) number.unit_of_measurement = o.unit;
      return { number };
    }
    return { text: {} };
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
      // The dialog is open, which means we are watching. The radio is a separate
      // question: `ownsPermit` is the only field that says the network is open.
      open: false,
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
      // Auto-scroll: on until the operator wants to read something.
      follow: true,
      // The log level itself is the backend's business: it is the only side that is
      // reliably told when this view goes away, including on a closed tab.
      error: null,
      notice: null,
      // How long to hold the window open, and which router to join through.
      // `via` is an ieee address, or null for "any router will do".
      duration: PAIR_OPEN_SECONDS,
      via: null,
      startedAt: null,
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
    this._syncLive();
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
      /* Row cards zero their padding because ha-md-list rows pad themselves. A card
       * whose content is a form or free text opts back in with .pad -- the missing
       * side padding here is exactly what made settings fields sit flush against the
       * card edge on a phone. */
      .nav-card .card-content.pad { padding:var(--ha-space-2, 8px) var(--ha-space-4, 16px)
                                    var(--ha-space-4, 16px); }
      .card-content.pad ha-form { display:block; }

      /* Extended FAB, drawn by hand because ha-fab is not in this bundle. */
      .fab { position:fixed; z-index:6;
             right:calc(var(--ha-space-4, 16px) + var(--safe-area-inset-right, 0px));
             bottom:calc(var(--ha-space-4, 16px) + var(--safe-area-inset-bottom, 0px));
             display:inline-flex; align-items:center; gap:var(--ha-space-2, 8px);
             height:56px; padding:0 var(--ha-space-5, 20px) 0 var(--ha-space-4, 16px);
             border:none; border-radius:var(--ha-border-radius-lg, 16px);
             background:var(--primary-color); color:var(--text-primary-color, #fff);
             font-family:inherit; font-size:var(--ha-font-size-m, 14px);
             font-weight:var(--ha-font-weight-medium, 500); letter-spacing:.1px;
             cursor:pointer;
             box-shadow:0 3px 5px -1px rgba(0,0,0,.2), 0 6px 10px 0 rgba(0,0,0,.14),
                        0 1px 18px 0 rgba(0,0,0,.12); }
      .fab:hover { box-shadow:0 5px 5px -3px rgba(0,0,0,.2), 0 8px 10px 1px rgba(0,0,0,.14),
                   0 3px 14px 2px rgba(0,0,0,.12); }
      .fab:focus-visible { outline:var(--ha-outline-width, 2px) solid var(--primary-color);
                           outline-offset:var(--ha-space-1, 4px); }
      .fab ha-svg-icon { width:var(--ha-icon-size-m, 24px); height:var(--ha-icon-size-m, 24px); }

      /* Device page: live things first, admin beside them once there is room. The
       * single 600px column left the sides of a desktop empty; the grid uses it. */
      .devgrid { max-width:600px; margin:0 auto; display:grid; gap:0;
                 grid-template-columns:minmax(0, 1fr); align-items:start; }
      .devgrid ha-card { max-width:none; }
      @media (min-width:1100px) {
        .devgrid { max-width:1240px; gap:0 var(--ha-space-6, 24px);
                   grid-template-columns:minmax(0, 7fr) minmax(0, 5fr); }
      }
      .devchips { display:flex; flex-wrap:wrap; gap:var(--ha-space-2, 8px);
                  padding:var(--ha-space-3, 12px) var(--ha-space-4, 16px) 0; }
      .chip2 { display:inline-flex; align-items:center; gap:var(--ha-space-1, 4px);
               padding:2px 10px; border-radius:999px;
               border:1px solid var(--divider-color);
               color:var(--secondary-text-color);
               font-size:var(--ha-font-size-s, 12px); line-height:1.8; }
      .chip2.ok { color:var(--success-color); border-color:var(--success-color); }
      .chip2.bad { color:var(--error-color); border-color:var(--error-color); }
      .chip2.warn { color:var(--warning-color); border-color:var(--warning-color); }

      /* One control row per controllable entity: name and state on the left, HA's
       * own tile controls on the right, brightness on its own line. */
      .ctl { display:flex; align-items:center; gap:var(--ha-space-3, 12px);
             padding:var(--ha-space-2, 8px) var(--ha-space-4, 16px); }
      .ctl + .ctl, .ctl + .ctl-slider, .ctl-slider + .ctl {
             border-top:1px solid var(--divider-color); }
      .ctl-info { flex:1; min-width:0; }
      .ctl-name { font-size:var(--ha-font-size-m, 14px); }
      .ctl-state { color:var(--secondary-text-color); font-size:var(--ha-font-size-s, 12px); }
      .ctl ha-control-switch { width:72px; height:36px; flex:none; }
      .ctl .ctl-btns { display:flex; gap:var(--ha-space-2, 8px); flex:none; }
      .ctl-slider { padding:0 var(--ha-space-4, 16px) var(--ha-space-3, 12px); }
      .ctl-slider ha-control-slider { height:36px; width:100%; }
      .ctl-slider-cap { color:var(--secondary-text-color);
                        font-size:var(--ha-font-size-s, 12px);
                        padding-bottom:var(--ha-space-1, 4px); }
      .ctl.off ha-control-switch { --control-switch-on-color:var(--primary-color); }

      /* Sensor readings: value prominent, label quiet, freshness quieter. */
      .sens-grid { display:grid; gap:var(--ha-space-2, 8px);
                   grid-template-columns:repeat(auto-fill, minmax(150px, 1fr));
                   padding:var(--ha-space-2, 8px) var(--ha-space-4, 16px) var(--ha-space-4, 16px); }
      .sens { padding:var(--ha-space-2, 8px) var(--ha-space-3, 12px);
              border-radius:var(--ha-border-radius-md, 8px);
              background:var(--secondary-background-color); }
      .sens-v { font-size:var(--ha-font-size-xl, 20px); line-height:1.3;
                color:var(--primary-text-color); }
      .sens-v span { font-size:var(--ha-font-size-s, 12px);
                     color:var(--secondary-text-color); }
      .sens-v.on { color:var(--primary-color); }
      .sens-l { color:var(--secondary-text-color); font-size:var(--ha-font-size-s, 12px);
                white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
      .sens-t { color:var(--disabled-text-color, var(--secondary-text-color));
                font-size:var(--ha-font-size-xs, 11px); }
      .sens-grid .diag { opacity:.75; }
      ha-expansion-panel { --expansion-panel-summary-padding:0 var(--ha-space-4, 16px);
                           --expansion-panel-content-padding:0; }
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
      /* The only bare control left: the device search, and only while HA has not
       * registered ha-textfield. Metrics copied from HA's own text field so the
       * substitution is not visible. */
      input.fallback { box-sizing:border-box; flex:1; min-width:0;
              min-height:var(--ha-touch-target-min-size, 40px);
              padding:var(--ha-space-2, 8px);
              border:var(--ha-border-width, 1px) solid var(--divider-color);
              border-radius:var(--ha-border-radius-md, 8px);
              background:var(--card-background-color); color:var(--primary-text-color);
              font:inherit; font-size:var(--ha-font-size-m, 14px); }
      input.fallback:focus-visible { outline:var(--ha-outline-width, 2px) solid var(--primary-color);
              outline-offset:var(--ha-space-1, 4px); }
      /* Every control the operator edits is one of HA's own components, which brings
       * its own metrics, focus ring and narrow-screen behaviour. Hand-rolled controls
       * in HA's row slot are what collapsed the labels and inflated the rows. */
      ha-form { display:block; }
      /* Deliberately NO width on HA's controls. Forcing a full-width control inside
       * ha-settings-row collapses the row's heading to zero -- the same fault that
       * made these screens unusable on a phone, one component later. HA's own
       * components size themselves, and the row is told when it is narrow. */
      ha-settings-row { padding:0; }
      ha-button:focus-visible, ha-icon-button:focus-visible {
              outline:var(--ha-outline-width, 2px) solid var(--primary-color);
              outline-offset:var(--ha-space-1, 4px); }
      /* Firmware progress. A determinate bar fills; an indeterminate one sweeps,
       * because Zigbee2MQTT reports nothing for the first stretch of a transfer and
       * drawing 0% there reads as "stuck". */
      .ota-group { padding:var(--ha-space-3, 12px) var(--ha-space-4, 16px) 0;
                   color:var(--secondary-text-color);
                   font-size:var(--ha-font-size-s, 13px); text-transform:uppercase;
                   letter-spacing:.04em; }
      .ota-cell { display:flex; align-items:center; gap:var(--ha-space-2, 8px); }
      .ota-bar { position:relative; width:72px; height:6px; overflow:hidden;
                 border-radius:var(--ha-border-radius-pill, 999px);
                 background:var(--divider-color); }
      .ota-fill { height:100%; background:var(--warning-color, #ff9800);
                  transition:width .3s ease; }
      .ota-bar.unknown .ota-fill { width:40%; animation:otasweep 1.2s ease-in-out infinite; }
      @keyframes otasweep {
        0% { transform:translateX(-100%); }
        100% { transform:translateX(250%); }
      }
      @media (prefers-reduced-motion: reduce) {
        .ota-bar.unknown .ota-fill { animation:none; width:100%; opacity:.4; }
      }
      .pair-identity { padding:var(--ha-space-3, 12px) var(--ha-space-4, 16px);
                       border:var(--ha-border-width, 1px) solid var(--divider-color);
                       border-radius:var(--ha-border-radius-md, 8px); }
      .pair-identity strong, .pair-identity code { display:block; overflow-wrap:anywhere; }
      .pair-log { max-height:var(--ha-log-max-height, 168px); overflow:auto;
                  border-top:var(--ha-border-width, 1px) solid var(--divider-color); }
      .pair-log .log { padding-inline:var(--ha-space-3, 12px); }

      /* ------------------------------------------------------------ dialog */
      /* A window everywhere, sized for the surface. 2026.8's ha-dialog is built on
       * wa-dialog and sizes itself with --ha-dialog-width-md / -full; on a phone HA's
       * global styles push those to 100vw, which is the full-screen takeover the
       * operator asked to remove. The --mdc-dialog-* names are dead in this
       * implementation -- overriding them does nothing. */
      ha-dialog { --ha-dialog-width-md:min(92vw, 33rem); }
      @media (max-width: 450px), (max-height: 500px) {
        ha-dialog { --ha-dialog-width-md:calc(100vw - var(--ha-space-8, 32px));
                    --ha-dialog-width-full:calc(100vw - var(--ha-space-8, 32px));
                    --ha-dialog-max-height:min(88vh, 720px);
                    --ha-dialog-min-height:auto;
                    --dialog-surface-margin-top:auto;
                    --ha-dialog-border-radius:var(--ha-border-radius-2xl, 28px); }
        .pair-log { max-height:var(--ha-log-max-height-narrow, 132px); }
      }
      .dlg { display:grid; gap:var(--ha-space-4, 16px);
             padding:var(--ha-space-2, 8px) 0 var(--ha-space-4, 16px); }
      .dlg .form-row { padding:0; }
      .dlg-lead { color:var(--primary-text-color); }
      .dlg-hint { color:var(--secondary-text-color);
                  font-size:var(--ha-font-size-s, 13px);
                  line-height:var(--ha-line-height-normal, 1.5); }
      .dlg-actions { display:flex; align-items:center; justify-content:flex-end;
                     flex-wrap:wrap; gap:var(--ha-space-2, 8px); }
      .dlg-actions .supporting { margin-inline-end:auto; }
      .pair-hero { display:flex; align-items:center; gap:var(--ha-space-4, 16px); }
      .dlg-title { margin:0; padding-inline-start:var(--ha-space-2, 8px);
                   font-size:var(--ha-font-size-xl, 20px);
                   font-weight:var(--ha-font-weight-normal, 400);
                   color:var(--primary-text-color); }
      .pair-hero ha-svg-icon { --mdc-icon-size:32px; color:var(--warning-color); }
      .pair-hero.ok ha-svg-icon { color:var(--success-color); }
      .pair-hero > div:nth-child(2) { flex:1; min-width:0; }
      .pair-left { flex:none; font-variant-numeric:tabular-nums;
                   font-size:var(--ha-font-size-2xl, 24px);
                   color:var(--secondary-text-color); }
      /* A ring that turns, rather than a progress bar that would imply progress we
       * cannot measure: nothing here knows when a device will decide to join. */
      .pair-spin { flex:none; width:28px; height:28px; border-radius:50%;
                   border:3px solid var(--divider-color);
                   border-top-color:var(--primary-color, #03a9f4);
                   animation:pairspin 1s linear infinite; }
      @keyframes pairspin { to { transform:rotate(360deg); } }
      @media (prefers-reduced-motion: reduce) {
        .pair-spin { animation:none; }
      }
      .pair-logbox { display:grid; gap:var(--ha-space-2, 8px);
                     border:var(--ha-border-width, 1px) solid var(--divider-color);
                     border-radius:var(--ha-border-radius-md, 8px);
                     padding-block:var(--ha-space-2, 8px); }
      .pair-logtop { display:flex; align-items:center; justify-content:space-between;
                     gap:var(--ha-space-2, 8px);
                     padding-inline:var(--ha-space-3, 12px);
                     color:var(--secondary-text-color);
                     font-size:var(--ha-font-size-s, 13px); }
      .pair-logbox .dlg-hint { padding-inline:var(--ha-space-3, 12px); }
      /* The label is two words and the control beside it is one: let the row give way
       * before the heading breaks across lines on a phone. */
      .pair-logtop > span:first-child { white-space:nowrap; }

      /* Stand-in for ha-dialog on a cold load, before HA's components arrive. It only
       * has to be honest and usable -- it is on screen for a moment. */
      .pairdlg { position:fixed; inset:0; z-index:9; display:grid; place-items:center; }
      .pairdlg-scrim { position:absolute; inset:0; background:rgba(0,0,0,.32); }
      .pairdlg-sheet { position:relative; width:min(92vw, 33rem);
                       max-height:86vh; overflow:auto;
                       box-sizing:border-box; padding:var(--ha-space-5, 20px);
                       background:var(--card-background-color, #fff);
                       border-radius:var(--ha-border-radius-lg, 12px);
                       box-shadow:0 8px 24px rgba(0,0,0,.28); }
      .pairdlg-head { display:flex; align-items:center; gap:var(--ha-space-3, 12px); }
      .pairdlg-head h2 { flex:1; margin:0;
                         font-size:var(--ha-font-size-xl, 20px);
                         font-weight:var(--ha-font-weight-normal, 400); }
      .pairdlg-head .close { all:unset; cursor:pointer; padding:var(--ha-space-2, 8px);
                             line-height:1; font-size:var(--ha-font-size-xl, 20px);
                             color:var(--secondary-text-color); }
      .recovery { border-top:var(--ha-border-width, 1px) solid var(--divider-color); }
      .container.mapview { padding:0; }
      .stage { height:calc(100vh - var(--header-height,56px)); min-height:360px; }
      .logwrap { min-height:280px; height:calc(100vh - 320px); overflow:auto;
                 border-top:var(--ha-border-width, 1px) solid var(--divider-color); }
      .log { display:flex; gap:var(--ha-space-2, 8px); padding:var(--ha-space-1, 4px) var(--ha-space-4, 16px);
             font-family:var(--ha-font-family-code, monospace); font-size:var(--ha-font-size-s, 12px);
             white-space:pre-wrap; overflow-wrap:anywhere; }
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
        /* Give the title the full width and let the actions take their own row,
           rather than squeezing a two-word heading into two lines. */
        .card-header { align-items:flex-start; flex-wrap:wrap; }
        .header-actions { justify-content:flex-start; width:100%; }
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
    // The dialog reads the inventory too: it is where the list of routers to join
    // through comes from.
    if (
      this._pairing.open ||
      ['dashboard', 'devices', 'device', 'ota', 'group'].includes(this._view.name)
    )
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

  /**
   * The element the page is rendered into.
   *
   * Rendering used to replace the shadow root's contents wholesale, which also
   * detached the pair dialog -- and `mwc-dialog` treats being detached as being
   * hidden, so it fired `closed` and the dialog shut itself the instant any retained
   * push caused a render. The page now lives in its own container and the dialog is
   * its sibling, so nothing the page does can take the dialog off the tree.
   */
  _ensureApp() {
    if (this._app && this._app.parentNode === this.shadowRoot) return this._app;
    const app = document.createElement('div');
    app.id = 'app';
    this.shadowRoot.appendChild(app);
    this._app = app;
    return app;
  }

  _render() {
    if (!this.shadowRoot) return;

    this._counts = this._countKey();
    const body = `<div class="container${this._view.name === 'map' ? ' mapview' : ''}">
        ${this._error ? `<ha-alert alert-type="error">${esc(this._error)}</ha-alert>` : ''}
        ${this._feedAlert()}
        ${this._bodyFor()}
        ${this._fab()}
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

    this._ensureApp().innerHTML = markup;
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

    // The dialog is retained across renders, so it has to be put back on top of the
    // markup that just replaced it.
    this._hostPairDialog();
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
      case 'network':
        return 'Network information';
      case 'ota':
        return 'Firmware';
      case 'map':
        return 'Network map';
      case 'logs':
        return 'Logs';
      case 'binds':
        return 'Bindings';
      case 'diagnostics':
        return 'Diagnostics';
      case 'options':
        return 'Options';
      default:
        return 'Zigbee';
    }
  }

  /**
   * The floating action button for "Add device", hand-drawn because `ha-fab` is not
   * registered in the bundle this panel loads into (verified on 2026.8.3, same story
   * as ha-textfield). Only where adding a device is the primary action; the container
   * already reserves bottom padding, so it never covers the last row.
   */
  _fab() {
    if (this._view.name !== 'dashboard' && this._view.name !== 'devices') return '';
    return `<button class="fab" data-act="pair" aria-label="Add device">
        ${icon(MDI.plus)}<span>Add device</span>
      </button>`;
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
      case 'network':
        return this._networkView();
      case 'ota':
        return this._otaView();
      case 'map':
        return this._mapView();
      case 'logs':
        return this._logsView();
      case 'binds':
        return this._bindsView(this._view.ieee);
      case 'diagnostics':
        return this._diagView();
      case 'options':
        return this._optionsView();
      default:
        return this._dashboard();
    }
  }

  /**
   * The delegations that any rendered fragment needs.
   *
   * Split out from `_hydrate` because the pair dialog lives outside the rendered
   * markup and has to wire its own contents with exactly the same rules.
   */
  _wire(r) {
    r.querySelectorAll('[data-path]').forEach((el) => {
      el.path = el.dataset.path;
      if (el.dataset.label) el.label = el.dataset.label;
    });

    // `ha-form` is driven entirely by properties -- hass, schema, data and the two
    // label callbacks -- so markup can only mark the spot. `_forms` is rebuilt by
    // whichever view is being rendered, and holds the live value: the form owns the
    // operator's edits between renders, and Save reads them from here.
    r.querySelectorAll('[data-form]').forEach((el) => {
      const spec = this._forms[el.dataset.form];
      if (!spec) return;
      el.hass = this._hass;
      el.schema = spec.schema;
      el.data = spec.data;
      el.computeLabel = spec.label || ((s) => s.name);
      el.computeHelper = spec.helper || (() => undefined);
      if (el._z2mForm) return;
      el._z2mForm = true;
      el.addEventListener('value-changed', (ev) => {
        ev.stopPropagation();
        // Typed-in values outrank anything the bridge republishes underneath them.
        spec.touched = true;
        spec.data = { ...spec.data, ...(ev.detail || {}).value };
        el.data = spec.data;
        if (spec.changed) spec.changed(spec.data);
      });
    });

    // ha-select and ha-textfield take their value as a property too, and ha-select
    // fires `selected` when the menu closes -- including when the value was set from
    // here, which is why the handler compares before acting.
    r.querySelectorAll('[data-value]').forEach((el) => {
      el.value = el.dataset.value;
    });
    r.querySelectorAll('[data-selected]').forEach((el) => {
      if (el._z2mSelect) return;
      el._z2mSelect = true;
      el.addEventListener('selected', () => {
        if (String(el.value) === String(el.dataset.value)) return;
        this._change(el.dataset.selected, el);
      });
    });
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

    // Live device controls. All of them talk to HA's own service bus, not to Z2M:
    // toggling a light is exactly what tapping it in HA does, so the whole state
    // pipeline (optimistic update, retained echo) behaves identically.
    r.querySelectorAll('[data-svc]').forEach((el) => {
      if (el._z2mSvc) return;
      el._z2mSvc = true;
      el.addEventListener('click', () => {
        const [call, eid] = el.dataset.svc.split('|');
        const [domain, service] = call.split('.');
        this._hass.callService(domain, service, { entity_id: eid });
      });
    });
    r.querySelectorAll('[data-ctltoggle]').forEach((el) => {
      const st = this._hass && this._hass.states && this._hass.states[el.dataset.ctltoggle];
      if (st) el.checked = st.state === 'on';
      if (el._z2mCtl) return;
      el._z2mCtl = true;
      el.addEventListener('change', () => {
        const eid = el.dataset.ctltoggle;
        this._hass.callService(eid.split('.')[0], el.checked ? 'turn_on' : 'turn_off', {
          entity_id: eid,
        });
      });
    });
    r.querySelectorAll('[data-ctlbright]').forEach((el) => {
      const st = this._hass && this._hass.states && this._hass.states[el.dataset.ctlbright];
      if (st) {
        const b = (st.attributes || {}).brightness;
        el.value = st.state === 'on' && b ? Math.max(1, Math.round((b / 255) * 100)) : 0;
      }
      if (el._z2mCtl) return;
      el._z2mCtl = true;
      el.addEventListener('value-changed', (ev) => {
        const pct = Number((ev.detail || {}).value);
        if (!Number.isFinite(pct)) return;
        this._hass.callService('light', pct === 0 ? 'turn_off' : 'turn_on',
          pct === 0
            ? { entity_id: el.dataset.ctlbright }
            : { entity_id: el.dataset.ctlbright, brightness_pct: Math.round(pct) });
      });
    });
    r.querySelectorAll('[data-change]').forEach((el) => {
      el.onchange = () => this._change(el.dataset.change, el);
    });

    const pairLog = r.querySelector('#pairlog');
    if (pairLog) {
      // Scrolling up is itself a request to stop following; scrolling back to the
      // bottom resumes it. The button stays as the explicit control, but the
      // gesture should not fight it.
      pairLog.onscroll = () => {
        const atBottom = pairLog.scrollHeight - pairLog.scrollTop - pairLog.clientHeight < 24;
        if (this._pairing.follow !== atBottom) {
          this._pairing.follow = atBottom;
          this._paintPairDialog();
        }
      };
      // A repaint replaces this element, so the pin has to be re-applied.
      if (this._pairing.follow) pairLog.scrollTop = pairLog.scrollHeight;
    }
  }

  /** Assign the JS properties and listeners markup cannot carry. */
  _hydrate() {
    const r = this.shadowRoot;
    this._wire(r);

    const page = r.getElementById('page');
    if (page) {
      page.hass = this._hass;
      // Sub-views step back through the panel's own view state. The top level has no
      // in-panel parent, so it shows HA's menu button instead of a back arrow.
      page.backCallback = this._view.name === 'dashboard' ? undefined : () => this._back();
    }

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
    else if (this._view.name === 'binds') this._go({ name: 'device', ieee: this._view.ieee });
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
    // The dialog floats above whatever view is beneath it, and navigating out from
    // under it would leave the network open with nothing on screen saying so.
    if (this._pairing.open) this._closePairDialog();
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
    // Re-hosting on every render matters: the element instance is retained, so a
    // render caused by (say) a scan error has to put it back where it was.
    if (this._view.name === 'map') {
      if (this._subs.map) this._mountMap();
      else this._openMap();
    }
    if (this._view.name === 'diagnostics' && !this._diag.checked) this._runCoordinatorCheck();
    if (this._view.name === 'binds' && this._binds.ieee !== this._view.ieee) {
      this._openBinds(this._view.ieee);
    }
    // Freshen what the device page shows, the way Z2M's own UI does with its
    // per-field refresh arrows -- except all at once and unprompted. One MQTT get
    // covers every readable attribute, so for a powered device this is a burst of
    // unicast reads to that one device: negligible, and worth it for the operator
    // never seeing a stale toggle. Sleeping battery devices are skipped -- they
    // would only queue until wake-up; the Refresh button covers them honestly.
    if (this._view.name === 'device') {
      const d = this._dev(this._view.ieee);
      this._readValues = this._readValues || {};
      if (d && d.availability !== 'offline' && d.power_source === 'Mains (single phase)'
          && !this._readValues[d.ieee_address]) {
        this._readValues[d.ieee_address] = true;
        this._call('z2m/device/read_values', { device: d.ieee_address }).catch(() => {
          // A failed freshen changes nothing on screen; the page still shows HA's
          // last known state, which is exactly what it showed before this existed.
        });
      }
    }
  }

  /* ---------------------------------------------------------------- ticker */

  /** One second tick, only while something on screen actually counts. */
  _needsTicker() {
    if (this._view.name === 'map') return true;
    // The dialog counts down whatever is underneath it.
    if (this._pairing.open) return true;
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
    if (this._pairing.open) this._tickPairing();
    if (this._view.name === 'map') this._syncScan();
  }

  /**
   * Count the window down, and notice when it runs out.
   *
   * The expiry is Zigbee2MQTT's, not ours: it closes the window by itself after the
   * time we asked for. Watching for that is what turns a silent dead end into a
   * screen that says nothing joined and offers to try again.
   */
  _tickPairing() {
    const p = this._pairing;
    const left = this._pairingCountdown();
    const box = this.shadowRoot.querySelector('#pairleft');
    if (box) box.textContent = left === null ? '' : `${left}s`;

    const searching = p.phase === 'waiting' && p.ownsPermit;
    if (searching && !(this._summary || {}).permit_join) {
      // Z2M closed it, so there is nothing left for us to close.
      p.ownsPermit = false;
      p.phase = 'timeout';
      this._paintPairDialog();
      this._startTicker();
    }
  }

  /* -------------------------------------------------------------- dashboard */

  _joinText() {
    const s = this._summary || {};
    if (!s.permit_join) return 'Joining closed';
    const left = this._joinLeft();
    return left ? `Joining open, ${left}s left` : 'Joining open';
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
    const rows = [
      // The panel's own device list, not HA's device table: the Zigbee side of each
      // device -- rename, reconfigure, re-interview, remove, per-device settings --
      // is what this panel exists for. HA's table is one filter away for anyone who
      // wants it, so it does not need a row here.
      row({
        icon: MDI.devices,
        headline: `${s.device_count || 0} device${(s.device_count || 0) === 1 ? '' : 's'}`,
        text: s.offline_count
          ? `${s.offline_count} offline \u00b7 rename, settings, firmware and removal`
          : 'Rename, settings, firmware and removal',
        go: 'devices',
      }),
      row({
        icon: MDI.groups,
        headline: `${s.group_count || 0} group${(s.group_count || 0) === 1 ? '' : 's'}`,
        go: 'groups',
      }),
    ].join('');

    // Add device lives in the floating action button, the way HA's own device pages
    // do it. The first FAB here was removed for two faults that no longer exist: it
    // was a hand-styled ha-button that overlapped content (the container now reserves
    // bottom space for it), and it toggled the radio directly with nothing on screen
    // (it now opens the pairing dialog, which watches before it touches the radio).
    return `
      <ha-card class="nav-card">
        <div class="card-header">My network
          <span class="header-actions">
            <ha-button appearance="plain" data-act="map">${icon(MDI.map)}Show map</ha-button>
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
          ${
            this._has('ha-textfield')
              ? `<ha-textfield id="q" type="search" data-value="${esc(this._filter)}"
                   placeholder="Search ${this._devices.length} devices"></ha-textfield>`
              : // Live filtering is not a settings field, and `ha-form` would put a
                // label and a helper around it. `ha-textfield` is the right component
                // and it is used the moment the frontend registers it; until then this
                // is a search box that works, styled to HA's own metrics.
                `<input id="q" class="fallback" type="search" value="${esc(this._filter)}"
                   placeholder="Search ${this._devices.length} devices">`
          }
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

    const live = this._liveEntities(ieee);
    const offline = d.availability === 'offline';

    // The freshen affordance rides the first live card, so it sits beside what it
    // refreshes.
    const refreshBtn = `<ha-button appearance="plain" size="s" data-act="readvalues">
        ${icon(MDI.refresh)}Refresh</ha-button>`;
    live.refreshBtn = live.controls.length || live.sensors.length || live.diags.length
      ? refreshBtn : '';
    const feed = this._feedMsg
      ? `<ha-alert alert-type="success">${esc(this._feedMsg)}</ha-alert>`
      : '';
    // Live things first -- what the device is doing and the controls to change it --
    // because that is what the operator opens the page for. Identity and admin sit
    // beside them on a wide screen and after them on a phone, with the identity table
    // folded away: it was the first thing on the old page and earned none of it.
    return `<div class="devgrid">
      <div>
        ${
          offline
            ? `<ha-alert alert-type="warning" title="Offline">
                 Zigbee2MQTT has not heard from this device within its availability
                 window. Controls will queue or fail until it is heard again.
               </ha-alert>`
            : ''
        }
        ${feed}
        ${this._controlsCard(live)}
        ${this._sensorsCard(live)}
        <ha-card class="nav-card"><div id="fwbox">${this._fwInner(d)}</div></ha-card>
      </div>
      <div>
        <ha-card class="nav-card">
          <div class="devchips">${this._deviceChips(d, live)}</div>
          <ha-expansion-panel header="Device details">${this._kvs([
            ['Friendly name', d.friendly_name],
            ['IEEE address', d.ieee_address],
            ['Network address', d.network_address],
            ['Vendor', d.vendor],
            ['Model', d.model],
            ['Description', d.description],
            ['Type', d.type],
            ['Power source', d.power_source],
            ['Firmware build', d.software_build_id],
            ['Firmware date', d.date_code],
          ])}</ha-expansion-panel>
        </ha-card>

        <ha-card class="nav-card">
          <div class="card-header">Rename</div>
          <div class="card-content pad">
            ${this._textField(`rename:${d.ieee_address}`, {
              label: 'Friendly name',
              helper: 'Changes the MQTT topic, so Home Assistant entity IDs regenerate',
              value: d.friendly_name || '',
            })}
          </div>
          <div class="actions">
            <ha-button appearance="filled" size="s" data-act="rename">Rename</ha-button>
          </div>
        </ha-card>

        ${this._optionsForm(d)}

        <ha-card class="nav-card">
          <div class="card-header">Maintenance</div>
          <div class="card-content">${list(
            row({
              icon: MDI.link,
              headline: 'Bindings',
              text: 'Send this device\u2019s commands straight to another device or group',
              act: 'openbinds',
              tap: true,
            }) +
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
        </ha-card>
      </div>
    </div>`;
  }

  /* ------------------------------------------------- live entities on the page */

  /** The HA device that MQTT discovery created for this Zigbee device. */
  _haDeviceFor(ieee) {
    const devs = (this._hass && this._hass.devices) || {};
    const tag = `zigbee2mqtt_${String(ieee || '').toLowerCase()}`;
    for (const id in devs) {
      for (const pair of devs[id].identifiers || []) {
        if (String((pair || [])[1] || '').toLowerCase() === tag) return devs[id];
      }
    }
    return null;
  }

  /**
   * The device's HA entities, classified for the page. Hidden and disabled entities
   * stay out -- the operator hid them deliberately, and a disabled entity has no
   * state to show. `update` is carried by the firmware card, not repeated here.
   */
  _liveEntities(ieee) {
    const out = { haDevice: null, controls: [], sensors: [], diags: [] };
    const h = this._hass;
    if (!h || !h.entities || !h.states) return out;
    const haDev = this._haDeviceFor(ieee);
    if (!haDev) return out;
    out.haDevice = haDev;
    const CONTROL = { light: 1, switch: 1, fan: 1, lock: 1, cover: 1, valve: 1, siren: 1 };
    for (const eid in h.entities) {
      const e = h.entities[eid];
      if (e.device_id !== haDev.id || e.hidden) continue;
      const st = h.states[eid];
      if (!st) continue;
      const domain = eid.split('.')[0];
      const item = { eid, domain, st, category: e.entity_category || null };
      if (CONTROL[domain] && !item.category) out.controls.push(item);
      else if (domain === 'sensor' || domain === 'binary_sensor') {
        (item.category ? out.diags : out.sensors).push(item);
      }
    }
    const name = (x) => this._entityName(x);
    out.controls.sort((a, b) => name(a).localeCompare(name(b)));
    out.sensors.sort((a, b) => name(a).localeCompare(name(b)));
    out.diags.sort((a, b) => name(a).localeCompare(name(b)));
    return out;
  }

  /** The entity's own name, without the device name it is prefixed with. */
  _entityName(item) {
    const full = (item.st.attributes || {}).friendly_name || item.eid;
    const d = this._dev(this._view.ieee) || {};
    const prefix = d.friendly_name || '';
    if (prefix && full.toLowerCase().startsWith(prefix.toLowerCase())) {
      const rest = full.slice(prefix.length).trim();
      if (rest) return rest;
    }
    return full;
  }

  _deviceChips(d, live) {
    const chips = [];
    const off = d.availability === 'offline';
    chips.push(`<span class="chip2 ${off ? 'bad' : 'ok'}">${off ? 'Offline' : 'Online'}</span>`);
    if (d.type) chips.push(`<span class="chip2">${esc(d.type)}</span>`);
    const batt = (live.diags || []).find((x) => (x.st.attributes || {}).device_class === 'battery');
    if (batt && batt.st.state !== 'unavailable' && batt.st.state !== 'unknown') {
      const pct = Number(batt.st.state);
      chips.push(`<span class="chip2${pct <= 20 ? ' warn' : ''}">Battery ${esc(batt.st.state)}%</span>`);
    } else if (d.power_source && d.power_source !== 'Mains (single phase)') {
      chips.push(`<span class="chip2">${esc(d.power_source)}</span>`);
    }
    // _deviceArea answers with the area_id (that is what the registry write takes);
    // a chip is read by a person, so it gets the area's name.
    const areaId = live.haDevice && live.haDevice.area_id;
    const area = areaId && (((this._hass.areas || {})[areaId] || {}).name || areaId);
    if (area) chips.push(`<span class="chip2">${esc(area)}</span>`);
    if (d.supported === false) {
      chips.push('<span class="chip2 warn">Not supported, needs a custom converter</span>');
    }
    return chips.join('');
  }

  _controlsCard(live) {
    if (!live.controls.length) return '';
    const rows = live.controls.map((item) => this._controlRow(item)).join('');
    return `<ha-card class="nav-card">
        <div class="card-header">Controls${live.refreshBtn
          ? `<span class="header-actions">${live.refreshBtn}</span>` : ''}</div>
        <div class="card-content">${rows}</div>
      </ha-card>`;
  }

  /**
   * One row per controllable entity, driven by HA's own tile controls
   * (ha-control-switch / ha-control-slider are registered in this bundle; verified
   * the same way ha-textfield was verified absent). Everything is wired by
   * data-attributes in _wire, and patched in place by _syncLive on hass pushes, so
   * a state change never re-renders the page under the operator.
   */
  _controlRow(item) {
    const st = item.st;
    const unavailable = st.state === 'unavailable' || st.state === 'unknown';
    const name = esc(this._entityName(item));
    const stateText = st.state;
    const info = `<div class="ctl-info">
        <div class="ctl-name">${name}</div>
        <div class="ctl-state" data-ctlstate="${esc(item.eid)}">${esc(stateText)}</div>
      </div>`;

    if (item.domain === 'light' || item.domain === 'switch' || item.domain === 'fan'
        || item.domain === 'siren') {
      const sw = `<ha-control-switch data-ctltoggle="${esc(item.eid)}"${
        unavailable ? ' disabled' : ''
      }></ha-control-switch>`;
      let slider = '';
      if (item.domain === 'light'
          && Array.isArray((st.attributes || {}).supported_color_modes)
          && st.attributes.supported_color_modes.some((m) => m !== 'onoff')) {
        slider = `<div class="ctl-slider">
            <div class="ctl-slider-cap">Brightness</div>
            <ha-control-slider data-ctlbright="${esc(item.eid)}" min="1" max="100" step="1"${
              unavailable ? ' disabled' : ''
            }></ha-control-slider>
          </div>`;
      }
      return `<div class="ctl">${info}${sw}</div>${slider}`;
    }

    if (item.domain === 'lock') {
      return `<div class="ctl">${info}
          <span class="ctl-btns">
            <ha-button appearance="plain" size="s" data-svc="lock.unlock|${esc(item.eid)}">Unlock</ha-button>
            <ha-button appearance="filled" size="s" data-svc="lock.lock|${esc(item.eid)}">Lock</ha-button>
          </span>
        </div>`;
    }

    // cover and valve: explicit verbs, because toggle on a half-open cover is a guess.
    const domain = item.domain;
    const open = domain === 'cover' ? 'open_cover' : 'open_valve';
    const close = domain === 'cover' ? 'close_cover' : 'close_valve';
    const stop = domain === 'cover' ? `<ha-button appearance="plain" size="s"
          data-svc="cover.stop_cover|${esc(item.eid)}">Stop</ha-button>` : '';
    return `<div class="ctl">${info}
        <span class="ctl-btns">
          <ha-button appearance="plain" size="s" data-svc="${domain}.${close}|${esc(item.eid)}">Close</ha-button>
          ${stop}
          <ha-button appearance="filled" size="s" data-svc="${domain}.${open}|${esc(item.eid)}">Open</ha-button>
        </span>
      </div>`;
  }

  _sensorsCard(live) {
    if (!live.sensors.length && !live.diags.length) return '';
    const tile = (item, extra) => {
      const st = item.st;
      const a = st.attributes || {};
      const bad = st.state === 'unavailable' || st.state === 'unknown';
      const on = item.domain === 'binary_sensor' && st.state === 'on';
      const value = bad
        ? st.state
        : item.domain === 'binary_sensor'
          ? (st.state === 'on' ? 'Detected' : 'Clear')
          : this._fmtState(st, item);
      const unit = !bad && item.domain === 'sensor' && a.unit_of_measurement
        ? ` <span>${esc(a.unit_of_measurement)}</span>` : '';
      return `<div class="sens${extra || ''}" data-sens="${esc(item.eid)}">
          <div class="sens-v${on ? ' on' : ''}">${esc(String(value))}${unit}</div>
          <div class="sens-l" title="${esc(this._entityName(item))}">${esc(this._entityName(item))}</div>
          <div class="sens-t">${esc(this._age(st.last_changed))}</div>
        </div>`;
    };
    return `<ha-card class="nav-card">
        <div class="card-header">Sensors${live.refreshBtn && !live.controls.length
          ? `<span class="header-actions">${live.refreshBtn}</span>` : ''}</div>
        <div class="sens-grid">
          ${live.sensors.map((i) => tile(i)).join('')}
          ${live.diags.map((i) => tile(i, ' diag')).join('')}
        </div>
      </ha-card>`;
  }

  /** Round with the registry's display precision, the way HA's own cards do. */
  _fmtState(st, item) {
    const e = this._hass && this._hass.entities && this._hass.entities[item.eid];
    const n = Number(st.state);
    if (!Number.isFinite(n)) return st.state;
    if (e && e.display_precision !== undefined && e.display_precision !== null) {
      return n.toFixed(e.display_precision);
    }
    return String(n);
  }

  _age(iso) {
    if (!iso) return '';
    const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return `${Math.round(s / 60)} min ago`;
    if (s < 86400) return `${Math.round(s / 3600)} h ago`;
    return `${Math.round(s / 86400)} d ago`;
  }

  /**
   * Patch the live parts of the device page from a fresh `hass` without a render,
   * the same bargain _syncFw makes: a state change never steals the caret from the
   * rename field or resets the settings form.
   */
  _syncLive() {
    if (this._view.name !== 'device' || !this.shadowRoot) return;
    const states = (this._hass && this._hass.states) || {};
    const r = this.shadowRoot;
    r.querySelectorAll('[data-ctltoggle]').forEach((el) => {
      const st = states[el.dataset.ctltoggle];
      if (!st) return;
      el.checked = st.state === 'on';
      el.disabled = st.state === 'unavailable' || st.state === 'unknown';
    });
    r.querySelectorAll('[data-ctlbright]').forEach((el) => {
      const st = states[el.dataset.ctlbright];
      if (!st || r.activeElement === el) return;
      const b = (st.attributes || {}).brightness;
      el.value = st.state === 'on' && b ? Math.max(1, Math.round((b / 255) * 100)) : 0;
    });
    r.querySelectorAll('[data-ctlstate]').forEach((el) => {
      const st = states[el.dataset.ctlstate];
      if (st) el.textContent = st.state;
    });
    r.querySelectorAll('[data-sens]').forEach((el) => {
      const st = states[el.dataset.sens];
      if (!st) return;
      const item = { eid: el.dataset.sens, domain: el.dataset.sens.split('.')[0], st };
      const a = st.attributes || {};
      const bad = st.state === 'unavailable' || st.state === 'unknown';
      const v = el.querySelector('.sens-v');
      if (v) {
        const value = bad
          ? st.state
          : item.domain === 'binary_sensor'
            ? (st.state === 'on' ? 'Detected' : 'Clear')
            : this._fmtState(st, item);
        const unit = !bad && item.domain === 'sensor' && a.unit_of_measurement
          ? ` <span>${esc(a.unit_of_measurement)}</span>` : '';
        v.innerHTML = `${esc(String(value))}${unit}`;
        v.classList.toggle('on', item.domain === 'binary_sensor' && st.state === 'on');
      }
      const t = el.querySelector('.sens-t');
      if (t) t.textContent = this._age(st.last_changed);
    });
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
   * Z2M ships an options schema per device, so the form is generated from it rather
   * than hard-coded per model. It is rendered by `ha-form`, which is what Home
   * Assistant's own config pages use: it lays out and validates every selector type,
   * and it is responsive without a single line of CSS here.
   *
   * The previous version hosted bare `<input>`/`<select>` in the trailing slot of
   * HA's list row. On a phone the control took the whole row, the label collapsed to
   * zero width, and the row grew to several hundred pixels of empty space.
   */
  _optionsForm(d) {
    const opts = (d.options || []).filter((o) => o && o.property);
    if (!opts.length) return '';
    const key = `opts:${d.ieee_address}`;
    const spec = this._formSpec(key, () => ({
      schema: opts.map((o) => ({ name: o.property, selector: this._optionSelector(o) })),
      // Z2M reports the device's current option values separately from the schema.
      data: { ...(d.option_values || {}) },
      label: (s) => {
        const o = opts.find((x) => x.property === s.name) || {};
        return o.label || o.name || s.name;
      },
      helper: (s) => (opts.find((x) => x.property === s.name) || {}).description,
    }));
    // Values that arrived after the form was built, for fields the operator has not
    // touched, still belong on screen.
    Object.entries(d.option_values || {}).forEach(([k, v]) => {
      if (!(k in spec.data)) spec.data[k] = v;
    });

    return `<ha-card class="nav-card">
        <div class="card-header">Device settings</div>
        <div class="card-content pad">
          <ha-form data-form="${esc(key)}"></ha-form>
        </div>
        <div class="note">Written straight to Zigbee2MQTT. An empty field simply uses
        the Zigbee2MQTT default for this model. These are converter settings rather than
        values stored on the device, so there is nothing to read back.</div>
        <div class="actions">
          <ha-button appearance="filled" size="s" data-act="options">Save settings</ha-button>
        </div>
      </ha-card>`;
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
      status = `Updating${f.pct != null ? ` (${f.pct}%)` : ''}`;
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

    const ver = fwVersion;

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

  /**
   * What the fleet's firmware state actually is, counted once.
   *
   * Every number here comes from Home Assistant's own `update` entities, which
   * Zigbee2MQTT feeds, so this cannot disagree with HA's native update UI.
   */
  _otaFleet() {
    const capable = this._devices.filter((d) => d.update_entity);
    const fleet = {
      capable,
      // Devices Z2M exposes no update entity for: they told the network they have no
      // OTA cluster, so there is nothing to check and nothing to install.
      noOta: this._devices.filter((d) => !d.update_entity && d.type !== 'Coordinator').length,
      updating: [],
      available: [],
      current: [],
      unassessed: [],
      offline: [],
    };
    capable.forEach((d) => {
      const f = this._fw(d);
      if (!f) return;
      if (f.inProgress) fleet.updating.push({ d, f });
      else if (f.unavailable) fleet.offline.push({ d, f });
      else if (!f.assessed) fleet.unassessed.push({ d, f });
      else if (f.available) fleet.available.push({ d, f });
      else fleet.current.push({ d, f });
    });
    return fleet;
  }

  /**
   * A progress bar, or an indeterminate one when Zigbee2MQTT has not said how far in
   * it is.
   *
   * An OTA transfer reports nothing at all for its first stretch, and drawing 0% for
   * that is a lie the operator will read as "stuck". Indeterminate says the true
   * thing: it is running, and how far is not yet known.
   */
  _otaProgress(f, id) {
    const known = f.pct !== null && f.pct !== undefined;
    return `<div class="ota-bar${known ? '' : ' unknown'}" id="${esc(id)}"
        role="progressbar" aria-valuemin="0" aria-valuemax="100"${
          known ? ` aria-valuenow="${esc(f.pct)}"` : ''
        }>
        <div class="ota-fill" style="${known ? `width:${Number(f.pct)}%` : ''}"></div>
      </div>`;
  }

  _otaRows() {
    const fleet = this._otaFleet();
    if (!fleet.capable.length) return '<div class="empty">No OTA-capable devices.</div>';

    // Mid-update first, then what can be acted on, then the quiet majority: the
    // operator came here for the ones that are doing something.
    const order = [
      ['Updating now', fleet.updating],
      ['Update available', fleet.available],
      ['Never assessed', fleet.unassessed],
      ['Offline', fleet.offline],
      ['Up to date', fleet.current],
    ];

    return order
      .filter(([, group]) => group.length)
      .map(([title, group]) => {
        const rows = group
          .map(({ d, f }) => {
            const battery = d.power_source && d.power_source !== 'Mains (single phase)';
            const id = `otap_${esc(d.ieee_address)}`;
            let end;
            if (f.inProgress) {
              end = `<span slot="end" class="ota-cell">${this._otaProgress(f, id)}<span
                class="chip warn">${f.pct == null ? 'starting' : `${esc(f.pct)}%`}</span></span>`;
            } else if (f.unavailable) {
              end = '<span slot="end" class="chip off">offline</span>';
            } else if (f.available) {
              end = `<span slot="end" class="chip warn">${battery ? 'battery' : 'update'}</span>`;
            } else if (!f.assessed) {
              end = '<span slot="end" class="chip">not assessed</span>';
            } else {
              end = '<span slot="end" class="chip ok">up to date</span>';
            }
            return row({
              icon: f.inProgress ? MDI.updating : MDI.firmware,
              headline: esc(d.friendly_name),
              // Z2M publishes -1 for "never asked the OTA index", which is not a
              // version and must not be rendered as one.
              text: `${fwVersion(f.installed)} \u2192 ${fwVersion(f.latest)}`,
              data: ` data-ieee="${esc(d.ieee_address)}"`,
              tap: true,
              end: `${end}<ha-icon-next slot="end"></ha-icon-next>`,
            });
          })
          .join('');
        return `<div class="ota-group">${esc(title)} \u00b7 ${group.length}</div>${list(rows)}`;
      })
      .join('');
  }

  _otaView() {
    const fleet = this._otaFleet();
    const n = fleet.capable.length;
    const summary = [
      fleet.updating.length ? `${fleet.updating.length} updating` : '',
      fleet.available.length ? `${fleet.available.length} with an update` : '',
      fleet.unassessed.length ? `${fleet.unassessed.length} never assessed` : '',
      `${fleet.current.length} up to date`,
    ]
      .filter(Boolean)
      .join(' \u00b7 ');

    return (
      card(
        `<div class="card-header">Firmware across ${n} device${n === 1 ? '' : 's'}</div>
         <div class="note">${esc(summary)}${
           fleet.noOta
             ? ` \u00b7 ${fleet.noOta} device${
                 fleet.noOta === 1 ? '' : 's'
               } report no OTA support at all`
             : ''
         }</div>` +
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
        <div class="card-content pad">${this._textField('gcreate', {
          label: 'Name',
          helper: 'What the group will be called in Home Assistant',
          value: '',
        })}</div>
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
          `<ha-list-item value="${esc(`${c.device.ieee_address}|${c.endpoint}`)}">${esc(
            c.device.friendly_name || c.device.ieee_address
          )}${(c.device.endpoints || []).length > 1 ? `, endpoint ${esc(String(c.endpoint))}` : ''}</ha-list-item>`
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
        <div class="card-content pad">${this._textField(`grename:${g.id}`, {
          label: 'Name',
          helper: 'Renames the group and its MQTT topic',
          value: g.friendly_name || '',
        })}</div>
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
            ? `<ha-settings-row${this._narrow ? ' narrow' : ''}>
                 <span slot="heading">Add a member</span>
                 <span slot="description">Membership is per endpoint</span>
                 <ha-select id="gmember" naturalMenuWidth fixedMenuPosition
                   data-value="${esc(`${candidates[0].device.ieee_address}|${candidates[0].endpoint}`)}">${options}</ha-select>
               </ha-settings-row>
               <div class="actions">
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
              text: 'Recovery only: deletes the group without telling the devices, so they stay programmed with its address',
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
    if (!(this._summary || {}).permit_join) return null;
    return left === null ? null : left;
  }

  /**
   * Open the dialog and start WATCHING, without touching the radio.
   *
   * Deliberately two steps. The old flow opened the network the instant the button
   * was pressed, which meant the operator was already on the clock before they had
   * read anything, and there was no way to choose how to join. Subscribing here is
   * still right, though: it is what turns Zigbee2MQTT up to debug and starts the
   * log, so by the time they press Start the diagnostics are already flowing.
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
    p.phase = 'idle';
    // Deliberately NOT opening the radio here. That is the Start button's job.
    this._paintPairDialog();
  }

  /**
   * Open joining, either network-wide or through one router.
   *
   * Joining through a specific router is Zigbee2MQTT's own `device` parameter on
   * permit_join, and it is the thing to reach for when a device will not pair: it
   * is told to join via a router that is physically near it, instead of whichever
   * neighbour answers first from across the house.
   */
  async _startPairing() {
    const p = this._pairing;
    p.target = null;
    p.event = null;
    p.supported = null;
    p.definition = null;
    p.setup = { saving: false, completed: false, device: null };
    await this._openJoinWindow();
  }

  async _openJoinWindow() {
    const p = this._pairing;
    const run = p.run;
    p.opening = true;
    p.error = null;
    p.notice = null;
    this._paintPairDialog();
    const payload = { time: p.duration };
    if (p.via) payload.device = p.via;
    try {
      await this._call('z2m/permit_join', payload);
      if (this._pairing.run !== run) return;
      // Only a window this helper opened is a window this helper may close.
      p.ownsPermit = true;
      p.phase = 'waiting';
      p.startedAt = Date.now();
    } catch (err) {
      if (this._pairing.run !== run) return;
      p.phase = 'idle';
      p.error = this._feedMessage(err, 'Zigbee2MQTT refused to open the network');
    } finally {
      if (this._pairing.run === run) {
        p.opening = false;
        this._paintPairDialog();
        this._startTicker();
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
    // The log level goes back by itself: dropping the pairing subscription is what
    // releases it, and Home Assistant drops it even if this page never gets to.
    this._resetPairing();
  }

  /**
   * Is this log line about pairing, or is it the mesh going about its business?
   *
   * At debug level a 42-device network emits a line per received message and per
   * MQTT publish, so an unfiltered view scrolls the interview off screen faster
   * than it can be read. The rule is deliberately about the SUBJECT of the line:
   * anything concerning the device being paired is kept, anything that is routine
   * traffic from a device already on the network is dropped.
   */
  _pairLogRelevant(message) {
    const text = String(message);
    const p = this._pairing;
    const target = p.target;
    const name = (p.event && p.event.friendly_name) || null;
    const mentionsTarget =
      (target && text.includes(target)) || (name && name !== target && text.includes(name));
    if (mentionsTarget) return true;

    // Routine device traffic. These are the lines that drown everything else, and
    // none of them concern a device that is joining -- a device Z2M is still
    // interviewing has no state to publish and no converter to publish it with.
    if (/^z2m:mqtt: MQTT publish: topic '[^']*'/.test(text)) {
      // Bridge topics are the pairing conversation itself; device topics are not.
      if (!/topic '[^'/]*\/bridge\//.test(text)) return false;
      // Even among bridge topics, the retained inventory republishes on every
      // state change and says nothing about pairing.
      if (/\/bridge\/(devices|groups|info|state|logging|health)'/.test(text)) return false;
      return true;
    }
    if (/^z2m: Received Zigbee message from '/.test(text)) return false;
    if (/No converter available/.test(text)) return true;

    // The pairing vocabulary, as Zigbee2MQTT and zigbee-herdsman actually write it.
    return /(join|interview|announce|pair|permit|allow(?:ing)? new devices|disabling joining|leave|left the network|removed|configur|bind|reporting|new device|unsupported|not supported|definition|security|transport key|network key|device_(?:joined|announce|interview|leave)|failed)/i.test(
      text
    );
  }

  _onPairLog(run, entry) {
    const p = this._pairing;
    if (p.run !== run || !entry || !entry.message) return;
    if (!this._pairLogRelevant(entry.message)) return;
    p.logs.push(entry);
    if (p.logs.length > PAIR_LOG_MAX) p.logs.splice(0, p.logs.length - PAIR_LOG_MAX);
    // Patch the log box in place: a full render would drop the operator's typing
    // in the name field once a device has joined.
    const box = this.shadowRoot && this.shadowRoot.getElementById('pairlog');
    if (!box) return;
    box.innerHTML = this._pairLogRows();
    if (p.follow) box.scrollTop = box.scrollHeight;
  }

  /** Pin the pairing log to its newest line. */
  _scrollPairLog() {
    const box = this.shadowRoot && this.shadowRoot.getElementById('pairlog');
    if (box) box.scrollTop = box.scrollHeight;
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
      this._paintPairDialog();
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
    this._paintPairDialog();
  }

  /** The freshly paired device, once the retained inventory has caught up. */
  _pairDevice() {
    const ieee = this._pairing.target;
    return ieee ? this._dev(ieee) : null;
  }

  _onPairDevices() {
    // A joined device appears in the inventory a moment after the event, which is
    // what fills in its model, endpoints and Home Assistant device id.
    if (this._pairing.open && this._pairing.target) this._paintPairDialog();
  }

  _pairStatusText() {
    const p = this._pairing;
    switch (p.phase) {
      case 'joined':
        return 'Device joined, interviewing';
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
      case 'timeout':
        return 'Nothing joined';
      default:
        return 'Ready';
    }
  }

  /* ------------------------------------------------------- the pair dialog */

  /**
   * The dialog element, made once and kept.
   *
   * It is deliberately NOT part of the panel's rendered markup. `_render()` writes
   * the whole shadow root in one go, which would tear the dialog down and take the
   * log scroll, the caret in the name field and HA's own open/close animation with
   * it. So the element is retained, re-hosted after each render, and its contents
   * are painted by `_paintPairDialog()` alone.
   *
   * `ha-dialog` is Home Assistant's own component: it brings the scrim, the focus
   * trap, Escape handling and the phone-width layout for free, which is exactly
   * why this is a dialog and not another full-page view. It is still OPTIONAL, in
   * the same way as every other HA component this panel uses -- on a cold load it
   * may not be defined yet, and then a plain sheet stands in for it.
   */
  _ensurePairDialog() {
    if (this._dialog && this._dialog.native === this._has('ha-dialog')) return this._dialog;

    if (this._dialog && this._dialog.el.parentNode) this._dialog.el.remove();

    const native = this._has('ha-dialog');
    const el = document.createElement(native ? 'ha-dialog' : 'div');
    const d = { el, native, painted: null, opened: false };
    if (native) {
      // No `hideActions`: the footer is where Home Assistant puts a dialog's buttons,
      // and using it is most of what makes this look native. The title is ours too --
      // `ha-dialog`'s `heading` attribute renders the close button and leaves the
      // text blank unless something fills the heading slot.
      //
      // `closed` also arrives while the component settles into its initial closed
      // state, before anything has been shown. Acting on that one shut the dialog the
      // instant it was asked for, so only a close that follows a real `opened` counts.
      el.addEventListener('opened', () => {
        d.opened = true;
      });
      // Escape and the scrim both mean "stop", which is what the close button means.
      el.addEventListener('closed', () => {
        if (!d.opened) return;
        d.opened = false;
        this._closePairDialog();
      });
    } else {
      el.className = 'pairdlg';
      el.setAttribute('role', 'dialog');
      el.setAttribute('aria-modal', 'true');
    }
    this._dialog = d;
    return this._dialog;
  }

  /** Put the retained dialog back after a render replaced the shadow root. */
  _hostPairDialog() {
    if (!this._pairing.open) return;
    const d = this._ensurePairDialog();
    if (d.el.parentNode !== this.shadowRoot) this.shadowRoot.appendChild(d.el);
  }

  async _openPairDialog() {
    this._resetPairing();
    const p = this._pairing;
    p.open = true;
    p.duration = PAIR_OPEN_SECONDS;
    const d = this._ensurePairDialog();
    this.shadowRoot.appendChild(d.el);
    this._paintPairDialog();
    if (d.native) d.el.open = true;
    this._startTicker();
    // Watching starts immediately; the radio waits for Start.
    await this._openPairing();
  }

  /**
   * Close the dialog, and with it the window and the subscriptions.
   *
   * Closing is the same event however it arrives -- the button, Escape, the scrim,
   * or navigating away -- so all of them land here.
   */
  _closePairDialog() {
    const p = this._pairing;
    if (!p.open) return;
    p.open = false;
    const d = this._dialog;
    if (d) {
      if (d.native) d.el.open = false;
      d.el.remove();
      d.painted = null;
    }
    this._leavePairing();
    this._startTicker();
    this._render();
  }

  /**
   * Paint the dialog's own contents.
   *
   * Memoised on the same principle as `_render()`: a 45-device mesh pushes retained
   * topics constantly, and repainting would fight the operator for the caret in the
   * name field. The log is patched separately by `_onPairLog`, so a new line does
   * not repaint the form.
   */
  _paintPairDialog() {
    if (!this._pairing.open) return;
    const d = this._ensurePairDialog();
    // Painting something that is not on the page is a no-op with extra steps, and a
    // render may have detached it a moment ago.
    this._hostPairDialog();
    const title = this._pairDialogTitle();
    const markup = d.native
      ? // Home Assistant's dialog exposes `headerTitle` and `footer` slots. Naming
        // them is what puts the title and the buttons in HA's own furniture instead
        // of leaving them as loose content in the body.
        `<span slot="headerTitle" class="dlg-title">${esc(title)}</span>
         <div class="dlg">${this._pairDialogBody()}</div>
         <div class="dlg-actions" slot="footer">${this._pairDialogActions()}</div>`
      : `<div class="pairdlg-scrim" data-act="pairclose"></div>
         <div class="pairdlg-sheet">
           <div class="pairdlg-head">
             <h2>${esc(title)}</h2>
             <button class="close" type="button" data-act="pairclose"
               aria-label="Close">&times;</button>
           </div>
           <div class="dlg">${this._pairDialogBody()}</div>
           <div class="dlg-actions">${this._pairDialogActions()}</div>
         </div>`;

    if (markup === d.painted) return;
    d.painted = markup;
    if (d.native) d.el.setAttribute('heading', title);
    d.el.innerHTML = markup;
    this._wire(d.el);
    this._scrollPairLog();
  }

  _pairDialogTitle() {
    const p = this._pairing;
    if (p.phase === 'successful') return 'Device added';
    if (p.phase === 'timeout') return 'Nothing joined';
    return 'Add a Zigbee device';
  }

  /** Routers the network can be joined through, coordinator first. */
  _pairRouters() {
    return this._devices
      .filter((d) => d.type === 'Coordinator' || d.type === 'Router')
      .map((d) => ({
        ieee: d.ieee_address,
        name: d.friendly_name || d.ieee_address,
        coordinator: d.type === 'Coordinator',
      }))
      .sort((a, b) =>
        a.coordinator === b.coordinator
          ? a.name.localeCompare(b.name)
          : a.coordinator
            ? -1
            : 1
      );
  }

  _pairDialogBody() {
    const p = this._pairing;
    return (
      (p.error ? `<ha-alert alert-type="error">${esc(p.error)}</ha-alert>` : '') +
      (p.notice ? `<ha-alert alert-type="success">${esc(p.notice)}</ha-alert>` : '') +
      this._pairStep() +
      this._pairLogBlock()
    );
  }

  /** The part of the dialog that changes with the phase. */
  _pairStep() {
    const p = this._pairing;
    if (p.phase === 'successful' || p.phase === 'failed') return this._pairResultStep();
    if (p.phase === 'joined' || p.phase === 'interview_started') return this._pairJoinedStep();
    if (p.ownsPermit || p.opening) return this._pairSearchingStep();
    if (p.phase === 'timeout') return this._pairTimeoutStep();
    return this._pairSetupStep();
  }

  /** Before the radio is touched: how to join, and for how long. */
  _pairSetupStep() {
    const p = this._pairing;
    const routers = this._pairRouters();
    const spec = this._formSpec('pair', () => ({
      schema: [],
      // 'any' rather than an empty string: an empty value renders as an empty select,
      // and "any router" is a real choice the operator makes, not the absence of one.
      data: { via: 'any', duration: String(PAIR_OPEN_SECONDS) },
      label: (s) => (s.name === 'via' ? 'Join through' : 'Open for'),
      helper: (s) =>
        s.name === 'via'
          ? 'A device that refuses to join often pairs first time through a router sitting next to it, instead of whichever one answers first from across the house.'
          : 'How long the network stays open. 254 seconds is Zigbee2MQTT\u2019s maximum.',
      changed: (data) => {
        p.via = data.via && data.via !== 'any' ? data.via : null;
        p.duration = Number(data.duration) || PAIR_OPEN_SECONDS;
      },
    }));
    // The router list is live: a device that joined a moment ago is a valid route now.
    spec.schema = [
      {
        name: 'via',
        selector: {
          select: {
            mode: 'dropdown',
            options: [{ value: 'any', label: 'Any router' }].concat(
              routers.map((r) => ({
                value: r.ieee,
                label: `${r.name}${r.coordinator ? ' (coordinator)' : ''}`,
              }))
            ),
          },
        },
      },
      {
        name: 'duration',
        selector: {
          select: {
            mode: 'dropdown',
            options: [60, 120, PAIR_OPEN_SECONDS].map((t) => ({
              value: String(t),
              label: t === PAIR_OPEN_SECONDS ? `${t} seconds (max)` : `${t} seconds`,
            })),
          },
        },
      },
    ];
    spec.data = { via: p.via || 'any', duration: String(p.duration) };

    return `<div class="dlg-lead">The network stays closed until you press Start. Have the
        device ready: joining is usually a long press, or power-cycling it a few times.</div>
      <ha-form data-form="pair"></ha-form>`;
  }

  /** The window is open and nothing has joined yet. */
  _pairSearchingStep() {
    const p = this._pairing;
    const left = this._pairingCountdown();
    const via = p.via ? (this._dev(p.via) || {}).friendly_name || p.via : null;
    return `<div class="pair-hero">
        <div class="pair-spin" aria-hidden="true"></div>
        <div>
          <strong>${p.opening ? 'Opening the network\u2026' : 'Searching for a device'}</strong>
          <div class="supporting">Put the device into pairing mode now.</div>
          ${via ? `<div class="supporting">Joining through ${esc(via)}.</div>` : ''}
        </div>
        <div class="pair-left" id="pairleft">${left === null ? '' : `${left}s`}</div>
      </div>`;
  }

  /** Nothing joined before the window closed. */
  _pairTimeoutStep() {
    const p = this._pairing;
    return `<ha-alert alert-type="warning">The window closed after ${esc(
      p.duration
    )} seconds and no device joined.</ha-alert>
      <div class="dlg-hint">Try again with the device held in pairing mode BEFORE you press
        the button, or join through a router closer to it.</div>
      ${this._pairSetupStep()}`;
  }

  /** A device is on the network and the interview is running. */
  _pairJoinedStep() {
    return `<div class="pair-hero">
        <div class="pair-spin" aria-hidden="true"></div>
        <div>
          <strong>${esc(this._pairStatusText())}</strong>
          <div class="supporting">Keep the device awake until this finishes.</div>
        </div>
      </div>
      ${this._pairIdentity()}`;
  }

  _pairIdentity() {
    const p = this._pairing;
    if (!p.target) return '';
    const dev = this._pairDevice();
    const definition = p.definition || {};
    const bits = [definition.vendor, definition.model].filter(Boolean).join(' ');
    return `<div class="pair-identity">
        <strong>${esc(
          (dev && dev.friendly_name) || (p.event && p.event.friendly_name) || p.target
        )}</strong>
        <code class="supporting">${esc(p.target)}</code>
        ${bits ? `<div class="supporting">${esc(bits)}</div>` : ''}
        ${
          definition.description
            ? `<div class="supporting">${esc(definition.description)}</div>`
            : ''
        }
      </div>`;
  }

  /**
   * Paired, or the interview failed.
   *
   * Naming and area are Home Assistant's own registry fields, applied through HA's
   * own websocket command. The Zigbee friendly name is Zigbee2MQTT's, and both are
   * set from this one form so the operator does not have to know that.
   */
  _pairResultStep() {
    const p = this._pairing;
    const done = p.phase === 'successful';
    const dev = this._pairDevice();

    return (
      `<div class="pair-hero${done ? ' ok' : ''}">
         <ha-svg-icon data-path="${done ? MDI.check : MDI.alert}"></ha-svg-icon>
         <div>
           <strong>${esc(this._pairStatusText())}</strong>
           ${
             done
               ? '<div class="supporting">The network is closed again.</div>'
               : '<div class="supporting">The device is on the network but incompletely known.</div>'
           }
         </div>
       </div>` +
      this._pairIdentity() +
      (p.supported === false && done
        ? `<ha-alert alert-type="warning">Zigbee2MQTT has no converter for this model, so it
           has no entities until one is added.</ha-alert>`
        : '') +
      (p.phase === 'failed'
        ? `<ha-alert alert-type="error">Re-interview it from its device page, or pair it
           closer to a mains-powered device.</ha-alert>`
        : '') +
      (done && p.target ? this._pairSetupForm(dev) : '')
    );
  }

  /**
   * Name and place the device that just joined.
   *
   * The area field is HA's own `area` selector, so it offers the same picker -- and
   * the same create-an-area affordance -- as every other Home Assistant screen,
   * instead of a list of areas this panel assembled itself.
   */
  _pairSetupForm(dev) {
    const p = this._pairing;
    const spec = this._formSpec(`pairsetup:${p.target}`, () => ({
      schema: [
        { name: 'name', selector: { text: {} } },
        { name: 'area', selector: { area: {} } },
      ],
      data: {
        name: (dev && dev.friendly_name) || (p.event && p.event.friendly_name) || '',
        area: (dev && dev.device_id && this._deviceArea(dev.device_id)) || undefined,
      },
      label: (s) => (s.name === 'name' ? 'Name' : 'Area'),
      helper: (s) =>
        s.name === 'name'
          ? 'Used for the Zigbee friendly name and the Home Assistant display name'
          : 'Where the device is, in Home Assistant\u2019s own areas',
    }));
    return (
      `<ha-form data-form="${esc(`pairsetup:${p.target}`)}"></ha-form>` +
      (p.setup.completed ? '<ha-alert alert-type="success">Saved.</ha-alert>' : '')
    );
  }

  /** The live log, which is the whole reason this is not a spinner in a corner. */
  _pairLogBlock() {
    const p = this._pairing;
    return `<div class="pair-logbox">
        <div class="pair-logtop">
          <span>Zigbee2MQTT log</span>
          <span class="header-actions">
            ${
              (this._summary || {}).log_level === 'debug'
                ? '<span class="chip ok">debug</span>'
                : ''
            }
            <ha-button appearance="plain" size="s" data-act="pairfollow"
              aria-pressed="${p.follow}">${p.follow ? 'Following' : 'Follow'}</ha-button>
          </span>
        </div>
        <div class="pair-log" id="pairlog">${this._pairLogRows()}</div>
        <div class="dlg-hint">Filtered to joining, interviewing and configuring. Routine
          traffic from devices already on the network is left out. Zigbee2MQTT is at debug
          while this window is open, and goes back on its own when you close it.</div>
      </div>`;
  }

  _pairDialogActions() {
    const p = this._pairing;
    const done = p.phase === 'successful';
    const searching = p.ownsPermit || p.opening;
    const btn = (act, label, kind, extra = '') =>
      `<ha-button appearance="${kind}" data-act="${act}"${extra}>${label}</ha-button>`;

    if (done) {
      return (
        btn('pairagain', 'Add another', 'plain') +
        (p.target
          ? btn(
              'pairsave',
              p.setup.saving ? 'Saving\u2026' : 'Save and close',
              'filled',
              p.setup.saving ? ' disabled' : ''
            )
          : btn('pairclose', 'Close', 'filled'))
      );
    }
    if (p.phase === 'failed') {
      return btn('pairagain', 'Add another', 'plain') + btn('pairclose', 'Close', 'filled');
    }
    // Interviewing: the device is already in, so there is nothing to stop but the
    // watching. Close is the only honest action.
    if (p.phase === 'joined' || p.phase === 'interview_started') {
      return btn('pairclose', 'Close', 'plain');
    }
    if (searching) {
      // Stop leaves the dialog up so the log is still readable; Close ends the whole
      // thing. Both shut the window, so neither can leave the network open behind a
      // screen that has gone away.
      return btn('pairclose', 'Close', 'plain') + btn('pairstop', 'Stop', 'filled');
    }
    return (
      btn('pairclose', 'Close', 'plain') +
      btn('pairstart', 'Start', 'filled', p.opening ? ' disabled' : '')
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
    const p = this._pairing;
    const spec = (this._forms || {})[`pairsetup:${p.target}`] || { data: {} };
    const name = String(spec.data.name || '').trim();
    const areaId = spec.data.area || null;
    if (!p.target) return;

    p.setup.saving = true;
    p.error = null;
    this._paintPairDialog();
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
      this._paintPairDialog();
      // Saving is the last step of adding a device, so a clean save is also the end
      // of the dialog. A partial save keeps it open, because there is something to
      // read: the name went to Zigbee2MQTT but Home Assistant has not caught up.
      if (p.setup.completed && !p.error) this._closePairDialog();
    }
  }

  /* ---------------------------------------------------------------- options */

  _optionsView() {
    const s = this._summary || {};
    const levels = LOG_LEVELS.map(
      (l) => `<ha-list-item value="${l}">${l}</ha-list-item>`
    ).join('');
    return (
      card(
        // A label with a control beside it is what `ha-settings-row` is for: it puts
        // the control under the label on a narrow screen instead of squeezing both
        // onto one line, which is what went wrong when this was a bare <select> in a
        // list row's trailing slot.
        `<ha-settings-row${this._narrow ? ' narrow' : ''}>
           <span slot="heading">Log level</span>
           <span slot="description">Applied to Zigbee2MQTT immediately; debug is very
             chatty</span>
           <ha-select id="loglevel" naturalMenuWidth fixedMenuPosition
             data-selected="loglevel" data-value="${esc(s.log_level || 'info')}">
             ${levels}
           </ha-select>
         </ha-settings-row>` +
        list(
            row({
              icon: MDI.plus,
              headline: 'Permit joining',
              text: s.permit_join
                ? 'Open. Any Zigbee device may join right now'
                : 'Closed. Devices cannot join',
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
      .map((l) => `<ha-list-item value="${l}">${l}</ha-list-item>`)
      .join('');
    return (
      `<ha-card class="nav-card">
        <div class="search">
          ${icon(MDI.logs, '')}
          <div class="grow">Minimum level</div>
          <ha-select id="logmin" naturalMenuWidth fixedMenuPosition
            data-selected="logmin" data-value="${esc(this._logMin || 'all')}">${levels}</ha-select>
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
    // Pairing's two choices are `ha-form` fields now, so they arrive through the
    // form's own value-changed rather than as a control-by-control change.
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

      // Opens the dialog only. The radio stays shut until Start.
      case 'pair':
        return this._openPairDialog();

      case 'pairstart':
        return this._startPairing();

      // Stop closes the window this helper opened, and leaves the dialog up so the
      // log is still readable: stopping the radio is not the same as walking away.
      case 'pairstop': {
        const p = this._pairing;
        this._closeJoinWindow();
        p.phase = p.target ? p.phase : 'idle';
        this._paintPairDialog();
        return undefined;
      }

      case 'pairclose':
        return this._closePairDialog();

      case 'pairagain': {
        // A second device in the same visit: new session, same open dialog, and the
        // same choices -- someone adding four sensors to one room should not have to
        // pick the same router four times.
        const { via, duration } = this._pairing;
        this._leavePairing();
        Object.assign(this._pairing, { open: true, via, duration });
        return this._openPairing();
      }

      case 'pairsave':
        return this._savePairSetup();

      // Explicit control, because the operator sometimes wants to READ a line
      // rather than watch the newest one arrive.
      case 'pairfollow': {
        this._pairing.follow = !this._pairing.follow;
        this._paintPairDialog();
        if (this._pairing.follow) this._scrollPairLog();
        return undefined;
      }

      case 'pairopen': {
        const paired = this._pairDevice();
        if (paired && paired.device_id) this._openHaDevice(paired.device_id);
        return undefined;
      }

      case 'groupadd': {
        const name = this._textValue('gcreate');
        if (!name) return undefined;
        return this._groupWrite('z2m/group/add', { name }, (res) => {
          // The field is cleared by dropping the form's state: the next render builds
          // it again from an empty value.
          delete this._forms.gcreate;
          if (res && res.id !== undefined) this._go({ name: 'group', group: res.id });
        });
      }

      case 'grouprename': {
        const group = this._view.group;
        const to = this._textValue(`grename:${group}`);
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

      case 'openbinds':
        return this._go({ name: 'binds', ieee: device });

      case 'bind': {
        const spec = (this._forms || {})[`bind:${this._binds.ieee}`];
        if (!spec) return undefined;
        const { endpoint, target, clusters } = spec.data;
        if (!target || !(clusters || []).length) {
          this._binds.error = 'Choose a target and at least one cluster first.';
          this._render();
          return undefined;
        }
        return this._bindWrite('z2m/device/bind', {
          from: this._binds.ieee,
          from_endpoint: Number(endpoint),
          ...this._bindTarget(target),
          clusters,
        });
      }

      case 'unbind':
        return this._bindWrite('z2m/device/unbind', {
          from: this._binds.ieee,
          from_endpoint: Number(el.dataset.endpoint),
          ...this._bindTarget(el.dataset.target),
          clusters: [el.dataset.cluster],
        });

      case 'configure':
        return this._act('z2m/device/configure', { device });

      case 'readvalues': {
        // The manual path exists for exactly two cases the automatic read skips:
        // battery devices, and "I just changed something at the wall, show me now".
        return this._call('z2m/device/read_values', { device: this._view.ieee })
          .then((res) => {
            this._feedMsg = (res && res.sleeping)
              ? 'Asked. A battery device answers at its next wake-up.'
              : 'Asked the device to report its current values.';
            this._render();
            setTimeout(() => { this._feedMsg = null; this._render(); }, 4000);
          })
          .catch((err) => {
            this._error = (err && (err.message || err.code)) || 'Could not ask the device';
            this._render();
          });
      }

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
        const to = this._textValue(`rename:${device}`);
        if (!to || to === d.friendly_name) return undefined;
        return this._act('z2m/device/rename', { from: d.friendly_name, to });
      }

      case 'options': {
        // The form holds the operator's edits; only what actually differs from the
        // device's current values is written, so Save on an untouched form is a no-op
        // rather than a pointless write to every option.
        const spec = (this._forms || {})[`opts:${device}`];
        if (!spec) return undefined;
        const current = d.option_values || {};
        const options = {};
        Object.entries(spec.data || {}).forEach(([k, v]) => {
          if (v === undefined || v === null || v === '') return;
          if (String(current[k]) === String(v)) return;
          options[k] = v;
        });
        if (!Object.keys(options).length) return undefined;
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

// Guarded, because this module can legitimately be evaluated twice: Home Assistant
// caches panel modules per URL, but a scoped custom-element registry (and a soft
// re-navigation to /z2m) can re-run it, and a bare define() then throws
// "the name z2m-panel has already been used with this registry" -- which was
// observed in the live log and leaves the operator on a dead page.
if (!customElements.get('z2m-panel')) {
  customElements.define('z2m-panel', Z2MPanel);
}
