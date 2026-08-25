"""WebSocket API for the Zigbee panel.

The panel never speaks MQTT directly -- a browser cannot. It calls these commands,
mirroring how the built-in zwave_js panel talks to its integration.
"""

from __future__ import annotations

import logging
from typing import Any

import voluptuous as vol

from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers import device_registry as dr, entity_registry as er
from homeassistant.helpers.dispatcher import async_dispatcher_connect

from .const import (
    BACKUP_TIMEOUT,
    DOMAIN,
    REQUEST_TIMEOUT,
    SIGNAL_DEVICE_LIST,
    SIGNAL_GROUPS,
    SIGNAL_LOG,
    SIGNAL_MAP,
    SIGNAL_PAIRING,
    SIGNAL_UPDATE,
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
        ws_permit_join,
        ws_rename,
        ws_group_add,
        ws_group_rename,
        ws_group_remove,
        ws_group_member_add,
        ws_group_member_remove,
        ws_remove,
        ws_set_options,
        ws_configure,
        ws_interview,
        ws_health_check,
        ws_backup,
        ws_ota_check,
        ws_ota_update,
        ws_ota_abort,
        ws_ota_schedule,
        ws_ota_unschedule,
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
    }
)
@websocket_api.async_response
@_guard
async def ws_networkmap(hass, connection, msg, data) -> None:
    """The topology, served from cache unless it is stale or a scan is demanded.

    `force` is admin-only: a forced scan has the coordinator interrogate every
    router for tens of seconds, which is the one thing here a dashboard viewer
    should not be able to set off.
    """
    if msg["force"] and not connection.user.is_admin:
        connection.send_error(
            msg["id"],
            websocket_api.ERR_UNAUTHORIZED,
            "Forcing a network scan requires an administrator",
        )
        return
    connection.send_result(msg["id"], await data.async_networkmap(force=msg["force"]))


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
    path = "device/ota_update/update"
    if msg["downgrade"]:
        path += "/downgrade"
    await data.async_request(path, {"id": msg["device"]})
    connection.send_result(msg["id"])


@websocket_api.require_admin
@websocket_api.websocket_command(
    {vol.Required("type"): "z2m/ota/abort", vol.Required("device"): str}
)
@websocket_api.async_response
@_guard
async def ws_ota_abort(hass, connection, msg, data) -> None:
    """Stop an update that is already streaming blocks to the device."""
    await data.async_request("device/ota_update/update/abort", {"id": msg["device"]})
    connection.send_result(msg["id"])


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
    """
    path = "device/ota_update/schedule"
    if msg["downgrade"]:
        path += "/downgrade"
    await data.async_request(path, {"id": msg["device"]})
    connection.send_result(msg["id"])


@websocket_api.require_admin
@websocket_api.websocket_command(
    {vol.Required("type"): "z2m/ota/unschedule", vol.Required("device"): str}
)
@websocket_api.async_response
@_guard
async def ws_ota_unschedule(hass, connection, msg, data) -> None:
    await data.async_request("device/ota_update/unschedule", {"id": msg["device"]})
    connection.send_result(msg["id"])


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
