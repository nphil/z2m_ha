# Zigbee for Home Assistant (Zigbee2MQTT)

Gives Zigbee2MQTT the same kind of first-class surface in Home Assistant that
**Z-Wave JS** and **ZHA** have: an entry under *Settings → Devices & Services*, a
`mdi:zigbee` sidebar panel, and a dashboard for managing devices — without leaving
Home Assistant for Zigbee2MQTT's own web UI.

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

**Topology** — the map is not reimplemented here. If
[`ha-zigbee-map`](https://codeberg.org/dan-danache/ha-zigbee-map) is installed, the
dashboard links to it. Note it needs `advanced.enable_external_js: true` in
Zigbee2MQTT, because it installs a Zigbee2MQTT extension to collect LQI.

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
