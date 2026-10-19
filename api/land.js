// 토지 정보 묶음: 토지특성 · 토지이용계획 · 소유정보 · 개별공시지가(연도별) · 토지이동
// GET /api/land?pnu=...
import { handler, send, need, vworldNed, settle, splitPnu, cached, num, VWORLD_KEY, ttlFor } from './_lib.js';

const thisYear = () => new Date().getFullYear();

async function firstYear(endpoint, pnu, years) {
  for (const y of years) {
    const rows = await vworldNed(endpoint, { pnu, stdrYear: y });
    if (rows.length) return rows;
  }
  return [];
}

export default handler(async (req, res) => {
  if (!need(res, [VWORLD_KEY, 'VWORLD_KEY'])) return;
  const P = splitPnu(req.query.pnu);
  const pnu = P.pnu;
  const Y = thisYear();

  const out = await cached('land:' + pnu, 6 * 3600e3, async () => {
    const [chr, use, own, prices, move, house] = await Promise.all([
      settle(async () => {
        const rows = await firstYear('getLandCharacteristics', pnu, [Y, Y - 1, Y - 2]);
        const r = rows[0];
        if (!r) return null;
        return {
          year: r.stdrYear, ldCodeNm: r.ldCodeNm, jibun: r.mnnmSlno, regstr: r.regstrSeCodeNm,
          jimok: r.lndcgrCodeNm, area: num(r.lndpclAr),
          zone1: r.prposArea1Nm, zone2: r.prposArea2Nm,
          landUse: r.ladUseSittnNm, height: r.tpgrphHgCodeNm, shape: r.tpgrphFrmCodeNm,
          road: r.roadSideCodeNm, price: num(r.pblntfPclnd), updated: r.lastUpdtDt,
        };
      }),
      settle(async () => {
        const rows = await vworldNed('getLandUseAttr', { pnu });
        const seen = new Set();
        return rows.map(r => ({
          code: r.prposAreaDstrcCode, name: r.prposAreaDstrcCodeNm,
          rel: r.cnflcAtNm || ({ 1: '포함', 2: '저촉', 3: '접함' })[r.cnflcAt] || '',
          // 코드가 UQ로 시작하면 「국토의 계획 및 이용에 관한 법률」, 나머지는 다른 법령
          law: String(r.prposAreaDstrcCode || '').startsWith('UQ') ? 'k' : 'o',
          date: r.registDt,
        })).filter(r => { const k = r.code + r.name + r.rel; if (seen.has(k)) return false; seen.add(k); return true; });
      }),
      settle(async () => {
        const rows = await vworldNed('getPossessionAttr', { pnu });
        if (!rows.length) return null;
        const units = rows.filter(r => r.buldHoNm || r.agbldgSn);
        const base = rows[0];
        const by = {};
        for (const r of rows) { const k = r.posesnSeCodeNm || '기타'; by[k] = (by[k] || 0) + 1; }
        // 가장 최근 변동 건
        const latest = [...rows].sort((a, b) => String(b.ownshipChgDe || '').localeCompare(String(a.ownshipChgDe || '')))[0];
        return {
          collective: units.length > 1,
          unitCount: units.length,
          type: base.posesnSeCodeNm, typeCounts: by,
          residence: base.resdncSeCodeNm, nation: base.nationInsttSeCodeNm,
          sharers: num(base.cnrsPsnCo),
          cause: (units.length > 1 ? latest : base).ownshipChgCauseCodeNm,
          date: (units.length > 1 ? latest : base).ownshipChgDe,
          stdrYm: base.stdrYm,
        };
      }),
      settle(async () => {
        const years = Array.from({ length: 7 }, (_, i) => Y - i);
        const rs = await Promise.all(years.map(y => vworldNed('getIndvdLandPriceAttr', { pnu, stdrYear: y }).catch(() => [])));
        const list = [];
        rs.forEach(rows => rows.forEach(r => { const v = num(r.pblntfPclnd); if (v) list.push({ year: Number(r.stdrYear), price: v, date: r.pblntfDe }); }));
        const uniq = new Map(); list.forEach(x => uniq.set(x.year, x));
        return [...uniq.values()].sort((a, b) => a.year - b.year);
      }),
      settle(async () => {
        const rows = await vworldNed('getLandMoveAttr', { pnu });
        return rows.map(r => ({ why: r.ladMvmnPrvonshCodeNm, date: r.ladMvmnDe, jimok: r.lndcgrCodeNm, area: num(r.lndpclAr) }))
          .sort((a, b) => String(b.date).localeCompare(String(a.date)));
      }),
      // 개별주택가격 (단독·다가구 주택 공시가격). 서비스가 막혀 있어도 다른 정보에 영향 없도록 실패는 조용히 비움
      (async () => {
        try {
          for (const y of [Y, Y - 1, Y - 2]) {
            const rows = await vworldNed('getIndvdHousingPriceAttr', { pnu, stdrYear: y });
            const r = rows.find(x => num(x.housePc ?? x.indvdHousePc ?? x.pblntfPc));
            if (r) return { ok: true, data: { year: Number(r.stdrYear) || y, price: num(r.housePc ?? r.indvdHousePc ?? r.pblntfPc), date: r.pblntfDe || '', bldArea: num(r.buldAllTotAr ?? r.bldAllTotAr), landArea: num(r.ladRegstrAr ?? r.calcPlotAr) } };
          }
          return { ok: true, data: null };
        } catch (e) { console.warn('개별주택가격', e.message); return { ok: true, data: null, note: 'unavailable' }; }
      })(),
    ]);
    return { chr, use, own, prices, move, house };
  });

  send(res, 200, { ok: true, pnu, jibun: P.jibun, ...out }, ttlFor(out, 21600));
});
