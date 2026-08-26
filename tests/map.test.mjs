/**
 * Tests the map's decision-making, not its pixels.
 *
 * Two layers. The Graph logic makes claims about the operator's own mesh -- which
 * device reaches the hub through which router, and which single failure would
 * strand devices. A silent bug there is worse than a missing feature, because it
 * is believable. So the parts that reason are tested against hand-built
 * topologies whose right answer is known.
 *
 * The second layer drives the <z2m-network-map> element itself through a tiny DOM
 * shim, replaying the exact event stream the panel sends during a live scan. This
 * exists because the failure it guards against was invisible to logic tests: the
 * element once gated event ingestion on isConnected and computed its one-and-only
 * view fit against a 0x0 host rect, so a fresh no-cache open showed a blank canvas
 * for the whole walk and then popped the finished graph in at once. The contract
 * pinned here is progressive reveal: every device is on screen the moment `start`
 * arrives, every `device` event attaches its links immediately, and `done`
 * reconciles without teleporting anything.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(
  join(here, '..', 'custom_components/z2m/panel/z2m-map.js'),
  'utf8'
);

/* --------------------------------------------------------------- DOM shim */
// Just enough surface for z2m-map.js to run headless, with a controllable clock
// and rAF pump so "what is on screen right now" is a checkable statement.

let NOW = 0;
const rafQueue = [];
let rafId = 1;
const pumpFrames = (count = 1, frameMs = 16.7) => {
  for (let i = 0; i < count; i++) {
    NOW += frameMs;
    for (const { cb } of rafQueue.splice(0, rafQueue.length)) cb(NOW);
  }
};
const pendingFrames = () => rafQueue.length;
const settleLoops = () => {
  let guard = 0;
  while (pendingFrames() > 0 && guard++ < 4000) pumpFrames(1);
  return guard;
};

let stageRect = { left: 0, top: 0, width: 1200, height: 800 };
const setStageRect = (r) => (stageRect = { left: 0, top: 0, ...r });

class ClassList {
  constructor(el) {
    this._el = el;
  }
  _get() {
    return new Set((this._el.getAttribute('class') || '').split(/\s+/).filter(Boolean));
  }
  _put(s) {
    this._el.setAttribute('class', [...s].join(' '));
  }
  add(...cs) {
    const s = this._get();
    for (const c of cs) s.add(c);
    this._put(s);
  }
  remove(...cs) {
    const s = this._get();
    for (const c of cs) s.delete(c);
    this._put(s);
  }
  toggle(c, force) {
    const s = this._get();
    const want = force === undefined ? !s.has(c) : !!force;
    if (want) s.add(c);
    else s.delete(c);
    this._put(s);
    return want;
  }
  contains(c) {
    return this._get().has(c);
  }
}

class FakeEl {
  constructor(tag, ns = null) {
    this.tagName = String(tag).toUpperCase();
    this.namespaceURI = ns;
    this.childNodes = [];
    this.parentNode = null;
    this._attrs = new Map();
    this._listeners = new Map();
    this._text = '';
    this._innerHTML = '';
    this._qs = new Map();
    this.dataset = {};
    this.classList = new ClassList(this);
    this.style = {
      setProperty(k, v) {
        this[k] = String(v);
      },
      removeProperty(k) {
        delete this[k];
      },
    };
    this.hidden = false;
    this.disabled = false;
    this.value = '';
  }
  setAttribute(k, v) {
    this._attrs.set(k, String(v));
  }
  getAttribute(k) {
    return this._attrs.has(k) ? this._attrs.get(k) : null;
  }
  removeAttribute(k) {
    this._attrs.delete(k);
  }
  append(...nodes) {
    for (const n of nodes) this.appendChild(n);
  }
  appendChild(n) {
    if (n.parentNode) n.parentNode.childNodes.splice(n.parentNode.childNodes.indexOf(n), 1);
    n.parentNode = this;
    this.childNodes.push(n);
    return n;
  }
  remove() {
    if (!this.parentNode) return;
    const i = this.parentNode.childNodes.indexOf(this);
    if (i >= 0) this.parentNode.childNodes.splice(i, 1);
    this.parentNode = null;
  }
  get children() {
    return this.childNodes;
  }
  get firstChild() {
    return this.childNodes[0] || null;
  }
  set textContent(v) {
    this._text = String(v);
    this.childNodes = [];
  }
  get textContent() {
    return this._text;
  }
  set innerHTML(v) {
    this._innerHTML = String(v);
    this._qs.clear();
  }
  get innerHTML() {
    return this._innerHTML;
  }
  set className(v) {
    this.setAttribute('class', v);
  }
  get className() {
    return this.getAttribute('class') || '';
  }
  /** Permissive: a live stub per selector, so wiring code can bind to it. */
  querySelector(sel) {
    if (!this._qs.has(sel)) {
      const stub = new FakeEl('stub');
      stub.closest = () => null;
      this._qs.set(sel, stub);
    }
    return this._qs.get(sel);
  }
  addEventListener(type, cb) {
    if (!this._listeners.has(type)) this._listeners.set(type, []);
    this._listeners.get(type).push(cb);
  }
  removeEventListener(type, cb) {
    const list = this._listeners.get(type) || [];
    const i = list.indexOf(cb);
    if (i >= 0) list.splice(i, 1);
  }
  dispatchEvent(ev) {
    ev.target = ev.target || this;
    let at = this;
    while (at) {
      for (const cb of at._listeners?.get(ev.type) || []) cb(ev);
      at = ev.bubbles ? at.parentNode || at._host || null : null;
    }
    return true;
  }
  listeners(type) {
    return this._listeners.get(type) || [];
  }
  closest() {
    return null;
  }
  getBoundingClientRect() {
    return { ...stageRect, right: stageRect.width, bottom: stageRect.height };
  }
  setPointerCapture() {}
  focus() {}
}

