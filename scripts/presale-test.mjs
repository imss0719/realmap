// 11/2 시험: 입주 예정(공사 중) 아파트 — 분양권·입주권 실거래 + 청약홈 분양정보 맞춰 보기 (GitHub Actions에서 실행)
//   ① 국토부 아파트 분양권전매 실거래 MONTHS개월 → 단지별로 묶음 · 분양권/입주권 구분 칸이 있는지 확인
//   ② 같은 기간 아파트 매매 실거래에 같은 단지가 나오면 '이미 입주'로 봄 (매매 거래가 없어야 공사 중)
//   ③ 청약홈 분양정보(공고)에서 같은 구 주소 · 비슷한 이름 → 입주 예정월 · 시공사 · 세대수 · 주택형별 분양가
//   결과: data/presale-test.json + Actions 화면 요약표 (지도에는 안 씀 — 시험용)
// 필요한 비밀값: DATA_GO_KR_KEY (공공데이터포털에서 '분양권전매' · '청약홈 분양정보' 활용신청이 되어 있어야 함)
import { writeFile, mkdir, appendFile } from 'node:fs/promises';
import { monthsBack } from '../api/trades.js';
import { dataGoKrAll, num, DATA_KEY } from '../api/_lib.js';

const GUS = String(process.env.GUS || '11440,11410,11380').split(/[,\s]+/).filter(Boolean);
const MONTHS = +(process.env.MONTHS || 48);
const B = 'https://apis.data.go.kr/1613000/';
const SILV = B + 'RTMSDataSvcSilvTrade/getRTMSDataSvcSilvTrade';
const APT = [B + 'RTMSDataSvcAptTradeDev/getRTMSDataSvcAptTradeDev', B + 'RTMSDataSvcAptTrade/getRTMSDataSvcAptTrade'];
const OD = 'https://api.odcloud.kr/api/ApplyhomeInfoDetailSvc/v1/';
const clean = s => String(s ?? '').trim();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const norm = s => clean(s).replace(/\(.*?\)|\[.*?\]/g, '').replace(/\s|아파트|APT|주상복합|[·,\-]/gi, '').toLowerCase();
if (!DATA_KEY) { console.log('DATA_GO_KR_KEY 비밀값이 비어 있습니다.'); process.exit(1); }

const SGG = { 11110: '종로구', 11140: '중구', 11170: '용산구', 11200: '성동구', 11215: '광진구', 11230: '동대문구', 11260: '중랑구', 11290: '성북구', 11305: '강북구', 11320: '도봉구', 11350: '노원구', 11380: '은평구', 11410: '서대문구', 11440: '마포구', 11470: '양천구', 11500: '강서구', 11530: '구로구', 11545: '금천구', 11560: '영등포구', 11590: '동작구', 11620: '관악구', 11650: '서초구', 11680: '강남구', 11710: '송파구', 11740: '강동구' };
const yms = monthsBack(MONTHS + 1).slice(1);
const notes = [];

async function getAll(url, gu, ym) {
  for (let t = 0; t < 5; t++) {
    try { return await dataGoKrAll(url, { LAWD_CD: gu, DEAL_YMD: ym }, { pageSize: 1000, maxPages: 30 }); }
    catch (e) { if (t === 4 || /\(30\)|\(20\)|\(12\)|등록|NOT_REGISTERED|ACCESS_DENIED|SERVICE_KEY/i.test(e.message)) throw e; await sleep(2000 * (t + 1)); }
  }
}

// ① 분양권·입주권 실거래
const silv = [], keysSeen = new Set(), gbn = {};
let silvErr = '';
for (const gu of GUS) {
  for (const ym of yms) {
    let rows;
    try { rows = await getAll(SILV, gu, ym); }
    catch (e) { silvErr = `${gu} ${ym}: ${e.message.slice(0, 200)}`; log('분양권 오류', silvErr); break; }
    for (const r of rows) {
      Object.keys(r).forEach(k => keysSeen.add(k));
      for (const k of Object.keys(r)) if (/gbn|type|구분/i.test(k)) { gbn[k] ||= {}; const v = clean(r[k]) || '(빈칸)'; gbn[k][v] = (gbn[k][v] || 0) + 1; }
      silv.push({ gu, ym, r });
    }
    await sleep(60);
  }
  log(`${gu} 분양권 누적 ${silv.length}건`);
}

// 분양권/입주권 구분 칸 찾기: 값이 '분'/'입' 또는 '분양권'/'입주권' 인 칸
const kindKey = Object.keys(gbn).find(k => Object.keys(gbn[k]).some(v => /^(분|입|분양권|입주권)$/.test(v)));
const kindOf = r => { const v = clean(kindKey ? r[kindKey] : ''); return /^입/.test(v) ? 'ip' : /^분/.test(v) ? 'bu' : '?'; };

