const { ipcRenderer } = require('electron');
const os = require('os');
const path = require('path');

// Global state management
let appState = {
    currentStep: 1,
    companyData: null,
    manufacturerData: null,
    validationStatus: null,
    hasValidation: false,
    obligationData: null,
    liabilitiesData: null,
    vatData: null,
    whVatData: null,
    ledgerData: null,
    agentData: null,
    tccData: null,
    batchCompanies: [],
    pinOnlyBatchData: null,
    exports: {},
    automationResults: {},
    isProcessing: false,
    activeProcess: null,
    lastBatchProgressEntry: ''
};

// DOM elements
const elements = {
    // Navigation
    navItems: document.querySelectorAll('.nav-item'),
    tabContents: document.querySelectorAll('.tab-content'),
    contentArea: document.querySelector('.content-area'),

    // Step 1: Company Setup
    kraPin: document.getElementById('kraPin'),
    kraPassword: document.getElementById('kraPassword'),
    fetchCompanyDetails: document.getElementById('fetchCompanyDetails'),
    validateCredentials: document.getElementById('validateCredentials'),
    companyDetailsResult: document.getElementById('companyDetailsResult'),
    companyInfo: document.getElementById('companyInfo'),
    confirmCompanyDetails: document.getElementById('confirmCompanyDetails'),

    // Step 2: Password Validation
    validationCompanyName: document.getElementById('validationCompanyName'),
    validationPIN: document.getElementById('validationPIN'),
    validationResult: document.getElementById('validationResult'),
    validationExportInfo: document.getElementById('validationExportInfo'),
    runPasswordValidation: document.getElementById('runPasswordValidation'),

    // Step 3: Manufacturer Details
    fetchManufacturerDetails: document.getElementById('fetchManufacturerDetails'),
    exportManufacturerDetails: document.getElementById('exportManufacturerDetails'),
    manufacturerDetailsResult: document.getElementById('manufacturerDetailsResult'),
    manufacturerInfo: document.getElementById('manufacturerInfo'),

    // Step 4: Director Details
    runDirectorDetailsExtraction: document.getElementById('runDirectorDetailsExtraction'),
    directorDetailsResults: document.getElementById('directorDetailsResults'),

    // Step 5: Obligation Checker
    runObligationCheck: document.getElementById('runObligationCheck'),
    obligationResults: document.getElementById('obligationResults'),

    // Step 6: Agent Checker
    runAgentCheck: document.getElementById('runAgentCheck'),
    agentCheckResults: document.getElementById('agentCheckResults'),

    // Step 7: Liabilities
    runLiabilitiesExtraction: document.getElementById('runLiabilitiesExtraction'),
    liabilitiesResults: document.getElementById('liabilitiesResults'),

    // Step 7: General Ledger
    runLedgerExtraction: document.getElementById('runLedgerExtraction'),
    ledgerResults: document.getElementById('ledgerResults'),

    // Tax Compliance
    runTCCDownloader: document.getElementById('runTCCDownloader'),
    tccResults: document.getElementById('tccResults'),

    // Step 5: VAT Returns
    vatDateRange: document.getElementsByName('vatDateRange'),
    vatCustomDateInputs: document.getElementById('vatCustomDateInputs'),
    vatStartYear: document.getElementById('vatStartYear'),
    vatStartMonth: document.getElementById('vatStartMonth'),
    vatEndYear: document.getElementById('vatEndYear'),
    vatEndMonth: document.getElementById('vatEndMonth'),
    runVATExtraction: document.getElementById('runVATExtraction'),
    vatResults: document.getElementById('vatResults'),

    // WH VAT Returns
    whVatDateRange: document.getElementsByName('whVatDateRange'),
    whVatCustomDateInputs: document.getElementById('whVatCustomDateInputs'),
    whVatStartYear: document.getElementById('whVatStartYear'),
    whVatStartMonth: document.getElementById('whVatStartMonth'),
    whVatEndYear: document.getElementById('whVatEndYear'),
    whVatEndMonth: document.getElementById('whVatEndMonth'),
    runWhVATExtraction: document.getElementById('runWhVATExtraction'),
    whVatResults: document.getElementById('whVatResults'),

    // Step 5: General Ledger
    runLedgerExtraction: document.getElementById('runLedgerExtraction'),

    // Step 8: Run All
    selectAllAutomations: document.getElementById('selectAllAutomations'),
    runAllPinDisplay: document.getElementById('runAllPinDisplay'),
    runAllPasswordDisplay: document.getElementById('runAllPasswordDisplay'),
    runAllCompanyDisplay: document.getElementById('runAllCompanyDisplay'),
    includePasswordValidation: document.getElementById('includePasswordValidation'),
    includeManufacturerDetails: document.getElementById('includeManufacturerDetails'),
    includeAgentStatus: document.getElementById('includeAgentStatus'),
    includeObligationCheck: document.getElementById('includeObligationCheck'),
    includeDirectorDetails: document.getElementById('includeDirectorDetails'),
    includeVATReturns: document.getElementById('includeVATReturns'),
    includeWhVatReturns: document.getElementById('includeWhVatReturns'),
    includeGeneralLedger: document.getElementById('includeGeneralLedger'),
    includeTaxCompliance: document.getElementById('includeTaxCompliance'),
    includeLiabilities: document.getElementById('includeLiabilities'),
    selectPinOnlyAutomations: document.getElementById('selectPinOnlyAutomations'),
    selectPasswordAutomations: document.getElementById('selectPasswordAutomations'),
    clearAutomations: document.getElementById('clearAutomations'),
    runAllSelectionSummary: document.getElementById('runAllSelectionSummary'),
    runAllAutomations: document.getElementById('runAllAutomations'),
    openPinOnlyBatchDialog: document.getElementById('openPinOnlyBatchDialog'),
    pinOnlyBatchModal: document.getElementById('pinOnlyBatchModal'),
    pinOnlyBatchOverlay: document.getElementById('pinOnlyBatchOverlay'),
    closePinOnlyBatchModal: document.getElementById('closePinOnlyBatchModal'),
    closePinOnlyBatchDialog: document.getElementById('closePinOnlyBatchDialog'),
    batchPinList: document.getElementById('batchPinList'),
    batchCsvFile: document.getElementById('batchCsvFile'),
    importBatchCsv: document.getElementById('importBatchCsv'),
    clearBatchPins: document.getElementById('clearBatchPins'),
    batchPinListSummary: document.getElementById('batchPinListSummary'),
    runPinOnlyBatch: document.getElementById('runPinOnlyBatch'),
    pinOnlyBatchProgressCard: document.getElementById('pinOnlyBatchProgressCard'),
    batchProgressFill: document.getElementById('batchProgressFill'),
    batchProgressText: document.getElementById('batchProgressText'),
    batchProgressPercentage: document.getElementById('batchProgressPercentage'),
    batchProgressStage: document.getElementById('batchProgressStage'),
    batchProgressLog: document.getElementById('batchProgressLog'),
    pinOnlyBatchResults: document.getElementById('pinOnlyBatchResults'),

    // Run All VAT Date Range
    runAllVatRangeType: document.getElementById('runAllVatRangeType'),
    runAllVatCustomRange: document.getElementById('runAllVatCustomRange'),
    runAllVatStartMonth: document.getElementById('runAllVatStartMonth'),
    runAllVatStartYear: document.getElementById('runAllVatStartYear'),
    runAllVatEndMonth: document.getElementById('runAllVatEndMonth'),
    runAllVatEndYear: document.getElementById('runAllVatEndYear'),

    // Run All WH VAT Date Range
    runAllWhVatRangeType: document.getElementById('runAllWhVatRangeType'),
    runAllWhVatCustomRange: document.getElementById('runAllWhVatCustomRange'),
    runAllWhVatStartMonth: document.getElementById('runAllWhVatStartMonth'),
    runAllWhVatStartYear: document.getElementById('runAllWhVatStartYear'),
    runAllWhVatEndMonth: document.getElementById('runAllWhVatEndMonth'),
    runAllWhVatEndYear: document.getElementById('runAllWhVatEndYear'),

    // Global elements
    progressSection: document.getElementById('progressSection'),
    progressFill: document.getElementById('progressFill'),
    progressText: document.getElementById('progressText'),
    progressLog: document.getElementById('progressLog'),
    results: document.getElementById('results'),
    resultContent: document.getElementById('resultContent'),

    // Configuration
    downloadPath: document.getElementById('downloadPath'),
    sidebarFolderPath: document.getElementById('sidebarFolderPath'),
    outputFormat: document.getElementById('outputFormat'),
    browserHeadless: document.getElementById('browserHeadless'),
    settingsBrowserMode: document.getElementById('settingsBrowserMode'),
    openFilesFolder: document.getElementById('openFilesFolder'),
    saveConfig: document.getElementById('saveConfig'),
    loadConfig: document.getElementById('loadConfig')
};

const SECTION_EXPORT_LABELS = {
    company: 'Company Details',
    manufacturer: 'Manufacturer Details',
    validation: 'Credential Validation',
    obligation: 'Obligation Check',
    agent: 'Agent Status',
    director: 'Director Details',
    liabilities: 'Liabilities',
    vat: 'VAT Returns',
    whVat: 'WH VAT Returns',
    ledger: 'General Ledger',
    tcc: 'Tax Compliance',
    runAll: 'Run All Bundle',
    pinOnlyBatch: 'PIN-Only Batch'
};

const ACTION_RULES = {
    fetchCompanyDetails: { pin: true, password: false, company: false, ready: 'Ready to fetch company details with the KRA PIN.' },
    validateCredentials: { pin: true, password: true, company: false, ready: 'Ready to validate the login and save the result to Excel.' },
    runPasswordValidation: { pin: true, password: true, company: false, ready: 'Ready to validate credentials and export the result.' },
    fetchManufacturerDetails: { pin: true, password: false, company: false, ready: 'Ready to fetch and export manufacturer details.' },
    runDirectorDetailsExtraction: { pin: true, password: true, company: false, ready: 'Ready to extract director details.' },
    runObligationCheck: { pin: true, password: false, company: false, ready: 'Ready to run the obligation check.' },
    runAgentCheck: { pin: true, password: false, company: false, ready: 'Ready to check withholding-agent status.' },
    runLiabilitiesExtraction: { pin: true, password: true, company: false, ready: 'Ready to extract liabilities.' },
    runVATExtraction: { pin: true, password: true, company: false, ready: 'Ready to extract VAT returns.' },
    runWhVATExtraction: { pin: true, password: true, company: false, ready: 'Ready to extract withholding VAT returns.' },
    runLedgerExtraction: { pin: true, password: true, company: false, ready: 'Ready to extract the general ledger.' },
    runTCCDownloader: { pin: true, password: true, company: false, ready: 'Ready to download the tax compliance certificate.' }
};

const RUN_ALL_PASSWORD_REQUIRED = {
    passwordValidation: 'Password Validation',
    directorDetails: 'Director Details',
    vatReturns: 'VAT Returns',
    whVatReturns: 'WH VAT Returns',
    generalLedger: 'General Ledger',
    taxCompliance: 'Tax Compliance',
    liabilities: 'Liabilities'
};

const RUN_ALL_PIN_ONLY = {
    manufacturerDetails: 'Manufacturer Details',
    agentStatus: 'Agent Status',
    obligationCheck: 'Obligation Check'
};

const UI_ICONS = {
    obligation: 'fa-solid fa-list-check',
    pin: 'fa-solid fa-location-dot',
    shield: 'fa-solid fa-shield-halved',
    etims: 'fa-solid fa-desktop',
    chart: 'fa-solid fa-chart-column',
    check: 'fa-solid fa-circle-check',
    error: 'fa-solid fa-circle-xmark',
    list: 'fa-solid fa-table-list',
    active: 'fa-solid fa-circle',
    agent: 'fa-solid fa-user-shield',
    home: 'fa-solid fa-building-columns',
    retry: 'fa-solid fa-rotate',
    info: 'fa-solid fa-circle-info',
    users: 'fa-solid fa-users',
    calendar: 'fa-solid fa-calendar-days',
    user: 'fa-solid fa-user',
    certificate: 'fa-solid fa-certificate',
    file: 'fa-solid fa-file-lines',
    clock: 'fa-solid fa-clock',
    save: 'fa-solid fa-floppy-disk',
    folder: 'fa-solid fa-folder-open',
    eye: 'fa-solid fa-eye',
    link: 'fa-solid fa-link',
    warning: 'fa-solid fa-triangle-exclamation',
    money: 'fa-solid fa-money-bill-wave',
    wallet: 'fa-solid fa-wallet',
    creditCard: 'fa-solid fa-credit-card',
    book: 'fa-solid fa-book-open',
    excel: 'fa-solid fa-file-excel'
};

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function icon(name) {
    return `<i class="${UI_ICONS[name] || UI_ICONS.info}"></i>`;
}

function getCurrentCredentials() {
    const pin = elements.kraPin?.value.trim() || appState.companyData?.pin || '';
    const password = elements.kraPassword?.value.trim() || appState.companyData?.password || '';

    if (appState.companyData) {
        appState.companyData.pin = pin || appState.companyData.pin;
        appState.companyData.password = password;
    }

    return {
        pin,
        password,
        name: appState.companyData?.name || ''
    };
}

function hasPin() {
    return Boolean(getCurrentCredentials().pin);
}

function hasPassword() {
    return Boolean(getCurrentCredentials().password);
}

function getBrowserSettings() {
    return {
        headless: elements.browserHeadless?.value === 'true'
    };
}

function updateModalBodyState() {
    document.body.classList.toggle('modal-open', Boolean(document.querySelector('.modal:not(.hidden)')));
}

function openModal(modal) {
    if (!modal) return;
    modal.classList.remove('hidden');
    updateModalBodyState();
}

function closeModal(modal) {
    if (!modal) return;
    modal.classList.add('hidden');
    updateModalBodyState();
}

function openPinOnlyBatchDialog() {
    openModal(elements.pinOnlyBatchModal);
    updateBatchCompaniesFromInput();
    updateUIState();
}

function closePinOnlyBatchDialog() {
    closeModal(elements.pinOnlyBatchModal);
}

function showBatchProgressCard(message = 'Preparing batch run...') {
    if (elements.pinOnlyBatchProgressCard) {
        elements.pinOnlyBatchProgressCard.classList.remove('hidden');
    }
    if (elements.batchProgressText) {
        elements.batchProgressText.textContent = 'PIN-Only Batch Progress';
    }
    if (elements.batchProgressPercentage) {
        elements.batchProgressPercentage.textContent = '0%';
    }
    if (elements.batchProgressFill) {
        elements.batchProgressFill.style.width = '0%';
    }
    if (elements.batchProgressStage) {
        elements.batchProgressStage.textContent = message;
    }
    if (elements.batchProgressLog) {
        elements.batchProgressLog.innerHTML = '';
    }
    appState.lastBatchProgressEntry = '';
}

function hideBatchProgressCard() {
    if (elements.pinOnlyBatchProgressCard) {
        elements.pinOnlyBatchProgressCard.classList.add('hidden');
    }
    appState.lastBatchProgressEntry = '';
}

function appendBatchProgressLog(message) {
    if (!elements.batchProgressLog || !message) return;
    if (appState.lastBatchProgressEntry === message) return;

    const logEntry = document.createElement('div');
    logEntry.textContent = message;
    elements.batchProgressLog.appendChild(logEntry);
    elements.batchProgressLog.scrollTop = elements.batchProgressLog.scrollHeight;
    appState.lastBatchProgressEntry = message;
}

function updateBatchProgressCard(progress) {
    if (!elements.pinOnlyBatchProgressCard || appState.activeProcess !== 'pinOnlyBatch') {
        return;
    }

    const percentage = Number.isFinite(progress.percentage)
        ? progress.percentage
        : Number.isFinite(progress.progress)
            ? progress.progress
            : undefined;

    if (percentage !== undefined) {
        const safePercentage = Math.max(0, Math.min(100, Math.round(percentage)));
        if (elements.batchProgressFill) {
            elements.batchProgressFill.style.width = `${safePercentage}%`;
        }
        if (elements.batchProgressPercentage) {
            elements.batchProgressPercentage.textContent = `${safePercentage}%`;
        }
    }

    if (elements.batchProgressText) {
        elements.batchProgressText.textContent = progress.stage || 'PIN-Only Batch Progress';
    }

    if (elements.batchProgressStage && progress.message) {
        elements.batchProgressStage.textContent = progress.message;
    }

    const logMessage = progress.log || (progress.message ? `${progress.stage ? `${progress.stage}: ` : ''}${progress.message}` : '');
    appendBatchProgressLog(logMessage);
}

function buildCompanyPayload() {
    const credentials = getCurrentCredentials();
    if (!appState.companyData && credentials.pin) {
        appState.companyData = {
            pin: credentials.pin,
            password: credentials.password,
            name: 'Unknown Company',
            browserSettings: getBrowserSettings()
        };
    }
    return {
        pin: credentials.pin,
        password: credentials.password,
        name: appState.companyData?.name || 'Unknown Company',
        browserSettings: getBrowserSettings()
    };
}

function setActionHint(actionId, message, isReady = false) {
    const hint = document.getElementById(`${actionId}Hint`);
    if (!hint) return;
    hint.textContent = message || '';
    hint.classList.toggle('hint-ready', Boolean(isReady));
}

function setButtonState(button, disabled, hintId, disabledReason, readyMessage) {
    if (!button) return;
    button.disabled = disabled;
    if (disabled && disabledReason) {
        button.title = disabledReason;
    } else {
        button.removeAttribute('title');
    }
    setActionHint(hintId, disabled ? disabledReason : readyMessage, !disabled);
}

function renderValidationExportInfo() {
    if (!elements.validationExportInfo) return;

    const exportInfo = appState.exports.validation;
    if (!exportInfo || (!exportInfo.primaryFile && !exportInfo.files?.length)) {
        elements.validationExportInfo.innerHTML = '';
        return;
    }

    elements.validationExportInfo.innerHTML = `
        <div class="validation-export-panel">
            ${buildResultActionButtons('validation')}
            ${buildExportFilesTable('validation')}
        </div>
    `;
}

function getSelectedAutomations() {
    return {
        passwordValidation: elements.includePasswordValidation?.checked || false,
        manufacturerDetails: elements.includeManufacturerDetails?.checked || false,
        agentStatus: elements.includeAgentStatus?.checked || false,
        obligationCheck: elements.includeObligationCheck?.checked || false,
        directorDetails: elements.includeDirectorDetails?.checked || false,
        vatReturns: elements.includeVATReturns?.checked || false,
        whVatReturns: elements.includeWhVatReturns?.checked || false,
        generalLedger: elements.includeGeneralLedger?.checked || false,
        taxCompliance: elements.includeTaxCompliance?.checked || false,
        liabilities: elements.includeLiabilities?.checked || false
    };
}

function getSelectedAutomationKeys() {
    return Object.entries(getSelectedAutomations())
        .filter(([, enabled]) => enabled)
        .map(([key]) => key);
}

function updateAutomationSelectionState() {
    const checkboxes = [...document.querySelectorAll('.automation-checkbox')];
    const selectedKeys = getSelectedAutomationKeys();
    const pinOnlySelected = selectedKeys.filter((key) => RUN_ALL_PIN_ONLY[key]).length;
    const passwordSelected = selectedKeys.filter((key) => RUN_ALL_PASSWORD_REQUIRED[key]).length;

    if (elements.selectAllAutomations) {
        const checkedCount = checkboxes.filter((checkbox) => checkbox.checked).length;
        elements.selectAllAutomations.checked = checkboxes.length > 0 && checkedCount === checkboxes.length;
        elements.selectAllAutomations.indeterminate = checkedCount > 0 && checkedCount < checkboxes.length;
    }

    if (!elements.runAllSelectionSummary) {
        return;
    }

    if (!selectedKeys.length) {
        elements.runAllSelectionSummary.textContent = 'No automation selected yet.';
        elements.runAllSelectionSummary.className = 'run-all-summary';
        return;
    }

    if (!hasPin()) {
        elements.runAllSelectionSummary.textContent = `${selectedKeys.length} selected. Add a KRA PIN to run them.`;
        elements.runAllSelectionSummary.className = 'run-all-summary';
        return;
    }

    if (!hasPassword() && pinOnlySelected === 0 && passwordSelected > 0) {
        elements.runAllSelectionSummary.textContent = `${selectedKeys.length} selected. Add the KRA password to run these password-protected automations.`;
        elements.runAllSelectionSummary.className = 'run-all-summary summary-warning';
        return;
    }

    if (!hasPassword() && passwordSelected > 0) {
        elements.runAllSelectionSummary.textContent = `${selectedKeys.length} selected: ${pinOnlySelected} PIN-only ready now, ${passwordSelected} password-protected will be skipped until you add the password.`;
        elements.runAllSelectionSummary.className = 'run-all-summary summary-warning';
        return;
    }

    elements.runAllSelectionSummary.textContent = `${selectedKeys.length} selected: ${pinOnlySelected} PIN-only and ${passwordSelected} password-protected. Ready to run.`;
    elements.runAllSelectionSummary.className = 'run-all-summary summary-ready';
}

