"""WebSocket API for the Zigbee panel.

The panel never speaks MQTT directly -- a browser cannot. It calls these commands,
mirroring how the built-in zwave_js panel talks to its integration.
"""

from __future__ import annotations

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
    SIGNAL_LOG,
    SIGNAL_MAP,
    SIGNAL_UPDATE,
)
from .coordinator import Z2MError, ieee_from_identifiers

# Zigbee2MQTT refused the request, or never answered it.
ERR_Z2M = "z2m_error"


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
        ws_networkmap,
        ws_networkmap_scan,
        ws_networkmap_subscribe,
        ws_logs,
        ws_logs_subscribe,
        ws_coordinator_check,
        ws_permit_join,
        ws_rename,
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
        out.append({**device, "update_entity": entity_id})
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
    payload: dict[str, Any] = {"time": msg["time"]}
    if msg.get("device"):
        payload["device"] = msg["device"]
    await data.async_request("permit_join", payload)
    connection.send_result(msg["id"])


@websocket_api.require_admin
@websocket_api.websocket_command(
    {
        vol.Required("type"): "z2m/device/rename",
        vol.Required("from"): str,
        vol.Required("to"): str,
    }
)
@websocket_api.async_response
@_guard
async def ws_rename(hass, connection, msg, data) -> None:
    await data.async_request("device/rename", {"from": msg["from"], "to": msg["to"]})
    connection.send_result(msg["id"])


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
