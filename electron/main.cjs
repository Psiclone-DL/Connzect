const { app, BrowserWindow } = require('electron');
const http = require('http');
const https = require('https');
const { autoUpdater } = require('electron-updater');

const DEFAULT_URLS = ['http://5.75.169.93:3002', 'http://5.75.169.93'];
const CONFIGURED_URL = process.env.CONNZECT_WEB_URL;
const OPEN_DEVTOOLS = process.env.CONNZECT_DEVTOOLS === '1';
const AUTO_UPDATES_ENABLED =
  app.isPackaged && process.platform === 'win32' && process.env.CONNZECT_DISABLE_AUTO_UPDATES !== '1';
const WEB_ENDPOINT_TIMEOUT_MS = 12_000;
const RECONNECT_INTERVAL_MS = 10_000;

let mainWindow = null;
let installingUpdate = false;
let reconnectTimer = null;

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

const renderConnectingScreen = async (message = 'Connecting to Connzect service...') => {
  if (!mainWindow || mainWindow.isDestroyed()) return;

  const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Connzect</title>
  <style>
    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      background: radial-gradient(circle at 20% -10%, #1a3b35 0%, transparent 42%), #070f0e;
      color: #d6f9ef;
      font-family: "Segoe UI", Roboto, sans-serif;
    }
    .card {
      width: min(560px, 92vw);
      border: 1px solid rgba(200, 255, 238, 0.22);
      border-radius: 20px;
      padding: 24px;
      background: rgba(12, 22, 20, 0.9);
      box-shadow: 0 20px 40px rgba(0, 0, 0, 0.38);
    }
    .title {
      margin: 0 0 8px;
      font-size: 22px;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }
    .text {
      margin: 0;
      color: rgba(220, 255, 245, 0.86);
      line-height: 1.5;
      white-space: pre-wrap;
    }
  </style>
</head>
<body>
  <div class="card">
    <h1 class="title">Connzect</h1>
    <p class="text">${message}</p>
  </div>
</body>
</html>`;

  const dataUrl = `data:text/html;charset=UTF-8,${encodeURIComponent(html)}`;
  await mainWindow.loadURL(dataUrl);
};

const resolveWebUrl = async () => {
  const candidates = CONFIGURED_URL ? [CONFIGURED_URL] : DEFAULT_URLS;
  const tried = [];

  for (const candidate of candidates) {
    tried.push(candidate);
    try {
      await waitForServer(candidate, WEB_ENDPOINT_TIMEOUT_MS);
      return candidate;
    } catch {
      // continue with next candidate
    }
  }

  throw new Error(`Cannot reach any web endpoint. Tried: ${tried.join(', ')}`);
};

const createMainWindow = () => {
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

  mainWindow = win;

  win.on('closed', () => {
    if (mainWindow === win) {
      mainWindow = null;
    }
    if (reconnectTimer) {
      clearInterval(reconnectTimer);
      reconnectTimer = null;
    }
  });

  return win;
};

const stopReconnectLoop = () => {
  if (reconnectTimer) {
    clearInterval(reconnectTimer);
    reconnectTimer = null;
  }
};

const ensureReconnectLoop = () => {
  if (reconnectTimer) return;
  reconnectTimer = setInterval(() => {
    loadWebApp().catch((error) => {
      log('Reconnect loop error:', error?.message || String(error));
    });
  }, RECONNECT_INTERVAL_MS);
};

const loadWebApp = async () => {
  if (!mainWindow || mainWindow.isDestroyed()) return;

  try {
    const webUrl = await resolveWebUrl();
    if (mainWindow.webContents.getURL() !== webUrl) {
      await mainWindow.loadURL(webUrl);
    }

    if (OPEN_DEVTOOLS && !mainWindow.webContents.isDevToolsOpened()) {
      mainWindow.webContents.openDevTools({ mode: 'detach' });
    }

    stopReconnectLoop();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Service is unavailable';
    log('Web app unavailable:', message);
    await renderConnectingScreen(`${message}\n\nRetrying automatically every 10 seconds...`);
    ensureReconnectLoop();
  }
};

const setupAutoUpdates = () => {
  if (!AUTO_UPDATES_ENABLED) {
    log('Auto-updates disabled (dev mode, non-Windows, or CONNZECT_DISABLE_AUTO_UPDATES=1).');
    return;
  }

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.autoRunAppAfterInstall = true;

  autoUpdater.on('checking-for-update', () => {
    log('Checking for updates...');
  });

  autoUpdater.on('update-available', (info) => {
    log(`Update available: ${info.version}`);
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

  autoUpdater.on('update-downloaded', (info) => {
    log(`Update downloaded: ${info.version}`);

    if (installingUpdate) {
      log('Update install already in progress. Skipping duplicate trigger.');
      return;
    }

    installingUpdate = true;
    log('Installing update silently and restarting app...');

    if (mainWindow && !mainWindow.isDestroyed()) {
      try {
        // Prevent visible flicker/crash-like feel while installer takes over.
        mainWindow.setOpacity(0);
        mainWindow.minimize();
      } catch (error) {
        log('Failed to transition window before update:', error?.message || String(error));
      }
    }

    setTimeout(() => {
      try {
        // isSilent=true, isForceRunAfter=true
        autoUpdater.quitAndInstall(true, true);
      } catch (error) {
        log('Silent quitAndInstall failed, falling back to app.quit():', error?.message || String(error));
        app.quit();
      }
    }, 900);
  });

  log('Using GitHub Releases auto-update provider.');

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

app.on('before-quit', () => {
  stopReconnectLoop();
});

app.whenReady().then(async () => {
  try {
    createMainWindow();
    await renderConnectingScreen();
    await loadWebApp();
    setupAutoUpdates();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown startup error';
    log('Startup fatal error:', message);
    app.quit();
  }
});
