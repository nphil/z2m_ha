# Zigbee device-management parity — handoff

> Read this first. It states what is done and deployed, what is in flight, and what is
> outstanding, so a resumed session does not re-derive any of it.

Written **2026-08-25**. Live instance: Home Assistant **2026.8.3** at `192.168.1.146`,
Zigbee2MQTT **2.13.0**, 42 devices. Repo `/data/home/z2m_ha`, branch `main`.

## How this integration is deployed

Manual install, not HACS. The running copy is inside the HA container at
`/config/custom_components/z2m`. Deploying is: push the changed file into the container,
then restart HA only if Python changed. The panel's module URL carries the manifest
version (`?v=1.3.0`), which is what busts a cached module on the household's iPads — so
**bump `manifest.json` when frontend behaviour changes**, or a phone keeps the old panel.

Verify a deploy by hashing both sides, never by assuming:

```
docker exec homeassistant sh -c 'cd /config/custom_components/z2m && sha256sum panel/z2m-panel.js'
```

## Done and verified live

- **Add device is a native `ha-dialog`** — watches before it touches the radio; join
  through any router or one chosen router (Z2M's `device` parameter on `permit_join`);
  60/120/254s window; expiry states itself and re-offers the choices; Stop and Close are
  distinct; the debug log level is released by the backend even if the tab just closes.
  Shipped as 1.3.0.
- **Every control the operator edits is a real HA component.** This fixed the reported
  mobile faults on the device page, Options, and the dialog. Verified at 390×844 in dark
  theme against the live instance.

### Two measured facts that constrain any further UI work

1. **`ha-textfield` is not registered** in the frontend bundle this panel loads into on
   2026.8.3, and never becomes defined. Anything built on it renders an empty row. Use
   `ha-form` with a `text` selector instead — `ha-form` *is* registered and brings its
   own field. The only exception is the device search, which uses `ha-textfield` when
   defined and otherwise a styled native input.
2. **Never force a width on an HA control inside `ha-settings-row`.** `width:100%`
   collapses the row's heading to zero — the identical failure to the original bug. Let
   HA size its own controls, and pass `narrow` to the row on a phone.

## In flight

`BackendParity` (subagent) owns `websocket_api.py`, `coordinator.py`, `const.py` and is
implementing the whole websocket surface below. It has already landed `option_values`
(current per-device option values, merged from `bridge/info`'s `config.device_options`
and `config.devices[<ieee>]` — they are **not** on the device entry) and corrected the
`scenes`/`bindings`/`clusters` projections to read per **endpoint**.

Its source-verified API notes are at `local://z2m-api-2.13.md` — read that before
writing any view. Four findings that change UI design:

1. **A partly-failed bind answers `status: "ok"`** with successes in `clusters` and
   failures in `failed`. Render `failed`, or a half-broken bind shows a tick.
2. **Configuring reporting silently creates a bind** (`endpoint.bind(...)` runs first),
   so the bind list grows after a reporting write. Say so in the UI.
3. **`scene_recall` takes a bare number**; `scene_store` takes a number or
   `{ID, name?, group_id?}`; scene id 0 with group id 0 is reserved and throws;
   `scene_remove_all` ignores its value.
4. **OTA `update` is answered only when the transfer finishes** (minutes). Refusals
   arrive in milliseconds. Progress is on the device's own state topic under `update`,
   which is **not retained** — so "no state yet" is an expected UI case, not an error.

## Outstanding — the actual remaining work

Frontend only; the backend commands are being built now. Each view is its own ES module
under `custom_components/z2m/panel/`, registering one custom element, mounted by the
panel. The panel assigns `.hass`, `.z2m` (`{call, subscribe, devices, groups, dev,
navigate}`) and `.target`.

| View | Element | Commands | Notes |
|---|---|---|---|
| OTA progress | `z2m-ota-view` | `z2m/ota/subscribe`, `/check`, `/update`, `/schedule`, `/unschedule` | Fleet counts; live per-device progress patched in place; indeterminate when unknown; warn before updating a battery device |
| Binding | `z2m-bind-view` | `z2m/device/binds`, `/clusters`, `/bind`, `/unbind` | Group by source endpoint; plain-English cluster names beside identifiers; render partial failure |
| Reporting | `z2m-reporting-view` | `z2m/device/clusters`, `/configure_reporting` | min/max/reportable-change with consequences in helper text; intent presets; reject min > max; note the implicit bind |
| Scenes | `z2m-scenes-view` | `z2m/scenes`, `/scene/store`, `/recall`, `/remove`, `/remove_all` | Store captures present state; recall acts immediately; remove-all confirmed and unrecoverable; group writes hit every member |
| Touchlink | `z2m-touchlink-view` | `z2m/touchlink/scan`, `/identify`, `/factory_reset` | Proximity requirement stated before acting; empty result is normal; nearest-device reset separated and separately confirmed |

Navigation to wire once the modules exist: device page gains **Bindings**, **Scenes**,
**Reporting** rows; the top level gains **Touchlink**; the Firmware view becomes the OTA
view.

## Working rules for this repo

- Tests are `node tests/render.test.mjs` and `node tests/map.test.mjs`; both must print
  `ALL CHECKS PASSED`. New views get their own test file in the same harness style.
- The harness's `HA_ELEMENTS` deliberately mirrors reality: `ha-form`, `ha-select`,
  `ha-list-item`, `ha-settings-row` defined; `ha-textfield` **not**.
- The panel renders into a persistent `#app` container. Do not render into the shadow
  root directly — that detaches the dialog, and mwc reads detach as hide.
- `ha-form` state lives in `this._forms[key]`, survives re-render, and is marked
  `touched` once the operator types, so a retained push cannot overwrite what they are
  editing.
