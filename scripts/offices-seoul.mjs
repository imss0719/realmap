// 10/30 서울 미가입 중개사무소 (지도 회색 점) 자료 만들기 — GitHub Actions에서 실행
// 서울 열린데이터광장 「서울시 부동산 중개업소 정보」(비밀값 SEOUL_KEY) → 영업 중인 곳만 → 건물(지번)별로 묶음
//  → 건물 일부만 '랜덤'으로 고름(선배 결정: 다 찍지 말고 적당히 · 지번으로 정해지는 고정 랜덤이라 갱신해도 점이 뒤섞이지 않음)
//  → 카카오 주소 검색(비밀값 KAKAO_REST_KEY)으로 좌표 → data/offices-seoul.json
// 화면에는 상호만 (전화번호·대표자 X · 선배 결정). 리얼맵 회원 사무소는 화면에서 등록번호로 빼고 노란 원으로.
// 파일에 키를 적지 마세요 (공개 저장소).
import { readFile, writeFile } from 'node:fs/promises';

const KEY = (process.env.SEOUL_KEY || '').trim(), KAKAO = (process.env.KAKAO_REST_KEY || '').trim();
if (!KEY || !KAKAO) { console.log('SEOUL_KEY · KAKAO_REST_KEY 비밀값이 필요합니다.'); process.exit(1); }
const SVCS = (process.env.SERVICE || 'landBizInfo').split(',').map(s => s.trim()).filter(Boolean);
const RATE = +(process.env.RATE || 30);      // 건물 100곳 중 몇 곳을 찍을지
const PER_DONG = +(process.env.PER_DONG || 12); // 한 동(법정동)에 최대 몇 건물
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function page(svc, from, to) {
  const url = `http://openapi.seoul.go.kr:8088/${KEY}/json/${svc}/${from}/${to}/`;
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(30000) }), t = await r.text();
      let j; try { j = JSON.parse(t); } catch { throw new Error(`JSON 아님 (HTTP ${r.status}) ${t.slice(0, 200)}`); }
      const body = j[svc];
      if (!body) throw new Error(`응답 형식 다름: ${JSON.stringify(j).slice(0, 300)}`);
      const code = body.RESULT?.CODE || '';
      if (code && code !== 'INFO-000') throw new Error(`${code} ${body.RESULT?.MESSAGE || ''}`);
      return { total: +body.list_total_count || 0, rows: body.row || [] };
    } catch (e) { if (i === 2) throw e; await sleep(3000); }
  }
}

// 1) 받기 (서비스 이름이 틀리면 다음 후보)
let svc = '', rows = [];
for (const s of SVCS) {
  try {
    const first = await page(s, 1, 1000); rows = [...first.rows];
    for (let n = 1001; n <= first.total; n += 1000) { rows.push(...(await page(s, n, n + 999)).rows); await sleep(200); }
    svc = s; console.log(`[${s}] 전체 ${first.total}건 · 받은 ${rows.length}건`); break;
  } catch (e) { console.log(`[${s}] 실패: ${e.message}`); }
}
if (!rows.length) process.exit(1);
const keys = Object.keys(rows[0]);
console.log(`항목: ${keys.join(', ')}`);
console.log(`첫 줄: ${JSON.stringify(rows[0])}`);

// 2) 항목 찾기 — 영문 항목 이름을 몰라도 값 모양으로 짐작 (짐작 결과는 기록에 남김)
const sample = rows.slice(0, 300);
const score = (k, re) => sample.filter(r => re.test(String(r[k] ?? ''))).length;
const best = (re, not = []) => keys.filter(k => !not.includes(k)).map(k => [k, score(k, re)]).sort((a, b) => b[1] - a[1]).find(([, n]) => n > sample.length * 0.3)?.[0] || '';
const F = {};
F.reg = best(/^\d{5}-\d{4}-\d{5}$|^\d{14}$/);
F.name = best(/(공인중개|부동산|중개법인|중개사)/, [F.reg]);
F.st = best(/(영업|휴업|폐업|정지|취소)/, [F.reg, F.name]);
F.addr = best(/^서울(특별시)?\s/, [F.reg, F.name, F.st]);
F.sgg = best(/^11\d{3}$/, [F.reg]);
F.bjd = best(/^\d{5}$|^11\d{8}$/, [F.reg, F.sgg]);
F.gu = best(/^[가-힣]+구$/, [F.name, F.st]);
F.dong = best(/^[가-힣0-9]+(동|가|로)\d*가?$/, [F.name, F.st, F.gu]);
F.bon = keys.find(k => /BOBN|BONBEON|MNNM|MAIN_?NO|BONBUN/i.test(k)) || '';
F.bu = keys.find(k => /BUBN|BUBEON|SLNO|SUB_?NO|BUBUN/i.test(k)) || '';
console.log(`짐작한 항목: ${JSON.stringify(F)}`);
if (!F.name || (!F.addr && !(F.gu && F.dong && F.bon))) { console.log('상호·주소 항목을 찾지 못했습니다. 위 항목 목록을 보고 스크립트를 고쳐야 합니다.'); process.exit(1); }
if (F.st) { const m = {}; rows.forEach(r => { const v = r[F.st] ?? ''; m[v] = (m[v] || 0) + 1; }); console.log(`[상태] ${Object.entries(m).sort((a, b) => b[1] - a[1]).map(([v, n]) => `${v}:${n}`).join(' · ')}`); }

