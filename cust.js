// 리얼맵 매물장 '고객관리' 모드 (10/26)
// 매수·임차 고객의 조건을 표 하나로. 한 줄로 쓰면 칸이 알아서 나뉘고, 줄을 펼치면 조건에 맞는 매물(내 매물 + 단지 장부의 매물)이 보입니다.
// 저장은 서버(api/_cust.js, 암호화). listings.js에서 Cust.mount(요소, host) · Cust.refresh() · Cust.matchesFor(매물)
window.Cust = (() => {
  const $ = id => document.getElementById(id);
  const PY = 3.3058, DAY = 86400e3;
  const KN = { sale: '매수', jeonse: '전세', wolse: '월세' };
  const PT = ['아파트', '빌라', '오피스텔', '주택', '상가', '사무실', '건물', '공장·창고', '토지'];
  const STN = { on: '찾는 중', hold: '보류', done: '계약 완료' };
  let H = null, X = null, EL = null;
  const C = { items: [], limit: null, loaded: false, err: '', st: 'on', k: 'all', q: '', open: new Set(), hl: null, addQ: '', led: null, ledAt: 0 };
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const sw = man => !man ? '' : man >= 10000 ? `${(man / 10000).toFixed(man % 10000 ? 1 : 0).replace(/\.0$/, '')}억` : `${Math.round(man).toLocaleString()}만`;
  const fmtPhone = p => { const d = String(p || '').replace(/\D/g, ''); return d.length === 11 ? d.replace(/^(\d{3})(\d{4})(\d{4})$/, '$1-$2-$3') : d.length === 10 ? d.replace(/^(02)(\d{4})(\d{4})$/, '$1-$2-$3').replace(/^(\d{3})(\d{3})(\d{4})$/, '$1-$2-$3') : String(p || '').trim(); };
  // 금액: '7억' '3억2천' '5000' '5천' → 만원
  function man(s) {
    s = String(s ?? '').replace(/[,\s원]/g, ''); if (!s) return null;
    let m, t = 0;
    if ((m = s.match(/^([\d.]+)억(.*)$/))) { t += parseFloat(m[1]) * 10000; s = m[2]; }
    if (s) { if ((m = s.match(/^([\d.]+)천(만)?$/))) t += parseFloat(m[1]) * 1000; else if ((m = s.match(/^([\d.]+)(만)?$/))) t += parseFloat(m[1]); else return NaN; }
    return t > 0 ? Math.round(t) : null;
  }
  async function api(url, body) {
    const r = await fetch(url, { credentials: 'same-origin', ...(body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.ok === false) { const e = new Error(j.message || '잠시 연결이 원활하지 않습니다.'); e.code = j.error; throw e; }
    return j;
  }

  // ---------- 한 줄 입력 → 고객 조건 ----------
  // 예) 김사장 010-1234-5678 아현동 공덕동 전세 7억 25평 3월 입주
  const MONEYW = '([\\d.]+억(?:\\s*[\\d.]+천(?:만)?|\\s*[\\d,]+만|[\\d,]+)?|[\\d.]+천(?:만)?|[\\d,]+(?:만)?)';
  function parse(text) {
    let s = ' ' + String(text || '').trim() + ' ';
    const o = { name: '', phone: '', k: [], pt: [], bmax: null, dmax: null, rmax: null, amin: null, amax: null, where: [], movein: '', memo: '' };
    const cut = re => { const m = s.match(re); if (m) s = s.replace(m[0], ' '); return m; };
    let m;
    if ((m = cut(/0\d{1,2}[-\s]?\d{3,4}[-\s]?\d{4}/))) o.phone = fmtPhone(m[0]);
    // 월세: '월세 5000/300', '보증금 5천 월 300'
    if ((m = cut(new RegExp(`(?:월세|임대)\\s*${MONEYW}\\s*/\\s*([\\d,]+)`)))) { o.k.push('wolse'); o.dmax = man(m[1]); o.rmax = man(m[2]); }
    else if ((m = cut(new RegExp(`보증금\\s*${MONEYW}\\s*(?:월세?|월)\\s*([\\d,]+)`)))) { o.k.push('wolse'); o.dmax = man(m[1]); o.rmax = man(m[2]); }
    else if ((m = cut(/(?:월세|임대)(?=\s)/))) o.k.push('wolse');
    if ((m = cut(new RegExp(`전세\\s*${MONEYW}(?:\\s*이하)?`)))) { o.k.push('jeonse'); o.bmax = man(m[1]); }
    else if ((m = cut(/전세(?=\s)/))) o.k.push('jeonse');
    if ((m = cut(new RegExp(`(?:매매|매수|구매)\\s*${MONEYW}(?:\\s*이하)?`)))) { o.k.push('sale'); o.bmax = man(m[1]); }
    else if ((m = cut(/(?:매매|매수|구매)(?=\s)/))) o.k.push('sale');
    if (o.bmax == null && (m = cut(new RegExp(`(?:예산|자금)?\\s*${MONEYW}\\s*이하`)))) o.bmax = man(m[1]);
    // 면적
    if ((m = cut(/(\d{1,4}(?:\.\d)?)\s*[~\-]\s*(\d{1,4}(?:\.\d)?)\s*평/))) { o.amin = +m[1]; o.amax = +m[2]; }
    else if ((m = cut(/(\d{1,4}(?:\.\d)?)\s*평\s*(이하|미만)/))) o.amax = +m[1];
    else if ((m = cut(/(\d{1,4}(?:\.\d)?)\s*평\s*(이상|대|정도)?/))) o.amin = +m[1];
    else if ((m = cut(/(\d{2,4}(?:\.\d+)?)\s*(?:㎡|m2|제곱미터)/))) o.amin = Math.round(+m[1] / PY * 10) / 10;
    // 입주
    if ((m = cut(/(\d{2,4})[.년]\s*(\d{1,2})월?\s*(?:입주|이사)?/))) o.movein = `${m[1].length === 2 ? '20' + m[1] : m[1]}.${m[2]}`;
    else if ((m = cut(/(\d{1,2})\s*월\s*(?:초|중순|말)?\s*(?:입주|이사)/))) { const now = new Date(), mo = +m[1], y = now.getFullYear() + (mo < now.getMonth() + 1 ? 1 : 0); o.movein = `${y}.${mo}`; }
    else if ((m = cut(/즉시\s*(?:입주|이사)?/))) o.movein = '즉시';
    // 유형
    const TYW = [['아파트', /아파트/], ['빌라', /빌라|다세대|연립/], ['오피스텔', /오피스텔/], ['주택', /단독|다가구|주택/], ['상가', /상가|점포/], ['사무실', /사무실/], ['건물', /통건물|꼬마빌딩|빌딩|건물/], ['공장·창고', /공장|창고/], ['토지', /토지|땅|대지/]];
    for (const [t, re] of TYW) if (cut(new RegExp(`(?:^|\\s)(?:${re.source})(?=\\s)`))) o.pt.push(t);
    // 남은 말: 첫 단어 = 이름, 동네·단지 이름 = 지역, 나머지 = 메모
    const rest = s.split(/\s+/).filter(Boolean), memo = [];
    rest.forEach((w, i) => {
      if (!o.name && i === 0 && /^[가-힣A-Za-z]{1,8}$/.test(w) && !/(동|가|구|리|읍|면|시)$/.test(w)) { o.name = w; return; }
      if (/^[가-힣0-9]{2,}(동|가|구|리|읍|면|역)$/.test(w) || /래미안|자이|푸르지오|아이파크|힐스테이트|이편한|e편한|롯데캐슬|센트럴|삼성|현대|단지|타운|파크|팰리스|캐슬/.test(w)) { o.where.push(w); return; }
      memo.push(w);
    });
    if (!o.name && memo.length && /^[가-힣]{2,6}$/.test(memo[0])) o.name = memo.shift();
    o.memo = memo.join(' ');
    o.k = [...new Set(o.k)];
    return o;
  }
  const chipsOf = o => [o.name && `이름 ${o.name}`, o.phone, o.pt.length && o.pt.join('·'), o.k.filter(k => !(k === 'wolse' && (o.dmax || o.rmax)) && !(k !== 'wolse' && o.bmax)).map(k => KN[k]).join('·'), o.bmax && `${o.k.includes('sale') ? '매매' : o.k.includes('jeonse') ? '전세' : '예산'} ${sw(o.bmax)} 이하`, (o.dmax || o.rmax) && `월세 ${sw(o.dmax) || '-'}/${o.rmax || '-'} 이하`, o.amin && `${o.amin}평 이상`, o.amax && `${o.amax}평 이하`, o.where.length && `지역 ${o.where.join('·')}`, o.movein && `입주 ${o.movein}`, o.memo && `메모 "${o.memo}"`].filter(Boolean);

  // ---------- 맞는 매물 ----------
  // 후보 = 매물장의 진행 중 매물 + 단지 장부에서 상태가 걸린 호(보류·계약됨 제외, 매물장과 겹치면 매물장 쪽만)
  async function loadLedgers(force) {
    if (C.led && !force && Date.now() - C.ledAt < 10 * 60e3) return C.led;
    const out = [];
    try {
      const j = await api('/api/auth?action=cx'), cxs = (j.items || []).slice(0, Math.max(0, (H.plan().cx || 10)));
      await Promise.all(cxs.map(async cx => {
        let U = null; try { U = (await api(`/api/auth?action=hj&id=${encodeURIComponent(cx.id)}`)).units || {}; } catch { U = null; }
        if (!U) return;
        const addr = ((cx.places || [])[0] || {}).addr || '';
        for (const [key, r] of Object.entries(U)) {
          if (!r || !r.st || !r.st.src || r.st.hold || r.deal) continue;
          const [pnu, dn, ho] = key.split('|');
          out.push({ src: 'led', cx: cx.id, key, pnu, dn, ho, name: cx.name, addr, mine: r.st.src === 'mine', office: r.st.office || '', ks: r.st.k && r.st.k.length ? r.st.k : ['sale'], pr: r.pr || {}, area: r.ar || 0, ptype: '아파트' });
        }
      }));
    } catch { /* 장부 없이 매물장만 */ }
    C.led = out; C.ledAt = Date.now();
    return out;
  }
  function pool() {
    const ls = H.items().filter(x => x.status === 'on').map(x => {
      const p0 = (x.places && x.places[0]) || {};
      return { src: 'ls', id: x.id, x, pnu: p0.pnu || x.pnu, dn: String(p0.dong || '').replace(/동$/, ''), ho: String(p0.ho || '').replace(/호$/, ''), name: x.bname || '', addr: [x.addr, x.road, ...(x.places || []).map(p => p.addr)].join(' '), mine: true, ks: [x.kind === 'presale' ? 'sale' : x.kind], pr: { sale: x.kind === 'sale' ? x.price : x.kind === 'presale' ? (x.price || 0) + (x.pr || 0) : 0, jeonse: x.kind === 'jeonse' ? x.deposit : 0, wd: x.kind === 'wolse' ? x.deposit : 0, wr: x.kind === 'wolse' ? x.rent : 0 }, area: x.area || 0, ptype: (X && X.tbase ? X.tbase(x) : x.ptype) || '' };
    });
    const seen = new Set(ls.map(m => `${m.pnu}|${m.dn}|${m.ho}`));
    return [...ls, ...(C.led || []).filter(m => !seen.has(`${m.pnu}|${m.dn}|${m.ho}`))];
  }
  const sameType = (want, t) => !want.length || want.includes(t) || (want.includes('건물') && /건물/.test(t)) || (want.includes('상가') && t === '사무실' && false);
  // 한 고객 × 한 매물 → null(안 맞음) 또는 { g:'ok'|'over', k, price, over }
  function judge(c, m) {
    const ks = (c.k.length ? c.k : ['sale', 'jeonse', 'wolse']).filter(k => m.ks.includes(k));
    if (!ks.length) return null;
    if (!sameType(c.pt, m.ptype)) return null;
    if (c.where.length) { const hay = `${m.addr} ${m.name}`.replace(/\s/g, ''); if (!c.where.some(w => hay.includes(w.replace(/\s/g, '')))) return null; }
    const py = m.area ? m.area / PY : null;
    if (py && c.amin && py < c.amin * 0.93) return null;
    if (py && c.amax && py > c.amax * 1.07) return null;
    let best = null;
    for (const k of ks) {
      let over = 0, ok = true, price = k === 'sale' ? m.pr.sale : k === 'jeonse' ? m.pr.jeonse : null;
      if (k === 'wolse') {
        const d = m.pr.wd || 0, r = m.pr.wr || 0;
        if (c.dmax && d > c.dmax) { if (d > c.dmax * 1.2) ok = false; else over = Math.max(over, d - c.dmax); }
        if (c.rmax && r > c.rmax) { if (r > c.rmax * 1.2) ok = false; else over = Math.max(over, r - c.rmax); }
        price = `${sw(d) || '0'}/${r || '-'}`;
      } else if (c.bmax && price) { if (price > c.bmax * 1.2) ok = false; else if (price > c.bmax) over = price - c.bmax; }
      if (!ok) continue;
      const r = { g: over ? 'over' : 'ok', k, price, over, dist: k === 'wolse' ? 0 : c.bmax && price ? Math.abs(c.bmax - price) / c.bmax : 1 };
      if (!best || (best.g === 'over' && r.g === 'ok') || (best.g === r.g && r.dist < best.dist)) best = r;
    }
    return best;
  }
  function matches(c) {
    return pool().map(m => ({ m, j: judge(c, m) })).filter(z => z.j).sort((a, b) => (a.j.g === b.j.g ? 0 : a.j.g === 'ok' ? -1 : 1) || (a.m.src === b.m.src ? 0 : a.m.src === 'ls' ? -1 : 1) || a.j.dist - b.j.dist);
  }
  // 매물 쪽에서: 이 매물에 맞는 고객 (2차에서 매물 상세에 표시)
  function matchesFor(x) { const m = pool().find(z => z.src === 'ls' && z.id === x.id); return m ? C.items.filter(c => c.status === 'on').map(c => ({ c, j: judge(c, m) })).filter(z => z.j) : []; }

  // ---------- 그리기 ----------
  async function mount(el, host) {
    H = host; X = host.X; EL = el;
    EL.innerHTML = `<div class="lv-wrap bd cu" id="cuW"><div class="cu-bar" id="cuBar"></div>
      <div class="bd-add"><div class="bd-addin"><span class="plus">＋</span><input id="cuQ" autocomplete="off" enterkeyhint="done" placeholder="한 줄로 쓰고 Enter (예: 김사장 010-1234-5678 아현동 공덕동 전세 7억 25평 3월 입주)"></div><div id="cuPv" class="cu-pv"></div></div>
      <div class="bd-t" id="cuT"><div class="cu-none">고객 목록을 불러오는 중…</div></div></div>`;
    const q = $('cuQ');
    q.oninput = () => { C.addQ = q.value; drawPv(); };
    q.onkeydown = e => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); quickAdd(); } if (e.key === 'Escape') { q.value = ''; C.addQ = ''; drawPv(); } };
    if (!C.loaded) await load(); else draw();
    loadLedgers().then(() => draw());
  }
  async function load() {
    try { const j = await api('/api/auth?action=cu'); C.items = j.items || []; C.limit = j.limit; C.err = ''; }
    catch (e) { C.err = e.message; C.code = e.code; }
    C.loaded = true; draw();
  }
  // 고객관리 화면을 열지 않아도 매물 상세의 '맞는 고객'·알림이 쓰도록 미리 불러 둠
  let readyP = null;
  function init(host) { if (!H) { H = host; X = host.X; } return ready(); }
  function ready() { if (!readyP) readyP = (async () => { if (!C.loaded) await load(); await loadLedgers(); })(); return readyP; }
  // 알림용: 찾는 중인 고객마다 지금 맞는 매물 목록 [{ c, list:[{ key, g, label, go }] }]
  function snapshot() {
    return C.items.filter(c => c.status === 'on').map(c => ({ c, list: matches(c).map(({ m, j }) => ({ key: m.src === 'ls' ? 'ls:' + m.id : `led:${m.cx}:${m.key}`, g: j.g, label: `${m.src === 'ls' ? (m.name || (m.x.addr || '').split(' ').slice(-2).join(' ')) : m.name}${m.dn || m.ho ? ' ' + [m.dn && m.dn + '동', m.ho && m.ho + (/(층|호)$/.test(m.ho) ? '' : '호')].filter(Boolean).join(' ') : ''} ${j.k === 'sale' ? '매매' : KN[j.k]} ${typeof j.price === 'number' ? sw(j.price) : j.price || ''}`.trim(), go: m.src === 'ls' ? { ls: m.id } : { cx: m.cx, key: m.key } })) }));
  }
  // 다른 화면에서 '이동': 그 고객을 펼쳐서 보여 줌
  function reveal(id) {
    const c = C.items.find(z => z.id === id); if (!c) return;
    if (C.st !== 'all' && c.status !== C.st) C.st = 'all';
    C.k = 'all'; C.q = ''; C.open.add(id); C.hl = id; draw();
    setTimeout(() => { const r = document.querySelector(`#cuT tr[data-cid="${id}"]`); if (r) r.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, 60);
  }
  function refresh() { if (EL && $('cuW')) draw(); }
  const custLine = c => [c.pt.join('·'), c.k.map(k => KN[k]).join('·'), c.bmax && `${sw(c.bmax)} 이하`, (c.dmax || c.rmax) && `월 ${sw(c.dmax) || '-'}/${c.rmax || '-'}`, c.amin && `${c.amin}평↑`, c.where.join('·')].filter(Boolean).join(' · ');
  function drawPv() {
    const o = parse(C.addQ), el = $('cuPv'); if (!el) return;
    if (!C.addQ.trim()) { el.innerHTML = ''; return; }
    const n = (o.name || o.phone) ? matches({ ...o, status: 'on' }).length : 0;
    el.innerHTML = `→ ${chipsOf(o).map(t => `<span>${esc(t)}</span>`).join('')}${o.name || o.phone ? `<b>맞는 매물 ${n}건</b> <small>Enter = 저장</small>` : '<small>이름이나 연락처를 넣어 주세요</small>'}`;
  }
  async function quickAdd() {
    const o = parse(C.addQ);
    if (!o.name && !o.phone) return H.toast('이름이나 연락처를 넣어 주세요');
    try {
      const j = await api('/api/auth?action=cu', { op: 'save', item: o });
      C.items = j.items; C.limit = j.limit; C.addQ = ''; if (window.Alarm && Alarm.soft) Alarm.soft(); $('cuQ').value = ''; drawPv();
      C.st = 'on'; C.open.add(j.item.id); C.hl = j.item.id; draw();
      H.toast(`${j.item.name || j.item.phone} 고객을 저장했습니다`);
    } catch (e) { if (e.code === 'limit') H.upsell(e.message); else H.toast(e.message, 4000); }
  }
  async function op(body, msg) {
    try { const j = await api('/api/auth?action=cu', body); C.items = j.items; draw(); if (window.Alarm && Alarm.soft) Alarm.soft(); if (msg) H.toast(msg); return j; }
    catch (e) { H.toast(e.message, 4000); draw(); }
  }
  const rows = () => C.items.filter(c => (C.st === 'all' || c.status === C.st) && (C.k === 'all' || c.k.includes(C.k)) && (!C.q || [c.name, c.phone, c.where.join(' '), c.note, c.memo, c.pt.join(' ')].join(' ').toLowerCase().includes(C.q.toLowerCase())));
  function drawBar() {
    const cnt = s => C.items.filter(c => s === 'all' || c.status === s).length;
    $('cuBar').innerHTML = `<div class="bd-row"><span class="bsg">${['on', 'hold', 'done', 'all'].map(s => `<button type="button" data-cs="${s}" aria-pressed="${C.st === s}">${s === 'all' ? '전체' : STN[s]} <small>${cnt(s)}</small></button>`).join('')}</span>
      <span class="bsg sm">${[['all', '전체'], ['sale', '매수'], ['jeonse', '전세'], ['wolse', '월세']].map(([k, t]) => `<button type="button" data-ck="${k}" aria-pressed="${C.k === k}">${t}</button>`).join('')}</span>
      <input class="bd-find" id="cuFind" type="search" placeholder="이름·연락처·지역·메모 찾기" value="${esc(C.q)}">
      <span class="sp"></span><small class="cu-lim">${C.limit ? `${C.items.length} / ${C.limit.toLocaleString()}명` : `${C.items.length}명`}</small></div>`;
    $('cuBar').querySelectorAll('[data-cs]').forEach(b => b.onclick = () => { C.st = b.dataset.cs; draw(); });
    $('cuBar').querySelectorAll('[data-ck]').forEach(b => b.onclick = () => { C.k = b.dataset.ck; draw(); });
    $('cuFind').oninput = e => { clearTimeout(C.fT); C.fT = setTimeout(() => { C.q = e.target.value.trim(); drawTable(); }, 250); };
  }
  const budget = c => [c.bmax && `${c.k.length === 1 && c.k[0] === 'jeonse' ? '전세 ' : ''}${sw(c.bmax)} 이하`, (c.dmax || c.rmax) && `월 ${sw(c.dmax) || '-'}/${c.rmax || '-'}`].filter(Boolean).join(' · ') || '<span class="ep">-</span>';
  const area = c => c.amin && c.amax ? `${c.amin}~${c.amax}평` : c.amin ? `${c.amin}평 이상` : c.amax ? `${c.amax}평 이하` : '<span class="ep">-</span>';
  const lastTx = c => { if (!c.last) return '<span class="ep">-</span>'; const D0 = new Date(c.last), d = Math.floor((Date.now() - D0) / DAY), t = `${D0.getMonth() + 1}/${D0.getDate()}`; return d >= 30 && c.status === 'on' ? `<span class="old">${t} · ${d}일</span>` : t; };
  function drawTable() {
    if (!$('cuT')) return;
    if (C.err) { $('cuT').innerHTML = `<div class="cu-none">${esc(C.err)}</div>`; return; }
    const L = rows();
    const body = L.map(c => {
      const M = matches(c), op = C.open.has(c.id);
      const memo0 = X.memoParse(c.memo)[0];
      return `<tr data-cid="${c.id}" class="${C.hl === c.id ? 'on' : ''}${c.status === 'done' ? ' dn' : ''}">
        <td class="c-nm"><b>${esc(c.name || '(이름 없음)')}</b><small>${c.phone ? `<a href="tel:${esc(c.phone.replace(/\D/g, ''))}" class="tl">${esc(c.phone)}</a>` : ''}</small></td>
        <td>${esc(c.pt.join('·')) || '<span class="ep">유형</span>'} ${c.k.map(k => `<span class="kd ${k}">${KN[k]}</span>`).join('')}</td>
        <td>${budget(c)}</td><td>${area(c)}</td><td class="c-wh">${esc(c.where.join(' · ')) || '<span class="ep">-</span>'}</td><td>${esc(c.movein) || '<span class="ep">-</span>'}</td>
        <td data-cst="${c.id}" class="c-st"><span class="st ${c.status}">${STN[c.status]}</span></td>
        <td><span class="mc${M.length ? '' : ' z'}">${M.length}</span></td>
        <td>${lastTx(c)}</td><td class="c-mm"><span class="mm">${esc(memo0 ? memo0.x : c.note || '')}</span></td>
        <td><button type="button" class="det${op ? ' on' : ''}" data-cdet="${c.id}">상세 ${op ? '▴' : '▾'}</button></td></tr>
        ${op ? `<tr class="bd-dt" data-cdt="${c.id}"><td colspan="11">${detailHtml(c, M)}</td></tr>` : ''}`;
    }).join('');
    $('cuT').innerHTML = `<div class="bd-scroll"><table class="bdt cut"><colgroup><col style="width:12%"><col style="width:11%"><col style="width:11%"><col style="width:8%"><col style="width:12%"><col style="width:6%"><col style="width:80px"><col style="width:70px"><col style="width:8%"><col style="width:16%"><col style="width:76px"></colgroup>
      <thead><tr><th>이름 · 연락처</th><th>찾는 것</th><th>예산</th><th>면적</th><th>지역 · 단지</th><th>입주</th><th>상태</th><th>맞는 매물</th><th>마지막 연락</th><th>메모</th><th></th></tr></thead>
      <tbody>${body || `<tr><td colspan="11" class="none">${C.items.length ? '조건에 맞는 고객이 없습니다.' : '<b>아직 등록한 고객이 없습니다</b>위 칸에 한 줄로 쓰고 Enter를 눌러 보세요.'}</td></tr>`}</tbody></table></div>`;
    wire();
  }
  function draw() {
    if (!$('cuW')) return;
    // 입력 중인 칸은 다시 그려도 그대로 (값·커서 유지)
    const a = document.activeElement, fk = a && a.dataset && a.dataset.fk && $('cuW').contains(a) ? a.dataset.fk : null;
    const val = fk ? a.value : null, s0 = fk ? a.selectionStart : null;
    drawBar(); drawTable();
    if (fk) { const n = $('cuW').querySelector(`[data-fk="${CSS.escape(fk)}"]`); if (n) { n.value = val; n.focus(); try { n.setSelectionRange(s0, s0); } catch { /* 무시 */ } } }
  }
  function detailHtml(c, M) {
    const chk = (k, on, t) => `<button type="button" class="cchip" data-${k}="${esc(on)}" aria-pressed="${t}">${esc(on === 'sale' ? '매수' : on === 'jeonse' ? '전세' : on === 'wolse' ? '월세' : on)}</button>`;
    const inp = (f, v, ph, w = '') => `<input class="ci ${w}" data-fk="cu:${c.id}:${f}" data-cf="${f}" value="${esc(v ?? '')}" placeholder="${ph}">`;
    const mrow = ({ m, j }) => `<tr><td><b>${esc(m.src === 'ls' ? (m.name || (m.x.addr || '').split(' ').slice(-2).join(' ')) : m.name)}${m.dn || m.ho ? ` ${esc([m.dn && m.dn + '동', m.ho && m.ho + (/(층|호)$/.test(m.ho) ? '' : '호')].filter(Boolean).join(' '))}` : ''}</b><small>${m.src === 'ls' ? '내 매물' : m.mine ? '단지 장부 · 내 매물' : `단지 장부 · ${esc(m.office || '타부동산')}`}</small></td>
      <td><span class="kd ${j.k}">${j.k === 'sale' ? '매매' : KN[j.k]}</span> ${esc(typeof j.price === 'number' ? sw(j.price) : j.price || '-')}</td><td>${m.area ? `${(m.area / PY).toFixed(1)}평` : '-'}</td>
      <td><span class="sc ${j.g}">${j.g === 'ok' ? '조건 맞음' : `예산 +${sw(j.over)}`}</span></td>
      <td>${m.src === 'ls' ? `<button type="button" class="b2" data-gls="${m.id}">이동</button>` : `<button type="button" class="b2" data-gcx="${esc(m.cx)}" data-gkey="${esc(m.key)}">이동</button>`}</td></tr>`;
    const L = X.memoParse(c.memo);
    return `<div class="dg"><div class="box"><div class="dt-h"><b>맞는 매물 ${M.length}건</b><small>내 매물 + 단지 장부 매물 · 조건에 가까운 순 · 예산을 20% 이내로 넘는 것은 노란색</small>${C.led ? '' : '<small>(단지 장부 불러오는 중…)</small>'}</div>
        ${M.length ? `<table class="ft cmt"><thead><tr><th>매물</th><th>가격</th><th>면적</th><th>맞음</th><th></th></tr></thead><tbody>${M.slice(0, 12).map(mrow).join('')}</tbody></table>${M.length > 12 ? `<div class="meta">외 ${M.length - 12}건 · 조건을 좁혀 보세요</div>` : ''}` : '<div class="meta" style="padding:8px 2px">지금은 조건에 맞는 매물이 없습니다. 조건을 넓히거나 매물을 등록하면 여기에 나타납니다.</div>'}</div>
      <div class="box"><div class="dt-h"><b>조건</b><small>고치고 나가면 저장</small></div>
        <div class="kv2 cuk"><label>이름${inp('name', c.name, '이름')}</label><label>연락처${inp('phone', c.phone, '010-0000-0000')}</label>
          <label class="w2">상태<div class="cchips">${Object.entries(STN).map(([k, t]) => `<button type="button" class="cchip st-${k}" data-cst2="${k}" aria-pressed="${c.status === k}">${t}</button>`).join('')}</div></label>
          <label class="w2">찾는 것<div class="cchips">${['sale', 'jeonse', 'wolse'].map(k => chk('ck2', k, c.k.includes(k))).join('')}</div></label>
          <label class="w2">유형<div class="cchips">${PT.map(t => chk('cpt', t, c.pt.includes(t))).join('')}</div></label>
          <label>매매·전세 예산 (이하)${inp('bmax', c.bmax ? sw(c.bmax) : '', '예) 7억')}</label><label>월세 보증금 / 월세 (이하)<div class="two2">${inp('dmax', c.dmax ? sw(c.dmax) : '', '5천')}${inp('rmax', c.rmax || '', '300')}</div></label>
          <label>면적 (평)<div class="two2">${inp('amin', c.amin || '', '이상')}${inp('amax', c.amax || '', '이하')}</div></label><label>입주${inp('movein', c.movein, '즉시 / 2027.3')}</label>
          <label class="w2">지역 · 단지 <small>쉼표로 여러 곳</small>${inp('where', c.where.join(', '), '아현동, 공덕동, 마포래미안')}</label>
          <label class="w2">한 줄 메모${inp('note', c.note, '신혼부부, 남향 선호')}</label></div>
        <div class="dt-h" style="margin-top:12px"><b>상담 기록</b>${c.phone ? `<a class="b2" href="tel:${esc(c.phone.replace(/\D/g, ''))}" data-call="${c.id}">☎ 전화</a>` : ''}<button type="button" class="b2" data-called="${c.id}">연락함 표시</button></div>
        <input class="in1" data-fk="cm:${c.id}" data-cmemo="${c.id}" placeholder="상담 내용 (Enter로 기록 · 마지막 연락일도 오늘로)">
        ${L.length ? `<ul class="ml">${L.slice(0, 6).map((e, i) => `<li><span>${esc(e.t ? e.t.slice(3) : '예전')}</span>${esc(e.x)} <button type="button" class="x" data-cmdel="${i}" aria-label="지우기">×</button></li>`).join('')}</ul>` : ''}
        <div class="dt-acts"><span class="sp"></span><small class="meta">등록 ${(d => `${d.getFullYear()}.${d.getMonth() + 1}.${d.getDate()}`)(new Date(c.at))}</small><button type="button" class="b del" data-cdel="${c.id}">고객 삭제</button></div></div></div>`;
  }
  function wire() {
    const T = $('cuT');
    T.querySelectorAll('[data-cdet]').forEach(b => b.onclick = e => { e.stopPropagation(); const id = b.dataset.cdet; C.open.has(id) ? C.open.delete(id) : C.open.add(id); C.hl = id; draw(); });
    T.querySelectorAll('tr[data-cid]').forEach(r => r.onclick = e => { if (e.target.closest('a,button,input')) return; const id = r.dataset.cid; if (e.target.closest('[data-cst]')) return statusPop(id, e.target.closest('td')); C.open.has(id) ? C.open.delete(id) : C.open.add(id); C.hl = id; drawTable(); });
    T.querySelectorAll('tr.bd-dt[data-cdt]').forEach(r => {
      const id = r.dataset.cdt, c = C.items.find(z => z.id === id); if (!c) return;
      const save = patch => op({ op: 'save', id, item: { ...c, ...patch } });
      r.querySelectorAll('[data-cf]').forEach(i => {
        i.onkeydown = e => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); i.blur(); } };
        i.onchange = () => setTimeout(() => {
          const f = i.dataset.cf, v = i.value.trim();
          if (['bmax', 'dmax'].includes(f)) { const n = man(v); if (Number.isNaN(n)) return H.toast('금액을 확인해 주세요 (예: 7억, 5천)'); return save({ [f]: n }); }
          if (['rmax'].includes(f)) return save({ rmax: man(v) });
          if (['amin', 'amax'].includes(f)) return save({ [f]: parseFloat(v) || null });
          if (f === 'where') return save({ where: v.split(/[,·/]/).map(w => w.trim()).filter(Boolean) });
          if (f === 'phone') return save({ phone: fmtPhone(v) });
          save({ [f]: v });
        }, 0);
      });
      r.querySelectorAll('[data-cst2]').forEach(b => b.onclick = () => { if (b.dataset.cst2 !== c.status) op({ op: 'status', id, status: b.dataset.cst2 }, `'${STN[b.dataset.cst2]}'(으)로 바꿨습니다`); });
      r.querySelectorAll('[data-ck2]').forEach(b => b.onclick = () => { const k = b.dataset.ck2; save({ k: c.k.includes(k) ? c.k.filter(z => z !== k) : [...c.k, k] }); });
      r.querySelectorAll('[data-cpt]').forEach(b => b.onclick = () => { const t = b.dataset.cpt; save({ pt: c.pt.includes(t) ? c.pt.filter(z => z !== t) : [...c.pt, t] }); });
      const mi = r.querySelector('[data-cmemo]'); if (mi) mi.onkeydown = e => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); const v = mi.value.trim(); if (v) op({ op: 'memo', id, text: v }, '상담 기록을 남겼습니다'); } };
      r.querySelectorAll('[data-cmdel]').forEach(b => b.onclick = () => { if (confirm('이 기록을 지울까요?')) op({ op: 'mdel', id, i: +b.dataset.cmdel }); });
      const cd = r.querySelector('[data-called]'); if (cd) cd.onclick = () => op({ op: 'called', id }, '오늘 연락한 것으로 표시했습니다');
      const call = r.querySelector('[data-call]'); if (call) call.addEventListener('click', () => op({ op: 'called', id }));
      const del = r.querySelector('[data-cdel]'); if (del) del.onclick = () => { if (confirm(`${c.name || c.phone} 고객을 삭제할까요? 상담 기록도 함께 지워지고 되돌릴 수 없습니다.`)) op({ op: 'del', id }, '삭제했습니다'); };
      r.querySelectorAll('[data-gls]').forEach(b => b.onclick = () => H.goList(b.dataset.gls));
      r.querySelectorAll('[data-gcx]').forEach(b => b.onclick = () => H.goDanji(b.dataset.gcx, b.dataset.gkey));
    });
  }
  function statusPop(id, td) {
    const c = C.items.find(z => z.id === id); if (!c) return;
    let p = $('cuPop'); if (!p) { p = document.createElement('div'); p.id = 'cuPop'; p.className = 'bd-pop cupop'; document.body.appendChild(p); document.addEventListener('mousedown', e => { if (!p.hidden && !p.contains(e.target)) p.hidden = true; }); }
    p.innerHTML = `<div class="pl">${Object.entries(STN).map(([k, t]) => `<button type="button" data-s="${k}" class="${c.status === k ? 'on' : ''}">${t}</button>`).join('')}</div>`;
    const r = td.getBoundingClientRect(); p.style.position = 'fixed'; p.style.left = r.left + 'px'; p.style.top = (r.bottom + 4) + 'px'; p.hidden = false;
    p.querySelectorAll('[data-s]').forEach(b => b.onclick = () => { p.hidden = true; if (b.dataset.s !== c.status) op({ op: 'status', id, status: b.dataset.s }); });
  }
  // 매물 상세용: 이 매물에 맞는 찾는 중 고객 (고객 이름 · 조건 한 줄 · 연락처)
  function forListing(x) { return matchesFor(x).map(({ c, j }) => ({ id: c.id, name: c.name || c.phone, phone: c.phone, line: custLine(c), g: j.g, over: j.over })); }
  return { init, ready, mount, refresh, reveal, snapshot, forListing, matchesFor, loaded: () => C.loaded, _parse: parse };
})();
