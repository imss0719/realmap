// 건물 입점 업종: 소상공인시장진흥공단 상가(상권)정보 — 지번(PNU) 단위 조회
// GET /api/stores?pnu=...
import { handler, send, need, dataGoKrAll, dataGoKr, getText, splitPnu, cached, DATA_KEY } from './_lib.js';

const URL_PNU = 'https://apis.data.go.kr/B553077/api/open/sdsc2/storeListInPnu';
const clean = s => String(s ?? '').trim();

// 주변 버스정류장: GET /api/stores?near=bus&lat=..&lng=..
//  서울은 서울시 정류소정보(ws.bus.go.kr), 그 밖은 국토부 TAGO. 둘 다 공공데이터포털 활용신청이 필요합니다.
const dist = (a, b, c, d) => { const R = 6371e3, r = Math.PI / 180, x = (d - b) * r * Math.cos((a + c) / 2 * r), y = (c - a) * r; return Math.round(Math.sqrt(x * x + y * y) * R); };
async function busNear(lat, lng) {
  const out = [], errs = [];
  // 1) 서울
  try {
    const u = new URL('http://ws.bus.go.kr/api/rest/stationinfo/getStationByPos');
    u.searchParams.set('serviceKey', DATA_KEY); u.searchParams.set('tmX', lng.toFixed(6)); u.searchParams.set('tmY', lat.toFixed(6)); u.searchParams.set('radius', '700'); u.searchParams.set('resultType', 'json');
    const { text } = await getText(u, { timeout: 6000 });
    const j = JSON.parse(text);
    const list = (j.msgBody && j.msgBody.itemList) || [];
    for (const x of list) out.push({ name: String(x.stationNm || '').trim(), no: String(x.arsId || '').trim(), d: Number(x.dist) || dist(lat, lng, +x.gpsY, +x.gpsX) });
    if (!list.length && j.msgHeader && !['0', '4'].includes(String(j.msgHeader.headerCd))) errs.push('seoul:' + j.msgHeader.headerMsg);
  } catch (e) { errs.push('seoul:' + String(e.message).slice(0, 60)); }
  // 2) 서울 밖이거나 서울 결과가 없으면 TAGO
  if (!out.length) {
    try {
      const r = await dataGoKr('https://apis.data.go.kr/1613000/BusSttnInfoInqireService/getCrdntPrxmtSttnList', { gpsLati: lat.toFixed(6), gpsLong: lng.toFixed(6), numOfRows: 30, pageNo: 1, _type: 'json' });
      for (const x of r.items) out.push({ name: String(x.nodenm || '').trim(), no: String(x.nodeno || '').trim(), d: dist(lat, lng, +x.gpslati, +x.gpslong) });
    } catch (e) { errs.push('tago:' + String(e.message).slice(0, 60)); }
  }
  // 같은 이름(길 건너 양방향)은 가까운 쪽 하나만
  const seen = new Map();
  for (const x of out.filter(x => x.name && !/\(가상\)|가상정류장/.test(x.name)).sort((a, b) => a.d - b.d)) if (!seen.has(x.name)) seen.set(x.name, x);
  return { list: [...seen.values()].slice(0, 15), errs };
}

export default handler(async (req, res) => {
  if (!need(res, [DATA_KEY, 'DATA_GO_KR_KEY'])) return;
  if (req.query.near === 'bus') {
    const lat = Number(req.query.lat), lng = Number(req.query.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return send(res, 400, { ok: false, error: 'bad_point', message: '좌표가 올바르지 않습니다.' });
    const r = await cached(`bus:${lat.toFixed(4)},${lng.toFixed(4)}`, 7 * 864e5, async () => { const v = await busNear(lat, lng); if (!v.list.length && v.errs.length) { const e = new Error(v.errs.join(' / ')); throw e; } return v.list; }).catch(e => ({ fail: e.message }));
    if (r.fail) return send(res, 200, { ok: true, bus: [], note: r.fail }, 0);
    return send(res, 200, { ok: true, bus: r }, 86400);
  }
  const P = splitPnu(req.query.pnu);
  const items = await cached('stores:' + P.pnu, 24 * 3600e3, async () => {
    try { return await dataGoKrAll(URL_PNU, { key: P.pnu, type: 'json' }, { pageSize: 1000, maxPages: 5 }); }
    catch (e) { if (/03|NODATA|데이터없음|NO_DATA/i.test(e.message)) return []; throw e; }
  });
  const stores = items.map(x => ({
    name: clean(x.bizesNm) + (clean(x.brchNm) ? ' ' + clean(x.brchNm) : ''),
    l: clean(x.indsLclsNm), m: clean(x.indsMclsNm), s: clean(x.indsSclsNm),
    floor: clean(x.flrNo), ho: clean(x.hoNo), bld: clean(x.bldNm),
  }));
  send(res, 200, { ok: true, pnu: P.pnu, stores }, 86400);
});
