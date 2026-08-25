/**
 * Runs the panel outside a browser: stub just enough DOM and just enough of Home
 * Assistant's custom-element registry to instantiate it, feed it the exact payloads
 * the live WebSocket API returns, render every view and assert on the produced
 * markup. Catches runtime faults a syntax check cannot.
 *
 * The panel is built from Home Assistant's OWN components, so the stub registry below
 * is a first-class part of the harness: it is what lets the tests prove both that the
 * page uses those components and that it degrades honestly when they are absent.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..');

const fx = JSON.parse(readFileSync(join(here, 'fixture.json'), 'utf8'));
// Anchor the cached-map epoch to now. The summary is what the panel probes for a
// cache; the map is handed the epoch and ages it itself.
fx.networkmap.generated = Date.now() / 1000 - 4 * 60;
fx.info.map_generated = fx.networkmap.generated;
fx.logs.entries = fx.logs.entries.map((e, i) => ({ ...e, time: Date.now() / 1000 - (10 - i) }));

/* ------------------------------------------------------------------ tiny DOM */
//
// The panel renders template strings and then hydrates: it sets JS properties and
// event handlers on the elements it just produced. So the stub indexes the markup
// into element objects, and getElementById / querySelectorAll return the SAME objects
// -- otherwise hydration would land on throwaway copies and prove nothing.

const camel = (s) => s.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
const decode = (s) =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');

class El {
  constructor(tag) {
    this.tag = tag;
    this.id = '';
    this.dataset = {};
    this.attrs = {};
    this.children = [];
    this.listeners = {};
    this.value = '';
    this.checked = false;
    this.textContent = '';
    this.hidden = false;
    this.scrollTop = 0;
    this.scrollHeight = 4000;
    this.clientHeight = 400;
    this.selectionStart = 0;
    this.clicks = 0;
    this.style = {};
    this._html = '';
  }
  set innerHTML(v) {
    this._html = String(v);
  }
  get innerHTML() {
    return this._html;
  }
  appendChild(child) {
    this.children.push(child);
    return child;
  }
  removeChild(child) {
    this.children = this.children.filter((c) => c !== child);
    return child;
  }
  addEventListener(type, fn) {
    this.listeners[type] = fn;
  }
  emit(type, detail) {
    const fn = this.listeners[type];
    if (fn) fn({ type, detail });
  }
  dispatchEvent(ev) {
    if (ev && ev.type === 'click') this.clicks += 1;
    const fn = this.listeners[ev && ev.type];
    if (fn) fn(ev);
    return true;
  }
  focus() {
    this.focused = true;
  }
  setSelectionRange(a, b) {
    this.selection = [a, b];
  }
}

const TAG = /<([a-z][a-z0-9-]*)((?:\s+[a-zA-Z0-9_:.-]+(?:="[^"]*")?)*)\s*\/?>/g;
const ATTR = /([a-zA-Z0-9_:.-]+)(?:="([^"]*)")?/g;

class Root {
  constructor() {
    this._html = '';
    this.scrollTop = 0;
    this._els = null;
    this.activeElement = null;
  }
  set innerHTML(v) {
    this._html = String(v);
    this._els = null;
  }
  get innerHTML() {
    return this._html;
  }
  _index() {
    if (this._els) return this._els;
    const out = [];
    TAG.lastIndex = 0;
    let m;
    while ((m = TAG.exec(this._html))) {
      const el = new El(m[1]);
      ATTR.lastIndex = 0;
      let a;
      while ((a = ATTR.exec(m[2]))) {
        const name = a[1];
        const value = a[2] === undefined ? '' : decode(a[2]);
        if (name === 'id') el.id = value;
        else if (name.startsWith('data-')) el.dataset[camel(name.slice(5))] = value;
        else el.attrs[name] = value;
      }
      out.push(el);
    }
    this._els = out;
    return out;
  }
  getElementById(id) {
    return this._index().find((e) => e.id === id) || null;
  }
  querySelectorAll(sel) {
    const attr = sel.replace(/^\[|\]$/g, '').split('=')[0];
    if (attr.startsWith('data-')) {
      const key = camel(attr.slice(5));
      return this._index().filter((e) => e.dataset[key] !== undefined);
    }
    return this._index().filter((e) => e.attrs[attr] !== undefined);
  }
}

globalThis.HTMLElement = class {
  constructor() {
    this.shadowRoot = null;
  }
  attachShadow() {
    this.shadowRoot = new Root();
    return this.shadowRoot;
  }
};

/* ----------------------------------------------- HA's lazily-defined components */
//
// None of these live in HA's eager app bundle, so "defined" is a runtime condition
// the panel has to cope with. The set is mutable so the degraded path is testable.

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
const defined = new Map();
HA_ELEMENTS.forEach((n) => defined.set(n, class {}));

// A faithful registry: whenDefined must settle when the element is defined LATER,
// which is exactly how the panel upgrades itself once HA's chunk lands.
const waiting = new Map();
globalThis.customElements = {
  define: (n, c) => {
    defined.set(n, c);
    const waiters = waiting.get(n);
    if (waiters) {
      waiting.delete(n);
      waiters.forEach((resolve) => resolve(c));
    }
  },
  get: (n) => defined.get(n),
  whenDefined: (n) => {
    if (defined.has(n)) return Promise.resolve(defined.get(n));
    return new Promise((resolve) => {
      if (!waiting.has(n)) waiting.set(n, []);
      waiting.get(n).push(resolve);
    });
  },
};

const created = [];
const body = new El('body');
globalThis.document = {
  body,
  createElement: (tag) => {
    const el = new El(tag);
    created.push(el);
    return el;
  },
};
globalThis.MouseEvent = class {
  constructor(type) {
    this.type = type;
  }
};
// Node ships a read-only `navigator`, so replace the binding rather than assign to it.
const navigatorStub = { userAgent: 'Mozilla/5.0 (X11; Linux) Chrome/999 Safari/537.36' };
Object.defineProperty(globalThis, 'navigator', {
  value: navigatorStub,
  configurable: true,
  writable: true,
});
globalThis.window = { location: { href: '' } }; // deliberately no loadCardHelpers
globalThis.history = { back() {} };
globalThis.confirm = () => true;
globalThis.alert = () => {};

const objectUrls = { created: 0, revoked: 0 };
globalThis.URL = {
  createObjectURL: () => {
    objectUrls.created += 1;
    return `blob:z2m-${objectUrls.created}`;
  },
  revokeObjectURL: () => {
    objectUrls.revoked += 1;
  },
};

/* ------------------------------------------------------------- load the panel */
const src = readFileSync(join(repo, 'custom_components/z2m/panel/z2m-panel.js'), 'utf8');
new Function(src)();

const Panel = defined.get('z2m-panel');
if (!Panel) throw new Error('z2m-panel was never registered');

/* --------------------------------------------------------------------- drive it */
const sent = [];
// `sent` is cleared between assertions; `allSent` keeps the whole run for the
// envelope-contract checks at the end.
const allSent = [];
const reservedKeyUse = [];
// One entry per live subscription, not per topic: more than one panel instance is
// alive during the cold-boot test, and one tearing down must not silently unsubscribe
// the other.
const subs = {};
const hasSub = (type) => (subs[type] || []).length > 0;
const push = (type, ev) => {
  const list = subs[type] || [];
  if (!list.length) throw new Error(`nothing subscribed to ${type}`);
  list.forEach((cb) => cb(ev));
};
let mapModule = 'present';

// The map module is the parent agent's file and pulls in browser APIs the harness has
// no business emulating, so the lazy import is stubbed at its seam. Both outcomes
// matter: present, and genuinely missing.
Panel.prototype._loadMapModule = function _loadMapModule() {
  if (mapModule === 'missing') {
    // A failed import leaves the element undefined, which is the condition the panel
    // checks before it dares create one.
    defined.delete('z2m-network-map');
    return Promise.reject(new Error('Failed to fetch dynamically imported module'));
  }
  defined.set('z2m-network-map', class {});
  return Promise.resolve({});
};

// Set to a command type to make it reject once, so a scoped feed failure can be
// asserted rather than assumed.
let failFeed = null;
// Group and pairing writes answer the way Zigbee2MQTT does, so the panel is tested
// against real response shapes rather than bare acks.
let groupAddId = 7;

const hass = {
  // The panel reads firmware from HA's own `update` entities and counts the label
  // rows from HA's own registry collections, so the stub carries all three just like
  // the real hass object does.
  states: fx.states,
  devices: fx.registry.devices,
  entities: fx.registry.entities,
  // Area assignment after pairing is a Home Assistant registry write, so the areas
  // collection is part of the contract.
  areas: fx.registry.areas,
  connection: {
    sendMessagePromise: (msg) => {
      // Home Assistant assigns the websocket envelope `id` itself and overwrites
      // whatever the caller put there. A command that uses `id` as a parameter
      // therefore loses it silently -- which shipped once, so it is asserted here.
      if (Object.prototype.hasOwnProperty.call(msg, 'id')) reservedKeyUse.push(msg.type);
      sent.push(msg);
      allSent.push(msg);
      if (failFeed && msg.type === failFeed) {
        return Promise.reject(new Error(`${msg.type} is unavailable`));
      }
      switch (msg.type) {
        case 'z2m/info':
          return Promise.resolve(fx.info);
        case 'z2m/devices':
          return Promise.resolve(fx.devices);
        case 'z2m/groups':
          return Promise.resolve(fx.groups);
        case 'z2m/networkmap':
          return Promise.resolve(fx.networkmap);
        case 'z2m/logs':
          return Promise.resolve(fx.logs);
        case 'z2m/coordinator_check':
          return Promise.resolve(fx.coordinator_check);
        case 'z2m/health_check':
          return Promise.resolve(fx.health_check);
        case 'z2m/backup':
          return Promise.resolve(fx.backup);
        case 'z2m/pairing':
          return Promise.resolve(fx.pairing.snapshot);
        case 'z2m/permit_join':
          return Promise.resolve({ time: msg.time });
        case 'z2m/group/add':
          return Promise.resolve({ friendly_name: msg.name, id: groupAddId });
        case 'z2m/group/rename':
          return Promise.resolve({ from: String(msg.group), to: msg.to });
        case 'z2m/group/remove':
          return Promise.resolve({ id: String(msg.group), force: !!msg.force });
        case 'z2m/group/members/add':
        case 'z2m/group/members/remove':
          return Promise.resolve({
            device: msg.device,
            group: String(msg.group),
            endpoint: msg.endpoint,
          });
        case 'config/device_registry/update':
          return Promise.resolve({ id: msg.device_id });
        default:
          return Promise.resolve(null);
      }
    },
    subscribeMessage: (cb, msg) => {
      subs[msg.type] = (subs[msg.type] || []).concat(cb);
      return Promise.resolve(() => {
        subs[msg.type] = (subs[msg.type] || []).filter((fn) => fn !== cb);
      });
    },
  },
};

const p = new Panel();
p.connectedCallback();
p.hass = hass;
await new Promise((r) => setTimeout(r, 50));

let fails = 0;
const check = (name, cond, detail = '') => {
  if (cond) console.log(`  PASS  ${name}`);
  else {
    console.log(`  FAIL  ${name} ${detail}`);
    fails++;
  }
};

const html = () => p.shadowRoot.innerHTML;
const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));

