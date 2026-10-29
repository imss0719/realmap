// 단지 동 위치 — /api/parcel?dongs=1 결과를 한 번만 받아 둡니다 (지도·중개장부 같이 씀)
//   DongPos.get(pnus, want, name) → Promise<{ by: Map(정규화 동 → {dong, lat, lng, ring}), list, miss }>
//        pnus: 단지의 필지들(하나여도 됨) · want: 찍을 동 이름들 · name: 단지 이름
//   DongPos.peek(pnus, want, name) → 이미 받은 결과(없으면 undefined)
//   DongPos.at(pnu, dong) → 그 필지가 들어간 결과에서 찾은 동 위치 {lat, lng, ring} 또는 null
//   DongPos.norm('제101동') → '101'
window.DongPos = (() => {
  const norm = s => String(s || '').replace(/\s/g, '').replace(/^제/, '').replace(/동$/, '').toUpperCase();
  const done = new Map(), wait = new Map(), merged = new Map(), Q = [];
  let run = 0;
  const EMPTY = { by: new Map(), list: [], miss: [] };
  const args = (pnus, want, name) => {
    const P = [...new Set([].concat(pnus || []).map(v => String(v || '').replace(/\D/g, '')).filter(v => v.length === 19))].sort();
    const W = [...new Set((want || []).map(norm).filter(Boolean))].sort();
    return { P, W, name: String(name || ''), key: P.join(',') + '|' + W.join(',') + '|' + (W.length ? name || '' : '') };
  };
  function pump() {
    while (run < 3 && Q.length) {
      const [a, ok] = Q.shift(); run++;
      const q = new URLSearchParams({ dongs: '1', v: '4', pnus: a.P.join(',') });   // v: 서버 방식이 바뀌면 올려서 CDN에 남은 예전 결과를 피함
      if (a.W.length) { q.set('want', a.W.join(',')); if (a.name) q.set('name', a.name); }
      fetch('/api/parcel?' + q).then(r => r.json()).catch(() => null).then(j => {
        const by = new Map(), list = j && j.ok && Array.isArray(j.buildings) ? j.buildings.filter(b => b.dong) : [];
        for (const b of list) { const k = norm(b.dong); if (!by.has(k)) by.set(k, b); }
        const v = list.length ? { by, list, miss: (j && j.miss) || [] } : EMPTY;
        if (j) {   // 연결 실패는 기억하지 않음 (다음에 다시 시도)
          done.set(a.key, v);
          for (const p of a.P) { const M = merged.get(p) || merged.set(p, new Map()).get(p); by.forEach((b, k) => { if (!M.has(k)) M.set(k, b); }); }
        }
        wait.delete(a.key); ok(v);
      }).finally(() => { run--; pump(); });
    }
  }
  function get(pnus, want, name) {
    const a = args(pnus, want, name);
    if (!a.P.length) return Promise.resolve(EMPTY);
    if (done.has(a.key)) return Promise.resolve(done.get(a.key));
    if (!wait.has(a.key)) wait.set(a.key, new Promise(ok => { Q.push([a, ok]); pump(); }));
    return wait.get(a.key);
  }
  const peek = (pnus, want, name) => done.get(args(pnus, want, name).key);
  const at = (pnu, dong) => { const M = merged.get(String(pnu || '')); const b = M && dong ? M.get(norm(dong)) : null; return b ? { lat: b.lat, lng: b.lng, ring: b.ring || [] } : null; };
  return { get, peek, at, norm };
})();

