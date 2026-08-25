/**
 * Local override for the Wyze WLCKG1 (Yunding "Ford") lock.
 *
 * WHY THIS EXISTS
 * The shipped definition declares `exposes: [e.lock(), e.battery()]` -- which is
 * what zigbee2mqtt.io/devices/WLCKG1.html is generated from, and why that page
 * promises you can read state with {"state": ""} -- but its inbound converters are
 * only [fz.battery, fzLocal.wyzeLockRaw]. Nothing consumes the STANDARD
 * closuresDoorLock replies.
 *
 * Captured on the live device with Z2M at debug level:
 *   No converter available for 'WLCKG1' with cluster 'closuresDoorLock'
 *     and type 'readResponse' and data '{"lockState":1}'
 *   No converter available for 'WLCKG1' with cluster 'closuresDoorLock'
 *     and type 'commandLockDoorRsp' and data '{"status":0}'
 *
 * The lock answers correctly; Z2M discards the answer. Adding fz.lock makes the
 * read reply and the command response populate `state` / `lock_state`.
 *
 * IMPORTANT: this APPENDS to the built-in definition rather than replacing it.
 * The built-in `fzLocal.wyzeLockRaw` parser handles the manufacturer-specific
 * cluster 64512 frames, which is the plausible path for physical keypad and manual
 * operation events. Those frames arrive constantly on this unit. Rewriting
 * fromZigbee from scratch would drop that parser -- and for a door lock, "someone
 * unlocked it by hand" matters more than an on-demand read. So the built-in list is
 * spread and fz.lock is added after it; the raw parser keeps priority and the two
 * handle different clusters, so they do not compete.
 */
import { definitions as wyzeDefinitions } from "zigbee-herdsman-converters/devices/wyze";
import * as fz from "zigbee-herdsman-converters/converters/fromZigbee";

const base = wyzeDefinitions.find((d) => d.model === "WLCKG1");

if (!base) {
    // Fail loudly: a silent partial definition on a lock is worse than no override.
    throw new Error("WLCKG1 not found in the built-in Wyze definitions; override aborted");
}

export default {
    ...base,
    description: `${base.description} (local override: also reads standard lock state)`,
    fromZigbee: [...base.fromZigbee, fz.lock],
};
