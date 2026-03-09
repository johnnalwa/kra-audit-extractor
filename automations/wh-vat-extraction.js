const { chromium } = require('playwright');
const { createWorker } = require('tesseract.js');
const ExcelJS = require('exceljs');
const path = require('path');
const fs = require('fs').promises;
const SharedWorkbookManager = require('./shared-workbook-manager');
const os = require('os');
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

// Main extraction function
async function runWhVatExtraction(company, dateRange, downloadPath, progressCallback) {
    // Initialize SharedWorkbookManager for company folder
    const workbookManager = new SharedWorkbookManager(company, downloadPath);
    const companyFolder = await workbookManager.initialize();
    
    progressCallback({
        log: `Company folder: ${companyFolder}`
    });

    const browser = await chromium.launch(getBrowserLaunchOptions(company, {
        slowMo: 100
    }));

    const context = await browser.newContext({
        viewport: { width: 1920, height: 1080 }
    });

    const page = await context.newPage();

    try {
        progressCallback({
            stage: 'Withholding VAT',
            message: 'Initializing...',
            progress: 5
        });

        progressCallback({
            log: `Logging in with PIN: ${company.pin}`,
            progress: 10
        });

        // Login
        await page.goto('https://itax.kra.go.ke/KRA-Portal/');
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

        await page.waitForSelector("#captcha_img");
        // Use system temp directory like agent-checker (more reliable in production)
        const tempDir = path.join(os.tmpdir(), 'KRA');
        await fs.mkdir(tempDir, { recursive: true });
        const imagePath = path.join(tempDir, `captcha_whvat_${Date.now()}.png`);
        await page.locator("#captcha_img").first().screenshot({ path: imagePath });
        
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
                await page.locator("#captcha_img").first().screenshot({ path: imagePath });
            }
        }
        await worker.terminate();

        await page.type("#captcahText", result.toString());
        await page.click("#loginButton");
        
        await page.waitForTimeout(2000);
        
        progressCallback({
            log: 'Login successful',
            progress: 20
        });
        
        await page.goto('https://itax.kra.go.ke/KRA-Portal/', { waitUntil: 'networkidle' });
        await page.waitForTimeout(2000);
        
        // Wait for menu to be available
        await page.waitForSelector('#ddtopmenubar > ul > li > a', { state: 'visible', timeout: 10000 });

        progressCallback({
            log: 'Navigating to Withholding VAT returns...',
            progress: 30
        });
        
        // Navigate to Withholding VAT (menu item #8, not #4)
        await page.hover('#ddtopmenubar > ul > li:nth-child(8) > a');
        await page.waitForTimeout(1000);
        await page.evaluate(() => { consultAndReprintVATWHTCerti(); });
        await page.waitForTimeout(3000); // Wait longer for page to load

        progressCallback({
            log: 'Processing Withholding VAT returns...',
            progress: 40
        });

        // Process the returns
        const results = await processWhVatReturns(page, company, dateRange, companyFolder, workbookManager, progressCallback);

        await browser.close();

        return {
            success: true,
            message: 'Withholding VAT returns extracted successfully.',
            files: [results.filePath],
            downloadPath: companyFolder,
            companyFolder: companyFolder,
            data: results.data,
            filePath: results.filePath
        };

    } catch (error) {
        await browser.close();
        throw error;
    }
}

