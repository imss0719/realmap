// 11/1 시험: 토지·건물(상가·업무, 공장·창고, 단독·다가구) 실거래가 지도 위치 맞추기 — 마포구 (GitHub Actions에서 실행)
//   국토부 공개 실거래는 이 종류들의 지번 일부를 가림(예: '6**'). 그래서 같은 동의 건물·필지 목록과 맞춰 봄.
//   ① 실거래 MONTHS개월 (상업업무용 nrg · 공장창고 indu · 단독다가구 sh · 토지 land)
//   ② 건물 거래: 건축물대장 표제부를 동 단위로 받아 [가려진 지번 범위 + 대지면적 ±1% + 연면적 ±1% + 건축연도] 가 맞는 필지
//   ③ 토지 거래: 브이월드 토지특성(대장 면적·지목)을 동 단위로 → 안 되면 연속지적도 경계로 면적 계산 → [지번 범위 + 지목 + 면적]
//   ④ 후보가 딱 하나일 때만 '맞춤'. 맞춘 필지 좌표는 연속지적도 중심점.
//   결과: data/landtrade-test-<구>.json + Actions 화면 요약표 (지도에는 아직 안 씀 — 시험용)
// 필요한 비밀값: DATA_GO_KR_KEY · VWORLD_KEY (VWORLD_DOMAIN은 작업 파일에서 https://realmap.online)
import { readFile, writeFile, mkdir, appendFile } from 'node:fs/promises';
import { month, monthsBack } from '../api/trades.js';
import { dataGoKr, vworldData, vworldNed, num } from '../api/_lib.js';

const GU = String(process.env.GU || '11440').trim();
const MONTHS = +(process.env.MONTHS || 60);
const DEADLINE = +(process.env.MINUTES || 50) * 60e3;
const HUB = 'https://apis.data.go.kr/1613000/BldRgstHubService/';
const t0 = Date.now();
const late = () => Date.now() - t0 > DEADLINE;
const clean = s => String(s ?? '').trim();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
if (!process.env.DATA_GO_KR_KEY) { console.log('DATA_GO_KR_KEY 비밀값이 비어 있습니다.'); process.exit(1); }
const HAS_VW = !!process.env.VWORLD_KEY && process.env.SKIP_VW !== '1';
const KAKAO = (process.env.KAKAO_REST_KEY || '').trim();
const GU_NAME = { 11110: '종로구', 11140: '중구', 11170: '용산구', 11200: '성동구', 11215: '광진구', 11230: '동대문구', 11260: '중랑구', 11290: '성북구', 11305: '강북구', 11320: '도봉구', 11350: '노원구', 11380: '은평구', 11410: '서대문구', 11440: '마포구', 11470: '양천구', 11500: '강서구', 11530: '구로구', 11545: '금천구', 11560: '영등포구', 11590: '동작구', 11620: '관악구', 11650: '서초구', 11680: '강남구', 11710: '송파구', 11740: '강동구' }[GU] || '';
const calls = { trade: 0, bld: 0, ned: 0, vw: 0, kakao: 0 };

// 지목 이름 → 지적도 한 글자
const JIMOK = { 전: '전', 답: '답', 과수원: '과', 목장용지: '목', 임야: '임', 광천지: '광', 염전: '염', 대: '대', 공장용지: '장', 학교용지: '학', 주차장: '차', 주유소용지: '주', 창고용지: '창', 도로: '도', 철도용지: '철', 제방: '제', 하천: '천', 구거: '구', 유지: '유', 양어장: '양', 수도용지: '수', 공원: '공', 체육용지: '체', 유원지: '원', 종교용지: '종', 사적지: '사', 묘지: '묘', 잡종지: '잡' };

// 동 이름 → 법정동 5자리 (data/umd-11.json)
const umdCode = {};
try { for (const f of JSON.parse(await readFile('data/umd-11.json', 'utf8')).f) if (f.c.startsWith(GU)) umdCode[f.n] = (f.c.slice(5) + '00').slice(0, 5); } catch { /* 없음 */ }

