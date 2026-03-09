const { chromium } = require("playwright");
const fs = require("fs").promises;
const path = require("path");
const os = require("os");
const ExcelJS = require("exceljs");
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
let hours = now.getHours();
const ampm = hours < 12 ? 'AM' : 'PM';
hours = hours % 12 || 12; // Convert to 12-hour format
const formattedDateTime2 = `${now.getDate()}.${(now.getMonth() + 1)}.${now.getFullYear()} ${hours}_${now.getMinutes()} ${ampm}`;

// Utility functions for Excel formatting
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

function applyBorders(row, startCol, endCol, style = "thin") {
    for (let col = startCol.charCodeAt(0); col <= endCol.charCodeAt(0); col++) {
        const cell = row.getCell(String.fromCharCode(col));
        cell.border = {
            top: { style },
            left: { style },
            bottom: { style },
            right: { style }
        };
    }
}

function autoFitColumns(worksheet) {
    worksheet.columns.forEach(column => {
        let maxLength = 0;
        column.eachCell({ includeEmpty: false }, cell => {
            let cellLength = cell.value ? cell.value.toString().length : 0;
            if (cellLength > maxLength) {
                maxLength = cellLength;
            }
        });
        column.width = Math.min(50, Math.max(12, maxLength + 2)); // Set a minimum width
    });
}

function formatCurrencyCells(row, startCol, endCol) {
    for (let col = startCol.charCodeAt(0); col <= endCol.charCodeAt(0); col++) {
        const cell = row.getCell(String.fromCharCode(col));
        cell.numFmt = '#,##0.00';
        cell.alignment = { horizontal: 'right' };
    }
}

// Function to check if an option exists in a select element
async function optionExists(locator, value) {
    const options = await locator.locator('option').all();
    for (const option of options) {
        const optionValue = await option.getAttribute('value');
        if (optionValue === value) {
            return true;
        }
    }
    return false;
}

// Function to discover all available tax types dynamically
async function discoverAllTaxTypes(page, progressCallback) {
    progressCallback({ log: 'Method 2: Discovering all available tax types...' });
    
    const taxTypes = [];
    
    try {
        // Get all tax head options
        const taxHeadOptions = await page.locator('#cmbTaxHead option').evaluateAll(options => {
            return options.map(option => ({
                value: option.value,
                text: option.textContent.trim()
            })).filter(opt => opt.value && opt.value !== '' && opt.text !== 'Select');
        });
        
        progressCallback({ log: `Method 2: Found ${taxHeadOptions.length} tax heads: ${taxHeadOptions.map(t => t.text).join(', ')}` });
        
        // For each tax head, discover sub-heads
        for (const taxHead of taxHeadOptions) {
            try {
                await page.locator('#cmbTaxHead').selectOption(taxHead.value);
                await page.waitForTimeout(500);
                
                // Get sub-head options for this tax head
                const subHeadOptions = await page.locator('#cmbTaxSubHead option').evaluateAll(options => {
                    return options.map(option => ({
                        value: option.value,
                        text: option.textContent.trim()
                    })).filter(opt => opt.value && opt.value !== '' && opt.text !== 'Select');
                });
                
                // Add each valid combination
                for (const subHead of subHeadOptions) {
                    const taxTypeName = `${taxHead.text} - ${subHead.text}`;
                    taxTypes.push({
                        taxHead: taxHead.value,
                        taxSubHead: subHead.value,
                        name: taxTypeName,
                        taxHeadText: taxHead.text,
                        taxSubHeadText: subHead.text
                    });
                }
                
                progressCallback({ 
                    log: `Method 2: ${taxHead.text} has ${subHeadOptions.length} sub-types` 
                });
                
            } catch (error) {
                progressCallback({ 
                    log: `Method 2: Error processing tax head ${taxHead.text}: ${error.message}`, 
                    logType: 'warning' 
                });
            }
        }
        
        // Filter to common/important tax types if too many found
        const priorityTaxTypes = taxTypes.filter(tax => {
            const name = tax.name.toLowerCase();
            return name.includes('income tax') || 
                   name.includes('vat') || 
                   name.includes('paye') || 
                   name.includes('withholding') || 
                   name.includes('stamp duty') || 
                   name.includes('excise') || 
                   name.includes('rental') || 
                   name.includes('dividend') || 
                   name.includes('interest') || 
                   name.includes('royalty') || 
                   name.includes('management') || 
                   name.includes('professional') || 
                   name.includes('commission');
        });
        
        const finalTaxTypes = priorityTaxTypes.length > 0 ? priorityTaxTypes : taxTypes.slice(0, 15); // Limit to 15 if no priorities found
        
        progressCallback({ 
            log: `Method 2: Selected ${finalTaxTypes.length} tax types for processing` 
        });
        
        return finalTaxTypes;
        
    } catch (error) {
        progressCallback({ 
            log: `Method 2: Error discovering tax types: ${error.message}`, 
            logType: 'error' 
        });
        
        // Fallback to basic tax types
        return [
            { taxHead: 'IT', taxSubHead: '4', name: 'Income Tax - Company' },
            { taxHead: 'VAT', taxSubHead: '9', name: 'VAT' },
            { taxHead: 'IT', taxSubHead: '7', name: 'PAYE' }
        ];
    }
}

