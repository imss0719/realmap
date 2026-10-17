/* 리얼맵 브리핑 자료 편집기 (회원 베타)
   리얼맵 지도에서 [브리핑]을 누르면 그 필지 정보가 브라우저에 담겨 이 화면으로 넘어옵니다.
   입력한 사진은 서버로 올라가지 않고 이 브라우저 안에서만 쓰입니다. */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const PY = 3.305785;
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const n = (v, d = 0) => v == null || isNaN(v) ? '-' : Number(v).toLocaleString('ko-KR', { minimumFractionDigits: d, maximumFractionDigits: d });
  const won = man => { if (man == null) return '-'; man = Math.round(man); const e = Math.floor(man / 10000), r = man % 10000; if (e && r) return `${e}억 ${n(r)}만원`; if (e) return `${e}억원`; return `${n(r)}만원`; };
  const arP = m2 => m2 ? `${n(m2, 2)}㎡ <small>(${n(m2 / PY, 1)}평)</small>` : '-';
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } },
  };

  const D = store.get('rm.brief', null);
  const root = $('root');
  if (!D || !D.pnu) {
    root.innerHTML = `<div class="gate"><img src="/favicon.svg" width="48" height="48" alt=""><h1>브리핑할 필지가 없습니다</h1><p>리얼맵 지도에서 필지를 고른 뒤, 패널의 [브리핑] 버튼을 눌러 주세요.</p><a class="btn primary" href="/">리얼맵으로 가기</a></div>`;
    return;
  }

  // ---------- 상태 ----------
  const autoTitle = D.name || String(D.addr || '').split(' ').slice(-2).join(' ');
  const DRAFT = 'rm.bdraft:' + D.pnu;
  const st = Object.assign({
    tpl: 'classic', color: 'navy', font: 'gothic', kind: '매매', price: '', jeonse: '', deposit: '', rent: '', fee: '', moveIn: '', incDep: '', incRent: '',
    title: autoTitle, intro: '', feats: '',
    show: { land: true, bld: !!D.bld, loc: true, map: true, trade: !!(D.trades && D.trades.length), feat: true },
  }, store.get(DRAFT, {}));
  if (!['매매', '전세', '월세'].includes(st.kind)) st.kind = '매매';
  st.photos = [];
  st.agent = Object.assign({ name: '리얼워커스 공인중개사사무소', ceo: '', reg: '', tel: '', addr: '', logo: '' }, store.get('rm.agent', {}));
  st.loc = null; st.mapSrc = '';
  const saveDraft = () => { const { photos, agent, loc, mapSrc, ...d } = st; store.set(DRAFT, d); };
  const saveAgent = () => { if (!store.set('rm.agent', st.agent)) { const { logo, ...a } = st.agent; store.set('rm.agent', a); } };

  // ---------- 회원 확인 ----------
  fetch('/api/auth?action=me').then(r => r.json()).then(me => {
    if (me.ready && !me.member) root.innerHTML = `<div class="gate"><img src="/favicon.svg" width="48" height="48" alt=""><h1>회원 전용 기능입니다</h1><p>브리핑 자료 만들기는 리얼맵 회원이면 베타 기간 동안 무료로 이용하실 수 있습니다.</p><a class="btn primary" href="/auth/login?r=${encodeURIComponent('/?pnu=' + D.pnu)}">카카오로 로그인</a></div>`;
  }).catch(() => {});

  // ---------- 화면 ----------
  const TPL = [
    ['classic', '기본형', '<svg viewBox="0 0 44 58"><rect width="44" height="58" rx="3" fill="#fff" stroke="#C9D0D6"/><rect x="0" y="0" width="44" height="10" rx="3" fill="#14212E"/><rect x="4" y="13" width="36" height="14" rx="1.5" fill="#C9D0D6"/><rect x="4" y="30" width="17" height="12" fill="#E3E7EA"/><rect x="23" y="30" width="17" height="12" fill="#E3E7EA"/><rect x="4" y="45" width="36" height="5" fill="#E3E7EA"/></svg>'],
    ['photo', '사진 강조형', '<svg viewBox="0 0 44 58"><rect width="44" height="58" rx="3" fill="#fff" stroke="#C9D0D6"/><rect x="0" y="0" width="44" height="26" rx="3" fill="#9AA6B0"/><rect x="0" y="18" width="44" height="8" fill="#14212E" opacity=".7"/><rect x="4" y="30" width="17" height="12" fill="#E3E7EA"/><rect x="23" y="30" width="17" height="12" fill="#E3E7EA"/><rect x="4" y="45" width="36" height="5" fill="#E3E7EA"/></svg>'],
    ['split', '2단형', '<svg viewBox="0 0 44 58"><rect width="44" height="58" rx="3" fill="#fff" stroke="#C9D0D6"/><rect x="0" y="0" width="44" height="10" rx="3" fill="#14212E"/><rect x="4" y="13" width="15" height="18" fill="#C9D0D6"/><rect x="4" y="33" width="15" height="10" fill="#B9D3C3"/><rect x="22" y="13" width="18" height="6" fill="#E3E7EA"/><rect x="22" y="21" width="18" height="10" fill="#E3E7EA"/><rect x="22" y="33" width="18" height="10" fill="#E3E7EA"/></svg>'],
  ];
  const COLORS = [['navy', '#14212E', '#F2B705'], ['green', '#1E4D3A', '#7CC6A0'], ['wine', '#3A2430', '#D9A55B'], ['gray', '#2B2F33', '#E4572E']];
  const FONTS = [['gothic', '깔끔한 고딕', '"Pretendard Variable",sans-serif'], ['serif', '고급 명조', '"Noto Serif KR",serif'], ['round', '부드러운', '"Gowun Dodum",sans-serif']];
  const SHOW = [['land', '토지 정보'], ['bld', '건물 정보'], ['loc', '입지 (교통·학교)'], ['map', '위치 지도'], ['trade', '최근 실거래'], ['feat', '특징']];

  root.innerHTML = `<div class="app">
    <aside class="side">
      <header><img src="/favicon.svg" width="26" height="26" alt=""><b>브리핑 자료 만들기</b><span class="beta">베타 · 회원 무료</span></header>
      <p class="lead">${esc(D.addr)}<br>왼쪽에서 고르고 입력하면 오른쪽 A4 한 장이 바로 바뀝니다.</p>
      <div class="grp"><h3>서식</h3><div class="tpl">${TPL.map(([k, l, svg]) => `<button type="button" data-tpl="${k}">${svg}${l}</button>`).join('')}</div></div>
      <div class="grp"><h3>색상</h3><div class="colors">${COLORS.map(([k, a, b]) => `<button type="button" data-color="${k}" aria-label="${k}" style="background:linear-gradient(135deg,${a} 55%,${b} 55%)"></button>`).join('')}</div></div>
      <div class="grp"><h3>글씨체</h3><div class="fonts">${FONTS.map(([k, l, ff]) => `<button type="button" data-font="${k}" style="font-family:${ff}">${l}</button>`).join('')}</div></div>
      <div class="grp"><h3>거래 구분</h3><div class="kinds">${['매매', '전세', '월세'].map(k => `<button type="button" data-kind="${k}">${k}</button>`).join('')}</div>
        <div id="kindFields"></div>
      </div>
      <div class="grp"><h3>매물 소개</h3>
        <label class="f"><span>제목</span><input type="text" data-k="title" maxlength="40"></label>
        <label class="f"><span>한 줄 소개 (크게 강조됩니다)</span><input type="text" data-k="intro" placeholder="예: 홍대입구역 도보 5분, 코너 대지의 근린생활시설" maxlength="80"></label>
        <label class="f"><span>특징 (한 줄에 하나씩)</span><textarea data-k="feats" placeholder="예:&#10;2023년 리모델링 완료&#10;1층 카페 임차 중&#10;대로변 가시성 우수"></textarea></label>
      </div>
      <div class="grp"><h3>사진 <small style="font-weight:400;color:var(--ui-muted)">최대 4장 · 첫 장이 대표</small></h3>
        <div class="photos" id="photos"></div>
        <label class="btn"><input type="file" id="photoIn" accept="image/*" multiple hidden>사진 추가</label>
        <p class="note">사진은 서버에 올라가지 않고 이 화면에서만 쓰입니다. 창을 닫으면 다시 넣어 주셔야 합니다.</p>
      </div>
      <div class="grp"><h3>표시할 항목</h3><div class="checks">${SHOW.map(([k, l]) => `<label><input type="checkbox" data-show="${k}">${l}</label>`).join('')}</div></div>
      <div class="grp"><h3>중개사무소 정보 <small style="font-weight:400;color:var(--ui-muted)">한 번 넣으면 기억합니다</small></h3>
        <label class="f"><span>상호</span><input type="text" data-a="name" maxlength="40"></label>
        <div class="row2"><label class="f"><span>대표</span><input type="text" data-a="ceo" maxlength="20"></label><label class="f"><span>연락처</span><input type="text" data-a="tel" maxlength="40"></label></div>
        <label class="f"><span>등록번호</span><input type="text" data-a="reg" maxlength="40"></label>
        <label class="f"><span>주소</span><input type="text" data-a="addr" maxlength="80"></label>
        <div class="logo-row"><label class="btn"><input type="file" id="logoIn" accept="image/*" hidden>로고 넣기</label><span id="logoPrev"></span></div>
      </div>
      <div class="grp"><button class="btn primary full" type="button" id="printBtn">인쇄 · PDF 저장</button>
        <p class="note">인쇄 창에서 '대상'을 'PDF로 저장'으로 고르면 파일로 저장됩니다. 용지는 A4, 여백은 '없음'을 권합니다.</p></div>
    </aside>
    <main class="stage" id="stage"><div class="warn" id="warn" hidden>내용이 한 장을 넘어 아래쪽이 잘립니다. 표시할 항목을 줄이거나 특징을 짧게 해 주세요.</div><div class="scaler" id="scaler"><div class="sheet" id="sheet"></div></div></main>
  </div>`;

  // 입력 연결
  function bindK(scope) {
    scope.querySelectorAll('[data-k]').forEach(el => {
      el.value = st[el.dataset.k] || '';
      el.addEventListener('input', () => { st[el.dataset.k] = el.value; saveDraft(); draw(); });
    });
  }
  const fld = (k, label, ph) => `<label class="f"><span>${label}</span><input type="text" data-k="${k}" placeholder="${ph}" maxlength="30"></label>`;
  function drawKindFields() {
    const box = $('kindFields');
    if (st.kind === '매매') box.innerHTML = fld('price', '매매가', '예: 35억 / 12억 5,000만')
      + '<p class="sub-h">임대 중인 건물이면 (수익률이 자동 계산됩니다)</p><div class="row2" style="grid-template-columns:1fr 1fr">' + fld('incDep', '보증금 합계', '예: 3억') + fld('incRent', '월 임대료 합계', '예: 1,200만') + '</div>';
    else if (st.kind === '전세') box.innerHTML = fld('jeonse', '전세 보증금', '예: 6억 5,000만') + '<div class="row2" style="grid-template-columns:1fr 1fr">' + fld('fee', '관리비 (월)', '예: 25만원') + fld('moveIn', '입주 가능일', '예: 즉시 / 12월 말') + '</div>';
    else box.innerHTML = '<div class="row2" style="grid-template-columns:1fr 1fr">' + fld('deposit', '보증금', '예: 1억') + fld('rent', '월세', '예: 350만') + fld('fee', '관리비 (월)', '예: 30만원') + fld('moveIn', '입주 가능일', '예: 즉시') + '</div>';
    bindK(box);
  }
  bindK(document.querySelector('.side'));
  document.querySelectorAll('[data-kind]').forEach(b => b.onclick = () => { st.kind = b.dataset.kind; saveDraft(); drawKindFields(); draw(); });
  document.querySelectorAll('[data-font]').forEach(b => b.onclick = () => { st.font = b.dataset.font; saveDraft(); draw(); });
  drawKindFields();
  document.querySelectorAll('[data-a]').forEach(el => {
    el.value = st.agent[el.dataset.a] || '';
    el.addEventListener('input', () => { st.agent[el.dataset.a] = el.value; saveAgent(); draw(); });
  });
  document.querySelectorAll('[data-show]').forEach(el => {
    el.checked = !!st.show[el.dataset.show];
    el.addEventListener('change', () => { st.show[el.dataset.show] = el.checked; saveDraft(); draw(); });
  });
  document.querySelectorAll('[data-tpl]').forEach(b => b.onclick = () => { st.tpl = b.dataset.tpl; saveDraft(); draw(); });
  document.querySelectorAll('[data-color]').forEach(b => b.onclick = () => { st.color = b.dataset.color; saveDraft(); draw(); });
  $('printBtn').onclick = () => window.print();

  // 사진: 긴 변 1600px로 줄여서 사용
  function shrink(file, max, type = 'image/jpeg') {
    return new Promise((ok, no) => {
      const fr = new FileReader();
      fr.onload = () => {
        const img = new Image();
        img.onload = () => {
          const k = Math.min(1, max / Math.max(img.width, img.height));
          const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
          const g = c.getContext('2d'); if (type === 'image/jpeg') { g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); }
          g.drawImage(img, 0, 0, c.width, c.height);
          ok(c.toDataURL(type, 0.86));
        };
        img.onerror = no; img.src = fr.result;
      };
      fr.onerror = no; fr.readAsDataURL(file);
    });
  }
  $('photoIn').onchange = async e => {
    for (const f of [...e.target.files]) { if (st.photos.length >= 4) break; try { st.photos.push(await shrink(f, 1600)); } catch { /* 건너뜀 */ } }
    e.target.value = ''; drawPhotos(); draw();
  };
  $('logoIn').onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    try { st.agent.logo = await shrink(f, 400, 'image/png'); saveAgent(); } catch { /* 무시 */ }
    e.target.value = ''; drawLogo(); draw();
  };
  function drawPhotos() {
    $('photos').innerHTML = st.photos.map((src, i) => `<div class="ph"><img src="${src}" alt=""><button type="button" data-del="${i}" aria-label="삭제">×</button>${i === 0 ? '<em>대표</em>' : ''}</div>`).join('');
    $('photos').querySelectorAll('[data-del]').forEach(b => b.onclick = () => { st.photos.splice(+b.dataset.del, 1); drawPhotos(); draw(); });
  }
  function drawLogo() { $('logoPrev').innerHTML = st.agent.logo ? `<img src="${st.agent.logo}" alt=""> <button class="btn" type="button" id="logoDel">빼기</button>` : ''; if ($('logoDel')) $('logoDel').onclick = () => { st.agent.logo = ''; saveAgent(); drawLogo(); draw(); }; }
  drawLogo();

  // ---------- 시트 블록 ----------
  const L = D.land || {}, B = D.bld || null;
  // '35억 5,000만', '3억', '1200' → 만원 단위 숫자 (숫자만 쓰면 만원으로 봅니다)
  function man(s) {
    s = String(s || '').replace(/[,\s원]/g, '');
    if (!s) return null;
    const e = s.match(/([\d.]+)억/), m = s.match(/억?([\d.]+)만/), only = s.match(/^([\d.]+)$/);
    let v = 0;
    if (e) v += parseFloat(e[1]) * 10000;
    if (m) v += parseFloat(m[1]);
    if (!e && !m && only) v = parseFloat(only[1]);
    return v || null;
  }
  const short = v => v == null ? '-' : won(v).replace(/원$/, '');
  function income() {
    if (st.kind !== '매매') return null;
    const P = man(st.price), dep = man(st.incDep) || 0, rent = man(st.incRent);
    if (!P || !rent) return null;
    const inv = P - dep;
    return { P, dep, rent, year: rent * 12, inv, yld: inv > 0 ? rent * 12 / inv * 100 : null };
  }
  function priceBlock() {
    let label, main, sub = '';
    if (st.kind === '매매') {
      label = '매매가'; main = st.price || '가격 협의';
      const P = man(st.price);
      if (P && L.area) sub = `대지 평당 ${n(Math.round(P / (L.area / PY)))}만원`;
    } else if (st.kind === '전세') {
      label = '전세 보증금'; main = st.jeonse || '협의';
      if (st.fee) sub = `관리비 ${st.fee}`;
    } else {
      label = '보증금 / 월세'; main = `${st.deposit || '-'} / ${st.rent || '-'}`;
      if (st.fee) sub = `관리비 ${st.fee}`;
    }
    return `<div class="price"><small>${esc(label)}</small><b>${esc(main)}</b>${sub ? `<span class="sub">${esc(sub)}</span>` : ''}</div>`;
  }
  // 핵심 수치 띠 (크게)
  function keys() {
    const k = [];
    const I = income();
    if (I && I.yld != null) k.push(['수익률', `${n(I.yld, 2)}%`, `연 ${short(I.year)}`, true]);
    if (st.kind !== '매매' && st.moveIn) k.push(['입주 가능', st.moveIn, '', true]);
    if (st.kind !== '매매' && st.fee) k.push(['관리비', st.fee, '월', false]);
    if (L.area) k.push(['대지면적', `${n(L.area / PY, 1)}평`, `${n(L.area, 1)}㎡`, false]);
    if (B && B.tot) k.push(['연면적', `${n(B.tot / PY, 1)}평`, `${n(B.tot, 1)}㎡`, false]);
    if (L.zone) k.push(['용도지역', String(L.zone).replace(/지역$/, ''), '', false]);
    if (B && B.apr) k.push(['준공', `${String(B.apr).slice(0, 4)}년`, `${new Date().getFullYear() - Number(String(B.apr).slice(0, 4))}년차`, false]);
    if (B && B.grnd) k.push(['규모', `${B.ugrnd ? 'B' + B.ugrnd + '/' : ''}${B.grnd}F`, '', false]);
    const top = k.slice(0, 4);
    if (!top.length) return '';
    return `<div class="s-keys">${top.map(([l, v, sm, acc]) => `<div class="key${acc ? ' acc' : ''}"><span>${esc(l)}</span><b>${esc(v)}</b>${sm ? `<small>${esc(sm)}</small>` : ''}</div>`).join('')}</div>`;
  }
  function dealTbl() {
    if (st.kind === '매매') {
      const I = income();
      if (!I) return '';
      return `<div class="s-sec"><h2>수익 정보</h2><table class="s-tbl">
        <tr><th>보증금 합계</th><td>${won(I.dep)}</td></tr>
        <tr><th>월 임대료</th><td>${won(I.rent)} <small>연 ${won(I.year)}</small></td></tr>
        <tr><th>실투자금</th><td>${won(I.inv)} <small>매매가 − 보증금</small></td></tr>
        <tr class="hl"><th>수익률</th><td>${I.yld != null ? n(I.yld, 2) + '%' : '-'} <small>대출 제외, 세전</small></td></tr></table></div>`;
    }
    const rows = st.kind === '전세'
      ? [['전세 보증금', st.jeonse], ['관리비', st.fee], ['입주 가능일', st.moveIn]]
      : [['보증금', st.deposit], ['월세', st.rent], ['관리비', st.fee], ['입주 가능일', st.moveIn]];
    const r = rows.filter(x => x[1]);
    if (!r.length) return '';
    return `<div class="s-sec"><h2>${st.kind} 조건</h2><table class="s-tbl">${r.map(([a, b], i) => `<tr class="${i === 0 ? 'hl' : ''}"><th>${a}</th><td>${esc(b)}</td></tr>`).join('')}</table></div>`;
  }
  const head = () => `<div class="s-head"><div><span class="kind ${st.kind === '전세' ? 'k-jeonse' : st.kind === '월세' ? 'k-wolse' : ''}">${esc(st.kind)}</span><h1>${esc(st.title || autoTitle)}</h1><div class="addr">${esc(D.addr)}${D.road ? ' · ' + esc(D.road) : ''}</div></div>${priceBlock()}</div>`;
  function photos(cls = '') {
    const ps = st.photos;
    if (!ps.length) {
      if (st.mapSrc) return `<div class="s-photos n1 ${cls}"><img src="${st.mapSrc}" alt="위치 지도"></div>`;
      return `<div class="s-photos n1 ${cls}"><div class="s-ph-empty">왼쪽에서 사진을 추가해 주세요</div></div>`;
    }
    return `<div class="s-photos n${ps.length} ${cls}">${ps.map(s => `<img src="${s}" alt="">`).join('')}</div>`;
  }
  const intro = () => st.intro ? `<div class="s-intro">${esc(st.intro)}</div>` : '';
  function landTbl() {
    if (!st.show.land || !D.land) return '';
    const p = D.price;
    return `<div class="s-sec"><h2>토지</h2><table class="s-tbl">
      <tr><th>대지면적</th><td>${arP(L.area)}</td></tr>
      <tr><th>용도지역</th><td>${esc(L.zone || '-')}${L.zone2 && L.zone2 !== '지정되지않음' ? ` <small>${esc(L.zone2)}</small>` : ''}</td></tr>
      <tr><th>지목</th><td>${esc(L.jimok || '-')}</td></tr>
      <tr><th>공시지가</th><td>${p ? `${n(p.per)}원/㎡ <small>${esc(p.year || '')}년</small>` : '-'}</td></tr>
      ${p && L.area ? `<tr><th>공시지가 총액</th><td>${won(p.per * L.area / 10000)}</td></tr>` : ''}
      <tr><th>도로접면</th><td>${esc(L.road || '-')}</td></tr>
    </table></div>`;
  }
  function bldTbl() {
    if (!st.show.bld || !B) return '';
    const age = B.apr ? new Date().getFullYear() - Number(String(B.apr).slice(0, 4)) : null;
    return `<div class="s-sec"><h2>건물</h2><table class="s-tbl">
      <tr><th>주용도</th><td>${esc(B.use || '-')}</td></tr>
      <tr><th>규모</th><td>${B.ugrnd ? `지하 ${B.ugrnd}층 / ` : ''}지상 ${B.grnd ?? '-'}층${B.cnt > 1 ? ` <small>${B.cnt}개 동</small>` : ''}</td></tr>
      <tr><th>연면적</th><td>${arP(B.tot)}</td></tr>
      <tr><th>건폐율·용적률</th><td>${B.bc != null ? n(B.bc, 1) + '%' : '-'} · ${B.vl != null ? n(B.vl, 1) + '%' : '-'}</td></tr>
      <tr><th>구조</th><td>${esc(B.strct || '-')}</td></tr>
      <tr><th>사용승인</th><td>${esc(B.apr || '-')}${age != null ? ` <small>${age}년차</small>` : ''}</td></tr>
      <tr><th>주차·승강기</th><td>${B.pk != null ? B.pk + '대' : '-'} · ${B.lift != null ? B.lift + '대' : '-'}</td></tr>
    </table></div>`;
  }
  function feats() {
    if (!st.show.feat) return '';
    const items = String(st.feats || '').split('\n').map(s => s.trim()).filter(Boolean);
    if (!items.length) return '';
    return `<div class="s-sec"><h2>특징</h2><ul class="s-feat">${items.slice(0, 8).map(t => `<li>${esc(t)}</li>`).join('')}</ul></div>`;
  }
  const walk = d => Math.max(1, Math.round(d * 1.3 / 67));
  function loc() {
    if (!st.show.loc) return '';
    if (!st.loc) return `<div class="s-sec"><h2>입지</h2><div class="s-loc"><div><span>주변 시설을 찾는 중입니다…</span></div></div></div>`;
    const rows = st.loc.filter(x => x.name);
    if (!rows.length) return '';
    return `<div class="s-sec"><h2>입지</h2><div class="s-loc">${rows.map(x => `<div><span>${esc(x.label)}</span><b>${esc(x.name)} · 도보 ${walk(x.d)}분</b></div>`).join('')}</div></div>`;
  }
  function map(h) {
    if (!st.show.map || !st.mapSrc) return '';
    if (!st.photos.length && st.tpl !== 'split') return ''; // 사진이 없으면 사진 자리에 이미 지도가 들어감
    return `<div class="s-sec"><h2>위치</h2><div class="s-map" style="height:${h}mm"><img src="${st.mapSrc}" alt="위치 지도"></div></div>`;
  }
  function trades() {
    if (!st.show.trade || !D.trades || !D.trades.length) return '';
    return `<div class="s-sec"><h2>이 필지 최근 실거래</h2><table class="s-tbl">${D.trades.map(t => `<tr><th>${esc(t.d)}</th><td>${won(t.p)}${t.ex ? ` <small>${n(t.ex, 1)}㎡${t.f ? ' · ' + esc(t.f) + '층' : ''}</small>` : ''}</td></tr>`).join('')}</table></div>`;
  }
  const two = (a, b) => (a && b) ? `<div class="s-two">${a}${b}</div>` : (a || b);
  function foot() {
    const A = st.agent;
    const line = [A.ceo && `대표 ${esc(A.ceo)}`, A.tel && esc(A.tel), A.reg && `등록번호 ${esc(A.reg)}`].filter(Boolean).join(' · ');
    return `<div class="s-foot"><div class="ag">${A.logo ? `<img src="${A.logo}" alt="">` : ''}<div><b>${esc(A.name || '')}</b><span>${line}</span>${A.addr ? `<br><span>${esc(A.addr)}</span>` : ''}</div></div>
      <div class="rm"><i><img src="/favicon.svg" width="12" height="12" alt="">리얼맵</i><br>공공데이터 기준 · ${new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10).replace(/-/g, '.')} 작성<br>세부 내용은 공부서류로 다시 확인하시기 바랍니다.</div></div>`;
  }

  function draw() {
    const sh = $('sheet');
    sh.className = `sheet t-${st.tpl} c-${st.color} f-${st.font}`;
    document.querySelectorAll('[data-kind]').forEach(b => b.setAttribute('aria-pressed', b.dataset.kind === st.kind));
    document.querySelectorAll('[data-font]').forEach(b => b.setAttribute('aria-pressed', b.dataset.font === st.font));
    document.querySelectorAll('[data-tpl]').forEach(b => b.setAttribute('aria-pressed', b.dataset.tpl === st.tpl));
    document.querySelectorAll('[data-color]').forEach(b => b.setAttribute('aria-pressed', b.dataset.color === st.color));
    let body;
    if (st.tpl === 'photo') {
      body = `<div class="s-hero">${photos()}${head()}</div><div class="s-body">${keys()}${intro()}${two(dealTbl(), feats())}${two(landTbl(), bldTbl())}${two(loc(), trades() || map(40))}</div>`;
    } else if (st.tpl === 'split') {
      const left = `${photos()}${st.show.map && st.mapSrc && st.photos.length ? `<div class="s-map" style="height:48mm"><img src="${st.mapSrc}" alt="위치 지도"></div>` : ''}${loc()}${feats()}`;
      body = `${head()}<div class="s-body"><div class="s-left">${left}</div><div class="s-right">${keys()}${intro()}${dealTbl()}${landTbl()}${bldTbl()}${trades()}</div></div>`;
    } else {
      body = `${head()}<div class="s-body">${photos()}${keys()}${intro()}${two(dealTbl(), feats())}${two(landTbl(), bldTbl())}${two(loc(), trades() || map(40))}</div>`;
    }
    sh.innerHTML = body + foot();
    fit();
    // 넘치면 본문 글씨를 조금씩 줄여 한 장에 맞춥니다 (최소 80%)
    const b = sh.querySelector('.s-body');
    let z = 1;
    if (b) {
      const fit1 = zz => { b.style.zoom = zz; b.style.padding = `${5.5 / zz}mm ${11 / zz}mm 0`; };
      fit1(1);
      while (b.scrollHeight > b.clientHeight + 2 && z > 0.8) { z = Math.round((z - 0.03) * 100) / 100; fit1(z); }
    }
    const over = !!(b && b.scrollHeight > b.clientHeight + 2);
    $('warn').hidden = !over && z > 0.86;
    $('warn').textContent = over ? '내용이 한 장을 넘어 아래쪽이 잘립니다. 표시할 항목을 줄이거나 특징을 짧게 해 주세요.' : '내용이 많아 글씨를 조금 줄여 한 장에 맞췄습니다. 더 크게 보이게 하려면 표시할 항목을 줄여 주세요.';
  }
  function fit() {
    const stage = $('stage'), sc = $('scaler');
    const w = stage.clientWidth - 32, k = Math.min(1, w / 794);
    sc.style.transform = `scale(${k})`;
    sc.style.height = `${1123 * k}px`;
  }
  addEventListener('resize', fit);
  drawPhotos(); draw();

  // ---------- 지도 이미지 · 주변 시설 (카카오) ----------
  fetch('/api/config').then(r => r.json()).then(cfg => {
    if (!cfg.kakaoKey || D.lat == null) return;
    const sc = document.createElement('script');
    sc.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${encodeURIComponent(cfg.kakaoKey)}&libraries=services&autoload=false`;
    sc.onload = () => kakao.maps.load(kakaoReady);
    document.head.appendChild(sc);
  }).catch(() => {});
  function kakaoReady() {
    const K = kakao.maps, P = K.services, c = new K.LatLng(D.lat, D.lng);
    // 정적 지도 → 이미지 주소만 받아서 시트에 사용
    try {
      new K.StaticMap($('mapHold'), { center: c, level: 3, marker: { position: c } });
      let tries = 0;
      const grab = () => { const img = $('mapHold').querySelector('img'); if (img && img.src) { st.mapSrc = img.src; draw(); } else if (tries++ < 20) setTimeout(grab, 150); };
      grab();
    } catch { /* 지도 없이 진행 */ }
    const places = new P.Places();
    const q = (kind, key, radius) => new Promise(ok => {
      const opt = { location: c, radius, sort: P.SortBy.DISTANCE };
      const cb = (r, s) => ok(s === P.Status.OK ? r.map(x => ({ name: x.place_name, cat: x.category_name || '', d: +x.distance })) : []);
      kind === 'cat' ? places.categorySearch(key, cb, opt) : places.keywordSearch(key, cb, opt);
    });
    const school = kw => q('kw', kw, 3000).then(r => r.find(x => x.name.includes(kw)) || null);
    Promise.all([
      q('cat', 'SW8', 3000).then(r => r[0] || null),
      q('kw', '버스정류장', 1000).then(r => r.find(x => /버스정류장/.test(x.cat)) || null),
      school('초등학교'), school('중학교'), school('고등학교'),
      q('cat', 'MT1', 3000).then(r => r[0] || null),
    ]).then(([sub, bus, e, m, h, mart]) => {
      const lab = (label, x) => ({ label, name: x ? x.name : '', d: x ? x.d : 0 });
      st.loc = [lab('지하철', sub), lab('버스', bus), lab('초등학교', e), lab('중학교', m), lab('고등학교', h), lab('대형마트', mart)];
      draw();
    });
  }
})();
