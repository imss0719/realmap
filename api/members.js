// 회원 관리 (운영자 전용)
// GET /api/members   헤더 x-admin-key: ADMIN_PASSWORD
// 조건: ① 운영자 카카오 계정(ADMIN_KAKAO_ID)으로 로그인 ② 관리자 비밀번호 일치
import crypto from 'node:crypto';
import { send, fail } from './_lib.js';
import { readSession, redis, R_URL, R_TOKEN } from './auth.js';

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
    send(res, 200, { ok: true, total: rows.length, marketing: rows.filter(r => r.marketing).length, rows, stats: await stats() });
  } catch (e) {
    fail(res, 502, 'storage', '회원 저장소를 읽지 못했습니다: ' + e.message);
  }
}

// 최근 30일 방문 통계 (한국 날짜 기준)
async function stats() {
  try {
    const days = [];
    for (let i = 0; i < 30; i++) days.push(new Date(Date.now() + 9 * 3600e3 - i * 864e5).toISOString().slice(0, 10).replace(/-/g, ''));
    const cmds = days.flatMap(d => [['PFCOUNT', `rm:st:${d}:uv`], ['GET', `rm:st:${d}:pv`], ['GET', `rm:st:${d}:pcl`], ['PFCOUNT', `rm:st:${d}:mem`], ['HGETALL', `rm:st:${d}:src`]]);
    cmds.push(['PFCOUNT', ...days.slice(0, 7).map(d => `rm:st:${d}:uv`)], ['PFCOUNT', ...days.map(d => `rm:st:${d}:uv`)]);
    const r = await fetch(R_URL.replace(/\/$/, '') + '/pipeline', { method: 'POST', headers: { Authorization: `Bearer ${R_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify(cmds) });
    const out = await r.json();
    const val = i => Number(out[i] && out[i].result) || 0;
    // HGETALL 결과는 [이름, 값, 이름, 값…] 또는 {이름: 값}
    const hash = o => { const r = o && o.result, m = {}; if (Array.isArray(r)) for (let k = 0; k < r.length; k += 2) m[r[k]] = Number(r[k + 1]) || 0; else if (r && typeof r === 'object') for (const [k, v] of Object.entries(r)) m[k] = Number(v) || 0; return m; };
    return {
      days: days.map((d, i) => ({ d, uv: val(i * 5), pv: val(i * 5 + 1), pcl: val(i * 5 + 2), mem: val(i * 5 + 3), src: hash(out[i * 5 + 4]) })),
      uv7: val(days.length * 5), uv30: val(days.length * 5 + 1),
    };
  } catch { return null; }
}
