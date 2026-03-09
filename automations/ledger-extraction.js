const { chromium } = require('playwright');
const { createWorker } = require('tesseract.js');
const ExcelJS = require('exceljs');
const path = require('path');
const fs = require('fs').promises;
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

async function runLedgerExtraction(company, downloadPath, progressCallback) {
    let browser = null;
    let context = null;
    let page = null;

    try {
        progressCallback({
            stage: 'General Ledger Extraction',
            message: 'Initializing ledger extraction...',
            progress: 0
        });

        // Initialize shared workbook manager
        const workbookManager = new SharedWorkbookManager(company, downloadPath);
        const companyFolder = await workbookManager.initialize();

        progressCallback({
            progress: 5,
            log: `Company folder created: ${companyFolder}`
        });

        // Launch browser
        browser = await chromium.launch(getBrowserLaunchOptions(company, {
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        }));

        context = await browser.newContext();
        page = await context.newPage();

        progressCallback({
            progress: 10,
            log: 'Browser launched, logging into KRA portal...'
        });

        // Login to KRA
        await loginToKRA(page, company, progressCallback);

        progressCallback({
            progress: 30,
            log: 'Navigating to general ledger section...'
        });

        // Navigate to General Ledger
        await navigateToGeneralLedger(page, progressCallback);

        progressCallback({
            progress: 50,
            log: 'Configuring ledger parameters...'
        });

        // Configure General Ledger settings
        await configureGeneralLedger(page, progressCallback);

        progressCallback({
            progress: 70,
            log: 'Extracting general ledger data...'
        });

        // Extract ledger data
        const extractedData = await extractLedgerData(page, company, companyFolder, progressCallback);

        progressCallback({
            progress: 80,
            log: 'Adding ledger data to consolidated report...'
        });

        // Export to shared workbook
        await exportLedgerToSheet(workbookManager, extractedData);
        const savedWorkbook = await workbookManager.save();

        progressCallback({
            progress: 90,
            log: `Report saved: ${savedWorkbook.fileName}`
        });

        progressCallback({
            progress: 100,
            log: 'General ledger extraction completed successfully',
            logType: 'success'
        });

        return {
            success: true,
            files: [savedWorkbook.fileName],
            downloadPath: companyFolder,
            companyFolder: companyFolder,
            recordCount: extractedData.recordCount,
            data: extractedData.data
        };

    } catch (error) {
        progressCallback({
            log: `Ledger extraction error: ${error.message}`,
            logType: 'error'
        });

        return {
            success: false,
            error: error.message
        };

    } finally {
        // Cleanup
        if (page) await page.close().catch(() => {});
        if (context) await context.close().catch(() => {});
        if (browser) await browser.close().catch(() => {});
    }
}

async function loginToKRA(page, company, progressCallback) {
    await page.goto("https://itax.kra.go.ke/KRA-Portal/");
    await page.waitForTimeout(2000);

    // Enter PIN
    await page.locator("#logid").click();
    await page.locator("#logid").fill(company.pin);
    await page.evaluate(() => {
        CheckPIN();
    });

    // Enter password
    await page.locator('input[name="xxZTT9p2wQ"]').fill(company.password);
    await page.waitForTimeout(500);

    progressCallback({
        log: 'Solving login CAPTCHA...'
    });

    // Solve CAPTCHA
    const captchaResult = await solveCaptcha(page);
    await page.type("#captcahText", captchaResult);
    await page.click("#loginButton");

    await page.waitForTimeout(3000);

    // Verify login success
    const mainMenu = await page.waitForSelector("#ddtopmenubar > ul > li:nth-child(1) > a", {
        timeout: 10000,
        state: "visible"
    }).catch(() => false);

    if (!mainMenu) {
        throw new Error("Login failed - could not access main menu");
    }

    progressCallback({
        log: 'Login successful',
        logType: 'success'
    });

    await page.goto("https://itax.kra.go.ke/KRA-Portal/");
}

