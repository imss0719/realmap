// 리얼맵 매물장 알림 (10/25)
// 위쪽 종 아이콘(안 읽은 수) · 오른쪽 아래 새 알림 카드 · 누르면 알림 내역 창. 이 브라우저에 기억합니다(rm.alarm).
// 10/31 선배: 알림 정리 — 거래 의심·세입자 만기·챙길 것·오래 연락 못 한 고객은 뺌 (만기·챙길 것은 표에 빨간색으로 보임)
//   남은 것: 광고 기간이 끝났을 때 한 번 · 고객 맞는 매물/예산 안으로 (한 번씩) · 리얼맵 소식
// (예전) 알림 종류
//   deal  거래된 것 같습니다 — 실거래 신고 중 내 매물(매물장)·단지 장부의 내 매물/타부동산 매물과 같은 층·면적(또는 같은 필지·면적)인 거래
//   exp   단지 장부 세입자 만기 — 6개월·3개월·1개월 전, 만기일 지남
//   pub   리얼맵 게시 3일 안에 끝남 · 게시 기간 끝남
//   imp   꼭 챙길 것(10/26) — 글에 날짜가 있으면 7일 전 · 1일 전 · 당일 · 지난 뒤 3일까지 (매물관리·단지 장부)
// 실거래는 계약 후 최대 30일 뒤에 신고되므로 '같습니다'로만 알리고, 6시간에 한 번만 확인합니다(서버도 캐시).
window.Alarm = (() => {
  const $ = id => document.getElementById(id);
  const DAY = 86400e3, KEY = 'rm.alarm', CHECK_EVERY = 6 * 3600e3, KEEP = 60 * DAY;
  let H = null, A = load(), tab = 'all', busy = false;
  function load() { try { const v = JSON.parse(localStorage.getItem(KEY) || 'null'); if (v && Array.isArray(v.list)) return v; } catch { /* 무시 */ } return { list: [], last: 0 }; }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(A)); } catch { /* 저장 공간 없음 */ } }
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const won = man => !man ? '' : man >= 10000 ? `${(man / 10000).toFixed(man % 10000 ? 1 : 0).replace(/\.0$/, '')}억` : `${Math.round(man).toLocaleString()}만`;
  const md = iso => { const d = new Date(iso); return `${d.getMonth() + 1}/${d.getDate()}`; };
  const digits = s => String(s ?? '').replace(/\D/g, '');
  const near = (a, b, tol = 1.5) => a && b && Math.abs(a - b) <= Math.max(tol, b * 0.02);
  const tradeDay = t => { const [y, m, d] = String(t.date).split('.').map(Number); return new Date(y, (m || 1) - 1, d || 1).getTime(); };

  // ---------- 화면 ----------
  function mount(host) {
    H = host;
    const top = document.querySelector('.top .fz');
    if (top && !$('alBell')) {
      const b = document.createElement('button'); b.type = 'button'; b.id = 'alBell'; b.className = 'albell'; b.setAttribute('aria-label', '알림');
      b.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z M10 20a2 2 0 0 0 4 0" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg><b id="alN" hidden></b>';
      top.parentNode.insertBefore(b, top);
      b.onclick = () => toggle();
      const p = document.createElement('div'); p.id = 'alPanel'; p.className = 'alpanel'; p.hidden = true; document.body.appendChild(p);
      const t = document.createElement('div'); t.id = 'alToasts'; t.className = 'altoasts'; document.body.appendChild(t);
      document.addEventListener('mousedown', e => { const P = $('alPanel'); if (P && !P.hidden && !P.contains(e.target) && !e.target.closest('#alBell')) P.hidden = true; });
    }
    prune(); badge();
    run(false);
    clearInterval(mount.t); mount.t = setInterval(() => run(false), 30 * 60e3);
  }
  const KEEP_T = ['pub', 'cust', 'note'];   // 10/31 남기는 알림 종류 (예전에 쌓인 다른 종류는 지움)
  function prune() { const now = Date.now(); A.list = A.list.filter(a => now - a.at < KEEP && KEEP_T.includes(a.t)).slice(0, 200); }
  const unread = () => A.list.filter(a => !a.read).length;
  function badge() { const n = unread(), b = $('alN'); if (!b) return; b.hidden = !n; b.textContent = n > 99 ? '99+' : n; }
  function add(a) {
    if (A.list.some(x => x.id === a.id)) return false;
    A.list.unshift({ ...a, at: Date.now(), read: false });
    return true;
  }
  const ICON = { deal: '⚠', exp: '⏰', pub: '📍', cust: '👤', imp: '⚑', note: '📢' };
  const TABS = [['all', '전체'], ['cust', '고객'], ['pub', '리얼맵']];   // 10/31 '리얼맵' = 광고 기간 + 리얼맵 소식
  function itemHtml(a, i) {
    return `<div class="alit${a.read ? '' : ' un'}" data-ai="${i}"><span class="alic ${a.t}">${ICON[a.t] || '•'}</span><div><b>${esc(a.title)}</b><p>${esc(a.body)}</p><small>${md(a.at)}${a.sub ? ' · ' + esc(a.sub) : ''}</small>${a.go ? ` <span class="algo">${esc(a.goTx || '확인하기')} →</span>` : ''}</div>${a.read ? '' : '<i class="aldot"></i>'}</div>`;
  }
  function drawPanel() {
    const P = $('alPanel'); if (!P) return;
    const inTab = (a, k) => k === 'all' || a.t === k || (k === 'pub' && a.t === 'note');
    const L = A.list.filter(a => inTab(a, tab));
    const cnt = k => A.list.filter(a => !a.read && inTab(a, k)).length;
    P.innerHTML = `<div class="alh"><b>알림</b><button type="button" id="alAll">모두 읽음</button></div>
      <div class="altabs">${TABS.map(([k, t]) => `<button type="button" data-at="${k}" aria-pressed="${tab === k}">${t}${cnt(k) ? ' ' + cnt(k) : ''}</button>`).join('')}</div>
      <div class="allist">${L.length ? L.map(a => itemHtml(a, A.list.indexOf(a))).join('') : '<div class="alnone">알림이 없습니다</div>'}</div>
`;
    P.querySelectorAll('[data-at]').forEach(b => b.onclick = () => { tab = b.dataset.at; drawPanel(); });
    $('alAll').onclick = () => { A.list.forEach(a => { a.read = true; }); save(); badge(); drawPanel(); };
    P.querySelectorAll('[data-ai]').forEach(el => el.onclick = () => { const a = A.list[+el.dataset.ai]; if (!a) return; a.read = true; save(); badge(); drawPanel(); if (a.go) { P.hidden = true; go(a.go); } });
  }
  function toggle() { const P = $('alPanel'); P.hidden = !P.hidden; if (!P.hidden) drawPanel(); }
  function go(g) { if (g.set && H.goSet) return H.goSet(g.set); if (g.ls) H.goList(g.ls); else if (g.cx) H.goDanji(g.cx, g.key); else if (g.cu && H.goCust) H.goCust(g.cu); }
  function toast(list) {
    const T = $('alToasts'); if (!T || !list.length) return;
    list.slice(0, 3).forEach((a, n) => {
      const el = document.createElement('div'); el.className = `alt ${a.t}`;
      el.innerHTML = `<b>${ICON[a.t] || ''} ${esc(a.title)}</b><p>${esc(a.body)}</p><div><button type="button" class="p">${esc(a.go ? a.goTx || '확인하기' : '알림 보기')}</button><button type="button" class="x">닫기</button></div>`;
      el.querySelector('.p').onclick = () => { a.read = true; save(); badge(); el.remove(); if (a.go) go(a.go); else toggle(); };
      el.querySelector('.x').onclick = () => el.remove();
      setTimeout(() => T.appendChild(el), n * 250);
      setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 400); }, 9000 + n * 250);
    });
    if (list.length > 3) setTimeout(() => { const el = document.createElement('div'); el.className = 'alt more'; el.innerHTML = `<b>새 알림 ${list.length - 3}건 더</b><div><button type="button" class="p">알림 보기</button></div>`; el.querySelector('.p').onclick = () => { el.remove(); toggle(); }; T.appendChild(el); setTimeout(() => el.remove(), 9000); }, 800);
  }

  // ---------- 알림 만들기 ----------
  // lite: 매물을 저장한 직후처럼 가볍게 — 리얼맵 게시 · 고객 맞는 매물만 (단지 장부·실거래는 건너뜀)
  async function run(force, lite) {
    if (busy || !H) return;
    const fresh = [];
    const push = a => { if (add(a)) fresh.push(a); };
    // 1) 리얼맵 게시 기간 (매물장)
    const now = Date.now();
    for (const x of H.items()) {
      if (!(x.pub && x.pub.on) || x.status !== 'on') continue;
      const left = Date.parse(x.pub.exp) - now, nm = H.name(x);
      if (left <= 0) push({ id: `pubx:${x.id}:${x.pub.exp.slice(0, 10)}`, t: 'pub', title: '리얼맵 게시 기간이 끝났습니다', body: `${nm} · 지도에서 내려갔습니다. 다시 게시하려면 [기간만료 ▾]를 눌러 주세요.`, go: { ls: x.id }, goTx: '이동' });
    }
    // 0) 리얼맵 소식 (10/27): 계좌이체 요금제가 켜짐·취소됨 · 문의 답변
    if (H.help && !lite) try {
      const j = await H.help();
      for (const x of j.pays || []) if (x.st === 'ok' || x.st === 'no') push({ id: `pay:${x.id}:${x.st}`, t: 'note', title: x.st === 'ok' ? '요금제가 켜졌습니다' : '요금제 신청이 취소되었습니다', body: x.st === 'ok' ? `${x.mon}개월 · ${String(x.until || '').slice(0, 10).replace(/-/g, '.')}까지. 화면을 새로 고치면 늘어난 한도가 바로 보입니다.` : (x.why || '입금이 확인되지 않았습니다') + ' · 궁금하시면 [설정 → 문의하기]로 알려 주세요.', go: { set: 'plan' }, goTx: '보기' });
      for (const n of (j.notes || []).filter(n => n.k === 'staff')) push({ id: `pn:${n.id}`, t: 'note', title: `직원 참여 신청 · ${n.name}님 (${n.role === 'agt' ? '소속공인중개사' : '중개보조원'})`, body: '승인하시면 우리 사무소 장부를 같이 씁니다.', go: { set: 'staff' }, goTx: '직원 관리' });   // 10/28
      for (const n of (j.notes || []).filter(n => !n.k)) push({ id: `pn:${n.id}`, t: 'note', title: `운영자 혜택 · ${n.name} 요금제가 적용되었습니다`, body: `${n.until ? String(n.until).slice(0, 10).replace(/-/g, '.') + '까지' : '기한 없이'} 쓰실 수 있습니다. 화면을 새로 고치면 늘어난 한도가 바로 보입니다.`, go: { set: 'plan' }, goTx: '보기' });   // 운영자가 올려 준 요금제 (10/27)
      for (const q of j.qnas || []) if (q.reply) push({ id: `qna:${q.id}:${q.rat}`, t: 'note', title: '문의에 답변이 왔습니다', body: q.text.slice(0, 50), go: { set: 'help' }, goTx: '답변 보기' });
    } catch { /* 다음에 */ }
    // 1-2) 고객관리: 맞는 매물이 새로 생김 · 예산 안으로 내려옴 · 오래 연락 못 한 고객
    // 처음 실행하거나 새로 등록한 고객은 지금 맞는 매물을 조용히 기억만 하고, 그 뒤에 새로 맞는 것만 알림
    try {
      const snap = H.cust ? await H.cust() : [];
      const first = !A.cm, cm = A.cm || {};
      for (const { c, list } of snap) {
        // 조건을 고친 직후(up이 바뀜)도 조용히 다시 기억만 — 예산을 넓혔다고 알림이 쏟아지지 않게
        const P0 = cm[c.id], prev = P0 && P0.u === c.up ? P0.m : null, cur = {}, nm = c.name || c.phone || '고객';
        for (const z of list) {
          cur[z.key] = z.g;
          if (first || !prev) continue;
          const was = prev[z.key];
          if (!was) push({ id: `cm:${c.id}:${z.key}`, t: 'cust', title: `${nm} 고객에게 맞는 매물`, body: `${z.label}${z.g === 'over' ? ' (예산을 조금 넘음)' : ''} — 조건에 새로 맞습니다.`, go: z.go, goTx: '이동' });
          else if (was === 'over' && z.g === 'ok') push({ id: `cmd:${c.id}:${z.key}`, t: 'cust', title: `${nm} 고객 예산 안으로 들어왔습니다`, body: `${z.label} — 가격이 예산 안으로 내려왔습니다.`, go: z.go, goTx: '이동' });
        }
        cm[c.id] = { u: c.up, m: cur };
      }
      A.cm = cm;
    } catch { /* 고객관리를 못 쓰는 회원 */ }
    if (lite) { prune(); save(); badge(); drawIfOpen(); toast(fresh); return; }
    prune(); save(); badge(); drawIfOpen();
    const PR = { note: 0, cust: 1, pub: 2 };
    toast(fresh.sort((x, y) => PR[x.t] - PR[y.t]));
  }
  const drawIfOpen = () => { const P = $('alPanel'); if (P && !P.hidden) drawPanel(); };
  const limit = async (list, n, fn) => { const out = []; let i = 0; await Promise.all(Array.from({ length: Math.min(n, list.length) }, async () => { while (i < list.length) { const k = i++; try { out[k] = await fn(list[k]); } catch { out[k] = null; } } })); return out; };
  const umdOf = addr => (String(addr || '').split(' ').find(w => /(동|가|리)\d*$/.test(w) && !/[시군구]$/.test(w)) || '');
  const baseName = s => String(s || '').replace(/\s|\(.*?\)|아파트|APT/gi, '').replace(/\d+단지$/, '');
  const floorOfHo = ho => { const d = digits(ho); return d.length >= 3 ? String(+d.slice(0, -2)) : ''; };
  const kindOf = t => /Rent$/.test(t.kind) ? (t.rent ? 'wolse' : 'jeonse') : 'sale';
  const priceTx = t => kindOf(t) === 'sale' ? `매매 ${won(t.price)}` : kindOf(t) === 'jeonse' ? `전세 ${won(t.deposit)}` : `월세 ${won(t.deposit)}/${t.rent}`;
  // 10/31 거래 의심(실거래 확인)은 뺌 — 예전 코드는 git 기록에 있음
  let softT = null;
  const soft = () => { clearTimeout(softT); softT = setTimeout(() => run(false, true), 2500); };
  return { mount, run: () => run(true), soft, _state: () => A };
})();
