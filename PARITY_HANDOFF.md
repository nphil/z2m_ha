# Zigbee device-management parity — handoff

> Read this first. It states what is done and deployed, what the constraints are, and
> what is left, so a resumed session does not re-derive any of it.

Written **2026-08-25**. Live instance: Home Assistant **2026.8.3** at `192.168.1.146`,
Zigbee2MQTT **2.13.0**, 42 devices. Repo `/data/home/z2m_ha`, branch `main`.
**Deployed and live: 1.5.1, installed and managed by HACS.**

## How this integration is deployed

**HACS owns `/config/custom_components/z2m`.** It was added as a HACS *custom
repository* (category Integration) and downloaded at a release tag, so the update path
is HACS's own: publish a release, HACS raises `update.zigbee_zigbee2mqtt_update`, the
operator presses Update, HA restarts.

That makes **releases the unit of deployment**, not commits:

1. Change code, bump `version` in `custom_components/z2m/manifest.json`, commit, push.
2. Wait for the `Validate` workflow (hassfest + HACS + the two render suites) to pass.
3. `gh release create vX.Y.Z --title … --notes-file …` — the tag must be `v` + the
   manifest version, and `--target` needs the **full** commit SHA; an abbreviated one is
   rejected as an invalid `target_commitish`.
4. Update from HACS (or the update entity). HA restart is required for Python changes.

The manifest version also rides in the panel's module URL (`?v=1.5.1`), which is what
busts a cached module on the household's iPads — so **bump it whenever frontend
behaviour changes**, or a phone keeps the old panel.

**Do not hand-push files into `/config/custom_components/z2m` any more.** HACS deletes
and rewrites that directory on every update, so a hand-edit is silently discarded the
next time anyone presses Update, and until then the running code does not match any
tag. For a fast local iteration loop, edit, then re-download the same version through
HACS to get back to a known state.

Verify what is actually running by hashing the deployed tree against the repo:

```
ssh -i ~/.ssh/hassos_ed25519 nphilip89@192.168.1.146 \
  'cd /config/custom_components/z2m && find . -type f ! -path "*__pycache__*" -exec sha256sum {} \;'
```

## Done and verified live