// Enhanced function to run both liabilities extraction methods
async function runLiabilitiesExtraction(company, downloadPath, progressCallback) {
    // Initialize shared workbook manager
    const workbookManager = new SharedWorkbookManager(company, downloadPath);
    const downloadFolderPath = await workbookManager.initialize();

    progressCallback({ 
        stage: 'Liabilities', 
        message: `Starting liabilities extraction...\nCompany folder: ${downloadFolderPath}`, 
        progress: 5 
    });

    let browser = null;
    try {
        browser = await chromium.launch(getBrowserLaunchOptions(company));
        const context = await browser.newContext();
        const page = await context.newPage();
        page.setDefaultNavigationTimeout(180000);
        page.setDefaultTimeout(180000);

        const loginSuccess = await loginToKRA(page, company, downloadFolderPath, progressCallback);
        if (!loginSuccess) {
            throw new Error('Login failed. Please check credentials and try again.');
        }

        // Run both methods
        progressCallback({ 
            stage: 'Liabilities', 
            message: 'Running Method 1: VAT Refund approach...', 
            progress: 30 
        });
        const method1Results = await runMethod1_VATRefund(page, company, downloadFolderPath, progressCallback);
        
        progressCallback({ 
            stage: 'Liabilities', 
            message: 'Running Method 2: Payment Registration approach...', 
            progress: 60 
        });
        const method2Results = await runMethod2_PaymentRegistration(page, company, downloadFolderPath, progressCallback);

        // Combine results and add to workbook
        progressCallback({ 
            stage: 'Liabilities', 
            message: 'Adding liabilities data to consolidated report...', 
            progress: 80 
        });
        const combinedResults = await combineMethodResults(method1Results, method2Results, company, workbookManager, progressCallback);
        
        // Save the workbook
        const savedWorkbook = await workbookManager.save();
        
        progressCallback({ 
            progress: 95,
            log: `Report saved: ${savedWorkbook.fileName}`
        });

        await browser.close();

        progressCallback({ 
            stage: 'Liabilities', 
            message: 'Liabilities extraction completed successfully.', 
            progress: 100 
        });
        
        return { 
            success: true, 
            message: 'Liabilities extracted successfully using both methods.', 
            files: [savedWorkbook.fileName], 
            downloadPath: downloadFolderPath,
            data: combinedResults.data,
            totalAmount: combinedResults.totalAmount,
            recordCount: combinedResults.recordCount,
            methods: {
                method1: method1Results,
                method2: method2Results
            }
        };

    } catch (error) {
        if (browser) {
            await browser.close();
        }
        console.error('Error during liabilities extraction:', error);
        progressCallback({ 
            stage: 'Liabilities', 
            message: `Error: ${error.message}`, 
            logType: 'error' 
        });
        return { success: false, error: error.message };
    }
}

// Login to KRA iTax portal
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
    

    // Check if login was successful (look for main menu)
    const mainMenu = await page.waitForSelector("#ddtopmenubar > ul > li:nth-child(1) > a", { 
        timeout: 5000, 
        state: "visible" 
    }).catch(() => false);

    if (mainMenu) {
        progressCallback({ log: 'Login successful!' });
        return true;
    }

    // Check if there's an invalid login message
    const isInvalidLogin = await page.waitForSelector('b:has-text("Wrong result of the arithmetic operation.")', { 
        state: 'visible', 
        timeout: 3000 
    }).catch(() => false);

    if (isInvalidLogin) {
        progressCallback({ log: 'Wrong captcha result, retrying login...' });
        return loginToKRA(page, company, downloadFolderPath, progressCallback);
    }

    // If no main menu and no invalid login message, something else went wrong
    progressCallback({ log: 'Login failed - unknown error, retrying...' });
    return loginToKRA(page, company, downloadFolderPath, progressCallback);
}

