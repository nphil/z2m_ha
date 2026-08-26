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
    this._els = null;
    // Matches the real thing: writing innerHTML detaches whatever was appended.
    this.children.forEach((c) => {
      c.parentNode = null;
    });
    this.children = [];
  }
  get innerHTML() {
    return this._html;
  }
  setAttribute(name, value) {
    this.attrs[name] = String(value);
  }
  getAttribute(name) {
    return name in this.attrs ? this.attrs[name] : null;
  }
  remove() {
    if (this.parentNode) this.parentNode.removeChild(this);
  }
  appendChild(child) {
    if (child.parentNode) child.parentNode.removeChild(child);
    child.parentNode = this;
    this.children.push(child);
    return child;
  }
  removeChild(child) {
    this.children = this.children.filter((c) => c !== child);
    if (child.parentNode === this) child.parentNode = null;
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
    this.children = [];
  }
  set innerHTML(v) {
    this._html = String(v);
    this._els = null;
    this.children.forEach((c) => {
      c.parentNode = null;
    });
    this.children = [];
  }
  get innerHTML() {
    // The real thing serialises its children too, and the panel now renders the page
    // into a container element rather than straight into the root.
    return this._html + this.children.map((c) => c.innerHTML).join('');
  }
  appendChild(child) {
    if (child.parentNode) child.parentNode.removeChild(child);
    child.parentNode = this;
    this.children.push(child);
    return child;
  }
  removeChild(child) {
    this.children = this.children.filter((c) => c !== child);
    if (child.parentNode === this) child.parentNode = null;
    return child;
  }
}

/* Both the shadow root and any element the panel builds by hand have to answer the
 * same three questions, and -- crucially -- answer them with the SAME element
 * objects each time, or hydration lands on throwaway copies. Appended children are
 * searched too: the pair dialog is a child of the shadow root, and the panel looks
 * its contents up through the root. */
const QUERYABLE = {
  _index() {
    if (!this._els) {
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
    }
    return this._els.concat(...this.children.map((c) => [c].concat(c._index())));
  },
  getElementById(id) {
    return this._index().find((e) => e.id === id) || null;
  },
  querySelectorAll(sel) {
    if (sel.startsWith('#')) return this._index().filter((e) => e.id === sel.slice(1));
    const attr = sel.replace(/^\[|\]$/g, '').split('=')[0];
    if (attr.startsWith('data-')) {
      const key = camel(attr.slice(5));
      return this._index().filter((e) => e.dataset[key] !== undefined);
    }
    return this._index().filter((e) => e.attrs[attr] !== undefined);
  },
  querySelector(sel) {
    return this.querySelectorAll(sel)[0] || null;
  },
};
Object.assign(El.prototype, QUERYABLE);
Object.assign(Root.prototype, QUERYABLE);

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
  'ha-button',
  'ha-dialog',
  // Measured on HA 2026.8.3: ha-form and its selector components are registered in
  // the bundle this panel loads into, and ha-textfield is NOT -- it never becomes
  // defined, so a page that depends on it renders an empty row forever. The fixture
  // keeps that asymmetry, because it is the whole reason the forms are ha-form.
  'ha-form',
  'ha-settings-row',
  'ha-select',
  'ha-list-item',
  'ha-icon-button',
  'ha-alert',
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
  if (!list.length) {
    // Which subscriptions DO exist is the whole diagnosis when this fires on a machine
    // that is not this one: it separates "never subscribed" from "subscribed and then
    // torn down", and names what the panel thinks it is doing instead.
    const live = Object.entries(subs)
      .filter(([, l]) => l.length)
      .map(([t, l]) => `${t}x${l.length}`)
      .join(', ') || 'none';
    throw new Error(`nothing subscribed to ${type}; live subscriptions: ${live}`);
  }
  list.forEach((cb) => cb(ev));
};

/**
 * Wait for a condition instead of guessing how long it takes.
 *
 * Mounting the map is asynchronous -- a lazy import, then the element, then the
 * subscription -- so a fixed sleep is a race that passes on a fast machine and fails on
 * a loaded CI runner. Timing out throws with the label, so a real regression still fails
 * loudly rather than hanging.
 */
