// 10/30 서울 아파트 단지별 면적·공급평·추정 타입 데이터베이스 (GitHub Actions에서 실행 · 선배 요청)
//   ① 단지 목록: 국토부 아파트 매매 실거래(최근 MONTHS개월)에서 단지 이름·지번 → 필지번호(PNU)
//   ② 단지마다 건축물대장 전유공용면적(getBrExposPubuseAreaInfo) 전부 → 호마다 전용 + 주거공용 = 공급면적
//      (공용 중 주차장·관리사무소·커뮤니티 같은 '기타 공용'은 계약면적에만 들어가므로 뺌)
//   ③ 전용면적(소수점 둘째 자리)마다 따로 · 같은 전용에서 공급이 0.5㎡ 넘게 다르면 그것도 따로 (타입 이름은 선배가 평형표에서)
//   결과: data/apt/<구코드>.json  { updated, gu, n, cx: { PNU: { n 단지명, y 준공연도, h 세대수, d 동 수, nosup(대장에 공용면적 없음), t: [{ ex 전용, sup 공급, py 공급평, ty 타입(비워 둠 · 선배가 평형표에서), h 세대 }] } } }
//   하루 요청 한도가 있어 MAX_CALLS·시간을 넘으면 멈추고, 다음 실행은 아직 안 받은 단지부터 이어 받음 (REFRESH=1이면 처음부터)
// 필요한 비밀값: DATA_GO_KR_KEY
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { month, monthsBack } from '../api/trades.js';
import { dataGoKr, num } from '../api/_lib.js';

if (!process.env.DATA_GO_KR_KEY) { console.log('DATA_GO_KR_KEY 비밀값이 비어 있습니다.'); process.exit(1); }
const GUS = String(process.env.GUS || '11440').split(/[,\s]+/).filter(g => /^11\d{3}$/.test(g));
const MONTHS = +(process.env.MONTHS || 36);
const MAX_CALLS = +(process.env.MAX_CALLS || 6000);
const DEADLINE = +(process.env.MINUTES || 50) * 60e3;
const REFRESH = process.env.REFRESH === '1';
const HUB = 'https://apis.data.go.kr/1613000/BldRgstHubService/';
const t0 = Date.now();
let calls = 0;
const late = () => Date.now() - t0 > DEADLINE || calls >= MAX_CALLS;
const clean = s => String(s ?? '').trim();
const PY = 3.3058;
// 기타 공용(계약면적에만 들어가는 것) — 이름에 이런 말이 있으면 공급면적에서 뺌
const ETC = /주차|기계|전기실|발전|관리사무|경비|노인|경로|보육|어린이집|주민|커뮤니|휘트니스|헬스|독서|작은도서관|근린|상가|부대|복리|저수조|물탱크|정화조|펌프|쓰레기|자전거|창고|방재|중앙감시|MDF|변전/;

async function pages(params) {   // 전유공용면적 한 단지 전부 (쪽마다 1,000줄)
  const out = [];
  for (let p = 1; p <= 80; p++) {
    if (late()) throw Object.assign(new Error('한도'), { stop: true });
    calls++;
    const r = await dataGoKr(HUB + 'getBrExposPubuseAreaInfo', { ...params, numOfRows: 1000, pageNo: p });
    out.push(...r.items);
    if (!r.items.length || out.length >= (r.total || 0)) break;
    await new Promise(s => setTimeout(s, 120));
  }
  return out;
}

