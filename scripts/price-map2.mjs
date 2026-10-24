// 동별 시세 지도 — 토지·건물 자료 만들기 (GitHub Actions에서 매주 실행, 아파트 작업과 따로)
// 국토부 실거래 중 지번이 가려지는 거래(토지·단독·상가업무·공장창고 매매)를 시군구별로 받아 법정동별로 묶고,
// ㎡당 거래가 중간값을 '최근 1년'과 '그 전 1년'으로 비교합니다.
//   토지: 지목 '대'(대지)만, 거래면적 기준
//   단독·다가구 / 상업업무용 / 공장·창고: 대지면적 기준 (집합건물 = 상가 호실 등은 대지면적이 의미 없어 제외)
//   해제된 거래·지분 거래는 제외
// 대상: 서울(11)·경기(41)·인천(28)·부산(26)
// 결과: data/price2-<시도코드>.json  (화면은 '토지·건물' 칩을 눌렀을 때만 이 파일을 읽습니다)
// 필요한 비밀값: DATA_GO_KR_KEY (공공데이터포털 인증키, Vercel과 같은 값)
import { writeFile, readFile } from 'node:fs/promises';
import { KINDS as RT, monthsBack } from '../api/trades.js';
import { pool, num, dataGoKrAll } from '../api/_lib.js';
// 자료가 많아(경기 토지 등) 메모리에 쌓아 두지 않도록, 캐시 없이 한 달치씩 받아 바로 묶고 버립니다
const fetchMonth = (k, lawd, ym) => dataGoKrAll(RT[k].url, { LAWD_CD: lawd, DEAL_YMD: ym }, { pageSize: 1000, maxPages: 30 });

if (!process.env.DATA_GO_KR_KEY) { console.log('DATA_GO_KR_KEY 비밀값이 비어 있습니다.'); process.exit(1); }

const SIDOS = ['11', '41', '28', '26'];
const OLD = { '28': { '28110': ['28125', '28155'], '28140': ['28125'], '28260': ['28275', '28290'] }, '41': { '41590': ['41591', '41593', '41595', '41597'] } };
const KINDS = ['land', 'sh', 'nrg', 'indu'];
const clean = s => String(s ?? '').trim();
const med = a => { if (!a.length) return null; a = [...a].sort((x, y) => x - y); const m = a.length >> 1; return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; };

// 최근 1년 (이번 달은 신고가 덜 들어와 빼고 지난달부터 12개월), 그리고 그 전 1년
const all = monthsBack(25);
const CUR = all.slice(1, 13), PREV = all.slice(13, 25);
const PREV_KEY = PREV.join(',');
const t0 = Date.now();
const DEADLINE = Number(process.env.PM_MINUTES || 45) * 60e3;
const late = () => Date.now() - t0 > DEADLINE;

// 거래 한 건 → [법정동 이름, ㎡당 가격(만원)] 또는 null(제외)
function unit(k, x) {
  if (clean(x.cdealType) === 'O' || clean(x.cdealDay)) return null;           // 해제된 거래
  if (/지분/.test(clean(x.shareDealingType))) return null;                      // 지분 거래
  const price = num(x.dealAmount);
  if (!price) return null;
  let ar;
  if (k === 'land') { if (clean(x.jimok) !== '대') return null; ar = num(x.dealArea); }
  else {
    if ((k === 'nrg' || k === 'indu') && /집합/.test(clean(x.buildingType))) return null;
    ar = num(x.plottageAr);
  }
  if (!ar || ar < 10) return null;
  return price / ar;
}

