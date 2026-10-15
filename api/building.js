// 건축물대장: 총괄표제부 · 표제부(동별) · 층별개요
// GET /api/building?pnu=...
import { handler, send, need, dataGoKrAll, settle, splitPnu, cached, num, DATA_KEY } from './_lib.js';

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
  };
}

export default handler(async (req, res) => {
  if (!need(res, [DATA_KEY, 'DATA_GO_KR_KEY'])) return;
  const P = splitPnu(req.query.pnu);
  const q = { sigunguCd: P.sigunguCd, bjdongCd: P.bjdongCd, platGbCd: P.platGbCd, bun: P.bun, ji: P.ji, _type: 'json' };

  const out = await cached('bld:' + P.pnu, 12 * 3600e3, async () => {
    const [recap, titles, floors] = await Promise.all([
      settle(async () => (await dataGoKrAll(HUB + 'getBrRecapTitleInfo', q, { maxPages: 1 })).map(title)),
      settle(async () => (await dataGoKrAll(HUB + 'getBrTitleInfo', q, { maxPages: 3 })).map(title)),
      settle(async () => (await dataGoKrAll(HUB + 'getBrFlrOulnInfo', q, { maxPages: 5 })).map(r => ({
        pk: r.mgmBldrgstPk, dong: r.dongNm || '', gb: r.flrGbCdNm, no: num(r.flrNo), noNm: r.flrNoNm,
        use: r.mainPurpsCdNm, etcUse: r.etcPurps, strct: r.strctCdNm, area: num(r.area),
        mainAtch: r.mainAtchGbCdNm, excl: r.areaExctYn === '1' || r.areaExctYn === 'Y',
      }))),
    ]);
    // 주건축물 우선 정렬
    if (titles.ok) titles.data.sort((a, b) => (a.mainAtch === '주건축물' ? 0 : 1) - (b.mainAtch === '주건축물' ? 0 : 1) || String(a.dong).localeCompare(String(b.dong), 'ko', { numeric: true }));
    return { recap, titles, floors };
  });

  send(res, 200, { ok: true, pnu: P.pnu, ...out }, 43200);
});
