/**
 * Per-device neighbour-table endpoint for the Home Assistant `z2m` integration.
 *
 * Zigbee2MQTT's own `bridge/request/networkmap` walks every router inside one
 * request and answers once, at the end. That is fine for a file you download and
 * useless for a map you watch being drawn: 45 devices produce one payload after a
 * minute of silence. This extension exposes the same underlying query one device
 * at a time, so the integration can drive the walk itself and push each neighbour
 * table to the browser as it lands.
 *
 *   request   <base>/bridge/request/z2m_lqi   {"ieeeAddr": "0x...", "transaction": "..."}
 *   response  <base>/bridge/response/z2m_lqi  {transaction, ieeeAddr, name, type,
 *                                              lastSeen, neighbors: [...]}
 *             on failure the same minus `lastSeen`/`neighbors`, plus {error: "..."}
 *
 * `neighbors` rows are handed over exactly as zigbee-herdsman parsed them off the
 * air -- eui64, nwkAddress, deviceType, rxOnWhenIdle, relationship, permitJoining,
 * depth, lqi -- with no filtering, patching or renaming. Everything the map needs
 * to decide (a neighbour that reports itself as 0x0000000000000000, a row for a
 * device that has left, an inactive relationship) is decided on the Home Assistant
 * side, in one place, where it can also be counted and shown. An extension that
 * quietly cleaned up its own output would make those judgements invisible.
 *
 * Optional `{"nodes": true}` adds `fleetLastSeen` -- a plain ieee -> epoch-ms map
 * for every device, read out of herdsman's own state. It costs no radio time and it
 * is the one node field `bridge/devices` does not carry, so the integration asks for
 * it on the first probe of a scan and then stops asking.
 *
 * Every reply is a reply: an unknown, disabled, uninterviewed or end device gets an
 * explicit `error`, never silence, because the caller is pacing a queue and cannot
 * tell a slow device from a dropped request.
 *
 * Written for Zigbee2MQTT 2.13 (`Device.lqi()` resolving to an array of ZDO
 * LQI_TABLE_RESPONSE entries). Loaded by the integration from disk and installed
 * over `bridge/request/extension/save`, once, and left in place.
 */

/**
 * Bumped whenever anything below changes. The integration compares the code it
 * holds against the copy Zigbee2MQTT reports on `bridge/extensions` and re-saves
 * on any difference, so this is for the log rather than for the comparison.
 */
const VERSION = "1";

/** Relative to the base topic, which is all `mqtt.publish` wants. */
const RESPONSE_TOPIC = "bridge/response/z2m_lqi";

/**
 * One retry, 5 s later. A congested mesh drops the odd ZDO request outright, and
 * a device that answers the second attempt is not a device worth reporting as
 * failed. Z2M's own network scan does exactly this, for the same reason.
 */
const RETRY_DELAY_MS = 5000;

/** Devices that hold a neighbour table at all. */
const HAS_NEIGHBOURS = new Set(["Coordinator", "Router"]);

export default class Z2MHomeAssistantLqi {
    #zigbee;
    #mqtt;
    #eventBus;
    #logger;
    #requestTopic;

    constructor(
        zigbee,
        mqtt,
        state,
        publishEntityState,
        eventBus,
        enableDisableExtension,
        restartCallback,
        addExtension,
        settings,
        logger,
    ) {
        this.#zigbee = zigbee;
        this.#mqtt = mqtt;
        this.#eventBus = eventBus;
        this.#logger = logger;
        this.#requestTopic = `${settings.get().mqtt.base_topic}/bridge/request/z2m_lqi`;
    }

    async start() {
        this.#eventBus.onMQTTMessage(this, this.#onMQTTMessage);
        this.#logger.info(`z2m_ha_lqi v${VERSION} listening on '${this.#requestTopic}'`);
    }

    async stop() {
        this.#eventBus.removeListeners(this);
    }

    /**
     * Private arrow, so it stays bound and stays out of the public surface. The
     * event bus keys listeners by constructor name, not by function identity, so
     * `removeListeners(this)` still detaches it.
     */
    #onMQTTMessage = async (data) => {
        if (data.topic !== this.#requestTopic) {
            return;
        }

        let request;
        try {
            request = JSON.parse(data.message);
        } catch {
            // No transaction to answer on, and nothing useful to say back.
            this.#logger.warning(`z2m_ha_lqi: request is not JSON: '${data.message}'`);
            return;
        }
        if (typeof request !== "object" || request === null) {
            this.#logger.warning(`z2m_ha_lqi: request is not an object: '${data.message}'`);
            return;
        }

        const { transaction, ieeeAddr } = request;
        const reply = { transaction, ieeeAddr, name: undefined, type: undefined };
        if (request.nodes) {
            reply.fleetLastSeen = this.#fleetLastSeen();
        }

        if (typeof ieeeAddr !== "string" || !ieeeAddr.startsWith("0x")) {
            await this.#publish({ ...reply, error: `'${ieeeAddr}' is not an ieee address` });
            return;
        }

        const device = this.#zigbee.resolveEntity({ ieeeAddr });
        if (device === undefined || device.isGroup?.()) {
            await this.#publish({ ...reply, error: `${ieeeAddr} is not a known device` });
            return;
        }

        reply.name = device.name;
        reply.type = device.zh.type;

        if (device.options.disabled) {
            await this.#publish({ ...reply, error: `${device.name} is disabled` });
            return;
        }
        if (!device.interviewed) {
            await this.#publish({ ...reply, error: `${device.name} has not been interviewed` });
            return;
        }
        if (!HAS_NEIGHBOURS.has(device.zh.type)) {
            // An end device keeps no neighbour table; asking costs a round trip and
            // returns nothing. Say so rather than letting the caller wait it out.
            await this.#publish({
                ...reply,
                error: `${device.name} is an ${device.zh.type} and holds no neighbour table`,
            });
            return;
        }

        try {
            const neighbors = await this.#lqiWithRetry(device);
            reply.lastSeen = device.zh.lastSeen;
            await this.#publish({ ...reply, neighbors });
        } catch (error) {
            this.#logger.debug(`z2m_ha_lqi: LQI failed for '${device.name}': ${error.stack}`);
            await this.#publish({ ...reply, error: `${error.message}` });
        }
    };

    async #lqiWithRetry(device) {
        try {
            return await device.zh.lqi();
        } catch (error) {
            this.#logger.debug(
                `z2m_ha_lqi: LQI for '${device.name}' failed (${error.message}), retrying in ${RETRY_DELAY_MS} ms`,
            );
            await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
            return await device.zh.lqi();
        }
    }

    /**
     * ieee -> epoch ms for every device herdsman knows. `bridge/devices` carries no
     * last-seen and device state topics are not retained, so without this a map
     * drawn from the retained inventory alone can only say "unknown".
     */
    #fleetLastSeen() {
        const out = {};
        for (const device of this.#zigbee.devicesIterator()) {
            if (device.zh.lastSeen) {
                out[device.ieeeAddr] = device.zh.lastSeen;
            }
        }
        return out;
    }

    async #publish(reply) {
        await this.#mqtt.publish(RESPONSE_TOPIC, JSON.stringify(reply));
    }
}
