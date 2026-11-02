// 11/2 시험: 입주 예정(공사 중) 아파트 — 분양권·입주권 실거래 + 청약홈 분양정보 맞춰 보기 (GitHub Actions에서 실행)
//   ① 국토부 아파트 분양권전매 실거래 MONTHS개월 → 단지별로 묶음 (ownershipGbn '입' = 입주권, 빈칸 = 분양권)
//   ② 입주 판정: 최근 2년 아파트 매매에 같은 단지(이름 또는 동+지번)가 있거나, 청약홈 입주예정월이 12개월 넘게 지났으면 '이미 입주'
//   ③ 청약홈 분양정보(공고)에서 같은 시도 · 비슷한 이름 → 입주 예정월 · 시공사 · 세대수 · 주택형별 분양가
//   결과: data/presale-test.json + Actions 화면 요약표 (지도에는 안 씀 — 시험용)
// 필요한 비밀값: DATA_GO_KR_KEY (공공데이터포털 '분양권전매' · '청약홈 분양정보' 활용신청)
// GUS: 구 코드 쉼표 목록, 또는 서울 · 경기 · 인천 · 수도권
import { readFile, writeFile, mkdir, appendFile } from 'node:fs/promises';
import { monthsBack } from '../api/trades.js';
import { dataGoKrAll, num, DATA_KEY } from '../api/_lib.js';

const MONTHS = +(process.env.MONTHS || 48);
const CONC = +(process.env.CONC || 4);
const B = 'https://apis.data.go.kr/1613000/';
const SILV = B + 'RTMSDataSvcSilvTrade/getRTMSDataSvcSilvTrade';
const APT = [B + 'RTMSDataSvcAptTradeDev/getRTMSDataSvcAptTradeDev', B + 'RTMSDataSvcAptTrade/getRTMSDataSvcAptTrade'];
const OD = 'https://api.odcloud.kr/api/ApplyhomeInfoDetailSvc/v1/';
const clean = s => String(s ?? '').trim();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const norm = s => clean(s).replace(/\(.*?\)|\[.*?\]/g, '').replace(/\s|아파트|APT|주상복합|[·,\-]/gi, '').toLowerCase();
const bon = j => clean(j).replace(/^산\s*/, '').split('-')[0];
if (!DATA_KEY) { console.log('DATA_GO_KR_KEY 비밀값이 비어 있습니다.'); process.exit(1); }

// 시군구 목록 (data/sgg-11·41·28.json)
const SGG = {}, SIDO = { 11: '서울', 41: '경기', 28: '인천' };
for (const r of ['11', '41', '28']) { try { for (const f of JSON.parse(await readFile(`data/sgg-${r}.json`, 'utf8')).f) SGG[f.c] = f.n; } catch { /* 없음 */ } }
const want = String(process.env.GUS || '11440,11410,11380').split(/[,\s]+/).filter(Boolean);
const GUS = [...new Set(want.flatMap(w => w === '수도권' ? Object.keys(SGG) : w === '서울' ? Object.keys(SGG).filter(c => c.startsWith('11')) : w === '경기' ? Object.keys(SGG).filter(c => c.startsWith('41')) : w === '인천' ? Object.keys(SGG).filter(c => c.startsWith('28')) : [w]))];
const yms = monthsBack(MONTHS + 1).slice(1);
const nowYm = monthsBack(1)[0];
const ymMinus = (ym, n) => { let y = +ym.slice(0, 4), m = +ym.slice(4) - n; while (m < 1) { m += 12; y--; } return `${y}${String(m).padStart(2, '0')}`; };
const errs = [];

async function getAll(url, gu, ym) {
  for (let t = 0; t < 5; t++) {
    try { return await dataGoKrAll(url, { LAWD_CD: gu, DEAL_YMD: ym }, { pageSize: 1000, maxPages: 30 }); }
    catch (e) { if (t === 4 || /\(30\)|\(20\)|\(12\)|\(22\)|등록|NOT_REGISTERED|ACCESS_DENIED|SERVICE_KEY|LIMITED/i.test(e.message)) throw e; await sleep(2000 * (t + 1)); }
  }
}
async function pool(items, n, fn) { let i = 0; await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const x = items[i++]; await fn(x); } })); }
const jobs = (list) => GUS.flatMap(gu => list.map(ym => ({ gu, ym })));

