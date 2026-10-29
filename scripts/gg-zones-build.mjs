// 10/30 경기 정비사업 화면용 자료 만들기 (GitHub Actions에서 gg-zones.mjs 다음에 실행)
// 입력: data/gg-zones-raw.json (경기데이터드림 정비사업 추진현황 · 재개발·재건축·주거환경개선)
//       data/gg-bucheon.json   (부천시 엑셀 2026.6.30 · 가로주택정비·소규모재건축 — 경기도 자료에 없는 것만)
//       data/jeongbi-41.json   (국토부 정비구역 경계 · 좌표가 경계 안이면 그 경계를 구역 모양으로)
// 좌표: 카카오 주소 검색(비밀값 KAKAO_REST_KEY) · 찾은 좌표는 data/gg-geo-memo.json 에 기억 (다음엔 다시 안 찾음)
// 출력: data/gg-zones.json  rows = 구역마다 한 줄 (gg-pages.mjs 가 페이지로 만듦)
import { readFile, writeFile } from 'node:fs/promises';

const readJson = async (f, d = null) => { try { return JSON.parse(await readFile(f, 'utf8')); } catch { return d; } };
const KAKAO = (process.env.KAKAO_REST_KEY || '').trim();
const raw = await readJson('data/gg-zones-raw.json', { rows: [] });
const bch = await readJson('data/gg-bucheon.json', { rows: [] });
const JB = (await readJson('data/jeongbi-41.json', { features: [] })).features || [];
const memo = new Map(Object.entries(await readJson('data/gg-geo-memo.json', {})));

// 시 → 주소용 영문 (페이지 주소)
const SI = { '수원시': 'suwon', '성남시': 'seongnam', '고양시': 'goyang', '용인시': 'yongin', '부천시': 'bucheon', '안산시': 'ansan', '안양시': 'anyang', '남양주시': 'namyangju', '화성시': 'hwaseong', '평택시': 'pyeongtaek', '의정부시': 'uijeongbu', '시흥시': 'siheung', '파주시': 'paju', '김포시': 'gimpo', '광명시': 'gwangmyeong', '광주시': 'gwangju', '군포시': 'gunpo', '하남시': 'hanam', '오산시': 'osan', '이천시': 'icheon', '안성시': 'anseong', '의왕시': 'uiwang', '양주시': 'yangju', '포천시': 'pocheon', '여주시': 'yeoju', '과천시': 'gwacheon', '구리시': 'guri', '동두천시': 'dongducheon', '가평군': 'gapyeong', '양평군': 'yangpyeong', '연천군': 'yeoncheon' };
const NORTH = ['고양시', '의정부시', '남양주시', '파주시', '구리시', '포천시', '양주시', '동두천시', '가평군', '연천군'];

const clean = s => String(s ?? '').replace(/\s+/g, ' ').trim();
const ymd = v => { const s = String(v ?? '').replace(/\D/g, ''); return /^(19|20)\d{6}$/.test(s) ? `${s.slice(0, 4)}.${s.slice(4, 6)}.${s.slice(6, 8)}` : ''; };
const int = v => { const n = +String(v ?? '').replace(/[^\d.]/g, ''); return Number.isFinite(n) ? Math.round(n) : 0; };
const pct = v => { const m = String(v ?? '').replace(/,/g, '').match(/\d+(\.\d+)?/); const n = m ? +m[0] : 0; return n > 0 && n < 2000 ? n : 0; };   // '100~200%'는 앞 숫자
const hash = s => { let h = 2166136261; for (const c of s) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return (h >>> 0) % 1000000; };
const today = new Date().toISOString().slice(0, 10).replace(/-/g, '.');

// 단계 (경기도 자료 이름 그대로) — 화면 순서
const ST_DATE = { '예정구역': 'pre', '정비구역': 'zone', '추진위원회': 'comm', '조합설립': 'union', '사업시행': 'impl', '관리처분': 'mgmt', '착공': 'build', '준공': 'done', '청산': 'close' };

