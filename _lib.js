// 공통 도우미: 외부 API 호출, XML/JSON 응답 해석, PNU 분해, 캐시
// 파일명이 _ 로 시작하면 Vercel이 주소(라우트)로 만들지 않습니다.

const DATA_KEY_RAW = (process.env.DATA_GO_KR_KEY || '').trim();
// 공공데이터포털 키는 Decoding 키를 넣는 것이 원칙이지만, Encoding 키를 넣어도 동작하도록 풀어 둡니다.
export const DATA_KEY = DATA_KEY_RAW.includes('%') ? safeDecode(DATA_KEY_RAW) : DATA_KEY_RAW;
export const VWORLD_KEY = (process.env.VWORLD_KEY || '').trim();
// 브이월드에 등록한 서비스 URL. 비워 두면 Vercel의 고정 운영 주소를 자동으로 씁니다.
export const VWORLD_DOMAIN = process.env.VWORLD_DOMAIN
  || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : '');

function safeDecode(s) { try { return decodeURIComponent(s); } catch { return s; } }

// ---------- 응답 ----------
export function send(res, status, body, cacheSeconds = 0) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (cacheSeconds > 0) res.setHeader('Cache-Control', `public, s-maxage=${cacheSeconds}, stale-while-revalidate=${cacheSeconds * 4}`);
  else res.setHeader('Cache-Control', 'no-store');
  res.status(status).send(JSON.stringify(body));
}
export function fail(res, status, code, message, extra = {}) {
  send(res, status, { ok: false, error: code, message, ...extra });
}
export function need(res, ...pairs) {
  for (const [val, name] of pairs) {
    if (!val) { fail(res, 500, 'missing_key', `Vercel 환경변수 ${name} 가 비어 있습니다.`); return false; }
  }
  return true;
}

// ---------- 메모리 캐시 (서버가 살아 있는 동안 유지) ----------
const cache = new Map();
export async function cached(key, ttlMs, fn) {
  const hit = cache.get(key);
  if (hit && hit.exp > Date.now()) return hit.val;
  const val = await fn();
  cache.set(key, { val, exp: Date.now() + ttlMs });
  if (cache.size > 3000) cache.delete(cache.keys().next().value);
  return val;
}

