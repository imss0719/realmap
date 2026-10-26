// 리얼맵 매물장 알림 (10/25)
// 위쪽 종 아이콘(안 읽은 수) · 오른쪽 아래 새 알림 카드 · 누르면 알림 내역 창. 이 브라우저에 기억합니다(rm.alarm).
// 알림 종류
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
  function prune() { const now = Date.now(); A.list = A.list.filter(a => now - a.at < KEEP).slice(0, 200); }
  const unread = () => A.list.filter(a => !a.read).length;
  function badge() { const n = unread(), b = $('alN'); if (!b) return; b.hidden = !n; b.textContent = n > 99 ? '99+' : n; }
  function add(a) {
    if (A.list.some(x => x.id === a.id)) return false;
    A.list.unshift({ ...a, at: Date.now(), read: false });
    return true;
  }
  const ICON = { deal: '⚠', exp: '⏰', pub: '📍', cust: '👤', imp: '⚑' };
  const TABS = [['all', '전체'], ['imp', '챙길 것'], ['deal', '거래 의심'], ['exp', '만기'], ['cust', '고객'], ['pub', '리얼맵']];
  function itemHtml(a, i) {
    return `<div class="alit${a.read ? '' : ' un'}" data-ai="${i}"><span class="alic ${a.t}">${ICON[a.t] || '•'}</span><div><b>${esc(a.title)}</b><p>${esc(a.body)}</p><small>${md(a.at)}${a.sub ? ' · ' + esc(a.sub) : ''}</small>${a.go ? ` <span class="algo">${esc(a.goTx || '확인하기')} →</span>` : ''}</div>${a.read ? '' : '<i class="aldot"></i>'}</div>`;
  }
  function drawPanel() {
    const P = $('alPanel'); if (!P) return;
    const L = A.list.filter(a => tab === 'all' || a.t === tab);
    const cnt = k => A.list.filter(a => !a.read && (k === 'all' || a.t === k)).length;
    P.innerHTML = `<div class="alh"><b>알림</b>${busy ? '<small>실거래 확인 중…</small>' : A.last ? `<small>실거래 확인 ${md(A.last)} ${new Date(A.last).toTimeString().slice(0, 5)}</small>` : ''}<button type="button" id="alAll">모두 읽음</button></div>
      <div class="altabs">${TABS.map(([k, t]) => `<button type="button" data-at="${k}" aria-pressed="${tab === k}">${t}${cnt(k) ? ' ' + cnt(k) : ''}</button>`).join('')}</div>
      <div class="allist">${L.length ? L.map(a => itemHtml(a, A.list.indexOf(a))).join('') : '<div class="alnone">알림이 없습니다</div>'}</div>
      <div class="alft">실거래는 계약 후 최대 30일 뒤에 신고되어 알림도 그만큼 늦을 수 있습니다. 같은 층·면적 거래를 찾아 알려 드리는 것이라 꼭 확인해 주세요.</div>`;
    P.querySelectorAll('[data-at]').forEach(b => b.onclick = () => { tab = b.dataset.at; drawPanel(); });
    $('alAll').onclick = () => { A.list.forEach(a => { a.read = true; }); save(); badge(); drawPanel(); };
    P.querySelectorAll('[data-ai]').forEach(el => el.onclick = () => { const a = A.list[+el.dataset.ai]; if (!a) return; a.read = true; save(); badge(); drawPanel(); if (a.go) { P.hidden = true; go(a.go); } });
  }
  function toggle() { const P = $('alPanel'); P.hidden = !P.hidden; if (!P.hidden) drawPanel(); }
  function go(g) { if (g.ls) H.goList(g.ls); else if (g.cx) H.goDanji(g.cx, g.key); else if (g.cu && H.goCust) H.goCust(g.cu); }
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
      if (left > 0 && left <= 3 * DAY) push({ id: `pub3:${x.id}:${x.pub.exp.slice(0, 10)}`, t: 'pub', title: '리얼맵 게시가 곧 끝납니다', body: `${nm} · ${md(x.pub.exp)}까지. 아직 거래 가능하면 연장해 주세요.`, go: { ls: x.id }, goTx: '이동' });
      if (left <= 0) push({ id: `pubx:${x.id}:${x.pub.exp.slice(0, 10)}`, t: 'pub', title: '리얼맵 게시 기간이 끝났습니다', body: `${nm} · 지도에서 내려갔습니다. 다시 게시하려면 [기간만료 ▾]를 눌러 주세요.`, go: { ls: x.id }, goTx: '이동' });
    }
    // 1-1) 꼭 챙길 것 (매물관리)
    const impStep = d => { const dl = Math.round((Date.parse(d + 'T00:00:00+09:00') - now) / DAY); return { dl, step: dl < 0 ? (dl >= -3 ? 'x' : null) : dl === 0 ? 0 : dl <= 1 ? 1 : dl <= 7 ? 7 : null }; };
    const impPush = (key, lab, txt, d, go) => { const { dl, step } = impStep(d); if (step == null) return; push({ id: `imp:${key}:${d}:${step}`, t: 'imp', title: step === 'x' ? `챙길 날짜가 지났습니다 · ${lab}` : step === 0 ? `오늘 챙길 것 · ${lab}` : `${step === 1 ? '내일' : '7일 안'} 챙길 것 · ${lab}`, body: `${txt} (${d.slice(5).replace('-', '/')}${dl ? `, D${dl > 0 ? '-' + dl : '+' + -dl}` : ''})`, go, goTx: '이동' }); };
    for (const x of H.items()) if (x.imp && x.impd && x.status !== 'done') impPush(`ls:${x.id}`, H.name(x), x.imp, x.impd, { ls: x.id });
    // 매물의 만기일 (10/26 — 상가·건물 등 표의 '만기일' 칸): 6개월 · 3개월 · 1개월 전 · 지난 뒤 한 달
    for (const x of H.items()) {
      if (!x.exp || x.status === 'done') continue;
      const dl = Math.round((Date.parse(x.exp + 'T00:00:00+09:00') - now) / DAY), step = dl < 0 ? (dl >= -30 ? 0 : null) : dl <= 30 ? 30 : dl <= 90 ? 90 : dl <= 183 ? 180 : null;
      if (step == null) continue;
      push({ id: `lexp:${x.id}:${x.exp}:${step}`, t: 'exp', title: step === 0 ? '만기일이 지났습니다' : `만기 ${step === 180 ? '6개월' : step === 90 ? '3개월' : '1개월'} 전`, body: `${H.name(x)} 만기 ${x.exp.replace(/-/g, '.')} (D${dl >= 0 ? '-' + dl : '+' + -dl}). 재계약·이사 의향을 확인해 보세요.`, go: { ls: x.id }, goTx: '이동' });
    }
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
          else if (was === 'over' && z.g === 'ok') push({ id: `cmd:${c.id}:${z.key}:${new Date().toISOString().slice(0, 10)}`, t: 'cust', title: `${nm} 고객 예산 안으로 들어왔습니다`, body: `${z.label} — 가격이 예산 안으로 내려왔습니다.`, go: z.go, goTx: '이동' });
        }
        cm[c.id] = { u: c.up, m: cur };
        const base = c.last || c.at, d = Math.floor((now - Date.parse(base)) / DAY);
        if (d >= 30) push({ id: `cold:${c.id}:${String(base).slice(0, 10)}`, t: 'cust', title: '오래 연락 못 한 고객', body: `${nm}${c.phone ? ' ' + c.phone : ''} · 마지막 연락 ${d}일 전. 새로 나온 매물을 안내해 보세요.`, go: { cu: c.id }, goTx: '이동' });
      }
      A.cm = cm;
    } catch { /* 고객관리를 못 쓰는 회원 */ }
    if (lite) { prune(); save(); badge(); drawIfOpen(); toast(fresh); return; }
    // 2) 단지 장부: 만기 · 거래 의심
    let cxs = [];
    try { const j = await H.api('/api/auth?action=cx'); cxs = (j.items || []).slice(0, Math.max(0, (H.plan().cx || 10))); } catch { cxs = []; }
    const LED = {};
    await Promise.all(cxs.map(async c => { try { LED[c.id] = (await H.api(`/api/auth?action=hj&id=${encodeURIComponent(c.id)}`)).units || {}; } catch { LED[c.id] = null; } }));
    for (const c of cxs) {
      const U = LED[c.id]; if (!U) continue;
      for (const [key, r] of Object.entries(U)) {
        if (r && r.imp && r.impd) { const [, dn0, ho0] = key.split('|'); impPush(`cx:${c.id}:${key}`, `${c.name} ${dn0}-${ho0}`, r.imp, r.impd, { cx: c.id, key }); }
        if (!r || !r.exp) continue;   // 10/26: 계약 기록 뒤에도 새 만기로 알림 (계약하면 만기가 새 계약 만기로 바뀜)
        const dl = Math.round((Date.parse(r.exp) - now) / DAY), [, dn, ho] = key.split('|'), lab = `${c.name} ${dn}-${ho}`;
        const step = dl < 0 ? (dl >= -30 ? 0 : null) : dl <= 30 ? 30 : dl <= 90 ? 90 : dl <= 183 ? 180 : null;
        if (step == null) continue;
        push({ id: `exp:${c.id}:${key}:${r.exp}:${step}`, t: 'exp', title: step === 0 ? `만기일이 지났습니다 · ${dn}-${ho}` : `만기 ${step === 180 ? '6개월' : step === 90 ? '3개월' : '1개월'} 전 · ${dn}-${ho}`, body: `${lab} 세입자 만기 ${r.exp.replace(/-/g, '.')} (D${dl >= 0 ? '-' + dl : '+' + -dl}). 재계약·이사 의향을 확인해 보세요.`, go: { cx: c.id, key }, goTx: '이동' });
      }
    }
    // 3) 실거래 확인 (6시간에 한 번)
    if (force || now - (A.last || 0) > CHECK_EVERY) {
      busy = true; drawIfOpen();
      try { await checkDeals(cxs, LED, push); A.last = Date.now(); } catch { /* 다음에 */ }
      busy = false;
    }
    prune(); save(); badge(); drawIfOpen();
    const PR = { imp: 0, deal: 1, cust: 2, exp: 3, pub: 4 };
    toast(fresh.sort((x, y) => PR[x.t] - PR[y.t]));
  }
  const drawIfOpen = () => { const P = $('alPanel'); if (P && !P.hidden) drawPanel(); };
  const limit = async (list, n, fn) => { const out = []; let i = 0; await Promise.all(Array.from({ length: Math.min(n, list.length) }, async () => { while (i < list.length) { const k = i++; try { out[k] = await fn(list[k]); } catch { out[k] = null; } } })); return out; };
  const umdOf = addr => (String(addr || '').split(' ').find(w => /(동|가|리)\d*$/.test(w) && !/[시군구]$/.test(w)) || '');
  const baseName = s => String(s || '').replace(/\s|\(.*?\)|아파트|APT/gi, '').replace(/\d+단지$/, '');
  const floorOfHo = ho => { const d = digits(ho); return d.length >= 3 ? String(+d.slice(0, -2)) : ''; };
  const kindOf = t => /Rent$/.test(t.kind) ? (t.rent ? 'wolse' : 'jeonse') : 'sale';
  const priceTx = t => kindOf(t) === 'sale' ? `매매 ${won(t.price)}` : kindOf(t) === 'jeonse' ? `전세 ${won(t.deposit)}` : `월세 ${won(t.deposit)}/${t.rent}`;
  async function checkDeals(cxs, LED, push) {
    const since = Date.now() - 75 * DAY;
    // 단지 장부: 내 매물·타부동산 매물이 걸린 호 ↔ 같은 층·면적(·동) 아파트 거래
    await limit(cxs, 3, async c => {
      const U = LED[c.id]; if (!U) return;
      const rows = Object.entries(U).filter(([, r]) => r && r.st && r.st.src && !r.st.hold && !r.deal);
      if (!rows.length) return;
      const p0 = (c.places || [])[0]; if (!p0) return;
      const j = await H.api(`/api/trades?${new URLSearchParams({ pnu: p0.pnu, kinds: 'apt,aptRent', months: 3, umd: umdOf(p0.addr), name: baseName(c.name), np: '1' })}`);
      for (const t of (j.rows || []).filter(t => !t.cancel && tradeDay(t) >= since)) {
        const k = kindOf(t);
        for (const [key, r] of rows) {
          const [, dn, ho] = key.split('|');
          if (floorOfHo(ho) !== String(+digits(t.floor) || '')) continue;
          if (t.aptDong && digits(t.aptDong) && digits(dn) && digits(t.aptDong) !== digits(dn)) continue;
          if (r.ar && t.ex && !near(t.ex, r.ar)) continue;
          if ((r.st.k || []).length && !(r.st.k || []).includes(k)) continue;
          const mine = r.st.src === 'mine';
          push({ id: `deal:${c.id}:${key}:${t.kind}:${t.date}:${t.price || t.deposit}`, t: 'deal', title: `거래된 것 같습니다 · ${mine ? '내 매물' : '타부동산 매물'}`, body: `${c.name} ${t.aptDong ? t.aptDong + ' ' : ''}${t.floor}층${t.ex ? ' ' + Math.round(t.ex) + '㎡' : ''} ${priceTx(t)} 신고 (계약 ${t.date}). 장부의 ${dn}-${ho}${mine ? '(내 매물)' : r.st.office ? `(${r.st.office})` : ''}와 같은 층${r.ar && t.ex ? '·면적' : ''}입니다.`, sub: '실거래', go: { cx: c.id, key }, goTx: '이동' });
        }
      }
    });
    // 매물장: 진행 중인 내 매물 ↔ 같은 필지 거래 (아파트·오피스텔·빌라는 층·면적까지, 나머지는 면적으로 한 번 더 확인)
    const KMAP = { 아파트: 'apt,aptRent', 오피스텔: 'offi,offiRent', 빌라: 'rh,rhRent', 주택: 'sh,shRent', 상가: 'nrg', 사무실: 'nrg', 건물: 'nrg', '공장·창고': 'indu', 토지: 'land' };
    const ls = H.items().filter(x => x.status === 'on' && KMAP[x.ptype] && x.pnu).slice(0, 40);
    await limit(ls, 3, async x => {
      const p0 = (x.places && x.places[0]) || {}, unit = /아파트|오피스텔|빌라/.test(x.ptype), whole = p0.ak === 'tot' || x.ptype === '토지';
      const area = x.ptype === '토지' ? x.area : whole ? (p0.site || x.area) : x.area;
      const j = await H.api(`/api/trades?${new URLSearchParams({ pnu: p0.pnu || x.pnu, kinds: KMAP[x.ptype], months: 3, umd: umdOf(p0.addr || x.addr), ...(area ? { area } : {}), name: baseName(x.bname || ''), np: '1' })}`);
      const after = Math.max(since, Date.parse(x.at || 0) - 14 * DAY);
      for (const t of (j.rows || []).filter(t => !t.cancel && tradeDay(t) >= after)) {
        if (unit) { if (!p0.ho || floorOfHo(p0.ho) !== String(+digits(t.floor) || '')) continue; if (x.area && t.ex && !near(t.ex, x.area)) continue; }
        else if (t.approx === 'jibun') continue;                                  // 지번이 가려지고 면적도 확인 못 한 거래는 빼기
        if (kindOf(t) !== (x.kind === 'presale' ? 'sale' : x.kind)) continue;
        push({ id: `deal:ls:${x.id}:${t.kind}:${t.date}:${t.price || t.deposit}`, t: 'deal', title: '거래된 것 같습니다 · 내 매물', body: `${H.name(x)} — 같은 ${unit ? '층·면적' : t.approx ? '필지(면적 일치)' : '필지'}에서 ${priceTx(t)} 신고 (계약 ${t.date}). 내 매물(${x.kind === 'sale' ? '매매 ' + won(x.price) : x.kind === 'jeonse' ? '전세 ' + won(x.deposit) : '월세'})인지 확인해 보세요.`, sub: '실거래', go: { ls: x.id }, goTx: '이동' });
      }
    });
  }
  let softT = null;
  const soft = () => { clearTimeout(softT); softT = setTimeout(() => run(false, true), 2500); };
  return { mount, run: () => run(true), soft, _state: () => A };
})();
