const { app, BrowserWindow, Menu, Tray, nativeImage } = require('electron');
const fs = require('fs');
const http = require('http');
const https = require('https');
const path = require('path');
const { pathToFileURL } = require('url');
const { autoUpdater } = require('electron-updater');

const DEFAULT_URLS = ['http://5.75.169.93:3002', 'http://5.75.169.93'];
const CONFIGURED_URL = process.env.CONNZECT_WEB_URL;
const OPEN_DEVTOOLS = process.env.CONNZECT_DEVTOOLS === '1';
const AUTO_UPDATES_ENABLED =
  app.isPackaged && process.platform === 'win32' && process.env.CONNZECT_DISABLE_AUTO_UPDATES !== '1';
const WEB_ENDPOINT_TIMEOUT_MS = 12_000;
const RECONNECT_INTERVAL_MS = 10_000;
const INITIAL_UPDATE_CHECK_TIMEOUT_MS = 10_000;
const PERIODIC_UPDATE_CHECK_MS = 30 * 60 * 1000;
const SPLASH_WIDTH = 620;
const SPLASH_HEIGHT = 420;
const SPLASH_TITLE = 'Connzect';
const STARTUP_STATUS = 'Launching client...';
const APP_VERSION_LABEL = `Version ${app.getVersion()}`;
const TRAY_TOOLTIP = 'Connzect';
const TRAY_BALLOON_TITLE = 'Connzect is still running';
const TRAY_BALLOON_TEXT = 'Connzect was minimized to tray. Click the tray icon to reopen.';
const UPDATE_READY_BALLOON_TITLE = 'Update ready';
const UPDATE_READY_BALLOON_TEXT = 'The new version was downloaded and will install when you quit Connzect.';

let mainWindow = null;
let splashWindow = null;
let appTray = null;
let installingUpdate = false;
let isQuitting = false;
let trayMinimizeHintShown = false;
let updateReadyHintShown = false;
let reconnectTimer = null;
let periodicUpdateCheckTimer = null;
let updateCheckInFlight = false;
let hasDownloadedUpdate = false;
let splashLoaded = false;
let startupCompleted = false;
let waitingInitialUpdateCheck = AUTO_UPDATES_ENABLED;
let initialUpdateCheckTimeout = null;
let pendingMainRevealAfterStartup = false;
let splashStatus = {
  title: SPLASH_TITLE,
  message: STARTUP_STATUS,
  percent: null,
  alert: false
};

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

const appendDesktopVersionParam = (url) => {
  try {
    const target = new URL(url);
    target.searchParams.set('desktopVersion', app.getVersion());
    return target.toString();
  } catch {
    return url;
  }
};

const syncDesktopVersionInRenderer = (win) => {
  if (!win || win.isDestroyed()) return;

  const safeVersion = String(app.getVersion() ?? '')
    .trim()
    .replace(/[^0-9a-zA-Z.+_-]/g, '')
    .slice(0, 32);

  if (!safeVersion) return;
  const safeVersionLiteral = JSON.stringify(safeVersion);
  const script = `
    (() => {
      try {
        const version = ${safeVersionLiteral};
        if (!version) return;
        window.__CONNZECT_DESKTOP_VERSION__ = version;
        try {
          window.localStorage.setItem('connzect:desktop-version', version);
        } catch {}
        window.dispatchEvent(new CustomEvent('connzect:desktop-version', { detail: version }));
      } catch {}
    })();
  `;

  win.webContents.executeJavaScript(script, true).catch(() => undefined);
};

const resolveSplashLogoSource = () => {
  const candidates = [];
  const customPath = process.env.CONNZECT_SPLASH_LOGO_PATH;
  if (customPath) {
    candidates.push(path.isAbsolute(customPath) ? customPath : path.resolve(process.cwd(), customPath));
  }

  candidates.push(path.resolve(process.cwd(), 'electron', 'assets', 'logo.png'));

  if (process.resourcesPath) {
    candidates.push(path.join(process.resourcesPath, 'electron', 'assets', 'logo.png'));
    candidates.push(path.join(process.resourcesPath, 'app', 'electron', 'assets', 'logo.png'));
  }

  for (const candidate of candidates) {
    if (!candidate) continue;
    if (!fs.existsSync(candidate)) continue;
    return pathToFileURL(candidate).toString();
  }

  return null;
};

