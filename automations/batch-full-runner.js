const ExcelJS = require('exceljs');
const path = require('path');
const fs = require('fs').promises;

// Reuse the fully-defined single-company runner — preserves per-company workbooks,
// SharedWorkbookManager sheets, sequential/parallel task logic, etc.
const { runAllAutomations } = require('./run-all-automations');

// PIN-only functions called separately ONLY to collect raw data for the
// consolidated batch report detail sheets (no browser, fast HTTP calls).
const { fetchManufacturerDetails } = require('./manufacturer-details');
const { runObligationCheck } = require('./obligation-checker');
const { checkCompanyWithholdingStatus } = require('./agent-checker');

const DEFAULT_WORKER_COUNT = 10;

// ── Colour palette (matches SharedWorkbookManager template exactly) ────────────
const C = {
    TITLE_BG:  'FF4682B4',   // steel blue — SharedWorkbookManager title row
    TITLE_FG:  'FFFFFFFF',
    HEADER_BG: 'FFD3D3D3',   // light grey — SharedWorkbookManager header row
    HEADER_FG: 'FF000000',
    INFO_BG:   'FFADD8E6',   // light blue — SharedWorkbookManager company-info row
    ALT_ROW:   'FFF5F5F5',   // alternating row — SharedWorkbookManager data rows
    VALID:     'FF99FF99',   // green
    INVALID:   'FFFF9999',   // red
    FAILED:    'FFFFCC00',   // amber — ran but could not authenticate / error
    MED:       'medium',
    THN:       'thin',
};

function buildTimestamp() {
    const n = new Date();
    const p = (v) => String(v).padStart(2, '0');
    return `${n.getFullYear()}${p(n.getMonth()+1)}${p(n.getDate())}_${p(n.getHours())}${p(n.getMinutes())}${p(n.getSeconds())}`;
}

function v(value) {
    if (value === undefined || value === null || value === '') return '—';
    return String(value).replace(/\r?\n/g, ' ').trim();
}

function bdr(style = C.THN) {
    return { top: { style }, left: { style }, bottom: { style }, right: { style } };
}

// values[idx] in addDataRow lands at column chr(66+idx) because col A is the spacer
function colAt(idx) { return String.fromCharCode(66 + idx); }

// ── Normalise raw KRA validation → exactly 3 canonical values ────────────────
// Valid   = login succeeded (incl. "Pending Update" which still got through)
// Invalid = credentials rejected (wrong password, expired)
// Failed  = could not run (no password, browser / network error)
function normalizeValidationStatus(vr) {
    if (vr === undefined) return '— Not run';
    if (!vr || !vr.success) return 'Failed';
    const s = String(vr.status || '').toLowerCase().trim();
    if (s === 'valid' || s === 'pending update') return 'Valid';
    if (s === 'invalid' || s.includes('expired')) return 'Invalid';
    return 'Failed';
}

function validationColour(status) {
    if (status === 'Valid')   return C.VALID;
    if (status === 'Invalid') return C.INVALID;
    if (status === 'Failed')  return C.FAILED;
    return null;
}

function statusLabel(cd, name) {
    if (cd.successful.includes(name)) return '✓ Completed';
    const f = (cd.failed || []).find((x) => x.name === name);
    if (f) return `✗ ${(f.error || 'Failed').substring(0, 60)}`;
    return '— Not run';
}

// ── Template helpers (mirrors SharedWorkbookManager exactly) ──────────────────

function addTitleRow(ws, title, subtitle) {
    const row = ws.addRow(['', title, '', subtitle || `Generated: ${new Date().toLocaleString()}`]);
    ws.mergeCells(`B${row.number}:D${row.number}`);
    const cell = row.getCell('B');
    cell.font = { size: 14, bold: true, color: { argb: C.TITLE_FG } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.TITLE_BG } };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
    cell.border = bdr(C.MED);
    row.height = 28;
    ws.addRow([]);
    ws.addRow([]);
}

