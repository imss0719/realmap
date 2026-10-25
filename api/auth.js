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
import { ledger, dropLedger, dropLedgers } from './_ledger.js';

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
  free: { name: '무료', ls: 10, ad: 3, cx: 3, adv: false },
  trial: { name: '2주 무료 체험', ls: 1000, ad: 300, cx: 10, adv: true },
  basic: { name: 'Basic', ls: 1000, ad: 300, cx: 10, adv: true },
  premium: { name: 'Premium', ls: 10000, ad: 1000, cx: 30, adv: true },
  vip: { name: 'VIP', ls: 1e9, ad: 1e9, cx: 100, adv: true },
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
    if (PLANS[rec.plan] && rec.plan !== 'free' && live) return out(rec.plan, { until: rec.until || null, trialUsed: !!rec.trialUsed });
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
const cxFull = P => P.plan === 'free' ? `무료 이용은 단지 ${P.cx}곳까지입니다. Basic(월 9,900원)이면 10곳까지 등록할 수 있습니다.` : `${P.name} 요금제는 단지 ${P.cx}곳까지입니다.${P.plan === 'vip' ? '' : ' 요금제를 올리시면 더 등록할 수 있습니다.'}`;
export const planView = P => ({ plan: P.plan, name: P.name, until: P.until || null, ls: P.ls >= 1e9 ? null : P.ls, ad: P.ad >= 1e9 ? null : P.ad, cx: P.cx || 0, adv: P.adv, started: P.started, ended: P.ended || '', trialUsed: !!P.trialUsed, op: !!P.op });
// 중개사무소 정보 확인 (시작하기·정보 수정 공용)
function cleanBk(b) {
  b = b || {};
  const str = (v, n) => String(v ?? '').replace(/[<>"]/g, '').trim().slice(0, n);
  const bk = { office: str(b.office, 40), addr: str(b.addr, 80), regno: str(b.regno, 30).replace(/[^\w-]/g, ''), ceo: str(b.ceo, 20), tel: str(b.tel, 20).replace(/[^\d-]/g, ''), mobile: str(b.mobile, 20).replace(/[^\d-]/g, ''), up: new Date().toISOString() };
  if (!bk.office || !bk.addr || !bk.regno || !bk.ceo || !bk.tel || !bk.mobile) return [null, '여섯 칸을 모두 입력해 주세요.'];
  if (!/^01\d-?\d{3,4}-?\d{4}$/.test(bk.mobile)) return [null, '휴대폰 번호를 확인해 주세요. (문자 문의를 받을 번호)'];
  if (!/\d{4,}/.test(bk.regno)) return [null, '중개사무소 등록번호를 확인해 주세요. (예: 11440-2025-00123)'];
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
async function sendSms(to, text) {
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
  try { r = await checkOffice(bk); } catch { return { st: 'error', msg: '' }; }
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
  if (x.ptype === '토지') { if (!a.use) miss.push('지목'); return miss; }
  if (!x.ptype) return miss;
  // 건축물: 국토부 고시 「중개대상물의 표시·광고 명시사항 세부기준」 제6조
  if (x.kind !== 'presale' && !a.use) miss.push('건축물 용도');
  if (!a.tfl) miss.push('총 층수');
  if (!a.fl) miss.push('해당 층');
  if (x.kind !== 'presale' && !a.appr) miss.push('사용승인일');
  if (!a.dir) miss.push('방향');
  if (!a.movein) miss.push('입주 가능일');
  if (x.kind !== 'presale' && !a.park) miss.push('주차 대수');
  if (RESID.includes(x.ptype)) {
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
    k: `${uid}:${x.id}`, no: x.no || '', kind: x.kind, ptype: x.ptype, ptypeTx: x.ptypeTx || '',
    price: x.price || null, deposit: x.deposit || null, rent: x.rent || null, pr: x.pr || null, mgmt: x.mgmt || null, premium: x.premium || null, nomgmt: !!a.nomgmt,
    area: x.area || null, ak: p0.land ? 'land' : p0.ak || 'ex', n: (x.places || []).length || 1,
    pnu: x.pnu, lat: x.lat, lng: x.lng, addr: x.addr, road: x.road || '', bname: x.bname || '',
    dong: x.ptype === '아파트' || x.ptype === '오피스텔' ? (p0.dong || '') : '',   // 호수는 공개하지 않음
    flr: floorText(a), tfl: a.tfl || null, dir: a.dir || '', dirB: RESID.includes(x.ptype) ? '주실 기준' : '주출입구 기준', rooms: a.rooms ?? null, baths: a.baths ?? null, movein: a.movein || '', park: a.park || '', appr: a.appr || '', desc: a.desc || '',
    use: a.use || '', viol: !!a.viol, zone: a.zone || '', rside: a.road || '', lp: a.lp || null, hhld: a.hhld || null, elev: a.elev || null,
    biz: a.biz || '', wc: a.wc || '', facx: a.facx || '', mgmtT: a.mgmtT || '', mgmtInc: a.mgmtInc || [], mgmtTx: a.mgmtTx || '',
    photos: (x.photos || []).slice(0, 10).map(p => p.url),
    bk: { office: bk.office, addr: bk.addr, regno: bk.regno, ceo: bk.ceo, tel: bk.tel, mobile: bk.mobile || '', verified: !!bk.verified, photo: bk.photo || '' },
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
function cleanAd(a) {
  a = a || {};
  const t = (v, n) => String(v ?? '').replace(/[<>"]/g, '').trim().slice(0, n);
  const int = v => { const x = parseInt(String(v ?? '').replace(/\D/g, ''), 10); return Number.isFinite(x) ? Math.min(x, 99999) : null; };
  const DIRS = ['남향', '남동향', '남서향', '동향', '서향', '북향', '북동향', '북서향'];
  const MGI = ['gen', 'elec', 'water', 'gas', 'heat', 'net', 'tv', 'etc'];
  const WCS = ['내부 전용', '내부 공용', '외부 공용', '외부 전용'];
  return { fl: t(a.fl, 8), tfl: int(a.tfl), ufl: int(a.ufl), flx: a.flx === 'lmh' ? 'lmh' : 'exact', dir: DIRS.includes(a.dir) ? a.dir : '', rooms: int(a.rooms), baths: int(a.baths),
    movein: t(a.movein, 20), park: t(a.park, 30), appr: t(a.appr, 10).replace(/[^\d.-]/g, ''), nomgmt: !!a.nomgmt, desc: t(a.desc, 300),
    use: t(a.use, 40), viol: !!a.viol, zone: t(a.zone, 40), road: t(a.road, 20), lp: (v => v > 0 && v < 1e9 ? v : null)(Number(String(a.lp ?? '').replace(/\D/g, ''))), hhld: int(a.hhld), elev: int(a.elev),
    biz: t(a.biz, 30), wc: WCS.includes(a.wc) ? a.wc : '', facx: t(a.facx, 80),
    mgmtT: a.mgmtT === 'fix' ? 'fix' : 'avg', mgmtInc: (Array.isArray(a.mgmtInc) ? a.mgmtInc : []).filter(k => MGI.includes(k)), mgmtTx: t(a.mgmtTx, 60) };
}
// 중개사 명단·통계 (관리 페이지용): realmap:brokers 집합, realmap:bstat:<id> { n, pub, up }
export async function brokerStat(uid, items) {
  const now = new Date().toISOString();
  try { await pipe([['SADD', 'realmap:brokers', String(uid)], ['SET', `realmap:bstat:${uid}`, JSON.stringify({ n: items.length, on: items.filter(x => x.status === 'on').length, pub: items.filter(x => x.pub && x.pub.on && x.status === 'on' && x.pub.exp > now).length, up: now })]]); } catch { /* 통계 실패는 무시 */ }
}
// 중개사 서비스 데이터 지우기 (중개사 해지 · 회원 탈퇴 공용) — 일반 회원 정보는 그대로
async function dropBroker(uid) {
  await dropLedgers(redis, uid); // 단지 장부(호실 장부) — 고객 연락처가 들어 있으므로 가장 먼저
  try { const b = await loadBk(uid); if (b && b.photo) await dropPhotos([b.photo]); } catch { /* 무시 */ }
  try { const b = await loadBk(uid), d = b && digitsOf(b.regno); if (d && await redis(['HGET', 'realmap:regno', d]) === String(uid)) await redis(['HDEL', 'realmap:regno', d]); } catch { /* 무시 */ }
  try { const ls = JSON.parse((await redis(['GET', `realmap:ls:${uid}`])) || '[]'); await dropPhotos(ls.flatMap(x => (x.photos || []).map(p => p.url)).filter(u => ownPhoto(u, uid))); const f = ls.map(x => `${uid}:${x.id}`); if (f.length) await redis(['HDEL', PUB_KEY, ...f]); } catch { /* 무시 */ }
  await pipe([['DEL', `realmap:ls:${uid}`], ['DEL', `realmap:bk:${uid}`], ['DEL', `realmap:plan:${uid}`], ['DEL', `realmap:cx:${uid}`], ['DEL', `realmap:bstat:${uid}`], ['SREM', 'realmap:brokers', String(uid)]]);
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
      const P = s ? await planOf(s.id) : null;
      let pend = null; // 가입 신청 후 확인 대기 중이면 화면에 안내
      if (s && P && !P.started) { const b = await loadBk(s.id); if (b && b.pend) pend = { office: b.office, addr: b.addr, regno: b.regno, ceo: b.ceo, tel: b.tel, mobile: b.mobile, at: b.pend }; }
      return send(res, 200, { ok: true, sms: smsOn(), ready: !!REST, member: !!s, nickname: s ? s.n : '', pro: !!(P && P.adv), plan: P ? planView(P) : null, op: !!(s && ADMIN_ID && s.id === ADMIN_ID), pend });
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
      const s = readSession(req);
      if (!s) return fail(res, 401, 'login', '로그인이 필요합니다.');
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
        d.items = d.items.filter(x => x.id !== id);
        for (const k of Object.keys(d.memos)) if (k.startsWith(id + '|')) delete d.memos[k];
        await dropLedger(redis, s.id, id);
      } else if (body.op === 'dir') {
        // 라인별 방향 (같은 라인은 보통 같은 방향): key = 'PNU|동|라인'
        const dk = str(body.key, 40), DIRS = ['남', '남동', '남서', '동', '서', '북', '북동', '북서'];
        if (!/^(\d{19}|\*)\|[^|]{1,16}\|\d{1,3}$/.test(dk)) return fail(res, 400, 'bad_key', '라인 위치가 올바르지 않습니다.');
        it.dir = it.dir || {};
        if (DIRS.includes(body.v)) it.dir[dk] = body.v; else delete it.dir[dk];
        if (Object.keys(it.dir).length > 800) return fail(res, 400, 'full', '방향 정보가 너무 많습니다.');
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
    if (action === 'hj') {
      res.setHeader('Cache-Control', 'no-store');
      const s = readSession(req);
      if (!s) return fail(res, 401, 'login', '로그인이 필요합니다.');
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
      return ledger({ redis, uid: s.id, cx: d, saveCx: () => redis(['SET', ck, JSON.stringify(d)]), send, fail, req, res, body });
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
        if (n1 > 5 || n2 > 5) return fail(res, 429, 'many', '오늘은 인증번호를 더 받을 수 없습니다. 내일 다시 시도하시거나 리얼맵 운영자에게 알려 주세요.');
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
      let P = await planOf(s.id);
      if (P.started) return send(res, 200, { ok: true, plan: planView(P), bk: await loadBk(s.id) });
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
      await brokerStat(s.id, JSON.parse((await redis(['GET', `realmap:ls:${s.id}`])) || '[]'));
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

    // 중개사무소 정보 (매물 광고에 표시)
    if (action === 'bk') {
      res.setHeader('Cache-Control', 'no-store');
      const s = readSession(req);
      if (!s) return fail(res, 401, 'login', '로그인이 필요합니다.');
      if (!R_URL || !R_TOKEN) return fail(res, 500, 'no_storage', '회원 저장소가 연결되지 않았습니다.');
      const P = await planOf(s.id);
      if (!P.started) return fail(res, 403, 'start', '중개사 서비스를 먼저 시작해 주세요.');
      if (req.method !== 'POST') return send(res, 200, { ok: true, bk: await loadBk(s.id), canPub: canPub(s.id) });
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
      const [bk, err] = cleanBk(body.bk);
      if (!bk) return fail(res, 400, 'need', err);
      // 등록번호·대표자가 그대로면 확인 유지(명칭은 등록된 그대로), 바뀌면 국가 자료로 다시 확인
      const prevBk = await loadBk(s.id);
      if (!P.op && !(await mobileOk(s.id, bk, prevBk))) return fail(res, 400, 'sms', SMS_NEED);
      if (prevBk && prevBk.verified && digitsOf(prevBk.regno) === digitsOf(bk.regno) && nmOf(prevBk.ceo) === nmOf(bk.ceo)) {
        Object.assign(bk, { verified: prevBk.verified, vby: prevBk.vby || 'op', regno: prevBk.regno });
        if (prevBk.vby === 'auto') bk.office = prevBk.office;
      } else if (!P.op) {
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
      try { const ls = JSON.parse((await redis(['GET', `realmap:ls:${s.id}`])) || '[]'); await syncPub(s.id, ls, bk, P); await redis(['SET', `realmap:ls:${s.id}`, JSON.stringify(ls)]); } catch { /* 다음 저장 때 반영 */ }
      return send(res, 200, { ok: true, bk, canPub: canPub(s.id) });
    }

    // 매물장 (PRO 전용) — 회원별 최대 1,000건, 한 덩어리로 저장
    if (action === 'listings' || action === 'listing') {
      const s = readSession(req);
      if (!s) return fail(res, 401, 'login', '로그인이 필요합니다.');
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
      if (action === 'listings') { await brokerStat(s.id, items); return send(res, 200, { ok: true, items, bk: await loadBk(s.id), canPub: canPub(s.id), plan: planView(P) }); }
      if (req.query.op === 'photodel') { // 저장하지 않고 닫은 사진 정리 (저장된 매물에 쓰인 사진은 지우지 않음)
        const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
        const used = new Set(items.flatMap(x => (x.photos || []).map(p => p.url)));
        const cb = await loadBk(s.id); if (cb && cb.photo) used.add(cb.photo); // 지금 쓰는 대표 사진은 지우지 않음
        await dropPhotos((Array.isArray(body.urls) ? body.urls : []).filter(u => ownPhoto(u, s.id) && !used.has(u)).slice(0, 50));
        return send(res, 200, { ok: true });
      }
      if (req.method !== 'POST') return fail(res, 405, 'method', '허용되지 않는 요청입니다.');
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
      const str = (v, n) => String(v ?? '').replace(/[<>]/g, '').trim().slice(0, n);
      const numv = v => { const x = Number(String(v ?? '').replace(/[^\d.]/g, '')); return Number.isFinite(x) && x > 0 ? Math.round(x * 100) / 100 : null; };
      const id = str(body.id, 20).replace(/[^\w-]/g, '');
      const now = new Date().toISOString();
      // 요금제 한도를 넘은 매물(예: 체험 때 등록한 100건)은 지우지 않고 '보기 전용': 최근 등록한 한도 건수만 수정·상태 변경·게시
      const ro = readOnlyIds(items, P);
      if (id && ro.has(id) && ['save', 'status', 'pub', 'renew'].includes(body.op)) return fail(res, 403, 'readonly', P.plan === 'free'
        ? `무료 이용은 최근 등록한 매물 ${P.ls}건만 수정할 수 있습니다. 이 매물은 보기와 엑셀 내려받기만 됩니다. Basic(월 9,900원)이면 모두 수정하실 수 있습니다.`
        : `${P.name} 요금제는 최근 등록한 매물 ${P.ls.toLocaleString()}건만 수정할 수 있습니다.`, { plan: planView(P) });
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
        // 임대 현황 · 층별 현황 (통건물: 층·용도·면적은 건축물대장에서 자동, 나머지는 직접) — fl·use·area·biz·exp는 10/25 추가
        const rents = (Array.isArray(it.rents) ? it.rents : []).map(r => ({ label: str(r.label, 30), deposit: numv(r.deposit), rent: numv(r.rent), memo: str(r.memo, 60),
          fl: str(r.fl, 8), use: str(r.use, 30), area: numv(r.area), biz: str(r.biz, 30), exp: str(r.exp, 10).replace(/[^\d.-]/g, '') }))
          .map(r => Object.fromEntries(Object.entries(r).filter(([k, v]) => ['label', 'deposit', 'rent', 'memo'].includes(k) || (v != null && v !== ''))))
          .filter(r => r.label || r.deposit || r.rent || r.memo || r.fl || r.biz).slice(0, 60);
        const photos = (Array.isArray(it.photos) ? it.photos : []).map(p => ({ url: String(p && p.url || '') })).filter(p => ownPhoto(p.url, s.id)).slice(0, 30);
        const kind = ['sale', 'jeonse', 'wolse', 'presale'].includes(it.kind) ? it.kind : 'sale';
        const status = ['on', 'hold', 'done'].includes(it.status) ? it.status : 'on';
        const prev = id ? items.find(x => x.id === id) : null;
        if (!prev && items.length >= P.ls) return fail(res, 400, 'limit', P.plan === 'free'
          ? `무료 이용은 매물 ${P.ls}건까지입니다. Basic(월 9,900원)으로 올리시면 1,000건까지 등록하실 수 있습니다.`
          : `${P.name} 요금제는 매물 ${P.ls.toLocaleString()}건까지입니다. 거래완료된 매물을 정리하시거나 요금제를 올려 주세요.`, { plan: planView(P) });
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
          memo: str(it.memo, 5000), status, at: prev ? prev.at : now, up: now,
          ad: cleanAd(it.ad), ...(prev && prev.pub ? { pub: prev.pub } : {}),
        };
        items = prev ? items.map(x => (x.id === rec.id ? rec : x)) : [rec, ...items];
        if (prev && prev.photos) { const keep = new Set(photos.map(p => p.url)); await dropPhotos(prev.photos.map(p => p.url).filter(u => !keep.has(u) && ownPhoto(u, s.id))); }
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
        const gone = items.find(x => x.id === id);
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
      await redis(['SET', key, JSON.stringify(items)]);
      try { const before = items.filter(i => i.pub && i.pub.on).length; await syncPub(s.id, items, bk, P); await brokerStat(s.id, items); if (items.filter(i => i.pub && i.pub.on).length < before) await redis(['SET', key, JSON.stringify(items)]); } catch { /* 공개 목록은 다음 저장 때 맞춰짐 */ }
      return send(res, 200, { ok: true, items, bk, canPub: canPub(s.id), warn, plan: planView(P) });
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
      await dropBroker(s.id);
      await redis(['SADD', 'realmap:trialused', String(s.id)]);
      return send(res, 200, { ok: true });
    }
    if (action === 'withdraw') {
      if (req.method !== 'POST') return fail(res, 405, 'method', '허용되지 않는 요청입니다.');
      const s = readSession(req);
      if (!s) return fail(res, 401, 'auth', '로그인 상태가 아닙니다.');
      try { const ls = JSON.parse((await redis(['GET', `realmap:ls:${s.id}`])) || '[]'); await dropPhotos(ls.flatMap(x => (x.photos || []).map(p => p.url)).filter(u => ownPhoto(u, s.id))); } catch { /* 무시 */ }
      try { await redis(['DEL', `realmap:user:${s.id}`]); await redis(['DEL', `realmap:fav:${s.id}`]); await redis(['DEL', `realmap:zfav:${s.id}`]); await redis(['DEL', `realmap:cx:${s.id}`]); await redis(['SREM', 'realmap:zwatch', String(s.id)]);
        await dropBroker(s.id); await redis(['SREM', 'realmap:trialused', String(s.id)]); await redis(['SREM', 'realmap:users', s.id]); } catch { /* 저장소 없음 */ }
      res.setHeader('Set-Cookie', [cookie('rm_s', '', 0)]);
      return send(res, 200, { ok: true });
    }
    return fail(res, 400, 'action', '알 수 없는 요청입니다.');
  } catch (e) {
    return fail(res, 502, 'error', e.message || '처리 중 오류가 발생했습니다.');
  }
}
