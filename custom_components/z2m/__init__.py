"""Zigbee panel for Home Assistant, backed by Zigbee2MQTT.

Gives Z2M the same shape of surface the built-in zwave_js integration has: an entry
under Devices & Services, and a panel registered with config_panel_domain so it is
reachable as that entry's configuration page.
"""

from __future__ import annotations

from functools import partial
import logging
import os

from homeassistant.components import frontend, panel_custom
from homeassistant.components.http import StaticPathConfig
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers import config_validation as cv
from homeassistant.loader import async_get_integration

from .const import (
    CARD_JS,
    CONF_BASE_TOPIC,
    DEFAULT_BASE_TOPIC,
    DOMAIN,
    PANEL_JS,
    PANEL_URL_PATH,
    SIDEBAR_ICON,
    SIDEBAR_TITLE,
    WEBCOMPONENT,
    ZWAVE_DOMAIN,
    ZWAVE_PANEL_URL_PATH,
    ZWAVE_SIDEBAR_ICON,
    ZWAVE_SIDEBAR_TITLE,
)
from .coordinator import Z2MData, Z2MLabels
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

    # Before the update listener is registered below, deliberately: resolving the
    # label may write label_id into the entry, and doing that with the listener
    # already attached would reload the entry from inside its own setup.
    await Z2MLabels(hass, entry, data).async_start()

    # Our neighbour-table extension, so the map can be streamed device by device
    # instead of waiting on Z2M's one-shot walk. In the background: it is one MQTT
    # round trip, but a Zigbee2MQTT that is down must not hold up setup, and the
    # scan falls back to Z2M's own walk if this never lands. Installed once and
    # left installed -- the integration this replaces saved and removed its
    # extension on every panel open, re-walking every router each time.
    entry.async_create_background_task(
        hass, data.async_install_extension(), f"{DOMAIN} extension install"
    )

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

    # The map is a Lovelace card as well as part of the panel. Registering the
    # module here is what makes `type: custom:z2m-map-card` work on an ordinary
    # dashboard with no resource for the operator to add by hand.
    card_url = f"/api/panel_custom/{DOMAIN}/{CARD_JS}?v={integration.version}"
    frontend.add_extra_js_url(hass, card_url)
    entry.async_on_unload(partial(frontend.remove_extra_js_url, hass, card_url))

    await panel_custom.async_register_panel(
        hass,
        webcomponent_name=WEBCOMPONENT,
        frontend_url_path=PANEL_URL_PATH,
        module_url=f"/api/panel_custom/{DOMAIN}/{PANEL_JS}?v={integration.version}",
        # A sidebar item AND the Configure button: these are independent fields on
        # the same panel record, so the hub-integration surface at
        # Settings > Devices & Services > Zigbee > Configure keeps working while the
        # sidebar gives one-click access. The frontend only renders a sidebar item
        # when `title` is truthy, which is why omitting sidebar_title previously
        # hid it entirely.
        sidebar_title=SIDEBAR_TITLE,
        sidebar_icon=SIDEBAR_ICON,
        require_admin=True,
        config_panel_domain=DOMAIN,
        config={"base_topic": base_topic},
    )

    _register_zwave_shortcut(hass)

    entry.async_on_unload(entry.add_update_listener(_reload_on_change))
    _LOGGER.info("Zigbee panel ready (base topic %s)", base_topic)
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    data: Z2MData | None = hass.data.get(DOMAIN, {}).pop(entry.entry_id, None)
    if data is not None:
        data.async_stop()
    frontend.async_remove_panel(hass, PANEL_URL_PATH)
    # We added the Z-Wave shortcut, so we take it away again. Removing a panel that
    # is not registered raises, and an unload must never do that.
    if ZWAVE_PANEL_URL_PATH in hass.data.get("frontend_panels", {}):
        frontend.async_remove_panel(hass, ZWAVE_PANEL_URL_PATH)
    # The `Zigbee` label and its memberships are left exactly as they are. Stripping
    # them here would rewrite every Zigbee device and entity in the registry on
    # every restart and every reload, for no gain: the label_id is persisted in the
    # entry, so the next setup adopts the same label and reconciles from it. A label
    # the operator can see and use in automations is also not ours to take away
    # because a config entry happened to be reloaded.
    return True


@callback
def _register_zwave_shortcut(hass: HomeAssistant) -> None:
    """Put Home Assistant's own Z-Wave page in the sidebar, next to Zigbee.

    Z-Wave JS registers no panel: /config/zwave_js/dashboard is an internal route of
    the single `config` panel, so there is nothing to unhide and no supported way to
    add a sidebar link to it. What works, and what HA's own Settings item does, is a
    panel record whose url_path IS that path -- the sidebar renders `/${url_path}`
    verbatim and the click is ordinary SPA navigation, so there is no redirect and no
    flash. Server-side the slashed key is inert: IndexView matches only the first
    path segment, so a deep link or F5 still resolves through the real config panel.
    The one cosmetic cost is that the item never highlights, because selection
    compares url_path to the first segment. Settings highlights instead.

    Gated on Z-Wave actually being present: a sidebar link to a page that cannot
    exist is worse than no link.
    """
    if ZWAVE_DOMAIN not in hass.config.components:
        return
    try:
        frontend.async_register_built_in_panel(
            hass,
            "config",
            sidebar_title=ZWAVE_SIDEBAR_TITLE,
            sidebar_icon=ZWAVE_SIDEBAR_ICON,
            frontend_url_path=ZWAVE_PANEL_URL_PATH,
            require_admin=True,
        )
    except ValueError:
        # Already registered, e.g. a reload that did not run our unload path.
        pass


async def _reload_on_change(hass: HomeAssistant, entry: ConfigEntry) -> None:
    await hass.config_entries.async_reload(entry.entry_id)