class FakeShadowRoot extends FakeEl {
  constructor(host) {
    super('#shadow-root');
    this._host = host;
  }
}

globalThis.HTMLElement = class extends FakeEl {
  constructor() {
    super('z2m-network-map');
    this._connected = false;
  }
  attachShadow() {
    this.shadowRoot = new FakeShadowRoot(this);
    return this.shadowRoot;
  }
  get isConnected() {
    return this._connected;
  }
  connect() {
    this._connected = true;
    this.connectedCallback?.();
  }
  disconnect() {
    this._connected = false;
    this.disconnectedCallback?.();
  }
};
globalThis.customElements = { get: () => undefined, define: () => {} };
globalThis.document = {
  createElement: (tag) => new FakeEl(tag),
  createElementNS: (ns, tag) => new FakeEl(tag, ns),
};
globalThis.window = {
  customCards: [],
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: () => {},
  matchMedia: () => ({ matches: false }),
};
globalThis.requestAnimationFrame = (cb) => {
  const id = rafId++;
  rafQueue.push({ id, cb });
  return id;
};
globalThis.cancelAnimationFrame = (id) => {
  const i = rafQueue.findIndex((e) => e.id === id);
  if (i >= 0) rafQueue.splice(i, 1);
};
globalThis.performance = { now: () => NOW };
globalThis.localStorage = {
  _s: new Map(),
  getItem(k) {
    return this._s.has(k) ? this._s.get(k) : null;
  },
  setItem(k, v) {
    this._s.set(k, String(v));
  },
  removeItem(k) {
    this._s.delete(k);
  },
};
globalThis.ResizeObserver = class {
  observe() {}
  disconnect() {}
};
globalThis.CustomEvent = class {
  constructor(type, init = {}) {
    this.type = type;
    this.detail = init.detail;
    this.bubbles = !!init.bubbles;
    this.composed = !!init.composed;
  }
};
globalThis.history = { pushState: () => {} };

const {
  Graph,
  Simulation,
  assignHomes,
  classifyPairs,
  pairKey,
  linkTone,
  hopCost,
  lqiBand,
  labelText,
  NODE_CLEARANCE,
  NARROW_PX,
  Z2MNetworkMap,
} = new Function(
  `${src}\nreturn { Graph, Simulation, assignHomes, classifyPairs, pairKey, linkTone,
    hopCost, lqiBand, labelText, NODE_CLEARANCE, NARROW_PX, Z2MNetworkMap };`
)();

let failures = 0;
const check = (name, cond, extra = '') => {
  if (cond) {
    console.log(`PASS ${name}`);
  } else {
    failures++;
    console.log(`FAIL ${name}${extra ? ` -- ${extra}` : ''}`);
  }
};

const COORD = '0x00coordinator';
const node = (ieee, type, extra = {}) => ({
  ieee,
  name: ieee.replace('0x00', ''),
  type,
  addr: 0,
  vendor: null,
  model: null,
  description: null,
  lastSeen: null,
  failed: [],
  availability: null,
  device_id: null,
  ...extra,
});
const link = (source, target, lqi, relationship, extra = {}) => ({
  source,
  target,
  lqi,
  relationship,
  depth: 1,
  rxOnWhenIdle: 1,
  routes: [],
  ...extra,
});

/* ---------------------------------------------------- parent chain is preferred */
{
  // DIRECTION: a row means "TARGET's neighbour table contains SOURCE". So a rel=1
  // ("source is my child") row names the PARENT in `target`. Verified on a live
  // network: across 190 rows an end device appeared as `source` 28 times and as
  // `target` 0 times, which is only possible if `target` is the table's owner.
  // These fixtures are written in that direction deliberately -- an earlier version
  // of this file encoded the inverse and therefore passed while the map drew
  // routers reaching the coordinator through battery sensors.
  const g = new Graph({
    coordinator: COORD,
    nodes: [node(COORD, 'Coordinator'), node('0x00router', 'Router'), node('0x00leaf', 'EndDevice')],
    links: [
      link('0x00router', COORD, 150, 1), // coordinator's table: router is my child
      link('0x00leaf', '0x00router', 90, 1), // router's table: leaf is my child
      // A tempting direct link the end device does NOT actually use.
      link('0x00leaf', COORD, 250, 2),
    ],
  });

  const route = g.routeToCoordinator('0x00leaf');
  check('parent chain is used when reported', route.kind === 'parent', `got ${route.kind}`);
  check('parent chain has both hops', route.hops.length === 2, `got ${route.hops.length}`);
  check(
    'parent chain ignores the stronger sibling shortcut',
    route.hops[0].to === '0x00router',
    `first hop went to ${route.hops[0]?.to}`
  );
  check('parent chain ends at the coordinator', route.hops.at(-1).to === COORD);
  check('depth is measured in hops', g.depth.get('0x00leaf') === 1 || g.depth.get('0x00leaf') === 2);

  // The bug this file failed to catch once: an end device is never a parent, so a
  // router must never be routed through one. This asserts the direction itself.
  check(
    'an end device is never treated as a parent',
    g.parent.get('0x00router') === COORD && g.parent.get(COORD) === undefined,
    `parent(router)=${g.parent.get('0x00router')} parent(coord)=${g.parent.get(COORD)}`
  );
  check(
    'a rel=0 row names the neighbour as the parent',
    new Graph({
      coordinator: COORD,
      nodes: [node(COORD, 'Coordinator'), node('0x00r2', 'Router')],
      // r2's table: the coordinator is my parent.
      links: [link(COORD, '0x00r2', 150, 0)],
    }).parent.get('0x00r2') === COORD
  );
}

