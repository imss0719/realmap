// 호가 장부(선배 PC 프로그램)용 아파트 실거래 요약 — 읽기 전용
// 공공데이터(국토부 실거래)만 내려 줍니다. 네이버 호가 같은 자료는 받지도, 저장하지도 않습니다.
// 기존 trades.js의 월별 실거래 받기(month)와 그 캐시를 그대로 빌려 씁니다. 기존 파일은 바꾸지 않습니다.
//
// 요청 머리에 X-Hoga-Key: <비밀번호> 가 있어야 합니다 (틀리면 401, 환경변수 없으면 503).
// GET /api/hoga?op=find&lawd=11440&q=마포래미안
//   → 최근 6개월 그 구에서 거래된 아파트 중 이름이 비슷한 단지 목록 [{name, umd, jibun, n}] (&all=1 이면 그 구 전체)
// GET /api/hoga?op=sum&lawd=11440&names=마포래미안푸르지오|마포래미안푸르지오1단지&umd=아현동&months=12
//   → 그 단지들의 최근 n개월 매매 + 최근 6개월 전세 실거래 (취소 건 제외, 칸은 짧게) · 결과 6시간 저장
// GET /api/hoga?op=area&lawd=11440
//   → 그 구 최근 6개월 아파트 매매를 단지·평형대(59/84/L)별로 묶은 요약 (후보 단지 찾기용) · 결과 6시간 저장
//
// 11/7 운영 검토 반영: ① 하루 호출 상한 300번(넘으면 429 limit) — 공공데이터 호출 한도를 회원 화면과 같이 쓰므로
//   ② area·sum 결과를 Redis에 6시간 저장해 다시 씀 ③ 전월세(자료가 커서 저장 안 됨)는 최근 6개월만 받음
import { timingSafeEqual } from 'node:crypto';
import { handler, send, fail, need, pool, rcmd, DATA_KEY } from './_lib.js';
import { month, monthsBack } from './trades.js';

// 선배만 쓰도록 비밀번호: Vercel 환경변수 HOGA_KEY. 비어 있으면 아무도 못 씀(잠김).
const HOGA_KEY = (process.env.HOGA_KEY || '').trim();
function keyOk(got) {
  const a = Buffer.from(String(got || '')), b = Buffer.from(HOGA_KEY);
  return HOGA_KEY.length > 0 && a.length === b.length && timingSafeEqual(a, b);
}

const clean = s => String(s ?? '').trim();
const norm = s => clean(s).replace(/\s|\(.*?\)|아파트|APT/gi, '');
const n = v => { const x = Number(String(v ?? '').replace(/,/g, '').trim()); return Number.isFinite(x) ? x : 0; };
const cancelled = r => clean(r.cdealType) === 'O' || !!clean(r.cdealDay);
const DAILY_MAX = 300, KEEP_SEC = 6 * 3600;
const kstDay = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10).replace(/-/g, '');
// 하루 사용량 세기 (Redis가 안 되면 막지 않음 — 회원 기능과 무관)
async function overLimit() {
  const k = 'hoga:cnt:' + kstDay();
  const c = await rcmd(['INCR', k]);
  if (c == null) return false;
  if (c === 1) await rcmd(['EXPIRE', k, String(2 * 86400)]);
  return c > DAILY_MAX;
}
async function keepGet(k) { const s = await rcmd(['GET', k]); if (!s) return null; try { return JSON.parse(s); } catch { return null; } }
async function keepSet(k, v) { const s = JSON.stringify(v); if (s.length < 500e3) await rcmd(['SET', k, s, 'EX', String(KEEP_SEC)], 2500); }
const bandOf = ex => ex < 60 ? '59' : ex < 85 ? '84' : 'L';
const med = a => { const s = a.slice().sort((x, y) => x - y), m = s.length >> 1; return s.length ? (s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2)) : 0; };
const ymd = r => `${r.dealYear}${String(r.dealMonth).padStart(2, '0')}${String(r.dealDay || '').padStart(2, '0')}`;

