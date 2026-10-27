// 리얼맵 중개장부 · 설정 (10/26 · 10/27 촘촘한 화면: 왼쪽 메뉴 → 그 부분만, 안은 '이름 | 값 | 버튼' 한 줄씩 · 두 칸 배치 · 13px 표)
// [매물] [고객관리] [설정] — 가끔 쓰는 기능을 한곳에: 우리 사무소 · 엑셀(불러오기·양식·기록·내려받기) · 요금제 · 계정·화면 · 직원 관리(준비 중)
// 엑셀 내려받기는 대표 휴대폰 인증 한 번에 한 번 (서버가 인증할 때 기록을 남김: /api/auth?action=xlog)
// host = { api, post, toast, me(), bk(), plan(), items(), canPub(), openBk(), importXl(), quit(), xlGate(info, fn), exportLs(), fz(d) }
window.Sett = (() => {
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const MENU = [['excel', '엑셀', '불러오기·받기'], ['office', '우리 사무소', ''], ['plan', '요금제', ''], ['help', '문의하기', ''], ['acct', '계정·화면', '']];
  let H = null, el = null, sec = 'excel', log = null, cxs = null, cus = null, hp = null; const off = new Set();   // off: 내려받기에서 체크를 푼 단지 · hp: 내 입금 신청·문의
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
  // 촘촘한 화면 조각: 판(제목 줄 + 줄들) · 줄(이름 | 값 | 버튼) · 표
  const pn = (title, sub, body, cls = '', right = '') => `<section class="sp ${cls}"><h3>${title}${sub ? ` <small>${sub}</small>` : ''}${right ? `<span class="r">${right}</span>` : ''}</h3>${body}</section>`;
  const rw = (name, val, act = '') => `<div class="sr"><b>${name}</b><span>${val}</span>${act ? `<span class="a">${act}</span>` : '<span></span>'}</div>`;
  const tb = (head, rows, empty) => rows.length ? `<table class="st-tb"><tr>${head.map(h => `<th>${h}</th>`).join('')}</tr>${rows.join('')}</table>` : `<p class="sp-e">${empty}</p>`;
  const B = (id, t, c = '', x = '') => `<button type="button" class="sb ${c}" ${id ? `id="${id}"` : ''} ${x}>${t}</button>`;
  const seen = () => { try { return localStorage.getItem('rm.qseen') || ''; } catch { return ''; } };
  const newRep = () => ((hp && hp.qnas) || []).filter(q => q.reply && q.rat > seen()).length;   // 아직 안 본 답변 수 (메뉴 빨간 숫자)

  function mount(box, host) { H = host; el = box; try { sec = localStorage.getItem('rm.set') || 'excel'; } catch { /* 무시 */ } if (!MENU.some(m => m[0] === sec)) sec = 'excel'; draw(); if (!hp) loadHp().then(() => draw()); }
  function refresh() { if (el && !el.contains(document.activeElement)) draw(); }   // 글을 쓰는 중이면 다시 그리지 않음
  function stale() { log = null; cxs = null; cus = null; if (el && !el.hidden) draw(); }   // 엑셀 불러오기 뒤 기록·숫자 새로
  function go(s, fresh) { if (fresh) hp = null; sec = s; try { localStorage.setItem('rm.set', s); } catch { /* 무시 */ } draw(); }
  function draw() {
    const b = H.bk() || {}, sub = { office: b.verified ? '확인됨' : b.office ? '확인 전' : '', plan: (H.plan() || {}).name || '' }, nr = newRep();
    el.innerHTML = `<div class="st-w"><nav class="st-n">${MENU.map(([k, t, d]) => `<button type="button" data-s="${k}" aria-pressed="${sec === k}"><b>${t}</b>${k === 'help' && nr ? `<em>${nr}</em>` : `<small>${esc(sub[k] || d)}</small>`}</button>`).join('')}
      <hr><button type="button" class="off" disabled><b>직원 관리</b><small>준비 중</small></button></nav><div class="st-m" id="stM"></div></div>`;
    el.querySelectorAll('[data-s]').forEach(b => b.onclick = () => go(b.dataset.s));
    ({ office, excel, plan, help, acct })[sec]($('stM'));
  }

  // ---------- 우리 사무소 ----------
  function office(m) {
    const b = H.bk() || {}, v = x => x ? esc(x) : '<i class="em">비어 있음</i>';
    const mobOk = b.mobile && b.mobileOk && String(b.mobileOk).replace(/\D/g, '') === String(b.mobile).replace(/\D/g, '');
    const live = H.items().filter(x => x.pub && x.pub.on && x.status === 'on' && x.pub.exp > new Date().toISOString()).length;
    m.innerHTML = `<div class="sg2">${pn('중개사무소 정보', b.verified ? '<span class="tg g">등록 확인됨 ✓</span>' : b.office ? '<span class="tg r">확인 전</span>' : '',
      rw('상호', v(b.office)) + rw('대표자', v(b.ceo)) + rw('등록번호', v(b.regno)) + rw('주소', v(b.addr)) + rw('사무실 전화', v(b.tel)) + rw('대표 휴대폰', v(b.mobile) + (b.mobile ? ` <span class="tg ${mobOk ? 'g' : 'r'}">${mobOk ? '인증됨' : '인증 필요'}</span>` : '')),
      '', B('stBk', '고치기 · 사진 · 휴대폰 인증', 'y'))}
      ${H.canPub() ? pn('리얼맵 지도 광고 표시', '공인중개사법 표시·광고 항목',
        rw('광고에 나가는 글', `<b>${esc(b.office || '')}</b> · 대표 ${esc(b.ceo || '')} · 등록번호 ${esc(b.regno || '')}<br>${esc(b.addr || '')}${b.tel ? ` · ☎ ${esc(b.tel)}` : ''}`) + rw('지금 게시 중', `${live}건`) + rw('고치기', '<small>왼쪽 [고치기]에서 바꾸면 광고에도 바로 반영됩니다</small>')) : ''}</div>`;
    $('stBk').onclick = () => H.openBk();
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
      ${pn('불러온 기록', '최근 30건 · 나중에도 되돌리기', !log ? '<p class="sp-e">불러오는 중…</p>' : tb(['날짜', '파일', '넣은 곳', '건수', ''], im.map(e => `<tr><td>${ymdhm(e.at)}</td><td class="ell">${esc(e.file)}</td><td class="ell">${e.to === 'hj' ? `단지 · ${esc(e.names || '')}` : '매물장'}</td><td>${e.n.toLocaleString()}${e.to === 'hj' ? '호' : '건'}</td><td>${e.undone ? '<span class="tg gr">되돌림</span>' : B('', '되돌리기', 'r', `data-undo="${esc(e.id)}"`)}</td></tr>`), '아직 불러온 적이 없습니다'))}
      ${pn('내려받은 기록', '최근 100건 보관', !log ? '' : tb(['날짜', '받은 것', '건수', '인증 번호'], dl.slice(0, 30).map(e => `<tr><td>${ymdhm(e.at)}</td><td class="ell">${esc(e.what)}</td><td>${e.n.toLocaleString()}</td><td>${esc(e.ph)}</td></tr>`), '아직 내려받은 적이 없습니다'))}</div>`;
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
    const bar = (t, v, max, u) => `<div class="su"><b>${t}</b><div class="st-bar"><i style="width:${max && v != null ? Math.min(100, Math.round(v / max * 100)) : 0}%" class="${max && v / max >= .9 ? 'hi' : ''}"></i></div><small>${v == null ? '…' : v.toLocaleString()} / ${max ? max.toLocaleString() + u : '제한 없음'}</small></div>`;
    const notes = (hp && hp.notes) || [];   // 운영자 혜택 기록 (10/27)
    m.innerHTML = pn('요금제 · 쓰는 양', `<span class="tg gr">${esc(P.name || '')}${P.until ? ` · ${ymd(P.until)}까지${left != null ? ` (${left}일)` : ''}` : P.plan !== 'free' ? ' · 기한 없음' : ''}</span>${P.gift ? ' <span class="tg y">운영자 혜택</span>' : ''}`,
      `<div class="sus">${bar('매물', items.length, P.ls, '건')}${bar('지도 광고', pub, P.ad, '건')}${bar('아파트 단지', cxs ? cxs.length : null, P.cx, '곳')}${bar('고객', Array.isArray(cus) ? cus.length : null, P.cu, '명')}</div>`,
      '', '<a class="sb" href="/pro.html#price" target="_blank" rel="noopener">요금제 자세히</a>') +
      (notes.length ? pn('운영자 혜택 기록', '리얼맵 운영자가 올려 드린 요금제', tb(['적용일', '요금제', '쓰는 기간'], notes.map(n => `<tr><td>${ymdhm(n.at)}</td><td>${esc(n.name)}</td><td>${n.until ? ymd(n.until) + '까지' : '기한 없음'}</td></tr>`))) : '') + payForm();
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
    const ST = { wait: '<span class="tg y">입금 확인 중</span>', ok: '<span class="tg g">켜짐</span>', no: '<span class="tg gr">취소됨</span>', cancel: '<span class="tg gr">신청 취소</span>' };
    const seg = (items, cur, attr) => `<span class="sseg">${items.map(([k, t]) => `<button type="button" ${attr}="${k}" aria-pressed="${String(cur) === String(k)}">${t}</button>`).join('')}</span>`;
    return pn('요금제 신청 · 계좌이체', PRICE[P.plan] && P.until > now ? '입금하면 남은 기간 뒤에 이어서 늘어남' : '입금 확인일부터 시작',
      rw('요금제', seg(Object.keys(PRICE).map(k => [k, `${PN[k]} ${PRICE[k].toLocaleString()}`]), pf.plan, 'data-pp') + ` <small>${PDESC[pf.plan]}</small>`) +
      rw('기간', seg([[1, '1개월'], [6, '6개월'], [12, '12개월 <em>2개월 무료</em>']], pf.mon, 'data-pm'), `<b class="amt">${amt.toLocaleString()}원</b>`) +
      rw('입금 계좌', `${BANK.name} <b>${BANK.no}</b> ${BANK.who}`, B('stCp', '계좌 복사')) +
      rw('입금자명', `<input id="stPayer" class="si" value="${esc(pf.payer)}" maxlength="30" placeholder="사무소명"> <small>통장에 찍히는 이름과 같게</small>`) +
      rw('영수증', `<label><input type="radio" name="strc" value="" ${pf.rc ? '' : 'checked'}> 필요 없음</label> <label><input type="radio" name="strc" value="cash" ${pf.rc === 'cash' ? 'checked' : ''}> 현금영수증</label> <label><input type="radio" name="strc" value="tax" ${pf.rc === 'tax' ? 'checked' : ''}> 세금계산서</label>${pf.rc ? ` <input id="stRcNo" class="si" value="${esc(pf.rcno)}" maxlength="20" placeholder="${pf.rc === 'tax' ? '사업자번호' : '휴대폰 번호'}">` : ''}`, B('stPay', '입금했어요 · 신청', 'y', wait.length >= 3 ? 'disabled' : '')) +
      `<p class="sp-n">입금이 확인되면 보통 하루 안에 켜 드리고 알림(🔔)으로 알려 드립니다. 신청하시면 <a href="/terms.html" target="_blank" rel="noopener">이용약관</a>과 환불 규정(입금 확인 7일 안 전액, 그 뒤 남은 기간만큼)에 동의한 것으로 봅니다.</p>` +
      (pays.length ? `<div class="sp-t">${tb(['신청', '요금제', '금액', '상태', ''], pays.slice(0, 10).map(x => `<tr><td>${ymdhm(x.at)}</td><td>${PN[x.plan] || x.plan} ${x.mon}개월</td><td>${x.amt.toLocaleString()}원</td><td>${ST[x.st] || ''}${x.st === 'ok' && x.until ? ` <small>${ymd(x.until)}까지</small>` : ''}${x.st === 'no' && x.why ? ` <small>${esc(x.why)}</small>` : ''}</td><td>${x.st === 'wait' ? B('', '신청 취소', 'r', `data-pc="${esc(x.id)}"`) : ''}</td></tr>`), '')}</div>` : ''), 'mt');
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
      ${me.op ? '' : pn('중개사 서비스 해지', '되돌릴 수 없음', rw('해지', '<small>매물장·사진·지도 광고·단지 장부·고객·사무소 정보가 모두 지워집니다. 먼저 [엑셀]에서 받아 두세요.</small>', B('stQuit', '해지하기', 'r')), 'q')}</div>`;
    m.querySelectorAll('[data-fz]').forEach(b => b.onclick = () => H.fz(+b.dataset.fz));
    if ($('stQuit')) $('stQuit').onclick = () => H.quit();
  }
  return { mount, refresh, stale, go };
})();
