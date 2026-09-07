import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { applyMediaWorkerFix } from './media-worker-transform.mjs';

await mkdir('dist', { recursive: true });
for (const file of [
  'manifest.webmanifest',
  'sw.js',
  'apple-touch-icon.png',
  'icon-192.png',
  'icon-512.png',
  'camera.html',
]) {
  await copyFile(file, `dist/${file}`);
}

const workerSource = await readFile('worker.js', 'utf8');
const patchedWorker = applyMediaWorkerFix(workerSource);
await writeFile('dist/_worker.js', patchedWorker, 'utf8');

console.log('ASLingo flat build assets copied to dist/ with media verification repair.');