export default handler(async (req, res) => {
  // PC에서 바로 연 파일(주소 없음)에서도 부를 수 있게 — 읽기 전용 공공자료라 열어 둡니다
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'X-Hoga-Key');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return fail(res, 405, 'method', 'GET만 됩니다.');
  if (!HOGA_KEY) return fail(res, 503, 'nokey', '비밀번호(HOGA_KEY)가 아직 설정되지 않았습니다.');
  if (!keyOk(req.headers['x-hoga-key'])) return fail(res, 401, 'badkey', '비밀번호가 맞지 않습니다.');
  if (!need(res, [DATA_KEY, 'DATA_GO_KR_KEY'])) return;

  const lawd = clean(req.query.lawd);
  if (!/^\d{5}$/.test(lawd)) return fail(res, 400, 'bad_lawd', '시군구 코드(5자리)를 넣어 주세요.');
  const op = clean(req.query.op) || 'sum';
  if (!['find', 'sum', 'area'].includes(op)) return fail(res, 400, 'bad_op', 'op는 find · sum · area 입니다.');
  if (await overLimit()) return fail(res, 429, 'limit', '오늘 사용량을 다 썼습니다. 내일 다시 해 주세요.');

  if (op === 'area') {
    const yms = monthsBack(6);
    const kk = `hoga:area:${lawd}:${yms[0]}`;
    const hit = await keepGet(kk);
    if (hit) return send(res, 200, { ...hit, kept: true }, 0);
    const got = await pool(yms, 3, ym => month('apt', lawd, ym));
    const map = new Map();
    got.forEach(r => {
      if (!r.ok) return;
      for (const t of r.v) {
        if (cancelled(t)) continue;
        const p = n(t.dealAmount), ex = n(t.excluUseAr); if (!p || !ex) continue;
        const nm = clean(t.aptNm), umd = clean(t.umdNm), b = bandOf(ex), key = nm + '|' + umd + '|' + b;
        const o = map.get(key) || { name: nm, umd, jibun: clean(t.jibun), by: clean(t.buildYear), b, p: [], last: null };
        o.p.push(p); const d = ymd(t);
        if (!o.last || d > o.last[0]) o.last = [d, p];
        map.set(key, o);
      }
    });
    // 칸: name 단지, umd 동, jibun 지번, by 준공 연도, b 평형대, n 건수, med 중간, lo 최저, hi 최고, last [최근 거래일, 금액] (금액은 만원)
    const items = [...map.values()].map(o => ({ name: o.name, umd: o.umd, jibun: o.jibun, by: o.by, b: o.b, n: o.p.length, med: med(o.p), lo: Math.min(...o.p), hi: Math.max(...o.p), last: o.last }))
      .sort((a, b) => b.n - a.n).slice(0, 1500);
    const out = { ok: true, lawd, months: 6, items, errors: got.filter(r => !r.ok).length };
    if (!out.errors) await keepSet(kk, out);
    return send(res, 200, out, 0);
  }

  if (op === 'find') {
    // all=1: 이름과 상관없이 그 구에서 최근 거래된 아파트 전체 목록 (직접 고르기용)
    const all = req.query.all === '1';
    const q = norm(req.query.q);
    if (!all && q.length < 2) return fail(res, 400, 'bad_q', '단지 이름을 두 글자 이상 넣어 주세요.');
    const yms = monthsBack(6);
    const got = await pool(yms, 3, ym => month('apt', lawd, ym));
    // 네 글자 조각 (예: 마포그랑자이 → 마포그랑, 포그랑자, 그랑자이) 하나라도 겹치면 후보
    const grams = [];
    for (let i = 0; i + 4 <= q.length; i++) grams.push(q.slice(i, i + 4));
    const map = new Map();
    got.forEach(r => {
      if (!r.ok) return;
      for (const t of r.v) {
        const nm = clean(t.aptNm), key = nm + '|' + clean(t.umdNm);
        const k = norm(nm);
        const hit = all || k.includes(q) || q.includes(k) || grams.some(g => k.includes(g));
        if (!hit) continue;
        const o = map.get(key) || { name: nm, umd: clean(t.umdNm), jibun: clean(t.jibun), n: 0 };
        o.n++; map.set(key, o);
      }
    });
    const score = o => (norm(o.name) === q ? 1e6 : 0) + (norm(o.name).includes(q) || q.includes(norm(o.name)) ? 1e5 : 0) + o.n;
    const list = [...map.values()].sort(all ? (a, b) => a.umd.localeCompare(b.umd) || a.name.localeCompare(b.name) : (a, b) => score(b) - score(a)).slice(0, all ? 400 : 30);
    return send(res, 200, { ok: true, lawd, months: 6, items: list, errors: got.filter(r => !r.ok).length }, 0);
  }

  if (op === 'sum') {
    const names = new Set(String(req.query.names || '').split('|').map(clean).filter(Boolean).slice(0, 8));
    if (!names.size) return fail(res, 400, 'bad_names', '단지 이름(names)을 넣어 주세요.');
    const umd = clean(req.query.umd);
    const months = Math.min(12, Math.max(3, Number(req.query.months) || 6));
    const yms = monthsBack(months);
    const kk = `hoga:sum:${lawd}:${yms[0]}:${months}:${umd}:${[...names].sort().join('|')}`;
    const hit = await keepGet(kk);
    if (hit) return send(res, 200, { ...hit, kept: true }, 0);
    const jobs = [];
    for (const ym of yms) jobs.push(['apt', ym]);
    for (const ym of yms.slice(0, 6)) jobs.push(['aptRent', ym]);   // 전월세는 자료가 커서 최근 6개월만
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
    const out = { ok: true, lawd, months, sale: sale.slice(0, 600), jeonse: jeonse.slice(0, 600), errors };
    if (!errors) await keepSet(kk, out);
    return send(res, 200, out, 0);
  }

  return fail(res, 400, 'bad_op', 'op는 find · sum · area 입니다.');
});