async function processWhVatReturns(page, company, dateRange, downloadPath, workbookManager, progressCallback) {
    const workbook = new ExcelJS.Workbook();
    
    const now = new Date();
    const formattedDateTime = `${now.getDate()}.${now.getMonth() + 1}.${now.getFullYear()}`;
    const formattedDateTime2 = `${now.getDate()}_${now.getMonth() + 1}_${now.getFullYear()}_${now.getHours()}_${now.getMinutes()}`;
    
    // Determine date range
    let startMonth, startYear, endMonth, endYear;
    if (dateRange === 'all') {
        // Get all available returns
        const currentDate = new Date();
        endMonth = currentDate.getMonth() + 1;
        endYear = currentDate.getFullYear();
        startMonth = 1;
        startYear = 2020; // Default start year
    } else {
        startMonth = dateRange.startMonth;
        startYear = dateRange.startYear;
        endMonth = dateRange.endMonth;
        endYear = dateRange.endYear;
    }

    progressCallback({
        log: `Extracting WH VAT from ${getMonthName(startMonth)} ${startYear} to ${getMonthName(endMonth)} ${endYear}`
    });

    // Create worksheets for each month/year combination
    const monthYearWorksheets = new Map();
    const allData = [];
    const extractedPeriods = new Set();

    try {
        // Generate list of periods to process
        const periods = [];
        for (let year = startYear; year <= endYear; year++) {
            const monthStart = (year === startYear) ? startMonth : 1;
            const monthEnd = (year === endYear) ? endMonth : 12;
            
            for (let month = monthStart; month <= monthEnd; month++) {
                periods.push({ month, year });
            }
        }
        
        progressCallback({
            log: `Will process ${periods.length} periods from ${getMonthName(startMonth)} ${startYear} to ${getMonthName(endMonth)} ${endYear}`
        });
        
        let processedCount = 0;
        
        // Process each period individually
        for (const period of periods) {
            try {
                const { month, year } = period;
                const periodKey = `${getMonthName(month)} ${year}`;
                
                processedCount++;
                progressCallback({
                    log: `Selecting period: ${periodKey} (${processedCount}/${periods.length})...`,
                    progress: 40 + (processedCount * 50 / periods.length)
                });

                // Select month and year on the WH VAT page
                try {
                    // Select month (dropdown #mnth)
                    await page.selectOption('#mnth', month.toString());
                    await page.waitForTimeout(500);
                    
                    // Select year (dropdown #year)
                    await page.selectOption('#year', year.toString());
                    await page.waitForTimeout(500);
                    
                    // Handle any dialogs that may appear
                    page.on('dialog', dialog => dialog.accept().catch(() => {}));
                    
                    // Click submit button
                    await page.click('#submitBtn');
                    await page.waitForTimeout(1000);
                    
                    progressCallback({ log: `Period selected: ${periodKey}` });
                    
                } catch (selectError) {
                    progressCallback({
                        log: `Error selecting period ${periodKey}: ${selectError.message}`,
                        logType: 'error'
                    });
                    continue;
                }

                // Check if "no records" message appears
                const noRecords = await page.locator('text=/No records found/i, text=/No data available/i, text=/No records to display/i').first().isVisible().catch(() => false);
                
                if (noRecords) {
                    progressCallback({ log: `No records found for ${periodKey}` });
                    continue;
                }

                // Wait for table to load
                await page.waitForTimeout(2000);
                const table = await page.locator('#jspDiv > table').first().isVisible().catch(() => false);
                
                if (!table) {
                    progressCallback({
                        log: `No table found for ${periodKey}`,
                        logType: 'warning'
                    });
                    continue;
                }

                // Extract the table data for this period
                progressCallback({ log: `Extracting data for ${periodKey}...` });
                
                const transactions = await extractWhVatTransactions(page);
                
                if (!transactions || transactions.length === 0) {
                    progressCallback({ log: `No transactions extracted for ${periodKey}` });
                    continue;
                }

                progressCallback({ log: `Found ${transactions.length} transactions for ${periodKey}` });
                extractedPeriods.add(periodKey);

                // Get or create worksheet for this period
                let worksheet;
                if (!monthYearWorksheets.has(periodKey)) {
                    worksheet = workbook.addWorksheet(periodKey.substring(0, 31));
                    monthYearWorksheets.set(periodKey, worksheet);

                    // Add company info
                    const companyRow = worksheet.addRow([
                        company.name,
                        `PIN: ${company.pin}`,
                        `Extraction Date: ${formattedDateTime}`
                    ]);
                    highlightCells(companyRow, 'A', 'I', 'FFADD8E6', true);
                    worksheet.addRow([]); // Empty row

                    // Add headers
                    const headerRow = worksheet.addRow([
                        'Sr No',
                        'Tax Obligation',
                        'Period',
                        'Date',
                        'Reference Number',
                        'Particulars',
                        'Type',
                        'Debit',
                        'Credit'
                    ]);
                    headerRow.font = { bold: true };
                    headerRow.fill = {
                        type: 'pattern',
                        pattern: 'solid',
                        fgColor: { argb: 'FF83EBFF' }
                    };
                } else {
                    worksheet = monthYearWorksheets.get(periodKey);
                }

                // Add transaction rows
                transactions.forEach(transaction => {
                    worksheet.addRow([
                        transaction.srNo || '',
                        transaction.taxObligation || '',
                        `${getMonthName(month)} ${year}`,
                        transaction.date || '',
                        transaction.refNo || '',
                        transaction.particulars || '',
                        transaction.type || '',
                        transaction.debit || '',
                        transaction.credit || ''
                    ]);

                    allData.push({
                        period: periodKey,
                        ...transaction
                    });
                });

            } catch (error) {
                progressCallback({
                    log: `Error processing period ${period.month}/${period.year}: ${error.message}`,
                    logType: 'error'
                });
            }
        }

        if (processedCount === 0) {
            progressCallback({
                log: `No WH VAT returns found in the specified date range: ${startMonth}/${startYear} to ${endMonth}/${endYear}`
            });

            // Create a single sheet with "No Data" message
            const worksheet = workbook.addWorksheet('No Data');
            worksheet.addRow(['No Withholding VAT returns found in the specified date range']);
        }

        // Auto-fit columns for all worksheets
        workbook.worksheets.forEach(worksheet => {
            worksheet.columns.forEach(column => {
                let maxLength = 0;
                column.eachCell({ includeEmpty: true }, cell => {
                    const cellLength = cell.value ? cell.value.toString().length : 10;
                    if (cellLength > maxLength) {
                        maxLength = cellLength;
                    }
                });
                column.width = Math.min(maxLength + 2, 50);
            });
        });

        // Save the Excel file in company folder
        const fileName = `WH_VAT_RETURNS_${company.pin}_${formattedDateTime}.xlsx`;
        const filePath = path.join(downloadPath, fileName);
        await workbook.xlsx.writeFile(filePath);

        progressCallback({
            log: `WH VAT returns saved to: ${fileName}`,
            logType: 'success',
            progress: 100
        });

        return {
            success: true,
            filePath: filePath,
            data: allData
        };

    } catch (error) {
        progressCallback({
            log: `Error processing WH VAT returns: ${error.message}`,
            logType: 'error'
        });
        throw error;
    }
}

