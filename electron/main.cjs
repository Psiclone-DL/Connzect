const { app, BrowserWindow, dialog } = require('electron');
const http = require('http');
const https = require('https');
const { autoUpdater } = require('electron-updater');

const DEFAULT_URLS = ['http://5.75.169.93:3002', 'http://5.75.169.93'];
const CONFIGURED_URL = process.env.CONNZECT_WEB_URL;
const OPEN_DEVTOOLS = process.env.CONNZECT_DEVTOOLS === '1';
const AUTO_UPDATES_ENABLED =
  app.isPackaged && process.platform === 'win32' && process.env.CONNZECT_DISABLE_AUTO_UPDATES !== '1';

let mainWindow = null;

const log = (...values) => {
  // eslint-disable-next-line no-console
  console.log('[connzect-desktop]', ...values);
};

const waitForServer = (url, timeoutMs = 60_000) =>
  new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const target = new URL(url);
    const client = target.protocol === 'https:' ? https : http;

    const tryConnect = () => {
      const request = client.get(url, (response) => {
        response.resume();
        resolve();
      });

      request.on('error', () => {
        if (Date.now() - startedAt >= timeoutMs) {
          reject(new Error(`Timed out waiting for ${url}`));
          return;
        }

        setTimeout(tryConnect, 400);
      });
    };

    tryConnect();
  });

const resolveWebUrl = async () => {
  const candidates = CONFIGURED_URL ? [CONFIGURED_URL] : DEFAULT_URLS;
  const tried = [];

  for (const candidate of candidates) {
    tried.push(candidate);
    try {
      await waitForServer(candidate, 15_000);
      return candidate;
    } catch {
      // continue with next candidate
    }
  }

  throw new Error(`Cannot reach any web endpoint. Tried: ${tried.join(', ')}`);
};

const createMainWindow = async () => {
  const webUrl = await resolveWebUrl();

  const win = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 1100,
    minHeight: 720,
    backgroundColor: '#0f1716',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  await win.loadURL(webUrl);

  if (OPEN_DEVTOOLS) {
    win.webContents.openDevTools({ mode: 'detach' });
  }

  mainWindow = win;

  win.on('closed', () => {
    if (mainWindow === win) {
      mainWindow = null;
    }
  });
};

const setupAutoUpdates = () => {
  if (!AUTO_UPDATES_ENABLED) {
    log('Auto-updates disabled (dev mode, non-Windows, or CONNZECT_DISABLE_AUTO_UPDATES=1).');
    return;
  }

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => {
    log('Checking for updates...');
  });

  autoUpdater.on('update-available', (info) => {
    log(`Update available: ${info.version}`);
    if (mainWindow) {
      dialog.showMessageBox(mainWindow, {
        type: 'info',
        title: 'Connzect Update',
        message: `Se descarca update-ul ${info.version} in fundal.`
      });
    }
  });

  autoUpdater.on('update-not-available', () => {
    log('No updates available.');
  });

  autoUpdater.on('error', (error) => {
    log('Auto-update error:', error?.message || String(error));
  });

  autoUpdater.on('download-progress', (progress) => {
    const percent = Number(progress.percent || 0).toFixed(1);
    log(`Update download progress: ${percent}%`);
  });

  autoUpdater.on('update-downloaded', async (info) => {
    log(`Update downloaded: ${info.version}`);

    if (!mainWindow) {
      autoUpdater.quitAndInstall();
      return;
    }

    const result = await dialog.showMessageBox(mainWindow, {
      type: 'question',
      buttons: ['Restart now', 'Later'],
      defaultId: 0,
      cancelId: 1,
      title: 'Update ready',
      message: `Versiunea ${info.version} este gata de instalare.`,
      detail: 'Apasa "Restart now" pentru instalare imediata.'
    });

    if (result.response === 0) {
      setImmediate(() => autoUpdater.quitAndInstall());
    }
  });

  const checkUpdates = () => {
    autoUpdater.checkForUpdates().catch((error) => {
      log('Failed checking updates:', error?.message || String(error));
    });
  };

  setTimeout(checkUpdates, 5000);
  setInterval(checkUpdates, 30 * 60 * 1000);
};

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.whenReady().then(async () => {
  try {
    await createMainWindow();
    setupAutoUpdates();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown startup error';
    dialog.showErrorBox('Connzect Startup Error', message);
    app.quit();
  }
});
