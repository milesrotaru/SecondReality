// Render specific demo times headlessly and save PNG screenshots.
// usage: node tools/shot.mjs out_prefix t1 t2 ... [--w=1280 --h=960 --url=...]
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const args = process.argv.slice(2);
const opts = Object.fromEntries(args.filter((a) => a.startsWith('--')).map((a) => { const s = a.slice(2); const i = s.indexOf('='); return [s.slice(0, i), s.slice(i + 1)]; }));
const pos = args.filter((a) => !a.startsWith('--'));
const prefix = pos[0];
const times = pos.slice(1).map(Number);
const W = +(opts.w || 1280), H = +(opts.h || 960);
const url = opts.url || 'http://localhost:8080/index.html';
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
page.on('console', (m) => console.log('[page]', m.text()));
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(url + (url.includes('?') ? '&' : '?') + 'capture=1', { waitUntil: 'load' });
await page.waitForFunction(() => window.SR_READY === true || document.getElementById('status')?.textContent?.startsWith('Error'), null, { timeout: 120000 });
if (opts.eval) await page.evaluate(opts.eval);
for (const t of times) {
  await page.evaluate((t) => { window.SR.renderAt(t); }, t);
  await page.screenshot({ path: `${prefix}_${t.toFixed(2)}.png` });
  const info = await page.evaluate(() => [window.SR.partName, window.SR.t]);
  console.log(t, info);
}
await browser.close();