function addInfoRow(ws, totalCompanies) {
    const row = ws.addRow(['', 'Batch Companies:', String(totalCompanies), 'Report Date:', new Date().toLocaleDateString()]);
    ['B', 'C', 'D', 'E'].forEach((col) => {
        const cell = row.getCell(col);
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.INFO_BG } };
        cell.border = bdr(C.THN);
        cell.alignment = { vertical: 'middle' };
    });
    row.getCell('B').font = { bold: true };
    row.getCell('D').font = { bold: true };
    ws.addRow([]);
    ws.addRow([]);
}

function addHeaderRow(ws, headers) {
    const row = ws.addRow(['', ...headers]);
    row.height = 22;
    for (let i = 2; i <= headers.length + 1; i++) {
        const cell = row.getCell(i);
        cell.font = { bold: true, size: 11 };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.HEADER_BG } };
        cell.border = { top: { style: C.MED }, left: { style: C.THN }, bottom: { style: C.MED }, right: { style: C.THN } };
        cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    }
    return row;
}

function addDataRow(ws, values, rowIndex, cellOverrides = {}) {
    const row = ws.addRow(['', ...values]);
    row.height = 18;
    const isAlt = rowIndex % 2 === 1;
    for (let i = 2; i <= values.length + 1; i++) {
        const cell = row.getCell(i);
        if (isAlt) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.ALT_ROW } };
        cell.border = bdr(C.THN);
        cell.alignment = { vertical: 'middle', wrapText: false };
    }
    Object.entries(cellOverrides).forEach(([col, colour]) => {
        const cell = row.getCell(col);
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: colour } };
        cell.font = { bold: true };
    });
    return row;
}

function autoWidth(ws, minW = 10, maxW = 45) {
    ws.columns.forEach((col) => {
        let max = minW;
        col.eachCell({ includeEmpty: false }, (cell) => {
            const len = cell.value ? String(cell.value).length : 0;
            if (len > max) max = len;
        });
        col.width = Math.min(max + 2, maxW);
    });
}

// ── Sheet writers ─────────────────────────────────────────────────────────────

