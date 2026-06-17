const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const ExcelJS = require('exceljs');
const { execFileSync } = require('child_process');

let commandCache = new Map();

function commandExists(command) {
    if (commandCache.has(command)) {
        return commandCache.get(command);
    }

    try {
        const lookupCommand = process.platform === 'win32' ? 'where.exe' : 'which';
        execFileSync(lookupCommand, [command], { stdio: 'ignore' });
        commandCache.set(command, true);
        return true;
    } catch {
        commandCache.set(command, false);
        return false;
    }
}

function findPdfs(dir) {
    if (!dir || !fs.existsSync(dir)) {
        return [];
    }

    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const pdfs = [];

    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            pdfs.push(...findPdfs(fullPath));
        } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.pdf')) {
            pdfs.push(fullPath);
        }
    }

    return pdfs;
}

function decodePdfString(value) {
    return value
        .replace(/\\([nrtbf()\\])/g, (_match, char) => {
            const escapes = {
                n: '\n',
                r: '\r',
                t: '\t',
                b: '\b',
                f: '\f',
                '(': '(',
                ')': ')',
                '\\': '\\'
            };
            return escapes[char] || char;
        })
        .replace(/\\([0-7]{1,3})/g, (_match, octal) => String.fromCharCode(parseInt(octal, 8)));
}

function extractEmbeddedPdfText(filePath) {
    const raw = fs.readFileSync(filePath);
    const pdf = raw.toString('latin1');
    const textParts = [];
    const streamPattern = /stream\r?\n([\s\S]*?)\r?\nendstream/g;

    for (const match of pdf.matchAll(streamPattern)) {
        let stream;
        try {
            stream = zlib.inflateSync(Buffer.from(match[1], 'latin1')).toString('latin1');
        } catch {
            continue;
        }

        for (const textMatch of stream.matchAll(/\((?:\\.|[^\\()])*\)\s*Tj/g)) {
            const token = textMatch[0];
            textParts.push(decodePdfString(token.slice(1, token.lastIndexOf(')'))));
        }

        for (const arrayMatch of stream.matchAll(/\[((?:\s*(?:\((?:\\.|[^\\()])*\)|-?\d+(?:\.\d+)?)\s*)+)\]\s*TJ/g)) {
            for (const item of arrayMatch[1].matchAll(/\((?:\\.|[^\\()])*\)/g)) {
                textParts.push(decodePdfString(item[0].slice(1, -1)));
            }
        }
    }

    return textParts.join('\n');
}

function extractWithTesseract(filePath) {
    if (!commandExists('tesseract')) {
        return '';
    }

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kra-ocr-'));

    try {
        if (commandExists('pdftoppm')) {
            const imagePrefix = path.join(tempDir, 'page');
            execFileSync('pdftoppm', ['-png', '-r', '300', filePath, imagePrefix], { stdio: 'ignore' });

            return fs
                .readdirSync(tempDir)
                .filter((name) => name.toLowerCase().endsWith('.png'))
                .sort()
                .map((name) => execFileSync('tesseract', [path.join(tempDir, name), 'stdout', '-l', 'eng'], { encoding: 'utf8' }))
                .join('\n');
        }

        if (commandExists('magick')) {
            const imagePath = path.join(tempDir, 'page.png');
            execFileSync('magick', ['-density', '300', filePath, '-quality', '100', imagePath], { stdio: 'ignore' });
            return execFileSync('tesseract', [imagePath, 'stdout', '-l', 'eng'], { encoding: 'utf8' });
        }

        return '';
    } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
    }
}

function normalizeWhitespace(text) {
    return text
        .replace(/[“”]/g, '"')
        .replace(/[’]/g, "'")
        .replace(/\r/g, '\n')
        .replace(/[ \t]+/g, ' ')
        .replace(/\n{2,}/g, '\n')
        .trim();
}

