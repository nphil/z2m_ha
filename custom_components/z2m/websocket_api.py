"""WebSocket API for the Zigbee panel.

The panel never speaks MQTT directly -- a browser cannot. It calls these commands,
mirroring how the built-in zwave_js panel talks to its integration.
"""

from __future__ import annotations

import json
import logging
from typing import Any

import voluptuous as vol

from homeassistant.components import mqtt, websocket_api
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers import device_registry as dr, entity_registry as er
from homeassistant.helpers.dispatcher import async_dispatcher_connect

from .const import (
    BACKUP_TIMEOUT,
    DOMAIN,
    OTA_ACCEPT_WINDOW,
    REQUEST_TIMEOUT,
    SIGNAL_DEVICE_LIST,
    SIGNAL_GROUPS,
    SIGNAL_LOG,
    SIGNAL_MAP,
    SIGNAL_OTA,
    SIGNAL_PAIRING,
    SIGNAL_UPDATE,
    TOUCHLINK_LOCK,
    TOUCHLINK_TIMEOUT,
)
from .coordinator import Z2MError, ieee_from_identifiers

# Zigbee2MQTT refused the request, or never answered it.
ERR_Z2M = "z2m_error"

_LOGGER = logging.getLogger(__package__)


def _data(hass: HomeAssistant):
    """The single Z2MData instance, or None when the entry is not loaded."""
    store = hass.data.get(DOMAIN) or {}
    for value in store.values():
        if hasattr(value, "device_list"):
            return value
    return None


@callback
def async_setup_websocket(hass: HomeAssistant) -> None:
    for handler in (
        ws_info,
        ws_devices,
        ws_groups,
        ws_subscribe,
        ws_devices_subscribe,
        ws_groups_subscribe,
        ws_pairing,
        ws_pairing_subscribe,
        ws_networkmap,
        ws_networkmap_scan,
        ws_networkmap_subscribe,
        ws_logs,
        ws_logs_subscribe,
        ws_coordinator_check,
        ws_health,
        ws_energy_scan_run,
        ws_energy_scan_status,
        ws_energy_scan_list,
        ws_energy_scan_delete,
        ws_permit_join,
        ws_rename,
        ws_group_add,
        ws_group_rename,
        ws_group_remove,
        ws_group_member_add,
        ws_group_member_remove,
        ws_remove,
        ws_set_options,
        ws_read_values,
        ws_configure,
        ws_interview,
        ws_health_check,
        ws_backup,
        ws_ota_check,
        ws_ota_update,
        ws_ota_abort,
        ws_ota_schedule,
        ws_ota_unschedule,
        ws_ota_subscribe,
        ws_bind,
        ws_unbind,
        ws_binds,
        ws_binds_overview,
        ws_clusters,
        ws_configure_reporting,
        ws_touchlink_scan,
        ws_touchlink_identify,
        ws_touchlink_factory_reset,
        ws_scenes,
        ws_scene_store,
        ws_scene_recall,
        ws_scene_remove,
        ws_scene_remove_all,
        ws_set_log_level,
        ws_restart,
    ):
        websocket_api.async_register_command(hass, handler)


def _guard(func):
    """Return a clean websocket error rather than a traceback.

    Two failure modes fold in here: the entry not being loaded, and Zigbee2MQTT
    refusing or simply not answering a request. Neither is a bug worth a stack
    trace in the log, and both are things the panel should be able to render.
    """

    async def wrapper(hass, connection, msg):
        data = _data(hass)
        if data is None:
            connection.send_error(msg["id"], "not_loaded", "Zigbee entry is not loaded")
            return
        try:
            await func(hass, connection, msg, data)
        except Z2MError as err:
            connection.send_error(msg["id"], ERR_Z2M, str(err))
        except Exception as err:  # noqa: BLE001
            # A bug in one command must not blank the whole panel. Home Assistant's
            # own decorator answers a bare "Unknown error", which is what made a
            # three-field device identifier look like a dead integration; this says
            # which command failed and still logs the traceback for diagnosis.
            _LOGGER.exception("Zigbee command %s failed", msg.get("type"))
            connection.send_error(
                msg["id"], "z2m_internal_error", f"{type(err).__name__}: {err}"
            )

    wrapper.__name__ = func.__name__
    return wrapper


# --------------------------------------------------------------------- reads

@websocket_api.websocket_command({vol.Required("type"): "z2m/info"})
@websocket_api.async_response
@_guard
async def ws_info(hass, connection, msg, data) -> None:
    connection.send_result(msg["id"], data.summary())


@websocket_api.websocket_command({vol.Required("type"): "z2m/devices"})
@websocket_api.async_response
@_guard
async def ws_devices(hass, connection, msg, data) -> None:
    connection.send_result(msg["id"], _with_update_entities(hass, data.device_list()))


def _with_update_entities(hass: HomeAssistant, devices: list[dict]) -> list[dict]:
    """Attach each device's Home Assistant `update` entity id.

    Z2M's MQTT discovery already gives every OTA-capable device an `update` entity,
    and the MQTT integration keeps installed_version / latest_version / in_progress /
    update_percentage on it from the per-device topics. Reusing that beats
    subscribing to another 47 topics to parse the same numbers a second time, and it
    means the panel and HA's own update UI can never disagree.

    Devices are matched through the one shared identifier helper in coordinator.py
    rather than a second copy of the parsing here, so the panel and the label
    machinery can never disagree about which registry device is which Zigbee device.
    """
    dev_reg = dr.async_get(hass)
    ent_reg = er.async_get(hass)

    by_ieee: dict[str, str] = {}
    for entry in dev_reg.devices.values():
        if (ieee := ieee_from_identifiers(entry.identifiers)) is not None:
            by_ieee[ieee] = entry.id

    out = []
    for device in devices:
        entity_id = None
        device_id = by_ieee.get(device.get("ieee_address"))
        if device_id is not None:
            for entity in er.async_entries_for_device(
                ent_reg, device_id, include_disabled_entities=True
            ):
                if entity.domain == "update":
                    entity_id = entity.entity_id
                    break
        # `device_id` is what lets the panel hand a freshly paired device to Home
        # Assistant's own registry: naming and area assignment are registry writes,
        # and they need the registry's id rather than the Zigbee address.
        out.append({**device, "update_entity": entity_id, "device_id": device_id})
    return out


@websocket_api.websocket_command({vol.Required("type"): "z2m/groups"})
@websocket_api.async_response
@_guard
async def ws_groups(hass, connection, msg, data) -> None:
    connection.send_result(msg["id"], data.groups)


@websocket_api.websocket_command({vol.Required("type"): "z2m/subscribe"})
@websocket_api.async_response
@_guard
async def ws_subscribe(hass, connection, msg, data) -> None:
    """Push a fresh summary whenever any retained bridge topic changes."""

    @callback
    def _forward() -> None:
        connection.send_message(
            websocket_api.event_message(msg["id"], {"summary": data.summary()})
        )

    connection.subscriptions[msg["id"]] = async_dispatcher_connect(
        hass, SIGNAL_UPDATE, _forward
    )
    connection.send_result(msg["id"])
    _forward()


@websocket_api.websocket_command({vol.Required("type"): "z2m/devices/subscribe"})
@websocket_api.async_response
@_guard
async def ws_devices_subscribe(hass, connection, msg, data) -> None:
    """Push the device projection whenever the inventory or availability changes.

    Separate from z2m/subscribe on purpose: the summary carries counts, so a device
    that was renamed, joined, left or went offline changes the header and nothing
    else. The panel's device list, group member picker and pairing view all read
    this, which is what removes the guessed delay after every write.
    """

    @callback
    def _forward() -> None:
        connection.send_message(
            websocket_api.event_message(
                msg["id"], {"devices": _with_update_entities(hass, data.device_list())}
            )
        )

    connection.subscriptions[msg["id"]] = async_dispatcher_connect(
        hass, SIGNAL_DEVICE_LIST, _forward
    )
    connection.send_result(msg["id"])
    _forward()


