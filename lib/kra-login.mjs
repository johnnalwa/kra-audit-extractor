import { chromium, firefox } from 'playwright';
import { createWorker } from 'tesseract.js';
import os from 'os';
import path from 'path';
import { existsSync, unlinkSync } from 'fs';
import { fileURLToPath } from 'url';
import { logger } from './logger.mjs';
import { AUTOMATION_DEFAULTS } from './automation-config.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * KRA Portal Login - Reusable login class for all KRA automations.
 * Returns an authenticated { page, browser, context } session.
 */
export class KraLogin {
  constructor(options = {}) {
    this.maxCaptchaRetries = options.maxCaptchaRetries || 10;
    this.navigationTimeout = options.navigationTimeout || AUTOMATION_DEFAULTS.navigationTimeout;
    this.actionTimeout = options.actionTimeout || AUTOMATION_DEFAULTS.actionTimeout;
    this.headless = options.headless ?? AUTOMATION_DEFAULTS.headless;
    this.slowMo = options.slowMo ?? AUTOMATION_DEFAULTS.slowMo;
    this.browserName = options.browserName || process.env.KRA_AUTOMATION_BROWSER || 'chromium';
    this.browserChannel = options.browserChannel ?? process.env.KRA_AUTOMATION_BROWSER_CHANNEL ?? 'chrome';
  }

  /**
   * Launch browser and login to KRA Portal.
   * @param {string} pin - KRA PIN
   * @param {string} password - KRA password
   * @param {string} [companyName='Unknown'] - Company name for logging
   * @returns {{ success: boolean, page, browser, context, pin, companyName, message: string }}
   */
  async login(pin, password, companyName = 'Unknown') {
    let attempt = 0;
    let browser = null;

    try {
      browser = await this._launchBrowser();

      const context = await browser.newContext({
        userAgent: this.browserName === 'firefox'
          ? 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:123.0) Gecko/20100101 Firefox/123.0'
          : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        viewport: { width: 1280, height: 720 }
      });

      const page = await context.newPage();
      await page.addInitScript(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      });
      page.setDefaultNavigationTimeout(this.navigationTimeout);
      page.setDefaultTimeout(this.actionTimeout);

