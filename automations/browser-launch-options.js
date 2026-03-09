function isHeadlessEnabled(config) {
    if (typeof config?.browserSettings?.headless === 'boolean') {
        return config.browserSettings.headless;
    }

    if (typeof config?.headless === 'boolean') {
        return config.headless;
    }

    return false;
}

function getBrowserLaunchOptions(config, overrides = {}) {
    const launchOptions = {
        channel: 'chrome',
        ...overrides
    };

    if (typeof launchOptions.headless !== 'boolean') {
        launchOptions.headless = isHeadlessEnabled(config);
    }

    return launchOptions;
}

module.exports = {
    getBrowserLaunchOptions,
    isHeadlessEnabled
};
