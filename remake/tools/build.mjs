// Single-file build: bundles the app and the audio worklet, inlines the
// deflated asset pack as base64, writes
//   dist/index.html     standalone page (open directly, no server needed)
//   dist/artifact.html  the same page as body content (for hosts that supply the document skeleton)
import * as esbuild from 'esbuild';
import fs from 'fs';

const bundle = async (entry) => (await esbuild.build({
  entryPoints: [entry], bundle: true, format: 'iife', minify: true, write: false, target: 'es2020', legalComments: 'none',
})).outputFiles[0].text;

const safe = (js) => js.replace(/<\/script/gi, '<\\/script');
const worklet = await bundle('src/audio/worklet.js');
const main = await bundle('src/main.js');
const pack = fs.readFileSync('build/assets.pack').toString('base64');

const html = fs.readFileSync('index.html', 'utf8');
const inline = `<script>window.SR_PACK_B64=${JSON.stringify(pack)};window.SR_WORKLET_SRC=${safe(JSON.stringify(worklet))};</script>\n<script>${safe(main)}</script>`;
const page = html.replace('<script type="module" src="src/main.js"></script>', () => inline);
if (page === html) throw new Error('entry script tag not found in index.html');
fs.mkdirSync('dist', { recursive: true });
fs.writeFileSync('dist/index.html', page);

// artifact variant: title + styles + body content, no document skeleton
const head = page.match(/<head>([\s\S]*?)<\/head>/)[1].replace(/<meta[^>]*>\s*/g, '');
const body = page.match(/<body>([\s\S]*)<\/body>/)[1];
fs.writeFileSync('dist/artifact.html', head.trim() + '\n' + body.trim() + '\n');
console.log('dist/index.html', (page.length / 1e6).toFixed(2), 'MB');
