// 11/2 입주 예정 아파트 (공사 중 · 입주 중) — 지도 라벨용 파일 만들기 (GitHub Actions에서 매일 실행)
//   ① 국토부 아파트 분양권전매 실거래 MONTHS개월 (ownershipGbn '입' = 입주권, 빈칸 = 분양권) → 단지별로 묶음
//   ② 이미 입주한 단지 빼기: 최근 2년 아파트 매매에 같은 이름 또는 같은 동+본번 · 청약홈 입주예정월이 12개월 넘게 지남
//   ③ 청약홈 분양정보와 짝이 맞는 단지만 (못 찾으면 뺌 — 11/2 선배) · 최근 1년 거래가 없으면 뺌
//   ③-2 11/7 선배: 분양권 거래가 아직 없는 입주 예정 단지(전매제한 등)도 청약홈 공고로 지도에 — 입주예정 이번 달~36개월 안 · 임대·사전청약 빼고 · '분양권 거래 없음' 라벨
//   ④ 위치: 카카오 주소 검색 (한 번 찾은 좌표는 data/presale-geo.json에 기억)
//   결과: data/presale.json (지도) + Actions 화면 요약
// 필요한 비밀값: DATA_GO_KR_KEY · KAKAO_REST_KEY
import { readFile, writeFile, appendFile } from 'node:fs/promises';
import { monthsBack } from '../api/trades.js';
import { dataGoKrAll, num, DATA_KEY } from '../api/_lib.js';

const MONTHS = +(process.env.MONTHS || 36);
const CONC = +(process.env.CONC || 4);
const KAKAO = (process.env.KAKAO_REST_KEY || '').trim();
const B = 'https://apis.data.go.kr/1613000/';
const SILV = B + 'RTMSDataSvcSilvTrade/getRTMSDataSvcSilvTrade';
const APT = [B + 'RTMSDataSvcAptTradeDev/getRTMSDataSvcAptTradeDev', B + 'RTMSDataSvcAptTrade/getRTMSDataSvcAptTrade'];
const OD = 'https://api.odcloud.kr/api/ApplyhomeInfoDetailSvc/v1/';
const clean = s => String(s ?? '').trim();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const norm = s => clean(s).replace(/\(.*?\)|\[.*?\]/g, '').replace(/\s|　|아파트|APT|주상복합|[·,\-]/gi, '').toLowerCase();
const bon = j => clean(j).replace(/^산\s*/, '').split('-')[0];
if (!DATA_KEY) { console.log('DATA_GO_KR_KEY 비밀값이 비어 있습니다.'); process.exit(1); }

const SGG = {}, SIDO = { 11: '서울', 41: '경기', 28: '인천', 26: '부산', 27: '대구', 30: '대전', 36: '세종', 31: '울산', 12: '광주' }, SIDO_FULL = { 11: '서울특별시', 41: '경기도', 28: '인천광역시', 26: '부산광역시', 27: '대구광역시', 30: '대전광역시', 36: '세종특별자치시', 31: '울산광역시', 12: '광주광역시' };   // 11/2 부산·대구 추가
for (const r of ['11', '41', '28', '26', '27', '30', '36', '31', '12']) { try { for (const f of JSON.parse(await readFile(`data/sgg-${r}.json`, 'utf8')).f) SGG[f.c] = f.n; } catch { /* 없음 */ } }
const want = String(process.env.GUS || '수도권').split(/[,\s]+/).filter(Boolean);
const GUS = [...new Set(want.flatMap(w => w === '전체' ? Object.keys(SGG) : w === '수도권' ? Object.keys(SGG).filter(c => ['11', '41', '28'].includes(c.slice(0, 2))) : SIDO[w.slice(0, 2)] && w.length === 2 ? Object.keys(SGG).filter(c => c.startsWith(w)) : Object.values(SIDO).includes(w) ? Object.keys(SGG).filter(c => SIDO[c.slice(0, 2)] === w) : [w]))];
const FULL = want.length === 1 && want[0] === '전체';   // 11/7 구를 골라 수동 실행하면 확인만 (지도 파일을 그 구만으로 덮어쓰지 않게)
const yms = monthsBack(MONTHS + 1).slice(1);
const nowYm = monthsBack(1)[0];
const ymPlus = (ym, n) => { let y = +ym.slice(0, 4), m = +ym.slice(4) + n; while (m > 12) { m -= 12; y++; } return `${y}${String(m).padStart(2, '0')}`; };
const ymMinus = (ym, n) => { let y = +ym.slice(0, 4), m = +ym.slice(4) - n; while (m < 1) { m += 12; y--; } return `${y}${String(m).padStart(2, '0')}`; };
const recent = ymMinus(nowYm, 12) + '01';
const errs = [];

