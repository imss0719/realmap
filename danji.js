// 리얼맵 단지 장부 (PRO 회원 전용)
// 자주 보는 아파트 단지를 등록해 두고, 동별 '층 × 라인' 표에서 내 매물·호별 메모·층별 실거래를 한눈에 봅니다.
// 매물장(listings.html) 안에서 '단지 모드'로 열립니다: Danji.mount(요소, host) · Danji.refresh() · Danji.add(PNU)
window.Danji = (() => {
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const KIND = { sale: '매매', jeonse: '전세', wolse: '월세', presale: '분양권' };
  const PY = 3.3058;
  const S = { boardOpen: (() => { try { return localStorage.getItem('rm.djboard') === '1'; } catch { return false; } })(), cx: { items: [], memos: {} }, cur: null, C: {}, results: null, adding: false, el: null, host: null, loaded: false };
  async function api(url, opt) {
    const r = await fetch(url, { credentials: 'same-origin', ...opt });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.ok === false) { const e = new Error(j.message || '잠시 연결이 원활하지 않습니다.'); e.code = j.error; throw e; }
    return j;
  }
  const post = (body) => api('/api/auth?action=cx', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const toast = (msg, ms) => S.host.toast(msg, ms);
  const shortWon = man => !man ? '' : man >= 10000 ? `${(man / 10000).toFixed(man % 10000 ? 1 : 0).replace(/\.0$/, '')}억` : `${Math.round(man).toLocaleString()}만`;
  const med = a => { if (!a.length) return null; a = [...a].sort((x, y) => x - y); const m = a.length >> 1; return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; };
  const digits = s => String(s || '').replace(/\D/g, '');
  // 동 이름 비교: '제101동'·'101동'·'101' 은 같게, 'T402동'과 '402동'은 다르게 (숫자만 비교하면 섞임)
  const normD = s => String(s || '').replace(/\s/g, '').replace(/^제/, '').replace(/동$/, '').toUpperCase();
  const normH = s => digits(s) || String(s || '').replace(/\s|호$/g, '');
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
    draw();
  }
  function refresh() { if (S.loaded && S.el && S.el.offsetParent !== null) draw(); }
  async function add(pnu) { while (!S.loaded) await new Promise(r => setTimeout(r, 150)); await addComplex({ pnu }); }
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
    } catch (e) { toast(e.message || '추가하지 못했습니다', 4000); }
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
      <input class="find" id="dj_aq" type="search" placeholder="예: 마포래미안푸르지오, 아현동 777" autocomplete="off">
      <div class="res" id="dj_ares"></div>
      <p class="note">리얼맵 지도에서 아파트를 누른 뒤 '단지 장부에 추가'를 눌러도 됩니다. 1단지·2단지처럼 지번이 여러 개인 단지는 담은 뒤 '필지 추가'로 나머지 지번을 넣어 주세요.</p></div>`;
  }
  function drawAdd() {
    const el = $('dj_ares'); if (!el) return;
    el.innerHTML = S.results == null ? '' : S.results.length ? S.results.map((r, i) => `<button type="button" data-r="${i}"><b>${esc(r.t)}</b><small>${esc(r.s)}</small></button>`).join('') : '<div class="muted">검색 결과가 없습니다.</div>';
    el.querySelectorAll('[data-r]').forEach(b => b.onclick = () => { const r = S.results[+b.dataset.r]; addComplex({ lat: r.lat, lng: r.lng }, S.adding === 'place' ? S.cur : null); });
  }

  // ---------- 화면 ----------
  function draw() {
    const W = $('dj_wrap'); if (!W) return;
    const chips = `<div class="chips">${S.cx.items.map(c => `<button type="button" data-cx="${c.id}" aria-pressed="${c.id === S.cur && !S.adding}">${esc(c.name)}</button>`).join('')}<button type="button" class="add" id="dj_addBtn" aria-pressed="${S.adding === true}">＋ 단지 추가</button></div>`;
    if (S.adding || !S.cx.items.length) {
      W.innerHTML = chips + addBox(S.adding === 'place' ? S.cur : null) + (S.cx.items.length ? '' : `<div class="empty"><b>자주 보는 단지를 담아 보세요</b>동별로 층과 라인을 펼쳐 놓고, 내 매물·호별 메모·층별 실거래를 한 장에서 봅니다.</div>`);
      wireChips(); const q = $('dj_aq'); q.onkeydown = e => { if (e.key === 'Enter') search(q.value.trim()); }; q.focus(); drawAdd(); return;
    }
    const cx = S.cx.items.find(c => c.id === S.cur) || S.cx.items[0]; S.cur = cx.id;
    W.innerHTML = chips + `<div id="dj_cxBody"></div>`;
    wireChips();
    drawComplex(cx);
  }
  function wireChips() {
    document.querySelectorAll('[data-cx]').forEach(b => b.onclick = () => { S.cur = b.dataset.cx; S.adding = false; draw(); });
    $('dj_addBtn').onclick = () => { S.adding = S.adding === true ? false : true; S.results = null; draw(); };
  }

  // 필지 하나의 아파트 동 목록 (건축물대장 표제부, 상가·관리동 등 제외)
  async function dongsOf(pnu) {
    try {
      const b = await api(`/api/building?pnu=${pnu}`);
      return ((b.titles && b.titles.data) || []).filter(t => t.mainAtch !== '부속건축물' && t.dong && /\d/.test(t.dong) && !/상가|관리|경로|어린이|커뮤니티|주민|근린/.test(t.dong + (t.use || '')))
        .map(t => ({ pnu, dong: String(t.dong).trim(), grnd: t.grnd, ho: t.ho, hhld: t.hhld, use: t.use, apr: t.useApr }));
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
  function drawComplex(cx) {
    const C = S.C[cx.id];
    if (!C) { loadComplex(cx); $('dj_cxBody').innerHTML = '<div class="card loading">단지 정보를 불러오는 중…</div>'; return; }
    const hhld = (C.dongs || []).reduce((a, d) => a + (d.hhld || d.ho || 0), 0);
    const apr = (C.dongs || []).map(d => d.apr).filter(Boolean).sort()[0];
    const open = S.boardOpen;
    $('dj_cxBody').innerHTML = `
      <div class="card hdc"><div class="hd"><div class="t"><b>${esc(cx.name)}</b>
        <span class="muted">${C.dongs ? `${C.dongs.length}개 동${hhld ? ` · ${hhld.toLocaleString()}세대` : ''}${apr ? ` · ${esc(String(apr).slice(0, 4))}년` : ''}` : '동 정보를 불러오는 중…'}</span></div>
        <div class="acts"><button class="btn ghost sm" id="dj_ren" type="button">이름 바꾸기</button><button class="btn ghost sm" id="dj_delCx" type="button">빼기</button></div></div>
        <div class="sum">${summary(C)}<button type="button" class="lnk" id="dj_bt">${open ? '시세 접기 ▴' : '시세 자세히 ▾'}</button></div>
        ${open ? `<div id="dj_board">${board(C)}</div>` : ''}</div>
      <div class="card gcard">
        <div class="dongs" id="dj_dongs">${(C.dongs || []).map(d => { const k = d.pnu + '|' + d.dong; const n = countMine(cx, d); const sp = C.scan && C.scan.per[d.pnu], wt = !!sp && !sp.done && !sp.cached && !Array.isArray(C.units[k]); return `<button type="button" data-dong="${esc(k)}" aria-pressed="${k === C.cur}" class="${n ? 'has' : ''}${wt ? ' wait' : ''}">${esc(d.dong)}${n ? `<em>${n}</em>` : ''}</button>`; }).join('') || (C.dongs ? '<span class="muted">동 정보가 없습니다.</span>' : '')}</div>
        <div class="dj-scanbar" id="dj_scan" hidden></div>
        <div id="dj_gridBox"></div>
        <div class="lgd"><span><i style="background:var(--sale)"></i>내 매물 매매</span><span><i style="background:var(--jeonse)"></i>전세</span><span><i style="background:var(--wolse)"></i>월세</span><span><i style="background:#E3E8ED"></i>거래완료</span><span><i style="background:var(--gold);border-radius:50%"></i>메모</span><span><i style="background:#FFF6D6"></i>이 층 실거래(1년)</span><button type="button" class="lnk" id="dj_addPl">빠진 동이 있나요?</button></div>
      </div>`;
    $('dj_bt').onclick = () => { S.boardOpen = !S.boardOpen; try { localStorage.setItem('rm.djboard', S.boardOpen ? '1' : ''); } catch { /* 무시 */ } drawComplex(cx); };
    $('dj_addPl').onclick = () => { S.adding = 'place'; S.results = null; draw(); };
    $('dj_ren').onclick = async () => { const nm = prompt('단지 이름', cx.name); if (!nm || nm === cx.name) return; try { const j = await post({ op: 'rename', id: cx.id, name: nm }); S.cx = { items: j.items, memos: j.memos }; delete S.C[cx.id]; draw(); } catch (e) { toast(e.message); } };
    $('dj_delCx').onclick = async () => { if (!confirm(`${cx.name}을(를) 단지 장부에서 뺄까요? 이 단지에 남긴 호별 메모도 함께 지워집니다.`)) return; try { const j = await post({ op: 'del', id: cx.id }); S.cx = { items: j.items, memos: j.memos }; S.cur = (S.cx.items[0] || {}).id; draw(); } catch (e) { toast(e.message); } };
    document.querySelectorAll('[data-dong]').forEach(b => b.onclick = () => { C.cur = b.dataset.dong; C.picked = true; drawComplex(cx); });
    if (C.scan) scanApply(cx, C);
    drawGrid(cx);
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
      return `<tr><td><b>${e.ex}㎡</b><small>${Math.round(e.ex / PY)}평</small></td>
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
    for (const x of items()) for (const p of (x.places && x.places.length ? x.places : [x])) {
      if (!p.dong && !p.ho) continue;
      const inCx = pn.has(p.pnu) || (base.length >= 4 && normName(p.bname || x.bname).startsWith(base));
      if (!inCx) continue;
      const k = `${pn.has(p.pnu) ? p.pnu : '*'}|${normD(p.dong)}|${normH(p.ho)}`;
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
    const units = U.filter(u => u.flrGb !== '지하' && digits(u.ho)).map(u => { const h = +digits(u.ho); const fl = u.flr != null ? u.flr : Math.floor(h / 100); return { ho: u.ho, h, fl, line: h >= 100 ? h % 100 : h }; });
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
    const head = `<tr><th></th>${lines.map(l => { const e = lineEx(l); return `<th class="ln"><b>${String(l).padStart(2, '0')}라인</b>${e ? `${e}㎡ · ${Math.round(e / PY)}평${hasAR && LM[l] && LM[l].mixed ? ' 외' : ''}` : e === 0 ? '-' : '…'}</th>`; }).join('')}<th class="ftr">이 층 실거래</th></tr>`;
    // 건물 외벽: 호가 있는 칸의 바깥쪽(왼·오른·위)에 진한 선
    const has = (f, l) => at.has(`${f}|${l}`);
    const body = floors.map(f => `<tr><th class="fl">${f}층</th>${lines.map(l => {
      const u = at.get(`${f}|${l}`); if (!u) return '<td class="sky"></td>';
      const mine = mineAt(M, pnu, dong, u.ho), live = mine.find(x => x.status !== 'done'), x = live || mine[0];
      const cls = x ? (live ? `k-${x.kind}` : 'k-done') : '';
      const memo = S.cx.memos[memoKey(cx, pnu, dong, u.ho)];
      const pr = x ? (x.kind === 'sale' ? shortWon(x.price) : x.kind === 'jeonse' ? shortWon(x.deposit) : x.kind === 'wolse' ? `${shortWon(x.deposit)}/${x.rent || ''}` : shortWon(x.pr)) : '';
      const li = lines.indexOf(l), a = arOf(u), g = a ? gOf(a) : -1, lm = LM[l];
      const edge = [!has(f, lines[li - 1]) ? 'bL' : '', !has(f, lines[li + 1]) ? 'bR' : '', (floors.indexOf(f) === 0 || !has(floors[floors.indexOf(f) - 1], l)) ? 'bT' : ''].join(' ');
      const odd = a && lm && Math.abs(a - lm.a) >= 1 ? `<em>${Math.round(a / PY)}평</em>` : '';
      return `<td class="${edge}"><button type="button" class="cell ${cls}" data-ho="${esc(u.ho)}" title="${esc(dong)} ${esc(u.ho)}${a ? ` · 전용 ${a}㎡ (${(a / PY).toFixed(1)}평)` : ''}">${esc(normH(u.ho))}${pr ? `<span class="pr">${esc(pr)}</span>` : ''}${memo ? '<i class="mdot"></i>' : ''}${odd}${g >= 0 ? `<i class="abar" style="background:${ACOL[g % ACOL.length]}"></i>` : ''}</button></td>`;
    }).join('')}<td class="ftr">${(byFloor.get(f) || []).slice(0, 2).map(r => `<span class="${r.kind === 'apt' ? '' : 'j'}">${r.kind === 'apt' ? '매' : r.rent ? '월' : '전'} ${r.kind === 'apt' ? shortWon(r.price) : shortWon(r.deposit)} · ${Math.round(r.ex)}㎡ · ${esc(r.date.slice(2, 7))}</span>`).join('')}</td></tr>`).join('');
    const want = (C.want || {})[C.cur], got = U.filter(u => digits(u.ho)).length;
    const cnt = `<p class="note">건축물대장 호 ${got.toLocaleString()}개${want ? ` / 표제부 기준 ${want.toLocaleString()}호${got < want ? ' · 일부 호가 공공데이터에 없어 빈칸으로 보일 수 있습니다' : ''}` : ''}</p>`;
    const part = C.partial && C.partial[C.cur] ? '<div class="muted" style="margin-bottom:6px">공공데이터 응답이 느려 호 목록 일부만 받았습니다. <button type="button" class="lnk" id="dj_retry">나머지 다시 불러오기</button></div>' : '';
    const legend = `<div class="aleg">${groups.map((g, i) => `<span><i style="background:${ACOL[i % ACOL.length]}"></i>${g.a}㎡ · ${Math.round(g.a / PY)}평</span>`).join('')}${groups.length ? '' : AR === 'loading' ? '<span class="note">호별 면적을 불러오는 중…</span>' : ''}<span><u class="k-sale"></u>매매</span><span><u class="k-jeonse"></u>전세</span><span><u class="k-wolse"></u>월세</span><span class="note">칠한 칸 = 내 매물</span></div>`;
    const ground = `<tr class="gnd"><th></th><td colspan="${lines.length}"><i></i></td><td class="ftr"></td></tr>`;
    box.innerHTML = part + cnt + legend + `<div class="scroll"><table class="grid bldg"><thead>${head}</thead><tbody>${body}${ground}</tbody></table></div>`;
    if ($('dj_retry')) $('dj_retry').onclick = retry;
    const LX = {}; lines.forEach(l => { LX[l] = lineEx(l); });
    box.querySelectorAll('[data-ho]').forEach(b => b.onclick = () => openUnit(cx, pnu, dong, b.dataset.ho, units, LX));
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
  // ---------- 호 상세 ----------
  async function openUnit(cx, pnu, dong, ho, units, LA) {
    const C = S.C[cx.id], u = units.find(x => x.ho === ho) || {};
    const M = mineMap(cx), mine = mineAt(M, pnu, dong, ho);
    const key = memoKey(cx, pnu, dong, ho), memo = S.cx.memos[key];
    const trades = (C.trades || []).filter(r => normD(r.aptDong) === normD(dong) && +r.floor === u.fl);
    const lineEx = LA[u.line];
    $('djShTitle').textContent = `${dong}${/동$/.test(dong) ? '' : '동'} ${normH(ho)}호`;
    const render = (info) => {
      $('djShBody').innerHTML = `
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
  async function saveMemo(cx, key, text) {
    try {
      const j = await post({ op: 'memo', id: cx.id, key, text: text.trim() });
      S.cx = { items: j.items, memos: j.memos };
      toast(text.trim() ? '메모를 저장했습니다' : '메모를 지웠습니다');
      closeSheet(); drawGrid(cx);
    } catch (e) { toast(e.message, 3500); }
  }
  function closeSheet() { $('djSheet').hidden = true; document.body.style.overflow = ''; }

  return { mount, refresh, add };
})();
