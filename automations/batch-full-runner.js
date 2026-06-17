const ExcelJS = require('exceljs');
const path = require('path');
const fs = require('fs').promises;

const { validateKRACredentials } = require('./password-validation');
const { fetchManufacturerDetails } = require('./manufacturer-details');
const { runObligationCheck } = require('./obligation-checker');
const { checkCompanyWithholdingStatus } = require('./agent-checker');
const { runDirectorDetailsExtraction } = require('./director-details-extraction');
const { runLiabilitiesExtraction } = require('./liabilities-extraction');
const { runVATExtraction } = require('./vat-extraction');
const { runWhVatExtraction } = require('./wh-vat-extraction');
const { runLedgerExtraction } = require('./ledger-extraction');
const { runTCCDownloader } = require('./tax-compliance-downloader');
const { runAssessmentDownloads } = require('./assessment-downloads');

const DEFAULT_WORKER_COUNT = 10;

const HEADER_BG  = 'FFBE123C';
const HEADER_FG  = 'FFFFFFFF';
const ROW_ALT    = 'FFFFF1F2';
const FROZEN_BG  = 'FFF3F4F6';

function buildTimestamp() {
    const n = new Date();
    const p = (v) => String(v).padStart(2, '0');
    return `${n.getFullYear()}${p(n.getMonth() + 1)}${p(n.getDate())}_${p(n.getHours())}${p(n.getMinutes())}${p(n.getSeconds())}`;
}

function val(v) {
    if (v === undefined || v === null || v === '') return '—';
    return String(v).replace(/\n/g, ' ').trim();
}

function statusLabel(companyData, automationName) {
    if (companyData.successful.includes(automationName)) return '✓ Completed';
    const fail = (companyData.failed || []).find((f) => f.name === automationName);
    if (fail) {
        const msg = (fail.error || 'Failed').substring(0, 50);
        return `✗ ${msg}`;
    }
    return '— Not run';
}

function applyHeaderRow(ws, headers) {
    const row = ws.addRow(headers);
    row.height = 28;
    row.font = { bold: true, color: { argb: HEADER_FG }, size: 11 };
    row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_BG } };
    row.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    row.eachCell((cell) => {
        cell.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'medium' }, right: { style: 'thin' } };
    });
    return row;
}

function addDataRow(ws, values, rowIndex) {
    const row = ws.addRow(values);
    row.height = 18;
    if (rowIndex % 2 === 0) {
        row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ROW_ALT } };
    }
    row.eachCell((cell) => {
        cell.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
        cell.alignment = { vertical: 'middle', wrapText: false };
    });
    return row;
}

function autoWidth(ws, minWidth = 10, maxWidth = 45) {
    ws.columns.forEach((col, i) => {
        let max = minWidth;
        col.eachCell({ includeEmpty: false }, (cell) => {
            const len = cell.value ? String(cell.value).length : 0;
            if (len > max) max = len;
        });
        col.width = Math.min(max + 2, maxWidth);
    });
}