// ① 분양권·입주권 실거래
const silv = [];
let stopSilv = '';
await pool(jobs(yms), CONC, async ({ gu, ym }) => {
  if (stopSilv) return;
  try { for (const r of await getAll(SILV, gu, ym)) silv.push({ gu, r }); }
  catch (e) { errs.push(`분양권 ${gu} ${ym}: ${e.message.slice(0, 120)}`); if (/\(30\)|\(22\)|LIMITED|등록/.test(e.message)) stopSilv = e.message.slice(0, 160); }
});
log(`분양권·입주권 ${silv.length}건`);

const cx = new Map();
for (const { gu, r } of silv) {
  if (clean(r.cdealType) === 'O' || clean(r.cdealDay)) continue;   // 해제 거래 제외
  const nm = clean(r.aptNm), umd = clean(r.umdNm);
  if (!nm) continue;
  const id = `${gu}|${umd}|${norm(nm)}`;
  let c = cx.get(id);
  if (!c) cx.set(id, c = { gu, sgg: SGG[gu] || gu, umd, nm, jibun: clean(r.jibun), bu: [], ip: [] });
  const t = { d: `${r.dealYear}${String(r.dealMonth).padStart(2, '0')}${String(r.dealDay || '').padStart(2, '0')}`, ar: num(r.excluUseAr), p: num(r.dealAmount), f: clean(r.floor) };
  c[clean(r.ownershipGbn).startsWith('입') ? 'ip' : 'bu'].push(t);
}
log(`단지 ${cx.size}곳`);

// ② 아파트 매매 (최근 2년): 이름 또는 동+본번이 같으면 입주
const aptName = new Set(), aptJb = new Set();
let aptUrl = APT[0];
await pool(jobs(yms.slice(0, 24)), CONC, async ({ gu, ym }) => {
  let rows;
  try { rows = await getAll(aptUrl, gu, ym); }
  catch (e) {
    if (aptUrl === APT[0]) { aptUrl = APT[1]; try { rows = await getAll(aptUrl, gu, ym); } catch (e2) { errs.push(`매매 ${gu} ${ym}: ${e2.message.slice(0, 120)}`); return; } }
    else { errs.push(`매매 ${gu} ${ym}: ${e.message.slice(0, 120)}`); return; }
  }
  for (const r of rows) { aptName.add(`${gu}|${clean(r.umdNm)}|${norm(r.aptNm)}`); aptJb.add(`${gu}|${clean(r.umdNm)}|${bon(r.jibun)}`); }
});

