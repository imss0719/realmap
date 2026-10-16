// 건물 입점 업종: 소상공인시장진흥공단 상가(상권)정보 — 지번(PNU) 단위 조회
// GET /api/stores?pnu=...
import { handler, send, need, dataGoKrAll, splitPnu, cached, DATA_KEY } from './_lib.js';

const URL_PNU = 'https://apis.data.go.kr/B553077/api/open/sdsc2/storeListInPnu';
const clean = s => String(s ?? '').trim();

export default handler(async (req, res) => {
  if (!need(res, [DATA_KEY, 'DATA_GO_KR_KEY'])) return;
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