@websocket_api.websocket_command({vol.Required("type"): "z2m/groups/subscribe"})
@websocket_api.async_response
@_guard
async def ws_groups_subscribe(hass, connection, msg, data) -> None:
    """Push the group list whenever Zigbee2MQTT republishes bridge/groups.

    Membership is the authoritative answer to a member write, and it arrives after
    the command response: Z2M sends the Zigbee command, answers, and only then
    republishes the retained topic. Reading it from here is what makes the group UI
    correct rather than optimistic.
    """

    @callback
    def _forward() -> None:
        connection.send_message(
            websocket_api.event_message(msg["id"], {"groups": data.groups})
        )

    connection.subscriptions[msg["id"]] = async_dispatcher_connect(
        hass, SIGNAL_GROUPS, _forward
    )
    connection.send_result(msg["id"])
    _forward()


@websocket_api.require_admin
@websocket_api.websocket_command({vol.Required("type"): "z2m/pairing"})
@websocket_api.async_response
@_guard
async def ws_pairing(hass, connection, msg, data) -> None:
    connection.send_result(msg["id"], data.pairing_snapshot())


@websocket_api.require_admin
@websocket_api.websocket_command({vol.Required("type"): "z2m/pairing/subscribe"})
@websocket_api.async_response
@_guard
async def ws_pairing_subscribe(hass, connection, msg, data) -> None:
    """Join and interview progress, snapshot first, with Zigbee2MQTT turned up.

    bridge/event is NOT retained, so a browser that reloads between "joined" and
    "interview successful" would otherwise see nothing at all for a device that is
    mid-pairing. The snapshot is what makes the helper survive a reload; the events
    after it are the live progress.

    Raising the log level lives HERE rather than in the panel, and that placement is
    the whole point. At `info` a failed join says almost nothing -- the interview
    conversation is debug -- but debug across a 42-device mesh must not outlive the
    screen that wanted it. A browser cannot promise that: closing the tab, reloading
    or losing Wi-Fi all skip whatever cleanup the page intended, and the bridge is
    left shouting forever. Home Assistant, on the other hand, always tears a
    subscription down -- including when the socket dies -- so the level goes back
    even if the laptop lid closes.
    """

    @callback
    def _forward(payload: dict[str, Any]) -> None:
        connection.send_message(websocket_api.event_message(msg["id"], payload))

    detach = async_dispatcher_connect(hass, SIGNAL_PAIRING, _forward)
    await data.async_pairing_verbose_acquire()

    @callback
    def _unsubscribe() -> None:
        detach()
        data.async_pairing_verbose_release()

    connection.subscriptions[msg["id"]] = _unsubscribe
    connection.send_result(msg["id"])
    _forward(data.pairing_message())


# ----------------------------------------------------------------- network map
#
# Admin policy in this file, stated once: reads that only expose the device
# inventory are open, because the map is also a Lovelace card and ordinary
# dashboards are read by non-admin users. Anything that makes the radio work, and
# anything that can echo raw MQTT payloads, requires admin.


@websocket_api.websocket_command(
    {
        vol.Required("type"): "z2m/networkmap",
        vol.Optional("force", default=False): bool,
        vol.Optional("cached_only", default=False): bool,
    }
)
@websocket_api.async_response
@_guard
async def ws_networkmap(hass, connection, msg, data) -> None:
    """The topology, served from cache unless it is stale or a scan is demanded.

    `force` is admin-only: a forced scan has the coordinator interrogate every
    router for tens of seconds, which is the one thing here a dashboard viewer
    should not be able to set off. `cached_only` is the opposite promise: never
    scan, hand back whatever cache exists even when stale, so opening the map
    costs nothing on the radio.
    """
    if msg["force"] and not connection.user.is_admin:
        connection.send_error(
            msg["id"],
            websocket_api.ERR_UNAUTHORIZED,
            "Forcing a network scan requires an administrator",
        )
        return
    connection.send_result(
        msg["id"],
        await data.async_networkmap(force=msg["force"], cached_only=msg["cached_only"]),
    )


@websocket_api.websocket_command({vol.Required("type"): "z2m/networkmap/subscribe"})
@websocket_api.async_response
@_guard
async def ws_networkmap_subscribe(hass, connection, msg, data) -> None:
    """Push scan phase changes: idle -> scanning -> done, or error."""

    @callback
    def _forward(phase: dict[str, Any]) -> None:
        connection.send_message(websocket_api.event_message(msg["id"], phase))

    connection.subscriptions[msg["id"]] = async_dispatcher_connect(
        hass, SIGNAL_MAP, _forward
    )
    connection.send_result(msg["id"])
    # Where we are right now, so a page that loads mid-scan does not claim idle.
    _forward(
        {
            "phase": "scanning" if data.map_scanning else "idle",
            "generated": data.map_generated,
            "error": None,
        }
    )


@websocket_api.require_admin
@websocket_api.websocket_command({vol.Required("type"): "z2m/networkmap/scan"})
@websocket_api.async_response
@_guard
async def ws_networkmap_scan(hass, connection, msg, data) -> None:
    """Run a scan and push it out as it happens.

    Admin, like `force` on z2m/networkmap and for the same reason: this makes the
    coordinator interrogate every router, which is not something a dashboard viewer
    should be able to set off.

    The event sequence is `start` (the whole fleet, from the retained device list,
    before any radio traffic), then one `device` per probed router as its neighbour
    table lands, then `done` with the complete topology. A second caller joins the
    scan already running rather than starting another one.
    """

    @callback
    def _forward(event: dict[str, Any]) -> None:
        connection.send_message(websocket_api.event_message(msg["id"], event))

    connection.send_result(msg["id"])
    # Registered as a subscription, so the listener is dropped when the client
    # unsubscribes or the connection goes away. The walk itself carries on: it is
    # refreshing the cache that makes the next page load instant.
    connection.subscriptions[msg["id"]] = data.async_scan_attach(_forward)


# ------------------------------------------------------------------------ logs

@websocket_api.require_admin
@websocket_api.websocket_command({vol.Required("type"): "z2m/logs"})
@websocket_api.async_response
@_guard
async def ws_logs(hass, connection, msg, data) -> None:
    """The bridge/logging ring buffer, oldest first.

    Admin-only: at info level Z2M logs every MQTT publish, payload included, so
    these lines carry rather more than the device inventory does.
    """
    connection.send_result(msg["id"], {"entries": list(data.logs)})


@websocket_api.require_admin
@websocket_api.websocket_command({vol.Required("type"): "z2m/logs/subscribe"})
@websocket_api.async_response
@_guard
async def ws_logs_subscribe(hass, connection, msg, data) -> None:
    """Push each new bridge/logging line as it lands."""

    @callback
    def _forward(entry: dict[str, Any]) -> None:
        connection.send_message(websocket_api.event_message(msg["id"], entry))

    connection.subscriptions[msg["id"]] = async_dispatcher_connect(
        hass, SIGNAL_LOG, _forward
    )
    connection.send_result(msg["id"])


