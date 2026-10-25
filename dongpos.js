// 단지 동 위치 — /api/parcel?pnu=…&dongs=1 결과를 필지별로 한 번만 받아 둡니다 (지도·중개장부 같이 씀)
//   DongPos.get(pnu)  → Promise<{ by: Map(정규화 동 → {dong, lat, lng, ring}), list }>  (못 찾으면 by가 빈 Map)
//   DongPos.peek(pnu) → 이미 받은 결과(없으면 undefined)
//   DongPos.at(pnu, dong) → 받아 둔 동 위치 {lat, lng} 또는 null
//   DongPos.norm('제101동') → '101'
window.DongPos = (() => {
  const norm = s => String(s || '').replace(/\s/g, '').replace(/^제/, '').replace(/동$/, '').toUpperCase();
  const done = new Map(), wait = new Map(), Q = [];
  let run = 0;
  const EMPTY = { by: new Map(), list: [] };
  function pump() {
    while (run < 3 && Q.length) {
      const [pnu, ok] = Q.shift(); run++;
      fetch(`/api/parcel?pnu=${pnu}&dongs=1`).then(r => r.json()).catch(() => null).then(j => {
        const by = new Map(), list = j && j.ok && Array.isArray(j.buildings) ? j.buildings.filter(b => b.dong) : [];
        for (const b of list) { const k = norm(b.dong); if (!by.has(k)) by.set(k, b); }   // 같은 동 이름이 둘이면 먼저 나온 것
        const v = list.length ? { by, list } : EMPTY;
        if (j) done.set(pnu, v);   // 연결 실패는 기억하지 않음 (다음에 다시 시도)
        wait.delete(pnu); ok(v);
      }).finally(() => { run--; pump(); });
    }
  }
  function get(pnu) {
    pnu = String(pnu || '').replace(/\D/g, '');
    if (pnu.length !== 19) return Promise.resolve(EMPTY);
    if (done.has(pnu)) return Promise.resolve(done.get(pnu));
    if (!wait.has(pnu)) wait.set(pnu, new Promise(ok => { Q.push([pnu, ok]); pump(); }));
    return wait.get(pnu);
  }
  const peek = pnu => done.get(String(pnu || ''));
  const at = (pnu, dong) => { const v = peek(pnu); const b = v && dong ? v.by.get(norm(dong)) : null; return b ? { lat: b.lat, lng: b.lng } : null; };
  return { get, peek, at, norm };
})();
