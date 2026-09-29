<template>
    <div>
        <div class="period-options">
            <button type="button" class="btn btn-light dropdown-toggle btn-period-toggle" data-bs-toggle="dropdown" aria-expanded="false">
                {{ chartPeriodOptions[chartPeriodHrs] }}&nbsp;
            </button>
            <ul class="dropdown-menu dropdown-menu-end">
                <li v-for="(item, key) in chartPeriodOptions" :key="key">
                    <a class="dropdown-item" :class="{ active: chartPeriodHrs == key }" href="#" @click="chartPeriodHrs = Number(key)">{{ item }}</a>
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
import { DOWN, PENDING, MAINTENANCE, log } from "../util.ts";
import datetimeMixin from "../mixins/datetime";

Chart.register(LineController, BarController, LineElement, PointElement, TimeScale, BarElement, LinearScale, Tooltip, Filler);

// Status bar colors
const COLOR_DOWN = "#DC354568";
const COLOR_UP = "#5CDD8B38";
const COLOR_MAINTENANCE = "rgba(23,71,245,0.41)";
const COLOR_PENDING = "rgba(245,182,23,0.41)";

// Ping line colors
const COLOR_AVG = "#5CDD8B";
const COLOR_MIN = "#5B8DEF";
const COLOR_MAX = "#EFA14C";

