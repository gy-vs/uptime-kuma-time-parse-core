import dayjs from "dayjs";

/**
 * DateTime Mixin
 * Handled timezone and format
 */
export default {
    data() {
        return {
            userTimezone: localStorage.timezone || "auto",
        };
    },

    methods: {
        /**
         * Convert value to UTC
         * @param {string | number | Date | dayjs.Dayjs} value Time
         * value to convert
         * @returns {dayjs.Dayjs} Converted time
         */
        toUTC(value) {
            return dayjs.tz(value, this.timezone).utc().format();
        },

        /**
         * Used for <input type="datetime" />
         * @param {string | number | Date | dayjs.Dayjs} value Value to
         * convert
         * @returns {string} Datetime string
         */
        toDateTimeInputFormat(value) {
            return this.datetimeFormat(value, "YYYY-MM-DDTHH:mm");
        },

        /**
         * Return a given value in the format YYYY-MM-DD HH:mm:ss
         * @param {any} value Value to format as date time
         * @returns {string} Formatted string
         */
        datetime(value) {
            return this.datetimeFormat(value, "YYYY-MM-DD HH:mm:ss");
        },

        /**
         * Get time for maintenance
         * @param {string | number | Date | dayjs.Dayjs} value Time to
         * format
         * @returns {string} Formatted string
         */
        datetimeMaintenance(value) {
            const inputDate = new Date(value);
            const now = new Date(Date.now());

            if (inputDate.getFullYear() === now.getUTCFullYear() && inputDate.getMonth() === now.getUTCMonth() && inputDate.getDay() === now.getUTCDay()) {
                return this.datetimeFormat(value, "HH:mm");
            } else {
                return this.datetimeFormat(value, "YYYY-MM-DD HH:mm");
            }
        },

        /**
         * Return a given value in the format YYYY-MM-DD
         * @param {any} value  Value to format as date
         * @returns {string} Formatted string
         */
        date(value) {
            return this.datetimeFormat(value, "YYYY-MM-DD");
        },

        /**
         * Return a given value in the format HH:mm or if second is set
         * to true, HH:mm:ss
         * @param {any} value Value to format
         * @param {boolean} second Should seconds be included?
         * @returns {string} Formatted string
         */
        time(value, second = true) {
            let secondString;
            if (second) {
                secondString = ":ss";
            } else {
                secondString = "";
            }
            return this.datetimeFormat(value, "HH:mm" + secondString);
        },

        /**
         * Return a value in a custom format
         * @param {any} value Value to format
         * @param {any} format Format to return value in
         * @returns {string} Formatted string
         */
        datetimeFormat(value, format) {
            if (value !== undefined && value !== "") {
                return dayjs.utc(value).tz(this.timezone).format(format);
            }
            return "";
        },

        /**
         * Build the chart.js `time` scale configuration for the ping chart.
         *
         * The chart x values are converted with datetime()/datetimeFormat(),
         * i.e. parsed and rendered in the selected local timezone, so the scale
         * only has to choose units/ticks appropriate to the aggregation level.
         * @param {"minute" | "hour" | "day" | "recent"} type Aggregation level
         * returned by the server ("minute"/"hour"/"day") or "recent" for the
         * live heartbeat feed
         * @returns {object} chart.js time scale configuration
         */
        chartTimeScaleOption(type) {
            switch (type) {
                case "minute":
                    // Recent few hours up to 24h: show hours and minutes
                    return {
                        minUnit: "minute",
                        tooltipFormat: "YYYY-MM-DD HH:mm",
                        displayFormats: {
                            minute: "HH:mm",
                            hour: "MM-DD HH:mm",
                        },
                    };
                case "hour":
                    // Up to 30 days: show day and hour
                    return {
                        minUnit: "hour",
                        tooltipFormat: "YYYY-MM-DD HH:00",
                        displayFormats: {
                            hour: "MM-DD HH:mm",
                            day: "MM-DD",
                        },
                    };
                case "day":
                    // Up to 1 year: one tick per day
                    return {
                        minUnit: "day",
                        tooltipFormat: "YYYY-MM-DD",
                        displayFormats: {
                            day: "YYYY-MM-DD",
                            week: "YYYY-MM-DD",
                            month: "YYYY-MM",
                        },
                    };
                case "recent":
                default:
                    // Live heartbeat feed, same as the original chart
                    return {
                        minUnit: "minute",
                        round: "second",
                        tooltipFormat: "YYYY-MM-DD HH:mm:ss",
                        displayFormats: {
                            minute: "HH:mm",
                            hour: "MM-DD HH:mm",
                        },
                    };
            }
        },
    },

    computed: {
        timezone() {
            if (this.userTimezone === "auto") {
                return dayjs.tz.guess();
            }

            return this.userTimezone;
        },
    }

};
