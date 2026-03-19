/**
 * Utility functions for the sample project.
 */

function formatDate(date) {
    return date.toISOString();
}

function parseConfig(configStr) {
    return JSON.parse(configStr);
}

const processData = (data) => {
    const config = parseConfig(data.config);
    return { ...data, config, timestamp: formatDate(new Date()) };
};