// Process a single company
async function processCompany(page, company, downloadFolderPath, progressCallback) {
    await page.goto("https://itax.kra.go.ke/KRA-Portal/");
    progressCallback({ log: `Processing company: ${company.name}` });

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet(`LIABILITIES-${formattedDateTime}`);

    // Add title row
    const titleRow = worksheet.addRow(["", "KRA LIABILITIES EXTRACTION REPORT", "", `Extraction Date: ${formattedDateTime}`]);
    worksheet.mergeCells('B1:C1');
    titleRow.getCell('B').font = { size: 14, bold: true };
    titleRow.getCell('B').alignment = { horizontal: 'center' };
    highlightCells(titleRow, "B", "F", "FF87CEEB", true);
    applyBorders(titleRow, "B", "F", "thin");
    worksheet.addRow();

    // Add company info row
    const companyNameRow = worksheet.addRow(["1", company.name, `Extraction Date: ${formattedDateTime}`]);
    worksheet.mergeCells(`C${companyNameRow.number}:J${companyNameRow.number}`);
    highlightCells(companyNameRow, "B", "F", "FFADD8E6", true);
    applyBorders(companyNameRow, "A", "F", "thin");

    if (!company.pin || !(company.pin.startsWith("P") || company.pin.startsWith("A"))) {
        progressCallback({ log: `Skipping ${company.name}: Invalid KRA PIN` });
        addNoDataRow(worksheet, "Invalid or Missing KRA PIN");
        worksheet.addRow([]);
        const filePath = path.join(downloadFolderPath, `AUTO-EXTRACT-LIABILITIES-${formattedDateTime}.xlsx`);
        await workbook.xlsx.writeFile(filePath);
        return { filePath };
    }

    progressCallback({ log: 'Navigating to VAT Refund section...' });
    await page.hover("#ddtopmenubar > ul > li:nth-child(6) > a");
    await page.evaluate(() => { showVATRefund(); });
    await page.waitForTimeout(3000);

    // Extract data from the specific table with id="3"
    const liabilitiesTable = await page.waitForSelector("table#\\33", { state: "visible", timeout: 5000 }).catch(() => null);

    addSectionHeader(worksheet, "Outstanding Liabilities", !!liabilitiesTable);

    let extractedData = [];
    let totalAmount = 0;

    if (liabilitiesTable) {
        progressCallback({ log: 'Extracting liabilities data from table...' });
        
        const headers = await liabilitiesTable.evaluate(table =>
            Array.from(table.querySelectorAll("thead th")).map(th => th.innerText.trim())
        );

        const headersRow = worksheet.addRow(["", "", ...headers]);
        highlightCells(headersRow, "C", "F", "FFD3D3D3", true);
        applyBorders(headersRow, "C", "F", "thin");

        const tableContent = await liabilitiesTable.evaluate(table =>
            Array.from(table.querySelectorAll("tbody tr")).map(row =>
                Array.from(row.querySelectorAll("td")).map(cell => cell.innerText.trim())
            )
        );

        tableContent.forEach(rowData => {
            const excelRow = worksheet.addRow(["", "", ...rowData]);
            applyBorders(excelRow, "C", "F", "thin");

            const amountText = rowData[3] || '0';
            const amountValue = parseFloat(amountText.replace(/,/g, ''));
            if (!isNaN(amountValue)) {
                totalAmount += amountValue;
            }

            // Store extracted data for UI display
            extractedData.push({
                taxType: rowData[0] || 'N/A',
                period: rowData[1] || 'N/A',
                dueDate: rowData[2] || 'N/A',
                amount: amountValue || 0,
                status: 'Outstanding'
            });

            const amountCell = excelRow.getCell('F');
            amountCell.numFmt = '#,##0.00';
            amountCell.alignment = { horizontal: 'right' };
        });

        const totalRow = worksheet.addRow(["", "", "TOTAL", "", "", totalAmount]);
        highlightCells(totalRow, "C", "F", "FFE4EE99", true);
        applyBorders(totalRow, "C", "F", "thin");

        const totalAmountCell = totalRow.getCell('F');
        totalAmountCell.numFmt = '#,##0.00';
        totalAmountCell.font = { bold: true };
        totalAmountCell.alignment = { horizontal: 'right' };

        progressCallback({ log: `Extracted ${tableContent.length} liability records with total amount: KES ${totalAmount.toLocaleString()}` });
    } else {
        addNoDataRow(worksheet, "No outstanding liabilities records found.");
        progressCallback({ log: 'No liabilities table found on the page' });
    }

    worksheet.addRow([]);

    // Auto-fit columns and save file
    autoFitColumns(worksheet);
    const filePath = path.join(downloadFolderPath, `AUTO-EXTRACT-LIABILITIES-${formattedDateTime}.xlsx`);
    await workbook.xlsx.writeFile(filePath);
    
    progressCallback({ log: `Excel file saved: ${filePath}` });
    
    // Logout
    await page.evaluate(() => { logOutUser(); });
    await page.waitForLoadState("load");
    
    return { 
        filePath,
        data: extractedData,
        totalAmount: totalAmount,
        recordCount: extractedData.length
    };
}

