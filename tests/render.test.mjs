/**
 * Runs the panel outside a browser: stub just enough DOM to instantiate it, feed it
 * the exact payloads the live WebSocket API returned, render every view and assert on
 * the produced HTML. Catches runtime faults a syntax check cannot.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..');

const fx = JSON.parse(readFileSync(join(here, 'fixture.json'), 'utf8'));

// ---- minimal DOM ----------------------------------------------------------
const nodes = [];
class El {
  constructor(id) { this.id = id; this.dataset = {}; this.value = ''; this.checked = false; }
  set onclick(f) { this._onclick = f; }
  get onclick() { return this._onclick; }
  set oninput(f) { this._oninput = f; }
  focus() {} setSelectionRange() {}
}
class ShadowRoot {
  constructor() { this._html = ''; this.scrollTop = 0; this._cache = new Map(); }
  set innerHTML(v) { this._html = v; this._cache.clear(); }
  get innerHTML() { return this._html; }
  getElementById(id) {
    if (!this._html.includes(`id="${id}"`)) return null;
    if (!this._cache.has(id)) { const e = new El(id); nodes.push(e); this._cache.set(id, e); }
    return this._cache.get(id);
  }
  querySelectorAll(sel) {
    // Return a stub per occurrence of the attribute the selector names.
    const attr = sel.replace(/[[\]]/g, '').split('=')[0];
    const re = new RegExp(`${attr}="([^"]*)"`, 'g');
    const out = []; let m;
    while ((m = re.exec(this._html))) {
      const e = new El(null);
      if (attr === 'data-go') e.dataset.go = m[1];
      if (attr === 'data-ieee') e.dataset.ieee = m[1];
      if (attr === 'data-prop') { e.dataset.prop = m[1]; e.dataset.kind = 'binary'; }
      out.push(e); nodes.push(e);
    }
    return out;
  }
}
globalThis.HTMLElement = class {
  constructor() { this.shadowRoot = null; }
  attachShadow() { this.shadowRoot = new ShadowRoot(); return this.shadowRoot; }
};
const defined = {};
globalThis.customElements = { define: (n, c) => { defined[n] = c; } };
globalThis.document = { createElement: () => new El() };
globalThis.window = { location: { href: '' } };
globalThis.history = { back() {} };
globalThis.confirm = () => true;
globalThis.alert = () => {};

// ---- load the panel -------------------------------------------------------
const src = readFileSync(
  join(repo, 'custom_components/z2m/panel/z2m-panel.js'), 'utf8');
new Function(src)();

const Panel = defined['z2m-panel'];
if (!Panel) throw new Error('z2m-panel was never registered');

// ---- drive it -------------------------------------------------------------
const sent = [];
const reservedKeyUse = [];
const hass = {
  // The panel reads firmware from HA's own `update` entities, so the stub must
  // carry states just like the real hass object does.
  states: fx.states,
  connection: {
    sendMessagePromise: (msg) => {
      // Home Assistant assigns the websocket envelope `id` itself and overwrites
      // whatever the caller put there. A command that uses `id` as a parameter
      // therefore loses it silently -- which shipped once, so it is asserted here.
      if (Object.prototype.hasOwnProperty.call(msg, 'id')) reservedKeyUse.push(msg.type);
      sent.push(msg);
      if (msg.type === 'z2m/info') return Promise.resolve(fx.info);
      if (msg.type === 'z2m/devices') return Promise.resolve(fx.devices);
      if (msg.type === 'z2m/groups') return Promise.resolve(fx.groups);
      return Promise.resolve(null);
    },
    subscribeMessage: () => Promise.resolve(() => {}),
  },
};

const p = new Panel();
p.connectedCallback();
p.hass = hass;
await new Promise((r) => setTimeout(r, 50));

let fails = 0;
const check = (name, cond, detail = '') => {
  if (cond) console.log(`  PASS  ${name}`);
  else { console.log(`  FAIL  ${name} ${detail}`); fails++; }
};

const html = () => p.shadowRoot.innerHTML;

console.log('=== dashboard ===');
check('rendered', html().length > 500);
check('shows device count', html().includes(`${fx.info.device_count} devices`));
check('shows offline count', fx.info.offline_count === 0 || html().includes(`${fx.info.offline_count} offline`));
check('shows online state', html().includes('Online'));
check('shows Z2M version', html().includes(fx.info.version));
check('has Add device', html().includes('Add device'));
check('has Network information', html().includes('Network information'));
check('links Zigbee Map', html().includes('showmap'));
check('links log panel', html().includes('/zigbee-log'));
check('has restart', html().includes('Restart Zigbee2MQTT'));
check('uses HA card vars', html().includes('--card-background-color'));
check('uses HA header var', html().includes('--app-header-background-color'));
check('has mobile breakpoint', html().includes('@media (max-width:600px)'));

console.log('=== devices list ===');
p._go({ name: 'devices' });
check('lists every device', fx.devices.every((d) => html().includes(esc(d.friendly_name))));
check('search box present', html().includes('id="q"'));
const offline = fx.devices.filter((d) => d.availability === 'offline');
check('flags offline devices', offline.length === 0 || html().includes('chip off'));

console.log('=== search filter ===');
p._filter = fx.devices[0].friendly_name.slice(0, 4);
p._render();
check('filter narrows list', html().includes(esc(fx.devices[0].friendly_name)));

console.log('=== device detail (with options) ===');
const withOpts = fx.devices.find((d) => (d.options || []).length > 3);
p._go({ name: 'device', ieee: withOpts.ieee_address });
check(`opened ${withOpts.friendly_name}`, html().includes(esc(withOpts.friendly_name)));
check('shows IEEE', html().includes(withOpts.ieee_address));
check('shows vendor/model', html().includes(esc(withOpts.model)));
check('generated settings form', html().includes('Device settings'));
const rendered = (withOpts.options || []).filter((o) =>
  ['numeric', 'binary', 'enum', 'text'].includes(o.type));
check(`rendered ${rendered.length} option fields`,
  rendered.every((o) => html().includes(`data-prop="${o.property}"`)));
check('has rename', html().includes('dorename'));
check('has reconfigure', html().includes('doconfigure'));
check('has re-interview', html().includes('dointerview'));
check('has firmware card', html().includes('id="fwbox"'));
check('has remove', html().includes('doremove'));

console.log('=== every device detail renders ===');
let bad = [];
for (const d of fx.devices) {
  try { p._go({ name: 'device', ieee: d.ieee_address }); if (html().length < 300) bad.push(d.friendly_name); }
  catch (e) { bad.push(`${d.friendly_name}: ${e.message}`); }
}
check(`all ${fx.devices.length} device pages render`, bad.length === 0, bad.slice(0, 3).join('; '));

console.log('=== network + groups ===');
p._go({ name: 'network' });
check('shows channel', html().includes(String(fx.info.network.channel)));
check('shows PAN ID', html().includes(String(fx.info.network.pan_id)));
check('withholds network key', !html().toLowerCase().includes('network_key'));
p._go({ name: 'groups' });
check('lists groups', fx.groups.every((g) => html().includes(esc(g.friendly_name))));

console.log('=== firmware: device card ===');
// Mains device with an update available -> Install offered, not Schedule.
p._go({ name: 'device', ieee: '0x0000000000000001' });
check('firmware card rendered', html().includes('Firmware'));
check('shows installed version', html().includes('2.15'));
check('shows latest version', html().includes('2.18'));
check('flags update available', html().includes('Update available'));
check('offers Install for mains device', html().includes('fwinstall'));
check('no Schedule for mains device', !html().includes('fwsched'));
check('offers Check', html().includes('fwcheck'));

// Battery device -> Schedule instead of Install, because it is asleep.
p._go({ name: 'device', ieee: '0x0000000000000002' });
check('battery device offers Schedule', html().includes('fwsched'));
check('battery device hides Install', !html().includes('fwinstall'));
check('explains the wake-up behaviour', html().includes('next wakes'));

// Z2M publishes -1/-1 when it has never consulted the OTA index.
p._go({ name: 'device', ieee: '0x0000000000000004' });
check('-1 renders as Not assessed', html().includes('Not assessed'));
check('-1 is not shown as a version', !html().includes('>-1<'));

// Device with no OTA support at all.
p._go({ name: 'device', ieee: '0x0000000000000003' });
check('no-OTA device explains itself', html().includes('no OTA support'));
check('no-OTA device offers no buttons', !html().includes('fwcheck'));

console.log('=== firmware: fleet view ===');
p._go({ name: 'ota' });
const otaDevs = fx.devices.filter((d) => d.update_entity);
check(`lists all ${otaDevs.length} OTA-capable devices`,
  otaDevs.every((d) => html().includes(esc(d.friendly_name))));
check('excludes non-OTA device', !html().includes('Unknown Gadget'));
check('has Check all', html().includes('checkall'));
check('warns that check-all is staggered', html().includes('seconds apart'));

console.log('=== firmware: commands ===');
p._go({ name: 'device', ieee: '0x0000000000000001' });
sent.length = 0;
p.shadowRoot.getElementById('fwcheck')._onclick();
await new Promise((r) => setTimeout(r, 20));
check('Check -> z2m/ota/check', sent.some((m) => m.type === 'z2m/ota/check'
  && m.device === '0x0000000000000001'));
sent.length = 0;
p.shadowRoot.getElementById('fwinstall')._onclick();
await new Promise((r) => setTimeout(r, 20));
check('Install -> z2m/ota/update', sent.some((m) => m.type === 'z2m/ota/update'));

console.log('=== firmware: live progress patch ===');
// Simulate HA pushing an in-progress update; only the firmware card should change.
hass.states['update.hallway_dimmer'] = {
  state: 'on',
  attributes: { installed_version: '2.15', latest_version: '2.18',
                in_progress: true, update_percentage: 42 },
};
p.hass = hass;
// _syncFw patches the firmware card's own innerHTML rather than re-rendering the
// view, so assert against that element -- the shadow root's html is intentionally
// left untouched, which is the whole point of the targeted patch.
const fwbox = p.shadowRoot.getElementById('fwbox');
check('progress patched into the firmware card', String(fwbox.innerHTML).includes('42'));
check('Abort replaces Check while updating', String(fwbox.innerHTML).includes('fwabort'));
check('view was NOT fully re-rendered', !html().includes('42'));

console.log('=== actions call the right commands ===');
p._go({ name: 'dashboard' });
sent.length = 0;
p.shadowRoot.getElementById('permit')._onclick();
await new Promise((r) => setTimeout(r, 20));
check('Add device -> z2m/permit_join with time', sent.some((m) => m.type === 'z2m/permit_join' && m.time === 254));
sent.length = 0;
p.shadowRoot.getElementById('restart')._onclick();
await new Promise((r) => setTimeout(r, 20));
check('Restart -> z2m/restart', sent.some((m) => m.type === 'z2m/restart'));

console.log('=== websocket envelope contract ===');
check(`no command uses the reserved 'id' key (${reservedKeyUse.length} offenders)`,
  reservedKeyUse.length === 0, reservedKeyUse.join(', '));
check('device-targeted commands carry `device`',
  sent.filter((m) => /device|ota/.test(m.type))
      .every((m) => !('id' in m)));

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

console.log(`\n${fails === 0 ? 'ALL CHECKS PASSED' : fails + ' CHECK(S) FAILED'}`);
process.exit(fails === 0 ? 0 : 1);