async function getAll(url, gu, ym) {
  for (let t = 0; t < 5; t++) {
    try { return await dataGoKrAll(url, { LAWD_CD: gu, DEAL_YMD: ym }, { pageSize: 1000, maxPages: 30 }); }
    catch (e) { if (t === 4 || /\(30\)|\(20\)|\(12\)|\(22\)|등록|NOT_REGISTERED|ACCESS_DENIED|SERVICE_KEY|LIMITED/i.test(e.message)) throw e; await sleep(2000 * (t + 1)); }
  }
}
async function pool(items, n, fn) { let i = 0; await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const x = items[i++]; await fn(x); } })); }
const jobs = list => GUS.flatMap(gu => list.map(ym => ({ gu, ym })));

// ① 분양권·입주권 실거래
const silv = [];
let stop = '';
await pool(jobs(yms), CONC, async ({ gu, ym }) => {
  if (stop) return;
  try { for (const r of await getAll(SILV, gu, ym)) silv.push({ gu, r }); }
  catch (e) { errs.push(`분양권 ${gu} ${ym}: ${e.message.slice(0, 120)}`); if (/\(30\)|\(22\)|LIMITED|등록/.test(e.message)) stop = e.message.slice(0, 160); }
});
log(`분양권·입주권 ${silv.length}건`);
// 조회가 막혀 자료가 크게 모자라면 예전 파일을 그대로 둠 (지도에서 단지가 갑자기 사라지지 않게)
if (stop || silv.length < 100) {
  const md = `# 입주 예정 아파트 — 이번엔 갱신 안 함\n- 분양권 자료 ${silv.length}건 · ${stop || '자료가 너무 적음'}\n- 지도 파일(data/presale.json)은 예전 것을 그대로 둡니다.`;
  console.log(md); if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, md + '\n');
  process.exit(0);
}

const cx = new Map();
for (const { gu, r } of silv) {
  if (clean(r.cdealType) === 'O' || clean(r.cdealDay)) continue;   // 해제 거래 제외
  const nm = clean(r.aptNm), umd = clean(r.umdNm);
  if (!nm) continue;
  const id = `${gu}|${umd}|${norm(nm)}`;
  let c = cx.get(id);
  if (!c) cx.set(id, c = { gu, sgg: SGG[gu] || gu, umd, nm, jibun: clean(r.jibun), t: [] });
  c.t.push({ d: `${r.dealYear}${String(r.dealMonth).padStart(2, '0')}${String(r.dealDay || '').padStart(2, '0')}`, ar: num(r.excluUseAr), p: num(r.dealAmount), f: clean(r.floor), k: clean(r.ownershipGbn).startsWith('입') ? 'i' : 'b' });
}

// ② 아파트 매매 (최근 2년)
const aptName = new Set(), aptJb = new Set();
let aptUrl = APT[0];
await pool(jobs(yms.slice(0, 24)), CONC, async ({ gu, ym }) => {
  let rows;
  try { rows = await getAll(aptUrl, gu, ym); }
  catch (e) {
    if (aptUrl === APT[0]) { aptUrl = APT[1]; try { rows = await getAll(aptUrl, gu, ym); } catch (e2) { errs.push(`매매 ${gu} ${ym}: ${e2.message.slice(0, 120)}`); return; } }
    else { errs.push(`매매 ${gu} ${ym}: ${e.message.slice(0, 120)}`); return; }
  }
  for (const r of rows) { aptName.add(`${r.sggCd || gu}|${clean(r.umdNm)}|${norm(r.aptNm)}`); aptName.add(`${gu}|${clean(r.umdNm)}|${norm(r.aptNm)}`); if (+clean(r.buildYear) >= +nowYm.slice(0, 4) - 2) aptJb.add(`${gu}|${clean(r.umdNm)}|${bon(r.jibun)}`); }   // 11/2 지번 비교는 새 아파트(최근 2년 안 준공) 매매만 — 같은 본번의 옛 아파트 때문에 힐스테이트 광명11이 빠졌던 문제
});

