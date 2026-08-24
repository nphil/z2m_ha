/**
 * Zigbee network map.
 *
 * Defines two elements:
 *   <z2m-network-map>  the map, used by the panel's map view
 *   <z2m-map-card>     a Lovelace card wrapper, so the map works on a dashboard
 *
 * Dependency-free on purpose: the force simulation, the SVG rendering and the
 * gesture handling are local. At tens of nodes an O(n^2) repulsion pass is a few
 * thousand cheap operations per frame, so a quadtree would be complexity with
 * nothing to show for it. Everything visual uses Home Assistant's own CSS custom
 * properties, so themes and dark mode are inherited rather than reimplemented.
 *
 * This map is used to decide where to put hardware, so it is built to a rule: never
 * draw a claim the data does not support.
 *   - An end device's parent chain is authoritative. End devices transmit only to
 *     their parent, and the neighbour tables name it.
 *   - A router's path is NOT knowable from a snapshot; the mesh routes dynamically.
 *     Those paths are marked inferred.
 *   - A neighbour row with no usable LQI is drawn as unknown, never as zero. A dead
 *     link and an unmeasured one look different, because they mean different things.
 */

const STORE_KEY = 'z2m-map-layout-v2';

// Zigbee neighbour-table relationship codes. Z2M drops rows above 3.
//
// DIRECTION MATTERS AND IS EASY TO GET BACKWARDS. In Z2M's networkmap a row reads
// "TARGET's neighbour table contains SOURCE": `target` is the device that was
// queried, `source` is the neighbour it reported. Proven on a live network rather
// than assumed -- only the coordinator and routers are ever queried, and across 190
// rows an end device appeared as `source` 28 times and as `target` exactly 0 times,
// which is only possible if `target` is the table's owner. So a rel=1 ("source is
// my child") row means the PARENT is `target`, and a rel=0 ("source is my parent")
// row means the parent is `source`.
//
// Inverting this does not merely mislabel: it produces routes in which a mains
// router reaches the coordinator through a battery sensor, which cannot happen.
const REL_PARENT = 0;
const REL_CHILD = 1;
const REL_SIBLING = 2;

// Below this, a link is treated as marginal. Measured on this network rather than
// chosen: links under ~45 were the ones that timed out under load.
const WEAK_LQI = 45;

const ICON = {
  zoomIn: 'M15.5 14h-.79l-.28-.27A6.47 6.47 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19zm-6 0A4.5 4.5 0 1 1 14 9.5 4.49 4.49 0 0 1 9.5 14M12 10h-2v2H9v-2H7V9h2V7h1v2h2z',
  zoomOut: 'M15.5 14h-.79l-.28-.27A6.47 6.47 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19zm-6 0A4.5 4.5 0 1 1 14 9.5 4.49 4.49 0 0 1 9.5 14M7 9h5v1H7z',
  fit: 'M5 5h5V3H3v7h2zm9-2v2h5v5h2V3zM19 19h-5v2h7v-7h-2zM10 19H5v-5H3v7h7z',
  peers: 'M2 12h4v2H2zm6 0h4v2H8zm6 0h4v2h-4zm6 0h2v2h-2z',
  pause: 'M14 19h4V5h-4M6 19h4V5H6z',
  play: 'M8 5.14v14l11-7z',
  search: 'M9.5 3A6.5 6.5 0 0 1 16 9.5c0 1.61-.59 3.09-1.56 4.23l.27.27h.79l5 5-1.5 1.5-5-5v-.79l-.27-.27A6.5 6.5 0 1 1 9.5 3m0 2A4.5 4.5 0 1 0 14 9.5 4.5 4.5 0 0 0 9.5 5',
  rescan: 'M17.65 6.35A8 8 0 1 0 19.73 14h-2.08A6 6 0 1 1 12 6a5.9 5.9 0 0 1 4.22 1.78L13 11h7V4z',
};

const svgEl = (name, attrs = {}) => {
  const el = document.createElementNS('http://www.w3.org/2000/svg', name);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
};

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/**
 * A neighbour row can arrive with no LQI at all: the radio never rated that link.
 * Treating it as 0 would make the layout and the path finder behave as if it were
 * the worst link on the mesh, and treating it as 255 would make it the best. Both
 * are inventions. It is scored as mid so it neither attracts nor repels a traced
 * route, and it is drawn in its own band so it never reads as a measurement.
 */
const UNRATED_LQI = 128;

/** Spring rest length: a strong link sits closer to its peer than a weak one. */
const restLength = (lqi) => 62 + (1 - clamp(lqi ?? UNRATED_LQI, 0, 255) / 255) * 128;

/**
 * Per-hop cost for path finding. The constant term keeps the search honest about hop
 * count: without it, five great links beat one decent direct link, which is not how
 * you want to read a mesh.
 */
const hopCost = (lqi) => 1 + ((255 - clamp(lqi ?? UNRATED_LQI, 0, 255)) / 255) * 3;

/**
 * Five bands rather than three. When the question is "is this link the problem",
 * the difference between 60 and 110 matters, and a coarse ramp hides it.
 */
const lqiBand = (lqi) => {
  if (lqi === null || lqi === undefined) return 'unknown';
  if (lqi >= 200) return 'b5';
  if (lqi >= 120) return 'b4';
  if (lqi >= 70) return 'b3';
  if (lqi >= WEAK_LQI) return 'b2';
  return 'b1';
};

