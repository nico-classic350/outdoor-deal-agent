import { RawOffer, ShopSource } from './types';
import { extractHtmlFallback, extractJsonLd } from './extract';

export function browserFallbackConfigured() {
  return Boolean(process.env.BROWSERLESS_CONTENT_URL);
}

export async function browserExtract(source: ShopSource, url: string): Promise<RawOffer[]> {
  const endpoint = process.env.BROWSERLESS_CONTENT_URL;
  if (!endpoint) return [];
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url }),
      signal: AbortSignal.timeout(25000),
    });
    if (!response.ok) return [];
    const html = await response.text();
    const json = extractJsonLd(html, source, url);
    return json.length ? json : extractHtmlFallback(html, source, url);
  } catch {
    return [];
  }
}
