// 집합건물 동·호 목록 (전유부)
// GET /api/units?pnu=...
// 호 하나의 면적·공시가격: GET /api/units?pnu=...&dong=101동&ho=1203호
import { handler, send, need, dataGoKrAll, vworldNed, settle, splitPnu, cached, num, DATA_KEY, VWORLD_KEY } from './_lib.js';

const HUB = 'https://apis.data.go.kr/1613000/BldRgstHubService/';
const norm = s => String(s || '').replace(/\s/g, '').replace(/^제/, '').replace(/(동|호)$/, '').toUpperCase();
const sameTok = (a, b) => { a = norm(a); b = norm(b); if (a === b) return true; const da = a.replace(/\D/g, ''), db = b.replace(/\D/g, ''); return !!da && da === db; };

export default handler(async (req, res) => {
  if (!need(res, [DATA_KEY, 'DATA_GO_KR_KEY'])) return;
  const P = splitPnu(req.query.pnu);
  const q = { sigunguCd: P.sigunguCd, bjdongCd: P.bjdongCd, platGbCd: P.platGbCd, bun: P.bun, ji: P.ji, _type: 'json' };
  const { dong, ho } = req.query;

  if (!ho) {
    const list = await cached('units:' + P.pnu, 24 * 3600e3, async () => {
      const rows = await dataGoKrAll(HUB + 'getBrExposInfo', q, { maxPages: 60 });
      const seen = new Set(), out = [];
      for (const r of rows) {
        const dn = String(r.dongNm || '').trim(), hn = String(r.hoNm || '').trim();
        const k = dn + '|' + hn;
        if (!hn || seen.has(k)) continue; seen.add(k);
        out.push({ dong: dn, ho: hn, flr: num(r.flrNo), flrGb: r.flrGbCdNm || '' });
      }
      const nat = (a, b) => String(a).localeCompare(String(b), 'ko', { numeric: true });
      out.sort((a, b) => nat(a.dong, b.dong) || (b.flr ?? 0) - (a.flr ?? 0) || nat(a.ho, b.ho));
      return out;
    });
    return send(res, 200, { ok: true, pnu: P.pnu, count: list.length, units: list }, 86400);
  }

  const Y = new Date().getFullYear();
  const out = await cached(`unit:${P.pnu}:${dong}:${ho}`, 24 * 3600e3, async () => {
    const [area, price] = await Promise.all([
      settle(async () => {
        const D = String(dong || '').trim(), H = String(ho || '').trim();
        const pick = rows => rows.filter(r => sameTok(r.hoNm, H) && (!D || !String(r.dongNm || '').trim() || sameTok(r.dongNm, D)));
        // 동·호 이름 표기가 대장마다 달라서, 못 찾으면 조건을 줄여 가며 다시 찾습니다.
        let rows = pick(await dataGoKrAll(HUB + 'getBrExposPubuseAreaInfo', { ...q, dongNm: D, hoNm: H }, { maxPages: 5 }));
        if (!rows.length) rows = pick(await dataGoKrAll(HUB + 'getBrExposPubuseAreaInfo', { ...q, hoNm: H }, { maxPages: 5 }));
        if (!rows.length) rows = pick(await dataGoKrAll(HUB + 'getBrExposPubuseAreaInfo', q, { maxPages: 60 }));
        return rows.map(r => ({
          gb: r.exposPubuseGbCdNm, use: r.mainPurpsCdNm, etcUse: r.etcPurps, area: num(r.area),
          flr: r.flrNoNm || (r.flrNo ? r.flrNo + '층' : ''), strct: r.strctCdNm,
        }));
      }),
      settle(async () => {
        if (!VWORLD_KEY) return null;
        for (const y of [Y, Y - 1, Y - 2]) {
          const rows = await vworldNed('getApartHousingPriceAttr', { pnu: P.pnu, stdrYear: y, dongNm: String(dong || '').trim(), hoNm: String(ho || '').trim() });
          const m = rows.find(r => sameTok(r.hoNm, ho) && (!String(dong || '').trim() || !String(r.dongNm || '').trim() || sameTok(r.dongNm, dong)));
          if (m) return { year: y, price: num(m.pblntfPc), name: m.aphusNm, area: num(m.prvuseAr), date: m.pblntfDe };
          if (rows.length) return null;
        }
        return null;
      }),
    ]);
    return { area, price };
  });
  send(res, 200, { ok: true, pnu: P.pnu, dong, ho, ...out }, 86400);
});