// ① 실거래
const KINDS = ['nrg', 'indu', 'sh', ...(process.env.LAND === '1' ? ['land'] : [])];   // 11/2 토지는 브이월드가 해외 서버를 막아 기본 제외 (LAND=1 이면 시도)
const yms = monthsBack(MONTHS + 1).slice(1);
const trades = [], tradeErr = [];
for (const kind of KINDS) {
  for (const ym of yms) {
    if (late()) break;
    calls.trade++;
    let got = null, err = '';
    for (let t = 0; t < 5 && !got; t++) {   // 11/2 고침: '초당 요청 제한'에 걸리면 쉬었다가 다시 (2025년 8개월이 빠졌던 문제)
      try { got = await month(kind, GU, ym); }
      catch (e) { err = e.message.slice(0, 80); await sleep(2000 * (t + 1)); }
    }
    if (got) for (const r of got) trades.push({ kind, ym, r });
    else tradeErr.push(`${kind} ${ym}: ${err}`);
    await sleep(80);
  }
  log(`실거래 ${kind} 누적 ${trades.length}건`);
}

// 거래 한 줄 정리 + 빼는 이유
const rows = [];
const skip = {};
const why = (k, t) => { skip[k] ||= {}; skip[k][t] = (skip[k][t] || 0) + 1; };
for (const { kind, r } of trades) {
  if (clean(r.cdealType) === 'O' || clean(r.cdealDay)) { why(kind, '해제'); continue; }
  if (/지분/.test(clean(r.shareDealingType))) { why(kind, '지분거래'); continue; }
  if (kind === 'nrg' && /집합/.test(clean(r.buildingType))) { why(kind, '집합건물(구분상가)'); continue; }
  const umd = clean(r.umdNm), bj = clean(r.umdCd) || umdCode[umd];
  const jb = clean(r.jibun).replace(/^산\s*/, '').replace(/\s/g, '');
  if (!bj || !jb) { why(kind, '동·지번 없음'); continue; }
  const [bunM, jiM] = jb.split('-');
  rows.push({
    kind, umd, bj, jb, san: /^산/.test(clean(r.jibun)),
    bunRe: new RegExp('^' + bunM.replace(/\*/g, '\\d') + '$'), jiRe: jiM ? new RegExp('^' + jiM.replace(/\*/g, '\\d') + '$') : null,
    plat: num(r.plottageAr), gfa: num(r.totalFloorAr) || num(r.buildingAr), area: num(r.dealArea), yb: clean(r.buildYear),
    jimok: clean(r.jimok), price: num(r.dealAmount), date: `${r.dealYear}.${String(r.dealMonth).padStart(2, '0')}`, ymd: `${r.dealYear}${String(r.dealMonth).padStart(2, '0')}${String(r.dealDay || '').padStart(2, '0')}`, use: clean(r.buildingUse), via: clean(r.dealingGbn),
  });
}
log(`정리 후 ${rows.length}건`);

