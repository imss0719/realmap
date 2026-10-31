// 직원(소속공인중개사 · 중개보조원) — 10/28
// 직원은 자기 카카오로 로그인하고, 서버가 '대표의 장부'를 열어 줍니다 (대표 자료는 옮기지 않음).
//   realmap:staff:<대표id>   해시  직원id → { uid, name, role:'agt'|'ast', phone, st:'wait'|'on', at, okAt, nick }
//   realmap:staffof:<직원id> { o: 대표id, st }        — 카카오 계정 하나는 한 사무소에만
//   realmap:inv:<코드> = 대표id (7일) · realmap:invc:<대표id> = { code, exp }  — 새 링크를 만들면 이전 링크는 막힘
//   realmap:sperm:<대표id>  { agtDel, agtPub, astDel }  — 대표가 구분별로 한꺼번에 정하는 권한
// 법: 중개보조원 수 ≤ (개업공인중개사 + 소속공인중개사) × 5 (공인중개사법 제15조 3항)
import crypto from 'node:crypto';

export const ROLE = { ceo: '대표', agt: '소속공인중개사', ast: '중개보조원' };
export const SEAT = 2900;                                   // 직원 1명당 월 (부가세 포함)
const PERM0 = { agtDel: true, agtPub: true, astDel: false };
const J = v => { try { return v ? JSON.parse(v) : null; } catch { return null; } };
const flat = raw => (Array.isArray(raw) ? raw : Object.entries(raw || {}).flat());
const t = (v, n) => String(v ?? '').replace(/[<>]/g, '').trim().slice(0, n);

// 로그인한 사람 → 어느 사무소 장부를 쓰는지. 승인된 직원이면 id를 대표 id로 바꿔 돌려줌 (me = 본인 id)
export async function officeOf(redis, s) {
  if (!s) return null;
  const f = J(await redis(['GET', `realmap:staffof:${s.id}`]).catch(() => null));
  if (f && f.st === 'on' && f.o) {
    const m = J(await redis(['HGET', `realmap:staff:${f.o}`, String(s.id)]).catch(() => null));
    if (m && m.st === 'on') return { ...s, id: String(f.o), me: String(s.id), staff: true, role: m.role, sname: m.name };
  }
  return { ...s, me: String(s.id), staff: false, role: 'ceo', sname: '', wait: f && f.st === 'wait' ? String(f.o) : '' };
}
export async function permOf(redis, o) { return { ...PERM0, ...(J(await redis(['GET', `realmap:sperm:${o}`]).catch(() => null)) || {}) }; }
// 할 수 있는지: del(매물·고객·단지 지우기) · pub(지도 광고) · ceo(엑셀·요금·사무소 정보·직원·해지)
export function can(so, perm, act) {
  if (!so || !so.staff) return true;
  if (act === 'ceo') return false;
  if (act === 'pub') return so.role === 'agt' && perm.agtPub !== false;
  if (act === 'del') return so.role === 'agt' ? perm.agtDel !== false : perm.astDel === true;
  return true;
}
export async function members(redis, o) {
  const arr = flat((await redis(['HGETALL', `realmap:staff:${o}`]).catch(() => [])) || []), out = [];
  for (let i = 1; i < arr.length; i += 2) { const m = J(arr[i]); if (m) out.push(m); }
  return out.sort((a, b) => String(a.at).localeCompare(String(b.at)));
}
export async function teamN(redis, o) { return (await members(redis, o)).filter(m => m.st === 'on').length; }
// 직원 자리: 체험 5명 · 무료 0 · 유료는 결제한 자리 수(seats) · 운영자 계정 99
export const seatsOf = P => (P.op ? 99 : P.plan === 'trial' ? 5 : P.plan === 'free' || P.plan === 'none' ? 0 : Number(P.seats) || 0);
const astMax = L => 5 * (1 + L.filter(m => m.st === 'on' && m.role === 'agt').length);

// 대표·직원 모두 해지·탈퇴할 때
export async function dropTeam(redis, o) {
  for (const m of await members(redis, o)) await redis(['DEL', `realmap:staffof:${m.uid}`]).catch(() => 0);
  const ic = J(await redis(['GET', `realmap:invc:${o}`]).catch(() => null));
  if (ic && ic.code) await redis(['DEL', `realmap:inv:${ic.code}`]).catch(() => 0);
  for (const k of [`realmap:staff:${o}`, `realmap:invc:${o}`, `realmap:sperm:${o}`]) await redis(['DEL', k]).catch(() => 0);
}
export async function leave(redis, me) {
  const f = J(await redis(['GET', `realmap:staffof:${me}`]).catch(() => null));
  if (f && f.o) await redis(['HDEL', `realmap:staff:${f.o}`, String(me)]).catch(() => 0);
  await redis(['DEL', `realmap:staffof:${me}`]).catch(() => 0);
}