@websocket_api.require_admin
@websocket_api.websocket_command({vol.Required("type"): "z2m/coordinator_check"})
@websocket_api.async_response
@_guard
async def ws_coordinator_check(hass, connection, msg, data) -> None:
    """Routers the coordinator has lost track of.

    Slow: measured 43 s against the live bridge, because it walks the
    coordinator's own tables. An empty list is the healthy answer.
    """
    connection.send_result(
        msg["id"], {"missing_routers": await data.async_coordinator_check()}
    )


@websocket_api.require_admin
@websocket_api.websocket_command({vol.Required("type"): "z2m/health"})
@websocket_api.async_response
@_guard
async def ws_health(hass, connection, msg, data) -> None:
    """The retained bridge/health snapshot, verbatim, with its arrival time.

    Admin like the log commands: the payload echoes raw per-device counters
    keyed by IEEE address. `received_at` is epoch seconds, or null before the
    first health publish lands.
    """
    connection.send_result(
        msg["id"],
        {"received_at": data.health_received_at, "health": data.health or None},
    )


# ------------------------------------------------------------------ energy scan
#
# The scan stops the whole Zigbee2MQTT add-on to borrow the radio, so `run` is a
# deliberate maintenance action that takes the mesh down for about a minute. All
# of the orchestration lives in Z2MData.async_energy_scan; the command holds the
# websocket open for the duration (up to five minutes) and answers with the saved
# record, and the scan itself survives the browser giving up early.


@websocket_api.require_admin
@websocket_api.websocket_command({vol.Required("type"): "z2m/energy_scan/run"})
@websocket_api.async_response
@_guard
async def ws_energy_scan_run(hass, connection, msg, data) -> None:
    connection.send_result(msg["id"], await data.async_energy_scan())


@websocket_api.require_admin
@websocket_api.websocket_command({vol.Required("type"): "z2m/energy_scan/status"})
@websocket_api.async_response
@_guard
async def ws_energy_scan_status(hass, connection, msg, data) -> None:
    connection.send_result(msg["id"], data.energy_scan_status())


@websocket_api.require_admin
@websocket_api.websocket_command({vol.Required("type"): "z2m/energy_scan/list"})
@websocket_api.async_response
@_guard
async def ws_energy_scan_list(hass, connection, msg, data) -> None:
    connection.send_result(msg["id"], {"scans": await data.async_energy_scan_list()})


@websocket_api.require_admin
@websocket_api.websocket_command(
    # `scan`, not `id`: the envelope owns `id`. See the device-command NOTE below.
    {vol.Required("type"): "z2m/energy_scan/delete", vol.Required("scan"): str}
)
@websocket_api.async_response
@_guard
async def ws_energy_scan_delete(hass, connection, msg, data) -> None:
    connection.send_result(
        msg["id"], {"deleted": await data.async_energy_scan_delete(msg["scan"])}
    )


# -------------------------------------------------------------------- writes

@websocket_api.require_admin
@websocket_api.websocket_command(
    {
        vol.Required("type"): "z2m/permit_join",
        # Z2M 2.x reads ONLY `time` and throws "Invalid payload" when it is absent;
        # the old boolean `value` is gone. Closing the network is time 0.
        vol.Required("time"): vol.All(int, vol.Range(min=0, max=254)),
        vol.Optional("device"): str,
    }
)
@websocket_api.async_response
@_guard
async def ws_permit_join(hass, connection, msg, data) -> None:
    """Open or close joining, and report what Zigbee2MQTT actually did.

    Awaited rather than fired and forgotten: the pairing helper puts the operator
    in front of a countdown, and a radio that refused to open must say so then,
    not by silently never producing a join.
    """
    payload: dict[str, Any] = {"time": msg["time"]}
    if msg.get("device"):
        payload["device"] = msg["device"]
    # A fresh window starts a fresh session list, so the helper cannot inherit the
    # terminal state of a device that was paired an hour ago. True of a join through
    # one router as much as a network-wide one.
    if msg["time"] > 0:
        data.async_clear_pairing_sessions()
    result = await data.async_request_mutation(
        "permit_join", payload, REQUEST_TIMEOUT
    )
    connection.send_result(msg["id"], result)


@websocket_api.require_admin
@websocket_api.websocket_command(
    {
        vol.Required("type"): "z2m/device/rename",
        # Either a friendly name or an ieee address: Z2M resolves both, and the
        # pairing helper only knows the address.
        vol.Required("from"): str,
        vol.Required("to"): str,
        # Off by default and deliberately opt-in: Z2M deletes and republishes its
        # discovery topics for this device, which recreates the HA entities.
        vol.Optional("homeassistant_rename", default=False): bool,
    }
)
@websocket_api.async_response
@_guard
async def ws_rename(hass, connection, msg, data) -> None:
    result = await data.async_request_mutation(
        "device/rename",
        {
            "from": msg["from"],
            "to": msg["to"],
            "homeassistant_rename": msg["homeassistant_rename"],
        },
        REQUEST_TIMEOUT,
    )
    # Entity ids minted from the IEEE before this name existed are rebuilt by the
    # naming watcher, which is already listening for the device registry update
    # this rename causes. Nothing to schedule here.
    connection.send_result(msg["id"], result)


# ------------------------------------------------------------------- groups
#
# `id` is reserved by Home Assistant's websocket envelope, so a group is addressed
# as `group` here and mapped onto Z2M's own `id` field at the MQTT boundary. Every
# one of these awaits the bridge's answer: a group write can be refused (duplicate
# name, unknown endpoint, unreachable device) and the operator has to be told.
# Authoritative membership then arrives on z2m/groups/subscribe, because Z2M
# republishes bridge/groups only after the Zigbee command has been sent.

# Z2M accepts 1..65527; above that the group id is not addressable on the mesh.
_GROUP_ID = vol.All(vol.Coerce(int), vol.Range(min=1, max=65527))
# "default" is Z2M's own word for "the device's first endpoint".
_ENDPOINT = vol.Any("default", vol.All(vol.Coerce(int), vol.Range(min=1, max=254)))


@websocket_api.require_admin
@websocket_api.websocket_command(
    {
        vol.Required("type"): "z2m/group/add",
        vol.Required("name"): vol.All(str, vol.Length(min=1)),
        vol.Optional("group_id"): _GROUP_ID,
    }
)
@websocket_api.async_response
@_guard
async def ws_group_add(hass, connection, msg, data) -> None:
    payload: dict[str, Any] = {"friendly_name": msg["name"]}
    if "group_id" in msg:
        # Z2M's settings layer compares this as a string key.
        payload["id"] = str(msg["group_id"])
    # Answers {friendly_name, id}: the generated id is the only place the caller
    # can learn which group it just made.
    connection.send_result(
        msg["id"],
        await data.async_request_mutation("group/add", payload, REQUEST_TIMEOUT),
    )


@websocket_api.require_admin
@websocket_api.websocket_command(
    {
        vol.Required("type"): "z2m/group/rename",
        vol.Required("group"): vol.Any(str, _GROUP_ID),
        vol.Required("to"): vol.All(str, vol.Length(min=1)),
        vol.Optional("homeassistant_rename", default=False): bool,
    }
)
@websocket_api.async_response
@_guard
async def ws_group_rename(hass, connection, msg, data) -> None:
    connection.send_result(
        msg["id"],
        await data.async_request_mutation(
            "group/rename",
            {
                "from": str(msg["group"]),
                "to": msg["to"],
                "homeassistant_rename": msg["homeassistant_rename"],
            },
            REQUEST_TIMEOUT,
        ),
    )


