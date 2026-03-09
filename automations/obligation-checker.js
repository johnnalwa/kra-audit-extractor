const { chromium } = require("playwright");
const { createWorker } = require('tesseract.js');
const fs = require("fs").promises;
const path = require("path");
const os = require("os");
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

async function runObligationCheck(company, progressCallback) {
    let browser = null;
    try {
        progressCallback({ stage: 'Obligation Check', message: 'Starting obligation check...', progress: 5 });
        browser = await chromium.launch(getBrowserLaunchOptions(company));
        const context = await browser.newContext();
        const page = await context.newPage();
        await page.goto("https://itax.kra.go.ke/KRA-Portal/");

        const organizedData = await processCompanyData(company, page, progressCallback);

        await browser.close();
        progressCallback({ stage: 'Obligation Check', message: 'Obligation check completed.', progress: 100 });
        return { success: true, data: organizedData };

    } catch (error) {
        if (browser) {
            await browser.close();
        }
        console.error('Error during obligation check:', error);
        progressCallback({ stage: 'Obligation Check', message: `Error: ${error.message}`, logType: 'error' });
        return { success: false, error: error.message };
    }
}

async function processCompanyData(company, page, progressCallback) {
    if (!company.pin) {
        return { company_name: company.name, error: "KRA PIN Missing" };
    }

    let retries = 0;
    const maxRetries = 5;

    while (retries < maxRetries) {
        try {
            const pinInputExists = await page.locator('input[name="vo.pinNo"]').isVisible().catch(() => false);
            if (!pinInputExists) {
                await page.locator("#logid").click();
                await page.evaluate(() => pinchecker());
                await page.waitForTimeout(1000);
            }

            progressCallback({ log: 'Solving captcha...' });
            await page.waitForSelector("#captcha_img");
            const imagePath = path.join(
                os.tmpdir(),
                `ocr_obligation_${Date.now()}_${Math.random().toString(16).slice(2, 8)}.png`
            );
            await page.locator("#captcha_img").first().screenshot({ path: imagePath });

            const worker = await createWorker('eng', 1);
            const ret = await worker.recognize(imagePath);
            
            // Use the same proven method as password validation
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
            await fs.unlink(imagePath).catch(() => {});
            
            progressCallback({
                log: `CAPTCHA solved: ${numbers[0]} ${text.includes("+") ? "+" : "-"} ${numbers[1]} = ${result}`
            });


            await page.type("#captcahText", result.toString());
            await page.locator('input[name="vo.pinNo"]').fill(company.pin);
            await page.getByRole("button", { name: "Consult" }).click();

            const invalidCaptcha = await page.waitForSelector('b:has-text("Wrong result of the arithmetic operation.")', { state: 'visible', timeout: 1000 }).catch(() => false);
            if (invalidCaptcha) {
                throw new Error("Invalid CAPTCHA");
            }

            progressCallback({ log: 'Fetching obligation details...' });
            await page.getByRole("group", { name: "Obligation Details" }).click();

            // Use the comprehensive extraction method to get all data in one go
            const extractedData = await page.evaluate(() => {
                // Function to extract data from the table
                function extractTableData() {
                    const result = {
                        taxpayerDetails: {},
                        obligationDetails: [],
                        electronicTaxInvoicing: {},
                        vatCompliance: {}
                    };

                    // Get the main table container
                    const mainTable = document.querySelector('#pinCheckerForm > div:nth-child(9) > center > div > table');
                    if (!mainTable) {
                        console.error('Main table not found');
                        return result;
                    }

                    // Extract Taxpayer Details (3rd row in the main table)
                    const taxpayerRow = mainTable.querySelector('tr:nth-child(3)');
                    if (taxpayerRow) {
                        const taxpayerTable = taxpayerRow.querySelector('table');
                        if (taxpayerTable) {
                            const rows = taxpayerTable.querySelectorAll('tr');
                            rows.forEach(row => {
                                const cells = row.querySelectorAll('td.textAlignLeft');
                                if (cells.length >= 4) {
                                    result.taxpayerDetails[cells[0].textContent.trim().replace(':', '')] = cells[1].textContent.trim();
                                    result.taxpayerDetails[cells[2].textContent.trim().replace(':', '')] = cells[3].textContent.trim();
                                }
                            });
                        }
                    }

                    // Extract Obligation Details (5th row in the main table)
                    const obligationRow = mainTable.querySelector('tr:nth-child(5)');
                    if (obligationRow) {
                        const obligationTable = obligationRow.querySelector('table.tab3');
                        if (obligationTable) {
                            const rows = obligationTable.querySelectorAll('tr');
                            for (let i = 1; i < rows.length; i++) { // Skip header row
                                const cells = rows[i].querySelectorAll('td');
                                if (cells.length >= 4) {
                                    result.obligationDetails.push({
                                        obligationName: cells[0].textContent.trim(),
                                        currentStatus: cells[1].textContent.trim(),
                                        effectiveFromDate: cells[2].textContent.trim(),
                                        effectiveToDate: cells[3].textContent.trim() || 'Active'
                                    });
                                }
                            }
                        }
                    }

                    // Extract Electronic Tax Invoicing (7th row in the main table)
                    const etimsRow = mainTable.querySelector('tr:nth-child(7)');
                    if (etimsRow) {
                        const etimsTable = etimsRow.querySelector('table');
                        if (etimsTable) {
                            const rows = etimsTable.querySelectorAll('tr');
                            rows.forEach(row => {
                                const cells = row.querySelectorAll('td.textAlignLeft');
                                if (cells.length >= 4) {
                                    result.electronicTaxInvoicing[cells[0].textContent.trim().replace(':', '')] = cells[1].textContent.trim();
                                    if (cells.length > 2) {
                                        result.electronicTaxInvoicing[cells[2].textContent.trim().replace(':', '')] = cells[3].textContent.trim();
                                    }
                                }
                            });
                        }
                    }

                    // Extract VAT Compliance
                    const vatComplianceCell = document.querySelector('#pinCheckerForm > div:nth-child(9) > center > div > table > tbody > tr:nth-child(8) > td');
                    if (vatComplianceCell) {
                        const vatTable = vatComplianceCell.querySelector('table');
                        if (vatTable) {
                            const statusCell = vatTable.querySelector('td.textAlignLeft');
                            if (statusCell) {
                                result.vatCompliance.status = statusCell.textContent.trim();
                            }
                        }
                    }

                    return result;
                }

                return extractTableData();
            });

            // Convert the extracted data to the organized format
            const data = {
                company_name: company.name,
                income_tax_company_status: 'No obligation',
                income_tax_company_effective_from: 'No obligation',
                income_tax_company_effective_to: 'No obligation',
                vat_status: 'No obligation',
                vat_effective_from: 'No obligation',
                vat_effective_to: 'No obligation',
                paye_status: 'No obligation',
                paye_effective_from: 'No obligation',
                paye_effective_to: 'No obligation',
                rent_income_mri_status: 'No obligation',
                rent_income_mri_effective_from: 'No obligation',
                rent_income_mri_effective_to: 'No obligation',
                resident_individual_status: 'No obligation',
                resident_individual_effective_from: 'No obligation',
                resident_individual_effective_to: 'No obligation',
                turnover_tax_status: 'No obligation',
                turnover_tax_effective_from: 'No obligation',
                turnover_tax_effective_to: 'No obligation',
                etims_registration: extractedData.electronicTaxInvoicing['eTIMS Registration'] || 'Unknown',
                tims_registration: extractedData.electronicTaxInvoicing['TIMS Registration'] || 'Unknown',
                vat_compliance: extractedData.vatCompliance.status || 'Unknown',
                pin_status: extractedData.taxpayerDetails['PIN Status'] || 'Unknown',
                itax_status: extractedData.taxpayerDetails['iTax Status'] || 'Unknown'
            };

            // Map the obligation details to the correct fields
            if (extractedData.obligationDetails && extractedData.obligationDetails.length > 0) {
                for (const obligation of extractedData.obligationDetails) {
                    switch (obligation.obligationName) {
                        case 'Income Tax - PAYE':
                            data.paye_status = obligation.currentStatus;
                            data.paye_effective_from = obligation.effectiveFromDate;
                            data.paye_effective_to = obligation.effectiveToDate;
                            break;
                        case 'Value Added Tax (VAT)':
                            data.vat_status = obligation.currentStatus;
                            data.vat_effective_from = obligation.effectiveFromDate;
                            data.vat_effective_to = obligation.effectiveToDate;
                            break;
                        case 'Income Tax - Company':
                            data.income_tax_company_status = obligation.currentStatus;
                            data.income_tax_company_effective_from = obligation.effectiveFromDate;
                            data.income_tax_company_effective_to = obligation.effectiveToDate;
                            break;
                        case 'Income Tax - Rent Income (MRI)':
                            data.rent_income_mri_status = obligation.currentStatus;
                            data.rent_income_mri_effective_from = obligation.effectiveFromDate;
                            data.rent_income_mri_effective_to = obligation.effectiveToDate;
                            break;
                        case 'Income Tax - Resident Individual':
                            data.resident_individual_status = obligation.currentStatus;
                            data.resident_individual_effective_from = obligation.effectiveFromDate;
                            data.resident_individual_effective_to = obligation.effectiveToDate;
                            break;
                        case 'Income Tax - Turnover Tax':
                            data.turnover_tax_status = obligation.currentStatus;
                            data.turnover_tax_effective_from = obligation.effectiveFromDate;
                            data.turnover_tax_effective_to = obligation.effectiveToDate;
                            break;
                    }
                }
            }
            
            // Build obligations array for UI compatibility
            data.obligations = extractedData.obligationDetails.map(obligation => ({
                name: obligation.obligationName,
                status: obligation.currentStatus,
                effectiveFrom: obligation.effectiveFromDate,
                effectiveTo: obligation.effectiveToDate
            }));
            
            // Add timestamp for when this company was checked
            data.last_checked_at = new Date().toISOString();
            
            // Log the complete extracted data for reference/debugging
            console.log('Complete extracted data for', company.name, ':', JSON.stringify(extractedData));

            return data;
        } catch (error) {
            retries++;
            progressCallback({ log: `Attempt ${retries} failed: ${error.message}. Retrying...` });
            if (retries >= maxRetries) {
                return { company_name: company.name, error: `Failed after ${maxRetries} attempts: ${error.message}` };
            }
        }
    }
}

