const path = require('path');
const { extractAssessmentDetails } = require('./assessment-details-extractor');

async function loadAssessmentModule() {
    return import('./assessment-downloads/index.mjs');
}

async function loadAutomationConfig() {
    return import('../lib/automation-config.mjs');
}

function normalizeCompany(company = {}) {
    return {
        ...company,
        pin: company.pin || company.kraPin || company.kra_pin,
        password: company.password || company.kraPassword || company.kra_password,
        name: company.name || company.companyName || company.company_name || company.pin || 'Unknown Company',
        id: company.id || company.companyId || company.company_id || company.pin
    };
}

function collectDownloadedFiles(result) {
    const files = [];

    for (const group of result?.results || []) {
        for (const download of group.downloads || []) {
            if (download?.filePath) {
                files.push(download.filePath);
            }
        }
    }

    return files;
}

function collectSummaryOutputDir(result, fallbackDownloadPath) {
    const firstFile = collectDownloadedFiles(result)[0];
    if (firstFile) {
        return path.dirname(firstFile);
    }

    return result?.downloadPath || fallbackDownloadPath || process.cwd();
}

function applyExtractedFileNames(result, extractedDetails = []) {
    const renamedByOriginalPath = new Map();

    extractedDetails.forEach((detail) => {
        if (detail.original_file_path && detail.file_path && detail.original_file_path !== detail.file_path) {
            renamedByOriginalPath.set(detail.original_file_path, detail.file_path);
        }
    });

    if (!renamedByOriginalPath.size) {
        return result;
    }

    for (const group of result?.results || []) {
        for (const download of group.downloads || []) {
            const newPath = renamedByOriginalPath.get(download.filePath);
            if (newPath) {
                download.filePath = newPath;
                download.fileName = path.basename(newPath);
            }
        }

        for (const row of group.excelData || []) {
            const newPath = renamedByOriginalPath.get(row.filePath);
            if (newPath) {
                row.filePath = newPath;
                row.fileName = path.basename(newPath);
            }
        }
    }

    return result;
}

function normalizeList(value) {
    if (!value) return undefined;
    return Array.isArray(value) ? value : [value];
}

async function runAssessmentDownloads(company, options = {}, downloadPath, progressCallback = () => {}) {
    const normalizedCompany = normalizeCompany(company);

    if (!normalizedCompany.pin || !normalizedCompany.password) {
        return {
            success: false,
            error: 'Assessment downloads require both the KRA PIN and password.'
        };
    }

    try {
        const [{ runAssessmentDownloadLocalOnly }, { resolveAutomationSettings }] = await Promise.all([
            loadAssessmentModule(),
            loadAutomationConfig()
        ]);
        const settings = resolveAutomationSettings({
            headless: options.headless ?? normalizedCompany.headless ?? normalizedCompany.browserSettings?.headless,
            slowMo: options.slowMo ?? normalizedCompany.browserSettings?.slowMo
        });

        const result = await runAssessmentDownloadLocalOnly({
            pin: normalizedCompany.pin,
            password: normalizedCompany.password,
            companyId: normalizedCompany.id,
            companyName: normalizedCompany.name,
            subProcesses: normalizeList(options.subProcesses || options.subProcess),
            obligations: normalizeList(options.obligations || options.obligation),
            headless: settings.headless,
            slowMo: settings.slowMo,
            downloadPath,
            jobId: options.jobId || `assessment-${Date.now()}`,
            progressCallback
        });

        const downloadedFiles = collectDownloadedFiles(result);
        let extraction = {
            results: [],
            files: []
        };

        if (downloadedFiles.length) {
            progressCallback({
                stage: 'Assessment Extraction',
                message: 'Extracting details from downloaded assessment PDFs...',
                progress: 0
            });

            extraction = await extractAssessmentDetails({
                pdfFiles: downloadedFiles,
                outputDir: collectSummaryOutputDir(result, downloadPath),
                renameWithTitle: true,
                progressCallback
            });

            applyExtractedFileNames(result, extraction.results);
        }

        const finalPdfFiles = extraction.results?.length
            ? extraction.results.map((detail) => detail.file_path).filter(Boolean)
            : collectDownloadedFiles(result);

        return {
            ...result,
            files: [...(extraction.files || []), ...finalPdfFiles],
            summaryFiles: extraction.files || [],
            extractedDetails: extraction.results || [],
            data: result.results || []
        };
    } catch (error) {
        return {
            success: false,
            error: error.message
        };
    }
}

module.exports = {
    runAssessmentDownloads
};