async function navigateToGeneralLedger(page, progressCallback) {
    const menuItemsSelector = [
        "#ddtopmenubar > ul > li:nth-child(12) > a",
        "#ddtopmenubar > ul > li:nth-child(11) > a"
    ];
    
    let dynamicElementFound = false;
    for (const selector of menuItemsSelector) {
        if (dynamicElementFound) break;

        await page.reload();
        const menuItem = await page.$(selector);

        if (menuItem) {
            const bbox = await menuItem.boundingBox();
            if (bbox) {
                const x = bbox.x + bbox.width / 2;
                const y = bbox.y + bbox.height / 2;
                await page.mouse.move(x, y);
                dynamicElementFound = await page.waitForSelector("#My\\ Ledger", { timeout: 1000 })
                    .then(() => true).catch(() => false);
            }
        }
    }

    if (!dynamicElementFound) {
        throw new Error("Could not find General Ledger menu");
    }

    await page.evaluate(() => {
        showGeneralLedgerForm();
    });

    progressCallback({
        log: 'General ledger form loaded'
    });
}

async function configureGeneralLedger(page, progressCallback) {
    await page.click("#cmbTaxType");
    await page.locator("#cmbTaxType").selectOption("ALL", { timeout: 1000 });
    await page.click("#cmdShowLedger");
    await page.click("#chngroup");
    await page.locator("#chngroup").selectOption("Tax Obligation");
    await page.waitForLoadState("load");

    progressCallback({
        log: 'Configuring pagination settings...'
    });

    // Set pagination
    await page.evaluate(() => {
        const changeSelectOptions = () => {
            const selectElements = document.querySelectorAll("select.ui-pg-selbox");
            selectElements.forEach(selectElement => {
                Array.from(selectElement.options).forEach(option => {
                    if (["1000", "500", "50", "20", "100", "200"].includes(option.text)) {
                        option.value = "20000";
                    }
                });
            });
        };
        changeSelectOptions();
    });

    await page.waitForTimeout(2000);

    try {
        await page.locator("#pagerGeneralLedgerDtlsTbl_center > table > tbody > tr > td:nth-child(8) > select")
            .selectOption("50", { timeout: 5000 });
    } catch (error) {
        progressCallback({
            log: 'Could not set pagination - continuing with default',
            logType: 'warning'
        });
    }

    await page.waitForTimeout(2500);
}

