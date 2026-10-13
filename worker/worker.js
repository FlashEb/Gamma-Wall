// Cloudflare Worker: fetches any ticker's option chain from Public and returns the CSV the Gamma Wall page reads.
// GET /chain?ticker=PLTR  ->  symbol,strike,expiration,type,open_interest,iv,gamma,underlying_price,volume,bid,ask,last
// GET /bars?ticker=SPY&interval=1m|5m|15m  ->  {t:[unix s], o, h, l, c, v} intraday candles (Yahoo chart data; Public has no bars)
// GET /quote?ticker=SPY  ->  {last, bid, ask, time}
// Needs secrets PUBLIC_API_SECRET and PUBLIC_ACCOUNT_ID (Settings -> Variables and Secrets).
const BASE = 'https://api.public.com';
const ALLOWED_ORIGINS = ['https://flasheb.github.io'];
const MAX_EXP = 13;
const CACHE_SECONDS = { chain: 120, bars: 20, quote: 5 };
const OSI = /^([A-Z.]+?)\s*(\d{6})([CP])(\d{8})/;

let token = null, tokenExpires = 0;  // reused across requests while this Worker instance is warm

class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }

async function call(method, path, { tok, body, params } = {}) {
  let url = BASE + path;
  if (params) url += '?' + params.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
  for (let attempt = 0; ; attempt++) {
    const r = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json', ...(tok ? { Authorization: `Bearer ${tok}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (r.status === 429 && attempt < 3) { await new Promise(res => setTimeout(res, 500 * 2 ** attempt)); continue; }
    if (!r.ok) {
      let msg = (await r.text()).slice(0, 300);
      try { msg = JSON.parse(msg).message || msg; } catch (e) { /* not JSON */ }
      throw new HttpError(r.status === 400 ? 404 : 502, msg);
    }
    return r.json();
  }
}

async function getToken(env) {
  if (token && Date.now() < tokenExpires) return token;
  const r = await call('POST', '/userapiauthservice/personal/access-tokens', { body: { validityInMinutes: 60, secret: env.PUBLIC_API_SECRET } });
  token = r.accessToken; tokenExpires = Date.now() + 50 * 60 * 1000;
  return token;
}

const num = x => { const n = parseFloat(x); return Number.isFinite(n) ? n : null; };

async function chainCsv(tk, env) {
  const tok = await getToken(env);
  const inst = { symbol: tk, type: 'EQUITY' };
  const md = `/userapigateway/marketdata/${env.PUBLIC_ACCOUNT_ID}`;
  const [q, ex] = await Promise.all([
    call('POST', `${md}/quotes`, { tok, body: { instruments: [inst] } }),
    call('POST', `${md}/option-expirations`, { tok, body: { instrument: inst } }),
  ]);
  const quote = (q.quotes || [])[0] || {};
  let spot = num(quote.last);
  if (!spot && num(quote.bid) && num(quote.ask)) spot = (num(quote.bid) + num(quote.ask)) / 2;
  const exps = (ex.expirations || []).slice().sort().slice(0, MAX_EXP);
  if (!exps.length) throw new HttpError(404, `No listed options for ${tk}`);

  const rows = [];
  // a few expirations at a time to stay under Public's rate limit
  for (let i = 0; i < exps.length; i += 4) {
    const chains = await Promise.all(exps.slice(i, i + 4).map(e =>
      call('POST', `${md}/option-chain`, { tok, body: { instrument: inst, expirationDate: e } })));
    for (const ch of chains) for (const side of ['calls', 'puts']) for (const o of ch[side] || []) {
      const m = OSI.exec(((o.instrument || {}).symbol || '').replace('-OPTION', ''));
      const oi = num(o.openInterest);
      if (!m || !oi) continue;
      const g = (o.optionDetails || {}).greeks || {};
      const gm = num(g.gamma), iv = num(g.impliedVolatility), d = m[2];
      rows.push([tk, +m[4] / 1000, `20${d.slice(0, 2)}-${d.slice(2, 4)}-${d.slice(4)}`, m[3], Math.round(oi),
                 iv > 0 ? iv : '', gm > 0 ? gm : '', spot ?? '',
                 Math.round(num(o.volume) || 0), num(o.bid) ?? '', num(o.ask) ?? '', num(o.last) ?? '']);
    }
  }
  rows.sort((a, b) => a[2].localeCompare(b[2]) || a[1] - b[1] || a[3].localeCompare(b[3]));
  return 'symbol,strike,expiration,type,open_interest,iv,gamma,underlying_price,volume,bid,ask,last\n' + rows.map(r => r.join(',')).join('\n') + '\n';
}

