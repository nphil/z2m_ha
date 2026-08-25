# Zigbee for Home Assistant (Zigbee2MQTT)

Gives Zigbee2MQTT the same kind of first-class surface in Home Assistant that
**Z-Wave JS** and **ZHA** have: an entry under *Settings → Devices & Services* whose
**Configure** button opens a dashboard for managing the network — without leaving Home
Assistant for Zigbee2MQTT's own web UI.

There is deliberately **no sidebar item**. Z-Wave JS does not add one either; a hub
integration belongs behind its entry, not in the navigation. The panel is wired with
`config_panel_domain`, which is the frontend's own mechanism for this — it resolves the
Configure link by matching `config_panel_domain` against the integration domain.

Zigbee2MQTT already exposes every device as MQTT entities. What it does not give you
is a *Home Assistant–native place to manage the network*: rename a device, change its
per-device settings, reconfigure it, re-interview it, check firmware, remove it, or
open the network for pairing. That is what this integration adds.

## Status

Working and in daily use against Zigbee2MQTT **2.13** with 45 devices. Written to be
tweaked — see [Design notes](#design-notes) before changing things.

## Requirements

| Needs | Why |
| --- | --- |
| Home Assistant **2026.6** or newer | `config_panel_domain` panel registration |
| Zigbee2MQTT **2.x** | The `bridge/request/*` API shape this targets |
| The **MQTT** integration configured | This integration speaks MQTT through it |

No Python dependencies, no build step, no bundled frontend framework.

## Install

**HACS** → three-dot menu → *Custom repositories* → add this repo as category
**Integration** → install → restart Home Assistant.

**Manually**: copy `custom_components/z2m` into your `<config>/custom_components/`
and restart.

Then *Settings → Devices & Services → Add integration → **Zigbee***. The only
question is the MQTT base topic, which must match `mqtt.base_topic` in your
Zigbee2MQTT `configuration.yaml` (default `zigbee2mqtt`).

To open it afterwards: *Settings → Devices & Services → **Zigbee** → Configure*. It is
not in the sidebar by design, and the panel URL is `/z2m` if you want to bookmark or
iframe it.

## What you get

**Dashboard** — bridge state, device count, offline count, Zigbee2MQTT version, and a
banner when Zigbee2MQTT is holding a pending restart.

**Devices** — searchable list of every device with vendor, model, availability and a
battery marker.

**Device page** — identity (IEEE, network address, firmware build, whether
Zigbee2MQTT has a converter for it), rename, and a **settings form generated from
Zigbee2MQTT's own per-device `options` schema**. Nothing is hard-coded per model: if
Zigbee2MQTT reports a numeric/binary/enum/text option for a device, it renders with
that device's own label, description and bounds.

**Maintenance** — reconfigure, re-interview, check for firmware update, and remove
(with an explicit force path, which is honest about needing a factory reset before the
device can join anywhere again).

**Network** — coordinator type and firmware, channel, PAN ID, extended PAN ID, log
level. The network key is deliberately never shown.

**Map** — a force-directed view of the mesh. Opening it draws **every device at
once**, from the retained device list, and then fills in the links device by device
as each router answers, rather than showing a wait message and a blank canvas. Drag
any device to pull the layout around; double-click to pin it (pinned positions
persist). Links are coloured by LQI, and neighbours that are not parent or child are
drawn faint, so the solid lines are the ones that describe actual tree structure.

Select a device and the map traces **its path to the coordinator**, dimming
everything else. The label on that path is deliberate:

- *Parent chain* — every hop came from a reported parent/child relationship. For an
  end device this is how its traffic really leaves, because end devices talk only to
  their parent.
- *Strongest known path* — the tree was incomplete, so this is inferred from link
  quality. Routers pick routes dynamically, so live traffic may differ. The map says
  so rather than implying certainty it does not have.

A scan walks the coordinator's and every router's neighbour table — 15 of the 45
devices on the network it was built against; end devices hold no neighbour table and
reach the map through their parent's. Requests are paced (at most two outstanding, at
least a second apart) because what hurts a mesh is a burst, not a request. The result
is **cached** (10 minutes by default) and opening the map reads that cache: visiting
the page does not re-probe the mesh. A scan runs when there is nothing cached yet —
the first open after a restart — or when you ask for one. What changed is that the
first scan is no longer a button and a waiting message: it starts by itself and you
watch it happen.

Streaming it needs a per-device neighbour-table query, which Zigbee2MQTT's
first-party endpoint does not offer — that one walks every router inside a single
request and answers once, at the end. So the integration installs an extension
(`z2m_ha_lqi.js`, ~180 lines, in this repository) into Zigbee2MQTT **once, on setup,
and leaves it installed**. That is the opposite of what the integration this replaces
did: it saved its extension when the panel opened and removed it when the panel
closed, so every visit re-walked every router. Persisting one file is what removes
that.

Installing needs `advanced.enable_external_js`. With it off, nothing is installed —
the integration logs that once and the map uses Zigbee2MQTT's own scan instead: the
fleet is still drawn immediately, and the links arrive in one batch at the end rather
than device by device.

**Diagnostics on the map** — weak links, devices that failed to answer the scan,
links whose two directions disagree by 40 LQI or more, and **choke points**: routers
whose loss would strand other devices, with a count of how many. That last one is the
question worth asking of a mesh — a weak link with a spare route beside it is not a
problem, and a strong link that everything depends on is.

**Map as a dashboard card** — the same element is registered as a Lovelace card, so
it can go on any dashboard. It appears in the card picker as *Zigbee map*, or by YAML:

```yaml
type: custom:z2m-map-card
height: 420        # optional, pixels
diagnostics: true  # optional
title: Zigbee mesh # optional
```