async function writeBatchReport(allCompanyData, selectedAutomations, batchFolder, timestamp) {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'KRA POST PORTUM TOOL';
    wb.created = new Date();

    // ── Sheet 1: Summary ──────────────────────────────────────────────────────
    const ss = wb.addWorksheet('Summary');

    const summaryHeaders = [
        '#', 'PIN', 'Company Name',
        'Manufacturer Name', 'Bus. Reg No.', 'Business Name', 'Reg Date',
        'Phone', 'Email', 'City / Town', 'County',
        'PIN Status', 'iTax Status',
        'Income Tax - Co.', 'VAT Obligation', 'VAT Eff. From', 'VAT Eff. To',
        'PAYE', 'Rent MRI', 'Resident Ind.', 'Turnover Tax',
        'VAT Agent', 'Rent Agent',
        'Password Validation', 'Director Details', 'Liabilities',
        'VAT Returns', 'WH VAT', 'General Ledger', 'TCC', 'Assessments',
        'Completed', 'Failed'
    ];

    applyHeaderRow(ss, summaryHeaders);

    allCompanyData.forEach((cd, i) => {
        const m = cd.manufacturer;
        const o = cd.obligation;
        const a = cd.agent;

        addDataRow(ss, [
            i + 1,
            val(cd.pin),
            val(cd.name),
            val(m?.timsManBasicRDtlDTO?.manufacturerName),
            val(m?.timsManBasicRDtlDTO?.manufacturerBrNo),
            val(m?.manBusinessRDtlDTO?.businessName),
            val(m?.manBusinessRDtlDTO?.businessRegDate),
            val(m?.manContactRDtlDTO?.mobileNo),
            val(m?.manContactRDtlDTO?.mainEmail),
            val(m?.manAddRDtlDTO?.cityTown),
            val(m?.manAddRDtlDTO?.county),
            val(o?.pin_status),
            val(o?.itax_status),
            val(o?.income_tax_company_status),
            val(o?.vat_status),
            val(o?.vat_effective_from),
            val(o?.vat_effective_to),
            val(o?.paye_status),
            val(o?.rent_income_mri_status),
            val(o?.resident_individual_status),
            val(o?.turnover_tax_status),
            a?.vat?.isRegistered === true ? 'Registered' : a?.vat?.isRegistered === false ? 'Not Registered' : '—',
            a?.rent?.isRegistered === true ? 'Registered' : a?.rent?.isRegistered === false ? 'Not Registered' : '—',
            statusLabel(cd, 'Password Validation'),
            statusLabel(cd, 'Director Details'),
            statusLabel(cd, 'Liabilities'),
            statusLabel(cd, 'VAT Returns'),
            statusLabel(cd, 'WH VAT Returns'),
            statusLabel(cd, 'General Ledger'),
            statusLabel(cd, 'Tax Compliance'),
            statusLabel(cd, 'Assessment Downloads'),
            cd.successful.length,
            (cd.failed || []).length
        ], i);
    });

    autoWidth(ss, 8, 45);
    ss.getColumn(1).width = 5;
    ss.getColumn(2).width = 16;
    ss.getColumn(3).width = 36;
    ss.views = [{ state: 'frozen', ySplit: 1 }];

    // ── Sheet 2: Manufacturer Details ─────────────────────────────────────────
    if (selectedAutomations?.manufacturerDetails) {
        const ms = wb.addWorksheet('Manufacturer Details');
        applyHeaderRow(ms, [
            '#', 'PIN', 'Company Name',
            'Manufacturer Name', 'BR No.', 'Business Name', 'Reg Date', 'Commence Date',
            'Phone', 'Email', 'Secondary Email',
            'Building', 'Street', 'City / Town', 'County', 'District',
            'Tax Locality', 'Descriptive Address', 'PO Box', 'Postal Code'
        ]);
        allCompanyData.forEach((cd, i) => {
            const m = cd.manufacturer;
            addDataRow(ms, [
                i + 1, val(cd.pin), val(cd.name),
                val(m?.timsManBasicRDtlDTO?.manufacturerName),
                val(m?.timsManBasicRDtlDTO?.manufacturerBrNo),
                val(m?.manBusinessRDtlDTO?.businessName),
                val(m?.manBusinessRDtlDTO?.businessRegDate),
                val(m?.manBusinessRDtlDTO?.businessComDate),
                val(m?.manContactRDtlDTO?.mobileNo),
                val(m?.manContactRDtlDTO?.mainEmail),
                val(m?.manContactRDtlDTO?.secondaryEmail),
                val(m?.manAddRDtlDTO?.buldgNo),
                val(m?.manAddRDtlDTO?.streetRoad),
                val(m?.manAddRDtlDTO?.cityTown),
                val(m?.manAddRDtlDTO?.county),
                val(m?.manAddRDtlDTO?.district),
                val(m?.manAddRDtlDTO?.taxAreaLocality),
                val(m?.manAddRDtlDTO?.descriptiveAddress),
                val(m?.manAddRDtlDTO?.poBox),
                val(m?.manAddRDtlDTO?.postalCode)
            ], i);
        });
        autoWidth(ms, 8, 40);
        ms.views = [{ state: 'frozen', ySplit: 1 }];
    }

    // ── Sheet 3: Obligations ──────────────────────────────────────────────────
    if (selectedAutomations?.obligationCheck) {
        const os = wb.addWorksheet('Obligations');
        applyHeaderRow(os, [
            '#', 'PIN', 'Company Name',
            'PIN Status', 'iTax Status',
            'Income Tax - Co.', 'VAT', 'VAT From', 'VAT To',
            'PAYE', 'PAYE From', 'PAYE To',
            'Rent MRI', 'MRI From', 'MRI To',
            'Resident Ind.', 'Resident From', 'Resident To',
            'Turnover Tax'
        ]);
        allCompanyData.forEach((cd, i) => {
            const o = cd.obligation;
            addDataRow(os, [
                i + 1, val(cd.pin), val(cd.name),
                val(o?.pin_status),
                val(o?.itax_status),
                val(o?.income_tax_company_status),
                val(o?.vat_status),
                val(o?.vat_effective_from),
                val(o?.vat_effective_to),
                val(o?.paye_status),
                val(o?.paye_effective_from),
                val(o?.paye_effective_to),
                val(o?.rent_income_mri_status),
                val(o?.rent_income_mri_effective_from),
                val(o?.rent_income_mri_effective_to),
                val(o?.resident_individual_status),
                val(o?.resident_individual_effective_from),
                val(o?.resident_individual_effective_to),
                val(o?.turnover_tax_status)
            ], i);
        });
        autoWidth(os, 8, 35);
        os.views = [{ state: 'frozen', ySplit: 1 }];
    }

    // ── Sheet 4: Agent Status ─────────────────────────────────────────────────
    if (selectedAutomations?.agentStatus) {
        const as = wb.addWorksheet('Agent Status');
        applyHeaderRow(as, [
            '#', 'PIN', 'Company Name',
            'VAT Agent', 'VAT Message',
            'Rent Agent', 'Rent Message',
            'Confirmed PIN', 'Taxpayer Name'
        ]);
        allCompanyData.forEach((cd, i) => {
            const a = cd.agent;
            addDataRow(as, [
                i + 1, val(cd.pin), val(cd.name),
                a?.vat?.isRegistered === true ? 'Registered' : a?.vat?.isRegistered === false ? 'Not Registered' : '—',
                val(a?.vat?.message || a?.vat?.error),
                a?.rent?.isRegistered === true ? 'Registered' : a?.rent?.isRegistered === false ? 'Not Registered' : '—',
                val(a?.rent?.message || a?.rent?.error),
                val(a?.vat?.details?.confirmedPin || a?.rent?.details?.confirmedPin),
                val(a?.vat?.details?.taxpayerName || a?.rent?.details?.taxpayerName)
            ], i);
        });
        autoWidth(as, 8, 40);
        as.views = [{ state: 'frozen', ySplit: 1 }];
    }

    const reportPath = path.join(batchFolder, `BATCH_REPORT_${timestamp}.xlsx`);
    await wb.xlsx.writeFile(reportPath);
    return reportPath;
}

