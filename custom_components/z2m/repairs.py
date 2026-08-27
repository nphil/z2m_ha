"""The guided fix behind the naming-hygiene Repairs issue.

Home Assistant discovers this module by name and calls `async_create_fix_flow`
when the operator presses Fix on the issue. The flow deliberately re-scans rather
than trusting what the issue was raised with: minutes or days may have passed, and
half of the work may already have been done by hand.

Two scopes, because the two halves carry different risk:

  * Names and duplicate areas are safe by construction. Nothing references an
    area's display name, and the area id is an immutable key, so no automation,
    dashboard or script can break. This scope applies straight from the menu.
  * Entity ids are the opposite: renaming one silently orphans every reference to
    it, and Home Assistant does not rewrite those references. That scope gets its
    own confirmation step which says so.
"""

from __future__ import annotations

from typing import Any

import voluptuous as vol

from homeassistant.components.repairs import RepairsFlow
from homeassistant.core import HomeAssistant

from . import naming
from .naming_scan import async_apply, async_get_watcher, async_refresh_issue


async def async_create_fix_flow(
    hass: HomeAssistant,
    issue_id: str,
    data: dict[str, str | int | float | None] | None,
) -> RepairsFlow:
    """Create the flow for the naming issue."""
    return NamingRepairFlow()


class NamingRepairFlow(RepairsFlow):
    """Straighten smart punctuation, with the risky half kept separate."""

    async def async_step_init(self, user_input: dict[str, Any] | None = None):
        """Show what was found and offer the two scopes."""
        findings = async_refresh_issue(self.hass)
        if not naming.total(findings):
            # Someone fixed it by hand between the issue being raised and this click.
            return self.async_create_entry(data={})
        return self.async_show_menu(
            step_id="init",
            menu_options=["names", "everything"],
            description_placeholders={"changes": naming.describe(findings)},
        )

    async def async_step_names(self, user_input: dict[str, Any] | None = None):
        """Names and duplicate areas only. Safe, so no second confirmation."""
        return self._apply(include_entity_ids=False)

    async def async_step_everything(self, user_input: dict[str, Any] | None = None):
        """Also rewrite the entity ids the old spelling minted -- confirm first."""
        findings = async_refresh_issue(self.hass)
        if not naming.total(findings):
            return self.async_create_entry(data={})
        if user_input is None:
            return self.async_show_form(
                step_id="everything",
                data_schema=vol.Schema({}),
                description_placeholders={
                    "entities": str(len(findings["entities"])),
                    "changes": naming.describe(findings),
                },
            )
        return self._apply(include_entity_ids=True)

    def _apply(self, *, include_entity_ids: bool):
        """Do the work, mute the watcher while we write, then re-scan."""
        findings = async_scan_for_apply(self.hass, include_entity_ids)
        watcher = async_get_watcher(self.hass)
        if watcher is not None:
            watcher.applying = True
        try:
            done = async_apply(
                self.hass, findings, include_entity_ids=include_entity_ids
            )
        finally:
            if watcher is not None:
                watcher.applying = False
        # Re-scan so the issue clears itself -- or survives with whatever is left,
        # which is the entity ids when the operator chose the safe scope.
        async_refresh_issue(self.hass)
        return self.async_create_entry(
            title="",
            data={},
            description_placeholders={
                "devices": str(done["devices"]),
                "areas": str(done["areas"]),
                "duplicate_areas": str(done["duplicate_areas"]),
                "entities": str(done["entities"]),
            },
        )


def async_scan_for_apply(
    hass: HomeAssistant, include_entity_ids: bool
) -> dict[str, list[dict[str, Any]]]:
    """A fresh scan, with entity ids dropped when they are out of scope."""
    findings = async_refresh_issue(hass)
    if include_entity_ids:
        return findings
    return {**findings, "entities": []}