@websocket_api.require_admin
@websocket_api.websocket_command(
    {
        vol.Required("type"): "z2m/group/remove",
        vol.Required("group"): vol.Any(str, _GROUP_ID),
        # force skips the Zigbee removal commands: the local group goes away while
        # the devices stay programmed with its address. Recovery only.
        vol.Optional("force", default=False): bool,
    }
)
@websocket_api.async_response
@_guard
async def ws_group_remove(hass, connection, msg, data) -> None:
    connection.send_result(
        msg["id"],
        await data.async_request_mutation(
            "group/remove",
            {"id": str(msg["group"]), "force": msg["force"]},
            REQUEST_TIMEOUT,
        ),
    )


def _member_payload(msg: dict[str, Any]) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "device": msg["device"],
        "group": str(msg["group"]),
        # Always explicit. Z2M defaults an omitted endpoint to the device's first
        # one, which is the wrong endpoint on a multi-endpoint device and silently
        # groups the wrong load.
        "endpoint": msg["endpoint"],
    }
    if msg.get("skip_disable_reporting"):
        payload["skip_disable_reporting"] = True
    return payload


@websocket_api.require_admin
@websocket_api.websocket_command(
    {
        vol.Required("type"): "z2m/group/members/add",
        vol.Required("group"): vol.Any(str, _GROUP_ID),
        vol.Required("device"): str,
        vol.Required("endpoint"): _ENDPOINT,
        vol.Optional("skip_disable_reporting", default=False): bool,
    }
)
@websocket_api.async_response
@_guard
async def ws_group_member_add(hass, connection, msg, data) -> None:
    connection.send_result(
        msg["id"],
        await data.async_request_mutation(
            "group/members/add", _member_payload(msg), REQUEST_TIMEOUT
        ),
    )


@websocket_api.require_admin
@websocket_api.websocket_command(
    {
        vol.Required("type"): "z2m/group/members/remove",
        vol.Required("group"): vol.Any(str, _GROUP_ID),
        vol.Required("device"): str,
        vol.Required("endpoint"): _ENDPOINT,
        vol.Optional("skip_disable_reporting", default=False): bool,
    }
)
@websocket_api.async_response
@_guard
async def ws_group_member_remove(hass, connection, msg, data) -> None:
    connection.send_result(
        msg["id"],
        await data.async_request_mutation(
            "group/members/remove", _member_payload(msg), REQUEST_TIMEOUT
        ),
    )


@websocket_api.require_admin
@websocket_api.websocket_command(
    {
        vol.Required("type"): "z2m/device/remove",
        vol.Required("device"): str,
        vol.Optional("force", default=False): bool,
        vol.Optional("block", default=False): bool,
    }
)
@websocket_api.async_response
@_guard
async def ws_remove(hass, connection, msg, data) -> None:
    await data.async_request(
        "device/remove",
        {"id": msg["device"], "force": msg["force"], "block": msg["block"]},
    )
    connection.send_result(msg["id"])


@websocket_api.require_admin
@websocket_api.websocket_command(
    {
        vol.Required("type"): "z2m/device/options",
        vol.Required("device"): str,
        vol.Required("options"): dict,
    }
)
@websocket_api.async_response
@_guard
async def ws_set_options(hass, connection, msg, data) -> None:
    await data.async_request(
        "device/options", {"id": msg["device"], "options": msg["options"]}
    )
    connection.send_result(msg["id"])


ACCESS_GET = 4


def _gettable_properties(device: dict) -> tuple[list[str], list[str]]:
    """Split a device's exposed properties into readable and write/report-only.

    Z2M marks each expose with an access bitmask (1 STATE, 2 SET, 4 GET). Only
    GET-able attributes can be asked for; converter options never can -- their
    values live in configuration.yaml, not on the device -- which is why this
    walks `definition.exposes` and ignores `definition.options` entirely.
    Type exposes (light, switch, climate...) carry their real attributes one
    level down in `features`.
    """
    readable: list[str] = []
    skipped: list[str] = []
    def _walk(items: list) -> None:
        for e in items or []:
            if not isinstance(e, dict):
                continue
            if e.get("features"):
                _walk(e["features"])
                continue
            prop = e.get("property")
            if not prop:
                continue
            if (e.get("access") or 0) & ACCESS_GET:
                readable.append(prop)
            else:
                skipped.append(prop)
    _walk(((device.get("definition") or {}).get("exposes")) or [])
    return readable, skipped


@websocket_api.require_admin
@websocket_api.websocket_command(
    {
        vol.Required("type"): "z2m/device/read_values",
        vol.Required("device"): str,
    }
)
@websocket_api.async_response
@_guard
async def ws_read_values(hass, connection, msg, data) -> None:
    """Ask the device to report every readable attribute, in one MQTT get.

    Z2M accepts a multi-property payload on `<friendly_name>/get`, so the whole
    read is one publish and, on the radio, a burst of unicast reads to exactly
    this device -- cheap for a powered device, and a sleeping battery device
    simply answers at its next wake-up. Answers come back on the device's state
    topic, so they land in Home Assistant's entities with no further plumbing.
    """
    dev = next(
        (
            d
            for d in data.devices
            if d.get("ieee_address") == msg["device"]
            or d.get("friendly_name") == msg["device"]
        ),
        None,
    )
    if dev is None:
        raise Z2MError(f"Unknown device {msg['device']}")
    readable, skipped = _gettable_properties(dev)
    if readable:
        topic = f"{data.base_topic}/{dev.get('friendly_name')}/get"
        await mqtt.async_publish(
            hass, topic, json.dumps({p: "" for p in readable}), qos=0, retain=False
        )
    battery = (dev.get("power_source") or "") == "Battery"
    connection.send_result(
        msg["id"],
        {"requested": readable, "not_readable": skipped, "sleeping": battery},
    )


@websocket_api.require_admin
@websocket_api.websocket_command(
    {vol.Required("type"): "z2m/device/configure", vol.Required("device"): str}
)
@websocket_api.async_response
@_guard
async def ws_configure(hass, connection, msg, data) -> None:
    await data.async_request("device/configure", {"id": msg["device"]})
    connection.send_result(msg["id"])


@websocket_api.require_admin
@websocket_api.websocket_command(
    {vol.Required("type"): "z2m/device/interview", vol.Required("device"): str}
)
@websocket_api.async_response
@_guard
async def ws_interview(hass, connection, msg, data) -> None:
    await data.async_request("device/interview", {"id": msg["device"]})
    connection.send_result(msg["id"])


@websocket_api.require_admin
@websocket_api.websocket_command({vol.Required("type"): "z2m/health_check"})
@websocket_api.async_response
@_guard
async def ws_health_check(hass, connection, msg, data) -> None:
    """Z2M's own health verdict, returned verbatim as `{healthy: bool}`.

    2.13.0-1 hardcodes it -- "XXX: currently always returns true" sits right above
    the field in Z2M's own api.d.ts -- so the real signal is that a reply arrived
    at all, which says the bridge is alive and answering requests.
    """
    connection.send_result(
        msg["id"], await data.async_request_response("health_check", {}, REQUEST_TIMEOUT)
    )


@websocket_api.require_admin
@websocket_api.websocket_command({vol.Required("type"): "z2m/backup"})
@websocket_api.async_response
@_guard
async def ws_backup(hass, connection, msg, data) -> None:
    """Z2M zips its whole config directory and answers `{zip: "<base64>"}`.

    Returned verbatim so the frontend can hand the base64 straight to a download,
    and given a generous timeout because the zip happens before the reply.
    """
    connection.send_result(
        msg["id"], await data.async_request_response("backup", {}, BACKUP_TIMEOUT)
    )


