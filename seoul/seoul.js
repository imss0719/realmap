// 서울 정비사업 안내 페이지용 (seoul-pages.mjs가 seoul/seoul.js 로 복사)
// 1) 화면에 들어올 때 움직이는 효과  2) 숫자 올라가기  3) 관심 구역 ☆ · 추진 알림 🔔 (회원 전용)
(function () {
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const SLUG = { '종로구': 'jongno', '중구': 'jung', '용산구': 'yongsan', '성동구': 'seongdong', '광진구': 'gwangjin', '동대문구': 'dongdaemun', '중랑구': 'jungnang', '성북구': 'seongbuk', '강북구': 'gangbuk', '도봉구': 'dobong', '노원구': 'nowon', '은평구': 'eunpyeong', '서대문구': 'seodaemun', '마포구': 'mapo', '양천구': 'yangcheon', '강서구': 'gangseo', '구로구': 'guro', '금천구': 'geumcheon', '영등포구': 'yeongdeungpo', '동작구': 'dongjak', '관악구': 'gwanak', '서초구': 'seocho', '강남구': 'gangnam', '송파구': 'songpa', '강동구': 'gangdong' };
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ---------- 방문 통계 (리얼맵과 같은 임의 번호, 개인정보 없음 · 운영자 기기는 세지 않음) ----------
  (function hit() {
    let v = '', op = false;
    try { op = localStorage.getItem('rm.op') === '1'; v = localStorage.getItem('rm.vid') || ''; if (!v) { v = Math.random().toString(36).slice(2) + Date.now().toString(36); localStorage.setItem('rm.vid', v); } } catch { /* 저장 불가 */ }
    if (op) return;
    const m = location.pathname.match(/^\/seoul\/(?:([a-z]+)(?:\/(\d+|[a-z]+))?\.html)?$/);
    const pg = !m ? 'idx' : m[2] ? `${m[1]}/${m[2]}` : m[1] || 'idx';   // 테마 페이지는 t/big 처럼
    let src = '';
    try { if (!sessionStorage.getItem('rm.ssrc')) {
      const ua = navigator.userAgent || ''; let h = ''; try { h = document.referrer ? new URL(document.referrer).hostname : ''; } catch { /* 없음 */ }
      src = /Instagram/i.test(ua) ? 'insta' : /KAKAOTALK/i.test(ua) ? 'kakao' : !h || h === location.hostname ? 'direct'
        : /blog\.naver\.com$/.test(h) ? 'blog' : /search\.naver\.com$/.test(h) ? 'nsearch' : /naver\.(com|me)$/.test(h) ? 'naver'
        : /google\./.test(h) ? 'google' : /daum\.net$/.test(h) ? 'daum' : /instagram\.com$/.test(h) ? 'insta' : /youtube\.com$|youtu\.be$/.test(h) ? 'youtube' : 'etc';
      sessionStorage.setItem('rm.ssrc', src);
    } } catch { /* 무시 */ }
    try { fetch(`/api/auth?action=hit&k=s&v=${encodeURIComponent(v)}&pg=${encodeURIComponent(pg)}${src ? '&src=' + src : ''}`, { keepalive: true }).catch(() => {}); } catch { /* 무시 */ }
  })();

  // ---------- 움직임 ----------
  function countUp(el) {
    const end = +el.dataset.count, dur = 1100, t0 = performance.now();
    if (!end || reduce) return;
    const step = now => {
      const x = Math.min(1, (now - t0) / dur), v = Math.round(end * (1 - Math.pow(1 - x, 3)));
      el.textContent = v.toLocaleString('ko-KR');
      if (x < 1) requestAnimationFrame(step);
    };
    el.textContent = '0'; requestAnimationFrame(step);
  }
  const io = 'IntersectionObserver' in window ? new IntersectionObserver(es => es.forEach(e => {
    if (!e.isIntersecting) return;
    e.target.classList.add('in');
    $$('[data-count]', e.target).forEach(countUp);
    io.unobserve(e.target);
  }), { threshold: .18 }) : null;
  $$('[data-anim]').forEach(el => io ? io.observe(el) : el.classList.add('in'));

  // ---------- 알림 창 ----------
  let toastT;
  function toast(msg) {
    let t = $('#ztoast'); if (!t) { t = document.createElement('div'); t.id = 'ztoast'; document.body.appendChild(t); }
    t.textContent = msg; t.className = 'show'; clearTimeout(toastT); toastT = setTimeout(() => { t.className = ''; }, 2600);
  }
  function modal(html) {
    closeModal();
    const m = document.createElement('div'); m.id = 'zmodal';
    m.innerHTML = `<div class="zm-bg"></div><div class="zm-box" role="dialog" aria-modal="true"><button class="zm-x" aria-label="닫기">×</button>${html}</div>`;
    document.body.appendChild(m);
    m.querySelector('.zm-bg').onclick = closeModal; m.querySelector('.zm-x').onclick = closeModal;
    return m;
  }
  function closeModal() { const m = $('#zmodal'); if (m) m.remove(); }
  const here = () => location.pathname + location.search;
  function needLogin(why) {
    modal(`<h3>${why === 'alert' ? '추진 알림은 회원 전용입니다' : '관심 구역은 회원 전용입니다'}</h3>
      <p>카카오로 3초 만에 가입하고, 관심 있는 재개발·재건축 구역을 모아 보세요. ${why === 'alert' ? '추진 단계가 바뀌면 이메일로 알려 드립니다.' : '추진 단계가 바뀌었는지 한눈에 확인하실 수 있습니다.'}</p>
      <a class="zm-kakao" href="/auth/login?r=${encodeURIComponent(here())}">카카오로 시작하기</a>
      <p class="zm-s">가입은 무료이며, 카카오 회원번호와 닉네임만 받습니다.</p>`);
  }

  // ---------- 관심 구역 ----------
  let st = { member: false, items: [], email: '', kakaoEmail: '' }, loaded = false;
  const find = id => st.items.find(x => x.id === String(id));
  async function post(body) {
    const r = await fetch('/api/auth?action=zfav', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!j.ok) { const e = new Error(j.message || '잠시 후 다시 시도해 주세요'); e.code = j.error; throw e; }
    st = { ...st, ...j }; paint(); return j;
  }
  function paint() {
    $$('[data-z]').forEach(box => {
      const it = find(box.dataset.id);
      const f = $('[data-act="fav"]', box), a = $('[data-act="alert"]', box);
      const ic = b => b.classList.contains('zi');   // 표 안의 작은 아이콘 버튼 (10/28)
      if (f) { f.classList.toggle('on', !!it); f.innerHTML = ic(f) ? (it ? '★' : '☆') : it ? '★ 관심 구역' : '☆ 관심 구역'; f.setAttribute('aria-pressed', !!it); }
      if (a) { const on = !!(it && it.alert); a.classList.toggle('on', on); a.innerHTML = ic(a) ? '🔔' : on ? '🔔 알림 받는 중' : '🔔 추진 알림 받기'; a.setAttribute('aria-pressed', on); if (ic(a)) a.title = on ? '알림 받는 중 (누르면 해제)' : '추진 알림 받기'; }
    });
    renderMine();
  }
  function emailForm(z) {
    const m = modal(`<h3>추진 알림 받기</h3>
      <p><b>${esc(z.n)}</b>의 추진 단계가 바뀌면 <b>이메일로</b> 알려 드립니다. 알림은 이메일로만 보내 드리며, 광고는 보내지 않습니다.</p>
      <label class="zm-l">알림 받을 이메일<input type="email" id="zmEmail" value="${esc(st.email || st.kakaoEmail)}" placeholder="example@naver.com" autocomplete="email"></label>
      <label class="zm-c"><input type="checkbox" id="zmAgree"> 관심 구역 알림을 위한 이메일 수집·이용에 동의합니다. (알림 해제·탈퇴 시 삭제)</label>
      <button class="zm-go" id="zmGo">알림 받기</button>
      <p class="zm-s">서울시 정비사업 현황은 분기마다 갱신되며, 단계가 바뀐 구역만 모아서 알려 드립니다.</p>`);
    $('#zmGo', m).onclick = async () => {
      const email = $('#zmEmail', m).value.trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return toast('이메일 주소를 확인해 주세요');
      if (!$('#zmAgree', m).checked) return toast('이메일 수집·이용에 동의해 주세요');
      try { await post({ op: 'alert', ...z, email }); closeModal(); toast('추진 알림을 신청했습니다'); } catch (e) { toast(e.message); }
    };
  }
  async function onAct(btn) {
    const box = btn.closest('[data-z]'); if (!box) return;
    const z = { id: box.dataset.id, n: box.dataset.n, gu: box.dataset.gu, st: box.dataset.st };
    const act = btn.dataset.act;
    if (!loaded) await load();
    if (!st.member) return needLogin(act);
    const it = find(z.id);
    try {
      if (act === 'fav') {
        if (it) { if (it.alert && !confirm('관심 구역에서 빼면 추진 알림도 함께 해제됩니다. 계속할까요?')) return; await post({ op: 'del', id: z.id }); toast('관심 구역에서 뺐습니다'); }
        else { await post({ op: 'add', ...z }); toast('관심 구역에 담았습니다'); }
      } else if (act === 'alert') {
        if (it && it.alert) { await post({ op: 'unalert', id: z.id }); toast('추진 알림을 해제했습니다'); }
        else if (st.email) { await post({ op: 'alert', ...z }); toast(`추진 알림을 신청했습니다 (${st.email})`); }
        else emailForm(z);
      }
    } catch (e) { toast(e.message); }
  }
  document.addEventListener('click', e => { const b = e.target.closest('[data-act]'); if (b) { e.preventDefault(); onAct(b); } });

  // 첫 페이지의 '내 관심 구역'
  function renderMine() {
    const box = $('[data-myzones]'); if (!box) return;
    if (!st.member) { box.hidden = true; return; }
    box.hidden = false;
    const list = $('.my-list', box);
    list.innerHTML = st.items.length ? st.items.map(x => `<li data-z data-id="${esc(x.id)}" data-n="${esc(x.n)}" data-gu="${esc(x.gu)}" data-st="${esc(x.st)}">
        <a href="/seoul/${SLUG[x.gu] || ''}/${esc(x.id)}.html"><b>${esc(x.n)}</b> <span>${esc(x.gu)} · ${esc(x.st || '')}</span></a>
        <button data-act="alert" class="zb sm${x.alert ? ' on' : ''}">${x.alert ? '🔔 알림 받는 중' : '🔔 추진 알림 받기'}</button></li>`).join('')
      : '<li class="empty">아직 담은 구역이 없습니다. 아래 목록이나 구별 페이지에서 ☆ 관심 구역을 눌러 담아 보세요.</li>';
    $('.my-mail', box).innerHTML = st.email ? `알림 이메일: <b>${esc(st.email)}</b> · <button class="lnk" id="myMailOff">이메일 알림 모두 해제</button>` : '추진 알림은 이메일로 보내 드립니다. 구역의 🔔 버튼을 누르면 이메일을 남기실 수 있습니다.';
    const off = $('#myMailOff'); if (off) off.onclick = async () => { if (!confirm('이메일과 모든 추진 알림을 해제할까요?')) return; try { await post({ op: 'noemail' }); toast('이메일 알림을 모두 해제했습니다'); } catch (e) { toast(e.message); } };
    $('.my-hi', box).textContent = `${st.nickname || '회원'}님의 관심 구역 ${st.items.length}곳`;
  }
  async function load() {
    try { const j = await fetch('/api/auth?action=zfavs', { credentials: 'same-origin' }).then(r => r.json()); if (j.ok) st = { ...st, ...j }; } catch { /* 비회원 취급 */ }
    loaded = true; paint();
  }
  if ($('[data-z]') || $('[data-myzones]')) load();

  // ---------- 표: 종류·단계·구 거르기 · 찾기 · 머리글 정렬 (10/28) ----------
  $$('table.zt').forEach(tb => {
    const body = tb.tBodies[0]; if (!body) return;
    const box = tb.closest('.pn'), fl = box && $('[data-flt]', box);
    const F = { k: '', s: '', gu: '', q: '' };
    function apply() {
      let n = 0;
      [...body.rows].forEach(tr => {
        const ok = (!F.k || tr.dataset.k === F.k) && (!F.s || tr.dataset.g === F.s) && (!F.gu || tr.dataset.gu === F.gu) && (!F.q || (tr.dataset.q || '').toLowerCase().includes(F.q));
        tr.hidden = !ok; if (ok) n++;
      });
      const c = fl && $('[data-fn]', fl); if (c) c.textContent = `${n}곳`;
    }
    if (fl) {
      const grp = (attr, key) => $$(`[${attr}]`, fl).forEach(b => b.onclick = () => { F[key] = b.getAttribute(attr); $$(`[${attr}]`, fl).forEach(x => x.classList.toggle('on', x === b)); apply(); });
      grp('data-fk', 'k'); grp('data-fs', 's');
      const g = $('[data-fgu]', fl); if (g) g.onchange = () => { F.gu = g.value; apply(); };
      const q = $('[data-fq]', fl); if (q) q.oninput = () => { F.q = q.value.trim().toLowerCase(); apply(); };
    }
    // 머리글 누르면 정렬 (같은 칸을 다시 누르면 반대로) · 숫자는 숫자로
    const ths = [...tb.tHead.rows[0].cells];
    ths.forEach((th, ci) => {
      if (!th.dataset.s) return;
      th.onclick = () => {
        const dn = th.classList.contains('on') ? !th.classList.contains('dn') : th.classList.contains('n');   // 숫자 칸은 큰 것부터
        ths.forEach(x => x.classList.remove('on', 'dn')); th.classList.add('on'); if (dn) th.classList.add('dn');
        const val = tr => { const td = tr.cells[ci]; const v = td ? (td.dataset.v ?? td.textContent) : ''; return v; };
        const L = [...body.rows], num = L.every(tr => { const v = val(tr); return v === '' || !isNaN(+v); });
        L.sort((a, b) => { const x = val(a), y = val(b); const r = num ? (+x || 0) - (+y || 0) : String(x).localeCompare(String(y), 'ko', { numeric: true }); return dn ? -r : r; });
        L.forEach(tr => body.appendChild(tr));
      };
    });
  });
  // 위쪽 '25개 구' 펼침: 바깥을 누르면 닫기
  document.addEventListener('click', e => { $$('details.vd[open]').forEach(d => { if (!d.contains(e.target)) d.open = false; }); });

  // ---------- 구역 페이지: 이 구역 매물 · 이 구역 중개사무소 (10/29) ----------
  //   리얼맵 지도 광고(/api/auth?action=pubs) 중 구역 경계(국토부 경계 = data/jeongbi-seoul.json, 서울시 행의 jb) 안에 있는 매물
  //   중개사무소 = 이 구역에 매물을 올린 곳 + 사무소가 구역에서 700m 안인 곳 · 비어 있으면 [내 물건 등록하기]/[내 사무실 등록하기] → 홍보 페이지
  (async function zoneAds() {
    const act = $('section.pn.act[data-z]'); if (!act || !/^\/seoul\/[a-z]+\/\d+\.html$/.test(location.pathname)) return;
    const css = document.createElement('style');
    css.textContent = `.za .zl li{grid-template-columns:auto minmax(0,1fr) auto}.za .kd{font-size:11px;font-weight:800;color:#fff;border-radius:5px;padding:2px 6px}.za .k-sale{background:#C92A2A}.za .k-jeonse{background:#1C64C8}.za .k-wolse{background:#2B8A3E}.za .k-presale{background:#7048E8}
.za .pr{font-weight:900}.za .zl small{grid-column:2/-1}.za .of{display:flex;align-items:center;gap:8px}.za .av{width:30px;height:30px;border-radius:50%;background:#CFD8E3 center/cover no-repeat;flex:none;display:grid;place-items:center;font-size:12px;font-weight:800;color:#5B6675}
.za .em{padding:12px;text-align:center}.za .em p{margin:0 0 8px;font-size:13px;color:var(--muted)}.za .go{display:inline-block;background:var(--accent);color:#14212E;font-weight:800;text-decoration:none;border-radius:7px;padding:8px 14px;font-size:13.5px}.za .mo{display:block;padding:7px 12px;font-size:12px;color:var(--muted);text-decoration:none;border-top:1px solid var(--line)}.za .mo:hover{text-decoration:underline}.za .tel{font-size:12px;font-weight:800;text-decoration:none;color:var(--fg);white-space:nowrap}`;
    document.head.appendChild(css);
    const get = u => fetch(u).then(r => r.ok ? r.json() : null).catch(() => null);
    const [Z, J, P, PA, PB] = await Promise.all([get('/data/seoul-zones.json'), get('/data/jeongbi-seoul.json'), get('/api/auth?action=pubs'), get('/data/price-11.json'), get('/data/price2-11.json')]);
    const row = Z && (Z.rows || []).find(r => String(r.id) === act.dataset.id); if (!row) return;
    const rings = [];
    for (const f of (J && J.features) || []) if ((row.jb || []).includes(f.properties && f.properties.id)) { const g = f.geometry || {}; (g.type === 'MultiPolygon' ? g.coordinates : g.type === 'Polygon' ? [g.coordinates] : []).forEach(p => p[0] && rings.push(p[0])); }
    const inRing = (x, y, R) => { let c = false; for (let i = 0, j = R.length - 1; i < R.length; j = i++) { const [xi, yi] = R[i], [xj, yj] = R[j]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c; } return c; };
    const dist = (a, b, c, d) => Math.hypot((a - c) * 111000, (b - d) * 88000);   // 서울 위도 기준 m
    let cy = row.lat, cx = row.lng;
    if (rings.length) { let n = 0, sx = 0, sy = 0; rings.forEach(R => R.forEach(([x, y]) => { sx += x; sy += y; n++; })); cx = sx / n; cy = sy / n; }
    const inside = (lat, lng) => rings.length ? rings.some(R => inRing(lng, lat, R)) : (cy ? dist(lat, lng, cy, cx) <= 250 : false);
    const L = ((P && P.items) || []).filter(x => x.lat && x.lng);
    const mine = L.filter(x => inside(x.lat, x.lng)).sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));
    const OF = new Map();
    for (const x of L) {
      const b = x.bk || {}, r = String(b.regno || '').replace(/\D/g, ''); if (!r || !b.verified) continue;
      const e = OF.get(r) || OF.set(r, { r, b, n: 0, d: b.lat ? dist(b.lat, b.lng, cy, cx) : 1e9 }).get(r);
      if (inside(x.lat, x.lng)) e.n++;
    }
    const offs = [...OF.values()].filter(e => e.n || (e.b.lat && (inside(e.b.lat, e.b.lng) || e.d <= 700))).sort((a, b) => b.n - a.n || a.d - b.d).slice(0, 8);
    const man = v => { v = +v || 0; if (!v) return ''; if (v >= 10000) { const e = Math.floor(v / 10000), m = v % 10000; return e + '억' + (m ? ' ' + m.toLocaleString() : ''); } return v.toLocaleString() + '만'; };
    const price = x => x.kind === 'sale' || x.kind === 'presale' ? man(x.price) : x.kind === 'jeonse' ? man(x.deposit) : `${man(x.deposit) || 0}/${(+x.rent || 0).toLocaleString()}`;
    const KN = { sale: '매매', jeonse: '전세', wolse: '월세', presale: '분양권' };
    const short = o => { const s = String(o || '').replace(/\([^)]*\)/g, '').replace(/(공인중개사사무소|공인중개사|중개사무소|부동산중개|부동산)+$/g, '').trim(); return s || String(o || ''); };
    const av = b => b.photo ? `<span class="av" style="background-image:url('${esc(b.photo)}')"></span>` : `<span class="av">${esc(short(b.office).charAt(0) || '중')}</span>`;
    const tel = v => { const d = String(v || '').replace(/\D/g, ''); return d ? `<a class="tel" href="tel:${d}">☎ ${esc(d.length === 11 ? d.replace(/^(\d{3})(\d{4})(\d{4})$/, '$1-$2-$3') : /^02/.test(d) ? d.replace(/^(02)(\d{3,4})(\d{4})$/, '$1-$2-$3') : d.replace(/^(\d{3})(\d{3,4})(\d{4})$/, '$1-$2-$3'))}</a>` : ''; };
    const PROMO = '/promo.html';   // 노란 버튼은 ?go=1 = 바로 카카오 로그인 → 사무소 확인 → 지도에서 올리기 · 작은 글씨 링크는 홍보 페이지(설명)
    const s1 = document.createElement('section'); s1.className = 'pn za';
    s1.innerHTML = `<h2>이 구역 매물 <small>${mine.length ? mine.length + '건 · 중개사무소가 올린 광고' : ''}</small></h2>` + (mine.length
      ? `<ul class="zl">${mine.slice(0, 8).map(x => `<li><span class="kd k-${esc(x.kind)}">${KN[x.kind] || ''}</span><a href="/?pnu=${esc(x.pnu)}&lst=1">${esc(price(x))} · ${esc((x.ptype === '기타' && x.ptypeTx) || x.ptype || '')}</a><span></span><small>${esc([x.bname || '', x.area ? Math.round(x.area / 3.3058) + '평' : '', short((x.bk || {}).office)].filter(Boolean).join(' · '))}</small></li>`).join('')}</ul>${mine.length > 8 ? `<a class="mo" href="${esc(act.querySelector('a.cta') ? act.querySelector('a.cta').getAttribute('href') : '/')}">지도에서 ${mine.length}건 모두 보기 ›</a>` : ''}<a class="mo" href="${PROMO}">중개사이신가요? 이 구역에 매물 무료로 올리기 ›</a>`
      : `<div class="em"><p>아직 이 구역에 올라온 매물이 없습니다.<br>가장 먼저 올리면 이 자리에 보입니다.</p><a class="go" href="${PROMO}?go=1">내 물건 등록하기 (무료)</a></div>`);
    const s2 = document.createElement('section'); s2.className = 'pn za';
    s2.innerHTML = `<h2>이 구역 중개사무소</h2>` + (offs.length
      ? `<ul class="zl">${offs.map(e => `<li><span class="of">${av(e.b)}</span><a href="/office.html?r=${e.r}">${esc(short(e.b.office))}</a>${tel(e.b.mobile || e.b.tel)}<small>${e.n ? `이 구역 매물 ${e.n}건` : '구역 가까이'}${e.b.addr ? ' · ' + esc(String(e.b.addr).replace(/^서울(특별시)?\s*/, '').split(' ').slice(0, 3).join(' ')) : ''}</small></li>`).join('')}</ul><a class="mo" href="${PROMO}">이 구역 중개사무소로 내 사무실 올리기 ›</a>`
      : `<div class="em"><p>이 구역을 맡을 중개사무소를 찾고 있습니다.<br>등록하면 이 구역을 보는 분들께 사무소가 보입니다.</p><a class="go" href="${PROMO}?go=1">내 사무실 등록하기 (무료)</a></div>`);
    act.after(s1, s2);
    try { calc(row, PA, PB, act, s2); } catch (e) { /* 계산기는 없어도 페이지는 그대로 */ }
  })();

  // ---------- 구역 페이지: 내 집 분담금·평형 미리 계산 (10/29, 참고용 추정) ----------
  //   감정가 = 동네 시세(동별 실거래 ㎡당 중간값, data/price*-11.json) × 면적 × 75% · 조합원 분양가 = 동네 아파트 전용㎡당 시세 × 전용 × 60%
  //   평형 순서 = 권리가액 큰 순서로 큰 평형부터 · 조합원 수(분양의 50%)·평형 비율(59:84:114 = 40:50:10)·권리가액 분포(로그정규 σ 0.6)는 가정
  function calc(row, PA, PB, act, offBox) {
    const anchor = $$('.gm section.pn').find(x => /사업 개요/.test(($('h2', x) || {}).textContent || '')); if (!anchor) return;
    const AP = 0.75, SP = 0.6, SIG = 0.6;
    const dongN = String(row.a || '').split(/\s+/)[0], gu = row.gu;
    const gk = PA && PA.g ? Object.keys(PA.g).find(k => PA.g[k].n === gu) : '';
    const pick = (F, key) => {   // [중간값, 건수, 전 기간 중간값, 건수] → 동 → 구
      const val = a => !a ? 0 : a[1] >= 3 ? a[0] : a[2] || a[0] || 0;
      const dk = F && F.d && gk ? Object.keys(F.d).find(k => k.startsWith(gk) && F.d[k].n === dongN) : '';
      const v1 = dk ? val(F.d[dk][key]) : 0; if (v1) return { v: v1, w: dongN };
      const v2 = F && F.g && gk && F.g[gk] ? val(F.g[gk][key]) : 0; return { v: v2, w: v2 ? gu + ' 평균' : '' };
    };
    const APT = pick(PA, 'apt'), RH = pick(PA, 'rh'), SH = pick(PB, 'sh'), LD = pick(PB, 'land'), BASE = SH.v ? SH : LD.v ? LD : RH;
    const fact = $$('dt', anchor).find(x => x.textContent.trim() === '계획 세대수'), ft = fact ? fact.nextElementSibling.textContent : '';
    const nn = re => { const m = ft.match(re); return m ? +m[1].replace(/,/g, '') : 0; };
    const HH = row.hh || nn(/^([\d,]+)세대/), SALE = nn(/분양 ([\d,]+)/) || Math.round(HH * 0.8), RENT = nn(/임대 ([\d,]+)/) || Math.max(0, HH - SALE);
    const late = /관리처분|이주|철거|착공|준공|이전고시/.test(row.st || '');
    const KIND = { rh: ['빌라', '전용면적', RH], sh: ['단독·다가구', '대지면적', SH], ld: ['토지', '토지면적', LD], sg: ['상가', '전용면적', { v: 0, w: '' }] };
    const PY = { 59: 25, 84: 34, 114: 43 };
    const S = { k: 'rh', ar: 49, ap: null, py: 84, sp: null, rt: 100, mem: Math.round(SALE * 0.5), c: { 114: Math.round(SALE * 0.1), 84: Math.round(SALE * 0.5), 59: 0 } };
    S.c[59] = Math.max(0, SALE - S.c[114] - S.c[84]);
    const won = v => { v = Math.round(+v || 0); const neg = v < 0; v = Math.abs(v); const e = Math.floor(v / 10000), m = v % 10000; return (neg ? '−' : '') + (e ? e + '억' : '') + (m ? (e ? ' ' : '') + m.toLocaleString() + '만' : e ? '' : '0'); };
    const autoAp = () => { const K = KIND[S.k][2]; return K.v ? Math.round(K.v * S.ar * AP / 100) * 100 : 0; };
    const autoSp = () => APT.v ? Math.round(APT.v * S.py * SP / 100) * 100 : 0;
    const Phi = z => { const t = 1 / (1 + 0.2316419 * Math.abs(z)), d = 0.3989423 * Math.exp(-z * z / 2), q = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274)))); return z > 0 ? 1 - q : q; };
    const box = document.createElement('section'); box.className = 'pn zc';
    const css = document.createElement('style');
    css.textContent = `.zc .g{display:grid;grid-template-columns:1fr 1fr}.zc .in{padding:12px 14px;border-right:1px solid var(--line)}.zc .out{padding:12px 14px;background:#FFFBEA;color:#14212E}
.zc .r{display:grid;grid-template-columns:84px 1fr;align-items:center;gap:6px;margin-bottom:8px;font-size:13px}.zc .r>b{font-size:12.5px;color:var(--muted)}
.zc input.n{border:1px solid var(--line);border-radius:6px;padding:5px 7px;font:inherit;font-weight:700;text-align:right;width:100px;background:var(--surface);color:var(--fg)}.zc input.s{width:58px}
.zc .u{font-style:normal;font-size:11.5px;color:var(--muted)}.zc .h{font-style:normal;font-size:12px;font-weight:800;color:#1E5EDB;margin-left:4px}.zc .ex{display:block;font-style:normal;font-size:11px;color:var(--muted);margin-top:2px}
.zc .auto{font-style:normal;font-size:10.5px;font-weight:800;color:#1E7A3E;background:#E3F4E1;border-radius:4px;padding:1px 5px;margin-left:4px}.zc .man{background:#FFF0D6;color:#A15C07}
.zc .seg{display:inline-flex;flex-wrap:wrap;border:1px solid var(--line);border-radius:6px;overflow:hidden}.zc .seg button{border:0;background:var(--surface);color:var(--fg);padding:5px 10px;font:inherit;font-size:12.5px;font-weight:700;cursor:pointer}.zc .seg button+button{border-left:1px solid var(--line)}.zc .seg button.on{background:#14212E;color:#fff}
.zc input[type=range]{width:100%;accent-color:#F2B705}.zc .rv{display:flex;align-items:center;gap:8px}.zc .rv b{min-width:44px;text-align:right}
.zc dl{margin:0;display:grid;grid-template-columns:1fr auto;gap:6px 10px;font-size:13.5px}.zc dt{color:#5E6A77}.zc dd{margin:0;font-weight:800;text-align:right}
.zc .big{margin-top:12px;border-top:1px dashed #E8C55A;padding-top:12px;display:flex;justify-content:space-between;align-items:baseline;gap:8px}.zc .big b{font-size:15px}.zc .big em{font-style:normal;font-size:26px;font-weight:900;color:#C92A2A}.zc .big em.pl{color:#1E7A3E}
.zc .note{font-size:11.5px;color:#7A8796;margin:10px 0 0;line-height:1.5}.zc .warn{font-size:12px;color:#A15C07;background:#FFF0D6;border-radius:6px;padding:6px 8px;margin:8px 0 0}
.zc .s2{border-top:1px solid var(--line);padding:12px 14px}.zc .s2 h3{margin:0 0 8px;font-size:13.5px}.zc .s2 h3 small{font-weight:500;color:var(--muted);font-size:11.5px;margin-left:6px}
.zc .fx{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;font-size:12px;margin-bottom:6px}.zc .fx div{background:var(--soft);border-radius:6px;padding:6px 8px}.zc .fx b{display:block;font-size:14px}.zc .fx input.n{width:76px;padding:2px 5px;font-size:13px}
.zc .bar{position:relative;height:26px;margin:26px 0 2px;border-radius:6px;overflow:visible;display:flex}.zc .bar i{display:block;height:100%}.zc .bar i:first-child{border-radius:6px 0 0 6px}.zc .bar i:last-child{border-radius:0 6px 6px 0}
.zc .mk{position:absolute;top:-6px;width:3px;height:38px;background:#C92A2A}.zc .mk span{position:absolute;bottom:40px;left:50%;transform:translateX(-50%);white-space:nowrap;font-size:11.5px;font-weight:800;color:#C92A2A}
.zc .lx{display:flex;justify-content:space-between;font-size:11px;color:var(--muted)}
.zc .rk{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:10px}.zc .rk div{border:1px solid var(--line);border-radius:8px;padding:8px 10px;font-size:12px;position:relative}.zc .rk div b{display:block;font-size:14.5px}.zc .rk div span{color:var(--muted)}.zc .rk div input.n{width:64px;padding:2px 4px;font-size:12px}
.zc .rk .me{border:2px solid #F2B705;background:#FFFBEA;color:#14212E}.zc .rk .me:after{content:"내 예상";position:absolute;right:8px;top:8px;font-size:11px;font-weight:800;background:#F2B705;border-radius:999px;padding:1px 8px}
.zc .ctx{padding:9px 14px;border-top:1px solid var(--line);font-size:12.5px}.zc .cta3{display:flex;gap:8px;padding:10px 14px;border-top:1px solid var(--line)}.zc .cta3 a{flex:1;text-align:center;font-weight:800;font-size:13px;border-radius:7px;padding:9px;text-decoration:none}.zc .cta3 .a{background:#14212E;color:#fff}.zc .cta3 .b{background:#F2B705;color:#14212E}
@media(max-width:720px){.zc .g{grid-template-columns:1fr}.zc .in{border-right:0;border-bottom:1px solid var(--line)}.zc .fx{grid-template-columns:1fr 1fr}.zc .rk{grid-template-columns:1fr}}`;
    document.head.appendChild(css);
    const mapHref = (act.querySelector('a.cta') || {}).getAttribute ? act.querySelector('a.cta').getAttribute('href') : '/';
    function draw() {
      const K = KIND[S.k], apA = autoAp(), spA = autoSp();
      const ap = S.ap != null ? S.ap : apA, sp = S.sp != null ? S.sp : spA, right = Math.round(ap * S.rt / 100), pay = sp - right;
      // 권리가액 순위: 구역 땅값 합계(구역 면적 × 동네 단독·토지 대지㎡ 시세 × 75%) ÷ 조합원 수 = 평균 → 로그정규로 상위 몇 %
      const tot = BASE.v && row.ar ? row.ar * BASE.v * AP : 0, avg = tot && S.mem ? tot / S.mem : 0;
      const top = avg && ap ? 1 - Phi((Math.log(ap) - (Math.log(avg) - SIG * SIG / 2)) / SIG) : null;
      const M = Math.max(1, S.mem), rank = top == null ? null : Math.min(M, Math.max(1, Math.round(top * M)));
      const order = [114, 84, 59]; let acc = 0, mine = null; const seg = [];
      for (const k of order) { const c = Math.max(0, +S.c[k] || 0), from = acc + 1, to = Math.min(M, acc + c); seg.push({ k, c, from, to: Math.max(from - 1, to) }); if (rank != null && mine == null && rank <= acc + c) mine = k; acc += c; }
      const COL = { 114: '#7048E8', 84: '#1C64C8', 59: '#2B8A3E' };
      const tag = (on, man) => on ? '<i class="auto">자동</i>' : man ? '<i class="auto man">직접</i>' : '';
      box.innerHTML = `<h2>내 집 분담금·평형 미리 계산 <small>${esc(row.n || row.title || '')} · 참고용 추정</small></h2>
<div class="g"><div class="in">
<div class="r"><b>내 물건</b><span class="seg" data-g="k">${Object.entries(KIND).map(([k, v]) => `<button type="button" data-v="${k}" class="${S.k === k ? 'on' : ''}">${v[0]}</button>`).join('')}</span></div>
<div class="r"><b>${K[1]}</b><span><input class="n s" data-f="ar" inputmode="decimal" value="${S.ar || ''}"> <i class="u">㎡ (${(S.ar / 3.3058).toFixed(1)}평)</i></span></div>
<div class="r"><b>예상 감정가</b><span><input class="n" data-f="ap" inputmode="numeric" value="${ap || ''}"> <i class="u">만원</i><i class="h">${ap ? won(ap) : ''}</i>${tag(S.ap == null && apA, S.ap != null)}${S.ap == null && apA ? `<i class="ex">${esc(K[2].w)} ${K[0]} 시세 ㎡당 ${K[2].v.toLocaleString()}만 × ${S.ar}㎡ × ${AP * 100}%</i>` : !apA ? '<i class="ex">이 종류는 동네 시세 자료가 없어 직접 넣어 주세요</i>' : ''}</span></div>
<div class="r"><b>원하는 평형</b><span class="seg" data-g="py">${[59, 84, 114].map(v => `<button type="button" data-v="${v}" class="${S.py === v ? 'on' : ''}">${v}㎡ (${PY[v]}평)</button>`).join('')}</span></div>
<div class="r"><b>조합원 분양가</b><span><input class="n" data-f="sp" inputmode="numeric" value="${sp || ''}"> <i class="u">만원</i><i class="h">${sp ? won(sp) : ''}</i>${tag(S.sp == null && spA, S.sp != null)}${S.sp == null && spA ? `<i class="ex">${esc(APT.w)} 아파트 시세 전용㎡당 ${APT.v.toLocaleString()}만 × ${S.py}㎡ × ${SP * 100}%</i>` : ''}</span></div>
<div class="r"><b>비례율</b><span class="rv"><input type="range" data-f="rt" min="70" max="130" step="1" value="${S.rt}"><b>${S.rt}%</b></span></div>
</div><div class="out">
<dl><dt>예상 감정가</dt><dd>${won(ap)}</dd><dt>× 비례율 ${S.rt}% = 권리가액</dt><dd>${won(right)}</dd><dt>${S.py}㎡ 조합원 분양가</dt><dd>${won(sp)}</dd></dl>
<div class="big"><b>${pay >= 0 ? '예상 분담금' : '예상 환급금'}</b><em class="${pay < 0 ? 'pl' : ''}">약 ${won(Math.abs(pay))}</em></div>
${late ? '<p class="warn">이 구역은 관리처분인가 이후 단계라 조합원 분양가가 정해져 있습니다. 조합 공지 분양가로 고쳐 넣어 주세요.</p>' : ''}
<p class="note">감정가는 동네 실거래 시세의 ${AP * 100}%, 조합원 분양가는 동네 아파트 시세의 ${SP * 100}%로 처음 계산했습니다. 실제 분담금은 감정평가와 관리처분계획으로 정해집니다. 숫자를 고치면 바로 다시 계산됩니다.</p>
</div></div>
<div class="s2"><h3>내가 받을 평형 순서 <small>권리가액이 큰 순서대로 큰 평형을 먼저 고르는 방식으로 추정</small></h3>
<div class="fx"><div><span class="u">계획 세대</span><b>${HH ? HH.toLocaleString() : '-'}</b></div><div><span class="u">분양 / 임대</span><b>${SALE.toLocaleString()} / ${RENT.toLocaleString()}</b></div><div><span class="u">조합원 수</span><b><input class="n" data-f="mem" inputmode="numeric" value="${S.mem}">${S.memSet ? '' : '<i class="auto">자동</i>'}</b></div><div><span class="u">내 권리가액 순위</span><b>${rank ? `약 ${rank.toLocaleString()}등` : '-'}</b></div></div>
${rank ? `<div class="bar">${seg.filter(x => x.to >= x.from).map(x => `<i style="width:${((x.to - x.from + 1) / M * 100).toFixed(2)}%;background:${COL[x.k]}" title="${x.k}㎡ ${x.from}~${x.to}등"></i>`).join('')}<span class="mk" style="left:calc(${((rank - 0.5) / M * 100).toFixed(2)}% - 1px)"><span>▼ 약 ${rank.toLocaleString()}등 (상위 ${Math.max(1, Math.round(rank / M * 100))}%)</span></span></div><div class="lx"><span>1등 (권리가액 큰 쪽)</span><span>조합원 ${M.toLocaleString()}등</span></div>` : '<p class="note">동네 시세 자료가 없어 순위는 계산하지 못했습니다.</p>'}
<div class="rk">${seg.map(x => `<div class="${mine === x.k ? 'me' : ''}"><b>${x.k}㎡ (${PY[x.k]}평)</b><span><input class="n" data-c="${x.k}" inputmode="numeric" value="${x.c}"> 세대 · ${x.to >= x.from ? `${x.from.toLocaleString()}~${x.to.toLocaleString()}등` : '조합원 몫 없음 (일반분양)'}</span></div>`).join('')}</div>
${mine && S.py > mine ? `<p class="warn">원하는 ${S.py}㎡보다 순서가 뒤라 ${mine}㎡ 배정 가능성이 높아 보입니다.</p>` : ''}
<p class="note">조합원 수(분양 세대의 50%)·평형별 세대수(59:84:114 = 40:50:10)·권리가액 분포는 서울시 자료에 없어 가정한 값입니다. 아시는 숫자로 고쳐 넣어 주세요.</p></div>
<div class="ctx">이 구역 계획 <b>${HH ? HH.toLocaleString() + '세대' : '-'}</b>${SALE ? ` (분양 ${SALE.toLocaleString()} · 임대 ${RENT.toLocaleString()})` : ''}${row.far ? ` · 용적률 <b>${row.far}%</b>` : ''}${row.fl ? ` · 지상 ${String(row.fl).split('/')[1] || ''}층` : ''}${row.st ? ` · ${esc(row.st)} 단계` : ''}</div>
<div class="cta3"><a class="a" href="${esc(mapHref)}">이 구역 매물 보기</a><a class="b" href="#" data-goof>이 구역 중개사에게 상담하기</a></div>`;
    }
    const num = v => +String(v).replace(/[^\d.]/g, '') || 0;
    box.addEventListener('click', e => {
      const b = e.target.closest('[data-g] button'); if (b) { const g = b.parentElement.dataset.g; if (g === 'k') { S.k = b.dataset.v; S.ap = null; } else { S.py = +b.dataset.v; S.sp = null; } draw(); return; }
      if (e.target.closest('[data-goof]')) { e.preventDefault(); offBox.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
    });
    box.addEventListener('change', e => {
      const t = e.target, f = t.dataset.f;
      if (f === 'ar') { S.ar = num(t.value); S.ap = null; }
      else if (f === 'ap') S.ap = t.value.trim() ? num(t.value) : null;
      else if (f === 'sp') S.sp = t.value.trim() ? num(t.value) : null;
      else if (f === 'mem') { S.mem = Math.max(1, Math.round(num(t.value))) || S.mem; S.memSet = true; }
      else if (t.dataset.c) S.c[t.dataset.c] = Math.round(num(t.value));
      else return;
      draw();
    });
    box.addEventListener('input', e => { if (e.target.dataset.f === 'rt') { S.rt = +e.target.value; draw(); const r = $('[data-f="rt"]', box); if (r) r.focus(); } });
    draw();
    anchor.after(box);
  }
})();
