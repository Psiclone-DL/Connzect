const { app, BrowserWindow, dialog } = require('electron');
const { spawn } = require('child_process');
const fs = require('fs');
const http = require('http');
const path = require('path');

const WEB_PORT = Number(process.env.CONNZECT_WEB_PORT || 3000);
const API_PORT = Number(process.env.CONNZECT_API_PORT || 4000);
const WEB_URL = `http://127.0.0.1:${WEB_PORT}`;
const EXTERNAL_SERVERS = process.env.CONNZECT_EXTERNAL_SERVERS === '1';

const runtimeChildren = [];

const waitForServer = (url, timeoutMs = 60_000) =>
  new Promise((resolve, reject) => {
    const startedAt = Date.now();

    const tryConnect = () => {
      const request = http.get(url, (response) => {
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

const startNodeScript = (scriptPath, options = {}) => {
  const child = spawn(process.execPath, [scriptPath], {
    cwd: options.cwd,
    env: {
      ...process.env,
      ...(options.env || {}),
      ELECTRON_RUN_AS_NODE: '1'
    },
    stdio: 'inherit',
    windowsHide: true
  });

  runtimeChildren.push(child);

  child.on('exit', (code, signal) => {
    if (!app.isQuitting) {
      const reason = signal ? `signal ${signal}` : `code ${code}`;
      dialog
        .showErrorBox('Connzect Runtime Stopped', `A background service exited unexpectedly (${reason}).`)
        .toString();
    }
  });

  return child;
};

const startInternalRuntime = async () => {
  const rootDir = path.resolve(__dirname, '..');
  const backendEntry = path.join(rootDir, 'backend', 'dist', 'index.js');
  const frontendEntry = path.join(rootDir, 'frontend', '.next', 'standalone', 'server.js');

  if (!fs.existsSync(backendEntry)) {
    throw new Error(`Missing backend build at ${backendEntry}. Run: npm run build:desktop`);
  }

  if (!fs.existsSync(frontendEntry)) {
    throw new Error(`Missing frontend standalone build at ${frontendEntry}. Run: npm run build:desktop`);
  }

  startNodeScript(backendEntry, {
    cwd: path.join(rootDir, 'backend'),
    env: {
      NODE_ENV: 'production',
      PORT: String(API_PORT),
      CLIENT_ORIGIN: WEB_URL,
      DATABASE_URL:
        process.env.DATABASE_URL || 'postgresql://postgres:postgres@127.0.0.1:5432/connzect?schema=public',
      JWT_ACCESS_SECRET:
        process.env.JWT_ACCESS_SECRET || 'connzect-desktop-access-secret-change-in-production-1234567890',
      JWT_REFRESH_SECRET:
        process.env.JWT_REFRESH_SECRET || 'connzect-desktop-refresh-secret-change-in-production-1234567890',
      JWT_ACCESS_EXPIRES_IN: process.env.JWT_ACCESS_EXPIRES_IN || '15m',
      JWT_REFRESH_EXPIRES_IN: process.env.JWT_REFRESH_EXPIRES_IN || '7d'
    }
  });

  startNodeScript(frontendEntry, {
    cwd: path.join(rootDir, 'frontend', '.next', 'standalone'),
    env: {
      NODE_ENV: 'production',
      PORT: String(WEB_PORT),
      HOSTNAME: '127.0.0.1'
    }
  });
};

const createMainWindow = async () => {
  if (!EXTERNAL_SERVERS) {
    await startInternalRuntime();
  }

  await waitForServer(WEB_URL);

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
};

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  app.isQuitting = true;

  for (const child of runtimeChildren) {
    if (!child.killed) {
      child.kill();
    }
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
