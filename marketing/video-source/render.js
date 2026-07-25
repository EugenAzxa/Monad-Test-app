const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

(async () => {
  const FPS = 30;
  const outDir = path.join(__dirname, 'frames');
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 720, deviceScaleFactor: 1 } });
  await page.goto('file://' + path.join(__dirname, 'anim.html'));
  await page.waitForFunction('typeof window.drawFrame === "function"');
  const DUR = await page.evaluate('window.DUR');
  const total = Math.round(DUR * FPS);
  const canvas = await page.$('#c');

  console.log('Rendering', total, 'frames at', FPS, 'fps (', DUR, 's )');
  for (let i = 0; i < total; i++) {
    const t = i / FPS;
    await page.evaluate((tt) => window.drawFrame(tt), t);
    const name = path.join(outDir, 'f_' + String(i).padStart(5, '0') + '.jpg');
    await canvas.screenshot({ path: name, type: 'jpeg', quality: 94 });
    if (i % 60 === 0) console.log('  frame', i, '/', total);
  }
  await browser.close();
  console.log('DONE frames ->', outDir);
})().catch(e => { console.error(e); process.exit(1); });
