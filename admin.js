/* 리얼맵 개발정보 관리 화면 */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const TYPES = { '재개발': '#D9480F', '재건축': '#1971C2', '신속통합기획': '#7048E8', '모아타운': '#2F9E44', '가로주택·소규모': '#E67700', '역세권 개발': '#C2255C', '기타': '#495057' };
  const STAGES = ['후보지 선정', '정비계획 수립', '구역 지정', '추진위원회', '조합 설립', '사업시행인가', '관리처분인가', '이주·철거', '착공', '준공', '기타'];
  let KEY = '';
  try { KEY = sessionStorage.getItem('rm_admin') || ''; } catch {}
  const A = { map: null, zones: [], cur: null, mode: 'parcel', parcels: new Map(), shapes: [], drawPts: [], drawn: null, point: null, union: null };

  // ---------- 서버 ----------
  async function call(method, body) {
    const r = await fetch('/api/zones', { method, headers: { 'Content-Type': 'application/json', 'x-admin-key': KEY }, body: body ? JSON.stringify(body) : undefined });
    const j = await r.json().catch(() => ({ ok: false, message: `서버 응답 오류 (${r.status})` }));
    if (!j.ok) throw new Error(j.message || '오류');
    return j;
  }
  async function getJSON(u) { const r = await fetch(u); const j = await r.json(); if (!j.ok) throw new Error(j.message || '오류'); return j; }

  // ---------- 로그인 ----------
  $('loginForm').onsubmit = async e => {
    e.preventDefault();
    KEY = $('pw').value.trim();
    try { await call('POST', { action: 'ping' }); try { sessionStorage.setItem('rm_admin', KEY); } catch {} $('login').hidden = true; boot(); }
    catch (err) { const m = $('loginMsg'); m.textContent = err.message; m.hidden = false; }
  };
  if (KEY) call('POST', { action: 'ping' }).then(() => { $('login').hidden = true; boot(); }).catch(() => {});

  // ---------- 시작 ----------
  let booted = false;
  async function boot() {
    if (booted) return; booted = true;
    $('f_type').innerHTML = Object.keys(TYPES).map(t => `<option>${t}</option>`).join('');
    $('f_stage').innerHTML = STAGES.map(t => `<option>${t}</option>`).join('');
    const cfg = await getJSON('/api/config');
    const sc = document.createElement('script');
    sc.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${encodeURIComponent(cfg.kakaoKey)}&libraries=services&autoload=false`;
    sc.onload = () => kakao.maps.load(start);
    document.head.appendChild(sc);
  }
  function start() {
    const K = kakao.maps;
    A.map = new K.Map($('map'), { center: new K.LatLng(37.5563, 126.9236), level: 4 });
    A.map.addOverlayMapTypeId(K.MapTypeId.USE_DISTRICT);
    A.geocoder = new K.services.Geocoder();
    K.event.addListener(A.map, 'click', e => onMapClick(e.latLng));
    $('addrGo').onclick = goAddr;
    $('addr').onkeydown = e => { if (e.key === 'Enter') goAddr(); };
    $('newBtn').onclick = () => edit(null);
    $('cancelBtn').onclick = () => { $('zform').hidden = true; A.cur = null; clearShape(); renderList(); drawAll(); };
    $('clearShape').onclick = () => { clearShape(); info(); };
    $('drawDone').onclick = finishDraw;
    $('delBtn').onclick = del;
    $('zform').onsubmit = saveZone;
    document.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => setMode(b.dataset.mode));
    loadList();
  }
  function goAddr() {
    const q = $('addr').value.trim(); if (!q) return;
    A.geocoder.addressSearch(q, (r, st) => {
      if (st !== kakao.maps.services.Status.OK || !r[0]) return msg('주소를 찾지 못했습니다.', true);
      A.map.setLevel(3); A.map.setCenter(new kakao.maps.LatLng(+r[0].y, +r[0].x));
    });
  }

  // ---------- 목록 ----------
  async function loadList() {
    try { const j = await call('GET'); A.zones = j.zones || []; }
    catch (e) { A.zones = []; $('list').innerHTML = `<div class="msg err">${esc(e.message)}</div>`; return; }
    renderList(); drawAll();
  }
  function renderList() {
    $('list').innerHTML = A.zones.length ? A.zones.map(z => `<button type="button" class="item ${A.cur && A.cur.id === z.id ? 'on' : ''}" data-id="${esc(z.id)}"><i style="background:${TYPES[z.type] || '#495057'}"></i>${esc(z.name)}<small>${esc(z.stage || '')}${z.public === false ? ' · 비공개' : ''}</small></button>`).join('')
      : '<div class="hint">아직 등록한 구역이 없습니다. [+ 새 구역]을 눌러 시작하세요.</div>';
    document.querySelectorAll('.item').forEach(b => b.onclick = () => edit(A.zones.find(z => z.id === b.dataset.id)));
  }
  // 등록된 구역 전체를 옅게 표시
  let bg = [];
  function drawAll() {
    const K = kakao.maps;
    bg.forEach(o => o.setMap(null)); bg = [];
    for (const z of A.zones) {
      if (A.cur && A.cur.id === z.id) continue;
      const c = TYPES[z.type] || '#495057';
      if (z.geometry) for (const p of paths(z.geometry)) bg.push(new K.Polygon({ map: A.map, path: p, strokeWeight: 2, strokeColor: c, strokeOpacity: .6, fillColor: c, fillOpacity: .08 }));
      if (z.point) bg.push(new K.Marker({ map: A.map, position: new K.LatLng(z.point.lat, z.point.lng), title: z.name }));
    }
  }

  // ---------- 편집 ----------
  async function edit(z) {
    A.cur = z ? { ...z } : { id: '' };
    clearShape();
    $('zform').hidden = false;
    $('formTitle').textContent = z ? '구역 수정' : '새 구역';
    $('delBtn').hidden = !z;
    $('f_name').value = z?.name || ''; $('f_type').value = z?.type || '재개발'; $('f_stage').value = z?.stage || '구역 지정';
    $('f_date').value = z?.stageDate || ''; $('f_hh').value = z?.households || ''; $('f_builder').value = z?.builder || '';
    $('f_note').value = z?.note || ''; $('f_src').value = z?.source || ''; $('f_pub').checked = z ? z.public !== false : true;
    msg('');
    renderList(); drawAll();
    if (!z) { setMode('parcel'); return; }
    if (z.point && !z.geometry) { setMode('point'); setPoint(new kakao.maps.LatLng(z.point.lat, z.point.lng)); A.map.setCenter(new kakao.maps.LatLng(z.point.lat, z.point.lng)); return; }
    if (z.pnus && z.pnus.length) {
      setMode('parcel');
      info(`필지 ${z.pnus.length}개를 불러오는 중…`);
      let i = 0;
      const work = async () => { while (i < z.pnus.length) { const pnu = z.pnus[i++]; try { const p = await getJSON(`/api/parcel?pnu=${pnu}`); A.parcels.set(p.pnu, p); } catch {} } };
      await Promise.all([work(), work(), work(), work()]);
      redraw();
    } else if (z.geometry) {
      setMode('draw');
      A.drawn = z.geometry; redraw();
    }
    const c = z.geometry && turf.centroid(z.geometry).geometry.coordinates;
    if (c) A.map.setCenter(new kakao.maps.LatLng(c[1], c[0]));
  }
  function setMode(m) {
    A.mode = m;
    document.querySelectorAll('[data-mode]').forEach(b => b.setAttribute('aria-pressed', b.dataset.mode === m));
    $('drawDone').hidden = m !== 'draw';
    $('modeHint').textContent = m === 'parcel' ? '지도에서 구역에 들어가는 필지를 하나씩 누르세요. 다시 누르면 빠집니다. 고시문의 구역 경계도를 옆에 띄워 놓고 따라 누르시면 편합니다.'
      : m === 'draw' ? '구역 경계를 따라 지도를 차례로 누르세요. 다 찍었으면 [그리기 완료]를 누릅니다. 필지가 너무 많은 큰 구역에 편합니다.'
      : '경계가 아직 정해지지 않은 후보지는 위치만 찍어 두세요. 지도에서 한 곳을 누르면 됩니다.';
  }
  function clearShape() {
    A.parcels.clear(); A.drawPts = []; A.drawn = null; A.point = null; A.union = null;
    A.shapes.forEach(o => o.setMap(null)); A.shapes = [];
  }
  function info(t) {
    const g = A.union || A.drawn;
    $('shapeInfo').textContent = t || (g ? `구역 면적 약 ${Math.round(turf.area(g)).toLocaleString()}㎡ (${Math.round(turf.area(g) / 3.305785).toLocaleString()}평)${A.parcels.size ? ` · 필지 ${A.parcels.size}개` : ''}`
      : A.point ? '위치만 지정했습니다.' : A.drawPts.length ? `점 ${A.drawPts.length}개를 찍었습니다. 다 찍었으면 [그리기 완료]를 누르세요.` : '아직 지정한 구역이 없습니다.');
  }
  function paths(g) {
    const K = kakao.maps;
    const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
    return polys.map(p => p.map(r => r.map(([x, y]) => new K.LatLng(y, x))));
  }
  function redraw() {
    const K = kakao.maps, c = TYPES[$('f_type').value] || '#D9480F';
    A.shapes.forEach(o => o.setMap(null)); A.shapes = [];
    A.union = null;
    if (A.parcels.size) {
      const feats = [...A.parcels.values()].map(p => turf.feature(p.geometry));
      feats.forEach(f => paths(f.geometry).forEach(p => A.shapes.push(new K.Polygon({ map: A.map, path: p, strokeWeight: 1, strokeColor: c, strokeOpacity: .5, fillColor: c, fillOpacity: .25 }))));
      try { A.union = feats.length === 1 ? feats[0].geometry : turf.union(turf.featureCollection(feats)).geometry; }
      catch { A.union = turf.combine(turf.featureCollection(feats)).features[0].geometry; }
      paths(A.union).forEach(p => A.shapes.push(new K.Polygon({ map: A.map, path: p, strokeWeight: 3, strokeColor: c, strokeOpacity: 1, fillOpacity: 0 })));
    }
    if (A.drawn) paths(A.drawn).forEach(p => A.shapes.push(new K.Polygon({ map: A.map, path: p, strokeWeight: 3, strokeColor: c, fillColor: c, fillOpacity: .2 })));
    if (A.drawPts.length) A.shapes.push(new K.Polyline({ map: A.map, path: A.drawPts, strokeWeight: 3, strokeColor: c, strokeStyle: 'shortdash' }));
    if (A.point) A.shapes.push(new K.Marker({ map: A.map, position: A.point }));
    info();
  }
  $('f_type') && ($('f_type').onchange = () => redraw());

  async function onMapClick(ll) {
    if ($('zform').hidden) return;
    if (A.mode === 'point') return setPoint(ll);
    if (A.mode === 'draw') { if (A.drawn) { A.drawn = null; } A.drawPts.push(ll); return redraw(); }
    try {
      const p = await getJSON(`/api/parcel?lat=${ll.getLat()}&lng=${ll.getLng()}`);
      if (A.parcels.has(p.pnu)) A.parcels.delete(p.pnu); else A.parcels.set(p.pnu, p);
      A.drawn = null; A.point = null;
      redraw();
    } catch (e) { msg(e.message, true); }
  }
  function setPoint(ll) { A.parcels.clear(); A.drawn = null; A.drawPts = []; A.point = ll; redraw(); }
  function finishDraw() {
    if (A.drawPts.length < 3) return msg('점을 3개 이상 찍어 주세요.', true);
    const ring = A.drawPts.map(p => [p.getLng(), p.getLat()]); ring.push(ring[0]);
    A.drawn = { type: 'Polygon', coordinates: [ring] }; A.drawPts = []; A.parcels.clear(); A.point = null;
    redraw();
  }

  async function saveZone(e) {
    e.preventDefault();
    const geometry = A.union || A.drawn || null;
    const zone = {
      id: A.cur && A.cur.id, name: $('f_name').value, type: $('f_type').value, stage: $('f_stage').value, stageDate: $('f_date').value,
      households: $('f_hh').value, builder: $('f_builder').value, note: $('f_note').value, source: $('f_src').value, public: $('f_pub').checked,
      pnus: A.union ? [...A.parcels.keys()] : [], geometry, point: A.point ? { lat: A.point.getLat(), lng: A.point.getLng() } : null,
      area: geometry ? Math.round(turf.area(geometry)) : null,
    };
    try {
      const j = await call('POST', { action: 'save', zone });
      A.cur = j.zone; msg('저장했습니다. 리얼맵에는 1분 안에 반영됩니다.');
      $('formTitle').textContent = '구역 수정'; $('delBtn').hidden = false;
      await loadList();
    } catch (err) { msg(err.message, true); }
  }
  async function del() {
    if (!A.cur || !A.cur.id) return;
    if (!confirm(`'${A.cur.name}' 구역을 삭제할까요? 되돌릴 수 없습니다.`)) return;
    try { await call('POST', { action: 'delete', id: A.cur.id }); $('zform').hidden = true; A.cur = null; clearShape(); await loadList(); }
    catch (err) { msg(err.message, true); }
  }
  function msg(t, err) { const m = $('formMsg'); m.textContent = t; m.hidden = !t; m.className = 'msg ' + (err ? 'err' : 'ok'); }
})();
