"""Constants for the Zigbee (Zigbee2MQTT) panel integration."""

DOMAIN = "z2m"

CONF_BASE_TOPIC = "base_topic"
DEFAULT_BASE_TOPIC = "zigbee2mqtt"

# The `Zigbee` label's id, persisted in the config entry. Identity is this id and
# never the name, so the operator can rename the label in Home Assistant without
# breaking the panel's deep links, and we never create a second `Zigbee` label.
CONF_LABEL_ID = "label_id"

# Panel. It carries a sidebar entry AND the integration's Configure button; those
# are independent fields on the same panel record. The frontend renders a sidebar
# item only when the title is truthy, so omitting sidebar_title is what hides one.
PANEL_URL_PATH = "z2m"
WEBCOMPONENT = "z2m-panel"
PANEL_JS = "z2m-panel.js"
# Registered as an extra frontend module as well as being served under the panel's
# static path, so `type: custom:z2m-map-card` works on any dashboard without the
# operator adding a Lovelace resource by hand.
CARD_JS = "z2m-map.js"
SIDEBAR_TITLE = "Zigbee"
SIDEBAR_ICON = "mdi:zigbee"  # the icon HA itself uses for Zigbee, e.g. in smlight

# Sidebar shortcut to Home Assistant's OWN Z-Wave page. zwave_js registers no panel
# -- /config/zwave_js/dashboard is an internal route of the single `config` panel --
# so the only way to put it in the sidebar is a panel record whose url_path is that
# whole path. See _register_zwave_shortcut for why that is safe.
ZWAVE_DOMAIN = "zwave_js"
ZWAVE_PANEL_URL_PATH = "config/zwave_js/dashboard"
ZWAVE_SIDEBAR_TITLE = "Z-Wave"
ZWAVE_SIDEBAR_ICON = "mdi:z-wave"

# Signals fired on the HA dispatcher.
SIGNAL_UPDATE = f"{DOMAIN}_update"  # any mirrored bridge state changed
# bridge/devices inventory changes only; label reconciliation listens to this.
SIGNAL_DEVICES = f"{DOMAIN}_devices"
# The panel projections have narrower signals so availability does not reconcile labels.
SIGNAL_DEVICE_LIST = f"{DOMAIN}_device_list"
SIGNAL_GROUPS = f"{DOMAIN}_groups"
SIGNAL_PAIRING = f"{DOMAIN}_pairing"  # one normalized snapshot/event envelope
SIGNAL_LOG = f"{DOMAIN}_log"  # one new bridge/logging line, passed as the arg
SIGNAL_MAP = f"{DOMAIN}_map"  # network map scan phase, passed as the arg
# Retained bridge topics we mirror into local state. Each is JSON except `state`,
# which Z2M publishes as {"state": "online"|"offline"}.
TOPIC_INFO = "bridge/info"
TOPIC_DEVICES = "bridge/devices"
TOPIC_GROUPS = "bridge/groups"
TOPIC_STATE = "bridge/state"
TOPIC_HEALTH = "bridge/health"

BRIDGE_TOPICS = (TOPIC_INFO, TOPIC_DEVICES, TOPIC_GROUPS, TOPIC_STATE, TOPIC_HEALTH)

# Not retained and very high volume -- at log_level info this install emits a line
# for every MQTT publish -- so it gets its own handler and its own signal rather
# than joining BRIDGE_TOPICS and re-rendering the panel per line.
TOPIC_LOGGING = "bridge/logging"
# Join/interview lifecycle events. Unlike BRIDGE_TOPICS this is not retained.
TOPIC_EVENT = "bridge/event"
LOG_BUFFER = 300

# Z2M answers every bridge/request/<x> on bridge/response/<x> with
# {status: "ok"|"error", data: {...}, error?}, echoing back any `transaction`
# string the request carried.
REQ = "bridge/request"
RESP = "bridge/response"

# Network map. A full scan asks every router for its neighbour table; measured at
# ~40 s on this 45-device mesh with a few routers never answering, so the result is
# cached and only re-scanned when stale or explicitly forced.
MAP_TTL = 600
MAP_TIMEOUT = 180

