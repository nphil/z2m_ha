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
  close: 'M19,6.41L17.59,5L12,10.59L6.41,5L5,6.41L10.59,12L5,17.59L6.5,19L12,13.41L17.59,19L19,17.59L13.41,12L19,6.41Z',
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
  // Settings-card editors: a switch is common enough to be worth waiting for, and
  // the converter-options/diagnostic groups and every composite row collapse behind
  // ha-expansion-panel, so it earns the same late-upgrade treatment as the rest.
  'ha-switch',
  'ha-expansion-panel',
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
const PAIR_LOG_MAX = 200;
// Longest text a reading tile shows before it is trimmed and the rest moves to the
// tooltip. Numbers never reach this; converters that pack a structure into one
// state do, and HA truncates those at 255 characters anyway.
const SENS_TEXT_MAX = 28;

const esc = (s) =>
  String(s ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );

/**
 * Straighten what a phone keyboard curls.
 *
 * iOS and Android substitute typographic punctuation as you type, so a name
 * entered on a phone arrives as "Isabel\u2019s Lamp" while the same name typed on a
 * desktop is "Isabel's Lamp". That single invisible difference forks in three
 * places at once: Zigbee2MQTT keys the MQTT topic AND its state cache on the
 * string, Home Assistant slugifies it into entity ids (isabels_ versus
 * isabel_s_), and a name that matches an area creates a SECOND area rather than
 * joining the existing one. Normalising on the way in is the only cheap moment.
 *
 * Non-breaking spaces are included because they are invisible in a name field and
 * survive into topics, where they are impossible to spot afterwards.
 */
const typedName = (s) =>
  String(s ?? '')
    .replace(/[\u2018\u2019\u201a\u201b\u02bc\u2032]/g, "'")
    .replace(/[\u201c\u201d\u201e\u201f\u2033]/g, '"')
    .replace(/[\u2013\u2014\u2212]/g, '-')
    .replace(/\u2026/g, '...')
    .replace(/[\u00a0\u2007\u202f]/g, ' ')
    .trim();

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

/* Exposes of these types are already represented by an HA entity on the Controls
 * card, so their whole feature subtree is invisible to the Settings classifier
 * (§3.2.1): a plain Set stays a constant-time lookup instead of an array scan on
 * every device page render. */
/* light gets narrower treatment (§2.1 amendment): only these five feature
 * names are excluded from Settings; the composite's other features (e.g.
 * `color_temp_startup`) are ordinary Settings rows, one level up. */
const SETTINGS_CONTROL_TYPES = new Set(['switch', 'lock', 'cover', 'climate', 'fan']);
const LIGHT_CONTROL_FEATURES = new Set(['state', 'brightness', 'color_temp', 'color_xy', 'color_hs']);

/**
 * Zigbee2MQTT hands a converter-authored setting a label by titlecasing the raw
 * property (`DimmingSpeedUpRemote`), while a hand-written one already reads as a
 * sentence ("Energy reset"). This only touches the first kind: a label with no
 * spaces but an interior capital is split before each capital, every word but the
 * first is lowercased, and a run that is ALL CAPS (an acronym) is left alone.
 */
const deCamel = (s) => {
  const str = String(s || '');
  if (!str || /\s/.test(str) || !/[A-Z]/.test(str.slice(1))) return str;
  const words = str
    .replace(/([a-z0-9])([A-Z])/g, '$1\u0000$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1\u0000$2')
    .split('\u0000');
  return words
    .map((w, i) => {
      if (/^[A-Z]+$/.test(w)) return w;
      return i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w.toLowerCase();
    })
    .join(' ');
};

/**
 * One button, gated the same way as every other settings editor: HA's own
 * component when it is registered, a plain button when it is not.
 */
const ctlButton = (label, attrs, appearance) =>
  customElements.get('ha-button')
    ? `<ha-button appearance="${appearance || 'plain'}" size="s"${attrs || ''}>${esc(
        label
      )}</ha-button>`
    : `<button type="button" class="fallback-btn"${attrs || ''}>${esc(label)}</button>`;

/** Chip text and colour class for every write/value state that is not silence. */
const SETTINGS_CHIP = {
  notread: ['Not read yet', ''],
  notreported: ['Not reported yet', ''],
  writeonly: ['Write only', ''],
  pending: ['Sending\u2026', ''],
  confirmed: ['Saved', 'ok'],
  sent: ['Sent', 'ok'],
  queued: ['At next wake-up', 'warn'],
  unconfirmed: ['No reply', 'warn'],
  failed: ['Failed', 'off'],
};

/* --------------------------------------------------------- light: colour math */
//
// Every function below is normative from the light/colour specification's §4.8:
// the anchors, the matrices, and the gamma constants are copied verbatim, not
// approximated. Kept as plain functions (not methods) because none of them
// touch panel state -- they are exercised through the rendered swatches, hex
// readouts and write payloads the same way the rest of this file is tested.

const clamp255 = (n) => Math.max(0, Math.min(255, Math.round(n)));

const hexToRgb = (hex) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return { r: 0, g: 0, b: 0 };
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
};
const rgbToHex = (r, g, b) =>
  `#${[r, g, b].map((c) => clamp255(c).toString(16).padStart(2, '0')).join('')}`;

/** HSV with h in 0-360, s/v in 0-1; returns 0-255 channels. */
const hsvToRgb = (h, s, v) => {
  const hue = ((h % 360) + 360) % 360;
  const c = v * s;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = v - c;
  const [r, g, b] =
    hue < 60 ? [c, x, 0]
    : hue < 120 ? [x, c, 0]
    : hue < 180 ? [0, c, x]
    : hue < 240 ? [0, x, c]
    : hue < 300 ? [x, 0, c]
    : [c, 0, x];
  return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 };
};
const rgbToHsv = (r, g, b) => {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === rn) h = 60 * (((gn - bn) / d) % 6);
    else if (max === gn) h = 60 * ((bn - rn) / d + 2);
    else h = 60 * ((rn - gn) / d + 4);
  }
  if (h < 0) h += 360;
  return { h, s: max === 0 ? 0 : d / max, v: max };
};
const hsToHex = (hue, sat) => {
  const rgb = hsvToRgb(hue, (sat || 0) / 100, 1);
  return rgbToHex(rgb.r, rgb.g, rgb.b);
};

const gammaEncode = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
const gammaDecode = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

/** xy -> RGB (displaying xy-mode state): Y=1, sRGB D65 matrix, negatives
 * clamped to 0, scaled so the max channel is 1, then gamma-encoded. No
 * per-vendor gamut: the bulb's own clamping is what the echo shows. */
const xyToRgb = (x, y) => {
  if (!y) return { r: 0, g: 0, b: 0 };
  const X = x / y;
  const Y = 1;
  const Z = (1 - x - y) / y;
  let r = Math.max(0, 3.2406 * X - 1.5372 * Y - 0.4986 * Z);
  let g = Math.max(0, -0.9689 * X + 1.8758 * Y + 0.0415 * Z);
  let b = Math.max(0, 0.0557 * X - 0.204 * Y + 1.057 * Z);
  const max = Math.max(r, g, b, 1e-9);
  r /= max;
  g /= max;
  b /= max;
  return { r: clamp255(gammaEncode(r) * 255), g: clamp255(gammaEncode(g) * 255), b: clamp255(gammaEncode(b) * 255) };
};
const xyToHex = (x, y) => {
  const rgb = xyToRgb(x, y);
  return rgbToHex(rgb.r, rgb.g, rgb.b);
};

/** hs -> xy, for writing to xy-only bulbs: hsv -> sRGB -> linear -> XYZ -> xy,
 * rounded to 4 decimals. */
const hsToXy = (hue, sat) => {
  const rgb = hsvToRgb(hue, (sat || 0) / 100, 1);
  const r = gammaDecode(rgb.r / 255);
  const g = gammaDecode(rgb.g / 255);
  const b = gammaDecode(rgb.b / 255);
  const X = 0.4124 * r + 0.3576 * g + 0.1805 * b;
  const Y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const Z = 0.0193 * r + 0.1192 * g + 0.9505 * b;
  const sum = X + Y + Z || 1e-9;
  return { x: Math.round((X / sum) * 10000) / 10000, y: Math.round((Y / sum) * 10000) / 10000 };
};

/** Kelvin -> RGB, two piecewise-linear tables (§4.8). `swatchRGB` is the
 * honest blackbody chromaticity; `trackRGB` matches it up to 5000 K, then
 * bends toward a cool direction cue that real bulb light does not actually
 * reach. Deliberate, and the two tables must stay separate. */
const KELVIN_SWATCH_STOPS = [
  [2000, '#ff890e'], [2200, '#ff9227'], [2700, '#ffa757'], [3000, '#ffb16e'],
  [3500, '#ffc18d'], [4000, '#ffcea6'], [4500, '#ffdabb'], [5000, '#ffe4ce'],
  [5500, '#ffedde'], [6500, '#fffefa'],
];
const KELVIN_TRACK_STOPS = [
  [2000, '#ff890e'], [2200, '#ff9227'], [2700, '#ffa757'], [3000, '#ffb16e'],
  [3500, '#ffc18d'], [4000, '#ffcea6'], [4500, '#ffdabb'], [5000, '#ffe4ce'],
  [5500, '#f4e5de'], [6000, '#e8e5ef'], [6500, '#dde6ff'],
];
/**
 * Interpolated in MIRED space, not kelvin space: the whole point of this
 * track is "mired-linear, not kelvin-linear" (§4.6), and a table walked in
 * kelvin would reintroduce exactly the non-perceptual spacing that decision
 * exists to avoid. Anchors are still labelled by kelvin (the table above,
 * and every caller) because kelvin is what the operator reads.
 */
const interpKelvinStops = (stops, kelvin) => {
  const mired = 1e6 / kelvin;
  const first = stops[0];
  if (mired >= 1e6 / first[0]) return hexToRgb(first[1]);
  const last = stops[stops.length - 1];
  if (mired <= 1e6 / last[0]) return hexToRgb(last[1]);
  for (let i = 1; i < stops.length; i += 1) {
    const [k1, hex1] = stops[i - 1];
    const [k2, hex2] = stops[i];
    const m1 = 1e6 / k1;
    const m2 = 1e6 / k2;
    if (mired < m2) continue;
    const t = (m1 - mired) / (m1 - m2);
    const c1 = hexToRgb(hex1);
    const c2 = hexToRgb(hex2);
    return { r: c1.r + (c2.r - c1.r) * t, g: c1.g + (c2.g - c1.g) * t, b: c1.b + (c2.b - c1.b) * t };
  }
  return hexToRgb(last[1]);
};
const swatchRGB = (kelvin) => interpKelvinStops(KELVIN_SWATCH_STOPS, kelvin);
const trackRGB = (kelvin) => interpKelvinStops(KELVIN_TRACK_STOPS, kelvin);
const swatchHex = (kelvin) => {
  const c = swatchRGB(kelvin);
  return rgbToHex(c.r, c.g, c.b);
};

/** Display kelvin rounds to the nearest 100; writes stay exact mireds. */
const miredToKelvinDisplay = (mired) => Math.round(1e6 / mired / 100) * 100;
const kelvinToMired = (kelvin) => Math.round(1e6 / kelvin);

/** Hue names (§4.8), for the state line, aria text, adjusted chips, and the
 * L editor's meta fallback. Saturation under 15 always reads White. */
const HUE_NAME_RANGES = [
  [345, 360, 'Red'], [0, 15, 'Red'], [15, 40, 'Orange'], [40, 70, 'Yellow'],
  [70, 150, 'Green'], [150, 200, 'Cyan'], [200, 255, 'Blue'], [255, 290, 'Purple'],
  [290, 330, 'Magenta'], [330, 345, 'Pink'],
];
const hueName = (hue, sat) => {
  if (sat !== undefined && sat !== null && sat < 15) return 'White';
  const h = ((Number(hue) % 360) + 360) % 360;
  const hit = HUE_NAME_RANGES.find(([lo, hi]) => h >= lo && h < hi);
  return hit ? hit[2] : 'Red';
};

/** Brightness wire<->display (§4.4), roundtrip-stable at 25/50/75/100. */
const brightnessMax = (expose) => (expose && expose.value_max !== undefined ? expose.value_max : 254);
const brightnessToPct = (wire, max) => Math.max(1, Math.round((wire / max) * 100));
const pctToBrightness = (pct, max) => Math.max(1, Math.min(max, Math.round((pct * max) / 100)));
const BRIGHTNESS_CHIPS = [25, 50, 75, 100];

/** Temperature position<->mired (§4.6): position space is 0-1000, warm at 0. */
const tempPositionToMired = (pos, min, max) => Math.round(max + (min - max) * (pos / 1000));
const miredToTempPosition = (mired, min, max) => Math.round(((mired - max) / (min - max)) * 1000);

/** Curated commercial temperature presets (§4.6), independent of whatever a
 * converter's own `presets` array happens to call warm/cool. */
const TEMP_CHIPS = [
  { name: 'Candle', kelvin: 2000, dot: '#ff890e' },
  { name: 'Warm', kelvin: 2700, dot: '#ffa757' },
  { name: 'Neutral', kelvin: 4000, dot: '#ffcea6' },
  { name: 'Cool', kelvin: 5000, dot: '#ffe4ce' },
  { name: 'Daylight', kelvin: 6500, dot: '#dde6ff' },
];

/** The nine canonical Inovelli LED-colour detents (§5.2), independent of a
 * row's own `presets` array (which supplies names, not the detent points). */
const L_DETENTS = [0, 21, 42, 85, 127, 170, 212, 234, 255];
const l255ToDeg = (v) => (v / 255) * 360;

/** Capitalizes the first letter only: converter preset names arrive lowercase
 * ("coolest", "cool"), and this is what "sentence-cased" (§5.1/§5.3) means for
 * a single word. Never forces the rest lower, so an embedded acronym survives. */
const sentenceCase = (s) => {
  const str = String(s || '');
  return str ? str.charAt(0).toUpperCase() + str.slice(1) : str;
};

/** Editor M's wire encoding (§6.3), verbatim from the expose description:
 * 1-60 seconds; 61-120 minutes (v-60); 121-254 hours (v-120); 255 indefinite. */
const DURATION_UNITS = ['Seconds', 'Minutes', 'Hours', 'Forever'];
const durationDecode = (wire) => {
  const v = Number(wire);
  if (v === 255) return { unit: 'Forever', val: 0 };
  if (v >= 61 && v <= 120) return { unit: 'Minutes', val: v - 60 };
  if (v >= 121 && v <= 254) return { unit: 'Hours', val: v - 120 };
  return { unit: 'Seconds', val: Math.max(0, v) };
};
const durationEncode = (unit, val) => {
  const n = Math.max(0, Math.round(Number(val) || 0));
  if (unit === 'Forever') return 255;
  if (unit === 'Minutes') return 60 + n;
  if (unit === 'Hours') return 120 + n;
  return n;
};
const durationHuman = (wire) => {
  const v = Number(wire);
  if (v === 255) return 'until cleared';
  const { unit, val } = durationDecode(v);
  if (unit === 'Hours') return `${val} h`;
  if (unit === 'Minutes') return `${val} min`;
  return `${val} s`;
};
const durationBounds = (unit) => (unit === 'Hours' ? { min: 1, max: 134 } : { min: 1, max: 60 });

/* The coordinator board's own entities, owned by the smlight integration. Hardcoded
 * ids on purpose: this panel manages one household's mesh, and the card simply skips
 * whatever Home Assistant does not currently provide. */
const COORD_HOST = 'The SLZB coordinator at 192.168.1.104';
const COORD_SENSORS = [
  ['sensor.z_coordinator_core_chip_temp', 'Core chip temp'],
  ['sensor.z_coordinator_zigbee_chip_temp', 'Zigbee chip temp'],
  ['sensor.z_coordinator_zigbee_chip_temp_2', 'Zigbee chip temp 2'],
  ['sensor.z_coordinator_core_uptime', 'Core uptime'],
  ['sensor.z_coordinator_zigbee_uptime', 'Zigbee uptime'],
  ['sensor.z_coordinator_ram_usage', 'RAM usage'],
];
/* The coordinator card shows its chip temperatures in Celsius regardless of the
 * household's unit system: these are electronics thermals read against datasheet
 * limits quoted in C, and the operator asked for C here specifically, without
 * re-uniting the entities across the rest of Home Assistant. */
const COORD_CELSIUS = new Set(COORD_SENSORS.map(([eid]) => eid).filter((e) => e.includes('_temp')));
const COORD_BINARY = [
  ['binary_sensor.z_coordinator_ethernet', 'Ethernet'],
  ['binary_sensor.z_coordinator_internet', 'Internet'],
];
const COORD_MODE = 'sensor.z_coordinator_connection_mode';
const COORD_FIRMWARE = [
  ['update.z_coordinator_core_firmware', 'Core firmware'],
  ['update.z_coordinator_zigbee_firmware', 'Zigbee firmware'],
  ['update.z_coordinator_z_wave_firmware', 'Z-Wave firmware'],
];
const COORD_SWITCHES = [
  ['switch.z_coordinator_disable_leds', 'Disable LEDs'],
  ['switch.z_coordinator_led_night_mode', 'LED night mode'],
];

/* Panel routing (round 2). Every top-level view maps to one path segment under
 * this panel's own /z2m root, so the browser's address bar -- and its
 * Back/Forward buttons -- walk the same history a tap through the UI would.
 * `options` keeps its internal view name (it is what _bodyFor's switch and
 * every existing `_go({name:'options'})` call already say) but is addressed
 * as /z2m/settings: "Options" is the page title, "Settings" is what belongs
 * in a URL that now sits next to a per-device Settings card of its own. */