No resource registration is needed — the integration serves the file and registers it
with the frontend itself. The card reads the cached scan and will never trigger one.

## Contributed device fixes (`contrib/`)

Not installed by the integration. These are Zigbee2MQTT **external converters** for
specific devices whose upstream definition is incomplete, kept here so the fix is
versioned rather than living only in a runtime config directory that a rebuild would
wipe. Install one with:

```bash
mosquitto_pub -t zigbee2mqtt/bridge/request/converter/save \
  -m "$(jq -Rn --rawfile c contrib/external_converters/wyze_lock_state.js \
        '{name:"wyze_lock_state.js", code:$c}')"
```

…or paste it into `<z2m config>/external_converters/`. Requires
`advanced.enable_external_js: true`.

### `wyze_lock_state.js` — Wyze WLCKG1 lock never reports state

**Symptom.** Commands appear to work but `state` stays `null` forever, so Home
Assistant shows the lock as `unknown`. Re-pairing, re-interviewing and reconfiguring
all change nothing, because none of them are the problem.

**Cause.** The upstream definition declares `exposes: [e.lock(), e.battery()]` — which
is what [the device page](https://www.zigbee2mqtt.io/devices/WLCKG1.html) is generated
from, and why it tells you to read state with `{"state": ""}` — but its inbound list is
`[fz.battery, fzLocal.wyzeLockRaw]`, with no `fz.lock`. Nothing consumes the standard
`closuresDoorLock` replies. Captured at debug level on a real device:

```
No converter available for 'WLCKG1' with cluster 'closuresDoorLock'
  and type 'readResponse' and data '{"lockState":1}'
No converter available for 'WLCKG1' with cluster 'closuresDoorLock'
  and type 'commandLockDoorRsp' and data '{"status":0}'
```

The lock answers correctly, including `status: 0` for a successful lock command. Z2M
discards both. The doc page cannot show this, because the generator reads `exposes`
and never inspects `fromZigbee`.

**Fix.** Import the built-in definition and **append** `fz.lock`. It deliberately does
not rewrite `fromZigbee`: `fzLocal.wyzeLockRaw` handles the manufacturer cluster
(`64512`), which is the likely path for keypad and manual operation, and on a door lock
that signal matters more than an on-demand read. Both parsers stay live and handle
different clusters.

**Caveat.** This lock refuses reporting configuration (`bindRsp` times out), so state
refreshes when something asks, not by itself. Check whether physical operation emits a
raw frame before adding a poll. Separately, if the device re-announces frequently it
will take a new network address each time and commands sent to the cached one will time
out — that is a mesh problem (put a router near it), not this one.

## Design notes

**No polling.** Zigbee2MQTT publishes `bridge/info`, `bridge/devices`, `bridge/groups`
and `bridge/state` as *retained* MQTT topics, so a fresh subscription is handed the
current picture immediately, and every later change arrives as a push. The coordinator
is a mirror of those topics — there is no request/response polling loop, and it
recovers by itself when Zigbee2MQTT restarts.

**The browser never speaks MQTT.** The panel calls WebSocket commands, which is how
the built-in `zwave_js` panel talks to its integration:

| Command | Purpose |
| --- | --- |
| `z2m/info` | Bridge summary |
| `z2m/devices`, `z2m/groups` | Mirrored inventory |
| `z2m/subscribe` | Push updates to the panel |
| `z2m/networkmap` | The cached topology, scanning only when stale or forced |
| `z2m/networkmap/scan` | Runs a scan and pushes it out device by device as it happens |
| `z2m/permit_join` | Open/close joining |
| `z2m/device/rename`, `/options`, `/configure`, `/interview`, `/remove` | Device management |
| `z2m/ota/check` | Firmware check |
| `z2m/health_check`, `z2m/backup`, `z2m/restart` | Bridge actions |

All writes require an admin user.

**Frontend is plain DOM, styled with Home Assistant's own CSS custom properties**
(`--card-background-color`, `--ha-card-border-radius`, `--app-header-background-color`,
`--divider-color`, …) rather than Lit or a bundled framework. That is a deliberate
trade: no build step and no vendored dependency to keep current, and theming, dark
mode and touch sizing are inherited from Home Assistant instead of reimplemented — so
it behaves on phones and wall tablets, not just desktop. Device names are HTML-escaped
on the way in, since they are user-controlled strings.

### Zigbee2MQTT quirks this had to learn the hard way

- `bridge/request/permit_join` reads **only `time`** and throws `Invalid payload` if it
  is absent. The old boolean `value` is gone. Closing the network is `time: 0`.
- Joining state is published as **`permit_join_end`** (epoch milliseconds), not a
  countdown, so the remaining time is derived client-side.
- Zigbee2MQTT **rewrites `configuration.yaml`** whenever settings change, stripping
  comments and inserting its own `version:` migration marker. Do not expect
  hand-authored structure in that file to survive.

## Tests

```sh
node tests/render.test.mjs
```

Loads the panel in Node against a stubbed DOM and a synthetic fixture, then asserts
that every view renders, that the generated settings form covers each declared option,
that the network key is withheld, and that buttons emit the right commands. The fixture
is synthetic on purpose — a public repo should not carry a real device inventory.

CI additionally runs Home Assistant's `hassfest` and HACS validation.

## Not implemented

Honest list, so you know what you would be adding: OTA update progress UI, group
create/edit/membership, binding and reporting configuration, scene management,
touchlink, coordinator backup download, and Zigbee2MQTT's own settings editor. Device
*settings* are covered; bridge *configuration* is not.

## License

MIT — see [LICENSE](LICENSE).
