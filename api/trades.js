// 국토교통부 실거래가 (매매·전월세) — 해당 필지 거래만 골라서 반환
// GET /api/trades?pnu=...&kinds=apt,aptRent&umd=노고산동&area=756.3&name=대흥중앙&months=24
import { handler, send, fail, need, dataGoKrAll, splitPnu, cached, num, pool, DATA_KEY } from './_lib.js';

const B = 'https://apis.data.go.kr/1613000/';
export const KINDS = {
  apt:      { url: B + 'RTMSDataSvcAptTradeDev/getRTMSDataSvcAptTradeDev', alt: B + 'RTMSDataSvcAptTrade/getRTMSDataSvcAptTrade', label: '아파트 매매', sale: true },
  aptRent:  { url: B + 'RTMSDataSvcAptRent/getRTMSDataSvcAptRent', label: '아파트 전월세' },
  rh:       { url: B + 'RTMSDataSvcRHTrade/getRTMSDataSvcRHTrade', label: '연립다세대 매매', sale: true },
  rhRent:   { url: B + 'RTMSDataSvcRHRent/getRTMSDataSvcRHRent', label: '연립다세대 전월세' },
  sh:       { url: B + 'RTMSDataSvcSHTrade/getRTMSDataSvcSHTrade', label: '단독·다가구 매매', sale: true },
  shRent:   { url: B + 'RTMSDataSvcSHRent/getRTMSDataSvcSHRent', label: '단독·다가구 전월세' },
  offi:     { url: B + 'RTMSDataSvcOffiTrade/getRTMSDataSvcOffiTrade', label: '오피스텔 매매', sale: true },
  offiRent: { url: B + 'RTMSDataSvcOffiRent/getRTMSDataSvcOffiRent', label: '오피스텔 전월세' },
  nrg:      { url: B + 'RTMSDataSvcNrgTrade/getRTMSDataSvcNrgTrade', label: '상업업무용 매매', sale: true },
  land:     { url: B + 'RTMSDataSvcLandTrade/getRTMSDataSvcLandTrade', label: '토지 매매', sale: true },
};

export function monthsBack(n) {
  const out = [], d = new Date();
  // 한국시간 기준 이번 달부터
  const k = new Date(d.getTime() + 9 * 3600e3);
  let y = k.getUTCFullYear(), m = k.getUTCMonth() + 1;
  for (let i = 0; i < n; i++) { out.push(`${y}${String(m).padStart(2, '0')}`); m--; if (!m) { m = 12; y--; } }
  return out;
}

// 상세 자료 API가 아직 열리지 않았으면(오류 30 등) 기본 API로 자동 전환
const useAlt = new Set();
export async function month(kind, lawd, ym) {
  const cur = monthsBack(2).includes(ym);
  const K = KINDS[kind];
  const get = url => dataGoKrAll(url, { LAWD_CD: lawd, DEAL_YMD: ym }, { pageSize: 1000, maxPages: 30 });
  return cached(`rt:${kind}:${lawd}:${ym}`, (cur ? 6 : 72) * 3600e3, async () => {
    if (K.alt && useAlt.has(kind)) return get(K.alt);
    try { return await get(K.url); }
    catch (e) {
      if (K.alt && /\(30\)|\(20\)|NOT_REGISTERED|ACCESS_DENIED/.test(e.message)) { useAlt.add(kind); return get(K.alt); }
      throw e;
    }
  });
}

const clean = s => String(s ?? '').trim();
const normName = s => clean(s).replace(/\s|\(.*?\)|아파트|APT/gi, '');

// 지번 비교: 정확히 같으면 'exact', 마스킹(*)이 맞으면 'mask', 아니면 null
function jibunMatch(rec, P) {
  rec = clean(rec).replace(/^산\s*/, '');
  if (!rec) return null;
  const mine = `${P.bunNum}${P.jiNum ? '-' + P.jiNum : ''}`;
  if (rec === mine) return 'exact';
  if (P.jiNum === 0 && rec === `${P.bunNum}-0`) return 'exact';
  if (rec.includes('*')) {
    const re = new RegExp('^' + rec.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '\\d') + '$');
    if (re.test(mine) || re.test(String(P.bunNum))) return 'mask';
  }
  return null;
}
const near = (a, b, tol = 0.03) => a && b && Math.abs(a - b) / b <= tol;

