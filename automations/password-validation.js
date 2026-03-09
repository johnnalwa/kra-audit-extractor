const { chromium } = require('playwright');
const { createWorker } = require('tesseract.js');
const ExcelJS = require('exceljs');
const path = require('path');
const fs = require('fs').promises;
const os = require('os');
const { solveArithmetic, withCaptchaRetry, hasArithmeticError } = require('./captcha-retry-helper');
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

async function validateKRACredentials(pin, password, companyName, progressCallback, browserOptions = {}) {
    let browser = null;
    let context = null;
    let page = null;

    try {
        progressCallback({
            stage: 'Password Validation',
            message: 'Initializing browser...',
            progress: 10
        });

        // Launch browser
        browser = await chromium.launch(getBrowserLaunchOptions(browserOptions, {
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        }));

        context = await browser.newContext();
        page = await context.newPage();

        progressCallback({
            progress: 20,
            log: 'Browser launched, navigating to KRA portal...'
        });

        // Navigate to KRA portal
        await page.goto("https://itax.kra.go.ke/KRA-Portal/");
        await page.waitForTimeout(2000);

        progressCallback({
            progress: 30,
            log: 'Entering credentials...'
        });

        // Enter PIN
        await page.locator("#logid").click();
        await page.locator("#logid").fill(pin);

        // Check for "You have not updated your details in iTax" message
        const detailsNotUpdated = await page.waitForSelector('b:has-text("You have not updated your details in iTax.")', {
            timeout: 1000,
            state: "visible"
        }).catch(() => false);

        if (detailsNotUpdated) {
            return {
                success: true,
                status: "Pending Update",
                message: "You have not updated your details in iTax"
            };
        }

        // Wait for PIN validation  
        await page.waitForTimeout(1000);
        
        try {
            await page.evaluate(() => {
                if (typeof CheckPIN === 'function') {
                    CheckPIN();
                }
            });
        } catch (error) {
            progressCallback({
                log: 'CheckPIN function not available, continuing...',
                logType: 'warning'
            });
        }

        // Enter password
        await page.locator('input[name="xxZTT9p2wQ"]').fill(password);
        await page.waitForTimeout(500);

        progressCallback({
            progress: 50,
            log: 'Solving CAPTCHA...'
        });

        // Solve CAPTCHA with retry logic
        const captchaResult = await withCaptchaRetry(
            async () => await solveCaptcha(page, progressCallback),
            3,
            progressCallback
        );
        await page.type("#captcahText", captchaResult);
        await page.click("#loginButton");

        progressCallback({
            progress: 80,
            log: 'Validating login response...'
        });

        // Wait for response
        await page.waitForTimeout(3000);

        // Check login status
        const result = await checkLoginStatus(page);

        progressCallback({
            progress: 100,
            log: `Validation complete: ${result.status}`,
            logType: result.status === 'Valid' ? 'success' : 'warning'
        });

        return {
            success: true,
            ...result
        };

    } catch (error) {
        console.error('[Password Validation] Error:', error);
        progressCallback({
            log: `Validation error: ${error.message}`,
            logType: 'error'
        });

        // Keep browser open for 5 seconds in case of error so user can see what happened
        if (page) {
            await page.waitForTimeout(5000).catch(() => {});
        }

        return {
            success: false,
            error: error.message,
            stack: error.stack
        };

    } finally {
        // Cleanup
        console.log('[Password Validation] Cleaning up browser resources...');
        if (page) await page.close().catch(() => {});
        if (context) await context.close().catch(() => {});
        if (browser) await browser.close().catch(() => {});
    }
}

