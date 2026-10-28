// 단지 장부 — 호실 장부 (중개사 본인만, 암호화 저장)
// 매물이 아니라 '호실'을 기본 단위로 기록합니다: 상태(내 매물/타부동산 × 매매·전세·월세, 보류), 가격, 거주, 만기, 입주, 옵션, 연락처, 메모,
// 그리고 지워지지 않는 히스토리(상태가 바뀔 때마다 날짜·시간과 함께 자동으로 쌓임).
//
// 저장: realmap:hj:<회원id>:<단지id>  (해시)  필드 = '<PNU>|<동>|<호>'  값 = 'v1:' + AES-256-GCM 암호문
//       realmap:hjs:<회원id>               (집합)  장부가 있는 단지 id 목록 — 해지·탈퇴 때 빠짐없이 지우기 위해
// 암호화 키: 환경변수 LEDGER_KEY (32자 이상 아무 문자열). 키가 없으면 장부를 저장하지 않습니다 (평문 저장 금지).
//   ※ 키를 바꾸거나 잃어버리면 이미 저장된 장부를 읽을 수 없습니다.
//
//   GET  /api/auth?action=hj&id=<단지id>            → { units: { key: 장부(히스토리는 최근 3건) } }
//   GET  /api/auth?action=hj&id=<단지id>&key=<key>  → { rec: 장부 전체 }
//   POST /api/auth?action=hj { id, key, op, ... }
//        op: save {rec} · deal {deal} · early {date} · renew {how, amount} · call {label} · memo {text} · mdel {i} · undo · wipe(호 장부 통째로 지움)
import crypto from 'node:crypto';

const LKEY = (process.env.LEDGER_KEY || '').trim();
const KEY = LKEY.length >= 32 ? crypto.createHash('sha256').update('realmap-ledger|' + LKEY).digest() : null;
export const ledgerReady = () => !!KEY;

