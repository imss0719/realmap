// 10/30 인천 정비사업 화면용 자료 만들기 (GitHub Actions에서 실행 · 경기 gg-zones-build.mjs와 같은 방식)
// 입력: data/nat-zones-raw.json (국토교통부 전국 도시정비사업 통합 데이터 · 인천 행만 · 구역명·구·종류·단계·세대수·시행자뿐 · 주소 없음)
//       data/jeongbi-28.json   (국토부 정비구역 경계 · 인천)
// 위치 찾기: ① 경계 이름이 구역명과 같으면 그 경계 (카카오 필요 없음)
//            ② 없으면 카카오 장소 검색(비밀값 KAKAO_REST_KEY) '인천 ○○구 구역명' → 인천·같은 구일 때만 · 그 점을 품은 경계가 있으면 경계도
//            찾은 결과는 data/ic-geo-memo.json 에 기억 (다음엔 다시 안 찾음)
// 출력: data/ic-zones.json  rows = 구역마다 한 줄 (ic-pages.mjs 가 페이지로 만듦)
// 번호: 28 + 6자리 (관심 구역 ☆용 숫자 · 같은 이름은 계속 같은 번호)
import { readFile, writeFile } from 'node:fs/promises';

const readJson = async (f, d = null) => { try { return JSON.parse(await readFile(f, 'utf8')); } catch { return d; } };
const KAKAO = (process.env.KAKAO_REST_KEY || '').trim();
const raw = await readJson('data/nat-zones-raw.json', { rows: [] });
const JB = ((await readJson('data/jeongbi-28.json', { features: [] })).features || []).filter(f => f.geometry);
const memo = new Map(Object.entries(await readJson('data/ic-geo-memo.json', {})));

const GU = { '중구': 'jung', '동구': 'dong', '미추홀구': 'michuhol', '연수구': 'yeonsu', '남동구': 'namdong', '부평구': 'bupyeong', '계양구': 'gyeyang', '서구': 'seo', '강화군': 'ganghwa', '옹진군': 'ongjin' };
const clean = s => String(s ?? '').replace(/\s+/g, ' ').trim();
const noNum = s => clean(s).replace(/^\d+\)\s*/, '');   // '4)조합설립인가' → '조합설립인가'
const hash = s => { let h = 2166136261; for (const c of s) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return (h >>> 0) % 1000000; };

// 국토부 자료 이름 → 경기 페이지와 같은 이름
const KIND = k => /재개발/.test(k) ? '재개발' : /재건축/.test(k) ? '재건축' : /주거환경/.test(k) ? '주거환경개선' : noNum(k) || '정비사업';
const STEP = s => { s = noNum(s); return /예정/.test(s) ? '예정구역' : /구역지정|정비구역/.test(s) ? '정비구역' : /추진위/.test(s) ? '추진위원회' : /조합설립/.test(s) ? '조합설립' : /사업시행/.test(s) ? '사업시행' : /관리처분/.test(s) ? '관리처분' : /착공/.test(s) ? '착공' : /준공/.test(s) ? '준공' : /청산|이전고시/.test(s) ? '청산' : s; };

const rows = [];
for (const r of raw.rows || []) {
  if (!/^인천/.test(r['시도'] || '')) continue;
  const gu = clean(r['시군구']), n = clean(r['구역명칭']);
  if (!gu || !n || !GU[gu]) continue;
  const impl = noNum(r['사업시행자']);
  rows.push({ src: 'nat', si: gu, n, k: KIND(r['사업유형']), kRaw: noNum(r['사업유형']), st: STEP(r['현 사업추진단계']), sd: '', hh: +String(r['공급 예정 세대수'] || '').replace(/\D/g, '') || 0, impl: impl === '기타' ? '' : impl, dates: {} });
}

// ---------- 번호 ----------
const used = new Set();
for (const r of rows) {
  let h = hash(`${r.si}|${r.n}|${r.kRaw}`);
  while (used.has(h)) h = (h + 1) % 1000000;
  used.add(h); r.id = '28' + String(h).padStart(6, '0'); r.slug = GU[r.si];
  r.addr = r.si;
}

// ---------- ① 경계 이름으로 짝 ----------
const nc = s => String(s).replace(/\(.*?\)/g, '').replace(/구역|아파트|주변|주택|재개발|재건축|주거환경개선|사업|\s|,/g, '');
const core = s => String(s).replace(/\[|\]|<.*?>|\d{2,4}\.\d{1,2}\.\d{1,2}\.?/g, ' ').replace(/주택재개발|주택재건축|재개발|재건축|주거환경개선|정비사업|정비구역|사업구역|사업|구역|주택|아파트|지구|일원|번지|변경|지정|고시|통합|주변|자세한 사항은 건축과 문의|[\s,·()]/g, '');
const fk = f => String(f.properties?.k || '');
const kindOk = (r, f) => !['재개발', '재건축', '주거환경개선'].includes(fk(f)) || fk(f) === r.k;
const polys = f => { const g = f.geometry || {}; return g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : []; };
const thin = R => { const step = Math.max(1, Math.ceil(R.length / 160)); return R.filter((_, i) => i % step === 0 || i === R.length - 1).map(([x, y]) => [+x.toFixed(6), +y.toFixed(6)]); };
const inRing = (R, x, y) => { let c = false; for (let i = 0, j = R.length - 1; i < R.length; j = i++) { const [xi, yi] = R[i], [xj, yj] = R[j]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c; } return c; };
const area = R => { let a = 0; for (let i = 0, j = R.length - 1; i < R.length; j = i++) a += (R[j][0] * 88000) * (R[i][1] * 111000) - (R[i][0] * 88000) * (R[j][1] * 111000); return Math.abs(a / 2); };   // ㎡ (인천 위도 근사)
const claimed = new Set();
const named = JB.filter(f => f.properties?.named);
for (const r of rows) {
  const z = nc(r.n); if (!z) continue;
  const cs = named.filter(f => !claimed.has(f) && kindOk(r, f)).map(f => [f, core(f.properties.n)]);
  const big = L => L.map(([f]) => f).sort((a, b) => polys(b).reduce((s, p) => s + area(p[0] || []), 0) - polys(a).reduce((s, p) => s + area(p[0] || []), 0))[0];   // 같은 이름 경계가 둘이면 큰 쪽
  let f = big(cs.filter(([, c]) => c === z));
  if (!f) f = (cs.find(([, c]) => { const i = c.indexOf(z); return i >= 0 && !/[0-9가-힣]/.test(c[i + z.length] || ''); }) || [])[0];
  if (!f) continue;
  claimed.add(f); r.jb = f;
}
console.log(`경계 이름 짝: ${rows.filter(r => r.jb).length} / ${rows.length}`);

