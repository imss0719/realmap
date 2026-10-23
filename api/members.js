// 회원 관리 (운영자 전용)
// GET /api/members   헤더 x-admin-key: ADMIN_PASSWORD
// 조건: ① 운영자 카카오 계정(ADMIN_KAKAO_ID)으로 로그인 ② 관리자 비밀번호 일치
import crypto from 'node:crypto';
import { send, fail, MAX_KEYS, vworldData, cached, pool } from './_lib.js';
import { readSession, redis, R_URL, R_TOKEN, planOf, planView, PUB_KEY, syncPub, loadBk, brokerStat } from './auth.js';

const ADMIN_ID = String(process.env.ADMIN_KAKAO_ID || '').trim();
const ADMIN_PW = String(process.env.ADMIN_PASSWORD || '').trim();
const same = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };

export default async function (req, res) {
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  const s = readSession(req);
  if (!s) return fail(res, 401, 'login', '먼저 리얼맵에 카카오로 로그인해 주세요.');
  // 처음 설정: 운영자 회원번호가 아직 없으면, 로그인한 본인 번호만 알려 줍니다
  if (!ADMIN_ID) return send(res, 200, { ok: false, error: 'setup', myId: s.id, message: '운영자 카카오 회원번호가 아직 등록되지 않았습니다.' });
  if (s.id !== ADMIN_ID) return fail(res, 403, 'forbidden', '권한이 없습니다.');
  if (!ADMIN_PW) return fail(res, 500, 'no_password', 'Vercel 환경변수 ADMIN_PASSWORD 가 비어 있습니다.');
  if (!same(req.headers['x-admin-key'] || '', ADMIN_PW)) return fail(res, 401, 'password', '관리자 비밀번호가 맞지 않습니다.');
  if (req.query.part === 'brokers') return brokers(req, res);
  try {
    const ids = (await redis(['SMEMBERS', 'realmap:users'])) || [];
    let rows = [];
    for (let i = 0; i < ids.length; i += 200) {
      const chunk = ids.slice(i, i + 200);
      const vals = (await redis(['MGET', ...chunk.map(id => `realmap:user:${id}`)])) || [];
      vals.forEach(v => { try { if (v) rows.push(JSON.parse(v)); } catch { /* 건너뜀 */ } });
    }
    if (ids.length === 0 && (await redis(['PING'])) === null) return fail(res, 500, 'no_storage', '회원 저장소(Upstash)가 연결되지 않았습니다.');
    rows.sort((a, b) => String(b.joined).localeCompare(String(a.joined)));
    // 회원별 활동: 관심 부동산 개수, 관심 구역·추진 알림
    const zones = new Map(), alerts = [];
    for (let i = 0; i < rows.length; i += 200) {
      const chunk = rows.slice(i, i + 200);
      const [fv, zv] = await Promise.all([
        redis(['MGET', ...chunk.map(r => `realmap:fav:${r.id}`)]).catch(() => []),
        redis(['MGET', ...chunk.map(r => `realmap:zfav:${r.id}`)]).catch(() => []),
      ]);
      chunk.forEach((r, k) => {
        try { r.favs = fv && fv[k] ? (JSON.parse(fv[k]).items || []).length : 0; } catch { r.favs = 0; }
        let z = null; try { z = zv && zv[k] ? JSON.parse(zv[k]) : null; } catch { z = null; }
        const items = (z && z.items) || [];
        r.zones = items.length; r.zalerts = items.filter(x => x.alert).length; r.zemail = (z && z.email) || '';
        for (const x of items) {
          const e = zones.get(x.id) || { id: x.id, n: x.n, gu: x.gu, st: x.st, cnt: 0, alert: 0 };
          e.cnt++; if (x.alert) e.alert++; zones.set(x.id, e);
          if (x.alert && z.email) alerts.push({ nickname: r.nickname || '', email: z.email, zone: x.n, gu: x.gu, st: x.st, at: x.at || '', emailAt: z.emailAt || '' });
        }
      });
    }
    const zrank = [...zones.values()].sort((a, b) => b.cnt - a.cnt || b.alert - a.alert).slice(0, 30);
    send(res, 200, { ok: true, total: rows.length, marketing: rows.filter(r => r.marketing).length, rows, stats: await stats(),
      zsum: { members: rows.filter(r => r.zones).length, alertMembers: rows.filter(r => r.zalerts && r.zemail).length, zones: zones.size }, zrank, alerts });
  } catch (e) {
    fail(res, 502, 'storage', '회원 저장소를 읽지 못했습니다: ' + e.message);
  }
}

