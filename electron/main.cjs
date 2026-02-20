const { app, BrowserWindow, dialog } = require('electron');
const http = require('http');
const https = require('https');

const WEB_URL = process.env.CONNZECT_WEB_URL || 'https://connzect.ro';
const OPEN_DEVTOOLS = process.env.CONNZECT_DEVTOOLS === '1';

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

const createMainWindow = async () => {
  await waitForServer(WEB_URL).catch(() => {
    throw new Error(`Cannot reach ${WEB_URL}. Check VPS/domain and internet connection.`);
  });

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

  await win.loadURL(WEB_URL);

  if (OPEN_DEVTOOLS) {
    win.webContents.openDevTools({ mode: 'detach' });
  }
};

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.whenReady().then(async () => {
  try {
    await createMainWindow();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown startup error';
    dialog.showErrorBox('Connzect Startup Error', message);
    app.quit();
  }
});