async function extractLedgerData(page, company, downloadPath, progressCallback) {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("General Ledger");
    
    // Add title
    const titleRow = worksheet.addRow([
        "", `KRA GENERAL LEDGER - ${company.name}`, "", `Extraction Date: ${new Date().toLocaleDateString()}`
    ]);
    highlightCells(titleRow, "B", "D", "FFADD8E6", true);
    worksheet.addRow();

    let recordCount = 0;
    let extractedData = [];

    try {
        const ledgerTable = await page.locator("#gridGeneralLedgerDtlsTbl").first();
        
        if (ledgerTable) {
            progressCallback({
                log: 'Extracting general ledger data...'
            });

            // Extract table headers and data dynamically
            const tableData = await ledgerTable.evaluate(table => {
                const headerRow = table.querySelector("thead tr") || table.querySelector("tr");
                const headers = [];
                
                if (headerRow) {
                    const headerCells = Array.from(headerRow.querySelectorAll("th, td"));
                    headerCells.forEach(cell => {
                        headers.push(cell.innerText.trim());
                    });
                }
                
                const dataRows = Array.from(table.querySelectorAll("tbody tr"));
                const rows = dataRows.map(row => {
                    const cells = Array.from(row.querySelectorAll("td"));
                    return cells.map(cell => cell.innerText.trim());
                });
                
                return { headers, rows };
            });

            const { headers, rows } = tableData;
            
            if (rows.length > 0) {
                recordCount = rows.length;
                
                progressCallback({
                    log: `Found ${recordCount} general ledger records with ${headers.length} columns`
                });

                // Add header (2 empty columns for spacing + all dynamic headers)
                const headerRow = worksheet.addRow(["", "", ...headers]);
                
                // Calculate end column letter dynamically
                const endColIndex = headers.length + 2; // +2 for the 2 empty columns
                const endColLetter = String.fromCharCode(64 + endColIndex); // Convert to letter (C, D, E, etc.)
                highlightCells(headerRow, "C", endColLetter, "FFC0C0C0", true);

                // Add data rows (2 empty columns + all data columns)
                rows
                    .filter(row => row.some(cell => cell.trim() !== ""))
                    .forEach(row => {
                        const excelRow = worksheet.addRow(["", "", ...row]);
                        
                        // Store data for UI display with dynamic column mapping
                        const dataObject = {
                            isTotal: row[0] && row[0].toLowerCase().includes('total')
                        };
                        
                        // Map each column dynamically
                        headers.forEach((header, index) => {
                            // Create safe property name from header
                            const propName = header
                                .toLowerCase()
                                .replace(/[^a-z0-9]/g, '_')
                                .replace(/_+/g, '_')
                                .replace(/^_|_$/g, '') || `col_${index}`;
                            dataObject[propName] = row[index] || '';
                        });
                        
                        // Keep original column values for backward compatibility
                        dataObject.columns = row;
                        dataObject.headers = headers;
                        
                        extractedData.push(dataObject);
                        
                        // Auto-detect and format numeric columns
                        row.forEach((cellValue, colIndex) => {
                            if (cellValue && cellValue !== '-') {
                                const numValue = parseFloat(cellValue.replace(/,/g, ''));
                                if (!isNaN(numValue) && cellValue.match(/[\d,]+\.?\d*/)) {
                                    const excelColIndex = colIndex + 3; // +3 for 2 empty columns + 1-based indexing
                                    const cell = excelRow.getCell(excelColIndex);
                                    cell.value = numValue;
                                    cell.numFmt = '#,##0.00';
                                    cell.alignment = { vertical: 'middle', horizontal: 'right' };
                                }
                            }
                        });
                    });

            } else {
                worksheet.addRow(["", "", "No general ledger records found"]);
            }

        } else {
            throw new Error("General ledger table not found");
        }

    } catch (error) {
        progressCallback({
            log: `Error extracting general ledger: ${error.message}`,
            logType: 'warning'
        });
        worksheet.addRow(["", "", "Error extracting general ledger data"]);
    }

    // Auto-adjust column widths dynamically
    worksheet.getColumn('A').width = 3;  // Empty
    worksheet.getColumn('B').width = 3;  // Empty
    
    // Set widths for data columns dynamically
    worksheet.columns.forEach((column, columnIndex) => {
        if (columnIndex < 2) return; // Skip the two empty columns
        
        let maxLength = 0;
        column.eachCell({ includeEmpty: false }, cell => {
            const cellLength = cell.value ? cell.value.toString().length : 0;
            if (cellLength > maxLength) {
                maxLength = cellLength;
            }
        });
        
        // Set width with reasonable min/max
        column.width = Math.max(10, Math.min(maxLength + 2, 50));
    });

    // Save General Ledger file
    const fileName = `GENERAL_LEDGER_${company.pin}_${new Date().toISOString().split('T')[0]}.xlsx`;
    const filePath = path.join(downloadPath, fileName);
    await workbook.xlsx.writeFile(filePath);
    
    progressCallback({
        log: `General ledger saved: ${fileName}`,
        logType: 'success'
    });

    return {
        fileName: fileName,
        recordCount: recordCount,
        data: extractedData
    };
}

async function solveCaptcha(page) {
    // Use system temp directory like agent-checker (more reliable in production)
    const tempDir = path.join(os.tmpdir(), 'KRA');
    const imagePath = path.join(tempDir, `captcha_ledger_${Date.now()}.png`);
    
    // Ensure temp directory exists
    await fs.mkdir(tempDir, { recursive: true });

    try {
        await page.waitForSelector("#captcha_img", { timeout: 10000 });
        await page.locator("#captcha_img").first().screenshot({ path: imagePath });

        const worker = await createWorker('eng', 1);
        const ret = await worker.recognize(imagePath);
        
        const text1 = ret.data.text.slice(0, -1);
        const text = text1.slice(0, -1);
        const numbers = text.match(/\d+/g);

        if (!numbers || numbers.length < 2) {
            throw new Error("Unable to extract valid numbers from CAPTCHA");
        }

        let result;
        if (text.includes("+")) {
            result = Number(numbers[0]) + Number(numbers[1]);
        } else if (text.includes("-")) {
            result = Number(numbers[0]) - Number(numbers[1]);
        } else {
            throw new Error("Unsupported arithmetic operator in CAPTCHA");
        }

        await worker.terminate();
        
        // Clean up temp file
        await fs.unlink(imagePath).catch(() => {});

        return result.toString();

    } catch (error) {
        // Clean up temp file on error
        await fs.unlink(imagePath).catch(() => {});
        throw error;
    }
}

function highlightCells(row, startCol, endCol, color, bold = false) {
    for (let col = startCol.charCodeAt(0); col <= endCol.charCodeAt(0); col++) {
        const cell = row.getCell(String.fromCharCode(col));
        cell.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: color }
        };
        if (bold) {
            cell.font = { bold: true };
        }
    }
}

