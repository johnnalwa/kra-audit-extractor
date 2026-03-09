const ExcelJS = require('exceljs');
const path = require('path');
const fs = require('fs').promises;
const SharedWorkbookManager = require('./shared-workbook-manager');
const { fetchManufacturerDetails, exportManufacturerToSheet } = require('./manufacturer-details');
const { runObligationCheck, exportObligationToSheet } = require('./obligation-checker');
const { checkCompanyWithholdingStatus, exportAgentStatusToSheet } = require('./agent-checker');

const PIN_ONLY_LABELS = {
    manufacturerDetails: 'Manufacturer Details',
    obligationCheck: 'Obligation Check',
    agentStatus: 'Agent Status'
};

const MAX_PARALLEL_COMPANIES = 2;

function buildTimestamp() {
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const hh = String(now.getHours()).padStart(2, '0');
    const min = String(now.getMinutes()).padStart(2, '0');
    const sec = String(now.getSeconds()).padStart(2, '0');
    return `${yyyy}${mm}${dd}_${hh}${min}${sec}`;
}

function clampPercentage(value) {
    return Math.max(0, Math.min(100, Math.round(value)));
}

function addSheetWithRows(workbook, sheetName, headers, rows) {
    const worksheet = workbook.addWorksheet(sheetName);
    worksheet.addRow(headers);

    const headerRow = worksheet.getRow(1);
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    headerRow.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFBE123C' }
    };
    headerRow.alignment = { vertical: 'middle', horizontal: 'center' };

    rows.forEach((row) => worksheet.addRow(row));

    worksheet.columns.forEach((column) => {
        let maxLength = 12;
        column.eachCell({ includeEmpty: true }, (cell) => {
            const length = String(cell.value || '').length;
            if (length > maxLength) {
                maxLength = length;
            }
        });
        column.width = Math.min(40, maxLength + 2);
    });

    return worksheet;
}

function calculateOverallPercentage(perCompanyProgress) {
    if (!perCompanyProgress.length) {
        return 0;
    }

    const total = perCompanyProgress.reduce((sum, progress) => sum + progress, 0);
    return clampPercentage((total / perCompanyProgress.length) * 100);
}

function getProgressValue(progress) {
    if (Number.isFinite(progress?.percentage)) {
        return progress.percentage;
    }
    if (Number.isFinite(progress?.progress)) {
        return progress.progress;
    }
    return 0;
}

function updateOverallProgress(perCompanyProgress, index, companyProgress, progressCallback, details) {
    perCompanyProgress[index] = Math.max(
        perCompanyProgress[index] || 0,
        Math.max(0, Math.min(1, companyProgress))
    );
    progressCallback({
        ...details,
        percentage: calculateOverallPercentage(perCompanyProgress)
    });
}