function writeSummarySheet(wb, allData, selectedAutomations) {
    const ws = wb.addWorksheet('Summary');
    addTitleRow(ws, 'BATCH RUN — FULL SUMMARY', `${allData.length} companies processed on ${new Date().toLocaleDateString()}`);
    addInfoRow(ws, allData.length);

    const headers = ['#', 'PIN', 'Company Name', 'Password'];

    if (selectedAutomations.passwordValidation) headers.push('Password Status', 'Validation Detail');
    if (selectedAutomations.manufacturerDetails) headers.push('Manufacturer Name', 'Bus Reg No.', 'Business Name', 'Reg Date', 'Phone', 'Email', 'City / Town', 'County');
    if (selectedAutomations.obligationCheck)     headers.push('PIN Status', 'iTax Status', 'Income Tax - Co.', 'VAT Obligation', 'PAYE', 'Rent MRI');
    if (selectedAutomations.agentStatus)         headers.push('VAT Agent', 'Rent Agent');
    if (selectedAutomations.directorDetails)     headers.push('Director Details');
    if (selectedAutomations.liabilities)         headers.push('Liabilities');
    if (selectedAutomations.vatReturns)          headers.push('VAT Returns');
    if (selectedAutomations.whVatReturns)        headers.push('WH VAT Returns');
    if (selectedAutomations.generalLedger)       headers.push('General Ledger');
    if (selectedAutomations.taxCompliance)       headers.push('Tax Compliance');
    if (selectedAutomations.assessmentDownloads) headers.push('Assessments');
    headers.push('Completed', 'Failed');

    addHeaderRow(ws, headers);

    allData.forEach((cd, i) => {
        const m = cd.manufacturer;
        const o = cd.obligation;
        const a = cd.agent;
        // Password at index 3 → col E (always present)
        const rowValues = [i + 1, v(cd.pin), v(cd.name), v(cd.password)];
        const overrides = {};

        if (selectedAutomations.passwordValidation) {
            const status = normalizeValidationStatus(cd.validation);
            const detail = cd.validation ? v(cd.validation.message || cd.validation.error || '—') : '—';
            const idx = rowValues.length; // 4 → col F
            rowValues.push(status, detail);
            const col = validationColour(status);
            if (col) overrides[colAt(idx)] = col;
        }

        if (selectedAutomations.manufacturerDetails) {
            rowValues.push(
                v(m?.timsManBasicRDtlDTO?.manufacturerName),
                v(m?.timsManBasicRDtlDTO?.manufacturerBrNo),
                v(m?.manBusinessRDtlDTO?.businessName),
                v(m?.manBusinessRDtlDTO?.businessRegDate),
                v(m?.manContactRDtlDTO?.mobileNo),
                v(m?.manContactRDtlDTO?.mainEmail),
                v(m?.manAddRDtlDTO?.cityTown),
                v(m?.manAddRDtlDTO?.county)
            );
        }

        if (selectedAutomations.obligationCheck) {
            rowValues.push(
                v(o?.pin_status), v(o?.itax_status),
                v(o?.income_tax_company_status), v(o?.vat_status),
                v(o?.paye_status), v(o?.rent_income_mri_status)
            );
        }

        if (selectedAutomations.agentStatus) {
            rowValues.push(
                a?.vat?.isRegistered  === true ? 'Registered' : a?.vat?.isRegistered  === false ? 'Not Registered' : '—',
                a?.rent?.isRegistered === true ? 'Registered' : a?.rent?.isRegistered === false ? 'Not Registered' : '—'
            );
        }

        if (selectedAutomations.directorDetails)     rowValues.push(statusLabel(cd, 'Director Details'));
        if (selectedAutomations.liabilities)         rowValues.push(statusLabel(cd, 'Liabilities'));
        if (selectedAutomations.vatReturns)          rowValues.push(statusLabel(cd, 'VAT Returns'));
        if (selectedAutomations.whVatReturns)        rowValues.push(statusLabel(cd, 'WH VAT Returns'));
        if (selectedAutomations.generalLedger)       rowValues.push(statusLabel(cd, 'General Ledger'));
        if (selectedAutomations.taxCompliance)       rowValues.push(statusLabel(cd, 'Tax Compliance'));
        if (selectedAutomations.assessmentDownloads) rowValues.push(statusLabel(cd, 'Assessment Downloads'));
        rowValues.push(cd.successful.length, (cd.failed || []).length);

        addDataRow(ws, rowValues, i, overrides);
    });

    autoWidth(ws, 8, 45);
    ws.getColumn(1).width = 4;   // spacer
    ws.getColumn(2).width = 5;   // #
    ws.getColumn(3).width = 16;  // PIN
    ws.getColumn(4).width = 36;  // Company Name
    ws.getColumn(5).width = 20;  // Password
    ws.views = [{ state: 'frozen', ySplit: ws.lastRow.number - allData.length }];
}

function writePasswordValidationSheet(wb, allData) {
    const relevant = allData.filter((cd) => cd.validation !== undefined);
    if (!relevant.length) return;

    const ws = wb.addWorksheet('Password Validation');
    addTitleRow(ws, 'PASSWORD VALIDATION RESULTS', `Run: ${new Date().toLocaleString()}`);
    addInfoRow(ws, relevant.length);
    addHeaderRow(ws, ['#', 'PIN', 'Company Name', 'Password', 'Status', 'Detail']);

    relevant.forEach((cd, i) => {
        // values: [#, pin, name, password, status, detail] → status at index 4 → col F
        const status = normalizeValidationStatus(cd.validation);
        const detail = cd.validation ? v(cd.validation.message || cd.validation.error || '—') : '— No password provided';
        const colour = validationColour(status);
        addDataRow(ws, [i + 1, v(cd.pin), v(cd.name), v(cd.password), status, detail], i, colour ? { [colAt(4)]: colour } : {});
    });

    autoWidth(ws, 10, 50);
    ws.getColumn(1).width = 4;
    ws.getColumn(2).width = 5;
    ws.getColumn(3).width = 16;
    ws.getColumn(4).width = 36;  // Company Name
    ws.getColumn(5).width = 20;  // Password
    ws.getColumn(6).width = 14;  // Status
    ws.getColumn(7).width = 55;  // Detail
    ws.views = [{ state: 'frozen', ySplit: ws.lastRow.number - relevant.length }];
}