// Helper functions for Excel formatting
function addSectionHeader(worksheet, sectionTitle, isSuccess = true) {
    const headerRow = worksheet.addRow(["", "", sectionTitle]);
    worksheet.mergeCells(`C${headerRow.number}:J${headerRow.number}`);
    const bgColor = isSuccess ? "FF90EE90" : "FFFF7474"; // Green for success, Red for failure
    highlightCells(headerRow, "C", "F", bgColor, true);
    applyBorders(headerRow, "C", "F", "thin");
    headerRow.getCell('C').alignment = { horizontal: 'left', vertical: 'middle' };
    headerRow.height = 20;
}

function addNoDataRow(worksheet, message) {
    const noDataRow = worksheet.addRow(["", "", message]);
    worksheet.mergeCells(`C${noDataRow.number}:J${noDataRow.number}`);
    highlightCells(noDataRow, "C", "F", "FFFFF2F2");
    applyBorders(noDataRow, "C", "F", "thin");
    noDataRow.getCell('C').alignment = { horizontal: 'left', vertical: 'middle' };
}

// Method 1: VAT Refund approach (existing method)
async function runMethod1_VATRefund(page, company, downloadFolderPath, progressCallback) {
    progressCallback({ log: 'Method 1: VAT Refund approach...' });
    
    await page.goto("https://itax.kra.go.ke/KRA-Portal/");
    await page.waitForTimeout(2000);

    try {
        progressCallback({ log: 'Navigating to VAT Refund section...' });
        await page.hover("#ddtopmenubar > ul > li:nth-child(6) > a");
        await page.evaluate(() => { showVATRefund(); });
        await page.waitForTimeout(3000);

        const liabilitiesTable = await page.waitForSelector("table#\\33", { state: "visible", timeout: 5000 }).catch(() => null);

        let extractedData = [];
        let totalAmount = 0;

        if (liabilitiesTable) {
            progressCallback({ log: 'Method 1: Extracting liabilities data from VAT Refund table...' });
            
            const headers = await liabilitiesTable.evaluate(table =>
                Array.from(table.querySelectorAll("thead th")).map(th => th.innerText.trim())
            );

            const tableContent = await liabilitiesTable.evaluate(table =>
                Array.from(table.querySelectorAll("tbody tr")).map(row =>
                    Array.from(row.querySelectorAll("td")).map(cell => cell.innerText.trim())
                )
            );

            tableContent.forEach(rowData => {
                const amountText = rowData[3] || '0';
                const amountValue = parseFloat(amountText.replace(/,/g, ''));
                if (!isNaN(amountValue)) {
                    totalAmount += amountValue;
                }

                extractedData.push({
                    method: 'VAT Refund',
                    taxType: rowData[0] || 'N/A',
                    period: rowData[1] || 'N/A',
                    dueDate: rowData[2] || 'N/A',
                    amount: amountValue || 0,
                    status: 'Outstanding',
                    source: 'Method 1 - VAT Refund'
                });
            });

            progressCallback({ 
                log: `Method 1: Extracted ${tableContent.length} records with total: KES ${totalAmount.toLocaleString()}` 
            });
        } else {
            progressCallback({ log: 'Method 1: No VAT Refund liabilities table found' });
        }

        return {
            success: !!liabilitiesTable,
            data: extractedData,
            totalAmount: totalAmount,
            recordCount: extractedData.length,
            method: 'VAT Refund'
        };

    } catch (error) {
        progressCallback({ 
            log: `Method 1 error: ${error.message}`, 
            logType: 'warning' 
        });
        return {
            success: false,
            data: [],
            totalAmount: 0,
            recordCount: 0,
            method: 'VAT Refund',
            error: error.message
        };
    }
}

