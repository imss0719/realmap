// 11/2 입주 예정 아파트 (공사 중 · 입주 중) — 지도 라벨용 파일 만들기 (GitHub Actions에서 매일 실행)
//   ① 국토부 아파트 분양권전매 실거래 MONTHS개월 (ownershipGbn '입' = 입주권, 빈칸 = 분양권) → 단지별로 묶음
//   ② 이미 입주한 단지 빼기: 최근 2년 아파트 매매에 같은 이름 또는 같은 동+본번 · 청약홈 입주예정월이 12개월 넘게 지남
//   ③ 청약홈 분양정보와 짝이 맞는 단지만 (못 찾으면 뺌 — 11/2 선배) · 최근 1년 거래가 없으면 뺌
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
const yms = monthsBack(MONTHS + 1).slice(1);
const nowYm = monthsBack(1)[0];
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
  const md = `# 입주 예정 아파트 — 이번엔 갱신 안 함\n- 청약홈 공고를 받지 못했습니다: ${errs.slice(-1)[0] || ''}`;
  console.log(md); if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, md + '\n');
  process.exit(0);
}
const drop = { moved: 0, noah: 0, stale: 0, nogeo: [] };
const keep = [];
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
  if (aptName.has(`${c.gu}|${c.umd}|${k}`) || (!(mv > nowYm) && aptJb.has(`${c.gu}|${c.umd}|${bon(c.jibun)}`)) || (mv && mv <= ymMinus(nowYm, 12))) { drop.moved++; continue; }
  if (!best) { drop.noah++; continue; }
  if (!c.t.some(t => t.d >= recent)) { drop.stale++; continue; }
  c.ah = { no: best.HOUSE_MANAGE_NO, nm: clean(best.HOUSE_NM), addr: clean(best.HSSPLY_ADRES), mv, cn: clean(best.CNSTRCT_ENTRPS_NM), hh: num(best.TOT_SUPLY_HSHLDCO) };
  keep.push(c);
}
await pool(keep, 3, async c => {
  try { c.ah.ty = (await od('getAPTLttotPblancMdl', { 'HOUSE_MANAGE_NO::EQ': c.ah.no }, 100)).map(x => [Math.floor(num(String(x.HOUSE_TY).replace(/[^\d.]/g, ''))), num(x.LTTOT_TOP_AMOUNT)]).filter(x => x[0] > 10 && x[1] > 0); }
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
  const qs = [`${sd} ${c.sgg} ${c.umd} ${c.jibun}`, city !== c.sgg ? `${sd} ${city} ${c.umd} ${c.jibun}` : '', OLD[c.sgg] ? `${sd} ${OLD[c.sgg]} ${c.umd} ${c.jibun}` : '', cleanAddr(c.ah.addr)];
  for (const q of qs) { if (!q) continue; const ll = await kakao(q); if (ll && ll[0] > 33 && ll[0] < 39 && ll[1] > 124 && ll[1] < 132) { c.ll = geo[key] = ll; return; } }
});

// 결과 파일
const items = [];
for (const c of keep) {
  if (!c.ll) { drop.nogeo.push(`${c.sgg} ${c.nm}`); continue; }
  const by = new Map();
  for (const t of c.t) { const a = Math.floor(t.ar); if (a < 10) continue; const g = by.get(a) || by.set(a, { a, n: 0, b: null, i: null }).get(a); g.n++; const s = t.k === 'i' ? 'i' : 'b'; if (!g[s] || t.d > g[s][1]) g[s] = [t.p, t.d, t.f]; }
  const pa = [...by.values()].sort((x, y) => y.n - x.n).slice(0, 4).sort((x, y) => x.a - y.a).map(g => [g.a, g.b || 0, g.i || 0, g.n]);
  const h = c.t.slice().sort((x, y) => y.d.localeCompare(x.d)).slice(0, 12).map(t => [t.d, Math.floor(t.ar), t.k, t.p, t.f]);
  items.push({ n: c.ah.nm || c.nm, tn: c.nm, sgg: c.sgg, umd: c.umd, jb: c.jibun, lat: c.ll[0], lng: c.ll[1], mv: c.ah.mv, st: c.ah.mv && c.ah.mv <= nowYm ? 'in' : 'b', cn: c.ah.cn, hh: c.ah.hh, ty: c.ah.ty || [], pa, h, c: c.t.length });
}
items.sort((a, z) => z.c - a.c);
await writeFile('data/presale.json', JSON.stringify({ updated: new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10), months: MONTHS, items }));
await writeFile('data/presale-geo.json', JSON.stringify(geo));

const S = [`# 입주 예정 아파트 — 지도 파일 ${items.length}곳`,
  `- 분양권·입주권 거래 ${silv.length}건 · 단지 ${cx.size}곳`,
  `- 뺀 단지: 이미 입주 ${drop.moved} · 청약홈 짝 없음 ${drop.noah} · 최근 1년 거래 없음 ${drop.stale} · 위치 못 찾음 ${drop.nogeo.length}${drop.nogeo.length ? ` (${drop.nogeo.join(', ')})` : ''}`,
  `- 지역: ${Object.entries(SIDO).map(([s, n]) => `${n} ${items.filter(x => GUS.find(g => SGG[g] === x.sgg)?.startsWith(s)).length}`).join(' · ')}`,
  errs.length ? `- ⚠ 오류 ${errs.length}건 (앞 5개): ${errs.slice(0, 5).join(' / ')}` : '- 오류 없음'];
console.log(S.join('\n'));
if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, S.join('\n') + '\n');
