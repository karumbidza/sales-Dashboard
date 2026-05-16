// lib/renderPdf.ts
// Headless-Chrome renderer for the R&M PDF report.
// Uses puppeteer-core + @sparticuz/chromium-min so the function bundle
// stays small enough for Vercel; the chromium binary is fetched from
// a GitHub release URL at cold-start time.
//
// Local dev: set CHROME_EXECUTABLE_PATH in .env.local to your installed
// Chrome (e.g. '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
// to skip the chromium-min download.
import puppeteer, { type Browser } from 'puppeteer-core';
import chromium from '@sparticuz/chromium-min';

const CHROMIUM_PACK_URL =
  'https://github.com/Sparticuz/chromium/releases/download/v131.0.1/chromium-v131.0.1-pack.tar';

async function launch(): Promise<Browser> {
  // Local override: explicit Chrome path.
  if (process.env.CHROME_EXECUTABLE_PATH) {
    return puppeteer.launch({
      args:            ['--no-sandbox', '--disable-setuid-sandbox'],
      executablePath:  process.env.CHROME_EXECUTABLE_PATH,
      headless:        true,
      defaultViewport: { width: 1200, height: 1600 },
    });
  }
  // Default: serverless path — fetch chromium pack on cold start.
  return puppeteer.launch({
    args:            chromium.args,
    executablePath:  await chromium.executablePath(CHROMIUM_PACK_URL),
    headless:        true,
    defaultViewport: { width: 1200, height: 1600 },
  });
}

// puppeteer-core v25+ returns Uint8Array from page.pdf(); we accept
// either and hand back a Buffer so callers can read .length easily.
export async function renderPdf(printUrl: string): Promise<Buffer> {
  const browser = await launch();
  try {
    const page = await browser.newPage();
    // 'domcontentloaded' fires once HTML is received (SSR complete).
    // Next.js HMR/streaming can block 'load' indefinitely in dev;
    // we rely on waitForSelector below as the real readiness gate.
    await page.goto(printUrl, { waitUntil: 'domcontentloaded', timeout: 55_000 });
    await page.evaluateHandle('document.fonts.ready');
    // Wait for React to hydrate and ReadyBeacon to set the attribute.
    await page.waitForSelector('body[data-report-ready="true"]', { timeout: 30_000 });
    const pdf = await page.pdf({
      format:            'Letter',
      printBackground:   true,
      preferCSSPageSize: true,
      margin:            { top: 0, right: 0, bottom: 0, left: 0 },
    });
    // pdf is Uint8Array in puppeteer-core v25; wrap to Buffer so
    // Content-Length and any Buffer-specific callers work correctly.
    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}