async function quoteJson(tk, env) {
  const tok = await getToken(env);
  const q = await call('POST', `/userapigateway/marketdata/${env.PUBLIC_ACCOUNT_ID}/quotes`, { tok, body: { instruments: [{ symbol: tk, type: 'EQUITY' }] } });
  const x = (q.quotes || [])[0] || {};
  if (x.outcome && x.outcome !== 'SUCCESS') throw new HttpError(404, `No quote for ${tk}`);
  return JSON.stringify({ last: num(x.last), bid: num(x.bid), ask: num(x.ask), time: x.lastTimestamp || null });
}

const RANGES = { '1m': '2d', '5m': '5d', '15m': '5d' };
async function barsJson(tk, interval) {
  const range = RANGES[interval];
  if (!range) throw new HttpError(400, 'interval must be 1m, 5m or 15m');
  let last;
  for (const host of ['query1', 'query2']) {
    const r = await fetch(`https://${host}.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(tk)}?interval=${interval}&range=${range}&includePrePost=false`,
      { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; GammaWall/1.0)', Accept: 'application/json' } });
    if (!r.ok) { last = new HttpError(r.status === 404 ? 404 : 502, `Price history unavailable (${r.status})`); continue; }
    const res = (((await r.json()).chart || {}).result || [])[0];
    if (!res || !res.timestamp) throw new HttpError(404, `No price history for ${tk}`);
    const q = res.indicators.quote[0], out = { t: [], o: [], h: [], l: [], c: [], v: [] };
    res.timestamp.forEach((t, i) => {
      if (q.open[i] == null || q.close[i] == null) return;  // empty minutes
      out.t.push(t); out.o.push(q.open[i]); out.h.push(q.high[i]); out.l.push(q.low[i]); out.c.push(q.close[i]); out.v.push(q.volume[i] || 0);
    });
    return JSON.stringify(out);
  }
  throw last;
}

function cors(req) {
  const o = req.headers.get('Origin');
  return { 'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(o) ? o : ALLOWED_ORIGINS[0], Vary: 'Origin' };
}

const ROUTES = {
  '/chain': { type: 'text/csv; charset=utf-8', make: (tk, env) => chainCsv(tk, env) },
  '/bars': { type: 'application/json', make: (tk, env, url) => barsJson(tk, url.searchParams.get('interval') || '1m') },
  '/quote': { type: 'application/json', make: (tk, env) => quoteJson(tk, env) },
};

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    if (req.method === 'OPTIONS') return new Response(null, { headers: { ...cors(req), 'Access-Control-Allow-Methods': 'GET' } });
    const name = url.pathname.replace(/\/$/, ''), route = ROUTES[name];
    if (!route) return new Response('Gamma Wall chain service. Use /chain?ticker=SPY', { status: 404, headers: cors(req) });
    const tk = (url.searchParams.get('ticker') || '').trim().toUpperCase();
    if (!/^[A-Z.]{1,8}$/.test(tk)) return new Response('Bad ticker', { status: 400, headers: cors(req) });
    if (!env.PUBLIC_API_SECRET || !env.PUBLIC_ACCOUNT_ID) return new Response('Worker is missing its Public secrets', { status: 500, headers: cors(req) });

    // share results between viewers for a little while so repeated loads don't hit Public
    const ttl = CACHE_SECONDS[name.slice(1)];
    const cache = typeof caches !== 'undefined' ? caches.default : null;
    const iv = name === '/bars' ? '&interval=' + (url.searchParams.get('interval') || '1m') : '';
    const key = new Request(`${url.origin}${name}?ticker=${tk}${iv}`);
    let res = cache && await cache.match(key);
    if (!res) {
      try {
        res = new Response(await route.make(tk, env, url), { headers: {
          'Content-Type': route.type, 'Cache-Control': `public, max-age=${ttl}`,
          'X-As-Of': new Date().toISOString() } });
        if (cache) ctx.waitUntil(cache.put(key, res.clone()));
      } catch (e) {
        return new Response(e.message || 'Lookup failed', { status: e.status || 502, headers: cors(req) });
      }
    }
    const out = new Response(res.body, res);
    for (const [k, v] of Object.entries(cors(req))) out.headers.set(k, v);
    out.headers.set('Access-Control-Expose-Headers', 'X-As-Of');
    return out;
  },
};
