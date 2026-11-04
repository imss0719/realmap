// 11/4 시험: 아파트 신고가 — 구 하나의 2006년부터 아파트 매매 실거래로 '단지·평형별 역대 최고가를 넘은 최근 거래'를 찾음 (GitHub Actions에서 실행)
//   신고가 = 같은 단지(동+지번)·같은 전용면적(반올림 ㎡)에서, 그 전까지의 최고가보다 비싼 거래
//   빼는 거래: 해제된 거래 · 직거래(판단·비교 모두) · 그 전 거래가 3건 미만인 평형(새 단지 첫 거래들)
//   표시 기간 비교: 계약일 기준 최근 1·2·3개월 안의 신고가가 몇 단지에 붙는지
//   결과: data/newhigh-test-<구>.json + Actions 화면 요약표 (지도에는 아직 안 씀 — 시험용)
// 필요한 비밀값: DATA_GO_KR_KEY
import { writeFile, mkdir, appendFile } from 'node:fs/promises';
import { month, monthsBack } from '../api/trades.js';
import { num } from '../api/_lib.js';

const GU = String(process.env.GU || '11440').trim();
const MONTHS = +(process.env.MONTHS || 250);
const MIN_PRIOR = +(process.env.MIN_PRIOR || 3);
const DEADLINE = +(process.env.MINUTES || 50) * 60e3;
const t0 = Date.now(), late = () => Date.now() - t0 > DEADLINE;
const clean = s => String(s ?? '').trim();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
if (!process.env.DATA_GO_KR_KEY) { console.log('DATA_GO_KR_KEY 비밀값이 비어 있습니다.'); process.exit(1); }

// ① 실거래 (오래된 달부터)
const yms = monthsBack(MONTHS).reverse();
const raw = [], err = [];
for (const ym of yms) {
  if (late()) { err.push(`${ym}: 시간 초과로 중단`); break; }
  let got = null, e0 = '';
  for (let t = 0; t < 5 && !got; t++) {
    try { got = await month('apt', GU, ym); } catch (e) { e0 = e.message.slice(0, 80); await sleep(2000 * (t + 1)); }
  }
  if (got) raw.push(...got); else err.push(`${ym}: ${e0}`);
  await sleep(80);
  if (ym.endsWith('12')) log(`${ym} 까지 ${raw.length}건`);
}
log(`받은 거래 ${raw.length}건 · 못 받은 달 ${err.length}`);

// ② 정리 + 날짜순
const rows = [], skip = { 해제: 0, 직거래: 0, 값없음: 0 };
for (const x of raw) {
  if (clean(x.cdealType) === 'O' || clean(x.cdealDay)) { skip.해제++; continue; }
  const price = num(x.dealAmount), ar = num(x.excluUseAr), umd = clean(x.umdNm), jibun = clean(x.jibun);
  if (!price || !ar || !umd || !jibun) { skip.값없음++; continue; }
  const via = clean(x.dealingGbn);
  if (via === '직거래') { skip.직거래++; continue; }
  const d = `${x.dealYear}${String(x.dealMonth).padStart(2, '0')}${String(x.dealDay || '').padStart(2, '0')}`;
  rows.push({ key: `${umd}|${jibun}`, name: clean(x.aptNm), umd, jibun, ar, a: Math.round(ar), price, d, fl: clean(x.floor) });
}
rows.sort((p, q) => p.d.localeCompare(q.d));

// ③ 단지·평형별로 지나오며 최고가 갱신을 찾음
const st = new Map(), highs = [];
for (const r of rows) {
  const k = `${r.key}|${r.a}`;
  const s = st.get(k) || st.set(k, { max: 0, maxD: '', n: 0 }).get(k);
  if (s.n >= MIN_PRIOR && r.price > s.max) highs.push({ ...r, prev: s.max, prevD: s.maxD, prior: s.n, up: Math.round((r.price / s.max - 1) * 1000) / 10 });
  if (r.price > s.max) { s.max = r.price; s.maxD = r.d; }
  s.n++;
}
// 단지 이름은 가장 최근 이름으로
const lastName = new Map(); for (const r of rows) lastName.set(r.key, r.name);

