// 지도 위 실거래가 라벨용: 한 시군구의 최근 매매(아파트·빌라·오피스텔)를 건물별로 묶어 좌표와 함께 반환
// GET  /api/aptmap?kind=apt|rh|offi&lawd=11440&r=서울특별시 마포구
// POST /api/aptmap  { lawd, pts: [[주소, 위도, 경도], ...] }  ← 화면(카카오)에서 찾은 좌표를 공용 좌표장에 보태기
// GET  /api/aptmap?...&debug=geo  ← 브이월드 주소 검색이 왜 실패하는지 확인
// 좌표는 구별 '좌표장'(창고 rmc:geo:<시군구코드>)에 모아 두고 계속 다시 씁니다.
// 그래서 한 사람이 한 번 찾은 건물 좌표는 다음 사람(처음 들어온 휴대폰·인스타 브라우저 포함)에게 바로 보입니다.
import { handler, send, fail, need, cached, getText, num, pool, rcmd, vworldData, DATA_KEY, VWORLD_KEY, VWORLD_DOMAIN } from './_lib.js';
import { month, monthsBack } from './trades.js';

const MONTHS = 6;
const NAME = { apt: 'aptNm', rh: 'mhouseNm', offi: 'offiNm' };
const clean = s => String(s ?? '').trim();
const GEO_DAYS = 180;
const geoKey = lawd => `rmc:geo:${lawd}`;
// 대한민국 범위 안의 좌표인지
const inKorea = (lat, lng) => lat > 33 && lat < 38.7 && lng > 124.5 && lng < 132;

// 브이월드 주소 → 좌표 (지번 주소). 찾으면 {lat,lng}, 주소가 없으면 null, 서비스 오류면 예외
async function geocode(addr) {
  const u = new URL('https://api.vworld.kr/req/address');
  const q = { service: 'address', request: 'getcoord', version: '2.0', crs: 'epsg:4326', address: addr, refine: 'true', simple: 'true', format: 'json', type: 'parcel', key: VWORLD_KEY };
  if (VWORLD_DOMAIN) q.domain = VWORLD_DOMAIN;
  for (const [k, v] of Object.entries(q)) u.searchParams.set(k, v);
  const { status, text } = await getText(u, { timeout: 5000, tries: 1 });
  let j; try { j = JSON.parse(text); } catch { throw new Error(`브이월드 응답 해석 실패 (HTTP ${status}) ${text.slice(0, 120)}`); }
  const st = j?.response?.status;
  if (st === 'NOT_FOUND') return null;
  if (st !== 'OK') throw new Error(`브이월드 ${st || '응답 없음'} ${JSON.stringify(j?.response?.error || '').slice(0, 160)}`);
  const pt = j.response.result?.point;
  return pt ? { lat: +(+pt.y).toFixed(6), lng: +(+pt.x).toFixed(6) } : null;
}

