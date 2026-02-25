const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const downloadsDir = path.join(rootDir, 'frontend', 'public', 'downloads');
const TARGET_INSTALLER_NAME = 'Connzect-Setup-latest.exe';

const args = process.argv.slice(2);

const readArgValue = (flag) => {
  const index = args.findIndex((arg) => arg === flag);
  if (index < 0 || index + 1 >= args.length) return '';
  return args[index + 1];
};

const gatherInstallerCandidates = () => {
  const distDir = path.join(rootDir, 'desktop-dist');
  try {
    const entries = fs.readdirSync(distDir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && /^Connzect Setup .*\.exe$/i.test(entry.name))
      .map((entry) => path.join(distDir, entry.name));
  } catch {
    return [];
  }
};

const ensureDir = (dir) => {
  fs.mkdirSync(dir, { recursive: true });
};

const findLatestByMtime = (files) => {
  let latestPath = '';
  let latestMtime = 0;

  for (const filePath of files) {
    try {
      const stat = fs.statSync(filePath);
      if (!stat.isFile()) continue;
      if (stat.mtimeMs > latestMtime) {
        latestMtime = stat.mtimeMs;
        latestPath = filePath;
      }
    } catch {
      // Skip missing/unreadable files.
    }
  }

  return latestPath;
};

const resolveCandidate = (inputPath) => {
  if (!inputPath) return '';
  if (path.isAbsolute(inputPath)) return inputPath;
  return path.resolve(rootDir, inputPath);
};

const copyIfFound = ({ source, targetName, label }) => {
  const targetPath = path.join(downloadsDir, targetName);
  if (!source) {
    if (fs.existsSync(targetPath)) {
      console.log(`[downloads] ${label}: source missing, keeping existing ${targetPath}`);
      return true;
    }
    console.warn(`[downloads] ${label}: source missing and no existing target (${targetPath})`);
    return false;
  }

  try {
    fs.copyFileSync(source, targetPath);
    console.log(`[downloads] ${label}: copied ${source} -> ${targetPath}`);
    return true;
  } catch (error) {
    console.error(`[downloads] ${label}: failed to copy ${source} -> ${targetPath}`);
    console.error(error instanceof Error ? error.message : String(error));
    return false;
  }
};

const strict = args.includes('--strict');
const explicitInstaller = resolveCandidate(readArgValue('--installer'));
const installerSource =
  explicitInstaller && fs.existsSync(explicitInstaller)
    ? explicitInstaller
    : findLatestByMtime(gatherInstallerCandidates());

ensureDir(downloadsDir);

const installerOk = copyIfFound({
  source: installerSource,
  targetName: TARGET_INSTALLER_NAME,
  label: 'Installer'
});

if (strict && !installerOk) {
  process.exitCode = 1;
}
