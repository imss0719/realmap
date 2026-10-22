/* 리얼맵 화면 스크립트
   지도(카카오) → 필지 선택(브이월드 연속지적도) → 패널에 토지·이용계획·건물·호별·실거래 표시 */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const PY = 3.305785;
  const S = {
    cfg: null, map: null, rv: null, rvc: null, geocoder: null, places: null, polys: [], marker: null,
    sel: null, tok: 0, d: {}, tab: 'land', view: 'map', unit: 'm2', tradeMode: 'sale', months: 12,
    bldIdx: 0, uDong: null, uHo: null,
  };

  // ---------- 공통 ----------
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const n = (v, d = 0) => v == null || isNaN(v) ? '-' : Number(v).toLocaleString('ko-KR', { minimumFractionDigits: d, maximumFractionDigits: d });
  const toPy = m => m / PY;
  const ar = (m2, d = 2) => { if (m2 == null) return ['-', '']; const a = `${n(m2, d)}㎡`, b = `${n(toPy(m2), d)}평`; return S.unit === 'm2' ? [a, b] : [b, a]; };
  const arI = m2 => { const [a, b] = ar(m2); return m2 == null ? '-' : `${a}<small>${b}</small>`; };
  const won = man => { if (man == null) return '-'; man = Math.round(man); const e = Math.floor(man / 10000), r = man % 10000; if (e && r) return `${e}억 ${n(r)}만원`; if (e) return `${e}억원`; return `${n(r)}만원`; };
  const wonW = w => w == null ? '-' : won(w / 10000);
  const per = p => p == null ? '-' : S.unit === 'm2' ? `${n(p)}원/㎡` : `${n(Math.round(p * PY))}원/평`;
  const ymd = s => { s = String(s || ''); if (/^\d{8}$/.test(s)) return `${s.slice(0, 4)}.${s.slice(4, 6)}.${s.slice(6)}`; if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10).replace(/-/g, '.'); if (/^\d{6}$/.test(s)) return `${s.slice(0, 4)}.${s.slice(4)}`; return s || '-'; };
  const val = v => v == null || v === '' ? '-' : esc(v);
  const skel = () => '<div class="sk"><i></i><i></i><i></i></div>';
  // 이용자에게는 기술적인 오류 문구를 보여 주지 않습니다 (원문은 개발자 도구 콘솔에만 남김)
  const errBox = (label, raw) => {
    if (raw) console.warn('[리얼맵]', label || '', raw);
    return `<div class="err soft"><span>${label ? esc(label) + ' 정보를' : '정보를'} 잠시 불러오지 못했습니다.</span><button type="button" data-retry>다시 불러오기</button></div>`;
  };
  // 사람이 읽어도 되는 안내만 그대로 보여 주고, 나머지는 일반 문구로 바꿉니다
  const OK_MSG = ['not_found', 'bad_point', 'bad_pnu', 'login', 'limit'];
  const friendly = e => (e && OK_MSG.includes(e.code) && e.message) ? e.message : '잠시 연결이 원활하지 않습니다. 다시 한번 눌러 주세요.';
  const src = a => `<p class="src">출처 · ${a.join(' · ')}</p>`;
  function toast(msg, ms = 2600) { const t = $('toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast.t); if (ms) toast.t = setTimeout(() => t.hidden = true, ms); }
  async function api(path, tries = 3) {
    let last;
    for (let i = 0; i < tries; i++) {
      if (i) await new Promise(r => setTimeout(r, 700 * i + Math.random() * 400));
      try {
        const r = await fetch(i ? path + (path.includes('?') ? '&' : '?') + 'rt=' + i : path); // 다시 시도할 때는 저장된 실패 응답을 피함
        let j; try { j = await r.json(); } catch { last = new Error(`응답 오류 ${r.status}`); continue; }
        if (!j.ok) { const e = new Error(j.message || '오류'); e.code = j.error; if (OK_MSG.includes(e.code) || r.status === 400 || r.status === 404) throw e; last = e; continue; }
        return j;
      } catch (e) { if (OK_MSG.includes(e.code) || e.code === 'bad_kinds') throw e; last = e; }
    }
    console.warn('[리얼맵]', path, last && last.message);
    throw last;
  }
  // 응답 안에 일부만 실패한 항목이 있는지 (공공데이터 일시 장애)
  const partFail = j => !!j && Object.values(j).some(v => v && typeof v === 'object' && v.ok === false);
  const mobile = () => matchMedia('(max-width:760px)').matches;

  // ---------- 시작 ----------
  init();
  // 방문 통계: 브라우저마다 임의의 번호 하나만 씁니다 (이름·연락처 같은 개인정보 없음)
  // 운영자 기기(한 번이라도 운영자로 로그인한 브라우저)는 로그아웃 상태여도 세지 않습니다
  function hit(k, gu) {
    let v = '', op = false; try { op = localStorage.getItem('rm.op') === '1'; v = localStorage.getItem('rm.vid') || ''; if (!v) { v = Math.random().toString(36).slice(2) + Date.now().toString(36); localStorage.setItem('rm.vid', v); } } catch { /* 저장 불가 */ }
    if (op) return;
    let src = '';
    if (k === 'v') { try { if (!sessionStorage.getItem('rm.src')) { src = visitSrc(); sessionStorage.setItem('rm.src', src); } } catch { src = visitSrc(); } }
    try { fetch(`/api/auth?action=hit&k=${k}&v=${encodeURIComponent(v)}${src ? '&src=' + src : ''}${gu ? '&g=' + gu : ''}`, { keepalive: true }).catch(() => {}); } catch { /* 무시 */ }
  }
  // 어디서 들어왔는지: 링크에 붙인 ?from=, 앱 안 브라우저, 이전 페이지 주소 순으로 판단
  function visitSrc() {
    const from = (new URLSearchParams(location.search).get('from') || '').toLowerCase();
    const MAP = { blog: 'blog', insta: 'insta', instagram: 'insta', reels: 'insta', kakao: 'kakao', youtube: 'youtube', yt: 'youtube' };
    if (MAP[from]) return MAP[from];
    const ua = navigator.userAgent || '';
    if (/Instagram/i.test(ua)) return 'insta';
    if (/KAKAOTALK/i.test(ua)) return 'kakao';
    let h = ''; try { h = document.referrer ? new URL(document.referrer).hostname : ''; } catch { /* 무시 */ }
    if (!h || h === location.hostname) return /NAVER\(inapp/i.test(ua) ? 'naver' : 'direct';
    if (/blog\.naver\.com$/.test(h)) return 'blog';
    if (/search\.naver\.com$/.test(h)) return 'nsearch';
    if (/naver\.(com|me)$/.test(h)) return 'naver';
    if (/instagram\.com$/.test(h)) return 'insta';
    if (/kakao\.com$|daum\.net$/.test(h)) return /daum/.test(h) ? 'daum' : 'kakao';
    if (/youtube\.com$|youtu\.be$/.test(h)) return 'youtube';
    if (/google\./.test(h)) return 'google';
    return 'etc';
  }
  hit('v');
  async function init() {
    loadMe();
    try { S.cfg = await api('/api/config'); } catch (e) { console.warn('[리얼맵] config', e.message); return setup('잠시 연결이 원활하지 않습니다. 잠시 후 새로고침해 주세요.'); }
    if (S.cfg.siteName) { $('siteName').textContent = S.cfg.siteName; document.title = S.cfg.siteName; }
    if (!S.cfg.kakaoKey) return setup('카카오 JavaScript 키(KAKAO_JS_KEY)가 아직 등록되지 않았습니다.');
    const sc = document.createElement('script');
    sc.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${encodeURIComponent(S.cfg.kakaoKey)}&libraries=services&autoload=false`;
    sc.onload = () => window.kakao.maps.load(start);
    sc.onerror = () => setup('카카오 지도를 불러오지 못했습니다. 카카오 개발자센터에 이 사이트 주소가 등록되어 있는지 확인해 주세요.');
    document.head.appendChild(sc);
  }
  function setup(msg) {
    const s = $('setup'); s.hidden = false;
    s.innerHTML = `<div><b>아직 준비 중입니다</b><span>${msg}</span><a href="check.html">연결 점검 페이지 열기</a></div>`;
  }

  function start() {
    const K = kakao.maps;
    S.map = new K.Map($('map'), { center: new K.LatLng(37.5563, 126.9236), level: 3 });
    S.map.addControl(new K.ZoomControl(), K.ControlPosition.BOTTOMRIGHT);
    S.geocoder = new K.services.Geocoder();
    S.places = new K.services.Places();
    S.rvc = new K.RoadviewClient();
    K.event.addListener(S.map, 'click', e => { const la = e.latLng.getLat(), ln = e.latLng.getLng(); if (M.on) return measureClick(la, ln); devHit(la, ln); pick(la, ln); });

    const setType = sky => { S.map.setMapTypeId(sky ? K.MapTypeId.HYBRID : K.MapTypeId.ROADMAP); $('mtRoad').setAttribute('aria-pressed', !sky); $('mtSky').setAttribute('aria-pressed', sky); };
    $('mtRoad').onclick = () => setType(false);
    $('mtSky').onclick = () => setType(true);
    $('mtCad').onclick = () => {
      const on = $('mtCad').getAttribute('aria-pressed') !== 'true';
      on ? S.map.addOverlayMapTypeId(K.MapTypeId.USE_DISTRICT) : S.map.removeOverlayMapTypeId(K.MapTypeId.USE_DISTRICT);
      $('mtCad').setAttribute('aria-pressed', on);
    };
    $('close').onclick = () => $('panel').classList.add('closed');
    $('vMap').onclick = () => setView('map');
    $('vRv').onclick = () => setView('rv');
    devInit();
    tradeMapInit();
    measureInit();
    $('mtFav').onclick = () => S.me.ready && !S.me.member ? loginModal('fav') : openFavSheet();
    if (mobile()) $('panel').classList.add('closed');
    wireSearch();

    const qs = new URLSearchParams(location.search), pnu = qs.get('pnu'), qla = +qs.get('lat'), qln = +qs.get('lng');
    if (pnu) pickPnu(pnu);
    else if (qla > 33 && qla < 39 && qln > 124 && qln < 132) { // 정비사업 안내 페이지 등에서 '지도에서 보기'
      S.map.setLevel(3); S.map.setCenter(new K.LatLng(qla, qln)); pick(qla, qln);
    } else toast('필지를 누르면 정보가 열립니다');
  }

  // ---------- 필지 선택 ----------
  async function pick(lat, lng) {
    const tok = ++S.tok;
    toast('필지를 찾는 중입니다…', 0);
    try {
      const p = await api(`/api/parcel?lat=${lat}&lng=${lng}`);
      if (tok !== S.tok) return;
      select(p, tok);
    } catch (e) { if (tok === S.tok) toast(friendly(e)); }
  }
  async function pickPnu(pnu) {
    const tok = ++S.tok;
    try {
      const p = await api(`/api/parcel?pnu=${encodeURIComponent(pnu)}`);
      if (tok !== S.tok) return;
      select(p, tok, true);
    } catch (e) { toast(friendly(e)); }
  }

  function ringsOf(g) {
    if (!g) return [];
    if (g.type === 'Polygon') return [g.coordinates];
    if (g.type === 'MultiPolygon') return g.coordinates;
    return [];
  }
  function centroid(g) {
    const ring = ringsOf(g)[0]?.[0] || [];
    if (!ring.length) return null;
    let x = 0, y = 0; ring.forEach(([a, b]) => { x += a; y += b; });
    return { lng: x / ring.length, lat: y / ring.length };
  }

  function select(p, tok, pan) {
    const K = kakao.maps;
    $('toast').hidden = true;
    S.polys.forEach(o => o.setMap(null)); S.polys = [];
    for (const poly of ringsOf(p.geometry)) {
      const path = poly.map(ring => ring.map(([x, y]) => new K.LatLng(y, x)));
      S.polys.push(new K.Polygon({ map: S.map, path, strokeWeight: 3, strokeColor: '#E4572E', strokeOpacity: 1, fillColor: '#E4572E', fillOpacity: 0.16 }));
    }
    const c = centroid(p.geometry);
    S.sel = { ...p, c, dongName: '', road: '' };
    hit('p', String(p.pnu || '').slice(0, 5));
    joinNudge();
    S.d = {}; S.bldIdx = 0; S.uDong = null; S.uHo = null; S.uHoManual = false; S.uHoDraft = ''; S.tradeMode = 'sale'; S.seen = {}; S.tab = 'land'; S.floorsAll = false;
    if (c && (pan || mobile())) {
      const ll = new K.LatLng(c.lat, c.lng);
      if (mobile()) { S.map.setCenter(ll); S.map.panBy(0, Math.round(innerHeight * 0.22)); } else S.map.panTo(ll);
    }
    history.replaceState(null, '', `?pnu=${p.pnu}`);
    // 법정동 이름: 주소의 마지막 동/리 단위
    const parts = String(p.addr || '').split(' ');
    S.sel.dongName = parts.length >= 2 ? parts[parts.length - 2] : '';
    $('intro').hidden = true;
    if ($('homeCard')) $('homeCard').hidden = true;
    $('panel').classList.remove('closed');
    if (S.view === 'rv' && c) bigTo({ lat: c.lat, lng: c.lng }, c);
    if (c) S.geocoder.coord2Address(c.lng, c.lat, (r, st) => {
      if (tok !== S.tok || st !== K.services.Status.OK || !r[0]) return;
      S.sel.road = r[0].road_address?.address_name || '';
      if (!S.sel.bname && r[0].road_address?.building_name) S.sel.bname = r[0].road_address.building_name;
      render();
    });
    render(); $('panel').scrollTop = 0;
    const pnu = p.pnu;
    loadLand(tok); loadBld(tok);
  }
  // 일부 항목이 실패해 오면 조용히 한 번 더 받아 옵니다
  function loadLand(tok, again) {
    api(`/api/land?pnu=${S.sel.pnu}${again ? '&rt=9' : ''}`).then(j => {
      if (tok !== S.tok) return;
      if (partFail(j) && !again) { if (!S.d.land || S.d.land.error) { S.d.land = j; render(); } return setTimeout(() => loadLand(tok, true), 1500); }
      S.d.land = j; render();
    }).catch(e => { if (tok === S.tok) { S.d.land = { error: e.message }; render(); } });
  }
  function loadBld(tok, again) {
    api(`/api/building?pnu=${S.sel.pnu}${again ? '&rt=9' : ''}`).then(j => {
      if (tok !== S.tok) return;
      if (partFail(j) && !again) { setTimeout(() => loadBld(tok, true), 1500); if (S.d.bld && !S.d.bld.error) return; }
      S.d.bld = j; render();
      // 묶음 필지·대표 필지·층별은 건물 정보가 제대로 온 뒤 한 번만
      if (j.titles && j.titles.ok && !S.d.bldInit) { S.d.bldInit = true; drawAtch(tok); checkMain(tok); loadFloors(tok); }
    }).catch(e => { if (tok === S.tok) { S.d.bld = { error: e.message }; render(); } });
  }

  // [다시 불러오기] 버튼: 실패한 부분만 비우고 다시 받습니다
  function retryFailed() {
    const tok = S.tok, D = S.d;
    if (!D) return;
    if (!D.land || D.land.error || partFail(D.land)) { D.land = null; loadLand(tok, true); }
    if (!D.bld || D.bld.error || (D.bld.titles && !D.bld.titles.ok)) { D.bld = null; loadBld(tok, true); }
    else if (D.bld.floors && D.bld.floors.ok === false) { D.bld.floors = null; loadFloors(tok); }
    if (D.trades && (D.trades.error || (D.trades.errors && D.trades.errors.length))) D.trades = null;
    if (D.units && D.units.error) D.units = null;
    if (D.stores && D.stores.error) D.stores = null;
    for (const o of [D.udong, D.unit]) if (o) for (const k in o) if (o[k] && (o[k].error || partFail(o[k]))) delete o[k];
    render();
  }
  document.addEventListener('click', e => { if (e.target.closest('[data-retry]')) retryFailed(); });

  // 층별개요는 건물 정보를 먼저 띄운 뒤 따로 받습니다 (큰 단지는 수천 건)
  function loadFloors(tok) {
    const B = S.d.bld; if (!B || B.floors || !(B.titles && B.titles.ok && B.titles.data.length)) return;
    B.floors = { loading: true };
    prefetchUnits();
    api(`/api/building?pnu=${S.sel.pnu}&part=floors`).then(j => { if (tok === S.tok) { B.floors = j.floors || { ok: false, message: '층별개요를 받지 못했습니다.' }; render(); } })
      .catch(e => { if (tok === S.tok) { B.floors = { ok: false, message: e.message }; render(); } });
  }

  // ---------- 아파트 관리비 · 단지 정보 (K-apt) ----------
  const isApt = () => collTitle() && /아파트|공동주택/.test(uses()) && !/다세대|연립/.test(uses());
  const man1 = w => w == null ? '-' : `${n(w / 10000, 1)}만원`;
  function kaptSection() {
    const K = S.d.kapt;
    if (!K) {
      const tok = S.tok, rc = recap(), m = mainT();
      S.d.kapt = { loading: true };
      api(`/api/building?pnu=${S.sel.pnu}&part=kapt&name=${encodeURIComponent((rc && rc.name) || (m && m.name) || S.sel.bname || '')}`)
        .then(j => { if (tok === S.tok) { S.d.kapt = j; render(); } }).catch(e => { if (tok === S.tok) { S.d.kapt = { error: e.message }; render(); } });
      return `<section><h2>관리비 · 단지 정보</h2>${skel()}</section>`;
    }
    if (K.loading) return `<section><h2>관리비 · 단지 정보</h2>${skel()}</section>`;
    if (K.error) return `<section><h2>관리비 · 단지 정보</h2>${errBox('관리비', K.error)}</section>`;
    const k = K.kapt;
    if (!k) return `<section><h2>관리비 · 단지 정보</h2><div class="empty">K-apt(공동주택관리정보시스템)에 관리비가 공개되지 않는 단지입니다. 의무관리대상(대략 150세대 이상 등) 아파트만 공개됩니다.</div></section>`;
    const mem = S.me.member || !S.me.ready;
    const ym = k.month ? `${k.month.slice(0, 4)}년 ${+k.month.slice(4)}월분` : '';
    const out = [`<section class="kapt"><h2>관리비 · 단지 정보<span>K-apt</span></h2>`];
    if (k.perHH) {
      const g = k.groups || [], tot = g.reduce((s2, x) => s2 + x.v, 0) || 1;
      const cmn = g.filter(x => ['gen', 'svc', 'fac'].includes(x.g)).reduce((s2, x) => s2 + x.v, 0), ind = tot - cmn;
      const hh = k.hh || 1;
      out.push(`<div class="kh"><div class="l">세대당 월 관리비 (평균 추정) · ${ym}</div><div class="v">약 ${man1(k.perHH)}</div><div class="s">공용관리비 ${man1(cmn / hh)} + 개별사용료 ${man1(ind / hh)} · 장기수선충당금 제외</div></div>`);
      const COLS = { gen: '#14212E', svc: '#2D4B6E', fac: '#5B7FA6', heat: '#F2B705', util: '#F6CF5A' };
      const lockedHtml = `${k.perM2 ? `<div class="kcmp"><div><span>전용 59㎡ 환산</span><b>약 ${man1(k.perM2 * 59)}</b></div><div><span>전용 84㎡ 환산</span><b>약 ${man1(k.perM2 * 84)}</b></div><div><span>전용 114㎡ 환산</span><b>약 ${man1(k.perM2 * 114)}</b></div></div>` : ''}
        <h3 class="kt">항목별 <span>세대당 월 평균</span></h3>
        <div class="kbar">${g.map(x => `<i style="width:${(x.v / tot * 100).toFixed(1)}%;background:${COLS[x.g]}"></i>`).join('')}</div>
        <div class="klg">${g.map(x => `<div><i style="background:${COLS[x.g]}"></i>${esc(x.label)}<b>${man1(x.v / hh)}</b></div>`).join('')}</div>
        ${mem ? kaptTrendHtml(k) : `<h3 class="kt">최근 12개월 추이 <span>난방·전기·수도</span></h3><div class="ktr">${[72, 70, 78, 92, 100, 96, 80, 70, 66, 68, 72, 74].map(h => `<i style="height:${h}%"></i>`).join('')}</div>`}`;
      out.push(mem ? lockedHtml : `<div class="klock"><div class="kblur" aria-hidden="true">${lockedHtml}</div><div class="kcta"><b>평형별 관리비 · 항목별 내역 · 12개월 추이</b><span>회원이면 무료로 모두 보실 수 있습니다</span><button type="button" class="kbtn" id="kaptLogin">카카오로 3초 가입하고 보기</button></div></div>`);
    } else out.push('<div class="empty">이 단지는 최근 관리비 공개 자료가 아직 없습니다.</div>');
    const pk = k.parking && k.hh ? `${n(k.parking)}대 · 세대당 ${n(k.parking / k.hh, 2)}대` : (k.parking ? n(k.parking) + '대' : '');
    out.push(`<dl class="kv">${[['단지명', esc(k.name || '')], ['세대수 · 동수', `${k.hh ? n(k.hh) + '세대' : '-'}${k.dongCnt ? ' · ' + n(k.dongCnt) + '개 동' : ''}`], ['난방 방식', esc(k.heat || '')], ['복도 유형', esc(k.hall || '')], ['시공사', esc(k.builder || '')], ['관리 방식', esc(k.mgr || '')], ['주차', pk], ['승강기', k.elev ? n(k.elev) + '대' : '']].filter(r => r[1] && r[1] !== '-').map(([a, b]) => `<dt>${a}</dt><dd>${b}</dd>`).join('')}</dl>`);
    out.push('<p class="note">관리비는 단지가 K-apt에 신고한 금액을 세대수로 나눈 평균이며, 실제 고지액은 평형·사용량에 따라 다릅니다. 평형별 금액은 관리비 부과면적 비율로 환산한 추정치입니다. 매달 1~2개월 늦게 반영됩니다.</p>');
    out.push(src(['국토교통부 공동주택관리정보시스템(K-apt)']) + '</section>');
    return out.join('');
  }
  function kaptTrendHtml(k) {
    const T = S.d.kaptT;
    if (!T && k.month) {
      const tok = S.tok; S.d.kaptT = { loading: true };
      api(`/api/building?pnu=${S.sel.pnu}&part=kaptTrend&code=${encodeURIComponent(k.code)}&ym=${k.month}`).then(j => { if (tok === S.tok) { S.d.kaptT = j; render(); } }).catch(() => { if (tok === S.tok) { S.d.kaptT = { error: true }; render(); } });
    }
    const head = '<h3 class="kt">최근 12개월 추이 <span>난방·전기·수도 등 개별사용료</span></h3>';
    if (!T || T.loading) return head + skel();
    if (T.error || !T.trend) return '';
    const hh = k.hh || 1, mx = Math.max(1, ...T.trend.map(x => x.v));
    return head + `<div class="ktr">${T.trend.map((x, i) => `<i class="${i === T.trend.length - 1 ? 'on' : ''}" style="height:${Math.max(3, x.v / mx * 100)}%" title="${x.m.slice(0, 4)}.${x.m.slice(4)} 세대당 ${man1(x.v / hh)}"></i>`).join('')}</div><div class="ktx">${T.trend.map(x => `<span>${+x.m.slice(4)}</span>`).join('')}</div>`;
  }

  // 공동주택이면 동·호수 탭을 누르기 전에 첫 동의 호 목록을 미리 받아 둡니다
  function prefetchUnits() {
    if (!collTitle()) return;
    const TD = titleDongs();
    if (TD.length >= 2) { S.d.udong = S.d.udong || {}; const d = TD.find(x => /\d/.test(x)) || TD[0]; if (!S.d.udong[d]) loadDong(d); }
    else if (!S.d.units) loadUnits();
  }

  // ---------- 로드뷰 ----------
  function bearing(a, b) {
    const r = Math.PI / 180, y = Math.sin((b.lng - a.lng) * r) * Math.cos(b.lat * r);
    const x = Math.cos(a.lat * r) * Math.sin(b.lat * r) - Math.sin(a.lat * r) * Math.cos(b.lat * r) * Math.cos((b.lng - a.lng) * r);
    return (Math.atan2(y, x) / r + 360) % 360;
  }


  // ---------- 크게 보는 로드뷰 (지도 / 로드뷰 전환) ----------
  function setView(v) {
    S.view = v;
    $('vMap').setAttribute('aria-pressed', v === 'map');
    $('vRv').setAttribute('aria-pressed', v === 'rv');
    $('bigrv').hidden = v !== 'rv';
    $('mtRoad').parentNode.parentNode.hidden = v === 'rv';
    if (v !== 'rv') { setTimeout(() => S.map.relayout(), 0); return; }
    const K = kakao.maps;
    if (!S.brv) {
      S.brv = new K.Roadview($('bigrvView'));
      S.mini = new K.Map($('miniMap'), { center: S.map.getCenter(), level: 3 });
      S.mini.addOverlayMapTypeId(K.MapTypeId.ROADVIEW);
      S.miniMark = new K.Marker({ map: S.mini, position: S.map.getCenter() });
      K.event.addListener(S.mini, 'click', e => bigTo({ lat: e.latLng.getLat(), lng: e.latLng.getLng() }, null));
      K.event.addListener(S.brv, 'init', () => {
        const at = S.brv.getPosition(), tgt = S.bigTarget;
        if (at && tgt) S.brv.setViewpoint({ pan: bearing({ lat: at.getLat(), lng: at.getLng() }, tgt), tilt: 0, zoom: 0 });
        if (at) { S.miniMark.setPosition(at); S.mini.setCenter(at); }
      });
      K.event.addListener(S.brv, 'position_changed', () => {
        const at = S.brv.getPosition(); if (at) { S.miniMark.setPosition(at); S.mini.panTo(at); }
      });
    }
    if (mobile()) $('panel').classList.add('closed');
    const c = S.sel && S.sel.c;
    const ctr = S.map.getCenter();
    setTimeout(() => { S.brv.relayout(); S.mini.relayout(); bigTo(c ? { lat: c.lat, lng: c.lng } : { lat: ctr.getLat(), lng: ctr.getLng() }, c || null); }, 0);
  }
  function bigTo(p, target) {
    const K = kakao.maps, pos = new K.LatLng(p.lat, p.lng);
    S.bigTarget = target;
    S.rvc.getNearestPanoId(pos, 80, id => {
      if (id === null) { $('bigrvNone').hidden = false; S.mini.setCenter(pos); S.miniMark.setPosition(pos); return; }
      $('bigrvNone').hidden = true;
      S.brv.setPanoId(id, pos);
    });
  }

  // ---------- 판단 도우미 ----------
  const titles = () => (S.d.bld && S.d.bld.titles && S.d.bld.titles.ok) ? S.d.bld.titles.data : [];
  const recap = () => (S.d.bld && S.d.bld.recap && S.d.bld.recap.ok && S.d.bld.recap.data[0]) || null;
  const mainT = () => titles().find(t => t.mainAtch === '주건축물') || titles()[0] || null;
  const chr = () => (S.d.land && S.d.land.chr && S.d.land.chr.ok && S.d.land.chr.data) || null;
  const own = () => (S.d.land && S.d.land.own && S.d.land.own.ok && S.d.land.own.data) || null;
  const housePrice = () => (S.d.land && S.d.land.house && S.d.land.house.ok && S.d.land.house.data) || null;
  const prices = () => (S.d.land && S.d.land.prices && S.d.land.prices.ok && S.d.land.prices.data) || [];
  function uses() { return titles().map(t => `${t.use || ''} ${t.etcUse || ''}`).join(' '); }
  // 건축물대장 기준 집합건물
  function collTitle() { return titles().some(t => t.regstr === '집합') || /아파트|다세대|연립|오피스텔/.test(uses()); }
  // 땅만 여러 호로 나뉘어 소유된 경우 (집합건물 대지권)
  function collOwn() { return !!(own() && own().collective); }
  function isCollective() { return collTitle() || (collOwn() && !titles().length); }
  function tradeKinds() {
    const u = uses(), k = [];
    if (!titles().length) return ['land'];
    if (/아파트/.test(u)) k.push('apt', 'aptRent');
    if (/다세대|연립/.test(u)) k.push('rh', 'rhRent');
    if (/오피스텔/.test(u)) k.push('offi', 'offiRent');
    if (/단독|다가구|다중주택|공관/.test(u)) k.push('sh', 'shRent');
    if (/근린|업무|판매|숙박|의료|교육|노유자|문화|종교|위락|공장|창고|운동|자동차|방송|발전|관광|장례|수련/.test(u) && !/아파트/.test(u)) k.push('nrg');
    if (!k.some(x => ['apt', 'rh', 'offi', 'sh'].includes(x)) && /공동주택/.test(u)) k.push('apt', 'aptRent', 'rh', 'rhRent');
    if (!k.length) k.push('nrg');
    return [...new Set(k)];
  }

  // ---------- 렌더링 ----------
  function render() {
    const p = S.sel; if (!p) return;
    const D = $('detail');
    const coll = isCollective();
    const jz = zonesHere();
    const tabs = [['land', '토지'], ['plan', '이용계획'], ...(jz.length ? [['dev', '개발']] : []), ['bld', '건물'], ...(coll ? [['unit', '동·호수']] : []), ['trade', '실거래']];
    const c = chr(), m = mainT(), rc = recap(), o = own(), pr = prices();
    const name = (rc && rc.name) || (m && m.name) || p.bname || '';
    const chips = [];
    warnsHere().forEach(w => chips.push(`<button type="button" class="chip warn" data-warn>⚠ ${esc(w.short)}</button>`));
    jz.forEach(e => chips.push(`<button type="button" class="chip dz" data-dz style="--zc:${zColor(e)}">${esc(ZSHORT[zKind(e)] || '정비구역')}</button>`));
    if (c && c.zone1) chips.push(`<span class="chip z">${esc(c.zone1)}</span>`);
    if (c && c.jimok) chips.push(`<span class="chip">${esc(c.jimok)}</span>`);
    if (m && m.use) chips.push(`<span class="chip">${esc(m.use)}</span>`);
    if (m && m.useApr) chips.push(`<span class="chip">${esc(m.useApr.slice(0, 4))}년 사용승인</span>`);
    if (o && o.type && !o.collective && o.type !== '개인') chips.push(`<span class="chip">${esc(o.type)}</span>`);
    if (atchList().length) chips.push(`<span class="chip">${atchList().length + 1}개 필지 건물</span>`);
    if (collTitle()) chips.push('<span class="chip">집합건물</span>');
    else if (collOwn()) chips.push('<span class="chip">구분소유 토지</span>');
    const latestP = pr.length ? pr[pr.length - 1] : null;
    const gfa = rc ? rc.totArea : titles().reduce((s, t) => s + (t.totArea || 0), 0) || null;
    // 한 화면에 쭉: 가벼운 정보는 바로, 무거운 정보(동·호수·실거래·입점 업종)는 화면에 가까워질 때 불러옵니다
    S.seen = S.seen || {};
    const lazy = (k, fn) => S.seen[k] ? fn() : `<div class="lazy" data-lazy="${k}">${skel()}</div>`;
    const blk = (k, label, html) => `<div class="blk" id="sec-${k}"><h2 class="blkh">${label}</h2>${html}</div>`;
    const body = [
      blk('land', '토지', landTab()),
      blk('plan', '이용계획', planTab()),
      jz.length ? blk('dev', '개발정보', devTab(jz)) : '',
      blk('bld', '건물', bldTab() + (isApt() ? lazy('kapt', kaptSection) : '') + lazy('stores', storeSection)),
      coll ? blk('unit', '동·호수', lazy('unit', unitTab)) : '',
      blk('trade', '실거래', lazy('trade', tradeTab)),
    ].join('');
    const keepScroll = $('panel').scrollTop;
    D.innerHTML = `
    <div class="head">
      <div class="h1row"><h1>${esc(p.addr || p.jibun)}</h1>${favBtns()}${p.c ? `<button class="rvbtn" id="rvBtn" type="button" aria-label="이 필지 로드뷰 크게 보기"><svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="3.2" r="2" fill="currentColor"/><path d="M5.2 15l1-6.2H5V6.6a3 3 0 0 1 6 0v2.2H9.8l1 6.2" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>로드뷰</button>` : ''}</div>
      <div class="sub">${p.road ? esc(p.road) : ''}${name ? (p.road ? ' · ' : '') + esc(name) : ''}</div>
      <div class="chips">${chips.join('') || (S.d.land ? '' : '<span class="chip">불러오는 중…</span>')}</div>
    </div>
    <div class="sum">
      <div><div class="l">대지면적</div><div class="v">${c ? ar(c.area, 1)[0] : '-'}</div></div>
      <div><div class="l">연면적</div><div class="v">${gfa ? ar(gfa, 1)[0] : '-'}</div></div>
      <div><div class="l">공시지가</div><div class="v">${latestP ? per(latestP.price) : c && c.price ? per(c.price) : '-'}</div></div>
    </div>
    <div class="bar"><button class="pnu" id="pnuCopy" title="눌러서 복사">PNU ${esc(p.pnu)}</button>
      <button class="share loc" id="locBtn" type="button"><svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 15s5-4.6 5-8.5A5 5 0 0 0 3 6.5C3 10.4 8 15 8 15z" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="8" cy="6.5" r="1.8" fill="none" stroke="currentColor" stroke-width="1.5"/></svg>입지정보</button><button class="share brief" id="briefBtn" type="button"><svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 1.5h5.5L13 5v9.5H4z M9.5 1.5V5H13 M6 8.5h5 M6 11h5" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>브리핑</button>${isHome() ? `<button class="share safe" id="safeBtn" type="button"><svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.5l5.5 2v4.2c0 3.3-2.3 5.9-5.5 6.8-3.2-.9-5.5-3.5-5.5-6.8V3.5z M5.5 8l1.8 1.8L10.8 6" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>전세 안전</button>` : ''}<button class="share" id="shareBtn" type="button"><svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 10V2M5 5l3-3 3 3M3 9v4.5h10V9" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>공유</button>
      <span class="seg" role="group" aria-label="면적 단위"><button data-u="m2" aria-pressed="${S.unit === 'm2'}">㎡</button><button data-u="py" aria-pressed="${S.unit === 'py'}">평</button></span></div>
    <div class="tabs" role="tablist">${tabs.map(([k, l]) => `<button data-t="${k}" aria-selected="${(S.tab || 'land') === k}">${l}</button>`).join('')}</div>
    <div class="body">${groupSection()}${body}${consultCard()}<p class="pfoot">리얼맵 · 운영 주식회사 드림인베스트 · <a href="/guide.html" target="_blank" rel="noopener">이용 안내</a> · <a href="/privacy.html" target="_blank" rel="noopener">개인정보처리방침</a></p></div>`;
    $('panel').scrollTop = keepScroll;
    D.querySelectorAll('[data-u]').forEach(b => b.onclick = () => { S.unit = b.dataset.u; render(); });
    D.querySelectorAll('[data-t]').forEach(b => b.onclick = () => goSec(b.dataset.t));
    $('shareBtn').onclick = () => shareParcel(p, name);
    if ($('rvBtn')) $('rvBtn').onclick = () => setView('rv');
    D.querySelectorAll('[data-dz]').forEach(b => b.onclick = () => goSec('dev'));
    D.querySelectorAll('[data-warn]').forEach(b => b.onclick = () => goSec('plan', 'warnSec'));
    if ($('favBtn')) $('favBtn').onclick = () => toggleFav(name);
    if ($('homeBtn')) $('homeBtn').onclick = () => toggleHome(name);
    if ($('safeBtn')) $('safeBtn').onclick = () => { S.safeOpen = true; goSec('trade', 'safe'); };
    $('locBtn').onclick = () => locGate(name);
    $('briefBtn').onclick = () => briefOpen(name);
    D.querySelectorAll('[data-gp]').forEach(b => b.onclick = () => pickPnu(b.dataset.gp));
    $('pnuCopy').onclick = () => { navigator.clipboard?.writeText(p.pnu).then(() => toast('PNU를 복사했습니다'), () => {}); };
    wireTab(D);
    const mf = D.querySelector('#moreF'); if (mf) mf.onclick = () => { S.floorsAll = true; render(); };
    watchLazy();
    if (S.anchor) applyAnchor(false);
  }
  // 바로가기: 해당 구간으로 스크롤 (아직 안 불러온 구간이면 먼저 불러오기 시작)
  function goSec(k, inner) {
    if ((k === 'trade' || k === 'unit') && !S.seen[k]) { S.seen[k] = true; render(); }
    S.tab = k;
    // 위쪽 정보가 늦게 도착해 높이가 바뀌어도 2.5초 동안은 고른 구간에 머물도록 고정
    S.anchor = { k, inner, until: Date.now() + 2500 };
    S.jumpUntil = Date.now() + 2600;
    requestAnimationFrame(() => applyAnchor(true));
  }
  function applyAnchor(smooth) {
    const A = S.anchor; if (!A || Date.now() > A.until) { S.anchor = null; return; }
    const P = $('panel'), tabsEl = P.querySelector('.tabs');
    const el = (A.inner && $(A.inner)) || $('sec-' + A.k); if (!el) return;
    // 위에 고정된 바로가기 줄 아래로 맞춤 (휴대폰 시트 손잡이까지 고려)
    const base = P.getBoundingClientRect().top + (tabsEl ? (parseFloat(getComputedStyle(tabsEl).top) || 0) + tabsEl.offsetHeight : 0);
    const top = P.scrollTop + el.getBoundingClientRect().top - base - 10;
    P.scrollTo({ top, behavior: smooth ? 'smooth' : 'auto' });
    P.querySelectorAll('.tabs [data-t]').forEach(b => b.setAttribute('aria-selected', b.dataset.t === A.k));
  }
  ['wheel', 'touchstart'].forEach(ev => $('panel').addEventListener(ev, () => { S.anchor = null; S.jumpUntil = 0; }, { passive: true }));
  // 화면에 가까워진 구간을 불러오기 시작
  let lazyObs = null;
  function watchLazy() {
    if (lazyObs) lazyObs.disconnect();
    // 위쪽(토지·건물)이 다 그려진 뒤에 판단해야, 화면이 짧을 때 무거운 구간까지 한꺼번에 불러오지 않습니다
    if (!S.d || !S.d.land || !S.d.bld) return;
    if (!('IntersectionObserver' in window)) { document.querySelectorAll('[data-lazy]').forEach(el => { S.seen[el.dataset.lazy] = true; }); return; }
    lazyObs = new IntersectionObserver(es => {
      const ks = es.filter(e => e.isIntersecting).map(e => e.target.dataset.lazy).filter(k => !S.seen[k]);
      if (ks.length) { ks.forEach(k => { S.seen[k] = true; }); render(); }
    }, { root: $('panel'), rootMargin: '250px 0px' });
    document.querySelectorAll('#detail [data-lazy]').forEach(el => lazyObs.observe(el));
  }
  // 스크롤하면 지금 보고 있는 구간의 바로가기에 불이 들어옵니다
  let secRaf = 0;
  $('panel').addEventListener('scroll', () => {
    if (secRaf || (S.jumpUntil && Date.now() < S.jumpUntil)) return;
    secRaf = requestAnimationFrame(() => {
      secRaf = 0;
      const P = $('panel'), tabsEl = P.querySelector('.tabs'); if (!tabsEl) return;
      const line = tabsEl.getBoundingClientRect().bottom + 24;
      let cur = 'land';
      P.querySelectorAll('.blk').forEach(b => { if (b.getBoundingClientRect().top <= line) cur = b.id.slice(4); });
      if (cur !== S.tab) { S.tab = cur; P.querySelectorAll('.tabs [data-t]').forEach(b => b.setAttribute('aria-selected', b.dataset.t === cur)); }
    });
  }, { passive: true });

  // 토지 탭
  function spark(list) {
    if (list.length < 2) return '';
    const W = 360, H = 120, L = 8, R = 8, T = 22, Bt = 22, v = list.map(x => x.price);
    const mn = Math.min(...v) * 0.96, mx = Math.max(...v) * 1.02;
    const X = i => L + i * (W - L - R) / (v.length - 1), Y = x => T + (1 - (x - mn) / (mx - mn || 1)) * (H - T - Bt);
    const pts = v.map((x, i) => `${X(i).toFixed(1)},${Y(x).toFixed(1)}`).join(' ');
    let s = `<svg class="spark" viewBox="0 0 ${W} ${H}" role="img" aria-label="개별공시지가 추이">`;
    [0, 1, 2].forEach(g => { const y = T + g * (H - T - Bt) / 2; s += `<line class="gr" x1="${L}" x2="${W - R}" y1="${y}" y2="${y}"/>`; });
    s += `<polygon class="ar" points="${X(0)},${H - Bt} ${pts} ${X(v.length - 1)},${H - Bt}"/><polyline class="ln" points="${pts}"/>`;
    list.forEach((x, i) => { s += `<text x="${X(i)}" y="${H - 6}" text-anchor="${i === 0 ? 'start' : i === v.length - 1 ? 'end' : 'middle'}">${x.year}</text>`; });
    const lx = X(v.length - 1), ly = Y(v[v.length - 1]), last = v[v.length - 1];
    s += `<circle class="pt" cx="${lx}" cy="${ly}" r="4"/><text class="lab" x="${lx - 8}" y="${ly - 9}" text-anchor="end">${S.unit === 'm2' ? n(last / 10000) + '만원/㎡' : n(last * PY / 10000) + '만원/평'}</text>`;
    return s + '</svg>';
  }
  function landTab() {
    const L = S.d.land;
    if (!L) return skel();
    if (L.error) return errBox('', L.error);
    const c = chr(), o = own(), pr = prices();
    const out = [];
    if (c) {
      const last = pr[pr.length - 1], prev = pr[pr.length - 2];
      const ch = last && prev ? (last.price / prev.price - 1) * 100 : null;
      const pp = last ? last.price : c.price;
      out.push(`<div class="hero">
        <div class="stat"><div class="l">토지면적</div><div class="v">${ar(c.area)[0]}</div><div class="s">${ar(c.area)[1]}</div></div>
        <div class="stat"><div class="l">공시지가 총액</div><div class="v">${pp && c.area ? wonW(pp * c.area) : '-'}</div><div class="s">${ch == null ? (last ? last.year + '년 기준' : '') : `전년 대비 ${ch >= 0 ? '+' : ''}${n(ch, 1)}%`}</div></div>
      </div>`);
      if (!isCollective()) out.push(roomSection(false));
      out.push(`<section><h2>토지 기본정보<span>토지특성 ${esc(c.year || '')}</span></h2><dl class="kv">
        <dt>지목</dt><dd>${val(c.jimok)}</dd>
        <dt>면적</dt><dd>${arI(c.area)}</dd>
        <dt>용도지역</dt><dd>${val(c.zone1)}${c.zone2 && c.zone2 !== '지정되지않음' ? `<small>${esc(c.zone2)}</small>` : ''}</dd>
        <dt>토지이용상황</dt><dd>${val(c.landUse)}</dd>
        <dt>지형높이</dt><dd>${val(c.height)}</dd>
        <dt>지형형상</dt><dd>${val(c.shape)}</dd>
        <dt>도로접면</dt><dd>${val(c.road)}</dd>
        ${L.move && L.move.ok && L.move.data[0] ? `<dt>토지이동사유</dt><dd>${val(L.move.data[0].why)}<small>${ymd(L.move.data[0].date)}</small></dd>` : ''}
      </dl></section>`);
    } else out.push(L.chr && !L.chr.ok ? errBox('토지특성', L.chr.message) : '<div class="empty">토지특성 정보가 없습니다.</div>');

    if (o) {
      const types = Object.entries(o.typeCounts || {}).map(([k, v]) => `${esc(k)} ${n(v)}`).join(' · ');
      out.push(`<section><h2>소유정보<span>토지소유정보 ${ymd(o.stdrYm)}</span></h2><dl class="kv">
        <dt>소유구분</dt><dd>${o.collective ? '구분소유 (집합건물)' : val(o.type)}${o.collective ? `<small>${types}</small>` : o.nation ? `<small>${esc(o.nation)}</small>` : ''}</dd>
        <dt>${o.collective ? '구분소유 호수' : '공유인수'}</dt><dd>${o.collective ? n(o.unitCount) + '개 호' : o.sharers > 1 ? n(o.sharers) + '인 공유' : '단독소유'}</dd>
        ${o.residence && !o.collective ? `<dt>거주지구분</dt><dd>${esc(o.residence)}</dd>` : ''}
        <dt>${o.collective ? '최근 소유권변동' : '소유권변동원인'}</dt><dd>${val(o.cause)}</dd>
        <dt>소유권변동일자</dt><dd>${ymd(o.date)}</dd>
      </dl><p class="note">소유자 성명·주소는 공개되지 않습니다. 정확한 권리관계는 등기사항전부증명서로 확인합니다.</p></section>`);
    } else if (L.own && !L.own.ok) out.push(errBox('소유', L.own.message));

    if (pr.length) {
      const rows = [...pr].reverse().map((r, i, a) => { const pv = a[i + 1]; const cg = pv ? (r.price / pv.price - 1) * 100 : null;
        return `<tr><td class="c">${r.year}.01.01</td><td class="n">${per(r.price)}</td><td class="n">${cg == null ? '-' : (cg >= 0 ? '+' : '') + n(cg, 1) + '%'}</td></tr>`; }).join('');
      out.push(`<section><h2>개별공시지가</h2>${spark(pr)}<div class="tbl"><table><thead><tr><th>기준일</th><th class="n">공시지가</th><th class="n">변동률</th></tr></thead><tbody>${rows}</tbody></table></div></section>`);
    } else if (L.prices && !L.prices.ok) out.push(errBox('공시지가', L.prices.message));
    const hp = housePrice();
    if (hp) out.push(`<section><h2>개별주택가격<span>단독·다가구 주택 공시가격</span></h2><dl class="kv">
      <dt>주택가격 (토지+건물)</dt><dd><b>${wonW(hp.price)}</b><small>${hp.year}.01.01 기준</small></dd>
      ${hp.bldArea ? `<dt>산정 건물면적</dt><dd>${arI(hp.bldArea)}</dd>` : ''}
    </dl><p class="note">전세보증보험 가입 가능 금액 등은 이 공시가격을 기준으로 판단합니다. 정확한 한도는 HUG·SGI 등 보증기관에서 확인하세요.</p></section>`);

    out.push(src(['브이월드 토지특성·토지소유정보·개별공시지가·개별주택가격']));
    return out.join('');
  }

  // 이용계획 탭
  const SEOUL = { '제1종전용주거지역': [50, 100], '제2종전용주거지역': [40, 120], '제1종일반주거지역': [60, 150], '제2종일반주거지역': [60, 200], '제3종일반주거지역': [50, 250], '준주거지역': [60, 400], '중심상업지역': [60, 1000], '일반상업지역': [60, 800], '근린상업지역': [60, 600], '유통상업지역': [60, 600], '전용공업지역': [60, 200], '일반공업지역': [60, 200], '준공업지역': [60, 400], '보전녹지지역': [20, 50], '생산녹지지역': [20, 50], '자연녹지지역': [20, 50] };
  // 국토계획법 시행령 제84·85조 용도지역별 최대치 (조례는 이 범위 안에서 정함)
  const LAWMAX = { '제1종전용주거지역': [50, 100], '제2종전용주거지역': [50, 150], '제1종일반주거지역': [60, 200], '제2종일반주거지역': [60, 250], '제3종일반주거지역': [50, 300], '준주거지역': [70, 500], '중심상업지역': [90, 1500], '일반상업지역': [80, 1300], '근린상업지역': [70, 900], '유통상업지역': [80, 1100], '전용공업지역': [70, 300], '일반공업지역': [70, 350], '준공업지역': [70, 400], '보전녹지지역': [20, 80], '생산녹지지역': [20, 100], '자연녹지지역': [20, 100] };
  function planTab() {
    const L = S.d.land;
    if (!L) return skel();
    if (L.error) return errBox('', L.error);
    const out = [warnSection()];
    if (L.use && L.use.ok) {
      const rows = L.use.data;
      const li = a => a.length ? a.map(x => `<li class="${/^UQA/.test(x.code) ? 'k' : ''}">${esc(x.name)}${x.rel && x.rel !== '포함' ? ` <em>(${esc(x.rel)})</em>` : ''}</li>`).join('') : '<li>해당 없음</li>';
      out.push(`<section><h2>토지이용계획<span>지역·지구등 지정여부</span></h2><div class="plan">
        <div class="g"><div class="t">「국토의 계획 및 이용에 관한 법률」에 따른 지역·지구등</div><ul>${li(rows.filter(r => r.law === 'k'))}</ul></div>
        <div class="g"><div class="t">다른 법령 등에 따른 지역·지구등</div><ul>${li(rows.filter(r => r.law === 'o'))}</ul></div>
      </div><p class="note">괄호 안 '저촉'은 일부가 걸쳐 있다는 뜻이고, '접함'은 경계에 붙어 있다는 뜻입니다.</p></section>`);
    } else out.push(errBox('토지이용계획', L.use && L.use.message));

    out.push(roomSection(true));
    out.push(`<p class="src">출처 · 브이월드 토지이용계획 · <a href="https://www.eum.go.kr/web/ar/lu/luLandDet.jsp?isNoScr=script&mode=search&pnu=${esc(S.sel.pnu)}" target="_blank" rel="noopener">토지이음에서 원문 보기</a></p>`);
    return out.join('');
  }

  // 추가로 지을 수 있는 규모 (서울시 도시계획조례 기준 추정)
  function roomCalc() {
    const c = chr();
    if (!c || !c.area || !c.zone1 || !String(S.sel.pnu).startsWith('11')) return null;
    const z = Object.keys(SEOUL).find(k => c.zone1.replace(/\s|\(.*\)/g, '').startsWith(k));
    if (!z) return null;
    const [bc, fa] = SEOUL[z];
    const ts = titles(), rc = recap();
    // 대장에 '용적률 산정 연면적'이 비어 있는 건물이 많아서: 용적률×대지면적 → 지상층 비율로 나눈 연면적 순으로 보충 (추정 표시)
    let est = false;
    const tUsed = t => {
      if (t.vlArea) return t.vlArea;
      if (t.vlRat && t.platArea) { est = true; return t.vlRat * t.platArea / 100; }
      if (t.totArea) { est = true; return t.ugrnd && t.grnd ? t.totArea * t.grnd / (t.grnd + t.ugrnd) : t.totArea; }
      return 0;
    };
    const used = rc && rc.vlArea ? rc.vlArea : ts.reduce((s, t) => s + tUsed(t), 0);
    // 여러 필지에 걸친 건물(합필·부속지번)은 건축물대장의 대지면적(묶인 필지 전체)을 기준으로 계산
    const bPlat = (rc && rc.platArea) || Math.max(0, ...ts.map(t => t.platArea || 0));
    const multi = atchList().length > 0 && bPlat > c.area * 1.02;
    const base = multi ? bPlat : c.area;
    const site = (rc && rc.platArea) || bPlat || c.area;
    const one = ts.length === 1 ? ts[0] : null;
    const nowRat = rc && rc.vlRat ? rc.vlRat : one && one.vlRat ? one.vlRat : used && site ? used / site * 100 : 0;
    const maxF = base * fa / 100, maxB = base * bc / 100;
    return { z, bc, fa, maxF, maxB, used, nowRat, est, multi, base, lots: atchList().length + 1, rest: Math.max(0, maxF - used), floors: Math.max(1, Math.floor(maxF / maxB)), empty: !ts.length, split: c.zone2 && c.zone2 !== '지정되지않음' };
  }
  const BUILDABLE = /^(대|공장용지|창고용지|주차장|주유소용지|잡종지|학교용지|종교용지|체육용지)$/;
  const FARM = /^(전|답|과수원|임야|목장용지)$/;
  function roomSection(full) {
    const c = chr();
    const B = S.d.bld;
    if (!B) return full ? skel() : '';
    // 지목으로 건축 가능 여부부터 거릅니다
    const jm = String(c && c.jimok || '').trim();
    const hasBld = titles().length > 0;
    if (jm && !hasBld && !BUILDABLE.test(jm)) {
      if (!full) return '';
      const why = FARM.test(jm)
        ? `지목이 '${esc(jm)}'인 땅은 농지전용·산지전용 같은 개발행위허가를 받은 뒤에야 건축할 수 있어, 건축 여유를 자동 계산하지 않습니다.`
        : `지목이 '${esc(jm)}'인 땅은 원칙적으로 건물을 지을 수 없어 건축 여유를 계산하지 않습니다.`;
      return `<section class="room"><h2>건축 여유<span>지목 확인</span></h2><p class="room-msg">${why}</p></section>`;
    }
    // 도시계획도로에 들어간 땅
    const L = S.d.land, uses = L && L.use && L.use.ok ? L.use.data : [];
    const road = uses.find(u => u.law === 'k' && /^\s*(도로|광로|대로|중로|소로)/.test(u.name || '') && !/접/.test(u.rel || ''));
    const roadIn = road && (!road.rel || road.rel === '포함');
    if (roadIn && !hasBld) {
      if (!full) return '';
      return `<section class="room"><h2>건축 여유<span>도시계획시설 확인</span></h2><p class="room-msg">이 땅은 도시계획도로(${esc(road.name)})에 포함되어 있어 건축이 제한됩니다.</p><p class="note">도로 계획이 폐지·변경되지 않는 한 신축이 어렵습니다. 토지이음에서 계획 내용을 확인해 주세요.</p></section>`;
    }
    if (B.error || (B.titles && !B.titles.ok)) return ''; // 건물 정보를 모르면 '빈 땅'으로 잘못 안내하지 않도록
    const R = roomCalc();
    if (!R) return full && c ? `<div class="empty">건폐율·용적률 상한은 지자체 도시계획조례에 따라 다릅니다. 현재는 서울 기준만 자동 계산합니다.</div>` : '';
    const py = m => `${n(toPy(m), 0)}평`;
    const pct = Math.min(100, R.nowRat / R.fa * 100);
    let head;
    if (R.empty) head = `<p class="room-msg">건물이 없는 땅입니다. 새로 지으면 지상 연면적 <b>약 ${py(R.maxF)}</b>까지 가능합니다.</p>`;
    else if (R.rest > R.maxF * 0.05) head = `<p class="room-msg">상한까지 <b>약 ${py(R.rest)}</b>을 더 지을 수 있는 땅입니다.</p>`;
    else if (R.nowRat > R.fa * 1.05) head = `<p class="room-msg">현재 용적률(${n(R.nowRat, 0)}%)이 조례 상한(${R.fa}%)보다 높게 지어진 건물입니다.</p>`;
    else head = `<p class="room-msg">이미 용적률 상한 가까이 지어진 땅입니다.</p>`;
    const law = LAWMAX[R.z];
    return `<section class="room"><h2>건축 여유<span>서울시 도시계획조례 기준 · 추정</span></h2>${head}
      ${R.empty ? '' : `<div class="meter-l"><span>현재 용적률 ${n(R.nowRat, 0)}%</span><span>상한 ${R.fa}%</span></div><div class="meter"><i style="width:${pct}%"></i></div>`}
      <dl class="kv">
        <dt>용도지역</dt><dd>${esc(R.z)}</dd>
        <dt>건폐율 / 용적률 상한</dt><dd>${R.bc}% / ${R.fa}%<small>서울시 조례 기준${law && law[1] !== R.fa ? ` · 법정 최대 ${law[1]}%` : ''}</small></dd>
        <dt>최대 지상 연면적</dt><dd>${arI(R.maxF)}</dd>
        ${R.empty ? '' : `<dt>현재 용적률 연면적</dt><dd>${arI(R.used)}${R.est ? '<small>대장 값이 비어 있어 연면적으로 추정</small>' : ''}</dd><dt>남은 연면적</dt><dd>${R.rest > 1 ? arI(R.rest) : '여유 없음'}</dd>`}
        ${full ? `<dt>최대 건축면적</dt><dd>${arI(R.maxB)}</dd><dt>단순 환산 층수</dt><dd>약 ${R.floors}층<small>최대 건축면적으로 꽉 채워 올릴 때</small></dd>` : ''}
      </dl>
      ${road && road.rel === '저촉' ? `<p class="note"><b>도시계획도로(${esc(road.name)})에 일부 저촉</b>되어 있어, 저촉 부분은 건축 면적에서 빠질 수 있습니다.</p>` : ''}
      ${R.multi ? `<p class="note">이 건물은 <b>${R.lots}개 필지</b>에 걸쳐 지어져 있어, 건축물대장의 대지면적(${ar(R.base, 2)[0]}) 전체를 기준으로 계산했습니다. 필지마다 용도지역이 다르면 실제 상한은 달라질 수 있습니다.</p>` : ''}
      ${R.split ? '<p class="note">이 땅은 용도지역이 둘 이상 걸쳐 있어 실제 상한은 면적 비율에 따라 달라집니다.</p>' : ''}
      ${law && law[1] !== R.fa ? `<p class="note">국토계획법상 ${esc(R.z)} 용적률은 최대 ${law[1]}%이지만, 서울시는 조례로 ${R.fa}%를 기본 상한으로 정하고 있습니다. 재건축·재개발 등 정비사업이나 지구단위계획으로 공공기여·임대주택 등을 하면 법정 최대치까지 완화받을 수 있습니다.${R.nowRat > R.fa * 1.05 ? ' 지금 건물이 조례 상한보다 높은 것은 조례가 생기기 전에 지어졌거나 이런 완화를 받은 경우입니다.' : ''}</p>` : ''}
      <p class="note">지구단위계획, 높이·일조 제한, 주차 기준에 따라 실제로 지을 수 있는 규모는 달라집니다.${full ? ' 신축이나 증축 검토 시 토지이음에서 행위제한을 꼭 확인해 주세요.' : ''}</p></section>`;
  }

  // 건물 탭
  function bldTab() {
    const B = S.d.bld;
    if (!B) return skel();
    if (B.error) return errBox('', B.error);
    if (B.titles && !B.titles.ok) return errBox('건축물대장', B.titles.message);
    const ts = titles();
    if (!ts.length) return `<div class="empty">이 필지에 등록된 건축물대장이 없습니다.${chr() && /대/.test(chr().jimok || '') ? " 나대지라면 위 '이용계획'에서 건축 가능 규모를 확인하실 수 있습니다." : ''}</div>${src(['건축HUB 건축물대장'])}`;
    const rc = recap();
    if (S.bldIdx >= ts.length) S.bldIdx = 0;
    const t = ts[S.bldIdx];
    const out = [];
    if (rc) out.push(`<section><h2>총괄표제부<span>${esc(rc.name || '')}</span></h2><dl class="kv">
      <dt>대지면적</dt><dd>${arI(rc.platArea)}</dd><dt>연면적</dt><dd>${arI(rc.totArea)}</dd>
      <dt>건폐율 / 용적률</dt><dd>${n(rc.bcRat, 2)}% / ${n(rc.vlRat, 2)}%</dd>
      <dt>주건축물 / 부속</dt><dd>${n(rc.mainCnt)}동 / ${n(rc.atchCnt)}동</dd>
      <dt>세대 / 가구 / 호</dt><dd>${n(rc.hhld)} / ${n(rc.fmly)} / ${n(rc.ho)}</dd>
      <dt>총 주차</dt><dd>${n(rc.pkTotal || ((rc.pkIn || 0) + (rc.pkOut || 0) + (rc.pkInMech || 0) + (rc.pkOutMech || 0)))}대</dd>
    </dl></section>`);
    if (ts.length > 1) {
      out.push(`<section><h2>동별 현황<span>${ts.length}개 동</span></h2><div class="tbl"><table><thead><tr><th>동</th><th>용도</th><th class="n">층수</th><th class="n">높이</th><th class="n">연면적</th></tr></thead><tbody>
      ${ts.map(x => { const nm = String(x.dong || x.name || '-'), m = nm.match(/^([^(（]+)[(（](.+)[)）]$/); return `<tr class="${x.mainAtch === '부속건축물' ? 'ex' : ''}"><td class="c dn">${m ? `${esc(m[1].trim())}<small>${esc(m[2])}</small>` : esc(nm)}</td><td class="u">${esc(x.use || '-')}</td><td class="n">${x.ugrnd ? 'B' + x.ugrnd + '/' : ''}${n(x.grnd)}F</td><td class="n">${x.height ? n(x.height, 1) + 'm' : '-'}</td><td class="n">${ar(x.totArea, 0)[0]}</td></tr>`; }).join('')}
      </tbody></table></div>
      <label class="pick" style="grid-template-columns:1fr"><span style="font-size:12px;color:var(--muted)">상세 볼 동</span><select id="bldSel">${ts.map((x, i) => `<option value="${i}" ${i === S.bldIdx ? 'selected' : ''}>${esc(x.dong || x.name || '건물 ' + (i + 1))} · ${esc(x.use || '')}</option>`).join('')}</select></label></section>`);
    }
    const [g1, g2] = ar(t.totArea);
    const age = t.useApr ? new Date().getFullYear() - Number(t.useApr.slice(0, 4)) : null;
    out.push(`<div class="hero">
      <div class="stat"><div class="l">연면적</div><div class="v">${g1}</div><div class="s">${g2}</div></div>
      <div class="stat"><div class="l">규모</div><div class="v">${t.ugrnd ? 'B' + t.ugrnd + ' / ' : ''}${n(t.grnd)}F</div><div class="s">${t.useApr ? `${esc(t.useApr.slice(0, 4))}년 사용승인 · ${age}년차` : '사용승인일 미상'}</div></div>
    </div>`);
    const pk = (t.pkIn || 0) + (t.pkOut || 0) + (t.pkInMech || 0) + (t.pkOutMech || 0);
    out.push(`<section><h2>건축물 개요<span>${esc(t.kind || '')}${t.dong ? ' · ' + esc(t.dong) : ''}</span></h2><dl class="kv">
      ${t.name ? `<dt>건물명</dt><dd>${esc(t.name)}</dd>` : ''}
      <dt>주용도</dt><dd>${val(t.use)}</dd>
      <dt>기타용도</dt><dd>${val(t.etcUse)}</dd>
      <dt>주구조</dt><dd>${val(t.strct)}${t.etcStrct && t.etcStrct !== t.strct ? `<small>${esc(t.etcStrct)}</small>` : ''}</dd>
      <dt>지붕</dt><dd>${val(t.roof)}${t.etcRoof && t.etcRoof !== t.roof ? `<small>${esc(t.etcRoof)}</small>` : ''}</dd>
      <dt>높이</dt><dd>${t.height ? n(t.height, 2) + 'm' : '-'}</dd>
      <dt>층수</dt><dd>지하 ${n(t.ugrnd || 0)}층 / 지상 ${n(t.grnd || 0)}층</dd>
      <dt>대지면적</dt><dd>${arI(t.platArea || (chr() && chr().area))}</dd>
      <dt>건축면적</dt><dd>${arI(t.archArea)}</dd>
      <dt>연면적</dt><dd>${arI(t.totArea)}</dd>
      <dt>용적률 산정용 연면적</dt><dd>${arI(t.vlArea)}</dd>
      <dt>건폐율</dt><dd>${t.bcRat != null ? n(t.bcRat, 2) + '%' : '-'}</dd>
      <dt>용적률</dt><dd>${t.vlRat != null ? n(t.vlRat, 2) + '%' : '-'}</dd>
      <dt>세대 / 가구 / 호</dt><dd>${n(t.hhld || 0)}세대 / ${n(t.fmly || 0)}가구 / ${n(t.ho || 0)}호</dd>
    </dl></section>`);
    out.push(`<section><h2>설비 · 주차</h2><dl class="kv">
      <dt>승강기</dt><dd>승용 ${n(t.liftP || 0)}대 · 비상용 ${n(t.liftE || 0)}대</dd>
      <dt>주차</dt><dd>총 ${n(pk)}대<small>옥내자주식 ${n(t.pkIn || 0)} · 옥외자주식 ${n(t.pkOut || 0)} · 기계식 ${n((t.pkInMech || 0) + (t.pkOutMech || 0))}</small></dd>
      <dt>에너지효율등급</dt><dd>${val(t.energy)}</dd>
      <dt>친환경 / 지능형 인증</dt><dd>${val(t.green)} / ${val(t.smart)}</dd>
      <dt>내진설계 적용</dt><dd>${t.seismic === '1' || t.seismic === 'Y' ? '적용' : t.seismic === '0' || t.seismic === 'N' ? '미적용' : val(t.seismic)}</dd>
      <dt>내진능력</dt><dd>${val(t.seismicCap)}</dd>
      ${t.atchCnt ? `<dt>부속건축물</dt><dd>${n(t.atchCnt)}동 · ${ar(t.atchArea)[0]}</dd>` : ''}
    </dl></section>`);
    out.push(`<section><h2>인허가 일자</h2><dl class="kv">
      <dt>허가일</dt><dd>${val(t.pms)}</dd><dt>착공일</dt><dd>${val(t.stcns)}</dd><dt>사용승인일</dt><dd>${val(t.useApr)}</dd>
    </dl></section>`);
    const fl = (B.floors && B.floors.ok ? B.floors.data : []).filter(f => (t.pk && f.pk) ? f.pk === t.pk : (!t.dong || f.dong === t.dong));
    if (fl.length) {
      const order = f => (f.gb && f.gb.includes('지하') ? -1 : f.gb && f.gb.includes('옥탑') ? 1000 : 0) * 1 + (f.gb && f.gb.includes('지하') ? -(f.no || 0) : (f.no || 0));
      const rows = [...fl].sort((a, b) => order(b) - order(a));
      out.push(`<section><h2>층별 현황<span>층별개요 ${rows.length}건</span></h2><div class="tbl"><table><thead><tr><th>층</th><th>용도</th><th class="n">면적</th></tr></thead><tbody>
      ${rows.slice(0, S.floorsAll ? 9999 : 12).map(f => `<tr class="${f.excl ? 'ex' : ''}"><td class="c">${esc(f.noNm || ((f.gb || '') + (f.no || '')))}</td><td>${esc(f.use || '')}${f.etcUse && f.etcUse !== f.use ? `<small>${esc(f.etcUse)}</small>` : ''}${f.excl ? '<small>면적 제외</small>' : ''}</td><td class="n">${ar(f.area)[0]}</td></tr>`).join('')}
      </tbody></table></div>${rows.length > 12 && !S.floorsAll ? `<button class="more" id="moreF">층별 현황 ${n(rows.length - 12)}건 더 보기</button>` : ''}</section>`);
    } else if (B.floors && B.floors.loading) out.push(`<section><h2>층별 현황<span>불러오는 중</span></h2>${skel()}</section>`);
    else if (B.floors && !B.floors.ok) out.push(errBox('층별 현황', B.floors.message));
    out.push(src(['건축HUB 건축물대장 표제부·총괄표제부·층별개요']));
    return out.join('');
  }

  // 입점 업종 (상가정보)
  function storeSection() {
    if (/^\s*(아파트\s*)+$/.test(uses()) || (/아파트/.test(uses()) && !/근린|판매|업무/.test(uses()))) return '';
    const D = S.d.stores;
    if (!D) {
      const tok = S.tok; S.d.stores = { loading: true };
      api(`/api/stores?pnu=${S.sel.pnu}`).then(j => { if (tok === S.tok) { S.d.stores = j; render(); } })
        .catch(e => { if (tok === S.tok) { S.d.stores = { error: e.message }; render(); } });
      return `<section><h2>입점 업종</h2>${skel()}</section>`;
    }
    if (D.loading) return `<section><h2>입점 업종</h2>${skel()}</section>`;
    if (D.error) { console.warn('[리얼맵] 상가정보', D.error); return ''; }
    if (!D.stores.length) return `<section><h2>입점 업종</h2><div class="empty">등록된 상가 정보가 없습니다.</div></section>`;
    const cnt = {}; D.stores.forEach(x => { cnt[x.l || '기타'] = (cnt[x.l || '기타'] || 0) + 1; });
    const fl = f => { const m = String(f || '').match(/-?\d+/); if (!m) return 0; return /지하|B/i.test(f) ? -Number(m[0].replace('-', '')) : Number(m[0]); };
    const rows = [...D.stores].sort((a, b) => fl(a.floor) - fl(b.floor));
    return `<section><h2>입점 업종<span>${D.stores.length}곳</span></h2>
      <div class="chips" style="margin:0 0 8px">${Object.entries(cnt).sort((a, b) => b[1] - a[1]).map(([k, v]) => `<span class="chip">${esc(k)} ${v}</span>`).join('')}</div>
      ${(() => {
        const tr = x => `<tr><td class="c">${x.floor ? esc(/^\d+$/.test(x.floor) ? x.floor + '층' : x.floor) : '-'}</td><td>${esc(x.name)}${x.ho ? `<small>${esc(x.ho)}호</small>` : ''}</td><td>${esc(x.s || x.m)}<small>${esc(x.m)}</small></td></tr>`;
        const head = '<div class="tbl"><table><thead><tr><th>층</th><th>상호</th><th>업종</th></tr></thead><tbody>';
        // 비회원은 앞 2곳만 보여 주고 나머지는 흐리게
        if (S.me.member || !S.me.ready || rows.length <= 2) return head + rows.map(tr).join('') + '</tbody></table></div>';
        return head + rows.slice(0, 2).map(tr).join('') + '</tbody></table></div>'
          + `<div class="klock"><div class="kblur" aria-hidden="true"><div class="tbl"><table><tbody>${rows.slice(2, 8).map(tr).join('')}</tbody></table></div></div>`
          + `<div class="kcta"><b>나머지 ${rows.length - 2}곳의 상호·업종·층</b><span>회원이면 무료로 모두 보실 수 있습니다</span><button type="button" class="kbtn" id="storeLogin">카카오로 3초 가입하고 보기</button></div></div>`;
      })()}
      <p class="note">소상공인시장진흥공단 상가정보 기준이며, 분기마다 갱신되어 실제와 다를 수 있습니다.</p></section>`;
  }

  // 동·호수 탭
  // 큰 단지: 동 목록은 표제부(이미 받아 둔 건물 정보)에서 바로 만들고, 호 목록은 고른 동만 받습니다
  function titleDongs() {
    const nat = (a, b) => String(a).localeCompare(String(b), 'ko', { numeric: true });
    return [...new Set(titles().map(t => String(t.dong || '').trim()).filter(Boolean))].sort(nat);
  }
  function unitTab() {
    const TD = titleDongs();
    if (TD.length >= 2 && !(S.d.units && S.d.units.units)) {
      if (S.uDong == null || !TD.includes(S.uDong)) S.uDong = TD.find(d => /\d/.test(d)) || TD[0];
      S.d.udong = S.d.udong || {};
      const L = S.d.udong[S.uDong];
      if (!L) loadDong(S.uDong);
      if (L && !L.loading && !L.error && !L.units.length && TD.every(d => S.d.udong[d] && !S.d.udong[d].loading)) { loadUnits(); return skel(); }
      const pickDong = `<label>동<select id="uDong">${TD.map(d => `<option ${d === S.uDong ? 'selected' : ''}>${esc(d)}</option>`).join('')}</select></label>`;
      if (!L || L.loading) return unitBody(null, TD, `${esc(S.uDong)}의 호 목록을 불러오는 중입니다.`);
      if (L.error) return `<div class="pick">${pickDong}</div>` + errBox('', L.error);
      if (!L.units.length) return `<div class="pick">${pickDong}</div><div class="empty">${esc(S.uDong)}에는 호별 정보가 없습니다 (상가·관리동 등). 다른 동을 골라 주세요.</div>`;
      return unitBody(L.units, TD, `${esc(S.uDong)} · ${n(L.units.length)}개 호${recap() && recap().hhld ? ` (단지 전체 ${n(recap().hhld)}세대)` : ''}`);
    }
    const U = S.d.units;
    if (!U) { loadUnits(); return skel(); }
    if (U.loading) return skel();
    if (U.error) return errBox('', U.error);
    if (!U.units.length) return collTitle()
      ? '<div class="empty">이 건물은 집합건물로 등록되어 있지만 전유부(호별) 정보가 전산 대장에 없습니다. 오래된 건물은 호별 대장이 빠져 있는 경우가 있어, 세움터나 정부24 열람으로 확인해 주세요.</div>'
      : '<div class="empty">이 지번에는 호별 정보가 없습니다. 땅이 여러 호로 나뉘어 소유되어 있다면, 집합건물이 옆의 다른 지번(대표지번)에 등록되어 있을 수 있습니다. 주변 필지를 눌러 확인해 주세요.</div>';
    const dongs = [...new Set(U.units.map(u => (u.dong = String(u.dong || '').trim())))];
    if (S.uDong == null || !dongs.includes(S.uDong)) S.uDong = dongs[0];
    return unitBody(U.units, dongs, `이 건물에는 ${n(U.units.length)}개 호가 등록되어 있습니다.`);
  }
  function unitBody(units, dongs, noteTxt) {
    const hos = units ? units.filter(u => String(u.dong || '').trim() === S.uDong) : [];
    if (units && hos.length && (!S.uHo || (!S.uHoManual && !hos.find(h => h.ho === S.uHo)))) { S.uHo = hos[Math.min(hos.length - 1, Math.floor(hos.length / 3))].ho; loadUnit(); }
    const extra = S.uHo && !hos.find(h => h.ho === S.uHo) ? `<option selected>${esc(S.uHo)}</option>` : '';
    const out = [`<div class="pick">
      <label>동<select id="uDong">${dongs.map(d => `<option ${d === S.uDong ? 'selected' : ''}>${esc(d || '단일동')}</option>`).join('')}</select></label>
      ${units ? `<label>호수<select id="uHo">${extra}${hos.map(h => `<option ${h.ho === S.uHo ? 'selected' : ''}>${esc(h.ho)}</option>`).join('')}</select></label>` : `<label>호수<select disabled><option>${S.uHo ? esc(S.uHo) : '불러오는 중…'}</option></select></label>`}
    </div>
    <p class="note">${!units ? '<span class="spin" style="display:inline-block;vertical-align:-2px;margin-right:6px"></span>' : ''}${noteTxt}</p>`];
    if (!S.uHo) { out.push(skel()); return out.join(''); }
    const key = S.uDong + '|' + S.uHo, X = S.d.unit && S.d.unit[key];
    if (!X || X.loading) out.push(skel());
    else if (X.error) out.push(errBox('', X.error));
    else {
      const rows = X.area && X.area.ok ? X.area.data : [];
      const exRows = rows.filter(r => /전유/.test(r.gb || '')), coRows = rows.filter(r => /공용/.test(r.gb || ''));
      const ex = exRows.reduce((s, r) => s + (r.area || 0), 0), co = coRows.reduce((s, r) => s + (r.area || 0), 0);
      // 주차장·관리동 같은 기타공용을 뺀 나머지를 주거공용으로 추정
      const OTHER = /주차|관리|경비|기계|전기|부대|복리|주민|노인|경로|어린이|보육|커뮤니티|근린|상가|창고|대피|저수|발전|펌프|정화/;
      const rcoRows = coRows.filter(r => !OTHER.test(`${r.use || ''} ${r.etcUse || ''}`));
      const rco = rcoRows.reduce((s, r) => s + (r.area || 0), 0);
      const pr = X.price && X.price.ok ? X.price.data : null;
      if (!rows.length && X.area && X.area.ok) out.push('<div class="empty">이 호의 전유·공용면적이 건축물대장에 없습니다. 다른 호를 선택해 보세요.</div>');
      else out.push(`<div class="unitcard">
        <div class="top"><div><div class="l">${esc(S.uDong ? S.uDong + ' ' : '')}${esc(S.uHo)} · 전용면적</div><div class="v">${ar(ex)[0]}</div><div class="l">${ar(ex)[1]}</div></div>
          <div class="r"><div class="l">공동주택가격${pr ? ' (' + pr.year + '.01.01)' : ''}</div><div class="v" style="font-size:18px">${pr && pr.price ? wonW(pr.price) : '-'}</div></div></div>
        <dl class="kv">
          <dt>전유면적</dt><dd>${arI(ex)}${exRows[0] ? `<small>${esc(exRows[0].use || '')}${exRows[0].flr ? ' · ' + esc(exRows[0].flr) : ''}</small>` : ''}</dd>
          <dt>주거공용 (추정)</dt><dd>${arI(rco)}<small>계단·복도·벽체 등</small></dd>
          <dt>공급면적 (추정)</dt><dd>${arI(ex + rco)}</dd>
          ${ex + rco ? `<dt>평형</dt><dd>${n(Math.round(toPy(ex + rco)))}평형</dd>` : ''}
          <dt>공용면적 합계</dt><dd>${arI(co)}<small>주차장·관리동 등 기타공용 포함</small></dd>
          <dt>계약면적 (전유+공용)</dt><dd>${arI(ex + co)}</dd>
          ${exRows[0] && exRows[0].strct ? `<dt>구조</dt><dd>${esc(exRows[0].strct)}</dd>` : ''}
        </dl></div>`);
      if (coRows.length) out.push(`<section><h2>공용면적 내역<span>전유공용면적</span></h2><div class="tbl"><table><thead><tr><th>구분</th><th>용도</th><th class="n">면적</th></tr></thead><tbody>
        ${rows.map(r => `<tr><td class="c">${esc(r.gb || '')}</td><td>${esc(r.use || '')}${r.etcUse && r.etcUse !== r.use ? `<small>${esc(r.etcUse)}</small>` : ''}</td><td class="n">${ar(r.area)[0]}</td></tr>`).join('')}
        </tbody></table></div></section>`);
      if (X.area && !X.area.ok) out.push(errBox('면적', X.area.message));
      out.push('<p class="note">건축물대장 공용면적에는 주거공용(계단·복도)과 기타공용(주차장·관리동 등)이 함께 들어 있어, 분양 광고의 공급면적과 다를 수 있습니다.</p>');
    }
    out.push(src(['건축HUB 전유부·전유공용면적', '브이월드 공동주택가격']));
    return out.join('');
  }
  async function loadUnits() {
    const tok = S.tok; S.d.units = { loading: true };
    try { const j = await api(`/api/units?pnu=${S.sel.pnu}`); if (tok === S.tok) { S.d.units = j; render(); } }
    catch (e) { if (tok === S.tok) { S.d.units = { error: e.message }; render(); } }
  }
  async function loadDong(d) {
    const tok = S.tok; S.d.udong[d] = { loading: true };
    try { const j = await api(`/api/units?pnu=${S.sel.pnu}&dong=${encodeURIComponent(d)}`); if (tok === S.tok) { S.d.udong[d] = j; render(); } }
    catch (e) { if (tok === S.tok) { S.d.udong[d] = { error: e.message }; render(); } }
  }
  async function loadUnit() {
    const tok = S.tok, key = S.uDong + '|' + S.uHo;
    S.d.unit = S.d.unit || {};
    if (S.d.unit[key]) return;
    S.d.unit[key] = { loading: true };
    try { const j = await api(`/api/units?pnu=${S.sel.pnu}&dong=${encodeURIComponent(S.uDong || '')}&ho=${encodeURIComponent(S.uHo)}`); if (tok === S.tok) { S.d.unit[key] = j; render(); } }
    catch (e) { if (tok === S.tok) { S.d.unit[key] = { error: e.message }; render(); } }
  }

  // 실거래 탭
  function tradeTab() {
    if (!S.d.bld) return skel();
    const kinds = tradeKinds();
    const k = kinds.join(',') + '|' + S.months;
    const T = S.d.trades;
    if (!T || T.key !== k) { loadTrades(kinds, k); return skel(); }
    if (T.loading) return skel() + '<p class="note">국토교통부 자료를 월별로 모으고 있습니다. 기간이 길면 조금 걸립니다.</p>';
    if (T.error) return errBox('', T.error);
    const sale = T.rows.filter(r => !/Rent$/.test(r.kind)), rent = T.rows.filter(r => /Rent$/.test(r.kind));
    const hasRent = T.kinds.some(x => !x.sale);
    if (!hasRent) S.tradeMode = 'sale';
    const list = S.tradeMode === 'sale' ? sale : rent;
    const segM = hasRent ? `<span class="seg" role="group" aria-label="거래 구분"><button data-m="sale" aria-pressed="${S.tradeMode === 'sale'}">매매 ${sale.length}</button><button data-m="rent" aria-pressed="${S.tradeMode === 'rent'}">전월세 ${rent.length}</button></span>` : '';
    const lockI = '<svg width="10" height="10" viewBox="0 0 12 12" aria-hidden="true" style="margin-left:3px;vertical-align:-1px"><rect x="2" y="5.5" width="8" height="5.5" rx="1" fill="currentColor"/><path d="M4 5.5V4a2 2 0 0 1 4 0v1.5" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>';
    const segP = `<span class="seg" role="group" aria-label="기간">${[12, 36, 60].map(m => `<button data-mo="${m}" aria-pressed="${S.months === m}">${m / 12}년${m > 12 && S.me.ready && !S.me.member ? lockI : ''}</button>`).join('')}</span>`;
    const items = list.slice(0, S.showAll ? 500 : 40).map(r => S.tradeMode === 'sale' ? saleRow(r) : rentRow(r)).join('');
    const safe = safeSection(T);
    const out = [safe || jeonseCard(T), `<div class="ctl">${segM}${segP}</div>`];
    out.push(trendChart(list, S.tradeMode));
    if (T.partial) out.push(`<p class="note loadmore"><span class="spin"></span>최근 ${T.partial.done / 12}년치를 먼저 보여 드리고, 나머지 ${(T.partial.total - T.partial.done) / 12}년치를 이어서 불러오는 중입니다.</p>`);
    out.push(list.length ? `<ul class="trades">${items}</ul>${list.length > 40 && !S.showAll ? `<button class="more" id="moreT">${n(list.length - 40)}건 더 보기</button>` : ''}` : `<div class="empty">최근 ${S.months / 12}년 동안 이 필지에서 신고된 ${S.tradeMode === 'sale' ? '매매' : '전월세'} 거래가 없습니다.</div>`);
    if (T.errors && T.errors.length) { console.warn('[리얼맵] 실거래', T.errors); out.push(`<div class="err soft"><span>일부 기간의 거래 자료를 불러오지 못해 빠진 거래가 있을 수 있습니다.</span><button type="button" data-retry>다시 불러오기</button></div>`); }
    out.push(`<p class="note">조회 범위: ${T.kinds.map(x => esc(x.label)).join(', ')}. 단독·다가구, 상업업무용, 토지 거래는 지번 일부가 가려져 공개되므로 면적이 일치하는 거래를 '추정'으로 표시합니다. 취소선은 계약 해제 건입니다.</p>`);
    out.push(src(['국토교통부 실거래가 공개시스템']));
    return out.join('');
  }
  // 전세가율: 같은 면적대의 매매가 중간값 대비 전세 보증금 중간값
  function jeonseRatio(rows) {
    const med = a => { a = [...a].sort((x, y) => x - y); const m = a.length >> 1; return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; };
    const d = new Date(Date.now() + 9 * 3600e3); d.setUTCFullYear(d.getUTCFullYear() - 1);
    const cut1 = `${d.getUTCFullYear()}.${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    const ok = r => ['apt', 'rh', 'offi', 'aptRent', 'rhRent', 'offiRent'].includes(r.kind) && r.ex && !r.cancel;
    const pickBest = cut => {
      const g = new Map();
      for (const r of rows) {
        if (!ok(r) || (cut && r.date < cut)) continue;
        const k = Math.round(r.ex);
        let e = g.get(k); if (!e) g.set(k, e = { ex: k, s: [], j: [] });
        if (/Rent$/.test(r.kind)) { if (!r.rent && r.deposit) e.j.push(r.deposit); } else if (r.price) e.s.push(r.price);
      }
      return [...g.values()].filter(e => e.s.length && e.j.length).sort((a, b) => (b.s.length + b.j.length) - (a.s.length + a.j.length))[0] || null;
    };
    let best = pickBest(cut1), recent = true;
    if (!best) { best = pickBest(null); recent = false; }
    if (!best) return null;
    const s = med(best.s), j = med(best.j);
    return { ex: best.ex, s, j, ns: best.s.length, nj: best.j.length, r: j / s * 100, recent };
  }
  function jeonseCard(T) {
    if (!T.kinds.some(x => !x.sale)) return '';
    const R = jeonseRatio(T.rows);
    if (!R) return '';
    const lv = R.r >= 80 ? ['높음', 'hi', '매매가와 전세가 차이가 작아 집값이 조금만 내려도 보증금 회수가 어려울 수 있습니다.']
      : R.r >= 70 ? ['주의', 'mid', '전세가율이 다소 높은 편입니다. 선순위 근저당과 보증금 규모를 꼼꼼히 확인하세요.']
      : ['보통', 'lo', '매매가 대비 전세가 비율이 일반적인 수준입니다.'];
    return `<section class="jr ${lv[1]}"><h2>전세가율<span>전용 ${R.ex}㎡ 기준 · ${R.recent ? '최근 1년' : `최근 ${S.months / 12}년`}</span></h2>
      <div class="jr-top"><b>${n(R.r, 0)}%</b><span class="jr-lv">${lv[0]}</span></div>
      <p class="jr-msg">${lv[2]}</p>
      <dl class="kv"><dt>매매 중간값</dt><dd>${won(R.s)}<small>${R.ns}건</small></dd><dt>전세 중간값</dt><dd>${won(R.j)}<small>${R.nj}건</small></dd></dl>
      <p class="note">실거래 신고가 기준 추정치입니다. 전세 계약 전에는 등기사항전부증명서로 근저당·압류 여부를, 다가구라면 선순위 임차보증금도 꼭 확인하세요.</p></section>`;
  }
  // 평형별 가격 추이 (월별 중간값)
  function trendChart(list, mode) {
    const kinds = mode === 'sale' ? ['apt', 'rh', 'offi'] : ['aptRent', 'rhRent', 'offiRent'];
    const rows = list.filter(r => kinds.includes(r.kind) && r.ex && !r.cancel && (mode === 'sale' ? r.price : (!r.rent && r.deposit)));
    if (rows.length < 3) return '';
    const med = a => { a = [...a].sort((x, y) => x - y); const m = a.length >> 1; return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; };
    const groups = new Map();
    for (const r of rows) { const k = Math.round(r.ex); (groups.get(k) || groups.set(k, []).get(k)).push(r); }
    const top = [...groups.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 3).filter(g => g[1].length >= 2);
    if (!top.length) return '';
    const ym = r => r.date.slice(0, 7);
    const months = [...new Set(rows.map(ym))].sort();
    const first = months[0], last = months[months.length - 1];
    const toIdx = m => (Number(m.slice(0, 4)) - Number(first.slice(0, 4))) * 12 + Number(m.slice(5, 7)) - Number(first.slice(5, 7));
    const span = Math.max(1, toIdx(last));
    const series = top.map(([ex, rs]) => {
      const by = new Map(); rs.forEach(r => (by.get(ym(r)) || by.set(ym(r), []).get(ym(r))).push(mode === 'sale' ? r.price : r.deposit));
      return { ex, n: rs.length, pts: [...by.entries()].sort().map(([m, v]) => ({ i: toIdx(m), v: med(v), m })) };
    });
    const vals = series.flatMap(s => s.pts.map(p => p.v));
    const mn = Math.min(...vals) * 0.95, mx = Math.max(...vals) * 1.03;
    const W = 360, H = 170, L = 44, R = 10, T = 12, B = 24;
    const X = i => L + i / span * (W - L - R), Y = v => T + (1 - (v - mn) / (mx - mn || 1)) * (H - T - B);
    const COL = ['#E4572E', '#0B6E69', '#6741B8'];
    let svg = `<svg class="trend" viewBox="0 0 ${W} ${H}" role="img" aria-label="평형별 가격 추이">`;
    for (let g = 0; g <= 3; g++) { const v = mn + (mx - mn) * g / 3, y = Y(v); svg += `<line class="gr" x1="${L}" x2="${W - R}" y1="${y}" y2="${y}"/><text class="ax" x="${L - 6}" y="${y + 4}" text-anchor="end">${eokS(v)}</text>`; }
    svg += `<text class="ax" x="${L}" y="${H - 6}">${first.replace('.', '.')}</text><text class="ax" x="${W - R}" y="${H - 6}" text-anchor="end">${last}</text>`;
    series.forEach((s, k) => {
      const c = COL[k];
      if (s.pts.length > 1) svg += `<polyline fill="none" stroke="${c}" stroke-width="2" stroke-linejoin="round" points="${s.pts.map(p => `${X(p.i).toFixed(1)},${Y(p.v).toFixed(1)}`).join(' ')}"/>`;
      s.pts.forEach(p => { svg += `<circle cx="${X(p.i).toFixed(1)}" cy="${Y(p.v).toFixed(1)}" r="3" fill="${c}"><title>${p.m} · 전용 ${s.ex}㎡ · ${won(p.v)}</title></circle>`; });
    });
    svg += '</svg>';
    const legend = series.map((s, k) => { const lp = s.pts[s.pts.length - 1]; return `<span><i style="background:${COL[k]}"></i>전용 ${s.ex}㎡<small>(${s.ex ? Math.round(s.ex / PY) : ''}평) 최근 ${eokS(lp.v)}</small></span>`; }).join('');
    return `<section><h2>${mode === 'sale' ? '매매가' : '전세가'} 추이<span>평형별 월 중간값</span></h2>${svg}<div class="tlegend">${legend}</div></section>`;
  }
  const eokS = man => man >= 10000 ? `${String(Math.round(man / 1000) / 10)}억` : `${n(Math.round(man))}만`;
  function badge(r) {
    let s = '';
    if (r.via) s += `<span class="mini">${esc(r.via)}</span>`;
    if (r.cancel) s += '<span class="mini w">계약해제</span>';
    if (r.approx) s += '<span class="mini">추정</span>';
    if (r.share && r.share !== '-') s += `<span class="mini">${esc(r.share)}</span>`;
    return s;
  }
  function saleRow(r) {
    let what, sub, unitP = '';
    if (['apt', 'rh', 'offi'].includes(r.kind)) {
      what = `${r.aptDong ? esc(r.aptDong) + ' ' : ''}${r.floor ? esc(r.floor) + '층' : ''}`;
      sub = `전용 ${ar(r.ex)[0]}${r.landAr ? ' · 대지권 ' + ar(r.landAr)[0] : ''}${r.name ? ' · ' + esc(r.name) : ''}`;
      if (r.ex && r.price) unitP = `전용 ${S.unit === 'm2' ? '㎡' : '평'}당 ${n(Math.round(r.price / (S.unit === 'm2' ? r.ex : toPy(r.ex))))}만원`;
      if (r.seller || r.buyer) sub += `<br>매도 ${esc(r.seller || '-')} · 매수 ${esc(r.buyer || '-')}`;
    } else if (r.kind === 'sh') {
      what = esc(r.houseType || '단독·다가구');
      sub = `대지 ${ar(r.plottage)[0]} · 연면적 ${ar(r.gfa)[0]}${r.buildYear ? ' · ' + esc(r.buildYear) + '년' : ''}`;
      if (r.plottage && r.price) unitP = `대지 ${S.unit === 'm2' ? '㎡' : '평'}당 ${n(Math.round(r.price / (S.unit === 'm2' ? r.plottage : toPy(r.plottage))))}만원`;
    } else if (r.kind === 'nrg') {
      what = `${esc(r.use || '상업업무용')}${r.btype ? ` <span class="mini">${esc(r.btype)}</span>` : ''}`;
      sub = `${r.floor ? esc(r.floor) + '층 · ' : ''}건물 ${ar(r.bldAr)[0]}${r.plottage ? ' · 대지 ' + ar(r.plottage)[0] : ''}${r.buildYear ? ' · ' + esc(r.buildYear) + '년' : ''}`;
      if (r.seller || r.buyer) sub += `<br>매도 ${esc(r.seller || '-')} · 매수 ${esc(r.buyer || '-')}`;
      const base = r.plottage || r.bldAr; if (base && r.price) unitP = `${r.plottage ? '대지' : '건물'} ${S.unit === 'm2' ? '㎡' : '평'}당 ${n(Math.round(r.price / (S.unit === 'm2' ? base : toPy(base))))}만원`;
    } else {
      what = `토지 ${esc(r.jimok || '')}`;
      sub = `거래면적 ${ar(r.dealAr)[0]}${r.zone ? ' · ' + esc(r.zone) : ''}`;
      if (r.dealAr && r.price) unitP = `${S.unit === 'm2' ? '㎡' : '평'}당 ${n(Math.round(r.price / (S.unit === 'm2' ? r.dealAr : toPy(r.dealAr))))}만원`;
    }
    return `<li class="${r.cancel ? 'x' : ''}"><span class="d">${esc(r.date)}</span><span class="w">${what}${badge(r)}<br><span class="s">${sub}</span></span><span class="p">${won(r.price)}<small>${unitP}</small></span></li>`;
  }
  function rentRow(r) {
    const what = `${r.aptDong ? esc(r.aptDong) + ' ' : ''}${r.floor ? esc(r.floor) + '층' : esc(r.houseType || '')}`;
    let sub = r.ex ? `전용 ${ar(r.ex)[0]}` : r.gfa ? `연면적 ${ar(r.gfa)[0]}` : '';
    if (r.contract) sub += ` · ${esc(r.contract)}${r.renew === '사용' ? '(갱신요구권)' : ''}`;
    if (r.prevDeposit) sub += ` · 종전 ${won(r.prevDeposit)}${r.prevRent ? '/' + n(r.prevRent) : ''}`;
    if (r.term) sub += ` · ${esc(r.term)}`;
    return `<li><span class="d">${esc(r.date)}</span><span class="w">${what || '-'}<span class="mini">${r.rent ? '월세' : '전세'}</span>${badge(r)}<br><span class="s">${sub}</span></span><span class="p">${won(r.deposit)}<small>${r.rent ? '월 ' + n(r.rent) + '만원' : '보증금'}</small></span></li>`;
  }
  async function loadTrades(kinds, key) {
    const tok = S.tok; S.d.trades = { key, loading: true }; S.showAll = false;
    const c = chr(), rc = recap(), m = mainT();
    const name = (rc && rc.name) || (m && m.name) || '';
    const q = new URLSearchParams({ pnu: S.sel.pnu, kinds: kinds.join(','), months: S.months, umd: S.sel.dongName || '', area: c && c.area ? c.area : '', name });
    // 최근 1년을 먼저 보여 주고, 3·5년은 1년씩 이어 붙입니다
    const total = S.months, step = 12;
    try {
      q.set('months', Math.min(step, total));
      const j = await api('/api/trades?' + q);
      if (tok !== S.tok || S.d.trades.key !== key) return;
      S.d.trades = { key, ...j, errors: [...(j.errors || [])], partial: total > step ? { done: step, total } : null }; render();
      for (let skip = step; skip < total; skip += step) {
        q.set('months', Math.min(step, total - skip)); q.set('skip', skip);
        let k;
        try { k = await api('/api/trades?' + q); } catch (e) { k = { rows: [], errors: [e.message] }; }
        const T = S.d.trades;
        if (tok !== S.tok || !T || T.key !== key) return;
        T.rows = T.rows.concat(k.rows || []).sort((a, b) => b.date.localeCompare(a.date));
        (k.errors || []).forEach(x => { if (!T.errors.includes(x)) T.errors.push(x); });
        T.partial = skip + step < total ? { done: skip + step, total } : null;
        render();
      }
    } catch (e) { if (tok === S.tok && S.d.trades && S.d.trades.key === key) { S.d.trades = { key, error: e.message }; render(); } }
  }

  function wireTab(D) {
    const bs = D.querySelector('#bldSel'); if (bs) bs.onchange = () => { S.bldIdx = +bs.value; render(); };
    const ud = D.querySelector('#uDong'); if (ud) ud.onchange = () => { S.uDong = ud.value === '단일동' ? '' : ud.value; S.uHo = null; S.uHoManual = false; render(); };
    const uh = D.querySelector('#uHo'); if (uh) uh.onchange = () => { S.uHo = uh.value; S.uHoManual = false; loadUnit(); render(); };
    D.querySelectorAll('[data-m]').forEach(b => b.onclick = () => { S.tradeMode = b.dataset.m; render(); });
    D.querySelectorAll('[data-mo]').forEach(b => b.onclick = () => { if (+b.dataset.mo > 12 && S.me.ready && !S.me.member) return loginModal('trade'); S.months = +b.dataset.mo; render(); });
    const mt = D.querySelector('#moreT'); if (mt) mt.onclick = () => { S.showAll = true; render(); };
    const sl = D.querySelector('#safeLogin'); if (sl) sl.onclick = () => loginModal('safe');
    const kl = D.querySelector('#kaptLogin'); if (kl) kl.onclick = () => loginModal('kapt');
    const stl = D.querySelector('#storeLogin'); if (stl) stl.onclick = () => loginModal('stores');
  }

  // ---------- 개발지도 ----------
  const ZTYPE = { '재개발': '#D9480F', '재건축': '#1971C2', '신속통합기획': '#7048E8', '모아타운': '#2F9E44', '가로주택·소규모': '#E67700', '역세권 개발': '#C2255C', '기타': '#495057' };
  const LCOLOR = { jigu: '#F08C00', toheo: '#E03131', road: '#868E96', trans: '#1C7ED6', park: '#37B24D', market: '#AE3EC9', gb: '#2B8A3E', devlim: '#5F3DC4' };
  const LNAME = { jigu: '지구단위계획구역', toheo: '토지거래허가구역', road: '도시계획도로', trans: '도시계획 교통시설', park: '공원 등 공간시설', market: '시장정비구역', gb: '개발제한구역', devlim: '개발행위허가제한지역' };
  const TILE = 0.01;
  const KGROUP = { '재개발': '재개발', '도시정비형 재개발': '도시정비형', '재정비촉진(뉴타운)': '재정비촉진', '재건축': '재건축', '역세권 재개발': '역세권', '주거환경개선': '주거환경개선', '신속통합기획': '신속통합기획', '정비구역': '기타', '사업완료': '기타' };
  const grp = z => KGROUP[z.k] || '기타';
  const D = { on: false, jbOn: { '재개발': true, '도시정비형': true, '재정비촉진': true, '재건축': true, '역세권': true, '주거환경개선': true, '신속통합기획': true, '기타': true }, want: { jb: true }, zones: null, zoneShapes: [], tiles: {}, shapes: {}, feats: {}, jb: null, jbShapes: [], jbLabels: new Map() };
  const KCOLOR = { '재개발': '#D9480F', '도시정비형 재개발': '#E67700', '재정비촉진(뉴타운)': '#C2255C', '재건축': '#1971C2', '역세권 재개발': '#7048E8', '주거환경개선': '#2F9E44', '신속통합기획': '#0CA678', '정비구역': '#868E96', '사업완료': '#ADB5BD' };
  let jbLoading = null;
  function loadJB() {
    if (D.jb) return Promise.resolve(D.jb);
    const get = u => fetch(u).then(r => { if (!r.ok) throw new Error(r.status); return r.json(); });
    if (!jbLoading) jbLoading = get('/data/jeongbi-seoul.json').catch(() => get('/jeongbi-seoul.json')).then(j => {
      D.jb = j.features.map(f => ({ ...f.properties, g: f.geometry, c: geoCenter(f.geometry) }));
      D.jbUpdated = j.updated;
      return loadSZ().then(sz => { enrichJB(sz); return j; });
    }).then(() => {
      // 경계가 없는 서울시 정비사업(한남뉴타운·신통 대상지 등)은 점으로 표시
      D.pins = (D.sz && D.sz.rows || []).filter(r => r.lat && r.lng && !(r.jb && r.jb.length)).map(r => ({ r, k: SZKIND[r.k] || '정비구역' }));
      const cnt = {}; D.jb.forEach(z => { cnt[grp(z)] = (cnt[grp(z)] || 0) + 1; });
      D.pins.forEach(p => { const g = grp(p); cnt[g] = (cnt[g] || 0) + 1; });
      document.querySelectorAll('[data-cnt]').forEach(e => e.textContent = cnt[e.dataset.cnt] || 0);
      return D.jb;
    }).catch(() => { jbLoading = null; D.jb = null; toast('정비구역 자료를 불러오지 못했습니다'); return null; });
    return jbLoading;
  }
  // 서울시 정비사업 현황으로 국토부 구역의 종류·이름 보충 (국토부에 종류가 '정비구역'으로만 된 곳, 이름 없는 곳)
  const SZKIND = { '재개발(주택정비형)': '재개발', '재개발(도시정비형)': '도시정비형 재개발', '재건축(공동)': '재건축', '재건축(단독)': '재건축', '주거환경개선(관리형)': '주거환경개선', '주거환경개선(정비형)': '주거환경개선', '신속통합기획': '신속통합기획' };
  function enrichJB(sz) {
    if (!sz || !D.jb) return;
    for (const z of D.jb) {
      const rs = (sz.byJb.get(z.id) || []).slice().sort((a, b) => (b.sd || '').localeCompare(a.sd || ''));
      if (!rs.length) continue;
      const r = rs[0];
      if ((z.k === '정비구역' || !KCOLOR[z.k]) && SZKIND[r.k]) z.k = SZKIND[r.k];
      if (!z.named && r.n) { z.n = r.n; z.named = true; }
    }
  }
  // 경계 없는 사업: 점 + (확대하면) 이름표
  const ZST = { '대상지선정': '대상지', '기획완료': '기획완료', '정비계획수립': '계획수립', '열람공고': '열람공고', '구역지정': '구역지정', '추진위구성': '추진위', '조합설립인가': '조합설립', '건축심의': '건축심의', '사업시행인가': '사업시행', '관리처분계획인가': '관리처분', '착공': '착공', '준공(일부)': '일부준공', '준공': '준공' };
  function drawPins() {
    D.pinOv = D.pinOv || new Map();
    const show = D.on && D.want.jb && D.pins;
    if (!show) { D.pinOv.forEach(o => o.setMap(null)); return; }
    const K = kakao.maps, lvl = S.map.getLevel(), b = S.map.getBounds();
    D.pins.forEach((p, i) => {
      const ll = new K.LatLng(p.r.lat, p.r.lng);
      const on = D.jbOn[grp(p)] && b.contain(ll) && lvl <= 8;
      let o = D.pinOv.get(i);
      if (!on) { if (o) o.setMap(null); return; }
      if (!o) {
        const el = document.createElement('button');
        el.type = 'button'; el.className = 'zpin'; el.style.setProperty('--c', KCOLOR[p.k] || '#868E96');
        el.innerHTML = `<i></i><span>${esc(p.r.n)}${p.r.st ? ` · ${esc(ZST[p.r.st] || p.r.st)}` : ''}</span>`;
        el.title = `${p.r.n} (${p.r.k}${p.r.st ? ' · ' + p.r.st : ''}) — 구역 경계 자료가 없어 대표 위치로 표시합니다`;
        el.onclick = ev => { ev.stopPropagation(); pick(p.r.lat, p.r.lng); };
        o = new K.CustomOverlay({ position: ll, content: el, xAnchor: 0, yAnchor: .5, zIndex: 2, clickable: true });
        D.pinOv.set(i, o);
      }
      o.getContent().classList.toggle('lab', lvl <= 5);
      if (!o.getMap()) o.setMap(S.map);
    });
  }
  function drawJB() {
    drawPins();
    const K = kakao.maps;
    const show = D.on && D.want.jb && D.jb;
    if (!show) { D.jbShapes.forEach(o => o.setMap(null)); D.jbLabels.forEach(o => o.setMap(null)); return; }
    if (!D.jbShapes.length) {
      for (const z of D.jb) {
        const c = KCOLOR[z.k] || '#868E96';
        for (const path of geoToPaths(z.g)) { const o = new K.Polygon({ path, strokeWeight: 2, strokeColor: c, strokeOpacity: .9, fillColor: c, fillOpacity: z.k === '사업완료' ? .05 : .16 }); o.grp = grp(z); o.z = z; D.jbShapes.push(o); }
      }
    }
    D.jbShapes.forEach(o => { const on = D.jbOn[o.grp]; const m = o.getMap && o.getMap(); if (on && !m) o.setMap(S.map); if (!on && m) o.setMap(null); });
    // 이름표는 가까이 확대했을 때 화면 안의 구역만
    const lvl = S.map.getLevel(), b = S.map.getBounds();
    D.jb.forEach((z, i) => {
      const inView = D.jbOn[grp(z)] && lvl <= 4 && z.c && b.contain(new K.LatLng(z.c.lat, z.c.lng));
      let o = D.jbLabels.get(i);
      if (!inView) { if (o) o.setMap(null); return; }
      if (!o) {
        const el = document.createElement('div');
        el.className = 'jlabel'; el.style.color = KCOLOR[z.k] || '#868E96';
        el.innerHTML = `${esc(z.named ? z.n : z.k)}${z.d ? ` <span>· ${esc(z.d.slice(0, 7))}</span>` : ''}`;
        o = new K.CustomOverlay({ position: new K.LatLng(z.c.lat, z.c.lng), content: el, yAnchor: .5, zIndex: 2 });
        D.jbLabels.set(i, o);
      }
      if (!o.getMap || !o.getMap()) o.setMap(S.map);
    });
  }
  const zcolor = z => ZTYPE[z.type] || ZTYPE['기타'];

  function devInit() {
    // 개발지도 버튼: 꺼져 있으면 켜기 → 켜져 있고 패널이 닫혀 있으면 패널 열기 → 패널이 열려 있으면 끄기
    $('mtDev').onclick = () => { if (!D.on) toggleDev(true); else if ($('devpanel').hidden) { $('devpanel').hidden = false; $('tpanel').hidden = true; } else toggleDev(false); };
    $('devClose').onclick = () => { $('devpanel').hidden = true; };
    const boxes = [...document.querySelectorAll('[data-jb]')];
    const syncAll = () => { $('jbAll').checked = boxes.every(b => b.checked); $('jbAll').indeterminate = !$('jbAll').checked && boxes.some(b => b.checked); };
    boxes.forEach(cb => cb.onchange = () => { D.jbOn[cb.dataset.jb] = cb.checked; syncAll(); devRefresh(); });
    $('jbAll').onchange = () => { boxes.forEach(cb => { cb.checked = $('jbAll').checked; D.jbOn[cb.dataset.jb] = cb.checked; }); devRefresh(); };
    kakao.maps.event.addListener(S.map, 'idle', () => { if (D.on) devRefresh(); });

  }
  function toggleDev(on) {
    D.on = on; D.hinted = false;
    $('mtDev').setAttribute('aria-pressed', on);
    $('devpanel').hidden = !on;
    if (on) $('tpanel').hidden = true;
    if (!on) hideZone();
    devRefresh();
  }
  async function loadZones() {
    try { const j = await api('/api/zones'); D.zones = j.zones || []; }
    catch { D.zones = []; }
    if (S.sel) render();
    if (D.on) devRefresh();
  }
  function geoToPaths(g) {
    const K = kakao.maps;
    const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
    return polys.map(p => p.map(r => r.map(([x, y]) => new K.LatLng(y, x))));
  }
  function geoLines(g) {
    const K = kakao.maps;
    const ls = g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : [];
    return ls.map(l => l.map(([x, y]) => new K.LatLng(y, x)));
  }
  function inRing(x, y, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }
  function inGeo(g, x, y) {
    if (!g) return false;
    const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
    return polys.some(p => p[0] && inRing(x, y, p[0]) && !p.slice(1).some(h => inRing(x, y, h)));
  }
  function geoCenter(g) {
    const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
    let best = null, bestN = 0;
    for (const p of polys) if (p[0] && p[0].length > bestN) { best = p[0]; bestN = p[0].length; }
    if (!best) return null;
    let a = 0, cx = 0, cy = 0;
    for (let i = 0, j = best.length - 1; i < best.length; j = i++) {
      const f = best[j][0] * best[i][1] - best[i][0] * best[j][1];
      a += f; cx += (best[j][0] + best[i][0]) * f; cy += (best[j][1] + best[i][1]) * f;
    }
    if (!a) return { lng: best[0][0], lat: best[0][1] };
    return { lng: cx / (3 * a), lat: cy / (3 * a) };
  }

  function drawZones() {
    const K = kakao.maps;
    D.zoneShapes.forEach(o => o.setMap(null)); D.zoneShapes = [];
    if (!D.on || !D.want.zones || !D.zones) return;
    for (const z of D.zones) {
      const c = zcolor(z);
      if (z.geometry) for (const path of geoToPaths(z.geometry))
        D.zoneShapes.push(new K.Polygon({ map: S.map, path, strokeWeight: 3, strokeColor: c, strokeOpacity: .95, fillColor: c, fillOpacity: .18 }));
      const ctr = z.geometry ? geoCenter(z.geometry) : z.point;
      if (!ctr) continue;
      const el = document.createElement('div');
      el.className = 'zlabel'; el.style.color = c;
      el.innerHTML = `${esc(z.type || '개발')}<span>${esc(z.name)}${z.stage ? ' · ' + esc(z.stage) : ''}</span>`;
      el.onclick = ev => { ev.stopPropagation(); showZones([z], []); };
      D.zoneShapes.push(new K.CustomOverlay({ map: S.map, position: new K.LatLng(ctr.lat, ctr.lng), content: el, yAnchor: 1.2, clickable: true }));
    }
  }

  async function devRefresh() {
    drawZones();
    if (D.on && D.want.jb && !D.jb) loadJB().then(() => drawJB()); else drawJB();
    const K = kakao.maps;
    const keys = Object.keys(LCOLOR);
    const lvl = S.map.getLevel();
    const b = S.map.getBounds(), sw = b.getSouthWest(), ne = b.getNorthEast();
    const tiles = [];
    if (D.on && lvl <= 5) {
      for (let tx = Math.floor(sw.getLng() / TILE); tx <= Math.floor(ne.getLng() / TILE); tx++)
        for (let ty = Math.floor(sw.getLat() / TILE); ty <= Math.floor(ne.getLat() / TILE); ty++) tiles.push(`${tx},${ty}`);
    }
    const anyLayer = keys.some(k => D.want[k]);
    if (D.on && anyLayer && lvl > 5 && !D.hinted) { D.hinted = true; toast('공공 도시계획 레이어는 지도를 조금 더 확대하면 표시됩니다', 3500); }
    for (const k of keys) {
      // 꺼진 레이어나 화면 밖 칸은 지움
      for (const [tk, objs] of Object.entries(D.shapes[k] || {})) {
        if (!D.on || !D.want[k] || !tiles.includes(tk)) { objs.forEach(o => o.setMap(null)); delete D.shapes[k][tk]; }
      }
      if (!D.on || !D.want[k]) continue;
      D.shapes[k] = D.shapes[k] || {}; D.tiles[k] = D.tiles[k] || {}; D.feats[k] = D.feats[k] || {};
      for (const tk of tiles) {
        if (D.shapes[k][tk]) continue;
        D.shapes[k][tk] = [];
        const draw = feats => {
          if (!D.on || !D.want[k] || !D.shapes[k][tk]) return;
          for (const f of feats) {
            if (D.feats[k][f.id] && D.feats[k][f.id] !== tk) continue; // 다른 칸에 이미 그림
            D.feats[k][f.id] = tk;
            const c = LCOLOR[k];
            for (const path of geoToPaths(f.g)) D.shapes[k][tk].push(new K.Polygon({ map: S.map, path, strokeWeight: 2, strokeColor: c, strokeOpacity: .9, strokeStyle: k === 'jigu' ? 'shortdash' : 'solid', fillColor: c, fillOpacity: k === 'road' ? .25 : .1 }));
            for (const path of geoLines(f.g)) D.shapes[k][tk].push(new K.Polyline({ map: S.map, path, strokeWeight: 3, strokeColor: c, strokeOpacity: .9 }));
          }
        };
        if (D.tiles[k][tk]) { draw(D.tiles[k][tk]); continue; }
        api(`/api/layer?layer=${k}&tile=${tk}`).then(j => { D.tiles[k][tk] = j.features; draw(j.features); })
          .catch(e => { delete D.shapes[k][tk]; toast(`${LNAME[k]} 정보를 잠시 불러오지 못했습니다`); });
      }
      // 화면 밖으로 나간 칸의 '그린 기록'도 정리
      for (const [fid, tk] of Object.entries(D.feats[k])) if (!D.shapes[k][tk]) delete D.feats[k][fid];
    }
  }

  // 누른 위치가 어떤 구역·레이어에 속하는지
  function zonesAt(lat, lng) { return (D.zones || []).filter(z => z.geometry && inGeo(z.geometry, lng, lat)); }
  // 개발지도가 켜져 있을 때 누른 자리의 구역을 진하게 표시 (구역 정보는 필지 창 맨 위 안내로 보여 줌)
  function devHit(lat, lng) {
    if (!D.on) return;
    $('zonecard').hidden = true;
    markZones(D.want.jb && D.jb ? D.jb.filter(z => D.jbOn[grp(z)] && inGeo(z.g, lng, lat)) : []);
  }
  // 고른 구역을 진하게 표시
  function markZones(js) {
    const sel = new Set(js);
    D.jbShapes.forEach(o => {
      const on = sel.has(o.z), c = KCOLOR[o.z.k] || '#868E96';
      if (!!o.sel === on) return;
      o.sel = on;
      o.setOptions(on ? { strokeWeight: 4, strokeOpacity: 1, fillOpacity: .34 } : { strokeWeight: 2, strokeOpacity: .9, fillOpacity: o.z.k === '사업완료' ? .05 : .16 });
      if (on) o.setZIndex && o.setZIndex(5); else o.setZIndex && o.setZIndex(0);
    });
  }
  function hideZone() { $('zonecard').hidden = true; markZones([]); }
  function zoneHtml(z) {
    const c = zcolor(z);
    const tags = [z.type, z.stage, z.stageDate && `단계일 ${z.stageDate}`, z.households && `${z.households}세대`, z.builder && `시공 ${z.builder}`].filter(Boolean);
    return `<div class="zc-h"><b style="color:${c}">${esc(z.name)}</b></div>
      <div class="zc-tags">${tags.map(t => `<span>${esc(t)}</span>`).join('')}${z.area ? `<span>구역 ${ar(z.area, 0)[0]}</span>` : ''}</div>
      ${z.note ? `<div class="zc-note"><b>리얼워커스 의견</b>${esc(z.note)}</div>` : ''}
      ${z.source ? `<div class="zc-meta">출처 · <a href="${esc(z.source)}" target="_blank" rel="noopener">관련 자료 보기</a></div>` : ''}
      <div class="zc-meta">업데이트 ${esc((z.updated || '').slice(0, 10))} · 계획은 변경될 수 있습니다.</div>`;
  }
  function jbHtml(z) {
    const c = KCOLOR[z.k] || '#868E96';
    return `<div class="zc-h"><b style="color:${c}">${esc(z.named ? z.n : z.gu + ' 정비구역')}</b></div>
      <div class="zc-tags"><span style="background:${c}22;color:${c}">${esc(z.k)}</span>${z.d ? `<span>고시 ${esc(z.d)}</span>` : z.y ? `<span>${esc(z.y)}년 고시</span>` : ''}<span>${esc(z.gu)}</span></div>
      ${z.named ? '' : '<div class="zc-meta">국토부 자료에 구역 이름이 등록되어 있지 않습니다.</div>'}
      <div class="zc-meta">출처 · 국토교통부 정비구역 연속주제도 (${esc(D.jbUpdated || '')} 기준)</div>`;
  }
  function showZones(zs, ls, js = [], lat, lng) {
    const el = $('zonecard');
    el.innerHTML = `<div class="zc-h"><span style="font-size:12px;color:var(--muted)">개발정보</span><button id="zcClose" aria-label="닫기">×</button></div>`
      + [...js.map(jbHtml), ...zs.map(zoneHtml)].join('<hr style="border:0;border-top:1px solid var(--line);margin:4px 0">')
      + (ls.length ? `<div class="zc-tags">${ls.map(l => `<span style="background:${LCOLOR[l.k]}22;color:${LCOLOR[l.k]}">${esc(LNAME[l.k])}${l.nm ? ' · ' + esc(l.nm) : ''}</span>`).join('')}</div>` : '')
      + (lat != null ? `<button class="zc-go" id="zcGo">이 자리 필지 정보 보기</button>` : '');
    el.hidden = false;
    markZones(js);
    if (mobile()) { $('devpanel').hidden = true; $('panel').classList.add('closed'); }
    $('zcClose').onclick = hideZone;
    const go = $('zcGo'); if (go) go.onclick = () => { hideZone(); pick(lat, lng); };
  }
  // 서울시 정비사업 현황 (추진 단계 등). GitHub가 분기마다 data/seoul-zones.json 으로 만들어 둠
  let szLoading = null;
  function loadSZ() {
    if (D.sz) return Promise.resolve(D.sz);
    if (!szLoading) szLoading = fetch('/data/seoul-zones.json').then(r => { if (!r.ok) throw new Error(r.status); return r.json(); }).then(j => {
      const byJb = new Map();
      for (const r of j.rows || []) for (const id of r.jb || []) { if (!byJb.has(id)) byJb.set(id, []); byJb.get(id).push(r); }
      D.sz = { rows: j.rows || [], byJb, updated: j.updated || '' };
      return D.sz;
    }).catch(() => { D.sz = { rows: [], byJb: new Map(), updated: '' }; return D.sz; });
    return szLoading;
  }
  const ZSHORT = { '재개발': '재개발', '도시정비형 재개발': '도시정비형 재개발', '재정비촉진(뉴타운)': '재정비촉진(뉴타운)', '재건축': '재건축', '역세권 재개발': '역세권개발', '주거환경개선': '주거환경개선', '사업완료': '정비사업 완료', '정비구역': '정비구역',
    '재개발(주택정비형)': '재개발', '재개발(도시정비형)': '도시정비형 재개발', '재건축(공동)': '재건축', '재건축(단독)': '재건축', '주거환경개선(관리형)': '주거환경개선', '주거환경개선(정비형)': '주거환경개선', '신속통합기획': '신속통합기획', '모아타운': '모아타운', '관리지역': '소규모정비 관리지역', '소규모정비': '소규모정비', '재정비촉진지구': '재정비촉진지구' };
  const SZCOLOR = { '신속통합기획': '#0CA678', '재개발(주택정비형)': '#D9480F', '재개발(도시정비형)': '#E67700', '재건축(공동)': '#1971C2', '재건축(단독)': '#1971C2', '주거환경개선(관리형)': '#2F9E44', '주거환경개선(정비형)': '#2F9E44' };
  // 꼭 알아야 할 규제 (토지이용계획 기준) — 상단 경고 칩 + 이용계획 맨 위 설명
  const WARN = [
    { code: 'UDX100', short: '건축허가·착공제한', note: '정비구역 지정 등을 앞두고 지자체가 건축허가나 착공을 일정 기간 막아 둔 지역입니다(건축법 제18조, 원칙 2년 이내·1회 1년 연장). 이 기간에는 신축·증축이나 용도변경이 어려울 수 있고, 지분 쪼개기를 막기 위한 경우가 많습니다.' },
    { code: 'UQQ900', short: '개발행위허가제한', note: '도시계획을 새로 세우는 동안 건축, 토지 형질변경, 토지 분할 같은 개발행위를 일정 기간 제한한 지역입니다(국토계획법 제63조, 최대 3년·일부 2년 연장). 제한 기간과 대상 행위는 고시문으로 확인해 주세요.' },
  ];
  function warnsHere() {
    const L = S.d.land, uses = L && L.use && L.use.ok ? L.use.data : [];
    return WARN.map(w => ({ ...w, u: uses.find(u => u.code === w.code && (!u.rel || u.rel === '포함')) })).filter(w => w.u);
  }
  function warnSection() {
    const ws = warnsHere();
    if (!ws.length) return '';
    return `<section class="warnbox" id="warnSec"><h2>주의할 규제<span>토지이용계획 기준</span></h2>${ws.map(w => `<div class="wrow"><b>${esc(w.u.name || w.short)}</b><p>${esc(w.note)}</p></div>`).join('')}
      <p class="note">제한 기간·대상은 지정 고시마다 다릅니다. 계약 전에 토지이음(eum.go.kr)의 고시 정보나 구청에서 꼭 확인해 주세요.</p></section>`;
  }
  // 토지이용계획(국토부)에 나오는 정비 관련 지역·지구 — 전국 공통, 경계 자료가 없어도 필지 단위로 정확함
  const LUZ = [
    { code: 'UDK200', x: '모아타운', label: '소규모주택정비 관리지역' },
    { code: 'UDK300', x: '소규모정비', label: '소규모주택정비사업 사업시행구역' },
    { re: /재정비촉진지구/, x: '재정비촉진지구', label: '재정비촉진지구' },
    { code: 'UDT100', x: '정비구역', label: '정비구역' },
  ];
  const XCOLOR = { '모아타운': '#5C940D', '관리지역': '#5C940D', '소규모정비': '#74B816', '재정비촉진지구': '#C2255C', '정비구역': '#868E96' };
  const XNOTE = {
    '모아타운': '모아타운은 노후 저층 주거지를 블록 단위로 묶어 모아주택(가로주택정비·소규모재건축 등)으로 정비하는 제도입니다. 이 필지는 토지이용계획상 소규모주택정비 관리지역에 들어 있습니다.',
    '관리지역': '이 필지는 토지이용계획상 소규모주택정비 관리지역에 들어 있습니다. 노후 저층 주거지를 묶어 가로주택정비·소규모재건축 등으로 정비하는 지역입니다.',
    '소규모정비': '이 필지는 가로주택정비·소규모재건축·자율주택정비 같은 소규모주택정비사업의 사업시행구역에 들어 있습니다.',
    '재정비촉진지구': '이 필지는 토지이용계획상 재정비촉진지구(뉴타운)에 들어 있습니다.',
    '정비구역': '이 필지는 토지이용계획상 정비구역에 들어 있습니다. 사업 종류와 단계는 구청에서 확인해 주세요.',
  };
  // 이 필지가 들어 있는 정비구역·정비사업. 서울은 국토부 경계 + 서울시 정비사업 현황, 전국은 토지이용계획
  function zonesHere() {
    const p = S.sel;
    if (!p || !p.c) return [];
    const out = [], used = new Set();
    const seoul = String(p.pnu).startsWith('11');
    if (seoul && (!D.jb || !D.sz)) Promise.all([loadJB(), loadSZ()]).then(([j]) => { if (j && S.sel === p) render(); });
    if (seoul && D.jb && D.sz) {
      for (const z of D.jb.filter(z => inGeo(z.g, p.c.lng, p.c.lat))) {
        const rs = (D.sz.byJb.get(z.id) || []).slice().sort((a, b) => (b.sd || '').localeCompare(a.sd || ''));
        rs.forEach(r => used.add(r.id));
        out.push({ z, r: rs[0] || null });
      }
      // 국토부 경계가 없는 사업(신속통합기획 대상지 등): 대표 지번이 이 필지이거나 대표 위치가 이 필지 안
      const tail = String(p.addr || '').split(' ').slice(-2).join(' ');
      for (const r of D.sz.rows) {
        if (used.has(r.id) || (r.jb && r.jb.length)) continue;
        if ((tail && r.a === tail) || (r.lat && p.geometry && inGeo(p.geometry, r.lng, r.lat))) { used.add(r.id); out.push({ z: null, r }); }
      }
    }
    // 토지이용계획의 지역·지구 (위에서 이미 같은 종류가 잡혔으면 빼기)
    const L = S.d.land, uses = L && L.use && L.use.ok ? L.use.data : [];
    for (const d of LUZ) {
      const u = uses.find(u => (d.code ? u.code === d.code : d.re.test(u.name || '')) && (!u.rel || u.rel === '포함'));
      if (!u) continue;
      if (d.x === '정비구역' && out.length) continue;
      if (d.x === '재정비촉진지구' && out.some(e => /재정비촉진/.test(zKind(e)))) continue;
      const x = d.x === '모아타운' && !seoul ? '관리지역' : d.x; // '모아타운'은 서울시 명칭
      out.push({ z: null, r: null, x, lu: u.name || d.label });
    }
    return out;
  }
  const zKind = e => e.x || (e.r && e.r.k) || (e.z && e.z.k) || '정비구역';
  const zColor = e => (e.x && XCOLOR[e.x]) || (e.r && SZCOLOR[e.r.k]) || (e.z && KCOLOR[e.z.k]) || '#868E96';
  // 이름이 없으면 '○○동 ○○번지 일대' (서울시 자료의 대표 지번, 없으면 누른 필지의 동)
  const zName = e => (e.x ? `${String(S.sel && S.sel.addr || '').split(' ').slice(-2, -1)[0] || ''} 일대 ${e.x}`.trim() : '') || (e.r && e.r.n) || (e.z && e.z.named ? e.z.n : '') || (e.r && e.r.a ? `${e.r.a.replace(/번지$/, '')}번지 일대` : '')
    || (S.sel && S.sel.addr ? `${String(S.sel.addr).split(' ').slice(-2, -1)[0] || ''} 일대`.trim() : '');
  // 구역 면적(㎡) 대략 계산 (경위도 → 평면 근사)
  function geoArea(g) {
    const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
    let sum = 0;
    for (const poly of polys) poly.forEach((ring, ri) => {
      const lat0 = ring[0][1] * Math.PI / 180, kx = 111320 * Math.cos(lat0), ky = 110540;
      let a = 0;
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += (ring[j][0] * kx) * (ring[i][1] * ky) - (ring[i][0] * kx) * (ring[j][1] * ky);
      sum += (ri === 0 ? 1 : -1) * Math.abs(a / 2);
    });
    return sum;
  }
  // 정비사업 안내 페이지 주소 (/seoul/<구>/<사업번호>.html)
  const GUSLUG = { '종로구': 'jongno', '중구': 'jung', '용산구': 'yongsan', '성동구': 'seongdong', '광진구': 'gwangjin', '동대문구': 'dongdaemun', '중랑구': 'jungnang', '성북구': 'seongbuk', '강북구': 'gangbuk', '도봉구': 'dobong', '노원구': 'nowon', '은평구': 'eunpyeong', '서대문구': 'seodaemun', '마포구': 'mapo', '양천구': 'yangcheon', '강서구': 'gangseo', '구로구': 'guro', '금천구': 'geumcheon', '영등포구': 'yeongdeungpo', '동작구': 'dongjak', '관악구': 'gwanak', '서초구': 'seocho', '강남구': 'gangnam', '송파구': 'songpa', '강동구': 'gangdong' };
  const zPage = r => r && r.id && GUSLUG[r.gu] ? `/seoul/${GUSLUG[r.gu]}/${encodeURIComponent(r.id)}.html` : '';
  // 추진 단계 막대 (서울시 정비사업 현황의 단계 기준)
  const ZORDER = ['대상지선정', '기획완료', '정비계획수립', '열람공고', '구역지정', '추진위구성', '조합설립인가', '건축심의', '사업시행인가', '관리처분계획인가', '착공', '준공(일부)', '준공'];
  const ZSTEP = { '대상지선정': '대상지', '기획완료': '기획', '구역지정': '구역지정', '추진위구성': '추진위', '조합설립인가': '조합설립', '사업시행인가': '사업시행', '관리처분계획인가': '관리처분', '착공': '착공', '준공': '준공' };
  const ZSTD = {
    '대상지선정': '신속통합기획 대상지로 선정되어 서울시가 정비계획 방향(기획안)을 마련하는 단계입니다.',
    '기획완료': '신속통합기획안(정비계획 가이드라인)이 확정된 단계입니다. 이어서 정비계획 입안과 구역지정 절차를 밟습니다.',
    '정비계획수립': '정비계획(구역 범위, 용적률, 높이, 세대수)을 세우고 있는 단계입니다.',
    '열람공고': '정비계획안을 주민에게 공개하고 의견을 받는 단계입니다.',
    '구역지정': '정비구역으로 지정·고시된 단계입니다. 다음은 조합설립추진위원회 구성입니다.',
    '추진위구성': '조합설립추진위원회가 승인되어 조합 설립을 준비하는 단계입니다.',
    '조합설립인가': '조합이 설립 인가되어 사업 주체가 생긴 단계입니다. 다음은 사업시행계획인가입니다.',
    '건축심의': '건축계획(배치·높이·동수) 심의를 받는 단계입니다. 다음은 사업시행계획인가입니다.',
    '사업시행인가': '사업시행계획이 인가된 단계입니다. 분양신청을 거쳐 관리처분계획인가로 이어집니다.',
    '관리처분계획인가': '조합원별 분양·분담금을 정한 관리처분계획이 인가된 단계입니다. 이주·철거 후 착공합니다.',
    '착공': '이주·철거를 마치고 공사 중인 단계입니다.',
    '준공(일부)': '공사가 일부 끝나 준공된 단계입니다.',
    '준공': '공사가 끝나 준공된 사업입니다.',
  };
  function zTrack(r) {
    if (!r || !r.st || ZORDER.indexOf(r.st) < 0) return '';
    const cr = ZORDER.indexOf(r.st);
    let steps = /^주거환경개선/.test(r.k) ? ['구역지정', '사업시행인가', '착공', '준공'] : ['구역지정', '추진위구성', '조합설립인가', '사업시행인가', '관리처분계획인가', '착공', '준공'];
    if (r.k === '신속통합기획' || cr < ZORDER.indexOf('구역지정')) steps = ['대상지선정', '기획완료', ...steps];
    const done = steps.map(x => ZORDER.indexOf(x) <= cr);
    const last = done.lastIndexOf(true);
    return `<ol class="ztrack${steps.length > 7 ? ' z9' : ''}">${steps.map((x, i) => `<li class="${done[i] ? 'on' : ''}${i === last ? ' cur' : ''}"><i></i><span>${(steps.length > 7 && { '구역지정': '구역', '조합설립인가': '조합' }[x]) || ZSTEP[x] || x}</span></li>`).join('')}</ol>
      ${ZSTD[r.st] ? `<p class="ztd"><b>${esc(r.st)}</b> — ${esc(ZSTD[r.st])}</p>` : ''}`;
  }
  // 개발정보 칸: 추진 현황 · 고시 정보 · 구역 설정
  const zPct = v => `${n(v, v % 1 ? 2 : 0)}%`;
  function devTab(jz) {
    return jz.map(e => {
      if (e.x) {
        const dong = String(S.sel && S.sel.addr || '').split(' ').slice(0, -1).join(' ');
        return `<section><h2><i class="dzi" style="background:${zColor(e)}"></i>${esc(e.x)}<span>토지이용계획</span></h2>
          <dl class="kv"><dt>구분</dt><dd>${esc(e.lu)}</dd>${dong ? `<dt>위치</dt><dd>${esc(dong)} 일대</dd>` : ''}</dl>
          <p class="note">${esc(XNOTE[e.x] || '')} 출처: 국토교통부 토지이용계획. 구역 이름과 추진 단계는 구청이나 조합에 확인해 주세요.</p></section>`;
      }
      const z = e.z, r = e.r, c = zColor(e), kind = zKind(e);
      const area = r && r.ar ? r.ar : z && z.g ? Math.round(geoArea(z.g) / 10) * 10 : 0;
      const fl = r && r.fl && /\d/.test(r.fl) ? r.fl.split('/') : null;
      const zoneChg = r && (r.zb || r.za) ? (r.zb && r.za && r.zb !== r.za ? `${r.zb} → ${r.za}` : r.za || r.zb) : '';
      const rows = [
        ['구역명', zName(e) + (e.r && e.r.n || e.z && e.z.named ? '' : ' (공식 명칭 미등록)')],
        ['사업 구분', kind === '정비구역' ? '정비구역 (세부 종류 미등록)' : kind],
        ['추진 단계', r && r.st ? `${r.st}${r.sd ? ` (${r.sd})` : ''}` : ''],
        ['정비구역 고시', z ? (z.d || (z.y ? `${z.y}년` : '')) : ''],
        ['위치', r && r.a ? `서울특별시 ${r.gu} ${r.a} 일대` : z ? `서울특별시 ${z.gu}` : ''],
        ['구역 면적', area ? `${r && r.ar ? '' : '약 '}${ar(area, 0)[0]}` : ''],
        ['용도지역', zoneChg],
        ['계획 용적률', r && r.far ? zPct(r.far) : ''],
        ['계획 층수', fl ? `지하 ${fl[0]}층 · 지상 ${fl[1]}층` : ''],
        ['계획 세대수', r && r.hh ? `${n(r.hh)}세대` : ''],
      ].filter(x => x[1]);
      const src = [r ? `서울시 정비사업 현황 (${esc(D.sz.updated)} 받음)` : '', z ? `국토교통부 정비구역 연속주제도 (${esc(D.jbUpdated || '')} 기준)` : ''].filter(Boolean).join(' · ');
      return `<section><h2><i class="dzi" style="background:${c}"></i>${esc(zName(e) || ZSHORT[kind] || '정비구역')}<span>${esc(ZSHORT[kind] || '정비구역')}</span></h2>
        ${zTrack(r)}
        <dl class="kv">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
        ${zPage(r) ? `<a class="zlink zpage" href="${zPage(r)}" target="_blank" rel="noopener">이 구역 추진 현황 자세히 · ☆ 관심 구역 담기 ›</a>` : ''}
        ${r && /^https:\/\/cleanup\.seoul\.go\.kr\//.test(r.url) ? `<a class="zlink" href="${esc(r.url)}" target="_blank" rel="noopener">정비사업 정보몽땅에서 조합 소식 보기 ›</a>` : ''}
        <p class="note">${src}. 계획 수치는 진행 중에 바뀔 수 있으니 계약 전에는 구청이나 조합에 꼭 확인해 주세요.</p></section>`;
    }).join('');
  }
  // 이용계획 탭에 붙일 개발정보
  function zoneSection() {
    if (!S.sel || !S.sel.c) return '';
    if (!D.jb && String(S.sel.pnu).startsWith('11')) loadJB().then(j => { if (j) render(); });
    const jz = D.jb ? D.jb.filter(z => inGeo(z.g, S.sel.c.lng, S.sel.c.lat)) : [];
    const zs = (D.zones || []).filter(z => (z.pnus || []).includes(S.sel.pnu) || (z.geometry && inGeo(z.geometry, S.sel.c.lng, S.sel.c.lat)));
    const jh = jz.length ? `<section><h2>정비구역<span>국토부 ${esc(D.jbUpdated || '')}</span></h2>${jz.map(z => `<div class="zonebox"><div class="zt"><i style="background:${KCOLOR[z.k] || '#868E96'}"></i>${esc(z.named ? z.n : '이름 미등록 정비구역')}</div>
      <div class="chips" style="margin:0"><span class="chip">${esc(z.k)}</span>${z.d ? `<span class="chip">고시 ${esc(z.d)}</span>` : ''}</div></div>`).join('')}
      <p class="note">이 필지는 정비구역 안에 있습니다. 추진 단계와 권리 관계는 해당 구청이나 조합에서 확인해 주세요.</p></section>` : '';
    if (!zs.length) return jh;
    return jh + `<section><h2>리얼워커스 개발정보<span>참고 자료</span></h2>${zs.map(z => `<div class="zonebox"><div class="zt"><i style="background:${zcolor(z)}"></i>${esc(z.name)}</div>
      <div class="chips" style="margin:0">${[z.type, z.stage, z.stageDate].filter(Boolean).map(t => `<span class="chip">${esc(t)}</span>`).join('')}</div>
      ${z.note ? `<p>${esc(z.note)}</p>` : ''}${z.source ? `<a class="src" href="${esc(z.source)}" target="_blank" rel="noopener">관련 자료 보기</a>` : ''}</div>`).join('')}
      <p class="note">계획 단계의 정보는 변경될 수 있습니다.</p></section>`;
  }

  // ---------- 여러 필지에 걸친 건물 ----------
  const atchList = () => (S.d.bld && S.d.bld.atch && S.d.bld.atch.ok) ? S.d.bld.atch.data : [];
  const pnuJibun = pnu => { pnu = String(pnu); const b = Number(pnu.slice(11, 15)), j = Number(pnu.slice(15, 19)); return `${pnu[10] === '2' ? '산' : ''}${b}${j ? '-' + j : ''}`; };
  // 부속지번 필지 경계를 대표 필지와 함께 묶어서 그립니다
  async function drawAtch(tok) {
    const list = atchList();
    if (!list.length) return;
    const K = kakao.maps;
    const rs = await Promise.all(list.slice(0, 30).map(a => api(`/api/parcel?pnu=${a.pnu}`).catch(() => null)));
    if (tok !== S.tok) return;
    rs.forEach((p, i) => {
      if (!p) return;
      list[i].addr = p.addr;
      for (const poly of ringsOf(p.geometry)) {
        const path = poly.map(ring => ring.map(([x, y]) => new K.LatLng(y, x)));
        S.polys.push(new K.Polygon({ map: S.map, path, strokeWeight: 2, strokeColor: '#E4572E', strokeOpacity: .9, strokeStyle: 'shortdash', fillColor: '#E4572E', fillOpacity: 0.10 }));
      }
    });
    render();
  }
  // 이 필지에 대장이 없고 건물의 대표 지번이 따로 있으면, 그 지번에 실제 건축물대장이 있는지 확인한 뒤에만 안내
  async function checkMain(tok) {
    if (titles().length || !S.sel.bldPnu) return;
    try {
      const j = await api(`/api/building?pnu=${S.sel.bldPnu}`);
      if (tok !== S.tok) return;
      if (j.titles && j.titles.ok && j.titles.data.length) { S.sel.bldOk = true; render(); }
    } catch { /* 확인 실패 시 안내하지 않음 */ }
  }
  function groupSection() {
    const list = atchList();
    if (list.length) {
      return `<section><h2>여러 필지에 걸친 건물<span>${list.length + 1}개 필지</span></h2>
        <p class="note" style="margin-top:0">이 건물은 대표 필지와 함께 아래 필지에 걸쳐 지어져 있습니다. 지도에는 점선으로 함께 표시했습니다. 건축물대장의 대지면적은 묶인 필지 전체 기준입니다.</p>
        <div class="glist"><span class="g main">${esc(S.sel.jibun || pnuJibun(S.sel.pnu)).replace(/[가-힣]+$/, '')} <small>대표</small></span>${list.map(a => `<button class="g" data-gp="${a.pnu}">${esc(a.jibun)}</button>`).join('')}</div></section>`;
    }
    if (!titles().length && S.sel.bldPnu && S.sel.bldOk && S.d.bld) {
      return `<div class="gnote"><b>이 땅 위 건물은 ${esc(pnuJibun(S.sel.bldPnu))}번지에 대장이 등록되어 있습니다.</b><span>건물이 여러 필지에 걸쳐 있는 경우로, 건물 정보는 대표 필지에서 확인하실 수 있습니다.</span><button data-gp="${S.sel.bldPnu}">대표 필지 정보 보기</button></div>`;
    }
    return '';
  }

  // ---------- 브리핑 자료 (회원 베타) ----------
  function briefData(name) {
    const p = S.sel, c = chr(), rc = recap(), m = mainT(), pr = prices(), o = own();
    const lp = pr.length ? pr[pr.length - 1] : null;
    const ts = titles();
    const t = rc || m || null;
    const pk = t ? (t.pkTotal || (t.pkIn || 0) + (t.pkOut || 0) + (t.pkInMech || 0) + (t.pkOutMech || 0)) : null;
    const tr = S.d.trades && S.d.trades.rows ? S.d.trades.rows.filter(r => !r.cancel && r.price && !/Rent$/.test(r.kind)).slice(0, 4).map(r => ({ d: r.date, p: r.price, ex: r.ex || r.plottage || r.dealAr || null, f: r.floor || '', k: r.kind })) : [];
    return {
      v: 1, at: Date.now(),
      pnu: p.pnu, addr: p.addr || p.jibun, road: p.road || '', name: name || '', lat: p.c && p.c.lat, lng: p.c && p.c.lng,
      land: c ? { area: c.area, zone: c.zone1, zone2: c.zone2, jimok: c.jimok, use: c.landUse, road: c.road, shape: c.shape, height: c.height } : null,
      price: lp ? { year: lp.year, per: lp.price } : (c && c.price ? { year: c.year, per: c.price } : null),
      own: o ? { type: o.collective ? '구분소유' : o.type } : null,
      bld: t ? { use: (m && m.use) || '', etc: (m && m.etcUse) || '', strct: (m && m.strct) || '', grnd: m && m.grnd, ugrnd: m && m.ugrnd, height: m && m.height,
        tot: rc ? rc.totArea : ts.reduce((a, x) => a + (x.totArea || 0), 0), arch: t.archArea, plat: t.platArea, bc: t.bcRat, vl: t.vlRat,
        apr: (m && m.useApr) || '', pk, lift: m ? (m.liftP || 0) + (m.liftE || 0) : null, hhld: t.hhld, ho: t.ho, cnt: ts.length } : null,
      trades: tr,
    };
  }
  function briefOpen(name) {
    if (S.me.ready && !S.me.member) { loginModal('brief'); return; }
    if (!S.d.land || !S.d.bld) { toast('필지 정보를 불러오는 중입니다. 잠시 후 다시 눌러 주세요'); return; }
    try { localStorage.setItem('rm.brief', JSON.stringify(briefData(name))); } catch { toast('브라우저 저장 공간을 쓸 수 없어 브리핑을 열지 못했습니다'); return; }
    const w = window.open('/briefing.html', '_blank');
    if (!w) toast('팝업이 차단되었습니다. 브라우저에서 이 사이트의 팝업을 허용해 주세요');
  }

  // ---------- 회원 (카카오 로그인) ----------
  const FREE_LOC = 3;
  S.me = { member: false, ready: false };
  async function loadMe() {
    const q = new URLSearchParams(location.search), lg = q.get('login');
    if (lg) {
      q.delete('login'); history.replaceState(null, '', location.pathname + (q.toString() ? '?' + q : ''));
      setTimeout(() => toast(lg === 'ok' ? '로그인되었습니다. 입지정보를 계속 무료로 이용하실 수 있습니다' : lg === 'cancel' ? '로그인을 취소했습니다' : '로그인하지 못했습니다. 잠시 후 다시 시도해 주세요', 3600), 600);
    }
    try { S.me = await api('/api/auth?action=me'); } catch { /* 회원 기능 꺼짐 */ }
    try { if (S.me.op) localStorage.setItem('rm.op', '1'); } catch { /* 무시 */ }
    drawAcct();
    loadFavs();
  }
  const here = () => location.pathname + location.search;
  function drawAcct() {
    const el = $('acct'); if (!el) return;
    if (!S.me.ready) { el.innerHTML = ''; return; }
    el.innerHTML = S.me.member
      ? `<button type="button" id="acctBtn">${esc(S.me.nickname || '회원')}님${S.me.pro ? '<span class="probadge">PRO</span>' : ''}</button><div class="acct-menu" id="acctMenu" hidden>${S.me.pro ? '<a href="/listings.html" target="_blank" rel="noopener"><b>내 매물장</b></a>' : ''}<button type="button" id="favMenu">관심 부동산 · 우리 집</button><a href="/auth/logout?r=${encodeURIComponent(here())}">로그아웃</a><button type="button" id="withdraw">회원 탈퇴</button><a href="/privacy.html" target="_blank" rel="noopener">개인정보처리방침</a></div>`
      : `<button type="button" id="acctBtn">로그인</button>`;
    $('acctBtn').onclick = () => S.me.member ? ($('acctMenu').hidden = !$('acctMenu').hidden) : loginModal();
    if ($('favMenu')) $('favMenu').onclick = () => { $('acctMenu').hidden = true; openFavSheet(); };
    if ($('withdraw')) $('withdraw').onclick = async () => {
      if (!confirm('회원 탈퇴하시겠습니까? 저장된 회원 정보가 바로 삭제됩니다.')) return;
      try { await fetch('/api/auth?action=withdraw', { method: 'POST' }); } catch { /* 무시 */ }
      S.me = { ...S.me, member: false, nickname: '' }; drawAcct(); toast('탈퇴 처리되었습니다. 카카오 계정의 연결 해제는 카카오톡 설정 > 카카오계정 > 연결된 서비스 관리에서 하실 수 있습니다', 6000);
    };
  }
  function locCount() { try { return Number(localStorage.getItem('rm.loc') || 0); } catch { return 0; } }
  function locGate(name) {
    if (S.me.member || !S.me.ready) return locReport(name);
    const used = locCount();
    if (used < FREE_LOC) {
      try { localStorage.setItem('rm.loc', String(used + 1)); } catch { /* 무시 */ }
      locReport(name);
      const left = FREE_LOC - used - 1;
      toast(left > 0 ? `비회원 무료 이용 ${left}회 남았습니다` : '비회원 무료 이용을 모두 사용했습니다. 카카오 로그인 후 계속 무료로 이용하세요', 4000);
      return;
    }
    loginModal('loc');
  }
  const LOGIN_WHY = {
    join: '리얼맵 회원 기능, 모두 무료입니다',
    kapt: '평형별 관리비와 상세 내역은 회원 전용입니다',
    stores: '입점 업종 전체 목록은 회원 전용입니다',
    loc: '무료 이용 3회를 모두 사용하셨습니다',
    fav: '관심 부동산 저장은 회원 전용입니다',
    safe: '전세 안전 점검 전체 결과는 회원 전용입니다',
    trade: '3년·5년 실거래는 회원 전용입니다',
    brief: '브리핑 자료 만들기는 회원 전용입니다',
  };
  function loginModal(why) {
    const fromLoc = why;
    let m = $('loginModal');
    if (!m) { m = document.createElement('div'); m.id = 'loginModal'; m.className = 'lmodal'; document.body.appendChild(m); }
    m.hidden = false;
    m.innerHTML = `<div class="lbox" role="dialog" aria-modal="true" aria-labelledby="lmT">
      <button class="lx" type="button" aria-label="닫기">×</button>
      <img src="/favicon.svg" width="44" height="44" alt="">
      <h2 id="lmT">${LOGIN_WHY[why] || '리얼맵 로그인'}</h2>
      <p>카카오로 3초 만에 가입하시면 아래 기능을 <b>모두 무료로</b> 쓰실 수 있습니다.</p><ul class="lperks"><li>전세 안전 점검 전체 결과</li><li>관심 부동산 저장 · 우리 집 시세 카드</li><li>3년·5년 실거래와 가격 추이</li><li>입지정보 무제한 · 브리핑 자료 만들기</li></ul>
      <label class="lmk"><input type="checkbox" id="lmMk"> <span>(선택) 리얼맵의 부동산 소식·매물 정보 받기</span></label>
      <a class="kbtn" id="lmGo" href="#"><svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true"><path d="M9 2C4.6 2 1 4.8 1 8.2c0 2.2 1.5 4.1 3.7 5.2l-.9 3.4c-.1.3.3.5.5.3l4-2.7h.7c4.4 0 8-2.8 8-6.2S13.4 2 9 2z" fill="#191919"/></svg>카카오로 시작하기</a>
      <p class="lsmall">가입 시 카카오 회원번호와 닉네임을 받으며, 탈퇴하면 바로 삭제됩니다. <a href="/privacy.html" target="_blank" rel="noopener">개인정보처리방침</a></p>
    </div>`;
    const close = () => { m.hidden = true; };
    m.querySelector('.lx').onclick = close;
    m.onclick = e => { if (e.target === m) close(); };
    $('lmGo').onclick = e => { e.preventDefault(); location.href = `/auth/login?r=${encodeURIComponent(here())}${$('lmMk').checked ? '&mk=1' : ''}`; };
  }

  // 세 번째 필지를 볼 때 한 번만 보여 주는 가입 안내 (닫으면 다시 안 뜸)
  function joinNudge() {
    if (!S.me.ready || S.me.member) return;
    let n = 0, done = false;
    try { done = localStorage.getItem('rm.nudge') === '1'; n = +(localStorage.getItem('rm.pc') || 0) + 1; localStorage.setItem('rm.pc', String(n)); } catch { return; }
    if (done || n < 3) return;
    try { localStorage.setItem('rm.nudge', '1'); } catch { /* 무시 */ }
    setTimeout(() => {
      if (S.me.member || $('joinBar')) return;
      const b = document.createElement('div'); b.id = 'joinBar'; b.className = 'joinbar'; b.setAttribute('role', 'status');
      b.innerHTML = `<div class="jt"><b>관심 부동산 저장 · 우리 집 시세 · 5년 실거래</b><span>카카오로 3초 가입하면 모두 무료입니다</span></div><button type="button" class="jgo">무료 가입</button><button type="button" class="jx" aria-label="닫기">×</button>`;
      document.body.appendChild(b);
      requestAnimationFrame(() => b.classList.add('on'));
      const close = () => { b.classList.remove('on'); setTimeout(() => b.remove(), 300); };
      b.querySelector('.jx').onclick = close;
      b.querySelector('.jgo').onclick = () => { close(); loginModal('join'); };
      setTimeout(close, 15000); // 15초 뒤 저절로 사라짐
    }, 2500); // 정보를 먼저 보고 난 뒤에
  }

  // ---------- 관심 부동산 · 우리 집 ----------
  S.favs = { items: [], home: null };
  const isFav = pnu => S.favs.items.some(x => x.pnu === pnu);
  async function loadFavs() {
    if (!S.me.member) return;
    try { const j = await api('/api/auth?action=favs'); S.favs = { items: j.items || [], home: j.home || null }; } catch { /* 저장소 없음 */ }
    drawHomeCard(); if (S.sel) render();
  }
  async function favOp(op, item) {
    const r = await fetch('/api/auth?action=fav', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ op, item, pnu: item.pnu }) });
    const j = await r.json().catch(() => ({}));
    if (!j.ok) throw new Error(j.message || '저장하지 못했습니다');
    S.favs = { items: j.items || [], home: j.home || null };
  }
  function favItem(name) {
    const p = S.sel, ex = (() => { const rows = S.d.trades && S.d.trades.rows || []; const r = rows.find(x => x.ex); return r ? r.ex : null; })();
    return { pnu: p.pnu, addr: p.addr || p.jibun, name: name || '', lat: p.c && p.c.lat, lng: p.c && p.c.lng, kinds: S.d.bld ? tradeKinds() : [], area: ex };
  }
  function favBtns() {
    const p = S.sel; if (!p) return '';
    const on = isFav(p.pnu), home = S.favs.home === p.pnu;
    const star = `<svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.6l1.9 4 4.4.5-3.3 3 .9 4.3L8 11.2l-3.9 2.2.9-4.3-3.3-3 4.4-.5z" fill="${on ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>`;
    const lsBtn = S.me.pro ? `<a class="favbtn" href="/listings.html?add=${p.pnu}" target="_blank" rel="noopener"><svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2v12M2 8h12" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>매물 등록</a>` : '';
    return lsBtn + `<button class="favbtn${on ? ' on' : ''}" id="favBtn" type="button" aria-pressed="${on}" aria-label="${on ? '관심 부동산에서 빼기' : '관심 부동산으로 저장'}">${star}${on ? '저장됨' : '저장'}</button>`
      + (on ? `<button class="favbtn home${home ? ' on' : ''}" id="homeBtn" type="button" aria-pressed="${home}"><svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true"><path d="M2 7.5L8 2.5l6 5V14H10v-4H6v4H2z" fill="${home ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>${home ? '우리 집' : '우리 집으로'}</button>` : '');
  }
  async function toggleFav(name) {
    if (!S.me.member) return loginModal('fav');
    const p = S.sel;
    try {
      if (isFav(p.pnu)) { await favOp('del', { pnu: p.pnu }); toast('관심 부동산에서 뺐습니다'); }
      else { await favOp('add', favItem(name)); toast('관심 부동산에 저장했습니다. 오른쪽 위 내 이름을 눌러 언제든 다시 보실 수 있습니다', 3600); }
      render(); drawHomeCard();
    } catch (e) { toast(friendly(e)); }
  }
  async function toggleHome(name) {
    const p = S.sel;
    try {
      if (S.favs.home === p.pnu) { await favOp('unhome', { pnu: p.pnu }); toast("'우리 집' 지정을 해제했습니다"); }
      else { await favOp('home', favItem(name)); toast("'우리 집'으로 지정했습니다. 첫 화면에 시세 카드가 나옵니다", 3600); }
      render(); drawHomeCard();
    } catch (e) { toast(friendly(e)); }
  }
  // 우리 집 시세 요약 (최근 1년 실거래 기준)
  const med = a => { a = [...a].sort((x, y) => x - y); const m = a.length >> 1; return a.length ? (a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2) : null; };
  const homeCache = {};
  async function homeSummary(it) {
    if (homeCache[it.pnu]) return homeCache[it.pnu];
    const kinds = (it.kinds && it.kinds.length ? it.kinds : ['apt', 'aptRent']).join(',');
    const umd = String(it.addr || '').split(' ').slice(-2, -1)[0] || '';
    const q = new URLSearchParams({ pnu: it.pnu, kinds, months: 12, umd, name: it.name || '', area: '' });
    const j = await api('/api/trades?' + q);
    const rows = (j.rows || []).filter(r => !r.cancel);
    const sale = rows.filter(r => !/Rent$/.test(r.kind) && r.price);
    // 가장 거래가 많은 면적대 기준
    const g = {}; sale.forEach(r => { const k = r.ex ? Math.round(r.ex) : 0; (g[k] = g[k] || []).push(r); });
    const best = Object.entries(g).sort((a, b) => b[1].length - a[1].length)[0];
    const out = { count: sale.length, rent: rows.filter(r => /Rent$/.test(r.kind)).length };
    if (best) {
      const list = best[1].sort((a, b) => b.date.localeCompare(a.date));
      out.ex = +best[0] || null; out.last = list[0];
      const cut = d => { const t = new Date(Date.now() + 9 * 3600e3); t.setUTCMonth(t.getUTCMonth() - d); return `${t.getUTCFullYear()}.${String(t.getUTCMonth() + 1).padStart(2, '0')}`; };
      const recent = med(list.filter(r => r.date >= cut(4)).map(r => r.price)), older = med(list.filter(r => r.date < cut(6)).map(r => r.price));
      if (recent && older) out.chg = (recent / older - 1) * 100;
    }
    const R = jeonseRatio(rows); if (R) out.jr = R.r;
    return (homeCache[it.pnu] = out);
  }
  async function drawHomeCard(target) {
    const box = target || $('homeCard'); if (!box) return;
    if (!target && S.sel) { box.hidden = true; return; }
    const it = S.me.member && S.favs.home && S.favs.items.find(x => x.pnu === S.favs.home);
    if (!it) { box.hidden = true; box.innerHTML = ''; return; }
    box.hidden = false;
    box.innerHTML = `<div class="hc-top"><span class="hc-tag">우리 집</span><b>${esc(it.name || it.addr)}</b></div>${it.name ? `<div class="hc-sub">${esc(it.addr)}</div>` : '<div class="hc-sub"></div>'}<div class="hc-body">${skel()}</div>`;
    try {
      const m = await homeSummary(it);
      const body = box.querySelector('.hc-body'); if (!body) return;
      body.innerHTML = m.last ? `<div class="hc-price"><small>최근 거래${m.ex ? ` · 전용 ${m.ex}㎡` : ''}</small><b>${won(m.last.price)}</b><span>${esc(m.last.date)}${m.last.floor ? ` · ${esc(m.last.floor)}층` : ''}</span></div>
        <div class="hc-stats"><div><small>반년 전보다</small><b class="${m.chg == null ? '' : m.chg >= 0 ? 'up' : 'down'}">${m.chg == null ? '-' : Math.abs(m.chg) < 0.05 ? '변동 없음' : (m.chg >= 0 ? '▲ ' : '▼ ') + n(Math.abs(m.chg), 1) + '%'}</b></div><div><small>1년 매매</small><b>${m.count}건</b></div><div><small>전세가율</small><b>${m.jr ? n(m.jr, 0) + '%' : '-'}</b></div></div>`
        : '<p class="hc-empty">최근 1년 동안 이 필지에서 신고된 매매가 없습니다.</p>';
    } catch { const body = box.querySelector('.hc-body'); if (body) body.innerHTML = '<p class="hc-empty">시세를 불러오지 못했습니다.</p>'; }
    box.onclick = () => { closeFavSheet(); pickPnu(it.pnu); };
  }
  function openFavSheet() {
    let m = $('favSheet');
    if (!m) { m = document.createElement('div'); m.id = 'favSheet'; m.className = 'lmodal'; document.body.appendChild(m); }
    m.hidden = false;
    const items = S.favs.items;
    m.innerHTML = `<div class="lbox favbox" role="dialog" aria-modal="true" aria-labelledby="fvT"><button class="lx" type="button" aria-label="닫기">×</button>
      <h2 id="fvT">관심 부동산</h2>
      <div class="homecard" id="homeCard2" hidden></div>
      ${items.length ? `<ul class="favlist">${items.map(x => `<li><button type="button" class="fv-open" data-p="${x.pnu}"><b>${esc(x.name || x.addr)}</b><small>${esc(x.addr)}</small></button>
        <button type="button" class="fv-home${S.favs.home === x.pnu ? ' on' : ''}" data-h="${x.pnu}" aria-label="우리 집으로 지정">${S.favs.home === x.pnu ? '우리 집' : '우리 집으로'}</button><button type="button" class="fv-del" data-d="${x.pnu}" aria-label="삭제">×</button></li>`).join('')}</ul>`
        : '<p>아직 저장한 부동산이 없습니다. 필지를 누른 뒤 주소 옆 <b>☆ 저장</b>을 눌러 보세요.</p>'}</div>`;
    m.querySelector('.lx').onclick = closeFavSheet;
    m.onclick = e => { if (e.target === m) closeFavSheet(); };
    m.querySelectorAll('[data-p]').forEach(b => b.onclick = () => { closeFavSheet(); pickPnu(b.dataset.p); });
    m.querySelectorAll('[data-h]').forEach(b => b.onclick = async () => { const it = items.find(x => x.pnu === b.dataset.h); try { await favOp(S.favs.home === it.pnu ? 'unhome' : 'home', it); openFavSheet(); drawHomeCard(); if (S.sel) render(); } catch (e) { toast(friendly(e)); } });
    m.querySelectorAll('[data-d]').forEach(b => b.onclick = async () => { try { await favOp('del', { pnu: b.dataset.d }); openFavSheet(); drawHomeCard(); if (S.sel) render(); } catch (e) { toast(friendly(e)); } });
    drawHomeCard($('homeCard2'));
  }
  function closeFavSheet() { const m = $('favSheet'); if (m) m.hidden = true; }

  // ---------- 전세 안전 점검 ----------
  function isHome() { const u = uses(); return !!titles().length && (/주택|아파트|다세대|연립|오피스텔|기숙사/.test(u) || isCollective()); }
  function safeItems(T) {
    const rows = (T && T.rows) || [], ts = titles(), m = mainT();
    const out = [];
    const R = jeonseRatio(rows);
    out.push({ k: '전세가율', lv: !R ? 'na' : R.r >= 80 ? 'bad' : R.r >= 70 ? 'warn' : 'ok',
      t: R ? `${n(R.r, 0)}% · 전용 ${R.ex}㎡ 기준 매매 ${won(R.s)} / 전세 ${won(R.j)}` : '최근 매매·전세 거래가 부족해 계산할 수 없습니다.',
      d: R && R.r >= 80 ? '매매가와 전세가 차이가 작아 집값이 조금만 내려도 보증금을 돌려받기 어려울 수 있습니다.' : R && R.r >= 70 ? '다소 높은 편입니다. 선순위 근저당과 보증금 규모를 꼭 확인하세요.' : '' });
    const vio = ts.map(t => String(t.viol ?? '').trim()).filter(Boolean);
    const vioBad = vio.some(v => /^(1|Y|y|위반)/.test(v));
    out.push({ k: '위반건축물', lv: vioBad ? 'bad' : vio.length ? 'ok' : 'check',
      t: vioBad ? '건축물대장에 위반건축물로 표시되어 있습니다.' : vio.length ? '위반건축물 표시가 없습니다.' : '공공 API로는 확인되지 않습니다. 정부24에서 건축물대장을 무료로 떼어 \'위반건축물\' 표시를 확인하세요.',
      d: vioBad ? '전세대출과 전세보증보험 가입이 거절될 수 있습니다.' : '' });
    const geun = /근린생활/.test(uses()) && !/아파트/.test(uses());
    out.push({ k: '건물 용도', lv: geun ? 'warn' : 'ok', t: geun ? `주용도가 ${esc((m && m.use) || '근린생활시설')}입니다.` : `${esc((m && m.use) || '-')} · 주거용 건물입니다.`,
      d: geun ? '주택으로 쓰는 \'근생빌라\'라면 전세대출·보증보험이 제한될 수 있습니다.' : '' });
    const coll = collTitle();
    const hp = housePrice();
    if (!coll && hp) out.push({ k: '주택 공시가격', lv: 'check', t: `개별주택가격 ${wonW(hp.price)} (${hp.year}년)`,
      d: '다가구·단독주택은 전세보증보험 가입 한도를 이 공시가격으로 판단합니다. 보증금이 공시가격에 비해 높으면 가입이 어려울 수 있으니 보증기관에서 꼭 확인하세요.' });
    out.push({ k: '등기 형태', lv: coll ? 'ok' : 'warn', t: coll ? '집합건물이라 호수별로 등기됩니다.' : '다가구·단독 등 한 건물 단위로 등기됩니다.',
      d: coll ? '' : '한 건물에 세입자가 여럿일 수 있어 먼저 들어온 세입자들의 보증금 합계(선순위 보증금)를 꼭 확인하세요.' });
    const apr = m && m.useApr ? Number(String(m.useApr).slice(0, 4)) : null, age = apr ? new Date().getFullYear() - apr : null;
    out.push({ k: '건물 연식', lv: age == null ? 'na' : age >= 30 ? 'warn' : 'ok', t: age == null ? '사용승인일 정보가 없습니다.' : `${apr}년 사용승인 · ${age}년차`, d: age >= 30 ? '오래된 건물은 누수·결로 등 하자를 현장에서 꼭 확인하세요.' : '' });
    const yr = rows.filter(r => !r.cancel), sN = yr.filter(r => !/Rent$/.test(r.kind)).length, jN = yr.filter(r => /Rent$/.test(r.kind) && !r.rent).length;
    out.push({ k: '거래 활발도', lv: sN + jN < 3 ? 'warn' : 'ok', t: `최근 ${S.months / 12}년 매매 ${sN}건 · 전세 ${jN}건`, d: sN + jN < 3 ? '거래가 적어 시세를 판단하기 어렵습니다. 주변 비슷한 건물 시세도 함께 보세요.' : '' });
    // 매매가 흐름
    const sale = yr.filter(r => !/Rent$/.test(r.kind) && r.price && r.ex);
    const g = {}; sale.forEach(r => { const k = Math.round(r.ex); (g[k] = g[k] || []).push(r); });
    const best = Object.values(g).sort((a, b) => b.length - a.length)[0];
    let chg = null;
    if (best && best.length >= 3) {
      const ds = best.map(r => r.date).sort(), mid = ds[Math.floor(ds.length / 2)];
      const a = med(best.filter(r => r.date < mid).map(r => r.price)), b = med(best.filter(r => r.date >= mid).map(r => r.price));
      if (a && b) chg = (b / a - 1) * 100;
    }
    out.push({ k: '매매가 흐름', lv: chg == null ? 'na' : chg <= -10 ? 'warn' : 'ok', t: chg == null ? '비교할 매매 거래가 부족합니다.' : `최근 거래가 이전보다 ${chg >= 0 ? '+' : ''}${n(chg, 1)}%`, d: chg != null && chg <= -10 ? '매매가가 떨어지는 중이면 전세가율이 금방 높아질 수 있습니다.' : '' });
    return out;
  }
  const LV = { ok: ['양호', 'ok'], warn: ['주의', 'warn'], bad: ['위험', 'bad'], check: ['직접 확인', 'chk'], na: ['정보 부족', 'na'] };
  function safeSection(T) {
    if (!isHome() || !T || !T.kinds || !T.kinds.some(x => !x.sale)) return '';
    const items = safeItems(T);
    const cnt = k => items.filter(x => x.lv === k).length;
    const locked = S.me.ready && !S.me.member;
    const row = (x, blur) => `<li class="sf ${LV[x.lv][1]}${blur ? ' blur' : ''}"><span class="sf-lv">${LV[x.lv][0]}</span><div><b>${x.k}</b><p>${x.t}</p>${x.d ? `<small>${x.d}</small>` : ''}</div></li>`;
    const head = `<div class="sf-sum"><span class="bad">위험 ${cnt('bad')}</span><span class="warn">주의 ${cnt('warn')}</span><span class="ok">양호 ${cnt('ok')}</span>${cnt('check') ? `<span class="chk">직접 확인 ${cnt('check')}</span>` : ''}</div>`;
    const list = locked
      ? `<ul class="sflist">${row(items[0])}${items.slice(1).map(x => row(x, true)).join('')}</ul><div class="sf-lock"><b>나머지 ${items.length - 1}개 항목은 회원 전용입니다</b><button type="button" class="kbtn" id="safeLogin">카카오로 3초 가입하고 전체 보기</button></div>`
      : `<ul class="sflist">${items.map(x => row(x)).join('')}</ul>
        <div class="sf-todo"><b>계약 전 꼭 확인하세요</b><ol><li>등기사항전부증명서: 근저당·압류·가압류, 소유자 본인 여부</li><li>전입세대 열람: 먼저 살고 있는 세입자가 있는지</li><li>전세보증보험(HUG·HF) 가입이 가능한지</li><li>임대인의 국세·지방세 완납 증명</li></ol></div>`;
    return `<section class="safe" id="safe"><h2>전세 안전 점검<span>공공데이터 자동 분석</span></h2>${head}${list}<p class="note">공공데이터로 자동 분석한 참고용 결과입니다. 실제 계약 전에는 서류와 현장을 반드시 확인하세요.</p></section>`;
  }

  // ---------- 입지 정보 (중개대상물 확인·설명서 '입지조건' 참고) ----------
  const ROADW = [[/광대/, '폭 25m 이상 도로'], [/중로/, '폭 12m 이상 25m 미만 도로'], [/소로/, '폭 8m 이상 12m 미만 도로'], [/세로\s*\(?가\)?|세로가/, '폭 8m 미만 도로 (자동차 통행 가능)'], [/세로\s*\(?불\)?|세로불/, '폭 8m 미만 도로 (자동차 통행 불가)'], [/맹지/, '도로에 접하지 않음 (맹지)']];
  function roadText(r) {
    if (!r) return { w: '-', s: '' };
    const w = (ROADW.find(([re]) => re.test(r)) || [null, r])[1];
    const side = /각지/.test(r) ? '두 면 이상 도로에 접한 각지' : /한면/.test(r) ? '한 면이 도로에 접함' : /맹지/.test(r) ? '' : '';
    return { w, s: side };
  }
  const walkMin = d => Math.max(1, Math.round(d * 1.3 / 67));
  const carMin = d => Math.max(1, Math.round(d * 1.4 / 330 + 1));
  function placesQ(kind, q, c, radius) {
    const K = kakao.maps, P = K.services;
    return new Promise(ok => {
      const opt = { location: new K.LatLng(c.lat, c.lng), radius, sort: P.SortBy.DISTANCE };
      const cb = (r, st) => ok(st === P.Status.OK ? r.map(x => ({ name: x.place_name, cat: x.category_name || '', d: +x.distance, url: x.place_url })) : []);
      kind === 'cat' ? S.places.categorySearch(q, cb, opt) : S.places.keywordSearch(q, cb, opt);
    });
  }
  // 버스정류장: 공공데이터(서울시·국토부 정류소 정보)를 먼저 쓰고, 안 되면 카카오 장소 검색
  async function busStops(c) {
    try {
      const r = await fetch(`/api/stores?near=bus&lat=${c.lat.toFixed(5)}&lng=${c.lng.toFixed(5)}`).then(x => x.json());
      if (r.ok && r.bus && r.bus.length) return r.bus.map(x => ({ name: x.name + (x.no ? ` (${x.no})` : ''), cat: '버스정류장', d: x.d }));
      if (r.note) console.warn('[리얼맵] 버스정류장', r.note);
    } catch { /* 아래로 */ }
    const [a, b] = await Promise.all([placesQ('kw', '버스정류장', c, 1000), placesQ('kw', '정류장', c, 1000)]);
    const seen = new Set();
    return [...a, ...b].filter(x => /버스정류장|정류장/.test(x.cat + x.name) && !/택시|지하철|역$/.test(x.name)).sort((x, y) => x.d - y.d).filter(x => !seen.has(x.name) && seen.add(x.name));
  }
  async function locReport(bname) {
    const p = S.sel; if (!p || !p.c) return;
    const w = window.open('', '_blank');
    if (!w) { toast('팝업이 차단되었습니다. 브라우저에서 이 사이트의 팝업을 허용해 주세요'); return; }
    w.document.write('<!doctype html><meta charset="utf-8"><title>입지 정보</title><body style="font-family:sans-serif;padding:40px;color:#14212E">입지 정보를 정리하고 있습니다…</body>');
    const c = p.c;
    const school = kw => placesQ('kw', kw, c, 3000).then(r => r.filter(x => x.name.endsWith(kw) || x.name.includes(kw)).slice(0, 2));
    const BAD = ['화장장', '납골당', '봉안당', '공원묘지', '공동묘지', '쓰레기소각장', '자원회수시설', '쓰레기처리장', '음식물처리', '분뇨처리', '하수처리장', '물재생센터', '변전소', '교도소', '구치소'];
    // 종합병원: 병원 분류(HP8)는 가까운 의원부터 15곳만 돌려줘서 종합병원이 빠짐 → 이름으로 따로 찾음
    const hospQ = () => Promise.all(['종합병원', '대학병원', '의료원'].map(k => placesQ('kw', k, c, 5000)))
      .then(rs => { const seen = new Set(); return rs.flat().filter(x => (/종합병원|대학병원/.test(x.cat) || /대학교병원|대학병원|의료원/.test(x.name)) && !/장례식장|주차장|약국/.test(x.name + x.cat)).sort((a, b) => a.d - b.d).filter(x => !seen.has(x.name) && seen.add(x.name)); });
    const [subway, bus, ele, mid, high, mart, hosp, dept, ...bad] = await Promise.all([
      placesQ('cat', 'SW8', c, 3000),
      busStops(c),
      school('초등학교'), school('중학교'), school('고등학교'),
      placesQ('cat', 'MT1', c, 3000),
      hospQ(),
      placesQ('kw', '백화점', c, 3000).then(r => r.filter(x => /백화점/.test(x.cat) && !/주차장|식당|카페/.test(x.name))),
      ...BAD.map(k => placesQ('kw', k, c, 1000).then(r => r.filter(x => x.d <= 1000 && (x.name.includes(k) || x.cat.includes(k))))),
    ]);
    const badList = []; const seen = new Set();
    bad.flat().sort((a, b) => a.d - b.d).forEach(x => { if (!seen.has(x.name)) { seen.add(x.name); badList.push(x); } });
    const ch = chr(), rd = roadText(ch && ch.road);
    const row = (label, x, note) => x ? `<tr><th>${label}</th><td><b>${esc(x.name)}</b>${note ? `<small>${note}</small>` : ''}</td><td class="n">${n(x.d)}m</td><td class="n">도보 약 ${walkMin(x.d)}분</td><td class="n">차량 약 ${carMin(x.d)}분</td></tr>`
      : `<tr><th>${label}</th><td colspan="4" class="none">반경 안에서 찾지 못했습니다</td></tr>`;
    const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10).replace(/-/g, '.');
    const html = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>입지 정보 · ${esc(p.addr || p.jibun)}</title>
<link rel="icon" href="/favicon.svg"><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+KR:wght@400;600;700&display=swap">
<style>
*{box-sizing:border-box}body{margin:0;background:#EEF1F4;font-family:"IBM Plex Sans KR","Apple SD Gothic Neo","Malgun Gothic",sans-serif;color:#14212E}
.page{max-width:820px;margin:24px auto;background:#fff;padding:36px 40px;border-radius:12px}
header{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;border-bottom:2px solid #14212E;padding-bottom:14px}
h1{margin:0;font-size:22px;letter-spacing:-.02em}header p{margin:4px 0 0;color:#5E6A77;font-size:13px}
.brand{display:flex;align-items:center;gap:6px;font-weight:700;font-size:14px;white-space:nowrap}
h2{font-size:15px;margin:26px 0 8px;padding-left:8px;border-left:4px solid #F2B705}
table{width:100%;border-collapse:collapse;font-size:13.5px}th,td{border:1px solid #DCE2E8;padding:8px 10px;text-align:left;vertical-align:top}
th{background:#F5F7F9;width:118px;font-weight:600}td.n{white-space:nowrap;text-align:right;font-variant-numeric:tabular-nums}td small{display:block;color:#5E6A77;font-size:12px;margin-top:2px}
td.none{color:#8A949E}.ok{color:#1F7A3A;font-weight:700}.warn{color:#B4231A;font-weight:700}
.note{font-size:12px;color:#5E6A77;line-height:1.6;margin-top:22px;border-top:1px solid #DCE2E8;padding-top:12px}
.bar{max-width:820px;margin:16px auto 0;display:flex;justify-content:flex-end;gap:8px}.bar button{border:0;border-radius:999px;padding:9px 18px;font:inherit;font-weight:600;cursor:pointer;background:#14212E;color:#fff}
@media print{body{background:#fff}.page{margin:0;padding:0;border-radius:0}.bar{display:none}}
@media (max-width:640px){.page{padding:22px 16px;margin:0;border-radius:0}td.n{white-space:normal}}
</style></head><body>
<div class="bar"><button onclick="print()">인쇄 · PDF 저장</button></div>
<div class="page">
<header><div><h1>${esc(p.addr || p.jibun)}</h1><p>${p.road ? esc(p.road) + ' · ' : ''}${bname ? esc(bname) + ' · ' : ''}${today} 기준</p></div>
<div class="brand"><img src="/favicon.svg" width="22" height="22" alt="">리얼맵</div></header>

<h2>도로와의 관계</h2>
<table><tr><th>접면 도로</th><td>${esc(rd.w)}${rd.s ? `<small>${esc(rd.s)}</small>` : ''}${ch && ch.road ? `<small>토지특성 표기: ${esc(ch.road)}</small>` : ''}</td></tr>
<tr><th>지형</th><td>${esc((ch && ch.height) || '-')} · ${esc((ch && ch.shape) || '-')}</td></tr></table>

<h2>대중교통</h2>
<table>${row('지하철역', subway[0], subway[1] ? `다음 가까운 역: ${esc(subway[1].name)} ${n(subway[1].d)}m` : '')}${row('버스정류장', bus[0], bus.length > 1 ? `반경 1km 안 정류장 ${bus.length}곳` : '')}</table>

<h2>교육시설</h2>
<table>${row('초등학교', ele[0])}${row('중학교', mid[0])}${row('고등학교', high[0])}</table>

<h2>판매 · 의료시설</h2>
<table>${row('대형마트', mart[0])}${dept[0] ? row('백화점', dept[0]) : ''}${row('종합병원', hosp[0], hosp[1] ? `다음 가까운 곳: ${esc(hosp[1].name)} ${n(hosp[1].d)}m` : '')}</table>

<h2>비선호시설 <small style="font-weight:400;color:#5E6A77">(반경 1km)</small></h2>
<table><tr><th>유무</th><td>${badList.length ? `<span class="warn">있음</span> · ${badList.length}곳` : '<span class="ok">없음</span> <small>지도 검색으로 찾은 시설이 없습니다</small>'}</td></tr>
${badList.map(x => `<tr><th>${esc(x.cat.split('>').pop().trim() || '시설')}</th><td>${esc(x.name)}<small>직선 ${n(x.d)}m</small></td></tr>`).join('')}</table>

<p class="note">· 거리는 필지 중심에서 시설까지의 직선거리이며, 도보·차량 시간은 실제 길을 고려해 직선거리에 여유를 더해 추정한 값입니다.<br>
· 학교는 가장 가까운 곳을 표시했으며, 실제 배정 학교는 교육청 학구도로 확인해 주세요.<br>
· 비선호시설(화장장·납골당·묘지·쓰레기처리시설·하수처리장·변전소 등)은 카카오 지도 검색 결과 기준이므로 현장 확인이 필요합니다.<br>
· 도로 폭은 토지특성의 도로접면 구분에 따른 범위입니다. 정확한 폭은 지적도와 현장에서 확인해 주세요.<br>
· 출처: 카카오 지도, 국토교통부 토지특성정보 · 리얼맵 (realmap)</p>
</div></body></html>`;
    w.document.open(); w.document.write(html); w.document.close();
  }

  // ---------- 공유 · 상담 ----------
  function shareParcel(p, name) {
    const url = `${location.origin}/?pnu=${p.pnu}`;
    const title = `${p.addr || p.jibun}${name ? ' · ' + name : ''}`;
    if (navigator.share) { navigator.share({ title: `리얼맵 · ${title}`, text: `${title}\n로드뷰·토지·건물·실거래 한눈에 보기`, url }).catch(() => {}); return; }
    const done = () => toast('링크를 복사했습니다. 카카오톡 대화창에 붙여 넣어 주세요');
    if (navigator.clipboard) navigator.clipboard.writeText(`${title}\n${url}`).then(done, () => prompt('아래 링크를 복사해 주세요', url));
    else prompt('아래 링크를 복사해 주세요', url);
  }
  // 광고문의 안내 (모든 필지 패널 하단)
  const AD_MAIL = 'realwalkers@naver.com';
  function consultCard() {
    if (!S.sel) return '';
    const href = `mailto:${AD_MAIL}?subject=${encodeURIComponent('[리얼맵] 광고문의')}`;
    return `<div class="consult"><div><b>광고문의</b><span>리얼맵에 광고 게재를 원하시면 이메일로 문의해 주세요.</span></div>
      <a href="${href}"><svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true"><rect x="1.5" y="3" width="13" height="10" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M2 4l6 5 6-5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>${AD_MAIL}</a></div>`;
  }

  // ---------- 면적 합산 · 거리 재기 ----------
  const M = { on: false, mode: 'sum', parcels: [], pts: [], line: null, dots: [], tok: 0 };
  // 위경도 다각형 면적(㎡) — 필지 크기에서는 평면 근사로 충분
  function geoArea(g) {
    let total = 0;
    for (const poly of ringsOf(g)) poly.forEach((ring, k) => {
      if (ring.length < 3) return;
      const lat0 = ring[0][1] * Math.PI / 180, mx = 111320 * Math.cos(lat0), my = 110540;
      let a = 0;
      for (let i = 0; i < ring.length; i++) { const [x1, y1] = ring[i], [x2, y2] = ring[(i + 1) % ring.length]; a += (x1 * mx) * (y2 * my) - (x2 * mx) * (y1 * my); }
      total += (k === 0 ? 1 : -1) * Math.abs(a) / 2;
    });
    return total;
  }
  const distM = (a, b) => { const R = 6371000, r = Math.PI / 180, dLa = (b.lat - a.lat) * r, dLn = (b.lng - a.lng) * r; const h = Math.sin(dLa / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLn / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); };
  function measureInit() {
    $('mtMeasure').onclick = () => measureToggle(!M.on);
    $('msClose').onclick = () => measureToggle(false);
    $('msReset').onclick = () => { measureClear(); measureDraw(); };
    document.querySelectorAll('[data-ms]').forEach(b => b.onclick = () => { M.mode = b.dataset.ms; measureClear(); measureDraw(); });
  }
  function measureToggle(on) {
    M.on = on; $('mtMeasure').setAttribute('aria-pressed', on); $('measure').hidden = !on;
    if (!on) measureClear(); else { $('devpanel').hidden = true; $('tpanel').hidden = true; toast(M.mode === 'sum' ? '합산할 필지를 차례로 눌러 주세요' : '지도에서 지점을 차례로 눌러 주세요'); }
    measureDraw();
  }
  function measureClear() {
    M.tok++;
    M.parcels.forEach(p => p.shapes.forEach(o => o.setMap(null))); M.parcels = [];
    M.pts = []; if (M.line) M.line.setMap(null); M.line = null; M.dots.forEach(o => o.setMap(null)); M.dots = [];
  }
  async function measureClick(lat, lng) {
    const K = kakao.maps;
    if (M.mode === 'dist') {
      M.pts.push({ lat, lng });
      const path = M.pts.map(p => new K.LatLng(p.lat, p.lng));
      if (!M.line) M.line = new K.Polyline({ map: S.map, path, strokeWeight: 3, strokeColor: '#1971C2', strokeOpacity: .95 }); else M.line.setPath(path);
      let d = 0; for (let i = 1; i < M.pts.length; i++) d += distM(M.pts[i - 1], M.pts[i]);
      const el = document.createElement('div'); el.className = 'mdot'; el.textContent = M.pts.length === 1 ? '시작' : fmtDist(d);
      M.dots.push(new K.CustomOverlay({ map: S.map, position: path[path.length - 1], content: el, yAnchor: 1.4, zIndex: 4 }));
      return measureDraw();
    }
    const tok = M.tok;
    try {
      const p = await api(`/api/parcel?lat=${lat}&lng=${lng}`);
      if (tok !== M.tok) return;
      const had = M.parcels.findIndex(x => x.pnu === p.pnu);
      if (had >= 0) { M.parcels[had].shapes.forEach(o => o.setMap(null)); M.parcels.splice(had, 1); return measureDraw(); }
      const shapes = ringsOf(p.geometry).map(poly => new K.Polygon({ map: S.map, path: poly.map(r => r.map(([x, y]) => new K.LatLng(y, x))), strokeWeight: 2, strokeColor: '#1971C2', strokeOpacity: 1, fillColor: '#1971C2', fillOpacity: .22 }));
      const item = { pnu: p.pnu, jibun: String(p.jibun || '').replace(/[가-힣]+$/, ''), jimok: (String(p.jibun || '').match(/[가-힣]+$/) || [''])[0], geo: geoArea(p.geometry), area: null, shapes };
      M.parcels.push(item); measureDraw();
      // 토지대장 면적으로 바꿔 넣기
      api(`/api/land?pnu=${p.pnu}`).then(j => { const a = j.chr && j.chr.ok && j.chr.data && j.chr.data.area; if (a) { item.area = a; measureDraw(); } }).catch(() => {});
    } catch (e) { toast(friendly(e)); }
  }
  const fmtDist = d => d >= 1000 ? `${n(d / 1000, 2)}km` : `${n(d, 0)}m`;
  function measureDraw() {
    const box = $('msBody');
    document.querySelectorAll('[data-ms]').forEach(b => b.setAttribute('aria-pressed', b.dataset.ms === M.mode));
    if (!M.on) return;
    if (M.mode === 'dist') {
      let d = 0; for (let i = 1; i < M.pts.length; i++) d += distM(M.pts[i - 1], M.pts[i]);
      box.innerHTML = M.pts.length < 2 ? '<p class="ms-hint">지도에서 시작점과 다음 지점을 차례로 눌러 주세요.</p>'
        : `<div class="ms-total"><b>${fmtDist(d)}</b><span>도보 약 ${Math.max(1, Math.round(d / 67))}분 · ${M.pts.length}개 지점</span></div>`;
      return;
    }
    if (!M.parcels.length) { box.innerHTML = '<p class="ms-hint">합산할 필지를 지도에서 차례로 눌러 주세요. 다시 누르면 빠집니다.</p>'; return; }
    const sum = M.parcels.reduce((s, x) => s + (x.area ?? x.geo), 0);
    const approx = M.parcels.some(x => x.area == null);
    box.innerHTML = `<div class="ms-total"><b>${n(sum, 2)}㎡</b><span>${n(toPy(sum), 2)}평 · ${M.parcels.length}필지${approx ? ' · 일부 도면 기준' : ''}</span></div>
      <ul class="ms-list">${M.parcels.map(x => `<li><span>${esc(x.jibun)}<small>${esc(x.jimok)}</small></span><span>${n(x.area ?? x.geo, 1)}㎡${x.area == null ? '<small>도면</small>' : ''}</span></li>`).join('')}</ul>
      <p class="ms-hint">면적은 토지대장 기준이며, 불러오기 전에는 지도 도면으로 계산한 근삿값을 보여 드립니다.</p>`;
  }

  // ---------- 지도 위 실거래가 라벨 ----------
  // 화면 중심·모서리가 속한 시군구의 최근 6개월 매매를 건물별 최신 거래가로 표시합니다 (아파트·빌라·오피스텔).
  const TK = { apt: '아파트', rh: '빌라', offi: '오피스텔' };
  const T = { on: true, kinds: { apt: true, rh: true, offi: true }, regions: new Map(), ovs: new Map(), geoQ: [], geoBusy: 0, hinted: false, dong: '', found: {}, flushT: 0 };
  const MAXLV = 5;
  const eok = man => { if (man >= 10000) { const e = man / 10000; const d = e >= 10 ? 10 : 100; return `${String(Math.round(e * d) / d)}억`; } return `${n(man)}만`; };
  function tSave() { try { localStorage.setItem('rm.trade2', JSON.stringify({ on: T.on, kinds: T.kinds })); } catch { /* 저장소 없음 */ } }
  function tradeMapInit() {
    try { const v = JSON.parse(localStorage.getItem('rm.trade2') || 'null'); if (v) { T.on = !!v.on; Object.assign(T.kinds, v.kinds || {}); } } catch { /* 저장소 없음 */ }
    const boxes = [...document.querySelectorAll('[data-tk]')];
    boxes.forEach(cb => { cb.checked = !!T.kinds[cb.dataset.tk]; cb.onchange = () => { T.kinds[cb.dataset.tk] = cb.checked; tSave(); tradeRefresh(); }; });
    const setOn = on => { T.on = on; $('mtTrade').setAttribute('aria-pressed', on); tSave(); };
    setOn(T.on);
    // 실거래 버튼: 꺼져 있으면 켜고 선택 창 열기 → 켜져 있고 창이 닫혀 있으면 창 열기 → 창이 열려 있으면 끄기
    $('mtTrade').onclick = () => {
      if (!T.on) { setOn(true); openTPanel(); if (S.map.getLevel() > MAXLV) toast('조금 더 확대하면 실거래가가 보입니다'); }
      else if ($('tpanel').hidden) openTPanel();
      else { setOn(false); $('tpanel').hidden = true; }
      tradeRefresh();
    };
    $('tClose').onclick = () => { $('tpanel').hidden = true; };
    kakao.maps.event.addListener(S.map, 'idle', tradeRefresh);
    tradeRefresh();
  }
  function openTPanel() { $('devpanel').hidden = true; $('tpanel').hidden = false; }
  function regionAt(lat, lng) {
    return new Promise(ok => S.geocoder.coord2RegionCode(lng, lat, (r, st) => {
      if (st !== kakao.maps.services.Status.OK) return ok(null);
      const b = r.find(x => x.region_type === 'B') || r[0];
      ok(b ? { lawd: String(b.code).slice(0, 5), name: `${b.region_1depth_name} ${b.region_2depth_name}`.trim(), dong: b.region_3depth_name || '' } : null);
    }));
  }
  function loadRegion(kind, rg) {
    const key = `${kind}:${rg.lawd}`;
    let e = T.regions.get(key);
    if (e) return e.p;
    e = { kind, items: null };
    e.p = api(`/api/aptmap?kind=${kind}&lawd=${rg.lawd}&r=${encodeURIComponent(rg.name)}`).then(j => {
      // 서버가 요청한 종류의 자료를 돌려줬는지 확인 (예전 서버 파일이면 모든 종류에 아파트 자료가 와서 겹쳐 보입니다)
      if ((j.kind || 'apt') !== kind) { console.warn('api/aptmap.js 파일이 최신이 아닙니다'); e.items = []; return []; }
      e.items = j.items.map((x, i) => ({ ...x, k: kind, id: `${key}:${i}`, lawd: rg.lawd }));
      e.items.filter(x => x.lat == null).forEach(x => T.geoQ.push(x));
      geoSort(); geoNext();
      return e.items;
    }).catch(() => { T.regions.delete(key); return []; });
    T.regions.set(key, e);
    return e.p;
  }
  // 서버에서 좌표를 못 찾은 건물은 카카오 주소 검색으로 보충 (한 번 찾은 좌표는 이 브라우저에 기억하고, 서버 좌표장에도 보탬)
  // 지금 보고 있는 동(洞)의 건물부터, 한 번에 4곳씩 찾습니다.
  function geoSort() {
    if (!T.dong) return;
    const near = x => (x.a || '').includes(` ${T.dong} `) ? 0 : 1;
    T.geoQ.sort((a, z) => near(a) - near(z) || z.c - a.c);
  }
  function geoNext() {
    while (T.geoBusy < 4) {
      const x = T.geoQ.shift();
      if (!x) { if (!T.geoBusy) { drawTrades(); geoFlush(); } return; }
      let memo = null; try { memo = JSON.parse(localStorage.getItem('rm.g:' + x.a) || 'null'); } catch { /* 없음 */ }
      if (memo) { x.lat = memo[0]; x.lng = memo[1]; geoKeep(x); continue; }
      T.geoBusy++;
      S.geocoder.addressSearch(x.a, (r, st) => {
        T.geoBusy--;
        if (st === kakao.maps.services.Status.OK && r[0]) {
          x.lat = +r[0].y; x.lng = +r[0].x;
          try { localStorage.setItem('rm.g:' + x.a, JSON.stringify([x.lat, x.lng])); } catch { /* 저장 실패 무시 */ }
          geoKeep(x);
        } else x.lat = false;
        if (T.geoQ.length % 8 === 0) drawTrades();
        geoNext();
      });
    }
  }
  // 찾은 좌표를 모아 두었다가 서버 좌표장에 한꺼번에 보냄 (다음 방문자는 바로 보이도록)
  function geoKeep(x) {
    if (!x.lawd || !x.a) return;
    (T.found[x.lawd] = T.found[x.lawd] || []).push([x.a, x.lat, x.lng]);
    if (T.found[x.lawd].length >= 40) geoFlush();
    else { clearTimeout(T.flushT); T.flushT = setTimeout(geoFlush, 4000); }
  }
  function geoFlush() {
    clearTimeout(T.flushT);
    for (const [lawd, pts] of Object.entries(T.found)) {
      if (!pts.length) continue;
      T.found[lawd] = [];
      for (let i = 0; i < pts.length; i += 60)
        fetch('/api/aptmap', { method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lawd, pts: pts.slice(i, i + 60) }) }).catch(() => { /* 보태기 실패는 무시 */ });
    }
  }
  const tActive = () => T.on && S.map.getLevel() <= MAXLV && Object.values(T.kinds).some(Boolean);
  async function tradeRefresh() {
    if (!tActive()) { T.ovs.forEach(o => o.setMap(null)); return; }
    const b = S.map.getBounds(), sw = b.getSouthWest(), ne = b.getNorthEast(), c = S.map.getCenter();
    const pts = [[c.getLat(), c.getLng()], [sw.getLat(), sw.getLng()], [ne.getLat(), ne.getLng()], [sw.getLat(), ne.getLng()], [ne.getLat(), sw.getLng()]];
    const rgs = (await Promise.all(pts.map(([la, ln]) => regionAt(la, ln)))).filter(Boolean);
    if (rgs[0] && rgs[0].dong && rgs[0].dong !== T.dong) { T.dong = rgs[0].dong; geoSort(); }
    const seen = new Set(), uniq = rgs.filter(r => !seen.has(r.lawd) && seen.add(r.lawd));
    drawTrades();
    const jobs = [];
    for (const k of Object.keys(TK)) if (T.kinds[k]) for (const rg of uniq) jobs.push(loadRegion(k, rg).then(drawTrades));
    await Promise.all(jobs);
    drawTrades();
    if (!T.hinted) { T.hinted = true; toast('지도 위 가격은 최근 6개월 실거래가입니다'); }
  }
  function drawTrades() {
    const K = kakao.maps;
    if (!tActive()) { T.ovs.forEach(o => o.setMap(null)); return; }
    const b = S.map.getBounds(), proj = S.map.getProjection();
    const all = [];
    T.regions.forEach(e => { if (e.items && T.kinds[e.kind]) for (const x of e.items) if (x.lat && x.lng) all.push(x); });
    // 거래가 많은 건물부터 자리 잡고, 겹치는 라벨은 숨김
    all.sort((a, z) => z.c - a.c || z.d.localeCompare(a.d));
    const placed = [], show = new Set();
    for (const x of all) {
      const ll = new K.LatLng(x.lat, x.lng);
      if (!b.contain(ll)) continue;
      const pt = proj.containerPointFromCoords(ll);
      if (placed.some(q => Math.abs(q.x - pt.x) < 64 && Math.abs(q.y - pt.y) < 36)) continue;
      placed.push(pt); show.add(x.id);
      let o = T.ovs.get(x.id);
      if (!o) {
        const el = document.createElement('button');
        el.type = 'button'; el.className = `tlabel k-${x.k}`;
        el.title = `[${TK[x.k]}] ${x.n || ''} · 최근 6개월 매매 ${x.c}건\n최근 거래 ${ymd(x.d)} · 전용 ${n(x.ar, 2)}㎡ · ${x.f}층 · ${won(x.p)}`;
        el.innerHTML = `<b>${eok(x.p)}</b><small>${x.ar ? Math.round(x.ar) + '㎡' : ''} · ${x.d.slice(2, 4)}.${x.d.slice(4, 6)}</small>`;
        el.onclick = ev => { ev.stopPropagation(); pick(x.lat, x.lng); };
        o = new K.CustomOverlay({ position: ll, content: el, yAnchor: 1.15, zIndex: 3, clickable: true });
        T.ovs.set(x.id, o);
      }
      if (!o.getMap()) o.setMap(S.map);
    }
    T.ovs.forEach((o, id) => { if (!show.has(id) && o.getMap()) o.setMap(null); });
  }

  // ---------- 검색 ----------
  function wireSearch() {
    const q = $('q'), sg = $('sugg'); let timer;
    const K = kakao.maps;
    q.addEventListener('input', () => {
      clearTimeout(timer);
      const v = q.value.trim();
      if (v.length < 2) { sg.hidden = true; return; }
      timer = setTimeout(() => {
        const results = [];
        let pending = 2;
        const done = () => {
          if (--pending) return;
          const seen = new Set();
          const list = results.filter(r => { const k = r.lat.toFixed(5) + r.lng.toFixed(5); if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 8);
          sg.innerHTML = list.length ? list.map((r, i) => `<button data-i="${i}">${esc(r.title)}<small>${esc(r.sub)}</small></button>`).join('') : '<div class="none">검색 결과가 없습니다</div>';
          sg.hidden = false;
          sg.querySelectorAll('[data-i]').forEach(b => b.onclick = () => {
            const r = list[+b.dataset.i]; sg.hidden = true; q.blur();
            const ll = new K.LatLng(r.lat, r.lng); S.map.setLevel(2); S.map.setCenter(ll);
            pick(r.lat, r.lng);
          });
        };
        S.geocoder.addressSearch(v, (res, st) => {
          if (st === K.services.Status.OK) res.forEach(r => results.push({ title: r.address_name, sub: r.road_address ? r.road_address.address_name : '지번 주소', lat: +r.y, lng: +r.x }));
          done();
        });
        S.places.keywordSearch(v, (res, st) => {
          if (st === K.services.Status.OK) res.slice(0, 6).forEach(r => results.push({ title: r.place_name, sub: r.road_address_name || r.address_name, lat: +r.y, lng: +r.x }));
          done();
        });
      }, 250);
    });
    q.addEventListener('keydown', e => { if (e.key === 'Enter') { const b = sg.querySelector('[data-i]'); if (b) b.click(); } if (e.key === 'Escape') sg.hidden = true; });
    document.addEventListener('pointerdown', e => { if (!e.target.closest('.search')) sg.hidden = true; if (!e.target.closest('#acct') && $('acctMenu')) $('acctMenu').hidden = true; });
  }
})();
