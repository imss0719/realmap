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
    const chips = `<div class="chips">${S.cx.items.length >= 2 ? `<button type="button" data-cx="__all" class="allcx" aria-pressed="${S.cur === '__all' && !S.adding}">모든 단지</button>` : ''}${S.cx.items.map(c => `<button type="button" data-cx="${c.id}" aria-pressed="${c.id === S.cur && !S.adding}">${esc(c.name)}</button>`).join('')}<button type="button" class="add" id="dj_addBtn" aria-pressed="${S.adding === true}">＋ 단지 추가</button></div>`;
    if (S.adding || !S.cx.items.length) {
      W.innerHTML = chips + addBox(S.adding === 'place' ? S.cur : null) + (S.cx.items.length ? '' : `<div class="empty"><b>자주 보는 단지를 담아 보세요</b>동별로 층과 라인을 펼쳐 놓고, 내 매물·호별 메모·층별 실거래를 한 장에서 봅니다.</div>`);
      wireChips(); const q = $('dj_aq'); q.onkeydown = e => { if (e.key === 'Enter') search(q.value.trim()); }; q.focus(); drawAdd(); return;
    }
    if (S.cur === '__all' && S.cx.items.length >= 2) { W.innerHTML = chips + `<div id="dj_cxBody"></div>`; wireChips(); return drawAll(); }
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
  // ---------- 단지 화면: 요약 + 표 (엑셀처럼 칸을 눌러 바로 입력) ----------
  // 처음 = 단지 전체(장부에 뭐라도 적힌 호 + 매물장 매물이 있는 호) · 동을 누르면 그 동의 모든 호(빈 줄 포함)
  // 동 그림(층 × 라인)은 [현황판 보기]를 눌렀을 때만.
  const AX = { id: '__all', name: '모든 단지', all: true, places: [], dir: {} };   // '모든 단지' 보기용 가짜 단지
  const TF = () => S.cur === '__all' ? (S.FA || (S.FA = { st: 'mine', k: '', a: '', sort: 'dh' })) : (S.F || (S.F = { st: 'all', k: '', a: '', sort: 'dh' }));
  // 단지 정보: 열어 본 단지는 그대로, 아직 안 연 단지는 동 목록만 가볍게 받아 평형을 찾음 (모든 단지 보기용)
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
    if (!$('dj_cxBody')) return;
    if (S.ed) { S.redraw = true; return; }
    const items = S.cx.items;
    items.forEach(c => { if (!S.L[c.id]) loadLedger(c); });
    const wait = items.filter(c => !S.L[c.id] || (S.L[c.id].p && !S.L[c.id].units)).length;
    const K = kpi(items.flatMap(c => rowsAll(c, CI(c), mineMap(c))));
    $('dj_cxBody').innerHTML = `
      <div class="card hdc"><div class="hd"><div class="t"><b>모든 단지</b><span class="muted">${items.length}곳${wait ? ` · 장부를 불러오는 중 (${items.length - wait}/${items.length})` : ''}</span></div></div>
        <div class="kpis"><div><b>${K.m}</b><small>내 매물</small></div><div><b>${K.o}</b><small>타부동산</small></div><div class="${K.e ? 'al' : ''}"><b>${K.e}</b><small>만기 임박</small></div><div><b>${K.d}</b><small>이번 달 계약</small></div></div></div>
      <div class="card gcard"><div id="dj_tbl"></div>
        <div class="lgd"><span><i class="lg-c" style="background:var(--sale)"></i>매매</span><span><i class="lg-c" style="background:var(--jeonse)"></i>전세</span><span><i class="lg-c" style="background:var(--wolse)"></i>월세</span><span><i class="lg-x"></i>만기 임박</span><span class="note">단지 이름을 누르면 그 단지로 이동합니다</span></div></div>`;
    drawTable(AX);
  }
  const boardOn = () => { try { return localStorage.getItem('rm.djboard2') === '1'; } catch { return false; } };
  function drawComplex(cx) {
    const C = S.C[cx.id];
    if (!C) { loadComplex(cx); $('dj_cxBody').innerHTML = '<div class="card loading">단지 정보를 불러오는 중…</div>'; return; }
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
    $('dj_cxBody').innerHTML = `
      <div class="card hdc"><div class="hd"><div class="t"><b>${esc(cx.name)}</b>
        <span class="muted">${C.dongs ? `${C.dongs.length}개 동${hhld ? ` · ${hhld.toLocaleString()}세대` : ''}${apr ? ` · ${esc(String(apr).slice(0, 4))}년` : ''}` : '동 정보를 불러오는 중…'}</span></div>
        <div class="acts"><button class="btn ghost sm" id="dj_ren" type="button">이름 바꾸기</button><button class="btn ghost sm" id="dj_delCx" type="button">빼기</button></div></div>
        <div class="kpis"><div><b>${K.m}</b><small>내 매물</small></div><div><b>${K.o}</b><small>타부동산</small></div><div class="${K.e ? 'al' : ''}"><b>${K.e}</b><small>만기 임박</small></div><div><b>${K.d}</b><small>이번 달 계약</small></div></div>
        <div class="sum">${summary(C)}<button type="button" class="lnk" id="dj_bt">${open ? '시세 접기 ▴' : '시세 자세히 ▾'}</button></div>
        ${open ? `<div id="dj_board">${board(C)}</div>` : ''}</div>
      <div class="card gcard">
        <div class="dongs" id="dj_dongs"><button type="button" data-dong="all" aria-pressed="${C.view === 'all'}">전체</button>${(C.dongs || []).map(d => { const k = d.pnu + '|' + d.dong; const n = dongCounts(cx, d, MM); const sp = C.scan && C.scan.per[d.pnu], wt = !!sp && !sp.done && !sp.cached && !Array.isArray(C.units[k]); return `<button type="button" data-dong="${esc(k)}" aria-pressed="${C.view === 'dong' && k === C.cur}" class="${n.m || n.o || n.e ? 'has' : ''}${wt ? ' wait' : ''}">${esc(d.dong)}${n.m ? `<em title="내 매물">${n.m}</em>` : ''}${n.o ? `<em class="o" title="타부동산 매물">${n.o}</em>` : ''}${n.e ? `<i class="xd" title="만기 임박">${n.e}</i>` : ''}</button>`; }).join('') || (C.dongs ? '<span class="muted">동 정보가 없습니다.</span>' : '')}</div>
        <div class="dj-scanbar" id="dj_scan" hidden></div>
        ${LL && LL.err ? `<p class="hjwarn">호실 장부를 쓸 수 없어 보기만 됩니다: ${esc(LL.err)}</p>` : ''}
        ${C.view === 'dong' ? `<div class="tbbar"><button type="button" class="btn ghost sm" id="dj_boardT" aria-pressed="${boardOn()}">${boardOn() ? '현황판 닫기 ▴' : '현황판 보기 ▾'}</button><span class="note">층 × 라인 그림</span></div>
        <div id="dj_gridBox"${boardOn() ? '' : ' hidden'}></div>` : ''}
        <div id="dj_tbl"></div>
        <div class="lgd"><span><i class="lg-c" style="background:var(--sale)"></i>매매</span><span><i class="lg-c" style="background:var(--jeonse)"></i>전세</span><span><i class="lg-c" style="background:var(--wolse)"></i>월세</span><span><em class="lg-n">n</em>내 매물</span><span><em class="lg-n o">n</em>타부동산</span><span><i class="lg-x"></i>만기 임박</span><button type="button" class="lnk" id="dj_addPl">빠진 동이 있나요?</button></div>
      </div>`;
    $('dj_bt').onclick = () => { S.boardOpen = !S.boardOpen; try { localStorage.setItem('rm.djboard', S.boardOpen ? '1' : ''); } catch { /* 무시 */ } drawComplex(cx); };
    $('dj_addPl').onclick = () => { S.adding = 'place'; S.results = null; draw(); };
    $('dj_ren').onclick = async () => { const nm = prompt('단지 이름', cx.name); if (!nm || nm === cx.name) return; try { const j = await post({ op: 'rename', id: cx.id, name: nm }); S.cx = { items: j.items, memos: j.memos }; delete S.C[cx.id]; draw(); } catch (e) { toast(e.message); } };
    $('dj_delCx').onclick = async () => { const L = S.L[cx.id], n = L && L.units ? Object.keys(L.units).length : 0; const t = prompt(`${cx.name}을(를) 단지 장부에서 빼면 이 단지의 호실 장부${n ? ` ${n}호` : ''}(연락처·히스토리 포함)와 호별 메모가 모두 지워지고 되돌릴 수 없습니다.\n\n정말 빼려면 단지 이름을 그대로 입력해 주세요.`); if (t == null) return; if (t.trim() !== cx.name.trim()) return toast('단지 이름이 달라서 빼지 않았습니다', 3500); delete S.L[cx.id]; try { const j = await post({ op: 'del', id: cx.id }); S.cx = { items: j.items, memos: j.memos }; S.cur = (S.cx.items[0] || {}).id; draw(); } catch (e) { toast(e.message); } };
    document.querySelectorAll('[data-dong]').forEach(b => b.onclick = () => {
      if (b.dataset.dong === 'all') { C.view = 'all'; } else { C.view = 'dong'; C.cur = b.dataset.dong; C.picked = true; }
      S.hist = null; drawComplex(cx);
    });
    fitDongs();
    if (!S.fitOn) { S.fitOn = true; let t = 0; addEventListener('resize', () => { clearTimeout(t); t = setTimeout(fitDongs, 150); }); }
    if ($('dj_boardT')) $('dj_boardT').onclick = () => { try { localStorage.setItem('rm.djboard2', boardOn() ? '' : '1'); } catch { /* 무시 */ } drawComplex(cx); };
    if (C.scan) scanApply(cx, C);
    // 동 표는 호 목록이 있어야 하므로, 현황판을 닫아 두어도 그림 상자에서 호 목록을 받아 둡니다(상자는 숨김)
    if (C.view === 'dong') { if (!$('dj_gridBox')) { /* 없음 */ } drawGrid(cx); }
    drawTable(cx);
    const sd = new URLSearchParams(location.search).get('seed');
    if (sd && !S.seeded && sd !== 'clear') { const tg = S.cx.items.find(c => /마포래미안푸르지오/.test(String(c.name).replace(/\s/g, ''))); if (tg && tg.id !== cx.id) { S.cur = tg.id; return draw(); } }   // 마포래미안푸르지오가 있으면 그 단지로
    if (sd && !S.seeded && C.dongs && C.dongs.length && LL && LL.units) { S.seeded = true; history.replaceState(null, '', location.pathname + '?mode=danji'); setTimeout(() => seedTest(cx, sd === 'clear' ? 'clear' : 'add'), 300); }
  }

  // 동 버튼이 많으면 3줄까지만 (고른 동은 항상 보이게) + [동 전체 보기]
  function fitDongs() {
    const box = $('dj_dongs'), LINES = 3; if (!box) return;
    const bs = [...box.querySelectorAll('[data-dong]')]; if (bs.length < 2) return;
    const old = $('dj_dmore'); if (old) old.remove();
    bs.forEach(b => { b.hidden = false; });
    if (Math.floor((bs[bs.length - 1].offsetTop - bs[0].offsetTop + 2) / (bs[0].offsetHeight + 2)) < LINES) return;   // 3줄 안에 다 들어가면 접기 없음
    const tg = document.createElement('button'); tg.type = 'button'; tg.id = 'dj_dmore'; tg.className = 'dmore';
    tg.onclick = () => { S.dongOpen = !S.dongOpen; fitDongs(); };
    if (S.dongOpen) { tg.textContent = '동 접기 ▴'; box.appendChild(tg); if (Math.floor((tg.offsetTop - bs[0].offsetTop + 2) / (bs[0].offsetHeight + 2)) < LINES) tg.remove(); return; }
    box.appendChild(tg); tg.textContent = '동 전체 보기 ▾ (00개 더)';
    const t0 = bs[0].offsetTop, h = bs[0].offsetHeight;
    const row = b => Math.floor((b.offsetTop - t0 + 2) / (h + 2));
    if (row(bs[bs.length - 1]) < LINES && row(tg) < LINES) { tg.remove(); return; }
    const sel = bs.find(b => b.getAttribute('aria-pressed') === 'true');
    // 넷째 줄부터 숨김
    bs.forEach(b => { if (row(b) >= LINES) b.hidden = true; });
    // 고른 동이 숨었으면 보이게 하고, 대신 그 앞 버튼을 하나씩 숨김
    if (sel && sel.hidden) sel.hidden = false;
    const vis = () => bs.filter(b => !b.hidden && b !== sel && b.dataset.dong !== 'all');
    for (let k = 0; k < 60 && (row(tg) >= LINES || (sel && row(sel) >= LINES)); k++) { const v = vis(); if (!v.length) break; v[v.length - 1].hidden = true; }
    tg.textContent = `동 전체 보기 ▾ (${bs.filter(b => b.hidden).length}개 더)`;
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
    return { key, pnu, dn, ho: h, st, r: st.r, a, line, dir: (cx.dir || {})[`${pnu}|${dn}|${line}`] || '', cx };
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
  function pass(x, F) {
    const s = x.st;
    if (F.st === 'mine' && !(s.src === 'mine' && !s.done)) return false;
    if (F.st === 'other' && !(s.src === 'other' && !s.done)) return false;
    if (F.st === 'exp' && !s.exp) return false;
    if (F.st === 'hold' && !s.hold) return false;
    if (F.st === 'done' && !s.done) return false;
    if (F.k && !((s.k || []).includes(F.k) && !s.done) && !(s.done && x.r && x.r.deal && x.r.deal.k === F.k)) return false;
    if (F.a && Math.abs(x.a - F.a) >= 1.5) return false;
    return true;
  }
  const hasInfo = x => !!(x.st.src || x.st.done || x.st.info || x.r);
  function sortRows(rows, how) {
    const dh = (a, b) => (a.cx && b.cx && a.cx !== b.cx ? natc(a.cx.name, b.cx.name) : 0) || natc(a.dn, b.dn) || (+a.ho - +b.ho) || natc(a.ho, b.ho);
    if (how === 'up') return rows.sort((a, b) => String((b.r && b.r.up) || '').localeCompare(String((a.r && a.r.up) || '')) || dh(a, b));
    if (how === 'exp') return rows.sort((a, b) => ((a.st.dl ?? 99999) - (b.st.dl ?? 99999)) || dh(a, b));
    if (how === 'fl') return rows.sort((a, b) => (Math.floor(+b.ho / 100) - Math.floor(+a.ho / 100)) || (+a.ho - +b.ho));
    return rows.sort(dh);
  }

  // ---------- 표 그리기 ----------
  const COLS = [
    { id: 'dh', t: '동·호' }, { id: 'ar', t: '평형', ed: 'area' }, { id: 'dir', t: '방향', ed: 'dir' }, { id: 'st', t: '상태', ed: 'st' }, { id: 'pr', t: '가격', ed: 'pr' },
    { id: 'live', t: '거주', ed: 'live' }, { id: 'mi', t: '입주', ed: 'date', f: 'moveIn' }, { id: 'exp', t: '만기', ed: 'date', f: 'exp' }, { id: 'opt', t: '옵션', ed: 'text', f: 'opt', ph: '예: 시스템에어컨' },
    { id: 'tel', t: '연락처', ed: 'tel' }, { id: 'note', t: '메모', ed: 'text', f: 'note', ph: '예: 근저당 3억' }, { id: 'h', t: '' }];
  const NAV = ['ar', 'dir', 'pr', 'live', 'mi', 'exp', 'opt', 'tel', 'note'];   // Tab 순서 (상태는 눌러서)
  const LIVE = { owner: '주인', tenant: '임차인', empty: '공실' };
  const stHtml = s => {
    if (s.done) { const d = s.r && s.r.deal; return `<span class="p done">${d ? KN[d.k] + ' ' : ''}계약됨 ✓</span>${d && d.by === 'other' ? '<small>타사</small>' : ''}`; }
    if (!s.src) return '<span class="mut">-</span>';
    const pills = (s.k.length ? s.k : ['']).map(k => `<span class="p ${k ? (s.src === 'mine' ? 'f-' : 'o-') + k : 'f-none'}">${k ? KN[k] : s.src === 'mine' ? '내 매물' : '타부동산'}</span>`).join('');
    return `<span class="${s.hold ? 'hold' : ''}">${pills}</span><small>${s.hold ? '보류' : s.src === 'mine' ? (s.k.length ? '내 매물' : '') : esc(s.office || (s.k.length ? '타부동산' : ''))}</small>`;
  };
  function prHtml(x) {
    const r = x.r, s = x.st;
    if (s.done && r && r.deal) return `${KN[r.deal.k][0]} ${r.deal.k === 'wolse' ? `${shortWon(r.deal.a)}/${r.deal.r || ''}` : shortWon(r.deal.a)}`;
    const pr = r && r.pr; if (!pr && !s.pr) return '<span class="mut">-</span>';
    if (!pr) return esc(s.pr);
    const ks = s.k.length ? s.k : ['sale', 'jeonse', 'wolse'];
    const out = ks.map(k => { const v = prShort(k, pr); return v ? `${KN[k][0]} ${v}` : ''; }).filter(Boolean);
    return out.length ? esc(out.join(' · ')) : '<span class="mut">-</span>';
  }
  function cellHtml(x, c) {
    const r = x.r || {};
    switch (c.id) {
      case 'dh': return S.cur === '__all' ? `<button type="button" class="cxn" data-gocx="${esc(x.cx.id)}" title="${esc(x.cx.name)}으로 이동">${esc(x.cx.name)}</button><b>${esc(x.dn)}-${esc(x.ho)}</b>` : `<b>${esc(x.dn)}-${esc(x.ho)}</b>`;
      case 'ar': return x.a ? `${Math.round(x.a)}㎡ <small>${Math.round(x.a / PY)}평</small>` : '<span class="mut">입력</span>';
      case 'dir': return x.dir ? esc(x.dir) : '<span class="mut">-</span>';
      case 'st': return stHtml(x.st);
      case 'pr': return prHtml(x);
      case 'live': return r.live ? LIVE[r.live] : '<span class="mut">-</span>';
      case 'exp': return r.exp ? `<span class="${x.st.exp ? 'dd' : ''}">${esc(r.exp.slice(2).replace(/-/g, '.'))}${x.st.exp ? ` · ${x.st.dl >= 0 ? 'D-' + x.st.dl : '지남'}` : ''}</span>` : '<span class="mut">-</span>';
      case 'tel': {
        const t = r.tels || []; if (!t.length) return '<span class="mut">-</span>';
        const one = (z, i) => `<a class="tl" href="tel:${esc(String(z.n).replace(/[^\d+]/g, ''))}" data-tcall="${i}">${esc(z.l || '연락처')} ${esc(z.n)}</a>`;
        if (t.length === 1) return one(t[0], 0);
        const op = S.telOpen && S.telOpen.has(x.key);
        return op ? `<div class="tls">${t.map(one).join('')}<button type="button" class="tx" data-tx="${esc(x.key)}">접기 ▴</button></div>`
          : `${one(t[0], 0)} <button type="button" class="tx" data-tx="${esc(x.key)}">외 ${t.length - 1} ▾</button>`;
      }
      case 'h': {
        const n = r.histN || 0, op = S.hist === x.key;
        const ls = (x.st.mine || []).find(z => z.status !== 'done');
        // 리얼맵(지도)에 올리기: 내 매물만 — 매물카드가 있으면 열고, 없으면 장부 내용을 채워서 새로 만들기
        const up = ls ? `<button type="button" class="mbtn on" data-ls="${esc(ls.id)}" title="매물카드 열기 (리얼맵 등록·수정)">지도</button>`
          : x.st.src === 'mine' && !x.st.done ? `<button type="button" class="mbtn" data-up="${esc(x.key)}" title="리얼맵에 올리기 — 장부 내용으로 매물카드를 채워 엽니다">지도↑</button>` : '';
        return `<button type="button" class="hbtn${op ? ' on' : ''}" data-hist="${esc(x.key)}">${op ? '기록 ▴' : `기록${n ? ' ' + n : ''}`}</button>${up}`;
      }
      case 'mi': return r.moveIn ? esc(/^\d{4}-\d{2}-\d{2}$/.test(r.moveIn) ? r.moveIn.slice(2).replace(/-/g, '.') : r.moveIn) : '<span class="mut">-</span>';
      default: return r[c.f] ? esc(r[c.f]) : '<span class="mut">-</span>';
    }
  }
  const tipOf = (x, c) => { const r = x.r || {}; return c.id === 'note' || c.id === 'opt' ? r[c.f] || '' : c.id === 'tel' ? (r.tels || []).map(t => `${t.l} ${t.n}`).join(' / ') : ''; };   // 잘린 글은 마우스를 올리면 전체
  const rowHtml = (x, i) => `<tr data-i="${i}" data-key="${esc(x.key)}" class="${x.st.src || x.st.done ? 'on' : ''}${x.fs ? ' fs' : ''}">${COLS.map(c => { const tp = tipOf(x, c); return `<td class="c-${c.id}${c.ed ? ' ed' : ''}" data-c="${c.id}"${tp ? ` title="${esc(tp)}"` : ''}>${cellHtml(x, c)}</td>`; }).join('')}</tr>`;
  function drawTable(cx) {
    const ALL = !!cx.all, C = ALL ? { view: 'all' } : S.C[cx.id], box = $('dj_tbl'); if (!box || !C) return;
    if (S.ed) { S.redraw = true; return; }
    const F = TF(), MM = ALL ? null : mineMap(cx);
    let rows;
    if (ALL) rows = S.cx.items.flatMap(c => rowsAll(c, CI(c), mineMap(c))).filter(x => pass(x, F));
    else if (C.view === 'dong') {
      rows = rowsDong(cx, C, MM);
      if (!rows) { box.innerHTML = '<div class="loading">이 동의 호 목록을 받는 중입니다…</div>'; return; }
      if (F.st === 'all' && !F.k && !F.a) { /* 동 화면은 빈 줄까지 */ } else rows = rows.filter(x => pass(x, F));
    } else rows = rowsAll(cx, C, MM).filter(x => pass(x, F));
    // 평형 칩: 지금 보이는 범위의 평형
    const base = ALL ? S.cx.items.flatMap(c => rowsAll(c, CI(c), mineMap(c))) : C.view === 'dong' ? (rowsDong(cx, C, MM) || []) : rowsAll(cx, C, MM);
    const areas = []; base.forEach(x => { if (x.a && !areas.some(a => Math.abs(a - x.a) < 1.5)) areas.push(x.a); }); areas.sort((a, b) => a - b);
    if (!ALL) needAreas(cx, C, base);
    else S.cx.items.forEach(c => { const Cc = CI(c); if (Cc.dongs) { const rs = base.filter(x => x.cx === c); if (rs.length) needAreas(c, Cc, rs); } });
    sortRows(rows, F.sort === 'fl' && C.view !== 'dong' ? 'dh' : F.sort);
    // 동 화면에서 층이 바뀌는 줄 위에 구분선
    const flo = x => Math.floor(+x.ho / 100);
    rows.forEach((x, i) => { x.fs = C.view === 'dong' && (F.sort === 'dh' || F.sort === 'fl') && i > 0 && flo(x) !== flo(rows[i - 1]); });
    S.rows = rows; S.tcx = cx;
    const chip = (g, v, t) => `<button type="button" data-f="${g}" data-v="${v}" aria-pressed="${String(F[g]) === String(v)}">${t}</button>`;
    const ro = !ALL && !!(S.L[cx.id] && S.L[cx.id].err);
    box.innerHTML = `<div class="tbf">
        <div class="fg">${chip('st', 'all', '전체')}${chip('st', 'mine', '내 매물')}${chip('st', 'other', '타부동산')}${chip('st', 'exp', '만기 임박')}${chip('st', 'hold', '보류')}${chip('st', 'done', '계약됨')}</div>
        <div class="fg">${chip('k', 'sale', '매매')}${chip('k', 'jeonse', '전세')}${chip('k', 'wolse', '월세')}</div>
        ${areas.length > 1 ? `<div class="fg">${areas.map(a => chip('a', a, `${Math.round(a)}㎡`)).join('')}</div>` : ''}
        <div class="fg r"><select id="dj_sort" class="hjin sm" aria-label="정렬"><option value="dh"${F.sort === 'dh' ? ' selected' : ''}>${ALL ? '단지·동·호 순' : '동·호 순'}</option>${C.view === 'dong' ? `<option value="fl"${F.sort === 'fl' ? ' selected' : ''}>높은 층부터</option>` : ''}<option value="up"${F.sort === 'up' ? ' selected' : ''}>최근 바뀐 순</option><option value="exp"${F.sort === 'exp' ? ' selected' : ''}>만기 가까운 순</option></select>
        ${ro || ALL ? '' : `<input id="dj_addHo" class="hjin sm" placeholder="＋ 호 추가 (예: 102-1503)" autocomplete="off">`}<button type="button" class="btn ghost sm" id="dj_csv">엑셀로 받기</button></div></div>
      <div class="tbw" id="dj_tbw"><table class="xt${ALL ? ' allx' : ''}"><thead><tr>${COLS.map(c => `<th class="c-${c.id}">${c.t}</th>`).join('')}</tr></thead>
      <tbody>${rows.map((x, i) => rowHtml(x, i) + (S.hist === x.key ? histRowHtml(x) : '')).join('') || `<tr><td colspan="${COLS.length}" class="empty">${ALL ? '조건에 맞는 호가 없습니다. 위에서 필터를 바꿔 보세요.' : C.view === 'all' && F.st === 'all' && !F.k && !F.a ? '아직 적어 둔 호가 없습니다. 위 칸에 "102-1503"처럼 호를 넣거나, 동을 눌러 빈 줄부터 채워 보세요.' : '조건에 맞는 호가 없습니다.'}</td></tr>`}</tbody></table></div>
      <p class="note">칸을 누르면 바로 입력 · <b>Enter</b> 저장 후 아래 칸 · <b>Tab</b> 오른쪽 칸 · <b>Esc</b> 취소 · 바뀐 내용은 날짜·시간과 함께 [기록]에 자동으로 남습니다.${C.view === 'dong' ? ` · ${rows.length}호` : ` · ${rows.length}호`}</p>`;
    box.querySelectorAll('[data-f]').forEach(b => b.onclick = () => { const g = b.dataset.f, v = g === 'a' ? +b.dataset.v : b.dataset.v; F[g] = g === 'st' ? v : (F[g] === v ? '' : v); drawTable(cx); });
    $('dj_sort').onchange = e => { F.sort = e.target.value; drawTable(cx); };
    $('dj_csv').onclick = () => exportCsv(cx, rows);
    if ($('dj_addHo')) $('dj_addHo').onkeydown = e => { if (e.key === 'Enter' && !e.isComposing) addHo(cx, e.target.value); };
    if (!ro) box.querySelectorAll('td.ed').forEach(td => td.onclick = e => { if (td.classList.contains('editing') || e.target.closest('a,button.hbtn,button.tx')) return; startEdit(cx, +td.parentNode.dataset.i, td.dataset.c); });
    box.querySelectorAll('[data-hist]').forEach(b => b.onclick = () => toggleHist(cx, b.dataset.hist));
    wireTel(cx, box);
    box.querySelectorAll('[data-gocx]').forEach(b => b.onclick = e => { e.stopPropagation(); S.cur = b.dataset.gocx; S.hist = null; draw(); });
    if (S.hist) wireHist(cx);
    if (S.focusKey) { const tr = box.querySelector(`tr[data-key="${CSS.escape(S.focusKey)}"]`); S.focusKey = null; if (tr) { tr.scrollIntoView({ block: 'center', behavior: 'smooth' }); tr.classList.add('flash'); setTimeout(() => tr.classList.remove('flash'), 1600); } }
  }
  // 줄 하나만 다시 그림 (입력 중인 줄은 입력이 끝난 뒤)
  function redrawRow(cx, key) {
    if (!S.rows) return;
    const i = S.rows.findIndex(x => x.key === key); if (i < 0) return;
    const old = S.rows[i]; cx = old.cx || cx;
    const C = CI(cx), x = rowOf(cx, C, mineMap(cx), old.pnu, (dongOf(C, old.dn) || {}).dong || old.dn, old.ho);
    x.fs = old.fs; S.rows[i] = x;
    if (S.ed && S.ed.i === i) { S.ed.stale = true; return; }
    const tr = document.querySelector(`#dj_tbl tr[data-i="${i}"]`); if (!tr) return;
    tr.outerHTML = rowHtml(x, i);
    const n = document.querySelector(`#dj_tbl tr[data-i="${i}"]`);
    n.querySelectorAll('td.ed').forEach(td => td.onclick = e => { if (td.classList.contains('editing') || e.target.closest('a,button.hbtn,button.tx')) return; startEdit(cx, i, td.dataset.c); });
    n.querySelectorAll('[data-hist]').forEach(b => b.onclick = () => toggleHist(cx, b.dataset.hist));
    wireTel(cx, n);
  }
  // 연락처 펼치기 · 번호를 누르면 전화 (통화 기록이 남음)
  function wireTel(cx, root) {
    root.querySelectorAll('[data-ls]').forEach(b => b.onclick = e => { e.stopPropagation(); if (S.ed) endEdit(S.tcx); S.host.openEdit(b.dataset.ls); });
    root.querySelectorAll('[data-up]').forEach(b => b.onclick = e => {
      e.stopPropagation(); if (S.ed) endEdit(S.tcx);
      const x = S.rows.find(z => z.key === b.dataset.up); if (!x) return;
      const r = x.r || {}, pr = r.pr || {}, k = (x.st.k || [])[0] || 'sale';
      const pre = { kind: k, ...(k === 'sale' ? { price: pr.sale || 0 } : k === 'jeonse' ? { deposit: pr.jeonse || 0 } : { deposit: pr.wd || 0, rent: pr.wr || 0 }),
        ...(r.tels && r.tels.length ? { contacts: r.tels.map(t => ({ role: t.l || '소유자', name: '', phone: t.n })) } : {}) };
      S.host.openAdd(x.pnu, x.dn, x.ho, pre);
      toast('장부 내용으로 매물카드를 채웠습니다. 사진·설명을 더하고 저장한 뒤 [리얼맵 등록]을 눌러 주세요.', 5000);
    });
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
    const empty = !rec.hist.length && !rec.st.src && !rec.live && !rec.exp && !rec.tels.length && !rec.note && !rec.opt && !rec.moveIn;
    if (empty) delete L.units[key]; else L.units[key] = { ...rec, hist: rec.hist.slice(0, 3), histN: rec.hist.length };
  }
  // mutate는 '값을 정하는' 함수여야 함(두 번 적용돼도 같은 결과) — 화면에 먼저 반영하고 서버에 차례로 저장
  function saveRow(cx, x, mutate) {
    const L = S.L[cx.id];
    if (L && L.units) {
      const cur = L.units[x.key], D = fieldsOfSum(cur);
      if (!D.st.src && x.st.fromLs) D.st = { src: 'mine', k: [...x.st.k], hold: x.st.hold, office: '' };
      mutate(D);
      L.units[x.key] = { ...EMPTY_REC(), ...(cur || {}), ...D, hist: cur ? cur.hist : [], histN: cur ? cur.histN : 0 };
      redrawRow(cx, x.key); refreshDongs(cx);
    }
    return queue(x.key, async () => {
      const L = S.L[cx.id], cur = L && L.units ? L.units[x.key] : null;
      const D = fieldsOfSum(cur);
      // 장부에 상태가 없고 매물장 매물로만 보이던 호는, 처음 저장할 때 그 상태를 장부에 옮겨 적음
      if (!D.st.src && x.st.fromLs) D.st = { src: 'mine', k: [...x.st.k], hold: x.st.hold, office: '' };
      mutate(D);
      try {
        const j = await hjPost({ id: cx.id, key: x.key, op: 'save', rec: D });
        if (j.memos) S.cx.memos = j.memos;
        putSum(cx, x.key, { ...EMPTY_REC(), ...j.rec });
      } catch (e) { toast(e.message, 4000); }
      redrawRow(cx, x.key); refreshDongs(cx);
    });
  }
  function actRow(cx, x, op, extra) {
    return queue(x.key, async () => {
      try {
        const j = await hjPost({ id: cx.id, key: x.key, op, ...extra });
        if (j.memos) S.cx.memos = j.memos;
        putSum(cx, x.key, { ...EMPTY_REC(), ...j.rec });
        if (S.hist === x.key) S.histRec = { ...EMPTY_REC(), ...j.rec };
      } catch (e) { toast(e.message, 4000); }
      if (S.hist === x.key && !S.ed) drawTable(S.tcx); else redrawRow(cx, x.key);
      refreshDongs(cx);
    });
  }
  // 동 버튼 숫자와 위 요약 숫자만 고침
  function refreshDongs(cx) {
    if (S.cur === '__all') { const K = kpi(S.cx.items.flatMap(c => rowsAll(c, CI(c), mineMap(c)))), ks = document.querySelectorAll('.dj .kpis b'); if (ks.length === 4) [K.m, K.o, K.e, K.d].forEach((v, i) => { ks[i].textContent = v; }); return; }
    const C = S.C[cx.id]; if (!C) return;
    const MM = mineMap(cx);
    document.querySelectorAll('#dj_dongs [data-dong]').forEach(b => {
      const d = (C.dongs || []).find(x => x.pnu + '|' + x.dong === b.dataset.dong); if (!d) return;
      const n = dongCounts(cx, d, MM);
      b.classList.toggle('has', !!(n.m || n.o || n.e));
      b.innerHTML = `${esc(d.dong)}${n.m ? `<em title="내 매물">${n.m}</em>` : ''}${n.o ? `<em class="o" title="타부동산 매물">${n.o}</em>` : ''}${n.e ? `<i class="xd" title="만기 임박">${n.e}</i>` : ''}`;
    });
    const K = kpi(rowsAll(cx, C, MM)), ks = document.querySelectorAll('.dj .kpis b');
    if (ks.length === 4) [K.m, K.o, K.e, K.d].forEach((v, i) => { ks[i].textContent = v; });
  }

  // ---------- 칸 바로 입력 ----------
  function endEdit(cx) {
    const e = S.ed; S.ed = null; closePop();
    document.querySelectorAll('#dj_tbl td.editing').forEach(td => td.classList.remove('editing'));
    if (!e) return;
    if (S.redraw) { S.redraw = false; redrawView(); return; }
    if (e.stale) redrawRow(cx, S.rows[e.i] && S.rows[e.i].key);
    else { const td = document.querySelector(`#dj_tbl tr[data-i="${e.i}"] td[data-c="${e.c}"]`); if (td && S.rows[e.i]) td.innerHTML = cellHtml(S.rows[e.i], COLS.find(c => c.id === e.c)); }
  }
  function move(cx, i, c, dir) {
    if (dir === 'down') { if (i + 1 < S.rows.length) return startEdit(cx, i + 1, c); return; }
    const k = NAV.indexOf(c) + (dir === 'prev' ? -1 : 1);
    if (k >= 0 && k < NAV.length) return startEdit(cx, i, NAV[k]);
  }
  function startEdit(cx, i, c) {
    if (S.ed) endEdit(cx);
    const x = S.rows[i], col = COLS.find(z => z.id === c); if (!x || !col || !col.ed) return;
    cx = x.cx || cx;                                          // 모든 단지 보기에서는 그 줄의 단지
    const td = document.querySelector(`#dj_tbl tr[data-i="${i}"] td[data-c="${c}"]`); if (!td) return;
    S.ed = { i, c };
    if (col.ed === 'st') return statusPop(cx, x, td);
    if (col.ed === 'pr') return pricePop(cx, x, td);
    if (col.ed === 'tel') return telPop(cx, x, td);
    const r = x.r || {};
    let el;
    if (col.ed === 'live') el = `<select class="ce">${[['', '-'], ['owner', '주인 거주'], ['tenant', '임차인'], ['empty', '공실']].map(([v, t]) => `<option value="${v}"${(r.live || '') === v ? ' selected' : ''}>${t}</option>`).join('')}</select>`;
    else if (col.ed === 'dir') el = `<select class="ce"><option value="">-</option>${DIRS.map(d => `<option${x.dir === d ? ' selected' : ''}>${d}</option>`).join('')}</select>`;
    else if (col.ed === 'area') el = `<input class="ce" value="${x.r && x.r.ar ? x.r.ar : ''}" placeholder="${x.a ? Math.round(x.a) + '㎡ (자동)' : '전용㎡ (예: 84)'}" title="전용면적을 ㎡로 적어 주세요 (평으로 적으면 전용 평으로 계산)" inputmode="decimal" maxlength="10">`;
    else if (col.ed === 'date') { const v = r[col.f] || ''; el = `<input class="ce" type="date" value="${/^\d{4}-\d{2}-\d{2}$/.test(v) ? esc(v) : ''}">${v && !/^\d{4}-\d{2}-\d{2}$/.test(v) ? `<small class="was">전에 적은 값: ${esc(v)}</small>` : ''}`; }
    else el = `<input class="ce" value="${esc(r[col.f] || '')}" placeholder="${esc(col.ph || '')}" maxlength="${col.f === 'note' ? 300 : col.f === 'opt' ? 200 : 30}">`;
    td.classList.add('editing'); td.innerHTML = el;
    const inp = td.querySelector('.ce'); inp.focus(); if (inp.select && inp.type !== 'date' && inp.tagName === 'INPUT') inp.select();
    if (inp.tagName === 'SELECT' || inp.type === 'date') { try { inp.showPicker && inp.showPicker(); } catch { /* 지원 안 하는 브라우저는 한 번 더 누르면 열림 */ } }
    const orig = inp.value;
    let done = false;
    const commit = how => {
      if (done) return; done = true;
      const v = inp.value;
      td.classList.remove('editing');
      if (v !== orig) {
        if (col.ed === 'dir') {
          const lk = `${x.pnu}|${x.dn}|${x.line}`;
          post({ op: 'dir', id: cx.id, key: lk, v }).then(j => { S.cx = { items: j.items, memos: j.memos }; const n = j.items.find(z => z.id === cx.id); if (n) cx.dir = n.dir; S.rows.forEach(z => { if (z.pnu === x.pnu && z.dn === x.dn && z.line === x.line) redrawRow(cx, z.key); }); }).catch(er => toast(er.message));
          cx.dir = { ...(cx.dir || {}), [lk]: v }; x.dir = v;
        } else saveRow(cx, x, D => {
          if (col.ed === 'area') { const m = String(v).replace(/\s/g, '').match(/^(\d+(?:\.\d+)?)(평|㎡|m2|m²)?$/i); D.ar = !v.trim() ? 0 : m ? Math.round((m[2] === '평' ? +m[1] * PY : +m[1]) * 100) / 100 : D.ar; if (v.trim() && !m) toast('전용면적을 84처럼 ㎡로 적어 주세요'); }
          else if (col.ed === 'live') D.live = v;
          else if (col.id === 'mi') { const was = (x.r && x.r.moveIn) || ''; D.moveIn = v; if (v && (!D.exp || D.exp === was)) D.exp = v; }   // 만기는 입주와 같게 (다르면 만기 칸에서 고침)
          else if (col.ed === 'date') D[col.f] = v;
          else D[col.f] = v.trim();
        });
      }
      endEdit(cx);
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
    const p = openPop(td, `<b class="pt">상태 — ${esc(x.dn)}-${esc(x.ho)}</b>
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
    const p = openPop(td, `<b class="pt">가격 — ${esc(x.dn)}-${esc(x.ho)}</b><div class="ppf">${ks.includes('sale') ? row('sale', '매매가', '예: 14억 5천') : ''}${ks.includes('jeonse') ? row('jeonse', '전세 보증금', '예: 8억 5천') : ''}${ks.includes('wolse') ? row('wd', '월세 보증금', '예: 1억') + row('wr', '월세(만원)', '예: 250') : ''}
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
  function telPop(cx, x, td) {
    const T = JSON.parse(JSON.stringify((x.r && x.r.tels) || []));
    if (!T.length) T.push({ l: '소유자', n: '' });
    const draw1 = () => {
      const p = openPop(td, `<b class="pt">연락처 — ${esc(x.dn)}-${esc(x.ho)}</b><span class="note">이 계정에서만 보이고 암호화해서 저장합니다</span>
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
    return `<tr class="hrow"><td colspan="${COLS.length}"><div class="hbox">
      ${ro ? '' : `<div class="hjmemo"><input class="hjin sm" id="hr_in" placeholder="기록 남기기 (예: 집주인 통화 — 3월에 결정) · Enter" maxlength="500"><button type="button" class="btn dark sm" id="hr_add">추가</button></div>`}
      ${!R ? '<div class="loading">기록을 불러오는 중…</div>' : R.hist.length ? `<ul class="hjhist">${R.hist.map((h, i) => `<li class="e-${h.e}"><span class="t">${fmtT(h.t)}</span><span class="hx">${esc(h.x)}</span>${i === 0 && canUndo && !ro ? '<button type="button" class="un" data-undo>되돌리기</button>' : ''}${h.e === 'memo' && !ro ? `<button type="button" class="x" data-mdel="${i}" aria-label="지우기">×</button>` : ''}</li>`).join('')}</ul>` : '<p class="note">아직 기록이 없습니다.</p>'}
      ${oldMemo ? `<p class="note">예전 메모 (이 호를 처음 저장할 때 기록으로 옮겨집니다)</p>${memoListHtml(oldMemo.t, String(oldMemo.up).slice(2, 10).replace(/-/g, '.'), '')}` : ''}
      ${R && R.deal ? `<p class="note">최근 계약: ${KN[R.deal.k]} ${R.deal.k === 'wolse' ? `${wonFull(R.deal.a)}/${R.deal.r}` : wonFull(R.deal.a)} · ${esc(String(R.deal.d).slice(2).replace(/-/g, '.'))}${R.deal.by === 'other' ? ' · 타사' : ' · 내 계약'}</p>` : ''}
    </div></td></tr>`;
  }
  function wireHist(cx) {
    const x = S.rows.find(z => z.key === S.hist); if (!x) return;
    cx = x.cx || cx;
    const add = () => { const t = $('hr_in').value.trim(); if (!t) return $('hr_in').focus(); actRow(cx, x, 'memo', { text: t }); };
    if ($('hr_add')) { $('hr_add').onclick = add; $('hr_in').onkeydown = e => { if (e.key === 'Enter' && !e.isComposing) add(); }; }
    document.querySelectorAll('#dj_tbl [data-undo]').forEach(b => b.onclick = () => { if (confirm('가장 최근 기록을 되돌릴까요? 그 전 상태로 돌아갑니다.')) actRow(cx, x, 'undo', {}); });
    document.querySelectorAll('#dj_tbl [data-mdel]').forEach(b => b.onclick = () => { if (confirm('이 기록을 지울까요?')) actRow(cx, x, 'mdel', { i: +b.dataset.mdel }); });
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
    S.F = { ...TF(), st: 'all', k: '', a: '' }; S.focusKey = key;
    drawTable(cx);
    const i = S.rows.findIndex(x => x.key === key); if (i >= 0) setTimeout(() => startEdit(cx, i, 'st'), 250);
  }
  function exportCsv(cx, rows) {
    const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const ALL = !!cx.all;
    const H = [...(ALL ? ['단지'] : []), '동', '호', '전용㎡', '방향', '상태', '매매가(만원)', '전세(만원)', '월세보증금(만원)', '월세(만원)', '거주', '만기', '입주', '옵션', '연락처', '메모', '최근 기록'];
    const lines = [H.map(q).join(',')];
    for (const x of rows) {
      const r = x.r || {}, s = x.st, pr = r.pr || {};
      const stt = s.done ? '계약됨' : s.src ? `${s.src === 'mine' ? '내 매물' : '타부동산' + (s.office ? `(${s.office})` : '')} ${(s.k || []).map(k => KN[k]).join('·')}${s.hold ? ' 보류' : ''}` : '';
      lines.push([...(ALL ? [x.cx.name] : []), x.dn, x.ho, x.a || '', x.dir, stt, pr.sale || '', pr.jeonse || '', pr.wd || '', pr.wr || '', r.live ? LIVE[r.live] : '', r.exp || '', r.moveIn || '', r.opt || '', (r.tels || []).map(t => `${t.l} ${t.n}`).join(' / '), r.note || '', (r.hist && r.hist[0] && `${fmtT(r.hist[0].t)} ${r.hist[0].x}`) || ''].map(q).join(','));
    }
    const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${cx.name}_호실장부_${todayK()}.csv`; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    toast(`${rows.length}호를 엑셀 파일로 받았습니다. 연락처가 들어 있으니 보관에 주의해 주세요.`, 4500);
  }

  // ---------- 호실 장부 (api/_ledger.js) ----------
  // 단지를 열면 그 단지의 장부 요약(호별 상태·만기·히스토리 최근 3건)을 한 번에 받습니다.
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
      if (r.deal && !(r.st && r.st.src) && Date.now() - Date.parse(r.deal.at) < 30 * DAY) { o.done = true; o.pr = r.deal.k === 'wolse' ? `${shortWon(r.deal.a)}/${r.deal.r || ''}` : shortWon(r.deal.a); return o; }
      if (r.st && r.st.src) { o.src = r.st.src; o.k = r.st.k || []; o.hold = !!r.st.hold; o.office = r.st.office; o.pr = prShort(o.k[0], r.pr); return o; }
    }
    if (live) { o.src = 'mine'; o.k = [KK[live.kind] || 'sale']; o.hold = live.status === 'hold'; o.fromLs = true; o.pr = live.kind === 'sale' ? shortWon(live.price) : live.kind === 'jeonse' ? shortWon(live.deposit) : live.kind === 'wolse' ? `${shortWon(live.deposit)}/${live.rent || ''}` : shortWon(live.pr); }
    else if (mine.length && !r) o.done = false;
    return o;
  }
  // 동 버튼 숫자: 내 매물 · 타부동산 · 만기 임박
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
    const head = `<tr><th></th>${lines.map(l => { const e = lineEx(l); const dir = (cx.dir || {})[`${pnu}|${normD(dong)}|${l}`]; return `<th class="ln"><b>${String(l).padStart(2, '0')}라인${dir ? ` · ${esc(dir)}` : ''}</b>${e ? `${e}㎡ · ${Math.round(e / PY)}평${hasAR && LM[l] && LM[l].mixed ? ' 외' : ''}` : e === 0 ? '-' : '…'}</th>`; }).join('')}<th class="ftr">이 층 실거래</th></tr>`;
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
      const odd = a && lm && Math.abs(a - lm.a) >= 1 ? `<em>${Math.round(a / PY)}평</em>` : '';
      return `<td class="${edge}"><button type="button" class="cell ${cls}"${sty} data-ho="${esc(u.ho)}" title="${esc(dong)} ${esc(u.ho)}${a ? ` · 전용 ${a}㎡ (${(a / PY).toFixed(1)}평)` : ''}">${esc(normH(u.ho))}${pr ? `<span class="pr">${esc(pr)}</span>` : ''}${st.exp ? `<i class="xdot" title="만기 ${st.dl >= 0 ? 'D-' + st.dl : '지남'}"></i>` : ''}${memo ? '<i class="mdot"></i>' : ''}${odd}${g >= 0 ? `<i class="abar" style="background:${ACOL[g % ACOL.length]}"></i>` : ''}</button></td>`;
    }).join('')}<td class="ftr">${(byFloor.get(f) || []).slice(0, 2).map(r => `<span class="${r.kind === 'apt' ? '' : 'j'}">${r.kind === 'apt' ? '매' : r.rent ? '월' : '전'} ${r.kind === 'apt' ? shortWon(r.price) : shortWon(r.deposit)} · ${Math.round(r.ex)}㎡ · ${esc(r.date.slice(2, 7))}</span>`).join('')}</td></tr>`).join('');
    const want = (C.want || {})[C.cur], got = U.filter(u => digits(u.ho)).length;
    const cnt = `<p class="note">건축물대장 호 ${got.toLocaleString()}개${want ? ` / 표제부 기준 ${want.toLocaleString()}호${got < want ? ' · 일부 호가 공공데이터에 없어 빈칸으로 보일 수 있습니다' : ''}` : ''}</p>`;
    const part = C.partial && C.partial[C.cur] ? '<div class="muted" style="margin-bottom:6px">공공데이터 응답이 느려 호 목록 일부만 받았습니다. <button type="button" class="lnk" id="dj_retry">나머지 다시 불러오기</button></div>' : '';
    const legend = `<div class="aleg">${groups.map((g, i) => `<span><i style="background:${ACOL[i % ACOL.length]}"></i>${g.a}㎡ · ${Math.round(g.a / PY)}평</span>`).join('')}${groups.length ? '' : AR === 'loading' ? '<span class="note">호별 면적을 불러오는 중…</span>' : ''}<span><u class="k-sale"></u>매매</span><span><u class="k-jeonse"></u>전세</span><span><u class="k-wolse"></u>월세</span><span class="note">꽉 채움 = 내 매물 · 테두리 = 타부동산 · 흐림 = 보류 · 회색✓ = 최근 계약 · ● 만기 임박</span></div>`;
    const ground = `<tr class="gnd"><th></th><td colspan="${lines.length}"><i></i></td><td class="ftr"></td></tr>`;
    box.innerHTML = part + cnt + legend + `<div class="scroll"><table class="grid bldg"><thead>${head}</thead><tbody>${body}${ground}</tbody></table></div>`;
    if ($('dj_retry')) $('dj_retry').onclick = retry;
    const LX = {}; lines.forEach(l => { LX[l] = lineEx(l); });
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
    $('djShTitle').textContent = `${dong}${/동$/.test(dong) ? '' : '동'} ${normH(ho)}호`;
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
  const TLB = ['소유자', '배우자', '임차인', '가족', '관리인', '기타'];
  const EMPTY_REC = () => ({ st: { src: '', k: [], hold: false, office: '' }, pr: { sale: 0, jeonse: 0, wd: 0, wr: 0 }, ar: 0, live: '', exp: '', moveIn: '', opt: '', tels: [], note: '', deal: null, hist: [] });
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
  const fieldsOf = r => JSON.parse(JSON.stringify({ st: r.st, pr: r.pr, ar: r.ar || 0, live: r.live, exp: r.exp, moveIn: r.moveIn, opt: r.opt, tels: r.tels, note: r.note }));

  async function saveMemo(cx, key, text) {
    try {
      const j = await post({ op: 'memo', id: cx.id, key, text: text.trim() });
      S.cx = { items: j.items, memos: j.memos };
      toast(text.trim() ? '메모를 저장했습니다' : '메모를 지웠습니다');
      closeSheet(); drawGrid(cx);
    } catch (e) { toast(e.message, 3500); }
  }
  function closeSheet() { const f = S.onClose; S.onClose = null; $('djSheet').hidden = true; document.body.style.overflow = ''; if (f) f(); }

  return { mount, refresh, add };
})();
