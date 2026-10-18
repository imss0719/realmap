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
  // 매물 유형: 공동주택(아파트·빌라·오피스텔) / 건물(상가·빌딩·다가구) / 토지
  function autoType() {
    const b = D.bld, u = b ? `${b.use || ''} ${b.etc || ''}` : '';
    if (!b) return 'land';
    if (/아파트|공동주택|다세대|연립|오피스텔|도시형/.test(u) || (D.own && D.own.type === '구분소유' && /주택|주거/.test(u))) return 'apt';
    return 'bld';
  }
  const TYPES = [['apt', '아파트·빌라·오피스텔'], ['bld', '상가·건물'], ['land', '토지']];
  const SHOW_BY_TYPE = { apt: { land: false, bld: true }, bld: { land: true, bld: true }, land: { land: true, bld: false } };
  const autoTitle = D.name || String(D.addr || '').split(' ').slice(-2).join(' ');
  const DRAFT = 'rm.bdraft:' + D.pnu;
  const st = Object.assign({
    tpl: 'classic', color: 'navy', font: 'gothic', ratio: 'auto', ptype: autoType(), kind: '매매',
    exArea: '', supArea: '', rooms: '', floor: '', dir: '', park: '', premium: '', landNow: '', rentroll: '', price: '', jeonse: '', deposit: '', rent: '', fee: '', moveIn: '', incDep: '', incRent: '',
    title: autoTitle, intro: '', feats: '',
    show: { land: true, bld: !!D.bld, loc: true, map: true, trade: !!(D.trades && D.trades.length), feat: true },
  }, store.get(DRAFT, {}));
  if (!['매매', '전세', '월세'].includes(st.kind)) st.kind = '매매';
  if (!TYPES.some(t => t[0] === st.ptype)) st.ptype = autoType();
  if (st.ptype === 'land' && st.kind === '전세') st.kind = '월세';
  if (!['auto', '43', '34', '11'].includes(st.ratio)) st.ratio = 'auto';
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
      <div class="grp"><h3>매물 유형 <small style="font-weight:400;color:var(--ui-muted)">유형에 따라 입력 항목이 바뀝니다</small></h3><div class="types">${TYPES.map(([k, l]) => `<button type="button" data-type="${k}">${l}</button>`).join('')}</div></div>
      <div class="grp"><h3>서식</h3><div class="tpl">${TPL.map(([k, l, svg]) => `<button type="button" data-tpl="${k}">${svg}${l}</button>`).join('')}</div></div>
      <div class="grp"><h3>색상</h3><div class="colors">${COLORS.map(([k, a, b]) => `<button type="button" data-color="${k}" aria-label="${k}" style="background:linear-gradient(135deg,${a} 55%,${b} 55%)"></button>`).join('')}</div></div>
      <div class="grp"><h3>글씨체</h3><div class="fonts">${FONTS.map(([k, l, ff]) => `<button type="button" data-font="${k}" style="font-family:${ff}">${l}</button>`).join('')}</div></div>
      <div class="grp"><h3>거래 구분</h3><div class="kinds">${['매매', '전세', '월세'].map(k => `<button type="button" data-kind="${k}">${k}</button>`).join('')}</div>
        <div id="kindFields"></div>
      </div>
      <div class="grp" id="typeGrp"><h3 id="typeH">매물 정보</h3><div id="typeFields"></div></div>
      <div class="grp"><h3>매물 소개</h3>
        <label class="f"><span>제목</span><input type="text" data-k="title" maxlength="40"></label>
        <label class="f"><span>한 줄 소개 (크게 강조됩니다)</span><input type="text" data-k="intro" placeholder="예: 홍대입구역 도보 5분, 코너 대지의 근린생활시설" maxlength="80"></label>
        <label class="f"><span>특징 (한 줄에 하나씩)</span><textarea data-k="feats" placeholder="예:&#10;2023년 리모델링 완료&#10;1층 카페 임차 중&#10;대로변 가시성 우수"></textarea></label>
      </div>
      <div class="grp"><h3>사진 <small style="font-weight:400;color:var(--ui-muted)">최대 4장 · 누르면 대표 사진</small></h3>
        <div class="ratios">${[['auto', '자동'], ['43', '가로 4:3'], ['34', '세로 3:4'], ['11', '정사각 1:1']].map(([k, l]) => `<button type="button" data-ratio="${k}">${l}</button>`).join('')}</div>
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
  const fld = (k, label, ph, max = 30) => `<label class="f"><span>${label}</span><input type="text" data-k="${k}" placeholder="${ph}" maxlength="${max}"></label>`;
  const r2 = (...x) => `<div class="row2" style="grid-template-columns:1fr 1fr">${x.join('')}</div>`;
  function drawKindFields() {
    const box = $('kindFields'), T = st.ptype;
    if (st.kind === '매매') {
      box.innerHTML = fld('price', '매매가', T === 'apt' ? '예: 12억 5,000만' : '예: 35억');
      if (T === 'apt') box.innerHTML += '<p class="sub-h">임대 중이면 (수익률이 자동 계산됩니다)</p>' + r2(fld('incDep', '보증금', '예: 1억'), fld('incRent', '월세', '예: 80만'));
      if (T === 'bld') box.innerHTML += '<p class="sub-h">임대 중이면 아래 \'임대 현황\'에 층별로 적거나, 합계만 넣어 주세요</p>' + r2(fld('incDep', '보증금 합계', '예: 3억'), fld('incRent', '월 임대료 합계', '예: 1,200만'));
    } else if (st.kind === '전세') box.innerHTML = fld('jeonse', '전세 보증금', '예: 6억 5,000만') + r2(fld('fee', '관리비 (월)', '예: 25만원'), fld('moveIn', '입주 가능일', '예: 즉시 / 12월 말'));
    else box.innerHTML = r2(fld('deposit', '보증금', '예: 1억'), fld('rent', '월세', '예: 350만'), fld('fee', '관리비 (월)', '예: 30만원'), fld('moveIn', T === 'land' ? '사용 가능일' : '입주 가능일', '예: 즉시'));
    bindK(box);
  }
  function drawTypeFields() {
    const box = $('typeFields'), T = st.ptype;
    document.querySelector('[data-kind="전세"]').hidden = T === 'land';
    document.querySelector('[data-kind="월세"]').textContent = T === 'land' ? '임대' : '월세';
    if (T === 'apt') {
      $('typeH').textContent = '세대 정보';
      box.innerHTML = r2(fld('exArea', '전용면적', '예: 84.97㎡ 또는 25평'), fld('supArea', '공급면적 · 평형', '예: 34평형'))
        + r2(fld('rooms', '방 · 욕실', '예: 방3 · 욕실2'), fld('floor', '해당 층', '예: 12층 / 25층'))
        + r2(fld('dir', '향', '예: 남향'), fld('park', '주차', '예: 세대당 1.2대'))
        + '<p class="note">비워 둔 칸은 자료에 나오지 않습니다. 주차를 비우면 건축물대장 기준으로 넣어 드립니다.</p>';
    } else if (T === 'bld') {
      $('typeH').textContent = st.kind === '매매' ? '임대 현황' : '임대 조건';
      box.innerHTML = st.kind === '매매'
        ? `<label class="f"><span>한 줄에 한 칸씩: 층 / 업종 / 보증금 / 월세</span><textarea data-k="rentroll" placeholder="1층 / 카페 / 5000 / 300&#10;2층 / 사무실 / 3000 / 180&#10;3층 / 공실"></textarea></label><p class="note">금액은 만원 단위 숫자로 적으셔도 됩니다. 합계와 수익률이 자동으로 계산됩니다.</p>`
        : r2(fld('floor', '임대 층', '예: 1층 일부'), fld('exArea', '임대 면적', '예: 66㎡ 또는 20평')) + r2(fld('premium', '권리금', '예: 5,000만 / 없음'), fld('park', '주차', '예: 1대 가능'));
    } else {
      $('typeH').textContent = '토지 정보';
      box.innerHTML = fld('landNow', '현재 이용 상태', L.use ? `예: ${L.use}` : '예: 나대지 · 주차장', 40)
        + '<p class="note">면적·용도지역·지목·공시지가·도로 조건은 자동으로 들어갑니다.</p>';
    }
    bindK(box);
  }
  bindK(document.querySelector('.side'));
  document.querySelectorAll('[data-kind]').forEach(b => b.onclick = () => { st.kind = b.dataset.kind; saveDraft(); drawKindFields(); drawTypeFields(); draw(); });
  document.querySelectorAll('[data-type]').forEach(b => b.onclick = () => {
    st.ptype = b.dataset.type; Object.assign(st.show, SHOW_BY_TYPE[st.ptype]);
    if (st.ptype === 'land' && st.kind === '전세') st.kind = '월세';
    document.querySelectorAll('[data-show]').forEach(el => { el.checked = !!st.show[el.dataset.show]; });
    saveDraft(); drawKindFields(); drawTypeFields(); draw();
  });
  document.querySelectorAll('[data-ratio]').forEach(b => b.onclick = () => { st.ratio = b.dataset.ratio; saveDraft(); draw(); });
  document.querySelectorAll('[data-font]').forEach(b => b.onclick = () => { st.font = b.dataset.font; saveDraft(); draw(); });
  const L = D.land || {}, B = D.bld || null;
  drawKindFields(); drawTypeFields();
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
          ok({ src: c.toDataURL(type, 0.86), w: c.width, h: c.height });
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
    try { st.agent.logo = (await shrink(f, 400, 'image/png')).src; saveAgent(); } catch { /* 무시 */ }
    e.target.value = ''; drawLogo(); draw();
  };
  function drawPhotos() {
    $('photos').innerHTML = st.photos.map((p, i) => `<div class="ph${i === 0 ? ' main' : ''}"><img src="${p.src}" alt="" data-main="${i}" title="대표 사진으로"><button type="button" data-del="${i}" aria-label="삭제">×</button>${i === 0 ? '<em>대표</em>' : ''}</div>`).join('');
    $('photos').querySelectorAll('[data-del]').forEach(b => b.onclick = () => { st.photos.splice(+b.dataset.del, 1); drawPhotos(); draw(); });
    $('photos').querySelectorAll('[data-main]').forEach(im => im.onclick = () => { const i = +im.dataset.main; if (!i) return; st.photos.unshift(st.photos.splice(i, 1)[0]); drawPhotos(); draw(); });
  }
  function drawLogo() { $('logoPrev').innerHTML = st.agent.logo ? `<img src="${st.agent.logo}" alt=""> <button class="btn" type="button" id="logoDel">빼기</button>` : ''; if ($('logoDel')) $('logoDel').onclick = () => { st.agent.logo = ''; saveAgent(); drawLogo(); draw(); }; }
  drawLogo();

  // ---------- 시트 블록 ----------
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
  // '84.97㎡', '25평', '84.97' → ㎡
  function m2(s) { s = String(s || ''); const v = parseFloat(s.replace(/,/g, '')); if (!v) return null; return /평/.test(s) && !/㎡|m2/i.test(s) ? v * PY : v; }
  const pyTxt = a => a ? `${n(a / PY, 1)}평` : '';
  function rentRoll() {
    if (st.ptype !== 'bld' || st.kind !== '매매') return null;
    const rows = String(st.rentroll || '').split('\n').map(l => l.trim()).filter(Boolean).map(l => {
      const p = l.split(/\s*[\/|\t]\s*/).map(x => x.trim());
      const money = p.slice(2).map(man);
      return { fl: p[0] || '', biz: p[1] || '', dep: money[0] ?? null, rent: money[1] ?? null };
    });
    if (!rows.length) return null;
    return { rows, dep: rows.reduce((a, r) => a + (r.dep || 0), 0), rent: rows.reduce((a, r) => a + (r.rent || 0), 0) };
  }
  function income() {
    if (st.kind !== '매매') return null;
    if (st.ptype === 'land') return null;
    const RR = rentRoll();
    const P = man(st.price), dep = man(st.incDep) ?? (RR ? RR.dep : 0), rent = man(st.incRent) ?? (RR && RR.rent ? RR.rent : null);
    if (!P || !rent) return null;
    const inv = P - dep;
    return { P, dep, rent, year: rent * 12, inv, yld: inv > 0 ? rent * 12 / inv * 100 : null };
  }
  function priceBlock() {
    let label, main, sub = '';
    if (st.kind === '매매') {
      label = '매매가'; main = st.price || '가격 협의';
      const P = man(st.price);
      if (P && st.ptype === 'apt') {
        const sup = m2(st.supArea), ex = m2(st.exArea);
        if (sup) sub = `공급 평당 ${n(Math.round(P / (sup / PY)))}만원`; else if (ex) sub = `전용 평당 ${n(Math.round(P / (ex / PY)))}만원`;
      } else if (P && L.area) sub = `${st.ptype === 'land' ? '' : '대지 '}평당 ${n(Math.round(P / (L.area / PY)))}만원`;
    } else if (st.kind === '전세') {
      label = '전세 보증금'; main = st.jeonse || '협의';
      if (st.fee) sub = `관리비 ${st.fee}`;
    } else {
      label = st.ptype === 'land' ? '보증금 / 월 임대료' : '보증금 / 월세'; main = `${st.deposit || '-'} / ${st.rent || '-'}`;
      if (st.fee) sub = `관리비 ${st.fee}`;
    }
    return `<div class="price"><small>${esc(label)}</small><b>${esc(main)}</b>${sub ? `<span class="sub">${esc(sub)}</span>` : ''}</div>`;
  }
  // 핵심 수치 띠 (크게)
  function keys() {
    const k = [], T = st.ptype, I = income();
    const age = B && B.apr ? new Date().getFullYear() - Number(String(B.apr).slice(0, 4)) : null;
    if (I && I.yld != null) k.push(['수익률', `${n(I.yld, 2)}%`, `연 ${short(I.year)}`, true]);
    if (st.kind !== '매매' && st.moveIn) k.push([T === 'land' ? '사용 가능' : '입주 가능', st.moveIn, '', true]);
    if (T === 'apt') {
      const ex = m2(st.exArea);
      if (ex) k.push(['전용면적', pyTxt(ex), `${n(ex, 2)}㎡`, false]);
      if (st.supArea) k.push(['공급', st.supArea, '', false]);
      if (st.rooms) k.push(['방 · 욕실', st.rooms, '', false]);
      if (st.floor) k.push(['층', st.floor, '', false]);
      if (st.dir) k.push(['향', st.dir, '', false]);
      if (st.kind !== '매매' && st.fee) k.push(['관리비', st.fee, '월', false]);
      if (B && B.apr) k.push(['준공', `${String(B.apr).slice(0, 4)}년`, `${age}년차`, false]);
    } else if (T === 'bld') {
      if (st.kind !== '매매') {
        const ex = m2(st.exArea);
        if (ex) k.push(['임대 면적', pyTxt(ex), `${n(ex, 1)}㎡`, false]);
        if (st.floor) k.push(['층', st.floor, '', false]);
        if (st.premium) k.push(['권리금', st.premium, '', false]);
        if (st.fee) k.push(['관리비', st.fee, '월', false]);
      }
      if (L.area) k.push(['대지면적', pyTxt(L.area), `${n(L.area, 1)}㎡`, false]);
      if (B && B.tot) k.push(['연면적', pyTxt(B.tot), `${n(B.tot, 1)}㎡`, false]);
      if (L.zone) k.push(['용도지역', String(L.zone).replace(/지역$/, ''), '', false]);
      if (B && B.apr) k.push(['준공', `${String(B.apr).slice(0, 4)}년`, `${age}년차`, false]);
      if (B && B.grnd) k.push(['규모', `${B.ugrnd ? 'B' + B.ugrnd + '/' : ''}${B.grnd}F`, '', false]);
    } else {
      const P = man(st.price);
      if (L.area) k.push(['토지면적', pyTxt(L.area), `${n(L.area, 1)}㎡`, false]);
      if (st.kind === '매매' && P && L.area) k.push(['평당가', `${n(Math.round(P / (L.area / PY)))}만원`, '', true]);
      if (L.zone) k.push(['용도지역', String(L.zone).replace(/지역$/, ''), '', false]);
      if (L.jimok) k.push(['지목', L.jimok, '', false]);
      if (D.price) k.push(['공시지가 (평당)', `${n(Math.round(D.price.per * PY / 10000))}만원`, `${D.price.year}년`, false]);
    }
    const top = k.slice(0, 4);
    if (!top.length) return '';
    return `<div class="s-keys">${top.map(([l, v, sm, acc]) => `<div class="key${acc ? ' acc' : ''}"><span>${esc(l)}</span><b>${esc(v)}</b>${sm ? `<small>${esc(sm)}</small>` : ''}</div>`).join('')}</div>`;
  }
  function dealTbl() {
    if (st.kind === '매매' && st.ptype === 'land') {
      const P = man(st.price); if (!P) return '';
      const pub = D.price && L.area ? D.price.per * L.area / 10000 : null;
      return `<div class="s-sec"><h2>가격 정보</h2><table class="s-tbl">
        <tr class="hl"><th>매매가</th><td>${won(P)}</td></tr>
        ${L.area ? `<tr><th>평당가</th><td>${n(Math.round(P / (L.area / PY)))}만원 <small>㎡당 ${n(Math.round(P / L.area))}만원</small></td></tr>` : ''}
        ${pub ? `<tr><th>공시지가 총액</th><td>${won(pub)}</td></tr><tr><th>공시지가 대비</th><td>${n(P / pub, 2)}배</td></tr>` : ''}</table></div>`;
    }
    if (st.kind === '매매') {
      const I = income();
      if (!I) return '';
      if (rentRoll() && !st.incDep && !st.incRent) return ''; // 임대 현황 표에 함께 보여 줌
      return `<div class="s-sec"><h2>수익 정보</h2><table class="s-tbl">
        <tr><th>보증금 합계</th><td>${won(I.dep)}</td></tr>
        <tr><th>월 임대료</th><td>${won(I.rent)} <small>연 ${won(I.year)}</small></td></tr>
        <tr><th>실투자금</th><td>${won(I.inv)} <small>매매가 − 보증금</small></td></tr>
        <tr class="hl"><th>수익률</th><td>${I.yld != null ? n(I.yld, 2) + '%' : '-'} <small>대출 제외, 세전</small></td></tr></table></div>`;
    }
    const rows = st.kind === '전세'
      ? [['전세 보증금', st.jeonse], ['관리비', st.fee], ['입주 가능일', st.moveIn]]
      : [['보증금', st.deposit], [st.ptype === 'land' ? '월 임대료' : '월세', st.rent], ['관리비', st.fee], [st.ptype === 'land' ? '사용 가능일' : '입주 가능일', st.moveIn]];
    if (st.ptype === 'bld') rows.push(['권리금', st.premium], ['임대 층', st.floor], ['임대 면적', st.exArea && (m2(st.exArea) ? `${pyTxt(m2(st.exArea))} (${n(m2(st.exArea), 1)}㎡)` : st.exArea)]);
    const r = rows.filter(x => x[1]);
    if (!r.length) return '';
    return `<div class="s-sec"><h2>${st.ptype === 'land' && st.kind === '월세' ? '임대' : st.kind} 조건</h2><table class="s-tbl">${r.map(([a, b], i) => `<tr class="${i === 0 ? 'hl' : ''}"><th>${a}</th><td>${esc(b)}</td></tr>`).join('')}</table></div>`;
  }
  const head = () => `<div class="s-head"><div><span class="kind ${st.kind === '전세' ? 'k-jeonse' : st.kind === '월세' ? 'k-wolse' : ''}">${esc(st.kind)}</span><h1>${esc(st.title || autoTitle)}</h1><div class="addr">${esc(D.addr)}${D.road ? ' · ' + esc(D.road) : ''}</div></div>${priceBlock()}</div>`;
  // 사진 비율: 자동이면 대표 사진에 가장 가까운 비율
  function ratio() {
    const R = { '43': 4 / 3, '34': 3 / 4, '11': 1 };
    if (R[st.ratio]) return R[st.ratio];
    const p = st.photos[0]; if (!p || !p.w) return 4 / 3;
    const a = p.w / p.h; return [4 / 3, 3 / 4, 1].sort((x, y) => Math.abs(Math.log(x / a)) - Math.abs(Math.log(y / a)))[0];
  }
  // 정해진 칸(W×H mm) 안에서 사진이 가장 크게 보이는 배치를 고릅니다. 사진은 고른 비율 그대로 들어갑니다.
  function layout(n, r, W, H, g = 2) {
    const C = [];
    const add = (name, fn) => { // fn(s) → {w,h,rects}; s는 대표 사진 높이(mm), 크기는 s에 비례
      const a = fn(0), b = fn(1), aw = b.w - a.w, ah = b.h - a.h;
      const s = Math.min(aw > 0 ? (W - a.w) / aw : 1e9, ah > 0 ? (H - a.h) / ah : 1e9);
      if (s <= 0) return; const L = fn(s);
      const area = L.rects.reduce((t, q) => t + q.w * q.h, 0), main = L.rects[0].w * L.rects[0].h;
      C.push({ name, ...L, score: area + main * 0.6 });
    };
    if (n === 1) add('one', s => ({ w: s * r, h: s, rects: [{ x: 0, y: 0, w: s * r, h: s }] }));
    else {
      add('row', s => ({ w: n * s * r + (n - 1) * g, h: s, rects: [...Array(n)].map((_, i) => ({ x: i * (s * r + g), y: 0, w: s * r, h: s })) }));
      const k = n - 1;
      add('side', s => { const th = (s - (k - 1) * g) / k; return { w: s * r + g + th * r, h: s, rects: [{ x: 0, y: 0, w: s * r, h: s }, ...[...Array(k)].map((_, j) => ({ x: s * r + g, y: j * (th + g), w: th * r, h: th }))] }; });
      add('under', s => { const tw = (s * r - (k - 1) * g) / k, th = tw / r; return { w: s * r, h: s + g + th, rects: [{ x: 0, y: 0, w: s * r, h: s }, ...[...Array(k)].map((_, j) => ({ x: j * (tw + g), y: s + g, w: tw, h: th }))] }; });
      if (n === 4) add('grid', s => ({ w: 2 * s * r + g, h: 2 * s + g, rects: [0, 1, 2, 3].map(i => ({ x: (i % 2) * (s * r + g), y: Math.floor(i / 2) * (s + g), w: s * r, h: s })) }));
    }
    return C.sort((x, y) => y.score - x.score)[0];
  }
  let photoK = 1; // 내용이 넘치면 사진 칸을 조금씩 줄입니다
  const AREA = { classic: [188, 68], photo: [188, 96], split: [78, 112] };
  function photos() {
    const ps = st.photos, [W, H0] = AREA[st.tpl] || AREA.classic, H = H0 * photoK;
    if (!ps.length) {
      const h = st.tpl === 'photo' ? 80 : st.tpl === 'split' ? 70 : 50;
      if (st.mapSrc) return `<div class="s-photos" style="height:${h}mm"><img src="${st.mapSrc}" alt="위치 지도" style="left:0;top:0;width:100%;height:100%"></div>`;
      return `<div class="s-photos" style="height:${h}mm"><div class="s-ph-empty" style="height:100%;width:100%">왼쪽에서 사진을 추가해 주세요</div></div>`;
    }
    const Lx = layout(ps.length, ratio(), W, H);
    return `<div class="s-photos" style="width:${Lx.w.toFixed(2)}mm;height:${Lx.h.toFixed(2)}mm">${Lx.rects.map((q, i) => `<img src="${ps[i].src}" alt="" style="left:${q.x.toFixed(2)}mm;top:${q.y.toFixed(2)}mm;width:${q.w.toFixed(2)}mm;height:${q.h.toFixed(2)}mm">`).join('')}</div>`;
  }
  function aptInfo() {
    if (st.ptype !== 'apt') return '';
    const ex = m2(st.exArea);
    const pk = st.park || (B && B.pk && B.hhld ? `세대당 ${n(B.pk / B.hhld, 1)}대` : '');
    const rows = [['전용면적', ex ? `${n(ex, 2)}㎡ <small>${pyTxt(ex)}</small>` : ''], ['공급 · 평형', esc(st.supArea)], ['방 · 욕실', esc(st.rooms)], ['해당 층', esc(st.floor)], ['향', esc(st.dir)],
      ['관리비', esc(st.fee)], ['입주 가능일', esc(st.kind === '매매' ? st.moveIn : '')], ['주차', esc(pk)]].filter(r => r[1]);
    if (!rows.length) return '';
    return `<div class="s-sec"><h2>세대 정보</h2><table class="s-tbl">${rows.map(([a, b]) => `<tr><th>${a}</th><td>${b}</td></tr>`).join('')}</table></div>`;
  }
  function rentTbl() {
    const R = rentRoll(); if (!R) return '';
    return `<div class="s-sec full"><h2>임대 현황</h2><table class="s-tbl s-rr"><tr><th>층</th><th>업종</th><th>보증금</th><th>월세</th></tr>
      ${R.rows.map(r => `<tr><td>${esc(r.fl)}</td><td>${esc(r.biz || '-')}</td><td>${r.dep != null ? won(r.dep) : '-'}</td><td>${r.rent != null ? won(r.rent) : '-'}</td></tr>`).join('')}
      <tr class="hl"><td>합계</td><td></td><td>${won(R.dep)}</td><td>${won(R.rent)}</td></tr></table>${(() => { const I = income(); return I && !st.incDep && !st.incRent ? `<div class="s-yld">실투자금 <b>${won(I.inv)}</b> · 연 임대료 <b>${won(I.year)}</b> · 수익률 <b class="acc">${I.yld != null ? n(I.yld, 2) + '%' : '-'}</b><small>대출 제외, 세전</small></div>` : ''; })()}</div>`;
  }
  const intro = () => st.intro ? `<div class="s-intro">${esc(st.intro)}</div>` : '';
  function landTbl() {
    if (!st.show.land || !D.land) return '';
    const p = D.price;
    return `<div class="s-sec"><h2>${st.ptype === 'apt' ? '대지' : '토지'}</h2><table class="s-tbl">
      <tr><th>대지면적</th><td>${arP(L.area)}</td></tr>
      <tr><th>용도지역</th><td>${esc(L.zone || '-')}${L.zone2 && L.zone2 !== '지정되지않음' ? ` <small>${esc(L.zone2)}</small>` : ''}</td></tr>
      <tr><th>지목</th><td>${esc(L.jimok || '-')}</td></tr>
      ${st.ptype === 'land' ? `<tr><th>이용 상태</th><td>${esc(st.landNow || L.use || '-')}</td></tr>${L.shape ? `<tr><th>형상 · 지세</th><td>${esc(L.shape)}${L.height ? ' · ' + esc(L.height) : ''}</td></tr>` : ''}` : ''}
      <tr><th>공시지가</th><td>${p ? `${n(p.per)}원/㎡ <small>${esc(p.year || '')}년</small>` : '-'}</td></tr>
      ${p && L.area ? `<tr><th>공시지가 총액</th><td>${won(p.per * L.area / 10000)}</td></tr>` : ''}
      <tr><th>도로접면</th><td>${esc(L.road || '-')}</td></tr>
    </table></div>`;
  }
  function bldTbl() {
    if (!st.show.bld || !B) return '';
    const age = B.apr ? new Date().getFullYear() - Number(String(B.apr).slice(0, 4)) : null;
    return `<div class="s-sec"><h2>${st.ptype === 'apt' ? '단지 · 건물' : '건물'}</h2><table class="s-tbl">
      <tr><th>주용도</th><td>${esc(B.use || '-')}</td></tr>
      ${st.ptype === 'apt' && B.hhld ? `<tr><th>세대수</th><td>${n(B.hhld)}세대</td></tr>` : ''}
      <tr><th>규모</th><td>${B.ugrnd ? `지하 ${B.ugrnd}층 / ` : ''}지상 ${B.grnd ?? '-'}층${B.cnt > 1 ? ` <small>${B.cnt}개 동</small>` : ''}</td></tr>
      <tr><th>연면적</th><td>${arP(B.tot)}</td></tr>
      ${st.ptype === 'apt' ? '' : `<tr><th>건폐율·용적률</th><td>${B.bc != null ? n(B.bc, 1) + '%' : '-'} · ${B.vl != null ? n(B.vl, 1) + '%' : '-'}</td></tr>`}
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
    if (!st.photos.length) return ''; // 사진이 없으면 사진 자리에 이미 지도가 들어감
    return `<div class="s-sec"><h2>위치</h2><div class="s-map" style="height:${h}mm"><img src="${st.mapSrc}" alt="위치 지도"></div></div>`;
  }
  function trades() {
    if (!st.show.trade || !D.trades || !D.trades.length) return '';
    return `<div class="s-sec"><h2>${st.ptype === 'apt' ? '이 건물 최근 실거래' : '이 필지 최근 실거래'}</h2><table class="s-tbl">${D.trades.map(t => `<tr><th>${esc(t.d)}</th><td>${won(t.p)}${t.ex ? ` <small>${n(t.ex, 1)}㎡${t.f ? ' · ' + esc(t.f) + '층' : ''}</small>` : ''}</td></tr>`).join('')}</table></div>`;
  }
  const two = (a, b) => (a && b) ? `<div class="s-two">${a}${b}</div>` : (a || b);
  function foot() {
    const A = st.agent;
    const line = [A.ceo && `대표 ${esc(A.ceo)}`, A.tel && esc(A.tel), A.reg && `등록번호 ${esc(A.reg)}`].filter(Boolean).join(' · ');
    return `<div class="s-foot"><div class="ag">${A.logo ? `<img src="${A.logo}" alt="">` : ''}<div><b>${esc(A.name || '')}</b><span>${line}</span>${A.addr ? `<br><span>${esc(A.addr)}</span>` : ''}</div></div>
      <div class="rm"><i><img src="/favicon.svg" width="12" height="12" alt="">리얼맵</i><br>공공데이터 기준 · ${new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10).replace(/-/g, '.')} 작성<br>세부 내용은 공부서류로 다시 확인하시기 바랍니다.</div></div>`;
  }

  function draw() {
    // 먼저 사진 칸을 줄여 보고, 그래도 많으면 글씨를 줄입니다
    for (const [k, minZ] of [[1, .94], [.85, .9], [.72, 0]]) { photoK = k; if (drawOnce(minZ)) break; }
  }
  function drawOnce(minZ) {
    const sh = $('sheet');
    sh.className = `sheet t-${st.tpl} c-${st.color} f-${st.font}`;
    document.querySelectorAll('[data-kind]').forEach(b => b.setAttribute('aria-pressed', b.dataset.kind === st.kind));
    document.querySelectorAll('[data-font]').forEach(b => b.setAttribute('aria-pressed', b.dataset.font === st.font));
    document.querySelectorAll('[data-tpl]').forEach(b => b.setAttribute('aria-pressed', b.dataset.tpl === st.tpl));
    document.querySelectorAll('[data-color]').forEach(b => b.setAttribute('aria-pressed', b.dataset.color === st.color));
    document.querySelectorAll('[data-type]').forEach(b => b.setAttribute('aria-pressed', b.dataset.type === st.ptype));
    document.querySelectorAll('[data-ratio]').forEach(b => b.setAttribute('aria-pressed', b.dataset.ratio === st.ratio));
    const T = st.ptype, tm = trades() || map(40);
    const order = T === 'apt' ? [dealTbl(), aptInfo(), bldTbl(), feats(), loc(), tm, landTbl()]
      : T === 'bld' ? [dealTbl(), feats(), rentTbl(), landTbl(), bldTbl(), loc(), tm]
      : [dealTbl(), feats(), landTbl(), loc(), tm, bldTbl()];
    // 두 칸씩 짝지어 배치 (임대 현황 같은 넓은 표는 한 줄 전체)
    const pack = list => { const out = []; let hold = ''; list.filter(Boolean).forEach(x => { if (x.includes('s-sec full')) out.push(x); else if (hold) { out.push(two(hold, x)); hold = ''; } else hold = x; }); if (hold) out.push(hold); return out.join(''); };
    let body;
    if (st.tpl === 'photo') {
      body = `<div class="s-hero">${photos()}</div>${head()}<div class="s-body">${keys()}${intro()}${pack(order)}</div>`;
    } else if (st.tpl === 'split') {
      const left = `${photos()}${st.show.map && st.mapSrc && st.photos.length ? `<div class="s-map" style="height:44mm"><img src="${st.mapSrc}" alt="위치 지도"></div>` : ''}${loc()}${feats()}`;
      const right = order.filter(x => x && x !== loc() && x !== feats() && !(st.photos.length && x === map(40)));
      body = `${head()}<div class="s-body"><div class="s-left">${left}</div><div class="s-right">${keys()}${intro()}${right.join('')}</div></div>`;
    } else {
      body = `${head()}<div class="s-body"><div class="s-ph-wrap">${photos()}</div>${keys()}${intro()}${pack(order)}</div>`;
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
    return !st.photos.length || (!over && z >= minZ);
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