// 3) 영업 중만 · 건물(지번)별로 묶기
const live = rows.filter(r => !F.st || /영업/.test(String(r[F.st])) && !/(휴업|폐업|정지|취소)/.test(String(r[F.st])));
const jibun = r => {
  if (F.gu && F.dong && F.bon) { const bo = String(r[F.bon] ?? '').replace(/^0+/, ''), bu = String(r[F.bu] ?? '').replace(/^0+/, ''); if (bo) return `서울 ${r[F.gu]} ${r[F.dong]} ${bo}${bu ? '-' + bu : ''}`; }
  return String(r[F.addr] || '').replace(/\(.*?\)/g, ' ').replace(/\s+/g, ' ').replace(/^서울특별시/, '서울').split(/\s*,\s*/)[0].replace(/\s+\d+층.*$|\s+(지하)?\d+호.*$|\s+제?\d+동\s.*$/, '').trim();
};
const B = new Map();
for (const r of live) {
  const a = jibun(r); if (!a) continue;
  const e = B.get(a) || B.set(a, { a, names: [], regs: [] }).get(a);
  e.names.push(String(r[F.name] || '').trim()); e.regs.push(String(r[F.reg] || '').replace(/\D/g, ''));
}
console.log(`영업 중 ${live.length}곳 · 건물 ${B.size}곳`);

// 4) 고정 랜덤으로 일부만 (동마다 최대 PER_DONG)
const hash = s => { let h = 2166136261; for (const c of s) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return (h >>> 0) % 1000; };
const perDong = new Map(), pick = [];
for (const e of [...B.values()].sort((x, y) => hash(x.a) - hash(y.a))) {
  if (hash(e.a) >= RATE * 10) break;
  const d = e.a.split(' ').slice(0, 3).join(' '), n = perDong.get(d) || 0;
  if (n >= PER_DONG) continue;
  perDong.set(d, n + 1); pick.push(e);
}
console.log(`고른 건물 ${pick.length}곳 (비율 ${RATE}% · 동마다 최대 ${PER_DONG})`);

// 5) 좌표 (지난번 좌표는 다시 찾지 않음 · 최대 15분, 남은 건 다음 실행 때)
const prev = await (async () => { try { return JSON.parse(await readFile('data/offices-seoul-memo.json', 'utf8')); } catch { return []; } })();
const memo = new Map(prev.map(([a, la, ln]) => [a, [la, ln]]));
async function geocode(q) {
  const r = await fetch('https://dapi.kakao.com/v2/local/search/address.json?size=1&query=' + encodeURIComponent(q), { headers: { Authorization: `KakaoAK ${KAKAO}` }, signal: AbortSignal.timeout(5000) });
  if (r.status === 401 || r.status === 403) throw Object.assign(new Error(`카카오 키 오류 HTTP ${r.status}`), { fatal: true });
  if (!r.ok) return null;
  const d = (await r.json()).documents?.[0];
  return d ? [+(+d.y).toFixed(6), +(+d.x).toFixed(6)] : null;
}
const T0 = Date.now(); let found = 0, miss = 0, left = 0;
for (const e of pick) {
  if (memo.has(e.a)) continue;
  if (Date.now() - T0 > 15 * 60e3) { left++; continue; }
  try { const p = await geocode(e.a); if (p) { memo.set(e.a, p); found++; } else { memo.set(e.a, [0, 0]); miss++; } }
  catch (err) { if (err.fatal) { console.log(err.message); process.exit(1); } left++; }
  await sleep(40);
}
console.log(`좌표 새로 ${found}곳 · 못 찾음 ${miss}곳 · 다음으로 미룸 ${left}곳`);

// 6) 저장: rows = [위도, 경도, '상호|상호', '등록번호|등록번호'] (화면용) · 좌표 기억은 따로 offices-seoul-memo.json
const out = pick.map(e => { const p = memo.get(e.a); return p && p[0] > 33 ? [p[0], p[1], e.names.join('|'), e.regs.join('|')] : null; }).filter(Boolean);
await writeFile('data/offices-seoul.json', JSON.stringify({
  source: `서울시 부동산 중개업소 정보 (서울 열린데이터광장 ${svc})`, updated: new Date().toISOString().slice(0, 10),
  live: live.length, n: out.length, rows: out,
}));
await writeFile('data/offices-seoul-memo.json', JSON.stringify(pick.filter(e => memo.has(e.a)).map(e => [e.a, ...memo.get(e.a)])));
console.log(`저장: 점 ${out.length}곳 · 사무소 ${out.reduce((s, r) => s + r[2].split('|').length, 0)}곳`);