- **Add device is a native `ha-dialog`** — watches before it touches the radio; join
  through any router or one chosen router (Z2M's `device` parameter on `permit_join`);
  60/120/254 s window; expiry states itself and re-offers the choices; Stop and Close are
  distinct; the debug log level is released by the backend even if the tab just closes.
  Shipped 1.3.0.
- **Every control the operator edits is a real HA component.** This is the fix for the
  reported mobile faults on the device page, Options and the dialog. Verified at 390×844
  in dark theme against the live instance. Shipped 1.4.0.
- **Firmware is a fleet view.** Counts across the fleet — updating, update available,
  never assessed, offline, up to date, plus how many devices report no OTA support at all
  — with rows grouped in that order. A transfer draws a determinate bar at the reported
  percentage and an indeterminate one while Z2M has said nothing, never a fake 0%. `-1`
  renders as an em dash, not a version. Shipped 1.4.0.
- **Bindings.** Per device, grouped by source endpoint; coordinator and groups named as
  such; a target that has left the network still listed; plain-English cluster names
  beside their identifiers; create form narrowed to each endpoint's bindable set;
  endpoints that can bind nothing left out. Z2M's partial-failure `failed` list is
  rendered, so a half-done bind cannot show a tick. Verified live against a real Inovelli
  VZM31-SN with six real binds. Shipped 1.5.0.
- **The whole backend for Contract A is done, deployed and smoke-tested live** — 17
  commands. `z2m/device/clusters`, `z2m/device/binds` and `z2m/scenes` were exercised
  against the real bridge and return real data.

## Constraints measured on this build — do not relearn these the hard way

1. **`ha-textfield` is not registered** in the frontend bundle this panel loads into, and
   never becomes defined. Anything built on it renders an empty row. Use `ha-form` with a
   `text` selector; `ha-form` *is* registered and brings its own field. The only exception
   is the device search, which uses `ha-textfield` when defined and otherwise a styled
   native input.
2. **Never force a width on an HA control inside `ha-settings-row`.** `width:100%`
   collapses that row's heading to zero — the identical failure to the original bug. Let
   HA size its own controls and pass `narrow` on a phone.
3. **The panel renders into a persistent `#app` container.** Do not render into the shadow
   root directly: that detaches the pair dialog, and mwc reads detach as hide.
4. **`ha-form` state lives in `this._forms[key]`**, survives re-render, and is marked
   `touched` once the operator types, so a retained push cannot overwrite what they are
   editing.

## Zigbee2MQTT 2.13 facts that shape the remaining UI

Full source-cited reference: `local://z2m-api-2.13.md` (§9 has the exact response JSON
for every command).

1. **A partly-failed bind answers `status: "ok"`** — successes in `clusters`, refusals in
   `failed`. Render both.
2. **Configuring reporting silently creates a coordinator bind** first, so the bind list
   grows after a reporting write. Say so, and refresh binds after.
3. **`scene_recall` takes a bare number**; `scene_store` takes a number or
   `{ID, name?, group_id?}`; scene 0 with group 0 is reserved and throws;
   `scene_remove_all` ignores its value.
4. **OTA `update` is answered only when the transfer finishes** (minutes); refusals arrive
   in milliseconds, so the command answers `{accepted:true}` after an 8 s refusal window
   and hands off to `z2m/ota/subscribe`. Progress is on the device's own state topic under
   `update`, which is **not retained** — "no state yet" is an expected UI case.
5. **The scene id field is `scene`, not `id`** — HA's websocket envelope owns `id`, so a
   command taking `id` as a parameter loses it silently. Same reason the other commands
   take `device` / `group`.

## Outstanding — the actual remaining work

Frontend only. Build each the way the bindings screen is built: an in-panel view,
`ha-form` for input, a route in `_title` / `_bodyFor` / `_enter` / `_back`, dispatch
cases, and tests appended at the **end** of `tests/render.test.mjs` — inserting mid-file
perturbs the sequenced map and log state.

| Screen | Commands | The points that matter |
|---|---|---|
| Reporting | `z2m/device/clusters`, `z2m/device/configure_reporting` | min / max / reportable-change, each with its consequence in helper text and its unit named; intent presets that stay editable; reject min > max locally; note the implicit coordinator bind; sleeping battery devices refuse until they wake. `configured_reportings[].attribute` can be an int — render either shape |
| Scenes | `z2m/scenes`, `z2m/scene/store` / `recall` / `remove` / `remove_all` | store captures the device's PRESENT state; recall acts immediately and answers `confirmed_by: null` deliberately; remove-all is unrecoverable and needs an `ha-dialog` confirmation naming the count; a group write hits every member |
| Touchlink | `z2m/touchlink/scan` / `identify` / `factory_reset` | proximity requirement on screen BEFORE any action; scan takes ~10–13 s and stalls the mesh, so say so; an empty result is the normal outcome, not an error; `factory_reset` takes both ieee+channel or neither |
| OTA push | `z2m/ota/subscribe`, `/update`, `/schedule`, `/unschedule` | the fleet view exists and reads HA's update entities; what is left is subscribing for live push instead, and surfacing `latest_release_notes` |

Navigation still to add: **Scenes** and **Reporting** rows on the device page (Bindings is
done), and **Touchlink** at the top level.

## Working rules

- `node tests/render.test.mjs` and `node tests/map.test.mjs` must both print
  `ALL CHECKS PASSED`.
- The harness's `HA_ELEMENTS` deliberately mirrors reality: `ha-form`, `ha-select`,
  `ha-list-item`, `ha-settings-row` defined; `ha-textfield` **not**.
- Verify UI work with a real screenshot at 390×844 and at desktop width, against the live
  instance, not against the test harness.
