"""Mirrors Zigbee2MQTT's retained bridge topics into local state.

Z2M publishes bridge/info, bridge/devices, bridge/groups, bridge/state and
bridge/health as RETAINED topics, so a fresh subscription is immediately given the
current picture with no polling and no request/response round trip. This class holds
that picture and fires a dispatcher signal whenever any of it changes, which is what
lets the panel be push-driven.

Three things sit on top of that mirror, because MQTT does not hand them over for
free:

* Request/response. Z2M answers every `bridge/request/<x>` on `bridge/response/<x>`
  with `{status, data, error?}` and echoes back any `transaction` string the request
  carried. `async_request_response` turns that into an ordinary awaitable. The
  transaction is load-bearing rather than tidy: `coordinator_check` measured 43 s
  against the live bridge, so a second request can easily be outstanding while the
  first is still unanswered, and both answers land on the same topic.

* The network map, cached, because a full scan interrogates every router. A scan is
  also streamed device by device as it runs -- see _Scan -- so the panel can put
  the whole fleet on screen from the retained device list and then fill in the
  links as each neighbour table arrives, instead of showing a spinner for a minute.

* The `Zigbee` label -- see Z2MLabels.
"""

from __future__ import annotations

import asyncio
from collections import deque
from collections.abc import Callable, Iterable
from functools import partial
import hashlib
import json
import logging
from pathlib import Path
import time
from typing import Any

from homeassistant.components import mqtt
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import Event, HomeAssistant, callback
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers import (
    device_registry as dr,
    entity_registry as er,
    label_registry as lr,
)
from homeassistant.helpers.debounce import Debouncer
from homeassistant.helpers.dispatcher import (
    async_dispatcher_connect,
    async_dispatcher_send,
)

from .const import (
    BRIDGE_TOPICS,
    CONF_LABEL_ID,
    COORDINATOR_CHECK_TIMEOUT,
    DOMAIN,
    EXTENSION_NAME,
    EXTENSION_SAVE_TIMEOUT,
    EXTENSION_WAIT,
    LABEL_COLOR,
    LABEL_DEBOUNCE,
    LABEL_DESCRIPTION,
    LABEL_ICON,
    LABEL_NAME,
    LOG_BUFFER,
    MAP_TIMEOUT,
    MAP_TTL,
    MQTT_IDENT_DOMAIN,
    MQTT_IDENT_PREFIX,
    REQ,
    RESP,
    SCAN_CONCURRENCY,
    SCAN_DEVICE_TIMEOUT,
    SCAN_MIN_INTERVAL,
    SIGNAL_DEVICE_LIST,
    SIGNAL_DEVICES,
    SIGNAL_GROUPS,
    SIGNAL_LOG,
    SIGNAL_MAP,
    SIGNAL_PAIRING,
    SIGNAL_UPDATE,
    TOPIC_DEVICES,
    TOPIC_EVENT,
    TOPIC_EXTENSIONS,
    TOPIC_GROUPS,
    TOPIC_HEALTH,
    TOPIC_INFO,
    TOPIC_LOGGING,
    TOPIC_LQI,
    TOPIC_STATE,
)

_LOGGER = logging.getLogger(__package__)

# Only these hold a neighbour table. An end device talks to its parent and keeps
# none, so asking one costs a round trip and returns nothing; it still reaches the
# map, as a row in its parent's table.
PROBED_TYPES = ("Coordinator", "Router")

# bridge/devices uses herdsman's enum names while bridge/event uses lower-case
# interview statuses. Both normalize to the panel's four phases.
INTERVIEW_PHASES = {
    "pending": "joined",
    "in_progress": "interview_started",
    "started": "interview_started",
    "successful": "successful",
    "failed": "failed",
}

# Some Xiaomi devices report this instead of their own address in a neighbour table.
ZERO_IEEE = "0x0000000000000000"


class Z2MError(Exception):
    """Zigbee2MQTT refused a request, or never answered one."""


class _NoAnswer(Z2MError):
    """Nothing came back at all, as opposed to a reply that says no.

    Worth its own type for exactly one decision: an error reply proves our
    extension is loaded and listening, silence does not.
    """


def _extension_source() -> tuple[str, str]:
    """Our Zigbee2MQTT extension's source, and a digest of it.

    Blocking file I/O -- call it from the executor. The digest is what decides
    whether the copy Zigbee2MQTT holds needs replacing: it covers every byte,
    so it cannot be defeated by forgetting to bump a version marker in the file.
    """
    source = (Path(__file__).parent / EXTENSION_NAME).read_text(encoding="utf8")
    return source, hashlib.sha256(source.encode("utf8")).hexdigest()


@callback
def _endpoint_ids(endpoints: Any) -> list[int]:
    """Z2M's `endpoints` map, as the sorted numeric ids the panel can offer.

    Z2M publishes this as an object keyed by endpoint id, and JSON object keys are
    strings even though the group API matches on the number. Anything that is not
    a number is dropped rather than passed through: an unparseable key would be
    offered as a member target and then rejected by the bridge.
    """
    if not isinstance(endpoints, dict):
        return []
    ids: list[int] = []
    for key in endpoints:
        try:
            ids.append(int(key))
        except (TypeError, ValueError):
            continue
    return sorted(ids)


@callback
def _pairing_definition(definition: Any) -> dict[str, Any] | None:
    """The three fields a pairing card shows, and nothing else.

    Z2M's `definition` carries the device's whole `exposes` schema -- hundreds of
    kilobytes across a fleet. The pairing view names the thing that just joined; it
    does not render controls, and `z2m/devices` already carries the full schema for
    the code that does.
    """
    if not isinstance(definition, dict):
        return None
    return {
        "vendor": definition.get("vendor"),
        "model": definition.get("model"),
        "description": definition.get("description"),
    }


@callback
def ieee_from_identifiers(identifiers: Iterable[tuple[str, ...]]) -> str | None:
    """The Zigbee ieee address behind a device's MQTT identifier, if it has one.

    Matches both `zigbee2mqtt_0x...` (a device) and `zigbee2mqtt_bridge_0x...` (the
    coordinator). Group identifiers are `zigbee2mqtt_<base topic>_<n>` and have no
    `0x`, so they are correctly ignored, as is every other <thing>2mqtt bridge
    sharing the `mqtt` identifier domain.

    MQTT device identifiers may carry discovery metadata after the domain and
    identifier. Home Assistant 2026.8 uses three-item tuples for some entries, so
    only the first two fields are structural here.
    """
    for identifier in identifiers:
        if len(identifier) < 2:
            continue
        domain, ident = identifier[0], identifier[1]
        if (
            domain != MQTT_IDENT_DOMAIN
            or not isinstance(ident, str)
            or not ident.startswith(MQTT_IDENT_PREFIX)
        ):
            continue
        _, _, tail = ident.rpartition("_")
        if tail.startswith("0x"):
            return tail
    return None


class _Pending:
    """One outstanding bridge/request, and the count of callers riding on it."""

    __slots__ = ("future", "transaction", "waiters")

    def __init__(self, future: asyncio.Future[dict[str, Any]], transaction: str) -> None:
        self.future = future
        self.transaction = transaction
        self.waiters = 0


