import { copyFile, mkdir } from 'node:fs/promises';

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
await copyFile('worker.js', 'dist/_worker.js');
console.log('ASLingo flat build assets copied to dist/');