function writeManufacturerSheet(wb, allData) {
    const relevant = allData.filter((cd) => cd.manufacturer);
    if (!relevant.length) return;

    const ws = wb.addWorksheet('Manufacturer Details');
    addTitleRow(ws, 'MANUFACTURER DETAILS — ALL COMPANIES');
    addInfoRow(ws, relevant.length);
    addHeaderRow(ws, [
        '#', 'PIN', 'Company Name',
        'Manufacturer Name', 'Business Reg No.', 'Business Name', 'Reg Date', 'Commence Date',
        'Phone', 'Email', 'Secondary Email',
        'Building No.', 'Street / Road', 'City / Town', 'County', 'District',
        'Tax Locality', 'Descriptive Address', 'PO Box', 'Postal Code'
    ]);

    relevant.forEach((cd, i) => {
        const m = cd.manufacturer;
        addDataRow(ws, [
            i + 1, v(cd.pin), v(cd.name),
            v(m?.timsManBasicRDtlDTO?.manufacturerName),
            v(m?.timsManBasicRDtlDTO?.manufacturerBrNo),
            v(m?.manBusinessRDtlDTO?.businessName),
            v(m?.manBusinessRDtlDTO?.businessRegDate),
            v(m?.manBusinessRDtlDTO?.businessComDate),
            v(m?.manContactRDtlDTO?.mobileNo),
            v(m?.manContactRDtlDTO?.mainEmail),
            v(m?.manContactRDtlDTO?.secondaryEmail),
            v(m?.manAddRDtlDTO?.buldgNo),
            v(m?.manAddRDtlDTO?.streetRoad),
            v(m?.manAddRDtlDTO?.cityTown),
            v(m?.manAddRDtlDTO?.county),
            v(m?.manAddRDtlDTO?.district),
            v(m?.manAddRDtlDTO?.taxAreaLocality),
            v(m?.manAddRDtlDTO?.descriptiveAddress),
            v(m?.manAddRDtlDTO?.poBox),
            v(m?.manAddRDtlDTO?.postalCode)
        ], i);
    });

    autoWidth(ws, 8, 42);
    ws.getColumn(1).width = 4; ws.getColumn(2).width = 5;
    ws.getColumn(3).width = 16; ws.getColumn(4).width = 36;
    ws.views = [{ state: 'frozen', ySplit: ws.lastRow.number - relevant.length }];
}

function writeObligationsSheet(wb, allData) {
    const relevant = allData.filter((cd) => cd.obligation);
    if (!relevant.length) return;

    const ws = wb.addWorksheet('Obligations');
    addTitleRow(ws, 'TAX OBLIGATIONS — ALL COMPANIES');
    addInfoRow(ws, relevant.length);
    addHeaderRow(ws, [
        '#', 'PIN', 'Company Name',
        'PIN Status', 'iTax Status',
        'Income Tax - Co.', 'IT Co. From', 'IT Co. To',
        'VAT', 'VAT From', 'VAT To',
        'PAYE', 'PAYE From', 'PAYE To',
        'Rent MRI', 'MRI From', 'MRI To',
        'Resident Ind.', 'Resident From', 'Resident To',
        'Turnover Tax'
    ]);

    relevant.forEach((cd, i) => {
        const o = cd.obligation;
        addDataRow(ws, [
            i + 1, v(cd.pin), v(cd.name),
            v(o?.pin_status), v(o?.itax_status),
            v(o?.income_tax_company_status), v(o?.income_tax_company_effective_from), v(o?.income_tax_company_effective_to),
            v(o?.vat_status), v(o?.vat_effective_from), v(o?.vat_effective_to),
            v(o?.paye_status), v(o?.paye_effective_from), v(o?.paye_effective_to),
            v(o?.rent_income_mri_status), v(o?.rent_income_mri_effective_from), v(o?.rent_income_mri_effective_to),
            v(o?.resident_individual_status), v(o?.resident_individual_effective_from), v(o?.resident_individual_effective_to),
            v(o?.turnover_tax_status)
        ], i);
    });

    autoWidth(ws, 8, 35);
    ws.getColumn(1).width = 4; ws.getColumn(2).width = 5;
    ws.getColumn(3).width = 16; ws.getColumn(4).width = 36;
    ws.views = [{ state: 'frozen', ySplit: ws.lastRow.number - relevant.length }];
}

