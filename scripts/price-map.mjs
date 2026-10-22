// 동별 시세 지도 자료 만들기 (GitHub Actions에서 매주 실행)
// 국토부 실거래(아파트·연립다세대·오피스텔 매매)를 시군구별로 받아 법정동별로 묶고,
// 전용면적 ㎡당 거래가 중간값을 '최근 6개월'과 '1년 전 같은 6개월'로 비교합니다.
// 대상: 서울(11)·인천(28)·경기(41)·부산(26)
// 결과: data/price-<시도코드>.json  (화면은 이 파일만 읽으므로 리얼맵 서버 부담이 없습니다)
// 필요한 비밀값: DATA_GO_KR_KEY (공공데이터포털 인증키, Vercel과 같은 값)
import { writeFile, readFile } from 'node:fs/promises';
import { month, monthsBack } from '../api/trades.js';
import { pool, num } from '../api/_lib.js';

if (!process.env.DATA_GO_KR_KEY) { console.log('DATA_GO_KR_KEY 비밀값이 비어 있습니다.'); process.exit(1); }

// 시군구 목록은 data/sgg-<시도>.json(구별 경계)에서 읽습니다
// 행정구역이 바뀐 곳은 예전 코드로 신고된 거래도 받아서, 동 이름으로 새 구에 넣습니다
//   인천: 중구·동구 → 제물포구·영종구, 서구 → 서구·검단구 (2026.7)   화성시 → 만세·효행·병점·동탄구 (2026.2)
const SIDOS = ['11', '41', '28', '26'];   // 중요한 순서대로 (시간이 모자라면 뒤쪽은 지난번 자료를 그대로 둡니다)
const OLD = { '28': { '28110': ['28125', '28155'], '28140': ['28125'], '28260': ['28275', '28290'] }, '41': { '41590': ['41591', '41593', '41595', '41597'] } };
const KINDS = ['apt', 'rh', 'offi'];
// 전세가율용 전월세 (최근 6개월만): 월세 없는 신규 전세 계약의 보증금 ㎡당 중간값
const RENT = { aptRent: 'apt', rhRent: 'rh', offiRent: 'offi' };
const clean = s => String(s ?? '').trim();
const med = a => { if (!a.length) return null; a = [...a].sort((x, y) => x - y); const m = a.length >> 1; return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; };

// 최근 6개월 (이번 달은 신고가 덜 들어와 빼고 지난달부터), 그리고 1년 전 같은 6개월
const all = monthsBack(19);           // [이번달, 지난달, …]
const CUR = all.slice(1, 7), PREV = all.slice(13, 19);
const t0 = Date.now();
// 시간 제한: 공공데이터포털이 느린 날에도 워크플로(60분)가 끊기기 전에 끝내고, 받은 만큼은 저장합니다
const DEADLINE = Number(process.env.PM_MINUTES || 40) * 60e3;
const late = () => Date.now() - t0 > DEADLINE;
// '1년 전 같은 6개월' 자료는 한 달 동안 바뀌지 않으므로, 요약을 data/price-prev-<시도>.json에 보관해 두고
// 같은 기간이면 다시 받지 않습니다 (매주 요청 약 1/3 절약)
const PREV_KEY = PREV.join(',');