async function processCompany({
    inputCompany,
    index,
    totalCompanies,
    pinOnlySelections,
    batchFolder,
    perCompanyProgress,
    progressCallback
}) {
    const company = {
        pin: inputCompany.pin,
        name: inputCompany.name || inputCompany.pin,
        browserSettings: inputCompany.browserSettings || {},
        headless: inputCompany.browserSettings?.headless
    };

    const companyResult = {
        pin: company.pin,
        name: company.name,
        manufacturerStatus: pinOnlySelections.includes('manufacturerDetails') ? 'Pending' : 'Skipped',
        obligationStatus: pinOnlySelections.includes('obligationCheck') ? 'Pending' : 'Skipped',
        agentStatus: pinOnlySelections.includes('agentStatus') ? 'Pending' : 'Skipped',
        status: 'Pending',
        notes: '',
        reportPath: '',
        companyFolder: ''
    };

    const errors = [];
    const totalSteps = pinOnlySelections.length + 1;
    let workbookManager = null;
    let manufacturerRow = null;
    let obligationRow = null;
    let agentRow = null;

    const companyLabel = `[${index + 1}/${totalCompanies}] ${company.pin}`;

    const setCompanyProgress = (stepIndex, stepPercentage, stage, message, log) => {
        const normalizedStep = Math.max(0, Math.min(100, stepPercentage)) / 100;
        const companyProgress = (stepIndex + normalizedStep) / totalSteps;
        updateOverallProgress(
            perCompanyProgress,
            index,
            companyProgress,
            progressCallback,
            {
                stage,
                message: `${companyLabel} ${message}`,
                log
            }
        );
    };

    const ensureWorkbookManager = async () => {
        if (workbookManager) {
            workbookManager.company.name = company.name;
            return workbookManager;
        }

        workbookManager = new SharedWorkbookManager(company, batchFolder);
        await workbookManager.initialize();
        workbookManager.company.name = company.name;
        companyResult.companyFolder = workbookManager.companyFolder;
        return workbookManager;
    };

    try {
        setCompanyProgress(0, 0, 'PIN-Only Batch', 'queued for batch processing.', `PIN-Only Batch: queued ${company.pin}`);

        let currentStep = 0;

        if (pinOnlySelections.includes('manufacturerDetails')) {
            const stepIndex = currentStep;
            setCompanyProgress(stepIndex, 5, 'Manufacturer Details', 'starting manufacturer details.', `Manufacturer Details: started ${company.pin}`);

            const manufacturerResult = await fetchManufacturerDetails(company, (progress) => {
                setCompanyProgress(
                    stepIndex,
                    getProgressValue(progress),
                    'Manufacturer Details',
                    progress.message || progress.log || 'fetching manufacturer details.',
                    progress.log
                );
            });

            if (manufacturerResult.success && manufacturerResult.data) {
                const manufacturerData = manufacturerResult.data;
                company.name = manufacturerData.timsManBasicRDtlDTO?.manufacturerName || company.name;
                companyResult.name = company.name;

                await ensureWorkbookManager();
                await exportManufacturerToSheet(workbookManager, manufacturerData);
                companyResult.manufacturerStatus = 'Completed';

                manufacturerRow = [
                    company.pin,
                    company.name,
                    manufacturerData.manBusinessRDtlDTO?.businessName || 'N/A',
                    manufacturerData.timsManBasicRDtlDTO?.manufacturerBrNo || 'N/A',
                    manufacturerData.manContactRDtlDTO?.mainEmail || 'N/A',
                    manufacturerData.manContactRDtlDTO?.mobileNo || 'N/A'
                ];
                setCompanyProgress(stepIndex, 100, 'Manufacturer Details', 'manufacturer details completed.', `Manufacturer Details: completed ${company.pin}`);
            } else {
                companyResult.manufacturerStatus = 'Failed';
                errors.push(`Manufacturer: ${manufacturerResult.error || 'Unknown error'}`);
                setCompanyProgress(stepIndex, 100, 'Manufacturer Details', 'manufacturer details failed.', `Manufacturer Details: failed ${company.pin}`);
            }

            currentStep += 1;
        }

        if (pinOnlySelections.includes('obligationCheck')) {
            const stepIndex = currentStep;
            setCompanyProgress(stepIndex, 5, 'Obligation Check', 'starting obligation check.', `Obligation Check: started ${company.pin}`);

            const obligationResult = await runObligationCheck(company, (progress) => {
                setCompanyProgress(
                    stepIndex,
                    getProgressValue(progress),
                    'Obligation Check',
                    progress.message || progress.log || 'running obligation check.',
                    progress.log
                );
            });

            if (obligationResult.success && obligationResult.data) {
                company.name = obligationResult.data.company_name || company.name;
                companyResult.name = company.name;

                await ensureWorkbookManager();
                await exportObligationToSheet(workbookManager, obligationResult.data);
                companyResult.obligationStatus = 'Completed';

                const obligations = obligationResult.data.obligations || [];
                const activeObligations = obligations.filter((item) => item.status && item.status.toLowerCase().includes('active')).length;
                obligationRow = [
                    company.pin,
                    company.name,
                    obligationResult.data.pin_status || 'Unknown',
                    obligationResult.data.itax_status || 'Unknown',
                    obligationResult.data.etims_registration || 'Unknown',
                    obligationResult.data.vat_compliance || 'Unknown',
                    obligations.length,
                    activeObligations
                ];
                setCompanyProgress(stepIndex, 100, 'Obligation Check', 'obligation check completed.', `Obligation Check: completed ${company.pin}`);
            } else {
                companyResult.obligationStatus = 'Failed';
                errors.push(`Obligation: ${obligationResult.error || 'Unknown error'}`);
                setCompanyProgress(stepIndex, 100, 'Obligation Check', 'obligation check failed.', `Obligation Check: failed ${company.pin}`);
            }

            currentStep += 1;
        }

        if (pinOnlySelections.includes('agentStatus')) {
            const stepIndex = currentStep;
            setCompanyProgress(stepIndex, 5, 'Agent Status', 'starting agent status check.', `Agent Status: started ${company.pin}`);

            const agentResult = await checkCompanyWithholdingStatus(company, null, (progress) => {
                setCompanyProgress(
                    stepIndex,
                    getProgressValue(progress),
                    'Agent Status',
                    progress.message || progress.log || 'checking agent status.',
                    progress.log
                );
            });

            if (agentResult.success && agentResult.data) {
                company.name = agentResult.data.companyName || company.name;
                companyResult.name = company.name;

                await ensureWorkbookManager();
                await exportAgentStatusToSheet(workbookManager, agentResult.data);
                companyResult.agentStatus = 'Completed';

                agentRow = [
                    company.pin,
                    company.name,
                    agentResult.data.vat?.isRegistered === true ? 'Registered' : agentResult.data.vat?.isRegistered === false ? 'Not Registered' : 'Unknown',
                    agentResult.data.rent?.isRegistered === true ? 'Registered' : agentResult.data.rent?.isRegistered === false ? 'Not Registered' : 'Unknown',
                    agentResult.data.vat?.details?.confirmedPin || agentResult.data.rent?.details?.confirmedPin || 'N/A',
                    agentResult.data.vat?.details?.taxpayerName || agentResult.data.rent?.details?.taxpayerName || 'N/A'
                ];
                setCompanyProgress(stepIndex, 100, 'Agent Status', 'agent status completed.', `Agent Status: completed ${company.pin}`);
            } else {
                companyResult.agentStatus = 'Failed';
                errors.push(`Agent: ${agentResult.error || 'Unknown error'}`);
                setCompanyProgress(stepIndex, 100, 'Agent Status', 'agent status failed.', `Agent Status: failed ${company.pin}`);
            }

            currentStep += 1;
        }

        const runStatuses = [companyResult.manufacturerStatus, companyResult.obligationStatus, companyResult.agentStatus]
            .filter((status) => status !== 'Skipped');
        if (runStatuses.length && runStatuses.every((status) => status === 'Completed')) {
            companyResult.status = 'Completed';
        } else if (runStatuses.some((status) => status === 'Completed')) {
            companyResult.status = 'Partial';
        } else {
            companyResult.status = 'Failed';
        }

        setCompanyProgress(currentStep, 20, 'Saving Reports', 'finalizing company report.', `Saving Reports: finalizing ${company.pin}`);

        let savedFile = '';
        if (workbookManager) {
            workbookManager.company.name = company.name;
            const savedWorkbook = await workbookManager.save();
            companyResult.reportPath = savedWorkbook.filePath;
            companyResult.companyFolder = savedWorkbook.companyFolder;
            savedFile = savedWorkbook.filePath;
        }

        companyResult.notes = errors.join(' | ') || 'Completed';
        updateOverallProgress(
            perCompanyProgress,
            index,
            1,
            progressCallback,
            {
                stage: 'PIN-Only Batch',
                message: `${companyLabel} finished with status ${companyResult.status}.`,
                log: `PIN-Only Batch: ${company.pin} ${companyResult.status}`
            }
        );

        return {
            companyResult,
            manufacturerRow,
            obligationRow,
            agentRow,
            savedFile
        };
    } catch (error) {
        companyResult.status = 'Failed';
        companyResult.notes = `Batch error: ${error.message}`;
        updateOverallProgress(
            perCompanyProgress,
            index,
            1,
            progressCallback,
            {
                stage: 'PIN-Only Batch',
                message: `${companyLabel} failed: ${error.message}`,
                log: `PIN-Only Batch: ${company.pin} failed - ${error.message}`
            }
        );

        return {
            companyResult,
            manufacturerRow,
            obligationRow,
            agentRow,
            savedFile: ''
        };
    }
}

