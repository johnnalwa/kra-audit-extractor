export const AUTOMATION_DEFAULTS = {
  concurrency: 4,
  maxConcurrency: 12,
  headless: false,
  slowMo: 100,
  maxRetries: 3,
  navigationTimeout: 180000,
  actionTimeout: 90000,
  continueOnError: true,
  runInBackground: true
};

function toBoolean(value, fallback) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (value.toLowerCase() === 'true') return true;
    if (value.toLowerCase() === 'false') return false;
  }
  return fallback;
}

function toNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function clampConcurrency(value, max = AUTOMATION_DEFAULTS.maxConcurrency) {
  const requested = Math.round(toNumber(value, AUTOMATION_DEFAULTS.concurrency));
  return Math.max(1, Math.min(requested, max));
}

export function resolveAutomationSettings(overrides = {}) {
  const maxConcurrency = Math.max(1, Math.min(
    toNumber(process.env.KRA_MAX_CONCURRENCY, AUTOMATION_DEFAULTS.maxConcurrency),
    AUTOMATION_DEFAULTS.maxConcurrency
  ));

  const settings = {
    concurrency: clampConcurrency(
      overrides.concurrency ?? process.env.KRA_AUTOMATION_CONCURRENCY,
      maxConcurrency
    ),
    maxConcurrency,
    headless: toBoolean(
      overrides.headless ?? process.env.KRA_AUTOMATION_HEADLESS,
      AUTOMATION_DEFAULTS.headless
    ),
    slowMo: Math.max(0, toNumber(
      overrides.slowMo ?? process.env.KRA_AUTOMATION_SLOW_MO,
      AUTOMATION_DEFAULTS.slowMo
    )),
    maxRetries: Math.max(1, Math.min(
      toNumber(overrides.maxRetries ?? process.env.KRA_AUTOMATION_MAX_RETRIES, AUTOMATION_DEFAULTS.maxRetries),
      10
    )),
    navigationTimeout: Math.max(30000, toNumber(
      overrides.navigationTimeout ?? process.env.KRA_AUTOMATION_NAVIGATION_TIMEOUT,
      AUTOMATION_DEFAULTS.navigationTimeout
    )),
    actionTimeout: Math.max(10000, toNumber(
      overrides.actionTimeout ?? process.env.KRA_AUTOMATION_ACTION_TIMEOUT,
      AUTOMATION_DEFAULTS.actionTimeout
    )),
    continueOnError: toBoolean(
      overrides.continueOnError ?? process.env.KRA_AUTOMATION_CONTINUE_ON_ERROR,
      AUTOMATION_DEFAULTS.continueOnError
    ),
    runInBackground: toBoolean(
      overrides.runInBackground,
      AUTOMATION_DEFAULTS.runInBackground
    )
  };

  return settings;
}
