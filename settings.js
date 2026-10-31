// 리얼맵 중개장부 · 설정 (10/26 · 10/27 촘촘한 화면: 왼쪽 메뉴 → 그 부분만, 안은 '이름 | 값 | 버튼' 한 줄씩 · 두 칸 배치 · 13px 표)
// [매물] [고객관리] [설정] — 가끔 쓰는 기능을 한곳에: 우리 사무소 · 엑셀(불러오기·양식·기록·내려받기) · 요금제 · 계정·화면 · 직원 관리(10/28)
// 직원으로 들어온 사람: 엑셀·결제·사무소 고치기·해지는 없고 [내 소속](나가기)이 보임
// 엑셀 내려받기는 대표 휴대폰 인증 한 번에 한 번 (서버가 인증할 때 기록을 남김: /api/auth?action=xlog)
// host = { api, post, toast, me(), bk(), plan(), items(), canPub(), openBk(), importXl(), quit(), xlGate(info, fn), exportLs(), fz(d) }
window.Sett = (() => {
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const MENU = [['office', '우리 사무소', ''], ['excel', '엑셀', '불러오기·받기'], ['plan', '요금제', ''], ['help', '문의하기', ''], ['acct', '계정·화면', '']];
  const MENU_ST = [['office', '우리 사무소', ''], ['plan', '요금제', ''], ['help', '문의하기', ''], ['acct', '계정·화면', '']];   // 직원 화면
  const isStaff = () => !!(H && H.me() && H.me().staff);
  let H = null, el = null, sec = 'excel', log = null, cxs = null, cus = null, hp = null, sf = null; const off = new Set();   // sf: 직원 관리 자료   // off: 내려받기에서 체크를 푼 단지 · hp: 내 입금 신청·문의
  const pf = { plan: '', mon: 12, payer: '', rc: '', rcno: '', seats: null, add: 1 }, qf = { cat: '사용법', text: '', img: '' };   // 쓰던 신청서·문의 글 (화면을 다시 그려도 남게)
  const BANK = { name: '신한은행', no: '140-012-485569', who: '(주)드림인베스트' }, PRICE = { basic: 9900, premium: 19900, vip: 29900 }, PN = { basic: 'Basic', premium: 'Premium', vip: 'VIP' };
  const PDESC = { basic: '매물 1,000건 · 지도 광고 300건', premium: '매물 5,000건 · 지도 광고 1,000건', vip: '매물 3만 건 · 지도 광고 3,000건' };
  const ymdhm = t => { const d = new Date(new Date(t).getTime() + 9 * 3600e3).toISOString(); return `${d.slice(2, 4)}.${d.slice(5, 7)}.${d.slice(8, 10)} ${d.slice(11, 16)}`; };
  const ymd = t => t ? String(t).slice(0, 10).replace(/-/g, '.') : '';
  const csv = (name, head, rows) => {
    const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + [head, ...rows].map(r => r.map(q).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' }));
    a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
  const today = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
  // 촘촘한 화면 조각: 판(제목 줄 + 줄들) · 줄(이름 | 값 | 버튼) · 표
  const pn = (title, sub, body, cls = '', right = '') => `<section class="sp ${cls}"><h3>${title}${sub ? ` <small>${sub}</small>` : ''}${right ? `<span class="r">${right}</span>` : ''}</h3>${body}</section>`;
  const rw = (name, val, act = '') => `<div class="sr"><b>${name}</b><span>${val}</span>${act ? `<span class="a">${act}</span>` : '<span></span>'}</div>`;
  const tb = (head, rows, empty) => rows.length ? `<table class="st-tb"><tr>${head.map(h => `<th>${h}</th>`).join('')}</tr>${rows.join('')}</table>` : `<p class="sp-e">${empty}</p>`;
  const B = (id, t, c = '', x = '') => `<button type="button" class="sb ${c}" ${id ? `id="${id}"` : ''} ${x}>${t}</button>`;
  const seen = () => { try { return localStorage.getItem('rm.qseen') || ''; } catch { return ''; } };
  const newRep = () => ((hp && hp.qnas) || []).filter(q => q.reply && q.rat > seen()).length;   // 아직 안 본 답변 수 (메뉴 빨간 숫자)

  const isOp = () => !!(H && H.me() && H.me().op) && !isStaff();
  const menu = () => isStaff() ? [...MENU_ST, ['mine', '내 소속', '']] : [...MENU, ['staff', '직원 관리', ''], ...(isOp() ? [['pyt', '단지 평형표', '운영자만']] : [])];   // 10/30 운영자만 보임
  function mount(box, host) { H = host; el = box; try { sec = 'office'; /* 10/28 설정은 늘 '우리 사무소'부터 */ } catch { /* 무시 */ } if (!menu().some(m => m[0] === sec)) sec = menu()[0][0]; draw(); if (!hp) loadHp().then(() => draw()); }
  function refresh() { if (el && !el.contains(document.activeElement)) draw(); }   // 글을 쓰는 중이면 다시 그리지 않음
  function stale() { log = null; cxs = null; cus = null; if (el && !el.hidden) draw(); }   // 엑셀 불러오기 뒤 기록·숫자 새로
  function go(s, fresh) { if (fresh) { hp = null; sf = null; } if (!menu().some(m => m[0] === s)) s = menu()[0][0]; sec = s; try { localStorage.setItem('rm.set', s); } catch { /* 무시 */ } draw(); }
  function draw() {
    const b = H.bk() || {}, nr = newRep(), wn = sf && sf.list ? sf.list.filter(m => m.st === 'wait').length : 0;
    const sub = { office: b.verified ? '확인됨' : b.office ? '확인 전' : '', plan: (H.plan() || {}).name || '', staff: sf && sf.list ? `${sf.used}명` : '', mine: ((H.me() || {}).staff || {}).name || '' };
    if (!menu().some(m => m[0] === sec)) sec = menu()[0][0];
    el.innerHTML = `<div class="st-w"><nav class="st-n">${menu().map(([k, t, d]) => `${k === 'staff' || k === 'mine' || k === 'pyt' ? '<hr>' : ''}<button type="button" data-s="${k}" aria-pressed="${sec === k}"><b>${t}</b>${(k === 'help' && nr) || (k === 'staff' && wn) ? `<em>${k === 'help' ? nr : wn}</em>` : `<small>${esc(sub[k] || d)}</small>`}</button>`).join('')}
      </nav><div class="st-m" id="stM"></div></div>`;
    el.querySelectorAll('[data-s]').forEach(b => b.onclick = () => go(b.dataset.s));
    ({ office, excel, plan, help, acct, staff, mine, pyt })[sec]($('stM'));
    if (!isStaff() && !sf) loadSf().then(() => draw());
  }

  // ---------- 우리 사무소 ----------
  const ofUrl = b => `${location.origin}/office.html?r=${String(b.regno || '').replace(/\D/g, '')}`;   // 10/28 중개사 소개 페이지
  function office(m) {
    const b = H.bk() || {}, v = x => x ? esc(x) : '<i class="em">비어 있음</i>';
    const mobOk = b.mobile && b.mobileOk && String(b.mobileOk).replace(/\D/g, '') === String(b.mobile).replace(/\D/g, '');
    const live = H.items().filter(x => x.pub && x.pub.on && x.status === 'on' && x.pub.exp > new Date().toISOString()).length;
    m.innerHTML = `<div class="sg2">${pn('중개사무소 정보', b.verified ? '<span class="tg g">등록 확인됨 ✓</span>' : b.office ? '<span class="tg r">확인 전</span>' : '',
      rw('상호', v(b.office)) + rw('대표자', v(b.ceo)) + rw('등록번호', v(b.regno)) + rw('주소', v(b.addr)) + rw('사무실 전화', v(b.tel)) + rw('대표 휴대폰', v(b.mobile) + (b.mobile ? ` <span class="tg ${mobOk ? 'g' : 'r'}">${mobOk ? '인증됨' : '인증 필요'}</span>` : '')),
      '', isStaff() ? '<small>고치기는 대표만</small>' : B('stBk', '고치기 · 사진 · 휴대폰 인증', 'y'))}
      ${H.canPub() ? pn('리얼맵 지도 광고 표시', '공인중개사법 표시·광고 항목',
        rw('광고에 나가는 글', `<b>${esc(b.office || '')}</b> · 대표 ${esc(b.ceo || '')} · 등록번호 ${esc(b.regno || '')}<br>${esc(b.addr || '')}${b.tel ? ` · ☎ ${esc(b.tel)}` : ''}`) + rw('지금 게시 중', `${live}건`) + rw('고치기', '<small>왼쪽 [고치기]에서 바꾸면 광고에도 바로 반영됩니다</small>')) : ''}
      ${b.verified ? pn('중개사 소개 페이지', '명함·블로그·카톡에 붙이는 링크',
        rw('주소', `<a href="${esc(ofUrl(b))}" target="_blank" rel="noopener">${esc(ofUrl(b).replace(/^https?:\/\//, ''))}</a>`, B('stOfCp', '링크 복사', 'n')) +
        rw('한 줄 소개', v(b.intro)) + rw('전문 분야', (b.spec || []).length ? esc(b.spec.join(' · ')) : v('')) + rw('활동 동네', v(b.area)),
        '', isStaff() ? '' : B('stOfEd', '소개 고치기', 'y')) : ''}
      ${NRULE && NRULE !== 'loading' ? noRule() : ''}</div>`;
    if ($('stBk')) $('stBk').onclick = () => H.openBk();
    if ($('stOfEd')) $('stOfEd').onclick = () => H.openBk();
    if (NRULE == null) { NRULE = 'loading'; H.api('/api/auth?action=norule').then(j => { NRULE = j.rule || {}; }).catch(() => { NRULE = {}; }).finally(() => { if (sec === 'office') draw(); }); }
    wireNoRule();
    if ($('stOfCp')) $('stOfCp').onclick = async () => { try { await navigator.clipboard.writeText(ofUrl(b)); H.toast('소개 페이지 링크를 복사했습니다'); } catch { prompt('이 주소를 복사해 주세요', ofUrl(b)); } };
  }

  // 10/29 매물번호 규칙 (새로 등록하는 매물부터 · 이미 붙은 번호는 그대로)
  let NRULE = null, NRD = null;
  const NF = [['ym', '년월-순번'], ['seq', '순번만'], ['kind', '종류-순번']];
  function noEx(r) { const d = new Date(Date.now() + 9 * 3600e3), ym = String(d.getUTCFullYear()).slice(2) + String(d.getUTCMonth() + 1).padStart(2, '0'); const p = r.p ? r.p + '-' : ''; return r.f === 'seq' ? p + '0013' : r.f === 'kind' ? `${p}아파트-007 · ${p}상가-012` : `${p}${ym}-013`; }
  function noRule() {
    const r = NRD || { p: NRULE.p || '', f: NRULE.f || 'ym' }, ro = isStaff();
    return pn('매물번호 규칙', '새로 등록하는 매물부터 · 이미 붙은 번호는 그대로',
      rw('앞 글자', `<input class="si" id="stNoP" value="${esc(r.p)}" maxlength="6" placeholder="선택 · 예: RW" style="width:140px" ${ro ? 'disabled' : ''}>`) +
      rw('방식', `<span class="sseg">${NF.map(([k, t]) => `<button type="button" data-nf="${k}" aria-pressed="${r.f === k}" ${ro ? 'disabled' : ''}>${t}</button>`).join('')}</span>`) +
      rw('예시', `<b id="stNoEx">${esc(noEx(r))}</b>`), '', ro ? '<small>바꾸기는 대표만</small>' : B('stNoSave', '저장', 'y'));
  }
  function wireNoRule() {
    if (!$('stNoP')) return;
    const cur = () => NRD || (NRD = { p: NRULE.p || '', f: NRULE.f || 'ym' });
    $('stNoP').oninput = e => { cur().p = e.target.value.replace(/[^0-9A-Za-z가-힣]/g, ''); $('stNoEx').textContent = noEx(cur()); };
    document.querySelectorAll('[data-nf]').forEach(b => b.onclick = () => { cur().f = b.dataset.nf; document.querySelectorAll('[data-nf]').forEach(z => z.setAttribute('aria-pressed', z === b)); $('stNoEx').textContent = noEx(cur()); });
    if ($('stNoSave')) $('stNoSave').onclick = async () => {
      try { const j = await H.api('/api/auth?action=norule', H.post(cur())); NRULE = j.rule; NRD = null; H.toast('매물번호 규칙을 저장했습니다. 새로 등록하는 매물부터 적용됩니다', 3500); draw(); } catch (e) { H.toast(e.message, 4000); }
    };
  }

  // ---------- 엑셀 ----------
  async function loadLog() { try { log = await H.api('/api/auth?action=xlog'); } catch (e) { log = { dl: [], im: [], err: e.message }; } }
  async function loadCx() { try { cxs = (await H.api('/api/auth?action=cx')).items || []; } catch { cxs = []; } }
  async function loadHp() { try { hp = await H.api('/api/auth?action=help'); } catch (e) { hp = { pays: [], qnas: [], err: e.message }; } }
  async function loadCu() { try { cus = (await H.api('/api/auth?action=cu')).items || []; } catch (e) { cus = { err: e.message }; } }
  function excel(m) {
    const n = H.items().length, im = (log && log.im) || [], dl = (log && log.dl) || [];
    const ph = H.bk() && H.bk().mobile ? esc(String(H.bk().mobile).replace(/^(\d{3})-?(\d{3,4})-?(\d{4})$/, '$1-****-$3')) : '대표';
    const cxl = cxs ? cxs.length ? cxs.map(c => `<label><input type="checkbox" data-cx="${esc(c.id)}" ${off.has(c.id) ? '' : 'checked'}> ${esc(c.name)}</label>`).join(' ') : '<small>담은 단지가 없습니다</small>' : '<small>불러오는 중…</small>';
    m.innerHTML = `<div class="sg2">
      ${pn('엑셀 불러오기', '매물장·아파트 장부를 알아서 나눔',
        rw('파일 올리기', 'xlsx · xls · csv <small>· 아파트 장부는 주소 칸 필요</small>', B('stIm', '파일 고르기', 'y')) +
        rw('빈 양식', '리얼맵에 잘 들어가는 양식 <small>· 예시 줄은 지우지 않아도 건너뜀</small>', B('', '매물장용', '', 'data-tpl="ls"') + B('', '아파트 장부용', '', 'data-tpl="hj"')))}
      ${pn('엑셀 내려받기', `대표 휴대폰 ${ph} 인증 1번 = 1번 받기`,
        rw('매물장 전체', `${n.toLocaleString()}건 <small>진행·보류·거래완료</small>`, B('stDlLs', '받기', 'n', n ? '' : 'disabled')) +
        rw('아파트 단지 장부', `<span id="stCx">${cxl}</span>`, B('stDlHj', '받기', 'n', cxs && cxs.length ? '' : 'disabled')) +
        rw('고객 목록', cus ? cus.err ? `<small>${esc(cus.err)}</small>` : `${cus.length.toLocaleString()}명` : '<small>불러오는 중…</small>', B('stDlCu', '받기', 'n', Array.isArray(cus) && cus.length ? '' : 'disabled')))}
      ${pn('불러온 기록', '최근 30건 · 나중에도 되돌리기', !log ? '<p class="sp-e">불러오는 중…</p>' : tb(['날짜', '파일', '넣은 곳', '건수', ''], im.map(e => `<tr><td>${ymdhm(e.at)}</td><td class="ell" title="${esc(e.file)}">${esc(e.file)}</td><td class="ell" title="${e.to === 'hj' ? esc(e.names || '') : ''}">${e.to === 'hj' ? `단지 · ${esc(e.names || '')}` : '매물장'}</td><td>${e.n.toLocaleString()}${e.to === 'hj' ? '호' : '건'}</td><td>${e.undone ? '<span class="tg gr">되돌림</span>' : B('', '되돌리기', 'r', `data-undo="${esc(e.id)}"`)}</td></tr>`), '아직 불러온 적이 없습니다'))}
      ${pn('내려받은 기록', '최근 100건 보관', !log ? '' : tb(['날짜', '받은 것', '건수', '인증 번호'], dl.slice(0, 30).map(e => `<tr><td>${ymdhm(e.at)}</td><td class="ell">${esc(e.what)}</td><td>${e.n.toLocaleString()}</td><td>${esc(e.ph)}</td></tr>`), '아직 내려받은 적이 없습니다'))}
      ${isStaff() ? '' : pn('기록 정리', '10/30 · 대표만', rw('지금까지의 기록', '매물 기록 · 아파트 호 기록을 모두 지웁니다 <small>(가격·연락처·메모 칸은 그대로 · 되돌릴 수 없음)</small>', B('stHc', '모두 지우기', 'n')))}</div>`;
    $('stIm').onclick = () => H.importXl();
    if ($('stHc')) $('stHc').onclick = async () => {   // 10/30 선배 요청: 지금까지의 기록 모두 지우기 (앞으로는 직접 쓴 기록만 남음)
      if (!confirm('지금까지 쌓인 기록을 모두 지울까요?\n\n· 매물(상가·건물 등) 입력창의 기록\n· 아파트 단지 장부 호마다의 기록\n\n가격·연락처·메모·챙길 것 칸은 그대로 남습니다.\n지운 기록은 되돌릴 수 없습니다.')) return;
      try { const j = await H.api('/api/auth?action=listing', H.post({ op: 'histclear' })); H.toast(`기록을 지웠습니다 (매물 ${j.cleared.ls}건 · 아파트 호 기록 ${j.cleared.hj}개). 화면을 새로 고칩니다.`, 3000); setTimeout(() => location.reload(), 1600); }
      catch (e) { H.toast(e.message, 4000); }
    };
    m.querySelectorAll('[data-tpl]').forEach(b => b.onclick = () => tpl(b.dataset.tpl));
    m.querySelectorAll('[data-undo]').forEach(b => b.onclick = () => undo(b.dataset.undo));
    $('stDlLs').onclick = () => H.xlGate({ what: '매물장 전체', n: H.items().length }, () => { H.exportLs(); after(); });
    $('stDlHj').onclick = () => dlLedger();
    m.querySelectorAll('[data-cx]').forEach(i => i.onchange = () => { if (i.checked) off.delete(i.dataset.cx); else off.add(i.dataset.cx); });
    $('stDlCu').onclick = () => H.xlGate({ what: '고객 목록', n: cus.length }, () => { dlCust(); after(); });
    if (!log) loadLog().then(() => sec === 'excel' && draw());
    if (!cxs) loadCx().then(() => sec === 'excel' && draw());
    if (!cus) loadCu().then(() => sec === 'excel' && draw());
  }
  const after = () => { log = null; setTimeout(() => sec === 'excel' && draw(), 300); };
  function tpl(k) {
    if (k === 'ls') csv('리얼맵_매물장_양식.csv', ['매물번호', '등록일', '현황', '주소', '건물명', '동', '호', '층', '종류', '거래', '매매가(만원)', '보증금(만원)', '월세(만원)', '권리금(만원)', '관리비(만원)', '전용면적(㎡)', '대지면적(㎡)', '연면적(㎡)', '사용승인일', '용도지역', '소유자', '연락처', '임차인', '연락처', '메모'],
      [['', '2026-10-26', '거래중', '서울 마포구 노고산동 31-5', '○○빌딩', '', '101', '1', '상가', '월세', '', '5000', '300', '7000', '20', '46.2', '', '', '', '', '홍길동', '010-0000-0000', '', '', '1층 코너 (이 줄은 예시라 지우고 쓰세요)']]);
    else csv('리얼맵_아파트장부_양식.csv', ['주소', '물건명', '동', '호', '부동산명', '거래구분', '매매', '전세', '보증금', '월세', '물건내역', '현상태', '현 보증금', '현 차임', '만기일', '소유주', '소유주 핸드폰', '세입자', '세입자 핸드폰', '상담내역'],
      [['서울 마포구 아현동 777', '○○아파트', '103', '1201', '', '전세', '', '90000', '', '', '올수리', '전완', '65000', '', '2027-03-30', '홍길동', '010-0000-0000', '', '', '이 줄은 예시라 지우고 쓰세요 (부동산명이 비면 내 매물)']]);
    H.toast('양식을 받았습니다. 엑셀에서 열어 채운 뒤 [파일 고르기]로 올려 주세요', 4500);
  }
  async function undo(id) {
    const e0 = ((log && log.im) || []).find(e => e.id === id); if (!e0) return;
    if (!confirm(`${ymdhm(e0.at)}에 불러온 ${e0.n}${e0.to === 'hj' ? '호' : '건'}을 모두 지울까요?\n(불러온 뒤 고친 내용·기록도 함께 지워집니다)`)) return;
    try {
      const { e } = await H.api('/api/auth?action=xlog', H.post({ op: 'imget', id }));
      if (e.to === 'ls') { const j = await H.api('/api/auth?action=listing', H.post({ op: 'unimport', ib: e.ib })); if (H.took) H.took(j); }
      else {
        for (const [cid, key] of e.made || []) { if ((e.newCx || []).includes(cid)) continue; try { await H.api('/api/auth?action=hj', H.post({ id: cid, key, op: 'wipe' })); } catch { /* 이미 지운 호 */ } }
        for (const cid of e.newCx || []) { try { await H.api('/api/auth?action=cx', H.post({ op: 'del', id: cid })); } catch { /* 이미 뺀 단지 */ } }
        if (H.djReload) H.djReload(); cxs = null;
      }
      await H.api('/api/auth?action=xlog', H.post({ op: 'imdone', id }));
      H.toast('되돌렸습니다'); log = null; draw();
    } catch (er) { H.toast(er.message || '되돌리지 못했습니다', 4000); }
  }
  // 아파트 단지 장부: 적어 둔 호만 (동·호·상태·가격·현상태·만기·연락처·메모)
  const KN = { sale: '매매', jeonse: '전세', wolse: '월세' }, LIVE = { owner: '입주', tenant: '임차', empty: '공실' };
  async function dlLedger() {
    const ids = [...document.querySelectorAll('#stCx [data-cx]:checked')].map(i => i.dataset.cx); if (!ids.length) return H.toast('받을 단지를 골라 주세요');
    const pick = cxs.filter(c => ids.includes(c.id)), data = [];
    try { for (const c of pick) { const j = await H.api(`/api/auth?action=hj&id=${encodeURIComponent(c.id)}`); data.push([c, j.units || {}]); } } catch (e) { return H.toast(e.message, 4000); }
    const rows = [];
    for (const [c, U] of data) for (const [key, r] of Object.entries(U).sort((a, b) => a[0].localeCompare(b[0], 'ko', { numeric: true }))) {
      const [, dn, ho] = key.split('|'), s = r.st || {}, pr = r.pr || {};
      rows.push([c.name, dn, ho, s.src ? `${s.src === 'mine' ? '내 매물' : '타부동산'}${s.hold ? ' 보류' : ''}` : '', s.office || '', (s.k || []).map(k => KN[k]).join('·'), pr.sale || '', pr.jeonse || '', pr.wd || '', pr.wr || '', r.imp || '', LIVE[r.live] || '', r.cd || '', r.cr || '', r.exp || '', r.moveIn || '', r.opt || '', (r.tels || []).map(t => `${t.l} ${t.n}`).join(' / '), r.note || '']);
    }
    if (!rows.length) return H.toast('고른 단지에 적어 둔 호가 없습니다');
    H.xlGate({ what: `아파트 단지 장부 (${pick.map(c => c.name).join(', ')})`.slice(0, 60), n: rows.length }, () => {
      csv(`리얼맵_아파트장부_${today()}.csv`, ['단지', '동', '호', '상태', '부동산명', '거래', '매매가(만원)', '전세(만원)', '월세보증금(만원)', '월세(만원)', '꼭 챙길 것', '거주', '현 보증금(만원)', '현 차임(만원)', '만기', '입주', '옵션·수리', '연락처', '메모'], rows);
      H.toast(`${rows.length}호를 받았습니다. 연락처가 들어 있으니 보관에 주의해 주세요.`, 4500); after();
    });
  }
  function dlCust() {
    const ST = { on: '찾는 중', hold: '보류', done: '계약함' };
    csv(`리얼맵_고객목록_${today()}.csv`, ['이름', '연락처', '상태', '찾는 거래', '찾는 종류', '매매·전세 예산(만원)', '월세 보증금(만원)', '월세(만원)', '면적(평)', '지역', '입주', '한 줄 메모', '등록일'],
      cus.map(c => [c.name, c.phone, ST[c.status] || '', (c.k || []).map(k => KN[k]).join('·'), (c.pt || []).join('·'), c.bmax || '', c.dmax || '', c.rmax || '', c.amin || c.amax ? `${c.amin || ''}~${c.amax || ''}` : '', (c.where || []).join('·'), c.movein || '', c.note || '', ymd(c.at)]));
    H.toast(`고객 ${cus.length}명을 받았습니다. 연락처가 들어 있으니 보관에 주의해 주세요.`, 4500);
  }

  // ---------- 요금제 ----------
  function plan(m) {
    const P = H.plan() || {}, items = H.items(), now = new Date().toISOString();
    const pub = items.filter(x => x.pub && x.pub.on && x.status === 'on' && x.pub.exp > now).length;
    const left = P.until ? Math.max(0, Math.ceil((new Date(P.until) - Date.now()) / 86400e3)) : null;
    const bar = (t, v, max, u) => `<div class="su"><b>${t}</b><div class="st-bar"><i style="width:${max && v != null ? Math.min(100, Math.round(v / max * 100)) : 0}%" class="${max && v / max >= .9 ? 'hi' : ''}"></i></div><small>${v == null ? '…' : v.toLocaleString()} / ${max ? max.toLocaleString() + u : '제한 없음'}</small></div>`;
    const notes = ((hp && hp.notes) || []).filter(n => !n.k);   // 운영자 혜택 기록 (10/27) · k: 직원 신청 같은 다른 알림
    m.innerHTML = pn('요금제 · 쓰는 양', `<span class="tg gr">${esc(P.name || '')}${P.until ? ` · ${ymd(P.until)}까지${left != null ? ` (${left}일)` : ''}` : P.plan !== 'free' ? ' · 기한 없음' : ''}</span>${P.gift ? ' <span class="tg y">운영자 혜택</span>' : ''}`,
      `<div class="sus">${bar('매물', items.length, P.ls, '건')}${bar('지도 광고', pub, P.ad, '건')}${bar('아파트 단지', cxs ? cxs.length : null, P.cx, '곳')}${bar('고객', Array.isArray(cus) ? cus.length : null, P.cu, '명')}</div>`,
      '', '<a class="sb" href="/pro.html#price" target="_blank" rel="noopener">요금제 자세히</a>') +
      (isStaff() ? '' : seatPanel()) + (notes.length ? pn('운영자 혜택 기록', '리얼맵 운영자가 올려 드린 요금제', tb(['적용일', '요금제', '쓰는 기간'], notes.filter(n => !n.k).map(n => `<tr><td>${ymdhm(n.at)}</td><td>${esc(n.name)}</td><td>${n.until ? ymd(n.until) + '까지' : '기한 없음'}</td></tr>`))) : '') + (isStaff() ? pn('요금 결제', '', '<p class="sp-e">요금제 신청·결제는 대표님 계정에서 합니다.</p>', 'mt') : payForm());
    if (!isStaff()) wirePay(m);
    if (!cxs) loadCx().then(() => sec === 'plan' && draw());
    if (!cus) loadCu().then(() => sec === 'plan' && draw());
    if (!hp) loadHp().then(() => sec === 'plan' && draw());
  }
  // 계좌이체 신청 (10/27): 고르기 → 계좌·금액 → [입금했어요] → 운영자가 통장 확인 뒤 켜 줌(남은 기간 뒤에 이어 붙임)
  function payForm() {
    const P = H.plan() || {};
    if (!pf.plan) pf.plan = PRICE[P.plan] ? P.plan : 'basic';
    if (!pf.payer) pf.payer = (H.bk() && H.bk().office) || '';
    if (pf.seats == null) pf.seats = Number(P.plan === 'trial' ? 0 : P.seats) || 0;
    const bm = pf.mon === 12 ? 10 : pf.mon, amt = PRICE[pf.plan] * bm + SEAT * pf.seats * bm, now = new Date().toISOString();
    const pays = (hp && hp.pays) || [], wait = pays.filter(x => x.st === 'wait');
    const ST = { wait: '<span class="tg y">입금 확인 중</span>', ok: '<span class="tg g">켜짐</span>', no: '<span class="tg gr">취소됨</span>', cancel: '<span class="tg gr">신청 취소</span>' };
    const seg = (items, cur, attr) => `<span class="sseg">${items.map(([k, t]) => `<button type="button" ${attr}="${k}" aria-pressed="${String(cur) === String(k)}">${t}</button>`).join('')}</span>`;
    return pn('요금제 신청 · 계좌이체', PRICE[P.plan] && P.until > now ? '입금하면 남은 기간 뒤에 이어서 늘어남' : '입금 확인일부터 시작',
      rw('요금제', seg(Object.keys(PRICE).map(k => [k, `${PN[k]} ${PRICE[k].toLocaleString()}`]), pf.plan, 'data-pp') + ` <small>${PDESC[pf.plan]}</small>`) +
      rw('기간', seg([[1, '1개월'], [6, '6개월'], [12, '12개월 <em>2개월 무료</em>']], pf.mon, 'data-pm')) +
      rw('직원 자리', `<span class="sstep">${B('', '−', '', 'data-sn="-1"')}<b>${pf.seats}명</b>${B('', '+', '', 'data-sn="1"')}</span> <small>대표 말고 같이 쓸 직원 수 · 1명당 월 ${SEAT.toLocaleString()}원</small>`, `<b class="amt">${amt.toLocaleString()}원</b>`) +
      rw('입금 계좌', `${BANK.name} <b>${BANK.no}</b> ${BANK.who}`, B('stCp', '계좌 복사')) +
      rw('입금자명', `<input id="stPayer" class="si" value="${esc(pf.payer)}" maxlength="30" placeholder="사무소명"> <small>통장에 찍히는 이름과 같게</small>`) +
      rw('영수증', `<label><input type="radio" name="strc" value="" ${pf.rc ? '' : 'checked'}> 필요 없음</label> <label><input type="radio" name="strc" value="cash" ${pf.rc === 'cash' ? 'checked' : ''}> 현금영수증</label> <label><input type="radio" name="strc" value="tax" ${pf.rc === 'tax' ? 'checked' : ''}> 세금계산서</label>${pf.rc ? ` <input id="stRcNo" class="si" value="${esc(pf.rcno)}" maxlength="20" placeholder="${pf.rc === 'tax' ? '사업자번호' : '휴대폰 번호'}">` : ''}`, B('stPay', '입금했어요 · 신청', 'y', wait.length >= 3 ? 'disabled' : '')) +
      `<p class="sp-n">입금이 확인되면 보통 하루 안에 켜 드리고 알림(🔔)으로 알려 드립니다. 신청하시면 <a href="/terms.html" target="_blank" rel="noopener">이용약관</a>과 환불 규정(입금 확인 7일 안 전액, 그 뒤 남은 기간만큼)에 동의한 것으로 봅니다.</p>` +
      (pays.length ? `<div class="sp-t">${tb(['신청', '요금제', '금액', '상태', ''], pays.slice(0, 10).map(x => `<tr><td>${ymdhm(x.at)}</td><td>${x.kind === 'seat' ? `직원 자리 +${x.seats}명 · ${x.mon}개월` : `${PN[x.plan] || x.plan} ${x.mon}개월${x.seats ? ` + 직원 ${x.seats}명` : ''}`}</td><td>${x.amt.toLocaleString()}원</td><td>${ST[x.st] || ''}${x.st === 'ok' && x.until ? ` <small>${ymd(x.until)}까지</small>` : ''}${x.st === 'no' && x.why ? ` <small>${esc(x.why)}</small>` : ''}</td><td>${x.st === 'wait' ? B('', '신청 취소', 'r', `data-pc="${esc(x.id)}"`) : ''}</td></tr>`), '')}</div>` : ''), 'mt');
  }
  function wirePay(m) {
    m.querySelectorAll('[data-pp]').forEach(b => b.onclick = () => { pf.plan = b.dataset.pp; draw(); });
    m.querySelectorAll('[data-pm]').forEach(b => b.onclick = () => { pf.mon = +b.dataset.pm; draw(); });
    m.querySelectorAll('[data-sn]').forEach(b => b.onclick = () => { pf.seats = Math.max(0, Math.min(30, pf.seats + +b.dataset.sn)); draw(); });
    m.querySelectorAll('[data-an]').forEach(b => b.onclick = () => { pf.add = Math.max(1, Math.min(30, pf.add + +b.dataset.an)); draw(); });
    if ($('stSeat')) $('stSeat').onclick = async () => {
      const P = H.plan() || {}, mon = Math.max(1, Math.ceil((new Date(P.until) - Date.now()) / (30 * 864e5))), amt = SEAT * pf.add * mon;
      if (!pf.payer.trim()) return H.toast('아래 신청서의 입금자명을 먼저 적어 주세요');
      if (!confirm(`직원 자리 ${pf.add}명 추가 · ${mon}개월(${ymd(P.until)}까지) ${amt.toLocaleString()}원\n${BANK.name} ${BANK.no} ${BANK.who}\n입금자명: ${pf.payer}\n\n입금하셨나요? 신청을 보냅니다.`)) return;
      try { await H.api('/api/auth?action=help', H.post({ op: 'seat', n: pf.add, payer: pf.payer, rcpt: pf.rc ? { t: pf.rc, no: pf.rcno } : null })); H.toast('신청했습니다. 입금이 확인되면 직원 자리가 늘어납니다', 4500); hp = null; draw(); }
      catch (e) { H.toast(e.message, 4000); }
    };
    m.querySelectorAll('[name="strc"]').forEach(r => r.onchange = () => { pf.rc = r.value; draw(); });
    $('stPayer').oninput = e => { pf.payer = e.target.value; };
    if ($('stRcNo')) $('stRcNo').oninput = e => { pf.rcno = e.target.value; };
    $('stCp').onclick = async () => { try { await navigator.clipboard.writeText(BANK.no.replace(/-/g, '')); H.toast('계좌번호를 복사했습니다'); } catch { prompt('계좌번호를 복사해 주세요', BANK.no); } };
    $('stPay').onclick = async () => {
      const bm = pf.mon === 12 ? 10 : pf.mon, amt = PRICE[pf.plan] * bm + SEAT * pf.seats * bm;
      if (!pf.payer.trim()) return H.toast('입금자명을 적어 주세요');
      if (pf.rc && !pf.rcno.trim()) return H.toast(pf.rc === 'tax' ? '사업자번호를 적어 주세요' : '현금영수증 받을 휴대폰 번호를 적어 주세요');
      if (!confirm(`${PN[pf.plan]} ${pf.mon}개월${pf.seats ? ` + 직원 ${pf.seats}명` : ''} ${amt.toLocaleString()}원\n${BANK.name} ${BANK.no} ${BANK.who}\n입금자명: ${pf.payer}\n\n입금하셨나요? 신청을 보냅니다.`)) return;
      try { await H.api('/api/auth?action=help', H.post({ op: 'pay', plan: pf.plan, mon: pf.mon, seats: pf.seats, payer: pf.payer, rcpt: pf.rc ? { t: pf.rc, no: pf.rcno } : null })); H.toast('신청했습니다. 입금이 확인되면 알림으로 알려 드립니다', 4500); hp = null; draw(); }
      catch (e) { H.toast(e.message, 4000); }
    };
    m.querySelectorAll('[data-pc]').forEach(b => b.onclick = async () => { if (!confirm('이 신청을 취소할까요?')) return; try { await H.api('/api/auth?action=help', H.post({ op: 'paycancel', id: b.dataset.pc })); hp = null; draw(); } catch (e) { H.toast(e.message, 4000); } });
  }

  // ---------- 문의하기 (10/27) — 운영자가 중개사 관리 화면에서 답변 · 답변이 오면 알림(🔔) ----------
  function help(m) {
    const qs = (hp && hp.qnas) || [];
    if (hp) { const last = qs.filter(q => q.reply).map(q => q.rat).sort().pop(); if (last && last > seen()) { try { localStorage.setItem('rm.qseen', last); } catch { /* 무시 */ } setTimeout(draw, 0); } }   // 열어 보면 빨간 숫자 지움
    m.innerHTML = `<div class="sg2">${pn('문의 보내기', '답변은 이 화면과 알림(🔔)으로',
      rw('종류', `<span class="sseg">${['사용법', '오류', '요금·결제', '기타'].map(c => `<button type="button" data-qc="${c}" aria-pressed="${qf.cat === c}">${c}</button>`).join('')}</span>`) +
      `<div class="sr full"><textarea id="stQ" class="st-ta" rows="5" maxlength="2000" placeholder="예) 엑셀 불러오기에서 주소를 못 찾는 줄이 많아요">${esc(qf.text)}</textarea></div>` +
      rw('사진 (선택)', `<label class="sb" for="stQi">${qf.img ? '바꾸기' : '붙이기'}</label><input type="file" id="stQi" accept="image/*" hidden> ${qf.img ? `<a href="${esc(qf.img)}" target="_blank" rel="noopener">붙인 사진</a> ${B('stQiX', '빼기', 'r')}` : '<small>오류는 화면 사진이 있으면 빨리 고칩니다</small>'}`, B('stQs', '보내기', 'y')))}
      ${pn('내 문의', qs.length ? `${qs.length}건` : '', !hp ? '<p class="sp-e">불러오는 중…</p>' : qs.length ? qs.map(q => `<div class="st-qa"><small>${ymdhm(q.at)} · ${esc(q.cat)}${q.img ? ` · <a href="${esc(q.img)}" target="_blank" rel="noopener">사진</a>` : ''}</small><p>${esc(q.text)}</p>${q.reply ? `<div class="a"><small>리얼맵 답변 · ${ymdhm(q.rat)}</small><p>${esc(q.reply)}</p></div>` : '<div class="a w">답변을 준비하고 있습니다</div>'}</div>`).join('') : '<p class="sp-e">아직 보낸 문의가 없습니다</p>')}</div>`;
    m.querySelectorAll('[data-qc]').forEach(b => b.onclick = () => { qf.cat = b.dataset.qc; draw(); });
    $('stQ').oninput = e => { qf.text = e.target.value; };
    if ($('stQiX')) $('stQiX').onclick = () => { qf.img = ''; draw(); };
    $('stQi').onchange = async e => {
      const f = e.target.files[0]; e.target.value = ''; if (!f) return;
      try {
        const src = await createImageBitmap(f), k = Math.min(1, 1600 / Math.max(src.width, src.height)), c = document.createElement('canvas');
        c.width = Math.round(src.width * k); c.height = Math.round(src.height * k); c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
        const j = await H.api('/api/auth?action=listing&op=photo', H.post({ data: c.toDataURL('image/jpeg', 0.85) })); qf.img = j.url; draw();
      } catch (er) { H.toast(er.message || '사진을 올리지 못했습니다', 4000); }
    };
    $('stQs').onclick = async () => {
      if (qf.text.trim().length < 2) return $('stQ').focus();
      try { await H.api('/api/auth?action=help', H.post({ op: 'ask', cat: qf.cat, text: qf.text, img: qf.img })); qf.text = ''; qf.img = ''; hp = null; H.toast('문의를 보냈습니다. 답변이 오면 알림으로 알려 드립니다', 4500); draw(); }
      catch (e) { H.toast(e.message, 4000); }
    };
    if (!hp) loadHp().then(() => sec === 'help' && draw());
  }

  // ---------- 계정·화면 ----------
  function acct(m) {
    const me = H.me() || {};
    m.innerHTML = `<div class="sg2">${pn('계정', '',
      rw('로그인', `카카오 · ${esc(me.nickname || '')}님`, '<a class="sb" href="/api/auth?action=logout&r=/">로그아웃</a>') +
      rw('글씨 크기', '<small>위쪽 [가−][가+]와 같습니다</small>', B('', '가− 작게', '', 'data-fz="-1"') + B('', '가+ 크게', '', 'data-fz="1"')) +
      rw('안내', '<a href="/pro-guide.html" target="_blank" rel="noopener">설명서</a> · <a href="/terms.html" target="_blank" rel="noopener">이용약관</a> · <a href="/privacy.html" target="_blank" rel="noopener"><b>개인정보처리방침</b></a>'))}
      ${pn('운영 회사', '', rw('상호', '주식회사 드림인베스트 · 대표 임승재') + rw('사업자등록번호', '643-87-01035 <small>· 통신판매업 신고 진행 중</small>') + rw('주소', '경기도 파주시 고봉로 755-27 가동 2층 201-116호') + rw('연락처', '02-393-7676 · contact@realmap.online'))}
      ${me.staff ? '' : pn('자료 비우기', '되돌릴 수 없음 · 요금제·사무소 정보·직원은 그대로',
        rw('지울 자료', `<label><input type="checkbox" data-wp="ls"> 매물장 ${H.items().length.toLocaleString()}건 <small>(사진·지도 광고 포함)</small></label><br><label><input type="checkbox" data-wp="hj"> 아파트 장부 호 기록 <small>(담은 단지 목록은 남음)</small></label><br><label><input type="checkbox" data-wp="cu"> 고객관리${Array.isArray(cus) ? ` ${cus.length.toLocaleString()}명` : ''}</label>`) +
        rw('확인', `<input id="stWipeTx" class="si" maxlength="10" placeholder="전체 삭제" autocomplete="off"> <small>'전체 삭제'라고 입력해야 지워집니다</small>`, B('stWipe', '골라서 지우기', 'r')) +
        '<p class="sp-n">테스트로 넣은 자료를 정리할 때 쓰세요. 지우기 전에 [엑셀 → 내려받기]로 받아 두시길 권합니다.</p>', 'q')}
      ${me.op || me.staff ? '' : pn('중개사 서비스 해지', '되돌릴 수 없음', rw('해지', '<small>매물장·사진·지도 광고·단지 장부·고객·사무소 정보가 모두 지워집니다. 먼저 [엑셀]에서 받아 두세요.</small>', B('stQuit', '해지하기', 'r')), 'q')}</div>`;
    m.querySelectorAll('[data-fz]').forEach(b => b.onclick = () => H.fz(+b.dataset.fz));
    if ($('stQuit')) $('stQuit').onclick = () => H.quit();
    if (!cus && !me.staff) loadCu().then(() => sec === 'acct' && !el.contains(document.activeElement) && draw());
    if ($('stWipe')) $('stWipe').onclick = async () => {   // 10/28 자료 비우기
      const pick = [...m.querySelectorAll('[data-wp]:checked')].map(c => c.dataset.wp); if (!pick.length) return H.toast('지울 자료를 골라 주세요');
      if ($('stWipeTx').value.replace(/\s/g, '') !== '전체삭제') { $('stWipeTx').focus(); return H.toast("'전체 삭제'라고 입력해 주세요"); }
      const NM = { ls: `매물장 ${H.items().length.toLocaleString()}건(사진·지도 광고 포함)`, hj: '아파트 장부의 모든 호 기록', cu: '고객관리의 모든 고객' };
      if (!confirm(`정말 지울까요? 되돌릴 수 없습니다.\n\n${pick.map(k => '· ' + NM[k]).join('\n')}`)) return;
      try { await H.api('/api/auth?action=wipe', H.post({ ...Object.fromEntries(pick.map(k => [k, true])), confirm: '전체 삭제' })); alert('지웠습니다. 화면을 새로 불러옵니다.'); location.reload(); }
      catch (e) { H.toast(e.message, 4000); }
    };
  }
  // ---------- 직원 자리 추가 (유료 요금제 쓰는 중) ----------
  function seatPanel() {
    const P = H.plan() || {}, now = new Date().toISOString();
    if (!PRICE[P.plan] || !(P.until > now)) return '';
    const mon = Math.max(1, Math.ceil((new Date(P.until) - Date.now()) / (30 * 864e5)));
    return pn('직원 자리', `지금 ${P.seats || 0}명 · 직원 관리에서 승인할 수 있는 수`,
      rw('기간 중 추가', `<span class="sstep">${B('', '−', '', 'data-an="-1"')}<b>${pf.add}명</b>${B('', '+', '', 'data-an="1"')}</span> <small>× ${SEAT.toLocaleString()}원 × 남은 ${mon}개월 (${ymd(P.until)}까지)</small>`, `<b class="amt">${(SEAT * pf.add * mon).toLocaleString()}원</b> ${B('stSeat', '입금했어요 · 신청', 'y')}`) +
      '<p class="sp-n">요금제를 새로 신청(연장)할 때는 아래 신청서의 [직원 자리]에서 같이 고르시면 됩니다.</p>', 'mt');
  }

  // ---------- 직원 관리 (10/28) — 대표만 ----------
  //   초대 링크(7일) → 직원이 카카오 로그인·휴대폰 인증 후 신청 → 대표 승인 → 대표의 장부를 같이 씀 (대표 자료는 옮기지 않음)
  //   중개보조원 ≤ (대표 + 소속공인중개사) × 5 (공인중개사법 제15조 3항) · 직원 자리 = 요금제에서 산 수
  const SEAT = 2900, RN = { ceo: '대표', agt: '소속공인중개사', ast: '중개보조원' };
  async function loadSf() { try { sf = await H.api('/api/auth?action=staff'); } catch (e) { sf = { err: e.message, list: [] }; } }
  const ago = t => { if (!t) return '-'; const m = (Date.now() - new Date(t)) / 60e3; return m < 10 ? '방금' : m < 60 ? `${Math.round(m)}분 전` : m < 1440 ? `${Math.round(m / 60)}시간 전` : `${Math.round(m / 1440)}일 전`; };
  const okc = v => v ? '<span class="ok">✓</span>' : '<span class="no">–</span>';
  function staff(m) {
    if (!sf) { m.innerHTML = '<p class="sp-e">불러오는 중…</p>'; return; }
    if (sf.err) { m.innerHTML = `<p class="sp-e">${esc(sf.err)}</p>`; return; }
    const b = H.bk() || {}, pm = sf.perm || {}, L = sf.list || [], on = L.filter(x => x.st === 'on'), wait = L.filter(x => x.st === 'wait');
    const agt = on.filter(x => x.role === 'agt').length, link = sf.inv ? `${location.origin}/j/${sf.inv.code}` : '';
    const can = r => r === 'agt' ? { pub: pm.agtPub !== false, del: pm.agtDel !== false } : { pub: false, del: pm.astDel === true };
    const kp = (t, v, c = '') => `<div class="sk ${c}"><small>${t}</small><b>${v}</b></div>`;
    const tag = r => `<span class="tg ${r === 'ceo' ? 'n' : r === 'agt' ? 'bl' : 'y'}">${RN[r]}</span>`;
    const row = x => { const c = can(x.role); return `<tr><td><b>${esc(x.name)}</b>${x.nick && x.nick !== x.name ? ` <small>카카오 ${esc(x.nick)}</small>` : ''}</td><td>${tag(x.role)}</td><td>${esc(x.phone)}</td><td>${okc(1)}</td><td>${okc(c.pub)}</td><td>${okc(c.del)}</td><td>${okc(0)}</td><td>${ago(x.seen)}</td>
      <td class="act">${B('', x.role === 'agt' ? '보조원으로' : '소속공인중개사로', '', `data-role="${esc(x.uid)}" data-r="${x.role === 'agt' ? 'ast' : 'agt'}"`)}${B('', '내보내기', 'r', `data-out="${esc(x.uid)}"`)}</td></tr>`; };
    m.innerHTML = pn('직원 현황', `중개보조원은 (대표 + 소속공인중개사) × 5명까지 · 공인중개사법 제15조`,
      `<div class="sks">${kp('대표(개업공인중개사)', 1)}${kp('소속공인중개사', agt)}${kp('중개보조원', `${sf.astN} / ${sf.astMax}`, sf.astN > sf.astMax ? 'r' : '')}${kp('승인 대기', wait.length, wait.length ? 'y' : '')}${kp('직원 자리', `${sf.used} / ${sf.seats >= 99 ? '∞' : sf.seats}명`, sf.used >= sf.seats && sf.seats < 99 ? 'y' : '')}</div>` +
      (sf.astN > sf.astMax ? `<p class="sp-n warn">중개보조원이 법정 한도(${sf.astMax}명)를 넘었습니다. 소속공인중개사를 더 두거나 보조원 수를 줄여 주세요.</p>` : '') +
      `<table class="st-tb sft"><tr><th>이름</th><th>구분</th><th>휴대폰</th><th>등록·수정</th><th>지도 광고</th><th>삭제</th><th>엑셀 받기</th><th>최근 접속</th><th></th></tr>
       <tr><td><b>${esc(b.ceo || '대표')}</b></td><td>${tag('ceo')}</td><td>${esc(b.mobile || '')}</td><td>${okc(1)}</td><td>${okc(1)}</td><td>${okc(1)}</td><td>${okc(1)}</td><td>지금</td><td></td></tr>
       ${on.map(row).join('')}
       ${wait.map(x => `<tr class="wt"><td><b>${esc(x.name)}</b> <small>${ymdhm(x.at)} 신청 · 휴대폰 인증됨</small></td><td><span class="tg y">승인 대기 · ${RN[x.role]}</span></td><td>${esc(x.phone)}</td><td colspan="5"><small>승인하면 우리 사무소 장부를 같이 씁니다</small></td><td class="act">${B('', '승인', 'n', `data-ok="${esc(x.uid)}"`)}${B('', '거절', '', `data-no="${esc(x.uid)}"`)}</td></tr>`).join('')}</table>` +
      (L.length ? '' : '<p class="sp-e">아직 직원이 없습니다. 아래 초대 링크를 직원에게 보내 주세요.</p>'), '', '') +
      pn('초대 링크', '7일 동안 · 들어온 사람은 대표 승인 뒤에 장부가 열림',
        link ? rw('링크', `<code class="lk">${esc(link)}</code> <small>${ymd(sf.inv.exp)}까지</small>`, B('stLc', '복사') + B('stLs', '카톡·문자로 보내기', 'y') + B('stLn', '새 링크') + B('stLx', '링크 끄기', 'r'))
          : rw('링크', '<small>지금 열린 초대 링크가 없습니다</small>', B('stLn', '초대 링크 만들기', 'y')), 'mt') +
      pn('권한', '구분별로 한꺼번에 · 바꾸면 바로 적용',
        rw('소속공인중개사', `<label><input type="checkbox" data-pm="agtDel" ${pm.agtDel !== false ? 'checked' : ''}> 매물·고객 삭제</label> <label><input type="checkbox" data-pm="agtPub" ${pm.agtPub !== false ? 'checked' : ''}> 리얼맵 지도 광고</label>`) +
        rw('중개보조원', `<label><input type="checkbox" data-pm="astDel" ${pm.astDel ? 'checked' : ''}> 매물·고객 삭제</label> <small>지도 광고는 법으로 안 됨 (제18조의2)</small>`) +
        rw('대표만', '<small>엑셀 받기·불러오기 · 요금 결제 · 사무소 정보 고치기 · 직원 관리 · 해지</small>'), 'mt') +
      pn('알아 두실 점', '', `<p class="sp-n">· 직원이 고친 매물·장부·고객 기록에는 고친 사람 이름이 남습니다. 두 사람이 같은 매물을 동시에 고치면 나중 사람에게 새 내용을 먼저 보여 드립니다.<br>· 내보낸 직원은 바로 장부를 볼 수 없게 됩니다. 직원 개인 카카오 계정에는 자료가 남지 않습니다.<br>· 소속공인중개사·중개보조원을 두거나 내보내면 <b>10일 안에 시·군·구청에 고용·종료 신고</b>를 해야 합니다 (공인중개사법 제15조 1항).</p>`, 'mt');
    const act = async (body, msg) => { try { sf = await H.api('/api/auth?action=staff', H.post(body)); if (msg) H.toast(msg); draw(); } catch (e) { H.toast(e.message, 5000); } };
    m.querySelectorAll('[data-ok]').forEach(x => x.onclick = () => act({ op: 'ok', uid: x.dataset.ok }, '승인했습니다. 이제 같은 장부를 씁니다'));
    m.querySelectorAll('[data-no]').forEach(x => x.onclick = () => confirm('이 신청을 거절할까요?') && act({ op: 'no', uid: x.dataset.no }, '거절했습니다'));
    m.querySelectorAll('[data-role]').forEach(x => x.onclick = () => act({ op: 'role', uid: x.dataset.role, role: x.dataset.r }, '구분을 바꿨습니다'));
    m.querySelectorAll('[data-out]').forEach(x => x.onclick = () => { const s = L.find(y => y.uid === x.dataset.out); if (confirm(`${s ? s.name : ''}님을 내보낼까요?\n바로 우리 사무소 장부를 볼 수 없게 됩니다. (고친 기록은 그대로 남습니다)`)) act({ op: 'out', uid: x.dataset.out }, '내보냈습니다. 10일 안에 고용 종료 신고를 해 주세요'); });
    m.querySelectorAll('[data-pm]').forEach(x => x.onchange = () => { const p = { ...pm }; m.querySelectorAll('[data-pm]').forEach(y => { p[y.dataset.pm] = y.checked; }); act({ op: 'perm', ...p }, '권한을 바꿨습니다'); });
    $('stLn').onclick = () => (!link || confirm('새 링크를 만들면 지금 링크는 더 이상 쓸 수 없습니다. 만들까요?')) && act({ op: 'inv' }, '초대 링크를 만들었습니다');
    if ($('stLx')) $('stLx').onclick = () => confirm('초대 링크를 끌까요? 이미 신청한 사람은 그대로 남습니다.') && act({ op: 'invoff' }, '링크를 껐습니다');
    if ($('stLc')) $('stLc').onclick = async () => { try { await navigator.clipboard.writeText(link); H.toast('링크를 복사했습니다. 카톡에 붙여 넣어 보내 주세요'); } catch { prompt('링크를 복사해 주세요', link); } };
    const msg = `[리얼맵 중개장부] ${b.office || ''} 직원으로 초대합니다.\n아래 링크를 열고 카카오로 로그인한 뒤 이름·휴대폰 인증을 해 주세요. 대표 승인 뒤에 같은 장부를 씁니다.\n${link}`;
    if ($('stLs')) $('stLs').onclick = async () => { if (navigator.share) { try { await navigator.share({ text: msg }); } catch { /* 닫음 */ } } else { try { await navigator.clipboard.writeText(msg); H.toast('초대 글을 복사했습니다. 카톡·문자에 붙여 넣어 보내 주세요', 4000); } catch { prompt('복사해 주세요', msg); } } };
  }
  // ---------- 내 소속 (직원 화면) ----------
  function mine(m) {
    const me = (H.me() || {}).staff || {}, b = H.bk() || {}, pm = (H.team && H.team() && H.team().perm) || {};
    const c = me.role === 'agt' ? { pub: pm.agtPub !== false, del: pm.agtDel !== false } : { pub: false, del: pm.astDel === true };
    m.innerHTML = `<div class="sg2">${pn('내 소속', '',
      rw('사무소', `<b>${esc(me.office || b.office || '')}</b> · 대표 ${esc(b.ceo || '')}`) + rw('나', `${esc(me.name || '')} <span class="tg ${me.role === 'agt' ? 'bl' : 'y'}">${RN[me.role] || ''}</span>`) +
      rw('할 수 있는 일', `매물·장부·고객 등록·수정 ${okc(1)} · 지도 광고 ${okc(c.pub)} · 삭제 ${okc(c.del)} · 엑셀 받기 ${okc(0)}`) +
      rw('권한 바꾸기', '<small>대표님이 [설정 → 직원 관리]에서 정합니다</small>'))}
      ${pn('사무소에서 나가기', '', rw('나가기', '<small>나가면 이 사무소 장부를 더 볼 수 없습니다. 내 카카오 계정에는 자료가 남지 않습니다.</small>', B('stLeave', '나가기', 'r')), 'q')}</div>`;
    $('stLeave').onclick = async () => { if (!confirm(`${me.office || '이 사무소'}에서 나갈까요?`)) return; try { await H.api('/api/auth?action=staff', H.post({ op: 'leave' })); location.replace('/pro.html'); } catch (e) { H.toast(e.message, 4000); } };
  }

  // ---------- 10/30 운영자: 단지 평형표 — 단지마다 전용면적 → 공급평·타입 (모든 회원 아파트 화면에 공통 적용) ----------
  //   단지 검색(카카오) → 필지 PNU → 동 목록(/api/units scan) → 동마다 호별 전용면적(/api/units areas) → 면적별 호 수
  //   저장: /api/auth?action=pyt (운영자만) · 회원이 라인·호에 직접 적은 값이 있으면 그게 먼저
  const PT = { q: '', res: null, cur: null, list: null, busy: '', gu: '11440', guList: null, bulk: '' };
  const estPy = a => Math.round(a * (a <= 60 ? 1.36 : a <= 85 ? 1.33 : 1.27) / 3.3058);
  // 10/30 서울 아파트 면적 데이터베이스 (data/apt/<구>.json · GitHub Actions apt-db가 만듦) — 단지를 열면 대장 값이 미리 채워짐
  const GUS = { '11110': '종로구', '11140': '중구', '11170': '용산구', '11200': '성동구', '11215': '광진구', '11230': '동대문구', '11260': '중랑구', '11290': '성북구', '11305': '강북구', '11320': '도봉구', '11350': '노원구', '11380': '은평구', '11410': '서대문구', '11440': '마포구', '11470': '양천구', '11500': '강서구', '11530': '구로구', '11545': '금천구', '11560': '영등포구', '11590': '동작구', '11620': '관악구', '11650': '서초구', '11680': '강남구', '11710': '송파구', '11740': '강동구' };
  const DBC = {};
  const aptDb = gu => DBC[gu] || (DBC[gu] = fetch(`/data/apt/${gu}.json`).then(r => r.ok ? r.json() : null).catch(() => null));
  function pyt(m) {
    if (!isOp()) { m.innerHTML = ''; return; }
    const c = PT.cur;
    const rows = c && c.rows ? c.rows : [];
    const pyOf = r => { const v = c.val[r.k] || {}; return v.py || r.dpy || ''; };
    const tbl = c ? (rows.length ? `<table class="st-tb pyt"><tr><th><input type="checkbox" id="ptAll"></th><th>전용면적</th><th>공급면적</th><th>공급평</th><th>세대</th><th>타입</th><th>평면도</th><th>지금 회원 화면</th><th></th></tr>${rows.map((r, i) => {
      const v = c.val[r.k] || {}, py = pyOf(r), fromDb = !v.py && r.dpy;
      const now = py ? `<span class="ok">${py}평${v.t ? ' · ' + esc(v.t) : ''}</span>` : `<i class="em">${estPy(r.a)}평 (추정)</i>`;
      return `<tr><td><input type="checkbox" data-ck="${i}"></td><td><b>${(+r.a || parseFloat(r.k)).toFixed(2)}㎡</b>${r.sub ? '<br><small class="em" title="같은 전용에서 세대 수가 가장 많은 줄의 값이 회원 화면에 나갑니다">회원 화면엔 세대 많은 줄 값</small>' : ''}</td><td>${r.sup ? r.sup + '㎡' : '<i class="em">대장에 없음</i>'}</td><td><input class="si${fromDb ? ' db' : ''}" style="width:52px" data-py="${i}" value="${py}" placeholder="${estPy(r.a)}" inputmode="numeric" maxlength="3"> 평</td><td>${r.n ? r.n.toLocaleString() : '<i class="em">직접 추가</i>'}</td><td><input class="si" style="width:64px" data-ty="${i}" value="${esc(v.t || '')}" placeholder="예: 59A" maxlength="8"></td>
        <td>${v.img ? `<a href="${esc(v.img)}" target="_blank" rel="noopener"><img class="pti" src="${esc(v.img)}" alt=""></a> <button type="button" class="sb r" data-imx="${i}">×</button>` : `<label class="sb" for="ptI${i}">＋ 올리기</label><input type="file" id="ptI${i}" data-img="${i}" accept="image/*" hidden>`}</td><td>${now}</td><td>${r.n ? '' : `<button type="button" class="sb r" data-rm="${i}">빼기</button>`}</td></tr>`;
    }).join('')}</table>
      <div class="sr"><b>같은 타입 묶기</b><span>체크한 줄을 <input class="si" id="ptBulk" style="width:70px" placeholder="예: 59A" maxlength="8" value="${esc(PT.bulk)}"> 타입으로 ${B('ptBulkB', '적용')}</span><span class="a"><small>같은 타입으로 적은 줄은 평면도도 같이 씁니다</small></span></div>` : `<p class="sp-e">${PT.busy || '전용면적을 받지 못했습니다. 아래에서 직접 추가해 주세요.'}</p>`) : '';
    const L = PT.list, G = PT.guList;
    const done = new Set((L || []).map(x => x.pnu));
    m.innerHTML = `${pn('단지 평형표', '운영자만 보입니다 · 저장하면 모든 회원 화면에 바로 적용', `
      <div class="sr"><b>단지 찾기</b><span><input class="si" id="ptQ" style="width:260px" placeholder="단지 이름이나 주소 (예: ○○래미안)" value="${esc(PT.q)}"> ${B('ptGo', '찾기', 'n')}</span><span></span></div>
      ${PT.res ? `<div class="sp-n">${PT.res.length ? PT.res.map((r, i) => `<button type="button" class="sb" data-pr="${i}" style="margin:2px 4px 2px 0">${esc(r.t)} <small style="font-weight:500;color:#94A0AD">&nbsp;${esc(r.s)}</small></button>`).join('') : '검색 결과가 없습니다.'}</div>` : ''}`)}
      ${c ? pn(esc(c.n || '이름 없는 단지'), `${esc(c.addr || '')}${c.y ? ` · ${c.y}년` : ''}${c.h ? ` · ${c.h.toLocaleString()}세대` : ''}${c.dn ? ` · ${c.dn}개 동` : ''}${c.db ? ' · <span class="tg bl">건축물대장 자동</span>' : ''}${c.nosup ? ' · <span class="tg y">대장에 공용면적 없음 — 공급평 직접</span>' : ''}`, `${tbl}
        <div class="sr"><b>면적 직접 추가</b><span><input class="si" id="ptAdd" style="width:90px" placeholder="예: 84.97" inputmode="decimal"> ㎡ ${B('ptAddB', '추가')}</span><span class="a">${B('ptSave', PT.busy ? '불러오는 중…' : '저장', 'y', PT.busy || !c.ok ? 'disabled' : '')}${c.saved ? B('ptDel', '이 단지 평형표 지우기', 'r') : ''}</span></div>
        <p class="sp-n">파란 칸은 건축물대장으로 계산한 공급평입니다(고칠 수 있음). 회원이 라인·호에 직접 적은 평형이 있으면 그 값이 먼저입니다.</p>`) : ''}
      ${pn('단지 목록', `<select class="si" id="ptGu" style="width:120px">${Object.entries(GUS).map(([k, n]) => `<option value="${k}" ${PT.gu === k ? 'selected' : ''}>${n}</option>`).join('')}</select>${G && G.cx ? ` · ${Object.keys(G.cx).length}곳 · 입력 ${Object.keys(G.cx).filter(p => done.has(p)).length}곳` : ''}`,
        G === undefined || G === 'loading' ? '<p class="sp-e">불러오는 중…</p>' : !G ? '<p class="sp-e">이 구는 아직 데이터베이스가 없습니다. GitHub Actions의 realmap-apt-db에서 이 구 코드로 실행해 주세요.</p>'
        : `<div class="ptl">${Object.entries(G.cx).filter(([, v]) => v.t && v.t.length).sort((a, b) => b[1].h - a[1].h).map(([p, v]) => `<button type="button" class="sb${done.has(p) ? ' dn' : ''}" data-pg="${p}">${esc(v.n)} <small>${v.h}세대${done.has(p) ? ' · ✓' : ''}</small></button>`).join('')}</div>`)}
      ${pn('입력한 단지', L ? `${L.length}곳` : '', L ? tb(['단지', '면적 수', '고친 날', ''], L.map((x, i) => `<tr><td>${esc(x.n || x.pnu)}</td><td>${x.k}</td><td>${ymd(x.at)}</td><td><button type="button" class="sb" data-pl="${i}">열기</button></td></tr>`), '아직 입력한 단지가 없습니다.') : '<p class="sp-e">불러오는 중…</p>')}`;
    m.querySelectorAll('[data-pl]').forEach(b => b.onclick = () => { const x = PT.list[+b.dataset.pl]; ptOpen({ pnu: x.pnu, t: x.n }); window.scrollTo(0, 0); });
    const q = $('ptQ'), go = () => ptSearch(q.value.trim());
    q.onkeydown = e => { if (e.key === 'Enter' && !e.isComposing) go(); }; $('ptGo').onclick = go;
    m.querySelectorAll('[data-pr]').forEach(b => b.onclick = () => ptOpen(PT.res[+b.dataset.pr]));
    m.querySelectorAll('[data-pg]').forEach(b => b.onclick = () => { ptOpen({ pnu: b.dataset.pg, t: G.cx[b.dataset.pg].n }); window.scrollTo(0, 0); });
    $('ptGu').onchange = e => { PT.gu = e.target.value; PT.guList = 'loading'; draw(); aptDb(PT.gu).then(d => { PT.guList = d; if (sec === 'pyt') draw(); }); };
    if (G === undefined) { PT.guList = 'loading'; aptDb(PT.gu).then(d => { PT.guList = d; if (sec === 'pyt') draw(); }); }
    const keep = () => m.querySelectorAll('[data-py],[data-ty]').forEach(i => { const r = rows[+(i.dataset.py ?? i.dataset.ty)], v = c.val[r.k] || (c.val[r.k] = {}); if (i.dataset.py != null) { const n = +(i.value.replace(/\D/g, '') || 0) || ''; v.py = n && n !== r.dpy ? n : ''; } else v.t = i.value.trim(); });
    m.querySelectorAll('[data-py],[data-ty]').forEach(i => { i.oninput = keep; i.onkeydown = e => { if (e.key === 'Enter' && !e.isComposing) ptSave(); }; });
    if ($('ptAll')) $('ptAll').onchange = e => m.querySelectorAll('[data-ck]').forEach(x => { x.checked = e.target.checked; });
    if ($('ptBulkB')) $('ptBulkB').onclick = () => { keep(); const t = $('ptBulk').value.trim(); PT.bulk = t; const ck = [...m.querySelectorAll('[data-ck]:checked')].map(x => rows[+x.dataset.ck]); if (!ck.length) return H.toast('묶을 줄을 먼저 체크해 주세요'); if (!t) return H.toast('타입 이름을 적어 주세요 (예: 59A)'); ck.forEach(r => { (c.val[r.k] = c.val[r.k] || {}).t = t; }); draw(); };
    m.querySelectorAll('[data-rm]').forEach(b => b.onclick = () => { keep(); const r = rows[+b.dataset.rm]; delete c.val[r.k]; c.rows = rows.filter(z => z !== r); draw(); });
    m.querySelectorAll('[data-imx]').forEach(b => b.onclick = () => { keep(); const r = rows[+b.dataset.imx], v = c.val[r.k]; const t = v && v.t; rows.forEach(z => { const w = c.val[z.k]; if (w && (z === r || (t && w.t === t))) delete w.img; }); draw(); });
    m.querySelectorAll('[data-img]').forEach(inp => inp.onchange = async e => {
      keep(); const f = e.target.files[0]; e.target.value = ''; if (!f) return; const r = rows[+inp.dataset.img];
      try {
        const src = await createImageBitmap(f), k = Math.min(1, 1800 / Math.max(src.width, src.height)), cv = document.createElement('canvas');
        cv.width = Math.round(src.width * k); cv.height = Math.round(src.height * k); const g = cv.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, cv.width, cv.height); g.drawImage(src, 0, 0, cv.width, cv.height);
        const j = await H.api('/api/auth?action=listing&op=photo', H.post({ data: cv.toDataURL('image/jpeg', 0.88) }));
        const v = c.val[r.k] = c.val[r.k] || {}; v.img = j.url;
        if (v.t) rows.forEach(z => { const w = c.val[z.k]; if (w && w.t === v.t && !w.img) w.img = j.url; });   // 같은 타입 줄에도
        H.toast('평면도를 올렸습니다. [저장]을 눌러야 회원 화면에 들어갑니다', 3500); draw();
      } catch (er) { H.toast(er.message || '사진을 올리지 못했습니다', 4000); }
    });
    if ($('ptAddB')) $('ptAddB').onclick = () => { keep(); const a = Math.round(parseFloat($('ptAdd').value) * 100) / 100; if (!(a > 5 && a < 500)) return H.toast('전용면적을 84.97처럼 ㎡로 적어 주세요'); const k = a.toFixed(2); if (!rows.some(r => r.k === k)) { c.rows = [...rows, { k, a, n: 0 }].sort((x, y) => x.a - y.a); } draw(); };
    if ($('ptSave')) $('ptSave').onclick = () => { keep(); ptSave(); };
    if ($('ptDel')) $('ptDel').onclick = async () => { if (!confirm('이 단지의 평형표를 지울까요? 회원 화면은 다시 데이터베이스·추정값으로 나옵니다.')) return; try { await H.api('/api/auth?action=pyt', H.post({ pnu: c.pnu, a: {} })); c.val = {}; c.saved = false; PT.list = null; H.toast('지웠습니다'); draw(); } catch (e) { H.toast(e.message, 4000); } };
    if (!L) H.api('/api/auth?action=pyt&all=1').then(j => { PT.list = j.list || []; if (sec === 'pyt') draw(); }).catch(() => { PT.list = []; });
  }
  function ptSearch(q) {
    PT.q = q; if (!q) return;
    if (!(window.kakao && kakao.maps && kakao.maps.services)) return H.toast('검색을 준비하고 있습니다. 잠시 후 다시 눌러 주세요');
    new kakao.maps.services.Places().keywordSearch(q, (r, st) => { PT.res = st === 'OK' ? r.slice(0, 8).map(a => ({ t: a.place_name, s: a.address_name, lat: +a.y, lng: +a.x })) : []; draw(); });
  }
  async function ptOpen(r) {
    PT.res = null; PT.busy = '단지 정보를 확인하는 중…';
    const c = PT.cur = { n: r.t || '', addr: r.s || '', pnu: r.pnu || '', rows: [], val: {}, dn: 0, saved: false }; draw();
    try {
      if (!c.pnu) { const p = await H.api(`/api/parcel?lat=${r.lat}&lng=${r.lng}`); c.pnu = p.bldPnu || p.pnu; c.addr = p.addr || c.addr; }
      const j = await H.api(`/api/auth?action=pyt&p=${c.pnu}&_=${Date.now()}`), v = (j.map || {})[c.pnu];   // 10/31 방금 저장한 값을 받도록 (60초 캐시 건너뜀)
      c.ok = true;   // 10/31 저장해 둔 평형표를 받은 뒤에만 [저장] 가능
      if (v) { c.val = JSON.parse(JSON.stringify(v.a || {})); c.saved = true; if (!c.n) c.n = v.n || ''; }
      // 10/30 데이터베이스에 있으면 그대로 (대장 공급면적·공급평 · 소수점이 다른 전용은 모두 따로)
      const db = await aptDb(c.pnu.slice(0, 5)), e = db && db.cx && db.cx[c.pnu];
      if (e && e.t && e.t.length) {
        Object.assign(c, { db: true, y: e.y, h: e.h, dn: e.d, nosup: !!e.nosup }); if (!c.n) c.n = e.n;
        // 10/31 같은 전용에 공급면적이 다른 줄이 여럿이면: 세대 수가 가장 많은 줄 = '전용'(회원 화면에 나가는 값) · 나머지 줄 = '전용|공급'으로 따로 저장 (회원 화면엔 안 나감)
        const top = {}; e.t.forEach(z => { if (!top[z.ex] || z.h > top[z.ex].h) top[z.ex] = z; });
        c.rows = e.t.map(z => ({ k: top[z.ex] === z ? z.ex.toFixed(2) : `${z.ex.toFixed(2)}|${(+z.sup || 0).toFixed(2)}`, a: z.ex, sup: z.sup, dpy: z.py || '', n: z.h, sub: top[z.ex] !== z }));
        Object.keys(c.val).filter(kk => !c.rows.some(z => z.k === kk)).forEach(kk => c.rows.push({ k: kk, a: parseFloat(kk), sup: +kk.split('|')[1] || null, n: 0, sub: kk.includes('|') }));
        c.rows.sort((x, y) => x.a - y.a || (x.sup || 0) - (y.sup || 0));
        c.rows.forEach(r => { const v = c.val[r.k]; if (v && v.py && v.py === r.dpy) v.py = ''; });   // 저장값이 대장 값과 같으면 파란 칸으로
        PT.busy = ''; if (PT.cur === c && sec === 'pyt') draw(); return;
      }
      // 동 목록
      PT.busy = '동 목록을 받는 중…'; if (PT.cur === c) draw();
      const dongs = new Set(); let from = 1;
      for (let i = 0; i < 80; i++) {
        const s = await H.api(`/api/units?pnu=${c.pnu}&scan=1&from=${from}`);
        if (s.cached) { (s.dongs || []).forEach(d => d && dongs.add(d)); break; }
        (s.items || []).forEach(x => { const d = String(x.dongNm || '').trim(); if (d) dongs.add(d); });
        if (s.done || !s.pages) break; from = s.next || from + 1;
        if (PT.cur !== c) return;
      }
      c.dn = dongs.size;
      // 동마다 호별 전용면적 → 면적별 호 수
      const cnt = new Map(), D = [...dongs]; let k = 0;
      const one = async () => { while (k < D.length) { const d = D[k++]; PT.busy = `호별 전용면적을 받는 중… (${k}/${D.length}동)`; if (PT.cur === c && sec === 'pyt') draw(); try { const a = (await H.api(`/api/units?pnu=${c.pnu}&dong=${encodeURIComponent(d)}&areas=1`)).areas || {}; Object.values(a).forEach(x => { if (x > 5) { const kk = (+x).toFixed(2); cnt.set(kk, (cnt.get(kk) || 0) + 1); } }); } catch { /* 그 동은 건너뜀 */ } } };
      await Promise.all([one(), one(), one()]);
      const ks = new Set([...cnt.keys(), ...Object.keys(c.val)]);
      c.rows = [...ks].map(kk => ({ k: kk, a: +kk, n: cnt.get(kk) || 0 })).sort((x, y) => x.a - y.a);
      PT.busy = '';
    } catch (e) { PT.busy = ''; H.toast(e.message || '단지를 열지 못했습니다', 4000); }
    if (PT.cur === c && sec === 'pyt') draw();
  }
  async function ptSave() {
    const c = PT.cur; if (!c || !c.pnu) return;
    // 10/31 고침: 불러오는 중이거나 불러오지 못했을 때 저장하면 평형표가 통째로 지워지던 것
    if (PT.busy) return H.toast('단지 정보를 불러오는 중입니다. 다 불러온 뒤에 저장해 주세요.');
    if (!c.ok) return H.toast('저장해 둔 평형표를 불러오지 못해 저장하지 않았습니다. 단지를 다시 열어 주세요.', 4000);
    // 10/30 공급평: 직접 고친 값 → 없으면 데이터베이스 값 · 같은 타입은 평면도를 같이
    const imgOf = {}; Object.values(c.val).forEach(v => { if (v && v.t && v.img) imgOf[v.t] = imgOf[v.t] || v.img; });
    const a = {};
    const rows = [...c.rows, ...Object.keys(c.val).filter(k => !c.rows.some(r => r.k === k)).map(k => ({ k }))];   // 10/31 목록에 아직 없는 저장값도 그대로 보존
    for (const r of rows) { const v = c.val[r.k] || {}, py = +v.py || +r.dpy || 0, img = v.img || (v.t && imgOf[v.t]) || ''; if (py || v.t || img) a[r.k] = { py, t: v.t || '', img }; }
    try { const j = await H.api('/api/auth?action=pyt', H.post({ pnu: c.pnu, n: c.n, a })); c.val = JSON.parse(JSON.stringify(j.a || {})); c.rows.forEach(r => { const v = c.val[r.k]; if (v && v.py === r.dpy) v.py = ''; }); c.saved = !!Object.keys(c.val).length; PT.list = null; H.toast(c.saved ? '저장했습니다. 모든 회원 화면에 적용됩니다' : '비어 있어 이 단지 평형표를 지웠습니다', 3000); draw(); }
    catch (e) { H.toast(e.message, 4000); }
  }
  return { mount, refresh, stale, go };
})();
