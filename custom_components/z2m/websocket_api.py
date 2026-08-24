"""WebSocket API for the Zigbee panel.

The panel never speaks MQTT directly -- a browser cannot. It calls these commands,
mirroring how the built-in zwave_js panel talks to its integration.
"""

from __future__ import annotations

from typing import Any

import voluptuous as vol

from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.dispatcher import async_dispatcher_connect

from .const import DOMAIN, SIGNAL_UPDATE


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
        ws_set_log_level,
        ws_restart,
    ):
        websocket_api.async_register_command(hass, handler)


def _guard(func):
    """Return a not_loaded error rather than a traceback when the entry is down."""

    async def wrapper(hass, connection, msg):
        data = _data(hass)
        if data is None:
            connection.send_error(msg["id"], "not_loaded", "Zigbee entry is not loaded")
            return
        await func(hass, connection, msg, data)

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
    connection.send_result(msg["id"], data.device_list())


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
        vol.Required("id"): str,
        vol.Optional("force", default=False): bool,
        vol.Optional("block", default=False): bool,
    }
)
@websocket_api.async_response
@_guard
async def ws_remove(hass, connection, msg, data) -> None:
    await data.async_request(
        "device/remove",
        {"id": msg["id"], "force": msg["force"], "block": msg["block"]},
    )
    connection.send_result(msg["id"])


@websocket_api.require_admin
@websocket_api.websocket_command(
    {
        vol.Required("type"): "z2m/device/options",
        vol.Required("id"): str,
        vol.Required("options"): dict,
    }
)
@websocket_api.async_response
@_guard
async def ws_set_options(hass, connection, msg, data) -> None:
    await data.async_request(
        "device/options", {"id": msg["id"], "options": msg["options"]}
    )
    connection.send_result(msg["id"])


@websocket_api.require_admin
@websocket_api.websocket_command(
    {vol.Required("type"): "z2m/device/configure", vol.Required("id"): str}
)
@websocket_api.async_response
@_guard
async def ws_configure(hass, connection, msg, data) -> None:
    await data.async_request("device/configure", {"id": msg["id"]})
    connection.send_result(msg["id"])


@websocket_api.require_admin
@websocket_api.websocket_command(
    {vol.Required("type"): "z2m/device/interview", vol.Required("id"): str}
)
@websocket_api.async_response
@_guard
async def ws_interview(hass, connection, msg, data) -> None:
    await data.async_request("device/interview", {"id": msg["id"]})
    connection.send_result(msg["id"])


@websocket_api.require_admin
@websocket_api.websocket_command({vol.Required("type"): "z2m/health_check"})
@websocket_api.async_response
@_guard
async def ws_health_check(hass, connection, msg, data) -> None:
    await data.async_request("health_check", {})
    connection.send_result(msg["id"])


@websocket_api.require_admin
@websocket_api.websocket_command({vol.Required("type"): "z2m/backup"})
@websocket_api.async_response
@_guard
async def ws_backup(hass, connection, msg, data) -> None:
    await data.async_request("backup", {})
    connection.send_result(msg["id"])


@websocket_api.require_admin
@websocket_api.websocket_command(
    {vol.Required("type"): "z2m/ota/check", vol.Required("id"): str}
)
@websocket_api.async_response
@_guard
async def ws_ota_check(hass, connection, msg, data) -> None:
    await data.async_request("device/ota_update/check", {"id": msg["id"]})
    connection.send_result(msg["id"])


@websocket_api.require_admin
@websocket_api.websocket_command(
    {vol.Required("type"): "z2m/ota/update", vol.Required("id"): str}
)
@websocket_api.async_response
@_guard
async def ws_ota_update(hass, connection, msg, data) -> None:
    await data.async_request("device/ota_update/update", {"id": msg["id"]})
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