export default {
    components: { Line },
    mixins: [ datetimeMixin ],
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

            // Configurable filtering on top of the returned data
            // 0 = Recent, otherwise the period in hours
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

            // Pre-aggregated buckets from the server for 3h/6h/24h/1w/30d/1y
            // null means the Recent data source ($root.heartbeatList) is used
            chartBuckets: null,

            // Monotonic token so a late response for an older period cannot
            // overwrite buckets of a newer selection
            chartRequestToken: 0,
        };
    },
    computed: {
        // Recent always uses the live heartbeat list from the socket mixin
        recentHeartbeatList() {
            return (this.monitorId in this.$root.heartbeatList && this.$root.heartbeatList[this.monitorId]) || [];
        },

        chartOptions() {
            const scaleConfig = this.chartTimeScaleConfig(this.chartPeriodHrs);
            const isRecent = this.chartPeriodHrs === 0;

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
                        time: {
                            minUnit: scaleConfig.minUnit,
                            round: scaleConfig.round,
                            tooltipFormat: scaleConfig.tooltipFormat,
                            displayFormats: {
                                minute: "HH:mm",
                                hour: "MM-DD HH:mm",
                                day: "YYYY-MM-DD",
                            }
                        },
                        ticks: {
                            sampleSize: 3,
                            maxRotation: 0,
                            autoSkipPadding: 30,
                            padding: 3,
                            // Format ticks in the user selected timezone
                            callback: (value) => this.chartTickLabel(value, this.chartPeriodHrs),
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
                        max: 1,
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
                        filter: (tooltipItem) => {
                            // Recent mode: hide tooltip on the status bar
                            if (isRecent) {
                                return tooltipItem.datasetIndex === 0;
                            }
                            // Aggregated mode: the bar tooltip is handled below
                            return tooltipItem.dataset.type !== "bar";
                        },
                        callbacks: {
                            // Show the time in the user selected timezone
                            title: (tooltipItems) => {
                                if (tooltipItems.length > 0) {
                                    return this.chartTooltipTime(tooltipItems[0].parsed.x, this.chartPeriodHrs);
                                }
                                return "";
                            },
                            label: (context) => {
                                if (isRecent) {
                                    return ` ${new Intl.NumberFormat().format(context.parsed.y)} ms`;
                                }

                                let bucket = this.chartBuckets[context.dataIndex];

                                if (! bucket) {
                                    return "";
                                }

                                const lines = [];

                                if (bucket.up > 0) {
                                    lines.push(`${this.$t("Up")}: ${bucket.up}`);
                                }

                                if (bucket.down > 0) {
                                    lines.push(`${this.$t("Down")}: ${bucket.down}`);
                                }

                                if (bucket.maintenance > 0) {
                                    lines.push(`${this.$t("statusMaintenance")}: ${bucket.maintenance}`);
                                }

                                const labelName = context.dataset.label || "";
                                lines.push(` ${labelName}: ${new Intl.NumberFormat().format(context.parsed.y)} ms`);

                                return lines;
                            },
                        }
                    },
                    legend: {
                        display: false,
                    },
                },
            };
        },

        /**
         * Build the chart datasets from the active data source:
         * - Recent: raw heartbeats, single ping line + status bar
         * - Other periods: server aggregated buckets with avg/min/max lines
         *   and up/down status bar
         * @returns {object} Chart.js datasets for the active period
         */
        chartData() {
            if (this.chartPeriodHrs === 0 || this.chartBuckets === null) {
                return this.buildRecentChartData();
            }
            return this.buildAggregatedChartData();
        },
    },
    watch: {
        // Switch the data source when the selected chart period changes
        chartPeriodHrs(newPeriod) {
            this.onPeriodChange(newPeriod);
        },
    },
    created() {
        // Load chart period from storage if saved
        let period = this.$root.storage()[`chart-period-${this.monitorId}`];
        if (period != null) {
            // eslint-disable-next-line eqeqeq
            this.chartPeriodHrs = (period == 0) ? 0 : Number(period);
        }
    },
    methods: {
        /**
         * Handle a chart period change: Recent uses the live heartbeat
         * list, all other periods are fetched from the server.
         * @param {number} newPeriod Newly selected period in hours
         * @returns {void}
         */
        onPeriodChange(newPeriod) {
            if (newPeriod === 0) {
                // Recent uses the live heartbeat list, no server fetch
                this.chartBuckets = null;
                this.loading = false;
                this.$root.storage().removeItem(`chart-period-${this.monitorId}`);
            } else {
                this.fetchChartData(newPeriod);
            }
        },

        /**
         * Fetch pre-aggregated chart buckets from the server.
         * The server decides the granularity from the period:
         * <= 24h minute, <= 30d hour, <= 1y day buckets
         * @param {number} periodHrs Period in hours
         * @returns {void}
         */
        fetchChartData(periodHrs) {
            this.loading = true;
            let token = ++this.chartRequestToken;

            this.$root.getMonitorChartData(this.monitorId, periodHrs, (res) => {
                // A newer period selection superseded this request
                if (token !== this.chartRequestToken) {
                    return;
                }

                if (!res.ok) {
                    this.$root.toastError(res.msg);
                    // Fall back to Recent so the dropdown label and the
                    // actual data source cannot disagree after a rejection.
                    // The watcher clears chartBuckets and the saved period.
                    this.chartPeriodHrs = 0;
                } else {
                    log.debug("ping_chart", `Got ${res.data.length} ${res.granularity} chart buckets for monitor ${this.monitorId}`);
                    this.chartBuckets = res.data;
                    this.$root.storage()[`chart-period-${this.monitorId}`] = periodHrs;
                }
                this.loading = false;
            });
        },

        /**
         * Build datasets from live heartbeats (Recent period).
         * The chart re-renders incrementally when $root.heartbeatList
         * receives a new "heartbeat" socket event.
         * @returns {object} Chart.js data
         */
        buildRecentChartData() {
            let pingData = [];  // Ping Data for Line Chart, y-axis contains ping time
            let downData = [];  // Down Data for Bar Chart, y-axis is 1 if target is down (red color), under maintenance (blue color) or pending (orange color), 0 if target is up
            let colorData = []; // Color Data for Bar Chart

            this.recentHeartbeatList
                .filter(
                    // Filtering as data gets appended
                    // not the most efficient, but works for now
                    (beat) => dayjs.utc(beat.time).valueOf() >
                        Date.now() - Math.max(this.chartPeriodHrs, 6) * 3600 * 1000
                )
                .map((beat) => {
                    // Use epoch milliseconds so the instant is unambiguous;
                    // timezone formatting is handled in the axis tick callback
                    const x = dayjs.utc(beat.time).valueOf();
                    pingData.push({
                        x,
                        y: Number(beat.ping),
                    });
                    downData.push({
                        x,
                        y: (beat.status === DOWN || beat.status === MAINTENANCE || beat.status === PENDING) ? 1 : 0,
                    });
                    colorData.push((beat.status === MAINTENANCE) ? COLOR_MAINTENANCE : ((beat.status === PENDING) ? COLOR_PENDING : COLOR_DOWN));
                });

            return {
                datasets: [
                    {
                        // Line Chart
                        data: pingData,
                        fill: "origin",
                        tension: 0.2,
                        borderColor: COLOR_AVG,
                        backgroundColor: `${COLOR_AVG}38`,
                        yAxisID: "y",
                        label: "ping",
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
         * Build datasets from server pre-aggregated buckets.
         * Shows avg/min/max ping lines and an up/down status bar.
         * @returns {object} Chart.js data
         */
        buildAggregatedChartData() {
            let avgData = [];
            let minData = [];
            let maxData = [];
            let downData = [];
            let colorData = [];

            for (let bucket of this.chartBuckets) {
                // timestamp is the UTC bucket start in milliseconds
                const x = bucket.timestamp;

                avgData.push({
                    x,
                    y: bucket.avgPing,
                });
                minData.push({
                    x,
                    y: bucket.minPing,
                });
                maxData.push({
                    x,
                    y: bucket.maxPing,
                });

                // Status bar: mark the bucket when it contains any
                // down / maintenance beat, otherwise show a faint up bar
                let isDown = bucket.down > 0;
                let isMaintenance = bucket.maintenance > 0;

                downData.push({
                    x,
                    y: (isDown || isMaintenance) ? 1 : (bucket.up > 0 ? 0.5 : 0),
                });

                colorData.push(isMaintenance ? COLOR_MAINTENANCE : (isDown ? COLOR_DOWN : COLOR_UP));
            }

            return {
                datasets: [
                    {
                        // Average ping line
                        data: avgData,
                        fill: false,
                        tension: 0.2,
                        borderColor: COLOR_AVG,
                        backgroundColor: `${COLOR_AVG}38`,
                        yAxisID: "y",
                        label: "avg",
                    },
                    {
                        // Minimum ping line
                        data: minData,
                        fill: false,
                        tension: 0.2,
                        borderColor: COLOR_MIN,
                        backgroundColor: COLOR_MIN,
                        yAxisID: "y",
                        label: "min",
                    },
                    {
                        // Maximum ping line
                        data: maxData,
                        fill: false,
                        tension: 0.2,
                        borderColor: COLOR_MAX,
                        backgroundColor: COLOR_MAX,
                        yAxisID: "y",
                        label: "max",
                    },
                    {
                        // Up/down status bar
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
    },
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