/* ------------------------------- inferred path balances hop count against quality */
{
  // No parent data at all: everything is a sibling, so we must fall back.
  const g = new Graph({
    coordinator: COORD,
    nodes: [node(COORD, 'Coordinator'), node('0x00mid', 'Router'), node('0x00far', 'Router')],
    links: [
      link(COORD, '0x00far', 20, 2), // one weak hop
      link(COORD, '0x00mid', 250, 2), // two strong hops
      link('0x00mid', '0x00far', 250, 2),
    ],
  });

  const route = g.routeToCoordinator('0x00far');
  check('falls back to inference with no parent data', route.kind === 'inferred', `got ${route.kind}`);
  check(
    'two strong hops beat one weak hop',
    route.hops.length === 2,
    `chose ${route.hops.length} hop(s)`
  );
  check(
    'inferred path routes via the strong router',
    route.hops[0].to === '0x00mid',
    `first hop went to ${route.hops[0]?.to}`
  );

  // ...but hop count still counts: a single good link must win outright.
  const g2 = new Graph({
    coordinator: COORD,
    nodes: [node(COORD, 'Coordinator'), node('0x00mid', 'Router'), node('0x00far', 'Router')],
    links: [
      link(COORD, '0x00far', 200, 2),
      link(COORD, '0x00mid', 255, 2),
      link('0x00mid', '0x00far', 255, 2),
    ],
  });
  check(
    'a single good link is preferred over two slightly better ones',
    g2.routeToCoordinator('0x00far').hops.length === 1
  );
}

/* ------------------------------------------------------------------ no path home */
{
  const g = new Graph({
    coordinator: COORD,
    nodes: [node(COORD, 'Coordinator'), node('0x00orphan', 'EndDevice')],
    links: [],
  });
  const route = g.routeToCoordinator('0x00orphan');
  check('an unreachable device reports no path', route.kind === 'none' && !route.hops.length);
}

/* ---------------------------------------------------------------- choke points */
{
  // leaf sits behind exactly one router; spare sits on a redundant pair.
  const g = new Graph({
    coordinator: COORD,
    nodes: [
      node(COORD, 'Coordinator'),
      node('0x00only', 'Router'),
      node('0x00leaf', 'EndDevice'),
      node('0x00ringa', 'Router'),
      node('0x00ringb', 'Router'),
    ],
    links: [
      link(COORD, '0x00only', 200, 1),
      link('0x00only', '0x00leaf', 200, 1),
      link(COORD, '0x00ringa', 200, 1),
      link(COORD, '0x00ringb', 200, 1),
      link('0x00ringa', '0x00ringb', 200, 2),
    ],
  });

  const chokes = g.chokePoints();
  const only = chokes.find((c) => c.ieee === '0x00only');
  check('the sole route to a leaf is a choke point', !!only);
  check('choke point counts what it would strand', only?.stranded === 1, `got ${only?.stranded}`);
  check(
    'a router with a redundant peer is not a choke point',
    !chokes.some((c) => c.ieee === '0x00ringa' || c.ieee === '0x00ringb')
  );
  check('the coordinator is never listed as a choke point', !chokes.some((c) => c.ieee === COORD));
}

/* ------------------------------------------------------------------ asymmetry */
{
  const g = new Graph({
    coordinator: COORD,
    nodes: [node(COORD, 'Coordinator'), node('0x00odd', 'Router'), node('0x00even', 'Router')],
    links: [
      link(COORD, '0x00odd', 200, 1),
      link('0x00odd', COORD, 30, 0), // same pair, wildly different both ways
      link(COORD, '0x00even', 180, 1),
      link('0x00even', COORD, 175, 0), // near enough to be normal
    ],
  });

  const asym = g.asymmetric();
  check('a lopsided link is reported', asym.some((a) => a.lo === 30 && a.hi === 200));
  check('a near-symmetric link is not reported', asym.length === 1, `got ${asym.length}`);
}

/* ------------------------------------------------------- robustness / weighting */
{
  const g = new Graph({});
  check('an empty topology does not throw', g.nodes.length === 0 && g.links.length === 0);

  const g2 = new Graph({
    coordinator: COORD,
    nodes: [node(COORD, 'Coordinator')],
    links: [link(COORD, '0x00ghost', 200, 1)],
  });
  check('links to unknown nodes are dropped', g2.links.length === 0);

  check('a strong link costs less than a weak one', hopCost(255) < hopCost(10));
  check('hop cost always includes a per-hop penalty', hopCost(255) >= 1);

  // A cycle in reported parents must not hang the walk.
  const g3 = new Graph({
    coordinator: COORD,
    nodes: [node(COORD, 'Coordinator'), node('0x00a', 'Router'), node('0x00b', 'Router')],
    links: [link('0x00a', '0x00b', 200, 1), link('0x00b', '0x00a', 200, 1)],
  });
  const route = g3.routeToCoordinator('0x00a');
  check('a parent cycle does not hang and reports no path', route.kind === 'none');
  // ...and the layout must survive the same cycle: everyone still gets a seat.
  assignHomes(g3);
  check(
    'a parent cycle still yields a seat for every node',
    g3.nodes.every((n) => Number.isFinite(n._hx) && Number.isFinite(n._hy))
  );
}

