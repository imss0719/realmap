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
