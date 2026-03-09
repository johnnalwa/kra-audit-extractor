const { validateKRACredentials, exportPasswordValidationToSheet } = require('./password-validation');
const { fetchManufacturerDetails, exportManufacturerToSheet } = require('./manufacturer-details');
const { runObligationCheck, exportObligationToSheet } = require('./obligation-checker');
const { checkCompanyWithholdingStatus, exportAgentStatusToSheet } = require('./agent-checker');
const { runLiabilitiesExtraction } = require('./liabilities-extraction');
const { runVATExtraction } = require('./vat-extraction');
const { runWhVatExtraction } = require('./wh-vat-extraction');
const { runLedgerExtraction } = require('./ledger-extraction');
const { runDirectorDetailsExtraction } = require('./director-details-extraction');
const { runTCCDownloader } = require('./tax-compliance-downloader');
const SharedWorkbookManager = require('./shared-workbook-manager');

const PASSWORD_REQUIRED = {
    passwordValidation: true,
    manufacturerDetails: false,
    agentStatus: false,
    obligationCheck: false,
    directorDetails: true,
    vatReturns: true,
    whVatReturns: true,
    generalLedger: true,
    taxCompliance: true,
    liabilities: true
};

function isSelected(selectedAutomations, key) {
    return Boolean(selectedAutomations?.[key]);
}

function pushFiles(results, fileList, folderPath) {
    if (!Array.isArray(fileList)) {
        return;
    }

    fileList
        .filter(Boolean)
        .forEach((file) => {
            results.files.push(folderPath && !file.includes('\\') && !file.includes('/') ? `${folderPath}\\${file}` : file);
        });
}

