// 회원(카카오 로그인)
//   /auth/login?r=/?pnu=...&mk=1   → 카카오 로그인 화면으로 이동 (mk=1: 리얼워커스 소식 받기 동의)
//   /auth/callback                  → 카카오가 돌려보내는 주소 (카카오 개발자센터 Redirect URI에 등록)
//   /api/auth?action=me             → 로그인 상태 { member, nickname }
//   /api/auth?action=logout         → 로그아웃
//   POST /api/auth?action=withdraw  → 회원 탈퇴 (저장된 회원 정보 삭제)
//   /api/auth?action=zfavs · zfav   → 서울 정비사업 관심 구역·추진 알림(이메일)
// 필요한 환경변수: KAKAO_REST_KEY, SESSION_SECRET (선택: KAKAO_CLIENT_SECRET, Upstash 저장소)
import crypto from 'node:crypto';
import { send, fail } from './_lib.js';

const REST = (process.env.KAKAO_REST_KEY || '').trim();
const CSECRET = (process.env.KAKAO_CLIENT_SECRET || '').trim();
const SECRET = (process.env.SESSION_SECRET || '').trim()
  || crypto.createHash('sha256').update('realmap|' + REST + '|' + (process.env.DATA_GO_KR_KEY || '') + '|' + (process.env.VWORLD_KEY || '')).digest('hex');
const R_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || Object.entries(process.env).find(([k]) => /_REST_API_URL$/.test(k))?.[1] || '';
const R_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || Object.entries(process.env).find(([k]) => /_REST_API_TOKEN$/.test(k) && !/READ_ONLY/.test(k))?.[1] || '';
const DAYS = 180;
const ADMIN_ID = String(process.env.ADMIN_KAKAO_ID || '').trim();
// 유료회원(PRO): 운영자는 항상 PRO, 그 외에는 저장소의 realmap:pro 목록에 있는 회원
// 매물 사진 (Vercel Blob) — 패키지는 사진 기능을 쓸 때만 불러와서, 문제가 생겨도 로그인 등 다른 기능은 그대로 동작
const blobLib = () => import('@vercel/blob');
const ownPhoto = (u, id) => { try { const x = new URL(u); return x.protocol === 'https:' && /\.public\.blob\.vercel-storage\.com$/.test(x.hostname) && x.pathname.startsWith(`/ls/${id}/`); } catch { return false; } };
async function dropPhotos(urls) { if (!urls.length) return; try { const { del } = await blobLib(); await del(urls); } catch { /* 지우기 실패는 무시 (용량만 조금 남음) */ } }
async function isPro(id) {
  if (!id) return false;
  if (ADMIN_ID && String(id) === ADMIN_ID) return true;
  try { return !!(await redis(['SISMEMBER', 'realmap:pro', String(id)])); } catch { return false; }
}

