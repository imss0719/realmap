// 리얼맵 중개장부 · 설정 (10/26)
// [매물] [고객관리] [설정] — 가끔 쓰는 기능을 한곳에: 우리 사무소 · 엑셀(불러오기·양식·기록·내려받기) · 요금제 · 계정·화면 · 직원 관리(준비 중)
// 엑셀 내려받기는 대표 휴대폰 인증 한 번에 한 번 (서버가 인증할 때 기록을 남김: /api/auth?action=xlog)
// host = { api, post, toast, me(), bk(), plan(), items(), canPub(), openBk(), importXl(), quit(), xlGate(info, fn), exportLs(), fz(d) }
window.Sett = (() => {
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const MENU = [['office', '우리 사무소', '정보·광고 표시'], ['excel', '엑셀', '불러오기·내려받기'], ['plan', '요금제', ''], ['help', '문의하기', ''], ['acct', '계정·화면', '']];
  let H = null, el = null, sec = 'office', log = null, cxs = null, cus = null, hp = null; const off = new Set();   // off: 내려받기에서 체크를 푼 단지 · hp: 내 입금 신청·문의
  const pf = { plan: '', mon: 12, payer: '', rc: '', rcno: '' }, qf = { cat: '사용법', text: '', img: '' };   // 쓰던 신청서·문의 글 (화면을 다시 그려도 남게)
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

  function mount(box, host) { H = host; el = box; try { sec = localStorage.getItem('rm.set') || 'office'; } catch { /* 무시 */ } if (!MENU.some(m => m[0] === sec)) sec = 'office'; draw(); }
  function refresh() { if (el && !el.contains(document.activeElement)) draw(); }   // 글을 쓰는 중이면 다시 그리지 않음
  function stale() { log = null; cxs = null; cus = null; if (el && !el.hidden) draw(); }   // 엑셀 불러오기 뒤 기록·숫자 새로
  function go(s, fresh) { if (fresh) hp = null; sec = s; try { localStorage.setItem('rm.set', s); } catch { /* 무시 */ } draw(); }
  function draw() {
    el.innerHTML = `<div class="st-w"><nav class="st-n">${MENU.map(([k, t, d]) => `<button type="button" data-s="${k}" aria-pressed="${sec === k}"><b>${t}</b><small>${k === 'plan' ? esc((H.plan() || {}).name || '') : d}</small></button>`).join('')}
      <hr><button type="button" class="off" disabled><b>직원 관리</b><small>준비 중</small></button></nav><div class="st-m" id="stM"></div></div>`;
    el.querySelectorAll('[data-s]').forEach(b => b.onclick = () => go(b.dataset.s));
    ({ office, excel, plan, help, acct })[sec]($('stM'));
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
  async function loadHp() { try { hp = await H.api('/api/auth?action=help'); } catch (e) { hp = { pays: [], qnas: [], err: e.message }; } }
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
      <div class="st-r" style="justify-content:flex-start"><a class="st-b" href="/pro.html#price" target="_blank" rel="noopener">요금제 자세히 보기</a></div></section>
      ${payForm()}`;
    wirePay(m);
    if (!cxs) loadCx().then(() => sec === 'plan' && draw());
    if (!cus) loadCu().then(() => sec === 'plan' && draw());
    if (!hp) loadHp().then(() => sec === 'plan' && draw());
  }
  // 계좌이체 신청 (10/27): 고르기 → 계좌·금액 → [입금했어요] → 운영자가 통장 확인 뒤 켜 줌(남은 기간 뒤에 이어 붙임)
  function payForm() {
    const P = H.plan() || {};
    if (!pf.plan) pf.plan = PRICE[P.plan] ? P.plan : 'basic';
    if (!pf.payer) pf.payer = (H.bk() && H.bk().office) || '';
    const amt = PRICE[pf.plan] * (pf.mon === 12 ? 10 : pf.mon), now = new Date().toISOString();
    const pays = (hp && hp.pays) || [], wait = pays.filter(x => x.st === 'wait');
    const ST = { wait: '<em class="no">입금 확인 중</em>', ok: '<em class="ok">켜짐</em>', no: '<em class="gr">취소됨</em>', cancel: '<em class="gr">신청 취소</em>' };
    return `<section class="st-c"><h2>요금제 신청 · 계좌이체</h2>
      <p class="st-d">${PRICE[P.plan] && P.until > now ? `지금 <b>${esc(P.name)} · ${ymd(P.until)}까지</b> 이용 중입니다. 입금하시면 남은 기간 뒤에 이어서 늘어납니다.` : '입금이 확인되면 그날부터 시작합니다.'}</p>
      <div class="st-pl">${Object.keys(PRICE).map(k => `<button type="button" data-pp="${k}" aria-pressed="${pf.plan === k}"><b>${PN[k]}</b><span>월 ${PRICE[k].toLocaleString()}원 · ${PDESC[k]}</span></button>`).join('')}</div>
      <div class="st-per">${[1, 6, 12].map(n => `<button type="button" data-pm="${n}" aria-pressed="${pf.mon === n}">${n}개월${n === 12 ? ' <small>2개월 무료</small>' : ''}</button>`).join('')}</div>
      <div class="st-acc">${BANK.name} <b>${BANK.no}</b> &nbsp;예금주 <b>${BANK.who}</b> <button type="button" class="st-cp" id="stCp">계좌 복사</button><br>
        입금자명 <input id="stPayer" value="${esc(pf.payer)}" maxlength="30" placeholder="사무소명"> <small>통장에 찍히는 이름과 같게 적어 주세요</small></div>
      <div class="st-sum"><span>${PN[pf.plan]} ${pf.mon}개월${pf.mon === 12 ? ' (10개월 값)' : ''} · 부가세 포함</span><b>${amt.toLocaleString()}원</b></div>
      <div class="st-rc"><label><input type="radio" name="strc" value="" ${pf.rc ? '' : 'checked'}> 영수증 필요 없음</label><label><input type="radio" name="strc" value="cash" ${pf.rc === 'cash' ? 'checked' : ''}> 현금영수증</label><label><input type="radio" name="strc" value="tax" ${pf.rc === 'tax' ? 'checked' : ''}> 세금계산서</label>
        ${pf.rc ? `<input id="stRcNo" value="${esc(pf.rcno)}" maxlength="20" placeholder="${pf.rc === 'tax' ? '사업자번호 (000-00-00000)' : '휴대폰 번호'}">` : ''}</div>
      <div class="st-r"><button type="button" class="st-b y" id="stPay" ${wait.length >= 3 ? 'disabled' : ''}>입금했어요 · 신청하기</button></div>
      <p class="st-d">입금이 확인되면 보통 하루 안에 켜 드리고 알림(🔔)으로 알려 드립니다.</p>
      ${pays.length ? `<h3>내 신청</h3><table class="st-tb"><tr><th>신청</th><th>요금제</th><th>금액</th><th>상태</th><th></th></tr>${pays.slice(0, 10).map(x => `<tr><td>${ymdhm(x.at)}</td><td>${PN[x.plan] || x.plan} ${x.mon}개월</td><td>${x.amt.toLocaleString()}원</td><td>${ST[x.st] || ''}${x.st === 'ok' && x.until ? ` <small>${ymd(x.until)}까지</small>` : ''}${x.st === 'no' && x.why ? ` <small>${esc(x.why)}</small>` : ''}</td><td>${x.st === 'wait' ? `<button type="button" class="st-x" data-pc="${esc(x.id)}">신청 취소</button>` : ''}</td></tr>`).join('')}</table>` : ''}</section>`;
  }
  function wirePay(m) {
    m.querySelectorAll('[data-pp]').forEach(b => b.onclick = () => { pf.plan = b.dataset.pp; draw(); });
    m.querySelectorAll('[data-pm]').forEach(b => b.onclick = () => { pf.mon = +b.dataset.pm; draw(); });
    m.querySelectorAll('[name="strc"]').forEach(r => r.onchange = () => { pf.rc = r.value; draw(); });
    $('stPayer').oninput = e => { pf.payer = e.target.value; };
    if ($('stRcNo')) $('stRcNo').oninput = e => { pf.rcno = e.target.value; };
    $('stCp').onclick = async () => { try { await navigator.clipboard.writeText(BANK.no.replace(/-/g, '')); H.toast('계좌번호를 복사했습니다'); } catch { prompt('계좌번호를 복사해 주세요', BANK.no); } };
    $('stPay').onclick = async () => {
      const amt = PRICE[pf.plan] * (pf.mon === 12 ? 10 : pf.mon);
      if (!pf.payer.trim()) return H.toast('입금자명을 적어 주세요');
      if (pf.rc && !pf.rcno.trim()) return H.toast(pf.rc === 'tax' ? '사업자번호를 적어 주세요' : '현금영수증 받을 휴대폰 번호를 적어 주세요');
      if (!confirm(`${PN[pf.plan]} ${pf.mon}개월 ${amt.toLocaleString()}원\n${BANK.name} ${BANK.no} ${BANK.who}\n입금자명: ${pf.payer}\n\n입금하셨나요? 신청을 보냅니다.`)) return;
      try { await H.api('/api/auth?action=help', H.post({ op: 'pay', plan: pf.plan, mon: pf.mon, payer: pf.payer, rcpt: pf.rc ? { t: pf.rc, no: pf.rcno } : null })); H.toast('신청했습니다. 입금이 확인되면 알림으로 알려 드립니다', 4500); hp = null; draw(); }
      catch (e) { H.toast(e.message, 4000); }
    };
    m.querySelectorAll('[data-pc]').forEach(b => b.onclick = async () => { if (!confirm('이 신청을 취소할까요?')) return; try { await H.api('/api/auth?action=help', H.post({ op: 'paycancel', id: b.dataset.pc })); hp = null; draw(); } catch (e) { H.toast(e.message, 4000); } });
  }

  // ---------- 문의하기 (10/27) — 운영자가 중개사 관리 화면에서 답변 · 답변이 오면 알림(🔔) ----------
  function help(m) {
    const qs = (hp && hp.qnas) || [];
    m.innerHTML = `<section class="st-c"><h2>문의하기</h2><p class="st-d">사용법·오류·요금 무엇이든 적어 주세요. 답변은 이 화면과 알림(🔔)으로 드립니다. 오류는 화면을 찍은 사진을 붙이면 빨리 고칠 수 있습니다.</p>
      <div class="st-per">${['사용법', '오류', '요금·결제', '기타'].map(c => `<button type="button" data-qc="${c}" aria-pressed="${qf.cat === c}">${c}</button>`).join('')}</div>
      <textarea id="stQ" class="st-ta" rows="6" maxlength="2000" placeholder="예) 엑셀 불러오기에서 주소를 못 찾는 줄이 많아요">${esc(qf.text)}</textarea>
      <div class="st-r" style="justify-content:space-between;align-items:center"><span><label class="st-b" for="stQi">${qf.img ? '사진 바꾸기' : '사진 붙이기 (선택)'}</label><input type="file" id="stQi" accept="image/*" hidden> ${qf.img ? `<a href="${esc(qf.img)}" target="_blank" rel="noopener">붙인 사진</a> <button type="button" class="st-x" id="stQiX">빼기</button>` : ''}</span><button type="button" class="st-b y" id="stQs">보내기</button></div></section>
      <section class="st-c"><h2>내 문의</h2>${!hp ? '<p class="st-d">불러오는 중…</p>' : qs.length ? qs.map(q => `<div class="st-qa"><div class="q"><small>${ymdhm(q.at)} · ${esc(q.cat)}</small><p>${esc(q.text)}</p>${q.img ? `<a href="${esc(q.img)}" target="_blank" rel="noopener">사진</a>` : ''}</div>${q.reply ? `<div class="a"><small>리얼맵 답변 · ${ymdhm(q.rat)}</small><p>${esc(q.reply)}</p></div>` : '<div class="a w">답변을 준비하고 있습니다</div>'}</div>`).join('') : '<p class="st-d">아직 보낸 문의가 없습니다.</p>'}</section>`;
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
    m.innerHTML = `<section class="st-c"><h2>계정</h2><div class="st-f"><span>로그인</span><div>카카오 · ${esc(me.nickname || '')}님</div></div>
      <div class="st-r" style="justify-content:flex-start"><a class="st-b" href="/api/auth?action=logout&r=/">로그아웃</a><a class="st-b" href="/pro-guide.html" target="_blank" rel="noopener">설명서 보기</a></div></section>
      <section class="st-c"><h2>화면</h2><div class="st-f"><span>글씨 크기</span><div class="st-fz"><button type="button" class="st-b" data-fz="-1">가− 작게</button><button type="button" class="st-b" data-fz="1">가+ 크게</button><small>위쪽 [가−][가+]와 같습니다</small></div></div></section>
      ${me.op ? '' : `<section class="st-c st-q"><h2>중개사 서비스 해지</h2><p class="st-d">매물장·사진·지도 광고·단지 장부·고객·중개사무소 정보가 모두 지워지며 되돌릴 수 없습니다. 해지 전에 [엑셀]에서 내려받아 두시길 권합니다.</p><button type="button" class="st-x" id="stQuit">해지하기</button></section>`}`;
    m.querySelectorAll('[data-fz]').forEach(b => b.onclick = () => H.fz(+b.dataset.fz));
    if ($('stQuit')) $('stQuit').onclick = () => H.quit();
  }
  return { mount, refresh, stale, go };
})();
