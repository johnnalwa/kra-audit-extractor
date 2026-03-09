 const { chromium } = require("playwright");
const ExcelJS = require("exceljs");
const fs = require("fs").promises;
const path = require("path");
const os = require("os");
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

// Constants and date formatting
const now = new Date();
const formattedDateTime = `${now.getDate()}.${now.getMonth() + 1}.${now.getFullYear()}`;
const formattedDateTimeForExcel = `${now.getDate()}/${now.getMonth() + 1}/${now.getFullYear()}`;

// Enhanced Excel styling functions
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

function applyHeaderStyle(row, worksheet) {
    row.eachCell((cell) => {
        cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FF4472C4' }
        };
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
        cell.border = {
            top: { style: 'thin' },
            left: { style: 'thin' },
            bottom: { style: 'thin' },
            right: { style: 'thin' }
        };
    });
    row.height = 25;
}

function applySectionHeaderStyle(row) {
    row.eachCell((cell) => {
        cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FF5DFFC9' }
        };
        cell.font = { bold: true, size: 12 };
        cell.alignment = { horizontal: 'left', vertical: 'middle' };
    });
    row.height = 20;
}

function applyDataRowStyle(row, isEven = false) {
    row.eachCell((cell) => {
        cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: isEven ? 'FFF2F2F2' : 'FFFFFFFF' }
        };
        cell.border = {
            top: { style: 'thin', color: { argb: 'FFD3D3D3' } },
            left: { style: 'thin', color: { argb: 'FFD3D3D3' } },
            bottom: { style: 'thin', color: { argb: 'FFD3D3D3' } },
            right: { style: 'thin', color: { argb: 'FFD3D3D3' } }
        };
        cell.alignment = { vertical: 'middle', wrapText: true };
        
        // Right align numeric values
        if (cell.value && typeof cell.value === 'number') {
            cell.alignment = { horizontal: 'right', vertical: 'middle' };
            cell.numFmt = '#,##0.00';
        }
    });
}

function autoFitColumns(worksheet) {
    worksheet.columns.forEach((column) => {
        let maxLength = 10;
        column.eachCell({ includeEmpty: false }, (cell) => {
            const cellLength = cell.value ? cell.value.toString().length : 10;
            if (cellLength > maxLength) {
                maxLength = cellLength;
            }
        });
        column.width = Math.min(Math.max(maxLength + 2, 12), 50);
    });
}

function getMonthName(month) {
    const months = [
        "January", "February", "March", "April", "May", "June",
        "July", "August", "September", "October", "November", "December"
    ];
    return months[month - 1]; // Adjust month index to match array index (0-based)
}

// Function to parse date from DD/MM/YYYY format
function parseDate(dateString) {
    const [day, month, year] = dateString.split('/').map(Number);
    return new Date(year, month - 1, day); // month is 0-indexed in Date constructor
}

// Function to check if a date falls within the specified range
function isDateInRange(dateString, startYear, startMonth, endYear, endMonth) {
    // Skip non-date strings (headers, navigation elements, etc.)
    if (!dateString || !dateString.match(/^\d{2}\/\d{2}\/\d{4}$/)) {
        return false;
    }
    
    try {
        const date = parseDate(dateString);
        const startDate = new Date(startYear, startMonth - 1, 1);
        const endDate = new Date(endYear, endMonth, 0); // Last day of end month

        return date >= startDate && date <= endDate;
    } catch (error) {
        console.log(`Error parsing date: ${dateString}`);
        return false;
    }
}

async function runVATExtraction(company, dateRange, downloadPath, progressCallback) {
    // Initialize SharedWorkbookManager for company folder
    const workbookManager = new SharedWorkbookManager(company, downloadPath);
    const companyFolder = await workbookManager.initialize();
    
    progressCallback({
        log: `Company folder: ${companyFolder}`
    });

    progressCallback({
        stage: 'VAT Returns Extraction',
        message: 'Starting VAT extraction...',
        progress: 5
    });

    let browser = null;
    try {
        browser = await chromium.launch(getBrowserLaunchOptions(company));
        const context = await browser.newContext();
        const page = await context.newPage();
        
        // Set timeouts for better reliability
        page.setDefaultNavigationTimeout(180000);
        page.setDefaultTimeout(180000);

        const loginSuccess = await loginToKRA(page, company, progressCallback);
        if (!loginSuccess) {
            throw new Error('Login failed. Please check credentials and try again.');
        }

        const results = await processVATReturns(page, company, dateRange, companyFolder, workbookManager, progressCallback);

        await browser.close();

        progressCallback({
            stage: 'VAT Returns Extraction',
            message: 'VAT extraction completed successfully.',
            progress: 100
        });

        return {
            success: true,
            message: 'VAT returns extracted successfully.',
            files: [results.filePath],
            downloadPath: companyFolder,
            companyFolder: companyFolder,
            data: results.data,
            totalReturns: results.totalReturns,
            companyData: results.companyData, // Include detailed company data for UI
            extractionSummary: {
                companyName: company.name,
                kraPin: company.pin,
                extractionDate: formattedDateTime,
                dateRange: dateRange,
                totalReturns: results.totalReturns,
                sectionsExtracted: Object.keys(results.companyData?.filedReturns?.sections || {})
            }
        };

    } catch (error) {
        if (browser) {
            await browser.close();
        }
        console.error('Error during VAT extraction:', error);
        progressCallback({
            stage: 'VAT Returns Extraction',
            message: `Error: ${error.message}`,
            logType: 'error'
        });
        return { success: false, error: error.message };
    }
}