async function runPinOnlyBatch(companies, selectedAutomations, downloadPath, progressCallback = () => {}) {
    const pinOnlySelections = (selectedAutomations || []).filter((key) => PIN_ONLY_LABELS[key]);
    if (!companies?.length) {
        return { success: false, error: 'No companies were provided for the batch run.' };
    }

    if (!pinOnlySelections.length) {
        return { success: false, error: 'No PIN-only automations were selected.' };
    }

    const timestamp = buildTimestamp();
    const batchFolder = path.join(downloadPath, `PIN_ONLY_BATCH_${timestamp}`);
    await fs.mkdir(batchFolder, { recursive: true });

    const batchData = {
        selectedAutomations: pinOnlySelections.map((key) => PIN_ONLY_LABELS[key]),
        companies: []
    };
    const perCompanyProgress = new Array(companies.length).fill(0);
    const companyResults = new Array(companies.length);
    const manufacturerRows = new Array(companies.length).fill(null);
    const obligationRows = new Array(companies.length).fill(null);
    const agentRows = new Array(companies.length).fill(null);
    const savedFiles = new Array(companies.length).fill('');
    const workerCount = Math.max(1, Math.min(MAX_PARALLEL_COMPANIES, companies.length));
    let nextIndex = 0;

    progressCallback({
        stage: 'PIN-Only Batch',
        message: `Starting batch processing for ${companies.length} company PINs with ${workerCount} parallel worker${workerCount === 1 ? '' : 's'}.`,
        log: `PIN-Only Batch: using ${workerCount} parallel worker${workerCount === 1 ? '' : 's'}.`,
        percentage: 0
    });

    const worker = async () => {
        while (true) {
            const currentIndex = nextIndex;
            nextIndex += 1;

            if (currentIndex >= companies.length) {
                return;
            }

            const processed = await processCompany({
                inputCompany: companies[currentIndex],
                index: currentIndex,
                totalCompanies: companies.length,
                pinOnlySelections,
                batchFolder,
                perCompanyProgress,
                progressCallback
            });

            companyResults[currentIndex] = processed.companyResult;
            manufacturerRows[currentIndex] = processed.manufacturerRow;
            obligationRows[currentIndex] = processed.obligationRow;
            agentRows[currentIndex] = processed.agentRow;
            savedFiles[currentIndex] = processed.savedFile;
        }
    };

    await Promise.all(Array.from({ length: workerCount }, () => worker()));

    batchData.companies = companyResults.filter(Boolean);

    const combinedWorkbook = new ExcelJS.Workbook();
    addSheetWithRows(
        combinedWorkbook,
        'Batch Summary',
        ['PIN', 'Company', 'Manufacturer', 'Obligation', 'Agent', 'Overall', 'Notes', 'Report Path', 'Folder'],
        batchData.companies.map((company) => [
            company.pin,
            company.name,
            company.manufacturerStatus,
            company.obligationStatus,
            company.agentStatus,
            company.status,
            company.notes,
            company.reportPath,
            company.companyFolder
        ])
    );

    const manufacturerSummaryRows = manufacturerRows.filter(Boolean);
    if (manufacturerSummaryRows.length) {
        addSheetWithRows(
            combinedWorkbook,
            'Manufacturer Summary',
            ['PIN', 'Company', 'Business Name', 'Registration No', 'Email', 'Mobile'],
            manufacturerSummaryRows
        );
    }

    const obligationSummaryRows = obligationRows.filter(Boolean);
    if (obligationSummaryRows.length) {
        addSheetWithRows(
            combinedWorkbook,
            'Obligation Summary',
            ['PIN', 'Company', 'PIN Status', 'iTax Status', 'eTIMS', 'VAT Compliance', 'Obligations', 'Active'],
            obligationSummaryRows
        );
    }

    const agentSummaryRows = agentRows.filter(Boolean);
    if (agentSummaryRows.length) {
        addSheetWithRows(
            combinedWorkbook,
            'Agent Summary',
            ['PIN', 'Company', 'VAT Agent', 'Rent Agent', 'Confirmed PIN', 'Taxpayer Name'],
            agentSummaryRows
        );
    }

    const combinedReportPath = path.join(batchFolder, `PIN_ONLY_BATCH_REPORT_${timestamp}.xlsx`);
    await combinedWorkbook.xlsx.writeFile(combinedReportPath);

    const resolvedSavedFiles = [combinedReportPath, ...savedFiles.filter(Boolean)];

    progressCallback({
        stage: 'PIN-Only Batch',
        message: `Batch completed. Combined report saved to ${combinedReportPath}`,
        log: `PIN-Only Batch: completed ${companies.length} company PINs.`,
        percentage: 100
    });

    return {
        success: true,
        data: batchData,
        filePath: combinedReportPath,
        files: resolvedSavedFiles,
        batchFolder,
        downloadPath: batchFolder
    };
}

module.exports = { runPinOnlyBatch };