// ④ 표시 기간별 (계약일 기준)
const today = new Date(Date.now() + 9 * 3600e3), ymd = d => d.toISOString().slice(0, 10).replace(/-/g, '');
const since = m => { const d = new Date(today); d.setUTCMonth(d.getUTCMonth() - m); return ymd(d); };
const win = {};
for (const m of [1, 2, 3]) {
  const from = since(m), hs = highs.filter(h => h.d >= from);
  const byCx = new Map();
  for (const h of hs) { const c = byCx.get(h.key) || byCx.set(h.key, { name: lastName.get(h.key) || h.name, umd: h.umd, jibun: h.jibun, list: [] }).get(h.key); c.list.push({ a: h.a, ar: h.ar, price: h.price, d: h.d, fl: h.fl, prev: h.prev, prevD: h.prevD, up: h.up }); }
  const dong = {}; for (const c of byCx.values()) dong[c.umd] = (dong[c.umd] || 0) + 1;
  win[m] = { from, deals: hs.length, complexes: byCx.size, dong, list: [...byCx.values()].sort((p, q) => q.list.length - p.list.length || p.umd.localeCompare(q.umd)) };
}
const cxAll = new Set(rows.filter(r => r.d >= since(6)).map(r => r.key)).size;   // 최근 6개월 거래가 있던 단지 수 (지도에 라벨이 뜨는 단지)

const out = { gu: GU, made: new Date().toISOString(), months: MONTHS, from: yms[0], to: yms[yms.length - 1], rule: { minPrior: MIN_PRIOR, area: '전용면적 반올림 ㎡', exclude: ['해제', '직거래'] }, raw: raw.length, used: rows.length, skip, err, cx6m: cxAll, highsTotal: highs.length, win };
await mkdir('data', { recursive: true });
await writeFile(`data/newhigh-test-${GU}.json`, JSON.stringify(out));

// ⑤ 요약표
const w = (s = '') => process.env.GITHUB_STEP_SUMMARY ? appendFile(process.env.GITHUB_STEP_SUMMARY, s + '\n') : Promise.resolve(console.log(s));
const won = v => v >= 10000 ? `${Math.floor(v / 10000)}억${v % 10000 ? ' ' + (v % 10000).toLocaleString() : ''}` : `${v.toLocaleString()}만`;
await w(`## 아파트 신고가 시험 · ${GU} (${yms[0]}~${yms[yms.length - 1]})`);
await w(`받은 거래 ${raw.length.toLocaleString()}건 · 쓴 거래 ${rows.length.toLocaleString()}건 · 해제 ${skip.해제} · 직거래 ${skip.직거래} · 못 받은 달 ${err.length}`);
await w(`최근 6개월 거래가 있는 단지(지도 라벨) ${cxAll}곳`);
await w('');
await w('| 표시 기간 | 신고가 거래 | ▲ 붙는 단지 | 라벨 중 비율 |'); await w('|---|---|---|---|');
for (const m of [1, 2, 3]) await w(`| ${m}개월 (${win[m].from}~) | ${win[m].deals} | ${win[m].complexes} | ${cxAll ? Math.round(win[m].complexes / cxAll * 100) : 0}% |`);
await w('');
await w('### 2개월 안 신고가 단지'); await w('| 동 | 단지 | 전용 | 신고가 | 계약일 | 이전 최고 | 이전 최고일 | 오름 |'); await w('|---|---|---|---|---|---|---|---|');
for (const c of win[2].list) for (const h of c.list) await w(`| ${c.umd} | ${c.name} | ${h.ar} | ${won(h.price)} | ${h.d} | ${won(h.prev)} | ${h.prevD} | +${h.up}% |`);
if (err.length) { await w(''); await w('못 받은 달: ' + err.slice(0, 20).join(' · ')); }
log('끝', JSON.stringify({ deals: [1, 2, 3].map(m => win[m].deals), cx: [1, 2, 3].map(m => win[m].complexes), cxAll }));