// ② 건물 목록 (동 단위 표제부) — 필지(본번-부번)마다 대지면적·주건축물 연면적 합·사용승인 연도
const bldNote = [], bldStat = [];
const bldByDong = {};
async function bldList(bj) {
  if (bldByDong[bj]) return bldByDong[bj];
  const out = new Map(); let ok = false, err = '', got = 0, tot0 = 0;
  for (let p = 1; p <= 300 && !late(); p++) {
    calls.bld++;
    let r;
    for (let t = 0; t < 4 && !r; t++) {   // 11/1 고침: 중간 쪽이 한 번 실패하면 그 동을 일부만 받던 문제 → 4번까지 다시 시도
      try { r = await dataGoKr(HUB + 'getBrTitleInfo', { sigunguCd: GU, bjdongCd: bj, numOfRows: 1000, pageNo: p, _type: 'json' }); }
      catch (e) { err = e.message.slice(0, 120); await sleep(1500 * (t + 1)); }
    }
    if (!r) { if (ok) bldNote.push(`${bj}: ${p}쪽에서 끊김 — ${err}`); break; }
    ok = true; tot0 = r.total || tot0;
    for (const t of r.items) {
      if (clean(t.mainAtchGbCdNm) && !/주건축물/.test(clean(t.mainAtchGbCdNm))) continue;
      const bun = String(+clean(t.bun) || 0), ji = String(+clean(t.ji) || 0), san = clean(t.platGbCd) === '1';
      const k = `${san ? '산' : ''}${bun}-${ji}`;
      const e = out.get(k) || { bun, ji, san, plat: 0, tot: 0, ys: new Set(), n: 0 };
      e.plat = Math.max(e.plat, num(t.platArea)); e.tot += num(t.totArea); e.n++;
      const y = clean(t.useAprDay).slice(0, 4); if (y) e.ys.add(y);
      out.set(k, e);
    }
    got += r.items.length;
    if (!r.items.length || got >= (r.total || 0)) break;   // 11/1 고침: 한 쪽에 실제로 온 줄 수로 셈 (1쪽 최대가 1,000보다 작아 일부만 받던 문제)
    await sleep(80);
  }
  bldStat.push(`${bj}: ${got}/${tot0}줄`);
  if (!ok) bldNote.push(`${bj}: 동 단위 조회 실패 — ${err}`);
  return (bldByDong[bj] = { ok, list: [...out.values()] });
}
const near = (a, b, tol) => a > 0 && b > 0 && Math.abs(a - b) / b <= tol;

// ③ 토지 목록: 토지특성(대장 면적) → 안 되면 연속지적도 경계 면적
const landByDong = {}, landNote = [];
function ringArea(ring) {   // 경위도 → 미터 근사 후 신발끈 공식
  const lat0 = ring.reduce((s, p) => s + p[1], 0) / ring.length * Math.PI / 180;
  const kx = 111320 * Math.cos(lat0), ky = 110540;
  let a = 0; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += (ring[j][0] * kx) * (ring[i][1] * ky) - (ring[i][0] * kx) * (ring[j][1] * ky);
  return Math.abs(a) / 2;
}
function geomArea(g) {
  const polys = g?.type === 'Polygon' ? [g.coordinates] : g?.type === 'MultiPolygon' ? g.coordinates : [];
  return polys.reduce((s, poly) => s + ringArea(poly[0]) - poly.slice(1).reduce((h, r) => h + ringArea(r), 0), 0);
}
function centroid(g) {
  const ring = (g?.type === 'Polygon' ? g.coordinates : g?.type === 'MultiPolygon' ? g.coordinates[0] : [])[0] || [];
  if (!ring.length) return null;
  return { lng: +(ring.reduce((s, p) => s + p[0], 0) / ring.length).toFixed(6), lat: +(ring.reduce((s, p) => s + p[1], 0) / ring.length).toFixed(6) };
}
async function landList(bj) {
  if (landByDong[bj]) return landByDong[bj];
  const pre = GU + bj, out = []; let src = '';
  // 3-1 토지특성 (동 단위가 되는지 시험)
  if (HAS_VW) {
    try {
      calls.ned++;
      const f = await vworldNed('getLandCharacteristics', { pnu: pre, stdrYear: String(new Date().getFullYear() - 1), numOfRows: 1000, pageNo: 1 });
      if (Array.isArray(f) && f.length > 50) { src = '토지특성'; landNote.push(`${bj}: 토지특성 동 단위 조회 됨 (${f.length}건 첫 쪽)`); }
      else landNote.push(`${bj}: 토지특성 동 단위 조회 결과 ${Array.isArray(f) ? f.length : '없음'}건 → 연속지적도로`);
    } catch (e) { landNote.push(`${bj}: 토지특성 동 단위 실패 — ${e.message.slice(0, 80)}`); }
  }
  // 3-2 연속지적도 (경계 → 면적 · 지번 끝 글자 = 지목)
  if (HAS_VW) {
    for (let p = 1; p <= 40 && !late(); p++) {
      calls.vw++;
      let fs;
      try { fs = await vworldData({ data: 'LP_PA_CBND_BUBUN', attrFilter: `pnu:like:${pre}`, size: '1000', page: String(p) }); }
      catch (e) { landNote.push(`${bj}: 연속지적도 실패 — ${e.message.slice(0, 80)}`); break; }
      for (const f of fs) {
        const pr = f.properties || {}, pnu = String(pr.pnu || '');
        if (pnu.length !== 19) continue;
        const m = /([가-힣])\s*$/.exec(clean(pr.jibun));
        out.push({ pnu, san: pnu[10] === '2', bun: String(+pnu.slice(11, 15)), ji: String(+pnu.slice(15, 19)), jm: m ? m[1] : '', area: geomArea(f.geometry), c: centroid(f.geometry) });
      }
      if (fs.length < 1000) break;
      await sleep(60);
    }
    if (!src) src = '연속지적도';
  }
  return (landByDong[bj] = { src, list: out });
}

