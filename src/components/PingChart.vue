<template>
    <div>
        <div class="period-options">
            <button type="button" class="btn btn-light dropdown-toggle btn-period-toggle" data-bs-toggle="dropdown" aria-expanded="false">
                {{ chartPeriodOptions[chartPeriodHrs] }}&nbsp;
            </button>
            <ul class="dropdown-menu dropdown-menu-end">
                <li v-for="(item, key) in chartPeriodOptions" :key="key">
                    <a class="dropdown-item" :class="{ active: chartPeriodHrs == key }" href="#" @click.prevent="changePeriod(Number(key))">{{ item }}</a>
                </li>
            </ul>
        </div>
        <div class="chart-wrapper" :class="{ loading : loading}">
            <Line :data="chartData" :options="chartOptions" />
        </div>
    </div>
</template>

<script lang="js">
import { BarController, BarElement, Chart, Filler, LinearScale, LineController, LineElement, PointElement, TimeScale, Tooltip } from "chart.js";
import "chartjs-adapter-dayjs-4";
import dayjs from "dayjs";
import { Line } from "vue-chartjs";
import { DOWN, PENDING, MAINTENANCE } from "../util.ts";

Chart.register(LineController, BarController, LineElement, PointElement, TimeScale, BarElement, LinearScale, Tooltip, Filler);

