// 호가 장부(선배 PC 프로그램)용 아파트 실거래 요약 — 읽기 전용
// 공공데이터(국토부 실거래)만 내려 줍니다. 네이버 호가 같은 자료는 받지도, 저장하지도 않습니다.
// 기존 trades.js의 월별 실거래 받기(month)와 그 캐시를 그대로 빌려 씁니다. 기존 파일은 바꾸지 않습니다.
//
// GET /api/hoga?op=find&lawd=11440&q=마포래미안
//   → 최근 3개월 그 구에서 거래된 아파트 중 이름이 비슷한 단지 목록 [{name, umd, jibun, n}]
// GET /api/hoga?op=sum&lawd=11440&names=마포래미안푸르지오|마포래미안푸르지오1단지&umd=아현동&months=6
//   → 그 단지들의 최근 n개월 매매·전세 실거래 (취소 건 제외, 칸은 짧게)
import { handler, send, fail, need, pool, DATA_KEY } from './_lib.js';
import { month, monthsBack } from './trades.js';

const clean = s => String(s ?? '').trim();
const norm = s => clean(s).replace(/\s|\(.*?\)|아파트|APT/gi, '');
const n = v => { const x = Number(String(v ?? '').replace(/,/g, '').trim()); return Number.isFinite(x) ? x : 0; };
const cancelled = r => clean(r.cdealType) === 'O' || !!clean(r.cdealDay);
const ymd = r => `${r.dealYear}${String(r.dealMonth).padStart(2, '0')}${String(r.dealDay || '').padStart(2, '0')}`;

export default handler(async (req, res) => {
  // PC에서 바로 연 파일(주소 없음)에서도 부를 수 있게 — 읽기 전용 공공자료라 열어 둡니다
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return fail(res, 405, 'method', 'GET만 됩니다.');
  if (!need(res, [DATA_KEY, 'DATA_GO_KR_KEY'])) return;

  const lawd = clean(req.query.lawd);
  if (!/^\d{5}$/.test(lawd)) return fail(res, 400, 'bad_lawd', '시군구 코드(5자리)를 넣어 주세요.');
  const op = clean(req.query.op) || 'sum';

  if (op === 'find') {
    const q = norm(req.query.q);
    if (q.length < 2) return fail(res, 400, 'bad_q', '단지 이름을 두 글자 이상 넣어 주세요.');
    const yms = monthsBack(3);
    const got = await pool(yms, 3, ym => month('apt', lawd, ym));
    const map = new Map();
    got.forEach(r => {
      if (!r.ok) return;
      for (const t of r.v) {
        const nm = clean(t.aptNm), key = nm + '|' + clean(t.umdNm);
        const k = norm(nm);
        // 앞 네 글자가 같거나 서로 포함되면 후보 (예: 마포래미안푸르지오 ↔ 마포래미안푸르지오1단지)
        const hit = k.includes(q) || q.includes(k) || (q.length >= 4 && k.startsWith(q.slice(0, 4)));
        if (!hit) continue;
        const o = map.get(key) || { name: nm, umd: clean(t.umdNm), jibun: clean(t.jibun), n: 0 };
        o.n++; map.set(key, o);
      }
    });
    const list = [...map.values()].sort((a, b) => b.n - a.n).slice(0, 20);
    return send(res, 200, { ok: true, lawd, items: list, errors: got.filter(r => !r.ok).length }, 21600);
  }

  if (op === 'sum') {
    const names = new Set(String(req.query.names || '').split('|').map(clean).filter(Boolean).slice(0, 8));
    if (!names.size) return fail(res, 400, 'bad_names', '단지 이름(names)을 넣어 주세요.');
    const umd = clean(req.query.umd);
    const months = Math.min(12, Math.max(3, Number(req.query.months) || 6));
    const yms = monthsBack(months);
    const jobs = [];
    for (const k of ['apt', 'aptRent']) for (const ym of yms) jobs.push([k, ym]);
    const got = await pool(jobs, 4, ([k, ym]) => month(k, lawd, ym));
    const sale = [], jeonse = [];
    let errors = 0;
    got.forEach((r, i) => {
      if (!r.ok) { errors++; return; }
      const kind = jobs[i][0];
      for (const t of r.v) {
        if (!names.has(clean(t.aptNm))) continue;
        if (umd && clean(t.umdNm) && clean(t.umdNm) !== umd) continue;
        const ex = n(t.excluUseAr);
        if (kind === 'apt') {
          if (cancelled(t)) continue;
          const p = n(t.dealAmount); if (p) sale.push([ymd(t), ex, clean(t.floor), p]);
        } else {
          const dep = n(t.deposit), rent = n(t.monthlyRent);
          if (dep && !rent) jeonse.push([ymd(t), ex, clean(t.floor), dep]);   // 전세만 (월세 빼고)
        }
      }
    });
    sale.sort((a, b) => b[0].localeCompare(a[0]));
    jeonse.sort((a, b) => b[0].localeCompare(a[0]));
    // 칸: [거래일 YYYYMMDD, 전용㎡, 층, 금액(만원)]
    return send(res, 200, { ok: true, lawd, months, sale: sale.slice(0, 600), jeonse: jeonse.slice(0, 600), errors }, errors ? 0 : 21600);
  }

  return fail(res, 400, 'bad_op', 'op는 find 또는 sum 입니다.');
});