const rows = [];
// ---------- 1) 경기도 자료 ----------
for (const r of raw.rows || []) {
  const si = clean(r.SIGUN_NM), n = clean(r.IMPRV_ZONE_NM);
  if (!si || !n) continue;
  const dates = {
    pre: ymd(r.IMPRV_PREARNGE_ZONE_NOTIFC_DE), zone: ymd(r.IMPRV_ZONE_APPONT_FIRST_DE), zoneChg: ymd(r.IMPRV_ZONE_APPONT_CHANGE_DE),
    plan: ymd(r.IMPRV_PLAN_FOUNDNG_DE), comm: ymd(r.PROPLSN_COMMISN_APRV_DE), eval: ymd(r.PREPAR_EVALTN_DE), safe: ymd(r.SAFE_DIAGNS_DE),
    union: ymd(r.ASSOCTN_FOUND_CONFMTN_DE), impl: ymd(r.BIZ_IMPLMTN_CONFMTN_DE), mgmt: ymd(r.MANAGE_DISPOSIT_CONFMTN_DE), build: ymd(r.STRCONTR_DE),
    sale: ymd(r.GENRL_LOTOUT_DE), done: ymd(r.COMPLTN_DE), close: ymd(r.TRANSFR_NOTIFC_DE), zonePlan: ymd(r.IMPRV_ZONE_APPONT_PREARNGE_DE),
  };
  for (const k of Object.keys(dates)) if (!dates[k] || dates[k] > '2031') delete dates[k];   // 비어 있거나 먼 미래(예정일 표기)는 뺌
  const st = clean(r.BIZ_STEP_NM) || '예정구역';
  const sd = dates[ST_DATE[st]] || (st === '정비구역' ? dates.zoneChg : '') || '';
  const sale5 = [r.NWCNST_HUSNG_LTUTAR40MUD_DESC, r.NWCNST_HUSNG_LTUTAR4060M_DESC, r.NWCNST_HUSNG_LTUTAR6085M_DESC, r.NWCNST_HUSNG_LTUTAR85135M_DESC, r.NWCNST_HUSNGLTUTAR135MABV_DESC].map(int);
  const rent3 = [r.NWCONST_HUSNGRENTAR40MUD_DESC, r.NWCONST_HUSNGRENT_AR4060M_DESC, r.NWCONST_HUSNGRENT_AR6085M_DESC].map(int);
  const old5 = [r.EXISTNG_HSHLD_CNT_40_DESC, r.EXISTNG_HSHLD_CNT_40_60_DESC, r.EXISTNG_HSHLD_CNT_60_85_DESC, r.EXISTNG_HSHLD_CNT_85_135_DESC, r.EXISTNG_HSHLD_CNT_135_DESC].map(int);
  const sale = int(r.NWCONST_LOTOUT_HOUSNG_CNT) || (int(r.ASOCNTMB_LOTOUT_HSHLD_CNT) + int(r.GENRL_LOTOUT_HSHLD_CNT)) || sale5.reduce((a, b) => a + b, 0);
  const rent = int(r.NWCONST_RENT_HOUSNG_CNT) || int(r.RENT_HSHLD_CNT) || rent3.reduce((a, b) => a + b, 0);
  const addr = clean(r.LOCPLC_ADDR).replace(/^경기(도)?\s*/, '');
  rows.push({
    src: 'gg', si, n, k: clean(r.BIZ_TYPE_NM) || '정비사업', st, sd, addr, ar: int(r.ZONE_AR),
    hh: int(r.BIZ_IMPLMTN_HSHLD_CNT_TOTSUM) || sale + rent, sale, rent,
    memSale: int(r.ASOCNTMB_LOTOUT_HSHLD_CNT), genSale: int(r.GENRL_LOTOUT_HSHLD_CNT),
    mem: int(r.ASOCNTMB_CNT), owners: int(r.LAND_OWNER_CNT),
    oldHH: int(r.EXISTNG_HOUSNG_HSHLD_CNT), oldDong: int(r.EXISTNG_HOUSNG_COPPER_CNT), oldYear: clean(r.EXISTNG_HOUSNG_COMPLTN_PERD),
    oldFar: pct(r.EXISTNG_VOLUMRT_DESC), far: pct(r.NWCONST_VOLUMRT_DESC),
    mix: sale5.some(Boolean) || rent3.some(Boolean) ? { s: sale5, r: rent3 } : null, oldMix: old5.some(Boolean) ? old5 : null,
    impl: clean(r.BIZ_IMPLMNTR_NM), tel: clean(r.CHRGPSN_TELNO),
    period: [clean(r.BIZ_PREARNGE_BEGIN_PERD), clean(r.BIZ_PREARNGE_PERD)].filter(Boolean).join('~'),
    dates,
  });
}
// ---------- 2) 부천시 엑셀 (가로주택·소규모재건축만 — 재개발·재건축은 경기도 자료에 있음) ----------
const BC_ST = { '추진위원회': 'comm', '조합설립': 'union', '사업시행': 'impl', '관리처분': 'mgmt', '착공': 'build', '분양': 'sale', '준공': 'done', '청산': 'close' };
for (const r of bch.rows || []) {
  const dates = {}; for (const [k, v] of Object.entries(r.dates || {})) { const d = ymd(v); if (d && BC_ST[k]) dates[BC_ST[k]] = d; }
  rows.push({
    src: 'bc', si: '부천시', n: clean(r.n), k: r.k, st: r.st, sd: dates[ST_DATE[r.st]] || '', addr: `부천시 ${clean(r.a)}`, ar: Math.round(r.ar || 0),
    hh: r.hh || 0, sale: r.sale || 0, rent: r.rent || 0, far: r.far || 0, bcr: r.bc || 0, dongs: clean(r.dongs), dates,
  });
}