function setAutomationSelection(mode) {
    const rules = {
        all: () => true,
        pinOnly: (checkbox) => Boolean(RUN_ALL_PIN_ONLY[checkbox.dataset.automationKey]),
        passwordOnly: (checkbox) => Boolean(RUN_ALL_PASSWORD_REQUIRED[checkbox.dataset.automationKey]),
        none: () => false
    };

    const matcher = rules[mode];
    if (!matcher) return;

    document.querySelectorAll('.automation-checkbox').forEach((checkbox) => {
        checkbox.checked = matcher(checkbox);
    });

    updateUIState();
}

function parseCsvRow(line) {
    const values = [];
    let current = '';
    let inQuotes = false;

    for (let index = 0; index < line.length; index += 1) {
        const char = line[index];
        const next = line[index + 1];

        if (char === '"' && inQuotes && next === '"') {
            current += '"';
            index += 1;
            continue;
        }

        if (char === '"') {
            inQuotes = !inQuotes;
            continue;
        }

        if (!inQuotes && (char === ',' || char === ';' || char === '\t')) {
            values.push(current.trim());
            current = '';
            continue;
        }

        current += char;
    }

    values.push(current.trim());
    return values;
}

function parseBatchCompanies(rawInput) {
    const normalizedInput = String(rawInput || '').replace(/\r/g, '').trim();
    if (!normalizedInput) {
        return { companies: [], skippedCount: 0, duplicateCount: 0 };
    }

    const lines = normalizedInput
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);

    if (!lines.length) {
        return { companies: [], skippedCount: 0, duplicateCount: 0 };
    }

    const firstRow = parseCsvRow(lines[0]);
    const normalizedHeaders = firstRow.map((value) => value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim());
    const headerLooksValid = normalizedHeaders.some((header) => ['pin', 'kra pin', 'kra_pin', 'kra pin number'].includes(header));
    const seenPins = new Set();
    const companies = [];
    let skippedCount = 0;
    let duplicateCount = 0;

    lines.forEach((line, index) => {
        const columns = parseCsvRow(line);
        if (!columns.length) {
            return;
        }

        if (index === 0 && headerLooksValid) {
            return;
        }

        let pin = '';
        let name = '';

        if (headerLooksValid) {
            const lookup = {};
            normalizedHeaders.forEach((header, headerIndex) => {
                lookup[header] = columns[headerIndex] || '';
            });

            pin = lookup['pin'] || lookup['kra pin'] || lookup['kra_pin'] || lookup['kra pin number'] || '';
            name = lookup['name'] || lookup['company'] || lookup['company name'] || lookup['taxpayer name'] || '';
        } else {
            [pin = '', name = ''] = columns;
        }

        const normalizedPin = pin.replace(/\s+/g, '').toUpperCase();
        if (!normalizedPin) {
            skippedCount += 1;
            return;
        }

        if (seenPins.has(normalizedPin)) {
            duplicateCount += 1;
            return;
        }

        seenPins.add(normalizedPin);
        companies.push({
            pin: normalizedPin,
            name: name.trim()
        });
    });

    return { companies, skippedCount, duplicateCount };
}

function updateBatchCompaniesFromInput() {
    const parsed = parseBatchCompanies(elements.batchPinList?.value || '');
    appState.batchCompanies = parsed.companies;

    if (elements.batchPinListSummary) {
        if (!parsed.companies.length) {
            elements.batchPinListSummary.textContent = 'Paste PINs or import a CSV to prepare a batch.';
            elements.batchPinListSummary.className = 'action-hint';
        } else {
            const notes = [];
            if (parsed.skippedCount) notes.push(`${parsed.skippedCount} empty/invalid row${parsed.skippedCount === 1 ? '' : 's'} skipped`);
            if (parsed.duplicateCount) notes.push(`${parsed.duplicateCount} duplicate PIN${parsed.duplicateCount === 1 ? '' : 's'} removed`);
            elements.batchPinListSummary.textContent = `${parsed.companies.length} company PIN${parsed.companies.length === 1 ? '' : 's'} ready.${notes.length ? ` ${notes.join('. ')}.` : ''}`;
            elements.batchPinListSummary.className = 'action-hint hint-ready';
        }
    }

    return parsed;
}

function getSelectedPinOnlyAutomationKeys() {
    return getSelectedAutomationKeys().filter((key) => RUN_ALL_PIN_ONLY[key]);
}

function getDisabledReason(rule) {
    if (appState.isProcessing) {
        return 'A process is already running. Wait for it to finish first.';
    }

    if (rule.pin && !hasPin()) {
        return 'Enter a KRA PIN first.';
    }

    if (rule.password && !hasPassword()) {
        return 'Enter the KRA password for this section.';
    }

    if (rule.company && !appState.companyData) {
        return 'Fetch company details first so the section has a company context.';
    }

    return '';
}

function normalizeExportFiles(sectionKey, result) {
    const folderPath = result.companyFolder || result.downloadPath || result.folderPath || '';
    const files = [];

    if (result.filePath) {
        files.push(result.filePath);
    }

    if (Array.isArray(result.files)) {
        result.files.forEach((file) => {
            if (!file) return;
            files.push(path.isAbsolute(file) ? file : (folderPath ? path.join(folderPath, file) : file));
        });
    }

    const uniqueFiles = [...new Set(files)];
    appState.exports[sectionKey] = {
        label: SECTION_EXPORT_LABELS[sectionKey] || sectionKey,
        files: uniqueFiles,
        primaryFile: uniqueFiles[0] || '',
        folderPath: folderPath || (uniqueFiles[0] ? path.dirname(uniqueFiles[0]) : ''),
        timestamp: new Date().toISOString()
    };
}

function buildResultActionButtons(sectionKey, includeFolder = true) {
    const exportInfo = appState.exports[sectionKey];
    if (!exportInfo || (!exportInfo.primaryFile && !exportInfo.folderPath)) {
        return '';
    }

    const actions = [];
    if (exportInfo.primaryFile) {
        actions.push(`<button class="btn btn-secondary btn-sm" data-action-type="open-file" data-path="${escapeHtml(exportInfo.primaryFile)}"><span class="btn-icon"><i class="fa-solid fa-file-arrow-down"></i></span>Open File</button>`);
    }
    if (includeFolder && exportInfo.folderPath) {
        actions.push(`<button class="btn btn-ghost btn-sm" data-action-type="open-folder" data-path="${escapeHtml(exportInfo.folderPath)}"><span class="btn-icon"><i class="fa-solid fa-folder-open"></i></span>Open Folder</button>`);
    }

    if (!actions.length) {
        return '';
    }

    return `<div class="button-group result-actions">${actions.join('')}</div>`;
}

function getFileTypeLabel(filePath) {
    const extension = path.extname(filePath || '').toLowerCase();
    if (extension === '.xlsx' || extension === '.xls') return 'Excel';
    if (extension === '.json') return 'JSON';
    if (extension === '.pdf') return 'PDF';
    if (extension === '.csv') return 'CSV';
    if (!extension) return 'File';
    return extension.replace('.', '').toUpperCase();
}

