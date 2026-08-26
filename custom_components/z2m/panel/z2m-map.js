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
 * LAYOUT. The mesh is drawn as what it topologically is: a tree with context.
 * The coordinator is pinned at the world origin; routers hold concentric rings by
 * routing-tree depth; end devices orbit their parent router like moons. Those
 * targets come from a deterministic radial-tree pass (stable name ordering, sector
 * widths by subtree size), and a live force simulation -- repulsion, tree-link
 * springs, per-tier radial constraints -- runs on top, so the map keeps its
 * physical feel: nodes are draggable, neighbours give way, everything resettles.
 * Two opens of the same network look the same, because the seeds and anchors are
 * pure functions of the topology.
 *
 * WORLD vs VIEW. Positions live in world coordinates centred on (0,0) and never
 * depend on the element's size; the viewport transform fits the world to the
 * canvas. This is a hard-won rule: an earlier build seeded and fitted against
 * getBoundingClientRect() at mount time, and a host measured at 0x0 (hidden tab,
 * mid-layout mount) wedged the view on a corner sliver until a scan finished --
 * the operator saw a blank canvas for the whole walk, then everything at once.
 * Now a degenerate rect merely defers the fit until ResizeObserver reports a
 * real one, and the layout itself is size-independent.
 *
 * This map is used to decide where to put hardware, so it is built to a rule: never
 * draw a claim the data does not support.
 *   - An end device's parent chain is authoritative. End devices transmit only to
 *     their parent, and the neighbour tables name it.
 *   - A router's path is NOT knowable from a snapshot; the mesh routes dynamically.
 *     Those paths are marked inferred.
 *   - A neighbour row with no usable LQI is drawn as unknown, never as zero. A dead
 *     link and an unmeasured one look different, because they mean different things.
 *   - The routing tree is structure and is drawn plainly. Every other neighbour row
 *     is context: hidden by default, faint when shown, so it can never bury the
 *     tree under a hairball.
 */

const STORE_KEY = 'z2m-map-layout-v3';

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
 * Space kept between two node bodies. It is deliberately larger than a visual
 * nicety: names are drawn under the dots now, so this is what keeps one device's
 * label off the next device's.
 */
const NODE_CLEARANCE = 26;

/** Below this width the overlays reflow: HUD stacks, detail becomes a sheet. */
const NARROW_PX = 600;

/** Longest name drawn on the canvas before it is clipped with an ellipsis. */
const LABEL_MAX_CHARS = 18;

/**
 * Visual truncation only. The untruncated name stays on the node's accessible
 * name and in the detail panel, so nothing becomes unfindable to make room.
 */
const labelText = (name) =>
  name.length > LABEL_MAX_CHARS ? `${name.slice(0, LABEL_MAX_CHARS - 1)}\u2026` : name;

/** Approximate half-width of a drawn label, in world units, per character. */
const LABEL_CHAR_HALF_WIDTH = 2.9;

/**
 * A neighbour row can arrive with no LQI at all: the radio never rated that link.
 * Treating it as 0 would make the layout and the path finder behave as if it were
 * the worst link on the mesh, and treating it as 255 would make it the best. Both
 * are inventions. It is scored as mid so it neither attracts nor repels a traced
 * route, and it is drawn in its own band so it never reads as a measurement.
 */
const UNRATED_LQI = 128;

/**
 * Per-hop cost for path finding. The constant term keeps the search honest about hop
 * count: without it, five great links beat one decent direct link, which is not how
 * you want to read a mesh.
 */
const hopCost = (lqi) => 1 + ((255 - clamp(lqi ?? UNRATED_LQI, 0, 255)) / 255) * 3;

/**
 * Five bands rather than three. When the question is "is this link the problem",
 * the difference between 60 and 110 matters, and a coarse ramp hides it. These
 * bands colour the WORDS -- hop lists, the detail panel -- where fine grading
 * helps. The drawn edges use linkTone below, which is deliberately coarser.
 */
const lqiBand = (lqi) => {
  if (lqi === null || lqi === undefined) return 'unknown';
  if (lqi >= 200) return 'b5';
  if (lqi >= 120) return 'b4';
  if (lqi >= 70) return 'b3';
  if (lqi >= WEAK_LQI) return 'b2';
  return 'b1';
};

/**
 * How an edge is DRAWN. Three steps plus unknown, on purpose: a five-colour ramp
 * across every line made the canvas read like an alarm panel. Strong and fair are
 * the same calm ink at different weights; saturated colour is reserved for links
 * that are genuinely weak (the diagnostic threshold), so red means something.
 */
const linkTone = (lqi) => {
  if (lqi === null || lqi === undefined) return 'unknown';
  if (lqi < WEAK_LQI) return 'weak';
  return lqi >= 120 ? 'strong' : 'mid';
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

/** One drawn edge per device pair, whichever direction the rows came in. */
const pairKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);

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

  /** Hop distance from the coordinator, ignoring quality. */
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

/* -------------------------------------------------------------------- layout */

/**
 * Radial-tree geometry, in world units. The world is centred on the coordinator
 * at (0,0); the viewport fits the world to the canvas afterwards, so none of
 * these depend on the element's size.
 */
const RING_BASE = 175; // radius of the first router ring
const RING_STEP = 150; // spacing between successive router rings
const ORBIT_BASE = 62; // end devices orbit their parent router at this radius
const ORBIT_STEP = 36; // extra orbit shells when one router has many children
const HALO_PAD = 135; // unparented devices sit this far beyond the outer ring
const RING_SLOT = 2 * (9 + NODE_CLEARANCE); // arc one ringed node needs
// Arc one orbiting end device needs. Tighter than a ringed node's slot: moon
// labels compete under _cullLabels anyway, and a wide slot made five moons wrap
// 260 degrees around their router, colliding with the neighbouring cluster.
const MOON_SLOT = 44;

/**
 * Deterministic radial-tree targets: seeds for new nodes and weak anchors for the
 * live simulation. The coordinator holds the origin; routers get concentric rings
 * by routing-tree depth, each inside an angular sector sized by its subtree, so
 * a router's descendants stay in its wedge and edges rarely cross; end devices
 * orbit their parent router like moons. Unparented end devices form an outer
 * halo -- during a streamed scan that is every end device, so the reveal reads
 * as: halo of pending devices, then each router's reply pulls its children in.
 *
 * Everything is ordered by (name, ieee), never by Map iteration or arrival
 * order, so the same fleet always lands the same way.
 */
