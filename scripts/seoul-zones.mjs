// 서울 열린데이터광장 정비사업 자료 받아 오기 (GitHub Actions에서 실행)
// 인증키는 저장소 비밀값 SEOUL_KEY 에서 읽습니다. 파일에 키를 적지 마세요 (공개 저장소).
// 받은 원본은 data/seoul-raw/<서비스이름>.json 에 저장하고,
// 카카오 REST 키(비밀값 KAKAO_REST_KEY)가 있으면 사업지 주소를 좌표로 바꿔 국토부 정비구역 경계와 짝지은 뒤
// data/seoul-zones.json (리얼맵 화면용)을 만듭니다.
import { mkdir, writeFile, readFile } from 'node:fs/promises';

const KEY = (process.env.SEOUL_KEY || '').trim();
const SERVICES = (process.env.SERVICES || 'vnBsnsNmtn').split(',').map(s => s.trim()).filter(Boolean);
if (!KEY) { console.log('SEOUL_KEY 비밀값이 비어 있습니다.'); process.exit(1); }

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function page(svc, from, to) {
  const url = `http://openapi.seoul.go.kr:8088/${KEY}/json/${svc}/${from}/${to}/`;
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(30000) });
      const t = await r.text();
      let j; try { j = JSON.parse(t); } catch { throw new Error(`JSON 아님 (HTTP ${r.status}) ${t.slice(0, 200)}`); }
      const body = j[svc];
      if (!body) throw new Error(`응답 형식 다름: ${JSON.stringify(j).slice(0, 300)}`);
      const code = body.RESULT?.CODE || '';
      if (code && code !== 'INFO-000') throw new Error(`${code} ${body.RESULT?.MESSAGE || ''}`);
      return { total: +body.list_total_count || 0, rows: body.row || [] };
    } catch (e) { if (i === 2) throw e; await sleep(3000); }
  }
}

await mkdir('data/seoul-raw', { recursive: true });
let failed = 0;
for (const svc of SERVICES) {
  try {
    const first = await page(svc, 1, 1000);
    const rows = [...first.rows];
    for (let s = 1001; s <= first.total; s += 1000) { rows.push(...(await page(svc, s, s + 999)).rows); await sleep(300); }
    console.log(`[${svc}] 전체 ${first.total}건 · 받은 ${rows.length}건`);
    console.log(`[${svc}] 항목: ${Object.keys(rows[0] || {}).join(', ')}`);
    console.log(`[${svc}] 첫 줄: ${JSON.stringify(rows[0] || {})}`);
    await writeFile(`data/seoul-raw/${svc}.json`, JSON.stringify({ service: svc, updated: new Date().toISOString().slice(0, 10), total: first.total, rows }));
  } catch (e) { failed++; console.log(`[${svc}] 실패: ${e.message}`); }
}
if (failed === SERVICES.length) process.exit(1);

// ---------- 2단계: 리얼맵 화면용 자료 만들기 ----------
const KAKAO = (process.env.KAKAO_REST_KEY || '').trim();
if (!KAKAO) { console.log('KAKAO_REST_KEY 비밀값이 없어 화면용 자료는 건너뜁니다.'); process.exit(0); }

const readJson = async f => { try { return JSON.parse(await readFile(f, 'utf8')); } catch { return null; } };
const jb = (await readJson('data/jeongbi-seoul.json'))?.features || [];
const prev = await readJson('data/seoul-zones.json');
const memo = new Map((prev?.rows || []).filter(r => r.lat).map(r => [`${r.gu} ${r.a}`, [r.lat, r.lng]]));

function inRing(r, x, y) { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const [xi, yi] = r[i], [xj, yj] = r[j]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c; } return c; }
function inGeo(g, x, y) { const ps = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : []; return ps.some(p => inRing(p[0], x, y) && !p.slice(1).some(h => inRing(h, x, y))); }
// 이름 비교용: 공백·줄바꿈·흔한 꼬리말 제거
const norm = s => String(s || '').replace(/\s+/g, '').replace(/\(재촉\)|주택재개발|재정비촉진|도시환경|정비사업|정비구역|재개발|재건축|구역|지구|아파트|일대/g, '');
// 주소 다듬기: 앞뒤 공백, '일대', 쉼표 뒤 여러 지번 → 첫 지번만
const cleanAddr = a => String(a || '').replace(/\s+/g, ' ').replace(/\(.*?\)/g, ' ')
  .replace(/일대|일원|번지|외\s*\d+\s*(필지|개\s*필지)?|\s등(?=\s|$)/g, ' ').split(/[,·~]/)[0].replace(/\s+/g, ' ').trim();

// 카카오 주소 검색 (응답이 늦으면 5초에 끊음)
const errs = [];
async function geocode(q) {
  const u = 'https://dapi.kakao.com/v2/local/search/address.json?size=1&query=' + encodeURIComponent(q);
  const t0 = Date.now();
  try {
    const r = await fetch(u, { headers: { Authorization: `KakaoAK ${KAKAO}` }, signal: AbortSignal.timeout(5000) });
    if (r.status === 401 || r.status === 403) throw Object.assign(new Error(`카카오 키 오류 HTTP ${r.status} ${(await r.text()).slice(0, 200)}`), { fatal: true });
    if (!r.ok) throw new Error(`HTTP ${r.status} ${(await r.text()).slice(0, 120)}`);
    const j = await r.json();
    const d = j.documents?.[0];
    return d ? [+(+d.y).toFixed(6), +(+d.x).toFixed(6)] : null;
  } catch (e) {
    if (errs.length < 5) { errs.push(`${e.message} (${Date.now() - t0}ms)`); console.log(`좌표 오류: ${e.message} (${Date.now() - t0}ms)`); }
    throw e;
  }
}

