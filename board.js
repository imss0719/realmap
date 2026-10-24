// 리얼맵 매물장 '지도+리스트' 모드 (10/25)
// 기본은 표 하나. 맨 위 칸에 주소만 치면 건축물대장·토지대장으로 유형을 짐작하고 면적·층·용도 등을 채워 바로 한 줄로 등록합니다.
//   상가·사무실·주거: 동·호(또는 층)를 고르면 전용면적·층 자동
//   통건물·공장: 층별 현황(층·용도·면적)을 깔아 두고 임차인·보증금·월세만 입력 → 합계·수익률 자동
//   토지: 필지를 붙이면 면적·공시지가 합산, 평당가 자동
// [지도로 보기]를 켜면 지금 표에 걸린 줄만 오른쪽 지도에 번호 핀으로. 리얼맵 공개는 매물 카드(전체 수정)에서만.
// listings.js 안에서 쓰입니다: Board.mount(요소, host) · Board.refresh() · Board.focus(id)
window.Board = (() => {
  const $ = id => document.getElementById(id);
  let H = null, EL = null, X = null;                 // host · 붙일 곳 · host가 넘겨준 도우미 모음
  const PY = 3.3058;
  const TY = [['all', '전체'], ['shop', '상가·사무실'], ['bld', '건물'], ['land', '토지'], ['home', '주거']];
  const TYP = { shop: ['상가', '사무실'], bld: ['건물', '공장·창고'], land: ['토지'], home: ['아파트', '빌라', '오피스텔', '주택'] };
  const tyOf = x => Object.keys(TYP).find(k => TYP[k].includes(x.ptype)) || 'etc';
  const B = Object.assign({ ty: 'all', kind: 'all', st: 'on', sort: 'at', dir: -1, grp: '', f: {}, map: false, rate: 4.5, fo: false },
    (() => { try { return JSON.parse(localStorage.getItem('rm.bd') || 'null') || {}; } catch { return {}; } })(),
    { q: '', open: new Set(), blank: new Map(), hl: null, sel: null, ed: null, add: { q: '', res: null, busy: false, D: null }, L: {}, U: {}, fitNext: true });
  const keep = () => { try { localStorage.setItem('rm.bd', JSON.stringify({ ty: B.ty, kind: B.kind, st: B.st, sort: B.sort, dir: B.dir, grp: B.grp, f: B.f, map: B.map, rate: B.rate, fo: B.fo })); } catch { /* 무시 */ } };
  const esc = s => X.esc(s);
  const m2t = a => a ? `${(+a).toLocaleString(undefined, { maximumFractionDigits: 2 })}㎡` : '';
  const pyt = a => a ? `${(a / PY).toFixed(1)}평` : '';
  const sw = v => X.shortWon(Math.round(v || 0));

  // 금액 입력: '68억' '3억2천' '3.2억' '5000' '2천' → 만원
  function man(s) {
    s = String(s ?? '').replace(/[,\s원]/g, '');
    if (!s) return null;
    let m, t = 0;
    if ((m = s.match(/^([\d.]+)억(.*)$/))) { t += parseFloat(m[1]) * 10000; s = m[2]; }
    if (s) {
      if ((m = s.match(/^([\d.]+)천(만)?$/))) t += parseFloat(m[1]) * 1000;
      else if ((m = s.match(/^([\d.]+)(만)?$/))) t += parseFloat(m[1]);
      else return NaN;
    }
    return t > 0 ? Math.round(t * 100) / 100 : null;
  }
  const fmtPhone = p => { const d = String(p || '').replace(/\D/g, ''); return d.length === 11 ? d.replace(/^(\d{3})(\d{4})(\d{4})$/, '$1-$2-$3') : d.length === 10 ? d.replace(/^(02)(\d{4})(\d{4})$/, '$1-$2-$3').replace(/^(\d{3})(\d{3})(\d{4})$/, '$1-$2-$3') : d.length === 9 ? d.replace(/^(02)(\d{3})(\d{4})$/, '$1-$2-$3') : String(p || '').trim(); };
  const manTx = v => { if (!v) return ''; const e = Math.floor(v / 10000), r = Math.round(v % 10000); return (e ? `${e}억` : '') + (r ? (e ? ' ' : '') + r.toLocaleString() : ''); };

  // ---------- 매물 한 건에서 뽑는 값 ----------
  const places = x => Array.isArray(x.places) && x.places.length ? x.places : [{ pnu: x.pnu, addr: x.addr, lat: x.lat, lng: x.lng, dong: x.dong, ho: x.ho, area: x.area }];
  const isLand = x => x.ptype === '토지' || places(x).every(p => p.land || p.ak === 'land');
  const isWhole = x => !isLand(x) && places(x)[0].ak === 'tot' && !places(x)[0].ho;
  const detKind = x => isLand(x) ? 'land' : isWhole(x) ? 'whole' : 'unit';
  const mainP = x => x.kind === 'sale' ? x.price : x.kind === 'presale' ? (x.price || x.pr) : x.deposit;
  const siteOf = x => places(x).reduce((a, p) => a + (p.site || 0), 0);
  const shortAddr = a => { const w = String(a || '').split(' '); const i = w.findIndex(t => /(동|가|리|읍|면)\d*$/.test(t) && !/[시군구]$/.test(t)); return (i >= 0 ? w.slice(i) : w.slice(-2)).join(' '); };
  const hood = x => (String(places(x)[0].addr || x.addr || '').split(' ').find(w => /(동|가|리|읍|면)\d*$/.test(w) && !/[시군구]$/.test(w)) || '').replace(/\d+가$/, '가');
  const dh = p => [p.dong && (/동$/.test(p.dong) ? p.dong : p.dong + '동'), p.ho && (/(호|층)$/.test(p.ho) ? p.ho : p.ho + '호')].filter(Boolean).join(' ');
  const flTx = v => { v = String(v || '').trim(); if (!v || v === '전체') return v; return /^b/i.test(v) ? v.toUpperCase() : /^\d+$/.test(v) ? v + 'F' : v; };
  const zoneS = z => String(z || '').split(' · ')[0].replace(/^제/, '').replace(/지역$/, '').replace('일반주거', '일반').replace('전용주거', '전용');
  const chip = x => x.ptype === '건물' && isWhole(x) ? '통건물' : x.ptype === '기타' ? (x.ptypeTx || '기타') : x.ptype || '미지정';
  // 연 수익률: 연 월세 ÷ (매매가 − 보증금). 융자 반영: (연 월세 − 연 이자) ÷ (매매가 − 보증금 − 융자)
  function yields(x, dep, rent) {
    if (x.kind !== 'sale' || !x.price || !rent) return null;
    const inv = x.price - (dep || 0); if (inv <= 0) return null;
    const y = rent * 12 / inv * 100;
    const L = x.loan || 0, inv2 = inv - L;
    const y2 = L && inv2 > 0 ? (rent * 12 - L * B.rate / 100) / inv2 * 100 : null;
    return { y, y2, inv, inv2 };
  }
  const rentSum = x => (x.rents || []).reduce((a, r) => ({ d: a.d + (r.deposit || 0), r: a.r + (r.rent || 0), v: a.v + (/공실/.test(r.label || '') ? 1 : 0) }), { d: 0, r: 0, v: 0 });

  // ---------- 저장 (한 칸씩 고쳐도 서버에는 매물 전체를 보냄) ----------
  const PEND = new Map(); let Q = Promise.resolve();
  function bodyOf(it) {
    const keys = X.moneyOf(it).map(m => m[0]);
    const b = { ...it, places: places(it).map(P => Object.fromEntries(Object.entries(P).filter(([k]) => !k.startsWith('_')))) };
    ['price', 'deposit', 'rent', 'mgmt', 'premium', 'curDep', 'curRent', 'loan', 'pr', 'paid'].forEach(k => { if (!keys.includes(k)) b[k] = null; });
    if (it.ptype !== '기타') b.ptypeTx = '';
    return b;
  }
  function saveItem(id, mut, msg) {
    if (X.ro().has(id)) { H.openForm(id); return Promise.resolve(); }
    const L = H.items(), i = L.findIndex(x => x.id === id); if (i < 0) return Promise.resolve();
    const pe = PEND.get(id), orig = pe ? pe.orig : L[i];
    const it = X.upgrade(pe ? pe.it : L[i]); mut(it);
    const tok = { it, orig }; PEND.set(id, tok);
    L[i] = it; refresh();
    Q = Q.then(async () => {
      const cur = PEND.get(id); if (!cur) return;
      try {
        const j = await H.api('/api/auth?action=listing', H.post({ op: 'save', id, item: bodyOf(cur.it) }));
        H.took(j);
        const now = PEND.get(id);
        if (now === cur) PEND.delete(id);
        else if (now) { const M = H.items(), k = M.findIndex(x => x.id === id); if (k >= 0) M[k] = now.it; }
        H.redraw(); if (msg) H.toast(msg);
      } catch (e) {
        PEND.delete(id); const M = H.items(), k = M.findIndex(x => x.id === id); if (k >= 0) M[k] = cur.orig;
        H.redraw();
        if (e.code === 'readonly' || e.code === 'limit') H.upsell(e.message); else H.toast(e.message || '저장하지 못했습니다', 4000);
      }
    });
    return Q;
  }

  // ---------- 거르기 · 정렬 ----------
  function pass(x) {
    if (B.st !== 'all' && x.status !== B.st) return false;
    if (B.kind !== 'all' && x.kind !== B.kind) return false;
    const q = B.q.toLowerCase();
    if (q && ![x.no, x.addr, x.road, x.bname, x.owner, x.phone, x.memo, x.ptype, JSON.stringify(x.places || ''), JSON.stringify(x.contacts || ''), JSON.stringify(x.rents || '')].join(' ').toLowerCase().includes(q)) return false;
    if (H.adv()) {
      const f = B.f, p = mainP(x), py = x.area ? x.area / PY : null;
      if (f.pmin && !(p >= f.pmin)) return false;
      if (f.pmax && !(p && p <= f.pmax)) return false;
      if (f.rmax && x.kind === 'wolse' && !(x.rent <= f.rmax)) return false;
      if (f.amin && !(py >= f.amin)) return false;
      if (f.amax && !(py && py <= f.amax)) return false;
      if (f.where) { const w = f.where.replace(/\s/g, '').toLowerCase(); if (![x.addr, x.road, x.bname, JSON.stringify(x.places || '')].join(' ').replace(/\s/g, '').toLowerCase().includes(w)) return false; }
    }
    return true;
  }
  const SORT = { at: x => x.at || '', ty: x => chip(x), addr: x => shortAddr(places(x)[0].addr || x.addr), pr: x => mainP(x) || 0, ar: x => x.area || 0, st: x => x.status, memo: x => x.up || '' };
  function rowsNow() {
    const all = H.items().filter(pass);
    const rows = B.ty === 'all' ? all : all.filter(x => tyOf(x) === B.ty);
    const f = SORT[B.sort] || SORT.at;
    rows.sort((a, b) => { const A = f(a), C = f(b); return (typeof A === 'number' && typeof C === 'number' ? A - C : String(A).localeCompare(String(C), 'ko', { numeric: true })) * B.dir; });
    return { all, rows };
  }
  const GRP = { '': '묶지 않음', bname: '단지·건물별', hood: '동네별', kind: '거래별', status: '상태별', pub: '리얼맵 등록별' };
  const gkey = x => B.grp === 'bname' ? (x.bname || '이름 없음') : B.grp === 'hood' ? (hood(x) || '동네 미상') : B.grp === 'kind' ? X.KIND[x.kind] : B.grp === 'status' ? X.STAT[x.status] : B.grp === 'pub' ? (X.pubLive(x) ? '리얼맵 게시 중' : X.isPub(x) ? '게시 기간 만료' : '리얼맵 미등록') : '';

  // ---------- 그리기 ----------
  function mount(el, host) {
    H = host; X = host.X; EL = el;
    EL.innerHTML = `<div class="lv-wrap bd" id="bd">
      <div id="bkLine2"></div>
      <div class="bd-bar" id="bdBar"></div>
      <div class="bd-add" id="bdAdd">
        <div class="bd-addin"><span class="plus">＋</span><input id="bdQ" type="search" autocomplete="off" enterkeyhint="search" placeholder="주소·건물명을 치고 Enter → 정보가 자동으로 채워집니다 (예: 서교동 395-12, ○○아파트 101동 1503호)"></div>
        <div id="bdRes"></div>
      </div>
      <div class="bd-t" id="bdT"></div>
      <div class="bd-pop" id="bdPop" hidden></div>
    </div>`;
    const q = $('bdQ');
    q.onkeydown = e => {
      if (e.isComposing) return;
      if (e.key === 'Enter') { e.preventDefault(); const v = q.value.trim(); if (B.add.res && B.add.res.length && v === B.add.q) return pick(B.add.res[0]); find(v); }
      if (e.key === 'Escape') { B.add.res = null; drawRes(); }
    };
    q.oninput = () => { if (!q.value.trim()) { B.add.res = null; drawRes(); } };
    EL.addEventListener('scroll', () => hidePop());
    document.addEventListener('mousedown', e => { const p = $('bdPop'); if (p && !p.hidden && !p.contains(e.target) && !e.target.closest('td[data-c]')) hidePop(); });
    B.fitNext = true;
    refresh();
    H.showMap(B.map);
  }
  function refresh() {
    if (!EL || !$('bd')) return;
    // 입력 중인 칸은 다시 그려도 그대로 (값·커서 유지)
    const a = document.activeElement, fk = a && a.dataset && a.dataset.fk && $('bd').contains(a) ? a.dataset.fk : null;
    const val = fk ? a.value : null, s0 = fk ? a.selectionStart : null, s1 = fk ? a.selectionEnd : null;
    drawBar(); drawTable();
    if (fk) { const n = $('bd').querySelector(`[data-fk="${CSS.escape(fk)}"]`); if (n) { if (n.value !== val) n.value = val; n.focus(); try { n.setSelectionRange(s0, s1); } catch { /* 숫자 칸 등 */ } } }
    H.drawBk && H.drawBk();
  }
  function drawBar() {
    const { all } = rowsNow(), adv = H.adv();
    const cnt = k => k === 'all' ? all.length : all.filter(x => tyOf(x) === k).length;
    const f = B.f, fon = adv && Object.values(f).some(v => v);
    $('bdBar').innerHTML = `<div class="bd-row">
      <span class="bsg">${TY.map(([k, t]) => `<button type="button" data-ty="${k}" aria-pressed="${B.ty === k}">${t} <small>${cnt(k)}</small></button>`).join('')}</span>
      <span class="bsg sm">${[['all', '모든 거래'], ['sale', '매매'], ['jeonse', '전세'], ['wolse', '월세'], ['presale', '분양권']].map(([k, t]) => `<button type="button" data-kd="${k}" aria-pressed="${B.kind === k}">${t}</button>`).join('')}</span>
      <span class="bsg sm">${[['on', '진행'], ['hold', '보류'], ['done', '완료'], ['all', '전체']].map(([k, t]) => `<button type="button" data-st="${k}" aria-pressed="${B.st === k}">${t}</button>`).join('')}</span>
      <input class="bd-find" id="bdFind" type="search" data-fk="find" placeholder="번호·주소·연락처·메모 찾기" value="${esc(B.q)}">
      <span class="sp"></span>
      <button type="button" class="tb${B.fo || fon ? ' on' : ''}${adv ? '' : ' lock'}" id="bdFo">손님 조건${fon ? ' ●' : ''}</button>
      <button type="button" class="tb${B.sel ? ' on' : ''}${adv ? '' : ' lock'}" id="bdSel">여러 건 선택</button>
      <button type="button" class="tb map${B.map ? ' on' : ''}" id="bdMap">${B.map ? '지도 닫기' : '지도로 보기'}</button>
      <button type="button" class="tb" id="bdCsv">엑셀</button>
      <button type="button" class="tb gold" id="bdForm" title="사진·광고 정보까지 한 번에 쓰는 매물 카드">매물 카드로 등록</button>
    </div>
    ${adv && B.fo ? `<div class="bd-row bd-f"><b>손님 조건</b>
      <label>가격 <input type="number" inputmode="numeric" data-f="pmin" value="${f.pmin || ''}" placeholder="최소"> ~ <input type="number" inputmode="numeric" data-f="pmax" value="${f.pmax || ''}" placeholder="최대"> 만원</label>
      <label>월세 <input type="number" inputmode="numeric" data-f="rmax" value="${f.rmax || ''}" placeholder="이하"> 만원</label>
      <label>면적 <input type="number" inputmode="decimal" data-f="amin" value="${f.amin || ''}" placeholder="최소"> ~ <input type="number" inputmode="decimal" data-f="amax" value="${f.amax || ''}" placeholder="최대"> 평</label>
      <label>지역·단지 <input type="search" data-f="where" value="${esc(f.where || '')}" placeholder="예: 아현동, 래미안"></label>
      <label>묶어 보기 <select id="bdGrp">${Object.entries(GRP).map(([k, t]) => `<option value="${k}" ${B.grp === k ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
      ${fon || B.grp ? '<button type="button" class="lnk" id="bdClr">조건 지우기</button>' : ''}</div>` : ''}`;
    const go = () => { keep(); B.fitNext = true; refresh(); };
    $('bdBar').querySelectorAll('[data-ty]').forEach(b => b.onclick = () => { B.ty = b.dataset.ty; go(); });
    $('bdBar').querySelectorAll('[data-kd]').forEach(b => b.onclick = () => { B.kind = b.dataset.kd; go(); });
    $('bdBar').querySelectorAll('[data-st]').forEach(b => b.onclick = () => { B.st = b.dataset.st; go(); });
    $('bdFind').oninput = e => { clearTimeout(B.fT); B.fT = setTimeout(() => { B.q = e.target.value.trim(); B.fitNext = true; refresh(); }, 250); };
    $('bdFo').onclick = () => { if (!H.adv()) return H.upsell('손님 조건으로 거르기 · 묶어 보기는 Basic 요금제(월 9,900원)부터 쓸 수 있습니다.'); B.fo = !B.fo; keep(); refresh(); };
    $('bdSel').onclick = () => { if (!H.adv()) return H.upsell('여러 건을 한꺼번에 처리하는 기능은 Basic 요금제(월 9,900원)부터 쓸 수 있습니다.'); B.sel = B.sel ? null : new Set(); refresh(); };
    $('bdMap').onclick = () => { B.map = !B.map; keep(); B.fitNext = true; H.showMap(B.map); refresh(); };
    $('bdCsv').onclick = () => H.csv(B.sel && B.sel.size ? H.items().filter(x => B.sel.has(x.id)) : rowsNow().rows);
    $('bdForm').onclick = () => H.openForm(null);
    $('bdBar').querySelectorAll('[data-f]').forEach(i => i.onchange = () => { const v = i.value.trim(); B.f[i.dataset.f] = i.dataset.f === 'where' ? v : (v ? Number(v) : ''); go(); });
    if ($('bdGrp')) $('bdGrp').onchange = e => { B.grp = e.target.value; go(); };
    if ($('bdClr')) $('bdClr').onclick = () => { B.f = {}; B.grp = ''; go(); };
  }

  // 표의 칸: [키, 제목, 정렬 키]
  const COLS = [['n', '#', 'at'], ['ty', '유형', 'ty'], ['addr', '주소 · 건물', 'addr'], ['pr', '거래 · 가격', 'pr'], ['ar', '면적', 'ar'], ['fl', '층 · 규모', ''], ['st', '상태', 'st'], ['tel', '연락처', ''], ['memo', '메모', 'memo'], ['act', '', '']];
  const EDIT = ['ty', 'pr', 'ar', 'fl', 'st', 'tel', 'memo'];
  const VC = () => B.map ? COLS.filter(c => !['fl', 'memo'].includes(c[0])) : COLS;    // 지도를 켜면 표가 좁아져 층·메모 칸은 숨김 (상세에서 보임)
  function cell(x, c, n) {
    const P = places(x)[0] || {}, a = x.ad || {};
    switch (c) {
      case 'n': return `${B.sel ? `<input type="checkbox" data-ck="${x.id}" ${B.sel.has(x.id) ? 'checked' : ''} aria-label="선택">` : ''}<span class="no">${n}</span>`;
      case 'ty': return `<span class="ty ${tyOf(x)}">${esc(chip(x))}</span>`;
      case 'addr': { const pl = places(x), u = pl.map(dh).filter(Boolean); return `<b>${esc(shortAddr(P.addr || x.addr))}</b>${pl.length > 1 ? ` <em>외 ${pl.length - 1}${isLand(x) ? '필지' : ''}</em>` : ''}<small>${esc([x.bname, u.slice(0, 2).join(', ') + (u.length > 2 ? ` 외 ${u.length - 2}` : '')].filter(Boolean).join(' · '))}</small>`; }
      case 'pr': {
        const p = mainP(x), no = x.kind === 'wolse' ? !x.rent && !x.deposit : !p;
        let sub = '';
        if (x.kind === 'sale' && x.price) {
          const k = detKind(x), ar = k === 'land' ? x.area : k === 'whole' ? siteOf(x) : 0;
          const rs = k === 'whole' ? rentSum(x) : { d: x.curDep, r: x.curRent }, y = yields(x, rs.d, rs.r);
          sub = [ar ? `${k === 'land' ? '평당' : '대지 평당'} ${sw(x.price / (ar / PY))}` : '', y ? `수익률 ${y.y.toFixed(1)}%` : ''].filter(Boolean).join(' · ');
        } else if (x.kind === 'wolse' && x.premium) sub = `권리금 ${sw(x.premium)}`;
        return `<span class="kd ${x.kind}">${X.KIND[x.kind]}</span> ${no ? '<span class="ep">가격 입력</span>' : `<b>${esc(x.kind === 'wolse' ? `${!x.deposit ? '0' : x.deposit >= 10000 ? sw(x.deposit) : x.deposit.toLocaleString()}/${x.rent ? x.rent.toLocaleString() : '-'}` : x.kind === 'presale' ? `P ${sw(x.pr)}${x.price ? ' · ' + sw(x.price) : ''}` : sw(p))}</b>`}${sub ? `<small>${esc(sub)}</small>` : ''}`;
      }
      case 'ar': { if (!x.area) return '<span class="ep">면적</span>'; const k = detKind(x); return `${k === 'whole' ? '연 ' : k === 'land' ? (places(x).length > 1 ? '합 ' : '') : '전용 '}${m2t(x.area)}<small>${k === 'whole' && siteOf(x) ? `대지 ${m2t(siteOf(x))} · ` : ''}${pyt(x.area)}</small>`; }
      case 'fl': {
        const k = detKind(x);
        if (k === 'land') return esc([a.use, zoneS(a.zone)].filter(Boolean).join(' · ')) || '<span class="ep">-</span>';
        if (k === 'whole') return `${esc([a.ufl ? `B${a.ufl}` : '', a.tfl ? a.tfl + 'F' : ''].filter(Boolean).join('~')) || '-'}<small>${esc([a.appr ? String(a.appr).slice(0, 4) + '년' : '', a.use ? a.use.split(' · ')[0] : ''].filter(Boolean).join(' · '))}</small>`;
        return a.fl || a.tfl ? `${esc(flTx(a.fl) || '?')}${a.tfl ? ` / ${a.tfl}F` : ''}` : '<span class="ep">층</span>';
      }
      case 'st': return `<span class="st ${x.status}">${{ on: '진행', hold: '보류', done: '완료' }[x.status]}</span>${X.pubLive(x) ? '<i class="pubdot" title="리얼맵 지도에 게시 중"></i>' : ''}`;
      case 'tel': { const cs = Array.isArray(x.contacts) ? x.contacts.filter(c => c.name || c.phone) : []; const c = cs[0]; return c ? `${esc([c.role, c.name].filter(Boolean).join(' '))}${cs.length > 1 ? ` <em>+${cs.length - 1}</em>` : ''}<small>${esc(c.phone || '')}</small>` : '<span class="ep">연락처</span>'; }
      case 'memo': { const L = X.memoParse(x.memo); return L.length ? `<span class="mm">${esc(L[0].x)}</span><small>${esc(L[0].t ? L[0].t.slice(3, 8).replace('.', '/') : '')}${L.length > 1 ? ` · 외 ${L.length - 1}건` : ''}</small>` : '<span class="ep">메모</span>'; }
      case 'act': return `<button type="button" class="det${B.open.has(x.id) ? ' on' : ''}" data-det="${x.id}">상세 ${B.open.has(x.id) ? '▴' : '▾'}</button>`;
    }
    return '';
  }
  // 칸 안에서 바로 고치기 (Enter 저장 · Esc 취소 · Tab 다음 칸)
  function editorHtml(x, c) {
    const a = x.ad || {}, fk = `e:${x.id}:${c}`, cs = (x.contacts || [])[0] || {};
    if (c === 'ar') return `<input class="ced" data-fk="${fk}" inputmode="decimal" value="${x.area || ''}" placeholder="㎡">`;
    if (c === 'fl') return `<input class="ced" data-fk="${fk}" value="${esc([a.fl, a.tfl].filter(v => v != null && v !== '').join('/'))}" placeholder="3/15 (해당층/총층)">`;
    if (c === 'tel') return `<input class="ced" data-fk="${fk}" value="${esc([cs.name, cs.phone].filter(Boolean).join(' '))}" placeholder="이름 010-0000-0000">`;
    if (c === 'memo') return `<input class="ced" data-fk="${fk}" value="" placeholder="새 메모 (Enter로 기록)">`;
    return '';
  }
  function rowHtml(x, n, RO) {
    const hl = B.hl === x.id;
    const tds = VC().map(([c]) => {
      const ed = B.ed && B.ed.id === x.id && B.ed.c === c;
      return `<td class="c-${c}${ed ? ' editing' : ''}"${EDIT.includes(c) && !RO.has(x.id) ? ` data-c="${c}"` : ''}>${ed ? editorHtml(x, c) : cell(x, c, n)}</td>`;
    }).join('');
    return `<tr id="b_${x.id}" data-id="${x.id}" class="${hl ? 'on' : ''}${x.status === 'done' ? ' dn' : ''}${RO.has(x.id) ? ' ro' : ''}">${tds}</tr>${B.open.has(x.id) ? `<tr class="bd-dt" data-dt="${x.id}"><td colspan="${VC().length}">${detailHtml(x)}</td></tr>` : ''}`;
  }
  function drawTable() {
    const { rows } = rowsNow(), RO = X.ro();
    const nos = new Map(rows.map((x, i) => [x.id, i + 1]));
    const groups = new Map(); rows.forEach(x => { const k = H.adv() ? gkey(x) : ''; (groups.get(k) || groups.set(k, []).get(k)).push(x); });
    const avg = list => { const by = {}; list.forEach(x => { const p = mainP(x); if (p) (by[x.kind] || (by[x.kind] = [])).push(p); }); return Object.entries(by).map(([k, v]) => `${X.KIND[k]} ${v.length} · 평균 ${sw(v.reduce((a, b) => a + b, 0) / v.length)}`).join(' / '); };
    const th = VC().map(([c, t, s]) => `<th class="c-${c}${s ? ' s' : ''}${B.sort === s && s ? ' on' : ''}"${s ? ` data-sort="${s}"` : ''}>${c === 'n' && B.sel ? `<input type="checkbox" id="bdAll" aria-label="모두 선택" ${rows.length && rows.every(x => B.sel.has(x.id)) ? 'checked' : ''}>` : ''}${t}${B.sort === s && s && c !== 'n' ? (B.dir > 0 ? ' ▲' : ' ▼') : ''}</th>`).join('');
    const D = B.add.D;
    const body = (D ? draftHtml(D) : '') + [...groups.entries()].map(([k, list]) => (k ? `<tr class="gh"><td colspan="${VC().length}"><b>${esc(k)}</b> <span>${list.length}건${avg(list) ? ' · ' + esc(avg(list)) : ''}</span></td></tr>` : '') + list.map(x => rowHtml(x, nos.get(x.id), RO)).join('')).join('');
    const empty = !H.items().length ? `<tr><td colspan="${VC().length}" class="none"><b>아직 등록한 매물이 없습니다</b>위 칸에 주소를 치고 Enter를 눌러 보세요. 건물 정보가 자동으로 채워집니다.</td></tr>`
      : !rows.length && !D ? `<tr><td colspan="${VC().length}" class="none">조건에 맞는 매물이 없습니다.</td></tr>` : '';
    const selBar = B.sel && B.sel.size ? `<div class="bd-bulk"><b>${B.sel.size}건 선택</b><button type="button" data-bulk="on">진행</button><button type="button" data-bulk="hold">보류</button><button type="button" data-bulk="done">거래완료</button><button type="button" id="bdSelCsv">선택만 엑셀</button><button type="button" class="lnk" id="bdUnsel">선택 해제</button></div>` : '';
    $('bdT').innerHTML = `${selBar}<div class="bd-scroll"><table class="bdt"><colgroup>${VC().map(([c]) => `<col class="w-${c}">`).join('')}</colgroup><thead><tr>${th}</tr></thead><tbody>${body}${empty}</tbody></table></div>`;
    wireTable(rows);
    if (D) wireDraft(D);
    H.pins(rows.map(x => x.id), B.map && B.fitNext); if (B.map) B.fitNext = false;
    const ed = B.ed && $('bdT').querySelector('td.editing input');
    if (ed && document.activeElement !== ed) { ed.focus(); if (ed.select) ed.select(); }
  }
  function wireTable(rows) {
    const T = $('bdT');
    T.querySelectorAll('th[data-sort]').forEach(h => h.onclick = e => { if (e.target.closest('input')) return; const s = h.dataset.sort; if (B.sort === s) B.dir *= -1; else { B.sort = s; B.dir = ['at', 'pr', 'ar', 'memo'].includes(s) ? -1 : 1; } keep(); refresh(); });
    T.querySelectorAll('[data-det]').forEach(b => b.onclick = e => { e.stopPropagation(); toggle(b.dataset.det); });
    T.querySelectorAll('tr[data-id]').forEach(r => r.onclick = e => {
      if (e.target.closest('input,button,a,select,textarea')) return;
      const td = e.target.closest('td'), id = r.dataset.id;
      if (td && td.dataset.c && !td.classList.contains('editing')) return startEdit(id, td.dataset.c, td);
      if (r.classList.contains('ro') && td && EDIT.some(c => td.classList.contains('c-' + c))) return H.openForm(id);   // 보기 전용: 요금제 안내
      if (td && td.classList.contains('c-addr')) toggle(id);
      H.focus(id);
    });
    T.querySelectorAll('td.editing input.ced').forEach(inp => {
      inp.onkeydown = e => {
        if (e.isComposing) return;
        if (e.key === 'Enter') { e.preventDefault(); commit(inp, 'down'); }
        else if (e.key === 'Escape') { e.preventDefault(); B.ed = null; refresh(); }
        else if (e.key === 'Tab') { e.preventDefault(); commit(inp, e.shiftKey ? 'prev' : 'next'); }
      };
      inp.onblur = () => setTimeout(() => { if (B.ed && document.activeElement !== inp && inp.isConnected) commit(inp); }, 120);
    });
    if (B.sel) {
      T.querySelectorAll('[data-ck]').forEach(c => c.onclick = e => { e.stopPropagation(); c.checked ? B.sel.add(c.dataset.ck) : B.sel.delete(c.dataset.ck); refresh(); });
      if ($('bdAll')) $('bdAll').onchange = e => { if (e.target.checked) rows.forEach(x => B.sel.add(x.id)); else B.sel.clear(); refresh(); };
      if ($('bdUnsel')) $('bdUnsel').onclick = () => { B.sel.clear(); refresh(); };
      if ($('bdSelCsv')) $('bdSelCsv').onclick = () => H.csv(H.items().filter(x => B.sel.has(x.id)));
      T.querySelectorAll('[data-bulk]').forEach(b => b.onclick = async () => {
        const st = b.dataset.bulk, ids = [...B.sel].filter(id => (H.items().find(x => x.id === id) || {}).status !== st);
        if (!ids.length) return H.toast('이미 그 상태입니다');
        if (!confirm(`${ids.length}건을 '${X.STAT[st]}' 처리할까요?`)) return;
        let ok = 0;
        for (const id of ids) { try { H.took(await H.api('/api/auth?action=listing', H.post({ op: 'status', id, status: st }))); ok++; } catch (e) { H.toast(e.message, 3500); break; } }
        B.sel.clear(); H.redraw(); H.toast(`${ok}건을 '${X.STAT[st]}' 처리했습니다`);
      });
    }
    T.querySelectorAll('tr.bd-dt').forEach(r => wireDetail(r, H.items().find(x => x.id === r.dataset.dt)));
  }
  function toggle(id) { B.open.has(id) ? B.open.delete(id) : B.open.add(id); B.hl = id; refresh(); }
  function startEdit(id, c, td) {
    const x = H.items().find(i => i.id === id); if (!x) return;
    hidePop();
    if (c === 'pr') return pricePop(x, td);
    if (c === 'st') return statusPop(x, td);
    if (c === 'ty') return typePop(x, td);
    if (c === 'ar' && places(x).length > 1) { B.open.add(id); refresh(); return H.toast('필지·호가 여러 개인 매물은 상세에서 하나씩 고칩니다'); }
    B.ed = { id, c }; B.hl = id; refresh();
  }
  const NAV0 = ['ar', 'fl', 'tel', 'memo'];
  function commit(inp, move) {
    if (!B.ed) return;
    const { id, c } = B.ed, v = inp.value.trim(), x = H.items().find(i => i.id === id);
    let next = null;
    if (move === 'next' || move === 'prev') { const NAV = NAV0.filter(k => VC().some(v => v[0] === k)), i = NAV.indexOf(c) + (move === 'next' ? 1 : -1); if (i >= 0 && i < NAV.length) next = { id, c: NAV[i] }; }
    else if (move === 'down') { const ids = [...$('bdT').querySelectorAll('tr[data-id]')].map(r => r.dataset.id), k = ids.indexOf(id); if (c === 'memo' || c === 'tel') next = null; else if (k >= 0 && ids[k + 1]) next = { id: ids[k + 1], c }; }
    B.ed = next;
    if (!x) return refresh();
    const a = x.ad || {}, cs = (x.contacts || [])[0] || {};
    if (c === 'ar') { const n = parseFloat(v.replace(/[^\d.]/g, '')) || null; if (n === (x.area || null)) return refresh(); return saveItem(id, it => { it.places[0].area = n; it.area = n; }); }
    if (c === 'fl') {
      const [f, t] = v.split('/').map(s => s.trim()); const fl = (f || '').replace(/층$/i, '').replace(/^지하\s*/, 'B').replace(/f$/i, ''), tfl = t ? parseInt(t, 10) || null : (a.tfl ?? null);
      if (fl === String(a.fl || '') && tfl === (a.tfl ?? null)) return refresh();
      return saveItem(id, it => { it.ad = { ...(it.ad || {}), fl, tfl }; });
    }
    if (c === 'tel') {
      const m = v.match(/0\d{1,2}[-\s]?\d{3,4}[-\s]?\d{4}/), phone = m ? m[0].replace(/\s/g, '-') : '', name = (m ? v.replace(m[0], '') : v).trim().slice(0, 20);
      if (name === (cs.name || '') && phone.replace(/\D/g, '') === String(cs.phone || '').replace(/\D/g, '')) return refresh();
      return saveItem(id, it => { const c0 = it.contacts[0] || { role: '소유자' }; it.contacts[0] = { ...c0, name, phone: fmtPhone(phone) }; if (!name && !phone) it.contacts.shift(); });
    }
    if (c === 'memo') { if (!v) return refresh(); return saveItem(id, it => { it.memo = X.memoAdd(it.memo, v); }); }
    refresh();
  }
  // ---------- 작은 창 (가격 · 상태 · 유형) ----------
  function showPop(td, html) {
    const p = $('bdPop'), r = td.getBoundingClientRect(), box = EL.getBoundingClientRect();
    p.innerHTML = html; p.hidden = false;
    const z = parseFloat(getComputedStyle($('bd')).zoom) || 1;
    p.style.left = `${Math.max(8, Math.min((r.left - box.left) / z, (box.width / z) - p.offsetWidth - 12))}px`;
    p.style.top = `${(r.bottom - box.top + EL.scrollTop) / z + 4}px`;
    return p;
  }
  function hidePop() { const p = $('bdPop'); if (p && !p.hidden) { p.hidden = true; p.innerHTML = ''; } }
  function statusPop(x, td) {
    const p = showPop(td, `<div class="pl">${[['on', '진행 중'], ['hold', '보류'], ['done', '거래완료']].map(([k, t]) => `<button type="button" data-s="${k}" class="${x.status === k ? 'on' : ''}">${t}</button>`).join('')}</div>`);
    p.querySelectorAll('[data-s]').forEach(b => b.onclick = async () => {
      hidePop(); const st = b.dataset.s; if (st === x.status) return;
      try { H.took(await H.api('/api/auth?action=listing', H.post({ op: 'status', id: x.id, status: st }))); H.redraw(); H.toast(`'${X.STAT[st]}' 처리했습니다`); }
      catch (e) { if (e.code === 'readonly') H.upsell(e.message); else H.toast(e.message, 4000); }
    });
  }
  function typePop(x, td) {
    const p = showPop(td, `<div class="pl grid">${X.PTYPES.map(t => `<button type="button" data-t="${t}" class="${x.ptype === t ? 'on' : ''}">${t}</button>`).join('')}</div>`);
    p.querySelectorAll('[data-t]').forEach(b => b.onclick = () => { hidePop(); const t = b.dataset.t; if (t !== x.ptype) saveItem(x.id, it => { it.ptype = t; }); });
  }
  const PF = { sale: [['price', '매매가']], jeonse: [['deposit', '전세 보증금']], wolse: [['deposit', '보증금'], ['rent', '월세']], presale: [['price', '분양가'], ['pr', '프리미엄(P)']] };
  function pricePop(x, td) {
    let kind = x.kind;
    const draw = () => {
      const p = showPop(td, `<div class="pp"><div class="bsg sm">${Object.entries(X.KIND).map(([k, t]) => `<button type="button" data-k="${k}" aria-pressed="${kind === k}">${t}</button>`).join('')}</div>
        ${PF[kind].map(([k, t]) => `<label>${t}<input data-m="${k}" inputmode="text" value="${esc(manTx(kind === x.kind ? x[k] : (k === 'deposit' && x.kind !== 'sale' ? x.deposit : k === 'price' && ['sale', 'presale'].includes(x.kind) ? x.price : '')))}" placeholder="${k === 'rent' ? '320' : '예) 3억2천, 68억'}"><small data-h="${k}"></small></label>`).join('')}
        ${kind !== 'presale' ? `<label>관리비<input data-m="mgmt" value="${esc(manTx(x.mgmt))}" placeholder="월, 만원"><small data-h="mgmt"></small></label>` : ''}
        <div class="pb"><span class="hint">만원 단위 · '억' '천' 써도 됩니다</span><button type="button" class="ok">저장</button></div></div>`);
      p.querySelectorAll('[data-k]').forEach(b => b.onclick = () => { kind = b.dataset.k; draw(); });
      const hint = i => { const v = man(i.value), h = p.querySelector(`[data-h="${i.dataset.m}"]`); if (h) h.textContent = Number.isNaN(v) ? '숫자를 확인해 주세요' : v ? X.won(v) : ''; };
      p.querySelectorAll('[data-m]').forEach(i => { hint(i); i.oninput = () => hint(i); i.onkeydown = e => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); ok(); } if (e.key === 'Escape') hidePop(); }; });
      const ok = () => {
        const vals = {}; let bad = false;
        p.querySelectorAll('[data-m]').forEach(i => { const v = man(i.value); if (Number.isNaN(v)) bad = true; vals[i.dataset.m] = v; });
        if (bad) return H.toast('금액을 확인해 주세요 (예: 3억2천, 5000)');
        hidePop();
        saveItem(x.id, it => { it.kind = kind; Object.assign(it, vals); });
      };
      p.querySelector('.ok').onclick = ok;
      const f = p.querySelector('[data-m]'); if (f) { f.focus(); f.select(); }
    };
    draw();
  }

  // ---------- 상세 (줄 아래로 펼침) ----------
  function detailHtml(x) {
    const k = detKind(x), RO = X.ro().has(x.id);
    let main = '';
    if (k === 'whole') main = floorsHtml(x, RO);
    else if (k === 'land') main = parcelsHtml(x, RO);
    else main = unitHtml(x, RO);
    const L = X.memoParse(x.memo);
    const pub = X.isPub(x) ? (X.pubLive(x) ? `<span class="pubon">● 리얼맵 게시 중 · ${X.ymd(x.pub.exp).slice(5)}까지</span>` : '<span class="puboff">게시 기간 만료</span>') : '';
    return `<div class="dt">${main}
      <div class="dt-2">
        <div class="dt-memo"><b>메모 기록</b> <input class="in" data-fk="m:${x.id}" data-mnew="${x.id}" placeholder="새 메모 (Enter로 기록)" ${RO ? 'disabled' : ''}>${L.length ? `<ul>${L.slice(0, 6).map(e => `<li><span>${esc(e.t || '예전')}</span>${esc(e.x)}</li>`).join('')}${L.length > 6 ? `<li class="more">외 ${L.length - 6}건 · 매물 카드에서 모두 보기</li>` : ''}</ul>` : ''}</div>
        ${(x.photos || []).length ? `<div class="dt-ph">${x.photos.slice(0, 6).map((p, i) => `<button type="button" data-ph="${i}"><img src="${esc(p.url)}" alt="" loading="lazy"></button>`).join('')}</div>` : ''}
      </div>
      <div class="dt-acts">${pub}
        <button type="button" class="b gold" data-a="card">매물 카드 열기 <small>사진 · 광고 정보 · 전체 수정</small></button>
        ${H.canPub() && x.status === 'on' ? (X.isPub(x) ? `<button type="button" class="b" data-a="renew">${X.pubLive(x) ? '게시 연장' : '다시 게시'}</button>${X.pubLive(x) ? '<button type="button" class="b" data-a="share">링크 공유</button>' : ''}<button type="button" class="b" data-a="unpub">지도에서 내리기</button>` : '<button type="button" class="b blue" data-a="pub">리얼맵 등록</button>') : ''}
        <button type="button" class="b" data-a="brief">브리핑</button>
        <a class="b" href="/?pnu=${esc(x.pnu || places(x)[0].pnu)}" target="_blank" rel="noopener">필지 정보 ↗</a>
        <span class="sp"></span><small class="meta">No. ${esc(x.no || '')} · 등록 ${X.ymd(x.at)}</small>
        <button type="button" class="b del" data-a="del">삭제</button></div></div>`;
  }
  // 통건물 · 공장: 층별 현황
  function floorsHtml(x, RO) {
    const R0 = x.rents || [], R = [...R0, ...Array(B.blank.get(x.id) || 0).fill({})], s = rentSum(x), y = yields(x, s.d, s.r), dis = RO ? 'disabled' : '';
    const inp = (i, k, v, ph, cls = '') => `<input class="ci ${cls}" data-fk="r:${x.id}:${i}:${k}" data-ri="${i}" data-rk="${k}" value="${esc(v ?? '')}" placeholder="${ph}" ${dis}>`;
    return `<div class="dt-h"><b>층별 현황</b><small>층·용도·면적은 건축물대장에서 자동 · 임차인·보증금·월세·만기만 넣으면 합계와 수익률이 계산됩니다</small>
        ${RO ? '' : `<button type="button" class="lnk" data-a="floors">${R0.length ? '건축물대장으로 다시 깔기' : '건축물대장 층별 정보 불러오기'}</button>`}</div>
      ${R.length ? `<table class="ft"><thead><tr><th>층</th><th>용도</th><th class="r">면적㎡</th><th>임차인 · 업종</th><th class="r">보증금</th><th class="r">월세</th><th>만기</th><th>메모</th><th></th></tr></thead><tbody>
        ${R.map((r, i) => `<tr class="${/공실/.test(r.label || '') ? 'vac' : ''}"><td>${inp(i, 'fl', r.fl, '1F', 'w4')}</td><td>${inp(i, 'use', r.use, '용도')}</td><td>${inp(i, 'area', r.area, '', 'r w6')}</td>
          <td>${inp(i, 'label', r.label, '상호 · 업종 / 공실')}</td><td>${inp(i, 'deposit', manTx(r.deposit), '만원', 'r w7')}</td><td>${inp(i, 'rent', r.rent ? r.rent.toLocaleString() : '', '만원', 'r w6')}</td>
          <td>${inp(i, 'exp', r.exp, 'YY.MM', 'w6')}</td><td>${inp(i, 'memo', r.memo, '')}</td><td>${RO ? '' : `<button type="button" class="x" data-rdel="${i}" aria-label="이 줄 지우기">×</button>`}</td></tr>`).join('')}
        </tbody></table>${RO ? '' : '<button type="button" class="lnk" data-a="radd">＋ 줄 추가</button>'}` : '<div class="meta" style="padding:6px 2px">아직 층별 현황이 없습니다.</div>'}
      <div class="sums"><span>보증금 합계 <b>${s.d ? sw(s.d) : '0'}</b></span><span>월세 합계 <b>${s.r ? sw(s.r) : '0'}</b></span><span>공실 <b>${s.v}개 층</b></span>
        ${y ? `<span class="y">연 수익률 <b>${y.y.toFixed(2)}%</b> <small>(매매가 − 보증금 ${sw(y.inv)} 기준)</small></span>` : x.kind === 'sale' ? '<span class="meta">매매가와 월세를 넣으면 수익률이 나옵니다</span>' : ''}
        ${x.kind === 'sale' ? `<span class="loan">융자 <input class="ci r w7" data-fk="l:${x.id}" data-loan="${x.id}" value="${esc(manTx(x.loan))}" placeholder="만원" ${dis}> 금리 <input class="ci r w4" data-rate="1" value="${B.rate}" inputmode="decimal">%${y && y.y2 != null ? ` → 융자 반영 <b>${y.y2.toFixed(2)}%</b> <small>(실투자 ${sw(y.inv2)})</small>` : ''}</span>` : ''}</div>`;
  }
  // 토지: 필지별
  function parcelsHtml(x, RO) {
    const pl = places(x), tot = pl.reduce((a, p) => a + (p.area || 0), 0);
    pl.forEach(p => { if (p.pnu && !B.L[p.pnu]) landOf(p.pnu); });
    const lpSum = pl.reduce((a, p) => { const c = B.L[p.pnu]; return a + (c && c.price && p.area ? c.price * p.area : 0); }, 0);
    return `<div class="dt-h"><b>필지</b><small>필지를 붙이면 면적·공시지가가 합산됩니다 · 지목·용도지역·공시지가는 토지대장 자동</small></div>
      <table class="ft"><thead><tr><th>지번</th><th>지목</th><th class="r">면적㎡</th><th>용도지역</th><th class="r">공시지가 ㎡당</th><th>도로</th><th>형상</th><th></th></tr></thead><tbody>
      ${pl.map((p, i) => { const c = B.L[p.pnu]; const v = c === 'loading' ? '<span class="meta">불러오는 중…</span>' : null; return `<tr><td>${esc(shortAddr(p.addr))}</td><td>${v || esc(c && c.jimok || '')}</td>
        <td class="r"><input class="ci r w7" data-fk="pa:${x.id}:${i}" data-pa="${i}" value="${p.area || ''}" ${RO ? 'disabled' : ''}></td><td>${v ? '' : esc(c && [c.zone1, c.zone2].filter(Boolean).join(' · ') || '')}</td>
        <td class="r">${c && c.price ? c.price.toLocaleString() + '원' : ''}</td><td>${esc(c && c.road || '')}</td><td>${esc(c && c.shape || '')}</td>
        <td>${pl.length > 1 && !RO ? `<button type="button" class="x" data-pdel="${i}" aria-label="이 필지 빼기">×</button>` : ''}</td></tr>`; }).join('')}
      </tbody></table>
      ${RO ? '' : `<div class="padd"><input class="in" data-fk="pq:${x.id}" data-pq="${x.id}" placeholder="＋ 필지 추가: 지번을 치고 Enter (예: ${esc(shortAddr(pl[0].addr).replace(/\s?\S+$/, '') || '상암동')} 12-3)"><div class="pres" data-pres="${x.id}">${B.add.pres && B.add.pres.id === x.id ? presHtml(B.add.pres.res) : ''}</div></div>`}
      <div class="sums"><span>합계 <b>${m2t(Math.round(tot * 100) / 100)}</b> (${pyt(tot)})</span>${x.kind === 'sale' && x.price && tot ? `<span class="y">평당 <b>${sw(x.price / (tot / PY))}</b></span>` : ''}${lpSum ? `<span>공시지가 합계 <b>${sw(lpSum / 1e4)}</b></span>` : ''}</div>`;
  }
  const presHtml = res => !res ? '' : res === 'busy' ? '<div class="meta">찾는 중…</div>' : !res.length ? '<div class="meta">찾지 못했습니다. 동 이름과 지번을 함께 넣어 보세요.</div>' : res.map((r, i) => `<button type="button" data-pr="${i}"><b>${esc(r.t)}</b> <small>${esc(r.s)}</small></button>`).join('');
  // 상가 · 주거: 호 정보 + 수익률
  function unitHtml(x, RO) {
    const a = x.ad || {}, P = places(x)[0], dis = RO ? 'disabled' : '';
    const keys = X.moneyOf(x).map(m => m[0]).filter(k => !['price', 'deposit', 'rent', 'pr'].includes(k));
    const LB = { mgmt: '관리비(월)', premium: '권리금', curDep: '기보증금', curRent: '기월세', loan: x.kind === 'presale' ? '중도금 대출' : '융자', paid: '납입액' };
    const y = yields(x, x.curDep, x.curRent);
    const info = [['동·호', places(x).map(dh).filter(Boolean).join(', ')], ['전용', x.area ? `${m2t(x.area)} (${pyt(x.area)})` : ''], ['층', a.fl || a.tfl ? `${flTx(a.fl) || '?'}${a.tfl ? ' / ' + a.tfl + 'F' : ''}` : ''], ['용도', a.use], ['사용승인', a.appr], ['방향', a.dir], ['방·욕실', a.rooms != null && a.rooms !== '' ? `${a.rooms} / ${a.baths ?? '-'}` : ''], ['입주', a.movein], ['주차', a.park], ['업종', a.biz]].filter(r => r[1]);
    const pk = P.pnu && P.ho ? `${P.pnu}|${P.dong || ''}|${P.ho}` : '';
    if (pk && B.U[pk] === undefined && /아파트|빌라|오피스텔|주택/.test(x.ptype || '')) hoPrice(P, pk);
    const gp = pk && B.U[pk] && B.U[pk].price;
    return `<div class="dt-h"><b>${esc(chip(x))} 정보</b><small>건축물대장 자동 · 나머지는 매물 카드에서</small></div>
      <div class="kv">${info.map(([k, v]) => `<span><em>${k}</em>${esc(v)}</span>`).join('')}${gp ? `<span><em>공시가격</em>${esc(sw(gp.price / 1e4))} (${gp.year})</span>` : ''}</div>
      ${keys.length ? `<div class="mf">${keys.map(k => `<label>${LB[k] || k}<input class="ci r w7" data-fk="u:${x.id}:${k}" data-uk="${k}" value="${esc(manTx(x[k]))}" placeholder="만원" ${dis}></label>`).join('')}</div>` : ''}
      ${y ? `<div class="sums"><span class="y">연 수익률 <b>${y.y.toFixed(2)}%</b> <small>(매매가 − 기보증금 ${sw(y.inv)} 기준)</small></span>${y.y2 != null ? `<span>융자 반영 (금리 <input class="ci r w4" data-rate="1" value="${B.rate}" inputmode="decimal">%) <b>${y.y2.toFixed(2)}%</b></span>` : ''}</div>` : ''}`;
  }
  function wireDetail(r, x) {
    if (!x) return;
    const id = x.id;
    const RO = X.ro().has(id);
    r.querySelectorAll('[data-a]').forEach(b => b.onclick = async e => {
      e.stopPropagation();
      const a = b.dataset.a;
      if (a === 'card') return H.openForm(id);
      if (a === 'pub') return H.pub(id);
      if (a === 'renew') return H.pubOp(id, 'renew');
      if (a === 'unpub') { if (confirm('리얼맵 지도에서 이 매물을 내릴까요? (매물장에는 그대로 남습니다)')) H.pubOp(id, 'unpub'); return; }
      if (a === 'share') return H.share(id);
      if (a === 'brief') return H.brief(id);
      if (a === 'del') {
        if (!confirm(`이 매물을 삭제할까요?\n${shortAddr(places(x)[0].addr)} ${X.KIND[x.kind]}\n삭제하면 되돌릴 수 없습니다.`)) return;
        try { H.took(await H.api('/api/auth?action=listing', H.post({ op: 'del', id }))); B.open.delete(id); H.redraw(); H.toast('삭제했습니다'); } catch (er) { H.toast(er.message, 4000); }
        return;
      }
      if (a === 'floors') return refillFloors(x);
      if (a === 'radd') { B.blank.set(id, (B.blank.get(id) || 0) + 1); refresh(); const q = $('bdT').querySelector(`[data-fk="r:${id}:${(x.rents || []).length + B.blank.get(id) - 1}:fl"]`); if (q) q.focus(); return; }
    });
    r.querySelectorAll('[data-ph]').forEach(b => b.onclick = () => H.viewer(x.photos.map(p => p.url), +b.dataset.ph));
    const mnew = r.querySelector('[data-mnew]');
    if (mnew) mnew.onkeydown = e => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); const v = mnew.value.trim(); if (!v) return; mnew.value = ''; saveItem(id, it => { it.memo = X.memoAdd(it.memo, v); }, '메모를 기록했습니다'); } };
    if (RO) return;
    // 층별 칸: 고치고 나가거나 Enter → 저장
    r.querySelectorAll('[data-ri]').forEach(i => {
      i.onkeydown = e => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); i.blur(); } };
      i.onchange = () => setTimeout(() => {
        const n = +i.dataset.ri, k = i.dataset.rk, v = i.value.trim();
        const val = k === 'deposit' || k === 'rent' ? man(v) : k === 'area' ? (parseFloat(v.replace(/[^\d.]/g, '')) || null) : v;
        if (Number.isNaN(val)) return H.toast('금액을 확인해 주세요 (예: 3000, 1억)');
        const have = (H.items().find(z => z.id === id) || x).rents || [];
        if (n >= have.length) { if (val === '' || val == null) return; B.blank.set(id, Math.max(0, (B.blank.get(id) || 0) - (n - have.length + 1))); }   // 새 줄은 뭔가 써야 저장
        saveItem(id, it => { while (it.rents.length <= n) it.rents.push({ fl: '', use: '', area: null, label: '', deposit: null, rent: null, exp: '', memo: '' }); const R = it.rents[n]; R[k] = val; if (it.kind === 'sale') { const s = rentSum(it); it.curDep = s.d || null; it.curRent = s.r || null; } });
      }, 0);
    });
    r.querySelectorAll('[data-rdel]').forEach(b => b.onclick = () => +b.dataset.rdel >= (x.rents || []).length ? (B.blank.set(id, Math.max(0, (B.blank.get(id) || 0) - 1)), refresh()) : saveItem(id, it => { it.rents.splice(+b.dataset.rdel, 1); if (it.kind === 'sale') { const s = rentSum(it); it.curDep = s.d || null; it.curRent = s.r || null; } }));
    const ln = r.querySelector('[data-loan]');
    if (ln) { ln.onkeydown = e => { if (e.key === 'Enter') ln.blur(); }; ln.onchange = () => setTimeout(() => { const v = man(ln.value); if (Number.isNaN(v)) return H.toast('금액을 확인해 주세요'); saveItem(id, it => { it.loan = v; }); }, 0); }
    r.querySelectorAll('[data-rate]').forEach(rt => { rt.onchange = () => setTimeout(() => { const v = parseFloat(rt.value); if (v >= 0 && v < 30) { B.rate = v; keep(); refresh(); } }, 0); });
    r.querySelectorAll('[data-uk]').forEach(i => { i.onkeydown = e => { if (e.key === 'Enter') i.blur(); }; i.onchange = () => setTimeout(() => { const v = man(i.value); if (Number.isNaN(v)) return H.toast('금액을 확인해 주세요'); saveItem(id, it => { it[i.dataset.uk] = v; }); }, 0); });
    r.querySelectorAll('[data-pa]').forEach(i => { i.onkeydown = e => { if (e.key === 'Enter') i.blur(); }; i.onchange = () => setTimeout(() => { const v = parseFloat(i.value.replace(/[^\d.]/g, '')) || null; saveItem(id, it => { it.places[+i.dataset.pa].area = v; }); }, 0); });
    r.querySelectorAll('[data-pdel]').forEach(b => b.onclick = () => { if (confirm('이 필지를 뺄까요?')) saveItem(id, it => { it.places.splice(+b.dataset.pdel, 1); }); });
    const pq = r.querySelector('[data-pq]');
    if (pq) pq.onkeydown = e => {
      if (e.key !== 'Enter' || e.isComposing) return; e.preventDefault();
      let q = pq.value.trim(); if (!q) return;
      // 지번만 치면 첫 필지의 동네를 붙여서 찾음
      if (/^산?\s*\d+(-\d+)?$/.test(q)) { const base = String(places(x)[0].addr || '').split(' '); const k = base.findIndex(t => /(동|가|리|읍|면)\d*$/.test(t) && !/[시군구]$/.test(t)); if (k >= 0) q = base.slice(0, k + 1).join(' ') + ' ' + q; }
      B.add.pres = { id, res: 'busy' }; refresh();
      kakaoFind(q, res => { B.add.pres = { id, res, q }; refresh(); });
    };
    r.querySelectorAll('[data-pr]').forEach(b => b.onclick = async () => {
      const res = B.add.pres && B.add.pres.res, h = res && res[+b.dataset.pr]; if (!h) return;
      B.add.pres = null;
      try {
        const p = await H.api(`/api/parcel?lat=${h.lat}&lng=${h.lng}`);
        const pnu = p.pnu || p.bldPnu;
        if (places(x).some(P => P.pnu === pnu)) return H.toast('이미 들어 있는 필지입니다');
        const c = await landOf(pnu);
        saveItem(id, it => { it.places.push({ pnu, addr: p.addr || h.t, lat: h.lat, lng: h.lng, bname: '', dong: '', ho: '', area: (c && c.area) || null, land: true, ak: 'land' }); }, '필지를 붙였습니다');
      } catch { H.toast('그 위치의 필지를 찾지 못했습니다', 3500); refresh(); }
    });
  }
  async function landOf(pnu) {
    if (B.L[pnu] && B.L[pnu] !== 'loading') return B.L[pnu];
    if (B.L[pnu] === 'loading') return null;
    B.L[pnu] = 'loading';
    try { const L = await H.api(`/api/land?pnu=${pnu}`); B.L[pnu] = (L.chr && L.chr.data) || {}; } catch { B.L[pnu] = {}; }
    refresh(); return B.L[pnu];
  }
  async function hoPrice(P, key) {
    B.U[key] = null;
    try { const j = await H.api(`/api/units?pnu=${P.pnu}&dong=${encodeURIComponent(P.dong ? (/동$/.test(P.dong) ? P.dong : P.dong + '동') : '')}&ho=${encodeURIComponent(P.ho)}`); B.U[key] = { price: j.price && j.price.ok && j.price.data && j.price.data.price ? j.price.data : null }; } catch { B.U[key] = {}; }
    refresh();
  }
  async function refillFloors(x) {
    const P = places(x)[0];
    if ((x.rents || []).some(r => r.label || r.deposit || r.rent) && !confirm('지금 입력한 층별 내용(임차인·보증금·월세)을 지우고 건축물대장대로 다시 깔까요?')) return;
    H.toast('건축물대장 층별 정보를 불러오는 중…');
    const fl = await floorsOf(P.pnu);
    if (!fl.length) return H.toast('층별 정보가 없습니다. ＋ 줄 추가로 직접 넣어 주세요', 4000);
    saveItem(x.id, it => { it.rents = fl.map(f => ({ fl: f.fl, use: f.use, area: f.area, label: '', deposit: null, rent: null, exp: '', memo: '' })); if (it.kind === 'sale') { it.curDep = null; it.curRent = null; } }, `층별 ${fl.length}개 층을 깔았습니다`);
  }

  // ---------- 주소 한 줄 입력 → 새 줄 ----------
  function kakaoFind(q0, cb) {
    if (!H.kakao()) { H.toast('지도 기능을 불러오는 중입니다. 잠시 후 다시 눌러 주세요'); return cb([]); }
    const out = []; let left = 2;
    const done = () => { if (--left) return; const seen = new Set(); out.sort((a, b) => a.o - b.o); cb(out.filter(r => { const k = r.lat.toFixed(5) + r.lng.toFixed(5); if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 8)); };
    new kakao.maps.services.Geocoder().addressSearch(q0, (r, st) => { if (st === 'OK') r.forEach((a, i) => out.push({ t: a.address_name, s: a.road_address ? a.road_address.address_name : '', lat: +a.y, lng: +a.x, o: i })); done(); });
    new kakao.maps.services.Places().keywordSearch(q0, (r, st) => {
      const L = st === 'OK' ? r.slice(0, 6) : []; let n = L.length; if (!n) return done();
      const G = new kakao.maps.services.Geocoder();
      L.forEach((a, i) => G.addressSearch(a.address_name, (g, s2) => { const h = s2 === 'OK' && g && g[0]; out.push({ t: a.place_name, s: a.address_name, lat: h ? +h.y : +a.y, lng: h ? +h.x : +a.x, o: 100 + i }); if (!--n) done(); }));
    });
  }
  function find(v) {
    if (!v) return;
    const U = X.splitUnit(v);
    B.add.q = v; B.add.hint = U.ho ? { dong: U.dong, ho: U.ho } : null; B.add.res = 'busy'; drawRes();
    kakaoFind(U.q, res => {
      if (B.add.q !== v) return;
      B.add.res = res; drawRes();
      if (res.length === 1) pick(res[0]);
    });
  }
  function drawRes() {
    const el = $('bdRes'); if (!el) return;
    const R = B.add.res;
    el.innerHTML = !R ? '' : R === 'busy' ? '<div class="meta">찾는 중…</div>' : !R.length ? '<div class="meta">검색 결과가 없습니다. 지번(예: 서교동 395-12)이나 도로명으로 다시 입력해 보세요.</div>'
      : `<div class="res">${R.map((r, i) => `<button type="button" data-r="${i}"><b>${esc(r.t)}</b><small>${esc(r.s)}</small></button>`).join('')}<span class="meta">Enter = 첫 번째</span></div>`;
    el.querySelectorAll('[data-r]').forEach(b => b.onclick = () => pick(R[+b.dataset.r]));
  }
  // 고른 주소 → 필지 → 건축물대장·토지대장 → 유형 짐작
  async function pick(r) {
    B.add.res = null; drawRes();
    const hint = B.add.hint; B.add.hint = null;
    const D = B.add.D = { st: 'parcel', t: r.t, lat: r.lat, lng: r.lng, kind: 'sale', hint, n: (B.add.n = (B.add.n || 0) + 1) };
    B.ed = null; refresh();
    const alive = () => B.add.D === D;
    try {
      const p = await H.api(`/api/parcel?lat=${r.lat}&lng=${r.lng}`);
      if (!alive()) return;
      Object.assign(D, { pnu: p.bldPnu || p.pnu, lpnu: p.pnu, addr: p.addr || r.t, st: 'bld' }); refresh();
      const [b, L] = await Promise.all([H.api(`/api/building?pnu=${D.pnu}`).catch(() => null), H.api(`/api/land?pnu=${D.lpnu || D.pnu}`).catch(() => null)]);
      if (!alive()) return;
      const t = b && X.mainTitle(b), rc = b && b.recap && b.recap.data && b.recap.data[0], ts = ((b && b.titles && b.titles.data) || []).filter(z => z.mainAtch !== '부속건축물');
      D.b = b; D.t = t; D.rc = rc; D.ts = ts; D.chr = (L && L.chr && L.chr.data) || null;
      D.isSet = !!t && (ts.some(z => z.regstr === '집합') || !!(b.recap && b.recap.data && b.recap.data.length));
      D.bname = (rc && rc.name) || (t && t.name) || '';
      D.tot = (rc && rc.totArea) || Math.round(ts.reduce((a, z) => a + (z.totArea || 0), 0) * 100) / 100 || null;
      D.site = (rc && rc.platArea) || (t && t.platArea) || null;
      D.arch = (rc && rc.archArea) || Math.round(ts.reduce((a, z) => a + (z.archArea || 0), 0) * 100) / 100 || null;
      D.ty = guess(D); D.guess = D.ty; D.st = 'ready';
      setType(D, D.ty);
    } catch { if (alive()) { B.add.D = null; refresh(); H.toast('그 위치의 필지를 찾지 못했습니다. 다른 주소로 찾아 주세요', 3500); } }
  }
  function guess(D) {
    if (!D.t) return '토지';
    const g = X.guessType(D.t);
    if (D.isSet) return g === '건물' || g === '공장·창고' ? '상가' : g === '주택' ? '빌라' : g;
    if (g === '주택' || g === '공장·창고') return g;
    if (['아파트', '빌라', '오피스텔'].includes(g)) return '주택';
    return '건물';                                     // 일반건물(근생·업무 등) → 통건물로 짐작
  }
  const dmode = D => D.ty === '토지' ? 'land' : ['건물', '공장·창고'].includes(D.ty) || (D.ty === '주택' && !D.isSet) ? 'whole' : !D.t ? 'free' : D.isSet ? 'unit' : 'floor';
  function setType(D, ty) {
    D.ty = ty; D.mode = dmode(D);
    const m = D.mode;
    if (m === 'land') D.area = (D.chr && D.chr.area) || null;
    if (m === 'whole') D.area = D.tot;
    if ((m === 'whole' || m === 'floor') && !D.floors) loadFloors(D);
    if (m === 'unit' && !D.U) loadUnitList(D);
    if (m === 'unit' || m === 'floor') D.area = D.uArea || null;
    if (m === 'free') D.area = D.area || null;
    refresh();
  }
  async function floorsOf(pnu) {
    try {
      const j = await H.api(`/api/building?pnu=${pnu}&part=floors`);
      const rows = ((j.floors && j.floors.data) || []).filter(f => f.mainAtch !== '부속건축물' && (f.gb === '지상' || f.gb === '지하') && f.no != null);
      const dongs = new Set(rows.map(f => String(f.dong || '').trim()));
      const by = new Map();
      for (const f of rows) {
        const k = `${dongs.size > 1 ? (f.dong || '') + ' ' : ''}${f.gb === '지하' ? 'B' + f.no : f.no + 'F'}`;
        const g = by.get(k) || { fl: k.trim(), gb: f.gb, no: f.no, dong: f.dong || '', uses: [], area: 0 };
        const u = f.etcUse && f.etcUse.length <= 14 ? f.etcUse : f.use; if (u && !g.uses.includes(u)) g.uses.push(u);
        g.area += f.area || 0; by.set(k, g);
      }
      return [...by.values()].sort((a, b) => String(a.dong).localeCompare(String(b.dong), 'ko', { numeric: true }) || (a.gb === b.gb ? (a.gb === '지상' ? b.no - a.no : a.no - b.no) : a.gb === '지상' ? -1 : 1))
        .map(g => ({ fl: g.fl, use: g.uses.join(' · ').slice(0, 30), area: Math.round(g.area * 100) / 100, gb: g.gb, no: g.no }));
    } catch { return []; }
  }
  async function loadFloors(D) {
    D.floors = 'loading';
    const f = await floorsOf(D.pnu);
    if (B.add.D !== D) return;
    D.floors = f; refresh();
  }
  async function loadUnitList(D) {
    const ts = D.ts || [], nat = (a, c) => String(a).localeCompare(String(c), 'ko', { numeric: true });
    const dongs = [...new Set(ts.map(z => String(z.dong || '').trim()).filter(Boolean))].sort(nat);
    D.U = { byDong: dongs.length >= 2, dongs, cur: '', lists: {} };
    const h = D.hint;
    D.U.cur = (h && h.dong && X.dongPick(dongs, h.dong)) || dongs.find(d => /\d/.test(d)) || dongs[0] || '';
    await loadUnits(D);
  }
  async function loadUnits(D) {
    const U = D.U, key = U.byDong ? U.cur : '*';
    if (U.lists[key]) return refresh();
    U.lists[key] = 'loading'; refresh();
    try {
      const j = await H.api(`/api/units?pnu=${D.pnu}${U.byDong ? '&dong=' + encodeURIComponent(U.cur) : ''}`);
      const units = j.units || [];
      if (!U.byDong) { U.dongs = [...new Set(units.map(u => String(u.dong || '').trim()))]; const w = D.hint && D.hint.dong ? X.dongPick(U.dongs, D.hint.dong) : null; U.cur = w != null ? w : U.dongs.includes(U.cur) ? U.cur : (U.dongs.find(d => /\d/.test(d)) || U.dongs[0] || ''); }
      U.lists[key] = units;
      if (B.add.D !== D) return;
      if (D.hint && D.hint.ho) { const inD = u => U.byDong || String(u.dong || '').trim() === U.cur, hn = String(D.hint.ho).replace(/호$/, '').toUpperCase();
      const hit = units.find(u => inD(u) && String(u.ho).replace(/호$/, '').toUpperCase() === hn) || units.find(u => inD(u) && X.hoEq(u.ho, D.hint.ho) && !/^b|지하/i.test(u.ho)); D.hint = null; if (hit) return pickHo(D, hit.ho); H.toast('입력한 호를 대장에서 찾지 못했습니다. 목록에서 골라 주세요', 3500); }
    } catch { U.lists[key] = 'error'; }
    refresh();
  }
  async function pickHo(D, ho) {
    const U = D.U, L = U.lists[U.byDong ? U.cur : '*'], u = Array.isArray(L) && L.find(z => z.ho === ho);
    D.ho = ho; D.dong = U.cur; D.fl = u && u.flr != null ? (u.flrGb === '지하' ? 'B' : '') + u.flr : ''; D.uArea = null; D.area = null; D.uUse = ''; D.gp = null; D.aMsg = '전용면적 불러오는 중…'; refresh();
    try {
      const j = await H.api(`/api/units?pnu=${D.pnu}&dong=${encodeURIComponent(U.cur)}&ho=${encodeURIComponent(ho)}`);
      if (B.add.D !== D || D.ho !== ho) return;
      const rows = (j.area && j.area.ok && j.area.data) || [];
      const ex = rows.filter(r => /전유/.test(r.gb || '')), sum = ex.reduce((a, r) => a + (r.area || 0), 0), pub = rows.filter(r => /공용/.test(r.gb || '')).reduce((a, r) => a + (r.area || 0), 0);
      D.uArea = sum ? Math.round(sum * 100) / 100 : null; D.area = D.uArea;
      D.uUse = ex[0] ? (ex[0].etcUse && ex[0].etcUse.length <= 14 ? ex[0].etcUse : ex[0].use) || '' : '';
      D.gp = j.price && j.price.ok && j.price.data && j.price.data.price ? j.price.data : null;
      D.aMsg = sum ? `전용 ${m2t(D.uArea)}${pub ? ` · 공용 ${m2t(Math.round(pub * 100) / 100)}` : ''}` : '전용면적 정보가 없어 직접 입력해 주세요';
    } catch { D.aMsg = '전용면적을 불러오지 못했습니다. 직접 입력해 주세요'; }
    refresh();
  }
  const DTY = ['상가', '사무실', '건물', '공장·창고', '토지', '아파트', '빌라', '오피스텔', '주택', '기타'];
  function draftHtml(D) {
    const fk = k => `d:${D.n}:${k}`;
    if (D.st !== 'ready') return `<tr class="bd-draft"><td colspan="${VC().length}"><div class="dr"><span class="no new">＋</span><b>${esc(D.addr || D.t)}</b><span class="meta"><i class="spin"></i>${D.st === 'parcel' ? '필지 찾는 중…' : '건축물대장 · 토지대장 확인 중…'}</span><button type="button" class="lnk" data-dx="1">취소</button></div></td></tr>`;
    const t = D.t, m = D.mode, a = D.chr || {};
    const facts = t ? [t.use, t.grnd ? `지상 ${t.grnd}층${t.ugrnd ? ' · 지하 ' + t.ugrnd + '층' : ''}` : '', t.useApr ? `사용승인 ${String(t.useApr).slice(0, 4)}년` : '', D.isSet ? '집합건물' : '일반건물'].filter(Boolean)
      : ['건물 없는 땅', a.jimok, a.area ? m2t(a.area) : '', zoneS([a.zone1, a.zone2].filter(Boolean).join(' · '))].filter(Boolean);
    let unit = '';
    if (m === 'unit') {
      const U = D.U || { dongs: [], lists: {} }, L = U.lists[U.byDong ? U.cur : '*'];
      const list = Array.isArray(L) ? L.filter(u => U.byDong || String(u.dong || '').trim() === U.cur) : [];
      unit = `${U.dongs.length >= 2 ? `<select data-dd="1">${U.dongs.map(d => `<option ${d === U.cur ? 'selected' : ''}>${esc(d)}</option>`).join('')}</select>` : ''}
        ${L === 'loading' || !L ? '<select disabled><option>호 목록 불러오는 중…</option></select>' : L === 'error' || !list.length ? `<input data-fk="${fk('ho')}" data-dho="1" value="${esc(D.ho || '')}" placeholder="호 (직접)" class="w6">`
        : `<select data-dh="1"><option value="">호 선택</option>${list.map(u => `<option value="${esc(u.ho)}" ${D.ho === u.ho ? 'selected' : ''}>${esc(u.ho)}${u.flr != null ? ` (${u.flrGb === '지하' ? 'B' : ''}${u.flr}층)` : ''}</option>`).join('')}</select>`}`;
    } else if (m === 'floor') {
      unit = D.floors === 'loading' || !D.floors ? '<select disabled><option>층 정보 불러오는 중…</option></select>'
        : D.floors.length ? `<select data-df="1"><option value="">층 선택</option>${D.floors.map((f, i) => `<option value="${i}" ${D.fi === i ? 'selected' : ''}>${esc(f.fl)} · ${esc(f.use)} · ${m2t(f.area)}</option>`).join('')}</select>` : `<input data-fk="${fk('ho')}" data-dho="1" value="${esc(D.ho || '')}" placeholder="층·호 (예: 1층)" class="w6">`;
    } else if (m === 'free') unit = `<input data-fk="${fk('ho')}" data-dho="1" value="${esc(D.ho || '')}" placeholder="동·호 (선택)" class="w6">`;
    const fx = m === 'whole' ? `${D.floors === 'loading' ? '층별 정보 불러오는 중…' : Array.isArray(D.floors) && D.floors.length ? `층별 ${D.floors.length}개 층 → 등록하면 상세에 자동으로 깔립니다` : ''}` : m === 'land' ? '필지는 등록 뒤 상세에서 더 붙일 수 있습니다' : D.aMsg || (D.gp ? '' : '');
    const kd = D.kind;
    return `<tr class="bd-draft"><td colspan="${VC().length}"><div class="dr">
      <span class="no new">＋</span>
      <div class="d1"><b>${esc(D.addr)}</b>${D.bname ? ` <span class="bn">${esc(D.bname)}</span>` : ''}<small>${esc(facts.join(' · '))}</small></div>
      <div class="d2"><span class="gs">${D.guess === D.ty ? `건축물대장으로 보면 <b>${esc(D.ty === '건물' ? '통건물' : D.ty)}</b>입니다` : `<b>${esc(D.ty)}</b>(으)로 바꿈`}</span>
        <span class="tys">${DTY.map(t => `<button type="button" data-dt="${t}" aria-pressed="${D.ty === t}">${t === '건물' ? '통건물' : t}</button>`).join('')}</span></div>
    </div><div class="dr dr2">
      ${unit ? `<span class="u">${unit}</span>` : ''}
      <label>면적 <input data-fk="${fk('ar')}" data-dar="1" class="w6 r" inputmode="decimal" value="${D.area || ''}" placeholder="㎡">㎡ <small>${D.area ? pyt(D.area) : ''}</small></label>
      <select data-dk="1">${Object.entries(X.KIND).map(([k, t]) => `<option value="${k}" ${kd === k ? 'selected' : ''}>${t}</option>`).join('')}</select>
      <input data-fk="${fk('pr')}" data-dp="1" class="w9" value="${esc(D.pr || '')}" placeholder="${kd === 'wolse' ? '보증금/월세 (5000/320)' : kd === 'presale' ? '분양가 / P (5억/3천)' : kd === 'jeonse' ? '보증금 (3억2천)' : '매매가 (68억)'}">
      <input data-fk="${fk('tel')}" data-dtel="1" class="w9" value="${esc(D.tel || '')}" placeholder="연락처 (이름 010-…)">
      <button type="button" class="go" data-dgo="1">등록 ↵</button><button type="button" class="lnk" data-dx="1">취소</button>
      ${fx ? `<span class="fx">${esc(fx)}</span>` : ''}${D.gp ? `<span class="fx">공시가격 ${esc(sw(D.gp.price / 1e4))} (${D.gp.year})</span>` : ''}
    </div></td></tr>`;
  }
  function wireDraft(D) {
    const T = $('bdT');
    T.querySelectorAll('[data-dx]').forEach(b => b.onclick = () => { B.add.D = null; refresh(); $('bdQ').focus(); });
    if (D.st !== 'ready') return;
    T.querySelectorAll('[data-dt]').forEach(b => b.onclick = () => setType(D, b.dataset.dt));
    const dd = T.querySelector('[data-dd]'); if (dd) dd.onchange = () => { D.U.cur = dd.value; D.ho = ''; D.area = null; D.aMsg = ''; loadUnits(D); };
    const dh = T.querySelector('[data-dh]'); if (dh) dh.onchange = () => { if (dh.value) pickHo(D, dh.value); else { D.ho = ''; refresh(); } };
    const df = T.querySelector('[data-df]'); if (df) df.onchange = () => { const f = df.value === '' ? null : D.floors[+df.value]; D.fi = f ? +df.value : null; D.ho = f ? f.fl.replace(/^(\d+)F$/, '$1층').replace(/^B(\d+)$/, '지하$1층') : ''; D.fl = f ? (f.gb === '지하' ? 'B' + f.no : String(f.no)) : ''; D.uArea = f ? f.area : null; D.area = D.uArea; D.uUse = f ? f.use : ''; D.aMsg = f ? `${f.fl} 면적 ${m2t(f.area)} (층 전체 · 일부만이면 고쳐 주세요)` : ''; refresh(); };
    const set = (sel, k, f = v => v) => { const i = T.querySelector(sel); if (i) i.oninput = () => { D[k] = f(i.value); }; return i; };
    set('[data-dho]', 'ho'); set('[data-dp]', 'pr'); set('[data-dtel]', 'tel');
    const ar = set('[data-dar]', 'area', v => parseFloat(v.replace(/[^\d.]/g, '')) || null);
    if (ar) ar.onchange = () => setTimeout(refresh, 0);
    const dk = T.querySelector('[data-dk]'); if (dk) dk.onchange = () => { D.kind = dk.value; refresh(); };
    T.querySelectorAll('.bd-draft input').forEach(i => i.onkeydown = e => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); D[i.dataset.dp ? 'pr' : i.dataset.dtel ? 'tel' : i.dataset.dho ? 'ho' : '_'] = i.value; if (i.dataset.dar) D.area = parseFloat(i.value) || null; register(D); } if (e.key === 'Escape') { B.add.D = null; refresh(); } });
    T.querySelector('[data-dgo]').onclick = () => register(D);
    // 처음 그려질 때 가격 칸으로 커서 (주소 → Enter → 가격 → Enter 로 끝)
    if (!D.focused) { D.focused = true; setTimeout(() => { const p = $('bdT') && $('bdT').querySelector('tr.bd-draft [data-dp]'); if (p && B.add.D === D) p.focus(); }, 0); }
  }
  async function register(D) {
    if (D.busy) return;
    const m = D.mode, t = D.t, rc = D.rc, ts = D.ts || [], c = D.chr || {};
    if (m === 'unit' && !D.ho) return H.toast('호를 골라 주세요 (목록에 없으면 매물 카드로 등록)');
    // 가격
    const pv = String(D.pr || '').trim(), money = {};
    if (pv.includes('/') && D.kind === 'sale') D.kind = 'wolse';            // '5000/320'처럼 치면 월세로
    const kind = D.kind;
    if (pv) {
      const parts = pv.split('/').map(s => man(s));
      if (parts.some(v => Number.isNaN(v))) return H.toast('가격을 확인해 주세요 (예: 68억, 3억2천, 5000/320)');
      if (kind === 'sale') money.price = parts[0]; else if (kind === 'jeonse') money.deposit = parts[0];
      else if (kind === 'wolse') { if (parts.length > 1) { money.deposit = parts[0]; money.rent = parts[1]; } else money.rent = parts[0]; }
      else { money.price = parts[0]; if (parts[1]) money.pr = parts[1]; }
    }
    // 주소 · 면적
    const P = { pnu: m === 'land' ? (D.lpnu || D.pnu) : D.pnu, addr: D.addr, lat: D.lat, lng: D.lng, bname: m === 'land' ? '' : D.bname, dong: '', ho: '', area: D.area || null };
    if (m === 'land') Object.assign(P, { land: true, ak: 'land' });
    else if (m === 'whole') Object.assign(P, { ak: 'tot', site: D.site, arch: D.arch });
    else Object.assign(P, { ak: 'ex', dong: m === 'unit' ? String(D.dong || '').replace(/동$/, '') : '', ho: String(D.ho || '').replace(/호$/, '').trim() });
    // 광고 정보 (빈 칸만 자동): 용도·층·사용승인·주차·승강기·위반, 토지 = 지목·용도지역·도로·공시지가
    const ad = {};
    if (t && m !== 'land') {
      ad.use = (m === 'unit' || m === 'floor') && D.uUse ? D.uUse : [t.use, t.etcUse && t.etcUse !== t.use ? t.etcUse : ''].filter(Boolean).join(' · ').slice(0, 40);
      if (t.grnd) ad.tfl = t.grnd; if (t.ugrnd) ad.ufl = t.ugrnd; if (t.useApr) ad.appr = String(t.useApr).slice(0, 10);
      const pk = z => z ? (z.pkTotal || ((z.pkIn || 0) + (z.pkOut || 0) + (z.pkInMech || 0) + (z.pkOutMech || 0))) : 0;
      const tot = pk(rc) || ts.reduce((a, z) => a + pk(z), 0), hh = (rc && rc.hhld) || ts.reduce((a, z) => a + (z.hhld || 0), 0);
      if (tot) ad.park = hh > 1 && ['아파트', '오피스텔', '빌라'].includes(D.ty) ? `총 ${tot}대 (세대당 ${(tot / hh).toFixed(2).replace(/0$/, '')}대)` : `총 ${tot}대`;
      if (hh > 1) ad.hhld = hh;
      const lift = ts.reduce((a, z) => a + (z.liftP || 0), 0); if (lift) ad.elev = lift;
      if (ts.some(z => /^(y|1|true|위반)/i.test(String(z.viol ?? '')))) ad.viol = true;
      ad.fl = m === 'whole' ? '전체' : D.fl || '';
    }
    if (m === 'land') ad.use = c.jimok || '';
    if (c.zone1) ad.zone = [c.zone1, c.zone2].filter(Boolean).join(' · ');
    if (c.road) ad.road = c.road; if (c.price) ad.lp = c.price;
    const tel = String(D.tel || '').trim(), tm = tel.match(/0\d{1,2}[-\s]?\d{3,4}[-\s]?\d{4}/);
    const contacts = tel ? [{ role: '소유자', name: (tm ? tel.replace(tm[0], '') : tel).trim().slice(0, 20), phone: tm ? fmtPhone(tm[0]) : '' }] : [];
    const rents = m === 'whole' && Array.isArray(D.floors) ? D.floors.map(f => ({ fl: f.fl, use: f.use, area: f.area, label: '', deposit: null, rent: null, exp: '', memo: '' })) : [];
    const item = { kind, status: 'on', ptype: D.ty, ptypeTx: '', bname: m === 'land' ? '' : D.bname, road: t && t.road ? String(t.road).replace(/^서울특별시\s*/, '서울 ') : '', places: [P], contacts, rents, photos: [], ad, memo: '', ...money };
    D.busy = true;
    try {
      const j = await H.api('/api/auth?action=listing', H.post({ op: 'save', id: '', item: bodyOf(item) }));
      H.took(j);
      const nx = H.items()[0];
      B.add.D = null; B.add.q = '';
      if (nx) { B.hl = nx.id; if (m === 'whole' || m === 'land') B.open.add(nx.id); }
      if (B.st !== 'all' && B.st !== 'on') B.st = 'on';
      if (B.kind !== 'all' && B.kind !== kind) B.kind = 'all';
      if (B.ty !== 'all' && nx && tyOf(nx) !== B.ty) B.ty = 'all';
      B.q = ''; keep(); B.fitNext = true;
      H.redraw();
      const q = $('bdQ'); if (q) { q.value = ''; q.focus(); }
      H.toast(m === 'whole' ? '등록했습니다 · 상세의 층별 현황에 임차인·보증금·월세를 넣어 보세요' : '등록했습니다 · 표에서 바로 고칠 수 있습니다', 3500);
      setTimeout(() => { const r = nx && $('b_' + nx.id); if (r) r.scrollIntoView({ block: 'nearest' }); }, 50);
    } catch (e) {
      D.busy = false;
      if (e.code === 'limit' || e.code === 'readonly') H.upsell(e.message); else H.toast(e.message || '등록하지 못했습니다', 4000);
    }
  }

  // 지도 핀을 누르면 그 줄로
  function focus(id, scroll) {
    B.hl = id;
    if (!$('bdT')) return;
    $('bdT').querySelectorAll('tr.on').forEach(r => r.classList.remove('on'));
    const r = $('b_' + id); if (r) { r.classList.add('on'); if (scroll) r.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
  }
  return { mount, refresh, focus, _man: man };
})();
