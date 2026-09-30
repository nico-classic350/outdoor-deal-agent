import type { Browser, BrowserContext } from 'playwright-core';
import { localBrowserRuntime } from './browser-config.mjs';

// Open-source browser runtime for the GitHub Actions crawler: playwright-core
// launches a Chromium installed by `playwright-core install chromium` on the
// runner. One browser process is shared; each page gets an isolated context.
// Vercel never takes this path (no binary is bundled there).
let browserPromise: Promise<Browser> | null = null;

export function localBrowserEnabled(env = process.env) {
  return localBrowserRuntime(env);
}

async function localBrowser(): Promise<Browser> {
  if (!localBrowserEnabled()) throw new Error('local-browser-disabled');
  if (!browserPromise) {
    browserPromise = import('playwright-core').then(({ chromium }) => chromium.launch({
      headless: true,
      executablePath: process.env.CHROMIUM_EXECUTABLE_PATH || undefined,
      args: ['--disable-dev-shm-usage'],
    })).catch(error => { browserPromise = null; throw error; });
  }
  return browserPromise;
}

export async function newLocalContext(): Promise<BrowserContext> {
  const browser = await localBrowser();
  const context = await browser.newContext({
    locale: 'de-DE',
    viewport: { width: 1366, height: 900 },
    javaScriptEnabled: true,
  });
  // Images, media and fonts are not needed for card/JSON-LD extraction.
  await context.route('**/*', route => {
    const type = route.request().resourceType();
    return type === 'image' || type === 'media' || type === 'font' ? route.abort() : route.continue();
  });
  return context;
}

export async function closeLocalBrowser() {
  const pending = browserPromise;
  browserPromise = null;
  if (pending) { try { await (await pending).close(); } catch {} }
}
