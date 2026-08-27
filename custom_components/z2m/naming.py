"""Naming hygiene: find smart punctuation that forked a name, and describe the fix.

Deliberately free of Home Assistant imports, so it can be reasoned about -- and
tested -- on its own. Everything here takes plain dicts and returns plain dicts;
`naming_scan.py` is what talks to the registries.

A phone keyboard substitutes typographic punctuation as you type, so a name
entered on a phone arrives as "Isabel<curly>s Lamp" while the same name typed on
a desktop is "Isabel's Lamp". That single invisible character forks three
separate things at once:

  * Zigbee2MQTT keys the MQTT topic AND its state cache on the string.
  * Home Assistant slugifies it into entity ids -- isabels_ versus isabel_s_.
  * Areas are matched BY NAME, so a device whose room name curls creates a
    SECOND area beside the real one, with no floor assigned.

The third is the expensive one and the reason this module exists: it is silent,
and every device in the duplicate area drops out of floor-based views and voice
targeting until somebody notices.
"""

from __future__ import annotations

from typing import Any, Callable

# Curled quotes, the three dashes a keyboard never types, the ellipsis glyph, and
# the space characters that are invisible in a name field yet survive into an MQTT
# topic where they are impossible to spot.
SMART_PUNCTUATION: dict[str, str] = {
    "\u2018": "'",
    "\u2019": "'",
    "\u201a": "'",
    "\u201b": "'",
    "\u02bc": "'",
    "\u2032": "'",
    "\u201c": '"',
    "\u201d": '"',
    "\u201e": '"',
    "\u201f": '"',
    "\u2033": '"',
    "\u2013": "-",
    "\u2014": "-",
    "\u2212": "-",
    "\u2026": "...",
    "\u00a0": " ",
    "\u2007": " ",
    "\u202f": " ",
}

_TABLE = str.maketrans(SMART_PUNCTUATION)


def straighten(value: Any) -> str:
    """Return `value` with typographic punctuation replaced by what a keyboard types."""
    if value is None:
        return ""
    return str(value).translate(_TABLE).strip()


def is_curled(value: Any) -> bool:
    """Is this string spelled with punctuation a keyboard does not produce?"""
    if value is None:
        return False
    return straighten(value) != str(value).strip()


def _display_name(device: dict[str, Any]) -> str:
    """The name Home Assistant shows: the operator's override wins."""
    return device.get("name_by_user") or device.get("name") or ""


def _keeper(group: list[dict[str, Any]], device_count: Callable[[str], int]) -> dict[str, Any]:
    """Pick which of several same-name areas survives a merge.

    In order: the one already spelled with a keyboard apostrophe, then the one
    placed on a floor, then the one holding the most devices. That ordering is
    what makes the real area win over the duplicate a phone created -- the
    duplicate is invariably curled, floorless and holds the one device that
    created it.
    """
    return sorted(
        group,
        key=lambda area: (
            is_curled(area.get("name")),
            area.get("floor_id") is None,
            -device_count(area["area_id"]),
            area["area_id"],
        ),
    )[0]