const raw = (await readJson('data/seoul-raw/vnBsnsNmtn.json'))?.rows || [];
const T0 = Date.now(), BUDGET = 10 * 60e3; // 좌표 찾기는 최대 10분. 남은 건 다음 실행 때 이어서
let geoNew = 0, geoMiss = 0, geoFail = 0, linked = 0, tried = 0, stopGeo = false;
const rowsOut = raw.map(x => {
  const gu = String(x.SITE_CODE_NM || '').trim(), a = cleanAddr(x.BSNS_ADDR);
  return {
    id: x.BASIC_INFO_SEQ, n: String(x.BSNS_NAME || '').replace(/\s+/g, ' ').trim(), k: String(x.CLASSIFY_L_NM || '').trim(), gu, a,
    st: String(x.PROPEL_CD_NM || '').trim(), sd: String(x.PROPEL_DT || '').slice(0, 10).replace(/-/g, '.'),
    ar: +x.BSNS_AREA || +x.AREA || 0, hh: +x.SUPLY_HSHLD || 0, far: +x.FLAR_RT || 0, fl: String(x.FLOOR || '').trim(),
    zb: String(x.SPFC_PREV || '').trim(), za: String(x.SPFC_AFTER || '').trim(), url: String(x.CLEANUP_BSNS_URL || '').trim(),
  };
});
// 좌표: 이미 찾은 건 재사용, 나머지는 6개씩 동시에
const todo = [];
for (const row of rowsOut) { const ll = memo.get(`${row.gu} ${row.a}`); if (ll) { row.lat = ll[0]; row.lng = ll[1]; } else if (row.a) todo.push(row); }
console.log(`좌표 재사용 ${rowsOut.length - todo.length}건 · 새로 찾을 곳 ${todo.length}건`);
let qi = 0;
await Promise.all(Array.from({ length: 6 }, async () => {
  while (qi < todo.length && !stopGeo) {
    if (Date.now() - T0 > BUDGET) { stopGeo = true; console.log('시간 한도 도달 — 남은 곳은 다음 실행 때 찾습니다'); break; }
    const row = todo[qi++];
    tried++;
    try {
      // 주소에 구 이름이 또 들어 있으면 빼고, 분할로 없어진 모번지(예: 81)는 81-1로도 찾아봄
      const a = row.a.replace(new RegExp('^' + row.gu + '\\s*'), '');
      const tries = [a, a.replace(/^(\S+?)\d+(가|동)\s/, '$1$2 ')];
      if (/^\S+\s산?\d+$/.test(a)) tries.push(a + '-1', a + '-2');
      let ll = null;
      for (const q of [...new Set(tries)]) { ll = await geocode(`서울특별시 ${row.gu} ${q}`); if (ll) break; }
      if (ll) { row.lat = ll[0]; row.lng = ll[1]; geoNew++; } else geoMiss++;
    } catch (e) {
      geoFail++;
      if (e.fatal) { stopGeo = true; console.log(e.message); }
      if (tried >= 20 && geoNew === 0) { stopGeo = true; console.log('카카오 주소 검색이 응답하지 않아 좌표 찾기를 멈춥니다'); }
    }
    if (tried % 100 === 0) console.log(`좌표 진행 ${tried}/${todo.length} · 찾음 ${geoNew} · 없음 ${geoMiss} · 오류 ${geoFail} · ${Math.round((Date.now() - T0) / 1000)}초`);
  }
}));
// 국토부 정비구역 경계와 짝짓기: 같은 구에서 좌표가 들어가는 구역, 없으면 이름이 같은 구역
const out = [];
for (const row of rowsOut) {
  let hit = row.lat ? jb.filter(f => f.properties.gu === row.gu && inGeo(f.geometry, row.lng, row.lat)) : [];
  if (!hit.length && norm(row.n).length >= 2) hit = jb.filter(f => f.properties.gu === row.gu && f.properties.named && norm(f.properties.n) === norm(row.n));
  row.jb = hit.map(f => f.properties.id);
  if (row.jb.length) linked++;
  out.push(row);
}
await writeFile('data/seoul-zones.json', JSON.stringify({ updated: new Date().toISOString().slice(0, 10), source: '서울 열린데이터광장 도시계획사업(서울플랜+) 정비사업 현황', rows: out }));
console.log(`화면용 자료 ${out.length}건 · 좌표 있음 ${out.filter(r => r.lat).length}건 (이번에 찾음 ${geoNew}) · 주소 없음 ${geoMiss} · 오류 ${geoFail} · 국토부 구역과 연결 ${linked}건 · ${Math.round((Date.now() - T0) / 1000)}초`);