async function solveCaptcha(page, progressCallback) {
    // Use system temp directory like agent-checker (more reliable in production)
    const tempDir = path.join(os.tmpdir(), 'KRA');
    const imagePath = path.join(tempDir, `captcha_password_${Date.now()}.png`);
    
    console.log('[CAPTCHA Solver] Starting captcha solving...');
    console.log('[CAPTCHA Solver] Image path:', imagePath);
    
    // Ensure temp directory exists
    await fs.mkdir(tempDir, { recursive: true });

    try {
        console.log('[CAPTCHA Solver] Waiting for captcha image selector...');
        await page.waitForSelector("#captcha_img", { timeout: 10000 });
        
        console.log('[CAPTCHA Solver] Taking screenshot...');
        await page.locator("#captcha_img").first().screenshot({ path: imagePath });
        console.log('[CAPTCHA Solver] Screenshot saved');

        console.log('[CAPTCHA Solver] Creating Tesseract worker...');
        const worker = await createWorker('eng', 1);
        console.log('[CAPTCHA Solver] Worker created, recognizing image...');
        
        const ret = await worker.recognize(imagePath);
        console.log('[CAPTCHA Solver] Recognition complete');
        
        const text1 = ret.data.text.slice(0, -1);
        const text = text1.slice(0, -1);
        const numbers = text.match(/\d+/g);

        if (!numbers || numbers.length < 2) {
            throw new Error("Unable to extract valid numbers from CAPTCHA");
        }

        // Use helper function to solve arithmetic (supports +, -, *)
        const result = solveArithmetic(text);

        await worker.terminate();
        console.log('[CAPTCHA Solver] Worker terminated');
        
        // Clean up temp file
        try {
            await fs.unlink(imagePath);
            console.log('[CAPTCHA Solver] Deleted temp image:', imagePath);
        } catch (error) {
            console.error('[CAPTCHA Solver] Error deleting temp image:', error.message);
        }

        progressCallback({
            log: `CAPTCHA solved: ${numbers[0]} ${text.includes("+") ? "+" : "-"} ${numbers[1]} = ${result}`
        });

        console.log('[CAPTCHA Solver] CAPTCHA result:', result.toString());
        return result.toString();

    } catch (error) {
        console.error('[CAPTCHA Solver] Error:', error);
        // Clean up temp file on error
        await fs.unlink(imagePath).catch(() => {});
        throw error;
    }
}

async function checkLoginStatus(page) {
    // Check if login was successful (look for main menu)
    const mainMenu = await page.waitForSelector("#ddtopmenubar > ul > li:nth-child(1) > a", {
        timeout: 3000,
        state: "visible"
    }).catch(() => false);

    if (mainMenu) {
        return { status: "Valid", message: "Login successful" };
    }

    // Check for password expired
    const passwordExpired = await page.waitForSelector('.formheading:has-text("YOUR PASSWORD HAS EXPIRED!")', {
        timeout: 1000,
        state: "visible"
    }).catch(() => false);

    if (passwordExpired) {
        return { status: "Password Expired", message: "Password has expired" };
    }

    // Check for account locked
    const accountLocked = await page.waitForSelector('b:has-text("The account has been locked.")', {
        timeout: 1000,
        state: "visible"
    }).catch(() => false);

    if (accountLocked) {
        return { status: "Locked", message: "Account has been locked" };
    }

    // Check for cancelled user
    const cancelledUser = await page.waitForSelector('b:has-text("User has been cancelled.")', {
        timeout: 1000,
        state: "visible"
    }).catch(() => false);

    if (cancelledUser) {
        return { status: "Cancelled", message: "User has been cancelled" };
    }

    // Check for invalid login
    const invalidLogin = await page.waitForSelector('b:has-text("Invalid Login Id or Password.")', {
        timeout: 1000,
        state: "visible"
    }).catch(() => false);

    if (invalidLogin) {
        return { status: "Invalid", message: "Invalid login ID or password" };
    }

    // Check for wrong captcha
    const wrongCaptcha = await page.waitForSelector('b:has-text("Wrong result of the arithmetic operation.")', {
        timeout: 1000,
        state: "visible"
    }).catch(() => false);

    if (wrongCaptcha) {
        return { status: "Captcha Error", message: "Wrong CAPTCHA result" };
    }

    return { status: "Unknown", message: "Unable to determine login status" };
}