// ④ 맞추기
const res = { nrg: [], indu: [], sh: [], land: [] };
for (const t of rows) {
  if (late()) break;
  let cands = [], basis = '';
  const okJibun = x => x.san === t.san && t.bunRe.test(x.bun) && (!t.jiRe || t.jiRe.test(x.ji));
  if (t.kind === 'land') {
    if (!t.area) { res.land.push({ t, n: -1, why: '거래면적 없음' }); continue; }
    const L = await landList(t.bj);
    const jm = JIMOK[t.jimok] || '';
    cands = L.list.filter(x => okJibun(x) && (!jm || x.jm === jm) && near(x.area, t.area, 0.03));
    basis = `지번범위+지목+면적±3% (${L.src || '목록 없음'})`;
  } else {
    if (!t.plat || !t.gfa) { res[t.kind].push({ t, n: -1, why: '대지·연면적 없음' }); continue; }
    const B = await bldList(t.bj);
    if (!B.ok) { res[t.kind].push({ t, n: -1, why: '건물 목록 못 받음' }); continue; }
    cands = B.list.filter(x => okJibun(x) && near(x.plat, t.plat, 0.01) && near(x.tot, t.gfa, 0.01) && (!t.yb || !x.ys.size || [...x.ys].some(y => Math.abs(+y - +t.yb) <= 1)));
    basis = '지번범위+대지±1%+연면적±1%+건축연도';
  }
  res[t.kind].push({ t, n: cands.length, c: cands.length === 1 ? cands[0] : null, basis });
}

// 맞춘 건물 필지 좌표 (표본만 · 연속지적도)
const samples = {};
for (const k of KINDS) {
  samples[k] = [];
  for (const x of res[k].filter(x => x.n === 1).slice(0, 15)) {
    const c = x.c, pnu = c.pnu || `${GU}${x.t.bj}${c.san ? '2' : '1'}${c.bun.padStart(4, '0')}${c.ji.padStart(4, '0')}`;
    let pt = c.c || null;
    if (!pt && KAKAO) {   // 11/1 브이월드는 해외 서버(GitHub)에서 막혀서 카카오 주소 검색으로
      try {
        calls.kakao++;
        const q = `서울특별시 ${GU_NAME} ${x.t.umd} ${c.san ? '산' : ''}${c.bun}${c.ji !== '0' ? '-' + c.ji : ''}`;
        const r = await fetch('https://dapi.kakao.com/v2/local/search/address.json?query=' + encodeURIComponent(q), { headers: { Authorization: 'KakaoAK ' + KAKAO } });
        const j = await r.json(); const d = j.documents && j.documents[0];
        if (d) pt = { lat: +(+d.y).toFixed(6), lng: +(+d.x).toFixed(6) };
      } catch { /* 없음 */ }
    }
    samples[k].push({ 거래: `${x.t.date} ${x.t.umd} ${x.t.jb} ${(x.t.price / 1e4).toFixed(2)}억${x.t.via ? ' ' + x.t.via : ''}`, 맞춘필지: `${x.t.umd} ${c.san ? '산' : ''}${c.bun}${c.ji !== '0' ? '-' + c.ji : ''}`, pnu, 좌표: pt, 근거: x.basis, ...(k === 'land' ? { 거래면적: x.t.area, 경계면적: Math.round(c.area * 10) / 10 } : { 대지: [x.t.plat, c.plat], 연면적: [x.t.gfa, Math.round(c.tot * 100) / 100] }) });
  }
}