const ROUTE_PATH = {
  dashboard: () => '',
  devices: () => 'devices',
  device: (v) => `device/${encodeURIComponent(v.ieee)}`,
  groups: () => 'groups',
  group: (v) => `group/${encodeURIComponent(v.group)}`,
  map: () => 'map',
  diagnostics: () => 'diagnostics',
  options: () => 'settings',
  logs: () => 'logs',
  ota: () => 'ota',
  network: () => 'network',
  binds: (v) => `binds/${encodeURIComponent(v.ieee)}`,
  bindsall: () => 'bindsall',
};

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
    // Recorded on every keystroke in the devices search box (§5.2): the source of
    // truth for the caret when a real push forces a full re-render mid-word, since
    // a freshly focused web-component host's own selectionStart cannot be trusted.
    this._filterCaret = null;
    // Same idea, for the Settings card's own filter box (§3.6).
    this._setFilterCaret = null;
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

    // Settings card (§3): state values arrive over z2m/device/state/subscribe and
    // are never baked into _markup (§1) -- everything below is keyed by ieee and
    // patched onto the page by _syncSettings, never rendered into the page string.
    this._settingsState = {}; // ieee -> merged property map from the state mirror
    // ieee -> a message, while the devstate subscribe promise is rejected: the
    // light block's own card-scoped feed alert and degraded path (§4.10).
    this._deviceStateError = {};
    // ieee -> { n -> {phase, message, token} }: the light block's own write
    // lifecycle (§4.9), separate from Settings' because the block shows one
    // chip per block, not one per control.
    this._lightWrite = {};
    this._lightCache = {}; // ieee -> { n -> last-painted block HTML }, for _syncLight's diff
    this._lightUI = {}; // ieee -> { n -> {editing: 'bright'|'temp'|'hex'|null} }, hex/readout tap-to-edit
    this._settingsWrite = {}; // ieee -> { rowKey -> {phase, message, echoed, token} }
    this._settingsDraft = {}; // ieee -> { compositeKey -> {featureProp -> value} }
    this._settingsOpen = {}; // ieee -> { groupKey -> expanded }, kept for the session
    this._settingsFilterOpen = {}; // ieee -> Set of group keys the filter itself opened
    this._settingsConfirming = {}; // `${ieee}|${prop}` -> confirm-window timeout id
    this._settingsReading = {}; // ieee -> true while Read from device is in flight
    this._settingsCache = {}; // ieee -> {ctl, meta} last-painted HTML, for _syncSettings' diff
    this._settingsListDraft = {}; // `${ieee}|${rowKey}` -> in-progress array, editor I
    // The Settings card's own filter text (§3.6). Kept apart from the devices
    // list's _filter: the two boxes are never open at once, but sharing one field
    // would make that coincidence load-bearing instead of incidental.
    this._setFilter = '';

    this._diag = {
      // The coordinator's routing table.
      checked: false,
      checking: false,
      routers: null,
      error: null,
      // Zigbee2MQTT's retained health report: { received_at, health }.
      mesh: null,
      meshLoaded: false,
      meshError: null,
      // The on-demand z2m/health_check verdict, shown as a chip.
      verify: null,
      verifying: false,
      // Channel energy scans: the saved records, and the run in flight.
      scans: null,
      scansLoaded: false,
      scansError: null,
      scanSel: null,
      scan: { running: false, confirm: false, stage: 'idle', detail: null, error: null },
    };
    this._energyTimer = null;
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
      // The mesh-wide edge list: what controls what, in both directions.
      overview: null,
      busy: false,
    };
    this._bindsAll = {
      loading: false,
      error: null,
      data: null,
      // The overview's own create form: which device will be the source, and that
      // device's endpoint/cluster projection once it has been read.
      create: false,
      source: null,
      clusters: null,
      clustersError: null,
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
      const [clusters, binds, overview] = await Promise.all([
        this._call('z2m/device/clusters', { device: ieee }),
        this._call('z2m/device/binds', { device: ieee }),
        this._call('z2m/binds/overview'),
      ]);
      if (this._binds.ieee !== ieee) return;
      b.clusters = clusters;
      b.binds = binds;
      b.overview = overview;
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
      const [clusters, binds, overview] = await Promise.all([
        this._call('z2m/device/clusters', { device: ieee }),
        this._call('z2m/device/binds', { device: ieee }),
        this._call('z2m/binds/overview'),
      ]);
      if (this._binds.ieee !== ieee) return;
      this._binds.clusters = clusters;
      this._binds.binds = binds;
      this._binds.overview = overview;
    } catch (_) {
      /* the write already reported its own outcome; a stale list is not a new error */
    }
    this._render();
  }

  async _openBindsAll() {
    const s = this._bindsAll;
    if (s.loading) return;
    s.loading = true;
    s.error = null;
    this._render();
    try {
      s.data = await this._call('z2m/binds/overview');
    } catch (err) {
      s.error = this._feedMessage(err, 'Could not read the mesh\u2019s bindings');
    } finally {
      s.loading = false;
      this._render();
    }
  }

  /** Clusters as capabilities a person can read: "On/off, Brightness". */
  _caps(clusters) {
    return (clusters || []).map((c) => CLUSTER_NAMES[c] || c).join(', ');
  }

  /** A bind target as a name, never an address, with its kind only when it matters. */
  _targetPhrase(t) {
    if (!t) return 'an unknown target';
    if (t.type === 'group') {
      if (t.default_bind_group) return 'Zigbee2MQTT\u2019s default group';
      return `${t.name || `Group ${t.id}`} (group)`;
    }
    if (t.coordinator) return 'Zigbee2MQTT';
    return `${t.name || t.ieee_address}${t.name === null ? ' (no longer on the network)' : ''}`;
  }

  /**
   * Merge raw one-cluster edges into one row per source-target pair, which is the
   * unit the operator thinks in: "the remote controls the kitchen lights", not four
   * separate cluster rows. Cluster order follows Z2M's candidate order.
   */
  _mergeEdges(edges) {
    const byKey = new Map();
    for (const e of edges) {
      const t = e.target || {};
      const tKey = t.type === 'group' ? `g:${t.id}` : `d:${t.ieee_address}:${t.endpoint}`;
      const key = `${e.source.ieee_address}|${e.source.endpoint}|${tKey}`;
      if (!byKey.has(key)) byKey.set(key, { source: e.source, target: t, clusters: [] });
      if (!byKey.get(key).clusters.includes(e.cluster)) byKey.get(key).clusters.push(e.cluster);
    }
    return [...byKey.values()];
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
    const name = d.friendly_name || ieee;
    const raw = (b.binds.binds || []).map((x) => ({
      source: { ieee_address: ieee, name, endpoint: x.endpoint },
      cluster: x.cluster,
      target: x.target,
    }));
    const merged = this._mergeEdges(raw);
    const controls = merged.filter((e) => !(e.target || {}).coordinator);
    const reports = merged.filter((e) => (e.target || {}).coordinator);
    const multiEp = new Set(raw.map((e) => e.source.endpoint)).size > 1;

    // Incoming edges: who controls THIS device. Only the overview knows.
    const incoming = this._mergeEdges(
      ((b.overview || {}).edges || []).filter(
        (e) => (e.target || {}).type === 'endpoint' && e.target.ieee_address === ieee
      )
    );

    const controlRow = (e, removable) => {
      const t = e.target || {};
      const from = multiEp ? ` from endpoint ${e.source.endpoint}` : '';
      return row({
        icon: MDI.link,
        headline: `Sends ${esc(this._caps(e.clusters))} to ${esc(this._targetPhrase(t))}`,
        text: `Radio to radio${from}. Works even when Home Assistant is down.`,
        end: removable
          ? `<ha-button slot="end" appearance="plain" size="s" data-act="unbind"
               data-from="${esc(e.source.ieee_address)}"
               data-endpoint="${esc(String(e.source.endpoint))}"
               data-clusters="${esc(e.clusters.join(','))}"
               data-target="${esc(
                 t.type === 'group' ? `g:${t.id}` : `d:${t.ieee_address}:${t.endpoint}`
               )}">Remove</ha-button>`
          : undefined,
      });
    };

    const controlsCard = `<ha-card class="nav-card">
        <div class="card-header">This device controls</div>
        <div class="note">A bind sends commands straight to the other device, radio to
        radio, so it keeps working when Home Assistant is down and it responds faster.</div>
        <div class="card-content">${
          controls.length
            ? list(controls.map((e) => controlRow(e, true)).join(''))
            : '<div class="empty">Nothing yet. Add one below.</div>'
        }</div>
      </ha-card>`;

    const controlledCard = incoming.length
      ? `<ha-card class="nav-card">
          <div class="card-header">Controlled by</div>
          <div class="card-content">${list(
            incoming
              .map((e) =>
                row({
                  icon: MDI.link,
                  headline: `${esc(e.source.name || e.source.ieee_address)} sends ${esc(
                    this._caps(e.clusters)
                  )} to this device`,
                  end: `<ha-button slot="end" appearance="plain" size="s" data-act="unbind"
                          data-from="${esc(e.source.ieee_address)}"
                          data-endpoint="${esc(String(e.source.endpoint))}"
                          data-clusters="${esc(e.clusters.join(','))}"
                          data-target="d:${esc(ieee)}:${esc(String(e.target.endpoint))}"
                        >Remove</ha-button>`,
                })
              )
              .join('')
          )}</div>
        </ha-card>`
      : '';

    const reportsCard = reports.length
      ? `<ha-card class="nav-card">
          <div class="card-header">Reports to Zigbee2MQTT</div>
          <div class="note">These keep Home Assistant updated: the device sends its state
          changes to the coordinator. They are created automatically and removing one
          stops those updates.</div>
          <div class="card-content">${list(
            reports
              .map((e) =>
                row({
                  icon: MDI.info,
                  headline: `Sends ${esc(this._caps(e.clusters))}${
                    multiEp ? ` from endpoint ${esc(String(e.source.endpoint))}` : ''
                  }`,
                  end: `<ha-button slot="end" appearance="plain" size="s" data-act="unbind"
                          data-guard="report"
                          data-from="${esc(e.source.ieee_address)}"
                          data-endpoint="${esc(String(e.source.endpoint))}"
                          data-clusters="${esc(e.clusters.join(','))}"
                          data-target="d:${esc(e.target.ieee_address)}:${esc(
                            String(e.target.endpoint)
                          )}">Remove</ha-button>`,
                })
              )
              .join('')
          )}</div>
        </ha-card>`
      : '';

    return (
      (b.notice ? `<ha-alert alert-type="success">${esc(b.notice)}</ha-alert>` : '') +
      (b.failed.length
        ? `<ha-alert alert-type="warning">Zigbee2MQTT reported the bind as done, but these
           clusters were refused: ${esc(b.failed.map(clusterLabel).join(', '))}. That usually
           means the device does not speak them, or it was asleep.</ha-alert>`
        : '') +
      controlsCard +
      this._bindCreateCard(endpoints) +
      controlledCard +
      reportsCard
    );
  }
  /**
   * The endpoint / cluster / target selectors, shared verbatim by the device page
   * and the mesh overview: the overview only puts a source picker in front of them.
   * `overview` supplies every device's accepted clusters, so only targets that can
   * take what is being sent are offered.
   */
  _bindCreateFields(ieee, endpoints, overview) {
    const bindable = (endpoints || []).filter((ep) => (ep.bindable || []).length);
    if (!bindable.length) {
      return `<div class="note">None of this device\u2019s endpoints expose a cluster that can be
         bound. Sensors that only report values are the usual case.</div>`;
    }

    // An endpoint means nothing as a number, so it is described by what it can send.
    const epLabel = (ep) => {
      const sends = (ep.output || []).filter((c) => (ep.bindable || []).includes(c));
      const what = this._caps(sends.length ? sends : ep.bindable);
      return `Endpoint ${ep.endpoint}${what ? ` (${what})` : ''}${
        ep.name && ep.name !== String(ep.endpoint) ? `, ${ep.name}` : ''
      }`;
    };

    const key = `bind:${ieee}`;
    const spec = this._formSpec(key, () => ({
      schema: [],
      data: { endpoint: String(bindable[0].endpoint), target: '', clusters: [] },
      label: (s) =>
        ({ endpoint: 'From', target: 'To', clusters: 'Send' })[s.name],
      helper: (s) =>
        ({
          endpoint: 'The side of this device whose commands will be sent',
          target: 'The device or group that should follow it',
          clusters: 'What gets sent. Only what both sides speak is offered',
        })[s.name],
    }));

    const chosen =
      bindable.find((ep) => String(ep.endpoint) === String(spec.data.endpoint)) || bindable[0];

    // Offer only targets that can actually accept what is being sent: the overview
    // knows every device's accepted clusters. Groups accept anything their members
    // speak, so they are always offered.
    const chosenClusters = (spec.data.clusters || []).length
      ? spec.data.clusters
      : chosen.bindable || [];
    const targets = [];
    (this._groups || []).forEach((g) => {
      targets.push({ value: `g:${g.id}`, label: `${g.friendly_name || `Group ${g.id}`} (group)` });
    });
    const capDevices = ((overview || {}).devices || []);
    capDevices.forEach((dev) => {
      if (dev.ieee_address === ieee) return;
      const eps = (dev.endpoints || []).filter((ep) =>
        (ep.accepts || []).some((c) => chosenClusters.includes(c)));
      eps.forEach((ep) => {
        targets.push({
          value: `d:${dev.ieee_address}:${ep.endpoint}`,
          label: `${dev.name || dev.ieee_address}${
            eps.length > 1 ? `, endpoint ${ep.endpoint} (${this._caps(ep.accepts)})` : ''
          }`,
        });
      });
    });

    spec.schema = [
      ...(bindable.length > 1
        ? [{
            name: 'endpoint',
            selector: {
              select: {
                mode: 'dropdown',
                options: bindable.map((ep) => ({
                  value: String(ep.endpoint),
                  label: epLabel(ep),
                })),
              },
            },
          }]
        : []),
      {
        name: 'clusters',
        selector: {
          select: {
            multiple: true,
            options: (chosen.bindable || []).map((c) => ({ value: c, label: clusterLabel(c) })),
          },
        },
      },
      {
        name: 'target',
        selector: { select: { mode: 'dropdown', options: targets } },
      },
    ];

    return `<div class="card-content pad"><ha-form data-form="${esc(key)}"></ha-form></div>
        <div class="note">A sleeping battery device cannot be bound until it wakes, so a
        refusal here often just means "try again while pressing a button on it".</div>
        <div class="actions">
          <ha-button appearance="filled" size="s" data-act="bind" data-source="${esc(ieee)}"${
            this._binds.busy ? ' disabled' : ''
          }>${this._binds.busy ? 'Binding\u2026' : 'Bind'}</ha-button>
        </div>`;
  }

  _bindCreateCard(endpoints) {
    const b = this._binds;
    return `<ha-card class="nav-card">
        <div class="card-header">Add a binding</div>
        <div class="note">Reads as a sentence: this device sends the chosen commands to
        the target, directly over the radio.</div>
        ${this._bindCreateFields(b.ieee, endpoints, b.overview)}
      </ha-card>`;
  }

  /* ------------------------------------------------- mesh-wide bindings view */

  _bindsAllView() {
    const s = this._bindsAll;
    if (s.error) {
      return `<ha-alert alert-type="error">${esc(s.error)}</ha-alert>`;
    }
    if (!s.data) return card('<div class="note">Reading the mesh\u2019s bindings\u2026</div>');

    const merged = this._mergeEdges(s.data.edges || []);
    const controls = merged.filter((e) => !(e.target || {}).coordinator);
    const reports = merged.filter((e) => (e.target || {}).coordinator);
    const epCount = Object.fromEntries(
      (s.data.devices || []).map((d) => [d.ieee_address, (d.endpoints || []).length])
    );

    const bySource = new Map();
    controls.forEach((e) => {
      const k = e.source.ieee_address;
      if (!bySource.has(k)) bySource.set(k, []);
      bySource.get(k).push(e);
    });

    const groupsHtml = [...bySource.values()]
      .sort((a, b2) => (a[0].source.name || '').localeCompare(b2[0].source.name || ''))
      .map((edges) => {
        const src = edges[0].source;
        const rows = edges
          .map((e) =>
            row({
              icon: MDI.link,
              headline: `Sends ${esc(this._caps(e.clusters))} to ${esc(this._targetPhrase(e.target))}`,
              text: (epCount[src.ieee_address] || 1) > 1
                ? `From endpoint ${esc(String(e.source.endpoint))}` : '',
              end: `<ha-button slot="end" appearance="plain" size="s" data-act="unbind"
                      data-from="${esc(src.ieee_address)}"
                      data-endpoint="${esc(String(e.source.endpoint))}"
                      data-clusters="${esc(e.clusters.join(','))}"
                      data-target="${esc(
                        e.target.type === 'group'
                          ? `g:${e.target.id}`
                          : `d:${e.target.ieee_address}:${e.target.endpoint}`
                      )}">Remove</ha-button>`,
            })
          )
          .join('');
        return `<div class="ota-group">
            <span>${esc(src.name || src.ieee_address)}</span>
            <ha-button appearance="plain" size="s" data-act="gotobinds"
              data-fromieee="${esc(src.ieee_address)}">Manage</ha-button>
          </div>${list(rows)}`;
      })
      .join('');

    const reportRows = [...this._mergeReportsBySource(reports).entries()]
      .sort((a, b2) => a[0].localeCompare(b2[0]))
      .map(([name2, clusters]) =>
        row({
          icon: MDI.info,
          headline: `${esc(name2)} sends ${esc(this._caps(clusters))}`,
        })
      )
      .join('');

    const b = this._binds;
    return (
      (b.notice ? `<ha-alert alert-type="success">${esc(b.notice)}</ha-alert>` : '') +
      (b.failed.length
        ? `<ha-alert alert-type="warning">Zigbee2MQTT reported the bind as done, but these
           clusters were refused: ${esc(b.failed.map(clusterLabel).join(', '))}. That usually
           means the device does not speak them, or it was asleep.</ha-alert>`
        : '') +
      (b.error ? `<ha-alert alert-type="error">${esc(b.error)}</ha-alert>` : '') +
      (s.create ? this._bindsAllCreate() : '') +
      `<ha-card class="nav-card">
        <div class="card-header">Direct control
          <span class="header-actions">
            <ha-button appearance="plain" size="s" data-act="bindnew">${
              s.create ? 'Close' : `${icon(MDI.plus)}Add binding`
            }</ha-button>
          </span>
        </div>
        <div class="note">A bind sends one device\u2019s commands straight to another,
        radio to radio, with nothing relaying in between. These keep working when Home
        Assistant is down.</div>
        ${
          controls.length
            ? groupsHtml
            : `<div class="empty">No device controls another directly yet. Add a binding
               here, or open a device and use its Bindings page.</div>`
        }
      </ha-card>` +
      (reports.length
        ? `<ha-card class="nav-card">
            <ha-expansion-panel header="Reporting to Zigbee2MQTT (${reports.length})">
              <div class="note">Created automatically so Home Assistant sees state
              changes. Manage them from each device\u2019s own Bindings page.</div>
              ${list(reportRows)}
            </ha-expansion-panel>
          </ha-card>`
        : '')
    );
  }

  /** The overview's create card: pick a source device, then bind like the device page. */
  _bindsAllCreate() {
    const s = this._bindsAll;
    const devices = this._devices
      .filter((d) => d.type !== 'Coordinator')
      .slice()
      .sort((a, b) =>
        (a.friendly_name || a.ieee_address).localeCompare(b.friendly_name || b.ieee_address)
      );
    // The picker is an ha-form selector like every other field in the bind flow:
    // a bare ha-select in a settings row rendered as an unlabelled sliver.
    const spec = this._formSpec('bindsrc', () => ({
      schema: [],
      data: { source: s.source || '' },
      label: () => 'Source device',
      helper: () => 'The device whose commands will be sent',
      changed: (data) => this._pickBindSource(data.source),
    }));
    spec.data = { source: s.source || '' };
    spec.schema = [
      {
        name: 'source',
        selector: {
          select: {
            mode: 'dropdown',
            options: devices.map((d) => ({
              value: d.ieee_address,
              label: d.friendly_name || d.ieee_address,
            })),
          },
        },
      },
    ];
    let body = '';
    if (s.clustersError) {
      body = `<div class="card-content"><ha-alert alert-type="error">${esc(
        s.clustersError
      )}</ha-alert></div>`;
    } else if (s.source && !s.clusters) {
      body = '<div class="note">Reading this device\u2019s endpoints\u2026</div>';
    } else if (s.source && s.clusters) {
      body = this._bindCreateFields(s.source, s.clusters.endpoints || [], s.data);
    }
    return `<ha-card class="nav-card">
        <div class="card-header">Add a binding</div>
        <div class="note">Pick the device that will send its commands, then what it sends
        and where it goes. The bind is radio to radio, like the ones below.</div>
        <div class="card-content pad"><ha-form data-form="bindsrc"></ha-form></div>
        ${body}
      </ha-card>`;
  }

  /** A source was picked on the overview: read that device's endpoints and clusters. */
  async _pickBindSource(ieee) {
    const s = this._bindsAll;
    if (!ieee || s.source === ieee) return;
    s.source = ieee;
    s.clusters = null;
    s.clustersError = null;
    this._render();
    try {
      const clusters = await this._call('z2m/device/clusters', { device: ieee });
      if (this._bindsAll.source !== ieee) return;
      s.clusters = clusters;
    } catch (err) {
      if (this._bindsAll.source !== ieee) return;
      s.clustersError = this._feedMessage(err, 'Could not read this device\u2019s endpoints');
    }
    this._render();
  }

  /** Coordinator reports collapsed to one row per device. */
  _mergeReportsBySource(reports) {
    const out = new Map();
    for (const e of reports) {
      const name = e.source.name || e.source.ieee_address;
      if (!out.has(name)) out.set(name, []);
      for (const c of e.clusters) if (!out.get(name).includes(c)) out.get(name).push(c);
    }
    return out;
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
      // Writes made from the overview refresh the overview; writes made from a
      // device's page refresh that page. Both re-read Z2M as the authority.
      if (this._view.name === 'bindsall') {
        this._bindsAll.data = null;
        await this._openBindsAll();
      } else {
        await this._reloadBinds();
      }
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

  /**
   * What the operator typed into a one-field form, trimmed and de-curled.
   *
   * Every caller is a name that becomes an MQTT topic, so the normalisation
   * belongs here rather than at each call site.
   */
  _textValue(key) {
    const spec = (this._forms || {})[key];
    return spec ? typedName(spec.data.value) : '';
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
      // Lines that arrived while paused: shown on the Jump to latest control so
      // coming back tells the operator how much they missed, not just that
      // something did.
      unread: 0,
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
      // Set while a '#pair' history entry from _openPairDialog is still
      // unpopped, so _closePairDialog knows whether a button-driven close
      // owes the browser a Back of its own (§ routing).
      historyPushed: false,
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
    this._syncCoord();
  }

  set narrow(v) {
    this._narrow = v;
    if (this._hass) this._render();
  }

  /**
   * Home Assistant's own router calls this whenever the panel's URL changes --
   * a sidebar link, the operator's own Back/Forward, and the very first mount,
   * on top of the native `popstate` listener below (which some hosting paths,
   * such as a cold load straight onto the panel URL before HA's own chrome has
   * registered -- see CHROME above -- never reach on their own). `v.path` is
   * already stripped of this panel's own /z2m prefix.
   */
  set route(v) {
    this._syncRouteView(v && typeof v.path === 'string' ? v.path : this._locationSubpath());
  }

  set panel(v) {
    this._panel = v;
  }

  /** The browser's own URL, with this panel's /z2m root stripped and no
   * leading slash: what `route.path` would say if Home Assistant's router had
   * already set it. Used as the cold-boot fallback and by `_onPopState`,
   * which gets no route object of its own. */
  _locationSubpath() {
    const path = (typeof window !== 'undefined' && window.location && window.location.pathname) || '';
    return path.replace(/^\/?z2m\/?/, '');
  }

  /** A subpath (no leading/trailing slash needed) to a view object, the
   * `_view` shape `_go`/`_bodyFor`/`_title` already speak. Unrecognised or
   * empty subpaths fall back to the dashboard -- the same page a bare /z2m
   * load always showed before routing existed. */
  _parseRoute(subpath) {
    const parts = String(subpath || '')
      .replace(/^\/+|\/+$/g, '')
      .split('/')
      .filter(Boolean);
    const [head, arg] = parts;
    switch (head) {
      case undefined:
        return { name: 'dashboard' };
      case 'devices':
        return { name: 'devices' };
      case 'device':
        return arg ? { name: 'device', ieee: decodeURIComponent(arg) } : { name: 'devices' };
      case 'groups':
        return { name: 'groups' };
      case 'group':
        return arg ? { name: 'group', group: decodeURIComponent(arg) } : { name: 'groups' };
      case 'map':
        return { name: 'map' };
      case 'diagnostics':
        return { name: 'diagnostics' };
      case 'settings':
        return { name: 'options' };
      case 'logs':
        return { name: 'logs' };
      case 'ota':
        return { name: 'ota' };
      case 'network':
        return { name: 'network' };
      case 'binds':
        return arg ? { name: 'binds', ieee: decodeURIComponent(arg) } : { name: 'devices' };
      case 'bindsall':
        return { name: 'bindsall' };
      default:
        return { name: 'dashboard' };
    }
  }

  /** The inverse of `_parseRoute`, via the ROUTE_PATH table above. */
  _routePath(view) {
    const fn = ROUTE_PATH[view && view.name];
    return fn ? fn(view) : '';
  }

  /** Same view, for deciding whether a route echo is a no-op: same name, and
   * same identifying param for the views that carry one. */
  _viewsEqual(a, b) {
    if (!a || !b || a.name !== b.name) return false;
    if (a.name === 'device' || a.name === 'binds') return a.ieee === b.ieee;
    if (a.name === 'group') return String(a.group) === String(b.group);
    return true;
  }

  /**
   * Applies whatever subpath the browser or Home Assistant's router now says
   * is current. Never pushes a history entry -- the address bar already says
   * this, whether it is HA's `route` setter echoing our own push or the
   * operator's own Back/Forward -- and is a no-op when the parsed view is
   * already on screen, which is what makes that echo harmless.
   */
  _syncRouteView(subpath) {
    const view = this._parseRoute(subpath);
    if (this._viewsEqual(view, this._view)) return;
    if (!this._hass || !this.shadowRoot) {
      // Boot has not run yet: hand the parsed view to _boot()'s first render
      // instead of leaving/entering a page that was never on screen.
      this._view = view;
      this._routeApplied = true;
      return;
    }
    this._navigate(view, false);
  }

  /** The native Back/Forward event. A dialog owns the one '#pair' entry it
   * pushed on open (§ pairing); only a press past that entry is a real view
   * change, so the dialog gets first refusal. */
  _onPopState() {
    if (this._pairing.open) {
      this._closePairDialog(true);
      return;
    }
    this._syncRouteView(this._locationSubpath());
  }

  connectedCallback() {
    if (!this.shadowRoot) this.attachShadow({ mode: 'open' });
    if (!this._onPopStateBound) this._onPopStateBound = () => this._onPopState();
    if (typeof window !== 'undefined' && window.addEventListener) {
      window.addEventListener('popstate', this._onPopStateBound);
    }
  }

  disconnectedCallback() {
    this._leavePairing();
    Object.keys(this._subs).forEach((k) => this._unsub(k));
    this._stopTicker();
    this._stopEnergyPoll();
    if (this._logTimer) {
      clearTimeout(this._logTimer);
      this._logTimer = null;
    }
    if (this._onPopStateBound && typeof window !== 'undefined' && window.removeEventListener) {
      window.removeEventListener('popstate', this._onPopStateBound);
    }
  }

  _boot() {
    if (!this.shadowRoot) this.attachShadow({ mode: 'open' });
    // A deep link (/z2m/device/0x...) has to be the very first paint, not a
    // dashboard frame that then jumps: derive the opening view from the URL
    // before that first _render() call below, unless Home Assistant's own
    // `route` setter already got here first -- it can arrive before `hass`
    // does, and _syncRouteView already applied it when it did.
    if (!this._routeApplied) {
      this._view = this._parseRoute(this._locationSubpath());
      this._routeApplied = true;
    }

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
    // The pairing dialog paints itself outside the normal render loop (see
    // _paintPairDialog), so a summary push -- the only way the debug chip's
    // log_level ever changes while the dialog is open -- needs its own nudge.
    // _paintPairDialog no-ops when it is not open and dedupes on markup, so this
    // is free the rest of the time.
    if (key === 'info' && this._pairing.open) this._paintPairDialog();
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
      /* The panel owns its viewport. Ambient height chains (ha-drawer et al) hold
       * on desktop but NOT inside the companion apps, where a plain height:100%
       * host grows to its content: the document scrolls, a sticky toolbar binds to
       * a scrollport that never moves, and hass-subpage's narrow position:fixed
       * lands at a pushed-down static position. dvh sidesteps all of it: the host
       * is exactly one viewport tall, never scrolls, and scrolling lives in the
       * chrome's own content region (hass-subpage .content, or #scroll in the
       * fallback). */
      :host { display:block; height:100vh; height:100dvh; overflow:hidden;
              background:var(--primary-background-color);
              color:var(--primary-text-color);
              font-family:var(--ha-font-family-body, var(--paper-font-body1_-_font-family, sans-serif)); }
      /* The chrome's flex column lives on #app, the wrapper _ensureApp keeps as
       * the shadow root's only child -- :host flex would style the wrapper, not
       * the toolbar and scroller inside it. */
      #app { display:flex; flex-direction:column; height:100%; min-height:0; }
      hass-subpage { flex:1; min-height:0; }
      #scroll { flex:1; min-height:0; overflow:auto; -webkit-overflow-scrolling:touch; }
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

      /* Device page and diagnostics: masonry columns. Cards flow down each column
       * and the columns balance themselves, which the old fixed two-column grid
       * could not: a remote with one battery sensor left half the screen empty
       * while the other half scrolled. break-inside keeps every card whole. */
      .devgrid { max-width:600px; margin:var(--ha-space-4, 16px) auto 0; }
      .devgrid > * { display:inline-block; width:100%; vertical-align:top;
                     break-inside:avoid; margin:0 0 var(--ha-space-4, 16px); }
      .devgrid > ha-alert { display:block; column-span:all;
                     margin-bottom:var(--ha-space-3, 12px); }
      .devgrid ha-card { max-width:none; }
      @media (min-width:1000px) {
        .devgrid { max-width:1240px; columns:2; column-gap:var(--ha-space-6, 24px); }
      }
      @media (min-width:1600px) {
        .devgrid { max-width:1860px; columns:3; }
      }
      .devchips { display:flex; flex-wrap:wrap; gap:var(--ha-space-2, 8px);
                  padding:var(--ha-space-3, 12px) var(--ha-space-4, 16px) 0; }
      /* Home Assistant's own card CSS pulls a .card-content that is not the first
       * child up by 8px, assuming a .card-header with bottom padding sits above it.
       * After a chips row -- which has no bottom padding to give back -- that
       * negative margin lands the content ON TOP of the chips. Give it a real gap. */
      .devchips + .card-content { margin-top:var(--ha-space-2, 8px); }
      /* Same rule, same assumption: a .nav-card header is deliberately trimmed to
       * 8px of bottom padding, which is precisely what the pull takes back, leaving
       * the content flush against the heading. Give it nothing to take. */
      .nav-card > .card-header + .card-content { margin-top:0; }
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
      /* A reading is normally a number and a unit. Some converters expose a text
         blob instead -- Aqara's FP300 packs 17 zone booleans into one state that
         HA truncates at its 255 character limit -- and an unclamped one of those
         takes over the card. _sensReading trims the text; this keeps a single long
         token from widening the column even so. */
      .sens-v { font-size:var(--ha-font-size-xl, 20px); line-height:1.3;
                color:var(--primary-text-color); overflow-wrap:anywhere; }
      .sens-v span { font-size:var(--ha-font-size-s, 12px);
                     color:var(--secondary-text-color); }
      /* The unit is the small grey part; a clamped text reading is still the reading. */
      .sens-v span.txt { font-size:inherit; color:inherit; }
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
      .network-status .heading .logo { height:48px; width:auto; flex-shrink:0; align-self:center; }
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
      .search .count { flex:none; color:var(--secondary-text-color);
                        font-size:var(--ha-font-size-s, 13px);
                        font-variant-numeric:tabular-nums; white-space:nowrap; }
      .search ha-svg-icon { color:var(--secondary-text-color); }
      /* A no-match state reads as a centered notice, so its Clear action centers too
         rather than inheriting the right-aligned rhythm .actions uses everywhere else. */
      .empty .actions { justify-content:center; padding-top:var(--ha-space-2, 8px); }
      .chip { display:inline-block; padding:0 var(--ha-space-2, 8px); border:var(--ha-border-width, 1px) solid;
              border-radius:var(--ha-border-radius-pill, 999px); color:var(--secondary-text-color);
              font-size:var(--ha-font-size-xs, 12px); line-height:var(--ha-line-height-normal, 1.5);
              white-space:nowrap; }
      .chip.off { color:var(--error-color); }
      .chip.warn { color:var(--warning-color); }
      .chip.ok { color:var(--success-color); }
      .chip[hidden] { display:none; }
      /* Devices as a real table at tablet width, HA's config/devices look. Hidden on
       * phones, where the compact two-line rows remain; the breakpoint below decides
       * which of the two is visible. */
      .dtab { display:none; }
      .dtab-row { display:grid; align-items:center; min-height:56px;
                  grid-template-columns:minmax(0, 5fr) minmax(0, 5fr) minmax(0, 3fr) 112px 72px;
                  gap:var(--ha-space-4, 16px); padding:0 var(--ha-space-4, 16px); }
      .dtab-row[data-ieee] { cursor:pointer; }
      .dtab-row[data-ieee]:hover { background-color:var(--secondary-background-color); }
      .dtab-row[data-ieee]:focus-visible { outline:var(--ha-outline-width, 2px) solid var(--primary-color);
                  outline-offset:-2px; }
      .dtab-head { min-height:40px; color:var(--secondary-text-color);
                   font-size:var(--ha-font-size-s, 12px);
                   border-bottom:var(--ha-border-width, 1px) solid var(--divider-color); }
      .dtab-name, .dtab-dim { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
      .dtab-dim { color:var(--secondary-text-color); }
      /* Wide views: the devices table and the bindings overview use the tablet's
       * width instead of a phone column between dead gutters. */
      @media (min-width:1000px) {
        .container.wide { padding-inline:var(--ha-space-6, 24px); }
        .container.wide ha-card { max-width:1400px; }
        .dtab { display:block; }
        .dlist { display:none; }
      }
      /* Mesh health: needs-attention rows are amber, and the per-device counters
       * are a compact table inside the expansion panel. */
      .attn ha-svg-icon { color:var(--warning-color); }
      .htab { padding:var(--ha-space-2, 8px) var(--ha-space-4, 16px) var(--ha-space-3, 12px);
              font-size:var(--ha-font-size-m, 14px); }
      .htab-row { display:grid; align-items:baseline;
                  grid-template-columns:minmax(0, 1fr) 76px 76px 64px 100px;
                  gap:var(--ha-space-3, 12px); padding:var(--ha-space-1, 4px) 0; }
      .htab-row > span { text-align:right; font-variant-numeric:tabular-nums; }
      .htab-row > span:first-child { text-align:left; overflow:hidden;
                  text-overflow:ellipsis; white-space:nowrap; }
      .htab-head { color:var(--secondary-text-color); font-size:var(--ha-font-size-s, 12px);
                  border-bottom:var(--ha-border-width, 1px) solid var(--divider-color); }
      /* Channel energy scan: the staged progress row and the bar chart. */
      .scan-steps { display:flex; flex-wrap:wrap; align-items:center;
                    gap:var(--ha-space-2, 8px) var(--ha-space-6, 24px);
                    padding:var(--ha-space-2, 8px) var(--ha-space-4, 16px); }
      .scan-step { display:inline-flex; align-items:center; gap:var(--ha-space-2, 8px);
                   color:var(--secondary-text-color); font-size:var(--ha-font-size-m, 14px); }
      .scan-step.active { color:var(--primary-text-color); }
      .scan-step.done { color:var(--success-color); }
      .scan-step ha-svg-icon { width:18px; height:18px; }
      .scan-dot { width:8px; height:8px; border-radius:50%; background:var(--divider-color); }
      .echart { padding:var(--ha-space-2, 8px) var(--ha-space-4, 16px) 0; }
      .echart svg { display:block; width:100%; height:auto; }
      .ec-val { font-size:11px; fill:var(--primary-text-color); }
      .ec-ch { font-size:11px; fill:var(--secondary-text-color); }
      .ec-use { font-size:10px; font-weight:600; letter-spacing:.04em;
                text-transform:uppercase; fill:var(--primary-color); }
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

      /* ---------------------------------------------------------- settings */
      /* One vertical rhythm, the .kv convention: a top divider between siblings,
       * no padding on the row itself so a composite/group's ha-expansion-panel
       * (which pads its own summary/content) never doubles up. */
      .setrow { min-height:48px; box-sizing:border-box; }
      .setrow + .setrow { border-top:var(--ha-border-width, 1px) solid var(--divider-color); }
      details.setrow > summary { list-style:none; cursor:pointer; }
      details.setrow > summary::-webkit-details-marker { display:none; }
      .setrow-top { display:flex; flex-wrap:wrap; align-items:center;
                    gap:var(--ha-space-4, 16px); padding:var(--ha-space-3, 12px) var(--ha-space-4, 16px); }
      .setrow-label { flex:1; min-width:0; }
      .setrow-name, .setgroup-title { font-size:var(--ha-font-size-m, 14px); color:var(--primary-text-color); }
      .setgroup-title { flex:1; text-transform:uppercase; letter-spacing:.04em;
                         font-size:var(--ha-font-size-s, 13px); color:var(--secondary-text-color); }
      .setgroup-note { padding:0 var(--ha-space-4, 16px) var(--ha-space-2, 8px);
                        color:var(--secondary-text-color); font-size:var(--ha-font-size-s, 13px); }
      .setrow-desc { padding:0 var(--ha-space-4, 16px); margin-top:var(--ha-space-1, 4px);
                     color:var(--secondary-text-color); font-size:var(--ha-font-size-s, 13px);
                     line-height:1.4; display:-webkit-box; -webkit-line-clamp:2;
                     -webkit-box-orient:vertical; overflow:hidden; max-height:calc(1.4em * 2); }
      .setrow-desc.expanded { -webkit-line-clamp:unset; overflow:visible; max-height:none; }
      /* A trailing block, never inline inside the clamped text: an inline button
       * sharing the clamped box's line count is exactly what made -webkit-line-
       * clamp's reported height unreliable and let the second line bleed into
       * the meta row below it. */
      .setrow-more { padding:0 var(--ha-space-4, 16px); margin-top:var(--ha-space-1, 4px); }
      .setrow-meta:empty { display:none; }
      .setrow-meta { padding:0 var(--ha-space-4, 16px) var(--ha-space-3, 12px);
                     margin-top:var(--ha-space-1, 4px);
                     color:var(--secondary-text-color); font-size:var(--ha-font-size-s, 12px);
                     font-variant-numeric:tabular-nums; }
      .seterr { padding:0 var(--ha-space-4, 16px) var(--ha-space-3, 12px);
                margin-top:var(--ha-space-2, 8px);
                color:var(--error-color); font-size:var(--ha-font-size-s, 13px); }
      .seterr[hidden] { display:none; }
      .setrow-summary { color:var(--secondary-text-color); font-size:var(--ha-font-size-s, 13px); }
      .linklike { all:unset; cursor:pointer; color:var(--primary-color); font-size:var(--ha-font-size-s, 13px); }
      .setrow-ctl { flex:none; max-width:60%; }
      @media (min-width:900px) { .setrow-ctl { max-width:320px; } }
      .setrow[data-etype="text"] .setrow-ctl, .setrow[data-etype="list"] .setrow-ctl { width:100%; max-width:none; }
      @media (max-width:600px) {
        .setrow[data-etype="text"] .setrow-top, .setrow[data-etype="list"] .setrow-top {
          flex-direction:column; align-items:stretch; }
      }
      .setnumwrap { display:inline-flex; align-items:center; gap:var(--ha-space-2, 8px); }
      .setnumwrap input.fallback { width:136px; }
      .setunit { color:var(--secondary-text-color); font-size:var(--ha-font-size-s, 13px); }
      input.fallback.invalid { border-color:var(--error-color); }
      select.fallback { box-sizing:border-box; min-height:var(--ha-touch-target-min-size, 40px);
                         padding:var(--ha-space-2, 8px);
                         border:var(--ha-border-width, 1px) solid var(--divider-color);
                         border-radius:var(--ha-border-radius-md, 8px);
                         background:var(--card-background-color); color:var(--primary-text-color);
                         font:inherit; font-size:var(--ha-font-size-m, 14px); }
      select.fallback.compact, input.fallback.compact { min-height:var(--ha-space-8, 32px);
                         padding:var(--ha-space-1, 4px) var(--ha-space-2, 8px); width:96px; }
      .setseg { display:inline-flex; gap:var(--ha-space-2, 8px); }
      .fallback-btn { box-sizing:border-box; min-height:var(--ha-touch-target-min-size, 40px);
                      padding:0 var(--ha-space-4, 16px);
                      border:var(--ha-border-width, 1px) solid var(--divider-color);
                      border-radius:var(--ha-border-radius-md, 8px);
                      background:var(--card-background-color); color:var(--primary-color);
                      font:inherit; font-size:var(--ha-font-size-m, 14px); cursor:pointer; }
      .setpreset { display:inline-flex; flex-wrap:wrap; align-items:center; gap:var(--ha-space-2, 8px); }
      .setpreset-custom[hidden] { display:none; }
      .setlist { display:flex; flex-direction:column; gap:var(--ha-space-2, 8px); align-items:flex-end; }
      .setlist-chips { display:flex; flex-wrap:wrap; gap:var(--ha-space-1, 4px); justify-content:flex-end; }
      .setlist-empty { color:var(--secondary-text-color); font-size:var(--ha-font-size-s, 13px); }
      .chipx { all:unset; cursor:pointer; margin-inline-start:var(--ha-space-1, 4px); }
      .setlist-add { display:flex; align-items:center; gap:var(--ha-space-2, 8px); }
      .setlist-add input.fallback, .setlist-add ha-textfield { width:88px; }
      .set-actions { display:flex; flex-wrap:wrap; gap:var(--ha-space-3, 12px);
                     padding:var(--ha-space-3, 12px) var(--ha-space-4, 16px);
                     border-bottom:var(--ha-border-width, 1px) solid var(--divider-color); }
      .setaction { display:flex; flex-direction:column; gap:var(--ha-space-1, 4px); }
      .setcomposite-body { padding-bottom:var(--ha-space-3, 12px); }
      .setfeature { display:flex; align-items:center; justify-content:space-between;
                    gap:var(--ha-space-3, 12px);
                    padding:var(--ha-space-1, 4px) var(--ha-space-4, 16px) var(--ha-space-1, 4px)
                      calc(var(--ha-space-4, 16px) * 2); }
      .setfeature-label { flex:1; min-width:0; font-size:var(--ha-font-size-s, 13px); color:var(--primary-text-color); }
      .setfeature-ctl { flex:none; }
      .setcomposite-apply { display:flex; justify-content:flex-end; padding:var(--ha-space-2, 8px) var(--ha-space-4, 16px) 0; }

      /* ------------------------------------------------- gslider primitive */
      .gslider { -webkit-appearance:none; appearance:none; display:block; width:100%;
                 height:32px; margin:0; background:transparent; touch-action:pan-y;
                 /* Plain K sliders carry no gradient class, so the track needs a real default. */
                 --gs-track:var(--divider-color, rgba(127,127,127,.35));
                 cursor:pointer; }
      .gslider::-webkit-slider-runnable-track { height:12px; border-radius:6px; background:var(--gs-track); }
      .gslider::-moz-range-track { height:12px; border-radius:6px; background:var(--gs-track); }
      .gslider::-webkit-slider-thumb { -webkit-appearance:none; width:22px; height:22px;
                 margin-top:-5px; border-radius:50%; background:#fff;
                 border:2px solid rgba(0,0,0,.16); box-shadow:0 1px 4px rgba(0,0,0,.4); }
      .gslider::-moz-range-thumb { width:22px; height:22px; border-radius:50%; background:#fff;
                 border:2px solid rgba(0,0,0,.16); box-shadow:0 1px 4px rgba(0,0,0,.4); }
      .gslider:focus-visible::-webkit-slider-thumb, .gslider:focus-visible::-moz-range-thumb {
                 outline:2px solid var(--primary-color); outline-offset:2px; }
      .gslider.mini { width:132px; height:32px; }
      .gslider.mini::-webkit-slider-runnable-track, .gslider.mini::-moz-range-track { height:8px; border-radius:4px; }
      .gslider.mini::-webkit-slider-thumb { width:18px; height:18px; margin-top:-5px; }
      .gslider.mini::-moz-range-thumb { width:18px; height:18px; }
      /* Fixed tracks: the rainbow used by the light block's own hue slider,
       * and the same rainbow with L's white cap at 254/255 (§4.7, §5.2). */
      .gslider.hue360 { --gs-track:linear-gradient(to right, hsl(0,100%,50%), hsl(60,100%,50%) 16.7%,
                 hsl(120,100%,50%) 33.3%, hsl(180,100%,50%) 50%, hsl(240,100%,50%) 66.7%,
                 hsl(300,100%,50%) 83.3%, hsl(360,100%,50%)); }
      .gslider.hue255 { --gs-track:linear-gradient(to right, hsl(0,100%,50%), hsl(60,100%,50%) 16.7%,
                 hsl(120,100%,50%) 33.3%, hsl(180,100%,50%) 50%, hsl(240,100%,50%) 66.7%,
                 hsl(300,100%,50%) 83.3%, hsl(358.6,100%,50%) 99.6%, #fff 99.6% 100%); }

      /* ---------------------------------------------------- pchip and seg */
      .pchip { display:inline-flex; align-items:center; gap:6px; min-height:32px;
               padding:0 var(--ha-space-3, 12px); border-radius:var(--ha-border-radius-pill, 999px);
               border:var(--ha-border-width,1px) solid var(--divider-color);
               background:none; color:var(--primary-text-color);
               font:inherit; font-size:var(--ha-font-size-s, 13px); cursor:pointer; }
      .pchip[aria-pressed="true"], .pchip[aria-checked="true"] { background:var(--primary-color);
               border-color:var(--primary-color); color:var(--text-primary-color); }
      .pchip .dot { width:10px; height:10px; border-radius:50%; flex:none; border:1px solid rgba(0,0,0,.12); }
      .pchips { display:flex; flex-wrap:wrap; gap:var(--ha-space-2, 8px); margin-top:var(--ha-space-2, 8px); }
      .seg { display:flex; border:var(--ha-border-width,1px) solid var(--divider-color);
             border-radius:var(--ha-border-radius-pill, 999px); padding:2px; gap:2px; }
      .seg button { flex:1; min-height:32px; border:0; border-radius:inherit;
             background:none; color:var(--secondary-text-color); font:inherit;
             font-size:var(--ha-font-size-s, 13px); cursor:pointer; }
      .seg button[aria-selected="true"] { background:var(--primary-color); color:var(--text-primary-color); }

      /* ------------------------------------------------------- K, L, N, M */
      .setk, .setn { display:flex; flex-direction:column; align-items:flex-end; gap:var(--ha-space-1, 4px); }
      .setslidewrap { display:flex; align-items:center; gap:var(--ha-space-2, 8px); }
      .setl { display:flex; align-items:center; gap:var(--ha-space-2, 8px); }
      .setl input.fallback, .setl ha-textfield { width:64px; }
      .setrow[data-editor="k"] .setrow-ctl, .setrow[data-editor="l"] .setrow-ctl,
      .setrow[data-editor="n"] .setrow-ctl, .setrow[data-editor="m"] .setrow-ctl { width:100%; max-width:none; }
      @media (max-width:600px) {
        .setrow[data-editor="k"] .setrow-top, .setrow[data-editor="l"] .setrow-top,
        .setrow[data-editor="n"] .setrow-top, .setrow[data-editor="m"] .setrow-top {
          flex-direction:column; align-items:stretch; }
      }
      .cswatch { width:24px; height:24px; border-radius:6px; flex:none;
                 border:1px solid var(--divider-color); display:inline-flex;
                 align-items:center; justify-content:center; }
      .cswatch-sync { background:var(--secondary-background-color); }
      .cswatch-sync ha-svg-icon { width:16px; height:16px; color:var(--secondary-text-color); }
      .cswatch-unknown { background:var(--secondary-background-color); border-style:dashed; }
      .setfeature-slide { display:flex; align-items:center; gap:var(--ha-space-2, 8px); }
      .setdur { display:flex; align-items:center; gap:var(--ha-space-2, 8px); flex-wrap:wrap; }
      .setdur-meta { color:var(--secondary-text-color); font-size:var(--ha-font-size-s, 12px);
                     font-variant-numeric:tabular-nums; margin-top:var(--ha-space-1, 4px); }

      /* --------------------------------------------------- light block */
      .lt-hero { display:flex; align-items:center; gap:var(--ha-space-3, 12px);
                 padding:var(--ha-space-2, 8px) var(--ha-space-4, 16px); }
      .lt-swatch { width:44px; height:44px; border-radius:50%; flex:none; }
      .lt-info { flex:1; min-width:0; }
      .lt-name { font-size:var(--ha-font-size-m, 14px); }
      .lt-state { display:flex; align-items:center; gap:var(--ha-space-2, 8px);
                  color:var(--secondary-text-color); font-size:var(--ha-font-size-s, 12px); }
      .lt ha-control-switch { width:72px; height:36px; flex:none; }
      .lt-row { padding:var(--ha-space-2, 8px) var(--ha-space-4, 16px); }
      .lt-row:last-child { padding-bottom:var(--ha-space-3, 12px); }
      .lt-cap { display:flex; align-items:center; justify-content:space-between;
                color:var(--secondary-text-color); font-size:var(--ha-font-size-s, 13px);
                padding-bottom:var(--ha-space-1, 4px); }
      .lt-readout { font-variant-numeric:tabular-nums; }
      .lt ha-control-slider { height:48px; width:100%; }
      .lt-panel[hidden] { display:none; }
      .lt-hex { display:flex; justify-content:flex-end; padding-top:var(--ha-space-1, 4px);
                font-family:var(--ha-font-family-code, monospace); font-size:var(--ha-font-size-s, 12px); }
      .lt-hex button.linklike { font-family:inherit; }
      .lt-hexfield { width:96px; min-height:32px; font-family:var(--ha-font-family-code, monospace); text-align:right; }
      .lt-err { padding:0 var(--ha-space-4, 16px) var(--ha-space-3, 12px);
                color:var(--error-color); font-size:var(--ha-font-size-s, 13px); }
      .lt-err[hidden] { display:none; }
      .lt + .ctl, .ctl + .lt, .lt + .lt { border-top:1px solid var(--divider-color); }

      /* Viewport-proportional, not a fixed box: an interview emits dozens of lines
       * and the old 168px strip showed nine of them. height (not max-height)
       * claims the space immediately so the box does not jump around as lines
       * arrive; dvh tracks a phone's URL bar, with the plain vh line right
       * above it as the fallback for engines that do not know dvh yet. */
      .pair-log { height:clamp(160px, 32vh, 480px);
                  height:clamp(160px, 32dvh, 480px);
                  overflow:auto; overscroll-behavior:contain;
                  border-top:var(--ha-border-width, 1px) solid var(--divider-color); }
      .pair-log .log { padding-inline:var(--ha-space-3, 12px); }
      .pair-log:empty::after { content:"Waiting for Zigbee2MQTT\u2026"; display:block;
                  padding:var(--ha-space-3, 12px); color:var(--secondary-text-color);
                  font-size:var(--ha-font-size-s, 13px);
                  line-height:var(--ha-line-height-normal, 1.5); }

      /* ------------------------------------------------------------ dialog */
      /* A window everywhere, sized for the surface. 2026.8's ha-dialog is built on
       * wa-dialog and sizes itself with --ha-dialog-width-md / -full; on a phone HA's
       * global styles push those to 100vw, which is the full-screen takeover the
       * operator asked to remove. The --mdc-dialog-* names are dead in this
       * implementation -- overriding them does nothing -- but
       * --dialog-surface-margin-top IS read by wa-dialog::part(dialog), and a value of
       * auto on both margins is what centres the surface. It only reaches the surface
       * because the element is not type="standard"; see _ensurePairDialog. */
      ha-dialog { --ha-dialog-width-md:min(92vw, 33rem); }
      @media (min-width: 900px) {
        /* Widen the dialog once there is room, so log lines stop wrapping
           constantly during an interview. */
        ha-dialog { --ha-dialog-width-md:min(92vw, 40rem); }
      }
      @media (max-width: 450px), (max-height: 500px) {
        ha-dialog { --ha-dialog-width-md:calc(100vw - var(--ha-space-8, 32px));
                    --ha-dialog-width-full:calc(100vw - var(--ha-space-8, 32px));
                    --ha-dialog-max-height:min(88vh, 720px);
                    --ha-dialog-min-height:auto;
                    --dialog-surface-margin-top:auto;
                    --ha-dialog-border-radius:var(--ha-border-radius-2xl, 28px); }
        .pair-log { height:clamp(128px, 28vh, 320px);
                    height:clamp(128px, 28dvh, 320px); }
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
      /* The scroller (#scroll or hass-subpage's .content) already has the exact
       * height below the toolbar, safe-area inset included, so the map fills it
       * with a plain 100% chain. Viewport math here would double-count the
       * inset: 100dvh minus a bare --header-height leaves the toolbar's
       * safe-area padding hanging out of the scroller on a notched phone. */
      .container.mapview { padding:0; height:100%; box-sizing:border-box; }
      .stage { height:100%; min-height:360px; }
      .logwrap { min-height:280px; overflow:auto;
                 height:calc(100vh - 320px - var(--safe-area-inset-top, 0px));
                 height:calc(100dvh - 320px - var(--safe-area-inset-top, 0px));
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
      .toolbar { flex:none; z-index:2; display:flex; align-items:center;
                 gap:var(--ha-space-2, 8px); box-sizing:border-box;
                 height:calc(var(--header-height, 56px) + var(--safe-area-inset-top, 0px));
                 padding:calc(var(--ha-space-2, 8px) + var(--safe-area-inset-top, 0px))
                         var(--ha-space-3, 12px) var(--ha-space-2, 8px);
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
        /* The network card keeps its pill beside the heading on a phone, the way
           the Z-Wave dashboard does; the wrap rule above is for headers whose
           actions genuinely do not fit. */
        .card-header.nowrap { flex-wrap:nowrap; align-items:center; }
        .card-header.nowrap .header-actions { width:auto; justify-content:flex-end; }
        .kv { flex-direction:column; gap:var(--ha-space-1, 4px); }
        .kv .k { flex:none; }
        .form-row { align-items:stretch; flex-direction:column; }
        input[type=text], input[type=number], select { max-width:none; width:100%; }
        .logwrap { height:calc(100vh - 280px - var(--safe-area-inset-top, 0px));
                   height:calc(100dvh - 280px - var(--safe-area-inset-top, 0px)); }
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

    // The companion apps enter sidebar panels with history.state.root set, which
    // flips hass-subpage's header to a menu button (its render checks
    // `this.mainPage || history.state?.root` before backPath). This page's
    // contract is a back arrow to Settings from every entry point, so the root
    // marker is stripped before the chrome renders. replaceState keeps the URL
    // and the rest of the state untouched.
    if (typeof history !== 'undefined' && history.state && history.state.root) {
      try {
        history.replaceState({ ...history.state, root: false }, '');
      } catch (_) {
        /* History API refusing replaceState (e.g. detached webview) must never
         * block a render; the cost is a menu button, not a broken panel. */
      }
    }

    this._counts = this._countKey();
    const wide = this._view.name === 'devices' || this._view.name === 'bindsall';
    const body = `<div class="container${this._view.name === 'map' ? ' mapview' : ''}${
      wide ? ' wide' : ''
    }">
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

    // The operator may be mid-word in the devices or settings search when a push
    // lands. ha-textfield is a web component: its caret lives on an inner input
    // the host itself does not reliably expose through selectionStart, so these
    // two ids trust the value their own input handler already recorded instead
    // of a fresh read here, which is what _restoreCaret is for.
    const focused = this.shadowRoot.activeElement;
    const focusId = focused && focused.id;
    const tracked = focusId === 'q' ? this._filterCaret
      : focusId === 'setfilter' ? this._setFilterCaret
      : null;
    let caret = tracked;
    if (caret === null) {
      try {
        caret = focused ? focused.selectionStart : null;
      } catch (_) {
        caret = null; // inputs that do not support selection throw on read
      }
    }

    this._ensureApp().innerHTML = markup;
    this._hydrate();
    // _syncFw/_syncCoord also call _hydrate() after a scoped box patch, while
    // the device page's own settings boxes already hold real content -- forcing
    // a fresh sync there would blow the per-row memo away and repaint every row
    // on every firmware tick. A genuine full render is the one place the
    // skeleton is truly empty (render discipline, §1) and a forced sync is safe.
    if (this._view.name === 'device') this._syncSettings(true);

    if (focusId) {
      const again = this.shadowRoot.getElementById(focusId);
      if (again && again.focus) {
        again.focus();
        this._restoreCaret(again, caret);
      }
    }

    // The dialog is retained across renders, so it has to be put back on top of the
    // markup that just replaced it.
    this._hostPairDialog();
    this._enter();
  }

  /**
   * Best-effort caret restore after the element that had it was just recreated.
   *
   * A plain `<input>` exposes `setSelectionRange` directly. A web-component text
   * field (`ha-textfield`) may not: its caret lives on a native input behind its
   * own shadow root, reachable only once the component has finished updating --
   * hence the `updateComplete` branch, which real LitElement-based components
   * (HA's own) provide and a plain object simply will not have.
   */
  _restoreCaret(el, caret) {
    if (caret === null) return;
    try {
      if (el.setSelectionRange) {
        el.setSelectionRange(caret, caret);
        return;
      }
    } catch (_) {
      /* fall through to the web-component path below */
    }
    const ready = el.updateComplete;
    if (ready && typeof ready.then === 'function') {
      ready
        .then(() => {
          const inner = el.shadowRoot && el.shadowRoot.querySelector('input');
          if (inner && inner.setSelectionRange) inner.setSelectionRange(caret, caret);
        })
        .catch(() => {});
    }
  }

  /** HA's own page chrome: header, back arrow and refresh action. */
  _subpageChrome(body, top) {
    return `<hass-subpage id="page" header="${esc(this._title())}"${
      top ? ' back-path="/config"' : ''
    }${this._narrow ? ' narrow' : ''}>
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
        <ha-icon-button id="back" data-act="${top ? 'backtop' : 'back'}" data-path="${MDI.back}"
          data-label="Back"></ha-icon-button>
        <div class="maintitle">${esc(this._title())}</div>
        <ha-icon-button id="reload" data-act="refresh" data-path="${MDI.refresh}"
          data-label="Refresh"></ha-icon-button>
      </div>
      <div id="scroll">${body}</div>`;
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
      case 'bindsall':
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
      case 'bindsall':
        return this._bindsAllView();
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
      // The devices table rows are grid rows rather than native buttons, so give
      // the keyboard what a button would have provided.
      el.onkeydown = (ev) => {
        if (ev.key !== 'Enter' && ev.key !== ' ') return;
        ev.preventDefault();
        this._go({ name: 'device', ieee: el.dataset.ieee });
      };
    });
    r.querySelectorAll('[data-group]').forEach((el) => {
      el.onclick = () => this._go({ name: 'group', group: el.dataset.group });
    });
    r.querySelectorAll('[data-scan]').forEach((el) => {
      el.onclick = () => {
        this._diag.scanSel = el.dataset.scan;
        this._render();
      };
    });
    r.querySelectorAll('[data-act]').forEach((el) => {
      el.onclick = (ev) => {
        // A button inside a tappable row acts alone; the row must not also fire.
        if (ev && ev.stopPropagation) ev.stopPropagation();
        return this._dispatch(el.dataset.act, el);
      };
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

    // The light block (§4). Reads/writes the state mirror via z2m/device/set,
    // never hass.callService -- see §4.2 for why.
    r.querySelectorAll('[data-ltswitch]').forEach((el) => {
      if (el._z2mLt) return;
      el._z2mLt = true;
      el.addEventListener('change', () => {
        const [ieee, n] = el.dataset.ltswitch.split('|');
        this._lightCommit(ieee, Number(n), { state: el.checked ? 'ON' : 'OFF' });
      });
    });
    const lightPayload = (ieee, n, extra) => {
      const d = this._dev(ieee);
      const expose = d && this._lightExposes(d)[Number(n)];
      const s = expose && this._lightState(d, expose);
      return s && s.on === false ? { state: 'ON', ...extra } : extra;
    };
    r.querySelectorAll('[data-ltbar]').forEach((el) => {
      if (el._z2mLt) return;
      el._z2mLt = true;
      const commit = (pct) => {
        const [ieee, n] = el.dataset.ltbar.split('|');
        const d = this._dev(ieee);
        const expose = d && this._lightExposes(d)[Number(n)];
        if (!expose) return;
        if (pct <= 0) return void this._lightCommit(ieee, Number(n), { state: 'OFF' });
        const brightF = this._lightFeature(expose, 'brightness');
        const wire = pctToBrightness(pct, brightnessMax(brightF || {}));
        this._lightCommit(ieee, Number(n), lightPayload(ieee, n, { brightness: wire }));
      };
      el.addEventListener('value-changed', (ev) => commit(Number((ev.detail || {}).value)));
      el.onchange = () => commit(Number(el.value));
    });
    r.querySelectorAll('[data-ltbchip]').forEach((el) => {
      el.onclick = () => {
        const [ieee, n, wire] = el.dataset.ltbchip.split('|');
        this._lightCommit(ieee, Number(n), lightPayload(ieee, n, { brightness: Number(wire) }));
      };
    });
    r.querySelectorAll('[data-ltseg]').forEach((el) => {
      el.onclick = () => {
        const [ieee, n, which] = el.dataset.ltseg.split('|');
        const r2 = this.shadowRoot;
        const tPanel = r2.getElementById(`lt${n}-temppanel`);
        const cPanel = r2.getElementById(`lt${n}-colorpanel`);
        const seg = r2.getElementById(`lt${n}-seg`);
        if (tPanel) tPanel.hidden = which !== 'temp';
        if (cPanel) cPanel.hidden = which === 'temp';
        if (seg) {
          const btns = seg.querySelectorAll('[data-ltseg]');
          btns.forEach((b) => b.setAttribute('aria-selected', String(b.dataset.ltseg.endsWith(which))));
        }
      };
    });
    r.querySelectorAll('[data-lttchip]').forEach((el) => {
      el.onclick = () => {
        const [ieee, n, mired] = el.dataset.lttchip.split('|');
        this._lightCommit(ieee, Number(n), lightPayload(ieee, n, { color_temp: Number(mired) }));
      };
    });
    r.querySelectorAll('[data-lthue]').forEach((el) => {
      const stampHot = () => { el._z2mHot = Date.now(); };
      el.onpointerdown = stampHot;
      el.oninput = () => {
        stampHot();
        const [ieee, n] = el.dataset.lthue.split('|');
        const sat = this.shadowRoot.getElementById(`lt${n}-sat`);
        if (sat) sat.style.setProperty('--gs-track', `linear-gradient(to right, #fff, hsl(${el.value},100%,50%))`);
      };
      el.onchange = () => {
        const [ieee, n] = el.dataset.lthue.split('|');
        const sat = this.shadowRoot.getElementById(`lt${n}-sat`);
        const satVal = sat ? Number(sat.value) : 100;
        const d = this._dev(ieee);
        const expose = d && this._lightExposes(d)[Number(n)];
        if (!expose) return;
        this._lightCommit(ieee, Number(n), lightPayload(ieee, n, this._lightColorPayload(expose, Number(el.value), satVal)));
      };
    });
    r.querySelectorAll('[data-ltsat]').forEach((el) => {
      const stampHot = () => { el._z2mHot = Date.now(); };
      el.onpointerdown = stampHot;
      el.oninput = stampHot;
      el.onchange = () => {
        const [ieee, n] = el.dataset.ltsat.split('|');
        const hue = this.shadowRoot.getElementById(`lt${n}-hue`);
        const hueVal = hue ? Number(hue.value) : 0;
        const d = this._dev(ieee);
        const expose = d && this._lightExposes(d)[Number(n)];
        if (!expose) return;
        this._lightCommit(ieee, Number(n), lightPayload(ieee, n, this._lightColorPayload(expose, hueVal, Number(el.value))));
      };
    });
    // The hex readout (§4.7): tap swaps it for an inline field; Enter/blur
    // commits through the same hue/saturation-or-xy write path the sliders
    // use, Escape or an empty blur just restores the readout.
    r.querySelectorAll('[data-lthexedit]').forEach((el) => {
      el.onclick = () => {
        const [ieee, n] = el.dataset.lthexedit.split('|');
        this._lightSetHexEditing(ieee, Number(n), true);
        const field = this.shadowRoot.getElementById(`lt${n}-hexfield`);
        if (field) {
          field.focus();
          if (field.setSelectionRange) field.setSelectionRange(0, field.value.length);
        }
      };
    });
    r.querySelectorAll('[data-lthexcommit]').forEach((el) => {
      const [ieee, n] = el.dataset.lthexcommit.split('|');
      const cancel = () => this._lightSetHexEditing(ieee, Number(n), false);
      const commit = () => {
        const raw = el.value.trim();
        if (raw === '') return cancel();
        if (!/^#?[0-9a-f]{6}$/i.test(raw)) {
          if (el.classList) el.classList.add('invalid');
          this._lightShowError(Number(n), 'Use six hex digits, like #ff8800');
          return;
        }
        if (el.classList) el.classList.remove('invalid');
        this._lightClearError(Number(n));
        const d = this._dev(ieee);
        const expose = d && this._lightExposes(d)[Number(n)];
        if (!expose) return cancel();
        const rgb = hexToRgb(raw.startsWith('#') ? raw : `#${raw}`);
        const hsv = rgbToHsv(rgb.r, rgb.g, rgb.b);
        this._lightSetHexEditing(ieee, Number(n), false);
        this._lightCommit(ieee, Number(n), lightPayload(ieee, n, this._lightColorPayload(expose, hsv.h, hsv.s * 100)));
      };
      el.onkeydown = (ev) => {
        if (ev.key === 'Enter') { ev.preventDefault(); commit(); }
        else if (ev.key === 'Escape') { ev.preventDefault(); cancel(); }
      };
      el.onblur = commit;
    });
    r.querySelectorAll('[data-lttemp]').forEach((el) => {
      const stampHot = () => { el._z2mHot = Date.now(); };
      el.onpointerdown = stampHot;
      el.oninput = () => {
        stampHot();
        const [ieee, n] = el.dataset.lttemp.split('|');
        const d = this._dev(ieee);
        const expose = d && this._lightExposes(d)[Number(n)];
        const tempF = expose && this._lightFeature(expose, 'color_temp');
        if (!tempF) return;
        const mired = tempPositionToMired(Number(el.value), tempF.value_min, tempF.value_max);
        const readout = this.shadowRoot.getElementById(`lt${n}-tk`);
        if (readout) readout.textContent = `${miredToKelvinDisplay(mired)} K`;
      };
      el.onchange = () => {
        const [ieee, n] = el.dataset.lttemp.split('|');
        const d = this._dev(ieee);
        const expose = d && this._lightExposes(d)[Number(n)];
        const tempF = expose && this._lightFeature(expose, 'color_temp');
        if (!tempF) return;
        const mired = tempPositionToMired(Number(el.value), tempF.value_min, tempF.value_max);
        this._lightCommit(ieee, Number(n), lightPayload(ieee, n, { color_temp: mired }));
      };
    });
    r.querySelectorAll('[data-change]').forEach((el) => {
      el.onchange = () => this._change(el.dataset.change, el);
    });

    // Settings editors (§3.3). Every commit ultimately calls _settingsCommit,
    // which routes an expose to z2m/device/set and a converter option to
    // z2m/device/options and drives the row's write-lifecycle chip either way.
    r.querySelectorAll('[data-setswitch]').forEach((el) => {
      el.onchange = () => {
        const [ieee, key] = el.dataset.setswitch.split('|');
        const d = this._dev(ieee);
        const entry = d && this._settingsFindEntry(d, key);
        if (!entry) return;
        const e = entry.expose;
        this._settingsCommit(ieee, entry, el.checked
          ? (e.value_on === undefined ? true : e.value_on)
          : (e.value_off === undefined ? false : e.value_off));
      };
    });
    r.querySelectorAll('[data-setseg]').forEach((el) => {
      el.onclick = () => {
        const [ieee, key, which] = el.dataset.setseg.split('|');
        const d = this._dev(ieee);
        const entry = d && this._settingsFindEntry(d, key);
        if (!entry) return;
        const e = entry.expose;
        this._settingsCommit(ieee, entry, which === 'on'
          ? (e.value_on === undefined ? true : e.value_on)
          : (e.value_off === undefined ? false : e.value_off));
      };
    });
    r.querySelectorAll('[data-setenum]').forEach((el) => {
      const commit = () => {
        if (el.value === '') return;
        const [ieee, key] = el.dataset.setenum.split('|');
        const d = this._dev(ieee);
        const entry = d && this._settingsFindEntry(d, key);
        if (entry) this._settingsCommit(ieee, entry, el.value);
      };
      // ha-select's own change never fires; the native fallback has no `selected`
      // event -- assigning both this way needs no per-kind branch and, unlike
      // `addEventListener` here, is safe to redo on every _wire() pass.
      el.onchange = commit;
      if (!el._z2mSetEnum) {
        el._z2mSetEnum = true;
        el.addEventListener('selected', commit);
      }
    });
    r.querySelectorAll('[data-setnum]').forEach((el) => {
      const [ieee, key] = el.dataset.setnum.split('|');
      const commit = () => this._settingsCommitNumber(ieee, key, el);
      el.onkeydown = (ev) => {
        if (ev.key === 'Enter') {
          ev.preventDefault();
          commit();
        } else if (ev.key === 'Escape') {
          ev.preventDefault();
          el.value = el.dataset.value;
          if (el.classList) el.classList.remove('invalid');
        }
      };
      el.onblur = () => {
        commit();
        // The row may have settled (adjusted/confirmed) while this field still
        // had focus, in which case _settingsPaintCtl skipped it; blur is
        // exactly the resync point §3.4 calls for.
        const d = this._dev(ieee);
        const entry = d && this._settingsFindEntry(d, key);
        if (entry) this._settingsPaintCtl(ieee, entry);
      };
    });
    r.querySelectorAll('[data-settext]').forEach((el) => {
      const [ieee, key] = el.dataset.settext.split('|');
      const commit = () => this._settingsCommitText(ieee, key, el);
      el.onkeydown = (ev) => {
        if (ev.key === 'Enter') {
          ev.preventDefault();
          commit();
        } else if (ev.key === 'Escape') {
          ev.preventDefault();
          el.value = el.dataset.value;
        }
      };
      el.onblur = () => {
        commit();
        const d = this._dev(ieee);
        const entry = d && this._settingsFindEntry(d, key);
        if (entry) this._settingsPaintCtl(ieee, entry);
      };
    });
    r.querySelectorAll('[data-gs]').forEach((el) => {
      const stampHot = () => { el._z2mHot = Date.now(); };
      el.onpointerdown = stampHot;
      el.oninput = () => { stampHot(); this._gsliderInput(el); };
      el.onchange = () => this._gsliderCommit(el);
      el.onkeydown = (ev) => {
        stampHot();
        if (!ev || !/^Arrow/.test(ev.key)) return;
        clearTimeout(el._z2mKeyTimer);
        el._z2mKeyTimer = setTimeout(() => this._gsliderCommit(el), 400);
      };
    });
    r.querySelectorAll('[data-setpresetchip]').forEach((el) => {
      el.onclick = () => {
        const [ieee, key, idx] = el.dataset.setpresetchip.split('|');
        const d = this._dev(ieee);
        const entry = d && this._settingsFindEntry(d, key);
        const preset = entry && (entry.expose.presets || [])[Number(idx)];
        if (preset) this._settingsCommit(ieee, entry, preset.value);
      };
    });
    r.querySelectorAll('[data-setntemp]').forEach((el) => {
      const [ieee, key] = el.dataset.setntemp.split('|');
      const commit = () => this._settingsCommitNTemp(ieee, key, el);
      el.onkeydown = (ev) => {
        if (ev.key === 'Enter') { ev.preventDefault(); commit(); }
        else if (ev.key === 'Escape') { ev.preventDefault(); el.value = el.dataset.value; }
      };
      el.onblur = commit;
    });
    r.querySelectorAll('[data-setdurval]').forEach((el) => {
      const [ieee, key] = el.dataset.setdurval.split('|');
      const commit = () => this._settingsCommitDuration(ieee, key, el);
      el.onkeydown = (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); commit(); } };
      el.onblur = commit;
    });
    r.querySelectorAll('[data-setdurunit]').forEach((el) => {
      el.onclick = () => {
        const [ieee, key, unit] = el.dataset.setdurunit.split('|');
        this._settingsDurationSetUnit(ieee, key, unit);
      };
    });
    r.querySelectorAll('[data-setfeatchip]').forEach((el) => {
      el.onclick = () => {
        const [ieee, key, prop, val] = el.dataset.setfeatchip.split('|');
        const store = (this._settingsDraft[ieee] = this._settingsDraft[ieee] || {});
        (store[key] = store[key] || {})[prop] = val;
        this._settingsRepaintFeature(ieee, key, prop);
      };
    });
    r.querySelectorAll('[data-setfeatdurval]').forEach((el) => {
      el.onchange = () => {
        const [ieee, key, prop] = el.dataset.setfeatdurval.split('|');
        this._settingsFeatureDurationSetVal(ieee, key, prop, el);
      };
    });
    r.querySelectorAll('[data-setfeatdurunit]').forEach((el) => {
      el.onclick = () => {
        const [ieee, key, prop, unit] = el.dataset.setfeatdurunit.split('|');
        this._settingsFeatureDurationSetUnit(ieee, key, prop, unit);
      };
    });
    r.querySelectorAll('[data-setfeatslider]').forEach((el) => {
      el.onpointerdown = () => { el._z2mHot = Date.now(); };
      el.oninput = () => { el._z2mHot = Date.now(); };
    });
    r.querySelectorAll('[data-setlistdel]').forEach((el) => {
      el.onclick = () => {
        const [ieee, key, idx] = el.dataset.setlistdel.split('|');
        const arr = this._settingsListDraft[`${ieee}|${key}`];
        if (!arr) return;
        arr.splice(Number(idx), 1);
        this._settingsRepaintControl(ieee, key);
      };
    });
    r.querySelectorAll('[data-setlistadd]').forEach((el) => {
      el.onclick = () => {
        const [ieee, key] = el.dataset.setlistadd.split('|');
        const d = this._dev(ieee);
        const entry = d && this._settingsFindEntry(d, key);
        if (!entry) return;
        const input = r.getElementById(`setlistval-${this._settingsDomId(entry)}`);
        const n = input && Number(input.value);
        if (!input || input.value === '' || !Number.isFinite(n)) return;
        const draftKey = `${ieee}|${key}`;
        const arr = (this._settingsListDraft[draftKey] = this._settingsListDraft[draftKey] || []);
        arr.push(n);
        input.value = '';
        this._settingsRepaintControl(ieee, key);
      };
    });
    r.querySelectorAll('[data-setlistapply]').forEach((el) => {
      el.onclick = () => {
        const [ieee, key] = el.dataset.setlistapply.split('|');
        const d = this._dev(ieee);
        const entry = d && this._settingsFindEntry(d, key);
        if (!entry) return;
        this._settingsCommit(ieee, entry, (this._settingsListDraft[`${ieee}|${key}`] || []).slice());
      };
    });
    // Composite (J) nested features: touching one records it in the draft and
    // makes it definite; only Apply actually writes anything.
    r.querySelectorAll('[data-setfeat]').forEach((el) => {
      el.onchange = () => {
        const [ieee, key, prop] = el.dataset.setfeat.split('|');
        const store = (this._settingsDraft[ieee] = this._settingsDraft[ieee] || {});
        const draft = (store[key] = store[key] || {});
        const kind = el.dataset.setfeatkind;
        draft[prop] = kind === 'binary' ? !!el.checked : kind === 'numeric' ? Number(el.value) : el.value;
        if (el.indeterminate !== undefined) el.indeterminate = false;
      };
    });
    r.querySelectorAll('[data-indeterminate]').forEach((el) => {
      el.indeterminate = true;
    });
    r.querySelectorAll('[data-setapply]').forEach((el) => {
      el.onclick = () => {
        const [ieee, key] = el.dataset.setapply.split('|');
        this._settingsApplyComposite(ieee, key);
      };
    });
    r.querySelectorAll('[data-setaction]').forEach((el) => {
      el.onclick = () => {
        const [ieee, prop] = el.dataset.setaction.split('|');
        this._settingsActionClick(ieee, prop);
      };
    });
    // Converter options / Diagnostic groups and every composite row remember
    // their own open state (§3.6) so a session revisit, or the filter clearing,
    // can put them back the way the operator left them.
    r.querySelectorAll('[data-setgrouptoggle]').forEach((el) => {
      if (el._z2mGroupToggle) return;
      el._z2mGroupToggle = true;
      const [ieee, key] = el.dataset.setgrouptoggle.split('|');
      const remember = (open) => {
        const store = (this._settingsOpen[ieee] = this._settingsOpen[ieee] || {});
        store[key] = open;
      };
      el.addEventListener('expanded-changed', (ev) => remember(!!(ev.detail || {}).expanded));
      el.addEventListener('toggle', () => remember(!!el.open));
    });
    r.querySelectorAll('[data-descmore]').forEach((el) => {
      el.onclick = () => {
        const id = el.dataset.descmore;
        const box = r.getElementById(`setdesc-${id}`);
        if (!box || !box.classList) return;
        const expanded = box.classList.toggle('expanded');
        el.textContent = expanded ? 'Less' : 'More';
      };
    });

    const pairLog = r.querySelector('#pairlog');
    if (pairLog) {
      // Scrolling up is itself a request to stop following; scrolling back to the
      // bottom resumes it. Only the button is re-labelled here: a full repaint
      // would replace this very element, and that is what used to throw the
      // operator back to the top of the buffer mid-read.
      pairLog.onscroll = () => {
        const atBottom = pairLog.scrollHeight - pairLog.scrollTop - pairLog.clientHeight < 24;
        if (this._pairing.follow !== atBottom) {
          this._pairing.follow = atBottom;
          if (atBottom) this._pairing.unread = 0;
          this._syncPairFollow();
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
      // Sub-views step back through the panel's own view state. The top level
      // matches HA's Z-Wave dashboard exactly: a back arrow to Settings via
      // back-path, never a menu button, so the header reads the same from the
      // sidebar, from Configure, and inside the companion apps.
      page.backCallback = this._view.name === 'dashboard' ? undefined : () => this._back();
    }

    const q = r.getElementById('q');
    const qclear = r.getElementById('qclear');
    if (qclear) qclear.hidden = !this._filter;
    // Typing must never run _render(): that rebuilds every HA component in the
    // results list and takes the caret with it. _patchDeviceSearch rewrites only
    // the results region and the live count; this row's value is read back by
    // _render's own focus/caret restore whenever a real push causes a full one.
    if (q) {
      q.oninput = () => {
        this._filter = q.value;
        try {
          this._filterCaret = q.selectionStart;
        } catch (_) {
          this._filterCaret = null; // some hosts do not expose a selection range
        }
        this._patchDeviceSearch();
      };
      q.onkeydown = (ev) => {
        if (ev.key !== 'Escape' || !this._filter) return;
        ev.preventDefault();
        this._clearDeviceSearch();
      };
    }

    const setfilter = r.getElementById('setfilter');
    const setfilterclear = r.getElementById('setfilterclear');
    if (setfilterclear) setfilterclear.hidden = !this._setFilter;
    if (setfilter) {
      setfilter.oninput = () => {
        this._setFilter = setfilter.value;
        try {
          this._setFilterCaret = setfilter.selectionStart;
        } catch (_) {
          this._setFilterCaret = null;
        }
        this._settingsApplyFilter();
        if (setfilterclear) setfilterclear.hidden = !this._setFilter;
      };
      setfilter.onkeydown = (ev) => {
        if (ev.key !== 'Escape' || !this._setFilter) return;
        ev.preventDefault();
        this._clearSettingsFilter();
      };
    }

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

    if (this._view.name === 'device') {
      this._lastFw = this._fwInner(this._dev(this._view.ieee) || {});
      this._paintSettingsReadButton(this._view.ieee);
    }
    if (this._view.name === 'diagnostics') this._lastCoord = this._coordInner();
    this._startTicker();
  }

  _back() {
    if (this._view.name === 'device') this._go({ name: 'devices' });
    else if (this._view.name === 'binds') this._go({ name: 'device', ieee: this._view.ieee });
    else if (this._view.name === 'group') this._go({ name: 'groups' });
    else this._go({ name: 'dashboard' });
  }

  _go(view) {
    this._navigate(view, true);
  }

  /**
   * Every panel-internal navigation funnels through here. `push` is false
   * only when the URL already says this -- Home Assistant's `route` setter or
   * a native `popstate` -- so the two never fight over the same history
   * entry (§ routing).
   */
  _navigate(view, push) {
    this._leave();
    this._view = view;
    this._filter = '';
    this._filterCaret = null;
    this._setFilter = '';
    this._setFilterCaret = null;
    if (push) this._pushRoute(view);
    this._render();
    // The scroller is the chrome's content region: hass-subpage's .content when
    // the native shell is up, the fallback's #scroll otherwise. The host itself
    // never scrolls (overflow:hidden), so resetting it would be a no-op.
    const fallback = this.shadowRoot.getElementById('scroll');
    if (fallback) fallback.scrollTop = 0;
    const page = this.shadowRoot.getElementById('page');
    const content = page && page.shadowRoot && page.shadowRoot.querySelector('.content');
    if (content) content.scrollTop = 0;
  }

  /** Pushes a real history entry for `view`, so the browser's own Back walks
   * panel views one at a time instead of leaving the panel on the first press. */
  _pushRoute(view) {
    if (typeof history === 'undefined' || !history.pushState) return;
    const path = this._routePath(view);
    history.pushState(null, '', `/z2m${path ? `/${path}` : ''}`);
  }


  /** Tear down whatever the view being left had running. */
  _leave() {
    if (this._view.name === 'logs') this._unsub('logs');
    if (this._view.name === 'device') this._unsub('devstate');
    // The dialog floats above whatever view is beneath it, and navigating out
    // from under it would leave the network open with nothing on screen
    // saying so. `_navigate` is about to push (or already answered) its own
    // history entry for wherever this is going, so the dialog's own '#pair'
    // entry is not this close's to pop -- see _closePairDialog.
    if (this._pairing.open) this._closePairDialog(true);
    if (this._view.name === 'map') {
      this._unsub('map');
      this._unsub('scan');
      this._map.scan.scanning = false;
      this._map.scan.phase = null;
    }
    if (this._view.name === 'diagnostics') this._stopEnergyPoll();
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
    if (this._view.name === 'diagnostics') {
      if (!this._diag.checked) this._runCoordinatorCheck();
      if (!this._diag.meshLoaded) this._loadMeshHealth();
      if (!this._diag.scansLoaded) this._loadScans();
      // Coming back mid-scan: the run's own promise is still in flight; the status
      // polling is view-local and restarts here.
      if (this._diag.scan.running) this._startEnergyPoll();
    }
    if (this._view.name === 'binds' && this._binds.ieee !== this._view.ieee) {
      this._openBinds(this._view.ieee);
    }
    if (this._view.name === 'bindsall' && !this._bindsAll.data && !this._bindsAll.loading) {
      this._openBindsAll();
    }
    // Freshen what the device page shows, the way Z2M's own UI does with its
    // per-field refresh arrows -- except all at once and unprompted. One MQTT get
    // covers every readable attribute, so for a powered device this is a burst of
    // unicast reads to that one device: negligible, and worth it for the operator
    // never seeing a stale toggle. Sleeping battery devices are skipped -- they
    // would only queue until wake-up; the Refresh button covers them honestly.
    if (this._view.name === 'device') {
      const d = this._dev(this._view.ieee);
      // The state mirror (§1) is server-side and refcounted per device; watching
      // it is what lets Settings show values without ever baking one into the
      // page markup (see the settings section preamble).
      if (d && !this._subs.devstate) {
        this._sub('devstate', { type: 'z2m/device/state/subscribe', device: d.ieee_address }, (ev) =>
          this._onDeviceState(d.ieee_address, ev)
        )
          .then(() => {
            if (!this._deviceStateError[d.ieee_address]) return;
            delete this._deviceStateError[d.ieee_address];
            this._render();
          })
          .catch((err) => {
            this._deviceStateError[d.ieee_address] = this._feedMessage(err, 'Could not read live values');
            this._render();
          });
      }
      this._readValues = this._readValues || {};
      if (d && d.availability !== 'offline' && d.power_source === 'Mains (single phase)'
          && !this._readValues[d.ieee_address]) {
        this._readValues[d.ieee_address] = true;
        this._readDeviceValues(d.ieee_address);
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
              <br><small>Zigbee2MQTT ${esc(String(s.version || '?'))}</small>
            </div>
            <img class="logo" alt="Zigbee2MQTT" src="/api/panel_custom/z2m/brand-logo.png">
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
        <div class="card-header nowrap">My network
          <span class="header-actions">
            <ha-button appearance="filled" size="s" data-act="map">${icon(MDI.map)}Show map</ha-button>
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
            icon: MDI.link,
            headline: 'Bindings',
            text: 'Which devices control each other directly, radio to radio',
            go: 'bindsall',
          }) +
          row({
            icon: MDI.diagnostics,
            headline: 'Diagnostics',
            text: 'Mesh health, coordinator status and channel energy scan',
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

  /** The devices search predicate, shared by the initial render and the typed patch. */
  _deviceSearchMatches() {
    const f = this._filter.toLowerCase();
    return this._devices.filter(
      (d) =>
        !f ||
        (d.friendly_name || '').toLowerCase().includes(f) ||
        (d.model || '').toLowerCase().includes(f) ||
        (d.vendor || '').toLowerCase().includes(f)
    );
  }

  /**
   * The results region alone: the table, the compact list, or the no-match state.
   * Split out so typing can rewrite just this element (`#devrows`) instead of
   * running `_render()`, which is what used to steal the caret on every keystroke.
   */
  _devRowsHtml(matches) {
    if (!matches.length) {
      return `<div class="empty">No devices match &ldquo;${esc(this._filter)}&rdquo;.
          <div class="actions"><ha-button appearance="plain" size="s"
            data-act="devsearchclear">Clear search</ha-button></div>
        </div>`;
    }
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
    return `${this._devicesTable(matches)}<div class="dlist">${list(rows)}</div>`;
  }

  /** Rewrites the results region and the live count in place, never the search row. */
  _patchDeviceSearch() {
    const r = this.shadowRoot;
    if (!r) return;
    const box = r.getElementById('devrows');
    if (!box) return;
    const matches = this._deviceSearchMatches();
    box.innerHTML = this._devRowsHtml(matches);
    this._wire(box);
    const count = r.getElementById('qcount');
    if (count) count.textContent = `${matches.length} of ${this._devices.length}`;
    const clearBtn = r.getElementById('qclear');
    if (clearBtn) clearBtn.hidden = !this._filter;
  }

  /** Same patch path as typing, so clearing returns focus without a render. */
  _clearDeviceSearch() {
    this._filter = '';
    this._filterCaret = null;
    const q = this.shadowRoot.getElementById('q');
    if (q) {
      q.value = '';
      q.focus();
    }
    this._patchDeviceSearch();
  }

  _devicesView() {
    const matches = this._deviceSearchMatches();
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
          <span class="count" id="qcount" aria-live="polite">${matches.length} of ${
            this._devices.length
          }</span>
          <ha-icon-button id="qclear" data-act="devsearchclear" data-path="${MDI.close}"
            data-label="Clear search" aria-label="Clear search"></ha-icon-button>
        </div>
        <div class="card-content"><div id="devrows">${this._devRowsHtml(matches)}</div></div>
      </ha-card>`;
  }

  /**
   * The same devices as a real table for tablet width: name, model, area,
   * availability and mesh role, the way HA's own device table reads. The compact
   * rows stay in the markup for phones; the stylesheet decides which is visible.
   * There is deliberately no LQI column: this fleet's linkquality entities are
   * disabled by choice, so it could only ever render a column of dashes.
   */
  _devicesTable(matches) {
    const h = this._hass || {};
    // ieee -> HA registry device, in one pass over the registry rather than one
    // scan per row.
    const byTag = {};
    Object.values(h.devices || {}).forEach((dev) => {
      (dev.identifiers || []).forEach((pair) => {
        const tag = String((pair || [])[1] || '').toLowerCase();
        if (tag.startsWith('zigbee2mqtt_')) byTag[tag.slice(12)] = dev;
      });
    });
    const cells = matches
      .map((d) => {
        const haDev = byTag[String(d.ieee_address).toLowerCase()];
        const areaId = haDev && haDev.area_id;
        const area = areaId ? (((h.areas || {})[areaId] || {}).name || areaId) : '';
        const role =
          d.type === 'Router'
            ? 'Router'
            : d.type === 'Coordinator'
              ? 'Coordinator'
              : d.power_source === 'Battery'
                ? 'Battery device'
                : 'End device';
        const off = d.availability === 'offline';
        return `<div class="dtab-row" role="button" tabindex="0" data-ieee="${esc(d.ieee_address)}">
            <span class="dtab-name">${esc(d.friendly_name || d.ieee_address)}</span>
            <span class="dtab-dim">${esc(
              [d.vendor, d.model].filter(Boolean).join(' \u00b7 ') || 'Unknown model'
            )}</span>
            <span class="dtab-dim">${esc(area || '\u2014')}</span>
            <span><span class="chip ${off ? 'off' : 'ok'}">${off ? 'offline' : 'online'}</span></span>
            <span class="dtab-dim">${esc(role)}</span>
          </div>`;
      })
      .join('');
    return `<div class="dtab">
        <div class="dtab-row dtab-head"><span>Name</span><span>Model</span><span>Area</span><span>Availability</span><span>Type</span></div>
        ${cells}
      </div>`;
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
    // because that is what the operator opens the page for. One flat sequence of
    // cards: the masonry columns flow and balance them on a tablet, and the identity
    // table stays folded away.
    return `<div class="devgrid">${
      offline
        ? `<ha-alert alert-type="warning" title="Offline">
             Zigbee2MQTT has not heard from this device within its availability
             window. Controls will queue or fail until it is heard again.
           </ha-alert>`
        : ''
    }${feed}${this._controlsCard(d, live)}${this._sensorsCard(live)}${this._settingsCard(
      d
    )}<ha-card class="nav-card"><div id="fwbox">${this._fwInner(
      d
    )}</div></ha-card><ha-card class="nav-card">
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
        </ha-card><ha-card class="nav-card">
          <div class="card-header">Rename</div>
          <div class="card-content pad">
            ${this._textField(`rename:${d.ieee_address}`, {
              label: 'Friendly name',
              helper: 'Moves the MQTT topic. Existing entity IDs keep their old name',
              value: d.friendly_name || '',
            })}
          </div>
          <div class="actions">
            <ha-button appearance="filled" size="s" data-act="rename">Rename</ha-button>
          </div>
        </ha-card><ha-card class="nav-card">
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
        </ha-card></div>`;
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

  _controlsCard(d, live) {
    // Light rows are replaced by the light block (§4) when the state feed is
    // up; every other row, and light itself when the feed is down, keeps the
    // entity-driven row unchanged (§2.7/§4.10's degraded path). A light
    // expose renders its block even with no HA entity paired yet -- MQTT
    // discovery can lag the Zigbee2MQTT inventory this page already has.
    const lightExposes = this._lightExposes(d);
    const lightEntities = live.controls.filter((item) => item.domain === 'light');
    const feedUp = !this._deviceStateError[d.ieee_address];
    if (!live.controls.length && !(feedUp && lightExposes.length)) return '';
    const seen = new Set();
    const rows = live.controls
      .map((item) => {
        if (item.domain !== 'light' || !feedUp) return this._controlRow(item);
        const n = lightEntities.indexOf(item);
        const expose = lightExposes[n];
        if (!expose) return this._controlRow(item);
        seen.add(n);
        return `<div class="lt" id="lt${n}" data-lt="${n}">${this._lightBlockHtml(d, expose, n, item)}</div>`;
      })
      .join('');
    const extra = feedUp
      ? lightExposes
          .map((expose, n) => (seen.has(n) ? '' : `<div class="lt" id="lt${n}" data-lt="${n}">${this._lightBlockHtml(d, expose, n, this._lightFallbackEntity(d))}</div>`))
          .join('')
      : '';
    const alert = !feedUp
      ? `<ha-alert alert-type="warning">Live values are unavailable, so lights fall back to Home Assistant's own controls.</ha-alert>`
      : '';
    return `<ha-card class="nav-card">
        <div class="card-header">Controls${live.refreshBtn
          ? `<span class="header-actions">${live.refreshBtn}</span>` : ''}</div>
        <div class="card-content">${alert}${rows}${extra}</div>
      </ha-card>`;
  }

  /** A stand-in entity item for `_entityName`, when a light expose has no
   * paired HA entity yet (MQTT discovery lag, or a headless test fixture). */
  _lightFallbackEntity(d) {
    return { eid: null, domain: 'light', st: { attributes: { friendly_name: d.friendly_name } } };
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

  /* --------------------------------------------------------- light block */

  _lightExposes(d) {
    return (d.exposes || []).filter((e) => e && e.type === 'light');
  }

  _lightFeature(expose, name) {
    return (expose.features || []).find((f) => f && f.name === name);
  }

  /** Composed light state (§4.2), read from the same state mirror Settings
   * uses -- one subscription, two consumers (`_syncSettings`, `_syncLight`). */
  _lightState(d, expose) {
    const raw = this._settingsState[d.ieee_address] || {};
    const stateF = this._lightFeature(expose, 'state');
    const brightF = this._lightFeature(expose, 'brightness');
    const tempF = this._lightFeature(expose, 'color_temp');
    const hsF = this._lightFeature(expose, 'color_hs');
    const xyF = this._lightFeature(expose, 'color_xy');
    const hasStateVal = !!stateF && Object.prototype.hasOwnProperty.call(raw, stateF.property);
    const on = hasStateVal ? raw[stateF.property] === (stateF.value_on === undefined ? true : stateF.value_on) : null;
    const briKnown = !!brightF && Object.prototype.hasOwnProperty.call(raw, brightF.property);
    const briMax = brightnessMax(brightF || {});
    const briWire = briKnown ? Number(raw[brightF.property]) : null;
    const pct = briKnown ? brightnessToPct(briWire, briMax) : null;
    const tempKnown = !!tempF && Object.prototype.hasOwnProperty.call(raw, tempF.property);
    const mired = tempKnown ? Number(raw[tempF.property]) : null;
    const color = raw.color || {};
    const rawHue = typeof color.hue === 'number' ? color.hue : null;
    const rawSat = typeof color.saturation === 'number' ? color.saturation : null;
    const x = typeof color.x === 'number' ? color.x : null;
    const y = typeof color.y === 'number' ? color.y : null;
    const rawMode = raw.color_mode;
    const inTemp = rawMode === 'color_temp' || (!rawMode && tempKnown && rawHue === null && x === null);
    // Display hue/saturation: the bulb's own hs state when it has one,
    // otherwise derived from xy (rgbToHsv(xyToRgb(x,y))) so an xy-only bulb
    // (no color_hs feature at all) still drives the color panel's thumbs
    // and the state line's hue name (§4.2 amendment for xy-only fixtures).
    let hue = rawHue;
    let sat = rawSat;
    if (hue === null && sat === null && x !== null && y !== null) {
      const rgb = xyToRgb(x, y);
      const hsv = rgbToHsv(rgb.r, rgb.g, rgb.b);
      hue = hsv.h;
      sat = hsv.s * 100;
    }
    let hex = null;
    if (inTemp && tempKnown) hex = swatchHex(1e6 / mired);
    else if (hue !== null && sat !== null) hex = hsToHex(hue, sat);
    return {
      known: hasStateVal || briKnown || tempKnown || hue !== null || x !== null,
      on,
      pct,
      briWire,
      briMax,
      colorMode: inTemp ? 'color_temp' : rawHue !== null ? 'hs' : x !== null ? 'xy' : null,
      mired,
      hue,
      sat,
      x,
      y,
      hex,
      hasTemp: !!tempF,
      hasColor: !!(hsF || xyF),
      hasHs: !!hsF,
      hasXy: !!xyF,
      hasBright: !!brightF,
      tempF,
      brightF,
      stateF,
    };
  }

  _lightAlphaRgb(hex, alpha) {
    const c = hexToRgb(hex);
    return `rgba(${c.r},${c.g},${c.b},${alpha})`;
  }

  /** The one write shape for any hue/saturation the operator picked --
   * slider, chip, or the hex field: `{color:{hue,saturation}}` when the
   * bulb exposes color_hs, else converted to `{color:{x,y}}` for an xy-only
   * bulb, so the echo the write lifecycle compares against is in the same
   * shape the device itself reports (never a phantom "Device set"). */
  _lightColorPayload(expose, hue, sat) {
    if (this._lightFeature(expose, 'color_hs')) return { color: { hue, saturation: sat } };
    const xy = hsToXy(hue, sat);
    return { color: { x: xy.x, y: xy.y } };
  }

  _lightHexEditing(ieee, n) {
    return !!(((this._lightUI[ieee] || {})[n] || {}).editingHex);
  }

  _lightSetHexEditing(ieee, n, editing) {
    this._lightUI[ieee] = this._lightUI[ieee] || {};
    this._lightUI[ieee][n] = this._lightUI[ieee][n] || {};
    this._lightUI[ieee][n].editingHex = editing;
    this._paintLightHex(ieee, n);
  }

  /** The hex readout (§4.7): a plain button, or -- tapped -- a 96px field
   * prefilled without the leading #, matching the brightness/kelvin
   * readouts' own tap-to-edit affordance. */
  _lightHexWrapHtml(ieee, n, s) {
    if (this._lightHexEditing(ieee, n)) {
      const val = (s.hex || '').replace(/^#/, '');
      return `<input type="text" class="fallback lt-hexfield" id="lt${n}-hexfield"
          data-lthexcommit="${esc(ieee)}|${n}" value="${esc(val)}" maxlength="6" placeholder="rrggbb">`;
    }
    return `<button type="button" class="linklike" id="lt${n}-hex" data-lthexedit="${esc(ieee)}|${n}">${
      s.hex || '\u2014'
    }</button>`;
  }

  /** Repaints only the hex wrap -- entering/leaving edit mode is a UI-local
   * toggle, not a value the device echoed, so it does not wait for _syncLight. */
  _paintLightHex(ieee, n) {
    const r = this.shadowRoot;
    const wrap = r && r.getElementById(`lt${n}-hexwrap`);
    const d = this._dev(ieee);
    const expose = d && this._lightExposes(d)[n];
    if (!wrap || !expose) return;
    wrap.innerHTML = this._lightHexWrapHtml(ieee, n, this._lightState(d, expose));
    this._wire(wrap);
  }

  _lightShowError(n, message) {
    const err = this.shadowRoot && this.shadowRoot.getElementById(`lt${n}-err`);
    if (!err) return;
    err.hidden = false;
    err.textContent = message;
  }

  _lightClearError(n) {
    const err = this.shadowRoot && this.shadowRoot.getElementById(`lt${n}-err`);
    if (!err) return;
    err.hidden = true;
    err.textContent = '';
  }

  /** The block's one lifecycle chip (§4.3/§4.9): pending stays silent for
   * the first 400ms (`write.slow` flips once that timer fires). */
  _lightChipHtml(write) {
    if (!write || !write.phase) return '';
    if (write.phase === 'pending') return write.slow ? 'Sending\u2026' : '';
    if (write.phase === 'adjusted') return `Device set ${esc(write.message || '')}`;
    const spec = SETTINGS_CHIP[write.phase];
    return spec ? spec[0] : '';
  }

  /** The curated temperature chips (§4.6), snapped to the device's own
   * bounds when within 5 mired and hidden entirely outside them. */
  _lightTempChipsHtml(ieee, n, s) {
    const min = s.tempF.value_min;
    const max = s.tempF.value_max;
    return TEMP_CHIPS.map((c) => {
      let mired = kelvinToMired(c.kelvin);
      if (Math.abs(mired - min) <= 5) mired = min;
      if (Math.abs(mired - max) <= 5) mired = max;
      if (mired < min || mired > max) return '';
      const active = s.mired !== null && Math.abs(s.mired - mired) <= 5;
      return `<button type="button" class="pchip" aria-pressed="${active}"
          data-lttchip="${esc(ieee)}|${n}|${mired}"><span class="dot" style="background:${c.dot}"></span>${
        c.name
      }</button>`;
    }).join('');
  }

  /**
   * The light block (§4): one per light expose, replacing that entity's row.
   * Current values are safe to bake into this string -- like every Settings
   * control, it is diffed by `_syncLight` against its own per-block memo,
   * never against the page-level `_markup` `_render()` compares.
   */
  _lightBlockHtml(d, expose, n, entity) {
    const ieee = d.ieee_address;
    const s = this._lightState(d, expose);
    const name = esc(this._entityName(entity));
    const write = (this._lightWrite[ieee] || {})[n] || {};
    const dis = d.disabled ? ' disabled' : '';

    let swatchStyle;
    let swatchClass = 'lt-swatch';
    if (!s.known) {
      swatchStyle = 'background:var(--secondary-background-color);border:1px dashed var(--divider-color)';
    } else if (s.on === false) {
      swatchStyle = s.hex ? `background:${s.hex};opacity:.35;border:1px solid var(--divider-color)` : 'opacity:.35';
    } else if (s.hex) {
      const a = 0.15 + 0.4 * ((s.pct || 0) / 100);
      swatchStyle = `background:${s.hex};box-shadow:0 0 16px 2px ${this._lightAlphaRgb(s.hex, a)}`;
    } else {
      swatchStyle = 'background:#ffa757';
    }

    let stateText;
    if (!s.known) stateText = '\u2014';
    else if (s.on === false) stateText = 'Off';
    else {
      const bits = ['On'];
      if (s.pct !== null) bits.push(`${s.pct}%`);
      if (s.colorMode === 'color_temp' && s.mired !== null) bits.push(`${miredToKelvinDisplay(s.mired)} K`);
      else if (s.hue !== null && s.sat !== null) bits.push(hueName(s.hue, s.sat));
      stateText = bits.join(' \u00b7 ');
    }
    const chip = this._lightChipHtml(write);

    const switchHtml = this._has('ha-control-switch')
      ? `<ha-control-switch id="lt${n}-switch" data-ltswitch="${esc(ieee)}|${n}"${s.on ? ' checked' : ''}${dis}></ha-control-switch>`
      : `<input type="checkbox" class="fallback-check" id="lt${n}-switch" data-ltswitch="${esc(
          ieee
        )}|${n}"${s.on ? ' checked' : ''}${dis}>`;

    let brightHtml = '';
    if (s.hasBright) {
      const pct = s.pct === null ? 0 : s.pct;
      const ghost = s.on === false;
      const tint = s.hex ? (ghost ? this._lightAlphaRgb(s.hex, 0.35) : s.hex) : 'var(--primary-color)';
      const barHtml = this._has('ha-control-slider')
        ? `<ha-control-slider id="lt${n}-bar" data-ltbar="${esc(
            ieee
          )}|${n}" min="0" max="100" step="1" value="${pct}" style="--control-slider-color:${tint}"${dis}></ha-control-slider>`
        : `<input type="range" class="gslider" id="lt${n}-bar" data-ltbar="${esc(
            ieee
          )}|${n}" min="0" max="100" step="1" value="${pct}"
              style="--gs-track:linear-gradient(to right, ${tint} 0 ${pct}%, var(--divider-color) ${pct}% 100%)"${dis}>`;
      const chips = BRIGHTNESS_CHIPS.map((c) => {
        const wire = pctToBrightness(c, s.briMax);
        const active = s.pct !== null && s.pct === c;
        return `<button type="button" class="pchip" aria-pressed="${active}" data-ltbchip="${esc(
          ieee
        )}|${n}|${wire}">${c}%</button>`;
      }).join('');
      brightHtml = `<div class="lt-row">
          <div class="lt-cap">Brightness<span class="lt-readout" id="lt${n}-barpct">${
        s.pct === null ? '\u2014' : `${s.pct}%`
      }</span></div>
          ${barHtml}
          <div class="pchips" id="lt${n}-bchips">${chips}</div>
        </div>`;
    }

    const hasSeg = s.hasTemp && s.hasColor;
    const showTemp = s.hasTemp && !(hasSeg && (s.colorMode === 'hs' || s.colorMode === 'xy'));
    let segHtml = '';
    if (hasSeg) {
      segHtml = `<div class="lt-row"><div class="seg" id="lt${n}-seg" role="tablist">
          <button type="button" role="tab" aria-selected="${showTemp}" data-ltseg="${esc(
        ieee
      )}|${n}|temp">Temperature</button>
          <button type="button" role="tab" aria-selected="${!showTemp}" data-ltseg="${esc(
        ieee
      )}|${n}|color">Color</button>
        </div></div>`;
    }

    let tempHtml = '';
    if (s.hasTemp) {
      const min = s.tempF.value_min;
      const max = s.tempF.value_max;
      const pos = s.mired !== null ? miredToTempPosition(s.mired, min, max) : 500;
      const label = hasSeg ? '' : '<span>Temperature</span>';
      tempHtml = `<div class="lt-row lt-panel" id="lt${n}-temppanel"${showTemp ? '' : ' hidden'}>
          <div class="lt-cap">${label}<span class="lt-readout" id="lt${n}-tk">${
        s.mired !== null ? `${miredToKelvinDisplay(s.mired)} K` : '\u2014'
      }</span></div>
          <input type="range" class="gslider" id="lt${n}-temp" data-lttemp="${esc(
        ieee
      )}|${n}" min="0" max="1000" step="1"
              value="${pos}" style="--gs-track:${this._tempTrackCss(min, max)}" aria-label="Color temperature"${dis}>
          <div class="pchips" id="lt${n}-tchips">${this._lightTempChipsHtml(ieee, n, s)}</div>
        </div>`;
    }

    let colorHtml = '';
    if (s.hasColor) {
      const hue = s.hue !== null ? s.hue : 30;
      const sat = s.sat !== null ? s.sat : 100;
      colorHtml = `<div class="lt-row lt-panel" id="lt${n}-colorpanel"${showTemp ? ' hidden' : ''}>
          <div class="lt-cap"><span>Hue</span></div>
          <input type="range" class="gslider hue360" id="lt${n}-hue" data-lthue="${esc(
        ieee
      )}|${n}" min="0" max="360" step="1" value="${hue}" aria-label="Hue"${dis}>
          <div class="lt-cap" style="margin-top:var(--ha-space-2, 8px)"><span>Saturation</span></div>
          <input type="range" class="gslider" id="lt${n}-sat" data-ltsat="${esc(
        ieee
      )}|${n}" min="0" max="100" step="1" value="${sat}"
              style="--gs-track:linear-gradient(to right, #fff, hsl(${hue},100%,50%))" aria-label="Saturation"${dis}>
          <div class="lt-hex" id="lt${n}-hexwrap">${this._lightHexWrapHtml(ieee, n, s)}</div>
        </div>`;
    }

    const errHtml = write.message && write.phase === 'failed' ? esc(write.message) : '';
    return `<div class="lt-hero">
          <div class="${swatchClass}" id="lt${n}-swatch" style="${swatchStyle}" aria-hidden="true"></div>
          <div class="lt-info">
            <div class="lt-name">${name}</div>
            <div class="lt-state"><span id="lt${n}-state">${esc(stateText)}</span><span class="chip" id="lt${n}-chip"${
      chip ? '' : ' hidden'
    }>${esc(chip)}</span></div>
          </div>
          ${switchHtml}
        </div>
        ${brightHtml}${segHtml}${tempHtml}${colorHtml}
        <div class="lt-err" id="lt${n}-err"${errHtml ? '' : ' hidden'}>${errHtml}</div>`;
  }

  _sensorsCard(live) {
    if (!live.sensors.length && !live.diags.length) return '';
    const tile = (item, extra) => {
      const st = item.st;
      const on = item.domain === 'binary_sensor' && st.state === 'on';
      return `<div class="sens${extra || ''}" data-sens="${esc(item.eid)}">
          <div class="sens-v${on ? ' on' : ''}">${this._sensReading(item)}</div>
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

  /** One reading as its tile shows it: value plus unit, honestly degraded. */
  _sensReading(item) {
    const st = item.st;
    const a = st.attributes || {};
    if (st.state === 'unavailable' || st.state === 'unknown') return esc(st.state);
    if (COORD_CELSIUS.has(item.eid) && a.unit_of_measurement === '\u00b0F') {
      const f = Number(st.state);
      if (Number.isFinite(f)) {
        return `${esc(((f - 32) * (5 / 9)).toFixed(1))} <span>\u00b0C</span>`;
      }
    }
    if (item.domain === 'binary_sensor') return st.state === 'on' ? 'Detected' : 'Clear';
    // A timestamp sensor's state is a moment -- an uptime sensor reports its boot
    // time -- and the reading a person wants is the duration since.
    if (a.device_class === 'timestamp') {
      const t = Date.parse(st.state);
      return Number.isFinite(t) ? esc(this._dur((Date.now() - t) / 1000)) : esc(st.state);
    }
    const unit = item.domain === 'sensor' && a.unit_of_measurement
      ? ` <span>${esc(a.unit_of_measurement)}</span>` : '';
    const text = String(this._fmtState(st, item));
    // A value this long is prose, not a reading, so the tile shows the opening of
    // it and hands the rest to the tooltip. Clamping here rather than in the tile
    // covers the device page and the coordinator card at once.
    if (text.length > SENS_TEXT_MAX) {
      return `<span class="txt" title="${esc(text)}">${esc(text.slice(0, SENS_TEXT_MAX))}\u2026</span>${unit}`;
    }
    return `${esc(text)}${unit}`;
  }

  /** Seconds as a person says them: "3d 4h", "2h 10m", "5 min". */
  _dur(sec) {
    const s = Math.max(0, Math.floor(Number(sec) || 0));
    const d = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    const m = Math.floor((s % 3600) / 60);
    if (d) return h ? `${d}d ${h}h` : `${d}d`;
    if (h) return m ? `${h}h ${m}m` : `${h}h`;
    if (m) return `${m} min`;
    return `${s}s`;
  }

  /**
   * Patch the live parts of the device page from a fresh `hass` without a render,
   * the same bargain _syncFw makes: a state change never steals the caret from the
   * rename field or resets the settings form.
   */
  _syncLive() {
    // The device page and the diagnostics coordinator card both host live tiles
    // and switches.
    if (
      (this._view.name !== 'device' && this._view.name !== 'diagnostics') ||
      !this.shadowRoot
    ) return;
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
      const v = el.querySelector('.sens-v');
      if (v) {
        v.innerHTML = this._sensReading(item);
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

  /* --------------------------------------------------------------- settings */
  //
  // The Settings card (design spec §3) walks the SAME exposes[]/options[] Z2M
  // already sends with every device; nothing here is per-model. Render
  // discipline is load-bearing throughout this section: a row's skeleton
  // (label, description, the empty setctl-/setmeta- boxes) is the only part
  // that is ever part of `_markup`, because that string is what `_render()`
  // diffs to decide whether to touch the DOM at all. Values, chips and write
  // states are assigned afterwards by `_syncSettings`, which diffs and patches
  // each row's own small boxes the same way `_syncFw` patches the firmware
  // card -- so a state echo can never force the whole-page rebuild that would
  // steal the caret from a field the operator is mid-edit on.

  /** Every settable exposes[]/options[] entry, sorted into where §3.2 puts it. */
  _settingsClassify(d) {
    const actions = [];
    const main = [];
    const diagnostic = [];
    const options = [];
    (d.exposes || []).forEach((e) => {
      if (!e) return;
      if (e.type === 'light') {
        // §2.1 amendment: only the control feature set is excluded; every
        // other feature of a light composite (color_temp_startup and
        // friends) is classified normally, one level up -- the light block
        // (§4) is what owns state/brightness/color_temp/color_xy/color_hs.
        (e.features || []).forEach((f) => {
          if (!f || LIGHT_CONTROL_FEATURES.has(f.name)) return;
          this._settingsClassifyOne(f, actions, main, diagnostic);
        });
        return;
      }
      if (SETTINGS_CONTROL_TYPES.has(e.type)) return; // a Controls-card entity owns this
      this._settingsClassifyOne(e, actions, main, diagnostic);
    });
    (d.options || []).forEach((o) => {
      if (!o || !o.property || o.property === 'friendly_name') return; // Rename owns this one
      options.push({
        source: 'option',
        expose: o,
        prop: o.property,
        key: `option:${o.property}`,
        label: deCamel(o.label || o.name || o.property || ''),
        description: o.description || '',
      });
    });
    return { actions, main, diagnostic, options };
  }

  /** One expose (or light feature) sorted into where §3.2 puts it. Shared by
   * the top-level exposes[] walk and the light composite's narrowed walk. */
  _settingsClassifyOne(e, actions, main, diagnostic) {
    if (!(e.access & 2)) return; // not settable: Readings owns it, not Settings
    const entry = {
      source: 'expose',
      expose: e,
      prop: e.property,
      key: `expose:${e.property}`,
      label: deCamel(e.label || e.name || e.property || ''),
      description: e.description || '',
    };
    if (e.type === 'enum' && Array.isArray(e.values) && e.values.length === 1) {
      entry.isAction = true;
      actions.push(entry);
      return;
    }
    if (e.category === 'diagnostic') {
      diagnostic.push(entry);
      return;
    }
    if (e.type === 'numeric') entry.editor = this._numericEditorKind(e);
    if (e.type === 'composite') {
      entry.features = (e.features || [])
        .filter((f) => f && f.property && (f.access & 2))
        .map((f) => ({
          expose: f,
          prop: f.property,
          label: deCamel(f.label || f.name || f.property || ''),
          editor: f.type === 'numeric' ? this._numericEditorKind(f) : undefined,
        }));
    }
    main.push(entry);
  }

  /**
   * Settings editor matrix v2 (§5): which editor a numeric expose gets,
   * checked in this fixed order. M and N read the expose's own units/name;
   * L is a value-shape predicate (0-255, "color" in the name); K is anything
   * else with a track-worthy number of positions; everything left is F.
   */
  _numericEditorKind(e) {
    if (!e || e.type !== 'numeric') return 'F';
    if (e.name === 'duration' && e.value_max === 255 && /minutes calculated/i.test(e.description || '')) {
      return 'M';
    }
    if (e.unit === 'mired') return 'N';
    if (e.value_min === 0 && e.value_max === 255 && /color/i.test(e.name || '')) return 'L';
    if (e.value_min !== undefined && e.value_max !== undefined) {
      const positions = (e.value_max - e.value_min) / (e.value_step || 1);
      if (positions >= 5 && positions <= 1000) return 'K';
    }
    return 'F';
  }

  /** Every classified entry, flattened, for the write-commit handlers to look one up by key. */
  _settingsFindEntry(d, key) {
    const cls = this._settingsClassify(d);
    return [...cls.main, ...cls.diagnostic, ...cls.options].find((e) => e.key === key) || null;
  }

  /** A DOM-id-safe token for a row: property names are the only variable part. */
  _settingsDomId(entry) {
    return entry.key.replace(/[^a-zA-Z0-9_-]/g, '_');
  }

  /** At least one expose is worth asking Zigbee2MQTT to report (§3.5's gate for the header button). */
  _settingsHasReadable(d) {
    const scan = (list) =>
      (list || []).some((e) => (e ? !!(e.access & 4) || scan(e.features) : false));
    return scan(d.exposes);
  }

  /** Where a row's current value lives: the state mirror, or option_values. */
  _settingsValue(d, entry) {
    const map = entry.source === 'option' ? d.option_values || {} : this._settingsState[d.ieee_address] || {};
    return { known: Object.prototype.hasOwnProperty.call(map, entry.prop), value: map[entry.prop] };
  }

  /** A composite feature's value inherits from the parent's own state object (§3.3 J notes). */
  _settingsFeatureValue(d, entry, f) {
    const parent = this._settingsValue(d, entry);
    if (!parent.known || !parent.value || typeof parent.value !== 'object') {
      return { known: false, value: undefined };
    }
    const has = Object.prototype.hasOwnProperty.call(parent.value, f.prop);
    return { known: has, value: parent.value[f.prop] };
  }

  /** §3.4's value states, from access bits and whether the value is known. */
  _settingsValueState(entry, known) {
    if (known) return 'known';
    if (entry.source === 'option') return 'default';
    if (entry.expose.access === 2) return 'writeonly';
    if (entry.expose.access & 4) return 'notread';
    return 'notreported'; // access has the state bit but not the get bit (the Tuya access-3 trio)
  }

  /** A binary's wire value as a boolean, honouring value_on/value_off when they are not just true/false. */
  _settingsBoolOf(expose, v) {
    if (typeof v === 'boolean') return v;
    if (expose && v === expose.value_on) return true;
    if (expose && v === expose.value_off) return false;
    return !!v;
  }

  /**
   * Loose equality for "did the device echo back what was written" (§3.4): numbers
   * compare as numbers, binaries via value_on/value_off, composites key by key
   * (order-independent -- the echo's key order owes us nothing), everything else
   * as strings.
   */
  _settingsValuesEqual(expose, a, b) {
    if (a === b) return true;
    if (a === undefined || b === undefined) return false;
    if (expose && expose.type === 'binary') return this._settingsBoolOf(expose, a) === this._settingsBoolOf(expose, b);
    if (Array.isArray(a) && Array.isArray(b)) {
      return a.length === b.length && a.every((v, i) => this._settingsValuesEqual(null, v, b[i]));
    }
    if (a && typeof a === 'object' && b && typeof b === 'object') {
      const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
      return [...keys].every((k) => this._settingsValuesEqual(null, a[k], b[k]));
    }
    const na = Number(a);
    const nb = Number(b);
    if (Number.isFinite(na) && Number.isFinite(nb)) return na === nb;
    return String(a) === String(b);
  }

  /** A value as the chip.adjusted copy shows it: the wire value, verbatim for non-binaries. */
  _settingsDisplayValue(entry, v) {
    const e = entry.expose;
    if (e.type === 'binary') {
      const on = this._settingsBoolOf(e, v);
      return on ? (typeof e.value_on === 'string' ? e.value_on : 'on') : typeof e.value_off === 'string' ? e.value_off : 'off';
    }
    if (v && typeof v === 'object') return JSON.stringify(v);
    return String(v);
  }

  /** The one chip a row shows right now: a write in flight outranks the plain value state. */
  _settingsChipHtml(d, entry) {
    const w = (this._settingsWrite[d.ieee_address] || {})[entry.key];
    if (w && w.phase) {
      if (w.phase === 'adjusted') {
        return `<span class="chip warn">Device set ${esc(this._settingsDisplayValue(entry, w.echoed))}</span>`;
      }
      const spec = SETTINGS_CHIP[w.phase];
      if (spec) return `<span class="chip ${spec[1]}">${spec[0]}</span>`;
    }
    const { known } = this._settingsValue(d, entry);
    const spec = SETTINGS_CHIP[this._settingsValueState(entry, known)];
    return spec ? `<span class="chip ${spec[1]}">${spec[0]}</span>` : '';
  }

  /** Range (numerics with declared bounds) plus the state chip, the row's whole meta line. */
  _settingsMetaHtml(d, entry) {
    const e = entry.expose;
    const parts = [];
    if (e.type === 'numeric' && entry.editor === 'N' && e.value_min !== undefined && e.value_max !== undefined) {
      parts.push(`${miredToKelvinDisplay(e.value_max)}-${miredToKelvinDisplay(e.value_min)} K`);
    } else if (e.type === 'numeric' && entry.editor === 'L') {
      const { known, value } = this._settingsValue(d, entry);
      const name = known ? this._settingsLName(e, entry.description, value) : '';
      parts.push(name ? `0-255 \u00b7 ${name}` : '0-255');
    } else if (e.type === 'numeric' && e.value_min !== undefined && e.value_max !== undefined) {
      parts.push(`${e.value_min}-${e.value_max}`);
    }
    const chip = this._settingsChipHtml(d, entry);
    if (chip) parts.push(chip);
    return parts.join(' \u00b7 ');
  }

  /* ------------------------------------------------------- the editor matrix */

  /** Dispatches to A-J. Safe to bake the current value into THIS string: unlike
   * the row skeleton, it is diffed by _syncSettings against its own per-row
   * memo, never against the page-level _markup _render() compares. */
  _settingsControlHtml(d, entry) {
    if (entry.expose.type === 'composite') return this._settingsCompositeSummaryHtml(d, entry);
    const { known, value } = this._settingsValue(d, entry);
    const ctx = { entry, known, value, disabled: !!d.disabled, ieee: d.ieee_address, id: this._settingsDomId(entry) };
    switch (entry.expose.type) {
      case 'binary':
        return this._settingsBinaryHtml(ctx);
      case 'enum':
        return this._settingsEnumHtml(ctx);
      case 'numeric':
        return this._settingsNumericDispatch(ctx);
      case 'list':
        return this._settingsListHtml(ctx);
      default:
        return this._settingsTextHtml(ctx); // text, and the safest honest fallback for anything else
    }
  }

  /** A: known binary -> switch. B: unknown or write-only -> a two-button segment. */
  _settingsBinaryHtml(ctx) {
    const { entry, known, value, disabled, ieee, id } = ctx;
    const e = entry.expose;
    const dis = disabled ? ' disabled' : '';
    if (known) {
      const checked = this._settingsBoolOf(e, value) ? ' checked' : '';
      return this._has('ha-switch')
        ? `<ha-switch data-setrow="${id}" data-setswitch="${esc(ieee)}|${esc(entry.key)}"${checked}${dis}></ha-switch>`
        : `<input type="checkbox" class="fallback-check" data-setrow="${id}" data-setswitch="${esc(ieee)}|${esc(entry.key)}"${checked}${dis}>`;
    }
    const onLabel = typeof e.value_on === 'string' ? e.value_on : 'Turn on';
    const offLabel = typeof e.value_off === 'string' ? e.value_off : 'Turn off';
    return `<span class="setseg" data-setrow="${id}">${ctlButton(
      offLabel,
      ` data-setseg="${esc(ieee)}|${esc(entry.key)}|off"${dis}`
    )}${ctlButton(onLabel, ` data-setseg="${esc(ieee)}|${esc(entry.key)}|on"${dis}`)}</span>`;
  }

  /** C: known-value enum -> select. D: write-only -> the same select, unselected, with a placeholder. */
  _settingsEnumHtml(ctx) {
    const { entry, known, value, disabled, ieee, id } = ctx;
    const e = entry.expose;
    const values = e.values || [];
    // Converter options never have a get bit: they are write-only by nature, so
    // an unknown one gets the D placeholder even on a schema that omits `access`
    // (Z2M's own samples always set it to 2; this covers the ones that do not).
    const placeholder = (e.access === 2 || entry.source === 'option') && !known;
    const selected = known ? String(value) : '';
    const dis = disabled ? ' disabled' : '';
    const items = values.map((v) => `<ha-list-item value="${esc(String(v))}">${esc(String(v))}</ha-list-item>`).join('');
    const opts = values.map((v) => `<option value="${esc(String(v))}">${esc(String(v))}</option>`).join('');
    return this._has('ha-select')
      ? `<ha-select data-setrow="${id}" naturalMenuWidth fixedMenuPosition data-value="${esc(
          selected
        )}" data-setenum="${esc(ieee)}|${esc(entry.key)}"${dis}>${
          placeholder ? '<ha-list-item disabled value="">Choose\u2026</ha-list-item>' : ''
        }${items}</ha-select>`
      : `<select class="fallback" data-setrow="${id}" data-value="${esc(selected)}" data-setenum="${esc(
          ieee
        )}|${esc(entry.key)}"${dis}>${placeholder ? '<option value="" disabled>Choose\u2026</option>' : ''}${opts}</select>`;
  }

  /** F: a bounded or unbounded number, suffixed with its unit. */
  _settingsNumericHtml(ctx) {
    const { entry, known, value, disabled, ieee, id } = ctx;
    const e = entry.expose;
    const min = e.value_min !== undefined ? ` min="${esc(e.value_min)}"` : '';
    const max = e.value_max !== undefined ? ` max="${esc(e.value_max)}"` : '';
    const step = e.value_step !== undefined ? esc(e.value_step) : 'any';
    const val = known ? esc(String(value)) : '';
    // K/N park an out-of-range known value (§5.1's 65535 "previous" case) by
    // asking this box to render empty with the matching preset's name in
    // place of the usual "Z2M default" placeholder.
    const placeholder = ctx.presetPlaceholder
      ? ` placeholder="${esc(ctx.presetPlaceholder)}"`
      : entry.source === 'option' && !known
        ? ' placeholder="Z2M default"'
        : '';
    const tag = `data-setrow="${id}" data-setnum="${esc(ieee)}|${esc(entry.key)}" data-value="${val}"${min}${max} step="${step}"${
      disabled ? ' disabled' : ''
    }${placeholder}`;
    return this._has('ha-textfield')
      ? `<span class="setnumwrap"><ha-textfield type="number" ${tag}${e.unit ? ` suffix="${esc(e.unit)}"` : ''}></ha-textfield></span>`
      : `<span class="setnumwrap"><input type="number" class="fallback" ${tag}>${
          e.unit ? `<span class="setunit">${esc(e.unit)}</span>` : ''
        }</span>`;
  }

  /** H: free text, same commit rule as F. §2.5 amendment: a description that
   * mentions "hex" (the Hue `effect_color`) grows a 24px live swatch, tinted
   * when the field currently parses as #RRGGBB, neutral otherwise. */
  _settingsTextHtml(ctx) {
    const { entry, known, value, disabled, ieee, id } = ctx;
    const val = known ? esc(String(value)) : '';
    const placeholder = entry.source === 'option' && !known ? ' placeholder="Z2M default"' : '';
    const tag = `data-setrow="${id}" data-settext="${esc(ieee)}|${esc(entry.key)}" data-value="${val}"${
      disabled ? ' disabled' : ''
    }${placeholder}`;
    const field = this._has('ha-textfield')
      ? `<ha-textfield type="text" ${tag}></ha-textfield>`
      : `<input type="text" class="fallback" ${tag}>`;
    if (!/hex/i.test(entry.description || '')) return field;
    const hex = known && /^#?[0-9a-f]{6}$/i.test(String(value)) ? this._hexNormalize(String(value)) : null;
    return `<span class="setl"><span class="cswatch" id="settextswatch-${id}" style="background:${
      hex || 'var(--secondary-background-color)'
    }"></span>${field}</span>`;
  }

  _hexNormalize(s) {
    return s.startsWith('#') ? s : `#${s}`;
  }

  /** Numeric dispatch (§5): `entry.editor`, computed once at classify time,
   * picks M, N, L, K, or the F fallback -- exactly the fixed order §5's
   * table runs in, without re-deriving it here. */
  _settingsNumericDispatch(ctx) {
    switch (ctx.entry.editor) {
      case 'M':
        return this._settingsMHtml(ctx);
      case 'N':
        return this._settingsNHtml(ctx);
      case 'L':
        return this._settingsLHtml(ctx);
      case 'K':
        return this._settingsKHtml(ctx);
      default:
        return this._settingsNumericHtml(ctx);
    }
  }

  /** K/N's preset row (§5.1): sentence-cased names, description as title,
   * exact-match active state, tap commits that value. */
  _settingsPresetChipsHtml(ieee, entry, presets, value) {
    const chips = presets
      .map((p, i) => {
        const active = value !== undefined && this._settingsValuesEqual(entry.expose, p.value, value);
        return `<button type="button" class="pchip" aria-pressed="${active}" title="${esc(
          p.description || ''
        )}" data-setpresetchip="${esc(ieee)}|${esc(entry.key)}|${i}">${esc(sentenceCase(p.name))}</button>`;
      })
      .join('');
    return `<div class="pchips">${chips}</div>`;
  }

  /** The warm-left, mired-linear temperature track (§4.6), shared by the
   * light block's own temperature slider and every N editor: 9 stops across
   * the given mired bounds, painted from `trackRGB`. */
  _tempTrackCss(min, max) {
    const stops = [];
    for (let i = 0; i <= 8; i += 1) {
      const mired = tempPositionToMired(i * 125, min, max);
      const rgb = trackRGB(1e6 / mired);
      stops.push(`${rgbToHex(rgb.r, rgb.g, rgb.b)} ${i * 12.5}%`);
    }
    return `linear-gradient(to right, ${stops.join(', ')})`;
  }

  /**
   * Editor K, exact (§5.1): `.gslider.mini` with a theme-tokened two-stop
   * fill, the F number box, and preset chips when the expose has any. An
   * unknown value hides the slider outright rather than fabricate a thumb
   * position (this rule -- and the out-of-range park below -- is shared with
   * L and N).
   */
  _settingsKHtml(ctx) {
    const { entry, known, value, disabled, ieee, id } = ctx;
    const e = entry.expose;
    const dis = disabled ? ' disabled' : '';
    const min = e.value_min;
    const max = e.value_max;
    const step = e.value_step || 1;
    const presets = e.presets || [];
    const outOfRange = known && (Number(value) < min || Number(value) > max);
    let sliderHtml = '';
    let boxCtx = ctx;
    if (known && !outOfRange) {
      const v = Number(value);
      const pct = max > min ? ((v - min) / (max - min)) * 100 : 0;
      sliderHtml = `<input type="range" class="gslider mini" data-gs="setk|${esc(ieee)}|${esc(
        entry.key
      )}" min="${esc(min)}" max="${esc(max)}" step="${esc(step)}" value="${v}" style="--gs-fill:${pct}%"
          aria-label="${esc(entry.label)}" aria-valuetext="${esc(v)}${
        e.unit ? ` ${esc(e.unit)}` : ''
      }"${dis}>`;
    } else if (outOfRange) {
      const parkedMax = Math.abs(Number(value) - max) <= Math.abs(Number(value) - min);
      sliderHtml = `<input type="range" class="gslider mini" data-gs="setk|${esc(ieee)}|${esc(
        entry.key
      )}" min="${esc(min)}" max="${esc(max)}" step="${esc(step)}" value="${parkedMax ? max : min}"
          style="--gs-fill:${parkedMax ? 100 : 0}%" aria-label="${esc(entry.label)}"${dis}>`;
      const preset = presets.find((p) => this._settingsValuesEqual(e, p.value, value));
      boxCtx = { ...ctx, known: false, presetPlaceholder: preset ? sentenceCase(preset.name) : undefined };
    }
    const box = this._settingsNumericHtml(boxCtx);
    const chips = presets.length ? this._settingsPresetChipsHtml(ieee, entry, presets, known ? value : undefined) : '';
    return `<div class="setk"><div class="setslidewrap">${sliderHtml}${box}</div>${chips}</div>`;
  }

  /** L's meta name (§5.2): the converter's own preset name on an exact
   * match, else the hue name, else White (255, preset rows) or Synced to all
   * LEDs (255, sync rows -- description mentions synchronization). */
  _settingsLName(expose, description, value) {
    if (value === undefined || value === null) return '';
    const preset = (expose.presets || []).find((p) => this._settingsValuesEqual(expose, p.value, value));
    if (preset) return preset.name;
    const v = Number(value);
    if (v === 255) return /synchroni/i.test(description || '') ? 'Synced to all LEDs' : 'White';
    return hueName(l255ToDeg(v));
  }

  /**
   * Editor L, the hue trio (§5.2): `.gslider.mini` on the fixed rainbow-plus-
   * white-cap track, a 24px swatch, and the F number box (64px, §5.2). No
   * preset chips ever -- the nine converter presets are absorbed as detents
   * and the meta name instead (§5.2's own rule, independent of K's).
   */
  _settingsLHtml(ctx) {
    const { entry, known, value, disabled, ieee, id } = ctx;
    const dis = disabled ? ' disabled' : '';
    let sliderHtml = '';
    let swatchHtml = `<span class="cswatch cswatch-unknown"></span>`;
    if (known) {
      const v = Number(value);
      sliderHtml = `<input type="range" class="gslider mini hue255" data-gs="setl|${esc(ieee)}|${esc(
        entry.key
      )}" min="0" max="255" step="1" value="${v}" aria-label="${esc(entry.label)}"
          aria-valuetext="${esc(this._settingsLName(entry.expose, entry.description, v))}"${dis}>`;
      if (v === 255) {
        swatchHtml = /synchroni/i.test(entry.description || '')
          ? `<span class="cswatch cswatch-sync" title="Synced to all LEDs">${icon(MDI.link, '')}</span>`
          : `<span class="cswatch" style="background:#fff"></span>`;
      } else {
        swatchHtml = `<span class="cswatch" style="background:${esc(hsToHex(l255ToDeg(v), 100))}"></span>`;
      }
    }
    const box = this._settingsNumericHtml(ctx);
    return `<div class="setl">${sliderHtml}${swatchHtml}${box}</div>`;
  }

  /**
   * Editor N, the temperature trio (§5.3): `.gslider.mini` on the same
   * device-range mired-linear track the light block generates, a kelvin
   * box, and the converter's own preset chips verbatim. No mired anywhere.
   */
  _settingsNHtml(ctx) {
    const { entry, known, value, disabled, ieee, id } = ctx;
    const e = entry.expose;
    const dis = disabled ? ' disabled' : '';
    const min = e.value_min;
    const max = e.value_max;
    const presets = e.presets || [];
    const outOfRange = known && (Number(value) < min || Number(value) > max);
    let sliderHtml = '';
    let kelvinVal = '';
    let placeholder = '';
    if (known && !outOfRange) {
      const v = Number(value);
      const pos = miredToTempPosition(v, min, max);
      sliderHtml = `<input type="range" class="gslider mini" data-gs="setn|${esc(ieee)}|${esc(
        entry.key
      )}" min="0" max="1000" step="1" value="${pos}" style="--gs-track:${this._tempTrackCss(min, max)}"
          aria-label="${esc(entry.label)}" aria-valuetext="${miredToKelvinDisplay(v)} K"${dis}>`;
      kelvinVal = String(miredToKelvinDisplay(v));
    } else {
      if (outOfRange) {
        const preset = presets.find((p) => this._settingsValuesEqual(e, p.value, value));
        placeholder = preset ? sentenceCase(preset.name) : '';
      }
      const parkedMax = outOfRange && Math.abs(Number(value) - max) <= Math.abs(Number(value) - min);
      sliderHtml = `<input type="range" class="gslider mini" data-gs="setn|${esc(ieee)}|${esc(
        entry.key
      )}" min="0" max="1000" step="1" value="${parkedMax ? 0 : 1000}" style="--gs-track:${this._tempTrackCss(
        min,
        max
      )}" aria-label="${esc(entry.label)}"${outOfRange ? '' : ' hidden'}${dis}>`;
    }
    const boxTag = `data-setrow="${id}" data-setntemp="${esc(ieee)}|${esc(entry.key)}" data-value="${esc(
      kelvinVal
    )}" min="${miredToKelvinDisplay(max)}" max="${miredToKelvinDisplay(min)}" step="1"${dis}${
      placeholder ? ` placeholder="${esc(placeholder)}"` : ''
    }`;
    const box = this._has('ha-textfield')
      ? `<ha-textfield type="number" ${boxTag} suffix="K"></ha-textfield>`
      : `<span class="setnumwrap"><input type="number" class="fallback" ${boxTag}><span class="setunit">K</span></span>`;
    const chips = presets.length ? this._settingsPresetChipsHtml(ieee, entry, presets, known ? value : undefined) : '';
    return `<div class="setn"><div class="setslidewrap">${sliderHtml}${box}</div>${chips}</div>`;
  }

  /** Editor M, the duration editor (§6.3): a number box plus a four-segment
   * unit picker, with the wire byte kept visible in the meta line -- the one
   * place this document shows a raw wire value on purpose. Composite-only in
   * the real fleet (`entry.editor === 'M'` never fires on a top-level
   * expose), but the markup and encode/decode pair are generic. */
  _settingsMHtml(ctx) {
    const { entry, known, value, disabled, ieee, id } = ctx;
    const dis = disabled ? ' disabled' : '';
    const decoded = known ? durationDecode(value) : { unit: 'Seconds', val: '' };
    const bounds = durationBounds(decoded.unit);
    const forever = decoded.unit === 'Forever';
    const boxTag = `id="setdurbox-${id}" data-setdurval="${esc(ieee)}|${esc(entry.key)}" min="${bounds.min}" max="${bounds.max}" step="1"${dis}`;
    const box = this._has('ha-textfield')
      ? `<ha-textfield type="number" ${boxTag} data-value="${known ? esc(decoded.val) : ''}"${forever ? ' hidden' : ''}></ha-textfield>`
      : `<input type="number" class="fallback compact" ${boxTag} value="${known ? esc(decoded.val) : ''}"${forever ? ' hidden' : ''}>`;
    const seg = DURATION_UNITS.map(
      (u) =>
        `<button type="button" role="tab" aria-selected="${u === decoded.unit}" data-setdurunit="${esc(
          ieee
        )}|${esc(entry.key)}|${u}">${u}</button>`
    ).join('');
    const meta = known
      ? `Writes ${esc(value)} \u00b7 runs ${esc(durationHuman(value))}`
      : '';
    return `<div class="setm" data-setrow="${id}"><div class="setdur">${box}<span class="seg" id="setdurseg-${id}" role="tablist">${seg}</span></div><div class="setdur-meta" id="setdurmeta-${id}">${meta}</div></div>`;
  }

  /** I: a list of numbers as removable chips, with an explicit Apply for the whole array. */
  _settingsListHtml(ctx) {
    const { entry, known, value, disabled, ieee, id } = ctx;
    const draftKey = `${ieee}|${entry.key}`;
    if (!(draftKey in this._settingsListDraft)) {
      this._settingsListDraft[draftKey] = known && Array.isArray(value) ? value.slice() : [];
    }
    const items = this._settingsListDraft[draftKey];
    const dis = disabled ? ' disabled' : '';
    const chips = items
      .map(
        (v, i) =>
          `<span class="chip">${esc(String(v))}<button type="button" class="chipx" data-setlistdel="${esc(
            ieee
          )}|${esc(entry.key)}|${i}" aria-label="Remove ${esc(String(v))}">\u00d7</button></span>`
      )
      .join('');
    const numTag = `data-setrow="${id}" id="setlistval-${id}" min="0" step="1"`;
    const addField = this._has('ha-textfield')
      ? `<ha-textfield type="number" ${numTag}></ha-textfield>`
      : `<input type="number" class="fallback" ${numTag}>`;
    return `<div class="setlist" data-setrow="${id}">
        <div class="setlist-chips">${chips || '<span class="setlist-empty">No values yet.</span>'}</div>
        <div class="setlist-add">${addField}${ctlButton(
          'Add',
          ` data-setlistadd="${esc(ieee)}|${esc(entry.key)}"${dis}`
        )}${ctlButton('Apply', ` data-setlistapply="${esc(ieee)}|${esc(entry.key)}"${dis}`, 'filled')}</div>
      </div>`;
  }

  /** J's collapsed row: a one-line summary of known feature values, or the unknown chip. */
  _settingsCompositeSummaryHtml(d, entry) {
    const parent = this._settingsValue(d, entry);
    const stateObj = parent.known && parent.value && typeof parent.value === 'object' ? parent.value : null;
    const bits = stateObj
      ? entry.features
          .filter((f) => Object.prototype.hasOwnProperty.call(stateObj, f.prop))
          .map((f) => `${stateObj[f.prop]}${f.expose.unit || ''}`)
      : [];
    return bits.length ? `<span class="setrow-summary">${esc(bits.join(' \u00b7 '))}</span>` : '<span class="chip">Not read yet</span>';
  }

  /** J's nested compact row for one feature: value inherited from the parent's state object. */
  _settingsFeatureControlHtml(d, entry, f, id) {
    const ieee = d.ieee_address;
    const draft = (this._settingsDraft[ieee] || {})[entry.key] || {};
    const touched = Object.prototype.hasOwnProperty.call(draft, f.prop);
    const parentVal = this._settingsFeatureValue(d, entry, f);
    const known = touched || parentVal.known;
    const value = touched ? draft[f.prop] : parentVal.value;
    const tag = `data-setrow="${id}" data-setfeat="${esc(ieee)}|${esc(entry.key)}|${esc(f.prop)}"`;
    if (f.expose.type === 'binary') {
      const checked = known && this._settingsBoolOf(f.expose, value);
      return `<input type="checkbox" class="setfeature-check" ${tag} data-setfeatkind="binary"${
        checked ? ' checked' : ''
      }${known ? '' : ' data-indeterminate="1"'}>`;
    }
    if (f.expose.type === 'enum') {
      const values = f.expose.values || [];
      if (values.length <= 7) {
        // §2.6: a composite-body enum with 7 or fewer values is a
        // single-select chip row; the Inovelli `led` picker is the case.
        const chips = values
          .map((v) => {
            const active = known && String(value) === String(v);
            return `<button type="button" class="pchip" role="radio" aria-checked="${active}"
                data-setfeatchip="${esc(ieee)}|${esc(entry.key)}|${esc(f.prop)}|${esc(String(v))}">${esc(
              String(v)
            )}</button>`;
          })
          .join('');
        return `<div class="pchips" role="radiogroup" ${tag}>${chips}</div>`;
      }
      const opts = values.map((v) => `<option value="${esc(String(v))}">${esc(String(v))}</option>`).join('');
      return `<select class="fallback compact" ${tag} data-setfeatkind="enum" data-value="${
        known ? esc(String(value)) : ''
      }">${known ? '' : '<option value="" disabled>Choose\u2026</option>'}${opts}</select>`;
    }
    if (f.expose.type === 'numeric' && f.editor === 'M') return this._settingsFeatureDurationHtml(d, entry, f, id, known, value);
    if (f.expose.type === 'numeric' && (f.editor === 'K' || f.editor === 'L')) {
      return this._settingsFeatureSliderHtml(d, entry, f, id, known, value);
    }
    return `<input type="number" class="fallback compact" ${tag} data-setfeatkind="numeric" data-value="${
      known ? esc(String(value)) : ''
    }"${f.expose.value_min !== undefined ? ` min="${esc(f.expose.value_min)}"` : ''}${
      f.expose.value_max !== undefined ? ` max="${esc(f.expose.value_max)}"` : ''
    }>`;
  }

  /** K/L inside a composite body (§6): the same slider+box (+swatch for L)
   * as the top-level editors, but the slider writes into the draft on
   * change (like every other feature) instead of committing on its own --
   * only Apply writes anything from inside a composite. */
  _settingsFeatureSliderHtml(d, entry, f, id, known, value) {
    const ieee = d.ieee_address;
    const e = f.expose;
    const dataKey = `${esc(ieee)}|${esc(entry.key)}|${esc(f.prop)}`;
    const boxTag = `data-setfeat="${dataKey}" data-setfeatkind="numeric" data-value="${known ? esc(String(value)) : ''}"`;
    const box = `<input type="number" class="fallback compact" ${boxTag}${
      e.value_min !== undefined ? ` min="${esc(e.value_min)}"` : ''
    }${e.value_max !== undefined ? ` max="${esc(e.value_max)}"` : ''}>`;
    if (f.editor === 'L') {
      let swatch = `<span class="cswatch cswatch-unknown"></span>`;
      let slider = '';
      if (known) {
        const v = Number(value);
        slider = `<input type="range" class="gslider mini hue255" data-setfeat="${dataKey}" data-setfeatkind="numeric"
            data-setfeatslider="l" min="0" max="255" step="1" value="${v}" aria-label="${esc(f.label)}"
            aria-valuetext="${esc(this._settingsLName(e, e.description, v))}">`;
        swatch =
          v === 255
            ? /synchroni/i.test(e.description || '')
              ? `<span class="cswatch cswatch-sync" title="Synced to all LEDs">${icon(MDI.link, '')}</span>`
              : `<span class="cswatch" style="background:#fff"></span>`
            : `<span class="cswatch" style="background:${esc(hsToHex(l255ToDeg(v), 100))}"></span>`;
      }
      return `<div class="setl setfeature-slide" data-setrow="${id}">${slider}${swatch}${box}</div>`;
    }
    let slider = '';
    if (known && e.value_min !== undefined && e.value_max !== undefined) {
      const v = Number(value);
      const pct = e.value_max > e.value_min ? ((v - e.value_min) / (e.value_max - e.value_min)) * 100 : 0;
      slider = `<input type="range" class="gslider mini" data-setfeat="${dataKey}" data-setfeatkind="numeric"
          data-setfeatslider="k" min="${esc(e.value_min)}" max="${esc(e.value_max)}" step="${esc(
        e.value_step || 1
      )}" value="${v}" style="--gs-fill:${pct}%" aria-label="${esc(f.label)}">`;
    }
    return `<div class="setk setfeature-slide" data-setrow="${id}">${slider}${box}</div>`;
  }

  /** M inside a composite body (§6.3): identical box+seg to the top-level
   * editor, writing into the draft instead of committing directly. */
  _settingsFeatureDurationHtml(d, entry, f, id, known, value) {
    const ieee = d.ieee_address;
    const decoded = known ? durationDecode(value) : { unit: 'Seconds', val: '' };
    const bounds = durationBounds(decoded.unit);
    const forever = decoded.unit === 'Forever';
    const dataKey = `${esc(ieee)}|${esc(entry.key)}|${esc(f.prop)}`;
    const boxTag = `id="setdurbox-${id}" data-setfeatdurval="${dataKey}" min="${bounds.min}" max="${bounds.max}" step="1"`;
    const box = `<input type="number" class="fallback compact" ${boxTag} value="${
      known ? esc(decoded.val) : ''
    }"${forever ? ' hidden' : ''}>`;
    const seg = DURATION_UNITS.map(
      (u) =>
        `<button type="button" role="tab" aria-selected="${u === decoded.unit}" data-setfeatdurunit="${dataKey}|${u}">${u}</button>`
    ).join('');
    const meta = known ? `Writes ${esc(value)} \u00b7 runs ${esc(durationHuman(value))}` : '';
    return `<div class="setm" data-setrow="${id}"><div class="setdur">${box}<span class="seg" id="setdurseg-${id}" role="tablist">${seg}</span></div><div class="setdur-meta" id="setdurmeta-${id}">${meta}</div></div>`;
  }

  /* ----------------------------------------------------------- row skeletons */

  /**
   * The helper line under a label (§3.7): clamped to 2 lines, with More/Less as
   * its own trailing block -- never inline inside the clamped text, which is
   * what let the clamp's reported height go wrong and overlap the meta line
   * that follows it.
   */
  _settingsDescHtml(id, description) {
    if (!description) return '';
    const more = description.length > 140
      ? `<div class="setrow-more"><button type="button" class="linklike" data-descmore="${id}">More</button></div>`
      : '';
    return `<div class="setrow-desc" id="setdesc-${id}">${esc(description)}</div>${more}`;
  }

  /** A-I's row: label and control side by side, description clamped, meta below. Values are
   * assigned by _syncSettings, never here -- see the section preamble. */
  _settingsRowHtml(d, entry) {
    const id = this._settingsDomId(entry);
    const e = entry.expose;
    return `<div class="setrow" id="setrow-${id}" data-prop="${esc(entry.prop)}" data-etype="${esc(e.type)}" data-editor="${esc((entry.editor || '').toLowerCase())}">
        <div class="setrow-top">
          <div class="setrow-label"><div class="setrow-name">${esc(entry.label)}</div></div>
          <div class="setrow-ctl" id="setctl-${id}"></div>
        </div>
        ${this._settingsDescHtml(id, entry.description)}
        <div class="setrow-meta" id="setmeta-${id}"></div>
        <div class="seterr" id="seterr-${id}" hidden></div>
      </div>`;
  }

  /** J's row: the same header shape, expandable into its nested features plus Apply. */
  _settingsCompositeRowHtml(d, entry) {
    const id = this._settingsDomId(entry);
    const ieee = d.ieee_address;
    const descHtml = this._settingsDescHtml(id, entry.description);
    const header = `<div class="setrow-top">
          <div class="setrow-label"><div class="setrow-name">${esc(entry.label)}</div></div>
          <div class="setrow-ctl" id="setctl-${id}"></div>
        </div>
        ${descHtml}
        <div class="setrow-meta" id="setmeta-${id}"></div>`;
    const body = `<div class="setcomposite-body">${entry.features
      .map((f) => this._settingsFeatureRowHtml(entry, f))
      .join('')}<div class="setcomposite-apply">${ctlButton(
      'Apply',
      ` data-setapply="${esc(ieee)}|${esc(entry.key)}"`,
      'filled'
    )}</div></div>`;
    const open = !!(this._settingsOpen[ieee] || {})[entry.key];
    const toggle = `data-setgrouptoggle="${esc(ieee)}|${esc(entry.key)}"`;
    return this._has('ha-expansion-panel')
      ? `<ha-expansion-panel class="setrow setcomposite" id="setrow-${id}" data-prop="${esc(
          entry.prop
        )}" data-etype="composite" ${toggle}${open ? ' expanded' : ''}><div slot="header">${header}</div>${body}</ha-expansion-panel>`
      : `<details class="setrow setcomposite" id="setrow-${id}" data-prop="${esc(entry.prop)}" data-etype="composite" ${toggle}${
          open ? ' open' : ''
        }><summary>${header}</summary>${body}</details>`;
  }

  _settingsFeatureRowHtml(entry, f) {
    const id = `${this._settingsDomId(entry)}-${f.prop.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
    return `<div class="setfeature"><div class="setfeature-label">${esc(f.label)}</div><div class="setfeature-ctl" id="setfeat-${id}"></div></div>`;
  }

  /** The Converter options / Diagnostic groups: same anatomy, same collapse component as J. */
  _settingsGroupHtml(d, key, title, entries, note) {
    const ieee = d.ieee_address;
    const rows = entries.map((entry) => this._settingsRowHtml(d, entry)).join('');
    const noteHtml = note ? `<div class="setgroup-note">${esc(note)}</div>` : '';
    const header = `<div class="setrow-top"><div class="setgroup-title">${esc(title)} \u00b7 ${entries.length}</div></div>`;
    const body = `${noteHtml}<div class="setgroup-body">${rows}</div>`;
    const open = !!(this._settingsOpen[ieee] || {})[`group:${key}`];
    const toggle = `data-setgrouptoggle="${esc(ieee)}|group:${key}"`;
    return this._has('ha-expansion-panel')
      ? `<ha-expansion-panel class="setrow" id="setrow-group-${key}" ${toggle}${
          open ? ' expanded' : ''
        }><div slot="header">${header}</div>${body}</ha-expansion-panel>`
      : `<details class="setrow" id="setrow-group-${key}" ${toggle}${open ? ' open' : ''}><summary>${header}</summary>${body}</details>`;
  }

  /** The actions row (§3.2.3): single-value settable enums, as a small toolbar. */
  _settingsActionsHtml(d, actions) {
    if (!actions.length) return '';
    const ieee = d.ieee_address;
    const buttons = actions
      .map((entry) => {
        const id = this._settingsDomId(entry);
        return `<span class="setaction">${ctlButton(entry.label, ` id="setact-${id}" data-setaction="${esc(
          ieee
        )}|${esc(entry.prop)}"`)}<div class="seterr" id="seterr-${id}" hidden></div></span>`;
      })
      .join('');
    return `<div class="set-actions">${buttons}</div>`;
  }

  /** The filter row (§3.6), shown only past 12 main-list rows. Reuses the devices search recipe. */
  _settingsFilterRowHtml() {
    return `<div class="search">${icon(MDI.search, '')}
        ${
          this._has('ha-textfield')
            ? `<ha-textfield id="setfilter" type="search" data-value="${esc(this._setFilter)}" placeholder="Filter settings"></ha-textfield>`
            : `<input id="setfilter" class="fallback" type="search" value="${esc(this._setFilter)}" placeholder="Filter settings">`
        }
        <span class="count" id="setfiltercount" aria-live="polite"></span>
        <ha-icon-button id="setfilterclear" data-act="setfilterclear" data-path="${MDI.close}"
          data-label="Clear filter" aria-label="Clear filter"></ha-icon-button>
      </div>`;
  }

  /* ------------------------------------------------------------- the card */

  /** The Settings card itself (§3.1): omitted for a device with nothing settable at all. */
  _settingsCard(d) {
    const cls = this._settingsClassify(d);
    const nothing = !cls.actions.length && !cls.main.length && !cls.diagnostic.length && !cls.options.length;
    if (nothing) return ''; // the Wyze lock case: no empty furniture

    // Converter options only (no settable exposes at all): they ARE the card body,
    // expanded, without a group header of their own (§3.1).
    if (!cls.actions.length && !cls.main.length && !cls.diagnostic.length) {
      return `<ha-card class="nav-card">
          <div class="card-header">Settings</div>
          <div class="card-content" id="setrows">${cls.options.map((entry) => this._settingsRowHtml(d, entry)).join('')}</div>
        </ha-card>`;
    }

    const headerAction = this._settingsHasReadable(d)
      ? `<span class="header-actions"><ha-button appearance="plain" size="s" id="setread" data-act="readvalues">Read from device</ha-button></span>`
      : '';
    const filterHtml = cls.main.length > 12 ? this._settingsFilterRowHtml() : '';
    const rowsHtml = cls.main
      .map((entry) => (entry.expose.type === 'composite' ? this._settingsCompositeRowHtml(d, entry) : this._settingsRowHtml(d, entry)))
      .join('');
    const optionsGroup = cls.options.length
      ? this._settingsGroupHtml(d, 'options', 'Converter options', cls.options, 'Applied by Zigbee2MQTT, not stored on the device.')
      : '';
    const diagGroup = cls.diagnostic.length ? this._settingsGroupHtml(d, 'diagnostic', 'Diagnostic', cls.diagnostic, '') : '';
    const emptyHtml = filterHtml
      ? `<div class="empty" id="setfilterempty" hidden>No settings match &ldquo;<span id="setfilterq"></span>&rdquo;.
          <div class="actions"><ha-button appearance="plain" size="s" data-act="setfilterclear">Clear filter</ha-button></div>
        </div>`
      : '';
    const disabledNote = d.disabled ? '<div class="note">This device is disabled in Zigbee2MQTT.</div>' : '';
    return `<ha-card class="nav-card">
        <div class="card-header">Settings${headerAction}</div>
        ${this._settingsActionsHtml(d, cls.actions)}
        ${filterHtml}
        ${disabledNote}
        <div class="card-content" id="setrows">${rowsHtml}${optionsGroup}${diagGroup}${emptyHtml}</div>
      </ha-card>`;
  }

  /* --------------------------------------------------------------- syncing */

  /** Is the element the operator is focused in part of row `id`? Guards every patch below. */
  _settingsRowFocused(r, id) {
    const el = r.activeElement;
    return !!(el && el.dataset && el.dataset.setrow === id);
  }

  /** Is a `.gslider` inside `box` mid-drag, or within 1s of its last input
   * (§3.2)? The slider-specific form of the guard above: a range input does
   * not reliably become `activeElement` on every pointer path. */
  _settingsRowHot(box) {
    if (!box || !box.querySelectorAll) return false;
    // NodeList has no .some in real browsers (the test stub returns arrays); spread first.
    return [...box.querySelectorAll('[data-gs]')].some((el) => el._z2mHot && Date.now() - el._z2mHot < 1000);
  }

  /**
   * The sibling of `_syncLive`/`_syncFw`: patches every row's control and meta box
   * from the state mirror and the write-lifecycle table, in place.
   *
   * `fresh` is passed after a full render, whose skeleton always starts every box
   * empty (render discipline, see the section preamble): the per-row memo has to
   * be thrown away then, or an unchanged value would leave a freshly-rebuilt box
   * permanently blank. A live state push, by contrast, patches only what changed.
   */
  _syncSettings(fresh) {
    if (this._view.name !== 'device' || !this.shadowRoot) return;
    const d = this._dev(this._view.ieee);
    if (!d) return;
    const ieee = d.ieee_address;
    const r = this.shadowRoot;
    if (fresh || !this._settingsCache[ieee]) this._settingsCache[ieee] = { ctl: {}, meta: {} };
    const cache = this._settingsCache[ieee];
    const cls = this._settingsClassify(d);

    const paintCtl = (entry) => this._settingsPaintCtl(ieee, entry);
    const paintMeta = (entry) => {
      const id = this._settingsDomId(entry);
      const box = r.getElementById(`setmeta-${id}`);
      if (!box) return;
      const html = this._settingsMetaHtml(d, entry);
      if (cache.meta[entry.key] === html) return;
      cache.meta[entry.key] = html;
      box.innerHTML = html;
    };

    [...cls.main, ...cls.diagnostic, ...cls.options].forEach((entry) => {
      paintCtl(entry);
      paintMeta(entry);
      if (entry.features) entry.features.forEach((f) => this._syncCompositeFeature(r, cache, d, entry, f));
    });
    cls.actions.forEach((entry) => this._paintSettingsRow(ieee, entry));
  }

  _syncCompositeFeature(r, cache, d, entry, f) {
    const id = `${this._settingsDomId(entry)}-${f.prop.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
    const box = r.getElementById(`setfeat-${id}`);
    if (!box || this._settingsRowFocused(r, id)) return;
    const html = this._settingsFeatureControlHtml(d, entry, f, id);
    const cacheKey = `${entry.key}.${f.prop}`;
    if (cache.ctl[cacheKey] === html) return;
    cache.ctl[cacheKey] = html;
    box.innerHTML = html;
    this._wire(box);
  }

  /**
   * Repaint one row's control from the state mirror, the same memoized-diff
   * bargain _syncFw makes. Skipped while a write for this row is in flight
   * (pending keeps showing what the operator set, §3.4) and while the row has
   * focus (it resyncs on blur instead of being yanked out from under typing).
   */
  _settingsPaintCtl(ieee, entry) {
    const r = this.shadowRoot;
    const d = this._dev(ieee);
    if (!r || !d) return;
    const w = (this._settingsWrite[ieee] || {})[entry.key];
    if (w && w.phase === 'pending') return;
    const id = this._settingsDomId(entry);
    const box = r.getElementById(`setctl-${id}`);
    if (!box || this._settingsRowFocused(r, id) || this._settingsRowHot(box)) return;
    const html = this._settingsControlHtml(d, entry);
    const cache = this._settingsCache[ieee] || (this._settingsCache[ieee] = { ctl: {}, meta: {} });
    if (cache.ctl[entry.key] === html) return;
    cache.ctl[entry.key] = html;
    box.innerHTML = html;
    this._wire(box);
  }

  /** A list editor's Add/remove buttons change the draft, not the server, so the
   * control repaints unconditionally rather than waiting for _syncSettings' diff. */
  _settingsRepaintControl(ieee, key) {
    const r = this.shadowRoot;
    const d = this._dev(ieee);
    const entry = d && this._settingsFindEntry(d, key);
    if (!r || !entry) return;
    const id = this._settingsDomId(entry);
    const box = r.getElementById(`setctl-${id}`);
    if (!box) return;
    const html = this._settingsControlHtml(d, entry);
    box.innerHTML = html;
    this._wire(box);
    if (this._settingsCache[ieee]) this._settingsCache[ieee].ctl[entry.key] = html;
  }

  /* --------------------------------------------------------- write lifecycle */

  _paintSettingsRow(ieee, entry) {
    if (entry.isAction) return this._paintSettingsAction(ieee, entry);
    return this._paintSettingsWrite(ieee, entry);
  }

  /** Patches only the meta chip and the inline error: the control keeps whatever
   * the operator set, per §3.4's "control not disabled" rule for a pending write. */
  _paintSettingsWrite(ieee, entry) {
    const r = this.shadowRoot;
    if (!r || this._view.name !== 'device' || this._view.ieee !== ieee) return;
    const d = this._dev(ieee);
    if (!d) return;
    const id = this._settingsDomId(entry);
    const w = (this._settingsWrite[ieee] || {})[entry.key];
    // Confirmed or adjusted both mean the state mirror now holds the device's
    // real value (merged in _settingsCommitExpose): the control adopts it here
    // unless it is what the operator is still focused in, which resyncs on
    // blur instead (§3.4's cross-cutting rule).
    if (w && (w.phase === 'confirmed' || w.phase === 'adjusted')) this._settingsPaintCtl(ieee, entry);
    const metaBox = r.getElementById(`setmeta-${id}`);
    if (metaBox) {
      const html = this._settingsMetaHtml(d, entry);
      metaBox.innerHTML = html;
      if (this._settingsCache[ieee]) this._settingsCache[ieee].meta[entry.key] = html;
    }
    const err = r.getElementById(`seterr-${id}`);
    if (!err) return;
    if (w && w.phase === 'failed' && w.message) {
      err.hidden = false;
      err.textContent = w.message;
    } else if (w && w.phase === 'unconfirmed') {
      err.hidden = false;
      err.textContent = 'Sent, but the device did not confirm. Check the log if it did not apply.';
    } else {
      err.hidden = true;
      err.textContent = '';
    }
  }

  _settingsClearError(ieee, entry) {
    const r = this.shadowRoot;
    const id = this._settingsDomId(entry);
    const err = r && r.getElementById(`seterr-${id}`);
    if (err) {
      err.hidden = true;
      err.textContent = '';
    }
  }

  _settingsShowError(ieee, entry, message) {
    const r = this.shadowRoot;
    const id = this._settingsDomId(entry);
    const err = r && r.getElementById(`seterr-${id}`);
    if (err) {
      err.hidden = false;
      err.textContent = message;
    }
  }

  /** Every commit lands here: an expose write goes to z2m/device/set, a converter
   * option to the existing z2m/device/options -- whose response IS the
   * confirmation, so it only ever reaches confirmed or failed (§3.4). */
  _settingsCommit(ieee, entry, value) {
    this._settingsClearError(ieee, entry);
    if (entry.source === 'option') return this._settingsCommitOption(ieee, entry, value);
    return this._settingsCommitExpose(ieee, entry, value);
  }

  async _settingsCommitExpose(ieee, entry, value) {
    const store = (this._settingsWrite[ieee] = this._settingsWrite[ieee] || {});
    const token = ((store[entry.key] || {}).token || 0) + 1;
    const w = (store[entry.key] = { phase: 'pending', message: null, token });
    this._paintSettingsRow(ieee, entry);
    try {
      const res = await this._call('z2m/device/set', { device: ieee, payload: { [entry.prop]: value } });
      if (store[entry.key] !== w) return; // superseded: latest write wins (§3.4)
      if (res && res.confirmed) {
        const echoed = (res.state || {})[entry.prop];
        const adjusted = !this._settingsValuesEqual(entry.expose, echoed, value);
        w.phase = adjusted ? 'adjusted' : 'confirmed';
        w.echoed = echoed;
        // The control adopts what the device actually holds (§3.4): merge the
        // echo into the mirror now, rather than wait on the separate state
        // subscription to report the identical fact a moment later.
        if (echoed !== undefined) {
          this._settingsState[ieee] = { ...(this._settingsState[ieee] || {}), [entry.prop]: echoed };
        }
        if (!adjusted) this._settingsFadeWrite(ieee, entry, token);
      } else if (res && Object.prototype.hasOwnProperty.call(res, 'sleeping')) {
        w.phase = res.sleeping ? 'queued' : 'unconfirmed';
      } else {
        w.phase = 'sent'; // write-only: no error surfaced within the backend's grace window
        this._settingsFadeWrite(ieee, entry, token);
      }
    } catch (err) {
      if (store[entry.key] !== w) return;
      w.phase = 'failed';
      w.message = this._feedMessage(err, 'The write failed');
    }
    this._paintSettingsRow(ieee, entry);
  }

  async _settingsCommitOption(ieee, entry, value) {
    const store = (this._settingsWrite[ieee] = this._settingsWrite[ieee] || {});
    const token = ((store[entry.key] || {}).token || 0) + 1;
    const w = (store[entry.key] = { phase: 'pending', message: null, token });
    this._paintSettingsRow(ieee, entry);
    try {
      await this._call('z2m/device/options', { device: ieee, options: { [entry.prop]: value } });
      if (store[entry.key] !== w) return;
      w.phase = 'confirmed';
      this._settingsFadeWrite(ieee, entry, token);
      // The written value only shows as Known once option_values catches up.
      setTimeout(() => this._refreshFeed('devices', 'z2m/devices'), 1200);
    } catch (err) {
      if (store[entry.key] !== w) return;
      w.phase = 'failed';
      w.message = this._feedMessage(err, 'The write failed');
    }
    this._paintSettingsRow(ieee, entry);
  }

  _settingsFadeWrite(ieee, entry, token) {
    setTimeout(() => {
      const store = this._settingsWrite[ieee];
      const w = store && store[entry.key];
      if (!w || w.token !== token) return;
      delete store[entry.key];
      this._paintSettingsRow(ieee, entry);
    }, 2000);
  }

  /* -------------------------------------------------------------- actions */

  _settingsActionClick(ieee, prop) {
    const d = this._dev(ieee);
    if (!d) return;
    const entry = this._settingsClassify(d).actions.find((a) => a.prop === prop);
    if (!entry) return;
    const confirmKey = `${ieee}|${prop}`;
    // Restart/reset actions need a second press: the first swaps the label for
    // five seconds rather than opening a dialog over what is already a one-tap page.
    if (/restart|reset/i.test(prop) && !this._settingsConfirming[confirmKey]) {
      this._settingsConfirming[confirmKey] = setTimeout(() => {
        delete this._settingsConfirming[confirmKey];
        this._paintSettingsAction(ieee, entry);
      }, 5000);
      this._paintSettingsAction(ieee, entry);
      return;
    }
    if (this._settingsConfirming[confirmKey]) {
      clearTimeout(this._settingsConfirming[confirmKey]);
      delete this._settingsConfirming[confirmKey];
    }
    this._settingsCommit(ieee, entry, (entry.expose.values || [])[0]);
  }

  _paintSettingsAction(ieee, entry) {
    const r = this.shadowRoot;
    if (!r) return;
    const id = this._settingsDomId(entry);
    const w = (this._settingsWrite[ieee] || {})[entry.key];
    const confirming = !!this._settingsConfirming[`${ieee}|${entry.prop}`];
    const btn = r.getElementById(`setact-${id}`);
    if (btn) {
      btn.disabled = !confirming && !!w && w.phase === 'pending';
      btn.textContent = confirming ? 'Press again to confirm' : w && w.phase === 'pending' ? 'Sending\u2026' : entry.label;
    }
    const err = r.getElementById(`seterr-${id}`);
    if (!err) return;
    if (w && w.phase === 'failed' && w.message) {
      err.hidden = false;
      err.textContent = w.message;
    } else if (w && w.phase === 'unconfirmed') {
      err.hidden = false;
      err.textContent = 'Sent, but the device did not confirm. Check the log if it did not apply.';
    } else {
      err.hidden = true;
      err.textContent = '';
    }
  }

  /* ---------------------------------------------------------------- commits */

  _settingsCommitNumber(ieee, key, el) {
    const d = this._dev(ieee);
    const entry = d && this._settingsFindEntry(d, key);
    if (!entry) return;
    this._settingsClearError(ieee, entry);
    if (el.classList) el.classList.remove('invalid');
    const raw = el.value;
    if (raw === '' || raw === el.dataset.value) return; // cleared, or unchanged: nothing to write
    const n = Number(raw);
    const e = entry.expose;
    const outOfRange =
      !Number.isFinite(n) || (e.value_min !== undefined && n < e.value_min) || (e.value_max !== undefined && n > e.value_max);
    if (outOfRange) {
      if (el.classList) el.classList.add('invalid');
      this._settingsShowError(ieee, entry, `Between ${e.value_min} and ${e.value_max}${e.unit ? ` ${e.unit}` : ''}`);
      return;
    }
    // The baseline moves to what was just sent immediately, not only once a
    // reply arrives: otherwise a blur with no further edit compares against
    // the stale pre-write value forever (nothing else repaints this box while
    // a write for it might still be in flight) and resends the same write.
    el.dataset.value = raw;
    this._settingsCommit(ieee, entry, n);
  }

  _settingsCommitText(ieee, key, el) {
    const d = this._dev(ieee);
    const entry = d && this._settingsFindEntry(d, key);
    if (!entry) return;
    this._settingsClearError(ieee, entry);
    const raw = typedName(el.value);
    if (raw === el.dataset.value) return;
    el.dataset.value = raw;
    this._settingsCommit(ieee, entry, raw);
  }

  /** N's kelvin box: typed kelvin converts to a clamped mired on commit. */
  _settingsCommitNTemp(ieee, key, el) {
    const d = this._dev(ieee);
    const entry = d && this._settingsFindEntry(d, key);
    if (!entry) return;
    this._settingsClearError(ieee, entry);
    if (el.classList) el.classList.remove('invalid');
    const raw = el.value;
    if (raw === '' || raw === el.dataset.value) return;
    const kelvin = Number(raw);
    const e = entry.expose;
    if (!Number.isFinite(kelvin) || kelvin <= 0) {
      if (el.classList) el.classList.add('invalid');
      this._settingsShowError(
        ieee, entry, `Between ${miredToKelvinDisplay(e.value_max)} and ${miredToKelvinDisplay(e.value_min)} K`
      );
      return;
    }
    el.dataset.value = raw;
    this._settingsCommit(ieee, entry, Math.max(e.value_min, Math.min(e.value_max, Math.round(1e6 / kelvin))));
  }

  /** Top-level M's box (§6.3): commits like F, in whatever unit the segment
   * currently shows. */
  _settingsCommitDuration(ieee, key, el) {
    const d = this._dev(ieee);
    const entry = d && this._settingsFindEntry(d, key);
    if (!entry) return;
    const id = this._settingsDomId(entry);
    const seg = this.shadowRoot.getElementById(`setdurseg-${id}`);
    const active = seg && (seg.querySelectorAll('[aria-selected="true"]') || [])[0];
    const unit = active ? active.textContent : 'Seconds';
    this._settingsClearError(ieee, entry);
    const raw = el.value;
    if (raw === '' || raw === el.dataset.value) return;
    const n = Number(raw);
    const bounds = durationBounds(unit);
    if (!Number.isFinite(n) || n < bounds.min || n > bounds.max) {
      this._settingsShowError(ieee, entry, `Between ${bounds.min} and ${bounds.max}`);
      return;
    }
    el.dataset.value = raw;
    this._settingsCommit(ieee, entry, durationEncode(unit, n));
  }

  /** Top-level M's unit segment: commits immediately -- there is no Apply to
   * defer to outside a composite. */
  _settingsDurationSetUnit(ieee, key, unit) {
    const d = this._dev(ieee);
    const entry = d && this._settingsFindEntry(d, key);
    if (!entry) return;
    const id = this._settingsDomId(entry);
    const box = this.shadowRoot.getElementById(`setdurbox-${id}`);
    const bounds = durationBounds(unit);
    const val = box && box.value ? Number(box.value) : bounds.min;
    this._settingsCommit(ieee, entry, durationEncode(unit, unit === 'Forever' ? 0 : val || bounds.min));
  }

  /** M inside a composite: the box writes into the draft using whatever
   * unit its own segment currently shows. */
  _settingsFeatureDurationSetVal(ieee, key, prop, el) {
    const id = `${this._settingsDomId({ key })}-${prop.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
    const seg = this.shadowRoot.getElementById(`setdurseg-${id}`);
    const active = seg && (seg.querySelectorAll('[aria-selected="true"]') || [])[0];
    const unit = active ? active.textContent : 'Seconds';
    const n = Number(el.value);
    if (!Number.isFinite(n)) return;
    const store = (this._settingsDraft[ieee] = this._settingsDraft[ieee] || {});
    (store[key] = store[key] || {})[prop] = durationEncode(unit, n);
  }

  /** M inside a composite: the unit segment writes into the draft too, so
   * switching units before Apply is pressed is not lost. */
  _settingsFeatureDurationSetUnit(ieee, key, prop, unit) {
    const store = (this._settingsDraft[ieee] = this._settingsDraft[ieee] || {});
    const draft = (store[key] = store[key] || {});
    const bounds = durationBounds(unit);
    const current = Object.prototype.hasOwnProperty.call(draft, prop) ? durationDecode(draft[prop]).val : bounds.min;
    draft[prop] = durationEncode(unit, unit === 'Forever' ? 0 : current || bounds.min);
    this._settingsRepaintFeature(ieee, key, prop);
  }

  /** Repaints one composite feature's control after a draft-only change
   * (a chip tap, a unit switch) that the generic onchange path never sees. */
  _settingsRepaintFeature(ieee, key, prop) {
    const d = this._dev(ieee);
    const entry = d && this._settingsFindEntry(d, key);
    const f = entry && entry.features && entry.features.find((x) => x.prop === prop);
    if (!entry || !f) return;
    const id = `${this._settingsDomId(entry)}-${prop.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
    const box = this.shadowRoot.getElementById(`setfeat-${id}`);
    if (!box) return;
    box.innerHTML = this._settingsFeatureControlHtml(d, entry, f, id);
    this._wire(box);
  }

  /** Local-only UI for a `.gslider`, keyed by `data-gs="role|payload"`: pure
   * presentation (readout, dependent tints), never a write (§3.2). */
  _gsliderInput(el) {
    const [role, ieee, key] = String(el.dataset.gs || '').split('|');
    const box = el.parentElement && el.parentElement.querySelectorAll
      ? el.parentElement.querySelectorAll('[data-setnum],[data-setntemp]')[0]
      : null;
    if (role === 'setk' && box) box.value = el.value;
    if (role === 'setn' && box) {
      const d = this._dev(ieee);
      const entry = d && this._settingsFindEntry(d, key);
      if (entry) {
        const mired = tempPositionToMired(Number(el.value), entry.expose.value_min, entry.expose.value_max);
        box.value = miredToKelvinDisplay(mired);
      }
    }
    if (role === 'setl') {
      // Magnetic detents (§5.2): snap the thumb within \u00b1 4 of a canonical point.
      const v = Number(el.value);
      const near = L_DETENTS.find((d2) => Math.abs(d2 - v) <= 4);
      if (near !== undefined && near !== v) el.value = String(near);
      if (box) box.value = el.value;
    }
  }

  /** The commit for every `.gslider` role (§3.2): one write per release or
   * keyboard-arrow burst. */
  _gsliderCommit(el) {
    const [role, ieee, key] = String(el.dataset.gs || '').split('|');
    const d = this._dev(ieee);
    const entry = d && this._settingsFindEntry(d, key);
    if (!entry) return;
    if (role === 'setk') {
      this._settingsCommit(ieee, entry, Number(el.value));
    } else if (role === 'setl') {
      this._settingsCommit(ieee, entry, Number(el.value));
    } else if (role === 'setn') {
      const mired = tempPositionToMired(Number(el.value), entry.expose.value_min, entry.expose.value_max);
      this._settingsCommit(ieee, entry, mired);
    }
  }

  _settingsApplyComposite(ieee, key) {
    const d = this._dev(ieee);
    const entry = d && this._settingsFindEntry(d, key);
    if (!entry || !entry.features) return;
    const draft = (this._settingsDraft[ieee] || {})[key] || {};
    const payload = {};
    entry.features.forEach((f) => {
      if (Object.prototype.hasOwnProperty.call(draft, f.prop)) {
        payload[f.prop] = draft[f.prop];
        return;
      }
      const known = this._settingsFeatureValue(d, entry, f);
      if (known.known) payload[f.prop] = known.value;
    });
    if (!Object.keys(payload).length) return;
    this._settingsCommit(ieee, entry, payload);
  }

  /* ---------------------------------------------------------------- filter */

  /** §3.6: hides non-matching rows, searches inside groups and composites, and
   * auto-expands whatever the filter itself needed open -- restoring exactly
   * that set (never a group the operator opened by hand) once it clears. */
  _settingsApplyFilter() {
    const r = this.shadowRoot;
    const d = this._dev(this._view.ieee);
    if (!r || !d) return;
    const ieee = d.ieee_address;
    const q = this._setFilter.trim().toLowerCase();
    const filtering = q.length > 0;
    const cls = this._settingsClassify(d);
    const forced = (this._settingsFilterOpen[ieee] = this._settingsFilterOpen[ieee] || new Set());
    let matchCount = 0;

    const rowMatches = (entry) => {
      if (!filtering) return true;
      const hay = `${entry.label} ${entry.prop} ${entry.description || ''}`.toLowerCase();
      if (hay.includes(q)) return true;
      return !!(entry.features && entry.features.some((f) => `${f.label} ${f.prop}`.toLowerCase().includes(q)));
    };
    const setExpanded = (el, key, wantOpen) => {
      if (!el) return;
      if (wantOpen) forced.add(key);
      else if (forced.has(key)) forced.delete(key);
      else return; // the operator opened this one themselves; the filter leaves it alone
      const isOpen = wantOpen || !!(this._settingsOpen[ieee] || {})[key];
      if (this._has('ha-expansion-panel')) el.expanded = isOpen;
      else el.open = isOpen;
    };

    let anyVisible = false;
    cls.main.forEach((entry) => {
      const el = r.getElementById(`setrow-${this._settingsDomId(entry)}`);
      if (!el) return;
      const hit = rowMatches(entry);
      el.hidden = !hit;
      if (hit) {
        anyVisible = true;
        matchCount += 1;
      }
      if (entry.expose.type === 'composite') setExpanded(el, entry.key, filtering && hit);
    });

    const paintGroup = (key, entries) => {
      const groupEl = r.getElementById(`setrow-group-${key}`);
      if (!groupEl) return;
      let groupHit = false;
      entries.forEach((entry) => {
        const rowEl = r.getElementById(`setrow-${this._settingsDomId(entry)}`);
        const hit = rowMatches(entry);
        if (rowEl) rowEl.hidden = !hit;
        if (hit) {
          groupHit = true;
          matchCount += 1;
        }
      });
      groupEl.hidden = filtering && !groupHit;
      if (groupHit) anyVisible = true;
      setExpanded(groupEl, `group:${key}`, filtering && groupHit);
    };
    paintGroup('options', cls.options);
    paintGroup('diagnostic', cls.diagnostic);

    const empty = r.getElementById('setfilterempty');
    if (empty) {
      empty.hidden = !filtering || anyVisible;
      const qEl = r.getElementById('setfilterq');
      if (qEl) qEl.textContent = this._setFilter;
    }
    const count = r.getElementById('setfiltercount');
    if (count) count.textContent = `${matchCount} match${matchCount === 1 ? '' : 'es'}`;
    const clearBtn = r.getElementById('setfilterclear');
    if (clearBtn) clearBtn.hidden = !filtering;
  }

  _clearSettingsFilter() {
    this._setFilter = '';
    this._setFilterCaret = null;
    const r = this.shadowRoot;
    const el = r && r.getElementById('setfilter');
    if (el) {
      el.value = '';
      el.focus();
    }
    this._settingsApplyFilter();
  }

  /* ------------------------------------------------------------- read now */

  /** Shared by the header button and the automatic mains-device read on entry, so
   * both ever say "Reading…" for the same in-flight call rather than racing. */
  _readDeviceValues(ieee) {
    if (this._settingsReading[ieee]) return Promise.resolve();
    this._settingsReading[ieee] = true;
    this._paintSettingsReadButton(ieee);
    return this._call('z2m/device/read_values', { device: ieee })
      .then((res) => {
        this._feedMsg = res && res.sleeping
          ? 'Asked. A battery device answers at its next wake-up.'
          : 'Asked the device to report its current values.';
        this._render();
        setTimeout(() => {
          this._feedMsg = null;
          this._render();
        }, 4000);
      })
      .catch((err) => {
        this._error = (err && (err.message || err.code)) || 'Could not ask the device';
        this._render();
      })
      .finally(() => {
        this._settingsReading[ieee] = false;
        this._paintSettingsReadButton(ieee);
      });
  }

  _paintSettingsReadButton(ieee) {
    const r = this.shadowRoot;
    const btn = r && r.getElementById('setread');
    if (!btn) return;
    const reading = !!this._settingsReading[ieee];
    btn.disabled = reading;
    btn.textContent = reading ? 'Reading\u2026' : 'Read from device';
  }

  /** A `z2m/device/state/subscribe` push: the merged map replaces what we know. */
  _onDeviceState(ieee, ev) {
    if (this._view.name !== 'device' || this._view.ieee !== ieee) return;
    this._settingsState[ieee] = (ev && ev.state) || {};
    this._syncSettings();
    this._syncLight(ieee);
  }

  /** Patches every light block's hero/brightness/temp/color surfaces in
   * place, diffed per block like every other sync helper here. */
  _syncLight(ieee) {
    const r = this.shadowRoot;
    if (!r || this._view.name !== 'device' || this._view.ieee !== ieee) return;
    const d = this._dev(ieee);
    if (!d) return;
    const live = this._liveEntities(ieee);
    const lightExposes = this._lightExposes(d);
    const lightEntities = live.controls.filter((item) => item.domain === 'light');
    const cache = (this._lightCache[ieee] = this._lightCache[ieee] || {});
    lightExposes.forEach((expose, n) => {
      const entity = lightEntities[n] || this._lightFallbackEntity(d);
      const box = r.getElementById(`lt${n}`);
      if (!box || this._settingsRowFocused(r, `lt${n}`) || this._settingsRowHot(box)) return;
      const html = this._lightBlockHtml(d, expose, n, entity);
      if (cache[n] === html) return;
      cache[n] = html;
      box.innerHTML = html;
      this._wire(box);
    });
  }

  /**
   * The light block's write lifecycle (§4.9): the v1.12.0 machine, with a
   * 400ms silent-success window and one chip for the whole block rather
   * than per control. `payload` is the full combined write (already carries
   * `state: "ON"` when the light was off, per the caller).
   */
  async _lightCommit(ieee, n, payload) {
    const store = (this._lightWrite[ieee] = this._lightWrite[ieee] || {});
    const token = ((store[n] || {}).token || 0) + 1;
    const w = (store[n] = { phase: 'pending', token, slow: false, message: null });
    const slowTimer = setTimeout(() => {
      if (store[n] !== w) return;
      w.slow = true;
      this._paintLightChip(ieee, n);
    }, 400);
    try {
      const res = await this._call('z2m/device/set', { device: ieee, payload });
      clearTimeout(slowTimer);
      if (store[n] !== w) return;
      if (res && res.confirmed) {
        const echoed = res.state || {};
        const adjusted = Object.keys(payload).some((k) => !this._lightValueClose(k, payload[k], echoed[k]));
        if (adjusted) {
          w.phase = 'adjusted';
          w.message = this._lightAdjustedText(ieee, n, echoed);
        } else {
          w.phase = 'confirmed';
          this._lightFadeWrite(ieee, n, token);
        }
      } else if (res && Object.prototype.hasOwnProperty.call(res, 'sleeping')) {
        w.phase = res.sleeping ? 'queued' : 'unconfirmed';
      } else {
        w.phase = 'sent';
        this._lightFadeWrite(ieee, n, token);
      }
    } catch (err) {
      clearTimeout(slowTimer);
      if (store[n] !== w) return;
      w.phase = 'failed';
      w.message = this._feedMessage(err, 'The write failed');
    }
    this._paintLightBlock(ieee, n);
  }

  _lightValueClose(prop, written, echoed) {
    if (echoed === undefined) return false;
    if (prop === 'state') return String(written) === String(echoed);
    if (prop === 'brightness' || prop === 'color_temp') return Math.abs(Number(written) - Number(echoed)) <= 2;
    if (prop === 'color') {
      if (written && written.hue !== undefined) {
        return (
          echoed && Math.abs((written.hue || 0) - (echoed.hue || 0)) <= 4 && Math.abs((written.saturation || 0) - (echoed.saturation || 0)) <= 4
        );
      }
      return true; // xy/hex echoes: the bulb's own gamut clamp is authoritative
    }
    return true;
  }

  _lightAdjustedText(ieee, n, echoed) {
    const d = this._dev(ieee);
    const expose = this._lightExposes(d)[n];
    if (!expose) return '';
    if (echoed.brightness !== undefined) {
      return `${brightnessToPct(Number(echoed.brightness), brightnessMax(this._lightFeature(expose, 'brightness') || {}))}%`;
    }
    if (echoed.color_temp !== undefined) return `${miredToKelvinDisplay(Number(echoed.color_temp))} K`;
    if (echoed.color && echoed.color.hue !== undefined) return hueName(echoed.color.hue, echoed.color.saturation);
    if (echoed.state !== undefined) return String(echoed.state);
    return '';
  }

  _lightFadeWrite(ieee, n, token) {
    setTimeout(() => {
      const store = this._lightWrite[ieee];
      const w = store && store[n];
      if (!w || w.token !== token) return;
      delete store[n];
      this._paintLightBlock(ieee, n);
    }, 2000);
  }

  _paintLightChip(ieee, n) {
    const r = this.shadowRoot;
    const chipEl = r && r.getElementById(`lt${n}-chip`);
    if (!chipEl) return;
    const write = (this._lightWrite[ieee] || {})[n];
    const text = this._lightChipHtml(write);
    chipEl.hidden = !text;
    chipEl.textContent = text;
  }

  /** After a commit settles, repaint just this block the same way `_syncLight` does. */
  _paintLightBlock(ieee, n) {
    const r = this.shadowRoot;
    if (!r || this._view.name !== 'device' || this._view.ieee !== ieee) return;
    const d = this._dev(ieee);
    const expose = d && this._lightExposes(d)[n];
    const live = this._liveEntities(ieee);
    const entity = (d && expose && (live.controls.filter((item) => item.domain === 'light')[n] || this._lightFallbackEntity(d))) || null;
    const box = r.getElementById(`lt${n}`);
    if (!d || !expose || !entity || !box) return;
    const html = this._lightBlockHtml(d, expose, n, entity);
    const cache = (this._lightCache[ieee] = this._lightCache[ieee] || {});
    cache[n] = html;
    box.innerHTML = html;
    this._wire(box);
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

  /** Patch the coordinator card in place, the same bargain _syncFw makes. */
  _syncCoord() {
    if (this._view.name !== 'diagnostics' || !this.shadowRoot) return;
    const box = this.shadowRoot.getElementById('coordbox');
    if (!box) return;
    const html = this._coordInner();
    if (html === this._lastCoord) return;
    this._lastCoord = html;
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
   * than it can be read. The rule is about the SUBJECT of the line: the interview
   * conversation with the joining device is kept in full -- that detail is the
   * reason to run at debug at all -- and routine traffic is dropped.
   *
   * State publishes are dropped even for the device being paired. A device starts
   * reporting the moment it is interviewed, and `last_seen` republishes on its own
   * schedule, which is exactly the spam that buried the interview on a phone.
   */
  _pairLogRelevant(message) {
    const text = String(message);
    const p = this._pairing;
    const target = p.target;
    const name = (p.event && p.event.friendly_name) || null;
    const mentionsTarget =
      (target && text.includes(target)) || (name && name !== target && text.includes(name));

    // Publishes are judged by TOPIC first, before the target earns its exemption
    // below: a joining device's own state is still state.
    const publish = text.match(/^z2m:mqtt: MQTT publish: topic '([^']*)'/);
    if (publish) {
      const topic = publish[1];
      // Device topics carry state, never pairing -- the target's included.
      if (!/\/bridge\//.test(topic)) return false;
      // Among bridge topics, only the pairing conversation. The rest is the
      // retained inventory republishing, or this panel's own log-level flip.
      return /\/bridge\/(event|request\/permit_join|response\/(permit_join|device\/))/.test(
        topic
      );
    }
    // A state payload under any other prefix is still state.
    if (/"last_seen"/.test(text)) return false;

    // Anything else naming the device being paired is kept: at debug level this is
    // the interview and configure conversation, read as it happens.
    if (mentionsTarget) return true;

    // Routine traffic from devices already on the network.
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
    const overflow = Math.max(0, p.logs.length - PAIR_LOG_MAX);
    if (overflow) p.logs.splice(0, overflow);
    // Patch the log box in place: a full render would drop the operator's typing
    // in the name field once a device has joined. The row is APPENDED rather than
    // the box re-written, because assigning innerHTML resets scrollTop -- which is
    // what threw a paused reader back to the top on every arriving line.
    //
    // While paused the box is allowed to grow past the buffer cap: trimming from
    // the top would slide the text the operator is reading. Resuming re-renders
    // from the capped buffer, which is the one moment trimming costs nothing.
    const box = this.shadowRoot && this.shadowRoot.getElementById('pairlog');
    if (!box) return;
    box.insertAdjacentHTML('beforeend', this._pairLogRow(entry));
    if (!p.follow) {
      p.unread += 1;
      this._syncPairFollow();
      return;
    }
    if (overflow) box.innerHTML = this._pairLogRows();
    box.scrollTop = box.scrollHeight;
  }

  /** Pin the log to its newest line, discarding what paused reading held on to. */
  _scrollPairLog() {
    const box = this.shadowRoot && this.shadowRoot.getElementById('pairlog');
    if (!box) return;
    box.innerHTML = this._pairLogRows();
    box.scrollTop = box.scrollHeight;
  }

  /**
   * Re-label the follow control on its own.
   *
   * The gesture and the button share one piece of state, and the log lives inside
   * the dialog: repainting the dialog to show a label change would rebuild the
   * very element being scrolled, losing the position the operator scrolled to.
   */
  _syncPairFollow() {
    const btn = this.shadowRoot && this.shadowRoot.getElementById('pairfollow');
    if (!btn) return;
    btn.setAttribute('aria-pressed', String(this._pairing.follow));
    btn.textContent = this._pairFollowLabel();
  }

  _pairLogRows() {
    return this._pairing.logs.map((e) => this._pairLogRow(e)).join('');
  }

  _pairLogRow(e) {
    const level = esc(e.level || 'info');
    return `<div class="log ${level}"><span class="l">${level}</span><span class="m">${esc(
      e.message
    )}</span></div>`;
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
      // NOT `type="standard"`, which is what ha-dialog defaults itself to. On a
      // narrow screen HA styles a standard dialog as a full-screen takeover, and
      // that rule sets `margin-top:0` as a literal -- not through
      // `--dialog-surface-margin-top`. The width and height of the takeover can be
      // overridden with custom properties (see the CSS), but the pin to the top of
      // the viewport cannot, so a standard dialog can never be centred vertically.
      // Any other type keeps HA's own centred window: `margin:auto` on the surface.
      el.setAttribute('type', 'dialog');
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
    // A Back press while the dialog is open closes the dialog instead of
    // leaving the panel view underneath it (§ routing): this entry exists
    // only to be popped, either by that press or by the dialog's own close
    // affordances.
    if (typeof history !== 'undefined' && history.pushState) {
      const path = this._locationSubpath();
      history.pushState(null, '', `/z2m${path ? `/${path}` : ''}#pair`);
      p.historyPushed = true;
    }
    // Watching starts immediately; the radio waits for Start.
    await this._openPairing();
  }

  /**
   * Close the dialog, and with it the window and the subscriptions.
   *
   * Closing is the same event however it arrives -- the button, Escape, the
   * scrim, navigating away, or the operator's own Back press -- so all of
   * them land here. Only the first four owe the '#pair' history entry a pop:
   * a Back-driven close (`skipHistoryPop`) already consumed it by definition,
   * and popping it here too would walk one entry too far.
   */
  _closePairDialog(skipHistoryPop) {
    const p = this._pairing;
    if (!p.open) return;
    p.open = false;
    const d = this._dialog;
    if (d) {
      if (d.native) d.el.open = false;
      d.el.remove();
      d.painted = null;
    }
    const historyPushed = p.historyPushed;
    this._leavePairing();
    this._startTicker();
    this._render();
    if (!skipHistoryPop && historyPushed && typeof history !== 'undefined' && history.back) {
      history.back();
    }
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

    return '<ha-form data-form="pair"></ha-form>';
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
            <ha-button appearance="plain" size="s" data-act="pairfollow" id="pairfollow"
              aria-pressed="${p.follow}">${esc(this._pairFollowLabel())}</ha-button>
          </span>
        </div>
        <div class="pair-log" id="pairlog" tabindex="0" role="log"
          aria-label="Zigbee2MQTT log">${this._pairLogRows()}</div>
      </div>`;
  }

  /** Shared by the initial paint and the scroll-driven patch, so they never disagree. */
  _pairFollowLabel() {
    const p = this._pairing;
    if (p.follow) return 'Following';
    return p.unread > 0 ? `Jump to latest \u00b7 ${p.unread > 99 ? '99+' : p.unread}` : 'Jump to latest';
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
    const name = typedName(spec.data.name);
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
    if (!d.checked || d.checking) {
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
    const routersCard = `<ha-card class="nav-card">
         <div class="card-header">Routers missing from the coordinator
           <ha-button appearance="plain" size="s" data-act="coordcheck">Re-check</ha-button>
         </div>
         <div class="card-content">${routerBody}</div>
         <div class="note">A router the coordinator cannot see is still reachable through its
         neighbours, but it will not be offered as a parent for devices that join next.</div>
       </ha-card>`;

    return `<div class="devgrid">${
      d.error ? `<ha-alert alert-type="error">${esc(d.error)}</ha-alert>` : ''
    }${this._coordCard()}${this._meshHealthCard()}${this._energyCard()}${routersCard}</div>`;
  }

  /* ------------------------------------------------------------- coordinator */

  /**
   * The coordinator board itself, read entirely from Home Assistant's own states:
   * the smlight integration owns these entities and pushes their changes, so this
   * card costs no websocket command and no polling. Missing or unavailable
   * entities are skipped rather than rendered as noise.
   */
  _coordCard() {
    return `<ha-card class="nav-card"><div id="coordbox">${this._coordInner()}</div></ha-card>`;
  }

  _coordInner() {
    const states = (this._hass && this._hass.states) || {};
    const usable = (eid) => {
      const st = states[eid];
      return st && st.state !== 'unavailable' && st.state !== 'unknown' ? st : null;
    };

    const chips = [];
    COORD_BINARY.forEach(([eid, label]) => {
      const st = usable(eid);
      if (!st) return;
      const on = st.state === 'on';
      chips.push(
        `<span class="chip2 ${on ? 'ok' : 'bad'}">${esc(label)}${on ? '' : ' down'}</span>`
      );
    });
    const mode = usable(COORD_MODE);
    if (mode) chips.push(`<span class="chip2">${esc(mode.state)}</span>`);

    const tiles = COORD_SENSORS.map(([eid, label]) => {
      const st = usable(eid);
      if (!st) return '';
      const item = { eid, domain: 'sensor', st };
      return `<div class="sens" data-sens="${esc(eid)}">
          <div class="sens-v">${this._sensReading(item)}</div>
          <div class="sens-l" title="${esc(label)}">${esc(label)}</div>
        </div>`;
    }).join('');

    const fwRows = COORD_FIRMWARE.map(([eid, label]) => {
      const st = states[eid];
      if (!st) return '';
      const a = st.attributes || {};
      const unavailable = st.state === 'unavailable' || st.state === 'unknown';
      const avail = st.state === 'on';
      return row({
        icon: MDI.firmware,
        headline: esc(label),
        text: `${fwVersion(a.installed_version)}${
          avail ? ` \u2192 ${fwVersion(a.latest_version)}` : ''
        }`,
        end: `<span slot="end" class="chip ${unavailable ? 'off' : avail ? 'warn' : 'ok'}">${
          unavailable ? 'unreachable' : avail ? 'Update available' : 'Up to date'
        }</span>`,
      });
    }).join('');

    const swRows = COORD_SWITCHES.map(([eid, label]) => {
      const st = states[eid];
      if (!st) return '';
      const unavailable = st.state === 'unavailable' || st.state === 'unknown';
      return `<div class="ctl">
          <div class="ctl-info"><div class="ctl-name">${esc(label)}</div></div>
          <ha-control-switch data-ctltoggle="${esc(eid)}"${
            unavailable ? ' disabled' : ''
          }></ha-control-switch>
        </div>`;
    }).join('');

    if (!chips.length && !tiles && !fwRows && !swRows) {
      return `<div class="card-header">Coordinator</div>
        <div class="note">Home Assistant has no entities for the coordinator board right
        now, so there is nothing to show.</div>`;
    }
    return `<div class="card-header">Coordinator</div>
      <div class="note">${COORD_HOST}, read from its own integration.</div>
      ${chips.length ? `<div class="devchips">${chips.join('')}</div>` : ''}
      ${tiles ? `<div class="sens-grid">${tiles}</div>` : ''}
      ${fwRows ? list(fwRows) : ''}
      ${swRows}`;
  }

  /* ------------------------------------------------------------- mesh health */

  async _loadMeshHealth() {
    const d = this._diag;
    try {
      d.mesh = await this._call('z2m/health');
      d.meshError = null;
    } catch (err) {
      d.meshError = this._feedMessage(err, 'Could not read the health report');
    }
    d.meshLoaded = true;
    if (this._view.name === 'diagnostics') this._render();
  }

  /**
   * Zigbee2MQTT's own health report, retained by the bridge and re-published every
   * ten minutes with fresh per-device counters. The card answers one question --
   * does anything need attention -- and keeps the raw counters one fold away.
   */
  _meshHealthCard() {
    const d = this._diag;
    const verifyChip = d.verifying
      ? '<span class="chip">checking\u2026</span>'
      : d.verify
        ? `<span class="chip ${d.verify.healthy ? 'ok' : 'off'}">${
            d.verify.healthy ? 'healthy' : 'unhealthy'
          }</span>`
        : '';
    const header = `<div class="card-header">Mesh health
        <span class="header-actions">${verifyChip}<ha-button appearance="plain" size="s"
          data-act="health"${d.verifying ? ' disabled' : ''}>Verify now</ha-button></span>
      </div>`;

    if (d.meshError) {
      return `<ha-card class="nav-card">${header}
          <div class="card-content"><ha-alert alert-type="error">${esc(d.meshError)}</ha-alert></div>
        </ha-card>`;
    }
    const env = d.mesh;
    const h = env && env.health;
    if (!h) {
      return `<ha-card class="nav-card">${header}
          <div class="note">${
            d.meshLoaded
              ? 'Zigbee2MQTT has not published a health report yet. One arrives every ten minutes.'
              : 'Reading the last health report\u2026'
          }</div>
        </ha-card>`;
    }

    const os = h.os || {};
    const proc = h.process || {};
    const mqtt = h.mqtt || {};
    const perDev = h.devices || {};

    const chips = [];
    if (proc.uptime_sec != null) {
      chips.push(`<span class="chip2">Up ${esc(this._dur(proc.uptime_sec))}</span>`);
    }
    chips.push(`<span class="chip2 ${mqtt.connected ? 'ok' : 'bad'}">MQTT ${
      mqtt.connected ? 'connected' : 'disconnected'
    }</span>`);
    if (Number(mqtt.queued) > 0) {
      chips.push(`<span class="chip2 warn">${esc(String(mqtt.queued))} queued</span>`);
    }
    const load = Array.isArray(os.load_average) ? Number(os.load_average[0]) : NaN;
    if (Number.isFinite(load)) {
      chips.push(`<span class="chip2">Load ${esc(load.toFixed(2))}</span>`);
    }

    // What needs a person: devices whose counters fired, and devices that exist in
    // the mesh but said nothing at all since the counters were last reset.
    const times = (n) => (n === 1 ? 'once' : n === 2 ? 'twice' : `${n} times`);
    const attention = [];
    Object.entries(perDev).forEach(([ieee, c]) => {
      const reasons = [];
      if ((c.leave_count || 0) > 0) {
        reasons.push(`Left and rejoined the network ${times(c.leave_count)}`);
      }
      if ((c.network_address_changes || 0) > 0) {
        reasons.push(`Changed network address ${times(c.network_address_changes)}`);
      }
      if (!reasons.length) return;
      const dev = this._dev(ieee);
      attention.push({
        ieee,
        name: (dev && dev.friendly_name) || ieee,
        text: reasons.join(' \u00b7 '),
      });
    });
    // Silence is only evidence for a ROUTER: mains powered, always listening, and
    // it relays for others, so ten quiet minutes means something is wrong. Battery
    // end devices sleep through whole health windows as a matter of design, and
    // flagging them made this list cry wolf on most of the fleet.
    this._devices.forEach((dev) => {
      if (dev.type !== 'Router') return;
      const c = perDev[dev.ieee_address];
      if (c && (c.messages || 0) > 0) return;
      attention.push({
        ieee: dev.ieee_address,
        name: dev.friendly_name || dev.ieee_address,
        text: 'Router silent since the last health reset',
      });
    });

    const attnBlock = attention.length
      ? `<div class="ota-group">Needs attention</div><div class="attn">${list(
          attention
            .map((x) =>
              row({
                icon: MDI.alert,
                headline: esc(x.name),
                text: esc(x.text),
                data: ` data-ieee="${esc(x.ieee)}"`,
                tap: true,
              })
            )
            .join('')
        )}</div>`
      : `<div class="card-content"><ha-alert alert-type="success">No device has dropped, rejoined, or gone silent since the last check.</ha-alert></div>`;

    const all = Object.entries(perDev)
      .map(([ieee, c]) => ({
        name: ((this._dev(ieee) || {}).friendly_name) || ieee,
        mps: Number(c.messages_per_sec) || 0,
        messages: c.messages || 0,
        leaves: c.leave_count || 0,
        addr: c.network_address_changes || 0,
      }))
      .sort((a, b) => b.mps - a.mps);
    const table = `<div class="htab">
        <div class="htab-row htab-head"><span>Device</span><span>Msgs/s</span><span>Total</span><span>Leaves</span><span>Addr changes</span></div>
        ${all
          .map(
            (x) =>
              `<div class="htab-row"><span title="${esc(x.name)}">${esc(x.name)}</span><span>${x.mps.toFixed(
                2
              )}</span><span>${x.messages}</span><span>${x.leaves}</span><span>${x.addr}</span></div>`
          )
          .join('')}
      </div>`;

    const age = env.received_at
      ? this._age(new Date(env.received_at * 1000).toISOString())
      : null;
    return `<ha-card class="nav-card">${header}
        <div class="devchips">${chips.join('')}</div>
        ${attnBlock}
        <ha-expansion-panel header="All devices (${all.length})">${table}</ha-expansion-panel>
        <div class="note">Counters cover roughly the last 10 minutes: Zigbee2MQTT resets
        them after each report${age ? `, and this one arrived ${esc(age)}` : ''}.</div>
      </ha-card>`;
  }

  /* ------------------------------------------------------ channel energy scan */

  async _loadScans() {
    const d = this._diag;
    try {
      const res = await this._call('z2m/energy_scan/list');
      const at = (x) => Date.parse(x.started_at) || 0;
      d.scans = ((res && res.scans) || []).slice().sort((a, b) => at(b) - at(a));
      d.scansError = null;
    } catch (err) {
      d.scansError = this._feedMessage(err, 'Could not read the saved scans');
    }
    d.scansLoaded = true;
    if (this._view.name === 'diagnostics') this._render();
  }

  _energySelected() {
    const scans = this._diag.scans || [];
    if (!scans.length) return null;
    return scans.find((x) => x.id === this._diag.scanSel) || scans[0];
  }

  _scanDate(scan) {
    const t = Date.parse(scan.started_at);
    if (!Number.isFinite(t)) return String(scan.started_at || '');
    return new Date(t).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  }

  _energyCard() {
    const d = this._diag;
    const s = d.scan;
    const scans = d.scans || [];
    const sel = this._energySelected();

    const header = `<div class="card-header">Channel energy scan${
      s.running
        ? ''
        : `<span class="header-actions"><ha-button appearance="filled" size="s"
             data-act="escan">Scan now</ha-button></span>`
    }</div>`;

    // The two-step confirm lives in the card itself: pressing Scan now only turns
    // this warning on, and nothing touches Zigbee2MQTT until it is accepted.
    const confirmBlock =
      s.confirm && !s.running
        ? `<div class="card-content"><ha-alert alert-type="warning" title="Zigbee2MQTT will be stopped">
             Devices stay paired but will not respond while the radio listens, about two
             minutes in total. Zigbee2MQTT restarts by itself afterwards.
           </ha-alert></div>
           <div class="actions">
             <ha-button appearance="plain" size="s" data-act="escancancel">Cancel</ha-button>
             <ha-button appearance="filled" size="s" data-act="escango">Stop and scan</ha-button>
           </div>`
        : '';

    let progress = '';
    if (s.running) {
      const order = { idle: 0, stopping: 0, scanning: 1, restarting: 2, done: 3, error: 3 };
      const at = order[s.stage] === undefined ? 0 : order[s.stage];
      const steps = ['Stopping Zigbee2MQTT', 'Scanning 16 channels', 'Restarting Zigbee2MQTT']
        .map((label, i) => {
          const state = i < at ? 'done' : i === at ? 'active' : 'todo';
          const mark =
            state === 'active'
              ? '<ha-spinner size="small"></ha-spinner>'
              : state === 'done'
                ? icon(MDI.check, '')
                : '<span class="scan-dot"></span>';
          return `<div class="scan-step ${state}">${mark}<span>${label}</span></div>`;
        })
        .join('');
      progress = `<div class="scan-steps">${steps}</div>${
        s.detail ? `<div class="note">${esc(s.detail)}</div>` : ''
      }`;
    }

    const errorBlock = s.error
      ? `<div class="card-content"><ha-alert alert-type="error">${esc(s.error)}</ha-alert></div>`
      : '';

    const newest = scans[0];
    const viewingOld = !!(sel && newest && sel.id !== newest.id);
    const chartBlock = sel
      ? `${
          viewingOld
            ? `<div class="devchips"><span class="chip2">Viewing scan from ${esc(
                this._scanDate(sel)
              )}</span></div>`
            : ''
        }${this._energyChart(sel)}<div class="note">${esc(this._energySummary(sel))}</div>`
      : '';

    const historyRows = scans
      .map((x) =>
        row({
          icon: MDI.radar,
          headline: esc(this._scanDate(x)),
          text: esc(this._age(x.started_at)),
          data: ` data-scan="${esc(x.id)}"`,
          tap: true,
          end: `${
            sel && sel.id === x.id ? '<span slot="end" class="chip">shown</span>' : ''
          }<ha-icon-button slot="end" data-act="scandel" data-scanid="${esc(x.id)}"
              data-path="${MDI.remove}" data-label="Delete scan"></ha-icon-button>`,
        })
      )
      .join('');
    const history = d.scansError
      ? `<div class="card-content"><ha-alert alert-type="error">${esc(d.scansError)}</ha-alert></div>`
      : !d.scansLoaded
        ? '<div class="note">Reading saved scans\u2026</div>'
        : scans.length
          ? `<div class="ota-group">Saved scans</div>${list(historyRows)}`
          : '<div class="note">No scans yet.</div>';

    return `<ha-card class="nav-card">${header}
        <div class="note">Measures RF noise on all 16 Zigbee channels; Zigbee2MQTT is
        stopped for about two minutes while the radio listens.</div>
        ${errorBlock}${confirmBlock}${progress}${chartBlock}${history}
      </ha-card>`;
  }

  /**
   * The scan as an inline SVG bar chart: channels 11-26 across, energy 0-100 up.
   * Colours and text ride the theme's own variables, so dark mode needs nothing.
   */
  _energyChart(scan) {
    const W = 660;
    const H = 250;
    const padL = 12;
    const padR = 12;
    const padT = 34;
    const padB = 26;
    const plotW = W - padL - padR;
    const plotH = H - padT - padB;
    const slot = plotW / 16;
    const barW = Math.min(30, slot - 8);
    const parts = [];
    for (let i = 0; i < 16; i += 1) {
      const ch = 11 + i;
      const raw = Number((scan.energy || {})[String(ch)]);
      const v = Number.isFinite(raw) ? Math.max(0, Math.min(100, raw)) : 0;
      const barH = (v / 100) * plotH;
      const x = padL + i * slot + (slot - barW) / 2;
      const y = padT + plotH - barH;
      const mid = (x + barW / 2).toFixed(1);
      const fill =
        v <= 25
          ? 'var(--success-color, #4caf50)'
          : v <= 50
            ? 'var(--warning-color, #ff9800)'
            : 'var(--error-color, #f44336)';
      const inUse = Number(scan.channel) === ch;
      parts.push(
        `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${Math.max(
          barH,
          1
        ).toFixed(1)}" rx="3" fill="${fill}"${
          inUse ? ' stroke="var(--primary-color)" stroke-width="2"' : ''
        }></rect>`,
        `<text class="ec-val" x="${mid}" y="${(y - 5).toFixed(1)}" text-anchor="middle">${Math.round(
          v
        )}</text>`,
        `<text class="ec-ch" x="${mid}" y="${H - 8}" text-anchor="middle">${ch}</text>`
      );
      if (inUse) {
        parts.push(
          `<text class="ec-use" x="${mid}" y="${(y - 18).toFixed(1)}" text-anchor="middle">in use</text>`
        );
      }
    }
    const base = (padT + plotH).toFixed(1);
    return `<div class="echart"><svg viewBox="0 0 ${W} ${H}" role="img"
        aria-label="Energy per Zigbee channel, 0 to 100">
        <line x1="${padL}" y1="${base}" x2="${W - padR}" y2="${base}"
          stroke="var(--secondary-text-color)" stroke-width="1"></line>
        ${parts.join('')}
      </svg></div>`;
  }

  _energySummary(scan) {
    let min = null;
    let max = null;
    for (let ch = 11; ch <= 26; ch += 1) {
      const v = Number((scan.energy || {})[String(ch)]);
      if (!Number.isFinite(v)) continue;
      if (min === null || v < min.v) min = { ch, v };
      if (max === null || v > max.v) max = { ch, v };
    }
    if (min === null) return 'The scan reported no energy readings.';
    return `Quietest channel ${min.ch} at ${Math.round(min.v)}%, busiest ${max.ch} at ${Math.round(
      max.v
    )}%.`;
  }

  /**
   * Run one scan end to end. The backend stops Zigbee2MQTT, listens, and restarts
   * it whatever happens; the run promise is the outcome, and the 2-second status
   * poll is only the narration between the two.
   */
  async _runEnergyScan() {
    const s = this._diag.scan;
    if (s.running) return;
    s.running = true;
    s.confirm = false;
    s.stage = 'stopping';
    s.detail = null;
    s.error = null;
    this._render();
    this._startEnergyPoll();
    try {
      const rec = await this._call('z2m/energy_scan/run');
      s.stage = 'done';
      if (rec && rec.id) {
        this._diag.scans = [rec, ...(this._diag.scans || []).filter((x) => x.id !== rec.id)];
        this._diag.scanSel = rec.id;
        this._diag.scansLoaded = true;
      }
    } catch (err) {
      s.stage = 'error';
      s.error = this._feedMessage(err, 'The energy scan failed');
    } finally {
      s.running = false;
      this._stopEnergyPoll();
      this._render();
    }
  }

  _startEnergyPoll() {
    this._stopEnergyPoll();
    this._energyTimer = setInterval(async () => {
      let st;
      try {
        st = await this._call('z2m/energy_scan/status');
      } catch (_) {
        return; // the run itself reports the outcome
      }
      const s = this._diag.scan;
      if (!s.running || !st) return;
      const stage = st.stage || s.stage;
      const detail = st.detail || null;
      if (stage === s.stage && detail === s.detail) return;
      s.stage = stage;
      s.detail = detail;
      if (this._view.name === 'diagnostics') this._render();
    }, 2000);
  }

  _stopEnergyPoll() {
    if (this._energyTimer) {
      clearInterval(this._energyTimer);
      this._energyTimer = null;
    }
  }

  /**
   * `checking` is what the renderer trusts while the request runs: the zdo
   * routing-table walk takes seconds, and an earlier build marked `checked`
   * up front with `routers` still null, so every fresh visit spent those
   * seconds showing "could not be read" for a request that had not failed.
   */
  async _runCoordinatorCheck() {
    if (this._diag.checking) return;
    this._diag.checking = true;
    try {
      const res = await this._call('z2m/coordinator_check');
      this._diag.routers = (res && res.missing_routers) || [];
      this._diag.error = null;
    } catch (err) {
      this._diag.routers = null;
      this._diag.error = (err && (err.message || err.code)) || 'Coordinator check failed';
    }
    this._diag.checking = false;
    this._diag.checked = true;
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
   * Opening the map never blocks on the radio, and never blocks on the backend
   * either. The element mounts immediately; a cached topology is then read with
   * `cached_only`, which hands back whatever cache exists even when it is stale
   * (the map shows its age, and Re-scan is one tap away). An earlier build asked
   * for the cache without that flag, and a STALE cache made the backend run a
   * blocking fleet walk before this view had mounted anything: the operator saw
   * a frozen page for ten seconds, then the whole map at once.
   *
   * Nothing cached at all -> a STREAMING scan starts: the retained device list
   * lands first so every device is on screen immediately, then each neighbour
   * table attaches as its reply arrives.
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

    // Mount first either way: the cached read below and the scan's very first
    // event both need somewhere to land.
    this._mountMap();

    const cached = !!this._map.topology || !!(this._summary || {}).map_generated;
    if (cached && !this._map.topology) {
      try {
        this._map.topology = await this._call('z2m/networkmap', { cached_only: true });
        this._map.error = null;
      } catch (err) {
        this._map.error = (err && (err.message || err.code)) || 'Could not read the cached map';
      }
      if (this._view.name !== 'map') return;
      if (this._map.el && this._map.topology) this._map.el.topology = this._map.topology;
      this._syncScan();
    }

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

      case 'devsearchclear':
        return this._clearDeviceSearch();

      // Only reachable from the fallback chrome; hass-subpage owns its own back arrow.
      case 'back':
        return this._back();

      // Top-level back leaves the panel for Settings, the same target as the
      // Z-Wave dashboard's back arrow.
      case 'backtop':
        history.pushState(null, '', '/config');
        window.dispatchEvent(new CustomEvent('location-changed', { detail: { replace: false } }));
        return undefined;

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
        if (this._pairing.follow) this._pairing.unread = 0;
        this._syncPairFollow();
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

      // Verify now on the Mesh health card: the on-demand check, kept as a chip.
      case 'health': {
        const diag = this._diag;
        if (diag.verifying) return undefined;
        diag.verifying = true;
        this._render();
        try {
          diag.verify = await this._call('z2m/health_check');
          diag.error = null;
        } catch (err) {
          diag.error = (err && (err.message || err.code)) || 'Health check failed';
        }
        diag.verifying = false;
        return this._render();
      }

      case 'coordcheck':
        this._diag.routers = null;
        this._runCoordinatorCheck();
        return this._render();

      case 'bindnew': {
        const s = this._bindsAll;
        s.create = !s.create;
        if (!s.create) {
          s.source = null;
          s.clusters = null;
          s.clustersError = null;
        }
        return this._render();
      }

      case 'escan':
        this._diag.scan.confirm = true;
        return this._render();

      case 'escancancel':
        this._diag.scan.confirm = false;
        return this._render();

      case 'escango':
        return this._runEnergyScan();

      case 'scandel': {
        const scanId = el && el.dataset && el.dataset.scanid;
        if (!scanId) return undefined;
        try {
          await this._call('z2m/energy_scan/delete', { scan: scanId });
        } catch (err) {
          this._diag.scansError = this._feedMessage(err, 'Could not delete the scan');
        }
        if (this._diag.scanSel === scanId) this._diag.scanSel = null;
        return this._loadScans();
      }

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
        // The overview's Bind button names its picked source; the device page's
        // names the device whose page it is. Both share the same form state.
        const source = (el && el.dataset && el.dataset.source) || this._binds.ieee;
        const spec = (this._forms || {})[`bind:${source}`];
        if (!spec) return undefined;
        const { endpoint, target, clusters } = spec.data;
        if (!target || !(clusters || []).length) {
          this._binds.error = 'Choose a target and at least one cluster first.';
          this._render();
          return undefined;
        }
        return this._bindWrite('z2m/device/bind', {
          from: source,
          from_endpoint: Number(endpoint),
          ...this._bindTarget(target),
          clusters,
        });
      }

      case 'unbind': {
        // Rows carry their whole triple, so removal works from any page: the device's
        // own list, the "controlled by" section, and the mesh overview.
        if (el.dataset.guard === 'report'
            && !confirm('This device would stop reporting these values to Zigbee2MQTT, '
              + 'so Home Assistant would stop seeing its state changes. Remove it anyway?')) {
          return undefined;
        }
        return this._bindWrite('z2m/device/unbind', {
          from: el.dataset.from || this._binds.ieee,
          from_endpoint: Number(el.dataset.endpoint),
          ...this._bindTarget(el.dataset.target),
          clusters: (el.dataset.clusters || el.dataset.cluster || '').split(',').filter(Boolean),
        });
      }

      case 'gotobinds':
        return this._go({ name: 'binds', ieee: el.dataset.fromieee });

      case 'configure':
        return this._act('z2m/device/configure', { device });

      case 'readvalues':
        // The manual path exists for exactly two cases the automatic read skips:
        // battery devices, and "I just changed something at the wall, show me now".
        return this._readDeviceValues(this._view.ieee);

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

      case 'setfilterclear':
        return this._clearSettingsFilter();

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