function buildExportFilesTable(sectionKey) {
    const exportInfo = appState.exports[sectionKey];
    if (!exportInfo || !exportInfo.files?.length) {
        return '';
    }

    return `
        <div class="data-section">
            <div class="section-header"><h4>Saved Files</h4></div>
            <table class="data-table saved-files-table">
                <thead>
                    <tr>
                        <th>File</th>
                        <th>Type</th>
                        <th>Folder</th>
                        <th>Actions</th>
                    </tr>
                </thead>
                <tbody>
                    ${exportInfo.files.map(filePath => `
                        <tr>
                            <td>${escapeHtml(path.basename(filePath))}</td>
                            <td>${getFileTypeLabel(filePath)}</td>
                            <td data-wrap="true">${escapeHtml(path.dirname(filePath))}</td>
                            <td class="file-actions-cell">
                                <div class="button-group result-actions compact-actions">
                                    <button class="btn btn-secondary btn-sm" data-action-type="open-file" data-path="${escapeHtml(filePath)}"><span class="btn-icon"><i class="fa-solid fa-file-arrow-down"></i></span>Open File</button>
                                    <button class="btn btn-ghost btn-sm" data-action-type="open-folder" data-path="${escapeHtml(path.dirname(filePath))}"><span class="btn-icon"><i class="fa-solid fa-folder-open"></i></span>Open Folder</button>
                                </div>
                            </td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
        </div>
    `;
}

// Initialize the application
function init() {
    console.log('Initializing KRA Automation Suite...');
    setupEventListeners();
    setDefaultDownloadPath();
    loadConfiguration(true);

    // Initialize date input toggles
    toggleVATDateInputs();
    toggleWhVATDateInputs();
    toggleVATRangeInputs();
    toggleWhVATRangeInputs();

    updateBatchCompaniesFromInput();
    updateUIState();
}

// Set up event listeners
function setupEventListeners() {
    console.log('Setting up event listeners...');

    // Sidebar navigation items
    elements.navItems.forEach(btn => {
        btn.addEventListener('click', () => {
            console.log('Nav item clicked:', btn.dataset.tab);
            switchTab(btn.dataset.tab);
        });
    });

    // Step 1: Company Setup
    if (elements.fetchCompanyDetails) {
        elements.fetchCompanyDetails.addEventListener('click', fetchCompanyDetails);
        console.log('Fetch Company Details button listener added');
    }

    if (elements.validateCredentials) {
        elements.validateCredentials.addEventListener('click', validateCredentials);
        console.log('Validate Credentials button listener added');
    }

    if (elements.confirmCompanyDetails) {
        elements.confirmCompanyDetails.addEventListener('click', confirmCompanyDetails);
    }

    // Step 2: Password Validation
    if (elements.runPasswordValidation) {
        elements.runPasswordValidation.addEventListener('click', runPasswordValidation);
    }

    // Step 3: Manufacturer Details
    if (elements.fetchManufacturerDetails) {
        elements.fetchManufacturerDetails.addEventListener('click', fetchManufacturerDetails);
    }

    // Step 4: Director Details
    if (elements.runDirectorDetailsExtraction) {
        elements.runDirectorDetailsExtraction.addEventListener('click', runDirectorDetailsExtraction);
    }

    if (elements.exportManufacturerDetails) {
        elements.exportManufacturerDetails.addEventListener('click', exportManufacturerDetails);
    }

    // Step 4: Obligation Checker
    if (elements.runObligationCheck) {
        elements.runObligationCheck.addEventListener('click', runObligationCheck);
    }

    // Step 6: Agent Checker
    if (elements.runAgentCheck) {
        elements.runAgentCheck.addEventListener('click', runAgentCheck);
    }

    // Refresh Profile Button
    const refreshProfileBtn = document.getElementById('refreshProfileBtn');
    if (refreshProfileBtn) {
        refreshProfileBtn.addEventListener('click', () => {
            refreshFullProfile();
            showToast({
                type: 'info',
                title: 'Profile Refreshed',
                message: 'Full profile data has been updated'
            });
        });
    }

    // Step 7: Liabilities
    if (elements.runLiabilitiesExtraction) {
        elements.runLiabilitiesExtraction.addEventListener('click', runLiabilitiesExtraction);
    }

    // Step 5: VAT Returns
    elements.vatDateRange.forEach(radio => {
        radio.addEventListener('change', toggleVATDateInputs);
    });

    if (elements.runVATExtraction) {
        elements.runVATExtraction.addEventListener('click', runVATExtraction);
    }

    // WH VAT Returns
    elements.whVatDateRange.forEach(radio => {
        radio.addEventListener('change', toggleWhVATDateInputs);
    });

    if (elements.runWhVATExtraction) {
        elements.runWhVATExtraction.addEventListener('click', runWhVATExtraction);
    }

    // Run All - Select All Checkbox
    if (elements.selectAllAutomations) {
        elements.selectAllAutomations.addEventListener('change', toggleAllAutomations);
    }

    if (elements.selectPinOnlyAutomations) {
        elements.selectPinOnlyAutomations.addEventListener('click', () => setAutomationSelection('pinOnly'));
    }

    if (elements.selectPasswordAutomations) {
        elements.selectPasswordAutomations.addEventListener('click', () => setAutomationSelection('passwordOnly'));
    }

    if (elements.clearAutomations) {
        elements.clearAutomations.addEventListener('click', () => setAutomationSelection('none'));
    }

    if (elements.openPinOnlyBatchDialog) {
        elements.openPinOnlyBatchDialog.addEventListener('click', openPinOnlyBatchDialog);
    }

    if (elements.pinOnlyBatchOverlay) {
        elements.pinOnlyBatchOverlay.addEventListener('click', closePinOnlyBatchDialog);
    }

    if (elements.closePinOnlyBatchModal) {
        elements.closePinOnlyBatchModal.addEventListener('click', closePinOnlyBatchDialog);
    }

    if (elements.closePinOnlyBatchDialog) {
        elements.closePinOnlyBatchDialog.addEventListener('click', closePinOnlyBatchDialog);
    }

    if (elements.batchPinList) {
        elements.batchPinList.addEventListener('input', () => {
            updateBatchCompaniesFromInput();
            updateUIState();
        });
    }

    if (elements.importBatchCsv && elements.batchCsvFile) {
        elements.importBatchCsv.addEventListener('click', () => {
            elements.batchCsvFile.click();
        });

        elements.batchCsvFile.addEventListener('change', async (event) => {
            const file = event.target.files?.[0];
            if (!file) return;

            const contents = await file.text();
            if (elements.batchPinList) {
                elements.batchPinList.value = contents;
            }
            elements.batchCsvFile.value = '';

            updateBatchCompaniesFromInput();
            updateUIState();
        });
    }

    if (elements.clearBatchPins) {
        elements.clearBatchPins.addEventListener('click', () => {
            if (elements.batchPinList) {
                elements.batchPinList.value = '';
            }
            if (elements.batchCsvFile) {
                elements.batchCsvFile.value = '';
            }
            appState.batchCompanies = [];
            if (elements.pinOnlyBatchResults) {
                elements.pinOnlyBatchResults.classList.add('hidden');
                elements.pinOnlyBatchResults.innerHTML = '';
            }
            if (!appState.isProcessing) {
                hideBatchProgressCard();
            }
            updateBatchCompaniesFromInput();
            updateUIState();
        });
    }

    if (elements.runPinOnlyBatch) {
        elements.runPinOnlyBatch.addEventListener('click', runPinOnlyBatch);
    }

    // Run All - VAT Date Range Dropdown
    if (elements.runAllVatRangeType) {
        elements.runAllVatRangeType.addEventListener('change', toggleVATRangeInputs);
    }

    // Run All - WH VAT Date Range Dropdown
    if (elements.runAllWhVatRangeType) {
        elements.runAllWhVatRangeType.addEventListener('change', toggleWhVATRangeInputs);
    }

    // Step 5: General Ledger
    if (elements.runLedgerExtraction) {
        elements.runLedgerExtraction.addEventListener('click', runLedgerExtraction);
    }

    // Step 6: Run All
    if (elements.runAllAutomations) {
        elements.runAllAutomations.addEventListener('click', runAllAutomations);
    }

    // Tax Compliance
    if (elements.runTCCDownloader) {
        elements.runTCCDownloader.addEventListener('click', runTCCDownloader);
    }

    if (elements.saveConfig) {
        elements.saveConfig.addEventListener('click', saveConfiguration);
    }

    if (elements.loadConfig) {
        elements.loadConfig.addEventListener('click', loadConfiguration);
    }

    // Settings Modal
    const settingsBtn = document.getElementById('settingsBtn');
    const settingsModal = document.getElementById('settingsModal');
    const closeSettingsModal = document.getElementById('closeSettingsModal');
    const cancelSettings = document.getElementById('cancelSettings');
    const saveSettings = document.getElementById('saveSettings');
    const selectOutputFolder = document.getElementById('selectOutputFolder');

    if (settingsBtn) {
        settingsBtn.addEventListener('click', () => {
            // Load current settings
            const settingsDownloadPath = document.getElementById('settingsDownloadPath');
            const settingsOutputFormat = document.getElementById('settingsOutputFormat');
            const settingsBrowserMode = document.getElementById('settingsBrowserMode');
            if (settingsDownloadPath) {
                settingsDownloadPath.value = elements.downloadPath?.value || path.join(os.homedir(), 'Downloads', 'KRA POST PORTUM TOOL');
            }
            if (settingsOutputFormat && elements.outputFormat) {
                settingsOutputFormat.value = elements.outputFormat.value;
            }
            if (settingsBrowserMode && elements.browserHeadless) {
                settingsBrowserMode.value = elements.browserHeadless.value === 'true' ? 'headless' : 'guided';
            }
            openModal(settingsModal);
        });
    }

    if (closeSettingsModal) {
        closeSettingsModal.addEventListener('click', () => {
            closeModal(settingsModal);
        });
    }

    if (cancelSettings) {
        cancelSettings.addEventListener('click', () => {
            closeModal(settingsModal);
        });
    }

    if (saveSettings) {
        saveSettings.addEventListener('click', () => {
            const settingsDownloadPath = document.getElementById('settingsDownloadPath');
            const settingsOutputFormat = document.getElementById('settingsOutputFormat');
            const settingsBrowserMode = document.getElementById('settingsBrowserMode');

            if (settingsDownloadPath && elements.downloadPath) {
                elements.downloadPath.value = settingsDownloadPath.value;
                updateSidebarFolderPath(settingsDownloadPath.value);
            }
            if (settingsOutputFormat && elements.outputFormat) {
                elements.outputFormat.value = settingsOutputFormat.value;
            }
            if (settingsBrowserMode && elements.browserHeadless) {
                elements.browserHeadless.value = settingsBrowserMode.value === 'headless' ? 'true' : 'false';
            }

            closeModal(settingsModal);
            saveConfiguration();
            showToast({
                type: 'success',
                title: 'Settings Saved',
                message: 'Your preferences have been updated'
            });
        });
    }

    if (selectOutputFolder) {
        selectOutputFolder.addEventListener('click', async () => {
            const result = await ipcRenderer.invoke('select-folder');
            if (result && result.success && result.folderPath) {
                const settingsDownloadPath = document.getElementById('settingsDownloadPath');
                if (settingsDownloadPath) {
                    settingsDownloadPath.value = result.folderPath;
                }
            }
        });
    }

    document.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape') return;

        if (elements.pinOnlyBatchModal && !elements.pinOnlyBatchModal.classList.contains('hidden')) {
            closePinOnlyBatchDialog();
            return;
        }

        if (settingsModal && !settingsModal.classList.contains('hidden')) {
            closeModal(settingsModal);
        }
    });

    // Open folder button in sidebar
    const openFolderBtn = document.getElementById('openFolderBtn');
    if (openFolderBtn) {
        openFolderBtn.addEventListener('click', async () => {
            const downloadPath = elements.downloadPath?.value || path.join(os.homedir(), 'Downloads', 'KRA POST PORTUM TOOL');
            await window.openFolder(downloadPath);
        });
    }

    if (elements.openFilesFolder) {
        elements.openFilesFolder.addEventListener('click', async () => {
            const exportFolders = Object.values(appState.exports).map(info => info.folderPath).filter(Boolean);
            const targetFolder = exportFolders[0] || elements.downloadPath?.value || path.join(os.homedir(), 'Downloads', 'KRA POST PORTUM TOOL');
            await window.openFolder(targetFolder);
        });
    }

    // Form validation
    [elements.kraPin, elements.kraPassword].forEach(input => {
        if (input) {
            input.addEventListener('input', updateUIState);
        }
    });

    document.querySelectorAll('.automation-checkbox').forEach(checkbox => {
        checkbox.addEventListener('change', updateUIState);
    });

    document.addEventListener('click', async (event) => {
        const actionButton = event.target.closest('[data-action-type]');
        if (!actionButton) return;

        const actionType = actionButton.dataset.actionType;
        const targetPath = actionButton.dataset.path;
        if (!targetPath) return;

        if (actionType === 'open-file') {
            await window.openFile(targetPath);
        }

        if (actionType === 'open-folder') {
            await window.openFolder(targetPath);
        }
    });

    // Progress updates from main process
    ipcRenderer.on('automation-progress', (event, progress) => {
        updateProgress(progress);
    });

    console.log('All event listeners set up successfully');
}

// Tab management
function switchTab(tabId) {
    console.log('Switching to tab:', tabId);

    // Update sidebar navigation items
    elements.navItems.forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tabId);
    });

    // Update tab content
    elements.tabContents.forEach(content => {
        content.classList.toggle('active', content.id === tabId);
    });

    if (elements.contentArea) {
        elements.contentArea.classList.toggle('wide-layout', tabId === 'all-automations');
    }

    // Update page header
    updatePageHeader(tabId);

    // Update current step
    const stepMap = {
        'company-setup': 1,
        'password-validation': 2,
        'full-profile': 2,
        'manufacturer-details': 3,
        'director-details': 4,
        'obligation-checker': 5,
        'agent-checker': 6,
        'liabilities': 7,
        'vat-returns': 8,
        'wh-vat-returns': 9,
        'general-ledger': 10,
        'tax-compliance': 11,
        'all-automations': 12
    };
    appState.currentStep = stepMap[tabId] || 1;

    // Update displays when switching tabs
    if (tabId === 'password-validation' && appState.companyData) {
        // Update validation tab with company info
        if (elements.validationCompanyName) {
            elements.validationCompanyName.textContent = appState.companyData.name || '-';
        }
        if (elements.validationPIN) {
            elements.validationPIN.textContent = appState.companyData.pin || '-';
        }
        if (appState.validationStatus) {
            updateValidationDisplay({ status: appState.validationStatus });
        }
    }

    if (tabId === 'manufacturer-details' && appState.companyData) {
        // Show company info on manufacturer details tab
        if (appState.manufacturerData) {
            displayManufacturerDetails(appState.manufacturerData);
        }
    }
}

// Update page header based on current tab
function updatePageHeader(tabId) {
    const pageTitle = document.getElementById('pageTitle');
    const pageDescription = document.getElementById('pageDescription');

    const titles = {
        'company-setup': {
            title: 'Company Setup',
            description: 'Enter the KRA PIN first. Only login-protected sections need a password.'
        },
        'password-validation': {
            title: 'Credential Validation',
            description: 'Check the login and save a validation result to Excel.'
        },
        'full-profile': {
            title: 'Full Company Profile',
            description: 'Comprehensive view of all extracted data'
        },
        'manufacturer-details': {
            title: 'Manufacturer Details',
            description: 'PIN-only section for company registration details.'
        },
        'director-details': {
            title: 'Director Details',
            description: 'Extract company director and associate details'
        },
        'obligation-checker': {
            title: 'Obligation Checker',
            description: 'PIN-only section for tax obligations and registration status.'
        },
        'agent-checker': {
            title: 'Withholding Agent Checker',
            description: 'PIN-only section for VAT and Rent Income agent status.'
        },
        'liabilities': {
            title: 'Liabilities Extraction',
            description: 'Extract Income Tax, VAT, and PAYE liabilities'
        },
        'vat-returns': {
            title: 'VAT Returns',
            description: 'Extract VAT return data from KRA portal'
        },
        'wh-vat-returns': {
            title: 'Withholding VAT Returns',
            description: 'Extract Withholding VAT return data'
        },
        'general-ledger': {
            title: 'General Ledger',
            description: 'Extract ledger transactions'
        },
        'tax-compliance': {
            title: 'Tax Compliance Certificate',
            description: 'Download the latest tax compliance certificate.'
        },
        'all-automations': {
            title: 'Run All Automations',
            description: 'PIN-only automations can run without a password.'
        }
    };

    const info = titles[tabId] || { title: 'KRA Automation Suite', description: '' };

    if (pageTitle) {
        pageTitle.textContent = info.title;
    }
    if (pageDescription) {
        pageDescription.textContent = info.description;
    }
}

// Set default download path
function setDefaultDownloadPath() {
    const defaultPath = path.join(os.homedir(), 'Downloads', 'KRA POST PORTUM TOOL');
    if (elements.downloadPath) {
        elements.downloadPath.value = defaultPath;
    }
    updateSidebarFolderPath(defaultPath);
}

// Update UI state based on app state
function updateUIState() {
    const credentials = getCurrentCredentials();
    const pinAvailable = Boolean(credentials.pin);
    const passwordAvailable = Boolean(credentials.password);

    renderValidationExportInfo();
    updateAutomationSelectionState();

    // Update Run All credentials display
    if (elements.runAllPinDisplay) elements.runAllPinDisplay.value = credentials.pin || '';
    if (elements.runAllPasswordDisplay) elements.runAllPasswordDisplay.value = credentials.password || '';
    if (elements.runAllCompanyDisplay) elements.runAllCompanyDisplay.value = appState.companyData?.name || 'Not fetched yet';

    Object.entries(ACTION_RULES).forEach(([actionId, rule]) => {
        const button = elements[actionId];
        const disabledReason = getDisabledReason(rule);
        setButtonState(button, Boolean(disabledReason), actionId, disabledReason, rule.ready);
    });

    if (elements.exportManufacturerDetails) {
        elements.exportManufacturerDetails.classList.toggle('hidden', !appState.manufacturerData);
        elements.exportManufacturerDetails.disabled = !appState.manufacturerData || appState.isProcessing;
    }

    const selectedKeys = getSelectedAutomationKeys();
    let runAllReason = '';
    let runAllReadyMessage = 'Ready to run the selected automations.';
    if (appState.isProcessing) {
        runAllReason = 'A process is already running. Wait for it to finish first.';
    } else if (!selectedKeys.length) {
        runAllReason = 'Select at least one automation to run.';
    } else if (!pinAvailable) {
        runAllReason = 'Enter a KRA PIN before running automations.';
    } else {
        const passwordNeededLabels = selectedKeys.filter((key) => RUN_ALL_PASSWORD_REQUIRED[key]).map((key) => RUN_ALL_PASSWORD_REQUIRED[key]);
        const runnableWithoutPassword = selectedKeys.some((key) => RUN_ALL_PIN_ONLY[key]);

        if (passwordNeededLabels.length && !passwordAvailable && !runnableWithoutPassword) {
            runAllReason = `Add the KRA password to run: ${passwordNeededLabels.join(', ')}.`;
        } else if (passwordNeededLabels.length && !passwordAvailable) {
            runAllReadyMessage = `Ready to run PIN-only selections. These will be skipped until a password is added: ${passwordNeededLabels.join(', ')}.`;
        }
    }
    setButtonState(
        elements.runAllAutomations,
        Boolean(runAllReason),
        'runAllAutomations',
        runAllReason,
        runAllReadyMessage
    );

    const selectedPinOnlyAutomations = getSelectedPinOnlyAutomationKeys();
    let batchReason = '';
    let batchReadyMessage = 'Ready to run the selected PIN-only automations for the imported company list.';

    if (appState.isProcessing) {
        batchReason = 'A process is already running. Wait for it to finish first.';
    } else if (!appState.batchCompanies.length) {
        batchReason = 'Paste company PINs or import a CSV first.';
    } else if (!selectedPinOnlyAutomations.length) {
        batchReason = 'Select at least one PIN-only automation to run in batch.';
    } else {
        batchReadyMessage = `Ready to run ${selectedPinOnlyAutomations.map((key) => RUN_ALL_PIN_ONLY[key]).join(', ')} for ${appState.batchCompanies.length} company PIN${appState.batchCompanies.length === 1 ? '' : 's'}.`;
    }

    setButtonState(
        elements.runPinOnlyBatch,
        Boolean(batchReason),
        'runPinOnlyBatch',
        batchReason,
        batchReadyMessage
    );

    // Update tab completion status
    updateTabCompletionStatus();

    // Update tab states (e.g., add checkmarks for completed steps)
    const validationTab = document.querySelector('[data-tab="password-validation"]');
    if (validationTab) {
        if (appState.hasValidation) {
            validationTab.classList.add('completed');
        } else {
            validationTab.classList.remove('completed');
        }
    }

    const detailsTab = document.querySelector('[data-tab="manufacturer-details"]');
    if (detailsTab) {
        if (appState.manufacturerData) {
            detailsTab.classList.add('completed');
        } else {
            detailsTab.classList.remove('completed');
        }
    }

    const obligationTab = document.querySelector('[data-tab="obligation-checker"]');
    if (obligationTab) {
        if (appState.obligationData) {
            obligationTab.classList.add('completed');
        } else {
            obligationTab.classList.remove('completed');
        }
    }

    const agentCheckTab = document.querySelector('[data-tab="agent-checker"]');
    if (agentCheckTab) {
        if (appState.agentData) {
            agentCheckTab.classList.add('completed');
        } else {
            agentCheckTab.classList.remove('completed');
        }
    }

    const liabilitiesTab = document.querySelector('[data-tab="liabilities"]');
    if (liabilitiesTab) {
        if (appState.liabilitiesData) {
            liabilitiesTab.classList.add('completed');
        } else {
            liabilitiesTab.classList.remove('completed');
        }
    }

    const vatTab = document.querySelector('[data-tab="vat-returns"]');
    if (vatTab) {
        if (appState.vatData) {
            vatTab.classList.add('completed');
        } else {
            vatTab.classList.remove('completed');
        }
    }

    const ledgerTab = document.querySelector('[data-tab="general-ledger"]');
    if (ledgerTab) {
        if (appState.ledgerData) {
            ledgerTab.classList.add('completed');
        } else {
            ledgerTab.classList.remove('completed');
        }
    }
}

// Update tab completion status
function updateTabCompletionStatus() {
    const tabs = document.querySelectorAll('.tab-btn');

    // Step 1: Company Setup
    if (appState.companyData) {
        tabs[0]?.classList.add('completed');
    }

    // Step 2: Password Validation
    if (appState.validationStatus === 'Valid') {
        tabs[1]?.classList.add('completed');
    }

    // Step 3: Manufacturer Details
    if (appState.manufacturerData) {
        tabs[2]?.classList.add('completed');
    }

    // Step 4: Director Details
    if (appState.directorDetails) {
        tabs[3]?.classList.add('completed');
    }

    // Step 4 & 5: VAT and Ledger (based on results)
    if (appState.automationResults.vat) {
        tabs[3]?.classList.add('completed');
    }
    if (appState.automationResults.ledger) {
        tabs[4]?.classList.add('completed');
    }

    // Tax Compliance
    if (appState.tccData) {
        tabs[8]?.classList.add('completed');
    }
}

// Toggle VAT date inputs
function toggleVATDateInputs() {
    const isCustom = document.querySelector('input[name="vatDateRange"]:checked')?.value === 'custom';
    if (elements.vatCustomDateInputs) {
        elements.vatCustomDateInputs.classList.toggle('hidden', !isCustom);
    }
}

// Get VAT date range from form
function getVATDateRange() {
    const selectedOption = document.querySelector('input[name="vatDateRange"]:checked')?.value;

    if (selectedOption === 'custom') {
        const startYear = parseInt(elements.vatStartYear?.value) || new Date().getFullYear();
        const startMonth = parseInt(elements.vatStartMonth?.value) || 1;
        const endYear = parseInt(elements.vatEndYear?.value) || new Date().getFullYear();
        const endMonth = parseInt(elements.vatEndMonth?.value) || 12;

        return {
            type: 'custom',
            startYear: startYear,
            startMonth: startMonth,
            endYear: endYear,
            endMonth: endMonth
        };
    } else {
        return { type: 'all' };
    }
}

// Get Run All date range from form
function getRunAllDateRange() {
    return { type: 'all' };
}

// Step 1: Fetch company details from manufacturer API
async function fetchCompanyDetails() {
    console.log('Fetch Company Details clicked');

    const pin = elements.kraPin?.value.trim();
    if (!pin) {
        await showMessage({
            type: 'error',
            title: 'Validation Error',
            message: 'Please enter a KRA PIN.'
        });
        return;
    }

    try {
        appState.isProcessing = true;
        updateUIState();
        showProgressSection('Fetching company details...');

        console.log('Calling fetch-manufacturer-details with PIN:', pin);

        const company = {
            pin: pin,
            password: elements.kraPassword?.value.trim(),
            browserSettings: getBrowserSettings()
        };

        const result = await ipcRenderer.invoke('fetch-manufacturer-details', { company });

        if (result.success && result.data) {
            // Reset related state when fetching new company details
            appState.validationStatus = null;
            appState.hasValidation = false; // Reset validation status
            appState.obligationData = null; // Reset obligation data
            appState.liabilitiesData = null; // Reset liabilities data
            appState.vatData = null; // Reset VAT data
            appState.whVatData = null;
            appState.ledgerData = null; // Reset ledger data
            appState.agentData = null;
            appState.tccData = null; // Reset TCC data
            appState.exports = {};
            updateValidationDisplay({ status: 'Not Validated' });

            const data = result.data;

            // Save manufacturer data for Tab 3
            appState.manufacturerData = data;

            appState.companyData = {
                pin: pin,
                password: elements.kraPassword?.value.trim(),
                name: data.timsManBasicRDtlDTO?.manufacturerName || 'Unknown Company',
                businessName: data.manBusinessRDtlDTO?.businessName || 'N/A',
                businessRegNo: data.timsManBasicRDtlDTO?.manufacturerBrNo || 'N/A',
                mobile: data.manContactRDtlDTO?.mobileNo || 'N/A',
                email: data.manContactRDtlDTO?.mainEmail || 'N/A',
                address: data.manAddRDtlDTO?.descriptiveAddress || 'N/A',
                browserSettings: getBrowserSettings()
            };

            displayCompanyDetails(appState.companyData);
            updateCompanyBadge();
            refreshFullProfile();
            if (elements.companyDetailsResult) {
                elements.companyDetailsResult.classList.remove('hidden');
            }

            // Automatically export manufacturer details to Excel
            if (elements.progressText) {
                elements.progressText.textContent = 'Exporting manufacturer details to Excel...';
            }
            const downloadPath = elements.downloadPath?.value || path.join(os.homedir(), 'Downloads', 'KRA POST PORTUM TOOL');

            const exportResult = await ipcRenderer.invoke('export-manufacturer-details', {
                company: appState.companyData,
                data: appState.manufacturerData,
                downloadPath: downloadPath
            });

            if (exportResult.success && elements.progressText) {
                elements.progressText.textContent = `Saved to: ${exportResult.fileName || 'Consolidated Report'}`;
                normalizeExportFiles('company', exportResult);
                normalizeExportFiles('manufacturer', exportResult);
                displayCompanyDetails(appState.companyData);
                displayManufacturerDetails(appState.manufacturerData);
            }

            hideProgressSection();

            await showMessage({
                type: 'info',
                title: 'Success',
                message: `Company details fetched and saved successfully!\nFile: ${exportResult.fileName || 'Consolidated Report'}`
            });
        } else {
            throw new Error(result.error || 'Failed to fetch company details');
        }
    } catch (error) {
        console.error('Error fetching company details:', error);
        await showMessage({
            type: 'error',
            title: 'Error',
            message: `Failed to fetch company details: ${error.message}`
        });
        hideProgressSection();
    } finally {
        appState.isProcessing = false;
        updateUIState();
    }
}

// Display company details
function displayCompanyDetails(company) {
    if (!elements.companyInfo) return;

    elements.companyInfo.innerHTML = `
        ${buildResultActionButtons('company')}
        <table class="data-table">
            <tbody>
                <tr>
                    <td><strong>Company Name</strong></td>
                    <td>${escapeHtml(company.name || 'N/A')}</td>
                </tr>
                <tr>
                    <td><strong>Business Name</strong></td>
                    <td>${escapeHtml(company.businessName || 'N/A')}</td>
                </tr>
                <tr>
                    <td><strong>KRA PIN</strong></td>
                    <td>${escapeHtml(company.pin || 'N/A')}</td>
                </tr>
                <tr>
                    <td><strong>Business Reg. No</strong></td>
                    <td>${escapeHtml(company.businessRegNo || 'N/A')}</td>
                </tr>
                <tr>
                    <td><strong>Mobile</strong></td>
                    <td>${escapeHtml(company.mobile || 'N/A')}</td>
                </tr>
                <tr>
                    <td><strong>Email</strong></td>
                    <td>${escapeHtml(company.email || 'N/A')}</td>
                </tr>
                <tr>
                    <td><strong>Address</strong></td>
                    <td>${escapeHtml(company.address || 'N/A')}</td>
                </tr>
            </tbody>
        </table>
        ${buildExportFilesTable('company')}
    `;
}

// Step 1: Validate credentials
async function validateCredentials() {
    console.log('Validate Credentials clicked');

    if (!appState.companyData) {
        await fetchCompanyDetails();
        if (!appState.companyData) return;
    }

    try {
        appState.isProcessing = true;
        updateUIState();
        showProgressSection('Validating KRA credentials...');

        const downloadPath = elements.downloadPath?.value || path.join(os.homedir(), 'Downloads', 'KRA POST PORTUM TOOL');

        const result = await ipcRenderer.invoke('validate-kra-credentials', {
            company: buildCompanyPayload(),
            downloadPath: downloadPath
        });

        if (result.success) {
            appState.validationStatus = result.status;
            appState.hasValidation = result.status === 'Valid';
            normalizeExportFiles('validation', result);
            updateValidationDisplay(result);
            hideProgressSection();

            await showMessage({
                type: result.status === 'Valid' ? 'info' : 'warning',
                title: 'Validation Result',
                message: `Status: ${result.status} - ${result.message}`
            });
        } else {
            throw new Error(result.error || 'Validation failed');
        }
    } catch (error) {
        console.error('Error validating credentials:', error);
        await showMessage({
            type: 'error',
            title: 'Validation Error',
            message: `Failed to validate credentials: ${error.message}`
        });
        hideProgressSection();
    } finally {
        appState.isProcessing = false;
        updateUIState();
    }
}

// Update validation display
function updateValidationDisplay(result) {
    if (elements.validationCompanyName) {
        elements.validationCompanyName.textContent = appState.companyData?.name || '-';
    }
    if (elements.validationPIN) {
        elements.validationPIN.textContent = appState.companyData?.pin || '-';
    }
    if (elements.validationResult) {
        elements.validationResult.textContent = result.status;
        elements.validationResult.className = `status-value ${result.status === 'Valid' ? 'success' : 'error'}`;
    }
}


// Display manufacturer details in comprehensive table format
function displayManufacturerDetails(data) {
    if (!elements.manufacturerInfo) return;

    const basic = data.timsManBasicRDtlDTO || {};
    const business = data.manBusinessRDtlDTO || {};
    const contact = data.manContactRDtlDTO || {};
    const address = data.manAddRDtlDTO || {};
    const authorization = data.manAuthDTO || {};
    // Build comprehensive details array with ALL available fields
    const detailsSections = [
        {
            category: 'Basic Information',
            items: [
                { label: 'Manufacturer Name', value: basic.manufacturerName },
                { label: 'Business Registration No.', value: basic.manufacturerBrNo },
                { label: 'Manufacturer Code', value: basic.manufacturerCode },
                { label: 'Manufacturer Type', value: basic.manufacturerType },
                { label: 'Registration Status', value: basic.registrationStatus },
                { label: 'Effective Date', value: basic.effectiveDate }
            ]
        },
        {
            category: 'Business Details',
            items: [
                { label: 'Business Name', value: business.businessName },
                { label: 'Business Registration Certificate No.', value: business.businessRegCertNo },
                { label: 'Business Registration Date', value: business.businessRegDate },
                { label: 'Business Commencement Date', value: business.businessComDate },
                { label: 'Nature of Business', value: business.natureOfBusiness },
                { label: 'Business Type', value: business.businessType },
                { label: 'Business Category', value: business.businessCategory }
            ]
        },
        {
            category: 'Contact Information',
            items: [
                { label: 'Mobile Number', value: contact.mobileNo },
                { label: 'Telephone Number', value: contact.telephoneNo },
                { label: 'Fax Number', value: contact.faxNo },
                { label: 'Main Email', value: contact.mainEmail },
                { label: 'Secondary Email', value: contact.secondaryEmail },
                { label: 'Website', value: contact.website }
            ]
        },
        {
            category: 'Physical Address',
            items: [
                { label: 'Building Name', value: address.buildingName },
                { label: 'Building Number', value: address.buldgNo },
                { label: 'Floor Number', value: address.floorNo },
                { label: 'Room Number', value: address.roomNo },
                { label: 'Street/Road', value: address.streetRoad },
                { label: 'City/Town', value: address.cityTown },
                { label: 'County', value: address.county },
                { label: 'Sub-County', value: address.subCounty },
                { label: 'District', value: address.district },
                { label: 'Tax Area Locality', value: address.taxAreaLocality },
                { label: 'LR Number', value: address.lrNo },
                { label: 'Plot Number', value: address.plotNo },
                { label: 'Landmark', value: address.landmark },
                { label: 'Descriptive Address', value: address.descriptiveAddress }
            ]
        },
        {
            category: 'Postal Address',
            items: [
                { label: 'PO Box', value: address.poBox },
                { label: 'Postal Code', value: address.postalCode },
                { label: 'Town', value: address.postalTown }
            ]
        },
        {
            category: 'Authorization Details',
            items: [
                { label: 'Authorization Number', value: authorization.authorizationNo },
                { label: 'Authorization Date', value: authorization.authorizationDate },
                { label: 'Authorization Status', value: authorization.authorizationStatus },
                { label: 'Expiry Date', value: authorization.expiryDate },
                { label: 'Renewal Date', value: authorization.renewalDate }
            ]
        }
    ];

    let html = `
        <div class="extraction-results manufacturer-results">
            <div class="data-section">
                <div class="section-header"><h4>Saved Output</h4></div>
                ${buildResultActionButtons('manufacturer')}
            </div>
            <div class="manufacturer-details-container">
    `;

    detailsSections.forEach(section => {
        html += `
            <div class="data-section manufacturer-section">
                <div class="section-header">
                    <h4>${escapeHtml(section.category)}</h4>
                </div>
                <table class="data-table">
                    <thead>
                        <tr>
                            <th>Field</th>
                            <th>Value</th>
                        </tr>
                    </thead>
                    <tbody>
        `;

        section.items.forEach((item) => {
            const value = item.value || 'N/A';

            html += `
                <tr class="${value === 'N/A' ? 'muted-row' : ''}">
                    <td><strong>${escapeHtml(item.label)}</strong></td>
                    <td>${escapeHtml(value)}</td>
                </tr>
            `;
        });

        html += `
                    </tbody>
                </table>
            </div>
        `;
    });

    html += `
            </div>
            ${buildExportFilesTable('manufacturer')}
        </div>
    `;

    elements.manufacturerInfo.innerHTML = html;

    if (elements.manufacturerDetailsResult) {
        elements.manufacturerDetailsResult.classList.remove('hidden');
    }
}











// Display obligation results
function displayObligationResults(data) {
    if (!elements.obligationResults) return;

    const allObligations = data.obligations || [];
    const activeCount = allObligations.filter(o => o.status && (o.status.toLowerCase().includes('active') || o.status.toLowerCase().includes('registered'))).length;

    let contentHtml = `
        <div class="extraction-results">
            <!-- Header -->
            <div class="results-header">
                <div class="header-content">
                    <h3>${icon('obligation')} Obligation Checker</h3>
                    <div class="header-meta">
                        <span class="company-name">${data.company_name || appState.companyData?.name || 'Company'}</span>
                        <span class="pin-badge">PIN: ${data.kra_pin || appState.companyData?.pin || 'N/A'}</span>
                        <span class="extraction-date">Checked: ${new Date().toLocaleDateString()}</span>
                    </div>
                </div>
            </div>

            <!-- Summary Cards -->
            <div class="summary-cards">
                <div class="summary-card">
                    <div class="card-icon">${icon('pin')}</div>
                    <div class="card-content">
                        <div class="card-label">PIN Status</div>
                        <div class="card-value ${data.pin_status === 'Active' ? 'status-active' : 'status-inactive'}">${data.pin_status || 'Unknown'}</div>
                    </div>
                </div>
                <div class="summary-card">
                    <div class="card-icon">${icon('shield')}</div>
                    <div class="card-content">
                        <div class="card-label">iTax Status</div>
                        <div class="card-value ${data.itax_status === 'Registered' ? 'status-active' : 'status-inactive'}">${data.itax_status || 'Unknown'}</div>
                    </div>
                </div>
                <div class="summary-card">
                    <div class="card-icon">${icon('etims')}</div>
                    <div class="card-content">
                        <div class="card-label">eTIMS Registration</div>
                        <div class="card-value ${data.etims_registration === 'Active' ? 'status-active' : 'status-inactive'}">${data.etims_registration || 'Unknown'}</div>
                    </div>
                </div>
                <div class="summary-card">
                    <div class="card-icon">${icon('chart')}</div>
                    <div class="card-content">
                        <div class="card-label">TIMS Registration</div>
                        <div class="card-value ${data.tims_registration === 'Inactive' ? 'status-inactive' : 'status-active'}">${data.tims_registration || 'Unknown'}</div>
                    </div>
                </div>
                <div class="summary-card">
                    <div class="card-icon">${icon('check')}</div>
                    <div class="card-content">
                        <div class="card-label">VAT Compliance</div>
                        <div class="card-value ${data.vat_compliance === 'Compliant' ? 'status-active' : 'status-error'}">${data.vat_compliance || 'Unknown'}</div>
                    </div>
                </div>
                <div class="summary-card">
                    <div class="card-icon">${icon('list')}</div>
                    <div class="card-content">
                        <div class="card-label">Total Obligations</div>
                        <div class="card-value">${allObligations.length}</div>
                    </div>
                </div>
                <div class="summary-card">
                    <div class="card-icon">${icon('active')}</div>
                    <div class="card-content">
                        <div class="card-label">Active Obligations</div>
                        <div class="card-value">${activeCount}</div>
                    </div>
                </div>
            </div>
    `;

    // Tax Obligations Table
    if (allObligations.length > 0) {
        contentHtml += `
            <div class="data-section">
                <div class="section-header">
                    <h4>Tax Obligations</h4>
                </div>
                ${buildResultActionButtons('obligation')}
                <table class="data-table">
                    <thead>
                        <tr>
                            <th>#</th>
                            <th>Obligation Name</th>
                            <th>Status</th>
                            <th>Effective From</th>
                            <th>Effective To</th>
                        </tr>
                    </thead>
                    <tbody>
        `;

        allObligations.forEach((obligation, index) => {
            const statusClass = obligation.status && (obligation.status.toLowerCase().includes('active') || obligation.status.toLowerCase().includes('registered')) ? 'status-badge status-approved' :
                obligation.status && obligation.status.toLowerCase().includes('inactive') ? 'status-badge status-expired' :
                    'status-badge';

            contentHtml += `
                <tr>
                    <td>${index + 1}</td>
                    <td>${obligation.name || 'N/A'}</td>
                    <td><span class="${statusClass}">${obligation.status || 'N/A'}</span></td>
                    <td>${obligation.effectiveFrom || 'N/A'}</td>
                    <td>${obligation.effectiveTo || 'Active'}</td>
                </tr>
            `;
        });

        contentHtml += `
                    </tbody>
                </table>
            </div>
        `;
    } else {
        contentHtml += `
            <div class="no-data-message">
                <p>No tax obligations found for this company.</p>
            </div>
        `;
    }

    contentHtml += buildExportFilesTable('obligation');
    contentHtml += `</div>`;

    elements.obligationResults.innerHTML = contentHtml;
    elements.obligationResults.classList.remove('hidden');
}

// Display agent check results
function displayAgentCheckResults(data) {
    if (!elements.agentCheckResults) return;

    const vatStatus = data.vat?.isRegistered === true ? 'Registered' :
        data.vat?.isRegistered === false ? 'Not Registered' : 'Unknown';
    const rentStatus = data.rent?.isRegistered === true ? 'Registered' :
        data.rent?.isRegistered === false ? 'Not Registered' : 'Unknown';

    let contentHtml = `
        <div class="extraction-results">
            <!-- Header -->
            <div class="results-header">
                <div class="header-content">
                    <h3>${icon('agent')} Withholding Agent Checker</h3>
                    <div class="header-meta">
                        <span class="company-name">${data.companyName || appState.companyData?.name || 'Company'}</span>
                        <span class="pin-badge">PIN: ${data.pin || appState.companyData?.pin || 'N/A'}</span>
                        <span class="extraction-date">Checked: ${new Date(data.timestamp).toLocaleDateString()}</span>
                    </div>
                </div>
            </div>

            <!-- Summary Cards -->
            <div class="summary-cards">
                <div class="summary-card">
                    <div class="card-icon">${icon('chart')}</div>
                    <div class="card-content">
                        <div class="card-label">VAT Withholding Agent</div>
                        <div class="card-value ${data.vat?.isRegistered === true ? 'status-active' : 'status-inactive'}">${vatStatus}</div>
                    </div>
                </div>
                <div class="summary-card">
                    <div class="card-icon">${icon('home')}</div>
                    <div class="card-content">
                        <div class="card-label">Rent Income Agent</div>
                        <div class="card-value ${data.rent?.isRegistered === true ? 'status-active' : 'status-inactive'}">${rentStatus}</div>
                    </div>
                </div>
                <div class="summary-card">
                    <div class="card-icon">${icon('retry')}</div>
                    <div class="card-content">
                        <div class="card-label">VAT CAPTCHA Retries</div>
                        <div class="card-value">${data.vat?.captchaRetries || 0}</div>
                    </div>
                </div>
                <div class="summary-card">
                    <div class="card-icon">${icon('retry')}</div>
                    <div class="card-content">
                        <div class="card-label">Rent CAPTCHA Retries</div>
                        <div class="card-value">${data.rent?.captchaRetries || 0}</div>
                    </div>
                </div>
            </div>

            <!-- Agent Status Table -->
            <div class="data-section">
                <div class="section-header">
                    <h4>Withholding Agent Status</h4>
                </div>
                ${buildResultActionButtons('agent')}
                <table class="data-table">
                    <thead>
                        <tr>
                            <th>Agent Type</th>
                            <th>Status</th>
                            <th>CAPTCHA Retries</th>
                            <th>Message</th>
                        </tr>
                    </thead>
                    <tbody>
    `;

    // VAT Withholding Agent Row
    if (data.vat) {
        const vatStatusClass = data.vat.isRegistered === true ? 'status-badge status-approved' :
            data.vat.isRegistered === false ? 'status-badge status-expired' : 'status-badge';

        contentHtml += `
            <tr>
                <td><strong>VAT Withholding Agent</strong></td>
                <td><span class="${vatStatusClass}">${vatStatus}</span></td>
                <td>${data.vat.captchaRetries || 0}</td>
                <td>${data.vat.message || (data.vat.error ? `Error: ${data.vat.error}` : '-')}</td>
            </tr>
        `;
    }

    // Rent Income Withholding Agent Row
    if (data.rent) {
        const rentStatusClass = data.rent.isRegistered === true ? 'status-badge status-approved' :
            data.rent.isRegistered === false ? 'status-badge status-expired' : 'status-badge';

        contentHtml += `
            <tr>
                <td><strong>Rent Income Withholding Agent</strong></td>
                <td><span class="${rentStatusClass}">${rentStatus}</span></td>
                <td>${data.rent.captchaRetries || 0}</td>
                <td>${data.rent.message || (data.rent.error ? `Error: ${data.rent.error}` : '-')}</td>
            </tr>
        `;
    }

    contentHtml += `
                    </tbody>
                </table>
            </div>
    `;

    // Additional details if available
    const hasVatDetails = data.vat?.details && Object.keys(data.vat.details).length > 0;
    const hasRentDetails = data.rent?.details && Object.keys(data.rent.details).length > 0;

    if (hasVatDetails || hasRentDetails) {
        contentHtml += `<div class="data-section"><div class="section-header"><h4>Additional Details</h4></div>${buildResultActionButtons('agent')}`;

        if (hasVatDetails) {
            const vatRows = Object.entries(data.vat.details)
                .map(([key, value]) => `
                    <tr>
                        <td>${escapeHtml(key)}</td>
                        <td>${escapeHtml(value || 'N/A')}</td>
                    </tr>
                `)
                .join('');
            contentHtml += `
                <div class="details-subsection">
                    <h5>VAT Agent Details</h5>
                    <table class="data-table">
                        <thead>
                            <tr>
                                <th>Field</th>
                                <th>Value</th>
                            </tr>
                        </thead>
                        <tbody>${vatRows}</tbody>
                    </table>
                </div>`;
        }

        if (hasRentDetails) {
            const rentRows = Object.entries(data.rent.details)
                .map(([key, value]) => `
                    <tr>
                        <td>${escapeHtml(key)}</td>
                        <td>${escapeHtml(value || 'N/A')}</td>
                    </tr>
                `)
                .join('');
            contentHtml += `
                <div class="details-subsection">
                    <h5>Rent Income Agent Details</h5>
                    <table class="data-table">
                        <thead>
                            <tr>
                                <th>Field</th>
                                <th>Value</th>
                            </tr>
                        </thead>
                        <tbody>${rentRows}</tbody>
                    </table>
                </div>`;
        }

        contentHtml += `</div>`;
    }

    contentHtml += buildExportFilesTable('agent');
    contentHtml += `</div>`;

    elements.agentCheckResults.innerHTML = contentHtml;
    elements.agentCheckResults.classList.remove('hidden');
}

// Step 1: Confirm company details
async function confirmCompanyDetails() {
    console.log('Confirm Company Details clicked');

    if (!appState.companyData) {
        await showMessage({
            type: 'error',
            title: 'Error',
            message: 'No company data to confirm. Please fetch company details first.'
        });
        return;
    }

    // Move to next step
    switchTab('password-validation');
}

// Step 2: Run password validation
async function runPasswordValidation() {
    console.log('Run Password Validation clicked');

    if (!hasPin() || !hasPassword()) {
        await showMessage({
            type: 'error',
            title: 'Error',
            message: 'Enter both the KRA PIN and password before running validation.'
        });
        return;
    }

    try {
        appState.isProcessing = true;
        updateUIState();
        showProgressSection('Running password validation...');

        const downloadPath = elements.downloadPath?.value || path.join(os.homedir(), 'Downloads', 'KRA POST PORTUM TOOL');
        const result = await ipcRenderer.invoke('run-password-validation', {
            company: buildCompanyPayload(),
            downloadPath: downloadPath
        });

        if (result.success) {
            const validationResult = result.result || {};
            appState.validationStatus = validationResult.status || 'Unknown';
            appState.hasValidation = validationResult.status === 'Valid';
            normalizeExportFiles('validation', result);
            updateValidationDisplay({ status: appState.validationStatus });
            hideProgressSection();

            await showMessage({
                type: validationResult.status === 'Valid' ? 'info' : 'warning',
                title: 'Validation Complete',
                message: `Password validation completed. Status: ${validationResult.status || 'Unknown'}`
            });
        } else {
            throw new Error(result.error || 'Password validation failed');
        }
    } catch (error) {
        console.error('Error running password validation:', error);
        await showMessage({
            type: 'error',
            title: 'Validation Error',
            message: `Failed to run password validation: ${error.message}`
        });
        hideProgressSection();
    } finally {
        appState.isProcessing = false;
        updateUIState();
    }
}

// Step 3: Fetch manufacturer details
async function fetchManufacturerDetails() {
    console.log('Fetch Manufacturer Details clicked');

    if (!hasPin()) {
        await showMessage({
            type: 'error',
            title: 'Error',
            message: 'Enter a KRA PIN before fetching manufacturer details.'
        });
        return;
    }

    try {
        appState.isProcessing = true;
        updateUIState();
        showProgressSection('Fetching manufacturer details...');

        const result = await ipcRenderer.invoke('fetch-manufacturer-details', {
            company: buildCompanyPayload()
        });

        if (result.success && result.data) {
            appState.manufacturerData = result.data;
            if (!appState.companyData) {
                appState.companyData = buildCompanyPayload();
            }
            appState.companyData.name = result.data.timsManBasicRDtlDTO?.manufacturerName || appState.companyData.name || 'Unknown Company';
            displayManufacturerDetails(result.data);
            const downloadPath = elements.downloadPath?.value || path.join(os.homedir(), 'Downloads', 'KRA POST PORTUM TOOL');
            const exportResult = await ipcRenderer.invoke('export-manufacturer-details', {
                company: appState.companyData,
                data: result.data,
                downloadPath: downloadPath
            });
            if (exportResult.success) {
                normalizeExportFiles('manufacturer', exportResult);
                displayManufacturerDetails(result.data);
            }
            refreshFullProfile();
            hideProgressSection();

            await showMessage({
                type: 'info',
                title: 'Success',
                message: 'Manufacturer details fetched successfully!'
            });
        } else {
            throw new Error(result.error || 'Failed to fetch manufacturer details');
        }
    } catch (error) {
        console.error('Error fetching manufacturer details:', error);
        await showMessage({
            type: 'error',
            title: 'Error',
            message: `Failed to fetch manufacturer details: ${error.message}`
        });
        hideProgressSection();
    } finally {
        appState.isProcessing = false;
        updateUIState();
    }
}

// Step 3: Export manufacturer details
async function exportManufacturerDetails() {
    console.log('Export Manufacturer Details clicked');

    if (!appState.manufacturerData) {
        await showMessage({
            type: 'error',
            title: 'Error',
            message: 'No manufacturer data to export. Please fetch details first.'
        });
        return;
    }

    try {
        appState.isProcessing = true;
        updateUIState();
        showProgressSection('Exporting manufacturer details...');

        const downloadPath = elements.downloadPath?.value || path.join(os.homedir(), 'Downloads', 'KRA POST PORTUM TOOL');

        const result = await ipcRenderer.invoke('export-manufacturer-details', {
            company: appState.companyData,
            data: appState.manufacturerData,
            downloadPath: downloadPath
        });

        if (result.success) {
            normalizeExportFiles('manufacturer', result);
            displayManufacturerDetails(appState.manufacturerData);
            hideProgressSection();
            await showMessage({
                type: 'info',
                title: 'Export Complete',
                message: `Manufacturer details exported successfully to: ${result.filePath}`
            });
        } else {
            throw new Error(result.error || 'Export failed');
        }
    } catch (error) {
        console.error('Error exporting manufacturer details:', error);
        await showMessage({
            type: 'error',
            title: 'Export Error',
            message: `Failed to export manufacturer details: ${error.message}`
        });
        hideProgressSection();
    } finally {
        appState.isProcessing = false;
        updateUIState();
    }
}

// Step 4: Run obligation check
// Step 4: Run Director Details Extraction
async function runDirectorDetailsExtraction() {
    console.log('Run Director Details Extraction clicked');
    if (!hasPin() || !hasPassword()) {
        await showMessage({
            type: 'error',
            title: 'Prerequisites Not Met',
            message: 'Enter both the KRA PIN and password before extracting director details.'
        });
        return;
    }

    try {
        appState.isProcessing = true;
        updateUIState();
        showProgressSection('Extracting Director Details...');

        const result = await ipcRenderer.invoke('run-director-details-extraction', {
            company: buildCompanyPayload(),
            downloadPath: elements.downloadPath.value
        });

        if (result.success) {
            appState.directorDetails = result.data;
            normalizeExportFiles('director', result);
            displayDirectorDetails(result.data);
            refreshFullProfile();
            hideProgressSection();
            await showMessage({
                type: 'info',
                title: 'Success',
                message: 'Director details extracted successfully!'
            });
        } else {
            throw new Error(result.error || 'Failed to extract director details');
        }
    } catch (error) {
        console.error('Error extracting director details:', error);
        await showMessage({
            type: 'error',
            title: 'Error',
            message: `Failed to extract director details: ${error.message}`
        });
        hideProgressSection();
    } finally {
        appState.isProcessing = false;
        updateUIState();
    }
}

function displayDirectorDetails(data) {
    if (!elements.directorDetailsResults) return;

    let contentHtml = `
        <div class="extraction-results">
            <!-- Header -->
            <div class="results-header">
                <div class="header-content">
                    <h3>${icon('users')} Director and Associate Details</h3>
                    <div class="header-meta">
                        <span class="company-name">${appState.companyData?.name || 'Company'}</span>
                        <span class="pin-badge">PIN: ${appState.companyData?.pin || 'N/A'}</span>
                        <span class="extraction-date">Extracted: ${new Date().toLocaleDateString()}</span>
                    </div>
                </div>
            </div>

            <!-- Summary Cards -->
            <div class="summary-cards">
                <div class="summary-card">
                    <div class="card-icon">${icon('calendar')}</div>
                    <div class="card-content">
                        <div class="card-label">Accounting Period</div>
                        <div class="card-value">${data.accountingPeriod || 'N/A'}</div>
                    </div>
                </div>
                <div class="summary-card">
                    <div class="card-icon">${icon('chart')}</div>
                    <div class="card-content">
                        <div class="card-label">Economic Activities</div>
                        <div class="card-value">${data.activities?.length || 0}</div>
                    </div>
                </div>
                <div class="summary-card">
                    <div class="card-icon">${icon('user')}</div>
                    <div class="card-content">
                        <div class="card-label">Directors & Associates</div>
                        <div class="card-value">${data.directors?.length || 0}</div>
                    </div>
                </div>
            </div>
            <div class="data-section">
                <div class="section-header"><h4>Saved Output</h4></div>
                ${buildResultActionButtons('director')}
            </div>
    `;

    // Economic Activities Section
    if (data.activities && data.activities.length > 0) {
        contentHtml += `
            <div class="data-section">
                <div class="section-header">
                    <h4>Economic Activities</h4>
                </div>
                ${buildResultActionButtons('director')}
                <table class="data-table">
                    <thead>
                        <tr>
                            <th>#</th>
                            <th>Section</th>
                            <th>Type</th>
                        </tr>
                    </thead>
                    <tbody>
        `;
        data.activities.forEach((act, index) => {
            contentHtml += `
                <tr>
                    <td>${index + 1}</td>
                    <td>${act.section || 'N/A'}</td>
                    <td>${act.type || 'N/A'}</td>
                </tr>
            `;
        });
        contentHtml += `
                    </tbody>
                </table>
            </div>
        `;
    }

    // Directors Section
    if (data.directors && data.directors.length > 0) {
        contentHtml += `
            <div class="data-section">
                <div class="section-header">
                    <h4>Directors and Associates</h4>
                </div>
                <table class="data-table">
                    <thead>
                        <tr>
                            <th>#</th>
                            <th>Nature</th>
                            <th>PIN</th>
                            <th>Name</th>
                            <th>Email</th>
                            <th>Mobile</th>
                            <th>Profit/Loss Ratio</th>
                        </tr>
                    </thead>
                    <tbody>
        `;
        data.directors.forEach((dir, index) => {
            contentHtml += `
                <tr>
                    <td>${index + 1}</td>
                    <td>${dir.nature || 'N/A'}</td>
                    <td>${dir.pin || 'N/A'}</td>
                    <td>${dir.name || 'N/A'}</td>
                    <td>${dir.email || 'N/A'}</td>
                    <td>${dir.mobile || 'N/A'}</td>
                    <td>${dir.ratio || 'N/A'}</td>
                </tr>
            `;
        });
        contentHtml += `
                    </tbody>
                </table>
            </div>
        `;
    }

    contentHtml += buildExportFilesTable('director');
    contentHtml += `</div>`;

    elements.directorDetailsResults.innerHTML = contentHtml;
    elements.directorDetailsResults.classList.remove('hidden');
}

// Step 5: Run obligation check
async function runObligationCheck() {
    console.log('Run Obligation Check clicked');

    const pin = elements.kraPin?.value?.trim();

    if (!pin) {
        await showMessage({
            type: 'error',
            title: 'Missing PIN',
            message: 'Enter the KRA PIN before running the obligation check.'
        });
        return;
    }

    // Use company data if available, otherwise use form inputs
    const companyName = appState.companyData?.name || 'Unknown Company';

    try {
        appState.isProcessing = true;
        updateUIState();
        showProgressSection('Running obligation check...');

        const downloadPath = elements.downloadPath?.value || path.join(os.homedir(), 'Downloads', 'KRA POST PORTUM TOOL');

        const result = await ipcRenderer.invoke('run-obligation-check', {
            company: {
                pin: pin,
                name: companyName,
                browserSettings: getBrowserSettings()
            },
            downloadPath: downloadPath
        });

        if (result.success) {
            appState.obligationData = result.data;
            normalizeExportFiles('obligation', result);
            displayObligationResults(result.data);
            refreshFullProfile();
            hideProgressSection();

            await showMessage({
                type: 'info',
                title: 'Obligation Check Complete',
                message: 'Obligation check completed successfully!'
            });
        } else {
            throw new Error(result.error || 'Obligation check failed');
        }
    } catch (error) {
        console.error('Error running obligation check:', error);
        await showMessage({
            type: 'error',
            title: 'Obligation Check Error',
            message: `Failed to run obligation check: ${error.message}`
        });
        hideProgressSection();
    } finally {
        appState.isProcessing = false;
        updateUIState();
    }
}

// Step 6: Run agent check
async function runAgentCheck() {
    console.log('Run Agent Check clicked');

    // Check if we have company data
    const pin = elements.kraPin?.value?.trim();

    if (!pin) {
        await showMessage({
            type: 'error',
            title: 'Missing PIN',
            message: 'Please enter KRA PIN before running agent check.'
        });
        return;
    }

    // Use company data if available
    const companyName = appState.companyData?.name || 'Unknown Company';

    try {
        appState.isProcessing = true;
        updateUIState();
        showProgressSection('Checking withholding agent status...');

        const downloadPath = elements.downloadPath?.value || path.join(os.homedir(), 'Downloads', 'KRA POST PORTUM TOOL');

        const result = await ipcRenderer.invoke('run-agent-check', {
            company: {
                pin: pin,
                name: companyName,
                browserSettings: getBrowserSettings()
            },
            downloadPath: downloadPath
        });

        if (result.success) {
            appState.agentData = result.data;
            normalizeExportFiles('agent', result);
            displayAgentCheckResults(result.data);
            refreshFullProfile();
            hideProgressSection();

            await showMessage({
                type: 'info',
                title: 'Agent Check Complete',
                message: 'Withholding agent check completed successfully!'
            });
        } else {
            throw new Error(result.error || 'Agent check failed');
        }
    } catch (error) {
        console.error('Error running agent check:', error);
        await showMessage({
            type: 'error',
            title: 'Agent Check Error',
            message: `Failed to run agent check: ${error.message}`
        });
        hideProgressSection();
    } finally {
        appState.isProcessing = false;
        updateUIState();
    }
}

// Step 7: Run liabilities extraction
async function runLiabilitiesExtraction() {
    console.log('Run Liabilities Extraction clicked');

    if (!hasPin() || !hasPassword()) {
        await showMessage({
            type: 'error',
            title: 'Error',
            message: 'Enter both the KRA PIN and password before running liabilities extraction.'
        });
        return;
    }

    try {
        appState.isProcessing = true;
        updateUIState();
        showProgressSection('Extracting liabilities...');

        const downloadPath = elements.downloadPath?.value || path.join(os.homedir(), 'Downloads', 'KRA POST PORTUM TOOL');

        const result = await ipcRenderer.invoke('run-liabilities-extraction', {
            company: buildCompanyPayload(),
            downloadPath: downloadPath
        });

        if (result.success) {
            appState.liabilitiesData = {
                completed: true,
                data: result.data || [],
                totalAmount: result.totalAmount || 0,
                recordCount: result.recordCount || (result.data?.length || 0),
                downloadPath: result.downloadPath || '',
                files: result.files || []
            };
            normalizeExportFiles('liabilities', result);
            displayLiabilitiesResults(result);
            refreshFullProfile();
            hideProgressSection();
            await showMessage({
                type: 'info',
                title: 'Liabilities Extraction Complete',
                message: `Liabilities extracted successfully! Files saved to: ${result.downloadPath}`
            });
        } else {
            throw new Error(result.error || 'Liabilities extraction failed');
        }
    } catch (error) {
        console.error('Error running liabilities extraction:', error);
        await showMessage({
            type: 'error',
            title: 'Liabilities Extraction Error',
            message: `Failed to extract liabilities: ${error.message}`
        });
        hideProgressSection();
    } finally {
        appState.isProcessing = false;
        updateUIState();
    }
}

// Step 6: Run VAT extraction
async function runVATExtraction() {
    console.log('Run VAT Extraction clicked');

    if (!hasPin() || !hasPassword()) {
        await showMessage({
            type: 'error',
            title: 'Error',
            message: 'Enter both the KRA PIN and password before running VAT extraction.'
        });
        return;
    }

    try {
        appState.isProcessing = true;
        updateUIState();

        // Clear previous results
        if (elements.vatResults) {
            elements.vatResults.classList.add('hidden');
            elements.vatResults.innerHTML = '';
        }

        showProgressSection('Extracting VAT returns...');

        const downloadPath = elements.downloadPath?.value || path.join(os.homedir(), 'Downloads', 'KRA POST PORTUM TOOL');
        const dateRange = getVATDateRange(); // Get date range from form

        const result = await ipcRenderer.invoke('run-vat-extraction', {
            company: buildCompanyPayload(),
            dateRange: dateRange,
            downloadPath: downloadPath
        });

        if (result.success) {
            appState.vatData = {
                completed: true,
                rows: result.data || [],
                totalReturns: result.totalReturns || 0,
                downloadPath: result.downloadPath || '',
                files: result.files || [],
                extractionSummary: result.extractionSummary || {}
            };
            normalizeExportFiles('vat', result);
            refreshFullProfile();
            hideProgressSection();

            displayVATResults(result);

            // Also show popup message
            await showMessage({
                type: 'info',
                title: 'VAT Extraction Complete',
                message: `VAT returns extracted successfully! Files saved to: ${result.downloadPath}`
            });
        } else {
            throw new Error(result.error || 'VAT extraction failed');
        }
    } catch (error) {
        console.error('Error running VAT extraction:', error);

        if (elements.vatResults) {
            elements.vatResults.innerHTML = `<div class="no-data-message"><p>VAT extraction failed: ${escapeHtml(error.message)}</p></div>`;
            elements.vatResults.classList.remove('hidden');
        }

        await showMessage({
            type: 'error',
            title: 'VAT Extraction Error',
            message: `Failed to extract VAT returns: ${error.message}`
        });
        hideProgressSection();
    } finally {
        appState.isProcessing = false;
        updateUIState();
    }
}

// WH VAT: Toggle custom date inputs
function toggleWhVATDateInputs() {
    const selectedRange = document.querySelector('input[name="whVatDateRange"]:checked')?.value;
    if (elements.whVatCustomDateInputs) {
        if (selectedRange === 'custom') {
            elements.whVatCustomDateInputs.classList.remove('hidden');
        } else {
            elements.whVatCustomDateInputs.classList.add('hidden');
        }
    }
}

// Run All: Select/Deselect All Automations
function toggleAllAutomations() {
    const isChecked = elements.selectAllAutomations?.checked || false;
    const checkboxes = document.querySelectorAll('.automation-checkbox');
    checkboxes.forEach(checkbox => {
        checkbox.checked = isChecked;
    });
    updateUIState();
}

// Run All: Toggle VAT custom date range inputs
function toggleVATRangeInputs() {
    const rangeType = elements.runAllVatRangeType?.value;
    if (elements.runAllVatCustomRange) {
        if (rangeType === 'custom') {
            elements.runAllVatCustomRange.classList.remove('hidden');
        } else {
            elements.runAllVatCustomRange.classList.add('hidden');
        }
    }
}

function displayVATResults(result) {
    if (!elements.vatResults) return;

    const rows = result.data || [];
    const summary = result.extractionSummary || {};
    const sections = summary.sectionsExtracted || [];

    elements.vatResults.innerHTML = `
        <div class="extraction-results">
            <div class="results-header">
                <div class="header-content">
                    <h3><i class="fa-solid fa-receipt"></i> VAT Returns</h3>
                    <div class="header-meta">
                        <span class="company-name">${escapeHtml(appState.companyData?.name || result.companyData?.companyName || 'Company')}</span>
                        <span class="pin-badge">PIN: ${escapeHtml(appState.companyData?.pin || result.companyData?.kraPin || 'N/A')}</span>
                        <span class="extraction-date">Extracted: ${new Date().toLocaleDateString()}</span>
                    </div>
                </div>
            </div>
            <div class="summary-cards">
                <div class="summary-card"><div class="card-icon"><i class="fa-solid fa-table-list"></i></div><div class="card-content"><div class="card-label">Returns Processed</div><div class="card-value">${rows.length}</div></div></div>
                <div class="summary-card"><div class="card-icon"><i class="fa-solid fa-layer-group"></i></div><div class="card-content"><div class="card-label">Sections Extracted</div><div class="card-value">${sections.length}</div></div></div>
                <div class="summary-card"><div class="card-icon"><i class="fa-solid fa-file-excel"></i></div><div class="card-content"><div class="card-label">Export</div><div class="card-value status-active">Excel saved</div></div></div>
            </div>
            <div class="data-section">
                <div class="section-header"><h4>Extraction Summary</h4></div>
                ${buildResultActionButtons('vat')}
                <table class="data-table">
                    <tbody>
                        <tr><td><strong>Date Range</strong></td><td>${escapeHtml(summary.dateRange?.type === 'custom' ? `${summary.dateRange.startMonth}/${summary.dateRange.startYear} to ${summary.dateRange.endMonth}/${summary.dateRange.endYear}` : 'All data')}</td></tr>
                        <tr><td><strong>Total Returns</strong></td><td>${escapeHtml(summary.totalReturns || rows.length)}</td></tr>
                        <tr><td><strong>Output Folder</strong></td><td>${escapeHtml(result.downloadPath || '')}</td></tr>
                    </tbody>
                </table>
            </div>
            ${sections.length ? `
                <div class="data-section">
                    <div class="section-header"><h4>Extracted Sections</h4></div>
                    <table class="data-table">
                        <thead><tr><th>#</th><th>Section</th></tr></thead>
                        <tbody>${sections.map((section, index) => `<tr><td>${index + 1}</td><td>${escapeHtml(section)}</td></tr>`).join('')}</tbody>
                    </table>
                </div>
            ` : ''}
            <div class="data-section">
                <div class="section-header"><h4>Processed Returns</h4></div>
                <table class="data-table">
                    <thead><tr><th>#</th><th>Period</th><th>Month</th><th>Year</th><th>Status</th></tr></thead>
                    <tbody>
                        ${rows.length ? rows.map((row, index) => `
                            <tr>
                                <td>${index + 1}</td>
                                <td>${escapeHtml(row.period || 'N/A')}</td>
                                <td>${escapeHtml(row.month || 'N/A')}</td>
                                <td>${escapeHtml(row.year || 'N/A')}</td>
                                <td>${escapeHtml(row.status || 'Processed')}</td>
                            </tr>
                        `).join('') : '<tr><td colspan="5">No VAT returns were found for the selected range.</td></tr>'}
                    </tbody>
                </table>
            </div>
            ${buildExportFilesTable('vat')}
        </div>
    `;
    elements.vatResults.classList.remove('hidden');
}

// Run All: Toggle WH VAT custom date range inputs
function toggleWhVATRangeInputs() {
    const rangeType = elements.runAllWhVatRangeType?.value;
    if (elements.runAllWhVatCustomRange) {
        if (rangeType === 'custom') {
            elements.runAllWhVatCustomRange.classList.remove('hidden');
        } else {
            elements.runAllWhVatCustomRange.classList.add('hidden');
        }
    }
}

// Run All: Get individual VAT date range
function getIndividualVATDateRange() {
    const rangeType = elements.runAllVatRangeType?.value;

    if (rangeType === 'custom') {
        const startYear = parseInt(elements.runAllVatStartYear?.value) || new Date().getFullYear();
        const startMonth = parseInt(elements.runAllVatStartMonth?.value) || 1;
        const endYear = parseInt(elements.runAllVatEndYear?.value) || new Date().getFullYear();
        const endMonth = parseInt(elements.runAllVatEndMonth?.value) || 12;

        return {
            type: 'custom',
            startYear: startYear,
            startMonth: startMonth,
            endYear: endYear,
            endMonth: endMonth
        };
    } else {
        return { type: 'all' };
    }
}

// Run All: Get individual WH VAT date range
function getIndividualWhVATDateRange() {
    const rangeType = elements.runAllWhVatRangeType?.value;

    if (rangeType === 'custom') {
        const startYear = parseInt(elements.runAllWhVatStartYear?.value) || new Date().getFullYear();
        const startMonth = parseInt(elements.runAllWhVatStartMonth?.value) || 1;
        const endYear = parseInt(elements.runAllWhVatEndYear?.value) || new Date().getFullYear();
        const endMonth = parseInt(elements.runAllWhVatEndMonth?.value) || 12;

        return {
            type: 'custom',
            startYear: startYear,
            startMonth: startMonth,
            endYear: endYear,
            endMonth: endMonth
        };
    } else {
        return { type: 'all' };
    }
}

// WH VAT: Get date range from form
function getWhVATDateRange() {
    const selectedRange = document.querySelector('input[name="whVatDateRange"]:checked')?.value;

    console.log('WH VAT Date Range Selection:', selectedRange);

    if (selectedRange === 'all') {
        console.log('WH VAT: Extracting all available data');
        return 'all';
    }

    // Custom range
    const startMonth = parseInt(elements.whVatStartMonth?.value || 1);
    const startYear = parseInt(elements.whVatStartYear?.value || new Date().getFullYear());
    const endMonth = parseInt(elements.whVatEndMonth?.value || 12);
    const endYear = parseInt(elements.whVatEndYear?.value || new Date().getFullYear());

    console.log(`WH VAT Custom Range: ${startMonth}/${startYear} to ${endMonth}/${endYear}`);

    // Validate date range
    if (startYear > endYear || (startYear === endYear && startMonth > endMonth)) {
        console.warn('Invalid date range: Start date is after end date');
        showToast({
            type: 'warning',
            title: 'Invalid Date Range',
            message: 'Start date must be before or equal to end date'
        });
    }

    return {
        startMonth: startMonth,
        startYear: startYear,
        endMonth: endMonth,
        endYear: endYear
    };
}

// WH VAT: Run extraction
async function runWhVATExtraction() {
    console.log('Run WH VAT Extraction clicked');

    if (!hasPin() || !hasPassword()) {
        await showMessage({
            type: 'error',
            title: 'Error',
            message: 'Enter both the KRA PIN and password before running WH VAT extraction.'
        });
        return;
    }

    try {
        appState.isProcessing = true;
        updateUIState();

        // Clear previous results
        if (elements.whVatResults) {
            elements.whVatResults.classList.add('hidden');
            elements.whVatResults.innerHTML = '';
        }

        showProgressSection('Extracting Withholding VAT returns...');

        const downloadPath = elements.downloadPath?.value || path.join(os.homedir(), 'Downloads', 'KRA POST PORTUM TOOL');
        const dateRange = getWhVATDateRange();

        const result = await ipcRenderer.invoke('run-wh-vat-extraction', {
            company: buildCompanyPayload(),
            dateRange: dateRange,
            downloadPath: downloadPath
        });

        if (result.success) {
            appState.whVatData = {
                completed: true,
                rows: result.data || [],
                totalReturns: result.data?.length || 0,
                downloadPath: result.downloadPath || '',
                files: result.files || []
            };
            normalizeExportFiles('whVat', result);
            refreshFullProfile();
            hideProgressSection();

            displayWhVATResults(result);

            await showMessage({
                type: 'info',
                title: 'WH VAT Extraction Complete',
                message: `Withholding VAT returns extracted successfully! Files saved to: ${result.downloadPath}`
            });
        } else {
            throw new Error(result.error || 'WH VAT extraction failed');
        }
    } catch (error) {
        console.error('Error running WH VAT extraction:', error);

        if (elements.whVatResults) {
            elements.whVatResults.innerHTML = `<div class="no-data-message"><p>WH VAT extraction failed: ${escapeHtml(error.message)}</p></div>`;
            elements.whVatResults.classList.remove('hidden');
        }

        await showMessage({
            type: 'error',
            title: 'WH VAT Extraction Error',
            message: `Failed to extract WH VAT returns: ${error.message}`
        });
        hideProgressSection();
    } finally {
        appState.isProcessing = false;
        updateUIState();
    }
}

// Step 7: Run ledger extraction
async function runLedgerExtraction() {
    console.log('Run Ledger Extraction clicked');

    if (!hasPin() || !hasPassword()) {
        await showMessage({
            type: 'error',
            title: 'Error',
            message: 'Enter both the KRA PIN and password before running ledger extraction.'
        });
        return;
    }

    try {
        appState.isProcessing = true;
        updateUIState();
        showProgressSection('Extracting general ledger...');

        const downloadPath = elements.downloadPath?.value || path.join(os.homedir(), 'Downloads', 'KRA POST PORTUM TOOL');

        const result = await ipcRenderer.invoke('run-ledger-extraction', {
            company: buildCompanyPayload(),
            downloadPath: downloadPath
        });

        if (result.success) {
            appState.ledgerData = {
                completed: true,
                rows: result.data || [],
                recordCount: result.recordCount || (result.data?.length || 0),
                downloadPath: result.downloadPath || '',
                files: result.files || []
            };
            normalizeExportFiles('ledger', result);
            displayLedgerResults(result);
            refreshFullProfile();
            hideProgressSection();
            await showMessage({
                type: 'info',
                title: 'Ledger Extraction Complete',
                message: `General ledger extracted successfully! Files saved to: ${result.downloadPath}`
            });
        } else {
            throw new Error(result.error || 'Ledger extraction failed');
        }
    } catch (error) {
        console.error('Error running ledger extraction:', error);
        await showMessage({
            type: 'error',
            title: 'Ledger Extraction Error',
            message: `Failed to extract general ledger: ${error.message}`
        });
        hideProgressSection();
    } finally {
        appState.isProcessing = false;
        updateUIState();
    }
}

// Step 8: Run all automations
async function runTCCDownloader() {
    console.log('Run TCC Downloader clicked');
    if (!hasPin() || !hasPassword()) {
        await showMessage({
            type: 'error',
            title: 'Prerequisites Not Met',
            message: 'Enter both the KRA PIN and password before downloading the TCC.'
        });
        return;
    }

    try {
        appState.isProcessing = true;
        updateUIState();
        showProgressSection('Downloading Tax Compliance Certificate...');

        const result = await ipcRenderer.invoke('run-tcc-downloader', {
            company: buildCompanyPayload(),
            downloadPath: elements.downloadPath.value
        });

        if (result.success) {
            appState.tccData = result;
            normalizeExportFiles('tcc', result);
            displayTCCResults(result);
            refreshFullProfile();
            hideProgressSection();
            await showMessage({
                type: 'info',
                title: 'Success',
                message: `TCC downloaded successfully! File saved at: ${result.files[0]}`
            });
        } else {
            throw new Error(result.error || 'Failed to download TCC');
        }
    } catch (error) {
        console.error('Error downloading TCC:', error);
        await showMessage({
            type: 'error',
            title: 'Error',
            message: `Failed to download TCC: ${error.message}`
        });
        hideProgressSection();
    } finally {
        appState.isProcessing = false;
        updateUIState();
    }
}

function displayTCCResults(data) {
    if (!elements.tccResults) return;

    const validCount = data.tableData ? data.tableData.filter(row => String(row.status || '').toLowerCase() === 'approved').length : 0;
    const expiredCount = data.tableData ? data.tableData.filter(row => String(row.status || '').toLowerCase() === 'expired').length : 0;
    const primaryFile = data.files?.[0] || appState.exports.tcc?.primaryFile || '';
    const escapedPath = primaryFile.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

    let contentHtml = `
        <div class="extraction-results">
            <!-- Header -->
            <div class="results-header">
                <div class="header-content">
                    <h3>${icon('certificate')} Tax Compliance Certificate</h3>
                    <div class="header-meta">
                        <span class="company-name">${escapeHtml(appState.companyData?.name || 'Company')}</span>
                        <span class="pin-badge">PIN: ${escapeHtml(appState.companyData?.pin || 'N/A')}</span>
                        <span class="extraction-date">Downloaded: ${new Date().toLocaleDateString()}</span>
                    </div>
                </div>
            </div>

            <!-- Summary Cards -->
            <div class="summary-cards">
                <div class="summary-card">
                    <div class="card-icon">${icon('file')}</div>
                    <div class="card-content">
                        <div class="card-label">Total Certificates</div>
                        <div class="card-value">${data.tableData?.length || 0}</div>
                    </div>
                </div>
                <div class="summary-card">
                    <div class="card-icon">${icon('check')}</div>
                    <div class="card-content">
                        <div class="card-label">Valid</div>
                        <div class="card-value status-active">${validCount}</div>
                    </div>
                </div>
                <div class="summary-card">
                    <div class="card-icon">${icon('clock')}</div>
                    <div class="card-content">
                        <div class="card-label">Expired</div>
                        <div class="card-value status-error">${expiredCount}</div>
                    </div>
                </div>
                <div class="summary-card">
                    <div class="card-icon">${icon('save')}</div>
                    <div class="card-content">
                        <div class="card-label">Status</div>
                        <div class="card-value status-active">Downloaded</div>
                    </div>
                </div>
            </div>
    `;

    // File info section
    if (primaryFile) {
        contentHtml += `
            <div class="data-section">
                <div class="section-header">
                    <h4>Downloaded File</h4>
                </div>
                ${buildResultActionButtons('tcc')}
                <table class="data-table">
                    <tbody>
                        <tr>
                            <td><strong>File Name</strong></td>
                            <td>${escapeHtml(path.basename(primaryFile))}</td>
                        </tr>
                        <tr>
                            <td><strong>Folder</strong></td>
                            <td data-wrap="true">${escapeHtml(path.dirname(primaryFile))}</td>
                        </tr>
                        <tr>
                            <td><strong>Actions</strong></td>
                            <td>
                                <div class="button-group result-actions compact-actions">
                                    <button class="btn btn-primary btn-sm" onclick="window.viewTCCPDF('${escapedPath}')">
                                        <span class="btn-icon">${icon('eye')}</span> View in App
                                    </button>
                                    <button class="btn btn-secondary btn-sm" onclick="window.openPDFExternal('${escapedPath}')">
                                        <span class="btn-icon">${icon('link')}</span> Open Externally
                                    </button>
                                </div>
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>`;
    }

    // Display TCC History Table
    if (data.tableData && data.tableData.length > 0) {
        contentHtml += `
            <div class="data-section">
                <div class="section-header">
                    <h4>Certificate History (${data.tableData.length} certificates)</h4>
                </div>
                <table class="data-table">
                    <thead>
                        <tr>
                            <th>Sr.No.</th>
                            <th>PIN</th>
                            <th>TaxPayer/Company Name</th>
                            <th>Status</th>
                            <th>Certificate Date</th>
                            <th>Expiry Date</th>
                            <th>Serial No</th>
                        </tr>
                    </thead>
                    <tbody>`;

        data.tableData.forEach(row => {
            const normalizedStatus = String(row.status || '').toLowerCase();
            const isApproved = normalizedStatus === 'approved';
            const isExpired = normalizedStatus === 'expired';
            const statusClass = isApproved ? 'status-badge status-approved' :
                isExpired ? 'status-badge status-expired' : 'status-badge';
            const statusText = isApproved ? 'Valid' : (row.status || 'Unknown');

            contentHtml += `
                        <tr>
                            <td>${row.srNo}</td>
                            <td>${row.pin}</td>
                            <td>${row.companyName}</td>
                            <td><span class="${statusClass}">${statusText}</span></td>
                            <td>${row.certificateDate}</td>
                            <td>${row.expiryDate}</td>
                            <td>${row.serialNo}</td>
                        </tr>`;
        });

        contentHtml += `
                    </tbody>
                </table>
            </div>`;
    }

    contentHtml += `${buildExportFilesTable('tcc')}</div>`;

    // Add PDF viewer modal (outside the extraction-results div)
    contentHtml += `
        <div id="tccPdfViewer" class="pdf-modal-overlay hidden" onclick="closeTCCPDFViewer()">
            <div class="pdf-modal-content" onclick="event.stopPropagation()">
                <div class="pdf-modal-header">
                    <h5>${icon('file')} Tax Compliance Certificate</h5>
                    <button class="btn btn-secondary" onclick="closeTCCPDFViewer()">Close</button>
                </div>
                <iframe id="tccPdfFrame" class="pdf-iframe" frameborder="0"></iframe>
            </div>
        </div>`;

    elements.tccResults.innerHTML = contentHtml;
    elements.tccResults.classList.remove('hidden');
}

// Expose globally for inline onclick handlers
window.viewTCCPDF = function (filePath) {
    try {
        console.log('Opening PDF in app viewer:', filePath);
        const pdfViewer = document.getElementById('tccPdfViewer');
        const pdfFrame = document.getElementById('tccPdfFrame');

        if (pdfViewer && pdfFrame) {
            // Convert Windows path to file:// URL
            const fileUrl = `file:///${filePath.replace(/\\/g, '/')}`;
            console.log('Loading PDF from URL:', fileUrl);

            pdfFrame.src = fileUrl;
            pdfViewer.classList.remove('hidden');
        } else {
            console.error('PDF viewer elements not found');
        }
    } catch (error) {
        console.error('Error opening PDF:', error);
        showToast({
            type: 'error',
            title: 'Cannot Open PDF',
            message: `Failed to open PDF file: ${error.message}`
        });
    }
};