function map(kind, r) {
  const date = `${r.dealYear}.${String(r.dealMonth).padStart(2, '0')}.${String(r.dealDay || '').padStart(2, '0')}`;
  const cancel = clean(r.cdealType) === 'O' || !!clean(r.cdealDay);
  return {
    kind, date,
    name: clean(r.aptNm || r.mhouseNm || r.offiNm),
    aptDong: clean(r.aptDong), floor: clean(r.floor),
    ex: num(r.excluUseAr), landAr: num(r.landAr), plottage: num(r.plottageAr), gfa: num(r.totalFloorAr), bldAr: num(r.buildingAr), dealAr: num(r.dealArea),
    price: num(r.dealAmount), deposit: num(r.deposit), rent: num(r.monthlyRent),
    cancel, cancelDay: clean(r.cdealDay),
    via: clean(r.dealingGbn), seller: clean(r.slerGbn), buyer: clean(r.buyerGbn), rgst: clean(r.rgstDate),
    contract: clean(r.contractType), renew: clean(r.useRRRight), term: clean(r.contractTerm),
    prevDeposit: num(r.preDeposit), prevRent: num(r.preMonthlyRent),
    houseType: clean(r.houseType), btype: clean(r.buildingType), use: clean(r.buildingUse),
    jimok: clean(r.jimok), zone: clean(r.landUse), share: clean(r.shareDealingType),
    buildYear: clean(r.buildYear), jibun: clean(r.jibun), umd: clean(r.umdNm),
  };
}

export default handler(async (req, res) => {
  if (!need(res, [DATA_KEY, 'DATA_GO_KR_KEY'])) return;
  const P = splitPnu(req.query.pnu);
  const kinds = String(req.query.kinds || '').split(',').filter(k => KINDS[k]);
  if (!kinds.length) return fail(res, 400, 'bad_kinds', '조회할 거래 종류(kinds)를 지정해 주세요.');
  const umd = clean(req.query.umd);
  const area = num(req.query.area);
  const name = normName(req.query.name);
  const months = Math.min(60, Math.max(1, Number(req.query.months) || 24));
  const yms = monthsBack(months);

  const jobs = [];
  for (const k of kinds) for (const ym of yms) jobs.push([k, ym]);
  const results = await pool(jobs, 4, ([k, ym]) => month(k, P.sigunguCd, ym));

  const errors = new Set();
  const rows = [];
  results.forEach((r, i) => {
    const kind = jobs[i][0];
    if (!r.ok) { errors.add(`${KINDS[kind].label}: ${r.e.message}`); return; }
    for (const raw of r.v) {
      if (umd && clean(raw.umdNm) && !clean(raw.umdNm).endsWith(umd) && clean(raw.umdNm) !== umd) continue;
      let m = jibunMatch(raw.jibun, P);
      // 단지명이 같으면 같은 단지로 인정 (대표지번이 다른 경우)
      if (!m && name && name.length >= 2 && ['apt', 'aptRent', 'rh', 'rhRent', 'offi', 'offiRent'].includes(kind)) {
        const nm = normName(raw.aptNm || raw.mhouseNm || raw.offiNm);
        if (nm && nm === name) m = 'name';
      }
      if (!m) continue;
      const t = map(kind, raw);
      if (m === 'mask') {
        // 지번 일부가 가려진 거래는 면적으로 한 번 더 확인
        const a = t.plottage || t.dealAr;
        if (area && a) { if (!near(a, area)) continue; t.approx = 'area'; }
        else t.approx = 'jibun';
      }
      rows.push(t);
    }
  });
  rows.sort((a, b) => b.date.localeCompare(a.date));
  send(res, 200, {
    ok: true, pnu: P.pnu, months, kinds: kinds.map(k => ({ k, label: KINDS[k].label, sale: !!KINDS[k].sale })),
    rows, errors: [...errors],
  }, 21600);
});
