"""Checks for the pure naming-hygiene logic.

Runs without Home Assistant installed, which is the whole reason `naming.py` has
no HA imports. `slugify` is injected here by a stub that reproduces the two real
behaviours observed on a live install: a straight apostrophe acts as a separator
(`Isabel's Lamp` -> `isabel_s_lamp`) while a curled one is dropped
(`Isabel<curly>s Lamp` -> `isabels_lamp`). That difference is the entire bug.
"""

import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "custom_components" / "z2m"))

import naming  # noqa: E402

FAILED = 0


def check(name, cond, extra=""):
    global FAILED
    if cond:
        print(f"  PASS  {name}")
    else:
        FAILED += 1
        print(f"  FAIL  {name} {extra}")


def slugify(value):
    """Stand-in for homeassistant.util.slugify, faithful to the two cases that matter."""
    dropped = re.sub(r"[\u2018\u2019\u201c\u201d\u2032\u2033\u02bc]", "", value)
    return re.sub(r"[^a-z0-9]+", "_", dropped.lower()).strip("_")


print("=== straighten: every class a phone substitutes ===")
check("curled apostrophe", naming.straighten("Isabel\u2019s Lamp") == "Isabel's Lamp")
check("single quotes", naming.straighten("\u2018quoted\u2019") == "'quoted'")
check("double quotes", naming.straighten("\u201cGood\u201d Light") == '"Good" Light')
check("en and em dash", naming.straighten("Hall\u2013A Hall\u2014B") == "Hall-A Hall-B")
check("minus sign", naming.straighten("Temp \u2212 2") == "Temp - 2")
check("ellipsis", naming.straighten("Wait\u2026") == "Wait...")
check("non-breaking space", naming.straighten("Kitchen\u00a0Sink") == "Kitchen Sink")
check("narrow and figure spaces", naming.straighten("A\u202fB\u2007C") == "A B C")
check("trims", naming.straighten("  Lamp  ") == "Lamp")
check("None is empty", naming.straighten(None) == "")
check("a straight name is left alone", naming.straighten("Isabel's Lamp") == "Isabel's Lamp")
check("is_curled sees the difference", naming.is_curled("Isabel\u2019s Lamp"))
check("is_curled ignores plain whitespace", not naming.is_curled("  Isabel's Lamp  "))
check("is_curled on None", not naming.is_curled(None))

print("=== duplicate areas: the silent one ===")
# The real shape: a Lutron restore created a curled, floorless area holding the one
# device that made it, beside the operator's real area.
areas = [
    {"area_id": "isabel_s_bathroom", "name": "Isabel's Bathroom", "floor_id": "main_floor"},
    {"area_id": "isabels_bathroom", "name": "Isabel\u2019s Bathroom", "floor_id": None},
    {"area_id": "kitchen", "name": "Kitchen", "floor_id": "main_floor"},
]
devices = [
    {"id": "d1", "name": "Dimmer", "name_by_user": None, "area_id": "isabel_s_bathroom"},
    {"id": "d2", "name": "Sensor", "name_by_user": None, "area_id": "isabel_s_bathroom"},
    {"id": "d3", "name": "Lutron Light", "name_by_user": None, "area_id": "isabels_bathroom"},
]
found = naming.scan(devices=devices, areas=areas, entities=[], slugify=slugify)
check("the duplicate is found", len(found["duplicate_areas"]) == 1)
dupe = found["duplicate_areas"][0]
check("the real area is kept", dupe["keep"] == "isabel_s_bathroom")
check("the curled floorless one is dropped", dupe["drop"] == "isabels_bathroom")
check("and it reports what would move", dupe["devices"] == 1)
check("a merge is not also reported as a rename", found["areas"] == [])
check("an unaffected area is untouched",
      all(a["area_id"] != "kitchen" for a in found["areas"]))

print("=== a curled area with no twin is a plain rename ===")
solo = naming.scan(
    devices=[],
    areas=[{"area_id": "nitins_office", "name": "Nitin\u2019s Office", "floor_id": "main_floor"}],
    entities=[],
    slugify=slugify,
)
check("renamed, not merged", len(solo["areas"]) == 1 and solo["duplicate_areas"] == [])
check("to the straight spelling", solo["areas"][0]["fixed"] == "Nitin's Office")

