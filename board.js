// 리얼맵 매물장 '지도+리스트' 모드 (10/25)
// 기본은 표 하나. 맨 위 칸에 주소만 치면 건축물대장·토지대장으로 유형을 짐작하고 면적·층·용도 등을 채워 바로 한 줄로 등록합니다.
//   상가·사무실·주거: 동·호(또는 층)를 고르면 전용면적·층 자동
//   통건물·공장: 층별 현황(층·용도·면적)을 깔아 두고 임차인·보증금·월세만 입력 → 합계·수익률 자동
//   토지: 필지를 붙이면 면적·공시지가 합산, 평당가 자동
// [지도로 보기]를 켜면 지금 표에 걸린 줄만 오른쪽 지도에 번호 핀으로. 리얼맵 공개는 매물 카드(전체 수정)에서만.
// listings.js 안에서 쓰입니다: Board.mount(요소, host) · Board.refresh() · Board.focus(id)
window.Board = (() => {
  const $ = id => document.getElementById(id);
  let H = null, EL = null, X = null;                 // host · 붙일 곳 · host가 넘겨준 도우미 모음
  const PY = 3.3058;
  // 10/26 종류별 탭: 위 탭 하나 = 종류 하나 (아파트는 단지 화면이 따로 있고, 여기 'apt'는 단지에 없는 아파트 매물을 볼 때)
  //   10/26 오후 세분화: 탭 10개 · 탭 안의 세부 유형(ptype) · 분양권은 거래가 '분양권'이면 종류와 상관없이 분양권 탭
  const CATS = { apt: ['아파트', '주상복합', '오피스텔'], shop: ['상가', '사무실'], bld: ['건물'], ofc: ['지식산업센터'], home: ['빌라', '연립', '다가구', '주택'],
    redev: ['재개발', '재건축'], pre: [], land: ['토지'], fac: ['공장·창고'], etc: ['숙박', '기타'] };
  const CATNAME = { apt: '아파트·오피 매물', shop: '상가·사무실', bld: '건물', ofc: '지식산업센터', home: '빌라·주택', redev: '재개발·재건축', pre: '분양권', land: '토지', fac: '공장·창고', etc: '숙박·기타' };
  const catOf = x => x.kind === 'presale' ? 'pre' : Object.keys(CATS).find(k => CATS[k].includes(x.ptype)) || 'etc';   // 미지정은 숙박·기타 탭
  const tb = x => (X && X.tbase ? X.tbase(x) : x.ptype);   // 세부 유형 → 원래 큰 유형 (listings.js)
  const B = Object.assign({ cat: 'shop', sort: 'at', dir: -1, grp: '', f: {}, map: false, rate: 4.5, fo: false, fk: [], fs: ['on'], fc: [], fx: [] },
    (() => { try { return JSON.parse(localStorage.getItem('rm.bd') || 'null') || {}; } catch { return {}; } })(),
    { q: '', open: new Set(), blank: new Map(), cblank: new Map(), hl: null, sel: null, ed: null, add: { q: '', res: null, busy: false, D: null }, L: {}, U: {}, fitNext: true });
  // 예전 폴더 값({pt, bn})은 버림 · 거르기 배열이 없으면 처음대로
  if (!CATS[B.cat]) B.cat = 'shop'; if (B.tr && !B.tr.hd) B.tr = null; ['fk', 'fs', 'fc', 'fx'].forEach(k => { if (!Array.isArray(B[k])) B[k] = []; });
  // 10/28 단순화(5단계): 체크 거르기·▾ 거르기·노랑/빨강 표시·여러 건 선택·손님 조건은 없앰 → 예전에 기억한 거르기는 버리고, 상태는 늘 '진행 중'부터
  //   10/30 선배: 상태 [진행 중 · 보류 · 거래완료] → 아파트처럼 [전체 · 매물만] (B.fs [] = 전체 · ['on'] = 매물만) · 늘 '전체'부터
  Object.assign(B, { fk: [], fs: [], fc: [], fx: [], cf: null, f: {}, grp: '', fo: false, sel: null, pk: null });
  const keep = () => { try { localStorage.setItem('rm.bd', JSON.stringify({ cat: B.cat, sort: B.sort, dir: B.dir, grp: B.grp, f: B.f, map: B.map, rate: B.rate, fo: B.fo, tr: B.tr, fk: B.fk, fs: B.fs, fc: B.fc, fx: B.fx })); } catch { /* 무시 */ } };
  const esc = s => X.esc(s);
  const m2t = a => a ? `${(+a).toLocaleString(undefined, { maximumFractionDigits: 2 })}㎡` : '';
  const pyt = a => a ? `${(a / PY).toFixed(1)}평` : '';
  const sw = v => X.shortWon(Math.round(v || 0));

  // 금액 입력: '68억' '3억2천' '3.2억' '5000' '2천' → 만원
  function man(s) {
    s = String(s ?? '').replace(/[,\s원]/g, '');
    if (!s) return null;
    if (s[0] === '-') { const v = man(s.slice(1)); return v == null || Number.isNaN(v) ? v : -v; }   // 분양권 마이너스 프리미엄 (10/26)
    let m, t = 0;
    if ((m = s.match(/^([\d.]+)억(.*)$/))) { t += parseFloat(m[1]) * 10000; s = m[2]; }
    if (s) {
      if ((m = s.match(/^([\d.]+)천(만)?$/))) t += parseFloat(m[1]) * 1000;
      else if ((m = s.match(/^([\d.]+)(만)?$/))) t += parseFloat(m[1]);
      else return NaN;
    }
    return t > 0 ? Math.round(t * 100) / 100 : null;
  }
  const fmtPhone = p => { const d = String(p || '').replace(/\D/g, ''); return d.length === 11 ? d.replace(/^(\d{3})(\d{4})(\d{4})$/, '$1-$2-$3') : d.length === 10 ? d.replace(/^(02)(\d{4})(\d{4})$/, '$1-$2-$3').replace(/^(\d{3})(\d{3})(\d{4})$/, '$1-$2-$3') : d.length === 9 ? d.replace(/^(02)(\d{3})(\d{4})$/, '$1-$2-$3') : String(p || '').trim(); };
  const manTx = v => { if (!v) return ''; const e = Math.floor(v / 10000), r = Math.round(v % 10000); return (e ? `${e}억` : '') + (r ? (e ? ' ' : '') + r.toLocaleString() : ''); };

  // ---------- 매물 한 건에서 뽑는 값 ----------
  const places = x => Array.isArray(x.places) && x.places.length ? x.places : [{ pnu: x.pnu, addr: x.addr, lat: x.lat, lng: x.lng, dong: x.dong, ho: x.ho, area: x.area }];
  const isLand = x => tb(x) === '토지' || places(x).every(p => p.land || p.ak === 'land');
  const isWhole = x => !isLand(x) && places(x)[0].ak === 'tot' && !places(x)[0].ho;
  const detKind = x => isLand(x) ? 'land' : isWhole(x) ? 'whole' : 'unit';
  const mainP = x => x.kind === 'sale' ? x.price : x.kind === 'presale' ? (x.price || x.pr) : x.deposit;
  const siteOf = x => places(x).reduce((a, p) => a + (p.site || 0), 0);
  const shortAddr = a => { const w = String(a || '').split(' '); const i = w.findIndex(t => /(동|가|리|읍|면)\d*$/.test(t) && !/[시군구]$/.test(t)); return (i >= 0 ? w.slice(i) : w.slice(-2)).join(' '); };
  const hood = x => (String(places(x)[0].addr || x.addr || '').split(' ').find(w => /(동|가|리|읍|면)\d*$/.test(w) && !/[시군구]$/.test(w)) || '').replace(/\d+가$/, '가');
  const dh = p => [p.dong && (/동$/.test(p.dong) ? p.dong : p.dong + '동'), p.ho && (/(호|층)$/.test(p.ho) ? p.ho : p.ho + '호')].filter(Boolean).join(' ');
  const flTx = v => { v = String(v || '').trim(); if (!v || v === '전체') return v; return /^b/i.test(v) ? v.toUpperCase() : /^\d+$/.test(v) ? v + 'F' : v; };
  const zoneS = z => String(z || '').split(' · ')[0].replace(/^제/, '').replace(/지역$/, '').replace('일반주거', '일반').replace('전용주거', '전용');
  const chip = x => x.ptype === '건물' && isWhole(x) ? '통건물' : x.ptype === '기타' ? (x.ptypeTx || '기타') : x.ptype || '미지정';
  // 연 수익률: 연 월세 ÷ (매매가 − 보증금). 융자 반영: (연 월세 − 연 이자) ÷ (매매가 − 보증금 − 융자)
  function yields(x, dep, rent) {
    if (x.kind !== 'sale' || !x.price || !rent) return null;
    const inv = x.price - (dep || 0); if (inv <= 0) return null;
    const y = rent * 12 / inv * 100;
    const L = x.loan || 0, inv2 = inv - L;
    const y2 = L && inv2 > 0 ? (rent * 12 - L * B.rate / 100) / inv2 * 100 : null;
    return { y, y2, inv, inv2 };
  }
  const rentSum = x => (x.rents || []).reduce((a, r) => ({ d: a.d + (r.deposit || 0), r: a.r + (r.rent || 0), v: a.v + (/공실/.test(r.label || '') ? 1 : 0) }), { d: 0, r: 0, v: 0 });

  // ---------- 저장 (한 칸씩 고쳐도 서버에는 매물 전체를 보냄) ----------
  const PEND = new Map(); let Q = Promise.resolve();
  function bodyOf(it) {
    const keys = X.moneyOf(it).map(m => m[0]);
    const b = { ...it, places: places(it).map(P => Object.fromEntries(Object.entries(P).filter(([k]) => !k.startsWith('_')))) };
    ['price', 'deposit', 'rent', 'pr', 'paid'].forEach(k => { if (!keys.includes(k)) b[k] = null; });   // 10/26: 관리비·권리금·현 보증금/월세는 거래 종류와 상관없이 남김(표에서 바로 입력)
    if (it.ptype !== '기타') b.ptypeTx = '';
    return b;
  }
  function saveItem(id, mut, msg) {
    if (X.ro().has(id)) { H.openForm(id); return Promise.resolve(); }
    const L = H.items(), i = L.findIndex(x => x.id === id); if (i < 0) return Promise.resolve();
    const pe = PEND.get(id), orig = pe ? pe.orig : L[i];
    const base = pe ? pe.it : L[i], it = X.upgrade(base); mut(it);
    autoLines(base, it).forEach(t => { it.memo = X.memoAdd(it.memo, t); });   // 바뀐 내용은 기록에 자동으로 (10/26)
    const tok = { it, orig }; PEND.set(id, tok);
    L[i] = it; refresh();
    Q = Q.then(async () => {
      const cur = PEND.get(id); if (!cur) return;
      try {
        const j = await H.api('/api/auth?action=listing', H.post({ op: 'save', id, item: bodyOf(cur.it) }));
        H.took(j);
        const now = PEND.get(id);
        if (now === cur) PEND.delete(id);
        else if (now) { const M = H.items(), k = M.findIndex(x => x.id === id); if (k >= 0) M[k] = now.it; }
        H.redraw(); if (msg) H.toast(msg);
      } catch (e) {
        PEND.delete(id);
        if (e.code === 'conflict' && e.data) { H.took(e.data); H.redraw(); H.toast(e.message, 6000); return; }   // 다른 직원이 먼저 고침 → 서버의 새 내용으로 (10/28)
        const M = H.items(), k = M.findIndex(x => x.id === id); if (k >= 0) M[k] = cur.orig;
        H.redraw();
        if (e.code === 'readonly' || e.code === 'limit') H.upsell(e.message); else H.toast(e.message || '저장하지 못했습니다', 4000);
      }
    });
    return Q;
  }

  // ---------- 거르기 · 정렬 ----------
  // 10/26 종류별 탭: 위 탭(B.cat)에서 고른 종류만 · 거르기는 체크 누적(같은 묶음 '또는', 묶음끼리 '그리고')
  //   B.fk 거래(sale·jeonse·wolse·presale) · B.fs 상태(on·hold·done) · B.fc 챙길 것(imp·mk·pub·vac) · B.fx 칩(층·가격대) · B.cf 칸 ▾
  const vacant = x => detKind(x) === 'whole' ? rentSum(x).v > 0 : /공실/.test((x.ad || {}).biz || '');   // 통건물 = 공실 층이 있음 · 상가 = 업종 칸이 '공실'
  const FLAG = { imp: x => !!x.imp, mk: x => !!x.mk, pub: x => X.pubLive(x), vac: x => vacant(x) };
  const flNo = x => { const f = String((x.ad || {}).fl || places(x)[0].ho || ''); return /^b|지하/i.test(f) ? -1 : parseInt(f, 10) || 0; };
  // 칩: [맞는지, 이름, 묶음] — 같은 묶음은 '또는', 묶음끼리는 '그리고' (예: 재개발 + 사업시행 + 빌라)
  const ymOf = v => { const m = String(v || '').match(/(\d{2,4})\s*[.\-/년]\s*(\d{1,2})/); if (!m) return null; const y = +m[1] < 100 ? 2000 + +m[1] : +m[1]; return Date.UTC(y, +m[2] - 1, 1); };
  const resaleOk = x => { const v = String((x.ad || {}).resale || '').trim(); if (/즉시|가능/.test(v)) return true; const d = ymOf(v); return d != null && d <= Date.now(); };
  const dueSoon = x => { const d = ymOf((x.ad || {}).due); return d != null && d - Date.now() <= 183 * 864e5; };
  const STAGES = ['추진위', '조합설립', '사업시행', '관리처분', '이주·철거'];
  const CHIP = {
    f1: [x => flNo(x) === 1, '1층', 'fl'], fb: [x => flNo(x) < 0, '지하', 'fl'], f2: [x => flNo(x) >= 2, '2층 이상', 'fl'],
    p30: [x => x.kind === 'sale' && x.price && x.price < 300000, '~30억', 'pr'], p50: [x => x.kind === 'sale' && x.price >= 300000 && x.price < 500000, '30~50억', 'pr'], p50p: [x => x.kind === 'sale' && x.price >= 500000, '50억~', 'pr'],
    r1: [x => +(x.ad || {}).rooms === 1, '원룸', 'rm'], r2: [x => +(x.ad || {}).rooms === 2, '투룸', 'rm'], r3: [x => +(x.ad || {}).rooms >= 3, '쓰리룸+', 'rm'],
    kre: [x => x.ptype === '재개발', '재개발', 'rk'], krc: [x => x.ptype === '재건축', '재건축', 'rk'],
    ...Object.fromEntries(STAGES.map((t, i) => ['s' + i, [x => (x.ad || {}).stage === t, t, 'stg']])),
    ...Object.fromEntries(['빌라', '단독', '상가', '아파트', '토지'].map((t, i) => ['m' + i, [x => (x.ad || {}).form === t, t, 'fm']])),
    ap: [x => x.ptype !== '오피스텔', '아파트', 'ap'], op: [x => x.ptype === '오피스텔', '오피스텔', 'ap'],
    pa: [x => tb(x) === '아파트', '아파트', 'pt'], po: [x => tb(x) !== '아파트', '오피스텔 등', 'pt'],
    rs: [resaleOk, '전매 가능', 'rs'], d6: [dueSoon, '입주 6개월 이내', 'd6'],
  };
  const CATCHIP = { shop: ['f1', 'fb', 'f2'], bld: ['p30', 'p50', 'p50p'], home: ['r1', 'r2', 'r3'], apt: ['ap', 'op', '|', 'r1', 'r2', 'r3'],
    redev: ['kre', 'krc', '|', 's0', 's1', 's2', 's3', 's4', '|', 'm0', 'm1', 'm2', 'm3', 'm4'], pre: ['pa', 'po', '|', 'rs', 'd6'] };
  const CATKIND = { shop: ['sale', 'wolse', 'jeonse'], bld: ['sale', 'wolse'], land: ['sale', 'wolse', 'jeonse'], apt: ['sale', 'jeonse', 'wolse'], ofc: ['sale', 'jeonse', 'wolse'], home: ['sale', 'jeonse', 'wolse'],
    redev: ['sale', 'jeonse', 'wolse'], pre: [], fac: ['sale', 'wolse', 'jeonse'], etc: ['sale', 'wolse', 'jeonse'] };
  // 표 머리 아래 ▾ 로 거를 수 있는 칸 (값 꺼내는 법) — 이 화면에서만 (저장 안 함)
  const CFV = {
    ty: x => chip(x), nm: x => x.bname || '(이름 없음)', addr: x => hood(x) || '(동네 미상)', kd: x => X.KIND[x.kind] || '', st: x => ({ on: '진행', hold: '보류', done: '완료' }[x.status] || ''),
    biz: x => (x.ad || {}).biz || '(없음)', zone: x => zoneS((x.ad || {}).zone) || '(없음)', dir: x => (x.ad || {}).dir || '(없음)', jimok: x => (x.ad || {}).use || '(없음)',
    dn: x => places(x)[0].dong || '(없음)', fl: x => flTx((x.ad || {}).fl) || '(없음)',
    rz: x => (x.ad || {}).rz || '(없음)', stage: x => (x.ad || {}).stage || '(없음)', form: x => (x.ad || {}).form || '(없음)', rk: x => x.ptype || '', mid: x => (x.ad || {}).mid || '(없음)',
  };
  const orphOn = () => B.cat === 'apt' && !B.allApt;   // B.allApt: 알림 등에서 단지에 담긴 아파트 매물로 갈 때만 잠깐 전부
  function pass(x, any) {
    if (!any && catOf(x) !== B.cat) return false;
    if (!any && orphOn() && H.isOrph && !H.isOrph(x)) return false;   // 10/30 아파트·오피 탭은 단지 없는 매물만
    if (B.fs.length && !B.fs.includes(x.status)) return false;
    if (B.fk.length && !B.fk.includes(x.kind)) return false;
    if (B.fc.length && !B.fc.some(f => FLAG[f] && FLAG[f](x))) return false;
    if (B.fx.length) { const G = {}; B.fx.forEach(f => { if (CHIP[f]) (G[CHIP[f][2]] || (G[CHIP[f][2]] = [])).push(f); }); for (const g in G) if (!G[g].some(f => CHIP[f][0](x))) return false; }
    if (B.cf) for (const k in B.cf) if (B.cf[k] && CFV[k] && !B.cf[k].includes(CFV[k](x))) return false;   // 머리 ▾ 거르기
    const q = B.q.toLowerCase();
    if (q && ![x.no, x.addr, x.road, x.bname, x.owner, x.phone, x.memo, x.ptype, JSON.stringify(x.places || ''), JSON.stringify(x.contacts || ''), JSON.stringify(x.rents || '')].join(' ').toLowerCase().includes(q)) return false;
    if (H.adv()) {
      const f = B.f, p = mainP(x), py = x.area ? x.area / PY : null;
      if (f.pmin && !(p >= f.pmin)) return false;
      if (f.pmax && !(p && p <= f.pmax)) return false;
      if (f.rmax && x.kind === 'wolse' && !(x.rent <= f.rmax)) return false;
      if (f.amin && !(py >= f.amin)) return false;
      if (f.amax && !(py && py <= f.amax)) return false;
      if (f.where) { const w = f.where.replace(/\s/g, '').toLowerCase(); if (![x.addr, x.road, x.bname, JSON.stringify(x.places || '')].join(' ').replace(/\s/g, '').toLowerCase().includes(w)) return false; }
    }
    return true;
  }
  const lastMemo = x => { const L = X.memoParse(x.memo); return L[0] ? L[0].t || '' : ''; };
  const pyOf = (x, a) => a ? a / PY : 0;
  const SORT = {
    at: x => x.at || '', ty: x => chip(x), nm: x => x.bname || '', addr: x => shortAddr(places(x)[0].addr || x.addr), pr: x => mainP(x) || 0,
    ps: x => (x.kind === 'sale' || x.kind === 'presale') && x.price || 0, pj: x => x.kind === 'jeonse' && x.deposit || 0, pdep: x => (x.kind === 'wolse' || x.kind === 'jeonse') && x.deposit || 0, prent: x => x.kind === 'wolse' && x.rent || 0,
    ar: x => x.area || 0, site: x => siteOf(x), exp: x => x.exp || '', st: x => x.status, memo: x => x.up || '', h: x => x.up || '',
    ppy: x => { const s = ['bld', 'fac', 'etc'].includes(catOf(x)) && siteOf(x) ? siteOf(x) : x.area; return x.kind === 'sale' && x.price && s ? x.price / pyOf(x, s) : 0; },
    yld: x => { const y = detKind(x) === 'whole' ? yields(x, rentSum(x).d, rentSum(x).r) : yields(x, x.curDep, x.curRent); return y ? y.y : 0; },
    rz: x => (x.ad || {}).rz || '', stage: x => STAGES.indexOf((x.ad || {}).stage), apv: x => (x.ad || {}).apv || 0, rgt: x => (x.ad || {}).rgt || 0, prm: x => premOf(x) || 0, jsh: x => (x.ad || {}).jshare || 0,
    prp: x => x.pr || 0, ptot: x => (x.price || 0) + (x.pr || 0), due: x => ymOf((x.ad || {}).due) || 0, resale: x => ymOf((x.ad || {}).resale) || 0,
  };
  function rowsNow() {
    const all = H.items().filter(x => pass(x));
    let rows = all;
    if (B.tr && treeOn()) rows = rows.filter(x => (!B.tr.hd || topOf(x) === B.tr.hd) && (!B.tr.bn || bnOf(x) === B.tr.bn));   // 왼쪽 폴더
    const f = SORT[B.sort] || SORT.at;
    rows.sort((a, b) => { const A = f(a), C = f(b); return (typeof A === 'number' && typeof C === 'number' ? A - C : String(A).localeCompare(String(C), 'ko', { numeric: true })) * B.dir; });
    return { all, rows };
  }
  const GRP = { '': '묶지 않음', bname: '단지·건물별', hood: '동네별', kind: '거래별', status: '상태별', pub: '리얼맵 등록별' };
  const gkey = x => B.grp === 'bname' ? (x.bname || '이름 없음') : B.grp === 'hood' ? (hood(x) || '동네 미상') : B.grp === 'kind' ? X.KIND[x.kind] : B.grp === 'status' ? X.STAT[x.status] : B.grp === 'pub' ? (X.pubLive(x) ? '리얼맵 게시 중' : X.isPub(x) ? '게시 기간 만료' : '리얼맵 미등록') : '';

  // ---------- 그리기 ----------
  function mount(el, host) {
    if (host) { H = host; X = host.X; } EL = el;
    EL.innerHTML = `<div class="lv-wrap bd" id="bd"><div class="bdlay" id="bdLay">
      <aside class="djtree bdtree" id="bdTree"></aside><div class="bdmain">
      <div id="bkLine2"></div>
      <div class="bd-bar" id="bdBar"></div>
      <div class="bd-add" id="bdAdd">
        <div class="bd-addin"><span class="plus">＋</span><input id="bdQ" type="search" autocomplete="off" enterkeyhint="search" placeholder="매물 등록: 주소·건물명을 치고 Enter → 건물 정보가 자동으로 채워집니다"></div>
        <div id="bdRes"></div>
      </div>
      <div class="bd-t" id="bdT"></div>
      </div></div>
      <div class="bd-pop" id="bdPop" hidden></div>
    </div>`;
    // 10/30 입력창은 매물 화면 밖(body)에 둠 — 아파트 화면의 '개별매물'에서도 화면을 바꾸지 않고 같은 입력창을 띄우려고 (openWin)
    if (!$('bd_rpw')) { const h = document.createElement('div'); h.className = 'lv-wrap bd'; h.id = 'bd_rpwHost'; h.innerHTML = '<div class="dj" id="bd_rpw"></div>'; document.body.appendChild(h); }
    const q = $('bdQ');
    q.onkeydown = e => {
      if (e.isComposing) return;
      if (e.key === 'Enter') { e.preventDefault(); const v = q.value.trim(); if (B.add.res && B.add.res.length && v === B.add.q) return pick(B.add.res[0]); find(v); }
      if (e.key === 'Escape') { B.add.res = null; drawRes(); }
    };
    q.oninput = () => { if (!q.value.trim()) { B.add.res = null; drawRes(); } };
    EL.addEventListener('scroll', () => hidePop());
    document.addEventListener('mousedown', e => { const p = $('bdPop'); if (p && !p.hidden && !p.contains(e.target) && !e.target.closest('td[data-c]')) hidePop(); });
    try { matchMedia('(min-width:980px)').addEventListener('change', () => refresh()); } catch { /* 옛 브라우저 */ }
    B.fitNext = true;
    refresh();
    H.showMap(B.map);
  }
  function refresh() {
    if (B.fk.some(k => !(CATKIND[B.cat] || []).includes(k))) { B.fk = B.fk.filter(k => (CATKIND[B.cat] || []).includes(k)); keep(); }   // 예전에 저장한 거래 거르기(분양권 등)가 이 탭에 없으면 버림
    if (!EL || !$('bd')) return;
    // 입력 중인 칸은 다시 그려도 그대로 (값·커서 유지)
    const a = document.activeElement, fk = a && a.dataset && a.dataset.fk && $('bd').contains(a) ? a.dataset.fk : null;
    const val = fk ? a.value : null, s0 = fk ? a.selectionStart : null, s1 = fk ? a.selectionEnd : null;
    drawTree(); drawBar(); drawTable(); drawPanel();
    if (fk) { const n = $('bd').querySelector(`[data-fk="${CSS.escape(fk)}"]`); if (n) { if (n.value !== val) n.value = val; n.focus(); try { n.setSelectionRange(s0, s1); } catch { /* 숫자 칸 등 */ } } }
    H.drawBk && H.drawBk();
  }
  // ---------- 왼쪽 탐색기 (넓은 화면 · 지도 닫았을 때) — 10/26 종류별 ----------
  // 아파트·오피스텔 = 단지·건물 이름 · 나머지 = 동네 → 건물 이름 (매물 많은 순) · 아래 보류 · 거래완료
  const bnOf = x => x.bname || shortAddr(places(x)[0].addr || x.addr) || '이름 없음';
  // 왼쪽 폴더 맨 위 단계: 아파트·오피·분양권 = 단지·건물 이름 / 재개발·재건축 = 구역명 / 나머지 = 동네
  const flatCat = () => ['apt', 'ofc', 'pre'].includes(B.cat);
  const topOf = x => flatCat() ? bnOf(x) : B.cat === 'redev' ? ((x.ad || {}).rz || '구역명 없음') : hood(x) || '동네 미상';
  const premOf = x => { const a = x.ad || {}; return x.kind === 'sale' && x.price && a.rgt ? x.price - a.rgt : null; };   // 재개발 프리미엄 = 매매가 − 권리가액
  const treeOn = () => matchMedia('(min-width:980px)').matches && !B.map;
  function drawTree() {
    const T = $('bdTree'); if (!T) return;
    $('bdLay').classList.toggle('hastree', treeOn());
    if (!treeOn()) { T.innerHTML = ''; return; }
    // 10/30 선배: 아파트·오피 탭 = '단지 없는 매물' — 왼쪽은 아파트 화면의 단지 탐색기를 그대로 (누르면 아파트 화면으로)
    const dj = orphOn() && H.djTree && H.djTree(T); $('bdLay').classList.toggle('djt', !!dj); if (dj) return;
    const base = H.items().filter(x => pass(x)), tr = B.tr || {}, flat = flatCat() || B.cat === 'redev';
    const top = {}, sub = {};
    base.forEach(x => { const h = topOf(x); top[h] = (top[h] || 0) + 1; if (!flat && x.bname) { const s = sub[h] || (sub[h] = {}); s[x.bname] = (s[x.bname] || 0) + 1; } });
    const node = (cls, attrs, label, n, on) => `<button type="button" class="tn ${cls}${on ? ' on' : ''}" ${attrs}>${label}<span class="ct">${n || ''}</span></button>`;
    const byN = o => Object.entries(o).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ko', { numeric: true }));
    T.innerHTML = `<div class="tth"><b>${esc(CATNAME[B.cat])}</b>${bstHtml()}</div>
      ${node('all', 'data-thd=""', '<i></i>전체', base.length, !tr.hd)}
      ${byN(top).map(([h, n]) => { const s = sub[h], open = s && tr.hd === h; return node('', `data-thd="${esc(h)}"`, `<span class="ar">${s ? (open ? '▾' : '▸') : ''}</span><i></i>${esc(h)}`, n, tr.hd === h && !tr.bn) + (open ? byN(s).map(([b, c]) => node('d', `data-thd="${esc(h)}" data-tbn="${esc(b)}"`, `<i></i>${esc(b)}`, c, tr.bn === b)).join('') : ''); }).join('')}`;   // 10/28 보류·거래완료는 위 상태 버튼에서만 (10/30 [전체 · 매물만])
    const go = () => { keep(); B.fitNext = true; refresh(); };
    T.querySelectorAll('[data-thd]').forEach(b => b.onclick = () => { const h = b.dataset.thd, bn = b.dataset.tbn; B.tr = !h ? null : (tr.hd === h && !bn && !tr.bn && sub[h]) ? null : { hd: h, ...(bn ? { bn } : {}) }; go(); });   // 펼친 동네를 다시 누르면 접힘
    T.querySelectorAll('[data-tst]').forEach(b => b.onclick = () => { B.fs = [b.dataset.tst]; B.tr = null; go(); });
    wireBst(T);
  }
  // 10/30 [전체 · 매물만] — 넓은 화면은 왼쪽 탐색기 머리에 (선배) · 탐색기가 숨는 좁은 화면·지도 열 때는 위 막대 제목 옆 (CSS로 하나만 보임)
  const bstHtml = () => { const mk = B.fs[0] === 'on'; return `<span class="bst" role="tablist" aria-label="장부 고르기">${[['', '전체'], ['on', '매물만']].map(([k, t]) => `<button type="button" data-bst="${k}" aria-pressed="${(k === 'on') === mk}">${t}</button>`).join('')}</span>`; };
  const wireBst = root => root.querySelectorAll('[data-bst]').forEach(b => b.onclick = () => { const v = b.dataset.bst ? [b.dataset.bst] : []; if (String(B.fs) === String(v)) return; B.fs = v; B.tr = null; B.pk = null; B.fitNext = true; refresh(); });
  // ---------- 위 거르기 막대 ----------
  // 10/28 단순화(5단계): 위 막대는 상태 · 찾기 · 지도로 보기만 · 10/30 상태 → [전체 · 매물만] (아파트와 같게 · 넓은 화면은 탐색기 머리)
  //   매물 등록은 아래 주소 줄 하나 · 고치기는 줄을 누르면 오른쪽 입력창 · 지도 광고는 표 맨 끝 '리얼맵' 칸
  function drawBar() {
    const oo = orphOn() && H.isOrph, inCat = H.items().filter(x => catOf(x) === B.cat && (!oo || H.isOrph(x))), nOn = inCat.filter(x => x.status === 'on').length;
    $('bdBar').innerHTML = `<div class="bd-row bd-fl bd-s"><b class="bd-tt">${oo ? '개별매물' : esc(CATNAME[B.cat])}</b><span class="bd-cnt">${inCat.length}건 · 매물 <b>${nOn}</b></span>
      ${bstHtml()}<span class="sp"></span>
      <input class="bd-find" id="bdFind" type="search" data-fk="find" placeholder="이 탭에서 찾기" value="${esc(B.q)}">
      <button type="button" class="tb map${B.map ? ' on' : ''}" id="bdMap">${B.map ? '지도 닫기' : '지도로 보기'}</button></div>`;
    wireBst($('bdBar'));
    $('bdFind').oninput = e => { clearTimeout(B.fT); B.fT = setTimeout(() => { B.q = e.target.value.trim(); B.fitNext = true; refresh(); }, 250); };
    $('bdMap').onclick = () => { B.map = !B.map; keep(); B.fitNext = true; H.showMap(B.map); refresh(); };
  }

  // ---------- 표의 칸 (종류마다) — 10/26 ----------
  //   { id, t: 제목, g: 위 묶음, s: 정렬 키, ed: 'pop'(작은 창) | 'in'(칸에서 바로) | 'det'(상세에서) }
  const K = (id, t, o = {}) => ({ id, t, ...o });
  const PRS = { ed: 'pop', g: '의뢰가격' }, CUR = { g: '현상태' };
  const COMMON_END = [K('imp', '꼭 챙길 것', { ed: 'in' })];
  const TAIL = [K('tel', '연락처'), K('h', '최근 기록', { s: 'h' }), K('pub', '리얼맵')];   // 10/28 상태는 위 [진행 중 · 보류 · 거래완료] · 상세 버튼 칸은 없앰 (줄을 누르면 입력창)
  const RES = cat => [K('mk0', '매물'), K('n', '번호', { s: 'at' }), K('ty', '유형', { ed: 'pop', s: 'ty' }), K('nm', cat === 'apt' ? '단지' : '물건명', { s: 'nm' }),
    ...(cat === 'home' ? [K('addr', '주소', { s: 'addr' }), K('fl', '층', { ed: 'in' })] : [K('dn', '동'), K('ho', '호')]), K('ar', cat === 'apt' ? '평형 · 타입' : '전용', { ed: 'in', s: 'ar' }), K('dir', '방향', { ed: 'in' }),
    K('kd', '거래', { ed: 'pop' }), K('ps', '매매', { ...PRS, s: 'ps' }), K('pj', '전세', { ...PRS, s: 'pj' }), K('pdep', '보증금', { ...PRS, s: 'pdep' }), K('prent', '월세', { ...PRS, s: 'prent' }), K('mgmt', '관리비', { ed: 'in', g: '의뢰가격' }),
    ...(cat === 'apt' ? [K('gap', '갭', { g: '의뢰가격' })] : []), ...COMMON_END,
    K('cst', '구분', CUR), K('cdep', '보증금', { ed: 'in', ...CUR }), K('crent', '월세', { ed: 'in', ...CUR }), K('exp', '만기일', { ed: 'in', s: 'exp' }), ...TAIL];
  const COLS = {
    shop: [K('mk0', '매물'), K('n', '번호', { s: 'at' }), K('ty', '유형', { ed: 'pop', s: 'ty' }), K('nm', '물건명', { s: 'nm' }), K('addr', '주소', { s: 'addr' }), K('fl', '층', { ed: 'in' }), K('ho', '호'), K('ar', '전용', { ed: 'in', s: 'ar' }),
      K('kd', '거래', { ed: 'pop' }), K('ps', '매매', { ...PRS, s: 'ps' }), K('pdep', '보증금', { ...PRS, s: 'pdep' }), K('prent', '월세', { ...PRS, s: 'prent' }), K('prem', '권리금', { ed: 'in', g: '의뢰가격' }), K('mgmt', '관리비', { ed: 'in', g: '의뢰가격' }),
      K('biz', '업종', { ed: 'in' }), ...COMMON_END, K('cst', '구분', CUR), K('cdep', '보증금', { ed: 'in', ...CUR }), K('crent', '월세', { ed: 'in', ...CUR }), K('exp', '만기일', { ed: 'in', s: 'exp' }), ...TAIL],
    bld: [K('mk0', '매물'), K('n', '번호', { s: 'at' }), K('nm', '물건명', { s: 'nm' }), K('addr', '주소', { s: 'addr' }), K('site', '대지', { s: 'site', ed: 'det' }), K('tot', '연면적', { s: 'ar', ed: 'det' }), K('scale', '규모', { ed: 'det' }), K('appr', '준공', { ed: 'det' }), K('zone', '용도지역', { ed: 'det' }),
      K('kd', '거래', { ed: 'pop' }), K('ps', '매매가', { ed: 'pop', g: '가격', s: 'ps' }), K('ppy', '대지 평당', { g: '가격', s: 'ppy' }), K('loan', '융자', { ed: 'in', g: '가격' }),
      K('rdep', '보증금 합', { g: '임대 현황', ed: 'det' }), K('rrent', '월세 합', { g: '임대 현황', ed: 'det' }), K('yld', '수익률', { g: '임대 현황', s: 'yld' }), K('vac', '공실', { g: '임대 현황', ed: 'det' }), ...COMMON_END, ...TAIL],
    land: [K('mk0', '매물'), K('n', '번호', { s: 'at' }), K('ty', '유형', { ed: 'pop', s: 'ty' }), K('addr', '주소', { s: 'addr' }), K('jimok', '지목 · 용도', { ed: 'det' }), K('zone', '용도지역', { ed: 'det' }), K('ar', '면적', { ed: 'in', s: 'ar' }), K('road', '도로', { ed: 'det' }),
      K('kd', '거래', { ed: 'pop' }), K('ps', '매매가', { ...PRS, s: 'ps' }), K('ppy', '평당', { g: '의뢰가격', s: 'ppy' }), K('pdep', '보증금', { ...PRS, s: 'pdep' }), K('prent', '월세', { ...PRS, s: 'prent' }), ...COMMON_END, ...TAIL],
    // 10/30 선배: 아파트·오피 탭(= 단지 없는 매물)은 아파트 화면 장부와 같은 칸 순서 — 매물 · 단지명 · 유형 · 동 · 호 · 평형 · 타입 · 향 · 받은 곳 · 거래 · 의뢰가격 · 챙길 것 · 현상태 · 연락처 · 최근 기록 · 리얼맵
    apt: [K('mk0', '매물'), K('nm', '단지명', { s: 'nm' }), K('ty', '유형', { ed: 'pop', s: 'ty' }), K('dn', '동'), K('ho', '호'), K('py', '평형', { s: 'ar' }), K('tp', '타입'), K('dir', '향'), K('src', '받은 곳'), K('kd', '거래', { ed: 'pop' }),
      K('ps', '매매', { ...PRS, s: 'ps' }), K('pj', '전세', { ...PRS, s: 'pj' }), K('pdep', '보증금', { ...PRS, s: 'pdep' }), K('prent', '월세', { ...PRS, s: 'prent' }), K('gap', '갭', { g: '의뢰가격' }),
      K('imp', '챙길 것', { ed: 'in' }), K('cst', '구분', CUR), K('cdep', '보증금', { ed: 'in', ...CUR }), K('crent', '차임', { ed: 'in', ...CUR }), K('exp', '만기', { ed: 'in', s: 'exp' }), ...TAIL],
    ofc: RES('ofc'), home: RES('home'),
    // 재개발·재건축 (10/26): 프리미엄 = 매매가 − 권리가액 (자동)
    redev: [K('mk0', '매물'), K('n', '번호', { s: 'at' }), K('rk', '구분', { ed: 'pop', s: 'ty' }), K('rz', '구역명', { ed: 'in', s: 'rz' }), K('stage', '단계', { ed: 'pop', s: 'stage' }), K('form', '물건 형태', { ed: 'pop' }), K('addr', '주소', { s: 'addr' }),
      K('jsh', '대지지분', { ed: 'in', s: 'jsh' }), K('ar', '전용', { ed: 'in', s: 'ar' }), K('kd', '거래', { ed: 'pop' }),
      K('apv', '감정가', { ed: 'in', g: '가격', s: 'apv' }), K('rgt', '권리가액', { ed: 'in', g: '가격', s: 'rgt' }), K('ps', '매매가', { ed: 'pop', g: '가격', s: 'ps' }), K('prm', '프리미엄', { g: '가격', s: 'prm' }),
      K('msh', '조합원 분양', { ed: 'in' }), K('mvl', '이주비', { ed: 'in' }), ...COMMON_END,
      K('cst', '구분', CUR), K('cdep', '보증금', { ed: 'in', ...CUR }), K('crent', '월세', { ed: 'in', ...CUR }), K('exp', '만기일', { ed: 'in', s: 'exp' }), ...TAIL],
    // 분양권 (10/26): 총액 = 분양가 + 프리미엄 (자동)
    pre: [K('mk0', '매물'), K('n', '번호', { s: 'at' }), K('ty', '종류', { ed: 'pop', s: 'ty' }), K('nm', '단지명', { s: 'nm' }), K('dn', '동'), K('ho', '호'), K('ar', '평형 · 타입', { ed: 'in', s: 'ar' }),
      K('ps', '분양가', { ed: 'pop', g: '가격', s: 'ps' }), K('prp', '프리미엄', { ed: 'pop', g: '가격', s: 'prp' }), K('ptot', '총액', { g: '가격', s: 'ptot' }),
      K('down', '계약금', { ed: 'in', g: '납부' }), K('mid', '중도금', { ed: 'pop', g: '납부' }), K('due', '입주예정', { ed: 'in', s: 'due' }), K('resale', '전매 가능일', { ed: 'in', s: 'resale' }), ...COMMON_END, ...TAIL],
  };
  // 공장·창고 · 숙박·기타: 건물 칸 + 유형 · 임대
  COLS.fac = COLS.etc = [K('mk0', '매물'), K('n', '번호', { s: 'at' }), K('ty', '유형', { ed: 'pop', s: 'ty' }), K('nm', '물건명', { s: 'nm' }), K('addr', '주소', { s: 'addr' }), K('site', '대지', { s: 'site', ed: 'det' }), K('tot', '연면적', { s: 'ar', ed: 'det' }),
    K('scale', '규모', { ed: 'det' }), K('appr', '준공', { ed: 'det' }), K('zone', '용도지역', { ed: 'det' }),
    K('kd', '거래', { ed: 'pop' }), K('ps', '매매가', { ...PRS, s: 'ps' }), K('pdep', '보증금', { ...PRS, s: 'pdep' }), K('prent', '월세', { ...PRS, s: 'prent' }), K('ppy', '대지 평당', { g: '의뢰가격', s: 'ppy' }), ...COMMON_END, ...TAIL];
  const MAPHIDE = ['h', 'biz', 'exp', 'cst', 'cdep', 'crent', 'mgmt', 'prem', 'road', 'zone', 'appr', 'scale', 'loan', 'vac', 'dir', 'ty', 'jimok', 'rdep', 'rrent', 'gap', 'pj', 'act', 'tp', 'src'];
  const VC = () => { const L = COLS[B.cat] || COLS.shop; return B.map ? L.filter(c => !MAPHIDE.includes(c.id)) : L; };    // 지도를 켜면 표가 좁아져 일부 칸은 숨김 (상세에서 보임)
  const impTxt = t => String(t || '').replace(/^\s*(?:20\d{2}[-./])?\d{1,2}\s*(?:[./]|월\s*)\d{1,2}(?:\s*일)?(?![~\d])(?:까지)?\s*[·,:-]?\s*/, '') || t;   // 맨 앞 날짜는 빨간 날짜 표시와 겹치므로 글에서 뺌
  const impSoon = d => { const dl = (Date.parse(d) - Date.now()) / 864e5; return dl <= 7 && dl >= -3; };
  const ep = (t = '-') => `<span class="ep">${t}</span>`;
  const cw = v => !v ? '' : v >= 10000 ? sw(v) : Math.round(v).toLocaleString();   // 1억 이상 '8.3억', 그 아래 '5,000'
  const roleOnly = r => /^(소유자|소유주|연락처)?$/.test(String(r || '').trim());
  const ymdS = d => d ? String(d).slice(2).replace(/-/g, '.') : '';
  const expSoon = d => { const dl = (Date.parse(d) - Date.now()) / 864e5; return dl <= 90; };
  function cell(x, c, n) {
    const P = places(x)[0] || {}, a = x.ad || {}, k = x.kind;
    switch (c) {
      case 'mk0': { const on = x.status === 'on'; return `<button type="button" class="mkd${on ? ' on' : ''}" data-mkd="${x.id}" title="${on ? '매물입니다 · 누르면 매물에서 해제' : x.status === 'done' ? '거래완료 · 누르면 다시 매물로' : '누르면 매물로 등록'}" ${X.ro().has(x.id) ? 'disabled' : ''}>${on ? '●' : '○'}</button>`; }   // 10/30 아파트 장부와 같은 맨 앞 '매물'
      case 'n': return `<span class="no">${n}</span>`;
      case 'ty': return `<span class="ty ${catOf(x)}">${esc(chip(x))}</span>`;
      case 'nm': return x.bname ? `<b>${esc(x.bname)}</b>` : ep();
      case 'addr': { const n2 = new Set(places(x).map(q => q.pnu)).size; return `<b>${esc(shortAddr(P.addr || x.addr))}</b>${n2 > 1 ? ` <em>외 ${n2 - 1}${isLand(x) || isWhole(x) ? '필지' : ''}</em>` : ''}`; }   // 10/30 같은 건물 호수 더하기는 '호' 칸에서 외 n
      case 'dn': return P.dong ? esc(String(P.dong).replace(/동$/, '')) : ep();
      case 'ho': { const n2 = places(x).filter(q => q.ho).length; return P.ho ? esc(String(P.ho).replace(/호$/, '')) + (n2 > 1 ? ` <em>외 ${n2 - 1}</em>` : '') : ep(); }   // 10/30 호수 여러 개
      case 'fl': return a.fl || a.tfl ? `${esc(flTx(a.fl) || '?')}${a.tfl ? `<small>/${a.tfl}F</small>` : ''}` : ep('층');
      case 'ar': {
        if (!x.area) return ep('면적');
        if (tb(x) === '아파트' && places(x).length === 1) { const sp = a.spy || Math.round(x.area * (x.area <= 60 ? 1.36 : x.area <= 85 ? 1.33 : 1.27) / PY); return `<b${a.spy ? '' : ' class="est" title="전용면적으로 계산한 공급평 — 아파트 화면에서 라인 평형을 적으면 정확해집니다"'}>${sp}평</b>${a.ty ? ' · ' + esc(a.ty) : ''} <small>${esc(String(x.area))}</small>`; }
        return `<b>${pyt(x.area).replace('.0평', '평')}</b> <small>${m2t(x.area)}</small>`;
      }
      case 'py': { if (!x.area) return ep(); if (tb(x) === '아파트' && places(x).length === 1) { const sp = a.spy || Math.round(x.area * (x.area <= 60 ? 1.36 : x.area <= 85 ? 1.33 : 1.27) / PY); return `<b${a.spy ? '' : ' class="est" title="전용면적으로 계산한 공급평"'}>${sp}평</b> <small>${esc(String(x.area))}</small>`; } return `<b>${pyt(x.area).replace('.0평', '평')}</b> <small>${esc(String(x.area))}</small>`; }   // 10/30 단지 없는 매물: 평형 · 타입 따로
      case 'tp': return a.ty ? esc(a.ty) : ep();
      case 'src': return '<b>내 매물</b>';
      case 'dir': return a.dir ? esc(a.dir) : ep();
      case 'kd': return `<span class="kd ${k}">${X.KIND[k]}</span>`;
      case 'ps': return (k === 'sale' || k === 'presale') && x.price ? `<b class="pv sale">${cw(x.price)}</b>${k === 'presale' && x.pr && B.cat !== 'pre' ? `<small>P ${cw(x.pr)}</small>` : ''}` : ep();
      // 재개발·재건축 · 분양권 (10/26)
      case 'rk': return x.ptype ? `<span class="tg ${x.ptype === '재건축' ? 'rc' : 're'}">${esc(x.ptype)}</span>` : ep();
      case 'rz': return a.rz ? esc(a.rz) : ep();
      case 'stage': return a.stage ? `<span class="tg stg">${esc(a.stage)}</span>` : ep();
      case 'form': return a.form ? esc(a.form) : ep();
      case 'jsh': return a.jshare ? `${pyt(a.jshare).replace('.0평', '평')}` : ep();
      case 'apv': return a.apv ? cw(a.apv) : ep();
      case 'rgt': return a.rgt ? cw(a.rgt) : ep();
      case 'prm': { const v = premOf(x); return v != null ? `<span class="au" title="매매가 − 권리가액 (자동 계산)">${v < 0 ? '-' : ''}${cw(Math.abs(v))}</span>` : ep(); }
      case 'msh': return a.msh ? esc(a.msh) : ep();
      case 'mvl': return a.mvl ? cw(a.mvl) : ep();
      case 'prp': return k === 'presale' && x.pr ? `<b class="pv ${x.pr < 0 ? 'neg' : 'jeonse'}">${x.pr < 0 ? '-' : ''}${cw(Math.abs(x.pr))}</b>` : ep();
      case 'ptot': return k === 'presale' && x.price ? `<span class="au" title="분양가 + 프리미엄 (자동 계산)">${cw(x.price + (x.pr || 0))}</span>` : ep();
      case 'down': return a.down ? cw(a.down) : ep();
      case 'mid': return a.mid || a.midTx ? esc([a.mid, a.midTx].filter(Boolean).join(' ')) : ep();
      case 'due': return a.due ? `<span class="${dueSoon(x) ? 'dd' : ''}">${esc(a.due)}</span>` : ep();
      case 'resale': return a.resale ? esc(a.resale) : ep();
      case 'pj': return k === 'jeonse' && x.deposit ? `<b class="pv jeonse">${cw(x.deposit)}</b>` : ep();
      case 'pdep': { const show = k === 'wolse' || (k === 'jeonse' && !VC().some(z => z.id === 'pj')); return show && x.deposit ? `<b class="pv ${k}">${cw(x.deposit)}</b>` : show && k === 'wolse' ? '<b class="pv wolse">0</b>' : ep(); }
      case 'prent': return k === 'wolse' && x.rent ? `<b class="pv wolse">${x.rent.toLocaleString()}</b>` : ep();
      case 'prem': return x.premium ? cw(x.premium) : ep();
      case 'mgmt': return x.mgmt ? cw(x.mgmt) : a.nomgmt ? '없음' : ep();
      case 'gap': { const g = k === 'sale' && x.price && x.curDep && x.curDep < x.price ? x.price - x.curDep : 0; return g ? `<b class="gap" title="매매가 - 현 보증금 (자동 계산)">${cw(g)}</b>` : ep(); }
      case 'biz': return a.biz ? `<span class="${/공실/.test(a.biz) ? 'vac' : 'biz'}">${esc(a.biz)}</span>` : ep();
      case 'cst': return /공실/.test(a.biz || '') ? '<span class="vac">공실</span>' : x.curRent ? (catOf(x) === 'shop' ? '임차중' : '월세') : x.curDep ? (catOf(x) === 'shop' ? '임차중' : '전세') : ep();
      case 'cdep': return x.curDep ? cw(x.curDep) : ep();
      case 'crent': return x.curRent ? x.curRent.toLocaleString() : ep();
      case 'exp': return x.exp ? `<span class="${expSoon(x.exp) ? 'dd' : ''}">${esc(ymdS(x.exp))}</span>` : ep();
      case 'site': { const s = detKind(x) === 'land' ? x.area : siteOf(x); return s ? `${pyt(s).replace('.0평', '평')}` : ep(); }
      case 'tot': return x.area ? pyt(x.area).replace('.0평', '평') : ep();
      case 'scale': return a.tfl || a.ufl ? esc([a.ufl ? `B${a.ufl}` : '', a.tfl ? a.tfl + 'F' : ''].filter(Boolean).join('~')) : ep();
      case 'appr': return a.appr ? esc(String(a.appr).slice(0, 4)) : ep();
      case 'zone': return a.zone ? esc(zoneS(a.zone)) : ep();
      case 'jimok': return a.use ? esc(String(a.use).split(' · ')[0]) : ep();
      case 'road': return a.road ? esc(a.road) : ep();
      case 'ppy': { const s = ['bld', 'fac', 'etc'].includes(catOf(x)) && siteOf(x) ? siteOf(x) : x.area; return k === 'sale' && x.price && s ? sw(x.price / (s / PY)) : ep(); }
      case 'loan': return x.loan ? cw(x.loan) : ep();
      case 'rdep': { const s = rentSum(x); return s.d ? cw(s.d) : ep(); }
      case 'rrent': { const s = rentSum(x); return s.r ? s.r.toLocaleString() : ep(); }
      case 'yld': { const y = detKind(x) === 'whole' ? yields(x, rentSum(x).d, rentSum(x).r) : yields(x, x.curDep, x.curRent); return y ? `<b class="yl">${y.y.toFixed(1)}%</b>` : ep(); }
      case 'vac': { const v = (x.rents || []).filter(r => /공실/.test(r.label || '')).map(r => r.fl).filter(Boolean); return v.length ? `<span class="vac">${esc(v.slice(0, 3).join(', '))}${v.length > 3 ? ' 외' : ''}</span>` : ep(); }
      case 'imp': return x.imp ? `<span class="imp">${x.impd ? `<span class="dd${impSoon(x.impd) ? ' soon' : ''}">${esc(x.impd.slice(5).replace('-', '/'))}</span>` : ''}${esc(x.impd ? impTxt(x.imp) : x.imp)}</span>` : ep();
      case 'st': return `<span class="st ${x.status}">${{ on: '진행', hold: '보류', done: '완료' }[x.status]}</span>`;
      case 'tel': { const cs = Array.isArray(x.contacts) ? x.contacts.filter(z => z.name || z.phone) : []; const z = cs[0]; return z ? `${esc([roleOnly(z.role) ? '' : z.role, z.name].filter(Boolean).join(' '))}${z.phone ? ` <a class="tl" href="tel:${esc(String(z.phone).replace(/[^\d+]/g, ''))}" data-call="${x.id}:0">${esc(z.phone)}</a>` : ''}${cs.length > 1 ? ` <em>외 ${cs.length - 1}</em>` : ''}` : ep('연락처'); }
      case 'h': { const L = X.memoParse(x.memo); return L[0] ? `<span class="hl"><i>${esc(L[0].t ? L[0].t.slice(3, 8) : '예전')}</i> ${esc(L[0].x)}</span>` : ep(); }   // 10/28 기록은 오른쪽 입력창에서
      case 'pub': return H.pubCell(x) || ep('—');
      case 'act': return `<button type="button" class="det${B.open.has(x.id) ? ' on' : ''}" data-det="${x.id}">상세 ${B.open.has(x.id) ? '▴' : '▾'}</button>`;
    }
    return '';
  }
  // 칸 안에서 바로 고치기 (Enter 저장 · Esc 취소 · Tab 다음 칸)
  function editorHtml(x, c) {
    const a = x.ad || {}, fk = `e:${x.id}:${c}`, cs = (x.contacts || [])[0] || {};
    const inp = (v, ph, more = '') => `<input class="ced" data-fk="${fk}" value="${esc(v)}" placeholder="${ph}" ${more}>`;
    if (c === 'ar') return inp(x.area || '', '㎡', 'inputmode="decimal"');
    if (c === 'fl') return inp([a.fl, a.tfl].filter(v => v != null && v !== '').join('/'), '3/15 (해당층/총층)');
    if (c === 'tel') return inp([cs.name, cs.phone].filter(Boolean).join(' '), '이름 010-0000-0000');
    if (c === 'imp') return inp(x.imp || '', '예: 11/15 중도금 · 이사 3/10 고정', 'maxlength="100"');
    if (c === 'biz') return inp(a.biz || '', '예: 카페 / 공실', 'maxlength="30"');
    if (c === 'dir') return `<select class="ced" data-fk="${fk}"><option value="">-</option>${H.dirs.map(d => `<option ${a.dir === d ? 'selected' : ''}>${d}</option>`).join('')}</select>`;
    if (c === 'exp') return inp(x.exp || '', '', 'type="date"');
    if (['prem', 'mgmt', 'cdep', 'loan'].includes(c)) return inp(manTx(x[{ prem: 'premium', mgmt: 'mgmt', cdep: 'curDep', loan: 'loan' }[c]]), '만원 (예: 3000, 1억)');
    if (c === 'crent') return inp(x.curRent || '', '만원', 'inputmode="numeric"');
    if (c === 'rz') return inp(a.rz || '', '예: 북아현3구역', 'maxlength="30"');
    if (c === 'jsh') return inp(a.jshare || '', '㎡', 'inputmode="decimal"');
    if (['apv', 'rgt', 'mvl', 'down'].includes(c)) return inp(manTx(a[c]), '만원 (예: 3억2천)');
    if (c === 'msh') return inp(a.msh || '', '예: 84㎡ 신청', 'maxlength="20"');
    if (c === 'due') return inp(a.due || '', '예: 28.03', 'maxlength="12"');
    if (c === 'resale') return inp(a.resale || '', '즉시 / 27.06', 'maxlength="12"');
    return '';
  }
  function rowHtml(x, n, RO) {   // 10/28 칸에서 바로 고치기·줄 아래 펼침·노랑/빨강 표시는 없앰 → 줄을 누르면 오른쪽 입력창
    const tds = VC().map(({ id: c }) => `<td class="c-${c}">${cell(x, c, n)}</td>`).join('');
    return `<tr id="b_${x.id}" data-id="${x.id}" class="${B.pk === x.id ? 'on pk' : ''}${B.selId === x.id ? ' sel' : ''}${x.status === 'done' ? ' dn' : ''}${RO.has(x.id) ? ' ro' : ''}">${tds}</tr>`;
  }
  // 왼쪽 칸(번호 ~ 물건명·주소) 고정 — 글자 크기로 칸 너비가 바뀌면 다시 잼
  let RO_ = null;
  const FZ = ['mk0', 'n', 'ty', 'nm', 'addr'];
  function fixCols() {
    const tb = $('bdT') && $('bdT').querySelector('table.bdt'); if (!tb) return;
    const put = () => {
      tb.classList.remove('fx');
      const cols = VC().map(c => c.id), last = cols.indexOf('nm') >= 0 ? cols.indexOf('nm') : cols.indexOf('addr'); if (last < 0) return;
      let left = 0; const fz = cols.slice(0, last + 1).filter(id => FZ.includes(id));
      if (fz.length !== last + 1) return;   // 앞쪽 칸이 모두 고정 칸일 때만
      fz.forEach(id => { const th = tb.querySelector(`thead th.c-${id}:not(.fc)`); if (!th) return; tb.style.setProperty('--l-' + id, left + 'px'); left += th.offsetWidth; });
      tb.dataset.fzl = fz[fz.length - 1]; tb.classList.add('fx');
    };
    // 머리 세 줄이 위로 붙을 때 겹치지 않게 (묶음 아래 줄 · 거르기 줄의 위치)
    const tops = () => { const [r1, r2, r3] = tb.tHead.rows; if (!r1) return; const one = [...r1.cells].find(c => c.rowSpan === 1), h1 = one ? one.offsetHeight : r1.offsetHeight, hA = Math.max(...[...r1.cells].map(c => c.offsetHeight)); [...r1.cells].forEach(c => { c.style.top = '0px'; }); if (r2) [...r2.cells].forEach(c => { c.style.top = h1 + 'px'; }); if (r3) [...r3.cells].forEach(c => { c.style.top = hA + 'px'; }); };
    tops();
    put();
    const sc = tb.parentNode, bw = () => tb.style.setProperty('--bdw', Math.max(320, sc.clientWidth - 24) + 'px'); bw();   // 상세 폭 = 표 상자 보이는 폭
    if (window.ResizeObserver) { if (fixCols.so) fixCols.so.disconnect(); fixCols.so = new ResizeObserver(bw); fixCols.so.observe(sc); }
    if (window.ResizeObserver) { if (RO_) RO_.disconnect(); RO_ = new ResizeObserver(() => { put(); tops(); }); const h = tb.tHead; if (h) RO_.observe(h); }
  }
  function drawTable() {
    const { rows } = rowsNow(), RO = X.ro(), vc = VC();
    const nos = new Map(rows.map((x, i) => [x.id, i + 1]));
    const groups = new Map(); rows.forEach(x => { const k = H.adv() ? gkey(x) : ''; (groups.get(k) || groups.set(k, []).get(k)).push(x); });
    const avg = list => { const by = {}; list.forEach(x => { const p = mainP(x); if (p) (by[x.kind] || (by[x.kind] = [])).push(p); }); return Object.entries(by).map(([k, v]) => `${X.KIND[k]} ${v.length} · 평균 ${sw(v.reduce((a, b) => a + b, 0) / v.length)}`).join(' / '); };
    // 두 줄 머리: 묶음(의뢰가격·현상태·가격·임대 현황)은 위에 한 칸, 나머지는 두 줄 + 아래 칸별 거르기 줄
    const leaf = (c, two) => `<th class="c-${c.id}${c.s ? ' s' : ''}${B.sort === c.s && c.s ? ' on' : ''}"${two ? ' rowspan="2"' : ''}${c.s ? ` data-sort="${c.s}"` : ''}>${c.t}${B.sort === c.s && c.s && c.id !== 'n' ? (B.dir > 0 ? ' ▲' : ' ▼') : ''}</th>`;
    let h1 = '', h2 = '';
    vc.forEach((c, i) => { if (c.g) { if (!vc[i - 1] || vc[i - 1].g !== c.g) { let n = 0; for (let j = i; j < vc.length && vc[j].g === c.g; j++) n++; h1 += `<th class="grp" colspan="${n}">${c.g}</th>`; } h2 += leaf(c); } else h1 += leaf(c, true); });
    const D = B.add.D;
    const body = (D ? draftHtml(D) : '') + [...groups.entries()].map(([k, list]) => (k ? `<tr class="gh"><td colspan="${vc.length}"><b>${esc(k)}</b> <span>${list.length}건${avg(list) ? ' · ' + esc(avg(list)) : ''}</span></td></tr>` : '') + list.map(x => rowHtml(x, nos.get(x.id), RO)).join('')).join('');
    const empty = !H.items().length ? `<tr><td colspan="${vc.length}" class="none"><b>아직 등록한 매물이 없습니다</b>위 칸에 주소를 치고 Enter를 눌러 보세요. 건물 정보가 자동으로 채워집니다.</td></tr>`
      : !rows.length && !D ? `<tr><td colspan="${vc.length}" class="none">${H.items().some(x => catOf(x) === B.cat) ? '조건에 맞는 매물이 없습니다.' : `아직 ${esc(CATNAME[B.cat])} 매물이 없습니다. 위 칸에 주소를 치고 Enter를 눌러 보세요.`}</td></tr>` : '';
    $('bdT').innerHTML = `<div class="bd-scroll"><table class="bdt cat-${B.cat}"><thead><tr>${h1}</tr><tr>${h2}</tr></thead><tbody>${body}${empty}</tbody></table></div>`;   // 10/28 ▾ 거르기 줄 · 여러 건 선택 막대는 없앰
    wireTable();
    fixCols();
    if (D) wireDraft(D);
    H.pins(rows.map(x => x.id), B.map && B.fitNext); if (B.map) B.fitNext = false;
    const ed = B.ed && $('bdT').querySelector('td.editing .ced');
    if (ed && document.activeElement !== ed) { ed.focus(); if (ed.select && ed.type !== 'date') ed.select(); }
    drawHist();
  }
  function wireTable() {
    const T = $('bdT');
    T.querySelectorAll('th[data-sort]').forEach(h => h.onclick = () => { const s = h.dataset.sort; if (B.sort === s) B.dir *= -1; else { B.sort = s; B.dir = ['at', 'pr', 'ar', 'memo', 'h'].includes(s) ? -1 : 1; } keep(); refresh(); });
    T.querySelectorAll('a[data-call]').forEach(a => a.onclick = e => { e.stopPropagation(); callLog(a.dataset.call); });
    T.querySelectorAll('[data-pubm]').forEach(b => b.onclick = e => { e.stopPropagation(); H.pubClick(b.dataset.pubm, b); });
    // 10/30 맨 앞 '매물' ●/○: 누르면 매물(진행) ↔ 매물 아님(보류 — 지도 광고는 서버가 내림) · 기록은 남기지 않음
    T.querySelectorAll('[data-mkd]').forEach(b => { b.ondblclick = e => e.stopPropagation(); b.onclick = e => {
      e.stopPropagation(); const x = H.items().find(i => i.id === b.dataset.mkd); if (!x) return;
      const on = x.status !== 'on';
      if (!on && x.pub && x.pub.on && !confirm('리얼맵 지도에 게시 중인 매물입니다. 매물에서 해제하면 지도에서도 내려갑니다. 해제할까요?')) return;
      saveItem(x.id, it => { it.status = on ? 'on' : 'hold'; }, on ? '매물로 등록했습니다' : '매물에서 해제했습니다');
    }; });
    // 10/29 한 번 누르면 줄 선택만 · 두 번(더블클릭)·Enter = 입력창 · 10/30 손가락도 두 번(기기마다 같게)
    T.querySelectorAll('tr[data-id]').forEach(r => {
      r.onpointerup = e => { r._pt = e.pointerType; };
      r.onclick = e => {
        if (e.target.closest('input,button,a,select,textarea')) return;
        selRow(r.dataset.id);
        if (r._pt === 'touch') { const t = Date.now(); if (B.tap && B.tap.k === r.dataset.id && t - B.tap.t < 450) { B.tap = null; openPanel(r.dataset.id); H.focus(r.dataset.id); } else B.tap = { k: r.dataset.id, t }; }   // 10/30 손가락도 두 번 눌러야 엶 (기기마다 같게)
      };
      r.ondblclick = e => {
        if (e.target.closest('input,button,a,select,textarea')) return;
        try { getSelection().removeAllRanges(); } catch { /* 무시 */ }
        openPanel(r.dataset.id); H.focus(r.dataset.id);
      };
    });
    if (!B.kbd) { B.kbd = true; document.addEventListener('keydown', kbdNav); }
  }
  function selRow(id) {
    B.selId = id; const T = $('bdT'); if (!T) return;
    T.querySelectorAll('tr.sel').forEach(z => z.classList.remove('sel'));
    const tr = T.querySelector(`tr[data-id="${CSS.escape(id)}"]`); if (tr) { tr.classList.add('sel'); tr.scrollIntoView({ block: 'nearest' }); }
  }
  function kbdNav(e) {   // ↑↓ 줄 옮기기 · Enter 입력창 · Esc 닫기 (칸에 쓰는 중이 아닐 때)
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const T = $('bdT'); if (!T || !T.offsetParent) return;
    const a = document.activeElement; if (a && (/INPUT|TEXTAREA|SELECT/.test(a.tagName) || a.isContentEditable)) return;
    if (document.querySelector('.sheet:not([hidden])')) return;
    const ids = [...T.querySelectorAll('tr[data-id]')].map(r => r.dataset.id); if (!ids.length) return;
    let i = ids.indexOf(B.selId);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); i = i < 0 ? 0 : Math.max(0, Math.min(ids.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1))); selRow(ids[i]); }
    else if (e.key === 'Enter' && i >= 0) { e.preventDefault(); openPanel(ids[i]); H.focus(ids[i]); }
    else if (e.key === 'Escape' && B.pk) { e.preventDefault(); closePanel(); }
  }
  function toggle(id) { B.open.has(id) ? B.open.delete(id) : B.open.add(id); B.hl = id; refresh(); }
  function startEdit(id, c, td) {
    const x = H.items().find(i => i.id === id); if (!x) return;
    hidePop();
    const col = VC().find(z => z.id === c); if (!col) return;
    if (col.ed === 'det') { B.open.add(id); B.hl = id; refresh(); return; }   // 건축물대장·임대 현황 값은 상세에서
    if (['kd', 'ps', 'pj', 'pdep', 'prent', 'prp'].includes(c)) return pricePop(x, td);
    if (['rk', 'stage', 'form', 'mid'].includes(c)) return choicePop(x, td, c);
    if (c === 'st') return statusPop(x, td);
    if (c === 'ty') return typePop(x, td);
    if (c === 'ar' && places(x).length > 1) { B.open.add(id); refresh(); return H.toast('필지·호가 여러 개인 매물은 상세에서 하나씩 고칩니다'); }
    B.ed = { id, c }; B.hl = id; refresh();
  }
  function commit(inp, move) {
    if (!B.ed) return;
    const { id, c } = B.ed, v = String(inp.value || '').trim(), x = H.items().find(i => i.id === id);
    let next = null;
    const NAV = VC().filter(z => z.ed === 'in').map(z => z.id);
    if (move === 'next' || move === 'prev') { const i = NAV.indexOf(c) + (move === 'next' ? 1 : -1); if (i >= 0 && i < NAV.length) next = { id, c: NAV[i] }; }
    else if (move === 'down') { const ids = [...$('bdT').querySelectorAll('tr[data-id]')].map(r => r.dataset.id), k = ids.indexOf(id); if (c === 'tel') next = null; else if (k >= 0 && ids[k + 1]) next = { id: ids[k + 1], c }; }
    B.ed = next;
    if (!x) return refresh();
    const a = x.ad || {}, cs = (x.contacts || [])[0] || {};
    const money = (f, ok) => { const n = man(v); if (Number.isNaN(n) || n < 0) { H.toast('금액을 확인해 주세요 (예: 3000, 1억)'); return refresh(); } if ((n || null) === (x[f] || null)) return refresh(); return saveItem(id, it => { it[f] = n; if (ok) ok(it, n); }); };
    if (c === 'ar') { const n = parseFloat(v.replace(/[^\d.]/g, '')) || null; if (n === (x.area || null)) return refresh(); return saveItem(id, it => { it.places[0].area = n; it.area = n; }); }
    if (c === 'fl') {
      const [f, t] = v.split('/').map(s => s.trim()); const fl = (f || '').replace(/층$/i, '').replace(/^지하\s*/, 'B').replace(/f$/i, ''), tfl = t ? parseInt(t, 10) || null : (a.tfl ?? null);
      if (fl === String(a.fl || '') && tfl === (a.tfl ?? null)) return refresh();
      return saveItem(id, it => { it.ad = { ...(it.ad || {}), fl, tfl }; });
    }
    if (c === 'tel') {
      const m = v.match(/0\d{1,2}[-\s]?\d{3,4}[-\s]?\d{4}/), phone = m ? m[0].replace(/\s/g, '-') : '', name = (m ? v.replace(m[0], '') : v).trim().slice(0, 20);
      if (name === (cs.name || '') && phone.replace(/\D/g, '') === String(cs.phone || '').replace(/\D/g, '')) return refresh();
      return saveItem(id, it => { const c0 = it.contacts[0] || { role: '소유자' }; it.contacts[0] = { ...c0, name, phone: fmtPhone(phone) }; if (!name && !phone) it.contacts.shift(); });
    }
    if (c === 'imp') { if (v === (x.imp || '')) return refresh(); return saveItem(id, it => { it.imp = v; }); }   // 날짜는 서버가 글에서 찾아 impd로
    if (c === 'biz' || c === 'dir') { if (v === (a[c] || '')) return refresh(); return saveItem(id, it => { it.ad = { ...(it.ad || {}), [c]: v }; }); }
    if (c === 'exp') { const d = /^\d{4}-\d{2}-\d{2}$/.test(v) && +v.slice(0, 4) >= 2000 ? v : ''; if (v && !d) { H.toast('날짜를 확인해 주세요 (예: 2027-03-31)'); return refresh(); } if (d === (x.exp || '')) return refresh(); return saveItem(id, it => { it.exp = d; }); }
    if (c === 'prem') return money('premium');
    if (c === 'mgmt') return money('mgmt');
    if (c === 'loan') return money('loan');
    if (c === 'cdep') return money('curDep');
    if (c === 'crent') { const n = parseInt(v.replace(/\D/g, ''), 10) || null; if (n === (x.curRent || null)) return refresh(); return saveItem(id, it => { it.curRent = n; }); }
    // 재개발·재건축 · 분양권 칸 (모두 ad 안)
    const adSet = (k, nv) => { if ((nv ?? '') === (a[k] ?? '')) return refresh(); return saveItem(id, it => { it.ad = { ...(it.ad || {}), [k]: nv }; }); };
    if (['apv', 'rgt', 'mvl', 'down'].includes(c)) { const n = man(v); if (Number.isNaN(n) || n < 0) { H.toast('금액을 확인해 주세요 (예: 3000, 1억)'); return refresh(); } return adSet(c, n || null); }
    if (c === 'jsh') return adSet('jshare', parseFloat(v.replace(/[^\d.]/g, '')) || null);
    if (['rz', 'msh', 'due', 'resale'].includes(c)) return adSet(c, v);
    refresh();
  }
  // ---------- 기록 창 (10/26 아파트 '상담 기록'과 같은 방식) ----------
  //   화면 오른쪽에 떠 있는 창 · 직접 쓴 기록은 [고치기]·[×] · 가격·상태 등 바뀐 내용과 전화는 자동으로 남음(회색)
  //   기록은 매물의 memo 칸('[26.10.26 15:00] 내용' 줄들) 그대로 — 매물 카드의 메모와 같은 것
  const AUTO = /^(변경|상태|전화) · /;
  const nowT = () => { const d = new Date(Date.now() + 9 * 3600e3), p = n => String(n).padStart(2, '0'); return `${String(d.getUTCFullYear()).slice(2)}.${p(d.getUTCMonth() + 1)}.${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`; };
  const memoJoin = a => a.map(e => e.t ? `[${e.t}] ${e.x}` : a.length > 1 ? `[예전 메모] ${e.x}` : e.x).join('\n');
  function drawHist() {
    const x = B.hist && H.items().find(i => i.id === B.hist);
    let P = $('bd_hp');
    if (!x) { if (P) P.remove(); B.hist = null; return; }
    if (!P) { P = document.createElement('aside'); P.id = 'bd_hp'; P.className = 'hpanel bdhp'; $('bd').appendChild(P); }
    else if (P.dataset.id === x.id && P.contains(document.activeElement) && /INPUT|TEXTAREA/.test(document.activeElement.tagName) && document.activeElement.value) return;   // 쓰는 중인 글이 지워지지 않게
    P.dataset.id = x.id;
    const RO = X.ro().has(x.id), L = X.memoParse(x.memo), cs = (x.contacts || []).filter(c => c.name || c.phone);
    const title = [x.bname, shortAddr(places(x)[0].addr || x.addr), places(x).map(dh).filter(Boolean)[0]].filter(Boolean).join(' · ');
    const pr = mainP(x) ? `${X.KIND[x.kind]} ${x.kind === 'wolse' ? `${cw(x.deposit) || 0}/${x.rent || '-'}` : cw(mainP(x))}` : X.KIND[x.kind];
    P.innerHTML = `<div class="hp-h"><b>${esc(title)}</b><span>${esc(chip(x))} · ${esc(pr)} · ${esc(X.STAT[x.status])}</span><button type="button" class="hp-x" id="bdhp_x" aria-label="닫기">×</button></div>
      ${cs.length ? `<div class="hp-tel">${cs.map((c, i) => `<a class="tl" href="tel:${esc(String(c.phone || '').replace(/[^\d+]/g, ''))}" data-call="${x.id}:${i}">☎ ${esc([c.role, c.name].filter(Boolean).join(' '))} ${esc(c.phone || '')}</a>`).join('')}</div>` : ''}
      ${RO ? '' : `<div class="hjmemo"><input class="hjin sm" id="bdhp_in" data-fk="hp:${x.id}" placeholder="기록 남기기 (예: 임차인 통화 — 3월 이사) · Enter" maxlength="500"><button type="button" class="btn dark sm" id="bdhp_add">추가</button></div>`}
      ${L.length ? `<ul class="hjhist">${L.map((e, i) => { const au = AUTO.test(e.x); return `<li class="${au ? 'e-auto' : 'e-memo'}"><span class="t">${esc(e.t || '예전 메모')}</span><span class="hx" data-hi="${i}">${esc(e.x)}</span>${RO ? '' : `${au ? '' : `<button type="button" class="un" data-medit="${i}">고치기</button>`}<button type="button" class="x" data-mdel="${i}" aria-label="지우기">×</button>`}</li>`; }).join('')}</ul>` : '<p class="note">아직 기록이 없습니다.</p>'}
      <p class="note">가격·상태를 바꾸거나 전화를 걸면 자동으로 남습니다(회색).</p>`;
    $('bdhp_x').onclick = () => { B.hist = null; refresh(); };
    P.querySelectorAll('[data-call]').forEach(a => a.onclick = () => callLog(a.dataset.call));
    if (RO) return;
    const add = () => { const t = $('bdhp_in').value.trim(); if (!t) return $('bdhp_in').focus(); $('bdhp_in').value = ''; saveItem(x.id, it => { it.memo = X.memoAdd(it.memo, t); }, '기록했습니다'); };
    $('bdhp_add').onclick = add; $('bdhp_in').onkeydown = e => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); add(); } };   // 10/30 기록 = 직접 쓰고 Enter 또는 [추가]
    P.querySelectorAll('[data-mdel]').forEach(b => b.onclick = () => { if (!confirm('이 기록을 지울까요?')) return; const i = +b.dataset.mdel; saveItem(x.id, it => { const a = X.memoParse(it.memo); a.splice(i, 1); it.memo = memoJoin(a); }); });
    P.querySelectorAll('[data-medit]').forEach(b => b.onclick = () => {
      const i = +b.dataset.medit, sp = P.querySelector(`.hx[data-hi="${i}"]`), e0 = L[i]; if (!sp || !e0) return;
      const raw = e0.x.replace(/\s*\(수정됨 [\d. :]+\)$/, '');
      sp.innerHTML = `<textarea class="hjin sm hed" maxlength="500" rows="2">${esc(raw)}</textarea><button type="button" class="btn dark sm hsv">저장</button><button type="button" class="btn ghost sm hcn">취소</button>`;
      const ta = sp.querySelector('textarea'); ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length);
      const save = () => { const t = ta.value.trim(); if (!t) return H.toast('내용을 적어 주세요. 지우려면 × 를 눌러 주세요'); if (t === raw) return drawHist(); saveItem(x.id, it => { const a = X.memoParse(it.memo); if (a[i]) a[i] = { ...a[i], x: `${t} (수정됨 ${nowT()})` }; it.memo = memoJoin(a); }, '고쳤습니다'); };
      sp.querySelector('.hsv').onclick = save; sp.querySelector('.hcn').onclick = () => drawHist();
      ta.onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); save(); } if (e.key === 'Escape') drawHist(); };
    });
  }
  // 전화 버튼 → 기록에 '전화 · 소유자 홍길동' (전화는 그대로 걸림)
  function callLog(k) {
    const [id, n] = String(k).split(':'), x = H.items().find(i => i.id === id); if (!x || X.ro().has(id)) return;
    const c = (x.contacts || [])[+n] || {};
    void c;   // 10/30 전화 걸 때 자동 기록 안 남김
  }
  // 저장할 때 바뀐 내용 → 기록 한 줄 (가격·거래·상태·현상태·만기·유형)
  const prTx = x => x.kind === 'sale' ? `매매 ${cw(x.price) || '-'}` : x.kind === 'jeonse' ? `전세 ${cw(x.deposit) || '-'}` : x.kind === 'wolse' ? `월세 ${cw(x.deposit) || 0}/${x.rent || '-'}` : `분양권 ${cw(x.price) || '-'}${x.pr ? ' P' + cw(x.pr) : ''}`;
  function autoLines(a, b) {
    if (a || !a) return [];   // 10/30 선배 결정: 바뀐 내용은 기록에 자동으로 남기지 않음 (직접 쓴 기록만) — 아래는 예전 방식
    const out = [];
    if (a.kind !== b.kind || (a.price || 0) !== (b.price || 0) || (a.deposit || 0) !== (b.deposit || 0) || (a.rent || 0) !== (b.rent || 0) || (a.pr || 0) !== (b.pr || 0)) out.push(`변경 · ${prTx(a)} → ${prTx(b)}`);
    if ((a.premium || 0) !== (b.premium || 0)) out.push(`변경 · 권리금 ${cw(a.premium) || '없음'} → ${cw(b.premium) || '없음'}`);
    if ((a.curDep || 0) !== (b.curDep || 0) || (a.curRent || 0) !== (b.curRent || 0)) out.push(`변경 · 현 보증금·월세 ${cw(a.curDep) || 0}/${a.curRent || 0} → ${cw(b.curDep) || 0}/${b.curRent || 0}`);
    if ((a.exp || '') !== (b.exp || '')) out.push(`변경 · 만기 ${ymdS(a.exp) || '없음'} → ${ymdS(b.exp) || '없음'}`);
    if (a.status !== b.status) out.push(`상태 · ${X.STAT[a.status]} → ${X.STAT[b.status]}`);
    if ((a.ptype || '') !== (b.ptype || '')) out.push(`변경 · 유형 ${a.ptype || '미지정'} → ${b.ptype || '미지정'}`);
    return out;
  }

  // ---------- 작은 창 (가격 · 상태 · 유형) ----------
  function showPop(td, html) {
    const p = $('bdPop'), r = td.getBoundingClientRect(), box = EL.getBoundingClientRect();
    p.innerHTML = html; p.hidden = false;
    const z = parseFloat(getComputedStyle($('bd')).zoom) || 1;
    p.style.left = `${Math.max(8, Math.min((r.left - box.left) / z, (box.width / z) - p.offsetWidth - 12))}px`;
    p.style.top = `${(r.bottom - box.top + EL.scrollTop) / z + 4}px`;
    return p;
  }
  function hidePop() { const p = $('bdPop'); if (p && !p.hidden) { p.hidden = true; p.innerHTML = ''; } }
  function statusPop(x, td) {
    const p = showPop(td, `<div class="pl">${[['on', '진행 중'], ['hold', '보류'], ['done', '거래완료']].map(([k, t]) => `<button type="button" data-s="${k}" class="${x.status === k ? 'on' : ''}">${t}</button>`).join('')}</div>`);
    p.querySelectorAll('[data-s]').forEach(b => b.onclick = async () => {
      hidePop(); const st = b.dataset.s; if (st === x.status) return;
      saveItem(x.id, it => { it.status = st; }, `'${X.STAT[st]}' 처리했습니다`);   // 10/26: 기록에 '상태 · 진행 → 보류'가 남도록 저장으로
    });
  }
  function typePop(x, td) {
    const p = showPop(td, `<div class="pl grid">${X.PTYPES.map(t => `<button type="button" data-t="${t}" class="${x.ptype === t ? 'on' : ''}">${t}</button>`).join('')}</div>`);
    p.querySelectorAll('[data-t]').forEach(b => b.onclick = () => { hidePop(); setPType(x, b.dataset.t); });
  }
  function setPType(x, t) {
    if (t === x.ptype) return; const to = catOf({ ...x, ptype: t }); const b0 = tb(x); saveItem(x.id, it => { it.ptype = t; if (/^재(개발|건축)$/.test(t) && !(it.ad || {}).form) it.ad = { ...(it.ad || {}), form: t === '재건축' ? '아파트' : X.formOf(b0) }; }, to !== B.cat ? `${CATNAME[to]} 탭으로 옮겼습니다` : '');
    if (to !== B.cat) { B.cat = to; B.tr = null; if (H.onCat) H.onCat(B.cat); keep(); refresh(); }   // 10/29 실제로 그 탭으로 옮겨 보여 줌(입력창은 그대로)
  }
  // 재개발·재건축 구분 · 단계 · 물건 형태 · 분양권 중도금 — 골라서 바로 저장 (10/26)
  function choicePop(x, td, c) {
    const a = x.ad || {};
    const OPT = { rk: ['재개발', '재건축'], stage: STAGES, form: X.FORMS, mid: ['무이자', '이자후불', '자납'] }[c];
    const cur = c === 'rk' ? x.ptype : a[c];
    const p = showPop(td, `<div class="pl">${OPT.map(t => `<button type="button" data-o="${esc(t)}" class="${cur === t ? 'on' : ''}">${esc(t)}</button>`).join('')}${c !== 'rk' && cur ? '<button type="button" data-o="" class="clr">지우기</button>' : ''}</div>
      ${c === 'mid' ? `<div class="pp"><label>메모<input data-mt="1" value="${esc(a.midTx || '')}" maxlength="12" placeholder="예: 60%, 6회차"></label><div class="pb"><span class="hint">Enter 저장</span><button type="button" class="ok">저장</button></div></div>` : ''}`);
    const save = (v, tx) => {
      hidePop();
      if (c === 'rk') { if (v === x.ptype) return; return saveItem(x.id, it => { it.ptype = v; if (!(it.ad || {}).form) it.ad = { ...(it.ad || {}), form: v === '재건축' ? '아파트' : '빌라' }; }); }
      const nx = { ...a, [c]: v }; if (c === 'mid') nx.midTx = tx ?? a.midTx ?? '';
      if (nx[c] === (a[c] || '') && (c !== 'mid' || nx.midTx === (a.midTx || ''))) return;
      saveItem(x.id, it => { it.ad = { ...(it.ad || {}), ...nx }; });
    };
    p.querySelectorAll('[data-o]').forEach(b => b.onclick = () => save(b.dataset.o, c === 'mid' ? p.querySelector('[data-mt]').value.trim() : undefined));
    const mt = p.querySelector('[data-mt]');
    if (mt) { const ok = () => save(a.mid || '', mt.value.trim()); p.querySelector('.ok').onclick = ok; mt.onkeydown = e => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); ok(); } if (e.key === 'Escape') hidePop(); }; }
  }
  const PF = { sale: [['price', '매매가']], jeonse: [['deposit', '전세 보증금']], wolse: [['deposit', '보증금'], ['rent', '월세']], presale: [['price', '분양가'], ['pr', '프리미엄(P)']] };
  function pricePop(x, td) {
    let kind = x.kind;
    const draw = () => {
      const p = showPop(td, `<div class="pp"><div class="bsg sm">${Object.entries(X.KIND).map(([k, t]) => `<button type="button" data-k="${k}" aria-pressed="${kind === k}">${t}</button>`).join('')}</div>
        ${PF[kind].map(([k, t]) => `<label>${t}<input data-m="${k}" inputmode="text" value="${esc(manTx(kind === x.kind ? x[k] : (k === 'deposit' && x.kind !== 'sale' ? x.deposit : k === 'price' && ['sale', 'presale'].includes(x.kind) ? x.price : '')))}" placeholder="${k === 'rent' ? '320' : '예) 3억2천, 68억'}"><small data-h="${k}"></small></label>`).join('')}
        ${kind !== 'presale' ? `<label>관리비<input data-m="mgmt" value="${esc(manTx(x.mgmt))}" placeholder="월, 만원"><small data-h="mgmt"></small></label>` : ''}
        <div class="pb"><span class="hint">만원 단위 · '억' '천' 써도 됩니다</span><button type="button" class="ok">저장</button></div></div>`);
      p.querySelectorAll('[data-k]').forEach(b => b.onclick = () => { kind = b.dataset.k; draw(); });
      const hint = i => { const v = man(i.value), h = p.querySelector(`[data-h="${i.dataset.m}"]`); if (h) h.textContent = Number.isNaN(v) ? '숫자를 확인해 주세요' : v ? X.won(v) : ''; };
      p.querySelectorAll('[data-m]').forEach(i => { hint(i); i.oninput = () => hint(i); i.onkeydown = e => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); ok(); } if (e.key === 'Escape') hidePop(); }; });
      const ok = () => {
        const vals = {}; let bad = false;
        p.querySelectorAll('[data-m]').forEach(i => { const v = man(i.value); if (Number.isNaN(v) || (v < 0 && i.dataset.m !== 'pr')) bad = true; vals[i.dataset.m] = v; });   // 마이너스는 분양권 프리미엄만
        if (bad) return H.toast('금액을 확인해 주세요 (예: 3억2천, 5000)');
        hidePop();
        const to = catOf({ ...x, kind });
        saveItem(x.id, it => { it.kind = kind; Object.assign(it, vals); }, to !== B.cat ? `${CATNAME[to]} 탭으로 옮겼습니다` : '');
      };
      p.querySelector('.ok').onclick = ok;
      const f = p.querySelector('[data-m]'); if (f) { f.focus(); f.select(); }
    };
    draw();
  }

  // ---------- 오른쪽 입력창 (10/28 5단계: 아파트 화면과 같은 방식 — 줄을 누르면 열림 · 고치는 길은 여기 하나) ----------
  //   위에서부터 상태 · 거래·가격 · 현상태(또는 층별 현황 · 필지 · 재개발 · 분양권) · 연락처 · 챙길 것 · ▸ 건물 정보 · 기록
  //   칸을 고치고 나가면(또는 Enter) 바로 저장 — 저장 방식은 예전 상세(wireDetail)와 같음
  function openPanel(id) { B.pk = id; B.hl = id; hidePop(); refresh(); }
  function closePanel() { B.pk = null; refresh(); }
  function drawPanel() {
    const W = $('bd_rpw'); if (!W) return;
    const x = B.pk && H.items().find(i => i.id === B.pk);
    if ($('bdLay')) $('bdLay').classList.remove('rpon');   // 10/29 입력창은 표 위에 떠 있음 (표는 넓은 그대로)
    if (!x) { W.innerHTML = ''; return; }
    const id = x.id, RO = X.ro().has(id), dis = RO ? 'disabled' : '', a = x.ad || {}, k = detKind(x), cat = catOf(x);
    const inp = (key, v, ph = '', more = '') => `<input class="rpi" data-fk="p:${id}:${key}" data-pv="${key}" value="${esc(v ?? '')}" placeholder="${esc(ph)}" ${more} ${dis}>`;
    const fld = (t, inner) => `<label class="rpf"><span>${t}</span>${inner}</label>`;
    const row = (t, inner, cls = '') => `<div class="rpr ${cls}"><b>${t}</b><div class="rpv">${inner}</div></div>`;
    const seg = (g, list, cur) => `<span class="rpseg" data-g="${g}">${list.map(([v, t]) => `<button type="button" data-v="${esc(v)}" aria-pressed="${cur === v}" ${dis}>${t}</button>`).join('')}</span>`;
    const sel = (key, opts, cur) => `<select class="rpi" data-ps="${key}" ${dis}><option value="">-</option>${opts.map(o => `<option ${cur === o ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
    const P0 = places(x)[0] || {}, sub = [chip(x), x.area ? pyt(x.area).replace('.0평', '평') : '', k === 'unit' ? flTx(a.fl) : ''].filter(Boolean).join(' · ');
    const title = [x.bname || shortAddr(P0.addr || x.addr), places(x).map(dh).filter(Boolean)[0]].filter(Boolean).join(' ');
    // 거래 · 가격
    const kinds = cat === 'pre' ? [['presale', '분양권']] : [['sale', '매매'], ['jeonse', '전세'], ['wolse', '월세']];
    // 10/29 금액은 만원 단위 숫자만 · 옆에 '21억 5,000만'처럼 읽어 줌 (예시 글씨 없음)
    const won = (key, v, neg = false) => { const n = v ? Math.round(+v) : ''; return `<span class="wonw"><input class="rpi rpw" data-fk="p:${id}:${key}" data-pv="${key}" data-won${neg ? '="neg"' : ''} value="${n}" inputmode="numeric" ${dis}><i class="u">만원</i><i class="wonh">${esc(window.wonH ? window.wonH(n) : '')}</i></span>`; };
    let body = '';   // 10/29 상태 칸(진행·보류·거래완료) 없앰 — 매물번호는 제목줄로
    // 10/29 금액 칸은 두 개씩 한 줄 (거래 | 첫 금액 · 나머지 둘씩)
    const won2 = (key, v, neg) => won(key, v, neg).replace('class="rpi rpw"', 'class="rpi rpw" style="width:72px"');
    const cells = [...(PF[x.kind] || PF.sale).map(([f, t]) => [t.replace('전세 ', '').replace('프리미엄(P)', 'P'), won2('$' + f, x[f], f === 'pr')]),
      ...(cat === 'shop' ? [['권리금', won2('$premium', x.premium)]] : []),
      ...(x.kind === 'presale' ? [['납입액', won2('$paid', x.paid)]] : [])];
    const pair = (a, b) => `<div class="rpr rpr2 mk"><b>${a[0]}</b><div class="rpv">${a[1]}</div>${b ? `<b>${b[0]}</b><div class="rpv">${b[1]}</div>` : '<b></b><div></div>'}</div>`;
    const all = kinds.length > 1 ? [['거래', seg('kind', kinds, x.kind)], ...cells] : cells;
    for (let i = 0; i < all.length; i += 2) body += pair(all[i], all[i + 1]);
    // 10/30 선배: 관리비 = 금액 + 부과 방식(사용량에 따라 · 관리규약에 따라 · 모름) + 없음 / 융자 = 금액 + 없음 — 한 줄씩
    if (x.kind !== 'presale' && k !== 'land') body += `<div class="rpr mk"><b>관리비</b><div class="rpv rpmg">${a.nomgmt ? '<span class="rpno">관리비 없음</span>' : won2('$mgmt', x.mgmt)}${a.nomgmt ? '' : `<span class="rpseg">${[['use', '사용량에 따라'], ['rule', '관리규약에 따라'], ['unk', '모름']].map(([v, t]) => `<button type="button" data-mgt="${v}" aria-pressed="${a.mgmtT === v}" ${dis}>${t}</button>`).join('')}</span>`}<label class="rpck"><input type="checkbox" data-fb="nomgmt" ${a.nomgmt ? 'checked' : ''} ${dis}> 없음</label></div></div>`;
    if (x.kind === 'sale' && k !== 'unit') body += `<div class="rpr mk"><b>융자</b><div class="rpv rpmg">${a.noloan ? '<span class="rpno">융자 없음</span>' : won2('$loan', x.loan)}<label class="rpck"><input type="checkbox" data-fb="noloan" ${a.noloan ? 'checked' : ''} ${dis}> 없음</label><label class="rpck" title="손님에게 보여 주는 자료에 융자를 넣지 않음"><input type="checkbox" data-fb="loanHide" ${a.loanHide ? 'checked' : ''} ${dis}> 표시 안 함</label></div></div>`;
    body += panelInfo(x, RO);   // 10/30 선배: 정보는 융자 바로 아래 → 층별 현황·현상태 → 연락처 → 챙길 것 → 기록
    // 재개발·재건축
    if (cat === 'redev') {
      const pm = premOf(x);
      body += row('재개발', `<div class="rprow">${seg('rk', [['재개발', '재개발'], ['재건축', '재건축']], x.ptype)}</div><div class="rpg">${fld('구역명', inp('ad:rz', a.rz))}${fld('단계', sel('stage', STAGES, a.stage))}${fld('물건 형태', sel('form', X.FORMS, a.form))}${fld('대지지분 ㎡', inp('ad:jshare', a.jshare, '㎡', 'inputmode="decimal"'))}${fld('감정가', won('ad:apv', a.apv))}${fld('권리가액', won('ad:rgt', a.rgt))}${fld('조합원 분양', inp('ad:msh', a.msh))}${fld('이주비', won('ad:mvl', a.mvl))}</div>${pm != null ? `<p class="rpn">프리미엄(매매가 − 권리가액) <b>${pm < 0 ? '-' : ''}${cw(Math.abs(pm))}</b></p>` : ''}`);
    }
    // 분양권
    if (cat === 'pre') body += row('분양권', `<div class="rpg">${fld('계약금', won('ad:down', a.down))}${fld('중도금', sel('mid', ['무이자', '이자후불', '자납'], a.mid))}${fld('중도금 메모', inp('ad:midTx', a.midTx))}${fld('입주 예정', inp('ad:due', a.due))}${fld('전매 가능일', inp('ad:resale', a.resale))}</div>`);
    // 현상태 (호·층 단위 매물)
    if (k === 'unit' && cat !== 'pre') {
      const y = yields(x, x.curDep, x.curRent);
      const ex = inp('exp', /^\d{4}-\d{2}-\d{2}$/.test(x.exp || '') ? x.exp : '', '', 'type="date" style="width:118px"');   // 10/29 두 칸씩 한 줄
      body += `<div class="rpr rpr2"><b>현 보증금</b><div class="rpv">${won2('$curDep', x.curDep)}</div><b>월세</b><div class="rpv">${won2('$curRent', x.curRent)}</div></div>`
        + `<div class="rpr rpr2"><b>만기</b><div class="rpv">${ex}</div>${cat === 'shop' ? `<b>업종</b><div class="rpv">${inp('ad:biz', a.biz, '', 'title="업종 또는 공실"')}</div>` : '<b></b><div></div>'}</div>`
        + (y ? `<p class="rpn" style="padding:0 8px">연 수익률 <b>${y.y.toFixed(2)}%</b> (매매가 − 현 보증금 기준)</p>` : '');
    }
    // 층별 현황 (통건물·공장)
    if (k === 'whole') {
      const R0 = x.rents || [], R = [...R0, ...Array(B.blank.get(id) || 0).fill({})], s = rentSum(x), y = yields(x, s.d, s.r);
      const ri = (i, kk, v, ph) => `<input class="rpi" data-fk="r:${id}:${i}:${kk}" data-ri="${i}" data-rk="${kk}" value="${esc(v ?? '')}" placeholder="${ph}" ${dis}>`;
      body += `<div class="rps"><h4>층별 현황${RO ? '' : `<button type="button" class="rplnk" data-a="floors" style="margin-left:auto">${R0.length ? '다시 깔기' : '건축물대장에서 불러오기'}</button>`}</h4>
        ${R.length ? `<div class="rpfl"><div class="fh"><span>층</span><span>임차인 · 업종</span><span>보증금</span><span>월세</span><span>만기</span><span></span></div>${R.map((r, i) => `<div class="fr${/공실/.test(r.label || '') ? ' vac' : ''}" title="${esc([r.use, r.area ? m2t(r.area) : ''].filter(Boolean).join(' · '))}">${ri(i, 'fl', r.fl, '')}${ri(i, 'label', r.label, '')}${ri(i, 'deposit', manTx(r.deposit), '')}${ri(i, 'rent', r.rent ? r.rent.toLocaleString() : '', '')}${ri(i, 'exp', r.exp, '')}${RO ? '<span></span>' : `<button type="button" class="rpdel" data-rdel="${i}" aria-label="이 줄 지우기">×</button>`}</div>`).join('')}</div>` : '<p class="rpn">아직 층별 현황이 없습니다.</p>'}
        ${RO ? '' : '<button type="button" class="rplnk" data-a="radd">＋ 줄 추가</button>'}
        <p class="rpn">보증금 <b>${s.d ? sw(s.d) : '0'}</b> · 월세 <b>${s.r ? s.r.toLocaleString() : '0'}</b> · 공실 <b>${s.v}개 층</b>${y ? ` · 수익률 <b class="yl">${y.y.toFixed(2)}%</b>${y.y2 != null ? ` (융자 반영 ${y.y2.toFixed(2)}%)` : ''}` : ''}</p></div>`;
    }
    // 필지 (토지)
    if (k === 'land') {
      const pl = places(x), tot = pl.reduce((s0, p) => s0 + (p.area || 0), 0);
      pl.forEach(p => { if (p.pnu && !B.L[p.pnu]) landOf(p.pnu); });
      body += `<div class="rps"><h4>필지</h4>
        <div class="rppl">${pl.map((p, i) => { const c = B.L[p.pnu]; return `<div class="pr"><span><b>${esc(shortAddr(p.addr))}</b> <small>${esc(c && c !== 'loading' ? [c.jimok, zoneS([c.zone1, c.zone2].filter(Boolean).join(' · '))].filter(Boolean).join(' · ') : '')}</small></span><input class="rpi" data-fk="pa:${id}:${i}" data-pa="${i}" value="${p.area || ''}" placeholder="㎡" ${dis}>${pl.length > 1 && !RO ? `<button type="button" class="rpdel" data-pdel="${i}" aria-label="이 필지 빼기">×</button>` : '<span></span>'}</div>`; }).join('')}</div>
        ${RO ? '' : `<input class="rpi" data-fk="pq:${id}" data-pq="${id}" placeholder="＋ 필지 추가: 지번을 치고 Enter" style="margin-top:6px"><div class="pres" data-pres="${id}">${B.add.pres && B.add.pres.id === id ? presHtml(B.add.pres.res) : ''}</div>`}
        <p class="rpn">합계 <b>${m2t(Math.round(tot * 100) / 100)}</b> (${pyt(tot)})${x.kind === 'sale' && x.price && tot ? ` · 평당 <b>${sw(x.price / (tot / PY))}</b>` : ''}</p></div>`;
    } else if (cat !== 'pre') {
      // 10/30 선배: 토지 말고도 주소 추가 — 건물·공장 = 필지 더하기(대지) · 상가·사무실·주택 = 호수 더하기(같은 건물) 또는 다른 건물 주소
      const pl = places(x), W = k === 'whole', tot = pl.reduce((s0, p) => s0 + (p.area || 0), 0);
      const lb = (p, i) => W ? (i === 0 ? '건물' : (p.land || p.ak === 'land') ? '대지' : '') : '';
      const nm = p => [shortAddr(p.addr), dh(p)].filter(Boolean).join(' ');
      body += `<div class="rps"><h4>${W ? '필지' : '주소 · 호수'} <small>${pl.length}곳</small></h4>
        <div class="rppl">${pl.map((p, i) => `<div class="pr"><span><b>${esc(nm(p) || '(주소 없음)')}</b> <small>${esc(lb(p, i))}</small></span>${W && i === 0 ? '<span></span>' : `<input class="rpi" data-fk="pa:${id}:${i}" data-pa="${i}" value="${p.area || ''}" placeholder="${W ? '대지㎡' : '전용㎡'}" ${dis}>`}${pl.length > 1 && !RO ? `<button type="button" class="rpdel" data-pdel="${i}" aria-label="빼기">×</button>` : '<span></span>'}</div>`).join('')}</div>
        ${RO ? '' : `<input class="rpi" data-fk="pq:${id}" data-pq="${id}" data-pqk="${W ? 'land' : 'ho'}" placeholder="${W ? '＋ 필지 추가: 지번을 치고 Enter (예: 12-3)' : '＋ 호수 추가: 호수를 치고 Enter (예: 102호) · 다른 건물은 주소'}" style="margin-top:6px"><div class="pres" data-pres="${id}">${B.add.pres && B.add.pres.id === id ? presHtml(B.add.pres.res) : ''}</div>`}
        ${!W && pl.length > 1 && tot ? `<p class="rpn">전용 합계 <b>${m2t(Math.round(tot * 100) / 100)}</b> (${pyt(tot)})</p>` : ''}</div>`;
    }
    // 연락처
    const cs = [...(x.contacts || []), ...Array(B.cblank.get(id) || 0).fill({ role: '소유자' })];
    body += row('연락처', `<div class="rptels">${cs.map((c, i) => `<div class="rptel"><select class="rpi lb" data-ci="${i}" data-cf="role" ${dis}>${H.roles.map(r => `<option ${c.role === r ? 'selected' : ''}>${r}</option>`).join('')}</select><input class="rpi" data-fk="c:${id}:${i}:name" data-ci="${i}" data-cf="name" value="${esc(c.name || '')}" placeholder="이름" ${dis}><input class="rpi" data-fk="c:${id}:${i}:phone" data-ci="${i}" data-cf="phone" value="${esc(c.phone || '')}" placeholder="번호" inputmode="tel" ${dis}>${c.phone ? `<a class="rpcall" href="tel:${esc(String(c.phone).replace(/[^\d+]/g, ''))}" data-call="${id}:${i}">전화</a>` : '<span></span>'}${RO ? '' : `<button type="button" class="rpdel" data-cdel="${i}" aria-label="지우기">×</button>`}</div>`).join('')}</div>${RO ? '' : '<button type="button" class="rplnk" data-a="cadd">＋ 추가</button>'}`);
    body += row('챙길 것', inp('imp', x.imp, '', 'maxlength="100"'));
    // 10/29 정보 칸(접지 않음)은 10/30 융자 바로 아래로 옮김
    // 기록
    const L = X.memoParse(x.memo);
    body += row('기록', RO ? '' : `<div class="rpin2 h"><input class="rpi" id="bdrp_hin" data-fk="hp:${id}" placeholder="기록 내용 쓰고 Enter" maxlength="500"><button type="button" class="rpb sm" id="bdrp_hadd">추가</button></div>`);
    body += L.length ? `<ul class="rph">${L.map((e, i) => { const au = AUTO.test(e.x); return `<li class="${au ? 'e-auto' : 'e-memo'}"><span class="t">${esc(e.t || '예전 메모')}</span><span class="hx" data-hi="${i}">${esc(e.x)}</span>${RO ? '' : `<span>${au ? '' : `<button type="button" class="un" data-medit="${i}">고치기</button>`}<button type="button" class="x" data-mdel="${i}" aria-label="지우기">×</button></span>`}</li>`; }).join('')}</ul>` : '';
    const cu = H.custFor && (H.custFor(x) || []).length ? custBox(x) : '';   // 맞는 고객이 있을 때만
    W.innerHTML = `<aside class="rpanel rpwin" id="bd_rp"><div class="rp-h"><b>${esc(title)}</b>${RO ? '' : `<button type="button" class="rpnm" id="bdrp_nm" title="이름 고치기 (단지·건물 이름 — 예: ○○리브하임2차)" aria-label="이름 고치기">✎</button>`}${sub ? `<span class="rptg">${esc(sub)}</span>` : ''}${RO ? '' : '<button type="button" class="rpty" id="bdrp_ty" title="상가→사무실처럼 매물 유형을 바꿉니다">유형 바꾸기 ▾</button>'}${x.no ? (RO ? `<small class="rpno">No. ${esc(x.no)}</small>` : `<button type="button" class="rpno" id="bdrp_no" title="매물번호 · 누르면 고치기 (규칙은 설정 → 우리 사무소)">No. ${esc(x.no)}</button>`) : ''}${RO || (H.canDel && !H.canDel()) ? '' : '<button type="button" class="rpdh" data-a="del" title="이 매물 삭제">삭제</button>'}<button type="button" class="rp-x" id="bdrp_x" aria-label="닫기 (Esc)">×</button></div>
      ${RO ? '' : `<div class="rptyl" id="bdrp_tyl" hidden><div>${X.PTYPES.map(t => `<button type="button" data-rty="${t}" aria-pressed="${x.ptype === t}">${t}</button>`).join('')}</div></div>`}
      ${RO ? '<p class="rpwarn">요금제 한도를 넘은 매물이라 보기만 됩니다</p>' : ''}
      <div class="rpbody">${body}${cu ? `<div class="rps bdcu">${cu}</div>` : ''}</div>
      <div class="rp-f"><span class="svd">✓ 자동 저장됨</span><button type="button" class="rpb y" id="bdrp_close">저장</button></div></aside>`;
    { const A = $('bd_rp'); if (A && window.RpWin) { window.RpWin.place(A); window.RpWin.drag(A); } }
    wirePanel(W, x, RO);
  }
  function wirePanel(W, x, RO) {
    const id = x.id, P = $('bd_rp');
    // 10/30 선배: 주소로 올렸어도 이름(단지·건물명)을 직접 넣을 수 있게 — 아파트 화면 개별매물·표 '단지명/물건명'에 그대로 나옴
    if ($('bdrp_nm')) $('bdrp_nm').onclick = e => { e.stopPropagation(); const v = prompt('이름 (단지·건물 이름)\n비우면 주소로 보입니다', x.bname || ''); if (v == null) return; const t = v.trim().slice(0, 40); if (t === (x.bname || '')) return; saveItem(id, it => { it.bname = t; it.places.forEach(P => { P.bname = t; }); }, t ? `이름을 '${t}'(으)로 바꿨습니다` : '이름을 지웠습니다'); };
    if ($('bdrp_ty')) $('bdrp_ty').onclick = e => { e.stopPropagation(); const L = $('bdrp_tyl'); L.hidden = !L.hidden; };   // 10/29 칸 바로 고치기를 없앤 뒤 유형을 바꿀 곳이 없어 입력창 머리에 둠
    W.querySelectorAll('[data-rty]').forEach(b => b.onclick = () => { $('bdrp_tyl').hidden = true; setPType(x, b.dataset.rty); });
    $('bdrp_x').onclick = closePanel;
    // 10/29 [저장]: 칸은 고칠 때마다 저장되지만, 쓰던 칸을 마저 저장하고 '저장했습니다'를 보여 준 뒤 닫음
    { let done = false; const sv = e => { if (e && e.type === 'pointerdown') e.preventDefault(); if (done) return; done = true; const a = document.activeElement; if (a && P.contains(a) && a.blur) a.blur(); setTimeout(() => { closePanel(); H.toast('저장했습니다'); }, 150); }; $('bdrp_close').onpointerdown = sv; $('bdrp_close').onclick = sv; }
    P.onkeydown = e => { if (e.key === 'Escape' && !e.target.closest('.rph textarea')) { e.preventDefault(); closePanel(); } };
    if ($('bdrp_no')) $('bdrp_no').onclick = () => {
      const b = $('bdrp_no'), i = document.createElement('input'); i.className = 'rpi rpnoi'; i.value = x.no || ''; i.maxLength = 20; b.replaceWith(i); i.focus(); i.select();
      let done = false; const fin = ok => { if (done) return; done = true; const v = i.value.trim(); if (ok && v && v !== x.no) saveItem(id, it => { it.no = v; }, '매물번호를 바꿨습니다'); else refresh(); };
      i.onkeydown = e => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); fin(true); } if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); fin(false); } };
      i.onblur = () => fin(true);
    };
    P.querySelectorAll('[data-mv]').forEach(b => b.onclick = () => { const i = P.querySelector('[data-fd="movein"]'); if (!i) return; i.value = i.value === b.dataset.mv ? '' : b.dataset.mv; i.dispatchEvent(new Event('change')); });
    P.querySelectorAll('a[data-call]').forEach(a => a.onclick = () => callLog(a.dataset.call));
    wireDetail(P, x);   // 연락처 · 층별 · 필지 · 건물 정보 칸 · 브리핑 · 삭제 (예전 상세와 같은 저장)
    if (RO) return;
    // 상태 · 거래 · 재개발 구분
    P.querySelectorAll('[data-g] [data-v]').forEach(b => b.onclick = () => {
      const g = b.parentNode.dataset.g, v = b.dataset.v;
      if (g === 'st') { if (v === x.status) return; return saveItem(id, it => { it.status = v; }, `'${X.STAT[v]}' 처리했습니다`); }
      if (g === 'kind') { if (v === x.kind) return; return saveItem(id, it => { it.kind = v; }); }
      if (g === 'rk') { if (v === x.ptype) return; return saveItem(id, it => { it.ptype = v; if (!(it.ad || {}).form) it.ad = { ...(it.ad || {}), form: v === '재건축' ? '아파트' : '빌라' }; }); }
    });
    P.querySelectorAll('select[data-ps]').forEach(s => s.onchange = () => saveItem(id, it => { it.ad = { ...(it.ad || {}), [s.dataset.ps]: s.value }; }));
    // 칸 하나씩: 고치고 나가면(또는 Enter) 저장
    P.querySelectorAll('input[data-pv]').forEach(i => {
      i.onkeydown = e => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); i.blur(); } };
      i.onchange = () => setTimeout(() => {
        const key = i.dataset.pv, v = i.value.trim(), cur = H.items().find(z => z.id === id) || x;
        const mon = f => { const n = man(v); if (Number.isNaN(n) || (n < 0 && f !== 'pr')) return H.toast('금액을 확인해 주세요 (예: 3000, 1억)'); if ((n || null) === (cur[f] || null)) return; saveItem(id, it => { it[f] = n; }); };
        if (key === '$rent' || key === '$curRent') { const n = parseInt(v.replace(/\D/g, ''), 10) || null; const f = key.slice(1); if (n === (cur[f] || null)) return; return saveItem(id, it => { it[f] = n; }); }
        if (key[0] === '$') return mon(key.slice(1));
        if (key === 'exp') { const d = /^\d{4}-\d{2}-\d{2}$/.test(v) && +v.slice(0, 4) >= 2000 ? v : ''; if (v && !d) return H.toast('날짜를 확인해 주세요'); if (d === (cur.exp || '')) return; return saveItem(id, it => { it.exp = d; }); }
        if (key === 'imp') { if (v === (cur.imp || '')) return; return saveItem(id, it => { it.imp = v; }); }
        if (key.startsWith('ad:')) {
          const f = key.slice(3), ca = cur.ad || {};
          const nv = ['apv', 'rgt', 'mvl', 'down'].includes(f) ? man(v) : f === 'jshare' ? (parseFloat(v.replace(/[^\d.]/g, '')) || null) : v;
          if (Number.isNaN(nv)) return H.toast('금액을 확인해 주세요 (예: 3000, 1억)');
          if ((nv ?? '') === (ca[f] ?? '')) return;
          return saveItem(id, it => { it.ad = { ...(it.ad || {}), [f]: nv || (typeof nv === 'string' ? '' : null) }; });
        }
      }, 0);
    });
    // 기록
    const add = () => { const t = $('bdrp_hin').value.trim(); if (!t) return $('bdrp_hin').focus(); $('bdrp_hin').value = ''; saveItem(id, it => { it.memo = X.memoAdd(it.memo, t); }, '기록했습니다'); };
    if ($('bdrp_hadd')) { $('bdrp_hadd').onclick = add; $('bdrp_hin').onkeydown = e => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); add(); } }; }   // 10/30 기록 = 직접 쓰고 Enter 또는 [추가]
    P.querySelectorAll('[data-mdel]').forEach(b => b.onclick = () => { if (!confirm('이 기록을 지울까요?')) return; const i = +b.dataset.mdel; saveItem(id, it => { const a = X.memoParse(it.memo); a.splice(i, 1); it.memo = memoJoin(a); }); });
    P.querySelectorAll('[data-medit]').forEach(b => b.onclick = () => {
      const L = X.memoParse(x.memo), i = +b.dataset.medit, sp = P.querySelector(`.hx[data-hi="${i}"]`), e0 = L[i]; if (!sp || !e0) return;
      const raw = e0.x.replace(/\s*\(수정됨 [\d. :]+\)$/, '');
      sp.innerHTML = `<textarea class="rpi" maxlength="500" rows="2">${esc(raw)}</textarea><button type="button" class="rpb sm hsv">저장</button> <button type="button" class="rpb sm hcn">취소</button>`;
      const ta = sp.querySelector('textarea'); ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length);
      const save = () => { const t = ta.value.trim(); if (!t) return H.toast('내용을 적어 주세요. 지우려면 × 를 눌러 주세요'); if (t === raw) return refresh(); saveItem(id, it => { const a = X.memoParse(it.memo); if (a[i]) a[i] = { ...a[i], x: `${t} (수정됨 ${nowT()})` }; it.memo = memoJoin(a); }, '고쳤습니다'); };
      sp.querySelector('.hsv').onclick = save; sp.querySelector('.hcn').onclick = () => refresh();
      ta.onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); save(); } if (e.key === 'Escape') { e.stopPropagation(); refresh(); } };
    });
  }

  // ---------- 상세 (줄 아래로 펼침) ----------
  function detailHtml(x) {
    const k = detKind(x), RO = X.ro().has(x.id);
    const top = k === 'whole' ? floorsHtml(x, RO) : k === 'land' ? parcelsHtml(x, RO) : '';
    const L = X.memoParse(x.memo), ph = x.photos || [];
    return `<div class="dt">${top}
      <div class="dg"><div class="box">${infoHtml(x, RO)}</div>
        <div class="box">${contactsHtml(x, RO)}
          ${custBox(x)}
          <div class="dt-h" style="margin-top:8px"><b>기록</b><small>${L.length ? `${esc(L[0].t || '예전')} ${esc(L[0].x.slice(0, 40))}` : '아직 없음'}</small><button type="button" class="lnk" data-a="hist">기록 창 열기${L.length ? ` (${L.length})` : ''} ▸</button></div></div></div>
      <div class="dt-acts">
        ${ph.length ? `<span class="phs">${ph.slice(0, 4).map((p, i) => `<button type="button" data-ph="${i}"><img src="${esc(p.url)}" alt="" loading="lazy"></button>`).join('')}${ph.length > 4 ? `<small>+${ph.length - 4}</small>` : ''}</span>` : '<button type="button" class="b" data-a="card">사진 추가 ▸</button>'}
        <button type="button" class="b" data-a="brief">브리핑</button>
        <a class="b" href="/?pnu=${esc(x.pnu || places(x)[0].pnu)}" target="_blank" rel="noopener">필지 정보 ↗</a>
        <span class="sp"></span><small class="meta">No. ${esc(x.no || '')} · 등록 ${X.ymd(x.at)}</small>
        <button type="button" class="b" data-a="card">매물카드 전체 수정</button>
        ${H.canDel && !H.canDel() ? "" : '<button type="button" class="b del" data-a="del">삭제</button>'}</div></div>`;
  }
  // 정보 칸 (바로 수정) — 회색 = 건축물대장 자동 · 노란색 = 리얼맵 필수인데 빔 · 점선 = 직접 입력
  const AUTOK = ['use', 'tfl', 'appr', 'park', 'zone'];
  const MKEY = { '방향': 'dir', '입주 가능일': 'movein', '방 수': 'rooms', '욕실 수': 'baths', '관리비': '#mgmt', '관리비 포함 항목': '#mgmt', '건축물 용도': 'use', '지목': 'use', '총 층수': 'flt', '해당 층': 'flt', '사용승인일': 'appr', '주차 대수': 'park', '면적': '$area' };
  const BKOK = { office: 1, addr: 1, regno: 1, ceo: 1, tel: 1 };
  function fieldsOf(x) {
    const k = detKind(x), pt = tb(x), res = /아파트|빌라|오피스텔|주택/.test(pt || ''), shop = pt === '상가' || pt === '사무실';
    const M = X.moneyOf(x).map(m => m[0]);
    const LB = { '#mgmt': '관리비 (월·만원)', '#premium': '권리금', '#curDep': '기보증금', '#curRent': '기월세', '#loan': x.kind === 'presale' ? '중도금 대출' : '융자', '#paid': '납입액' };
    if (k === 'land') return [['use', '지목'], ['zone', '용도지역']];
    const f = k === 'whole' ? [['use', '건축물 용도'], ['tfl', '총 층수 (지상)'], ['appr', '사용승인일'], ['dir', '방향 (출입구)'], ['movein', '입주 가능일'], ['park', '주차']]
      : [['$area', '전용면적 ㎡'], ['flt', '층 / 총층'], ['use', '건축물 용도'], ['dir', res ? '방향 (거실)' : '방향 (출입구)'], ['movein', '입주 가능일'], ['park', '주차'], ['appr', '사용승인일']];
    if (res && k !== 'whole') f.push(['rooms', '방 수'], ['baths', '욕실 수']);
    if (shop) f.push(['biz', '현재 업종'], ['wc', '화장실']);
    ['#mgmt', '#premium', ...(k === 'whole' ? [] : ['#curDep', '#curRent', '#loan']), '#paid'].forEach(key => { if (M.includes(key.slice(1)) && !(k === 'whole' && key === '#loan')) f.push([key, LB[key]]); });
    return f;
  }
  function infoHtml(x, RO) {
    const a = x.ad || {}, P = places(x)[0], dis = RO ? 'disabled' : '';
    const miss = H.canPub() && x.status === 'on' ? X.adMissing(x, BKOK) : [];
    const need = new Set(miss.map(m => MKEY[m]).filter(Boolean));
    const val = key => key === '$area' ? (x.area || '') : key === 'flt' ? [a.fl, a.tfl].filter(v => v != null && v !== '').join(' / ') : key[0] === '#' ? manTx(x[key.slice(1)]) : (a[key] ?? '');
    const fk = key => `f:${x.id}:${key}`;
    const ctl = (key, v, cls) => key === 'dir' ? `<select class="v ${cls}" data-fd="dir" ${dis}><option value="">선택</option>${H.dirs.map(d => `<option ${a.dir === d ? 'selected' : ''}>${d}</option>`).join('')}</select>`
      : key === 'wc' ? `<select class="v ${cls}" data-fd="wc" ${dis}><option value="">선택</option>${H.wcs.map(d => `<option ${a.wc === d ? 'selected' : ''}>${d}</option>`).join('')}</select>`
      : `<input class="v ${cls}" data-fk="${fk(key)}" data-fd="${key}" value="${esc(v)}" placeholder="${need.has(key) ? '입력 필요' : ''}" ${key === 'movein' ? 'list="bdMv"' : ''} ${dis}>`;
    /* 10/28 금액(관리비·권리금·현 보증금 등)은 입력창 위쪽 칸에서 */
    const cells = fieldsOf(x).filter(([key]) => key[0] !== '#').map(([key, lb]) => { const v = val(key); const cls = need.has(key) ? 'nd' : AUTOK.includes(key) && v !== '' ? 'au' : ''; return `<label>${lb}${ctl(key, v, cls)}</label>`; }).join('');
    const pk = P.pnu && P.ho ? `${P.pnu}|${P.dong || ''}|${P.ho}` : '';
    if (pk && B.U[pk] === undefined && /아파트|빌라|오피스텔|주택/.test(tb(x) || '')) hoPrice(P, pk);
    const gp = pk && B.U[pk] && B.U[pk].price;
    const y = detKind(x) === 'unit' ? yields(x, x.curDep, x.curRent) : null;
    const badge = !H.canPub() || x.status !== 'on' || X.pubLive(x) ? '' : miss.length ? `<em class="nd">리얼맵 등록까지 ${miss.length}칸 남음</em>` : '<em class="ok">리얼맵 필수 항목 모두 채움 → 줄 끝 [리얼맵 등록]</em>';
    const canFill = !RO && miss.some(m => ['건축물 용도', '사용승인일', '주차 대수', '총 층수', '지목'].includes(m));
    return `<div class="dt-h"><b>${esc(chip(x))} 정보</b>${badge}${canFill ? '<button type="button" class="lnk" data-a="autofill">건축물대장으로 빈 칸 채우기</button>' : ''}${detKind(x) === 'unit' && places(x).length ? `<small>${esc(places(x).map(dh).filter(Boolean).join(', '))}${gp ? ` · 공시가격 ${sw(gp.price / 1e4)} (${gp.year})` : ''}</small>` : ''}</div>
      <div class="kv2">${cells}</div>
      ${detKind(x) === 'unit' && /아파트|빌라|오피스텔|주택/.test(tb(x) || '') ? `<label class="nm"><input type="checkbox" data-fb="nomgmt" ${a.nomgmt ? 'checked' : ''} ${dis}> 관리비 없음</label>` : ''}
      ${y ? `<div class="sums"><span class="y">연 수익률 <b>${y.y.toFixed(2)}%</b> <small>(매매가 − 기보증금 ${sw(y.inv)} 기준)</small></span>${y.y2 != null ? `<span>융자 반영 (금리 <input class="ci r w4" data-rate="1" value="${B.rate}" inputmode="decimal">%) <b>${y.y2.toFixed(2)}%</b></span>` : ''}</div>` : ''}
      <datalist id="bdMv"><option value="즉시입주"><option value="협의"></datalist>`;
  }
  // 10/29 입력창 '정보' 칸 (시안 '정보칸_시안'): 직접 넣는 칸만 칸으로 · 대장에서 자동으로 채운 값은 회색 한 줄 + [자동입력사항 고치기] → 10/30 처음부터 펼침
  function panelInfo(x, RO) {
    const a = x.ad || {}, dis = RO ? 'disabled' : '', id = x.id, k = detKind(x);
    const miss = H.canPub() && x.status === 'on' && !X.pubLive(x) ? X.adMissing(x, BKOK) : [];
    const need = new Set(miss.map(m => MKEY[m]).filter(Boolean));
    const F = fieldsOf(x).filter(([key]) => key[0] !== '#'), has = key => F.some(f => f[0] === key);
    const val = key => key === '$area' ? (x.area || '') : key === 'flt' ? [a.fl, a.tfl].filter(v => v != null && v !== '').join(' / ') : (a[key] ?? '');
    const SH = { '$area': '전용 ㎡', flt: '층 / 총층', dir: '향', rooms: '방', baths: '욕실', biz: '업종', wc: '화장실', movein: '입주 가능일', use: '용도', tfl: '총 층수', appr: '사용승인일', park: '주차', zone: '용도지역' };
    const lb = key => SH[key] || (F.find(f => f[0] === key) || [, key])[1];
    const cls = key => need.has(key) ? 'nd' : '';
    const ph = key => need.has(key) ? '입력' : '';
    const ctl = key => key === 'dir' ? `<select class="rpi ${cls(key)}" data-fd="dir" ${dis}><option value="">-</option>${H.dirs.map(d => `<option ${a.dir === d ? 'selected' : ''}>${d}</option>`).join('')}</select>`
      : key === 'wc' ? `<select class="rpi ${cls(key)}" data-fd="wc" ${dis}><option value="">-</option>${H.wcs.map(d => `<option ${a.wc === d ? 'selected' : ''}>${d}</option>`).join('')}</select>`
      : `<input class="rpi ${cls(key)}" data-fk="f:${id}:${key}" data-fd="${key}" value="${esc(val(key))}" placeholder="${ph(key)}" ${['rooms', 'baths'].includes(key) ? 'inputmode="numeric" maxlength="2"' : ''} ${dis}>`;
    const fld = key => `<label class="rpf"><span>${lb(key)}</span>${ctl(key)}</label>`;
    const auto = F.map(f => f[0]).filter(key => AUTOK.includes(key));
    const own = F.map(f => f[0]).filter(key => !AUTOK.includes(key) && key !== 'movein' && !(key === 'biz' && k === 'unit' && catOf(x) === 'shop'));   // 상가 업종은 위 '현상태'에 있음
    // 10/30 선배: 리얼맵 등록에 필요한 칸은 입력창에서 빠짐없이 — 이 종류 칸 목록에 없더라도(예: 통주택의 방·욕실) 필요하면 넣음
    for (const key of need) if (!key.startsWith('#') && !key.startsWith('$') && key !== 'flt' && !own.includes(key) && !AUTOK.includes(key) && key !== 'movein') own.push(key);
    const rows = [];
    const g2 = ['$area', 'flt'].filter(has); if (g2.length) rows.push(`<div class="rpg">${g2.map(fld).join('')}</div>`);
    const rest = own.filter(key => !g2.includes(key));
    for (let i = 0; i < rest.length; i += 3) rows.push(`<div class="rpg c3">${rest.slice(i, i + 3).map(fld).join('')}</div>`);
    if (has('movein')) { const mv = a.movein || ''; rows.push(`<label class="rpf"><span>입주 가능일</span><div class="rpmv"><span class="rpseg">${['즉시입주', '협의'].map(t => `<button type="button" data-mv="${t}" aria-pressed="${mv === t}" ${dis}>${t === '즉시입주' ? '즉시' : t}</button>`).join('')}</span><input class="rpi ${cls('movein')}" data-fk="f:${id}:movein" data-fd="movein" value="${esc(['즉시입주', '협의'].includes(mv) ? '' : mv)}" placeholder="${need.has('movein') ? '또는 날짜 (입력)' : '또는 날짜'}" ${dis}></div></label>`); }
    // 10/30 관리비 없음은 위 관리비 줄로 옮김
    const canFill = !RO && miss.some(m => ['건축물 용도', '사용승인일', '주차 대수', '총 층수', '지목'].includes(m));
    // 10/30 선배: 자동으로 채운 칸도 접지 않고 처음부터 다 펼쳐서 (두 칸씩 · 사용승인일이 잘리지 않게) (다른 칸과 똑같이 바로 고침) · 대장에서 채우기는 빈 칸이 있을 때만
    if (auto.length) { for (let i = 0; i < auto.length; i += 2) rows.push(`<div class="rpg">${auto.slice(i, i + 2).map(fld).join('')}</div>`); if (canFill) rows.push('<div class="rpfill"><button type="button" class="rplnk" data-a="autofill">빈 칸 건축물대장에서 채우기</button></div>'); }
    const y = k === 'unit' ? yields(x, x.curDep, x.curRent) : null;
    if (y) rows.push(`<div class="sums"><span class="y">연 수익률 <b>${y.y.toFixed(2)}%</b></span>${y.y2 != null ? `<span>융자 반영 (금리 <input class="ci r w4" data-rate="1" value="${B.rate}" inputmode="decimal">%) <b>${y.y2.toFixed(2)}%</b></span>` : ''}</div>`);
    const left = need.size ? `<em class="rpleft">${need.size}칸 남음</em>` : '';
    return `<div class="rpr rpinfo"><b>${k === 'land' ? '토지' : '정보'}${left}</b><div class="rpv">${rows.join('')}</div></div>`;
  }
  // 이 매물에 맞는 고객 (고객관리에서 찾는 중인 고객)
  function custBox(x) {
    const L = H.custFor ? H.custFor(x) : null;
    if (L == null) return '';
    return `<div class="dt-h" style="margin-top:12px"><b>맞는 고객 ${L.length}명</b></div>
      ${L.length ? `<div class="cmx">${L.slice(0, 5).map(c => `<div><b>${esc(c.name)}</b><small>${esc(c.line)}${c.g === 'over' ? ` · <em>예산 +${sw(c.over)}</em>` : ''}</small>${c.phone ? `<a class="tl" href="tel:${esc(String(c.phone).replace(/\D/g, ''))}" title="전화">☎</a>` : ''}<button type="button" class="b2" data-gcu="${c.id}">이동</button></div>`).join('')}${L.length > 5 ? `<div class="meta">외 ${L.length - 5}명</div>` : ''}</div>` : '<div class="meta">아직 맞는 고객이 없습니다</div>'}`;
  }
  function contactsHtml(x, RO) {
    const cs = [...(x.contacts || []), ...Array(B.cblank.get(x.id) || 0).fill({ role: '소유자' })], dis = RO ? 'disabled' : '';
    return `<div class="dt-h"><b>연락처</b></div><div class="ct">${cs.map((c, i) => `<div><select class="ci" data-ci="${i}" data-cf="role" ${dis}>${H.roles.map(r => `<option ${c.role === r ? 'selected' : ''}>${r}</option>`).join('')}</select>
      <input class="ci" data-fk="c:${x.id}:${i}:name" data-ci="${i}" data-cf="name" value="${esc(c.name || '')}" placeholder="이름" ${dis}><input class="ci" data-fk="c:${x.id}:${i}:phone" data-ci="${i}" data-cf="phone" value="${esc(c.phone || '')}" placeholder="010-0000-0000" inputmode="tel" ${dis}>
      ${c.phone ? `<a class="tl" href="tel:${esc(String(c.phone).replace(/[^\d+]/g, ''))}" title="전화 걸기">☎</a>` : ''}${RO ? '' : `<button type="button" class="x" data-cdel="${i}" aria-label="이 연락처 지우기">×</button>`}</div>`).join('')}
      ${RO ? '' : '<button type="button" class="lnk" data-a="cadd">＋ 연락처 추가</button>'}</div>`;
  }
  // 통건물 · 공장: 층별 현황
  function floorsHtml(x, RO) {
    const R0 = x.rents || [], R = [...R0, ...Array(B.blank.get(x.id) || 0).fill({})], s = rentSum(x), y = yields(x, s.d, s.r), dis = RO ? 'disabled' : '';
    const inp = (i, k, v, ph, cls = '') => `<input class="ci ${cls}" data-fk="r:${x.id}:${i}:${k}" data-ri="${i}" data-rk="${k}" value="${esc(v ?? '')}" placeholder="${ph}" ${dis}>`;
    return `<div class="dt-h"><b>층별 현황</b><small>층·용도·면적은 건축물대장에서 자동 · 임차인·보증금·월세·만기만 넣으면 합계와 수익률이 계산됩니다</small>
        ${RO ? '' : `<button type="button" class="lnk" data-a="floors">${R0.length ? '건축물대장으로 다시 깔기' : '건축물대장 층별 정보 불러오기'}</button>`}</div>
      ${R.length ? `<table class="ft"><thead><tr><th>층</th><th>용도</th><th class="r">면적㎡</th><th>임차인 · 업종</th><th class="r">보증금</th><th class="r">월세</th><th>만기</th><th>메모</th><th></th></tr></thead><tbody>
        ${R.map((r, i) => `<tr class="${/공실/.test(r.label || '') ? 'vac' : ''}"><td>${inp(i, 'fl', r.fl, '1F', 'w4')}</td><td>${inp(i, 'use', r.use, '용도')}</td><td>${inp(i, 'area', r.area, '', 'r w6')}</td>
          <td>${inp(i, 'label', r.label, '상호 · 업종 / 공실')}</td><td>${inp(i, 'deposit', manTx(r.deposit), '만원', 'r w7')}</td><td>${inp(i, 'rent', r.rent ? r.rent.toLocaleString() : '', '만원', 'r w6')}</td>
          <td>${inp(i, 'exp', r.exp, 'YY.MM', 'w6')}</td><td>${inp(i, 'memo', r.memo, '')}</td><td>${RO ? '' : `<button type="button" class="x" data-rdel="${i}" aria-label="이 줄 지우기">×</button>`}</td></tr>`).join('')}
        </tbody></table>${RO ? '' : '<button type="button" class="lnk" data-a="radd">＋ 줄 추가</button>'}` : '<div class="meta" style="padding:6px 2px">아직 층별 현황이 없습니다.</div>'}
      <div class="sums"><span>보증금 합계 <b>${s.d ? sw(s.d) : '0'}</b></span><span>월세 합계 <b>${s.r ? sw(s.r) : '0'}</b></span><span>공실 <b>${s.v}개 층</b></span>
        ${y ? `<span class="y">연 수익률 <b>${y.y.toFixed(2)}%</b> <small>(매매가 − 보증금 ${sw(y.inv)} 기준)</small></span>` : x.kind === 'sale' ? '<span class="meta">매매가와 월세를 넣으면 수익률이 나옵니다</span>' : ''}
        ${x.kind === 'sale' ? `<span class="loan">융자 <input class="ci r w7" data-fk="l:${x.id}" data-loan="${x.id}" value="${esc(manTx(x.loan))}" placeholder="만원" ${dis}> 금리 <input class="ci r w4" data-rate="1" value="${B.rate}" inputmode="decimal">%${y && y.y2 != null ? ` → 융자 반영 <b>${y.y2.toFixed(2)}%</b> <small>(실투자 ${sw(y.inv2)})</small>` : ''}</span>` : ''}</div>`;
  }
  // 토지: 필지별
  function parcelsHtml(x, RO) {
    const pl = places(x), tot = pl.reduce((a, p) => a + (p.area || 0), 0);
    pl.forEach(p => { if (p.pnu && !B.L[p.pnu]) landOf(p.pnu); });
    const lpSum = pl.reduce((a, p) => { const c = B.L[p.pnu]; return a + (c && c.price && p.area ? c.price * p.area : 0); }, 0);
    return `<div class="dt-h"><b>필지</b></div>
      <table class="ft"><thead><tr><th>지번</th><th>지목</th><th class="r">면적㎡</th><th>용도지역</th><th class="r">공시지가 ㎡당</th><th>도로</th><th>형상</th><th></th></tr></thead><tbody>
      ${pl.map((p, i) => { const c = B.L[p.pnu]; const v = c === 'loading' ? '<span class="meta">불러오는 중…</span>' : null; return `<tr><td>${esc(shortAddr(p.addr))}</td><td>${v || esc(c && c.jimok || '')}</td>
        <td class="r"><input class="ci r w7" data-fk="pa:${x.id}:${i}" data-pa="${i}" value="${p.area || ''}" ${RO ? 'disabled' : ''}></td><td>${v ? '' : esc(c && [c.zone1, c.zone2].filter(Boolean).join(' · ') || '')}</td>
        <td class="r">${c && c.price ? c.price.toLocaleString() + '원' : ''}</td><td>${esc(c && c.road || '')}</td><td>${esc(c && c.shape || '')}</td>
        <td>${pl.length > 1 && !RO ? `<button type="button" class="x" data-pdel="${i}" aria-label="이 필지 빼기">×</button>` : ''}</td></tr>`; }).join('')}
      </tbody></table>
      ${RO ? '' : `<div class="padd"><input class="in" data-fk="pq:${x.id}" data-pq="${x.id}" placeholder="＋ 필지 추가: 지번을 치고 Enter (예: ${esc(shortAddr(pl[0].addr).replace(/\s?\S+$/, '') || '상암동')} 12-3)"><div class="pres" data-pres="${x.id}">${B.add.pres && B.add.pres.id === x.id ? presHtml(B.add.pres.res) : ''}</div></div>`}
      <div class="sums"><span>합계 <b>${m2t(Math.round(tot * 100) / 100)}</b> (${pyt(tot)})</span>${x.kind === 'sale' && x.price && tot ? `<span class="y">평당 <b>${sw(x.price / (tot / PY))}</b></span>` : ''}${lpSum ? `<span>공시지가 합계 <b>${sw(lpSum / 1e4)}</b></span>` : ''}</div>`;
  }
  const presHtml = res => !res ? '' : res === 'busy' ? '<div class="meta">찾는 중…</div>' : !res.length ? '<div class="meta">찾지 못했습니다. 동 이름과 지번을 함께 넣어 보세요.</div>' : res.map((r, i) => `<button type="button" data-pr="${i}"><b>${esc(r.t)}</b> <small>${esc(r.s)}</small></button>`).join('');
  function wireDetail(r, x) {
    if (!x) return;
    const id = x.id;
    const RO = X.ro().has(id);
    r.querySelectorAll('[data-a]').forEach(b => b.onclick = async e => {
      e.stopPropagation();
      const a = b.dataset.a;
      if (a === 'card') return H.openForm(id);
      if (a === 'hist') { B.hist = id; B.hl = id; return refresh(); }
      if (a === 'cadd') { B.cblank.set(id, (B.cblank.get(id) || 0) + 1); refresh(); const q = $('bd').querySelector(`[data-fk="c:${id}:${(x.contacts || []).length + B.cblank.get(id) - 1}:name"]`); if (q) q.focus(); return; }
      if (a === 'brief') return H.brief(id);
      if (a === 'del') {
        if (!confirm(`이 매물을 삭제할까요?\n${shortAddr(places(x)[0].addr)} ${X.KIND[x.kind]}\n삭제하면 되돌릴 수 없습니다.`)) return;
        try { H.took(await H.api('/api/auth?action=listing', H.post({ op: 'del', id }))); B.open.delete(id); if (B.pk === id) B.pk = null; H.redraw(); H.toast('삭제했습니다'); } catch (er) { H.toast(er.message, 4000); }
        return;
      }
      if (a === 'floors') return refillFloors(x);
      if (a === 'autofill') {
        b.disabled = true; b.textContent = '채우는 중…';
        try {
          const P0 = places(x)[0], it0 = await autoItem({ pnu: P0.pnu || x.pnu, dong: P0.dong, ho: P0.ho, ptype: x.ptype, form: (x.ad || {}).form, area: x.area });
          let n = 0; saveItem(id, it => { const ad = it.ad || (it.ad = {}); for (const [k, v] of Object.entries(it0.ad || {})) if ((ad[k] == null || ad[k] === '') && v != null && v !== '') { ad[k] = v; n++; } }).then(() => H.toast(n ? `빈 칸 ${n}개를 채웠습니다` : '건축물대장에도 없는 값입니다. 직접 넣어 주세요'));
        } catch { H.toast('건축물대장을 불러오지 못했습니다', 3500); refresh(); }
        return;
      }
      if (a === 'radd') { B.blank.set(id, (B.blank.get(id) || 0) + 1); refresh(); const q = $('bd').querySelector(`[data-fk="r:${id}:${(x.rents || []).length + B.blank.get(id) - 1}:fl"]`); if (q) q.focus(); return; }
    });
    r.querySelectorAll('[data-ph]').forEach(b => b.onclick = () => H.viewer(x.photos.map(p => p.url), +b.dataset.ph));
    r.querySelectorAll('[data-gcu]').forEach(b => b.onclick = e => { e.stopPropagation(); H.goCust(b.dataset.gcu); });
    const mnew = r.querySelector('[data-mnew]');
    if (mnew) mnew.onkeydown = e => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); const v = mnew.value.trim(); if (!v) return; mnew.value = ''; saveItem(id, it => { it.memo = X.memoAdd(it.memo, v); }, '메모를 기록했습니다'); } };
    if (RO) return;
    // 정보 칸: 고치고 나가면(또는 Enter) 저장
    r.querySelectorAll('[data-fd]').forEach(i => {
      i.onkeydown = e => { if (e.key === 'Enter' && !e.isComposing && i.tagName === 'INPUT') { e.preventDefault(); i.blur(); } };
      i.onchange = () => setTimeout(() => {
        const key = i.dataset.fd, v = i.value.trim();
        if (key === '$area') { const n = parseFloat(v.replace(/[^\d.]/g, '')) || null; return saveItem(id, it => { if (it.places.length === 1) it.places[0].area = n; it.area = n; }); }
        if (key[0] === '#') { const n = man(v); if (Number.isNaN(n)) return H.toast('금액을 확인해 주세요 (예: 3000, 1억)'); return saveItem(id, it => { it[key.slice(1)] = n; }); }
        if (key === 'flt') { const [f, t] = v.split('/').map(z => z.trim()); return saveItem(id, it => { it.ad = { ...(it.ad || {}), fl: (f || '').replace(/층$/, '').replace(/^지하\s*/, 'B').replace(/f$/i, ''), tfl: t ? parseInt(t, 10) || null : (it.ad || {}).tfl ?? null }; }); }
        saveItem(id, it => { it.ad = { ...(it.ad || {}), [key]: ['tfl', 'rooms', 'baths'].includes(key) ? (v === '' ? null : parseInt(v, 10)) : v }; });
      }, 0);
    });
    r.querySelectorAll('[data-fb]').forEach(c => c.onchange = () => saveItem(id, it => { it.ad = { ...(it.ad || {}), [c.dataset.fb]: c.checked }; }));
    r.querySelectorAll('[data-mgt]').forEach(b => b.onclick = () => { const v = b.dataset.mgt; saveItem(id, it => { const a0 = it.ad || {}; it.ad = { ...a0, mgmtT: a0.mgmtT === v ? '' : v }; }); });   // 10/30 관리비 부과 방식
    r.querySelectorAll('[data-ci]').forEach(i => {
      i.onkeydown = e => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); i.blur(); } };
      i.onchange = () => setTimeout(() => {
        const n = +i.dataset.ci, f = i.dataset.cf, v = f === 'phone' ? fmtPhone(i.value) : i.value.trim().slice(0, 20);
        const have = ((H.items().find(z => z.id === id) || x).contacts || []).length;
        if (n >= have) { if (!v || f === 'role') return; B.cblank.set(id, Math.max(0, (B.cblank.get(id) || 0) - (n - have + 1))); }
        saveItem(id, it => { while (it.contacts.length <= n) it.contacts.push({ role: '소유자', name: '', phone: '' }); it.contacts[n][f] = v; });
      }, 0);
    });
    r.querySelectorAll('[data-cdel]').forEach(b => b.onclick = () => +b.dataset.cdel >= (x.contacts || []).length ? (B.cblank.set(id, Math.max(0, (B.cblank.get(id) || 0) - 1)), refresh()) : saveItem(id, it => { it.contacts.splice(+b.dataset.cdel, 1); }));
    // 층별 칸: 고치고 나가거나 Enter → 저장
    r.querySelectorAll('[data-ri]').forEach(i => {
      i.onkeydown = e => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); i.blur(); } };
      i.onchange = () => setTimeout(() => {
        const n = +i.dataset.ri, k = i.dataset.rk, v = i.value.trim();
        const val = k === 'deposit' || k === 'rent' ? man(v) : k === 'area' ? (parseFloat(v.replace(/[^\d.]/g, '')) || null) : v;
        if (Number.isNaN(val)) return H.toast('금액을 확인해 주세요 (예: 3000, 1억)');
        const have = (H.items().find(z => z.id === id) || x).rents || [];
        if (n >= have.length) { if (val === '' || val == null) return; B.blank.set(id, Math.max(0, (B.blank.get(id) || 0) - (n - have.length + 1))); }   // 새 줄은 뭔가 써야 저장
        saveItem(id, it => { while (it.rents.length <= n) it.rents.push({ fl: '', use: '', area: null, label: '', deposit: null, rent: null, exp: '', memo: '' }); const R = it.rents[n]; R[k] = val; if (it.kind === 'sale') { const s = rentSum(it); it.curDep = s.d || null; it.curRent = s.r || null; } });
      }, 0);
    });
    r.querySelectorAll('[data-rdel]').forEach(b => b.onclick = () => +b.dataset.rdel >= (x.rents || []).length ? (B.blank.set(id, Math.max(0, (B.blank.get(id) || 0) - 1)), refresh()) : saveItem(id, it => { it.rents.splice(+b.dataset.rdel, 1); if (it.kind === 'sale') { const s = rentSum(it); it.curDep = s.d || null; it.curRent = s.r || null; } }));
    const ln = r.querySelector('[data-loan]');
    if (ln) { ln.onkeydown = e => { if (e.key === 'Enter') ln.blur(); }; ln.onchange = () => setTimeout(() => { const v = man(ln.value); if (Number.isNaN(v)) return H.toast('금액을 확인해 주세요'); saveItem(id, it => { it.loan = v; }); }, 0); }
    r.querySelectorAll('[data-rate]').forEach(rt => { rt.onchange = () => setTimeout(() => { const v = parseFloat(rt.value); if (v >= 0 && v < 30) { B.rate = v; keep(); refresh(); } }, 0); });
    r.querySelectorAll('[data-uk]').forEach(i => { i.onkeydown = e => { if (e.key === 'Enter') i.blur(); }; i.onchange = () => setTimeout(() => { const v = man(i.value); if (Number.isNaN(v)) return H.toast('금액을 확인해 주세요'); saveItem(id, it => { it[i.dataset.uk] = v; }); }, 0); });
    r.querySelectorAll('[data-pa]').forEach(i => { i.onkeydown = e => { if (e.key === 'Enter') i.blur(); }; i.onchange = () => setTimeout(() => { const v = parseFloat(i.value.replace(/[^\d.]/g, '')) || null; saveItem(id, it => { const P = it.places[+i.dataset.pa]; P.area = v; if (detKind(x) === 'whole' && (P.land || P.ak === 'land')) P.site = v; }); }, 0); });   // 10/30 건물에 붙인 필지 = 대지면적
    r.querySelectorAll('[data-pdel]').forEach(b => b.onclick = () => { if (confirm('이 필지를 뺄까요?')) saveItem(id, it => { it.places.splice(+b.dataset.pdel, 1); }); });
    const pq = r.querySelector('[data-pq]');
    if (pq) pq.onkeydown = e => {
      if (e.key !== 'Enter' || e.isComposing) return; e.preventDefault();
      let q = pq.value.trim(); if (!q) return;
      // 10/30 호수만 치면(102 · 102호 · B101 · 지하1층 · 3층) 같은 건물에 한 칸 더 (주소 찾기 없이)
      const hm = pq.dataset.pqk === 'ho' && q.match(/^((?:B|b|지하|비)?\s*\d+(?:-\d+)?\s*(?:호|층)?)$/);
      if (hm) {
        const P0 = places(x)[0] || {}, ho = hm[1].replace(/\s+/g, '');
        if (places(x).some(P => P.pnu === P0.pnu && String(P.ho || '').replace(/호$/, '') === ho.replace(/호$/, ''))) return H.toast('이미 들어 있는 호수입니다');
        return saveItem(id, it => { if (!it.places || !it.places.length) it.places = [{ ...P0 }]; it.places.push({ pnu: P0.pnu, addr: P0.addr, lat: P0.lat, lng: P0.lng, bname: P0.bname || '', dong: P0.dong || '', ho, area: null, ak: P0.ak === 'tot' ? 'ex' : P0.ak || 'ex' }); }, `${/층$/.test(ho) ? ho : ho.replace(/호$/, '') + '호'}를 더했습니다`);
      }
      // 지번만 치면 첫 필지의 동네를 붙여서 찾음
      if (/^산?\s*\d+(-\d+)?$/.test(q)) { const base = String(places(x)[0].addr || '').split(' '); const k = base.findIndex(t => /(동|가|리|읍|면)\d*$/.test(t) && !/[시군구]$/.test(t)); if (k >= 0) q = base.slice(0, k + 1).join(' ') + ' ' + q; }
      let ho2 = ''; if (pq.dataset.pqk === 'ho') { const m2 = q.match(/\s((?:B|지하)?\d+(?:-\d+)?\s*(?:호|층))$/i); if (m2) { ho2 = m2[1].replace(/\s+/g, ''); q = q.slice(0, m2.index).trim(); } }   // '아현동 12-3 101호' → 주소 + 호
      B.add.pres = { id, res: 'busy' }; refresh();
      kakaoFind(q, res => { B.add.pres = { id, res, q, ho: ho2 }; refresh(); });
    };
    r.querySelectorAll('[data-pr]').forEach(b => b.onclick = async () => {
      const res = B.add.pres && B.add.pres.res, h = res && res[+b.dataset.pr], ho0 = (B.add.pres && B.add.pres.ho) || ''; if (!h) return;
      B.add.pres = null;
      try {
        const p = await H.api(`/api/parcel?lat=${h.lat}&lng=${h.lng}`);
        const pnu = p.pnu || p.bldPnu;
        const unit = detKind(x) === 'unit', ho = unit ? ho0 : '';
        if (!unit && places(x).some(P => P.pnu === pnu)) return H.toast('이미 들어 있는 필지입니다');
        if (unit) { saveItem(id, it => { it.places.push({ pnu, addr: p.addr || h.t, lat: h.lat, lng: h.lng, bname: '', dong: '', ho, area: null, ak: 'ex' }); }, '주소를 더했습니다'); return; }   // 10/30 상가 등: 다른 건물 주소
        const c = await landOf(pnu);
        saveItem(id, it => { const ar = (c && c.area) || null; it.places.push({ pnu, addr: p.addr || h.t, lat: h.lat, lng: h.lng, bname: '', dong: '', ho: '', area: ar, ...(detKind(x) === 'whole' ? { site: ar } : {}), land: true, ak: 'land' }); }, '필지를 붙였습니다');
      } catch { H.toast('그 위치의 필지를 찾지 못했습니다', 3500); refresh(); }
    });
  }
  async function landOf(pnu) {
    if (B.L[pnu] && B.L[pnu] !== 'loading') return B.L[pnu];
    if (B.L[pnu] === 'loading') return null;
    B.L[pnu] = 'loading';
    try { const L = await H.api(`/api/land?pnu=${pnu}`); B.L[pnu] = (L.chr && L.chr.data) || {}; } catch { B.L[pnu] = {}; }
    refresh(); return B.L[pnu];
  }
  async function hoPrice(P, key) {
    B.U[key] = null;
    try { const j = await H.api(`/api/units?pnu=${P.pnu}&dong=${encodeURIComponent(P.dong ? (/동$/.test(P.dong) ? P.dong : P.dong + '동') : '')}&ho=${encodeURIComponent(P.ho)}`); B.U[key] = { price: j.price && j.price.ok && j.price.data && j.price.data.price ? j.price.data : null }; } catch { B.U[key] = {}; }
    refresh();
  }
  async function refillFloors(x) {
    const P = places(x)[0];
    if ((x.rents || []).some(r => r.label || r.deposit || r.rent) && !confirm('지금 입력한 층별 내용(임차인·보증금·월세)을 지우고 건축물대장대로 다시 깔까요?')) return;
    H.toast('건축물대장 층별 정보를 불러오는 중…');
    const fl = await floorsOf(P.pnu);
    if (!fl.length) return H.toast('층별 정보가 없습니다. ＋ 줄 추가로 직접 넣어 주세요', 4000);
    saveItem(x.id, it => { it.rents = fl.map(f => ({ fl: f.fl, use: f.use, area: f.area, label: '', deposit: null, rent: null, exp: '', memo: '' })); if (it.kind === 'sale') { it.curDep = null; it.curRent = null; } }, `층별 ${fl.length}개 층을 깔았습니다`);
  }

  // ---------- 주소 한 줄 입력 → 새 줄 ----------
  function kakaoFind(q0, cb) {
    if (!H.kakao()) { H.toast('지도 기능을 불러오는 중입니다. 잠시 후 다시 눌러 주세요'); return cb([]); }
    const out = []; let left = 2;
    const done = () => { if (--left) return; const seen = new Set(); out.sort((a, b) => a.o - b.o); cb(out.filter(r => { const k = r.lat.toFixed(5) + r.lng.toFixed(5); if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 8)); };
    new kakao.maps.services.Geocoder().addressSearch(q0, (r, st) => { if (st === 'OK') r.forEach((a, i) => out.push({ t: a.address_name, s: a.road_address ? a.road_address.address_name : '', lat: +a.y, lng: +a.x, o: i })); done(); });
    new kakao.maps.services.Places().keywordSearch(q0, (r, st) => {
      const L = st === 'OK' ? r.slice(0, 6) : []; let n = L.length; if (!n) return done();
      const G = new kakao.maps.services.Geocoder();
      L.forEach((a, i) => G.addressSearch(a.address_name, (g, s2) => { const h = s2 === 'OK' && g && g[0]; out.push({ t: a.place_name, s: a.address_name, lat: h ? +h.y : +a.y, lng: h ? +h.x : +a.x, o: 100 + i }); if (!--n) done(); }));
    });
  }
  function find(v) {
    if (!v) return;
    const U = X.splitUnit(v);
    B.add.q = v; B.add.hint = U.ho ? { dong: U.dong, ho: U.ho } : null; B.add.res = 'busy'; drawRes();
    kakaoFind(U.q, res => {
      if (B.add.q !== v) return;
      B.add.res = res; drawRes();
      if (res.length === 1) pick(res[0]);
    });
  }
  function drawRes() {
    const el = $('bdRes'); if (!el) return;
    const R = B.add.res;
    el.innerHTML = !R ? '' : R === 'busy' ? '<div class="meta">찾는 중…</div>' : !R.length ? '<div class="meta">검색 결과가 없습니다. 지번(예: 서교동 395-12)이나 도로명으로 다시 입력해 보세요.</div>'
      : `<div class="res">${R.map((r, i) => `<button type="button" data-r="${i}"><b>${esc(r.t)}</b><small>${esc(r.s)}</small></button>`).join('')}<span class="meta">Enter = 첫 번째</span></div>`;
    el.querySelectorAll('[data-r]').forEach(b => b.onclick = () => pick(R[+b.dataset.r]));
  }
  // 고른 주소 → 필지 → 건축물대장·토지대장 → 유형 짐작
  async function pick(r) {
    B.add.res = null; drawRes();
    const hint = B.add.hint; B.add.hint = null;
    const D = B.add.D = { st: 'parcel', t: r.t, lat: r.lat, lng: r.lng, kind: 'sale', hint, n: (B.add.n = (B.add.n || 0) + 1) };
    B.ed = null; refresh();
    const alive = () => B.add.D === D;
    try {
      const p = await H.api(`/api/parcel?lat=${r.lat}&lng=${r.lng}`);
      if (!alive()) return;
      Object.assign(D, { pnu: p.bldPnu || p.pnu, lpnu: p.pnu, addr: p.addr || r.t, st: 'bld' }); refresh();
      const [b, L] = await Promise.all([H.api(`/api/building?pnu=${D.pnu}`).catch(() => null), H.api(`/api/land?pnu=${D.lpnu || D.pnu}`).catch(() => null)]);
      if (!alive()) return;
      const t = b && X.mainTitle(b), rc = b && b.recap && b.recap.data && b.recap.data[0], ts = ((b && b.titles && b.titles.data) || []).filter(z => z.mainAtch !== '부속건축물');
      D.b = b; D.t = t; D.rc = rc; D.ts = ts; D.chr = (L && L.chr && L.chr.data) || null;
      D.isSet = !!t && (ts.some(z => z.regstr === '집합') || !!(b.recap && b.recap.data && b.recap.data.length));
      D.bname = (rc && rc.name) || (t && t.name) || '';
      D.tot = (rc && rc.totArea) || Math.round(ts.reduce((a, z) => a + (z.totArea || 0), 0) * 100) / 100 || null;
      D.site = (rc && rc.platArea) || (t && t.platArea) || null;
      D.arch = (rc && rc.archArea) || Math.round(ts.reduce((a, z) => a + (z.archArea || 0), 0) * 100) / 100 || null;
      D.ty = D.bg = guess(D); if (B.cat === 'redev') D.ty = '재개발';
      if (B.cat === 'pre') D.kind = 'presale';   // 분양권 탭에서 등록하면 거래 = 분양권
      D.guess = D.ty; D.st = 'ready';
      setType(D, D.ty);
    } catch { if (alive()) { B.add.D = null; refresh(); H.toast('그 위치의 필지를 찾지 못했습니다. 다른 주소로 찾아 주세요', 3500); } }
  }
  function guess(D) {
    if (!D.t) return '토지';
    const g = X.guessType(D.t);
    if (D.isSet) return g === '건물' || g === '공장·창고' ? '상가' : g === '주택' ? '빌라' : g;
    if (g === '주택' || g === '공장·창고') return g;
    if (['아파트', '빌라', '오피스텔'].includes(g)) return '주택';
    return '건물';                                     // 일반건물(근생·업무 등) → 통건물로 짐작
  }
  // 재개발·재건축으로 등록할 때 물건 형태 짐작 (건축물대장 기준)
  const formGuess = D => { if (!D.t) return '토지'; const g = X.guessType(D.t); return g === '아파트' ? '아파트' : D.isSet ? '빌라' : g === '주택' ? '단독' : ['상가', '사무실', '건물'].includes(g) ? '상가' : '단독'; };
  const dmode = D => { const ty = tb({ ptype: D.ty, ad: { form: D.form } }) || '빌라'; return ty === '토지' ? 'land' : ['건물', '공장·창고'].includes(ty) || (ty === '주택' && !D.isSet) ? 'whole' : !D.t ? 'free' : D.isSet ? 'unit' : 'floor'; };
  function setType(D, ty) {
    D.ty = ty; if ((ty === '재개발' || ty === '재건축') && !D.form) D.form = ty === '재건축' && D.t ? '아파트' : formGuess(D);
    D.mode = dmode(D);
    const m = D.mode;
    if (m === 'land') D.area = (D.chr && D.chr.area) || null;
    if (m === 'whole') D.area = D.tot;
    if ((m === 'whole' || m === 'floor') && !D.floors) loadFloors(D);
    if (m === 'unit' && !D.U) loadUnitList(D);
    if (m === 'unit' || m === 'floor') D.area = D.uArea || null;
    if (m === 'free') D.area = D.area || null;
    refresh();
  }
  async function floorsOf(pnu) {
    try {
      const j = await H.api(`/api/building?pnu=${pnu}&part=floors`);
      const rows = ((j.floors && j.floors.data) || []).filter(f => f.mainAtch !== '부속건축물' && (f.gb === '지상' || f.gb === '지하') && f.no != null);
      const dongs = new Set(rows.map(f => String(f.dong || '').trim()));
      const by = new Map();
      for (const f of rows) {
        const k = `${dongs.size > 1 ? (f.dong || '') + ' ' : ''}${f.gb === '지하' ? 'B' + f.no : f.no + 'F'}`;
        const g = by.get(k) || { fl: k.trim(), gb: f.gb, no: f.no, dong: f.dong || '', uses: [], area: 0 };
        const u = f.etcUse && f.etcUse.length <= 14 ? f.etcUse : f.use; if (u && !g.uses.includes(u)) g.uses.push(u);
        g.area += f.area || 0; by.set(k, g);
      }
      return [...by.values()].sort((a, b) => String(a.dong).localeCompare(String(b.dong), 'ko', { numeric: true }) || (a.gb === b.gb ? (a.gb === '지상' ? b.no - a.no : a.no - b.no) : a.gb === '지상' ? -1 : 1))
        .map(g => ({ fl: g.fl, use: g.uses.join(' · ').slice(0, 30), area: Math.round(g.area * 100) / 100, gb: g.gb, no: g.no }));
    } catch { return []; }
  }
  async function loadFloors(D) {
    D.floors = 'loading';
    const f = await floorsOf(D.pnu);
    if (B.add.D !== D) return;
    D.floors = f; refresh();
  }
  async function loadUnitList(D) {
    const ts = D.ts || [], nat = (a, c) => String(a).localeCompare(String(c), 'ko', { numeric: true });
    const dongs = [...new Set(ts.map(z => String(z.dong || '').trim()).filter(Boolean))].sort(nat);
    D.U = { byDong: dongs.length >= 2, dongs, cur: '', lists: {} };
    const h = D.hint;
    D.U.cur = (h && h.dong && X.dongPick(dongs, h.dong)) || dongs.find(d => /\d/.test(d)) || dongs[0] || '';
    await loadUnits(D);
  }
  async function loadUnits(D) {
    const U = D.U, key = U.byDong ? U.cur : '*';
    if (U.lists[key]) return refresh();
    U.lists[key] = 'loading'; refresh();
    try {
      const j = await H.api(`/api/units?pnu=${D.pnu}${U.byDong ? '&dong=' + encodeURIComponent(U.cur) : ''}`);
      const units = j.units || [];
      if (!U.byDong) { U.dongs = [...new Set(units.map(u => String(u.dong || '').trim()))]; const w = D.hint && D.hint.dong ? X.dongPick(U.dongs, D.hint.dong) : null; U.cur = w != null ? w : U.dongs.includes(U.cur) ? U.cur : (U.dongs.find(d => /\d/.test(d)) || U.dongs[0] || ''); }
      U.lists[key] = units;
      if (B.add.D !== D) return;
      if (D.hint && D.hint.ho) { const inD = u => U.byDong || String(u.dong || '').trim() === U.cur, hn = String(D.hint.ho).replace(/호$/, '').toUpperCase();
      const hit = units.find(u => inD(u) && String(u.ho).replace(/호$/, '').toUpperCase() === hn) || units.find(u => inD(u) && X.hoEq(u.ho, D.hint.ho) && !/^b|지하/i.test(u.ho)); D.hint = null; if (hit) return pickHo(D, hit.ho); H.toast('입력한 호를 대장에서 찾지 못했습니다. 목록에서 골라 주세요', 3500); }
    } catch { U.lists[key] = 'error'; }
    refresh();
  }
  async function pickHo(D, ho) {
    const U = D.U, L = U.lists[U.byDong ? U.cur : '*'], u = Array.isArray(L) && L.find(z => z.ho === ho);
    D.ho = ho; D.dong = U.cur; D.fl = u && u.flr != null ? (u.flrGb === '지하' ? 'B' : '') + u.flr : ''; D.uArea = null; D.area = null; D.uUse = ''; D.gp = null; D.aMsg = '전용면적 불러오는 중…'; refresh();
    try {
      const j = await H.api(`/api/units?pnu=${D.pnu}&dong=${encodeURIComponent(U.cur)}&ho=${encodeURIComponent(ho)}`);
      if (B.add.D !== D || D.ho !== ho) return;
      const rows = (j.area && j.area.ok && j.area.data) || [];
      const ex = rows.filter(r => /전유/.test(r.gb || '')), sum = ex.reduce((a, r) => a + (r.area || 0), 0), pub = rows.filter(r => /공용/.test(r.gb || '')).reduce((a, r) => a + (r.area || 0), 0);
      D.uArea = sum ? Math.round(sum * 100) / 100 : null; D.area = D.uArea;
      D.uUse = ex[0] ? (ex[0].etcUse && ex[0].etcUse.length <= 14 ? ex[0].etcUse : ex[0].use) || '' : '';
      D.gp = j.price && j.price.ok && j.price.data && j.price.data.price ? j.price.data : null;
      D.aMsg = sum ? `전용 ${m2t(D.uArea)}${pub ? ` · 공용 ${m2t(Math.round(pub * 100) / 100)}` : ''}` : '전용면적 정보가 없어 직접 입력해 주세요';
    } catch { D.aMsg = '전용면적을 불러오지 못했습니다. 직접 입력해 주세요'; }
    refresh();
  }
  function draftHtml(D) {
    const fk = k => `d:${D.n}:${k}`;
    if (D.st !== 'ready') return `<tr class="bd-draft"><td colspan="${VC().length}"><div class="dr"><span class="no new">＋</span><b>${esc(D.addr || D.t)}</b><span class="meta"><i class="spin"></i>${D.st === 'parcel' ? '필지 찾는 중…' : '건축물대장 · 토지대장 확인 중…'}</span><button type="button" class="lnk" data-dx="1">취소</button></div></td></tr>`;
    const t = D.t, m = D.mode, a = D.chr || {};
    const facts = t ? [t.use, t.grnd ? `지상 ${t.grnd}층${t.ugrnd ? ' · 지하 ' + t.ugrnd + '층' : ''}` : '', t.useApr ? `사용승인 ${String(t.useApr).slice(0, 4)}년` : '', D.isSet ? '집합건물' : '일반건물'].filter(Boolean)
      : ['건물 없는 땅', a.jimok, a.area ? m2t(a.area) : '', zoneS([a.zone1, a.zone2].filter(Boolean).join(' · '))].filter(Boolean);
    let unit = '';
    if (m === 'unit') {
      const U = D.U || { dongs: [], lists: {} }, L = U.lists[U.byDong ? U.cur : '*'];
      const list = Array.isArray(L) ? L.filter(u => U.byDong || String(u.dong || '').trim() === U.cur) : [];
      unit = `${U.dongs.length >= 2 ? `<select data-dd="1">${U.dongs.map(d => `<option ${d === U.cur ? 'selected' : ''}>${esc(d)}</option>`).join('')}</select>` : ''}
        ${L === 'loading' || !L ? '<select disabled><option>호 목록 불러오는 중…</option></select>' : L === 'error' || !list.length ? `<input data-fk="${fk('ho')}" data-dho="1" value="${esc(D.ho || '')}" placeholder="호 (직접)" class="w6">`
        : `<select data-dh="1"><option value="">호 선택</option>${list.map(u => `<option value="${esc(u.ho)}" ${D.ho === u.ho ? 'selected' : ''}>${esc(u.ho)}${u.flr != null ? ` (${u.flrGb === '지하' ? 'B' : ''}${u.flr}층)` : ''}</option>`).join('')}</select>`}`;
    } else if (m === 'floor') {
      unit = D.floors === 'loading' || !D.floors ? '<select disabled><option>층 정보 불러오는 중…</option></select>'
        : D.floors.length ? `<select data-df="1"><option value="">층 선택</option>${D.floors.map((f, i) => `<option value="${i}" ${D.fi === i ? 'selected' : ''}>${esc(f.fl)} · ${esc(f.use)} · ${m2t(f.area)}</option>`).join('')}</select>` : `<input data-fk="${fk('ho')}" data-dho="1" value="${esc(D.ho || '')}" placeholder="층·호 (예: 1층)" class="w6">`;
    } else if (m === 'free') unit = `<input data-fk="${fk('ho')}" data-dho="1" value="${esc(D.ho || '')}" placeholder="동·호 (선택)" class="w6">`;
    const fx = m === 'whole' ? `${D.floors === 'loading' ? '층별 정보 불러오는 중…' : Array.isArray(D.floors) && D.floors.length ? `층별 ${D.floors.length}개 층 → 등록하면 입력창에 자동으로 깔립니다` : ''}` : m === 'land' ? '필지는 등록 뒤 입력창에서 더 붙일 수 있습니다' : D.aMsg || (D.gp ? '' : '');
    const kd = D.kind;
    return `<tr class="bd-draft"><td colspan="${VC().length}"><div class="dr">
      <span class="no new">＋</span>
      <div class="d1"><b>${esc(D.addr)}</b>${D.bname ? ` <span class="bn">${esc(D.bname)}</span>` : ''}<small>${esc(facts.join(' · '))}</small></div>
      <div class="d2"><span class="gs">${D.guess === D.ty && D.bg !== D.ty ? `재개발·재건축 매물로 등록 · 건축물대장으로 보면 <b>${esc(D.bg === '건물' ? '통건물' : D.bg)}</b>` : D.guess === D.ty ? `건축물대장으로 보면 <b>${esc(D.ty === '건물' ? '통건물' : D.ty)}</b>입니다` : `<b>${esc(D.ty)}</b>(으)로 바꿈`}</span>
        <span class="tys">${(() => { const own = B.cat === 'pre' ? ['아파트', '오피스텔'] : CATS[B.cat] || [], L = [...new Set([D.guess, D.ty, ...own])].filter(t => t && X.PTYPES.includes(t));   /* 10/28 6단계: 이 탭 종류 + 대장으로 짐작한 종류만 (나머지는 '다른 종류…') */
          return L.map(t => `<button type="button" data-dt="${t}" aria-pressed="${D.ty === t}">${t === '건물' ? '통건물' : t}</button>`).join('') + `<select data-dto="1" aria-label="다른 종류"><option value="">다른 종류…</option>${X.PTYPES.filter(t => !L.includes(t)).map(t => `<option>${t}</option>`).join('')}</select>`; })()}</span>
        ${D.ty === '재개발' || D.ty === '재건축' ? `<span class="tys">물건 형태 <select data-dfm="1">${X.FORMS.map(f => `<option ${D.form === f ? 'selected' : ''}>${f}</option>`).join('')}</select></span>` : ''}</div>
    </div><div class="dr dr2">
      ${unit ? `<span class="u">${unit}</span>` : ''}
      <label>면적 <input data-fk="${fk('ar')}" data-dar="1" class="w6 r" inputmode="decimal" value="${D.area || ''}" placeholder="㎡">㎡ <small>${D.area ? pyt(D.area) : ''}</small></label>
      <select data-dk="1">${Object.entries(X.KIND).map(([k, t]) => `<option value="${k}" ${kd === k ? 'selected' : ''}>${t}</option>`).join('')}</select>
      ${(() => { const L2 = kd === 'wolse' ? ['보증금', '월세'] : kd === 'presale' ? ['분양가', 'P'] : [kd === 'jeonse' ? '보증금' : '매매가'];   /* 10/29 금액은 만원 숫자만 · 옆에 읽어 줌 (예시 글씨 없음) */
        const w = (lb, f, dk, v, neg) => `<span class="wonw"><i class="u">${lb}</i><input data-fk="${fk(f)}" ${dk}="1" data-won${neg ? '="neg"' : ''} class="w7 r" inputmode="numeric" value="${esc(v || '')}"><i class="u">만원</i><i class="wonh">${esc(window.wonH ? window.wonH(v) : '')}</i></span>`;
        return w(L2[0], 'pr', 'data-dp', D.pr1) + (L2[1] ? w(L2[1], 'pr2', 'data-dp2', D.pr2, kd === 'presale') : ''); })()}
      <label><i class="u">연락처</i><input data-fk="${fk('tel')}" data-dtel="1" class="w9" value="${esc(D.tel || '')}"></label>
      <button type="button" class="go" data-dgo="1">등록 ↵</button><button type="button" class="lnk" data-dx="1">취소</button>
      ${fx ? `<span class="fx">${esc(fx)}</span>` : ''}${D.gp ? `<span class="fx">공시가격 ${esc(sw(D.gp.price / 1e4))} (${D.gp.year})</span>` : ''}
    </div></td></tr>`;
  }
  function wireDraft(D) {
    const T = $('bdT');
    T.querySelectorAll('[data-dx]').forEach(b => b.onclick = () => { B.add.D = null; refresh(); $('bdQ').focus(); });
    if (D.st !== 'ready') return;
    T.querySelectorAll('[data-dt]').forEach(b => b.onclick = () => setType(D, b.dataset.dt));
    const dto = T.querySelector('[data-dto]'); if (dto) dto.onchange = () => { if (dto.value) setType(D, dto.value); };
    const dfm = T.querySelector('[data-dfm]'); if (dfm) dfm.onchange = () => { D.form = dfm.value; setType(D, D.ty); };
    const dd = T.querySelector('[data-dd]'); if (dd) dd.onchange = () => { D.U.cur = dd.value; D.ho = ''; D.area = null; D.aMsg = ''; loadUnits(D); };
    const dh = T.querySelector('[data-dh]'); if (dh) dh.onchange = () => { if (dh.value) pickHo(D, dh.value); else { D.ho = ''; refresh(); } };
    const df = T.querySelector('[data-df]'); if (df) df.onchange = () => { const f = df.value === '' ? null : D.floors[+df.value]; D.fi = f ? +df.value : null; D.ho = f ? f.fl.replace(/^(\d+)F$/, '$1층').replace(/^B(\d+)$/, '지하$1층') : ''; D.fl = f ? (f.gb === '지하' ? 'B' + f.no : String(f.no)) : ''; D.uArea = f ? f.area : null; D.area = D.uArea; D.uUse = f ? f.use : ''; D.aMsg = f ? `${f.fl} 면적 ${m2t(f.area)} (층 전체 · 일부만이면 고쳐 주세요)` : ''; refresh(); };
    const set = (sel, k, f = v => v) => { const i = T.querySelector(sel); if (i) i.oninput = () => { D[k] = f(i.value); }; return i; };
    set('[data-dho]', 'ho'); set('[data-dp]', 'pr1'); set('[data-dp2]', 'pr2'); set('[data-dtel]', 'tel');
    const ar = set('[data-dar]', 'area', v => parseFloat(v.replace(/[^\d.]/g, '')) || null);
    if (ar) ar.onchange = () => setTimeout(refresh, 0);
    const dk = T.querySelector('[data-dk]'); if (dk) dk.onchange = () => { D.kind = dk.value; refresh(); };
    T.querySelectorAll('.bd-draft input').forEach(i => i.onkeydown = e => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); D[i.dataset.dp ? 'pr1' : i.dataset.dp2 ? 'pr2' : i.dataset.dtel ? 'tel' : i.dataset.dho ? 'ho' : '_'] = i.value; if (i.dataset.dar) D.area = parseFloat(i.value) || null; register(D); } if (e.key === 'Escape') { B.add.D = null; refresh(); } });
    T.querySelector('[data-dgo]').onclick = () => register(D);
    // 처음 그려질 때 가격 칸으로 커서 (주소 → Enter → 가격 → Enter 로 끝)
    if (!D.focused) { D.focused = true; setTimeout(() => { const p = $('bdT') && $('bdT').querySelector('tr.bd-draft [data-dp]'); if (p && B.add.D === D) p.focus(); }, 0); }
  }
  // 새 줄(D) → 매물 한 건 (주소·면적·건축물대장 광고 정보·층별 현황)
  function buildItem(D, kind, money, contacts) {
    const m = D.mode, t = D.t, rc = D.rc, ts = D.ts || [], c = D.chr || {};
    // 주소 · 면적
    const P = { pnu: m === 'land' ? (D.lpnu || D.pnu) : D.pnu, addr: D.addr, lat: D.lat, lng: D.lng, bname: m === 'land' ? '' : D.bname, dong: '', ho: '', area: D.area || null };
    if (m === 'land') Object.assign(P, { land: true, ak: 'land' });
    else if (m === 'whole') Object.assign(P, { ak: 'tot', site: D.site, arch: D.arch });
    else Object.assign(P, { ak: 'ex', dong: m === 'unit' ? String(D.dong || '').replace(/동$/, '') : '', ho: String(D.ho || '').replace(/호$/, '').trim() });
    // 광고 정보 (빈 칸만 자동): 용도·층·사용승인·주차·승강기·위반, 토지 = 지목·용도지역·도로·공시지가
    const ad = {};
    if (t && m !== 'land') {
      ad.use = (m === 'unit' || m === 'floor') && D.uUse ? D.uUse : [t.use, t.etcUse && t.etcUse !== t.use ? t.etcUse : ''].filter(Boolean).join(' · ').slice(0, 40);
      if (t.grnd) ad.tfl = t.grnd; if (t.ugrnd) ad.ufl = t.ugrnd; if (t.useApr) ad.appr = String(t.useApr).slice(0, 10);
      const pk = z => z ? (z.pkTotal || ((z.pkIn || 0) + (z.pkOut || 0) + (z.pkInMech || 0) + (z.pkOutMech || 0))) : 0;
      const tot = pk(rc) || ts.reduce((a, z) => a + pk(z), 0), hh = (rc && rc.hhld) || ts.reduce((a, z) => a + (z.hhld || 0), 0);
      if (tot) ad.park = hh > 1 && ['아파트', '오피스텔', '빌라'].includes(tb({ ptype: D.ty, ad: { form: D.form } })) ? `총 ${tot}대 (세대당 ${(tot / hh).toFixed(2).replace(/0$/, '')}대)` : `총 ${tot}대`;
      if (hh > 1) ad.hhld = hh;
      const lift = ts.reduce((a, z) => a + (z.liftP || 0), 0); if (lift) ad.elev = lift;
      if (ts.some(z => /^(y|1|true|위반)/i.test(String(z.viol ?? '')))) ad.viol = true;
      ad.fl = m === 'whole' ? '전체' : D.fl || '';
    }
    if (m === 'land') ad.use = c.jimok || '';
    if (c.zone1) ad.zone = [c.zone1, c.zone2].filter(Boolean).join(' · ');
    if (c.road) ad.road = c.road; if (c.price) ad.lp = c.price;
    if ((D.ty === '재개발' || D.ty === '재건축') && D.form) ad.form = D.form;
    const rents = m === 'whole' && Array.isArray(D.floors) ? D.floors.map(f => ({ fl: f.fl, use: f.use, area: f.area, label: '', deposit: null, rent: null, exp: '', memo: '' })) : [];
    return { kind, status: 'on', ptype: D.ty, ptypeTx: '', bname: m === 'land' ? '' : D.bname, road: t && t.road ? String(t.road).replace(/^서울특별시\s*/, '서울 ') : '', places: [P], contacts, rents, photos: [], ad, memo: '', ...money };
  }
  async function register(D) {
    if (D.busy) return;
    const m = D.mode, t = D.t, rc = D.rc, ts = D.ts || [], c = D.chr || {};
    if (m === 'unit' && !D.ho) return H.toast('호를 골라 주세요');
    // 가격
    const p1 = String(D.pr1 || '').trim(), p2 = String(D.pr2 || '').trim(), money = {};
    const pv = p2 && ['wolse', 'presale'].includes(D.kind) ? `${p1 || 0}/${p2}` : p1;   // 10/29 보증금·월세(분양가·P)는 칸 두 개
    if (pv.includes('/') && D.kind === 'sale') D.kind = 'wolse';            // '5000/320'처럼 치면 월세로
    const kind = D.kind;
    if (pv) {
      const parts = pv.split('/').map(s => man(s));
      if (parts.some((v, i) => Number.isNaN(v) || (v < 0 && !(kind === 'presale' && i === 1)))) return H.toast('가격은 만원 단위 숫자로 넣어 주세요');
      if (kind === 'sale') money.price = parts[0]; else if (kind === 'jeonse') money.deposit = parts[0];
      else if (kind === 'wolse') { money.deposit = parts[0]; if (parts.length > 1) money.rent = parts[1]; }   // 10/29 칸이 둘이라 앞 칸은 늘 보증금
      else { money.price = parts[0]; if (parts[1]) money.pr = parts[1]; }
    }
    const tel = String(D.tel || '').trim(), tm = tel.match(/0\d{1,2}[-\s]?\d{3,4}[-\s]?\d{4}/);
    const contacts = tel ? [{ role: '소유자', name: (tm ? tel.replace(tm[0], '') : tel).trim().slice(0, 20), phone: tm ? fmtPhone(tm[0]) : '' }] : [];
    const item = buildItem(D, kind, money, contacts);
    D.busy = true;
    try {
      const j = await H.api('/api/auth?action=listing', H.post({ op: 'save', id: '', item: bodyOf(item) }));
      H.took(j);
      const nx = H.items()[0];
      B.add.D = null; B.add.q = '';
      if (nx) { B.hl = nx.id; B.pk = nx.id; }   // 10/28 등록하면 그 줄의 오른쪽 입력창이 열림 (나머지는 거기서)
      if (B.fs.length && !B.fs.includes('on')) B.fs = [];
      if (B.fk.length && !B.fk.includes(kind)) B.fk = [];
      B.fc = []; B.fx = []; B.cf = null; B.tr = null;
      if (nx && orphOn() && catOf(nx) === 'apt' && H.isOrph && !H.isOrph(nx)) H.toast('담아 둔 단지의 매물이라 아파트 화면의 그 단지에 들어갔습니다', 3500);   // 10/30
      if (nx && catOf(nx) !== B.cat) { B.cat = catOf(nx); if (H.onCat) H.onCat(B.cat); H.toast(`${CATNAME[B.cat]} 탭으로 옮겼습니다`, 2500); }   // 등록한 매물의 종류 탭으로
      B.q = ''; keep(); B.fitNext = true;
      H.redraw();
      const q = $('bdQ'); if (q) { q.value = ''; q.focus(); }
      H.toast(m === 'whole' ? '등록했습니다 · 상세의 층별 현황에 임차인·보증금·월세를 넣어 보세요' : '등록했습니다 · 표에서 바로 고칠 수 있습니다', 3500);
      setTimeout(() => { const r = nx && $('b_' + nx.id); if (r) r.scrollIntoView({ block: 'nearest' }); }, 50);
    } catch (e) {
      D.busy = false;
      if (e.code === 'limit' || e.code === 'readonly') H.upsell(e.message); else H.toast(e.message || '등록하지 못했습니다', 4000);
    }
  }

  // 단지 장부에서 바로 리얼맵에 올릴 때: PNU·동·호만으로 매물 한 건을 만듦 (저장은 하지 않음)
  async function autoItem(o) {
    const p = await H.api(`/api/parcel?pnu=${o.pnu}`), c0 = X.centroid(p.geometry) || {};
    const [b, L] = await Promise.all([H.api(`/api/building?pnu=${o.pnu}`).catch(() => null), H.api(`/api/land?pnu=${p.pnu || o.pnu}`).catch(() => null)]);
    const t = b && X.mainTitle(b), rc = b && b.recap && b.recap.data && b.recap.data[0], ts = ((b && b.titles && b.titles.data) || []).filter(z => z.mainAtch !== '부속건축물');
    const D = { pnu: p.bldPnu || p.pnu || o.pnu, lpnu: p.pnu, addr: p.addr || '', lat: c0.lat || null, lng: c0.lng || null, t, rc, ts, chr: (L && L.chr && L.chr.data) || null, bname: (rc && rc.name) || (t && t.name) || '' };
    D.isSet = !!t && (ts.some(z => z.regstr === '집합') || !!(b.recap && b.recap.data && b.recap.data.length));
    D.ty = o.ptype || guess(D); D.form = o.form || ''; if (/^재(개발|건축)$/.test(D.ty) && !D.form) D.form = formGuess(D); D.mode = dmode(D);
    if (D.mode === 'unit' && o.ho) {
      const nat = (a, z) => String(a).localeCompare(String(z), 'ko', { numeric: true });
      const dongs = [...new Set(ts.map(z => String(z.dong || '').trim()).filter(Boolean))].sort(nat), byDong = dongs.length >= 2;
      let cur = byDong ? (X.dongPick(dongs, o.dong) || '') : '';
      const j = await H.api(`/api/units?pnu=${D.pnu}${byDong ? '&dong=' + encodeURIComponent(cur) : ''}`).catch(() => ({ units: [] }));
      let units = j.units || [];
      if (!byDong) { const ds = [...new Set(units.map(u => String(u.dong || '').trim()))]; cur = (o.dong && X.dongPick(ds, o.dong)) || ds.find(d => /\d/.test(d)) || ds[0] || ''; units = units.filter(u => String(u.dong || '').trim() === cur); }
      const hn = String(o.ho).replace(/호$/, '').toUpperCase();
      const hit = units.find(u => String(u.ho).replace(/호$/, '').toUpperCase() === hn) || units.find(u => X.hoEq(u.ho, o.ho) && !/^b|지하/i.test(u.ho));
      D.dong = cur || o.dong || ''; D.ho = hit ? hit.ho : String(o.ho);
      if (hit && hit.flr != null) D.fl = (hit.flrGb === '지하' ? 'B' : '') + hit.flr;
      if (!o.area && hit) { try { const u = await H.api(`/api/units?pnu=${D.pnu}&dong=${encodeURIComponent(cur)}&ho=${encodeURIComponent(hit.ho)}`); const ex = ((u.area && u.area.ok && u.area.data) || []).filter(r => /전유/.test(r.gb || '')); const sum = ex.reduce((a, r) => a + (r.area || 0), 0); if (sum) D.area = Math.round(sum * 100) / 100; if (ex[0]) D.uUse = (ex[0].etcUse && ex[0].etcUse.length <= 14 ? ex[0].etcUse : ex[0].use) || ''; } catch { /* 면적은 직접 */ } }
    } else if (D.mode === 'whole') { D.area = D.tot; D.floors = await floorsOf(D.pnu); }
    else if (D.mode === 'land') D.area = (D.chr && D.chr.area) || null;
    if (o.area) D.area = o.area;
    if (D.mode === 'whole') { D.tot = (rc && rc.totArea) || Math.round(ts.reduce((a, z) => a + (z.totArea || 0), 0) * 100) / 100 || null; D.area = o.area || D.tot; D.site = (rc && rc.platArea) || (t && t.platArea) || null; D.arch = (rc && rc.archArea) || null; }
    const it = buildItem(D, o.kind || 'sale', o.money || {}, o.contacts || []);
    // 10/29 지도에서 아파트처럼 호를 골라야 하는 건물인데 호가 없으면: 간단 등록창 안에서 동·호를 고르게 (listings.js psUnit)
    if (D.mode === 'unit' && !o.ho) { const nat = (a, z) => String(a).localeCompare(String(z), 'ko', { numeric: true }); it._unit = { pnu: D.pnu, dongs: [...new Set(ts.map(z => String(z.dong || '').trim()).filter(Boolean))].sort(nat), dong: o.dong || '' }; }
    if (o.dir) it.ad.dir = o.dir; if (o.movein) it.ad.movein = o.movein;
    if (o.rooms) it.ad.rooms = o.rooms; if (o.baths) it.ad.baths = o.baths; if (o.mgmt) it.mgmt = o.mgmt;   // 10/29 장부 매물 칸에서 넣은 값
    if (o.memo) it.memo = o.memo;
    return it;
  }
  // 지도 핀을 누르면 그 줄로
  function focus(id, scroll) {
    B.hl = id;
    if (!$('bdT')) return;
    $('bdT').querySelectorAll('tr.on').forEach(r => r.classList.remove('on'));
    const r = $('b_' + id); if (r) { r.classList.add('on'); if (scroll) r.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
  }
  function init(host) { H = host; X = host.X; }
  // 알림에서 '그 매물로 가기': 거르기를 풀고 그 줄을 펼쳐서 보여 줌
  function reveal(id) {
    const x = H.items().find(i => i.id === id); if (!x) return;
    B.cat = catOf(x); B.allApt = B.cat === 'apt' && H.isOrph && !H.isOrph(x); if (H.onCat) H.onCat(B.cat); B.sel = null; B.ed = null; B.add.D = null;
    B.fk = []; B.fc = []; B.fx = []; B.cf = null; B.tr = null; B.q = ''; if (B.fs.length && !B.fs.includes(x.status)) B.fs = [];
    B.pk = id; B.hl = id; keep(); refresh(); setTimeout(() => focus(id, true), 60);
  }
  // 위 탭에서 종류를 고름 (listings.js) — 탭을 바꾸면 거르기는 처음대로(상태만 유지)
  function setCat(c) { if (B.allApt) { B.allApt = false; if (c === B.cat) refresh(); } if (!CATS[c] || c === B.cat) return; B.cat = c; B.tr = null; B.cf = null; B.fx = []; B.fk = []; B.fc = []; B.ed = null; B.sel = null; B.hist = null; B.add.D = null; B.pk = null; B.fs = []; keep(); B.fitNext = true; refresh(); }
  const counts = () => { const o = {}; (H ? H.items() : []).forEach(x => { if (x.status === 'on') { const c = catOf(x); o[c] = (o[c] || 0) + 1; } }); return o; };
  // 10/30 다른 화면(아파트 화면의 개별매물)에서 이 매물 입력창만 띄우기 · 닫기
  const openWin = id => { if (!H.items().some(i => i.id === id)) return; B.pk = id; B.hl = id; refresh(); };
  const closeWin = () => { if (B.pk) closePanel(); };
  return { init, mount, refresh, focus, reveal, autoItem, setCat, openWin, closeWin, cat: () => B.cat, catOf, counts, CATNAME, autoLines, _man: man };
})();