// 단지별 묶기 (구 + 동 + 단지명)
const cx = new Map();
for (const { gu, r } of silv) {
  if (clean(r.cdealType) === 'O' || clean(r.cdealDay)) continue;   // 해제 거래 제외
  const nm = clean(r.aptNm), umd = clean(r.umdNm);
  if (!nm) continue;
  const id = `${gu}|${umd}|${norm(nm)}`;
  let c = cx.get(id);
  if (!c) cx.set(id, c = { gu, umd, nm, jibun: clean(r.jibun), bu: [], ip: [], q: [] });
  const t = { d: `${r.dealYear}${String(r.dealMonth).padStart(2, '0')}${String(r.dealDay || '').padStart(2, '0')}`, ar: num(r.excluUseAr), p: num(r.dealAmount), f: clean(r.floor) };
  c[kindOf(r) === 'ip' ? 'ip' : kindOf(r) === 'bu' ? 'bu' : 'q'].push(t);
}
log(`단지 ${cx.size}곳`);

// ② 아파트 매매에 나오면 이미 입주
const aptNames = new Set();
let aptUrl = APT[0], aptErr = '';
for (const gu of GUS) {
  for (const ym of yms.slice(0, 24)) {   // 최근 2년 매매만 보면 충분
    let rows;
    try { rows = await getAll(aptUrl, gu, ym); }
    catch (e) {
      if (aptUrl === APT[0]) { aptUrl = APT[1]; try { rows = await getAll(aptUrl, gu, ym); } catch (e2) { aptErr = e2.message.slice(0, 160); break; } }
      else { aptErr = e.message.slice(0, 160); break; }
    }
    for (const r of rows) aptNames.add(`${gu}|${clean(r.umdNm)}|${norm(r.aptNm)}`);
    await sleep(60);
  }
}
for (const c of cx.values()) c.moved = aptNames.has(`${c.gu}|${c.umd}|${norm(c.nm)}`);

// ③ 청약홈 분양정보
async function od(op, cond, perPage = 1000) {
  const out = [];
  for (let page = 1; page < 30; page++) {
    const u = new URL(OD + op);
    u.searchParams.set('page', page); u.searchParams.set('perPage', perPage); u.searchParams.set('serviceKey', DATA_KEY);
    for (const [k, v] of Object.entries(cond)) u.searchParams.set(`cond[${k}]`, v);
    let j;
    for (let t = 0; t < 4 && !j; t++) {
      try { const r = await fetch(u); const tx = await r.text(); if (!r.ok) throw new Error(`HTTP ${r.status} ${tx.slice(0, 160)}`); j = JSON.parse(tx); }
      catch (e) { if (t === 3) throw e; await sleep(1500 * (t + 1)); }
    }
    out.push(...(j.data || []));
    if (!j.data || out.length >= (j.matchCount ?? j.totalCount ?? 0) || j.data.length < perPage) break;
  }
  return out;
}
let ann = [], annErr = '';
const since = String(+yms[0].slice(0, 4) - 6) + '-01-01';
try { ann = await od('getAPTLttotPblancDetail', { 'SUBSCRPT_AREA_CODE_NM::EQ': '서울', 'RCRIT_PBLANC_DE::GTE': since }); }
catch (e) { annErr = e.message.slice(0, 200); }
log(`청약홈 서울 공고 ${ann.length}건 ${annErr}`);
const annKeys = ann[0] ? Object.keys(ann[0]) : [];

const pick = (o, ...ks) => { for (const k of ks) if (o[k] != null && o[k] !== '') return o[k]; return ''; };
for (const c of cx.values()) {
  const gnm = SGG[c.gu] || '';
  const cand = ann.filter(a => clean(pick(a, 'HSSPLY_ADRES')).includes(gnm));
  const k = norm(c.nm);
  let best = cand.find(a => norm(a.HOUSE_NM) === k) || cand.find(a => { const h = norm(a.HOUSE_NM); return h && k && (h.includes(k) || k.includes(h)); });
  if (!best) best = cand.find(a => clean(a.HSSPLY_ADRES).includes(c.umd) && clean(a.HSSPLY_ADRES).includes(c.jibun.split('-')[0]));
  if (best) c.ah = { no: best.HOUSE_MANAGE_NO, pb: best.PBLANC_NO, nm: best.HOUSE_NM, addr: best.HSSPLY_ADRES, mv: pick(best, 'MVN_PREARNGE_YM'), cn: pick(best, 'CNSTRCT_ENTRPS_NM'), hh: pick(best, 'TOT_SUPLY_HSHLDCO'), de: pick(best, 'RCRIT_PBLANC_DE') };
}
// 주택형별 분양가 (공사 중 + 맞춘 단지만)
let mdlErr = '', mdlKeys = [];
for (const c of cx.values()) {
  if (!c.ah || c.moved) continue;
  try {
    const m = await od('getAPTLttotPblancMdl', { 'HOUSE_MANAGE_NO::EQ': c.ah.no }, 100);
    if (m[0] && !mdlKeys.length) mdlKeys = Object.keys(m[0]);
    c.ah.ty = m.map(x => ({ ty: clean(x.HOUSE_TY), ar: num(x.SUPLY_AR), top: num(pick(x, 'LTTOT_TOP_AMOUNT')) }));
  } catch (e) { mdlErr = e.message.slice(0, 200); }
  await sleep(80);
}