const resolveTrayIcon = () => {
  const candidates = [];
  const customPath = process.env.CONNZECT_TRAY_ICON_PATH;
  if (customPath) {
    candidates.push(path.isAbsolute(customPath) ? customPath : path.resolve(process.cwd(), customPath));
  }

  candidates.push(path.resolve(process.cwd(), 'electron', 'assets', 'tray.ico'));
  candidates.push(path.resolve(process.cwd(), 'electron', 'assets', 'icon.ico'));
  candidates.push(path.resolve(process.cwd(), 'build', 'icon.ico'));
  candidates.push(path.resolve(process.cwd(), 'icon.ico'));
  candidates.push(process.execPath);

  for (const candidate of candidates) {
    if (!candidate || !fs.existsSync(candidate)) continue;
    const icon = nativeImage.createFromPath(candidate);
    if (icon.isEmpty()) continue;
    return process.platform === 'win32' ? icon.resize({ width: 16, height: 16 }) : icon;
  }

  const fallbackSvg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
      <rect x="4" y="4" width="56" height="56" rx="14" fill="#065f46"/>
      <path d="M39.5 22.5a13 13 0 1 0 0 19" stroke="#ecfdf5" stroke-width="6" stroke-linecap="round" fill="none"/>
    </svg>
  `;
  const fallback = nativeImage.createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(fallbackSvg).toString('base64')}`);
  return process.platform === 'win32' ? fallback.resize({ width: 16, height: 16 }) : fallback;
};

const buildSplashHtml = () => {
  const logoSrc = resolveSplashLogoSource();
  const logoMarkup = logoSrc
    ? `<img class="logo-image" src="${logoSrc}" alt="Connzect logo" />`
    : `<div class="logo-fallback" aria-hidden="true">C</div>`;

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Connzect</title>
  <style>
    :root {
      color-scheme: dark;
    }
    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      background:
        radial-gradient(circle at 16% -10%, rgba(52, 211, 153, 0.20) 0%, transparent 45%),
        radial-gradient(circle at 80% 110%, rgba(16, 185, 129, 0.18) 0%, transparent 52%),
        #05100d;
      color: #e7fff6;
      font-family: "Segoe UI", Roboto, sans-serif;
      user-select: none;
    }
    .shell {
      width: min(580px, 92vw);
      border: 1px solid rgba(196, 255, 235, 0.26);
      border-radius: 24px;
      padding: 28px;
      background: rgba(7, 20, 16, 0.82);
      box-shadow: 0 24px 64px rgba(0, 0, 0, 0.45);
      backdrop-filter: blur(8px);
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 14px;
      margin-bottom: 16px;
    }
    .logo-fallback,
    .logo-image {
      width: 56px;
      height: 56px;
      border-radius: 16px;
      border: 1px solid rgba(196, 255, 235, 0.35);
      background: linear-gradient(145deg, rgba(16, 185, 129, 0.4), rgba(6, 95, 70, 0.35));
      object-fit: cover;
      display: grid;
      place-items: center;
      font-size: 24px;
      font-weight: 700;
      letter-spacing: 0.02em;
      color: #effff8;
    }
    .title {
      margin: 0;
      font-size: 30px;
      letter-spacing: 0.12em;
      text-transform: uppercase;
    }
    .status {
      margin: 0;
      color: rgba(226, 255, 246, 0.9);
      font-size: 15px;
      line-height: 1.45;
      min-height: 44px;
      white-space: pre-wrap;
      transition: color 120ms ease, font-size 120ms ease, font-weight 120ms ease;
    }
    .status.alert {
      color: #ecfdf5;
      font-size: 22px;
      line-height: 1.25;
      font-weight: 800;
    }
    .progress {
      margin-top: 14px;
    }
    .progress-line {
      position: relative;
      width: 100%;
      height: 10px;
      border-radius: 999px;
      border: 1px solid rgba(196, 255, 235, 0.25);
      background: rgba(209, 250, 229, 0.12);
      overflow: hidden;
    }
    .progress-fill {
      height: 100%;
      width: 0%;
      border-radius: inherit;
      background: linear-gradient(90deg, rgba(74, 222, 128, 0.86), rgba(16, 185, 129, 0.95));
      transition: width 120ms linear;
    }
    .percent {
      margin-top: 8px;
      text-align: right;
      font-size: 12px;
      color: rgba(203, 255, 233, 0.88);
      min-height: 16px;
    }
    .footer {
      margin-top: 10px;
      text-align: right;
      font-size: 12px;
      color: rgba(203, 255, 233, 0.76);
      letter-spacing: 0.02em;
    }
  </style>
