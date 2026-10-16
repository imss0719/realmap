// 브이월드 도시계획·개발 레이어 (지도 화면의 약 1km 칸 단위로 가져옵니다)
// GET /api/layer?layer=jigu&tile=12693,3755
import { handler, send, fail, need, vworldData, cached, VWORLD_KEY } from './_lib.js';

export const LAYERS = {
  jigu:   { id: 'LT_C_UPISUQ161', label: '지구단위계획구역' },
  toheo:  { id: 'LT_C_UPISUQ175', label: '토지거래허가구역' },
  road:   { id: 'LT_C_UPISUQ151', label: '도시계획도로' },
  trans:  { id: 'LT_C_UPISUQ152', label: '도시계획 교통시설' },
  park:   { id: 'LT_C_UPISUQ153', label: '도시계획 공간시설(공원 등)' },
  gb:     { id: 'LT_C_UD801',     label: '개발제한구역' },
  market: { id: 'LT_C_UB901',     label: '시장정비구역' },
  devlim: { id: 'LT_C_UPISUQ171', label: '개발행위허가제한지역' },
};
export const TILE = 0.01; // 도(degree) 단위 칸 크기

export default handler(async (req, res) => {
  if (!need(res, [VWORLD_KEY, 'VWORLD_KEY'])) return;
  const L = LAYERS[req.query.layer];
  if (!L) return fail(res, 400, 'bad_layer', '알 수 없는 레이어입니다.');
  const [tx, ty] = String(req.query.tile || '').split(',').map(Number);
  if (!Number.isInteger(tx) || !Number.isInteger(ty)) return fail(res, 400, 'bad_tile', '칸 번호가 올바르지 않습니다.');
  const minx = (tx * TILE).toFixed(4), miny = (ty * TILE).toFixed(4), maxx = ((tx + 1) * TILE).toFixed(4), maxy = ((ty + 1) * TILE).toFixed(4);

  const feats = await cached(`layer:${L.id}:${tx},${ty}`, 24 * 3600e3, async () => {
    const out = [];
    for (let page = 1; page <= 5; page++) {
      const f = await vworldData({ data: L.id, geomFilter: `BOX(${minx},${miny},${maxx},${maxy})`, size: '1000', page: String(page) });
      out.push(...f);
      if (f.length < 1000) break;
    }
    return out.map(f => {
      const p = f.properties || {};
      // 짧은 글자 속성만 남김 (구역명 등)
      const props = {};
      for (const [k, v] of Object.entries(p)) if (typeof v === 'string' && v && v.length < 60) props[k] = v;
      return { id: f.id || p.id || JSON.stringify(props).slice(0, 80), g: f.geometry, p: props };
    });
  });
  send(res, 200, { ok: true, layer: req.query.layer, label: L.label, features: feats }, 86400);
});