// Method 2: Payment Registration approach
async function runMethod2_PaymentRegistration(page, company, downloadFolderPath, progressCallback) {
    progressCallback({ log: 'Method 2: Payment Registration approach...' });
    
    await page.goto("https://itax.kra.go.ke/KRA-Portal/");
    await page.waitForTimeout(2000);

    let allExtractedData = [];
    let totalAmount = 0;

    try {
        // Navigate to Payment Registration form
        await page.hover("#ddtopmenubar > ul > li:nth-child(6) > a");
        await page.evaluate(() => { showPaymentRegForm(); });
        await page.click("#openPayRegForm");
        
        page.once("dialog", dialog => { dialog.accept().catch(() => { }); });
        await page.click("#openPayRegForm");
        page.once("dialog", dialog => { dialog.accept().catch(() => { }); });

        // Discover and process ALL available tax types dynamically
        const allTaxTypes = await discoverAllTaxTypes(page, progressCallback);
        
        progressCallback({ 
            log: `Method 2: Found ${allTaxTypes.length} tax types to process: ${allTaxTypes.map(t => t.name).join(', ')}` 
        });
        
        // Process each discovered tax type
        for (const taxType of allTaxTypes) {
            try {
                const results = await processPaymentRegistrationTax(
                    page, 
                    company, 
                    taxType.taxHead, 
                    taxType.taxSubHead, 
                    taxType.name, 
                    downloadFolderPath, 
                    progressCallback
                );
                
                if (results.data.length > 0) {
                    allExtractedData = allExtractedData.concat(results.data);
                    totalAmount += results.totalAmount;
                    
                    progressCallback({ 
                        log: `Method 2: ${taxType.name} - Added ${results.recordCount} records, Amount: KES ${results.totalAmount.toLocaleString()}` 
                    });
                }
            } catch (error) {
                progressCallback({ 
                    log: `Method 2: Error processing ${taxType.name}: ${error.message}`, 
                    logType: 'warning' 
                });
            }
        }

        progressCallback({ 
            log: `Method 2: Total extracted ${allExtractedData.length} records with total: KES ${totalAmount.toLocaleString()}` 
        });

        // Create breakdown by tax type
        const breakdown = {};
        allTaxTypes.forEach(taxType => {
            const taxData = allExtractedData.filter(record => record.taxType === taxType.name);
            if (taxData.length > 0) {
                // Get headers from first record
                const headers = taxData[0].rawData ? Object.keys(taxData[0].rawData) : [];
                breakdown[taxType.name] = {
                    data: taxData,
                    headers: headers,
                    recordCount: taxData.length,
                    totalAmount: taxData.reduce((sum, record) => sum + (record.totalAmountDue || 0), 0)
                };
            }
        });

        return {
            success: allExtractedData.length > 0,
            data: allExtractedData,
            totalAmount: totalAmount,
            recordCount: allExtractedData.length,
            method: 'Payment Registration',
            breakdown: breakdown,
            discoveredTaxTypes: allTaxTypes
        };

    } catch (error) {
        progressCallback({ 
            log: `Method 2 error: ${error.message}`, 
            logType: 'warning' 
        });
        return {
            success: false,
            data: allExtractedData,
            totalAmount: totalAmount,
            recordCount: allExtractedData.length,
            method: 'Payment Registration',
            error: error.message
        };
    }
}

