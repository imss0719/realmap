/* 리얼맵 화면 스크립트
   지도(카카오) → 필지 선택(브이월드 연속지적도) → 패널에 토지·이용계획·건물·호별·실거래 표시 */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const PY = 3.305785;
  const S = {
    cfg: null, map: null, rv: null, rvc: null, geocoder: null, places: null, polys: [], marker: null,
    sel: null, tok: 0, d: {}, tab: 'land', unit: 'm2', tradeMode: 'sale', months: 12,
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
  const errBox = m => `<div class="err">${esc(m || '정보를 불러오지 못했습니다.')}</div>`;
  const src = a => `<p class="src">출처 · ${a.join(' · ')}</p>`;
  function toast(msg, ms = 2600) { const t = $('toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast.t); if (ms) toast.t = setTimeout(() => t.hidden = true, ms); }
  async function api(path) {
    const r = await fetch(path);
    let j; try { j = await r.json(); } catch { throw new Error(`서버 응답을 읽지 못했습니다 (${r.status})`); }
    if (!j.ok) { const e = new Error(j.message || '오류'); e.code = j.error; throw e; }
    return j;
  }
  const mobile = () => matchMedia('(max-width:760px)').matches;

  // ---------- 시작 ----------
  init();
  async function init() {
    try { S.cfg = await api('/api/config'); } catch (e) { return setup(`설정을 불러오지 못했습니다. (${esc(e.message)})`); }
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
    S.map.addOverlayMapTypeId(K.MapTypeId.USE_DISTRICT);
    S.map.addControl(new K.ZoomControl(), K.ControlPosition.BOTTOMRIGHT);
    S.geocoder = new K.services.Geocoder();
    S.places = new K.services.Places();
    S.rvc = new K.RoadviewClient();
    K.event.addListener(S.map, 'click', e => pick(e.latLng.getLat(), e.latLng.getLng()));

    const setType = sky => { S.map.setMapTypeId(sky ? K.MapTypeId.HYBRID : K.MapTypeId.ROADMAP); $('mtRoad').setAttribute('aria-pressed', !sky); $('mtSky').setAttribute('aria-pressed', sky); };
    $('mtRoad').onclick = () => setType(false);
    $('mtSky').onclick = () => setType(true);
    $('mtCad').onclick = () => {
      const on = $('mtCad').getAttribute('aria-pressed') !== 'true';
      on ? S.map.addOverlayMapTypeId(K.MapTypeId.USE_DISTRICT) : S.map.removeOverlayMapTypeId(K.MapTypeId.USE_DISTRICT);
      $('mtCad').setAttribute('aria-pressed', on);
    };
    $('close').onclick = () => $('panel').classList.add('closed');
    if (mobile()) $('panel').classList.add('closed');
    wireSearch();

    const pnu = new URLSearchParams(location.search).get('pnu');
    if (pnu) pickPnu(pnu); else toast('필지를 누르면 정보가 열립니다');
  }

  // ---------- 필지 선택 ----------
  async function pick(lat, lng) {
    const tok = ++S.tok;
    toast('필지를 찾는 중입니다…', 0);
    try {
      const p = await api(`/api/parcel?lat=${lat}&lng=${lng}`);
      if (tok !== S.tok) return;
      select(p, tok);
    } catch (e) { if (tok === S.tok) toast(e.message); }
  }
  async function pickPnu(pnu) {
    const tok = ++S.tok;
    try {
      const p = await api(`/api/parcel?pnu=${encodeURIComponent(pnu)}`);
      if (tok !== S.tok) return;
      select(p, tok, true);
    } catch (e) { toast(e.message); }
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
    S.d = {}; S.bldIdx = 0; S.uDong = null; S.uHo = null; S.tradeMode = 'sale';
    if (S.tab === 'unit') S.tab = 'land';
    if (c && (pan || mobile())) {
      const ll = new K.LatLng(c.lat, c.lng);
      if (mobile()) { S.map.setCenter(ll); S.map.panBy(0, Math.round(innerHeight * 0.22)); } else S.map.panTo(ll);
    }
    history.replaceState(null, '', `?pnu=${p.pnu}`);
    // 법정동 이름: 주소의 마지막 동/리 단위
    const parts = String(p.addr || '').split(' ');
    S.sel.dongName = parts.length >= 2 ? parts[parts.length - 2] : '';
    $('intro').hidden = true;
    $('panel').classList.remove('closed');
    $('rvwrap').hidden = false;
    roadview(c);
    if (c) S.geocoder.coord2Address(c.lng, c.lat, (r, st) => {
      if (tok !== S.tok || st !== K.services.Status.OK || !r[0]) return;
      S.sel.road = r[0].road_address?.address_name || '';
      if (!S.sel.bname && r[0].road_address?.building_name) S.sel.bname = r[0].road_address.building_name;
      render();
    });
    render(); $('panel').scrollTop = 0;
    const pnu = p.pnu;
    api(`/api/land?pnu=${pnu}`).then(j => { if (tok === S.tok) { S.d.land = j; render(); } }).catch(e => { if (tok === S.tok) { S.d.land = { error: e.message }; render(); } });
    api(`/api/building?pnu=${pnu}`).then(j => { if (tok === S.tok) { S.d.bld = j; render(); } }).catch(e => { if (tok === S.tok) { S.d.bld = { error: e.message }; render(); } });
  }

  // ---------- 로드뷰 ----------
  function bearing(a, b) {
    const r = Math.PI / 180, y = Math.sin((b.lng - a.lng) * r) * Math.cos(b.lat * r);
    const x = Math.cos(a.lat * r) * Math.sin(b.lat * r) - Math.sin(a.lat * r) * Math.cos(b.lat * r) * Math.cos((b.lng - a.lng) * r);
    return (Math.atan2(y, x) / r + 360) % 360;
  }
  function roadview(c) {
    if (!c) return;
    const K = kakao.maps, pos = new K.LatLng(c.lat, c.lng);
    $('rvbig').href = `https://map.kakao.com/link/roadview/${c.lat},${c.lng}`;
    if (!S.rv) {
      S.rv = new K.Roadview($('rv'));
      K.event.addListener(S.rv, 'init', () => {
        const at = S.rv.getPosition(), tgt = S.rvTarget;
        if (at && tgt) S.rv.setViewpoint({ pan: bearing({ lat: at.getLat(), lng: at.getLng() }, tgt), tilt: 0, zoom: 0 });
      });
    }
    S.rvTarget = c;
    S.rvc.getNearestPanoId(pos, 60, id => {
      if (S.rvTarget !== c) return;
      if (id === null) { $('rvnone').hidden = false; return; }
      $('rvnone').hidden = true;
      S.rv.relayout();
      S.rv.setPanoId(id, pos);
    });
  }

  // ---------- 판단 도우미 ----------
  const titles = () => (S.d.bld && S.d.bld.titles && S.d.bld.titles.ok) ? S.d.bld.titles.data : [];
  const recap = () => (S.d.bld && S.d.bld.recap && S.d.bld.recap.ok && S.d.bld.recap.data[0]) || null;
  const mainT = () => titles().find(t => t.mainAtch === '주건축물') || titles()[0] || null;
  const chr = () => (S.d.land && S.d.land.chr && S.d.land.chr.ok && S.d.land.chr.data) || null;
  const own = () => (S.d.land && S.d.land.own && S.d.land.own.ok && S.d.land.own.data) || null;
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
    if (S.tab === 'unit' && !coll) S.tab = 'land';
    const tabs = [['land', '토지'], ['plan', '이용계획'], ['bld', '건물'], ...(coll ? [['unit', '동·호수']] : []), ['trade', '실거래']];
    const c = chr(), m = mainT(), rc = recap(), o = own(), pr = prices();
    const name = (rc && rc.name) || (m && m.name) || p.bname || '';
    const chips = [];
    if (c && c.zone1) chips.push(`<span class="chip z">${esc(c.zone1)}</span>`);
    if (c && c.jimok) chips.push(`<span class="chip">${esc(c.jimok)}</span>`);
    if (m && m.use) chips.push(`<span class="chip">${esc(m.use)}</span>`);
    if (m && m.useApr) chips.push(`<span class="chip">${esc(m.useApr.slice(0, 4))}년 사용승인</span>`);
    if (o && o.type && !o.collective && o.type !== '개인') chips.push(`<span class="chip">${esc(o.type)}</span>`);
    if (collTitle()) chips.push('<span class="chip">집합건물</span>');
    else if (collOwn()) chips.push('<span class="chip">구분소유 토지</span>');
    const latestP = pr.length ? pr[pr.length - 1] : null;
    const gfa = rc ? rc.totArea : titles().reduce((s, t) => s + (t.totArea || 0), 0) || null;
    const body = S.tab === 'land' ? landTab() : S.tab === 'plan' ? planTab() : S.tab === 'bld' ? bldTab() : S.tab === 'unit' ? unitTab() : tradeTab();
    const keepScroll = $('panel').scrollTop;
    D.innerHTML = `
    <div class="head">
      <h1>${esc(p.addr || p.jibun)}</h1>
      <div class="sub">${p.road ? esc(p.road) : ''}${name ? (p.road ? ' · ' : '') + esc(name) : ''}</div>
      <div class="chips">${chips.join('') || (S.d.land ? '' : '<span class="chip">불러오는 중…</span>')}</div>
    </div>
    <div class="sum">
      <div><div class="l">대지면적</div><div class="v">${c ? ar(c.area, 1)[0] : '-'}</div></div>
      <div><div class="l">연면적</div><div class="v">${gfa ? ar(gfa, 1)[0] : '-'}</div></div>
      <div><div class="l">공시지가</div><div class="v">${latestP ? per(latestP.price) : c && c.price ? per(c.price) : '-'}</div></div>
    </div>
    <div class="bar"><button class="pnu" id="pnuCopy" title="눌러서 복사">PNU ${esc(p.pnu)}</button>
      <span class="seg" role="group" aria-label="면적 단위"><button data-u="m2" aria-pressed="${S.unit === 'm2'}">㎡</button><button data-u="py" aria-pressed="${S.unit === 'py'}">평</button></span></div>
    <div class="tabs" role="tablist">${tabs.map(([k, l]) => `<button role="tab" data-t="${k}" aria-selected="${S.tab === k}">${l}</button>`).join('')}</div>
    <div class="body">${body}</div>`;
    $('panel').scrollTop = keepScroll;
    D.querySelectorAll('[data-u]').forEach(b => b.onclick = () => { S.unit = b.dataset.u; render(); });
    D.querySelectorAll('[data-t]').forEach(b => b.onclick = () => { S.tab = b.dataset.t; render(); });
    $('pnuCopy').onclick = () => { navigator.clipboard?.writeText(p.pnu).then(() => toast('PNU를 복사했습니다'), () => {}); };
    wireTab(D);
  }

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
    if (L.error) return errBox(L.error);
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
    } else out.push(L.chr && !L.chr.ok ? errBox('토지특성: ' + L.chr.message) : '<div class="empty">토지특성 정보가 없습니다.</div>');

    if (o) {
      const types = Object.entries(o.typeCounts || {}).map(([k, v]) => `${esc(k)} ${n(v)}`).join(' · ');
      out.push(`<section><h2>소유정보<span>토지소유정보 ${ymd(o.stdrYm)}</span></h2><dl class="kv">
        <dt>소유구분</dt><dd>${o.collective ? '구분소유 (집합건물)' : val(o.type)}${o.collective ? `<small>${types}</small>` : o.nation ? `<small>${esc(o.nation)}</small>` : ''}</dd>
        <dt>${o.collective ? '구분소유 호수' : '공유인수'}</dt><dd>${o.collective ? n(o.unitCount) + '개 호' : o.sharers > 1 ? n(o.sharers) + '인 공유' : '단독소유'}</dd>
        ${o.residence && !o.collective ? `<dt>거주지구분</dt><dd>${esc(o.residence)}</dd>` : ''}
        <dt>${o.collective ? '최근 소유권변동' : '소유권변동원인'}</dt><dd>${val(o.cause)}</dd>
        <dt>소유권변동일자</dt><dd>${ymd(o.date)}</dd>
      </dl><p class="note">소유자 성명·주소는 공개되지 않습니다. 정확한 권리관계는 등기사항전부증명서로 확인합니다.</p></section>`);
    } else if (L.own && !L.own.ok) out.push(errBox('소유정보: ' + L.own.message));

    if (pr.length) {
      const rows = [...pr].reverse().map((r, i, a) => { const pv = a[i + 1]; const cg = pv ? (r.price / pv.price - 1) * 100 : null;
        return `<tr><td class="c">${r.year}.01.01</td><td class="n">${per(r.price)}</td><td class="n">${cg == null ? '-' : (cg >= 0 ? '+' : '') + n(cg, 1) + '%'}</td></tr>`; }).join('');
      out.push(`<section><h2>개별공시지가</h2>${spark(pr)}<div class="tbl"><table><thead><tr><th>기준일</th><th class="n">공시지가</th><th class="n">변동률</th></tr></thead><tbody>${rows}</tbody></table></div></section>`);
    } else if (L.prices && !L.prices.ok) out.push(errBox('공시지가: ' + L.prices.message));

    out.push(src(['브이월드 토지특성·토지소유정보·개별공시지가']));
    return out.join('');
  }

  // 이용계획 탭
  const SEOUL = { '제1종전용주거지역': [50, 100], '제2종전용주거지역': [40, 120], '제1종일반주거지역': [60, 150], '제2종일반주거지역': [60, 200], '제3종일반주거지역': [50, 250], '준주거지역': [60, 400], '중심상업지역': [60, 1000], '일반상업지역': [60, 800], '근린상업지역': [60, 600], '유통상업지역': [60, 600], '전용공업지역': [60, 200], '일반공업지역': [60, 200], '준공업지역': [60, 400], '보전녹지지역': [20, 50], '생산녹지지역': [20, 50], '자연녹지지역': [20, 50] };
  function planTab() {
    const L = S.d.land;
    if (!L) return skel();
    if (L.error) return errBox(L.error);
    const out = [];
    if (L.use && L.use.ok) {
      const rows = L.use.data;
      const li = a => a.length ? a.map(x => `<li class="${/^UQA/.test(x.code) ? 'k' : ''}">${esc(x.name)}${x.rel && x.rel !== '포함' ? ` <em>(${esc(x.rel)})</em>` : ''}</li>`).join('') : '<li>해당 없음</li>';
      out.push(`<section><h2>토지이용계획<span>지역·지구등 지정여부</span></h2><div class="plan">
        <div class="g"><div class="t">「국토의 계획 및 이용에 관한 법률」에 따른 지역·지구등</div><ul>${li(rows.filter(r => r.law === 'k'))}</ul></div>
        <div class="g"><div class="t">다른 법령 등에 따른 지역·지구등</div><ul>${li(rows.filter(r => r.law === 'o'))}</ul></div>
      </div><p class="note">괄호 안 '저촉'은 일부가 걸쳐 있다는 뜻이고, '접함'은 경계에 붙어 있다는 뜻입니다.</p></section>`);
    } else out.push(errBox('토지이용계획: ' + (L.use && L.use.message)));

    const c = chr(), z = c && c.zone1 ? Object.keys(SEOUL).find(k => c.zone1.replace(/\s|\(.*\)/g, '').startsWith(k)) : null;
    if (c && z && String(S.sel.pnu).startsWith('11')) {
      const [bc, fa] = SEOUL[z], maxB = c.area * bc / 100, maxF = c.area * fa / 100;
      const t = recap() || mainT(), used = t ? (t.vlArea || 0) : 0, rest = Math.max(0, maxF - used);
      out.push(`<section><h2>건축 가능 규모<span>서울시 도시계획조례 기준</span></h2><dl class="kv">
        <dt>건폐율 상한</dt><dd>${bc}%</dd><dt>용적률 상한</dt><dd>${fa}%</dd>
        <dt>최대 건축면적</dt><dd>${arI(maxB)}</dd><dt>최대 지상 연면적</dt><dd>${arI(maxF)}</dd></dl>
        ${t && t.vlRat != null ? `<div class="meter-l" style="margin-top:10px"><span>현재 용적률 ${n(t.vlRat, 1)}%</span><span>상한 ${fa}%</span></div><div class="meter"><i style="width:${Math.min(100, t.vlRat / fa * 100)}%"></i></div><dl class="kv"><dt>잔여 연면적 (추정)</dt><dd>${rest > 1 ? arI(rest) : '여유 없음'}</dd></dl>` : ''}
        <p class="note">지구단위계획, 가로구역별 최고높이, 일조 사선제한, 주차 기준에 따라 실제 규모는 달라집니다. 신축 검토 시 토지이음에서 행위제한을 꼭 확인해 주세요.</p></section>`);
    } else if (c) out.push(`<div class="empty">건폐율·용적률 상한은 지자체 도시계획조례에 따라 다릅니다. 현재는 서울 기준만 자동 계산합니다.</div>`);
    out.push(`<p class="src">출처 · 브이월드 토지이용계획 · <a href="https://www.eum.go.kr/web/ar/lu/luLandDet.jsp?isNoScr=script&mode=search&pnu=${esc(S.sel.pnu)}" target="_blank" rel="noopener">토지이음에서 원문 보기</a></p>`);
    return out.join('');
  }

  // 건물 탭
  function bldTab() {
    const B = S.d.bld;
    if (!B) return skel();
    if (B.error) return errBox(B.error);
    if (B.titles && !B.titles.ok) return errBox('건축물대장: ' + B.titles.message);
    const ts = titles();
    if (!ts.length) return `<div class="empty">이 필지에 등록된 건축물대장이 없습니다.${chr() && /대/.test(chr().jimok || '') ? " 나대지라면 '이용계획' 탭에서 건축 가능 규모를 확인하실 수 있습니다." : ''}</div>${src(['건축HUB 건축물대장'])}`;
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
      ${ts.map(x => `<tr class="${x.mainAtch === '부속건축물' ? 'ex' : ''}"><td class="c">${esc(x.dong || x.name || '-')}</td><td>${esc(x.use || '-')}</td><td class="n">${x.ugrnd ? 'B' + x.ugrnd + '/' : ''}${n(x.grnd)}F</td><td class="n">${x.height ? n(x.height, 1) + 'm' : '-'}</td><td class="n">${ar(x.totArea, 0)[0]}</td></tr>`).join('')}
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
      ${rows.map(f => `<tr class="${f.excl ? 'ex' : ''}"><td class="c">${esc(f.noNm || ((f.gb || '') + (f.no || '')))}</td><td>${esc(f.use || '')}${f.etcUse && f.etcUse !== f.use ? `<small>${esc(f.etcUse)}</small>` : ''}${f.excl ? '<small>면적 제외</small>' : ''}</td><td class="n">${ar(f.area)[0]}</td></tr>`).join('')}
      </tbody></table></div></section>`);
    } else if (B.floors && !B.floors.ok) out.push(errBox('층별개요: ' + B.floors.message));
    out.push(src(['건축HUB 건축물대장 표제부·총괄표제부·층별개요']));
    return out.join('');
  }

  // 동·호수 탭
  function unitTab() {
    const U = S.d.units;
    if (!U) { loadUnits(); return skel(); }
    if (U.loading) return skel();
    if (U.error) return errBox(U.error);
    if (!U.units.length) return collTitle()
      ? '<div class="empty">이 건물은 집합건물로 등록되어 있지만 전유부(호별) 정보가 전산 대장에 없습니다. 오래된 건물은 호별 대장이 빠져 있는 경우가 있어, 세움터나 정부24 열람으로 확인해 주세요.</div>'
      : '<div class="empty">이 지번에는 호별 정보가 없습니다. 땅이 여러 호로 나뉘어 소유되어 있다면, 집합건물이 옆의 다른 지번(대표지번)에 등록되어 있을 수 있습니다. 주변 필지를 눌러 확인해 주세요.</div>';
    const dongs = [...new Set(U.units.map(u => (u.dong = String(u.dong || '').trim())))];
    if (S.uDong == null || !dongs.includes(S.uDong)) S.uDong = dongs[0];
    const hos = U.units.filter(u => u.dong === S.uDong);
    if (!S.uHo || !hos.find(h => h.ho === S.uHo)) { S.uHo = hos[Math.min(hos.length - 1, Math.floor(hos.length / 3))].ho; loadUnit(); }
    const out = [`<div class="pick">
      <label>동<select id="uDong">${dongs.map(d => `<option ${d === S.uDong ? 'selected' : ''}>${esc(d || '단일동')}</option>`).join('')}</select></label>
      <label>호수<select id="uHo">${hos.map(h => `<option ${h.ho === S.uHo ? 'selected' : ''}>${esc(h.ho)}</option>`).join('')}</select></label>
    </div><p class="note">이 건물에는 ${n(U.units.length)}개 호가 등록되어 있습니다.</p>`];
    const key = S.uDong + '|' + S.uHo, X = S.d.unit && S.d.unit[key];
    if (!X || X.loading) out.push(skel());
    else if (X.error) out.push(errBox(X.error));
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
      if (X.area && !X.area.ok) out.push(errBox('전유공용면적: ' + X.area.message));
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
    if (T.error) return errBox(T.error);
    const sale = T.rows.filter(r => !/Rent$/.test(r.kind)), rent = T.rows.filter(r => /Rent$/.test(r.kind));
    const hasRent = T.kinds.some(x => !x.sale);
    if (!hasRent) S.tradeMode = 'sale';
    const list = S.tradeMode === 'sale' ? sale : rent;
    const segM = hasRent ? `<span class="seg" role="group" aria-label="거래 구분"><button data-m="sale" aria-pressed="${S.tradeMode === 'sale'}">매매 ${sale.length}</button><button data-m="rent" aria-pressed="${S.tradeMode === 'rent'}">전월세 ${rent.length}</button></span>` : '';
    const segP = `<span class="seg" role="group" aria-label="기간">${[12, 36, 60].map(m => `<button data-mo="${m}" aria-pressed="${S.months === m}">${m / 12}년</button>`).join('')}</span>`;
    const items = list.slice(0, S.showAll ? 500 : 40).map(r => S.tradeMode === 'sale' ? saleRow(r) : rentRow(r)).join('');
    const out = [`<div class="ctl">${segM}${segP}</div>`];
    out.push(list.length ? `<ul class="trades">${items}</ul>${list.length > 40 && !S.showAll ? `<button class="more" id="moreT">${n(list.length - 40)}건 더 보기</button>` : ''}` : `<div class="empty">최근 ${S.months / 12}년 동안 이 필지에서 신고된 ${S.tradeMode === 'sale' ? '매매' : '전월세'} 거래가 없습니다.</div>`);
    if (T.errors && T.errors.length) out.push(errBox(T.errors.join(' / ')));
    out.push(`<p class="note">조회 범위: ${T.kinds.map(x => esc(x.label)).join(', ')}. 단독·다가구, 상업업무용, 토지 거래는 지번 일부가 가려져 공개되므로 면적이 일치하는 거래를 '추정'으로 표시합니다. 취소선은 계약 해제 건입니다.</p>`);
    out.push(src(['국토교통부 실거래가 공개시스템']));
    return out.join('');
  }
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
    try { const j = await api('/api/trades?' + q); if (tok === S.tok) { S.d.trades = { key, ...j }; render(); } }
    catch (e) { if (tok === S.tok) { S.d.trades = { key, error: e.message }; render(); } }
  }

  function wireTab(D) {
    const bs = D.querySelector('#bldSel'); if (bs) bs.onchange = () => { S.bldIdx = +bs.value; render(); };
    const ud = D.querySelector('#uDong'); if (ud) ud.onchange = () => { S.uDong = ud.value === '단일동' ? '' : ud.value; S.uHo = null; render(); };
    const uh = D.querySelector('#uHo'); if (uh) uh.onchange = () => { S.uHo = uh.value; loadUnit(); render(); };
    D.querySelectorAll('[data-m]').forEach(b => b.onclick = () => { S.tradeMode = b.dataset.m; render(); });
    D.querySelectorAll('[data-mo]').forEach(b => b.onclick = () => { S.months = +b.dataset.mo; render(); });
    const mt = D.querySelector('#moreT'); if (mt) mt.onclick = () => { S.showAll = true; render(); };
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
    document.addEventListener('pointerdown', e => { if (!e.target.closest('.search')) sg.hidden = true; });
  }
})();