for (const sido of SIDOS) {
  const t1 = Date.now();
  let gus;
  try { gus = JSON.parse(await readFile(`data/sgg-${sido}.json`, 'utf8')).f; } catch { console.log(`[${sido}] 구 경계 파일이 없어 건너뜁니다`); continue; }
  const GUNM = Object.fromEntries(gus.map(f => [f.c, f.n]));
  const sggs = [...gus.map(f => f.c), ...Object.keys(OLD[sido] || {})];
  // 빌라·오피스텔 자료에는 법정동 코드(umdCd)가 없는 경우가 있어, 법정동 경계 파일의 이름으로 코드를 찾습니다
  const byName = {};
  try { for (const f of JSON.parse(await readFile(`data/umd-${sido}.json`, 'utf8')).f) byName[`${f.c.slice(0, 5)}|${f.n}`] = f.c; } catch { /* 경계 파일 없음 */ }
  const valid = new Set(Object.values(byName));
  if (late()) { console.log(`[${sido}] 시간이 모자라 이번에는 건너뜁니다 (지난번 자료 유지)`); continue; }
  let prevC = null;
  try { const c = JSON.parse(await readFile(`data/price-prev-${sido}.json`, 'utf8')); if (c.range === PREV_KEY) prevC = c; } catch { /* 없음 */ }
  const d = {};                        // 법정동 8자리 → { n, apt:{c:[], p:[]}, ... }
  const jobs = [];
  for (const sgg of sggs) for (const k of KINDS) for (const ym of prevC ? CUR : [...CUR, ...PREV]) jobs.push([sgg, k, ym]);
  for (const sgg of sggs) for (const k of Object.keys(RENT)) for (const ym of CUR) jobs.push([sgg, k, ym]);
  let fails = 0, prevFails = 0;
  const seen = new Set();              // 같은 거래가 옛 코드·새 코드로 두 번 오면 한 번만 셉니다
  const rs = await pool(jobs, 6, ([sgg, k, ym]) => { if (late()) throw new Error('시간 초과'); return month(k, sgg, ym); });
  rs.forEach((r, i) => {
    const [sgg, k, ym] = jobs[i];
    if (!r.ok) { fails++; if (PREV.includes(ym)) prevFails++; return; }
    const isCur = CUR.includes(ym);
    const succ = (OLD[sido] || {})[sgg];
    const base = RENT[k];                                                 // 전월세면 'apt' 등, 매매면 undefined
    for (const x of r.v) {
      if (clean(x.cdealType) === 'O' || clean(x.cdealDay)) continue;       // 해제된 거래
      const ex = num(x.excluUseAr);
      const price = base ? num(x.deposit) : num(x.dealAmount);
      if (!price || !ex || ex < 10) continue;
      if (base && (num(x.monthlyRent) > 0 || clean(x.contractType) === '갱신')) continue;   // 월세 낀 계약·갱신 계약 제외
      const nm = clean(x.umdNm);
      const key = [k, x.dealYear, x.dealMonth, x.dealDay, price, ex, clean(x.floor), nm, clean(x.jibun), clean(x.aptNm || x.mhouseNm || x.offiNm)].join('|');
      if (seen.has(key)) continue; seen.add(key);
      let emd = null;
      if (succ) { for (const g of succ) if (byName[`${g}|${nm}`]) { emd = byName[`${g}|${nm}`]; break; } }
      else {
        const ud = clean(x.umdCd), sc = clean(x.sggCd) || sgg;
        emd = /^\d{5}$/.test(ud) ? (sc + ud).slice(0, 8) : null;
        if (!emd || (valid.size && !valid.has(emd))) emd = byName[`${sgg}|${nm}`] || null;
      }
      if (!emd) continue;
      const e = d[emd] || (d[emd] = { n: nm, m: new Map() });
      // 전세가율은 '같은 단지·같은 평형'끼리만 비교합니다 (동 안에서 오래된 단지 매매 vs 새 단지 전세처럼 섞이면 100%를 넘는 왜곡이 생겨서)
      const kk = base || k, cname = clean(x.aptNm || x.mhouseNm || x.offiNm), jb = clean(x.jibun);
      const mkey = `${kk}|${cname}|${jb}|${Math.round(ex / 3)}`;
      if (base) {
        (e[base + 'J'] || (e[base + 'J'] = [])).push(price / ex);       // 전세 보증금 만원/㎡
        if (cname || jb) { const m = e.m.get(mkey) || (e.m.set(mkey, { s: [], j: [] }), e.m.get(mkey)); m.j.push(price / ex); }
        continue;
      }
      const b = e[k] || (e[k] = { c: [], p: [] });
      (isCur ? b.c : b.p).push(price / ex);                               // 만원/㎡(전용)
      if (isCur && (cname || jb)) { const m = e.m.get(mkey) || (e.m.set(mkey, { s: [], j: [] }), e.m.get(mkey)); m.s.push(price / ex); }
    }
  });
  // 같은 단지·평형 짝들의 전세가율 → 가중 중간값 (가중치 = 짝의 거래 수 중 작은 쪽)
  const pairs = (m, k) => { const out = []; for (const [key, v] of m) if (key.startsWith(k + '|') && v.s.length && v.j.length) out.push([med(v.j) / med(v.s) * 100, Math.min(v.s.length, v.j.length)]); return out; };
  const wmed = ps => { const a = [...ps].sort((x, y) => x[0] - y[0]), tot = a.reduce((t, p) => t + p[1], 0); let c = 0; for (const p of a) { c += p[1]; if (c >= tot / 2) return p[0]; } return null; };
  const jsumM = (arr, ps) => { const w = ps.reduce((t, p) => t + p[1], 0); return [Math.round(med(arr)), arr.length, w >= 3 ? Math.round(wmed(ps) * 10) / 10 : null, w]; };   // [전세 ㎡당, 건수, 같은 단지 전세가율(%), 짝 거래 수]
  // 실패가 많으면 이번 결과로 덮어쓰지 않습니다 (지난번 자료가 더 정확)
  if (fails > jobs.length * 0.15) { console.log(`[${sido}] 요청 ${jobs.length}건 중 ${fails}건 실패 → 지난번 자료를 그대로 둡니다`); continue; }
  // 동별 요약: [최근 중간값, 최근 건수, 1년 전 중간값, 1년 전 건수] — 1년 전 값은 보관해 둔 요약을 쓸 수 있음
  const prevOf = (src, key, k, b) => b.p.length ? [Math.round(med(b.p)), b.p.length] : (prevC && prevC[src][key] && prevC[src][key][k]) || [null, 0];
  const sumD = (key, k, b) => { const pv = prevOf('d', key, k, b); return [b.c.length ? Math.round(med(b.c)) : null, b.c.length, pv[0], pv[1]]; };
  const sumG = (key, k, b) => { const pv = prevOf('g', key, k, b); return [b.c.length ? Math.round(med(b.c)) : null, b.c.length, pv[0], pv[1]]; };
  // 구별 요약: 동별 값을 다시 평균내지 않고, 구 안의 모든 거래로 중간값을 냅니다
  const gu = {};
  for (const [emd, e] of Object.entries(d)) {
    const g = gu[emd.slice(0, 5)] || (gu[emd.slice(0, 5)] = { n: GUNM[emd.slice(0, 5)] || emd.slice(0, 5) });
    for (const k of KINDS) if (e[k]) { const b = g[k] || (g[k] = { c: [], p: [] }); b.c.push(...e[k].c); b.p.push(...e[k].p); }
    for (const k of KINDS) if (e[k + 'J']) { (g[k + 'J'] || (g[k + 'J'] = [])).push(...e[k + 'J']); (g[k + 'P'] || (g[k + 'P'] = [])).push(...pairs(e.m, k)); }
  }
  const gout = {};
  for (const [c, g] of Object.entries(gu)) { const o = { n: g.n }; for (const k of KINDS) { if (g[k]) o[k] = sumG(c, k, g[k]); if (g[k + 'J']) o[k + 'J'] = jsumM(g[k + 'J'], g[k + 'P'] || []); } gout[c] = o; }
  const out = {};
  for (const [emd, e] of Object.entries(d)) {
    const o = { n: e.n };
    for (const k of KINDS) { if (e[k]) o[k] = sumD(emd, k, e[k]); if (e[k + 'J']) o[k + 'J'] = jsumM(e[k + 'J'], pairs(e.m, k)); }
    out[emd] = o;
  }
  const json = { updated: new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10), cur: [CUR[CUR.length - 1], CUR[0]], prev: [PREV[PREV.length - 1], PREV[0]], unit: '만원/전용㎡', d: out, g: gout };
  await writeFile(`data/price-${sido}.json`, JSON.stringify(json));
  // 1년 전 요약 보관 (이번에 새로 받았고 거의 다 받았을 때만)
  if (!prevC && prevFails <= sggs.length * KINDS.length * PREV.length * 0.03) {
    const pd = {}, pg = {};
    for (const [emd, e] of Object.entries(d)) for (const k of KINDS) if (e[k] && e[k].p.length) (pd[emd] || (pd[emd] = {}))[k] = [Math.round(med(e[k].p)), e[k].p.length];
    for (const [c, g] of Object.entries(gu)) for (const k of KINDS) if (g[k] && g[k].p.length) (pg[c] || (pg[c] = {}))[k] = [Math.round(med(g[k].p)), g[k].p.length];
    await writeFile(`data/price-prev-${sido}.json`, JSON.stringify({ range: PREV_KEY, d: pd, g: pg }));
  }
  console.log(`[${sido}] 동 ${Object.keys(out).length}곳 · 1년 전 자료 ${prevC ? '보관본 사용' : '새로 받음'} · 요청 ${jobs.length}건 · 실패 ${fails}건 · ${Math.round((Date.now() - t1) / 1000)}초 (누적 ${Math.round((Date.now() - t0) / 1000)}초)`);
}
