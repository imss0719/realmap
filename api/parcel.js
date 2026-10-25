// 좌표(또는 PNU) → 필지 경계·PNU·지번
// GET /api/parcel?lat=37.55&lng=126.93   또는   /api/parcel?pnu=1144010700100330001
// GET /api/parcel?pnu=…&dongs=1  → 그 단지(필지) 안 건물들의 동 이름·위치 (읽기 전용 · 동별 지도 준비용 확인)
import { handler, send, fail, need, vworldData, cached, VWORLD_KEY } from './_lib.js';

export default handler(async (req, res) => {
  if (!need(res, [VWORLD_KEY, 'VWORLD_KEY'])) return;
  const { lat, lng } = req.query;
  let { pnu } = req.query;
  if (pnu !== undefined) {
    pnu = String(pnu).replace(/\D/g, '');
    if (pnu.length !== 19) return fail(res, 400, 'bad_pnu', '단지(필지)번호를 확인해 주세요. 19자리 숫자여야 합니다.');
  }
  if (req.query.dongs) {
    if (!pnu) return fail(res, 400, 'bad_pnu', '단지(필지)번호를 확인해 주세요. 19자리 숫자여야 합니다.');
    const d = await dongs(pnu);
    return send(res, 200, d, d.ok && d.total ? 86400 : 0);
  }
  let params;
  if (pnu) params = { data: 'LP_PA_CBND_BUBUN', attrFilter: `pnu:=:${pnu}` };
  else {
    const la = Number(lat), ln = Number(lng);
    if (!Number.isFinite(la) || !Number.isFinite(ln)) return fail(res, 400, 'bad_point', '좌표가 올바르지 않습니다.');
    params = { data: 'LP_PA_CBND_BUBUN', geomFilter: `POINT(${ln.toFixed(7)} ${la.toFixed(7)})` };
  }
  const key = 'parcel:' + JSON.stringify(params);
  const features = await cached(key, 6 * 3600e3, () => vworldData(params));
  if (!features.length) return fail(res, 404, 'not_found', '이 위치에서 필지를 찾지 못했습니다. 도로나 하천일 수 있습니다.');
  const f = features[0], p = f.properties || {};
  // 이 자리에 선 건물의 대표 지번 (도로명주소 건물 → 건물관리번호 앞 19자리 = 대표 필지 PNU)
  let bldPnu = null;
  if (!pnu) {
    try {
      const b = await cached('spbd:' + params.geomFilter, 24 * 3600e3, () => vworldData({ data: 'LT_C_SPBD', geomFilter: params.geomFilter, geometry: 'false', size: '1' }));
      const sn = String(b[0]?.properties?.bd_mgt_sn || '').replace(/\D/g, '');
      // 건물관리번호 11번째 자리(산 여부)는 자료에 따라 PNU식(1=일반·2=산)과 0=일반·1=산이 섞여 있어,
      // 가능한 후보를 만든 뒤 실제로 존재하는 필지만 대표 필지로 인정합니다.
      if (sn.length >= 19) {
        const head = sn.slice(0, 10), tail = sn.slice(11, 19), f = sn[10];
        const cands = [...new Set([f === '0' ? '1' : f, f === '0' ? null : (f === '1' ? '1' : null), f === '1' ? '2' : null].filter(x => x === '1' || x === '2'))].map(x => head + x + tail);
        for (const bp of cands) {
          if (bp === p.pnu) break;
          const hit = await cached('parcel-exists:' + bp, 24 * 3600e3, () => vworldData({ data: 'LP_PA_CBND_BUBUN', attrFilter: `pnu:=:${bp}`, geometry: 'false', size: '1' }));
          if (hit.length) { bldPnu = bp; break; }
        }
      }
    } catch { /* 건물 정보가 없으면 건너뜀 */ }
  }
  send(res, 200, {
    ok: true,
    pnu: p.pnu,
    jibun: p.jibun || '',          // 예: "33-1대"
    addr: p.addr || '',            // 예: "서울특별시 마포구 노고산동 33-1"
    geometry: f.geometry,          // GeoJSON (경도, 위도)
    bldPnu,                        // 이 필지에 걸친 건물의 대표 필지 (다를 때만)
  }, 86400);
});

