// 11/5 학원가 자료 만들기 (서울) — GitHub Actions에서 실행 (매달 + 수동)
// 나이스 교육정보 개방포털 「학원교습소정보」(비밀값 NEIS_KEY) → 개원 중인 곳만 → 카카오 주소 검색(비밀값 KAKAO_REST_KEY)으로 좌표
//  → data/aca-11.json (화면용: [위도, 경도, 이름, 분야번호, 학원0/교습소1]) · 좌표 기억은 data/aca-memo.json (다음 실행 때 다시 찾지 않음)
// 아직 화면에서 쓰지 않음 — 선배가 결과 확인한 뒤에 지도에 붙임.
// 파일에 키를 적지 마세요 (공개 저장소).
import { readFile, writeFile, appendFile } from 'node:fs/promises';

const KEY = (process.env.NEIS_KEY || '').trim(), KAKAO = (process.env.KAKAO_REST_KEY || '').trim();
if (!KEY || !KAKAO) { console.log('NEIS_KEY · KAKAO_REST_KEY 비밀값이 필요합니다.'); process.exit(1); }
const OFC = process.env.OFC || 'B10';   // 서울특별시교육청
const GEO_MIN = +(process.env.GEO_MINUTES || 40);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const clean = s => String(s ?? '').replace(/\s+/g, ' ').trim();

// 1) 받기 (1,000건씩)
async function page(i) {
  const u = `https://open.neis.go.kr/hub/acaInsTiInfo?KEY=${KEY}&Type=json&pIndex=${i}&pSize=1000&ATPT_OFCDC_SC_CODE=${OFC}`;
  for (let t = 0; t < 4; t++) {
    try {
      const r = await fetch(u, { signal: AbortSignal.timeout(30000) }), j = await r.json();
      if (j.RESULT) { if (j.RESULT.CODE === 'INFO-200') return { total: 0, rows: [] }; throw new Error(`${j.RESULT.CODE} ${j.RESULT.MESSAGE}`); }
      const b = j.acaInsTiInfo; if (!b) throw new Error('응답 형식 다름: ' + JSON.stringify(j).slice(0, 200));
      const head = b[0].head, code = head[1]?.RESULT?.CODE;
      if (code && code !== 'INFO-000') throw new Error(`${code} ${head[1].RESULT.MESSAGE}`);
      return { total: +head[0].list_total_count || 0, rows: b[1]?.row || [] };
    } catch (e) { if (t === 3) throw e; await sleep(3000 * (t + 1)); }
  }
}
const first = await page(1), rows = [...first.rows];
for (let i = 2; (i - 1) * 1000 < first.total; i++) { rows.push(...(await page(i)).rows); await sleep(300); }
console.log(`받은 ${rows.length}건 / 전체 ${first.total}건`);
if (!rows.length) process.exit(1);
console.log('항목:', Object.keys(rows[0]).join(', '));
const cnt = k => { const m = {}; rows.forEach(r => { const v = clean(r[k]); m[v] = (m[v] || 0) + 1; }); return Object.entries(m).sort((a, b) => b[1] - a[1]).map(([v, n]) => `${v || '(빈칸)'}:${n}`).join(' · '); };
for (const k of ['REG_STTUS_NM', 'ACA_INSTI_SC_NM', 'REALM_SC_NM', 'LE_ORD_NM']) console.log(`[${k}] ${cnt(k)}`);

// 2) 개원 중만 · 분야 번호
const REALM = ['입시.검정 및 보습', '국제화', '예능(대)', '독서실', '종합(대)', '직업기술', '인문사회', '정보', '기예(대)', '경영실무', '특수교육', '기타'];
const realmNo = s => { const i = REALM.findIndex(x => clean(s).replace(/\s/g, '').startsWith(x.replace(/\s/g, '').slice(0, 2))); return i < 0 ? REALM.length - 1 : i; };
const live = rows.filter(r => /개원/.test(clean(r.REG_STTUS_NM)) || !clean(r.REG_STTUS_NM));
const addrOf = r => clean(r.FA_RDNMA).replace(/^서울특별시/, '서울').replace(/\(.*?\)/g, '').replace(/,.*$/, '').trim();
console.log(`개원 중 ${live.length}곳 · 주소 종류 ${new Set(live.map(addrOf)).size}개`);

// 3) 좌표 (지난번 좌표는 다시 찾지 않음 · 최대 GEO_MIN분, 남은 건 다음 실행 때)
const prev = await (async () => { try { return JSON.parse(await readFile('data/aca-memo.json', 'utf8')); } catch { return []; } })();
const memo = new Map(prev.map(([a, la, ln]) => [a, [la, ln]]));
async function geocode(q) {
  const r = await fetch('https://dapi.kakao.com/v2/local/search/address.json?size=1&query=' + encodeURIComponent(q), { headers: { Authorization: `KakaoAK ${KAKAO}` }, signal: AbortSignal.timeout(5000) });
  if (r.status === 401 || r.status === 403) throw Object.assign(new Error(`카카오 키 오류 HTTP ${r.status}`), { fatal: true });
  if (!r.ok) return null;
  const d = (await r.json()).documents?.[0];
  return d ? [+(+d.y).toFixed(6), +(+d.x).toFixed(6)] : null;
}
const T0 = Date.now(); let found = 0, miss = 0, left = 0;
for (const a of new Set(live.map(addrOf))) {
  if (!a || memo.has(a)) continue;
  if (Date.now() - T0 > GEO_MIN * 60e3) { left++; continue; }
  try { const p = await geocode(a); if (p) { memo.set(a, p); found++; } else { memo.set(a, [0, 0]); miss++; } }
  catch (e) { if (e.fatal) { console.log(e.message); process.exit(1); } left++; }
  await sleep(30);
}
console.log(`좌표 새로 ${found}곳 · 못 찾음 ${miss}곳 · 다음으로 미룸 ${left}곳`);

// 4) 저장
const out = [];
for (const r of live) { const p = memo.get(addrOf(r)); if (p && p[0] > 33) out.push([p[0], p[1], clean(r.ACA_NM), realmNo(r.REALM_SC_NM), /교습소/.test(clean(r.ACA_INSTI_SC_NM)) ? 1 : 0]); }
const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
await writeFile('data/aca-11.json', JSON.stringify({ source: '나이스 교육정보 개방포털 학원교습소정보', updated: today, realm: REALM, live: live.length, n: out.length, rows: out }));
await writeFile('data/aca-memo.json', JSON.stringify([...memo].map(([a, p]) => [a, ...p])));
const by = {}; out.forEach(r => { by[REALM[r[3]]] = (by[REALM[r[3]]] || 0) + 1; });
const msg = `## 학원가 자료 (서울 · ${today})\n개원 중 ${live.length.toLocaleString()}곳 · 지도 좌표 ${out.length.toLocaleString()}곳 · 다음으로 미룬 주소 ${left}개\n\n분야별: ${Object.entries(by).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n.toLocaleString()}`).join(' · ')}\n`;
if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, msg); else console.log(msg);