/* --------------------------------- what the map refuses to draw (accuracy) */
{
  // Every one of these rows occurs in real Zigbee neighbour tables, and every one
  // would draw something untrue.
  const g = new Graph({
    coordinator: COORD,
    nodes: [node(COORD, 'Coordinator'), node('0x00r', 'Router')],
    links: [
      link(COORD, COORD, 200, 2), // self-link
      link(COORD, '0x00r', 180, 1),
      link(COORD, '0x00r', 180, 1), // exact duplicate
      link(COORD, '0x00gone', 200, 1), // device that left the network
    ],
  });
  check('self-links are dropped', !g.links.some((l) => l.source === l.target));
  check('duplicate rows are dropped', g.links.length === 1, `kept ${g.links.length}`);
  check('rows for absent devices are dropped', !g.links.some((l) => l.target === '0x00gone'));

  // A row whose LQI was never measured must not read as a dead link.
  const u = new Graph({
    coordinator: COORD,
    nodes: [node(COORD, 'Coordinator'), node('0x00u', 'Router')],
    links: [link(COORD, '0x00u', null, 1)],
  });
  check('unmeasured LQI is its own band, not zero', lqiBand(null) === 'unknown');
  check('zero LQI is the worst measured band', lqiBand(0) === 'b1');
  check(
    'an unmeasured link still yields a usable path',
    u.routeToCoordinator('0x00u').hops.length === 1
  );
  check(
    'unmeasured links are excluded from asymmetry',
    new Graph({
      coordinator: COORD,
      nodes: [node(COORD, 'Coordinator'), node('0x00u', 'Router')],
      links: [link(COORD, '0x00u', null, 1), link('0x00u', COORD, 200, 0)],
    }).asymmetric().length === 0
  );

  // Bands must be monotonic, or the colour ramp lies about which link is worse.
  const order = ['b1', 'b2', 'b3', 'b4', 'b5'];
  const seq = [10, 50, 90, 150, 240].map(lqiBand);
  check('bands rise monotonically with LQI', seq.join(',') === order.join(','), seq.join(','));

  // The drawn tones are coarser on purpose, but must agree with the bands about
  // what is weak and what is unmeasured.
  check('unmeasured LQI draws as unknown, never as weak', linkTone(null) === 'unknown');
  check('a weak link draws saturated', linkTone(20) === 'weak');
  check('an ordinary link draws calm', linkTone(90) === 'mid' && linkTone(200) === 'strong');

  // A node with no links at all must never be reported as a choke point.
  const orphan = new Graph({
    coordinator: COORD,
    nodes: [node(COORD, 'Coordinator'), node('0x00lone', 'Router')],
    links: [],
  });
  check('an unconnected device is not a choke point', orphan.chokePoints().length === 0);
}

/* ------------------------------------------------- radial-tree layout targets */
//
// The layout is a pure function of the topology: coordinator at the origin,
// routers on rings by tree depth inside their parent's angular sector, end
// devices orbiting their parent router, unclaimed devices in an outer halo.
{
  const nodes = [node(COORD, 'Coordinator')];
  for (let r = 0; r < 4; r++) nodes.push(node(`0x00r${r}`, 'Router'));
  nodes.push(node('0x00deep', 'Router'));
  for (let e = 0; e < 8; e++) nodes.push(node(`0x00e${e}`, 'EndDevice'));
  nodes.push(node('0x00stray', 'EndDevice')); // nothing ever claims this one
  const links = [];
  for (let r = 0; r < 4; r++) links.push(link(`0x00r${r}`, COORD, 150, 1));
  links.push(link('0x00deep', '0x00r0', 140, 1)); // a router behind a router
  for (let e = 0; e < 6; e++) links.push(link(`0x00e${e}`, `0x00r${e % 3}`, 100, 1));
  links.push(link('0x00e6', '0x00deep', 100, 1));
  links.push(link('0x00e7', COORD, 100, 1)); // parented straight to the hub

  const g = new Graph({ coordinator: COORD, nodes, links });
  const { parentOf } = assignHomes(g);

  const coord = g.byIeee.get(COORD);
  check('the coordinator holds the origin', coord._hx === 0 && coord._hy === 0);
  const r0 = g.byIeee.get('0x00r0');
  const deep = g.byIeee.get('0x00deep');
  check('a first-hop router sits on ring one', r0._tier === 1 && r0._ringR > 0);
  check(
    'a router behind a router sits one ring further out',
    deep._tier === 2 && deep._ringR > r0._ringR
  );
  check(
    'a nested router stays inside its parent sector',
    (() => {
      const a = Math.atan2(r0._hy, r0._hx);
      const b = Math.atan2(deep._hy, deep._hx);
      const diff = Math.abs((((b - a) % (2 * Math.PI)) + 3 * Math.PI) % (2 * Math.PI) - Math.PI);
      return diff < 0.8;
    })()
  );
  const moon = g.byIeee.get('0x00e6');
  check(
    'an end device orbits its parent router',
    moon._orbit?.parent === '0x00deep' &&
      Math.hypot(moon._hx - deep._hx, moon._hy - deep._hy) <= moon._orbitR + 1
  );
  const hubMoon = g.byIeee.get('0x00e7');
  check('a coordinator-parented device orbits the hub', hubMoon._orbit?.parent === COORD);
  const stray = g.byIeee.get('0x00stray');
  check(
    'an unclaimed device sits in the outer halo',
    !stray._orbit && Math.hypot(stray._hx, stray._hy) > deep._ringR
  );
  check('the layout records the routing tree it drew', parentOf.get('0x00deep') === '0x00r0');

  // Determinism: the same topology must land the same way, twice.
  const g2 = new Graph({ coordinator: COORD, nodes, links });
  assignHomes(g2);
  check(
    'the same topology yields identical targets',
    g.nodes.every((n, i) => n._hx === g2.nodes[i]._hx && n._hy === g2.nodes[i]._hy)
  );

  // Edge classification: exactly the tree pairs are structure, the strongest row
  // represents a pair, and the rest is context.
  const pairs = classifyPairs(g, parentOf);
  const treeCount = [...pairs.values()].filter((p) => p.tree).length;
  check('every parent link is a tree pair', treeCount === 4 + 1 + 6 + 1 + 1, `got ${treeCount}`);
  const g3 = new Graph({
    coordinator: COORD,
    nodes: [node(COORD, 'Coordinator'), node('0x00r', 'Router')],
    links: [link('0x00r', COORD, 60, 1), link(COORD, '0x00r', 220, 0)],
  });
  const p3 = classifyPairs(g3, assignHomes(g3).parentOf);
  const only = [...p3.values()][0];
  check('one drawn edge per pair, strongest row wins', p3.size === 1 && only.link.lqi === 220);
  check('pair keys are direction-free', pairKey('b', 'a') === pairKey('a', 'b'));
}