function organizeData(companyName, tableContent) {
    const lines = tableContent.split("\n").map(line => line.trim()).filter(line => line);
    const data = {
        company_name: companyName,
        income_tax_company_status: 'No obligation',
        income_tax_company_effective_from: 'No obligation',
        income_tax_company_effective_to: 'No obligation',
        vat_status: 'No obligation',
        vat_effective_from: 'No obligation',
        vat_effective_to: 'No obligation',
        paye_status: 'No obligation',
        paye_effective_from: 'No obligation',
        paye_effective_to: 'No obligation',
        rent_income_mri_status: 'No obligation',
        rent_income_mri_effective_from: 'No obligation',
        rent_income_mri_effective_to: 'No obligation',
        resident_individual_status: 'No obligation',
        resident_individual_effective_from: 'No obligation',
        resident_individual_effective_to: 'No obligation',
        turnover_tax_status: 'No obligation',
        turnover_tax_effective_from: 'No obligation',
        turnover_tax_effective_to: 'No obligation',
        etims_registration: 'Unknown',
        tims_registration: 'Unknown',
        vat_compliance: 'Unknown',
        pin_status: 'Unknown',
        itax_status: 'Unknown'
    };

    for (const line of lines) {
        const [obligationName, currentStatus, effectiveFromDate, effectiveToDate = ""] = line.split("\t");

        switch (obligationName) {
            case 'Income Tax - PAYE':
                data.paye_status = currentStatus;
                data.paye_effective_from = effectiveFromDate;
                data.paye_effective_to = effectiveToDate || "Active";
                break;
            case 'Value Added Tax (VAT)':
                data.vat_status = currentStatus;
                data.vat_effective_from = effectiveFromDate;
                data.vat_effective_to = effectiveToDate || "Active";
                break;
            case 'Income Tax - Company':
                data.income_tax_company_status = currentStatus;
                data.income_tax_company_effective_from = effectiveFromDate;
                data.income_tax_company_effective_to = effectiveToDate || "Active";
                break;
            case 'Income Tax - Rent Income (MRI)':
                data.rent_income_mri_status = currentStatus;
                data.rent_income_mri_effective_from = effectiveFromDate;
                data.rent_income_mri_effective_to = effectiveToDate || "Active";
                break;
            case 'Income Tax - Resident Individual':
                data.resident_individual_status = currentStatus;
                data.resident_individual_effective_from = effectiveFromDate;
                data.resident_individual_effective_to = effectiveToDate || "Active";
                break;
            case 'Income Tax - Turnover Tax':
                data.turnover_tax_status = currentStatus;
                data.turnover_tax_effective_from = effectiveFromDate;
                data.turnover_tax_effective_to = effectiveToDate || "Active";
                break;
        }
    }

    return data;
}

