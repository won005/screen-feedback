import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import './copy-notices.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const destination = join(root, 'artifacts', 'packages');
mkdirSync(destination, { recursive: true });
const npm = process.env.npm_execpath;
if (!npm) throw new Error('Run through npm scripts.');
for (const name of ['core', 'http', 'react', 'react-native']) {
  const cwd = join(root, 'packages', name);
  const result = spawnSync(process.execPath, [npm, 'pack', '--json', '--pack-destination', destination], { cwd, encoding: 'utf8' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
  const output = result.stdout;
  const data = JSON.parse(output.slice(output.indexOf('['), output.lastIndexOf(']') + 1))[0];
  const paths = new Set(data.files.map(file => file.path));
  for (const path of ['LICENSE', 'THIRD_PARTY_NOTICES.md', 'README.md', 'dist/index.js', 'dist/index.d.ts']) {
    if (!paths.has(path)) throw new Error(`${name}: missing package file ${path}`);
  }
  const notice = readFileSync(join(cwd, 'THIRD_PARTY_NOTICES.md'), 'utf8');
  if (!notice.includes('Copyright (c) 2025 NeosiaNexus') || !notice.includes('Permission is hereby granted')) throw new Error(`${name}: incomplete upstream notice`);
  if (data.files.some(file => /(?:node_modules|\.env|example-mobile|\.superpowers)/.test(file.path))) throw new Error(`${name}: unexpected package content`);
  console.log(`${data.filename}: ${data.entryCount} files, ${data.size} bytes, license and entries verified`);
}
