// 건축물대장: 총괄표제부 · 표제부(동별) · 층별개요 · 부속지번(건물이 여러 필지에 걸친 경우)
// GET /api/building?pnu=...
import { handler, send, need, dataGoKr, dataGoKrAll, settle, splitPnu, cached, num, pool, DATA_KEY, ttlFor } from './_lib.js';
import { readSession } from './auth.js';

const HUB = 'https://apis.data.go.kr/1613000/BldRgstHubService/';

const d8 = s => { s = String(s || '').trim(); return /^\d{8}$/.test(s) ? `${s.slice(0, 4)}.${s.slice(4, 6)}.${s.slice(6, 8)}` : (s || null); };

function title(r) {
  return {
    pk: r.mgmBldrgstPk,
    kind: r.regstrKindCdNm,           // 일반건축물 / 표제부 / 총괄표제부
    regstr: r.regstrGbCdNm,           // 일반 / 집합
    mainAtch: r.mainAtchGbCdNm,       // 주건축물 / 부속건축물
    name: r.bldNm || '', dong: r.dongNm || '',
    plat: r.platPlc, road: r.newPlatPlc,
    use: r.mainPurpsCdNm, etcUse: r.etcPurps,
    strct: r.strctCdNm, etcStrct: r.etcStrct,
    roof: r.roofCdNm, etcRoof: r.etcRoof,
    height: num(r.heit), grnd: num(r.grndFlrCnt), ugrnd: num(r.ugrndFlrCnt),
    platArea: num(r.platArea), archArea: num(r.archArea), totArea: num(r.totArea),
    vlArea: num(r.vlRatEstmTotArea), bcRat: num(r.bcRat), vlRat: num(r.vlRat),
    hhld: num(r.hhldCnt), fmly: num(r.fmlyCnt), ho: num(r.hoCnt),
    liftP: num(r.rideUseElvtCnt), liftE: num(r.emgenUseElvtCnt),
    pkIn: num(r.indrAutoUtcnt), pkOut: num(r.oudrAutoUtcnt), pkInMech: num(r.indrMechUtcnt), pkOutMech: num(r.oudrMechUtcnt),
    pkTotal: num(r.totPkngCnt),
    energy: r.engrGrade, green: r.gnBldGrade, smart: r.itgBldGrade,
    seismic: r.rserthqkDsgnApplyYn, seismicCap: r.rserthqkAblty,
    atchCnt: num(r.atchBldCnt), atchArea: num(r.atchBldArea), mainCnt: num(r.mainBldCnt),
    pms: d8(r.pmsDay), stcns: d8(r.stcnsDay), useApr: d8(r.useAprDay),
    crtn: d8(r.crtnDay),
    // 위반건축물 표시 (자료에 있을 때만)
    viol: r.violBldYn ?? r.vioBldYn ?? r.violtBldYn ?? null,
  };
}