function writeAgentStatusSheet(wb, allData) {
    const relevant = allData.filter((cd) => cd.agent);
    if (!relevant.length) return;

    const ws = wb.addWorksheet('Agent Status');
    addTitleRow(ws, 'WITHHOLDING AGENT STATUS — ALL COMPANIES');
    addInfoRow(ws, relevant.length);
    addHeaderRow(ws, [
        '#', 'PIN', 'Company Name',
        'VAT Agent Status', 'VAT Message',
        'Rent Agent Status', 'Rent Message',
        'Confirmed PIN', 'Taxpayer Name'
    ]);

    relevant.forEach((cd, i) => {
        const a = cd.agent;
        // values: [#, pin, name, vatStatus, vatMsg, rentStatus, ...] → vatStatus@3=E, rentStatus@5=G
        const vatStatus  = a?.vat?.isRegistered  === true ? 'Registered' : a?.vat?.isRegistered  === false ? 'Not Registered' : '—';
        const rentStatus = a?.rent?.isRegistered === true ? 'Registered' : a?.rent?.isRegistered === false ? 'Not Registered' : '—';
        const overrides = {};
        if (a?.vat?.isRegistered  === true)  overrides[colAt(3)] = C.VALID;
        if (a?.vat?.isRegistered  === false) overrides[colAt(3)] = C.INVALID;
        if (a?.rent?.isRegistered === true)  overrides[colAt(5)] = C.VALID;
        if (a?.rent?.isRegistered === false) overrides[colAt(5)] = C.INVALID;

        addDataRow(ws, [
            i + 1, v(cd.pin), v(cd.name),
            vatStatus,  v(a?.vat?.message  || a?.vat?.error),
            rentStatus, v(a?.rent?.message || a?.rent?.error),
            v(a?.vat?.details?.confirmedPin  || a?.rent?.details?.confirmedPin),
            v(a?.vat?.details?.taxpayerName  || a?.rent?.details?.taxpayerName)
        ], i, overrides);
    });

    autoWidth(ws, 10, 45);
    ws.getColumn(1).width = 4; ws.getColumn(2).width = 5;
    ws.getColumn(3).width = 16; ws.getColumn(4).width = 36;
    ws.views = [{ state: 'frozen', ySplit: ws.lastRow.number - relevant.length }];
}

function writeLoginTasksSheet(wb, allData, selectedAutomations) {
    const loginKeys = ['directorDetails', 'liabilities', 'vatReturns', 'whVatReturns', 'generalLedger', 'taxCompliance', 'assessmentDownloads'];
    const selectedLogin = loginKeys.filter((k) => selectedAutomations[k]);
    if (!selectedLogin.length) return;

    const displayNames = {
        directorDetails:     'Director Details',
        liabilities:         'Liabilities',
        vatReturns:          'VAT Returns',
        whVatReturns:        'WH VAT Returns',
        generalLedger:       'General Ledger',
        taxCompliance:       'Tax Compliance',
        assessmentDownloads: 'Assessments'
    };

    const ws = wb.addWorksheet('Login Automations');
    addTitleRow(ws, 'LOGIN-PROTECTED AUTOMATIONS — ALL COMPANIES', 'Each cell: ✓ Completed / ✗ reason / — Not run');
    addInfoRow(ws, allData.length);
    addHeaderRow(ws, ['#', 'PIN', 'Company Name', 'Has Password', ...selectedLogin.map((k) => displayNames[k])]);

    allData.forEach((cd, i) => {
        // values: [#, pin, name, hasPwd, status0, status1, ...] → status0 at index 4 = col F
        const statusValues = selectedLogin.map((key, colOffset) => {
            const label = displayNames[key];
            return { label, col: colAt(4 + colOffset), s: statusLabel(cd, label) };
        });
        const overrides = {};
        statusValues.forEach(({ col, s }) => {
            if (s.startsWith('✓')) overrides[col] = C.VALID;
            else if (s.startsWith('✗')) overrides[col] = C.INVALID;
        });
        addDataRow(ws, [i + 1, v(cd.pin), v(cd.name), cd.hasPassword ? 'Yes' : 'No', ...statusValues.map(x => x.s)], i, overrides);
    });

    autoWidth(ws, 10, 40);
    ws.getColumn(1).width = 4; ws.getColumn(2).width = 5;
    ws.getColumn(3).width = 16; ws.getColumn(4).width = 36;
    ws.views = [{ state: 'frozen', ySplit: ws.lastRow.number - allData.length }];
}

