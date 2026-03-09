const { chromium } = require('playwright');
const { createWorker } = require('tesseract.js');
const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const SharedWorkbookManager = require('./shared-workbook-manager');
const { getBrowserLaunchOptions } = require('./browser-launch-options');

// KRA API Headers - Comprehensive browser-like headers
const KRA_API_HEADERS = {
    'Accept': 'application/json, text/javascript, */*; q=0.01',
    'Accept-Language': 'en-US,en;q=0.9,sw;q=0.8',
    'Connection': 'keep-alive',
    'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
    'Origin': 'https://itax.kra.go.ke',
    'Referer': 'https://itax.kra.go.ke/KRA-Portal/',
    'Sec-Fetch-Dest': 'empty',
    'Sec-Fetch-Mode': 'cors',
    'Sec-Fetch-Site': 'same-origin',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36',
    'X-Requested-With': 'XMLHttpRequest',
    'sec-ch-ua': '"Chromium";v="136", "Google Chrome";v="136", "Not.A/Brand";v="99"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"'
};

/**
 * Agent types for KRA withholding verification
 */
const AGENT_TYPES = {
    VAT: 'V',
    RENT: 'W'
};

/**
 * Configuration
 */
const CONFIG = {
    MAX_CAPTCHA_RETRIES: 3,
    CAPTCHA_RETRY_DELAY: 2000,
    REQUEST_DELAY: 3000
};

/**
 * Solves the CAPTCHA challenge using OCR
 */
async function solveCaptcha(page, pin) {
    const randomId = Math.floor(Math.random() * 10000);
    const tempDir = path.join(os.tmpdir(), 'KRA');
    const imagePath = path.join(tempDir, `ocr_${randomId}.png`);
    
    // Ensure directory exists
    await fs.mkdir(tempDir, { recursive: true });
    
    // Wait for captcha image and use .first() to handle multiple elements
    await page.waitForSelector("#captcha_img", { timeout: 10000 });
    await page.locator("#captcha_img").first().screenshot({ path: imagePath });

    const worker = await createWorker('eng', 1);
    console.log(`[Worker ${randomId}] Extracting Text...`);
    let result;

    const extractResult = async () => {
        const ret = await worker.recognize(imagePath);
        const text1 = ret.data.text.slice(0, -1);
        const text = text1.slice(0, -1);
        const numbers = text.match(/\d+/g);
        console.log(`[Worker ${randomId}] Extracted Numbers:`, numbers);

        if (!numbers || numbers.length < 2) {
            throw new Error("Unable to extract valid numbers from the text.");
        }

        if (text.includes("+")) {
            result = Number(numbers[0]) + Number(numbers[1]);
        } else if (text.includes("-")) {
            result = Number(numbers[0]) - Number(numbers[1]);
        } else {
            throw new Error("Unsupported operator.");
        }
    };

    let attempts = 0;
    const maxAttempts = 5;

    while (attempts < maxAttempts) {
        try {
            await extractResult();
            break;
        } catch (error) {
            console.log(`[Worker ${randomId}] Re-extracting text from image...`);
            attempts++;
            if (attempts < maxAttempts) {
                await page.waitForTimeout(1000);
                await page.locator("#captcha_img").first().screenshot({ path: imagePath });
                continue;
            } else {
                throw new Error("Failed to extract captcha after multiple attempts");
            }
        }
    }

    console.log(`[Worker ${randomId}] Captcha Result:`, result.toString());
    await worker.terminate();
    
    // Delete the OCR image after processing
    try {
        await fs.unlink(imagePath);
        console.log(`[Worker ${randomId}] Deleted OCR image: ${imagePath}`);
    } catch (error) {
        console.error(`[Worker ${randomId}] Error deleting OCR image: ${error.message}`);
    }
    
    return result.toString();
}

/**
 * Checks if a PIN is registered as a withholding agent with CAPTCHA retry logic
 */