async function loginToKRA(page, company, progressCallback) {
    await page.goto("https://itax.kra.go.ke/KRA-Portal/");
    await page.waitForTimeout(1000);

    await page.locator("#logid").click();
    await page.locator("#logid").fill(company.pin);
    await page.evaluate(() => {
        CheckPIN();
    });

    try {
        await page.locator('input[name="xxZTT9p2wQ"]').fill(company.password, { timeout: 2000 });
    } catch (error) {
        progressCallback({ 
            log: `Could not fill password field for ${company.name}. Skipping this company.`,
            logType: 'error'
        });
        return false;
    }

    await page.waitForTimeout(1500);

    progressCallback({ log: 'Solving captcha...' });

    await page.waitForSelector("#captcha_img");
    const imagePath = path.join(os.tmpdir(), `ocr_vat_${company.pin}.png`);
    await page.locator("#captcha_img").first().screenshot({ path: imagePath });

    const worker = await createWorker('eng', 1);
    let result;

    const extractResult = async () => {
        const ret = await worker.recognize(imagePath);
        
        // Use the same proven method as password validation and obligation checker
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
    
    // Wait a bit for the page to process
    await page.waitForTimeout(2000);

    // Check if login was successful (look for main menu)
    const mainMenu = await page.waitForSelector("#ddtopmenubar > ul > li:nth-child(1) > a", { 
        timeout: 5000, 
        state: "visible" 
    }).catch(() => false);

    if (mainMenu) {
        progressCallback({ log: 'Login successful!' });
        await page.goto("https://itax.kra.go.ke/KRA-Portal/");
        return true;
    }

    // Check if there's an invalid login message
    const isInvalidLogin = await page.waitForSelector('b:has-text("Wrong result of the arithmetic operation.")', { 
        state: 'visible', 
        timeout: 3000 
    }).catch(() => false);

    if (isInvalidLogin) {
        progressCallback({ log: 'Wrong captcha result, retrying login...' });
        return loginToKRA(page, company, progressCallback);
    }

    // If no main menu and no invalid login message, something else went wrong
    progressCallback({ log: 'Login failed - unknown error, retrying...' });
    return loginToKRA(page, company, progressCallback);
}

async function navigateToVATReturns(page, progressCallback) {
    try {
        // Wait for the main page to load
        await page.waitForSelector('#ddtopmenubar > ul > li > a:has-text("Returns")', { timeout: 20000 });
        
        // Hover over Returns menu to activate dropdown
        await page.hover('#ddtopmenubar > ul > li > a:has-text("Returns")');
        await page.waitForTimeout(1000);

        // Click on "View E-Returns" using the function call
        await page.evaluate(() => {
            viewEReturns();
        });

        await page.waitForTimeout(2000);

        // Select VAT from dropdown
        await page.locator("#taxType").selectOption("Value Added Tax (VAT)");
        await page.click(".submit");

        // Handle first dialog
        page.once("dialog", dialog => {
            dialog.accept().catch(() => {});
        });
        await page.click(".submit");

        // Handle second dialog
        page.once("dialog", dialog => {
            dialog.accept().catch(() => {});
        });

        // Wait for VAT returns page to load
        await page.waitForTimeout(3000);

        progressCallback({
            log: 'VAT returns page loaded successfully'
        });

    } catch (error) {
        progressCallback({
            log: `Error navigating to VAT returns: ${error.message}`,
            logType: 'error'
        });
        throw error;
    }
}

async function extractVATData(page, company, dateRange, downloadPath, progressCallback) {
    const workbook = new ExcelJS.Workbook();
    const extractedFiles = [];
    const summary = {
        totalReturns: 0,
        nilReturns: 0,
        successfulExtractions: 0,
        errors: 0
    };

    // Create main worksheet
    const mainWorksheet = workbook.addWorksheet("VAT Returns Summary");
    
    // Add header
    const headerRow = mainWorksheet.addRow([
        "", "", "", "", "", `VAT FILED RETURNS SUMMARY - ${company.name}`
    ]);
    highlightCells(headerRow, "B", "M", "83EBFF", true);
    mainWorksheet.addRow();

    try {
        // Wait for the returns table to load
        await page.waitForSelector('table.tab3:has-text("Sr.No")', { timeout: 10000 });

        // Get all return rows from the table
        const returnRows = await page.$('table.tab3 tbody tr');
        summary.totalReturns = Math.max(0, returnRows.length - 1); // Subtract header row

        progressCallback({
            log: `Found ${summary.totalReturns} VAT return records`
        });

        if (summary.totalReturns === 0) {
            mainWorksheet.addRow(["", "", "No VAT returns found"]);
        } else {
            // Add company info row
            const companyRow = mainWorksheet.addRow([
                "",
                `${company.name}`,
                `Extraction Date: ${new Date().toLocaleDateString()}`
            ]);
            highlightCells(companyRow, "B", "M", "FFADD8E6", true);

            // Process each return (simplified for demonstration)
            for (let i = 1; i < Math.min(returnRows.length, 6); i++) { // Limit to 5 returns for demo
                const row = returnRows[i];
                
                try {
                    // Extract return period from the row
                    const returnPeriodCell = await row.$('td:nth-child(3)');
                    if (!returnPeriodCell) continue;

                    const returnPeriod = await returnPeriodCell.textContent();
                    const cleanDate = returnPeriod.trim();

                    progressCallback({
                        log: `Processing return for period: ${cleanDate}`,
                        progress: 50 + (i / summary.totalReturns) * 30
                    });

                    // Add basic return info to main worksheet
                    const returnInfoRow = mainWorksheet.addRow([
                        "", "", cleanDate, "Return processed", "Data extracted"
                    ]);

                    summary.successfulExtractions++;

                } catch (error) {
                    progressCallback({
                        log: `Error processing return ${i}: ${error.message}`,
                        logType: 'warning'
                    });
                    summary.errors++;
                }
            }
        }

    } catch (error) {
        progressCallback({
            log: `Error accessing VAT returns table: ${error.message}`,
            logType: 'warning'
        });
        
        mainWorksheet.addRow(["", "", "Error accessing VAT returns data"]);
        summary.errors++;
    }

    // Auto-fit columns
    mainWorksheet.columns.forEach((column, columnIndex) => {
        let maxLength = 0;
        for (let rowIndex = 2; rowIndex <= mainWorksheet.rowCount; rowIndex++) {
            const cell = mainWorksheet.getCell(rowIndex, columnIndex + 1);
            const cellLength = cell.value ? cell.value.toString().length : 0;
            if (cellLength > maxLength) {
                maxLength = cellLength;
            }
        }
        mainWorksheet.getColumn(columnIndex + 1).width = maxLength + 2;
    });

    // Save the main VAT file
    const fileName = `VAT_RETURNS_${company.pin}_${new Date().toISOString().split('T')[0]}.xlsx`;
    const filePath = path.join(downloadPath, fileName);
    await workbook.xlsx.writeFile(filePath);
    extractedFiles.push(fileName);

    return {
        files: extractedFiles,
        summary: summary,
        filePath: filePath
    };
}

async function processVATReturns(page, company, dateRange, downloadPath, workbookManager, progressCallback) {
    const workbook = new ExcelJS.Workbook();
    
    // Note: Removed "FILED RETURNS ALL MONTHS" worksheet as it's not being populated correctly
    // All data goes directly into section worksheets
    
    // Initialize company data structure
    const companyData = {
        companyName: company.name,
        kraPin: company.pin,
        extractionDate: formattedDateTime,
        filedReturns: {
            summary: [],
            sections: {
                sectionB: [],
                sectionB2: [],
                sectionE: [],
                sectionF: [],
                sectionF2: [],
                sectionK3: [],
                sectionM: [],
                sectionN: [],
                sectionO: []
            }
        }
    };

    // Create Section B worksheet
    const sectionBWorksheet = workbook.addWorksheet("Section B");
    const sectionBWorksheetHeader = sectionBWorksheet.addRow([
        "", "", "", "", `Section B : Sales and Output Tax on Sales for the period (General Rate)`
    ]);
    highlightCells(sectionBWorksheetHeader, "B", "N", "83EBFF", true);
    sectionBWorksheet.addRow();

    // Create Section B2 worksheet
    const sectionB2Worksheet = workbook.addWorksheet("Section B2 - TOTALS");
    const sectionB2WorksheetHeader = sectionB2Worksheet.addRow([
        "", "", `Section B2 : Sales and Output Tax on Sales for the period (General Rate)`
    ]);
    highlightCells(sectionB2WorksheetHeader, "B", "N", "83EBFF", true);
    sectionB2Worksheet.addRow();

    // Create Section E worksheet
    const sectionEWorksheet = workbook.addWorksheet("Section E");
    const sectionEWorksheetHeader = sectionEWorksheet.addRow(["", "", "", `Section E : Sales for the Period (Exempt)`]);
    highlightCells(sectionEWorksheetHeader, "B", "I", "83EBFF", true);
    sectionEWorksheet.addRow();

    // Create Section F worksheet
    const sectionFWorksheet = workbook.addWorksheet("Section F");
    const sectionFWorksheetHeader = sectionFWorksheet.addRow([
        "", "", "", "", "", `Section F : Purchases and Input Tax for the period (General Rate)`
    ]);
    highlightCells(sectionFWorksheetHeader, "B", "N", "83EBFF", true);
    sectionFWorksheet.addRow();

    // Create Section F2 worksheet
    const sectionF2Worksheet = workbook.addWorksheet("Section F2 - TOTALS");
    const sectionF2WorksheetHeader = sectionF2Worksheet.addRow([
        "", "", "", `Section F2 : TOTALS Purchases and Input Tax for the period (General Rate)`
    ]);
    highlightCells(sectionF2WorksheetHeader, "B", "N", "83EBFF", true);
    sectionF2Worksheet.addRow();

    // Create Section K3 worksheet
    const sectionK3Worksheet = workbook.addWorksheet("Section K3 ");
    const sectionK3WorksheetHeader = sectionK3Worksheet.addRow([
        "", "", "", `Section K3 : Credit Adjustment Voucher/Inventory Approval Order`
    ]);
    highlightCells(sectionK3WorksheetHeader, "B", "N", "83EBFF", true);
    sectionK3Worksheet.addRow();

    // Create Section M worksheet
    const sectionMWorksheet = workbook.addWorksheet("Section M");
    const sectionMWorksheetHeader = sectionMWorksheet.addRow(["", "", "", `Section M : Sales (Goods and Services)`]);
    highlightCells(sectionMWorksheetHeader, "B", "G", "83EBFF", true);
    sectionMWorksheet.addRow();

    // Create Section N worksheet
    const sectionNWorksheet = workbook.addWorksheet("Section N");
    const sectionNWorksheetHeader = sectionNWorksheet.addRow(["", "", "", `Section N : Purchases (Goods and Services)`]);
    highlightCells(sectionNWorksheetHeader, "B", "G", "83EBFF", true);
    sectionNWorksheet.addRow();

    // Create Section O worksheet
    const sectionOWorksheet = workbook.addWorksheet("Section O");
    const sectionOWorksheetHeader = sectionOWorksheet.addRow(["", "", "", `Section O : Calculation of Tax Due`]);
    highlightCells(sectionOWorksheetHeader, "B", "E", "83EBFF", true);
    sectionOWorksheet.addRow();

    // Main worksheet header removed - data goes directly to section worksheets

    // Create section worksheets object for processing
    const sectionWorksheets = {
        sectionB: { worksheet: sectionBWorksheet, name: "Section B" },
        sectionB2: { worksheet: sectionB2Worksheet, name: "Section B2" },
        sectionE: { worksheet: sectionEWorksheet, name: "Section E" },
        sectionF: { worksheet: sectionFWorksheet, name: "Section F" },
        sectionF2: { worksheet: sectionF2Worksheet, name: "Section F2" },
        sectionK3: { worksheet: sectionK3Worksheet, name: "Section K3" },
        sectionM: { worksheet: sectionMWorksheet, name: "Section M" },
        sectionN: { worksheet: sectionNWorksheet, name: "Section N" },
        sectionO: { worksheet: sectionOWorksheet, name: "Section O" }
    };

    // Navigate to VAT returns
    await navigateToVATReturns(page, progressCallback);

    // Determine date range - improved logic from SALES & PURCHASE.js
    let startYear, startMonth, endYear, endMonth;
    
    if (dateRange && dateRange.type === 'custom') {
        startYear = dateRange.startYear || 2015;
        startMonth = dateRange.startMonth || 1;
        endYear = dateRange.endYear || new Date().getFullYear();
        endMonth = dateRange.endMonth || 12;
    } else if (dateRange && dateRange.type === 'range') {
        // Handle UI date range format
        startYear = dateRange.startYear || 2015;
        startMonth = dateRange.startMonth || 1;
        endYear = dateRange.endYear || new Date().getFullYear();
        endMonth = dateRange.endMonth || 12;
    } else {
        // Default to current year range
        const currentDate = new Date();
        startYear = 2015;
        startMonth = 1;
        endYear = currentDate.getFullYear();
        endMonth = 12;
    }

    progressCallback({
        log: `Looking for returns between ${startMonth}/${startYear} and ${endMonth}/${endYear}`
    });

    // Extract main returns table data first
    await extractMainReturnsData(page, companyData, progressCallback);

    // Wait for the returns table to load
    await page.waitForSelector('table.tab3:has-text("Sr.No")', { timeout: 10000 });

    // Get all the return rows from the table
    const returnRows = await page.$$('table.tab3 tbody tr');

    let processedCount = 0;
    let extractedData = [];
    let companyNameRowAdded = false;

    // Process each return with detailed extraction
    for (let i = 1; i < returnRows.length; i++) { // Start from 1 to skip header row
        const row = returnRows[i];

        try {
            // Extract the "Return Period from" date (3rd column)
            const returnPeriodFromCell = await row.$('td:nth-child(3)');
            if (!returnPeriodFromCell) continue;

            const returnPeriodFrom = await returnPeriodFromCell.textContent();
            const cleanDate = returnPeriodFrom.trim();

            progressCallback({ log: `Checking return period: ${cleanDate}` });

            // Check if this return falls within our desired date range
            if (!isDateInRange(cleanDate, startYear, startMonth, endYear, endMonth)) {
                progressCallback({ log: `Skipping ${cleanDate} - outside requested range` });
                continue;
            }

            progressCallback({ log: `Processing return for period: ${cleanDate}` });

            // Parse the date to get month and year
            const parsedDate = parseDate(cleanDate);
            const month = parsedDate.getMonth() + 1; // Convert back to 1-based month
            const year = parsedDate.getFullYear();
            const periodKey = `${getMonthName(month)} ${year}`;

            // Extract detailed data from the return
            const viewLinkCell = await row.$('td:nth-child(11) a');
            if (viewLinkCell) {
                try {
                    await viewLinkCell.click();
                    const page2Promise = await page.waitForEvent("popup");
                    const page2 = await page2Promise;
                    await page2.waitForLoadState("load");

                    // Check for nil return
                    const nilReturnCount = await page2.locator('text=DETAILS OF OTHER SECTIONS ARE NOT AVAILABLE AS THE RETURN YOU ARE TRYING TO VIEW IS A NIL RETURN').count();

                    if (nilReturnCount > 0) {
                        progressCallback({ log: `${periodKey} is a NIL RETURN - skipping detailed extraction` });

                        const nilMessage = "NIL RETURN - No data available";

                        // Add nil return data to company structure
                        const nilReturnData = {
                            period: periodKey,
                            date: cleanDate,
                            month: month,
                            year: year,
                            type: "NIL_RETURN",
                            message: nilMessage
                        };

                        Object.keys(companyData.filedReturns.sections).forEach(sectionKey => {
                            companyData.filedReturns.sections[sectionKey].push({
                                ...nilReturnData,
                                section: sectionKey
                            });
                        });
                    } else {
                        // Extract detailed section data - matching original format
                        await extractDetailedSectionDataOriginalFormat(
                            page2, 
                            sectionWorksheets, 
                            null, // No main worksheet - data goes to section worksheets
                            company, 
                            month, 
                            year, 
                            cleanDate, 
                            periodKey, 
                            companyNameRowAdded,
                            progressCallback
                        );
                        companyNameRowAdded = true;
                    }

                    await page2.close();
                } catch (detailError) {
                    progressCallback({
                        log: `Error extracting detailed data for ${cleanDate}: ${detailError.message}`,
                        logType: 'warning'
                    });
                }
            }

            // Store extracted data
            extractedData.push({
                period: cleanDate,
                month: getMonthName(month),
                year: year,
                status: 'Processed'
            });

            processedCount++;

            // Update progress
            progressCallback({
                progress: 50 + (processedCount / Math.min(returnRows.length - 1, 10)) * 40,
                log: `Processed return for ${getMonthName(month)} ${year}`
            });

        } catch (error) {
            progressCallback({
                log: `Error processing return row ${i}: ${error.message}`,
                logType: 'warning'
            });
            continue;
        }
    }

    progressCallback({ log: `Total returns processed: ${processedCount}` });

    if (processedCount === 0) {
        progressCallback({ log: `No returns found in the specified date range: ${startMonth}/${startYear} to ${endMonth}/${endYear}` });

        // Add no data message to company structure
        const noDataMessage = {
            period: `${startMonth}/${startYear} to ${endMonth}/${endYear}`,
            type: "NO_DATA",
            message: "No returns found for specified period"
        };

        Object.keys(companyData.filedReturns.sections).forEach(sectionKey => {
            companyData.filedReturns.sections[sectionKey].push({
                ...noDataMessage,
                section: sectionKey
            });
        });
    }

    // Auto-fit all worksheets
    workbook.eachSheet((worksheet) => {
        autoFitColumns(worksheet);
    });

    // Auto-fit columns for all worksheets
    workbook.eachSheet((ws) => {
        ws.columns.forEach((column, columnIndex) => {
            let maxLength = 0;
            for (let rowIndex = 2; rowIndex <= ws.rowCount; rowIndex++) {
                const cell = ws.getCell(rowIndex, columnIndex + 1);
                const cellLength = cell.value ? cell.value.toString().length : 0;
                if (cellLength > maxLength) {
                    maxLength = cellLength;
                }
            }
            ws.getColumn(columnIndex + 1).width = maxLength + 2;
        });
    });

    // Save the Excel file using SharedWorkbookManager in company folder
    const fileName = `VAT_FILED_RETURNS_${company.pin}_${formattedDateTime}.xlsx`;
    const filePath = path.join(downloadPath, fileName);
    await workbook.xlsx.writeFile(filePath);
    
    progressCallback({
        log: `VAT returns saved to: ${fileName}`,
        logType: 'success'
    });

    // Save detailed data to JSON
    const jsonFilePath = await saveVATDataToJSON(companyData, downloadPath, progressCallback);

    // Log extraction completion
    progressCallback({
        log: `VAT data extraction completed for ${company.name}`
    });

    return {
        filePath,
        data: extractedData,
        totalReturns: processedCount,
        companyData: companyData // Include detailed company data
    };
}

// Function to save extracted data to JSON file
async function saveVATDataToJSON(companyData, downloadPath, progressCallback) {
    try {
        progressCallback({
            log: `Saving VAT data to JSON for ${companyData.companyName}...`
        });

        const jsonData = {
            extractionDate: formattedDateTime,
            company: companyData
        };

        const jsonFileName = `VAT_Data_${companyData.kraPin}_${formattedDateTime.replace(/\./g, '-')}.json`;
        const jsonFilePath = path.join(downloadPath, jsonFileName);
        
        await fs.writeFile(jsonFilePath, JSON.stringify(jsonData, null, 2), 'utf8');
        
        progressCallback({
            log: `✅ VAT data saved to JSON: ${jsonFileName}`
        });
        
        return jsonFilePath;
    } catch (error) {
        progressCallback({
            log: `Error saving VAT data to JSON: ${error.message}`,
            logType: 'error'
        });
        return null;
    }
}

async function extractMainReturnsData(page, companyData, progressCallback) {
    try {
        const returnsTableLocator = await page.locator('table.tab3:has-text("Sr.No")');

        if (returnsTableLocator) {
            const returnsTable = await returnsTableLocator.first();

            if (returnsTable) {
                const tableContent = await returnsTable.evaluate(table => {
                    const rows = Array.from(table.querySelectorAll("tr"));
                    return rows.map(row => {
                        const cells = Array.from(row.querySelectorAll("td"));
                        return cells.map(cell => cell.innerText.trim());
                    });
                });

                // Convert table content to structured data
                const headers = tableContent[0] || [];
                const dataRows = tableContent.slice(1);

                companyData.filedReturns.summary = dataRows.map(row => {
                    const rowData = {};
                    headers.forEach((header, index) => {
                        rowData[header] = row[index] || '';
                    });
                    return rowData;
                });

                progressCallback({
                    log: `Extracted main returns table with ${dataRows.length} records`
                });

            } else {
                progressCallback({
                    log: `${companyData.companyName}: Returns table not found.`,
                    logType: 'warning'
                });
                companyData.filedReturns.summary = [{ error: "Returns table not found" }];
            }
        } else {
            progressCallback({
                log: `${companyData.companyName}: Returns table locator not found.`,
                logType: 'warning'
            });
            companyData.filedReturns.summary = [{ error: "Returns table locator not found" }];
        }
    } catch (error) {
        progressCallback({
            log: `Error extracting main returns data for ${companyData.companyName}: ${error.message}`,
            logType: 'error'
        });
        companyData.filedReturns.summary = [{ error: error.message }];
    }
}

// New function for enhanced extraction with separate worksheets
async function extractDetailedSectionDataWithWorksheets(page2, sectionWorksheets, month, year, cleanDate, periodKey, progressCallback) {
    // Configure page for maximum data display
    await page2.evaluate(() => {
        const selectElements = document.querySelectorAll(".ui-pg-selbox");
        selectElements.forEach(selectElement => {
            Array.from(selectElement.options).forEach(option => {
                if (option.text === "20") {
                    option.value = "20000";
                }
            });
        });
    });

    const selectElements = await page2.$$(".ui-pg-selbox");
    for (const selectElement of selectElements) {
        try {
            await selectElement.click();
            await page2.keyboard.press("ArrowDown");
            await page2.keyboard.press("Enter");
        } catch (error) {
            // Continue
        }
    }

    // Extract each section and populate its worksheet
    for (const [sectionKey, { worksheet, config }] of Object.entries(sectionWorksheets)) {
        try {
            const tableLocator = await page2.waitForSelector(getSectionSelector(sectionKey), { timeout: 2000 }).catch(() => null);

            if (!tableLocator) {
                progressCallback({
                    log: `⚠️ ${config.name} not found for ${periodKey}`,
                    logType: 'warning'
                });
                continue;
            }

            const tableContent = await tableLocator.evaluate(table => {
                const rows = Array.from(table.querySelectorAll("tr"));
                return rows.map(row => {
                    const cells = Array.from(row.querySelectorAll("td"));
                    return cells.map(cell => cell.innerText.trim());
                });
            });

            if (tableContent.length <= 1) {
                progressCallback({
                    log: `ℹ️ No records in ${config.name} for ${periodKey}`
                });
                continue;
            }

            // Add period header
            const periodRow = worksheet.addRow([periodKey]);
            worksheet.mergeCells(`A${periodRow.number}:${String.fromCharCode(64 + config.headers.length)}${periodRow.number}`);
            applySectionHeaderStyle(periodRow);
            
            // Add column headers
            const headerRow = worksheet.addRow(config.headers);
            applyHeaderStyle(headerRow, worksheet);
            
            // Add data rows with alternating colors
            const dataRows = tableContent.filter(row => row.some(cell => cell.trim() !== ""));
            let rowIndex = 0;
            
            for (const dataRow of dataRows) {
                // Convert numeric values
                const processedRow = dataRow.map((cell, index) => {
                    const header = config.headers[index];
                    if (header && (header.includes('Ksh') || header.includes('Amount') || header.includes('Value'))) {
                        const numericValue = cell.replace(/,/g, '');
                        if (!isNaN(numericValue) && numericValue !== '') {
                            return Number(numericValue);
                        }
                    }
                    return cell;
                });
                
                const excelRow = worksheet.addRow(processedRow);
                applyDataRowStyle(excelRow, rowIndex % 2 === 0);
                rowIndex++;
            }
            
            // Add spacing
            worksheet.addRow([]);
            
            progressCallback({
                log: `✅ ${config.name} - ${dataRows.length} records`
            });

        } catch (error) {
            progressCallback({
                log: `❌ Error extracting ${config.name}: ${error.message}`,
                logType: 'error'
            });
        }
    }
}

// Helper function to get selector for a section
function getSectionSelector(sectionKey) {
    const selectors = {
        sectionF: "#gview_gridsch5Tbl",
        sectionB: "#gridGeneralRateSalesDtlsTbl",
        sectionB2: "#GeneralRateSalesDtlsTbl",
        sectionE: "#gridSch4Tbl",
        sectionF2: "#sch5Tbl",
        sectionK3: "#gridVoucherDtlTbl",
        sectionM: "#viewReturnVat > table > tbody > tr:nth-child(7) > td > table:nth-child(3)",
        sectionN: "#viewReturnVat > table > tbody > tr:nth-child(7) > td > table:nth-child(5)",
        sectionO: "#viewReturnVat > table > tbody > tr:nth-child(8) > td > table.panelGrid.tablerowhead"
    };
    return selectors[sectionKey] || null;
}

async function extractDetailedSectionData(page2, companyData, month, year, cleanDate, progressCallback) {
    const periodKey = `${getMonthName(month)} ${year}`;

    // Configure page for data extraction (from SALES & PURCHASE.js)
    await page2.evaluate(() => {
        const changeSelectOptions = () => {
            const selectElements = document.querySelectorAll(".ui-pg-selbox");
            selectElements.forEach(selectElement => {
                Array.from(selectElement.options).forEach(option => {
                    if (option.text === "20") {
                        option.value = "20000";
                    }
                });
            });
        };
        changeSelectOptions();
    });

    const selectElements = await page2.$$(".ui-pg-selbox");
    for (const selectElement of selectElements) {
        try {
            await selectElement.click();
            await page2.keyboard.press("ArrowDown");
            await page2.keyboard.press("Enter");
        } catch (error) {
            // Continue if select element interaction fails
        }
    }

    try {
        await page2.locator("#pagersch5Tbl_center > table > tbody > tr > td:nth-child(8) > select").selectOption("20");
    } catch (error) {
        // Continue if this specific selector fails
    }

    // Section definitions with their selectors (from SALES & PURCHASE.js)
    const sections = {
        sectionF: {
            selector: "#gview_gridsch5Tbl",
            name: "Section F - Purchases and Input Tax",
            headers: ["Type of Purchases", "PIN of Supplier", "Name of Supplier", "Invoice Date", "Invoice Number", "Description of Goods / Services", "Custom Entry Number", "Taxable Value (Ksh)", "Amount of VAT (Ksh)", "Relevant Invoice Number", "Relevant Invoice Date"]
        },
        sectionB: {
            selector: "#gridGeneralRateSalesDtlsTbl",
            name: "Section B - Sales and Output Tax",
            headers: ["PIN of Purchaser", "Name of Purchaser", "ETR Serial Number", "Invoice Date", "Invoice Number", "Description of Goods / Services", "Taxable Value (Ksh)", "Amount of VAT (Ksh)", "Relevant Invoice Number", "Relevant Invoice Date"]
        },
        sectionB2: {
            selector: "#GeneralRateSalesDtlsTbl",
            name: "Section B2 - Sales Totals",
            headers: ["Description", "Taxable Value (Ksh)", "Amount of VAT (Ksh)"]
        },
        sectionE: {
            selector: "#gridSch4Tbl",
            name: "Section E - Sales Exempt",
            headers: ["PIN of Purchaser", "Name of Purchaser", "ETR Serial Number", "Invoice Date", "Invoice Number", "Description of Goods / Services", "Sales Value (Ksh)"]
        },
        sectionF2: {
            selector: "#sch5Tbl",
            name: "Section F2 - Purchases Totals",
            headers: ["Description", "Taxable Value (Ksh)", "Amount of VAT (Ksh)"]
        },
        sectionK3: {
            selector: "#gridVoucherDtlTbl",
            name: "Section K3 - Credit Adjustment Voucher",
            headers: ["Credit Adjustment Voucher Number", "Date of Voucher", "Amount"]
        },
        sectionM: {
            selector: "#viewReturnVat > table > tbody > tr:nth-child(7) > td > table:nth-child(3)",
            name: "Section M - Sales Summary",
            headers: ["Sr.No.", "Details of Sales", "Amount (Excl. VAT) (Ksh)", "Rate (%)", "Amount of Output VAT (Ksh)"]
        },
        sectionN: {
            selector: "#viewReturnVat > table > tbody > tr:nth-child(7) > td > table:nth-child(5)",
            name: "Section N - Purchases Summary",
            headers: ["Sr.No.", "Details of Purchases", "Amount (Excl. VAT) (Ksh)", "Rate (%)", "Amount of Input VAT (Ksh)"]
        },
        sectionO: {
            selector: "#viewReturnVat > table > tbody > tr:nth-child(8) > td > table.panelGrid.tablerowhead",
            name: "Section O - Tax Calculation",
            headers: ["Sr.No.", "Descriptions", "Amount (Ksh)"]
        }
    };

    for (const [sectionKey, sectionConfig] of Object.entries(sections)) {
        try {
            const tableLocator = await page2.waitForSelector(sectionConfig.selector, { timeout: 2000 }).catch(() => null);

            const sectionData = {
                period: periodKey,
                date: cleanDate,
                month: month,
                year: year,
                section: sectionConfig.name,
                data: [],
                status: "success"
            };

            if (tableLocator) {
                const tableContent = await tableLocator.evaluate(table => {
                    const rows = Array.from(table.querySelectorAll("tr"));
                    return rows.map(row => {
                        const cells = Array.from(row.querySelectorAll("td"));
                        return cells.map(cell => cell.innerText.trim());
                    });
                });

                if (tableContent.length <= 1) {
                    sectionData.status = "no_records";
                    sectionData.message = "No records found";
                } else {
                    // Convert table data to structured format
                    const dataRows = tableContent.filter(row => row.some(cell => cell.trim() !== ""));

                    sectionData.data = dataRows.map(row => {
                        const rowData = {};
                        sectionConfig.headers.forEach((header, index) => {
                            let value = row[index] || '';

                            // Handle numeric values
                            if (header.includes('Ksh') || header.includes('Amount') || header.includes('Value')) {
                                const numericValue = value.replace(/,/g, '');
                                if (!isNaN(numericValue) && numericValue !== '') {
                                    value = Number(numericValue);
                                }
                            }

                            rowData[header] = value;
                        });
                        return rowData;
                    });
                }

                progressCallback({
                    log: `Extracted ${sectionConfig.name} - ${sectionData.data.length} records`
                });

            } else {
                sectionData.status = "not_found";
                sectionData.message = `${sectionConfig.name} table not found`;

                progressCallback({
                    log: `${sectionConfig.name} not found for ${periodKey}`,
                    logType: 'warning'
                });
            }

            // Add to company data
            companyData.filedReturns.sections[sectionKey].push(sectionData);

        } catch (error) {
            const errorData = {
                period: periodKey,
                date: cleanDate,
                month: month,
                year: year,
                section: sectionConfig.name,
                status: "error",
                error: error.message
            };

            companyData.filedReturns.sections[sectionKey].push(errorData);

            progressCallback({
                log: `Error extracting ${sectionConfig.name} for ${periodKey}: ${error.message}`,
                logType: 'error'
            });
        }
    }
}

async function createVATSummaryReport(extractedData, company, downloadPath) {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('VAT Extraction Summary');

    // Add title
    worksheet.mergeCells('A1:D1');
    const titleCell = worksheet.getCell('A1');
    titleCell.value = `VAT EXTRACTION SUMMARY - ${company.name}`;
    titleCell.font = { size: 16, bold: true };
    titleCell.alignment = { horizontal: 'center' };
    titleCell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF4F81BD' }
    };
    titleCell.font.color = { argb: 'FFFFFFFF' };

    // Add extraction date
    worksheet.mergeCells('A2:D2');
    const dateCell = worksheet.getCell('A2');
    dateCell.value = `Extracted on: ${new Date().toLocaleString()}`;
    dateCell.font = { size: 12, italic: true };
    dateCell.alignment = { horizontal: 'center' };

    // Add empty row
    worksheet.addRow([]);

    // Add summary statistics
    const summaryData = [
        ['Company Name', company.name],
        ['KRA PIN', company.pin],
        ['Total Returns Found', extractedData.summary.totalReturns],
        ['Successful Extractions', extractedData.summary.successfulExtractions],
        ['NIL Returns', extractedData.summary.nilReturns],
        ['Errors Encountered', extractedData.summary.errors],
        ['Extraction Date', new Date().toLocaleDateString()],
        ['Files Generated', extractedData.files.length]
    ];

    // Add headers
    const headerRow = worksheet.addRow(['Description', 'Value']);
    headerRow.font = { bold: true };
    headerRow.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFD3D3D3' }
    };

    // Add summary data
    summaryData.forEach(([desc, value]) => {
        const row = worksheet.addRow([desc, value]);
        
        // Add borders
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

    // Save summary file
    const summaryFileName = `VAT_Extraction_Summary_${company.pin}_${new Date().toISOString().split('T')[0]}.xlsx`;
    const summaryFilePath = path.join(downloadPath, summaryFileName);
    await workbook.xlsx.writeFile(summaryFilePath);

    return summaryFileName;
}

async function solveCaptcha(page) {
    // Use system temp directory like agent-checker (more reliable in production)
    const tempDir = path.join(os.tmpdir(), 'KRA');
    const imagePath = path.join(tempDir, `captcha_vat_${Date.now()}.png`);
    
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

// Helper function to safely check if table exists
async function safeTableCheck(page2, locator, timeout = 200) {
    try {
        await page2.waitForSelector(locator, { timeout });
        return await page2.locator(locator);
    } catch (error) {
        return null;
    }
}

// Helper function to add "Missing" row when table is not found
function addMissingRow(worksheet, sectionName, monthYear) {
    const monthYearRow = worksheet.addRow(["", "", `${monthYear}`]);
    highlightCells(monthYearRow, "C", "M", "FF5DFFC9", true);

    const missingRow = worksheet.addRow(["", "", "", "", `${sectionName} - Missing`]);
    highlightCells(missingRow, "C", "M", "FFFF9999", true);
    worksheet.addRow();
}

// Extract detailed section data in original format - matching FILED RETURNS VAT - MAIN.js
async function extractDetailedSectionDataOriginalFormat(
    page2,
    sectionWorksheets,
    mainWorksheet, // Optional - can be null if not using main summary sheet
    company,
    month,
    year,
    cleanDate,
    periodKey,
    companyNameRowAdded,
    progressCallback
) {
    // Configure page for maximum data display
    await page2.evaluate(() => {
        const changeSelectOptions = () => {
            const selectElements = document.querySelectorAll(".ui-pg-selbox");
            selectElements.forEach(selectElement => {
                Array.from(selectElement.options).forEach(option => {
                    if (option.text === "20") {
                        option.value = "20000";
                    }
                });
            });
        };
        changeSelectOptions();
    });

    const selectElements = await page2.$$(".ui-pg-selbox");
    for (const selectElement of selectElements) {
        try {
            await selectElement.click();
            await page2.keyboard.press("ArrowDown");
            await page2.keyboard.press("Enter");
        } catch (error) {
            // Continue
        }
    }

    try {
        await page2.locator("#pagersch5Tbl_center > table > tbody > tr > td:nth-child(8) > select").selectOption("20");
    } catch (error) {
        // Continue
    }

    // TABLE LOCATORS - using safe checking
    const sectionBTableLocator = await safeTableCheck(page2, "#gridGeneralRateSalesDtlsTbl");
    const sectionB2TableLocator = await safeTableCheck(page2, "#GeneralRateSalesDtlsTbl");
    const sectionETableLocator = await safeTableCheck(page2, "#gridSch4Tbl");
    const sectionFTableLocator = await safeTableCheck(page2, "#gview_gridsch5Tbl");
    const sectionF2TableLocator = await safeTableCheck(page2, "#sch5Tbl");
    const sectionK3TableLocator = await safeTableCheck(page2, "#gridVoucherDtlTbl");
    const sectionMTableLocator = await safeTableCheck(page2, "#viewReturnVat > table > tbody > tr:nth-child(7) > td > table:nth-child(3)");
    const sectionNTableLocator = await safeTableCheck(page2, "#viewReturnVat > table > tbody > tr:nth-child(7) > td > table:nth-child(5)");
    const sectionOTableLocator = await safeTableCheck(page2, "#viewReturnVat > table > tbody > tr:nth-child(8) > td > table.panelGrid.tablerowhead");

    // Process all sections using original format logic
    const sections = [
        { locator: sectionFTableLocator, key: 'sectionF', name: 'Section F', headers: ["", "", "Type of Purchases", "PIN of Supplier", "Name of Supplier", "Invoice Date", "Invoice Number", "Description of Goods / Services", "Custom Entry Number", "Taxable Value (Ksh)", "Amount of VAT (Ksh) (Taxable Value * VAT Rate%)", "Relevant Invoice Number", "Relevant Invoice Date"], highlightRange: ["C", "M"] },
        { locator: sectionBTableLocator, key: 'sectionB', name: 'Section B', headers: ["", "", "PIN of Purchaser", "Name of Purchaser", "ETR Serial Number", "Invoice Date", "Invoice Number", "Description of Goods / Services", "Taxable Value (Ksh)", "Amount of VAT (Ksh) (Taxable Value * VAT Rate%)", "Relevant Invoice Number", "Relevant Invoice Date"], highlightRange: ["C", "L"] },
        { locator: sectionB2TableLocator, key: 'sectionB2', name: 'Section B2', headers: ["", "", "Description", "Taxable Value (Ksh)", "Amount of VAT (Ksh)(Taxable Value*VAT Rate%)"], highlightRange: ["C", "G"] },
        { locator: sectionETableLocator, key: 'sectionE', name: 'Section E', headers: ["", "", "PIN of Purchaser", "Name of Purchaser", "ETR Serial Number", "Invoice Date", "Invoice Number", "Description of Goods / Services", "Sales Value (Ksh)"], highlightRange: ["C", "I"] },
        { locator: sectionF2TableLocator, key: 'sectionF2', name: 'Section F2', headers: ["", "", "Description", "Taxable Value (Ksh)", "Amount of VAT (Ksh) (Taxable Value * VAT Rate%)"], highlightRange: ["C", "G"] },
        { locator: sectionK3TableLocator, key: 'sectionK3', name: 'Section K3', headers: ["", "", "Credit Adjustment Voucher/Inventory Approval Order Number", "Date of Voucher", "Amount"], highlightRange: ["C", "G"] },
        { locator: sectionMTableLocator, key: 'sectionM', name: 'Section M', headers: ["", "", "Sr.No.", "Details of Sales", "Amount (Excl. VAT) (Ksh)", "Rate (%)", "Amount of Output VAT (Ksh)"], highlightRange: ["C", "G"] },
        { locator: sectionNTableLocator, key: 'sectionN', name: 'Section N', headers: ["", "", "Sr.No.", "Details of Purchases", "Amount (Excl. VAT) (Ksh)", "Rate (%)", "Amount of Input VAT (Ksh)"], highlightRange: ["C", "G"] },
        { locator: sectionOTableLocator, key: 'sectionO', name: 'Section O', headers: ["", "", "Sr.No.", "Descriptions", "Amount (Ksh)"], highlightRange: ["C", "E"] }
    ];

    for (const section of sections) {
        const worksheet = sectionWorksheets[section.key].worksheet;
        
        if (section.locator) {
            // Add company name (once per section per company)
            const companyNameRow = worksheet.addRow(["", `${company.name}`, `Extraction Date: ${formattedDateTime}`]);
            highlightCells(companyNameRow, "B", "M", "FFADD8E6", true);
            
            // Add month/year row
            const monthYearRow = worksheet.addRow(["", "", `${getMonthName(month)} ${year}`]);
            highlightCells(monthYearRow, "C", "M", "FF5DFFC9", true);

            try {
                const tableContent = await section.locator.evaluate(table => {
                    const rows = Array.from(table.querySelectorAll("tr"));
                    return rows.map(row => {
                        const cells = Array.from(row.querySelectorAll("td"));
                        return cells.map(cell => cell.innerText.trim());
                    });
                });

                if (tableContent.length <= 1) {
                    const noRecordsRow = worksheet.addRow(["", "", "", "", "No records found"]);
                    highlightCells(noRecordsRow, section.highlightRange[0], section.highlightRange[1], "FFFF0000", true);
                } else {
                    const headerRow = worksheet.addRow(section.headers);
                    highlightCells(headerRow, section.highlightRange[0], section.highlightRange[1], "FFADD8E", true);

                    tableContent
                        .filter(row => row.some(cell => cell.trim() !== ""))
                        .forEach(row => {
                            if (section.key === 'sectionF' && row.length >= 11) {
                                const jValue = Number(row[9]?.replace(/,/g, '') || 0);
                                const kValue = Number(row[10]?.replace(/,/g, '') || 0);
                                worksheet.addRow(["", "", ...row.slice(0, 9), jValue, kValue, ...row.slice(11)]);
                            } else {
                                worksheet.addRow(["", "", ...row]);
                            }
                        });
                }
            } catch (error) {
                progressCallback({ log: `Error extracting ${section.name}: ${error.message}`, logType: 'error' });
                const errorRow = worksheet.addRow(["", "", "", "", `${section.name} - Error extracting data`]);
                highlightCells(errorRow, section.highlightRange[0], section.highlightRange[1], "FFFF9999", true);
            }
            worksheet.addRow();
        } else {
            addMissingRow(worksheet, section.name, `${getMonthName(month)} ${year}`);
        }
    }

    // Add summary to main worksheet
    mainWorksheet.addRow(["", "", "", "", "All sections extracted successfully"]);
    mainWorksheet.addRow();

    progressCallback({ log: `Processed ${periodKey} - All sections extracted` });
}

module.exports = {
    runVATExtraction
};
