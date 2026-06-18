/**
 * Pre-build step: install Playwright's Chromium into playwright-core/.local-browsers/
 * so electron-builder can bundle it inside the packaged app.
 *
 * Run automatically via "prebuild" / "predist" npm hooks.
 * Can also be run manually:  node scripts/install-browsers.js
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

// PLAYWRIGHT_BROWSERS_PATH=0  →  browsers go into playwright-core/.local-browsers/
// electron-builder's  node_modules/**/*  glob picks that up automatically.
process.env.PLAYWRIGHT_BROWSERS_PATH = '0';

console.log('[pre-build] Installing Playwright Chromium into playwright-core package...');
console.log('[pre-build] This may take a few minutes on first run (~170 MB).\n');

try {
    execSync('npx playwright install chromium', {
        stdio: 'inherit',
        env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: '0' }
    });

    // Verify
    const browsersDir = path.join(__dirname, '..', 'node_modules', 'playwright-core', '.local-browsers');
    if (fs.existsSync(browsersDir)) {
        const installed = fs.readdirSync(browsersDir);
        console.log(`\n[pre-build] Browsers bundled: ${installed.join(', ')}`);
    }

    console.log('[pre-build] Done. Proceeding with electron-builder...\n');
} catch (err) {
    console.error('[pre-build] Failed to install Playwright browsers:', err.message);
    process.exit(1);
}