window.closeTCCPDFViewer = function () {
    const pdfViewer = document.getElementById('tccPdfViewer');
    const pdfFrame = document.getElementById('tccPdfFrame');

    if (pdfViewer && pdfFrame) {
        pdfFrame.src = '';
        pdfViewer.classList.add('hidden');
    }
};

window.openFile = async function (filePath) {
    try {
        console.log('Opening file:', filePath);
        const result = await ipcRenderer.invoke('open-file-external', filePath);

        if (!result.success) {
            throw new Error(result.error || 'Failed to open file');
        }

        console.log('File opened successfully');
    } catch (error) {
        console.error('Error opening file:', error);
        await showMessage({
            type: 'error',
            title: 'Cannot Open File',
            message: `Failed to open file: ${error.message}\n\nFile: ${filePath}`
        });
    }
};

window.openPDFExternal = async function (filePath) {
    try {
        console.log('Opening PDF externally:', filePath);
        const result = await ipcRenderer.invoke('open-file-external', filePath);

        if (!result.success) {
            throw new Error(result.error || 'Failed to open PDF file');
        }

        console.log('PDF opened externally');
    } catch (error) {
        console.error('Error opening PDF externally:', error);
        await showMessage({
            type: 'error',
            title: 'Cannot Open PDF',
            message: `Failed to open PDF file: ${error.message}\n\nFile: ${filePath}`
        });
    }
};