// ---------- 동 위치 (확인 단계) ----------
// 필지 경계 안(또는 건물관리번호의 대표 필지가 이 필지)인 도로명주소 건물(LT_C_SPBD)을 모아 동 이름과 중심점을 돌려줍니다.
const polys = g => !g ? [] : g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
function inRing(x, y, ring) {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c;
  }
  return c;
}
const inGeom = (x, y, g) => polys(g).some(P => inRing(x, y, P[0]) && !P.slice(1).some(h => inRing(x, y, h)));
function center(g) {   // 가장 큰 외곽선의 면적 중심
  let best = null, bestA = 0;
  for (const P of polys(g)) {
    const r = P[0], [ox, oy] = r[0]; let a = 0, cx = 0, cy = 0;   // 첫 꼭짓점 기준으로 옮겨 계산 (경위도 큰 수끼리 곱할 때 생기는 오차 방지)
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const xj = r[j][0] - ox, yj = r[j][1] - oy, xi = r[i][0] - ox, yi = r[i][1] - oy, f = xj * yi - xi * yj;
      a += f; cx += (xj + xi) * f; cy += (yj + yi) * f;
    }
    if (Math.abs(a) > bestA) { bestA = Math.abs(a); best = [ox + cx / (3 * a), oy + cy / (3 * a)]; }
    else if (!best) best = r[0];
  }
  return best;
}
// "101동" · "제101동" · "A동" · "가동" (앞이 띄어쓰기·괄호거나 맨 앞일 때만 — "노고산동" 같은 법정동 이름은 제외)
const DONG = /(?:^|[\s(제])(\d{1,4}|[A-Za-z]|[가-하])\s*동\)?$/;
const DONG_FIELDS = ['buld_nm_dc', 'bul_dpn_se', 'buld_nm', 'dong_nm', 'bld_nm'];
function dongOf(p) {
  const keys = [...DONG_FIELDS.filter(k => k in p), ...Object.keys(p).filter(k => !DONG_FIELDS.includes(k) && !/emd|li_nm|sig|sido|rd_nm|adr/i.test(k))];
  for (const k of keys) { const v = String(p[k] ?? '').trim(), m = v.match(DONG); if (m) return { dong: m[1].toUpperCase() + '동', from: k }; }
  return null;
}
const r6 = n => Math.round(n * 1e6) / 1e6;
// 건물 배치는 거의 바뀌지 않으므로 결과를 30일 보관 (Redis 'rmc:dongr:'), 건물을 하나도 못 찾은 결과는 보관하지 않음
async function dongs(pnu) {
  try {
    return await cached('dongr:' + pnu, 24 * 3600e3, async () => { const r = await dongsNow(pnu); if (!r.ok || !r.total) throw Object.assign(new Error('empty'), { res: r }); return r; });
  } catch (e) { if (e.res) return e.res; throw e; }
}
async function dongsNow(pnu) {
  const par = await cached('parcel:' + JSON.stringify({ data: 'LP_PA_CBND_BUBUN', attrFilter: `pnu:=:${pnu}` }), 6 * 3600e3, () => vworldData({ data: 'LP_PA_CBND_BUBUN', attrFilter: `pnu:=:${pnu}` }));
  if (!par.length) return { ok: false, error: 'not_found', message: '이 번호의 필지를 찾지 못했습니다.' };
  const pg = par[0].geometry, pp = par[0].properties || {};
  let x1 = 180, y1 = 90, x2 = -180, y2 = -90;
  for (const P of polys(pg)) for (const [x, y] of P[0]) { x1 = Math.min(x1, x); x2 = Math.max(x2, x); y1 = Math.min(y1, y); y2 = Math.max(y2, y); }
  const pad = 0.0008;   // 약 80m — 옆 필지에 걸친 같은 단지 건물까지
  const box = `BOX(${(x1 - pad).toFixed(6)},${(y1 - pad).toFixed(6)},${(x2 + pad).toFixed(6)},${(y2 + pad).toFixed(6)})`;
  const feats = [];
  for (let page = 1; page <= 3; page++) {
    const f = await vworldData({ data: 'LT_C_SPBD', geomFilter: box, size: '1000', page: String(page) });
    feats.push(...f); if (f.length < 1000) break;
  }
  const same = sn => sn.length >= 19 && sn.slice(0, 10) === pnu.slice(0, 10) && sn.slice(11, 19) === pnu.slice(11, 19);
  const out = [], sample = [];
  for (const f of feats) {
    const p = f.properties || {}, c = center(f.geometry); if (!c) continue;
    const sn = String(p.bd_mgt_sn || '').replace(/\D/g, ''), inside = inGeom(c[0], c[1], pg), bySn = same(sn);
    if (!inside && !bySn) continue;
    if (sample.length < 3) sample.push(p);
    const d = dongOf(p);
    out.push({
      dong: d ? d.dong : '', from: d ? d.from : '', name: String(p.buld_nm || '').trim(), floors: Number(p.gro_flo_co) || null,
      lat: r6(c[1]), lng: r6(c[0]), inside, bySn,
      ring: (polys(f.geometry)[0]?.[0] || []).map(([x, y]) => [r6(x), r6(y)]),
    });
  }
  const key = s => { const m = s.dong.match(/^(\d+)/); return m ? [0, +m[1], ''] : s.dong ? [1, 0, s.dong] : [2, 0, s.name]; };
  out.sort((a, b) => { const A = key(a), B = key(b); return A[0] - B[0] || A[1] - B[1] || A[2].localeCompare(B[2]); });
  return {
    ok: true, pnu, addr: pp.addr || '', jibun: pp.jibun || '', parcel: pg,
    total: out.length, named: out.filter(b => b.dong).length, nearby: feats.length,
    buildings: out,
    sample,   // 원본 속성 몇 개 (어느 칸에 동 이름이 들어 있는지 확인용)
  };
}
