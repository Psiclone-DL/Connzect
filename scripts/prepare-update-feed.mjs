import fs from 'node:fs';
import path from 'node:path';

const rootDir = process.cwd();
const distDir = path.join(rootDir, 'desktop-dist');
const feedDir = path.join(rootDir, 'updates', 'win');

if (!fs.existsSync(distDir)) {
  console.error(`Missing ${distDir}. Run "npm run dist:win" first.`);
  process.exit(1);
}

fs.mkdirSync(feedDir, { recursive: true });

for (const entry of fs.readdirSync(feedDir)) {
  if (entry === '.gitkeep') continue;
  fs.rmSync(path.join(feedDir, entry), { recursive: true, force: true });
}

const distEntries = fs.readdirSync(distDir);
const filesToCopy = distEntries.filter(
  (name) => name === 'latest.yml' || name.endsWith('.exe') || name.endsWith('.blockmap')
);

if (!filesToCopy.includes('latest.yml')) {
  console.error(`desktop-dist/latest.yml not found. Build likely failed.`);
  process.exit(1);
}

for (const fileName of filesToCopy) {
  const source = path.join(distDir, fileName);
  const target = path.join(feedDir, fileName);
  fs.copyFileSync(source, target);
}

console.log(`Prepared update feed in: ${feedDir}`);
for (const fileName of filesToCopy) {
  console.log(`- ${fileName}`);
}

console.log('\nNext step: upload updates/win/* to VPS path /root/Connzect/updates/win/');
