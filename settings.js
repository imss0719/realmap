// 리얼맵 중개장부 · 설정 (10/26)
// [매물] [고객관리] [설정] — 가끔 쓰는 기능을 한곳에: 우리 사무소 · 엑셀(불러오기·양식·기록·내려받기) · 요금제 · 계정·화면 · 직원 관리(준비 중)
// 엑셀 내려받기는 대표 휴대폰 인증 한 번에 한 번 (서버가 인증할 때 기록을 남김: /api/auth?action=xlog)
// host = { api, post, toast, me(), bk(), plan(), items(), canPub(), openBk(), importXl(), quit(), xlGate(info, fn), exportLs(), fz(d) }
window.Sett = (() => {
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const MENU = [['office', '우리 사무소', '정보·광고 표시'], ['excel', '엑셀', '불러오기·내려받기'], ['plan', '요금제', ''], ['acct', '계정·화면', '']];
  let H = null, el = null, sec = 'office', log = null, cxs = null, cus = null; const off = new Set();   // off: 내려받기에서 체크를 푼 단지
  const ymdhm = t => { const d = new Date(new Date(t).getTime() + 9 * 3600e3).toISOString(); return `${d.slice(2, 4)}.${d.slice(5, 7)}.${d.slice(8, 10)} ${d.slice(11, 16)}`; };
  const ymd = t => t ? String(t).slice(0, 10).replace(/-/g, '.') : '';
  const csv = (name, head, rows) => {
    const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + [head, ...rows].map(r => r.map(q).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' }));
    a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
  const today = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);

  function mount(box, host) { H = host; el = box; try { sec = localStorage.getItem('rm.set') || 'office'; } catch { /* 무시 */ } if (!MENU.some(m => m[0] === sec)) sec = 'office'; draw(); }
  function refresh() { if (el) draw(); }
  function stale() { log = null; cxs = null; cus = null; if (el && !el.hidden) draw(); }   // 엑셀 불러오기 뒤 기록·숫자 새로
  function go(s) { sec = s; try { localStorage.setItem('rm.set', s); } catch { /* 무시 */ } draw(); }
  function draw() {
    el.innerHTML = `<div class="st-w"><nav class="st-n">${MENU.map(([k, t, d]) => `<button type="button" data-s="${k}" aria-pressed="${sec === k}"><b>${t}</b><small>${k === 'plan' ? esc((H.plan() || {}).name || '') : d}</small></button>`).join('')}
      <hr><button type="button" class="off" disabled><b>직원 관리</b><small>준비 중</small></button></nav><div class="st-m" id="stM"></div></div>`;
    el.querySelectorAll('[data-s]').forEach(b => b.onclick = () => go(b.dataset.s));
    ({ office, excel, plan, acct })[sec]($('stM'));
  }

  // ---------- 우리 사무소 ----------
  function office(m) {
    const b = H.bk() || {}, f = (t, v, x = '') => `<span>${t}</span><div>${v ? esc(v) : '<i>비어 있음</i>'}${x}</div>`;
    const mob = b.mobile ? (b.mobileOk && String(b.mobileOk).replace(/\D/g, '') === String(b.mobile).replace(/\D/g, '') ? ' <em class="ok">인증됨</em>' : ' <em class="no">인증 필요</em>') : '';
    m.innerHTML = `<section class="st-c"><h2>중개사무소 정보 ${b.verified ? '<em class="ok">등록 확인됨 ✓</em>' : b.office ? '<em class="no">확인 전</em>' : ''}</h2>
      <p class="st-d">국가공간정보(브이월드) 중개업 등록 정보와 맞춰 확인합니다. 등록번호·대표자를 바꾸면 다시 확인합니다.</p>
      <div class="st-f">${f('상호', b.office)}${f('대표자', b.ceo)}${f('등록번호', b.regno)}${f('주소', b.addr)}${f('사무실 전화', b.tel)}${f('대표 휴대폰', b.mobile, mob)}</div>
      <div class="st-r"><button type="button" class="st-b y" id="stBk">정보 고치기 · 사진 · 휴대폰 인증</button></div></section>
      ${H.canPub() ? `<section class="st-c"><h2>리얼맵 지도 광고 표시</h2><p class="st-d">지도에 올린 매물 광고에 이렇게 나갑니다 (공인중개사법 표시·광고 항목). 바꾸려면 위 [정보 고치기]에서 고치세요.</p>
      <div class="st-pv"><b>${esc(b.office || '')}</b> · 대표 ${esc(b.ceo || '')} · 등록번호 ${esc(b.regno || '')}<br>${esc(b.addr || '')}${b.tel ? ` · ☎ ${esc(b.tel)}` : ''}</div>
      <p class="st-d" style="margin-top:8px">지금 지도에 게시 중: <b>${H.items().filter(x => x.pub && x.pub.on && x.status === 'on' && x.pub.exp > new Date().toISOString()).length}건</b></p></section>` : ''}`;
    $('stBk').onclick = () => H.openBk();
  }

  // ---------- 엑셀 ----------
  async function loadLog() { try { log = await H.api('/api/auth?action=xlog'); } catch (e) { log = { dl: [], im: [], err: e.message }; } }
  async function loadCx() { try { cxs = (await H.api('/api/auth?action=cx')).items || []; } catch { cxs = []; } }
  async function loadCu() { try { cus = (await H.api('/api/auth?action=cu')).items || []; } catch (e) { cus = { err: e.message }; } }
  function excel(m) {
    const P = H.plan() || {}, n = H.items().length;
    const im = (log && log.im) || [], dl = (log && log.dl) || [];
    m.innerHTML = `<section class="st-c"><h2>엑셀 불러오기</h2><p class="st-d">쓰시던 엑셀 매물장·아파트 장부를 한 번에 옮깁니다. 파일 양식을 보고 매물장 또는 아파트 단지 장부로 알아서 나눕니다.</p>
      <div class="st-g"><div class="st-t"><b>📥 엑셀 불러오기</b><span>xlsx · xls · csv. 다른 매물장 프로그램에서 받은 파일도 됩니다. 아파트 장부(동·호별)는 단지 주소 칸이 있어야 합니다.</span><button type="button" class="st-b y" id="stIm">파일 고르기</button></div>
        <div class="st-t"><b>📄 빈 양식 · 매물장</b><span>주소·종류·거래·가격·면적·층·소유자·연락처·메모 칸이 있는 리얼맵용 양식</span><button type="button" class="st-b" data-tpl="ls">양식 받기</button></div>
        <div class="st-t"><b>📄 빈 양식 · 아파트 장부</b><span>주소·물건명·동·호·부동산명·거래구분·의뢰가격·현상태·만기일·소유주 칸</span><button type="button" class="st-b" data-tpl="hj">양식 받기</button></div></div>
      <h3>불러온 기록</h3>${!log ? '<p class="st-d">불러오는 중…</p>' : im.length ? `<table class="st-tb"><tr><th>날짜</th><th>파일</th><th>넣은 곳</th><th>건수</th><th></th></tr>${im.map(e => `<tr><td>${ymdhm(e.at)}</td><td>${esc(e.file)}</td><td>${e.to === 'hj' ? `단지 장부${e.names ? ' · ' + esc(e.names) : ''}` : '매물장'}</td><td>${e.n.toLocaleString()}${e.to === 'hj' ? '호' : '건'}</td><td>${e.undone ? `<small>되돌림 ${ymdhm(e.undone)}</small>` : `<button type="button" class="st-x" data-undo="${esc(e.id)}">되돌리기</button>`}</td></tr>`).join('')}</table>` : '<p class="st-d">아직 불러온 적이 없습니다.</p>'}</section>
      <section class="st-c"><h2>엑셀 내려받기</h2><p class="st-d">매물·연락처가 담긴 파일이라 <b>대표님 휴대폰${H.bk() && H.bk().mobile ? ` (${esc(String(H.bk().mobile).replace(/^(\d{3})-?(\d{3,4})-?(\d{4})$/, '$1-****-$3'))})` : ''}</b>으로 인증한 뒤 받습니다. <b>인증 한 번에 한 번</b> 받을 수 있고, 받은 기록이 아래에 남습니다.</p>
      <div class="st-g"><div class="st-t"><b>매물장 전체</b><span>진행 중·보류·거래완료 모두 · ${n.toLocaleString()}건</span><button type="button" class="st-b n" id="stDlLs" ${n ? '' : 'disabled'}>내려받기</button></div>
        <div class="st-t"><b>아파트 단지 장부</b><span id="stCx">${cxs ? cxs.length ? cxs.map(c => `<label><input type="checkbox" data-cx="${esc(c.id)}" ${off.has(c.id) ? '' : 'checked'}> ${esc(c.name)}</label>`).join('') : '담은 단지가 없습니다' : '단지 목록을 불러오는 중…'}</span><button type="button" class="st-b n" id="stDlHj" ${cxs && cxs.length ? '' : 'disabled'}>고른 단지 내려받기</button></div>
        <div class="st-t"><b>고객 목록</b><span>${cus ? cus.err ? esc(cus.err) : `고객 ${cus.length.toLocaleString()}명 · 찾는 조건·연락처` : '불러오는 중…'}</span><button type="button" class="st-b n" id="stDlCu" ${Array.isArray(cus) && cus.length ? '' : 'disabled'}>내려받기</button></div></div>
      <h3>내려받은 기록</h3>${!log ? '' : dl.length ? `<table class="st-tb"><tr><th>날짜</th><th>받은 것</th><th>건수</th><th>인증한 번호</th></tr>${dl.slice(0, 20).map(e => `<tr><td>${ymdhm(e.at)}</td><td>${esc(e.what)}</td><td>${e.n.toLocaleString()}</td><td>${esc(e.ph)}</td></tr>`).join('')}</table>` : '<p class="st-d">아직 내려받은 적이 없습니다.</p>'}</section>`;
    $('stIm').onclick = () => H.importXl();
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
  const KN = { sale: '매매', jeonse: '전세', wolse: '월세' }, LIVE = { owner: '주인 거주', tenant: '임차인 거주', empty: '공실' };
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
    const bar = (t, v, max, u) => `<b>${t}</b><div class="st-bar"><i style="width:${max && v != null ? Math.min(100, Math.round(v / max * 100)) : 0}%" class="${max && v / max >= .9 ? 'hi' : ''}"></i></div><span>${v == null ? '…' : v.toLocaleString()} / ${max ? max.toLocaleString() + u : '제한 없음'}</span>`;
    m.innerHTML = `<section class="st-c"><h2>요금제 <em class="gr">${esc(P.name || '')}${P.until ? ` · ${ymd(P.until)}까지${left != null ? ` (${left}일 남음)` : ''}` : ''}</em></h2>
      <p class="st-d">한도의 90%가 넘으면 막대가 빨갛게 바뀝니다.</p>
      <div class="st-u">${bar('매물', items.length, P.ls, '건')}${bar('지도 광고', pub, P.ad, '건')}${bar('아파트 단지', cxs ? cxs.length : null, P.cx, '곳')}${bar('고객', Array.isArray(cus) ? cus.length : null, P.cu, '명')}</div>
      <div class="st-r" style="justify-content:flex-start"><a class="st-b" href="/pro.html#price" target="_blank" rel="noopener">요금제 보기 · 바꾸기</a></div></section>`;
    if (!cxs) loadCx().then(() => sec === 'plan' && draw());
    if (!cus) loadCu().then(() => sec === 'plan' && draw());
  }

  // ---------- 계정·화면 ----------
  function acct(m) {
    const me = H.me() || {};
    m.innerHTML = `<section class="st-c"><h2>계정</h2><div class="st-f"><span>로그인</span><div>카카오 · ${esc(me.nickname || '')}님</div></div>
      <div class="st-r" style="justify-content:flex-start"><a class="st-b" href="/api/auth?action=logout&r=/">로그아웃</a><a class="st-b" href="/pro-guide.html" target="_blank" rel="noopener">설명서 보기</a></div></section>
      <section class="st-c"><h2>화면</h2><div class="st-f"><span>글씨 크기</span><div class="st-fz"><button type="button" class="st-b" data-fz="-1">가− 작게</button><button type="button" class="st-b" data-fz="1">가+ 크게</button><small>위쪽 [가−][가+]와 같습니다</small></div></div></section>
      ${me.op ? '' : `<section class="st-c st-q"><h2>중개사 서비스 해지</h2><p class="st-d">매물장·사진·지도 광고·단지 장부·고객·중개사무소 정보가 모두 지워지며 되돌릴 수 없습니다. 해지 전에 [엑셀]에서 내려받아 두시길 권합니다.</p><button type="button" class="st-x" id="stQuit">해지하기</button></section>`}`;
    m.querySelectorAll('[data-fz]').forEach(b => b.onclick = () => H.fz(+b.dataset.fz));
    if ($('stQuit')) $('stQuit').onclick = () => H.quit();
  }
  return { mount, refresh, stale, go };
})();