// ---------- 3) 번호 (관심 구역용 숫자 id · 41 + 6자리, 같은 이름은 계속 같은 번호) ----------
const used = new Set();
for (const r of rows) {
  let h = hash(`${r.src}|${r.si}|${r.n}|${r.addr}`);
  while (used.has(h)) h = (h + 1) % 1000000;
  used.add(h); r.id = '41' + String(h).padStart(6, '0'); r.slug = SI[r.si] || 'etc';
  r.rgn = NORTH.includes(r.si) ? '경기 북부' : '경기 남부';
}

// ---------- 4) 좌표 (카카오) ----------
const geoQ = r => {
  let a = r.addr.replace(/\(.*?\)/g, ' ').replace(/번지|일원|일대|외\s*\d+\s*(필지|개\s*필지)?|\s등(?=\s|$)/g, ' ').split(/[,·~]/)[0].replace(/\s+/g, ' ').trim();
  if (!a.startsWith(r.si.replace(/(시|군)$/, ''))) a = `${r.si} ${a}`;
  return '경기 ' + a;
};
async function kakao(path, q) {
  const res = await fetch(`https://dapi.kakao.com/v2/local/search/${path}.json?size=1&query=${encodeURIComponent(q)}`, { headers: { Authorization: `KakaoAK ${KAKAO}` }, signal: AbortSignal.timeout(5000) });
  if (res.status === 401 || res.status === 403) throw Object.assign(new Error(`카카오 키 오류 HTTP ${res.status}`), { fatal: true });
  if (!res.ok) return null;
  return (await res.json()).documents?.[0] || null;
}
async function geocode(r) {
  const q = geoQ(r);
  if (memo.has(q)) return memo.get(q);
  if (!KAKAO) return null;
  let d = await kakao('address', q), how = 'addr';
  if (!d) { const k = await kakao('keyword', `${r.si} ${r.n.replace(/\(.*?\)/g, ' ')}`); if (k && /^경기/.test(k.address_name || '')) { d = await kakao('address', k.address_name) || { x: k.x, y: k.y, address: null }; how = 'kw'; } }
  const a = d && (d.address || d.road_address) || {};
  const v = d ? [+(+d.y).toFixed(6), +(+d.x).toFixed(6), a.b_code || '', a.region_2depth_name || '', a.region_3depth_name || '', how] : [0, 0, '', '', '', 'none'];
  memo.set(q, v); await new Promise(s => setTimeout(s, 40));
  return v;
}
const T0 = Date.now(); let fresh = 0, miss = 0;
for (const r of rows) {
  if (Date.now() - T0 > 12 * 60e3) break;
  const had = memo.has(geoQ(r));
  let v = null; try { v = await geocode(r); } catch (e) { if (e.fatal) { console.log(e.message); process.exit(1); } }
  if (!had && v) fresh++;
  if (v && v[0] > 33) { [r.lat, r.lng, r.bcode, r.gu, r.dong] = v; } else miss++;
  if (!r.dong) r.dong = (r.addr.match(/(\S+?(동|읍|면|리|가)\d*가?)\s/) || [])[1] || '';
}
console.log(`좌표: 새로 찾음 ${fresh} · 못 찾음 ${miss} / ${rows.length}`);

// ---------- 5) 국토부 경계 (좌표가 경계 안이면) ----------
const inRing = (R, x, y) => { let c = false; for (let i = 0, j = R.length - 1; i < R.length; j = i++) { const [xi, yi] = R[i], [xj, yj] = R[j]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c; } return c; };
const polys = f => { const g = f.geometry || {}; return g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : []; };
const thin = R => { const step = Math.max(1, Math.ceil(R.length / 160)); return R.filter((_, i) => i % step === 0 || i === R.length - 1).map(([x, y]) => [+x.toFixed(6), +y.toFixed(6)]); };
let jbHit = 0;
for (const r of rows) {
  if (!r.lat) continue;
  const f = JB.find(f => polys(f).some(p => p[0] && inRing(p[0], r.lng, r.lat)));
  if (f) { r.ring = polys(f).map(p => thin(p[0])); if (!r.ar && f.properties?.a) r.ar = Math.round(f.properties.a); jbHit++; }
}
console.log(`경계 짝: ${jbHit}곳`);

await writeFile('data/gg-geo-memo.json', JSON.stringify(Object.fromEntries(memo)));
await writeFile('data/gg-zones.json', JSON.stringify({ updated: raw.updated || today.replace(/\./g, '-'), bcUpdated: bch.updated || '', source: raw.source, n: rows.length, rows }));
console.log(`저장: ${rows.length}곳 (경기도 ${rows.filter(r => r.src === 'gg').length} · 부천 엑셀 ${rows.filter(r => r.src === 'bc').length})`);