// ---------- ② 카카오 ----------
async function kakao(path, qs) {
  const res = await fetch(`https://dapi.kakao.com/v2/local/${path}.json?${qs}`, { headers: { Authorization: `KakaoAK ${KAKAO}` }, signal: AbortSignal.timeout(5000) });
  if (res.status === 401 || res.status === 403) throw Object.assign(new Error(`카카오 키 오류 HTTP ${res.status}`), { fatal: true });
  if (!res.ok) return null;
  return res.json();
}
// 좌표 → 법정동 코드·동 이름 (시세 찾기용)
async function region(lat, lng) {
  const k = `@${lat},${lng}`; if (memo.has(k)) return memo.get(k);
  if (!KAKAO) return null;
  const d = await kakao('geo/coord2regioncode', `x=${lng}&y=${lat}`);
  const b = (d && d.documents || []).find(x => x.region_type === 'B');
  const v = b ? [b.code || '', b.region_3depth_name || ''] : ['', ''];
  memo.set(k, v); await new Promise(s => setTimeout(s, 40));
  return v;
}
async function search(r) {
  const k = `${r.si}|${r.n}`; if (memo.has(k)) return memo.get(k);
  if (!KAKAO) return null;
  const nm = r.n.replace(/\(.*?\)/g, ' ').trim();
  const qs = [`인천 ${r.si} ${nm}`, `인천 ${r.si} ${nm}구역`, `${r.si} ${nm} ${r.k}`];
  let v = [0, 0, 'none'];
  for (const q of qs) {
    const d = await kakao('search/keyword', `size=5&query=${encodeURIComponent(q)}`);
    const p = (d && d.documents || []).find(x => /^인천/.test(x.address_name || '') && (x.address_name || '').includes(` ${r.si} `));
    if (p) { v = [+(+p.y).toFixed(6), +(+p.x).toFixed(6), 'kw']; break; }
    await new Promise(s => setTimeout(s, 40));
  }
  if (!v[0]) {   // '남촌동' · '연수1동' 같은 동 이름
    const d = await kakao('search/address', `size=1&query=${encodeURIComponent(`인천 ${r.si} ${nm}`)}`);
    const p = d && d.documents && d.documents[0];
    if (p) v = [+(+p.y).toFixed(6), +(+p.x).toFixed(6), 'addr'];
  }
  memo.set(k, v); await new Promise(s => setTimeout(s, 40));
  return v;
}
const T0 = Date.now(); let kw = 0, miss = 0;
for (const r of rows) {
  if (Date.now() - T0 > 12 * 60e3) break;
  try {
    if (r.jb) {
      const P = polys(r.jb); let n = 0, sx = 0, sy = 0; P.forEach(p => (p[0] || []).forEach(([x, y]) => { sx += x; sy += y; n++; }));
      if (n) { r.lat = +(sy / n).toFixed(6); r.lng = +(sx / n).toFixed(6); }
    } else {
      const v = await search(r);
      if (v && v[0] > 33) {
        [r.lat, r.lng] = v; kw++;
        const f = JB.find(f => !claimed.has(f) && kindOk(r, f) && polys(f).some(p => p[0] && inRing(p[0], r.lng, r.lat)));
        if (f) { claimed.add(f); r.jb = f; }
      } else miss++;
    }
    if (r.lat) { const g = await region(r.lat, r.lng); if (g) { r.bcode = g[0]; r.dong = g[1]; } }
  } catch (e) { if (e.fatal) { console.log(e.message); process.exit(1); } }
  if (r.jb) { r.ring = polys(r.jb).map(p => thin(p[0])); const a = Math.round(polys(r.jb).reduce((s, p) => s + area(p[0] || []), 0)); if (a >= 3000) r.ar = a; }   // 너무 작은 조각 경계는 면적 안 씀
  if (r.dong) r.addr = `${r.si} ${r.dong}`;
  delete r.jb; delete r.kRaw;
}
console.log(`카카오 장소 검색으로 찾음 ${kw} · 위치 못 찾음 ${miss} · 경계 있음 ${rows.filter(r => r.ring).length} / ${rows.length}`);

await writeFile('data/ic-geo-memo.json', JSON.stringify(Object.fromEntries(memo)));
await writeFile('data/ic-zones.json', JSON.stringify({ updated: raw.updated || new Date().toISOString().slice(0, 10), source: raw.source || '국토교통부_전국 도시정비사업 통합 데이터', n: rows.length, rows }));
console.log(`저장: 인천 ${rows.length}곳`);