// 11/1 지도용 파일: 맞춘 건물 거래(토지 제외)를 필지별로 묶어 data/bt/<구>.json — 지도 [상가·건물]에서 읽음
//   필지마다: 중개거래 중 가장 최근 → 중개거래가 없으면 직거래 중 가장 최근(j:1) · 좌표는 카카오 주소 검색(법정동 코드가 맞을 때만)
const BK = ['nrg', 'indu', 'sh'], byP = new Map();
const CUT5 = (() => { const d = new Date(); return `${d.getFullYear() - 5}${String(d.getMonth() + 1).padStart(2, '0')}01`; })();
for (const k of BK) for (const x of res[k]) if (x.n === 1) {
  const c = x.c, pnu = `${GU}${x.t.bj}${c.san ? '2' : '1'}${c.bun.padStart(4, '0')}${c.ji.padStart(4, '0')}`;
  const key = pnu + k, g = byP.get(key) || { pnu, k, umd: x.t.umd, c, pl: x.t.plat, gf: Math.round(c.tot * 100) / 100, h: [] };
  g.h.push([x.t.ymd, x.t.price, /직거래/.test(x.t.via) ? 1 : 0]);
  byP.set(key, g);
}
const geoMemo = {}, mapItems = [];
for (const g of byP.values()) {
  if (!KAKAO || !GU_NAME) break;
  let pt = geoMemo[g.pnu];
  if (pt === undefined) {
    pt = null;
    try {
      calls.kakao++;
      const q = `서울특별시 ${GU_NAME} ${g.umd} ${g.c.san ? '산' : ''}${g.c.bun}${g.c.ji !== '0' ? '-' + g.c.ji : ''}`;
      const r = await fetch('https://dapi.kakao.com/v2/local/search/address.json?query=' + encodeURIComponent(q), { headers: { Authorization: 'KakaoAK ' + KAKAO } });
      const j = await r.json(), d = (j.documents || []).find(d => d.address && d.address.b_code === g.pnu.slice(0, 10));
      if (d) pt = { lat: +(+d.y).toFixed(6), lng: +(+d.x).toFixed(6) };
    } catch { /* 못 찾음 */ }
    geoMemo[g.pnu] = pt;
    await sleep(40);
  }
  if (!pt) continue;
  g.h.sort((a, b) => b[0].localeCompare(a[0]));
  // 11/2 지도 라벨은 최근 5년 거래만 (중개 우선 → 없으면 직거래) · 5년 안 거래가 없으면 라벨 없이 이력(h)만 — 정보창용
  const h5 = g.h.filter(h => h[0] >= CUT5), top = h5.find(h => !h[2]) || h5[0];
  mapItems.push({ pnu: g.pnu, k: g.k, lat: pt.lat, lng: pt.lng, a: `${g.umd} ${g.c.san ? '산' : ''}${g.c.bun}${g.c.ji !== '0' ? '-' + g.c.ji : ''}`, ...(top ? { p: top[1], d: top[0], j: top[2] } : {}), c: h5.length, pl: g.pl, gf: g.gf, h: g.h });
}
if (mapItems.length && !(process.env.BT_STRICT === '1' && (late() || tradeErr.length))) {   // 11/6 실거래 빠진 달이 있으면(요청 제한 등) 저장 안 함 → 다음 실행에 다시   // 11/5 서울 넓히기(bt-seoul)는 시간 안에 다 끝난 구만 저장 (덜 된 파일이 남으면 다시 안 만들어지므로)
  await mkdir('data/bt', { recursive: true });
  await writeFile(`data/bt/${GU}.json`, JSON.stringify({ updated: new Date().toISOString(), gu: GU, months: MONTHS, items: mapItems }));
}
log(`지도용 ${mapItems.length}필지 (좌표 못 찾음 ${byP.size - mapItems.length})`);