window.openFolder = async function (folderPath) {
    if (folderPath) {
        await ipcRenderer.invoke('open-folder', folderPath);
    }
};

async function runAllAutomations() {
    console.log('Run All Automations clicked');

    const selectedAutomations = getSelectedAutomations();

    const hasSelected = Object.values(selectedAutomations).some(selected => selected);
    if (!hasSelected) {
        await showMessage({
            type: 'warning',
            title: 'No Automations Selected',
            message: 'Please select at least one automation to run.'
        });
        return;
    }

    if (!hasPin()) {
        await showMessage({
            type: 'warning',
            title: 'Missing KRA PIN',
            message: 'Enter the KRA PIN before running automations.'
        });
        return;
    }

    if (!hasPassword()) {
        const selectedKeys = Object.entries(selectedAutomations)
            .filter(([, enabled]) => enabled)
            .map(([key]) => key);
        const hasRunnablePinOnlySelection = selectedKeys.some((key) => RUN_ALL_PIN_ONLY[key]);

        if (!hasRunnablePinOnlySelection) {
            await showMessage({
                type: 'warning',
                title: 'Password Required',
                message: 'The selected automations need the KRA password. Add it or choose PIN-only options.'
            });
            return;
        }
    }

    try {
        appState.isProcessing = true;
        updateUIState();
        showProgressSection('Running selected automations...');

        const downloadPath = elements.downloadPath?.value || path.join(os.homedir(), 'Downloads', 'KRA POST PORTUM TOOL');

        // Get individual date ranges for VAT and WH VAT
        const vatDateRange = getIndividualVATDateRange();
        const whVatDateRange = getIndividualWhVATDateRange();

        const result = await ipcRenderer.invoke('run-all-automations', {
            company: buildCompanyPayload(),
            selectedAutomations,
            vatDateRange: vatDateRange,
            whVatDateRange: whVatDateRange,
            downloadPath: downloadPath
        });

        if (result.success) {
            normalizeExportFiles('runAll', {
                files: result.results?.files || [],
                downloadPath: result.downloadPath || ''
            });
            hideProgressSection();

            const completedCount = result.results?.successful?.length || 0;
            const skippedOrFailedCount = result.results?.failed?.length || 0;
            const skippedNames = (result.results?.failed || []).map((item) => item.name).filter(Boolean);

            await showMessage({
                type: skippedOrFailedCount ? 'warning' : 'info',
                title: 'All Automations Complete',
                message: skippedOrFailedCount
                    ? `Completed ${completedCount} automations. Skipped or failed ${skippedOrFailedCount}: ${skippedNames.join(', ')}.`
                    : `Completed ${completedCount} selected automations.`
            });
        } else {
            throw new Error(result.error || 'Some automations failed');
        }
    } catch (error) {
        console.error('Error running all automations:', error);
        await showMessage({
            type: 'error',
            title: 'Automation Error',
            message: `Failed to run automations: ${error.message}`
        });
        hideProgressSection();
    } finally {
        appState.isProcessing = false;
        updateUIState();
    }
}