// Export obligation check data to a shared workbook as a sheet
async function exportObligationToSheet(workbookManager, obligationData) {
    const worksheet = workbookManager.addWorksheet('Obligation Check');
    
    // Add title
    workbookManager.addTitleRow(worksheet, 'KRA Obligation Check Report', `Extraction Date: ${new Date().toLocaleDateString()}`);
    
    // Add company info
    workbookManager.addCompanyInfoRow(worksheet);

    if (obligationData.error) {
        worksheet.addRow(['', 'Error', obligationData.error]);
    } else {
        // Add Taxpayer Status section
        worksheet.addRow([]);
        const statusHeader = worksheet.addRow(['', 'Taxpayer Status']);
        statusHeader.getCell('B').font = { bold: true, size: 12 };
        worksheet.addRow([]);
        
        const statusData = [
            ['PIN Status', obligationData.pin_status || 'Unknown'],
            ['iTax Status', obligationData.itax_status || 'Unknown']
        ];
        statusData.forEach(([name, value]) => {
            const row = worksheet.addRow(['', name, value]);
            row.getCell('B').font = { bold: true };
            
            // Add borders manually
            row.eachCell((cell, colNumber) => {
                if (colNumber > 1 && colNumber <= 3) {
                    cell.border = {
                        top: { style: 'thin' },
                        left: { style: 'thin' },
                        bottom: { style: 'thin' },
                        right: { style: 'thin' }
                    };
                    cell.alignment = { vertical: 'middle' };
                }
            });
        });

        // Add Tax Obligations section
        worksheet.addRow([]);
        const obligationHeader = worksheet.addRow(['', 'Tax Obligations']);
        obligationHeader.getCell('B').font = { bold: true, size: 12 };
        worksheet.addRow([]);
        
        workbookManager.addHeaderRow(worksheet, ['Obligation Type', 'Status', 'Effective From', 'Effective To']);

        const obligationRows = [
            ['Income Tax - Company', obligationData.income_tax_company_status || 'No obligation', obligationData.income_tax_company_effective_from || 'N/A', obligationData.income_tax_company_effective_to || 'N/A'],
            ['Value Added Tax (VAT)', obligationData.vat_status || 'No obligation', obligationData.vat_effective_from || 'N/A', obligationData.vat_effective_to || 'N/A'],
            ['Income Tax - PAYE', obligationData.paye_status || 'No obligation', obligationData.paye_effective_from || 'N/A', obligationData.paye_effective_to || 'N/A'],
            ['Income Tax - Rent Income (MRI)', obligationData.rent_income_mri_status || 'No obligation', obligationData.rent_income_mri_effective_from || 'N/A', obligationData.rent_income_mri_effective_to || 'N/A'],
            ['Income Tax - Resident Individual', obligationData.resident_individual_status || 'No obligation', obligationData.resident_individual_effective_from || 'N/A', obligationData.resident_individual_effective_to || 'N/A'],
            ['Income Tax - Turnover Tax', obligationData.turnover_tax_status || 'No obligation', obligationData.turnover_tax_effective_from || 'N/A', obligationData.turnover_tax_effective_to || 'N/A']
        ];
        workbookManager.addDataRows(worksheet, obligationRows, 'B', { borders: true, alternateRows: true });

        // Add Electronic Tax Systems section
        worksheet.addRow([]);
        const systemsHeader = worksheet.addRow(['', 'Electronic Tax Systems']);
        systemsHeader.getCell('B').font = { bold: true, size: 12 };
        worksheet.addRow([]);
        
        const systemsData = [
            ['eTIMS Registration', obligationData.etims_registration || 'Unknown'],
            ['TIMS Registration', obligationData.tims_registration || 'Unknown'],
            ['VAT Compliance', obligationData.vat_compliance || 'Unknown']
        ];
        systemsData.forEach(([name, value]) => {
            const row = worksheet.addRow(['', name, value]);
            row.getCell('B').font = { bold: true };
            
            // Add borders manually
            row.eachCell((cell, colNumber) => {
                if (colNumber > 1 && colNumber <= 3) {
                    cell.border = {
                        top: { style: 'thin' },
                        left: { style: 'thin' },
                        bottom: { style: 'thin' },
                        right: { style: 'thin' }
                    };
                    cell.alignment = { vertical: 'middle' };
                }
            });
        });
    }

    workbookManager.autoFitColumns(worksheet);
    
    return worksheet;
}