</head>
<body>
  <section class="shell">
    <div class="brand">
      ${logoMarkup}
      <h1 id="title" class="title">Connzect</h1>
    </div>
    <p id="status" class="status">Launching client...</p>
    <div class="progress">
      <div class="progress-line">
        <div id="progress-fill" class="progress-fill"></div>
      </div>
      <p id="percent" class="percent"></p>
    </div>
    <p class="footer">${APP_VERSION_LABEL}</p>
  </section>
  <script>
    (function () {
      const titleEl = document.getElementById('title');
      const statusEl = document.getElementById('status');
      const fillEl = document.getElementById('progress-fill');
      const percentEl = document.getElementById('percent');

      window.updateConnzectSplash = function updateConnzectSplash(payload) {
        if (!payload || typeof payload !== 'object') return;

        if (typeof payload.title === 'string' && payload.title.trim()) {
          titleEl.textContent = payload.title;
        }

        if (typeof payload.message === 'string' && payload.message.trim()) {
          statusEl.textContent = payload.message;
        }

        statusEl.classList.toggle('alert', Boolean(payload.alert));

        if (typeof payload.percent === 'number' && Number.isFinite(payload.percent)) {
          const normalized = Math.max(0, Math.min(100, payload.percent));
          fillEl.style.width = normalized.toFixed(1) + '%';
          percentEl.textContent = normalized.toFixed(1) + '%';
        } else {
          fillEl.style.width = '0%';
          percentEl.textContent = '';
        }

      };
    })();
  </script>
