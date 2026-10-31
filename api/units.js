// 집합건물 동·호 목록 (전유부)
// GET /api/units?pnu=...
// 호 하나의 면적·공시가격: GET /api/units?pnu=...&dong=101동&ho=1203호
import { handler, send, need, dataGoKr, dataGoKrAll, vworldNed, settle, splitPnu, cached, num, pool, rcmd, DATA_KEY, VWORLD_KEY } from './_lib.js';

const HUB = 'https://apis.data.go.kr/1613000/BldRgstHubService/';
const norm = s => String(s || '').replace(/\s/g, '').replace(/^제/, '').replace(/(동|호)$/, '').toUpperCase();
// 숫자만 같으면 같은 것으로 보되, 'T402'처럼 영문이 붙은 동·호는 '402'와 구분
const sameTok = (a, b) => { a = norm(a); b = norm(b); if (a === b) return true; if (/[A-Z]/.test(a) || /[A-Z]/.test(b)) return false; const da = a.replace(/\D/g, ''), db = b.replace(/\D/g, ''); return !!da && da === db; };

// 10/29 단지 전체가 건물 하나로 등록되고 호 이름에 동이 붙은 경우('마포 푸르지오 더 센트럴' · '101동 1801') → 동 '101동' · 호 '1801'로 나눔
const splitRow = r => { if (!r) return r; const dn = String(r.dongNm || '').trim(), m = /^(\d{1,4}[A-Za-z]?동)\s*(\S.*)$/.exec(String(r.hoNm || '').trim()); return m && !/\d/.test(dn) ? { ...r, dongNm: m[1], hoNm: m[2], _dn: dn } : r; };