// 결과
const eok = p => p ? (p / 1e4).toFixed(1) + '억' : '-';
const last = (a, ar) => { const s = a.filter(t => !ar || Math.abs(t.ar - ar) < 6).sort((x, y) => y.d.localeCompare(x.d)); return s[0]; };
const list = [...cx.values()].sort((a, b) => (a.moved - b.moved) || (b.bu.length + b.ip.length + b.q.length) - (a.bu.length + a.ip.length + a.q.length));
const building = list.filter(c => !c.moved);
const S = [];
S.push(`# 입주 예정 아파트 시험 — ${GUS.map(g => SGG[g] || g).join(', ')} · 최근 ${MONTHS}개월`);
S.push(`- 분양권·입주권 거래 ${silv.length}건 · 단지 ${cx.size}곳 → **공사 중(매매 거래 없음) ${building.length}곳** · 이미 입주 ${cx.size - building.length}곳`);
S.push(`- 분양권/입주권 구분 칸: **${kindKey ? `${kindKey} → ${JSON.stringify(gbn[kindKey])}` : '못 찾음'}**`);
S.push(`- 구분 후보 칸 값: \`${JSON.stringify(gbn)}\``);
S.push(`- 분양권 자료 칸 이름: \`${[...keysSeen].join(', ')}\``);
if (silvErr) S.push(`- ⚠ 분양권 자료 오류: ${silvErr}`);
if (aptErr) S.push(`- ⚠ 아파트 매매 오류: ${aptErr}`);
S.push(`- 청약홈 서울 공고 ${ann.length}건 (${since}~)${annErr ? ` · ⚠ 오류: ${annErr}` : ''} · 공사 중 단지 중 청약홈 맞춤 **${building.filter(c => c.ah).length}/${building.length}**`);
S.push(`- 청약홈 공고 칸: \`${annKeys.join(', ')}\``);
S.push(`- 청약홈 주택형 칸: \`${mdlKeys.join(', ')}\`${mdlErr ? ` · ⚠ ${mdlErr}` : ''}`);
S.push('', '| 단지(실거래) | 동 | 분양권 | 입주권 | 구분없음 | 84 분양권 최근 | 84 입주권 최근 | 청약홈 이름 | 입주예정 | 시공사 | 세대 | 84 분양가 |', '|---|---|---|---|---|---|---|---|---|---|---|---|');
for (const c of building) {
  const b = last(c.bu, 84), i = last(c.ip, 84), t84 = c.ah?.ty?.find(x => /^08[4-5]/.test(x.ty)) || c.ah?.ty?.find(x => x.ar > 100 && x.ar < 120);
  S.push(`| ${c.nm} | ${c.umd} ${c.jibun} | ${c.bu.length} | ${c.ip.length} | ${c.q.length} | ${b ? `${eok(b.p)} (${b.d.slice(2, 6)})` : '-'} | ${i ? `${eok(i.p)} (${i.d.slice(2, 6)})` : '-'} | ${c.ah?.nm || '❌'} | ${c.ah?.mv || ''} | ${c.ah?.cn || ''} | ${c.ah?.hh || ''} | ${t84 ? eok(t84.top) : ''} |`);
}
S.push('', '<details><summary>이미 입주한 단지 (매매 거래 있음)</summary>', '', list.filter(c => c.moved).map(c => `${c.nm} (${c.umd}) 분${c.bu.length}·입${c.ip.length}`).join(' · '), '</details>');
const md = S.join('\n');
console.log(md);
if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, md + '\n');
await mkdir('data', { recursive: true });
await writeFile('data/presale-test.json', JSON.stringify({ at: new Date().toISOString(), gus: GUS, months: MONTHS, kindKey, gbn, building, moved: list.filter(c => c.moved).map(c => c.nm), notes }, null, 1));