async function extractWhVatTransactions(page) {
    try {
        // Wait for transaction table to load
        await page.waitForTimeout(1000);
        
        // Try to find the transaction details table
        const tableSelectors = [
            'table#gridGeneralLedgerDtlsTbl',
            'table.GridViewStyle',
            'table[id*="Grid"]',
            'div.GridViewDiv table',
            'table tbody tr'
        ];
        
        let tableFound = false;
        for (const selector of tableSelectors) {
            const count = await page.locator(selector).count();
            if (count > 0) {
                tableFound = true;
                break;
            }
        }
        
        if (!tableFound) {
            return [];
        }
        
        // Extract transaction data using evaluate for safety
        const transactions = await page.evaluate(() => {
            // Find the main table with transaction data
            const tables = Array.from(document.querySelectorAll('table'));
            let transactionTable = null;
            
            // Look for table with headers like SR.NO, PERIOD, DATE, etc.
            for (const table of tables) {
                const headerText = table.innerText.toLowerCase();
                if (headerText.includes('sr.no') || 
                    headerText.includes('period') || 
                    headerText.includes('particulars')) {
                    transactionTable = table;
                    break;
                }
            }
            
            if (!transactionTable) {
                // Try to get any table with tbody
                transactionTable = document.querySelector('table tbody')?.closest('table');
            }
            
            if (!transactionTable) return [];
            
            const rows = Array.from(transactionTable.querySelectorAll('tbody tr'));
            
            return rows.map(row => {
                const cells = Array.from(row.querySelectorAll('td'));
                if (cells.length === 0) return null;
                
                // Map cells to transaction data
                // Common column order: SR.NO, Tax Obligation, Period, Date, Ref No, Particulars, Type, Debit, Credit
                return {
                    srNo: cells[0]?.innerText?.trim() || '',
                    taxObligation: cells[1]?.innerText?.trim() || '',
                    period: cells[2]?.innerText?.trim() || '',
                    date: cells[3]?.innerText?.trim() || '',
                    refNo: cells[4]?.innerText?.trim() || '',
                    particulars: cells[5]?.innerText?.trim() || '',
                    type: cells[6]?.innerText?.trim() || '',
                    debit: cells[7]?.innerText?.trim() || '',
                    credit: cells[8]?.innerText?.trim() || ''
                };
            }).filter(transaction => {
                // Filter out null and header rows
                return transaction !== null && 
                       transaction.srNo && 
                       !transaction.srNo.toLowerCase().includes('sr.no') &&
                       !transaction.srNo.toLowerCase().includes('sr no');
            });
        });
        
        return transactions;
        
    } catch (error) {
        console.error('Error extracting WH VAT transactions:', error);
        return [];
    }
}

async function extractWhVatDetails(page) {
    try {
        const details = {
            totalAmount: 'N/A',
            summary: ''
        };

        // Try to find the total amount
        const amountSelectors = [
            'td:has-text("Total Tax Due") + td',
            'td:has-text("Total WHT") + td',
            'td:has-text("Amount") + td'
        ];

        for (const selector of amountSelectors) {
            const amountCell = page.locator(selector).first();
            if (await amountCell.count() > 0) {
                const amount = await amountCell.textContent();
                details.totalAmount = amount.trim();
                break;
            }
        }

        // Try to get summary information
        const summaryText = await page.locator('table').first().textContent();
        details.summary = summaryText.substring(0, 100); // First 100 chars as summary

        return details;
    } catch (error) {
        return {
            totalAmount: 'N/A',
            summary: 'Error extracting details'
        };
    }
}

// Helper functions
function highlightCells(row, startCol, endCol, color, bold = false) {
    for (let col = startCol.charCodeAt(0); col <= endCol.charCodeAt(0); col++) {
        const cell = row.getCell(String.fromCharCode(col));
        cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: color }
        };
        if (bold) {
            cell.font = { bold: true };
        }
    }
}

function getMonthName(month) {
    const months = [
        'January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'
    ];
    return months[month - 1];
}

function getMonthNumber(monthName) {
    const months = {
        // Full names
        'january': 1, 'february': 2, 'march': 3, 'april': 4,
        'may': 5, 'june': 6, 'july': 7, 'august': 8,
        'september': 9, 'october': 10, 'november': 11, 'december': 12,
        // Abbreviated names
        'jan': 1, 'feb': 2, 'mar': 3, 'apr': 4,
        'may': 5, 'jun': 6, 'jul': 7, 'aug': 8,
        'sep': 9, 'sept': 9, 'oct': 10, 'nov': 11, 'dec': 12
    };
    return months[monthName.toLowerCase()];
}

module.exports = {
    runWhVatExtraction
};