async function checkWithholdingAgent(page, pin, agentType, progressCallback) {
    const agentTypeName = agentType === AGENT_TYPES.VAT ? 'VAT' : 'Rent Income';
    console.log(`\n🔍 Checking ${agentTypeName} Withholding Agent status for PIN: ${pin}`);
    
    if (progressCallback) {
        progressCallback({
            status: 'processing',
            message: `Checking ${agentTypeName} Withholding Agent status...`
        });
    }

    let captchaRetries = 0;
    let success = false;
    let result = null;

    // Navigate to agent checker (ONLY ONCE)
    try {
        await page.goto('https://itax.kra.go.ke/KRA-Portal/', {
            timeout: 60000,
            waitUntil: 'domcontentloaded'
        });

        await page.getByRole('cell', {
            name: 'Agent Checker To verify Witholding Agent,Click Here',
            exact: true
        }).getByRole('link').click();

        // Wait for page to load completely
        await page.waitForLoadState('networkidle', { timeout: 30000 });
        await page.waitForTimeout(2000);

        // Select agent type
        await page.getByLabel('Type Of Withholding Agent').selectOption(agentType);
        console.log(`   📋 Selected agent type: ${agentTypeName}`);

        // Enter PIN
        await page.getByRole('row', { name: 'PIN', exact: true }).getByRole('textbox').fill(pin);
        console.log(`   🔑 Entered PIN: ${pin}`);
        
        // Click Consult FIRST to trigger/refresh the captcha
        console.log(`   🎯 Clicking Consult to trigger captcha...`);
        await page.getByRole('button', { name: 'Consult' }).click();
        await page.waitForTimeout(1500);
        
        // Now wait for captcha to be ready
        await page.waitForSelector("#captcha_img", { timeout: 10000, state: "visible" });
        await page.waitForTimeout(500);
    } catch (navError) {
        console.error(`   ❌ Navigation error: ${navError.message}`);
        return {
            pin,
            agentType: agentTypeName,
            agentTypeCode: agentType,
            isRegistered: null,
            error: `Navigation failed: ${navError.message}`,
            captchaRetries: 0
        };
    }

    // CAPTCHA retry loop
    while (captchaRetries < CONFIG.MAX_CAPTCHA_RETRIES && !success) {
        try {
            if (captchaRetries > 0) {
                console.log(`   🔄 CAPTCHA Retry attempt ${captchaRetries}/${CONFIG.MAX_CAPTCHA_RETRIES}`);
                
                if (progressCallback) {
                    progressCallback({
                        status: 'processing',
                        message: `Retrying CAPTCHA (${captchaRetries}/${CONFIG.MAX_CAPTCHA_RETRIES})...`
                    });
                }
                
                await page.getByRole('button', { name: 'Consult' }).click();
                await page.waitForTimeout(1500);
                await page.waitForTimeout(CONFIG.CAPTCHA_RETRY_DELAY);
            }

            // Solve CAPTCHA
            const captchaResult = await solveCaptcha(page, pin);

            // Enter CAPTCHA result
            await page.fill('input[name="captcahText"]', captchaResult.toString());
            console.log(`   ✅ CAPTCHA solution entered: ${captchaResult}`);

            // Submit the form
            await page.getByRole('button', { name: 'Consult' }).click();
            console.log(`   🚀 Form submitted`);

            // Wait for response
            await page.waitForTimeout(1000);

            // Check for arithmetic error
            const wrongArithmetic = await page.waitForSelector('b:has-text("Wrong result of the arithmetic operation")', {
                timeout: 500,
                state: "visible"
            }).catch(() => false);

            if (wrongArithmetic) {
                console.log(`   ❌ Wrong arithmetic detected, retry attempt ${captchaRetries + 1}/${CONFIG.MAX_CAPTCHA_RETRIES}`);
                captchaRetries++;
                continue;
            }

            // Check for error message (not registered)
            const errorMessage = await page.waitForSelector('b:has-text("Sorry,The PIN")', {
                timeout: 2000,
                state: "visible"
            }).catch(() => false);

            if (errorMessage) {
                console.log(`   ❌ NOT registered as ${agentTypeName} Withholding Agent`);
                result = {
                    pin,
                    agentType: agentTypeName,
                    agentTypeCode: agentType,
                    isRegistered: false,
                    message: `PIN ${pin} is not registered as a ${agentTypeName} Withholding Agent`,
                    captchaRetries
                };
                success = true;
                break;
            }

            // Check for success indicators
            const taxpayerDetails = await page.getByText('Taxpayer Details').count();
            const payPointDetails = await page.getByText('Pay-Point Details').count();

            if (taxpayerDetails > 0 || payPointDetails > 0) {
                console.log(`   ✅ REGISTERED as ${agentTypeName} Withholding Agent`);

                // Extract additional details if available
                const details = await extractAgentDetails(page);

                result = {
                    pin,
                    agentType: agentTypeName,
                    agentTypeCode: agentType,
                    isRegistered: true,
                    message: `PIN ${pin} is registered as a ${agentTypeName} Withholding Agent`,
                    details,
                    captchaRetries
                };
                success = true;
                break;
            }

            // Fallback: Check page content for "not registered" text
            const pageText = await page.evaluate(() => document.body.innerText || document.body.textContent || '');
            const hasNotRegisteredText = pageText.toLowerCase().includes('not registered') || 
                                        pageText.toLowerCase().includes('sorry') ||
                                        pageText.includes(`Sorry,The PIN : ${pin}`);

            if (hasNotRegisteredText) {
                console.log(`   ❌ NOT registered as ${agentTypeName} Withholding Agent (found via text search)`);
                result = {
                    pin,
                    agentType: agentTypeName,
                    agentTypeCode: agentType,
                    isRegistered: false,
                    message: `PIN ${pin} is not registered as a ${agentTypeName} Withholding Agent`,
                    captchaRetries
                };
                success = true;
                break;
            }

            // If we get here, result is inconclusive
            console.log(`   ⚠️  Unable to determine registration status`);
            result = {
                pin,
                agentType: agentTypeName,
                agentTypeCode: agentType,
                isRegistered: null,
                message: `Unable to determine registration status for PIN ${pin}`,
                captchaRetries
            };
            success = true;
            break;

        } catch (error) {
            captchaRetries++;
            console.error(`   ❌ Error during attempt ${captchaRetries}: ${error.message}`);

            if (captchaRetries >= CONFIG.MAX_CAPTCHA_RETRIES) {
                console.error(`   ❌ Max retries reached for ${agentTypeName} agent check`);
                result = {
                    pin,
                    agentType: agentTypeName,
                    agentTypeCode: agentType,
                    isRegistered: null,
                    error: error.message,
                    captchaRetries
                };
                break;
            }
        }
    }

    return result;
}