class _Scan:
    """One network scan in flight, and the listeners watching it happen.

    A scan exists so it can be watched. The `start` event is built here, before any
    radio traffic, out of the retained device list, which is what lets the panel
    draw all 45 devices at once instead of an empty box and a promise. Every
    per-device event is kept as well, so a second tab arriving mid-scan can be given
    what has already been found rather than a map with holes in it until `done`.

    `seen` and `pairs` live for the whole scan rather than per device: the streamed
    events are then a strict decomposition of the final link list, so the map only
    ever gains links and never has to withdraw one it already drew.
    """

    __slots__ = (
        "by_addr",
        "counts",
        "device_events",
        "failures",
        "known",
        "listeners",
        "nodes",
        "pairs",
        "probed",
        "seen",
        "start_event",
        "streaming",
        "targets",
        "task",
    )

    def __init__(
        self,
        nodes: list[dict[str, Any]],
        targets: list[str],
        by_addr: dict[int, str],
        coordinator: str | None,
        streaming: bool,
    ) -> None:
        self.nodes = nodes
        self.targets = targets
        self.by_addr = by_addr
        self.known = {node["ieee"] for node in nodes}
        self.streaming = streaming
        self.listeners: list[Callable[[dict[str, Any]], None]] = []
        self.device_events: list[dict[str, Any]] = []
        self.failures: dict[str, str] = {}
        self.probed = 0
        self.seen: set[tuple[Any, ...]] = set()
        self.pairs: set[tuple[str, str]] = set()
        self.counts = dict.fromkeys(
            ("self", "unknown", "duplicate", "mirror", "inactive", "unknown_lqi", "patched"), 0
        )
        self.task: asyncio.Task[None] | None = None
        # `total` is how many devices will be probed, not the size of the fleet:
        # it is the denominator of the walk's progress, and `nodes` already carries
        # the fleet. Fixed before `start` goes out, and never revised afterwards --
        # a progress total that moves is worse than none. Both walks probe the same
        # set, the coordinator and the routers.
        self.start_event: dict[str, Any] = {
            "phase": "start",
            "total": len(targets),
            "coordinator": coordinator,
            "nodes": nodes,
            "streaming": streaming,
        }

    @callback
    def emit(self, event: dict[str, Any]) -> None:
        if event["phase"] == "device":
            self.device_events.append(event)
        for send in self.listeners:
            send(event)

    @callback
    def fail(self, ieee: str, error: str, name: str | None) -> None:
        """Record and announce one device that would not give up its table."""
        self.failures[ieee] = error
        self.emit(
            {"phase": "device", "ieee": ieee, "name": name, "ok": False, "error": error}
        )

    @callback
    def result_nodes(self, last_seen: dict[str, int]) -> list[dict[str, Any]]:
        """The nodes as the finished topology should carry them.

        `failed` marks the devices whose neighbour table we could not read, which is
        the same word Z2M's own map uses for it, and `lastSeen` is refreshed from
        whatever the walk learned -- neither is knowable when `start` goes out.
        """
        out: list[dict[str, Any]] = []
        for node in self.nodes:
            changes: dict[str, Any] = {}
            if node["ieee"] in self.failures and "lqi" not in node["failed"]:
                changes["failed"] = [*node["failed"], "lqi"]
            fresh = last_seen.get(node["ieee"])
            if fresh is not None and fresh != node["lastSeen"]:
                changes["lastSeen"] = fresh
            out.append({**node, **changes} if changes else node)
        return out

    @callback
    def audit(self) -> str:
        dropped = ", ".join(f"{name}={count}" for name, count in self.counts.items() if count)
        return dropped or "nothing dropped"


