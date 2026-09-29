const { R } = require("redbean-node");
const { checkLogin } = require("../util-server");
const { log } = require("../../src/util");
const { UptimeCalculator } = require("../uptime-calculator");

/**
 * Convert the requested period (in hours) to the aggregation level
 * which the UptimeCalculator can serve from its three pre-aggregated
 * bucket tables.
 * @param {number} periodHrs Period in hours from now
 * @returns {"minute" | "hour" | "day"} Aggregation granularity
 * @throws {Error} Period is not supported
 */
function getGranularity(periodHrs) {
    if (periodHrs <= 24) {
        return "minute";
    }
    if (periodHrs <= 30 * 24) {
        return "hour";
    }
    if (periodHrs <= 365 * 24) {
        return "day";
    }
    throw new Error("The maximum period is 1 year (8760 hours).");
}

/**
 * Handlers for monitor chart data
 * @param {Socket} socket Socket.io instance
 * @returns {void}
 */
module.exports.chartSocketHandler = (socket) => {
    socket.on("getMonitorChartData", async (monitorID, periodHrs, callback) => {
        try {
            checkLogin(socket);

            // Parse and validate the period first, so an invalid input
            // is rejected before touching the database
            const period = Number(periodHrs);
            const monitorIDNum = Number(monitorID);

            if (! Number.isInteger(monitorIDNum)) {
                throw new Error("Invalid monitor ID.");
            }

            if (! Number.isFinite(period) || period <= 0) {
                throw new Error("Invalid period.");
            }

            const granularity = getGranularity(period);

            log.info("monitor", `Get Monitor Chart Data: ${monitorIDNum} Period: ${period}h Granularity: ${granularity} User ID: ${socket.userID}`);

            // Verify that the monitor belongs to the logged in user
            let row = await R.getRow("SELECT id FROM monitor WHERE id = ? AND user_id = ? ", [
                monitorIDNum,
                socket.userID,
            ]);

            if (! row) {
                throw new Error("You do not own this monitor.");
            }

            let uptimeCalculator = await UptimeCalculator.getUptimeCalculator(monitorIDNum);
            let data = uptimeCalculator.getChartData(period);

            callback({
                ok: true,
                data,
                granularity,
            });
        } catch (e) {
            callback({
                ok: false,
                msg: e.message,
            });
        }
    });
};
