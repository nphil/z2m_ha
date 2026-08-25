/**
 * Tests the map's decision-making, not its pixels.
 *
 * The renderer is verified by eye against the live network, but the graph logic makes
 * claims about the operator's own mesh -- which device reaches the hub through which
 * router, and which single failure would strand devices. A silent bug there is worse
 * than a missing feature, because it is believable. So the parts that reason are
 * tested against hand-built topologies whose right answer is known.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(
  join(here, '..', 'custom_components/z2m/panel/z2m-map.js'),
  'utf8'
);

// The module registers custom elements and a Lovelace card at load, so stub only
// what that top-level work touches.
globalThis.HTMLElement = class {};
globalThis.customElements = { get: () => undefined, define: () => {} };
globalThis.window = { customCards: [] };

const { Graph, Simulation, hopCost, restLength, lqiBand, labelText, NODE_CLEARANCE } =
  new Function(
    `${src}\nreturn { Graph, Simulation, hopCost, restLength, lqiBand, labelText, NODE_CLEARANCE };`
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
  check('a strong link rests closer than a weak one', restLength(255) < restLength(10));

  // A cycle in reported parents must not hang the walk.
  const g3 = new Graph({
    coordinator: COORD,
    nodes: [node(COORD, 'Coordinator'), node('0x00a', 'Router'), node('0x00b', 'Router')],
    links: [link('0x00a', '0x00b', 200, 1), link('0x00b', '0x00a', 200, 1)],
  });
  const route = g3.routeToCoordinator('0x00a');
  check('a parent cycle does not hang and reports no path', route.kind === 'none');
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

  // A node with no links at all must never be reported as a choke point.
  const orphan = new Graph({
    coordinator: COORD,
    nodes: [node(COORD, 'Coordinator'), node('0x00lone', 'Router')],
    links: [],
  });
  check('an unconnected device is not a choke point', orphan.chokePoints().length === 0);
}

/* --------------------------------------------------- dense streaming layout */
//
// A streamed scan creates every device BEFORE any link exists. That used to put
// the whole fleet on one ring at fallback depth, so a dense mesh appeared with
// devices and names drawn on top of each other. The separation pass now runs after
// the forces are integrated, so this is checkable rather than a matter of taste.
{
  const nodes = [node(COORD, 'Coordinator')];
  for (let i = 0; i < 44; i++) {
    nodes.push(node(`0x00dense${String(i).padStart(2, '0')}`, i % 3 === 0 ? 'Router' : 'EndDevice'));
  }
  const graph = new Graph({ coordinator: COORD, nodes, links: [] });
  // Radii, as the renderer assigns them.
  for (const n of graph.nodes) {
    n._r = n.ieee === COORD ? 13 : n.type === 'Router' ? 9 : 6.5;
    n.x = 0;
    n.y = 0;
    n.vx = 0;
    n.vy = 0;
  }

  const worstGap = () => {
    let worst = Infinity;
    for (let i = 0; i < graph.nodes.length; i++) {
      for (let j = i + 1; j < graph.nodes.length; j++) {
        const a = graph.nodes[i];
        const b = graph.nodes[j];
        const need = a._r + b._r + NODE_CLEARANCE;
        worst = Math.min(worst, Math.hypot(b.x - a.x, b.y - a.y) - need);
      }
    }
    return worst;
  };

  // Every device starting at the same point is the pathological case, and it is
  // exactly what a `start` event with no links produces.
  check('co-located nodes start overlapped', worstGap() < 0);

  const sim = new Simulation(graph, 1200, 800);
  for (let i = 0; i < 240; i++) sim.step();
  const gap = worstGap();
  check('a dense fleet ends up with drawable separation', gap >= -0.5, `worst gap ${gap.toFixed(1)}`);
  check('nodes stay inside the canvas', graph.nodes.every((n) =>
    n.x >= 0 && n.x <= 1200 && n.y >= 0 && n.y <= 800));

  // Determinism: the same fleet must not land somewhere different each visit.
  const again = new Graph({ coordinator: COORD, nodes, links: [] });
  for (const n of again.nodes) {
    n._r = n.ieee === COORD ? 13 : n.type === 'Router' ? 9 : 6.5;
    n.x = 0;
    n.y = 0;
    n.vx = 0;
    n.vy = 0;
  }
  const sim2 = new Simulation(again, 1200, 800);
  for (let i = 0; i < 240; i++) sim2.step();
  check('the same fleet settles the same way', again.nodes.every((n, i) =>
    Math.abs(n.x - graph.nodes[i].x) < 0.001 && Math.abs(n.y - graph.nodes[i].y) < 0.001));

  // A pinned node is the operator's decision and must not be shoved aside.
  const pinnedGraph = new Graph({
    coordinator: COORD,
    nodes: [node(COORD, 'Coordinator'), node('0x00pinned', 'Router')],
    links: [],
  });
  for (const n of pinnedGraph.nodes) {
    n._r = 9;
    n.x = 400;
    n.y = 300;
    n.vx = 0;
    n.vy = 0;
  }
  const held = pinnedGraph.byIeee.get('0x00pinned');
  held.pinned = true;
  const sim3 = new Simulation(pinnedGraph, 900, 600);
  for (let i = 0; i < 60; i++) sim3.step();
  check('a pinned node keeps its position', held.x === 400 && held.y === 300);
  const other = pinnedGraph.byIeee.get(COORD);
  check('the unpinned node absorbs the whole gap',
    Math.hypot(other.x - held.x, other.y - held.y) >= 9 + 9 + NODE_CLEARANCE - 0.5);
}

/* ------------------------------------------------------- label and semantics */
{
  check('a long name is truncated for the canvas',
    labelText('Master Bedroom Ceiling Fan Light').length <= 18);
  check('truncation is marked, not silent',
    labelText('Master Bedroom Ceiling Fan Light').endsWith('\u2026'));
  check('a short name is left alone', labelText('Porch Sensor') === 'Porch Sensor');

  // Names are shown for EVERY device now. Hiding them is a per-label collision
  // decision made at runtime, never a rule about the device's type.
  check('end devices are not hidden by type', !/\.node\.enddevice text\.label \{[^}]*display:none/
    .test(src));
  check('crowding is what hides a label', src.includes('.node.crowded text.label { display:none; }'));

  // The red ring around powered routers is gone: it marked a snapshot property as
  // if it were a device fault.
  check('no dependency ring is drawn', !src.includes('choke-ring'));
  check('the dependency fact survives as words', src.includes('Only route: in this scan'));
  check('a scan failure still gets its own ring', src.includes('.warn-ring'));

  // The detail card is placed against the node, and closable from the keyboard.
  check('the detail card is positioned, not parked', src.includes('_positionDetail'));
  check('the close affordance is a real button',
    src.includes('<button class="close" type="button" aria-label="Clear selection">'));
  check('nodes are keyboard reachable', src.includes("g.setAttribute('tabindex', '0')"));
  check('Escape clears the selection', src.includes("ev.key === 'Escape'"));
  check('the element observes its own size', src.includes('ResizeObserver'));
  check('there is a phone layout', src.includes('@media (max-width:'));
}

console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