function cleanAmount(value) {
    if (!value) {
        return '0.00';
    }

    const number = value.replace(/[^\d.-]/g, '');
    if (!number || Number.isNaN(Number(number))) {
        return '0.00';
    }

    return Number(number).toFixed(2);
}

function lineAfter(lines, labelPattern) {
    const index = lines.findIndex((line) => labelPattern.test(line));
    if (index === -1) {
        return '';
    }

    return lines.slice(index + 1).find((line) => line.trim()) || '';
}

function extractAmount(lines, labels) {
    const liabilityIndex = lines.findIndex((line) => /liability details/i.test(line));
    if (liabilityIndex !== -1) {
        const dueDateIndex = lines.findIndex((line, index) => index > liabilityIndex && /due date/i.test(line));
        const totalLabelIndex = lines.findIndex((line, index) => (
            index > liabilityIndex
            && (dueDateIndex === -1 || index < dueDateIndex)
            && /total incremental liability|total liability|total amount/i.test(line)
        ));

        if (totalLabelIndex !== -1 && dueDateIndex !== -1) {
            const amountLabels = lines
                .slice(liabilityIndex + 1, dueDateIndex)
                .filter((line) => /\(ksh\)|amount|payable|liability|penalty|fine|interest/i.test(line));
            const targetOffset = amountLabels.findIndex((line) => /total incremental liability|total liability|total amount/i.test(line));
            const amountsAfterDueDate = lines
                .slice(dueDateIndex + 1, dueDateIndex + 12)
                .map((line) => line.match(/\d[\d,]*\.\d{2}/))
                .filter(Boolean);

            if (targetOffset !== -1 && amountsAfterDueDate[targetOffset]) {
                return cleanAmount(amountsAfterDueDate[targetOffset][0]);
            }
        }
    }

    for (const label of labels) {
        const index = lines.findIndex((line) => label.test(line));
        if (index === -1) {
            continue;
        }

        const nearby = lines.slice(index + 1, index + 8);
        const amount = nearby.find((line) => /\d[\d,]*\.\d{2}/.test(line));
        if (amount) {
            return cleanAmount(amount.match(/\d[\d,]*\.\d{2}/)[0]);
        }
    }

    const allAmounts = lines
        .map((line) => line.match(/\d[\d,]*\.\d{2}/))
        .filter(Boolean)
        .map((match) => cleanAmount(match[0]));

    return allAmounts.length ? allAmounts[allAmounts.length - 1] : '0.00';
}

