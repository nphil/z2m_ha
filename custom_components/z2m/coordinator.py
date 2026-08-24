"""Mirrors Zigbee2MQTT's retained bridge topics into local state.

Z2M publishes bridge/info, bridge/devices, bridge/groups, bridge/state and
bridge/health as RETAINED topics, so a fresh subscription is immediately given the
current picture with no polling and no request/response round trip. This class holds
that picture and fires a dispatcher signal whenever any of it changes, which is what
lets the panel be push-driven.
"""

from __future__ import annotations

import json
import logging
from typing import Any

from homeassistant.components import mqtt
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.dispatcher import async_dispatcher_send

from .const import (
    BRIDGE_TOPICS,
    REQ,
    SIGNAL_UPDATE,
    TOPIC_DEVICES,
    TOPIC_GROUPS,
    TOPIC_HEALTH,
    TOPIC_INFO,
    TOPIC_STATE,
)

_LOGGER = logging.getLogger(__package__)


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
        self._unsubs: list[Any] = []

    # ---------------------------------------------------------------- subscribe

    async def async_start(self) -> None:
        """Subscribe to the bridge topics and per-device availability."""
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
        _LOGGER.debug("Subscribed to %s bridge topics", self.base_topic)

    @callback
    def async_stop(self) -> None:
        for unsub in self._unsubs:
            unsub()
        self._unsubs.clear()

    # ----------------------------------------------------------------- handlers

    @callback
    def _on_bridge(self, msg: mqtt.ReceiveMessage) -> None:
        suffix = msg.topic[len(self.base_topic) + 1 :]
        try:
            payload = json.loads(msg.payload) if msg.payload else None
        except ValueError:
            # bridge/state was a bare string in older Z2M; tolerate both.
            payload = msg.payload

        if suffix == TOPIC_INFO and isinstance(payload, dict):
            self.info = payload
        elif suffix == TOPIC_DEVICES and isinstance(payload, list):
            self.devices = payload
        elif suffix == TOPIC_GROUPS and isinstance(payload, list):
            self.groups = payload
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

    @callback
    def _on_availability(self, msg: mqtt.ReceiveMessage) -> None:
        # <base>/<friendly name>/availability -- the name may itself contain slashes.
        name = msg.topic[len(self.base_topic) + 1 : -len("/availability")]
        try:
            payload = json.loads(msg.payload)
            state = payload.get("state") if isinstance(payload, dict) else str(payload)
        except ValueError:
            state = msg.payload
        if state:
            self.availability[name] = state
            async_dispatcher_send(self.hass, SIGNAL_UPDATE)

    # ------------------------------------------------------------------ publish

    async def async_request(self, path: str, payload: Any) -> None:
        """Publish to bridge/request/<path>."""
        topic = f"{self.base_topic}/{REQ}/{path}"
        body = payload if isinstance(payload, str) else json.dumps(payload)
        await mqtt.async_publish(self.hass, topic, body, qos=0, retain=False)
        _LOGGER.debug("Published %s -> %s", topic, body)

    # -------------------------------------------------------------------- views

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