/* --------------------------------------------------------- simulation behaviour */
{
  // The coordinator is pulled to the origin firmly enough to anchor the map.
  const g = new Graph({
    coordinator: COORD,
    nodes: [node(COORD, 'Coordinator'), node('0x00r', 'Router')],
    links: [link('0x00r', COORD, 150, 1)],
  });
  assignHomes(g);
  for (const n of g.nodes) {
    n._r = 9;
    n.x = n._hx + 200;
    n.y = n._hy + 120;
    n.vx = 0;
    n.vy = 0;
  }
  const sim = new Simulation(g);
  sim.setStructure([{ a: '0x00r', b: COORD, rest: 175, k: 0.05 }]);
  for (let i = 0; i < 300; i++) sim.step();
  const c = g.byIeee.get(COORD);
  check(
    'the coordinator is pulled back to the origin',
    Math.hypot(c.x, c.y) < 25,
    `ended ${Math.hypot(c.x, c.y).toFixed(1)} away`
  );

  // A pinned node is the operator's decision and must not be shoved aside.
  const pg = new Graph({
    coordinator: COORD,
    nodes: [node(COORD, 'Coordinator'), node('0x00pinned', 'Router')],
    links: [],
  });
  assignHomes(pg);
  for (const n of pg.nodes) {
    n._r = 9;
    n.x = 400;
    n.y = 300;
    n.vx = 0;
    n.vy = 0;
  }
  const held = pg.byIeee.get('0x00pinned');
  held.pinned = true;
  const sim2 = new Simulation(pg);
  sim2.setStructure([]);
  for (let i = 0; i < 60; i++) sim2.step();
  check('a pinned node keeps its position', held.x === 400 && held.y === 300);
  const other = pg.byIeee.get(COORD);
  check(
    'the unpinned node absorbs the whole gap',
    Math.hypot(other.x - held.x, other.y - held.y) >= 9 + 9 + NODE_CLEARANCE - 0.5
  );
}

/* ------------------------------------------------------------ the live element */
//
// The panel's exact no-cache flow: mount, `start` with every device and no links,
// one `device` event per probed router, then `done` with the full graph.

const FLEET_ROUTERS = 6;
const FLEET_ENDS = 24;
const fleet = () => {
  const nodes = [node(COORD, 'Coordinator')];
  for (let r = 0; r < FLEET_ROUTERS; r++) nodes.push(node(`0x00r${r}`, 'Router'));
  for (let e = 0; e < FLEET_ENDS; e++)
    nodes.push(node(`0x00e${e}`, 'EndDevice', { vendor: e === 0 ? 'Third Reality' : null }));
  return nodes;
};
const probeLinks = (r) => {
  const out = [link(`0x00r${r}`, COORD, r === 4 ? 30 : 170 - r * 6, 1)];
  for (let e = 0; e < FLEET_ENDS; e++)
    if (e % FLEET_ROUTERS === r) out.push(link(`0x00e${e}`, `0x00r${r}`, 110 - e, 1));
  out.push(link(`0x00r${(r + 1) % FLEET_ROUTERS}`, `0x00r${r}`, 90, 2));
  return out;
};
const fullLinks = () => {
  const out = [];
  for (let r = 0; r < FLEET_ROUTERS; r++) out.push(...probeLinks(r));
  return out;
};
const FLEET_SIZE = 1 + FLEET_ROUTERS + FLEET_ENDS;

const runScan = (el, { pumpBetween = 30 } = {}) => {
  el.applyScanEvent({
    phase: 'start',
    total: FLEET_ROUTERS + 1,
    coordinator: COORD,
    nodes: fleet(),
    streaming: true,
  });
  pumpFrames(pumpBetween);
  for (let r = 0; r < FLEET_ROUTERS; r++) {
    el.applyScanEvent({
      phase: 'device',
      ieee: `0x00r${r}`,
      name: `r${r}`,
      ok: true,
      links: probeLinks(r),
    });
    pumpFrames(pumpBetween);
  }
  el.applyScanEvent({
    phase: 'done',
    generated: 12345,
    coordinator: COORD,
    nodes: fleet(),
    links: fullLinks(),
  });
};

