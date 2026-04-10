"use strict";

const dataProvider = require("./dataProvider");

function getAlerts(options = {}) {
    return dataProvider.generateData(options).alerts;
}

function getLogs(options = {}) {
    return dataProvider.generateData(options).logs;
}

module.exports = {
    STATIC_FLAG: dataProvider.STATIC_FLAG,
    getAlerts,
    getLogs
};
