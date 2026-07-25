const { chromium } = require('playwright');
const path = require('path');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1600, height: 900, deviceScaleFactor: 2 } });
  await page.goto('file://' + path.join(__dirname, 'cover.html'));
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(__dirname, 'WillVault-Cover.png') });
  await browser.close();
  console.log('cover saved');
})().catch(e => { console.error(e); process.exit(1); });