// 10/29 중개사무소 지도 자리 — OfficePos(bk) → Promise<{lat, lng} | null> (카카오 지도 services 필요)
//   주소 좌표는 아파트 단지처럼 주소 하나에 건물이 여럿이면 엉뚱한 단지에 찍힘(마포대로 195 → 4단지 쪽)
//   → 주소의 지번 필지(PNU)를 알아내 ① 주소에 '101동' 같은 동 번호가 있으면 그 동 건물 자리 ② 없으면(상가동 등) 그 필지 한가운데
//   ③ 그 근처 500m 안에 카카오에 같은 이름 중개업소가 있으면 그 자리가 제일 정확하니 그것으로
window.OfficePos = bk => new Promise(done => {
  if (!window.kakao || !kakao.maps || !kakao.maps.services || !bk || !bk.addr) return done(null);
  const S = kakao.maps.services, G = new S.Geocoder(), PL = new S.Places();
  const a0 = String(bk.addr).replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
  const cut = (a0.match(/^.*?(?:로|길)\s+\d+(?:-\d+)?/) || a0.match(/^.*?(?:동|가|리)\s+(?:산\s*)?\d+(?:-\d+)?/) || [a0])[0];
  const rest = a0.slice(cut.length), dn = (rest.match(/(?:^|\s)제?(\d{1,4})\s*동(?:\s|$)/) || [])[1] || '';
  const nm = t => String(t || '').replace(/\([^)]*\)/g, '').replace(/\s+/g, '').replace(/^(주식회사|㈜)/, '').replace(/(공인중개사사무소|공인중개사|중개사사무소|중개법인|부동산중개|부동산사무소|부동산)+$/g, '').replace(/(공인중개사사무소|공인중개사|부동산)+$/g, '');
  const me = nm(bk.office);
  const cen = g => {   // 가장 큰 고리의 넓이 중심
    const rings = !g ? [] : g.type === 'MultiPolygon' ? g.coordinates.map(p => p[0]) : g.type === 'Polygon' ? [g.coordinates[0]] : [];
    let best = null, ba = 0;
    for (const R of rings) { let A = 0, X = 0, Y = 0; for (let i = 0; i < R.length - 1; i++) { const [x1, y1] = R[i], [x2, y2] = R[i + 1], f = x1 * y2 - x2 * y1; A += f; X += (x1 + x2) * f; Y += (y1 + y2) * f; } if (Math.abs(A) > ba) { ba = Math.abs(A); best = { lat: Y / (3 * A), lng: X / (3 * A) }; } }
    return best;
  };
  const near = pt => {
    if (!me) return done(pt);
    const qs = [...new Set([String(bk.office).replace(/\([^)]*\)/g, '').trim(), me + '부동산', me + '공인중개사'])];
    const go = i => {
      if (i >= qs.length) return done(pt);
      PL.keywordSearch(qs[i], (r, st) => {
        const hit = st === 'OK' && (r || []).find(z => z.category_group_code === 'AG2' && nm(z.place_name).includes(me) && +z.distance <= 500);
        if (hit) done({ lat: +hit.y, lng: +hit.x }); else go(i + 1);
      }, { location: new kakao.maps.LatLng(pt.lat, pt.lng), radius: 500, sort: S.SortBy.DISTANCE });
    };
    go(0);
  };
  const fromHit = async h => {
    const base = { lat: +h.y, lng: +h.x }, j = h.address || null;
    const pnu = j && j.b_code ? j.b_code + (j.mountain_yn === 'Y' ? '2' : '1') + String(j.main_address_no || 0).padStart(4, '0') + String(j.sub_address_no || 0).padStart(4, '0') : '';
    if (!/^\d{19}$/.test(pnu)) return near(base);
    try {
      if (dn && window.DongPos) { const d = await DongPos.get([pnu], [dn]), b = d.by.get(DongPos.norm(dn)); if (b && b.lat) return near({ lat: b.lat, lng: b.lng }); }
      const p = await fetch('/api/parcel?pnu=' + pnu).then(r => r.json()), c = p && p.ok ? cen(p.geometry) : null;
      return near(c && c.lat > 33 ? { lat: +c.lat.toFixed(6), lng: +c.lng.toFixed(6) } : base);
    } catch { return near(base); }
  };
  const tries = [...new Set([bk.addr, a0, cut])];
  const next = i => {
    if (i >= tries.length) return PL.keywordSearch(cut, (r, st) => { if (st === 'OK' && r && r[0]) near({ lat: +r[0].y, lng: +r[0].x }); else done(null); });
    G.addressSearch(tries[i], (r, st) => { if (st === 'OK' && r && r[0]) fromHit(r[0]); else next(i + 1); });
  };
  next(0);
});