const ago = (epochSeconds) => {
  if (!epochSeconds) return null;
  const secs = Math.max(0, Date.now() / 1000 - epochSeconds);
  if (secs < 90) return 'just now';
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.round(hours / 24)} d ago`;
};

const linkKey = (l) => `${l.source}|${l.target}|${l.relationship}`;

function escapeHtml(value) {
  return String(value ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );
}

/* ------------------------------------------------------------------ topology */

class Graph {
  constructor(topology) {
    this.coordinator = topology?.coordinator || null;
    this.nodes = (topology?.nodes || []).map((n) => ({ ...n }));
    this.byIeee = new Map(this.nodes.map((n) => [n.ieee, n]));

    this.links = [];
    const seen = new Set();
    for (const l of topology?.links || []) {
      // Drop rows we cannot place, self-links, and exact duplicates. All three occur
      // in real neighbour tables and all three would draw something untrue.
      if (!this.byIeee.has(l.source) || !this.byIeee.has(l.target)) continue;
      if (l.source === l.target) continue;
      const key = linkKey(l);
      if (seen.has(key)) continue;
      seen.add(key);
      this.links.push(l);
    }

    this.adj = new Map(this.nodes.map((n) => [n.ieee, []]));
    for (const l of this.links) {
      this.adj.get(l.source).push(l);
      this.adj.get(l.target).push(l);
    }

    this.parent = new Map();
    for (const l of this.links) {
      if (l.relationship === REL_CHILD) this.parent.set(l.source, l.target);
      else if (l.relationship === REL_PARENT) this.parent.set(l.target, l.source);
    }

    this.depth = this._depths();
  }

  other(link, ieee) {
    return link.source === ieee ? link.target : link.source;
  }

  /** Hop distance from the coordinator, ignoring quality. Drives the layout rings. */
  _depths() {
    const depth = new Map();
    if (!this.coordinator || !this.byIeee.has(this.coordinator)) return depth;
    depth.set(this.coordinator, 0);
    const queue = [this.coordinator];
    while (queue.length) {
      const at = queue.shift();
      for (const link of this.adj.get(at) || []) {
        const next = this.other(link, at);
        if (!depth.has(next)) {
          depth.set(next, depth.get(at) + 1);
          queue.push(next);
        }
      }
    }
    return depth;
  }

  linkBetween(a, b) {
    let found = null;
    for (const link of this.adj.get(a) || []) {
      if (this.other(link, a) !== b) continue;
      if (!found || (link.lqi ?? -1) > (found.lqi ?? -1)) found = link;
    }
    return found;
  }

  /**
   * Route from a device to the coordinator.
   * kind 'parent'   - every hop is a reported parent relationship: how traffic
   *                   really leaves an end device.
   * kind 'inferred' - the tree was incomplete; strongest path by link quality.
   */
  routeToCoordinator(ieee) {
    const viaParents = this._parentChain(ieee);
    if (viaParents) return { hops: viaParents, kind: 'parent' };
    const best = this._strongestPath(ieee);
    return best ? { hops: best, kind: 'inferred' } : { hops: [], kind: 'none' };
  }

  _parentChain(ieee) {
    const hops = [];
    const seen = new Set([ieee]);
    let at = ieee;
    while (at !== this.coordinator) {
      const up = this.parent.get(at);
      if (!up || seen.has(up)) return null;
      const link = this.linkBetween(at, up);
      hops.push({ from: at, to: up, lqi: link ? link.lqi : null });
      seen.add(up);
      at = up;
      if (hops.length > this.nodes.length) return null;
    }
    return hops.length ? hops : null;
  }

  _strongestPath(ieee) {
    if (!this.coordinator || !this.byIeee.has(ieee)) return null;
    const dist = new Map([[ieee, 0]]);
    const prev = new Map();
    const pending = new Set(this.byIeee.keys());

    while (pending.size) {
      let at = null;
      let best = Infinity;
      for (const candidate of pending) {
        const d = dist.get(candidate);
        if (d !== undefined && d < best) {
          best = d;
          at = candidate;
        }
      }
      if (at === null) break;
      if (at === this.coordinator) break;
      pending.delete(at);
      for (const link of this.adj.get(at) || []) {
        const next = this.other(link, at);
        if (!pending.has(next)) continue;
        const cost = best + hopCost(link.lqi);
        if (cost < (dist.get(next) ?? Infinity)) {
          dist.set(next, cost);
          prev.set(next, { from: at, lqi: link.lqi });
        }
      }
    }

    if (!prev.has(this.coordinator)) return null;
    const hops = [];
    let at = this.coordinator;
    while (at !== ieee) {
      const step = prev.get(at);
      if (!step) return null;
      hops.unshift({ from: step.from, to: at, lqi: step.lqi });
      at = step.from;
    }
    return hops.length ? hops : null;
  }

  /**
   * Routers whose loss would strand other devices, and how many.
   *
   * This is the question worth asking of a mesh. A weak link with a spare route
   * beside it is not a problem; a strong link everything depends on is.
   */
  chokePoints() {
    if (!this.coordinator) return [];
    const reachable = (skip) => {
      const seen = new Set([this.coordinator]);
      const queue = [this.coordinator];
      while (queue.length) {
        const at = queue.shift();
        for (const link of this.adj.get(at) || []) {
          const next = this.other(link, at);
          if (next === skip || seen.has(next)) continue;
          seen.add(next);
          queue.push(next);
        }
      }
      return seen;
    };
    const baseline = reachable(null).size;
    const out = [];
    for (const node of this.nodes) {
      if (node.ieee === this.coordinator) continue;
      if (!(this.adj.get(node.ieee) || []).length) continue;
      const stranded = baseline - 1 - reachable(node.ieee).size;
      if (stranded > 0) out.push({ ieee: node.ieee, name: node.name, stranded });
    }
    return out.sort((a, b) => b.stranded - a.stranded);
  }

  /** Links whose two directions disagree badly: real, and invisible on a plain map. */
  asymmetric() {
    const pairs = new Map();
    for (const l of this.links) {
      if (l.lqi === null || l.lqi === undefined) continue;
      const key = [l.source, l.target].sort().join('|');
      let list = pairs.get(key);
      if (!list) pairs.set(key, (list = []));
      list.push(l.lqi);
    }
    const out = [];
    for (const [key, list] of pairs) {
      if (list.length < 2) continue;
      const lo = Math.min(...list);
      const hi = Math.max(...list);
      if (hi - lo >= 40) {
        const [a, b] = key.split('|');
        out.push({ a, b, lo, hi });
      }
    }
    return out;
  }
}

/* ------------------------------------------------------------------- physics */

class Simulation {
  constructor(graph, width, height) {
    this.graph = graph;
    this.alpha = 1;
    this.resize(width, height);
  }

  resize(width, height) {
    this.width = Math.max(width || 0, 320);
    this.height = Math.max(height || 0, 240);
    this.cx = this.width / 2;
    this.cy = this.height / 2;
  }

  reheat(to = 0.7) {
    this.alpha = Math.max(this.alpha, to);
  }

  step() {
    const nodes = this.graph.nodes;
    const alpha = this.alpha;
    if (alpha < 0.005) return false;

    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i];
      for (let j = i + 1; j < nodes.length; j++) {
        const b = nodes[j];
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let d2 = dx * dx + dy * dy;
        if (d2 === 0) {
          dx = (i - j) * 0.5 + 0.5;
          dy = 0.5;
          d2 = dx * dx + dy * dy;
        }
        if (d2 > 360000) continue;
        const d = Math.sqrt(d2);
        const force = 6400 / d2;
        const fx = (dx / d) * force;
        const fy = (dy / d) * force;
        a.vx -= fx;
        a.vy -= fy;
        b.vx += fx;
        b.vy += fy;

        // Hard collision. Repulsion alone leaves nodes sitting on top of each other
        // once springs pull a hub's children inward, which is what made the map look
        // messy. This guarantees a minimum gap regardless of the force balance.
        const minGap = (a._r || 8) + (b._r || 8) + 12;
        if (d < minGap) {
          const push = (minGap - d) / 2;
          const ux = dx / d;
          const uy = dy / d;
          if (!a.dragging && !a.pinned) {
            a.x -= ux * push;
            a.y -= uy * push;
          }
          if (!b.dragging && !b.pinned) {
            b.x += ux * push;
            b.y += uy * push;
          }
        }
      }
    }

    for (const link of this.graph.links) {
      const a = this.graph.byIeee.get(link.source);
      const b = this.graph.byIeee.get(link.target);
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 0.01;
      const rest = restLength(link.lqi);
      // Parent/child links describe real structure, so they pull harder than a
      // sibling row. That makes the drawn hierarchy match the actual one.
      const structural = link.relationship === REL_CHILD || link.relationship === REL_PARENT;
      const stiffness =
        (structural ? 0.05 : 0.012) + (clamp(link.lqi ?? 0, 0, 255) / 255) * 0.03;
      const push = (d - rest) * stiffness;
      const fx = (dx / d) * push;
      const fy = (dy / d) * push;
      a.vx += fx;
      a.vy += fy;
      b.vx -= fx;
      b.vy -= fy;
    }

    for (const node of nodes) {
      const isCoord = node.ieee === this.graph.coordinator;
      const pull = isCoord ? 0.07 : 0.006;
      node.vx += (this.cx - node.x) * pull;
      node.vy += (this.cy - node.y) * pull;
    }

    let moved = 0;
    for (const node of nodes) {
      if (node.dragging) {
        node.vx = 0;
        node.vy = 0;
        continue;
      }
      if (node.pinned) {
        node.vx *= 0.5;
        node.vy *= 0.5;
        continue;
      }
      node.vx *= 0.82;
      node.vy *= 0.82;
      const dx = node.vx * alpha;
      const dy = node.vy * alpha;
      node.x += dx;
      node.y += dy;
      const pad = (node._r || 8) + 14;
      node.x = clamp(node.x, pad, this.width - pad);
      node.y = clamp(node.y, pad, this.height - pad);
      moved += Math.abs(dx) + Math.abs(dy);
    }

    this.alpha *= 0.987;
    return moved > 0.4 || alpha > 0.05;
  }
}

/* -------------------------------------------------------------- the element */

class Z2MNetworkMap extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._topology = null;
    this._graph = null;
    this._sim = null;
    this._hass = null;
    this._diagnostics = true;
    this._reveal = false;
    this._showPeers = true;
    this._frozen = false;
    this._query = '';
    this._matches = null;
    this._selected = null;
    this._hovered = null;
    this._scan = { generated: null, scanning: false, phase: null, done: 0, total: 0 };
    this._view = { x: 0, y: 0, k: 1 };
    this._raf = null;
    this._nodeEls = new Map();
    this._linkEls = new Map();
    this._pos = new Map();
    this._pulses = [];
    this._live = null;
    this._reduceMotion =
      window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this._onResize = () => this._resize();
  }

  set hass(value) {
    this._hass = value;
  }

  set topology(value) {
    this._topology = value;
    this._live = value ? { ...value, links: [...(value.links || [])] } : null;
    if (value?.generated) this._scan.generated = value.generated;
    if (this.isConnected) this._sync({ animate: this._reveal });
    this._reveal = false;
  }

  get topology() {
    return this._topology;
  }

  set diagnostics(value) {
    this._diagnostics = !!value;
    if (this.isConnected && this._graph) this._sync({ animate: false });
  }

  set reveal(value) {
    this._reveal = !!value;
  }

  set scan(value) {
    this._scan = { ...this._scan, ...(value || {}) };
    if (this.isConnected) this._renderHud();
  }

  connectedCallback() {
    if (!this.shadowRoot.firstChild) this._scaffold();
    window.addEventListener('resize', this._onResize);
    this._loadLayout();
    if (this._live) this._sync({ animate: false });
    this._renderHud();
  }

  disconnectedCallback() {
    window.removeEventListener('resize', this._onResize);
    this._stopLoop();
    this._saveLayout();
  }

  /**
   * Consume one event from a streaming scan.
   *
   * The point of streaming: `start` puts every device on screen before any radio
   * traffic, then each `device` event attaches that device's links, and the
   * simulation pulls the children into place. Nothing ever says "please wait".
   */
  applyScanEvent(event) {
    if (!event || !this.isConnected) return;
    if (event.phase === 'start') {
      this._live = { coordinator: event.coordinator, nodes: event.nodes || [], links: [] };
      this._scan = {
        ...this._scan,
        scanning: true,
        phase: 'start',
        done: 0,
        total: event.total || 0,
      };
      this._sync({ animate: true });
    } else if (event.phase === 'device') {
      if (!this._live) return;
      this._scan = { ...this._scan, done: this._scan.done + 1, phase: 'device' };
      if (event.ok && event.links?.length) {
        const known = new Set(this._live.links.map(linkKey));
        for (const l of event.links) if (!known.has(linkKey(l))) this._live.links.push(l);
        this._sync({ animate: true });
      } else if (!event.ok) {
        const node = this._live.nodes.find((n) => n.ieee === event.ieee);
        if (node) node.failed = [...(node.failed || []), event.error || 'no reply'];
        this._sync({ animate: false });
      }
    } else if (event.phase === 'done') {
      this._scan = { ...this._scan, scanning: false, phase: 'done', generated: event.generated };
      this._topology = event;
      this._live = { ...event, links: [...(event.links || [])] };
      this._sync({ animate: true });
      // The layout moves a long way between "ring of unconnected devices" and the
      // settled mesh, so refit once at the end -- unless the operator has zoomed or
      // panned, in which case their view is theirs.
      if (!this._userMoved) setTimeout(() => this._fit(), 900);
    } else if (event.phase === 'error') {
      this._scan = { ...this._scan, scanning: false, phase: 'error' };
    }
    this._renderHud();
  }

  /* ---------------------------------------------------------------- markup */

  _scaffold() {
    const style = document.createElement('style');
    style.textContent = `
      :host { display:block; position:relative; width:100%; height:100%;
              min-height:320px; contain:layout paint; }
      .stage { position:absolute; inset:0; overflow:hidden;
               background:var(--card-background-color, #fff);
               touch-action:none; cursor:grab; }
      .stage.panning { cursor:grabbing; }
      svg { display:block; width:100%; height:100%; }

      /* Five LQI bands: at troubleshooting time the gap between 60 and 110 matters. */
      .link { stroke-width:1.6; fill:none; transition:opacity .18s ease; }
      .link.b5 { stroke:var(--success-color, #4caf50); opacity:.6; }
      .link.b4 { stroke:#7cb342; opacity:.55; }
      .link.b3 { stroke:var(--warning-color, #ff9800); opacity:.55; }
      .link.b2 { stroke:#ef6c00; opacity:.55; }
      .link.b1 { stroke:var(--error-color, #f44336); opacity:.6; }
      .link.unknown { stroke:var(--disabled-text-color, #bdbdbd);
                      stroke-dasharray:1 5; opacity:.5; }
      .link.peer { stroke-dasharray:3 4; opacity:.22; }
      .link.dim { opacity:.1; }
      .link.route { stroke:var(--primary-color, #03a9f4); stroke-width:3.4;
                    opacity:1; stroke-linecap:round; stroke-dasharray:none; }
      svg.hide-peers .link.peer { display:none; }

      .node { cursor:pointer; }
      .halo { fill:none; stroke:var(--primary-color,#03a9f4); stroke-width:2.5;
              opacity:0; transition:opacity .18s ease; }
      .node.on-route .halo, .node.selected .halo, .node.match .halo { opacity:1; }
      .node.match .halo { stroke:var(--accent-color, #ff9800); }
      .body { stroke:var(--card-background-color,#fff); stroke-width:2; }
      .node.coordinator .body { fill:var(--primary-color, #03a9f4); }
      .node.router .body { fill:var(--state-icon-color, #44739e); }
      .node.enddevice .body { fill:var(--secondary-text-color, #727272); }
      .node.offline .body { fill:var(--card-background-color,#fff);
                            stroke:var(--error-color,#f44336);
                            stroke-dasharray:3 3; }
      /* Dimmed context stays readable. Fading it away made one route obvious but
         destroyed the shape of the mesh around it, which is why you opened the map. */
      .node.dim { opacity:.3; }
      .warn-ring { fill:none; stroke:var(--warning-color,#ff9800); stroke-width:2;
                   stroke-dasharray:2 3; }
      .choke-ring { fill:none; stroke:var(--error-color,#f44336); stroke-width:1.6;
                    opacity:.8; }
      .pin-dot { fill:var(--primary-text-color,#212121); opacity:.5; }

      text.label { font-size:11px; text-anchor:middle;
                   fill:var(--primary-text-color, #212121);
                   paint-order:stroke; stroke:var(--card-background-color,#fff);
                   stroke-width:3px; stroke-linejoin:round;
                   pointer-events:none; user-select:none; }
      /* 45 labels at once is unreadable, so only structural nodes are named by
         default. An end device names itself on hover, selection, route or search. */
      .node.enddevice text.label { display:none; }
      .node.enddevice.hover text.label,
      .node.enddevice.selected text.label,
      .node.enddevice.on-route text.label,
      .node.enddevice.match text.label { display:block; }
      .node.dim text.label { opacity:0; }

      .pulse { fill:var(--primary-color, #03a9f4); }

      .hud { position:absolute; display:flex; gap:6px; align-items:center;
             background:color-mix(in srgb, var(--card-background-color,#fff) 88%, transparent);
             border:1px solid var(--divider-color,#e0e0e0); border-radius:10px;
             padding:4px 6px; backdrop-filter:blur(3px); }
      .hud.tl { top:8px; left:8px; }
      .hud.tr { top:8px; right:8px; padding:2px; }
      .status { font-size:12px; color:var(--secondary-text-color,#727272);
                white-space:nowrap; padding:0 2px; }
      .searchwrap { display:flex; align-items:center; gap:4px; }
      .searchwrap svg { width:16px; height:16px; fill:var(--secondary-text-color,#727272); }
      input.search { all:unset; width:132px; font-size:12px;
                     color:var(--primary-text-color,#212121); }
      input.search::placeholder { color:var(--secondary-text-color,#727272); }
      .hits { font-size:11px; color:var(--secondary-text-color,#727272);
              white-space:nowrap; }

      button.tool { all:unset; display:grid; place-items:center; width:32px;
                    height:32px; border-radius:8px; cursor:pointer;
                    color:var(--secondary-text-color,#727272); }
      button.tool:hover { background:var(--divider-color,#e0e0e0); }
      button.tool[aria-pressed="false"] { opacity:.45; }
      button.tool svg { width:19px; height:19px; fill:currentColor; }
      button.rescan { all:unset; display:flex; align-items:center; gap:4px;
                      font-size:12px; cursor:pointer; border-radius:8px;
                      padding:2px 8px; color:var(--primary-color,#03a9f4); }
      button.rescan:hover { background:var(--divider-color,#e0e0e0); }
      button.rescan[disabled] { color:var(--disabled-text-color,#bdbdbd);
                                cursor:default; }
      button.rescan svg { width:15px; height:15px; fill:currentColor; }

      .legend { position:absolute; left:8px; bottom:8px; display:flex; gap:9px;
                flex-wrap:wrap; align-items:center; font-size:11px;
                color:var(--secondary-text-color,#727272);
                background:color-mix(in srgb, var(--card-background-color,#fff) 88%, transparent);
                border:1px solid var(--divider-color,#e0e0e0); border-radius:10px;
                padding:4px 8px; max-width:calc(100% - 16px); }
      .legend i { display:inline-block; width:13px; height:3px; border-radius:2px;
                  margin-right:3px; vertical-align:middle; }
      .legend b { font-weight:500; color:var(--primary-text-color,#212121); }

      .detail { position:absolute; right:8px; bottom:8px;
                width:min(272px, calc(100% - 16px));
                background:var(--card-background-color,#fff);
                border:1px solid var(--divider-color,#e0e0e0); border-radius:12px;
                padding:10px 12px; box-shadow:var(--ha-card-box-shadow, 0 2px 6px rgba(0,0,0,.18));
                font-size:13px; color:var(--primary-text-color,#212121);
                max-height:calc(100% - 96px); overflow:auto; }
      .detail[hidden] { display:none; }
      .detail h3 { margin:0 22px 1px 0; font-size:14px; font-weight:500; }
      .detail .sub { color:var(--secondary-text-color,#727272); font-size:11px;
                     margin-bottom:7px; }
      .detail dl { display:grid; grid-template-columns:auto 1fr; gap:1px 10px;
                   margin:0 0 7px; }
      .detail dt { color:var(--secondary-text-color,#727272); }
      .detail dd { margin:0; }
      .chip { display:inline-block; font-size:10px; border-radius:6px;
              padding:1px 6px; margin-bottom:6px;
              border:1px solid var(--divider-color,#e0e0e0);
              color:var(--secondary-text-color,#727272); }
      .chip.parent { color:var(--success-color,#4caf50);
                     border-color:var(--success-color,#4caf50); }
      .chip.inferred { color:var(--warning-color,#ff9800);
                       border-color:var(--warning-color,#ff9800); }
      .chip.bad { color:var(--error-color,#f44336);
                  border-color:var(--error-color,#f44336); }
      .hops { list-style:none; margin:0; padding:0; }
      .hops li { display:flex; justify-content:space-between; gap:8px; padding:2px 0;
                 border-top:1px solid var(--divider-color,#e0e0e0); }
      .hops .v.b1 { color:var(--error-color,#f44336); font-weight:500; }
      .hops .v.b2 { color:#ef6c00; }
      .hops .v.b3 { color:var(--warning-color,#ff9800); }
      .detail a { color:var(--primary-color,#03a9f4); text-decoration:none;
                  cursor:pointer; }
      .detail .close { position:absolute; top:8px; right:10px; cursor:pointer;
                       opacity:.6; }
      .warnline { color:var(--error-color,#f44336); font-size:11px; margin:5px 0 0; }

      .empty { position:absolute; inset:0; display:grid; place-items:center;
               text-align:center; padding:24px;
               color:var(--secondary-text-color,#727272); }
      .empty[hidden] { display:none; }
    `;

    const stage = document.createElement('div');
    stage.className = 'stage';

    const svg = svgEl('svg');
    const viewport = svgEl('g', { class: 'viewport' });
    this._gLinks = svgEl('g', { class: 'links' });
    this._gPulses = svgEl('g', { class: 'pulses' });
    this._gNodes = svgEl('g', { class: 'nodes' });
    viewport.append(this._gLinks, this._gPulses, this._gNodes);
    svg.append(viewport);

    const hudLeft = document.createElement('div');
    hudLeft.className = 'hud tl';
    hudLeft.innerHTML =
      `<span class="status"></span>` +
      `<button class="rescan" data-act="rescan">${this._icon(ICON.rescan)}<span>Re-scan</span></button>` +
      `<span class="searchwrap">${this._icon(ICON.search)}` +
      `<input class="search" type="search" placeholder="Find device" spellcheck="false">` +
      `<span class="hits"></span></span>`;

    const hudRight = document.createElement('div');
    hudRight.className = 'hud tr';
    hudRight.innerHTML =
      `<button class="tool" data-act="zoom-in" title="Zoom in">${this._icon(ICON.zoomIn)}</button>` +
      `<button class="tool" data-act="zoom-out" title="Zoom out">${this._icon(ICON.zoomOut)}</button>` +
      `<button class="tool" data-act="fit" title="Fit">${this._icon(ICON.fit)}</button>` +
      `<button class="tool" data-act="peers" aria-pressed="true" title="Show neighbour links">${this._icon(ICON.peers)}</button>` +
      `<button class="tool" data-act="freeze" aria-pressed="true" title="Pause layout">${this._icon(ICON.pause)}</button>`;

    const legend = document.createElement('div');
    legend.className = 'legend';

    const detail = document.createElement('div');
    detail.className = 'detail';
    detail.hidden = true;

    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.hidden = true;

    stage.append(svg, hudLeft, hudRight, legend, detail, empty);
    this.shadowRoot.append(style, stage);

    this._stage = stage;
    this._svg = svg;
    this._viewport = viewport;
    this._hudLeft = hudLeft;
    this._hudRight = hudRight;
    this._statusEl = hudLeft.querySelector('.status');
    this._rescanEl = hudLeft.querySelector('button.rescan');
    this._searchEl = hudLeft.querySelector('input.search');
    this._hitsEl = hudLeft.querySelector('.hits');
    this._legend = legend;
    this._detail = detail;
    this._empty = empty;

    for (const hud of [hudLeft, hudRight]) {
      hud.addEventListener('click', (ev) => {
        const act = ev.target.closest('button')?.dataset.act;
        if (act) this._action(act, ev.target.closest('button'));
      });
    }
    this._searchEl.addEventListener('input', () => this._applySearch(this._searchEl.value));
    detail.addEventListener('click', (ev) => {
      if (ev.target.closest('.close')) {
        this._select(null);
        return;
      }
      const open = ev.target.closest('[data-device]');
      if (open) this._openDevice(open.dataset.device);
    });
    this._bindGestures();
    this._svg.classList.toggle('hide-peers', !this._showPeers);
  }

  _icon(path) {
    return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${path}"/></svg>`;
  }

  /* ------------------------------------------------------------ reconciling */

  _radius(node) {
    if (node.ieee === this._graph.coordinator) return 13;
    return node.type === 'Router' ? 9 : 6.5;
  }

  _rank(node) {
    if (node.ieee === this._graph.coordinator) return 3;
    return node.type === 'Router' ? 2 : 1;
  }

  /**
   * Reconcile the DOM to the current graph, reusing what already exists.
   *
   * Rebuilding wholesale on every streamed device event would restart the physics
   * and throw away the operator's selection, so nodes and links are diffed by
   * identity and only genuinely new ones animate in.
   */
  _sync({ animate }) {
    if (!this._live) return;
    for (const node of this._graph?.nodes || []) {
      this._pos.set(node.ieee, { x: node.x, y: node.y, pinned: node.pinned });
    }

    this._graph = new Graph(this._live);
    const empty = !this._graph.nodes.length;
    this._empty.hidden = !empty;
    this._empty.textContent = empty ? 'No devices reported.' : '';
    if (empty) {
      this._stopLoop();
      return;
    }

    const rect = this._stage.getBoundingClientRect();
    if (!this._sim) this._sim = new Simulation(this._graph, rect.width, rect.height);
    else {
      this._sim.graph = this._graph;
      this._sim.resize(rect.width, rect.height);
    }
    this._seedPositions();
    this._choke = new Map(this._graph.chokePoints().map((c) => [c.ieee, c.stranded]));

    const now = performance.now();
    const wantAnimate = animate && !this._reduceMotion;

    // Links
    const seenLinks = new Set();
    for (const link of this._graph.links) {
      const key = linkKey(link);
      seenLinks.add(key);
      let entry = this._linkEls.get(key);
      if (!entry) {
        const el = svgEl('line', { class: 'link' });
        entry = { el, appear: wantAnimate ? now : 0 };
        this._linkEls.set(key, entry);
        this._gLinks.append(el);
      }
      entry.link = link;
      const cls = ['link', lqiBand(link.lqi)];
      // Only parent/child rows describe the tree. Sibling and "none" rows are
      // neighbours the device is not parented through, so they are drawn faint;
      // solid would read as structure that is not there.
      if (link.relationship >= REL_SIBLING) cls.push('peer');
      entry.el.setAttribute('class', cls.join(' '));
    }
    for (const [key, entry] of [...this._linkEls]) {
      if (!seenLinks.has(key)) {
        entry.el.remove();
        this._linkEls.delete(key);
      }
    }

    // Nodes, painted so routers and the coordinator sit above end devices.
    const ordered = [...this._graph.nodes].sort((a, b) => this._rank(a) - this._rank(b));
    const seenNodes = new Set();
    const perDepth = new Map();
    for (const node of ordered) {
      seenNodes.add(node.ieee);
      node._r = this._radius(node);
      const depth = this._graph.depth.get(node.ieee) ?? 3;
      const idx = perDepth.get(depth) || 0;
      perDepth.set(depth, idx + 1);
      node._revealIndex = idx;

      let els = this._nodeEls.get(node.ieee);
      if (!els) {
        const g = svgEl('g', { class: 'node' });
        const halo = svgEl('circle', { class: 'halo' });
        const choke = svgEl('circle', { class: 'choke-ring' });
        const warn = svgEl('circle', { class: 'warn-ring' });
        const body = svgEl('circle', { class: 'body' });
        const pin = svgEl('circle', { class: 'pin-dot', r: 1.8 });
        const label = svgEl('text', { class: 'label' });
        g.append(halo, choke, warn, body, pin, label);
        g.dataset.ieee = node.ieee;
        els = { g, body, halo, warn, choke, pin, label, appear: wantAnimate ? now : 0 };
        this._nodeEls.set(node.ieee, els);
        this._gNodes.append(g);
      }
      els.node = node;
      els.halo.setAttribute('r', node._r + 5);
      els.choke.setAttribute('r', node._r + 8);
      els.warn.setAttribute('r', node._r + 3);
      els.body.setAttribute('r', node._r);
      els.pin.setAttribute('cy', -node._r - 6);
      els.label.setAttribute('y', node._r + 13);
      els.label.textContent = node.name || node.ieee;
      els.pin.style.display = node.pinned ? '' : 'none';

      const kind =
        node.ieee === this._graph.coordinator
          ? 'coordinator'
          : node.type === 'Router'
            ? 'router'
            : 'enddevice';
      els.g.setAttribute(
        'class',
        `node ${kind}${node.availability === 'offline' ? ' offline' : ''}`
      );
      els.choke.style.display = this._diagnostics && this._choke.has(node.ieee) ? '' : 'none';
      els.warn.style.display = this._diagnostics && node.failed?.length ? '' : 'none';
    }
    for (const [ieee, els] of [...this._nodeEls]) {
      if (!seenNodes.has(ieee)) {
        els.g.remove();
        this._nodeEls.delete(ieee);
      }
    }

    this._renderLegend();
    this._applySearch(this._query, { silent: true });
    // _applySearch already reapplied emphasis, which covers the selection.
    if (this._firstFit !== true) {
      this._firstFit = true;
      this._fit();
    }
    this._sim.reheat(wantAnimate ? 0.9 : 0.5);
    this._startLoop();
  }

  /** Place new nodes on their hop ring; keep known positions stable. */
  _seedPositions() {
    const byDepth = new Map();
    for (const node of this._graph.nodes) {
      const d = this._graph.depth.get(node.ieee) ?? 3;
      if (!byDepth.has(d)) byDepth.set(d, []);
      byDepth.get(d).push(node);
    }
    const maxDepth = Math.max(1, ...byDepth.keys());
    const span = Math.min(this._sim.width, this._sim.height) / 2 - 70;

    for (const [depth, group] of byDepth) {
      group.forEach((node, i) => {
        const saved = this._pos.get(node.ieee);
        if (saved && Number.isFinite(saved.x)) {
          node.x = saved.x;
          node.y = saved.y;
          node.pinned = !!saved.pinned;
        } else {
          const radius = depth === 0 ? 0 : (span * Math.max(depth, 1)) / maxDepth;
          const angle = (i / Math.max(group.length, 1)) * Math.PI * 2 + depth * 0.7;
          node.x = this._sim.cx + Math.cos(angle) * radius;
          node.y = this._sim.cy + Math.sin(angle) * radius;
          node.pinned = false;
        }
        node.vx = node.vx || 0;
        node.vy = node.vy || 0;
        node.dragging = false;
      });
    }
  }

  _loadLayout() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
      for (const [ieee, at] of Object.entries(saved)) this._pos.set(ieee, at);
    } catch {
      /* private browsing or bad JSON: layout memory is a nicety, never a failure */
    }
  }

  _saveLayout() {
    const out = {};
    for (const node of this._graph?.nodes || []) {
      if (node.pinned) out[node.ieee] = { x: Math.round(node.x), y: Math.round(node.y), pinned: true };
    }
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(out));
    } catch {
      /* quota or private mode */
    }
  }

  /* ----------------------------------------------------------------- chrome */

  _renderHud() {
    if (!this._statusEl) return;
    const s = this._scan;
    if (s.scanning) {
      const of = s.total ? ` ${s.done}/${s.total}` : '';
      this._statusEl.textContent = `Scanning${of}`;
    } else {
      this._statusEl.textContent = s.generated ? `Scanned ${ago(s.generated)}` : 'Not scanned';
    }
    this._rescanEl.disabled = !!s.scanning;
  }

  _renderLegend() {
    const links = this._graph.links;
    const weak = links.filter((l) => l.lqi !== null && l.lqi !== undefined && l.lqi < WEAK_LQI).length;
    const unknown = links.filter((l) => l.lqi === null || l.lqi === undefined).length;
    const chokes = this._choke?.size || 0;
    const asym = this._graph.asymmetric().length;
    const failed = this._graph.nodes.filter((n) => n.failed?.length).length;

    const bits = [
      `<span><i style="background:var(--success-color,#4caf50)"></i>200+</span>`,
      `<span><i style="background:#7cb342"></i>120+</span>`,
      `<span><i style="background:var(--warning-color,#ff9800)"></i>70+</span>`,
      `<span><i style="background:#ef6c00"></i>45+</span>`,
      `<span><i style="background:var(--error-color,#f44336)"></i>&lt;45</span>`,
    ];
    if (this._diagnostics) {
      if (weak) bits.push(`<span><b>${weak}</b> weak</span>`);
      if (chokes) bits.push(`<span><b>${chokes}</b> choke</span>`);
      if (asym) bits.push(`<span><b>${asym}</b> asymmetric</span>`);
      if (unknown) bits.push(`<span><b>${unknown}</b> unmeasured</span>`);
      if (failed) bits.push(`<span><b>${failed}</b> no reply</span>`);
    }
    this._legend.innerHTML = bits.join('');
  }

  /* ----------------------------------------------------------------- search */

  _applySearch(value, { silent } = {}) {
    this._query = value || '';
    const q = this._query.trim().toLowerCase();
    if (!q) {
      this._matches = null;
      this._hitsEl.textContent = '';
    } else {
      this._matches = new Set(
        this._graph.nodes
          .filter((n) =>
            [n.name, n.model, n.vendor, n.ieee]
              .filter(Boolean)
              .some((f) => String(f).toLowerCase().includes(q))
          )
          .map((n) => n.ieee)
      );
      this._hitsEl.textContent = `${this._matches.size}/${this._graph.nodes.length}`;
    }
    for (const [ieee, els] of this._nodeEls) {
      els.g.classList.toggle('match', !!this._matches?.has(ieee));
    }
    this._applyEmphasis();
    if (!silent) this._startLoop();
  }

  /**
   * One place decides what recedes. Selection and search both narrow attention, and
   * having each fight for the same opacity is how a map ends up unreadable.
   */
  _applyEmphasis() {
    const onRoute = new Set();
    const routeLinks = new Set();
    if (this._selected && this._route) {
      onRoute.add(this._selected);
      for (const hop of this._route.hops) {
        onRoute.add(hop.from);
        onRoute.add(hop.to);
        const link = this._graph.linkBetween(hop.from, hop.to);
        if (link) routeLinks.add(linkKey(link));
      }
    }
    const narrowed = !!this._selected || !!this._matches;

    for (const node of this._graph.nodes) {
      const els = this._nodeEls.get(node.ieee);
      if (!els) continue;
      const keep =
        !narrowed ||
        onRoute.has(node.ieee) ||
        this._matches?.has(node.ieee) ||
        node.ieee === this._hovered;
      els.g.classList.toggle('dim', narrowed && !keep);
      els.g.classList.toggle('on-route', onRoute.has(node.ieee));
      els.g.classList.toggle('selected', node.ieee === this._selected);
    }
    for (const [key, entry] of this._linkEls) {
      const isRoute = routeLinks.has(key);
      entry.el.classList.toggle('route', isRoute);
      entry.el.classList.toggle('dim', narrowed && !isRoute);
    }
  }

  /* ------------------------------------------------------------ interaction */

  _bindGestures() {
    const stage = this._stage;
    const pointers = new Map();
    let dragNode = null;
    let panFrom = null;
    let pinchFrom = null;
    let moved = 0;

    // Clicks inside the overlays are UI, not canvas. Without this the detail card's
    // own controls registered as background clicks and cleared the selection, which
    // made "Open in Home Assistant" look like it did nothing.
    const isChrome = (ev) => !!ev.target.closest?.('.hud, .legend, .detail, .empty');

    const toWorld = (ev) => {
      const rect = stage.getBoundingClientRect();
      return {
        x: (ev.clientX - rect.left - this._view.x) / this._view.k,
        y: (ev.clientY - rect.top - this._view.y) / this._view.k,
      };
    };

    stage.addEventListener('pointerdown', (ev) => {
      if (isChrome(ev)) return;
      try {
        stage.setPointerCapture(ev.pointerId);
      } catch {
        /* synthetic pointers cannot be captured; harmless */
      }
      pointers.set(ev.pointerId, ev);
      moved = 0;

      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinchFrom = {
          dist: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY),
          k: this._view.k,
        };
        dragNode = null;
        panFrom = null;
        return;
      }

      const hit = ev.target.closest?.('.node');
      if (hit) {
        const node = this._graph.byIeee.get(hit.dataset.ieee);
        if (node) {
          dragNode = node;
          node.dragging = true;
          this._sim.reheat(0.9);
          this._startLoop();
        }
      } else {
        panFrom = { x: ev.clientX, y: ev.clientY, vx: this._view.x, vy: this._view.y };
        stage.classList.add('panning');
      }
    });

    stage.addEventListener('pointermove', (ev) => {
      if (!pointers.has(ev.pointerId)) return;
      const prev = pointers.get(ev.pointerId);
      moved += Math.abs(ev.clientX - prev.clientX) + Math.abs(ev.clientY - prev.clientY);
      pointers.set(ev.pointerId, ev);

      if (pinchFrom && pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
        const rect = stage.getBoundingClientRect();
        this._zoomTo(
          (pinchFrom.k * dist) / (pinchFrom.dist || 1),
          (a.clientX + b.clientX) / 2 - rect.left,
          (a.clientY + b.clientY) / 2 - rect.top
        );
        return;
      }

      if (dragNode) {
        const at = toWorld(ev);
        dragNode.x = at.x;
        dragNode.y = at.y;
        this._sim.reheat(0.6);
        this._startLoop();
        return;
      }

      if (panFrom) {
        this._userMoved = true;
        this._view.x = panFrom.vx + (ev.clientX - panFrom.x);
        this._view.y = panFrom.vy + (ev.clientY - panFrom.y);
        this._applyTransform();
      }
    });

    const release = (ev) => {
      pointers.delete(ev.pointerId);
      if (pointers.size < 2) pinchFrom = null;
      stage.classList.remove('panning');
      if (dragNode) {
        dragNode.dragging = false;
        // A short press selects; a real drag drags. Letting the node rejoin the
        // simulation afterwards is what makes the map feel alive.
        if (moved < 6) this._select(dragNode.ieee);
        this._sim.reheat(0.5);
        dragNode = null;
      } else if (panFrom && moved < 6) {
        this._select(null);
      }
      panFrom = null;
    };
    stage.addEventListener('pointerup', release);
    stage.addEventListener('pointercancel', release);

    stage.addEventListener('dblclick', (ev) => {
      if (isChrome(ev)) return;
      const hit = ev.target.closest?.('.node');
      if (!hit) return;
      const node = this._graph.byIeee.get(hit.dataset.ieee);
      if (!node) return;
      node.pinned = !node.pinned;
      this._nodeEls.get(node.ieee)?.pin.style.setProperty('display', node.pinned ? '' : 'none');
      this._saveLayout();
      this._sim.reheat(0.4);
      this._startLoop();
    });

    stage.addEventListener(
      'wheel',
      (ev) => {
        if (isChrome(ev)) return;
        ev.preventDefault();
        const rect = stage.getBoundingClientRect();
        this._zoomTo(
          this._view.k * (ev.deltaY < 0 ? 1.12 : 1 / 1.12),
          ev.clientX - rect.left,
          ev.clientY - rect.top
        );
      },
      { passive: false }
    );

    stage.addEventListener('pointerover', (ev) => {
      const hit = ev.target.closest?.('.node');
      const ieee = hit?.dataset.ieee || null;
      if (ieee === this._hovered) return;
      if (this._hovered) this._nodeEls.get(this._hovered)?.g.classList.remove('hover');
      this._hovered = ieee;
      if (ieee) this._nodeEls.get(ieee)?.g.classList.add('hover');
      this._applyEmphasis();
    });
  }

  _action(act, button) {
    const rect = this._stage.getBoundingClientRect();
    if (act === 'zoom-in') this._zoomTo(this._view.k * 1.25, rect.width / 2, rect.height / 2);
    else if (act === 'zoom-out') this._zoomTo(this._view.k / 1.25, rect.width / 2, rect.height / 2);
    else if (act === 'fit') {
      this._userMoved = false;
      this._fit();
    }
    else if (act === 'peers') {
      this._showPeers = !this._showPeers;
      button.setAttribute('aria-pressed', String(this._showPeers));
      this._svg.classList.toggle('hide-peers', !this._showPeers);
    } else if (act === 'freeze') {
      this._frozen = !this._frozen;
      button.setAttribute('aria-pressed', String(!this._frozen));
      button.innerHTML = this._icon(this._frozen ? ICON.play : ICON.pause);
      if (!this._frozen) {
        this._sim.reheat(0.5);
        this._startLoop();
      }
    } else if (act === 'rescan') {
      this.dispatchEvent(new CustomEvent('z2m-rescan', { bubbles: true, composed: true }));
    }
  }

  _zoomTo(k, ax, ay) {
    this._userMoved = true;
    const next = clamp(k, 0.25, 4);
    const scale = next / this._view.k;
    this._view.x = ax - (ax - this._view.x) * scale;
    this._view.y = ay - (ay - this._view.y) * scale;
    this._view.k = next;
    this._applyTransform();
  }

  _fit() {
    if (!this._graph?.nodes.length) return;
    const xs = this._graph.nodes.map((n) => n.x);
    const ys = this._graph.nodes.map((n) => n.y);
    // Pad for the HUD strips so nothing important hides behind them.
    const w = Math.max(...xs) - Math.min(...xs) + 120;
    const h = Math.max(...ys) - Math.min(...ys) + 130;
    const rect = this._stage.getBoundingClientRect();
    const k = clamp(Math.min(rect.width / w, rect.height / h), 0.25, 1.7);
    this._view.k = k;
    this._view.x = rect.width / 2 - ((Math.min(...xs) + Math.max(...xs)) / 2) * k;
    this._view.y = rect.height / 2 - ((Math.min(...ys) + Math.max(...ys)) / 2) * k;
    this._applyTransform();
  }

  _applyTransform() {
    this._viewport.setAttribute(
      'transform',
      `translate(${this._view.x} ${this._view.y}) scale(${this._view.k})`
    );
  }

  _resize() {
    if (!this._sim) return;
    const rect = this._stage.getBoundingClientRect();
    this._sim.resize(rect.width, rect.height);
    this._sim.reheat(0.3);
    this._startLoop();
  }

  /** Navigate with Home Assistant's own router rather than a bare link. */
  _openDevice(deviceId) {
    if (!deviceId) return;
    history.pushState(null, '', `/config/devices/device/${deviceId}`);
    window.dispatchEvent(new CustomEvent('location-changed', { detail: { replace: false } }));
  }

  /* -------------------------------------------------------------- selection */

  _select(ieee) {
    this._selected = ieee && this._graph.byIeee.has(ieee) ? ieee : null;
    this._route = this._selected ? this._graph.routeToCoordinator(this._selected) : null;
    this._pulses = [];
    this._gPulses.textContent = '';

    if (this._selected && this._route?.hops.length && !this._reduceMotion) {
      for (let i = 0; i < 3; i++) {
        const dot = svgEl('circle', { class: 'pulse', r: 2.6 });
        this._gPulses.append(dot);
        this._pulses.push({ el: dot, phase: i / 3 });
      }
    }

    this._applyEmphasis();
    this._renderDetail();
    this.dispatchEvent(
      new CustomEvent('z2m-node-selected', {
        detail: {
          ieee: this._selected,
          device_id: this._selected
            ? this._graph.byIeee.get(this._selected).device_id || null
            : null,
        },
        bubbles: true,
        composed: true,
      })
    );
    this._startLoop();
  }

  _renderDetail() {
    if (!this._selected) {
      this._detail.hidden = true;
      this._detail.innerHTML = '';
      return;
    }
    const node = this._graph.byIeee.get(this._selected);
    const hops = this._route?.hops || [];
    const measured = hops.map((h) => h.lqi).filter((v) => v !== null && v !== undefined);
    const weakest = measured.length ? Math.min(...measured) : null;
    const name = (ieee) => this._graph.byIeee.get(ieee)?.name || ieee;
    const neighbours = (this._graph.adj.get(node.ieee) || []).length;

    const rows = [];
    if (node.vendor || node.model)
      rows.push(['Model', [node.vendor, node.model].filter(Boolean).join(' ')]);
    rows.push(['Role', node.ieee === this._graph.coordinator ? 'Coordinator' : node.type]);
    if (node.availability) rows.push(['State', node.availability]);
    if (node.lastSeen) rows.push(['Last seen', ago(node.lastSeen / 1000) || '-']);
    rows.push(['Neighbours', String(neighbours)]);
    if (hops.length) rows.push(['Hops', String(hops.length)]);
    if (weakest !== null) rows.push(['Weakest hop', String(weakest)]);

    const chip =
      this._route?.kind === 'parent'
        ? '<span class="chip parent">parent chain</span>'
        : this._route?.kind === 'inferred'
          ? '<span class="chip inferred">inferred path</span>'
          : '<span class="chip bad">no path</span>';

    const hopList = hops
      .map(
        (h) =>
          `<li><span>${escapeHtml(name(h.from))} &rarr; ${escapeHtml(name(h.to))}</span>` +
          `<span class="v ${lqiBand(h.lqi)}">${h.lqi ?? '?'}</span></li>`
      )
      .join('');

    const stranded = this._choke?.get(node.ieee);
    this._detail.hidden = false;
    this._detail.innerHTML =
      `<span class="close" title="Clear">&times;</span>` +
      `<h3>${escapeHtml(node.name || node.ieee)}</h3>` +
      `<div class="sub">${escapeHtml(node.ieee)}</div>` +
      chip +
      `<dl>${rows.map(([k, v]) => `<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd>`).join('')}</dl>` +
      (hopList ? `<ul class="hops">${hopList}</ul>` : '') +
      (stranded
        ? `<p class="warnline">Choke point: ${stranded} device${stranded === 1 ? '' : 's'} depend on it.</p>`
        : '') +
      (node.failed?.length
        ? `<p class="warnline">No scan reply: ${escapeHtml(node.failed.join(', '))}</p>`
        : '') +
      (node.device_id && this._hass
        ? `<p><a data-device="${escapeHtml(node.device_id)}">Open in Home Assistant</a></p>`
        : '');
  }

  /* ------------------------------------------------------------------- loop */

  _startLoop() {
    if (this._raf) return;
    const frame = (now) => {
      this._raf = null;
      if (this._tick(now)) this._raf = requestAnimationFrame(frame);
      else this._saveLayout();
    };
    this._raf = requestAnimationFrame(frame);
  }

  _stopLoop() {
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = null;
  }

  _tick(now) {
    if (!this._sim || !this._graph?.nodes.length) return false;
    let busy = false;
    if (!this._frozen) busy = this._sim.step();

    for (const [, els] of this._nodeEls) {
      const node = els.node;
      if (!node) continue;
      let scale = 1;
      if (els.appear) {
        const t = clamp((now - els.appear - (node._revealIndex || 0) * 22) / 300, 0, 1);
        if (t < 1) {
          const eased = 1 - Math.pow(1 - t, 3);
          scale = eased * (1 + 0.22 * (1 - eased));
          els.g.style.opacity = t.toFixed(2);
          busy = true;
        } else {
          els.g.style.opacity = '';
          els.appear = 0;
        }
      }
      els.g.setAttribute(
        'transform',
        `translate(${node.x.toFixed(1)} ${node.y.toFixed(1)})` +
          (scale < 1 ? ` scale(${scale.toFixed(3)})` : '')
      );
    }

    for (const [, entry] of this._linkEls) {
      const a = this._graph.byIeee.get(entry.link.source);
      const b = this._graph.byIeee.get(entry.link.target);
      if (!a || !b) continue;
      entry.el.setAttribute('x1', a.x.toFixed(1));
      entry.el.setAttribute('y1', a.y.toFixed(1));
      entry.el.setAttribute('x2', b.x.toFixed(1));
      entry.el.setAttribute('y2', b.y.toFixed(1));
      if (entry.appear) {
        // Draw the link on, so a device visibly attaches to its router.
        const t = clamp((now - entry.appear) / 420, 0, 1);
        const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
        if (t < 1) {
          entry.el.style.strokeDasharray = `${len}`;
          entry.el.style.strokeDashoffset = `${len * (1 - t)}`;
          busy = true;
        } else {
          entry.el.style.strokeDasharray = '';
          entry.el.style.strokeDashoffset = '';
          entry.appear = 0;
        }
      }
    }

    if (this._pulses.length) busy = this._animatePulses(now) || busy;
    return busy;
  }

  /** Dots travelling from the selected device toward the coordinator. */
  _animatePulses(now) {
    const hops = this._route?.hops || [];
    if (!hops.length) return false;
    const points = [this._graph.byIeee.get(hops[0].from)];
    for (const hop of hops) points.push(this._graph.byIeee.get(hop.to));
    if (points.some((p) => !p)) return false;

    const segments = [];
    let total = 0;
    for (let i = 0; i < points.length - 1; i++) {
      const len = Math.hypot(points[i + 1].x - points[i].x, points[i + 1].y - points[i].y);
      segments.push(len);
      total += len;
    }
    if (!total) return false;

    const period = 1400 + hops.length * 260;
    for (const pulse of this._pulses) {
      const at = (((now / period + pulse.phase) % 1) + 1) % 1;
      let travelled = at * total;
      let i = 0;
      while (i < segments.length - 1 && travelled > segments[i]) {
        travelled -= segments[i];
        i++;
      }
      const f = segments[i] ? travelled / segments[i] : 0;
      pulse.el.setAttribute('cx', (points[i].x + (points[i + 1].x - points[i].x) * f).toFixed(1));
      pulse.el.setAttribute('cy', (points[i].y + (points[i + 1].y - points[i].y) * f).toFixed(1));
    }
    return true;
  }
}

/* ------------------------------------------------------------- Lovelace card */

class Z2MMapCard extends HTMLElement {
  static getStubConfig() {
    return { type: 'custom:z2m-map-card', height: 420, diagnostics: true };
  }

  setConfig(config) {
    this._config = { height: 420, diagnostics: true, ...(config || {}) };
    if (!this._card) {
      this._card = document.createElement('ha-card');
      this._card.style.overflow = 'hidden';
      this._map = document.createElement('z2m-network-map');
      this._card.append(this._map);
      this.append(this._card);
    }
    this._map.style.height = `${this._config.height}px`;
    this._map.diagnostics = this._config.diagnostics;
    if (this._config.title) this._card.setAttribute('header', this._config.title);
  }

  set hass(hass) {
    this._map.hass = hass;
    if (this._loaded) return;
    this._loaded = true;
    // Reads the cache the integration already holds. A card on a dashboard must
    // never kick off a fleet-wide probe.
    hass
      .callWS({ type: 'z2m/networkmap' })
      .then((topology) => {
        this._map.reveal = true;
        this._map.topology = topology;
        this._map.scan = { generated: topology?.generated || null, scanning: false };
      })
      .catch((err) => {
        this._card.innerHTML = '';
        const alert = document.createElement('ha-alert');
        alert.setAttribute('alert-type', 'error');
        alert.textContent = `Zigbee map unavailable: ${err?.message || err}`;
        this._card.append(alert);
      });
  }

  getCardSize() {
    return Math.ceil((this._config?.height || 420) / 50);
  }
}

if (!customElements.get('z2m-network-map')) {
  customElements.define('z2m-network-map', Z2MNetworkMap);
}
if (!customElements.get('z2m-map-card')) {
  customElements.define('z2m-map-card', Z2MMapCard);
}

window.customCards = window.customCards || [];
if (!window.customCards.some((c) => c.type === 'z2m-map-card')) {
  window.customCards.push({
    type: 'z2m-map-card',
    name: 'Zigbee map',
    description: 'Live Zigbee mesh topology with link quality and route tracing.',
    preview: false,
    documentationURL: 'https://github.com/nphil/z2m_ha',
  });
}