def scan(
    *,
    devices: list[dict[str, Any]],
    areas: list[dict[str, Any]],
    entities: list[dict[str, Any]],
    slugify: Callable[[str], str],
) -> dict[str, list[dict[str, Any]]]:
    """Describe everything that needs straightening.

    `devices`  -- [{"id", "name", "name_by_user", "area_id"}]
    `areas`    -- [{"area_id", "name", "floor_id"}]
    `entities` -- [{"entity_id", "device_id"}]
    `slugify`  -- Home Assistant's own slugify, injected rather than reimplemented
                  so the predicted entity id cannot drift from what HA would mint.

    Returned lists are each a unit of work `naming_scan.async_apply` can perform,
    and an empty dict of empty lists means there is nothing to report.
    """
    by_area: dict[str, int] = {}
    for device in devices:
        if area_id := device.get("area_id"):
            by_area[area_id] = by_area.get(area_id, 0) + 1

    # --- areas: renames, and the duplicates a curled name created ---------------
    groups: dict[str, list[dict[str, Any]]] = {}
    for area in areas:
        groups.setdefault(straighten(area.get("name")).casefold(), []).append(area)

    area_renames: list[dict[str, Any]] = []
    duplicates: list[dict[str, Any]] = []
    for group in groups.values():
        if len(group) > 1:
            keep = _keeper(group, lambda area_id: by_area.get(area_id, 0))
            for area in group:
                if area["area_id"] == keep["area_id"]:
                    continue
                duplicates.append(
                    {
                        "keep": keep["area_id"],
                        "keep_name": straighten(keep.get("name")),
                        "drop": area["area_id"],
                        "drop_name": area.get("name") or "",
                        "devices": by_area.get(area["area_id"], 0),
                    }
                )
            # A merge already resolves the spelling: the keeper is the straight one.
            if is_curled(keep.get("name")):
                area_renames.append(
                    {
                        "area_id": keep["area_id"],
                        "current": keep.get("name") or "",
                        "fixed": straighten(keep.get("name")),
                    }
                )
            continue
        area = group[0]
        if is_curled(area.get("name")):
            area_renames.append(
                {
                    "area_id": area["area_id"],
                    "current": area.get("name") or "",
                    "fixed": straighten(area.get("name")),
                }
            )

    # --- devices, and the entity ids their names minted -------------------------
    entities_by_device: dict[str, list[dict[str, Any]]] = {}
    for entity in entities:
        if device_id := entity.get("device_id"):
            entities_by_device.setdefault(device_id, []).append(entity)

    device_renames: list[dict[str, Any]] = []
    entity_renames: list[dict[str, Any]] = []
    taken = {entity["entity_id"] for entity in entities}
    for device in devices:
        current = _display_name(device)
        if not is_curled(current):
            continue
        fixed = straighten(current)
        device_renames.append(
            {"device_id": device["id"], "current": current, "fixed": fixed}
        )
        # Entity ids are minted from the device name at entity-creation time and
        # are never regenerated, so a device renamed later keeps the old slug.
        old_slug, new_slug = slugify(current), slugify(fixed)
        if old_slug == new_slug:
            continue
        for entity in entities_by_device.get(device["id"], []):
            domain, _, object_id = entity["entity_id"].partition(".")
            if not (object_id == old_slug or object_id.startswith(f"{old_slug}_")):
                continue
            candidate = f"{domain}.{new_slug}{object_id[len(old_slug):]}"
            if candidate == entity["entity_id"] or candidate in taken:
                continue
            entity_renames.append(
                {
                    "entity_id": entity["entity_id"],
                    "new_entity_id": candidate,
                    "device_id": device["id"],
                }
            )
            taken.add(candidate)

    return {
        "devices": device_renames,
        "areas": area_renames,
        "duplicate_areas": duplicates,
        "entities": entity_renames,
    }


def total(findings: dict[str, list[dict[str, Any]]]) -> int:
    """How many pieces of work a scan found."""
    return sum(len(items) for items in findings.values())


def summary(findings: dict[str, list[dict[str, Any]]]) -> dict[str, str]:
    """Counts for the issue text, as the strings a translation expects."""
    return {
        "devices": str(len(findings["devices"])),
        "areas": str(len(findings["areas"])),
        "duplicate_areas": str(len(findings["duplicate_areas"])),
        "entities": str(len(findings["entities"])),
    }


def describe(findings: dict[str, list[dict[str, Any]]]) -> str:
    """A markdown list of exactly what would change, for the fix flow to show."""
    lines: list[str] = []
    for item in findings["duplicate_areas"]:
        devices = item["devices"]
        lines.append(
            f"- Merge duplicate area **{item['drop_name']}** "
            f"({devices} device{'' if devices == 1 else 's'}) into **{item['keep_name']}**"
        )
    for item in findings["areas"]:
        lines.append(f"- Rename area **{item['current']}** to **{item['fixed']}**")
    for item in findings["devices"]:
        lines.append(f"- Rename device **{item['current']}** to **{item['fixed']}**")
    for item in findings["entities"]:
        lines.append(f"- `{item['entity_id']}` to `{item['new_entity_id']}`")
    return "\n".join(lines) if lines else "Nothing to change."
