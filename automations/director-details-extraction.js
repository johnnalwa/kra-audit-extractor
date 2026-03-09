const { chromium } = require('playwright');
const ExcelJS = require('exceljs');
const path = require('path');
const fs = require('fs').promises;
const SharedWorkbookManager = require('./shared-workbook-manager');
const { getBrowserLaunchOptions } = require('./browser-launch-options');
const { createWorker } = require('tesseract.js');
const fetch = require('./electron-fetch-wrapper');  // Use Electron-safe fetch wrapper

// KRA API Headers - Comprehensive browser-like headers
const KRA_API_HEADERS = {
    'Accept': 'application/json, text/javascript, */*; q=0.01',
    'Accept-Language': 'en-US,en;q=0.9,sw;q=0.8',
    'Connection': 'keep-alive',
    'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
    'Origin': 'https://itax.kra.go.ke',
    'Referer': 'https://itax.kra.go.ke/KRA-Portal/manufacturerAuthorizationController.htm?actionCode=appForManufacturerAuth',
    'Sec-Fetch-Dest': 'empty',
    'Sec-Fetch-Mode': 'cors',
    'Sec-Fetch-Site': 'same-origin',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36',
    'X-Requested-With': 'XMLHttpRequest',
    'sec-ch-ua': '"Chromium";v="136", "Google Chrome";v="136", "Not.A/Brand";v="99"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"'
};

// --- Main Orchestration Function ---
async function runDirectorDetailsExtraction(company, downloadPath, progressCallback) {
    progressCallback({
        stage: 'Director Details Extraction',
        message: 'Starting director details extraction...',
        progress: 5
    });

    let browser = null;
    try {
        browser = await chromium.launch(getBrowserLaunchOptions(company));
        const context = await browser.newContext();
        const page = await context.newPage();
        page.setDefaultTimeout(60000); // 60 seconds timeout

        const loginSuccess = await loginToKRA(page, company, downloadPath, progressCallback);
        if (!loginSuccess) {
            throw new Error('Login failed. Please check credentials and try again.');
        }

        const extractedData = await extractCompanyAndDirectorDetails(page, progressCallback);

        // Initialize shared workbook manager
        const workbookManager = new SharedWorkbookManager(company, downloadPath);
        const companyFolder = await workbookManager.initialize();

        progressCallback({
            progress: 80,
            log: `Company folder created: ${companyFolder}`
        });

        // Export to shared workbook
        await exportDirectorDetailsToSheet(workbookManager, extractedData);
        const savedWorkbook = await workbookManager.save();

        progressCallback({
            progress: 90,
            log: `Report saved: ${savedWorkbook.fileName}`
        });

        await browser.close();

        progressCallback({
            stage: 'Director Details Extraction',
            message: 'Director details extraction completed successfully.',
            progress: 100
        });

        return {
            success: true,
            message: 'Director details extracted successfully.',
            files: [savedWorkbook.fileName],
            data: extractedData
        };
    } catch (error) {
        console.error('Error during director details extraction:', error);
        progressCallback({ message: `Error: ${error.message}`, logType: 'error' });
        if (browser) {
            await browser.close();
        }
        return { success: false, error: error.message };
    }
}