async function runPasswordValidation(company, downloadPath, progressCallback) {
    try {
        progressCallback({
            stage: 'Password Validation Report',
            message: 'Creating password validation report...',
            progress: 0
        });

        // Create download folder
        const now = new Date();
        const formattedDateTime = `${now.getDate()}.${now.getMonth() + 1}.${now.getFullYear()}`;
        const reportDownloadPath = downloadPath || path.join(require('os').homedir(), 'Downloads', `KRA-PASSWORD-VALIDATION-${formattedDateTime}`);
        await fs.mkdir(reportDownloadPath, { recursive: true });

        progressCallback({
            progress: 20,
            log: `Download folder created: ${reportDownloadPath}`
        });

        // Validate credentials
        const validationResult = await validateKRACredentials(
            company.pin, 
            company.password, 
            company.name, 
            (progress) => {
                // Forward progress with adjusted percentage
                progressCallback({
                    ...progress,
                    progress: 20 + (progress.progress || 0) * 0.6 // 20-80% range
                });
            },
            company
        );

        progressCallback({
            progress: 85,
            log: 'Creating Excel report...'
        });

        // Create Excel report
        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Password Validation');

        // Add title
        worksheet.mergeCells('A1:E1');
        const titleCell = worksheet.getCell('A1');
        titleCell.value = 'KRA iTax PASSWORD VALIDATION REPORT';
        titleCell.font = { size: 16, bold: true };
        titleCell.alignment = { horizontal: 'center' };
        titleCell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FF4F81BD' }
        };
        titleCell.font.color = { argb: 'FFFFFFFF' };

        // Add timestamp
        worksheet.mergeCells('A2:E2');
        const timestampCell = worksheet.getCell('A2');
        timestampCell.value = `Generated on: ${new Date().toLocaleString()}`;
        timestampCell.font = { size: 12, italic: true };
        timestampCell.alignment = { horizontal: 'center' };

        // Add empty row
        worksheet.addRow([]);

        // Add headers
        const headers = ["Company Name", "KRA PIN", "Status", "Details", "Validation Time"];
        const headerRow = worksheet.addRow(headers);
        headerRow.font = { bold: true };
        headerRow.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFD3D3D3' }
        };

        // Add data row
        const dataRow = worksheet.addRow([
            company.name,
            company.pin,
            validationResult.success ? validationResult.status : 'Error',
            validationResult.success ? validationResult.message : validationResult.error,
            new Date().toLocaleString()
        ]);

        // Color code based on status
        const statusCell = dataRow.getCell(3);
        const detailsCell = dataRow.getCell(4);
        
        let fillColor;
        if (validationResult.success && validationResult.status === "Valid") {
            fillColor = "FF99FF99"; // Light Green
        } else if (validationResult.success && validationResult.status === "Invalid") {
            fillColor = "FFFF9999"; // Light Red
        } else if (validationResult.success && validationResult.status === "Password Expired") {
            fillColor = "FFFFCC00"; // Orange
        } else {
            fillColor = "FFFFE066"; // Light Yellow
        }

        [statusCell, detailsCell].forEach(cell => {
            cell.fill = {
                type: "pattern",
                pattern: "solid",
                fgColor: { argb: fillColor }
            };
        });

        // Add borders to all cells
        worksheet.eachRow((row) => {
            row.eachCell((cell) => {
                cell.border = {
                    top: { style: 'thin' },
                    left: { style: 'thin' },
                    bottom: { style: 'thin' },
                    right: { style: 'thin' }
                };
            });
        });

        // Auto-fit columns
        worksheet.columns.forEach(column => {
            let maxLength = 0;
            column.eachCell({ includeEmpty: true }, cell => {
                if (cell.value) {
                    const length = cell.value.toString().length;
                    if (length > maxLength) {
                        maxLength = length;
                    }
                }
            });
            column.width = Math.min(Math.max(maxLength + 2, 15), 50);
        });

        // Save Excel file
        const fileName = `PASSWORD_VALIDATION_${company.pin}_${formattedDateTime}.xlsx`;
        const filePath = path.join(reportDownloadPath, fileName);
        await workbook.xlsx.writeFile(filePath);

        progressCallback({
            progress: 100,
            log: `Password validation report saved: ${fileName}`,
            logType: 'success'
        });

        return {
            success: true,
            result: validationResult,
            files: [fileName],
            filePath: filePath,
            downloadPath: reportDownloadPath
        };

    } catch (error) {
        progressCallback({
            log: `Error creating password validation report: ${error.message}`,
            logType: 'error'
        });

        return {
            success: false,
            error: error.message
        };
    }
}

