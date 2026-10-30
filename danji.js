// 리얼맵 단지 장부 (PRO 회원 전용)
// 자주 보는 아파트 단지를 등록해 두고, 동별 '층 × 라인' 표에서 내 매물·호별 메모·층별 실거래를 한눈에 봅니다.
// 매물장(listings.html) 안에서 '단지 모드'로 열립니다: Danji.mount(요소, host) · Danji.refresh() · Danji.add(PNU)
window.Danji = (() => {
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const KIND = { sale: '매매', jeonse: '전세', wolse: '월세', presale: '분양권' };
  const PY = 3.3058;
  const S = { boardOpen: (() => { try { return localStorage.getItem('rm.djboard') === '1'; } catch { return false; } })(), cx: { items: [], memos: {} }, cur: null, C: {}, results: null, adding: false, el: null, host: null, loaded: false, L: {}, onClose: null };
  async function api(url, opt) {
    const r = await fetch(url, { credentials: 'same-origin', ...opt });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.ok === false) { const e = new Error(j.message || '잠시 연결이 원활하지 않습니다.'); e.code = j.error; e.data = j; throw e; }   // 10/28 e.data: 다른 직원이 먼저 고친 새 내용
    return j;
  }
  const post = (body) => api('/api/auth?action=cx', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const toast = (msg, ms) => S.host.toast(msg, ms);
  const shortWon = man => !man ? '' : man >= 10000 ? `${(man / 10000).toFixed(man % 10000 ? 1 : 0).replace(/\.0$/, '')}억` : `${Math.round(man).toLocaleString()}만`;
  const med = a => { if (!a.length) return null; a = [...a].sort((x, y) => x - y); const m = a.length >> 1; return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; };
  const digits = s => String(s || '').replace(/\D/g, '');
  // 동 이름 비교: '제101동'·'101동'·'101' 은 같게, 'T402동'과 '402동'은 다르게 (숫자만 비교하면 섞임)
  // 10/28 오피스텔: 동 이름이 비었거나('') 건물 이름('○○빌딩')인 경우도 있음 · '주건축물제1동' → '1' · 호 '4층404호' → '404'
  const normD = s => String(s || '').replace(/\s/g, '').replace(/^주건축물/, '').replace(/^제/, '').replace(/동$/, '').toUpperCase().slice(0, 16);
  const normH = s => { const t = String(s || '').replace(/\s/g, '').replace(/^(지하)?\d+층(?=\D*\d)/, ''); return digits(t) || t.replace(/호$/, ''); };
  const DN = dn => !dn ? '' : /\d$|^[A-Z가-힣]$/.test(dn) ? dn + '동' : dn;                 // 화면 표시: '101' → '101동' · 건물 이름은 그대로 · 없으면 ''
  const UL = x => [DN(x.dn), x.ho + '호'].filter(Boolean).join(' ');                       // '101동 1203호' · '1203호'
  const US = x => x.dn && /\d$|^[A-Z가-힣]$/.test(x.dn) ? `${x.dn}-${x.ho}` : x.ho + '호';   // 짧게: '101-1203' · '1203호'
  const normName = s => String(s || '').replace(/\s|\(.*?\)|아파트|APT/gi, '');
  const baseName = s => normName(s).replace(/\d+단지$/, '');                       // '마포래미안푸르지오4단지' → '마포래미안푸르지오'
  const nat = (a, b) => String(a).localeCompare(String(b), 'ko', { numeric: true });

  // ---------- 시작 ----------
  // host: { items() → 매물 목록, openAdd(pnu, dong, ho), openEdit(id), toast(msg, ms) }
  async function mount(el, host) {
    S.el = el; S.host = host;
    if (!$('djSheet')) {
      const sh = document.createElement('div');
      sh.className = 'sheet dj'; sh.id = 'djSheet'; sh.hidden = true;
      sh.innerHTML = '<div class="sbox" role="dialog" aria-modal="true" aria-labelledby="djShTitle"><div class="shd"><b id="djShTitle">호 정보</b><button type="button" id="djShClose" aria-label="닫기">×</button></div><div class="sb" id="djShBody"></div></div>';
      document.body.appendChild(sh);
      $('djShClose').onclick = closeSheet;
      sh.onclick = e => { if (e.target === sh) closeSheet(); };
      addEventListener('keydown', e => { if (e.key === 'Escape' && !sh.hidden) closeSheet(); });
    }
    if (!S.loaded) {
      el.innerHTML = '<div class="dj-wrap" id="dj_wrap"><div class="loading">단지 장부를 불러오는 중…</div></div>';
      try { const cx = await api('/api/auth?action=cx'); S.cx = { items: cx.items || [], memos: cx.memos || {} }; } catch (e) { toast(e.message, 4000); }
      S.loaded = true; S.cur = S.cur || (S.cx.items[0] || {}).id || null;
    } else if (!$('dj_wrap')) el.innerHTML = '<div class="dj-wrap" id="dj_wrap"></div>';
    // 10/28 아파트 화면에 들어올 때는 항상 '모든 단지' 표부터 (알림에서 호로 가기·단지 담기·테스트 주소는 그대로)
    if (!S.adding && !new URLSearchParams(location.search).get('seed')) { S.multi.clear(); saveMulti(); S.cur = S.cx.items.length >= 2 ? '__all' : (S.cx.items[0] || {}).id || null; S.lastCx = null; if (djTab() !== 'table') setTab('table'); }
    draw();
  }
  function refresh() { if (S.loaded && S.el && S.el.offsetParent !== null) draw(); }
  async function add(pnu) { while (!S.loaded) await new Promise(r => setTimeout(r, 150)); await addComplex({ pnu }); }
  // 알림에서 '그 호로 가기': 그 단지를 열고 그 호 줄로 (필터는 모두 풀고)
  async function goto(cxid, key) {
    while (!S.loaded) await new Promise(r => setTimeout(r, 150));
    if (!S.cx.items.some(c => c.id === cxid)) return toast('그 단지를 찾지 못했습니다');
    S.adding = false; S.multi.clear(); saveMulti(); S.cur = cxid; S.hist = null; resetF(); S.focusKey = key;
    const C = S.C[cxid]; if (C) C.view = 'all';
    draw();
  }
  const items = () => S.host.items() || [];

  // ---------- 단지 추가 ----------
  function centroid(g) { try { const ring = g.type === 'MultiPolygon' ? g.coordinates[0][0] : g.coordinates[0]; let x = 0, y = 0; ring.forEach(p => { x += p[0]; y += p[1]; }); return { lng: x / ring.length, lat: y / ring.length }; } catch { return {}; } }
  async function placeOf({ pnu, lat, lng }) {
    const p = pnu ? await api(`/api/parcel?pnu=${pnu}`) : await api(`/api/parcel?lat=${lat}&lng=${lng}`);
    const c = pnu ? centroid(p.geometry) : { lat, lng };
    return { pnu: p.bldPnu || p.pnu, addr: p.addr || '', lat: c.lat, lng: c.lng };
  }
  async function nameOf(pnu) {
    try { const b = await api(`/api/building?pnu=${pnu}`); const rc = b.recap && b.recap.data && b.recap.data[0]; const t = (b.titles && b.titles.data || []).find(x => x.name); return (rc && rc.name) || (t && t.name) || ''; } catch { return ''; }
  }
  async function addComplex(src, toId) {
    toast('단지를 확인하는 중입니다…', 6000);
    try {
      const pl = await placeOf(src);
      if (toId) { const j = await post({ op: 'addplace', id: toId, place: pl }); S.cx = { items: j.items, memos: j.memos }; delete S.C[toId]; S.cur = toId; toast('필지를 추가했습니다'); }
      else {
        const nm = await nameOf(pl.pnu);
        const j = await post({ op: 'add', name: nm, place: pl });
        S.cx = { items: j.items, memos: j.memos }; S.cur = j.id;
        toast(nm ? `${nm}을(를) 단지 장부에 담았습니다` : '단지를 담았습니다');
      }
    } catch (e) { if (e.code === 'full' && S.host.upsell) S.host.upsell(e.message); else toast(e.message || '추가하지 못했습니다', 4000); }
    S.adding = false; S.results = null; draw();
  }
  function search(q) {
    if (!q) return;
    if (!(window.kakao && kakao.maps && kakao.maps.services)) return toast('검색을 준비하고 있습니다. 잠시 후 다시 눌러 주세요.');
    const out = []; let left = 2;
    const done = () => { if (--left) return; const seen = new Set(); out.sort((a, b) => a.o - b.o); S.results = out.filter(r => { const k = r.lat.toFixed(5) + r.lng.toFixed(5); if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 8); drawAdd(); };
    // 장소 좌표는 건물 출입구 등이라 옆 필지를 가리킬 수 있음 → 장소의 지번 주소로 다시 찾아 정확한 필지 좌표로
    new kakao.maps.services.Places().keywordSearch(q, (r, st) => { const L = st === 'OK' ? r.slice(0, 6) : []; let n = L.length; if (!n) return done(); const G = new kakao.maps.services.Geocoder();
      L.forEach((a, i) => G.addressSearch(a.address_name, (g, s2) => { const h = s2 === 'OK' && g && g[0]; out.push({ t: a.place_name, s: a.address_name, lat: h ? +h.y : +a.y, lng: h ? +h.x : +a.x, o: 0 + i }); if (!--n) done(); })); });
    new kakao.maps.services.Geocoder().addressSearch(q, (r, st) => { if (st === 'OK') r.forEach((a, i) => out.push({ t: a.address_name, s: a.road_address ? a.road_address.address_name : '', lat: +a.y, lng: +a.x, o: 100 + i })); done(); });
  }
  function addBox(toId) {
    return `<div class="card" id="dj_addCard"><h2>${toId ? '이 단지에 필지 추가' : '단지 추가'}<small>단지 이름이나 주소로 찾기</small></h2>
      <input class="find" id="dj_aq" type="search" placeholder="예: ○○래미안, ○○오피스텔, ○○동 777" autocomplete="off">
      <div class="res" id="dj_ares"></div>
      <p class="note">오피스텔·주상복합도 같은 방법으로 담습니다. 리얼맵 지도에서 건물을 누른 뒤 '단지에 담기'를 눌러도 됩니다. 1단지·2단지처럼 지번이 여러 개인 단지는 담은 뒤 '필지 추가'로 나머지 지번을 넣어 주세요.</p></div>`;
  }
  function drawAdd() {
    const el = $('dj_ares'); if (!el) return;
    el.innerHTML = S.results == null ? '' : S.results.length ? S.results.map((r, i) => `<button type="button" data-r="${i}"><b>${esc(r.t)}</b><small>${esc(r.s)}</small></button>`).join('') : '<div class="muted">검색 결과가 없습니다.</div>';
    el.querySelectorAll('[data-r]').forEach(b => b.onclick = () => { const r = S.results[+b.dataset.r]; addComplex({ lat: r.lat, lng: r.lng }, S.adding === 'place' ? S.cur : null); });
  }

  // ---------- 화면 ----------
  function draw() {
    const W = $('dj_wrap'); if (!W) return;
    if (S.pk && (S.adding || (S.cur !== '__all' && S.pk.cx !== S.cur))) closePanel();   // 다른 단지·매물장으로 가면 입력창 닫기
    const chips = `<div class="djcap"><b>아파트·오피스텔</b><span>단지·건물별 동·호 장부</span></div><div class="chips">${S.cx.items.length >= 2 ? `<button type="button" data-cx="__all" class="allcx" aria-pressed="${S.cur === '__all' && !S.adding}">모든 단지</button>` : ''}${S.cx.items.map(c => `<button type="button" data-cx="${c.id}" aria-pressed="${c.id === S.cur && !S.adding}">${esc(c.name)}</button>`).join('')}<button type="button" class="add" id="dj_addBtn" aria-pressed="${S.adding === true}">＋ 단지 추가</button></div>`;
    // 넓은 화면: 왼쪽 단지 목록(폴더) + 오른쪽 내용 · 좁은 화면: 위쪽 단지 버튼 (10/26)
    // 10/26: 단지 고르기는 왼쪽 목록 + 머리의 드롭메뉴로. 위쪽 단지 버튼 줄은 단지 추가 화면에서만
    const lay = inner => `<div class="djlay${S.cx.items.length ? ' hastree' : ''}"><aside class="djtree" id="dj_tree"></aside><div class="djmain">${S.adding || !S.cx.items.length ? chips : ''}${inner}</div></div>`;
    if (S.adding || !S.cx.items.length) {
      W.innerHTML = lay(addBox(S.adding === 'place' ? S.cur : null) + (S.cx.items.length ? '' : `<div class="empty"><b>자주 보는 단지를 담아 보세요</b>동별로 층과 라인을 펼쳐 놓고, 내 매물·호별 메모·층별 실거래를 한 장에서 봅니다.${otherHint()}</div>`));
      wireChips(); drawTree(); const q = $('dj_aq'); q.onkeydown = e => { if (e.key === 'Enter') search(q.value.trim()); }; q.focus(); drawAdd();
      W.querySelectorAll('[data-ocat]').forEach(b => b.onclick = () => S.host.goCat && S.host.goCat(b.dataset.ocat)); return;
    }
    if (S.cur === '__all' && S.cx.items.length >= 2) { W.innerHTML = lay(`<div id="dj_cxBody"></div>`); wireChips(); drawTree(); return drawAll(); }
    const cx = S.cx.items.find(c => c.id === S.cur) || S.cx.items[0]; S.cur = cx.id;
    W.innerHTML = lay(`<div id="dj_cxBody"></div>`);
    wireChips();
    drawComplex(cx);
    drawTree();
  }
  function wireChips() {
    document.querySelectorAll('[data-cx]').forEach(b => b.onclick = () => { S.multi.clear(); saveMulti(); S.cur = b.dataset.cx; S.adding = false; draw(); });
    if ($('dj_addBtn')) $('dj_addBtn').onclick = () => { S.adding = S.adding === true ? false : true; S.results = null; draw(); };
  }

  // 필지 하나의 아파트 동 목록 (건축물대장 표제부, 상가·관리동 등 제외)
  async function dongsOf(pnu) {
    try {
      const b = await api(`/api/building?pnu=${pnu}`);
      const main = ((b.titles && b.titles.data) || []).filter(t => t.mainAtch !== '부속건축물');
      let L = main.filter(t => t.dong && /\d/.test(t.dong) && !/상가|관리|경로|어린이|커뮤니티|주민|근린/.test(t.dong + (t.use || '')));
      // 10/28 오피스텔·주상복합: 동 번호가 없는 건물(동 이름이 비었거나 'A동'·'○○빌딩') → 호가 있는 주건축물을 그대로
      if (!L.length) L = main.filter(t => (+t.ho || +t.hhld) > 0 && !/관리|경로|어린이|커뮤니티|주민/.test(String(t.dong || '')));
      // 10/29 단지 전체가 건물 하나로 등록되고 호 이름에 동이 붙은 경우('101동 1801') → 서버가 나눠 준 동(101동·102동…)을 그대로 동으로
      if (L.length && L.every(t => !/\d/.test(String(t.dong || '')))) {
        try {
          const u = (await api(`/api/units?pnu=${pnu}`)).units || [], t0 = L[0], cnt = new Map();
          u.forEach(z => { const d = String(z.dong || '').trim(); if (/^\d/.test(d)) cnt.set(d, (cnt.get(d) || 0) + 1); });
          if (cnt.size) return [...cnt.entries()].sort((a, b) => a[0].localeCompare(b[0], 'ko', { numeric: true })).map(([d, n]) => ({ pnu, dong: d, grnd: t0.grnd, ho: n, hhld: n, use: t0.use, apr: t0.useApr }));
        } catch { /* 건물 하나로 */ }
      }
      return L.map(t => ({ pnu, dong: String(t.dong || '').trim(), grnd: t.grnd, ho: t.ho, hhld: t.hhld, use: t.use, apr: t.useApr }));
    } catch { return []; }
  }
  // 같은 이름 계열 단지(1단지·2단지…)의 지번을 실거래에서 찾아 자동으로 붙입니다
  async function discover(cx, C) {
    const base = baseName(cx.name); if (base.length < 3) return;
    const known = new Set(cx.places.map(p => p.pnu)), p0 = cx.places[0], cand = new Map();
    for (const r of C.trades || []) {
      if (r.kind !== 'apt' || !r.jibun || !normName(r.name).startsWith(base)) continue;
      const m = String(r.jibun).match(/^(산\s*)?(\d+)(?:-(\d+))?$/); if (!m) continue;
      const bjd = /^\d{5}$/.test(r.sgg || '') && /^\d{5}$/.test(r.umdCd || '') ? r.sgg + r.umdCd : p0.pnu.slice(0, 10);
      const pnu = bjd + (m[1] ? '2' : '1') + m[2].padStart(4, '0') + (m[3] || '0').padStart(4, '0');
      if (!known.has(pnu)) cand.set(pnu, r.name);
    }
    let added = 0;
    for (const pnu of [...cand.keys()].slice(0, 8)) {
      const ds = await dongsOf(pnu);
      if (!ds.length) continue;
      try {
        const pl = await placeOf({ pnu });
        const j = await post({ op: 'addplace', id: cx.id, place: pl });
        S.cx = { items: j.items, memos: j.memos }; cx.places = (j.items.find(x => x.id === cx.id) || cx).places;
      } catch { continue; }
      const seen = new Set(C.dongs.map(d => d.pnu + '|' + d.dong));
      ds.forEach(d => { if (!seen.has(d.pnu + '|' + d.dong)) C.dongs.push(d); });
      added++;
    }
    if (added) { C.dongs.sort((a, b) => nat(a.dong, b.dong)); C.auto = added; scanAll(cx, C); if (S.cur === cx.id) { toast(`같은 단지의 다른 지번 ${added}곳을 찾아 동 목록에 더했습니다`); drawComplex(cx); } }
  }
  async function loadComplex(cx) {
    const C = S.C[cx.id] = { dongs: null, trades: null, units: {}, lines: {}, cur: null, err: null };
    // 1) 건축물대장 표제부 → 동 목록 (필지마다)
    const lists = await Promise.all(cx.places.map(p => dongsOf(p.pnu)));
    const seen = new Set();
    C.dongs = lists.flat().filter(d => { const k = d.pnu + '|' + d.dong; if (seen.has(k)) return false; seen.add(k); return true; }).sort((a, b) => nat(a.dong, b.dong));
    C.cur = C.dongs[0] ? C.dongs[0].pnu + '|' + C.dongs[0].dong : null;
    scanAll(cx, C); // 단지를 열자마자 전체 동·호를 차례로 받기 시작 (기다리지 않고 아래 실거래도 함께)
    if (S.cur === cx.id) drawComplex(cx);
    // 2) 최근 1년 실거래 (단지 이름 앞부분이 같으면 1~4단지 모두)
    const p0 = cx.places[0], umd = (String(p0.addr).split(' ').find(w => /(동|가|리)\d*$/.test(w) && !/[시군구]$/.test(w)) || '');
    try {
      const j = await api(`/api/trades?${new URLSearchParams({ pnu: p0.pnu, kinds: 'apt,aptRent', months: 12, umd, name: baseName(cx.name), np: '1' })}`);
      C.trades = (j.rows || []).filter(r => !r.cancel);
    } catch (e) { C.trades = []; C.err = e.message; }
    if (S.cur === cx.id) drawComplex(cx);
    discover(cx, C);
  }

  // ---------- 단지 전체 동·호 차례로 받기 ----------
  // 단지를 열면 바로 필지별로 앞쪽부터 받아 쌓고, 호를 다 받은 동부터 버튼을 열어 줍니다.
  // 동이 끝났다고 보는 기준: ① 표제부 세대(호) 수만큼 받음 ② 공공데이터가 동 순서대로 주는데 다음 동이 시작됨 ③ 전체를 다 받음
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const natc = (a, b) => String(a).localeCompare(String(b), 'ko', { numeric: true });
  async function scanAll(cx, C) {
    C.scan = C.scan || { done: false, per: {} };
    // 같은 단지의 다른 지번이 나중에 더해져도 이어서 받도록, 동 목록에서 아직 안 받은 필지를 매번 찾습니다
    (C.dongs || []).forEach(d => { C.scan.per[d.pnu] = C.scan.per[d.pnu] || { rows: new Map(), closed: new Set(), sorted: true, last: null, done: false, pages: 0, next: 1 }; });
    if (C.scan.running) return;
    C.scan.running = true; C.scan.done = false;
    let pnu;
    while ((pnu = Object.keys(C.scan.per).find(k => !C.scan.per[k].done))) {
      const sc = C.scan.per[pnu];
      let fails = 0;
      while (!sc.done) {
        if (S.C[cx.id] !== C) { C.scan.running = false; return; } // 단지를 다시 불러왔으면 멈춤
        let j;
        try { j = await api(`/api/units?pnu=${pnu}&scan=1&from=${sc.next}`); fails = 0; }
        catch { if (++fails >= 4) { sc.done = true; sc.failed = true; break; } await sleep(1500 * fails); continue; }
        if (j.cached) { sc.done = true; sc.cached = true; sc.names = new Map((j.dongs || []).map(n => [normD(n), n])); break; } // 이미 저장된 단지 → 동마다 바로 받음
        if (!j.pages) { sc.done = true; sc.failed = true; break; } // 서버가 차례 받기를 모르면(이전 버전) 예전처럼 동마다
        sc.pages = j.pages || sc.pages;
        for (const r of j.items || []) {
          const dn = normD(r.dongNm), ho = String(r.hoNm || '').trim(); if (!ho) continue;
          if (dn !== sc.last) { if (sc.last != null) { if (sc.rows.has(dn)) sc.sorted = false; else sc.closed.add(sc.last); } sc.last = dn; }
          const m = sc.rows.get(dn) || sc.rows.set(dn, new Map()).get(dn);
          m.set(ho, { dong: String(r.dongNm || '').trim(), ho, flr: r.flrNo == null || r.flrNo === '' ? null : Number(r.flrNo), flrGb: r.flrGbCdNm || '' });
        }
        sc.next = j.next || sc.next + 1; sc.done = !!j.done;
        scanApply(cx, C);
      }
      scanApply(cx, C);
    }
    C.scan.running = false; C.scan.done = true; scanApply(cx, C);
  }
  // 받은 만큼 동별 목록을 채우고 화면(버튼·진행률)만 가볍게 고칩니다
  function scanApply(cx, C) {
    for (const d of C.dongs || []) {
      const key = d.pnu + '|' + d.dong, sc = C.scan.per[d.pnu];
      if (!sc || sc.cached || (C.units[key] && C.units[key] !== 'loading')) continue;
      const dn = normD(d.dong), m = sc.rows.get(dn), n = m ? m.size : 0, want = d.ho || d.hhld || 0;
      const ready = (sc.done && !sc.failed) || (want && n >= want) || (sc.sorted && sc.closed.has(dn));
      if (!ready || (!n && !sc.done)) continue;
      if (!n) continue; // 다 받았는데 이 이름으로는 없음 → 누르면 동 이름으로 따로 찾기
      C.units[key] = [...m.values()].sort((a, b) => (b.flr ?? 0) - (a.flr ?? 0) || natc(a.ho, b.ho));
      C.want = C.want || {}; C.want[key] = want;
    }
    if (S.cur !== cx.id || S.C[cx.id] !== C) return;
    const wait = d => { const p = C.scan && C.scan.per[d.pnu]; return !!p && !p.done && !p.cached && !Array.isArray(C.units[d.pnu + '|' + d.dong]); };
    // 처음 열 동: 아직 고르지 않았고 지금 동이 준비 전이면, 먼저 준비된 동을 엽니다
    const curD = (C.dongs || []).find(d => d.pnu + '|' + d.dong === C.cur);
    if (!C.picked && curD && wait(curD)) { const r = (C.dongs || []).find(d => !wait(d)); if (r) { C.cur = r.pnu + '|' + r.dong; return drawComplex(cx); } }
    document.querySelectorAll('#dj_dongs [data-dong]').forEach(b => { const d = (C.dongs || []).find(x => x.pnu + '|' + x.dong === b.dataset.dong); if (d) b.classList.toggle('wait', wait(d)); });
    const bar = $('dj_scan');
    if (bar) {
      const ps = Object.values(C.scan.per), tot = ps.reduce((a, x) => a + (x.cached ? 1 : x.pages || 1), 0), got = ps.reduce((a, x) => a + (x.cached || x.done ? (x.cached ? 1 : x.pages || 1) : Math.max(0, x.next - 1)), 0);
      const pct = C.scan.done ? 100 : Math.min(99, Math.round(got / Math.max(1, tot) * 100));
      const ready = (C.dongs || []).filter(d => !wait(d)).length;
      bar.hidden = C.scan.done;
      bar.innerHTML = `<span><span class="spin"></span>동·호수 정보를 가져오고 있습니다 · 준비된 동 ${ready}/${(C.dongs || []).length}</span><b>${pct}%</b><i style="width:${pct}%"></i>`;
    }
    if (curD && !wait(curD) && $('dj_gridBox') && $('dj_gridBox').querySelector('.dj-wait')) drawGrid(cx);
  }
  // ---------- 단지 화면: 요약 + 표 (엑셀처럼 칸을 눌러 바로 입력) ----------
  // 처음 = 단지 전체(장부에 뭐라도 적힌 호 + 매물장 매물이 있는 호) · 동을 누르면 그 동의 모든 호(빈 줄 포함)
  // 동 그림(층 × 라인)은 [현황판 보기]를 눌렀을 때만.
  const AX = { id: '__all', name: '모든 단지', all: true, places: [], dir: {} };   // '모든 단지' 보기용 가짜 단지
  // 거르기 (10/26 누적): k 거래(매매·전세·월세) · s 상태(매물·보류·계약됨) · c 챙길 것(만기 임박·꼭 챙길 것·표시한 줄) · t 타입 · a 평형
  //   같은 묶음 안은 '또는', 묶음끼리는 '그리고'. 아무것도 안 고르면 전부
  // 10/28 관리장부(LED) / 매물장 — 거르기는 장부마다 따로 (관리장부 '모든 단지'는 적어 둔 호 전부, 매물장 '모든 단지'는 매물만)
  const TF = () => { const k = (S.cur === '__all' ? 'A' : 'O') + (LED() ? 'L' : 'M'); S.FS = S.FS || {}; return S.FS[k] || (S.FS[k] = { k: [], s: k.endsWith('M') ? ['on', 'hold'] : [], c: [], t: [], a: [], sort: 'dh' }); };   // 매물장은 처음부터 '나온 물건'(매물·보류)만
  const resetF = () => Object.assign(TF(), { k: [], s: [], c: [], t: [], a: [], cf: null });
  const F0 = () => ({ ...TF(), k: [], s: [], c: [], t: [], a: [], cf: null });
  const fOn = F => !!(F.k.length || F.s.length || F.c.length || F.t.length || F.a.length || (F.cf && Object.values(F.cf).some(Boolean)));
  // 단지 정보: 열어 본 단지는 그대로, 아직 안 연 단지는 동 목록만 가볍게 받아 평형을 찾음 (모든 단지 보기용)
  // ---------- 왼쪽 단지 목록 (폴더) · 여러 단지 함께 보기 — 10/26 ----------
  // 체크한 단지가 2곳 이상이면 '모든 단지' 화면을 그 단지들만으로 (가격순 등으로 비교). 체크는 이 브라우저에 기억
  S.multi = new Set((() => { try { return JSON.parse(localStorage.getItem('rm.djmulti') || '[]'); } catch { return []; } })());
  const multiOn = () => [...S.multi].filter(id => S.cx.items.some(c => c.id === id)).length >= 2;
  const allList = () => multiOn() ? S.cx.items.filter(c => S.multi.has(c.id)) : S.cx.items;
  const saveMulti = () => { try { localStorage.setItem('rm.djmulti', JSON.stringify([...S.multi])); } catch { /* 무시 */ } };
  // ---------- 관리장부 / 매물장 (10/28 회의) ----------
  //   관리장부 = 단지의 모든 호를 관리하는 단순한 표 (줄을 누르면 오른쪽 입력창 · [매물장으로])
  //   매물장 = 나온 물건(내 물건·타부동산)만 · 표 / 동 지도 / 현황판 — 같은 호 기록을 같이 씀 (가격·상태는 한 곳에만 저장)
  S.book = 'ledger';   // 10/28 단순화: 늘 '전체 호'부터 (기억 안 함)
  const LED = () => S.book === 'ledger';
  const bookTog = () => `<span class="vtab bk" role="tablist" aria-label="장부 고르기">${[['ledger', '전체'], ['market', '매물만']].map(([v, t]) => `<button type="button" data-book="${v}" aria-pressed="${S.book === v}">${t}</button>`).join('')}</span>`;
  function wireBook() {
    document.querySelectorAll('#dj_cxBody [data-book]').forEach(b => b.onclick = () => {
      if (S.book === b.dataset.book) return;
      if (S.ed) endEdit(S.tcx);
      S.book = b.dataset.book;
      S.pk = null; S.hist = null; S.histRec = null; draw();
    });
  }
  // ---------- 하위 단지 (1단지·2단지 … ) · 10/26 ----------
  //   ① 단지에 필지가 2개 이상 → 필지 단위(이름: 동 번호 첫 자리가 모두 같으면 'N단지', 아니면 지번)
  //   ② 필지가 하나뿐인데 동 번호가 1xx·2xx…로 갈리면 → 동 번호 첫 자리 단위('h1' = 1단지)
  //   고른 하위 단지(C.gsel = 키 목록)만 표·동 칩·오른쪽 목록에. 비어 있으면 전부
  const headOf = dong => (normD(dong).match(/^(\d)\d{2}(?!\d)/) || [])[1] || '';   // '101' '101(1단지)' → 1
  function subMode(C) {
    const ds = (C && C.dongs) || []; if (ds.length < 2) return null;
    // 동 번호 첫 자리(1xx·2xx…)가 2가지 이상이면 그걸로 (관리동·상가동처럼 번호 없는 동은 '기타') — 필지 경계와 단지가 안 맞는 경우가 많음
    const hs = ds.map(d => headOf(d.dong)).filter(Boolean);
    if (hs.length >= ds.length * 0.6 && new Set(hs).size >= 2) return 'h';
    if (new Set(ds.map(d => d.pnu)).size >= 2) return 'p';
    return null;
  }
  const gkOf = (md, pnu, dong) => md === 'p' ? pnu : 'h' + headOf(dong);
  function subOf(cx, C) {
    const md = subMode(C); if (!md) return null;
    const by = new Map();
    for (const d of C.dongs) { const k = gkOf(md, d.pnu, d.dong); (by.get(k) || by.set(k, []).get(k)).push(d); }
    const M = mineMap(cx);
    return [...by.entries()].map(([k, ds]) => {
      const heads = [...new Set(ds.map(d => headOf(d.dong)))];
      const pl = md === 'p' && (cx.places || []).find(p => p.pnu === k), jb = md === 'h' ? '' : pl ? String(pl.addr || '').split(' ').slice(-2).join(' ') : k.slice(-8);
      const ns = ds.map(d => dongCounts(cx, d, M)), n = ns.reduce((a, z) => a + z.m + z.o, 0), e = ns.reduce((a, z) => a + z.e, 0);
      return { k, ds, n, e, nm: heads.length === 1 && heads[0] ? `${heads[0]}단지` : md === 'h' ? '기타 동' : jb };
    }).sort((a, b) => md === 'h' ? (a.k === 'h') - (b.k === 'h') || a.k.localeCompare(b.k) : b.n - a.n || b.e - a.e || a.nm.localeCompare(b.nm, 'ko', { numeric: true }));   // 1단지·2단지 … 순 (기타 동은 맨 뒤)
  }
  // 고른 하위 단지 키 (지금 나누는 방식에 맞는 것만)
  const gOn = C => { if (!C || !Array.isArray(C.gsel) || !C.gsel.length) return null; const md = subMode(C); if (!md) return null; const ok = C.gsel.filter(k => (md === 'h') === k.startsWith('h')); return ok.length ? ok : null; };
  const inSub = (C, gs, pnu, dong) => { const md = subMode(C); if (md === 'h' && !headOf(dong)) return true; return gs.includes(gkOf(md, pnu, dong)); };   // 'A동'처럼 번호가 아닌 동은 어느 하위 단지를 골라도 보임
  function treeDongs(c, C) {
    const M = mineMap(c), dongBtn = d => { const m = dongCounts(c, d, M), k = d.pnu + '|' + d.dong; return { m, html: `<button type="button" class="tn d${C.view === 'dong' && C.cur === k ? ' on' : ''}" data-tdong="${esc(k)}"><i></i>${esc(d.dong || '건물')}<span class="ct">${m.m + m.o || ''}${m.e ? ` <em>만기 ${m.e}</em>` : ''}</span></button>` }; };
    const sorted = ds => ds.map(dongBtn).sort((p, q) => (q.m.m + q.m.o) - (p.m.m + p.m.o) || q.m.e - p.m.e).map(z => z.html).join('');
    const G = subOf(c, C); if (!G) return sorted(C.dongs);   // 10/28 1단지·2단지는 폴더처럼 (체크박스 없음)
    S.gopen = S.gopen || new Set(); const sel = gOn(C) || [];
    return G.map(g => { const op = S.gopen.has(c.id + '|' + g.k); return `<div class="tn g${sel.includes(g.k) ? ' on' : ''}"><button type="button" data-tgo="${g.k}"><span class="ar">${op ? '▾' : '▸'}</span>${esc(g.nm)}</button><span class="ct">${g.n || ''}${g.e ? ` <em>만기 ${g.e}</em>` : ''}</span></div>${op ? `<div class="tgd">${sorted(g.ds)}</div>` : ''}`; }).join('');
  }
  // 하위 단지 고르기 (탐색기 체크 · 표 위 칩 같은 것)
  function pickSub(cx, k) {
    const C = S.C[cx.id]; if (!C) return;
    const cur = gOn(C) || [];
    C.gsel = cur.includes(k) ? cur.filter(z => z !== k) : [...cur, k];
    if (C.view === 'dong' && C.gsel.length && C.cur && !inSub(C, C.gsel, String(C.cur).slice(0, 19), String(C.cur).slice(20))) C.view = 'all';   // 고른 동이 빠지면 단지 전체로
    S.hist = null; drawComplex(cx);
  }
  // 10/26 단지 순서 = 매물(내+타) 많은 순 · 아직 못 불러온 단지는 뒤(등록 순)
  const cxN = c => { const L = S.L[c.id]; if (!L || !L.units) return -1; const K = kpi(rowsAll(c, CI(c), mineMap(c))); return K.m + K.o; };
  const cxSorted = () => S.cx.items.map((c, i) => ({ c, i, n: cxN(c) })).sort((a, b) => b.n - a.n || a.i - b.i).map(z => z.c);
  // 10/29 단지가 없는데 다른 종류에 매물이 있으면 빈 화면 아래에 그 탭으로 가는 길 (예: 상가 매물만 올린 경우)
  const otherHint = () => {
    const H = S.host, n = H && H.counts ? H.counts() : null; if (!n) return '';
    const L = Object.entries(n).filter(([, v]) => v > 0); if (!L.length) return '';
    return `<p class="eoth">진행 중인 매물: ${L.map(([k, v]) => `<button type="button" data-ocat="${k}">${esc(H.catName ? H.catName(k) : k)} ${v} ▸</button>`).join(' ')}</p>`;
  };
  function drawTree() {
    const T = $('dj_tree'); if (!T) return;
    const cnt = c => { if (!S.L[c.id]) { loadLedger(c); return ''; } const n = cxN(c); return n < 0 ? '' : n; };   // 숫자 = 매물(내+타)
    const cur = S.cx.items.find(c => c.id === S.cur), C = cur && S.C[cur.id];
    const allMode = S.cur === '__all' && !multiOn() && !S.adding;
    T.innerHTML = `<div class="tth"><b>단지</b></div>
      <button type="button" class="tn all${S.cur === '__all' && !multiOn() ? ' on' : ''}" data-tall>모든 단지<span class="ct">${S.cx.items.length}곳</span></button>
      ${(S.cx.items.forEach(c => { if (!S.L[c.id]) loadLedger(c); }), cxSorted()).map(c => { const op = c.id === S.cur; const n = cnt(c);
        const fo = op && !(S.fold && S.fold.has(c.id));   // 펼친 단지 (지금 단지를 다시 누르면 접힘)
        const ck = allMode || (multiOn() ? S.multi.has(c.id) : !S.adding && c.id === S.cur);   // 10/28: 지금 표에 나오는 단지 = 체크 (모든 단지면 전부 · 하나면 그 단지)
        return `<div class="tn${op ? ' on' : ''}"><button type="button" data-tcx="${c.id}"><span class="ar">${fo ? '▾' : '▸'}</span>${esc(c.name)}</button>${S.delMode ? `<button type="button" class="tdel" data-tdel="${c.id}">빼기</button>` : `<span class="ct">${n === '' ? '' : n}</span>`}</div>
        ${fo && C && C.dongs && !S.delMode ? treeDongs(c, C) + `<div class="tmore"><button type="button" data-tren>이름 바꾸기</button> · <button type="button" data-taddpl>빠진 동 더하기</button></div>` : ''}`; }).join('')}
      ${(() => { const n = (S.host.items() || []).filter(x => ['아파트', '주상복합', '오피스텔'].includes(x.ptype) && x.kind !== 'presale' && x.status !== 'done' && !S.cx.items.some(c => (c.places || []).some(p => p.pnu === x.pnu))).length; return n && S.host.goAptList ? `<div class="tn torph"><button type="button" data-torph title="단지에 담지 않고 올린 아파트·오피스텔 매물"><span class="ar">📁</span>단지 없는 매물</button><span class="ct">${n}</span></div>` : ''; })()}
      <div class="tadr"><button type="button" class="tn add" data-tadd title="단지 추가">＋ 단지</button>${S.cx.items.length ? `<button type="button" class="tn add rm${S.delMode ? ' on' : ''}" data-tdm title="단지 빼기">${S.delMode ? '빼기 끝' : '− 단지'}</button>` : ''}${S.host.goAptList ? '<button type="button" class="tn add nx" data-tnx title="단지에 담지 않고 아파트·오피스텔 한 호만 매물로 올리기">＋ 단지없이 추가</button>' : ''}</div>
      ${S.delMode ? '<p class="tdn">뺄 단지 옆의 [빼기]를 누르세요</p>' : ''}`;
    T.querySelector('[data-tall]').onclick = () => { S.multi.clear(); saveMulti(); S.cur = '__all'; S.adding = false; draw(); };
    T.querySelectorAll('[data-tcx]').forEach(b => b.onclick = () => {
      S.fold = S.fold || new Set(); const id = b.dataset.tcx;
      if (S.cur === id && !S.adding) { S.fold.has(id) ? S.fold.delete(id) : S.fold.add(id); return drawTree(); }   // 지금 단지 → 접기·펼치기만
      S.fold.delete(id); S.multi.clear(); saveMulti(); S.cur = id; S.adding = false; S.hist = null; draw();
    });
    T.querySelectorAll('[data-tck]').forEach(b => b.onchange = () => { const id = b.dataset.tck;
      // 지금 체크된 단지(화면에 보이는 것)에서 시작해 하나를 더하거나 뺌 → 2곳 이상 = 한 표 · 1곳 = 그 단지 · 전부 = 모든 단지 · 마지막 하나는 못 뺌
      const ids = S.cx.items.map(c => c.id);
      const sel = new Set(allMode ? ids : multiOn() ? [...S.multi].filter(x => ids.includes(x)) : S.cur && S.cur !== '__all' && !S.adding ? [S.cur] : []);
      if (b.checked) sel.add(id); else sel.delete(id);
      if (!sel.size) { b.checked = true; return toast('보고 있는 단지가 하나는 있어야 합니다. 다른 단지를 체크하거나 [모든 단지]를 눌러 주세요', 3500); }
      S.multi.clear();
      if (sel.size >= 2 && sel.size < ids.length) { sel.forEach(x => S.multi.add(x)); S.cur = '__all'; }
      else if (sel.size === 1) S.cur = [...sel][0];
      else S.cur = '__all';
      saveMulti(); S.adding = false; S.hist = null; draw(); });
    T.querySelectorAll('[data-tgs]').forEach(b => b.onchange = () => pickSub(cur, b.dataset.tgs));
    T.querySelectorAll('[data-tgo]').forEach(b => b.onclick = () => { const C2 = S.C[cur.id]; if (!C2) return; const g = b.dataset.tgo, k = cur.id + '|' + g, was = !!(S.gopen && S.gopen.has(k)) && (C2.gsel || []).includes(g); S.gopen = new Set(was ? [] : [k]); C2.gsel = was ? [] : [g]; C2.view = 'all'; S.hist = null; drawComplex(cur); drawTree(); });   // 1단지 누르기 = 그 단지만 펼치고 표도 그 단지만 · 다시 누르면 접고 전체
    T.querySelectorAll('[data-tdong]').forEach(b => b.onclick = () => { const C2 = S.C[S.cur]; if (!C2) return; C2.view = 'dong'; C2.cur = b.dataset.tdong; C2.picked = true; S.hist = null; drawComplex(cur); drawTree(); });
    T.querySelector('[data-tadd]').onclick = () => { S.delMode = false; S.adding = true; S.results = null; draw(); };
    const tr = T.querySelector('[data-tren]'); if (tr) tr.onclick = async () => { const c = cur; if (!c) return; const nm = prompt('단지 이름', c.name); if (!nm || nm === c.name) return; try { const j = await post({ op: 'rename', id: c.id, name: nm }); S.cx = { items: j.items, memos: j.memos }; delete S.C[c.id]; draw(); } catch (e) { toast(e.message); } };
    const tp = T.querySelector('[data-taddpl]'); if (tp) tp.onclick = () => { S.adding = 'place'; S.results = null; draw(); };
    const dm = T.querySelector('[data-tdm]'); if (dm) dm.onclick = () => { S.delMode = !S.delMode; drawTree(); };
    T.querySelectorAll('[data-tdel]').forEach(b => b.onclick = () => { const c = S.cx.items.find(z => z.id === b.dataset.tdel); if (c) delCx(c); });
    const orph = T.querySelector('[data-torph]'); if (orph) orph.onclick = () => S.host.goAptList();   // 10/26 매물 화면의 '아파트 매물'로
    const nx = T.querySelector('[data-tnx]'); if (nx) nx.onclick = () => { S.host.goAptList(); setTimeout(() => { const q = document.getElementById('bdQ'); if (q) { q.focus(); q.placeholder = '단지없이 추가: 아파트·오피스텔 주소나 건물명을 치고 Enter (예: ○○오피스텔 807호)'; } }, 120); };   // 10/30 선배: [＋단지][−단지][＋단지없이 추가]
  }
  // 10/28 단지 빼기: 확인창 한 번 (이름 입력 없음) · 왼쪽 목록 [단지 빼기]와 ⋯ 메뉴가 같이 씀
  async function delCx(cx) {
    const L = S.L[cx.id], n = L && L.units ? Object.keys(L.units).length : 0;
    if (!confirm(`'${cx.name}' 단지를 목록에서 뺄까요?\n\n이 단지에 적어 둔 호 기록${n ? ` ${n}개` : ''}(연락처·상담 기록 포함)가 함께 지워지고, 되돌릴 수 없습니다.\n매물 카드로 등록한 매물은 그대로 남습니다.`)) return;
    try { const j = await post({ op: 'del', id: cx.id }); delete S.L[cx.id]; delete S.C[cx.id]; S.multi.delete(cx.id); saveMulti(); S.cx = { items: j.items, memos: j.memos }; if (S.cur === cx.id) S.cur = S.cx.items.length >= 2 ? '__all' : (S.cx.items[0] || {}).id; S.delMode = false; toast(`'${cx.name}' 단지를 뺐습니다`); draw(); }
    catch (e) { toast(e.message, 4000); }
  }
  function CI(c) {
    if (S.C[c.id] && S.C[c.id].dongs) return S.C[c.id];
    S.CL = S.CL || {};
    let L = S.CL[c.id];
    if (!L) {
      L = S.CL[c.id] = { dongs: null, areas: {}, units: {} };
      Promise.all((c.places || []).map(p => dongsOf(p.pnu))).then(ls => { const seen = new Set(); L.dongs = ls.flat().filter(d => { const k = d.pnu + '|' + d.dong; if (seen.has(k)) return false; seen.add(k); return true; }); if (S.cur === '__all') drawTable(AX); });
    }
    return L;
  }
  const redrawView = () => { if (S.cur === '__all') return drawAll(); const c = S.cx.items.find(z => z.id === S.cur); if (c) drawComplex(c); };
  // ---------- 모든 단지: 등록한 단지들의 장부를 한 표로 (바로 수정도 됨) ----------
  function drawAll() {
    S.lastCx = null;
    if (!$('dj_cxBody')) return;
    if (S.ed) { S.redraw = true; return; }
    const items = allList();
    items.forEach(c => { if (!S.L[c.id]) loadLedger(c); });
    const wait = items.filter(c => !S.L[c.id] || (S.L[c.id].p && !S.L[c.id].units)).length;
    const K = kpi(items.flatMap(c => rowsAll(c, CI(c), mineMap(c))));
    $('dj_cxBody').innerHTML = `
      <div class="card hdc hd1"><div class="h1r">${cxSelHtml('__all')}
        <span class="hm">${items.length}곳${wait ? ` · 장부를 불러오는 중 (${items.length - wait}/${items.length})` : ''} · 매물 <b id="dj_k0">${K.m + K.o}</b> · 만기 임박 <b id="dj_k1" class="${K.e ? 'r' : ''}">${K.e}</b><b id="dj_k2" hidden>${K.d}</b></span><span class="sp"></span>${bookTog()}</div></div>
      <div class="card gcard"><div class="djfrow"><div class="tbf" id="dj_tbf"></div></div><div id="dj_tbl"></div>
      </div>`;
    wireCxSel(); wireBook();
    drawTable(AX);
  }
  // 보기 탭 (10/26): 표 | 동 지도 | 현황판 — 이 브라우저에 기억
  const djTab = () => S.djtab === 'map' ? 'map' : 'table';   // 10/28 단순화: 표 ↔ 층별 그림(현황판)만 · 동 지도 없앰 · 기억 안 함
  const setTab = v => { S.djtab = v; };
  const boardOn = () => djTab() === 'grid';
  // 요금제 단지 한도: 등록한 순서대로 앞의 N곳만 입력 (서버 cxOpen과 같은 규칙)
  const cxLimit = () => { const P = S.host && S.host.plan ? S.host.plan() : {}; return P.cx || 0; };
  function cxLocked(cx) { const n = cxLimit(); if (!n || cx.all) return false; return ![...S.cx.items].sort((a, b) => String(a.at).localeCompare(String(b.at))).slice(0, n).some(x => x.id === cx.id); }
  function drawComplex(cx) {
    const C = S.C[cx.id];
    if (!C) { loadComplex(cx); $('dj_cxBody').innerHTML = '<div class="card loading">단지 정보를 불러오는 중…</div>'; return; }
    if (S.lastCx !== cx.id) { S.lastCx = cx.id; C.view = 'all'; TF().cf = null; }   // 10/28 다른 단지로 오면 항상 그 단지의 전체 동부터
    if (S.ed) { S.redraw = true; return; }                  // 입력 중에는 다시 그리지 않음 (끝나면 그림)
    if (!S.L[cx.id]) loadLedger(cx);
    const MM = mineMap(cx);
    const hhld = (C.dongs || []).reduce((a, d) => a + (d.hhld || d.ho || 0), 0);
    const apr = (C.dongs || []).map(d => d.apr).filter(Boolean).sort()[0];
    const open = S.boardOpen;
    C.view = C.view || 'all';
    const all = rowsAll(cx, C, MM);
    const K = kpi(all);
    const LL = S.L[cx.id];
    const tab = djTab();
    // 현황판은 동 하나를 그리므로, 동을 안 골랐으면 매물이 있는 첫 동(없으면 첫 동)으로
    if (tab === 'grid' && C.view !== 'dong' && C.dongs && C.dongs.length) { const d = C.dongs.find(z => { const n = dongCounts(cx, z, MM); return n.m || n.o || n.e; }) || C.dongs[0]; C.view = 'dong'; C.cur = d.pnu + '|' + d.dong; }
    $('dj_cxBody').innerHTML = `
      <div class="card hdc hd1"><div class="h1r">
        ${cxSelHtml(cx.id)}${C.view === 'dong' && C.cur ? `<b class="cxdn">${esc(DN(normD(String(C.cur).split('|')[1])) || '건물')}</b>` : gOn(C) ? `<b class="cxdn">${esc(((subOf(cx, C) || []).filter(g => gOn(C).includes(g.k)).map(g => g.nm)).join(' · '))}</b>` : ''}
        <span class="hm">매물 <b id="dj_k0">${K.m + K.o}</b> · 만기 임박 <b id="dj_k1" class="${K.e ? 'r' : ''}">${K.e}</b><b id="dj_k2" hidden>${K.d}</b></span>
        <span class="sp"></span>
        ${bookTog()}
        <button type="button" class="btn ghost xs${tab === 'map' ? ' on' : ''}" id="dj_grid" title="단지 지도 위에 동마다 매물·만기">${tab === 'map' ? '표로 보기' : '지도 보기'}</button>
        <button type="button" class="btn ghost xs${open ? ' on' : ''}" id="dj_bt">시세 ${open ? '▴' : '▾'}</button>
        <span class="mmw nw"><button type="button" class="btn ghost xs" id="dj_more" aria-label="단지 메뉴">⋯</button><span class="mmenu" id="dj_mmenu" hidden><button type="button" id="dj_ren">단지 이름 바꾸기</button><button type="button" id="dj_addPl">빠진 동 더하기</button><button type="button" id="dj_delCx" class="red">단지 빼기</button></span></span>
      </div>${open ? `<div class="sum">${summary(C)}</div><div id="dj_board">${board(C)}</div>` : ''}</div>
      <div class="card gcard tab-${tab}">
        <div class="djfrow">${dongChips(cx, C, MM)}<div class="tbf" id="dj_tbf"></div></div>
        <div class="dj-scanbar" id="dj_scan" hidden></div>
        ${LL && LL.err ? `<p class="hjwarn">호실 장부를 쓸 수 없어 보기만 됩니다: ${esc(LL.err)}</p>` : ''}
        ${cxLocked(cx) ? `<p class="hjwarn">요금제 단지 한도(${cxLimit()}곳)를 넘은 단지라 보기만 됩니다. 다른 단지를 빼거나 <a href="/pro.html#price" target="_blank" rel="noopener">요금제를 올리면</a> 다시 입력할 수 있습니다.</p>` : ''}
        ${tab === 'map' ? '<div class="djsplit"><div id="dj_mapSlot"></div><aside class="djside" id="dj_sideM"></aside></div>' : '<div id="dj_mapSlot"></div>'}
        ${C.view === 'dong' ? `<div class="djsplit g"${tab === 'grid' ? '' : ' hidden'}><div id="dj_gridBox"></div><aside class="djside" id="dj_sideG"></aside></div>` : ''}
        <div id="dj_tbl"></div>
      </div>`;
    wireBook();
    $('dj_bt').onclick = () => { S.boardOpen = !S.boardOpen; try { localStorage.setItem('rm.djboard', S.boardOpen ? '1' : ''); } catch { /* 무시 */ } drawComplex(cx); };
    wireCxSel();
    $('dj_more').onclick = e => { e.stopPropagation(); const m = $('dj_mmenu'); m.hidden = !m.hidden; if (!m.hidden) setTimeout(() => document.addEventListener('mousedown', function cl(ev) { if (!ev.target.closest('.mmw')) { m.hidden = true; document.removeEventListener('mousedown', cl); } }), 0); };
    $('dj_addPl').onclick = () => { S.adding = 'place'; S.results = null; draw(); };
    $('dj_ren').onclick = async () => { const nm = prompt('단지 이름', cx.name); if (!nm || nm === cx.name) return; try { const j = await post({ op: 'rename', id: cx.id, name: nm }); S.cx = { items: j.items, memos: j.memos }; delete S.C[cx.id]; draw(); } catch (e) { toast(e.message); } };
    $('dj_delCx').onclick = () => delCx(cx);
    $('dj_grid').onclick = () => { setTab(tab === 'map' ? 'table' : 'map'); S.hist = null; drawComplex(cx); };   // 10/28 [층별 그림] ↔ [표로 보기]
    wireDongChips(cx);
    drawCxMap(cx, MM);
    if (C.scan) scanApply(cx, C);
    // 동 표는 호 목록이 있어야 하므로, 현황판을 닫아 두어도 그림 상자에서 호 목록을 받아 둡니다(상자는 숨김)
    if (C.view === 'dong') { if (!$('dj_gridBox')) { /* 없음 */ } drawGrid(cx); }
    drawTable(cx);
    drawTree();
    const sd = new URLSearchParams(location.search).get('seed');
    if (sd && !S.seeded && sd !== 'clear') { const tg = S.cx.items.find(c => /마포래미안푸르지오/.test(String(c.name).replace(/\s/g, ''))); if (tg && tg.id !== cx.id) { S.cur = tg.id; return draw(); } }   // 마포래미안푸르지오가 있으면 그 단지로
    if (sd && !S.seeded && C.dongs && C.dongs.length && LL && LL.units) { S.seeded = true; history.replaceState(null, '', location.pathname + '?mode=danji'); setTimeout(() => seedTest(cx, sd === 'clear' ? 'clear' : 'add'), 300); }
  }

  // ---------- 지도 현황판: 동 위치(DongPos) 위에 동마다 매물(내 매물+타부동산)·만기 ----------
  // 지도는 한 번만 만들고, 다시 그릴 때는 같은 지도 상자를 새 자리로 옮겨 붙입니다(깜빡임·재로딩 없음)
  const mapOn = () => djTab() === 'map';
  function drawCxMap(cx, MM) {
    const slot = $('dj_mapSlot'), C = S.C[cx.id]; if (!slot) return;
    if (!mapOn() || !C) return;
    if (!window.kakao || !kakao.maps || !kakao.maps.Map || !window.DongPos) { slot.innerHTML = '<div class="djmap-msg">지도를 불러오는 중입니다…</div>'; setTimeout(() => { if ($('dj_mapSlot') === slot && S.cur === cx.id) drawCxMap(cx, MM); }, 800); return; }
    const K = kakao.maps, M = S.mp || (S.mp = { el: Object.assign(document.createElement('div'), { className: 'djmap' }), map: null, ovs: [], fit: '' });
    slot.appendChild(M.el);
    if (!M.map) M.map = new K.Map(M.el, { center: new K.LatLng(cx.places[0].lat || 37.55, cx.places[0].lng || 126.93), level: 3 });
    else M.map.relayout();
    M.ovs.forEach(o => o.setMap(null)); M.ovs = [];
    // 단지의 필지 전체를 한 범위로, 건축물대장 동 목록에 있는 동을 한 번에 받음
    const note = t => { const m = document.createElement('div'); m.className = 'djmap-ld'; m.textContent = t; M.el.appendChild(m); M.ovs.push({ setMap: () => m.remove() }); };
    if (!C.dongs) return note('동 목록을 불러오는 중…');
    const pnus = cx.places.map(p => p.pnu), want = C.dongs.map(d => d.dong);
    const R = DongPos.peek(pnus, want, cx.name);
    if (!R) { note('동 위치를 불러오는 중…'); DongPos.get(pnus, want, cx.name).then(() => { if (S.cur === cx.id && $('dj_mapSlot')) drawCxMap(cx, mineMap(cx)); }); return; }
    const posOf = d => R.by.get(normD(d.dong)) || null;
    const ringOf = d => (posOf(d) || {}).ring || [];
    const F = TF(), bounds = new K.LatLngBounds(), miss = [];
    let any = 0;
    for (const d of C.dongs || []) {
      const pos = posOf(d); if (!pos) { miss.push(d.dong); continue; }
      const k = d.pnu + '|' + d.dong, n = dongCounts(cx, d, MM), sel = C.view === 'dong' && C.cur === k;
      const hit = F.s.includes('on') || F.k.length ? n.m + n.o : F.c.includes('exp') ? n.e : (n.m || n.o || n.e);
      const col = n.m ? '#F2B705' : n.o ? '#5B7FA6' : '#AEB7C0';
      const ring = ringOf(d);
      if (ring.length > 2) {
        const pg = new K.Polygon({ path: ring.map(([x, y]) => new K.LatLng(y, x)), strokeWeight: sel ? 3 : n.e ? 2 : 1, strokeColor: sel ? '#14212E' : n.e ? '#E03131' : col, strokeOpacity: 1, fillColor: col, fillOpacity: hit ? .45 : .18 });
        pg.setMap(M.map); M.ovs.push(pg);
        K.event.addListener(pg, 'click', () => pickDong(cx, k));
      }
      const el = document.createElement('button'); el.type = 'button';
      el.className = `djml${n.m || n.o ? ' has' : ''}${sel ? ' sel' : ''}${hit ? '' : ' dim'}`;
      el.innerHTML = `${esc(d.dong || '건물')}${n.m + n.o ? `<em title="매물 (내 매물 ${n.m} · 타부동산 ${n.o})">${n.m + n.o}</em>` : ''}${n.e ? `<i title="만기 임박">만기 ${n.e}</i>` : ''}`;
      el.onclick = e => { e.stopPropagation(); pickDong(cx, k); };
      const ov = new K.CustomOverlay({ position: new K.LatLng(pos.lat, pos.lng), content: el, yAnchor: .5, zIndex: sel ? 10 : hit ? 5 : 1, clickable: true });
      ov.setMap(M.map); M.ovs.push(ov); bounds.extend(new K.LatLng(pos.lat, pos.lng)); any++;
    }
    if (miss.length) console.info('[동 지도] 위치를 못 찾은 동', miss.join(', '));   // 회원 화면에는 표시하지 않음 (위치 없는 동은 아래 동 버튼으로)
    if (!any) { note('이 단지는 지도에 동 위치 자료가 없습니다. 아래 동 버튼으로 보세요.'); return; }
    if (M.fit !== cx.id + ':' + any) { M.fit = cx.id + ':' + any; M.map.setBounds(bounds, 30, 30, 30, 30); }
  }
  // ---------- 지도·현황판 옆 매물 목록 (그 동, 동을 안 골랐으면 단지 전체) ----------
  function drawSide(cx) {
    const els = ['dj_sideM', 'dj_sideG'].map($).filter(Boolean), C = S.C[cx.id]; if (!els.length || !C || cx.all) return;
    const MM = mineMap(cx), dongV = C.view === 'dong' && C.cur;
    let rows = dongV ? (rowsDong(cx, C, MM) || []) : rowsAll(cx, C, MM);
    { const gs = !dongV && gOn(C); if (gs) rows = rows.filter(x => inSub(C, gs, x.pnu, x.dn)); }
    rows = sortRows(rows.filter(x => (x.st.src && !x.st.done) || x.st.exp), 'dh');
    const m = rows.filter(x => x.st.src === 'mine' && !x.st.done).length, o = rows.filter(x => x.st.src === 'other' && !x.st.done).length, e = rows.filter(x => x.st.exp).length;
    const pills = st => (st.k.length ? st.k : ['']).map(k => `<span class="p ${k ? (st.src === 'mine' ? 'f-' : 'o-') + k : 'f-none'}">${k ? KN[k] : st.src === 'mine' ? '내 매물' : st.src ? '타부동산' : '만기'}</span>`).join('');
    const html = `<div class="sd-h"><b>${dongV ? esc(C.cur.slice(20)) : '단지 전체'}</b><span>${[m + o ? `매물 ${m + o}` : '', e ? `만기 ${e}` : ''].filter(Boolean).join(' · ') || '매물 없음'}</span></div>`
      + (rows.length ? rows.map(x => {
        const r = x.r || {};
        const sub = [supPy(x) ? `${supPy(x).v}평${x.lt && x.lt.t ? ' ' + x.lt.t : ''}` : '', x.dir ? (/향$/.test(x.dir) ? x.dir : x.dir + '향') : '', r.live ? LIVE[r.live] : '', r.exp ? `만기 ${r.exp.slice(2, 7).replace('-', '.')}` : '', x.st.src === 'other' ? (x.st.office || '타부동산') : ''].filter(Boolean).join(' · ') + (r.imp ? ` · ⚑ ${r.imp}` : '');
        return `<button type="button" class="sd-it${x.st.hold ? ' hold' : ''}" data-go="${esc(x.key)}"><span class="sd-t"><b>${esc(US(x))}</b>${pills(x.st)}</span><span class="sd-p">${prHtml(x)}</span>${sub ? `<small>${esc(sub)}</small>` : ''}</button>`;
      }).join('') : `<p class="sd-e">${dongV ? '이 동에는' : '이 단지에는'} 아직 매물이 없습니다.</p>`)
      + (rows.length ? '<p class="sd-n">누르면 표에서 그 호로 이동</p>' : '');
    els.forEach(el => { el.innerHTML = html; el.querySelectorAll('[data-go]').forEach(b => b.onclick = () => { S.focusKey = b.dataset.go; S.selKey = b.dataset.go; S.hist = null; setTab('table'); drawComplex(cx); }); });
  }
  function pickDong(cx, k) { const C = S.C[cx.id]; if (!C) return; if (C.view === 'dong' && C.cur === k) C.view = 'all'; else { C.view = 'dong'; C.cur = k; C.picked = true; } S.hist = null; drawComplex(cx); }

  // ---------- 단지 고르기 드롭메뉴 (10/26) — 탐색기가 숨는 좁은 화면에서도 ----------
  function cxSelHtml(cur) {
    const multi = cur === '__all' && multiOn(), c0 = S.cx.items.find(c => c.id === cur);
    // 10/28 넓은 화면: 고르기는 왼쪽 단지 목록에서만 → 여기는 이름만 · 좁은 화면(목록이 숨음)에서만 드롭메뉴
    return `<b class="cxtt">${esc(multi ? allList().map(c => c.name).join(' + ') : cur === '__all' ? '모든 단지' : c0 ? c0.name : '')}</b><select id="dj_cxSel" class="cxsel" aria-label="단지 고르기">${multi ? `<option value="__all" selected>${esc(allList().map(c => c.name).join(' + '))}</option>` : ''}${S.cx.items.length >= 2 && !multi ? `<option value="__all"${cur === '__all' ? ' selected' : ''}>모든 단지 (${S.cx.items.length}곳)</option>` : ''}${cxSorted().map(c => `<option value="${esc(c.id)}"${c.id === cur ? ' selected' : ''}>${esc(c.name)}</option>`).join('')}<option value="__add">＋ 단지 추가…</option></select>`;
  }
  function wireCxSel() {
    const el = $('dj_cxSel'); if (!el) return;
    el.onchange = () => { const v = el.value; if (v === '__add') { S.adding = true; S.results = null; return draw(); } S.multi.clear(); saveMulti(); S.cur = v; S.adding = false; S.hist = null; draw(); };
  }
  // ---------- 동 칩 (10/26): 매물·만기가 있는 동만 작게 한 줄 + [모든 동 n ▸] ----------
  const chipIn = (d, n) => `${esc(String(d.dong).replace(/동$/, '') || '건물')}${n.m + n.o ? `<em>${n.m + n.o}</em>` : ''}${n.e ? '<i class="xd" title="만기 임박"></i>' : ''}`;
  function dongChips(cx, C, MM) {
    const ds = C.dongs || []; if (!ds.length) return `<div class="dongs sm" id="dj_dongs">${C.dongs ? '<span class="muted">동 정보가 없습니다.</span>' : ''}</div>`;
    const sel = C.view === 'dong' ? C.cur : null;
    const info = ds.map(d => { const k = d.pnu + '|' + d.dong, n = dongCounts(cx, d, MM), sp = C.scan && C.scan.per[d.pnu]; return { d, k, n, wt: !!sp && !sp.done && !sp.cached && !Array.isArray(C.units[k]) }; });
    const G = subOf(cx, C), gs = gOn(C);
    const pool = gs ? info.filter(z => inSub(C, gs, z.d.pnu, z.d.dong)) : info;
    const show = S.dongAll ? pool : pool.filter(z => z.n.m || z.n.o || z.n.e || z.k === sel);
    const gHtml = G ? G.map(g => `<button type="button" class="gsub" data-gsub="${g.k}" aria-pressed="${!!(gs && gs.includes(g.k))}">${esc(g.nm)}${g.n ? `<em>${g.n}</em>` : ''}${g.e ? '<i class="xd" title="만기 임박"></i>' : ''}</button>`).join('') + '<i class="gsep"></i>' : '';
    return `<div class="dongs sm" id="dj_dongs">${gHtml}<button type="button" data-dong="all" aria-pressed="${C.view === 'all'}">전체</button>${show.map(z => `<button type="button" data-dong="${esc(z.k)}" aria-pressed="${z.k === sel}" class="${z.n.m || z.n.o || z.n.e ? 'has' : ''}${z.wt ? ' wait' : ''}" title="${esc(z.d.dong)}">${chipIn(z.d, z.n)}</button>`).join('')}${pool.length > show.length || S.dongAll ? `<button type="button" class="dall" id="dj_dall">${S.dongAll ? '접기 ◂' : `모든 동 ${pool.length} ▸`}</button>` : ''}</div>`;
  }
  function wireDongChips(cx) {
    const C = S.C[cx.id];
    document.querySelectorAll('#dj_dongs [data-dong]').forEach(b => b.onclick = () => {
      if (b.dataset.dong === 'all') { C.view = 'all'; if (djTab() === 'grid') setTab('table'); } else { C.view = 'dong'; C.cur = b.dataset.dong; C.picked = true; }
      S.hist = null; drawComplex(cx);
    });
    if ($('dj_dall')) $('dj_dall').onclick = () => { S.dongAll = !S.dongAll; drawComplex(cx); };
    document.querySelectorAll('#dj_dongs [data-gsub]').forEach(b => b.onclick = () => pickSub(cx, b.dataset.gsub));
  }

  // ---------- 표에 쓸 줄 만들기 ----------
  const dongOf = (C, dn) => ((C && C.dongs) || []).find(d => normD(d.dong) === dn);
  function rowOf(cx, C, MM, pnu, dong, ho) {
    C = C || {};
    const dn = normD(dong), h = normH(ho), key = `${pnu}|${dn}|${h}`;
    const st = uState(cx, pnu, dong, ho, MM);
    const d = dongOf(C, dn), ak = d ? d.pnu + '|' + d.dong : '';
    const AR = C.areas && C.areas[ak], hn = +digits(h), line = hn >= 100 ? hn % 100 : hn;
    const man0 = st.r && st.r.ar;                             // 직접 적은 면적이 먼저
    let a = man0 || (AR && typeof AR === 'object' ? AR[h] || 0 : 0);
    if (!a && AR && typeof AR === 'object') {                  // 호별 면적에 없는 호(직접 추가한 호 등) → 같은 라인에서 가장 많은 평형
      const cnt = new Map(); for (const [hh, v] of Object.entries(AR)) { const n2 = +digits(hh); if (v && (n2 >= 100 ? n2 % 100 : n2) === line) cnt.set(v, (cnt.get(v) || 0) + 1); }
      const best = [...cnt.entries()].sort((p, q) => q[1] - p[1])[0]; if (best) a = best[0];
    }
    // 타입·공급평: 이 호만 따로 적은 값(PNU|동|h호) → 라인 값(PNU|동|라인) — 10/26
    const L0 = cx.lt || {}, lh = L0[`${pnu}|${dn}|h${h}`], ll = L0[`${pnu}|${dn}|${line}`] || L0[`*|${dn}|${line}`];
    const lt = lh || ll ? { ...(ll || {}), ...(lh || {}) } : null;
    return { key, pnu, dn, ho: h, st, r: st.r, a, line, dir: (cx.dir || {})[`${pnu}|${dn}|h${h}`] || (cx.dir || {})[`${pnu}|${dn}|${line}`] || '', lt, cx };   // 이 호만 적은 방향이 먼저
  }
  // 단지 전체: 장부에 적힌 호 + 매물장 매물이 있는 호 + 방금 추가한 호
  function rowsAll(cx, C, MM) {
    C = C || {};
    const L = S.L[cx.id], seen = new Map();
    const pnuFor = (p, dn) => p !== '*' ? p : ((dongOf(C, dn) || {}).pnu || cx.places[0].pnu);
    if (L && L.units) for (const k of Object.keys(L.units)) { const [p, dn, h] = k.split('|'); seen.set(k, [p, dn, h]); }
    for (const k of MM.keys()) { const [p0, dn, h] = k.split('|'); const p = pnuFor(p0, dn); const kk = `${p}|${dn}|${h}`; if (!seen.has(kk)) seen.set(kk, [p, dn, h]); }
    for (const mk of Object.keys(S.cx.memos || {})) { if (!mk.startsWith(cx.id + '|')) continue; const [, p0, dn, h] = mk.split('|'); const p = pnuFor(p0, dn), kk = `${p}|${dn}|${h}`; if (!seen.has(kk)) seen.set(kk, [p, dn, h]); }   // 예전 호별 메모만 있는 호
    for (const k of (S.extra && S.extra[cx.id]) || []) { const [p, dn, h] = k.split('|'); if (!seen.has(k)) seen.set(k, [p, dn, h]); }
    return [...seen.values()].map(([p, dn, h]) => rowOf(cx, C, MM, p, (dongOf(C, dn) || {}).dong || dn, h));
  }
  function rowsDong(cx, C, MM) {
    const U = C.units[C.cur]; if (!Array.isArray(U)) return null;
    const [pnu, dong] = [C.cur.slice(0, 19), C.cur.slice(20)];
    const out = U.filter(u => u.flrGb !== '지하' && digits(u.ho)).map(u => rowOf(cx, C, MM, pnu, dong, u.ho));
    // 건축물대장에 없는 호라도 장부에 적어 둔 호는 보여 줌
    const at = new Map(out.map((r, i) => [r.ho, i])), dn = normD(dong);
    for (const r of rowsAll(cx, C, MM)) {
      if (r.dn !== dn) continue;
      const i = at.get(r.ho);
      if (i == null) { at.set(r.ho, out.length); out.push(r); }
      else if (r.key !== out[i].key && hasInfo(r) && !hasInfo(out[i])) out[i] = { ...r, a: r.a || out[i].a };
    }
    return out;
  }
  function kpi(rows) {
    const ym = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 7);
    let m = 0, o = 0, e = 0, d = 0;
    for (const x of rows) { const s = x.st; if (!s.done && !s.hold) { if (s.src === 'mine') m++; else if (s.src === 'other') o++; } if (s.exp) e++; if (x.r && x.r.deal && String(x.r.deal.at).slice(0, 7) === ym) d++; }
    return { m, o, e, d };
  }
  const aKey = a => a ? Math.round(a) : 0;
  // 표 머리 ▾ 로 거를 수 있는 칸 (값 꺼내는 법) — 10/26
  const DCF = {
    cxn: x => x.cx.name, dn: x => DN(x.dn), ar: x => { const p = supPy(x); return p ? p.v + '평' : ''; },
    ty: x => (x.lt && x.lt.t) || '', dir: x => x.dir || '', live: x => liveTxt(x), of: x => ofTxt(x.st),
  };
  function pass(x, F) {
    const s = x.st, r = x.r || {};
    if (F.s.length && !F.s.some(v => v === 'on' ? s.src && !s.done && !s.hold : v === 'hold' ? s.hold && !s.done : v === 'done' ? s.done : false)) return false;   // 매물 = 진행 중(내+타)
    if (F.c.length && !F.c.some(v => v === 'exp' ? s.exp : v === 'imp' ? r.imp : v === 'mk' ? r.mk : v === 'empty' ? r.live === 'empty' : false)) return false;
    if (F.k.length && !F.k.some(k => ((s.k || []).includes(k) && !s.done) || (s.done && r.deal && r.deal.k === k))) return false;
    if (F.a.length && !F.a.some(a => Math.abs(x.a - a) < 1.5)) return false;
    if (F.t.length && !(x.lt && F.t.includes(x.lt.t))) return false;   // 타입(84B 등) — 라인 설정에서 적은 값
    if (F.cf) for (const k in F.cf) if (F.cf[k] && !F.cf[k].includes(DCF[k](x))) return false;   // 머리 ▾ 거르기
    return true;
  }
  const hasInfo = x => !!(x.st.src || x.st.done || x.st.info || x.r);
  function sortRows(rows, how) {
    const dh = (a, b) => (a.cx && b.cx && a.cx !== b.cx ? natc(a.cx.name, b.cx.name) : 0) || natc(a.dn, b.dn) || (+a.ho - +b.ho) || natc(a.ho, b.ho);
    const D0 = TF(), dr = D0.dir || 1;   // 10/28 먼저 정해야 함 (아래 '최근 기록' 정렬에서 씀)
    if (how === 'up') return rows.sort((a, b) => (!(a.r && a.r.up) - !(b.r && b.r.up)) || String((b.r && b.r.up) || '').localeCompare(String((a.r && a.r.up) || '')) * dr || dh(a, b));
    if (how === 'exp') return rows.sort((a, b) => (a.st.dl == null) - (b.st.dl == null) || ((a.st.dl ?? 0) - (b.st.dl ?? 0)) * dr || dh(a, b));
    if (how === 'fl') return rows.sort((a, b) => (Math.floor(+b.ho / 100) - Math.floor(+a.ho / 100)) || (+a.ho - +b.ho));
    // 칸 머리를 눌러 정렬 (10/26): 가격 · 평형 · 꼭 챙길 것 날짜 · 현 보증 — 값이 없는 줄은 항상 아래, dir = 1 오름 / -1 내림
    const d = TF(), dir = d.dir || 1;
    const pv = (x, f, k) => (x.st.k || []).includes(k) ? ((x.r && x.r.pr && x.r.pr[f]) || (x.st.k.length === 1 ? x.st.prn : 0) || 0) : 0;
    const V = { pr: x => priceOf(x), ps: x => pv(x, 'sale', 'sale'), pj: x => pv(x, 'jeonse', 'jeonse'), pwd: x => pv(x, 'wd', 'wolse'), gap: x => { const v = pv(x, 'sale', 'sale'), g = v && gapOf(x, v); return g ? g.v : 0; },
      py: x => (supPy(x) || {}).v || 0, imp: x => x.r && x.r.impd ? Date.parse(x.r.impd) : 0, cur: x => (x.r && x.r.cd) || 0 }[how];
    if (V) return rows.sort((a, b) => { const A = V(a), B2 = V(b); if (!A && !B2) return dh(a, b); if (!A) return 1; if (!B2) return -1; return (A - B2) * dir || dh(a, b); });
    return rows.sort((a, b) => dh(a, b) * (how === 'dh' ? dr : 1));
  }

  // ---------- 표 그리기 ----------
  // 10/26 회의: 거주(현상태)·만기를 연락처 앞으로, 입주일 칸은 뺌(필요하면 메모 · 리얼맵 광고 때는 등록창에서)
  // 10/26 아파트 화면 정리: 기획안처럼 두 줄 머리 (의뢰가격 · 현상태) · 칸마다 따로 입력
  //   g = 위 묶음 이름 · all = 여러 단지 보기에서만 · ed = 누르면 고치는 방식 · f = 장부 칸
  const COLS = [
    { id: 'cxn', t: '단지', all: 1 },
    { id: 'dn', t: '동' }, { id: 'ho', t: '호' },
    { id: 'ar', t: '평형', ed: 'py' }, { id: 'ty', t: '타입', ed: 'ty' }, { id: 'dir', t: '방향', ed: 'dir' },
    { id: 'of', t: '부동산명', ed: 'st' }, { id: 'kd', t: '거래', ed: 'st' },
    { id: 'ps', t: '매매', ed: 'pr', f: 'sale', g: '의뢰가격' }, { id: 'pj', t: '전세', ed: 'pr', f: 'jeonse', g: '의뢰가격' },
    { id: 'pwd', t: '보증금', ed: 'pr', f: 'wd', g: '의뢰가격' }, { id: 'pwr', t: '월세', ed: 'pr', f: 'wr', g: '의뢰가격' }, { id: 'gap', t: '갭', g: '의뢰가격' },
    { id: 'imp', t: '꼭 챙길 것', ed: 'text', f: 'imp', ph: '예: 11/15 중도금 · 이사 3/10~14 고정' },
    { id: 'live', t: '구분', ed: 'live', g: '현상태' }, { id: 'cd', t: '보증금', ed: 'man', f: 'cd', g: '현상태' }, { id: 'cr', t: '차임', ed: 'num', f: 'cr', g: '현상태' },
    { id: 'exp', t: '만기일', ed: 'date', f: 'exp' },
    { id: 'own', t: '소유주', ed: 'tel' }, { id: 'ten', t: '세입자', ed: 'tel' },
    { id: 'h', t: '상담 기록' },
    { id: 'opt', t: '옵션', ed: 'text', f: 'opt', ph: '예: 시스템에어컨' }, { id: 'note', t: '메모', ed: 'text', f: 'note', ph: '예: 근저당 3억' },
    { id: 'pub', t: '리얼맵' }];
  // 관리장부 표: 단순한 시트 (매물 가격·거래는 오른쪽 입력창의 '매물' 칸에서)
  const LCOLS = [   // 10/28 [전체]·[매물만] 같은 칸 (매물만은 매물 아닌 줄만 빠짐) · 칸마다 따로 정렬 · 연락처는 한 칸(외 n ▾ 펼치기)
    { id: 'mk0', t: '매물' },   // 10/29 매물 표시: 누르면 매물 등록 · 다시 누르면 해제 · 10/30 제목 ● → '매물' (선배)
    { id: 'cxn', t: '단지', all: 1 }, { id: 'dn', t: '동' }, { id: 'ho', t: '호' },
    { id: 'ar', t: '평형' }, { id: 'ty', t: '타입' }, { id: 'dir', t: '향' },
    { id: 'of', t: '받은 곳' }, { id: 'kd', t: '거래' },
    { id: 'ps', t: '매매', f: 'sale', g: '의뢰가격' }, { id: 'pj', t: '전세', f: 'jeonse', g: '의뢰가격' }, { id: 'pwd', t: '보증금', f: 'wd', g: '의뢰가격' }, { id: 'pwr', t: '월세', f: 'wr', g: '의뢰가격' }, { id: 'gap', t: '갭', g: '의뢰가격' },
    { id: 'imp', t: '챙길 것', f: 'imp' },
    { id: 'live', t: '구분', g: '현상태' }, { id: 'cd', t: '보증금', g: '현상태' }, { id: 'cr', t: '차임', g: '현상태' }, { id: 'exp', t: '만기', g: '현상태' },
    { id: 'tel', t: '연락처' }, { id: 'h', t: '최근 기록' },
    { id: 'pub', t: '리얼맵' }];   // 10/28 지도 광고는 이 칸 하나에서만 (내 매물일 때 [리얼맵 등록] → 간단 등록창 · 올린 뒤 [● 게시중 ▾])
  // 매물장 표: 관리용 칸(만기·연락처·옵션·메모)은 빼고 거래·가격 중심 (연락처·만기는 오른쪽 입력창에서)
  const MHIDE = new Set(['exp', 'own', 'ten', 'opt', 'note']);
  const MCOLS = COLS.filter(c => !MHIDE.has(c.id)).map(c => c.id === 'of' ? { ...c, t: '받은 곳' } : c);
  const VC = () => { const cs = LCOLS; return S.cur === '__all' ? cs : cs.filter(c => !c.all); };
  const SORTC = { bm: 'exp', cxn: 'dh', dn: 'dh', ho: 'dh', ar: 'py', ps: 'ps', pj: 'pj', pwd: 'pwd', gap: 'gap', imp: 'imp', cd: 'cur', exp: 'exp', h: 'up' };   // 칸 머리 정렬
  const NAV = ['ar', 'ty', 'dir', 'ps', 'pj', 'pwd', 'pwr', 'imp', 'live', 'cd', 'cr', 'exp', 'own', 'ten', 'opt', 'note'];   // Tab 순서 (부동산명·거래는 눌러서)
  const LIVE = { owner: '입주', tenant: '임차', empty: '공실' };   // 10/28 두 글자로 통일
  const stHtml = s => {
    if (s.done) { const d = s.r && s.r.deal; return `<span class="p done">${d ? KN[d.k] + ' ' : ''}계약됨 ✓</span>${d && d.by === 'other' ? '<small>타사</small>' : ''}`; }
    if (!s.src) return '<span class="mut">-</span>';
    const pills = (s.k.length ? s.k : ['']).map(k => `<span class="p ${k ? (s.src === 'mine' ? 'f-' : 'o-') + k : 'f-none'}">${k ? KN[k] : s.src === 'mine' ? '내 매물' : '타부동산'}</span>`).join('');
    return `<span class="${s.hold ? 'hold' : ''}">${pills}</span><small>${s.hold ? '보류' : s.src === 'mine' ? '' : esc(s.office || '')}</small>`;
  };
  // 매물 한 줄 글: '전세 7억 · 매매 21.5억' (장부 가격 → 없으면 매물 카드 가격)
  function mkTxt(x) {
    const s = x.st, pr = (x.r && x.r.pr) || {};
    return (s.k || []).map(k => { const v = k === 'sale' ? shortWon(pr.sale) : k === 'jeonse' ? shortWon(pr.jeonse) : pr.wd || pr.wr ? `${shortWon(pr.wd) || 0}/${pr.wr || 0}` : ''; return `${KN[k]}${v ? ' ' + v : !x.r || !x.r.pr ? (s.pr ? ' ' + s.pr : '') : ''}`; }).join(' · ');
  }
  const LOCK = x => cxLocked(x.cx) || !!(S.L[x.cx.id] && S.L[x.cx.id].err);
  function prHtml(x) {
    const r = x.r, s = x.st;
    if (s.done && r && r.deal) return `${KN[r.deal.k][0]} ${r.deal.k === 'wolse' ? `${shortWon(r.deal.a)}/${r.deal.r || ''}` : shortWon(r.deal.a)}`;
    const pr = r && r.pr; if (!pr && !s.pr) return '<span class="mut">-</span>';
    if (!pr) return esc(s.pr);
    const ks = s.k.length ? s.k : ['sale', 'jeonse', 'wolse'];
    const out = ks.map(k => { const v = prShort(k, pr); return v ? `${KN[k][0]} ${v}` : ''; }).filter(Boolean);
    if (!out.length) return '<span class="mut">-</span>';
    const g = ks.includes('sale') && pr.sale ? gapOf(x, pr.sale) : null;
    return esc(out.join(' · ')) + (g ? `<small class="gap${g.est ? ' est' : ''}" title="${g.est ? '최근 같은 평형 전세 실거래로 계산한 추정 갭' : '매매가 - 지금 세입자 전세금'}">갭 ${g.est ? '≈' : ''}${shortWon(g.v)}</small>` : '');
  }
  // 정렬용 가격: 거르기에서 고른 거래(매매/전세/월세 보증금) → 없으면 매매 · 전세 · 월세 보증금 순
  function priceOf(x) {
    const pr = (x.r && x.r.pr) || {}, F = TF();
    const k1 = F.k.length === 1 ? F.k[0] : '';
    if (k1 === 'sale') return pr.sale || 0; if (k1 === 'jeonse') return pr.jeonse || 0; if (k1 === 'wolse') return pr.wd || 0;
    const ks = x.st.k || []; return (ks.includes('sale') && pr.sale) || (ks.includes('jeonse') && pr.jeonse) || (ks.includes('wolse') && pr.wd) || pr.sale || pr.jeonse || pr.wd || x.st.prn || 0;   // prn: 장부엔 없고 매물관리에만 있는 매물
  }
  // 갭 = 매매가 - 지금 세입자 전세금 (현 보증금이 있고 차임이 없을 때) · 없으면 단지 최근 1년 같은 평형(±3㎡) 전세 실거래 중간값으로 추정(≈)
  // 갭 = 매매가 - 현상태(임차) 보증금 — 보증금을 넣었을 때만 자동 계산 (직접 입력 칸 아님) · 10/26: 실거래 추정 갭은 뺌
  function gapOf(x, sale) {
    const r = x.r || {};
    return r.cd && sale && r.cd < sale ? { v: sale - r.cd } : null;
  }
  // 공급평: 라인에 적어 둔 값 → 없으면 전용면적으로 추정(≈, 보통 59㎡≈25평 · 84㎡≈34평 · 114㎡≈44평)
  const supPy = x => x.lt && x.lt.py ? { v: x.lt.py } : x.a ? { v: Math.round(x.a * (x.a <= 60 ? 1.36 : x.a <= 85 ? 1.33 : 1.27) / PY), est: true } : null;
  const impTxt = t => String(t || '').replace(/^\s*(?:20\d{2}[-./])?\d{1,2}\s*(?:[./]|월\s*)\d{1,2}(?:\s*일)?(?![~\d])(?:까지)?\s*[·,:-]?\s*/, '') || t;   // 맨 앞 날짜는 빨간 날짜 표시와 겹치므로 글에서 뺌
  const impSoon = d => { const dl = (Date.parse(d) - Date.now()) / 864e5; return dl <= 7 && dl >= -3; };
  // 칸에 쓰는 작은 도우미 (10/26)
  const cw = m => !m ? '' : m >= 10000 ? shortWon(m) : Math.round(m).toLocaleString();   // 1억 이상 '8.3억', 그 아래 '5,000'
  const liveTxt = x => { const r = x.r || {}; return r.live === 'owner' ? '입주' : r.live === 'empty' ? '공실' : r.live === 'tenant' ? (r.cr ? '월세' : r.cd ? '전세' : '임차') : ''; };
  const ofTxt = s => s.done ? '계약됨' : !s.src ? '' : s.src === 'mine' ? '내 매물' : (s.office || '타부동산');
  const isTen = t => /세입|임차/.test((t && t.l) || '');
  const plainL = l => /^(소유자|소유주|세입자|임차인|연락처)?$/.test(String(l || '').trim());
  function telsHtml(x, ten) {
    const t = ((x.r && x.r.tels) || []).map((z, i) => ({ ...z, i })).filter(z => isTen(z) === ten); if (!t.length) return '<span class="mut">-</span>';
    const one = z => z.n ? `<a class="tl" href="tel:${esc(String(z.n).replace(/[^\d+]/g, ''))}" data-tcall="${z.i}">${z.m ? esc(z.m) + ' ' : plainL(z.l) ? '' : esc(z.l) + ' '}${esc(z.n)}</a>` : `<span class="tl">${esc(z.m || z.l)}</span>`;   // 번호 없이 이름만 (엑셀)
    return one(t[0]) + (t.length > 1 ? ` <small>외 ${t.length - 1}</small>` : '');
  }
  // 의뢰가격 칸 하나: 그 거래가 걸려 있을 때만 (장부엔 없고 매물관리에만 있는 매물은 그 가격)
  function prCell(x, f) {
    const s = x.st, r = x.r || {}, k = f === 'sale' ? 'sale' : f === 'jeonse' ? 'jeonse' : 'wolse';
    if (s.done) { const d = r.deal; if (!d || d.k !== k || f === 'wr' && !d.r) return '<span class="mut">-</span>'; return `<span class="dn">${f === 'wr' ? d.r : cw(d.a)}</span>`; }
    if (!(s.k || []).includes(k)) return '<span class="mut">-</span>';
    const v = r.pr ? r.pr[f] : (s.k.length === 1 && f !== 'wr' ? s.prn : 0);
    return v ? `<b class="pv ${k}">${f === 'wr' ? v : cw(v)}</b>` : '<span class="mut">-</span>';
  }
  function cellHtml(x, c) {
    const r = x.r || {}, s = x.st;
    switch (c.id) {
      case 'mk0': { const on = !!s.src && !s.done; return `<button type="button" class="mkd${on ? ' on' : ''}" data-mkd="${esc(x.key)}" title="${on ? '매물입니다 · 누르면 매물에서 해제' : '누르면 매물로 등록'}" ${LOCK(x) ? 'disabled' : ''}>${on ? '●' : '○'}</button>`; }
      case 'cxn': return `<button type="button" class="cxn" data-gocx=""${esc(x.cx.id)}" title="${esc(x.cx.name)}으로 이동">${esc(x.cx.name)}</button>`;
      case 'dn': return `<b>${esc(DN(x.dn).replace(/동$/, ''))}</b>`;
      case 'ho': return `<b>${esc(x.ho)}</b>`;
      case 'ar': { const p = supPy(x); return p ? `<b class="${p.est ? 'est' : ''}"${p.est ? ' title="전용면적으로 계산한 공급평입니다. 눌러서 정확히 적으면 같은 라인에 모두 들어갑니다"' : ''}>${p.v}</b>` : '<span class="mut">-</span>'; }
      case 'ty': return x.lt && x.lt.t ? `<b>${esc(x.lt.t)}</b>` : '<span class="mut">-</span>';   // 10/28 칸 폭: '입력 84.97' 안내 없앰 (전용면적은 입력창에서)
      case 'dir': return x.dir ? esc(x.dir) : '<span class="mut">-</span>';
      case 'of': return s.done ? `<span class="p done">계약됨 ✓</span>` : !s.src ? '<span class="mut">-</span>' : `<span class="${s.src === 'mine' ? 'ofm' : ''}">${esc(ofTxt(s))}</span>${s.hold ? ' <small class="hold">보류</small>' : ''}`;
      case 'kd': {
        if (s.done) { const d = r.deal; return d ? `<span class="p done">${KN[d.k]}</span>` : '<span class="mut">-</span>'; }
        if (!s.src || !s.k.length) return '<span class="mut">-</span>';
        return `<span class="${s.hold ? 'hold' : ''}">${s.k.map(k => `<span class="p ${(s.src === 'mine' ? 'f-' : 'o-') + k}" title="${KN[k]}">${KN[k][0]}</span>`).join('')}</span>`;
      }
      case 'ps': case 'pj': case 'pwd': case 'pwr': return prCell(x, c.f);
      case 'gap': { if (s.done || !(s.k || []).includes('sale')) return '<span class="mut">-</span>'; const v = (r.pr && r.pr.sale) || (s.k.length === 1 ? s.prn : 0), g = v && gapOf(x, v); return g ? `<b class="gap${g.est ? ' est' : ''}" title="매매가 - 현상태 보증금 (자동 계산)">${cw(g.v)}</b>` : '<span class="mut">-</span>'; }
      case 'live':
        return liveTxt(x) ? esc(liveTxt(x)) : '<span class="mut">-</span>';
      case 'mkt': {   // 관리장부: 매물 여부 — 나와 있으면 '매물 중 · 전세 7억', 아니면 [매물장으로]
        if (s.done) return '<span class="p done">계약됨</span>';
        if (s.src) return `<span class="mko${s.hold ? ' hold' : ''}">${s.hold ? '보류' : '매물 중'}</span> <small class="mkp">${esc([mkTxt(x), s.src === 'other' ? s.office || '타부동산' : ''].filter(Boolean).join(' · '))}</small>`;
        return '<span class="mut">-</span>';   // 10/28 단순화: 줄마다 버튼을 두지 않음 (줄을 누르면 입력창의 [매물로 올리기])
      }
      case 'bm': { const m = r.cd ? cw(r.cd) + (r.cr ? '/' + r.cr : '') : '', e = r.exp ? `<span class="${s.exp ? 'dd' : ''}">${esc(r.exp.slice(2, 7).replace('-', '.'))}${s.exp ? ` · ${s.dl >= 0 ? 'D-' + s.dl : '지남'}` : ''}</span>` : ''; return m || e ? [m, e].filter(Boolean).join(' · ') : '<span class="mut">-</span>'; }
      case 'tel': {
        const t = (r.tels || []).map((z, i) => ({ ...z, i })); if (!t.length) return '<span class="mut">-</span>';
        const one = (z, lbOn) => { const lb = String(z.l || '').replace(/^소유(자|주)$/, '소유').replace(/^(세입자|임차인)$/, '세입'); return z.n ? `<a class="tl" href="tel:${esc(String(z.n).replace(/[^\d+]/g, ''))}" data-tcall="${z.i}" title="${esc([lb, z.m].filter(Boolean).join(' '))}">${lbOn ? `<small>${esc([lb, z.m].filter(Boolean).join(' '))}</small> ` : ''}${esc(z.n)}</a>` : `<span class="tl">${esc(z.m || lb)}</span>`; };   // 10/28 칸 폭: 번호만 (펼치면 이름표도)
        const op = S.telOpen && S.telOpen.has(x.key);
        if (t.length === 1) return one(t[0]);
        return op ? `<div class="tels">${t.map(z => `<div>${one(z, true)}</div>`).join('')}<button type="button" class="telx" data-telx="${esc(x.key)}">접기 ▴</button></div>` : `${one(t[0])} <button type="button" class="telx" data-telx="${esc(x.key)}" title="연락처 ${t.length}명 모두 보기">+${t.length - 1}</button>`;
      }
      case 'cd': return r.cd ? cw(r.cd) : '<span class="mut">-</span>';
      case 'cr': return r.cr ? String(r.cr) : '<span class="mut">-</span>';
      case 'exp': return r.exp ? `<span class="${s.exp ? 'dd' : ''}" title="${s.exp ? (s.dl >= 0 ? '만기 D-' + s.dl : '만기 지남') : ''}">${esc(r.exp.slice(2).replace(/-/g, '.'))}</span>` : '<span class="mut">-</span>';
      case 'own': return telsHtml(x, false);
      case 'ten': return telsHtml(x, true);
      case 'h': {
        const n = r.histN || 0, op = S.hist === x.key, h0 = (r.hist || [])[0];
        return h0 ? `<span class="hl"><i>${esc(String(fmtT(h0.t)).slice(3, 8))}</i> ${esc(h0.x)}</span>` : '<span class="mut">-</span>';   // 10/28 기록은 오른쪽 입력창에서 (두 장부 모두)
        return `${h0 ? `<span class="hl"><i>${esc(String(fmtT(h0.t)).slice(0, 8))}</i> ${esc(h0.x)}</span>` : ''}<button type="button" class="hbtn${op ? ' on' : ''}" data-hist="${esc(x.key)}">${op ? '기록 ▴' : `기록${n ? ' ' + n : ''}`}</button>`;
      }
      case 'pub': {
        const ls = (s.mine || []).find(z => z.status !== 'done');
        // 리얼맵: 내 매물만 — [리얼맵 등록] / [● 게시중 ▾] / [기간만료 ▾] (매물장에 없으면 장부 내용으로 간단 등록창)
        if (s.src !== 'mine' || s.done) return '<span class="mut">-</span>';
        // 10/28 칸 폭: 칸 이름이 '리얼맵'이라 버튼 글은 짧게 (등록 / ● 게시 ▾ / 만료 ▾)
        const sh = h => h.replace('>리얼맵 등록<', ' title="리얼맵 지도에 올리기">등록<').replace('● 게시중 ▾', '● 게시 ▾').replace('기간만료 ▾', '만료 ▾');
        return ls ? sh((S.host.pubCell ? S.host.pubCell(ls.id) : '') || '<span class="mut">-</span>')   // 10/28 매물카드 여는 버튼은 없앰 (보류 매물 등은 빈칸)
          : s.src === 'mine' && !s.done && !s.hold && (!S.host.canPub || S.host.canPub()) ? `<button type="button" class="pbtn reg" data-up="${esc(x.key)}" title="리얼맵 지도에 올리기">등록</button>` : '<span class="mut">-</span>';
      }
      case 'imp': return r.imp ? `<span class="imp">${r.impd ? `<span class="dd${impSoon(r.impd) ? ' soon' : ''}">${esc(r.impd.slice(5).replace('-', '/'))}</span>` : ''}${esc(r.impd ? impTxt(r.imp) : r.imp)}</span>` : '<span class="mut">-</span>';
      default: return r[c.f] ? esc(r[c.f]) : '<span class="mut">-</span>';
    }
  }
  const tipOf = (x, c) => { const r = x.r || {}; if (c.id === 'cxn') return x.cx ? x.cx.name : ''; if (c.id === 'of') return x.st.src === 'other' ? x.st.office || '' : ''; if (c.id === 'tel') return (r.tels || []).map(t => `${t.l} ${t.n}`).join(' / '); return c.id === 'note' || c.id === 'opt' || c.id === 'imp' ? r[c.f] || '' : c.id === 'own' || c.id === 'ten' ? (r.tels || []).filter(t => isTen(t) === (c.id === 'ten')).map(t => `${t.l} ${t.n}`).join(' / ') : c.id === 'h' && r.hist && r.hist[0] ? `${fmtT(r.hist[0].t)} ${r.hist[0].x}${r.hist[0].w ? ' · ' + r.hist[0].w : ''}` : ''; };   // 잘린 글은 마우스를 올리면 전체
  const rowHtml = (x, i) => `<tr data-i="${i}" data-key="${esc(x.key)}" class="${x.st.src || x.st.done ? 'on' : ''}${x.fs ? ' fs' : ''}${S.selKey === x.key ? ' sel' : ''}${S.pk && S.pk.key === x.key && S.pk.cx === x.cx.id ? ' pk' : ''}${x.r && x.r.mk ? ' mk-' + x.r.mk : ''}">${VC().map(c => { const tp = tipOf(x, c); return `<td class="c-${c.id}${c.ed ? ' ed' : ''}" data-c="${c.id}"${tp ? ` title="${esc(tp)}"` : ''}>${cellHtml(x, c)}</td>`; }).join('')}</tr>`;
  function drawTable(cx) {
    const ALL = !!cx.all, C = ALL ? { view: 'all' } : S.C[cx.id], box = $('dj_tbl'); if (!box || !C) return;
    if (S.ed) { S.redraw = true; return; }
    const F = TF(), MM = ALL ? null : mineMap(cx);
    Object.assign(F, { k: [], c: [], t: [], a: [], s: LED() ? [] : ['on', 'hold'] });   // 10/28 체크 거르기 없앰 → 장부마다 고정
    let rows;
    if (ALL) rows = allList().flatMap(c => rowsAll(c, CI(c), mineMap(c))).filter(x => pass(x, F));
    else if (C.view === 'dong') {
      rows = rowsDong(cx, C, MM);
      if (!rows) { box.innerHTML = '<div class="loading">이 동의 호 목록을 받는 중입니다…</div>'; return; }
      if (!fOn(F)) { /* 동 화면은 빈 줄까지 */ } else rows = rows.filter(x => pass(x, F));
    } else rows = rowsAll(cx, C, MM).filter(x => pass(x, F));
    { const gs = !ALL && gOn(C); if (gs) rows = rows.filter(x => inSub(C, gs, x.pnu, x.dn)); }   // 고른 하위 단지만 (10/26)
    const base = ALL ? allList().flatMap(c => rowsAll(c, CI(c), mineMap(c))) : C.view === 'dong' ? (rowsDong(cx, C, MM) || []) : rowsAll(cx, C, MM);
    if (!ALL) needAreas(cx, C, base);
    else allList().forEach(c => { const Cc = CI(c); if (Cc.dongs) { const rs = base.filter(x => x.cx === c); if (rs.length) needAreas(c, Cc, rs); } });
    sortRows(rows, F.sort === 'fl' && C.view !== 'dong' ? 'dh' : F.sort);
    // 동 화면에서 층이 바뀌는 줄 위에 구분선
    const flo = x => Math.floor(+x.ho / 100);
    rows.forEach((x, i) => { x.fs = C.view === 'dong' && (F.sort === 'dh' || F.sort === 'fl') && i > 0 && flo(x) !== flo(rows[i - 1]); });
    S.rows = rows; S.tcx = cx;
    const ro = !ALL && !!(S.L[cx.id] && S.L[cx.id].err);
    // 거르기 줄 (체크 누적) — 동 칩과 같은 줄(#dj_tbf). 없으면 표 상자 위에
    let tbf = $('dj_tbf'); if (!tbf) { box.insertAdjacentHTML('beforebegin', '<div class="tbf" id="dj_tbf"></div>'); tbf = $('dj_tbf'); }
    // 10/28 거르기 체크 줄은 없앰 (헷갈림) — 정렬은 표 머리, 골라 보기는 머리 아래 ▾ · 매물장은 늘 나온 물건(매물·보류)만
    tbf.innerHTML = '';   // 10/28 단순화: 표시 색·호 추가 칸은 없앰 (호 추가는 표 아래)
    // 두 줄 머리: 묶음(의뢰가격·현상태)은 위에 한 칸, 나머지는 두 줄을 차지 + 아래 칸별 거르기 줄
    const vc = VC(); let h1 = '', h2 = '';
    const leaf = (c, n, two) => `<th class="c-${c.id}${SORTC[c.id] ? ' srt' : ''}"${c.id === 'mk0' ? ' title="매물 · 누르면 등록, 다시 누르면 해제"' : ''}${two ? ' rowspan="2"' : ''}${SORTC[c.id] ? ` data-srt="${SORTC[c.id]}" title="눌러서 정렬 (한 번 더 누르면 반대로)"` : ''}>${c.t}${SORTC[c.id] && F.sort === SORTC[c.id] && !(c.id === 'ho' || (c.id === 'dn' && ALL)) ? (F.dir === -1 ? ' ▼' : ' ▲') : ''}</th>`;
    vc.forEach((c, n) => { if (c.g) { if (!vc[n - 1] || vc[n - 1].g !== c.g) h1 += `<th class="grp" colspan="${vc.filter(z => z.g === c.g).length}">${c.g}</th>`; h2 += leaf(c, n); } else h1 += leaf(c, n, true); });
    const fr = vc.map(c => { const on = F.cf && F.cf[c.id]; return `<th class="fc c-${c.id}">${DCF[c.id] ? `<button type="button" class="cfs${on ? ' on' : ''}" data-cf="${c.id}" title="골라서 보기">${on ? esc(on.join(', ')) : ''}</button>` : ''}</th>`; }).join('');
    box.innerHTML = `<div class="tbw" id="dj_tbw"><table class="xt big${ALL ? ' allx' : ''}"><thead><tr>${h1}</tr>${h2 ? `<tr>${h2}</tr>` : ''}</thead>
      <tbody>${rows.map((x, i) => rowHtml(x, i)).join('') || `<tr><td colspan="${vc.length}" class="empty">${F.cf && Object.values(F.cf).some(Boolean) ? '표 머리 아래 ▾로 고른 조건에 맞는 호가 없습니다. <button type="button" class="lnk" id="dj_cfclr">조건 모두 풀기</button>' : !LED() ? '아직 매물로 올린 호가 없습니다. [전체]에서 줄 맨 앞 ○를 누르면 매물이 됩니다.' : ALL ? '아직 적어 둔 호가 없습니다. 왼쪽에서 단지를 고른 뒤 호를 적어 보세요.' : C.view === 'all' ? '아직 적어 둔 호가 없습니다. 위 칸에 "102-1503"처럼 호를 넣거나, 동을 눌러 빈 줄부터 채워 보세요.' : '이 동에 맞는 호가 없습니다.'}</td></tr>`}</tbody></table></div>
      ${ro || ALL ? '' : '<div class="addho"><span>＋ 호 추가</span><input id="dj_addHo" class="hjin" placeholder="예) 103-1502 쓰고 Enter" autocomplete="off"></div>'}
      <p class="note">${rows.length}호</p>`;
    stickHead(box);
    const redo = () => { drawTable(cx); if (!ALL) drawCxMap(cx, MM); };
    tbf.querySelectorAll('[data-fg]').forEach(el => { const go = () => { const g = el.dataset.fg, v = g === 'a' ? +el.dataset.v : el.dataset.v; F[g] = F[g].includes(v) ? F[g].filter(z => z !== v) : [...F[g], v]; redo(); }; if (el.tagName === 'INPUT') el.onchange = go; else el.onclick = go; });
    if ($('dj_fclr')) $('dj_fclr').onclick = () => { Object.assign(F, { k: [], s: [], c: [], t: [], a: [], cf: null }); redo(); };
    box.querySelectorAll('[data-cf]').forEach(b => b.onclick = e => {
      e.stopPropagation(); const k = b.dataset.cf, cnt = new Map(), keep = F.cf;
      F.cf = { ...(keep || {}), [k]: null }; const pool = base.filter(x => pass(x, F)); F.cf = keep;   // 다른 거르기는 그대로 둔 숫자
      pool.forEach(x => { const v = DCF[k](x); cnt.set(v, (cnt.get(v) || 0) + 1); });
      ((F.cf && F.cf[k]) || []).forEach(v => { if (!cnt.has(v)) cnt.set(v, 0); });
      const vals = [...cnt].map(([v, n]) => ({ v, n })).sort((a, z) => String(a.v).localeCompare(String(z.v), 'ko', { numeric: true }));
      ColPick.open(b, vals, F.cf && F.cf[k], pick => { F.cf = { ...(F.cf || {}), [k]: pick }; redo(); });
    });
    box.querySelectorAll('th[data-srt]').forEach(th => th.onclick = e => { if (e.target.closest('.rz')) return; const k = th.dataset.srt; if (F.sort === k) F.dir = (F.dir || 1) * -1; else { F.sort = k; F.dir = ['pr', 'py', 'ps', 'pj', 'pwd', 'gap', 'up'].includes(k) ? -1 : 1; } drawTable(cx); });
    tbf.querySelectorAll('[data-mk]').forEach(b => b.onclick = () => {
      const x = S.rows.find(z => z.key === S.selKey); if (!x) return toast('표시할 줄을 먼저 눌러 주세요');
      const c2 = x.cx || cx; if (cxLocked(c2) || (S.L[c2.id] && S.L[c2.id].err)) return toast('보기만 되는 단지입니다');
      const v = !b.dataset.mk || (x.r && x.r.mk) === b.dataset.mk ? '' : b.dataset.mk;
      if (!v && !(x.r && x.r.mk)) return toast('이 줄에는 표시가 없습니다');
      saveRow(c2, x, D => { D.mk = v; }); toast(v ? '표시했습니다' : '표시를 지웠습니다');
    });
    box.querySelectorAll('[data-telx]').forEach(b => b.onclick = e => { e.stopPropagation(); S.telOpen = S.telOpen || new Set(); const k = b.dataset.telx; S.telOpen.has(k) ? S.telOpen.delete(k) : S.telOpen.add(k); redrawRow(cx.all ? (S.rows.find(z => z.key === k) || {}).cx || cx : cx, k); });   // 연락처 외 n ▾
    if ($('dj_cfclr')) $('dj_cfclr').onclick = () => { F.cf = null; redo(); };
    if ($('dj_addHo')) $('dj_addHo').onkeydown = e => { if (e.key === 'Enter' && !e.isComposing) addHo(cx, e.target.value); };
    if (!S.kbd) { S.kbd = true; document.addEventListener('keydown', kbdNav); }
    wireLedRows(cx, box, ro);   // 10/28 두 장부 모두: 한 번 누르면 오른쪽 입력창 · 두 번 누르면 표에서 바로 고치기
    box.querySelectorAll('[data-hist]').forEach(b => b.onclick = () => toggleHist(cx, b.dataset.hist));
    wireTel(cx, box);
    box.querySelectorAll('[data-gocx]').forEach(b => b.onclick = e => { e.stopPropagation(); S.multi.clear(); saveMulti(); S.cur = b.dataset.gocx; S.hist = null; draw(); });
    drawPanel();
    // 누른 줄은 진한 파랑으로 남겨 둠 (상세·기록을 보는 동안 어느 호인지 놓치지 않게)
    box.querySelectorAll('tbody tr[data-key]').forEach(tr => tr.addEventListener('pointerdown', () => { S.selKey = tr.dataset.key; box.querySelectorAll('tr.sel').forEach(z => { if (z !== tr) z.classList.remove('sel'); }); tr.classList.add('sel'); }));
    if (!ALL) drawSide(cx);   // 지도·현황판 옆 매물 목록
    if (S.focusKey) { const tr = box.querySelector(`tr[data-key="${CSS.escape(S.focusKey)}"]`); S.focusKey = null; if (tr) { tr.scrollIntoView({ block: 'center', behavior: 'smooth' }); tr.classList.add('flash'); setTimeout(() => tr.classList.remove('flash'), 1600); } }
  }
  // ---------- 칸 너비 조절: 표 전체 너비는 그대로, 경계선을 끌면 옆 칸과 너비를 주고받음 ----------
  // 너비는 이 브라우저에 비율(%)로 기억 (단지 화면 / 모든 단지 따로). 경계선 더블클릭 = 처음 너비
  // 칸 너비: 표는 내용만큼 넓어지고(가로 스크롤), 경계선을 끌면 그 칸만 넓히거나 좁힘 (px로 이 브라우저에 기억 · 더블클릭 = 처음대로) — 10/26
  function colWidths(box, ALL) {
    const KEY = ALL ? 'rm.djpxA3' : 'rm.djpx3', ths = [...box.querySelectorAll('table.xt thead th')].filter(t => !t.classList.contains('grp') && !t.classList.contains('fc'));
    let saved = null; try { saved = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { saved = null; }
    const ids = ths.map(t => [...t.classList].find(c => c.startsWith('c-')) || '');
    if (saved && typeof saved === 'object') ths.forEach((th, n) => { const w = saved[ids[n]]; if (w) { th.style.width = w + 'px'; th.style.minWidth = w + 'px'; } });
    ths.forEach((th, n) => {
      const h = th.querySelector('.rz'); if (!h) return;
      h.ondblclick = e => { e.stopPropagation(); try { localStorage.removeItem(KEY); } catch { /* 무시 */ } ths.forEach(t => { t.style.width = ''; t.style.minWidth = ''; }); };
      h.onpointerdown = e => {
        e.preventDefault(); e.stopPropagation();
        const a = th.getBoundingClientRect().width, x0 = e.clientX;
        h.setPointerCapture(e.pointerId); document.body.classList.add('rzing');
        h.onpointermove = ev => { const w = Math.max(40, Math.round(a + ev.clientX - x0)); th.style.width = w + 'px'; th.style.minWidth = w + 'px'; };
        h.onpointerup = () => {
          h.onpointermove = h.onpointerup = null; document.body.classList.remove('rzing');
          const o = {}; ths.forEach((t, k) => { if (t.style.width) o[ids[k]] = parseInt(t.style.width, 10); });
          try { localStorage.setItem(KEY, JSON.stringify(o)); } catch { /* 저장 안 되면 이번만 */ }
        };
      };
    });
  }

  // 머리 세 줄을 표 상자 위에 붙이고(세로 스크롤), 왼쪽 단지·동·호 칸은 옆으로 밀어도 남게 — 10/26
  function stickHead(box) {
    const tb = box.querySelector('table.xt'); if (!tb) return;
    const put = () => {
      const [r1, r2, r3] = tb.tHead.rows;
      const one = [...r1.cells].filter(c => c.rowSpan === 1), h1 = one.length ? one[0].offsetHeight : 0, hAll = Math.max(...[...r1.cells].map(c => c.offsetHeight));
      [...r1.cells].forEach(c => { c.style.top = '0px'; });
      if (r2) [...r2.cells].forEach(c => { c.style.top = h1 + 'px'; });
      if (r3) [...r3.cells].forEach(c => { c.style.top = hAll + 'px'; });
      let left = 0;   // 왼쪽 고정 칸 위치는 표에 변수로 (줄을 다시 그려도 그대로)
      ['mk0', 'cxn', 'dn', 'ho'].forEach(id => { const th = tb.querySelector(`thead th.c-${id}:not(.fc)`); if (!th) return; tb.style.setProperty('--l-' + id, left + 'px'); left += th.offsetWidth; });
    };
    put();
    if (window.ResizeObserver) { if (S.stRO) S.stRO.disconnect(); S.stRO = new ResizeObserver(() => put()); S.stRO.observe(tb.tHead); }
  }
  // 줄 하나만 다시 그림 (입력 중인 줄은 입력이 끝난 뒤)
  function redrawRow(cx, key) {
    if (!S.rows) return;
    const i = S.rows.findIndex(x => x.key === key); if (i < 0) return;
    const old = S.rows[i]; cx = old.cx || cx;
    const C = CI(cx), x = rowOf(cx, C, mineMap(cx), old.pnu, (dongOf(C, old.dn) || {}).dong || old.dn, old.ho);
    x.fs = old.fs; S.rows[i] = x;
    clearTimeout(S.sideT); S.sideT = setTimeout(() => drawSide(cx), 120);   // 오른쪽 매물 목록도 맞춤
    if (S.ed && S.ed.i === i) { S.ed.stale = true; return; }
    const tr = document.querySelector(`#dj_tbl tr[data-i="${i}"]`); if (!tr) return;
    tr.outerHTML = rowHtml(x, i);
    const n = document.querySelector(`#dj_tbl tr[data-i="${i}"]`);
    wireLedRows(cx, n, LOCK(x));
    n.querySelectorAll('[data-telx]').forEach(b => b.onclick = e => { e.stopPropagation(); S.telOpen = S.telOpen || new Set(); const k = b.dataset.telx; S.telOpen.has(k) ? S.telOpen.delete(k) : S.telOpen.add(k); redrawRow(cx, k); });
    n.querySelectorAll('[data-hist]').forEach(b => b.onclick = () => toggleHist(cx, b.dataset.hist));
    wireTel(cx, n);
    if (S.pk && S.pk.key === key) setTimeout(() => drawPanel(), 0);   // 10/29 칸을 벗어나는 순간(change)에 바로 그리면 Tab으로 간 다음 칸 커서가 사라짐 → 포커스가 옮겨진 뒤 판단
  }
  // 장부 내용으로 매물 카드(사진·광고 항목·리얼맵 지도) 만들기 — 표의 [리얼맵 등록] · 관리장부 입력창의 [광고 카드 만들기]
  function cardFrom(x) {
    const r = x.r || {}, pr = r.pr || {}, k = (x.st.k || [])[0] || 'sale';
    const pre = { kind: k, ...(k === 'sale' ? { price: pr.sale || 0 } : k === 'jeonse' ? { deposit: pr.jeonse || 0 } : { deposit: pr.wd || 0, rent: pr.wr || 0 }),
      ...(r.tels && r.tels.length ? { contacts: r.tels.map(t => ({ role: t.l || '소유자', name: t.m || '', phone: t.n })) } : {}) };
    if (!S.host.pubNew) { S.host.openAdd(x.pnu, x.dn, x.ho, pre); return; }
    const dir = x.dir ? (/향$/.test(x.dir) ? x.dir : x.dir + '향') : '', mi = r.moveIn ? (/^\d{4}-\d{2}-\d{2}$/.test(r.moveIn) ? r.moveIn.replace(/-/g, '.') : String(r.moveIn)) : '';
    S.host.pubNew({ pnu: x.pnu, dong: x.dn, ho: x.ho, kind: pre.kind, money: { price: pre.price || null, deposit: pre.deposit || null, rent: pre.rent || null }, contacts: (pre.contacts || []).map(c => ({ ...c })), area: x.a || null, dir, movein: mi, rooms: r.rm || 0, baths: r.bt || 0, mgmt: r.mg || 0, ptype: cxType(x.cx), pre });
  }
  // 연락처 펼치기 · 번호를 누르면 전화 (통화 기록이 남음)
  function wireTel(cx, root) {
    root.querySelectorAll('[data-ls]').forEach(b => b.onclick = e => { e.stopPropagation(); if (S.ed) endEdit(S.tcx); S.host.openEdit(b.dataset.ls); });
    root.querySelectorAll('[data-pubm]').forEach(b => b.onclick = e => { e.stopPropagation(); if (S.ed) endEdit(S.tcx); S.host.pubClick(b.dataset.pubm, b); });
    root.querySelectorAll('[data-up]').forEach(b => b.onclick = e => { e.stopPropagation(); if (S.ed) endEdit(S.tcx); const x = S.rows.find(z => z.key === b.dataset.up); if (x) cardFrom(x); });
    root.querySelectorAll('[data-tx]').forEach(b => b.onclick = e => { e.stopPropagation(); S.telOpen = S.telOpen || new Set(); const k = b.dataset.tx; S.telOpen.has(k) ? S.telOpen.delete(k) : S.telOpen.add(k); redrawRow(cx, k); });
    root.querySelectorAll('[data-tcall]').forEach(a => a.onclick = e => {
      e.stopPropagation();
      const tr = a.closest('tr[data-key]'), x = tr && S.rows.find(z => z.key === tr.dataset.key); if (!x) return;
      const t = ((x.r && x.r.tels) || [])[+a.dataset.tcall];
      if (!(S.L[x.cx.id] && S.L[x.cx.id].err)) actRow(x.cx, x, 'call', { label: (t && t.l) || '연락처' });
    });
  }
  // 호별 면적: 표에 나온 동만, 동마다 한 번
  function needAreas(cx, C, rows) {
    C.areas = C.areas || {};
    const ds = new Set(rows.map(x => x.dn));
    for (const dn of ds) {
      const d = dongOf(C, dn); if (!d) continue;
      const k = d.pnu + '|' + d.dong; if (C.areas[k] !== undefined) continue;
      C.areas[k] = 'loading';
      api(`/api/units?pnu=${d.pnu}&dong=${encodeURIComponent(d.dong)}&areas=1`).then(j => { C.areas[k] = j.areas && Object.keys(j.areas).length ? j.areas : {}; }).catch(() => { C.areas[k] = {}; })
        .then(() => { if (S.cur === cx.id) drawTable(cx); else if (S.cur === '__all') drawTable(AX); });
    }
  }

  // ---------- 저장 (같은 호는 차례대로) ----------
  const fieldsOfSum = r => r ? fieldsOf({ ...EMPTY_REC(), ...r }) : fieldsOf(EMPTY_REC());
  function queue(key, fn) { S.q = S.q || {}; const p = (S.q[key] || Promise.resolve()).then(fn, fn); S.q[key] = p.catch(() => {}); return p; }
  function putSum(cx, key, rec) {
    const L = S.L[cx.id]; if (!L || !L.units) return;
    const empty = !rec.hist.length && !rec.st.src && !rec.live && !rec.exp && !rec.tels.length && !rec.note && !rec.opt && !rec.moveIn && !rec.imp && !rec.cd && !rec.cr && !rec.mk && !rec.rm && !rec.bt && !rec.mg;
    if (empty) delete L.units[key]; else L.units[key] = { ...rec, hist: rec.hist.slice(0, 3), histN: rec.hist.length };
  }
  // mutate는 '값을 정하는' 함수여야 함(두 번 적용돼도 같은 결과) — 화면에 먼저 반영하고 서버에 차례로 저장
  function saveRow(cx, x, mutate) {
    const L = S.L[cx.id];
    if (L && L.units) {
      const cur = L.units[x.key], D = fieldsOfSum(cur);
      if (!D.st.src && x.st.fromLs) { D.st = { src: 'mine', k: [...x.st.k], hold: x.st.hold, office: '' }; D.pr = { ...D.pr, ...Object.fromEntries(Object.entries(x.st.lsp || {}).filter(([k, v]) => v && !D.pr[k])) }; }   // 10/28 가격도 함께
      mutate(D);
      L.units[x.key] = { ...EMPTY_REC(), ...(cur || {}), ...D, hist: cur ? cur.hist : [], histN: cur ? cur.histN : 0 };
      redrawRow(cx, x.key); refreshDongs(cx);
    }
    return queue(x.key, async () => {
      const L = S.L[cx.id], cur = L && L.units ? L.units[x.key] : null;
      const D = fieldsOfSum(cur);
      // 장부에 상태가 없고 매물장 매물로만 보이던 호는, 처음 저장할 때 그 상태를 장부에 옮겨 적음
      if (!D.st.src && x.st.fromLs) { D.st = { src: 'mine', k: [...x.st.k], hold: x.st.hold, office: '' }; D.pr = { ...D.pr, ...Object.fromEntries(Object.entries(x.st.lsp || {}).filter(([k, v]) => v && !D.pr[k])) }; }   // 10/28 가격도 함께
      mutate(D);
      try {
        const j = await hjPost({ id: cx.id, key: x.key, op: 'save', rec: D, up: (cur && cur.up) || '' });   // up: 다른 직원이 먼저 고쳤는지 확인용 (10/28)
        if (j.memos) S.cx.memos = j.memos;
        if (j.lsDirty && S.host.refreshItems) S.host.refreshItems();   // 같은 호의 매물 카드도 바뀜
        putSum(cx, x.key, { ...EMPTY_REC(), ...j.rec });
        if (S.pk && S.pk.key === x.key) { S.pkRec = { ...EMPTY_REC(), ...j.rec }; setTimeout(() => drawPanel(), 0); }
      } catch (e) { if (e.code === 'conflict' && e.data && e.data.rec) { putSum(cx, x.key, { ...EMPTY_REC(), ...e.data.rec }); if (S.pk && S.pk.key === x.key) { S.pkRec = { ...EMPTY_REC(), ...e.data.rec }; setTimeout(() => drawPanel(true), 0); } } toast(e.message, e.code === 'conflict' ? 6000 : 4000); }
      redrawRow(cx, x.key); refreshDongs(cx);
    });
  }
  function actRow(cx, x, op, extra) {
    return queue(x.key, async () => {
      try {
        const j = await hjPost({ id: cx.id, key: x.key, op, ...extra });
        if (j.memos) S.cx.memos = j.memos;
        if (j.lsDirty && S.host.refreshItems) S.host.refreshItems();
        putSum(cx, x.key, { ...EMPTY_REC(), ...j.rec });
        if (S.hist === x.key) S.histRec = { ...EMPTY_REC(), ...j.rec };
        if (S.pk && S.pk.key === x.key) S.pkRec = { ...EMPTY_REC(), ...j.rec };
      } catch (e) { toast(e.message, 4000); }
      if (S.hist === x.key && !S.ed) drawTable(S.tcx); else redrawRow(cx, x.key);
      refreshDongs(cx);
    });
  }
  const putK = K => { [K.m + K.o, K.e, K.d].forEach((v, i) => { const b = $('dj_k' + i); if (b) { b.textContent = v; if (i === 1) b.classList.toggle('r', !!v); } }); };
  // 동 버튼 숫자와 위 요약 숫자만 고침
  function refreshDongs(cx) {
    if (S.cur === '__all') { putK(kpi(allList().flatMap(c => rowsAll(c, CI(c), mineMap(c))))); drawTree(); return; }
    const C = S.C[cx.id]; if (!C) return;
    const MM = mineMap(cx);
    document.querySelectorAll('#dj_dongs [data-dong]').forEach(b => {
      const d = (C.dongs || []).find(x => x.pnu + '|' + x.dong === b.dataset.dong); if (!d) return;
      const n = dongCounts(cx, d, MM);
      b.classList.toggle('has', !!(n.m || n.o || n.e));
      b.innerHTML = chipIn(d, n);
    });
    putK(kpi(rowsAll(cx, C, MM)));
  }

  // ---------- 칸 바로 입력 ----------
  function endEdit(cx) {
    const e = S.ed; S.ed = null; closePop();
    document.querySelectorAll('#dj_tbl td.editing').forEach(td => td.classList.remove('editing'));
    if (!e) return;
    // 입력 중에 미뤄 둔 다시 그리기: 바로 그리면 지금 누르는 다른 칸이 사라져 한 번 더 눌러야 하므로 조금 뒤에 (새 입력이 시작됐으면 그 입력이 끝난 뒤)
    if (S.redraw) { S.redraw = false; setTimeout(() => { if (S.ed) S.redraw = true; else redrawView(); }, 300); return; }
    if (e.stale) redrawRow(cx, S.rows[e.i] && S.rows[e.i].key);
    else { const td = document.querySelector(`#dj_tbl tr[data-i="${e.i}"] td[data-c="${e.c}"]`); if (td && S.rows[e.i]) td.innerHTML = cellHtml(S.rows[e.i], VC().find(c => c.id === e.c)); }
  }
  function move(cx, i, c, dir) {
    if (dir === 'down') { if (i + 1 < S.rows.length) return startEdit(cx, i + 1, c); return; }
    const nav = NAV.filter(id => VC().some(z => z.id === id)), k = nav.indexOf(c) + (dir === 'prev' ? -1 : 1);
    if (k >= 0 && k < nav.length) return startEdit(cx, i, nav[k]);
  }
  function startEdit(cx, i, c) {
    if (cxLocked(cx)) return toast(`요금제 단지 한도(${cxLimit()}곳)를 넘은 단지라 보기만 됩니다`, 3500);
    if (S.ed) endEdit(cx);
    const x = S.rows[i], col = VC().find(z => z.id === c); if (!x || !col || !col.ed) return;
    cx = x.cx || cx;                                          // 모든 단지 보기에서는 그 줄의 단지
    const td = document.querySelector(`#dj_tbl tr[data-i="${i}"] td[data-c="${c}"]`); if (!td) return;
    S.ed = { i, c };
    if (col.ed === 'st') return statusPop(cx, x, td);
    if (col.ed === 'tel') return telPop(cx, x, td, c === 'ten');
    const r = x.r || {};
    let el;
    if (col.ed === 'live') el = `<select class="ce">${[['', '-'], ['owner', '입주'], ['tenant', '임차'], ['empty', '공실']].map(([v, t]) => `<option value="${v}"${(r.live || '') === v ? ' selected' : ''}>${t}</option>`).join('')}</select>`;
    else if (col.ed === 'dir') el = `<select class="ce"><option value="">-</option>${DIRS.map(d => `<option${x.dir === d ? ' selected' : ''}>${d}</option>`).join('')}</select>`;
    else if (col.ed === 'area') el = `<input class="ce" value="${x.r && x.r.ar ? x.r.ar : ''}" placeholder="${x.a ? Math.round(x.a) + '㎡ (자동)' : '전용㎡ (예: 84)'}" title="전용면적을 ㎡로 적어 주세요 (평으로 적으면 전용 평으로 계산)" inputmode="decimal" maxlength="10">`;
    else if (col.ed === 'py' || col.ed === 'ty') { const lt = x.lt || {}, sp = supPy(x); el = col.ed === 'py' ? `<input class="ce" value="${lt.py || ''}" placeholder="${sp ? sp.v + '평' : '예: 34'}" inputmode="numeric" maxlength="3" title="공급평 — 같은 동·라인 모든 호에 들어갑니다">` : `<input class="ce" value="${esc(lt.t || '')}" placeholder="예: 84B" maxlength="8" title="타입 — 같은 동·라인 모든 호에 들어갑니다">`; }
    else if (col.ed === 'pr') { const v = ((x.r && x.r.pr) || {})[col.f] || (!(x.r && x.r.pr) && x.st.k.length === 1 && col.f !== 'wr' && x.st.k.includes(col.f === 'wd' ? 'wolse' : col.f) ? x.st.prn : 0); el = `<input class="ce" value="${esc(col.f === 'wr' ? (v || '') : manTxt(v))}" placeholder="${col.f === 'wr' ? '만원 (예: 250)' : '예: 8억 5천'}" ${col.f === 'wr' ? 'inputmode="numeric"' : ''} maxlength="14">`; }
    else if (col.ed === 'man') el = `<input class="ce" value="${esc(manTxt(r[col.f]))}" placeholder="예: 6.5억" maxlength="14">`;
    else if (col.ed === 'num') el = `<input class="ce" value="${r[col.f] || ''}" placeholder="만원" inputmode="numeric" maxlength="6">`;
    else if (col.ed === 'cur') el = `<input class="ce" value="${esc(r.cd || r.cr ? (r.cr ? `${manTxt(r.cd)}/${r.cr}` : manTxt(r.cd)) : '')}" placeholder="전세 6.5억 · 월세 3억/150" maxlength="20">`;
    else if (col.ed === 'date') { const v = r[col.f] || ''; el = `<input class="ce" type="date" value="${/^\d{4}-\d{2}-\d{2}$/.test(v) ? esc(v) : ''}">${v && !/^\d{4}-\d{2}-\d{2}$/.test(v) ? `<small class="was">전에 적은 값: ${esc(v)}</small>` : ''}`; }
    else el = `<input class="ce" value="${esc(r[col.f] || '')}" placeholder="${esc(col.ph || '')}" maxlength="${col.f === 'note' ? 300 : col.f === 'opt' ? 200 : col.f === 'imp' ? 100 : 30}">`;
    td.classList.add('editing'); td.innerHTML = el;
    const inp = td.querySelector('.ce'); inp.focus(); if (inp.select && inp.type !== 'date' && inp.tagName === 'INPUT') inp.select();
    if (inp.tagName === 'SELECT' || inp.type === 'date') { try { inp.showPicker && inp.showPicker(); } catch { /* 지원 안 하는 브라우저는 한 번 더 누르면 열림 */ } }
    const orig = inp.value, me = S.ed;
    let done = false;
    const commit = how => {
      if (done) return; done = true;
      if (S.ed !== me) how = null;   // 그새 다른 칸을 눌렀으면(바깥 클릭) 저장만 하고 그 칸은 그대로 둠
      const v = inp.value;
      td.classList.remove('editing');
      if (v !== orig) {
        if (col.ed === 'py' || col.ed === 'ty') {
          endEdit(cx); ltAsk(cx, x, td, col.ed, v);   // 같은 라인 모두 / 이 호만 — 고르면 저장
          return;
        } else if (col.ed === 'dir') {
          endEdit(cx); ltAsk(cx, x, td, 'dir', v);   // 방향도 같은 라인 모두 / 이 호만
          return;
        } else saveRow(cx, x, D => {
          if (col.ed === 'area') { const m = String(v).replace(/\s/g, '').match(/^(\d+(?:\.\d+)?)(평|㎡|m2|m²)?$/i); D.ar = !v.trim() ? 0 : m ? Math.round((m[2] === '평' ? +m[1] * PY : +m[1]) * 100) / 100 : D.ar; if (v.trim() && !m) toast('전용면적을 84처럼 ㎡로 적어 주세요'); }
          else if (col.ed === 'live') D.live = v;
          else if (col.ed === 'pr') {   // 의뢰가격 칸: 값을 넣으면 그 거래가 걸리고(상태가 없으면 내 매물), 지우면 그 거래가 빠짐
            const n = col.f === 'wr' ? +(String(v).replace(/\D/g, '') || 0) : parseMan(v);
            if (Number.isNaN(n)) { toast('가격을 숫자로 적어 주세요 (예: 8억 5천)'); return; }
            const k = col.f === 'wd' || col.f === 'wr' ? 'wolse' : col.f, ORD = ['sale', 'jeonse', 'wolse'];
            D.pr = { ...D.pr, [col.f]: n || 0 };
            const has = k === 'wolse' ? D.pr.wd || D.pr.wr : D.pr[k];
            if (has) { if (!D.st.src) D.st = { src: 'mine', k: [], hold: false, office: '' }; if (!D.st.k.includes(k)) D.st.k = [...D.st.k, k].sort((a, z) => ORD.indexOf(a) - ORD.indexOf(z)); }
            else if (D.st.src && D.st.k.includes(k)) { D.st.k = D.st.k.filter(z => z !== k); if (!D.st.k.length) D.st = { src: '', k: [], hold: false, office: '' }; }
          }
          else if (col.ed === 'man' || col.ed === 'num') {   // 현상태 보증금·차임 — 넣으면 구분이 비어 있을 때 '임차인'
            const n = col.ed === 'num' ? +(String(v).replace(/\D/g, '') || 0) : parseMan(v);
            if (Number.isNaN(n)) { toast('숫자로 적어 주세요 (예: 6.5억)'); return; }
            D[col.f] = n || 0; if (n && !D.live) D.live = 'tenant';
          }
          else if (col.ed === 'cur') {   // '6.5억' = 전세 · '3억/150' · '1000/50' = 보증금/차임
            const [a, b] = String(v).split('/'), cd = parseMan(a), cr = +(String(b || '').replace(/\D/g, '') || 0);
            if (Number.isNaN(cd)) toast('예: 6.5억 (전세) 또는 3억/150 (월세)'); else { D.cd = cd || 0; D.cr = cr; if ((cd || cr) && !D.live) D.live = 'tenant'; }
          }
          else if (col.id === 'mi') { const was = (x.r && x.r.moveIn) || ''; D.moveIn = v; if (v && (!D.exp || D.exp === was)) D.exp = v; }   // 만기는 입주와 같게 (다르면 만기 칸에서 고침)
          else if (col.ed === 'date') D[col.f] = v;
          else D[col.f] = v.trim();
        });
      }
      if (S.ed === me) endEdit(cx);
      if (how) move(cx, i, c, how);
    };
    inp.onkeydown = e => {
      if (e.isComposing) return;
      if (e.key === 'Enter') { e.preventDefault(); commit('down'); }
      else if (e.key === 'Tab') { e.preventDefault(); commit(e.shiftKey ? 'prev' : 'next'); }
      else if (e.key === 'Escape') { e.preventDefault(); inp.value = orig; commit(); }
    };
    if (inp.tagName === 'SELECT') inp.onchange = () => commit();
    // 날짜: 달력에서 고르면 바로 저장 (숫자를 직접 치는 중에는 Enter·Tab·다른 곳 누를 때 저장)
    if (inp.type === 'date') { let typing = false; inp.addEventListener('keydown', e => { if (/^\d$/.test(e.key) || e.key === 'Backspace') typing = true; }); inp.onchange = () => { if (!typing && inp.value) commit(); }; }
    inp.onblur = () => setTimeout(() => commit(), 0);
  }

  // 평형·타입을 적으면 "같은 라인 모두 바꿀까요?" — [같은 라인 모두] 라인 값 · [이 호만] 그 호 값(PNU|동|h호) (10/26)
  function ltAsk(cx, x, td, ed, v) {
    const val = ed === 'py' ? +(String(v).replace(/\D/g, '') || 0) : ed === 'dir' ? String(v).trim() : String(v).trim().toUpperCase();
    const C = CI(cx), U = C.units && C.units[`${x.pnu}|${(dongOf(C, x.dn) || {}).dong}`];
    const n = Array.isArray(U) ? U.filter(u => { const h = +digits(normH(u.ho)); return u.flrGb !== '지하' && (h >= 100 ? h % 100 : h) === x.line; }).length : 0;
    const what = ed === 'py' ? (val ? val + '평' : '빈 값') : ed === 'dir' ? (val ? val + '향' : '빈 값') : (val || '빈 값');
    const save = async key => {
      closePop();
      const redo = () => S.rows.filter(z => z.pnu === x.pnu && z.dn === x.dn && z.line === x.line).forEach(z => redrawRow(cx, z.key));
      try {
        if (ed === 'dir') {
          if (val) cx.dir = { ...(cx.dir || {}), [key]: val }; else { cx.dir = { ...(cx.dir || {}) }; delete cx.dir[key]; }
          redo();
          const j = await post({ op: 'dir', id: cx.id, key, v: val }); S.cx = { items: j.items, memos: j.memos }; const nn = j.items.find(z => z.id === cx.id); if (nn) cx.dir = nn.dir;
        } else {
          const lt = { ...((cx.lt || {})[key] || {}) }; if (ed === 'py') lt.py = val; else lt.t = val;
          cx.lt = { ...(cx.lt || {}), [key]: lt }; redo();
          const j = await post({ op: 'lt', id: cx.id, key, t: lt.t || '', py: lt.py || 0 }); S.cx = { items: j.items, memos: j.memos }; const nn = j.items.find(z => z.id === cx.id); if (nn) cx.lt = nn.lt;
        }
        redo(); toast(key.includes('|h') ? `${US(x)}만 ${what}(으)로 적었습니다` : `${DN(x.dn)} ${x.line}라인 모든 호를 ${what}(으)로 바꿨습니다`); }
      catch (er) { toast(er.message); }
    };
    const p = openPop(td, `<b class="pt">${esc(DN(x.dn))} ${x.line}라인을 모두 ${esc(what)}(으)로 바꿀까요?</b>
      <p class="note" style="margin:2px 0 8px">같은 라인은 보통 ${ed === 'py' ? '평형' : ed === 'dir' ? '방향' : '타입'}이 같습니다.${n ? ` 이 라인은 ${n}호입니다.` : ''}</p>
      <div class="pr2"><button type="button" class="btn dark sm" id="la_all">네, 같은 라인 모두</button><button type="button" class="btn ghost sm" id="la_one">이 호만</button><button type="button" class="btn ghost sm" id="la_no">취소</button></div>`);
    S.ed = { i: -1, c: ed };   // 창이 떠 있는 동안 표를 다시 그리지 않게
    $('la_all').onclick = () => { S.ed = null; save(`${x.pnu}|${x.dn}|${x.line}`); };
    $('la_one').onclick = () => { S.ed = null; save(`${x.pnu}|${x.dn}|h${x.ho}`); };
    $('la_no').onclick = () => { S.ed = null; closePop(); td.classList.remove('editing'); };
    $('la_all').focus();
  }
  // ---------- 라인 설정: 타입(84B) · 공급평 · 방향 → 이 라인 모든 호에 (매물관리 아파트 매물에도 저장 때 채워짐) ----------
  function linePop(cx, pnu, dong, l, ex, th) {
    if (cxLocked(cx)) return toast(`요금제 단지 한도(${cxLimit()}곳)를 넘은 단지라 보기만 됩니다`, 3500);
    const lk = `${pnu}|${normD(dong)}|${l}`, lt = (cx.lt || {})[lk] || {}, dir = (cx.dir || {})[lk] || '', est = ex ? supPy({ a: ex }).v : '';
    S.tcx = cx;
    const p = openPop(th, `<b class="pt">${esc(dong)} ${String(l).padStart(2, '0')}라인 설정</b><div class="ppf">
      <label>타입<input class="hjin sm" id="lp_t" value="${esc(lt.t || '')}" placeholder="예: 84B" maxlength="8"></label>
      <label>공급평<input class="hjin sm" id="lp_py" value="${lt.py || ''}" placeholder="${est ? '추정 ' + est + '평' : '예: 34'}" inputmode="numeric" maxlength="3"><small>${ex ? `전용 ${ex}㎡ (건축물대장)` : ''}</small></label>
      <label>방향<select class="hjin sm" id="lp_d"><option value="">-</option>${DIRS.map(d => `<option${d === dir ? ' selected' : ''}>${d}</option>`).join('')}</select></label>
      <p class="note" style="margin:2px 0 0">한 번 적으면 이 라인 모든 호에 들어갑니다.</p>
      <button type="button" class="btn sm" id="lp_go">저장</button></div>`);
    const go = async () => {
      const t = $('lp_t').value.trim().toUpperCase(), py = +($('lp_py').value.replace(/\D/g, '') || 0), d = $('lp_d').value;
      endEdit(cx);
      try {
        if (t !== (lt.t || '') || py !== (lt.py || 0)) { const j = await post({ op: 'lt', id: cx.id, key: lk, t, py }); S.cx = { items: j.items, memos: j.memos }; const n = j.items.find(z => z.id === cx.id); if (n) cx.lt = n.lt; }
        if (d !== dir) { const j = await post({ op: 'dir', id: cx.id, key: lk, v: d }); S.cx = { items: j.items, memos: j.memos }; const n = j.items.find(z => z.id === cx.id); if (n) cx.dir = n.dir; }
        toast(`${dong} ${l}라인에 적었습니다`); drawComplex(cx);
      } catch (e) { toast(e.message); }
    };
    $('lp_go').onclick = go;
    p.querySelectorAll('input').forEach(i => i.onkeydown = e => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); go(); } });
    $('lp_t').focus();
  }

  // ---------- 작은 창 (상태 · 가격 · 연락처) ----------
  function closePop() { const p = $('dj_pop'); if (p) p.remove(); document.removeEventListener('mousedown', popAway, true); }
  function popAway(e) { const p = $('dj_pop'); if (p && !p.contains(e.target) && !e.target.closest('td.editing')) { const cx = S.tcx; endEdit(cx); } }
  function openPop(td, html) {
    closePop();
    td.classList.add('editing');
    const p = document.createElement('div'); p.id = 'dj_pop'; p.className = 'djpop'; p.innerHTML = html;
    document.body.appendChild(p);
    const r = td.getBoundingClientRect(), W = p.offsetWidth, H = p.offsetHeight;
    let left = Math.min(Math.max(8, r.left), innerWidth - W - 8), top = r.bottom + 4;
    if (top + H > innerHeight - 8) top = Math.max(8, r.top - H - 4);
    p.style.left = left + 'px'; p.style.top = top + 'px';
    setTimeout(() => document.addEventListener('mousedown', popAway, true), 0);
    p.addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); endEdit(S.tcx); } });
    return p;
  }
  function statusPop(cx, x, td) {
    const s = x.st, cur = s.done ? { src: '', k: [] } : s;
    const on = (src, k) => cur.src === src && cur.k.includes(k);
    const exp = x.r && x.r.exp;
    const p = openPop(td, `<b class="pt">상태 — ${esc(US(x))}</b>
      <div class="pg">${['mine', 'other'].map(src => ['sale', 'jeonse', 'wolse'].map(k => `<button type="button" class="${src === 'mine' ? 'f-' : 'o-'}${k}" data-sk="${src}:${k}" aria-pressed="${on(src, k)}">${src === 'mine' ? '내' : '타'} ${KN[k]}</button>`).join('')).join('')}</div>
      ${cur.src === 'other' ? `<input class="hjin sm" id="pp_of" value="${esc(cur.office || '')}" placeholder="어느 부동산? (예: ○○공인) — Enter" maxlength="30">` : ''}
      <div class="pr2"><button type="button" data-pa="hold" aria-pressed="${!!cur.hold}">보류</button><button type="button" data-pa="deal">계약됨…</button>${exp ? '<button type="button" data-pa="renew">갱신…</button><button type="button" data-pa="early">만기 전 이사…</button>' : ''}<button type="button" data-pa="none">없음</button></div>
      <div id="pp_more"></div>
      <p class="note">한 번 누르면 바로 저장되고 [기록]에 남습니다. 같은 칸을 다시 누르면 빠집니다(매매·전세 함께 가능).</p>`);
    // 누른 순간의 상태에서 '다음 상태'를 정해 저장 (여러 번 적용돼도 같은 결과)
    const NONE = { src: '', k: [], hold: false, office: '' }, ORD = ['sale', 'jeonse', 'wolse'];
    const base = cur.src ? { src: cur.src, k: [...cur.k], hold: !!cur.hold, office: cur.office || '' } : { ...NONE, k: [] };
    const set = nx => { saveRow(cx, x, D => { D.st = JSON.parse(JSON.stringify(nx)); }); endEdit(cx); };
    p.querySelectorAll('[data-sk]').forEach(b => b.onclick = () => {
      const [src, k] = b.dataset.sk.split(':');
      if (base.src !== src) return set({ src, k: [k], hold: false, office: src === 'other' ? base.office : '' });
      const kk = base.k.includes(k) ? base.k.filter(z => z !== k) : [...base.k, k].sort((a, z) => ORD.indexOf(a) - ORD.indexOf(z));
      set(kk.length ? { ...base, k: kk } : NONE);
    });
    if ($('pp_of')) { $('pp_of').focus(); $('pp_of').onkeydown = e => { if (e.key === 'Enter' && !e.isComposing) set({ ...base, office: e.target.value.trim() }); }; }
    p.querySelector('[data-pa="hold"]').onclick = () => { if (!base.src) return toast('먼저 매매·전세·월세 중 하나를 골라 주세요'); set({ ...base, hold: !base.hold }); };
    p.querySelector('[data-pa="none"]').onclick = () => set(NONE);
    const more = $('pp_more');
    const seg = (g, list, v0) => `<div class="hjseg" data-g="${g}">${list.map(([v, t]) => `<button type="button" data-v="${v}" aria-pressed="${v === v0}">${t}</button>`).join('')}</div>`;
    const wireSeg = () => more.querySelectorAll('[data-g] [data-v]').forEach(b => b.onclick = () => { b.parentNode.querySelectorAll('[data-v]').forEach(z => z.setAttribute('aria-pressed', z === b)); const g = b.parentNode.dataset.g; if (g === 'dk') { more.querySelector('[data-wr]').hidden = b.dataset.v !== 'wolse'; more.querySelector('[data-ex]').hidden = b.dataset.v === 'sale'; } if (g === 'by') $('pd_of').hidden = b.dataset.v !== 'other'; });
    const pick = g => { const b = more.querySelector(`[data-g="${g}"] [aria-pressed="true"]`); return b ? b.dataset.v : ''; };
    const run = (op, extra) => { actRow(cx, x, op, extra); endEdit(cx); };
    p.querySelector('[data-pa="deal"]').onclick = () => {
      const k0 = cur.k[0] || 'jeonse', pr = (x.r && x.r.pr) || {};
      more.innerHTML = `<div class="ppf"><b>계약 기록</b>${seg('dk', [['sale', '매매'], ['jeonse', '전세'], ['wolse', '월세']], k0)}
        <label>금액<input class="hjin sm" id="pd_a" value="${esc(manTxt(k0 === 'sale' ? pr.sale : k0 === 'jeonse' ? pr.jeonse : pr.wd))}" placeholder="예: 8억 5천"></label>
        <label data-wr ${k0 === 'wolse' ? '' : 'hidden'}>월세(만원)<input class="hjin sm" id="pd_r" value="${pr.wr || ''}" inputmode="numeric"></label>
        <label>입주일<input class="hjin sm" type="date" id="pd_mi"></label>
        <label data-ex ${k0 === 'sale' ? 'hidden' : ''}>만기일<input class="hjin sm" type="date" id="pd_exp" title="비우면 입주일 + 2년"></label>
        ${seg('by', [['mine', '내 계약'], ['other', '타사 계약']], 'mine')}<input class="hjin sm" id="pd_of" placeholder="계약한 부동산 (선택)" hidden>
        <button type="button" class="btn dark sm" id="pd_go">계약 기록</button></div>`;
      wireSeg(); $('pd_a').focus();
      $('pd_go').onclick = () => { const a = parseMan($('pd_a').value); if (!a || Number.isNaN(a)) return toast('금액을 적어 주세요 (예: 8억 5천)'); const k = pick('dk'); run('deal', { deal: { k, a, r: k === 'wolse' ? +($('pd_r').value || 0) : 0, d: todayK(), mi: $('pd_mi').value, exp: k === 'sale' ? '' : $('pd_exp').value, by: pick('by'), office: $('pd_of').value } }); };
    };
    const rn = p.querySelector('[data-pa="renew"]');
    if (rn) rn.onclick = () => { more.innerHTML = `<div class="ppf"><b>갱신</b> <span class="note">만기 ${esc(exp.slice(2).replace(/-/g, '.'))} → 2년 연장</span>${seg('how', [['right', '계약갱신요구권'], ['agree', '합의 갱신']], 'right')}<label>보증금(바뀌면)<input class="hjin sm" id="pr_a" placeholder="선택"></label><button type="button" class="btn dark sm" id="pr_go">갱신 기록</button></div>`; wireSeg(); $('pr_go').onclick = () => { const a = parseMan($('pr_a').value); run('renew', { how: pick('how'), amount: Number.isNaN(a) ? 0 : a }); }; };
    const ea = p.querySelector('[data-pa="early"]');
    if (ea) ea.onclick = () => { more.innerHTML = `<div class="ppf"><b>만기 전 이사</b><label>나가는 날<input class="hjin sm" type="date" id="pe_d"></label><button type="button" class="btn dark sm" id="pe_go">기록</button></div>`; $('pe_go').onclick = () => { if (!$('pe_d').value) return toast('나가는 날짜를 골라 주세요'); run('early', { date: $('pe_d').value }); }; };
  }
  function pricePop(cx, x, td) {
    const pr = (x.r && x.r.pr) || {}, ks = x.st.k.length ? x.st.k : ['sale', 'jeonse', 'wolse'];
    const row = (f, t, ph) => `<label>${t}<input class="hjin sm" data-pf="${f}" value="${esc(f === 'wr' ? (pr.wr || '') : manTxt(pr[f]))}" placeholder="${ph}" autocomplete="off"><small data-pv="${f}"></small></label>`;
    const p = openPop(td, `<b class="pt">가격 — ${esc(US(x))}</b><div class="ppf">${ks.includes('sale') ? row('sale', '매매가', '예: 14억 5천') : ''}${ks.includes('jeonse') ? row('jeonse', '전세 보증금', '예: 8억 5천') : ''}${ks.includes('wolse') ? row('wd', '월세 보증금', '예: 1억') + row('wr', '월세(만원)', '예: 250') : ''}
      <button type="button" class="btn dark sm" id="pp_go">저장 (Enter)</button></div>${x.st.k.length ? '' : '<p class="note">상태에서 매매·전세·월세를 고르면 그 가격만 나옵니다.</p>'}`);
    const ins = [...p.querySelectorAll('[data-pf]')];
    ins.forEach(i => i.oninput = () => { const v = i.dataset.pf === 'wr' ? +(i.value.replace(/\D/g, '') || 0) : parseMan(i.value), s = p.querySelector(`[data-pv="${i.dataset.pf}"]`); s.textContent = Number.isNaN(v) ? '숫자로 (예: 8억 5천)' : v ? '= ' + (i.dataset.pf === 'wr' ? v + '만' : wonFull(v)) : ''; });
    const go = how => {
      const vals = {}; for (const i of ins) { const v = i.dataset.pf === 'wr' ? +(i.value.replace(/\D/g, '') || 0) : parseMan(i.value); if (Number.isNaN(v)) return toast('가격을 숫자로 적어 주세요 (예: 8억 5천)'); vals[i.dataset.pf] = v; }
      saveRow(cx, x, D => { Object.assign(D.pr, vals); });
      const i = S.ed && S.ed.i; endEdit(cx); if (how && i != null) move(cx, i, 'pr', how);
    };
    ins.forEach((i, n) => i.onkeydown = e => { if (e.isComposing) return; if (e.key === 'Enter') { e.preventDefault(); go('down'); } if (e.key === 'Tab' && n === ins.length - 1 && !e.shiftKey) { e.preventDefault(); go('next'); } });
    $('pp_go').onclick = () => go();
    if (ins[0]) { ins[0].focus(); ins[0].select(); }
  }
  function telPop(cx, x, td, ten) {
    const T = JSON.parse(JSON.stringify((x.r && x.r.tels) || []));
    if (ten && !T.some(isTen)) T.push({ l: '세입자', n: '' });
    if (!ten && !T.some(t => !isTen(t))) T.unshift({ l: '소유자', n: '' });
    const draw1 = () => {
      const p = openPop(td, `<b class="pt">연락처 — ${esc(US(x))}</b><span class="note">이 계정에서만 보이고 암호화해서 저장합니다</span>
        <div class="ppf">${T.map((t, i) => `<div class="hjtel"><input class="hjin sm lb" list="hj_tl" data-tl="${i}" value="${esc(t.l)}" placeholder="소유자" maxlength="10"><input class="hjin sm" data-tn="${i}" value="${esc(t.n)}" placeholder="010-0000-0000" inputmode="tel" maxlength="20"><a class="call" href="tel:${esc(String(t.n).replace(/[^\d+]/g, ''))}" data-call="${i}"${t.n ? '' : ' hidden'}>전화</a><button type="button" class="x" data-tdel="${i}" aria-label="지우기">×</button></div>`).join('')}
        ${T.length < 4 ? '<button type="button" class="lnk2" id="pt_add">＋ 연락처 추가</button>' : ''}<datalist id="hj_tl">${TLB.map(t => `<option value="${t}">`).join('')}</datalist>
        <button type="button" class="btn dark sm" id="pt_go">저장 (Enter)</button></div>`);
      p.querySelectorAll('[data-tl]').forEach(i => i.oninput = () => { T[+i.dataset.tl].l = i.value; });
      p.querySelectorAll('[data-tn]').forEach(i => i.oninput = () => { T[+i.dataset.tn].n = i.value; const a = p.querySelector(`[data-call="${i.dataset.tn}"]`); a.hidden = !i.value.trim(); a.href = 'tel:' + i.value.replace(/[^\d+]/g, ''); });
      p.querySelectorAll('[data-tdel]').forEach(b => b.onclick = () => { T.splice(+b.dataset.tdel, 1); if (!T.length) T.push({ l: '', n: '' }); draw1(); });
      p.querySelectorAll('[data-call]').forEach(a => a.onclick = () => { const t = T[+a.dataset.call]; actRow(cx, x, 'call', { label: (t && t.l) || '연락처' }); });
      if ($('pt_add')) $('pt_add').onclick = () => { T.push({ l: '', n: '' }); draw1(); const ins = p.ownerDocument.querySelectorAll('#dj_pop [data-tn]'); ins[ins.length - 1] && ins[ins.length - 1].focus(); };
      const go = () => { const tels = T.filter(t => String(t.n).trim()); saveRow(cx, x, D => { D.tels = tels; }); endEdit(cx); };
      $('pt_go').onclick = go;
      p.querySelectorAll('input').forEach(i => i.onkeydown = e => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); go(); } });
      const f = p.querySelector('[data-tn]'); if (f && !f.value) f.focus();
    };
    draw1();
  }

  // ---------- 관리장부: 줄 누르기 · 오른쪽 입력창 (10/28) ----------
  // 줄(칸)을 한 번 누르면 오른쪽 입력창 · 고칠 수 있는 칸을 두 번 누르면 예전처럼 표에서 바로 입력 · [매물장으로] = 입력창의 '매물' 칸을 열어 줌
  function wireLedRows(cx, root, ro) {
    root.querySelectorAll('td[data-c]').forEach(td => {
      // 10/29 한 번 누르면 줄 선택만 · 두 번(더블클릭)이나 Enter = 입력창 · 10/30 손가락 화면도 두 번 눌러야 엶(기기마다 같게)
      td.onpointerup = e => { td._pt = e.pointerType; };
      const rowX = () => { const tr = td.closest('tr[data-key]'); return tr && S.rows[+tr.dataset.i]; };
      td.onclick = e => {
        if (td.classList.contains('editing') || e.target.closest('a,button,input,select')) return;
        const x = rowX(); if (!x) return;
        if (td._pt === 'touch') { const k = td.closest('tr[data-key]').dataset.key, t = Date.now(); if (S.tap && S.tap.k === k && t - S.tap.t < 450) { S.tap = null; openPanel(x); } else S.tap = { k, t }; }   // 10/30 선배 결정: 기기마다 같게 — 손가락도 두 번 눌러야 엶
      };
      td.ondblclick = e => {
        if (td.classList.contains('editing') || e.target.closest('a,button,input,select')) return;
        const x = rowX(); if (!x) return; try { getSelection().removeAllRanges(); } catch { /* 무시 */ }
        openPanel(x);
      };
      // 10/28 단순화: 칸 두 번 눌러 바로 고치기는 없앰 — 고치는 길은 오른쪽 입력창 하나
    });
    root.querySelectorAll('[data-mkgo]').forEach(b => b.onclick = e => { e.stopPropagation(); const tr = b.closest('tr[data-key]'), x = tr && S.rows[+tr.dataset.i]; if (x) openPanel(x, true); });
    root.querySelectorAll('[data-mkd]').forEach(b => { b.ondblclick = e => e.stopPropagation(); b.onclick = e => { e.stopPropagation(); const tr = b.closest('tr[data-key]'), x = tr && S.rows[+tr.dataset.i]; if (x) toggleMk(x); }; });
  }
  // 10/29 ● 매물 등록·해제 (매물로 올리기·내리기 버튼 대신) · 리얼맵에 게시 중이면 해제 전에 한 번 물음
  function toggleMk(x) {
    if (LOCK(x)) return toast('보기만 되는 단지입니다');
    const cx = x.cx, s = x.st;
    if (s.src && !s.done) {
      const ls = (s.mine || []).find(z => z.status !== 'done'), live = ls && S.host.pubCell && /게시/.test(S.host.pubCell(ls.id) || '');
      if (live && !confirm(`${UL(x)}를 매물에서 해제할까요?\n리얼맵 지도 광고도 함께 내려갑니다.`)) return;
      saveRow(cx, x, D => { D.st = { src: '', k: [], hold: false, office: '' }; });
      toast(live ? '매물에서 해제했습니다 (리얼맵 광고도 내림)' : '매물에서 해제했습니다');
    } else {
      saveRow(cx, x, D => { D.st = { src: 'mine', k: [D.live === 'tenant' ? 'sale' : 'jeonse'], hold: false, office: '' }; });
      toast('매물로 등록했습니다');
    }
    if (S.pk && S.pk.key === x.key) setTimeout(() => drawPanel(true), 0);
  }
  // 10/29 표 키보드: ↑↓ 줄 옮기기 · Enter 입력창 (칸에 쓰는 중이 아닐 때)
  function kbdNav(e) {
    if (e.altKey || e.ctrlKey || e.metaKey || !S.rows || !S.rows.length) return;
    const box = $('dj_tbl'); if (!box || !box.offsetParent) return;
    const a = document.activeElement; if (a && (/INPUT|TEXTAREA|SELECT/.test(a.tagName) || a.isContentEditable)) return;
    if (document.querySelector('.sheet:not([hidden]), .ppop, #djSh:not([hidden])')) return;
    let i = S.rows.findIndex(z => z.key === S.selKey);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault(); i = i < 0 ? 0 : Math.max(0, Math.min(S.rows.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)));
      S.selKey = S.rows[i].key; box.querySelectorAll('tr.sel').forEach(z => z.classList.remove('sel'));
      const tr = box.querySelector(`tr[data-i="${i}"]`); if (tr) { tr.classList.add('sel'); tr.scrollIntoView({ block: 'nearest' }); }
    } else if (e.key === 'Enter' && i >= 0) { e.preventDefault(); openPanel(S.rows[i]); }
    else if (e.key === 'Escape' && S.pk) { e.preventDefault(); closePanel(); }
  }
  const rowFor = pk => {
    if (!pk) return null;
    const r = (S.rows || []).find(z => z.key === pk.key && z.cx && z.cx.id === pk.cx); if (r) return r;
    const c = S.cx.items.find(z => z.id === pk.cx); if (!c) return null;
    const C = CI(c), [p, dn, h] = pk.key.split('|');
    return rowOf(c, C, mineMap(c), p, (dongOf(C, dn) || {}).dong || dn, h);
  };
  async function openPanel(x, mk) {
    if (S.ed) endEdit(S.tcx);
    const same = S.pk && S.pk.key === x.key && S.pk.cx === x.cx.id;
    S.pk = { key: x.key, cx: x.cx.id }; S.pkMk = !!mk; if (!same) S.pkRec = null;
    S.selKey = x.key;
    document.querySelectorAll('#dj_tbl tr.pk').forEach(z => z.classList.remove('pk'));
    const tr = document.querySelector(`#dj_tbl tr[data-key="${CSS.escape(x.key)}"]`); if (tr) tr.classList.add('pk');
    drawPanel(true);
    if (same && S.pkRec) return;
    try {   // 기록 전체(표에는 최근 3개만 있음)
      const j = await api(`/api/auth?action=hj&id=${encodeURIComponent(x.cx.id)}&key=${encodeURIComponent(x.key)}`);
      if (S.pk && S.pk.key === x.key) { S.pkRec = { ...EMPTY_REC(), ...(j.rec || {}) }; drawPanel(true); }
    } catch (e) { if (S.pk && S.pk.key === x.key) { S.pkRec = { ...EMPTY_REC(), err: e.message }; drawPanel(true); } }
  }
  function closePanel() { S.pk = null; S.pkRec = null; S.pkMk = false; const P = $('dj_rp'); if (P) P.remove(); const W = $('dj_wrap'); if (W) W.classList.remove('rpon'); document.querySelectorAll('#dj_tbl tr.pk').forEach(z => z.classList.remove('pk')); }
  // 입력 중이면(창 안에 커서) 다시 그리지 않음 — force: 고르기 버튼처럼 모양이 바뀌는 경우
  function pkRec(e) { const t = e.target, at = t && [...t.attributes].find(a => /^data-(tn|tm|tl|f)$/.test(a.name)); if (!at || !S.pk || !/INPUT|TEXTAREA/.test(t.tagName)) return; S.pkF = { key: S.pk.key, sel: `[${at.name}="${at.value}"]`, v: t.value, s: t.selectionStart, e: t.selectionEnd, t: Date.now() }; }
  // 10/29 떠 있는 입력창: 제목줄을 잡고 끌어 옮김 · 자리는 이 브라우저에 기억 (중개장부 모든 종류 같이 씀: window.RpWin)
  const winPlace = P => window.RpWin && window.RpWin.place(P);
  const winDrag = P => window.RpWin && window.RpWin.drag(P);
  function drawPanel(force) {
    if (!S.pk) { const P0 = $('dj_rp'); if (P0) P0.remove(); const W0 = $('dj_wrap'); if (W0) W0.classList.remove('rpon'); return; }
    const x = rowFor(S.pk); if (!x) return closePanel();
    let P = $('dj_rp');
    // 10/29 칸에 쓰고 있는 동안에는 다시 그리지 않음 (Tab으로 다음 칸에 갈 때 커서가 사라지던 것) → 입력창 밖으로 나가면 그때 그림
    if (P && P.contains(document.activeElement) && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) { S.pkDirty = true; if (!P._fo) { P._fo = true; P.addEventListener('focusout', e => { setTimeout(() => { if (S.pkDirty && !(P.contains(document.activeElement) && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName))) drawPanel(true); }, 0); }); } return; }
    S.pkDirty = false;
    if (!P) { P = document.createElement('aside'); P.id = 'dj_rp'; P.className = 'rpanel rpwin'; ($('dj_wrap') || document.body).appendChild(P); winPlace(P); }   // 10/29 표 위에 떠 있는 창 (표는 넓은 그대로)
    const cx = x.cx, r = x.r || {}, s = x.st, ro = LOCK(x), R0 = S.pkRec, lt = x.lt || {};
    // 10/28 매물 카드로만 있던 호도 같은 입력칸으로 (카드 가격을 보여 주고, 고치면 장부로 옮겨 적음 → 카드도 따라 바뀜)
    const pr = s.fromLs ? { ...Object.fromEntries(Object.entries(s.lsp || {}).filter(([, v]) => v)), ...Object.fromEntries(Object.entries(r.pr || {}).filter(([, v]) => v)) } : r.pr || {};
    const v = (id, val, ph, attr = '') => `<input class="rpi" data-f="${id}" value="${esc(val ?? '')}" placeholder="${esc(ph || '')}" ${attr} ${ro ? 'disabled' : ''}>`;
    const fld = (t, inner, cls = '') => `<label class="rpf ${cls}"><span>${t}</span>${inner}</label>`;
    const seg = (g, list, cur) => `<span class="rpseg" data-g="${g}">${list.map(([k, t]) => `<button type="button" data-v="${k}" aria-pressed="${cur === k || (Array.isArray(cur) && cur.includes(k))}" ${ro ? 'disabled' : ''}>${t}</button>`).join('')}</span>`;
    const sp = supPy(x), tels = (r.tels || []).length ? r.tels : [{ l: '소유자', n: '' }];
    // 매물 칸: 나와 있음 / 매물 카드(매물장)로만 있음 / 아직 아님(→ [매물장으로])
    const lsLive = (s.mine || []).find(z => z.status !== 'done');
    const row = (t, inner, cls = '') => `<div class="rpr ${cls}"><b>${t}</b><div class="rpv">${inner}</div></div>`;
    // 10/29 띄운 입력창(서식형, 시안 4): 두 칸씩 한 줄 · 매물 등록·해제는 표 맨 앞 ● · 거래는 하나만 · 보류·되돌리기·통화 기록 없음 · 옵션은 늘
    S.pkDraft = null;
    const isMk = !!s.src && !s.done, dis = ro ? 'disabled' : '', mdis = ro || !isMk ? 'disabled' : '', k0 = isMk ? (s.k || [])[0] || '' : '';
    const seg1 = (g, list, cur, d) => `<span class="rpseg" data-g="${g}">${list.map(([k, t]) => `<button type="button" data-v="${k}" aria-pressed="${cur === k}" ${d}>${t}</button>`).join('')}</span>`;
    const W = (f, val, w = 74, d = dis) => `<span class="wonw"><input class="rpi rpw" data-f="${f}" data-won value="${val ? esc(String(val)) : ''}" inputmode="numeric" style="width:${w}px" ${d}><i class="wonh">${esc(window.wonH ? window.wonH(val) : '')}</i></span>`;
    const F1 = (t, h, c = '') => `<div class="fr f1 ${c}"><b>${t}</b><div>${h}</div></div>`;
    const F2 = (t1, h1, t2, h2, c = '') => `<div class="fr f2 ${c}"><b>${t1}</b><div>${h1}</div><b>${t2}</b><div>${h2}</div></div>`;
    const prLb = { sale: '매매가', jeonse: '전세가', wolse: '보증·월세' }[k0] || '가격';
    const prH = k0 === 'sale' ? W('ps', pr.sale) : k0 === 'jeonse' ? W('pj', pr.jeonse) : k0 === 'wolse' ? `${W('pwd', pr.wd, 62)}<i class="u">/</i><input class="rpi rpw" data-f="pwr" data-won value="${pr.wr || ''}" inputmode="numeric" style="width:40px" ${dis}>` : '<i class="u">● 등록 후</i>';
    const mvq = ['즉시입주', '협의'].includes(r.moveIn) ? r.moveIn : '';
    const H = R0 && R0.hist ? R0.hist : (r.hist || []);
    const meta = [sp ? sp.v + '평' : '', x.a ? (+x.a).toFixed(2) + '㎡' : ''].filter(Boolean).join(' · ');
    const tels2 = (r.tels || []).length ? r.tels : [{ l: '소유자', n: '' }];
    // 10/29 저장 응답으로 입력창이 다시 그려져도(매물 카드와 이어진 호 등) 쓰고 있던 칸·글자·커서를 그대로 둠
    const ae = document.activeElement; let keep = null;
    if (P.contains(ae) && /INPUT|TEXTAREA/.test(ae.tagName)) { const at = [...ae.attributes].find(a => /^data-(tn|tm|tl|f)$/.test(a.name)); if (at) keep = { sel: `[${at.name}="${at.value}"]`, v: ae.value, s: ae.selectionStart, e: ae.selectionEnd }; }
    P.innerHTML = `<div class="rp-h" title="잡고 끌면 창이 옮겨집니다"><span class="grip">⠿</span><b>${S.cur === '__all' ? `<small>${esc(cx.name)}</small> ` : ''}${esc(UL(x))}</b>${meta ? `<span class="rptg">${esc(meta)}</span>` : ''}${isMk ? '<span class="mkb">● 매물</span>' : ''}<button type="button" class="rp-x" id="rp_x" aria-label="닫기 (Esc)">✕</button></div>
      ${ro ? `<p class="rpwarn">${S.L[cx.id] && S.L[cx.id].err ? esc(S.L[cx.id].err) : '요금제 단지 한도를 넘은 단지라 보기만 됩니다'}</p>` : ''}
      <div class="rpbody">
      <div class="rpsec">매물<small>${isMk ? '' : '표 맨 앞 ○ 를 누르면 매물로 등록됩니다'}</small></div>
      <div class="fgrp mk${isMk ? '' : ' off'}">
      ${F1('구분', `${seg1('msrc', [['mine', '내 물건'], ['other', '타부동산']], isMk ? s.src : '', mdis)}${isMk && s.src === 'other' ? ` <input class="rpi" data-f="of" value="${esc(s.office || '')}" maxlength="30" style="width:130px" ${dis}>` : ''}`)}
      ${F2('거래', seg1('mk', [['sale', '매매'], ['jeonse', '전세'], ['wolse', '월세']], k0, mdis), prLb, prH)}
      ${F2('방·욕실', `<input class="rpi rpsm" data-f="rm" value="${r.rm || ''}" inputmode="numeric" maxlength="2" ${dis}><i class="u">/</i><input class="rpi rpsm" data-f="bt" value="${r.bt || ''}" inputmode="numeric" maxlength="2" ${dis}>`, '관리비', `${W('mg', r.mg, 50)}<i class="u">만원</i>`)}
      ${F1('입주', `${seg1('mvq', [['즉시입주', '즉시'], ['협의', '협의']], mvq, dis)} <input class="rpi" data-f="mv" value="${mvq ? '' : esc(r.moveIn || '')}" maxlength="20" placeholder="날짜" style="width:110px" ${dis}>`)}
      </div>
      <div class="rpsec">호 정보</div>
      <div class="fgrp">
      ${F2('타입·평형', `${v('ty', lt.t || '', '', 'maxlength="8" style="width:44px" title="타입 (같은 라인 모두에)"')} ${v('py', lt.py || '', sp ? String(sp.v) : '', 'inputmode="numeric" maxlength="3" style="width:34px" title="평형 (같은 라인 모두에)"')}<i class="u">평</i>`, '향', `<select class="rpi" data-f="dir" style="width:72px" title="방향 (같은 라인 모두에)" ${dis}><option value="">-</option>${DIRS.map(d => `<option${x.dir === d ? ' selected' : ''}>${d}</option>`).join('')}</select>`)}
      ${F2('현상태', seg1('live', [['owner', '입주'], ['tenant', '임차'], ['empty', '공실']], r.live || '', dis), '만기', v('exp', /^\d{4}-\d{2}-\d{2}$/.test(r.exp || '') ? r.exp : '', '', 'type="date" style="width:118px"'))}
      ${F2('보증금', `${W('cd', r.cd, 70)}<i class="u">만원</i>`, '월세', `${W('cr', r.cr, 46)}<i class="u">만원</i>`)}
      ${F1('연락처', `<div class="rptels">${tels2.map((t, i) => `<div class="rptel"><input class="rpi lb" data-tl="${i}" list="hj_tl2" value="${esc(t.l)}" placeholder="구분" maxlength="10" ${dis}><input class="rpi" data-tm="${i}" value="${esc(t.m || '')}" placeholder="이름" maxlength="20" ${dis}><input class="rpi" data-tn="${i}" data-phone value="${esc(t.n)}" placeholder="번호" inputmode="tel" maxlength="20" ${dis}>${ro ? '<span></span>' : `<button type="button" class="rpdel" data-tdel="${i}" aria-label="지우기">✕</button>`}</div>`).join('')}</div>${ro || tels2.length >= 4 ? '' : '<button type="button" class="rplnk" id="rp_tadd">＋ 연락처 추가</button>'}<datalist id="hj_tl2">${TLB.map(t => `<option value="${t}">`).join('')}</datalist>`, 'tl')}
      ${F1('옵션', v('opt', r.opt || '', '', 'maxlength="200"'))}
      ${F1('챙길 것', v('imp', r.imp || '', '', 'maxlength="100" title="앞에 날짜를 쓰면 알림 (예: 11/15 중도금)"'))}
      ${F1('메모', `<textarea class="rpi" data-f="note" rows="2" maxlength="300" ${dis}>${esc(r.note || '')}</textarea>`)}
      ${F1('기록', ro ? '' : '<div class="rpin2 h"><input class="rpi" id="rp_hin" placeholder="통화 내용 · Enter" maxlength="500"><button type="button" class="rpb sm" id="rp_hadd">추가</button></div>')}
      </div>
      ${R0 && R0.err ? `<p class="rpn">${esc(R0.err)}</p>` : !R0 && !H.length ? '<p class="rpn">불러오는 중…</p>' : H.length ? `<ul class="rph">${H.map((h, i) => `<li class="e-${h.e}"><span class="t">${esc(fmtT(h.t).replace(new RegExp('^' + String(new Date().getFullYear()).slice(2) + '\\.'), ''))}</span><span class="hx">${esc(h.x)}${h.w ? ` <small>· ${esc(h.w)}</small>` : ''}${h.ed ? ` <small>(수정됨)</small>` : ''}</span>${R0 && h.e === 'memo' && !ro ? `<button type="button" class="x" data-rpmdel="${i}" aria-label="지우기">✕</button>` : ''}</li>`).join('')}</ul>` : ''}
      </div>
      <div class="rp-f"><span class="svd">✓ 자동 저장됨</span><button type="button" class="rpb y" id="rp_close">저장</button></div>`;
    winDrag(P);
    wirePanel(x, P, ro);
    if (!keep && S.pkF && S.pkF.key === x.key && Date.now() - S.pkF.t < 2500 && (!document.activeElement || document.activeElement === document.body)) keep = S.pkF;   // 표 전체가 다시 그려져 입력창이 새로 생긴 경우
    P.addEventListener('focusin', pkRec); P.addEventListener('input', pkRec);
    if (keep) { const n = P.querySelector(keep.sel); if (n) { if (n.value !== keep.v) { n.value = keep.v; n.dispatchEvent(new Event('input')); } n.focus(); try { n.setSelectionRange(keep.s, keep.e); } catch { /* 날짜 칸 등 */ } } }
  }
  function wirePanel(x, P, ro) {
    const cx = x.cx, r = x.r || {};
    $('rp_x').onclick = closePanel;
    { let done = false; const sv = e => { if (e && e.type === 'pointerdown') e.preventDefault(); if (done) return; done = true; const a = document.activeElement; if (a && P.contains(a) && a.blur) a.blur(); setTimeout(() => { closePanel(); toast('저장했습니다'); }, 150); }; $('rp_close').onpointerdown = sv; $('rp_close').onclick = sv; }   /* 누르는 순간 쓰던 칸이 저장되며 창이 다시 그려져도 닫히게 (pointerdown) */   // 10/29 [닫기] → [저장] (칸은 고칠 때마다 저장됨)
    if ($('rp_toled')) $('rp_toled').onclick = () => { const pk = S.pk; S.book = 'ledger'; S.focusKey = pk.key; S.selKey = pk.key; draw(); S.pk = pk; drawPanel(true); };
    P.onkeydown = e => { if (e.key === 'Escape') { e.preventDefault(); closePanel(); } };
    P.querySelectorAll('[data-ls]').forEach(b => b.onclick = () => S.host.openEdit(b.dataset.ls));
    if (ro) return;
    const one = $('rp_one'); if (one) one.onchange = () => { S.pkOne = one.checked; };
    const save = mut => saveRow(cx, x, mut);
    // 한 칸씩: 바뀌면 바로 저장 (Enter = 저장)
    P.querySelectorAll('[data-f]').forEach(el => {
      const f = el.dataset.f, orig = el.value;
      const go = () => {
        const val = el.value; if (val === el.dataset.last) return; el.dataset.last = val;
        if (f === 'ty' || f === 'py' || f === 'dir') return ltSave(cx, x, f, val, S.pkOne);
        if (f === 'cd' || f === 'cr') { const n = +(String(val).replace(/\D/g, '') || 0); return save(D => { D[f] = n || 0; if (n && !D.live) D.live = 'tenant'; }); }
        if (f === 'rm' || f === 'bt' || f === 'mg') { const n = +(String(val).replace(/\D/g, '') || 0); return save(D => { D[f] = n || 0; }); }   // 10/29 방·욕실·관리비
        if (f === 'mv') return save(D => { D.moveIn = val.trim(); });
        if (f === 'exp') return save(D => { D.exp = val; });
        if (f === 'ps' || f === 'pj' || f === 'pwd' || f === 'pwr') { const k = { ps: 'sale', pj: 'jeonse', pwd: 'wd', pwr: 'wr' }[f], n = +(String(val).replace(/\D/g, '') || 0); if (S.pkDraft) { S.pkDraft.vals[k] = n || 0; return; } return save(D => { D.pr = { ...D.pr, [k]: n || 0 }; }); }
        if (f === 'of') return save(D => { if (D.st.src) D.st = { ...D.st, office: val.trim() }; });
        if (f === 'imp' || f === 'opt' || f === 'note') return save(D => { D[f] = val.trim(); });
      };
      el.dataset.last = orig;
      el.onchange = go;
      if (el.tagName === 'INPUT') el.onkeydown = e => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); go(); el.blur(); } };
    });
    if (S.pkDraft) P.querySelectorAll('#rp_dpr [data-f]').forEach(i => i.addEventListener('input', () => { const k = { ps: 'sale', pj: 'jeonse', pwd: 'wd', pwr: 'wr' }[i.dataset.f]; S.pkDraft.vals[k] = +(i.value.replace(/\D/g, '') || 0); }));
    P.querySelectorAll('[data-g="mvq"] [data-v]').forEach(b => b.onclick = () => { const v0 = b.dataset.v, nv = (r.moveIn || '') === v0 ? '' : v0; save(D => { D.moveIn = nv; }); setTimeout(() => drawPanel(true), 0); });   // 10/29 입주 즉시·협의
    // 거주
    P.querySelectorAll('[data-g="live"] [data-v]').forEach(b => b.onclick = () => { if ((r.live || '') === b.dataset.v) return; save(D => { D.live = b.dataset.v; }); setTimeout(() => drawPanel(true), 0); });   // 이미 고른 것을 다시 눌러도 그대로
    // 연락처: 고치면 바로 저장
    const T = JSON.parse(JSON.stringify((r.tels || []).length ? r.tels : [{ l: '소유자', n: '' }]));
    const saveT = () => { const tels = T.map(t => ({ l: String(t.l || '').trim(), m: String(t.m || '').trim(), n: String(t.n || '').trim() })).map(t => t.m ? t : { l: t.l, n: t.n }).filter(t => t.n || t.m || (t.l && !plainL(t.l))); save(D => { D.tels = tels; }); };
    P.querySelectorAll('[data-tl]').forEach(i => { i.oninput = () => { T[+i.dataset.tl].l = i.value; }; i.onchange = saveT; });
    P.querySelectorAll('[data-tm]').forEach(i => { i.oninput = () => { T[+i.dataset.tm].m = i.value; }; i.onchange = saveT; i.onkeydown = e => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); i.blur(); } }; });   // 10/29 연락처 이름
    P.querySelectorAll('[data-tn]').forEach(i => { i.oninput = () => { T[+i.dataset.tn].n = i.value; }; i.onchange = () => { saveT(); setTimeout(() => drawPanel(true), 0); }; i.onkeydown = e => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); i.blur(); } }; });
    P.querySelectorAll('[data-tdel]').forEach(b => b.onclick = () => { T.splice(+b.dataset.tdel, 1); saveT(); setTimeout(() => drawPanel(true), 0); });
    if ($('rp_tadd')) $('rp_tadd').onclick = () => { const box = P.querySelector('.rptels'); box.insertAdjacentHTML('beforeend', `<div class="rptel"><input class="rpi lb" list="hj_tl2" data-tl="${T.length}" placeholder="구분" maxlength="10"><input class="rpi" data-tm="${T.length}" placeholder="이름" maxlength="20"><input class="rpi" data-tn="${T.length}" data-phone placeholder="번호" inputmode="tel" maxlength="20"><span></span></div>`); const row = box.lastElementChild, [l, m, n] = row.querySelectorAll('input'); T.push({ l: '', n: '' }); const i = T.length - 1; l.oninput = () => { T[i].l = l.value; }; m.oninput = () => { T[i].m = m.value; }; m.onchange = saveT; n.oninput = () => { T[i].n = n.value; }; n.onchange = () => { saveT(); setTimeout(() => drawPanel(true), 0); }; l.focus(); };
    P.querySelectorAll('[data-rpcall]').forEach(a => a.onclick = () => { const t = T[+a.dataset.rpcall]; actRow(cx, x, 'call', { label: (t && t.l) || '연락처' }); });
    // 매물 (나와 있는 호)
    const NONE = { src: '', k: [], hold: false, office: '' }, ORD = ['sale', 'jeonse', 'wolse'];
    P.querySelectorAll('[data-g="msrc"] [data-v]').forEach(b => b.onclick = () => { save(D => { D.st = { ...D.st, src: b.dataset.v, office: b.dataset.v === 'other' ? D.st.office || '' : '' }; }); setTimeout(() => drawPanel(true), 0); });
    P.querySelectorAll('[data-g="mk"] [data-v]').forEach(b => b.onclick = () => {   // 10/29 거래는 하나만
      const k = b.dataset.v; if ((x.st.k || [])[0] === k && (x.st.k || []).length === 1) return;
      save(D => { D.st = { ...D.st, k: [k] }; }); setTimeout(() => drawPanel(true), 0);
    });
    const hold = P.querySelector('[data-hold]'); if (hold) hold.onchange = () => save(D => { D.st = { ...D.st, hold: hold.checked }; });
    const toled = P.querySelector('[data-toled]'); if (toled) toled.onclick = () => { if (!confirm(`${UL(x)}를 매물에서 내릴까요?\n호 기록은 그대로 남고, 내린 기록도 남습니다.`)) return; save(D => { D.st = { ...NONE }; }); toast('매물에서 내렸습니다 (호 기록은 그대로)'); setTimeout(() => drawPanel(true), 0); };
    const card = P.querySelector('[data-card]'); if (card) card.onclick = () => cardFrom(x);
    // 매물장으로 (아직 안 나온 호): 받은 곳 · 거래 · 가격을 넣고 [매물장에 올리기]
    const mo = P.querySelector('[data-mkopen]'); if (mo) mo.onclick = () => { S.pkMk = true; S.pkDraft = null; drawPanel(true); const f = P.querySelector('#rp_dpr input'); if (f) f.focus(); };
    const dr = S.pkDraft;
    if (dr) {
      P.querySelectorAll('[data-g="dsrc"] [data-v]').forEach(b => b.onclick = () => { dr.src = b.dataset.v; drawPanel(true); if (dr.src === 'other' && $('rp_dof')) $('rp_dof').focus(); });
      if ($('rp_dof')) $('rp_dof').oninput = e => { dr.office = e.target.value; };
      P.querySelectorAll('[data-g="dk"] [data-v]').forEach(b => b.onclick = () => { const k = b.dataset.v; dr.k = dr.k.includes(k) ? dr.k.filter(z => z !== k) : [...dr.k, k].sort((a, z) => ORD.indexOf(a) - ORD.indexOf(z)); drawPanel(true); });
      const mx = P.querySelector('[data-mkx]'); if (mx) mx.onclick = () => { S.pkMk = false; S.pkDraft = null; drawPanel(true); };
      const tm = P.querySelector('[data-tomk]'); if (tm) tm.onclick = () => {
        if (!dr.k.length) return toast('매매·전세·월세 중 하나를 골라 주세요');
        const vals = {}, M = { ps: 'sale', pj: 'jeonse', pwd: 'wd', pwr: 'wr' };
        for (const i of P.querySelectorAll('#rp_dpr [data-f]')) vals[M[i.dataset.f]] = +(String(i.value).replace(/\D/g, '') || 0);
        if (!Object.values(vals).some(Boolean)) return toast('가격을 넣어 주세요 (만원 단위 숫자)');
        const st = { src: dr.src, k: [...dr.k], hold: false, office: dr.src === 'other' ? (dr.office || '').trim() : '' };
        save(D => { D.st = st; D.pr = { ...D.pr, ...vals }; });
        S.pkMk = false; S.pkDraft = null; toast(`${UL(x)}를 매물로 올렸습니다`); setTimeout(() => drawPanel(true), 0);
      };
    }
    // 상담 기록
    const add = () => { const t = $('rp_hin').value.trim(); if (!t) return $('rp_hin').focus(); $('rp_hin').value = ''; actRow(cx, x, 'memo', { text: t }); };
    if ($('rp_hadd')) { $('rp_hadd').onclick = add; $('rp_hin').onkeydown = e => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); add(); } }; }
    P.querySelectorAll('[data-rpundo]').forEach(b => b.onclick = () => { if (confirm('가장 최근 기록을 되돌릴까요? 그 전 상태로 돌아갑니다.')) actRow(cx, x, 'undo', {}); });
    P.querySelectorAll('[data-rpmdel]').forEach(b => b.onclick = () => { if (confirm('이 기록을 지울까요?')) actRow(cx, x, 'mdel', { i: +b.dataset.rpmdel }); });
  }
  // 타입·평형·방향 저장 (같은 라인 모두 / 이 호만) — 표의 ltAsk와 같은 저장
  async function ltSave(cx, x, ed, v, one) {
    const val = ed === 'py' ? +(String(v).replace(/\D/g, '') || 0) : ed === 'dir' ? String(v).trim() : String(v).trim().toUpperCase();
    const key = one ? `${x.pnu}|${x.dn}|h${x.ho}` : `${x.pnu}|${x.dn}|${x.line}`;
    const redo = () => (S.rows || []).filter(z => z.pnu === x.pnu && z.dn === x.dn && (one ? z.ho === x.ho : z.line === x.line)).forEach(z => redrawRow(cx, z.key));
    try {
      if (ed === 'dir') {
        if (val) cx.dir = { ...(cx.dir || {}), [key]: val }; else { cx.dir = { ...(cx.dir || {}) }; delete cx.dir[key]; }
        redo(); const j = await post({ op: 'dir', id: cx.id, key, v: val }); S.cx = { items: j.items, memos: j.memos }; const nn = j.items.find(z => z.id === cx.id); if (nn) cx.dir = nn.dir;
      } else {
        const lt = { ...((cx.lt || {})[key] || {}) }; if (ed === 'py') lt.py = val; else lt.t = val;
        cx.lt = { ...(cx.lt || {}), [key]: lt }; redo();
        const j = await post({ op: 'lt', id: cx.id, key, t: lt.t || '', py: lt.py || 0 }); S.cx = { items: j.items, memos: j.memos }; const nn = j.items.find(z => z.id === cx.id); if (nn) cx.lt = nn.lt;
      }
      redo(); toast(one ? `${US(x)}만 적었습니다` : `${DN(x.dn)} ${x.line}라인 모든 호에 적었습니다`);
    } catch (er) { toast(er.message); }
  }

  // ---------- 기록 (줄 아래로 펼침) ----------
  async function toggleHist(cx, key) {
    if (S.ed) endEdit(cx);
    const T0 = S.tcx, xr = (S.rows || []).find(z => z.key === key), cr = (xr && xr.cx) || cx;
    if (S.hist === key) { S.hist = null; S.histRec = null; return drawTable(T0); }
    S.hist = key; S.histRec = null; drawTable(T0);
    try { const j = await api(`/api/auth?action=hj&id=${encodeURIComponent(cr.id)}&key=${encodeURIComponent(key)}`); if (S.hist === key) { S.histRec = { ...EMPTY_REC(), ...(j.rec || {}) }; drawTable(T0); } }
    catch (e) { toast(e.message, 4000); }
  }
  function histRowHtml(x) {
    const R = S.histRec, h0 = R && R.hist[0], canUndo = h0 && Date.now() - Date.parse(h0.t) < 10 * 60e3;
    const oldMemo = S.cx.memos[memoKey(x.cx, x.pnu, x.dn, x.ho)];
    const ro = !!(S.L[x.cx.id] && S.L[x.cx.id].err);
    return `<div class="hbox">
      ${ro ? '' : `<div class="hjmemo"><input class="hjin sm" id="hr_in" placeholder="기록 남기기 (예: 집주인 통화 — 3월에 결정) · Enter" maxlength="500"><button type="button" class="btn dark sm" id="hr_add">추가</button></div>`}
      ${!R ? '<div class="loading">기록을 불러오는 중…</div>' : R.hist.length ? `<ul class="hjhist">${R.hist.map((h, i) => `<li class="e-${h.e}"><span class="t">${fmtT(h.t)}</span><span class="hx" data-hi="${i}">${esc(h.x)}${h.w ? ` <small class="ed">· ${esc(h.w)}</small>` : ''}${h.ed ? ` <small class="ed">(수정됨 ${fmtT(h.ed)})</small>` : ''}</span>${i === 0 && canUndo && !ro ? '<button type="button" class="un" data-undo>되돌리기</button>' : ''}${h.e === 'memo' && !ro ? `<button type="button" class="un" data-medit="${i}">고치기</button><button type="button" class="x" data-mdel="${i}" aria-label="지우기">×</button>` : ''}</li>`).join('')}</ul>` : '<p class="note">아직 기록이 없습니다.</p>'}
      ${oldMemo ? `<p class="note">예전 메모 (이 호를 처음 저장할 때 기록으로 옮겨집니다)</p>${memoListHtml(oldMemo.t, String(oldMemo.up).slice(2, 10).replace(/-/g, '.'), '')}` : ''}
      ${R && R.deal ? `<p class="note">최근 계약: ${KN[R.deal.k]} ${R.deal.k === 'wolse' ? `${wonFull(R.deal.a)}/${R.deal.r}` : wonFull(R.deal.a)} · ${esc(String(R.deal.d).slice(2).replace(/-/g, '.'))}${R.deal.by === 'other' ? ' · 타사' : ' · 내 계약'}</p>` : ''}
    </div>`;
  }
  // 상담 기록 창 (10/26): 줄 아래로 펼치지 않고 화면 오른쪽에 떠 있는 창 — 표가 밀리지 않음. 다른 줄의 [기록]을 누르면 창 안만 바뀜
  function drawHist(cx) {
    const x = S.hist && (S.rows || []).find(z => z.key === S.hist);
    let P = $('dj_hp');
    if (!x) { if (P) P.remove(); return; }
    if (!P) { P = document.createElement('aside'); P.id = 'dj_hp'; P.className = 'hpanel'; ($('dj_wrap') || document.body).appendChild(P); }
    const st = x.st, sub = [st.done ? '계약됨' : ofTxt(st), (st.k || []).map(k => KN[k]).join('·'), liveTxt(x)].filter(Boolean).join(' · ');
    P.innerHTML = `<div class="hp-h"><b>${S.cur === '__all' ? esc(x.cx.name) + ' ' : ''}${esc(UL(x))}</b><span>상담 기록${sub ? ' · ' + esc(sub) : ''}</span><button type="button" class="hp-x" id="hp_x" aria-label="닫기">×</button></div>${histRowHtml(x)}`;
    $('hp_x').onclick = () => { S.hist = null; S.histRec = null; drawTable(S.tcx || cx); };
    // 창 위치: 표 머리 높이에 맞춤 (위 단지 막대·탭을 가리지 않게)
    const tw = $('dj_tbw'), fz = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--fz')) || 1, th = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--toph')) || 60;
    if (tw && innerWidth > 700) P.style.top = Math.max(th + 12, Math.min(tw.getBoundingClientRect().top, innerHeight * .4)) / fz + 'px';
    wireHist(cx);
  }
  function wireHist(cx) {
    const x = S.rows.find(z => z.key === S.hist); if (!x) return;
    cx = x.cx || cx;
    const add = () => { const t = $('hr_in').value.trim(); if (!t) return $('hr_in').focus(); actRow(cx, x, 'memo', { text: t }); };
    if ($('hr_add')) { $('hr_add').onclick = add; $('hr_in').onkeydown = e => { if (e.key === 'Enter' && !e.isComposing) add(); }; }
    document.querySelectorAll('#dj_hp [data-undo]').forEach(b => b.onclick = () => { if (confirm('가장 최근 기록을 되돌릴까요? 그 전 상태로 돌아갑니다.')) actRow(cx, x, 'undo', {}); });
    document.querySelectorAll('#dj_hp [data-mdel]').forEach(b => b.onclick = () => { if (confirm('이 기록을 지울까요?')) actRow(cx, x, 'mdel', { i: +b.dataset.mdel }); });
    // 상담 기록 고치기 (직접 쓴 기록만 · 고친 시각이 붙음) — 10/26
    document.querySelectorAll('#dj_hp [data-medit]').forEach(b => b.onclick = () => {
      const i = +b.dataset.medit, sp = document.querySelector(`#dj_hp .hx[data-hi="${i}"]`), h = S.histRec && S.histRec.hist[i]; if (!sp || !h) return;
      sp.innerHTML = `<textarea class="hjin sm hed" maxlength="500" rows="2">${esc(h.x)}</textarea><button type="button" class="btn dark sm hsv">저장</button><button type="button" class="btn ghost sm hcn">취소</button>`;
      const ta = sp.querySelector('textarea'); ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length);
      const save = () => { const t = ta.value.trim(); if (!t) return toast('내용을 적어 주세요. 지우려면 × 를 눌러 주세요'); if (t === h.x) return drawTable(cx); actRow(cx, x, 'hedit', { i, text: t }); };
      sp.querySelector('.hsv').onclick = save; sp.querySelector('.hcn').onclick = () => drawTable(cx);
      ta.onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); save(); } if (e.key === 'Escape') drawTable(cx); };
    });
  }


  // ---------- 테스트 데이터 (주소에 ?seed=20 → 지금 단지에 20호 채우기 · ?seed=clear → 그 20호 지우기) ----------
  // 본인 계정의 장부에만 들어갑니다. 메모가 '[테스트]'로 시작하는 호만 지웁니다.
  async function seedTest(cx, mode) {
    const C = S.C[cx.id];
    if (mode === 'clear') {
      await loadLedger(cx, true);
      const ks = Object.entries((S.L[cx.id] || {}).units || {}).filter(([, r]) => String(r.note || '').startsWith('[테스트]')).map(([k]) => k);
      if (!ks.length) return toast('지울 테스트 데이터가 없습니다');
      if (!confirm(`${cx.name}의 테스트 데이터 ${ks.length}호를 지울까요?`)) return;
      for (const k of ks) { try { await hjPost({ id: cx.id, key: k, op: 'wipe' }); } catch { /* 다음 */ } }
      await loadLedger(cx, true); toast(`테스트 데이터 ${ks.length}호를 지웠습니다`); return drawComplex(cx);
    }
    if (!confirm(`${cx.name}에 테스트용 호 20개를 채울까요?\n(메모가 [테스트]로 시작하고, 주소 끝을 ?seed=clear 로 열면 지워집니다)`)) return;
    toast('테스트 데이터를 넣는 중입니다… (20호, 30초쯤)', 30000);
    const hos = [];
    const DS = (C.dongs || []).slice(0, 4), per = Math.ceil(20 / Math.max(1, DS.length));
    for (const d of DS) {
      let U = C.units[d.pnu + '|' + d.dong];
      if (!Array.isArray(U)) { try { U = (await api(`/api/units?pnu=${d.pnu}&dong=${encodeURIComponent(d.dong)}`)).units || []; } catch { U = []; } }
      const us = U.filter(u => u.flrGb !== '지하' && digits(u.ho));
      for (let i = 0; i < per && us.length; i++) hos.push([d, us[Math.floor((i + .5) * us.length / per)].ho]);
    }
    if (!hos.length) return toast('이 단지의 호 목록을 아직 받지 못했습니다. 동 정보가 다 받아진 뒤 다시 열어 주세요.', 5000);
    const day = n => new Date(Date.now() + 9 * 3600e3 + n * 864e5).toISOString().slice(0, 10);
    const T = n => [{ l: '소유자', n: `010-0000-${String(1000 + n)}` }];
    const E = { st: { src: '', k: [], hold: false, office: '' }, pr: { sale: 0, jeonse: 0, wd: 0, wr: 0 }, live: '', exp: '', moveIn: '', opt: '', tels: [], note: '' };
    const R = o => JSON.parse(JSON.stringify({ ...E, ...o, st: { ...E.st, ...(o.st || {}) }, pr: { ...E.pr, ...(o.pr || {}) } }));
    const cases = [
      [{ op: 'save', rec: R({ st: { src: 'mine', k: ['sale'] }, pr: { sale: 215000 }, live: 'owner', tels: T(1), note: '[테스트] 내 매매 · 주인 거주' }) }],
      [{ op: 'save', rec: R({ st: { src: 'mine', k: ['jeonse'] }, pr: { jeonse: 98000 }, live: 'empty', moveIn: day(14), exp: day(14), tels: T(2), note: '[테스트] 내 전세 · 공실 즉시' }) }],
      [{ op: 'save', rec: R({ st: { src: 'mine', k: ['wolse'] }, pr: { wd: 10000, wr: 350 }, live: 'tenant', exp: day(70), moveIn: day(70), tels: T(3), note: '[테스트] 내 월세 · 세입자 만기 후 입주' }) }],
      [{ op: 'save', rec: R({ st: { src: 'mine', k: ['sale', 'jeonse'] }, pr: { sale: 198000, jeonse: 95000 }, live: 'owner', tels: T(4), opt: '시스템에어컨 4대, 중문', note: '[테스트] 매매·전세 둘 다 가능' }) }],
      [{ op: 'save', rec: R({ st: { src: 'other', k: ['sale'], office: '○○공인' }, pr: { sale: 225000 }, live: 'owner', note: '[테스트] 타부동산 매매' }) }],
      [{ op: 'save', rec: R({ st: { src: 'other', k: ['jeonse'], office: '△△부동산' }, pr: { jeonse: 100000 }, live: 'empty', note: '[테스트] 타부동산 전세' }) }],
      [{ op: 'save', rec: R({ st: { src: 'other', k: ['wolse'], office: '□□공인' }, pr: { wd: 5000, wr: 280 }, note: '[테스트] 타부동산 월세' }) }],
      [{ op: 'save', rec: R({ st: { src: 'mine', k: ['sale'], hold: true }, pr: { sale: 230000 }, live: 'owner', tels: T(8), note: '[테스트] 보류 — 집주인 고민 중' }) }],
      [{ op: 'save', rec: R({ st: { src: 'mine', k: ['jeonse'] }, pr: { jeonse: 97000 }, tels: T(9), note: '[테스트] 내 전세 → 계약됨' }) }, { op: 'deal', deal: { k: 'jeonse', a: 96000, d: day(-3), mi: day(30), by: 'mine' } }],
      [{ op: 'save', rec: R({ st: { src: 'other', k: ['sale'], office: '○○공인' }, pr: { sale: 210000 }, note: '[테스트] 타사 매매 계약됨' }) }, { op: 'deal', deal: { k: 'sale', a: 208000, d: day(-10), mi: day(60), by: 'other', office: '○○공인' } }],
      [{ op: 'save', rec: R({ live: 'tenant', exp: day(50), tels: [{ l: '임차인', n: '010-0000-1011' }], note: '[테스트] 만기 임박 D-50 · 갱신 여부 미정' }) }],
      [{ op: 'save', rec: R({ live: 'tenant', exp: day(120), tels: [{ l: '임차인', n: '010-0000-1012' }, { l: '소유자', n: '010-0000-2012' }], note: '[테스트] 만기 4개월 전 · 집주인 매도 의향' }) }],
      [{ op: 'save', rec: R({ live: 'tenant', exp: day(-10), tels: T(13), note: '[테스트] 만기 지남 (확인 필요)' }) }],
      [{ op: 'save', rec: R({ live: 'tenant', exp: day(40), tels: T(14), note: '[테스트] 갱신됨 (계약갱신요구권)' }) }, { op: 'renew', how: 'right', amount: 92000 }],
      [{ op: 'save', rec: R({ live: 'tenant', exp: day(300), tels: T(15), note: '[테스트] 만기 전 이사 예정' }) }, { op: 'early', date: day(45) }],
      [{ op: 'save', rec: R({ live: 'owner', tels: [{ l: '소유자', n: '010-0000-1016' }, { l: '배우자', n: '010-0000-2016' }, { l: '관리인', n: '010-0000-3016' }], note: '[테스트] 연락처 3개' }) }],
      [{ op: 'save', rec: R({ note: '[테스트] 메모만 · 기록 2개' }) }, { op: 'memo', text: '집주인 통화 — 내년 봄 이사 계획' }, { op: 'memo', text: '아드님 연락처로도 가능' }],
      [{ op: 'save', rec: R({ st: { src: 'mine', k: ['sale'] }, pr: { sale: 205000 }, live: 'tenant', exp: day(200), opt: '확장, 올수리(2023)', tels: T(18), note: '[테스트] 세 끼고 매매' }) }],
      [{ op: 'save', rec: R({ st: { src: 'other', k: ['sale', 'jeonse'], office: '◇◇공인' }, pr: { sale: 220000, jeonse: 99000 }, note: '[테스트] 타부동산 매매·전세' }) }],
      [{ op: 'save', rec: R({ live: 'tenant', exp: day(400), tels: T(20), note: '[테스트] 임차인 거주 · 만기 먼 호' }) }],
    ];
    let n = 0;
    for (let i = 0; i < cases.length && i < hos.length; i++) {
      const [d, ho] = hos[i], key = keyOf(d.pnu, d.dong, ho);
      for (const step of cases[i]) { try { await hjPost({ id: cx.id, key, ...step }); } catch (e) { toast(e.message, 4000); } }
      n++;
    }
    await loadLedger(cx, true);
    toast(`테스트 데이터 ${n}호를 넣었습니다`, 4000);
    drawComplex(cx);
  }
  // ---------- 호 추가 · 엑셀로 받기 ----------
  function addHo(cx, v) {
    const C = S.C[cx.id], m = String(v || '').trim().match(/^(?:제)?([0-9A-Za-z가-힣]+?)\s*(?:동|-|\s)\s*(\d{2,5})\s*호?$/);
    if (!m) return toast('"102-1503"처럼 동-호로 적어 주세요');
    const d = dongOf(C, normD(m[1]));
    if (!d) return toast(`${m[1]}동을 이 단지에서 찾지 못했습니다`);
    const key = keyOf(d.pnu, d.dong, m[2]);
    S.extra = S.extra || {}; (S.extra[cx.id] = S.extra[cx.id] || []).includes(key) || S.extra[cx.id].push(key);
    resetF(); S.focusKey = key;
    drawTable(cx);
    const i = S.rows.findIndex(x => x.key === key); if (i >= 0) setTimeout(() => startEdit(cx, i, 'of'), 250);
  }
  function exportCsv(cx, rows) {
    const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const ALL = !!cx.all;
    const H = [...(ALL ? ['단지'] : []), '동', '호', '전용㎡', '방향', '상태', '매매가(만원)', '전세(만원)', '월세보증금(만원)', '월세(만원)', '꼭 챙길 것', '거주', '현 보증금(만원)', '현 차임(만원)', '만기', '입주', '옵션', '연락처', '메모', '최근 기록'];
    const lines = [H.map(q).join(',')];
    for (const x of rows) {
      const r = x.r || {}, s = x.st, pr = r.pr || {};
      const stt = s.done ? '계약됨' : s.src ? `${s.src === 'mine' ? '내 매물' : '타부동산' + (s.office ? `(${s.office})` : '')} ${(s.k || []).map(k => KN[k]).join('·')}${s.hold ? ' 보류' : ''}` : '';
      lines.push([...(ALL ? [x.cx.name] : []), x.dn, x.ho, x.a || '', x.dir, stt, pr.sale || '', pr.jeonse || '', pr.wd || '', pr.wr || '', r.imp || '', r.live ? LIVE[r.live] : '', r.cd || '', r.cr || '', r.exp || '', r.moveIn || '', r.opt || '', (r.tels || []).map(t => `${t.l} ${t.n}`).join(' / '), r.note || '', (r.hist && r.hist[0] && `${fmtT(r.hist[0].t)} ${r.hist[0].x}`) || ''].map(q).join(','));
    }
    const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${cx.name}_호실장부_${todayK()}.csv`; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    toast(`${rows.length}호를 엑셀 파일로 받았습니다. 연락처가 들어 있으니 보관에 주의해 주세요.`, 4500);
  }

  // ---------- 호실 장부 (api/_ledger.js) ----------
  // 단지를 열면 그 단지의 장부 요약(호별 상태·만기·히스토리 최근 3건)을 한 번에 받습니다.
  // 10/28 단지 종류: 건축물대장 용도에 아파트·공동주택이 없고 오피스텔·업무시설이면 오피스텔 (매물 카드 만들 때)
  const cxType = cx => { const ds = (CI(cx).dongs || []); return ds.length && !ds.some(d => /아파트|공동주택/.test(d.use || '')) && ds.some(d => /오피스텔|업무/.test(d.use || '')) ? '오피스텔' : '아파트'; };
  const keyOf = (pnu, dong, ho) => `${pnu}|${normD(dong)}|${normH(ho)}`;
  const KK = { sale: 'sale', jeonse: 'jeonse', wolse: 'wolse', presale: 'sale' };
  const KN = { sale: '매매', jeonse: '전세', wolse: '월세' };
  const CC = { sale: 'var(--sale)', jeonse: 'var(--jeonse)', wolse: 'var(--wolse)' }, LC = { sale: '#E7F0FC', jeonse: '#E3F3EA', wolse: '#FDECEC' };
  const DAY = 86400e3;
  const dleft = d => d ? Math.round((Date.parse(d + 'T00:00:00+09:00') - Date.now()) / DAY) : null;
  const EXPWIN = [-30, 183];                      // 만기 임박: 만기 6개월 전 ~ 만기 지나고 30일
  async function loadLedger(cx, force) {
    const L = S.L[cx.id];
    if (L && !force && (L.units || L.p)) return L.p;
    const st = S.L[cx.id] = { units: L && L.units || null, err: null };
    st.p = (async () => {
      try { const j = await api(`/api/auth?action=hj&id=${encodeURIComponent(cx.id)}`); st.units = j.units || {}; st.err = null; }
      catch (e) { st.units = null; st.err = e.message || '장부를 불러오지 못했습니다.'; st.code = e.code; }
      st.p = null;
      if (S.cur === '__all' && $('dj_cxBody')) drawAll();
      else if (S.cur === cx.id && S.C[cx.id] && S.C[cx.id].dongs && $('dj_cxBody')) drawComplex(cx);
      else drawTree();   // 다른 단지 장부가 들어오면 왼쪽 목록 숫자만
    })();
    return st.p;
  }
  const prShort = (k, pr) => !pr ? '' : k === 'sale' ? shortWon(pr.sale) : k === 'jeonse' ? shortWon(pr.jeonse) : k === 'wolse' ? (pr.wd || pr.wr ? `${shortWon(pr.wd)}/${pr.wr || ''}` : '') : '';
  // 한 호의 지금 상태: 장부가 먼저, 장부에 상태가 없으면 매물장 매물로
  function uState(cx, pnu, dong, ho, M) {
    const L = S.L[cx.id], r = L && L.units ? L.units[keyOf(pnu, dong, ho)] : null;
    const mine = mineAt(M, pnu, dong, ho), live = mine.find(x => x.status !== 'done');
    const o = { src: '', k: [], hold: false, done: false, exp: false, dl: null, pr: '', info: !!S.cx.memos[memoKey(cx, pnu, dong, ho)], r, mine };
    if (r) {
      o.info = o.info || !!((r.tels && r.tels.length) || r.note || r.live || r.exp || r.histN || r.opt);
      o.dl = dleft(r.exp); o.exp = o.dl != null && o.dl >= EXPWIN[0] && o.dl <= EXPWIN[1];
      // 10/26: 계약하면 '계약됨' 표시 없이 바로 빈 상태로 (계약 내용은 기록 · 만기는 알림으로)
      if (r.st && r.st.src) { o.src = r.st.src; o.k = r.st.k || []; o.hold = !!r.st.hold; o.office = r.st.office; o.pr = prShort(o.k[0], r.pr); return o; }
    }
    // 10/28: 관리장부에서 [관리장부로] 내린 호는 매물 카드가 '보류'로 남아 있어도 매물로 보지 않음 (장부에 기록이 있는 호)
    if (live && !(r && live.status === 'hold')) { o.src = 'mine'; o.k = [KK[live.kind] || 'sale']; o.hold = live.status === 'hold'; o.fromLs = true; o.lsp = { sale: live.kind === 'sale' ? live.price || 0 : 0, jeonse: live.kind === 'jeonse' ? live.deposit || 0 : 0, wd: live.kind === 'wolse' ? live.deposit || 0 : 0, wr: live.kind === 'wolse' ? live.rent || 0 : 0 }; o.prn = (live.kind === 'sale' || live.kind === 'presale' ? live.price : live.deposit) || 0; o.pr = live.kind === 'sale' ? shortWon(live.price) : live.kind === 'jeonse' ? shortWon(live.deposit) : live.kind === 'wolse' ? `${shortWon(live.deposit)}/${live.rent || ''}` : shortWon(live.pr); }
    else if (mine.length && !r) o.done = false;
    return o;
  }
  // 동 버튼 숫자: 매물(내 매물 + 타부동산, 색 구분은 표·현황판에서) · 만기 임박
  const dongLabel = (dong, n) => `${esc(dong || '건물')}${n.m + n.o ? `<em title="매물 (내 매물 ${n.m} · 타부동산 ${n.o})">${n.m + n.o}</em>` : ''}${n.e ? `<i class="xd" title="만기 임박">${n.e}</i>` : ''}`;
  function dongCounts(cx, d, M) {
    const L = S.L[cx.id], dd = normD(d.dong), hs = new Set();
    if (L && L.units) for (const k of Object.keys(L.units)) { const [p, dn, h] = k.split('|'); if (p === d.pnu && dn === dd) hs.add(h); }
    for (const k of M.keys()) { const [p, dn, h] = k.split('|'); if ((p === d.pnu || p === '*') && dn === dd) hs.add(h); }
    let m = 0, o = 0, e = 0;
    for (const h of hs) { const st = uState(cx, d.pnu, d.dong, h, M); if (!st.done && !st.hold) { if (st.src === 'mine') m++; else if (st.src === 'other') o++; } if (st.exp) e++; }
    return { m, o, e };
  }

  // ---------- 시세판 ----------
  // 한 줄 요약: 거래 많은 평형 3개의 최근 6개월 매매 중간값 + 전세가율
  function summary(C) {
    if (!C.trades) return '<span class="muted">실거래를 모으는 중…</span>';
    const since = (() => { const d = new Date(Date.now() + 9 * 3600e3); d.setUTCMonth(d.getUTCMonth() - 6); return `${d.getUTCFullYear()}.${String(d.getUTCMonth() + 1).padStart(2, '0')}`; })();
    const g = new Map();
    for (const r of C.trades) { if (!r.ex) continue; const k = Math.round(r.ex); let e = g.get(k); if (!e) g.set(k, e = { ex: k, s: [], j: [] }); if (r.kind === 'apt') e.s.push(r); else if (!r.rent && r.deposit) e.j.push(r); }
    const top = [...g.values()].filter(e => e.s.length).sort((a, b) => b.s.length - a.s.length).slice(0, 3).sort((a, b) => a.ex - b.ex);
    if (!top.length) return '<span class="muted">최근 1년 매매가 없습니다</span>';
    return top.map(e => { const ss = e.s.filter(r => r.date >= since).map(r => r.price), jj = e.j.filter(r => r.date >= since).map(r => r.deposit); const sm = med(ss.length ? ss : e.s.map(r => r.price)), jm = med(jj.length ? jj : e.j.map(r => r.deposit)); const jr = sm && jm ? Math.round(jm / sm * 100) : null; return `<span class="chip"><b>${e.ex}㎡</b> ${shortWon(sm)}${jr ? ` <small class="${jr >= 80 ? 'jr-hi' : jr >= 70 ? 'jr-mid' : ''}">전세 ${jr}%</small>` : ''}</span>`; }).join('');
  }
  function board(C) {
    if (!C.trades) return '<h2>단지 시세판<small>최근 1년 실거래</small></h2><div class="loading">국토교통부 실거래를 모으는 중…</div>';
    const T = C.trades;
    if (!T.length) return `<h2>단지 시세판<small>최근 1년 실거래</small></h2><div class="muted">${C.err ? esc(C.err) : '최근 1년 동안 신고된 거래가 없습니다.'}</div>`;
    const g = new Map();
    for (const r of T) { if (!r.ex) continue; const k = Math.round(r.ex); let e = g.get(k); if (!e) g.set(k, e = { ex: k, s: [], j: [], w: 0 }); if (r.kind === 'apt') e.s.push(r); else if (!r.rent && r.deposit) e.j.push(r); else e.w++; }
    const since = (m) => { const d = new Date(Date.now() + 9 * 3600e3); d.setUTCMonth(d.getUTCMonth() - m); return `${d.getUTCFullYear()}.${String(d.getUTCMonth() + 1).padStart(2, '0')}`; };
    const c6 = since(6);
    const rows = [...g.values()].filter(e => e.s.length || e.j.length).sort((a, b) => a.ex - b.ex).map(e => {
      const last = e.s[0];
      const s6 = e.s.filter(r => r.date >= c6).map(r => r.price), j6 = e.j.filter(r => r.date >= c6).map(r => r.deposit);
      const sm = med(s6.length ? s6 : e.s.map(r => r.price)), jm = med(j6.length ? j6 : e.j.map(r => r.deposit));
      const jr = sm && jm ? Math.round(jm / sm * 100) : null;
      return `<tr><td><b>${e.ex}㎡</b><small>${supPy({ a: e.ex }).v}평</small></td>
        <td>${last ? `<b>${shortWon(last.price)}</b><small>${esc(last.date.slice(2))} · ${esc(last.aptDong ? normD(last.aptDong) + '동 ' : '')}${esc(last.floor)}층</small>` : '-'}</td>
        <td>${sm ? shortWon(sm) : '-'}</td><td>${jm ? shortWon(jm) : '-'}</td>
        <td class="${jr >= 80 ? 'jr-hi' : jr >= 70 ? 'jr-mid' : ''}">${jr ? jr + '%' : '-'}</td>
        <td>${e.s.length}<small>전세 ${e.j.length}${e.w ? ` · 월세 ${e.w}` : ''}</small></td></tr>`;
    }).join('');
    const recent = T.slice(0, 8).map(r => { const k = r.kind === 'apt' ? ['s', '매매', shortWon(r.price)] : !r.rent ? ['j', '전세', shortWon(r.deposit)] : ['w', '월세', `${shortWon(r.deposit)}/${r.rent}`]; return `<div><span class="d">${esc(r.date)}</span><span class="k ${k[0]}">${k[1]}</span><span>${esc(r.aptDong ? normD(r.aptDong) + '동 ' : '')}${esc(r.floor)}층 · ${Math.round(r.ex)}㎡</span><span class="p">${k[2]}</span></div>`; }).join('');
    return `<h2>단지 시세판<small>최근 1년 국토교통부 실거래 · 중간값은 최근 6개월</small></h2>
      <div class="scroll"><table class="mtab"><thead><tr><th>전용</th><th>최근 매매</th><th>매매 중간</th><th>전세 중간</th><th>전세가율</th><th>매매 건수</th></tr></thead><tbody>${rows}</tbody></table></div>
      <div class="recent">${recent}</div>`;
  }

  // ---------- 내 매물 · 메모 ----------
  function mineMap(cx) {
    const pn = new Set(cx.places.map(p => p.pnu)), base = baseName(cx.name), m = new Map();
    // 10/28 오피스텔: 매물 카드에 동을 안 적었거나 다르게 적었어도, 그 필지에 건물이 하나뿐이면 그 건물로
    const ds = (S.C[cx.id] && S.C[cx.id].dongs) || (S.CL && S.CL[cx.id] && S.CL[cx.id].dongs) || [];
    const dnOf = p => { const d0 = normD(p.dong), c = ds.filter(d => d.pnu === p.pnu); return c.length === 1 && !c.some(d => normD(d.dong) === d0) ? normD(c[0].dong) : d0; };
    for (const x of items()) for (const p of (x.places && x.places.length ? x.places : [x])) {
      if (!p.dong && !p.ho) continue;
      const inCx = pn.has(p.pnu) || (base.length >= 4 && normName(p.bname || x.bname).startsWith(base));
      if (!inCx) continue;
      const k = `${pn.has(p.pnu) ? p.pnu : '*'}|${dnOf(p)}|${normH(p.ho)}`;
      (m.get(k) || m.set(k, []).get(k)).push(x);
    }
    return m;
  }
  const mineAt = (M, pnu, dong, ho) => M.get(`${pnu}|${normD(dong)}|${normH(ho)}`) || M.get(`*|${normD(dong)}|${normH(ho)}`) || [];
  function countMine(cx, d) { const M = mineMap(cx); let n = 0; for (const [k, v] of M) { const [p, dd] = k.split('|'); if ((p === d.pnu || p === '*') && dd === normD(d.dong)) n += v.filter(x => x.status !== 'done').length; } return n; }
  const memoKey = (cx, pnu, dong, ho) => `${cx.id}|${pnu}|${normD(dong)}|${normH(ho)}`;

  // ---------- 기다리는 동안 안내 (시간이 지날수록 문구가 바뀜) ----------
  const WAIT = [[0, '호 목록을 받는 중입니다'], [4, '공공데이터에서 동·호 정보를 받고 있어요'], [9, '세대가 많은 단지라 조금 걸립니다. 잠시만 기다려 주세요'], [18, '거의 다 왔어요. 처음 한 번만 오래 걸리고, 다음부터는 바로 열립니다'], [35, '공공데이터 서버가 느립니다. 조금만 더 기다려 주세요']];
  function waitBox(box, sub) {
    clearInterval(S.waitT);
    const t0 = Date.now();
    box.innerHTML = `<div class="dj-wait"><span class="spin"></span><div><b><span class="wm"></span><i class="dots"><i>.</i><i>.</i><i>.</i></i></b><small><span>${sub ? sub + ' · ' : ''}</span><span class="ws">0초</span></small></div></div>
      <div class="dj-skel">${Array.from({ length: 24 }, (_, i) => `<i style="animation-delay:${(i % 4) * .12 + Math.floor(i / 4) * .08}s"></i>`).join('')}</div>`;
    const wm = box.querySelector('.wm'), ws = box.querySelector('.ws');
    const tick = () => {
      if (!wm.isConnected) return clearInterval(S.waitT);
      const sec = (Date.now() - t0) / 1000;
      wm.textContent = WAIT.filter(w => sec >= w[0]).pop()[1]; ws.textContent = `${Math.floor(sec)}초`;
    };
    tick(); S.waitT = setInterval(tick, 1000);
  }
  // ---------- 층 × 라인 표 ----------
  async function drawGrid(cx) {
    const C = S.C[cx.id], box = $('dj_gridBox');
    if (!C.cur) { box.innerHTML = ''; return; }
    const [pnu, dong] = [C.cur.slice(0, 19), C.cur.slice(20)];
    let U = C.units[C.cur];
    // 단지 전체를 차례로 받는 중이면, 이 동이 준비될 때까지 기다림 (따로 요청하면 공공데이터 한도에 걸림)
    const scp = C.scan && C.scan.per[pnu];
    if (!U && scp && !scp.done && !scp.cached) { if (!box.querySelector('.dj-wait')) waitBox(box, `${dong} · 단지 전체를 차례로 받는 중`); return; }
    if (!U) {
      waitBox(box, dong);
      C.units[C.cur] = 'loading';
      try {
        // 큰 단지는 한 번에 다 못 받으면 서버가 받은 쪽을 기억해 두므로, 자동으로 몇 번 이어서 받습니다
        const qd = encodeURIComponent((scp && scp.names && scp.names.get(normD(dong))) || dong); // 저장된 동 이름 그대로 (101 / 101동 차이)
        let r0 = await api(`/api/units?pnu=${pnu}&dong=${qd}`);
        for (let k = 2; r0.partial && k <= 5; k++) {
          if (C.cur === `${pnu}|${dong}`) { const sub = `${dong} · 나눠 받는 중 ${k}/5`; clearInterval(S.waitT); waitBox(box, sub); }
          r0 = await api(`/api/units?pnu=${pnu}&dong=${qd}`);
        }
        let us = r0.units || [];
        C.partial = C.partial || {}; C.partial[C.cur] = !!r0.partial;
        // 건축물대장 표제부의 호 수보다 적게 오면, 필지 전체 호 목록에서 이 동을 한 번 더 모아 합칩니다
        const d = (C.dongs || []).find(x => x.pnu === pnu && x.dong === dong), want = d && (d.ho || d.hhld);
        if (want && us.length < want) {
          try {
            const all = ((await api(`/api/units?pnu=${pnu}`)).units || []).filter(u => normD(u.dong) === normD(dong));
            const seen = new Set(us.map(u => normH(u.ho)));
            all.forEach(u => { if (!seen.has(normH(u.ho))) { seen.add(normH(u.ho)); us.push(u); } });
          } catch { /* 합치기 실패는 무시 */ }
        }
        C.units[C.cur] = us; C.want = C.want || {}; C.want[C.cur] = want || 0;
      } catch (e) { C.units[C.cur] = 'error'; C.err = e.message || ''; }
      if (S.cur === cx.id && C.cur === `${pnu}|${dong}`) drawGrid(cx);
      return;
    }
    if (U === 'loading') { if (!box.querySelector('.dj-wait')) waitBox(box, dong); return; }
    clearInterval(S.waitT);
    // 실패하거나 일부만 받은 동은 '다시 불러오기'로 다시 시도 (큰 단지는 공공데이터가 느려 처음 한 번이 오래 걸릴 수 있음)
    const retry = () => { delete C.units[C.cur]; drawGrid(cx); };
    if (U === 'error') { box.innerHTML = `<div class="muted">호 목록을 불러오지 못했습니다. 큰 단지는 공공데이터 응답이 느려 처음 한 번이 오래 걸릴 수 있습니다.${C.err ? `<br><small>${esc(C.err).slice(0, 120)}</small>` : ''}<br><button type="button" class="lnk" id="dj_retry">다시 불러오기</button></div>`; $('dj_retry').onclick = retry; return; }
    // 지상층 · 숫자 호만
    const units = U.filter(u => u.flrGb !== '지하' && digits(u.ho)).map(u => { const h = +digits(normH(u.ho)); const fl = u.flr != null ? u.flr : Math.floor(h / 100); return { ho: u.ho, h, fl, line: h >= 100 ? h % 100 : h }; });
    if (!units.length) { box.innerHTML = `<div class="muted">${C.partial && C.partial[C.cur] ? '호 목록을 아직 다 받지 못했습니다.' : '이 동의 호 정보가 없습니다.'} <button type="button" class="lnk" id="dj_retry">다시 불러오기</button></div>`; $('dj_retry').onclick = retry; return; }
    const lines = [...new Set(units.map(u => u.line))].sort((a, b) => a - b);
    const floors = [...new Set(units.map(u => u.fl))].sort((a, b) => b - a);
    const at = new Map(units.map(u => [`${u.fl}|${u.line}`, u]));
    // 라인별 전용면적: 라인마다 가운데 층 한 호만 조회 (같은 라인은 보통 같은 평형)
    const LA = C.lines[C.cur] || (C.lines[C.cur] = {});
    // 호별 실제 전용면적 (동 단위로 한 번에) — 받기 전·실패 시에는 예전처럼 라인별 대표 면적
    C.areas = C.areas || {};
    const AR = C.areas[C.cur];
    const arOf = u => AR && typeof AR === 'object' ? AR[normH(u.ho)] || 0 : 0;
    const hasAR = AR && typeof AR === 'object' && units.some(u => arOf(u));
    // 라인마다 가장 많은 면적 = 라인 평형, 다른 호가 있으면 '외'
    const LM = {};
    if (hasAR) lines.forEach(l => {
      const cnt = new Map(); units.filter(u => u.line === l).forEach(u => { const a = arOf(u); if (a) cnt.set(a, (cnt.get(a) || 0) + 1); });
      const best = [...cnt.entries()].sort((a, b) => b[1] - a[1])[0];
      if (best) LM[l] = { a: best[0], mixed: [...cnt.keys()].some(a => Math.abs(a - best[0]) >= 1) };
    });
    // 평형 묶음(1㎡ 안쪽은 같은 평형)과 색 — 칸 아래 얇은 줄. 칸 바탕색(내 매물)과 겹치지 않는 색만 씀
    const ACOL = ['#9AA9B8', '#E58FC0', '#7B5BD6', '#5DB7C9', '#C9A26B', '#7F8C9A', '#B48BD9', '#E0A3A3'];
    const groups = [];
    if (hasAR) [...new Set(units.map(arOf).filter(Boolean))].sort((a, b) => a - b).forEach(a => { const g = groups.find(x => Math.abs(x.a - a) < 1); if (!g) groups.push({ a }); });
    const gOf = a => groups.findIndex(x => Math.abs(x.a - a) < 1);
    const lineEx = l => hasAR ? (LM[l] ? LM[l].a : 0) : LA[l];
    const M = mineMap(cx);
    const T = (C.trades || []).filter(r => r.kind === 'apt' && normD(r.aptDong) === normD(dong));
    const byFloor = new Map(); T.forEach(r => { const f = +r.floor; (byFloor.get(f) || byFloor.set(f, []).get(f)).push(r); });
    const RJ = (C.trades || []).filter(r => r.kind !== 'apt' && normD(r.aptDong) === normD(dong));
    RJ.forEach(r => { const f = +r.floor; (byFloor.get(f) || byFloor.set(f, []).get(f)).push(r); });
    // 라인 머리: 공급평 · 타입 · 방향 (누르면 라인 설정 창) — 10/26
    const head = `<tr><th></th>${lines.map(l => { const e = lineEx(l), lk = `${pnu}|${normD(dong)}|${l}`, dir = (cx.dir || {})[lk], lt = (cx.lt || {})[lk] || {}, sp = lt.py ? { v: lt.py } : e ? supPy({ a: e }) : null;
      return `<th class="ln" data-ln="${l}" title="눌러서 이 라인의 타입·공급평·방향 적기"><b>${String(l).padStart(2, '0')}라인${dir ? ` · ${esc(dir)}` : ''}</b>${sp ? `<span class="${sp.est ? 'est' : ''}">${sp.v}평</span>${lt.t ? ` · ${esc(lt.t)}` : ''}${hasAR && LM[l] && LM[l].mixed ? ' 외' : ''}` : e === 0 ? '-' : '…'}</th>`; }).join('')}<th class="ftr">이 층 실거래</th></tr>`;
    // 건물 외벽: 호가 있는 칸의 바깥쪽(왼·오른·위)에 진한 선
    const has = (f, l) => at.has(`${f}|${l}`);
    const body = floors.map(f => `<tr><th class="fl">${f}층</th>${lines.map(l => {
      const u = at.get(`${f}|${l}`); if (!u) return '<td class="sky"></td>';
      // 색 = 거래 종류(매매·전세·월세) · 꽉 채움 = 내 매물 · 테두리 = 타부동산 · 흐림 = 보류 · 회색✓ = 최근 계약 · 검은 점 = 만기 임박
      const st = uState(cx, pnu, dong, u.ho, M);
      let cls = '', sty = '';
      if (st.done) cls = 'k-done';
      else if (st.src) {
        const a = st.k[0], b = st.k[1] || a;
        cls = (st.src === 'mine' ? 's-mine' : 's-other') + (st.hold ? ' s-hold' : '');
        sty = ` style="--c1:${CC[a] || 'var(--navy)'};--c2:${CC[b] || 'var(--navy)'};--l1:${LC[a] || '#EEF1F4'};--l2:${LC[b] || '#EEF1F4'}"`;
      }
      const memo = st.info, pr = st.pr;
      const li = lines.indexOf(l), a = arOf(u), g = a ? gOf(a) : -1, lm = LM[l];
      const edge = [!has(f, lines[li - 1]) ? 'bL' : '', !has(f, lines[li + 1]) ? 'bR' : '', (floors.indexOf(f) === 0 || !has(floors[floors.indexOf(f) - 1], l)) ? 'bT' : ''].join(' ');
      const odd = a && lm && Math.abs(a - lm.a) >= 1 ? `<em>${supPy({ a }).v}평</em>` : '';
      return `<td class="${edge}"><button type="button" class="cell ${cls}"${sty} data-ho="${esc(u.ho)}" title="${esc(dong)} ${esc(u.ho)}${a ? ` · 전용 ${a}㎡ (${(a / PY).toFixed(1)}평)` : ''}">${esc(normH(u.ho))}${pr ? `<span class="pr">${esc(pr)}</span>` : ''}${st.exp ? `<i class="xdot" title="만기 ${st.dl >= 0 ? 'D-' + st.dl : '지남'}"></i>` : ''}${memo ? '<i class="mdot"></i>' : ''}${odd}${g >= 0 ? `<i class="abar" style="background:${ACOL[g % ACOL.length]}"></i>` : ''}</button></td>`;
    }).join('')}<td class="ftr">${(byFloor.get(f) || []).slice(0, 2).map(r => `<span class="${r.kind === 'apt' ? '' : 'j'}">${r.kind === 'apt' ? '매' : r.rent ? '월' : '전'} ${r.kind === 'apt' ? shortWon(r.price) : shortWon(r.deposit)} · ${Math.round(r.ex)}㎡ · ${esc(r.date.slice(2, 7))}</span>`).join('')}</td></tr>`).join('');
    const want = (C.want || {})[C.cur], got = U.filter(u => digits(u.ho)).length;
    const cnt = `<p class="note">건축물대장 호 ${got.toLocaleString()}개${want ? ` / 표제부 기준 ${want.toLocaleString()}호${got < want ? ' · 일부 호가 공공데이터에 없어 빈칸으로 보일 수 있습니다' : ''}` : ''}</p>`;
    const part = C.partial && C.partial[C.cur] ? '<div class="muted" style="margin-bottom:6px">공공데이터 응답이 느려 호 목록 일부만 받았습니다. <button type="button" class="lnk" id="dj_retry">나머지 다시 불러오기</button></div>' : '';
    const legend = `<div class="aleg">${groups.map((g, i) => `<span><i style="background:${ACOL[i % ACOL.length]}"></i>${supPy({ a: g.a }).v}평</span>`).join('')}${groups.length ? '' : AR === 'loading' ? '<span class="note">호별 면적을 불러오는 중…</span>' : ''}<span><u class="k-sale"></u>매매</span><span><u class="k-jeonse"></u>전세</span><span><u class="k-wolse"></u>월세</span><span class="note">꽉 채움 = 내 매물 · 테두리 = 타부동산 · 흐림 = 보류 · 회색✓ = 최근 계약 · ● 만기 임박</span></div>`;
    const ground = `<tr class="gnd"><th></th><td colspan="${lines.length}"><i></i></td><td class="ftr"></td></tr>`;
    box.innerHTML = part + cnt + legend + `<div class="scroll"><table class="grid bldg"><thead>${head}</thead><tbody>${body}${ground}</tbody></table></div>`;
    if ($('dj_retry')) $('dj_retry').onclick = retry;
    const LX = {}; lines.forEach(l => { LX[l] = lineEx(l); });
    box.querySelectorAll('th[data-ln]').forEach(th => th.onclick = () => linePop(cx, pnu, dong, +th.dataset.ln, lineEx(+th.dataset.ln), th));
    // 현황판 칸을 누르면 표의 그 호로 이동 (장부를 못 쓰면 예전 메모 창)
    box.querySelectorAll('[data-ho]').forEach(b => b.onclick = () => { const L = S.L[cx.id]; if (L && L.err) return openMemo(cx, pnu, dong, b.dataset.ho, units, LX, L.err); S.focusKey = keyOf(pnu, dong, b.dataset.ho); drawTable(cx); });
    if ($('dj_tbl') && $('dj_tbl').querySelector('.loading')) drawTable(cx);   // 호 목록이 막 준비됨 → 동 표 그리기
    // 호별 면적 받기 (동마다 한 번, 저장해 두면 다음부터 바로)
    if (AR === undefined) {
      C.areas[C.cur] = 'loading';
      const key = C.cur;
      api(`/api/units?pnu=${pnu}&dong=${encodeURIComponent(dong)}&areas=1`).then(j => { C.areas[key] = j.areas && Object.keys(j.areas).length ? j.areas : {}; }).catch(() => { C.areas[key] = {}; })
        .then(() => { if (S.cur === cx.id && C.cur === key) drawGrid(cx); });
    }
    if (hasAR || AR === 'loading') return; // 라인별 대표 면적 조회는 호별 면적을 못 받았을 때만
    // 라인 면적 채우기 (아직 없는 라인만, 3개씩)
    const need = lines.filter(l => LA[l] === undefined);
    if (need.length && !C.lineBusy) {
      C.lineBusy = true;
      const jobs = need.map(l => { const us = units.filter(u => u.line === l).sort((a, b) => a.fl - b.fl); return [l, us[us.length >> 1]]; });
      let i = 0;
      await Promise.all([0, 1, 2].map(async () => { while (i < jobs.length) { const [l, u] = jobs[i++]; LA[l] = await exArea(pnu, dong, u.ho).catch(() => 0) || 0; } }));
      C.lineBusy = false;
      if (S.cur === cx.id && C.cur === `${pnu}|${dong}`) drawGrid(cx);
    }
  }
  async function exArea(pnu, dong, ho) {
    const j = await api(`/api/units?pnu=${pnu}&dong=${encodeURIComponent(dong)}&ho=${encodeURIComponent(ho)}`);
    const rows = (j.area && j.area.ok && j.area.data) || [];
    const ex = rows.filter(r => /전유/.test(r.gb || '')).reduce((a, r) => a + (r.area || 0), 0);
    return ex ? Math.round(ex * 100) / 100 : 0;
  }

  // ---------- 메모 기록: 쓸 때마다 날짜·시간이 붙어 맨 위에 쌓임 ----------
  // 저장 형식(예전 메모와 호환): "[26.10.24 14:30] 내용" 줄들을 최신순으로 이어 붙인 글. 날짜 없는 예전 메모는 한 덩어리로 맨 아래
  const MEMO_HEAD = /^\[(\d{2}\.\d{2}\.\d{2} \d{2}:\d{2}|예전 메모)\] ?/;
  const memoParse = s => { s = String(s || '').trim(); if (!s) return []; return s.split(/\n(?=\[(?:\d{2}\.\d{2}\.\d{2} \d{2}:\d{2}|예전 메모)\] )/).map(p => { const m = p.match(MEMO_HEAD); return m ? { t: m[1] === '예전 메모' ? '' : m[1], x: p.slice(m[0].length).trim() } : { t: '', x: p.trim() }; }).filter(e => e.x); };
  const memoJoin = a => a.map(e => e.t ? `[${e.t}] ${e.x}` : a.length > 1 ? `[예전 메모] ${e.x}` : e.x).join('\n'); // 날짜 없는 예전 메모도 경계를 표시해 섞이지 않게
  const memoNow = () => { const d = new Date(Date.now() + 9 * 3600e3), p = n => String(n).padStart(2, '0'); return `${String(d.getUTCFullYear()).slice(2)}.${p(d.getUTCMonth() + 1)}.${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`; };
  const memoAdd = (s, text) => memoJoin([{ t: memoNow(), x: String(text).trim() }, ...memoParse(s)]);
  const memoListHtml = (s, old, delAttr) => { const a = memoParse(s); return a.length ? `<ul class="mlog">${a.map((e, i) => `<li><span class="mt">${e.t ? esc(e.t) : `예전 메모${old ? ' · ' + esc(old) : ''}`}</span><span class="mx">${esc(e.x)}</span>${delAttr ? `<button type="button" ${delAttr}="${i}" aria-label="이 메모 지우기">×</button>` : ''}</li>`).join('')}</ul>` : ''; };
  // ---------- 호 상세 (예전 방식: 장부를 쓸 수 없을 때 — 중개사무소 확인 전·암호화 설정 전) ----------
  async function openMemo(cx, pnu, dong, ho, units, LA, why) {
    const C = S.C[cx.id], u = units.find(x => x.ho === ho) || {};
    const M = mineMap(cx), mine = mineAt(M, pnu, dong, ho);
    const key = memoKey(cx, pnu, dong, ho), memo = S.cx.memos[key];
    const trades = (C.trades || []).filter(r => normD(r.aptDong) === normD(dong) && +r.floor === u.fl);
    const lineEx = LA[u.line];
    $('djShTitle').textContent = [DN(normD(dong)), normH(ho) + '호'].filter(Boolean).join(' ');
    const render = (info) => {
      $('djShBody').innerHTML = `${why ? `<div class="hjwarn">호실 장부를 쓸 수 없어 메모만 보여 드립니다. ${esc(why)}</div>` : ''}
        <div class="info"><div><small>전용면적</small><b>${info.ex ? `${info.ex}㎡ (${(info.ex / PY).toFixed(1)}평)` : info.loading ? '불러오는 중…' : '-'}</b></div><div><small>공동주택 공시가격</small><b>${info.price ? `${shortWon(Math.round(info.price / 10000))}원` : info.loading ? '…' : '-'}</b>${info.year ? `<span class="note"> ${info.year}년</span>` : ''}</div></div>
        ${mine.length ? mine.map(x => `<a class="mine" href="#" data-edit="${esc(x.id)}"><span class="kd ${x.kind}">${KIND[x.kind]}</span><b>${esc(x.kind === 'sale' ? shortWon(x.price) : x.kind === 'jeonse' ? shortWon(x.deposit) : x.kind === 'wolse' ? `${shortWon(x.deposit)}/${x.rent || ''}` : shortWon(x.pr))}</b><span class="muted">${x.status === 'done' ? '거래완료' : x.status === 'hold' ? '보류' : '진행 중'}${x.no ? ' · ' + esc(x.no) : ''}</span><em>매물 열기 ›</em></a>`).join('') : ''}
        <button class="btn main" type="button" id="djAdd">＋ 이 호로 매물 등록</button>
        <div><b>호별 메모</b> <span class="note">쓸 때마다 날짜·시간이 붙어 쌓입니다</span>
          <textarea class="in" id="dj_memoIn" rows="2" maxlength="500" placeholder="예: 집주인 매도 의향 있음(내년 봄), 확장·올수리, 세입자 만기 27.03"></textarea>
          <div style="display:flex;gap:8px;margin-top:8px"><button class="btn dark" id="dj_memoSave" type="button" style="flex:1">메모 추가</button></div>
          ${memoListHtml(memo ? memo.t : '', memo ? String(memo.up).slice(2, 10).replace(/-/g, '.') : '', 'data-mdel')}
          <p class="note">메모는 이 계정으로 로그인했을 때만 보입니다. 집주인 이름·연락처 같은 개인정보는 중개 업무에 필요한 만큼만 적어 주세요.</p></div>
        <div><b>${u.fl}층 실거래</b> <span class="note">최근 1년 · 같은 면적은 노란 테두리</span>
          <div class="tl">${trades.length ? trades.map(r => `<div class="${lineEx && Math.abs(r.ex - lineEx) < 1 ? 'same' : ''}"><span class="note">${esc(r.date)}</span><span>${r.kind === 'apt' ? '매매' : r.rent ? '월세' : '전세'} · ${Math.round(r.ex * 10) / 10}㎡</span><span class="p">${r.kind === 'apt' ? shortWon(r.price) : r.rent ? `${shortWon(r.deposit)}/${r.rent}` : shortWon(r.deposit)}</span></div>`).join('') : '<div class="note">이 층의 최근 1년 거래가 없습니다. (실거래는 동·층까지만 공개됩니다)</div>'}</div></div>`;
      $('dj_memoSave').onclick = () => { const t = $('dj_memoIn').value.trim(); if (!t) return $('dj_memoIn').focus(); saveMemo(cx, key, memoAdd(memo ? memo.t : '', t)); };
      $('djShBody').querySelectorAll('[data-mdel]').forEach(b => b.onclick = () => { if (!confirm('이 메모를 지울까요?')) return; const a = memoParse(memo ? memo.t : ''); a.splice(+b.dataset.mdel, 1); saveMemo(cx, key, memoJoin(a)); });
      $('djAdd').onclick = () => { closeSheet(); S.host.openAdd(pnu, normD(dong), normH(ho)); };
      $('djShBody').querySelectorAll('[data-edit]').forEach(a => a.onclick = e => { e.preventDefault(); closeSheet(); S.host.openEdit(a.dataset.edit); });
    };
    $('djSheet').hidden = false; document.body.style.overflow = 'hidden';
    render({ loading: true, ex: lineEx || null });
    try {
      const j = await api(`/api/units?pnu=${pnu}&dong=${encodeURIComponent(dong)}&ho=${encodeURIComponent(ho)}`);
      const rows = (j.area && j.area.ok && j.area.data) || [];
      const ex = rows.filter(r => /전유/.test(r.gb || '')).reduce((a, r) => a + (r.area || 0), 0);
      const pr = j.price && j.price.ok && j.price.data;
      if (!$('djSheet').hidden) render({ ex: ex ? Math.round(ex * 100) / 100 : lineEx || null, price: pr && pr.price, year: pr && pr.year });
    } catch { if (!$('djSheet').hidden) render({ ex: lineEx || null }); }
  }
  // ---------- 호실 장부 공용 도구 ----------
  const DIRS = ['남', '남동', '남서', '동', '서', '북', '북동', '북서'];
  const TLB = ['소유자', '배우자', '세입자', '가족', '관리인', '기타'];
  const EMPTY_REC = () => ({ st: { src: '', k: [], hold: false, office: '' }, pr: { sale: 0, jeonse: 0, wd: 0, wr: 0 }, ar: 0, live: '', exp: '', moveIn: '', rm: 0, bt: 0, mg: 0, opt: '', tels: [], note: '', imp: '', impd: '', cd: 0, cr: 0, mk: '', deal: null, hist: [] });
  // '8억 5천' · '8억5000' · '8.5억' · '85000' · '5천' → 만원
  function parseMan(v) {
    const s = String(v || '').replace(/[,\s원]/g, '').replace(/만$/, '');
    if (!s) return 0;
    let m = s.match(/^(\d+(?:\.\d+)?)억(?:(\d+(?:\.\d+)?)(천)?)?$/);
    if (m) return Math.round(parseFloat(m[1]) * 10000 + (m[2] ? parseFloat(m[2]) * (m[3] ? 1000 : 1) : 0));
    m = s.match(/^(\d+(?:\.\d+)?)천$/); if (m) return Math.round(parseFloat(m[1]) * 1000);
    m = s.match(/^\d+$/); return m ? +s : NaN;
  }
  const manTxt = m => !m ? '' : m >= 10000 ? `${Math.floor(m / 10000)}억${m % 10000 ? ' ' + (m % 10000) : ''}` : String(m);
  const wonFull = m => !m ? '' : m >= 10000 ? `${Math.floor(m / 10000)}억${m % 10000 ? ' ' + (m % 10000).toLocaleString() + '만' : ''}` : `${m.toLocaleString()}만`;
  const fmtT = iso => { const d = new Date(Date.parse(iso) + 9 * 3600e3), p = n => String(n).padStart(2, '0'); return `${String(d.getUTCFullYear()).slice(2)}.${p(d.getUTCMonth() + 1)}.${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`; };
  const todayK = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
  const hjPost = body => api('/api/auth?action=hj', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const fieldsOf = r => JSON.parse(JSON.stringify({ st: r.st, pr: r.pr, ar: r.ar || 0, live: r.live, exp: r.exp, moveIn: r.moveIn, rm: r.rm || 0, bt: r.bt || 0, mg: r.mg || 0, opt: r.opt, tels: r.tels, note: r.note, imp: r.imp || '', cd: r.cd || 0, cr: r.cr || 0, mk: r.mk || '' }));

  async function saveMemo(cx, key, text) {
    try {
      const j = await post({ op: 'memo', id: cx.id, key, text: text.trim() });
      S.cx = { items: j.items, memos: j.memos };
      toast(text.trim() ? '메모를 저장했습니다' : '메모를 지웠습니다');
      closeSheet(); drawGrid(cx);
    } catch (e) { toast(e.message, 3500); }
  }
  function closeSheet() { const f = S.onClose; S.onClose = null; $('djSheet').hidden = true; document.body.style.overflow = ''; if (f) f(); }

  // 매물관리에서 방향을 넣어 단지관리 라인 방향이 바뀌었을 때 (서버가 cxDirty로 알려 줌) 단지 목록만 다시 받음
  async function reloadCx(fresh) { if (!S.loaded) return; if (fresh) S.L = {}; try { const cx = await api('/api/auth?action=cx'); S.cx = { items: cx.items || [], memos: cx.memos || {} }; refresh(); } catch { /* 다음에 열 때 */ } }
  return { mount, refresh, add, goto, reloadCx };
})();
