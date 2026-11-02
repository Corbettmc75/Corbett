// "Check current price" — optional supplier lookup.
// Honest by construction:
//  * Disabled unless PRICE_LOOKUP_HOSTS lists the supplier host (e.g. "www.menards.com").
//  * Only reads a price that the product page itself publishes in schema.org JSON-LD
//    (offers.price / offers.lowPrice). No guessing from page text.
//  * Returns a CANDIDATE with URL + retrieval timestamp. It never overwrites the catalog;
//    a person confirms it, and it is then saved as a dated material price.
//  * Every failure is reported as a failure — no fallback number is ever produced.

const MAX_BYTES = 3 * 1024 * 1024;

export function allowedHosts(env = process.env) {
  return String(env.PRICE_LOOKUP_HOSTS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
}

function findOffers(node, out) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) { node.forEach(n => findOffers(n, out)); return; }
  const t = [].concat(node['@type'] || []).map(String);
  if (t.includes('Product')) {
    for (const o of [].concat(node.offers || [])) {
      const price = Number(o?.price ?? o?.lowPrice);
      if (Number.isFinite(price) && price > 0) {
        out.push({ name: String(node.name || '').slice(0, 300), sku: node.sku ? String(node.sku).slice(0, 80) : null,
                   price, currency: String(o.priceCurrency || 'USD'), availability: o.availability ? String(o.availability) : null });
      }
    }
  }
  for (const v of Object.values(node)) if (v && typeof v === 'object') findOffers(v, out);
}

export function extractJsonLdOffers(html) {
  const out = [];
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) { try { findOffers(JSON.parse(m[1].trim()), out); } catch { /* malformed block: ignore */ } }
  return out;
}

export async function lookupPrice({ url, productKey }, { fetchImpl = globalThis.fetch, env = process.env, now = () => new Date() } = {}) {
  let u;
  try { u = new URL(String(url)); } catch { return { ok: false, error: 'That is not a valid product URL.' }; }
  if (u.protocol !== 'https:') return { ok: false, error: 'Only https product pages can be checked.' };
  const hosts = allowedHosts(env);
  if (!hosts.length) return { ok: false, error: 'Price lookup is turned off on this server (PRICE_LOOKUP_HOSTS is not set). No lookup was made.' };
  if (!hosts.includes(u.hostname.toLowerCase())) return { ok: false, error: `${u.hostname} is not an allowed supplier host. No lookup was made.` };
  const retrievedAt = now().toISOString();
  let res;
  try {
    res = await fetchImpl(u.href, { redirect: 'error', headers: { accept: 'text/html' }, signal: AbortSignal.timeout(20000) });
  } catch (e) {
    return { ok: false, retrievedAt, error: `Could not reach ${u.hostname} (${e?.name === 'TimeoutError' ? 'timed out' : 'network blocked or unreachable'}). Stored prices are unchanged.` };
  }
  if (!res.ok) return { ok: false, retrievedAt, error: `${u.hostname} answered HTTP ${res.status} (often a bot check or a store not selected). Stored prices are unchanged.` };
  const text = (await res.text()).slice(0, MAX_BYTES);
  const offers = extractJsonLdOffers(text);
  if (!offers.length) return { ok: false, retrievedAt, error: 'The page loaded but did not publish a machine-readable price. Enter the price manually from the shelf tag or quote.' };
  const o = offers[0];
  return { ok: true, retrievedAt, candidate: {
    productKey, supplier: u.hostname, spec: o.name, sku: o.sku, unitPriceCents: Math.round(o.price * 100), currency: o.currency,
    availability: o.availability, source: { file: null, page: null, url: u.href }, priceDate: retrievedAt.slice(0, 10), priceType: 'material',
    notes: `Online price read from the product page at ${retrievedAt}. Store-specific pricing may differ — confirm before saving.` } };
}
