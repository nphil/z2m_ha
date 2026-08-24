"""Constants for the Zigbee (Zigbee2MQTT) panel integration."""

DOMAIN = "z2m"

CONF_BASE_TOPIC = "base_topic"
DEFAULT_BASE_TOPIC = "zigbee2mqtt"

# Panel. No sidebar title/icon: this is reached from the integration entry, like
# zwave_js, so it never appears in the sidebar.
PANEL_URL_PATH = "z2m"
WEBCOMPONENT = "z2m-panel"
PANEL_JS = "z2m-panel.js"

# Signal fired on the HA bus when any cached Z2M state changes.
SIGNAL_UPDATE = f"{DOMAIN}_update"

# Retained bridge topics we mirror into local state. Each is JSON except `state`,
# which Z2M publishes as {"state": "online"|"offline"}.
TOPIC_INFO = "bridge/info"
TOPIC_DEVICES = "bridge/devices"
TOPIC_GROUPS = "bridge/groups"
TOPIC_STATE = "bridge/state"
TOPIC_HEALTH = "bridge/health"

BRIDGE_TOPICS = (TOPIC_INFO, TOPIC_DEVICES, TOPIC_GROUPS, TOPIC_STATE, TOPIC_HEALTH)

# Request topics. Z2M answers on the same path minus the trailing /set-style suffix,
# i.e. bridge/response/<x>; we fire-and-forget and let the retained topics update.
REQ = "bridge/request"