export default handler(async (req, res) => {
  if (!need(res, [DATA_KEY, 'DATA_GO_KR_KEY'])) return;
  const P = splitPnu(req.query.pnu);
  const q = { sigunguCd: P.sigunguCd, bjdongCd: P.bjdongCd, platGbCd: P.platGbCd, bun: P.bun, ji: P.ji, _type: 'json' };
  const { dong, ho } = req.query;

  const toRow = r => ({ dong: String(r.dongNm || '').trim(), ho: String(r.hoNm || '').trim(), flr: num(r.flrNo), flrGb: r.flrGbCdNm || '' });
  const nat = (a, b) => String(a).localeCompare(String(b), 'ko', { numeric: true });
  const sortU = out => out.sort((a, b) => nat(a.dong, b.dong) || (b.flr ?? 0) - (a.flr ?? 0) || nat(a.ho, b.ho));

  // 전유부 목록을 쪽 단위로 모읍니다. 큰 단지(3,000세대 이상)는 쪽이 수십 개라 시간 한도(30초) 안에서 8개씩 동시에 받고,
  // 시간이 모자라거나 일부 쪽이 실패하면 받은 만큼만 돌려주고 partial로 표시합니다 (그때는 저장하지 않음).
  async function expos(params, budgetMs) {
    const t0 = Date.now();
    // 받은 쪽은 이틀 동안 따로 저장 → 시간이 모자라 일부만 받았어도, 다시 부르면 남은 쪽만 이어서 받습니다 (헬리오시티 같은 1만 세대 단지 대응)
    const slim = it => it.map(r => ({ dongNm: r.dongNm, hoNm: r.hoNm, flrNo: r.flrNo, flrGbCdNm: r.flrGbCdNm }));
    const pkey = p => `unitsp:${P.pnu}:${params.dongNm || '*'}:${p}`;
    const first = await cached(pkey(1), 2 * 86400e3, async () => { const f = await dataGoKr(HUB + 'getBrExposInfo', { ...params, numOfRows: 1000, pageNo: 1 }); return { items: slim(f.items), total: f.total || f.items.length }; });
    const per = first.items.length, total = first.total || per;
    let items = first.items, partial = false;
    if (per && per < total) {
      const n = Math.ceil(total / per), nums = [];
      for (let p = 2; p <= Math.min(n, 250); p++) nums.push(p);
      if (n > 250) partial = true;
      // 공공데이터포털 초당 요청 한도(오류 23)에 걸리지 않게 3개씩, 요청 사이 간격을 둡니다 (초당 약 6건)
      let next = 0;
      const pace = async () => { const now = Date.now(), at = Math.max(now, next); next = at + 160; if (at > now) await new Promise(r => setTimeout(r, at - now)); };
      const rs = await pool(nums, 3, async p => {
        if (Date.now() - t0 > budgetMs) throw new Error('budget');
        return cached(pkey(p), 2 * 86400e3, async () => { await pace(); return slim((await dataGoKr(HUB + 'getBrExposInfo', { ...params, numOfRows: per, pageNo: p })).items); });
      });
      for (const r of rs) { if (r.ok) items = items.concat(r.v); else partial = true; }
    }
    return { items: items.map(splitRow), total, partial };
  }
  const groupByDong = rows => { const m = new Map(); for (const r of rows) { const x = toRow(r); if (!x.ho) continue; const g = m.get(x.dong) || m.set(x.dong, new Map()).get(x.dong); g.set(x.ho, x); } return m; };

  // 단지 전체 동·호를 앞쪽부터 차례로 받기 (단지 모드가 여러 번 불러 쌓으면서, 다 받은 동부터 화면에 엽니다)
  //   GET /api/units?pnu=...&scan=1&from=1 → { total, pages, next, done, items:[쪽 순서대로] }
  //   한 번에 1.5~2.5초 안에서 받을 수 있는 만큼만 (받은 쪽은 이틀 저장 → 끊겨도 이어받기). 다 받으면 동별 목록을 저장하고 '완료' 표시
  if (req.query.scan) {
    const from = Math.max(1, parseInt(req.query.from, 10) || 1);
    const doneKey = `rmc:unitsd4:${P.pnu}:__all`;   // 10/29 호 이름에 동이 붙은 단지 나누기로 다시 셈 (예전 목록은 무시)
    if (from === 1) { try { const d = await rcmd(['GET', doneKey]); if (d) return send(res, 200, { ok: true, done: true, cached: true, dongs: JSON.parse(d) }); } catch { /* 처음부터 받기 */ } }
    // 잘게 나눠 보내야 화면에서 동이 차례로 켜집니다: 첫 응답 1.5초, 그다음 2.5초 분량씩 (전체 시간은 거의 같음)
    const t0 = Date.now(), BUDGET = from === 1 ? 1500 : 2500;
    const slim = it => it.map(r => ({ dongNm: r.dongNm, hoNm: r.hoNm, flrNo: r.flrNo, flrGbCdNm: r.flrGbCdNm }));
    const pkey = p => `unitsp:${P.pnu}:*:${p}`;
    let next0 = 0;
    const pace = async () => { const now = Date.now(), at = Math.max(now, next0); next0 = at + 160; if (at > now) await new Promise(r => setTimeout(r, at - now)); };
    const first = await cached(pkey(1), 2 * 86400e3, async () => { const f = await dataGoKr(HUB + 'getBrExposInfo', { ...q, numOfRows: 1000, pageNo: 1 }); return { items: slim(f.items), total: f.total || f.items.length }; });
    const per = first.items.length || 1, total = first.total || first.items.length, pages = Math.min(250, Math.max(1, Math.ceil(total / per)));
    const getPage = p => (p === 1 ? Promise.resolve(first.items) : cached(pkey(p), 2 * 86400e3, async () => { await pace(); return slim((await dataGoKr(HUB + 'getBrExposInfo', { ...q, numOfRows: per, pageNo: p })).items); })).then(v => v.map(splitRow));
    const want = []; for (let p = from; p <= Math.min(pages, from + 59); p++) want.push(p);
    const rs = await pool(want, 3, async p => { if (p !== from && Date.now() - t0 > BUDGET) throw new Error('budget'); return getPage(p); });
    // 앞에서부터 끊김 없이 받은 쪽까지만 돌려줌 (순서가 중요)
    const items = []; let next = from;
    for (const r of rs) { if (!r.ok) break; items.push(...r.v); next++; }
    const done = next > pages;
    if (done) { // 동별 목록 저장 → 다음부터는 누가 열어도 바로
      try {
        const all = [];
        const ps = []; for (let p = 1; p <= pages; p++) ps.push(p);
        const got = await pool(ps, 8, p => getPage(p));
        if (got.every(g => g.ok)) {
          got.forEach(g => all.push(...g.v));
          const g = groupByDong(all);
          await Promise.all([...g.entries()].filter(([dn]) => dn).map(([dn, m]) => cached(`unitsd3:${P.pnu}:${dn}`, 24 * 3600e3, async () => sortU([...m.values()])).catch(() => null)));
          await rcmd(['SET', doneKey, JSON.stringify([...g.keys()]), 'EX', String(30 * 86400)], 2500);
        }
      } catch { /* 저장 실패해도 화면에는 영향 없음 */ }
    }
    return send(res, 200, { ok: true, total, pages, from, next, done, items }, 0);
  }

  // 10/31 동 하나의 호별 공급면적: GET /api/units?pnu=...&dong=101동&sup=1 → { sup: { '1203': [59.92, 80.19], ... } } (전용, 공급)
  //   건축물대장 전유공용면적에서 그 호의 전용 + 주거공용(외벽·계단실 등). 주차장·관리사무소·커뮤니티 같은 기타 공용은 계약면적에만 들어가므로 뺌
  //   공용면적이 없거나(오래된 단지) 공급/전용 비율이 1.1~1.6 밖이면 그 호는 빼서 화면이 추정값(회색)으로 보여 줌
  if (!ho && dong && req.query.sup) {
    const D = String(dong).trim();
    const hk = s => String(s || '').replace(/\D/g, '') || String(s || '').replace(/\s|호$/g, '');
    const ETC = /주차|기계|전기실|발전|관리사무|경비|노인|경로|보육|어린이집|주민|커뮤니|휘트니스|헬스|독서|작은도서관|근린|상가|부대|복리|저수조|물탱크|정화조|펌프|쓰레기|자전거|창고|방재|중앙감시|MDF|변전/;
    const sum = (rows, keep) => {
      const U = {};
      for (const x of rows) {
        if (!keep(x)) continue;
        const k = hk(x.hoNm), a = num(x.area) || 0, gb = String(x.exposPubuseGbCdNm || ''), nm = `${x.mainPurpsCdNm || ''} ${x.etcPurps || ''}`;
        if (!k || !a) continue;
        const u = U[k] || (U[k] = { ex: 0, co: 0 });
        if (/전유/.test(gb)) u.ex += a; else if (/공용/.test(gb) && !ETC.test(nm)) u.co += a;
      }
      const out = {};
      for (const [k, u] of Object.entries(U)) { const sp = u.ex + u.co, r = sp / (u.ex || 1); if (u.ex > 10 && u.co >= 1 && r >= 1.1 && r <= 1.6) out[k] = [Math.round(u.ex * 100) / 100, Math.round(sp * 100) / 100]; }
      return out;
    };
    if (req.query.dbg) {   // 10/31 점검용: 받은 줄 수·실패 이유
      try { const rows = await dataGoKrAll(HUB + 'getBrExposPubuseAreaInfo', { ...q, dongNm: D }, { maxPages: 30 }); const k = rows.filter(x => !String(x.dongNm || '').trim() || sameTok(x.dongNm, D));
        return send(res, 200, { ok: true, n: rows.length, keep: k.length, gb: [...new Set(rows.map(x => x.exposPubuseGbCdNm))], s: rows.slice(0, 3).map(x => [x.dongNm, x.hoNm, x.exposPubuseGbCdNm, x.mainPurpsCdNm, x.etcPurps, x.area]), out: Object.keys(sum(rows, x => !String(x.dongNm || '').trim() || sameTok(x.dongNm, D))).length }, 0);
      } catch (e) { return send(res, 200, { ok: false, e: String(e && e.message || e).slice(0, 300) }, 0); }
    }
    let r = null;
    try {
      r = await cached(`unitsup:${P.pnu}:${D}`, 7 * 86400e3, async () => {
        let out = sum(await dataGoKrAll(HUB + 'getBrExposPubuseAreaInfo', { ...q, dongNm: D }, { maxPages: 30 }), x => !String(x.dongNm || '').trim() || sameTok(x.dongNm, D));
        if (!Object.keys(out).length && /^\d/.test(D)) out = sum((await dataGoKrAll(HUB + 'getBrExposPubuseAreaInfo', q, { maxPages: 60 })).map(splitRow), x => sameTok(x.dongNm, D));   // 호 이름에 동이 붙은 단지
        if (!Object.keys(out).length) throw new Error('none');   // 못 찾은 결과는 저장하지 않음 (잠깐 실패한 것을 7일 동안 붙잡지 않게)
        return { a: out };
      });
    } catch { r = null; }
    return send(res, 200, { ok: true, pnu: P.pnu, dong: D, sup: r ? r.a : {} }, r ? 86400 : 0);
  }

  // 동 하나의 호별 전용면적: GET /api/units?pnu=...&dong=101동&areas=1 → { areas: { '1203': 84.97, ... } }
  //   단지 배치표가 층마다 다른 평형을 표시하는 데 씀. 브이월드 공동주택가격(동 전체 한 번에) → 없으면 건축물대장 전유부(쪽 단위)
  if (!ho && dong && req.query.areas) {
    const D = String(dong).trim(), Y = new Date().getFullYear();
    const hk = s => String(s || '').replace(/\D/g, '') || String(s || '').replace(/\s|호$/g, '');
    let r = null;
    try {
      r = await cached(`unitar:${P.pnu}:${D}`, 24 * 3600e3, async () => {
        const out = {};
        if (VWORLD_KEY) for (const y of [Y, Y - 1]) {
          try {
            const rows = await vworldNed('getApartHousingPriceAttr', { pnu: P.pnu, stdrYear: y, dongNm: D });
            rows.filter(x => !String(x.dongNm || '').trim() || sameTok(x.dongNm, D)).forEach(x => { const a = num(x.prvuseAr); if (a) out[hk(x.hoNm)] = a; });
            if (Object.keys(out).length) return { src: 'vw', a: out };
          } catch { /* 다음 방법 */ }
        }
        const rows = await dataGoKrAll(HUB + 'getBrExposPubuseAreaInfo', { ...q, dongNm: D }, { maxPages: 15 });
        rows.filter(x => /전유/.test(x.exposPubuseGbCdNm || '') && (!String(x.dongNm || '').trim() || sameTok(x.dongNm, D)))
          .forEach(x => { const k = hk(x.hoNm), a = num(x.area); if (a) out[k] = Math.round(((out[k] || 0) + a) * 100) / 100; });
        if (!Object.keys(out).length && /^\d/.test(D)) {   // 호 이름에 동이 붙은 단지: 동 조건 없이 받아서 나눔
          const all = await dataGoKrAll(HUB + 'getBrExposPubuseAreaInfo', q, { maxPages: 30 });
          all.map(splitRow).filter(x => /전유/.test(x.exposPubuseGbCdNm || '') && sameTok(x.dongNm, D))
            .forEach(x => { const k = hk(x.hoNm), a = num(x.area); if (a) out[k] = Math.round(((out[k] || 0) + a) * 100) / 100; });
        }
        if (!Object.keys(out).length) throw new Error('none'); // 못 찾은 결과는 저장하지 않음
        return { src: 'hub', a: out };
      });
    } catch { r = null; }
    return send(res, 200, { ok: true, pnu: P.pnu, dong: D, areas: r ? r.a : {}, src: r ? r.src : '' }, r ? 86400 : 0);
  }

  // 동 하나의 호 목록만: GET /api/units?pnu=...&dong=101동
  if (!ho && dong) {
    const D = String(dong).trim();
    let partial = false;
    const list = await cached(`unitsd3:${P.pnu}:${D}`, 24 * 3600e3, async () => {
      const tries = [...new Set([D, D.replace(/동$/, ''), /동$/.test(D) ? '' : D + '동', D.replace(/^제/, '')].filter(Boolean)), null];   // 마지막(null) = 동 조건 없이 전체 → 호 이름에 동이 붙은 단지
      for (const nm of tries) {
        const r = await expos(nm == null ? { ...q } : { ...q, dongNm: nm }, 16000);
        const rows = r.items.filter(x => sameTok(x.dongNm, D));
        // 공공데이터가 동 이름 조건을 무시하고 단지 전체를 준 경우: 다른 동 목록도 함께 저장해 두면 다음 동은 바로 열립니다
        if (!r.partial && r.items.length > rows.length * 1.5 + 20) {
          const all = groupByDong(r.items);
          await Promise.all([...all.entries()].filter(([dn]) => dn && !sameTok(dn, D)).slice(0, 120)
            .map(([dn, g]) => cached(`unitsd3:${P.pnu}:${dn}`, 24 * 3600e3, async () => sortU([...g.values()])).catch(() => null)));
        }
        if (rows.length) {
          const g = groupByDong(rows), out = sortU([...[...g.values()].flatMap(m => [...m.values()])]);
          if (r.partial) { partial = true; return { partial: { ok: false }, units: out }; } // 저장하지 않음
          return out;
        }
        if (r.partial) { partial = true; return { partial: { ok: false }, units: [] }; }
      }
      return [];
    });
    const units = Array.isArray(list) ? list : list.units;
    return send(res, 200, { ok: true, pnu: P.pnu, dong: D, count: units.length, units, partial }, units.length && !partial ? 86400 : 0);
  }

  if (!ho) {
    const list = await cached('units3:' + P.pnu, 24 * 3600e3, async () => {
      const rows = await dataGoKrAll(HUB + 'getBrExposInfo', q, { maxPages: 80 });
      const seen = new Set(), out = [];
      for (const r0 of rows) {
        const r = splitRow(r0), dn = String(r.dongNm || '').trim(), hn = String(r.hoNm || '').trim();
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
        const pick = rows => rows.filter(r0 => { const r = splitRow(r0); return sameTok(r.hoNm, H) && (!D || !String(r.dongNm || '').trim() || sameTok(r.dongNm, D)); });
        // 동·호 이름 표기가 대장마다 달라서, 못 찾으면 조건을 줄여 가며 다시 찾습니다.
        let rows = pick(await dataGoKrAll(HUB + 'getBrExposPubuseAreaInfo', { ...q, dongNm: D, hoNm: H }, { maxPages: 5 }));
        if (!rows.length) rows = pick(await dataGoKrAll(HUB + 'getBrExposPubuseAreaInfo', { ...q, hoNm: H }, { maxPages: 5 }));
        if (!rows.length && /^\d/.test(D)) rows = pick(await dataGoKrAll(HUB + 'getBrExposPubuseAreaInfo', { ...q, hoNm: `${/동$/.test(D) ? D : D + '동'} ${H}` }, { maxPages: 5 }));   // '101동 1801'
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
