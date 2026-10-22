/*
 * Crea dist/rotta-pullman.html: tutta l'app in un solo file (stili e script inclusi).
 * Si può aprire con un doppio clic, inviare per email o caricare su qualsiasi hosting.
 * Uso: node tools/build-single.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
let html = read('index.html');

const inlineCss = (href) => `<style>\n${read(href)}\n</style>`;
const inlineJs = (src) => `<script>\n${read(src).replace(/<\/script/gi, '<\\/script')}\n</script>`;

html = html.replace(/<link rel="stylesheet" href="((?:vendor|css)\/[^"]+)">/g, (_, href) => inlineCss(href));
html = html.replace(/<script src="([^"]+)"><\/script>/g, (_, src) => inlineJs(src));
html = html.replace(/<link rel="manifest"[^>]*>\n?/, '');
html = html.replace(/<link rel="apple-touch-icon"[^>]*>\n?/, '');
const icon = 'data:image/svg+xml,' + encodeURIComponent(read('icon.svg').trim());
html = html.replace('href="icon.svg"', `href="${icon}"`);

fs.mkdirSync(path.join(ROOT, 'dist'), { recursive: true });
const out = path.join(ROOT, 'dist', 'rotta-pullman.html');
fs.writeFileSync(out, html);
console.log(`Creato ${path.relative(ROOT, out)} (${Math.round(html.length / 1024)} KB)`);
