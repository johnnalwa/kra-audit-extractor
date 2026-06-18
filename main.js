// Must be set before any Playwright require() so it finds the bundled Chromium
// that was placed in playwright-core/.local-browsers/ during the build step.
process.env.PLAYWRIGHT_BROWSERS_PATH = '0';

const { app, BrowserWindow, ipcMain, dialog, shell, net } = require('electron');
const path = require('path');
const fs = require('fs');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      enableRemoteModule: true
    },
    icon: path.join(__dirname, 'assets', 'icon.png'),
    show: false,
    autoHideMenuBar: true, // Hide menu bar
    frame: true,
    title: 'KRA POST PORTUM TOOL'
  });

  mainWindow.loadFile('index-new.html');
  
  // Show window when ready to prevent visual flash
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Open DevTools in development
  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools();
  }
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// IPC handlers for communication with renderer process
ipcMain.handle('select-download-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: 'Select Download Folder'
  });
  
  if (!result.canceled && result.filePaths.length > 0) {
    return result.filePaths[0];
  }
  return null;
});

// Alias for settings modal
ipcMain.handle('select-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: 'Select Output Folder'
  });
  
  if (!result.canceled && result.filePaths.length > 0) {
    return { success: true, folderPath: result.filePaths[0] };
  }
  return { success: false, folderPath: null };
});