async function runPinOnlyBatch() {
    const selectedAutomationKeys = getSelectedPinOnlyAutomationKeys();
    const batchCompanies = appState.batchCompanies.map((company) => ({
        ...company,
        browserSettings: getBrowserSettings()
    }));

    if (!batchCompanies.length) {
        await showMessage({
            type: 'warning',
            title: 'No Company List',
            message: 'Paste company PINs or import a CSV before starting the batch run.'
        });
        return;
    }

    if (!selectedAutomationKeys.length) {
        await showMessage({
            type: 'warning',
            title: 'No PIN-Only Automation Selected',
            message: 'Select at least one PIN-only automation before starting the batch run.'
        });
        return;
    }

    try {
        appState.isProcessing = true;
        appState.activeProcess = 'pinOnlyBatch';
        updateUIState();
        openPinOnlyBatchDialog();
        showBatchProgressCard(`Preparing ${batchCompanies.length} company PIN${batchCompanies.length === 1 ? '' : 's'} for batch processing...`);
        if (elements.pinOnlyBatchResults) {
            elements.pinOnlyBatchResults.classList.add('hidden');
        }
        showProgressSection(`Running PIN-only batch for ${batchCompanies.length} company PIN${batchCompanies.length === 1 ? '' : 's'}...`);

        const result = await ipcRenderer.invoke('run-pin-only-batch', {
            companies: batchCompanies,
            selectedAutomations: selectedAutomationKeys,
            downloadPath: elements.downloadPath?.value || path.join(os.homedir(), 'Downloads', 'KRA POST PORTUM TOOL')
        });

        if (!result.success) {
            throw new Error(result.error || 'Batch run failed');
        }

        appState.pinOnlyBatchData = result.data || null;
        normalizeExportFiles('pinOnlyBatch', {
            filePath: result.filePath,
            files: result.files || [],
            downloadPath: result.batchFolder || result.downloadPath || '',
            companyFolder: result.batchFolder || result.companyFolder || ''
        });
        updateBatchProgressCard({
            stage: 'PIN-Only Batch',
            message: `Batch completed. Combined report saved to ${result.filePath || result.batchFolder}.`,
            percentage: 100,
            log: `PIN-Only Batch: completed ${result.data?.companies?.length || 0} company PINs.`
        });
        displayPinOnlyBatchResults(result);
        hideProgressSection();

        const completedCount = result.data?.companies?.filter((company) => company.status === 'Completed').length || 0;
        await showMessage({
            type: 'info',
            title: 'PIN-Only Batch Complete',
            message: `Processed ${result.data?.companies?.length || 0} company PINs. Completed ${completedCount}. Combined report saved to ${result.filePath || result.batchFolder}.`
        });
    } catch (error) {
        console.error('Error running PIN-only batch:', error);
        updateBatchProgressCard({
            stage: 'PIN-Only Batch',
            message: `Batch failed: ${error.message}`,
            log: `PIN-Only Batch: ${error.message}`
        });
        hideProgressSection();
        await showMessage({
            type: 'error',
            title: 'PIN-Only Batch Error',
            message: `Failed to run the PIN-only batch: ${error.message}`
        });
    } finally {
        appState.isProcessing = false;
        appState.activeProcess = null;
        updateUIState();
    }
}

function displayPinOnlyBatchResults(result) {
    if (!elements.pinOnlyBatchResults) return;

    openModal(elements.pinOnlyBatchModal);

    const companies = result.data?.companies || [];
    const selectedAutomations = result.data?.selectedAutomations || [];
    const completedCount = companies.filter((company) => company.status === 'Completed').length;
    const partialCount = companies.filter((company) => company.status === 'Partial').length;
    const failedCount = companies.filter((company) => company.status === 'Failed').length;

    const statusBadge = (status) => {
        const statusClass = status === 'Completed'
            ? 'status-badge status-approved'
            : status === 'Partial'
                ? 'status-badge'
                : 'status-badge status-expired';
        return `<span class="${statusClass}">${escapeHtml(status || 'Unknown')}</span>`;
    };

    elements.pinOnlyBatchResults.innerHTML = `
        <div class="extraction-results">
            <div class="results-header">
                <div class="header-content">
                    <h3><i class="fa-solid fa-layer-group"></i> PIN-Only Batch Results</h3>
                    <div class="header-meta">
                        <span class="company-name">${companies.length} company PIN${companies.length === 1 ? '' : 's'}</span>
                        <span class="pin-badge">Batch folder: ${escapeHtml(result.batchFolder || 'N/A')}</span>
                        <span class="extraction-date">Processed: ${new Date().toLocaleDateString()}</span>
                    </div>
                </div>
            </div>
            <div class="summary-cards">
                <div class="summary-card"><div class="card-icon"><i class="fa-solid fa-list-check"></i></div><div class="card-content"><div class="card-label">Completed</div><div class="card-value status-active">${completedCount}</div></div></div>
                <div class="summary-card"><div class="card-icon"><i class="fa-solid fa-circle-half-stroke"></i></div><div class="card-content"><div class="card-label">Partial</div><div class="card-value">${partialCount}</div></div></div>
                <div class="summary-card"><div class="card-icon"><i class="fa-solid fa-circle-xmark"></i></div><div class="card-content"><div class="card-label">Failed</div><div class="card-value status-error">${failedCount}</div></div></div>
                <div class="summary-card"><div class="card-icon"><i class="fa-solid fa-file-excel"></i></div><div class="card-content"><div class="card-label">Combined Report</div><div class="card-value">${result.filePath ? 'Saved' : 'Missing'}</div></div></div>
            </div>
            <div class="data-section">
                <div class="section-header"><h4>Selected PIN-Only Automations</h4></div>
                ${buildResultActionButtons('pinOnlyBatch')}
                <table class="data-table">
                    <thead><tr><th>#</th><th>Automation</th></tr></thead>
                    <tbody>
                        ${selectedAutomations.map((label, index) => `<tr><td>${index + 1}</td><td>${escapeHtml(label)}</td></tr>`).join('')}
                    </tbody>
                </table>
            </div>
            <div class="data-section">
                <div class="section-header"><h4>Company Results</h4></div>
                <table class="data-table">
                    <thead>
                        <tr>
                            <th>#</th>
                            <th>PIN</th>
                            <th>Company</th>
                            <th>Manufacturer</th>
                            <th>Obligation</th>
                            <th>Agent</th>
                            <th>Overall</th>
                            <th>Report</th>
                            <th>Folder</th>
                            <th>Notes</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${companies.length ? companies.map((company, index) => `
                            <tr>
                                <td>${index + 1}</td>
                                <td>${escapeHtml(company.pin || 'N/A')}</td>
                                <td>${escapeHtml(company.name || 'N/A')}</td>
                                <td>${statusBadge(company.manufacturerStatus)}</td>
                                <td>${statusBadge(company.obligationStatus)}</td>
                                <td>${statusBadge(company.agentStatus)}</td>
                                <td>${statusBadge(company.status)}</td>
                                <td>${company.reportPath ? `<button class="btn btn-secondary btn-sm" data-action-type="open-file" data-path="${escapeHtml(company.reportPath)}"><span class="btn-icon"><i class="fa-solid fa-file-arrow-down"></i></span>Open</button>` : 'N/A'}</td>
                                <td>${company.companyFolder ? `<button class="btn btn-ghost btn-sm" data-action-type="open-folder" data-path="${escapeHtml(company.companyFolder)}"><span class="btn-icon"><i class="fa-solid fa-folder-open"></i></span>Open</button>` : 'N/A'}</td>
                                <td data-wrap="true">${escapeHtml(company.notes || '-')}</td>
                            </tr>
                        `).join('') : '<tr><td colspan="10">No batch results available.</td></tr>'}
                    </tbody>
                </table>
            </div>
            ${buildExportFilesTable('pinOnlyBatch')}
        </div>
    `;

    elements.pinOnlyBatchResults.classList.remove('hidden');
}

