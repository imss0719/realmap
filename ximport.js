// 리얼맵 중개장부 · 엑셀 불러오기 (10/26)
// ① 주로 다루는 매물 3가지(힌트) + 파일 → ② 칸 맞추기·미리보기(숫자) → ③ 주소 찾기·불러오기·결과(못 찾은 줄 · 되돌리기)
// 파일은 브라우저 안에서만 읽고 서버에는 올리지 않습니다. 서버에는 매물로 바뀐 내용만 묶음(최대 150건씩)으로 저장.
// 쓰는 곳: listings.js → XImport.open(host)  host = { api, post, took, toast, items, plan, kakao, X, done }
window.XImport = (() => {
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const PY = 3.3058;
  let H = null, S = null;
  const MAINS = [['apt', '아파트'], ['shop', '상가·사무실'], ['bld', '건물'], ['ofc', '오피·지산'], ['home', '빌라·주택'], ['redev', '재개발·재건축'], ['pre', '분양권'], ['land', '토지'], ['fac', '공장·창고'], ['etc', '숙박·기타']];
  const MAIN_TY = { apt: '아파트', shop: '상가', bld: '건물', ofc: '오피스텔', home: '빌라', redev: '재개발', pre: '아파트', land: '토지', fac: '공장·창고', etc: '기타' };

  // ---------- 칸 이름 사전 (칸 제목 → 넣을 곳) ----------
  const T = {
    skip: '넣지 않음', no: '매물번호', date: '등록일', year: '등록 연', month: '등록 월', day: '등록 일', status: '상태(진행·보류·완료)',
    addr: '주소(전체)', sido: '주소 · 시도', sgg: '주소 · 시군구', umd: '주소 · 읍면동', jibun: '주소 · 지번(뒤에 건물명·호 가능)',
    bname: '건물명·단지명', udong: '동(○○동 아파트의 동)', ho: '호', fl: '층', floors: '지상/지하 층수',
    ptype: '매물 종류', kind: '거래(매매·전세·월세)', price: '매매가·가격', deposit: '보증금·전세금', rent: '월세', premium: '권리금', mgmt: '관리비', loan: '융자',
    cdep: '현 보증금(임차중)', crent: '현 월세(임차중)', exp: '만기일',
    area: '전용면적', site: '대지면적', tot: '연면적', appr: '사용승인일', jimok: '지목', zone: '용도지역', use: '건축물 용도', elev: '승강기', park: '주차', dir: '방향', ty: '타입(84B)',
    biz: '현재 업종', memo: '메모·설명', owner: '소유자 이름', phone: '연락처', tenant: '임차인·소개자 이름', office: '부동산명(아파트 장부)',
  };
  const DICT = [
    ['skip', /네이버|구분번호|^번호$|순번|★|보수|수익률|평단가|인정작업|통신사|공유$|^공동$|^계약$|^잔금$|건폐율|용적률|높이|층고|호수\(세대\)/],
    ['no', /관리번호|매물번호|물건번호/], ['date', /접수일|등록일/], ['year', /^년$/], ['month', /^월$/], ['day', /^일$/],
    ['status', /현황|^상태|^진행/], ['addr', /전체주소|^주소$|소재지|주소지/], ['sido', /^시$|^시도$/], ['sgg', /구,?읍,?면|시군구|^구$|^구군$/], ['umd', /동,?리|읍면동|법정동/],
    ['jibun', /지번|번지/], ['bname', /물건명|건물명|단지명|^단지$/], ['udong', /^동$/], ['ho', /^호$|^호수$/], ['floors', /지상\/?지하|^규모$/], ['fl', /해당층|^층$/],
    ['ptype', /^종류$|매물종류|물건종류/], ['kind', /거래구분|거래유형|거래종류|^거래$/],
    ['cdep', /현상태.*(보증|전세)|현.*보증금|기보증금/], ['crent', /현상태.*(월세|차임)|현.*월세|기월세/],
    ['price', /^가격|매매가|^의뢰가격\/매매$|^매매$|매매금액|^금액/], ['deposit', /보증금|^전세$|전세금|의뢰가격\/전세/], ['rent', /^월세$|의뢰가격\/월세|월임대료|임대료|차임/],
    ['premium', /권리금/], ['mgmt', /관리비/], ['loan', /융자/], ['exp', /만기/],
    ['site', /대지면적|토지면적|대지권/], ['tot', /연면적|공급면적/], ['area', /전용면적|^전용|^면적|계약면적/],
    ['appr', /사용승인|준공/], ['jimok', /지목/], ['zone', /용도지역/], ['use', /^용도$|건축물용도|주용도/], ['elev', /승강기|엘리베이터/], ['park', /주차/], ['dir', /방향/], ['ty', /^타입$/],
    ['biz', /^현재$|현업종|^업종|현재용도/], ['office', /부동산명|중개사무소/],
    ['owner', /소유자|소유주|건물주|매도인|임대인|집주인|의뢰인/], ['tenant', /세입자|임차인|소개자/], ['phone', /연락처|핸드폰|휴대폰|전화|^hp$|폰$/i],
    ['memo', /설명|메모|비고|특이|물건내역|상담내역|내용|담당자/],
  ];
  const norm = s => String(s ?? '').replace(/_x000D_/g, '').replace(/\s+/g, '').replace(/\(.*?\)/g, m => /㎡|평|만원|원/.test(m) ? m : '');
  const guessCol = lb => { const n = norm(lb).replace(/\(.*?\)/g, ''); for (const [k, re] of DICT) if (re.test(n)) return k; const m = (String(lb ?? '').replace(/\s+/g, '').match(/\(([^)]*)\)/g) || []).map(x => x.slice(1, -1)); for (const t of m) for (const [k, re] of DICT) if (re.test(t)) return k; return 'skip'; };   // '건축면적(전용면적)'처럼 괄호 안 이름도 봄
  const KINDW = /^(매매|전세|월세|분양|분양권|임대|매도|반전세|단기|상속절차)/;

  // ---------- 값 읽기 ----------
  const clean = v => String(v ?? '').replace(/_x000D_/g, '').replace(/\r/g, '').trim();
  // 10/28 메모 속 날짜 기록 나누기: "앞글 [24-10-21 15:01 관리자]: 내용 [22-10-22 12:56 주]내용 …"
  //   → { head: '앞글', list: [{ t: ISO, x: '내용', w: '관리자' }] (새것부터) } · [YY-MM-DD HH:MM 이름] · [2024.10.21 15:01] 모두 알아봄
  const STAMP = /\[\s*(\d{2}|\d{4})[-./](\d{1,2})[-./](\d{1,2})\.?\s+(\d{1,2}):(\d{2})(?::\d{2})?\s*([^\]\d][^\]]{0,11})?\]\s*:?\s*/g;
  function stampSplit(text) {
    const s0 = String(text || '').replace(/\s+/g, ' ').trim(), ms = [...s0.matchAll(STAMP)];
    if (!ms.length) return { head: s0, list: [] };
    const list = [];
    ms.forEach((m, i) => {
      const y = m[1].length === 2 ? 2000 + +m[1] : +m[1], p = n => String(n).padStart(2, '0');
      const d = new Date(`${y}-${p(m[2])}-${p(m[3])}T${p(m[4])}:${m[5]}:00+09:00`);
      const x = s0.slice(m.index + m[0].length, i + 1 < ms.length ? ms[i + 1].index : s0.length).trim().replace(/^[·,\s]+|[·,\s]+$/g, '');
      if (!isNaN(d) && d <= new Date() && x) list.push({ t: d.toISOString(), x: x.slice(0, 500), w: String(m[6] || '').trim().slice(0, 10) });
    });
    if (!list.length) return { head: s0, list: [] };
    return { head: s0.slice(0, ms[0].index).trim().replace(/[·,\s]+$/, ''), list: list.sort((a, b) => b.t.localeCompare(a.t)) };
  }
  const memoT = iso => { const d = new Date(new Date(iso).getTime() + 9 * 3600e3).toISOString(); return `${d.slice(2, 4)}.${d.slice(5, 7)}.${d.slice(8, 10)} ${d.slice(11, 16)}`; };
  function man(s, wonCol) {   // '3억2천' '68억' '5000' → 만원
    if (typeof s === 'number') return s > 0 ? (wonCol && s >= 1e7 ? Math.round(s / 1e4) : Math.round(s * 100) / 100) : null;
    s = clean(s).replace(/[,\s원]/g, '').replace(/만$/, ''); if (!s || /[#]/.test(s)) return null;
    let m, t = 0;
    if ((m = s.match(/^([\d.]+)억(.*)$/))) { t += parseFloat(m[1]) * 10000; s = m[2]; }
    if (s) { if ((m = s.match(/^([\d.]+)천$/))) t += parseFloat(m[1]) * 1000; else if ((m = s.match(/^([\d.]+)/))) t += parseFloat(m[1]); else return null; }
    return t > 0 ? Math.round(t * 100) / 100 : null;
  }
  const numOf = v => { if (typeof v === 'number') return v > 0 ? v : null; const m = clean(v).replace(/,/g, '').match(/[\d.]+/); return m ? parseFloat(m[0]) || null : null; };
  const PHONE = /01\d[-\s.)]?\d{3,4}[-\s.]?\d{4}|0\d{1,2}[-)]\d{3,4}-\d{4}/g;
  const fmtPh = p => { const d = p.replace(/\D/g, ''); return d.length === 11 ? d.replace(/^(\d{3})(\d{4})(\d{4})$/, '$1-$2-$3') : d.length === 10 ? d.replace(/^(02)(\d{4})(\d{4})$/, '$1-$2-$3').replace(/^(\d{3})(\d{3})(\d{4})$/, '$1-$2-$3') : d.replace(/^(02)(\d{3})(\d{4})$/, '$1-$2-$3'); };
  function dateOf(v) {
    if (typeof v === 'number' && v > 20000 && v < 80000) { const d = new Date(Date.UTC(1899, 11, 30) + v * 864e5); return d.toISOString().slice(0, 10); }   // 엑셀 날짜 숫자
    const m = clean(v).match(/(\d{2,4})[.\-/년\s]+(\d{1,2})[.\-/월\s]+(\d{1,2})/); if (!m) return '';
    const y = +m[1] < 100 ? 2000 + +m[1] : +m[1]; return `${y}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`;
  }
  // 종류 글자 → 매물 종류(+분양권이면 거래)
  function typeOf(v) {
    const s = clean(v).split(/[\/,]/)[0].replace(/\s/g, ''); if (!s) return null;
    const pre = /분양/.test(s) && !/분양가/.test(s);
    const R = [[/재개발/, '재개발'], [/재건축/, '재건축'], [/주상복합/, '주상복합'], [/아파트/, '아파트'], [/오피스텔|^오피$/, '오피스텔'], [/지식산업|지산/, '지식산업센터'],
      [/연립/, '연립'], [/다가구|다중|원룸|투룸/, '다가구'], [/도시형|다세대|빌라/, '빌라'], [/상가주택|주택\(상가\)|상가건물|근생|건물|빌딩/, '건물'], [/상가|점포/, '상가'],
      [/사무실|^오피스$|사무소/, '사무실'], [/공장|창고/, '공장·창고'], [/숙박|모텔|호텔|펜션/, '숙박'], [/단독|전원주택|주택|구옥|한옥/, '주택'], [/토지|대지|임야|^전$|^답$|농지|잡종/, '토지']];
    for (const [re, t] of R) if (re.test(s)) return { ptype: t, pre };
    return { ptype: '기타', tx: s.slice(0, 20), pre };
  }
  const kindOf = v => { const s = clean(v); return /월세|임대|단기/.test(s) ? 'wolse' : /전세/.test(s) ? 'jeonse' : /분양/.test(s) ? 'presale' : /매매|매도|상속/.test(s) ? 'sale' : ''; };
  const statusOf = v => { const s = clean(v); return /타거래|타사/.test(s) ? 'other' : /중복/.test(s) ? 'dup' : /보류|대기/.test(s) ? 'hold' : /완료|계약|거래됨|종료/.test(s) ? 'done' : 'on'; };

  // ---------- 파일 → 표 ----------
  function loadLib() {
    if (window.XLSX) return Promise.resolve();
    return new Promise((ok, no) => { const s = document.createElement('script'); s.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js'; s.onload = ok; s.onerror = () => no(new Error('엑셀 읽기 도구를 불러오지 못했습니다. 잠시 뒤 다시 시도해 주세요.')); document.head.appendChild(s); });
  }
  async function readFile(f) {
    await loadLib();
    const buf = await f.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array', cellDates: false });
    let best = null;
    for (const n of wb.SheetNames) { const rows = XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: '' }); if (!best || rows.length > best.rows.length) best = { name: n, rows }; }
    return best;
  }
  // 제목 줄 찾기: 앞 8줄 중 사전에 맞는 칸이 가장 많은 줄 · 바로 아래 줄이 글자뿐이면 두 줄 제목(의뢰가격/매매)
  function header(rows) {
    const score = r => (r || []).filter(c => typeof c === 'string' && clean(c) && guessCol(c) !== 'skip').length;
    let h = 0, hs = -1; for (let i = 0; i < Math.min(8, rows.length); i++) { const sc = score(rows[i]); if (sc > hs) { hs = sc; h = i; } }
    const r0 = rows[h] || [], r1 = rows[h + 1] || [], W = Math.max(r0.length, r1.length);
    const r1txt = r1.filter(c => clean(c)).length, r1num = r1.filter(c => typeof c === 'number' || /^[\d.,\-\s]+$/.test(clean(c)) && clean(c)).length;
    const two = r1txt >= 3 && r1num <= 1 && r1.some((c, i) => clean(c) && !clean(r0[i]));
    const labels = []; let parent = '';
    for (let c = 0; c < W; c++) {
      const a = clean(r0[c]), b = two ? clean(r1[c]) : '';
      if (a) parent = a;
      labels.push(b ? (a && a !== parent ? a : parent) + '/' + b : a);
    }
    return { labels, start: h + (two ? 2 : 1) };
  }
  function autoMap(labels, data) {
    let lastPerson = 'owner', lastArea = '';
    return labels.map((lb, c) => {
      if (!lb) return 'skip';
      let k = guessCol(lb);
      const vals = data.slice(0, 40).map(r => clean(r[c])).filter(Boolean);
      if (/^유형$/.test(norm(lb))) k = vals.length && vals.filter(v => KINDW.test(v)).length >= vals.length * .6 ? 'kind' : 'ptype';
      if (k === 'ptype' && vals.length && vals.filter(v => KINDW.test(v)).length >= vals.length * .6) k = 'kind';
      if (k === 'owner' || k === 'tenant') lastPerson = k;
      if (k === 'phone') return lastPerson === 'tenant' ? 'phone2' : 'phone';
      if (k === 'udong' && vals.length && vals.filter(v => /[가-힣]+(동|리|가|읍|면)\d*$/.test(v) && !/^\d/.test(v)).length >= vals.length * .6) k = 'umd';   // '동' 칸에 '노고산동' → 동네 이름
      if (k === 'ho' && /세대/.test(lb)) k = 'skip';   // '호수(세대)' = 건물 세대수
      if (/평/.test(lb) && !/㎡/.test(lb) && ['area', 'site', 'tot'].includes(k)) { if (/^면적/.test(norm(lb)) && lastArea) k = lastArea; return k + 'py'; }   // 바로 앞 ㎡ 칸의 평
      if (['area', 'site', 'tot'].includes(k)) lastArea = k;
      return k;
    });
  }
  const ALLT = { ...T, phone2: '연락처(임차인·소개자)', areapy: '전용면적(평)', sitepy: '대지면적(평)', totpy: '연면적(평)' };

  // ---------- 한 줄 → 매물 ----------
  function rowItem(r, map, labels, mains) {
    const g = {}, multi = {};
    map.forEach((k, c) => { if (k === 'skip') return; const v = r[c]; if (v === '' || v == null) return; if (['memo', 'phone', 'phone2', 'owner', 'tenant'].includes(k)) (multi[k] || (multi[k] = [])).push({ v, lb: labels[c] }); else if (g[k] == null || g[k] === '') g[k] = v; });
    const any = Object.keys(g).some(k => !['no', 'year', 'month', 'day', 'status'].includes(k)) || Object.keys(multi).length;
    if (!any) return { skip: 'empty' };
    const st = statusOf(g.status);
    if (st === 'other') return { skip: 'other' };
    if (st === 'dup') return { skip: 'dup' };
    // 주소
    let jb = clean(g.jibun), rest = '', more = [];
    const m = jb.match(/^(산\s?)?\d+(?:-\d+)?/);
    if (m) { rest = jb.slice(m[0].length); const mm = rest.match(/^\s*[\/,]\s*((?:산\s?)?\d+(?:-\d+)?(?:\s*[\/,]\s*(?:산\s?)?\d+(?:-\d+)?)*)\s*[\/,]?/); if (mm) { more = mm[1].split(/\s*[\/,]\s*/).filter(Boolean); rest = rest.slice(mm[0].length); } jb = m[0].replace(/\s/g, ''); }
    else if (jb) { rest = jb; jb = ''; }
    const addrFull = clean(g.addr);
    let q = '';
    if (g.sido || g.sgg || g.umd) q = [clean(g.sido), clean(g.sgg), clean(g.umd), jb].filter(Boolean).join(' ');
    else if (addrFull) { const a = addrFull.match(/^(.*?\d+(?:-\d+)?)(.*)$/); q = a ? a[1] : addrFull; if (a && !rest) rest = a[2]; }
    rest = rest.replace(/^[\s,\/]+/, '');
    const ud = (rest.match(/(\d{1,4}|[A-Za-z가-힣])\s*동(?![가-힣])/) || [])[1] || clean(g.udong).replace(/동$/, '');
    const ho = (rest.match(/(\d{1,5})\s*호/) || [])[1] || clean(g.ho).replace(/호$/, '');
    const flm = rest.match(/(지하\s*)?(\d{1,3})\s*층/);
    const bname = (clean(g.bname) || rest.replace(/(\d{1,4}|[A-Za-z])\s*동(?![가-힣])|\d{1,5}\s*호|(지하\s*)?\d{1,3}\s*층|[()]/g, '').replace(/\s+/g, ' ').trim()).slice(0, 40);
    // 종류 · 거래
    let ty = typeOf(g.ptype);
    if (!ty) ty = g.jimok && !g.area && !g.tot ? { ptype: '토지' } : { ptype: MAIN_TY[mains[0]] || '기타', guessed: true };
    let kind = ty.pre && !/월세|전세/.test(clean(g.kind)) ? 'presale' : kindOf(g.kind);
    const wonCol = c => /\(원\)|원\)$/.test(labels[map.indexOf(c)] || '') && !/만원/.test(labels[map.indexOf(c)] || '');
    const price = man(g.price, wonCol('price')), dep = man(g.deposit, wonCol('deposit')), rent = man(g.rent, wonCol('rent'));
    if (!kind) kind = rent ? 'wolse' : price ? 'sale' : dep ? 'jeonse' : 'sale';
    const money = {};
    if (kind === 'sale') { money.price = price; if (dep) money.curDep = dep; if (rent) money.curRent = rent; }
    else if (kind === 'jeonse') money.deposit = dep || price;
    else if (kind === 'wolse') { money.deposit = dep; money.rent = rent; }
    else { money.price = price; }
    if (g.cdep) money.curDep = man(g.cdep); if (g.crent) money.curRent = man(g.crent);
    if (g.premium) money.premium = man(g.premium); if (g.mgmt) money.mgmt = man(g.mgmt); if (g.loan) money.loan = man(g.loan);
    // 면적
    const sq = (k) => g[k] != null && g[k] !== '' ? numOf(g[k]) : g[k + 'py'] != null && g[k + 'py'] !== '' ? (numOf(g[k + 'py']) || 0) * PY || null : null;
    const ex = sq('area'), site = sq('site'), tot = sq('tot');
    const land = ty.ptype === '토지', whole = ['건물', '공장·창고', '숙박'].includes(ty.ptype) || (ty.ptype === '주택' && !ho);
    const area = land ? (site || ex || tot) : whole ? (tot || ex) : (ex || tot);
    // 광고 정보
    const ad = {};
    if (g.appr) { const d = dateOf(g.appr) || clean(g.appr).replace(/[^\d.-]/g, ''); if (d) ad.appr = d.slice(0, 10); }
    if (land && g.jimok) ad.use = clean(g.jimok).slice(0, 40); else if (g.use) ad.use = clean(g.use).slice(0, 40);
    if (g.zone) ad.zone = clean(g.zone).slice(0, 40);
    if (g.floors) { const f = clean(g.floors).match(/(\d+)\s*\/\s*(\d+)/); if (f) { ad.tfl = +f[1]; if (+f[2]) ad.ufl = +f[2]; } else { const n = numOf(g.floors); if (n) ad.tfl = n; } }
    if (g.fl || flm) { ad.fl = flm ? (flm[1] ? 'B' : '') + flm[2] : clean(g.fl).replace(/층$/, '').replace(/^지하\s*/, 'B').slice(0, 8); }
    if (whole) ad.fl = '전체';
    if (g.park) ad.park = clean(g.park).replace(/\n/g, ' ').slice(0, 30);
    if (g.elev) { const n = numOf(g.elev); if (n) ad.elev = n; }
    if (g.dir) { const d = clean(g.dir).replace(/쪽$/, ''); const D = ['남향', '남동향', '남서향', '동향', '서향', '북향', '북동향', '북서향'].find(x => x === d || x === d + '향'); if (D) ad.dir = D; }
    if (g.ty) ad.ty = clean(g.ty).toUpperCase().slice(0, 8);
    if (g.biz) ad.biz = clean(g.biz).slice(0, 30);
    if (/^재(개발|건축)$/.test(ty.ptype)) ad.form = ty.ptype === '재건축' ? '아파트' : '빌라';
    // 연락처
    const contacts = [];
    const people = (names, phones, role) => {
      const nm = (names || []).map(x => clean(x.v)).join('\n'), ph = [...(phones || []).map(x => String(x.v)), nm].join('\n').match(PHONE) || [];
      const ns = nm.replace(PHONE, '').split(/[\n,·\/]+/).map(s => s.replace(/\(.*?\)|skt|kt|lg|u\+/gi, '').trim()).filter(Boolean);
      const n = Math.max(ns.length ? 1 : 0, ph.length);
      for (let i = 0; i < n; i++) contacts.push({ role, name: (ns[i] || (i ? '' : ns[0]) || '').slice(0, 20), phone: ph[i] ? fmtPh(ph[i]) : '' });
    };
    people(multi.owner, multi.phone, '소유자');
    people(multi.tenant, multi.phone2, '임차인');
    // 메모
    const lines = [];
    (multi.memo || []).forEach(x => { const v = clean(x.v); if (v) lines.push(/설명|메모|비고|내역|내용/.test(x.lb) ? v : `${clean(x.lb)}: ${v}`); });
    if (more.length) lines.push(`엑셀의 다른 필지: ${more.join(', ')}`);
    if (g.office) lines.push(`부동산명: ${clean(g.office)}`);
    if (clean(g.kind) && /상속/.test(clean(g.kind))) lines.push(`거래: ${clean(g.kind)}`);
    if (ty.ptype === '기타' && ty.tx) lines.push(`엑셀의 종류: ${ty.tx}`);
    // 등록일
    let at = g.date ? dateOf(g.date) : '';
    if (!at && g.year) { const y = +numOf(g.year), mo = +numOf(g.month) || 1, d = +numOf(g.day) || 1; if (y > 1990) at = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`; }
    const warn = [];
    if (more.length) warn.push('여러 필지');
    if (ty.guessed) warn.push('종류 짐작');
    if (!q) return { skip: 'noaddr', warn };
    const item = {
      kind, status: st, ptype: ty.ptype, ptypeTx: ty.tx || '', bname, ...money,
      contacts, rents: [], photos: [], ad, at, no: clean(g.no).slice(0, 20), exp: g.exp ? dateOf(g.exp) : '',
      _q: q, _land: land, _whole: whole, _ex: { dong: ud, ho, area, site },
      _memo: lines.join('\n'),
    };
    return { item, warn };
  }

  // ---------- 주소 → 필지 ----------
  const GC = new Map();
  function geocode(q) {
    if (GC.has(q)) return GC.get(q);
    const p = new Promise(ok => {
      if (!window.kakao || !kakao.maps || !kakao.maps.services) return ok(null);
      new kakao.maps.services.Geocoder().addressSearch(q, (r, st) => ok(st === 'OK' && r[0] ? { lat: +r[0].y, lng: +r[0].x, t: r[0].address_name } : null));
    });
    GC.set(q, p); return p;
  }
  async function locate(it) {
    const g = await geocode(it._q);
    if (!g) return { err: '주소를 찾지 못함' };
    let p; try { p = await H.api(`/api/parcel?lat=${g.lat}&lng=${g.lng}`); } catch { return { err: '필지를 찾지 못함' }; }
    const pnu = it._land ? p.pnu : (p.bldPnu || p.pnu); if (!pnu) return { err: '필지를 찾지 못함' };
    const e = it._ex;
    const P = { pnu, addr: p.addr || g.t, lat: g.lat, lng: g.lng, bname: it.bname, dong: it._land ? '' : e.dong, ho: it._land ? '' : e.ho, area: e.area || null };
    if (it._land) Object.assign(P, { land: true, ak: 'land' }); else if (it._whole) Object.assign(P, { ak: 'tot', site: e.site || null }); else P.ak = 'ex';
    return { P };
  }

  // 불러온 기록 (설정 → 엑셀에서 나중에도 되돌리기) — 기록이 안 남아도 불러오기는 그대로
  async function imLog(e) { try { const j = await H.api('/api/auth?action=xlog', H.post({ op: 'im', e: { file: S.file, ...e } })); S.logId = j.id; } catch { /* 무시 */ } }
  async function imDone() { if (!S.logId) return; try { await H.api('/api/auth?action=xlog', H.post({ op: 'imdone', id: S.logId })); } catch { /* 무시 */ } }
  // ---------- 화면 ----------
  const keepMain = v => { try { if (v) localStorage.setItem('rm.ximp.main', JSON.stringify(v)); return JSON.parse(localStorage.getItem('rm.ximp.main') || 'null'); } catch { return null; } };
  const keepMap = (sig, v) => { try { const all = JSON.parse(localStorage.getItem('rm.ximp.map') || '{}'); if (v) { all[sig] = v; localStorage.setItem('rm.ximp.map', JSON.stringify(all)); } return all[sig] || null; } catch { return null; } };
  function shell(html) {
    let el = $('xi'); if (!el) { el = document.createElement('div'); el.id = 'xi'; el.className = 'xi'; document.body.appendChild(el); }
    el.innerHTML = `<div class="xi-box" role="dialog" aria-modal="true" aria-label="엑셀 불러오기"><div class="xi-h"><b>${S.title || '엑셀 불러오기'}</b>${S.file ? `<small>${esc(S.file)}</small>` : ''}<button type="button" class="xi-x" id="xiX" aria-label="닫기">×</button></div>
      <div class="xi-st">${(S.steps || ['고르기 · 파일', '확인 · 미리보기', '불러오기 · 결과']).map((t, i) => `<span class="${S.step === i ? 'on' : S.step > i ? 'dn' : ''}">${i + 1}. ${t}</span>`).join('<i>›</i>')}</div>${html}</div>`;
    $('xiX').onclick = close;
    return el;
  }
  function close() {   // S.cxDirty: 단지 장부가 바뀜 → 닫을 때 단지 화면도 새로
    if (S && S.busy && !confirm('불러오는 중입니다. 멈추고 닫을까요? (이미 넣은 내용은 남습니다)')) return; if (S) S.stop = true; const el = $('xi'); if (el) el.remove(); if (S && S.dirty && H.done) H.done(); if (S && S.cxDirty && H.djReload) H.djReload(); S = null; }
  function open(host) {
    H = host; S = { step: 0, mains: keepMain() || [], file: '' };
    step1();
  }
  function step1(err, html) {
    S.step = 0;
    const el = shell(`<div class="xi-bd"><h3>주로 다루시는 매물을 3가지까지 골라 주세요</h3><p class="xi-m">파일을 판단할 때 참고합니다. 파일은 항상 끝까지 읽어서 판단합니다.</p>
      <div class="xi-ch">${MAINS.map(([k, t]) => `<button type="button" data-m="${k}" aria-pressed="${S.mains.includes(k)}">${t}</button>`).join('')}</div>
      <label class="xi-drop" id="xiDrop"><input type="file" id="xiF" accept=".xlsx,.xls,.csv" hidden><b>엑셀 파일을 여기에 끌어다 놓거나 눌러서 고르세요</b><span>xlsx · xls · csv · 다른 매물장 프로그램에서 내려받은 파일도 됩니다</span></label>
      ${err ? `<p class="xi-err">${esc(err)}</p>` : ''}${html || ''}
      <p class="xi-m">파일은 이 브라우저 안에서만 읽고 서버에 올리지 않습니다. 서버에는 매물로 바뀐 내용만 저장됩니다.</p></div>`);
    el.querySelectorAll('[data-m]').forEach(b => b.onclick = () => { const k = b.dataset.m; S.mains = S.mains.includes(k) ? S.mains.filter(x => x !== k) : [...S.mains, k].slice(-3); keepMain(S.mains); step1(); });
    const pick = async f => { if (!f) return; S.file = f.name; shell('<div class="xi-bd"><p class="xi-m">파일을 읽는 중…</p></div>'); try { const sh = await readFile(f); prep(sh); } catch (e) { S.file = ''; step1(e.message || '파일을 읽지 못했습니다.'); } };
    $('xiF').onchange = e => pick(e.target.files[0]);
    const d = $('xiDrop'); d.ondragover = e => { e.preventDefault(); d.classList.add('ov'); }; d.ondragleave = () => d.classList.remove('ov'); d.ondrop = e => { e.preventDefault(); d.classList.remove('ov'); pick(e.dataTransfer.files[0]); };
  }
  function prep(sh) {
    const rows = sh.rows || [];
    if (rows.length < 2) return step1('내용이 있는 줄을 찾지 못했습니다.');
    const { labels, start } = header(rows);
    const data = rows.slice(start).map((r, j) => (r._n = start + j + 1, r)).filter(r => r.some(c => clean(c)) && !r.some(c => /예시라 지우고/.test(String(c))));   // 리얼맵 양식의 예시 줄은 건너뜀
    const sig = labels.map(norm).join('|');
    let map = keepMap(sig) || autoMap(labels, data);
    if (map.length !== labels.length) map = autoMap(labels, data);
    const LM = lmap(labels);
    const ledger = LM.includes('dong') && LM.includes('ho') && (LM.includes('office') || LM.includes('cur') || labels.some(l => /^타입$/.test(norm(l))));
    if (ledger) {   // 아파트 장부(동·호별) → 단지 장부로. 주소 칸은 꼭 있어야 함 (없으면 엑셀에 채워서 다시)
      if (!map.some(k => ['addr', 'sido', 'sgg', 'umd', 'jibun'].includes(k))) { S.file = ''; return step1('', NOADDR); }
      Object.assign(S, { labels, data, map, LM, sheet: sh.name });
      return ldPrep();
    }
    Object.assign(S, { labels, data, map, sig, sheet: sh.name });
    step2();
  }
  function convert() {
    const out = { ok: [], warn: [], skip: { empty: 0, other: 0, dup: 0, noaddr: 0 }, rows: [] };
    S.data.forEach((r, i) => {
      const x = rowItem(r, S.map, S.labels, S.mains);
      if (x.skip) { out.skip[x.skip]++; if (x.skip === 'noaddr') out.rows.push({ i, r, err: '주소 칸이 비어 있음' }); return; }
      x.item._row = i; (x.warn.length ? out.warn : out.ok).push(x);
    });
    return out;
  }
  function step2() {
    S.step = 1;
    const C = convert(); S.conv = C;
    const all = [...C.ok, ...C.warn], skipN = C.skip.empty + C.skip.other + C.skip.dup + C.skip.noaddr;
    const room = Math.max(0, (H.plan().ls || 0) - H.items().length);
    const sample = all.slice(0, 6);
    const pr = x => { const it = x.item; return it.kind === 'wolse' ? `${it.deposit || 0}/${it.rent || '-'}` : (it.price || it.deposit || '-').toLocaleString(); };
    const opts = cur => Object.entries(ALLT).map(([k, t]) => `<option value="${k}" ${k === cur ? 'selected' : ''}>${esc(t)}</option>`).join('');
    const ex = c => { for (const r of S.data.slice(0, 30)) { const v = clean(r[c]); if (v) return v.slice(0, 26); } return ''; };
    const el = shell(`<div class="xi-bd">
      <div class="xi-sum"><div class="t"><b>${S.data.length}</b>엑셀 줄</div><div class="g"><b>${C.ok.length}</b>바로 등록</div><div class="y"><b>${C.warn.length}</b>확인 필요<small>노랑 표시로 넣음</small></div><div class="n"><b>${skipN}</b>건너뜀</div></div>
      <p class="xi-m">건너뜀 = 빈 줄 ${C.skip.empty} · 타거래 ${C.skip.other} · 중복 ${C.skip.dup} · 주소 없음 ${C.skip.noaddr}${all.length > room ? ` · <b class="xi-r">요금제 한도로 ${room.toLocaleString()}건까지만 넣을 수 있습니다</b>` : ''}</p>
      ${sample.length ? `<table class="xi-t"><tr><th>엑셀 줄</th><th>종류</th><th>주소</th><th>거래</th><th>가격</th><th>면적</th><th></th></tr>${sample.map(x => `<tr><td>${S.data[x.item._row]._n}</td><td>${esc(x.item.ptype)}</td><td>${esc(x.item._q)}${x.item._ex.dong || x.item._ex.ho ? ` · ${esc([x.item._ex.dong && x.item._ex.dong + '동', x.item._ex.ho && x.item._ex.ho + '호'].filter(Boolean).join(' '))}` : ''}</td><td>${H.X.KIND[x.item.kind]}</td><td>${esc(pr(x))}</td><td>${x.item._ex.area ? (x.item._ex.area / PY).toFixed(1) + '평' : '-'}</td><td>${x.warn.length ? `<span class="tg y">${esc(x.warn.join(' · '))}</span>` : '<span class="tg g">OK</span>'}</td></tr>`).join('')}</table>` : ''}
      <details class="xi-map" ${S.openMap ? 'open' : ''}><summary>칸 맞추기 보기 · 고치기 <small>(${S.labels.filter(Boolean).length}칸 · 틀린 것만 바꾸면 숫자가 바로 바뀝니다)</small></summary>
        <table class="xi-t"><tr><th>엑셀 칸</th><th>예시 값</th><th>넣을 곳</th></tr>${S.labels.map((lb, c) => lb ? `<tr><td>${esc(lb)}</td><td class="ex">${esc(ex(c))}</td><td><select data-c="${c}" class="${S.map[c] === 'skip' ? 'no' : ''}">${opts(S.map[c])}</select></td></tr>` : '').join('')}</table></details>
      </div>
      <div class="xi-f"><span>칸 맞춤은 이 브라우저에 기억해서 같은 양식은 다음부터 그대로 씁니다</span><button type="button" class="xi-b" id="xiBack">‹ 다른 파일</button><button type="button" class="xi-b go" id="xiGo" ${all.length && room ? '' : 'disabled'}>${Math.min(all.length, room).toLocaleString()}건 불러오기</button></div>`);
    el.querySelectorAll('select[data-c]').forEach(s => s.onchange = () => { S.map[+s.dataset.c] = s.value; S.openMap = true; keepMap(S.sig, S.map); step2(); });
    el.querySelector('details').ontoggle = e => { S.openMap = e.target.open; };
    $('xiBack').onclick = () => { S.file = ''; step1(); };
    $('xiGo').onclick = () => { keepMap(S.sig, S.map); run(all.slice(0, room)); };
  }
  async function run(list) {
    S.step = 2; S.busy = true; S.stop = false; S.ib = 'x' + Date.now().toString(36);
    const done = [], fail = [...S.conv.rows], ready = [];
    const draw = () => shell(`<div class="xi-bd"><b>주소 찾는 중… ${done.length + fail.length - S.conv.rows.length} / ${list.length}</b><span class="xi-m"> · 창을 닫지 마세요</span>
      <div class="xi-bar"><i style="width:${Math.round((done.length + fail.length - S.conv.rows.length) / Math.max(1, list.length) * 100)}%"></i></div>
      <p class="xi-m">찾은 매물은 ${150}건씩 묶어서 저장합니다. 저장됨 ${S.saved || 0}건</p></div>`);
    draw();
    let k = 0;
    let busyF = false;   // 저장은 한 번에 하나씩 (동시에 보내면 서버에서 서로 덮어씀)
    const flush = async force => {
      if (busyF) return; busyF = true;
      try { while (ready.length >= 150 || (force && ready.length)) {
        const chunk = ready.splice(0, 150);
        try { const j = await H.api('/api/auth?action=listing', H.post({ op: 'import', ib: S.ib, items: chunk })); H.took(j); S.dirty = true; S.saved = (S.saved || 0) + ((j.imported && j.imported.n) || 0); ((j.imported && j.imported.bad) || []).forEach(b => fail.push({ i: chunk[b.i]._row, r: S.data[chunk[b.i]._row], err: b.msg })); }
        catch (e) { chunk.forEach(c => fail.push({ i: c._row, r: S.data[c._row], err: e.message || '저장하지 못함' })); if (e.code === 'limit') { S.stop = true; break; } }
      } } finally { busyF = false; }
    };
    const worker = async () => {
      while (k < list.length && !S.stop) {
        const x = list[k++], it = x.item;
        const L = await locate(it);
        if (L.err) { fail.push({ i: it._row, r: S.data[it._row], err: L.err }); }
        else {
          const sp = stampSplit(it._memo);   // 날짜가 붙은 메모는 그 날짜의 기록으로 따로 (10/28)
          const memo = [H.X.memoAdd('', `엑셀 불러오기${sp.head ? ' · ' + sp.head : ''}`), ...sp.list.map(e => `[${memoT(e.t)}] ${e.x}${e.w ? ' · ' + e.w : ''}`)].join('\n');
          const send = { ...it, places: [L.P], memo, ...(x.warn.length ? { mk: 'y', imp: `엑셀 확인: ${x.warn.join(' · ')}` } : {}) };
          Object.keys(send).forEach(kk => { if (kk.startsWith('_')) delete send[kk]; });
          send._row = it._row; ready.push(send); done.push(it._row);
        }
        if ((done.length + fail.length) % 5 === 0) draw();
        if (ready.length >= 150) await flush(false);
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    await flush(true);
    S.busy = false;
    if (S.saved) await imLog({ to: 'ls', n: S.saved, ib: S.ib });
    result(fail.sort((a, b) => a.i - b.i));
  }
  function result(fail) {
    S.step = 2;
    const el = shell(`<div class="xi-bd"><div class="xi-sum"><div class="g"><b>${S.saved || 0}</b>등록됨</div><div class="y"><b>${fail.length}</b>못 넣음</div></div>
      <p class="xi-m">확인이 필요한 줄은 <b>노랑 표시</b>와 '꼭 챙길 것'에 '엑셀 확인'을 적어 두었습니다. 표에서 바로 고치시면 됩니다.</p>
      ${fail.length ? `<h3>못 넣은 줄</h3><table class="xi-t"><tr><th>엑셀 줄</th><th>내용</th><th>이유</th></tr>${fail.slice(0, 50).map(f => `<tr><td>${(f.r && f.r._n) || f.i + 1}</td><td class="ex">${esc((f.r || []).map(clean).filter(Boolean).slice(0, 6).join(' · ').slice(0, 80))}</td><td>${esc(f.err)}</td></tr>`).join('')}</table>${fail.length > 50 ? `<p class="xi-m">외 ${fail.length - 50}줄 — 엑셀로 받아서 보세요</p>` : ''}` : ''}</div>
      <div class="xi-f">${S.saved ? `<button type="button" class="xi-b red" id="xiUndo">이번에 불러온 ${S.saved}건 모두 되돌리기</button>` : '<span></span>'}${fail.length ? '<button type="button" class="xi-b" id="xiFail">못 넣은 줄 엑셀로 받기</button>' : ''}<button type="button" class="xi-b go" id="xiDone">닫고 매물장 보기</button></div>`);
    $('xiDone').onclick = close;
    if ($('xiFail')) $('xiFail').onclick = () => {
      const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
      const lines = [['엑셀 줄', '이유', ...S.labels].map(q).join(','), ...fail.map(f => [(f.r && f.r._n) || f.i + 1, f.err, ...(f.r || [])].map(q).join(','))];
      const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' })); a.download = '불러오지_못한_줄.csv'; document.body.appendChild(a); a.click(); a.remove();
    };
    if ($('xiUndo')) $('xiUndo').onclick = async () => {
      if (!confirm(`이번에 불러온 ${S.saved}건을 모두 지울까요? (불러온 뒤 고친 내용도 함께 지워집니다)`)) return;
      try { const j = await H.api('/api/auth?action=listing', H.post({ op: 'unimport', ib: S.ib })); H.took(j); S.dirty = true; await imDone(); H.toast(`${j.unimported || 0}건을 되돌렸습니다`); S.saved = 0; close(); }
      catch (e) { H.toast(e.message || '되돌리지 못했습니다'); }
    };
  }

  // ================= 아파트 장부(동·호별) → 단지 장부 (10/26) =================
  // 매물장 [엑셀 불러오기] 하나에서 양식을 보고 자동으로 이쪽으로 옴. 주소 칸(단지 주소)이 꼭 있어야 함 — 없으면 엑셀에 채워서 다시 올리도록 안내.
  // 주소 → 필지 → 등록된 단지와 맞춤(없으면 새로 담음) → 동은 그 단지 건축물대장 동 목록에서 → 이미 적힌 호는 건너뜀 → 호별 장부 저장. 되돌리기 = 이번에 만든 호(+새로 담은 단지)만.
  const NOADDR = `<div class="xi-warn"><b>아파트 장부(동·호별) 파일인데 주소 칸이 없습니다.</b><br>엑셀 맨 앞에 <b>'주소'</b> 칸을 하나 만들고 줄마다 단지 주소를 채운 뒤 다시 올려 주세요.
    <table class="xi-t"><tr><th>주소</th><th>물건명</th><th>동</th><th>호</th><th>…</th></tr><tr><td><b>마포구 아현동 777</b></td><td>마래푸</td><td>103</td><td>101</td><td>(그대로)</td></tr></table>
    <span>지번 주소·도로명 주소 둘 다 됩니다. 같은 단지는 같은 주소를 복사해서 붙여 넣으시면 됩니다.</span></div>`;
  const LCOL = [['name', /물건명|단지명|^단지$/], ['dong', /^동$/], ['ho', /^호$/], ['office', /부동산명|중개사무소/], ['prog', /^진행/], ['stt', /^상태$/],
    ['kind', /거래구분|^거래$/], ['ps', /의뢰가격\/매매|^매매가?$/], ['pj', /의뢰가격\/전세|^전세가?$/], ['pwd', /의뢰가격\/보증금|^보증금$/], ['pwr', /의뢰가격\/월세|^월세$/],
    ['opt', /물건내역/], ['cur', /현상태\/구분|^현상태$/], ['cd', /현상태\/(전세|보증)|^현보증금$|^현전세$/], ['cr', /현상태\/(차임|월세)|^현차임$|^현월세$/], ['exp', /만기/],
    ['oP', /(소유주|소유자|집주인)\/?(핸드폰|전화|연락처|휴대폰)/], ['oN', /(소유주|소유자|집주인)(\/이름)?$/], ['tP', /(세입자|임차인)\/?(핸드폰|전화|연락처|휴대폰)/], ['tN', /(세입자|임차인)(\/이름)?$/],
    ['note', /상담내역|메모|비고/]];
  const lmap = labels => labels.map(lb => { const n = norm(lb); for (const [k, re] of LCOL) if (re.test(n)) return k; return ''; });
  const DS = { mine: '내 매물', other: '타부동산' };
  function ledgerRec(get, my) {
    const st = { src: '', k: [], hold: false, office: '' }, pr = { sale: man(get('ps')) || 0, jeonse: man(get('pj')) || 0, wd: man(get('pwd')) || 0, wr: man(get('pwr')) || 0 };
    const kt = clean(get('kind'));
    const k = ['sale', 'jeonse', 'wolse'].filter(z => (z === 'sale' ? /매매/ : z === 'jeonse' ? /전세/ : /월세|임대/).test(kt) || (z === 'sale' ? pr.sale : z === 'jeonse' ? pr.jeonse : pr.wd || pr.wr));
    const of = clean(get('office')).slice(0, 30), mine = !of || (my && (my.includes(of) || of.includes(my.replace(/공인중개사사무소|부동산중개|공인중개|부동산|사무소/g, '') || '@@')));
    if (k.length) Object.assign(st, { src: mine ? 'mine' : 'other', k, hold: /보류/.test(clean(get('stt'))), office: mine ? '' : of });
    const rec = { st, pr, live: '', exp: dateOf(get('exp')), moveIn: '', opt: clean(get('opt')).replace(/\n+/g, ' ').slice(0, 200), tels: [], note: '', imp: '', cd: man(get('cd')) || 0, cr: man(get('cr')) || 0, mk: '' };
    const cur = clean(get('cur')).replace(/\s/g, ''), notes = [], warn = [];
    let m;
    if (/^(전|월)/.test(cur) && /완/.test(cur)) rec.live = 'tenant';   // 전완·월완 = 지금 전세·월세 사는 중
    else if ((m = cur.match(/^(\d{1,2})월?퇴/))) { rec.live = 'tenant'; rec.imp = `${+m[1]}월 퇴거 예정`; }
    else if (/^입주/.test(cur)) rec.moveIn = '입주 가능';
    else if (/주인|자가|본인/.test(cur)) rec.live = 'owner';
    else if (/공실|비어/.test(cur)) rec.live = 'empty';
    else if (cur) notes.push(`현상태: ${cur}`);
    if (!rec.live && (rec.cd || rec.cr)) rec.live = 'tenant';
    const tel = (nm, ph, lab) => { const name = clean(get(nm)).split('\n')[0]; (clean(get(ph)).match(PHONE) || []).slice(0, 2).forEach(p => rec.tels.length < 4 && rec.tels.push({ l: (lab + (name ? ' ' + name : '')).slice(0, 10), n: fmtPh(p) })); if (name && !clean(get(ph))) notes.push(`${lab} ${name}`); };
    tel('oN', 'oP', '소유'); tel('tN', 'tP', '임차');
    const prog = clean(get('prog')); if (prog) notes.push(prog === '♥' ? '♥ 표시(받은 장부)' : `진행: ${prog}`);
    const sp = stampSplit(clean(get('note')).replace(/\n+/g, ' ')); if (sp.head) notes.push(sp.head);   // 날짜가 붙은 상담내역은 상담 기록(히스토리)으로 (10/28)
    rec.note = notes.join(' · ').slice(0, 300);
    if (k.length > 0 && !pr.sale && !pr.jeonse && !pr.wd && !pr.wr) warn.push('가격 없음');
    return { rec, warn, hist: sp.list };
  }
  const nmN = s => String(s || '').replace(/\s|아파트|APT/gi, '');
  const addrQ = (r, map) => {   // 줄의 단지 주소 (주소 칸 또는 시·구·동·지번 칸)
    const g = {}; map.forEach((k, c) => { if (['addr', 'sido', 'sgg', 'umd', 'jibun'].includes(k) && clean(r[c]) && !g[k]) g[k] = clean(r[c]); });
    if (g.addr) { const a = g.addr.replace(/\n/g, ' ').match(/^(.*?\d+(?:-\d+)?)(?!\d)/); return (a ? a[1] : g.addr).trim(); }
    const jb = (String(g.jibun || '').match(/^(산\s?)?\d+(?:-\d+)?/) || [''])[0];
    return [g.sido, g.sgg, g.umd, jb].filter(Boolean).join(' ');
  };
  async function dongsAt(pnu) {
    try { const b = await H.api(`/api/building?pnu=${pnu}`); return ((b.titles && b.titles.data) || []).filter(t => t.mainAtch !== '부속건축물' && t.dong && /\d/.test(t.dong)).map(t => ({ pnu, dong: String(t.dong).trim() })); } catch { return []; }
  }
  const dnN = v => String(v || '').replace(/\s|동$/g, '').replace(/^제/, '').toUpperCase();
  const hoN = v => { const d = String(v || '').replace(/\D/g, ''); return d || String(v || '').replace(/\s|호$/g, ''); };
  const keyOf = (pnu, dong, ho) => `${pnu}|${dnN(dong)}|${hoN(ho)}`;
  async function ldPrep() {
    S.ld = true; S.step = 1;
    shell('<div class="xi-bd"><p class="xi-m">아파트 장부 양식입니다. 단지 주소를 찾는 중…</p></div>');
    const ci = k => S.LM.indexOf(k);
    const groups = new Map(); let noaddr = 0;
    S.data.forEach(r => { const q = addrQ(r, S.map); if (!q) { noaddr++; r._q = ''; return; } r._q = q; if (!groups.has(q)) groups.set(q, { q, rows: [], names: new Map() }); const G = groups.get(q); G.rows.push(r); const n = ci('name') >= 0 ? clean(r[ci('name')]) : ''; if (n) G.names.set(n, (G.names.get(n) || 0) + 1); });
    let cxs = []; try { cxs = (await H.api('/api/auth?action=cx')).items || []; } catch (e) { S.file = ''; return step1(e.message || '단지 장부를 불러오지 못했습니다.'); }
    for (const G of groups.values()) {
      const g = await geocode(G.q);
      if (!g) { G.err = '주소를 찾지 못함'; continue; }
      let p; try { p = await H.api(`/api/parcel?lat=${g.lat}&lng=${g.lng}`); } catch { G.err = '필지를 찾지 못함'; continue; }
      const pnu = p.bldPnu || p.pnu; if (!pnu) { G.err = '필지를 찾지 못함'; continue; }
      let bname = ''; try { const b = await H.api(`/api/building?pnu=${pnu}`); const rc = b.recap && b.recap.data && b.recap.data[0], t = (b.titles && b.titles.data || []).find(x => x.name); bname = (rc && rc.name) || (t && t.name) || ''; } catch { /* 이름 없음 */ }
      const fname = [...G.names].sort((a, b) => b[1] - a[1]).map(x => x[0])[0] || '';
      G.place = { pnu, addr: p.addr || g.t, lat: g.lat, lng: g.lng }; G.name = bname || fname || G.place.addr;
      G.cx = cxs.find(c => (c.places || []).some(x => x.pnu === pnu)) || (bname && cxs.find(c => nmN(c.name) === nmN(bname))) || null;
      const pl = G.cx ? G.cx.places.map(x => x.pnu) : [pnu];
      G.dongs = (await Promise.all(pl.map(dongsAt))).flat();
      G.units = {};
      if (G.cx) { try { G.units = (await H.api(`/api/auth?action=hj&id=${encodeURIComponent(G.cx.id)}`)).units || {}; } catch (e) { G.err = e.message || '단지 장부를 열지 못함'; } }
    }
    const P = H.plan() || {};
    S.cxRoom = Math.max(0, (P.cx || 0) - cxs.length);
    Object.assign(S, { groups: [...groups.values()], noaddr });
    ldStep2();
  }
  function ldConvert() {
    const ci = k => S.LM.indexOf(k), out = { ok: [], warn: [], fail: [], skip: { have: 0, empty: 0, noaddr: S.noaddr } };
    let room = S.cxRoom;
    for (const G of S.groups) {
      G.add = !G.cx && !G.err && room > 0; if (G.add) room--;
      const why = G.err || (!G.cx && !G.add ? '단지 한도가 차서 새 단지를 담지 못함' : '');
      const seen = new Set();
      for (const r of G.rows) {
        const get = k => (ci(k) >= 0 ? r[ci(k)] : '');
        const dn = dnN(clean(get('dong'))), ho = hoN(clean(get('ho')));
        if (!dn || !ho) { out.skip.empty++; continue; }
        if (why) { out.fail.push({ r, err: why }); continue; }
        const d = G.dongs.find(z => dnN(z.dong) === dn);
        if (!d) { out.fail.push({ r, err: `${dn}동을 ${G.name}에서 찾지 못함` }); continue; }
        const key = keyOf(d.pnu, d.dong, ho);
        if (seen.has(key)) { out.fail.push({ r, err: `${dn}동 ${ho}호가 파일에 두 번 있음 (앞 줄만 넣음)` }); continue; }
        seen.add(key);
        if (G.units[key]) { out.skip.have++; continue; }
        const x = ledgerRec(get, H.office ? H.office() : ''); Object.assign(x, { key, r, dn, ho, G });
        (x.warn.length ? out.warn : out.ok).push(x);
      }
    }
    return out;
  }
  function ldStep2() {
    S.step = 1;
    const C = S.conv = ldConvert(), all = [...C.ok, ...C.warn];
    const kinds = x => x.rec.st.k.map(k => ({ sale: '매매', jeonse: '전세', wolse: '월세' }[k])).join('·') || '-';
    const prs = x => { const p = x.rec.pr; return [p.sale && p.sale.toLocaleString(), p.jeonse && p.jeonse.toLocaleString(), (p.wd || p.wr) && `${p.wd || 0}/${p.wr || 0}`].filter(Boolean).join(' · ') || '-'; };
    const now = x => { const r = x.rec; return [r.live === 'tenant' ? '임차' : r.live === 'owner' ? '주인' : r.live === 'empty' ? '공실' : '', (r.cd || r.cr) && `${(r.cd || 0).toLocaleString()}${r.cr ? '/' + r.cr : ''}`, r.exp && '만기 ' + r.exp.slice(2).replace(/-/g, '.'), r.moveIn, r.imp].filter(Boolean).join(' · ') || '-'; };
    const gl = S.groups.map(G => `<tr><td>${esc(G.q)}</td><td>${esc([...G.names.keys()].join(', ') || '-')}</td><td>${G.rows.length}줄</td><td>${G.err ? `<span class="tg r">${esc(G.err)}</span>` : G.cx ? `<span class="tg g">${esc(G.cx.name)}</span>` : G.add ? `<span class="tg y">새로 담음 · ${esc(G.name)}</span>` : '<span class="tg r">단지 한도 참</span>'}</td></tr>`).join('');
    const el = shell(`<div class="xi-bd"><p class="xi-warn"><b>아파트 장부(동·호별) 파일</b>입니다. 매물장이 아니라 <b>[아파트] 단지 장부</b>의 각 호에 넣습니다.</p>
      <table class="xi-t"><tr><th>엑셀 주소</th><th>물건명</th><th></th><th>넣을 단지</th></tr>${gl}</table>
      <div class="xi-sum"><div class="t"><b>${S.data.length}</b>엑셀 줄</div><div class="g"><b>${C.ok.length}</b>바로 넣음</div><div class="y"><b>${C.warn.length + C.fail.length}</b>확인 필요<small>노랑 ${C.warn.length} · 못 넣음 ${C.fail.length}</small></div><div class="n"><b>${C.skip.have + C.skip.empty + C.skip.noaddr}</b>건너뜀</div></div>
      <p class="xi-m">건너뜀 = 이미 장부에 적힌 호 ${C.skip.have} · 동·호 없음 ${C.skip.empty} · 주소 빈 줄 ${C.skip.noaddr}${C.skip.noaddr ? ' <b class="xi-r">(주소를 채워서 다시 올리면 들어갑니다)</b>' : ''} · 부동산명이 비었거나 우리 사무소면 <b>내 매물</b>, 다른 이름이면 <b>타부동산</b></p>
      ${all.length ? `<table class="xi-t"><tr><th>엑셀 줄</th><th>동·호</th><th>상태</th><th>거래</th><th>의뢰가격</th><th>현상태</th><th></th></tr>${all.slice(0, 8).map(x => `<tr><td>${x.r._n}</td><td>${esc(x.dn)}-${esc(x.ho)}</td><td>${x.rec.st.src ? DS[x.rec.st.src] + (x.rec.st.office ? `(${esc(x.rec.st.office)})` : '') : '-'}</td><td>${kinds(x)}</td><td>${esc(prs(x))}</td><td>${esc(now(x))}</td><td>${x.warn.length ? `<span class="tg y">${esc(x.warn.join(' · '))}</span>` : '<span class="tg g">OK</span>'}</td></tr>`).join('')}</table>` : ''}
      ${C.fail.length ? `<p class="xi-m">못 넣는 줄: ${C.fail.slice(0, 3).map(f => `${f.r._n}줄 ${esc(f.err)}`).join(' · ')}${C.fail.length > 3 ? ` 외 ${C.fail.length - 3}줄` : ''}</p>` : ''}
      <p class="xi-m">현상태: 전완·월완 → 임차인 거주(현 보증금·차임) · 12퇴 → 임차인 거주 + 꼭 챙길 것 '12월 퇴거 예정' · 입주 → 입주 가능 · ♥ → 메모 · 물건내역 → 옵션·수리 · 상담내역 → 메모</p></div>
      <div class="xi-f"><span></span><button type="button" class="xi-b" id="xiBack">‹ 다른 파일</button><button type="button" class="xi-b go" id="xiGo" ${all.length ? '' : 'disabled'}>${all.length}호 넣기</button></div>`);
    $('xiBack').onclick = () => { S.file = ''; S.ld = false; step1(); };
    $('xiGo').onclick = () => ldRun(all);
  }
  async function ldRun(list) {
    S.step = 2; S.busy = true; S.stop = false; S.made = []; S.newCx = [];
    const fail = [...S.conv.fail]; let n = 0;
    shell('<div class="xi-bd"><p class="xi-m">단지를 담는 중…</p></div>');
    for (const G of S.groups.filter(g => g.add && list.some(x => x.G === g))) {   // 새 단지 먼저 담기
      try { const j = await H.api('/api/auth?action=cx', H.post({ op: 'add', name: G.name, place: G.place })); G.cx = { id: j.id, name: G.name }; S.newCx.push(j.id); S.cxDirty = true; }
      catch (e) { G.err = e.message || '단지를 담지 못함'; }
    }
    const todo = list.filter(x => { if (x.G.cx) return true; fail.push({ r: x.r, err: x.G.err || '단지를 담지 못함' }); return false; });
    let k = 0;
    const draw = () => shell(`<div class="xi-bd"><b>넣는 중… ${n} / ${todo.length}</b><span class="xi-m"> · 창을 닫지 마세요</span><div class="xi-bar"><i style="width:${Math.round(n / Math.max(1, todo.length) * 100)}%"></i></div></div>`);
    draw();
    const worker = async () => {
      while (k < todo.length && !S.stop) {
        const x = todo[k++];
        const rec = { ...x.rec, ...(x.warn.length ? { mk: 'y', imp: (x.rec.imp ? x.rec.imp + ' · ' : '') + '엑셀 확인: ' + x.warn.join(' · ') } : {}) };
        try {
          await H.api('/api/auth?action=hj', H.post({ id: x.G.cx.id, key: x.key, op: 'save', rec })); S.made.push([x.G.cx.id, x.key]); S.cxDirty = true;
          if (x.hist && x.hist.length) await H.api('/api/auth?action=hj', H.post({ id: x.G.cx.id, key: x.key, op: 'imh', hist: x.hist }));   // 날짜별 상담 기록
        }
        catch (e) { fail.push({ r: x.r, err: e.message || '저장하지 못함' }); }
        n++; if (n % 5 === 0) draw();
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    S.busy = false;
    if (S.made.length || S.newCx.length) await imLog({ to: 'hj', n: S.made.length, made: S.made, newCx: S.newCx, names: [...new Set(S.made.map(([id]) => (S.groups.find(G => G.cx && G.cx.id === id) || {}).name).filter(Boolean))].join(', ') });
    ldResult(fail.sort((a, b) => a.r._n - b.r._n));
  }
  function ldResult(fail) {
    const names = [...new Set(S.made.map(([id]) => (S.groups.find(G => G.cx && G.cx.id === id) || {}).name).filter(Boolean))];
    const el = shell(`<div class="xi-bd"><div class="xi-sum"><div class="g"><b>${S.made.length}</b>호 넣음</div><div class="y"><b>${fail.length}</b>못 넣음</div>${S.newCx.length ? `<div class="t"><b>${S.newCx.length}</b>새로 담은 단지</div>` : ''}</div>
      <p class="xi-m">${names.length ? `<b>${esc(names.join(', '))}</b> 단지 장부에 넣었습니다. ` : ''}확인이 필요한 호는 <b>노랑 표시</b>와 '꼭 챙길 것'에 '엑셀 확인'을 적어 두었습니다. 넣은 내용은 각 호의 [기록]에도 남습니다.</p>
      ${fail.length ? `<h3>못 넣은 줄</h3><table class="xi-t"><tr><th>엑셀 줄</th><th>이유</th></tr>${fail.slice(0, 50).map(f => `<tr><td>${f.r._n}</td><td>${esc(f.err)}</td></tr>`).join('')}</table>` : ''}</div>
      <div class="xi-f">${S.made.length || S.newCx.length ? `<button type="button" class="xi-b red" id="xiUndo">이번에 넣은 것 모두 되돌리기</button>` : '<span></span>'}<button type="button" class="xi-b go" id="xiDone">닫고 단지 장부 보기</button></div>`);
    $('xiDone').onclick = () => { const id = S.made[0] && S.made[0][0]; close(); if (id && H.goDanji) H.goDanji(id); };
    if ($('xiUndo')) $('xiUndo').onclick = async () => {
      if (!confirm(`이번에 넣은 ${S.made.length}호${S.newCx.length ? `와 새로 담은 단지 ${S.newCx.length}곳` : ''}을 모두 지울까요? (넣은 뒤 고친 내용·기록도 함께 지워집니다)`)) return;
      shell('<div class="xi-bd"><p class="xi-m">되돌리는 중…</p></div>');
      let m = 0; for (const [id, key] of S.made) { if (S.newCx.includes(id)) continue; try { await H.api('/api/auth?action=hj', H.post({ id, key, op: 'wipe' })); m++; } catch { /* 다음 */ } }
      for (const id of S.newCx) { try { await H.api('/api/auth?action=cx', H.post({ op: 'del', id })); } catch { /* 다음 */ } }
      await imDone();
      H.toast(`되돌렸습니다 (${m + S.made.filter(([id]) => S.newCx.includes(id)).length}호${S.newCx.length ? ` · 단지 ${S.newCx.length}곳` : ''})`); S.made = []; close();
    };
  }
  return { open, _rowItem: rowItem, _header: header, _autoMap: autoMap, _ledgerRec: ledgerRec, _lmap: lmap };
})();