// ③ 청약홈 분양정보
async function od(op, cond, perPage = 1000) {
  const out = [];
  for (let page = 1; page < 40; page++) {
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
const since = String(+nowYm.slice(0, 4) - 7) + '-01-01';
const ann = {};
for (const s of new Set(GUS.map(g => g.slice(0, 2)))) {
  try { ann[s] = await od('getAPTLttotPblancDetail', { 'SUBSCRPT_AREA_CODE_NM::EQ': SIDO[s], 'RCRIT_PBLANC_DE::GTE': since }); }
  catch (e) { ann[s] = []; errs.push(`청약홈 ${SIDO[s]}: ${e.message.slice(0, 160)}`); }
  log(`청약홈 ${SIDO[s]} 공고 ${ann[s].length}건`);
}
for (const c of cx.values()) {
  const all = ann[c.gu.slice(0, 2)] || [];
  const city = c.sgg.split(' ')[0];   // '화성시 동탄구' → '화성시' (구가 새로 생긴 곳은 옛 공고 주소에 구 이름이 없음)
  const k = norm(c.nm);
  const near = all.filter(a => { const ad = clean(a.HSSPLY_ADRES); return ad.includes(c.umd) || ad.includes(city); });
  const same = a => norm(a.HOUSE_NM) === k;
  const part = a => { const h = norm(a.HOUSE_NM); return h && k && h.length > 2 && k.length > 2 && (h.includes(k) || k.includes(h)); };
  const byJb = a => { const ad = clean(a.HSSPLY_ADRES); return ad.includes(c.umd) && new RegExp(`\\b${bon(c.jibun)}(\\b|-)`).test(ad); };
  const best = near.find(same) || near.find(part) || near.find(byJb) || all.find(same);
  if (best) c.ah = { no: best.HOUSE_MANAGE_NO, nm: best.HOUSE_NM, addr: best.HSSPLY_ADRES, mv: clean(best.MVN_PREARNGE_YM), cn: clean(best.CNSTRCT_ENTRPS_NM), hh: clean(best.TOT_SUPLY_HSHLDCO), de: clean(best.RCRIT_PBLANC_DE) };
  // 입주 판정
  const byName = aptName.has(`${c.gu}|${c.umd}|${k}`), byJib = aptJb.has(`${c.gu}|${c.umd}|${bon(c.jibun)}`);
  const old = c.ah?.mv && c.ah.mv <= ymMinus(nowYm, 12);
  c.moved = byName ? '매매(이름)' : byJib ? '매매(지번)' : old ? `입주예정 ${c.ah.mv} 지남` : '';
  c.state = c.moved ? '' : c.ah?.mv && c.ah.mv <= nowYm ? '입주 중' : '공사 중';
}
// 주택형별 분양가 (입주 전 + 청약홈 맞춘 단지만)
let mdlErr = '';
await pool([...cx.values()].filter(c => c.ah && !c.moved), 3, async c => {
  try { c.ah.ty = (await od('getAPTLttotPblancMdl', { 'HOUSE_MANAGE_NO::EQ': c.ah.no }, 100)).map(x => ({ ty: clean(x.HOUSE_TY), ar: num(x.SUPLY_AR), top: num(x.LTTOT_TOP_AMOUNT) })); }
  catch (e) { mdlErr = e.message.slice(0, 160); }
});

// 결과
const eok = p => p ? (p / 1e4).toFixed(1) + '억' : '-';
const last = (a, ar) => a.filter(t => Math.abs(t.ar - ar) < 6).sort((x, y) => y.d.localeCompare(x.d))[0];
const list = [...cx.values()];
const live = list.filter(c => !c.moved).sort((a, b) => a.gu.localeCompare(b.gu) || (b.bu.length + b.ip.length) - (a.bu.length + a.ip.length));
const moved = list.filter(c => c.moved);
const S = [];
S.push(`# 입주 예정 아파트 시험 — ${GUS.length}개 시군구 · 최근 ${MONTHS}개월`);
S.push(`- 분양권·입주권 거래 ${silv.length}건 · 단지 ${cx.size}곳 → **입주 전 ${live.length}곳** (공사 중 ${live.filter(c => c.state === '공사 중').length} · 입주 중 ${live.filter(c => c.state === '입주 중').length}) · 이미 입주 ${moved.length}곳`);
S.push(`- 청약홈 맞춤 **${live.filter(c => c.ah).length}/${live.length}** · 청약홈 공고 ${Object.entries(ann).map(([s, a]) => `${SIDO[s]} ${a.length}`).join(' · ')} (${since}~)`);
if (stopSilv) S.push(`- ⚠ 분양권 조회 중단: ${stopSilv}`);
if (mdlErr) S.push(`- ⚠ 주택형 오류: ${mdlErr}`);
if (errs.length) S.push(`- ⚠ 오류 ${errs.length}건 (앞 5개): ${errs.slice(0, 5).join(' / ')}`);
S.push('', '| 시군구 | 단지(실거래) | 동 | 상태 | 분양권 | 입주권 | 84 분양권 | 84 입주권 | 청약홈 이름 | 입주예정 | 세대 | 84 분양가 |', '|---|---|---|---|---|---|---|---|---|---|---|---|');
for (const c of live) {
  const b = last(c.bu, 84), i = last(c.ip, 84), t84 = c.ah?.ty?.find(x => /^08[4-5]/.test(x.ty));
  S.push(`| ${c.sgg} | ${c.nm} | ${c.umd} ${c.jibun} | ${c.state} | ${c.bu.length} | ${c.ip.length} | ${b ? `${eok(b.p)} (${b.d.slice(2, 6)})` : '-'} | ${i ? `${eok(i.p)} (${i.d.slice(2, 6)})` : '-'} | ${c.ah?.nm || '❌'} | ${c.ah?.mv || ''} | ${c.ah?.hh || ''} | ${t84 ? eok(t84.top) : ''} |`);
}
S.push('', '<details><summary>이미 입주로 뺀 단지</summary>', '', moved.map(c => `${c.sgg} ${c.nm} (${c.moved})`).join(' · '), '</details>');
const md = S.join('\n');
console.log(md.slice(0, 3000));
if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, md.slice(0, 900000) + '\n');
await mkdir('data', { recursive: true });
await writeFile('data/presale-test.json', JSON.stringify({ at: new Date().toISOString(), gus: GUS, months: MONTHS, live, moved: moved.map(c => ({ sgg: c.sgg, nm: c.nm, why: c.moved })), errs: errs.slice(0, 50) }, null, 1));