async function processOneCompany(company, selectedAutomations, vatDateRange, whVatDateRange, batchFolder, progressCallback) {
    const companyData = {
        pin: company.pin,
        name: company.name || company.pin,
        manufacturer: null,
        obligation: null,
        agent: null,
        successful: [],
        failed: []
    };

    const cb = (d) => progressCallback({ ...d, stage: `${company.pin}${d.stage ? ': ' + d.stage : ''}` });
    const push = (name, ok, err) => ok ? companyData.successful.push(name) : companyData.failed.push({ name, error: err || 'Failed' });

    // ── PIN-only tasks (run in parallel) ──────────────────────────────────────
    const pinTasks = [];

    if (selectedAutomations?.manufacturerDetails) {
        pinTasks.push(async () => {
            try {
                const r = await fetchManufacturerDetails(company, cb);
                if (r?.success && r.data) { companyData.manufacturer = r.data; push('Manufacturer Details', true); }
                else push('Manufacturer Details', false, r?.error);
            } catch (e) { push('Manufacturer Details', false, e.message); }
        });
    }

    if (selectedAutomations?.obligationCheck) {
        pinTasks.push(async () => {
            try {
                const r = await runObligationCheck(company, cb);
                if (r?.success && r.data) { companyData.obligation = r.data; push('Obligation Check', true); }
                else push('Obligation Check', false, r?.error);
            } catch (e) { push('Obligation Check', false, e.message); }
        });
    }

    if (selectedAutomations?.agentStatus) {
        pinTasks.push(async () => {
            try {
                const r = await checkCompanyWithholdingStatus(company, null, cb);
                if (r?.success && r.data) { companyData.agent = r.data; push('Agent Status', true); }
                else push('Agent Status', false, r?.error);
            } catch (e) { push('Agent Status', false, e.message); }
        });
    }

    await Promise.allSettled(pinTasks.map((t) => t()));

    // ── Login tasks (run sequentially per company) ─────────────────────────────
    const hasPassword = Boolean(company.password);
    const passwordRequired = ['passwordValidation', 'directorDetails', 'liabilities', 'vatReturns', 'whVatReturns', 'generalLedger', 'taxCompliance', 'assessmentDownloads'];
    const loginDisplayNames = {
        passwordValidation: 'Password Validation',
        directorDetails: 'Director Details',
        liabilities: 'Liabilities',
        vatReturns: 'VAT Returns',
        whVatReturns: 'WH VAT Returns',
        generalLedger: 'General Ledger',
        taxCompliance: 'Tax Compliance',
        assessmentDownloads: 'Assessment Downloads'
    };

    if (!hasPassword) {
        passwordRequired.forEach((key) => {
            if (selectedAutomations?.[key]) push(loginDisplayNames[key], false, 'No password provided');
        });
        return companyData;
    }

    const loginSequence = [];

    if (selectedAutomations?.passwordValidation) {
        loginSequence.push(async () => {
            try {
                const r = await validateKRACredentials(company.pin, company.password, company.name, cb, company);
                push('Password Validation', Boolean(r?.success), r?.error || r?.message);
            } catch (e) { push('Password Validation', false, e.message); }
        });
    }

    if (selectedAutomations?.directorDetails) {
        loginSequence.push(async () => {
            try {
                const r = await runDirectorDetailsExtraction(company, batchFolder, cb);
                push('Director Details', Boolean(r?.success), r?.error);
            } catch (e) { push('Director Details', false, e.message); }
        });
    }

    if (selectedAutomations?.liabilities) {
        loginSequence.push(async () => {
            try {
                const r = await runLiabilitiesExtraction(company, batchFolder, cb);
                push('Liabilities', Boolean(r?.success), r?.error);
            } catch (e) { push('Liabilities', false, e.message); }
        });
    }

    if (selectedAutomations?.vatReturns) {
        loginSequence.push(async () => {
            try {
                const r = await runVATExtraction(company, vatDateRange || { type: 'all' }, batchFolder, cb);
                push('VAT Returns', Boolean(r?.success), r?.error);
            } catch (e) { push('VAT Returns', false, e.message); }
        });
    }

    if (selectedAutomations?.whVatReturns) {
        loginSequence.push(async () => {
            try {
                const r = await runWhVatExtraction(company, whVatDateRange || { type: 'all' }, batchFolder, cb);
                push('WH VAT Returns', Boolean(r?.success), r?.error);
            } catch (e) { push('WH VAT Returns', false, e.message); }
        });
    }

    if (selectedAutomations?.generalLedger) {
        loginSequence.push(async () => {
            try {
                const r = await runLedgerExtraction(company, batchFolder, cb);
                push('General Ledger', Boolean(r?.success), r?.error);
            } catch (e) { push('General Ledger', false, e.message); }
        });
    }

    if (selectedAutomations?.taxCompliance) {
        loginSequence.push(async () => {
            try {
                const r = await runTCCDownloader(company, batchFolder, cb);
                push('Tax Compliance', Boolean(r?.success), r?.error);
            } catch (e) { push('Tax Compliance', false, e.message); }
        });
    }

    if (selectedAutomations?.assessmentDownloads) {
        loginSequence.push(async () => {
            try {
                const r = await runAssessmentDownloads(company, {}, batchFolder, cb);
                push('Assessment Downloads', Boolean(r?.success), r?.error);
            } catch (e) { push('Assessment Downloads', false, e.message); }
        });
    }

    for (const task of loginSequence) {
        await task();
    }

    return companyData;
}

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
        message: `Starting batch run for ${total} companies with ${resolvedWorkers} parallel worker${resolvedWorkers === 1 ? '' : 's'}...`,
        log: `BATCH FULL RUN — ${total} companies, ${resolvedWorkers} workers`,
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

            const ok = result.successful.length;
            const fail = result.failed.length;
            progressCallback({
                stage: 'Batch',
                message: `${company.pin}: ${ok} completed${fail ? `, ${fail} failed` : ''}`,
                log: `  ✓ ${company.pin}: ${ok} ok${fail ? `, ${fail} failed` : ''}`,
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
        message: `Done. Report saved: ${path.basename(reportPath)}`,
        log: `BATCH REPORT saved → ${reportPath}`,
        percentage: 100
    });

    const succeeded = filtered.filter((c) => c.successful.length > 0).length;

    return {
        success: true,
        companies: total,
        succeeded,
        reportPath,
        downloadPath: batchFolder
    };
}

module.exports = { runBatchFullAutomations };