// GET/POST /api/auth?action=staff
//   GET ?code=XXXX (로그인 없이) → 초대한 사무소 이름 · 대표 (참여 화면)
//   GET → 대표: { list, perm, inv, seats, astMax } · 직원·신청자: { mine }
//   POST 대표: inv · invoff · ok{uid} · no{uid} · role{uid,role} · out{uid} · perm{agtDel,agtPub,astDel}
//   POST 누구나: join{code,name,role,phone} (휴대폰 인증 30분 안) · 직원: leave
export async function staffApi({ redis, s, req, res, send, fail, planOf, loadBk, note, smsTo }) {
  res.setHeader('Cache-Control', 'no-store');
  const code = t(req.query.code, 12).toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (req.method !== 'POST' && code) {
    const o = await redis(['GET', `realmap:inv:${code}`]);
    if (!o) return send(res, 200, { ok: true, valid: false });
    const bk = await loadBk(o);
    return send(res, 200, { ok: true, valid: true, office: (bk && bk.office) || '', ceo: (bk && bk.ceo) || '', me: s ? await mineOf(redis, s.id, loadBk) : null, login: !!s });
  }
  if (!s) return fail(res, 401, 'login', '로그인이 필요합니다.');
  const so = await officeOf(redis, s);
  const body = req.method === 'POST' ? (typeof req.body === 'string' ? J(req.body) || {} : (req.body || {})) : {};
  const P0 = await planOf(s.id);

  // ---- 참여 신청 · 나가기 (직원 쪽) ----
  if (body.op === 'join') {
    const o = await redis(['GET', `realmap:inv:${t(body.code, 12).toUpperCase()}`]);
    if (!o) return fail(res, 400, 'code', '초대 링크가 만료되었거나 바뀌었습니다. 대표님께 새 링크를 받아 주세요.');
    if (String(o) === String(s.id)) return fail(res, 400, 'self', '본인 사무소의 초대 링크입니다.');
    if (P0.started) return fail(res, 400, 'own', '이 카카오 계정은 이미 중개장부를 쓰고 있어 다른 사무소의 직원으로 참여할 수 없습니다. 다른 카카오 계정으로 로그인해 주세요.');
    const f = J(await redis(['GET', `realmap:staffof:${s.id}`]));
    if (f && f.o && String(f.o) !== String(o)) return fail(res, 400, 'other', '이미 다른 사무소의 직원으로 참여 중입니다. 그 사무소에서 먼저 나간 뒤 신청해 주세요.');
    const name = t(body.name, 20), role = body.role === 'agt' ? 'agt' : 'ast', phone = String(body.phone || '').replace(/\D/g, '');
    if (!name) return fail(res, 400, 'name', '이름을 적어 주세요.');
    if (!/^01\d{8,9}$/.test(phone)) return fail(res, 400, 'phone', '휴대폰 번호를 확인해 주세요.');
    if ((await redis(['GET', `realmap:smsok:${s.id}`])) !== phone) return fail(res, 400, 'sms', '휴대폰 인증을 먼저 해 주세요.');
    const prev = J(await redis(['HGET', `realmap:staff:${o}`, String(s.id)]));
    // 10/31 고침: 이미 승인된 직원이 초대 링크로 다시 신청해도 역할(보조원→소속공인중개사)은 바뀌지 않음 — 역할 변경은 대표만
    const m = { uid: String(s.id), name, role: prev && prev.st === 'on' && prev.role ? prev.role : role, phone: phone.replace(/^(\d{3})(\d{3,4})(\d{4})$/, '$1-$2-$3'), st: prev && prev.st === 'on' ? 'on' : 'wait', at: (prev && prev.at) || new Date().toISOString(), okAt: (prev && prev.okAt) || '', nick: s.n || '' };
    await redis(['HSET', `realmap:staff:${o}`, String(s.id), JSON.stringify(m)]);
    await redis(['SET', `realmap:staffof:${s.id}`, JSON.stringify({ o: String(o), st: m.st })]);
    // 10/31 참여 신청·나가기를 되풀이해도 대표님 문자는 하루 한 번 (알림 목록에는 그대로 남음)
    if (m.st === 'wait' && !prev) { await note(o, { k: 'staff', name, role, uid: String(s.id) }); if ((await redis(['SET', `realmap:smsonce:staff:${o}:${s.id}`, '1', 'EX', 86400, 'NX']).catch(() => 'OK')) === 'OK') await smsTo(o, `[리얼맵] ${name}님(${ROLE[role]})이 중개장부 직원 참여를 신청했습니다. [설정 → 직원 관리]에서 승인해 주세요.`); }
    return send(res, 200, { ok: true, mine: await mineOf(redis, s.id, loadBk) });
  }
  if (body.op === 'leave') { await leave(redis, s.id); return send(res, 200, { ok: true }); }
  if (so.staff || so.wait) return req.method === 'POST' ? fail(res, 403, 'staff', '직원 관리는 대표만 할 수 있습니다.') : send(res, 200, { ok: true, mine: await mineOf(redis, s.id, loadBk) });

  // ---- 대표 ----
  const o = String(s.id), P = P0;
  if (!P.started) return fail(res, 403, 'start', '중개사 서비스를 먼저 시작해 주세요.');
  const K = `realmap:staff:${o}`;
  if (req.method === 'POST') {
    const L = await members(redis, o), uid = String(body.uid || '').replace(/\D/g, ''), m = L.find(x => x.uid === uid);
    const on = L.filter(x => x.st === 'on'), seats = seatsOf(P);
    if (body.op === 'inv') {
      const old = J(await redis(['GET', `realmap:invc:${o}`])); if (old && old.code) await redis(['DEL', `realmap:inv:${old.code}`]);
      const c = Array.from(crypto.randomBytes(8)).map(b => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[b % 32]).join('');
      const exp = new Date(Date.now() + 7 * 864e5).toISOString();
      await redis(['SET', `realmap:inv:${c}`, o, 'EX', 7 * 86400]); await redis(['SET', `realmap:invc:${o}`, JSON.stringify({ code: c, exp }), 'EX', 7 * 86400]);
    } else if (body.op === 'invoff') {
      const old = J(await redis(['GET', `realmap:invc:${o}`])); if (old && old.code) await redis(['DEL', `realmap:inv:${old.code}`]); await redis(['DEL', `realmap:invc:${o}`]);
    } else if (body.op === 'perm') {
      const p = { agtDel: body.agtDel !== false, agtPub: body.agtPub !== false, astDel: body.astDel === true };
      await redis(['SET', `realmap:sperm:${o}`, JSON.stringify(p)]);
    } else {
      if (!m) return fail(res, 404, 'none', '직원을 찾지 못했습니다.');
      if (body.op === 'ok' || body.op === 'role') {
        const role = body.op === 'role' ? (body.role === 'agt' ? 'agt' : 'ast') : m.role;
        const after = [...on.filter(x => x.uid !== uid), { ...m, st: 'on', role }];
        if (body.op === 'ok' && m.st !== 'on' && on.length + 1 > seats) return fail(res, 400, 'seats', seats ? `지금은 직원 자리가 ${seats}명이라 더 승인할 수 없습니다. [설정 → 요금제]에서 직원 자리를 추가해 주세요 (1명당 월 ${SEAT.toLocaleString()}원).` : P.plan === 'free' || P.plan === 'none' ? '무료 이용에서는 직원을 둘 수 없습니다. Basic 이상 요금제에서 직원 자리를 추가해 주세요.' : `직원 자리가 아직 없습니다. [설정 → 요금제]에서 직원 자리를 추가해 주세요 (1명당 월 ${SEAT.toLocaleString()}원).`);
        if (after.filter(x => x.role === 'ast').length > astMax(after)) return fail(res, 400, 'ratio', `중개보조원은 대표와 소속공인중개사를 합한 수의 5배(지금 ${astMax(after)}명)까지 둘 수 있습니다 (공인중개사법 제15조).`);
        if (body.op === 'ok') { m.st = 'on'; m.okAt = new Date().toISOString(); }
        m.role = role;
        await redis(['HSET', K, uid, JSON.stringify(m)]); await redis(['SET', `realmap:staffof:${uid}`, JSON.stringify({ o, st: m.st })]);
      } else if (body.op === 'no' || body.op === 'out') {
        // 소속공인중개사를 내보내면 보조원 한도가 줄어듦 → 넘으면 막지 않고 경고(화면)
        await redis(['HDEL', K, uid]); await redis(['DEL', `realmap:staffof:${uid}`]);
      } else return fail(res, 400, 'op', '알 수 없는 요청입니다.');
    }
  }
  const L = await members(redis, o), on = L.filter(x => x.st === 'on');
  if (L.length) { const sn = (await redis(['MGET', ...L.map(m => `realmap:sseen:${m.uid}`)]).catch(() => [])) || []; L.forEach((m, i) => { m.seen = sn[i] || ''; }); }
  const inv = J(await redis(['GET', `realmap:invc:${o}`]));
  return send(res, 200, { ok: true, list: L, perm: await permOf(redis, o), inv: inv && inv.exp > new Date().toISOString() ? inv : null, seats: seatsOf(P), used: on.length, astMax: astMax(L), astN: on.filter(x => x.role === 'ast').length, plan: P.plan, seat: SEAT });
}
async function mineOf(redis, me, loadBk) {
  const f = J(await redis(['GET', `realmap:staffof:${me}`]).catch(() => null)); if (!f || !f.o) return null;
  const m = J(await redis(['HGET', `realmap:staff:${f.o}`, String(me)]).catch(() => null)); if (!m) return null;
  const bk = await loadBk(f.o);
  return { st: m.st, role: m.role, name: m.name, office: (bk && bk.office) || '', ceo: (bk && bk.ceo) || '' };
}