// --- KRA Portal Interaction Functions ---
async function loginToKRA(page, company, downloadFolderPath, progressCallback) {
    progressCallback({ log: 'Navigating to KRA portal...' });
    await page.goto("https://itax.kra.go.ke/KRA-Portal/");
    await page.waitForTimeout(1000);

    await page.locator("#logid").click();
    await page.locator("#logid").fill(company.pin);
    await page.evaluate(() => { CheckPIN(); });

    try {
        await page.locator('input[name="xxZTT9p2wQ"]').fill(company.password, { timeout: 2000 });
    } catch (error) {
        throw new Error('Could not find password field.');
    }

    await page.waitForTimeout(1500);
    progressCallback({ log: 'Solving captcha...' });

    const image = await page.waitForSelector("#captcha_img");
    const imagePath = path.join(downloadFolderPath, `ocr_${company.pin}.png`);
    await image.screenshot({ path: imagePath });

    const worker = await createWorker('eng', 1);
    let result;

    const extractResult = async () => {
        const ret = await worker.recognize(imagePath);
        
        const text1 = ret.data.text.slice(0, -1);
        const text = text1.slice(0, -1);
        const numbers = text.match(/\d+/g);

        if (!numbers || numbers.length < 2) {
            throw new Error("Unable to extract valid numbers from CAPTCHA");
        }

        if (text.includes("+")) {
            result = Number(numbers[0]) + Number(numbers[1]);
        } else if (text.includes("-")) {
            result = Number(numbers[0]) - Number(numbers[1]);
        } else {
            throw new Error("Unsupported arithmetic operator in CAPTCHA");
        }
        
        progressCallback({
            log: `CAPTCHA solved: ${numbers[0]} ${text.includes("+") ? "+" : "-"} ${numbers[1]} = ${result}`
        });
    };

    let attempts = 0;
    while (attempts < 5) {
        try {
            await extractResult();
            break;
        } catch (error) {
            attempts++;
            if (attempts >= 5) throw new Error('Failed to solve captcha after multiple attempts.');
            await page.waitForTimeout(1000);
            await image.screenshot({ path: imagePath });
        }
    }
    await worker.terminate();

    await page.type("#captcahText", result.toString());
    await page.click("#loginButton");
    
    await page.waitForTimeout(2000);

    const mainMenu = await page.waitForSelector("#ddtopmenubar > ul > li:nth-child(1) > a", { 
        timeout: 5000, 
        state: "visible" 
    }).catch(() => false);

    if (mainMenu) {
        progressCallback({ log: 'Login successful!' });
        return true;
    }

    const isInvalidLogin = await page.waitForSelector('b:has-text("Wrong result of the arithmetic operation.")', { 
        state: 'visible', 
        timeout: 3000 
    }).catch(() => false);

    if (isInvalidLogin) {
        progressCallback({ log: 'Wrong captcha result, retrying login...' });
        return loginToKRA(page, company, downloadFolderPath, progressCallback);
    }

    progressCallback({ log: 'Login failed - unknown error, retrying...' });
    return loginToKRA(page, company, downloadFolderPath, progressCallback);
    
}


async function extractCompanyAndDirectorDetails(page, progressCallback) {
    await page.goto("https://itax.kra.go.ke/KRA-Portal/");
    progressCallback({ message: 'Navigating to amendment form...', progress: 40 });
    await page.hover("#ddtopmenubar > ul > li:nth-child(6) > a");
    await page.evaluate(() => { showAmendmentForm(); });

    await page.locator('#modeOfRegsitartion').selectOption('ON');
    await page.getByRole('button', { name: 'Next' }).click();
    await page.locator('#pinSection').check();

    // --- 1. Extract Basic Information ---
    progressCallback({ message: 'Accessing basic information tab...', progress: 50 });
    await page.getByRole('link', { name: 'A_Basic_Information' }).click();

    // Extract Accounting Period End Month
    const accMonthSelector = '#accMonth';
    const selectedMonthValue = await page.locator(accMonthSelector).inputValue();
    const accountingPeriod = await page.locator(`${accMonthSelector} option[value="${selectedMonthValue}"]`).textContent();
    progressCallback({ log: `Found Accounting Period: ${accountingPeriod.trim()}` });

    // Extract Economic Activities
    const activities = [];
    const activityRows = await page.locator('#dtEcoActDtls tbody tr').all();
    for (const row of activityRows) {
        const section = (await row.locator('td:nth-child(4)').textContent()).trim();
        const type = (await row.locator('td:nth-child(5)').textContent()).trim();
        activities.push({ section, type });
    }
    progressCallback({ log: `Found ${activities.length} economic activities.` });

    // --- 2. Extract Director Details ---
    progressCallback({ message: 'Accessing director details tab...', progress: 70 });
    await page.getByRole('link', { name: 'D_Director_Associates' }).click();

    const directors = [];
    const directorRows = await page.locator('#dtPersonDtls tbody tr').all();
    progressCallback({ message: `Found ${directorRows.length} director(s). Extracting...`, progress: 80 });

    for (const row of directorRows) {
        const nature = (await row.locator('td:nth-child(4)').textContent()).trim();
        const pin = (await row.locator('td:nth-child(5)').textContent()).trim();
        const ratio = (await row.locator('td:nth-child(6)').textContent()).trim();
                const details = await getDirectorDetailsFromAPI(pin, page, progressCallback);
        directors.push({ 
            nature, 
            pin, 
            ratio, 
            name: details.name, 
            email: details.email, 
            mobile: details.mobile 
        });
    }
    
    progressCallback({ message: 'All details extracted.', progress: 90 });
    
    return {
        accountingPeriod: accountingPeriod.trim(),
        activities,
        directors
    };
}