function assignHomes(graph) {
  const result = { parentOf: new Map(), inferred: new Set() };
  const nodes = graph.nodes;
  if (!nodes.length) return result;

  const coordIeee =
    graph.coordinator && graph.byIeee.has(graph.coordinator) ? graph.coordinator : null;
  const byName = (a, b) => {
    const an = String(a.name || a.ieee).toLowerCase();
    const bn = String(b.name || b.ieee).toLowerCase();
    if (an !== bn) return an < bn ? -1 : 1;
    return a.ieee < b.ieee ? -1 : 1;
  };

  // Effective tree parent: as reported, when it is sane. An end device can never
  // be a parent, whatever a corrupt neighbour row claims.
  const parentOf = result.parentOf;
  for (const node of nodes) {
    if (node.ieee === coordIeee) continue;
    const p = graph.parent.get(node.ieee);
    const pNode = p && p !== node.ieee ? graph.byIeee.get(p) : null;
    const ok = pNode && (pNode.ieee === coordIeee || pNode.type === 'Router');
    parentOf.set(node.ieee, ok ? pNode.ieee : null);
  }

  // A device whose neighbour tables reported no usable parent still reaches the
  // coordinator somehow, and a node floating unconnected reads as broken. Attach
  // it by the first hop of the same inferred route the detail panel shows (the
  // strongest measured path), validated to land on a router or the coordinator;
  // if even that fails, fall back to its strongest directly measured router
  // neighbour. The edge is recorded as inferred and drawn as a hypothesis
  // (dotted, amber), never as reported structure.
  for (const node of nodes) {
    if (node.ieee === coordIeee) continue;
    if (parentOf.get(node.ieee)) continue;
    const route = graph.routeToCoordinator(node.ieee);
    let upNode = null;
    if (route.kind === 'inferred' && route.hops.length) {
      const first = graph.byIeee.get(route.hops[0].to);
      if (first && (first.ieee === coordIeee || first.type === 'Router')) upNode = first;
    }
    if (!upNode) {
      let best = null;
      for (const link of graph.adj.get(node.ieee) || []) {
        const other = graph.byIeee.get(graph.other(link, node.ieee));
        if (!other || (other.ieee !== coordIeee && other.type !== 'Router')) continue;
        if (!best || (link.lqi ?? -1) > (best.link.lqi ?? -1)) best = { other, link };
      }
      upNode = best ? best.other : null;
    }
    if (!upNode) continue;
    parentOf.set(node.ieee, upNode.ieee);
    result.inferred.add(pairKey(node.ieee, upNode.ieee));
  }
  // Parent loops occur in real tables. Cut at the first revisited node, which is
  // deterministic, so a cycle becomes a subtree hanging off ring one.
  for (const node of nodes) {
    if (node.ieee === coordIeee) continue;
    const seen = new Set([node.ieee]);
    let at = parentOf.get(node.ieee);
    while (at && at !== coordIeee) {
      if (seen.has(at)) {
        parentOf.set(at, null);
        break;
      }
      seen.add(at);
      at = parentOf.get(at);
    }
  }

  // Children per parent, stably ordered.
  const kids = new Map();
  const rootRouters = [];
  const halo = [];
  for (const node of [...nodes].sort(byName)) {
    if (node.ieee === coordIeee) continue;
    const p = parentOf.get(node.ieee);
    if (p) {
      if (!kids.has(p)) kids.set(p, []);
      kids.get(p).push(node);
    } else if (node.type === 'Router') rootRouters.push(node);
    else halo.push(node);
  }

  for (const node of nodes) {
    node._orbit = null;
    node._orbitR = null;
    node._ringR = null;
    node._hx = null;
    node._hy = null;
    node._tier = 0;
    node._kids = (kids.get(node.ieee) || []).length;
  }

  const coordKids = coordIeee ? kids.get(coordIeee) || [] : [];
  const coordMoons = coordKids.filter((n) => n.type !== 'Router');
  const ringOne = [...coordKids.filter((n) => n.type === 'Router'), ...rootRouters].sort(byName);

  const moonsOf = (r) => (kids.get(r.ieee) || []).filter((n) => n.type !== 'Router');
  const routerKidsOf = (r) => (kids.get(r.ieee) || []).filter((n) => n.type === 'Router');

  /** Orbit shells: greedy fill, growing outward when one shell cannot hold them. */
  const orbitPlan = (count, base = ORBIT_BASE) => {
    const shells = [];
    let left = count;
    let shell = 0;
    while (left > 0) {
      const radius = base + shell * ORBIT_STEP;
      const cap = Math.max(3, Math.floor((2 * Math.PI * radius) / MOON_SLOT));
      const take = Math.min(cap, left);
      shells.push({ radius, cap, take });
      left -= take;
      shell += 1;
    }
    return shells;
  };
  const outerOrbit = (r) => {
    const shells = orbitPlan(moonsOf(r).length);
    return shells.length ? shells[shells.length - 1].radius : 0;
  };

  // Arc a router needs on its ring: its own slot or its whole moon system.
  const needOf = new Map();
  const need = (r) => {
    let v = needOf.get(r.ieee);
    if (v === undefined) {
      // The margin absorbs what repulsion adds to the nominal orbit at
      // equilibrium, so neighbouring moon systems get real breathing room.
      v = Math.max(RING_SLOT, 2 * (outerOrbit(r) + 40));
      needOf.set(r.ieee, v);
    }
    return v;
  };
  // Sector weight: what this router and every router below it need. Conservative
  // on purpose -- deeper rings have more circumference per radian to spend.
  const weightOf = new Map();
  const weight = (r) => {
    let v = weightOf.get(r.ieee);
    if (v === undefined) {
      v = need(r);
      for (const k of routerKidsOf(r)) v += weight(k);
      weightOf.set(r.ieee, v);
    }
    return v;
  };

  // Router tiers by tree depth, then ring radii wide enough for each tier's load.
  const tiers = new Map();
  {
    let frontier = ringOne;
    let depth = 1;
    while (frontier.length) {
      tiers.set(depth, frontier);
      const next = [];
      for (const r of frontier) next.push(...routerKidsOf(r));
      frontier = next;
      depth += 1;
    }
  }
  const maxDepth = tiers.size;
  const radii = new Map();
  {
    let prev = 0;
    for (let d = 1; d <= maxDepth; d++) {
      const ringNeed = tiers.get(d).reduce((sum, r) => sum + need(r), 0);
      const r = Math.max(d === 1 ? RING_BASE : prev + RING_STEP, ringNeed / (2 * Math.PI));
      radii.set(d, r);
      prev = r;
    }
  }

  /**
   * Moons sit on an arc centred on the parent's outward direction, so the space
   * between the router and its own parent stays clear for the tree edge; a full
   * shell wraps the whole way round.
   */
  const placeMoons = (parent, moons, outward, base = ORBIT_BASE) => {
    if (!moons.length) return;
    const shells = orbitPlan(moons.length, base);
    let index = 0;
    shells.forEach(({ radius, cap, take }, shellIdx) => {
      const slotAng = MOON_SLOT / radius;
      const full = take >= cap;
      const step = full ? (2 * Math.PI) / take : slotAng;
      const start = full
        ? outward + shellIdx * 0.45
        : outward - (slotAng * (take - 1)) / 2 + shellIdx * 0.45;
      for (let j = 0; j < take; j++, index++) {
        const moon = moons[index];
        const ang = start + j * step;
        const dx = Math.cos(ang) * radius;
        const dy = Math.sin(ang) * radius;
        moon._orbit = { parent: parent.ieee, dx, dy };
        moon._orbitR = radius;
        moon._hx = (parent._hx || 0) + dx;
        moon._hy = (parent._hy || 0) + dy;
        moon._tier = (parent._tier || 0) + 1;
      }
    });
  };

  if (coordIeee) {
    const c = graph.byIeee.get(coordIeee);
    c._hx = 0;
    c._hy = 0;
    c._tier = 0;
  }

  const place = (router, depth, a0, a1) => {
    const angle = (a0 + a1) / 2;
    const radius = radii.get(depth);
    router._hx = Math.cos(angle) * radius;
    router._hy = Math.sin(angle) * radius;
    router._tier = depth;
    router._ringR = radius;
    placeMoons(router, moonsOf(router), angle);
    const children = routerKidsOf(router);
    if (!children.length) return;
    const total = children.reduce((sum, k) => sum + weight(k), 0) || 1;
    let cursor = a0;
    for (const child of children) {
      const span = ((a1 - a0) * weight(child)) / total;
      place(child, depth + 1, cursor, cursor + span);
      cursor += span;
    }
  };
  {
    const total = ringOne.reduce((sum, r) => sum + weight(r), 0) || 1;
    let cursor = -Math.PI / 2; // first sector opens at twelve o'clock
    for (const r of ringOne) {
      const span = (2 * Math.PI * weight(r)) / total;
      place(r, 1, cursor, cursor + span);
      cursor += span;
    }
  }

  // End devices parented directly by the coordinator orbit it, inside ring one.
  if (coordMoons.length) {
    const anchor = coordIeee
      ? graph.byIeee.get(coordIeee)
      : { ieee: null, _hx: 0, _hy: 0, _tier: 0 };
    const base = Math.max(70, Math.min(95, (radii.get(1) || RING_BASE) - 70));
    placeMoons(anchor, coordMoons, -Math.PI / 2, base);
  }

  // The halo: devices nothing has claimed yet. Even spread, outermost.
  if (halo.length) {
    const base = (radii.get(maxDepth) || RING_BASE * 0.75) + HALO_PAD;
    let index = 0;
    let shell = 0;
    let left = halo.length;
    while (left > 0) {
      const radius = base + shell * 78;
      const cap = Math.max(6, Math.floor((2 * Math.PI * radius) / RING_SLOT));
      const take = Math.min(cap, left);
      const start = -Math.PI / 2 + shell * 0.37;
      for (let j = 0; j < take; j++, index++) {
        const node = halo[index];
        const ang = start + (j / take) * 2 * Math.PI;
        node._hx = Math.cos(ang) * radius;
        node._hy = Math.sin(ang) * radius;
        node._tier = maxDepth + 1 + shell;
        node._ringR = radius;
      }
      left -= take;
      shell += 1;
    }
  }

  // Anything the walk somehow missed still gets a deterministic seat.
  {
    let strays = 0;
    for (const node of nodes) {
      if (node._hx !== null || node.ieee === coordIeee) continue;
      const radius = (radii.get(maxDepth) || RING_BASE) + HALO_PAD + 160;
      const ang = -Math.PI / 2 + strays * 0.7;
      node._hx = Math.cos(ang) * radius;
      node._hy = Math.sin(ang) * radius;
      node._tier = maxDepth + 3;
      node._ringR = radius;
      strays += 1;
    }
  }

  return result;
}