// Configuration functions
async function selectDownloadFolder() {
    try {
        const result = await ipcRenderer.invoke('select-folder');
        if (result.success && result.folderPath) {
            elements.downloadPath.value = result.folderPath;
        }
    } catch (error) {
        console.error('Error selecting folder:', error);
        await showMessage({
            type: 'error',
            title: 'Error',
            message: 'Failed to select download folder.'
        });
    }
}

async function saveConfiguration() {
    try {
        const config = {
            downloadPath: elements.downloadPath?.value || '',
            outputFormat: elements.outputFormat?.value || 'combined',
            browserHeadless: elements.browserHeadless?.value === 'true'
        };

        const result = await ipcRenderer.invoke('save-config', config);
        if (result.success) {
            return true;
        }
    } catch (error) {
        console.error('Error saving configuration:', error);
    }
    return false;
}

async function loadConfiguration(silent = false) {
    try {
        const result = await ipcRenderer.invoke('load-config');
        if (result) {
            if (elements.downloadPath) elements.downloadPath.value = result.downloadPath || elements.downloadPath.value || '';
            if (elements.outputFormat) elements.outputFormat.value = result.outputFormat || 'combined';
            if (elements.browserHeadless) elements.browserHeadless.value = result.browserHeadless ? 'true' : 'false';
            if (elements.settingsBrowserMode) elements.settingsBrowserMode.value = result.browserHeadless ? 'headless' : 'guided';
            updateSidebarFolderPath(elements.downloadPath?.value || '');
            if (!silent) {
                await showMessage({
                    type: 'info',
                    title: 'Configuration Loaded',
                    message: 'Settings loaded successfully.'
                });
            }
        }
    } catch (error) {
        console.error('Error loading configuration:', error);
        if (!silent) {
            await showMessage({
                type: 'error',
                title: 'Error',
                message: 'Failed to load configuration.'
            });
        }
    }
}

function displayWhVATResults(result) {
    if (!elements.whVatResults) return;

    const rows = result.data || [];

    elements.whVatResults.innerHTML = `
        <div class="extraction-results">
            <div class="results-header">
                <div class="header-content">
                    <h3><i class="fa-solid fa-file-invoice-dollar"></i> Withholding VAT Returns</h3>
                    <div class="header-meta">
                        <span class="company-name">${escapeHtml(appState.companyData?.name || 'Company')}</span>
                        <span class="pin-badge">PIN: ${escapeHtml(appState.companyData?.pin || 'N/A')}</span>
                        <span class="extraction-date">Extracted: ${new Date().toLocaleDateString()}</span>
                    </div>
                </div>
            </div>
            <div class="summary-cards">
                <div class="summary-card"><div class="card-icon"><i class="fa-solid fa-table-list"></i></div><div class="card-content"><div class="card-label">Rows Extracted</div><div class="card-value">${rows.length}</div></div></div>
                <div class="summary-card"><div class="card-icon"><i class="fa-solid fa-calendar-days"></i></div><div class="card-content"><div class="card-label">Date Range</div><div class="card-value">${escapeHtml(typeof result.dateRange === 'string' ? result.dateRange : 'Selected')}</div></div></div>
                <div class="summary-card"><div class="card-icon"><i class="fa-solid fa-file-excel"></i></div><div class="card-content"><div class="card-label">Export</div><div class="card-value status-active">Excel saved</div></div></div>
            </div>
            <div class="data-section">
                <div class="section-header"><h4>Extraction Summary</h4></div>
                ${buildResultActionButtons('whVat')}
                <table class="data-table">
                    <tbody>
                        <tr><td><strong>Output Folder</strong></td><td>${escapeHtml(result.downloadPath || '')}</td></tr>
                        <tr><td><strong>Rows Extracted</strong></td><td>${rows.length}</td></tr>
                    </tbody>
                </table>
            </div>
            <div class="data-section">
                <div class="section-header"><h4>Transactions</h4></div>
                <table class="data-table">
                    <thead><tr><th>#</th><th>Period</th><th>Tax Obligation</th><th>Date</th><th>Reference</th><th>Particulars</th><th>Type</th><th>Debit</th><th>Credit</th></tr></thead>
                    <tbody>
                        ${rows.length ? rows.map((row, index) => `
                            <tr>
                                <td>${index + 1}</td>
                                <td>${escapeHtml(row.period || 'N/A')}</td>
                                <td>${escapeHtml(row.taxObligation || 'N/A')}</td>
                                <td>${escapeHtml(row.date || 'N/A')}</td>
                                <td>${escapeHtml(row.refNo || 'N/A')}</td>
                                <td>${escapeHtml(row.particulars || 'N/A')}</td>
                                <td>${escapeHtml(row.type || 'N/A')}</td>
                                <td>${escapeHtml(row.debit || '0')}</td>
                                <td>${escapeHtml(row.credit || '0')}</td>
                            </tr>
                        `).join('') : '<tr><td colspan="9">No withholding VAT rows were found for the selected range.</td></tr>'}
                    </tbody>
                </table>
            </div>
            ${buildExportFilesTable('whVat')}
        </div>
    `;
    elements.whVatResults.classList.remove('hidden');
}

// Utility functions
function showProgressSection(message) {
    if (elements.progressSection) {
        elements.progressSection.classList.remove('hidden');
    }
    if (elements.progressText) {
        elements.progressText.textContent = message;
    }
    const percentageEl = document.getElementById('progressPercentage');
    if (percentageEl) {
        percentageEl.textContent = '0%';
    }
    if (elements.progressFill) {
        elements.progressFill.style.width = '0%';
    }
    if (elements.progressLog) {
        elements.progressLog.innerHTML = '';
    }
}

function hideProgressSection() {
    if (elements.progressSection) {
        elements.progressSection.classList.add('hidden');
    }
}

function updateProgress(progress) {
    const percentage = Number.isFinite(progress.percentage)
        ? progress.percentage
        : Number.isFinite(progress.progress)
            ? progress.progress
            : undefined;

    if (percentage !== undefined && elements.progressFill) {
        const safePercentage = Math.max(0, Math.min(100, Math.round(percentage)));
        elements.progressFill.style.width = `${safePercentage}%`;
        // Update percentage display
        const percentageEl = document.getElementById('progressPercentage');
        if (percentageEl) {
            percentageEl.textContent = `${safePercentage}%`;
        }
    }

    if (progress.message && elements.progressText) {
        elements.progressText.textContent = progress.message;
    }

    updateBatchProgressCard(progress);

    if (progress.log && elements.progressLog) {
        const logEntry = document.createElement('div');
        logEntry.textContent = progress.log;
        elements.progressLog.appendChild(logEntry);
        elements.progressLog.scrollTop = elements.progressLog.scrollHeight;
    }
}

// Update company badge in header
function updateCompanyBadge() {
    const badge = document.getElementById('companyBadge');
    const nameEl = document.getElementById('badgeCompanyName');
    const pinEl = document.getElementById('badgeCompanyPin');

    if (appState.companyData && badge && nameEl && pinEl) {
        nameEl.textContent = appState.companyData.name || 'Company';
        pinEl.textContent = `PIN: ${appState.companyData.pin || '-'}`;
        badge.classList.remove('hidden');
    } else if (badge) {
        badge.classList.add('hidden');
    }
}

// Update Full Profile when data changes
function refreshFullProfile() {
    const profileEmpty = document.getElementById('profileEmptyState');
    const profileView = document.getElementById('profileDataView');

    if (!profileEmpty || !profileView) return;

    // Check if we have ANY data - including ALL extraction types
    const hasData = appState.companyData ||
        appState.manufacturerData ||
        appState.obligationData ||
        appState.vatData ||
        appState.whVatData ||
        appState.ledgerData ||
        appState.liabilitiesData ||
        appState.directorDetails ||
        appState.agentData ||
        appState.tccData;

    if (hasData) {
        profileEmpty.classList.add('hidden');
        profileView.classList.remove('hidden');
        updateProfileCards();
    } else {
        profileEmpty.classList.remove('hidden');
        profileView.classList.add('hidden');
    }
}

// Update individual profile cards
function updateProfileCards() {
    // 1. Update Company Overview
    if (appState.companyData) {
        const initials = document.getElementById('profileInitials');
        const companyName = document.getElementById('profileCompanyName');
        const pin = document.getElementById('profilePin');
        const vatStatus = document.getElementById('profileVatStatus');
        const etimsStatus = document.getElementById('profileEtimsStatus');

        if (initials && appState.companyData.name) {
            const nameWords = appState.companyData.name.split(' ');
            initials.textContent = nameWords.map(w => w[0]).join('').substring(0, 2).toUpperCase();
        }
        if (companyName) companyName.textContent = appState.companyData.name || 'Company Name';
        if (pin) pin.textContent = `PIN: ${appState.companyData.pin || '-'}`;

        // Update VAT status badge
        if (vatStatus && appState.manufacturerData) {
            const vatReg = appState.manufacturerData.taxTypeRDtoList?.find(t => t.taxType === 'VAT');
            if (vatReg) {
                vatStatus.textContent = `VAT: ${vatReg.registrationStatus || 'Unknown'}`;
                vatStatus.className = `badge ${vatReg.registrationStatus === 'Active' ? 'badge-success' : 'badge-gray'}`;
            }
        }

        // Update eTIMS status badge
        if (etimsStatus && appState.manufacturerData) {
            const etimsReg = appState.manufacturerData.electronicTaxInvoicing;
            if (etimsReg) {
                const status = etimsReg['eTIMS Registration'] || etimsReg['TIMS Registration'] || 'Unknown';
                etimsStatus.textContent = `eTIMS: ${status}`;
                etimsStatus.className = `badge ${status === 'Active' ? 'badge-success' : 'badge-gray'}`;
            }
        }
    }

    // 2. Update Business Details (Manufacturer Data) - SHOW ALL DATA
    const mfgCard = document.getElementById('profileManufacturerCard');
    const mfgData = document.getElementById('profileManufacturerData');
    if (mfgData && appState.manufacturerData) {
        const basic = appState.manufacturerData.timsManBasicRDtlDTO || {};
        const business = appState.manufacturerData.manBusinessRDtlDTO || {};
        const contact = appState.manufacturerData.manContactRDtlDTO || {};
        const address = appState.manufacturerData.manAddRDtlDTO || {};
        const taxTypes = appState.manufacturerData.taxTypeRDtoList || [];
        const etims = appState.manufacturerData.electronicTaxInvoicing || {};

        let html = `
            <h5 class="profile-section-title">Basic Information</h5>
            <table class="data-table profile-table">
                <tbody>
                    <tr><td><strong>Business Name</strong></td><td>${business.businessName || 'N/A'}</td></tr>
                    <tr><td><strong>Manufacturer Name</strong></td><td>${basic.manufacturerName || 'N/A'}</td></tr>
                    <tr><td><strong>Registration No</strong></td><td>${basic.manufacturerBrNo || 'N/A'}</td></tr>
                    <tr><td><strong>Type</strong></td><td>${basic.manufacturerType || 'N/A'}</td></tr>
                    <tr><td><strong>Mobile</strong></td><td>${contact.mobileNo || 'N/A'}</td></tr>
                    <tr><td><strong>Email</strong></td><td>${contact.mainEmail || 'N/A'}</td></tr>
                    <tr><td><strong>Address</strong></td><td>${address.descriptiveAddress || 'N/A'}</td></tr>
                </tbody>
            </table>
        `;

        if (taxTypes.length > 0) {
            html += `
                <h5 class="profile-section-title">Tax Registrations</h5>
                <table class="data-table profile-table">
                    <thead>
                        <tr>
                            <th>Tax Type</th>
                            <th>Status</th>
                            <th>Obligation Number</th>
                        </tr>
                    </thead>
                    <tbody>
            `;
            taxTypes.forEach(tax => {
                html += `
                    <tr>
                        <td>${tax.taxType || 'N/A'}</td>
                        <td><span class="badge ${tax.registrationStatus === 'Active' ? 'badge-success' : 'badge-gray'}">${tax.registrationStatus || 'N/A'}</span></td>
                        <td>${tax.obligationNumber || 'N/A'}</td>
                    </tr>
                `;
            });
            html += `</tbody></table>`;
        }

        if (etims) {
            html += `
                <h5 class="profile-section-title">Electronic Tax Invoicing</h5>
                <table class="data-table">
                    <tbody>
                        <tr><td><strong>eTIMS Registration</strong></td><td>${etims['eTIMS Registration'] || 'N/A'}</td></tr>
                        <tr><td><strong>TIMS Registration</strong></td><td>${etims['TIMS Registration'] || 'N/A'}</td></tr>
                    </tbody>
                </table>
            `;
        }

        mfgData.innerHTML = html;
        if (mfgCard) {
            const statusDot = mfgCard.querySelector('.status-dot');
            if (statusDot) statusDot.className = 'status-dot status-success';
        }
    }

    // 3. Update Tax Obligations - SHOW ALL DATA IN TABLE
    const obCard = document.getElementById('profileObligationsCard');
    const obData = document.getElementById('profileObligationsData');
    if (obData && appState.obligationData) {
        const obligations = appState.obligationData.obligations || [];

        let html = `
            <h5 class="profile-section-title">Taxpayer Status</h5>
            <table class="data-table profile-table">
                <tbody>
                    <tr><td><strong>PIN Status</strong></td><td>${appState.obligationData.pin_status || 'Unknown'}</td></tr>
                    <tr><td><strong>iTax Status</strong></td><td>${appState.obligationData.itax_status || 'Unknown'}</td></tr>
                    <tr><td><strong>eTIMS Registration</strong></td><td>${appState.obligationData.etims_registration || 'Unknown'}</td></tr>
                    <tr><td><strong>VAT Compliance</strong></td><td>${appState.obligationData.vat_compliance || 'Unknown'}</td></tr>
                </tbody>
            </table>
        `;

        if (obligations.length > 0) {
            html += `
                <h5 class="profile-section-title">Tax Obligations (${obligations.length})</h5>
                <table class="data-table">
                    <thead>
                        <tr>
                            <th>#</th>
                            <th>Obligation Name</th>
                            <th>Status</th>
                            <th>Effective From</th>
                            <th>Effective To</th>
                        </tr>
                    </thead>
                    <tbody>
            `;
            obligations.forEach((ob, index) => {
                html += `
                    <tr>
                        <td>${index + 1}</td>
                        <td>${ob.name || 'N/A'}</td>
                        <td><span class="badge ${ob.status?.toLowerCase().includes('active') ? 'badge-success' : 'badge-gray'}">${ob.status || 'N/A'}</span></td>
                        <td>${ob.effectiveFrom || 'N/A'}</td>
                        <td>${ob.effectiveTo || 'Active'}</td>
                    </tr>
                `;
            });
            html += `</tbody></table>`;
        }

        obData.innerHTML = html;
        if (obCard) {
            const statusDot = obCard.querySelector('.status-dot');
            if (statusDot) statusDot.className = 'status-dot status-success';
        }
    }

    // 4. Update Liabilities
    const liabCard = document.getElementById('profileLiabilitiesCard');
    const liabData = document.getElementById('profileLiabilitiesData');
    if (liabData && appState.liabilitiesData) {
        const totalAmount = appState.liabilitiesData.totalAmount || 0;
        const recordCount = appState.liabilitiesData.recordCount || (Array.isArray(appState.liabilitiesData) ? appState.liabilitiesData.length : 0);

        liabData.innerHTML = `
            <div class="profile-summary">
                <div class="summary-item">
                    <span class="summary-label">Total Outstanding:</span>
                    <span class="summary-amount ${totalAmount > 0 ? 'text-red' : 'text-green'}">
                        KES ${totalAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                </div>
                <div class="summary-item">
                    <span class="summary-label">Records:</span>
                    <span>${recordCount}</span>
                </div>
                ${totalAmount === 0 ? '<p class="success-text">No outstanding liabilities</p>' : ''}
            </div>
        `;
        if (liabCard) {
            const statusDot = liabCard.querySelector('.status-dot');
            if (statusDot) statusDot.className = `status-dot ${totalAmount === 0 ? 'status-success' : 'status-error'}`;
        }
    }

    // 5. Update VAT Returns
    const vatCard = document.getElementById('profileVatCard');
    const vatData = document.getElementById('profileVatData');
    if (vatData && appState.vatData) {
        const totalReturns = appState.vatData.totalReturns || 0;
        const completed = appState.vatData.completed || false;

        vatData.innerHTML = `
            <div class="profile-summary">
                <div class="summary-item">
                    <span class="summary-label">Status:</span>
                    <span class="badge badge-success">${completed ? 'Completed' : 'In Progress'}</span>
                </div>
                <div class="summary-item">
                    <span class="summary-label">Returns Processed:</span>
                    <span>${totalReturns}</span>
                </div>
            </div>
        `;
        if (vatCard) {
            const statusDot = vatCard.querySelector('.status-dot');
            if (statusDot) statusDot.className = 'status-dot status-success';
        }
    }

    // 6. Update Withholding Agent Status - SHOW ALL DATA
    const agentCard = document.getElementById('profileAgentCard');
    const agentData = document.getElementById('profileAgentData');
    if (agentData && appState.agentData) {
        const isVatAgent = appState.agentData.vat?.isRegistered === true;
        const isRentAgent = appState.agentData.rent?.isRegistered === true;
        const confirmedPin = appState.agentData.vat?.details?.confirmedPin || appState.agentData.rent?.details?.confirmedPin || 'N/A';
        const taxpayerName = appState.agentData.vat?.details?.taxpayerName || appState.agentData.rent?.details?.taxpayerName || 'N/A';

        let html = `
            <h5 class="profile-section-title">Agent Status</h5>
            <table class="data-table profile-table">
                <tbody>
                    <tr>
                        <td><strong>VAT Withholding Agent</strong></td>
                        <td><span class="badge ${isVatAgent ? 'badge-success' : 'badge-gray'}">${isVatAgent ? 'Registered' : 'Not Registered'}</span></td>
                    </tr>
                    <tr>
                        <td><strong>Rent Income Withholding Agent</strong></td>
                        <td><span class="badge ${isRentAgent ? 'badge-success' : 'badge-gray'}">${isRentAgent ? 'Registered' : 'Not Registered'}</span></td>
                    </tr>
                </tbody>
            </table>
        `;

        if (isVatAgent || isRentAgent || confirmedPin !== 'N/A' || taxpayerName !== 'N/A') {
            html += `
                <h5 class="profile-section-title">Agent Details</h5>
                <table class="data-table">
                    <tbody>
                        <tr><td><strong>Confirmed PIN</strong></td><td>${confirmedPin}</td></tr>
                        <tr><td><strong>Taxpayer Name</strong></td><td>${taxpayerName}</td></tr>
                    </tbody>
                </table>
            `;
        }

        agentData.innerHTML = html;
        if (agentCard) {
            const statusDot = agentCard.querySelector('.status-dot');
            if (statusDot) statusDot.className = 'status-dot status-success';
        }
    }

    // 7. Update Director Details - SHOW ALL DATA IN TABLES
    const directorCard = document.getElementById('profileDirectorCard');
    const directorData = document.getElementById('profileDirectorData');
    if (directorData && appState.directorDetails) {
        const directors = appState.directorDetails.directors || [];
        const activities = appState.directorDetails.activities || [];

        let html = `
            <h5 class="profile-section-title">Accounting Information</h5>
            <table class="data-table profile-table">
                <tbody>
                    <tr><td><strong>Accounting Period End Month</strong></td><td>${appState.directorDetails.accountingPeriod || 'N/A'}</td></tr>
                </tbody>
            </table>
        `;

        if (activities.length > 0) {
            html += `
                <h5 class="profile-section-title">Economic Activities (${activities.length})</h5>
                <table class="data-table profile-table">
                    <thead>
                        <tr>
                            <th>#</th>
                            <th>Section</th>
                            <th>Type</th>
                        </tr>
                    </thead>
                    <tbody>
            `;
            activities.forEach((act, index) => {
                html += `
                    <tr>
                        <td>${index + 1}</td>
                        <td>${act.section || 'N/A'}</td>
                        <td>${act.type || 'N/A'}</td>
                    </tr>
                `;
            });
            html += `</tbody></table>`;
        }

        if (directors.length > 0) {
            html += `
                <h5 class="profile-section-title">Directors & Associates (${directors.length})</h5>
                <table class="data-table">
                    <thead>
                        <tr>
                            <th>#</th>
                            <th>Nature</th>
                            <th>PIN</th>
                            <th>Name</th>
                            <th>Email</th>
                            <th>Mobile</th>
                        </tr>
                    </thead>
                    <tbody>
            `;
            directors.forEach((dir, index) => {
                html += `
                    <tr>
                        <td>${index + 1}</td>
                        <td>${dir.nature || 'N/A'}</td>
                        <td>${dir.pin || 'N/A'}</td>
                        <td>${dir.name || 'N/A'}</td>
                        <td>${dir.email || 'N/A'}</td>
                        <td>${dir.mobile || 'N/A'}</td>
                    </tr>
                `;
            });
            html += `</tbody></table>`;
        }

        directorData.innerHTML = html;
        if (directorCard) {
            const statusDot = directorCard.querySelector('.status-dot');
            if (statusDot) statusDot.className = 'status-dot status-success';
        }
    }

    // 8. Update Withholding VAT
    const whVatCard = document.getElementById('profileWhVatCard');
    const whVatData = document.getElementById('profileWhVatData');
    if (whVatData && appState.whVatData) {
        const completed = appState.whVatData.completed || false;
        const totalReturns = appState.whVatData.totalReturns || 0;

        whVatData.innerHTML = `
            <div class="profile-summary">
                <div class="summary-item">
                    <span class="summary-label">Status:</span>
                    <span class="badge badge-success">${completed ? 'Completed' : 'In Progress'}</span>
                </div>
                <div class="summary-item">
                    <span class="summary-label">Returns Processed:</span>
                    <span>${totalReturns}</span>
                </div>
            </div>
        `;
        if (whVatCard) {
            const statusDot = whVatCard.querySelector('.status-dot');
            if (statusDot) statusDot.className = 'status-dot status-success';
        }
    }

    // 9. Update General Ledger
    const ledgerCard = document.getElementById('profileLedgerCard');
    const ledgerData = document.getElementById('profileLedgerData');
    if (ledgerData && appState.ledgerData) {
        const completed = appState.ledgerData.completed || false;

        ledgerData.innerHTML = `
            <div class="profile-summary">
                <div class="summary-item">
                    <span class="summary-label">Status:</span>
                    <span class="badge badge-success">${completed ? 'Completed' : 'In Progress'}</span>
                </div>
                ${appState.ledgerData.downloadPath ? `
                <div class="summary-item">
                    <span class="summary-label">Saved to:</span>
                    <span class="file-path">${appState.ledgerData.downloadPath.split('\\').pop()}</span>
                </div>
                ` : ''}
            </div>
        `;
        if (ledgerCard) {
            const statusDot = ledgerCard.querySelector('.status-dot');
            if (statusDot) statusDot.className = 'status-dot status-success';
        }
    }

    // 10. Update TCC
    const tccCard = document.getElementById('profileTccCard');
    const tccData = document.getElementById('profileTccData');
    if (tccData && appState.tccData) {
        const downloaded = appState.tccData.downloaded || appState.tccData.success || false;
        const tccFilePath = appState.exports.tcc?.primaryFile || appState.tccData.filePath || appState.tccData.files?.[0] || '';

        tccData.innerHTML = `
            <div class="profile-summary">
                <div class="summary-item">
                    <span class="summary-label">Status:</span>
                    <span class="badge ${downloaded ? 'badge-success' : 'badge-gray'}">${downloaded ? 'Downloaded' : 'Pending'}</span>
                </div>
                ${tccFilePath ? `
                <div class="summary-item">
                    <span class="summary-label">File:</span>
                    <span class="file-path">${escapeHtml(path.basename(tccFilePath))}</span>
                </div>
                ` : ''}
            </div>
        `;
        if (tccCard) {
            const statusDot = tccCard.querySelector('.status-dot');
            if (statusDot) statusDot.className = `status-dot ${downloaded ? 'status-success' : 'status-pending'}`;
        }
    }

    // 11. Update Generated Files
    const filesData = document.getElementById('profileFilesData');
    if (filesData) {
        const allFiles = Object.values(appState.exports)
            .flatMap((info) => (info.files || []).map((filePath) => ({ name: info.label, path: filePath })));

        if (allFiles.length > 0) {
            filesData.innerHTML = allFiles.map(file => `
                <div class="file-item">
                    <span class="file-icon">${icon('file')}</span>
                    <div class="file-info">
                        <div class="file-name">${file.name}</div>
                        <div class="file-size">${file.path}</div>
                    </div>
                </div>
            `).join('');
        } else {
            filesData.innerHTML = '<p class="empty-text">No files generated</p>';
        }
    }
}

