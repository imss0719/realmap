// 동별 시세 지도 자료 만들기 (GitHub Actions에서 매주 실행)
// 국토부 실거래(아파트·연립다세대·오피스텔 매매)를 시군구별로 받아 법정동별로 묶고,
// 전용면적 ㎡당 거래가 중간값을 '최근 6개월'과 '1년 전 같은 6개월'로 비교합니다.
// 결과: data/price-<시도코드>.json  (화면은 이 파일만 읽으므로 리얼맵 서버 부담이 없습니다)
// 필요한 비밀값: DATA_GO_KR_KEY (공공데이터포털 인증키, Vercel과 같은 값)
import { writeFile, readFile } from 'node:fs/promises';
import { month, monthsBack } from '../api/trades.js';
import { pool, num } from '../api/_lib.js';

if (!process.env.DATA_GO_KR_KEY) { console.log('DATA_GO_KR_KEY 비밀값이 비어 있습니다.'); process.exit(1); }

// 시도별 시군구 코드 (우선 서울)
const SIDO = {
  '11': ['11110', '11140', '11170', '11200', '11215', '11230', '11260', '11290', '11305', '11320', '11350', '11380', '11410', '11440', '11470', '11500', '11530', '11545', '11560', '11590', '11620', '11650', '11680', '11710', '11740'],
};
const KINDS = ['apt', 'rh', 'offi'];
const GUNM = { '11110': '종로구', '11140': '중구', '11170': '용산구', '11200': '성동구', '11215': '광진구', '11230': '동대문구', '11260': '중랑구', '11290': '성북구', '11305': '강북구', '11320': '도봉구', '11350': '노원구', '11380': '은평구', '11410': '서대문구', '11440': '마포구', '11470': '양천구', '11500': '강서구', '11530': '구로구', '11545': '금천구', '11560': '영등포구', '11590': '동작구', '11620': '관악구', '11650': '서초구', '11680': '강남구', '11710': '송파구', '11740': '강동구' };
const clean = s => String(s ?? '').trim();
const med = a => { if (!a.length) return null; a = [...a].sort((x, y) => x - y); const m = a.length >> 1; return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; };

// 최근 6개월 (이번 달은 신고가 덜 들어와 빼고 지난달부터), 그리고 1년 전 같은 6개월
const all = monthsBack(19);           // [이번달, 지난달, …]
const CUR = all.slice(1, 7), PREV = all.slice(13, 19);
const t0 = Date.now();

for (const [sido, sggs] of Object.entries(SIDO)) {
  // 빌라·오피스텔 자료에는 법정동 코드(umdCd)가 없는 경우가 있어, 법정동 경계 파일의 이름으로 코드를 찾습니다
  const byName = {};
  try { for (const f of JSON.parse(await readFile(`data/umd-${sido}.json`, 'utf8')).f) byName[`${f.c.slice(0, 5)}|${f.n}`] = f.c; } catch { /* 경계 파일 없음 */ }
  const d = {};                        // 법정동 8자리 → { n, apt:{c:[], p:[]}, ... }
  const jobs = [];
  for (const sgg of sggs) for (const k of KINDS) for (const ym of [...CUR, ...PREV]) jobs.push([sgg, k, ym]);
  let fails = 0;
  const rs = await pool(jobs, 4, ([sgg, k, ym]) => month(k, sgg, ym));
  rs.forEach((r, i) => {
    const [sgg, k, ym] = jobs[i];
    if (!r.ok) { fails++; return; }
    const isCur = CUR.includes(ym);
    for (const x of r.v) {
      if (clean(x.cdealType) === 'O' || clean(x.cdealDay)) continue;       // 해제된 거래
      const price = num(x.dealAmount), ex = num(x.excluUseAr);
      if (!price || !ex || ex < 10) continue;
      const ud = clean(x.umdCd), sc = clean(x.sggCd) || sgg;
      const emd = /^\d{5}$/.test(ud) ? (sc + ud).slice(0, 8) : byName[`${sgg}|${clean(x.umdNm)}`];
      if (!emd) continue;
      const e = d[emd] || (d[emd] = { n: clean(x.umdNm) });
      const b = e[k] || (e[k] = { c: [], p: [] });
      (isCur ? b.c : b.p).push(price / ex);                               // 만원/㎡(전용)
    }
  });
  // 동별 요약: [최근 중간값, 최근 건수, 1년 전 중간값, 1년 전 건수]
  const sum = b => [b.c.length ? Math.round(med(b.c)) : null, b.c.length, b.p.length ? Math.round(med(b.p)) : null, b.p.length];
  // 구별 요약: 동별 값을 다시 평균내지 않고, 구 안의 모든 거래로 중간값을 냅니다
  const gu = {};
  for (const [emd, e] of Object.entries(d)) {
    const g = gu[emd.slice(0, 5)] || (gu[emd.slice(0, 5)] = { n: GUNM[emd.slice(0, 5)] || emd.slice(0, 5) });
    for (const k of KINDS) if (e[k]) { const b = g[k] || (g[k] = { c: [], p: [] }); b.c.push(...e[k].c); b.p.push(...e[k].p); }
  }
  const gout = {};
  for (const [c, g] of Object.entries(gu)) { const o = { n: g.n }; for (const k of KINDS) if (g[k]) o[k] = sum(g[k]); gout[c] = o; }
  const out = {};
  for (const [emd, e] of Object.entries(d)) {
    const o = { n: e.n };
    for (const k of KINDS) if (e[k]) { const { c, p } = e[k]; o[k] = [c.length ? Math.round(med(c)) : null, c.length, p.length ? Math.round(med(p)) : null, p.length]; }
    out[emd] = o;
  }
  const json = { updated: new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10), cur: [CUR[CUR.length - 1], CUR[0]], prev: [PREV[PREV.length - 1], PREV[0]], unit: '만원/전용㎡', d: out, g: gout };
  await writeFile(`data/price-${sido}.json`, JSON.stringify(json));
  console.log(`[${sido}] 동 ${Object.keys(out).length}곳 · 요청 ${jobs.length}건 · 실패 ${fails}건 · ${Math.round((Date.now() - t0) / 1000)}초`);
  if (fails > jobs.length * 0.2) { console.log('실패가 많아 저장은 했지만 다음 실행 때 다시 받습니다.'); }
}