// Helper function to process each tax type in Payment Registration
async function processPaymentRegistrationTax(page, company, taxHead, taxSubHead, taxName, downloadFolderPath, progressCallback) {
    let extractedData = [];
    let totalAmount = 0;
    let headers = [];

    try {
        progressCallback({ log: `Method 2: Processing ${taxName}...` });

        // Select tax type
        await page.locator("#cmbTaxHead").selectOption(taxHead);
        await page.waitForTimeout(1000);

        // Check if the sub-head option exists
        const subHeadExists = await optionExists(page.locator('#cmbTaxSubHead'), taxSubHead);
        
        if (!subHeadExists) {
            progressCallback({ log: `Method 2: ${taxName} option not available for this company` });
            return { data: extractedData, totalAmount: 0, recordCount: 0, headers: [], taxType: taxName };
        }

        await page.locator("#cmbTaxSubHead").selectOption(taxSubHead);
        await page.locator("#cmbPaymentType").selectOption("SAT");

        // Handle dialog if it appears
        page.once("dialog", dialog => { dialog.accept().catch(() => { }); });

        // Wait for liabilities table
        const liabilitiesTable = await page.waitForSelector("#LiablibilityTbl", { 
            state: "visible", 
            timeout: 3000 
        }).catch(() => null);

        if (liabilitiesTable) {
            // Extract headers dynamically from KRA table
            headers = await liabilitiesTable.evaluate(table => {
                const headerRow = table.querySelector("thead tr");
                return Array.from(headerRow.querySelectorAll("th")).map(th => th.innerText.trim());
            });

            const tableContent = await liabilitiesTable.evaluate(table => {
                const rows = Array.from(table.querySelectorAll("tbody tr"));
                return rows.map(row => {
                    const cells = Array.from(row.querySelectorAll("td"));
                    return cells.map(cell => {
                        if (cell.querySelector('input[type="text"]')) {
                            return cell.querySelector('input[type="text"]').value.trim();
                        } else {
                            return cell.innerText.trim();
                        }
                    });
                });
            });

            // Skip header row if present in data
            if (tableContent.length > 0 && tableContent[0].some(cell => headers.includes(cell))) {
                tableContent.shift();
            }

            // Process each row with dynamic column mapping
            tableContent.forEach(row => {
                // Skip empty rows or radio button rows
                if (row.length > 1 && row[1] && row[1] !== '') {
                    // Create a record with all available columns
                    const record = {
                        method: 'Payment Registration',
                        taxType: taxName,
                        source: `Method 2 - ${taxName}`,
                        rawData: {} // Store all column data
                    };

                    // Map all columns dynamically
                    headers.forEach((header, index) => {
                        if (index > 0 && row[index]) { // Skip first column (radio button)
                            const value = row[index].trim();
                            record.rawData[header] = value;
                            
                            // Map common fields
                            const headerLower = header.toLowerCase();
                            if (headerLower.includes('period')) {
                                record.taxPeriod = value;
                            } else if (headerLower.includes('due') && headerLower.includes('date')) {
                                record.dueDate = value;
                            } else if (headerLower.includes('principal')) {
                                record.principalAmount = parseFloat(value.replace(/[^0-9.-]+/g, "")) || 0;
                            } else if (headerLower.includes('penalty')) {
                                record.penalty = parseFloat(value.replace(/[^0-9.-]+/g, "")) || 0;
                            } else if (headerLower.includes('interest')) {
                                record.interest = parseFloat(value.replace(/[^0-9.-]+/g, "")) || 0;
                            } else if (headerLower.includes('amount') && (headerLower.includes('paid') || headerLower.includes('due') || headerLower.includes('payable'))) {
                                // This is the main amount to be paid - use this for totals
                                const numValue = parseFloat(value.replace(/[^0-9.-]+/g, "")) || 0;
                                if (numValue > 0) {
                                    record.totalAmountDue = numValue;
                                    totalAmount += numValue; // Only add the main amount to total
                                }
                            } else if (headerLower.includes('status')) {
                                record.status = value;
                            }
                        }
                    });

                    // Only add records with meaningful data
                    if (Object.keys(record.rawData).length > 0) {
                        extractedData.push(record);
                    }
                }
            });

            progressCallback({ 
                log: `Method 2: ${taxName} - Extracted ${extractedData.length} records, Amount: KES ${totalAmount.toLocaleString()}` 
            });
        } else {
            progressCallback({ log: `Method 2: No ${taxName} liabilities table found` });
        }

        await page.waitForTimeout(1000);

        // Take screenshot
        await page.screenshot({
            path: path.join(downloadFolderPath, `${company.name} - ${taxName} - Method2 - ${formattedDateTime2}.png`),
            fullPage: true
        });

    } catch (error) {
        progressCallback({ 
            log: `Method 2: Error processing ${taxName}: ${error.message}`, 
            logType: 'warning' 
        });
    }

    return { 
        data: extractedData, 
        totalAmount: totalAmount, 
        recordCount: extractedData.length,
        headers: headers.slice(1), // Remove first column (radio button)
        taxType: taxName
    };
}

