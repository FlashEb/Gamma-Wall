// Cloudflare Worker: fetches any ticker's option chain from Public and returns the CSV the Gamma Wall page reads.
// GET /chain?ticker=PLTR  ->  symbol,strike,expiration,type,open_interest,iv,gamma,underlying_price
// Needs secrets PUBLIC_API_SECRET and PUBLIC_ACCOUNT_ID (Settings -> Variables and Secrets).
const BASE = 'https://api.public.com';
const ALLOWED_ORIGINS = ['https://flasheb.github.io'];
const MAX_EXP = 13;
const CACHE_SECONDS = 120;
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
                 iv > 0 ? iv : '', gm > 0 ? gm : '', spot ?? '']);
    }
  }
  rows.sort((a, b) => a[2].localeCompare(b[2]) || a[1] - b[1] || a[3].localeCompare(b[3]));
  return 'symbol,strike,expiration,type,open_interest,iv,gamma,underlying_price\n' + rows.map(r => r.join(',')).join('\n') + '\n';
}

function cors(req) {
  const o = req.headers.get('Origin');
  return { 'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(o) ? o : ALLOWED_ORIGINS[0], Vary: 'Origin' };
}

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    if (req.method === 'OPTIONS') return new Response(null, { headers: { ...cors(req), 'Access-Control-Allow-Methods': 'GET' } });
    if (url.pathname !== '/chain') return new Response('Gamma Wall chain service. Use /chain?ticker=SPY', { status: 404, headers: cors(req) });
    const tk = (url.searchParams.get('ticker') || '').trim().toUpperCase();
    if (!/^[A-Z.]{1,8}$/.test(tk)) return new Response('Bad ticker', { status: 400, headers: cors(req) });
    if (!env.PUBLIC_API_SECRET || !env.PUBLIC_ACCOUNT_ID) return new Response('Worker is missing its Public secrets', { status: 500, headers: cors(req) });

    // share results between viewers for a couple of minutes so repeated searches don't hit Public
    const cache = typeof caches !== 'undefined' ? caches.default : null;
    const key = new Request(`${url.origin}/chain?ticker=${tk}`);
    let res = cache && await cache.match(key);
    if (!res) {
      try {
        res = new Response(await chainCsv(tk, env), { headers: {
          'Content-Type': 'text/csv; charset=utf-8', 'Cache-Control': `public, max-age=${CACHE_SECONDS}`,
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
