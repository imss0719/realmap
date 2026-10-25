// 고객관리 — 매수·임차 고객 조건 (중개사 본인만, 암호화 저장 · 단지 장부와 같은 LEDGER_KEY)
// 저장: realmap:cu:<회원id> (해시) 필드 = 고객 id  값 = 'v1:' + AES-256-GCM 암호문
//   GET  /api/auth?action=cu                       → { items: [고객], limit }
//   POST /api/auth?action=cu { op, ... }
//        save {item}(id 없으면 새 고객) · status {id, status} · memo {id, text}(연락한 것으로 기록) · mdel {id, i} · called {id} · del {id}
import crypto from 'node:crypto';
import { seal, unseal, ledgerReady } from './_ledger.js';

const str = (v, n) => String(v ?? '').replace(/[<>]/g, '').trim().slice(0, n);
const man = v => { const n = Math.round(Number(String(v ?? '').replace(/[^\d.]/g, ''))); return Number.isFinite(n) && n > 0 && n < 1e8 ? n : null; };   // 만원
const py = v => { const n = Number(String(v ?? '').replace(/[^\d.]/g, '')); return Number.isFinite(n) && n > 0 && n < 100000 ? Math.round(n * 10) / 10 : null; };
const KS = ['sale', 'jeonse', 'wolse'];
const PT = ['아파트', '빌라', '오피스텔', '주택', '상가', '사무실', '건물', '공장·창고', '토지'];
const ST = ['on', 'hold', 'done'];
const memoNow = () => { const d = new Date(Date.now() + 9 * 3600e3), p = n => String(n).padStart(2, '0'); return `${String(d.getUTCFullYear()).slice(2)}.${p(d.getUTCMonth() + 1)}.${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`; };

function clean(b, prev) {
  b = b || {};
  const phone = str(b.phone, 20).replace(/[^\d-]/g, '');
  return {
    id: prev ? prev.id : '', name: str(b.name, 20), phone,
    k: (Array.isArray(b.k) ? b.k : []).filter(k => KS.includes(k)),
    pt: (Array.isArray(b.pt) ? b.pt : []).filter(t => PT.includes(t)),
    bmax: man(b.bmax), dmax: man(b.dmax), rmax: man(b.rmax),        // 매매·전세 예산 · 월세 보증금 · 월세 (만원, 이하)
    amin: py(b.amin), amax: py(b.amax),                              // 평
    where: (Array.isArray(b.where) ? b.where : String(b.where || '').split(/[,·/]/)).map(w => str(w, 20)).filter(Boolean).slice(0, 8),
    movein: str(b.movein, 20), note: str(b.note, 60),
    status: ST.includes(b.status) ? b.status : (prev ? prev.status : 'on'),
    memo: prev ? prev.memo || '' : str(b.memo, 5000),
    last: prev ? prev.last || '' : '', at: prev ? prev.at : new Date().toISOString(), up: new Date().toISOString(),
  };
}

export async function cust({ redis, uid, P, send, fail, req, res, body = {} }) {
  if (!ledgerReady()) return fail(res, 503, 'nokey', '고객관리 암호화 설정(LEDGER_KEY)이 아직 안 되어 있습니다. 운영자에게 알려 주세요.');
  const H = `realmap:cu:${uid}`;
  const all = async () => {
    const raw = (await redis(['HGETALL', H])) || [];
    const arr = Array.isArray(raw) ? raw : Object.entries(raw).flat(), out = [];
    for (let i = 0; i + 1 < arr.length; i += 2) { try { out.push(unseal(arr[i + 1])); } catch { /* 못 읽는 건 건너뜀 */ } }
    return out.sort((a, b) => String(b.at).localeCompare(String(a.at)));
  };
  const limit = P.cu >= 1e9 ? null : P.cu;
  if (req.method !== 'POST') return send(res, 200, { ok: true, items: await all(), limit });
  const id = str(body.id, 24).replace(/[^\w-]/g, '');
  const get = async () => { const v = id ? await redis(['HGET', H, id]) : null; if (!v) return null; try { return unseal(v); } catch { return null; } };
  const put = async c => { await redis(['HSET', H, c.id, seal(c)]); };
  const op = body.op;
  if (op === 'save') {
    const prev = await get();
    if (id && !prev) return fail(res, 404, 'none', '고객을 찾지 못했습니다.');
    if (!prev) {
      const n = Number(await redis(['HLEN', H])) || 0;
      if (n >= P.cu) return fail(res, 400, 'limit', P.plan === 'free' ? `무료 이용은 고객 ${P.cu}명까지입니다. Basic(월 9,900원)이면 300명까지 관리할 수 있습니다.` : `${P.name} 요금제는 고객 ${P.cu.toLocaleString()}명까지입니다.`);
    }
    const c = clean(body.item, prev);
    if (!c.name && !c.phone) return fail(res, 400, 'need', '이름이나 연락처 중 하나는 넣어 주세요.');
    if (!prev) { c.id = Date.now().toString(36) + crypto.randomBytes(3).toString('hex'); if (body.item && body.item.memo) c.memo = `[${memoNow()}] ${str(body.item.memo, 300)}`; c.last = body.item && body.item.memo ? new Date().toISOString() : ''; }
    await put(c);
    return send(res, 200, { ok: true, item: c, items: await all(), limit });
  }
  const c = await get();
  if (!c) return fail(res, 404, 'none', '고객을 찾지 못했습니다.');
  if (op === 'status') { if (!ST.includes(body.status)) return fail(res, 400, 'status', '상태가 올바르지 않습니다.'); c.status = body.status; }
  else if (op === 'memo') { const t = str(body.text, 300); if (!t) return fail(res, 400, 'memo', '메모를 입력해 주세요.'); c.memo = `[${memoNow()}] ${t}${c.memo ? '\n' + c.memo : ''}`.slice(0, 5000); c.last = new Date().toISOString(); }
  else if (op === 'mdel') { const L = String(c.memo || '').split(/\n(?=\[\d{2}\.\d{2}\.\d{2} \d{2}:\d{2}\] )/); L.splice(Number(body.i) || 0, 1); c.memo = L.join('\n'); }
  else if (op === 'called') c.last = new Date().toISOString();
  else if (op === 'del') { await redis(['HDEL', H, c.id]); return send(res, 200, { ok: true, items: await all(), limit }); }
  else return fail(res, 400, 'op', '알 수 없는 요청입니다.');
  c.up = new Date().toISOString();
  await put(c);
  return send(res, 200, { ok: true, item: c, items: await all(), limit });
}
export async function dropCust(redis, uid) { await redis(['DEL', `realmap:cu:${uid}`]); }