# NOTE: `id` is reserved by Home Assistant's websocket envelope (every message
# carries a numeric id), so device-targeted commands take `device` and map it onto
# Z2M's own `id` field when building the bridge/request payload. Using `id` here
# silently loses the device: the frontend overwrites it with the message id.
# ---------------------------------------------------------------------- firmware
#
# Z2M 2.13 dispatches on
#   bridge/request/device/ota_update/(update|check|schedule|unschedule)/?(downgrade|abort)?
# read from the add-on image's own compiled otaUpdate.js. `check` also republishes the
# device's update state, which is what populates HA's `update` entity -- so with
# ota.disable_automatic_update_check on, a check here is the only thing that ever
# fills in latest_version.


@websocket_api.require_admin
@websocket_api.websocket_command(
    {
        vol.Required("type"): "z2m/ota/check",
        vol.Required("device"): str,
        vol.Optional("downgrade", default=False): bool,
    }
)
@websocket_api.async_response
@_guard
async def ws_ota_check(hass, connection, msg, data) -> None:
    path = "device/ota_update/check"
    if msg["downgrade"]:
        path += "/downgrade"
    await data.async_request(path, {"id": msg["device"]})
    connection.send_result(msg["id"])


@websocket_api.require_admin
@websocket_api.websocket_command(
    {
        vol.Required("type"): "z2m/ota/update",
        vol.Required("device"): str,
        vol.Optional("downgrade", default=False): bool,
    }
)
@websocket_api.async_response
@_guard
async def ws_ota_update(hass, connection, msg, data) -> None:
    """Start streaming firmware to a device now.

    Awaits a REFUSAL, not the result. bridge/response/device/ota_update/update is
    terminal: Z2M publishes it only once the whole transfer has finished, carrying
    the from/to file versions, and that is minutes on a real device. Awaiting it
    would fail every update that actually worked, so this waits only long enough for
    Z2M's fast refusals -- unknown device, an update or check already running, a
    device with no OTA support -- and hands progress over to z2m/ota/subscribe.

    Expensive on the radio, and it is the expensive one: an image is thousands of
    block requests, it monopolises the device, and Z2M will not run two at once.

    Answers {accepted: true} for "running, watch the push channel", or the terminal
    reply itself in the unlikely event the whole update finished inside the window.
    """
    path = "device/ota_update/update"
    if msg["downgrade"]:
        path += "/downgrade"
    result = await data.async_request_refusal(
        path, {"id": msg["device"]}, OTA_ACCEPT_WINDOW
    )
    connection.send_result(
        msg["id"], {"accepted": True} if result is None else {"accepted": True, **result}
    )


@websocket_api.require_admin
@websocket_api.websocket_command(
    {vol.Required("type"): "z2m/ota/abort", vol.Required("device"): str}
)
@websocket_api.async_response
@_guard
async def ws_ota_abort(hass, connection, msg, data) -> None:
    """Stop an update that is already streaming blocks to the device.

    Awaited: Z2M answers as soon as it has told herdsman to abort, with no radio
    wait, and the refusal that matters -- "No OTA in progress to abort" -- is the
    whole reason to ask. Reporting success for an abort that was refused would leave
    the operator believing a transfer had stopped when it is still running.

    Costs nothing on the radio; it stops traffic rather than making any.
    """
    connection.send_result(
        msg["id"],
        await data.async_request_mutation(
            "device/ota_update/update/abort", {"id": msg["device"]}, REQUEST_TIMEOUT
        ),
    )


@websocket_api.require_admin
@websocket_api.websocket_command(
    {
        vol.Required("type"): "z2m/ota/schedule",
        vol.Required("device"): str,
        vol.Optional("downgrade", default=False): bool,
    }
)
@websocket_api.async_response
@_guard
async def ws_ota_schedule(hass, connection, msg, data) -> None:
    """Queue an update for a sleeping device: it applies when the device next wakes.

    This is the only workable path for battery devices, which are not listening when
    an immediate update would try to stream to them.

    Awaited, and safe to await: unlike the update itself, Z2M answers this as soon as
    it has recorded the intent -- {id, url} -- with no radio work at all, so the
    reply really does mean "queued". The refusals are worth having: a device that
    does not support OTA, or one already mid-update, is rejected here.

    Costs nothing on the radio now. The transfer happens whenever the device next
    talks to the coordinator.
    """
    path = "device/ota_update/schedule"
    if msg["downgrade"]:
        path += "/downgrade"
    connection.send_result(
        msg["id"],
        await data.async_request_mutation(path, {"id": msg["device"]}, REQUEST_TIMEOUT),
    )


@websocket_api.require_admin
@websocket_api.websocket_command(
    {vol.Required("type"): "z2m/ota/unschedule", vol.Required("device"): str}
)
@websocket_api.async_response
@_guard
async def ws_ota_unschedule(hass, connection, msg, data) -> None:
    """Drop a queued update, so a waking device is left alone.

    Awaited: Z2M answers immediately after clearing the intent, and a refusal here
    means the queue was not cleared -- which the operator has to know, because the
    device would otherwise still take the firmware next time it wakes.

    Costs nothing on the radio. Z2M republishes the device's OTA state as `idle`,
    which arrives on z2m/ota/subscribe.
    """
    connection.send_result(
        msg["id"],
        await data.async_request_mutation(
            "device/ota_update/unschedule", {"id": msg["device"]}, REQUEST_TIMEOUT
        ),
    )


@websocket_api.require_admin
@websocket_api.websocket_command({vol.Required("type"): "z2m/ota/subscribe"})
@websocket_api.async_response
@_guard
async def ws_ota_subscribe(hass, connection, msg, data) -> None:
    """Push firmware state as it changes: state, percentage and seconds remaining.

    Snapshot first, then one event per change, shaped
    {ieee_address, friendly_name, state, progress?, remaining?, installed_version,
     latest_version, latest_source, latest_release_notes, error?} where `state` is
    Z2M's own "updating" | "idle" | "available" | "scheduled".

    Where this comes from matters, because it is the one thing in this API that is
    not on a bridge topic. Z2M publishes firmware progress as an `update` key on the
    DEVICE's own state topic, and that topic is NOT retained -- its retain flag comes
    from the device's options, which default to false. So there is no retained
    snapshot to read on connect: the mirror only knows what has been published since
    the entry loaded, and a device that has said nothing yet is legitimately absent
    from the snapshot rather than being an error. Installed and latest version for
    those devices are already on Home Assistant's own `update` entity, which the
    device projection carries as `update_entity`.

    `progress` and `remaining` appear only while a transfer is actually running:
    Z2M deletes them the moment one ends, so they are omitted rather than frozen at
    the last percentage. `error` carries the text of a failure Z2M logged, which is
    the only place an OTA failure reason exists -- the `update` payload it publishes
    afterwards just says `available` again, with no reason.

    Refcounted, like the pairing subscription and for the same reason: the underlying
    MQTT subscription is a wildcard over every device topic on the base topic, so it
    is taken out only while somebody is watching. Home Assistant always runs the
    unsubscribe -- including when the socket dies -- which a browser cannot promise.

    Costs nothing on the radio.
    """

    @callback
    def _forward(event: dict[str, Any]) -> None:
        connection.send_message(websocket_api.event_message(msg["id"], event))

    detach = async_dispatcher_connect(hass, SIGNAL_OTA, _forward)
    await data.async_ota_acquire()

    @callback
    def _unsubscribe() -> None:
        detach()
        data.async_ota_release()

    connection.subscriptions[msg["id"]] = _unsubscribe
    connection.send_result(msg["id"], {"devices": data.ota_snapshot()})


# ------------------------------------------------------------------- binding
#
# Two reads and three writes, and the split matters: the reads are projections over
# the retained inventory and cost NOTHING -- Z2M already publishes every endpoint's
# clusters, binds and configured reportings on bridge/devices, and republishes them
# itself after every write. The writes are real Zigbee traffic to a device that may
# be asleep.