ipcMain.handle('save-config', async (event, config) => {
  try {
    const configPath = path.join(__dirname, 'config.json');
    await fs.promises.writeFile(configPath, JSON.stringify(config, null, 2));
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('load-config', async () => {
  try {
    const configPath = path.join(__dirname, 'config.json');
    if (fs.existsSync(configPath)) {
      const data = await fs.promises.readFile(configPath, 'utf8');
      if (data) {
        return JSON.parse(data);
      }
    }
    return null;
  } catch (error) {
    return null;
  }
});

ipcMain.handle('show-message', async (event, options) => {
  const result = await dialog.showMessageBox(mainWindow, options);
  return result;
});

// Open folder in file explorer
ipcMain.handle('open-folder', async (event, folderPath) => {
  try {
    if (folderPath && fs.existsSync(folderPath)) {
      await shell.openPath(folderPath);
      return { success: true };
    } else {
      return { success: false, error: 'Folder does not exist' };
    }
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Electron-native fetch handler for packaged apps
ipcMain.handle('electron-fetch', async (event, { url, options }) => {
  return new Promise((resolve, reject) => {
    try {
      const requestOptions = {
        method: options.method || 'GET',
        url: url
      };

      const request = net.request(requestOptions);

      // Set headers
      if (options.headers) {
        Object.entries(options.headers).forEach(([key, value]) => {
          request.setHeader(key, value);
        });
      }

      // Handle response
      request.on('response', (response) => {
        const chunks = [];
        
        response.on('data', (chunk) => {
          chunks.push(chunk);
        });

        response.on('end', () => {
          try {
            const body = Buffer.concat(chunks).toString();
            const result = {
              ok: response.statusCode >= 200 && response.statusCode < 300,
              status: response.statusCode,
              statusText: response.statusMessage,
              headers: response.headers,
              body: body
            };
            
            // Try to parse as JSON if possible
            try {
              result.json = JSON.parse(body);
            } catch (e) {
              // Not JSON, that's okay
            }
            
            resolve(result);
          } catch (error) {
            reject(error);
          }
        });

        response.on('error', (error) => {
          reject(error);
        });
      });

      request.on('error', (error) => {
        reject(error);
      });

      // Send request body if present
      if (options.body) {
        request.write(options.body);
      }

      request.end();
    } catch (error) {
      reject(error);
    }
  });
});

// Manufacturer Details API handler
ipcMain.handle('fetch-manufacturer-details', async (event, { company }) => {
  try {
    const { fetchManufacturerDetails } = require('./automations/manufacturer-details');
    return await fetchManufacturerDetails(company, (progress) => {
      mainWindow.webContents.send('automation-progress', progress);
    });
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Export manufacturer details handler (consolidated)
ipcMain.handle('export-manufacturer-details', async (event, { company, data, downloadPath }) => {
  try {
    const { exportManufacturerToConsolidated } = require('./automations/manufacturer-details');
    return await exportManufacturerToConsolidated(company, data, downloadPath, (progress) => {
      mainWindow.webContents.send('automation-progress', progress);
    });
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Password validation handler (consolidated)
ipcMain.handle('validate-kra-credentials', async (event, { company, downloadPath }) => {
  try {
    const { validateAndExportToConsolidated } = require('./automations/password-validation');
    return await validateAndExportToConsolidated(company, downloadPath, (progress) => {
      mainWindow.webContents.send('automation-progress', progress);
    });
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Password validation automation handler
ipcMain.handle('run-password-validation', async (event, { company, downloadPath }) => {
  try {
    const { runPasswordValidation } = require('./automations/password-validation');
    return await runPasswordValidation(company, downloadPath, (progress) => {
      mainWindow.webContents.send('automation-progress', progress);
    });
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// VAT extraction handler
ipcMain.handle('run-vat-extraction', async (event, { company, dateRange, downloadPath }) => {
  try {
    const { runVATExtraction } = require('./automations/vat-extraction');
    return await runVATExtraction(company, dateRange, downloadPath, (progress) => {
      mainWindow.webContents.send('automation-progress', progress);
    });
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Withholding VAT extraction handler
ipcMain.handle('run-wh-vat-extraction', async (event, { company, dateRange, downloadPath }) => {
  try {
    const { runWhVatExtraction } = require('./automations/wh-vat-extraction');
    return await runWhVatExtraction(company, dateRange, downloadPath, (progress) => {
      mainWindow.webContents.send('automation-progress', progress);
    });
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// General ledger extraction handler
ipcMain.handle('run-ledger-extraction', async (event, { company, downloadPath }) => {
  try {
    const { runLedgerExtraction } = require('./automations/ledger-extraction');
    return await runLedgerExtraction(company, downloadPath, (progress) => {
      mainWindow.webContents.send('automation-progress', progress);
    });
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Run all automations handler (uses individual automation modules)
ipcMain.handle('run-all-automations', async (event, { company, selectedAutomations, vatDateRange, whVatDateRange, downloadPath }) => {
  try {
    const { runAllAutomations } = require('./automations/run-all-automations');
    return await runAllAutomations(company, selectedAutomations, vatDateRange, whVatDateRange, downloadPath, (progress) => {
      mainWindow.webContents.send('automation-progress', progress);
    });
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Full batch handler — all automations, one folder, one consolidated Excel
ipcMain.handle('run-all-automations-batch', async (event, { companies, selectedAutomations, vatDateRange, whVatDateRange, downloadPath, workerCount }) => {
  try {
    const { runBatchFullAutomations } = require('./automations/batch-full-runner');
    return await runBatchFullAutomations(
      companies,
      selectedAutomations,
      vatDateRange,
      whVatDateRange,
      downloadPath,
      workerCount || 10,
      (progress) => { mainWindow.webContents.send('automation-progress', progress); }
    );
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// PIN-only batch handler
ipcMain.handle('run-pin-only-batch', async (event, { companies, selectedAutomations, downloadPath, browserSettings, workerCount }) => {
  try {
    const { runPinOnlyBatch } = require('./automations/pin-only-batch-runner');
    const normalizedCompanies = (companies || []).map((company) => ({
      ...company,
      browserSettings: company.browserSettings || browserSettings || {}
    }));

    return await runPinOnlyBatch(normalizedCompanies, selectedAutomations, downloadPath, (progress) => {
      mainWindow.webContents.send('automation-progress', progress);
    }, workerCount || 10);
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Save CSV template to disk
ipcMain.handle('save-csv-template', async (event, { defaultPath }) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Save CSV Template',
    defaultPath: defaultPath || 'companies_template.csv',
    filters: [{ name: 'CSV Files', extensions: ['csv'] }]
  });

  if (result.canceled || !result.filePath) {
    return { success: false, canceled: true };
  }

  const csvContent = 'PIN,Company Name,Password\nP051766288C,Example Company Ltd,yourpassword\n';
  fs.writeFileSync(result.filePath, csvContent, 'utf8');
  return { success: true, filePath: result.filePath };
});

// Obligation checker handler (consolidated)
ipcMain.handle('run-obligation-check', async (event, { company, downloadPath }) => {
  try {
    const { runObligationCheckConsolidated } = require('./automations/obligation-checker');
    return await runObligationCheckConsolidated(company, downloadPath, (progress) => {
      mainWindow.webContents.send('automation-progress', progress);
    });
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Director Details extraction handler
ipcMain.handle('run-director-details-extraction', async (event, { company, downloadPath }) => {
  try {
    const { runDirectorDetailsExtraction } = require('./automations/director-details-extraction');
    return await runDirectorDetailsExtraction(company, downloadPath, (progress) => {
      mainWindow.webContents.send('automation-progress', progress);
    });
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Agent checker handler
ipcMain.handle('run-agent-check', async (event, { company, downloadPath }) => {
  try {
    const { checkCompanyWithholdingStatus } = require('./automations/agent-checker');
    return await checkCompanyWithholdingStatus(company, downloadPath, (progress) => {
      mainWindow.webContents.send('automation-progress', progress);
    });
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Liabilities extraction handler
ipcMain.handle('run-liabilities-extraction', async (event, { company, downloadPath }) => {
  try {
    const { runLiabilitiesExtraction } = require('./automations/liabilities-extraction');
    return await runLiabilitiesExtraction(company, downloadPath, (progress) => {
      mainWindow.webContents.send('automation-progress', progress);
    });
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// TCC Downloader handler
ipcMain.handle('run-tcc-downloader', async (event, { company, downloadPath }) => {
  try {
    const { runTCCDownloader } = require('./automations/tax-compliance-downloader');
    return await runTCCDownloader(company, downloadPath, (progress) => {
      mainWindow.webContents.send('automation-progress', progress);
    });
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Assessment downloads handler
ipcMain.handle('run-assessment-downloads', async (event, { company, options, downloadPath }) => {
  try {
    const { runAssessmentDownloads } = require('./automations/assessment-downloads');
    return await runAssessmentDownloads(company, options || {}, downloadPath, (progress) => {
      mainWindow.webContents.send('automation-progress', progress);
    });
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Open file handler (legacy - kept for backward compatibility)
ipcMain.on('open-file', (event, filePath) => {
  shell.openPath(filePath).catch(err => {
    console.error('Failed to open file:', err);
    dialog.showErrorBox('File Error', `Could not open file at: ${filePath}`);
  });
});

// Open file handler (new - returns promise for better error handling)
ipcMain.handle('open-file-external', async (event, filePath) => {
  try {
    const result = await shell.openPath(filePath);
    if (result) {
      // If result is not empty, there was an error
      throw new Error(result);
    }
    return { success: true };
  } catch (error) {
    console.error('Failed to open file:', error);
    return { success: false, error: error.message };
  }
});

// Legacy extraction handler (for backward compatibility)
ipcMain.handle('start-extraction', async (event, config) => {
  try {
    // Import and run the extraction logic
    const { runExtraction } = require('./extractor.js');
    return await runExtraction(config, (progress) => {
      // Send progress updates to renderer
      mainWindow.webContents.send('extraction-progress', progress);
    });
  } catch (error) {
    return { success: false, error: error.message };
  }
});
