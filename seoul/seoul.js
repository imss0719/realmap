// 서울 정비사업 안내 페이지용 (seoul-pages.mjs가 seoul/seoul.js 로 복사)
// 1) 화면에 들어올 때 움직이는 효과  2) 숫자 올라가기  3) 관심 구역 ☆ · 추진 알림 🔔 (회원 전용)
(function () {
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const SLUG = { '종로구': 'jongno', '중구': 'jung', '용산구': 'yongsan', '성동구': 'seongdong', '광진구': 'gwangjin', '동대문구': 'dongdaemun', '중랑구': 'jungnang', '성북구': 'seongbuk', '강북구': 'gangbuk', '도봉구': 'dobong', '노원구': 'nowon', '은평구': 'eunpyeong', '서대문구': 'seodaemun', '마포구': 'mapo', '양천구': 'yangcheon', '강서구': 'gangseo', '구로구': 'guro', '금천구': 'geumcheon', '영등포구': 'yeongdeungpo', '동작구': 'dongjak', '관악구': 'gwanak', '서초구': 'seocho', '강남구': 'gangnam', '송파구': 'songpa', '강동구': 'gangdong' };
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

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
      if (f) { f.classList.toggle('on', !!it); f.innerHTML = it ? '★ 관심 구역' : '☆ 관심 구역'; f.setAttribute('aria-pressed', !!it); }
      if (a) { const on = !!(it && it.alert); a.classList.toggle('on', on); a.innerHTML = on ? '🔔 알림 받는 중' : '🔔 추진 알림 받기'; a.setAttribute('aria-pressed', on); }
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
})();