# Bind endpoints are deliberately laxer than the group ones. Z2M resolves a bind
# endpoint through `device.endpoint(key)`, which accepts an endpoint NAME as well as
# a number -- "left" on a two-gang switch -- and "default" for the first endpoint.
# The group commands take ids only because group membership is addressed by id.
_BIND_ENDPOINT = vol.Any(
    vol.All(vol.Coerce(int), vol.Range(min=1, max=254)), vol.All(str, vol.Length(min=1))
)


def _bind_payload(msg: dict[str, Any]) -> dict[str, Any]:
    """The bind/unbind request body, which is identical for both.

    `from_endpoint` is always sent. Z2M defaults an omitted one to the device's first
    endpoint, which is the wrong endpoint on a multi-endpoint device -- the same trap
    the group commands avoid, and it binds the wrong gang rather than failing.

    `clusters` is passed through untouched when given. Z2M uses its own eleven-cluster
    candidate list ONLY when the field is absent; an explicit list bypasses that
    filter entirely, so restricting it here would remove the ability to bind anything
    unusual the device genuinely supports.
    """
    payload: dict[str, Any] = {
        "from": msg["from"],
        "from_endpoint": msg.get("from_endpoint", "default"),
        "to": msg["to"],
    }
    if msg.get("to_endpoint") is not None:
        payload["to_endpoint"] = msg["to_endpoint"]
    if msg.get("clusters"):
        payload["clusters"] = msg["clusters"]
    return payload


_BIND_SCHEMA = {
    # Either an ieee or a friendly name; Z2M resolves both.
    vol.Required("from"): vol.All(str, vol.Length(min=1)),
    vol.Optional("from_endpoint"): _BIND_ENDPOINT,
    # A device, a group id, a group name, or the literal "Coordinator" -- which is
    # how a device is bound to report to the hub rather than to another device.
    vol.Required("to"): vol.Any(vol.All(str, vol.Length(min=1)), int),
    vol.Optional("to_endpoint"): _BIND_ENDPOINT,
    vol.Optional("clusters"): [vol.All(str, vol.Length(min=1))],
}


@websocket_api.require_admin
@websocket_api.websocket_command({vol.Required("type"): "z2m/device/bind", **_BIND_SCHEMA})
@websocket_api.async_response
@_guard
async def ws_bind(hass, connection, msg, data) -> None:
    """Bind clusters from one device's endpoint to a device, group or the coordinator.

    Awaited, and the answer has to be READ rather than merely checked, because Z2M
    reports a partial failure as success. It answers `status: "error"` only when it
    attempted nothing ("Nothing to bind") or when every cluster failed ("Failed to
    bind"); anything in between comes back ok, with the clusters that took in
    `clusters` and the ones that did not in `failed`. A caller that shows a tick
    without looking at `failed` is lying to the operator, so both are passed through.

    Expensive on the radio, and more so than it looks: one ZDO bind request per
    cluster, and then Z2M configures attribute reporting for the clusters that
    succeeded. A sleeping device will fail all of them. Per-cluster reasons are not
    in the response -- Z2M logs them -- so z2m/logs is where they can be read.

    Z2M republishes bridge/devices afterwards, so z2m/devices/subscribe and
    z2m/device/binds show the new state without another request.
    """
    connection.send_result(
        msg["id"],
        await data.async_request_mutation(
            "device/bind", _bind_payload(msg), REQUEST_TIMEOUT
        ),
    )


@websocket_api.require_admin
@websocket_api.websocket_command(
    {vol.Required("type"): "z2m/device/unbind", **_BIND_SCHEMA}
)
@websocket_api.async_response
@_guard
async def ws_unbind(hass, connection, msg, data) -> None:
    """Remove a binding, with the same partial-failure caveat as z2m/device/bind.

    Awaited. `clusters` in the answer are the ones actually unbound and `failed` the
    ones that refused; "Nothing to unbind" and "Failed to unbind" arrive as errors.

    Expensive on the radio: one ZDO unbind per cluster, and on success Z2M then walks
    the target's remaining binds to switch off any attribute reporting nothing needs
    any more. That tidy-up is why an unbind can take longer than the bind did.
    """
    connection.send_result(
        msg["id"],
        await data.async_request_mutation(
            "device/unbind", _bind_payload(msg), REQUEST_TIMEOUT
        ),
    )


@websocket_api.require_admin
@websocket_api.websocket_command(
    {vol.Required("type"): "z2m/device/binds", vol.Required("device"): str}
)
@websocket_api.async_response
@_guard
async def ws_binds(hass, connection, msg, data) -> None:
    """What one device is currently bound to, one row per endpoint/cluster/target.

    Awaits nothing and costs nothing: bridge/devices is retained and already holds
    every endpoint's `bindings`, so this is a reshape of state in hand rather than a
    question put to the radio. Bind targets are resolved to friendly names here,
    because Z2M reports them as bare ieee addresses and group ids.

    A target that can no longer be named is still listed, with `name` null -- a bind
    left pointing at a removed device is exactly what the operator needs to see.
    """
    connection.send_result(msg["id"], data.device_binds(msg["device"]))


@websocket_api.require_admin
@websocket_api.websocket_command({vol.Required("type"): "z2m/binds/overview"})
@websocket_api.async_response
@_guard
async def ws_binds_overview(hass, connection, msg, data) -> None:
    """Every bind in the mesh at once, with per-endpoint capabilities.

    The overview page and the per-device "controlled by" section both need edges
    keyed by TARGET, which no per-device call can answer. Entirely a reshape of the
    retained inventory, so it costs nothing on the radio.
    """
    connection.send_result(msg["id"], data.binds_overview())


@websocket_api.require_admin
@websocket_api.websocket_command(
    {vol.Required("type"): "z2m/device/clusters", vol.Required("device"): str}
)
@websocket_api.async_response
@_guard
async def ws_clusters(hass, connection, msg, data) -> None:
    """Per-endpoint clusters, current binds and reportings, plus what can be bound.

    Awaits nothing and costs nothing on the radio -- all of it is in the retained
    inventory. Endpoints come back in numeric order, which the raw payload does not
    give: Z2M keys them by id and JSON makes those keys strings, so the natural order
    is 1, 10, 2.

    `bindable` per endpoint is the useful part. Z2M will only ever attempt the eleven
    clusters in its own candidate list, and only where this endpoint speaks the
    cluster, so offering anything else produces a bind that is refused every time.
    """
    connection.send_result(msg["id"], data.device_clusters(msg["device"]))


# --------------------------------------------------------- attribute reporting


