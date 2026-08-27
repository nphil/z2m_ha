"""Read the registries, raise the Repairs issue, and apply the fix.

The split is deliberate: `naming.py` decides WHAT should change and is pure, this
module is the only place that touches Home Assistant's registries or the issue
registry, and `repairs.py` is only the flow the operator clicks through.
"""

from __future__ import annotations

from dataclasses import dataclass, field
import logging
from typing import Any

from homeassistant.core import Event, HomeAssistant, callback
from homeassistant.helpers import (
    area_registry as ar,
    device_registry as dr,
    entity_registry as er,
    issue_registry as ir,
)
from homeassistant.helpers.event import async_call_later
from homeassistant.util import slugify

from . import naming
from .const import DOMAIN

_LOGGER = logging.getLogger(__package__)

ISSUE_ID = "naming_punctuation"

# Registry writes fire registry events, including our own, so a rescan is debounced
# and suppressed while a fix is running. Without both, applying a fix would chase
# its own tail through the event bus.
_DEBOUNCE_SECONDS = 15


@callback
def async_scan(hass: HomeAssistant) -> dict[str, list[dict[str, Any]]]:
    """Snapshot the registries and ask `naming` what needs straightening."""
    devices = [
        {
            "id": device.id,
            "name": device.name,
            "name_by_user": device.name_by_user,
            "area_id": device.area_id,
        }
        for device in dr.async_get(hass).devices.values()
    ]
    areas = [
        {"area_id": area.id, "name": area.name, "floor_id": area.floor_id}
        for area in ar.async_get(hass).areas.values()
    ]
    entities = [
        {"entity_id": entity.entity_id, "device_id": entity.device_id}
        for entity in er.async_get(hass).entities.values()
    ]
    return naming.scan(
        devices=devices, areas=areas, entities=entities, slugify=slugify
    )


@callback
def async_apply(
    hass: HomeAssistant,
    findings: dict[str, list[dict[str, Any]]],
    *,
    include_entity_ids: bool,
) -> dict[str, int]:
    """Perform the work a scan described, in dependency order.

    Merges run before renames so the keeper is the survivor either way, and entity
    ids are last because they are the only step with references outside the
    registries -- and the only step the operator has to opt into.
    """
    device_reg = dr.async_get(hass)
    entity_reg = er.async_get(hass)
    area_reg = ar.async_get(hass)
    done = {"devices": 0, "areas": 0, "duplicate_areas": 0, "entities": 0}

    for item in findings["duplicate_areas"]:
        keep, drop = item["keep"], item["drop"]
        if area_reg.async_get_area(drop) is None or area_reg.async_get_area(keep) is None:
            continue
        for device in list(device_reg.devices.values()):
            if device.area_id == drop:
                device_reg.async_update_device(device.id, area_id=keep)
        for entity in list(entity_reg.entities.values()):
            if entity.area_id == drop:
                entity_reg.async_update_entity(entity.entity_id, area_id=keep)
        area_reg.async_delete(drop)
        done["duplicate_areas"] += 1

    for item in findings["areas"]:
        if area_reg.async_get_area(item["area_id"]) is None:
            continue
        area_reg.async_update(item["area_id"], name=item["fixed"])
        done["areas"] += 1

    for item in findings["devices"]:
        if device_reg.async_get(item["device_id"]) is None:
            continue
        # name_by_user, not name: the integration owns `name` and re-asserts it
        # (the Lutron bridge and the iOS device name are the sources here), so an
        # override is the only spelling that survives.
        device_reg.async_update_device(item["device_id"], name_by_user=item["fixed"])
        done["devices"] += 1

    if include_entity_ids:
        for item in findings["entities"]:
            if entity_reg.async_get(item["entity_id"]) is None:
                continue
            if entity_reg.async_get(item["new_entity_id"]) is not None:
                continue
            entity_reg.async_update_entity(
                item["entity_id"], new_entity_id=item["new_entity_id"]
            )
            done["entities"] += 1

    return done


@callback
def async_normalize_machine_ids(hass: HomeAssistant) -> int:
    """Rename entity ids that are still keyed to a raw Zigbee address.

    Split out from the operator-gated fix flow on purpose. Punctuation renames need
    consent because the old ids may be referenced from dashboards and automations
    built over months. An id that is still the IEEE address has just been minted
    for a device that was named seconds ago, so there is nothing to reference yet
    and nothing to weigh: it is only ever an improvement, and asking would mean
    every newly paired device sits wrong until somebody clicks a prompt.
    """
    entity_reg = er.async_get(hass)
    renamed = 0
    for item in async_scan(hass)["entities"]:
        if item.get("reason") != "machine_id":
            continue
        if entity_reg.async_get(item["entity_id"]) is None:
            continue
        if entity_reg.async_get(item["new_entity_id"]) is not None:
            continue
        entity_reg.async_update_entity(
            item["entity_id"], new_entity_id=item["new_entity_id"]
        )
        renamed += 1
    if renamed:
        _LOGGER.info("Renamed %s entity id(s) off their Zigbee address", renamed)
    return renamed


@callback
def async_refresh_issue(hass: HomeAssistant) -> dict[str, list[dict[str, Any]]]:
    """Raise, update or clear the issue to match what the registries say now."""
    findings = async_scan(hass)
    if naming.total(findings):
        ir.async_create_issue(
            hass,
            DOMAIN,
            ISSUE_ID,
            is_fixable=True,
            severity=ir.IssueSeverity.WARNING,
            translation_key="naming_punctuation",
            translation_placeholders=naming.summary(findings),
        )
    else:
        ir.async_delete_issue(hass, DOMAIN, ISSUE_ID)
    return findings


@dataclass
class NamingWatcher:
    """Keeps the issue in step with the registries, without chasing its own writes."""

    hass: HomeAssistant
    _cancel_timer: Any = None
    _unsubs: list[Any] = field(default_factory=list)
    applying: bool = False

    @callback
    def async_start(self) -> None:
        """Scan now, then follow registry changes."""
        async_refresh_issue(self.hass)
        for signal in (
            dr.EVENT_DEVICE_REGISTRY_UPDATED,
            er.EVENT_ENTITY_REGISTRY_UPDATED,
            ar.EVENT_AREA_REGISTRY_UPDATED,
        ):
            self._unsubs.append(
                self.hass.bus.async_listen(signal, self._async_registry_changed)
            )

    @callback
    def _async_registry_changed(self, _event: Event) -> None:
        if self.applying:
            return
        if self._cancel_timer is not None:
            self._cancel_timer()
        self._cancel_timer = async_call_later(
            self.hass, _DEBOUNCE_SECONDS, self._async_rescan
        )

    @callback
    def _async_rescan(self, _now: Any) -> None:
        self._cancel_timer = None
        try:
            async_refresh_issue(self.hass)
        except Exception:  # noqa: BLE001 - a hygiene check must never break setup
            _LOGGER.exception("Naming scan failed")

    @callback
    def async_stop(self) -> None:
        """Drop the listeners and any pending rescan."""
        if self._cancel_timer is not None:
            self._cancel_timer()
            self._cancel_timer = None
        while self._unsubs:
            self._unsubs.pop()()


@callback
def async_get_watcher(hass: HomeAssistant) -> NamingWatcher | None:
    """The running watcher, so the fix flow can mute it while it writes."""
    return hass.data.get(DOMAIN, {}).get("naming_watcher")