// ③ 청약홈
const ODLOG = [];   // 11/3 청약홈 응답 요약 (자료 말고 건수·코드만) — 못 받았을 때 이유 찾기용
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
    if (page === 1 && ODLOG.length < 12) ODLOG.push(`${op.replace('getAPTLttotPblanc', '')} ${Object.values(cond)[0]} → ${JSON.stringify(Object.fromEntries(Object.entries(j).filter(([k]) => k !== 'data')))} · data ${Array.isArray(j.data) ? j.data.length : typeof j.data}`.slice(0, 220));
    if (!Array.isArray(j.data)) throw new Error(`응답에 자료가 없음 · ${JSON.stringify(j).slice(0, 140)}`);   // 11/3 하루 사용량 초과 등은 200으로 와도 이유를 남김
    out.push(...j.data);
    if (!j.data || out.length >= (j.matchCount ?? j.totalCount ?? 0) || j.data.length < perPage) break;
  }
  return out;
}
const since = String(+nowYm.slice(0, 4) - 7) + '-01-01';
const ann = {};
for (const s of new Set(GUS.map(g => g.slice(0, 2)))) {
  try { ann[s] = await od('getAPTLttotPblancDetail', { 'SUBSCRPT_AREA_CODE_NM::EQ': SIDO[s], 'RCRIT_PBLANC_DE::GTE': since }); }
  catch (e) { ann[s] = []; errs.push(`청약홈 ${SIDO[s]}: ${e.message.slice(0, 160)}`); }
}
if (Object.values(ann).every(a => !a.length)) {   // 청약홈이 막히면 짝을 못 맞추니 예전 파일 유지
  const md = `# 입주 예정 아파트 — 이번엔 갱신 안 함\n- 청약홈 공고를 받지 못했습니다: ${errs.slice(-1)[0] || ''}\n- 청약홈 응답: ${ODLOG.slice(0, 6).join(' / ') || '없음'}\n- 분양권 ${silv.length}건 · 시도 ${Object.keys(ann).join(',')}`;
  console.log(md); if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, md + '\n');
  process.exit(0);
}
const drop = { moved: 0, noah: 0, stale: 0, nogeo: [] };
// 11/7 '왜 안 나오지?' 확인용: 수동 실행 때 WHY(단지 이름 일부)를 넣으면 그 단지가 어디서 빠졌는지 요약에 적음
const WHY = norm(process.env.WHY || ''), why = [];
const whyOf = (c, r) => { if (WHY && norm(c.nm).includes(WHY)) why.push(`${c.sgg} ${c.umd} ${c.nm} — 분양권·입주권 ${c.t.length}건 · 마지막 거래 ${c.t.map(t => t.d).sort().pop() || '-'} → ${r}`); };
const keep = [], used = new Set();
for (const c of cx.values()) {
  const all = ann[c.gu.slice(0, 2)] || [];
  const city = c.sgg.split(' ')[0];
  const k = norm(c.nm);
  const near = all.filter(a => { const ad = clean(a.HSSPLY_ADRES); return ad.includes(c.umd) || ad.includes(city); });
  const same = a => norm(a.HOUSE_NM) === k;
  const part = a => { const h = norm(a.HOUSE_NM); return h && k && h.length > 2 && k.length > 2 && (h.includes(k) || k.includes(h)); };
  const byJb = a => { const ad = clean(a.HSSPLY_ADRES); return ad.includes(c.umd) && new RegExp(`(^|\\s)${bon(c.jibun)}(\\s|-|번|$)`).test(ad); };
  const best = near.find(same) || near.find(part) || near.find(byJb) || all.find(same);
  const mv = best ? clean(best.MVN_PREARNGE_YM) : '';
  if (best) used.add(clean(best.HOUSE_MANAGE_NO));
  if (aptName.has(`${c.gu}|${c.umd}|${k}`) || (!(mv > nowYm) && aptJb.has(`${c.gu}|${c.umd}|${bon(c.jibun)}`)) || (mv && mv <= ymMinus(nowYm, 12))) { drop.moved++; whyOf(c, `이미 입주한 단지로 보고 뺌 (매매 실거래에 같은 이름·지번 있음 또는 입주예정 ${mv || '-'})`); continue; }
  if (!best) { drop.noah++; whyOf(c, '청약홈 분양공고와 짝을 못 찾아 뺌'); continue; }
  if (!c.t.some(t => t.d >= recent)) { drop.stale++; whyOf(c, '최근 1년 거래가 없어 뺌'); continue; }
  whyOf(c, `지도에 나옴 (청약홈: ${best.HOUSE_NM} · 입주예정 ${mv})`);
  c.ah = { no: best.HOUSE_MANAGE_NO, nm: clean(best.HOUSE_NM), addr: clean(best.HSSPLY_ADRES), mv, cn: clean(best.CNSTRCT_ENTRPS_NM), hh: num(best.TOT_SUPLY_HSHLDCO) };
  keep.push(c);
}
// ③-2 분양권 거래가 아직 없는 입주 예정 단지 (청약홈 공고만 있음)
const NT_MONTHS = +(process.env.NT_MONTHS || 36);
const ntDrop = { rent: 0, far: 0, dup: 0, nogu: 0 };
const YJ = /중산동|운서동|운남동|운북동|을왕동|남북동|덕교동|무의동/;   // 2026.7 영종구
const guOf = (s, ad) => {
  let g = Object.keys(SGG).filter(c => c.startsWith(s) && GUS.includes(c) && SGG[c].split(' ').every(w => ad.includes(w + ' '))).sort((a, z) => SGG[z].length - SGG[a].length)[0];
  if (!g && s === '28' && /인천광역시 (중구|동구) /.test(ad)) { const nm = YJ.test(ad) ? '영종구' : '제물포구'; g = Object.keys(SGG).find(c => SGG[c] === nm && GUS.includes(c)); }
  return g;
};
const ntGrp = new Map();
for (const [s, all] of Object.entries(ann)) {
  for (const a of all) {
    const nm = clean(a.HOUSE_NM), mv = clean(a.MVN_PREARNGE_YM), ad = clean(a.HSSPLY_ADRES), k = norm(nm);
    const wy = r => { if (WHY && k.includes(WHY)) why.push(`청약홈 공고 ${nm} (${ad} · 입주예정 ${mv || '-'}) → ${r}`); };
    if (!k) continue;
    if (used.has(clean(a.HOUSE_MANAGE_NO))) { wy('분양권 거래가 있는 단지로 이미 처리됨'); continue; }
    if ((clean(a.RENT_SECD) && clean(a.RENT_SECD) !== '0') || (clean(a.HOUSE_SECD) && clean(a.HOUSE_SECD) !== '01') || /임대|행복주택/.test(nm)) { ntDrop.rent++; wy('임대·사전청약 등 분양이 아닌 공고라 뺌'); continue; }
    if (!(mv >= nowYm && mv <= ymPlus(nowYm, NT_MONTHS))) { ntDrop.far++; wy(`입주예정 ${mv || '-'}가 이번 달~${NT_MONTHS}개월 밖이라 뺌`); continue; }
    const gu = guOf(s, ad + ' ');
    if (!gu) { ntDrop.nogu++; wy('주소에서 구를 못 찾아 뺌 (이번 실행 범위 밖일 수 있음)'); continue; }
    const umd = (ad.slice(ad.indexOf(SGG[gu].split(' ').pop()) + SGG[gu].split(' ').pop().length).match(/[가-힣0-9]+(동|읍|면|가)(?=\s|$)/) || [''])[0];
    const id = `${gu}|${norm(nm.replace(/\d+차$|[A-Z]?\d+-?\d*BL$/i, ''))}`;
    if (aptName.has(`${gu}|${umd}|${k}`)) { wy('매매 실거래에 같은 이름이 있어 이미 입주한 단지로 보고 뺌'); continue; }
    const o = ntGrp.get(id);
    if (o) { ntDrop.dup++; if (clean(a.RCRIT_PBLANC_DE) > o.pd) Object.assign(o, { no: clean(a.HOUSE_MANAGE_NO), pd: clean(a.RCRIT_PBLANC_DE), mv }); o.hh = clean(a.HOUSE_NM) === o.nm ? Math.max(o.hh, num(a.TOT_SUPLY_HSHLDCO)) : o.hh + num(a.TOT_SUPLY_HSHLDCO); o.nos.push(clean(a.HOUSE_MANAGE_NO)); continue; }
    // 같은 동·비슷한 이름으로 분양권 거래가 있는 단지가 있으면 그쪽이 맞는 단지 (이름 표기가 달라 짝을 못 맞춘 경우)
    if ([...cx.values()].some(c => c.gu === gu && c.umd === umd && (norm(c.nm).includes(k) || k.includes(norm(c.nm))) && Math.min(k.length, norm(c.nm).length) > 2)) { wy('같은 동에 비슷한 이름으로 분양권 거래가 있어 그쪽 단지로 봄'); continue; }
    wy('분양권 거래 없음 단지로 지도에 나옴');
    ntGrp.set(id, { no: clean(a.HOUSE_MANAGE_NO), nos: [clean(a.HOUSE_MANAGE_NO)], pd: clean(a.RCRIT_PBLANC_DE), nm, ad, mv, gu, umd, cn: clean(a.CNSTRCT_ENTRPS_NM), hh: num(a.TOT_SUPLY_HSHLDCO) });
  }
}
for (const g of ntGrp.values()) {
  const jb = (g.ad.slice(g.ad.indexOf(g.umd) + g.umd.length).match(/^\s+((산\s*)?\d+(-\d+)?)(?=\s|$|번)/) || ['', ''])[1];
  keep.push({ nt: 1, gu: g.gu, sgg: SGG[g.gu] || g.gu, umd: g.umd, nm: g.nm, jibun: jb, t: [], nos: g.nos, ah: { no: g.no, nm: g.nm, addr: g.ad, mv: g.mv, cn: g.cn, hh: g.hh } });
}
log(`거래 없는 입주 예정 ${ntGrp.size}곳`);
await pool(keep, 3, async c => {
  try { c.ah.ty = (await Promise.all((c.nos || [c.ah.no]).slice(0, 4).map(no => od('getAPTLttotPblancMdl', { 'HOUSE_MANAGE_NO::EQ': no }, 100)))).flat().map(x => [Math.floor(num(String(x.HOUSE_TY).replace(/[^\d.]/g, ''))), num(x.LTTOT_TOP_AMOUNT)]).filter(x => x[0] > 10 && x[1] > 0); }
  catch (e) { c.ah.ty = []; errs.push(`주택형 ${c.ah.nm}: ${e.message.slice(0, 100)}`); }
});