</body>
</html>`;
};

const hideMainWindow = () => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isVisible()) {
    mainWindow.hide();
  }
};

const showMainWindow = () => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (!mainWindow.isVisible()) {
    mainWindow.show();
  }
};

const restoreMainWindow = () => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  showMainWindow();
  mainWindow.focus();
};

const showTrayMinimizeHint = () => {
  if (!appTray || trayMinimizeHintShown || process.platform !== 'win32') {
    return;
  }

  trayMinimizeHintShown = true;
  try {
    appTray.displayBalloon({
      title: TRAY_BALLOON_TITLE,
      content: TRAY_BALLOON_TEXT,
      iconType: 'info'
    });
  } catch {
    // Ignore if balloon notifications are unsupported on this system.
  }
};

const ensureTray = () => {
  if (appTray) {
    return appTray;
  }

  try {
    appTray = new Tray(resolveTrayIcon());
  } catch (error) {
    log('Failed to create tray icon:', error?.message || String(error));
    appTray = null;
    return null;
  }

  appTray.setToolTip(TRAY_TOOLTIP);
  appTray.on('click', () => {
    restoreMainWindow();
  });
  appTray.on('double-click', () => {
    restoreMainWindow();
  });

  refreshTrayMenu();
  return appTray;
};

const refreshTrayMenu = () => {
  if (!appTray) {
    return;
  }

  appTray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: 'Open Connzect',
        click: () => restoreMainWindow()
      },
      { type: 'separator' },
      {
        label: hasDownloadedUpdate ? 'Quit and Install Update' : 'Quit',
        click: () => {
          if (hasDownloadedUpdate) {
            installingUpdate = true;
            log('Applying downloaded update on quit.');
          }
          isQuitting = true;
          app.quit();
        }
      }
    ])
  );
};

const showUpdateReadyHint = () => {
  if (!appTray || updateReadyHintShown || process.platform !== 'win32') {
    return;
  }

  updateReadyHintShown = true;
  try {
    appTray.displayBalloon({
      title: UPDATE_READY_BALLOON_TITLE,
      content: UPDATE_READY_BALLOON_TEXT,
      iconType: 'info'
    });
  } catch {
    // Ignore if balloon notifications are unsupported on this system.
  }
};

const createSplashWindow = () => {
  const win = new BrowserWindow({
    width: SPLASH_WIDTH,
    height: SPLASH_HEIGHT,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    frame: false,
    transparent: false,
    show: false,
    center: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    backgroundColor: '#06130f',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  win.once('ready-to-show', () => {
    if (!win.isDestroyed()) {
      win.show();
    }
  });

  win.on('closed', () => {
    if (splashWindow === win) {
      splashWindow = null;
      splashLoaded = false;
    }
  });

  splashWindow = win;
  return win;
};

const ensureSplashWindow = async () => {
  if (splashWindow && !splashWindow.isDestroyed()) {
    return splashWindow;
  }

  const win = createSplashWindow();
  const html = buildSplashHtml();
  const dataUrl = `data:text/html;charset=UTF-8,${encodeURIComponent(html)}`;
  await win.loadURL(dataUrl);
  splashLoaded = true;
  return win;
};

const setSplashStatus = async ({
  title = SPLASH_TITLE,
  message = STARTUP_STATUS,
  percent = null,
  alert = false
} = {}) => {
  const normalizedPercent = typeof percent === 'number' && Number.isFinite(percent) ? Math.max(0, Math.min(100, percent)) : null;
  splashStatus = {
    title,
    message,
    percent: normalizedPercent,
    alert: Boolean(alert)
  };

  const win = await ensureSplashWindow();
  if (!win || win.isDestroyed()) return;
  if (!win.isVisible()) {
    win.show();
  }
  if (!splashLoaded || win.webContents.isLoadingMainFrame()) {
    return;
  }

  const payload = JSON.stringify(splashStatus);
  await win.webContents
    .executeJavaScript(`window.updateConnzectSplash(${payload});`, true)
    .catch(() => undefined);
};

const closeSplashWindow = () => {
  if (!splashWindow || splashWindow.isDestroyed()) {
    splashWindow = null;
    splashLoaded = false;
    return;
  }
  splashWindow.close();
  splashWindow = null;
  splashLoaded = false;
};

const tryRevealMainWindowAfterStartup = () => {
  if (!startupCompleted) {
    return;
  }

  if (waitingInitialUpdateCheck) {
    pendingMainRevealAfterStartup = true;
    return;
  }

  pendingMainRevealAfterStartup = false;
  showMainWindow();
  closeSplashWindow();
};

const markInitialUpdateCheckSettled = () => {
  if (!waitingInitialUpdateCheck) {
    return;
  }

  waitingInitialUpdateCheck = false;

  if (initialUpdateCheckTimeout) {
    clearTimeout(initialUpdateCheckTimeout);
    initialUpdateCheckTimeout = null;
  }

  if (pendingMainRevealAfterStartup) {
    tryRevealMainWindowAfterStartup();
  }
};

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
  ensureTray();

  const win = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 1100,
    minHeight: 720,
    show: false,
    backgroundColor: '#0f1716',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow = win;
  win.webContents.on('did-finish-load', () => {
    syncDesktopVersionInRenderer(win);
  });

  win.on('close', (event) => {
    if (isQuitting || installingUpdate) {
      return;
    }

    if (!appTray) {
      return;
    }

    event.preventDefault();
    hideMainWindow();
    showTrayMinimizeHint();
  });

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
    if (!startupCompleted) {
      await setSplashStatus({ message: 'Connecting to Connzect services...' });
    }

    const webUrl = await resolveWebUrl();
    const targetWebUrl = appendDesktopVersionParam(webUrl);
    if (mainWindow.webContents.getURL() !== targetWebUrl) {
      if (!startupCompleted) {
        await setSplashStatus({ message: 'Opening Connzect workspace...' });
      }
      await mainWindow.loadURL(targetWebUrl);
    }

    if (OPEN_DEVTOOLS && !mainWindow.webContents.isDevToolsOpened()) {
      mainWindow.webContents.openDevTools({ mode: 'detach' });
    }

    startupCompleted = true;
    tryRevealMainWindowAfterStartup();
    stopReconnectLoop();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Service is unavailable';
    log('Web app unavailable:', message);
    await renderConnectingScreen(`${message}\n\nRetrying automatically every 10 seconds...`);
    markInitialUpdateCheckSettled();
    startupCompleted = true;
    showMainWindow();
    closeSplashWindow();
    ensureReconnectLoop();
  }
};

const setupAutoUpdates = () => {
  if (!AUTO_UPDATES_ENABLED) {
    log('Auto-updates disabled (dev mode, non-Windows, or CONNZECT_DISABLE_AUTO_UPDATES=1).');
    return;
  }

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.autoRunAppAfterInstall = true;

  autoUpdater.on('checking-for-update', () => {
    log('Checking for updates...');
    if (!startupCompleted) {
      setSplashStatus({
        message: 'Checking for updates...',
        percent: null,
        alert: false
      }).catch(() => undefined);
    }
  });

  autoUpdater.on('update-available', (info) => {
    log(`Update available: ${info.version}`);
    markInitialUpdateCheckSettled();
    hasDownloadedUpdate = false;
    updateReadyHintShown = false;
    refreshTrayMenu();
    if (!startupCompleted) {
      setSplashStatus({
        message: 'New update found. Downloading in background...',
        percent: 0,
        alert: false
      }).catch(() => undefined);
    }
  });

  autoUpdater.on('update-not-available', () => {
    log('No updates available.');
    markInitialUpdateCheckSettled();
  });

  autoUpdater.on('error', (error) => {
    log('Auto-update error:', error?.message || String(error));
    markInitialUpdateCheckSettled();
    if (!startupCompleted) {
      setSplashStatus({
        message: `Update failed: ${error?.message || 'Unknown error'}`,
        percent: null,
        alert: true
      }).catch(() => undefined);
    }
  });

  autoUpdater.on('download-progress', (progress) => {
    const percent = Number(progress.percent || 0).toFixed(1);
    log(`Update download progress: ${percent}%`);
    if (!startupCompleted) {
      setSplashStatus({
        message: `Downloading update... ${percent}%`,
        percent: Number(percent),
        alert: false
      }).catch(() => undefined);
    }
  });

  autoUpdater.on('update-downloaded', (info) => {
    log(`Update downloaded: ${info.version}`);
    markInitialUpdateCheckSettled();
    hasDownloadedUpdate = true;
    refreshTrayMenu();
    showUpdateReadyHint();
    log('Update will install silently when the app is quit.');
    if (!startupCompleted) {
      setSplashStatus({
        message: 'Update downloaded. It will install when you quit Connzect.',
        percent: 100,
        alert: false
      }).catch(() => undefined);
    }
  });

  log('Using GitHub Releases auto-update provider.');

  const checkUpdates = (reason) => {
    if (updateCheckInFlight) {
      log(`Skipping update check (${reason}); check already in progress.`);
      return;
    }

    if (installingUpdate || hasDownloadedUpdate) {
      log(`Skipping update check (${reason}); update flow already active.`);
      return;
    }

    updateCheckInFlight = true;
    autoUpdater
      .checkForUpdates()
      .catch((error) => {
        log('Failed checking updates:', error?.message || String(error));
        markInitialUpdateCheckSettled();
      })
      .finally(() => {
        updateCheckInFlight = false;
      });
  };

  if (waitingInitialUpdateCheck) {
    initialUpdateCheckTimeout = setTimeout(() => {
      log(`Initial update check timed out after ${INITIAL_UPDATE_CHECK_TIMEOUT_MS}ms, continuing startup.`);
      markInitialUpdateCheckSettled();
    }, INITIAL_UPDATE_CHECK_TIMEOUT_MS);
  }

  checkUpdates('startup');

  if (periodicUpdateCheckTimer) {
    clearInterval(periodicUpdateCheckTimer);
  }

  periodicUpdateCheckTimer = setInterval(() => {
    checkUpdates('periodic-30m');
  }, PERIODIC_UPDATE_CHECK_MS);
};

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  isQuitting = true;
  if (appTray) {
    appTray.destroy();
    appTray = null;
  }
  if (periodicUpdateCheckTimer) {
    clearInterval(periodicUpdateCheckTimer);
    periodicUpdateCheckTimer = null;
  }
  stopReconnectLoop();
  closeSplashWindow();
});

app.whenReady().then(async () => {
  try {
    await setSplashStatus({
      title: SPLASH_TITLE,
      message: STARTUP_STATUS,
      percent: null
    });
    createMainWindow();
    await loadWebApp();
    setupAutoUpdates();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown startup error';
    log('Startup fatal error:', message);
    app.quit();
  }
});