// Run obligation check and export to consolidated workbook
async function runObligationCheckConsolidated(company, downloadPath, progressCallback) {
    try {
        progressCallback({ log: 'Initializing consolidated workbook...' });
        
        // Initialize shared workbook manager
        const SharedWorkbookManager = require('./shared-workbook-manager');
        const workbookManager = new SharedWorkbookManager(company, downloadPath);
        const companyFolder = await workbookManager.initialize();
        
        progressCallback({ log: `Company folder: ${companyFolder}` });
        progressCallback({ log: 'Running obligation check...' });
        
        // Run obligation check
        const obligationResult = await runObligationCheck(company, progressCallback);
        
        if (obligationResult.success && obligationResult.data) {
            progressCallback({ log: 'Adding obligation data to consolidated report...' });
            
            // Export to sheet
            await exportObligationToSheet(workbookManager, obligationResult.data);
            
            // Save the workbook
            const savedWorkbook = await workbookManager.save();
            
            progressCallback({ log: `Report saved: ${savedWorkbook.fileName}` });
            
            return {
                success: true,
                data: obligationResult.data,
                filePath: savedWorkbook.filePath,
                fileName: savedWorkbook.fileName,
                companyFolder: savedWorkbook.companyFolder
            };
        } else {
            return obligationResult;
        }
    } catch (error) {
        progressCallback({ log: `Error: ${error.message}`, logType: 'error' });
        return {
            success: false,
            error: error.message
        };
    }
}

module.exports = { 
    runObligationCheck,
    exportObligationToSheet,
    runObligationCheckConsolidated
};