// 최근 30일 방문 통계 (한국 날짜 기준)
async function stats() {
  try {
    const days = [];
    for (let i = 0; i < 30; i++) days.push(new Date(Date.now() + 9 * 3600e3 - i * 864e5).toISOString().slice(0, 10).replace(/-/g, ''));
    const N = 10;
    const cmds = days.flatMap(d => [['PFCOUNT', `rm:st:${d}:uv`], ['GET', `rm:st:${d}:pv`], ['GET', `rm:st:${d}:pcl`], ['PFCOUNT', `rm:st:${d}:mem`], ['HGETALL', `rm:st:${d}:src`], ['HGETALL', `rm:st:${d}:gu`],
      ['PFCOUNT', `rm:st:${d}:suv`], ['GET', `rm:st:${d}:spv`], ['HGETALL', `rm:st:${d}:spg`], ['HGETALL', `rm:st:${d}:ssrc`]]);
    cmds.push(['PFCOUNT', ...days.slice(0, 7).map(d => `rm:st:${d}:suv`)], ['PFCOUNT', ...days.map(d => `rm:st:${d}:suv`)]);
    cmds.push(['PFCOUNT', ...days.slice(0, 7).map(d => `rm:st:${d}:uv`)], ['PFCOUNT', ...days.map(d => `rm:st:${d}:uv`)], ['DBSIZE']);
    const r = await fetch(R_URL.replace(/\/$/, '') + '/pipeline', { method: 'POST', headers: { Authorization: `Bearer ${R_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify(cmds) });
    const out = await r.json();
    const val = i => Number(out[i] && out[i].result) || 0;
    // HGETALL 결과는 [이름, 값, 이름, 값…] 또는 {이름: 값}
    const hash = o => { const r = o && o.result, m = {}; if (Array.isArray(r)) for (let k = 0; k < r.length; k += 2) m[r[k]] = Number(r[k + 1]) || 0; else if (r && typeof r === 'object') for (const [k, v] of Object.entries(r)) m[k] = Number(v) || 0; return m; };
    return {
      days: days.map((d, i) => ({ d, uv: val(i * N), pv: val(i * N + 1), pcl: val(i * N + 2), mem: val(i * N + 3), src: hash(out[i * N + 4]), gu: hash(out[i * N + 5]),
        suv: val(i * N + 6), spv: val(i * N + 7), spg: hash(out[i * N + 8]), ssrc: hash(out[i * N + 9]) })),
      suv7: val(days.length * N), suv30: val(days.length * N + 1),
      uv7: val(days.length * N + 2), uv30: val(days.length * N + 3),
      keys: val(days.length * N + 4), maxKeys: MAX_KEYS,
      guNames: await guNames(days.map((d, i) => hash(out[i * N + 5]))),
    };
  } catch { return null; }
}

// 시군구 코드 → "경기 김포시" 같은 이름 (브이월드 행정구역, 한 번 찾으면 오래 기억)
const SIDO = { '11': '서울', '26': '부산', '27': '대구', '28': '인천', '29': '광주', '30': '대전', '31': '울산', '36': '세종', '41': '경기', '42': '강원', '43': '충북', '44': '충남', '45': '전북', '46': '전남', '47': '경북', '48': '경남', '50': '제주', '51': '강원', '52': '전북' };
async function guNames(daily) {
  const codes = [...new Set(daily.flatMap(m => Object.keys(m || {})))].filter(c => /^\d{5}$/.test(c)).slice(0, 60);
  const out = {};
  const rs = await pool(codes, 5, c => cached('signm:' + c, 30 * 864e5, async () => {
    const f = await vworldData({ data: 'LT_C_ADSIGG_INFO', attrFilter: `sig_cd:=:${c}`, geometry: 'false', size: '1' });
    const nm = f[0] && f[0].properties && String(f[0].properties.sig_kor_nm || '').trim();
    if (!nm) throw new Error('none');
    return nm;
  }));
  codes.forEach((c, i) => { const sd = SIDO[c.slice(0, 2)] || ''; out[c] = rs[i].ok ? `${sd} ${rs[i].v}`.trim() : sd ? `${sd} (${c})` : c; });
  return out;
}

// ---------- 중개사 회원 관리 ----------
//   GET  /api/members?part=brokers → { rows:[{ id, nickname, joined, last, bk, plan, stat }], pubs:[게시 중 광고] }
//   POST /api/members?part=brokers { uid, op:'plan', plan, days } | { uid, op:'verify', on } | { uid, op:'unpubAll' } | { k:'회원id:매물id', op:'unpub' }
const PLAN_NAMES = ['free', 'trial', 'basic', 'premium', 'vip'];
async function brokers(req, res) {
  try {
    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
      const uid = String(body.uid || String(body.k || '').split(':')[0] || '').replace(/\D/g, '');
      if (!uid) return fail(res, 400, 'uid', '회원 번호가 필요합니다.');
      if (body.op === 'plan') {
        if (!PLAN_NAMES.includes(body.plan)) return fail(res, 400, 'plan', '요금제를 확인해 주세요.');
        const days = Math.max(0, Math.min(3660, Number(body.days) || 0));
        const prev = JSON.parse((await redis(['GET', `realmap:plan:${uid}`])) || 'null');
        await redis(['SET', `realmap:plan:${uid}`, JSON.stringify({ plan: body.plan, until: days ? new Date(Date.now() + days * 86400e3).toISOString() : null, trialUsed: true, at: new Date().toISOString(), by: 'op', prev: prev && prev.plan })]);
        await redis(['SADD', 'realmap:brokers', uid]);
      } else if (body.op === 'verify') {
        const bk = await loadBk(uid); if (!bk) return fail(res, 404, 'bk', '중개사무소 정보가 없습니다.');
        bk.verified = body.on ? new Date().toISOString() : false;
        await redis(['SET', `realmap:bk:${uid}`, JSON.stringify(bk)]);
      } else if (body.op === 'unpub' || body.op === 'unpubAll') {
        const items = JSON.parse((await redis(['GET', `realmap:ls:${uid}`])) || '[]');
        const lid = String(body.k || '').split(':')[1] || '';
        const hit = items.filter(x => x.pub && x.pub.on && (body.op === 'unpubAll' || x.id === lid));
        hit.forEach(x => { x.pub.on = false; x.pub.byOp = new Date().toISOString(); });
        await redis(['SET', `realmap:ls:${uid}`, JSON.stringify(items)]);
        const f = body.op === 'unpubAll' ? items.map(x => `${uid}:${x.id}`) : [`${uid}:${lid}`];
        if (f.length) await redis(['HDEL', PUB_KEY, ...f]);
        await brokerStat(uid, items);
      } else return fail(res, 400, 'op', '알 수 없는 요청입니다.');
      // 공개 목록·통계 다시 맞춤
      try { const items = JSON.parse((await redis(['GET', `realmap:ls:${uid}`])) || '[]'); const P = await planOf(uid); await syncPub(uid, items, await loadBk(uid), P); await redis(['SET', `realmap:ls:${uid}`, JSON.stringify(items)]); await brokerStat(uid, items); } catch { /* 다음 저장 때 */ }
    }
    let ids = (await redis(['SMEMBERS', 'realmap:brokers'])) || [];
    const legacy = (await redis(['SMEMBERS', 'realmap:pro'])) || [];
    ids = [...new Set([...ids, ...legacy, ...(ADMIN_ID ? [ADMIN_ID] : [])].map(String))];
    const rows = [];
    for (let i = 0; i < ids.length; i += 100) {
      const ch = ids.slice(i, i + 100);
      const [us, bks, sts] = await Promise.all(['user', 'bk', 'bstat'].map(k => redis(['MGET', ...ch.map(id => `realmap:${k}:${id}`)]).catch(() => [])));
      for (let k = 0; k < ch.length; k++) {
        const j = v => { try { return v ? JSON.parse(v) : null; } catch { return null; } };
        const u = j(us && us[k]) || {}, P = await planOf(ch[k]);
        rows.push({ id: ch[k], nickname: u.nickname || '', email: u.email || '', joined: u.joined || '', last: u.last || '', bk: j(bks && bks[k]), plan: planView(P), stat: j(sts && sts[k]) });
      }
    }
    rows.sort((a, b) => String((b.stat && b.stat.up) || b.last).localeCompare(String((a.stat && a.stat.up) || a.last)));
    const raw = (await redis(['HGETALL', PUB_KEY])) || [];
    const arr = Array.isArray(raw) ? raw : Object.entries(raw).flat();
    const pubs = [];
    for (let i = 0; i < arr.length; i += 2) { try { const v = JSON.parse(arr[i + 1]); pubs.push({ k: v.k, office: v.bk && v.bk.office, kind: v.kind, ptype: v.ptype, price: v.price, deposit: v.deposit, rent: v.rent, pr: v.pr, addr: v.addr, bname: v.bname, at: v.at, chk: v.chk, exp: v.exp, pnu: v.pnu }); } catch { /* 건너뜀 */ } }
    pubs.sort((a, b) => String(b.at).localeCompare(String(a.at)));
    return send(res, 200, { ok: true, rows, pubs });
  } catch (e) { return fail(res, 502, 'storage', '중개사 정보를 읽지 못했습니다: ' + e.message); }
}