const find = (attr, value) => {
  const key = camel(attr.replace('data-', ''));
  return p.shadowRoot.querySelectorAll(`[${attr}]`).find((e) => e.dataset[key] === value);
};
const act = async (name) => {
  const el = find('data-act', name);
  if (!el) throw new Error(`no element with data-act="${name}"`);
  await el.onclick();
  await tick();
};
// Always reach a view by clicking its real dashboard row, so navigation itself stays
// under test; only 'dashboard' has no row to click.
const go = (name) => {
  if (name === 'dashboard') {
    p._go({ name: 'dashboard' });
    return;
  }
  if (!find('data-go', name)) p._go({ name: 'dashboard' });
  const el = find('data-go', name);
  if (!el) throw new Error(`no element with data-go="${name}"`);
  el.onclick();
};
// The map is opened by the "Show map" button on the My network card, not a row.
const openMap = () => {
  if (!find('data-act', 'map')) p._go({ name: 'dashboard' });
  const el = find('data-act', 'map');
  if (!el) throw new Error('no Show map button');
  el.onclick();
};
const headlines = () =>
  Array.from(html().matchAll(/<div slot="headline">([\s\S]*?)<\/div>/g)).map((m) =>
    decode(m[1]).trim()
  );

/* ============================================================ page structure */
console.log('=== built from HA components, not lookalikes ===');
check('renders', html().length > 800);
check('hosted in hass-subpage', html().includes('<hass-subpage'));
check('subpage titled Zigbee', html().includes('header="Zigbee"'));
check('top level has no back arrow (main-page)', html().includes(' main-page'));
check('uses ha-card', html().includes('<ha-card'));
check('uses ha-md-list', html().includes('<ha-md-list>'));
check('uses ha-md-list-item', html().includes('<ha-md-list-item'));
check('uses ha-svg-icon', html().includes('<ha-svg-icon'));
check('uses ha-icon-next', html().includes('<ha-icon-next'));
check('uses ha-button', html().includes('<ha-button'));
check('no hand-rolled row lookalikes', !/class="row/.test(html()));
check('no hand-rolled pill buttons', !/class="pill/.test(html()));
check('no hand-rolled app bar', !/class="bar"/.test(html()));
check('no inline <svg> icons', !html().includes('<svg'));
check('icon paths hydrated as JS properties', (() => {
  const icons = p.shadowRoot.querySelectorAll('[data-path]');
  return icons.length > 5 && icons.every((i) => typeof i.path === 'string' && i.path.startsWith('M'));
})());
check('hass handed to the subpage', p.shadowRoot.getElementById('page').hass === hass);
check('top level sets no backCallback', p.shadowRoot.getElementById('page').backCallback === undefined);
check('has mobile breakpoint', html().includes('@media (max-width:600px)'));
check('uses HA card vars', html().includes('--ha-card-header-color'));

console.log('=== status card ===');
check('mirrors ZHA network-status', html().includes('class="content network-status"'));
check('shows online state', html().includes('Online'));
check('shows device count', html().includes(`${fx.info.device_count} devices`));
check('shows offline count', html().includes(`(${fx.info.offline_count} offline)`));
check('shows Z2M version', html().includes(`Zigbee2MQTT ${fx.info.version}`));
check('shows coordinator version', html().includes(fx.info.coordinator.meta.revision));
check('shows permit-join state', html().includes('Joining closed'));
// The FAB is gone deliberately. It was an ha-button positioned like a floating
// action button, it floated over the content, and it toggled the radio directly --
// so "Add device" opened the network with nothing on screen to watch it.
check('no floating action button anywhere', !html().includes('slot="fab"')
  && !html().includes('fabwrap'));
check('Add device sits beside Show map', (() => {
  const header = /My network([\s\S]*?)<\/div>\s*<div class="card-content">/.exec(html());
  return !!header && header[1].includes('Show map') && header[1].includes('Add device');
})());
check('Add device opens the pairing helper, not the radio', !!find('data-act', 'pair'));

console.log('=== my network card delegates into HA tables ===');
const devHref = `/config/devices/dashboard?historyBack=1&label=${fx.info.label_id}`;
const entHref = `/config/entities/dashboard?historyBack=1&label=${fx.info.label_id}`;
const hrefs = p.shadowRoot
  .querySelectorAll('[href]')
  .map((e) => e.attrs.href);
check('has a My network card', html().includes('My network'));
check('has Show map button', html().includes('Show map'));
check('devices row links HA device table with label', hrefs.includes(devHref), hrefs.join(' | '));
check('entities row links HA entity table with label', hrefs.includes(entHref), hrefs.join(' | '));
check('link rows are HA link rows', html().includes('type="link"'));
const labelledDevices = Object.values(fx.registry.devices).filter((d) =>
  d.labels.includes(fx.info.label_id)).length;
const labelledEntities = Object.values(fx.registry.entities).filter((e) =>
  e.labels.includes(fx.info.label_id)).length;
check(`device count matches the labelled registry (${labelledDevices})`,
  html().includes(`${labelledDevices} devices`));
check(`entity count matches the labelled registry (${labelledEntities})`,
  html().includes(`${labelledEntities} entities`));
check('groups row present', html().includes(`${fx.info.group_count} group`));

console.log('=== every top-level row renders ===');
for (const label of ['Options', 'Diagnostics', 'Logs', 'Firmware', 'Network information',
  'Download backup']) {
  check(`row: ${label}`, headlines().some((h) => h === label || h.startsWith(label)),
    headlines().join(' | '));
}
check('backup row offers a Download action', !!find('data-act', 'backup'));
check('every navigation row targets a view',
  ['groups', 'options', 'diagnostics', 'logs', 'ota', 'network'].every((v) => !!find('data-go', v)));

console.log('=== label_id null falls back instead of linking nowhere ===');
const withLabel = p._summary;
p._summary = { ...fx.info, label_id: null };
p._render();
check('devices row falls back to the panel list', !!find('data-go', 'devices'));
check('no label=null href', !html().includes('label=null'));
check('entities row is omitted rather than broken', !html().includes('/config/entities/dashboard'));
p._summary = withLabel;
p._render();

console.log('=== pushes that change nothing must not rebuild the DOM ===');
// Availability messages across a 45-device mesh push a summary constantly. A rebuild
// per push would recreate HA's components and drop scroll position and focus.
const marked = p.shadowRoot.getElementById('page');
marked.marker = 'survivor';
push('z2m/subscribe', { summary: { ...fx.info } });
await tick();
check('identical summary leaves the shadow tree untouched',
  p.shadowRoot.getElementById('page').marker === 'survivor');
push('z2m/subscribe', { summary: { ...fx.info, offline_count: 3 } });
await tick();
check('a summary that changes something does rebuild',
  p.shadowRoot.getElementById('page').marker === undefined && html().includes('(3 offline)'));
push('z2m/subscribe', { summary: { ...fx.info } });
await tick();

console.log('=== per-element fallbacks, never a blocked page ===');
// Measured on HA 2026.8.3: a cold load straight onto /z2m already has ha-card,
// ha-md-list-item, ha-svg-icon, ha-icon-next, ha-icon-button, ha-alert and ha-button,
// and is missing only ha-md-list and hass-subpage. So the page must degrade in the
// specific spot, never as a whole.
const withoutElement = (name, fn) => {
  const stashed = defined.get(name);
  defined.delete(name);
  p._render();
  try {
    fn();
  } finally {
    customElements.define(name, stashed);
    p._render();
  }
};

withoutElement('ha-md-list', () => {
  check('ha-md-list missing: page still renders', html().length > 800);
  check('ha-md-list missing: neutral role=list container',
    html().includes('<div role="list" class="mdlist">') && !html().includes('<ha-md-list>'));
  check('ha-md-list missing: rows are still genuine ha-md-list-item',
    (html().match(/<ha-md-list-item/g) || []).length >= 8);
  check('ha-md-list missing: every top-level row survives',
    ['Options', 'Diagnostics', 'Logs', 'Firmware', 'Network information', 'Download backup']
      .every((label) => headlines().some((h) => h.startsWith(label))));
  check('ha-md-list missing: no whole-page bail-out message',
    !html().includes('not loaded in this tab'));
});
check('ha-md-list present: HA container is used again', html().includes('<ha-md-list>'));

withoutElement('hass-subpage', () => {
  check('hass-subpage missing: page still renders', html().length > 800);
  check('hass-subpage missing: falls back to plain chrome',
    html().includes('class="toolbar"') && html().includes('class="maintitle"')
      && !html().includes('<hass-subpage'));
  check('hass-subpage missing: title still shown', html().includes('>Zigbee</div>'));
  check('hass-subpage missing: refresh is still HA\u2019s ha-icon-button',
    html().includes('<ha-icon-button id="reload"'));
  check('hass-subpage missing: primary actions stay in the card, not a corner',
    html().includes('class="header-actions"') && !html().includes('class="fabwrap"'));
  check('hass-subpage missing: cards and rows unchanged',
    html().includes('<ha-card') && html().includes('<ha-md-list-item'));
  p._go({ name: 'devices' });
  check('hass-subpage missing: sub-view gets a back button', !!find('data-act', 'back'));
  check('hass-subpage missing: back button navigates', (() => {
    find('data-act', 'back').onclick();
    return p._view.name === 'dashboard';
  })());
});
check('hass-subpage present: HA chrome is used again', html().includes('<hass-subpage'));

// ha-fab and ha-textfield are the other two missing cold. The page never asks for
// either: actions are ordinary ha-buttons inside their card, and text entry is a
// native input.
check('never depends on ha-fab', !src.includes('ha-fab'));
check('never depends on ha-textfield', !src.includes('ha-textfield'));
check('text entry is a native input', html().includes('<input id="q"')
  || (() => { p._go({ name: 'devices' }); return html().includes('<input id="q"'); })());
p._go({ name: 'dashboard' });

console.log('=== first paint waits for nothing ===');
// This used to be a bounded 1.5s wait for HA's lazily loaded elements, measured at
// 2.07s to a useful dashboard on the live instance. The Z-Wave page does not do
// that, and neither does this one now: paint immediately with whatever exists.
check('a missing element does not delay first paint', await (async () => {
  const stashed = defined.get('ha-md-list');
  defined.delete('ha-md-list');
  const cold = new Panel();
  cold.connectedCallback();
  const started = Date.now();
  cold.hass = hass;
  // One microtask turn, nowhere near a component timeout.
  await new Promise((r) => setTimeout(r, 60));
  const elapsed = Date.now() - started;
  const rendered = String(cold.shadowRoot.innerHTML);
  // Late arrival must upgrade the page in place rather than needing a reload.
  customElements.define('ha-md-list', stashed);
  await new Promise((r) => setTimeout(r, 40));
  const upgraded = String(cold.shadowRoot.innerHTML).includes('<ha-md-list>');
  cold.disconnectedCallback();
  return rendered.includes('<ha-md-list-item') && rendered.includes('role="list"')
    && elapsed < 500 && upgraded;
})());

check('a card-helper promise that never settles cannot block the page', await (async () => {
  const stashed = globalThis.window.loadCardHelpers;
  // The classic hang: awaited, never resolved.
  globalThis.window.loadCardHelpers = () => new Promise(() => {});
  const cold = new Panel();
  cold.connectedCallback();
  cold.hass = hass;
  await new Promise((r) => setTimeout(r, 60));
  const rendered = String(cold.shadowRoot.innerHTML);
  cold.disconnectedCallback();
  globalThis.window.loadCardHelpers = stashed;
  return rendered.includes('<ha-card');
})());

console.log('=== one broken feed cannot blank the panel ===');
check('a failed groups read leaves the dashboard usable', await (async () => {
  const cold = new Panel();
  cold.connectedCallback();
  failFeed = 'z2m/groups';
  cold.hass = hass;
  await new Promise((r) => setTimeout(r, 80));
  failFeed = null;
  const rendered = String(cold.shadowRoot.innerHTML);
  cold.disconnectedCallback();
  return (
    // The devices and summary feeds still rendered...
    rendered.includes('Online') &&
    rendered.includes('My network') &&
    // ...and the failure is named for what it is, not "Unknown error".
    rendered.includes('Could not read Zigbee groups') &&
    !rendered.includes('Unknown error')
  );
})());

/* ================================================================== devices */
console.log('=== devices list ===');
go('devices');
check('lists every device', fx.devices.every((d) => html().includes(esc(d.friendly_name))));
check('search box present', html().includes('id="q"'));
check('rows are HA list rows', html().includes('<ha-md-list-item type="button" data-ieee'));
const offline = fx.devices.filter((d) => d.availability === 'offline');
check('flags offline devices', offline.length === 0 || html().includes('chip off'));
check('subpage titled Devices', html().includes('header="Devices"'));
check('sub-view gets a back arrow', typeof p.shadowRoot.getElementById('page').backCallback === 'function');

console.log('=== search filter ===');
p._filter = fx.devices[0].friendly_name.slice(0, 4);
p._render();
check('filter narrows list', html().includes(esc(fx.devices[0].friendly_name)));
// Typing re-renders the list. Losing the caret mid-word is the classic failure here,
// and a summary push lands mid-word constantly on a busy mesh.
const searchBox = p.shadowRoot.getElementById('q');
searchBox.value = 'hall';
searchBox.selectionStart = 4;
p.shadowRoot.activeElement = searchBox;
searchBox.oninput();
const refocused = p.shadowRoot.getElementById('q');
check('typing keeps focus in the search box', refocused.focused === true);
check('typing keeps the caret position',
  Array.isArray(refocused.selection) && refocused.selection[0] === 4);
check('typing filters the list', p._filter === 'hall'
  && html().includes(esc(fx.devices[0].friendly_name)));
p.shadowRoot.activeElement = null;
p._filter = '';

console.log('=== device detail (with options) ===');
const withOpts = fx.devices.find((d) => (d.options || []).length > 3);
p._go({ name: 'device', ieee: withOpts.ieee_address });
check(`opened ${withOpts.friendly_name}`, html().includes(esc(withOpts.friendly_name)));
check('titled after the device', html().includes(`header="${esc(withOpts.friendly_name)}"`));
check('shows IEEE', html().includes(withOpts.ieee_address));
check('shows vendor/model', html().includes(esc(withOpts.model)));
check('generated settings form', html().includes('Device settings'));
const rendered = (withOpts.options || []).filter((o) =>
  ['numeric', 'binary', 'enum', 'text'].includes(o.type));
check(`rendered ${rendered.length} option fields`,
  rendered.every((o) => html().includes(`data-prop="${o.property}"`)));
check('has rename', !!find('data-act', 'rename'));
check('has reconfigure', !!find('data-act', 'configure'));
check('has re-interview', !!find('data-act', 'interview'));
check('has firmware card', html().includes('id="fwbox"'));
check('has remove', !!find('data-act', 'remove'));
check('back from a device returns to the list', (() => {
  p.shadowRoot.getElementById('page').backCallback();
  const ok = p._view.name === 'devices';
  p._go({ name: 'device', ieee: withOpts.ieee_address });
  return ok;
})());

console.log('=== device commands ===');
sent.length = 0;
p.shadowRoot.getElementById('rn').value = 'Hallway Dimmer 2';
await act('rename');
check('Rename -> z2m/device/rename', sent.some((m) => m.type === 'z2m/device/rename'
  && m.from === withOpts.friendly_name && m.to === 'Hallway Dimmer 2'));
sent.length = 0;
await act('configure');
check('Reconfigure -> z2m/device/configure', sent.some((m) => m.type === 'z2m/device/configure'
  && m.device === withOpts.ieee_address));
sent.length = 0;
await act('interview');
check('Interview -> z2m/device/interview', sent.some((m) => m.type === 'z2m/device/interview'
  && m.device === withOpts.ieee_address));
sent.length = 0;
await act('remove');
check('Remove -> z2m/device/remove with force', sent.some((m) => m.type === 'z2m/device/remove'
  && m.device === withOpts.ieee_address && m.force === true));
sent.length = 0;
p.shadowRoot.querySelectorAll('[data-prop]').forEach((el) => {
  if (el.dataset.kind === 'binary') el.checked = true;
});
await act('options');
check('Save settings -> z2m/device/options', sent.some((m) => m.type === 'z2m/device/options'
  && m.device === withOpts.ieee_address && typeof m.options === 'object'
  && Object.keys(m.options).length > 0));

console.log('=== every device detail renders ===');
let bad = [];
for (const d of fx.devices) {
  try {
    p._go({ name: 'device', ieee: d.ieee_address });
    if (html().length < 500) bad.push(d.friendly_name);
  } catch (e) {
    bad.push(`${d.friendly_name}: ${e.message}`);
  }
}
check(`all ${fx.devices.length} device pages render`, bad.length === 0, bad.slice(0, 3).join('; '));

/* ======================================================== network + groups */
console.log('=== network + groups ===');
p._go({ name: 'network' });
check('shows channel', html().includes(String(fx.info.network.channel)));
check('shows PAN ID', html().includes(String(fx.info.network.pan_id)));
check('shows base topic', html().includes(fx.info.base_topic));
check('withholds network key', !html().toLowerCase().includes('network_key'));
p._go({ name: 'groups' });
check('lists groups', fx.groups.every((g) => html().includes(esc(g.friendly_name))));
check('groups use HA rows', html().includes('<ha-md-list-item'));

/* ================================================================ firmware */
console.log('=== firmware: device card ===');
// Mains device with an update available -> Install offered, not Schedule.
p._go({ name: 'device', ieee: '0x0000000000000001' });
check('firmware card rendered', html().includes('Firmware'));
check('shows installed version', html().includes('2.15'));
check('shows latest version', html().includes('2.18'));
check('flags update available', html().includes('Update available'));
check('offers Install for mains device', !!find('data-act', 'fwinstall'));
check('no Schedule for mains device', !find('data-act', 'fwsched'));
check('offers Check', !!find('data-act', 'fwcheck'));

// Battery device -> Schedule instead of Install, because it is asleep.
p._go({ name: 'device', ieee: '0x0000000000000002' });
check('battery device offers Schedule', !!find('data-act', 'fwsched'));
check('battery device offers Cancel schedule', !!find('data-act', 'fwunsched'));
check('battery device hides Install', !find('data-act', 'fwinstall'));
check('explains the wake-up behaviour', html().includes('next wakes'));

// Z2M publishes -1/-1 when it has never consulted the OTA index.
p._go({ name: 'device', ieee: '0x0000000000000004' });
check('-1 renders as Not assessed', html().includes('Not assessed'));
check('-1 is not shown as a version', !html().includes('>-1<'));

// Device with no OTA support at all.
p._go({ name: 'device', ieee: '0x0000000000000003' });
check('no-OTA device explains itself', html().includes('no OTA support'));
check('no-OTA device offers no buttons', !find('data-act', 'fwcheck'));

console.log('=== firmware: fleet view ===');
go('ota');
const otaDevs = fx.devices.filter((d) => d.update_entity);
check(`lists all ${otaDevs.length} OTA-capable devices`,
  otaDevs.every((d) => html().includes(esc(d.friendly_name))));
check('excludes non-OTA device', !html().includes('Unknown Gadget'));
check('has Check all', !!find('data-act', 'checkall'));
check('warns that check-all is staggered', html().includes('seconds apart'));
check('fleet rows are HA rows', html().includes('<ha-md-list-item'));

console.log('=== firmware: commands ===');
p._go({ name: 'device', ieee: '0x0000000000000001' });
sent.length = 0;
await act('fwcheck');
check('Check -> z2m/ota/check', sent.some((m) => m.type === 'z2m/ota/check'
  && m.device === '0x0000000000000001'));
sent.length = 0;
await act('fwinstall');
check('Install -> z2m/ota/update', sent.some((m) => m.type === 'z2m/ota/update'
  && m.device === '0x0000000000000001'));
p._go({ name: 'device', ieee: '0x0000000000000002' });
sent.length = 0;
await act('fwsched');
check('Schedule -> z2m/ota/schedule', sent.some((m) => m.type === 'z2m/ota/schedule'));
sent.length = 0;
await act('fwunsched');
check('Cancel schedule -> z2m/ota/unschedule', sent.some((m) => m.type === 'z2m/ota/unschedule'));

console.log('=== firmware: live progress patch ===');
p._go({ name: 'device', ieee: '0x0000000000000001' });
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
hass.states['update.hallway_dimmer'] = fx.states['update.hallway_dimmer'];
p.hass = hass;

/* ================================================================= options */
console.log('=== options view ===');
go('options');
check('titled Options', html().includes('header="Options"'));
check('has a log level control', html().includes('id="loglevel"'));
check('preselects the current level', html().includes(`value="${fx.info.log_level}" selected`));
check('offers permit joining', html().includes('Permit joining'));
check('offers restart', !!find('data-act', 'restart'));
check('links the integration entry',
  p.shadowRoot.querySelectorAll('[href]').some((e) =>
    e.attrs.href === '/config/integrations/integration/z2m'));
sent.length = 0;
const level = p.shadowRoot.getElementById('loglevel');
level.value = 'debug';
level.onchange();
await tick();
check('level change -> z2m/log_level', sent.some((m) => m.type === 'z2m/log_level' && m.value === 'debug'));
sent.length = 0;
await act('restart');
check('Restart -> z2m/restart', sent.some((m) => m.type === 'z2m/restart'));

/* ============================================================= diagnostics */
console.log('=== diagnostics view ===');
sent.length = 0;
go('diagnostics');
await tick(40);
check('coordinator check runs on open', sent.some((m) => m.type === 'z2m/coordinator_check'));
check('lists routers missing from the coordinator',
  html().includes(fx.coordinator_check.missing_routers[0].name));
check('missing router rows open the device', !!find('data-ieee',
  fx.coordinator_check.missing_routers[0].ieee));
sent.length = 0;
await act('health');
await tick(40);
check('Run -> z2m/health_check', sent.some((m) => m.type === 'z2m/health_check'));
check('renders the health payload', html().includes('healthy'));
check('flattens nested health counters', html().includes('mqtt') && html().includes('12345'));
check('re-check re-runs the coordinator check', await (async () => {
  sent.length = 0;
  await act('coordcheck');
  await tick(40);
  return sent.some((m) => m.type === 'z2m/coordinator_check');
})());

/* ==================================================================== logs */
console.log('=== logs view ===');
sent.length = 0;
go('logs');
await tick(40);
check('reads the ring buffer', sent.some((m) => m.type === 'z2m/logs'));
check('subscribes to the live log', hasSub('z2m/logs/subscribe'));
const loglist = () => String(p.shadowRoot.getElementById('loglist').innerHTML);
check('renders every replayed entry',
  fx.logs.entries.every((e) => loglist().includes(e.message)));
check('newest entry is last', (() => {
  const first = loglist().indexOf(fx.logs.entries[0].message);
  const last = loglist().indexOf(fx.logs.entries[fx.logs.entries.length - 1].message);
  return first > -1 && last > first;
})());
check('levels are marked up', loglist().includes('class="log error"'));
push('z2m/logs/subscribe', { time: Date.now() / 1000, level: 'error', message: 'live line arrived' });
await tick(160);
check('live push is appended', loglist().includes('live line arrived'));
check('auto-scrolls while pinned', p.shadowRoot.getElementById('logscroll').scrollTop > 0);
const logmin = p.shadowRoot.getElementById('logmin');
logmin.value = 'warning';
logmin.onchange();
check('level filter drops lower levels', !loglist().includes('Received Zigbee message'));
check('level filter keeps higher levels', loglist().includes('Publish to zigbee2mqtt/x failed'));
logmin.value = 'all';
logmin.onchange();
const scroll = p.shadowRoot.getElementById('logscroll');
scroll.scrollTop = 0;
scroll.onscroll();
check('scrolling up pauses the follow', p._logPinned === false);
push('z2m/logs/subscribe', { time: Date.now() / 1000, level: 'info', message: 'while paused' });
await tick(160);
check('paused view does not jump', scroll.scrollTop === 0);
await act('logbottom');
check('Latest re-pins the follow', p._logPinned === true);
check('log ring buffer is capped', (() => {
  for (let i = 0; i < 400; i += 1) {
    push('z2m/logs/subscribe', { time: Date.now() / 1000, level: 'info', message: `flood ${i}` });
  }
  return p._logs.length === 300;
})());

/* ===================================================================== map */
console.log('=== map: a cached scan is drawn, never re-probed ===');
sent.length = 0;
openMap();
await tick(60);
const mapCalls = sent.filter((m) => m.type === 'z2m/networkmap');
check('reads the cache', mapCalls.length === 1);
check('NEVER auto-scans on open', mapCalls.every((m) => !m.force));
check('a cached map starts NO streaming scan', !hasSub('z2m/networkmap/scan'));
check('subscribes to the scan lifecycle', hasSub('z2m/networkmap/subscribe'));
const stage = p.shadowRoot.getElementById('mapstage');
check('hosts the map element', stage.children.length === 1
  && stage.children[0].tag === 'z2m-network-map');
const mapEl = stage.children[0];
check('map gets hass', mapEl.hass === hass);
check('map gets diagnostics', mapEl.diagnostics === true);
check('map gets reveal on first open', mapEl.reveal === true);
check('map gets the normalized topology', mapEl.topology === fx.networkmap);
check('map gets the cache epoch, not prose', mapEl.scan.generated === fx.networkmap.generated);
check('map is told nothing is scanning',
  mapEl.scan.scanning === false && mapEl.scan.total === 0 && mapEl.scan.done === 0);

console.log('=== map: the graph gets the whole canvas ===');
// The element draws its own age, progress, Re-scan control, legend and node detail
// inside its canvas, so anything the shell puts above or below it is wasted height.
check('nothing sits between the page body and the map',
  /<div class="container mapview">\s*<div class="stage" id="mapstage"><\/div>\s*<\/div>/
    .test(html()), html());
check('no status strip above the map',
  !html().includes('mapbar') && !html().includes('id="mapage"'));
check('no Re-scan button in the shell', !find('data-act', 'rescan'));
check('the shell draws no node card of its own', !html().includes('id="mapsel"'));
check('the map wrapper adds no padding', html().includes('.container.mapview { padding:0; }'));
check('hass-subpage path: map fills the area below the header',
  html().includes('.stage { height:calc(100vh - var(--header-height,56px)); min-height:360px; }'));
check('no mobile override shrinks the map', !/\.stage \{ height:calc\(100vh - \d/.test(html()));
withoutElement('hass-subpage', () => {
  check('fallback chrome: same height rule',
    html().includes('.stage { height:calc(100vh - var(--header-height,56px)); min-height:360px; }'));
  check('fallback chrome: the sticky toolbar is exactly that band',
    html().includes('height:var(--header-height, 56px)'));
  check('fallback chrome: still nothing between body and map',
    /<div class="container mapview">\s*<div class="stage" id="mapstage"><\/div>\s*<\/div>/
      .test(html()));
});
check('no waiting copy anywhere in the shell',
  !/takes? a (while|minute|moment)|please wait|this (will|may) take/i.test(src));

console.log('=== map: no cache streams a live scan instead of waiting ===');
p._go({ name: 'dashboard' });
await tick();
p._resetMap();
p._summary = { ...fx.info, map_generated: null };
sent.length = 0;
openMap();
await tick(60);
check('no cache: never calls the blocking map command',
  !sent.some((m) => m.type === 'z2m/networkmap'));
check('no cache: starts a streaming scan', hasSub('z2m/networkmap/scan'));
const liveEl = p.shadowRoot.getElementById('mapstage').children[0];
check('the map is mounted before any radio traffic',
  !!liveEl && liveEl.tag === 'z2m-network-map' && liveEl.topology === undefined);
check('the map is told a scan is running', liveEl.scan.scanning === true);
// The element owns the animation; the shell only forwards the events.
const applied = [];
liveEl.applyScanEvent = (ev) => applied.push(ev);
const startEv = { phase: 'start', total: 2, coordinator: fx.networkmap.coordinator,
  nodes: fx.networkmap.nodes, streaming: true };
push('z2m/networkmap/scan', startEv);
check('start reaches applyScanEvent with every device, verbatim',
  applied.length === 1 && applied[0] === startEv
    && applied[0].nodes.length === fx.networkmap.nodes.length);
check('progress total comes from the start event',
  liveEl.scan.total === 2 && liveEl.scan.done === 0 && liveEl.scan.scanning === true);
push('z2m/networkmap/scan', { phase: 'device', ieee: fx.networkmap.nodes[1].ieee,
  name: fx.networkmap.nodes[1].name, ok: true, links: [fx.networkmap.links[0]] });
check('a probed device reaches applyScanEvent with its links',
  applied.length === 2 && applied[1].phase === 'device' && applied[1].links.length === 1);
check('progress counts it', liveEl.scan.done === 1 && liveEl.scan.total === 2);
push('z2m/networkmap/scan', { phase: 'device', ieee: '0x00158d0000000009',
  name: 'Shed relay', ok: false, error: 'no response' });
check('a device that failed counts too and is not a page-level alert',
  applied.length === 3 && liveEl.scan.done === 2 && !html().includes('alert-type="error"'));
const doneAt = Math.round(Date.now() / 1000);
push('z2m/networkmap/scan', { phase: 'done', generated: doneAt,
  coordinator: fx.networkmap.coordinator, nodes: fx.networkmap.nodes,
  links: fx.networkmap.links });
await tick();
check('done reaches applyScanEvent', applied.length === 4 && applied[3].phase === 'done');
check('the streamed graph is NOT re-assigned as .topology', liveEl.topology === undefined);
check('the scan ends and the age becomes the fresh scan',
  liveEl.scan.scanning === false && liveEl.scan.generated === doneAt
    && liveEl.scan.done === 2 && liveEl.scan.total === 2);
check('the finished stream is closed', !hasSub('z2m/networkmap/scan'));
check('the shell caches the completed topology',
  p._map.topology.links === fx.networkmap.links && p._map.topology.generated === doneAt);

console.log('=== map: an element that cannot take the stream still gets the graph ===');
p._go({ name: 'dashboard' });
await tick();
p._resetMap();
openMap();
await tick(60);
const dumbEl = p.shadowRoot.getElementById('mapstage').children[0];
push('z2m/networkmap/scan', { phase: 'done', generated: doneAt,
  coordinator: fx.networkmap.coordinator, nodes: fx.networkmap.nodes,
  links: fx.networkmap.links });
await tick();
check('done assigns .topology when applyScanEvent is absent',
  !!dumbEl.topology && dumbEl.topology.links === fx.networkmap.links);

console.log('=== map: the map\u2019s own Re-scan control ===');
p._go({ name: 'dashboard' });
await tick();
p._resetMap();
p._summary = fx.info;
sent.length = 0;
openMap();
await tick(60);
check('a cached open still does not scan', !hasSub('z2m/networkmap/scan'));
p.shadowRoot.getElementById('mapstage').emit('z2m-rescan');
await tick();
check('z2m-rescan starts a fresh streaming scan', hasSub('z2m/networkmap/scan'));
check('re-scan tells the map it is scanning', p._map.el.scan.scanning === true);
check('re-scan sends no blocking map command', !sent.some((m) => m.type === 'z2m/networkmap'
  && m.force === true));

console.log('=== map: a lifecycle push is ignored while our own stream runs ===');
sent.length = 0;
push('z2m/networkmap/subscribe', { phase: 'done', generated: doneAt, error: null });
await tick(40);
check('our own stream owns the graph', !sent.some((m) => m.type === 'z2m/networkmap'));

console.log('=== map: a failed scan is an alert, not a blank page ===');
const survivor = p._map.el;
push('z2m/networkmap/scan', { phase: 'error', error: 'Coordinator did not answer' });
await tick();
check('scan error renders an ha-alert', html().includes('alert-type="error"')
  && html().includes('Coordinator did not answer'));
check('the map is still on screen', (() => {
  const s = p.shadowRoot.getElementById('mapstage');
  return !!s && s.children.length === 1 && s.children[0] === survivor;
})());
check('the failed stream is closed', !hasSub('z2m/networkmap/scan'));
check('map is told the scan stopped', survivor.scan.scanning === false);

console.log('=== map: a scan run somewhere else still lands ===');
push('z2m/networkmap/subscribe', { phase: 'scanning', generated: null, error: null });
check('another session scanning is surfaced', survivor.scan.scanning === true);
sent.length = 0;
push('z2m/networkmap/subscribe', { phase: 'done', generated: fx.networkmap.generated, error: null });
await tick(40);
check('a scan finished elsewhere refreshes the topology',
  sent.some((m) => m.type === 'z2m/networkmap') && survivor.topology === fx.networkmap);
check('and stops claiming to scan', survivor.scan.scanning === false);

console.log('=== map: summary pushes must not disturb the graph ===');
const beforePush = html();
survivor.topology = 'SENTINEL';
push('z2m/subscribe', { summary: { ...fx.info, device_count: 99 } });
// Read it back synchronously: the handler is synchronous, and a stray _act refresh
// from an earlier section is entitled to land in any later tick.
check('summary push still reaches the panel', p._summary.device_count === 99);
await tick();
check('summary push does not re-render the map view', html() === beforePush);
check('summary push does not reset topology', survivor.topology === 'SENTINEL');
p._summary = fx.info;

console.log('=== map: element survives leaving and re-entering ===');
go('dashboard');
await tick();
openMap();
await tick(60);
const stage2 = p.shadowRoot.getElementById('mapstage');
check('same map instance is re-hosted',
  stage2.children.length === 1 && stage2.children[0] === survivor);
check('reveal only animates the first open', p._map.first === false);

console.log('=== map: module missing degrades instead of throwing ===');
p._go({ name: 'dashboard' });
mapModule = 'missing';
p._resetMap();
let threw = null;
try {
  openMap();
  await tick(60);
} catch (e) {
  threw = e;
}
check('lazy import failure does not throw', threw === null, threw && threw.message);
check('failure is reported in an ha-alert', html().includes('alert-type="error"')
  && html().includes('could not be loaded'));
check('no element is created while its class is undefined',
  p.shadowRoot.getElementById('mapstage').children.length === 0 && p._map.el === null);
mapModule = 'present';

/* ================================================================== backup */
console.log('=== backup downloads a real archive ===');
go('dashboard');
sent.length = 0;
created.length = 0;
await act('backup');
await tick(40);
check('asks for the backup', sent.some((m) => m.type === 'z2m/backup'));
const anchor = created.find((e) => e.tag === 'a');
check('creates a download', !!anchor && anchor.clicks === 1);
check('names it zigbee2mqtt-backup-<date>.zip',
  !!anchor && /^zigbee2mqtt-backup-\d{4}-\d{2}-\d{2}\.zip$/.test(anchor.download),
  anchor && anchor.download);
check('revokes the object URL', objectUrls.created === 1 && objectUrls.revoked === 1);
check('anchor is attached to the document and cleaned up',
  body.children.length === 0 && anchor.style.display === 'none' && anchor.target === '_blank');
check('defers the revoke on Safari, which aborts on an early revoke', await (async () => {
  const ua = navigatorStub.userAgent;
  navigatorStub.userAgent = 'Mozilla/5.0 (iPad; CPU OS 17_0) Version/17.0 Safari/605.1.15';
  const before = objectUrls.revoked;
  await find('data-act', 'backup').onclick();
  const deferred = objectUrls.revoked === before;
  navigatorStub.userAgent = ua;
  return deferred;
})());
check('surfaces a missing archive as an error', await (async () => {
  const original = hass.connection.sendMessagePromise;
  hass.connection.sendMessagePromise = (msg) =>
    msg.type === 'z2m/backup' ? Promise.resolve({}) : original(msg);
  // Read the render the failure itself produced. Waiting would race the deliberate
  // 1.2s post-command refresh, which clears the error banner on purpose.
  await find('data-act', 'backup').onclick();
  const shown = html();
  hass.connection.sendMessagePromise = original;
  return shown.includes('no backup archive');
})());
p._error = null;

/* ================================================================= pairing */
console.log('=== pairing helper: watch first, then open the radio ===');
go('dashboard');
sent.length = 0;
await act('pair');
await tick(60);
check('Add device opens the helper', p._view.name === 'pairing');
// Ordering is the whole point: bridge/event is not retained, so a subscription
// established after the permit request can miss the join it was opened for.
const pairOrder = sent.map((m) => m.type);
check('subscribes to the pairing stream', hasSub('z2m/pairing/subscribe'));
check('subscribes to the live log for diagnostics', hasSub('z2m/logs/subscribe'));
check('opens joining for a bounded window',
  sent.some((m) => m.type === 'z2m/permit_join' && m.time === 254));
check('the radio is opened only AFTER the stream is being watched',
  pairOrder.indexOf('z2m/permit_join') === pairOrder.length - 1, pairOrder.join(' -> '));
check('the helper knows it owns this window', p._pairing.ownsPermit === true);

p._summary = { ...fx.info, permit_join: true, permit_join_end: Date.now() + 90000 };
p._render();
check('shows a live countdown', /\d+s left/.test(html()));
check('tells the operator what to do', html().includes('pairing mode'));

console.log('=== pairing helper: somebody else\u2019s device is not ours ===');
push('z2m/pairing/subscribe', { kind: 'event', event: fx.pairing.joined });
check('the first join is adopted', p._pairing.target === fx.pairing.joined.ieee_address);
push('z2m/pairing/subscribe', { kind: 'event', event: fx.pairing.other });
check('a second pairer\u2019s device is ignored',
  p._pairing.target === fx.pairing.joined.ieee_address);

console.log('=== pairing helper: interview progress is the source of truth ===');
push('z2m/pairing/subscribe', { kind: 'event', event: fx.pairing.started });
check('interview progress is shown', html().includes('Interviewing'));
const logRows = () => String(p.shadowRoot.getElementById('pairlog').innerHTML);
push('z2m/logs/subscribe', { time: Date.now() / 1000, level: 'info', message: 'Starting interview' });
await tick();
check('live log lines are shown', logRows().includes('Starting interview'));
check('a log line is never treated as completion', p._pairing.phase === 'interview_started');

sent.length = 0;
push('z2m/pairing/subscribe', { kind: 'event', event: fx.pairing.successful });
await tick();
check('success is reported', html().includes('Paired'));
check('the device is named exactly', html().includes(fx.pairing.successful.ieee_address)
  && html().includes('WSDCGQ11LM'));
// An open network is an open network: close it as soon as the device is in.
check('the helper closes the window it opened',
  sent.some((m) => m.type === 'z2m/permit_join' && m.time === 0));
check('and stops claiming ownership', p._pairing.ownsPermit === false);

console.log('=== pairing helper: name and area, through HA\u2019s own registry ===');
// The retained inventory catching up is what supplies the HA device id.
p._devices = fx.devices.concat([fx.paired_device]);
p._render();
check('offers a name field', html().includes('id="pairname"'));
check('offers every HA area', Object.values(fx.registry.areas)
  .every((a) => html().includes(a.name)));
check('offers to open the HA device page', !!find('data-act', 'pairopen'));
sent.length = 0;
p.shadowRoot.getElementById('pairname').value = 'Nursery Climate';
p.shadowRoot.getElementById('pairarea').value = 'hallway';
await act('pairsave');
await tick(80);
check('renames in Zigbee2MQTT by ieee, not by name', sent.some((m) =>
  m.type === 'z2m/device/rename' && m.from === fx.pairing.successful.ieee_address
  && m.to === 'Nursery Climate'));
check('sets the HA display name and area through HA\u2019s own command', sent.some((m) =>
  m.type === 'config/device_registry/update' && m.device_id === 'dev_paired'
  && m.name_by_user === 'Nursery Climate' && m.area_id === 'hallway'));
check('never rewrites entity ids', !sent.some((m) => 'new_entity_id' in m));

console.log('=== pairing helper: unsupported and failed are different states ===');
p._resetPairing();
p._pairing.active = true;
p._adoptPairSession(fx.pairing.unsupported);
check('unsupported is a success with a caveat', html().includes('no converter'));
p._resetPairing();
p._pairing.active = true;
p._adoptPairSession(fx.pairing.failed);
check('a failed interview says so locally', html().includes('interview failed'));
check('a failed interview is not a page-level unknown error',
  !html().includes('Unknown error'));

console.log('=== pairing helper: leaving cleans up ===');
p._devices = fx.devices;
p._pairing.ownsPermit = true;
sent.length = 0;
go('dashboard');
await tick();
check('closes its own window on the way out',
  sent.some((m) => m.type === 'z2m/permit_join' && m.time === 0));
check('unsubscribes the pairing stream', !hasSub('z2m/pairing/subscribe'));
check('unsubscribes the pairing log', !hasSub('z2m/logs/subscribe'));
p._summary = fx.info;
p._render();

/* ================================================================== groups */
console.log('=== groups: create ===');
go('groups');
check('Create stays reachable', !!find('data-act', 'groupadd'));
check('lists existing groups', html().includes(esc(fx.groups[0].friendly_name)));
check('group rows open the group', !!find('data-group', String(fx.groups[0].id)));
sent.length = 0;
p.shadowRoot.getElementById('gname').value = 'Kitchen downlights';
await act('groupadd');
await tick(40);
check('Create -> z2m/group/add with a name', sent.some((m) =>
  m.type === 'z2m/group/add' && m.name === 'Kitchen downlights'));
check('navigates to the group it just made', p._view.name === 'group'
  && String(p._view.group) === '7');

console.log('=== groups: detail, rename, members ===');
p._go({ name: 'group', group: fx.groups[0].id });
check('shows the group id', html().includes(`${fx.groups[0].id}`));
check('lists members by name, not just address',
  html().includes(esc(fx.devices[0].friendly_name)));
check('names the endpoint, because membership is per endpoint',
  html().includes('Endpoint 1'));
sent.length = 0;
p.shadowRoot.getElementById('grn').value = 'Lounge lights';
await act('grouprename');
await tick(40);
check('Rename -> z2m/group/rename', sent.some((m) =>
  m.type === 'z2m/group/rename' && String(m.group) === String(fx.groups[0].id)
  && m.to === 'Lounge lights'));

// Endpoint 1 of device one is already a member, so it must not be offered again.
// Read the rendered markup: the stub indexes elements, it does not reflow their
// children into innerHTML, so the select's own innerHTML proves nothing here.
const offered = Array.from(
  /<select id="gmember">([\s\S]*?)<\/select>/.exec(html())[1].matchAll(/value="([^"]*)"/g)
).map((m) => m[1]);
check('an endpoint already in the group is not offered again',
  !offered.includes('0x0000000000000001|1'), offered.join(', '));
check('the device\u2019s other endpoint IS offered',
  offered.includes('0x0000000000000001|2'), offered.join(', '));
sent.length = 0;
p.shadowRoot.getElementById('gmember').value = '0x0000000000000002|1';
await act('memberadd');
await tick(40);
check('Add member -> z2m/group/members/add with an explicit endpoint', sent.some((m) =>
  m.type === 'z2m/group/members/add' && m.device === '0x0000000000000002'
  && m.endpoint === 1 && String(m.group) === String(fx.groups[0].id)));
sent.length = 0;
await act('memberremove');
await tick(40);
check('Remove member -> z2m/group/members/remove', sent.some((m) =>
  m.type === 'z2m/group/members/remove' && m.device === '0x0000000000000001'
  && m.endpoint === 1));

console.log('=== groups: the retained list is authoritative ===');
const grown = [{ ...fx.groups[0], members: fx.groups[0].members.concat(
  [{ ieee_address: '0x0000000000000002', endpoint: 1 }]) }];
push('z2m/groups/subscribe', { groups: grown });
await tick();
check('membership comes from the retained push, not the response',
  html().includes(esc(fx.devices[1].friendly_name)));

console.log('=== groups: a refusal is local and readable ===');
p._groupError = null;
sent.length = 0;
failFeed = 'z2m/group/rename';
p.shadowRoot.getElementById('grn').value = 'Duplicate name';
await act('grouprename');
await tick(40);
failFeed = null;
check('the refusal is shown', html().includes('is unavailable'));
check('the group page still works', html().includes('Members'));
check('the refusal never reaches the dashboard', (() => {
  p._groupError = null;
  go('dashboard');
  return !html().includes('is unavailable');
})());

console.log('=== groups: delete is careful, force is explicit ===');
p._go({ name: 'group', group: fx.groups[0].id });
check('offers a normal delete', !!find('data-act', 'groupremove'));
check('offers force delete separately', !!find('data-act', 'groupforce'));
check('force delete explains what it leaves behind',
  html().includes('stay programmed'));
sent.length = 0;
await act('groupremove');
await tick(40);
check('Delete -> z2m/group/remove without force', sent.some((m) =>
  m.type === 'z2m/group/remove' && m.force === false));
sent.length = 0;
p._go({ name: 'group', group: fx.groups[0].id });
await act('groupforce');
await tick(40);
check('Force -> z2m/group/remove with force', sent.some((m) =>
  m.type === 'z2m/group/remove' && m.force === true));
go('dashboard');

console.log('=== restart_required is surfaced ===');
p._summary = { ...fx.info, restart_required: true };
p._render();
check('warns with an ha-alert', html().includes('alert-type="warning"')
  && html().includes('Restart required'));
check('the alert carries a Restart action', html().includes('slot="action"'));
p._summary = fx.info;
p._render();

console.log('=== toolbar refresh ===');
sent.length = 0;
await act('refresh');
check('Refresh re-reads info/devices/groups',
  ['z2m/info', 'z2m/devices', 'z2m/groups'].every((t) => sent.some((m) => m.type === t)));

/* ================================================= websocket envelope contract */
console.log('=== websocket envelope contract ===');
check(`no command uses the reserved 'id' key (${reservedKeyUse.length} offenders)`,
  reservedKeyUse.length === 0, reservedKeyUse.join(', '));
check('device-targeted commands carry `device`',
  sent.filter((m) => /device|ota/.test(m.type)).every((m) => !('id' in m)));
const targeted = ['z2m/device/configure', 'z2m/device/interview', 'z2m/device/remove',
  'z2m/device/options', 'z2m/ota/check', 'z2m/ota/update', 'z2m/ota/schedule',
  'z2m/ota/unschedule'];
check('every device-targeted command sent this run named its device', (() => {
  const seen = [];
  for (const t of targeted) {
    if (!allSent.some((m) => m.type === t)) continue;
    if (!allSent.filter((m) => m.type === t).every((m) => typeof m.device === 'string')) seen.push(t);
  }
  return seen.length === 0;
})());
check('the panel points its map import at the sibling module',
  src.includes("import('./z2m-map.js')"));
// Observed in the live log: a second evaluation of this module threw
// "the name z2m-panel has already been used with this registry", which left the
// operator looking at a dead page.
check('registering the element twice is not fatal', (() => {
  try {
    new Function(src)();
    return true;
  } catch (_) {
    return false;
  }
})());

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

console.log(`\n${fails === 0 ? 'ALL CHECKS PASSED' : fails + ' CHECK(S) FAILED'}`);
process.exit(fails === 0 ? 0 : 1);
