// 리얼맵 중개장부 · 엑셀 불러오기 (10/26)
// ① 주로 다루는 매물 3가지(힌트) + 파일 → ② 칸 맞추기·미리보기(숫자) → ③ 주소 찾기·불러오기·결과(못 찾은 줄 · 되돌리기)
// 파일은 브라우저 안에서만 읽고 서버에는 올리지 않습니다. 서버에는 매물로 바뀐 내용만 묶음(최대 150건씩)으로 저장.
// 쓰는 곳: listings.js → XImport.open(host)  host = { api, post, took, toast, items, plan, kakao, X, done }
//   11/5: XImport.form() = 빈 양식 받기 (설정) · XImport.exportLs(매물들) = 매물장 내려받기 (같은 양식 · listings.js)
window.XImport = (() => {
  const $ = id => document.getElementById(id);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const PY = 3.3058;
  let H = null, S = null;
  const MAINS = [['apt', '아파트·오피스텔'], ['shop', '상가·사무실'], ['bld', '건물'], ['ofc', '지식산업센터'], ['home', '빌라·주택'], ['redev', '재개발·재건축'], ['pre', '분양권'], ['land', '토지'], ['fac', '공장·창고'], ['etc', '숙박·기타']];
  const MAIN_TY = { apt: '아파트', shop: '상가', bld: '건물', ofc: '지식산업센터', home: '빌라', redev: '재개발', pre: '아파트', land: '토지', fac: '공장·창고', etc: '기타' };

  // ---------- 칸 이름 사전 (칸 제목 → 넣을 곳) ----------
  const T = {
    skip: '넣지 않음', no: '매물번호', date: '등록일', year: '등록 연', month: '등록 월', day: '등록 일', status: '상태(진행·보류·완료)',
    addr: '주소(전체)', sido: '주소 · 시도', sgg: '주소 · 시군구', umd: '주소 · 읍면동', jibun: '주소 · 지번(뒤에 건물명·호 가능)',
    bname: '건물명·단지명', udong: '동(○○동 아파트의 동)', ho: '호', fl: '층', floors: '지상/지하 층수',
    ptype: '매물 종류', kind: '거래(매매·전세·월세)', price: '매매가·가격', deposit: '보증금·전세금', rent: '월세', premium: '권리금', mgmt: '관리비', loan: '융자',
    cdep: '현 보증금(임차중)', crent: '현 월세(임차중)', exp: '만기일',
    area: '전용면적', site: '대지면적', tot: '연면적', appr: '사용승인일', jimok: '지목', zone: '용도지역', use: '건축물 용도', elev: '승강기', park: '주차', dir: '방향', ty: '타입(84B)',
    biz: '현재 업종', pr: '프리미엄(분양권)', rz: '구역명(재개발)', apv: '감정가', rgt: '권리가액', memo: '메모·설명', owner: '소유자 이름', phone: '연락처', tenant: '임차인·소개자 이름', office: '부동산명(아파트 장부)',
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
    if (wb.SheetNames.includes(TPL_MARK)) return { tpl: true, wb };   // 11/3 리얼맵 표준 양식
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
  const ALLT = { ...T, phone2: '연락처(임차인·소개자)', areapy: '전용면적(평)', sitepy: '대지면적(평)', totpy: '연면적(평)',
    // 11/5 양식 v2 칸
    st2: '매물(O·X·완료)', spy: '평형', src: '받은 곳(내 매물·타부동산)', jeon: '전세가', loanR: '융자 표시', imp: '챙길 것', live: '현상태(입주·임차·공실)', rooms: '방 수', baths: '욕실 수', movein: '입주 가능일', opt: '옵션',
    wc: '화장실', wcn: '화장실 수', road: '도로 접면', strct: '건축구조', pow: '사용전력(kW)', ch: '층고(m)', hoist: '호이스트(톤)', trl: '추레라', facx: '기타 시설', stage: '단계(재개발)', form: '물건 형태(재개발)',
    jshare: '대지지분(㎡)', msh: '조합원 분양', mvl: '이주비', down: '계약금(분양권)', mid: '중도금', midTx: '중도금 메모', due: '입주 예정', resale: '전매 가능일', others: '그 외 연락처' };

  // ---------- 한 줄 → 매물 ----------
  function rowItem(r, map, labels, mains) {
    const g = {}, multi = {};
    map.forEach((k, c) => { if (k === 'skip') return; const v = r[c]; if (v === '' || v == null) return; if (['memo', 'phone', 'phone2', 'owner', 'tenant', 'others'].includes(k)) (multi[k] || (multi[k] = [])).push({ v, lb: labels[c] }); else if (g[k] == null || g[k] === '') g[k] = v; });
    const any = Object.keys(g).some(k => !['no', 'year', 'month', 'day', 'status', 'st2', 'src'].includes(k)) || Object.keys(multi).length;
    if (!any) return { skip: 'empty' };
    const s2 = clean(g.st2);   // 11/5 양식 맨 앞 '매물' 칸: O = 매물(진행) · X = 장부에만(보류) · 완료
    const st = s2 ? (/완료|거래/.test(s2) ? 'done' : /^(x|×|n|아니|해제)/i.test(s2) ? 'hold' : 'on') : statusOf(g.status);
    if (st === 'other') return { skip: 'other' };
    if (st === 'dup') return { skip: 'dup' };
    // 주소
    let jb = clean(g.jibun), rest = '', more = [];
    const m = jb.match(/^(산\s?)?\d+(?:-\d+)?/);
    if (m) { rest = jb.slice(m[0].length); const mm = rest.match(/^\s*[\/,]\s*((?:산\s?)?\d+(?:-\d+)?(?:\s*[\/,]\s*(?:산\s?)?\d+(?:-\d+)?)*)\s*[\/,]?/); if (mm) { more = mm[1].split(/\s*[\/,]\s*/).filter(Boolean); rest = rest.slice(mm[0].length); } jb = m[0].replace(/\s/g, ''); }
    else if (jb) { rest = jb; jb = ''; }
    const qs = clean(g.addr).split(/\s+\/\s+/).filter(Boolean);   // 11/5 양식: 여러 필지는 ' / '로 (매물장 내려받기와 같은 모양)
    const addrFull = qs[0] || '';
    let q = '';
    if (g.sido || g.sgg || g.umd) q = [clean(g.sido), clean(g.sgg), clean(g.umd), jb].filter(Boolean).join(' ');
    else if (addrFull) { const a = addrFull.match(/^(.*?\d+(?:-\d+)?)(.*)$/); q = a ? a[1] : addrFull; if (a && !rest) rest = a[2]; }
    rest = rest.replace(/^[\s,\/]+/, '');
    const ud = (rest.match(/(\d{1,4}|[A-Za-z가-힣])\s*동(?![가-힣])/) || [])[1] || clean(g.udong).replace(/동$/, '');
    const hos = clean(g.ho).split(/\s*[,，、]\s*/).map(h => h.replace(/호$/, '').trim()).filter(Boolean);   // 11/5 여러 호수: '1608, 1609, 1610'
    const ho = (rest.match(/(\d{1,5})\s*호/) || [])[1] || hos[0] || '';
    const flm = rest.match(/(지하\s*)?(\d{1,3})\s*층/);
    const bname = (clean(g.bname) || rest.replace(/(\d{1,4}|[A-Za-z])\s*동(?![가-힣])|\d{1,5}\s*호|(지하\s*)?\d{1,3}\s*층|[()]/g, '').replace(/\s+/g, ' ').trim()).slice(0, 40);
    // 종류 · 거래
    let ty = typeOf(g.ptype) || (r._pt ? typeOf(r._pt) : null);   // 11/3 양식 탭의 기본 종류
    if (!ty) ty = g.jimok && !g.area && !g.tot ? { ptype: '토지' } : { ptype: MAIN_TY[mains[0]] || '기타', guessed: true };
    if (r._tab === '분양권') ty.pre = true;   // 11/5 양식 분양권 탭 (유형 = 아파트·오피스텔)
    let kind = ty.pre && !/월세|전세/.test(clean(g.kind)) ? 'presale' : kindOf(g.kind);
    const wonCol = c => /\(원\)|원\)$/.test(labels[map.indexOf(c)] || '') && !/만원/.test(labels[map.indexOf(c)] || '');
    const price = man(g.price, wonCol('price')), dep = man(g.deposit, wonCol('deposit')), rent = man(g.rent, wonCol('rent')), jeon = man(g.jeon);
    if (!kind) kind = rent ? 'wolse' : price ? 'sale' : dep || jeon ? 'jeonse' : 'sale';
    const money = {};
    if (kind === 'sale') { money.price = price; if (dep) money.curDep = dep; if (rent) money.curRent = rent; }
    else if (kind === 'jeonse') money.deposit = jeon || dep || price;
    else if (kind === 'wolse') { money.deposit = dep; money.rent = rent; }
    else { money.price = price; }
    if (g.cdep) money.curDep = man(g.cdep); if (g.crent) money.curRent = man(g.crent);
    if (g.pr) money.pr = man(g.pr);
    if (g.premium) money.premium = man(g.premium); if (g.mgmt) money.mgmt = man(g.mgmt); if (g.loan) money.loan = man(g.loan);
    if (r._rents && r._rents.length && kind === 'sale' && !money.curDep && !money.curRent) { const sd = r._rents.reduce((a, x) => a + (x.deposit || 0), 0), sr = r._rents.reduce((a, x) => a + (x.rent || 0), 0); if (sd) money.curDep = sd; if (sr) money.curRent = sr; }   // 층별 현황 합계 = 현 보증금·월세 (중개장부와 같게)
    // 면적
    const sq = (k) => g[k] != null && g[k] !== '' ? numOf(g[k]) : g[k + 'py'] != null && g[k + 'py'] !== '' ? (numOf(g[k + 'py']) || 0) * PY || null : null;
    const ex = sq('area'), site = sq('site'), tot = sq('tot');
    const land = ty.ptype === '토지', whole = ['건물', '공장·창고'].includes(ty.ptype) || (ty.ptype === '숙박' && !ho && !clean(g.fl)) || (ty.ptype === '주택' && !ho);   // 11/5 숙박도 층·호를 적으면 그 부분만
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
    if (g.rz) ad.rz = clean(g.rz).slice(0, 30); if (g.apv) ad.apv = man(g.apv); if (g.rgt) ad.rgt = man(g.rgt);
    // 11/5 양식 v2 칸 (중개장부 입력창과 같은 값으로)
    const fac = ty.ptype === '공장·창고', cv = k => clean(g[k]), intv = k => { const n = numOf(g[k]); return n != null ? Math.round(n) : (/^0$/.test(cv(k)) ? 0 : null); };
    if (/^없/.test(cv('mgmt'))) ad.nomgmt = true;
    if (cv('loanR')) { const v = cv('loanR').replace(/\s/g, ''); const lr = /안함|숨/.test(v) ? 'hide' : /없/.test(v) ? 'none' : /미만/.test(v) ? 'lt30' : /이상/.test(v) ? 'ge30' : ''; if (lr) ad.loanR = lr; }
    if (cv('live')) { const v = cv('live'), lv = /입주|자가|주인|본인/.test(v) ? 'owner' : /임차|세입|월세|전세|완/.test(v) ? 'tenant' : /공실|비어|빈/.test(v) ? 'empty' : '';
      if (fac) { if (lv) ad.occ = { owner: 'self', tenant: 'rent', empty: 'empty' }[lv]; } else if (lv) ad.live = lv; }
    else if (!fac && (g.cdep || g.crent)) ad.live = 'tenant';
    if (cv('rooms')) ad.rooms = intv('rooms'); if (cv('baths')) ad.baths = intv('baths'); if (cv('movein')) ad.movein = (dateOf(g.movein) || cv('movein')).slice(0, 20);
    if (cv('wc')) { const w = ['내부 전용', '내부 공용', '외부 공용', '외부 전용'].find(x => x.replace(/\s/g, '') === cv('wc').replace(/\s/g, '')); if (w) ad.wc = w; }
    if (cv('wcn')) ad.wcn = intv('wcn');
    if (cv('spy')) { const n = Math.round(numOf(g.spy) || 0); if (n > 3 && n < 300) ad.spy = n; }
    if (cv('road')) ad.road = cv('road').slice(0, 20);
    if (cv('strct')) ad.strct = cv('strct').slice(0, 30); ['pow', 'ch', 'hoist'].forEach(k => { if (cv(k)) { const n = numOf(g[k]); if (n) ad[k] = n; } });
    if (cv('trl')) ad.trl = /불가|안\s*됨|^x$|^n/i.test(cv('trl')) ? 'n' : 'y'; if (cv('facx')) ad.facx = cv('facx').slice(0, 80);
    if (cv('stage')) { const v = ['추진위', '조합설립', '사업시행', '관리처분', '이주·철거'].find(x => cv('stage').replace(/[\s·.]/g, '').startsWith(x.replace(/·/g, '').slice(0, 2))); if (v) ad.stage = v; }
    if (cv('form') && ['빌라', '단독', '상가', '아파트', '토지'].includes(cv('form'))) ad.form = cv('form');
    if (cv('jshare')) { const n = numOf(g.jshare); if (n) ad.jshare = n; } if (cv('msh')) ad.msh = cv('msh').slice(0, 20); if (cv('mvl')) ad.mvl = man(g.mvl);
    if (cv('down')) ad.down = man(g.down); if (cv('mid')) { const v = ['무이자', '이자후불', '자납'].find(x => cv('mid').replace(/\s/g, '').includes(x)); if (v) ad.mid = v; }
    if (cv('midTx')) ad.midTx = cv('midTx').slice(0, 12); ['due', 'resale'].forEach(k => { if (cv(k)) ad[k] = (typeof g[k] === 'number' ? dateOf(g[k]) : cv(k)).slice(0, 12); });
    // 연락처
    const contacts = [];
    const people = (names, phones, role) => {
      const nm = (names || []).map(x => clean(x.v)).join('\n'), ph = [...(phones || []).map(x => String(x.v)), nm].join('\n').match(PHONE) || [];
      const ns = nm.replace(PHONE, '').split(/[\n,·\/]+/).map(s => s.replace(/\(.*?\)|skt|kt|lg|u\+/gi, '').trim()).filter(Boolean);
      const n = Math.max(ns.length, ph.length);   // 11/5 이름이 하나에 번호가 여러 개면 번호마다 같은 이름 (예전: 이름이 둘 이상이어도 첫 사람만)
      for (let i = 0; i < n; i++) contacts.push({ role, name: (ns[i] || (ns.length === 1 ? ns[0] : '') || '').slice(0, 20), phone: ph[i] ? fmtPh(ph[i]) : '' });
    };
    people(multi.owner, multi.phone, '소유자');
    people(multi.tenant, multi.phone2, '임차인');
    // 11/5 그 외 연락처: '관리인 ○○○ 010-0000-0000, 대리인 ○○○ 010-1111-1111' → 관계·이름·번호
    (multi.others || []).forEach(x => clean(x.v).split(/\s*[,\n]\s*/).forEach(seg => {
      const ph = seg.match(PHONE) || []; let rest = seg.replace(PHONE, '').replace(/\s+/g, ' ').trim(); const m = rest.match(/^(소유자|임차인|관리인|대리인|기타)\s*/), role = m ? m[1] : '기타'; if (m) rest = rest.slice(m[0].length);
      if (rest || ph.length) (ph.length ? ph : ['']).forEach(p => contacts.push({ role, name: rest.slice(0, 20), phone: p ? fmtPh(p) : '' }));
    }));
    // 메모
    const lines = [];
    (multi.memo || []).forEach(x => { const v = clean(x.v); if (v) lines.push(/설명|메모|비고|내역|내용/.test(x.lb) ? v : `${clean(x.lb)}: ${v}`); });
    if (more.length) lines.push(`엑셀의 다른 필지: ${more.join(', ')}`);
    const other = /타/.test(clean(g.src));   // 11/5 받은 곳 = 타부동산 → 아파트·오피스텔은 단지 장부(타부동산)로
    if (g.opt) lines.push(`옵션: ${clean(g.opt).replace(/\n+/g, ' ')}`);
    if (g.office && !(other && APTT.includes(ty.ptype))) lines.push(`${other ? '받은 곳: 타부동산 · ' : ''}부동산명: ${clean(g.office)}`); else if (other && !APTT.includes(ty.ptype)) lines.push('받은 곳: 타부동산');
    if (clean(g.kind) && /상속/.test(clean(g.kind))) lines.push(`거래: ${clean(g.kind)}`);
    if (ty.ptype === '기타' && ty.tx) lines.push(`엑셀의 종류: ${ty.tx}`);
    // 등록일
    let at = g.date ? dateOf(g.date) : '';
    if (!at && g.year) { const y = +numOf(g.year), mo = +numOf(g.month) || 1, d = +numOf(g.day) || 1; if (y > 1990) at = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`; }
    const warn = [];
    if (more.length || qs.length > 1) warn.push('여러 필지');
    if (other && APTT.includes(ty.ptype) && (!ud || !ho)) warn.push('타부동산인데 동·호 없음 → 매물장으로');
    if (ty.guessed) warn.push('종류 짐작');
    if (!q) return { skip: 'noaddr', warn };
    const item = {
      kind, status: st, ptype: ty.ptype, ptypeTx: ty.tx || '', bname, ...money,
      contacts: contacts.slice(0, 10), rents: (r._rents || []).slice(0, 60), photos: [], ad, at, no: clean(g.no).slice(0, 20), exp: g.exp ? dateOf(g.exp) : '', imp: clean(g.imp).replace(/\n+/g, ' ').slice(0, 100),
      _q: q, _qs: qs.slice(1), _land: land, _whole: whole, _ex: { dong: ud, ho, hos: hos.length > 1 && !land ? hos : null, area, site },
      _other: other && APTT.includes(ty.ptype) && ud && ho && kind !== 'presale' ? { office: clean(g.office).slice(0, 30) } : null,
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
    if (it._land) Object.assign(P, { land: true, ak: 'land' }); else if (it._whole) Object.assign(P, { ak: 'tot', site: e.site || null }); else Object.assign(P, { ak: 'ex', ...(e.site ? { site: e.site } : {}) });
    return { P };
  }

  // 불러온 기록 (설정 → 엑셀에서 나중에도 되돌리기) — 기록이 안 남아도 불러오기는 그대로
  async function imLog(e) { try { const j = await H.api('/api/auth?action=xlog', H.post({ op: 'im', e: { file: S.file, ...e } })); S.logId = j.id; } catch { /* 무시 */ } }
  async function imDone() { if (!S.logId) return; try { await H.api('/api/auth?action=xlog', H.post({ op: 'imdone', id: S.logId })); } catch { /* 무시 */ } }
  // ---------- 11/5 리얼맵 매물 양식 v2 (종류별 탭 10개 + 층별 현황) — 빈 양식 · 매물장 내려받기 · 내 엑셀 바꿔 받기 모두 이 한 양식 ----------
  //   빈 양식 = 사이트의 realmap-form.xlsx 그대로 (칸 제목 설명 메모 · 고르기 목록 · 빨간 제목 = 꼭 넣을 칸)
  //   내려받기 = 같은 파일의 각 탭에 줄만 더해서 (모양·설명·목록 그대로) → 고쳐서 다시 올려도 칸 맞추기 없이 들어감
  //   불러오기 = 숨은 탭(_realmap)이 있으면 탭 이름으로 종류, 칸 제목으로 넣을 곳 · 예전(11/3 v1) 양식 파일도 그대로 읽음
  const TPL_MARK = '_realmap', EXM = '예시라 지우고 쓰세요', FORM_URL = '/realmap-form.xlsx', RENT_TAB = '층별 현황';
  const K2 = { 매물: 'st2', 매물번호: 'no', 주소: 'addr', 단지명: 'bname', 물건명: 'bname', 유형: 'ptype', 동: 'udong', 호: 'ho', 층: 'fl', '전용면적(㎡)': 'area', 평형: 'spy', 타입: 'ty',
    향: 'dir', 방향: 'dir', '방향(출입구)': 'dir', '받은 곳': 'src', 부동산명: 'office', 거래: 'kind', '매매가(만원)': 'price', '전세가(만원)': 'jeon', '보증금(만원)': 'deposit', '월세(만원)': 'rent',
    '권리금(만원)': 'premium', '관리비(만원)': 'mgmt', '융자(만원)': 'loan', '융자 표시': 'loanR', 업종: 'biz', '챙길 것': 'imp', 현상태: 'live', '현 보증금(만원)': 'cdep', '현 월세(만원)': 'crent',
    만기일: 'exp', '방 수': 'rooms', '욕실 수': 'baths', '입주 가능일': 'movein', 옵션: 'opt', 화장실: 'wc', '화장실 수': 'wcn', '대지면적(㎡)': 'site', '연면적(㎡)': 'tot', '토지면적(㎡)': 'site',
    지목: 'jimok', '도로 접면': 'road', 건축구조: 'strct', '사용전력(kW)': 'pow', '층고(m)': 'ch', '호이스트(톤)': 'hoist', 추레라: 'trl', '기타 시설': 'facx', 구역명: 'rz', 단계: 'stage',
    '물건 형태': 'form', '대지지분(㎡)': 'jshare', '감정가(만원)': 'apv', '권리가액(만원)': 'rgt', '조합원 분양': 'msh', '이주비(만원)': 'mvl', '분양가(만원)': 'price', '프리미엄(만원)': 'pr',
    '계약금(만원)': 'down', 중도금: 'mid', '중도금 메모': 'midTx', '입주 예정': 'due', '전매 가능일': 'resale', 소유자: 'owner', '소유자 연락처': 'phone', 임차인: 'tenant', '임차인 연락처': 'phone2',
    '그 외 연락처': 'others', 메모: 'memo', 호실: 'rho', '임차인·업종': 'rlabel', 공실: 'vac', '확인할 점': 'chk', 등록일: 'date',   // 등록일: 내려받은 파일 맨 끝 칸 (다시 올리면 그 날짜로)
    // 예전(v1) 양식의 칸 이름
    종류: 'ptype', 건물명: 'bname', '현재 업종': 'biz', '규모(지상/지하)': 'floors', 사용승인일: 'appr', 용도지역: 'zone', '건축물 용도': 'use', 주차: 'park', 승강기: 'elev', 연락처: 'phone', 상태: 'status' };
  const TABPT = { '아파트·오피': '아파트', '상가·사무실': '상가', 지식산업센터: '지식산업센터', '빌라·주택': '빌라', 건물: '건물', 토지: '토지', '공장·창고': '공장·창고', '숙박·기타': '숙박', '재개발·재건축': '재개발', 분양권: '아파트 분양권' };
  const TKEYS = [...new Set(Object.values(K2))].filter(k => !['chk', 'rho', 'rlabel', 'vac'].includes(k));
  const lbK = h => K2[clean(h).replace(/\*$/, '').trim()] || null;
  const KN = { sale: '매매', jeonse: '전세', wolse: '월세', presale: '' };
  const TABOF = { 아파트: '아파트·오피', 주상복합: '아파트·오피', 오피스텔: '아파트·오피', 상가: '상가·사무실', 사무실: '상가·사무실', 지식산업센터: '지식산업센터', 빌라: '빌라·주택', 연립: '빌라·주택', 다가구: '빌라·주택', 주택: '빌라·주택',
    건물: '건물', 토지: '토지', '공장·창고': '공장·창고', 숙박: '숙박·기타', 기타: '숙박·기타', 재개발: '재개발·재건축', 재건축: '재개발·재건축' };
  const tabOfS = x => x.kind === 'presale' ? '분양권' : TABOF[x.ptype] || '숙박·기타';
  const LIVEN = { owner: '입주', tenant: '임차', empty: '공실' }, OCCN = { self: '입주', rent: '임차', empty: '공실' }, LRN = { hide: '표시 안 함', none: '없음', lt30: '시세 30% 미만', ge30: '시세 30% 이상' };
  const r2 = v => v ? Math.round(+v * 100) / 100 : '';
  const CURT = new Set(['아파트·오피', '상가·사무실', '지식산업센터', '빌라·주택', '재개발·재건축']);   // '현 보증금·현 월세' 칸이 있는 탭 (없는 탭의 매매는 보증금·월세 칸 = 지금 임대 합계)
  const uq = a => [...new Set(a.filter(Boolean))];
  const ymd = v => { if (!v) return ''; const d = new Date(v); return isNaN(d) ? '' : new Date(d.getTime() + 9 * 3600e3).toISOString().slice(0, 10); };
  const EXTRA = { chk: '확인할 점', date: '등록일', up: '수정일', ph: '사진 수' };
  // 매물(저장된 모양) → 양식 한 줄 {칸 key: 값} + 층별 현황 줄
  function rowOf(x) {
    const a = x.ad || {}, tab = tabOfS(x), pl = Array.isArray(x.places) && x.places.length ? x.places : [{ addr: x.addr, dong: x.dong, ho: x.ho, area: x.area }];
    const land = tab === '토지', whole = ['건물', '공장·창고'].includes(tab) || (pl[0] && pl[0].ak === 'tot'), fac = tab === '공장·창고';
    const cs = Array.isArray(x.contacts) ? x.contacts : x.owner || x.phone ? [{ role: '소유자', name: x.owner, phone: x.phone }] : [];
    const isO = c => /소유|집주인|매도|임대인/.test(c.role || '') || !c.role, isT = c => /임차|세입/.test(c.role || '');
    const nm = L => { const n = L.map(c => c.name || ''); return (uq(n).length === 1 && n.length > 1 ? [n[0]] : n.filter(Boolean)).join(', '); };
    const os = cs.filter(isO), ts = cs.filter(c => !isO(c) && isT(c)), etc = cs.filter(c => !isO(c) && !isT(c));
    const addrs = uq(pl.map(p => p.addr)), site = pl.reduce((s, p) => s + (p.site || 0), 0);
    const v = {
      st2: { on: 'O', hold: 'X', done: '완료' }[x.status] || 'O', no: x.no, addr: addrs.join(' / '), bname: x.bname, ptype: x.ptype === '기타' && x.ptypeTx ? x.ptypeTx : x.ptype,
      udong: uq(pl.map(p => p.dong)).join(', '), ho: addrs.length > 1 ? '' : uq(pl.map(p => p.ho)).join(', '), fl: a.fl === '전체' ? '' : a.fl,
      area: land || whole ? '' : r2(x.area), site: land ? r2(x.area) : r2(site), tot: whole || tab === '숙박·기타' ? r2(x.area) : '',
      spy: a.spy, ty: a.ty, dir: a.dir, src: tab === '아파트·오피' ? '내 매물' : '', kind: KN[x.kind] || '',
      price: x.price, jeon: x.kind === 'jeonse' ? x.deposit : '', deposit: x.kind === 'jeonse' ? '' : x.kind === 'sale' && !CURT.has(tab) ? x.curDep : x.deposit, rent: x.kind === 'sale' && !CURT.has(tab) ? x.curRent : x.rent, premium: x.premium, mgmt: a.nomgmt ? '없음' : x.mgmt, loan: x.loan, loanR: LRN[a.loanR] || '',
      biz: a.biz, imp: x.imp, live: fac ? OCCN[a.occ] || '' : LIVEN[a.live] || '', cdep: x.curDep, crent: x.curRent, exp: x.exp, rooms: a.rooms, baths: a.baths, movein: a.movein,
      wc: a.wc, wcn: a.wcn, jimok: land ? a.use : '', road: a.road, strct: a.strct, pow: a.pow, ch: a.ch, hoist: a.hoist, trl: { y: '진입 가능', n: '불가' }[a.trl] || '', facx: a.facx,
      rz: a.rz, stage: a.stage, form: a.form, jshare: a.jshare, apv: a.apv, rgt: a.rgt, msh: a.msh, mvl: a.mvl, pr: x.pr, down: a.down, mid: a.mid, midTx: a.midTx, due: a.due, resale: a.resale,
      owner: nm(os), phone: os.map(c => c.phone).filter(Boolean).join(', '), tenant: nm(ts), phone2: ts.map(c => c.phone).filter(Boolean).join(', '),
      others: etc.map(c => [c.role || '기타', c.name, c.phone].filter(Boolean).join(' ')).join(', '), memo: x.memo, chk: x._chk || '',
      date: ymd(x.at), up: ymd(x.up), ph: (x.photos || []).length || '',   // 내려받기 맨 끝 칸 (양식에는 없는 칸)
      // 예전 양식 칸 (v1 파일 바꿔 받기용)
      floors: a.tfl ? `${a.tfl}${a.ufl ? '/' + a.ufl : ''}` : '', appr: a.appr, zone: a.zone, use: land ? '' : a.use, park: a.park, elev: a.elev,
    };
    const rents = (x.rents || []).filter(r => r.label || r.deposit || r.rent || r.exp).map(r => {
      const lb = String(r.label || ''), m = lb.match(/^(\S+)호\s*/), vac = /공실/.test(lb);
      return { no: x.no, addr: addrs[0] || '', fl: r.fl, rho: m ? m[1] : '', rlabel: (m ? lb.slice(m[0].length) : lb).replace(/공실/, '').trim(), deposit: r.deposit, rent: r.rent, exp: r.exp, vac: vac ? 'O' : '' };
    });
    return { tab, v, rents };
  }
  // 불러오기 중 읽은 매물(_q·_ex 모양) → 저장된 모양으로 바꿔서 rowOf에 (내 엑셀 → 양식 바꿔 받기)
  const asStored = x => { const it = x.item, e = it._ex || {}; return { ...it, memo: it._memo, _chk: (x.warn || []).join(' · '),
    places: [{ addr: it._q, dong: e.dong, ho: (e.hos || [e.ho]).filter(Boolean).join(', '), area: e.area, site: e.site, ak: it._land ? 'land' : it._whole ? 'tot' : 'ex' }, ...(it._qs || []).map(q => ({ addr: q }))], area: e.area }; };
  function loadZip() {
    if (window.JSZip) return Promise.resolve();
    return new Promise((ok, no) => { const s = document.createElement('script'); s.src = 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js'; s.onload = ok; s.onerror = () => no(new Error('엑셀 만들기 도구를 불러오지 못했습니다. 잠시 뒤 다시 시도해 주세요.')); document.head.appendChild(s); });
  }
  const save = (blob, name) => { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000); };
  const colL = i => { let s = ''; for (let n = i + 1; n; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + (n - 1) % 26) + s; return s; };
  const xe = s => String(s).replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const cellX = (ref, v) => typeof v === 'number' && isFinite(v) ? `<c r="${ref}"><v>${v}</v></c>` : `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xe(String(v).slice(0, 32000))}</t></is></c>`;
  // 빈 양식 파일에 줄 더하기: byTab = { 탭 이름: [{칸 key: 값}] } · extra = 종류별 탭 맨 끝에 더할 칸 (확인할 점 · 등록일 · 수정일 · 사진 수)
  async function formFill(byTab, fname, extra) {
    await Promise.all([loadLib(), loadZip()]);
    const r = await fetch(FORM_URL, { cache: 'no-cache' }); if (!r.ok) throw new Error('양식 파일을 받지 못했습니다. 잠시 뒤 다시 시도해 주세요.');
    const buf = await r.arrayBuffer(), wb = XLSX.read(buf, { type: 'array', sheetRows: 1 }), zip = await JSZip.loadAsync(buf);
    const wbx = await zip.file('xl/workbook.xml').async('string'), rels = await zip.file('xl/_rels/workbook.xml.rels').async('string');
    const tgt = {}; for (const m of rels.matchAll(/<Relationship\b[^>]*>/g)) { const id = (m[0].match(/\bId="([^"]+)"/) || [])[1], t = (m[0].match(/\bTarget="([^"]+)"/) || [])[1]; if (id && t) tgt[id] = t.replace(/^\/?xl\//, '').replace(/^\//, ''); }
    for (const m of wbx.matchAll(/<sheet\b[^>]*>/g)) {
      const name = ((m[0].match(/\bname="([^"]+)"/) || [])[1] || '').replace(/&amp;/g, '&'), rid = (m[0].match(/\br:id="([^"]+)"/) || [])[1];
      const rows = byTab[name]; if (!rows || !rows.length || !tgt[rid]) continue;
      const path = 'xl/' + tgt[rid], heads = (XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: '' })[0] || []).map(lbK);
      const ex = name === RENT_TAB ? [] : extra || [], n0 = heads.length; heads.push(...ex);
      let xml = await zip.file(path).async('string');
      const body = rows.map((v, i) => `<row r="${i + 3}">${heads.map((k, c) => { const val = k ? v[k] : ''; return val === '' || val == null ? '' : cellX(colL(c) + (i + 3), val); }).join('')}</row>`).join('');
      const hc = ex.map((k, i) => `<c r="${colL(n0 + i)}1" t="inlineStr"><is><t>${EXTRA[k]}</t></is></c>`).join('');
      if (hc) xml = xml.replace(/(<row r="1"[^>]*>[\s\S]*?)(<\/row>)/, `$1${hc}$2`);
      xml = xml.replace(/<dimension ref="[^"]*"\/>/, `<dimension ref="A1:${colL(heads.length - 1)}${rows.length + 2}"/>`).replace('</sheetData>', body + '</sheetData>');
      zip.file(path, xml);
    }
    save(await zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', compression: 'DEFLATE' }), fname);
  }
  const byTabOf = list => { const by = {}; for (const x of list) { const o = rowOf(x); (by[o.tab] || (by[o.tab] = [])).push(o.v); if (o.rents.length) (by[RENT_TAB] || (by[RENT_TAB] = [])).push(...o.rents); } return by; };
  // 빈 양식 받기 (설정 · 불러오기 화면)
  function form() { const a = document.createElement('a'); a.href = FORM_URL; a.download = '리얼맵_매물양식.xlsx'; document.body.appendChild(a); a.click(); a.remove(); }
  // 매물장 내려받기 (전체 · 고른 매물) — 양식과 같은 파일
  async function exportLs(list) { await formFill(byTabOf(list), `리얼맵_매물장_${new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10)}.xlsx`, ['date', 'up', 'ph']); }
  // 내 엑셀 → 리얼맵 양식으로 바꿔 받기 (불러오기 2단계 · 확인할 점 칸 포함)
  async function tplOut(all) {
    await formFill(byTabOf(all.map(asStored)), `리얼맵양식_${String(S.file || '내엑셀').replace(/\.(xlsx?|csv)$/i, '')}.xlsx`, ['chk']);
    H.toast('리얼맵 양식으로 바꾼 파일을 받았습니다. 틀린 칸만 고친 뒤 다시 올려 주세요', 5000);
  }
  // 양식 파일 → 칸 맞추기 없이 (탭 이름 = 기본 종류) · 층별 현황 탭은 매물번호(없으면 주소)가 같은 줄에 붙임
  function tplPrep(wb) {
    const keys = TKEYS, labels = keys.map(k => ALLT[k] || k), data = [], ki = k => keys.indexOf(k);
    for (const n of wb.SheetNames) {
      if (!TABPT[n]) continue;
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: '' }); if (!rows.length) continue;
      const hk = rows[0].map(lbK);
      rows.slice(1).forEach((r, j) => {
        if (!r.some(c => clean(c)) || r.some(c => String(c).includes(EXM))) return;
        const out = keys.map(() => ''); hk.forEach((k, c) => { const i = ki(k); if (i >= 0 && out[i] === '') out[i] = r[c]; });
        if (!keys.some((k, i) => !['no', 'status', 'st2', 'src'].includes(k) && clean(out[i]))) return;
        out._n = `${n} ${j + 2}줄`; out._pt = TABPT[n]; out._tab = n; data.push(out);
      });
    }
    const miss = [], ws = wb.Sheets[RENT_TAB];
    if (ws) {
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' }), hk = (rows[0] || []).map(lbK), an = s => clean(s).replace(/\s/g, '');
      rows.slice(1).forEach((r, j) => {
        const g = {}; hk.forEach((k, c) => { if (k && clean(r[c]) && g[k] == null) g[k] = r[c]; });
        if (!Object.keys(g).some(k => !['no', 'addr'].includes(k)) || (j === 0 && /○○/.test(clean(g.addr)))) return;   // 빈 줄 · 예시 줄
        const no = clean(g.no), d = (no && data.find(x => clean(x[ki('no')]) === no)) || (!no && g.addr && data.find(x => an(x[ki('addr')]) === an(g.addr)));
        const row = Object.assign([clean(g.fl), clean(g.rlabel)], { _n: `${RENT_TAB} ${j + 2}줄` });
        if (!d) return miss.push({ i: 1e6 + j, r: row, err: '층별 현황: 매물번호·주소가 같은 매물이 없음' });
        let fl = clean(g.fl).replace(/\s/g, '').replace(/^지하/, 'B').replace(/층$/, ''); if (/^\d+$/.test(fl)) fl += 'F';
        const vac = /^(o|○|●|y|예|공실)$/i.test(clean(g.vac));
        const label = [clean(g.rho) && clean(g.rho).replace(/호$/, '') + '호', clean(g.rlabel), vac && '공실'].filter(Boolean).join(' ').slice(0, 30);
        (d._rents || (d._rents = [])).push({ fl: fl.slice(0, 8), use: '', area: null, label, deposit: man(g.deposit), rent: man(g.rent), exp: g.exp ? dateOf(g.exp) || clean(g.exp).slice(0, 10) : '', memo: '' });
      });
    }
    if (!data.length) return step1('양식에 넣은 매물이 없습니다. 각 탭의 예시 줄 아래에 매물을 넣어 주세요.');
    Object.assign(S, { labels, data, map: keys.slice(), sig: 'tpl', sheet: '리얼맵 양식', tpl: true, rentMiss: miss });
    step2();
  }

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
      <div class="xi-tpl" style="display:flex;align-items:center;gap:10px;background:#E8F5EC;border:2px solid #2B8A3E;border-radius:12px;padding:10px 14px;margin:10px 0;font-size:14px"><span style="flex:1"><b style="color:#1F7A3A">처음이세요?</b> 리얼맵 양식(종류별 탭)에 맞춰 넣으면 칸 맞추기 없이 그대로 들어갑니다 <small style="color:#868E96">· 칸 제목에 마우스를 올리면 설명이 나옵니다</small></span><button type="button" class="xi-b" id="xiTpl" style="background:#2B8A3E;color:#fff;border-color:#2B8A3E;white-space:nowrap">양식 받기 ⬇</button></div>
      ${err ? `<p class="xi-err">${esc(err)}</p>` : ''}${html || ''}
      <p class="xi-m">파일은 이 브라우저 안에서만 읽고 서버에 올리지 않습니다. 서버에는 매물로 바뀐 내용만 저장됩니다.</p></div>`);
    el.querySelectorAll('[data-m]').forEach(b => b.onclick = () => { const k = b.dataset.m; S.mains = S.mains.includes(k) ? S.mains.filter(x => x !== k) : [...S.mains, k].slice(-3); keepMain(S.mains); step1(); });
    const pick = async f => { if (!f) return; S.file = f.name; shell('<div class="xi-bd"><p class="xi-m">파일을 읽는 중…</p></div>'); try { const sh = await readFile(f); prep(sh); } catch (e) { S.file = ''; step1(e.message || '파일을 읽지 못했습니다.'); } };
    $('xiF').onchange = e => pick(e.target.files[0]);
    if ($('xiTpl')) $('xiTpl').onclick = () => { form(); H.toast('양식을 받았습니다. 종류별 탭에 채운 뒤 이 창에서 올려 주세요', 4500); };
    const d = $('xiDrop'); d.ondragover = e => { e.preventDefault(); d.classList.add('ov'); }; d.ondragleave = () => d.classList.remove('ov'); d.ondrop = e => { e.preventDefault(); d.classList.remove('ov'); pick(e.dataTransfer.files[0]); };
  }
  function prep(sh) {
    S.tpl = false;
    if (sh.tpl) return tplPrep(sh.wb);
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
    const out = { ok: [], warn: [], skip: { empty: 0, other: 0, dup: 0, noaddr: 0, have: 0 }, rows: [...(S.rentMiss || [])] };
    const nos = new Set(H.items().map(x => x.no).filter(Boolean));   // 11/5 매물장에 이미 있는 매물번호 = 내려받은 파일을 다시 올린 줄 → 겹치지 않게 건너뜀
    S.data.forEach((r, i) => {
      const x = rowItem(r, S.map, S.labels, S.mains);
      if (x.skip) { out.skip[x.skip]++; if (x.skip === 'noaddr') out.rows.push({ i, r, err: '주소 칸이 비어 있음' }); return; }
      if (x.item.no && nos.has(x.item.no)) { out.skip.have++; return; }
      x.item._row = i; (x.warn.length ? out.warn : out.ok).push(x);
    });
    return out;
  }
  function step2() {
    S.step = 1;
    const C = convert(); S.conv = C;
    const all = [...C.ok, ...C.warn], skipN = C.skip.empty + C.skip.other + C.skip.dup + C.skip.noaddr + C.skip.have, othN = all.filter(x => x.item._other).length;
    const room = Math.max(0, (H.plan().ls || 0) - H.items().length);
    const go = [...all.filter(x => !x.item._other).slice(0, room), ...all.filter(x => x.item._other)];   // 타부동산(단지 장부)은 매물장 한도와 상관없음
    const sample = all.slice(0, 6);
    const pr = x => { const it = x.item; return it.kind === 'wolse' ? `${it.deposit || 0}/${it.rent || '-'}` : (it.price || it.deposit || '-').toLocaleString(); };
    const opts = cur => Object.entries(ALLT).map(([k, t]) => `<option value="${k}" ${k === cur ? 'selected' : ''}>${esc(t)}</option>`).join('');
    const ex = c => { for (const r of S.data.slice(0, 30)) { const v = clean(r[c]); if (v) return v.slice(0, 26); } return ''; };
    const el = shell(`<div class="xi-bd">
      <div class="xi-sum"><div class="t"><b>${S.data.length}</b>엑셀 줄</div><div class="g"><b>${C.ok.length}</b>바로 등록</div><div class="y"><b>${C.warn.length}</b>확인 필요<small>노랑 표시로 넣음</small></div><div class="n"><b>${skipN}</b>건너뜀</div></div>
      <p class="xi-m">건너뜀 = 빈 줄 ${C.skip.empty} · 타거래 ${C.skip.other} · 중복 ${C.skip.dup} · 주소 없음 ${C.skip.noaddr}${C.skip.have ? ` · <b>이미 매물장에 있는 매물번호 ${C.skip.have}</b>` : ''}${(S.rentMiss || []).length ? ` · 층별 현황 짝 없음 ${S.rentMiss.length}줄` : ''}${othN ? `<br>아파트·오피 <b>타부동산 ${othN}줄</b>은 매물장이 아니라 [아파트] 단지 장부의 그 호에 타부동산 물건으로 넣습니다` : ''}${all.length - othN > room ? ` · <b class="xi-r">요금제 한도로 ${room.toLocaleString()}건까지만 넣을 수 있습니다</b>` : ''}</p>
      ${sample.length ? `<table class="xi-t"><tr><th>엑셀 줄</th><th>종류</th><th>주소</th><th>거래</th><th>가격</th><th>면적</th><th></th></tr>${sample.map(x => `<tr><td>${S.data[x.item._row]._n}</td><td>${esc(x.item.ptype)}</td><td>${esc(x.item._q)}${x.item._ex.dong || x.item._ex.ho ? ` · ${esc([x.item._ex.dong && x.item._ex.dong + '동', x.item._ex.ho && x.item._ex.ho + '호' + (x.item._ex.hos ? ` 외 ${x.item._ex.hos.length - 1}` : '')].filter(Boolean).join(' '))}` : ''}</td><td>${H.X.KIND[x.item.kind]}</td><td>${esc(pr(x))}</td><td>${x.item._ex.area ? (x.item._ex.area / PY).toFixed(1) + '평' : '-'}</td><td>${x.warn.length ? `<span class="tg y">${esc(x.warn.join(' · '))}</span>` : '<span class="tg g">OK</span>'}</td></tr>`).join('')}</table>` : ''}
      <details class="xi-map" ${S.openMap ? 'open' : ''}><summary>칸 맞추기 보기 · 고치기 <small>(${S.labels.filter(Boolean).length}칸 · 틀린 것만 바꾸면 숫자가 바로 바뀝니다)</small></summary>
        <table class="xi-t"><tr><th>엑셀 칸</th><th>예시 값</th><th>넣을 곳</th></tr>${S.labels.map((lb, c) => lb ? `<tr><td>${esc(lb)}</td><td class="ex">${esc(ex(c))}</td><td><select data-c="${c}" class="${S.map[c] === 'skip' ? 'no' : ''}">${opts(S.map[c])}</select></td></tr>` : '').join('')}</table></details>
      </div>
      <div class="xi-f"><span>칸 맞춤은 이 브라우저에 기억해서 같은 양식은 다음부터 그대로 씁니다</span><button type="button" class="xi-b" id="xiBack">‹ 다른 파일</button>${H.op && !S.tpl && all.length ? '<button type="button" class="xi-b" id="xiTo" style="border-color:#2B8A3E;color:#1F7A3A;white-space:nowrap">⬇ 양식으로 받아 고치기</button>' : ''}<button type="button" class="xi-b go" id="xiGo" ${go.length ? '' : 'disabled'}>${go.length.toLocaleString()}건 불러오기</button></div>`);
    el.querySelectorAll('select[data-c]').forEach(s => s.onchange = () => { S.map[+s.dataset.c] = s.value; S.openMap = true; keepMap(S.sig, S.map); step2(); });
    el.querySelector('details').ontoggle = e => { S.openMap = e.target.open; };
    $('xiBack').onclick = () => { S.file = ''; step1(); };
    if ($('xiTo')) $('xiTo').onclick = async () => { keepMap(S.sig, S.map); try { await tplOut(all); } catch (e) { H.toast(e.message || '파일을 만들지 못했습니다'); } };
    $('xiGo').onclick = () => { if (!S.tpl) keepMap(S.sig, S.map); run(go); };
  }
  async function run(list) {
    S.step = 2; S.busy = true; S.stop = false; S.ib = 'x' + Date.now().toString(36);
    const done = [], fail = [...S.conv.rows], ready = [], aptP = new Map(), others = [];   // aptP: 아파트·오피스텔 필지 → 끝나고 단지 장부에 자동으로 담음 (10/28) · others: 타부동산 → 단지 장부 (11/5)
    S.made = [];
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
          const pls = await placesOf(it, L.P, x.warn);
          const imp = [it.imp, x.warn.length && `엑셀 확인: ${x.warn.join(' · ')}`].filter(Boolean).join(' · ').slice(0, 100);
          const send = { ...it, places: pls, memo, imp, ...(x.warn.length ? { mk: 'y' } : {}) };
          Object.keys(send).forEach(kk => { if (kk.startsWith('_')) delete send[kk]; });
          send._row = it._row; done.push(it._row);
          if (it._other) others.push({ it, P: L.P, o: it._other, x, memo }); else ready.push(send);
          if (APTT.includes(it.ptype) && it.kind !== 'presale') { const g = aptP.get(L.P.pnu) || { pnu: L.P.pnu, addr: L.P.addr, lat: L.P.lat, lng: L.P.lng, name: it.bname || '', rows: [] }; g.rows.push(it._row); aptP.set(L.P.pnu, g); }
        }
        if ((done.length + fail.length) % 5 === 0) draw();
        if (ready.length >= 150) await flush(false);
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    await flush(true);
    if (S.saved || others.length) await autoCx(aptP, fail);
    if (others.length) await ldOthers(others, fail);
    S.busy = false;
    if (S.made.length) await imLog({ to: 'hj', n: S.made.length, made: S.made, newCx: [], names: '타부동산 (매물 양식)' });
    if (S.saved) await imLog({ to: 'ls', n: S.saved, ib: S.ib });
    result(fail.sort((a, b) => a.i - b.i));
  }
  function result(fail) {
    S.step = 2;
    const el = shell(`<div class="xi-bd"><div class="xi-sum"><div class="g"><b>${S.saved || 0}</b>등록됨</div>${S.made.length ? `<div class="t"><b>${S.made.length}</b>단지 장부(타부동산)</div>` : ''}<div class="y"><b>${fail.length}</b>못 넣음</div></div>
      <p class="xi-m">확인이 필요한 줄은 <b>노랑 표시</b>와 '꼭 챙길 것'에 '엑셀 확인'을 적어 두었습니다. 줄을 눌러 입력창에서 고치시면 됩니다.</p>
      ${(S.cxAdd || []).length ? `<p class="xi-m">아파트·오피스텔 단지 <b>${S.cxAdd.length}곳</b>을 [아파트·오피] 단지 목록에 자동으로 담았습니다: ${esc(S.cxAdd.map(c => c.name).join(', '))}</p>` : ''}${(S.cxFull || []).length ? `<p class="xi-m xi-r">단지 한도가 차서 ${esc(S.cxFull.join(', '))} 단지는 담지 못했습니다. 이 매물들은 '단지 밖' 목록에 있습니다.</p>` : ''}
      ${fail.length ? `<h3>못 넣은 줄</h3><table class="xi-t"><tr><th>엑셀 줄</th><th>내용</th><th>이유</th></tr>${fail.slice(0, 50).map(f => `<tr><td>${(f.r && f.r._n) || f.i + 1}</td><td class="ex">${esc((f.r || []).map(clean).filter(Boolean).slice(0, 6).join(' · ').slice(0, 80))}</td><td>${esc(f.err)}</td></tr>`).join('')}</table>${fail.length > 50 ? `<p class="xi-m">외 ${fail.length - 50}줄 — 엑셀로 받아서 보세요</p>` : ''}` : ''}</div>
      <div class="xi-f">${S.saved || S.made.length ? `<button type="button" class="xi-b red" id="xiUndo">이번에 불러온 ${(S.saved || 0) + S.made.length}건 모두 되돌리기</button>` : '<span></span>'}${fail.length ? '<button type="button" class="xi-b" id="xiFail">못 넣은 줄 엑셀로 받기</button>' : ''}<button type="button" class="xi-b go" id="xiDone">닫고 매물장 보기</button></div>`);
    $('xiDone').onclick = close;
    if ($('xiFail')) $('xiFail').onclick = () => {
      const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
      const lines = [['엑셀 줄', '이유', ...S.labels].map(q).join(','), ...fail.map(f => [(f.r && f.r._n) || f.i + 1, f.err, ...(f.r || [])].map(q).join(','))];
      const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' })); a.download = '불러오지_못한_줄.csv'; document.body.appendChild(a); a.click(); a.remove();
    };
    if ($('xiUndo')) $('xiUndo').onclick = async () => {
      if (!confirm(`이번에 불러온 ${(S.saved || 0) + S.made.length}건을 모두 지울까요? (불러온 뒤 고친 내용도 함께 지워집니다)`)) return;
      try { for (const [id, key] of S.made) { try { await H.api('/api/auth?action=hj', H.post({ id, key, op: 'wipe' })); S.cxDirty = true; } catch { /* 다음 */ } }   // 11/5 타부동산으로 넣은 호
        const j = S.saved ? await H.api('/api/auth?action=listing', H.post({ op: 'unimport', ib: S.ib })) : { unimported: 0 }; if (S.saved) { H.took(j); S.dirty = true; } for (const c of S.cxAdd || []) { try { await H.api('/api/auth?action=cx', H.post({ op: 'del', id: c.id })); S.cxDirty = true; } catch { /* 단지는 남음 */ } } await imDone(); H.toast(`${(j.unimported || 0) + S.made.length}건을 되돌렸습니다`); S.saved = 0; S.made = []; close(); }
      catch (e) { H.toast(e.message || '되돌리지 못했습니다'); }
    };
  }

  // 11/5 한 줄 → 주소 여러 개: 여러 호수(같은 건물) · ' / '로 적은 다른 필지 · 전용면적이 비었으면 건축물대장에서 호마다 (중개장부 입력창과 같은 방법)
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  let UQ = Promise.resolve(), UN = 0;
  const unitArea = P => (UQ = UQ.catch(() => null).then(async () => {   // 한 번에 하나씩 (공공데이터 초당 제한) · 한 번 불러오기에 최대 150호
    if (++UN > 150 || !P.pnu || !P.ho) return null;
    const d0 = String(P.dong || '').trim(), h0 = String(P.ho || '').trim().replace(/호$/, '');
    const dongs = [...new Set([d0, d0.replace(/동$/, ''), d0 && !/동$/.test(d0) ? d0 + '동' : d0])];
    const tries = [[dongs[0], h0], ...dongs.slice(1).map(d => [d, h0]), [dongs[0], h0 + '호']].slice(0, 3);
    for (const [dq, h] of tries) for (let t = 0; t < 2; t++) {
      try {
        const j = await H.api(`/api/units?pnu=${P.pnu}&dong=${encodeURIComponent(dq)}&ho=${encodeURIComponent(h)}${t ? '&r=' + Date.now() % 1000 : ''}`);
        if (j.area && j.area.ok === false) { await sleep(1500); continue; }
        const sum = ((j.area && j.area.data) || []).filter(r => /전유/.test(r.gb || '')).reduce((a, r) => a + (r.area || 0), 0);
        if (sum) return Math.round(sum * 100) / 100;
        break;
      } catch { await sleep(1500); }
    }
    return null;
  }));
  async function placesOf(it, P, warn) {
    const e = it._ex || {};
    let pls = e.hos ? e.hos.map(h => ({ ...P, ho: h, area: null })) : [P];
    if (!it._land && !it._whole && pls.some(p => p.ho && !p.area)) {
      for (const p of pls) if (p.ho && !p.area) p.area = await unitArea(p);
      if (e.hos && e.area && pls.every(p => !p.area)) pls[0].area = e.area;   // 호마다 못 찾았으면 적은 면적을 첫 호에
      if (!pls.some(p => p.area) && !e.area) warn.push('전용면적 없음');
    }
    for (const q of it._qs || []) {   // 다른 필지
      const g = await geocode(q); let p = null; if (g) { try { p = await H.api(`/api/parcel?lat=${g.lat}&lng=${g.lng}`); } catch { p = null; } }
      const pnu = p && (it._land ? p.pnu : (p.bldPnu || p.pnu));
      if (!pnu) { warn.push(`다른 필지 못 찾음: ${q}`.slice(0, 40)); continue; }
      pls.push({ pnu, addr: p.addr || g.t, lat: g.lat, lng: g.lng, bname: '', dong: '', ho: '', area: null, ...(it._land ? { land: true, ak: 'land' } : { ak: P.ak }) });
    }
    return pls.slice(0, 30);
  }
  // 11/5 아파트·오피 탭에서 받은 곳 = 타부동산 → 매물장이 아니라 [아파트] 단지 장부의 그 호 (아파트 장부 파일과 같은 곳)
  async function ldOthers(list, fail) {
    shell('<div class="xi-bd"><p class="xi-m">타부동산 물건을 아파트 단지 장부에 넣는 중…</p></div>');
    let cxs = []; try { cxs = (await H.api('/api/auth?action=cx')).items || []; } catch { list.forEach(o => fail.push({ i: o.it._row, r: S.data[o.it._row], err: '단지 장부를 불러오지 못함' })); return; }
    const DG = new Map(), UNT = new Map(), bulk = new Map();
    for (const { it, P, o, x } of list) {
      const F = err => fail.push({ i: it._row, r: S.data[it._row], err });
      const cx = cxs.find(c => (c.places || []).some(p => p.pnu === P.pnu));
      if (!cx) { F('단지를 단지 목록에 담지 못함 (단지 한도)'); continue; }
      if (!DG.has(cx.id)) DG.set(cx.id, (await Promise.all((cx.places || []).map(p => dongsAt(p.pnu)))).flat());
      if (!UNT.has(cx.id)) { try { UNT.set(cx.id, (await H.api(`/api/auth?action=hj&id=${encodeURIComponent(cx.id)}`)).units || {}); } catch { UNT.set(cx.id, null); } }
      const units = UNT.get(cx.id); if (!units) { F('단지 장부를 열지 못함'); continue; }
      const dn = dnN(it._ex.dong), ho = hoN(it._ex.ho), d = DG.get(cx.id).find(z => dnN(z.dong) === dn);
      if (!d) { F(`${dn}동을 ${cx.name}에서 찾지 못함`); continue; }
      const key = keyOf(d.pnu, d.dong, ho);
      if (units[key]) { F(`${dn}동 ${ho}호는 단지 장부에 이미 적혀 있어 건너뜀`); continue; }
      units[key] = 1;
      const a = it.ad || {}, k = ['sale', 'jeonse', 'wolse'].filter(z => z === it.kind), on = it.status === 'on';
      const st = { src: 'other', k, hold: false, office: o.office };
      const tels = (it.contacts || []).filter(c => c.phone || c.name).slice(0, 4).map(c => ({ l: (({ 소유자: '소유', 임차인: '임차' })[c.role] || c.role || '') + (c.name ? ' ' + c.name : ''), n: c.phone || '' })).map(t => ({ ...t, l: t.l.slice(0, 10) }));
      const opt = ((it._memo || '').match(/^옵션: (.*)$/m) || [])[1] || '';
      const note = [it.status === 'done' && '거래완료(엑셀)', (it._memo || '').split('\n').filter(l => !/^옵션: /.test(l)).join(' · ')].filter(Boolean).join(' · ').slice(0, 300);
      const rec = { ...(on ? { st } : { st: { src: '', k: [], hold: false, office: '' }, so: { src: 'other', k, office: o.office } }),
        pr: { sale: it.kind === 'sale' ? it.price || 0 : 0, jeonse: it.kind === 'jeonse' ? it.deposit || 0 : 0, wd: it.kind === 'wolse' ? it.deposit || 0 : 0, wr: it.kind === 'wolse' ? it.rent || 0 : 0 },
        ar: it._ex.area || 0, live: a.live || '', exp: it.exp || '', moveIn: a.movein || '', rm: a.rooms || 0, bt: a.baths || 0, mg: it.mgmt || 0, ln: it.loan || 0, lnr: a.loanR || '', opt: opt.slice(0, 200),
        tels, note, imp: [it.imp, x.warn.length && `엑셀 확인: ${x.warn.join(' · ')}`].filter(Boolean).join(' · ').slice(0, 100), cd: it.curDep || 0, cr: it.curRent || 0, mk: x.warn.length ? 'y' : '' };
      try {
        await H.api('/api/auth?action=hj', H.post({ id: cx.id, key, op: 'save', rec })); S.made.push([cx.id, key]); S.cxDirty = true;
        if (a.dir || a.ty || a.spy) { const b = bulk.get(cx.id) || { dir: {}, lt: {} }, hk = `${d.pnu}|${dnN(d.dong)}|h${String(ho).replace(/[^0-9A-Za-z]/g, '').slice(0, 8)}`;
          if (a.dir) b.dir[hk] = a.dir.replace(/향$/, ''); if (a.ty || a.spy) b.lt[hk] = { ...(a.ty ? { t: a.ty } : {}), ...(a.spy ? { py: a.spy } : {}) }; bulk.set(cx.id, b); }
      } catch (e) { F(e.message || '단지 장부에 저장하지 못함'); }
    }
    for (const [id, b] of bulk) { try { await H.api('/api/auth?action=cx', H.post({ op: 'bulk', id, ...b })); } catch { /* 타입·방향은 못 넣어도 장부는 그대로 */ } }
  }

  // 10/28 매물장 양식에서도 아파트·오피스텔 매물은 그 단지를 단지 장부에 자동으로 담음 → 아파트 화면의 '단지 밖'으로 갈라지지 않게
  //   이미 담긴 필지는 그대로 · 같은 동네(법정동)에 같은 이름 단지가 있으면 그 단지에 필지를 더함(1단지·2단지 등) · 한도가 차면 못 담은 이름만 알려 줌
  const APTT = ['아파트', '주상복합', '오피스텔'];
  async function autoCx(M, fail) {
    S.cxAdd = []; S.cxFull = [];
    const bad = new Set(fail.map(f => f.i)), L = [...M.values()].filter(g => g.rows.some(i => !bad.has(i)));
    if (!L.length) return;
    shell('<div class="xi-bd"><p class="xi-m">아파트·오피스텔 단지를 단지 목록에 담는 중…</p></div>');
    let cxs = []; try { cxs = (await H.api('/api/auth?action=cx')).items || []; } catch { return; }
    const ids0 = new Set(cxs.map(c => c.id));
    for (const g of L) {
      if (cxs.some(c => (c.places || []).some(p => p.pnu === g.pnu))) continue;
      let name = ''; try { const b = await H.api(`/api/building?pnu=${g.pnu}`); const rc = b.recap && b.recap.data && b.recap.data[0], t = (b.titles && b.titles.data || []).find(x => x.name); name = (rc && rc.name) || (t && t.name) || ''; } catch { /* 이름 없음 */ }
      name = (name || g.name || g.addr || '').slice(0, 40);
      const place = { pnu: g.pnu, addr: g.addr, lat: g.lat, lng: g.lng };
      const same = cxs.find(c => nmN(c.name) === nmN(name) && (c.places || []).some(p => String(p.pnu).slice(0, 10) === g.pnu.slice(0, 10)));
      try {
        const j = await H.api('/api/auth?action=cx', H.post(same ? { op: 'addplace', id: same.id, place } : { op: 'add', name, place }));
        if (j.items) cxs = j.items;
        if (!same && j.id && !ids0.has(j.id)) S.cxAdd.push({ id: j.id, name });   // 원래 있던 단지는 되돌리기 때 지우지 않게
        S.cxDirty = true;
      } catch (e) { if (e.code === 'full') S.cxFull.push(name); }
    }
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
    ['dir', /방향|^향$/], ['typ', /타입|^type$/i], ['py', /^평형$|공급평|^평수$|^평$/],   // 10/28 타입·방향·평형 → 단지 장부의 라인(또는 그 호) 정보
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
    // 10/28 이름 칸: 번호가 섞여 있으면 번호는 번호로, 번호가 없어도 이름은 소유주·세입자 칸에 (10자 넘는 긴 글은 메모에도 전체를 남김)
    const tel = (nm, ph, lab) => {
      const raw = clean(get(nm)).replace(/\n+/g, ' '), phs = [...(clean(get(ph)).match(PHONE) || []), ...(raw.match(PHONE) || [])];
      const name = raw.replace(PHONE, '').replace(/\(\s*\)|\[\s*\]/g, '').replace(/[\s,/·]+$/g, '').replace(/\s+/g, ' ').trim(), l = (lab + (name ? ' ' + name : '')).slice(0, 10);
      if (phs.length) [...new Set(phs.map(fmtPh))].slice(0, 2).forEach(p => rec.tels.length < 4 && rec.tels.push({ l, n: p }));
      else if (name && rec.tels.length < 4) rec.tels.push({ l, n: '' });
      if (name && (lab + ' ' + name).length > 10) notes.push(`${lab} ${name}`);
    };
    tel('oN', 'oP', '소유'); tel('tN', 'tP', '임차');
    const prog = clean(get('prog')); if (prog) notes.push(prog === '♥' ? '♥ 표시(받은 장부)' : `진행: ${prog}`);
    const sp = stampSplit(clean(get('note')).replace(/\n+/g, ' ')); if (sp.head) notes.push(sp.head);   // 날짜가 붙은 상담내역은 상담 기록(히스토리)으로 (10/28)
    rec.note = notes.join(' · ').slice(0, 300);
    if (k.length > 0 && !pr.sale && !pr.jeonse && !pr.wd && !pr.wr) warn.push('가격 없음');
    const DIR = { 남: '남', 남동: '남동', 동남: '남동', 남서: '남서', 서남: '남서', 동: '동', 서: '서', 북: '북', 북동: '북동', 동북: '북동', 북서: '북서', 서북: '북서' };
    const dir = DIR[clean(get('dir')).replace(/\s|향|쪽|방향/g, '')] || '';
    const typ = clean(get('typ')).replace(/\s|타입|type/gi, '').toUpperCase().slice(0, 8), py = Math.round(Number(String(get('py')).replace(/[^\d.]/g, '')) || 0);
    return { rec, warn, hist: sp.list, dir, typ, py: py > 3 && py < 300 ? py : 0 };
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
    const now = x => { const r = x.rec; return [r.live === 'tenant' ? '임차' : r.live === 'owner' ? '입주' : r.live === 'empty' ? '공실' : '', (r.cd || r.cr) && `${(r.cd || 0).toLocaleString()}${r.cr ? '/' + r.cr : ''}`, r.exp && '만기 ' + r.exp.slice(2).replace(/-/g, '.'), r.moveIn, r.imp].filter(Boolean).join(' · ') || '-'; };
    const gl = S.groups.map(G => `<tr><td>${esc(G.q)}</td><td>${esc([...G.names.keys()].join(', ') || '-')}</td><td>${G.rows.length}줄</td><td>${G.err ? `<span class="tg r">${esc(G.err)}</span>` : G.cx ? `<span class="tg g">${esc(G.cx.name)}</span>` : G.add ? `<span class="tg y">새로 담음 · ${esc(G.name)}</span>` : '<span class="tg r">단지 한도 참</span>'}</td></tr>`).join('');
    const el = shell(`<div class="xi-bd"><p class="xi-warn"><b>아파트 장부(동·호별) 파일</b>입니다. 매물장이 아니라 <b>[아파트] 단지 장부</b>의 각 호에 넣습니다.</p>
      <table class="xi-t"><tr><th>엑셀 주소</th><th>물건명</th><th></th><th>넣을 단지</th></tr>${gl}</table>
      <div class="xi-sum"><div class="t"><b>${S.data.length}</b>엑셀 줄</div><div class="g"><b>${C.ok.length}</b>바로 넣음</div><div class="y"><b>${C.warn.length + C.fail.length}</b>확인 필요<small>노랑 ${C.warn.length} · 못 넣음 ${C.fail.length}</small></div><div class="n"><b>${C.skip.have + C.skip.empty + C.skip.noaddr}</b>건너뜀</div></div>
      <p class="xi-m">건너뜀 = 이미 장부에 적힌 호 ${C.skip.have} · 동·호 없음 ${C.skip.empty} · 주소 빈 줄 ${C.skip.noaddr}${C.skip.noaddr ? ' <b class="xi-r">(주소를 채워서 다시 올리면 들어갑니다)</b>' : ''} · 부동산명이 비었거나 우리 사무소면 <b>내 매물</b>, 다른 이름이면 <b>타부동산</b></p>
      ${all.length ? `<table class="xi-t"><tr><th>엑셀 줄</th><th>동·호</th><th>상태</th><th>거래</th><th>의뢰가격</th><th>현상태</th><th></th></tr>${all.slice(0, 8).map(x => `<tr><td>${x.r._n}</td><td>${esc(x.dn)}-${esc(x.ho)}</td><td>${x.rec.st.src ? DS[x.rec.st.src] + (x.rec.st.office ? `(${esc(x.rec.st.office)})` : '') : '-'}</td><td>${kinds(x)}</td><td>${esc(prs(x))}</td><td>${esc(now(x))}</td><td>${x.warn.length ? `<span class="tg y">${esc(x.warn.join(' · '))}</span>` : '<span class="tg g">OK</span>'}</td></tr>`).join('')}</table>` : ''}
      ${C.fail.length ? `<p class="xi-m">못 넣는 줄: ${C.fail.slice(0, 3).map(f => `${f.r._n}줄 ${esc(f.err)}`).join(' · ')}${C.fail.length > 3 ? ` 외 ${C.fail.length - 3}줄` : ''}</p>` : ''}
      <p class="xi-m">현상태: 전완·월완 → 임차(현 보증금·차임) · 12퇴 → 임차 + 꼭 챙길 것 '12월 퇴거 예정' · 입주 → 입주 가능 · ♥ → 메모 · 물건내역 → 옵션·수리 · 상담내역 → 메모(날짜가 붙은 글은 그 날짜의 상담 기록) · 타입·방향 → 라인 정보</p></div>
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
    // 10/28 타입·방향: 같은 라인이 모두 같으면 라인에, 다르면 그 호에만 — 단지마다 한 번에 저장 (이미 적어 둔 라인·호는 그대로)
    const okKeys = new Set(S.made.map(([id, key]) => id + '#' + key));
    for (const G of S.groups) {
      if (!G.cx) continue;
      const xs = todo.filter(x => x.G === G && okKeys.has(G.cx.id + '#' + x.key) && (x.dir || x.typ || x.py)); if (!xs.length) continue;
      const byLine = new Map();
      xs.forEach(x => { const [pnu, dn, ho] = x.key.split('|'), h = +String(ho).replace(/\D/g, ''); const lk = `${pnu}|${dn}|${h >= 100 ? h % 100 : h}`; (byLine.get(lk) || byLine.set(lk, []).get(lk)).push({ x, hk: `${pnu}|${dn}|h${String(ho).replace(/[^0-9A-Za-z]/g, '').slice(0, 8)}` }); });
      const dir = {}, lt = {};
      for (const [lk, L] of byLine) {
        const same = f => L.every(z => z.x[f] === L[0].x[f]);
        if (L[0].x.dir && same('dir')) dir[lk] = L[0].x.dir; else L.forEach(z => { if (z.x.dir) dir[z.hk] = z.x.dir; });
        const tv = z => ({ ...(z.x.typ ? { t: z.x.typ } : {}), ...(z.x.py ? { py: z.x.py } : {}) });
        if ((L[0].x.typ || L[0].x.py) && same('typ') && same('py')) lt[lk] = tv(L[0]); else L.forEach(z => { if (z.x.typ || z.x.py) lt[z.hk] = tv(z); });
      }
      try { await H.api('/api/auth?action=cx', H.post({ op: 'bulk', id: G.cx.id, dir, lt })); S.cxDirty = true; } catch { /* 타입·방향은 못 넣어도 장부는 그대로 */ }
    }
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
  return { open, form, exportLs, _rowItem: rowItem, _header: header, _autoMap: autoMap, _ledgerRec: ledgerRec, _lmap: lmap, _rowOf: rowOf, _K2: K2 };
})();