export default {
    components: { Line },
    props: {
        /** ID of monitor */
        monitorId: {
            type: Number,
            required: true,
        },
    },
    data() {
        return {

            loading: false,

            // 0 = live "Recent" heartbeat feed; otherwise hours requested
            // from the server-side aggregation (getMonitorChartData)
            chartPeriodHrs: 0,

            chartPeriodOptions: {
                0: this.$t("recent"),
                3: "3h",
                6: "6h",
                24: "24h",
                168: "1w",
                720: "30d",
                8760: "1y",
            },

            // Pre-aggregated buckets for the selected non-recent period
            // Each item: {timestamp, up, down, avgPing, minPing, maxPing}
            chartBucketList: [],

            // Aggregation level returned by the server: "minute" | "hour" | "day"
            chartBucketType: "minute",

            // Used to discard responses of superseded period requests
            chartRequestId: 0,
        };
    },
    computed: {
        isLiveChart() {
            return this.chartPeriodHrs === 0;
        },

        chartOptions() {
            return {
                responsive: true,
                maintainAspectRatio: false,
                onResize: (chart) => {
                    chart.canvas.parentNode.style.position = "relative";
                    if (screen.width < 576) {
                        chart.canvas.parentNode.style.height = "275px";
                    } else if (screen.width < 768) {
                        chart.canvas.parentNode.style.height = "320px";
                    } else if (screen.width < 992) {
                        chart.canvas.parentNode.style.height = "300px";
                    } else {
                        chart.canvas.parentNode.style.height = "250px";
                    }
                },
                layout: {
                    padding: {
                        left: 10,
                        right: 30,
                        top: 30,
                        bottom: 10,
                    },
                },

                elements: {
                    point: {
                        // Hide points on chart unless mouse-over
                        radius: 0,
                        hitRadius: 100,
                    },
                },
                scales: {
                    x: {
                        type: "time",
                        time: this.chartTimeScaleOption(this.isLiveChart ? "recent" : this.chartBucketType),
                        ticks: {
                            sampleSize: 3,
                            maxRotation: 0,
                            autoSkipPadding: 30,
                            padding: 3,
                        },
                        grid: {
                            color: this.$root.theme === "light" ? "rgba(0,0,0,0.1)" : "rgba(255,255,255,0.1)",
                            offset: false,
                        },
                    },
                    y: {
                        title: {
                            display: true,
                            text: this.$t("respTime"),
                        },
                        offset: false,
                        grid: {
                            color: this.$root.theme === "light" ? "rgba(0,0,0,0.1)" : "rgba(255,255,255,0.1)",
                        },
                    },
                    y1: {
                        display: false,
                        position: "right",
                        grid: {
                            drawOnChartArea: false,
                        },
                        min: 0,
                        // Aggregated buckets stack the up and down bars
                        max: this.isLiveChart ? 1 : 2,
                        stacked: !this.isLiveChart,
                        offset: false,
                    },
                },
                bounds: "ticks",
                plugins: {
                    tooltip: {
                        mode: "nearest",
                        intersect: false,
                        padding: 10,
                        backgroundColor: this.$root.theme === "light" ? "rgba(212,232,222,1.0)" : "rgba(32,42,38,1.0)",
                        bodyColor: this.$root.theme === "light" ? "rgba(12,12,18,1.0)" : "rgba(220,220,220,1.0)",
                        titleColor: this.$root.theme === "light" ? "rgba(12,12,18,1.0)" : "rgba(220,220,220,1.0)",
                        filter: function (tooltipItem) {
                            // Hide tooltip on the status bar datasets (index 3+)
                            return tooltipItem.datasetIndex < 3;
                        },
                        callbacks: {
                            label: (context) => {
                                if (context.parsed.y === null) {
                                    return null;
                                }
                                return ` ${context.dataset.label} ${new Intl.NumberFormat().format(context.parsed.y)} ms`;
                            },
                        }
                    },
                    legend: {
                        display: false,
                    },
                },
            };
        },
        chartData() {
            if (this.isLiveChart) {
                return this.getLiveChartData();
            }

            return this.getAggregatedChartData();
        },
    },
    created() {
        // Restore the saved chart period for this monitor. Invalid/legacy
        // values fall back to the live feed instead of triggering a bad
        // server request.
        let period = Number(this.$root.storage()[`chart-period-${this.monitorId}`]);

        if (period > 0 && Object.prototype.hasOwnProperty.call(this.chartPeriodOptions, period)) {
            this.chartPeriodHrs = period;
            this.fetchChartData(period);
        }
    },
    methods: {
        /**
         * Switch the chart period. Period 0 keeps the live heartbeat feed,
         * other periods are fetched as server-side aggregated buckets.
         * @param {number} newPeriod Period in hours (0 = Recent)
         * @returns {void}
         */
        changePeriod(newPeriod) {
            if (newPeriod === this.chartPeriodHrs) {
                return;
            }

            this.chartPeriodHrs = newPeriod;

            if (newPeriod === 0) {
                // Back to the live feed: drop the aggregated snapshot
                this.chartBucketList = [];
                this.$root.storage().removeItem(`chart-period-${this.monitorId}`);
            } else {
                this.$root.storage()[`chart-period-${this.monitorId}`] = newPeriod;
                this.fetchChartData(newPeriod);
            }
        },

        /**
         * Request aggregated chart buckets from the server.
         * A per-request id makes sure only the latest response is accepted,
         * so quickly switching periods cannot overwrite the current view.
         * @param {number} periodHrs Period in hours
         * @returns {void}
         */
        fetchChartData(periodHrs) {
            let requestId = ++this.chartRequestId;
            this.loading = true;

            this.$root.getMonitorChartData(this.monitorId, periodHrs, (res) => {
                // A newer period was selected while this request was in flight
                if (requestId !== this.chartRequestId) {
                    return;
                }

                this.loading = false;

                if (!res.ok) {
                    this.chartBucketList = [];
                    this.$root.toastError(res.msg);
                } else {
                    this.chartBucketType = res.type;
                    this.chartBucketList = res.data;
                }
            });
        },

        /**
         * Build the chart datasets for the live "Recent" heartbeat feed.
         * Reads $root.heartbeatList directly, so every new "heartbeat" socket
         * event updates the chart incrementally via reactivity.
         * @returns {object} chart.js data
         */
        getLiveChartData() {
            let pingData = [];  // Ping Data for Line Chart, y-axis contains ping time
            let downData = [];  // Down Data for Bar Chart, y-axis is 1 if target is down (red color), under maintenance (blue color) or pending (orange color), 0 if target is up
            let colorData = []; // Color Data for Bar Chart

            let heartbeatList = (this.monitorId in this.$root.heartbeatList && this.$root.heartbeatList[this.monitorId]) || [];

            heartbeatList
                .filter(
                    // Filtering as data gets appended
                    // not the most efficient, but works for now
                    (beat) => dayjs.utc(beat.time).tz(this.$root.timezone).isAfter(
                        dayjs().subtract(6, "hours")
                    )
                )
                .map((beat) => {
                    const x = this.$root.datetime(beat.time);
                    pingData.push({
                        x,
                        y: beat.ping,
                    });
                    downData.push({
                        x,
                        y: (beat.status === DOWN || beat.status === MAINTENANCE || beat.status === PENDING) ? 1 : 0,
                    });
                    colorData.push((beat.status === MAINTENANCE) ? "rgba(23,71,245,0.41)" : ((beat.status === PENDING) ? "rgba(245,182,23,0.41)" : "#DC354568"));
                });

            return {
                datasets: [
                    {
                        // Line Chart
                        data: pingData,
                        fill: "origin",
                        tension: 0.2,
                        borderColor: "#5CDD8B",
                        backgroundColor: "#5CDD8B38",
                        yAxisID: "y",
                        label: "ping",
                    },
                    {
                        // Hidden placeholder datasets so the bar datasets keep
                        // the same indexes (3/4) as in the aggregated chart
                        data: [],
                        yAxisID: "y",
                        label: "min",
                    },
                    {
                        data: [],
                        yAxisID: "y",
                        label: "max",
                    },
                    {
                        // Bar Chart
                        type: "bar",
                        data: downData,
                        borderColor: "#00000000",
                        backgroundColor: colorData,
                        yAxisID: "y1",
                        barThickness: "flex",
                        barPercentage: 1,
                        categoryPercentage: 1,
                        inflateAmount: 0.05,
                        label: "status",
                    },
                ],
            };
        },

        /**
         * Build the chart datasets from server-side aggregated buckets.
         * Three line datasets (avg/min/max ping) plus stacked up/down bars.
         * @returns {object} chart.js data
         */
        getAggregatedChartData() {
            let avgPingData = [];
            let minPingData = [];
            let maxPingData = [];
            let upData = [];
            let downData = [];

            for (let bucket of this.chartBucketList) {
                // Bucket timestamps are epoch milliseconds; format them in
                // the selected local timezone, same as the live heartbeat path
                const x = this.$root.datetime(bucket.timestamp);

                avgPingData.push({ x,
                    y: bucket.avgPing });
                minPingData.push({ x,
                    y: bucket.minPing });
                maxPingData.push({ x,
                    y: bucket.maxPing });

                // Stacked bars on y1 (max 2): down at the bottom, up on top
                if (bucket.down > 0) {
                    downData.push({ x,
                        y: 1 });
                    if (bucket.up > 0) {
                        upData.push({ x,
                            y: 1 });
                    }
                } else if (bucket.up > 0) {
                    downData.push({ x,
                        y: 0 });
                    upData.push({ x,
                        y: 1 });
                }
            }

            return {
                datasets: [
                    {
                        // Average ping line
                        data: avgPingData,
                        fill: "origin",
                        tension: 0.2,
                        borderColor: "#5CDD8B",
                        backgroundColor: "#5CDD8B38",
                        yAxisID: "y",
                        label: "avg",
                    },
                    {
                        // Minimum ping line
                        data: minPingData,
                        fill: false,
                        tension: 0.2,
                        borderColor: "#3FAE6E",
                        borderDash: [ 4, 3 ],
                        pointRadius: 0,
                        yAxisID: "y",
                        label: "min",
                    },
                    {
                        // Maximum ping line
                        data: maxPingData,
                        fill: false,
                        tension: 0.2,
                        borderColor: "#8BE8B0",
                        borderDash: [ 4, 3 ],
                        pointRadius: 0,
                        yAxisID: "y",
                        label: "max",
                    },
                    {
                        // Down part of the status bar (red)
                        type: "bar",
                        data: downData,
                        stack: "status",
                        borderColor: "#00000000",
                        backgroundColor: "#DC354568",
                        yAxisID: "y1",
                        barThickness: "flex",
                        barPercentage: 1,
                        categoryPercentage: 1,
                        inflateAmount: 0.05,
                        label: "down",
                    },
                    {
                        // Up part of the status bar (green)
                        type: "bar",
                        data: upData,
                        stack: "status",
                        borderColor: "#00000000",
                        backgroundColor: "rgba(92,221,139,0.35)",
                        yAxisID: "y1",
                        barThickness: "flex",
                        barPercentage: 1,
                        categoryPercentage: 1,
                        inflateAmount: 0.05,
                        label: "up",
                    },
                ],
            };
        },
    }
};
</script>

<style lang="scss" scoped>
@import "../assets/vars.scss";

.form-select {
    width: unset;
    display: inline-flex;
}

.period-options {
    padding: 0.1em 1em;
    margin-bottom: -1.2em;
    float: right;
    position: relative;
    z-index: 10;

    .dropdown-menu {
        padding: 0;
        min-width: 50px;
        font-size: 0.9em;

        .dark & {
            background: $dark-bg;
        }

        .dropdown-item {
            border-radius: 0.3rem;
            padding: 2px 16px 4px;

            .dark & {
                background: $dark-bg;
            }

            .dark &:hover {
                background: $dark-font-color;
                color: $dark-font-color2;
            }
        }

        .dark & .dropdown-item.active {
            background: $primary;
            color: $dark-font-color2;
        }
    }

    .btn-period-toggle {
        padding: 2px 15px;
        background: transparent;
        border: 0;
        color: $link-color;
        opacity: 0.7;
        font-size: 0.9em;

        &::after {
            vertical-align: 0.155em;
        }

        .dark & {
            color: $dark-font-color;
        }
    }
}

.chart-wrapper {
    margin-bottom: 0.5em;

    &.loading {
        filter: blur(10px);
    }
}
</style>