/**
 * One drawn edge per device pair: the strongest row wins. A pair on the routing
 * tree is structure; every other pair is context. Multiple rows between the same
 * two devices carry no extra geometry, only extra ink, so they are collapsed here
 * -- the asymmetry diagnostic still reads the raw rows off the Graph.
 */
function classifyPairs(graph, parentOf, inferred) {
  const pairs = new Map();
  const treeKeys = new Set();
  for (const [ieee, p] of parentOf) if (p) treeKeys.add(pairKey(ieee, p));
  for (const link of graph.links) {
    const key = pairKey(link.source, link.target);
    const cur = pairs.get(key);
    if (!cur || (link.lqi ?? -1) > (cur.link.lqi ?? -1)) {
      const tree = treeKeys.has(key);
      pairs.set(key, {
        key,
        a: link.source,
        b: link.target,
        link,
        tree,
        inferred: tree && !!inferred && inferred.has(key),
      });
    }
  }
  return pairs;
}

/* ------------------------------------------------------------------- physics */

/**
 * The live simulation. Repulsion, damping and the separation pass are unchanged
 * from the original build -- the map keeps its physical feel, and dragging a node
 * still shoulders its neighbours aside. What changed is what the forces serve:
 *   - springs exist only for routing-tree edges (context rows draw, they do not
 *     pull, so an invisible sibling row can never drag a router sideways);
 *   - each ringed node gets a radial constraint toward its tier's ring, the
 *     d3-forceRadial shape;
 *   - a weak anchor pulls every node toward its deterministic slot, which keeps
 *     ring neighbours from swapping and two opens looking the same. A moon's
 *     anchor tracks its parent's LIVE position, so dragging a router carries its
 *     children with it.
 * There is no canvas clamp: the world is unbounded and the view fits it.
 */
class Simulation {
  constructor(graph) {
    this.graph = graph;
    this.alpha = 1;
    this.springs = [];
  }

