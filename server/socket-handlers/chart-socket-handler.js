const { log } = require("../../src/util");
const { checkLogin } = require("../util-server");
const { UptimeCalculator } = require("../uptime-calculator");

/**
 * Handlers for the monitor ping chart
 *
 * Serves pre-aggregated minute/hour/day buckets from the monitor's
 * UptimeCalculator instead of streaming raw heartbeats to the browser.
 * @param {Socket} socket Socket.io instance
 * @returns {void}
 */
module.exports.chartSocketHandler = (socket) => {

    socket.on("getMonitorChartData", async (monitorID, periodHrs, callback) => {
        try {
            checkLogin(socket);

            // Reject malformed input at the boundary instead of coercing it
            monitorID = parseInt(monitorID);
            if (!monitorID) {
                throw new Error("Invalid monitor ID.");
            }

            log.info("monitor", `Get Monitor Chart Data: ${monitorID} Period: ${periodHrs} hours User ID: ${socket.userID}`);

            let uptimeCalculator = await UptimeCalculator.getUptimeCalculator(monitorID);

            // getChartDataType validates the period and maps it to the
            // minute/hour/day aggregation level (throws on invalid periods)
            let type = UptimeCalculator.getChartDataType(periodHrs);
            let chartData = uptimeCalculator.getChartData(periodHrs);

            callback({
                ok: true,
                type,
                data: chartData.data,
            });
        } catch (e) {
            callback({
                ok: false,
                msg: e.message,
            });
        }
    });

};