/* --- progressive reveal: the regression this file exists for --- */
{
  setStageRect({ width: 1200, height: 800 });
  const el = new Z2MNetworkMap();
  el.hass = {};
  el.connect();

  const startNodes = fleet();
  el.applyScanEvent({
    phase: 'start',
    total: FLEET_ROUTERS + 1,
    coordinator: COORD,
    nodes: startNodes,
    streaming: true,
  });

  // SYNCHRONOUS contract: before any animation frame, before any device event.
  check(
    'start synchronously hosts every device',
    el._gNodes.childNodes.length === FLEET_SIZE,
    `got ${el._gNodes.childNodes.length}`
  );
  check(
    'every node is placed before the first frame',
    [...el._gNodes.childNodes].every((n) => n.getAttribute('transform'))
  );
  check('the view is fitted before the first frame', !!el._viewport.getAttribute('transform'));
  check(
    'the caller\u2019s node objects are not annotated',
    startNodes.every((n) => n.x === undefined && n.failed.length === 0)
  );

  const coord = el._graph.byIeee.get(COORD);
  check(
    'the coordinator holds the world origin at start',
    Math.hypot(coord.x, coord.y) < 1,
    `at (${coord.x.toFixed(1)},${coord.y.toFixed(1)})`
  );
  // ...which the fitted view maps to the middle of the canvas.
  const m = el._viewport
    .getAttribute('transform')
    .match(/translate\(([-\d.]+) ([-\d.]+)\) scale\(([-\d.]+)\)/);
  const [vx, vy, k] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const sx = coord.x * k + vx;
  const sy = coord.y * k + vy;
  check(
    'the coordinator is centred on screen',
    Math.abs(sx - 600) < 120 && Math.abs(sy - 400) < 120,
    `screen (${sx.toFixed(0)},${sy.toFixed(0)})`
  );

  check(
    'everything except the coordinator starts pending',
    [...el._nodeEls.values()].filter((e) => e.g.classList.contains('pending')).length ===
      FLEET_SIZE - 1
  );

  // First paint happens NOW, not after the walk: within a couple of frames the
  // coordinator is already fading in, and no frame ever waits on a device event.
  pumpFrames(2);
  const coordEls = el._nodeEls.get(COORD);
  check(
    'first paint precedes any device event',
    Number(coordEls.g.style.opacity) > 0 || coordEls.g.style.opacity === '',
    `coordinator opacity ${coordEls.g.style.opacity}`
  );
  pumpFrames(45);
  check(
    'the whole fleet is visible within the reveal ripple',
    [...el._nodeEls.values()].every(
      (e) => e.g.style.opacity === '' || Number(e.g.style.opacity) > 0.9
    )
  );

  // A device event attaches its links immediately -- one sync, no `done` needed.
  el.applyScanEvent({ phase: 'device', ieee: '0x00r0', name: 'r0', ok: true, links: probeLinks(0) });
  const drawn = el._gLinks.childNodes.length + el._gPeers.childNodes.length;
  check('a device event attaches its links synchronously', drawn === probeLinks(0).length, `got ${drawn}`);
  check(
    'a probed router stops being pending',
    !el._nodeEls.get('0x00r0').g.classList.contains('pending')
  );
  check(
    'devices named by the new links stop being pending',
    !el._nodeEls.get('0x00e0').g.classList.contains('pending')
  );
  check(
    'unheard devices stay pending',
    el._nodeEls.get('0x00e1').g.classList.contains('pending')
  );

  // A failure is progress too, and it is drawn as a warning, not hidden.
  el.applyScanEvent({ phase: 'device', ieee: '0x00r5', name: 'r5', ok: false, error: 'timeout' });
  check(
    'a failed probe still clears pending and draws its ring',
    !el._nodeEls.get('0x00r5').g.classList.contains('pending') &&
      el._nodeEls.get('0x00r5').warn.style.display === ''
  );

  for (let r = 1; r < FLEET_ROUTERS; r++) {
    el.applyScanEvent({ phase: 'device', ieee: `0x00r${r}`, name: `r${r}`, ok: true, links: probeLinks(r) });
    pumpFrames(20);
  }

  // `done` reconciles by ieee: nothing teleports, nothing is dropped.
  pumpFrames(30);
  const before = new Map(el._graph.nodes.map((n) => [n.ieee, { x: n.x, y: n.y }]));
  const viewBefore = el._viewport.getAttribute('transform');
  // The real backend re-marks devices that failed the walk in the final node
  // list (coordinator.py result_nodes), so the done event carries the failure.
  el.applyScanEvent({
    phase: 'done',
    generated: 777,
    coordinator: COORD,
    nodes: fleet().map((n) => (n.ieee === '0x00r5' ? { ...n, failed: ['lqi'] } : n)),
    links: fullLinks(),
  });
  check('done keeps every node', el._gNodes.childNodes.length === FLEET_SIZE);
  const jump = Math.max(
    ...el._graph.nodes.map((n) => {
      const b = before.get(n.ieee);
      return b ? Math.hypot(n.x - b.x, n.y - b.y) : Infinity;
    })
  );
  check('done does not teleport a single node', jump < 0.01, `max jump ${jump.toFixed(2)}`);
  check('done clears every pending mark', ![...el._nodeEls.values()].some((e) => e.g.classList.contains('pending')));
  check('done ends the scan', el._scan.scanning === false && el._scan.generated === 777);
  pumpFrames(30);
  check(
    'the view glides to the settled graph instead of jump-cutting',
    el._viewport.getAttribute('transform') !== viewBefore
  );

  /* --- diagnostics still fire on the streamed graph --- */
  check('weak links are counted in the legend', /<b>\d+<\/b> weak/.test(el._legend.innerHTML));
  check('single-path routers are counted', /single-path/.test(el._legend.innerHTML));
  check('the failed device is counted as no reply', /no reply/.test(el._legend.innerHTML));

  /* --- search still narrows and highlights --- */
  el._searchEl.value = 'Third Reality';
  el._searchEl.listeners('input')[0]();
  check('search matches vendor text', el._matches?.size === 1 && el._matches.has('0x00e0'));
  check('search hits are reported', el._hitsEl.textContent === `1/${FLEET_SIZE}`);
  check('the match is highlighted', el._nodeEls.get('0x00e0').g.classList.contains('match'));
  check('non-matches recede', el._nodeEls.get('0x00r1').g.classList.contains('dim'));
  el._searchEl.value = '';
  el._searchEl.listeners('input')[0]();
  check('clearing the search restores everyone', !el._nodeEls.get('0x00r1').g.classList.contains('dim'));

  /* --- selection: route trace and the detail card --- */
  el._select('0x00e5');
  check(
    'selecting a device opens its detail card',
    el._detail.hidden === false && el._detail.innerHTML.includes('e5')
  );
  check(
    'the route home is traced on the canvas',
    [...el._linkEls.values()].some((e) => e.el.classList.contains('route'))
  );
  check('the trace is named for what it is', el._detail.innerHTML.includes('parent chain'));
  check(
    'everything off the route recedes',
    el._nodeEls.get('0x00e1').g.classList.contains('dim')
  );
  el._select(null);
  check('clearing the selection closes the card', el._detail.hidden === true);
  check(
    'clearing the selection restores the map',
    !el._nodeEls.get('0x00e1').g.classList.contains('dim')
  );

  /* --- peer links: hidden by default, faint context on request --- */
  check('context links default to hidden', el._svg.classList.contains('hide-peers'));
  check('the toggle starts unpressed', src.includes('data-act="peers" aria-pressed="false"'));
  const peerBtn = el._hudRight.querySelector('button');
  el._action('peers', peerBtn);
  check('the toggle reveals context links', !el._svg.classList.contains('hide-peers'));
  el._action('peers', peerBtn);
  check('the toggle hides them again', el._svg.classList.contains('hide-peers'));
  check(
    'sibling rows are context, parent rows are structure',
    el._gPeers.childNodes.length > 0 &&
      el._gLinks.childNodes.length > el._gPeers.childNodes.length
  );
  check(
    'a traced route survives the peer toggle',
    src.includes('svg.hide-peers .link.peer:not(.route)')
  );

  /* --- the map's own Re-scan control --- */
  let rescans = 0;
  el.addEventListener('z2m-rescan', () => rescans++);
  el._action('rescan', null);
  check('the Re-scan control emits z2m-rescan', rescans === 1);

  /* --- labels: landmarks always named, end devices never overlap --- */
  settleLoops();
  const routerCulled = [...el._nodeEls.entries()].filter(
    ([ieee, e]) =>
      (ieee === COORD || el._graph.byIeee.get(ieee).type === 'Router') &&
      e.g.classList.contains('crowded')
  );
  check('coordinator and router labels are never culled', routerCulled.length === 0);
}