// ④ 위치 (카카오 주소 검색 · 기억)
let geo = {};
try { geo = JSON.parse(await readFile('data/presale-geo.json', 'utf8')); } catch { /* 처음 */ }
const OLD = { 검단구: '서구', 영종구: '중구', 제물포구: '중구' };   // 2026.7 인천 행정구역 개편 전 이름 (카카오 주소가 아직 예전 이름일 수 있음)
async function kakao(q) {
  if (!KAKAO || !q) return null;
  try {
    const r = await fetch('https://dapi.kakao.com/v2/local/search/address.json?query=' + encodeURIComponent(q), { headers: { Authorization: 'KakaoAK ' + KAKAO } });
    const d = (await r.json()).documents?.[0];
    return d ? [+(+d.y).toFixed(6), +(+d.x).toFixed(6)] : null;
  } catch { return null; }
}
const cleanAddr = a => clean(a).replace(/\(.*?\)/g, ' ').split(/[,，]/)[0].replace(/\s*(일원|일대|외\s*\d+\s*필지|번지).*$/, '').replace(/\s+/g, ' ').trim();
await pool(keep, 4, async c => {
  const key = `${c.gu}|${c.umd}|${norm(c.nm)}`;
  if (geo[key]) { c.ll = geo[key]; return; }
  const sd = SIDO_FULL[c.gu.slice(0, 2)], city = c.sgg.split(' ')[0];
  const qs = c.nt ? [cleanAddr(c.ah.addr), c.jibun ? `${sd} ${c.sgg} ${c.umd} ${c.jibun}` : ''] : [`${sd} ${c.sgg} ${c.umd} ${c.jibun}`, city !== c.sgg ? `${sd} ${city} ${c.umd} ${c.jibun}` : '', OLD[c.sgg] ? `${sd} ${OLD[c.sgg]} ${c.umd} ${c.jibun}` : '', cleanAddr(c.ah.addr)];
  for (const q of qs) { if (!q) continue; const ll = await kakao(q); if (ll && ll[0] > 33 && ll[0] < 39 && ll[1] > 124 && ll[1] < 132) { c.ll = geo[key] = ll; return; } }
});