// --- Excel Report Generation ---
async function generateExcelReport(company, extractedData, downloadPath) {
    const workbook = new ExcelJS.Workbook();
    const now = new Date();
    const formattedDate = `${now.getDate()}.${now.getMonth() + 1}.${now.getFullYear()}`;
    const worksheet = workbook.addWorksheet(`Director_Details_${formattedDate}`);

    // Add header
    const titleRow = worksheet.addRow(['', 'KRA Director Details Report', '', `Extraction Date: ${now.toLocaleString()}`]);
    worksheet.mergeCells('B1:D1');
    titleRow.getCell('B').font = { size: 14, bold: true, color: { argb: 'FFFFFFFF' } };
    highlightCells(titleRow, 'B', 'D', 'FF4682B4');
    worksheet.addRow([]);

    // Add company info
    const companyHeaderRow = worksheet.addRow(['', company.company_name, company.kra_pin]);
    highlightCells(companyHeaderRow, 'B', 'C', 'FFADD8E6', true);
    worksheet.addRow([]);

    // Add Accounting Period
    const periodRow = worksheet.addRow(['', 'Accounting Period End Month', extractedData.accountingPeriod]);
    worksheet.mergeCells(`C${periodRow.number}:E${periodRow.number}`);
    highlightCells(periodRow, 'B', 'E', 'FFE4EE99');
    periodRow.getCell('B').font = { bold: true };
    worksheet.addRow([]);

    // Add Economic Activities Table
    if (extractedData.activities && extractedData.activities.length > 0) {
        const activityHeader = worksheet.addRow(['', 'Economic Activities']);
        worksheet.mergeCells(`B${activityHeader.number}:E${activityHeader.number}`);
        highlightCells(activityHeader, 'B', 'E', 'FF90EE90', true);

        const activitySubHeaders = worksheet.addRow(['', 'No.', 'Section', 'Type']);
        highlightCells(activitySubHeaders, 'B', 'D', 'FFD3D3D3', true);

        extractedData.activities.forEach((act, index) => {
            worksheet.addRow(['', index + 1, act.section, act.type]);
        });
    } else {
        worksheet.addRow(['', 'Economic Activities', 'No records found.']);
    }
    worksheet.addRow([]);

    // Add director table
    if (extractedData.directors && extractedData.directors.length > 0) {
        const header = worksheet.addRow(['', 'Associated Directors / Partners']);
        worksheet.mergeCells(`B${header.number}:H${header.number}`);
        highlightCells(header, 'B', 'H', 'FF90EE90', true);

        const subHeaders = worksheet.addRow(['', 'No.', 'Nature', 'PIN', 'Name', 'Email', 'Mobile', 'Profit/Loss Ratio']);
        highlightCells(subHeaders, 'B', 'H', 'FFD3D3D3', true);

        extractedData.directors.forEach((dir, index) => {
            worksheet.addRow(['', index + 1, dir.nature, dir.pin, dir.name, dir.email, dir.mobile, dir.ratio]);
        });
    } else {
        worksheet.addRow(['', 'No director records found.']);
    }

    autoFitColumns(worksheet);

    const filePath = path.join(downloadPath, `KRA-DIRECTOR-DETAILS-${company.kra_pin}-${formattedDate}.xlsx`);
    await workbook.xlsx.writeFile(filePath);
    return filePath;
}

// --- Excel Utility Functions ---
function highlightCells(row, startCol, endCol, color, bold = false) {
    for (let col = startCol.charCodeAt(0); col <= endCol.charCodeAt(0); col++) {
        const cell = row.getCell(String.fromCharCode(col));
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: color } };
        if (bold) { cell.font = { bold: true }; }
    }
}

function autoFitColumns(worksheet) {
    worksheet.columns.forEach(column => {
        let maxLength = 0;
        column.eachCell({ includeEmpty: true }, cell => {
            let cellLength = cell.value ? cell.value.toString().length : 10;
            if (cellLength > maxLength) { maxLength = cellLength; }
        });
        column.width = Math.max(12, Math.min(50, maxLength + 2));
    });
}