export function seal(obj) {
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const ct = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final()]);
  return 'v1:' + Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64');
}
export function unseal(s) {
  const b = Buffer.from(String(s).slice(3), 'base64');
  const d = crypto.createDecipheriv('aes-256-gcm', KEY, b.subarray(0, 12));
  d.setAuthTag(b.subarray(12, 28));
  return JSON.parse(Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8'));
}

// 동·호 이름 맞추기 (화면 danji.js와 같은 규칙)
export const normD = s => String(s || '').replace(/\s/g, '').replace(/^제/, '').replace(/동$/, '').toUpperCase();
const digits = s => String(s || '').replace(/\D/g, '');
export const normH = s => digits(s) || String(s || '').replace(/\s|호$/g, '');
const okKey = k => /^(\d{19}|\*)\|[^|<>]{1,16}\|[^|<>]{1,12}$/.test(k);

const KS = ['sale', 'jeonse', 'wolse'];
const KN = { sale: '매매', jeonse: '전세', wolse: '월세' };
const LV = { owner: '입주', tenant: '임차', empty: '공실' };
const str = (v, n) => String(v ?? '').replace(/[<>]/g, '').trim().slice(0, n);
const man = v => { const n = Math.round(Number(v)); return Number.isFinite(n) && n > 0 && n < 1e8 ? n : 0; };   // 만원
const day = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : '';
const won = m => !m ? '' : m >= 10000 ? `${String(Math.floor(m / 10000))}억${m % 10000 ? ' ' + (m % 10000).toLocaleString() + '만' : ''}` : `${m.toLocaleString()}만`;
const ymd = d => d ? d.slice(2).replace(/-/g, '.') : '';
const plus2y = d => { if (!day(d)) return ''; const [y, m, dd] = d.split('-').map(Number); const t = new Date(Date.UTC(y + 2, m - 1, dd)); t.setUTCDate(t.getUTCDate() - 1); return t.toISOString().slice(0, 10); };
const add2y = d => { if (!day(d)) return ''; const [y, m, dd] = d.split('-').map(Number); return new Date(Date.UTC(y + 2, m - 1, dd)).toISOString().slice(0, 10); };

const EMPTY = () => ({ st: { src: '', k: [], hold: false, office: '' }, pr: { sale: 0, jeonse: 0, wd: 0, wr: 0 }, ar: 0, live: '', exp: '', moveIn: '', opt: '', tels: [], note: '', imp: '', impd: '', cd: 0, cr: 0, mk: '', deal: null, called: '', hist: [] });
// 꼭 챙길 것 글에서 첫 날짜를 찾음: '11/15 중도금' · '11.15까지' · '11월 15일' · '2026-11-15' · '26.11.15' → 'YYYY-MM-DD' (지난 지 60일이 넘은 월·일은 내년으로)
export function impDay(t, now = new Date(Date.now() + 9 * 3600e3)) {
  const s = String(t || '');
  let m = s.match(/(20\d{2})[-./](\d{1,2})[-./](\d{1,2})/) || s.match(/(?:^|\D)(\d{2})\.(\d{1,2})\.(\d{1,2})(?:\D|$)/);
  let y, mo, d;
  if (m) { y = +m[1] < 100 ? 2000 + +m[1] : +m[1]; mo = +m[2]; d = +m[3]; }
  else {
    m = s.match(/(?:^|[^\d.])(\d{1,2})\s*(?:\/|\.|월\s*)(\d{1,2})(?:\s*일)?(?![\d.])/); if (!m) return '';
    mo = +m[1]; d = +m[2]; y = now.getUTCFullYear();
    if (Date.UTC(y, mo - 1, d) < now.getTime() - 60 * 86400e3) y++;
  }
  if (!(mo >= 1 && mo <= 12 && d >= 1 && d <= 31)) return '';
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
// 화면에서 온 장부 값 정리 (히스토리·계약 정보는 화면이 직접 고칠 수 없음)
function clean(b) {
  b = b || {};
  const st = b.st || {}, pr = b.pr || {};
  const src = ['mine', 'other'].includes(st.src) ? st.src : '';
  return {
    st: { src, k: src ? KS.filter(k => (st.k || []).includes(k)) : [], hold: !!src && !!st.hold, office: src === 'other' ? str(st.office, 30) : '' },
    pr: { sale: man(pr.sale), jeonse: man(pr.jeonse), wd: man(pr.wd), wr: man(pr.wr) },
    ar: (n => Number.isFinite(n) && n > 5 && n < 1000 ? Math.round(n * 100) / 100 : 0)(Number(b.ar)),   // 직접 적은 전용면적(㎡) — 건축물대장 면적이 없을 때
    live: LV[b.live] ? b.live : '',
    exp: day(b.exp), moveIn: str(b.moveIn, 30), opt: str(b.opt, 200),
    tels: (Array.isArray(b.tels) ? b.tels : []).slice(0, 4).map(t => ({ l: str(t && t.l, 10), n: str(t && t.n, 20).replace(/[^\d\-+ ]/g, '') })).filter(t => t.n || (t.l && !/^(소유자|소유주|세입자|임차인|연락처|집주인)$/.test(t.l))),   // 10/28 번호 없이 이름만 있어도 남김
    note: str(b.note, 300),
    imp: str(b.imp, 100), impd: impDay(b.imp),   // 꼭 챙길 것 (10/26) — 날짜가 있으면 알림
    cd: man(b.cd), cr: man(b.cr),                // 현상태: 지금 사는 사람의 보증금·차임(만원) (10/26)
    mk: ['y', 'r'].includes(b.mk) ? b.mk : '',  // 줄 표시: 노랑·빨강 (10/26)
  };
}
const FIELDS = ['st', 'pr', 'ar', 'live', 'exp', 'moveIn', 'opt', 'tels', 'note', 'imp', 'impd', 'cd', 'cr', 'mk', 'deal'];
const snap = r => JSON.parse(JSON.stringify(Object.fromEntries(FIELDS.map(k => [k, r[k]]))));
export const stTxt = st => !st.src ? '상태 없음' : `${st.src === 'mine' ? '내 매물' : '타부동산' + (st.office ? `(${st.office})` : '')}${st.k.length ? ' ' + st.k.map(k => KN[k]).join('·') : ''}${st.hold ? ' · 보류' : ''}`;
const prTxt = (k, pr) => k === 'sale' ? `매매 ${won(pr.sale)}` : k === 'jeonse' ? `전세 ${won(pr.jeonse)}` : `월세 ${won(pr.wd)}/${pr.wr || 0}`;
// 바뀐 내용 → 히스토리 한 줄
function diff(a, b) {
  const out = [];
  if (stTxt(a.st) !== stTxt(b.st)) out.push(!a.st.src && b.st.src ? `매물장에 올림 · ${stTxt(b.st)}` : a.st.src && !b.st.src ? '매물장에서 내림 (관리장부에만)' : stTxt(b.st));   // 10/28 관리장부 ↔ 매물장
  for (const k of b.st.k) {
    const ch = k === 'wolse' ? (a.pr.wd !== b.pr.wd || a.pr.wr !== b.pr.wr) : a.pr[k] !== b.pr[k];
    const has = k === 'wolse' ? b.pr.wd || b.pr.wr : b.pr[k];
    if (has && (ch || !a.st.k.includes(k))) out.push(prTxt(k, b.pr));
  }
  if ((a.ar || 0) !== (b.ar || 0)) out.push(b.ar ? `전용 ${b.ar}㎡` : '면적 지움');
  if (a.live !== b.live) out.push(b.live ? LV[b.live] : '거주 정보 지움');
  if (a.exp !== b.exp) out.push(b.exp ? `만기 ${ymd(b.exp)}` : '만기 지움');
  if (a.moveIn !== b.moveIn) out.push(b.moveIn ? `입주 ${day(b.moveIn) ? ymd(b.moveIn) : b.moveIn}` : '입주 지움');
  if (a.opt !== b.opt) out.push('옵션 수정');
  if (JSON.stringify(a.tels) !== JSON.stringify(b.tels)) out.push('연락처 수정');      // 번호는 히스토리에 남기지 않음
  if (a.note !== b.note) out.push(b.note ? `메모: ${b.note.slice(0, 60)}` : '메모 지움');
  if ((a.imp || '') !== (b.imp || '')) out.push(b.imp ? `꼭 챙길 것: ${b.imp.slice(0, 60)}` : '꼭 챙길 것 지움');
  if ((a.cd || 0) !== (b.cd || 0) || (a.cr || 0) !== (b.cr || 0)) out.push(b.cd || b.cr ? `현 보증금 ${won(b.cd) || 0}${b.cr ? '/' + b.cr : ''}` : '현 보증금 지움');
  return out.join(' · ');
}
// 예전 호별 메모("[26.10.24 14:30] 내용" 줄들) → 히스토리 메모 기록
function legacyMemo(t, up) {
  const parts = String(t || '').trim().split(/\n(?=\[(?:\d{2}\.\d{2}\.\d{2} \d{2}:\d{2}|예전 메모)\] )/);
  return parts.map(p => {
    const m = p.match(/^\[(\d{2})\.(\d{2})\.(\d{2}) (\d{2}):(\d{2})\] ?/) || null;
    const x = p.replace(/^\[(?:\d{2}\.\d{2}\.\d{2} \d{2}:\d{2}|예전 메모)\] ?/, '').trim();
    const t2 = m ? new Date(Date.UTC(2000 + +m[1], +m[2] - 1, +m[3], +m[4] - 9, +m[5])).toISOString() : (up || new Date(0).toISOString());
    return x ? { t: t2, e: 'memo', x: x.slice(0, 500) } : null;
  }).filter(Boolean);
}

// ---------- 요청 처리 ----------
// ctx: { redis, uid, cx (단지 장부 JSON), saveCx(), send, fail, req, res }
// who (10/28): 직원이 있는 사무소면 { id, n } — 기록마다 누가 했는지(w) 남기고, 다른 사람이 먼저 고친 호는 덮어쓰지 않음
export async function ledger({ redis, uid, cx, saveCx, send, fail, req, res, body = {}, who = null }) {
  if (!KEY) return fail(res, 503, 'nokey', '단지 장부 암호화 설정(LEDGER_KEY)이 아직 안 되어 있습니다. 운영자에게 알려 주세요.');
  const id = str(req.query.id || body.id, 20).replace(/[^\w-]/g, '');
  if (!cx.items.some(x => x.id === id)) return fail(res, 404, 'nocx', '단지를 찾지 못했습니다.');
  const H = `realmap:hj:${uid}:${id}`;
  const read = v => { try { const r = unseal(v); return { ...EMPTY(), ...r }; } catch { return null; } };
  if (req.method !== 'POST') {
    const k1 = str(req.query.key, 60);
    if (k1) {
      if (!okKey(k1)) return fail(res, 400, 'bad_key', '호 위치가 올바르지 않습니다.');
      const v = await redis(['HGET', H, k1]);
      return send(res, 200, { ok: true, rec: v ? read(v) : null });
    }
    const raw = (await redis(['HGETALL', H])) || [];
    const arr = Array.isArray(raw) ? raw : Object.entries(raw).flat();
    const units = {}; let bad = 0;
    for (let i = 0; i + 1 < arr.length; i += 2) {
      const r = read(arr[i + 1]);
      if (!r) { bad++; continue; }
      const n = r.hist.length;
      units[arr[i]] = { ...r, hist: r.hist.slice(0, 3).map(({ s, ...h }) => h), histN: n };
    }
    return send(res, 200, { ok: true, units, ...(bad ? { bad } : {}) });
  }

  const key = str(body.key, 60);
  if (!okKey(key)) return fail(res, 400, 'bad_key', '호 위치가 올바르지 않습니다.');
  const v = await redis(['HGET', H, key]);
  if (v && !read(v)) return fail(res, 500, 'decrypt', '장부를 읽지 못했습니다. 암호화 키가 바뀌었을 수 있습니다.');
  const rec = v ? read(v) : EMPTY();
  const now = new Date().toISOString();
  // 예전 호별 메모가 있으면 이 기회에 장부 히스토리로 옮기고(암호화) 원래 메모는 지움
  const mk = `${id}|${key}`;
  let movedMemo = false;
  if (cx.memos && cx.memos[mk]) {
    const old = legacyMemo(cx.memos[mk].t, cx.memos[mk].up);
    rec.hist = [...rec.hist, ...old].sort((a, b) => String(b.t).localeCompare(String(a.t)));
    delete cx.memos[mk]; movedMemo = true;
  }
  const push = (e, x, withSnap) => {
    rec.hist.forEach(h => { delete h.s; });                 // 되돌리기 정보는 가장 최근 기록에만
    rec.hist.unshift({ t: now, e, x, ...(withSnap ? { s: withSnap } : {}), ...(who ? { w: who.n, wi: who.id } : {}) });
    if (rec.hist.length > 300) rec.hist.length = 300;
  };
  const op = String(body.op || '');
  // 이 호의 장부를 통째로 지움 (고객이 삭제를 원할 때 · 테스트 데이터 정리) — 히스토리까지 모두
  if (op === 'wipe') {
    await redis(['HDEL', H, key]);
    if (movedMemo) await saveCx();
    return send(res, 200, { ok: true, rec: null, wiped: true, ...(movedMemo ? { memos: cx.memos } : {}) });
  }
  if (op === 'save') {
    if (who && 'up' in body && (rec.up || '') !== (body.up || '') && rec.by && rec.by !== who.id) return fail(res, 409, 'conflict', `${rec.byn || '다른 직원'}님이 먼저 이 호를 고쳤습니다. 새 내용을 불러왔으니 확인하고 다시 고쳐 주세요.`, { rec });
    const nx = clean(body.rec);
    const before = snap(rec);
    const x = diff(rec, nx);
    const changed = JSON.stringify(snap(rec)) !== JSON.stringify(snap({ ...rec, ...nx }));   // 줄 표시처럼 기록에 안 남는 칸만 바뀐 경우도 저장
    if (!x && !changed && !movedMemo) return send(res, 200, { ok: true, rec, same: true });
    Object.assign(rec, nx);
    if (x) push('edit', x, before);
  } else if (op === 'deal') {
    const d = body.deal || {};
    const k = KS.includes(d.k) ? d.k : '';
    if (!k) return fail(res, 400, 'bad', '계약 종류를 골라 주세요.');
    const before = snap(rec);
    const deal = { k, a: man(d.a), r: man(d.r), d: day(d.d) || now.slice(0, 10), mi: day(d.mi), by: d.by === 'other' ? 'other' : 'mine', office: str(d.office, 30), at: now };
    rec.deal = deal;
    rec.st = { src: '', k: [], hold: false, office: '' };
    if (k === 'sale') { rec.exp = ''; rec.moveIn = deal.mi ? ymd(deal.mi) : ''; }
    else { rec.live = 'tenant'; rec.exp = day(d.exp) || plus2y(deal.mi || deal.d); rec.moveIn = ''; }
    const amt = k === 'wolse' ? `${won(deal.a)}/${deal.r}` : won(deal.a);
    push('deal', `계약됨: ${KN[k]} ${amt}${deal.by === 'other' ? ` (타사${deal.office ? ' ' + deal.office : ''})` : ' (내 계약)'}${deal.mi ? ` · 입주 ${ymd(deal.mi)}` : ''}${rec.exp ? ` · 만기 ${ymd(rec.exp)}` : ''}${k === 'sale' ? ' · 소유자 바뀜' : ''}`, before);
  } else if (op === 'early') {
    const dt = day(body.date); if (!dt) return fail(res, 400, 'bad', '나가는 날짜를 넣어 주세요.');
    const before = snap(rec), was = rec.exp;
    rec.exp = dt;
    push('early', `만기 전 이사 예정${was ? ` (원래 만기 ${ymd(was)} → ${ymd(dt)})` : ` (${ymd(dt)})`}`, before);
  } else if (op === 'renew') {
    if (!rec.exp) return fail(res, 400, 'bad', '만기일이 있어야 갱신할 수 있습니다.');
    const before = snap(rec), was = rec.exp, amt = man(body.amount);
    rec.exp = add2y(was);
    if (rec.deal && amt) rec.deal = { ...rec.deal, a: amt };
    push('renew', `갱신 (${body.how === 'agree' ? '합의 갱신' : '계약갱신요구권'}) · 만기 ${ymd(was)} → ${ymd(rec.exp)}${amt ? ` · 보증금 ${won(amt)}` : ''}`, before);
  } else if (op === 'call') {
    const lb = str(body.label, 10) || '연락처';
    const h0 = rec.hist[0];
    rec.called = now;
    if (!(h0 && h0.e === 'call' && h0.x === `통화: ${lb}` && Date.now() - Date.parse(h0.t) < 5 * 60e3)) push('call', `통화: ${lb}`);
  } else if (op === 'imh') {   // 10/28 엑셀 불러오기: 메모 속 날짜별 기록을 그 날짜의 상담 기록으로 (최대 100개)
    const L = (Array.isArray(body.hist) ? body.hist : []).slice(0, 100).map(h => ({ t: String(h && h.t || ''), x: str(h && h.x, 500), w: str(h && h.w, 10) }))
      .filter(h => h.x && !isNaN(Date.parse(h.t)) && h.t <= now);
    const seen = new Set(rec.hist.map(h => h.t + '|' + h.x));
    for (const h of L) if (!seen.has(h.t + '|' + h.x)) { rec.hist.push({ t: new Date(h.t).toISOString(), e: 'memo', x: h.x, ...(h.w ? { w: h.w } : {}), imp: 1 }); seen.add(h.t + '|' + h.x); }
    rec.hist.sort((a, b) => String(b.t).localeCompare(String(a.t))); if (rec.hist.length > 300) rec.hist.length = 300;
  } else if (op === 'memo') {
    const t = str(body.text, 500); if (!t) return fail(res, 400, 'bad', '기록할 내용을 적어 주세요.');
    push('memo', t);
  } else if (op === 'mdel') {
    const i = Number(body.i), h = rec.hist[i];
    if (!h || h.e !== 'memo') return fail(res, 400, 'bad', '메모 기록만 지울 수 있습니다.');
    rec.hist.splice(i, 1);
  } else if (op === 'hedit') {   // 상담 기록(메모) 고치기 — 고친 시각을 남김 (10/26)
    const i = Number(body.i), h = rec.hist[i], t = str(body.text, 500);
    if (!h || h.e !== 'memo') return fail(res, 400, 'bad', '직접 쓴 상담 기록만 고칠 수 있습니다.');
    if (!t) return fail(res, 400, 'bad', '내용을 적어 주세요. 지우려면 × 를 눌러 주세요.');
    if (t !== h.x) { h.x = t; h.ed = now; }
  } else if (op === 'undo') {
    const h = rec.hist[0];
    if (!h || Date.now() - Date.parse(h.t) > 10 * 60e3) return fail(res, 400, 'late', '10분 안의 기록만 되돌릴 수 있습니다.');
    if (h.s) Object.assign(rec, h.s);
    rec.hist.shift();
  } else return fail(res, 400, 'op', '알 수 없는 요청입니다.');

  rec.up = now;
  if (who) { rec.by = who.id; rec.byn = who.n; }
  const empty = !rec.hist.length && !rec.st.src && !rec.ar && !rec.live && !rec.exp && !rec.tels.length && !rec.note && !rec.opt && !rec.moveIn;
  if (empty) await redis(['HDEL', H, key]);
  else { await redis(['HSET', H, key, seal(rec)]); await redis(['SADD', `realmap:hjs:${uid}`, id]); }
  if (movedMemo) await saveCx();
  return send(res, 200, { ok: true, rec, ...(movedMemo ? { memos: cx.memos } : {}) });
}

// 단지 하나의 장부 지우기 / 회원의 장부 모두 지우기 (해지·탈퇴)
export async function dropLedger(redis, uid, id) { await redis(['DEL', `realmap:hj:${uid}:${id}`]); await redis(['SREM', `realmap:hjs:${uid}`, id]); }
export async function dropLedgers(redis, uid) {
  try {
    const ids = (await redis(['SMEMBERS', `realmap:hjs:${uid}`])) || [];
    for (const id of ids) await redis(['DEL', `realmap:hj:${uid}:${id}`]);
    await redis(['DEL', `realmap:hjs:${uid}`]);
  } catch { /* 무시 */ }
}
