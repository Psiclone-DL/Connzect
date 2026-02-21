const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const nextBuildDir = path.join(rootDir, 'frontend', '.next');
const standaloneDir = path.join(nextBuildDir, 'standalone');
const runtimeDir = path.join(rootDir, 'desktop-runtime');
const staticSourceDir = path.join(nextBuildDir, 'static');
const staticTargetDir = path.join(runtimeDir, '.next', 'static');
const publicSourceDir = path.join(rootDir, 'frontend', 'public');
const publicTargetDir = path.join(runtimeDir, 'public');
const runtimeServerEntryDirect = path.join(runtimeDir, 'server.js');
const runtimeServerEntryWorkspace = path.join(runtimeDir, 'frontend', 'server.js');

if (!fs.existsSync(standaloneDir)) {
  console.error('Missing standalone build. Run `npm run build --workspace frontend` first.');
  process.exit(1);
}

fs.rmSync(runtimeDir, { recursive: true, force: true });
fs.cpSync(standaloneDir, runtimeDir, { recursive: true });
fs.mkdirSync(path.dirname(staticTargetDir), { recursive: true });

if (fs.existsSync(staticSourceDir)) {
  fs.cpSync(staticSourceDir, staticTargetDir, { recursive: true });
}

if (fs.existsSync(publicSourceDir)) {
  fs.cpSync(publicSourceDir, publicTargetDir, { recursive: true });
}

if (!fs.existsSync(runtimeServerEntryDirect) && !fs.existsSync(runtimeServerEntryWorkspace)) {
  console.error(
    `Missing runtime server entry at ${runtimeServerEntryDirect} or ${runtimeServerEntryWorkspace}`
  );
  process.exit(1);
}

console.log(`Desktop assets prepared at ${runtimeDir}`);
