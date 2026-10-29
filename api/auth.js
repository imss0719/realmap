// 회원(카카오 로그인)
//   /auth/login?r=/?pnu=...&mk=1   → 카카오 로그인 화면으로 이동 (mk=1: 리얼워커스 소식 받기 동의)
//   /auth/callback                  → 카카오가 돌려보내는 주소 (카카오 개발자센터 Redirect URI에 등록)
//   /api/auth?action=me             → 로그인 상태 { member, nickname }
//   /api/auth?action=logout         → 로그아웃
//   POST /api/auth?action=withdraw  → 회원 탈퇴 (저장된 회원 정보 삭제)
//   /api/auth?action=zfavs · zfav   → 서울 정비사업 관심 구역·추진 알림(이메일)
// 필요한 환경변수: KAKAO_REST_KEY, SESSION_SECRET (선택: KAKAO_CLIENT_SECRET, Upstash 저장소)
import crypto from 'node:crypto';
import { send, fail, VWORLD_DOMAIN, MAX_KEYS } from './_lib.js';
import { ledger, dropLedger, dropLedgers, normD, normH, impDay, ledgerPatch } from './_ledger.js';
import { cust, dropCust } from './_cust.js';
import { lsLoad, lsSave, lsMutate, lsDrop } from './_ls.js';
import { officeOf, permOf, can, teamN, members, dropTeam, leave, staffApi, seatsOf, SEAT, ROLE } from './_staff.js';
export { lsLoad, lsSave, lsMutate };

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
export async function dropPhotos(urls) { if (!urls.length) return; try { const { del } = await blobLib(); await del(urls); } catch { /* 지우기 실패는 무시 (용량만 조금 남음) */ } }
// ---------- 중개사 서비스 요금제 ----------
// 무료(계속) · 2주 무료 체험 · Basic · Premium · VIP. 저장: realmap:plan:<회원id> { plan, until, trialUsed, at }
// 시작하지 않은 회원은 매물장을 쓸 수 없고 소개 페이지(/pro.html)로 갑니다. 예전 realmap:pro 목록 회원은 Basic으로 봅니다.
export const PLANS = {
  // 10/26 요금표: 무료 0원 · Basic 9,900원 · Premium 19,900원 · VIP 29,900원 (부가세 포함) · 담당자 추가 1명당 2,900원(준비 중)
  //   VIP '무제한'은 공정 사용 한도 매물 30,000건
  free: { name: '무료', ls: 10, ad: 10, cx: 3, cu: 10, adv: false },
  trial: { name: '2주 무료 체험', ls: 1000, ad: 300, cx: 20, cu: 1000, adv: true },
  basic: { name: 'Basic', ls: 1000, ad: 300, cx: 20, cu: 1000, adv: true },
  premium: { name: 'Premium', ls: 5000, ad: 1000, cx: 50, cu: 5000, adv: true },
  vip: { name: 'VIP', ls: 30000, ad: 3000, cx: 100, cu: 1e9, adv: true },
};
const TRIAL_DAYS = 14;
export async function planOf(id) {
  const out = (plan, extra = {}) => ({ plan, ...PLANS[plan] || PLANS.free, started: true, ...extra });
  if (!id) return { plan: 'none', ...PLANS.free, started: false };
  if (ADMIN_ID && String(id) === ADMIN_ID) return out('vip', { op: true });
  let rec = null;
  try { const v = await redis(['GET', `realmap:plan:${id}`]); rec = v ? JSON.parse(v) : null; } catch { rec = null; }
  const now = new Date().toISOString();
  if (rec) {
    const live = !rec.until || rec.until > now;
    if (PLANS[rec.plan] && rec.plan !== 'free' && live) return out(rec.plan, { until: rec.until || null, trialUsed: !!rec.trialUsed, gift: rec.by === 'op', seats: Number(rec.seats) || 0 });   // gift: 운영자 혜택 (10/27)
    return out('free', { ended: rec.plan !== 'free' ? rec.plan : '', endedAt: rec.until || null, trialUsed: !!rec.trialUsed });
  }
  try { if (await redis(['SISMEMBER', 'realmap:pro', String(id)])) return out('basic', { legacy: true }); } catch { /* 없음 */ }
  return { plan: 'none', ...PLANS.free, started: false };
}
// 한도를 넘은 매물 = 등록일이 오래된 쪽 (최근 등록한 P.ls건만 수정 가능)
function readOnlyIds(items, P) {
  if (!P || !(items.length > P.ls)) return new Set();
  return new Set([...items].sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(P.ls).map(x => x.id));
}
// 체험 시작 (중개사 서비스를 해지했다가 다시 시작하면 체험 없이 무료로) — 가입 확인 통과 또는 운영자 승인 때
export async function startTrial(uid) {
  const now = Date.now();
  const used = await redis(['SISMEMBER', 'realmap:trialused', String(uid)]).catch(() => 0);
  await redis(['SET', `realmap:plan:${uid}`, JSON.stringify(used ? { plan: 'free', trialUsed: true, at: new Date(now).toISOString() } : { plan: 'trial', until: new Date(now + TRIAL_DAYS * 86400e3).toISOString(), trialUsed: true, at: new Date(now).toISOString() })]);
}
// 단지 장부 한도: 등록한 순서대로 앞의 P.cx곳만 입력 가능, 넘는 단지는 보기만 (요금제를 내렸을 때)
const cxOpen = (items, P) => new Set([...items].sort((a, b) => String(a.at).localeCompare(String(b.at))).slice(0, P.cx || 0).map(x => x.id));
const cxFull = P => P.plan === 'free' ? `무료 이용은 단지 ${P.cx}곳까지입니다. Basic(월 9,900원)이면 20곳까지 등록할 수 있습니다.` : `${P.name} 요금제는 단지 ${P.cx}곳까지입니다.${P.plan === 'vip' ? '' : ' 요금제를 올리시면 더 등록할 수 있습니다.'}`;
export const planView = P => ({ plan: P.plan, name: P.name, until: P.until || null, ls: P.ls >= 1e9 ? null : P.ls, ad: P.ad >= 1e9 ? null : P.ad, cx: P.cx || 0, cu: P.cu >= 1e9 ? null : (P.cu || 0), adv: P.adv, started: P.started, ended: P.ended || '', trialUsed: !!P.trialUsed, op: !!P.op, gift: !!P.gift, seats: seatsOf(P) });
const SPECS = ['아파트', '오피스텔', '빌라·주택', '상가·사무실', '건물', '토지', '공장·창고', '재개발·재건축', '분양권'];
// 중개사무소 정보 확인 (시작하기·정보 수정 공용)
function cleanBk(b) {
  b = b || {};
  const str = (v, n) => String(v ?? '').replace(/[<>"]/g, '').trim().slice(0, n);
  const bk = { office: str(b.office, 40), addr: str(b.addr, 80), regno: str(b.regno, 30).replace(/[^\w-]/g, ''), ceo: str(b.ceo, 20), tel: str(b.tel, 20).replace(/[^\d-]/g, ''), mobile: str(b.mobile, 20).replace(/[^\d-]/g, ''), up: new Date().toISOString() };
  if (!bk.office || !bk.addr || !bk.regno || !bk.ceo || !bk.tel || !bk.mobile) return [null, '여섯 칸을 모두 입력해 주세요.'];
  if (!/^01\d-?\d{3,4}-?\d{4}$/.test(bk.mobile)) return [null, '휴대폰 번호를 확인해 주세요. (문자 문의를 받을 번호)'];
  if (!/\d{4,}/.test(bk.regno)) return [null, '중개사무소 등록번호를 확인해 주세요. (예: 11440-2025-00123)'];
  // 10/28 중개사 소개 페이지(선택): 한 줄 소개 · 전문 분야(정해진 것 중에서) · 활동 동네
  bk.intro = str(b.intro, 120); bk.area = str(b.area, 40);
  bk.spec = (Array.isArray(b.spec) ? b.spec : []).map(v => String(v)).filter(v => SPECS.includes(v)).slice(0, 6);
  return [bk, ''];
}

// ---------- 중개사무소 자동 확인 (브이월드 '부동산중개업사무소정보조회') ----------
// 가입·정보 수정 때 등록번호로 국가 자료를 조회해 대표 공인중개사 성명·영업 상태를 대조합니다.
// 키는 지도용 VWORLD_KEY와 따로 VWORLD_BK_KEY (없거나 브이월드 점검 중이면 '확인 대기' → 운영자가 관리 페이지에서 승인)
// 등록번호 1개 = 계정 1개: realmap:regno { 등록번호 숫자: 회원id }, 다른 계정의 중복 시도는 realmap:bkdup 목록(최근 100건)
const BK_KEY = (process.env.VWORLD_BK_KEY || '').trim();
const digitsOf = v => String(v ?? '').replace(/\D/g, '');
const nmOf = v => String(v ?? '').replace(/\s/g, '');
const fmtReg = v => { const d = digitsOf(v); return d.length === 14 ? `${d.slice(0, 5)}-${d.slice(5, 9)}-${d.slice(9)}` : String(v || ''); };
async function edOffices(params) {
  if (!BK_KEY) throw new Error('nokey');
  const u = new URL('https://api.vworld.kr/ned/data/getEBOfficeInfo');
  const q = { key: BK_KEY, format: 'json', numOfRows: '100', pageNo: '1', ...params };
  if (VWORLD_DOMAIN) q.domain = VWORLD_DOMAIN;
  for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== '') u.searchParams.set(k, String(v));
  const ctrl = new AbortController(), t = setTimeout(() => ctrl.abort(), 6000);
  try {
    const r = await fetch(u, { signal: ctrl.signal });
    const j = await r.json();
    const E = j && j.EDOffices;
    if (!E) throw new Error('bad');
    if (E.field) return Array.isArray(E.field) ? E.field : [E.field];
    if (!E.resultCode || /NOT_?FOUND|NO_?DATA/i.test(E.resultCode) || String(E.totalCount) === '0') return [];
    throw new Error(String(E.resultCode)); // INVALID_KEY 등 → 확인 대기
  } finally { clearTimeout(t); }
}
async function checkOffice(bk) {
  const d = digitsOf(bk.regno), ld = d.slice(0, 5);
  if (d.length < 10) return { st: 'notfound' };
  const pick = rows => rows.find(r => digitsOf(r.jurirno) === d);
  let row = pick(await edOffices({ ldCode: ld, jurirno: fmtReg(bk.regno) }));
  if (!row) row = pick(await edOffices({ ldCode: ld, brkrNm: bk.ceo })); // 등록번호 조건이 안 먹는 경우 대비
  if (!row) return { st: 'notfound' };
  if (nmOf(row.brkrNm) !== nmOf(bk.ceo)) return { st: 'ceo', row };
  if (String(row.sttusSeCode) !== '1' && !/영업/.test(row.sttusSeCodeNm || '')) return { st: 'closed', row };
  return { st: 'ok', row };
}
// ---------- 휴대폰 문자 인증 (솔라피) ----------
// Vercel 환경변수 SOLAPI_KEY · SOLAPI_SECRET · SMS_FROM(솔라피에 등록한 발신번호)이 모두 있어야 켜집니다. 없으면 인증 없이 지금처럼 동작.
// 인증번호는 6자리 · 5분 · 5번 틀리면 다시 받기. 보내기는 1분에 한 번, 하루 5번(계정·번호 각각).
const SMS = { key: process.env.SOLAPI_KEY || '', secret: process.env.SOLAPI_SECRET || '', from: String(process.env.SMS_FROM || '').replace(/\D/g, '') };
const smsOn = () => !!(SMS.key && SMS.secret && SMS.from);
// 운영자 휴대폰으로 알림 문자 (입금 신청·새 문의) — Vercel 환경변수 ADMIN_PHONE 이 있을 때만 · 실패해도 무시
export async function opSms(text) { const to = String(process.env.ADMIN_PHONE || '').replace(/\D/g, ''); if (!smsOn() || !/^01\d{8,9}$/.test(to)) return; try { await sendSms(to, text); } catch { /* 무시 */ } }
// 요금제 가격(부가세 포함, 원) · 계좌이체 기간 — 12개월은 10개월 값
export const PRICE = { basic: 9900, premium: 19900, vip: 29900 };
export const PAY_MON = [1, 6, 12];
export const payAmt = (plan, mon) => PRICE[plan] * (mon === 12 ? 10 : mon);
export async function sendSms(to, text) {
  const date = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'), salt = crypto.randomBytes(16).toString('hex');
  const sig = crypto.createHmac('sha256', SMS.secret).update(date + salt).digest('hex');
  const r = await fetch('https://api.solapi.com/messages/v4/send-many/detail', {
    method: 'POST', headers: { Authorization: `HMAC-SHA256 apiKey=${SMS.key}, date=${date}, salt=${salt}, signature=${sig}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: [{ to, from: SMS.from, text, type: 'SMS', autoTypeDetect: false }] }),
  });
  const j = await r.json().catch(() => ({}));
  const bad = (j.failedMessageList || [])[0];
  if (!r.ok || bad || (j.groupInfo && j.groupInfo.count && j.groupInfo.count.registeredFailed)) {
    console.error('sms fail', r.status, j.errorCode || (bad && bad.statusCode), j.errorMessage || (bad && bad.statusMessage));
    throw new Error('문자를 보내지 못했습니다. 잠시 뒤 다시 시도해 주세요.');
  }
}
const hashCode = (uid, code) => crypto.createHmac('sha256', SECRET).update(`${uid}:${code}`).digest('hex');
// 중개사무소 정보 저장 때: 휴대폰이 인증된 번호인지 (예전에 인증한 같은 번호면 그대로)
async function mobileOk(uid, bk, prevBk) {
  if (!smsOn()) return true;
  const d = String(bk.mobile || '').replace(/\D/g, '');
  if (prevBk && prevBk.mobileOk === d) { bk.mobileOk = d; bk.mobileAt = prevBk.mobileAt; return true; }
  const ok = await redis(['GET', `realmap:smsok:${uid}`]).catch(() => null);
  if (ok && ok === d) { bk.mobileOk = d; bk.mobileAt = new Date().toISOString(); return true; }
  return false;
}
const SMS_NEED = '휴대폰 번호 인증을 먼저 해 주세요. (번호 옆 [인증번호 받기])';
const V_MSG = {
  notfound: '입력하신 등록번호로 개설등록된 중개사무소를 찾지 못했습니다. 중개사무소 등록증의 등록번호를 확인해 주세요.',
  ceo: '대표 공인중개사 성명이 등록 정보와 다릅니다. 대표 공인중개사 명의로 가입해 주세요.',
  dup: '이미 다른 계정으로 가입된 등록번호입니다. 본인 사무소라면 리얼맵 운영자에게 알려 주세요.',
  need: '매물장을 쓰시려면 중개사무소 정보 확인이 필요합니다. 등록증과 같게 입력해 주세요.',
};
async function regOwner(d) {
  const o = await redis(['HGET', 'realmap:regno', d]).catch(() => null);
  if (!o) return null;
  const b = await loadBk(o);
  return b && digitsOf(b.regno) === d ? String(o) : null; // 해지한 계정의 기록은 무시
}
// 확인 결과를 bk에 표시합니다 (저장은 부르는 쪽에서). st: ok · notfound · ceo · closed · dup · error
async function verifyBk(uid, bk) {
  const d = digitsOf(bk.regno), now = new Date().toISOString();
  const owner = await regOwner(d);
  if (owner && owner !== String(uid)) {
    try { await pipe([['LPUSH', 'realmap:bkdup', JSON.stringify({ uid: String(uid), owner, regno: bk.regno, office: bk.office, ceo: bk.ceo, at: now })], ['LTRIM', 'realmap:bkdup', '0', '99']]); } catch { /* 기록 실패는 무시 */ }
    return { st: 'dup', msg: V_MSG.dup };
  }
  let r;
  try { r = await checkOffice(bk); } catch (e) { return { st: 'error', msg: '', code: String((e && e.message) || e).slice(0, 60) }; }
  if (r.st !== 'ok') return { st: r.st, msg: r.st === 'closed' ? `국가 자료에 '${r.row.sttusSeCodeNm || '휴업·폐업'}' 상태로 조회됩니다. 영업 중인 중개사무소만 이용하실 수 있습니다.` : V_MSG[r.st] };
  bk.verified = now; bk.vby = 'auto'; bk.regno = r.row.jurirno || bk.regno;
  if (r.row.bsnmCmpnm) bk.office = r.row.bsnmCmpnm; // 광고에는 등록된 명칭 그대로
  delete bk.pend; delete bk.vst; delete bk.vmsg;
  await redis(['HSET', 'realmap:regno', d, String(uid)]);
  return { st: 'ok', msg: '' };
}
// 매물장 입구: 확인된 사무소만. 예전 가입자는 처음 들어올 때 자동 확인(10분에 한 번), 브이월드 점검 중이면 그대로 통과
async function bkGate(uid) {
  if (ADMIN_ID && String(uid) === ADMIN_ID) return null;
  const bk = await loadBk(uid);
  if (bk && bk.verified) return smsOn() && !bk.mobileOk ? { msg: '문자 받을 휴대폰 번호 인증이 필요합니다. 아래 휴대폰 번호 옆 [인증번호 받기]를 눌러 인증해 주세요.', bk } : null;
  if (!bk || !bk.regno) return { msg: V_MSG.need, bk: null };
  if (!(bk.vtry && Date.now() - Date.parse(bk.vtry) < 10 * 60e3)) {
    const v = await verifyBk(uid, bk);
    bk.vtry = new Date().toISOString();
    if (v.st !== 'ok') { bk.vst = v.st; bk.vmsg = v.msg; }
    await redis(['SET', `realmap:bk:${uid}`, JSON.stringify(bk)]);
  }
  if (bk.verified || bk.vst === 'error') return null;
  return { msg: bk.vmsg || V_MSG.need, bk };
}

// ---------- 리얼맵 매물 광고 (중개사 매물 → 지도 노출) ----------
// 공개 목록은 한 덩어리 해시 realmap:pub { '<회원id>:<매물id>': 공개용 요약 JSON } — 호수·소유자 연락처·메모는 절대 넣지 않습니다.
// 시범 운영: 운영자만 게시 가능. 환경변수 PUB_OPEN=1 이면 중개사 정보를 입력한 PRO 회원 모두 게시 가능.
export const PUB_KEY = 'realmap:pub';
const PUB_DAYS = 30;
const RESID = ['아파트', '빌라', '오피스텔', '주택'];
// 10/26 세부 유형 → 원래 큰 유형 (listings.js tbase 와 같은 규칙) — 광고 필수 항목·방향 맞추기는 이 값으로
const TB = { 주상복합: '아파트', 지식산업센터: '사무실', 연립: '빌라', 다가구: '주택', 숙박: '건물' }, FB = { 빌라: '빌라', 단독: '주택', 상가: '상가', 아파트: '아파트', 토지: '토지' };
const tbase = x => { const t = (x && x.ptype) || ''; if (t === '재개발' || t === '재건축') return FB[(x.ad || {}).form] || (t === '재건축' ? '아파트' : ''); return TB[t] || t; };
const canPub = id => (ADMIN_ID && String(id) === ADMIN_ID) || process.env.PUB_OPEN === '1';
async function pipe(cmds) {
  if (!cmds.length || !R_URL || !R_TOKEN) return;
  await fetch(R_URL.replace(/\/$/, '') + '/pipeline', { method: 'POST', headers: { Authorization: `Bearer ${R_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify(cmds) });
}
// 인터넷 표시·광고 명시사항 점검 → 빠진 항목 이름 목록
export function adMissing(x, bk) {
  const miss = [], a = x.ad || {};
  if (!bk || !bk.office) miss.push('중개사무소 명칭');
  if (!bk || !bk.addr) miss.push('중개사무소 소재지');
  if (!bk || !bk.regno) miss.push('중개사무소 등록번호');
  if (!bk || !bk.ceo) miss.push('대표 공인중개사 성명');
  if (!bk || !bk.tel) miss.push('중개사무소 연락처');
  if (!x.addr) miss.push('소재지');
  if (!x.area) miss.push('면적');
  if (!x.ptype) miss.push('매물 종류');
  const price = x.kind === 'sale' ? x.price : x.kind === 'jeonse' ? x.deposit : x.kind === 'wolse' ? x.rent : x.price && x.pr;
  if (!price) miss.push('가격');
  if (tbase(x) === '토지') { if (!a.use) miss.push('지목'); return miss; }
  if (!x.ptype) return miss;
  // 건축물: 국토부 고시 「중개대상물의 표시·광고 명시사항 세부기준」 제6조
  if (x.kind !== 'presale' && !a.use) miss.push('건축물 용도');
  if (!a.tfl) miss.push('총 층수');
  if (!a.fl) miss.push('해당 층');
  if (x.kind !== 'presale' && !a.appr) miss.push('사용승인일');
  if (!a.dir) miss.push('방향');
  if (!a.movein) miss.push('입주 가능일');
  if (x.kind !== 'presale' && !a.park) miss.push('주차 대수');
  if (RESID.includes(tbase(x))) {
    if (a.rooms == null || a.rooms === '') miss.push('방 수');
    if (a.baths == null || a.baths === '') miss.push('욕실 수');
    if (!x.mgmt && !a.nomgmt) miss.push('관리비');
    if (x.mgmt >= 10 && a.mgmtT === 'fix' && !(a.mgmtInc && a.mgmtInc.length)) miss.push('관리비 포함 항목');
  }
  return miss;
}
// 해당 층 → 공개용 표기 (정확한 층 또는 저·중·고층)
function floorText(a) {
  const f = String(a.fl || '').trim(); if (!f) return '';
  if (f === '전체') return '건물 전체';
  const under = /^(b|지하)/i.test(f), n = Number(f.replace(/\D/g, ''));
  if (a.flx !== 'lmh') return under ? `지하 ${n || ''}층`.replace(' 층', '층') : `${n || f}층`;
  if (under) return '지하';
  const t = Number(a.tfl) || 0;
  if (!t || !n) return '';
  return n <= t / 3 ? '저층' : n <= t * 2 / 3 ? '중층' : '고층';
}
function pubSummary(uid, x, bk) {
  const a = x.ad || {}, p0 = (x.places && x.places[0]) || {};
  return {
    k: `${uid}:${x.id}`, no: x.no || '', kind: x.kind, ptype: x.ptype, ptypeTx: x.ptypeTx || '', pbase: tbase(x), form: a.form || '',
    price: x.price || null, deposit: x.deposit || null, rent: x.rent || null, pr: x.pr || null, mgmt: x.mgmt || null, premium: x.premium || null, nomgmt: !!a.nomgmt,
    area: x.area || null, ak: p0.land ? 'land' : p0.ak || 'ex', n: (x.places || []).length || 1,
    pnu: x.pnu, lat: x.lat, lng: x.lng, addr: x.addr, road: x.road || '', bname: x.bname || '',
    dong: ['아파트', '오피스텔'].includes(tbase(x)) ? (p0.dong || '') : '',   // 호수는 공개하지 않음
    flr: floorText(a), tfl: a.tfl || null, dir: a.dir || '', dirB: RESID.includes(tbase(x)) ? '주실 기준' : '주출입구 기준', rooms: a.rooms ?? null, baths: a.baths ?? null, movein: a.movein || '', park: a.park || '', appr: a.appr || '', desc: a.desc || '',
    use: a.use || '', viol: !!a.viol, zone: a.zone || '', rside: a.road || '', lp: a.lp || null, hhld: a.hhld || null, elev: a.elev || null,
    biz: a.biz || '', wc: a.wc || '', facx: a.facx || '', mgmtT: a.mgmtT || '', mgmtInc: a.mgmtInc || [], mgmtTx: a.mgmtTx || '',
    photos: (x.photos || []).slice(0, 10).map(p => p.url),
    bk: { office: bk.office, addr: bk.addr, regno: bk.regno, ceo: bk.ceo, tel: bk.tel, mobile: bk.mobile || '', verified: !!bk.verified, photo: bk.photo || '', ...(bk.lat && bk.lng ? { lat: bk.lat, lng: bk.lng, posv: bk.posv || 1 } : {}) },   // 10/29 lat·lng = 지도의 사무소 핀 자리
    at: x.pub.at, chk: x.pub.chk, exp: x.pub.exp,
  };
}
// 매물장이 바뀔 때마다 공개 목록을 맞춥니다: 진행 중 + 게시 + 필수 항목 완비 → 올림, 아니면 내림
export async function syncPub(uid, items, bk, P) {
  const set = [], del = [], now = new Date().toISOString();
  const bkOk = (ADMIN_ID && String(uid) === ADMIN_ID) || !!(bk && bk.verified); // 확인된 중개사무소만 지도에
  // 요금제 광고 한도: 먼저 게시한 순서대로 남기고, 넘치는 것은 내림 (무료로 내려갔을 때 등)
  const cap = P ? P.ad : 1e9;
  const keep = new Set(items.filter(x => x.pub && x.pub.on && x.status === 'on' && x.pub.exp > now).sort((a, b) => String(a.pub.at).localeCompare(String(b.pub.at))).slice(0, cap).map(x => x.id));
  for (const x of items) {
    if (!x.pub) continue;
    const field = `${uid}:${x.id}`;
    if (x.pub.on && x.status === 'on' && x.pub.exp > now && !keep.has(x.id)) x.pub.on = false;
    if (x.pub.on && x.status === 'on' && canPub(uid) && bkOk && !adMissing(x, bk).length) set.push(field, JSON.stringify(pubSummary(uid, x, bk)));
    else { if (x.pub.on && x.status !== 'on') x.pub.on = false; del.push(field); }
  }
  await pipe([...(set.length ? [['HSET', PUB_KEY, ...set]] : []), ...(del.length ? [['HDEL', PUB_KEY, ...del]] : [])]);
}
// 아파트·오피스텔은 같은 동·같은 라인이면 방향이 같음 → 매물 방향 ↔ 단지관리 라인 방향을 서로 채움
//   매물에 방향이 비어 있으면: 단지관리 라인 방향 → 같은 동·라인의 다른 매물 방향 순으로 채움
//   매물 방향을 새로 넣거나 바꾸면: 그 필지가 담긴 단지관리 단지의 라인 방향에도 저장 (단지관리 표기는 '남'처럼 '향' 없이)
const AD_DIRS = ['남향', '남동향', '남서향', '동향', '서향', '북향', '북동향', '북서향'];
const lineOf = ho => { const n = Number(String(ho || '').replace(/\D/g, '')); return n ? (n >= 100 ? n % 100 : n) : 0; };
// ---------- 10/28 관리장부 ↔ 매물장: 아파트 호의 매물 상태·가격은 한 곳처럼 ----------
//   호 장부(관리장부)에서 매물을 올리거나 가격·상태를 바꾸면 → 같은 동·호의 내 매물 카드도 맞춤 (내리면 카드는 보류 + 지도 광고 내림)
//   매물 카드에서 가격·상태를 바꾸거나 거래완료·삭제하면 → 그 단지 장부의 그 호도 맞춤 (기록에 '매물 카드에서'로 남음)
const lsKeyOf = p => `${p.pnu}|${normD(p.dong)}|${normH(p.ho)}`;
// 10/28 오피스텔: 매물 카드에 동을 안 적은 경우 → 같은 필지·같은 호면 그 카드
const lsAt = (items, key) => { const [pn, , h] = key.split('|'); return items.find(x => x.status !== 'done' && x.kind !== 'presale' && (x.places || []).some(p => p.ho && (lsKeyOf(p) === key || (!normD(p.dong) && p.pnu === pn && normH(p.ho) === h)))); };
async function lsFromLedger(uid, { key, st, pr, rm = 0, bt = 0, mg = 0, mv = '' }) {
  if (st.src === 'other') return false;   // 타부동산 물건은 내 매물 카드가 아님
  let hit = false;
  const items = await lsMutate(redis, uid, ls => {
    const x = lsAt(ls, key); if (!x) return false;
    const was = JSON.stringify([x.kind, x.price, x.deposit, x.rent, x.status, x.mgmt, x.ad]);
    // 10/29 장부 매물 칸의 방·욕실·관리비·입주도 카드(리얼맵 광고)에 — 장부에 값이 있을 때만 덮어씀
    { const a = x.ad = { ...(x.ad || {}) }; if (rm) a.rooms = rm; if (bt) a.baths = bt; if (mv) a.movein = /^\d{4}-\d{2}-\d{2}$/.test(mv) ? mv.replace(/-/g, '.') : mv; if (mg) { x.mgmt = mg; a.nomgmt = false; } }
    if (!st.src) { if (x.status === 'on') x.status = 'hold'; }   // 매물장에서 내림 → 카드는 보류 (지도 광고는 syncPub이 내림)
    else {
      const k = st.k.includes(x.kind) ? x.kind : st.k[0] || x.kind;
      if (k === 'sale' && pr.sale) Object.assign(x, { kind: 'sale', price: pr.sale });
      else if (k === 'jeonse' && pr.jeonse) Object.assign(x, { kind: 'jeonse', deposit: pr.jeonse });
      else if (k === 'wolse' && (pr.wd || pr.wr)) Object.assign(x, { kind: 'wolse', deposit: pr.wd || null, rent: pr.wr || null });
      x.status = st.hold ? 'hold' : 'on';
    }
    if (JSON.stringify([x.kind, x.price, x.deposit, x.rent, x.status, x.mgmt, x.ad]) === was) return false;
    x.up = new Date().toISOString(); hit = true;
  });
  if (hit) { const bk = await loadBk(uid), P = await planOf(uid); const it2 = await lsMutate(redis, uid, ls => syncPub(uid, ls, bk, P)); await brokerStat(uid, it2); }
  return hit;
}
async function ledgerFromLs(uid, op, x) {
  if (!x || !Array.isArray(x.places) || x.kind === 'presale' || !['아파트', '오피스텔'].includes(tbase(x))) return false;
  const p = x.places.find(q => q.pnu && q.ho); if (!p) return false;
  let d = null; try { const v = await redis(['GET', `realmap:cx:${uid}`]); d = v ? JSON.parse(v) : null; } catch { d = null; }
  const c = d && Array.isArray(d.items) ? d.items.find(z => (z.places || []).some(q => q.pnu === p.pnu)) : null; if (!c) return false;
  let key = lsKeyOf(p); const gone = op === 'del' || x.status === 'done';
  if (!normD(p.dong)) {   // 10/28 오피스텔: 카드에 동이 없으면 장부에서 같은 필지·같은 호를 찾아 (하나뿐일 때)
    try { const ks = ((await redis(['HKEYS', `realmap:hj:${uid}:${c.id}`])) || []).filter(k => { const [a, , b] = k.split('|'); return a === p.pnu && b === normH(p.ho); }); if (ks.length !== 1) return false; key = ks[0]; } catch { return false; }   // 장부에 아직 없으면 매물장은 카드로 보임
  }
  return ledgerPatch(redis, uid, c.id, key, rec => {
    if (gone) { if (rec.st.src === 'mine') rec.st = { src: '', k: [], hold: false, office: '' }; return; }
    const k = x.kind === 'sale' || x.kind === 'jeonse' || x.kind === 'wolse' ? x.kind : 'sale';
    const ks = rec.st.src === 'mine' && rec.st.k.includes(k) ? rec.st.k : [k];
    rec.st = { src: 'mine', k: ks, hold: x.status === 'hold', office: '' };
    if (k === 'sale' && x.price) rec.pr.sale = x.price;
    if (k === 'jeonse' && x.deposit) rec.pr.jeonse = x.deposit;
    if (k === 'wolse') { if (x.deposit) rec.pr.wd = x.deposit; if (x.rent) rec.pr.wr = x.rent; }
  }, op === 'del' ? '매물 카드 삭제' : x.status === 'done' ? '매물 카드에서 거래완료' : '매물 카드에서');
}
async function syncLineDir(uid, rec, prev, items) {
  const p0 = rec.places[0];
  if (rec.places.length !== 1 || !['아파트', '오피스텔'].includes(tbase(rec)) || !p0.dong || !p0.ho) return false;
  const dn = normD(p0.dong), line = lineOf(p0.ho); if (!dn || !line) return false;
  const ck = `realmap:cx:${uid}`;
  let d = null; try { const v = await redis(['GET', ck]); d = v ? JSON.parse(v) : null; } catch { d = null; }
  const cxs = d && Array.isArray(d.items) ? d.items.filter(c => (c.places || []).some(p => p.pnu === p0.pnu)) : [];
  const keys = [`${p0.pnu}|${dn}|${line}`, `*|${dn}|${line}`];
  const hk = `${p0.pnu}|${dn}|h${String(p0.ho).replace(/\D/g, '') || String(p0.ho).replace(/\s|호$/g, '')}`;   // 아파트 화면에서 '이 호만' 적은 값 (10/26)
  for (const c of cxs) { const L = c.lt && (c.lt[hk] || c.lt[keys[0]] || c.lt[keys[1]]); if (L) { if (L.t && !rec.ad.ty) rec.ad.ty = L.t; if (L.py && !rec.ad.spy) rec.ad.spy = L.py; break; } }   // 타입·공급평 (10/26)
  if (!rec.ad.dir) {
    let v = '';
    for (const c of cxs) for (const k of [hk, ...keys]) if (!v && c.dir && c.dir[k]) v = c.dir[k] + '향';
    if (!v) { const o = items.find(x => x.id !== rec.id && x.pnu === rec.pnu && x.places && x.places[0] && normD(x.places[0].dong) === dn && lineOf(x.places[0].ho) === line && x.ad && x.ad.dir); if (o) v = o.ad.dir; }
    if (AD_DIRS.includes(v)) rec.ad.dir = v;
    return false;
  }
  if (prev && prev.ad && prev.ad.dir === rec.ad.dir) return false;   // 방향을 바꾸지 않은 저장은 단지관리를 건드리지 않음
  const v = rec.ad.dir.replace(/향$/, '');
  let dirty = false;
  for (const c of cxs) { c.dir = c.dir || {}; if (c.dir[keys[0]] !== v) { c.dir[keys[0]] = v; dirty = true; } }
  if (dirty) await redis(['SET', ck, JSON.stringify(d)]);
  return dirty;
}
function cleanAd(a) {
  a = a || {};
  const t = (v, n) => String(v ?? '').replace(/[<>"]/g, '').trim().slice(0, n);
  const int = v => { const x = parseInt(String(v ?? '').replace(/\D/g, ''), 10); return Number.isFinite(x) ? Math.min(x, 99999) : null; };
  const DIRS = ['남향', '남동향', '남서향', '동향', '서향', '북향', '북동향', '북서향'];
  const MGI = ['gen', 'elec', 'water', 'gas', 'heat', 'net', 'tv', 'etc'];
  const WCS = ['내부 전용', '내부 공용', '외부 공용', '외부 전용'];
  const STAGES = ['추진위', '조합설립', '사업시행', '관리처분', '이주·철거'], FORMS = ['빌라', '단독', '상가', '아파트', '토지'], MIDS = ['무이자', '이자후불', '자납'];
  const dec = v => { const x = Number(String(v ?? '').replace(/[^\d.]/g, '')); return x > 0 && x < 1e6 ? Math.round(x * 100) / 100 : null; };
  const won = v => { const x = Number(String(v ?? '').replace(/[^\d.]/g, '')); return x > 0 && x < 1e9 ? Math.round(x * 100) / 100 : null; };
  return { fl: t(a.fl, 8), tfl: int(a.tfl), ufl: int(a.ufl), flx: a.flx === 'lmh' ? 'lmh' : 'exact', dir: DIRS.includes(a.dir) ? a.dir : '', rooms: int(a.rooms), baths: int(a.baths),
    movein: t(a.movein, 20), park: t(a.park, 30), appr: t(a.appr, 10).replace(/[^\d.-]/g, ''), nomgmt: !!a.nomgmt, desc: t(a.desc, 300),
    use: t(a.use, 40), viol: !!a.viol, zone: t(a.zone, 40), road: t(a.road, 20), lp: (v => v > 0 && v < 1e9 ? v : null)(Number(String(a.lp ?? '').replace(/\D/g, ''))), hhld: int(a.hhld), elev: int(a.elev),
    biz: t(a.biz, 30), wc: WCS.includes(a.wc) ? a.wc : '', facx: t(a.facx, 80),
    mgmtT: a.mgmtT === 'fix' ? 'fix' : 'avg', mgmtInc: (Array.isArray(a.mgmtInc) ? a.mgmtInc : []).filter(k => MGI.includes(k)), mgmtTx: t(a.mgmtTx, 60),
    ty: t(a.ty, 8).replace(/\s/g, '').toUpperCase(), spy: (v => v > 3 && v < 300 ? v : null)(Math.round(Number(a.spy) || 0)),   // 아파트 타입(84B)·공급평 (10/26)
    // 재개발·재건축 (10/26): 구역명·단계·물건 형태·대지지분㎡·감정가·권리가액·조합원 분양·이주비(만원)
    rz: t(a.rz, 30), stage: STAGES.includes(a.stage) ? a.stage : '', form: FORMS.includes(a.form) ? a.form : '', jshare: dec(a.jshare), apv: won(a.apv), rgt: won(a.rgt), msh: t(a.msh, 20), mvl: won(a.mvl),
    // 분양권 (10/26): 계약금(만원)·중도금(무이자/이자후불/자납 + 비율 등)·입주예정·전매 가능일
    down: won(a.down), mid: MIDS.includes(a.mid) ? a.mid : '', midTx: t(a.midTx, 12), due: t(a.due, 12), resale: t(a.resale, 12) };
}
// 중개사 명단·통계 (관리 페이지용): realmap:brokers 집합, realmap:bstat:<id> { n, pub, up }
export async function brokerStat(uid, items) {
  const now = new Date().toISOString();
  try { await pipe([['SADD', 'realmap:brokers', String(uid)], ['SET', `realmap:bstat:${uid}`, JSON.stringify({ n: items.length, on: items.filter(x => x.status === 'on').length, pub: items.filter(x => x.pub && x.pub.on && x.status === 'on' && x.pub.exp > now).length, up: now })]]); } catch { /* 통계 실패는 무시 */ }
}
// 중개사 서비스 데이터 지우기 (중개사 해지 · 회원 탈퇴 공용) — 일반 회원 정보는 그대로
async function dropBroker(uid) {
  await dropLedgers(redis, uid); // 단지 장부(호실 장부) — 고객 연락처가 들어 있으므로 가장 먼저
  await dropCust(redis, uid);    // 고객관리
  try { const b = await loadBk(uid); if (b && b.photo) await dropPhotos([b.photo]); } catch { /* 무시 */ }
  try { const b = await loadBk(uid), d = b && digitsOf(b.regno); if (d && await redis(['HGET', 'realmap:regno', d]) === String(uid)) await redis(['HDEL', 'realmap:regno', d]); } catch { /* 무시 */ }
  try { const ls = await lsDrop(redis, uid); await dropPhotos(ls.flatMap(x => (x.photos || []).map(p => p.url)).filter(u => ownPhoto(u, uid))); } catch { /* 무시 */ }
  try { const f = ((await redis(['HKEYS', PUB_KEY])) || []).filter(k => String(k).startsWith(`${uid}:`)); if (f.length) await redis(['HDEL', PUB_KEY, ...f]); } catch { /* 무시 */ }   // 지도 광고는 공개 목록에서 이 회원 것 모두
  await pipe([['DEL', `realmap:ls:${uid}`], ['DEL', `realmap:bk:${uid}`], ['DEL', `realmap:plan:${uid}`], ['DEL', `realmap:cx:${uid}`], ['DEL', `realmap:bstat:${uid}`], ['DEL', `realmap:xdl:${uid}`], ['DEL', `realmap:xim:${uid}`], ['DEL', `realmap:pnote:${uid}`], ['DEL', `realmap:opmemo:${uid}`], ['SREM', 'realmap:brokers', String(uid)]]);
}
export async function loadBk(uid) { try { const v = await redis(['GET', `realmap:bk:${uid}`]); return v ? JSON.parse(v) : null; } catch { return null; } }

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
// 직원(10/28): 승인된 직원이면 s.id = 대표 id (대표 장부를 씀), s.me = 본인 id, s.staff/role/sname. 대표·혼자 쓰는 회원은 그대로
async function office(req) {
  const s = readSession(req); if (!s || !R_URL || !R_TOKEN) return s;
  const so = await officeOf(redis, s);
  if (so.staff) {   // 대표 요금제의 직원 자리보다 많으면 먼저 승인된 순서대로 자리만큼만 (체험 끝나 무료가 되면 직원은 쉬어감)
    const n = seatsOf(await planOf(so.id)), on = (await members(redis, so.id)).filter(m => m.st === 'on').sort((a, b) => String(a.okAt).localeCompare(String(b.okAt)));
    if (on.findIndex(m => m.uid === so.me) >= n) so.blocked = n ? `대표님 요금제의 직원 자리(${n}명)가 모자라 지금은 장부를 열 수 없습니다. 대표님께 직원 자리 추가를 부탁해 주세요.` : '대표님 사무소가 무료 이용 중이라 직원은 장부를 열 수 없습니다. 대표님께 알려 주세요.';
  }
  if (so.wait) so.blocked = '대표님의 승인을 기다리는 중입니다. 승인되면 대표님 사무소의 중개장부가 열립니다.';
  return so;
}
// 직원이 있는 사무소면 기록에 남길 이름 (혼자 쓰면 null → 예전과 똑같이 저장)
async function whoOf(s) { if (!s || !R_URL) return null; if (s.staff) return { id: s.me, n: s.sname }; if (!(await teamN(redis, s.id))) return null; const b = await loadBk(s.id); return { id: String(s.id), n: (b && b.ceo) || '대표' }; }
// 직원 참여 신청 알림은 아직 승인 대기인 사람만 (승인·거절하면 알림에서 빠짐)
async function liveNotes(ns, o) { const W = new Set((await members(redis, o)).filter(m => m.st === 'wait').map(m => m.uid)); return ns.filter(n => n.k !== 'staff' || W.has(String(n.uid))); }
const noStaff = (res, s, what) => fail(res, 403, 'staffno', `${what} 대표만 할 수 있습니다.`);
const noPerm = (res, what) => fail(res, 403, 'perm', `${what} 권한이 없습니다. 대표님께 [설정 → 직원 관리]에서 권한을 받아 주세요.`);
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
      const s = await office(req);
      const P = s ? await planOf(s.id) : null;
      let pend = null; // 가입 신청 후 확인 대기 중이면 화면에 안내
      if (s && P && !P.started) { const b = await loadBk(s.id); if (b && b.pend) pend = { office: b.office, addr: b.addr, regno: b.regno, ceo: b.ceo, tel: b.tel, mobile: b.mobile, at: b.pend }; }
      return send(res, 200, { ok: true, sms: smsOn(), ready: !!REST, member: !!s, nickname: s ? s.n : '', pro: !!(P && P.adv), plan: P ? planView(P) : null, op: !!(s && ADMIN_ID && (s.me || s.id) === ADMIN_ID), pend, ...(s && s.staff ? { staff: { role: s.role, name: s.sname, office: ((await loadBk(s.id)) || {}).office || '', blocked: s.blocked || '' } } : {}), ...(s && s.wait ? { swait: true } : {}) });
    }
    if (action === 'logout') return redirect(res, safeReturn(req.query.r), [cookie('rm_s', '', 0)]);

    // 방문 통계 (개인 식별 정보 없이 숫자만): 하루 방문자 수·페이지 조회·필지 조회
    // 새벽 미리 불러오기(GitHub Actions)가 쓸 계획: 최근 14일 필지 조회가 많은 시·군·구 상위 5곳 + 창고 사용량
    //   GET /api/auth?action=warmplan → { gus:[{ lawd, n }], keys, max }  (합계 숫자만, 개인 정보 없음)
    if (action === 'warmplan') {
      res.setHeader('Cache-Control', 'no-store');
      if (!R_URL || !R_TOKEN) return send(res, 200, { ok: true, gus: [], keys: 0, max: MAX_KEYS });
      const tot = {};
      for (let i = 0; i < 14; i++) {
        const day = new Date(Date.now() + 9 * 3600e3 - i * 864e5).toISOString().slice(0, 10).replace(/-/g, '');
        try { const r = (await redis(['HGETALL', `rm:st:${day}:gu`])) || []; const arr = Array.isArray(r) ? r : Object.entries(r).flat(); for (let k = 0; k < arr.length; k += 2) tot[arr[k]] = (tot[arr[k]] || 0) + (+arr[k + 1] || 0); } catch { /* 건너뜀 */ }
      }
      const gus = Object.entries(tot).filter(([k]) => /^\d{5}$/.test(k)).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([lawd, n]) => ({ lawd, n }));
      const keys = (await redis(['DBSIZE']).catch(() => 0)) || 0;
      return send(res, 200, { ok: true, gus, keys, max: MAX_KEYS });
    }
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
      const s = await office(req);
      if (!s) return fail(res, 401, 'login', '로그인이 필요합니다.');
      if (s.blocked) return fail(res, 403, 'seats', s.blocked);
      if (!R_URL || !R_TOKEN) return fail(res, 500, 'no_storage', '회원 저장소가 연결되지 않았습니다.');
      const P = await planOf(s.id);
      if (!P.started) return fail(res, 403, 'start', '중개사 서비스를 먼저 시작해 주세요.');
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
        const dup = d.items.find(x => x.places.some(p => p.pnu === pl.pnu));
        if (dup) return send(res, 200, { ok: true, ...d, id: dup.id });
        if (d.items.length >= P.cx) return fail(res, 400, 'full', cxFull(P), { plan: planView(P) });
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
        if (s.staff && !can(s, await permOf(redis, s.id), 'del')) return noPerm(res, '단지 삭제');
        d.items = d.items.filter(x => x.id !== id);
        for (const k of Object.keys(d.memos)) if (k.startsWith(id + '|')) delete d.memos[k];
        await dropLedger(redis, s.id, id);
      } else if (body.op === 'dir') {
        // 라인별 방향 (같은 라인은 보통 같은 방향): key = 'PNU|동|라인'
        const dk = str(body.key, 40), DIRS = ['남', '남동', '남서', '동', '서', '북', '북동', '북서'];
        if (!/^(\d{19}|\*)\|[^|]{0,16}\|(\d{1,3}|h[0-9A-Za-z]{1,8})$/.test(dk)) return fail(res, 400, 'bad_key', '라인 위치가 올바르지 않습니다.');   // 라인 또는 h호(이 호만)
        it.dir = it.dir || {};
        if (DIRS.includes(body.v)) it.dir[dk] = body.v; else delete it.dir[dk];
        if (Object.keys(it.dir).length > 800) return fail(res, 400, 'full', '방향 정보가 너무 많습니다.');
      } else if (body.op === 'lt') {
        // 라인별 타입·공급평 (10/26): key = 'PNU|동|라인' (또는 'PNU|동|h호' = 그 호만), t = '84B' 같은 타입 이름, py = 공급평(숫자). 둘 다 비우면 지움
        const lk = str(body.key, 40);
        if (!/^(\d{19}|\*)\|[^|]{0,16}\|(\d{1,3}|h[0-9A-Za-z]{1,8})$/.test(lk)) return fail(res, 400, 'bad_key', '라인 위치가 올바르지 않습니다.');   // 라인 또는 h호(이 호만)
        const t = str(body.t, 8).replace(/\s/g, '').toUpperCase(), py = Math.round(Number(body.py) || 0);
        it.lt = it.lt || {};
        if (t || (py > 3 && py < 300)) it.lt[lk] = { ...(t ? { t } : {}), ...(py > 3 && py < 300 ? { py } : {}) }; else delete it.lt[lk];
        if (Object.keys(it.lt).length > 800) return fail(res, 400, 'full', '타입 정보가 너무 많습니다.');
      } else if (body.op === 'bulk') {
        // 10/28 엑셀 불러오기: 타입·방향을 한 번에 (이미 적어 둔 라인·호는 그대로 둠)
        const KR = /^(\d{19}|\*)\|[^|]{0,16}\|(\d{1,3}|h[0-9A-Za-z]{1,8})$/, DIRS = ['남', '남동', '남서', '동', '서', '북', '북동', '북서'];
        it.dir = it.dir || {}; it.lt = it.lt || {};
        for (const [k, v] of Object.entries(body.dir || {}).slice(0, 2000)) if (KR.test(k) && DIRS.includes(v) && !it.dir[k] && Object.keys(it.dir).length < 800) it.dir[k] = v;
        for (const [k, v] of Object.entries(body.lt || {}).slice(0, 2000)) {
          const t = str(v && v.t, 8).replace(/\s/g, '').toUpperCase(), py = Math.round(Number(v && v.py) || 0);
          if (KR.test(k) && !it.lt[k] && (t || (py > 3 && py < 300)) && Object.keys(it.lt).length < 800) it.lt[k] = { ...(t ? { t } : {}), ...(py > 3 && py < 300 ? { py } : {}) };
        }
      } else if (body.op === 'memo') {
        const mk = str(body.key, 80);
        if (!mk.startsWith(id + '|')) return fail(res, 400, 'bad_key', '메모 위치가 올바르지 않습니다.');
        const t = str(body.text, 3000); // 날짜가 붙은 메모 기록이 쌓이므로 넉넉히
        if (t) d.memos[mk] = { t, up: now }; else delete d.memos[mk];
        if (Object.keys(d.memos).length > 5000) return fail(res, 400, 'full', '메모가 너무 많습니다. 필요 없는 메모를 정리해 주세요.');
      } else return fail(res, 400, 'op', '알 수 없는 요청입니다.');
      await redis(['SET', key, JSON.stringify(d)]);
      return send(res, 200, { ok: true, ...d });
    }

    // 단지 장부 — 호실 장부 (확인된 중개사무소만, 암호화 저장) → api/_ledger.js
    // 고객관리 — 매수·임차 고객 (확인된 중개사무소만, 암호화 저장) → api/_cust.js
    if (action === 'cu') {
      res.setHeader('Cache-Control', 'no-store');
      const s = await office(req);
      if (!s) return fail(res, 401, 'login', '로그인이 필요합니다.');
      if (s.blocked) return fail(res, 403, 'seats', s.blocked);
      if (!R_URL || !R_TOKEN) return fail(res, 500, 'no_storage', '회원 저장소가 연결되지 않았습니다.');
      const P = await planOf(s.id);
      if (!P.started) return fail(res, 403, 'start', '중개사 서비스를 먼저 시작해 주세요.');
      const g = await bkGate(s.id);
      if (g) return fail(res, 403, 'bk', '고객관리는 고객 연락처를 다루므로 중개사무소 확인이 끝난 회원만 쓸 수 있습니다. ' + (g.msg || ''));
      let body = {};
      if (req.method === 'POST') { try { body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {}); } catch { body = {}; } }
      if (body.op === 'del' && s.staff && !can(s, await permOf(redis, s.id), 'del')) return noPerm(res, '고객 삭제');
      return cust({ redis, uid: s.id, P, send, fail, req, res, body, who: req.method === 'POST' ? await whoOf(s) : null });
    }

    if (action === 'hj') {
      res.setHeader('Cache-Control', 'no-store');
      const s = await office(req);
      if (!s) return fail(res, 401, 'login', '로그인이 필요합니다.');
      if (s.blocked) return fail(res, 403, 'seats', s.blocked);
      if (!R_URL || !R_TOKEN) return fail(res, 500, 'no_storage', '회원 저장소가 연결되지 않았습니다.');
      const P = await planOf(s.id);
      if (!P.started) return fail(res, 403, 'start', '중개사 서비스를 먼저 시작해 주세요.');
      const g = await bkGate(s.id);
      if (g) return fail(res, 403, 'bk', '호실 장부는 고객 연락처를 다루므로 중개사무소 확인이 끝난 회원만 쓸 수 있습니다. ' + (g.msg || ''));
      const ck = `realmap:cx:${s.id}`;
      let d; try { const v = await redis(['GET', ck]); d = v ? JSON.parse(v) : null; } catch { d = null; }
      d = d || { items: [], memos: {} }; d.memos = d.memos || {};
      let body = {};
      if (req.method === 'POST') { try { body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {}); } catch { body = {}; } }
      if (req.method === 'POST') { const cid = String(req.query.id || body.id || ''); if (d.items.some(x => x.id === cid) && !cxOpen(d.items, P).has(cid)) return fail(res, 403, 'cxlock', `이 단지는 보기만 됩니다. ${cxFull(P)}`, { plan: planView(P) }); }
      if (body.op === 'wipe' && s.staff && !can(s, await permOf(redis, s.id), 'del')) return noPerm(res, '호 장부 지우기');
      return ledger({ redis, uid: s.id, cx: d, saveCx: () => redis(['SET', ck, JSON.stringify(d)]), send, fail, req, res, body, who: req.method === 'POST' ? await whoOf(s) : null, onSt: ch => lsFromLedger(s.id, ch) });
    }

    // 지도에 게시된 매물 (누구나 볼 수 있음) — 1분 캐시
    if (action === 'pubs') {
      if (!R_URL || !R_TOKEN) return send(res, 200, { ok: true, items: [] });
      const raw = (await redis(['HGETALL', PUB_KEY])) || [];
      const now = new Date().toISOString(), gone = new Date(Date.now() - 30 * 86400e3).toISOString(), items = [], old = [];
      for (let i = 0; i < raw.length; i += 2) { try { const v = JSON.parse(raw[i + 1]); if (v.exp > now) items.push(v); else if (v.exp < gone) old.push(raw[i]); } catch { old.push(raw[i]); } }
      // 게시 기간이 끝나고 30일 더 지난 매물은 공개 목록에서 지웁니다 (매물장에서 '연장'하면 다시 올라감)
      if (old.length) try { await redis(['HDEL', PUB_KEY, ...old]); } catch { /* 다음에 */ }
      return send(res, 200, { ok: true, items }, 60);
    }

    // 10/28 중개사 소개 페이지 (누구나 볼 수 있음) — GET ?action=office&r=등록번호 숫자 · 등록번호가 확인된 사무소만 · 1분 캐시
    //   광고에 이미 나가는 정보(공인중개사법 표시 항목·대표 사진)와 소개 칸, 지금 지도에 게시 중인 매물만 돌려줌
    if (action === 'office') {
      const d = digitsOf(req.query.r);
      if (d.length < 10 || !R_URL || !R_TOKEN) return fail(res, 404, 'none', '중개사무소를 찾지 못했습니다.');
      const uid = await redis(['HGET', 'realmap:regno', d]).catch(() => null);
      const bk = uid ? await loadBk(uid) : null;
      if (!bk || !bk.verified || digitsOf(bk.regno) !== d) return fail(res, 404, 'none', '중개사무소를 찾지 못했습니다.');
      const raw = (await redis(['HGETALL', PUB_KEY])) || [], now = new Date().toISOString(), items = [];
      for (let i = 0; i < raw.length; i += 2) { if (!String(raw[i]).startsWith(`${uid}:`)) continue; try { const v = JSON.parse(raw[i + 1]); if (v.exp > now) items.push(v); } catch { /* 건너뜀 */ } }
      items.sort((a, b) => String(b.at).localeCompare(String(a.at)));
      const o = { office: bk.office, addr: bk.addr, regno: bk.regno, ceo: bk.ceo, tel: bk.tel, mobile: bk.mobile || '', photo: bk.photo || '', intro: bk.intro || '', spec: bk.spec || [], area: bk.area || '' };
      return send(res, 200, { ok: true, office: o, items }, 60);
    }

    // 10/29 홍보 페이지 '이용자 추이' 그래프: 최근 26주 주간 방문자(중복 제외)를 가장 많은 주 = 1로 나눈 비율만 공개 (실제 숫자는 내보내지 않음) · 6시간 캐시
    if (action === 'growth') {
      if (!R_URL || !R_TOKEN) return send(res, 200, { ok: true, w: [] }, 3600);
      const hit = await redis(['GET', 'rm:growth']).catch(() => null);
      if (hit) { try { return send(res, 200, JSON.parse(hit), 3600); } catch { /* 다시 셈 */ } }
      const dayOf = i => new Date(Date.now() + 9 * 3600e3 - i * 864e5).toISOString().slice(0, 10).replace(/-/g, '');
      const W = 26, cmds = [];
      for (let w = 0; w < W; w++) cmds.push(['PFCOUNT', ...Array.from({ length: 7 }, (_, k) => `rm:st:${dayOf(1 + w * 7 + k)}:uv`)]);   // 어제까지 꽉 찬 7일씩
      const r = await fetch(R_URL.replace(/\/$/, '') + '/pipeline', { method: 'POST', headers: { Authorization: `Bearer ${R_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify(cmds) }).then(x => x.json()).catch(() => []);
      let vals = cmds.map((_, w) => ({ s: dayOf(7 + w * 7), n: Number(r[w] && r[w].result) || 0 })).reverse();
      while (vals.length && !vals[0].n) vals.shift();
      const mx = Math.max(1, ...vals.map(v => v.n));
      const out = { ok: true, w: vals.map(v => ({ s: v.s, v: Math.round(v.n / mx * 1000) / 1000 })) };
      out.up = vals.length >= 4 && vals[vals.length - 1].n >= vals[0].n * 1.3;   // 실제로 늘었을 때만 화면에 보임
      await redis(['SET', 'rm:growth', JSON.stringify(out), 'EX', '21600']).catch(() => {});
      return send(res, 200, out, 3600);
    }

    // 등록번호로 사무소 명칭·소재지 미리 채우기 (가입 화면) — GET ?action=bkfind&regno=
    if (action === 'bkfind') {
      res.setHeader('Cache-Control', 'no-store');
      const s = readSession(req);
      if (!s) return fail(res, 401, 'login', '로그인이 필요합니다.');
      const d = digitsOf(req.query.regno);
      if (d.length < 10) return send(res, 200, { ok: true, found: false });
      try {
        const r = (await edOffices({ ldCode: d.slice(0, 5), jurirno: fmtReg(req.query.regno) })).find(x => digitsOf(x.jurirno) === d);
        return send(res, 200, { ok: true, found: !!r, office: r ? r.bsnmCmpnm || '' : '', addr: r ? r.rdnmadr || r.mnnmadr || '' : '', st: r ? r.sttusSeCodeNm || '' : '' });
      } catch { return send(res, 200, { ok: true, found: false, down: true }); }
    }

    // 휴대폰 문자 인증: POST { op:'send', phone } → 문자 발송 · { op:'check', phone, code } → 맞으면 30분 동안 이 번호를 인증된 번호로
    // 계좌이체 요금제 신청 · 문의하기 (10/27) — 운영자는 중개사 관리(brokers.html)에서 입금 확인·답변
    //   GET → { pays:[내 신청], qnas:[내 문의] }
    //   POST { op:'pay', plan, mon, payer, rcpt:{t:'cash'|'tax', no} } · { op:'paycancel', id } · { op:'ask', cat, text, img }
    // 방문 설명 신청 (10/27) — 로그인 없이 소개 페이지에서. 운영자에게 문자, 중개사 관리 화면 [방문 신청]에 쌓임
    //   POST { office, name, phone, area, when:[], memo, agree, hp(빈칸이어야 함) }
    if (action === 'visit') {
      res.setHeader('Cache-Control', 'no-store');
      if (req.method !== 'POST') return fail(res, 405, 'method', 'POST로 보내 주세요.');
      if (!R_URL || !R_TOKEN) return fail(res, 500, 'no_storage', '저장소가 연결되지 않았습니다.');
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
      const t = (v, n) => String(v ?? '').replace(/[<>]/g, '').trim().slice(0, n);
      if (body.hp) return send(res, 200, { ok: true });   // 자동 입력 로봇
      const phone = String(body.phone || '').replace(/\D/g, '');
      if (!body.agree) return fail(res, 400, 'agree', '개인정보 수집·이용에 동의해 주세요.');
      if (t(body.name, 20).length < 1) return fail(res, 400, 'name', '성함을 적어 주세요.');
      if (!/^0\d{8,10}$/.test(phone)) return fail(res, 400, 'phone', '연락받으실 전화번호를 확인해 주세요.');
      const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'x', day = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
      const a = await redis(['INCR', `realmap:vrl:${ip}`]); if (a === 1) await redis(['EXPIRE', `realmap:vrl:${ip}`, 3600]);
      const b = await redis(['INCR', `realmap:vrld:${day}`]); if (b === 1) await redis(['EXPIRE', `realmap:vrld:${day}`, 90000]);
      if (a > 3 || b > 60) return fail(res, 429, 'many', '신청이 많아 잠시 받을 수 없습니다. 02-393-7676으로 전화 주세요.');
      const W = ['평일 오전', '평일 오후', '평일 저녁', '주말'], when = (Array.isArray(body.when) ? body.when : []).filter(x => W.includes(x));
      const rec = { id: Date.now().toString(36) + crypto.randomBytes(3).toString('hex'), at: new Date().toISOString(), office: t(body.office, 40), name: t(body.name, 20), phone: phone.replace(/^(0\d{1,2})(\d{3,4})(\d{4})$/, '$1-$2-$3'), area: t(body.area, 40), when, memo: t(body.memo, 500), st: 'new', note: '' };
      await redis(['HSET', 'realmap:visit', rec.id, JSON.stringify(rec)]);
      await opSms(`[리얼맵] 방문 설명 신청 · ${(rec.office || rec.name).slice(0, 16)} · ${rec.phone} · ${rec.area.slice(0, 12)}`);
      return send(res, 200, { ok: true });
    }

    if (action === 'help') {
      res.setHeader('Cache-Control', 'no-store');
      const s = await office(req);
      if (!s) return fail(res, 401, 'login', '로그인이 필요합니다.');
      if (s.blocked) return fail(res, 403, 'seats', s.blocked);
      if (!R_URL || !R_TOKEN) return fail(res, 500, 'no_storage', '회원 저장소가 연결되지 않았습니다.');
      const J = v => { try { return JSON.parse(v); } catch { return null; } };
      const mine = async key => { const raw = (await redis(['HGETALL', key])) || []; const arr = Array.isArray(raw) ? raw : Object.entries(raw).flat(); const out = []; for (let i = 1; i < arr.length; i += 2) { const v = J(arr[i]); if (v && v.uid === s.id) out.push(v); } return out.sort((a, b) => String(b.at).localeCompare(String(a.at))); };
      if (req.method !== 'POST') { const [pays, qnas, pn] = await Promise.all([mine('realmap:pays'), mine('realmap:qna'), redis(['LRANGE', `realmap:pnote:${s.id}`, '0', '9']).catch(() => [])]); return send(res, 200, { ok: true, pays: s.staff ? [] : pays.slice(0, 30), qnas: qnas.slice(0, 50), notes: s.staff ? [] : await liveNotes((pn || []).map(J).filter(Boolean), s.id) }); }   // 직원: 결제·운영자 알림은 대표에게만
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
      const t = (v, n) => String(v ?? '').replace(/[<>]/g, '').trim().slice(0, n);
      const bk = await loadBk(s.id), who = (bk && bk.office) || s.n || '회원';
      const nid = () => Date.now().toString(36) + crypto.randomBytes(3).toString('hex');
      if (['pay', 'paycancel', 'seat'].includes(body.op) && s.staff) return noStaff(res, s, '요금 결제는');
      if (body.op === 'seat') {
        // 직원 자리 추가 (쓰는 중인 유료 요금제의 남은 기간만큼): n명 × 2,900원 × 남은 개월(30일 단위 올림)
        const P = await planOf(s.id), n = Math.round(Number(body.n) || 0);
        if (!PRICE[P.plan] || !P.until) return fail(res, 400, 'plan', 'Basic 이상 유료 요금제를 쓰는 중에만 직원 자리를 따로 추가할 수 있습니다. 요금제를 신청하실 때 직원 수를 같이 골라 주세요.');
        if (n < 1 || n > 30) return fail(res, 400, 'n', '추가할 직원 수를 골라 주세요.');
        if ((await mine('realmap:pays')).filter(x => x.st === 'wait').length >= 3) return fail(res, 400, 'many', '입금 확인을 기다리는 신청이 이미 있습니다. 확인이 끝난 뒤 다시 신청해 주세요.');
        const mon = Math.max(1, Math.ceil((Date.parse(P.until) - Date.now()) / (30 * 864e5)));
        const rc = body.rcpt && ['cash', 'tax'].includes(body.rcpt.t) ? { t: body.rcpt.t, no: t(body.rcpt.no, 30).replace(/[^\d-]/g, '') } : null;
        const rec = { id: nid(), uid: s.id, at: new Date().toISOString(), kind: 'seat', plan: P.plan, seats: n, mon, amt: SEAT * n * mon, payer: t(body.payer, 30) || who, office: who, rcpt: rc, st: 'wait' };
        await redis(['HSET', 'realmap:pays', rec.id, JSON.stringify(rec)]);
        await opSms(`[리얼맵] 입금 신청 · ${who.slice(0, 20)} · 직원 자리 ${n}명 × ${mon}개월 ${rec.amt.toLocaleString()}원 (입금자 ${rec.payer.slice(0, 12)})`);
        return send(res, 200, { ok: true, pay: rec });
      }
      if (body.op === 'pay') {
        const plan = String(body.plan || ''), mon = Number(body.mon), seats = Math.max(0, Math.min(30, Math.round(Number(body.seats) || 0)));
        if (!PRICE[plan] || !PAY_MON.includes(mon)) return fail(res, 400, 'bad', '요금제와 기간을 골라 주세요.');
        if ((await mine('realmap:pays')).filter(x => x.st === 'wait').length >= 3) return fail(res, 400, 'many', '입금 확인을 기다리는 신청이 이미 있습니다. 확인이 끝난 뒤 다시 신청해 주세요.');
        const rc = body.rcpt && ['cash', 'tax'].includes(body.rcpt.t) ? { t: body.rcpt.t, no: t(body.rcpt.no, 30).replace(/[^\d-]/g, '') } : null;
        if (rc && !rc.no) return fail(res, 400, 'rcpt', rc.t === 'tax' ? '세금계산서를 받을 사업자번호를 넣어 주세요.' : '현금영수증을 받을 휴대폰 번호를 넣어 주세요.');
        // 직원 자리는 요금제와 같은 기간으로 같이 냄 (12개월은 요금제처럼 10개월 값)
        const rec = { id: nid(), uid: s.id, at: new Date().toISOString(), plan, mon, seats, amt: payAmt(plan, mon) + SEAT * seats * (mon === 12 ? 10 : mon), payer: t(body.payer, 30) || who, office: who, rcpt: rc, st: 'wait' };
        await redis(['HSET', 'realmap:pays', rec.id, JSON.stringify(rec)]);
        await opSms(`[리얼맵] 입금 신청 · ${who.slice(0, 20)} · ${PLANS[plan].name} ${mon}개월${seats ? ` + 직원 ${seats}명` : ''} ${rec.amt.toLocaleString()}원 (입금자 ${rec.payer.slice(0, 12)})`);
        return send(res, 200, { ok: true, pay: rec });
      }
      if (body.op === 'paycancel') {
        const rec = J(await redis(['HGET', 'realmap:pays', t(body.id, 30)]));
        if (!rec || rec.uid !== s.id) return fail(res, 404, 'none', '신청을 찾지 못했습니다.');
        if (rec.st !== 'wait') return fail(res, 400, 'done', '이미 처리된 신청입니다.');
        rec.st = 'cancel'; rec.done = new Date().toISOString();
        await redis(['HSET', 'realmap:pays', rec.id, JSON.stringify(rec)]);
        return send(res, 200, { ok: true });
      }
      if (body.op === 'ask') {
        const text = t(body.text, 2000); if (text.length < 2) return fail(res, 400, 'text', '문의 내용을 적어 주세요.');
        const day = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10), k = `realmap:qnad:${s.id}:${day}`;
        const n = await redis(['INCR', k]); await redis(['EXPIRE', k, 90000]);
        if (n > 10) return fail(res, 429, 'many', '오늘은 문의를 더 보낼 수 없습니다. 내일 다시 보내 주세요.');
        const CATS = ['사용법', '오류', '요금·결제', '기타'], img = String(body.img || '');
        const rec = { id: nid(), uid: s.id, at: new Date().toISOString(), office: who, cat: CATS.includes(body.cat) ? body.cat : '기타', text, img: ownPhoto(img, s.id) ? img : '', reply: '', rat: '' };
        await redis(['HSET', 'realmap:qna', rec.id, JSON.stringify(rec)]);
        await opSms(`[리얼맵] 새 문의 · ${who.slice(0, 20)} · ${rec.cat}`);
        return send(res, 200, { ok: true, qna: rec });
      }
      return fail(res, 400, 'op', '알 수 없는 요청입니다.');
    }

    // 설정 화면 기록 (10/26): 엑셀 내려받기 기록(문자 인증 때 서버가 남김) · 엑셀 불러오기 기록(되돌리기용 묶음 정보)
    //   GET → { dl:[{at,what,n,ph}], im:[{id,at,file,to,n,ib?,made?,newCx?,names,undone?}] }
    //   POST { op:'im', e:{file,to,n,ib,made,newCx,names} } · { op:'imdone', id }
    if (action === 'xlog') {
      res.setHeader('Cache-Control', 'no-store');
      const s = await office(req);
      if (!s) return fail(res, 401, 'login', '로그인이 필요합니다.');
      if (s.blocked) return fail(res, 403, 'seats', s.blocked);
      if (!R_URL || !R_TOKEN) return fail(res, 500, 'no_storage', '회원 저장소가 연결되지 않았습니다.');
      const IK = `realmap:xim:${s.id}`, J = a => (a || []).map(v => { try { return JSON.parse(v); } catch { return null; } }).filter(Boolean);
      if (req.method !== 'POST') {
        const [dl, im] = await Promise.all([redis(['LRANGE', `realmap:xdl:${s.id}`, 0, 49]), redis(['LRANGE', IK, 0, 29])]);
        return send(res, 200, { ok: true, dl: J(dl), im: J(im).map(({ made, ...e }) => ({ ...e, nMade: (made || []).length })) });
      }
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
      const t = (v, n) => String(v ?? '').replace(/[<>]/g, '').slice(0, n);
      if (s.staff) return noStaff(res, s, '엑셀 불러오기는');
      if (body.op === 'im') {
        const e = body.e || {};
        const rec = { id: Date.now().toString(36) + crypto.randomBytes(2).toString('hex'), at: new Date().toISOString(), file: t(e.file, 80), to: e.to === 'hj' ? 'hj' : 'ls', n: Math.max(0, Math.round(Number(e.n) || 0)),
          ib: t(e.ib, 20), made: (Array.isArray(e.made) ? e.made : []).slice(0, 5000).map(m => [t(m && m[0], 20), t(m && m[1], 60)]), newCx: (Array.isArray(e.newCx) ? e.newCx : []).slice(0, 50).map(x => t(x, 20)), names: t(e.names, 120) };
        await pipe([['LPUSH', IK, JSON.stringify(rec)], ['LTRIM', IK, 0, 29]]);
        return send(res, 200, { ok: true, id: rec.id });
      }
      if (body.op === 'imget' || body.op === 'imdone') {   // imget: 되돌리기에 쓸 묶음 정보 · imdone: 되돌렸다고 표시
        const arr = (await redis(['LRANGE', IK, 0, 29])) || [];
        const i = arr.findIndex(v => { try { return JSON.parse(v).id === body.id; } catch { return false; } });
        if (i < 0) return fail(res, 404, 'none', '기록을 찾지 못했습니다.');
        const e = JSON.parse(arr[i]);
        if (body.op === 'imget') return send(res, 200, { ok: true, e });
        e.undone = new Date().toISOString(); delete e.made;
        await redis(['LSET', IK, i, JSON.stringify(e)]);
        return send(res, 200, { ok: true });
      }
      return fail(res, 400, 'op', '알 수 없는 요청입니다.');
    }

    if (action === 'sms') {
      res.setHeader('Cache-Control', 'no-store');
      const s = readSession(req);
      if (!s) return fail(res, 401, 'login', '로그인이 필요합니다.');
      if (!R_URL || !R_TOKEN) return fail(res, 500, 'no_storage', '회원 저장소가 연결되지 않았습니다.');
      if (!smsOn()) return fail(res, 503, 'nosms', '문자 인증이 아직 준비되지 않았습니다.');
      if (req.method !== 'POST') return fail(res, 405, 'method', '허용되지 않는 요청입니다.');
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
      const phone = String(body.phone || '').replace(/\D/g, '');
      if (!/^01\d{8,9}$/.test(phone)) return fail(res, 400, 'phone', '휴대폰 번호를 확인해 주세요.');
      const ck = `realmap:smsc:${s.id}`, day = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
      if (body.op === 'send') {
        if ((await redis(['SET', `realmap:smst:${s.id}`, '1', 'EX', 60, 'NX'])) !== 'OK') return fail(res, 429, 'wait', '인증번호는 1분에 한 번 받을 수 있습니다. 잠시 뒤 다시 눌러 주세요.');
        const [n1, n2] = await Promise.all([redis(['INCR', `realmap:smsd:${s.id}:${day}`]), redis(['INCR', `realmap:smsp:${phone}:${day}`])]);
        await pipe([['EXPIRE', `realmap:smsd:${s.id}:${day}`, 90000], ['EXPIRE', `realmap:smsp:${phone}:${day}`, 90000]]);
        if (n1 > 10 || n2 > 10) return fail(res, 429, 'many', '오늘은 인증번호를 더 받을 수 없습니다. 내일 다시 시도하시거나 리얼맵 운영자에게 알려 주세요.');
        const code = String(crypto.randomInt(100000, 1000000));
        await redis(['SET', ck, JSON.stringify({ p: phone, h: hashCode(s.id, code), n: 0, e: Date.now() + 300e3 }), 'EX', 300]);
        try { await sendSms(phone, `[리얼맵] 인증번호 ${code} (5분 안에 입력해 주세요)`); }
        catch (e) { await redis(['DEL', ck]).catch(() => 0); await redis(['DEL', `realmap:smst:${s.id}`]).catch(() => 0); return fail(res, 502, 'smsfail', e.message); }
        return send(res, 200, { ok: true, sec: 300 });
      }
      if (body.op === 'check') {
        let rec = null; try { rec = JSON.parse((await redis(['GET', ck])) || 'null'); } catch { rec = null; }
        if (!rec || rec.e < Date.now()) return fail(res, 400, 'expired', '인증번호가 만료되었습니다. 다시 받아 주세요.');
        if (rec.p !== phone) return fail(res, 400, 'other', '인증번호를 받은 번호와 다릅니다. 다시 받아 주세요.');
        if (rec.h !== hashCode(s.id, String(body.code || '').replace(/\D/g, ''))) {
          rec.n++;
          if (rec.n >= 5) { await redis(['DEL', ck]); return fail(res, 400, 'tries', '5번 틀려서 인증번호가 취소되었습니다. 다시 받아 주세요.'); }
          await redis(['SET', ck, JSON.stringify(rec), 'EX', Math.max(1, Math.ceil((rec.e - Date.now()) / 1000))]);
          return fail(res, 400, 'wrong', `인증번호가 맞지 않습니다. (${5 - rec.n}번 남음)`);
        }
        await pipe([['DEL', ck], ['SET', `realmap:smsok:${s.id}`, phone, 'EX', 1800]]);
        // 엑셀 내려받기 인증(10/26): 인증 한 번 = 내려받기 한 번 · 기록을 남김 (무엇을·몇 건·어느 번호로)
        if (body.xl && typeof body.xl === 'object' && (await officeOf(redis, s)).staff) return noStaff(res, s, '엑셀 내려받기는');
        if (body.xl && typeof body.xl === 'object') {
          const e = { at: new Date().toISOString(), what: String(body.xl.what || '').replace(/[<>]/g, '').slice(0, 60), n: Math.max(0, Math.min(1e6, Math.round(Number(body.xl.n) || 0))), ph: phone.replace(/^(\d{3})\d{3,4}(\d{4})$/, '$1-****-$2') };
          await pipe([['LPUSH', `realmap:xdl:${s.id}`, JSON.stringify(e)], ['LTRIM', `realmap:xdl:${s.id}`, 0, 99]]);
        }
        return send(res, 200, { ok: true });
      }
      return fail(res, 400, 'op', '알 수 없는 요청입니다.');
    }

    // 중개사 서비스 시작: 중개사무소 정보를 받고 2주 무료 체험을 엽니다 (체험은 한 번만)
    //   POST /api/auth?action=start { bk:{office,addr,regno,ceo,tel,mobile} }
    if (action === 'start') {
      res.setHeader('Cache-Control', 'no-store');
      const s = readSession(req);
      if (!s) return fail(res, 401, 'login', '로그인이 필요합니다.');
      if (!R_URL || !R_TOKEN) return fail(res, 500, 'no_storage', '회원 저장소가 연결되지 않았습니다.');
      if (req.method !== 'POST') return fail(res, 405, 'method', '허용되지 않는 요청입니다.');
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
      const [bk, err] = cleanBk(body.bk);
      if (!bk) return fail(res, 400, 'need', err);
      if (body.via === 'promo') bk.home = 'ads';   // 10/28 매물 홍보 페이지로 시작 → 중개장부 첫 화면은 '내 광고'
      let P = await planOf(s.id);
      if (P.started) return send(res, 200, { ok: true, plan: planView(P), bk: await loadBk(s.id) });
      if (await redis(['GET', `realmap:staffof:${s.id}`])) return fail(res, 400, 'staff', '이 카카오 계정은 다른 사무소의 직원으로 등록되어 있습니다. 내 사무소를 따로 시작하시려면 [설정 → 내 소속]에서 먼저 나가 주세요.');
      if (!(await mobileOk(s.id, bk, null))) return fail(res, 400, 'sms', SMS_NEED);
      // 국가 자료로 확인된 중개사무소만 시작. 브이월드 점검 등으로 확인이 안 되면 '확인 대기'로 받아 두고 운영자가 승인
      const v = await verifyBk(s.id, bk);
      if (v.st === 'error') {
        bk.pend = new Date().toISOString();
        await pipe([['SET', `realmap:bk:${s.id}`, JSON.stringify(bk)], ['SADD', 'realmap:brokers', String(s.id)]]);
        return send(res, 200, { ok: true, pend: true, message: '지금은 국가 자료(브이월드) 조회가 원활하지 않아 바로 확인하지 못했습니다. 운영자가 확인하는 대로 매물장이 열립니다. 잠시 뒤 다시 시도하셔도 됩니다.' });
      }
      if (v.st !== 'ok') return fail(res, 400, 'verify', v.msg);
      await redis(['SET', `realmap:bk:${s.id}`, JSON.stringify(bk)]);
      if (!P.started) { await startTrial(s.id); P = await planOf(s.id); }
      await brokerStat(s.id, (await lsLoad(redis, s.id)).items);
      return send(res, 200, { ok: true, plan: planView(P), bk });
    }
    // 운영자: 요금제 직접 지정 (계좌이체 회원 등) — POST { uid, plan, days }
    if (action === 'plan') {
      res.setHeader('Cache-Control', 'no-store');
      const s = readSession(req);
      if (!s || !ADMIN_ID || s.id !== ADMIN_ID) return fail(res, 403, 'op', '운영자만 쓸 수 있습니다.');
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
      const uid = String(body.uid || req.query.uid || '').replace(/\D/g, '');
      if (!uid) return fail(res, 400, 'uid', '회원 번호가 필요합니다.');
      if (req.method !== 'POST') return send(res, 200, { ok: true, plan: planView(await planOf(uid)) });
      if (!PLANS[body.plan]) return fail(res, 400, 'plan', '요금제 이름을 확인해 주세요. (free, trial, basic, premium, vip)');
      const days = Number(body.days) || 0;
      const prev = JSON.parse((await redis(['GET', `realmap:plan:${uid}`])) || 'null');
      await redis(['SET', `realmap:plan:${uid}`, JSON.stringify({ plan: body.plan, until: days ? new Date(Date.now() + days * 86400e3).toISOString() : null, trialUsed: true, at: new Date().toISOString(), by: 'op', prev: prev && prev.plan })]);
      await redis(['SADD', 'realmap:brokers', uid]);
      return send(res, 200, { ok: true, plan: planView(await planOf(uid)) });
    }

    // 10/29 매물번호 규칙 — GET 보기 · POST {p, f} 저장 (대표만)
    if (action === 'norule') {
      res.setHeader('Cache-Control', 'no-store');
      const s = await office(req);
      if (!s || s.blocked || !R_URL || !R_TOKEN) return fail(res, 401, 'login', '로그인이 필요합니다.');
      const k = `realmap:norule:${s.id}`;
      if (req.method !== 'POST') { const v = await redis(['GET', k]).catch(() => null); let r = {}; try { r = JSON.parse(v) || {}; } catch { /* 없음 */ } return send(res, 200, { ok: true, rule: r }); }
      if (s.staff) return noStaff(res, s, '매물번호 규칙은');
      const b = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
      const rule = { p: String(b.p || '').replace(/[^0-9A-Za-z가-힣]/g, '').slice(0, 6), f: ['ym', 'seq', 'kind'].includes(b.f) ? b.f : 'ym' };
      await redis(['SET', k, JSON.stringify(rule)]);
      return send(res, 200, { ok: true, rule });
    }

    // 10/29 사무소 좌표 저장 (중개장부 화면이 사무소 주소를 지도 좌표로 바꿔 보냄) — POST {lat,lng} · 지도의 중개사무소 핀에 씀
    if (action === 'bkpos') {
      res.setHeader('Cache-Control', 'no-store');
      const s = await office(req);
      if (!s || s.blocked || !R_URL || !R_TOKEN || req.method !== 'POST') return fail(res, 400, 'bad', '저장하지 못했습니다.');
      const b = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
      const lat = Math.round(Number(b.lat) * 1e6) / 1e6, lng = Math.round(Number(b.lng) * 1e6) / 1e6;
      if (!(lat > 33 && lat < 39 && lng > 124 && lng < 132)) return fail(res, 400, 'bad', '좌표가 올바르지 않습니다.');
      // 10/29 운영자가 지도를 보면 예전 방식 좌표(posv<3)인 사무소를 화면이 새 방식으로 다시 찾아 보냄 (regno) — 더 새 방식일 때만 바꿈
      const opReg = b.regno ? digitsOf(b.regno) : '';
      if (opReg && !(ADMIN_ID && (s.me || s.id) === ADMIN_ID)) return fail(res, 403, 'no', '운영자만 할 수 있습니다.');
      const uid = opReg ? await redis(['HGET', 'realmap:regno', opReg]).catch(() => null) : s.id;
      if (!uid) return fail(res, 404, 'none', '중개사무소를 찾지 못했습니다.');
      const bk = await loadBk(uid);
      if (!bk || !bk.addr) return fail(res, 400, 'bad', '중개사무소 정보가 없습니다.');
      const pv = Number(b.v) || 1;
      if (opReg && (bk.posv || 1) >= pv) return send(res, 200, { ok: true, same: true });   // 10/29 v2 = 주소 근처에서 사무소 이름으로 다시 찾은 좌표 (예전 좌표는 한 번 다시 찾음)
      if (bk.lat === lat && bk.lng === lng && (bk.posv || 1) >= pv) return send(res, 200, { ok: true, bk });
      bk.lat = lat; bk.lng = lng; bk.posv = pv;
      await redis(['SET', `realmap:bk:${uid}`, JSON.stringify(bk)]);
      try { const P = await planOf(uid); await lsMutate(redis, uid, ls => syncPub(uid, ls, bk, P)); } catch { /* 다음 저장 때 */ }
      return send(res, 200, { ok: true, ...(opReg ? {} : { bk }) });
    }

    // 중개사무소 정보 (매물 광고에 표시)
    if (action === 'bk') {
      res.setHeader('Cache-Control', 'no-store');
      const s = await office(req);
      if (!s) return fail(res, 401, 'login', '로그인이 필요합니다.');
      if (s.blocked) return fail(res, 403, 'seats', s.blocked);
      if (!R_URL || !R_TOKEN) return fail(res, 500, 'no_storage', '회원 저장소가 연결되지 않았습니다.');
      const P = await planOf(s.id);
      if (!P.started) return fail(res, 403, 'start', '중개사 서비스를 먼저 시작해 주세요.');
      if (req.method !== 'POST') return send(res, 200, { ok: true, bk: await loadBk(s.id), canPub: canPub(s.id) });
      if (s.staff) return noStaff(res, s, '중개사무소 정보 수정은');
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
      const [bk, err] = cleanBk(body.bk);
      if (!bk) return fail(res, 400, 'need', err);
      // 등록번호·대표자가 그대로면 확인 유지(명칭은 등록된 그대로), 바뀌면 국가 자료로 다시 확인
      const prevBk = await loadBk(s.id); let opWarn = '';
      if (prevBk && prevBk.home) bk.home = prevBk.home;
      if (prevBk && prevBk.lat && prevBk.addr === bk.addr) { bk.lat = prevBk.lat; bk.lng = prevBk.lng; if (prevBk.posv) bk.posv = prevBk.posv; }   // 10/29 사무소 좌표는 주소가 그대로일 때만 유지 (바뀌면 화면이 다시 찾아 bkpos로 보냄)   // 10/28 첫 화면(내 광고) 설정은 정보 수정 때도 유지
      if (body.bk && ['ads', 'book'].includes(body.bk.home)) bk.home = body.bk.home;
      if (!P.op && !(await mobileOk(s.id, bk, prevBk))) return fail(res, 400, 'sms', SMS_NEED);
      if (prevBk && prevBk.verified && digitsOf(prevBk.regno) === digitsOf(bk.regno) && nmOf(prevBk.ceo) === nmOf(bk.ceo)) {
        Object.assign(bk, { verified: prevBk.verified, vby: prevBk.vby || 'op', regno: prevBk.regno });
        if (prevBk.vby === 'auto') bk.office = prevBk.office;
      } else if (P.op) {   // 10/29 운영자도 등록번호를 국가 자료로 확인해 둠 (확인되면 소개 페이지·확인 배지) — 안 돼도 저장은 그대로
        try { const v = await verifyBk(s.id, bk); if (v.st !== 'ok') { delete bk.verified; opWarn = v.st === 'error' ? '국가 자료(브이월드) 조회가 원활하지 않아 등록번호를 확인하지 못했습니다. 운영 화면 [중개사 관리]에서 직접 확인 표시를 할 수 있습니다.' + (v.code ? ` (사유: ${v.code})` : '') : `등록번호 확인 안 됨: ${v.msg || v.st}`; } } catch { /* 저장은 계속 */ }
      } else {
        const v = await verifyBk(s.id, bk);
        if (v.st === 'error') return fail(res, 503, 'vworld', '지금은 국가 자료(브이월드) 조회가 원활하지 않아 등록번호·대표자 변경을 저장하지 못했습니다. 잠시 뒤 다시 시도해 주세요.');
        if (v.st !== 'ok') return fail(res, 400, 'verify', v.msg);
        if (prevBk && digitsOf(prevBk.regno) !== digitsOf(bk.regno)) { const d0 = digitsOf(prevBk.regno); if (await redis(['HGET', 'realmap:regno', d0]).catch(() => null) === String(s.id)) await redis(['HDEL', 'realmap:regno', d0]).catch(() => 0); }
      }
      // 대표 사진(선택 · 얼굴·로고 자유): 이 회원이 올린 사진만. 바꾸거나 지우면 예전 사진 파일은 정리
      const ph = String((body.bk && body.bk.photo) || '');
      bk.photo = ph && ownPhoto(ph, s.id) ? ph : '';
      await redis(['SET', `realmap:bk:${s.id}`, JSON.stringify(bk)]);
      if (prevBk && prevBk.photo && prevBk.photo !== bk.photo) await dropPhotos([prevBk.photo]);
      try { await lsMutate(redis, s.id, ls => syncPub(s.id, ls, bk, P)); } catch { /* 다음 저장 때 반영 */ }
      return send(res, 200, { ok: true, bk, canPub: canPub(s.id), ...(opWarn ? { warn: opWarn } : {}) });
    }

    // 매물장 (PRO 전용) — 회원별 최대 1,000건, 한 덩어리로 저장
    if (action === 'listings' || action === 'listing') {
      const s = await office(req);
      if (!s) return fail(res, 401, 'login', '로그인이 필요합니다.');
      if (s.blocked) return fail(res, 403, 'seats', s.blocked);
      if (!R_URL || !R_TOKEN) return fail(res, 500, 'no_storage', '회원 저장소가 연결되지 않았습니다.');
      const P = await planOf(s.id);
      if (!P.started) return fail(res, 403, 'start', '중개사 서비스를 먼저 시작해 주세요.');
      const gate = await bkGate(s.id);
      if (gate) return fail(res, 403, 'verify', gate.msg, { bk: gate.bk });
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
      const L = await lsLoad(redis, s.id);   // 10/27: 매물 1건씩 암호화 저장 (api/_ls.js)
      const save = () => lsSave(redis, s.id, items, L.prev);
      let cxDirty = false;   // 매물 방향을 단지관리 라인 방향에도 저장했는지
      let items = L.items;
      // 매물번호: 비워 두면 '등록한 해·월-순번' (예: 2610-001)으로 자동으로 붙입니다
      const ym = iso => { const d = new Date(new Date(iso || Date.now()).getTime() + 9 * 3600e3); return String(d.getUTCFullYear()).slice(2) + String(d.getUTCMonth() + 1).padStart(2, '0'); };
      // 10/29 설정 → 우리 사무소 '매물번호 규칙' (realmap:norule:<대표id> {p: 앞 글자, f: 'ym' 년월-순번 | 'seq' 순번만 | 'kind' 종류-순번}) — 새로 붙이는 번호부터
      const NR = await redis(['GET', `realmap:norule:${s.id}`]).then(v => { try { return JSON.parse(v) || {}; } catch { return {}; } }).catch(() => ({}));
      const nextNo = (list, iso, x) => { const f = ['ym', 'seq', 'kind'].includes(NR.f) ? NR.f : 'ym', body = f === 'seq' ? '' : f === 'kind' ? String((x && x.ptype) || '매물').replace(/\s/g, '').slice(0, 5) + '-' : ym(iso) + '-', p = (NR.p ? NR.p + '-' : '') + body, w = f === 'seq' ? 4 : 3;
        const max = list.reduce((m, y) => { const k = String(y.no || ''), r = k.startsWith(p) ? k.slice(p.length) : ''; return /^\d+$/.test(r) ? Math.max(m, Number(r)) : m; }, 0); return p + String(max + 1).padStart(w, '0'); };
      if (items.some(x => !x.no)) { // 예전에 등록한 매물은 등록일 순서대로 번호를 붙여 둡니다
        [...items].sort((a, b) => String(a.at).localeCompare(String(b.at))).forEach(x => { if (!x.no) x.no = nextNo(items, x.at, x); });
        await save();
      }
      // 직원이 있으면: 화면 위에 '누구로 쓰는 중인지' · 권한 · 60초마다 새 내용 확인 (team)
      const tm = s.staff ? { role: s.role, name: s.sname, perm: await permOf(redis, s.id) } : (await teamN(redis, s.id)) ? { role: 'ceo' } : null;
      if (action === 'listings' && s.staff) await redis(['SET', `realmap:sseen:${s.me}`, new Date().toISOString(), 'EX', 90 * 86400]).catch(() => 0);   // 직원 최근 접속 (대표 화면)
      if (action === 'listings') { await brokerStat(s.id, items); return send(res, 200, { ok: true, items, bk: await loadBk(s.id), canPub: canPub(s.id) && can(s, tm && tm.perm || {}, 'pub'), plan: planView(P), ...(tm ? { team: tm } : {}) }); }
      if (req.query.op === 'photodel') { // 저장하지 않고 닫은 사진 정리 (저장된 매물에 쓰인 사진은 지우지 않음)
        const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
        const used = new Set(items.flatMap(x => (x.photos || []).map(p => p.url)));
        const cb = await loadBk(s.id); if (cb && cb.photo) used.add(cb.photo); // 지금 쓰는 대표 사진은 지우지 않음
        await dropPhotos((Array.isArray(body.urls) ? body.urls : []).filter(u => ownPhoto(u, s.id) && !used.has(u)).slice(0, 50));
        return send(res, 200, { ok: true });
      }
      if (req.method !== 'POST') return fail(res, 405, 'method', '허용되지 않는 요청입니다.');
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
      if (s.staff) {   // 직원 권한: 엑셀 불러오기·되돌리기는 대표만 · 지도 광고는 소속공인중개사(대표 허용 시) · 삭제는 대표가 정한 대로
        if (['import', 'unimport'].includes(body.op)) return noStaff(res, s, '엑셀 불러오기는');
        if (['pub', 'renew', 'unpub'].includes(body.op) && !can(s, tm.perm, 'pub')) return s.role === 'ast' ? fail(res, 403, 'perm', '중개보조원은 매물 광고를 할 수 없습니다 (공인중개사법 제18조의2). 대표님이나 소속공인중개사님께 부탁해 주세요.') : noPerm(res, '지도 광고');
        if (body.op === 'del' && !can(s, tm.perm, 'del')) return noPerm(res, '매물 삭제');
      }
      const who = tm ? await whoOf(s) : null;
      const str = (v, n) => String(v ?? '').replace(/[<>]/g, '').trim().slice(0, n);
      const numv = v => { const x = Number(String(v ?? '').replace(/[^\d.]/g, '')); return Number.isFinite(x) && x > 0 ? Math.round(x * 100) / 100 : null; };
      const id = str(body.id, 20).replace(/[^\w-]/g, '');
      const now = new Date().toISOString();
      // 요금제 한도를 넘은 매물(예: 체험 때 등록한 100건)은 지우지 않고 '보기 전용': 최근 등록한 한도 건수만 수정·상태 변경·게시
      const ro = readOnlyIds(items, P);
      if (id && ro.has(id) && ['save', 'status', 'pub', 'renew'].includes(body.op)) return fail(res, 403, 'readonly', P.plan === 'free'
        ? `무료 이용은 최근 등록한 매물 ${P.ls}건만 수정할 수 있습니다. 이 매물은 보기와 엑셀 내려받기만 됩니다. Basic(월 9,900원)이면 모두 수정하실 수 있습니다.`
        : `${P.name} 요금제는 최근 등록한 매물 ${P.ls.toLocaleString()}건만 수정할 수 있습니다.`, { plan: planView(P) });
      // 매물 한 건 → 저장할 모양 (매물 카드 저장 · 엑셀 불러오기 같이 씀). imp = { ib: 묶음 번호, at: 등록일 } (엑셀 불러오기일 때만)
      const build = (it, prev, imp) => {
        const pnuOk = v => { const x = String(v || '').replace(/\D/g, ''); return /^\d{19}$/.test(x) ? x : ''; };
        // 주소 여러 개 (상가 여러 칸, 토지 여러 필지)
        const places = (Array.isArray(it.places) ? it.places : []).map(p => ({
          pnu: pnuOk(p.pnu), addr: str(p.addr, 80), lat: Number(p.lat) || null, lng: Number(p.lng) || null, bname: str(p.bname, 40),
          dong: str(p.dong, 20), ho: str(p.ho, 20), area: numv(p.area), site: numv(p.site), arch: numv(p.arch), land: !!p.land, ak: ['ex', 'tot', 'land'].includes(p.ak) ? p.ak : '',
        })).filter(p => p.pnu).slice(0, 30);
        if (!places.length) return { err: ['bad_pnu', '주소를 먼저 골라 주세요.'] };
        const contacts = (Array.isArray(it.contacts) ? it.contacts : []).map(c => ({ role: str(c.role, 10), name: str(c.name, 20), phone: str(c.phone, 20).replace(/[^\d-]/g, '') }))
          .filter(c => c.name || c.phone).slice(0, 10);
        // 임대 현황 · 층별 현황 (통건물: 층·용도·면적은 건축물대장에서 자동, 나머지는 직접) — fl·use·area·biz·exp는 10/25 추가
        const rents = (Array.isArray(it.rents) ? it.rents : []).map(r => ({ label: str(r.label, 30), deposit: numv(r.deposit), rent: numv(r.rent), memo: str(r.memo, 60),
          fl: str(r.fl, 8), use: str(r.use, 30), area: numv(r.area), biz: str(r.biz, 30), exp: str(r.exp, 10).replace(/[^\d.-]/g, '') }))
          .map(r => Object.fromEntries(Object.entries(r).filter(([k, v]) => ['label', 'deposit', 'rent', 'memo'].includes(k) || (v != null && v !== ''))))
          .filter(r => r.label || r.deposit || r.rent || r.memo || r.fl || r.biz).slice(0, 60);
        const photos = (Array.isArray(it.photos) ? it.photos : []).map(p => ({ url: String(p && p.url || '') })).filter(p => ownPhoto(p.url, s.id)).slice(0, 30);
        const kind = ['sale', 'jeonse', 'wolse', 'presale'].includes(it.kind) ? it.kind : 'sale';
        const status = ['on', 'hold', 'done'].includes(it.status) ? it.status : 'on';
        const p0 = places[0], c0 = contacts[0] || {};
        let no = str(it.no, 20);
        if (no && items.some(x => x.no === no && x.id !== (prev && prev.id))) { if (!imp) return { err: ['dup_no', `매물번호 ${no}은(는) 이미 다른 매물에 쓰고 있습니다.`] }; no = ''; }   // 엑셀 불러오기: 겹치면 새 번호
        if (!no) no = prev && prev.no ? prev.no : nextNo(items, now, it);
        const areaSum = places.reduce((a, p) => a + (p.area || 0), 0);
        const rec = {
          id: prev ? prev.id : Date.now().toString(36) + crypto.randomBytes(3).toString('hex'), no,
          // 목록·지도용 대표값 (첫 번째 주소 · 첫 번째 연락처)
          pnu: p0.pnu, addr: p0.addr, road: str(it.road, 80), bname: str(it.bname, 40) || p0.bname, lat: p0.lat, lng: p0.lng,
          dong: p0.dong, ho: p0.ho, area: areaSum ? Math.round(areaSum * 100) / 100 : null, owner: c0.name || '', phone: c0.phone || '',
          places, contacts, rents, photos,
          ptype: str(it.ptype, 10), ptypeTx: str(it.ptypeTx, 20), kind,
          price: numv(it.price), deposit: numv(it.deposit), rent: numv(it.rent), mgmt: numv(it.mgmt), premium: numv(it.premium),
          curDep: numv(it.curDep), curRent: numv(it.curRent), loan: numv(it.loan), pr: (v => { const n = numv(v); return n && /^\s*-/.test(String(v ?? '')) ? -n : n; })(it.pr), paid: numv(it.paid),
          memo: str(it.memo, 20000), status, at: prev ? prev.at : now, up: now,   // 10/26: 기록(자동 기록 포함)이 쌓이므로 memo 5000 → 20000자
          imp: str(it.imp, 100), impd: impDay(it.imp),   // 꼭 챙길 것 (10/26) — 글 속 날짜는 알림용
          mk: ['y', 'r'].includes(it.mk) ? it.mk : '',  // 줄 표시 노랑·빨강 (10/26)
          exp: /^\d{4}-\d{2}-\d{2}$/.test(String(it.exp || '')) ? String(it.exp) : '',   // 만기일 (지금 임차 계약 · 10/26) — 알림용
          ad: cleanAd(it.ad), ...(prev && prev.pub ? { pub: prev.pub } : {}),
          ...(who ? { by: who.id, byn: who.n } : prev && prev.by ? { by: prev.by, byn: prev.byn } : {}),   // 마지막으로 고친 사람 (직원이 있을 때)
          ...(imp ? { ib: imp.ib } : prev && prev.ib ? { ib: prev.ib } : {}),   // 엑셀 불러오기 묶음 번호 (10/26 · 되돌리기용)
        };
        if (imp && imp.at) rec.at = imp.at;   // 엑셀의 등록일
        return { rec, photos };
      };
      if (body.op === 'save') {
        const prev = id ? items.find(x => x.id === id) : null;
        if (!prev && items.length >= P.ls) return fail(res, 400, 'limit', P.plan === 'free'
          ? `무료 이용은 매물 ${P.ls}건까지입니다. Basic(월 9,900원)으로 올리시면 1,000건까지 등록하실 수 있습니다.`
          : `${P.name} 요금제는 매물 ${P.ls.toLocaleString()}건까지입니다. 거래완료된 매물을 정리하시거나 요금제를 올려 주세요.`, { plan: planView(P) });
        // 같이 고치기 (10/28): 내가 연 뒤에 다른 사람이 먼저 저장했으면 덮어쓰지 않고 새 내용을 돌려줌
        if (prev && who && body.item && body.item.up && prev.up && body.item.up !== prev.up && prev.by && prev.by !== who.id) return fail(res, 409, 'conflict', `${prev.byn || '다른 직원'}님이 먼저 이 매물을 고쳤습니다. 새 내용을 불러왔으니 확인하고 다시 고쳐 주세요.`, { items, item: prev });
        const r = build(body.item || {}, prev, null);
        if (r.err) return fail(res, 400, r.err[0], r.err[1]);
        const rec = r.rec, photos = r.photos;
        try { cxDirty = await syncLineDir(s.id, rec, prev, items); } catch { /* 방향 맞추기는 실패해도 저장은 그대로 */ }
        items = prev ? items.map(x => (x.id === rec.id ? rec : x)) : [rec, ...items];
        if (prev && prev.photos) { const keep = new Set(photos.map(p => p.url)); await dropPhotos(prev.photos.map(p => p.url).filter(u => !keep.has(u) && ownPhoto(u, s.id))); }
      } else if (body.op === 'import') {
        // 엑셀 불러오기 (10/26): 한 번에 최대 200건 · 한 번에 저장 · 묶음 번호(ib)로 나중에 한꺼번에 되돌리기
        const list = Array.isArray(body.items) ? body.items.slice(0, 200) : [];
        const ib = str(body.ib, 20).replace(/[^\w-]/g, '');
        if (!ib || !list.length) return fail(res, 400, 'bad', '불러올 매물이 없습니다.');
        const room = Math.max(0, P.ls - items.length);
        if (list.length > room) return fail(res, 400, 'limit', `${P.name} 요금제는 매물 ${P.ls.toLocaleString()}건까지라 ${room.toLocaleString()}건만 더 넣을 수 있습니다. 요금제를 올리시거나 나눠서 불러와 주세요.`, { plan: planView(P), room });
        const okIds = [], bad = [];
        for (let i = 0; i < list.length; i++) {
          const it = list[i] || {}, at = /^\d{4}-\d{2}-\d{2}/.test(String(it.at || '')) && String(it.at) <= now ? new Date(String(it.at).slice(0, 10) + 'T00:00:00+09:00').toISOString() : '';
          const r = build({ ...it, photos: [] }, null, { ib, at });
          if (r.err) { bad.push({ i, msg: r.err[1] }); continue; }
          r.rec.id = Date.now().toString(36) + crypto.randomBytes(3).toString('hex') + i.toString(36);
          items = [r.rec, ...items]; okIds.push(r.rec.id);
        }
        body.imported = { n: okIds.length, bad };
      } else if (body.op === 'unimport') {
        const ib = str(body.ib, 20); if (!ib) return fail(res, 400, 'bad', '되돌릴 묶음이 없습니다.');
        const gone = items.filter(x => x.ib === ib);
        for (const g of gone) if (g.pub && g.pub.on) { g.pub.on = false; try { await redis(['HDEL', PUB_KEY, `${s.id}:${g.id}`]); } catch { /* 무시 */ } }
        items = items.filter(x => x.ib !== ib);
        await dropPhotos(gone.flatMap(x => (x.photos || []).map(p => p.url)).filter(u => ownPhoto(u, s.id)));
        body.unimported = gone.length;
      } else if (body.op === 'status') {
        const st = ['on', 'hold', 'done'].includes(body.status) ? body.status : null;
        if (!st) return fail(res, 400, 'status', '상태가 올바르지 않습니다.');
        items = items.map(x => (x.id === id ? { ...x, status: st, up: now } : x));
      } else if (body.op === 'pub' || body.op === 'renew') {
        // 리얼맵 지도에 게시 / 기간 연장 (연장 = '아직 거래 가능' 확인)
        const x = items.find(i => i.id === id);
        if (!x) return fail(res, 404, 'none', '매물을 찾지 못했습니다.');
        if (!canPub(s.id)) return fail(res, 403, 'pilot', '지금은 시범 운영 중이라 게시할 수 없습니다.');
        if (x.status !== 'on') return fail(res, 400, 'status', '진행 중인 매물만 게시할 수 있습니다.');
        const miss = adMissing(x, await loadBk(s.id));
        if (miss.length) return fail(res, 400, 'missing', `광고에 꼭 들어가야 할 항목이 빠져 있습니다: ${miss.join(', ')}`, { missing: miss });
        const nowIso = new Date().toISOString();
        const live = items.filter(i => i.id !== x.id && i.pub && i.pub.on && i.status === 'on' && i.pub.exp > nowIso).length;
        if (live >= P.ad) return fail(res, 400, 'adlimit', P.plan === 'free'
          ? `무료 이용은 지도 광고 ${P.ad}건까지입니다. Basic(월 9,900원)이면 300건까지 올리실 수 있습니다.`
          : `${P.name} 요금제는 지도 광고 ${P.ad.toLocaleString()}건까지입니다.`, { plan: planView(P) });
        const exp = new Date(Date.now() + PUB_DAYS * 86400e3).toISOString();
        x.pub = { on: true, at: x.pub && x.pub.on && body.op === 'renew' ? x.pub.at : now, chk: now, exp };
      } else if (body.op === 'unpub') {
        const x = items.find(i => i.id === id);
        if (x && x.pub) x.pub.on = false;
      } else if (body.op === 'del') {
        const gone = items.find(x => x.id === id); body._gone = gone;
        if (gone && gone.pub) { gone.pub.on = false; try { await redis(['HDEL', PUB_KEY, `${s.id}:${gone.id}`]); } catch { /* 무시 */ } }
        items = items.filter(x => x.id !== id);
        if (gone && gone.photos) await dropPhotos(gone.photos.map(p => p.url).filter(u => ownPhoto(u, s.id)));
      } else return fail(res, 400, 'op', '알 수 없는 요청입니다.');
      const bk = await loadBk(s.id);
      let warn = '';
      if (body.op === 'save' || body.op === 'status') { // 게시 중인 매물이 바뀌어 필수 항목이 빠지면 지도에서 내림
        const x = items.find(i => i.id === (id || (items[0] && items[0].id)));
        if (x && x.pub && x.pub.on && x.status === 'on') { const miss = adMissing(x, bk); if (miss.length) { x.pub.on = false; warn = `필수 항목(${miss.join(', ')})이 빠져 리얼맵 지도에서 내렸습니다.`; } }
      }
      await save();
      try { await syncPub(s.id, items, bk, P); await brokerStat(s.id, items); await save(); } catch { /* 공개 목록은 다음 저장 때 맞춰짐 */ }
      // 10/28 아파트 매물 카드 → 같은 동·호의 관리장부도 맞춤
      let ledDirty = false;
      if (['save', 'status', 'del'].includes(body.op)) { try { ledDirty = await ledgerFromLs(s.id, body.op, body.op === 'del' ? body._gone : items.find(i => i.id === (id || (items[0] && items[0].id)))); } catch { /* 장부는 다음에 */ } }
      return send(res, 200, { ok: true, items, bk, ...(ledDirty ? { ledDirty: true } : {}), canPub: canPub(s.id) && can(s, tm && tm.perm || {}, 'pub'), warn, plan: planView(P), ...(tm ? { team: tm } : {}), ...(cxDirty ? { cxDirty: true } : {}), ...(body.imported ? { imported: body.imported } : {}), ...(body.unimported != null ? { unimported: body.unimported } : {}) });
    }

    // 직원 관리 · 초대 참여 (10/28) → api/_staff.js
    if (action === 'staff') {
      if (!R_URL || !R_TOKEN) return fail(res, 500, 'no_storage', '회원 저장소가 연결되지 않았습니다.');
      const note = async (o, n) => { await pipe([['LPUSH', `realmap:pnote:${o}`, JSON.stringify({ id: Date.now().toString(36), at: new Date().toISOString(), ...n })], ['LTRIM', `realmap:pnote:${o}`, '0', '9']]); };
      const smsTo = async (o, text) => { const b = await loadBk(o), to = String((b && (b.mobileOk || b.mobile)) || '').replace(/\D/g, ''); if (smsOn() && /^01\d{8,9}$/.test(to)) try { await sendSms(to, text); } catch { /* 무시 */ } };
      return staffApi({ redis, s: readSession(req), req, res, send, fail, planOf, loadBk, note, smsTo });
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

    // 중개사 서비스만 해지: 매물장·사진·지도 광고·중개사무소 정보·요금제를 지우고 일반 회원은 유지 (다시 시작하면 체험 없이 무료)
    if (action === 'quit') {
      if (req.method !== 'POST') return fail(res, 405, 'method', '허용되지 않는 요청입니다.');
      const s = readSession(req);
      if (!s) return fail(res, 401, 'login', '로그인이 필요합니다.');
      if (ADMIN_ID && s.id === ADMIN_ID) return fail(res, 400, 'op', '운영자 계정은 해지할 수 없습니다.');
      if ((await officeOf(redis, s)).staff) return fail(res, 400, 'staff', '직원은 해지 대신 [설정 → 내 소속]에서 나가기를 눌러 주세요.');
      await dropTeam(redis, s.id);   // 직원 연결도 모두 끊음 (직원 자료는 대표 장부에 있었으므로 따로 지울 것 없음)
      await dropBroker(s.id);
      await redis(['SADD', 'realmap:trialused', String(s.id)]);
      return send(res, 200, { ok: true });
    }
    // 자료 비우기 (10/28): 요금제·사무소 정보·직원은 그대로 두고 고른 자료만 지움 — 대표만, '전체 삭제' 입력해야 함
    //   POST { ls:true(매물장·사진·지도 광고), hj:true(아파트 장부 호 기록 · 담은 단지 목록은 남김), cu:true(고객관리), confirm:'전체 삭제' }
    if (action === 'wipe') {
      if (req.method !== 'POST') return fail(res, 405, 'method', '허용되지 않는 요청입니다.');
      const s = await office(req);
      if (!s) return fail(res, 401, 'login', '로그인이 필요합니다.');
      if (s.staff || s.blocked) return noStaff(res, s, '자료 비우기는');
      if (!(await planOf(s.id)).started) return fail(res, 403, 'start', '중개사 서비스를 먼저 시작해 주세요.');
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
      if (String(body.confirm || '').replace(/\s/g, '') !== '전체삭제') return fail(res, 400, 'confirm', "'전체 삭제'를 정확히 입력해 주세요.");
      if (!body.ls && !body.hj && !body.cu) return fail(res, 400, 'none', '지울 자료를 골라 주세요.');
      const uid = s.id, done = {};
      if (body.ls) {
        const gone = await lsDrop(redis, uid);
        try { const f = ((await redis(['HKEYS', PUB_KEY])) || []).filter(k => String(k).startsWith(`${uid}:`)); if (f.length) await redis(['HDEL', PUB_KEY, ...f]); } catch { /* 무시 */ }
        await dropPhotos(gone.flatMap(x => (x.photos || []).map(p => p.url)).filter(u => ownPhoto(u, uid)));
        await brokerStat(uid, []); done.ls = gone.length;
      }
      if (body.hj) {
        await dropLedgers(redis, uid);
        try { const v = await redis(['GET', `realmap:cx:${uid}`]); if (v) { const d = JSON.parse(v); d.memos = {}; await redis(['SET', `realmap:cx:${uid}`, JSON.stringify(d)]); } } catch { /* 무시 */ }
        done.hj = true;
      }
      if (body.cu) { await dropCust(redis, uid); done.cu = true; }
      await redis(['DEL', `realmap:xim:${uid}`]).catch(() => 0);   // 엑셀 불러오기 기록(되돌리기)은 지운 자료와 맞지 않으므로 비움
      return send(res, 200, { ok: true, done });
    }
    if (action === 'withdraw') {
      if (req.method !== 'POST') return fail(res, 405, 'method', '허용되지 않는 요청입니다.');
      const s = readSession(req);
      if (!s) return fail(res, 401, 'auth', '로그인 상태가 아닙니다.');
      try { await redis(['DEL', `realmap:user:${s.id}`]); await redis(['DEL', `realmap:fav:${s.id}`]); await redis(['DEL', `realmap:zfav:${s.id}`]); await redis(['DEL', `realmap:cx:${s.id}`]); await redis(['SREM', 'realmap:zwatch', String(s.id)]);
        await leave(redis, s.id); await dropTeam(redis, s.id);
        await dropBroker(s.id); await redis(['SREM', 'realmap:trialused', String(s.id)]); await redis(['SREM', 'realmap:users', s.id]); } catch { /* 저장소 없음 */ }
      res.setHeader('Set-Cookie', [cookie('rm_s', '', 0)]);
      return send(res, 200, { ok: true });
    }
    return fail(res, 400, 'action', '알 수 없는 요청입니다.');
  } catch (e) {
    return fail(res, 502, 'error', e.message || '처리 중 오류가 발생했습니다.');
  }
}
