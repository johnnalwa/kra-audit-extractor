const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs').promises;
const { createWorker } = require('tesseract.js');
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

// --- Main Orchestration Function ---
async function runTCCDownloader(company, downloadPath, progressCallback) {
    progressCallback({
        stage: 'Tax Compliance',
        message: 'Starting Tax Compliance Certificate download...',
        progress: 5
    });

    let browser = null;
    try {
        // Initialize SharedWorkbookManager for company folder
        const workbookManager = new SharedWorkbookManager(company, downloadPath);
        const companyFolder = await workbookManager.initialize();

        progressCallback({
            stage: 'Tax Compliance',
            message: `Company folder: ${companyFolder}`,
            progress: 10
        });

        browser = await chromium.launch(getBrowserLaunchOptions(company));
        const context = await browser.newContext();
        const page = await context.newPage();
        page.setDefaultTimeout(60000); // 60 seconds timeout

        const loginSuccess = await loginToKRA(page, company, companyFolder, progressCallback);
        if (!loginSuccess) {
            throw new Error('Login failed. Please check credentials and try again.');
        }

        const { filePath, tableData } = await downloadTCC(page, company, companyFolder, progressCallback);

        await browser.close();

        progressCallback({
            stage: 'Tax Compliance',
            message: 'Tax Compliance Certificate downloaded successfully.',
            progress: 100
        });

        return {
            success: true,
            message: 'TCC downloaded successfully.',
            files: [filePath],
            tableData: tableData,
            companyFolder: companyFolder,
            downloadPath: companyFolder
        };
    } catch (error) {
        console.error('Error during TCC download:', error);
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

async function downloadTCC(page, company, downloadPath, progressCallback) {
    await page.goto("https://itax.kra.go.ke/KRA-Portal/");
    progressCallback({ message: 'Navigating to Certificates menu...', progress: 40 });
    await page.hover('#ddtopmenubar > ul > li:nth-child(8) > a');
    await page.evaluate(() => { showReprintTCC(); });
    await page.waitForTimeout(1000);

    progressCallback({ message: 'Clicking Consult button...', progress: 50 });

    // Click Consult button directly (first time)
    await page.getByRole('button', { name: 'Consult' }).click();
    await page.waitForTimeout(1000);

    // Handle dialog and click Consult button again
    page.once("dialog", async dialog => {
        console.log(`Dialog: ${dialog.message()}`);
        progressCallback({ log: `Dialog: ${dialog.message()}` });
        await dialog.accept();
    });

    await page.getByRole("button", { name: "Consult" }).click();

    // Wait for table to load
    progressCallback({ message: 'Extracting TCC history...', progress: 60 });
    await page.waitForSelector('#tbl', { timeout: 10000 });

    // Extract full table data from #tbl
    const tableData = await page.evaluate(() => {
        const table = document.querySelector('#tbl');
        if (!table) return [];

        const rows = table.querySelectorAll('tbody tr');
        const data = [];

        rows.forEach(row => {
            const cells = row.querySelectorAll('td');
            if (cells.length >= 7) {
                const serialNoCell = cells[6];
                const link = serialNoCell.querySelector('a');

                data.push({
                    srNo: cells[0].textContent.trim().replace('&nbsp;', ''),
                    pin: cells[1].textContent.trim().replace('&nbsp;', ''),
                    companyName: cells[2].textContent.trim().replace('&nbsp;', ''),
                    status: cells[3].textContent.trim().replace('&nbsp;', ''),
                    certificateDate: cells[4].textContent.trim().replace('&nbsp;', ''),
                    expiryDate: cells[5].textContent.trim().replace('&nbsp;', ''),
                    serialNo: serialNoCell.textContent.trim().replace('&nbsp;', ''),
                    hasLink: !!link,
                    onclick: link ? link.getAttribute('onclick') : null
                });
            }
        });

        return data;
    });

    progressCallback({ message: `Found ${tableData.length} certificate(s) in history`, progress: 65 });

    // Download PDF if available
    progressCallback({ message: 'Checking for TCC certificate download...', progress: 70 });
    const downloadLink = await page.$('a.textDecorationUnderline');
    
    let filePath = null;
    
    if (downloadLink) {
        progressCallback({ message: 'Downloading TCC certificate...', progress: 75 });
        
        const [download] = await Promise.all([
            page.waitForEvent('download'),
            downloadLink.click(),
        ]);

        const now = new Date();
        const formattedDate = `${now.getDate()}.${now.getMonth() + 1}.${now.getFullYear()}`;
        const fileName = `KRA-TCC-${company.pin}-${formattedDate}.pdf`;
        filePath = path.join(downloadPath, fileName);

        await download.saveAs(filePath);
        progressCallback({ message: `TCC downloaded successfully: ${fileName}`, progress: 90 });
    } else {
        progressCallback({ message: 'No TCC certificate available for download', progress: 90, logType: 'warning' });
        // Create a placeholder path
        filePath = path.join(downloadPath, `KRA-TCC-${company.pin}-NO-CERT.txt`);
        await fs.writeFile(filePath, 'No TCC certificate available for this PIN.');
    }

    return { filePath, tableData };
}

module.exports = { runTCCDownloader };
