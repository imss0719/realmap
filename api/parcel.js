// 좌표(또는 PNU) → 필지 경계·PNU·지번
// GET /api/parcel?lat=37.55&lng=126.93   또는   /api/parcel?pnu=1144010700100330001
import { handler, send, fail, need, vworldData, cached, VWORLD_KEY } from './_lib.js';

export default handler(async (req, res) => {
  if (!need(res, [VWORLD_KEY, 'VWORLD_KEY'])) return;
  const { lat, lng, pnu } = req.query;
  let params;
  if (pnu) params = { data: 'LP_PA_CBND_BUBUN', attrFilter: `pnu:=:${String(pnu).replace(/\D/g, '')}` };
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