// 좌표장 읽기: { 주소: 'lat,lng' | '0'(브이월드에 없음) }
async function readBook(lawd) {
  const arr = await rcmd(['HGETALL', geoKey(lawd)], 2500);
  const out = {};
  if (Array.isArray(arr)) for (let i = 0; i + 1 < arr.length; i += 2) out[arr[i]] = arr[i + 1];
  else if (arr && typeof arr === 'object') Object.assign(out, arr);
  return out;
}
async function writeBook(lawd, pairs) {
  if (!pairs.length) return;
  await rcmd(['HSET', geoKey(lawd), ...pairs.flat()], 2500);
  await rcmd(['EXPIRE', geoKey(lawd), String(GEO_DAYS * 86400)], 1500);
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
  if (req.method === 'POST') return addPoints(req, res);
  if (!need(res, [DATA_KEY, 'DATA_GO_KR_KEY'])) return;
  const kind = NAME[req.query.kind] ? req.query.kind : 'apt';
  const lawd = clean(req.query.lawd);
  if (!/^\d{5}$/.test(lawd)) return fail(res, 400, 'bad_lawd', '시군구 코드(lawd) 5자리가 필요합니다.');
  // 시도·시군구 이름 (주소 → 좌표 변환용). 한글과 공백만 허용
  const region = clean(req.query.r).replace(/[^가-힣\s]/g, '').replace(/\s+/g, ' ').slice(0, 30);
  const t0 = Date.now();

  if (req.query.debug === 'geo') {
    const a = `${region || '서울특별시 마포구'} 아현동 275-2`;
    try { return send(res, 200, { ok: true, addr: a, domain: VWORLD_DOMAIN, result: await geocode(a) }); }
    catch (e) { return send(res, 200, { ok: false, addr: a, domain: VWORLD_DOMAIN, message: e.message }); }
  }

  const yms = monthsBack(MONTHS);
  const [rs, codes, book] = await Promise.all([
    pool(yms, 3, ym => month(kind, lawd, ym)),
    VWORLD_KEY ? dongCodes(lawd).catch(() => ({})) : {},
    readBook(lawd).catch(() => ({})),
  ]);
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
    // 국민평형(전용 84㎡ 전후, 80~86㎡) 최근 거래가 — 화면의 '이 지역 아파트 평균'에 씀
    const ar = num(x.excluUseAr);
    if (ar >= 80 && ar <= 86 && date > (g.d84 || '')) { g.d84 = date; g.p84 = price; }
    if (date > g.d) { g.d = date; g.p = price; g.ar = num(x.excluUseAr); g.f = clean(x.floor); g.y = clean(x.buildYear); }
  }
  const list = [...byKey.values()];

  // 1) 좌표장에 있는 좌표부터 붙이기
  const todo = [];
  for (const g of list) {
    const v = book[g.a];
    if (v && v !== '0') { const [la, ln] = v.split(',').map(Number); if (inKorea(la, ln)) { g.lat = la; g.lng = ln; continue; } }
    if (!v) todo.push(g); // '0' = 브이월드에 없는 주소 → 화면(카카오)에서 찾음
  }
  // 2) 좌표장에 없는 것만 브이월드로 (시간이 걸리면 나머지는 화면 쪽에서 카카오로 찾습니다)
  const fresh = [];
  let geoErr = null;
  if (VWORLD_KEY && region && todo.length) {
    await pool(todo, 12, async g => {
      if (geoErr || Date.now() - t0 > 4000) return;
      try {
        const p = await geocode(g.a);
        if (p && inKorea(p.lat, p.lng)) { g.lat = p.lat; g.lng = p.lng; fresh.push([g.a, `${p.lat},${p.lng}`]); }
        else fresh.push([g.a, '0']);
      } catch (e) { geoErr = e.message; } // 한도 초과 등 서비스 오류면 이번 요청에서는 더 부르지 않음
    });
  }
  await writeBook(lawd, fresh).catch(() => {});

  const items = list.map(({ umd, jibun, ...g }) => g);
  const missing = items.filter(x => x.lat == null).length;
  // 좌표가 많이 빠진 결과는 CDN에 오래 두지 않음 (좌표장이 채워지는 대로 다시 받도록)
  const ttl = errors.length ? 0 : missing > items.length * 0.1 ? 600 : 21600;
  send(res, 200, { ok: true, kind, lawd, months: MONTHS, from: yms[yms.length - 1], items, errors, ...(geoErr ? { geoErr } : {}) }, ttl);
});

// 화면에서 카카오로 찾은 좌표를 좌표장에 보태기 (비어 있는 주소만 채움, 이미 있는 좌표는 덮어쓰지 않음)
async function addPoints(req, res) {
  let body; try { body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {}); } catch { body = {}; }
  const lawd = clean(body.lawd);
  if (!/^\d{5}$/.test(lawd) || !Array.isArray(body.pts)) return fail(res, 400, 'bad_req', '형식이 맞지 않습니다.');
  const book = await readBook(lawd).catch(() => ({}));
  const add = [];
  for (const p of body.pts.slice(0, 60)) {
    if (!Array.isArray(p)) continue;
    const a = clean(p[0]).slice(0, 80), la = +(+p[1]).toFixed(6), ln = +(+p[2]).toFixed(6);
    if (!/^[가-힣\s]+ [가-힣0-9.]+ (산\s*)?\d+(-\d+)?$/.test(a) || !inKorea(la, ln)) continue;
    const v = book[a];
    if (v && v !== '0') continue;
    add.push([a, `${la},${ln}`]);
  }
  await writeBook(lawd, add).catch(() => {});
  send(res, 200, { ok: true, added: add.length });
}