// Export ledger data to a shared workbook as a sheet
async function exportLedgerToSheet(workbookManager, extractedData) {
    const worksheet = workbookManager.addWorksheet('General Ledger');
    
    // Add title
    workbookManager.addTitleRow(worksheet, `KRA GENERAL LEDGER - ${workbookManager.company.name}`, `Extraction Date: ${new Date().toLocaleDateString()}`);
    
    // Add company info
    workbookManager.addCompanyInfoRow(worksheet);

    if (!extractedData || !extractedData.data || extractedData.data.length === 0) {
        worksheet.addRow(['', '', 'No general ledger records found']);
    } else {
        // Add header (2 empty columns to match format)
        const headers = [
            '', '', 'Sr.No.', 'Tax Obligation', 'Tax Period', 'Transaction Date',
            'Reference Number', 'Particulars', 'Transaction Type', 'Debit(Ksh)', 'Credit(Ksh)'
        ];
        const headerRow = worksheet.addRow(headers);
        workbookManager.highlightCells(worksheet, headerRow.number, 'C', 'K', 'FFC0C0C0');
        headerRow.getCell('C').font = { bold: true };
        headerRow.getCell('D').font = { bold: true };
        headerRow.getCell('E').font = { bold: true };
        headerRow.getCell('F').font = { bold: true };
        headerRow.getCell('G').font = { bold: true };
        headerRow.getCell('H').font = { bold: true };
        headerRow.getCell('I').font = { bold: true };
        headerRow.getCell('J').font = { bold: true };
        headerRow.getCell('K').font = { bold: true };

        // Add data
        extractedData.data.forEach((record, index) => {
            const row = worksheet.addRow([
                '', '',
                record.srNo || '',
                record.taxObligation || '',
                record.taxPeriod || '',
                record.transactionDate || '',
                record.referenceNumber || '',
                record.particulars || '',
                record.transactionType || '',
                record.debit || '',
                record.credit || ''
            ]);
            
            // Add borders to all data cells
            row.eachCell((cell, colNumber) => {
                if (colNumber > 2) {
                    cell.border = {
                        top: { style: 'thin' },
                        left: { style: 'thin' },
                        bottom: { style: 'thin' },
                        right: { style: 'thin' }
                    };
                    cell.alignment = { vertical: 'middle', wrapText: true };
                }
            });
            
            // Alternate row coloring
            if (index % 2 === 1) {
                row.eachCell((cell, colNumber) => {
                    if (colNumber > 2) {
                        cell.fill = {
                            type: 'pattern',
                            pattern: 'solid',
                            fgColor: { argb: 'FFF5F5F5' }
                        };
                    }
                });
            }
            
            // Format number columns
            const debitCell = row.getCell('J');  // Column J (Debit)
            const creditCell = row.getCell('K'); // Column K (Credit)
            
            if (record.debit && record.debit !== '-' && !isNaN(parseFloat(String(record.debit).replace(/,/g, '')))) {
                debitCell.value = parseFloat(String(record.debit).replace(/,/g, ''));
                debitCell.numFmt = '#,##0.00';
                debitCell.alignment = { vertical: 'middle', horizontal: 'right' };
            }
            
            if (record.credit && record.credit !== '-' && !isNaN(parseFloat(String(record.credit).replace(/,/g, '')))) {
                creditCell.value = parseFloat(String(record.credit).replace(/,/g, ''));
                creditCell.numFmt = '#,##0.00';
                creditCell.alignment = { vertical: 'middle', horizontal: 'right' };
            }
        });
    }

    // Set column widths to match format
    worksheet.getColumn('A').width = 3;  // Empty
    worksheet.getColumn('B').width = 3;  // Empty
    worksheet.getColumn('C').width = 8;  // Sr.No.
    worksheet.getColumn('D').width = 25; // Tax Obligation
    worksheet.getColumn('E').width = 15; // Tax Period
    worksheet.getColumn('F').width = 18; // Transaction Date
    worksheet.getColumn('G').width = 22; // Reference Number
    worksheet.getColumn('H').width = 45; // Particulars
    worksheet.getColumn('I').width = 20; // Transaction Type
    worksheet.getColumn('J').width = 18; // Debit(Ksh)
    worksheet.getColumn('K').width = 18; // Credit(Ksh)
    
    return worksheet;
}

module.exports = {
    runLedgerExtraction,
    exportLedgerToSheet
};
