# Zigbee integration repair WIP

Saved 2026-08-25 after the operator requested that current work be preserved.

## Confirmed live failures

- `z2m/devices` fails on Home Assistant 2026.8.3 because MQTT device identifiers can contain three fields; `ieee_from_identifiers` unpacked exactly two.
- The panel intentionally waits 1,500 ms for lazy HA elements before fetching data. Measured live dashboard readiness: 2,073 ms.
- `_refresh()` uses one `Promise.all`, so one failed feed produces the global `Unknown error` banner and discards successful feeds.

## Saved changes

- `coordinator.ieee_from_identifiers` now tolerates identifiers with metadata fields and reads only the structural domain/identifier pair.
- Added dedicated pairing, device-projection, and group dispatcher constants plus `bridge/event` topic support.
- `Z2MData` now subscribes to `bridge/event`, normalizes/caches pairing state per IEEE address, reconciles retained interview state, and emits dedicated pairing/device/group signals.
- Availability updates emit the device-projection signal without triggering Zigbee label reconciliation.
- `z2m-panel.js` contains a partial nonblocking bootstrap/scoped-feed refactor from the UI editing pass. It passes `node --check`, but its behavior still needs review and tests before deployment.

## Required completion

1. Finish backend websocket wiring:
   - `z2m/pairing`, `z2m/pairing/subscribe`, `z2m/devices/subscribe`, `z2m/groups/subscribe`.
   - Response-aware, serialized `z2m/permit_join`, device rename, group create/rename/remove, and group member add/remove.
   - Add `device_id`, normalized endpoint IDs, and map `power_source` projections.
2. Finish the panel:
   - Remove the fake FAB and put Add device beside Show map.
   - Complete the event-driven pairing helper, live diagnostic logs, safe automatic close, post-pair Z2M name plus native HA area/name update.
   - Complete group create/edit/delete/member UI.
   - Extend render fixtures/tests and verify every view/theme/mobile state.
3. Finish the map:
   - Subdued end-device labels with collision suppression.
   - Non-overlapping dense loading seeds and post-integration collision pass.
   - Inspector adjacent to the selected node; mobile bottom sheet.
   - Remove red choke-point rings; retain dependency facts only in text.
   - Responsive/themed controls and keyboard accessibility.
4. Bump the manifest version, update the existing README, run validation, snapshot VM 102, deploy to `/config/custom_components/z2m`, restart HA, and verify the live panel/API/map and startup/resource impact.

## Source-verified Zigbee2MQTT 2.13 contracts

- Pair lifecycle: non-retained `bridge/event` with `device_joined` and `device_interview` (`started`, `failed`, `successful`). Key sessions by IEEE; never use `last:true`.
- Groups: `group/add`, `group/rename`, `group/remove`, `group/members/add`, `group/members/remove`. Use response transactions, then reconcile retained `bridge/groups`.
- Group member operations require an explicit device endpoint. Default normal group removal; force removal is recovery-only because it can leave physical endpoint membership behind.

## Validation already run on saved WIP

- `node --check custom_components/z2m/panel/z2m-panel.js` — passed.
- `python3 -m py_compile custom_components/z2m/const.py custom_components/z2m/coordinator.py` — passed.
- No live deployment, HA restart, pairing-window mutation, group mutation, commit push, or release was performed.