for (const gu of GUS) {
  const file = `data/apt/${gu}.json`;
  let db = { updated: '', gu, n: 0, cx: {} };
  if (!REFRESH) { try { db = JSON.parse(await readFile(file, 'utf8')); } catch { /* 처음 */ } }
  // ① 단지 목록 (실거래) — 법정동 코드가 없는 줄은 동 이름으로 찾음 (data/umd-11.json)
  const byName = {};
  try { for (const f of JSON.parse(await readFile('data/umd-11.json', 'utf8')).f) byName[`${f.c.slice(0, 5)}|${f.n}`] = (f.c.slice(5) + '00').slice(0, 5); } catch { /* 없음 */ }   // 법정동 8자리 → 5자리(뒤 00)
  const list = new Map();
  const yms = monthsBack(MONTHS + 1).slice(1);
  for (const ym of yms) {
    if (late()) break;
    let rows = []; calls++;
    try { rows = await month('apt', gu, ym); } catch (e) { console.log(`실거래 ${ym} 실패: ${e.message}`); continue; }
    for (const r of rows) {
      const umd = clean(r.umdCd) || byName[`${gu}|${clean(r.umdNm)}`] || '', j = clean(r.jibun).replace(/\s/g, '');
      const m = /^(산)?(\d+)(?:-(\d+))?$/.exec(j);
      if (!/^\d{5}$/.test(umd) || !m) continue;
      const pnu = gu + umd + (m[1] ? '2' : '1') + m[2].padStart(4, '0') + (m[3] || '0').padStart(4, '0');
      const e = list.get(pnu) || { n: clean(r.aptNm), y: clean(r.buildYear), c: 0 };
      e.c++; list.set(pnu, e);
    }
  }
  console.log(`[${gu}] 실거래로 찾은 단지 ${list.size}곳 (요청 ${calls})`);
  // ② 단지마다 건축물대장
  const todo = [...list.entries()].filter(([p]) => REFRESH || !db.cx[p]).sort((a, b) => b[1].c - a[1].c);   // 거래 많은 단지부터
  let done = 0, empty = 0;
  for (const [pnu, e] of todo) {
    if (late()) break;
    const q = { sigunguCd: pnu.slice(0, 5), bjdongCd: pnu.slice(5, 10), platGbCd: pnu[10] === '2' ? '1' : '0', bun: pnu.slice(11, 15), ji: pnu.slice(15, 19) };
    let rows;
    try { rows = await pages(q); } catch (err) { if (err.stop) break; console.log(`${e.n} 실패: ${err.message}`); continue; }
    // 호마다 전용·주거공용 합
    const U = new Map();
    for (const x of rows) {
      const k = `${clean(x.dongNm)}|${clean(x.hoNm)}`; if (!clean(x.hoNm)) continue;
      const a = num(x.area) || 0, gb = clean(x.exposPubuseGbCdNm), nm = `${clean(x.mainPurpsCdNm)} ${clean(x.etcPurps)}`;
      const u = U.get(k) || U.set(k, { ex: 0, co: 0, apt: false }).get(k);
      if (/전유/.test(gb)) { u.ex += a; if (/아파트|공동주택/.test(nm)) u.apt = true; }
      else if (/공용/.test(gb) && !ETC.test(nm)) u.co += a;
    }
    const units = [...U.values()].filter(u => u.ex > 10 && u.ex < 400 && u.apt);
    if (!units.length) { empty++; db.cx[pnu] = { n: e.n, y: e.y, h: 0, d: 0, t: [], none: 1 }; continue; }
    // 10/30 고침 (마포 시범 결과): 오래된 단지는 대장에 공용면적이 없음 → 공급평을 비워 둠 (전용 = 공급으로 나오던 것)
    const nosup = units.filter(u => u.co < 1).length > units.length * 0.5;
    // 10/30 선배: 임의로 묶지 말고 전용면적(소수점 둘째 자리)이 다르면 다 따로 — 같은 타입으로 묶는 건 선배가 평형표에서
    //   같은 전용 안에서 공급면적이 0.5㎡ 넘게 다르면 그것도 따로 (몇 호뿐이어도 빼지 않음) · 타입 이름(ty)은 비워 둠
    const byEx = new Map();
    for (const u of units) { const ex = Math.round(u.ex * 100) / 100, sup = Math.round((u.ex + u.co) * 100) / 100; (byEx.get(ex) || byEx.set(ex, []).get(ex)).push(sup); }
    const t = [];
    for (const [ex, sups] of [...byEx.entries()].sort((a, b) => a[0] - b[0])) {
      if (nosup) { t.push({ ex, sup: null, py: null, ty: '', h: sups.length }); continue; }
      const cl = [];
      for (const s of sups.sort((a, b) => a - b)) { const c = cl[cl.length - 1]; if (c && s - c.last <= 0.5) { c.n++; c.sum += s; c.last = s; } else cl.push({ n: 1, sum: s, last: s }); }
      for (const c of cl) { const sup = Math.round(c.sum / c.n * 100) / 100; t.push({ ex, sup, py: Math.round(sup / PY), ty: '', h: c.n }); }
    }
    db.cx[pnu] = { n: e.n, y: e.y, h: units.length, d: new Set([...U.keys()].map(k => k.split('|')[0])).size, t, ...(nosup ? { nosup: 1 } : {}) };
    done++;
    if (done % 20 === 0) { db.updated = new Date().toISOString().slice(0, 10); db.n = Object.keys(db.cx).length; await mkdir('data/apt', { recursive: true }); await writeFile(file, JSON.stringify(db)); console.log(`  … ${done}곳 (요청 ${calls})`); }
  }
  db.updated = new Date().toISOString().slice(0, 10); db.n = Object.keys(db.cx).length;
  db.left = [...list.keys()].filter(p => !db.cx[p]).length;
  await mkdir('data/apt', { recursive: true });
  await writeFile(file, JSON.stringify(db));
  console.log(`[${gu}] 이번에 ${done}곳 · 대장 없음 ${empty}곳 · 남은 단지 ${db.left}곳 · 저장 ${file} (요청 ${calls}, ${Math.round((Date.now() - t0) / 1000)}초)`);
  if (late()) { console.log('요청 한도·시간이 다 되어 멈춥니다. 다시 실행하면 이어서 받습니다.'); break; }
}