@websocket_api.require_admin
@websocket_api.websocket_command(
    {
        vol.Required("type"): "z2m/device/configure_reporting",
        vol.Required("device"): str,
        vol.Required("endpoint"): _BIND_ENDPOINT,
        vol.Required("cluster"): vol.All(str, vol.Length(min=1)),
        vol.Required("attribute"): vol.All(str, vol.Length(min=1)),
        # Seconds. 0 minimum means "as fast as it changes"; 65535 is the Zigbee
        # maximum for both intervals, and a maximum of 0 means "never report".
        vol.Required("minimum_report_interval"): vol.All(
            vol.Coerce(int), vol.Range(min=0, max=65535)
        ),
        vol.Required("maximum_report_interval"): vol.All(
            vol.Coerce(int), vol.Range(min=0, max=65535)
        ),
        # How much the value must move before the device bothers reporting. Z2M
        # rejects a non-numeric one outright.
        vol.Required("reportable_change"): vol.Coerce(int),
    }
)
@websocket_api.async_response
@_guard
async def ws_configure_reporting(hass, connection, msg, data) -> None:
    """Tell one attribute on one endpoint how often to report itself.

    Published to bridge/request/device/reporting/configure, which is the current
    path. `device/configure_reporting` still works in 2.13 but Z2M marks it deprecated
    for 3.0, so it is not used here.

    Awaited, and the reply is meaningful: Z2M performs both radio steps before
    answering, so `status: ok` really does mean the device accepted the
    configuration. A refusal carries Z2M's own text, e.g. an endpoint the device does
    not have.

    TWO radio operations, not one, and the first is a surprise worth knowing about:
    Z2M unconditionally binds the cluster to the coordinator first, then configures
    reporting. So this call also CREATES A BIND, which will appear in
    z2m/device/binds afterwards. It then republishes bridge/devices, so the new
    `configured_reportings` arrives on z2m/devices/subscribe without another request.

    Reading the configuration back over the air is never needed: the retained
    inventory already carries it, which is what z2m/device/clusters returns.
    """
    connection.send_result(
        msg["id"],
        await data.async_request_mutation(
            "device/reporting/configure",
            {
                "id": msg["device"],
                "endpoint": msg["endpoint"],
                "cluster": msg["cluster"],
                "attribute": msg["attribute"],
                "minimum_report_interval": msg["minimum_report_interval"],
                "maximum_report_interval": msg["maximum_report_interval"],
                "reportable_change": msg["reportable_change"],
            },
            REQUEST_TIMEOUT,
        ),
    )


# ----------------------------------------------------------------- touchlink
#
# Touchlink talks to a device that is NOT on the network, over InterPAN, by taking
# the radio off the operating channel and sweeping the touchlink channels. Two
# consequences shape everything here:
#
#  * It is slow. Sixteen channels, each with a 500 ms broadcast timeout that is
#    burned in full when nothing answers.
#  * It stalls the whole mesh while it runs, because the coordinator is not on its
#    own channel to hear anything.
#
# All three commands therefore share ONE lock rather than the per-path default:
# herdsman refuses a second concurrent touchlink operation outright, and these are
# three different paths that would not otherwise see each other.

_CHANNEL = vol.All(vol.Coerce(int), vol.Range(min=11, max=26))


@websocket_api.require_admin
@websocket_api.websocket_command({vol.Required("type"): "z2m/touchlink/scan"})
@websocket_api.async_response
@_guard
async def ws_touchlink_scan(hass, connection, msg, data) -> None:
    """Sweep the touchlink channels for devices in range, answering {found: [...]}.

    Each entry is {ieee_address, channel}; the channel has to be carried into
    identify and factory_reset, because those do not search for the device again.
    An empty list means nothing answered, which for touchlink usually means "not
    close enough" -- it is a deliberately short-range protocol.

    SLOW AND DISRUPTIVE. Derived from herdsman's own scan loop rather than guessed:
    sixteen channels, each costing a channel switch plus a broadcast with a 500 ms
    timeout that is spent in full when nothing replies -- 8 s of pure timeout, so
    ~10-13 s in practice, and the timeout here is 60 s to allow for a slow adapter.
    For the whole of that time the coordinator is off the operating channel and the
    rest of the mesh is not being heard, so this is not something to poll.

    Also note Z2M's own limitation: only the FIRST response per channel is recorded.
    Two devices on one channel will show as one.
    """
    connection.send_result(
        msg["id"],
        await data.async_request_mutation(
            "touchlink/scan", {}, TOUCHLINK_TIMEOUT, lock=TOUCHLINK_LOCK
        ),
    )


@websocket_api.require_admin
@websocket_api.websocket_command(
    {
        vol.Required("type"): "z2m/touchlink/identify",
        vol.Required("ieee_address"): vol.All(str, vol.Length(min=1)),
        vol.Required("channel"): _CHANNEL,
    }
)
@websocket_api.async_response
@_guard
async def ws_touchlink_identify(hass, connection, msg, data) -> None:
    """Make one touchlink device announce itself -- a bulb flashes.

    This is how the operator tells which physical device they are about to factory
    reset, so it is worth offering before the destructive one. Both fields are
    required: Z2M rejects the request outright without them, and they come straight
    from a z2m/touchlink/scan result.

    Awaited, and quick by touchlink standards -- one channel, not sixteen, so a
    second or two. The radio still leaves the operating channel for that time.
    """
    connection.send_result(
        msg["id"],
        await data.async_request_mutation(
            "touchlink/identify",
            {"ieee_address": msg["ieee_address"], "channel": msg["channel"]},
            TOUCHLINK_TIMEOUT,
            lock=TOUCHLINK_LOCK,
        ),
    )


@websocket_api.require_admin
@websocket_api.websocket_command(
    {
        vol.Required("type"): "z2m/touchlink/factory_reset",
        vol.Optional("ieee_address"): vol.All(str, vol.Length(min=1)),
        vol.Optional("channel"): _CHANNEL,
    }
)
@websocket_api.async_response
@_guard
async def ws_touchlink_factory_reset(hass, connection, msg, data) -> None:
    """Factory reset a touchlink device: the recovery path for a bulb that will not join.

    DESTRUCTIVE. The device loses its network keys and its configuration, which is
    the point -- it is how a bulb stuck on somebody else's network is reclaimed --
    but it cannot be undone from here.

    Two modes, and the difference is worth being explicit about in the UI:

      * both `ieee_address` and `channel` -- reset exactly that device.
      * NEITHER -- reset the first device that answers on any channel, whichever one
        that turns out to be. Z2M's own "reset the nearest device" behaviour, and the
        only option when a device is too broken to appear in a scan.

    Passing only one of the two is refused here rather than sent. Z2M treats a
    half-specified request as the second mode without saying so, which means a
    request naming a device could silently reset a different one.

    Slow and disruptive: with a channel it is ~3 s (identify, a 2 s pause, then the
    reset). Without, it sweeps all sixteen channels like a scan.
    """
    ieee = msg.get("ieee_address")
    channel = msg.get("channel")
    if (ieee is None) != (channel is None):
        connection.send_error(
            msg["id"],
            websocket_api.ERR_INVALID_FORMAT,
            "Give both ieee_address and channel to reset one device, or neither to "
            "reset the nearest one. With only one of the two, Zigbee2MQTT resets "
            "whichever device answers first.",
        )
        return
    payload: dict[str, Any] = {}
    if ieee is not None:
        payload = {"ieee_address": ieee, "channel": channel}
    connection.send_result(
        msg["id"],
        await data.async_request_mutation(
            "touchlink/factory_reset", payload, TOUCHLINK_TIMEOUT, lock=TOUCHLINK_LOCK
        ),
    )


# -------------------------------------------------------------------- scenes
#
# Scenes are NOT bridge requests. They are zigbee-herdsman-converters converters
# driven through the ordinary publish path, so they go to `<base>/<target>/set` and
# nothing answers them on a bridge/response topic at all. A publish is therefore not
# a confirmation, and these commands do not pretend otherwise -- see
# Z2MData.async_scene_write for what each one actually waits for.
#
# A target is a device (ieee or friendly name) or a group (id or friendly name). The
# endpoint is optional and only meaningful for a device: a two-gang switch holds a
# separate scene table per gang.
#
# The scene id is carried as `scene`, NOT as `id`. Same reason the device commands
# take `device` and the group commands take `group`: every Home Assistant websocket
# message already has an `id`, the numeric message id, and a JSON object cannot hold
# the key twice. A schema declaring `id` here would either be overwritten by the
# envelope or reject a perfectly good scene 0 for not being a positive message id.