/**
 * Extracts agent details from the results page
 */
async function extractAgentDetails(page) {
    try {
        const details = {};

        // Try to extract PIN number if visible
        const pinInput = await page.locator('input[name="vo\\.pinNo"]').inputValue().catch(() => null);
        if (pinInput) {
            details.confirmedPin = pinInput;
        }

        // Try to extract taxpayer name if available
        const taxpayerName = await page.locator('text=Taxpayer Name').locator('..').textContent().catch(() => null);
        if (taxpayerName) {
            details.taxpayerName = taxpayerName.replace('Taxpayer Name', '').trim();
        }

        return details;
    } catch (error) {
        console.log(`   ℹ️  Could not extract additional details: ${error.message}`);
        return {};
    }
}

async function exportAgentStatusToSheet(workbookManager, results) {
    const worksheet = workbookManager.addWorksheet('Withholding Agent Status');

    workbookManager.addTitleRow(
        worksheet,
        'Withholding Agent Status Report',
        `Checked: ${new Date(results.timestamp).toLocaleString()}`
    );
    workbookManager.addCompanyInfoRow(worksheet);
    workbookManager.addHeaderRow(worksheet, ['Agent Type', 'Status', 'CAPTCHA Retries', 'Message']);

    const rows = [
        [
            'VAT Withholding Agent',
            results.vat?.isRegistered === true ? 'Registered' : results.vat?.isRegistered === false ? 'Not Registered' : 'Unknown',
            results.vat?.captchaRetries || 0,
            results.vat?.message || results.vat?.error || 'No response'
        ],
        [
            'Rent Income Withholding Agent',
            results.rent?.isRegistered === true ? 'Registered' : results.rent?.isRegistered === false ? 'Not Registered' : 'Unknown',
            results.rent?.captchaRetries || 0,
            results.rent?.message || results.rent?.error || 'No response'
        ]
    ];

    workbookManager.addDataRows(worksheet, rows);

    const detailsRows = [];
    if (results.vat?.details?.confirmedPin || results.rent?.details?.confirmedPin) {
        detailsRows.push(['Confirmed PIN', results.vat?.details?.confirmedPin || results.rent?.details?.confirmedPin || 'N/A']);
    }
    if (results.vat?.details?.taxpayerName || results.rent?.details?.taxpayerName) {
        detailsRows.push(['Taxpayer Name', results.vat?.details?.taxpayerName || results.rent?.details?.taxpayerName || 'N/A']);
    }

    if (detailsRows.length > 0) {
        worksheet.addRow([]);
        workbookManager.addHeaderRow(worksheet, ['Detail', 'Value']);
        workbookManager.addDataRows(worksheet, detailsRows);
    }

    workbookManager.autoFitColumns(worksheet);
    return worksheet;
}