/* --- regression: a host measured at 0x0 must not wedge the view --- */
//
// The old build fitted the view exactly once, against whatever rect the stage had
// at first sync. A hidden or mid-layout host measures 0x0, the fit clamped to a
// corner sliver, resize never refitted, and the only later fit ran 900ms AFTER the
// scan finished: blank canvas for the whole walk, then everything at once.
{
  setStageRect({ width: 0, height: 0 });
  const el = new Z2MNetworkMap();
  el.connect();
  el.applyScanEvent({
    phase: 'start',
    total: 3,
    coordinator: COORD,
    nodes: fleet(),
    streaming: true,
  });
  pumpFrames(3);
  check('a degenerate rect defers the fit instead of wedging it', el._needsFit === true);
  check('the world is laid out regardless of the rect', el._gNodes.childNodes.length === FLEET_SIZE);
  setStageRect({ width: 1200, height: 800 });
  el._resize(); // what the ResizeObserver delivers when the host becomes visible
  check('the first real size fits the view immediately', el._needsFit === false);
  const m = el._viewport.getAttribute('transform').match(/scale\(([-\d.]+)\)/);
  check(
    'the recovered view actually frames the graph',
    m && Number(m[1]) > 0.3,
    `scale ${m && m[1]}`
  );
}

/* --- regression: streamed events must survive detachment --- */
//
// The panel re-hosts the element across renders. The old build returned early from
// applyScanEvent when isConnected was false, so events during any detached moment
// were discarded forever -- a lost `start` blanked the whole scan.
{
  setStageRect({ width: 1200, height: 800 });
  const el = new Z2MNetworkMap();
  el.applyScanEvent({
    phase: 'start',
    total: 3,
    coordinator: COORD,
    nodes: fleet(),
    streaming: true,
  });
  el.applyScanEvent({ phase: 'device', ieee: '0x00r0', name: 'r0', ok: true, links: probeLinks(0) });
  check(
    'events before connect are ingested, not dropped',
    el._live?.nodes.length === FLEET_SIZE && el._live.links.length === probeLinks(0).length
  );
  el.connect();
  check(
    'connect draws everything that streamed while detached',
    el._gNodes.childNodes.length === FLEET_SIZE &&
      el._gLinks.childNodes.length + el._gPeers.childNodes.length === probeLinks(0).length
  );

  el.disconnect();
  el.applyScanEvent({ phase: 'device', ieee: '0x00r1', name: 'r1', ok: true, links: probeLinks(1) });
  el.connect();
  check(
    'events while detached are drawn on re-connect',
    el._gLinks.childNodes.length + el._gPeers.childNodes.length ===
      new Set([...probeLinks(0), ...probeLinks(1)].map((l) => pairKey(l.source, l.target))).size
  );
}

