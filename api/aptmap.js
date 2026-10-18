// 지도 위 실거래가 라벨용: 한 시군구의 최근 매매(아파트·빌라·오피스텔)를 건물별로 묶어 좌표와 함께 반환
// GET /api/aptmap?kind=apt|rh|offi&lawd=11440&r=서울특별시 마포구
// 결과는 Vercel CDN에 6시간 캐시되므로, 같은 구를 여러 사람이 봐도 외부 API는 거의 다시 부르지 않습니다.
import { handler, send, fail, need, cached, getText, num, pool, vworldData, DATA_KEY, VWORLD_KEY, VWORLD_DOMAIN } from './_lib.js';
import { month, monthsBack } from './trades.js';

const MONTHS = 6;
const NAME = { apt: 'aptNm', rh: 'mhouseNm', offi: 'offiNm' };
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

// 시군구 안 법정동 이름 → 법정동코드(10자리). 실거래 자료에 코드가 없을 때 필지번호(PNU)를 만들기 위해 씁니다.
async function dongCodes(lawd) {
  return cached('emd:' + lawd, 30 * 24 * 3600e3, async () => {
    const out = {};
    try {
      const fs = await vworldData({ data: 'LT_C_ADEMD_INFO', attrFilter: `emd_cd:like:${lawd}`, geometry: 'false', size: '200' });
      for (const f of fs) { const p = f.properties || {}; const cd = String(p.emd_cd || ''); if (/^\d{8}$/.test(cd) && p.emd_kor_nm) out[String(p.emd_kor_nm).trim()] = cd + '00'; }
    } catch { /* 아래에서 처리 */ }
    if (!Object.keys(out).length) throw new Error('emd'); // 실패는 기억하지 않고 다음에 다시 시도
    return out;
  });
}

export default handler(async (req, res) => {
  if (!need(res, [DATA_KEY, 'DATA_GO_KR_KEY'])) return;
  const kind = NAME[req.query.kind] ? req.query.kind : 'apt';
  const lawd = clean(req.query.lawd);
  if (!/^\d{5}$/.test(lawd)) return fail(res, 400, 'bad_lawd', '시군구 코드(lawd) 5자리가 필요합니다.');
  // 시도·시군구 이름 (주소 → 좌표 변환용). 한글과 공백만 허용
  const region = clean(req.query.r).replace(/[^가-힣\s]/g, '').replace(/\s+/g, ' ').slice(0, 30);
  const t0 = Date.now();

  const yms = monthsBack(MONTHS);
  const [rs, codes] = await Promise.all([pool(yms, 3, ym => month(kind, lawd, ym)), VWORLD_KEY ? dongCodes(lawd).catch(() => ({})) : {}]);
  const errors = rs.filter(r => !r.ok).map(r => r.e.message);
  if (errors.length === rs.length) return fail(res, 502, 'datagokr', errors[0]);

  // 단지별로 묶기 (동 + 지번 + 단지명)
  const byKey = new Map();
  for (const r of rs) if (r.ok) for (const x of r.v) {
    if (clean(x.cdealType) === 'O' || clean(x.cdealDay)) continue; // 해제된 거래 제외
    const price = num(x.dealAmount); if (!price) continue;
    const umd = clean(x.umdNm), jibun = clean(x.jibun), name = clean(x[NAME[kind]] || x.aptNm || x.mhouseNm || x.offiNm);
    if (!umd || !jibun) continue;
    const date = `${x.dealYear}${String(x.dealMonth).padStart(2, '0')}${String(x.dealDay || '').padStart(2, '0')}`;
    const key = `${umd}|${jibun}|${name}`;
    let g = byKey.get(key);
    // 필지번호(PNU): 상세 자료에 법정동코드·본번·부번이 있으면 만들어 둡니다 (미리 불러오기용)
    const sg = clean(x.sggCd) || lawd, ud = clean(x.umdCd);
    let pnu = null;
    const jm = jibun.replace(/^산\s*/, '').match(/^(\d+)(?:-(\d+))?$/);
    const bjd = /^\d{5}$/.test(sg) && /^\d{5}$/.test(ud) ? sg + ud : codes[umd];
    if (bjd && jm) pnu = bjd + (/^산/.test(jibun) ? '2' : '1') + jm[1].padStart(4, '0') + (jm[2] || '0').padStart(4, '0');
    if (!g) byKey.set(key, g = { n: name, umd, jibun, a: `${region} ${umd} ${jibun}`.trim(), c: 0, d: '', pnu });
    g.c++;
    if (date > g.d) { g.d = date; g.p = price; g.ar = num(x.excluUseAr); g.f = clean(x.floor); g.y = clean(x.buildYear); }
  }
  const list = [...byKey.values()];

  // 좌표 붙이기 (시간이 너무 걸리면 나머지는 화면 쪽에서 카카오로 찾습니다)
  if (VWORLD_KEY && region) {
    await pool(list, 12, async g => {
      if (Date.now() - t0 > 4000) return;
      try { const p = await geocode(g.a); if (p) { g.lat = p.lat; g.lng = p.lng; } } catch { /* 건너뜀 */ }
    });
  }
  const items = list.map(({ umd, jibun, ...g }) => g);
  send(res, 200, { ok: true, kind, lawd, months: MONTHS, from: yms[yms.length - 1], items, errors }, errors.length ? 0 : 21600);
});