for (const sido of SIDOS) {
  const t1 = Date.now();
  let gus;
  try { gus = JSON.parse(await readFile(`data/sgg-${sido}.json`, 'utf8')).f; } catch { console.log(`[${sido}] 구 경계 파일이 없어 건너뜁니다`); continue; }
  const GUNM = Object.fromEntries(gus.map(f => [f.c, f.n]));
  const sggs = [...gus.map(f => f.c), ...Object.keys(OLD[sido] || {})];
  const byName = {};
  try { for (const f of JSON.parse(await readFile(`data/umd-${sido}.json`, 'utf8')).f) byName[`${f.c.slice(0, 5)}|${f.n}`] = f.c; } catch { /* 경계 파일 없음 */ }
  const valid = new Set(Object.values(byName));
  if (late()) { console.log(`[${sido}] 시간이 모자라 이번에는 건너뜁니다 (지난번 자료 유지)`); continue; }
  // 지난번 결과 (이번에 실패한 종류는 지난번 값을 그대로 둡니다)
  let last = null;
  try { last = JSON.parse(await readFile(`data/price2-${sido}.json`, 'utf8')); } catch { /* 처음 */ }
  // '그 전 1년' 요약 보관본: 같은 기간이고 그 종류가 들어 있으면 다시 받지 않습니다
  let prevC = null;
  try { const c = JSON.parse(await readFile(`data/price2-prev-${sido}.json`, 'utf8')); if (c.range === PREV_KEY) prevC = c; } catch { /* 없음 */ }
  const hasPrev = k => !!(prevC && (prevC.kinds || []).includes(k));

  const jobs = [];
  for (const sgg of sggs) for (const k of KINDS) for (const ym of hasPrev(k) ? CUR : [...CUR, ...PREV]) jobs.push([sgg, k, ym]);
  const fails = {}, prevFails = {}, total = {};
  const d = {};
  const seen = new Set();
  const take = ([sgg, k, ym], v) => {
    const isCur = CUR.includes(ym);
    const succ = (OLD[sido] || {})[sgg];
    for (const x of v) {
      const u = unit(k, x);
      if (!u) continue;
      const nm = clean(x.umdNm);
      let emd = null;
      if (succ) { for (const g of succ) if (byName[`${g}|${nm}`]) { emd = byName[`${g}|${nm}`]; break; } }
      else {
        const ud = clean(x.umdCd), sc = clean(x.sggCd) || sgg;
        emd = /^\d{5}$/.test(ud) ? (sc + ud).slice(0, 8) : null;
        if (!emd || (valid.size && !valid.has(emd))) emd = byName[`${sgg}|${nm}`] || null;
      }
      if (!emd) continue;
      // 같은 거래가 옛 구 코드·새 구 코드로 두 번 오면 한 번만 셉니다 (동 코드까지 같아야 같은 거래로 봄)
      const key = [k, emd, x.dealYear, x.dealMonth, x.dealDay, x.dealAmount, x.dealArea, x.plottageAr, clean(x.jibun)].join('|');
      if (seen.has(key)) continue; seen.add(key);
      const e = d[emd] || (d[emd] = { n: nm });
      const b = e[k] || (e[k] = { c: [], p: [] });
      (isCur ? b.c : b.p).push(u);
    }
  };
  const rs = await pool(jobs, 6, async job => { if (late()) throw new Error('시간 초과'); take(job, await fetchMonth(job[1], job[0], job[2])); return 1; });
  rs.forEach((r, i) => {
    const [, k, ym] = jobs[i];
    total[k] = (total[k] || 0) + 1;
    if (!r.ok) { fails[k] = (fails[k] || 0) + 1; if (PREV.includes(ym)) prevFails[k] = (prevFails[k] || 0) + 1; }
  });
  const errs = {}; rs.forEach((r, i) => { if (!r.ok) { const k = jobs[i][1]; if (!errs[k]) errs[k] = String(r.e && r.e.message || r.e).slice(0, 120); } });
  if (Object.keys(errs).length) console.log(`[${sido}] 오류 예시 ${JSON.stringify(errs)}`);
  // 종류별로 실패가 많으면 그 종류는 이번 결과를 쓰지 않습니다 (예: 활용신청 승인 전)
  const ok = KINDS.filter(k => (fails[k] || 0) <= (total[k] || 0) * 0.15);
  const bad = KINDS.filter(k => !ok.includes(k));
  if (!ok.length) { console.log(`[${sido}] 모든 종류에서 실패가 많아 지난번 자료를 그대로 둡니다 ${JSON.stringify(fails)}`); continue; }

  const prevOf = (src, key, k, b) => b.p.length ? [Math.round(med(b.p)), b.p.length] : (hasPrev(k) && prevC[src][key] && prevC[src][key][k]) || [null, 0];
  const sum = (src, key, k, b) => { const pv = prevOf(src, key, k, b); return [b.c.length ? Math.round(med(b.c)) : null, b.c.length, pv[0], pv[1]]; };
  const gu = {};
  for (const [emd, e] of Object.entries(d)) {
    const g = gu[emd.slice(0, 5)] || (gu[emd.slice(0, 5)] = { n: GUNM[emd.slice(0, 5)] || emd.slice(0, 5) });
    for (const k of ok) if (e[k]) { const b = g[k] || (g[k] = { c: [], p: [] }); b.c.push(...e[k].c); b.p.push(...e[k].p); }
  }
  const out = {}, gout = {};
  for (const [emd, e] of Object.entries(d)) { const o = { n: e.n }; for (const k of ok) if (e[k]) o[k] = sum('d', emd, k, e[k]); out[emd] = o; }
  for (const [c, g] of Object.entries(gu)) { const o = { n: g.n }; for (const k of ok) if (g[k]) o[k] = sum('g', c, k, g[k]); gout[c] = o; }
  // 실패한 종류는 지난번 값을 옮겨 둡니다
  if (last && bad.length) {
    for (const [src, dst] of [['d', out], ['g', gout]]) for (const [c, e] of Object.entries(last[src] || {})) for (const k of bad) if (e[k]) (dst[c] || (dst[c] = { n: e.n }))[k] = e[k];
  }
  const kinds = [...ok, ...(last ? bad.filter(k => (last.kinds || []).includes(k)) : [])];
  const json = { updated: new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10), cur: [CUR[CUR.length - 1], CUR[0]], prev: [PREV[PREV.length - 1], PREV[0]], unit: '만원/㎡(대지)', kinds, d: out, g: gout };
  await writeFile(`data/price2-${sido}.json`, JSON.stringify(json));
  // 그 전 1년 요약 보관 (이번에 새로 받았고 거의 다 받은 종류만 보탬)
  const fresh = ok.filter(k => !hasPrev(k) && (prevFails[k] || 0) <= sggs.length * PREV.length * 0.03);
  if (fresh.length) {
    const pd = prevC ? prevC.d : {}, pg = prevC ? prevC.g : {};
    for (const [emd, e] of Object.entries(d)) for (const k of fresh) if (e[k] && e[k].p.length) (pd[emd] || (pd[emd] = {}))[k] = [Math.round(med(e[k].p)), e[k].p.length];
    for (const [c, g] of Object.entries(gu)) for (const k of fresh) if (g[k] && g[k].p.length) (pg[c] || (pg[c] = {}))[k] = [Math.round(med(g[k].p)), g[k].p.length];
    await writeFile(`data/price2-prev-${sido}.json`, JSON.stringify({ range: PREV_KEY, kinds: [...new Set([...(prevC ? prevC.kinds || [] : []), ...fresh])], d: pd, g: pg }));
  }
  console.log(`[${sido}] 동 ${Object.keys(out).length}곳 · 요청 ${jobs.length}건 · 실패 ${JSON.stringify(fails)}${bad.length ? ` · 이번에 못 받은 종류(지난번 값 유지): ${bad.join(',')}` : ''} · ${Math.round((Date.now() - t1) / 1000)}초 (누적 ${Math.round((Date.now() - t0) / 1000)}초)`);
}