/* --- determinism: two elements fed the same stream settle identically --- */
{
  setStageRect({ width: 1200, height: 800 });
  const el1 = new Z2MNetworkMap();
  el1.connect();
  runScan(el1);
  settleLoops();
  const el2 = new Z2MNetworkMap();
  el2.connect();
  runScan(el2);
  settleLoops();
  const maxDiff = Math.max(
    ...el2._graph.nodes.map((n) => {
      const m = el1._graph.byIeee.get(n.ieee);
      return Math.hypot(n.x - m.x, n.y - m.y);
    })
  );
  check('two opens of the same scan look the same', maxDiff < 0.001, `diff ${maxDiff.toFixed(4)}`);

  // And the settled picture honours the hierarchy it promises.
  const g = el1._graph;
  const cd = g.byIeee.get(COORD);
  check('the settled coordinator stays centred', Math.hypot(cd.x, cd.y) < 30);
  let clustered = 0;
  for (const n of g.nodes) {
    if (!n._orbit) continue;
    const p = g.byIeee.get(n._orbit.parent);
    if (Math.hypot(n.x - p.x, n.y - p.y) < 130) clustered++;
  }
  check(
    'end devices stay clustered around their routers',
    clustered === FLEET_ENDS,
    `${clustered}/${FLEET_ENDS}`
  );
  let worstGap = Infinity;
  for (let i = 0; i < g.nodes.length; i++)
    for (let j = i + 1; j < g.nodes.length; j++) {
      const a = g.nodes[i];
      const b = g.nodes[j];
      worstGap = Math.min(
        worstGap,
        Math.hypot(b.x - a.x, b.y - a.y) - (a._r + b._r + NODE_CLEARANCE)
      );
    }
  check('the settled fleet keeps drawable separation', worstGap >= -0.5, `worst ${worstGap.toFixed(1)}`);
}

/* ------------------------------------------------------- label and semantics */
{
  check('a long name is truncated for the canvas',
    labelText('Master Bedroom Ceiling Fan Light').length <= 18);
  check('truncation is marked, not silent',
    labelText('Master Bedroom Ceiling Fan Light').endsWith('\u2026'));
  check('a short name is left alone', labelText('Porch Sensor') === 'Porch Sensor');

  // Names are shown for EVERY device. Hiding them is a per-label collision
  // decision made at runtime, never a rule about the device's type.
  check('end devices are not hidden by type', !/\.node\.enddevice text\.label \{[^}]*display:none/
    .test(src));
  check('crowding is what hides a label', src.includes('.node.crowded text.label { display:none; }'));

  // Calm palette: no five-colour rainbow across every edge. The tree is drawn in
  // the theme's own ink; saturated colour is reserved for weak links.
  check('edges are no longer rainbow-banded', !src.includes('.link.b5') && !src.includes('.link.b4'));
  check('weak tree links keep the alarm colour',
    /\.link\.tree\.weak \{[^}]*--error-color/.test(src));
  check('context links are faint by design', /\.link\.peer \{[^}]*opacity:\.1\d/.test(src));
  check('pending devices are faded, never hidden', /\.node\.pending \{ opacity:/.test(src));

  // The red ring around powered routers stays gone: it marked a snapshot property
  // as if it were a device fault.
  check('no dependency ring is drawn', !src.includes('choke-ring'));
  check('the dependency fact survives as words', src.includes('Only route: in this scan'));
  // Parked bottom-right on desktop and tablet, opposite the legend, so it never
  // moves under the pointer; a phone gets a bottom sheet instead.
  check('the inspector is anchored bottom-right', /\.detail \{ position:absolute; right:8px; bottom:8px;/
    .test(src));
  check('a phone gets a bottom sheet', /@media \(max-width:\$\{NARROW_PX\}px\)[\s\S]*?\.detail \{[^}]*bottom:0/
    .test(src) && NARROW_PX === 600);
  check('no per-frame repositioning remains', !src.includes('_positionDetail'));
  // Closable from the keyboard as well as the pointer.
  check('the close affordance is a real button',
    src.includes('<button class="close" type="button" aria-label="Clear selection">'));
  check('nodes are keyboard reachable', src.includes("g.setAttribute('tabindex', '0')"));
  check('Escape clears the selection', src.includes("ev.key === 'Escape'"));
  check('the element observes its own size', src.includes('ResizeObserver'));
  check('there is a phone layout', src.includes('@media (max-width:'));
  // The one delayed fit that caused the pop is gone for good.
  check('no timer-deferred fit remains', !/setTimeout\([^)]*_fit/.test(src));
}

console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