      while (attempt < this.maxCaptchaRetries) {
        attempt++;
        let worker = null;
        let imagePath = null;

        try {
          logger.info(`[${companyName}] Login attempt ${attempt}/${this.maxCaptchaRetries}...`);

          // Navigate to KRA Portal
          await page.goto('https://itax.kra.go.ke/KRA-Portal/', {
            waitUntil: 'domcontentloaded',
            timeout: 30000
          });
          await page.waitForTimeout(1000);

          // Fill PIN - FAST
          const pinSelector = (await page.locator('#logid').isVisible().catch(() => false))
            ? '#logid'
            : '#userName';
          await page.locator(pinSelector).waitFor({ state: 'visible', timeout: 10000 });
          await page.locator(pinSelector).click();
          await page.locator(pinSelector).fill(pin);
          await page.evaluate(() => {
            if (typeof CheckPIN === 'function') CheckPIN();
          }).catch(() => {});
          await page.locator(pinSelector).press('Enter').catch(() => {});
          await page.waitForTimeout(800);
          logger.info(`[${companyName}] PIN entered`);

          // Click continue if available - FAST
          const continueLink = page.getByRole('link', { name: 'Continue' });
          if (await continueLink.isVisible().catch(() => false)) {
            await continueLink.click();
            await page.waitForTimeout(500);
          }

          // Fill password - FAST
          const passwordInput = page.locator('input[name="xxZTT9p2wQ"]').first();
          if (!(await passwordInput.isVisible().catch(() => false))) {
            await page.evaluate(() => {
              if (typeof CheckPIN === 'function') CheckPIN();
            }).catch(() => {});
          }
          await passwordInput.waitFor({ state: 'visible', timeout: 10000 });
          await passwordInput.click();
          await passwordInput.fill(password);
          await page.waitForTimeout(300);
          logger.info(`[${companyName}] Password entered`);

          // Solve CAPTCHA - wait for image to fully load
          logger.info(`[${companyName}] Solving CAPTCHA...`);
          const image = await page.waitForSelector('#captcha_img', { timeout: 10000 });
          await page.waitForTimeout(1000); // Wait for CAPTCHA image to fully render

          const cleanPin = pin.trim().replace(/\s+/g, '_');
          const timestamp = Date.now();
          imagePath = path.join(os.tmpdir(), `ocr_${cleanPin}_${timestamp}.png`);

          // Screenshot with dimension check
          await image.screenshot({ path: imagePath });
          const boundingBox = await image.boundingBox();
          if (boundingBox) {
            logger.info(`[${companyName}] CAPTCHA image: ${boundingBox.width}x${boundingBox.height}`);
            if (boundingBox.width < 50 || boundingBox.height < 15) {
              logger.warn(`[${companyName}] CAPTCHA image too small, retrying...`);
              this._cleanupFileSync(imagePath);
              imagePath = null;
              continue;
            }
          }

          // Verify file was created
          if (!existsSync(imagePath)) {
            logger.warn(`[${companyName}] Screenshot file not created, retrying...`);
            continue;
          }

          // OCR with same config as pin-checker-details
          worker = await createWorker('eng', 1, {
            logger: () => {},
            errorHandler: err => logger.error(`[${companyName}] Tesseract error: ${err}`)
          });

          const ret = await worker.recognize(imagePath);
          await worker.terminate();
          worker = null;

          // Use same text processing as pin-checker-details.js
          const text1 = ret.data.text.slice(0, -1);
          const text = text1.slice(0, -1);
          logger.info(`[${companyName}] OCR Text: "${text}"`);

          // Immediately clean up temp file
          this._cleanupFileSync(imagePath);
          imagePath = null;

          // Extract numbers
          const numbers = text.match(/\d+/g);
          if (!numbers || numbers.length < 2) {
            logger.warn(`[${companyName}] Could not extract numbers from CAPTCHA`);
            continue;
          }

          // Calculate result
          let result;
          if (text.includes('+')) {
            result = Number(numbers[0]) + Number(numbers[1]);
            logger.info(`[${companyName}] ${numbers[0]} + ${numbers[1]} = ${result}`);
          } else if (text.includes('-')) {
            result = Number(numbers[0]) - Number(numbers[1]);
            logger.info(`[${companyName}] ${numbers[0]} - ${numbers[1]} = ${result}`);
          } else {
            logger.warn(`[${companyName}] No operator found in CAPTCHA, retrying...`);
            continue;
          }

          // Fill CAPTCHA using direct selector - FAST
          const captchaInput = page.locator('#captcahText');
          await captchaInput.waitFor({ state: 'visible', timeout: 5000 });
          await captchaInput.clear();
          await captchaInput.fill(result.toString());
          await page.waitForTimeout(200);

          // Verify value was entered
          const captchaValue = await captchaInput.inputValue();
          logger.info(`[${companyName}] CAPTCHA filled: ${result} (verified: ${captchaValue})`);

          // Click login - FAST
          await page.locator('#loginButton').click();
          await page.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {});
          await page.waitForTimeout(600);

          // Check for errors
          const isInvalidCaptcha = await page
            .locator('b:has-text("Wrong result of the arithmetic operation.")')
            .isVisible()
            .catch(() => false);

          if (isInvalidCaptcha) {
            logger.warn(`[${companyName}] Wrong CAPTCHA result, retrying...`);
            continue;
          }

          const isInvalidPassword = await page
            .locator('b:has-text("Invalid Password.")')
            .isVisible()
            .catch(() => false);

          if (isInvalidPassword) {
            throw new Error('Invalid Password');
          }

          logger.info(`[${companyName}] Successfully logged in`);
          return { success: true, page, browser, context, pin, companyName, message: 'Logged in' };

        } catch (error) {
          if (error.message === 'Invalid Password') throw error;
          if (attempt >= this.maxCaptchaRetries) throw error;
          logger.warn(`[${companyName}] Attempt ${attempt} failed: ${error.message}`);
          await page.waitForTimeout(2000);
        } finally {
          if (worker) await worker.terminate().catch(() => {});
          if (imagePath) this._cleanupFileSync(imagePath);
        }
      }

      throw new Error(`Failed to login after ${this.maxCaptchaRetries} attempts`);

    } catch (error) {
      if (browser) await browser.close();
      logger.error(`[${companyName}] Login error: ${error.message}`);
      throw error;
    }
  }

  async _launchBrowser() {
    const launchOptions = {
      headless: this.headless,
      slowMo: this.slowMo || 100
    };

    if (this.browserName === 'firefox') {
      return firefox.launch(launchOptions);
    }

    try {
      return await chromium.launch({
        ...launchOptions,
        channel: this.browserChannel || undefined,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-blink-features=AutomationControlled'
        ]
      });
    } catch (error) {
      logger.warn(`[KraLogin] Chrome launch failed (${error.message}); trying bundled Chromium.`);
      return chromium.launch({
        ...launchOptions,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
      });
    }
  }

  _cleanupFileSync(filePath) {
    try {
      if (filePath && existsSync(filePath)) unlinkSync(filePath);
    } catch (_) { /* ignore */ }
  }
}