// ---------- K-apt 공동주택 관리비 · 단지 정보 ----------
const KB = 'https://apis.data.go.kr/1613000/';
const K_LIST = [KB + 'AptListService4/getLegaldongAptList4', KB + 'AptListService3/getLegaldongAptList3'];
const K_BASIC = [KB + 'AptBasisInfoServiceV5/getAphusBassInfoV5', KB + 'AptBasisInfoServiceV4/getAphusBassInfoV4'];
const K_DTL = [KB + 'AptBasisInfoServiceV5/getAphusDtlInfoV5', KB + 'AptBasisInfoServiceV4/getAphusDtlInfoV4'];
// 관리비 서비스는 버전이 바뀔 수 있어 V2·V3를 차례로 시도하고, 되는 주소를 기억합니다
const CMN = 'Cmnuse', IND = 'Indvdlz';
const VERS = ['V2', 'V3'];
// [이름, 묶음, 서비스, 이름 후보들]
const OPS = [
  ['인건비', 'gen', CMN, ['LaborCost']], ['제사무비', 'gen', CMN, ['Ofcrk', 'OfcrkCost']], ['제세공과금', 'gen', CMN, ['Taxdue', 'TaxdueCost']],
  ['피복비', 'gen', CMN, ['Clothing', 'ClothingCost']], ['교육훈련비', 'gen', CMN, ['EduTraing', 'EduTraingCost', 'EduTrainingCost']],
  ['차량유지비', 'gen', CMN, ['VhcleMntnc', 'VhcleMntncCost']], ['그밖의부대비용', 'gen', CMN, ['Etc', 'EtcCost']],
  ['위탁관리수수료', 'gen', CMN, ['ConsignManageFee', 'ConsignManageFeeCost']],
  ['청소비', 'svc', CMN, ['Cleaning', 'CleaningCost']], ['경비비', 'svc', CMN, ['Guard', 'GuardCost']], ['소독비', 'svc', CMN, ['Disinfection', 'DisinfectionCost']],
  ['승강기유지비', 'fac', CMN, ['ElevatorMntnc', 'ElevatorMntncCost']], ['홈네트워크', 'fac', CMN, ['HomeNetworkMntnc', 'HomeNetworkMntncCost']],
  ['수선비', 'fac', CMN, ['Repairs', 'RepairsCost']], ['시설유지비', 'fac', CMN, ['FacilityMntnc', 'FacilityMntncCost']],
  ['안전점검비', 'fac', CMN, ['SafetyCheckUp', 'SafetyCheckUpCost']], ['재해예방비', 'fac', CMN, ['DisasterPrevention', 'DisasterPreventionCost']],
  ['난방비', 'heat', IND, ['Heat', 'HeatCost']], ['급탕비', 'heat', IND, ['HotWater', 'HotWaterCost']],
  ['가스사용료', 'util', IND, ['GasRentalFee', 'GasRentalFeeCost', 'Gas']], ['전기료', 'util', IND, ['Electricity', 'ElectricityCost']], ['수도료', 'util', IND, ['Water', 'WaterCost']],
];
const GROUP = { gen: '인건비·일반관리', svc: '경비·청소·소독', fac: '승강기·수선유지', heat: '난방·급탕', util: '전기·수도·가스' };
const okOp = new Map(); // 작동하는 오퍼레이션 이름 기억
async function tryUrls(urls, params) { let last; for (const u of urls) { try { return { url: u, r: await dataGoKr(u, params) }; } catch (e) { last = e; } } throw last; }
async function opCall(op, kaptCode, ym) {
  const [, , base, names] = op;
  const urls = okOp.has(op[0]) ? [okOp.get(op[0])] : VERS.flatMap(v => names.map(n => `${KB}Apt${base}ManageCostService${v}/getHsmp${n}Info${v}`));
  const { url, r } = await tryUrls(urls, { kaptCode, searchDate: ym, _type: 'json' });
  okOp.set(op[0], url);
  const it = r.items[0] || {};
  let sum = 0, any = false;
  for (const [k, v] of Object.entries(it)) { if (/^kapt/i.test(k) || /date/i.test(k)) continue; const x = Number(v); if (v !== null && v !== '' && Number.isFinite(x)) { sum += x; any = true; } }
  return { sum, any, url };
}
const ymBack = n => { const d = new Date(Date.now() + 9 * 3600e3); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - n); return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}`; };
const normNm = s => String(s || '').replace(/\s|\(.*?\)|아파트|APT|제?\d+단지$/gi, '');
async function findComplex(P, name) {
  const bjd = P.pnu.slice(0, 10);
  const list = await cached('kaptl:' + bjd, 30 * 864e5, async () => (await tryUrls(K_LIST, { bjdCode: bjd, numOfRows: 500, pageNo: 1, _type: 'json' })).r.items.map(x => ({ code: x.kaptCode, name: x.kaptName })));
  if (!list.length) return null;
  const nm = normNm(name);
  if (nm) { const hit = list.find(x => normNm(x.name) === nm) || list.find(x => normNm(x.name).includes(nm) || nm.includes(normNm(x.name))); if (hit) return hit.code; }
  const jib = `${P.bunNum}${P.jiNum ? '-' + P.jiNum : ''}`;
  const rx = new RegExp(`(^|\\s)${jib.replace('-', '\\-')}(\\s|$|번지)`);
  for (const x of list.slice(0, 25)) { const b = await basic(x.code).catch(() => null); if (b && rx.test(String(b.kaptAddr || ''))) return x.code; }
  return null;
}
const basic = code => cached('kaptb:' + code, 30 * 864e5, async () => (await tryUrls(K_BASIC, { kaptCode: code, _type: 'json' })).r.items[0] || null);
const detail = code => cached('kaptd:' + code, 30 * 864e5, async () => (await tryUrls(K_DTL, { kaptCode: code, _type: 'json' })).r.items[0] || null);
async function costMonth(code) {
  for (let n = 1; n <= 4; n++) { const ym = ymBack(n); const r = await opCall(OPS[0], code, ym); if (r.any && r.sum > 0) return ym; }
  return null;
}
async function costAt(code, ym, ops = OPS) {
  const rs = await pool(ops, 6, op => opCall(op, code, ym));
  const items = ops.map((op, i) => ({ k: op[0], g: op[1], v: rs[i].ok ? rs[i].v.sum : null }));
  return items;
}
async function kaptPart(P, name) {
  const code = await findComplex(P, name);
  if (!code) return { kapt: null };
  return { kapt: await cached('kaptc:' + code + ':' + ymBack(1), 20 * 864e5, async () => {
    const [b, d] = await Promise.all([basic(code), detail(code).catch(() => null)]);
    const ym = await costMonth(code);
    let groups = null, total = null, fails = 0;
    if (ym) {
      const items = await costAt(code, ym);
      fails = items.filter(x => x.v == null).length;
      groups = Object.entries(GROUP).map(([g, label]) => ({ g, label, v: items.filter(x => x.g === g).reduce((s, x) => s + (x.v || 0), 0) }));
      total = groups.reduce((s, x) => s + x.v, 0);
    }
    const hh = num(b && b.kaptdaCnt), marea = num(b && b.kaptMarea);
    const pk = d ? (num(d.kaptdPcnt) || 0) + (num(d.kaptdPcntu) || 0) : null;
    return {
      code, name: b && b.kaptName, hh, dongCnt: num(b && b.kaptDongCnt), heat: b && b.codeHeatNm, builder: b && b.kaptBcompany, mgr: b && b.codeMgrNm,
      hall: b && b.codeHallNm, usedate: b && b.kaptUsedate, marea, parking: pk, elev: d ? num(d.kaptdEcnt) : null,
      month: ym, total, groups, fails, perHH: total && hh ? total / hh : null, perM2: total && marea ? total / marea : null,
    };
  }) };
}
async function kaptTrend(code, ym) {
  const ind = OPS.filter(o => o[2] === IND);
  const months = []; for (let i = 0; i < 12; i++) { const d = new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(4) - 1 - i, 1)); months.push(`${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}`); }
  return cached('kaptt:' + code + ':' + ym, 20 * 864e5, async () => {
    const out = [];
    for (const m of months.reverse()) { const items = await costAt(code, m, ind); const v = items.reduce((s, x) => s + (x.v || 0), 0); out.push({ m, v }); }
    return out;
  });
}

export default handler(async (req, res) => {
  if (!need(res, [DATA_KEY, 'DATA_GO_KR_KEY'])) return;
  const P = splitPnu(req.query.pnu);
  const q = { sigunguCd: P.sigunguCd, bjdongCd: P.bjdongCd, platGbCd: P.platGbCd, bun: P.bun, ji: P.ji, _type: 'json' };

  const floorsOf = async () => (await dataGoKrAll(HUB + 'getBrFlrOulnInfo', q, { maxPages: 30 })).map(r => ({
    pk: r.mgmBldrgstPk, dong: r.dongNm || '', gb: r.flrGbCdNm, no: num(r.flrNo), noNm: r.flrNoNm,
    use: r.mainPurpsCdNm, etcUse: r.etcPurps, strct: r.strctCdNm, area: num(r.area),
    mainAtch: r.mainAtchGbCdNm, excl: r.areaExctYn === '1' || r.areaExctYn === 'Y',
  }));

  // 아파트 관리비 · 단지 정보 (K-apt)
  if (req.query.part === 'kapt') {
    if (req.query.debug) { // 점검용: 오퍼레이션별 응답 상태
      if (req.query.debug === 'list') {
        const bjd = P.pnu.slice(0, 10), out = {};
        for (const u of [...K_LIST, ...K_BASIC, ...K_DTL]) {
          const isList = K_LIST.includes(u);
          try { const r = await dataGoKr(u, isList ? { bjdCode: bjd, numOfRows: 5, pageNo: 1, _type: 'json' } : { kaptCode: req.query.code || 'A10027875', _type: 'json' }); out[u.split('/').slice(-2).join('/')] = { ok: true, n: r.items.length, first: r.items[0] }; }
          catch (e) { out[u.split('/').slice(-2).join('/')] = { ok: false, err: String(e.message).slice(0, 90) }; }
        }
        return send(res, 200, { ok: true, bjd, out });
      }
      const code = req.query.code || await findComplex(P, req.query.name || '');
      const ym = req.query.ym || ymBack(2);
      const rs = await pool(OPS, 4, op => opCall(op, code, ym));
      return send(res, 200, { ok: true, code, ym, ops: OPS.map((o, i) => ({ k: o[0], ok: rs[i].ok, sum: rs[i].ok ? rs[i].v.sum : null, url: rs[i].ok ? rs[i].v.url.split('/').slice(-1)[0] : null, err: rs[i].ok ? null : String(rs[i].e.message).slice(0, 80) })) });
    }
    const out = await kaptPart(P, String(req.query.name || '').slice(0, 40));
    return send(res, 200, { ok: true, pnu: P.pnu, ...out }, out.kapt && out.kapt.fails ? 0 : 86400);
  }
  if (req.query.part === 'kaptTrend') {
    if (!readSession(req)) return send(res, 200, { ok: false, error: 'login', message: '회원 전용입니다.' });
    const code = String(req.query.code || '').replace(/[^A-Za-z0-9]/g, ''), ym = String(req.query.ym || '').replace(/\D/g, '').slice(0, 6);
    if (!code || ym.length !== 6) return send(res, 200, { ok: false, error: 'bad', message: '단지 정보가 필요합니다.' });
    return send(res, 200, { ok: true, trend: await kaptTrend(code, ym) });
  }

  // 층별개요는 큰 단지에서 수천 건이라 따로 받습니다 (화면은 먼저 띄우고 나중에 채움)
  if (req.query.part === 'floors') {
    const out = await cached('bldf:' + P.pnu, 12 * 3600e3, async () => ({ floors: await settle(floorsOf) }));
    return send(res, 200, { ok: true, pnu: P.pnu, ...out }, ttlFor(out, 43200));
  }

  const out = await cached('bld:' + P.pnu, 12 * 3600e3, async () => {
    const [recap, titles, atch] = await Promise.all([
      settle(async () => (await dataGoKrAll(HUB + 'getBrRecapTitleInfo', q, { maxPages: 1 })).map(title)),
      settle(async () => (await dataGoKrAll(HUB + 'getBrTitleInfo', q, { maxPages: 10 })).map(title)),
      settle(async () => {
        const rows = await dataGoKrAll(HUB + 'getBrAtchJibunInfo', q, { maxPages: 3 });
        const seen = new Set(), out = [];
        for (const r of rows) {
          const sg = String(r.atchSigunguCd || '').trim(), bj = String(r.atchBjdongCd || '').trim(), gb = String(r.atchPlatGbCd ?? '0').trim();
          const bun = String(r.atchBun || '').trim(), ji = String(r.atchJi || '0').trim();
          if (!/^\d{5}$/.test(sg) || !/^\d{5}$/.test(bj) || !/^\d+$/.test(bun) || gb === '2') continue;
          const pnu = sg + bj + (gb === '1' ? '2' : '1') + bun.padStart(4, '0') + (ji || '0').padStart(4, '0');
          if (pnu === P.pnu || seen.has(pnu)) continue;
          seen.add(pnu);
          out.push({ pnu, jibun: `${gb === '1' ? '산' : ''}${Number(bun)}${Number(ji) ? '-' + Number(ji) : ''}`, dong: r.atchBjdongNm || r.bjdongNm || '' });
        }
        return out;
      }),
    ]);
    // 주건축물 우선 정렬
    if (titles.ok) titles.data.sort((a, b) => (a.mainAtch === '주건축물' ? 0 : 1) - (b.mainAtch === '주건축물' ? 0 : 1) || String(a.dong).localeCompare(String(b.dong), 'ko', { numeric: true }));
    return { recap, titles, atch };
  });

  send(res, 200, { ok: true, pnu: P.pnu, ...out }, ttlFor(out, 43200));
});