async function runAllAutomations(company, selectedAutomations, vatDateRange, whVatDateRange, downloadPath, progressCallback) {
    const results = {
        successful: [],
        failed: [],
        files: []
    };

    let workbookManager = null;

    try {
        progressCallback({
            stage: 'All Automations',
            message: 'Initializing parallel automation suite...',
            progress: 0
        });

        workbookManager = new SharedWorkbookManager(company, downloadPath);
        const mainDownloadPath = await workbookManager.initialize();

        const selectedKeys = Object.entries(selectedAutomations || {})
            .filter(([, enabled]) => enabled)
            .map(([key]) => key);
        const totalAutomations = selectedKeys.length || 1;
        let completedAutomations = 0;

        // Sequential queue for shared workbook writes — prevents ExcelJS state corruption
        // when multiple automations finish around the same time and try to write sheets.
        let workbookWriteQueue = Promise.resolve();
        const queueWorkbookWrite = (fn) => {
            workbookWriteQueue = workbookWriteQueue.then(() => fn()).catch((err) => {
                console.error('Workbook write error:', err);
            });
            return workbookWriteQueue;
        };

        const updateProgress = (automation, message) => {
            completedAutomations++;
            progressCallback({
                stage: automation,
                message,
                progress: Math.round((completedAutomations / totalAutomations) * 100)
            });
        };

        const ensurePasswordFor = (key, name) => {
            if (!PASSWORD_REQUIRED[key] || company.password) {
                return true;
            }
            results.failed.push({ name, error: 'This automation requires a KRA password.' });
            updateProgress(name, 'Skipped - KRA password required');
            return false;
        };

        // ── Build task lists ────────────────────────────────────────────────────
        // loginTasks    → require a KRA account session; run ONE AT A TIME in sequence
        //                 so they share the same browser context and don't conflict.
        // noLoginTasks  → public APIs / PIN checker; run all in PARALLEL.
        const loginTasks = [];
        const noLoginTasks = [];

        if (isSelected(selectedAutomations, 'passwordValidation') && ensurePasswordFor('passwordValidation', 'Password Validation')) {
            loginTasks.push(async () => {
                try {
                    progressCallback({
                        stage: 'Password Validation',
                        message: 'Validating credentials...',
                        progress: Math.round((completedAutomations / totalAutomations) * 100)
                    });

                    const validationResult = await validateKRACredentials(
                        company.pin,
                        company.password,
                        company.name,
                        (data) => progressCallback({ ...data, stage: 'Password Validation' }),
                        company
                    );

                    if (validationResult.success) {
                        await queueWorkbookWrite(() => exportPasswordValidationToSheet(workbookManager, validationResult));
                        results.successful.push('Password Validation');
                        updateProgress('Password Validation', 'Completed');
                    } else {
                        results.failed.push({ name: 'Password Validation', error: validationResult.error || validationResult.message });
                        updateProgress('Password Validation', 'Failed');
                    }
                } catch (error) {
                    console.error('Password Validation Error:', error);
                    results.failed.push({ name: 'Password Validation', error: error.message });
                    updateProgress('Password Validation', 'Failed');
                }
            });
        }

        if (isSelected(selectedAutomations, 'manufacturerDetails')) {
            noLoginTasks.push(async () => {
                try {
                    progressCallback({
                        stage: 'Manufacturer Details',
                        message: 'Fetching manufacturer details...',
                        progress: Math.round((completedAutomations / totalAutomations) * 100)
                    });

                    const manufacturerResult = await fetchManufacturerDetails(
                        company,
                        (data) => progressCallback({ ...data, stage: 'Manufacturer Details' })
                    );

                    if (manufacturerResult?.success && manufacturerResult.data) {
                        await queueWorkbookWrite(() => exportManufacturerToSheet(workbookManager, manufacturerResult.data));
                        results.successful.push('Manufacturer Details');
                        updateProgress('Manufacturer Details', 'Completed');
                    } else {
                        results.failed.push({ name: 'Manufacturer Details', error: manufacturerResult?.error || 'No data returned' });
                        updateProgress('Manufacturer Details', 'Failed');
                    }
                } catch (error) {
                    console.error('Manufacturer Details Error:', error);
                    results.failed.push({ name: 'Manufacturer Details', error: error.message });
                    updateProgress('Manufacturer Details', 'Failed');
                }
            });
        }

        if (isSelected(selectedAutomations, 'obligationCheck')) {
            noLoginTasks.push(async () => {
                try {
                    progressCallback({
                        stage: 'Obligation Check',
                        message: 'Checking tax obligations...',
                        progress: Math.round((completedAutomations / totalAutomations) * 100)
                    });

                    const obligationResult = await runObligationCheck(
                        company,
                        (data) => progressCallback({ ...data, stage: 'Obligation Check' })
                    );

                    if (obligationResult.success && obligationResult.data) {
                        await queueWorkbookWrite(() => exportObligationToSheet(workbookManager, obligationResult.data));
                        results.successful.push('Obligation Check');
                        updateProgress('Obligation Check', 'Completed');
                    } else {
                        results.failed.push({ name: 'Obligation Check', error: obligationResult.error || 'No data returned' });
                        updateProgress('Obligation Check', 'Failed');
                    }
                } catch (error) {
                    console.error('Obligation Check Error:', error);
                    results.failed.push({ name: 'Obligation Check', error: error.message });
                    updateProgress('Obligation Check', 'Failed');
                }
            });
        }

        if (isSelected(selectedAutomations, 'agentStatus')) {
            noLoginTasks.push(async () => {
                try {
                    progressCallback({
                        stage: 'Agent Status',
                        message: 'Checking withholding agent status...',
                        progress: Math.round((completedAutomations / totalAutomations) * 100)
                    });

                    const agentResult = await checkCompanyWithholdingStatus(
                        company,
                        null,
                        (data) => progressCallback({ ...data, stage: 'Agent Status' })
                    );

                    if (agentResult.success && agentResult.data) {
                        await queueWorkbookWrite(() => exportAgentStatusToSheet(workbookManager, agentResult.data));
                        results.successful.push('Agent Status');
                        updateProgress('Agent Status', 'Completed');
                    } else {
                        results.failed.push({ name: 'Agent Status', error: agentResult.error || 'No data returned' });
                        updateProgress('Agent Status', 'Failed');
                    }
                } catch (error) {
                    console.error('Agent Status Error:', error);
                    results.failed.push({ name: 'Agent Status', error: error.message });
                    updateProgress('Agent Status', 'Failed');
                }
            });
        }

        if (isSelected(selectedAutomations, 'directorDetails') && ensurePasswordFor('directorDetails', 'Director Details')) {
            loginTasks.push(async () => {
                try {
                    progressCallback({
                        stage: 'Director Details',
                        message: 'Extracting director details...',
                        progress: Math.round((completedAutomations / totalAutomations) * 100)
                    });

                    const directorResult = await runDirectorDetailsExtraction(
                        company,
                        mainDownloadPath,
                        (data) => progressCallback({ ...data, stage: 'Director Details' })
                    );

                    if (directorResult.success) {
                        results.successful.push('Director Details');
                        pushFiles(results, directorResult.files, mainDownloadPath);
                        updateProgress('Director Details', 'Completed');
                    } else {
                        results.failed.push({ name: 'Director Details', error: directorResult.error });
                        updateProgress('Director Details', 'Failed');
                    }
                } catch (error) {
                    console.error('Director Details Error:', error);
                    results.failed.push({ name: 'Director Details', error: error.message });
                    updateProgress('Director Details', 'Failed');
                }
            });
        }

        if (isSelected(selectedAutomations, 'liabilities') && ensurePasswordFor('liabilities', 'Liabilities')) {
            loginTasks.push(async () => {
                try {
                    progressCallback({
                        stage: 'Liabilities',
                        message: 'Extracting liabilities...',
                        progress: Math.round((completedAutomations / totalAutomations) * 100)
                    });

                    const liabilitiesResult = await runLiabilitiesExtraction(
                        company,
                        mainDownloadPath,
                        (data) => progressCallback({ ...data, stage: 'Liabilities' })
                    );

                    if (liabilitiesResult.success) {
                        results.successful.push('Liabilities');
                        pushFiles(results, liabilitiesResult.files, mainDownloadPath);
                        updateProgress('Liabilities', 'Completed');
                    } else {
                        results.failed.push({ name: 'Liabilities', error: liabilitiesResult.error });
                        updateProgress('Liabilities', 'Failed');
                    }
                } catch (error) {
                    console.error('Liabilities Error:', error);
                    results.failed.push({ name: 'Liabilities', error: error.message });
                    updateProgress('Liabilities', 'Failed');
                }
            });
        }

        if (isSelected(selectedAutomations, 'vatReturns') && ensurePasswordFor('vatReturns', 'VAT Returns')) {
            loginTasks.push(async () => {
                try {
                    progressCallback({
                        stage: 'VAT Returns',
                        message: 'Extracting VAT returns...',
                        progress: Math.round((completedAutomations / totalAutomations) * 100)
                    });

                    const vatResult = await runVATExtraction(
                        company,
                        vatDateRange || { type: 'all' },
                        mainDownloadPath,
                        (data) => progressCallback({ ...data, stage: 'VAT Returns' })
                    );

                    if (vatResult.success) {
                        results.successful.push('VAT Returns');
                        pushFiles(results, vatResult.files, mainDownloadPath);
                        updateProgress('VAT Returns', 'Completed');
                    } else {
                        results.failed.push({ name: 'VAT Returns', error: vatResult.error });
                        updateProgress('VAT Returns', 'Failed');
                    }
                } catch (error) {
                    console.error('VAT Returns Error:', error);
                    results.failed.push({ name: 'VAT Returns', error: error.message });
                    updateProgress('VAT Returns', 'Failed');
                }
            });
        }

        if (isSelected(selectedAutomations, 'whVatReturns') && ensurePasswordFor('whVatReturns', 'WH VAT Returns')) {
            loginTasks.push(async () => {
                try {
                    progressCallback({
                        stage: 'WH VAT Returns',
                        message: 'Extracting WH VAT returns...',
                        progress: Math.round((completedAutomations / totalAutomations) * 100)
                    });

                    const whVatResult = await runWhVatExtraction(
                        company,
                        whVatDateRange || { type: 'all' },
                        mainDownloadPath,
                        (data) => progressCallback({ ...data, stage: 'WH VAT Returns' })
                    );

                    if (whVatResult.success) {
                        results.successful.push('WH VAT Returns');
                        pushFiles(results, whVatResult.files, mainDownloadPath);
                        updateProgress('WH VAT Returns', 'Completed');
                    } else {
                        results.failed.push({ name: 'WH VAT Returns', error: whVatResult.error });
                        updateProgress('WH VAT Returns', 'Failed');
                    }
                } catch (error) {
                    console.error('WH VAT Returns Error:', error);
                    results.failed.push({ name: 'WH VAT Returns', error: error.message });
                    updateProgress('WH VAT Returns', 'Failed');
                }
            });
        }

        if (isSelected(selectedAutomations, 'generalLedger') && ensurePasswordFor('generalLedger', 'General Ledger')) {
            loginTasks.push(async () => {
                try {
                    progressCallback({
                        stage: 'General Ledger',
                        message: 'Extracting general ledger...',
                        progress: Math.round((completedAutomations / totalAutomations) * 100)
                    });

                    const ledgerResult = await runLedgerExtraction(
                        company,
                        mainDownloadPath,
                        (data) => progressCallback({ ...data, stage: 'General Ledger' })
                    );

                    if (ledgerResult.success) {
                        results.successful.push('General Ledger');
                        pushFiles(results, ledgerResult.files, mainDownloadPath);
                        updateProgress('General Ledger', 'Completed');
                    } else {
                        results.failed.push({ name: 'General Ledger', error: ledgerResult.error });
                        updateProgress('General Ledger', 'Failed');
                    }
                } catch (error) {
                    console.error('General Ledger Error:', error);
                    results.failed.push({ name: 'General Ledger', error: error.message });
                    updateProgress('General Ledger', 'Failed');
                }
            });
        }

        if (isSelected(selectedAutomations, 'taxCompliance') && ensurePasswordFor('taxCompliance', 'Tax Compliance')) {
            loginTasks.push(async () => {
                try {
                    progressCallback({
                        stage: 'Tax Compliance',
                        message: 'Downloading tax compliance certificate...',
                        progress: Math.round((completedAutomations / totalAutomations) * 100)
                    });

                    const tccResult = await runTCCDownloader(
                        company,
                        mainDownloadPath,
                        (data) => progressCallback({ ...data, stage: 'Tax Compliance' })
                    );

                    if (tccResult.success) {
                        results.successful.push('Tax Compliance');
                        pushFiles(results, tccResult.files, mainDownloadPath);
                        updateProgress('Tax Compliance', 'Completed');
                    } else {
                        results.failed.push({ name: 'Tax Compliance', error: tccResult.error });
                        updateProgress('Tax Compliance', 'Failed');
                    }
                } catch (error) {
                    console.error('Tax Compliance Error:', error);
                    results.failed.push({ name: 'Tax Compliance', error: error.message });
                    updateProgress('Tax Compliance', 'Failed');
                }
            });
        }

        // ── Execute both groups concurrently with each other ────────────────────
        // • loginTasks   → sequential (one at a time, same KRA session context)
        // • noLoginTasks → all in parallel (public APIs / PIN checker, no conflicts)
        progressCallback({
            stage: 'All Automations',
            message: `Starting ${loginTasks.length} login automation(s) sequentially + ${noLoginTasks.length} no-login automation(s) in parallel...`,
            progress: 0
        });

        const runLoginTasksSequentially = async () => {
            for (const task of loginTasks) {
                await task();
            }
        };

        await Promise.allSettled([
            runLoginTasksSequentially(),
            ...noLoginTasks.map((task) => task())
        ]);

        // Wait for any in-flight workbook writes to finish before saving
        await workbookWriteQueue;

        const savedWorkbook = await workbookManager.save();
        if (savedWorkbook?.filePath) {
            results.files.unshift(savedWorkbook.filePath);
        }

        progressCallback({
            stage: 'Complete',
            message: `Completed ${results.successful.length} of ${selectedKeys.length} selected automations`,
            progress: 100
        });

        return {
            success: true,
            results,
            downloadPath: mainDownloadPath,
            consolidatedFile: savedWorkbook?.filePath || null
        };
    } catch (error) {
        console.error('Run All Automations Error:', error);
        return {
            success: false,
            error: error.message,
            results
        };
    }
}

module.exports = { runAllAutomations };