function parseKraDetails(text) {
    const normalized = normalizeWhitespace(text);
    const lines = normalized.split('\n').map((line) => line.trim()).filter(Boolean);
    const flat = lines.join(' ');

    const titleCandidates = [
        'e-Return Acknowledgment Receipt',
        'Payment Defaulter Notice',
        'Payment Slip',
        'Assessment Order',
        'PIN Certificate',
        'Tax Compliance Certificate',
        'Withholding Certificate'
    ];

    const documentTitle = titleCandidates.find((title) => new RegExp(title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(flat))
        || lines.find((line) => /receipt|notice|slip|assessment order|certificate/i.test(line))
        || 'Unknown_Document';

    let periodFrom = lineAfter(lines, /^from:?$/i);
    let periodTo = lineAfter(lines, /^to:?$/i);

    const periodRange = flat.match(/(\d{2}\/\d{2}\/\d{4})\s*[-–]\s*(\d{2}\/\d{2}\/\d{4})/);
    if ((!periodFrom || !periodTo) && periodRange) {
        periodFrom = periodFrom || periodRange[1];
        periodTo = periodTo || periodRange[2];
    }

    const totalAmount = extractAmount(lines, [
        /total amount to be paid/i,
        /net tax payable/i,
        /total tax obligation/i,
        /total incremental liability/i,
        /total liability/i,
        /amount payable/i,
        /payment amount/i
    ]);

    return {
        document_title: documentTitle,
        period_from: periodFrom || 'NA',
        period_to: periodTo || 'NA',
        total_amount: totalAmount
    };
}

function extractDetails(filePath) {
    const ocrText = extractWithTesseract(filePath);
    const text = ocrText.trim() || extractEmbeddedPdfText(filePath);
    const details = parseKraDetails(text);

    return {
        original_file_path: filePath,
        file_path: filePath,
        file_name: path.basename(filePath),
        folder: path.basename(path.dirname(filePath)),
        ...details,
        extraction_method: ocrText.trim() ? 'ocr-tesseract' : 'embedded-pdf-text',
        extraction_timestamp: new Date().toISOString()
    };
}

function sanitizeFileNamePart(value, fallback = 'Assessment_Document') {
    const sanitized = String(value || fallback)
        .replace(/[<>:"/\\|?*\x00-\x1F]/g, ' ')
        .replace(/\s+/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 80);

    return sanitized || fallback;
}

function uniqueFilePath(filePath) {
    if (!fs.existsSync(filePath)) {
        return filePath;
    }

    const dir = path.dirname(filePath);
    const ext = path.extname(filePath);
    const base = path.basename(filePath, ext);

    for (let index = 2; index < 1000; index++) {
        const candidate = path.join(dir, `${base}_${index}${ext}`);
        if (!fs.existsSync(candidate)) {
            return candidate;
        }
    }

    return path.join(dir, `${base}_${Date.now()}${ext}`);
}

function renamePdfWithTitle(result) {
    const currentPath = result.file_path;
    if (!currentPath || !fs.existsSync(currentPath)) {
        return result;
    }

    const dir = path.dirname(currentPath);
    const ext = path.extname(currentPath) || '.pdf';
    const originalBase = path.basename(currentPath, ext);
    const titlePart = sanitizeFileNamePart(result.document_title);

    if (originalBase.toLowerCase().startsWith(titlePart.toLowerCase())) {
        return result;
    }

    const newPath = uniqueFilePath(path.join(dir, `${titlePart}_${originalBase}${ext}`));

    try {
        fs.renameSync(currentPath, newPath);
        return {
            ...result,
            file_path: newPath,
            file_name: path.basename(newPath)
        };
    } catch {
        return result;
    }
}

function csvEscape(value) {
    const text = String(value ?? '');
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function writeJsonAndCsv(results, outputDir) {
    const jsonOutput = path.join(outputDir, 'assessment_extracted_details.json');
    const csvOutput = path.join(outputDir, 'assessment_extracted_details.csv');

    fs.writeFileSync(jsonOutput, `${JSON.stringify(results, null, 2)}\n`);

    const headers = [
        'folder',
        'file_path',
        'document_title',
        'period_from',
        'period_to',
        'total_amount',
        'extraction_method',
        'extraction_timestamp'
    ];
    const rows = [
        headers.join(','),
        ...results.map((result) => headers.map((header) => csvEscape(result[header])).join(','))
    ];

    fs.writeFileSync(csvOutput, `${rows.join('\n')}\n`);
    return { jsonOutput, csvOutput };
}

async function writeExcelSummary(results, outputDir) {
    const excelOutput = path.join(outputDir, 'assessment_extracted_details.xlsx');
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'KRA POST PORTUM TOOL';
    workbook.created = new Date();

    const worksheet = workbook.addWorksheet('Assessment Summary');
    worksheet.columns = [
        { header: 'Folder', key: 'folder', width: 24 },
        { header: 'File Name', key: 'file_name', width: 32 },
        { header: 'Document Title', key: 'document_title', width: 34 },
        { header: 'Period From', key: 'period_from', width: 16 },
        { header: 'Period To', key: 'period_to', width: 16 },
        { header: 'Total Amount', key: 'total_amount', width: 16 },
        { header: 'Extraction Method', key: 'extraction_method', width: 22 },
        { header: 'Extracted At', key: 'extraction_timestamp', width: 26 },
        { header: 'File Path', key: 'file_path', width: 70 }
    ];

    worksheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    worksheet.getRow(1).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF1F4E79' }
    };
    worksheet.getRow(1).alignment = { vertical: 'middle', horizontal: 'center' };

    results.forEach((result) => worksheet.addRow(result));
    worksheet.getColumn('total_amount').numFmt = '#,##0.00';
    worksheet.autoFilter = {
        from: 'A1',
        to: `I${Math.max(1, results.length + 1)}`
    };

    const totals = workbook.addWorksheet('Totals');
    totals.columns = [
        { header: 'Metric', key: 'metric', width: 28 },
        { header: 'Value', key: 'value', width: 24 }
    ];
    totals.addRows([
        { metric: 'PDFs Processed', value: results.length },
        { metric: 'Total Amount', value: results.reduce((sum, result) => sum + Number(result.total_amount || 0), 0).toFixed(2) },
        { metric: 'OCR Results', value: results.filter((result) => result.extraction_method === 'ocr-tesseract').length },
        { metric: 'Embedded Text Results', value: results.filter((result) => result.extraction_method === 'embedded-pdf-text').length },
        { metric: 'Generated At', value: new Date().toISOString() }
    ]);
    totals.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    totals.getRow(1).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF1F4E79' }
    };

    await workbook.xlsx.writeFile(excelOutput);
    return excelOutput;
}

async function extractAssessmentDetails({ rootDir, pdfFiles, outputDir, renameWithTitle = false, progressCallback = () => {} }) {
    const targetOutputDir = outputDir || rootDir || process.cwd();
    fs.mkdirSync(targetOutputDir, { recursive: true });

    const files = [...new Set((pdfFiles && pdfFiles.length ? pdfFiles : findPdfs(rootDir)).filter(Boolean))]
        .filter((filePath) => filePath.toLowerCase().endsWith('.pdf') && fs.existsSync(filePath));

    const results = [];
    for (let index = 0; index < files.length; index++) {
        const filePath = files[index];
        progressCallback({
            stage: 'Assessment Extraction',
            message: `Extracting PDF details ${index + 1}/${files.length}: ${path.basename(filePath)}`,
            progress: files.length ? Math.round((index / files.length) * 100) : 0
        });
        const details = extractDetails(filePath);
        results.push(renameWithTitle ? renamePdfWithTitle(details) : details);
    }

    const outputs = writeJsonAndCsv(results, targetOutputDir);
    const excelOutput = await writeExcelSummary(results, targetOutputDir);

    progressCallback({
        stage: 'Assessment Extraction',
        message: `Generated assessment summary for ${results.length} PDF(s).`,
        progress: 100
    });

    return {
        results,
        files: [excelOutput, outputs.csvOutput, outputs.jsonOutput],
        jsonOutput: outputs.jsonOutput,
        csvOutput: outputs.csvOutput,
        excelOutput
    };
}

if (require.main === module) {
    const rootDir = process.argv[2] ? path.resolve(process.argv[2]) : __dirname;
    extractAssessmentDetails({ rootDir, outputDir: rootDir })
        .then((summary) => {
            if (!summary.results.length) {
                console.error(`No PDF files found in ${rootDir}`);
                process.exitCode = 1;
                return;
            }

            console.table(summary.results.map((result) => ({
                folder: result.folder,
                document_title: result.document_title,
                period_from: result.period_from,
                period_to: result.period_to,
                total_amount: result.total_amount,
                method: result.extraction_method
            })));
            console.log(`\nWrote ${summary.jsonOutput}`);
            console.log(`Wrote ${summary.csvOutput}`);
            console.log(`Wrote ${summary.excelOutput}`);
        })
        .catch((error) => {
            console.error(error);
            process.exitCode = 1;
        });
}

module.exports = {
    extractAssessmentDetails,
    extractDetails,
    parseKraDetails
};