// ── Consolidated report ───────────────────────────────────────────────────────

async function writeBatchReport(allCompanyData, selectedAutomations, batchFolder, timestamp) {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'KRA POST PORTUM TOOL';
    wb.created = new Date();

    writeSummarySheet(wb, allCompanyData, selectedAutomations);

    if (selectedAutomations.passwordValidation)  writePasswordValidationSheet(wb, allCompanyData);
    if (selectedAutomations.manufacturerDetails) writeManufacturerSheet(wb, allCompanyData);
    if (selectedAutomations.obligationCheck)     writeObligationsSheet(wb, allCompanyData);
    if (selectedAutomations.agentStatus)         writeAgentStatusSheet(wb, allCompanyData);
    writeLoginTasksSheet(wb, allCompanyData, selectedAutomations);

    const reportPath = path.join(batchFolder, `BATCH_REPORT_${timestamp}.xlsx`);
    await wb.xlsx.writeFile(reportPath);
    return reportPath;
}

// ── Per-company processor ─────────────────────────────────────────────────────
// Delegates ALL automation logic to the existing runAllAutomations (creates the
// per-company workbook with SharedWorkbookManager, handles sequential/parallel
// task execution, etc.).  PIN-only data is fetched separately—in parallel with
// runAllAutomations—so the consolidated report can show detail sheets.

async function processOneCompany(company, selectedAutomations, vatDateRange, whVatDateRange, batchFolder, progressCallback) {
    const companyData = {
        pin:         company.pin,
        name:        company.name || company.pin,
        password:    company.password || '',
        hasPassword: Boolean(company.password),
        validation:  undefined,
        manufacturer: null,
        obligation:   null,
        agent:        null,
        successful:   [],
        failed:       []
    };

    const cb = (d) => progressCallback({ ...d, stage: `${company.pin}${d.stage ? ' › ' + d.stage : ''}` });

    // ── Collect PIN-only raw data for batch report detail sheets ──────────────
    // These are fast HTTP calls (no browser). We run them concurrently with the
    // full automation suite to avoid adding extra wall-clock time.
    const pinFetches = [];

    if (selectedAutomations?.manufacturerDetails) {
        pinFetches.push(
            fetchManufacturerDetails(company, () => {})
                .then((r) => { if (r?.success && r.data) companyData.manufacturer = r.data; })
                .catch(() => {})
        );
    }
    if (selectedAutomations?.obligationCheck) {
        pinFetches.push(
            runObligationCheck(company, () => {})
                .then((r) => { if (r?.success && r.data) companyData.obligation = r.data; })
                .catch(() => {})
        );
    }
    if (selectedAutomations?.agentStatus) {
        pinFetches.push(
            checkCompanyWithholdingStatus(company, null, () => {})
                .then((r) => { if (r?.success && r.data) companyData.agent = r.data; })
                .catch(() => {})
        );
    }

    // ── Run all automations (exactly as single-company Run All does) ──────────
    // runAllAutomations creates the per-company workbook inside batchFolder via
    // SharedWorkbookManager (→ batchFolder/PIN_CompanyName/) and handles every
    // task in the same sequential/parallel order as single-company mode.
    const [allResult] = await Promise.allSettled([
        runAllAutomations(company, selectedAutomations, vatDateRange, whVatDateRange, batchFolder, cb),
        ...pinFetches
    ]);

    if (allResult.status === 'fulfilled' && allResult.value?.results) {
        companyData.successful = allResult.value.results.successful || [];
        companyData.failed     = allResult.value.results.failed     || [];
    } else {
        const err = allResult.reason?.message || 'Unexpected error';
        companyData.failed = [{ name: 'All Automations', error: err }];
    }

    // ── Derive the normalised validation status for the consolidated report ───
    // runAllAutomations doesn't return the raw validation object, so we reconstruct
    // it from the success/failed lists that it does return.
    if (selectedAutomations?.passwordValidation) {
        if (companyData.successful.includes('Password Validation')) {
            companyData.validation = { success: true, status: 'Valid', message: 'Login successful' };
        } else {
            const entry = companyData.failed.find((f) => f.name === 'Password Validation');
            companyData.validation = {
                success: false,
                status: company.password ? 'Invalid' : 'Failed',
                message: entry?.error || (company.password ? 'Invalid credentials' : 'No password provided')
            };
        }
    }

    return companyData;
}

