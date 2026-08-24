"""Zigbee panel for Home Assistant, backed by Zigbee2MQTT.

Gives Z2M the same shape of surface the built-in zwave_js integration has: an entry
under Devices & Services, and a panel registered with config_panel_domain so it is
reachable as that entry's configuration page.
"""

from __future__ import annotations

import logging
import os

from homeassistant.components import frontend, panel_custom
from homeassistant.components.http import StaticPathConfig
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers import config_validation as cv
from homeassistant.loader import async_get_integration

from .const import (
    CONF_BASE_TOPIC,
    DEFAULT_BASE_TOPIC,
    DOMAIN,
    PANEL_ICON,
    PANEL_JS,
    PANEL_TITLE,
    PANEL_URL_PATH,
    WEBCOMPONENT,
)
from .coordinator import Z2MData
from .websocket_api import async_setup_websocket

CONFIG_SCHEMA = cv.config_entry_only_config_schema(DOMAIN)

_LOGGER = logging.getLogger(__package__)


async def async_setup(hass: HomeAssistant, config) -> bool:
    hass.data.setdefault(DOMAIN, {})
    async_setup_websocket(hass)
    return True


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    base_topic = entry.data.get(CONF_BASE_TOPIC, DEFAULT_BASE_TOPIC)

    data = Z2MData(hass, base_topic)
    await data.async_start()
    hass.data.setdefault(DOMAIN, {})[entry.entry_id] = data

    integration = await async_get_integration(hass, DOMAIN)
    static_dir = os.path.join(os.path.dirname(__file__), "panel")
    await hass.http.async_register_static_paths(
        [
            StaticPathConfig(
                url_path=f"/api/panel_custom/{DOMAIN}",
                path=static_dir,
                cache_headers=False,
            )
        ]
    )

    await panel_custom.async_register_panel(
        hass,
        webcomponent_name=WEBCOMPONENT,
        frontend_url_path=PANEL_URL_PATH,
        module_url=f"/api/panel_custom/{DOMAIN}/{PANEL_JS}?v={integration.version}",
        sidebar_title=PANEL_TITLE,
        sidebar_icon=PANEL_ICON,
        require_admin=True,
        # Makes this the integration's config page, so the entry in
        # Settings > Devices & Services opens it the way Z-Wave's does.
        config_panel_domain=DOMAIN,
        config={"base_topic": base_topic},
    )

    entry.async_on_unload(entry.add_update_listener(_reload_on_change))
    _LOGGER.info("Zigbee panel ready (base topic %s)", base_topic)
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    data: Z2MData | None = hass.data.get(DOMAIN, {}).pop(entry.entry_id, None)
    if data is not None:
        data.async_stop()
    frontend.async_remove_panel(hass, PANEL_URL_PATH)
    return True


async def _reload_on_change(hass: HomeAssistant, entry: ConfigEntry) -> None:
    await hass.config_entries.async_reload(entry.entry_id)
