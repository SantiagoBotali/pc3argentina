/**
 * Cotización del dólar "Billetes" (efectivo) del Banco Nación,
 * scrapeada desde https://www.bna.com.ar/Personas.
 * Usada por el panel admin de referencia de precios (Pablo la usa para
 * comparar los precios ARS del catálogo contra un tipo de cambio real).
 */

const BNA_URL = 'https://www.bna.com.ar/Personas';
const TTL_MS = 10 * 60_000; // 10 min — evita golpear el sitio del BNA en cada request

let cache = { data: null, expiresAt: 0 };

/** "1.460,50" / "1460,50" (formato AR) → 1460.5 */
function parseArNumber(raw) {
  return parseFloat(raw.replace(/\./g, '').replace(',', '.'));
}

async function fetchDolarBna({ force = false } = {}) {
  const now = Date.now();
  if (!force && cache.data && now < cache.expiresAt) {
    return { ...cache.data, cached: true };
  }

  const res = await fetch(BNA_URL, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; PC3Catalogo/1.0)' },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`El sitio del BNA respondió ${res.status}`);
  const html = await res.text();

  // Tab "Cotización Billetes" (efectivo) — la referencia relevante para precios de mostrador
  const billetesBlock = html.match(/id="billetes">([\s\S]*?)<\/table>/)?.[1] || '';
  const row = billetesBlock.match(
    /Dolar U\.S\.A<\/td>\s*<td>([\d.,]+)<\/td>\s*<td>([\d.,]+)<\/td>/
  );
  if (!row) throw new Error('No se pudo leer la cotización del dólar en la página del BNA');

  const compra = parseArNumber(row[1]);
  const venta = parseArNumber(row[2]);
  const horaMatch = html.match(/Hora Actualizaci[oó]n:\s*([\d:]+)/);

  const data = {
    compra,
    venta,
    hora: horaMatch ? horaMatch[1] : null,
    fetchedAt: new Date().toISOString(),
  };
  cache = { data, expiresAt: now + TTL_MS };
  return { ...data, cached: false };
}

module.exports = { fetchDolarBna };
