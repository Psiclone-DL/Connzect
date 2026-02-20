const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const nextBuildDir = path.join(rootDir, 'frontend', '.next');
const standaloneDir = path.join(nextBuildDir, 'standalone');
const standaloneNextDir = path.join(standaloneDir, '.next');
const staticSourceDir = path.join(nextBuildDir, 'static');
const staticTargetDir = path.join(standaloneNextDir, 'static');
const publicSourceDir = path.join(rootDir, 'frontend', 'public');
const publicTargetDir = path.join(standaloneDir, 'public');

if (!fs.existsSync(standaloneDir)) {
  console.error('Missing standalone build. Run `npm run build --workspace frontend` first.');
  process.exit(1);
}

fs.mkdirSync(standaloneNextDir, { recursive: true });

if (fs.existsSync(staticSourceDir)) {
  fs.cpSync(staticSourceDir, staticTargetDir, { recursive: true });
}

if (fs.existsSync(publicSourceDir)) {
  fs.cpSync(publicSourceDir, publicTargetDir, { recursive: true });
}

console.log('Desktop assets prepared.');
