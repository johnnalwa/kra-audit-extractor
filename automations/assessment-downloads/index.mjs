import { KraLogin } from '../../lib/kra-login.mjs';
import { logger } from '../../lib/logger.mjs';
import { resolveAutomationSettings } from '../../lib/automation-config.mjs';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

let Router = null;
let createClient = null;
let dotenv = null;
let archiver = null;

try {
  ({ Router } = await import('express'));
} catch {
  logger.warn('[Assessment Downloads] express is not installed; API router endpoints are disabled.');
}

try {
  ({ createClient } = await import('@supabase/supabase-js'));
} catch {
  logger.warn('[Assessment Downloads] @supabase/supabase-js is not installed; database/storage sync is disabled.');
}

try {
  dotenv = (await import('dotenv')).default;
} catch {
  logger.warn('[Assessment Downloads] dotenv is not installed; using process environment only.');
}

try {
  archiver = (await import('archiver')).default;
} catch {
  logger.warn('[Assessment Downloads] archiver is not installed; bulk zip endpoint is disabled.');
}

// Setup local downloads directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv?.config({ path: path.join(__dirname, '../../.env.local') });
dotenv?.config({ path: path.join(__dirname, '../../.env') });
dotenv?.config();
const preferredDownloadsDir = process.env.KRA_ASSESSMENTS_DOWNLOAD_DIR || 'C:\\Users\\user\\Downloads\\assessments';
let DOWNLOADS_DIR = preferredDownloadsDir;
try {
  if (!fs.existsSync(DOWNLOADS_DIR)) {
    fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
    logger.info(`Created local downloads directory: ${DOWNLOADS_DIR}`);
  }
} catch (error) {
  DOWNLOADS_DIR = path.join(__dirname, '../downloads/assessments');
  if (!fs.existsSync(DOWNLOADS_DIR)) {
    fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
  }
  logger.warn(`Could not use ${preferredDownloadsDir}; using ${DOWNLOADS_DIR}: ${error.message}`);
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const dbEnabled = process.env.KRA_ASSESSMENTS_ENABLE_DB === 'true';
const supabase = dbEnabled && createClient && supabaseUrl && supabaseKey
  ? createClient(supabaseUrl, supabaseKey)
  : null;

// Service role client for storage bucket operations (anon key can't create buckets)
const supabaseAdmin = dbEnabled && createClient && supabaseUrl && supabaseServiceKey
  ? createClient(supabaseUrl, supabaseServiceKey)
  : supabase;

// Ensure the 'assessments' storage bucket exists using service role
const BUCKET_NAME = 'assessments';
(async () => {
  if (!supabaseAdmin) return;
  try {
    const { data, error } = await supabaseAdmin.storage.getBucket(BUCKET_NAME);
    if (error || !data) {
      const { error: createErr } = await supabaseAdmin.storage.createBucket(BUCKET_NAME, { public: true });
      if (createErr) {
        logger.warn(`Could not create storage bucket '${BUCKET_NAME}': ${createErr.message}`);
      } else {
        logger.info(`Created storage bucket '${BUCKET_NAME}'`);
      }
    } else {
      logger.info(`Storage bucket '${BUCKET_NAME}' exists`);
    }
  } catch (err) {
    logger.warn(`Bucket check failed: ${err.message}`);
  }
})();

function createDisabledRouter() {
  return {
    post: () => createDisabledRouter(),
    get: () => createDisabledRouter()
  };
}

export const assessmentDownloadsRouter = Router ? Router() : createDisabledRouter();

// Sub-process options available in the "Assessment and Taxpayer Services" dropdown
const SUB_PROCESSES = {
  AST_01: 'Objection Application',
  AST_02: 'Appeal to the Local Committee/ Tribunal',
  AST_03: 'Appeal to the High Court',
  AST_04: 'Appeal to the Court of Appeal',
  AST_12: 'Estimated Assessment',
  AST_13: 'Additional Assessment',
  AST_15: 'Audit Commencement Letter',
  AST_17: 'Cancellation of Withholding Certificate',
  AST_19: 'VAA Defauler and Reminder',
  AST_20: 'Late Objection Rejection Notice',
  AST_21: 'Late Objection Approval Notice',
  AST_22: 'Objection Analysis Documents',
  AST_23: 'Manually Imposed Penalty Notice',
  AST_24: 'Default Assessment/Additional Assessment - For IT/Rent/VAT withholding'
};

// Full obligation options from KRA portal
const OBLIGATIONS = {
  '22': 'Advance Tax',
  '37': 'Agency Notice',
  '49': 'AWWDA Bulk Water Supply Revenue',
  '32': 'Capital Gain Tax (CGT)',
  '45': 'Digital Asset Tax (DAT)',
  '44': 'Digital Service Tax (DST)',
  '11': 'Excise',
  '28': 'Excise Cash Bond',
  '18': 'Excise License Fee',
  '40': 'Foreign Amnesty',
  '27': 'Gaming and Pool Betting',
  '41': 'Housing Levy',
  '106': 'Import Certificate Fees',
  '34': 'Income Tax - Amnesty',
  '4': 'Income Tax - Company',
  '3': 'Income Tax - Non-Resident Individual',
  '5': 'Income Tax - Partnership',
  '7': 'Income Tax - PAYE',
  '33': 'Income Tax - Rent Income (MRI)',
  '35': 'Income Tax - Rent Income Withholding',
  '2': 'Income Tax - Resident Individual',
  '13': 'Income Tax Shipping Tax',
  '14': 'Income Tax - Transmission of Messages',
  '8': 'Income Tax - Turnover Tax',
  '6': 'Income Tax - Withholding',
  '15': 'Intermediate Agent Registration License Fee',
  '104': 'Land Rates/ Lease Hold - Kiambu',
  '100': 'Land Rates/ Lease Hold - Laikipia',
  '102': 'Land Rates/ Lease Hold - Makueni',
  '21': 'Land Rent',
  '16': 'National Hospital Insurance Fund(NHIF)',
  '12': 'National Social Security Fund (NSSF)',
  '30': 'National Social Security Fund (NSSF)- Daily Rate',
  '31': 'National Social Security Fund (NSSF)- Regular',
  '42': 'NITA Levy',
  '47': 'Significant Economic Presence Tax (SEP)',
  '105': 'Single Business Permit - Kiambu',
  '101': 'Single Business Permit - Laikipia',
  '103': 'Single Business Permit - Makueni',
  '25': 'Standard Levy',
  '26': 'Sugar Development Levy',
  '43': 'TOT for Partner',
  '9': 'Value Added Tax (VAT)',
  '10': 'VAT on Services Imported',
  '29': 'VAT - Withholding',
  '23': 'Widows and Children\'s Pension Scheme (WCPS)'
};

/**
 * Helper: read a Playwright Download into a Buffer (no local file needed)
 */
async function downloadToBuffer(download) {
  const stream = await download.createReadStream();
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

/**
 * Helper: upload a buffer directly to Supabase Storage
 * Returns the public URL or null on failure.
 */
async function uploadToSupabase(buffer, storagePath, companyName) {
  if (!supabaseAdmin) {
    logger.warn(`[${companyName}] Supabase is not configured; skipping upload for ${storagePath}`);
    return null;
  }

  try {
    const { error: uploadError } = await supabaseAdmin
      .storage
      .from(BUCKET_NAME)
      .upload(storagePath, buffer, { contentType: 'application/pdf', upsert: true });

    if (!uploadError) {
      const { data: urlData } = supabaseAdmin.storage.from(BUCKET_NAME).getPublicUrl(storagePath);
      logger.info(`[${companyName}] Uploaded to Supabase: ${storagePath}`);
      return urlData.publicUrl;
    } else {
      logger.warn(`[${companyName}] Supabase upload error: ${uploadError.message}`);
      return null;
    }
  } catch (uploadErr) {
    logger.warn(`[${companyName}] Upload failed: ${uploadErr.message}`);
    return null;
  }
}

/**
 * POST /api/assessment-downloads/run
 */
assessmentDownloadsRouter.post('/run', async (req, res) => {
  const {
    pin,
    password,
    companyId,
    companyName = 'Unknown',
    subProcesses,
    obligations,
    obligation,  // legacy single value support
  } = req.body;
  const settings = resolveAutomationSettings({ headless: true, slowMo: 100, ...req.body });

  if (!pin || !password) {
    return res.status(400).json({ success: false, error: 'pin and password are required' });
  }

  const obligationList = obligations && obligations.length > 0
    ? obligations
    : obligation ? [obligation] : ['4', '9'];

  const jobId = `asd-${Date.now()}`;
  res.json({ success: true, jobId, message: 'Assessment download started' });

  runAssessmentDownload({
    pin,
    password,
    companyId,
    companyName,
    subProcesses,
    obligations: obligationList,
    headless: settings.headless,
    slowMo: settings.slowMo,
    jobId
  })
    .then(result => logger.info(`[${companyName}] Job ${jobId} completed: ${JSON.stringify(result.summary)}`))
    .catch(err => logger.error(`[${companyName}] Job ${jobId} failed: ${err.message}`));
});

/**
 * POST /api/assessment-downloads/run-sync
 */
assessmentDownloadsRouter.post('/run-sync', async (req, res) => {
  const {
    pin,
    password,
    companyId,
    companyName = 'Unknown',
    subProcesses,
    obligations,
    obligation,
    keepBrowserOpen = false
  } = req.body;
  const settings = resolveAutomationSettings({ headless: true, slowMo: 100, ...req.body });

  if (!pin || !password) {
    return res.status(400).json({ success: false, error: 'pin and password are required' });
  }

  const obligationList = obligations && obligations.length > 0
    ? obligations
    : obligation ? [obligation] : ['4', '9'];

  try {
    const result = await runAssessmentDownload({
      pin,
      password,
      companyId,
      companyName,
      subProcesses,
      obligations: obligationList,
      headless: settings.headless,
      slowMo: settings.slowMo,
      keepBrowserOpen,
      jobId: `asd-${Date.now()}`
    });
    res.json(result);
  } catch (err) {
    logger.error(`[${companyName}] Sync job failed: ${err.message}`);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/assessment-downloads/run-batch
 * Accepts a list of companies and processes them in batches with concurrency control.
 * Responds IMMEDIATELY with a jobId — processing happens in the background.
 */
assessmentDownloadsRouter.post('/run-batch', async (req, res) => {
  const {
    companies,
    obligations,
    obligation,
  } = req.body;
  const settings = resolveAutomationSettings({ headless: true, slowMo: 50, ...req.body });

  if (!companies || !Array.isArray(companies) || companies.length === 0) {
    return res.status(400).json({ success: false, error: 'companies array is required' });
  }

  const obligationList = obligations && obligations.length > 0
    ? obligations
    : obligation ? [obligation] : ['4', '9'];

  const maxConcurrent = settings.concurrency;
  const jobId = `batch-${Date.now()}`;

  logger.info(`[Batch ${jobId}] Starting: ${companies.length} companies, concurrency=${maxConcurrent}, obligations=[${obligationList.map(o => OBLIGATIONS[o] || o).join(', ')}]`);

  // Respond immediately — processing happens in the background
  res.json({
    success: true,
    jobId,
    totalCompanies: companies.length,
    concurrency: maxConcurrent,
    settings,
    obligations: obligationList.map(o => OBLIGATIONS[o] || o),
    message: `Processing ${companies.length} companies in batches of ${maxConcurrent}`
  });

  // Background batch processing
  (async () => {
    const results = [];

    for (let i = 0; i < companies.length; i += maxConcurrent) {
      const batch = companies.slice(i, i + maxConcurrent);
      const batchNum = Math.floor(i / maxConcurrent) + 1;
      const totalBatches = Math.ceil(companies.length / maxConcurrent);

      logger.info(`[Batch ${jobId}] Processing batch ${batchNum}/${totalBatches}: ${batch.map(c => c.name).join(', ')}`);

      const batchPromises = batch.map(async (company) => {
        try {
          const result = await runAssessmentDownload({
            pin: company.pin,
            password: company.password,
            companyId: company.id,
            companyName: company.name,
            obligations: obligationList,
            headless: settings.headless,
            slowMo: settings.slowMo,
            jobId: `${jobId}-${company.id}`
          });
          logger.info(`[Batch ${jobId}] Completed ${company.name}: OK`);
          return { company: company.name, success: true, summary: result.summary };
        } catch (err) {
          logger.error(`[Batch ${jobId}] Failed ${company.name}: ${err.message}`);
          return { company: company.name, success: false, error: err.message };
        }
      });

      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);

      logger.info(`[Batch ${jobId}] Batch ${batchNum}/${totalBatches} complete. ${results.length}/${companies.length} done.`);
    }

    const succeeded = results.filter(r => r.success).length;
    logger.info(`[Batch ${jobId}] ALL DONE: ${succeeded}/${companies.length} succeeded`);
  })().catch(err => {
    logger.error(`[Batch ${jobId}] Fatal batch error: ${err.message}`);
  });
});

/**
 * POST /api/assessment-downloads/run-batch-local-only
 * ONE-OFF Companies: Download assessments and save ONLY to local storage (NO database save)
 * Useful for one-time downloads that shouldn't be tracked in the database
 */
assessmentDownloadsRouter.post('/run-batch-local-only', async (req, res) => {
  const {
    companies,
    obligations,
    obligation,
  } = req.body;
  const settings = resolveAutomationSettings({ concurrency: 5, headless: true, slowMo: 50, ...req.body });

  if (!companies || !Array.isArray(companies) || companies.length === 0) {
    return res.status(400).json({ success: false, error: 'companies array is required' });
  }

  const obligationList = obligations && obligations.length > 0
    ? obligations
    : obligation ? [obligation] : ['4', '9'];

  const maxConcurrent = settings.concurrency;
  const jobId = `local-${Date.now()}`;

  logger.info(`[LocalOnly ${jobId}] Starting: ${companies.length} companies (LOCAL SAVE ONLY, NO DATABASE), concurrency=${maxConcurrent}`);

  // Respond immediately — processing happens in the background
  res.json({
    success: true,
    jobId,
    totalCompanies: companies.length,
    concurrency: maxConcurrent,
    settings,
    obligations: obligationList.map(o => OBLIGATIONS[o] || o),
    message: `Processing ${companies.length} companies - LOCAL STORAGE ONLY (no database save)`,
    saveLocation: DOWNLOADS_DIR
  });

  // Background batch processing (LOCAL SAVE ONLY - NO DB)
  (async () => {
    const results = [];

    for (let i = 0; i < companies.length; i += maxConcurrent) {
      const batch = companies.slice(i, i + maxConcurrent);
      const batchNum = Math.floor(i / maxConcurrent) + 1;
      const totalBatches = Math.ceil(companies.length / maxConcurrent);

      logger.info(`[LocalOnly ${jobId}] Batch ${batchNum}/${totalBatches}: ${batch.map(c => c.name).join(', ')}`);

      const batchPromises = batch.map(async (company) => {
        try {
          // Run download with LOCAL SAVE ONLY (no DB save)
          const result = await runAssessmentDownloadLocalOnly({
            pin: company.pin,
            password: company.password,
            companyId: company.id,
            companyName: company.name,
            obligations: obligationList,
            headless: settings.headless,
            slowMo: settings.slowMo,
            jobId: `${jobId}-${company.id}`
          });
          logger.info(`[LocalOnly ${jobId}] Completed ${company.name}: ${result.summary.totalDownloads} files (local only)`);
          return { company: company.name, success: true, summary: result.summary, files: result.localFileCount };
        } catch (err) {
          logger.error(`[LocalOnly ${jobId}] Failed ${company.name}: ${err.message}`);
          return { company: company.name, success: false, error: err.message };
        }
      });

      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);

      logger.info(`[LocalOnly ${jobId}] Batch ${batchNum}/${totalBatches} complete. ${results.length}/${companies.length} done.`);
    }

    const succeeded = results.filter(r => r.success).length;
    logger.info(`[LocalOnly ${jobId}] ALL DONE: ${succeeded}/${companies.length} succeeded (local files only, database NOT updated)`);
  })().catch(err => {
    logger.error(`[LocalOnly ${jobId}] Fatal batch error: ${err.message}`);
  });
});

/**
 * GET /api/assessment-downloads/options
 */
assessmentDownloadsRouter.get('/options', (_req, res) => {
  res.json({ subProcesses: SUB_PROCESSES, obligations: OBLIGATIONS });
});

/**
 * POST /api/assessment-downloads/bulk-zip
 * Downloads multiple files and returns them as a single zip file
 */
assessmentDownloadsRouter.post('/bulk-zip', async (req, res) => {
  if (!archiver) {
    return res.status(503).json({ success: false, error: 'archiver dependency is not available' });
  }

  const { files, zipName = 'assessments.zip' } = req.body;

  if (!files || !Array.isArray(files) || files.length === 0) {
    return res.status(400).json({ success: false, error: 'files array is required' });
  }

  try {
    logger.info(`[Bulk Zip] Creating zip with ${files.length} files...`);

    const archive = archiver('zip', { zlib: { level: 6 } });
    const chunks = [];

    // Collect zip data in memory
    archive.on('data', chunk => chunks.push(chunk));

    let errorOccurred = false;
    let processedCount = 0;

    archive.on('error', err => {
      errorOccurred = true;
      logger.error(`[Bulk Zip] Archive error: ${err.message}`);
    });

    // Process each file
    for (const fileObj of files) {
      if (errorOccurred) break;

      const { fileUrl, fileName, ackNo, obligationName, subProcessName, srNo } = fileObj;

      if (!fileUrl) continue;

      try {
        // Fetch the file from Supabase or external URL
        const response = await fetch(fileUrl);
        if (!response.ok) {
          logger.warn(`[Bulk Zip] Failed to fetch ${fileName}: ${response.statusText}`);
          continue;
        }

        const buffer = await response.buffer();

        // Create meaningful file path within the zip
        // Format: [obligationName]/[subProcessName]/[ackNo]-[srNo].pdf
        let zipPath = fileName || `${ackNo}.pdf`;
        
        if (obligationName && subProcessName) {
          const oblSlug = obligationName.replace(/[^a-zA-Z0-9]/g, '_').replace(/_+/g, '_');
          const spSlug = subProcessName.replace(/[^a-zA-Z0-9]/g, '_').replace(/_+/g, '_');
          const fileSuffix = srNo ? `${ackNo}-${srNo}` : ackNo;
          zipPath = `${oblSlug}/${spSlug}/${fileSuffix}.pdf`;
        }

        archive.append(buffer, { name: zipPath });
        processedCount++;
        logger.debug(`[Bulk Zip] Added: ${zipPath}`);
      } catch (err) {
        logger.warn(`[Bulk Zip] Error processing ${fileName}: ${err.message}`);
      }
    }

    if (errorOccurred || processedCount === 0) {
      if (processedCount === 0) {
        return res.status(400).json({ success: false, error: 'No files could be processed' });
      }
      logger.warn(`[Bulk Zip] Archive had errors, but ${processedCount} files were added`);
    }

    // Finalize the archive
    await archive.finalize();

    // Convert chunks to buffer
    const zipBuffer = Buffer.concat(chunks);

    logger.info(`[Bulk Zip] Created zip: ${zipName} (${zipBuffer.length} bytes, ${processedCount} files)`);

    // Send the zip file
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${zipName}"`);
    res.setHeader('Content-Length', zipBuffer.length);
    res.send(zipBuffer);
  } catch (err) {
    logger.error(`[Bulk Zip] Error: ${err.message}`);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Helper: Save file locally with company name organization
// ---------------------------------------------------------------------------
async function saveFileLocally(buffer, companyName, obligationName, subProcessName, ackNo, srNo, baseDir = DOWNLOADS_DIR) {
  try {
    // Create folder structure: downloads/assessments/{companyName}/{obligationName}/{subProcessName}/
    const companySlug = companyName.replace(/[^a-zA-Z0-9]/g, '_').replace(/_+/g, '_');
    const oblSlug = obligationName.replace(/[^a-zA-Z0-9]/g, '_').replace(/_+/g, '_');
    const spSlug = subProcessName.replace(/[^a-zA-Z0-9]/g, '_').replace(/_+/g, '_');
    
    const folderPath = path.join(baseDir, companySlug, oblSlug, spSlug);
    if (!fs.existsSync(folderPath)) {
      fs.mkdirSync(folderPath, { recursive: true });
    }

    // Create filename with company name and ack number
    const fileSuffix = srNo ? `${ackNo}-${srNo}` : ackNo;
    const fileName = `${companyName}_${fileSuffix}.pdf`;
    const filePath = path.join(folderPath, fileName);

    // Write file
    fs.writeFileSync(filePath, buffer);
    logger.info(`[Local Save] Saved: ${filePath} (${buffer.length} bytes)`);
    
    return {
      success: true,
      filePath,
      relativePath: path.relative(baseDir, filePath),
      fileName
    };
  } catch (err) {
    logger.error(`[Local Save] Error: ${err.message}`);
    return { success: false, error: err.message };
  }
}

/**
 * GET /api/assessment-downloads/missing-companies
 * Get list of companies NOT yet in kra_assessment table
 */
assessmentDownloadsRouter.get('/missing-companies', async (req, res) => {
  try {
    // Get all companies from acc_portal_company_duplicate
    const { data: allCompanies, error: fetchErr } = await supabase
      .from('acc_portal_company_duplicate')
      .select('id, company_name, pin, password')
      .order('company_name');

    if (fetchErr) {
      return res.status(500).json({ success: false, error: fetchErr.message });
    }

    if (!allCompanies || allCompanies.length === 0) {
      return res.json({ success: true, companies: [], count: 0 });
    }

    // Get companies already processed
    const { data: processedCompanies, error: procErr } = await supabase
      .from('kra_assessment')
      .select('company_id', { distinct: true });

    if (procErr) {
      logger.warn(`Error fetching processed companies: ${procErr.message}`);
    }

    const processedIds = new Set((processedCompanies || []).map(p => p.company_id));

    // Filter companies not yet processed
    const missingCompanies = allCompanies.filter(c => !processedIds.has(c.id));

    logger.info(`Found ${missingCompanies.length}/${allCompanies.length} companies not yet processed`);

    res.json({ 
      success: true, 
      companies: missingCompanies,
      count: missingCompanies.length,
      total: allCompanies.length
    });
  } catch (err) {
    logger.error(`Error fetching missing companies: ${err.message}`);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/assessment-downloads/sync-missing-companies
 * Download assessments for companies NOT in DB and save locally
 * Responds immediately - processing happens in background
 */
assessmentDownloadsRouter.post('/sync-missing-companies', async (req, res) => {
  const {
    limit = 5,
    obligations,
    obligation,
    saveLocal = true
  } = req.body;
  const settings = resolveAutomationSettings({ concurrency: 2, headless: true, slowMo: 100, ...req.body });

  try {
    // Fetch missing companies
    const { data: allCompanies } = await supabase
      .from('acc_portal_company_duplicate')
      .select('id, company_name, pin, password')
      .order('company_name')
      .limit(limit);

    const { data: processedCompanies } = await supabase
      .from('kra_assessment')
      .select('company_id', { distinct: true });

    const processedIds = new Set((processedCompanies || []).map(p => p.company_id));
    const missingCompanies = (allCompanies || []).filter(c => !processedIds.has(c.id));

    if (missingCompanies.length === 0) {
      return res.json({ 
        success: true, 
        message: 'No missing companies to process',
        processed: [],
        jobId: null
      });
    }

    const obligationList = obligations && obligations.length > 0
      ? obligations
      : obligation ? [obligation] : ['4', '9'];

    const jobId = `sync-${Date.now()}`;
    logger.info(`[Sync Missing] Job ${jobId}: Processing ${missingCompanies.length} missing companies`);

    // Respond immediately
    res.json({
      success: true,
      jobId,
      companiesCount: missingCompanies.length,
      message: `Started processing ${missingCompanies.length} missing companies`,
      companies: missingCompanies.map(c => ({ id: c.id, name: c.company_name }))
    });

    // Background processing
    (async () => {
      const results = [];
      const maxConcurrent = settings.concurrency;

      for (let i = 0; i < missingCompanies.length; i += maxConcurrent) {
        const batch = missingCompanies.slice(i, i + maxConcurrent);
        const batchNum = Math.floor(i / maxConcurrent) + 1;
        const totalBatches = Math.ceil(missingCompanies.length / maxConcurrent);

        logger.info(`[Sync Missing ${jobId}] Batch ${batchNum}/${totalBatches}: ${batch.map(c => c.company_name).join(', ')}`);

        const batchPromises = batch.map(async (company) => {
          try {
            const result = await runAssessmentDownloadWithLocalSave({
              pin: company.pin,
              password: company.password,
              companyId: company.id,
              companyName: company.company_name,
              obligations: obligationList,
              headless: settings.headless,
              slowMo: settings.slowMo,
              saveLocal,
              jobId: `${jobId}-${company.id}`
            });
            logger.info(`[Sync Missing ${jobId}] Completed ${company.company_name}: ${result.summary.totalDownloads} files`);
            return { company: company.company_name, success: true, ...result };
          } catch (err) {
            logger.error(`[Sync Missing ${jobId}] Failed ${company.company_name}: ${err.message}`);
            return { company: company.company_name, success: false, error: err.message };
          }
        });

        const batchResults = await Promise.all(batchPromises);
        results.push(...batchResults);

        logger.info(`[Sync Missing ${jobId}] Batch ${batchNum}/${totalBatches} complete. ${results.length}/${missingCompanies.length} done.`);
      }

      const succeeded = results.filter(r => r.success).length;
      logger.info(`[Sync Missing ${jobId}] ALL DONE: ${succeeded}/${missingCompanies.length} succeeded`);
    })().catch(err => {
      logger.error(`[Sync Missing ${jobId}] Fatal error: ${err.message}`);
    });

  } catch (err) {
    logger.error(`Error in sync-missing-companies: ${err.message}`);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ---------------------------------------------------------------------------
// Core automation
// ---------------------------------------------------------------------------

async function saveToSupabase(data, companyId, companyName) {
  if (!supabase) {
    logger.warn(`[${companyName}] Supabase is not configured; skipping assessment database save`);
    return;
  }

  try {
    logger.info(`[${companyName}] Saving ${data.length} records to Supabase...`);

    // CRITICAL FIX: Ensure companyId is numeric (BIGINT), not string
    const numericCompanyId = typeof companyId === 'string' ? parseInt(companyId, 10) : companyId;
    
    if (isNaN(numericCompanyId)) {
      logger.error(`[${companyName}] Invalid company_id: "${companyId}" - not a valid number`);
      return;
    }

    logger.debug(`[${companyName}] Using numeric company_id: ${numericCompanyId}`);

    const validData = data.filter(item => item.ackNo && item.ackNo.length > 0);
    if (validData.length === 0) {
      logger.info(`[${companyName}] No valid records to save to Supabase`);
      return;
    }

    const records = validData.map(item => ({
      company_id: numericCompanyId,
      sub_process: item.subProcess,
      sub_process_name: item.subProcessName,
      obligation_id: item.obligationId || null,
      obligation_name: item.obligationName || null,
      sr_no: item.srNo || null,
      ack_no: item.ackNo,
      ack_date: item.ackDate,
      status: item.status,
      file_name: item.fileName || null,
      file_path: item.filePath || null,
      updated_at: new Date().toISOString()
    }));

    logger.info(`[${companyName}] Upserting ${records.length} valid records...`);

    // Try upsert with the full unique constraint (includes sr_no for duplicate ack_no handling)
    let { error } = await supabase
      .from('kra_assessment')
      .upsert(records, { onConflict: 'company_id,ack_no,sr_no,sub_process,obligation_id' });

    // Fallback: try without sr_no constraint
    if (error && error.message.includes('no unique or exclusion constraint')) {
      logger.warn(`[${companyName}] Constraint with sr_no not found, trying without sr_no...`);
      ({ error } = await supabase
        .from('kra_assessment')
        .upsert(records, { onConflict: 'company_id,ack_no,sub_process,obligation_id' }));
    }

    // Fallback: try the old constraint without obligation_id
    if (error && error.message.includes('no unique or exclusion constraint')) {
      logger.warn(`[${companyName}] Constraint with obligation_id not found, trying legacy constraint...`);
      ({ error } = await supabase
        .from('kra_assessment')
        .upsert(records, { onConflict: 'company_id,ack_no,sub_process' }));
    }

    // If still failing, insert one-by-one with individual error handling 
    if (error) {
      logger.warn(`[${companyName}] Bulk upsert failed (${error.message}), inserting individually...`);
      let saved = 0;
      for (const record of records) {
        // Try to find existing record — use sr_no to distinguish duplicate ack_nos
        let query = supabase
          .from('kra_assessment')
          .select('id')
          .eq('company_id', record.company_id)
          .eq('ack_no', record.ack_no)
          .eq('sub_process', record.sub_process);
        if (record.sr_no) query = query.eq('sr_no', record.sr_no);
        if (record.obligation_id) query = query.eq('obligation_id', record.obligation_id);
        const { data: existing } = await query.maybeSingle();

        if (existing) {
          // Update existing record
          const { error: updateErr } = await supabase
            .from('kra_assessment')
            .update(record)
            .eq('id', existing.id);
          if (!updateErr) saved++;
          else logger.warn(`[${companyName}] Update failed for ${record.ack_no}: ${updateErr.message}`);
        } else {
          // Insert new record
          const { error: insertErr } = await supabase
            .from('kra_assessment')
            .insert(record);
          if (!insertErr) saved++;
          else logger.warn(`[${companyName}] Insert failed for ${record.ack_no}: ${insertErr.message}`);
        }
      }
      logger.info(`[${companyName}] Individually saved ${saved}/${records.length} records`);
    } else {
      logger.info(`[${companyName}] Successfully saved ${records.length} records to Supabase`);
    }
  } catch (error) {
    logger.error(`[${companyName}] Error in saveToSupabase: ${error.message}`);
  }
}

/**
 * Helper: navigate to reprint page and select Business Process = "Assessment and Taxpayer Services".
 * Follows the Playwright codegen flow: dashboard → hover Useful Links → click Consult and Reprint → select AST
 * Falls back to direct URL if hover menu fails.
 */
async function navigateToReprintAndSelectAST(page, companyName) {
  const MAX_NAV_RETRIES = 3;

  for (let attempt = 1; attempt <= MAX_NAV_RETRIES; attempt++) {
    logger.info(`[${companyName}] Navigating to Consult and Reprint (attempt ${attempt}/${MAX_NAV_RETRIES})...`);

    // Step 1: Navigate to dashboard and wait for it to fully load
    await page.goto('https://itax.kra.go.ke/KRA-Portal/', {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });
    await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

    let navigated = false;

    // Step 2: Click "Useful Links" tab then "Consult and Reprint" link
    // Approach A: JS click on tab + Playwright click on link
    try {
      await page.evaluate(() => {
        const allEls = document.querySelectorAll('a, span, div, li');
        for (const el of allEls) {
          if (el.textContent && el.textContent.trim().toLowerCase() === 'useful links') {
            el.click();
            break;
          }
        }
      });
      await page.waitForTimeout(300);

      const reprintLink = page.locator('a').filter({ hasText: /consult.*reprint/i }).first();
      if (await reprintLink.isVisible({ timeout: 3000 }).catch(() => false)) {
        await reprintLink.click();
        await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
        await page.waitForTimeout(800);
        navigated = true;
        logger.info(`[${companyName}] Clicked Consult and Reprint link`);
      }
    } catch (e) {
      logger.warn(`[${companyName}] Approach A failed: ${e.message}`);
    }

    // Approach B: getByRole with hover - FAST
    if (!navigated) {
      try {
        const usefulLinks = page.getByRole('link', { name: 'Useful Links' });
        if (await usefulLinks.isVisible({ timeout: 3000 }).catch(() => false)) {
          await usefulLinks.hover();
          await page.waitForTimeout(400);
          
          const reprintLink = page.getByRole('link', { name: /consult.*reprint/i });
          if (await reprintLink.isVisible({ timeout: 3000 }).catch(() => false)) {
            await reprintLink.click();
            await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
            await page.waitForTimeout(800);
            navigated = true;
            logger.info(`[${companyName}] Clicked Consult and Reprint via getByRole`);
          }
        }
      } catch (_) {}
    }

    // Approach C: Direct URL fallback
    if (!navigated) {
      logger.warn(`[${companyName}] Using direct URL fallback...`);
      await page.goto('https://itax.kra.go.ke/KRA-Portal/reprintPage.htm?actionCode=loadReprintPage', {
        waitUntil: 'networkidle',
        timeout: 45000
      });
    }

    // Wait for page to fully load and JavaScript to initialize
    await page.waitForTimeout(2000);  // Extra wait for JS execution
    
    // Check for KRA error page (Error Reference No)
    const hasError = await page.locator('text=/Error Reference No|An Error has occurred/i').isVisible({ timeout: 5000 }).catch(() => false);
    if (hasError) {
      logger.warn(`[${companyName}] KRA error page detected on attempt ${attempt}. Retrying with longer delay...`);
      if (attempt < MAX_NAV_RETRIES) continue; // Retry full navigation
      return false;
    }
    
    // Ensure page is responsive
    const pageReady = await page.evaluate(() => {
      return typeof document !== 'undefined' && document.readyState === 'complete';
    }).catch(() => false);
    
    if (!pageReady) {
      await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
    }

    // Step 3: Wait for Business Process dropdown and select AST
    await page.waitForSelector('#cmbBusinessProcess', { state: 'visible', timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(1000);  // Extra wait for dropdown to fully load

    // Debug: Check what's actually in the dropdown
    const dropdownInfo = await page.evaluate(() => {
      const bp = document.querySelector('#cmbBusinessProcess');
      if (!bp) return { exists: false };
      return {
        exists: true,
        optionCount: bp.options ? bp.options.length : 0,
        options: bp.options ? Array.from(bp.options).map(o => ({ value: o.value, text: o.text })) : [],
        disabled: bp.disabled,
        displayed: bp.offsetHeight > 0
      };
    });
    
    logger.info(`[${companyName}] BP Dropdown state: ${JSON.stringify(dropdownInfo)}`);

    // Scroll into view to ensure visibility
    await page.evaluate(() => {
      const bp = document.querySelector('#cmbBusinessProcess');
      if (bp) {
        bp.scrollIntoView({ behavior: 'smooth', block: 'center' });
        bp.focus();
      }
    }).catch(() => {});
    await page.waitForTimeout(500);

    const bpSelected = await page.evaluate(() => {
      const bp = document.querySelector('#cmbBusinessProcess');
      if (!bp) return false;
      
      // Wait for options to be available
      if (!bp.options || bp.options.length < 2) {
        // Try clicking the dropdown to trigger loading
        try {
          bp.click();
          bp.dispatchEvent(new Event('click', { bubbles: true }));
        } catch (_) {}
        return false;
      }
      
      // Try multiple selection methods
      for (const opt of bp.options) {
        if (opt.value === 'AST') {
          bp.value = 'AST';
          try { if (typeof bp.onchange === 'function') bp.onchange(); } catch (_) {}
          try { if (typeof bp.onchange === 'function') bp.onchange.call(bp); } catch (_) {}
          bp.dispatchEvent(new Event('change', { bubbles: true }));
          bp.dispatchEvent(new Event('input', { bubbles: true }));
          bp.dispatchEvent(new Event('click', { bubbles: true }));
          return true;
        }
      }
      for (const opt of bp.options) {
        if (opt.text.toLowerCase().includes('assessment') && opt.value !== '-1') {
          bp.value = opt.value;
          try { if (typeof bp.onchange === 'function') bp.onchange(); } catch (_) {}
          try { if (typeof bp.onchange === 'function') bp.onchange.call(bp); } catch (_) {}
          bp.dispatchEvent(new Event('change', { bubbles: true }));
          bp.dispatchEvent(new Event('input', { bubbles: true }));
          bp.dispatchEvent(new Event('click', { bubbles: true }));
          return true;
        }
      }
      return false;
    });

    if (!bpSelected) {
      // Try once more with a longer wait
      logger.info(`[${companyName}] BP Selection failed, waiting for options to load...`);
      await page.waitForTimeout(2000);
      
      const retrySelect = await page.evaluate(() => {
        const bp = document.querySelector('#cmbBusinessProcess');
        if (!bp || !bp.options || bp.options.length < 2) return false;
        
        for (const opt of bp.options) {
          if (opt.value === 'AST' || opt.text.toLowerCase().includes('assessment')) {
            bp.value = opt.value;
            bp.dispatchEvent(new Event('change', { bubbles: true }));
            bp.dispatchEvent(new Event('input', { bubbles: true }));
            return true;
          }
        }
        return false;
      });
      
      if (!retrySelect) {
        logger.warn(`[${companyName}] Could not select Business Process on attempt ${attempt}`);
        if (attempt < MAX_NAV_RETRIES) continue; // Retry full navigation
        return false;
      }
    }

    logger.info(`[${companyName}] Selected Business Process: AST`);
    await page.waitForTimeout(1000);  // Extra wait after selection

    // Step 4: Wait for sub-process dropdown to populate
    let loaded = await page.waitForFunction(() => {
      const sel = document.querySelector('#cmbBusinessSubProcess');
      return sel && sel.options && sel.options.length > 1;
    }, null, { timeout: 15000 }).then(() => true).catch(() => false);

    if (!loaded) {
      logger.info(`[${companyName}] Sub-process dropdown not ready, waiting more...`);
      await page.waitForTimeout(2000);
      
      // Retry with multiple event triggers
      await page.evaluate(() => {
        const bp = document.querySelector('#cmbBusinessProcess');
        if (bp) {
          try { if (typeof bp.onchange === 'function') bp.onchange(); } catch (_) {}
          bp.dispatchEvent(new Event('change', { bubbles: true }));
          bp.dispatchEvent(new Event('input', { bubbles: true }));
        }
      });
      
      loaded = await page.waitForFunction(() => {
        const sel = document.querySelector('#cmbBusinessSubProcess');
        return sel && sel.options && sel.options.length > 1;
      }, null, { timeout: 12000 }).then(() => true).catch(() => false);
    }

    if (!loaded) {
      logger.warn(`[${companyName}] Sub-process dropdown empty on attempt ${attempt}`);
      if (attempt < MAX_NAV_RETRIES) continue; // Retry full navigation
      return false;
    }

    return true; // Success
  }

  return false;
}

/**
 * Helper: select a dropdown option by matching its visible text/title (label-based)
 */
async function selectByLabel(page, selectId, label, companyName) {
  // Wait for the label to appear in the dropdown
  await page.waitForFunction(({ id, lbl }) => {
    const select = document.querySelector(`#${id}`);
    if (!select) return false;
    return Array.from(select.options).some(o =>
      o.text.trim().toLowerCase().includes(lbl.toLowerCase()) ||
      (o.title && o.title.toLowerCase().includes(lbl.toLowerCase()))
    );
  }, { id: selectId, lbl: label }, { timeout: 10000 }).catch(() => {
    logger.warn(`[${companyName}] Label "${label}" not found in #${selectId}`);
  });

  // Find and select the option
  const options = await page.locator(`#${selectId} option`).all();
  for (const option of options) {
    const text = (await option.textContent().catch(() => '')) || '';
    const title = (await option.getAttribute('title').catch(() => '')) || '';
    if (text.trim().toLowerCase().includes(label.toLowerCase()) ||
        title.toLowerCase().includes(label.toLowerCase())) {
      const val = await option.getAttribute('value');
      if (val && val !== '-1') {
        await page.locator(`#${selectId}`).selectOption(val);
        // Manually trigger onchange — wrapped in try-catch to prevent portal JS errors
        await page.evaluate((id) => {
          const el = document.querySelector(`#${id}`);
          if (el) {
            try { if (typeof el.onchange === 'function') el.onchange(); } catch (_) {}
            el.dispatchEvent(new Event('change', { bubbles: true }));
          }
        }, selectId);
        return true;
      }
    }
  }
  return false;
}

async function runAssessmentDownload({
  pin,
  password,
  companyId,
  companyName,
  subProcesses,
  obligations,
  headless,
  slowMo,
  keepBrowserOpen,
  jobId,
  skipDbSave = false,
  downloadPath,
  progressCallback = () => {}
}) {
  const kraLogin = new KraLogin({ headless, slowMo });
  let browser = null;
  obligations = obligations && obligations.length > 0 ? obligations : ['4', '9'];
  companyName = companyName || pin || 'Unknown';
  if (!pin || !password) {
    throw new Error('Assessment downloads require both the KRA PIN and password.');
  }
  const companySlug = companyName.replace(/[^a-zA-Z0-9]/g, '_').replace(/_+/g, '_').substring(0, 50);
  const localDownloadsDir = downloadPath || DOWNLOADS_DIR;

  try {
    // Step 1 - Login
    logger.info(`[${companyName}] Starting assessment download (job ${jobId})...`);
    logger.info(`[${companyName}] Obligations to process: ${obligations.map(o => OBLIGATIONS[o] || o).join(', ')}`);
    progressCallback({
      stage: 'Assessment Downloads',
      message: 'Logging in to KRA for assessment downloads...',
      progress: 5
    });
    const session = await kraLogin.login(pin, password, companyName);
    const { page } = session;
    browser = session.browser;

    // Step 2 - Navigate to Consult and Reprint page via portal menu
    logger.info(`[${companyName}] Navigating to Consult and Reprint page...`);
    progressCallback({
      stage: 'Assessment Downloads',
      message: 'Opening Consult and Reprint...',
      progress: 10
    });
    const astLoaded = await navigateToReprintAndSelectAST(page, companyName);
    if (!astLoaded) {
      logger.error(`[${companyName}] Failed to load Consult and Reprint page or Business Process dropdown`);
      throw new Error('Failed to initialize Consult and Reprint page');
    }
    logger.info(`[${companyName}] On Consult and Reprint page, AST selected`);

    // Build sub-process label list (use labels, not IDs)
    const subProcessList = subProcesses && subProcesses.length > 0
      ? subProcesses
      : Object.keys(SUB_PROCESSES);

    const allResults = [];

    // ===== OUTER LOOP: Obligations =====
    for (const currentObligation of obligations) {
      const obligationName = OBLIGATIONS[currentObligation] || currentObligation;
      logger.info(`[${companyName}] ===== Processing Obligation: ${obligationName} (${currentObligation}) =====`);

      // ===== INNER LOOP: Sub-processes =====
      for (const subProcess of subProcessList) {
        const subProcessLabel = SUB_PROCESSES[subProcess] || subProcess;
        try {
          logger.info(`[${companyName}] Processing: ${subProcessLabel} / ${obligationName}...`);
          const completedPairs = allResults.length;
          const totalPairs = Math.max(1, obligations.length * subProcessList.length);
          progressCallback({
            stage: 'Assessment Downloads',
            message: `Checking ${subProcessLabel} / ${obligationName}...`,
            progress: Math.min(95, 10 + Math.round((completedPairs / totalPairs) * 85))
          });

          // Select Sub-Process by label
          const spFound = await selectByLabel(page, 'cmbBusinessSubProcess', subProcessLabel, companyName);
          if (!spFound) {
            logger.warn(`[${companyName}] Sub-process "${subProcessLabel}" not found in dropdown, skipping...`);
            continue;
          }
          await page.waitForTimeout(800);

          // Wait for obligation dropdown to populate after sub-process change
          await page.waitForFunction(() => {
            const sel = document.querySelector('#cmbObligationId');
            return sel && sel.options.length > 1;
          }, null, { timeout: 10000 }).catch(() => {
            logger.warn(`[${companyName}] Obligation dropdown may not have loaded options`);
          });

          // Select Obligation by label
          const obFound = await selectByLabel(page, 'cmbObligationId', obligationName, companyName);
          if (!obFound) {
            logger.info(`[${companyName}] Obligation "${obligationName}" not available for ${subProcessLabel}, skipping...`);
            // Reset page for next iteration
            const resetOk = await navigateToReprintAndSelectAST(page, companyName);
            if (!resetOk) throw new Error('Failed to reset Consult and Reprint page');
            continue;
          }
          await page.waitForTimeout(300);

          // Click Consult with dialog handler
          logger.info(`[${companyName}] Clicking Consult...`);
          page.once('dialog', async dialog => {
            await dialog.accept().catch(() => {});
          });

          await page.locator('#ReprintConsult').click();
          await page.waitForLoadState('domcontentloaded', { timeout: 30000 }).catch(() => {});
          await page.waitForTimeout(1000);

          // ---------------------------------------------------------
          // PAGINATION & DOWNLOAD LOOP
          // ---------------------------------------------------------
          const records = [];
          const downloads = [];
          const excelData = [];
          
          let pageNum = 1;
          let hasNextPage = true;

          // Helper: attempt a single download by clicking link at index
          async function attemptDownload(page, linkIndex, ackNo, attemptNum, totalAttempts) {
            logger.info(`[${companyName}] Downloading ${ackNo} (attempt ${attemptNum}/${totalAttempts})...`);

            // Set up listeners BEFORE clicking
            const downloadPromise = page.waitForEvent('download', { timeout: 15000 }).catch(() => null);
            const popupPromise = page.waitForEvent('popup', { timeout: 15000 }).catch(() => null);

            page.once('dialog', async dialog => { await dialog.accept().catch(() => {}); });

            // Click the link via JS evaluate for maximum speed
            await page.evaluate((idx) => {
              const links = document.querySelectorAll('a#noticeID');
              if (links[idx]) links[idx].click();
            }, linkIndex);

            // Fast path: check within 3 seconds
            const quickResult = await Promise.race([
              downloadPromise.then(d => d ? { type: 'download', value: d } : null),
              popupPromise.then(p => p ? { type: 'popup', value: p } : null),
              new Promise(resolve => setTimeout(() => resolve(null), 2000))
            ]);

            let result = quickResult;
            if (!result) {
              // Slow path: wait remaining time up to 30s
              result = await Promise.race([
                downloadPromise.then(d => d ? { type: 'download', value: d } : null),
                popupPromise.then(p => p ? { type: 'popup', value: p } : null),
                new Promise(resolve => setTimeout(() => resolve(null), 13000))
              ]);
            }

            if (!result) return null;

            let fileBuffer = null;
            let fileName = `${ackNo}.pdf`;

            if (result.type === 'download') {
              fileName = result.value.suggestedFilename() || fileName;
              fileBuffer = await downloadToBuffer(result.value);
              logger.info(`[${companyName}] ✓ Downloaded: ${fileName} (${fileBuffer.length} bytes)`);
            } else if (result.type === 'popup') {
              const popup = result.value;
              await popup.waitForLoadState('load', { timeout: 8000 }).catch(() => {});
              const popupUrl = popup.url();
              if (popupUrl && popupUrl !== 'about:blank') {
                try {
                  const resp = await popup.goto(popupUrl, { waitUntil: 'load', timeout: 8000 });
                  if (resp) fileBuffer = await resp.body();
                  logger.info(`[${companyName}] ✓ Popup PDF: ${fileName} (${fileBuffer?.length || 0} bytes)`);
                } catch (e) {
                  logger.warn(`[${companyName}] Popup capture failed: ${e.message}`);
                }
              }
              await popup.close().catch(() => {});
            }

            return fileBuffer ? { fileBuffer, fileName } : null;
          }

          // Helper: Re-consult and navigate to a specific page number
          // Used when retrying failed downloads to ensure we are on the correct page
          async function reConsultAndNavigateToPage(targetPage) {
            const navOk = await navigateToReprintAndSelectAST(page, companyName);
            if (!navOk) return false;
            await selectByLabel(page, 'cmbBusinessSubProcess', subProcessLabel, companyName);
            await page.waitForTimeout(800);
            await page.waitForFunction(() => document.querySelector('#cmbObligationId')?.options.length > 1, null, { timeout: 10000 }).catch(() => {});
            await selectByLabel(page, 'cmbObligationId', obligationName, companyName);
            await page.waitForTimeout(300);
            page.once('dialog', async d => d.accept().catch(() => {}));
            await page.locator('#ReprintConsult').click();
            await page.waitForLoadState('domcontentloaded', { timeout: 30000 }).catch(() => {});
            await page.waitForTimeout(1000);

            // Navigate to target page if > 1 using KRA's onnext() pagination
            for (let p = 1; p < targetPage; p++) {
              const clicked = await page.evaluate(() => {
                const links = document.querySelectorAll('a.navidisp1');
                for (const link of links) {
                  const onclick = link.getAttribute('onclick') || '';
                  if (onclick.includes('onnext')) { link.click(); return true; }
                }
                // Fallback: any link with Next text that has onclick
                const allLinks = document.querySelectorAll('a');
                for (const link of allLinks) {
                  if (link.textContent.trim().startsWith('Next') && link.getAttribute('onclick')) {
                    link.click(); return true;
                  }
                }
                return false;
              });
              if (clicked) {
                await page.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {});
                await page.waitForTimeout(1000);
              } else {
                logger.warn(`[${companyName}] Failed to navigate to page ${p + 1} during re-consult`);
                return false;
              }
            }
            return true;
          }

          // ===== Iterate through all pages =====
          while (hasNextPage) {
            // Check results on current page
            const noticeCount = await page.locator('a#noticeID').count().catch(() => 0);
            logger.info(`[${companyName}] Page ${pageNum}: ${noticeCount} records found`);

            if (noticeCount === 0) {
              if (pageNum === 1) {
                // No records at all
                allResults.push({
                  subProcess, subProcessName: subProcessLabel,
                  obligationId: currentObligation, obligationName,
                  records: [], downloads: [], excelData: []
                });
              }
              break; // Exit pagination loop
            }

            // Scrape table data — include srNo and receiptId to differentiate duplicate ackNos
            const tableData = await page.$$eval('a#noticeID', links => {
              return links.map((link, idx) => {
                const row = link.closest('tr');
                const cells = row ? row.querySelectorAll('td') : [];
                // Extract unique receipt ID from href like "javascript:showReprintReceipt(31596427);"
                const href = link.getAttribute('href') || '';
                const receiptMatch = href.match(/\((\d+)\)/);
                return {
                  index: idx,
                  srNo: cells[0]?.textContent?.trim() || String(idx + 1),
                  ackNo: link.textContent?.trim() || '',
                  receiptId: receiptMatch ? receiptMatch[1] : '',
                  ackDate: cells[2]?.textContent?.trim() || '',
                  status: cells[3]?.textContent?.trim() || '',
                };
              });
            });

            logger.info(`[${companyName}] Page ${pageNum}: Scraped ${tableData.length} rows`);

            // Add to accumulators
            for (const rowData of tableData) {
              records.push(rowData);
              excelData.push({
                subProcess, subProcessName: subProcessLabel || subProcess,
                obligationId: currentObligation, obligationName,
                ackNo: rowData.ackNo, srNo: rowData.srNo, ackDate: rowData.ackDate, status: rowData.status
              });
            }

            // Process downloads for current page
            const failedDownloads = [];
            const MAX_RETRIES = 3;

            for (let i = 0; i < tableData.length; i++) {
              const rowData = tableData[i];
              try {
                const result = await attemptDownload(page, i, rowData.ackNo, 1, MAX_RETRIES);
                if (result) {
                  const oblSlug = (obligationName || 'unknown').replace(/[^a-zA-Z0-9]/g, '_').replace(/_+/g, '_');
                  const spSlug = (subProcessLabel || 'unknown').replace(/[^a-zA-Z0-9]/g, '_').replace(/_+/g, '_');
                  const fileSuffix = `${rowData.ackNo}_${rowData.srNo}`;
                  let filePath = null;

                  if (skipDbSave) {
                    // LOCAL ONLY: save to local filesystem, skip Supabase upload
                    const localResult = await saveFileLocally(result.fileBuffer, companyName, obligationName, subProcessLabel, rowData.ackNo, rowData.srNo, localDownloadsDir);
                    filePath = localResult.success ? localResult.filePath : null;
                  } else {
                    // Normal mode: upload to Supabase Storage
                    const storagePath = `${companySlug}_${companyId}/${oblSlug}/${spSlug}/${fileSuffix}.pdf`;
                    filePath = await uploadToSupabase(result.fileBuffer, storagePath, companyName);
                  }
                  
                  downloads.push({ ackNo: rowData.ackNo, srNo: rowData.srNo, fileName: result.fileName, filePath });
                  const excelRow = excelData.find(e => e.ackNo === rowData.ackNo && e.srNo === rowData.srNo);
                  if (excelRow) { excelRow.fileName = result.fileName; excelRow.filePath = filePath; }
                } else {
                  failedDownloads.push({ index: i, rowData });
                }

                // Ensure safety
                if (!page.url().includes('searchReprintData') && !page.url().includes('reprintPage')) {
                  await page.goBack().catch(() => {});
                  await page.waitForLoadState('domcontentloaded');
                }
              } catch (e) {
                logger.warn(`[${companyName}] Error downloading ${rowData.ackNo}: ${e.message}`);
                failedDownloads.push({ index: i, rowData });
              }
            }

            // Retry pass for current page
            if (failedDownloads.length > 0) {
              logger.info(`[${companyName}] Page ${pageNum}: ${failedDownloads.length} failed downloads, retrying...`);
              for (let retry = 2; retry <= MAX_RETRIES; retry++) {
                if (failedDownloads.length === 0) break;

                // Re-consult and navigate to current page
                const navigated = await reConsultAndNavigateToPage(pageNum);
                if (!navigated) break;

                const stillFailing = [];
                for (const { rowData } of [...failedDownloads]) {
                  // Re-find index by srNo (row number) to handle duplicate ackNos correctly
                  const newIndex = await page.evaluate(({ srNo, ackNo }) => {
                    const rows = document.querySelectorAll('table.tab3 tbody tr, table.whitepapartdBig tbody tr');
                    for (let j = 0; j < rows.length; j++) {
                      const cells = rows[j].querySelectorAll('td');
                      const rowSrNo = cells[0]?.textContent?.trim();
                      if (rowSrNo === srNo) return j;
                    }
                    // Fallback: match by ackNo text on links
                    const links = document.querySelectorAll('a#noticeID');
                    for (let j = 0; j < links.length; j++) {
                      if (links[j].textContent.trim() === ackNo) return j;
                    }
                    return -1;
                  }, { srNo: rowData.srNo, ackNo: rowData.ackNo });

                  if (newIndex !== -1) {
                    const result = await attemptDownload(page, newIndex, rowData.ackNo, retry, MAX_RETRIES);
                    if (result) {
                       const oblSlug = (obligationName || 'unknown').replace(/[^a-zA-Z0-9]/g, '_').replace(/_+/g, '_');
                       const spSlug = (subProcessLabel || 'unknown').replace(/[^a-zA-Z0-9]/g, '_').replace(/_+/g, '_');
                       const fileSuffix = `${rowData.ackNo}_${rowData.srNo}`;
                       let retryFilePath = null;

                       if (skipDbSave) {
                         const localResult = await saveFileLocally(result.fileBuffer, companyName, obligationName, subProcessLabel, rowData.ackNo, rowData.srNo, localDownloadsDir);
                         retryFilePath = localResult.success ? localResult.filePath : null;
                       } else {
                         const storagePath = `${companySlug}_${companyId}/${oblSlug}/${spSlug}/${fileSuffix}.pdf`;
                         retryFilePath = await uploadToSupabase(result.fileBuffer, storagePath, companyName);
                       }
                       
                       downloads.push({ ackNo: rowData.ackNo, srNo: rowData.srNo, fileName: result.fileName, filePath: retryFilePath });
                       const excelRow = excelData.find(e => e.ackNo === rowData.ackNo && e.srNo === rowData.srNo);
                       if (excelRow) { excelRow.fileName = result.fileName; excelRow.filePath = retryFilePath; }
                       logger.info(`[${companyName}] ✓ Retry ${retry} succeeded for ${rowData.ackNo}`);
                    } else {
                       stillFailing.push({ rowData });
                    }
                  } else {
                    stillFailing.push({ rowData });
                  }
                }
                failedDownloads.length = 0;
                failedDownloads.push(...stillFailing);
              }
            }

            // Ensure we're still on the results page before checking pagination
            // (downloads via showReprintReceipt may have navigated away)
            const onResultsPage = await page.locator('#pageHeaderId').isVisible({ timeout: 2000 }).catch(() => false);
            if (!onResultsPage) {
              logger.warn(`[${companyName}] Not on results page after downloads, re-consulting...`);
              const reNav = await reConsultAndNavigateToPage(pageNum);
              if (!reNav) {
                logger.warn(`[${companyName}] Failed to re-navigate to page ${pageNum}, stopping`);
                hasNextPage = false;
                break;
              }
            }

            // Check pagination — KRA uses: <span id="pageHeaderId">1 / 63</span>
            // Navigation: <a onclick="onnext(1)">Next></a>, <a onclick="onlast(63)">Last>></a>
            const pageInfo = await page.evaluate(() => {
              const header = document.querySelector('#pageHeaderId');
              const totalEl = document.querySelector('#pageTableId');
              if (!header) return null;
              const parts = header.textContent.trim().split('/').map(s => s.trim());
              return {
                currentPage: parseInt(parts[0]) || 0,
                totalPages: parseInt(parts[1]) || 0,
                totalRecords: totalEl ? parseInt(totalEl.textContent.trim()) || 0 : 0
              };
            });

            if (pageInfo) {
              logger.info(`[${companyName}] Pagination: page ${pageInfo.currentPage}/${pageInfo.totalPages}, total ${pageInfo.totalRecords} records`);

              if (pageInfo.currentPage < pageInfo.totalPages) {
                // Click the "Next>" link — it has onclick="onnext(currentPage)"
                const clicked = await page.evaluate(() => {
                  // Find the Next link by its onclick containing "onnext"
                  const links = document.querySelectorAll('a.navidisp1');
                  for (const link of links) {
                    const onclick = link.getAttribute('onclick') || '';
                    if (onclick.includes('onnext')) {
                      link.click();
                      return true;
                    }
                  }
                  // Fallback: find by text content
                  const allLinks = document.querySelectorAll('a');
                  for (const link of allLinks) {
                    const txt = link.textContent.trim();
                    if (txt === 'Next>' || txt === 'Next' || txt.startsWith('Next')) {
                      const onclick = link.getAttribute('onclick') || '';
                      if (onclick) { link.click(); return true; }
                    }
                  }
                  return false;
                });

                if (clicked) {
                  logger.info(`[${companyName}] Navigating to page ${pageInfo.currentPage + 1}/${pageInfo.totalPages}...`);
                  await page.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {});
                  await page.waitForTimeout(1000);

                  // Verify page actually changed by checking pageHeaderId
                  const newPageInfo = await page.evaluate(() => {
                    const header = document.querySelector('#pageHeaderId');
                    return header ? header.textContent.trim() : '';
                  });
                  const newCount = await page.locator('a#noticeID').count().catch(() => 0);

                  if (newCount > 0 && newPageInfo !== `${pageInfo.currentPage} / ${pageInfo.totalPages}`) {
                    pageNum++;
                    logger.info(`[${companyName}] Now on page ${newPageInfo}, ${newCount} records`);
                  } else {
                    logger.warn(`[${companyName}] Page did not change (still ${newPageInfo}), stopping`);
                    hasNextPage = false;
                  }
                } else {
                  logger.info(`[${companyName}] Could not find Next button, stopping pagination`);
                  hasNextPage = false;
                }
              } else {
                logger.info(`[${companyName}] On last page (${pageInfo.currentPage}/${pageInfo.totalPages}), pagination complete`);
                hasNextPage = false;
              }
            } else {
              // No KRA pagination header found — single page of results
              logger.info(`[${companyName}] No pagination header found, single page`);
              hasNextPage = false;
            }
          } // End while loop

          // Push accumulated results
          if (records.length > 0) {
            allResults.push({
              subProcess, subProcessName: subProcessLabel,
              obligationId: currentObligation, obligationName,
              records, downloads, excelData
            });
            logger.info(`[${companyName}] ${subProcessLabel}/${obligationName}: Processed ${pageNum} pages, ${records.length} records`);
          }

          // Reset page for next iteration
          const resetOk = await navigateToReprintAndSelectAST(page, companyName);
          if (!resetOk) throw new Error('Failed to reset Consult and Reprint page after sub-process');

        } catch (spErr) {
          logger.error(`[${companyName}] Error with ${subProcess}/${obligationName}: ${spErr.message}`);
          allResults.push({
            subProcess,
            subProcessName: subProcessLabel,
            obligationId: currentObligation,
            obligationName,
            error: spErr.message,
            records: [],
            downloads: [],
            excelData: []
          });
          // Recover: reset page for next iteration
          const recovered = await navigateToReprintAndSelectAST(page, companyName).catch(() => false);
          if (!recovered) {
            logger.error(`[${companyName}] Cannot recover navigation, skipping remaining sub-processes for ${obligationName}`);
            break; // Break inner sub-process loop, move to next obligation
          }
        }
      }
    }

    // Save all data to Supabase DB (unless explicitly skipped for local-only downloads)
    const allExcelData = allResults.flatMap(r => r.excelData || []);
    if (!skipDbSave) {
      await saveToSupabase(allExcelData, companyId, companyName);
    } else {
      logger.info(`[${companyName}] Skipping database save (LOCAL ONLY mode)`);
    }

    if (!keepBrowserOpen) {
      await browser.close();
      browser = null;
      logger.info(`[${companyName}] Browser closed`);
    }

    const totalDownloads = allResults.reduce((sum, r) => sum + (r.downloads?.length || 0), 0);
    const totalRecords = allResults.reduce((sum, r) => sum + (r.records?.length || 0), 0);
    progressCallback({
      stage: 'Assessment Downloads',
      message: `Completed assessment downloads: ${totalDownloads} files from ${totalRecords} records.`,
      progress: 100
    });

    return {
      success: true,
      jobId,
      companyName,
      pin,
      browserOpen: !!keepBrowserOpen,
      results: allResults,
      downloadPath: localDownloadsDir,
      summary: {
        obligationsChecked: obligations.length,
        subProcessesChecked: allResults.length,
        totalRecords,
        totalDownloads,
        processedAt: new Date().toISOString()
      }
    };

  } catch (error) {
    if (browser) await browser.close().catch(() => {});
    logger.error(`[${companyName}] Assessment download error: ${error.message}`);
    throw error;
  }
}

/**
 * Wrapper function to run assessment download and save files locally
 * This function intercepts the download process to save files locally with company names
 */
async function runAssessmentDownloadWithLocalSave(options) {
  const { companyName, saveLocal = true, ...runOptions } = options;
  
  try {
    // Run the main assessment download
    const result = await runAssessmentDownload({ ...runOptions, companyName });

    // If saveLocal is true, also download files locally
    if (saveLocal && result.results && result.results.length > 0) {
      logger.info(`[${companyName}] Downloading files to local folder...`);
      
      let localFileCount = 0;
      for (const resultItem of result.results) {
        if (resultItem.downloads && resultItem.downloads.length > 0) {
          for (const download of resultItem.downloads) {
            try {
              // Fetch file from URL (could be Supabase or direct download)
              const response = await fetch(download.fileUrl || download.url);
              if (!response.ok) {
                logger.warn(`[${companyName}] Failed to fetch ${download.fileName}: ${response.statusText}`);
                continue;
              }

              const buffer = await response.buffer();
              
              // Save locally
              const saveResult = await saveFileLocally(
                buffer,
                companyName,
                resultItem.obligationName || 'Unknown',
                resultItem.subProcessName || 'Unknown',
                download.ackNo || 'unknown',
                download.srNo || null
              );

              if (saveResult.success) {
                localFileCount++;
                logger.info(`[${companyName}] Local: ${saveResult.relativePath}`);
              }
            } catch (err) {
              logger.warn(`[${companyName}] Error saving ${download.fileName} locally: ${err.message}`);
            }
          }
        }
      }

      result.localSaveCount = localFileCount;
      result.downloadDir = DOWNLOADS_DIR;
      logger.info(`[${companyName}] Saved ${localFileCount} files locally`);
    }

    return result;
  } catch (err) {
    logger.error(`[${companyName}] Error in local save wrapper: ${err.message}`);
    throw err;
  }
}

/**
 * runAssessmentDownloadLocalOnly(options)
 * Wrapper to run assessment download WITHOUT saving to database
 * Perfect for one-off batch requests that should only save locally
 * 
 * Takes same options as runAssessmentDownload() and internally sets skipDbSave=true
 * Returns summary with: success, jobId, companyName, summary (with totalDownloads, totalRecords, etc)
 */
async function runAssessmentDownloadLocalOnly(options) {
  // Add skipDbSave=true flag to ensure NO database save
  return await runAssessmentDownload({
    ...options,
    skipDbSave: true
  });
}

export {
  SUB_PROCESSES,
  OBLIGATIONS,
  runAssessmentDownload,
  runAssessmentDownloadWithLocalSave,
  runAssessmentDownloadLocalOnly
};