class Z2MData:
    """Live mirror of the Z2M bridge, plus the request side."""

    def __init__(self, hass: HomeAssistant, base_topic: str) -> None:
        self.hass = hass
        self.base_topic = base_topic.rstrip("/")
        self.info: dict[str, Any] = {}
        self.devices: list[dict[str, Any]] = []
        self.groups: list[dict[str, Any]] = []
        self.health: dict[str, Any] = {}
        self.bridge_state: str | None = None
        self.availability: dict[str, str] = {}
        # Latest normalized join/interview state per IEEE address. bridge/event is
        # not retained, so bridge/devices also reconciles this cache on reload.
        self._pairing_sessions: dict[str, dict[str, Any]] = {}
        # How many pairing views are watching, and the log level to put back when
        # the last of them goes away. Held here rather than in the browser because
        # only this side is guaranteed to be told when a client disappears.
        self._verbose_users = 0
        self._verbose_restore: str | None = None
        # Set by Z2MLabels once the label is resolved, and surfaced in summary() so
        # the panel can deep-link into HA's own tables with ?label=<id>.
        self.label_id: str | None = None
        # bridge/logging ring buffer, newest last.
        self.logs: deque[dict[str, Any]] = deque(maxlen=LOG_BUFFER)
        # Normalized topology and when it was produced (epoch seconds).
        self.map: dict[str, Any] | None = None
        self.map_generated: float | None = None
        self.map_scanning = False
        # Whether our neighbour-table extension is installed and answering, so a
        # scan can be streamed device by device. None until setup has decided.
        self.stream_ready: bool | None = None
        self._scan: _Scan | None = None
        self._map_error: str | None = None
        # ieee -> epoch ms, learned from the walk. bridge/devices carries no
        # last-seen and device state topics are not retained, so this is the only
        # place a map drawn from the retained inventory can get it from.
        self._last_seen: dict[str, int] = {}
        # name -> digest of the extensions Z2M reports on its retained topic. None
        # until that topic has been seen, which is not the same as "none installed".
        self._extensions: dict[str, str] | None = None
        # Set once bridge/info and bridge/extensions have both been mirrored, which
        # is everything the install decision needs.
        self._bridge_seen = asyncio.Event()
        self._pending: dict[str, _Pending] = {}
        # Read requests may deliberately coalesce by path; writes must not. A
        # per-path lock gives every mutation its own transaction and response.
        self._mutation_locks: dict[str, asyncio.Lock] = {}
        # Neighbour-table replies all land on one topic with several requests
        # outstanding, so they are matched by transaction, not by path.
        self._lqi_waiters: dict[str, asyncio.Future[dict[str, Any]]] = {}
        self._dispatch_lock = asyncio.Lock()
        self._next_dispatch = 0.0
        self._transaction = 0
        self._unsubs: list[Any] = []

    # ---------------------------------------------------------------- subscribe

    async def async_start(self) -> None:
        """Subscribe to the bridge topics, availability, logging and responses."""
        await mqtt.async_wait_for_mqtt_client(self.hass)

        for suffix in BRIDGE_TOPICS:
            topic = f"{self.base_topic}/{suffix}"
            self._unsubs.append(
                await mqtt.async_subscribe(self.hass, topic, self._on_bridge, 0)
            )

        # Availability is published per friendly_name, one level below base_topic.
        self._unsubs.append(
            await mqtt.async_subscribe(
                self.hass, f"{self.base_topic}/+/availability", self._on_availability, 0
            )
        )

        # Logging gets its own handler: at log_level info Z2M emits a line for every
        # MQTT publish, so folding it into SIGNAL_UPDATE would re-render the whole
        # panel several times a second.
        self._unsubs.append(
            await mqtt.async_subscribe(
                self.hass, f"{self.base_topic}/{TOPIC_LOGGING}", self._on_logging, 0
            )
        )
        # Join/interview lifecycle is non-retained. Keep one standing subscription
        # and reconcile terminal state from retained bridge/devices on reload.
        self._unsubs.append(
            await mqtt.async_subscribe(
                self.hass, f"{self.base_topic}/{TOPIC_EVENT}", self._on_event, 0
            )
        )

        # Retained, and the authoritative answer to "is our extension installed":
        # it carries the name and the full source of every external extension Z2M
        # has loaded, so the install decision costs no request.
        self._unsubs.append(
            await mqtt.async_subscribe(
                self.hass,
                f"{self.base_topic}/{TOPIC_EXTENSIONS}",
                self._on_extensions,
                0,
            )
        )

        # One standing subscription covering every response path, established before
        # we ever publish a request. Subscribing per request would race the publish
        # and lose replies to the fast endpoints.
        self._unsubs.append(
            await mqtt.async_subscribe(
                self.hass, f"{self.base_topic}/{RESP}/#", self._on_response, 0
            )
        )
        _LOGGER.debug("Subscribed to %s bridge topics", self.base_topic)

    @callback
    def async_stop(self) -> None:
        for unsub in self._unsubs:
            unsub()
        self._unsubs.clear()
        scan = self._scan
        if scan is not None and scan.task is not None and not scan.task.done():
            scan.task.cancel()
        self._scan = None
        for waiter in self._lqi_waiters.values():
            if not waiter.done():
                waiter.cancel()
        self._lqi_waiters.clear()
        # Nothing can answer these now, so wake the waiters instead of leaving them
        # to sit out a three-minute timeout against an unloaded entry.
        for pending in self._pending.values():
            if not pending.future.done():
                pending.future.set_result(
                    {"status": "error", "error": "Zigbee entry unloaded"}
                )
        self._pending.clear()

    # ----------------------------------------------------------------- handlers

    @callback
    def _on_bridge(self, msg: mqtt.ReceiveMessage) -> None:
        suffix = msg.topic[len(self.base_topic) + 1 :]
        try:
            payload = json.loads(msg.payload) if msg.payload else None
        except ValueError:
            # bridge/state was a bare string in older Z2M; tolerate both.
            payload = msg.payload

        devices_changed = False
        groups_changed = False
        pairing_window_changed = False
        if suffix == TOPIC_INFO and isinstance(payload, dict):
            previous_window = (
                self.info.get("permit_join"),
                self.info.get("permit_join_end"),
            )
            self.info = payload
            pairing_window_changed = previous_window != (
                self.info.get("permit_join"),
                self.info.get("permit_join_end"),
            )
            self._check_bridge_seen()
        elif suffix == TOPIC_DEVICES and isinstance(payload, list):
            self.devices = payload
            self._reconcile_pairing_devices()
            devices_changed = True
        elif suffix == TOPIC_GROUPS and isinstance(payload, list):
            self.groups = payload
            groups_changed = True
        elif suffix == TOPIC_HEALTH and isinstance(payload, dict):
            self.health = payload
        elif suffix == TOPIC_STATE:
            if isinstance(payload, dict):
                self.bridge_state = payload.get("state")
            elif isinstance(payload, str):
                self.bridge_state = payload
        else:
            return

        async_dispatcher_send(self.hass, SIGNAL_UPDATE)
        if pairing_window_changed:
            async_dispatcher_send(self.hass, SIGNAL_PAIRING, self.pairing_message())
        if devices_changed:
            # Only the retained inventory signal reaches label reconciliation.
            # The projection signal also covers availability-only changes.
            async_dispatcher_send(self.hass, SIGNAL_DEVICES)
            async_dispatcher_send(self.hass, SIGNAL_DEVICE_LIST)
        if groups_changed:
            async_dispatcher_send(self.hass, SIGNAL_GROUPS)

    @callback
    def _on_event(self, msg: mqtt.ReceiveMessage) -> None:
        """Normalize one non-retained join/interview event."""
        try:
            payload = json.loads(msg.payload)
        except ValueError:
            return
        if not isinstance(payload, dict) or not isinstance(payload.get("data"), dict):
            return

        event_type = payload.get("type")
        source = payload["data"]
        if event_type == "device_joined":
            phase = "joined"
        elif event_type == "device_interview":
            status = source.get("status")
            phase = (
                INTERVIEW_PHASES.get(status.lower())
                if isinstance(status, str)
                else None
            )
        else:
            return

        ieee = source.get("ieee_address")
        if not isinstance(ieee, str) or phase is None:
            return
        event: dict[str, Any] = {
            "type": event_type,
            "ieee_address": ieee,
            "friendly_name": source.get("friendly_name"),
            "phase": phase,
        }
        if "supported" in source:
            event["supported"] = source["supported"]
        if "definition" in source:
            event["definition"] = _pairing_definition(source["definition"])
        self._store_pairing_event(event)

    @callback
    def _reconcile_pairing_devices(self) -> None:
        """Recover in-flight interview phases from retained bridge/devices.

        bridge/event is not retained, so a browser that reloads mid-pairing would
        otherwise learn nothing about the device it was watching. Only devices that
        are NOT finished are recovered: seeding a session for all 42 healthy devices
        would make every snapshot a full inventory dump, and none of it describes
        anything the operator is currently doing.
        """
        for device in self.devices:
            state = device.get("interview_state")
            if not isinstance(state, str):
                continue
            phase = INTERVIEW_PHASES.get(state.lower())
            ieee = device.get("ieee_address")
            if phase is None or not isinstance(ieee, str):
                continue
            # A device that finished long ago is only carried while this run is
            # already tracking it, so a pairing that completes still reports its
            # terminal state to whoever was watching.
            if phase == "successful" and ieee not in self._pairing_sessions:
                continue
            event: dict[str, Any] = {
                "type": "device_joined" if phase == "joined" else "device_interview",
                "ieee_address": ieee,
                "friendly_name": device.get("friendly_name"),
                "phase": phase,
            }
            if "supported" in device:
                event["supported"] = device["supported"]
            if device.get("definition"):
                event["definition"] = _pairing_definition(device["definition"])
            self._store_pairing_event(event)

    @callback
    def _store_pairing_event(self, event: dict[str, Any]) -> None:
        ieee = event["ieee_address"]
        if self._pairing_sessions.get(ieee) == event:
            return
        self._pairing_sessions[ieee] = event
        async_dispatcher_send(
            self.hass, SIGNAL_PAIRING, {"kind": "event", "event": dict(event)}
        )

    @callback
    def pairing_snapshot(self) -> dict[str, Any]:
        return {
            "permit_join": self.info.get("permit_join"),
            "permit_join_end": self.info.get("permit_join_end"),
            "sessions": [dict(event) for event in self._pairing_sessions.values()],
        }

    @callback
    def pairing_message(self) -> dict[str, Any]:
        return {"kind": "snapshot", "pairing": self.pairing_snapshot()}

    async def async_pairing_verbose_acquire(self) -> None:
        """Raise Zigbee2MQTT to debug while at least one pairing view is watching.

        Reference counted, because two tabs (or a phone and a laptop) can watch the
        same join, and the first one to close must not silence the other.
        """
        self._verbose_users += 1
        if self._verbose_users > 1:
            return
        current = self.info.get("log_level")
        if not isinstance(current, str) or current == "debug":
            # Already debug, or the bridge has not told us yet. Either way there is
            # nothing to restore afterwards, so record nothing.
            return
        self._verbose_restore = current
        await self.async_request(
            "options", {"options": {"advanced": {"log_level": "debug"}}}
        )
        _LOGGER.debug("Pairing view raised Zigbee2MQTT log level from %s", current)

    @callback
    def async_pairing_verbose_release(self) -> None:
        """Put the level back once the last pairing view has gone.

        Called from a websocket unsubscribe, which Home Assistant also runs when the
        socket dies -- that is why this is reliable where a browser is not. It is a
        @callback, so the MQTT publish goes out as a task rather than being awaited
        during teardown.
        """
        self._verbose_users = max(0, self._verbose_users - 1)
        if self._verbose_users:
            return
        restore = self._verbose_restore
        self._verbose_restore = None
        if restore is None:
            return
        self.hass.async_create_task(
            self.async_request(
                "options", {"options": {"advanced": {"log_level": restore}}}
            ),
            f"{DOMAIN} restore log level",
        )
        _LOGGER.debug("Pairing view restored Zigbee2MQTT log level to %s", restore)

    @callback
    def async_clear_pairing_sessions(self) -> None:
        """Begin a UI-owned positive permit window with an empty session list."""
        self._pairing_sessions.clear()
        async_dispatcher_send(self.hass, SIGNAL_PAIRING, self.pairing_message())
    @callback
    def _on_availability(self, msg: mqtt.ReceiveMessage) -> None:
        # <base>/<friendly name>/availability -- the name may itself contain slashes.
        name = msg.topic[len(self.base_topic) + 1 : -len("/availability")]
        try:
            payload = json.loads(msg.payload)
            state = payload.get("state") if isinstance(payload, dict) else str(payload)
        except ValueError:
            state = msg.payload

        previous = self.availability.get(name)
        if state:
            if state == previous:
                return
            self.availability[name] = state
        elif previous is not None:
            del self.availability[name]
        else:
            return
        async_dispatcher_send(self.hass, SIGNAL_UPDATE)
        async_dispatcher_send(self.hass, SIGNAL_DEVICE_LIST)

    @callback
    def _on_extensions(self, msg: mqtt.ReceiveMessage) -> None:
        """Mirror which external extensions Z2M has loaded.

        Digests rather than the sources themselves: the only question ever asked of
        this is whether Z2M's copy of ours is byte-for-byte the file on disk, and
        holding somebody else's extension in memory for the life of the entry buys
        nothing.
        """
        try:
            payload = json.loads(msg.payload) if msg.payload else []
        except ValueError:
            return
        if not isinstance(payload, list):
            return
        self._extensions = {
            entry["name"]: hashlib.sha256(entry["code"].encode("utf8")).hexdigest()
            for entry in payload
            if isinstance(entry, dict)
            and isinstance(entry.get("name"), str)
            and isinstance(entry.get("code"), str)
        }
        self._check_bridge_seen()

    @callback
    def _check_bridge_seen(self) -> None:
        if self.info and self._extensions is not None:
            self._bridge_seen.set()


    @callback
    def _on_logging(self, msg: mqtt.ReceiveMessage) -> None:
        """Buffer one bridge/logging line and push it to any listener.

        Z2M suppresses a line identical to the one immediately before it, so a
        message repeating in a tight loop shows up once. Its published type also
        carries `namespace`, but in practice that is absent and the namespace is
        already prefixed into the message text ("z2m:mqtt: ..."), so the buffer
        holds only what the panel renders.
        """
        try:
            payload = json.loads(msg.payload)
        except ValueError:
            return
        if not isinstance(payload, dict):
            return
        entry = {
            "time": time.time(),
            "level": payload.get("level") or "info",
            "message": payload.get("message") or "",
        }
        self.logs.append(entry)
        async_dispatcher_send(self.hass, SIGNAL_LOG, entry)

    @callback
    def _on_response(self, msg: mqtt.ReceiveMessage) -> None:
        """Resolve the request waiting on this response path, if it is ours."""
        path = msg.topic[len(self.base_topic) + len(RESP) + 2 :]
        if path == TOPIC_LQI:
            self._on_lqi(msg)
            return
        pending = self._pending.get(path)
        if pending is None or pending.future.done():
            return
        try:
            payload = json.loads(msg.payload)
        except ValueError:
            return
        if not isinstance(payload, dict):
            return
        transaction = payload.get("transaction")
        if transaction is not None and transaction != pending.transaction:
            # Someone else's answer, or a very late one of ours: Z2M's own web UI
            # publishes on these same topics, and a coordinator_check reply has been
            # measured arriving 40 s after we gave up on it. Matching the
            # transaction is what stops that reply satisfying the next request.
            _LOGGER.debug("Ignoring %s response for transaction %s", path, transaction)
            return
        pending.future.set_result(payload)

    @callback
    def _on_lqi(self, msg: mqtt.ReceiveMessage) -> None:
        """Hand one neighbour-table reply to the probe that asked for it.

        Matched by transaction rather than by path because this is the one endpoint
        with several requests outstanding at once, all answering on the same topic.
        A reply nobody is waiting for is dropped rather than credited to whichever
        device asked last: the extension retries once after a 5 s pause, so an
        answer can genuinely arrive after its probe timed out.
        """
        try:
            payload = json.loads(msg.payload)
        except ValueError:
            return
        if not isinstance(payload, dict):
            return
        transaction = payload.get("transaction")
        if not isinstance(transaction, str):
            return
        waiter = self._lqi_waiters.get(transaction)
        if waiter is None or waiter.done():
            _LOGGER.debug("Ignoring unclaimed neighbour table for %s", transaction)
            return
        waiter.set_result(payload)

    # ------------------------------------------------------------------ publish

    async def async_request(self, path: str, payload: Any) -> None:
        """Publish to bridge/request/<path> without waiting for the answer.

        Right for the commands whose observable result arrives as a retained-topic
        update anyway (rename, options, OTA, restart). Use async_request_response
        where the caller actually needs the reply.
        """
        topic = f"{self.base_topic}/{REQ}/{path}"
        body = payload if isinstance(payload, str) else json.dumps(payload)
        await mqtt.async_publish(self.hass, topic, body, qos=0, retain=False)
        _LOGGER.debug("Published %s -> %s", topic, body)

    async def async_request_response(
        self, path: str, payload: Any, timeout: float
    ) -> dict[str, Any]:
        """Publish bridge/request/<path> and return the `data` Z2M answers with.

        Raises Z2MError when Z2M answers `status: "error"`, and when nothing answers
        inside `timeout`.

        Concurrent callers for one path ride the same request rather than issuing a
        duplicate: two browser tabs opening the same page must not make the
        coordinator run a 40 s scan twice.
        """
        pending = self._pending.get(path)
        if pending is not None:
            return await self._async_wait(path, pending, timeout)

        self._transaction += 1
        transaction = f"{DOMAIN}-{self._transaction}"
        pending = _Pending(self.hass.loop.create_future(), transaction)
        self._pending[path] = pending

        # Endpoints whose documented request body is the empty string still echo a
        # transaction back: Z2M copies it whenever the request parsed as an object,
        # and ignores the other keys. Verified live against 2.13.0-1 on both
        # health_check and coordinator_check.
        body: dict[str, Any] = {"transaction": transaction}
        if isinstance(payload, dict):
            body.update(payload)
        await mqtt.async_publish(
            self.hass,
            f"{self.base_topic}/{REQ}/{path}",
            json.dumps(body),
            qos=0,
            retain=False,
        )
        return await self._async_wait(path, pending, timeout)

    async def async_request_mutation(
        self, path: str, payload: Any, timeout: float
    ) -> dict[str, Any]:
        """Publish a WRITE and return its own answer, never somebody else's.

        async_request_response deliberately coalesces concurrent callers by path,
        which is right for expensive reads: two tabs opening the map must not make
        the coordinator scan twice. It is WRONG for a write, because two group
        member additions share a path and carry different payloads -- the second
        caller would be handed the first one's result and the second command would
        never be sent. Serializing per path gives every mutation its own
        transaction, its own publish and its own response.
        """
        lock = self._mutation_locks.get(path)
        if lock is None:
            lock = self._mutation_locks[path] = asyncio.Lock()
        async with lock:
            return await self.async_request_response(path, payload, timeout)

    async def _async_wait(
        self, path: str, pending: _Pending, timeout: float
    ) -> dict[str, Any]:
        """Wait out one in-flight request and unwrap Z2M's envelope."""
        pending.waiters += 1
        try:
            async with asyncio.timeout(timeout):
                # Shielded: a caller that gives up, or a browser that navigates
                # away, must not cancel the future its fellow riders still hold.
                response = await asyncio.shield(pending.future)
        except TimeoutError:
            raise Z2MError(
                f"Zigbee2MQTT did not answer {path} within {timeout:g}s"
            ) from None
        finally:
            pending.waiters -= 1
            # The last one out clears the slot. Leaving it while riders remain is
            # deliberate: a late reply still resolves them.
            if pending.waiters == 0 and self._pending.get(path) is pending:
                del self._pending[path]

        if response.get("status") == "error":
            raise Z2MError(str(response.get("error") or f"Zigbee2MQTT refused {path}"))
        data = response.get("data")
        return data if isinstance(data, dict) else {}

    async def async_coordinator_check(self) -> list[dict[str, Any]]:
        """Routers the coordinator has lost track of.

        Z2M answers `{missing_routers: [{ieee_address, friendly_name}]}`; renamed
        here to the ieee/name pair the map's node payload already speaks, so the
        panel has one vocabulary rather than two.
        """
        data = await self.async_request_response(
            "coordinator_check", {}, COORDINATOR_CHECK_TIMEOUT
        )
        return [
            {"ieee": router.get("ieee_address"), "name": router.get("friendly_name")}
            for router in data.get("missing_routers") or []
        ]

    # ----------------------------------------------------------------- extension

    async def async_install_extension(self) -> bool:
        """Put our neighbour-table endpoint into Zigbee2MQTT, once, and leave it.

        Z2M's own bridge/request/networkmap walks every router inside a single
        request and answers once at the end, which is why the map used to sit behind
        a "please wait". Our extension adds a per-device query, so the walk can be
        driven from here and shown as it happens.

        Installed on setup and then LEFT INSTALLED. The integration this replaces
        saved its extension when a panel opened and removed it when the panel
        closed, which re-walked every router each time; persisting it is the fix,
        and it costs one small file in the Z2M config directory.

        `extension/save` writes the file, imports it and starts the instance in
        place -- no Z2M restart, and `restart_required` untouched. So a successful
        save means the endpoint is live, and there is never anything to wait for.
        """
        try:
            async with asyncio.timeout(EXTENSION_WAIT):
                await self._bridge_seen.wait()
        except TimeoutError:
            _LOGGER.info(
                "Zigbee2MQTT has not published bridge/info and %s within %gs, so the"
                " network map will use its own scan rather than a streamed one",
                TOPIC_EXTENSIONS,
                EXTENSION_WAIT,
            )
            self.stream_ready = False
            return False

        advanced = (self.info.get("config") or {}).get("advanced") or {}
        if not advanced.get("enable_external_js"):
            # Deliberately not switched on for the operator: external JS lets
            # anything that can publish to the broker run code inside Zigbee2MQTT,
            # and that is his call to make, not a side effect of installing a panel.
            _LOGGER.info(
                "Zigbee2MQTT has advanced.enable_external_js off, so the network map"
                " cannot be streamed device by device and will use its own scan"
            )
            self.stream_ready = False
            return False

        source, digest = await self.hass.async_add_executor_job(_extension_source)
        if (self._extensions or {}).get(EXTENSION_NAME) == digest:
            _LOGGER.debug("%s is already installed in Zigbee2MQTT", EXTENSION_NAME)
            self.stream_ready = True
            return True

        try:
            await self.async_request_response(
                "extension/save",
                {"name": EXTENSION_NAME, "code": source},
                EXTENSION_SAVE_TIMEOUT,
            )
        except (Z2MError, HomeAssistantError) as err:
            _LOGGER.warning(
                "Zigbee2MQTT would not load %s (%s), so the network map will use its"
                " own scan",
                EXTENSION_NAME,
                err,
            )
            self.stream_ready = False
            return False

        self.stream_ready = True
        _LOGGER.info("Installed %s in Zigbee2MQTT (%s)", EXTENSION_NAME, digest[:12])
        if self.info.get("restart_required"):
            # Something else is waiting on a restart. Ours is not: saving an
            # extension loads it there and then. Said out loud because the panel
            # shows that flag and it would otherwise look like our doing.
            _LOGGER.info(
                "Zigbee2MQTT reports a restart is required for other pending changes;"
                " %s is loaded and listening regardless",
                EXTENSION_NAME,
            )
        return True

    # --------------------------------------------------------------- network map

    async def async_networkmap(self, force: bool = False) -> dict[str, Any]:
        """The normalized topology, from cache unless it is stale or forced.

        A scan asks every router for its neighbour table and takes tens of seconds,
        with some routers never answering at all, so it is emphatically not
        something to run on every page view.
        """
        if not force and self._map_fresh():
            return self._map_result(cached=True)

        scan = self._async_ensure_scan()
        # Shielded so a browser closing mid-scan does not abort the scan for the
        # tabs still watching it.
        await asyncio.shield(scan.task)
        if self._map_error is not None:
            raise Z2MError(self._map_error)
        return self._map_result(cached=False)

    @callback
    def async_scan_attach(
        self, send: Callable[[dict[str, Any]], None]
    ) -> Callable[[], None]:
        """Watch a scan happen, starting one if none is running.

        `start` goes out before this returns, built from the retained device list,
        so every device is on screen before the radio is touched. A caller arriving
        mid-scan is given that same start and then the per-device results already
        collected: replaying them costs nothing and the alternative is a second tab
        showing a map with holes in it until `done` lands.
        """
        scan = self._async_ensure_scan()
        scan.listeners.append(send)
        send(scan.start_event)
        for event in scan.device_events:
            send(event)
        return partial(self._async_scan_detach, scan, send)

    @callback
    def _async_scan_detach(
        self, scan: _Scan, send: Callable[[dict[str, Any]], None]
    ) -> None:
        """Stop feeding one listener. The walk itself runs on.

        Abandoning it because a browser tab closed would throw away radio work
        already paid for, and the result refreshes the cache that makes the next
        page load instant. The task is owned by this object and cancelled on
        unload, so letting it finish leaks nothing.
        """
        if send in scan.listeners:
            scan.listeners.remove(send)

    @callback
    def _async_ensure_scan(self) -> _Scan:
        """The running scan, or a new one. Exactly one at a time, process-wide."""
        scan = self._scan
        if scan is not None and scan.task is not None and not scan.task.done():
            return scan

        coordinator = next(
            (
                ieee
                for device in self.devices
                if device.get("type") == "Coordinator"
                and (ieee := device.get("ieee_address"))
            ),
            None,
        )
        scan = self._scan = _Scan(
            self._nodes_from_devices(),
            self._probe_targets(),
            self._addresses(),
            coordinator,
            # Undecided means setup has not finished its one install attempt yet,
            # which is a second or two after HA starts. Not worth delaying the map
            # for: this scan uses Z2M's own walk and the next one streams.
            self.stream_ready is True,
        )
        # Not eager: the caller attaches its listener the moment this returns, and
        # starting to walk before then would emit into an empty room.
        scan.task = self.hass.async_create_task(
            self._async_run_scan(scan), f"{DOMAIN} network map scan", eager_start=False
        )
        return scan

    @callback
    def _map_fresh(self) -> bool:
        return (
            self.map is not None
            and self.map_generated is not None
            and time.time() - self.map_generated < MAP_TTL
        )

    @callback
    def _map_result(self, *, cached: bool) -> dict[str, Any]:
        topology = self.map or {"coordinator": None, "nodes": [], "links": []}
        return {"generated": self.map_generated, "cached": cached, **topology}

    async def _async_run_scan(self, scan: _Scan) -> None:
        """Run one scan, announcing each phase. Never raises: see _map_error."""
        self.map_scanning = True
        self._map_error = None
        async_dispatcher_send(self.hass, SIGNAL_UPDATE)
        async_dispatcher_send(
            self.hass,
            SIGNAL_MAP,
            {"phase": "scanning", "generated": self.map_generated, "error": None},
        )
        try:
            links = await self._async_walk(scan)
        except (Z2MError, HomeAssistantError) as err:
            # HomeAssistantError covers the broker going away underneath us. That is
            # a scan-level failure, not a per-device one: reporting fifteen dead
            # routers and overwriting the cache with the result would be a lie about
            # the mesh rather than about MQTT.
            self._map_error = str(err)
            _LOGGER.warning("Network map scan failed: %s", err)
            scan.emit({"phase": "error", "error": str(err)})
            self._finish_scan("error")
            return

        self.map = {
            "coordinator": scan.start_event["coordinator"],
            "nodes": scan.result_nodes(self._last_seen),
            "links": links,
        }
        self.map_generated = time.time()
        _LOGGER.info(
            "Network map: %d nodes, %d links, %d of %d devices probed, %d failed (%s)",
            len(self.map["nodes"]),
            len(links),
            scan.probed,
            len(scan.nodes),
            len(scan.failures),
            scan.audit(),
        )
        scan.emit({"phase": "done", "generated": self.map_generated, **self.map})
        self._finish_scan("done")

    @callback
    def _finish_scan(self, phase: str) -> None:
        self.map_scanning = False
        async_dispatcher_send(self.hass, SIGNAL_UPDATE)
        async_dispatcher_send(
            self.hass,
            SIGNAL_MAP,
            {
                "phase": phase,
                "generated": self.map_generated,
                "error": self._map_error,
            },
        )

    async def _async_walk(self, scan: _Scan) -> list[dict[str, Any]]:
        """One pass over the mesh, streamed if our extension is answering."""
        if scan.streaming:
            links = await self._async_walk_streaming(scan)
            if links is not None:
                return links
            # Nothing answered the first request, so the endpoint is not live
            # whatever bridge/extensions claims. Nothing has been emitted yet, so
            # Z2M's own scan can still produce this map.
            _LOGGER.warning(
                "%s is installed but did not answer, so this scan and the ones after"
                " it use Zigbee2MQTT's own network scan. Reload the Zigbee entry to"
                " try the streamed walk again",
                EXTENSION_NAME,
            )
            self.stream_ready = False
            scan.streaming = False
            scan.start_event["streaming"] = False
        return await self._async_walk_first_party(scan)

    async def _async_walk_streaming(self, scan: _Scan) -> list[dict[str, Any]] | None:
        """Ask each router for its neighbour table, breadth first, one at a time.

        Order is the coordinator, then outward: every reply feeds the frontier, so a
        device's parent is normally on the map before the device itself is, which is
        what makes the drawing legible rather than a scatter. A router the tree never
        reaches is probed once the frontier runs dry, so nothing is silently skipped.

        Returns None, having emitted nothing, if the very first request goes
        unanswered -- see _async_walk.
        """
        targets = scan.targets
        if not targets:
            raise Z2MError("Zigbee2MQTT reports no devices with a neighbour table")

        remaining = set(targets)
        frontier: deque[str] = deque()
        coordinator = scan.start_event["coordinator"]
        if coordinator in remaining:
            frontier.append(coordinator)
            remaining.discard(coordinator)
        # Whatever the tree does not reach, in coordinator-then-routers order.
        # `remaining` is the one record of what has not been dispatched yet, and
        # every device leaves it and `waiting` together.
        waiting = deque(ieee for ieee in targets if ieee in remaining)
        inflight: dict[asyncio.Task[list[dict[str, Any]]], str] = {}
        links: list[dict[str, Any]] = []

        try:
            while frontier or waiting or inflight:
                while len(inflight) < SCAN_CONCURRENCY and (
                    frontier or (waiting and not inflight)
                ):
                    if not frontier:
                        # The tree has stalled. Pick up a leftover rather than idle,
                        # but only with nothing in flight, so a reply that is about
                        # to extend the frontier still gets its turn first.
                        leftover = waiting.popleft()
                        remaining.discard(leftover)
                        frontier.append(leftover)
                    ieee = frontier.popleft()
                    inflight[
                        self.hass.async_create_task(
                            self._async_probe(ieee),
                            f"{DOMAIN} neighbour table {ieee}",
                            eager_start=False,
                        )
                    ] = ieee

                done, _ = await asyncio.wait(
                    inflight, return_when=asyncio.FIRST_COMPLETED
                )
                for task in done:
                    ieee = inflight.pop(task)
                    name = self._name_of(ieee)
                    try:
                        rows = task.result()
                    except _NoAnswer as err:
                        if not scan.probed:
                            # The first request of the walk went unanswered, so this
                            # is not a slow device, it is an endpoint that is not
                            # there. Nothing emitted yet, so the caller can still
                            # fall back to Z2M's own scan.
                            return None
                        scan.probed += 1
                        scan.fail(ieee, str(err), name)
                        continue
                    except Z2MError as err:
                        # An error reply is a real answer: the device is disabled, or
                        # its table would not come off the air. Either way the walk
                        # carries on -- some routers here never answer.
                        scan.probed += 1
                        scan.fail(ieee, str(err), name)
                        continue
                    scan.probed += 1
                    found = self._links_from_rows(scan, ieee, rows)
                    links.extend(found)
                    scan.emit(
                        {
                            "phase": "device",
                            "ieee": ieee,
                            "name": name,
                            "ok": True,
                            "links": found,
                        }
                    )
                    for link in found:
                        neighbour = link["source"]
                        if neighbour in remaining:
                            remaining.discard(neighbour)
                            frontier.append(neighbour)
                            waiting.remove(neighbour)
        finally:
            # Unload cancels the scan; the probes it was waiting on go with it.
            for task in inflight:
                task.cancel()
        return links

    async def _async_walk_first_party(self, scan: _Scan) -> list[dict[str, Any]]:
        """Z2M's own scan, cut into the same event sequence.

        Without the extension there is nothing to stream: Z2M answers once, at the
        end. The fleet is already on screen from `start`, so what is left is to turn
        that single payload into the same per-device events, which keeps the panel to
        one code path and makes the difference between the two modes exactly what
        `start.streaming` says it is -- when the links arrive, not what they mean.

        `routes` is deliberately not asked for. It doubles the walk -- 72 s against
        this mesh with it, ~40 s without -- for a routing table nothing renders: the
        map states outright that a router picks its route dynamically, so a snapshot
        of one promises nothing. And it is not obtainable device by device, so
        asking here would make the cached map depend on which walk filled it.
        """
        raw = await self.async_request_response(
            "networkmap", {"type": "raw"}, MAP_TIMEOUT
        )
        value = raw.get("value") or {}
        nodes = value.get("nodes") or []
        probed = [
            node
            for node in nodes
            if node.get("ieeeAddr") and node.get("type") in PROBED_TYPES
        ]
        # Z2M's own nodes, which carry the last-seen and the failures its walk
        # found. Same keys as the ones `start` was built from, better informed.
        scan.nodes = self._nodes_from_raw(nodes)
        scan.known = {node["ieee"] for node in scan.nodes}

        links = self._links_from_raw(scan, value.get("links") or [])
        by_source_table: dict[str, list[dict[str, Any]]] = {}
        for link in links:
            by_source_table.setdefault(link["target"], []).append(link)

        for node in probed:
            ieee = node["ieeeAddr"]
            scan.probed += 1
            if "lqi" in (node.get("failed") or []):
                scan.fail(
                    ieee,
                    "Zigbee2MQTT could not read the neighbour table",
                    node.get("friendlyName"),
                )
                continue
            scan.emit(
                {
                    "phase": "device",
                    "ieee": ieee,
                    "name": node.get("friendlyName"),
                    "ok": True,
                    "links": by_source_table.get(ieee) or [],
                }
            )
        return links

    async def _async_probe(self, ieee: str) -> list[dict[str, Any]]:
        """One paced neighbour-table request, and the rows it answers with."""
        self._transaction += 1
        transaction = f"{DOMAIN}-lqi-{self._transaction}"
        future: asyncio.Future[dict[str, Any]] = self.hass.loop.create_future()
        self._lqi_waiters[transaction] = future
        try:
            await self._async_pace()
            body: dict[str, Any] = {"ieeeAddr": ieee, "transaction": transaction}
            if not self._last_seen:
                # Free -- read out of Z2M's own state, no radio traffic -- and the
                # one node field bridge/devices does not carry. Asked for until it
                # arrives, then not again.
                body["nodes"] = True
            await mqtt.async_publish(
                self.hass,
                f"{self.base_topic}/{REQ}/{TOPIC_LQI}",
                json.dumps(body),
                qos=0,
                retain=False,
            )
            async with asyncio.timeout(SCAN_DEVICE_TIMEOUT):
                reply = await future
        except TimeoutError:
            raise _NoAnswer(f"no neighbour table within {SCAN_DEVICE_TIMEOUT:g}s") from None
        finally:
            self._lqi_waiters.pop(transaction, None)

        fleet = reply.get("fleetLastSeen")
        if isinstance(fleet, dict):
            self._last_seen = {
                key: value for key, value in fleet.items() if isinstance(value, int)
            }
        if isinstance(last_seen := reply.get("lastSeen"), int):
            self._last_seen[ieee] = last_seen

        if error := reply.get("error"):
            raise Z2MError(str(error))
        rows = reply.get("neighbors")
        if not isinstance(rows, list):
            raise Z2MError("neighbour table missing from the reply")
        return rows

    async def _async_pace(self) -> None:
        """Hold this dispatch at least SCAN_MIN_INTERVAL after the one before it.

        Z2M serialises radio work per device, so what hurts is not one request but a
        burst of them: see the constants for the measurement that decided these.
        """
        async with self._dispatch_lock:
            slot = max(self.hass.loop.time(), self._next_dispatch)
            self._next_dispatch = slot + SCAN_MIN_INTERVAL
        # Slept outside the lock, so two probes wait out their own slots side by
        # side instead of collapsing the walk to one request at a time.
        delay = slot - self.hass.loop.time()
        if delay > 0:
            await asyncio.sleep(delay)

    @callback
    def _probe_targets(self) -> list[str]:
        """Devices worth a request, coordinator first, then the routers.

        Only these hold a neighbour table: 15 of this network's 45 devices. The
        other 30 are end devices, which keep none and would cost a round trip to
        learn nothing from; they reach the map through their parent's table.
        """
        coordinator: list[str] = []
        routers: list[str] = []
        for device in self.devices:
            ieee = device.get("ieee_address")
            if (
                not ieee
                or device.get("disabled")
                or not device.get("interview_completed")
            ):
                continue
            if device.get("type") == "Coordinator":
                coordinator.append(ieee)
            elif device.get("type") == "Router":
                routers.append(ieee)
        return coordinator + routers

    @callback
    def _name_of(self, ieee: str) -> str | None:
        return next(
            (
                device.get("friendly_name")
                for device in self.devices
                if device.get("ieee_address") == ieee
            ),
            None,
        )

    @callback
    def _addresses(self) -> dict[int, str]:
        """Network address -> ieee, for the neighbours that report their own wrong."""
        return {
            addr: ieee
            for device in self.devices
            if (ieee := device.get("ieee_address")) is not None
            and (addr := device.get("network_address")) is not None
        }

    @callback
    def _nodes_from_devices(self) -> list[dict[str, Any]]:
        """Node objects for the whole fleet, out of the retained device list.

        This is what puts the map on screen at once: bridge/devices is retained, so
        it is already in hand when the panel asks for a scan and no radio traffic is
        needed to draw every device. Same keys as the nodes Z2M's own map produces,
        because the two are used interchangeably.

        Disabled devices are left out, as Z2M leaves them out of its own map.
        """
        dev_reg = dr.async_get(self.hass)
        nodes: list[dict[str, Any]] = []
        for device in self.devices:
            ieee = device.get("ieee_address")
            if not ieee or device.get("disabled") or device.get("type") == "GreenPower":
                continue
            name = device.get("friendly_name")
            defn = device.get("definition") or {}
            nodes.append(
                {
                    "ieee": ieee,
                    "name": name,
                    "type": device.get("type"),
                    # Mains vs battery is the map's only honest way to tell a
                    # powered device from a sleeping one. Z2M reports it per device
                    # and the renderer must not infer it from node type.
                    "power_source": device.get("power_source"),
                    "addr": device.get("network_address"),
                    "vendor": defn.get("vendor") or device.get("manufacturer"),
                    "model": defn.get("model") or device.get("model_id"),
                    "description": defn.get("description"),
                    "lastSeen": self._last_seen.get(ieee),
                    "failed": [],
                    "availability": self.availability.get(name) if name else None,
                    "device_id": self.device_id(dev_reg, ieee),
                }
            )
        return nodes

    @callback
    def _nodes_from_raw(self, raw_nodes: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """The same node objects, out of Z2M's own map payload.

        Field notes, read out of Z2M 2.13.0-1's api.d.ts and networkMap.js rather
        than guessed: `lastSeen` is Z2M's field, left in epoch MILLISECONDS.
        Everything else we emit -- `generated`, log `time` -- is epoch seconds. The
        split is deliberate: converting would silently change the meaning of a field
        the renderer already divides, which is a 1000x bug waiting to happen.

        `failed` is narrowed to the one query the map is built on. Z2M also reports
        "routingTable" there -- 5 of the 14 routers here, on a walk whose neighbour
        tables all came back clean -- and passing that through would put a warning
        on devices with nothing wrong with them as far as this map is concerned, and
        only in the mode that asks for routing tables at all.
        """
        dev_reg = dr.async_get(self.hass)
        nodes: list[dict[str, Any]] = []
        power_sources = {
            ieee: device.get("power_source")
            for device in self.devices
            if (ieee := device.get("ieee_address"))
        }
        for raw in raw_nodes:
            ieee = raw.get("ieeeAddr")
            if not ieee:
                continue
            name = raw.get("friendlyName")
            defn = raw.get("definition") or {}
            if isinstance(last_seen := raw.get("lastSeen"), int):
                self._last_seen[ieee] = last_seen
            nodes.append(
                {
                    "ieee": ieee,
                    "name": name,
                    "type": raw.get("type"),
                    # Z2M's own map payload does not carry the power source, so it
                    # comes from the retained inventory rather than being inferred:
                    # the streamed and cached maps have to describe the same fleet.
                    "power_source": power_sources.get(ieee),
                    "addr": raw.get("networkAddress"),
                    "vendor": defn.get("vendor") or raw.get("manufacturerName"),
                    "model": defn.get("model") or raw.get("modelID"),
                    "description": defn.get("description"),
                    "lastSeen": raw.get("lastSeen"),
                    "failed": ["lqi"] if "lqi" in (raw.get("failed") or ()) else [],
                    "availability": self.availability.get(name) if name else None,
                    "device_id": self.device_id(dev_reg, ieee),
                }
            )
        return nodes

    @callback
    def _links_from_rows(
        self, scan: _Scan, ieee: str, rows: list[Any]
    ) -> list[dict[str, Any]]:
        """One device's neighbour table, as links.

        Direction follows Z2M's own map exactly: `source` is the NEIGHBOUR and
        `target` is the device whose table the row came from, and `relationship`
        describes the neighbour -- 0 it is this device's parent, 1 its child, 2 a
        sibling, 3 none. Inverting that would invert every parent chain the panel
        draws, and the streamed and cached maps have to be the same map.
        """
        out: list[dict[str, Any]] = []
        for row in rows:
            if not isinstance(row, dict):
                continue
            relationship = row.get("relationship")
            if isinstance(relationship, int) and relationship > 3:
                # "Relationship is not active, skip it", in Z2M's own words: 4 is a
                # previous child, and drawing it would show a link that has gone.
                scan.counts["inactive"] += 1
                continue
            link = self._link(
                scan,
                self._neighbour_ieee(scan, row),
                ieee,
                row.get("lqi"),
                relationship,
                row.get("depth"),
                row.get("rxOnWhenIdle"),
                (),
            )
            if link is not None:
                out.append(link)
        return out

    @callback
    def _links_from_raw(
        self, scan: _Scan, raw_links: list[dict[str, Any]]
    ) -> list[dict[str, Any]]:
        """The same links, out of Z2M's own map payload.

        Links carry both `lqi` and `linkquality` with identical values, and
        `linkquality` is marked "@deprecated 3.0", so `lqi` is read first. `routes`
        becomes the destination network addresses carried over the link: Z2M
        supplies RoutingTableEntry objects it only attaches when `nextHopAddress` is
        this link's neighbour, so `destinationAddress` is the one part not already on
        the link itself.
        """
        out: list[dict[str, Any]] = []
        for raw in raw_links:
            lqi = raw.get("lqi")
            if lqi is None:
                lqi = raw.get("linkquality")
            link = self._link(
                scan,
                (raw.get("source") or {}).get("ieeeAddr"),
                (raw.get("target") or {}).get("ieeeAddr"),
                lqi,
                raw.get("relationship"),
                raw.get("depth"),
                raw.get("rxOnWhenIdle"),
                tuple(
                    entry["destinationAddress"]
                    for entry in raw.get("routes") or []
                    if isinstance(entry, dict) and "destinationAddress" in entry
                ),
            )
            if link is not None:
                out.append(link)
        return out

    @callback
    def _neighbour_ieee(self, scan: _Scan, row: dict[str, Any]) -> str | None:
        """The neighbour's address, patched the one way Z2M patches it.

        Some Xiaomi devices report 0x0000000000000000 as their own address in a
        neighbour table; Z2M recovers it from the network address and so do we,
        because dropping the row would silently delete a real link. Only that case:
        resolving any unknown address by network address would happily attach a link
        to whichever device inherited a departed one's short address.
        """
        eui64 = row.get("eui64")
        if eui64 == ZERO_IEEE:
            patched = scan.by_addr.get(row.get("nwkAddress"))
            if patched is not None:
                scan.counts["patched"] += 1
                return patched
        return eui64 if isinstance(eui64, str) else None

    @callback
    def _link(
        self,
        scan: _Scan,
        source: str | None,
        target: str | None,
        lqi: int | None,
        relationship: int | None,
        depth: int | None,
        rx_on_when_idle: Any,
        routes: tuple[Any, ...],
    ) -> dict[str, Any] | None:
        """One normalized link, or None for a row that cannot be believed.

        Every judgement about the data is made here, once, for both walks, and every
        rejection is counted -- the operator makes hardware decisions off this map,
        so a row we quietly dropped has to be a row we can also account for.
        """
        if source is None or target is None or source not in scan.known or target not in scan.known:
            # A neighbour row for a device bridge/devices does not list: it has left
            # the network but is still sitting in somebody's table. An edge to a node
            # that is not on the map is worse than no edge.
            scan.counts["unknown"] += 1
            return None
        if source == target:
            # A device listing itself. Real hardware does this; it is not a link.
            scan.counts["self"] += 1
            return None
        if (source, target) in scan.pairs:
            # The same neighbour twice in one table. One edge, once.
            scan.counts["duplicate"] += 1
            return None
        if (target, source, lqi, relationship, depth) in scan.seen:
            # A reciprocal pair collapses only when it agrees completely. Equal lqi
            # alone is not enough: a parent/child pair reports the SAME lqi from both
            # ends with different `relationship` -- D says "N is my parent" while N
            # says "D is my child" -- and dropping either half destroys the parent
            # chain the renderer traces routes along. Genuine lqi asymmetry, which is
            # the diagnostically interesting case, always survives.
            scan.counts["mirror"] += 1
            return None
        if lqi is None:
            # NOT coerced to 0. A link the radio never rated, drawn as 0, reads as a
            # dead link, and the operator would go hunting for a fault that is really
            # a gap in the data. Left null so the map can say "unknown" instead.
            scan.counts["unknown_lqi"] += 1
        scan.pairs.add((source, target))
        scan.seen.add((source, target, lqi, relationship, depth))
        return {
            "source": source,
            "target": target,
            "lqi": lqi,
            "relationship": relationship,
            "depth": depth,
            "rxOnWhenIdle": rx_on_when_idle,
            "routes": list(routes),
        }

    # -------------------------------------------------------------------- views

    @callback
    def device_id(self, dev_reg: dr.DeviceRegistry, ieee: str) -> str | None:
        """The HA device for a Z2M ieee address, or None if discovery has not run.

        Both identifier shapes Z2M uses are tried, so the coordinator's own
        "Zigbee2MQTT Bridge" device resolves alongside the ordinary devices.
        """
        for ident in (
            f"{MQTT_IDENT_PREFIX}_{ieee}",
            f"{MQTT_IDENT_PREFIX}_bridge_{ieee}",
        ):
            device = dev_reg.async_get_device(identifiers={(MQTT_IDENT_DOMAIN, ident)})
            if device is not None:
                return device.id
        return None

    @callback
    def ieee_addresses(self) -> set[str]:
        """Every ieee address Z2M currently reports, coordinator included."""
        return {
            ieee for device in self.devices if (ieee := device.get("ieee_address"))
        }

    @callback
    def summary(self) -> dict[str, Any]:
        """The header card: online state and device counts."""
        real = [d for d in self.devices if d.get("type") != "Coordinator"]
        offline = sum(
            1 for d in real
            if self.availability.get(d.get("friendly_name", "")) == "offline"
        )
        coord = next(
            (d for d in self.devices if d.get("type") == "Coordinator"), {}
        )
        cfg = self.info.get("config", {}) or {}
        return {
            "state": self.bridge_state,
            "permit_join": self.info.get("permit_join"),
            # Z2M publishes `permit_join_end` (epoch ms), not a countdown.
            "permit_join_end": self.info.get("permit_join_end"),
            "version": self.info.get("version"),
            "coordinator": self.info.get("coordinator", {}),
            "network": self.info.get("network", {}),
            "log_level": self.info.get("log_level"),
            "restart_required": self.info.get("restart_required"),
            "device_count": len(real),
            "offline_count": offline,
            "group_count": len(self.groups),
            "coordinator_name": coord.get("friendly_name"),
            "base_topic": self.base_topic,
            "serial": (cfg.get("serial") or {}).get("port"),
            # For ?label= deep links into HA's own device and entity tables.
            "label_id": self.label_id,
            "map_generated": self.map_generated,
            "map_scanning": self.map_scanning,
        }

    @callback
    def device_list(self) -> list[dict[str, Any]]:
        """Flatten what the panel needs, so the frontend does no digging."""
        out = []
        for d in self.devices:
            if d.get("type") == "Coordinator":
                continue
            defn = d.get("definition") or {}
            out.append(
                {
                    "ieee_address": d.get("ieee_address"),
                    "friendly_name": d.get("friendly_name"),
                    "type": d.get("type"),
                    "power_source": d.get("power_source"),
                    "vendor": defn.get("vendor"),
                    "model": defn.get("model"),
                    "description": defn.get("description"),
                    "supported": d.get("supported"),
                    "disabled": d.get("disabled"),
                    "interviewing": d.get("interviewing"),
                    "interview_completed": d.get("interview_completed"),
                    "interview_state": d.get("interview_state"),
                    # Group membership is per ENDPOINT, not per device, so the
                    # member picker cannot work without these. Z2M keys them by
                    # endpoint id; "default" resolves to the first endpoint, which
                    # is not the same thing on a multi-endpoint device.
                    "endpoints": _endpoint_ids(d.get("endpoints")),
                    "availability": self.availability.get(d.get("friendly_name", "")),
                    "network_address": d.get("network_address"),
                    "date_code": d.get("date_code"),
                    "software_build_id": d.get("software_build_id"),
                    # `exposes` is the schema Z2M itself uses to render controls,
                    # so the panel can generate a settings form instead of
                    # hard-coding one per device model.
                    "exposes": defn.get("exposes") or [],
                    "options": defn.get("options") or [],
                    "scenes": d.get("scenes") or [],
                }
            )
        out.sort(key=lambda x: (x.get("friendly_name") or "").lower())
        return out


@callback
def _label_relevant(
    event_data: dr.EventDeviceRegistryUpdatedData | er.EventEntityRegistryUpdatedData,
) -> bool:
    """Filter registry events down to the ones that can change what we label.

    Removals are ignored: a registry entry that is gone carries no label to fix,
    and departures are Z2M's story to tell via bridge/devices.

    The `changes`-only-`labels` test is the loop guard. Every label we apply fires
    an update event straight back at us, and while the diff below makes a second
    pass a no-op, a burst of writes would still each schedule another pass. Dropping
    the event whose sole change IS the label field cuts the feedback edge at the
    source, so a reconciliation settles after exactly one pass.
    """
    action = event_data["action"]
    if action == "create":
        return True
    if action != "update":
        return False
    return set(event_data["changes"]) != {"labels"}


class Z2MLabels:
    """Keeps a `Zigbee` label on exactly the devices Z2M reports, and their entities.

    Why a label at all: the panel deep-links into Home Assistant's own device and
    entity tables, and those accept `?label=<label_id>`. Filtering by config_entry
    is not an option -- Z2M's devices belong to the MQTT config entry, which on this
    install also carries govee2mqtt and rtlamr2mqtt devices, so that filter would
    show a table full of things that are not Zigbee.

    Why the entities too, and not just the devices: HA's entities table filters on
    each entity's OWN labels. It does not inherit them from the device -- verified in
    the shipped 2026.8 bundle, where the entities table does
    `filter(e => e.labels.some(...))` and never reads a device's labels for an entity
    row. Labelling devices alone would leave the panel's entity deep link pointing
    at an empty table. One label covers both, and the entities being labelled makes
    them addressable as an automation target too, which is useful well beyond this
    panel.

    Identity is the stored label_id, never the name, so renaming the label in Home
    Assistant breaks nothing and a second `Zigbee` label is never created.
    """

    def __init__(
        self, hass: HomeAssistant, entry: ConfigEntry, data: Z2MData
    ) -> None:
        self.hass = hass
        self.entry = entry
        self.data = data
        self._debouncer = Debouncer(
            hass,
            _LOGGER,
            cooldown=LABEL_DEBOUNCE,
            immediate=False,
            function=self._async_reconcile,
        )

    async def async_start(self) -> None:
        """Resolve the label, wire all three triggers, and do a first pass."""
        self.data.label_id = self._resolve_label()
        self.entry.async_on_unload(self._debouncer.async_shutdown)

        # Trigger one: Z2M republishes the retained bridge/devices topic whenever a
        # device joins, leaves or is renamed. This is the trigger that notices
        # removals, since a departed device produces no registry event of its own.
        self.entry.async_on_unload(
            async_dispatcher_connect(
                self.hass, SIGNAL_DEVICES, self._debouncer.async_schedule_call
            )
        )

        # Trigger two, and it is required rather than defensive. When a brand-new
        # device joins, Z2M publishes bridge/devices IMMEDIATELY -- before HA's MQTT
        # discovery has created the device registry entry. The reconciliation that
        # trigger one schedules therefore looks the device up and gets None, and
        # bridge/devices will never change again, so nothing would ever retry and the
        # label would silently never land. This listener is the other half of that
        # handshake: the registry entry appearing is itself the retry.
        self.entry.async_on_unload(
            self.hass.bus.async_listen(
                dr.EVENT_DEVICE_REGISTRY_UPDATED,
                self._on_registry_updated,
                event_filter=_label_relevant,
            )
        )

        # Trigger three, for the same reason one step further down: a device's
        # entities are discovered after the device itself, and keep arriving as Z2M
        # publishes each discovery topic. Without this, the entities of a newly
        # joined device would be labelled only whenever something else happened to
        # trigger a pass.
        self.entry.async_on_unload(
            self.hass.bus.async_listen(
                er.EVENT_ENTITY_REGISTRY_UPDATED,
                self._on_registry_updated,
                event_filter=_label_relevant,
            )
        )

        await self._async_reconcile()

    @callback
    def _resolve_label(self) -> str:
        """The label id to use, creating the label only when there is none."""
        reg = lr.async_get(self.hass)
        stored = self.entry.data.get(CONF_LABEL_ID)
        if stored and reg.async_get_label(stored) is not None:
            return stored

        # Adopt an existing `Zigbee` label rather than making a second one. This is
        # the path taken when the entry predates the stored id, or when the operator
        # created the label themselves.
        label = reg.async_get_label_by_name(LABEL_NAME) or reg.async_create(
            LABEL_NAME,
            icon=LABEL_ICON,
            color=LABEL_COLOR,
            description=LABEL_DESCRIPTION,
        )
        # Called before __init__ registers the reload-on-change update listener, so
        # this does not bounce the entry it is running inside.
        self.hass.config_entries.async_update_entry(
            self.entry, data={**self.entry.data, CONF_LABEL_ID: label.label_id}
        )
        _LOGGER.debug("Using Zigbee label %s", label.label_id)
        return label.label_id

    @callback
    def _on_registry_updated(self, event: Event[Any]) -> None:
        """Schedule a pass when a registry entry that should be ours turns up.

        Serves both registries: device events carry `device_id`, entity events carry
        `entity_id` and the device_id of their owner, and either way what we need to
        know is whether the entry belongs to a device Z2M reports.
        """
        label_id = self.data.label_id
        if label_id is None:
            return
        device_id = event.data.get("device_id")
        if device_id is None:
            # An entity event: resolve the owning device off the registry entry.
            entity = er.async_get(self.hass).async_get(event.data["entity_id"])
            if entity is None or entity.device_id is None:
                return
            device_id = entity.device_id
        device = dr.async_get(self.hass).async_get(device_id)
        if device is None:
            return
        ieee = ieee_from_identifiers(device.identifiers)
        if ieee is None or ieee not in self.data.ieee_addresses():
            return
        self._debouncer.async_schedule_call()

    async def _async_reconcile(self) -> None:
        """Make the label's membership match what Z2M reports, and touch nothing else.

        Labels the operator applied by hand are preserved: only our own id is ever
        added to or removed from a set. The diff is checked before every write, so
        the steady state performs no registry writes at all, and the work is bounded
        by what Z2M reports plus what already carries the label -- never by the size
        of either registry, which on this install is some 1500 entities.
        """
        label_id = self.data.label_id
        if label_id is None:
            return
        dev_reg = dr.async_get(self.hass)
        ent_reg = er.async_get(self.hass)

        wanted_devices = {
            device_id
            for ieee in self.data.ieee_addresses()
            if (device_id := self.data.device_id(dev_reg, ieee)) is not None
        }
        # Disabled entities are included on purpose: the operator has pruned a great
        # many entities on this install and still wants them findable in a filtered
        # table.
        wanted_entities = {
            entity.entity_id
            for device_id in wanted_devices
            for entity in er.async_entries_for_device(
                ent_reg, device_id, include_disabled_entities=True
            )
        }

        added = removed = 0
        for device in dr.async_entries_for_label(dev_reg, label_id):
            if device.id not in wanted_devices:
                dev_reg.async_update_device(
                    device.id, labels=device.labels - {label_id}
                )
                removed += 1
        for device_id in wanted_devices:
            device = dev_reg.async_get(device_id)
            if device is not None and label_id not in device.labels:
                dev_reg.async_update_device(
                    device_id, labels=device.labels | {label_id}
                )
                added += 1

        for entity in er.async_entries_for_label(ent_reg, label_id):
            if entity.entity_id not in wanted_entities:
                ent_reg.async_update_entity(
                    entity.entity_id, labels=entity.labels - {label_id}
                )
                removed += 1
        for entity_id in wanted_entities:
            entity = ent_reg.async_get(entity_id)
            if entity is not None and label_id not in entity.labels:
                ent_reg.async_update_entity(
                    entity_id, labels=entity.labels | {label_id}
                )
                added += 1

        if added or removed:
            _LOGGER.debug(
                "Zigbee label %s: %s registry entr(ies) added, %s removed "
                "(%s device(s), %s entit(ies) in scope)",
                label_id,
                added,
                removed,
                len(wanted_devices),
                len(wanted_entities),
            )
