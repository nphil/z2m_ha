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
# One device's OTA state changed, passed as the arg. Fed from the DEVICE state
# topics, not a bridge topic: Z2M publishes firmware progress as an `update` key on
# `<base>/<friendly_name>` and nowhere else.
SIGNAL_OTA = f"{DOMAIN}_ota"
# One device's own state topic changed while something is watching it, passed
# as {ieee_address, state, fragment} -- `state` is the merged property map,
# `fragment` is the raw payload THIS publish carried (Z2M sends partial maps).
# Fed from the DEVICE state topic like SIGNAL_OTA, but scoped per ieee rather
# than fleet-wide: see Z2MData.async_device_state_acquire.
SIGNAL_DEVICE_STATE = f"{DOMAIN}_device_state"
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

# Channel energy scan. The coordinator can only serve one master: Zigbee2MQTT holds
# the TCP socket to the radio, so a scan stops the add-on, borrows the radio over
# that same socket with zigpy-znp, and starts the add-on again no matter how the
# scan went. The slug is this install's instance of the Zigbee2MQTT add-on.
ENERGY_SCAN_ADDON = "45df7312_zigbee2mqtt"
# Used only if bridge/info's serial.port cannot be parsed into host:port. It names
# the same adapter that value carries today (tcp://192.168.1.104:7638), just in the
# socket:// form pyserial and zigpy-znp expect.
ENERGY_SCAN_SERIAL_FALLBACK = "socket://192.168.1.104:7638"
# How long to give the stopped add-on to publish bridge/state offline and release
# the socket. Z2M announces offline on graceful stop, so this is normally seconds;
# the grace only bounds the wait when that publish never comes.
ENERGY_SCAN_STOP_GRACE = 15
# Borrowing the radio is seconds of work: connect, read-only network start, then 16
# channels of ZDO energy detect. A hard deadline means a wedged socket surfaces as
# an error instead of holding the add-on down until someone notices.
ENERGY_SCAN_RADIO_TIMEOUT = 120
# addon_start plus Z2M's own startup until bridge/state says online again.
ENERGY_SCAN_RESTART_DEADLINE = 120
# ZDO Mgmt_NWK_Update_req parameters: scan duration exponent 4, three sweeps per
# channel. Roughly a quarter second of listening per channel per sweep.
ENERGY_SCAN_DURATION_EXP = 4
ENERGY_SCAN_COUNT = 3
# Persisted scan history, newest first, so scans can be compared across weeks.
ENERGY_SCAN_STORE_KEY = "z2m.energy_scans"
ENERGY_SCAN_STORE_VERSION = 1
ENERGY_SCAN_KEEP = 50

# Touchlink takes the radio OFF the operating channel and sweeps the InterPAN
# channels, so it is slow AND it stalls every other Zigbee conversation while it
# runs. Derived from zigbee-herdsman v10.8.0 (the version 2.13.0 pins),
# src/controller/touchlink.ts: `scanChannels` is 16 channels and each one costs a
# `setChannelInterPAN` plus a broadcast with a 500 ms timeout that is burned in full
# when nothing answers -- 8 s of pure timeout, plus 16 channel switches and the
# closing restore, so ~10-13 s in practice. `factoryResetFirst` walks the same 16
# channels and adds a hard 2 s wait, so it is no faster. 60 s is that worst case with
# room for a slow adapter, and still finite enough to report a stuck radio.
TOUCHLINK_TIMEOUT = 60

# Every touchlink operation shares ONE lock. herdsman's Touchlink.lock() throws
# "Touchlink operation already in progress" for a second concurrent operation, and
# scan/identify/factory_reset are three different MQTT paths -- so per-path
# serialization is not enough and this key is what makes them queue behind each other.
TOUCHLINK_LOCK = "touchlink"

# bridge/response/device/ota_update/update is TERMINAL: Z2M answers it only once the
# whole firmware transfer has finished, carrying the from/to file versions, which is
# minutes. Refusals, by contrast, are published before any radio work -- unknown
# device, update already in progress, device does not support OTA. So an update is
# awaited only for long enough to catch a refusal, and progress then arrives on the
# push channel. Eight seconds covers Z2M's synchronous validation plus the one ZCL
# read it does first, without holding the operator's UI on a transfer.
OTA_ACCEPT_WINDOW = 8

# Scene writes are device `set` publishes, so nothing answers them on a response
# topic. What IS observable is that Z2M republishes the retained inventory after any
# scene mutation. That republish is a local round trip through the broker plus one
# Zigbee command, so it lands quickly or not at all.
SCENE_TIMEOUT = 20
# scene_recall stores nothing, so there is no inventory change to wait for. All that
# can be observed is a converter failure appearing on bridge/logging, which Z2M logs
# synchronously as the command fails. Long enough to catch that, short enough not to
# make a working recall feel slow.
SCENE_RECALL_GRACE = 3.0

# z2m/device/set's write lifecycle, fixed by the contract the panel builds
# against rather than measured: resolve confirmed once the device's own state
# topic echoes a written property, and unconfirmed after this deadline for
# every other settable property, mains or battery.
DEVICE_SET_TIMEOUT = 10
# Write-only properties (access exactly 2: settable, never in state) can never
# echo, so there is nothing to wait the full timeout for -- only a possible
# converter failure on bridge/logging, the same idea as SCENE_RECALL_GRACE.
DEVICE_SET_GRACE = 3.0

# The pairing log-level restore is fire-and-forget MQTT, so it is made durable
# rather than trusted: the pending target level is written here the moment
# Zigbee2MQTT is raised to debug, and not cleared until bridge/info actually
# echoes it back with nobody watching. That is what survives a Home Assistant
# restart mid-pairing, or a Zigbee2MQTT outage that swallows the restore
# publish outright -- both leave a record here for the next start to finish.
LOG_RESTORE_STORE_KEY = "z2m.log_restore"
LOG_RESTORE_STORE_VERSION = 1
# How long to give a restore publish to be echoed back before sending it once
# more. Long enough that an ordinary round trip through the broker is never
# mistaken for a lost publish; short enough that a genuinely lost one is
# retried within the same pairing session rather than only at next startup.
LOG_RESTORE_RETRY_GRACE = 15.0

# The clusters Zigbee2MQTT is willing to bind, copied from ALL_CLUSTER_CANDIDATES in
# 2.13.0's lib/extension/bind.ts. Mirrored rather than guessed because Z2M attempts
# ONLY these: offering the operator a cluster outside this list would produce a
# request that comes back "Nothing to bind" every time.
BINDABLE_CLUSTERS = (
    "genScenes",
    "genOnOff",
    "genLevelCtrl",
    "lightingColorCtrl",
    "closuresWindowCovering",
    "hvacThermostat",
    "msIlluminanceMeasurement",
    "msTemperatureMeasurement",
    "msRelativeHumidity",
    "msSoilMoisture",
    "msCO2",
)

# Z2M's internal bind group (DEFAULT_BIND_GROUP_ID in its lib/util/utils.ts). It is
# reported on bridge/groups like a real group but it is Z2M's own plumbing, so it is
# filtered out of anything the operator picks a group from.
DEFAULT_BIND_GROUP_ID = 901

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