// ---------- HTTP ----------
export async function getText(url, { timeout = 9000, tries = 2 } = {}) {
  let last;
  for (let i = 0; i < tries; i++) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeout);
    try {
      const r = await fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/json, application/xml;q=0.9, */*;q=0.8' } });
      const text = await r.text();
      clearTimeout(t);
      if (r.status >= 500 && i < tries - 1) { last = new Error(`HTTP ${r.status}`); continue; }
      return { status: r.status, text };
    } catch (e) { clearTimeout(t); last = e; }
  }
  throw new ApiError('network', `외부 API에 연결하지 못했습니다 (${last?.name === 'AbortError' ? '시간 초과' : last?.message || '알 수 없음'})`);
}

export class ApiError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

// ---------- XML(공공데이터포털) 해석: <item> 목록을 객체 배열로 ----------
function xmlUnescape(s) {
  return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}
function xmlTag(xml, tag) { const m = xml.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`)); return m ? xmlUnescape(m[1]).trim() : null; }
function xmlItems(xml) {
  const out = [];
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const o = {};
    for (const f of m[1].matchAll(/<([A-Za-z0-9_]+)>([\s\S]*?)<\/\1>/g)) o[f[1]] = xmlUnescape(f[2]).trim();
    for (const f of m[1].matchAll(/<([A-Za-z0-9_]+)\s*\/>/g)) o[f[1]] = '';
    out.push(o);
  }
  return out;
}

// 공공데이터포털(apis.data.go.kr) 호출 → { items, total }
export async function dataGoKr(url, params) {
  const u = new URL(url);
  u.searchParams.set('serviceKey', DATA_KEY);
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') u.searchParams.set(k, String(v));
  const { status, text } = await getText(u);
  const t = text.trim();
  // 점검용: 응답 원문 앞부분 (키는 가림)
  const raw = `HTTP ${status} · ${t.replace(/\s+/g, ' ').slice(0, 300)}`;
  const OK = ['00', '000', 'INFO-000'];
  if (t.startsWith('{') || t.startsWith('[')) {
    let j; try { j = JSON.parse(t); } catch { throw new ApiError('parse', `공공데이터포털 응답을 읽지 못했습니다 · ${raw}`); }
    const root = j.response || j.OpenAPI_ServiceResponse || j;
    const head = root.header || root.cmmMsgHeader || null;
    const code = head && (head.resultCode ?? head.returnReasonCode);
    if (code != null && !OK.includes(String(code))) throw new ApiError('datagokr', `공공데이터포털: ${head.resultMsg || head.returnAuthMsg || head.errMsg || ''} (${code})`);
    if (!root.body) throw new ApiError('datagokr', `공공데이터포털 응답 형식이 예상과 다릅니다 · ${raw}`);
    let items = root.body.items?.item ?? root.body.items ?? [];
    if (!Array.isArray(items)) items = items && typeof items === 'object' ? [items] : [];
    return { items, total: Number(root.body.totalCount || items.length), raw };
  }
  // XML
  const errMsg = xmlTag(t, 'returnAuthMsg') || xmlTag(t, 'errMsg');
  const reason = xmlTag(t, 'returnReasonCode');
  if (t.includes('OpenAPI_ServiceResponse') || (status >= 400 && !t.includes('<response>'))) {
    throw new ApiError('datagokr', `공공데이터포털: ${errMsg || `HTTP ${status}`}${reason ? ` (${reason})` : ''} · ${raw}`);
  }
  const code = xmlTag(t, 'resultCode');
  if (code && !OK.includes(code)) throw new ApiError('datagokr', `공공데이터포털: ${xmlTag(t, 'resultMsg')} (${code})`);
  if (!t.startsWith('<') || !t.includes('<body>')) throw new ApiError('datagokr', `공공데이터포털 응답 형식이 예상과 다릅니다 · ${raw}`);
  return { items: xmlItems(t), total: Number(xmlTag(t, 'totalCount') || 0), raw };
}

// 여러 페이지를 모두 받기
// 서버가 요청한 개수보다 적게 주면(예: 한 번에 100건 제한) 그 크기에 맞춰 끝까지 나눠 받습니다.
export async function dataGoKrAll(url, params, { pageSize = 1000, maxPages = 40, concurrency = 6 } = {}) {
  const first = await dataGoKr(url, { ...params, numOfRows: pageSize, pageNo: 1 });
  const got = first.items.length, total = first.total || got;
  if (!got || got >= total) return first.items;
  const per = got;
  const pages = Math.min(maxPages, Math.ceil(total / per));
  const nums = []; for (let p = 2; p <= pages; p++) nums.push(p);
  const rs = await pool(nums, concurrency, p => dataGoKr(url, { ...params, numOfRows: per, pageNo: p }));
  let items = first.items;
  for (const r of rs) { if (!r.ok) throw r.e; items = items.concat(r.v.items); }
  return items;
}

// 브이월드 NED(토지 속성 계열) 호출 → field 배열
export async function vworldNed(endpoint, params) {
  const u = new URL(`https://api.vworld.kr/ned/data/${endpoint}`);
  u.searchParams.set('key', VWORLD_KEY);
  u.searchParams.set('format', 'json');
  if (VWORLD_DOMAIN) u.searchParams.set('domain', VWORLD_DOMAIN);
  if (!params.numOfRows) u.searchParams.set('numOfRows', '1000');
  if (!params.pageNo) u.searchParams.set('pageNo', '1');
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') u.searchParams.set(k, String(v));
  const { text } = await getText(u);
  let j; try { j = JSON.parse(text); } catch { throw new ApiError('vworld', `브이월드: ${text.replace(/<[^>]+>/g, ' ').trim().slice(0, 140)}`); }
  // 응답은 { landCharacteristicss: { field: [...] } } 처럼 감싸져 있음
  const bucket = Object.values(j).find(v => v && typeof v === 'object' && ('field' in v || 'resultCode' in v));
  if (bucket && bucket.resultCode && !['', 'INFO-000', '0', '00'].includes(String(bucket.resultCode)) && !bucket.field) {
    throw new ApiError('vworld', `브이월드: ${bucket.resultMsg || bucket.resultCode}`);
  }
  if (j?.response?.status === 'ERROR') throw new ApiError('vworld', `브이월드: ${j.response.error?.text || '오류'}`);
  let f = bucket?.field || [];
  if (!Array.isArray(f)) f = [f];
  return f;
}

// 브이월드 2D 데이터(연속지적도 등)
export async function vworldData(params) {
  const u = new URL('https://api.vworld.kr/req/data');
  const base = { service: 'data', version: '2.0', request: 'GetFeature', format: 'json', size: '10', page: '1', key: VWORLD_KEY, crs: 'EPSG:4326', geometry: 'true', attribute: 'true' };
  if (VWORLD_DOMAIN) base.domain = VWORLD_DOMAIN;
  for (const [k, v] of Object.entries({ ...base, ...params })) u.searchParams.set(k, String(v));
  const { text } = await getText(u);
  let j; try { j = JSON.parse(text); } catch { throw new ApiError('vworld', `브이월드: ${text.slice(0, 140)}`); }
  const r = j?.response;
  if (r?.status === 'NOT_FOUND') return [];
  if (r?.status !== 'OK') throw new ApiError('vworld', `브이월드: ${r?.error?.text || r?.status || '응답 오류'}`);
  return r.result?.featureCollection?.features || [];
}

// ---------- PNU ----------
// PNU 19자리 = 법정동코드 10 + 산여부 1 + 본번 4 + 부번 4
export function splitPnu(pnu) {
  pnu = String(pnu || '').replace(/\D/g, '');
  if (pnu.length !== 19) throw new ApiError('bad_pnu', 'PNU는 19자리 숫자여야 합니다.');
  const bun = pnu.slice(11, 15), ji = pnu.slice(15, 19);
  return {
    pnu,
    sigunguCd: pnu.slice(0, 5),
    bjdongCd: pnu.slice(5, 10),
    platGbCd: pnu[10] === '2' ? '1' : '0', // 건축물대장: 0 대지, 1 산
    san: pnu[10] === '2',
    bun, ji,
    jibun: `${pnu[10] === '2' ? '산' : ''}${Number(bun)}${Number(ji) ? '-' + Number(ji) : ''}`,
    bunNum: Number(bun), jiNum: Number(ji),
  };
}

export const num = v => { const n = Number(String(v ?? '').replace(/,/g, '').trim()); return Number.isFinite(n) ? n : null; };

// 동시 실행 개수 제한
export async function pool(items, limit, fn) {
  const out = new Array(items.length); let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const k = i++; try { out[k] = { ok: true, v: await fn(items[k], k) }; } catch (e) { out[k] = { ok: false, e }; } }
  });
  await Promise.all(workers);
  return out;
}

// 개별 섹션 실패가 전체를 막지 않도록
export async function settle(fn) {
  try { return { ok: true, data: await fn() }; }
  catch (e) { return { ok: false, error: e.code || 'error', message: e.message }; }
}

export function handler(fn) {
  return async (req, res) => {
    try { await fn(req, res); }
    catch (e) { fail(res, e.code === 'bad_pnu' ? 400 : 502, e.code || 'error', e.message || '처리 중 오류가 발생했습니다.'); }
  };
}