/**
 * Main function to check withholding agent status for a single company
 */
async function checkCompanyWithholdingStatus(company, downloadPath, progressCallback) {
    const pin = company.pin;
    const companyName = company.name || pin;

    console.log(`\n${'='.repeat(60)}`);
    console.log(`🏢 Starting Withholding Agent Check for: ${companyName}`);
    console.log(`${'='.repeat(60)}`);

    if (progressCallback) {
        progressCallback({
            status: 'processing',
            message: `Starting withholding agent check for ${companyName}...`
        });
    }

    // Launch browser with Chrome channel
    const browser = await chromium.launch(getBrowserLaunchOptions(company, {
        args: [
            '--disable-blink-features=AutomationControlled',
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage'
        ]
    }));

    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        viewport: { width: 1920, height: 1080 },
        locale: 'en-US'
    });

    const page = await context.newPage();

    const results = {
        pin,
        companyName,
        timestamp: new Date().toISOString(),
        vat: null,
        rent: null
    };

    try {
        // Check VAT withholding agent status
        if (progressCallback) {
            progressCallback({
                status: 'processing',
                message: 'Checking VAT Withholding Agent status...'
            });
        }
        
        results.vat = await checkWithholdingAgent(page, pin, AGENT_TYPES.VAT, progressCallback);
        
        // Go back to home page for next check
        console.log(`\n🏠 Going back to home page for next check...`);
        await page.goto('https://itax.kra.go.ke/KRA-Portal/', {
            timeout: 60000,
            waitUntil: 'domcontentloaded'
        });
        await page.waitForTimeout(CONFIG.REQUEST_DELAY);

        // Check Rent withholding agent status
        if (progressCallback) {
            progressCallback({
                status: 'processing',
                message: 'Checking Rent Income Withholding Agent status...'
            });
        }
        
        results.rent = await checkWithholdingAgent(page, pin, AGENT_TYPES.RENT, progressCallback);

        // Summary
        console.log(`\n${'='.repeat(60)}`);
        console.log(`📊 SUMMARY FOR PIN: ${pin}`);
        console.log(`${'='.repeat(60)}`);

        if (results.vat) {
            const vatStatus = results.vat.isRegistered ? '✅ YES' : results.vat.isRegistered === false ? '❌ NO' : '❓ UNKNOWN';
            console.log(`VAT Withholding Agent: ${vatStatus} (${results.vat.captchaRetries || 0} retries)`);
        }
        if (results.rent) {
            const rentStatus = results.rent.isRegistered ? '✅ YES' : results.rent.isRegistered === false ? '❌ NO' : '❓ UNKNOWN';
            console.log(`Rent Withholding Agent: ${rentStatus} (${results.rent.captchaRetries || 0} retries)`);
        }
        console.log(`${'='.repeat(60)}\n`);

        if (progressCallback) {
            progressCallback({
                status: 'complete',
                message: 'Withholding agent check completed successfully!'
            });
        }

        let savedWorkbook = null;
        if (downloadPath) {
            if (progressCallback) {
                progressCallback({
                    status: 'processing',
                    message: 'Saving Excel report...'
                });
            }

            const workbookManager = new SharedWorkbookManager(
                { ...company, name: companyName },
                downloadPath
            );
            await workbookManager.initialize();
            await exportAgentStatusToSheet(workbookManager, results);
            savedWorkbook = await workbookManager.save();
        }

        return {
            success: true,
            data: results,
            filePath: savedWorkbook?.filePath,
            fileName: savedWorkbook?.fileName,
            companyFolder: savedWorkbook?.companyFolder,
            files: savedWorkbook ? [savedWorkbook.fileName] : []
        };

    } catch (error) {
        console.error(`❌ Fatal error: ${error.message}`);
        results.error = error.message;
        
        if (progressCallback) {
            progressCallback({
                status: 'error',
                message: `Error: ${error.message}`
            });
        }

        return {
            success: false,
            error: error.message,
            data: results
        };
    } finally {
        await context.close();
        await browser.close();
    }
}

// Export for use in Electron app
module.exports = {
    checkCompanyWithholdingStatus,
    exportAgentStatusToSheet,
    AGENT_TYPES,
    CONFIG
};