// ── Main batch runner ─────────────────────────────────────────────────────────

async function runBatchFullAutomations(companies, selectedAutomations, vatDateRange, whVatDateRange, downloadPath, workerCount, progressCallback = () => {}) {
    if (!companies?.length) return { success: false, error: 'No companies provided.' };

    const timestamp = buildTimestamp();
    const batchFolder = path.join(downloadPath, `BATCH_${timestamp}`);
    await fs.mkdir(batchFolder, { recursive: true });

    const total = companies.length;
    const resolvedWorkers = Math.max(1, Math.min(Math.round(workerCount) || DEFAULT_WORKER_COUNT, total));
    let nextIndex = 0;
    let completedCount = 0;
    const companyResults = new Array(total).fill(null);

    progressCallback({
        stage: 'Batch',
        message: `Starting batch — ${total} compan${total === 1 ? 'y' : 'ies'}, ${resolvedWorkers} worker${resolvedWorkers === 1 ? '' : 's'}`,
        log: `BATCH FULL RUN: ${total} companies, ${resolvedWorkers} workers`,
        percentage: 0
    });

    const worker = async () => {
        while (true) {
            const i = nextIndex++;
            if (i >= total) return;

            const company = companies[i];
            const label = company.name ? `${company.pin} — ${company.name}` : company.pin;

            progressCallback({
                stage: 'Batch',
                message: `Processing ${i + 1}/${total}: ${label}`,
                log: `── ${i + 1}/${total}: ${label} ──`,
                percentage: Math.round((i / total) * 90)
            });

            const result = await processOneCompany(company, selectedAutomations, vatDateRange, whVatDateRange, batchFolder, progressCallback);
            companyResults[i] = result;
            completedCount++;

            const ok   = result.successful.length;
            const fail = result.failed.length;
            progressCallback({
                stage: 'Batch',
                message: `${company.pin}: ${ok} completed${fail ? `, ${fail} failed/skipped` : ''}`,
                log: `  ✓ ${company.pin}: ${ok} ok${fail ? `, ${fail} issue(s)` : ''}`,
                percentage: Math.round((completedCount / total) * 90)
            });
        }
    };

    await Promise.all(Array.from({ length: resolvedWorkers }, () => worker()));

    progressCallback({ stage: 'Batch', message: 'Writing consolidated batch report…', log: 'Writing BATCH_REPORT…', percentage: 93 });

    const filtered = companyResults.filter(Boolean);
    const reportPath = await writeBatchReport(filtered, selectedAutomations, batchFolder, timestamp);

    progressCallback({
        stage: 'Batch',
        message: `Done. Report: ${path.basename(reportPath)}`,
        log: `BATCH REPORT saved → ${reportPath}`,
        percentage: 100
    });

    return {
        success:    true,
        companies:  total,
        succeeded:  filtered.filter((c) => c.successful.length > 0).length,
        reportPath,
        downloadPath: batchFolder
    };
}

module.exports = { runBatchFullAutomations };