print("=== keeper choice falls through to device count ===")
tie = naming.scan(
    devices=[
        {"id": "a", "name": "x", "name_by_user": None, "area_id": "few"},
        {"id": "b", "name": "y", "name_by_user": None, "area_id": "many"},
        {"id": "c", "name": "z", "name_by_user": None, "area_id": "many"},
    ],
    areas=[
        {"area_id": "few", "name": "Study", "floor_id": "up"},
        {"area_id": "many", "name": "Study", "floor_id": "up"},
    ],
    entities=[],
    slugify=slugify,
)
check("the fuller area wins when spelling and floor tie",
      tie["duplicate_areas"][0]["keep"] == "many")

print("=== devices and the entity ids their names minted ===")
devices = [
    {"id": "dev", "name": "Presence Sensor", "name_by_user": "Isabel\u2019s Bathroom Sensor",
     "area_id": None},
]
entities = [
    {"entity_id": "binary_sensor.isabels_bathroom_sensor_occupancy", "device_id": "dev"},
    {"entity_id": "sensor.isabels_bathroom_sensor_battery", "device_id": "dev"},
    # Minted before the device was named: a different generation, left alone.
    {"entity_id": "sensor.presence_sensor_uptime", "device_id": "dev"},
    # Another device's entity that merely starts with a similar word.
    {"entity_id": "light.isabels_bathroom_lights", "device_id": "other"},
]
found = naming.scan(devices=devices, areas=[], entities=entities, slugify=slugify)
check("the override is what gets straightened",
      found["devices"] == [{"device_id": "dev", "current": "Isabel\u2019s Bathroom Sensor",
                            "fixed": "Isabel's Bathroom Sensor"}])
ids = {e["entity_id"]: e["new_entity_id"] for e in found["entities"]}
check("occupancy is renamed",
      ids.get("binary_sensor.isabels_bathroom_sensor_occupancy")
      == "binary_sensor.isabel_s_bathroom_sensor_occupancy")
check("battery is renamed",
      ids.get("sensor.isabels_bathroom_sensor_battery")
      == "sensor.isabel_s_bathroom_sensor_battery")
check("an earlier naming generation is not touched",
      "sensor.presence_sensor_uptime" not in ids)
check("another device's entity is never touched",
      "light.isabels_bathroom_lights" not in ids)

print("=== entity ids are only predicted when they would actually change ===")
same = naming.scan(
    devices=[{"id": "d", "name": None, "name_by_user": "Hall \u2014 Main", "area_id": None}],
    entities=[{"entity_id": "light.hall_main", "device_id": "d"}],
    areas=[],
    slugify=slugify,
)
check("device still renamed", len(same["devices"]) == 1)
check("but the slug is unchanged, so no entity rename", same["entities"] == [])

print("=== a rename that would collide is skipped, not forced ===")
collide = naming.scan(
    devices=[{"id": "d", "name": None, "name_by_user": "Isabel\u2019s Lamp", "area_id": None}],
    entities=[
        {"entity_id": "light.isabels_lamp", "device_id": "d"},
        {"entity_id": "light.isabel_s_lamp", "device_id": "occupied"},
    ],
    areas=[],
    slugify=slugify,
)
check("the occupied id is left alone", collide["entities"] == [])

print("=== reporting ===")
check("total counts every unit of work", naming.total(found) == 3)
check("summary is all strings",
      all(isinstance(v, str) for v in naming.summary(found).values()))
text = naming.describe(found)
check("describe names the device", "Isabel's Bathroom Sensor" in text)
check("describe lists the entity ids", "binary_sensor.isabel_s_bathroom_sensor_occupancy" in text)
empty = naming.scan(devices=[], areas=[], entities=[], slugify=slugify)
check("a clean install finds nothing", naming.total(empty) == 0)
check("and says so", naming.describe(empty) == "Nothing to change.")

print()
if FAILED:
    print(f"{FAILED} CHECK(S) FAILED")
    sys.exit(1)
print("ALL CHECKS PASSED")
