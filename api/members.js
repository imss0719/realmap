// 회원 관리 (운영자 전용)
// GET /api/members   헤더 x-admin-key: ADMIN_PASSWORD
// 조건: ① 운영자 카카오 계정(ADMIN_KAKAO_ID)으로 로그인 ② 관리자 비밀번호 일치
import crypto from 'node:crypto';
import { send, fail, MAX_KEYS, vworldData, cached, pool } from './_lib.js';
import { readSession, redis, R_URL, R_TOKEN, planOf, planView, PUB_KEY, syncPub, loadBk, brokerStat, startTrial, dropPhotos, PLANS, lsLoad, lsMutate } from './auth.js';

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
// 요금 변경 이력 (전체 300건 · 운영자 화면) + 회원 알림 (회원 화면 [알림]에 '요금제가 적용되었습니다')
async function planLog(uid, prev, rec, by, note = '', quiet = false) {
  const bk = await loadBk(uid).catch(() => null);
  const e = { at: rec.at, uid: String(uid), office: (bk && bk.office) || '', from: prev ? { plan: prev.plan, until: prev.until || null } : null, to: { plan: rec.plan, until: rec.until || null }, by, why: rec.why || '', memo: rec.memo || note || '' };
  try { await redis(['LPUSH', 'realmap:planlog', JSON.stringify(e)]); await redis(['LTRIM', 'realmap:planlog', '0', '299']); } catch { /* 이력은 보조 */ }
  // 결제 확인은 이미 입금 알림이 따로 가므로 운영자 변경만 (무료로 내릴 때는 알리지 않음)
  if (!quiet && rec.plan !== 'free') try {
    await redis(['LPUSH', `realmap:pnote:${uid}`, JSON.stringify({ id: Date.now().toString(36), at: rec.at, plan: rec.plan, name: (PLANS[rec.plan] || {}).name || rec.plan, until: rec.until || null, prev: prev ? prev.plan : '' })]);
    await redis(['LTRIM', `realmap:pnote:${uid}`, '0', '9']);
  } catch { /* 알림은 보조 */ }
}
async function brokers(req, res) {
  try {
    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
      // 계좌이체 입금 확인 · 문의 답변 (10/27)
      if (body.op === 'visit') {   // 방문 설명 신청 처리 (10/27): st = new · call(연락함) · done(방문 완료) · no(취소)
        const id = String(body.id || '').slice(0, 30), rec = await redis(['HGET', 'realmap:visit', id]).then(v => { try { return JSON.parse(v); } catch { return null; } });
        if (!rec) return fail(res, 404, 'none', '신청을 찾지 못했습니다.');
        if (['new', 'call', 'done', 'no'].includes(body.st)) { rec.st = body.st; rec.stAt = new Date().toISOString(); }
        if (typeof body.note === 'string') rec.note = body.note.replace(/[<>]/g, '').trim().slice(0, 300);
        await redis(['HSET', 'realmap:visit', id, JSON.stringify(rec)]);
        return send(res, 200, { ok: true, rec });
      }
      if (['payok', 'payno', 'reply'].includes(body.op)) {
        const key = body.op === 'reply' ? 'realmap:qna' : 'realmap:pays', id = String(body.id || '').slice(0, 30);
        const rec = await redis(['HGET', key, id]).then(v => { try { return JSON.parse(v); } catch { return null; } });
        if (!rec) return fail(res, 404, 'none', '기록을 찾지 못했습니다.');
        const now = new Date().toISOString();
        if (body.op === 'reply') {
          const text = String(body.text || '').replace(/[<>]/g, '').trim().slice(0, 3000); if (!text) return fail(res, 400, 'text', '답변을 적어 주세요.');
          rec.reply = text; rec.rat = now;
        } else {
          if (rec.st !== 'wait') return fail(res, 400, 'done', '이미 처리된 신청입니다.');
          if (body.op === 'payno') { rec.st = 'no'; rec.why = String(body.why || '').replace(/[<>]/g, '').slice(0, 100); rec.done = now; }
          else {
            // 남은 기간 뒤에 이어 붙임 (지금 유료 기간이 남아 있으면 그 끝에서부터 · 요금제는 새로 고른 것으로)
            const prev = JSON.parse((await redis(['GET', `realmap:plan:${rec.uid}`])) || 'null');
            const base = new Date(prev && ['basic', 'premium', 'vip'].includes(prev.plan) && prev.until && prev.until > now ? prev.until : now);
            const until = new Date(base); until.setMonth(until.getMonth() + rec.mon);
            // 직원 자리(10/28): 요금제와 같이 낸 자리 수 · 기간 중 추가(kind 'seat')는 지금 요금제·기간 그대로 자리만 늘림
            const nrec = rec.kind === 'seat' && prev ? { ...prev, seats: (Number(prev.seats) || 0) + (Number(rec.seats) || 0), at: now, pay: rec.id }
              : { plan: rec.plan, until: until.toISOString(), trialUsed: true, at: now, by: 'pay', pay: rec.id, mon: rec.mon, prev: prev && prev.plan, seats: Number(rec.seats) || 0 };
            await redis(['SET', `realmap:plan:${rec.uid}`, JSON.stringify(nrec)]);
            await planLog(rec.uid, prev, nrec, 'pay', `${rec.kind === 'seat' ? `직원 자리 +${rec.seats}명 · ` : ''}${rec.mon}개월${rec.seats && rec.kind !== 'seat' ? ` · 직원 ${rec.seats}명` : ''} ${rec.amt.toLocaleString()}원`, true);
            await redis(['SADD', 'realmap:brokers', rec.uid]);
            rec.st = 'ok'; rec.done = now; rec.until = nrec.until || null;
            try { const uid = rec.uid, P = await planOf(uid), bk = await loadBk(uid); const items = await lsMutate(redis, uid, ls => syncPub(uid, ls, bk, P)); await brokerStat(uid, items); } catch { /* 다음 저장 때 */ }
          }
        }
        await redis(['HSET', key, rec.id, JSON.stringify(rec)]);
        return send(res, 200, { ok: true, rec });
      }
      const uid = String(body.uid || String(body.k || '').split(':')[0] || '').replace(/\D/g, '');
      if (!uid) return fail(res, 400, 'uid', '회원 번호가 필요합니다.');
      if (body.op === 'plan') {
        // 10/27 요금제 바꾸기: 기간을 남은 기간 뒤에 더하기(add) · 날짜 지정(until) · 무기한(forever) + 사유·메모 → 이력·회원 알림
        if (!PLAN_NAMES.includes(body.plan)) return fail(res, 400, 'plan', '요금제를 확인해 주세요.');
        const prev = JSON.parse((await redis(['GET', `realmap:plan:${uid}`])) || 'null');
        const nowD = new Date(), live = prev && prev.plan !== 'free' && (!prev.until || prev.until > nowD.toISOString());
        let until = null;
        if (body.plan !== 'free' && !body.forever) {
          if (body.until) { until = new Date(String(body.until).slice(0, 10) + 'T23:59:59+09:00'); if (isNaN(until) || until < nowD) return fail(res, 400, 'until', '끝나는 날짜를 확인해 주세요.'); }
          else {
            const n = Math.max(1, Math.min(120, Number(body.n) || 0)), unit = body.unit === 'm' ? 'm' : 'd';
            if (!Number(body.n) && Number(body.days)) { until = new Date(Date.now() + Math.min(3660, Number(body.days)) * 86400e3); }   // 예전 방식(days)
            else { until = new Date(live && prev.until ? prev.until : nowD); if (unit === 'm') until.setMonth(until.getMonth() + n); else until.setDate(until.getDate() + n); }
          }
        }
        const WHY = ['지인', '프로모션', '보상', '결제', '기타'], why = WHY.includes(body.why) ? body.why : '기타';
        const memo = String(body.memo || '').replace(/[<>]/g, '').trim().slice(0, 100);
        const seats = body.seats == null ? (prev && Number(prev.seats)) || 0 : Math.max(0, Math.min(99, Math.round(Number(body.seats) || 0)));   // 직원 자리 (10/28)
        const rec = { plan: body.plan, until: until ? until.toISOString() : null, trialUsed: true, at: nowD.toISOString(), by: 'op', why, memo, prev: prev && prev.plan, ...(seats ? { seats } : {}) };
        await redis(['SET', `realmap:plan:${uid}`, JSON.stringify(rec)]);
        await redis(['SADD', 'realmap:brokers', uid]);
        await planLog(uid, prev, rec, 'op');
      } else if (body.op === 'memo') {   // 운영 메모 (회원에게는 보이지 않음)
        const m = String(body.memo || '').replace(/[<>]/g, '').trim().slice(0, 200);
        await redis(m ? ['SET', `realmap:opmemo:${uid}`, m] : ['DEL', `realmap:opmemo:${uid}`]);
        return send(res, 200, { ok: true, memo: m });
      } else if (body.op === 'verify') {
        const bk = await loadBk(uid); if (!bk) return fail(res, 404, 'bk', '중개사무소 정보가 없습니다.');
        bk.verified = body.on ? new Date().toISOString() : false;
        if (body.on) { bk.vby = 'op'; delete bk.pend; delete bk.vst; delete bk.vmsg; }
        await redis(['SET', `realmap:bk:${uid}`, JSON.stringify(bk)]);
        const d = String(bk.regno || '').replace(/\D/g, '');
        if (body.on && d) await redis(['HSET', 'realmap:regno', d, uid]).catch(() => 0);
        // 확인 대기였던 신청자: 승인하면 그때 체험(또는 무료) 시작
        if (body.on && !(await planOf(uid)).started) await startTrial(uid);
      } else if (body.op === 'nophoto') { // 부적절한 대표 사진 지우기
        const bk = await loadBk(uid); if (!bk) return fail(res, 404, 'bk', '중개사무소 정보가 없습니다.');
        if (bk.photo) { await dropPhotos([bk.photo]); bk.photo = ''; await redis(['SET', `realmap:bk:${uid}`, JSON.stringify(bk)]); }
      } else if (body.op === 'unpub' || body.op === 'unpubAll') {
        const lid = String(body.k || '').split(':')[1] || '';
        const items = await lsMutate(redis, uid, ls => { ls.filter(x => x.pub && x.pub.on && (body.op === 'unpubAll' || x.id === lid)).forEach(x => { x.pub.on = false; x.pub.byOp = new Date().toISOString(); }); });
        const f = body.op === 'unpubAll' ? items.map(x => `${uid}:${x.id}`) : [`${uid}:${lid}`];
        if (f.length) await redis(['HDEL', PUB_KEY, ...f]);
        await brokerStat(uid, items);
      } else return fail(res, 400, 'op', '알 수 없는 요청입니다.');
      // 공개 목록·통계 다시 맞춤
      try { const P = await planOf(uid), bk = await loadBk(uid); const items = await lsMutate(redis, uid, ls => syncPub(uid, ls, bk, P)); await brokerStat(uid, items); } catch { /* 공개 목록은 다음 저장 때 */ }
    }
    let ids = (await redis(['SMEMBERS', 'realmap:brokers'])) || [];
    const legacy = (await redis(['SMEMBERS', 'realmap:pro'])) || [];
    ids = [...new Set([...ids, ...legacy, ...(ADMIN_ID ? [ADMIN_ID] : [])].map(String))];
    const rows = [];
    for (let i = 0; i < ids.length; i += 100) {
      const ch = ids.slice(i, i + 100);
      const [us, bks, sts, pls, oms] = await Promise.all(['user', 'bk', 'bstat', 'plan', 'opmemo'].map(k => redis(['MGET', ...ch.map(id => `realmap:${k}:${id}`)]).catch(() => [])));
      const sns = await Promise.all(ch.map(id => redis(['HLEN', `realmap:staff:${id}`]).catch(() => 0)));   // 직원 수 (승인 대기 포함)
      for (let k = 0; k < ch.length; k++) {
        const j = v => { try { return v ? JSON.parse(v) : null; } catch { return null; } };
        const u = j(us && us[k]) || {}, P = await planOf(ch[k]);
        const pr = j(pls && pls[k]) || {};
        rows.push({ id: ch[k], nickname: u.nickname || '', email: u.email || '', joined: u.joined || '', last: u.last || '', bk: j(bks && bks[k]), plan: planView(P), stat: j(sts && sts[k]),
          src: { by: pr.by || '', why: pr.why || '', memo: pr.memo || '', mon: pr.mon || 0, at: pr.at || '' }, opmemo: (oms && oms[k]) || '', staff: Number(sns && sns[k]) || 0 });
      }
    }
    rows.sort((a, b) => String((b.stat && b.stat.up) || b.last).localeCompare(String((a.stat && a.stat.up) || a.last)));
    const raw = (await redis(['HGETALL', PUB_KEY])) || [];
    const arr = Array.isArray(raw) ? raw : Object.entries(raw).flat();
    const pubs = [];
    for (let i = 0; i < arr.length; i += 2) { try { const v = JSON.parse(arr[i + 1]); pubs.push({ k: v.k, office: v.bk && v.bk.office, kind: v.kind, ptype: v.ptype, price: v.price, deposit: v.deposit, rent: v.rent, pr: v.pr, addr: v.addr, bname: v.bname, at: v.at, chk: v.chk, exp: v.exp, pnu: v.pnu }); } catch { /* 건너뜀 */ } }
    pubs.sort((a, b) => String(b.at).localeCompare(String(a.at)));
    const dups = ((await redis(['LRANGE', 'realmap:bkdup', '0', '29']).catch(() => [])) || []).map(v => { try { return JSON.parse(v); } catch { return null; } }).filter(Boolean);
    const all = async key => { const r = (await redis(['HGETALL', key]).catch(() => [])) || []; const a = Array.isArray(r) ? r : Object.entries(r).flat(); const o = []; for (let i = 1; i < a.length; i += 2) { try { o.push(JSON.parse(a[i])); } catch { /* 건너뜀 */ } } return o.sort((x, y) => String(y.at).localeCompare(String(x.at))).slice(0, 200); };
    const [pays, qnas, visits] = await Promise.all([all('realmap:pays'), all('realmap:qna'), all('realmap:visit')]);
    const plog = ((await redis(['LRANGE', 'realmap:planlog', '0', '299']).catch(() => [])) || []).map(v => { try { return JSON.parse(v); } catch { return null; } }).filter(Boolean);
    // 처리(방문 완료·취소) 뒤 1년 지난 방문 신청은 지움 (개인정보처리방침)
    const vold = visits.filter(v => ['done', 'no'].includes(v.st) && v.stAt && Date.now() - new Date(v.stAt) > 365 * 864e5).map(v => v.id);
    if (vold.length) { await redis(['HDEL', 'realmap:visit', ...vold]).catch(() => 0); }
    const vlist = visits.filter(v => !vold.includes(v.id)).sort((a, b) => String(b.at).localeCompare(String(a.at)));
    pays.forEach(p => { p.pname = (PLANS[p.plan] || {}).name || p.plan; });
    return send(res, 200, { ok: true, rows, pubs, dups, pays, qnas, visits: vlist, plog });
  } catch (e) { return fail(res, 502, 'storage', '중개사 정보를 읽지 못했습니다: ' + e.message); }
}
