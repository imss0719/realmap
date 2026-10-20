// 리얼맵 내 매물장 (PRO 회원 전용)
(() => {
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const KIND = { sale: '매매', jeonse: '전세', wolse: '월세' };
  const STAT = { on: '진행 중', hold: '보류', done: '계약 완료' };
  const PTYPES = ['아파트', '빌라', '오피스텔', '주택', '상가', '사무실', '건물', '토지'];
  const S = { me: null, items: [], tab: 'on', kind: 'all', q: '', map: null, pins: new Map(), hl: null, form: null, kakao: false };

  async function api(url, opt) {
    const r = await fetch(url, { credentials: 'same-origin', ...opt });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.ok === false) { const e = new Error(j.message || '잠시 연결이 원활하지 않습니다.'); e.code = j.error; throw e; }
    return j;
  }
  function toast(msg, ms = 2400) { const t = $('toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast.h); toast.h = setTimeout(() => (t.hidden = true), ms); }

  // 만원 → "12억 4,000만"
  function won(man) {
    if (!man) return '';
    const eok = Math.floor(man / 10000), rest = Math.round(man % 10000);
    return (eok ? `${eok}억` : '') + (rest ? `${eok ? ' ' : ''}${rest.toLocaleString()}만` : '') + '원';
  }
  const shortWon = man => !man ? '' : man >= 10000 ? `${(man / 10000).toFixed(man % 10000 ? 1 : 0).replace(/\.0$/, '')}억` : `${man.toLocaleString()}만`;
  function priceText(x) {
    if (x.kind === 'sale') return won(x.price) || '가격 미입력';
    if (x.kind === 'jeonse') return won(x.deposit) || '보증금 미입력';
    return `${shortWon(x.deposit) || '0'} / ${x.rent ? x.rent.toLocaleString() + '만' : '-'}`;
  }
  function pinText(x) {
    const k = KIND[x.kind][0];
    if (x.kind === 'sale') return `${k} ${shortWon(x.price) || '?'}`;
    if (x.kind === 'jeonse') return `${k} ${shortWon(x.deposit) || '?'}`;
    return `${k} ${shortWon(x.deposit) || '0'}/${x.rent || '?'}`;
  }
  const py = m2 => m2 ? `${m2}㎡ (${(m2 / 3.3058).toFixed(1)}평)` : '';
  const ymd = iso => iso ? iso.slice(0, 10).replace(/-/g, '.') : '';

  // ---------- 시작 ----------
  async function init() {
    try { S.me = await api('/api/auth?action=me'); } catch { S.me = { member: false }; }
    if (!S.me.member) return gate('로그인이 필요합니다', '카카오로 로그인하시면 매물장을 이용하실 수 있습니다.', `<a class="btn main" href="/auth/login?r=${encodeURIComponent('/listings.html' + location.search)}">카카오로 로그인</a>`);
    $('who').textContent = `${S.me.nickname || '회원'}님`;
    if (!S.me.pro) return gate('유료회원 전용 기능입니다', '매물장은 PRO 회원에게 제공됩니다. 이용 문의는 realwalkers@naver.com 으로 연락 주세요.', '<a class="btn dark" href="/">리얼맵 지도로 돌아가기</a>');
    layout();
    loadMap();
    try { S.items = (await api('/api/auth?action=listings')).items || []; } catch (e) { toast(e.message, 4000); }
    draw();
    const add = new URLSearchParams(location.search).get('add');
    if (add && /^\d{19}$/.test(add)) { history.replaceState(null, '', '/listings.html'); openForm(null, add); }
  }
  function gate(h, p, btn) { $('root').innerHTML = `<div class="gate"><h2>${h}</h2><p>${p}</p>${btn}</div>`; }

  function layout() {
    $('root').innerHTML = `<div class="wrap">
      <div class="mapbox"><div id="map"></div><div class="legend"><span><i style="background:var(--sale)"></i>매매</span><span><i style="background:var(--jeonse)"></i>전세</span><span><i style="background:var(--wolse)"></i>월세</span><span><i style="background:var(--done)"></i>보류·완료</span></div></div>
      <div class="side" style="display:grid;gap:12px">
        <div class="actions"><button class="btn main" id="addBtn" type="button">＋ 매물 등록</button><button class="btn sub" id="csvBtn" type="button">엑셀로 저장</button></div>
        <div class="tabs" id="tabs"></div>
        <div class="tabs" id="kinds"></div>
        <input class="find" id="find" type="search" placeholder="주소, 건물명, 집주인, 메모로 찾기">
        <div class="list" id="list"></div>
      </div></div>`;
    $('addBtn').onclick = () => openForm(null);
    $('csvBtn').onclick = exportCsv;
    $('find').oninput = e => { S.q = e.target.value.trim(); drawList(); };
  }

  // ---------- 목록 ----------
  function filtered() {
    const q = S.q.toLowerCase();
    return S.items.filter(x => (S.tab === 'all' || x.status === S.tab) && (S.kind === 'all' || x.kind === S.kind)
      && (!q || [x.addr, x.road, x.bname, x.owner, x.phone, x.memo, x.dong, x.ho, x.ptype].join(' ').toLowerCase().includes(q)));
  }
  function draw() { drawTabs(); drawList(); drawPins(); }
  function drawTabs() {
    const c = k => S.items.filter(x => k === 'all' || x.status === k).length;
    $('tabs').innerHTML = ['on', 'hold', 'done', 'all'].map(k => `<button type="button" data-tab="${k}" aria-pressed="${S.tab === k}">${k === 'all' ? '전체' : STAT[k]}<small>${c(k)}</small></button>`).join('');
    $('kinds').innerHTML = ['all', 'sale', 'jeonse', 'wolse'].map(k => `<button type="button" data-kind="${k}" aria-pressed="${S.kind === k}">${k === 'all' ? '모든 거래' : KIND[k]}</button>`).join('');
    $('tabs').querySelectorAll('button').forEach(b => b.onclick = () => { S.tab = b.dataset.tab; draw(); });
    $('kinds').querySelectorAll('button').forEach(b => b.onclick = () => { S.kind = b.dataset.kind; draw(); });
  }
  function drawList() {
    const rows = filtered();
    if (!S.items.length) { $('list').innerHTML = `<div class="empty"><b>아직 등록한 매물이 없습니다</b>위의 <b style="display:inline">＋ 매물 등록</b>을 누르고 주소만 입력해 보세요.<br>리얼맵 지도에서 필지를 누른 뒤 '매물 등록'을 눌러도 됩니다.</div>`; return; }
    if (!rows.length) { $('list').innerHTML = '<div class="empty">조건에 맞는 매물이 없습니다.</div>'; return; }
    $('list').innerHTML = rows.map(x => `<div class="card${x.status === 'done' ? ' done' : ''}${S.hl === x.id ? ' hl' : ''}" id="c_${x.id}">
      <div class="ch"><span class="kd ${x.kind}">${KIND[x.kind]}</span>${x.ptype ? `<span class="pt">${esc(x.ptype)}</span>` : ''}<span class="st ${x.status}">${STAT[x.status]}</span></div>
      <div class="price">${esc(priceText(x))}</div>
      <div class="addr">${esc(x.bname ? x.bname + ' ' : '')}${esc([x.dong && x.dong + (/동$/.test(x.dong) ? '' : '동'), x.ho && x.ho + (/호$/.test(x.ho) ? '' : '호')].filter(Boolean).join(' '))}</div>
      <div class="meta">${esc(x.addr)}${x.area ? ' · 전용 ' + esc(py(x.area)) : ''}</div>
      ${x.owner || x.phone ? `<div class="owner"><span>집주인 <b>${esc(x.owner || '-')}</b></span>${x.phone ? `<a class="tel" href="tel:${esc(x.phone)}">📞 ${esc(x.phone)}</a>` : ''}</div>` : ''}
      ${x.memo ? `<div class="memo">${esc(x.memo)}</div>` : ''}
      <div class="cbtns">
        <button type="button" data-edit="${x.id}">수정</button>
        <button type="button" data-next="${x.id}">${x.status === 'on' ? '계약 완료로' : '진행 중으로'}</button>
        <a href="/?pnu=${x.pnu}" target="_blank" rel="noopener">리얼맵 정보</a>
      </div>
      <div class="meta" style="margin-top:8px;font-size:13px">등록 ${ymd(x.at)}${x.up !== x.at ? ' · 수정 ' + ymd(x.up) : ''}</div>
    </div>`).join('');
    $('list').querySelectorAll('[data-edit]').forEach(b => b.onclick = () => openForm(S.items.find(x => x.id === b.dataset.edit)));
    $('list').querySelectorAll('[data-next]').forEach(b => b.onclick = async () => {
      const x = S.items.find(i => i.id === b.dataset.next); const st = x.status === 'on' ? 'done' : 'on';
      try { S.items = (await api('/api/auth?action=listing', post({ op: 'status', id: x.id, status: st }))).items; draw(); toast(`${STAT[st]}(으)로 바꿨습니다`); } catch (e) { toast(e.message, 4000); }
    });
    $('list').querySelectorAll('.card').forEach(c => c.onclick = e => { if (e.target.closest('button,a')) return; focusItem(c.id.slice(2), false); });
  }
  const post = body => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

  // ---------- 지도 ----------
  async function loadMap() {
    try {
      const cfg = await api('/api/config');
      if (!cfg.kakaoKey) return;
      const sc = document.createElement('script');
      sc.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${encodeURIComponent(cfg.kakaoKey)}&libraries=services&autoload=false`;
      sc.onload = () => kakao.maps.load(() => {
        S.kakao = true;
        S.map = new kakao.maps.Map($('map'), { center: new kakao.maps.LatLng(37.5563, 126.9236), level: 6 });
        S.map.addControl(new kakao.maps.ZoomControl(), kakao.maps.ControlPosition.RIGHT);
        drawPins(true);
        addEventListener('resize', () => { clearTimeout(S.rz); S.rz = setTimeout(() => S.map && S.map.relayout(), 200); });
      });
      document.head.appendChild(sc);
    } catch { /* 지도 없이도 목록은 됩니다 */ }
  }
  function drawPins(fit) {
    if (!S.map) return;
    S.pins.forEach(p => p.setMap(null)); S.pins.clear();
    const rows = filtered().filter(x => x.lat && x.lng);
    const bounds = new kakao.maps.LatLngBounds();
    rows.forEach(x => {
      const el = document.createElement('div');
      el.className = `pin ${x.status === 'on' ? x.kind : x.status}${S.hl === x.id ? ' hl' : ''}`;
      el.textContent = pinText(x);
      el.onclick = () => focusItem(x.id, true);
      const pos = new kakao.maps.LatLng(x.lat, x.lng);
      const ov = new kakao.maps.CustomOverlay({ position: pos, content: el, yAnchor: 1, zIndex: S.hl === x.id ? 5 : 1 });
      ov.setMap(S.map); S.pins.set(x.id, ov); bounds.extend(pos);
    });
    if (fit !== false && rows.length) { if (rows.length === 1) { S.map.setCenter(new kakao.maps.LatLng(rows[0].lat, rows[0].lng)); S.map.setLevel(4); } else S.map.setBounds(bounds, 40, 40, 40, 40); }
  }
  function focusItem(id, scroll) {
    S.hl = id; const x = S.items.find(i => i.id === id);
    document.querySelectorAll('.card.hl').forEach(c => c.classList.remove('hl'));
    const c = $('c_' + id); if (c) { c.classList.add('hl'); if (scroll) c.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
    drawPins(false);
    if (S.map && x && x.lat) S.map.panTo(new kakao.maps.LatLng(x.lat, x.lng));
  }

  // ---------- 등록 · 수정 ----------
  function guessType(t) {
    if (!t) return '토지';
    const u = `${t.use || ''} ${t.etcUse || ''}`;
    if (/아파트/.test(u)) return '아파트';
    if (/다세대|연립/.test(u)) return '빌라';
    if (/오피스텔/.test(u)) return '오피스텔';
    if (/단독|다가구|다중주택/.test(u)) return '주택';
    if (/업무/.test(t.use || '')) return '사무실';
    if (/근린|판매/.test(u)) return '상가';
    return '건물';
  }
  function mainTitle(b) {
    const ts = (b && b.titles && b.titles.data) || [];
    return ts.filter(t => t.mainAtch !== '부속건축물').sort((a, b) => (b.totArea || 0) - (a.totArea || 0))[0] || ts[0] || null;
  }
  function centroid(g) {
    try { const ring = g.type === 'MultiPolygon' ? g.coordinates[0][0] : g.coordinates[0]; let x = 0, y = 0; ring.forEach(p => { x += p[0]; y += p[1]; }); return { lng: x / ring.length, lat: y / ring.length }; } catch { return null; }
  }
  // 건축물대장 → 건물 이름·유형, 집합건물이면 동·호 목록 준비 (수정할 때도 씁니다)
  async function loadBld(F, pnu) {
    try {
      const b = await api(`/api/building?pnu=${pnu}`);
      if (S.form !== F) return;
      const t = mainTitle(b), rc = b.recap && b.recap.data && b.recap.data[0];
      collect();
      F.info = t ? { name: (rc && rc.name) || t.name || '', use: t.use, grnd: t.grnd, ugrnd: t.ugrnd, tot: t.totArea, apr: t.useAprDay, road: t.road } : { none: true };
      if (!F.it.bname && F.info.name) F.it.bname = F.info.name;
      if (t && t.road && !F.it.road) F.it.road = String(t.road).replace(/^서울특별시\s*/, '서울 ');
      if (!F.touchedType) F.it.ptype = guessType(t);
      // 집합건물(아파트·오피스텔·빌라·집합상가 등)이면 동·호수를 목록에서 고를 수 있게
      const ts = (b.titles && b.titles.data) || [];
      if (ts.some(x => x.regstr === '집합') || (b.recap && b.recap.data && b.recap.data.length)) {
        const nat = (a, c) => String(a).localeCompare(String(c), 'ko', { numeric: true });
        const dongs = [...new Set(ts.map(x => String(x.dong || '').trim()).filter(Boolean))].sort(nat);
        const want = F.it.dong ? dongs.find(d => d.replace(/동$/, '') === String(F.it.dong).replace(/동$/, '')) : null;
        F.U = { mode: F.edit && !F.it.ho ? 'whole' : 'unit', lists: {}, byDong: dongs.length >= 2, dongs, cur: want || dongs.find(d => /\d/.test(d)) || dongs[0] || '', sel: F.it.ho || '' };
        loadUnits(F, pnu);
      }
    } catch { if (S.form === F) F.info = { none: true, err: true }; }
    if (S.form === F) renderForm(true);
  }
  // 고른 위치 → 필지·건물 정보 채우기
  async function pickPlace(lat, lng, label, pnuIn) {
    const F = S.form;
    F.picking = true; renderForm();
    try {
      let p;
      if (pnuIn) { p = await api(`/api/parcel?pnu=${pnuIn}`); const c = centroid(p.geometry); if (c) { lat = c.lat; lng = c.lng; } }
      else p = await api(`/api/parcel?lat=${lat}&lng=${lng}`);
      const pnu = p.bldPnu || p.pnu;
      F.it.pnu = pnu; F.it.addr = p.addr || label || ''; F.it.lat = lat; F.it.lng = lng;
      F.info = null; F.picking = false; renderForm();
      await loadBld(F, pnu);
    } catch (e) { F.picking = false; toast('그 위치의 필지를 찾지 못했습니다. 다른 주소로 검색해 주세요.', 3500); renderForm(); }
  }
  async function loadUnits(F, pnu) {
    const U = F.U; if (!U) return;
    const key = U.byDong ? U.cur : '*';
    if (U.lists[key]) return;
    U.lists[key] = 'loading'; renderForm(true);
    try {
      const j = await api(`/api/units?pnu=${pnu}${U.byDong ? '&dong=' + encodeURIComponent(U.cur) : ''}`);
      const units = j.units || [];
      if (!U.byDong) { // 전체 목록에서 동 이름을 뽑습니다
        U.dongs = [...new Set(units.map(u => String(u.dong || '').trim()))];
        if (!U.dongs.includes(U.cur)) U.cur = U.dongs.find(d => /\d/.test(d)) || U.dongs[0] || '';
      }
      U.lists[key] = units;
    } catch { U.lists[key] = 'error'; }
    if (S.form === F) renderForm();
  }
  async function pickUnit(F, ho) {
    const U = F.U, it = F.it;
    collect();
    if (!ho) { it.ho = ''; U.msg = ''; return renderForm(true); }
    it.dong = U.cur.replace(/동$/, ''); it.ho = ho; U.sel = ho; U.msg = '전용면적을 불러오는 중…';
    renderForm(true);
    try {
      const j = await api(`/api/units?pnu=${it.pnu}&dong=${encodeURIComponent(U.cur)}&ho=${encodeURIComponent(ho)}`);
      const rows = (j.area && j.area.ok && j.area.data) || [];
      const ex = rows.filter(r => /전유/.test(r.gb || '')).reduce((a, r) => a + (r.area || 0), 0);
      if (S.form !== F || U.sel !== ho) return;
      collect();
      if (ex > 0) { it.area = Math.round(ex * 100) / 100; U.msg = `전용 ${it.area}㎡ (${(it.area / 3.3058).toFixed(1)}평) 자동 입력했습니다`; }
      else U.msg = '전용면적 정보가 없어 직접 입력해 주세요';
    } catch { if (S.form === F) { collect(); U.msg = '전용면적을 불러오지 못했습니다. 직접 입력해 주세요'; } }
    if (S.form === F) renderForm(true);
  }
  function unitPicker(F) {
    const U = F.U; if (!U) return '';
    const key = U.byDong ? U.cur : '*', L = U.lists[key];
    const units = Array.isArray(L) ? L.filter(u => !U.byDong ? String(u.dong || '').trim() === U.cur : true) : [];
    const showDong = U.dongs.length >= 2;
    let body = '';
    if (U.mode === 'unit') {
      const dongSel = showDong ? `<select class="in" id="u_dong" aria-label="동 선택">${U.dongs.map(d => `<option ${d === U.cur ? 'selected' : ''}>${esc(d)}</option>`).join('')}</select>` : '';
      const hoSel = L === 'loading' || !L ? '<select class="in" disabled><option>호 목록 불러오는 중…</option></select>'
        : L === 'error' ? '<select class="in" disabled><option>목록을 불러오지 못했습니다</option></select>'
        : !units.length ? '<select class="in" disabled><option>호 정보가 없습니다</option></select>'
        : `<select class="in" id="u_ho" aria-label="호 선택"><option value="">호수 선택</option>${units.map(u => `<option value="${esc(u.ho)}" ${U.sel === u.ho ? 'selected' : ''}>${esc(u.ho)}${u.flr != null ? ` (${u.flrGb === '지하' ? 'B' : ''}${u.flr}층)` : ''}</option>`).join('')}</select>`;
      body = `<div class="${showDong ? 'two' : ''}" style="margin-top:8px">${dongSel ? `<div>${dongSel}</div>` : ''}<div>${hoSel}</div></div><div class="hint">${esc(U.msg || '')}</div>`;
    }
    return `<div class="fld"><span class="lb">동·호수<small>목록에서 고르면 전용면적이 자동으로 들어갑니다</small></span>
      <div class="seg" id="fWhole"><button type="button" data-v="unit" aria-pressed="${U.mode === 'unit'}">호수 고르기</button><button type="button" data-v="whole" aria-pressed="${U.mode === 'whole'}">건물 전체</button></div>${body}</div>`;
  }
  function search(q) {
    const F = S.form;
    if (!S.kakao || !q) return;
    F.results = null; renderForm();
    const out = [];
    let left = 2;
    const done = () => { if (--left) return; const seen = new Set(); F.results = out.filter(r => { const k = r.lat.toFixed(5) + r.lng.toFixed(5); if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 8); renderForm(); };
    new kakao.maps.services.Geocoder().addressSearch(q, (r, st) => { if (st === 'OK') r.forEach(a => out.push({ t: a.address_name, s: a.road_address ? a.road_address.address_name : '', lat: +a.y, lng: +a.x })); done(); });
    new kakao.maps.services.Places().keywordSearch(q, (r, st) => { if (st === 'OK') r.slice(0, 6).forEach(a => out.push({ t: a.place_name, s: a.address_name, lat: +a.y, lng: +a.x })); done(); });
  }
  function openForm(item, pnu) {
    S.form = { edit: !!item, it: item ? { ...item } : { kind: 'sale', status: 'on', ptype: '' }, results: null, info: null, picking: false, touchedType: !!item };
    $('shTitle').textContent = item ? '매물 수정' : '매물 등록';
    $('sheet').hidden = false; document.body.style.overflow = 'hidden';
    $('form').innerHTML = '';
    renderForm();
    if (pnu) pickPlace(null, null, '', pnu);
    else if (item) loadBld(S.form, item.pnu);
    else if (!item) setTimeout(() => $('fq') && $('fq').focus(), 50);
  }
  function closeForm() { $('sheet').hidden = true; document.body.style.overflow = ''; S.form = null; }
  $('shClose').onclick = closeForm;
  $('sheet').onclick = e => { if (e.target === $('sheet')) closeForm(); };

  function renderForm(skipCollect) {
    const F = S.form; if (!F) return;
    if (!skipCollect) collect(); // 다시 그리기 전에 입력 중인 값을 먼저 담아 둡니다
    const it = F.it;
    const keep = {}; ['fq'].forEach(id => { if ($(id)) keep[id] = $(id).value; });
    const place = it.pnu
      ? `<div class="picked"><b>${esc(it.bname || it.addr)}</b><div class="meta">${esc(it.addr)}</div>
          ${F.info && !F.info.none ? `<div class="meta">${esc([F.info.use, F.info.grnd ? `지상 ${F.info.grnd}층${F.info.ugrnd ? '·지하 ' + F.info.ugrnd + '층' : ''}` : '', F.info.apr ? `사용승인 ${String(F.info.apr).slice(0, 4)}년` : ''].filter(Boolean).join(' · '))}</div>` : F.info && F.info.none && !F.info.err ? '<div class="meta">건축물대장이 없는 필지입니다 (토지)</div>' : F.info ? '' : '<div class="meta">건물 정보를 불러오는 중…</div>'}
          ${F.edit ? '' : '<button type="button" id="rePick">주소 다시 고르기</button>'}</div>`
      : `<input class="in" id="fq" type="search" placeholder="예) 동교동 165-8, 마포래미안푸르지오" enterkeyhint="search">
         <button class="btn dark" id="fqBtn" type="button" style="width:100%;margin-top:8px">주소 찾기</button>
         ${F.picking ? '<div class="meta" style="margin-top:8px">필지를 찾는 중…</div>' : ''}
         ${F.results ? (F.results.length ? `<div class="res">${F.results.map((r, i) => `<button type="button" data-r="${i}"><b>${esc(r.t)}</b><small>${esc(r.s)}</small></button>`).join('')}</div>` : '<div class="meta" style="margin-top:8px">검색 결과가 없습니다. 지번이나 도로명으로 다시 입력해 보세요.</div>') : ''}`;
    const priceF = it.kind === 'sale'
      ? fieldMoney('price', '매매가', it.price)
      : it.kind === 'jeonse' ? fieldMoney('deposit', '전세 보증금', it.deposit)
      : `<div class="two">${fieldMoney('deposit', '보증금', it.deposit)}${fieldMoney('rent', '월세', it.rent)}</div>`;
    $('form').innerHTML = `
      <div class="fld"><span class="lb">주소<small>지번·도로명·건물명 모두 됩니다</small></span>${place}</div>
      ${it.pnu ? `
      <div class="fld"><span class="lb">거래 종류</span><div class="seg" id="fKind">${Object.entries(KIND).map(([k, v]) => `<button type="button" data-v="${k}" aria-pressed="${it.kind === k}">${v}</button>`).join('')}</div></div>
      <div class="fld">${priceF}</div>
      <div class="fld"><span class="lb">매물 유형</span><div class="seg" id="fType">${PTYPES.map(v => `<button type="button" data-v="${v}" aria-pressed="${it.ptype === v}">${v}</button>`).join('')}</div></div>
      <div class="fld"><label for="f_bname">건물 이름<small>선택</small></label><input class="in" id="f_bname" value="${esc(it.bname || '')}" maxlength="40"></div>
      ${F.U ? unitPicker(F) : ''}
      <div class="two"><div class="fld"><label for="f_dong">동<small>선택</small></label><input class="in" id="f_dong" value="${esc(it.dong || '')}" maxlength="20" placeholder="101"></div>
        <div class="fld"><label for="f_ho">호 · 층<small>선택</small></label><input class="in" id="f_ho" value="${esc(it.ho || '')}" maxlength="20" placeholder="1203"></div></div>
      <div class="fld"><label for="f_area">전용면적<small>선택</small></label><div class="unit"><input class="in" id="f_area" inputmode="decimal" value="${it.area || ''}"><span>㎡</span></div><div class="hint" id="h_area">${it.area ? (it.area / 3.3058).toFixed(1) + '평' : ''}</div></div>
      <div class="two"><div class="fld"><label for="f_owner">집주인</label><input class="in" id="f_owner" value="${esc(it.owner || '')}" maxlength="20" placeholder="홍길동"></div>
        <div class="fld"><label for="f_phone">연락처</label><input class="in" id="f_phone" type="tel" inputmode="tel" value="${esc(it.phone || '')}" maxlength="20" placeholder="010-0000-0000"></div></div>
      <div class="fld"><label for="f_memo">메모<small>입주 가능일, 비밀번호, 특이사항 등</small></label><textarea class="in" id="f_memo" rows="3" maxlength="1000">${esc(it.memo || '')}</textarea></div>
      <div class="fld"><span class="lb">상태</span><div class="seg" id="fStat">${Object.entries(STAT).map(([k, v]) => `<button type="button" data-v="${k}" aria-pressed="${it.status === k}">${v}</button>`).join('')}</div></div>
      <div class="saveRow">${F.edit ? '<button class="btn danger" id="fDel" type="button">삭제</button>' : ''}<button class="btn main" id="fSave" type="button">저장하기</button></div>` : ''}`;
    // 이벤트
    if ($('fq')) {
      if (keep.fq) $('fq').value = keep.fq;
      const go = () => search($('fq').value.trim());
      $('fqBtn').onclick = go; $('fq').onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); go(); } };
      document.querySelectorAll('[data-r]').forEach(b => b.onclick = () => { const r = F.results[+b.dataset.r]; F.results = null; pickPlace(r.lat, r.lng, r.t); });
    }
    if ($('rePick')) $('rePick').onclick = () => { collect(); F.it.pnu = ''; F.it.bname = ''; F.info = null; F.U = null; F.touchedType = false; renderForm(true); };
    if (!it.pnu) return;
    const seg = (id, key, after) => $(id).querySelectorAll('button').forEach(b => b.onclick = () => { collect(); F.it[key] = b.dataset.v; if (after) after(); renderForm(true); });
    seg('fKind', 'kind'); seg('fType', 'ptype', () => (F.touchedType = true)); seg('fStat', 'status');
    document.querySelectorAll('[data-money]').forEach(inp => inp.oninput = () => { $('h_' + inp.id.slice(2)).textContent = won(num(inp.value)); });
    $('f_area').oninput = () => { const v = num($('f_area').value); $('h_area').textContent = v ? (v / 3.3058).toFixed(1) + '평' : ''; };
    $('f_phone').oninput = () => { const d = $('f_phone').value.replace(/\D/g, ''); if (/^01\d{8,9}$/.test(d)) $('f_phone').value = d.length === 11 ? `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}` : `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`; };
    if (F.U) {
      $('fWhole').querySelectorAll('button').forEach(b => b.onclick = () => { collect(); F.U.mode = b.dataset.v; if (b.dataset.v === 'whole') { F.it.dong = ''; F.it.ho = ''; F.U.sel = ''; F.U.msg = ''; } renderForm(true); });
      if ($('u_dong')) $('u_dong').onchange = e => { collect(); F.U.cur = e.target.value; F.U.sel = ''; F.U.msg = ''; renderForm(true); loadUnits(F, F.it.pnu); };
      if ($('u_ho')) $('u_ho').onchange = e => pickUnit(F, e.target.value);
    }
    $('fSave').onclick = save;
    if ($('fDel')) $('fDel').onclick = del;
  }
  const num = v => { const x = Number(String(v || '').replace(/[^\d.]/g, '')); return Number.isFinite(x) && x > 0 ? x : null; };
  function fieldMoney(key, label, val) {
    return `<div><label for="f_${key}" style="display:block;font-weight:700;margin-bottom:6px">${label}<small style="font-weight:500;color:var(--muted);margin-left:6px">만원 단위</small></label>
      <div class="unit"><input class="in" id="f_${key}" data-money inputmode="numeric" value="${val || ''}" placeholder="${key === 'rent' ? '150' : '45000'}"><span>만원</span></div><div class="hint" id="h_${key}">${val ? won(val) : ''}</div></div>`;
  }
  function collect() {
    const F = S.form; if (!F || !F.it.pnu) return;
    const v = id => $(id) ? $(id).value : undefined;
    ['bname', 'dong', 'ho', 'owner', 'phone', 'memo'].forEach(k => { const x = v('f_' + k); if (x !== undefined) F.it[k] = x.trim(); });
    ['price', 'deposit', 'rent', 'area'].forEach(k => { const x = v('f_' + k); if (x !== undefined) F.it[k] = num(x); });
  }
  async function save() {
    collect();
    const it = S.form.it;
    if (it.kind === 'sale' && !it.price) return toast('매매가를 입력해 주세요');
    if (it.kind !== 'sale' && !it.deposit && !it.rent) return toast('보증금이나 월세를 입력해 주세요');
    $('fSave').disabled = true; $('fSave').textContent = '저장 중…';
    try {
      const j = await api('/api/auth?action=listing', post({ op: 'save', id: S.form.edit ? it.id : '', item: it }));
      const wasEdit = S.form.edit; S.items = j.items; closeForm();
      if (!wasEdit) { S.tab = it.status; S.kind = 'all'; }
      draw(); if (!wasEdit) focusItem(S.items[0].id, true);
      toast(wasEdit ? '수정했습니다' : '매물장에 등록했습니다');
    } catch (e) { toast(e.message, 4000); $('fSave').disabled = false; $('fSave').textContent = '저장하기'; }
  }
  async function del() {
    if (!confirm('이 매물을 삭제할까요? 삭제하면 되돌릴 수 없습니다.')) return;
    try { S.items = (await api('/api/auth?action=listing', post({ op: 'del', id: S.form.it.id }))).items; closeForm(); draw(); toast('삭제했습니다'); } catch (e) { toast(e.message, 4000); }
  }

  // ---------- 엑셀(CSV) 저장 ----------
  function exportCsv() {
    if (!S.items.length) return toast('저장할 매물이 없습니다');
    const head = ['상태', '거래', '유형', '주소', '건물명', '동', '호·층', '전용㎡', '전용평', '매매가(만원)', '보증금(만원)', '월세(만원)', '집주인', '연락처', '메모', '등록일', '수정일', '리얼맵 링크'];
    const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const rows = S.items.map(x => [STAT[x.status], KIND[x.kind], x.ptype, x.addr, x.bname, x.dong, x.ho, x.area || '', x.area ? (x.area / 3.3058).toFixed(1) : '', x.price || '', x.deposit || '', x.rent || '', x.owner, x.phone, x.memo, ymd(x.at), ymd(x.up), `https://realmap.online/?pnu=${x.pnu}`].map(q).join(','));
    const blob = new Blob(['﻿' + [head.map(q).join(','), ...rows].join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = `리얼맵_매물장_${new Date().toISOString().slice(0, 10)}.csv`; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    toast('엑셀 파일로 저장했습니다');
  }

  init();
})();