// 결과 파일
const items = [];
for (const c of keep) {
  if (!c.ll) { drop.nogeo.push(`${c.sgg} ${c.nm}${c.nt ? '(거래 없음)' : ''}`); continue; }
  const by = new Map();
  for (const t of c.t) { const a = Math.floor(t.ar); if (a < 10) continue; const g = by.get(a) || by.set(a, { a, n: 0, b: null, i: null }).get(a); g.n++; const s = t.k === 'i' ? 'i' : 'b'; if (!g[s] || t.d > g[s][1]) g[s] = [t.p, t.d, t.f]; }
  const pa = [...by.values()].sort((x, y) => y.n - x.n).slice(0, 4).sort((x, y) => x.a - y.a).map(g => [g.a, g.b || 0, g.i || 0, g.n]);
  const h = c.t.slice().sort((x, y) => y.d.localeCompare(x.d)).slice(0, 12).map(t => [t.d, Math.floor(t.ar), t.k, t.p, t.f]);
  items.push({ n: c.ah.nm || c.nm, tn: c.nm, sgg: c.sgg, umd: c.umd, jb: c.jibun, lat: c.ll[0], lng: c.ll[1], mv: c.ah.mv, st: c.ah.mv && c.ah.mv <= nowYm ? 'in' : 'b', cn: c.ah.cn, hh: c.ah.hh, ty: c.ah.ty || [], pa, h, c: c.t.length, ...(c.nt ? { nt: 1 } : {}) });
}
items.sort((a, z) => z.c - a.c);
if (FULL) await writeFile('data/presale.json', JSON.stringify({ updated: new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10), months: MONTHS, items }));
if (FULL) await writeFile('data/presale-geo.json', JSON.stringify(geo));