function origin(req) {
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const proto = req.headers['x-forwarded-proto'] || 'https';
  return `${proto}://${host}`;
}
const sign = s => crypto.createHmac('sha256', SECRET).update(s).digest('base64url');
function makeSession(id, nick) {
  const exp = Math.floor(Date.now() / 1000) + DAYS * 86400;
  const body = Buffer.from(JSON.stringify({ id: String(id), n: nick || '', exp })).toString('base64url');
  return `${body}.${sign(body)}`;
}
export function readSession(req) {
  const m = String(req.headers.cookie || '').match(/(?:^|;\s*)rm_s=([^;]+)/);
  if (!m) return null;
  const [body, sig] = m[1].split('.');
  if (!body || !sig) return null;
  const a = Buffer.from(sign(body)), b = Buffer.from(sig);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try { const s = JSON.parse(Buffer.from(body, 'base64url').toString()); return s.exp > Date.now() / 1000 ? s : null; } catch { return null; }
}
function cookie(name, val, maxAge) {
  return `${name}=${val}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}
export { R_URL, R_TOKEN };
export async function redis(cmd) {
  if (!R_URL || !R_TOKEN) return null;
  const r = await fetch(R_URL, { method: 'POST', headers: { Authorization: `Bearer ${R_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify(cmd) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error(j.error || `저장소 오류 ${r.status}`);
  return j.result;
}
// 돌아갈 주소는 이 사이트 안의 경로만 허용
const safeReturn = r => (typeof r === 'string' && /^\/(?!\/)/.test(r) ? r.slice(0, 300) : '/');
function redirect(res, url, cookies = []) {
  if (cookies.length) res.setHeader('Set-Cookie', cookies);
  res.setHeader('Cache-Control', 'no-store');
  res.statusCode = 302; res.setHeader('Location', url); res.end();
}

export default async function (req, res) {
  const action = String(req.query.action || '');
  try {
    if (action === 'me') {
      const s = readSession(req);
      return send(res, 200, { ok: true, ready: !!REST, member: !!s, nickname: s ? s.n : '', pro: s ? await isPro(s.id) : false, op: !!(s && ADMIN_ID && s.id === ADMIN_ID) });
    }
    if (action === 'logout') return redirect(res, safeReturn(req.query.r), [cookie('rm_s', '', 0)]);

    // 방문 통계 (개인 식별 정보 없이 숫자만): 하루 방문자 수·페이지 조회·필지 조회
    if (action === 'hit') {
      res.setHeader('Cache-Control', 'no-store');
      if (!R_URL || !R_TOKEN || /bot|crawl|spider|slurp|preview|realmap-warm/i.test(req.headers['user-agent'] || '')) return send(res, 200, { ok: true });
      const day = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10).replace(/-/g, '');
      const v = String(req.query.v || '').replace(/[^a-z0-9]/gi, '').slice(0, 24);
      const kind = req.query.k === 'p' ? 'p' : 'v';
      const s = readSession(req);
      if (s && ADMIN_ID && s.id === ADMIN_ID) return send(res, 200, { ok: true, skip: 'op' }); // 운영자 본인은 세지 않음
      const ex = String(400 * 86400);
      // 유입 경로: 방문(세션)마다 첫 화면에서 한 번만 보냅니다
      const SRC = ['blog', 'nsearch', 'naver', 'insta', 'kakao', 'youtube', 'google', 'daum', 'seoul', 'direct', 'etc'];
      const src = SRC.includes(req.query.src) ? req.query.src : '';
      // 정비사업 안내 페이지(/seoul/) 방문: 방문자·열람·페이지별·유입 경로를 따로 셉니다
      if (req.query.k === 's') {
        const pg = String(req.query.pg || '').replace(/[^a-z0-9/_-]/gi, '').slice(0, 40) || 'idx';
        const sc = [['INCR', `rm:st:${day}:spv`], ['EXPIRE', `rm:st:${day}:spv`, ex], ['HINCRBY', `rm:st:${day}:spg`, pg, '1'], ['EXPIRE', `rm:st:${day}:spg`, ex],
          ...(v ? [['PFADD', `rm:st:${day}:suv`, v], ['EXPIRE', `rm:st:${day}:suv`, ex]] : []),
          ...(src ? [['HINCRBY', `rm:st:${day}:ssrc`, src, '1'], ['EXPIRE', `rm:st:${day}:ssrc`, ex]] : [])];
        try { await fetch(R_URL.replace(/\/$/, '') + '/pipeline', { method: 'POST', headers: { Authorization: `Bearer ${R_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify(sc) }); } catch { /* 통계 실패는 무시 */ }
        return send(res, 200, { ok: true });
      }
      const cmds = kind === 'p'
        ? [['INCR', `rm:st:${day}:pcl`], ['EXPIRE', `rm:st:${day}:pcl`, ex],
           ...(/^\d{5}$/.test(String(req.query.g || '')) ? [['HINCRBY', `rm:st:${day}:gu`, String(req.query.g), '1'], ['EXPIRE', `rm:st:${day}:gu`, ex]] : [])]
        : [['INCR', `rm:st:${day}:pv`], ['EXPIRE', `rm:st:${day}:pv`, ex], ...(v ? [['PFADD', `rm:st:${day}:uv`, v], ['EXPIRE', `rm:st:${day}:uv`, ex]] : []),
           ...(s ? [['PFADD', `rm:st:${day}:mem`, s.id], ['EXPIRE', `rm:st:${day}:mem`, ex]] : []),
           ...(src ? [['HINCRBY', `rm:st:${day}:src`, src, '1'], ['EXPIRE', `rm:st:${day}:src`, ex]] : [])];
      try { await fetch(R_URL.replace(/\/$/, '') + '/pipeline', { method: 'POST', headers: { Authorization: `Bearer ${R_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify(cmds) }); } catch { /* 통계 실패는 무시 */ }
      return send(res, 200, { ok: true });
    }

    // 관심 부동산 (회원 전용) — 회원별 최대 50개, '우리 집' 1개
    if (action === 'favs' || action === 'fav') {
      const s = readSession(req);
      if (!s) return fail(res, 401, 'login', '로그인이 필요합니다.');
      if (!R_URL || !R_TOKEN) return fail(res, 500, 'no_storage', '회원 저장소가 연결되지 않았습니다.');
      const key = `realmap:fav:${s.id}`;
      const load = async () => { try { const v = await redis(['GET', key]); return v ? JSON.parse(v) : { items: [], home: null }; } catch { return { items: [], home: null }; } };
      let d = await load();
      if (action === 'favs') return send(res, 200, { ok: true, ...d });
      if (req.method !== 'POST') return fail(res, 405, 'method', '허용되지 않는 요청입니다.');
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
      const it = body.item || {};
      const pnu = String(it.pnu || body.pnu || '').replace(/\D/g, '');
      if (!/^\d{19}$/.test(pnu)) return fail(res, 400, 'bad_pnu', 'PNU가 올바르지 않습니다.');
      const clean = (v, n) => String(v ?? '').replace(/[<>]/g, '').trim().slice(0, n);
      if (body.op === 'add' || body.op === 'home') {
        const rec = { pnu, addr: clean(it.addr, 80), name: clean(it.name, 40), lat: Number(it.lat) || null, lng: Number(it.lng) || null,
          kinds: (Array.isArray(it.kinds) ? it.kinds : []).filter(k => /^[a-zA-Z]{2,10}$/.test(k)).slice(0, 6), area: Number(it.area) || null, at: new Date().toISOString() };
        d.items = [rec, ...d.items.filter(x => x.pnu !== pnu)].slice(0, 50);
        if (body.op === 'home') d.home = pnu;
      } else if (body.op === 'del') {
        d.items = d.items.filter(x => x.pnu !== pnu);
        if (d.home === pnu) d.home = null;
      } else if (body.op === 'unhome') {
        if (d.home === pnu) d.home = null;
      } else return fail(res, 400, 'op', '알 수 없는 요청입니다.');
      await redis(['SET', key, JSON.stringify(d)]);
      return send(res, 200, { ok: true, ...d });
    }

    // 관심 구역 (서울 정비사업, 회원 전용) — 회원별 최대 30곳. 추진 단계 알림은 이메일을 남긴 회원만
    //   GET  /api/auth?action=zfavs → { member, items:[{id,n,gu,st,alert,at}], email }
    //   POST /api/auth?action=zfav  { op:'add'|'del'|'alert'|'unalert'|'email'|'noemail', id, n, gu, st, email }
    if (action === 'zfavs' || action === 'zfav') {
      res.setHeader('Cache-Control', 'no-store');
      const s = readSession(req);
      if (!s) return action === 'zfavs' ? send(res, 200, { ok: true, member: false, items: [] }) : fail(res, 401, 'login', '로그인이 필요합니다.');
      if (!R_URL || !R_TOKEN) return fail(res, 500, 'no_storage', '회원 저장소가 연결되지 않았습니다.');
      const key = `realmap:zfav:${s.id}`;
      let d; try { const v = await redis(['GET', key]); d = v ? JSON.parse(v) : null; } catch { d = null; }
      d = d || { items: [], email: '', emailAt: null };
      // 이메일을 아직 안 남겼으면 카카오 가입 때 받은 이메일을 기본값으로 보여 줌 (저장은 회원이 확인한 뒤에만)
      let kakaoEmail = '';
      if (!d.email) { try { const u = await redis(['GET', `realmap:user:${s.id}`]); kakaoEmail = u ? (JSON.parse(u).email || '') : ''; } catch { /* 없음 */ } }
      const out = () => send(res, 200, { ok: true, member: true, nickname: s.n || '', items: d.items, email: d.email || '', kakaoEmail });
      if (action === 'zfavs') return out();
      if (req.method !== 'POST') return fail(res, 405, 'method', '허용되지 않는 요청입니다.');
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
      const clean = (v, n) => String(v ?? '').replace(/[<>"]/g, '').trim().slice(0, n);
      const id = String(body.id || '').replace(/\D/g, '').slice(0, 12);
      const now = new Date().toISOString();
      const op = body.op;
      if (op === 'email' || op === 'alert') {
        const em = clean(body.email || d.email, 120);
        if (op === 'email' || body.email) {
          if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(em)) return fail(res, 400, 'bad_email', '이메일 주소를 확인해 주세요.');
          d.email = em; d.emailAt = now;
        }
        if (op === 'alert' && !d.email) return fail(res, 400, 'need_email', '알림은 이메일로 보내 드립니다. 이메일을 먼저 남겨 주세요.');
      }
      if (op === 'noemail') { d.email = ''; d.emailAt = null; d.items.forEach(x => { x.alert = false; }); }
      if (['add', 'del', 'alert', 'unalert'].includes(op)) {
        if (!id) return fail(res, 400, 'bad_id', '구역 정보가 올바르지 않습니다.');
        let it = d.items.find(x => x.id === id);
        if (op === 'del') d.items = d.items.filter(x => x.id !== id);
        else {
          if (!it) {
            if (d.items.length >= 30) return fail(res, 400, 'full', '관심 구역은 30곳까지 저장할 수 있습니다.');
            it = { id, n: clean(body.n, 40), gu: clean(body.gu, 8), st: clean(body.st, 20), alert: false, at: now };
            d.items.unshift(it);
          }
          if (op === 'alert') it.alert = true;
          if (op === 'unalert') it.alert = false;
        }
      } else if (!['email', 'noemail'].includes(op)) return fail(res, 400, 'op', '알 수 없는 요청입니다.');
      await redis(['SET', key, JSON.stringify(d)]);
      try { await redis([d.items.some(x => x.alert) ? 'SADD' : 'SREM', 'realmap:zwatch', String(s.id)]); } catch { /* 알림 목록 갱신 실패는 다음 저장 때 */ }
      return out();
    }

    // 단지 장부 (PRO 전용) — 자주 보는 아파트 단지와 호별 메모
    //   GET  /api/auth?action=cx → { items:[{id,name,places:[{pnu,addr,lat,lng}],at}], memos:{'단지id|pnu|동|호':{t,up}} }
    //   POST /api/auth?action=cx  { op:'add', name, place } | { op:'addplace', id, place } | { op:'delplace', id, pnu } | { op:'rename', id, name } | { op:'del', id } | { op:'memo', id, key, text }
    if (action === 'cx') {
      res.setHeader('Cache-Control', 'no-store');
      const s = readSession(req);
      if (!s) return fail(res, 401, 'login', '로그인이 필요합니다.');
      if (!R_URL || !R_TOKEN) return fail(res, 500, 'no_storage', '회원 저장소가 연결되지 않았습니다.');
      if (!(await isPro(s.id))) return fail(res, 403, 'pro', '유료회원 전용 기능입니다.');
      const key = `realmap:cx:${s.id}`;
      let d; try { const v = await redis(['GET', key]); d = v ? JSON.parse(v) : null; } catch { d = null; }
      d = d || { items: [], memos: {} };
      if (req.method !== 'POST') return send(res, 200, { ok: true, ...d });
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
      const str = (v, n) => String(v ?? '').replace(/[<>]/g, '').trim().slice(0, n);
      const place = p => { const pnu = String(p && p.pnu || '').replace(/\D/g, ''); return /^\d{19}$/.test(pnu) ? { pnu, addr: str(p.addr, 80), lat: Number(p.lat) || null, lng: Number(p.lng) || null } : null; };
      const now = new Date().toISOString();
      const id = str(body.id, 20).replace(/[^\w-]/g, '');
      const it = d.items.find(x => x.id === id);
      if (body.op === 'add') {
        const pl = place(body.place); if (!pl) return fail(res, 400, 'bad_pnu', '단지 주소를 먼저 골라 주세요.');
        if (d.items.length >= 30) return fail(res, 400, 'full', '단지는 30곳까지 등록할 수 있습니다.');
        const dup = d.items.find(x => x.places.some(p => p.pnu === pl.pnu));
        if (dup) return send(res, 200, { ok: true, ...d, id: dup.id });
        const nid = Date.now().toString(36) + crypto.randomBytes(2).toString('hex');
        d.items.unshift({ id: nid, name: str(body.name, 40) || pl.addr, places: [pl], at: now });
        await redis(['SET', key, JSON.stringify(d)]);
        return send(res, 200, { ok: true, ...d, id: nid });
      }
      if (!it) return fail(res, 404, 'nocx', '단지를 찾지 못했습니다.');
      if (body.op === 'addplace') {
        const pl = place(body.place); if (!pl) return fail(res, 400, 'bad_pnu', '주소가 올바르지 않습니다.');
        if (!it.places.some(p => p.pnu === pl.pnu)) { if (it.places.length >= 12) return fail(res, 400, 'full', '한 단지에 필지는 12개까지 넣을 수 있습니다.'); it.places.push(pl); }
      } else if (body.op === 'delplace') {
        if (it.places.length > 1) it.places = it.places.filter(p => p.pnu !== String(body.pnu || ''));
      } else if (body.op === 'rename') {
        it.name = str(body.name, 40) || it.name;
      } else if (body.op === 'del') {
        d.items = d.items.filter(x => x.id !== id);
        for (const k of Object.keys(d.memos)) if (k.startsWith(id + '|')) delete d.memos[k];
      } else if (body.op === 'memo') {
        const mk = str(body.key, 80);
        if (!mk.startsWith(id + '|')) return fail(res, 400, 'bad_key', '메모 위치가 올바르지 않습니다.');
        const t = str(body.text, 500);
        if (t) d.memos[mk] = { t, up: now }; else delete d.memos[mk];
        if (Object.keys(d.memos).length > 5000) return fail(res, 400, 'full', '메모가 너무 많습니다. 필요 없는 메모를 정리해 주세요.');
      } else return fail(res, 400, 'op', '알 수 없는 요청입니다.');
      await redis(['SET', key, JSON.stringify(d)]);
      return send(res, 200, { ok: true, ...d });
    }

    // 매물장 (PRO 전용) — 회원별 최대 1,000건, 한 덩어리로 저장
    if (action === 'listings' || action === 'listing') {
      const s = readSession(req);
      if (!s) return fail(res, 401, 'login', '로그인이 필요합니다.');
      if (!R_URL || !R_TOKEN) return fail(res, 500, 'no_storage', '회원 저장소가 연결되지 않았습니다.');
      if (!(await isPro(s.id))) return fail(res, 403, 'pro', '유료회원 전용 기능입니다.');
      // 사진 올리기: 브라우저에서 줄인 JPEG를 받아 저장하고 주소를 돌려줍니다
      if (action === 'listing' && req.query.op === 'photo') {
        if (req.method !== 'POST') return fail(res, 405, 'method', '허용되지 않는 요청입니다.');
        const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
        const buf = Buffer.from(String(body.data || '').replace(/^data:image\/\w+;base64,/, ''), 'base64');
        if (buf.length < 500 || buf.length > 3 * 1024 * 1024) return fail(res, 400, 'size', '사진 크기가 올바르지 않습니다.');
        if (!(buf[0] === 0xFF && buf[1] === 0xD8)) return fail(res, 400, 'type', 'JPEG 사진만 올릴 수 있습니다.');
        const { put } = await blobLib();
        const r = await put(`ls/${s.id}/${Date.now().toString(36)}.jpg`, buf, { access: 'public', contentType: 'image/jpeg', addRandomSuffix: true, cacheControlMaxAge: 31536000 });
        return send(res, 200, { ok: true, url: r.url });
      }
      const key = `realmap:ls:${s.id}`;
      const raw = await redis(['GET', key]);
      let items = raw ? JSON.parse(raw) : [];
      // 매물번호: 비워 두면 '등록한 해·월-순번' (예: 2610-001)으로 자동으로 붙입니다
      const ym = iso => { const d = new Date(new Date(iso || Date.now()).getTime() + 9 * 3600e3); return String(d.getUTCFullYear()).slice(2) + String(d.getUTCMonth() + 1).padStart(2, '0'); };
      const nextNo = (list, iso) => { const p = ym(iso) + '-'; const max = list.reduce((m, x) => { const k = String(x.no || ''); return k.startsWith(p) ? Math.max(m, Number(k.slice(p.length)) || 0) : m; }, 0); return p + String(max + 1).padStart(3, '0'); };
      if (items.some(x => !x.no)) { // 예전에 등록한 매물은 등록일 순서대로 번호를 붙여 둡니다
        [...items].sort((a, b) => String(a.at).localeCompare(String(b.at))).forEach(x => { if (!x.no) x.no = nextNo(items, x.at); });
        await redis(['SET', key, JSON.stringify(items)]);
      }
      if (action === 'listings') return send(res, 200, { ok: true, items });
      if (req.query.op === 'photodel') { // 저장하지 않고 닫은 사진 정리 (저장된 매물에 쓰인 사진은 지우지 않음)
        const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
        const used = new Set(items.flatMap(x => (x.photos || []).map(p => p.url)));
        await dropPhotos((Array.isArray(body.urls) ? body.urls : []).filter(u => ownPhoto(u, s.id) && !used.has(u)).slice(0, 50));
        return send(res, 200, { ok: true });
      }
      if (req.method !== 'POST') return fail(res, 405, 'method', '허용되지 않는 요청입니다.');
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
      const str = (v, n) => String(v ?? '').replace(/[<>]/g, '').trim().slice(0, n);
      const numv = v => { const x = Number(String(v ?? '').replace(/[^\d.]/g, '')); return Number.isFinite(x) && x > 0 ? Math.round(x * 100) / 100 : null; };
      const id = str(body.id, 20).replace(/[^\w-]/g, '');
      const now = new Date().toISOString();
      if (body.op === 'save') {
        const it = body.item || {};
        const pnuOk = v => { const x = String(v || '').replace(/\D/g, ''); return /^\d{19}$/.test(x) ? x : ''; };
        // 주소 여러 개 (상가 여러 칸, 토지 여러 필지)
        const places = (Array.isArray(it.places) ? it.places : []).map(p => ({
          pnu: pnuOk(p.pnu), addr: str(p.addr, 80), lat: Number(p.lat) || null, lng: Number(p.lng) || null, bname: str(p.bname, 40),
          dong: str(p.dong, 20), ho: str(p.ho, 20), area: numv(p.area), site: numv(p.site), arch: numv(p.arch), land: !!p.land, ak: ['ex', 'tot', 'land'].includes(p.ak) ? p.ak : '',
        })).filter(p => p.pnu).slice(0, 30);
        if (!places.length) return fail(res, 400, 'bad_pnu', '주소를 먼저 골라 주세요.');
        const contacts = (Array.isArray(it.contacts) ? it.contacts : []).map(c => ({ role: str(c.role, 10), name: str(c.name, 20), phone: str(c.phone, 20).replace(/[^\d-]/g, '') }))
          .filter(c => c.name || c.phone).slice(0, 10);
        const rents = (Array.isArray(it.rents) ? it.rents : []).map(r => ({ label: str(r.label, 30), deposit: numv(r.deposit), rent: numv(r.rent), memo: str(r.memo, 60) }))
          .filter(r => r.label || r.deposit || r.rent || r.memo).slice(0, 60);
        const photos = (Array.isArray(it.photos) ? it.photos : []).map(p => ({ url: String(p && p.url || '') })).filter(p => ownPhoto(p.url, s.id)).slice(0, 30);
        const kind = ['sale', 'jeonse', 'wolse', 'presale'].includes(it.kind) ? it.kind : 'sale';
        const status = ['on', 'hold', 'done'].includes(it.status) ? it.status : 'on';
        const prev = id ? items.find(x => x.id === id) : null;
        if (!prev && items.length >= 1000) return fail(res, 400, 'full', '매물은 1,000건까지 저장할 수 있습니다. 계약 완료된 매물을 정리해 주세요.');
        const p0 = places[0], c0 = contacts[0] || {};
        let no = str(it.no, 20);
        if (no && items.some(x => x.no === no && x.id !== (prev && prev.id))) return fail(res, 400, 'dup_no', `매물번호 ${no}은(는) 이미 다른 매물에 쓰고 있습니다.`);
        if (!no) no = prev && prev.no ? prev.no : nextNo(items, now);
        const areaSum = places.reduce((a, p) => a + (p.area || 0), 0);
        const rec = {
          id: prev ? prev.id : Date.now().toString(36) + crypto.randomBytes(3).toString('hex'), no,
          // 목록·지도용 대표값 (첫 번째 주소 · 첫 번째 연락처)
          pnu: p0.pnu, addr: p0.addr, road: str(it.road, 80), bname: str(it.bname, 40) || p0.bname, lat: p0.lat, lng: p0.lng,
          dong: p0.dong, ho: p0.ho, area: areaSum ? Math.round(areaSum * 100) / 100 : null, owner: c0.name || '', phone: c0.phone || '',
          places, contacts, rents, photos,
          ptype: str(it.ptype, 10), ptypeTx: str(it.ptypeTx, 20), kind,
          price: numv(it.price), deposit: numv(it.deposit), rent: numv(it.rent), mgmt: numv(it.mgmt), premium: numv(it.premium),
          curDep: numv(it.curDep), curRent: numv(it.curRent), loan: numv(it.loan), pr: numv(it.pr), paid: numv(it.paid),
          memo: str(it.memo, 1000), status, at: prev ? prev.at : now, up: now,
        };
        items = prev ? items.map(x => (x.id === rec.id ? rec : x)) : [rec, ...items];
        if (prev && prev.photos) { const keep = new Set(photos.map(p => p.url)); await dropPhotos(prev.photos.map(p => p.url).filter(u => !keep.has(u) && ownPhoto(u, s.id))); }
      } else if (body.op === 'status') {
        const st = ['on', 'hold', 'done'].includes(body.status) ? body.status : null;
        if (!st) return fail(res, 400, 'status', '상태가 올바르지 않습니다.');
        items = items.map(x => (x.id === id ? { ...x, status: st, up: now } : x));
      } else if (body.op === 'del') {
        const gone = items.find(x => x.id === id);
        items = items.filter(x => x.id !== id);
        if (gone && gone.photos) await dropPhotos(gone.photos.map(p => p.url).filter(u => ownPhoto(u, s.id)));
      } else return fail(res, 400, 'op', '알 수 없는 요청입니다.');
      await redis(['SET', key, JSON.stringify(items)]);
      return send(res, 200, { ok: true, items });
    }

    if (action === 'login') {
      if (!REST) return fail(res, 500, 'no_key', 'Vercel 환경변수 KAKAO_REST_KEY 가 비어 있습니다.');
      const nonce = crypto.randomBytes(12).toString('base64url');
      const state = Buffer.from(JSON.stringify({ nonce, r: safeReturn(req.query.r), mk: req.query.mk === '1' })).toString('base64url');
      const u = new URL('https://kauth.kakao.com/oauth/authorize');
      u.searchParams.set('client_id', REST);
      u.searchParams.set('redirect_uri', `${origin(req)}/auth/callback`);
      u.searchParams.set('response_type', 'code');
      u.searchParams.set('state', state);
      return redirect(res, u.toString(), [cookie('rm_st', nonce, 600)]);
    }

    if (action === 'callback') {
      const st = (() => { try { return JSON.parse(Buffer.from(String(req.query.state || ''), 'base64url').toString()); } catch { return null; } })();
      const nonce = (String(req.headers.cookie || '').match(/(?:^|;\s*)rm_st=([^;]+)/) || [])[1];
      const back = st ? safeReturn(st.r) : '/';
      const sep = back.includes('?') ? '&' : '?';
      if (req.query.error) return redirect(res, `${back}${sep}login=cancel`, [cookie('rm_st', '', 0)]);
      if (!st || !nonce || st.nonce !== nonce || !req.query.code) return redirect(res, `${back}${sep}login=fail`, [cookie('rm_st', '', 0)]);

      // 인가 코드 → 토큰
      const body = new URLSearchParams({ grant_type: 'authorization_code', client_id: REST, redirect_uri: `${origin(req)}/auth/callback`, code: String(req.query.code) });
      if (CSECRET) body.set('client_secret', CSECRET);
      const t = await fetch('https://kauth.kakao.com/oauth/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8' }, body }).then(r => r.json());
      if (!t.access_token) return redirect(res, `${back}${sep}login=fail`, [cookie('rm_st', '', 0)]);
      // 토큰 → 회원 정보
      const me = await fetch('https://kapi.kakao.com/v2/user/me', { headers: { Authorization: `Bearer ${t.access_token}` } }).then(r => r.json());
      if (!me.id) return redirect(res, `${back}${sep}login=fail`, [cookie('rm_st', '', 0)]);
      const acc = me.kakao_account || {};
      const nick = (acc.profile && acc.profile.nickname) || (me.properties && me.properties.nickname) || '';
      const email = acc.email && acc.is_email_verified !== false ? acc.email : '';
      try {
        const key = `realmap:user:${me.id}`;
        const prev = await redis(['GET', key]);
        const old = prev ? JSON.parse(prev) : null;
        const now = new Date().toISOString();
        const rec = { id: String(me.id), nickname: nick, email, joined: old ? old.joined : now, last: now, marketing: old && !st.mk ? !!old.marketing : !!st.mk, marketingAt: st.mk ? now : (old ? old.marketingAt || null : null) };
        await redis(['SET', key, JSON.stringify(rec)]);
        if (!old) await redis(['SADD', 'realmap:users', String(me.id)]);
      } catch { /* 저장소가 없어도 로그인은 됩니다 */ }
      return redirect(res, `${back}${sep}login=ok`, [cookie('rm_st', '', 0), cookie('rm_s', makeSession(me.id, nick), DAYS * 86400)]);
    }

    if (action === 'withdraw') {
      if (req.method !== 'POST') return fail(res, 405, 'method', '허용되지 않는 요청입니다.');
      const s = readSession(req);
      if (!s) return fail(res, 401, 'auth', '로그인 상태가 아닙니다.');
      try { const ls = JSON.parse((await redis(['GET', `realmap:ls:${s.id}`])) || '[]'); await dropPhotos(ls.flatMap(x => (x.photos || []).map(p => p.url)).filter(u => ownPhoto(u, s.id))); } catch { /* 무시 */ }
      try { await redis(['DEL', `realmap:user:${s.id}`]); await redis(['DEL', `realmap:fav:${s.id}`]); await redis(['DEL', `realmap:zfav:${s.id}`]); await redis(['DEL', `realmap:cx:${s.id}`]); await redis(['SREM', 'realmap:zwatch', String(s.id)]); await redis(['DEL', `realmap:ls:${s.id}`]); await redis(['SREM', 'realmap:users', s.id]); } catch { /* 저장소 없음 */ }
      res.setHeader('Set-Cookie', [cookie('rm_s', '', 0)]);
      return send(res, 200, { ok: true });
    }
    return fail(res, 400, 'action', '알 수 없는 요청입니다.');
  } catch (e) {
    return fail(res, 502, 'error', e.message || '처리 중 오류가 발생했습니다.');
  }
}