// Toast Notification System
function showToast(options) {
    const container = document.getElementById('toastContainer');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast ${options.type || 'info'}`;

    const icons = {
        success: icon('check'),
        error: icon('error'),
        warning: icon('warning'),
        info: icon('info')
    };

    toast.innerHTML = `
        <div class="toast-icon">${icons[options.type] || icons.info}</div>
        <div class="toast-content">
            <div class="toast-title">${options.title || 'Notification'}</div>
            <div class="toast-message">${options.message || ''}</div>
        </div>
        <button class="toast-close" onclick="this.parentElement.remove()">&times;</button>
    `;

    container.appendChild(toast);

    // Auto-remove after 4 seconds (except errors which stay 6 seconds)
    const duration = options.type === 'error' ? 6000 : 4000;
    setTimeout(() => {
        toast.classList.add('removing');
        setTimeout(() => toast.remove(), 300);
    }, duration);
}

// Alias for backward compatibility
async function showMessage(options) {
    showToast(options);
}

function displayLiabilitiesResults(result) {
    if (!elements.liabilitiesResults) return;

    // Extract data from result if available
    const liabilitiesData = result.data || [];
    const totalAmount = result.totalAmount || 0;
    const recordCount = liabilitiesData.length || 0;

    // Check if we have method-specific data
    const method1Data = result.methods?.method1 || null;
    const method2Data = result.methods?.method2 || null;
    const hasSeparateMethods = method1Data && method2Data;

    let tableHtml = `
        <div class="extraction-results">
            <!-- Header -->
            <div class="results-header">
                <div class="header-content">
                    <h3>${icon('money')} Tax Liabilities</h3>
                    <div class="header-meta">
                        <span class="company-name">${appState.companyData?.name || 'Company'}</span>
                        <span class="pin-badge">PIN: ${appState.companyData?.pin || 'N/A'}</span>
                        <span class="extraction-date">Extracted: ${new Date().toLocaleDateString()}</span>
                    </div>
                </div>
            </div>

            <!-- Summary Cards -->
            <div class="summary-cards">
                <div class="summary-card">
                    <div class="card-icon">${icon('wallet')}</div>
                    <div class="card-content">
                        <div class="card-label">Total Outstanding</div>
                        <div class="card-value status-error">KES ${totalAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                    </div>
                </div>
                <div class="summary-card">
                    <div class="card-icon">${icon('chart')}</div>
                    <div class="card-content">
                        <div class="card-label">Total Records</div>
                        <div class="card-value">${recordCount}</div>
                    </div>
                </div>
    `;

    if (hasSeparateMethods) {
        tableHtml += `
                <div class="summary-card">
                    <div class="card-icon">${icon('list')}</div>
                    <div class="card-content">
                        <div class="card-label">Method 1 Records</div>
                        <div class="card-value">${method1Data.recordCount || 0}</div>
                    </div>
                </div>
                <div class="summary-card">
                    <div class="card-icon">${icon('creditCard')}</div>
                    <div class="card-content">
                        <div class="card-label">Method 2 Records</div>
                        <div class="card-value">${method2Data.recordCount || 0}</div>
                    </div>
                </div>
        `;
    }

    tableHtml += `
                <div class="summary-card">
                    <div class="card-icon">${icon('check')}</div>
                    <div class="card-content">
                        <div class="card-label">Status</div>
                        <div class="card-value status-active">Completed</div>
                    </div>
                </div>
            </div>
            <div class="data-section">
                <div class="section-header"><h4>Saved Output</h4></div>
                ${buildResultActionButtons('liabilities')}
            </div>
    `;

    if (hasSeparateMethods) {
        // Display Method 1 Section
        if (method1Data && method1Data.data.length > 0) {
            tableHtml += `
                <div class="data-section">
                    <div class="section-header">
                        <h4>Method 1: VAT Refund Approach (${method1Data.recordCount} records - KES ${method1Data.totalAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })})</h4>
                    </div>
                    <table class="data-table">
                        <thead>
                            <tr>
                                <th>Tax Type</th>
                                <th>Period</th>
                                <th>Due Date</th>
                                <th>Amount (KES)</th>
                                <th>Source</th>
                            </tr>
                        </thead>
                        <tbody>
            `;

            method1Data.data.forEach(liability => {
                const amount = parseFloat(liability.amount || 0);
                tableHtml += `
                    <tr>
                        <td>${liability.taxType || 'N/A'}</td>
                        <td>${liability.period || 'N/A'}</td>
                        <td>${liability.dueDate || 'N/A'}</td>
                        <td class="amount-cell">${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                        <td><span class="method-badge method1-badge">VAT Refund</span></td>
                    </tr>
                `;
            });

            tableHtml += `
                        </tbody>
                        <tfoot>
                            <tr class="method-total-row">
                                <td colspan="3"><strong>METHOD 1 TOTAL</strong></td>
                                <td class="amount-cell"><strong>KES ${method1Data.totalAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong></td>
                                <td></td>
                            </tr>
                        </tfoot>
                    </table>
                </div>
            `;
        } else {
            tableHtml += `
                <div class="data-section">
                    <div class="section-header">
                        <h4>Method 1: VAT Refund Approach</h4>
                    </div>
                    <div class="no-data-message">
                        <p>No data found using VAT Refund method</p>
                    </div>
                </div>
            `;
        }

        // Display Method 2 Section
        if (method2Data && method2Data.data.length > 0) {
            // Get all unique headers from Method 2 data
            const allHeaders = new Set();
            if (method2Data.breakdown) {
                Object.values(method2Data.breakdown).forEach(taxData => {
                    if (taxData.headers) {
                        taxData.headers.forEach(h => allHeaders.add(h));
                    }
                });
            }

            const headersArray = Array.from(allHeaders);

            // Calculate the main total (Amount to be Paid) for display
            let mainTotal = 0;
            method2Data.data.forEach(liability => {
                headersArray.forEach(header => {
                    const headerLower = header.toLowerCase();
                    if (headerLower.includes('amount') && (headerLower.includes('paid') || headerLower.includes('due') || headerLower.includes('payable'))) {
                        const value = liability.rawData?.[header];
                        if (value) {
                            const numValue = parseFloat(value.replace(/[^0-9.-]+/g, "")) || 0;
                            if (numValue > 0) {
                                mainTotal += numValue;
                            }
                        }
                    }
                });
            });

            // Use the main total if available, otherwise fall back to method2Data.totalAmount
            const displayTotal = mainTotal > 0 ? mainTotal : method2Data.totalAmount;

            tableHtml += `
                <div class="data-section">
                    <div class="section-header">
                        <h4>Method 2: Payment Registration Approach (${method2Data.recordCount} records - KES ${displayTotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })})</h4>
                    </div>
                    <table class="data-table">
                        <thead>
                            <tr>
                                <th>Tax Type</th>
            `;

            // Add dynamic headers
            headersArray.forEach(header => {
                tableHtml += `<th>${header}</th>`;
            });

            tableHtml += `
                            </tr>
                        </thead>
                        <tbody>
            `;

            method2Data.data.forEach(liability => {
                tableHtml += `
                    <tr>
                        <td>${liability.taxType || 'N/A'}</td>
                `;

                // Add data for each dynamic column
                headersArray.forEach(header => {
                    const value = liability.rawData?.[header] || 'N/A';
                    const headerLower = header.toLowerCase();

                    if (headerLower.includes('amount') || headerLower.includes('penalty') ||
                        headerLower.includes('interest') || headerLower.includes('total')) {
                        const numValue = parseFloat(value.replace(/[^0-9.-]+/g, "")) || 0;
                        tableHtml += `<td class="amount-cell">${numValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>`;
                    } else {
                        tableHtml += `<td>${value}</td>`;
                    }
                });

                tableHtml += `</tr>`;
            });

            // Calculate totals for each column
            const totals = {};

            method2Data.data.forEach(liability => {
                headersArray.forEach(header => {
                    const value = liability.rawData?.[header];
                    if (value) {
                        const numValue = parseFloat(value.replace(/[^0-9.-]+/g, "")) || 0;
                        if (numValue > 0) {
                            totals[header] = (totals[header] || 0) + numValue;
                        }
                    }
                });
            });

            tableHtml += `
                        </tbody>
                        <tfoot>
                            <tr class="method-total-row">
                                <td><strong>METHOD 2 TOTAL</strong></td>
            `;

            // Add total values for each column
            headersArray.forEach(header => {
                const headerLower = header.toLowerCase();
                if (headerLower.includes('amount') || headerLower.includes('penalty') ||
                    headerLower.includes('interest') || headerLower.includes('total')) {
                    const totalValue = totals[header] || 0;
                    tableHtml += `<td class="amount-cell"><strong>KES ${totalValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong></td>`;
                } else {
                    tableHtml += `<td></td>`;
                }
            });

            tableHtml += `
                            </tr>
                        </tfoot>
                    </table>
                </div>
            `;
        } else {
            tableHtml += `
                <div class="data-section">
                    <div class="section-header">
                        <h4>Method 2: Payment Registration Approach</h4>
                    </div>
                    <div class="no-data-message">
                        <p>No data found using Payment Registration method</p>
                    </div>
                </div>
            `;
        }

        // No Grand Total - each method shows its own totals
    } else {
        // Fallback to single method display
        if (recordCount > 0) {
            tableHtml += `
                <div class="data-section">
                    <div class="section-header">
                        <h4>Outstanding Liabilities</h4>
                    </div>
                    <table class="data-table">
                        <thead>
                            <tr>
                                <th>Tax Type</th>
                                <th>Period</th>
                                <th>Due Date</th>
                                <th>Amount (KES)</th>
                                <th>Status</th>
                            </tr>
                        </thead>
                        <tbody>
            `;

            liabilitiesData.forEach(liability => {
                const amount = parseFloat(liability.amount || 0);
                tableHtml += `
                    <tr>
                        <td>${liability.taxType || 'N/A'}</td>
                        <td>${liability.period || 'N/A'}</td>
                        <td>${liability.dueDate || 'N/A'}</td>
                        <td>${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                        <td><span class="status-badge status-expired">Outstanding</span></td>
                    </tr>
                `;
            });

            tableHtml += `
                        </tbody>
                    </table>
                </div>
            `;
        } else {
            tableHtml += `
                <div class="data-section">
                    <div class="no-data-message">
                        <p>No outstanding liabilities found. The account appears up to date.</p>
                    </div>
                </div>
            `;
        }
    }

    tableHtml += `</div>`; // Close extraction-results

    tableHtml += `
        <div class="extraction-info">
            <small>Excel file saved to: ${result.downloadPath || 'Default location'}</small>
        </div>
    `;

    tableHtml += buildExportFilesTable('liabilities');

    elements.liabilitiesResults.innerHTML = tableHtml;
    elements.liabilitiesResults.classList.remove('hidden');
}

function displayLedgerResults(result) {
    if (!elements.ledgerResults) return;

    // Extract data from result if available
    const ledgerData = result.data || [];
    const recordCount = ledgerData.length || 0;

    let tableHtml = `
        <div class="extraction-results">
            <!-- Header -->
            <div class="results-header">
                <div class="header-content">
                    <h3>${icon('book')} General Ledger</h3>
                    <div class="header-meta">
                        <span class="company-name">${appState.companyData?.name || 'Company'}</span>
                        <span class="pin-badge">PIN: ${appState.companyData?.pin || 'N/A'}</span>
                        <span class="extraction-date">Extracted: ${new Date().toLocaleDateString()}</span>
                    </div>
                </div>
            </div>

            <!-- Summary Cards -->
            <div class="summary-cards">
                <div class="summary-card">
                    <div class="card-icon">${icon('chart')}</div>
                    <div class="card-content">
                        <div class="card-label">Total Transactions</div>
                        <div class="card-value">${recordCount}</div>
                    </div>
                </div>
                <div class="summary-card">
                    <div class="card-icon">${icon('check')}</div>
                    <div class="card-content">
                        <div class="card-label">Status</div>
                        <div class="card-value status-active">Completed</div>
                    </div>
                </div>
                <div class="summary-card">
                    <div class="card-icon">${icon('save')}</div>
                    <div class="card-content">
                        <div class="card-label">Export</div>
                        <div class="card-value">Excel Saved</div>
                    </div>
                </div>
            </div>
            <div class="data-section">
                <div class="section-header"><h4>Saved Output</h4></div>
                ${buildResultActionButtons('ledger')}
            </div>
    `;

    if (recordCount > 0) {
        // Get headers from first transaction (dynamically)
        const firstTransaction = ledgerData[0];
        const headers = firstTransaction.headers || [
            'Sr.No', 'Tax Obligation', 'Tax Period', 'Transaction Date',
            'Reference Number', 'Particulars', 'Transaction Type', 'Debit(Ksh)', 'Credit(Ksh)'
        ];

        tableHtml += `
            <div class="data-section">
                <div class="section-header">
                    <h4>Transaction Details (${recordCount} records)</h4>
                </div>
                <table class="data-table ledger-table">
                    <thead>
                        <tr>
                            <th></th>
        `;

        // Add dynamic headers
        headers.forEach(header => {
            tableHtml += `<th>${header.toUpperCase()}</th>`;
        });

        tableHtml += `
                        </tr>
                    </thead>
                    <tbody>
        `;

        ledgerData.forEach(transaction => {
            const isTotal = transaction.isTotal || false;
            const rowClass = isTotal ? 'total-row' : '';
            const columns = transaction.columns || [];

            tableHtml += `<tr class="${rowClass}"><td></td>`;

            // Add dynamic columns
            columns.forEach((value, index) => {
                const isNumeric = !isNaN(parseFloat(value.replace(/,/g, ''))) && value.match(/[\d,]+\.?\d*/);
                const cellClass = isNumeric ? 'amount-cell' : '';
                tableHtml += `<td class="${cellClass}">${value || ''}</td>`;
            });

            tableHtml += `</tr>`;
        });

        tableHtml += `
                    </tbody>
                </table>
            </div>
        `;
    } else {
        tableHtml += `
            <div class="data-section">
                <div class="no-data-message">
                    <p>No ledger transactions found for the selected criteria.</p>
                </div>
            </div>
        `;
    }

    tableHtml += `
        </div>
    `;

    tableHtml += buildExportFilesTable('ledger');

    elements.ledgerResults.innerHTML = tableHtml;
    elements.ledgerResults.classList.remove('hidden');

    // Update the UI state to show the green checkmark
    updateUIState();
}

// Update sidebar folder path display
function updateSidebarFolderPath(folderPath) {
    if (elements.sidebarFolderPath) {
        elements.sidebarFolderPath.textContent = folderPath || 'Not set';
        elements.sidebarFolderPath.title = folderPath || '';
    }
}

// Initialize app on DOMContentLoaded
document.addEventListener('DOMContentLoaded', () => {
    console.log('DOM Content Loaded');
    init();
}); 