const S = [`# 입주 예정 아파트 — 지도 파일 ${items.length}곳${FULL ? '' : ' (구를 골라 돌린 확인용 실행이라 지도 파일은 바꾸지 않았습니다)'}`,
  `- 분양권 거래 없는 입주 예정 단지 ${items.filter(x => x.nt).length}곳 포함 (청약홈 공고 · 입주예정 ${NT_MONTHS}개월 안) · 뺀 공고: 임대·사전청약 ${ntDrop.rent} · 입주예정 범위 밖 ${ntDrop.far} · 같은 단지 다른 공고 ${ntDrop.dup} · 범위 밖 지역 ${ntDrop.nogu}`,
  `- 분양권·입주권 거래 ${silv.length}건 · 단지 ${cx.size}곳`,
  `- 뺀 단지: 이미 입주 ${drop.moved} · 청약홈 짝 없음 ${drop.noah} · 최근 1년 거래 없음 ${drop.stale} · 위치 못 찾음 ${drop.nogeo.length}${drop.nogeo.length ? ` (${drop.nogeo.slice(0, 20).join(', ')}${drop.nogeo.length > 20 ? ' 외' : ''})` : ''}`,

  `- 지역: ${Object.entries(SIDO).map(([s, n]) => `${n} ${items.filter(x => GUS.find(g => SGG[g] === x.sgg)?.startsWith(s)).length}`).join(' · ')}`,
  errs.length ? `- ⚠ 오류 ${errs.length}건 (앞 5개): ${errs.slice(0, 5).join(' / ')}` : '- 오류 없음'];
console.log(S.join('\n'));
if (WHY) S.push(`## 확인: ${process.env.WHY}`, ...(why.length ? why.map(x => '- ' + x) : [`- 최근 ${MONTHS}개월 분양권·입주권 실거래에도, 청약홈 공고에도 이 이름이 없습니다 → 이름을 짧게 바꿔 다시 확인해 주세요`]));
if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, S.join('\n') + '\n');