// --- KRA API Helper Function ---
async function getDirectorDetailsFromAPI(pin, page, progressCallback) {
    if (!pin || !pin.startsWith('A')) {
        progressCallback({ log: `Skipping PIN ${pin} - Not a valid individual PIN.` });
        return { name: 'N/A', email: 'N/A', mobile: 'N/A' };
    }

    try {
        // Dynamically get the session cookie from the browser instance
        const cookies = await page.context().cookies();
        const sessionCookie = cookies.map(c => `${c.name}=${c.value}`).join('; ');

        if (!sessionCookie) {
            throw new Error('Could not retrieve session cookie for API call.');
        }

        const KRA_API_URL = 'https://itax.kra.go.ke/KRA-Portal/manufacturerAuthorizationController.htm?actionCode=fetchManDtl';
        const formData = new URLSearchParams();
        formData.append('manPin', pin);

        progressCallback({ log: `Fetching details for Director PIN: ${pin}` });

        const response = await fetch(KRA_API_URL, {
            method: 'POST',
            headers: {
                ...KRA_API_HEADERS,
                'Cookie': sessionCookie
            },
            body: formData.toString(),
        });

        if (!response.ok) {
            throw new Error(`API call failed for PIN ${pin} with status: ${response.status}`);
        }

        const data = await response.json();

        const name = data?.timsManBasicRDtlDTO?.manufacturerName || 'N/A';
        const email = data?.manContactRDtlDTO?.mainEmail || 'N/A';
        const mobile = data?.manContactRDtlDTO?.mobileNo || 'N/A';

        return { name, email, mobile };

    } catch (error) {
        progressCallback({ log: `API Error for PIN ${pin}: ${error.message}`, logType: 'warning' });
        return { name: 'API Error', email: 'API Error', mobile: 'API Error' };
    }
}

// Export director details to a shared workbook as a sheet
async function exportDirectorDetailsToSheet(workbookManager, extractedData) {
    const now = new Date();
    const formattedDate = `${now.getDate()}.${now.getMonth() + 1}.${now.getFullYear()}`;
    const worksheet = workbookManager.addWorksheet('Director Details');

    // Add title
    workbookManager.addTitleRow(worksheet, 'KRA Director Details Report', `Extraction Date: ${now.toLocaleString()}`);
    
    // Add company info
    workbookManager.addCompanyInfoRow(worksheet);

    // Add Accounting Period
    const periodRow = worksheet.addRow(['', 'Accounting Period End Month', extractedData.accountingPeriod]);
    worksheet.mergeCells(`C${periodRow.number}:E${periodRow.number}`);
    workbookManager.highlightCells(worksheet, periodRow.number, 'B', 'E', 'FFE4EE99');
    periodRow.getCell('B').font = { bold: true };
    worksheet.addRow([]);

    // Add Economic Activities Table
    if (extractedData.activities && extractedData.activities.length > 0) {
        const activityHeader = worksheet.addRow(['', 'Economic Activities']);
        worksheet.mergeCells(`B${activityHeader.number}:E${activityHeader.number}`);
        workbookManager.highlightCells(worksheet, activityHeader.number, 'B', 'E', 'FF90EE90');
        activityHeader.getCell('B').font = { bold: true };

        workbookManager.addHeaderRow(worksheet, ['No.', 'Section', 'Type']);

        const activityData = extractedData.activities.map((act, index) => [
            index + 1, act.section, act.type
        ]);
        workbookManager.addDataRows(worksheet, activityData, 'B', { borders: true, alternateRows: true });
    } else {
        worksheet.addRow(['', 'Economic Activities', 'No records found.']);
    }
    worksheet.addRow([]);

    // Add director table
    if (extractedData.directors && extractedData.directors.length > 0) {
        const header = worksheet.addRow(['', 'Associated Directors / Partners']);
        worksheet.mergeCells(`B${header.number}:H${header.number}`);
        workbookManager.highlightCells(worksheet, header.number, 'B', 'H', 'FF90EE90');
        header.getCell('B').font = { bold: true };

        workbookManager.addHeaderRow(worksheet, ['No.', 'Nature', 'PIN', 'Name', 'Email', 'Mobile', 'Profit/Loss Ratio']);

        const directorData = extractedData.directors.map((dir, index) => [
            index + 1, dir.nature, dir.pin, dir.name, dir.email, dir.mobile, dir.ratio
        ]);
        workbookManager.addDataRows(worksheet, directorData, 'B', { borders: true, alternateRows: true });
    } else {
        worksheet.addRow(['', 'No director records found.']);
    }

    workbookManager.autoFitColumns(worksheet);
    
    return worksheet;
}

module.exports = { 
    runDirectorDetailsExtraction,
    extractCompanyAndDirectorDetails,
    exportDirectorDetailsToSheet
};