# Our own Zigbee2MQTT extension, which adds a PER-DEVICE neighbour-table endpoint.
# Z2M's first-party bridge/request/networkmap walks every router inside one request
# and answers once at the end, so it cannot be streamed; this is what lets the map
# fill in device by device. Installed over bridge/request/extension/save on setup
# and then LEFT INSTALLED -- the integration this replaces saved and removed its
# extension on every panel open, which re-walked the whole mesh each time.
#
# `extension/save` writes the file, imports it and starts the instance in place: no
# Z2M restart, and `restart_required` is not touched. Verified live against 2.13.0-1
# (the save was answered in 50 ms and the extension logged itself listening in the
# same 10 ms window) and in Z2M's own externalJS.js, whose save() returns an error
# response when the import or the load fails. So a successful save means live.
# One name for both sides on purpose: the file shipped beside this module, and the
# name Zigbee2MQTT stores it under. Z2M requires a .js, .cjs or .mjs suffix, and the
# name is distinct enough that it cannot collide with another integration's.
EXTENSION_NAME = "z2m_ha_lqi.js"
TOPIC_LQI = "z2m_lqi"
TOPIC_EXTENSIONS = "bridge/extensions"
EXTENSION_SAVE_TIMEOUT = 30
# How long to wait for the retained bridge/extensions snapshot before deciding
# whether ours needs installing. Retained delivery is immediate in practice; the
# wait only exists so a slow broker means one redundant save rather than none.
EXTENSION_WAIT = 10

# Streaming scan pacing. MEASURED, NOT GUESSED, and the measurements are the whole
# reason these are small:
#
# * Zigbee2MQTT serialises radio work per device and each ZCL attempt can burn ~10 s
#   on a timeout. Earlier in this project ~28 commands issued over 70 s built a queue
#   that took twenty minutes to drain, with only four of them ever attempted. The
#   queue, not the request, is the hazard.
# * A paced walk of this mesh's 15 probe targets (1 coordinator + 14 routers) with
#   these values measured 14.5 s wall clock, 15/15 answered, slowest single reply
#   1.09 s, 211 neighbour rows. The interval dominates: replies are fast, bursts are
#   what hurt.
#
# At most two requests are ever outstanding, so the queue cannot grow past two no
# matter how slowly devices answer, and dispatches are spaced at least
# SCAN_MIN_INTERVAL apart, which is the same 1 s Z2M's own network scan sleeps
# between devices.
SCAN_CONCURRENCY = 2
SCAN_MIN_INTERVAL = 1.0
# Per device, not per scan. The extension retries once after a 5 s pause, so a
# device that is answering nothing costs ~10 s + 5 s + ~10 s before it gives up;
# 45 s leaves room for that plus pagination of a large table. A device that runs out
# of time is reported as a failure and the scan carries on, so the whole walk is
# bounded by ceil(targets / SCAN_CONCURRENCY) * SCAN_DEVICE_TIMEOUT even if every
# device is dead.
SCAN_DEVICE_TIMEOUT = 45

# bridge/request/coordinator_check walks the coordinator's own tables: measured 43 s
# live against Z2M 2.13.0-1, so a short timeout would report a false failure.
COORDINATOR_CHECK_TIMEOUT = 120
# bridge/request/backup zips the whole Z2M config directory before answering.
BACKUP_TIMEOUT = 120
# Everything else answers immediately.
REQUEST_TIMEOUT = 30

# The label applied to every device Z2M reports.
LABEL_NAME = "Zigbee"
LABEL_ICON = "mdi:zigbee"
LABEL_COLOR = "teal"
LABEL_DESCRIPTION = "Devices Zigbee2MQTT reports. Maintained by the Zigbee integration."
# Registry events arrive in bursts while one joining device grows its entities, so
# a join costs one reconciliation pass instead of one per entity.
LABEL_DEBOUNCE = 2.0

# How Z2M's homeassistant extension names devices in HA's registry:
#   devices     ("mqtt", "zigbee2mqtt_<ieee>")
#   coordinator ("mqtt", "zigbee2mqtt_bridge_<ieee>")
# The `zigbee2mqtt` part is a LITERAL in Z2M's own source, not the base topic --
# only groups get a base-topic-derived prefix -- so renaming the base topic does
# not move these identifiers.
MQTT_IDENT_DOMAIN = "mqtt"
MQTT_IDENT_PREFIX = "zigbee2mqtt"
