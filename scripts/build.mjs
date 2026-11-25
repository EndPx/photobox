import {readFile, writeFile, mkdir, copyFile} from 'node:fs/promises';

const html = 'text/html; charset=utf-8';
const js = 'text/javascript; charset=utf-8';
const textAssets = {
  '/': ['apps/kiosk/index.html', html],
  '/kasir': ['apps/admin/cashier.html', html],
  '/styles.css': ['packages/browser/styles.css', 'text/css; charset=utf-8'],
  '/app.js': ['apps/kiosk/app.js', js],
  '/cashier.js': ['apps/admin/cashier.js', js],
  '/model.mjs': ['packages/browser/model.mjs', js],
  '/frame-art.mjs': ['apps/kiosk/frame-art.mjs', js],
  '/checkout.js': ['packages/browser/checkout.js', js],
  '/manifest.webmanifest': ['apps/kiosk/manifest.webmanifest', 'application/manifest+json'],
  '/qrcode.mjs': ['node_modules/qrcode-generator/dist/qrcode.mjs', js],
  '/sw.js': ['apps/kiosk/sw.js', js],
};

const assets = {};
await mkdir('dist/client/art', {recursive:true});
for (const [route, [file, type]] of Object.entries(textAssets)) {
  const source = new URL('../' + file, import.meta.url);
  assets[route] = {type, body: await readFile(source, 'utf8')};
  const staticPath = route === '/' ? '/index.html' : route === '/kasir' ? '/cashier.html' : route;
  await copyFile(source,'dist/client' + staticPath);
}
const binaryAssets = {
  ...Object.fromEntries(['logo','payment','home','special-day','momen-kita','obor-after-dark']
    .map(name => ['art/' + name + '.webp', 'image/webp'])),
  'icon-180.png': 'image/png',
  'icon-192.png': 'image/png',
  'icon-512.png': 'image/png',
};
for (const [file, type] of Object.entries(binaryAssets)) {
  const source = new URL('../apps/kiosk/' + file, import.meta.url);
  await copyFile(source,'dist/client/' + file);
  const binary = await readFile(source);
  assets['/' + file] = {type, base64:binary.toString('base64')};
}
const modules = ['payments.js', 'photos.js', 'index.js'];
const source = await Promise.all(modules.map(file => readFile(new URL('../apps/api/' + file, import.meta.url), 'utf8')));
await mkdir('dist/server', {recursive:true});
await mkdir('dist/.openai', {recursive:true});
await writeFile('dist/server/index.js', 'const assets = ' + JSON.stringify(assets) + ';\n' + source.join('\n'));
await copyFile('.openai/hosting.json', 'dist/.openai/hosting.json');