  /** Structural springs, assigned with the layout pass. */
  setStructure(springs) {
    this.springs = springs;
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
      }
    }

    // Tree springs only: the structure pulls, the context never does.
    for (const s of this.springs) {
      const a = this.graph.byIeee.get(s.a);
      const b = this.graph.byIeee.get(s.b);
      if (!a || !b) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 0.01;
      const push = (d - s.rest) * s.k;
      const fx = (dx / d) * push;
      const fy = (dy / d) * push;
      a.vx += fx;
      a.vy += fy;
      b.vx -= fx;
      b.vy -= fy;
    }

    for (const node of nodes) {
      // The coordinator holds the origin: firm enough to anchor the map, soft
      // enough that a drag still feels physical and it glides back on release.
      if (node.ieee === this.graph.coordinator) {
        node.vx -= node.x * 0.12;
        node.vy -= node.y * 0.12;
        continue;
      }
      // Tier discipline: routers hold their ring, halo devices hold the halo.
      if (node._ringR != null) {
        const r = Math.hypot(node.x, node.y) || 1;
        const f = (node._ringR - r) * 0.1;
        node.vx += (node.x / r) * f;
        node.vy += (node.y / r) * f;
      }
      // Weak anchor toward the deterministic slot. For moons the anchor rides the
      // parent's live position, so the family moves as one.
      let hx = node._hx;
      let hy = node._hy;
      if (node._orbit) {
        const p = this.graph.byIeee.get(node._orbit.parent);
        if (p) {
          hx = p.x + node._orbit.dx;
          hy = p.y + node._orbit.dy;
        }
      }
      if (hx !== null && hx !== undefined) {
        const k = node._orbit ? 0.03 : 0.012;
        node.vx += (hx - node.x) * k;
        node.vy += (hy - node.y) * k;
      }
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
      moved += Math.abs(dx) + Math.abs(dy);
    }

    this._separate();

    this.alpha *= 0.987;
    return moved > 0.4 || alpha > 0.05;
  }

  /**
   * Guarantee a minimum gap, after every other force has had its say. Two passes
   * because one pass can push a node into a third; more than two buys nothing at
   * this fleet size and starts to look like jitter.
   *
   * The gap is the VISUAL radius, label included, not the circle: a map whose dots
   * are 12px apart with their names written across each other is still unreadable.
   */
  _separate() {
    const nodes = this.graph.nodes;
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < nodes.length; i++) {
        const a = nodes[i];
        for (let j = i + 1; j < nodes.length; j++) {
          const b = nodes[j];
          let dx = b.x - a.x;
          let dy = b.y - a.y;
          let d = Math.sqrt(dx * dx + dy * dy);
          if (d === 0) {
            // Perfectly co-located. Deterministic nudge, so the same fleet always
            // lands the same way.
            dx = ((i % 7) - 3) * 0.7 + 0.35;
            dy = ((j % 5) - 2) * 0.7 + 0.35;
            d = Math.sqrt(dx * dx + dy * dy) || 1;
          }
          const minGap = (a._r || 8) + (b._r || 8) + NODE_CLEARANCE;
          if (d >= minGap) continue;
          const push = (minGap - d) / 2;
          const ux = dx / d;
          const uy = dy / d;
          const aFixed = a.dragging || a.pinned;
          const bFixed = b.dragging || b.pinned;
          // A pinned node does not move, so the other one absorbs the whole gap
          // rather than half of it and staying overlapped.
          if (!aFixed) {
            a.x -= ux * (bFixed ? push * 2 : push);
            a.y -= uy * (bFixed ? push * 2 : push);
          }
          if (!bFixed) {
            b.x += ux * (aFixed ? push * 2 : push);
            b.y += uy * (aFixed ? push * 2 : push);
          }
        }
      }
    }
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
    // Context links are hidden until asked for: the routing tree is the map, the
    // rest of the neighbour rows are the reason the old map looked like string art.
    this._showPeers = false;
    this._frozen = false;
    this._query = '';
    this._matches = null;
    this._selected = null;
    this._hovered = null;
    this._scan = { generated: null, scanning: false, phase: null, done: 0, total: 0 };
    this._view = { x: 0, y: 0, k: 1 };
    this._viewAnim = null;
    this._needsFit = false;
    this._raf = null;
    this._nodeEls = new Map();
    this._linkEls = new Map();
    this._pos = new Map();
    this._pulses = [];
    this._live = null;
    this._probed = null;
    this._parentOf = new Map();
    this._reduceMotion =
      window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this._onResize = () => this._resize();
  }

  set hass(value) {
    this._hass = value;
  }

  set topology(value) {
    this._topology = value;
    // Copies all the way down to the node objects: the graph annotates nodes as it
    // works (positions, failure flags), and the caller's array is its cache.
    this._live = value
      ? { ...value, nodes: (value.nodes || []).map((n) => ({ ...n })), links: [...(value.links || [])] }
      : null;
    if (value?.generated) this._scan.generated = value.generated;
    if (this.isConnected) {
      this._sync({ animate: this._reveal });
      if (!this._userMoved) this._fit();
    }
    this._reveal = false;
  }

  get topology() {
    return this._topology;
  }

  set diagnostics(value) {
    this._diagnostics = !!value;
    if (this.isConnected && this._graph) this._sync({ animate: false, heat: 0.2 });
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
    // A window resize is not the only way this element changes size: as a Lovelace
    // card it resizes when the dashboard column does, and in the panel when the
    // sidebar collapses. It is also how a host that measured 0x0 at mount reports
    // its real size, which is what un-defers a deferred fit.
    if (typeof ResizeObserver === 'function') {
      this._observer = new ResizeObserver(() => this._resize());
      this._observer.observe(this);
    }
    this._loadLayout();
    if (this._live) {
      // Everything streamed while detached is already in _live; draw it now.
      this._sync({ animate: false });
      if (!this._userMoved) this._fit();
    }
    this._renderHud();
  }

  disconnectedCallback() {
    window.removeEventListener('resize', this._onResize);
    if (this._observer) {
      this._observer.disconnect();
      this._observer = null;
    }
    this._stopLoop();
    this._saveLayout();
  }

  /**
   * Consume one event from a streaming scan.
   *
   * The point of streaming: `start` puts every device on screen before any radio
   * traffic -- coordinator centred, routers ringed, end devices in a pending halo
   * -- then each `device` event attaches that device's links and its children
   * glide to their orbits. Nothing ever says "please wait".
   *
   * State is ingested UNCONDITIONALLY. An earlier build returned early when the
   * element happened to be detached (the panel re-hosts it across renders), which
   * silently discarded streamed events; a lost `start` meant every later `device`
   * event was dropped too and the canvas stayed blank until `done` popped the
   * whole graph in at once. Now only the DRAWING is deferred: connectedCallback
   * syncs whatever arrived while detached.
   */
  applyScanEvent(event) {
    if (!event) return;
    if (event.phase === 'start') {
      this._live = {
        coordinator: event.coordinator,
        nodes: (event.nodes || []).map((n) => ({ ...n })),
        links: [],
      };
      this._probed = new Set();
      this._scan = {
        ...this._scan,
        scanning: true,
        phase: 'start',
        done: 0,
        total: event.total || 0,
      };
      this._syncNow({ animate: true, heat: 0.85, fit: 'initial' });
    } else if (event.phase === 'device') {
      if (!this._live) return;
      this._scan = { ...this._scan, done: this._scan.done + 1, phase: 'device' };
      if (event.ieee) this._probed?.add(event.ieee);
      if (event.ok && event.links?.length) {
        const known = new Set(this._live.links.map(linkKey));
        for (const l of event.links) if (!known.has(linkKey(l))) this._live.links.push(l);
        // Modest heat: the new links re-home only the devices they name, so the
        // rest of the graph must not jump.
        this._syncNow({ animate: true, heat: 0.3 });
      } else if (!event.ok) {
        const node = this._live.nodes.find((n) => n.ieee === event.ieee);
        if (node) node.failed = [...(node.failed || []), event.error || 'no reply'];
        this._syncNow({ animate: false, heat: 0.15 });
      } else {
        // Probed clean but reported nothing new: still stops being "pending".
        this._syncNow({ animate: false, heat: 0.1 });
      }
    } else if (event.phase === 'done') {
      this._scan = { ...this._scan, scanning: false, phase: 'done', generated: event.generated };
      this._topology = event;
      this._live = {
        ...event,
        nodes: (event.nodes || []).map((n) => ({ ...n })),
        links: [...(event.links || [])],
      };
      // Reconciled by ieee inside _sync: positions carry over and glide, nothing
      // teleports. The view refit is animated for the same reason.
      this._syncNow({ animate: true, heat: 0.5, fit: 'settle' });
    } else if (event.phase === 'error') {
      this._scan = { ...this._scan, scanning: false, phase: 'error' };
      if (this._live) this._syncNow({ animate: false, heat: 0 });
    }
    if (this._statusEl) this._renderHud();
  }

  /** Draw if attached; otherwise the state waits for connectedCallback. */
  _syncNow({ fit, ...opts }) {
    if (!this.isConnected) return;
    this._sync(opts);
    if (fit === 'initial' && !this._userMoved) this._fit();
    else if (fit === 'settle' && !this._userMoved) this._fit({ animate: true });
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

      /* Edge hierarchy. The routing tree is structure: plain ink, weight by
         quality, red reserved for genuinely weak links. Everything else is
         context: hidden by default, faint when shown, never louder than the
         tree. This is what keeps forty-five devices from becoming string art. */
      .link { fill:none; stroke-linecap:round; transition:opacity .18s ease; }
      .link.tree { stroke:var(--primary-text-color, #212121); }
      .link.tree.strong { stroke-width:1.8; opacity:.5; }
      .link.tree.mid { stroke-width:1.4; opacity:.3; }
      .link.tree.weak { stroke:var(--error-color, #f44336); stroke-width:2.4;
                        opacity:.85; }
      .link.tree.unknown { stroke:var(--disabled-text-color, #bdbdbd);
                           stroke-width:1.4; stroke-dasharray:2 5; opacity:.55; }
      /* An inferred attachment: the device reported no usable parent, so this is
         the strongest measured path to a router, drawn as a hypothesis rather
         than a report. Dotted and amber to match the "inferred path" chip. */
      .link.tree.inferred { stroke:var(--warning-color, #ff9800);
                            stroke-dasharray:1.5 4; stroke-width:1.6; opacity:.6; }
      .link.peer { stroke:var(--secondary-text-color, #727272); stroke-width:1;
                   stroke-dasharray:3 4; opacity:.16; }
      .link.dim { opacity:.06; }
      .link.route { stroke:var(--primary-color, #03a9f4); stroke-width:3.4;
                    opacity:1; stroke-linecap:round; stroke-dasharray:none; }
      /* A traced route may ride a context row; the trace always wins the toggle. */
      svg.hide-peers .link.peer:not(.route) { display:none; }

      .node { cursor:pointer; }
      .halo { fill:none; stroke:var(--primary-color,#03a9f4); stroke-width:2.5;
              opacity:0; transition:opacity .18s ease; }
      .node.on-route .halo, .node.selected .halo, .node.match .halo { opacity:1; }
      .node.match .halo { stroke:var(--accent-color, #ff9800); }
      .body { stroke:var(--card-background-color,#fff); stroke-width:2; }
      .core { fill:var(--card-background-color,#fff); pointer-events:none; }
      .node.coordinator .body { fill:var(--primary-color, #03a9f4); }
      .node.router .body { fill:var(--state-icon-color, #44739e); }
      .node.enddevice .body { fill:var(--secondary-text-color, #727272); }
      .node.offline .body { fill:var(--card-background-color,#fff);
                            stroke:var(--error-color,#f44336);
                            stroke-dasharray:3 3; }
      /* Not heard from in THIS scan yet: present, placed, and visibly waiting.
         This is the progressive-reveal state, never a spinner. */
      .node.pending { opacity:.35; }
      .node.pending text.label { fill:var(--disabled-text-color, #bdbdbd); }
      /* Dimmed context stays readable. Fading it away made one route obvious but
         destroyed the shape of the mesh around it, which is why you opened the map. */
      .node.dim { opacity:.3; }
      /* A device that failed to answer the scan: real, current, worth a ring. */
      .warn-ring { fill:none; stroke:var(--warning-color, #ff9800); stroke-width:2;
                   stroke-dasharray:2 3; }
      /* There is deliberately no ring for a single-path dependency. A red circle
         around a healthy mains router read as "this device is broken", when all it
         meant was that this SNAPSHOT recorded no second route past it. That fact is
         still reported, in the node's own detail panel, in words. */
      .pin-dot { fill:var(--primary-text-color, #212121); opacity:.5; }

      text.label { font-size:var(--ha-font-size-s, 11px); text-anchor:middle;
                   fill:var(--primary-text-color, #212121);
                   paint-order:stroke; stroke:var(--card-background-color, #fff);
                   stroke-width:3px; stroke-linejoin:round;
                   pointer-events:none; user-select:none; }
      /* Every device is named, including battery end devices: the map is used to
         find a specific device, and an unlabelled dot cannot be found. They are
         quieter than a router's name rather than hidden, and any label that would
         collide with another is dropped -- see _cullLabels. The coordinator and
         routers are never dropped. */
      .node.enddevice text.label { font-size:var(--ha-font-size-xs, 10px);
                   fill:var(--secondary-text-color, #727272); }
      .node.crowded text.label { display:none; }
      /* Attention always wins over decluttering. */
      .node.hover text.label,
      .node.selected text.label,
      .node.on-route text.label,
      .node.match text.label { display:block;
                   fill:var(--primary-text-color, #212121); }
      .node.dim text.label { opacity:0; }
      .node:focus { outline:none; }
      .node:focus-visible .halo { opacity:1; stroke:var(--primary-color, #03a9f4); }

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
      .legend i.ln-strong { background:var(--primary-text-color,#212121); opacity:.55; }
      .legend i.ln-mid { background:var(--primary-text-color,#212121); opacity:.28; }
      .legend i.ln-weak { background:var(--error-color,#f44336); }
      .legend i.ln-unknown { background:repeating-linear-gradient(90deg,
                  var(--disabled-text-color,#bdbdbd) 0 3px, transparent 3px 6px); }
      .legend i.ln-inferred { background:repeating-linear-gradient(90deg,
                  var(--warning-color,#ff9800) 0 2px, transparent 2px 6px); }
      .legend b { font-weight:500; color:var(--primary-text-color,#212121); }

      /* Desktop and tablet: parked bottom-right, opposite the legend, so it never
         sits on top of the graph the operator is reading and never moves under the
         pointer. Phones get a bottom sheet instead -- see the media query. */
      .detail { position:absolute; right:8px; bottom:8px;
                width:min(272px, calc(100% - 16px));
                background:var(--card-background-color, #fff);
                border:1px solid var(--divider-color, #e0e0e0);
                border-radius:var(--ha-border-radius-lg, 12px);
                padding:10px 12px;
                box-shadow:var(--ha-card-box-shadow, 0 2px 6px rgba(0,0,0,.18));
                font-size:var(--ha-font-size-m, 13px);
                color:var(--primary-text-color, #212121);
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
      /* Plain explanation, not an alarm: this is a property of the snapshot. */
      .detail .note { color:var(--secondary-text-color, #727272);
                      font-size:var(--ha-font-size-s, 11px); margin:5px 0 0; }
      .hops .v.b1 { color:var(--error-color,#f44336); font-weight:500; }
      .hops .v.b2 { color:#ef6c00; }
      .hops .v.b3 { color:var(--warning-color,#ff9800); }
      .detail a { color:var(--primary-color,#03a9f4); text-decoration:none;
                  cursor:pointer; }
      .detail button.close { all:unset; position:absolute; top:4px; right:6px;
                       display:grid; place-items:center; width:28px; height:28px;
                       border-radius:var(--ha-border-radius-md, 8px); cursor:pointer;
                       color:var(--secondary-text-color, #727272); }
      .detail button.close:hover { background:var(--divider-color, #e0e0e0); }
      .detail button.close:focus-visible { outline:2px solid var(--primary-color, #03a9f4); }
      .warnline { color:var(--error-color,#f44336); font-size:11px; margin:5px 0 0; }

      .empty { position:absolute; inset:0; display:grid; place-items:center;
               text-align:center; padding:24px;
               color:var(--secondary-text-color,#727272); }
      .empty[hidden] { display:none; }

      /* Phone layout. The HUD stacks instead of two clusters colliding at the top,
         and the node detail becomes a bottom sheet that can be scrolled with a
         thumb without dragging the canvas underneath it. */
      @media (max-width:${NARROW_PX}px) {
        .hud.tl { right:8px; flex-wrap:wrap; }
        .hud.tr { top:auto; bottom:8px; right:8px; }
        input.search { width:100%; min-width:96px; }
        button.tool { width:40px; height:40px; }
        .legend { display:none; }
        .detail { left:8px; right:8px; top:auto; bottom:0;
                  width:auto; max-height:52%;
                  border-bottom-left-radius:0; border-bottom-right-radius:0;
                  padding-bottom:calc(10px + var(--safe-area-inset-bottom, 0px));
                  touch-action:pan-y; }
      }
    `;

    const stage = document.createElement('div');
    stage.className = 'stage';

    const svg = svgEl('svg');
    const viewport = svgEl('g', { class: 'viewport' });
    // Paint order bottom-up: context links, tree links, pulses, nodes. The tree
    // must sit above the context so structure is never buried under it.
    this._gPeers = svgEl('g', { class: 'peers' });
    this._gLinks = svgEl('g', { class: 'links' });
    this._gPulses = svgEl('g', { class: 'pulses' });
    this._gNodes = svgEl('g', { class: 'nodes' });
    viewport.append(this._gPeers, this._gLinks, this._gPulses, this._gNodes);
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
      `<button class="tool" data-act="peers" aria-pressed="false" title="Show neighbour links">${this._icon(ICON.peers)}</button>` +
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
    if (node.ieee === this._graph.coordinator) return 14;
    if (node.type === 'Router') {
      // A busy router is a bigger landmark. Capped: size is a hint, not a chart.
      return 8.5 + Math.min(3, (node._kids || 0) * 0.35);
    }
    return 5.5;
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
   * identity and only genuinely new ones animate in. Positions carry over by ieee;
   * layout targets are recomputed and the simulation glides everyone there.
   */
  _sync({ animate, heat } = {}) {
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

    if (!this._sim) this._sim = new Simulation(this._graph);
    else this._sim.graph = this._graph;

    // Deterministic radial-tree targets; the live forces do the rest.
    const layout = assignHomes(this._graph);
    this._parentOf = layout.parentOf;
    const pairs = classifyPairs(this._graph, layout.parentOf, layout.inferred);
    this._inferredCount = layout.inferred.size;

    // Keep known positions, seat new nodes straight on their layout slot.
    for (const node of this._graph.nodes) {
      const saved = this._pos.get(node.ieee);
      if (saved && Number.isFinite(saved.x)) {
        node.x = saved.x;
        node.y = saved.y;
        node.pinned = !!saved.pinned;
      } else {
        node.x = node._hx ?? 0;
        node.y = node._hy ?? 0;
        node.pinned = false;
      }
      node.vx = node.vx || 0;
      node.vy = node.vy || 0;
      node.dragging = false;
    }

    // Structural springs: tree edges only. Moons rest at their orbit, routers at
    // their ring gap, so the springs and the radial constraints agree.
    const springs = [];
    for (const [, pair] of pairs) {
      if (!pair.tree) continue;
      const a = this._graph.byIeee.get(pair.a);
      const b = this._graph.byIeee.get(pair.b);
      if (!a || !b) continue;
      const child = this._parentOf.get(a.ieee) === b.ieee ? a : b;
      const parent = child === a ? b : a;
      const rest = child._orbitR || Math.max(90, (child._ringR || 0) - (parent._ringR || 0));
      // Moons are sprung harder: repulsion would otherwise balloon the orbit and
      // blur which router a device belongs to. Trunk links stay soft; the radial
      // constraint owns ring placement.
      springs.push({ a: pair.a, b: pair.b, rest, k: child._orbitR ? 0.09 : 0.05 });
    }
    this._sim.setStructure(springs);

    this._choke = new Map(this._graph.chokePoints().map((c) => [c.ieee, c.stranded]));

    const now = performance.now();
    const wantAnimate = animate && !this._reduceMotion;
    const scanning = !!this._scan.scanning;

    // Links: one element per device pair, tree above context.
    const seenPairs = new Set();
    for (const [key, pair] of pairs) {
      seenPairs.add(key);
      let entry = this._linkEls.get(key);
      if (!entry) {
        entry = { el: svgEl('line', { class: 'link' }), appear: wantAnimate ? Math.max(1, now) : 0 };
        this._linkEls.set(key, entry);
      }
      entry.link = pair.link;
      entry.a = pair.a;
      entry.b = pair.b;
      entry.el.setAttribute(
        'class',
        `link ${pair.tree ? 'tree' : 'peer'}${pair.inferred ? ' inferred' : ''} ${linkTone(pair.link.lqi)}`
      );
      const host = pair.tree ? this._gLinks : this._gPeers;
      if (entry.el.parentNode !== host) host.append(entry.el);
      // Stamp endpoints immediately: the first paint after a streamed event must
      // already show the attachment, not wait for a later frame.
      const a = this._graph.byIeee.get(pair.a);
      const b = this._graph.byIeee.get(pair.b);
      entry.el.setAttribute('x1', a.x.toFixed(1));
      entry.el.setAttribute('y1', a.y.toFixed(1));
      entry.el.setAttribute('x2', b.x.toFixed(1));
      entry.el.setAttribute('y2', b.y.toFixed(1));
    }
    for (const [key, entry] of [...this._linkEls]) {
      if (!seenPairs.has(key)) {
        entry.el.remove();
        this._linkEls.delete(key);
      }
    }

    // Nodes, painted so routers and the coordinator sit above end devices.
    const ordered = [...this._graph.nodes].sort((a, b) => this._rank(a) - this._rank(b));
    const seenNodes = new Set();
    for (const node of ordered) {
      seenNodes.add(node.ieee);
      node._r = this._radius(node);

      let els = this._nodeEls.get(node.ieee);
      if (!els) {
        const g = svgEl('g', { class: 'node' });
        const halo = svgEl('circle', { class: 'halo' });
        // No dependency ring: it read as a fault on healthy hardware.
        const warn = svgEl('circle', { class: 'warn-ring' });
        const body = svgEl('circle', { class: 'body' });
        const core = svgEl('circle', { class: 'core', r: 0 });
        const pin = svgEl('circle', { class: 'pin-dot', r: 1.8 });
        const label = svgEl('text', { class: 'label' });
        g.append(halo, warn, body, core, pin, label);
        g.dataset.ieee = node.ieee;
        // Reachable and operable from the keyboard, not just the mouse.
        g.setAttribute('role', 'button');
        g.setAttribute('tabindex', '0');
        // The reveal ripples outward by tier: coordinator, rings, moons, halo.
        els = {
          g,
          body,
          core,
          halo,
          warn,
          pin,
          label,
          // max(1, ...): zero is the "not animating" sentinel, and a clock that
          // reads exactly 0 must not silently skip the coordinator's reveal.
          appear: wantAnimate ? Math.max(1, now + Math.min(480, (node._tier || 0) * 90)) : 0,
        };
        this._nodeEls.set(node.ieee, els);
        this._gNodes.append(g);
        // Stamp the position now: a node must be at its seat on the very first
        // paint, even if the animation loop has not run yet.
        g.setAttribute('transform', `translate(${node.x.toFixed(1)} ${node.y.toFixed(1)})`);
        if (els.appear) g.style.opacity = '0';
      }
      els.node = node;
      els.halo.setAttribute('r', node._r + 5);
      els.warn.setAttribute('r', node._r + 3);
      els.body.setAttribute('r', node._r);
      els.core.setAttribute('r', node.ieee === this._graph.coordinator ? 4 : 0);
      els.pin.setAttribute('cy', -node._r - 6);
      els.label.setAttribute('y', node._r + 13);
      // Truncated for the canvas only. The full name stays on the group's
      // accessible name, so search, hover and assistive tech all still see it.
      els.label.textContent = labelText(node.name || node.ieee);
      els.g.setAttribute('aria-label', node.name || node.ieee);
      els.pin.style.display = node.pinned ? '' : 'none';

      const kind =
        node.ieee === this._graph.coordinator
          ? 'coordinator'
          : node.type === 'Router'
            ? 'router'
            : 'enddevice';
      // "Pending" is a statement about THIS scan: the device is known and seated,
      // but no reply has mentioned it yet.
      const pending =
        scanning &&
        node.ieee !== this._graph.coordinator &&
        !this._probed?.has(node.ieee) &&
        !(this._graph.adj.get(node.ieee) || []).length;
      els.g.setAttribute(
        'class',
        `node ${kind}${node.availability === 'offline' ? ' offline' : ''}${pending ? ' pending' : ''}`
      );
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
    this._sim.reheat(heat ?? (wantAnimate ? 0.85 : 0.5));
    this._startLoop();
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
    const inferred = this._inferredCount || 0;

    // Three tones and unknown, matching the drawn edges. The words carry the
    // diagnostics; the lines stay calm.
    const bits = [
      `<span><i class="ln-strong"></i>good</span>`,
      `<span><i class="ln-mid"></i>fair</span>`,
      `<span><i class="ln-weak"></i>weak</span>`,
      `<span><i class="ln-unknown"></i>unmeasured</span>`,
      // Only when one is actually drawn: most opens have a complete tree, and a
      // legend entry for an edge that is not on screen is noise.
      ...(inferred
        ? [
            `<span title="No parent was reported for these devices; the dotted amber edge is the strongest measured path instead."><i class="ln-inferred"></i>inferred</span>`,
          ]
        : []),
    ];
    if (this._diagnostics) {
      if (weak) bits.push(`<span><b>${weak}</b> weak</span>`);
      // "choke" was jargon attached to a red ring nobody could interpret. The
      // count stays, in the map's own words, without marking any device as faulty.
      if (chokes) bits.push(`<span><b>${chokes}</b> single-path</span>`);
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
    const routePairs = new Set();
    if (this._selected && this._route) {
      onRoute.add(this._selected);
      for (const hop of this._route.hops) {
        onRoute.add(hop.from);
        onRoute.add(hop.to);
        routePairs.add(pairKey(hop.from, hop.to));
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
      const isRoute = routePairs.has(key);
      entry.el.classList.toggle('route', isRoute);
      entry.el.classList.toggle('dim', narrowed && !isRoute);
    }
  }

  /**
   * Hide only the labels that would actually collide with one already drawn.
   *
   * Every device is named by default, which on a dense mesh means some names would
   * overlap. The old answer was to hide EVERY end device's name, which made the
   * common task -- find this specific sensor -- impossible. This hides a name only
   * when its own box overlaps a box already kept, in a fixed priority order, so the
   * result is stable rather than flickering between frames. The coordinator and
   * routers are structural landmarks and are never dropped.
   *
   * Cheap and deliberately not per-frame: it runs when the layout settles, on
   * selection, search, zoom and resize.
   */
  _cullLabels() {
    if (!this._graph) return;
    const scale = this._view.k || 1;
    // Priority: whatever the operator is interested in, then the landmarks, then
    // the rest by a stable key.
    const priority = (node) => {
      if (node.ieee === this._selected || node.ieee === this._hovered) return 0;
      if (this._matches?.has(node.ieee)) return 1;
      if (node.ieee === this._graph.coordinator) return 2;
      return node.type === 'Router' ? 3 : 4;
    };
    const ordered = [...this._graph.nodes].sort(
      (a, b) => priority(a) - priority(b) || (a.ieee < b.ieee ? -1 : 1)
    );

    const kept = [];
    for (const node of ordered) {
      const els = this._nodeEls.get(node.ieee);
      if (!els) continue;
      const text = els.label.textContent || '';
      // World-space box of the drawn label, converted to screen space so the
      // decision matches what the operator can actually read at this zoom.
      const halfW = (text.length * LABEL_CHAR_HALF_WIDTH + 2) * scale;
      const halfH = 7 * scale;
      const cx = node.x * scale;
      const cy = (node.y + node._r + 13) * scale;
      const box = { x1: cx - halfW, x2: cx + halfW, y1: cy - halfH, y2: cy + halfH };
      // The coordinator and routers are always named; so is anything the operator
      // has picked out. Only end-device labels compete for space.
      const always = priority(node) <= 3;
      const clash =
        !always &&
        kept.some((k) => box.x1 < k.x2 && box.x2 > k.x1 && box.y1 < k.y2 && box.y2 > k.y1);
      els.g.classList.toggle('crowded', clash);
      if (!clash) kept.push(box);
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
        this._viewAnim = null;
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

    // Keyboard parity with the pointer. The nodes are focusable, so Enter and
    // Space select, and Escape clears -- the same gesture as clicking the canvas.
    stage.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') {
        if (this._selected) {
          this._select(null);
          ev.preventDefault();
        }
        return;
      }
      if (ev.key !== 'Enter' && ev.key !== ' ') return;
      const hit = ev.target.closest?.('.node');
      if (!hit) return;
      ev.preventDefault();
      this._select(hit.dataset.ieee === this._selected ? null : hit.dataset.ieee);
    });

    stage.addEventListener('focusin', (ev) => {
      const hit = ev.target.closest?.('.node');
      if (!hit) return;
      // Focus reveals the name, the same way hovering does.
      if (this._hovered) this._nodeEls.get(this._hovered)?.g.classList.remove('hover');
      this._hovered = hit.dataset.ieee;
      this._nodeEls.get(this._hovered)?.g.classList.add('hover');
      this._applyEmphasis();
      this._cullLabels();
    });
  }

  _action(act, button) {
    const rect = this._stage.getBoundingClientRect();
    if (act === 'zoom-in') this._zoomTo(this._view.k * 1.25, rect.width / 2, rect.height / 2);
    else if (act === 'zoom-out') this._zoomTo(this._view.k / 1.25, rect.width / 2, rect.height / 2);
    else if (act === 'fit') {
      this._userMoved = false;
      this._fit({ animate: true });
    } else if (act === 'peers') {
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
    this._viewAnim = null;
    const next = clamp(k, 0.2, 4);
    const scale = next / this._view.k;
    this._view.x = ax - (ax - this._view.x) * scale;
    this._view.y = ay - (ay - this._view.y) * scale;
    this._view.k = next;
    this._applyTransform();
  }

  /**
   * Fit the world to the canvas.
   *
   * Never against a degenerate rect: a host that is hidden or not yet laid out
   * measures 0x0, and a fit computed from that wedges the view on a corner sliver
   * -- which is exactly the blank-canvas-then-pop bug this map used to have. Such
   * a fit is deferred; the ResizeObserver delivers the real size and _resize
   * retries. The world layout itself never depends on the rect at all.
   */
  _fit({ animate = false } = {}) {
    if (!this._graph?.nodes.length) return;
    const rect = this._stage.getBoundingClientRect();
    if (rect.width < 50 || rect.height < 50) {
      this._needsFit = true;
      return;
    }
    this._needsFit = false;
    const xs = this._graph.nodes.map((n) => n.x);
    const ys = this._graph.nodes.map((n) => n.y);
    // Pad for the HUD strips so nothing important hides behind them.
    const w = Math.max(...xs) - Math.min(...xs) + 120;
    const h = Math.max(...ys) - Math.min(...ys) + 130;
    const k = clamp(Math.min(rect.width / w, rect.height / h), 0.2, 1.6);
    const to = {
      k,
      x: rect.width / 2 - ((Math.min(...xs) + Math.max(...xs)) / 2) * k,
      y: rect.height / 2 - ((Math.min(...ys) + Math.max(...ys)) / 2) * k,
    };
    if (animate && !this._reduceMotion) {
      this._viewAnim = { from: { ...this._view }, to, start: performance.now() };
      this._startLoop();
    } else {
      this._viewAnim = null;
      this._view = to;
      this._applyTransform();
    }
  }

  _applyTransform() {
    this._viewport.setAttribute(
      'transform',
      `translate(${this._view.x} ${this._view.y}) scale(${this._view.k})`
    );
    // Labels are culled in screen space, so a pan or a zoom changes which of them
    // collide.
    this._cullLabels();
  }

  /**
   * The element changed size. The world layout is size-independent, so nothing
   * about the physics needs to move -- but the VIEW does: refit unless the
   * operator has taken the camera, and always retry a fit that was deferred
   * because the host measured 0x0.
   */
  _resize() {
    if (!this._graph) return;
    if (this._needsFit || !this._userMoved) this._fit();
    else this._cullLabels();
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
          ? '<span class="chip inferred" title="This device reported no parent in the neighbour tables, so the map shows the strongest measured path instead. It is drawn dotted and amber on the mesh.">inferred path</span>'
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
      `<button class="close" type="button" aria-label="Clear selection">&times;</button>` +
      `<h3>${escapeHtml(node.name || node.ieee)}</h3>` +
      `<div class="sub">${escapeHtml(node.ieee)}</div>` +
      chip +
      `<dl>${rows.map(([k, v]) => `<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd>`).join('')}</dl>` +
      (hopList ? `<ul class="hops">${hopList}</ul>` : '') +
      // Stated as what it is -- a property of THIS snapshot -- rather than drawn as
      // a red ring that made a working router look broken.
      (stranded
        ? `<p class="note">Only route: in this scan, ${stranded} device${
            stranded === 1 ? ' reaches' : 's reach'
          } the coordinator only through this one.</p>`
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

    // The camera glide used after `done`: the graph must not teleport, and
    // neither should the view.
    if (this._viewAnim) {
      const anim = this._viewAnim;
      const t = clamp((now - anim.start) / 260, 0, 1);
      const e = 1 - Math.pow(1 - t, 3);
      this._view = {
        x: anim.from.x + (anim.to.x - anim.from.x) * e,
        y: anim.from.y + (anim.to.y - anim.from.y) * e,
        k: anim.from.k + (anim.to.k - anim.from.k) * e,
      };
      this._applyTransform();
      if (t >= 1) this._viewAnim = null;
      else busy = true;
    }

    for (const [, els] of this._nodeEls) {
      const node = els.node;
      if (!node) continue;
      let scale = 1;
      if (els.appear) {
        const t = clamp((now - els.appear) / 240, 0, 1);
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
      const a = this._graph.byIeee.get(entry.a);
      const b = this._graph.byIeee.get(entry.b);
      if (!a || !b) continue;
      entry.el.setAttribute('x1', a.x.toFixed(1));
      entry.el.setAttribute('y1', a.y.toFixed(1));
      entry.el.setAttribute('x2', b.x.toFixed(1));
      entry.el.setAttribute('y2', b.y.toFixed(1));
      if (entry.appear) {
        // Draw the link on, so a device visibly attaches to its router.
        const t = clamp((now - entry.appear) / 320, 0, 1);
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
    // Once. Recomputing which labels collide on every animation frame would both
    // cost more than the physics and make names blink while the layout moves.
    if (!busy) {
      this._cullLabels();
    }
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