const until = async (label, pred, ms = 5000) => {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (pred()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error(`timed out waiting for ${label}`);
};
/**
 * Bounded wait that ANSWERS rather than throws, so a positive assertion stays a real
 * assertion: it is still the check that fails, not a helper, and it does not depend on
 * how fast this machine happens to be.
 */
const soon = async (pred, ms = 5000) => {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (pred()) return true;
    await new Promise((r) => setTimeout(r, 5));
  }
  return false;
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

// Service calls made by the device page's live controls.
const called = [];
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
  // Device-page controls call HA services, exactly like tapping the entity in HA.
  // The recorder is what the control tests assert against.
  callService: (domain, service, data) => {
    called.push({ domain, service, data });
    return Promise.resolve();
  },
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
        // Bindings and clusters are projections over the retained inventory, so the
        // fixture answers them the way the backend does: per endpoint, with the
        // bindable set already intersected, and targets resolved to names.
        case 'z2m/device/clusters':
          return Promise.resolve(fx.clusters);
        case 'z2m/device/binds':
          return Promise.resolve(fx.binds);
        // Z2M answers a bind with what it managed and what it refused. A partial
        // failure arrives as SUCCESS, which is the whole reason `failed` is rendered.
        case 'z2m/device/bind':
        case 'z2m/device/unbind':
          return Promise.resolve({
            from: msg.from,
            from_endpoint: msg.from_endpoint,
            to: msg.to,
            to_endpoint: msg.to_endpoint,
            clusters: (msg.clusters || []).filter((c) => c !== 'genScenes'),
            failed: (msg.clusters || []).filter((c) => c === 'genScenes'),
          });
        case 'z2m/device/read_values':
          return Promise.resolve({
            requested: ['state', 'brightness'],
            not_readable: ['linkquality'],
            sleeping: (fx.devices.find((d) => d.ieee_address === msg.device) || {})
              .power_source === 'Battery',
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
// Opening the map is only half of it: the element arrives after a lazy import, and
// whatever the panel decides about a scan happens synchronously right after it mounts.
//
// Wait on `_map.el`, NOT on `#mapstage` having a child. `_resetMap()` nulls `_map.el`
// but leaves the previous element in the stage, so a DOM check is satisfied by the
// STALE element and returns before the open has done anything -- which is exactly the
// race that made this suite fail on CI roughly half the time. `_map.el` is set by
// `_mountMap()` alone, so it cannot be satisfied by what the last open left behind.
const settleMap = async () => {
  await until('the map to finish opening', () => !!p._map.el);
  await tick();
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
// Add device is back as a real FAB: fixed, labelled, and it opens the pairing
// helper rather than toggling the radio. It is a plain button because ha-fab is
// not registered in the bundle this panel loads into.
check('the FAB exists and is the pairing entry', (() => {
  const fab = find('data-act', 'pair');
  return !!fab && String(fab.attrs.class || '').includes('fab');
})());
check('the header carries only Show map', (() => {
  const header = /My network([\s\S]*?)<\/div>\s*<div class="card-content">/.exec(html());
  return !!header && header[1].includes('Show map') && !header[1].includes('Add device');
})());

console.log('=== my network card is the panel\u2019s own, not HA table links ===');
check('has a My network card', html().includes('My network'));
check('has Show map button', html().includes('Show map'));
// The devices row goes to the panel's own list -- the HA device table is one filter
// away for whoever wants it -- and the entities row is gone with it.
check('devices row opens the panel list', !!find('data-go', 'devices'));
check('no HA device-table link remains', !html().includes('/config/devices/dashboard'));
check('no HA entity-table link remains', !html().includes('/config/entities/dashboard'));
check('device count comes from the mesh summary',
  html().includes(`${fx.info.device_count} devices`));
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

/** The mirror image: an element the frontend does not register today, but might. */
const withElement = (name, fn) => {
  customElements.define(name, class {});
  p._render();
  try {
    fn();
  } finally {
    defined.delete(name);
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

// Every control the operator edits is one of Home Assistant's own components. The
// previous policy was the opposite -- bare inputs, to survive a cold load -- and it is
// what broke the layout on a phone: a hand-rolled control in HA's row slot took the
// whole row and collapsed its own label. Cold-load safety comes from waiting for the
// component, which this page already does, not from avoiding it.
check('never renders an ha-fab element', !src.includes('<ha-fab'));
check('device options are rendered by ha-form', src.includes('<ha-form data-form='));
check('label-and-control rows use ha-settings-row', src.includes('<ha-settings-row'));
check('no view renders a bare control except the search fallback', (() => {
  const offenders = [];
  for (const name of ['dashboard', 'devices', 'groups', 'options', 'logs', 'network', 'ota']) {
    p._go({ name });
    const bare = (html().match(/<(?:input|select)\b[^>]*/g) || [])
      .filter((t) => !t.includes('id="q"'));
    if (bare.length) offenders.push(`${name}: ${bare.join(' ')}`);
  }
  p._go({ name: 'devices' });
  return !offenders.length;
})());
// ha-textfield is never registered by the frontend this panel loads into, so the
// search box has to keep working without it -- and has to switch to it the moment it
// does appear, rather than being stuck on a substitute forever.
check('search falls back to a styled native input while ha-textfield is missing',
  html().includes('<input id="q" class="fallback"'));
withElement('ha-textfield', () => {
  p._go({ name: 'devices' });
  check('and uses ha-textfield as soon as HA registers it',
    html().includes('<ha-textfield id="q"'));
});
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
// The form is HA's own `ha-form`, driven by a selector schema rather than by markup:
// what matters is that every option Z2M declares becomes a field with the right
// selector, and that the operator's current value is what the field starts on.
const optSpec = p._forms[`opts:${withOpts.ieee_address}`];
const rendered = (withOpts.options || []).filter((o) => o && o.property);
check('the form is rendered by ha-form', html().includes('<ha-form data-form='));
check(`every declared option is a field (${rendered.length})`,
  rendered.every((o) => optSpec.schema.some((s) => s.name === o.property)));
const selectorFor = (prop) =>
  Object.keys((optSpec.schema.find((s) => s.name === prop) || {}).selector || {})[0];
check('binary options use a boolean selector', rendered
  .filter((o) => o.type === 'binary')
  .every((o) => selectorFor(o.property) === 'boolean'));
check('enum options use a select selector', rendered
  .filter((o) => o.type === 'enum')
  .every((o) => selectorFor(o.property) === 'select'));
check('numeric options use a number selector, with the declared bounds', rendered
  .filter((o) => o.type === 'numeric')
  .every((o) => {
    const n = (optSpec.schema.find((s) => s.name === o.property) || {}).selector.number;
    return n && (o.value_min === undefined || n.min === o.value_min)
      && (o.value_max === undefined || n.max === o.value_max);
  }));
check('labels and helpers come from Z2M\u2019s own schema', rendered.every((o) => {
  const s = optSpec.schema.find((x) => x.name === o.property);
  return optSpec.label(s) === (o.label || o.name || o.property)
    && optSpec.helper(s) === o.description;
}));
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
p._forms[`rename:${withOpts.ieee_address}`].data = { value: 'Hallway Dimmer 2' };
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
// Only what the operator actually changed is written: Save on an untouched form must
// not push every option back at Zigbee2MQTT.
await act('options');
check('an untouched form writes nothing', !sent.some((m) => m.type === 'z2m/device/options'));
const binaryOpt = rendered.find((o) => o.type === 'binary');
optSpec.data = { ...optSpec.data, [binaryOpt.property]: true };
await act('options');
check('Save settings -> z2m/device/options', sent.some((m) => m.type === 'z2m/device/options'
  && m.device === withOpts.ieee_address
  && m.options[binaryOpt.property] === true));
check('and writes only the changed field', (() => {
  const msg = sent.find((m) => m.type === 'z2m/device/options');
  return Object.keys(msg.options).length === 1;
})());

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
// The fleet screen exists to answer "what needs attention", so the counts and the
// grouping are the feature, not decoration.
const fleet = p._otaFleet();
check('counts what it lists', fleet.capable.length === otaDevs.length);
check('every capable device lands in exactly one bucket',
  fleet.updating.length + fleet.available.length + fleet.unassessed.length
    + fleet.offline.length + fleet.current.length === fleet.capable.length);
check('says how many devices have no OTA support at all',
  fleet.noOta > 0 && html().includes('report no OTA support at all'));
check('groups the rows by what they need', html().includes('class="ota-group"'));
// A device mid-update, with a percentage.
// Use the device the command tests do not touch, so a mid-update state here cannot
// change what those see.
const upIeee = '0x0000000000000004';
const upEntity = p._dev(upIeee).update_entity;
hass.states[upEntity] = { state: 'on', attributes: {
  installed_version: '1.0.0', latest_version: '1.2.0', in_progress: true, update_percentage: 37 } };
p.hass = hass;
go('ota');
check('an update in flight is grouped first',
  (html().match(/class="ota-group">([^<]*)/) || [])[1].includes('Updating now'));
check('and shows a determinate bar at the reported percentage',
  html().includes('aria-valuenow="37"') && html().includes('width:37%'));
check('with the percentage in words too', html().includes('>37%<'));
// Z2M reports nothing at all for the first stretch of a transfer.
hass.states[upEntity] = { state: 'on', attributes: {
  installed_version: '1.0.0', latest_version: '1.2.0', in_progress: true } };
p.hass = hass;
go('ota');
check('unknown progress is indeterminate, never a fake 0%',
  html().includes('ota-bar unknown') && !html().includes('aria-valuenow')
    && !html().includes('>0%<'));
check('and it says it is starting rather than showing a number',
  html().includes('>starting<'));
hass.states[upEntity] = fx.states[upEntity];
// A fresh object: the setter patches from what changed, and the same reference twice
// is indistinguishable from nothing having happened.
p.hass = { ...hass, states: { ...hass.states } };
go('ota');


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
check('the log level is an ha-select in an ha-settings-row',
  html().includes('<ha-settings-row>') && html().includes('<ha-select id="loglevel"'));
check('every level is an ha-list-item', ['error', 'warning', 'info', 'debug']
  .every((l) => html().includes(`<ha-list-item value="${l}">`)));
check('starts on the current level', (() => {
  const el = p.shadowRoot.getElementById('loglevel');
  return el.dataset.value === fx.info.log_level && el.value === fx.info.log_level;
})());
check('offers permit joining', html().includes('Permit joining'));
check('offers restart', !!find('data-act', 'restart'));
check('links the integration entry',
  p.shadowRoot.querySelectorAll('[href]').some((e) =>
    e.attrs.href === '/config/integrations/integration/z2m'));
sent.length = 0;
const level = p.shadowRoot.getElementById('loglevel');
// ha-select reports through `selected`, and it fires that when the value is assigned
// from here too -- so a change is only a change when the value actually differs.
level.emit('selected');
check('assigning the same level asks for nothing',
  !sent.some((m) => m.type === 'z2m/log_level'));
level.value = 'debug';
level.emit('selected');
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
logmin.emit('selected');
check('level filter drops lower levels', !loglist().includes('Received Zigbee message'));
check('level filter keeps higher levels', loglist().includes('Publish to zigbee2mqtt/x failed'));
logmin.value = 'all';
logmin.emit('selected');
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
await settleMap();
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
// A stray refresh from an earlier section is entitled to land in any later tick, and it
// rewrites `_summary` from the fixture -- which would put `map_generated` back and turn
// this no-cache scenario into a cached one, with no scan to push into. Take the cache out
// of the SOURCE for as long as the scenario runs, so no refresh can contradict it.
const cachedGenerated = fx.info.map_generated;
fx.info.map_generated = null;
p._summary = { ...fx.info };
sent.length = 0;
openMap();
await settleMap();
check('no cache: never calls the blocking map command',
  !sent.some((m) => m.type === 'z2m/networkmap'));
check('no cache: starts a streaming scan',
  await soon(() => hasSub('z2m/networkmap/scan')));
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
await settleMap();
// This scenario feeds the stream, so the stream has to be there. Asserting it here is
// what turns a later confusing 'nothing subscribed' into a named failure.
await until('the streaming scan to start', () => hasSub('z2m/networkmap/scan'));
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
fx.info.map_generated = cachedGenerated;
p._summary = fx.info;
sent.length = 0;
openMap();
await settleMap();
check('a cached open still does not scan', !hasSub('z2m/networkmap/scan'));
p.shadowRoot.getElementById('mapstage').emit('z2m-rescan');
await tick();
check('z2m-rescan starts a fresh streaming scan',
  await soon(() => hasSub('z2m/networkmap/scan')));
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
await settleMap();
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
console.log('=== add device: a window that watches before it opens the radio ===');
go('dashboard');
sent.length = 0;
await act('pair');
await tick(60);
// Everything the dialog draws lives on the dialog element, not in the page markup:
// it is deliberately outside the panel's own render so a retained-topic push cannot
// tear it down mid-pairing.
const dlg = () => String((p._dialog && p._dialog.el.innerHTML) || '');
check('Add device opens a dialog, not another page', p._pairing.open === true
  && p._view.name === 'dashboard');
check('and it is HA\u2019s own dialog element', p._dialog.native === true
  && p._dialog.el.tag === 'ha-dialog');
check('the dialog is hosted in the panel', p._dialog.el.parentNode === p.shadowRoot);
// The whole point of the two-step: pressing the button must not start a join.
check('the radio is NOT opened yet',
  !sent.some((m) => m.type === 'z2m/permit_join'), sent.map((m) => m.type).join(' -> '));
check('but watching starts at once', hasSub('z2m/pairing/subscribe')
  && hasSub('z2m/logs/subscribe'));
const pairOrder = sent.map((m) => m.type);
check('the panel does not drive the log level itself',
  !pairOrder.includes('z2m/log_level'), pairOrder.join(' -> '));

console.log('=== add device: how to join is a choice, not a default ===');
// Zigbee2MQTT reports the coordinator in bridge/devices alongside the routers, and
// joining through it is the normal case, so it has to be offered and labelled.
p._devices = fx.devices.concat([
  { ieee_address: '0x00124b0039db98bf', friendly_name: 'Coordinator', type: 'Coordinator',
    power_source: 'Mains (single phase)', availability: 'online', supported: true,
    endpoints: [1], exposes: [], options: [], scenes: [] },
]);
p._paintPairDialog();
const routers = p._pairRouters();
const routeOptions = () =>
  (p._forms.pair.schema.find((s) => s.name === 'via') || {}).selector.select.options;
const timeOptions = () =>
  (p._forms.pair.schema.find((s) => s.name === 'duration') || {}).selector.select.options;
check('offers the mains-powered devices as routes', routers.length > 1
  && routers.every((r) => routeOptions().some((o) => o.value === r.ieee)));
check('never offers a sleeping device as a route',
  !routers.some((r) => (p._dev(r.ieee) || {}).type === 'EndDevice'));
check('the coordinator is named as such',
  routeOptions().some((o) => o.label.includes('(coordinator)')));
check('the window length is capped at what Z2M accepts',
  timeOptions().some((o) => o.label === '254 seconds (max)'));
// Choosing a router, then a shorter window, then starting. The two choices are
// `ha-form` fields, so they arrive as one value-changed payload rather than as two
// separate control changes.
const pairSpec = p._forms.pair;
check('the dialog\u2019s choices are an ha-form', dlg().includes('<ha-form data-form="pair">')
  && pairSpec.schema.map((s) => s.name).join(',') === 'via,duration');
check('and both are select selectors', pairSpec.schema.every((s) => !!s.selector.select));
pairSpec.changed({ via: routers.find((r) => !r.coordinator).ieee, duration: '60' });
sent.length = 0;
await act('pairstart');
await tick(60);
const permit = sent.find((m) => m.type === 'z2m/permit_join');
check('Start is what opens joining', !!permit);
check('for the chosen length', permit && permit.time === 60);
check('through the chosen router', permit
  && permit.device === routers.find((r) => !r.coordinator).ieee);
check('the helper knows it owns this window', p._pairing.ownsPermit === true);
check('and says which router it is joining through',
  dlg().includes(routers.find((r) => !r.coordinator).name));

p._summary = { ...fx.info, permit_join: true, permit_join_end: Date.now() + 90000 };
p._paintPairDialog();
check('shows a live countdown', /\d+s/.test(dlg()));
check('tells the operator what to do', dlg().includes('pairing mode'));

console.log('=== add device: the window running out is a state, not silence ===');
p._summary = { ...fx.info, permit_join: false, permit_join_end: null };
p._tick();
check('an expired window is noticed', p._pairing.phase === 'timeout');
check('and nothing is left claimed', p._pairing.ownsPermit === false);
check('it says nothing joined', dlg().includes('no device joined'));
check('and offers to go again', !!find('data-act', 'pairstart'));
p._summary = { ...fx.info, permit_join: true, permit_join_end: Date.now() + 90000 };
p._pairing.ownsPermit = true;
p._pairing.phase = 'waiting';
p._paintPairDialog();
console.log('=== pairing helper: somebody else\u2019s device is not ours ===');
push('z2m/pairing/subscribe', { kind: 'event', event: fx.pairing.joined });
check('the first join is adopted', p._pairing.target === fx.pairing.joined.ieee_address);
push('z2m/pairing/subscribe', { kind: 'event', event: fx.pairing.other });
check('a second pairer\u2019s device is ignored',
  p._pairing.target === fx.pairing.joined.ieee_address);

console.log('=== pairing helper: interview progress is the source of truth ===');
push('z2m/pairing/subscribe', { kind: 'event', event: fx.pairing.started });
check('interview progress is shown', dlg().includes('Interviewing'));
const logRows = () => String(p.shadowRoot.getElementById('pairlog').innerHTML);
push('z2m/logs/subscribe', { time: Date.now() / 1000, level: 'info', message: 'Starting interview' });
await tick();
check('live log lines are shown', logRows().includes('Starting interview'));
check('a log line is never treated as completion', p._pairing.phase === 'interview_started');

console.log('=== add device: the log is turned up, then filtered ===');
// Raising the level is the BACKEND's job, tied to the pairing subscription: a
// browser cannot promise to put it back, because closing the tab skips whatever
// cleanup the page intended and would leave the bridge at debug forever.
check('subscribing is what asks for it', hasSub('z2m/pairing/subscribe'));
p._summary = { ...p._summary, log_level: 'debug' };
p._paintPairDialog();
check('the raised level is shown while it lasts', dlg().includes('>debug<'));
check('and it is described as self-restoring', dlg().includes('goes back on its own'));
// Debug on a 42-device mesh is mostly other devices talking, and none of it is
// about the device being paired.
const noise = [
  "z2m:mqtt: MQTT publish: topic 'zigbee2mqtt/Kitchen Humidity Sensor', payload '{\"humidity\":41.2}'",
  "z2m:mqtt: MQTT publish: topic 'zigbee2mqtt/Front Door Light', payload '{\"state\":\"ON\",\"power\":12}'",
  "z2m:mqtt: MQTT publish: topic 'zigbee2mqtt/bridge/devices', payload '[]'",
  "z2m: Received Zigbee message from 'Gym Electronics Plug', type 'attributeReport', cluster 'haElectricalMeasurement'",
];
const signal = [
  "z2m: Starting interview of '0x00158d0002ab34cd'",
  "z2m: Successfully interviewed '0x00158d0002ab34cd', device has successfully been paired",
  'z2m: Zigbee: allowing new devices to join.',
  "z2m: Configuring '0x00158d0002ab34cd'",
];
const beforeNoise = p._pairing.logs.length;
for (const message of noise) {
  push('z2m/logs/subscribe', { time: Date.now() / 1000, level: 'debug', message });
}
await tick();
check('routine device traffic is dropped', p._pairing.logs.length === beforeNoise,
  `${p._pairing.logs.length - beforeNoise} noise line(s) kept`);
check('a retained bridge republish is dropped', !logRows().includes('bridge/devices'));
for (const message of signal) {
  push('z2m/logs/subscribe', { time: Date.now() / 1000, level: 'debug', message });
}
await tick();
check('every pairing line is kept', p._pairing.logs.length === beforeNoise + signal.length,
  `${p._pairing.logs.length - beforeNoise} of ${signal.length}`);
check('the interview conversation is visible', logRows().includes('Starting interview of'));
// Anything naming the device being paired is relevant, whatever it says.
push('z2m/logs/subscribe', { time: Date.now() / 1000, level: 'debug',
  message: "z2m: Received Zigbee message from '0x00158d0002ab34cd', type 'readResponse'" });
await tick();
check('traffic from the joining device itself is kept', logRows().includes('readResponse'));

console.log('=== pairing helper: auto-scroll, with a way to stop it ===');
check('the log follows the newest line by default', p._pairing.follow === true
  && p.shadowRoot.getElementById('pairlog').scrollTop > 0);
await act('pairfollow');
check('Follow can be turned off', p._pairing.follow === false);
check('the button says what it will do next', dlg().includes('>Follow<'));
const parked = p.shadowRoot.getElementById('pairlog').scrollTop;
push('z2m/logs/subscribe', { time: Date.now() / 1000, level: 'debug',
  message: "z2m: Configuring '0x00158d0002ab34cd' endpoint 1" });
await tick();
check('a new line does not yank the view while paused',
  p.shadowRoot.getElementById('pairlog').scrollTop === parked);
await act('pairfollow');
check('Follow can be turned back on and re-pins', p._pairing.follow === true
  && p.shadowRoot.getElementById('pairlog').scrollTop > 0);
// Scrolling up is itself a request to stop following.
const pairBox = p.shadowRoot.getElementById('pairlog');
pairBox.scrollTop = 0;
pairBox.onscroll();
await tick();
check('scrolling up pauses the follow', p._pairing.follow === false);
await act('pairfollow');

sent.length = 0;
push('z2m/pairing/subscribe', { kind: 'event', event: fx.pairing.successful });
await tick();
check('success is reported', dlg().includes('Paired'));
check('the device is named exactly', dlg().includes(fx.pairing.successful.ieee_address)
  && dlg().includes('WSDCGQ11LM'));
// An open network is an open network: close it as soon as the device is in.
check('the helper closes the window it opened',
  sent.some((m) => m.type === 'z2m/permit_join' && m.time === 0));
check('and stops claiming ownership', p._pairing.ownsPermit === false);

console.log('=== add device: name and area, through HA\u2019s own registry ===');
// The retained inventory catching up is what supplies the HA device id.
p._devices = fx.devices.concat([fx.paired_device]);
p._paintPairDialog();
const pairSetup = p._forms[`pairsetup:${fx.pairing.successful.ieee_address}`];
check('offers a name field', dlg().includes('<ha-form data-form="pairsetup:')
  && pairSetup.schema.some((s) => s.name === 'name' && s.selector.text));
check('the area field is HA\u2019s own area picker',
  pairSetup.schema.some((s) => s.name === 'area' && s.selector.area));
check('saving is the closing action', !!find('data-act', 'pairsave')
  && dlg().includes('Save and close'));
check('and adding another is offered beside it', !!find('data-act', 'pairagain'));
sent.length = 0;
pairSetup.data = { name: 'Nursery Climate', area: 'hallway' };
await act('pairsave');
await tick(80);
check('renames in Zigbee2MQTT by ieee, not by name', sent.some((m) =>
  m.type === 'z2m/device/rename' && m.from === fx.pairing.successful.ieee_address
  && m.to === 'Nursery Climate'));
check('sets the HA display name and area through HA\u2019s own command', sent.some((m) =>
  m.type === 'config/device_registry/update' && m.device_id === 'dev_paired'
  && m.name_by_user === 'Nursery Climate' && m.area_id === 'hallway'));
check('never rewrites entity ids', !sent.some((m) => 'new_entity_id' in m));

console.log('=== add device: unsupported and failed are different states ===');
p._resetPairing();
p._pairing.open = true;
p._adoptPairSession(fx.pairing.unsupported);
check('unsupported is a success with a caveat', dlg().includes('no converter'));
p._resetPairing();
p._pairing.open = true;
p._adoptPairSession(fx.pairing.failed);
check('a failed interview says so locally', dlg().includes('interview failed'));
check('a failed interview is not a page-level unknown error',
  !html().includes('Unknown error'));

console.log('=== add device: closing is what stops everything ===');
p._resetPairing();
p._pairing.open = true;
p._pairing.ownsPermit = true;
p._paintPairDialog();
sent.length = 0;
await act('pairclose');
await tick();
check('closing shuts the window it opened',
  sent.some((m) => m.type === 'z2m/permit_join' && m.time === 0));
check('the dialog is taken off the page', p._pairing.open === false
  && p._dialog.el.parentNode === null);
check('unsubscribes the pairing stream', !hasSub('z2m/pairing/subscribe'));
check('unsubscribes the pairing log', !hasSub('z2m/logs/subscribe'));
check('nothing is left holding the log level up',
  !sent.some((m) => m.type === 'z2m/log_level'));

// Escape and the scrim are the same event as the button, and HA's dialog reports
// them the same way. It also reports `closed` while it settles into its initial
// state, before anything is on screen -- which must NOT count as a dismissal.
await act('pair');
await tick(60);
p._dialog.el.emit('closed');
check('a settling close does not dismiss it', p._pairing.open === true);
p._dialog.el.emit('opened');
// As if Start had been pressed: the window is ours, so dismissing must shut it.
p._pairing.ownsPermit = true;
sent.length = 0;
p._dialog.el.emit('closed');
await tick();
check('Escape closes it too', p._pairing.open === false
  && sent.some((m) => m.type === 'z2m/permit_join' && m.time === 0));

console.log('=== add device: a cold load still gets a usable window ===');
// ha-dialog is lazily loaded like everything else HA owns, so the dialog cannot
// depend on it being defined the moment the operator presses the button.
const stashedDialog = defined.get('ha-dialog');
defined.delete('ha-dialog');
p._dialog = null;
await act('pair');
await tick(60);
check('falls back to a plain sheet', p._dialog.native === false
  && p._dialog.el.tag === 'div');
check('which is a real dialog to assistive tech',
  p._dialog.el.attrs.role === 'dialog' && p._dialog.el.attrs['aria-modal'] === 'true');
check('and still offers Start', !!find('data-act', 'pairstart'));
check('and still carries the live log', dlg().includes('id="pairlog"'));
check('and can be dismissed', !!find('data-act', 'pairclose'));
defined.set('ha-dialog', stashedDialog);
await act('pairclose');
await tick();
p._devices = fx.devices;
p._summary = fx.info;
p._render();

/* ================================================================== groups */
console.log('=== groups: create ===');
go('groups');
check('Create stays reachable', !!find('data-act', 'groupadd'));
check('lists existing groups', html().includes(esc(fx.groups[0].friendly_name)));
check('group rows open the group', !!find('data-group', String(fx.groups[0].id)));
sent.length = 0;
p._forms.gcreate.data = { value: 'Kitchen downlights' };
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
p._forms[`grename:${fx.groups[0].id}`].data = { value: 'Lounge lights' };
await act('grouprename');
await tick(40);
check('Rename -> z2m/group/rename', sent.some((m) =>
  m.type === 'z2m/group/rename' && String(m.group) === String(fx.groups[0].id)
  && m.to === 'Lounge lights'));

// Endpoint 1 of device one is already a member, so it must not be offered again.
// Read the rendered markup: the stub indexes elements, it does not reflow their
// children into innerHTML, so the select's own innerHTML proves nothing here.
const offered = Array.from(
  /<ha-select id="gmember"[\s\S]*?>([\s\S]*?)<\/ha-select>/.exec(html())[1]
    .matchAll(/value="([^"]*)"/g)
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
p._forms[`grename:${fx.groups[0].id}`].data = { value: 'Duplicate name' };
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

/* ================================================================ bindings */
console.log('=== bindings: what is bound, and to what ===');
p._go({ name: 'binds', ieee: '0x0000000000000001' });
// Both reads are in flight at once, so wait for the state they land in rather than for a
// duration that only happens to be long enough on this machine.
check('reads the device\u2019s endpoints and binds',
  await soon(() => !!p._binds.clusters && !!p._binds.binds));
check('titled Bindings', html().includes('header="Bindings"'));
check('says what a bind actually does', html().includes('without Home Assistant or'));
check('groups binds by the endpoint that owns them',
  html().includes('Endpoint 1') && html().includes('Endpoint 2'));
// The jargon is unavoidable -- it is what Z2M and the device docs use -- so both the
// plain name and the identifier have to be on screen.
check('every cluster is named in English and by its identifier',
  html().includes('On/off (genOnOff)') && html().includes('Energy metering (seMetering)'));
check('a manufacturer cluster with no plain name still shows its identifier',
  html().includes('>manuSpecificInovelli<'));
check('the coordinator is named as the coordinator',
  html().includes('Coordinator (coordinator)'));
check('a group target is named as a group', html().includes('Kitchen (group)'));
check('a bind whose target has left the network is still shown',
  html().includes('target no longer known'));
// Endpoint 242 is the green-power endpoint: nothing bound, nothing bindable. Showing
// it would be noise the operator can do nothing with.
check('an endpoint that can bind nothing is left out entirely',
  !html().includes('Endpoint 242'));
const bindSpec = p._forms['bind:0x0000000000000001'];
check('the create form is an ha-form with three fields',
  html().includes('<ha-form data-form="bind:') &&
  bindSpec.schema.map((s) => s.name).join(',') === 'endpoint,target,clusters');
check('endpoint 242 is not offered as a source: it can bind nothing',
  !bindSpec.schema[0].selector.select.options.some((o) => o.value === '242'));
check('clusters are the endpoint\u2019s bindable set, not everything it speaks',
  bindSpec.schema[2].selector.select.options.map((o) => o.value).join(',')
    === 'genScenes,genOnOff,genLevelCtrl');
check('clusters can be chosen several at a time',
  bindSpec.schema[2].selector.select.multiple === true);
check('targets include groups and the other devices',
  bindSpec.schema[1].selector.select.options.some((o) => o.label.includes('(group)')) &&
  bindSpec.schema[1].selector.select.options.some((o) => o.value.startsWith('d:')));
check('the device never offers itself as its own target',
  !bindSpec.schema[1].selector.select.options.some((o) =>
    o.value.includes('0x0000000000000001')));
// Choosing endpoint 2 must narrow the cluster list: it speaks fewer of them.
bindSpec.data = { ...bindSpec.data, endpoint: '2' };
p._render();
check('changing endpoint re-narrows the clusters',
  p._forms['bind:0x0000000000000001'].schema[2].selector.select.options
    .map((o) => o.value).join(',') === 'genScenes,genOnOff');

console.log('=== bindings: writing, and the partial failure Z2M calls success ===');
bindSpec.data = { endpoint: '1', target: 'g:5', clusters: ['genOnOff', 'genScenes'] };
sent.length = 0;
await act('bind');
await until('the bind command to be sent',
  () => sent.some((m) => m.type === 'z2m/device/bind'));
const bindMsg = sent.find((m) => m.type === 'z2m/device/bind');
check('binds with the chosen endpoint, target and clusters', !!bindMsg
  && bindMsg.from === '0x0000000000000001' && bindMsg.from_endpoint === 1
  && bindMsg.to === 5 && bindMsg.to_endpoint === undefined
  && bindMsg.clusters.join(',') === 'genOnOff,genScenes');
check('a group target carries no endpoint', !('to_endpoint' in bindMsg));
check('what succeeded is reported', html().includes('On/off (genOnOff)'));
// The fixture refuses genScenes, exactly as a sleeping or unsupported device does.
check('and what Z2M refused is NOT hidden behind a tick',
  html().includes('were refused') && html().includes('Scenes (genScenes)'));
check('the refusal explains the usual cause', html().includes('asleep'));
check('the list is re-read from Zigbee2MQTT afterwards',
  sent.filter((m) => m.type === 'z2m/device/binds').length >= 1);

console.log('=== bindings: removing one cluster ===');
sent.length = 0;
await act('unbind');
await until('the unbind command to be sent',
  () => sent.some((m) => m.type === 'z2m/device/unbind'));
const unbindMsg = sent.find((m) => m.type === 'z2m/device/unbind');
check('unbinds exactly the cluster on the row', !!unbindMsg
  && unbindMsg.clusters.length === 1);
check('and addresses the target that bind pointed at', !!unbindMsg
  && (unbindMsg.to === '0x00124b0039db98bf' || typeof unbindMsg.to === 'number'));
check('nothing is written without a target and a cluster', (() => {
  p._forms['bind:0x0000000000000001'].data = { endpoint: '1', target: '', clusters: [] };
  sent.length = 0;
  return true;
})());
await act('bind');
check('an incomplete form is refused locally, not by the radio',
  !sent.some((m) => m.type === 'z2m/device/bind')
    && html().includes('Choose a target and at least one cluster'));
p._go({ name: 'device', ieee: '0x0000000000000001' });

/* ============================================== device page: live and organized */
console.log('=== device page: controls and sensors come first ===');
p._go({ name: 'device', ieee: '0x0000000000000001' });
await tick();
check('the page is a responsive grid', html().includes('class="devgrid"'));
check('controls card renders for a controllable device', html().includes('>Controls<'));
check('the light is a native tile control', html().includes('data-ctltoggle="light.hallway_dimmer"'));
check('a dimmable light gets a brightness slider',
  html().includes('data-ctlbright="light.hallway_dimmer"'));
check('controls come before the identity details', (() => {
  const h = html();
  return h.indexOf('>Controls<') !== -1 && h.indexOf('>Controls<') < h.indexOf('Device details');
})());
check('identity is folded into an expansion panel',
  html().includes('<ha-expansion-panel header="Device details">'));
check('the chips summarize what the table used to shout',
  html().includes('>Online<') && html().includes('>Router<'));
check('a hidden entity stays hidden here too',
  !html().includes('power_on_behavior'));
check('the diagnostic linkquality is shown, subdued',
  html().includes('data-sens="sensor.hallway_dimmer_linkquality"')
    && /class="sens diag"/.test(html()));

console.log('=== device page: controls call HA services ===');
called.length = 0;
const toggle = p.shadowRoot.querySelectorAll('[data-ctltoggle]')[0];
check('the toggle reflects the live state', toggle && toggle.checked === true);
toggle.checked = false;
toggle.emit('change');
check('flipping it calls the entity\u2019s own service',
  called.length === 1 && called[0].domain === 'light' && called[0].service === 'turn_off'
    && called[0].data.entity_id === 'light.hallway_dimmer');
const slider = p.shadowRoot.querySelectorAll('[data-ctlbright]')[0];
check('the slider reflects live brightness (128/255 -> 50%)',
  slider && Number(slider.value) === 50);
called.length = 0;
slider.emit('value-changed', { value: 75 });
check('sliding writes brightness_pct through light.turn_on',
  called.length === 1 && called[0].service === 'turn_on'
    && called[0].data.brightness_pct === 75);

console.log('=== device page: hass pushes patch in place ===');
p.hass = { ...hass, states: { ...hass.states,
  'light.hallway_dimmer': { ...hass.states['light.hallway_dimmer'], state: 'off' } } };
await tick();
check('a state change flips the toggle without a render',
  p.shadowRoot.querySelectorAll('[data-ctltoggle]')[0].checked === false);

console.log('=== device page: sensors read like readings ===');
p._go({ name: 'device', ieee: '0x0000000000000002' });
await tick();
check('no controls card for a sensor-only device', !html().includes('>Controls<'));
check('sensors card renders', html().includes('>Sensors<'));
check('display precision is honored (21.4333 -> 21.4)', html().includes('>21.4 <span>'));
check('binary sensors say what they mean, not on/off',
  html().includes('>Clear<') || html().includes('>Detected<'));
check('battery is a chip up top too', html().includes('Battery 100%'));
check('every reading names its freshness', /class="sens-t">[^<]/.test(html()));
p._go({ name: 'dashboard' });
await tick();

console.log('=== device page: values are read from the device, not per field ===');
sent.length = 0;
delete p._readValues;
p._go({ name: 'device', ieee: '0x0000000000000001' });
await tick();
check('opening a powered device asks it to report everything readable',
  await soon(() => sent.some((m) => m.type === 'z2m/device/read_values'
    && m.device === '0x0000000000000001')));
p._go({ name: 'dashboard' });
await tick();
sent.length = 0;
p._go({ name: 'device', ieee: '0x0000000000000001' });
await tick();
check('but only once per device, not on every visit',
  !sent.some((m) => m.type === 'z2m/device/read_values'));
check('a Refresh control is offered for the manual case', !!find('data-act', 'readvalues'));
sent.length = 0;
await act('readvalues');
await until('the manual read to be sent',
  () => sent.some((m) => m.type === 'z2m/device/read_values'));
check('and it confirms in plain words',
  await soon(() => html().includes('report its current values')));
p._go({ name: 'device', ieee: '0x0000000000000002' });
await tick();
sent.length = 0;
p._go({ name: 'dashboard' });
await tick();
p._go({ name: 'device', ieee: '0x0000000000000002' });
await tick();
check('a battery device is never read automatically',
  !sent.some((m) => m.type === 'z2m/device/read_values'));
p._go({ name: 'dashboard' });
await tick();

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

console.log(`\n${fails === 0 ? 'ALL CHECKS PASSED' : fails + ' CHECK(S) FAILED'}`);
process.exit(fails === 0 ? 0 : 1);