// 요약
const NAME = { nrg: '상가·업무 건물', indu: '공장·창고', sh: '단독·다가구', land: '토지' };
const sum = {};
for (const k of KINDS) {
  const L = res[k], tot = trades.filter(x => x.kind === k).length;
  sum[k] = { 전체거래: tot, 뺀거래: skip[k] || {}, 맞추기시도: L.length, 하나로맞춤: L.filter(x => x.n === 1).length, 후보여러개: L.filter(x => x.n > 1).length, 후보없음: L.filter(x => x.n === 0).length, 자료부족: L.filter(x => x.n < 0).length };
  const s = sum[k]; s['맞춤비율(시도중)'] = s.맞추기시도 ? `${Math.round(s.하나로맞춤 / s.맞추기시도 * 100)}%` : '-';
}
// 11/2 연도별 맞춤 (오래된 거래일수록 얼마나 맞는지 · 자료부족 = 신고 자료에 대지·연면적이 비어 있음)
const byYear = {};
for (const k of BK) for (const x of res[k]) {
  const y = x.t.ymd.slice(0, 4), e = (byYear[y] ||= { 시도: 0, 맞춤: 0, 자료부족: 0 });
  e.시도++; if (x.n === 1) e.맞춤++; if (x.n < 0) e.자료부족++;
}
for (const e of Object.values(byYear)) e.비율 = e.시도 ? `${Math.round(e.맞춤 / e.시도 * 100)}%` : '-';
const out = { 연도별: byYear, 지도용: { 필지: mapItems.length, 라벨있음: mapItems.filter(x => x.p).length }, updated: new Date().toISOString(), gu: GU, months: MONTHS, minutes: Math.round((Date.now() - t0) / 6e4), calls, 요약: sum, 표본: samples, 건물목록메모: bldNote.slice(0, 20), 건물목록받은줄: bldStat, 토지목록메모: landNote.slice(0, 30), 실거래오류: tradeErr.slice(0, 20), 실거래오류수: tradeErr.length };
await mkdir('data', { recursive: true });
await writeFile(`data/landtrade-test-${GU}.json`, JSON.stringify(out, null, 1));
const md = [`## 실거래 위치 맞추기 시험 — ${GU} · 최근 ${MONTHS}개월`, '', '| 종류 | 전체 | 뺀 거래 | 맞추기 시도 | 하나로 맞춤 | 후보 여러 개 | 후보 없음 | 자료 부족 | 맞춤 비율 |', '|---|---|---|---|---|---|---|---|---|',
  ...KINDS.map(k => { const s = sum[k]; return `| ${NAME[k]} | ${s.전체거래} | ${Object.entries(s.뺀거래).map(([a, b]) => `${a} ${b}`).join(', ') || '-'} | ${s.맞추기시도} | ${s.하나로맞춤} | ${s.후보여러개} | ${s.후보없음} | ${s.자료부족} | ${s['맞춤비율(시도중)']} |`; }),
  '', `요청 수: 실거래 ${calls.trade} · 건축물대장 ${calls.bld} · 토지특성 ${calls.ned} · 연속지적도 ${calls.vw} · 카카오 ${calls.kakao} · ${out.minutes}분`, `지도용 파일: ${mapItems.length}필지 (data/bt/${GU}.json)`, `좌표 찾음: ${KINDS.map(k => `${NAME[k]} ${samples[k].filter(x => x.좌표).length}/${samples[k].length}`).join(' · ')}`,
  '', '| 연도 | 시도 | 맞춤 | 비율 | 자료부족 |', '|---|---|---|---|---|', ...Object.keys(byYear).sort().map(y => `| ${y} | ${byYear[y].시도} | ${byYear[y].맞춤} | ${byYear[y].비율} | ${byYear[y].자료부족} |`),
  bldNote.length ? `\n건축물대장 메모: ${bldNote.slice(0, 5).join(' / ')}` : '', landNote.length ? `\n토지 메모: ${landNote.slice(0, 5).join(' / ')}` : ''].join('\n');
console.log(md);
if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, md + '\n');
