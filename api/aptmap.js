// 지도 위 실거래가 라벨용: 한 시군구의 최근 아파트 매매를 단지별로 묶어 좌표와 함께 반환
// GET /api/aptmap?lawd=11440&r=서울특별시 마포구
// 결과는 Vercel CDN에 6시간 캐시되므로, 같은 구를 여러 사람이 봐도 외부 API는 거의 다시 부르지 않습니다.
import { handler, send, fail, need, cached, getText, num, pool, DATA_KEY, VWORLD_KEY, VWORLD_DOMAIN } from './_lib.js';
import { month, monthsBack } from './trades.js';

const MONTHS = 6;
const clean = s => String(s ?? '').trim();

// 브이월드 주소 → 좌표 (지번 주소)
async function geocode(addr) {
  return cached(`geo:${addr}`, 30 * 24 * 3600e3, async () => {
    const u = new URL('https://api.vworld.kr/req/address');
    const q = { service: 'address', request: 'getcoord', version: '2.0', crs: 'epsg:4326', address: addr, refine: 'true', simple: 'true', format: 'json', type: 'parcel', key: VWORLD_KEY };
    if (VWORLD_DOMAIN) q.domain = VWORLD_DOMAIN;
    for (const [k, v] of Object.entries(q)) u.searchParams.set(k, v);
    const { text } = await getText(u, { timeout: 5000, tries: 1 });
    let j; try { j = JSON.parse(text); } catch { return null; }
    const pt = j?.response?.status === 'OK' ? j.response.result?.point : null;
    return pt ? { lat: +(+pt.y).toFixed(6), lng: +(+pt.x).toFixed(6) } : null;
  });
}

export default handler(async (req, res) => {
  if (!need(res, [DATA_KEY, 'DATA_GO_KR_KEY'])) return;
  const lawd = clean(req.query.lawd);
  if (!/^\d{5}$/.test(lawd)) return fail(res, 400, 'bad_lawd', '시군구 코드(lawd) 5자리가 필요합니다.');
  // 시도·시군구 이름 (주소 → 좌표 변환용). 한글과 공백만 허용
  const region = clean(req.query.r).replace(/[^가-힣\s]/g, '').replace(/\s+/g, ' ').slice(0, 30);
  const t0 = Date.now();

  const yms = monthsBack(MONTHS);
  const rs = await pool(yms, 3, ym => month('apt', lawd, ym));
  const errors = rs.filter(r => !r.ok).map(r => r.e.message);
  if (errors.length === rs.length) return fail(res, 502, 'datagokr', errors[0]);

  // 단지별로 묶기 (동 + 지번 + 단지명)
  const byKey = new Map();
  for (const r of rs) if (r.ok) for (const x of r.v) {
    if (clean(x.cdealType) === 'O' || clean(x.cdealDay)) continue; // 해제된 거래 제외
    const price = num(x.dealAmount); if (!price) continue;
    const umd = clean(x.umdNm), jibun = clean(x.jibun), name = clean(x.aptNm);
    if (!umd || !jibun) continue;
    const date = `${x.dealYear}${String(x.dealMonth).padStart(2, '0')}${String(x.dealDay || '').padStart(2, '0')}`;
    const key = `${umd}|${jibun}|${name}`;
    let g = byKey.get(key);
    if (!g) byKey.set(key, g = { n: name, umd, jibun, a: `${region} ${umd} ${jibun}`.trim(), c: 0, d: '' });
    g.c++;
    if (date > g.d) { g.d = date; g.p = price; g.ar = num(x.excluUseAr); g.f = clean(x.floor); g.y = clean(x.buildYear); }
  }
  const list = [...byKey.values()];

  // 좌표 붙이기 (시간이 너무 걸리면 나머지는 화면 쪽에서 카카오로 찾습니다)
  if (VWORLD_KEY && region) {
    await pool(list, 8, async g => {
      if (Date.now() - t0 > 20000) return;
      try { const p = await geocode(g.a); if (p) { g.lat = p.lat; g.lng = p.lng; } } catch { /* 건너뜀 */ }
    });
  }
  const items = list.map(({ umd, jibun, ...g }) => g);
  send(res, 200, { ok: true, lawd, months: MONTHS, from: yms[yms.length - 1], items, errors }, 21600);
});