// Export password validation to a shared workbook as a sheet
async function exportPasswordValidationToSheet(workbookManager, validationResult) {
    const worksheet = workbookManager.addWorksheet('Password Validation');
    
    // Add title
    workbookManager.addTitleRow(worksheet, 'KRA Password Validation Report', `Validation Time: ${new Date().toLocaleString()}`);
    
    // Add company info
    workbookManager.addCompanyInfoRow(worksheet);

    // Add headers
    workbookManager.addHeaderRow(worksheet, ['Status', 'Details']);

    // Add data row
    const status = validationResult.success ? validationResult.status : 'Error';
    const details = validationResult.success ? validationResult.message : validationResult.error;
    
    const dataRow = worksheet.addRow(['', status, details]);
    
    // Color code based on status
    const statusCell = dataRow.getCell('B');
    const detailsCell = dataRow.getCell('C');
    
    let fillColor;
    if (validationResult.success && validationResult.status === "Valid") {
        fillColor = "FF99FF99"; // Light Green
    } else if (validationResult.success && validationResult.status === "Invalid") {
        fillColor = "FFFF9999"; // Light Red
    } else if (validationResult.success && validationResult.status === "Password Expired") {
        fillColor = "FFFFCC00"; // Orange
    } else {
        fillColor = "FFFFE066"; // Light Yellow
    }

    [statusCell, detailsCell].forEach(cell => {
        cell.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: fillColor }
        };
        cell.border = {
            top: { style: 'medium' },
            left: { style: 'medium' },
            bottom: { style: 'medium' },
            right: { style: 'medium' }
        };
        cell.alignment = { vertical: 'middle', wrapText: true };
        cell.font = { size: 11 };
    });
    
    // Add spacing after data
    worksheet.addRow([]);

    workbookManager.autoFitColumns(worksheet);
    
    return worksheet;
}

// Validate and export to consolidated workbook
async function validateAndExportToConsolidated(company, downloadPath, progressCallback) {
    try {
        progressCallback({ log: 'Initializing consolidated workbook...' });
        
        // Initialize shared workbook manager
        const SharedWorkbookManager = require('./shared-workbook-manager');
        const workbookManager = new SharedWorkbookManager(company, downloadPath);
        const companyFolder = await workbookManager.initialize();
        
        progressCallback({ log: `Company folder: ${companyFolder}` });
        progressCallback({ log: 'Validating credentials...' });
        
        // Validate credentials
        const validationResult = await validateKRACredentials(
            company.pin, 
            company.password, 
            company.name, 
            progressCallback,
            company
        );
        
        progressCallback({ log: 'Adding validation result to consolidated report...' });
        
        // Export to sheet
        await exportPasswordValidationToSheet(workbookManager, validationResult);
        
        // Save the workbook
        const savedWorkbook = await workbookManager.save();
        
        progressCallback({ log: `Report saved: ${savedWorkbook.fileName}` });
        
        return {
            success: validationResult.success,
            status: validationResult.status,
            message: validationResult.message,
            filePath: savedWorkbook.filePath,
            fileName: savedWorkbook.fileName,
            companyFolder: savedWorkbook.companyFolder
        };
    } catch (error) {
        progressCallback({ log: `Error: ${error.message}`, logType: 'error' });
        return {
            success: false,
            error: error.message
        };
    }
}

module.exports = {
    validateKRACredentials,
    runPasswordValidation,
    exportPasswordValidationToSheet,
    validateAndExportToConsolidated
};
