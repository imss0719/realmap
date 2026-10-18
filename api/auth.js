// 회원(카카오 로그인)
//   /auth/login?r=/?pnu=...&mk=1   → 카카오 로그인 화면으로 이동 (mk=1: 리얼워커스 소식 받기 동의)
//   /auth/callback                  → 카카오가 돌려보내는 주소 (카카오 개발자센터 Redirect URI에 등록)
//   /api/auth?action=me             → 로그인 상태 { member, nickname }
//   /api/auth?action=logout         → 로그아웃
//   POST /api/auth?action=withdraw  → 회원 탈퇴 (저장된 회원 정보 삭제)
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
      return send(res, 200, { ok: true, ready: !!REST, member: !!s, nickname: s ? s.n : '' });
    }
    if (action === 'logout') return redirect(res, safeReturn(req.query.r), [cookie('rm_s', '', 0)]);

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
      try { await redis(['DEL', `realmap:user:${s.id}`]); await redis(['DEL', `realmap:fav:${s.id}`]); await redis(['SREM', 'realmap:users', s.id]); } catch { /* 저장소 없음 */ }
      res.setHeader('Set-Cookie', [cookie('rm_s', '', 0)]);
      return send(res, 200, { ok: true });
    }
    return fail(res, 400, 'action', '알 수 없는 요청입니다.');
  } catch (e) {
    return fail(res, 502, 'error', e.message || '처리 중 오류가 발생했습니다.');
  }
}
