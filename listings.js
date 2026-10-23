// 리얼맵 내 매물장 (PRO 회원 전용)
(() => {
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const KIND = { sale: '매매', jeonse: '전세', wolse: '월세', presale: '분양권' };
  const STAT = { on: '진행 중', hold: '보류', done: '거래완료' };
  const PTYPES = ['아파트', '빌라', '오피스텔', '주택', '상가', '사무실', '건물', '공장·창고', '토지', '기타'];
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
    if (x.kind === 'presale') return x.pr ? `P ${shortWon(x.pr)}${x.price ? ` · 분양가 ${shortWon(x.price)}` : ''}` : won(x.price) || '금액 미입력';
    return `${shortWon(x.deposit) || '0'} / ${x.rent ? x.rent.toLocaleString() + '만' : '-'}`;
  }
  function pinText(x) {
    const k = KIND[x.kind][0];
    if (x.kind === 'sale') return `${k} ${shortWon(x.price) || '?'}`;
    if (x.kind === 'jeonse') return `${k} ${shortWon(x.deposit) || '?'}`;
    if (x.kind === 'presale') return `분 P${shortWon(x.pr) || '?'}`;
    return `${k} ${shortWon(x.deposit) || '0'}/${x.rent || '?'}`;
  }
  const py = m2 => m2 ? `${m2}㎡ (${(m2 / 3.3058).toFixed(1)}평)` : '';
  const ymd = iso => iso ? iso.slice(0, 10).replace(/-/g, '.') : '';

  // ---------- 글씨 크기 (가− / 가+), 이 기기에 기억 ----------
  const FZ = [0.75, 0.8, 0.9, 1, 1.1, 1.2, 1.32];
  function setFz(i) {
    i = Math.max(0, Math.min(FZ.length - 1, i)); S.fz = i;
    document.documentElement.style.setProperty('--fz', FZ[i]);
    try { localStorage.setItem('rm.fz2', String(i)); } catch { /* 무시 */ }
    $('fzDn').disabled = i === 0; $('fzUp').disabled = i === FZ.length - 1;
  }
  (() => { let i = 3; try { const v = localStorage.getItem('rm.fz2'); const o = localStorage.getItem('rm.fz'); if (v !== null) i = +v; else if (o !== null) i = +o + 2; } catch { /* 무시 */ } setFz(i); $('fzDn').onclick = () => setFz(S.fz - 1); $('fzUp').onclick = () => setFz(S.fz + 1); })();

  // ---------- 시작 ----------
  async function init() {
    try { S.me = await api('/api/auth?action=me'); } catch { S.me = { member: false }; }
    if (!S.me.member) return gate('로그인이 필요합니다', '카카오로 로그인하시면 매물장을 이용하실 수 있습니다.', `<a class="btn main" href="/auth/login?r=${encodeURIComponent('/listings.html' + location.search)}">카카오로 로그인</a>`);
    $('who').textContent = `${S.me.nickname || '회원'}님`;
    if (!S.me.pro) return gate('유료회원 전용 기능입니다', '매물장은 PRO 회원에게 제공됩니다. 이용 문의는 realwalkers@naver.com 으로 연락 주세요.', '<a class="btn dark" href="/">리얼맵 지도로 돌아가기</a>');
    layout();
    const th = () => document.documentElement.style.setProperty('--toph', document.querySelector('.top').offsetHeight + 'px');
    th(); addEventListener('resize', th);
    loadMap();
    try { const j = await api('/api/auth?action=listings'); S.items = j.items || []; S.bk = j.bk || null; S.canPub = !!j.canPub; } catch (e) { toast(e.message, 4000); }
    draw();
    const qs = new URLSearchParams(location.search), add = qs.get('add'), edit = qs.get('edit'), cxadd = qs.get('cxadd');
    let mode = qs.get('mode'); if (!mode) { try { mode = localStorage.getItem('rm.lsmode'); } catch { /* 무시 */ } }
    setMode(cxadd ? 'danji' : mode);
    // 리얼맵 지도에서 '단지에 담기'로 넘어온 경우: ?cxadd=PNU
    if (cxadd && /^\d{19}$/.test(cxadd)) { history.replaceState(null, '', '/listings.html'); window.Danji && Danji.add(cxadd); }
    // 단지 장부에서 넘어온 경우: ?add=PNU&dong=101&ho=1203 (동·호까지 미리 골라 둠) · ?edit=매물id
    if (add && /^\d{19}$/.test(add)) { history.replaceState(null, '', '/listings.html'); openForm(null, add, { dong: (qs.get('dong') || '').slice(0, 20), ho: (qs.get('ho') || '').slice(0, 20) }); }
    else if (edit) { history.replaceState(null, '', '/listings.html'); const x = S.items.find(i => i.id === edit); if (x) openForm(x); }
  }
  function gate(h, p, btn) { $('root').innerHTML = `<div class="gate"><h2>${h}</h2><p>${p}</p>${btn}</div>`; }

  function layout() {
    $('root').innerHTML = `<div class="wrap">
      <div class="mapbox"><div id="map"></div><div class="dj" id="dj" hidden></div><div class="lv" id="lv" hidden></div><div class="legend"><span><i style="background:var(--sale)"></i>매매</span><span><i style="background:var(--jeonse)"></i>전세</span><span><i style="background:var(--wolse)"></i>월세</span><span><i style="background:var(--presale)"></i>분양권</span><span><i style="background:var(--done)"></i>보류·완료</span></div></div>
      <div class="side" style="display:grid;gap:12px">
        <div class="actions"><button class="btn main" id="addBtn" type="button">＋ 매물 등록</button><button class="btn sub" id="csvBtn" type="button">엑셀로 저장</button></div>
        <div id="bkLine"></div>
        <div class="tabs" id="tabs"></div>
        <div class="tabs" id="kinds"></div>
        <input class="find" id="find" type="search" placeholder="매물번호, 주소, 건물명, 연락처, 메모로 찾기">
        <div class="list" id="list"></div>
      </div></div>`;
    $('addBtn').onclick = () => openForm(null);
    $('csvBtn').onclick = () => exportCsv();
    $('find').oninput = e => { S.q = e.target.value.trim(); drawList(); };
    document.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => setMode(b.dataset.mode));
  }
  // ---------- 지도 모드 / 단지 모드 (오른쪽 매물 목록은 그대로, 왼쪽 화면만 바뀜) ----------
  const DJ_HOST = {
    items: () => S.items,
    openAdd: (pnu, dong, ho) => openForm(null, pnu, { dong, ho }),
    openEdit: id => { const x = S.items.find(i => i.id === id); if (x) { focusItem(id, true); openForm(x); } },
    toast,
  };
  function setMode(m) {
    S.mode = ['danji', 'list'].includes(m) ? m : 'map';
    try { localStorage.setItem('rm.lsmode', S.mode); } catch { /* 무시 */ }
    const dj = S.mode === 'danji', lv = S.mode === 'list';
    document.body.classList.toggle('djmode', dj); document.body.classList.toggle('lvmode', lv);
    if (!lv) document.body.classList.remove('lvwide');
    $('dj').hidden = !dj; $('lv').hidden = !lv; $('map').style.visibility = dj || lv ? 'hidden' : '';
    document.querySelectorAll('[data-mode]').forEach(b => b.setAttribute('aria-pressed', b.dataset.mode === S.mode));
    if (dj) window.Danji && Danji.mount($('dj'), DJ_HOST);
    else if (lv) drawLv();
    else setTimeout(() => { if (S.map) { S.map.relayout(); drawPins(); } }, 50);
    drawList();
  }

  // ---------- 리스트 모드: 표로 정렬 · 필터(손님 조건) · 묶어 보기 · 한꺼번에 처리 ----------
  const LV = (() => { let v = null; try { v = JSON.parse(localStorage.getItem('rm.lv') || 'null'); } catch { /* 무시 */ } return Object.assign({ sort: 'at', dir: -1, grp: '', f: {}, cols: ['phone'], sel: [] }, v || {}, { sel: [] }); })();
  const lvSave = () => { try { localStorage.setItem('rm.lv', JSON.stringify({ ...LV, sel: [] })); } catch { /* 무시 */ } };
  const mainP = x => x.kind === 'sale' ? x.price : x.kind === 'presale' ? (x.price || x.pr) : x.deposit;     // 만원
  const pyOf = x => x.area ? x.area / 3.3058 : null;
  const unitsOf = x => (x.places && x.places.length ? x.places : [x]).map(p => [p.dong && normDong(p.dong), p.ho && String(p.ho).replace(/호$/, '') + '호'].filter(Boolean).join(' ')).filter(Boolean);
  const normDong = d => /동$/.test(d) ? d : d + '동';
  const hood = x => { const a = String(x.addr || (x.places && x.places[0] && x.places[0].addr) || ''); return (a.split(' ').find(w => /(동|가|리|읍|면)\d*$/.test(w) && !/[시군구]$/.test(w)) || '').replace(/\d+가$/, '가'); };
  function lvPass(x) {
    const f = LV.f, p = mainP(x), py = pyOf(x);
    if (f.pmin && !(p >= f.pmin)) return false;
    if (f.pmax && !(p && p <= f.pmax)) return false;
    if (f.rmax && x.kind === 'wolse' && !(x.rent <= f.rmax)) return false;
    if (f.amin && !(py >= f.amin)) return false;
    if (f.amax && !(py && py <= f.amax)) return false;
    if (f.pt && x.ptype !== f.pt) return false;
    if (f.where) { const w = f.where.replace(/\s/g, '').toLowerCase(); if (![x.addr, x.road, x.bname, JSON.stringify(x.places || '')].join(' ').replace(/\s/g, '').toLowerCase().includes(w)) return false; }
    return true;
  }
  const COLS = [
    ['no', '번호', x => esc(x.no || ''), x => x.no || ''],
    ['kind', '거래', x => `<span class="kd ${x.kind}">${KIND[x.kind]}</span>`, x => x.kind],
    ['ptype', '유형', x => esc(x.ptype === '기타' && x.ptypeTx ? x.ptypeTx : x.ptype || ''), x => x.ptype || ''],
    ['bname', '단지·건물', x => `<b>${esc(x.bname || (x.addr || '').split(' ').slice(-2).join(' '))}</b><small>${esc(hood(x))}</small>`, x => x.bname || x.addr || ''],
    ['unit', '동·호', x => esc(unitsOf(x).slice(0, 2).join(', ')) + (unitsOf(x).length > 2 ? ` 외 ${unitsOf(x).length - 2}` : ''), x => unitsOf(x)[0] || ''],
    ['area', '면적', x => x.area ? `${(x.area / 3.3058).toFixed(1)}평<small>${x.area}㎡</small>` : '', x => x.area || 0],
    ['price', '가격', x => `<b>${esc(priceText(x))}</b>`, x => mainP(x) || 0],
    ['status', '상태', x => `<span class="st ${x.status}">${STAT[x.status]}</span>`, x => x.status],
    ['at', '등록일', x => ymd(x.at).slice(2), x => x.at || ''],
    ['phone', '연락처', x => { const c = (x.contacts && x.contacts[0]) || { name: x.owner, phone: x.phone }; return c && (c.name || c.phone) ? `${esc(c.name || '')}<small>${esc(c.phone || '')}</small>` : ''; }, x => (x.contacts && x.contacts[0] && x.contacts[0].name) || x.owner || '', 1],
    ['mgmt', '관리비', x => x.mgmt ? shortWon(x.mgmt) : '', x => x.mgmt || 0, 1],
    ['memo', '메모', x => `<span class="mm">${esc(x.memo || '')}</span>`, x => x.memo || '', 1],
  ];
  const GRP = { '': '묶지 않음', bname: '단지·건물별', hood: '동네별', kind: '거래별', status: '상태별', ptype: '유형별' };
  const gkey = x => LV.grp === 'bname' ? (x.bname || '이름 없음') : LV.grp === 'hood' ? (hood(x) || '동네 미상') : LV.grp === 'kind' ? KIND[x.kind] : LV.grp === 'status' ? STAT[x.status] : LV.grp === 'ptype' ? (x.ptype || '유형 미입력') : '';
  function drawLv() {
    const box = $('lv'); if (!box || box.hidden) return;
    const cols = COLS.filter(c => !c[4] || LV.cols.includes(c[0]));
    const rows = filtered();
    const col = COLS.find(c => c[0] === LV.sort) || COLS[8];
    rows.sort((a, b) => { const A = col[3](a), B = col[3](b); return (typeof A === 'number' && typeof B === 'number' ? A - B : String(A).localeCompare(String(B), 'ko', { numeric: true })) * LV.dir; });
    const groups = new Map(); rows.forEach(x => { const k = gkey(x); (groups.get(k) || groups.set(k, []).get(k)).push(x); });
    const avg = list => { const by = {}; list.forEach(x => { const p = mainP(x); if (p) (by[x.kind] || (by[x.kind] = [])).push(p); }); return Object.entries(by).map(([k, v]) => `${KIND[k]} ${v.length} · 평균 ${shortWon(Math.round(v.reduce((a, b) => a + b, 0) / v.length))}`).join(' / '); };
    const f = LV.f, on = Object.values(f).some(v => v);
    const sel = new Set(LV.sel);
    const th = cols.map(c => `<th data-sort="${c[0]}" class="${LV.sort === c[0] ? 'on' : ''}">${c[1]}${LV.sort === c[0] ? (LV.dir > 0 ? ' ▲' : ' ▼') : ''}</th>`).join('');
    const tr = x => `<tr id="r_${x.id}" data-id="${x.id}" class="${S.hl === x.id ? 'on' : ''}${x.status === 'done' ? ' dn' : ''}"><td class="ck"><input type="checkbox" data-ck="${x.id}" ${sel.has(x.id) ? 'checked' : ''} aria-label="선택"></td>${cols.map(c => `<td class="c-${c[0]}">${c[2](x)}</td>`).join('')}<td class="ed"><button type="button" data-ed="${x.id}">수정</button></td></tr>`;
    const body = [...groups.entries()].map(([k, list]) => (LV.grp ? `<tr class="gh"><td colspan="${cols.length + 2}"><b>${esc(k)}</b> <span>${list.length}건${avg(list) ? ' · ' + esc(avg(list)) : ''}</span></td></tr>` : '') + list.map(tr).join('')).join('');
    box.innerHTML = `<div class="lv-wrap">
      <div class="lv-f">
        <div class="lv-row"><b>손님 조건</b>
          <label>가격 <input type="number" inputmode="numeric" data-f="pmin" value="${f.pmin || ''}" placeholder="최소"> ~ <input type="number" inputmode="numeric" data-f="pmax" value="${f.pmax || ''}" placeholder="최대"> 만원</label>
          <label>월세 <input type="number" inputmode="numeric" data-f="rmax" value="${f.rmax || ''}" placeholder="이하"> 만원</label>
          <label>면적 <input type="number" inputmode="decimal" data-f="amin" value="${f.amin || ''}" placeholder="최소"> ~ <input type="number" inputmode="decimal" data-f="amax" value="${f.amax || ''}" placeholder="최대"> 평</label>
          <label>유형 <select data-f="pt"><option value="">전체</option>${PTYPES.map(t => `<option ${f.pt === t ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
          <label>지역·단지 <input type="search" data-f="where" value="${esc(f.where || '')}" placeholder="예: 아현동, 래미안"></label>
          ${on ? '<button type="button" class="lnk" id="lvClr">조건 지우기</button>' : ''}</div>
        <div class="lv-row"><label>묶어 보기 <select id="lvGrp">${Object.entries(GRP).map(([k, t]) => `<option value="${k}" ${LV.grp === k ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
          <span class="lv-cols">열 추가 ${COLS.filter(c => c[4]).map(c => `<label class="ck2"><input type="checkbox" data-col="${c[0]}" ${LV.cols.includes(c[0]) ? 'checked' : ''}>${c[1]}</label>`).join('')}</span>
          <span class="sp"></span><b class="cnt">${rows.length}건</b><button type="button" class="lnk" id="lvWide">${document.body.classList.contains('lvwide') ? '카드 다시 보기' : '넓게 보기'}</button></div>
        ${sel.size ? `<div class="lv-row bulk"><b>${sel.size}건 선택</b><button type="button" data-bulk="on">진행 중</button><button type="button" data-bulk="hold">보류</button><button type="button" data-bulk="done">거래완료</button><button type="button" id="lvCsv">선택만 엑셀</button><button type="button" class="lnk" id="lvUnsel">선택 해제</button></div>` : ''}
      </div>
      <div class="lv-t"><table><thead><tr><th class="ck"><input type="checkbox" id="lvAll" aria-label="모두 선택" ${rows.length && rows.every(x => sel.has(x.id)) ? 'checked' : ''}></th>${th}<th></th></tr></thead><tbody>${body || `<tr><td colspan="${cols.length + 2}" class="none">조건에 맞는 매물이 없습니다.</td></tr>`}</tbody></table></div></div>`;
    box.querySelectorAll('[data-sort]').forEach(h => h.onclick = () => { if (LV.sort === h.dataset.sort) LV.dir *= -1; else { LV.sort = h.dataset.sort; LV.dir = ['at', 'price', 'area'].includes(LV.sort) ? -1 : 1; } lvSave(); drawLv(); });
    box.querySelectorAll('[data-f]').forEach(i => i.onchange = () => { const v = i.value.trim(); LV.f[i.dataset.f] = i.dataset.f === 'where' || i.dataset.f === 'pt' ? v : (v ? Number(v) : ''); lvSave(); drawLv(); drawList(); });
    box.querySelectorAll('input[data-f="where"]').forEach(i => i.oninput = () => { clearTimeout(S.lvT); S.lvT = setTimeout(() => { LV.f.where = i.value.trim(); lvSave(); const pos = i.selectionStart; drawLv(); drawList(); const n = $('lv').querySelector('input[data-f="where"]'); if (n) { n.focus(); n.setSelectionRange(pos, pos); } }, 350); });
    if ($('lvClr')) $('lvClr').onclick = () => { LV.f = {}; lvSave(); drawLv(); drawList(); };
    $('lvGrp').onchange = e => { LV.grp = e.target.value; lvSave(); drawLv(); };
    box.querySelectorAll('[data-col]').forEach(c => c.onchange = () => { LV.cols = c.checked ? [...new Set([...LV.cols, c.dataset.col])] : LV.cols.filter(k => k !== c.dataset.col); lvSave(); drawLv(); });
    $('lvWide').onclick = () => { document.body.classList.toggle('lvwide'); drawLv(); };
    box.querySelectorAll('[data-ck]').forEach(c => c.onclick = e => { e.stopPropagation(); LV.sel = c.checked ? [...new Set([...LV.sel, c.dataset.ck])] : LV.sel.filter(i => i !== c.dataset.ck); drawLv(); });
    $('lvAll').onchange = e => { LV.sel = e.target.checked ? rows.map(x => x.id) : []; drawLv(); };
    box.querySelectorAll('[data-ed]').forEach(b => b.onclick = e => { e.stopPropagation(); const x = S.items.find(i => i.id === b.dataset.ed); if (x) openForm(x); });
    box.querySelectorAll('tbody tr[data-id]').forEach(r => r.onclick = e => { if (e.target.closest('input,button')) return; focusItem(r.dataset.id, true); });
    if ($('lvUnsel')) $('lvUnsel').onclick = () => { LV.sel = []; drawLv(); };
    if ($('lvCsv')) $('lvCsv').onclick = () => exportCsv(S.items.filter(x => sel.has(x.id)));
    box.querySelectorAll('[data-bulk]').forEach(b => b.onclick = async () => {
      const st = b.dataset.bulk, ids = [...sel].filter(id => (S.items.find(x => x.id === id) || {}).status !== st);
      if (!ids.length) return toast('이미 그 상태입니다');
      if (!confirm(`${ids.length}건을 '${STAT[st]}' 처리할까요?`)) return;
      let ok = 0;
      for (const id of ids) { try { took(await api('/api/auth?action=listing', post({ op: 'status', id, status: st }))); ok++; } catch (e) { toast(e.message, 3500); break; } }
      LV.sel = []; draw(); toast(`${ok}건을 '${STAT[st]}' 처리했습니다`);
    });
  }

  // ---------- 목록 ----------
  function filtered() {
    const q = S.q.toLowerCase();
    return S.items.filter(x => (S.tab === 'all' || x.status === S.tab) && (S.kind === 'all' || x.kind === S.kind) && (S.mode !== 'list' || lvPass(x))
      && (!q || [x.no, x.addr, x.road, x.bname, x.owner, x.phone, x.memo, x.dong, x.ho, x.ptype, JSON.stringify(x.places || ''), JSON.stringify(x.contacts || ''), JSON.stringify(x.rents || '')].join(' ').toLowerCase().includes(q)));
  }
  function draw() { drawBk(); drawTabs(); drawList(); drawPins(); if (S.mode === 'danji' && window.Danji) Danji.refresh(); if (S.mode === 'list') drawLv(); }
  function drawTabs() {
    const c = k => S.items.filter(x => k === 'all' || x.status === k).length;
    $('tabs').innerHTML = ['on', 'hold', 'done', 'all'].map(k => `<button type="button" data-tab="${k}" aria-pressed="${S.tab === k}">${k === 'all' ? '전체' : STAT[k]}<small>${c(k)}</small></button>`).join('');
    $('kinds').innerHTML = ['all', 'sale', 'jeonse', 'wolse', 'presale'].map(k => `<button type="button" data-kind="${k}" aria-pressed="${S.kind === k}">${k === 'all' ? '모든 거래' : KIND[k]}</button>`).join('');
    $('tabs').querySelectorAll('button').forEach(b => b.onclick = () => { S.tab = b.dataset.tab; draw(); });
    $('kinds').querySelectorAll('button').forEach(b => b.onclick = () => { S.kind = b.dataset.kind; draw(); });
  }
  function drawList() {
    const rows = filtered();
    if (!S.items.length) { $('list').innerHTML = `<div class="empty"><b>아직 등록한 매물이 없습니다</b>위의 <b style="display:inline">＋ 매물 등록</b>을 누르고 주소만 입력해 보세요.<br>리얼맵 지도에서 필지를 누른 뒤 '매물 등록'을 눌러도 됩니다.</div>`; return; }
    if (!rows.length) { $('list').innerHTML = '<div class="empty">조건에 맞는 매물이 없습니다.</div>'; return; }
    $('list').innerHTML = rows.map(x => {
      const pl = Array.isArray(x.places) && x.places.length ? x.places : [{ addr: x.addr, dong: x.dong, ho: x.ho }];
      const cs = Array.isArray(x.contacts) ? x.contacts : x.owner || x.phone ? [{ role: '집주인', name: x.owner, phone: x.phone }] : [];
      const dh = p => [p.dong && p.dong + (/동$/.test(p.dong) ? '' : '동'), p.ho && p.ho + (/(호|층)$/.test(p.ho) ? '' : '호')].filter(Boolean).join(' ');
      const units = pl.map(dh).filter(Boolean);
      const extra = [x.mgmt && `관리비 ${shortWon(x.mgmt)}`, x.premium && `권리금 ${shortWon(x.premium)}`, x.curDep && `기보증금 ${shortWon(x.curDep)}`, x.curRent && `기월세 ${shortWon(x.curRent)}`, x.loan && `${x.kind === 'presale' ? '중도금 대출' : '융자'} ${shortWon(x.loan)}`, x.paid && `납입 ${shortWon(x.paid)}`].filter(Boolean);
      const addrs = [...new Set(pl.map(p => p.addr))];
      return `<div class="card${x.status === 'done' ? ' done' : ''}${S.hl === x.id ? ' hl' : ''}" id="c_${x.id}">
      <div class="ch"><span class="kd ${x.kind}">${KIND[x.kind]}</span>${x.ptype ? `<span class="pt">${esc(x.ptype === '기타' && x.ptypeTx ? x.ptypeTx : x.ptype)}</span>` : ''}${pl.length > 1 ? `<span class="pt">${pl.length}건 묶음</span>` : ''}<span class="st ${x.status}">${STAT[x.status]}</span></div>
      ${x.no ? `<div class="no">No. ${esc(x.no)}</div>` : ''}
      ${Array.isArray(x.photos) && x.photos.length ? `<div class="thumbs">${x.photos.slice(0, 4).map((p, i) => `<button type="button" data-view="${x.id}:${i}"><img src="${esc(p.url)}" alt="" loading="lazy">${i === 3 && x.photos.length > 4 ? `<b>+${x.photos.length - 4}</b>` : ''}</button>`).join('')}</div>` : ''}
      <div class="price">${esc(priceText(x))}</div>
      ${extra.length ? `<div class="meta" style="font-weight:600;color:#33414F">${esc(extra.join(' · '))}</div>` : ''}
      <div class="addr">${esc(x.bname ? x.bname + ' ' : '')}${esc(units.slice(0, 3).join(', '))}${units.length > 3 ? ` 외 ${units.length - 3}` : ''}</div>
      ${(() => { const site = pl.reduce((a, p) => a + (p.ak === 'tot' && p.site || 0), 0), arch = pl.reduce((a, p) => a + (p.ak === 'tot' && p.arch || 0), 0); return site || arch ? `<div class="meta">${[site && '대지 ' + esc(py(Math.round(site * 100) / 100)), arch && '건축 ' + esc(py(Math.round(arch * 100) / 100))].filter(Boolean).join(' · ')}</div>` : ''; })()}
      <div class="meta">${esc(addrs[0] || '')}${addrs.length > 1 ? ` 외 ${addrs.length - 1}필지` : ''}${x.area ? ` · ${(() => { const ks = [...new Set(pl.map(p => p.land ? 'land' : p.ak || 'ex'))]; return ks.length > 1 ? '면적' : ks[0] === 'land' ? '토지' : ks[0] === 'tot' ? '연면적' : '전용'; })()} ${esc(py(x.area))}` : ''}</div>
      ${cs.map(c => `<div class="owner"><span>${esc(c.role || '연락처')} <b>${esc(c.name || '-')}</b></span>${c.phone ? `<a class="tel" href="tel:${esc(c.phone)}">📞 ${esc(c.phone)}</a>` : ''}</div>`).join('')}
      ${Array.isArray(x.rents) && x.rents.length ? `<details class="rents"><summary>${x.kind === 'sale' ? '임대 현황' : '세부 임대료'} ${x.rents.length}건</summary>${x.rents.map(r => `<div><span>${esc(r.label || '-')}${r.memo ? ` <small>${esc(r.memo)}</small>` : ''}</span><b>${shortWon(r.deposit) || '0'} / ${r.rent ? r.rent.toLocaleString() + '만' : '-'}</b></div>`).join('')}</details>` : ''}
      ${x.memo ? `<div class="memo">${esc(x.memo)}</div>` : ''}
      <div class="cbtns">
        <button type="button" data-edit="${x.id}">수정</button>
        <button type="button" data-next="${x.id}">${x.status === 'on' ? '거래완료' : '다시 진행'}</button>
        ${pubBtn(x)}
      </div>
      ${pubLine(x)}
      <div class="meta" style="margin-top:8px;font-size:13px">등록 ${ymd(x.at)}${x.up !== x.at ? ' · 수정 ' + ymd(x.up) : ''} · <a href="/?pnu=${x.pnu}" target="_blank" rel="noopener" style="color:inherit">리얼맵 필지 정보</a><button type="button" class="brf" data-brief="${x.id}" title="이 매물로 손님용 브리핑 자료(A4 · PDF)를 만듭니다">브리핑</button></div>
    </div>`; }).join('');
    $('list').querySelectorAll('[data-view]').forEach(b => b.onclick = () => { const [id, i] = b.dataset.view.split(':'); const x = S.items.find(y => y.id === id); viewer(x.photos.map(p => p.url), +i); });
    $('list').querySelectorAll('[data-edit]').forEach(b => b.onclick = () => openForm(S.items.find(x => x.id === b.dataset.edit)));
    $('list').querySelectorAll('[data-next]').forEach(b => b.onclick = async () => {
      const x = S.items.find(i => i.id === b.dataset.next); const st = x.status === 'on' ? 'done' : 'on';
      try { took(await api('/api/auth?action=listing', post({ op: 'status', id: x.id, status: st }))); draw(); toast(`'${STAT[st]}' 처리했습니다`); } catch (e) { toast(e.message, 4000); }
    });
    $('list').querySelectorAll('[data-pub]').forEach(b => b.onclick = () => pubFlow(S.items.find(x => x.id === b.dataset.pub)));
    $('list').querySelectorAll('[data-brief]').forEach(b => b.onclick = () => briefOf(S.items.find(x => x.id === b.dataset.brief)));
    $('list').querySelectorAll('[data-share]').forEach(b => b.onclick = () => shareOf(S.items.find(x => x.id === b.dataset.share)));
    $('list').querySelectorAll('[data-renew]').forEach(b => b.onclick = () => pubOp(b.dataset.renew, 'renew'));
    $('list').querySelectorAll('[data-unpub]').forEach(b => b.onclick = () => { if (confirm('리얼맵 지도에서 이 매물을 내릴까요? (매물장에는 그대로 남습니다)')) pubOp(b.dataset.unpub, 'unpub'); });
    $('list').querySelectorAll('.card').forEach(c => c.onclick = e => { if (e.target.closest('button,a')) return; focusItem(c.id.slice(2), false); });
  }
  const post = body => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  // 매물장 저장 결과 받기 (게시 중 매물이 필수 항목 부족으로 내려가면 알려 드림)
  function took(j) { S.items = j.items || S.items; if ('bk' in j) S.bk = j.bk; if ('canPub' in j) S.canPub = !!j.canPub; if (j.warn) setTimeout(() => toast(j.warn, 6000), 400); return j; }

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
    // 같은 자리(같은 건물)의 매물은 대각선으로 계단처럼 비켜 놓아 하나씩 누를 수 있게
    const seen = new Map();
    rows.forEach(x => {
      // 같은 필지(PNU)면 같은 자리로 봅니다 (검색 위치가 조금씩 달라도 첫 매물 자리에 맞춰 줄 세움)
      const spot = x.pnu || `${(+x.lat).toFixed(4)},${(+x.lng).toFixed(4)}`;
      const g = seen.get(spot) || { k: 0, lat: x.lat, lng: x.lng };
      const k = g.k; g.k++; seen.set(spot, g);
      const el = document.createElement('div');
      el.className = `pin ${x.status === 'on' ? x.kind : x.status}${S.hl === x.id ? ' hl' : ''}`;
      el.textContent = pinText(x);
      el.style.transform = `translate(${k * 14}px, ${-6 - k * 24}px)`;
      el.onclick = () => focusItem(x.id, true);
      const pos = new kakao.maps.LatLng(g.lat, g.lng);
      const ov = new kakao.maps.CustomOverlay({ position: pos, content: el, yAnchor: 1, zIndex: S.hl === x.id ? 100 : 1 + k });
      el.onmouseenter = () => ov.setZIndex(99); el.onmouseleave = () => ov.setZIndex(S.hl === x.id ? 100 : 1 + k);
      ov.setMap(S.map); S.pins.set(x.id, ov); bounds.extend(pos);
      // 핀을 비켜 그려도 지도가 감싸는 상자는 원래 자리에 남아 아래 핀을 가립니다 → 상자는 클릭을 통과시키고 핀만 누르게
      let w = el.parentElement; if (w && w !== $('map')) w.style.pointerEvents = 'none';
      el.style.pointerEvents = 'auto';
    });
    if (fit !== false && rows.length) { if (rows.length === 1) { S.map.setCenter(new kakao.maps.LatLng(rows[0].lat, rows[0].lng)); S.map.setLevel(4); } else S.map.setBounds(bounds, 40, 40, 40, 40); }
  }
  function focusItem(id, scroll) {
    S.hl = id; const x = S.items.find(i => i.id === id);
    document.querySelectorAll('.card.hl').forEach(c => c.classList.remove('hl'));
    const c = $('c_' + id); if (c) { c.classList.add('hl'); if (scroll) c.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
    document.querySelectorAll('#lv tr.on').forEach(r => r.classList.remove('on')); const r = $('r_' + id); if (r) r.classList.add('on');
    drawPins(false);
    if (S.map && x && x.lat) S.map.panTo(new kakao.maps.LatLng(x.lat, x.lng));
  }

  // ---------- 등록 · 수정 ----------
  // 거래 종류별 금액 칸 [키, 이름, 필수 여부]
  const MONEY = {
    sale: [['price', '매매가', 1], ['curDep', '기보증금', 0], ['curRent', '기월세', 0], ['loan', '융자금', 0], ['mgmt', '관리비 (월)', 0]],
    jeonse: [['deposit', '전세 보증금', 1], ['mgmt', '관리비', 0], ['loan', '융자금 (선순위)', 0]],
    wolse: [['deposit', '보증금', 0], ['rent', '월세', 1], ['mgmt', '관리비', 0], ['premium', '권리금', 0]],
    presale: [['price', '분양가', 1], ['pr', '프리미엄 (P)', 1], ['paid', '납입한 금액', 0], ['loan', '중도금 대출', 0]],
  };
  const ROLES = ['소유자', '임차인', '관리인', '대리인', '기타'];
  // 거래 종류별 금액 칸 + 상가는 어떤 거래든 권리금 칸 (분양권 제외)
  function moneyOf(it) { const m = MONEY[it.kind] || MONEY.sale; return it.ptype === '상가' && it.kind !== 'presale' && !m.some(x => x[0] === 'premium') ? [...m, ['premium', '권리금', 0]] : m; }
  function guessType(t) {
    if (!t) return '토지';
    const u = `${t.use || ''} ${t.etcUse || ''}`;
    if (/아파트/.test(u)) return '아파트';
    if (/다세대|연립/.test(u)) return '빌라';
    if (/오피스텔/.test(u)) return '오피스텔';
    if (/단독|다가구|다중주택/.test(u)) return '주택';
    if (/공장|창고/.test(t.use || '')) return '공장·창고';
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
  const alive = (F, P) => S.form === F && F.it.places.includes(P);

  // 주소 하나의 건축물대장 → 건물 이름·유형, 집합건물이면 동·호 목록, 토지면 토지면적
  async function loadBld(F, P) {
    try {
      const b = await api(`/api/building?pnu=${P.pnu}`);
      if (!alive(F, P)) return;
      collect();
      const t = mainTitle(b), rc = b.recap && b.recap.data && b.recap.data[0];
      P._info = t ? { name: (rc && rc.name) || t.name || '', use: t.use, grnd: t.grnd, ugrnd: t.ugrnd, apr: t.useApr || t.useAprDay, road: t.road } : { none: true };
      if (!P.bname && P._info.name) P.bname = P._info.name;
      const first = F.it.places[0] === P;
      if (first) {
        if (!F.it.bname && P.bname) F.it.bname = P.bname;
        if (t && t.road && !F.it.road) F.it.road = String(t.road).replace(/^서울특별시\s*/, '서울 ');
        if (!F.touchedType) F.it.ptype = guessType(t);
        autoAd(F, P, b, t, rc);
      }
      const ts = (b.titles && b.titles.data) || [];
      // 건물 전체로 할 때 쓸 연면적·대지면적
      P._tot = (rc && rc.totArea) || Math.round(ts.filter(x => x.mainAtch !== '부속건축물').reduce((a, x) => a + (x.totArea || 0), 0) * 100) / 100 || null;
      P._site = (rc && rc.platArea) || (t && t.platArea) || null;
      P._arch = (rc && rc.archArea) || Math.round(ts.filter(x => x.mainAtch !== '부속건축물').reduce((a, x) => a + (x.archArea || 0), 0) * 100) / 100 || null;
      if (ts.some(x => x.regstr === '집합') || (b.recap && b.recap.data && b.recap.data.length)) {
        const nat = (a, c) => String(a).localeCompare(String(c), 'ko', { numeric: true });
        const dongs = [...new Set(ts.map(x => String(x.dong || '').trim()).filter(Boolean))].sort(nat);
        const want = P.dong ? dongs.find(d => d.replace(/동$/, '') === String(P.dong).replace(/동$/, '')) : null;
        P._U = { mode: F.edit && !P.ho ? 'whole' : 'unit', lists: {}, byDong: dongs.length >= 2, dongs, cur: want || dongs.find(d => /\d/.test(d)) || dongs[0] || '', sel: P.ho || '' };
        if (P._U.mode === 'whole' && !P.ak) P.ak = 'tot';
        loadUnits(F, P);
      } else if (t) { // 일반건물(상가건물·다가구 등)은 통째 거래가 보통 → 연면적
        P.ak = 'tot';
        if (!P.area && P._tot) fillTot(P);
      } else { // 건물 없는 땅 → 토지면적
        P.land = true; P.ak = 'land';
        if (!P.area) try { const L = await api(`/api/land?pnu=${P.pnu}`); const ar = L.chr && L.chr.data && L.chr.data.area; if (alive(F, P) && ar && !P.area) { collect(); P.area = ar; P._msg = `토지면적 ${ar}㎡ (${(ar / 3.3058).toFixed(1)}평) 자동 입력했습니다`; } } catch { /* 직접 입력 */ }
      }
    } catch { if (alive(F, P)) P._info = { none: true, err: true }; }
    if (alive(F, P)) renderForm(true);
    if (alive(F, P) && F.it.places[0] === P) autoLand(F, P);
  }
  // ---------- 광고 정보 자동 채우기 (빈 칸만 채우고, 직접 고친 값은 건드리지 않음) ----------
  function setAuto(F, k, v) { const ad = F.it.ad || (F.it.ad = {}); if (v == null || v === '') return; if (ad[k] == null || ad[k] === '' || (F.auto && F.auto.has(k) && !F.touched?.has(k))) { ad[k] = v; (F.auto || (F.auto = new Set())).add(k); } }
  function autoAd(F, P, b, t, rc) {
    if (!t) return;
    const ts = ((b.titles && b.titles.data) || []).filter(x => x.mainAtch !== '부속건축물');
    // 건축물 용도 (건축법 용도 분류): 집합건물에서 호를 고르면 그 층 용도로 다시 맞춤
    setAuto(F, 'use', [t.use, t.etcUse && t.etcUse !== t.use ? t.etcUse : ''].filter(Boolean).join(' · ').slice(0, 40));
    setAuto(F, 'tfl', t.grnd ? String(t.grnd) : '');
    setAuto(F, 'appr', t.useApr ? String(t.useApr).slice(0, 10) : '');
    // 주차: 총괄표제부 → 동별 합계. 아파트·오피스텔은 세대당도 함께
    const pk = x => x ? (x.pkTotal || ((x.pkIn || 0) + (x.pkOut || 0) + (x.pkInMech || 0) + (x.pkOutMech || 0))) : 0;
    const tot = pk(rc) || ts.reduce((a, x) => a + pk(x), 0);
    const hh = (rc && rc.hhld) || ts.reduce((a, x) => a + (x.hhld || 0), 0);
    if (tot) setAuto(F, 'park', hh > 1 && ['아파트', '오피스텔', '빌라'].includes(F.it.ptype) ? `총 ${tot}대 (세대당 ${(tot / hh).toFixed(2).replace(/0$/, '')}대)` : `총 ${tot}대`);
    if (hh > 1) setAuto(F, 'hhld', hh);
    const lift = ts.reduce((a, x) => a + (x.liftP || 0), 0); if (lift) setAuto(F, 'elev', lift);
    if (ts.some(x => /^(y|1|true|위반)/i.test(String(x.viol ?? '')))) { F.it.ad.viol = true; (F.auto || (F.auto = new Set())).add('viol'); }
    // 건물 전체(통)로 거래하면 해당 층 = 전체
    if (P.ak === 'tot' && !P.ho) setAuto(F, 'fl', '전체');
  }
  async function autoLand(F, P) {
    const ad = F.it.ad || (F.it.ad = {});
    if (ad.zone && ad.lp) return;
    try {
      const L = await api(`/api/land?pnu=${P.pnu}`), c = L.chr && L.chr.data;
      if (!c || !alive(F, P)) return;
      collect();
      setAuto(F, 'zone', [c.zone1, c.zone2].filter(Boolean).join(' · '));
      setAuto(F, 'road', c.road || '');
      setAuto(F, 'lp', c.price || null);
      if (F.it.ptype === '토지' || P.land) setAuto(F, 'use', c.jimok || '');
      renderForm(true);
    } catch { /* 직접 입력 */ }
  }
  // 건물 전체: 대지면적 · 건축면적 · 연면적을 한꺼번에
  function fillTot(P) {
    P.area = P._tot || null; P.site = P._site || null; P.arch = P._arch || null;
    P._msg = P._tot || P._site || P._arch ? '건축물대장의 대지·건축·연면적을 자동 입력했습니다' : '면적 정보가 없어 직접 입력해 주세요';
  }
  // 검색 결과(또는 PNU) → 주소 하나 추가
  async function addPlace(lat, lng, label, pnuIn, base) {
    const F = S.form;
    F.picking = true; renderForm();
    try {
      let p;
      if (pnuIn) { p = await api(`/api/parcel?pnu=${pnuIn}`); const c = centroid(p.geometry); if (c) { lat = c.lat; lng = c.lng; } }
      else p = await api(`/api/parcel?lat=${lat}&lng=${lng}`);
      if (S.form !== F) return;
      collect();
      const P = { pnu: p.bldPnu || p.pnu, addr: p.addr || label || '', lat, lng, bname: '', dong: '', ho: '', area: null };
      if (F.preset) { P.dong = String(F.preset.dong || '').replace(/동$/, ''); P.ho = String(F.preset.ho || '').replace(/호$/, ''); F.preset = null; }
      F.it.places.push(P); F.adding = false; F.picking = false; F.results = null;
      renderForm(true);
      await loadBld(F, P);
    } catch { F.picking = false; toast('그 위치의 필지를 찾지 못했습니다. 다른 주소로 검색해 주세요.', 3500); renderForm(); }
  }
  // 같은 건물의 다른 호 (목록은 다시 받지 않고 나눠 씀)
  function cloneUnit(F, i) {
    collect();
    const A = F.it.places[i];
    const P = { pnu: A.pnu, addr: A.addr, lat: A.lat, lng: A.lng, bname: A.bname, dong: A.dong, ho: '', area: null, ak: 'ex', _info: A._info, _tot: A._tot, _site: A._site, _arch: A._arch };
    if (A._U) P._U = { ...A._U, mode: 'unit', sel: '' };
    F.it.places.splice(i + 1, 0, P);
    renderForm(true);
  }
  async function loadUnits(F, P) {
    const U = P._U; if (!U) return;
    const key = U.byDong ? U.cur : '*';
    if (U.lists[key]) return;
    U.lists[key] = 'loading'; renderForm(true);
    try {
      const j = await api(`/api/units?pnu=${P.pnu}${U.byDong ? '&dong=' + encodeURIComponent(U.cur) : ''}`);
      const units = j.units || [];
      if (!U.byDong) {
        U.dongs = [...new Set(units.map(u => String(u.dong || '').trim()))];
        if (!U.dongs.includes(U.cur)) U.cur = U.dongs.find(d => /\d/.test(d)) || U.dongs[0] || '';
      }
      U.lists[key] = units;
      // 미리 고른 호(단지 장부에서 넘어온 경우)는 전용면적까지 바로 채움
      if (U.sel && !P.area && units.some(u => String(u.ho).replace(/호$/, '') === String(U.sel).replace(/호$/, ''))) { const h = units.find(u => String(u.ho).replace(/호$/, '') === String(U.sel).replace(/호$/, '')).ho; if (alive(F, P)) return pickUnit(F, P, h); }
    } catch { U.lists[key] = 'error'; }
    if (alive(F, P)) renderForm();
  }
  async function pickUnit(F, P, ho) {
    const U = P._U;
    collect();
    P.ak = 'ex';
    if (!ho) { P.ho = ''; U.sel = ''; P._msg = ''; return renderForm(true); }
    P.dong = U.cur.replace(/동$/, ''); P.ho = ho; U.sel = ho; P._msg = '전용면적을 불러오는 중…';
    { const L = U.lists[U.byDong ? U.cur : '*'], u = Array.isArray(L) && L.find(z => z.ho === ho); if (u && u.flr != null && F.it.places[0] === P) { F.it.ad = F.it.ad || {}; if (F.it.ad.fl === '전체') F.it.ad.fl = ''; setAuto(F, 'fl', (u.flrGb === '지하' ? 'B' : '') + u.flr); F.it.ad.fl = (u.flrGb === '지하' ? 'B' : '') + u.flr; } }
    renderForm(true);
    try {
      const j = await api(`/api/units?pnu=${P.pnu}&dong=${encodeURIComponent(U.cur)}&ho=${encodeURIComponent(ho)}`);
      const rows = (j.area && j.area.ok && j.area.data) || [];
      const ex = rows.filter(r => /전유/.test(r.gb || '')).reduce((a, r) => a + (r.area || 0), 0);
      if (!alive(F, P) || U.sel !== ho) return;
      collect();
      if (ex > 0) { P.area = Math.round(ex * 100) / 100; P._msg = `전용 ${P.area}㎡ (${(P.area / 3.3058).toFixed(1)}평) 자동 입력했습니다`; }
      else P._msg = '전용면적 정보가 없어 직접 입력해 주세요';
    } catch { if (alive(F, P)) { collect(); P._msg = '전용면적을 불러오지 못했습니다. 직접 입력해 주세요'; } }
    if (alive(F, P)) renderForm(true);
  }
  function unitPicker(P, i) {
    const U = P._U; if (!U) return '';
    const key = U.byDong ? U.cur : '*', L = U.lists[key];
    const units = Array.isArray(L) ? L.filter(u => !U.byDong ? String(u.dong || '').trim() === U.cur : true) : [];
    const showDong = U.dongs.length >= 2;
    let body = '';
    if (U.mode === 'unit') {
      const dongSel = showDong ? `<select class="in" data-udong="${i}" aria-label="동 선택">${U.dongs.map(d => `<option ${d === U.cur ? 'selected' : ''}>${esc(d)}</option>`).join('')}</select>` : '';
      const hoSel = L === 'loading' || !L ? '<select class="in" disabled><option>호 목록 불러오는 중…</option></select>'
        : L === 'error' ? '<select class="in" disabled><option>목록을 불러오지 못했습니다</option></select>'
        : !units.length ? '<select class="in" disabled><option>호 정보가 없습니다</option></select>'
        : `<select class="in" data-uho="${i}" aria-label="호 선택"><option value="">호수 선택</option>${units.map(u => `<option value="${esc(u.ho)}" ${U.sel === u.ho ? 'selected' : ''}>${esc(u.ho)}${u.flr != null ? ` (${u.flrGb === '지하' ? 'B' : ''}${u.flr}층)` : ''}</option>`).join('')}</select>`;
      body = `<div class="${showDong ? 'two' : ''}" style="margin-top:8px">${dongSel ? `<div>${dongSel}</div>` : ''}<div>${hoSel}</div></div>`;
    }
    return `<div class="seg" style="margin-top:10px"><button type="button" data-umode="${i}:unit" aria-pressed="${U.mode === 'unit'}">호수 고르기</button><button type="button" data-umode="${i}:whole" aria-pressed="${U.mode === 'whole'}">건물 전체</button></div>${body}`;
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
  // 예전에 저장한 매물(주소·연락처 하나짜리)도 새 형태로
  function upgrade(x) {
    const it = JSON.parse(JSON.stringify(x));
    if (!Array.isArray(it.places) || !it.places.length) it.places = [{ pnu: x.pnu, addr: x.addr, lat: x.lat, lng: x.lng, bname: x.bname, dong: x.dong, ho: x.ho, area: x.area }];
    if (!Array.isArray(it.contacts)) it.contacts = x.owner || x.phone ? [{ role: '소유자', name: x.owner || '', phone: x.phone || '' }] : [];
    if (!Array.isArray(it.rents)) it.rents = [];
    if (!Array.isArray(it.photos)) it.photos = [];
    it.ad = it.ad || {};
    return it;
  }
  function openForm(item, pnu, preset) {
    if (!item && !pnu && S.draft) { // 닫기 전에 쓰던 내용 이어서
      S.form = S.draft; S.draft = null;
      $('shTitle').textContent = '매물 등록'; $('sheet').hidden = false; document.body.style.overflow = 'hidden'; $('form').innerHTML = '';
      renderForm(true); toast('작성하던 내용을 불러왔습니다'); return;
    }
    if (!item && pnu) S.draft = null;
    S.form = { edit: !!item, it: item ? upgrade(item) : { kind: 'sale', status: 'on', ptype: '', places: [], contacts: [{ role: '소유자', name: '', phone: '' }], rents: [], photos: [], ad: {} }, newPhotos: [], upN: 0, results: null, picking: false, adding: !item, touchedType: !!item };
    S.form.newPhotos = S.form.newPhotos || []; S.form.upN = 0;
    if (!S.form.it.contacts.length) S.form.it.contacts.push({ role: '소유자', name: '', phone: '' });
    $('shTitle').textContent = item ? '매물 수정' : '매물 등록';
    $('sheet').hidden = false; document.body.style.overflow = 'hidden';
    $('form').innerHTML = '';
    renderForm();
    S.form.preset = preset && (preset.dong || preset.ho) ? preset : null;
    if (pnu) addPlace(null, null, '', pnu);
    else if (item) S.form.it.places.forEach(P => loadBld(S.form, P));
    else setTimeout(() => $('fq') && $('fq').focus(), 50);
  }
  function closeForm() { $('sheet').hidden = true; document.body.style.overflow = ''; S.form = null; }
  // 창 바깥을 눌러도 닫히지 않습니다. 닫기(×)를 누르면 한 번 더 묻고, 새로 쓰던 내용은 임시로 보관합니다.
  function dirty(F) { return F && (F.it.places.length || F.it.photos.length || F.it.contacts.some(c => c.name || c.phone) || F.it.memo); }
  $('shClose').onclick = () => {
    const F = S.form; if (!F) return closeForm();
    collect();
    if (dirty(F) && !confirm(F.edit ? '수정한 내용을 저장하지 않고 닫을까요?' : '작성 중인 내용을 저장하지 않고 닫을까요?\n(다시 ＋ 매물 등록을 누르면 이어서 쓸 수 있습니다)')) return;
    if (!F.edit && dirty(F)) S.draft = F; // 새로 쓰던 건 사진째 보관
    else if (F.newPhotos.length) api('/api/auth?action=listing&op=photodel', post({ urls: F.newPhotos })).catch(() => {});
    closeForm();
  };

  const m2py = a => a ? `${a}㎡ (${(a / 3.3058).toFixed(1)}평)` : '';
  function placeBlock(P, i, n) {
    const I = P._info;
    const info = I && !I.none ? esc([I.use, I.grnd ? `지상 ${I.grnd}층${I.ugrnd ? '·지하 ' + I.ugrnd + '층' : ''}` : '', I.apr ? `사용승인 ${String(I.apr).slice(0, 4)}년` : ''].filter(Boolean).join(' · '))
      : I && I.none && !I.err ? '건물 없는 땅 (토지)' : I ? '' : '건물 정보를 불러오는 중…';
    const areaLb = P.land || P.ak === 'land' ? '토지면적' : P.ak === 'tot' ? '연면적' : '전용면적';
    return `<div class="picked" style="margin-top:${i ? 10 : 0}px">
      <div style="display:flex;gap:8px;align-items:flex-start"><div style="flex:1;min-width:0">${n > 1 ? `<span class="pt" style="margin-right:6px">${i + 1}</span>` : ''}<b style="display:inline">${esc(P.bname || P.addr)}</b><div class="meta">${esc(P.addr)}</div>${info ? `<div class="meta">${info}</div>` : ''}</div>
        ${n > 1 || !S.form.edit ? `<button type="button" class="xbtn" data-pdel="${i}" aria-label="이 주소 빼기">×</button>` : ''}</div>
      ${unitPicker(P, i)}
      ${(P.ak === 'tot' || P.land || P.ak === 'land') && !P._showDH && !P.dong && !P.ho
        ? `<div class="nodh"><span>${P.land || P.ak === 'land' ? '토지 · 동·호수 없음' : '건물 전체 · 동·호수 없음'}</span><button type="button" data-showdh="${i}">${P.land || P.ak === 'land' ? '직접 입력' : '층·호 직접 입력'}</button></div>`
        : `<div class="two" style="margin-top:10px"><div><label class="sl" for="p${i}_dong">동</label><input class="in" id="p${i}_dong" value="${esc(P.dong || '')}" maxlength="20" placeholder="101"></div>
        <div><label class="sl" for="p${i}_ho">호 · 층</label><input class="in" id="p${i}_ho" value="${esc(P.ho || '')}" maxlength="20" placeholder="1203"></div></div>`}
      ${P.ak === 'tot' ? `<div class="two" style="margin-top:8px">${[['site', '대지면적'], ['arch', '건축면적']].map(([k, lb]) => `<div><label class="sl" for="p${i}_${k}">${lb}</label><div class="unit"><input class="in" id="p${i}_${k}" data-sq="h${k}${i}" inputmode="decimal" value="${P[k] || ''}"><span>㎡</span></div><div class="hint" id="h${k}${i}">${P[k] ? (P[k] / 3.3058).toFixed(1) + '평' : ''}</div></div>`).join('')}</div>` : ''}
      <div style="margin-top:8px"><label class="sl" for="p${i}_area">${areaLb}</label><div class="unit"><input class="in" id="p${i}_area" data-area="${i}" inputmode="decimal" value="${P.area || ''}"><span>㎡</span></div>
        <div class="hint" id="hp${i}">${esc(P._msg || (P.area ? (P.area / 3.3058).toFixed(1) + '평' : ''))}</div></div>
      ${P._U ? `<button type="button" class="linkbtn" data-clone="${i}">＋ 같은 건물 다른 호 추가</button>` : ''}
    </div>`;
  }
  function searchBox(F) {
    return `<div class="addbox">
      <input class="in" id="fq" type="search" placeholder="예) 동교동 165-8, 마포래미안푸르지오" enterkeyhint="search">
      <div style="display:flex;gap:8px;margin-top:8px"><button class="btn dark" id="fqBtn" type="button" style="flex:1">주소 찾기</button>${F.it.places.length ? '<button class="btn sub" id="fqCancel" type="button">취소</button>' : ''}</div>
      ${F.picking ? '<div class="meta" style="margin-top:8px">필지를 찾는 중…</div>' : ''}
      ${F.results ? (F.results.length ? `<div class="res">${F.results.map((r, i) => `<button type="button" data-r="${i}"><b>${esc(r.t)}</b><small>${esc(r.s)}</small></button>`).join('')}</div>` : '<div class="meta" style="margin-top:8px">검색 결과가 없습니다. 지번이나 도로명으로 다시 입력해 보세요.</div>') : ''}</div>`;
  }
  function moneyField(key, label, val, req) {
    return `<div><label class="sl" for="m_${key}">${label}${req ? '' : '<small>선택</small>'}</label>
      <div class="unit"><input class="in" id="m_${key}" data-money="${key}" inputmode="numeric" value="${val || ''}"><span>만원</span></div><div class="hint" id="hm_${key}">${val ? won(val) : ''}</div></div>`;
  }
  function yieldHint(it) {
    if (it.kind === 'presale') return it.price && it.pr ? `<div class="sumline">총 매매가 (분양가+P) <b>${won(it.price + it.pr)}</b>${it.paid ? `<br><small>매수인이 지금 낼 돈 (납입액+P) 약 ${won(it.paid + it.pr)}${it.loan ? ` · 중도금 대출 ${won(it.loan)}은 승계` : ''}</small>` : ''}</div>` : '';
    if (it.kind !== 'sale' || !it.price || !it.curRent) return '';
    const inv = it.price - (it.curDep || 0); // 실투자금 = 매매가 - 기보증금 (융자 제외)
    const y = inv > 0 ? it.curRent * 12 / inv * 100 : 0;
    return y ? `<div class="sumline">연 임대수익 ${won(it.curRent * 12)} · 수익률 약 <b>${y.toFixed(2)}%</b> <small>(실투자금 ${won(inv)} 기준, 융자 제외)</small></div>` : '';
  }
  // ---------- 사진 ----------
  // 휴대폰 원본(3~5MB)을 긴 변 1,600px JPEG(약 0.3MB)로 줄여서 올립니다
  async function shrink(file) {
    let src;
    try { src = await createImageBitmap(file, { imageOrientation: 'from-image' }); }
    catch { src = await new Promise((ok, no) => { const im = new Image(); im.onload = () => ok(im); im.onerror = no; im.src = URL.createObjectURL(file); }); }
    const W = src.width, H = src.height, k = Math.min(1, 1600 / Math.max(W, H));
    const c = document.createElement('canvas'); c.width = Math.round(W * k); c.height = Math.round(H * k);
    c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.82);
  }
  async function uploadPhotos(F, files) {
    const room = 30 - F.it.photos.length - F.upN;
    if (files.length > room) toast(`사진은 매물당 30장까지입니다. ${Math.max(0, room)}장만 올립니다.`, 3500);
    files = files.slice(0, Math.max(0, room)).filter(f => /^image\//.test(f.type) || /\.(jpe?g|png|heic|heif|webp)$/i.test(f.name));
    if (!files.length) return;
    collect(); F.upN += files.length; renderForm(true);
    let bad = 0;
    for (const f of files) {
      try {
        const data = await shrink(f);
        const j = await api('/api/auth?action=listing&op=photo', post({ data }));
        if (S.form !== F) { api('/api/auth?action=listing&op=photodel', post({ urls: [j.url] })).catch(() => {}); continue; }
        F.it.photos.push({ url: j.url }); F.newPhotos.push(j.url);
      } catch { bad++; }
      F.upN--; if (S.form === F) { collect(); renderForm(true); }
    }
    if (bad) toast(`사진 ${bad}장을 올리지 못했습니다. 다른 사진으로 다시 시도해 주세요.`, 4000);
  }
  // 사진 크게 보기
  function viewer(urls, at) {
    let i = at;
    const box = document.createElement('div'); box.className = 'viewer';
    const draw = () => { box.innerHTML = `<img src="${esc(urls[i])}" alt=""><button class="vx" aria-label="닫기">×</button>${urls.length > 1 ? `<button class="vp" aria-label="이전">‹</button><button class="vn" aria-label="다음">›</button>` : ''}<div class="vc">${i + 1} / ${urls.length}</div>`;
      box.querySelector('.vx').onclick = () => box.remove();
      if (urls.length > 1) { box.querySelector('.vp').onclick = e => { e.stopPropagation(); i = (i - 1 + urls.length) % urls.length; draw(); }; box.querySelector('.vn').onclick = e => { e.stopPropagation(); i = (i + 1) % urls.length; draw(); }; } };
    box.onclick = e => { if (e.target === box) box.remove(); };
    draw(); document.body.appendChild(box);
  }
  function renderForm(skipCollect) {
    const F = S.form; if (!F) return;
    if (!skipCollect) collect();
    const it = F.it, n = it.places.length;
    const keep = $('fq') ? $('fq').value : '';
    const places = it.places.map((P, i) => placeBlock(P, i, n)).join('');
    const areaSum = it.places.reduce((a, p) => a + (p.area || 0), 0);
    const addr = `${places}
      ${n > 1 && areaSum ? `<div class="sumline">주소 ${n}곳 · 면적 합계 <b>${m2py(Math.round(areaSum * 100) / 100)}</b></div>` : ''}
      ${F.adding || !n ? searchBox(F) : '<button type="button" class="btn sub" id="addPlace" style="width:100%;margin-top:10px">＋ 주소 추가 <small style="font-weight:500;color:var(--muted)">(상가 여러 칸 · 토지 여러 필지)</small></button>'}`;
    const MF = moneyOf(it);
    const rentRows = it.rents.map((r, i) => `<div class="rrow">
        <input class="in" id="r${i}_label" value="${esc(r.label || '')}" maxlength="30" placeholder="1층 / 101호" aria-label="구분">
        <div class="unit"><input class="in" id="r${i}_deposit" inputmode="numeric" value="${r.deposit || ''}" placeholder="보증금" aria-label="보증금"><span>만</span></div>
        <div class="unit"><input class="in" id="r${i}_rent" inputmode="numeric" value="${r.rent || ''}" placeholder="월세" aria-label="월세"><span>만</span></div>
        <button type="button" class="xbtn" data-rdel="${i}" aria-label="이 줄 빼기">×</button>
        <input class="in rmemo" id="r${i}_memo" value="${esc(r.memo || '')}" maxlength="60" placeholder="업종 · 계약만기 등 (선택)" aria-label="메모"></div>`).join('');
    const showRents = it.kind === 'sale' || it.kind === 'wolse';
    const rentTitle = it.kind === 'sale' ? '현재 임대 현황 (층·호별)' : '층·호별 세부 임대료';
    $('form').innerHTML = `
      <div class="fld"><span class="lb">주소<small>지번·도로명·건물명 모두 됩니다</small></span>${addr}</div>
      ${n ? `
      <div class="fld"><span class="lb">사진<small>${it.photos.length}/30 · 첫 번째가 대표 사진</small></span>
        <div class="pgrid">${it.photos.map((p, i) => `<div class="ph"><img src="${esc(p.url)}" alt="" loading="lazy">${i === 0 ? '<em>대표</em>' : ''}
          <div class="pbar">${i ? `<button type="button" data-pl="${i}" aria-label="앞으로">◀</button>` : '<span></span>'}<button type="button" data-px="${i}" aria-label="사진 빼기">×</button>${i < it.photos.length - 1 ? `<button type="button" data-pr="${i}" aria-label="뒤로">▶</button>` : '<span></span>'}</div></div>`).join('')}
          ${F.upN ? Array.from({ length: F.upN }, () => '<div class="ph up"><span class="spin"></span></div>').join('') : ''}
          ${it.photos.length + (F.upN || 0) < 30 ? '<label class="ph add"><input type="file" id="fPhoto" accept="image/*" multiple hidden><b>＋</b><span>사진 추가</span></label>' : ''}</div></div>
      <div class="fld"><span class="lb">거래 종류</span><div class="seg" id="fKind">${Object.entries(KIND).map(([k, v]) => `<button type="button" data-v="${k}" aria-pressed="${it.kind === k}">${v}</button>`).join('')}</div></div>
      <div class="fld"><span class="lb">금액<small>만원 단위로 입력</small></span><div class="two">${MF.map(([k, lb, req]) => moneyField(k, lb, it[k], req)).join('')}</div><div id="yield">${yieldHint(it)}</div></div>
      ${showRents ? `<div class="fld"><span class="lb">${rentTitle}<small>필요할 때만</small></span>
        ${rentRows}
        <div style="display:flex;gap:8px;margin-top:8px"><button type="button" class="btn sub" id="addRent" style="flex:1">＋ 세부 임대료 추가</button>${it.rents.length ? '<button type="button" class="btn dark" id="sumRent">합계 반영</button>' : ''}</div>
        ${it.rents.length ? `<div class="meta" style="margin-top:6px">세부 금액은 자동으로 더해지지 않습니다. '합계 반영'을 누르면 합계를 보여 드리고, 확인하시면 위 ${it.kind === 'sale' ? '기보증금·기월세' : '보증금·월세'}에 넣습니다.</div>` : ''}</div>` : ''}
      <div class="fld"><span class="lb">매물 유형</span><div class="seg" id="fType">${PTYPES.map(v => `<button type="button" data-v="${v}" aria-pressed="${it.ptype === v}">${v}</button>`).join('')}</div>
        ${it.ptype === '기타' ? `<input class="in" id="f_ptypeTx" value="${esc(it.ptypeTx || '')}" maxlength="20" placeholder="예) 숙박시설, 지식산업센터, 주유소" style="margin-top:8px">` : ''}</div>
      <div class="two"><div class="fld"><label for="f_no">매물번호<small>비우면 자동</small></label><input class="in" id="f_no" value="${esc(it.no || '')}" maxlength="20" placeholder="${F.edit ? '' : '자동 (예: 2610-001)'}"></div>
        <div class="fld"><label for="f_bname">매물 이름<small>선택</small></label><input class="in" id="f_bname" value="${esc(it.bname || '')}" maxlength="40"></div></div>
      ${adBlock(F)}
      <div class="fld"><span class="lb">연락처<small>소유자·임차인·관리인 등 여러 명 가능</small></span>
        ${it.contacts.map((c, i) => `<div class="crow">
          <select class="in" id="c${i}_role" aria-label="관계">${ROLES.map(r => `<option ${c.role === r ? 'selected' : ''}>${r}</option>`).join('')}</select>
          <input class="in" id="c${i}_name" value="${esc(c.name || '')}" maxlength="20" placeholder="이름" aria-label="이름">
          <input class="in" id="c${i}_phone" data-phone type="tel" inputmode="tel" value="${esc(c.phone || '')}" maxlength="20" placeholder="010-0000-0000" aria-label="연락처">
          ${it.contacts.length > 1 ? `<button type="button" class="xbtn" data-cdel="${i}" aria-label="이 연락처 빼기">×</button>` : '<span></span>'}</div>`).join('')}
        <button type="button" class="btn sub" id="addContact" style="width:100%;margin-top:8px">＋ 연락처 추가</button></div>
      <div class="fld"><label for="f_memo">메모<small>입주 가능일, 비밀번호, 특이사항 등</small></label><textarea class="in" id="f_memo" rows="3" maxlength="1000">${esc(it.memo || '')}</textarea></div>
      <div class="fld"><span class="lb">상태</span><div class="seg" id="fStat">${Object.entries(STAT).map(([k, v]) => `<button type="button" data-v="${k}" aria-pressed="${it.status === k}">${v}</button>`).join('')}</div></div>
      <div class="saveRow">${F.edit ? '<button class="btn danger" id="fDel" type="button">삭제</button>' : ''}<button class="btn main" id="fSave" type="button">저장하기</button></div>` : ''}`;
    // ---- 이벤트 ----
    const on = (sel, fn) => document.querySelectorAll(sel).forEach(fn);
    if ($('fq')) {
      if (keep) $('fq').value = keep;
      const go = () => search($('fq').value.trim());
      $('fqBtn').onclick = go; $('fq').onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); go(); } };
      if ($('fqCancel')) $('fqCancel').onclick = () => { F.adding = false; F.results = null; renderForm(); };
      on('[data-r]', b => b.onclick = () => { const r = F.results[+b.dataset.r]; F.results = null; addPlace(r.lat, r.lng, r.t); });
    }
    if ($('addPlace')) $('addPlace').onclick = () => { F.adding = true; renderForm(); setTimeout(() => $('fq') && $('fq').focus(), 30); };
    on('[data-pdel]', b => b.onclick = () => { collect(); F.it.places.splice(+b.dataset.pdel, 1); if (!F.it.places.length) { F.adding = true; F.touchedType = false; F.it.bname = ''; } renderForm(true); });
    on('[data-showdh]', b => b.onclick = () => { collect(); F.it.places[+b.dataset.showdh]._showDH = true; renderForm(true); setTimeout(() => $(`p${b.dataset.showdh}_ho`) && $(`p${b.dataset.showdh}_ho`).focus(), 30); });
    on('[data-clone]', b => b.onclick = () => cloneUnit(F, +b.dataset.clone));
    on('[data-umode]', b => b.onclick = () => { collect(); const [i, m] = b.dataset.umode.split(':'); const P = F.it.places[+i]; if (P._U.mode === m) return; P._U.mode = m;
      if (m === 'whole') { P.dong = ''; P.ho = ''; P._U.sel = ''; P.ak = 'tot'; P._showDH = false; fillTot(P); }
      else { P.ak = 'ex'; P.area = null; P.site = null; P.arch = null; P._msg = ''; }
      renderForm(true); });
    on('[data-udong]', s => s.onchange = e => { collect(); const P = F.it.places[+s.dataset.udong]; P._U.cur = e.target.value; P._U.sel = ''; P._msg = ''; renderForm(true); loadUnits(F, P); });
    on('[data-uho]', s => s.onchange = e => pickUnit(F, F.it.places[+s.dataset.uho], e.target.value));
    on('[data-sq]', inp => inp.oninput = () => { const v = num(inp.value); $(inp.dataset.sq).textContent = v ? (v / 3.3058).toFixed(1) + '평' : ''; });
    on('[data-area]', inp => inp.oninput = () => { const v = num(inp.value); $('hp' + inp.dataset.area).textContent = v ? (v / 3.3058).toFixed(1) + '평' : ''; });
    if (!n) return;
    const seg = (id, key, after) => $(id).querySelectorAll('button').forEach(b => b.onclick = () => { collect(); F.it[key] = b.dataset.v; if (after) after(); renderForm(true); });
    seg('fKind', 'kind'); seg('fType', 'ptype', () => (F.touchedType = true)); seg('fStat', 'status');
    on('[data-money]', inp => inp.oninput = () => { $('hm_' + inp.dataset.money).textContent = won(num(inp.value)); });
    // 수익률은 다시 그리지 않고 그 자리만 바꿉니다 (다시 그리면 바로 누른 '저장하기'가 씹힘)
    on('[data-money]', inp => inp.addEventListener('input', () => { if (!['sale', 'presale'].includes(F.it.kind) || !$('yield')) return; collect(); $('yield').innerHTML = yieldHint(F.it); }));
    on('[data-phone]', inp => inp.oninput = () => { const d = inp.value.replace(/\D/g, ''); if (/^01\d{8,9}$/.test(d)) inp.value = d.length === 11 ? `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}` : `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`; });
    if ($('addRent')) $('addRent').onclick = () => { collect(); F.it.rents.push({ label: '', deposit: null, rent: null, memo: '' }); renderForm(true); const i = F.it.rents.length - 1; setTimeout(() => $(`r${i}_label`) && $(`r${i}_label`).focus(), 30); };
    on('[data-rdel]', b => b.onclick = () => { collect(); F.it.rents.splice(+b.dataset.rdel, 1); renderForm(true); });
    if ($('sumRent')) $('sumRent').onclick = () => {
      collect();
      const d = F.it.rents.reduce((a, r) => a + (r.deposit || 0), 0), m = F.it.rents.reduce((a, r) => a + (r.rent || 0), 0);
      const [kd, km] = F.it.kind === 'sale' ? ['curDep', 'curRent'] : ['deposit', 'rent'];
      const lb = F.it.kind === 'sale' ? ['기보증금', '기월세'] : ['보증금', '월세'];
      if (!confirm(`세부 ${F.it.rents.length}건 합계\n\n${lb[0]}: ${won(d) || '0원'}\n${lb[1]}: ${won(m) || '0원'}\n\n이 금액을 위 ${lb[0]}·${lb[1]} 칸에 넣을까요?`)) return;
      F.it[kd] = d || null; F.it[km] = m || null; renderForm(true); toast('합계를 반영했습니다');
    };
    if ($('fPhoto')) $('fPhoto').onchange = e => { const fs = [...e.target.files]; e.target.value = ''; uploadPhotos(F, fs); };
    on('[data-px]', b => b.onclick = () => { collect(); F.it.photos.splice(+b.dataset.px, 1); renderForm(true); });
    const mv = (i, d) => { collect(); const a = F.it.photos; [a[i], a[i + d]] = [a[i + d], a[i]]; renderForm(true); };
    on('[data-pl]', b => b.onclick = () => mv(+b.dataset.pl, -1));
    on('[data-pr]', b => b.onclick = () => mv(+b.dataset.pr, 1));
    $('addContact').onclick = () => { collect(); F.it.contacts.push({ role: '임차인', name: '', phone: '' }); renderForm(true); };
    on('[data-cdel]', b => b.onclick = () => { collect(); F.it.contacts.splice(+b.dataset.cdel, 1); renderForm(true); });
    on('[data-flx]', b => b.onclick = () => { collect(); F.it.ad.flx = b.dataset.flx; renderForm(true); });
    on('[data-mgt]', b => b.onclick = () => { collect(); F.it.ad.mgmtT = b.dataset.mgt; renderForm(true); });
    if (F.scrollAd && $('adSec')) { F.scrollAd = false; setTimeout(() => $('adSec').scrollIntoView({ behavior: 'smooth', block: 'start' }), 60); }
    $('fSave').onclick = save;
    if ($('fDel')) $('fDel').onclick = del;
  }
  const num = v => { const x = Number(String(v || '').replace(/[^\d.]/g, '')); return Number.isFinite(x) && x > 0 ? x : null; };
  function collect() {
    const F = S.form; if (!F) return;
    const v = id => $(id) ? $(id).value : undefined;
    const it = F.it;
    it.places.forEach((P, i) => { const d = v(`p${i}_dong`), h = v(`p${i}_ho`), a = v(`p${i}_area`), si = v(`p${i}_site`), ar = v(`p${i}_arch`); if (d !== undefined) P.dong = d.trim(); if (h !== undefined) P.ho = h.trim(); if (a !== undefined) P.area = num(a); if (si !== undefined) P.site = num(si); if (ar !== undefined) P.arch = num(ar); });
    it.contacts.forEach((c, i) => { const r = v(`c${i}_role`), nm = v(`c${i}_name`), ph = v(`c${i}_phone`); if (r !== undefined) c.role = r; if (nm !== undefined) c.name = nm.trim(); if (ph !== undefined) c.phone = ph.trim(); });
    it.rents.forEach((r, i) => { const l = v(`r${i}_label`), d = v(`r${i}_deposit`), m = v(`r${i}_rent`), me = v(`r${i}_memo`); if (l !== undefined) r.label = l.trim(); if (d !== undefined) r.deposit = num(d); if (m !== undefined) r.rent = num(m); if (me !== undefined) r.memo = me.trim(); });
    ['price', 'deposit', 'rent', 'mgmt', 'premium', 'curDep', 'curRent', 'loan', 'pr', 'paid'].forEach(k => { const x = v('m_' + k); if (x !== undefined) it[k] = num(x); });
    { const x = v('f_ptypeTx'); if (x !== undefined) it.ptypeTx = x.trim(); }
    ['bname', 'memo', 'no'].forEach(k => { const x = v('f_' + k); if (x !== undefined) it[k] = x.trim(); });
    it.ad = it.ad || {};
    ['fl', 'tfl', 'dir', 'rooms', 'baths', 'movein', 'park', 'appr', 'desc', 'use', 'zone', 'biz', 'wc', 'facx', 'mgmtTx'].forEach(k => { const x = v('a_' + k); if (x !== undefined) { if (F.auto && F.auto.has(k) && x.trim() !== String(it.ad[k] ?? '')) F.auto.delete(k); it.ad[k] = x.trim(); } });
    if ($('a_nomgmt')) it.ad.nomgmt = $('a_nomgmt').checked;
    if ($('a_viol')) { if (F.auto && F.auto.has('viol') && $('a_viol').checked !== !!it.ad.viol) F.auto.delete('viol'); it.ad.viol = $('a_viol').checked; }
    if (document.querySelector('[data-mgi]')) it.ad.mgmtInc = [...document.querySelectorAll('[data-mgi]:checked')].map(c => c.dataset.mgi);
  }
  async function save() {
    collect();
    const it = S.form.it;
    if (S.form.upN) return toast('사진을 올리는 중입니다. 잠시 후 저장해 주세요');
    const need = moneyOf(it).find(([k, , req]) => req && !it[k]);
    if (need && !(it.kind === 'wolse' && it.deposit)) return toast(`${need[1]}을(를) 입력해 주세요`);
    // 화면용 임시값(_로 시작)은 빼고 보냅니다. 거래 종류에 없는 금액 칸은 비웁니다.
    const keys = moneyOf(it).map(m => m[0]);
    const body = { ...it, places: it.places.map(P => Object.fromEntries(Object.entries(P).filter(([k]) => !k.startsWith('_')))) };
    ['price', 'deposit', 'rent', 'mgmt', 'premium', 'curDep', 'curRent', 'loan', 'pr', 'paid'].forEach(k => { if (!keys.includes(k)) body[k] = null; });
    if (it.ptype !== '기타') body.ptypeTx = '';
    if (it.kind === 'jeonse' || it.kind === 'presale') body.rents = [];
    $('fSave').disabled = true; $('fSave').textContent = '저장 중…';
    try {
      const j = await api('/api/auth?action=listing', post({ op: 'save', id: S.form.edit ? it.id : '', item: body }));
      const wasEdit = S.form.edit, pa = S.form.pubAfter; took(j); if (!wasEdit) S.draft = null; closeForm();
      if (pa) { draw(); const y = S.items.find(i => i.id === pa); if (y && y.status === 'on' && !adMissing(y, S.bk).length) return pubFlow(y); }
      if (!wasEdit) { S.tab = it.status; S.kind = 'all'; }
      draw(); if (!wasEdit) focusItem(S.items[0].id, true);
      toast(wasEdit ? '수정했습니다' : '매물장에 등록했습니다');
    } catch (e) { toast(e.message, 4000); $('fSave').disabled = false; $('fSave').textContent = '저장하기'; }
  }
  async function del() {
    if (!confirm('이 매물을 삭제할까요? 삭제하면 되돌릴 수 없습니다.')) return;
    try { took(await api('/api/auth?action=listing', post({ op: 'del', id: S.form.it.id }))); closeForm(); draw(); toast('삭제했습니다'); } catch (e) { toast(e.message, 4000); }
  }


  // ---------- 리얼맵 지도에 매물 올리기 (광고) ----------
  // 인터넷 표시·광고 명시사항: 서버(api/auth.js adMissing)와 같은 규칙
  const RESID = ['아파트', '빌라', '오피스텔', '주택'];
  const DIRS = ['남향', '남동향', '남서향', '동향', '서향', '북향', '북동향', '북서향'];
  const MGI = [['gen', '공용관리비'], ['elec', '전기'], ['water', '수도'], ['gas', '가스'], ['heat', '난방'], ['net', '인터넷'], ['tv', 'TV'], ['etc', '기타']];
  const WCS = ['내부 전용', '내부 공용', '외부 공용', '외부 전용'];
  const isWhole = x => { const p0 = (x.places && x.places[0]) || {}; return p0.ak === 'tot' && !p0.ho; };
  function adMissing(x, bk) {
    const miss = [], a = x.ad || {};
    if (!bk || !bk.office || !bk.addr || !bk.regno || !bk.ceo || !bk.tel) miss.push('중개사무소 정보');
    if (!x.addr && !(x.places && x.places[0] && x.places[0].addr)) miss.push('소재지');
    if (!x.area && !(x.places || []).some(p => p.area)) miss.push('면적');
    if (!x.ptype) miss.push('매물 종류');
    const price = x.kind === 'sale' ? x.price : x.kind === 'jeonse' ? x.deposit : x.kind === 'wolse' ? x.rent : x.price && x.pr;
    if (!price) miss.push('가격');
    if (x.ptype === '토지') { if (!a.use) miss.push('지목'); return miss; }
    if (!x.ptype) return miss;
    if (x.kind !== 'presale' && !a.use) miss.push('건축물 용도');
    if (!a.tfl) miss.push('총 층수');
    if (!a.fl) miss.push('해당 층');
    if (x.kind !== 'presale' && !a.appr) miss.push('사용승인일');
    if (!a.dir) miss.push('방향');
    if (!a.movein) miss.push('입주 가능일');
    if (x.kind !== 'presale' && !a.park) miss.push('주차 대수');
    if (RESID.includes(x.ptype)) {
      if (a.rooms == null || a.rooms === '') miss.push('방 수');
      if (a.baths == null || a.baths === '') miss.push('욕실 수');
      if (!x.mgmt && !a.nomgmt) miss.push('관리비');
      if (x.mgmt >= 10 && a.mgmtT === 'fix' && !(a.mgmtInc && a.mgmtInc.length)) miss.push('관리비 포함 항목');
    }
    return miss;
  }
  const isPub = x => x.pub && x.pub.on && x.status === 'on';
  const pubLive = x => isPub(x) && x.pub.exp > new Date().toISOString();
  function adBlock(F) {
    const it = F.it, a = it.ad || (it.ad = {});
    if (!it.ptype) return '';
    const pt = it.ptype, land = pt === '토지', res = RESID.includes(pt), shop = pt === '상가' || pt === '사무실', fac = pt === '공장·창고', pre = it.kind === 'presale';
    const miss = adMissing(it, S.bk).filter(m => m !== '중개사무소 정보');
    const au = k => F.auto && F.auto.has(k) ? '<em class="auto">자동</em>' : '';
    const inp = (k, lb, ph, extra = '', sub = '') => `<div><label class="sl" for="a_${k}">${lb}${au(k)}${sub}</label><input class="in" id="a_${k}" value="${esc(a[k] ?? '')}" placeholder="${ph}" ${extra}></div>`;
    const info = [a.zone && `용도지역 ${a.zone}`, a.road && `도로 ${a.road}`, a.lp && `공시지가 ㎡당 ${Number(a.lp).toLocaleString()}원`, a.hhld && `${a.hhld}세대`, a.elev && `승강기 ${a.elev}대`].filter(Boolean);
    const head = F.missing ? (miss.length ? `<div class="adwarn">광고에 꼭 들어가야 할 항목이 빠져 있습니다: <b>${esc(miss.join(', '))}</b></div>` : '<div class="adok">모두 채웠습니다. 저장하면 이어서 리얼맵 지도에 올립니다.</div>')
      : miss.length ? `<div class="meta">아직 빈 항목: ${esc(miss.join(', '))}</div>` : `<div class="meta" style="color:#1F7A4D;font-weight:700">필수 항목을 모두 채웠습니다</div>`;
    let body;
    if (land) {
      body = `<div class="two" style="margin-top:8px">${inp('use', '지목', '대 / 전 / 임야', 'maxlength="20"')}${inp('zone', '용도지역', '제2종일반주거지역', 'maxlength="40"', ' <small>선택</small>')}</div>`;
    } else {
      body = `<div class="two" style="margin-top:8px">${inp('use', '건축물 용도', '공동주택(아파트) / 제2종근린생활시설', 'maxlength="40"', pre ? ' <small>선택</small>' : '')}${inp('appr', '사용승인일', '2014.09.30', 'maxlength="10"', pre ? ' <small>입주 전이면 비움</small>' : '')}</div>
      <label class="ck2 adck"><input type="checkbox" id="a_viol" ${a.viol ? 'checked' : ''}>위반건축물${au('viol')} <small class="meta">(건축물대장에 표시된 경우 반드시 체크)</small></label>
      <div class="two" style="margin-top:8px">${inp('fl', '해당 층', isWhole(it) ? '전체' : '12 (지하는 B1)', 'maxlength="8"')}${inp('tfl', '총 층수', '25', 'inputmode="numeric" maxlength="3"')}</div>
      ${res ? `<div class="seg" style="margin-top:8px"><button type="button" data-flx="exact" aria-pressed="${a.flx !== 'lmh'}">층 그대로 공개</button><button type="button" data-flx="lmh" aria-pressed="${a.flx === 'lmh'}">저·중·고층으로 공개</button></div>` : ''}
      <div class="two" style="margin-top:8px"><div><label class="sl" for="a_dir">방향 <small>${res ? '주실(거실) 기준' : '주된 출입구 기준'}</small></label><select class="in" id="a_dir"><option value="">선택</option>${DIRS.map(d => `<option ${a.dir === d ? 'selected' : ''}>${d}</option>`).join('')}</select></div>
        ${inp('movein', pre ? '입주 예정일' : '입주 가능일', '즉시입주 / 2026.12 중순', 'maxlength="20" list="mvList"')}</div>
      <datalist id="mvList"><option value="즉시입주"><option value="협의"><option value="${new Date().getFullYear()}.${new Date().getMonth() + 2 > 12 ? 1 : new Date().getMonth() + 2} 초순"><option value="${new Date().getFullYear()}.${new Date().getMonth() + 2 > 12 ? 1 : new Date().getMonth() + 2} 하순"></datalist>
      ${res ? `<div class="two" style="margin-top:8px">${inp('rooms', '방 수', '3', 'inputmode="numeric" maxlength="2"')}${inp('baths', '욕실 수', '2', 'inputmode="numeric" maxlength="2"')}</div>` : ''}
      ${pre ? '' : `<div style="margin-top:8px">${inp('park', '주차 대수', '총 120대 (세대당 1.2대)', 'maxlength="30"', ' <small>총 대수 또는 세대당</small>')}</div>`}
      ${res ? `<div class="mgbox"><div class="sl">관리비 <small>월 금액은 위 '관리비' 칸에 · ${it.mgmt ? `월 ${it.mgmt}만원` : '미입력'}</small></div>
        <div class="seg" style="margin-top:6px"><button type="button" data-mgt="avg" aria-pressed="${a.mgmtT !== 'fix'}">실비·월평균</button><button type="button" data-mgt="fix" aria-pressed="${a.mgmtT === 'fix'}">정액 (매달 같은 금액)</button></div>
        ${a.mgmtT === 'fix' ? `<div class="meta" style="margin-top:6px">정액 월 10만원 이상이면 포함 항목을 표시해야 합니다</div><div class="mgi">${MGI.map(([k, t]) => `<label class="ck2"><input type="checkbox" data-mgi="${k}" ${(a.mgmtInc || []).includes(k) ? 'checked' : ''}>${t}</label>`).join('')}</div>
          ${inp('mgmtTx', '항목별 금액', '공용 7만 · 수도 1만 · 인터넷 2만', 'maxlength="60"', ' <small>선택 · 의뢰인이 안 알려주면 생략 가능</small>')}` : ''}
        <label class="ck2 adck"><input type="checkbox" id="a_nomgmt" ${a.nomgmt ? 'checked' : ''}>관리비 없음</label></div>` : ''}
      ${shop ? `<div class="two" style="margin-top:8px">${inp('biz', pt === '상가' ? '현재 업종' : '현재 용도', pt === '상가' ? '카페 / 공실' : '사무실 / 공실', 'maxlength="30"', ' <small>선택</small>')}<div><label class="sl" for="a_wc">화장실 <small>선택</small></label><select class="in" id="a_wc"><option value="">선택</option>${WCS.map(w => `<option ${a.wc === w ? 'selected' : ''}>${w}</option>`).join('')}</select></div></div>` : ''}
      ${fac ? `<div style="margin-top:8px">${inp('facx', '공장·창고 정보', '전력 50kW · 호이스트 2.8t · 층고 7m · 대형차 진입', 'maxlength="80"', ' <small>선택</small>')}</div>` : ''}`;
    }
    return `<div class="fld adsec${F.missing ? ' need' : ''}" id="adSec"><span class="lb">리얼맵 광고 정보<small>지도에 올릴 때 필요 · 매물장에만 둘 거면 비워도 됩니다</small></span>
      ${head}${body}
      ${info.length ? `<div class="meta" style="margin-top:8px">자동으로 함께 표시: ${esc(info.join(' · '))}</div>` : ''}
      <div style="margin-top:8px"><label class="sl" for="a_desc">광고 소개글 <small>지도에 공개 · 선택</small></label><textarea class="in" id="a_desc" rows="2" maxlength="300" placeholder="예) 남향 로열층, 올수리, 역 도보 5분">${esc(a.desc || '')}</textarea></div>
      <div class="meta" style="margin-top:6px">호수·소유자 연락처·메모는 지도에 공개되지 않습니다. '자동' 표시는 건축물대장·토지대장에서 가져온 값입니다.</div></div>`;
  }
  function pubBtn(x) {
    if (!S.canPub || x.status !== 'on') return `<a href="/?pnu=${x.pnu}" target="_blank" rel="noopener">리얼맵 정보</a>`;
    return isPub(x) ? `<button type="button" data-renew="${x.id}">${pubLive(x) ? '게시 연장' : '다시 게시'}</button>` : `<button type="button" class="pubgo" data-pub="${x.id}">리얼맵 등록</button>`;
  }
  function pubLine(x) {
    if (!isPub(x)) return '';
    const live = pubLive(x);
    return `<div class="publine${live ? '' : ' off'}"><span>${live ? `● 리얼맵 지도 게시 중 · ${ymd(x.pub.exp).slice(5)}까지 · 확인 ${ymd(x.pub.chk).slice(5)}` : '게시 기간이 끝났습니다 · 아직 거래 가능하면 다시 게시해 주세요'}</span>
      ${live ? `<a href="/?pnu=${x.pnu}&lst=1" target="_blank" rel="noopener">지도에서 보기</a><button type="button" data-share="${x.id}">링크 공유</button>` : ''}<button type="button" data-unpub="${x.id}">내리기</button></div>`;
  }
  async function pubOp(id, op) {
    try { took(await api('/api/auth?action=listing', post({ op, id }))); draw();
      toast(op === 'unpub' ? '리얼맵 지도에서 내렸습니다' : op === 'renew' ? '30일 연장했습니다 (확인일 오늘)' : '리얼맵 지도에 올렸습니다. 1분 안에 지도에 나타납니다', 3500);
    } catch (e) {
      if (e.code === 'missing') { const x = S.items.find(i => i.id === id); if (x) { openForm(x); S.form.missing = adMissing(x, S.bk); S.form.scrollAd = true; S.form.pubAfter = x.id; renderForm(true); } }
      toast(e.message, 5000);
    }
  }
  function pubFlow(x) {
    if (!x) return;
    if (!S.bk) return openBk(() => pubFlow(S.items.find(i => i.id === x.id)));
    const miss = adMissing(x, S.bk);
    if (miss.length) { openForm(x); S.form.missing = miss; S.form.scrollAd = true; S.form.pubAfter = x.id; renderForm(true); return toast('광고에 필요한 항목을 채운 뒤 저장하고, 다시 리얼맵 등록을 눌러 주세요', 4500); }
    const a = x.ad || {};
    const fl = !a.fl ? '' : a.flx === 'lmh' ? '저·중·고층으로 표시' : `${a.fl}층 표시`;
    if (!confirm(`리얼맵 지도에 이 매물을 30일 동안 올릴까요?\n\n공개: ${priceText(x)} · ${x.area ? x.area + '㎡' : ''}${fl ? ' · ' + fl : ''} · 사진 ${(x.photos || []).length}장\n중개사무소: ${S.bk.office} (전화 ${S.bk.tel}${S.bk.mobile ? ' · 문자 ' + S.bk.mobile : ''})\n\n호수·소유자 연락처·메모는 공개되지 않습니다.\n거래완료로 바꾸면 지도에서 자동으로 내려갑니다.`)) return;
    pubOp(x.id, 'pub');
  }
  // ---------- 손님용 매물 브리핑 (A4 · 인쇄/PDF) ----------
  // 브리핑 편집기(briefing.html)는 필지 정보를 리얼맵 지도에서 받아 옵니다. 매물 내용은 미리 채워 두고 지도 창이 브리핑으로 넘어가게 합니다.
  const manTx = v => { if (!v) return ''; const e = Math.floor(v / 10000), r = Math.round(v % 10000); return (e ? `${e}억` : '') + (r ? `${e ? ' ' : ''}${r.toLocaleString()}만` : ''); };
  function briefOf(x) {
    if (!x) return;
    const a = x.ad || {}, p0 = (x.places && x.places[0]) || {}, pnu = x.pnu || p0.pnu;
    if (!pnu) return toast('주소(필지)가 없는 매물이라 브리핑을 만들 수 없습니다');
    const T = ['아파트', '빌라', '오피스텔'].includes(x.ptype) ? 'apt' : x.ptype === '토지' ? 'land' : 'bld';
    const K = x.kind === 'jeonse' ? '전세' : x.kind === 'wolse' ? (T === 'land' ? '월세' : '월세') : '매매';
    const dong = p0.dong ? (/동$/.test(p0.dong) ? p0.dong : p0.dong + '동') : '';
    const fl = a.fl && a.fl !== '전체' ? `${String(a.fl).replace(/^b/i, '지하 ')}층${a.tfl ? ' / ' + a.tfl + '층' : ''}` : '';
    const rr = (x.rents || []).map(r => [r.label || '-', r.memo || '', r.deposit || 0, r.rent || 0].join(' / ')).join('\n');
    const d = {
      ptype: T, kind: K,
      price: x.kind === 'presale' ? manTx((x.price || 0) + (x.pr || 0)) : x.kind === 'sale' ? manTx(x.price) : '',
      jeonse: x.kind === 'jeonse' ? manTx(x.deposit) : '', deposit: x.kind === 'wolse' ? manTx(x.deposit) : '', rent: x.kind === 'wolse' ? manTx(x.rent) : '',
      incDep: x.kind === 'sale' ? manTx(x.curDep) : '', incRent: x.kind === 'sale' ? manTx(x.curRent) : '',
      fee: x.mgmt ? `${x.mgmt.toLocaleString()}만원` : a.nomgmt ? '없음' : '', moveIn: a.movein || '',
      exArea: x.area ? `${x.area}㎡` : '', rooms: a.rooms != null && a.rooms !== '' ? `방${a.rooms}${a.baths != null && a.baths !== '' ? ' · 욕실' + a.baths : ''}` : '',
      floor: fl, dir: a.dir || '', park: a.park || '', premium: x.premium ? manTx(x.premium) : '', rentroll: rr,
      title: [x.bname || (x.addr || '').split(' ').slice(-1)[0], dong].filter(Boolean).join(' '), intro: (a.desc || '').split('\n')[0].slice(0, 80),
    };
    try {
      const key = 'rm.bdraft:' + pnu, old = JSON.parse(localStorage.getItem(key) || '{}');
      localStorage.setItem(key, JSON.stringify({ ...old, ...d, ...(old.show ? { show: { ...old.show, trade: true } } : {}) }));
      localStorage.setItem('rm.bphotos:' + pnu, JSON.stringify((x.photos || []).slice(0, 4).map(p => p.url)));
      if (S.bk) { const ag = JSON.parse(localStorage.getItem('rm.agent') || '{}'); localStorage.setItem('rm.agent', JSON.stringify({ ...ag, name: S.bk.office, ceo: S.bk.ceo, reg: S.bk.regno, tel: [S.bk.tel, S.bk.mobile].filter(Boolean).join(' · '), addr: S.bk.addr })); }
    } catch { return toast('브라우저 저장 공간을 쓸 수 없어 브리핑을 만들지 못했습니다', 4000); }
    const w = window.open(`/?pnu=${pnu}&brief=1`, '_blank');
    if (!w) toast('팝업이 차단되었습니다. 이 사이트의 팝업을 허용해 주세요', 4000);
    else toast('새 창에서 필지 정보를 모은 뒤 브리핑 화면으로 넘어갑니다', 3500);
  }
  // 리얼맵 지도에 게시한 매물: 손님에게 보낼 링크
  async function shareOf(x) {
    if (!x) return;
    const url = `${location.origin}/?pnu=${x.pnu}&lst=1`, title = `[리얼맵] ${x.bname || x.addr} ${KIND[x.kind]} ${priceText(x)}`;
    if (navigator.share && /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent)) { try { await navigator.share({ title, text: title, url }); return; } catch { /* 취소 */ } }
    try { await navigator.clipboard.writeText(`${title}\n${url}`); toast('링크를 복사했습니다. 카톡에 붙여 넣으세요'); } catch { prompt('이 링크를 복사해 주세요', url); }
  }
  function drawBk() {
    const el = $('bkLine'); if (!el) return;
    if (!S.canPub) { el.innerHTML = ''; return; }
    const n = S.items.filter(pubLive).length;
    el.innerHTML = `<div class="bkline">${S.bk ? `<span>광고 표시 <b>${esc(S.bk.office)}</b> · 지도 게시 ${n}건${S.bk.mobile ? '' : ' · <b style="color:#B4400B">문자 받을 휴대폰 번호를 넣어 주세요</b>'}</span>` : '<span>중개사무소 정보를 넣으면 매물을 리얼맵 지도에 올릴 수 있습니다</span>'}<button type="button" id="bkEdit">${S.bk ? '수정' : '입력하기'}</button></div>`;
    $('bkEdit').onclick = () => openBk();
  }
  function openBk(then) {
    const b = S.bk || {};
    S.form = null;
    $('shTitle').textContent = '중개사무소 정보';
    $('sheet').hidden = false; document.body.style.overflow = 'hidden';
    const f = (k, lb, ph, t = 'text') => `<div class="fld"><label for="b_${k}">${lb}</label><input class="in" id="b_${k}" type="${t}" value="${esc(b[k] || '')}" placeholder="${ph}"></div>`;
    $('form').innerHTML = `<div class="meta" style="margin-bottom:12px">리얼맵 지도에 올린 매물마다 아래 정보가 함께 표시됩니다. (공인중개사법상 인터넷 광고 필수 표시 항목)</div>
      ${f('office', '중개사무소 명칭', '리얼워커스공인중개사사무소')}${f('addr', '중개사무소 소재지', '서울 마포구 신촌로34길 39')}
      <div class="two">${f('regno', '등록번호', '11440-2025-00123')}${f('ceo', '대표 공인중개사 성명', '홍길동')}</div>
      <div class="two">${f('tel', '사무소 전화', '02-000-0000', 'tel')}${f('mobile', '휴대폰 (문자 받을 번호)', '010-0000-0000', 'tel')}</div>
      <div class="saveRow"><button class="btn main" id="bSave" type="button">저장하기</button></div>`;
    $('bSave').onclick = async () => {
      const bk = Object.fromEntries(['office', 'addr', 'regno', 'ceo', 'tel', 'mobile'].map(k => [k, $('b_' + k).value.trim()]));
      $('bSave').disabled = true;
      try { const j = await api('/api/auth?action=bk', post({ bk })); S.bk = j.bk; S.canPub = !!j.canPub; closeForm(); draw(); toast('중개사무소 정보를 저장했습니다'); if (then) then(); }
      catch (e) { toast(e.message, 4000); $('bSave').disabled = false; }
    };
  }

  // ---------- 엑셀(CSV) 저장 ----------
  function exportCsv(only) {
    const list = Array.isArray(only) ? only : S.items;
    if (!list.length) return toast('저장할 매물이 없습니다');
    const head = ['매물번호', '상태', '거래', '유형', '매물 이름', '주소', '동·호', '면적㎡', '면적평', '대지㎡', '건축㎡', '매매가', '보증금', '월세', '관리비', '권리금', '기보증금', '기월세', '융자금', '프리미엄', '납입액', '연락처', '세부 임대료', '사진 수', '메모', '등록일', '수정일', '리얼맵 링크'];
    const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const rows = list.map(x => {
      const pl = Array.isArray(x.places) && x.places.length ? x.places : [{ addr: x.addr, dong: x.dong, ho: x.ho }];
      const cs = Array.isArray(x.contacts) ? x.contacts : x.owner || x.phone ? [{ role: '집주인', name: x.owner, phone: x.phone }] : [];
      return [x.no, STAT[x.status], KIND[x.kind], x.ptype === '기타' && x.ptypeTx ? x.ptypeTx : x.ptype, x.bname, [...new Set(pl.map(p => p.addr))].join(' / '), pl.map(p => [p.dong, p.ho].filter(Boolean).join(' ')).filter(Boolean).join(', '),
        x.area || '', x.area ? (x.area / 3.3058).toFixed(1) : '', pl.reduce((a, p) => a + (p.site || 0), 0) || '', pl.reduce((a, p) => a + (p.arch || 0), 0) || '', x.price || '', x.deposit || '', x.rent || '', x.mgmt || '', x.premium || '', x.curDep || '', x.curRent || '', x.loan || '', x.pr || '', x.paid || '',
        cs.map(c => `${c.role || ''} ${c.name || ''} ${c.phone || ''}`.trim()).join(' / '), (x.rents || []).map(r => `${r.label} ${r.deposit || 0}/${r.rent || 0}${r.memo ? ' ' + r.memo : ''}`).join(' / '), (x.photos || []).length || '',
        x.memo, ymd(x.at), ymd(x.up), `https://realmap.online/?pnu=${x.pnu}`].map(q).join(',');
    });
    // 금액은 모두 만원 단위
    head[11] = '매매가·분양가'; for (let k = 11; k <= 20; k++) head[k] += '(만원)';
    const blob = new Blob(['﻿' + [head.map(q).join(','), ...rows].join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = `리얼맵_매물장_${new Date().toISOString().slice(0, 10)}.csv`; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    toast('엑셀 파일로 저장했습니다');
  }

  init();
})();