# Zigbee scene ids are a single byte.
_SCENE_ID = vol.All(vol.Coerce(int), vol.Range(min=0, max=255))
_SCENE_TARGET = vol.Any(vol.All(str, vol.Length(min=1)), int)


def _scene_target(msg: dict[str, Any]) -> tuple[Any, Any]:
    return msg["target"], msg.get("endpoint")


@websocket_api.require_admin
@websocket_api.websocket_command(
    {vol.Required("type"): "z2m/scenes", vol.Required("target"): _SCENE_TARGET}
)
@websocket_api.async_response
@_guard
async def ws_scenes(hass, connection, msg, data) -> None:
    """Scenes stored on one device or group, from the retained inventory.

    Awaits nothing and costs nothing on the radio.

    The shape is asymmetric because Z2M's data is: a GROUP carries its scenes at the
    top level, while a DEVICE holds them per endpoint, because that is where the
    Zigbee scene table lives. A device answer therefore gives both -- `endpoints` for
    the truth and `scenes` as the union across them, since the common device has one
    endpoint and a flat list is what its UI wants.
    """
    connection.send_result(msg["id"], data.scenes_for(msg["target"]))


@websocket_api.require_admin
@websocket_api.websocket_command(
    {
        vol.Required("type"): "z2m/scene/store",
        vol.Required("target"): _SCENE_TARGET,
        vol.Optional("endpoint"): _BIND_ENDPOINT,
        vol.Required("scene"): _SCENE_ID,
        vol.Optional("name"): vol.All(str, vol.Length(min=1)),
    }
)
@websocket_api.async_response
@_guard
async def ws_scene_store(hass, connection, msg, data) -> None:
    """Save the target's CURRENT state as a scene under `scene`.

    Not a bridge request: this is `{"scene_store": {...}}` published to the target's
    `set` topic, so nothing answers it. What is waited for instead is Z2M
    republishing its retained inventory with the scene present -- Z2M does that after
    every scene mutation, and a store that the device refused leaves the inventory
    without the id. A converter failure is reported with Zigbee2MQTT's own words,
    read off bridge/logging, which is the only place that reason exists.

    One caveat stated plainly: re-storing an id that ALREADY exists cannot be
    confirmed from the inventory, because the id is present either way. In that one
    case the log is the only evidence, and a silent success is reported when Z2M
    logged no failure.

    Costs one ZCL scene command on the radio, to a device that has to be awake.

    Scene id 0 is refused for a device target: the Zigbee spec reserves id 0 in group
    0 for the OnOff cluster's global scene, and Z2M rejects it. Groups have a non-zero
    group id, so id 0 is fine there.
    """
    target, endpoint = _scene_target(msg)
    scene_id = msg["scene"]
    # Refused here rather than at the radio. Z2M would reject it too, but only after
    # the publish, and the reason would then be reachable solely through the log.
    # scenes_for is a projection over the retained inventory, so this costs nothing
    # and it also settles whether the target exists at all.
    if scene_id == 0 and data.scenes_for(target)["kind"] == "device":
        connection.send_error(
            msg["id"],
            websocket_api.ERR_INVALID_FORMAT,
            "Scene 0 is reserved: the Zigbee specification keeps scene 0 in group 0 "
            "for the OnOff cluster's global scene, so a device cannot store it. Use "
            "an id from 1 to 255, or store it on a group.",
        )
        return
    value: Any = {"ID": scene_id}
    if msg.get("name"):
        value["name"] = msg["name"]
    connection.send_result(
        msg["id"],
        await data.async_scene_write(
            target,
            endpoint,
            "scene_store",
            value,
            expect=lambda ids: scene_id in ids,
        ),
    )


@websocket_api.require_admin
@websocket_api.websocket_command(
    {
        vol.Required("type"): "z2m/scene/recall",
        vol.Required("target"): _SCENE_TARGET,
        vol.Optional("endpoint"): _BIND_ENDPOINT,
        vol.Required("scene"): _SCENE_ID,
    }
)
@websocket_api.async_response
@_guard
async def ws_scene_recall(hass, connection, msg, data) -> None:
    """Apply a stored scene, putting the lights back to how they were saved.

    The one scene command with nothing to confirm against. Recall stores nothing, so
    Z2M does not republish its inventory and there is no state change to check --
    which is exactly why it is NOT claimed as confirmed. The answer is
    {sent: true, confirmed_by: null}, and the only thing waited for is a converter
    failure appearing on bridge/logging, which is reported with Z2M's own text.

    The value is sent as a bare number because that is what the converter demands: it
    asserts the payload is numeric and rejects the object form the store command uses.

    Costs one ZCL scene command. The resulting light state arrives through the
    devices' own Home Assistant entities, not through this API.
    """
    target, endpoint = _scene_target(msg)
    connection.send_result(
        msg["id"],
        await data.async_scene_write(target, endpoint, "scene_recall", msg["scene"]),
    )


@websocket_api.require_admin
@websocket_api.websocket_command(
    {
        vol.Required("type"): "z2m/scene/remove",
        vol.Required("target"): _SCENE_TARGET,
        vol.Optional("endpoint"): _BIND_ENDPOINT,
        vol.Required("scene"): _SCENE_ID,
    }
)
@websocket_api.async_response
@_guard
async def ws_scene_remove(hass, connection, msg, data) -> None:
    """Delete one stored scene from the target's scene table.

    Confirmed properly: the scene id has to be GONE from the retained inventory after
    Z2M republishes it, which a failed removal cannot fake. A converter failure is
    surfaced with Zigbee2MQTT's own text.

    Sent as a bare number, as the converter requires.

    Costs one ZCL scene command, to a device that has to be awake.
    """
    target, endpoint = _scene_target(msg)
    scene_id = msg["scene"]
    connection.send_result(
        msg["id"],
        await data.async_scene_write(
            target,
            endpoint,
            "scene_remove",
            scene_id,
            expect=lambda ids: scene_id not in ids,
        ),
    )


@websocket_api.require_admin
@websocket_api.websocket_command(
    {
        vol.Required("type"): "z2m/scene/remove_all",
        vol.Required("target"): _SCENE_TARGET,
        vol.Optional("endpoint"): _BIND_ENDPOINT,
    }
)
@websocket_api.async_response
@_guard
async def ws_scene_remove_all(hass, connection, msg, data) -> None:
    """Wipe every scene from the target's scene table.

    Confirmed properly: the inventory has to come back with no scenes at all.

    The payload value is ignored by the converter -- it takes the group from the
    entity -- so an empty string is sent, which is what Z2M's own frontend does.

    Costs one ZCL scene command. Destructive and not undoable from here: the saved
    light states are gone.
    """
    target, endpoint = _scene_target(msg)
    connection.send_result(
        msg["id"],
        await data.async_scene_write(
            target,
            endpoint,
            "scene_remove_all",
            "",
            expect=lambda ids: not ids,
        ),
    )



@websocket_api.require_admin
@websocket_api.websocket_command(
    {
        vol.Required("type"): "z2m/log_level",
        vol.Required("value"): vol.In(["error", "warning", "info", "debug"]),
    }
)
@websocket_api.async_response
@_guard
async def ws_set_log_level(hass, connection, msg, data) -> None:
    await data.async_request("options", {"options": {"advanced": {"log_level": msg["value"]}}})
    connection.send_result(msg["id"])


@websocket_api.require_admin
@websocket_api.websocket_command({vol.Required("type"): "z2m/restart"})
@websocket_api.async_response
@_guard
async def ws_restart(hass, connection, msg, data) -> None:
    await data.async_request("restart", {})
    connection.send_result(msg["id"])