// Combine results from both methods and add to shared workbook
async function combineMethodResults(method1Results, method2Results, company, workbookManager, progressCallback) {
    progressCallback({ log: 'Adding liabilities data to consolidated report...' });

    const worksheet = workbookManager.addWorksheet('Liabilities');

    // Add title row with company name prominently displayed
    const titleRow = worksheet.addRow([
        "", 
        `${company.name} - ENHANCED LIABILITIES EXTRACTION`, 
        "", 
        `Extraction Date: ${formattedDateTime}`
    ]);
    worksheet.mergeCells('B1:C1');
    titleRow.getCell('B').font = { size: 16, bold: true };
    titleRow.getCell('B').alignment = { horizontal: 'center' };
    highlightCells(titleRow, "B", "J", "FF4F81BD", true);
    titleRow.getCell('B').font.color = { argb: 'FFFFFFFF' };
    applyBorders(titleRow, "B", "J", "thin");

    // Add company details row
    const companyRow = worksheet.addRow([
        "", 
        `Company: ${company.name}`, 
        `PIN: ${company.pin}`, 
        `Methods: Both VAT Refund & Payment Registration`
    ]);
    highlightCells(companyRow, "B", "J", "FFADD8E6", true);
    applyBorders(companyRow, "B", "J", "thin");

    worksheet.addRow(); // Blank row

    // Combine all data
    const allData = [...method1Results.data, ...method2Results.data];
    const totalAmount = method1Results.totalAmount + method2Results.totalAmount;

    // Add summary section
    const summaryRow = worksheet.addRow([
        "", 
        "EXTRACTION SUMMARY", 
        `Method 1 Records: ${method1Results.recordCount}`, 
        `Method 2 Records: ${method2Results.recordCount}`,
        `Total Records: ${allData.length}`,
        `Total Amount: KES ${totalAmount.toLocaleString()}`
    ]);
    highlightCells(summaryRow, "B", "J", "FF90EE90", true);
    applyBorders(summaryRow, "B", "J", "thin");

    worksheet.addRow(); // Blank row

    // METHOD 1 SECTION - VAT Refund
    if (method1Results.data.length > 0) {
        // Method 1 Header
        const method1HeaderRow = worksheet.addRow([
            "", 
            "📋 METHOD 1: VAT REFUND APPROACH", 
            `Records: ${method1Results.recordCount}`, 
            `Amount: KES ${method1Results.totalAmount.toLocaleString()}`
        ]);
        worksheet.mergeCells(`B${method1HeaderRow.number}:D${method1HeaderRow.number}`);
        highlightCells(method1HeaderRow, "B", "J", "FF87CEEB", true);
        applyBorders(method1HeaderRow, "B", "J", "thin");
        method1HeaderRow.getCell('B').font = { size: 12, bold: true };

        // Method 1 Headers
        const headers1 = ["Method", "Tax Type", "Period", "Due Date", "Description", "Amount", "Status", "Source"];
        const headersRow1 = worksheet.addRow(["", "", ...headers1]);
        highlightCells(headersRow1, "C", "J", "FFD3D3D3", true);
        applyBorders(headersRow1, "C", "J", "thin");

        // Method 1 Data
        method1Results.data.forEach(record => {
            const dataRow = worksheet.addRow([
                "",
                "",
                record.method || 'N/A',
                record.taxType || 'N/A',
                record.period || 'N/A',
                record.dueDate || 'N/A',
                record.description || 'N/A',
                record.amount || 0,
                record.status || 'N/A',
                record.source || 'N/A'
            ]);
            applyBorders(dataRow, "C", "J", "thin");
            formatCurrencyCells(dataRow, "H", "H");
        });

        // Method 1 Total
        const totalRow1 = worksheet.addRow([
            "", "", "METHOD 1 TOTAL", "", "", "", "", method1Results.totalAmount, "", ""
        ]);
        highlightCells(totalRow1, "C", "J", "FFADD8E6", true);
        applyBorders(totalRow1, "C", "J", "thin");
        formatCurrencyCells(totalRow1, "H", "H");
        totalRow1.getCell('H').font = { bold: true };
        
        worksheet.addRow(); // Blank row between methods
    } else {
        const noDataRow1 = worksheet.addRow(["", "", "📋 METHOD 1: VAT REFUND - No data found"]);
        worksheet.mergeCells(`C${noDataRow1.number}:J${noDataRow1.number}`);
        highlightCells(noDataRow1, "C", "J", "FFFFF2F2");
        applyBorders(noDataRow1, "C", "J", "thin");
        worksheet.addRow(); // Blank row
    }

    // METHOD 2 SECTION - Payment Registration
    if (method2Results.data.length > 0) {
        // Method 2 Header
        const method2HeaderRow = worksheet.addRow([
            "", 
            "💳 METHOD 2: PAYMENT REGISTRATION APPROACH", 
            `Records: ${method2Results.recordCount}`, 
            `Amount: KES ${method2Results.totalAmount.toLocaleString()}`
        ]);
        worksheet.mergeCells(`B${method2HeaderRow.number}:D${method2HeaderRow.number}`);
        highlightCells(method2HeaderRow, "B", "J", "FFADD8E6", true);
        applyBorders(method2HeaderRow, "B", "J", "thin");
        method2HeaderRow.getCell('B').font = { size: 12, bold: true };

        // Method 2 Headers - Use dynamic headers from KRA
        const allMethod2Headers = new Set();
        method2Results.breakdown?.incomeTax?.headers?.forEach(h => allMethod2Headers.add(h));
        method2Results.breakdown?.vat?.headers?.forEach(h => allMethod2Headers.add(h));
        method2Results.breakdown?.paye?.headers?.forEach(h => allMethod2Headers.add(h));
        
        const method2Headers = ["Tax Type", ...Array.from(allMethod2Headers)];
        const headersRow2 = worksheet.addRow(["", "", ...method2Headers]);
        highlightCells(headersRow2, "C", String.fromCharCode(67 + method2Headers.length), "FFD3D3D3", true);
        applyBorders(headersRow2, "C", String.fromCharCode(67 + method2Headers.length), "thin");

        // Method 2 Data
        method2Results.data.forEach(record => {
            const rowData = ["", "", record.taxType || 'N/A'];
            
            // Add data for each header column
            Array.from(allMethod2Headers).forEach(header => {
                rowData.push(record.rawData?.[header] || 'N/A');
            });
            
            const dataRow = worksheet.addRow(rowData);
            applyBorders(dataRow, "C", String.fromCharCode(67 + method2Headers.length), "thin");
            
            // Format currency columns
            Array.from(allMethod2Headers).forEach((header, index) => {
                const headerLower = header.toLowerCase();
                if (headerLower.includes('amount') || headerLower.includes('penalty') || 
                    headerLower.includes('interest') || headerLower.includes('total')) {
                    formatCurrencyCells(dataRow, String.fromCharCode(68 + index), String.fromCharCode(68 + index));
                }
            });
        });

        // Method 2 Total - Calculate totals for each numeric column
        const totalRowData = ["", "", "METHOD 2 TOTAL"];
        const totalValues = {};
        
        // Calculate totals for each column
        method2Results.data.forEach(record => {
            Array.from(allMethod2Headers).forEach(header => {
                const value = record.rawData?.[header];
                if (value) {
                    const numValue = parseFloat(value.replace(/[^0-9.-]+/g, "")) || 0;
                    if (numValue > 0) {
                        totalValues[header] = (totalValues[header] || 0) + numValue;
                    }
                }
            });
        });
        
        // Add total values to row
        Array.from(allMethod2Headers).forEach(header => {
            totalRowData.push(totalValues[header] || 0);
        });
        
        const totalRow2 = worksheet.addRow(totalRowData);
        highlightCells(totalRow2, "C", String.fromCharCode(67 + method2Headers.length), "FFADD8E6", true);
        applyBorders(totalRow2, "C", String.fromCharCode(67 + method2Headers.length), "thin");
        
        // Format currency columns in total row
        Array.from(allMethod2Headers).forEach((header, index) => {
            const headerLower = header.toLowerCase();
            if (headerLower.includes('amount') || headerLower.includes('penalty') || 
                headerLower.includes('interest') || headerLower.includes('total')) {
                formatCurrencyCells(totalRow2, String.fromCharCode(68 + index), String.fromCharCode(68 + index));
                totalRow2.getCell(String.fromCharCode(68 + index)).font = { bold: true };
            }
        });
        
        worksheet.addRow(); // Blank row
    } else {
        const noDataRow2 = worksheet.addRow(["", "", "💳 METHOD 2: PAYMENT REGISTRATION - No data found"]);
        worksheet.mergeCells(`C${noDataRow2.number}:J${noDataRow2.number}`);
        highlightCells(noDataRow2, "C", "J", "FFFFF2F2");
        applyBorders(noDataRow2, "C", "J", "thin");
        worksheet.addRow(); // Blank row
    }

    // No Grand Total - each method has its own totals

    // Auto-fit columns
    workbookManager.autoFitColumns(worksheet);

    progressCallback({ 
        log: `Liabilities data added to consolidated report` 
    });

    return {
        data: allData,
        totalAmount: totalAmount,
        recordCount: allData.length
    };
}

module.exports = { runLiabilitiesExtraction };
