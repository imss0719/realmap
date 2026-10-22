// 서울 재개발·재건축 정비사업 현황 페이지 만들기 (검색 노출용, GitHub Actions에서 seoul-zones.mjs 다음에 실행)
// 입력: data/seoul-zones.json(화면용) · data/seoul-raw/vnBsnsNmtn.json(원본) · data/jeongbi-seoul.json(국토부 경계)
// 출력: seoul/index.html · seoul/<구>.html · seoul/<구>/<사업번호>.html · seoul/seoul.css · sitemap.xml
import { readFile, writeFile, mkdir, rm, copyFile } from 'node:fs/promises';

const SITE = 'https://realmap.online';
const readJson = async f => JSON.parse(await readFile(f, 'utf8'));
const sz = await readJson('data/seoul-zones.json');
const raw = new Map(((await readJson('data/seoul-raw/vnBsnsNmtn.json')).rows || []).map(r => [r.BASIC_INFO_SEQ, r]));
const JBF = (await readJson('data/jeongbi-seoul.json')).features || [];
const jb = new Map(JBF.map(f => [f.properties.id, f.properties]));
const UPDATED = sz.updated || new Date().toISOString().slice(0, 10);

// ---------- 기본 도우미 ----------
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = (v, d = 0) => Number(v).toLocaleString('ko-KR', { minimumFractionDigits: d, maximumFractionDigits: d });
const py = m2 => num(m2 * 0.3025, 0);
const kdate = s => { const m = String(s || '').match(/^(\d{4})\.(\d{2})\.(\d{2})/); return m ? `${+m[1]}년 ${+m[2]}월 ${+m[3]}일` : ''; };
const ym = s => { const m = String(s || '').match(/^(\d{4})\.(\d{2})/); return m ? `${m[1]}.${m[2]}` : ''; };
const ymdUpd = UPDATED.replace(/-/g, '.');
const updK = kdate(ymdUpd);

const GU = { '종로구': 'jongno', '중구': 'jung', '용산구': 'yongsan', '성동구': 'seongdong', '광진구': 'gwangjin', '동대문구': 'dongdaemun', '중랑구': 'jungnang', '성북구': 'seongbuk', '강북구': 'gangbuk', '도봉구': 'dobong', '노원구': 'nowon', '은평구': 'eunpyeong', '서대문구': 'seodaemun', '마포구': 'mapo', '양천구': 'yangcheon', '강서구': 'gangseo', '구로구': 'guro', '금천구': 'geumcheon', '영등포구': 'yeongdeungpo', '동작구': 'dongjak', '관악구': 'gwanak', '서초구': 'seocho', '강남구': 'gangnam', '송파구': 'songpa', '강동구': 'gangdong' };
const GU_ORDER = Object.keys(GU);

// 사업 종류
const KIND = {
  '재개발(주택정비형)': { s: '재개발', c: '#D9480F', d: '노후·불량 건축물이 밀집한 주거지역을 정비해 새 주택과 도로·공원 같은 기반시설을 함께 만드는 사업입니다.' },
  '재개발(도시정비형)': { s: '도시정비형 재개발', c: '#E67700', d: '도심이나 역세권처럼 상업·업무 기능이 필요한 지역의 낡은 건물을 정비하는 재개발입니다. 예전 이름은 도시환경정비사업입니다.' },
  '재건축(공동)': { s: '재건축', c: '#1971C2', d: '기반시설은 비교적 양호하지만 노후된 아파트 같은 공동주택을 허물고 새로 짓는 사업입니다.' },
  '재건축(단독)': { s: '단독주택 재건축', c: '#1971C2', d: '노후 단독주택이 모인 지역을 공동주택 등으로 새로 짓는 재건축입니다.' },
  '신속통합기획': { s: '신속통합기획', c: '#0CA678', d: '서울시가 정비계획 수립 단계부터 공공성과 사업성을 함께 검토한 가이드라인을 제시해, 구역지정까지 걸리는 기간을 줄이도록 지원하는 제도입니다. 기획이 끝나면 일반 재개발·재건축 절차를 밟습니다.' },
  '주거환경개선(관리형)': { s: '주거환경개선(관리형)', c: '#2F9E44', d: '저층 주거지를 전면 철거하지 않고 도로·주차장·안전시설 같은 기반시설을 개선하고 주택 개량을 지원하는 사업입니다.' },
  '주거환경개선(정비형)': { s: '주거환경개선(정비형)', c: '#2F9E44', d: '기반시설이 열악한 저소득 주거지를 공공이 주도해 정비하는 사업입니다.' },
};
const kindOf = k => KIND[k] || { s: k || '정비사업', c: '#868E96', d: '' };

// 추진 단계
const ORDER = ['대상지선정', '기획완료', '정비계획수립', '열람공고', '구역지정', '추진위구성', '조합설립인가', '건축심의', '사업시행인가', '관리처분계획인가', '착공', '준공(일부)', '준공'];
const rank = st => { const i = ORDER.indexOf(st); return i < 0 ? -1 : i; };
const STAGE = {
  '대상지선정': { g: 0, d: '신속통합기획 대상지로 선정된 단계입니다. 서울시가 주민 의견을 들어 정비계획 방향(기획안)을 마련합니다.', n: '기획안이 확정되면 정비계획 입안과 정비구역 지정 절차로 넘어갑니다.' },
  '기획완료': { g: 0, d: '신속통합기획안(정비계획 가이드라인)이 확정된 단계입니다.', n: '이 기획안을 바탕으로 구청이 정비계획을 입안하고, 주민 열람과 심의를 거쳐 정비구역으로 지정됩니다.' },
  '정비계획수립': { g: 0, d: '정비계획을 세우고 있는 단계입니다. 구역 범위, 용적률, 높이, 세대수 같은 큰 틀이 이때 정해집니다.', n: '주민 공람(열람공고)과 도시계획위원회 심의를 거쳐 정비구역으로 지정됩니다.' },
  '열람공고': { g: 0, d: '정비계획안을 주민에게 공개하고 의견을 받는 단계입니다.', n: '심의를 거쳐 정비구역 지정·고시로 이어집니다.' },
  '구역지정': { g: 1, d: '정비계획이 결정되고 정비구역으로 지정·고시된 단계입니다. 사업의 범위와 계획 규모가 공식적으로 정해졌다는 뜻입니다.', n: '다음은 토지등소유자 과반수 동의를 받아 조합설립추진위원회를 구성하는 단계입니다.', nPub: '주거환경개선사업은 구청 등 공공이 사업시행자가 되어 사업시행계획을 세웁니다.' },
  '추진위구성': { g: 1, d: '토지등소유자 과반수 동의로 조합설립추진위원회가 승인된 단계입니다. 추진위원회가 조합 설립을 준비합니다.', n: '법에서 정한 비율 이상의 소유자 동의를 받으면 조합설립인가를 신청합니다.' },
  '조합설립인가': { g: 2, d: '토지등소유자의 동의를 받아 조합이 설립 인가된 단계입니다. 이때부터 조합이 사업의 주체가 되어 시공사 선정 등을 진행합니다.', n: '건축심의를 거쳐 사업시행계획인가를 받는 것이 다음 큰 고비입니다.' },
  '건축심의': { g: 2, d: '건축계획(배치, 높이, 동수 등)에 대한 심의를 받는 단계입니다.', n: '심의를 통과하면 사업시행계획인가를 신청합니다.' },
  '사업시행인가': { g: 2, d: '건축계획과 정비기반시설 계획 등을 담은 사업시행계획이 인가된 단계입니다. 사업의 구체적인 모습이 확정됩니다.', n: '조합원 분양신청을 받은 뒤 관리처분계획인가를 받게 됩니다.' },
  '관리처분계획인가': { g: 3, d: '조합원별 종전자산 가치와 분양받을 주택, 분담금 등을 정한 관리처분계획이 인가된 단계입니다.', n: '이주와 철거를 거쳐 착공에 들어갑니다.' },
  '착공': { g: 3, d: '이주·철거를 마치고 공사를 시작한 단계입니다.', n: '공사가 끝나면 준공 인가와 입주, 이전고시·청산 절차가 이어집니다.' },
  '준공(일부)': { g: 3, d: '공사가 일부 끝나 준공된 단계입니다.', n: '나머지 공사가 끝나면 전체 준공됩니다.' },
  '준공': { g: 4, d: '공사가 끝나 준공된 사업입니다.', n: '' },
};
const GROUP = ['준비 단계', '구역지정·추진위', '조합·인가', '이주·공사', '준공'];
const GCOLOR = ['#ADB5BD', '#F2B705', '#F08C00', '#D9480F', '#2F9E44'];
const stageOf = (st, k) => { const S = STAGE[st] || { g: 0, d: '', n: '' }; return /^주거환경개선/.test(k || '') && S.nPub ? { ...S, n: S.nPub } : S; };
function track(r) {
  const k = r.k;
  let steps = /^주거환경개선/.test(k) ? ['구역지정', '사업시행인가', '착공', '준공'] : ['구역지정', '추진위구성', '조합설립인가', '사업시행인가', '관리처분계획인가', '착공', '준공'];
  if (k === '신속통합기획' || rank(r.st) < rank('구역지정')) steps = ['대상지선정', '기획완료', ...steps];
  const cr = rank(r.st);
  const done = steps.map(s => rank(s) <= cr && cr >= 0);
  return { steps, done };
}
// '3/35', '지하3/지상49층' 같은 층수 표기를 [지하, 지상] 숫자로
const floors = fl => { const p = String(fl || '').split('/'); if (p.length < 2) return null; const a = (p[0].match(/\d+/) || [])[0], b = (p[1].match(/\d+/) || [])[0]; return b ? [a || '0', b] : null; };
const SHORT = { '대상지선정': '대상지', '기획완료': '기획', '구역지정': '구역지정', '추진위구성': '추진위', '조합설립인가': '조합설립', '사업시행인가': '사업시행', '관리처분계획인가': '관리처분', '착공': '착공', '준공': '준공' };

// ---------- 자료 정리 ----------
const clean = s => String(s ?? '').replace(/\s+/g, ' ').trim();
const rows = (sz.rows || []).filter(r => GU[r.gu]).map(r => {
  const x = raw.get(r.id) || {};
  const j = (r.jb || []).map(id => jb.get(id)).filter(Boolean)[0];
  const addr = clean(x.BSNS_ADDR || r.a).replace(/\s*일대\s*$/, '');
  const dong = (addr.match(/^(\S+?(동|가|로)\d*가?)\s/) || [])[1] || addr.split(' ')[0] || '';
  return {
    ...r, n: clean(r.n) || `${addr} 일대`, addr, dong,
    height: +x.HEIGHT || 0, bc: +x.BLDGLND_RT || 0, sale: +x.PARCEL || 0, rent: +x.RENTAL || 0, rentRt: +x.RENTAL_RT || 0, rgn: clean(x.RGN_CODE_NM),
    jbDate: j ? (j.d || (j.y ? `${j.y}년` : '')) : '', slug: GU[r.gu],
  };
});
// 같은 이름이 한 구에 둘 이상이면 주소를 붙여 구분
const dupe = new Map();
rows.forEach(r => { const k = r.gu + '|' + r.n; dupe.set(k, (dupe.get(k) || 0) + 1); });
rows.forEach(r => { r.title = dupe.get(r.gu + '|' + r.n) > 1 ? `${r.n} (${r.addr})` : r.n; });
const byGu = new Map(GU_ORDER.map(g => [g, rows.filter(r => r.gu === g)]));
const sortRows = a => a.slice().sort((x, y) => rank(y.st) - rank(x.st) || (y.hh || 0) - (x.hh || 0) || x.n.localeCompare(y.n, 'ko'));
const zoneUrl = r => `/seoul/${r.slug}/${r.id}.html`;
const mapUrl = r => r.lat ? `/?lat=${r.lat}&lng=${r.lng}&from=seoul` : '';
const dist = (a, b) => Math.hypot((a.lat - b.lat) * 111, (a.lng - b.lng) * 88);

// ---------- 공통 틀 ----------
const LOGO = `<svg width="30" height="30" viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" rx="14" fill="#14212E"/><g transform="translate(6.4 9) scale(0.72)"><g fill="#fff"><path d="M10 2H22V17.5L10 19Z"/><path d="M10 21 22 19.5V40L10 41.5Z"/><path d="M10 43.5 22 42V62H10Z"/><path d="M24 2H40.5L40 13H24Z"/><path d="M42.5 2H48L54 8V25L42.5 26.3Z"/><path d="M24 29.6 33 28.8V38H24Z"/><path d="M31 40.5H44L51.5 50 39.5 51.5Z"/><path d="M41 53.5 53 52 61 62H47Z"/></g><path d="M35 28.6 54 27V30L47 38H35Z" fill="#F2B705"/></g></svg>`;
function page({ path, title, desc, h1, lead, crumbs, body, faq = [], hero = '' }) {
  const url = SITE + path;
  const ld = [{ '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: crumbs.map((c, i) => ({ '@type': 'ListItem', position: i + 1, name: c[0], item: SITE + c[1] })) }];
  if (faq.length) ld.push({ '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: faq.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })) });
  return `<!doctype html>
<html lang="ko"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${url}">
<meta property="og:type" content="article"><meta property="og:site_name" content="리얼맵">
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${url}"><meta property="og:image" content="${SITE}/og.png">
<meta property="og:locale" content="ko_KR"><meta property="article:modified_time" content="${UPDATED}">
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+KR:wght@400;600;700&display=swap">
<link rel="stylesheet" href="/seoul/seoul.css">
<script>document.documentElement.classList.add('js')</script>
<script src="/seoul/seoul.js" defer></script>
${ld.map(x => `<script type="application/ld+json">${JSON.stringify(x).replace(/</g, '\\u003c')}</script>`).join('\n')}
</head><body>
<header class="top"><a class="brand" href="/">${LOGO}<b>리얼맵</b></a><a class="mapbtn" href="/?from=seoul">지도 열기</a></header>
${hero}
<main>
<nav class="crumb" aria-label="현재 위치">${crumbs.map((c, i) => i < crumbs.length - 1 ? `<a href="${c[1]}">${esc(c[0])}</a>` : `<span>${esc(c[0])}</span>`).join(' › ')}</nav>
${h1 ? `<h1>${h1}</h1>` : ''}
${lead ? `<p class="lead">${lead}</p>` : ''}
${body}
${faq.length ? `<section class="faq"><h2>자주 묻는 질문</h2>${faq.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join('')}</section>` : ''}
<p class="src">자료: 서울 열린데이터광장 「도시계획사업(서울플랜+) 정비사업 현황」(${esc(updK)} 받음), 국토교통부 정비구역 연속주제도. 리얼맵이 분기마다 자동으로 갱신합니다. 계획 수치와 추진 단계는 진행 중에 바뀔 수 있으니 계약 등 중요한 결정 전에는 구청이나 조합, <a href="https://cleanup.seoul.go.kr" target="_blank" rel="noopener">정비사업 정보몽땅</a>에서 꼭 확인해 주세요.</p>
</main>
<footer>리얼맵 · 운영 주식회사 드림인베스트 · 문의 realwalkers@naver.com · <a href="/guide.html">이용 안내</a> · <a href="/privacy.html">개인정보처리방침</a></footer>
</body></html>
`;
}
const pill = r => { const st = r.st || '단계 미상', g = stageOf(r.st).g; return `<span class="st g${g}">${esc(st)}</span>`; };
const kchip = k => { const K = kindOf(k); return `<span class="kd" style="--c:${K.c}">${esc(K.s)}</span>`; };
function mini(r) {
  const { steps, done } = track(r);
  return `<span class="mini" aria-hidden="true">${steps.map((s, i) => `<i class="${done[i] ? 'on' : ''}"></i>`).join('')}</span>`;
}
const zattr = r => `data-z data-id="${r.id}" data-n="${esc(r.title)}" data-gu="${esc(r.gu)}" data-st="${esc(r.st || '')}"`;
const zbtns = (sm = '') => `<button type="button" class="zb${sm}" data-act="fav" aria-pressed="false">☆ 관심 구역</button><button type="button" class="zb${sm}" data-act="alert" aria-pressed="false">🔔 추진 알림 받기</button>`;
function card(r, withGu = false) {
  const meta = [r.hh ? `${num(r.hh)}세대` : '', floors(r.fl) ? `지상 ${floors(r.fl)[1]}층` : '', r.ar ? `${num(r.ar)}㎡` : ''].filter(Boolean).join(' · ');
  return `<li class="card" ${zattr(r)}><div class="hd"><a class="nm" href="${zoneUrl(r)}">${esc(r.title)}</a>${kchip(r.k)}</div>
    <div class="ad">${withGu ? esc(r.gu) + ' ' : ''}${esc(r.addr)} 일대</div>
    <div class="row">${pill(r)}${r.sd ? `<span class="dt">${esc(ym(r.sd))}</span>` : ''}${mini(r)}</div>
    ${meta ? `<div class="mt">${meta}</div>` : ''}
    <div class="go"><a href="${zoneUrl(r)}">자세히</a>${mapUrl(r) ? `<a href="${mapUrl(r)}">지도에서 보기</a>` : ''}<span class="zbs">${zbtns(' sm')}</span></div></li>`;
}
function stageBar(list) {
  const cnt = GROUP.map((_, g) => list.filter(r => stageOf(r.st).g === g).length), tot = list.length || 1;
  return `<div class="sbar" role="img" aria-label="${GROUP.map((g, i) => `${g} ${cnt[i]}곳`).join(', ')}">${cnt.map((c, i) => c ? `<i style="width:${c / tot * 100}%;background:${GCOLOR[i]}"></i>` : '').join('')}</div>
  <ul class="slegend">${GROUP.map((g, i) => `<li><i style="background:${GCOLOR[i]}"></i>${g} <b>${cnt[i]}</b></li>`).join('')}</ul>`;
}
const kindCount = list => Object.keys(KIND).map(k => [k, list.filter(r => r.k === k).length]).filter(x => x[1]);
const STAGE_FAQ = [
  ['재개발·재건축은 보통 어떤 순서로 진행되나요?', '일반적으로 정비계획 수립 → 정비구역 지정 → 조합설립추진위원회 → 조합설립인가 → 사업시행계획인가 → 관리처분계획인가 → 이주·철거 → 착공 → 준공 순서로 진행됩니다. 신속통합기획 대상지는 그 앞에 서울시의 기획 단계가 더해집니다.'],
  ['신속통합기획은 무엇인가요?', '서울시가 정비계획 수립 단계부터 공공성과 사업성을 함께 검토한 기획안을 제시해, 정비구역 지정까지 걸리는 기간을 줄이도록 지원하는 제도입니다. 기획이 끝나면 일반 재개발·재건축과 같은 절차를 밟습니다.'],
  ['조합설립인가 이후에 사면 조합원이 될 수 있나요?', '투기과열지구에서는 재건축은 조합설립인가 후, 재개발은 관리처분계획인가 후부터 조합원 지위 양도가 원칙적으로 제한되며 예외 요건이 있습니다. 지역과 시점에 따라 달라지므로 계약 전에 구청과 조합에 반드시 확인해 주세요.'],
  ['모아타운도 여기서 볼 수 있나요?', '모아타운(소규모주택정비 관리지역)은 이 목록에는 포함되지 않습니다. 리얼맵 지도에서 필지를 누르면 토지이용계획을 기준으로 모아타운·소규모정비 여부를 함께 표시해 드립니다.'],
];

// ---------- 사업별 페이지 ----------
await rm('seoul', { recursive: true, force: true });
await mkdir('seoul', { recursive: true });
const urls = [];
for (const [gu, list] of byGu) {
  if (!list.length) continue;
  await mkdir(`seoul/${GU[gu]}`, { recursive: true });
  for (const r of list) {
    const K = kindOf(r.k), S = stageOf(r.st, r.k), { steps, done } = track(r);
    const fl = floors(r.fl);
    const zs = v => String(v || '').split(/\s*,\s*/).filter(Boolean).join(', ');
    const zoneChg = r.zb && r.za && r.zb !== r.za ? `${zs(r.zb)} → ${zs(r.za)}` : zs(r.za || r.zb);
    const facts = [
      ['사업 구분', r.k || K.s],
      ['추진 단계', r.st ? `${r.st}${r.sd ? ` · ${kdate(r.sd)}` : ''}` : '확인 중'],
      ['위치', `서울특별시 ${r.gu} ${r.addr} 일대`],
      ['정비구역 고시', r.jbDate],
      ['구역 면적', r.ar ? `${num(r.ar)}㎡ (약 ${py(r.ar)}평)` : ''],
      ['용도지역', zoneChg],
      ['계획 용적률', r.far ? `${num(r.far, r.far % 1 ? 2 : 0)}%` : ''],
      ['계획 건폐율', r.bc ? `${num(r.bc, r.bc % 1 ? 2 : 0)}%` : ''],
      ['계획 층수', fl ? `지하 ${fl[0]}층 · 지상 ${fl[1]}층` : ''],
      ['최고 높이', r.height ? `${num(r.height)}m` : ''],
      ['계획 세대수', r.hh ? `${num(r.hh)}세대${r.sale || r.rent ? ` (분양 ${num(r.sale)} · 임대 ${num(r.rent)}${r.rentRt ? `, 임대 비율 ${num(r.rentRt, 1)}%` : ''})` : ''}` : ''],
      ['권역', r.rgn],
    ].filter(x => x[1]);
    // 한 줄 소개
    const s1 = `${esc(r.title)} 정비사업은 서울특별시 ${esc(r.gu)} ${esc(r.addr)} 일대에서 추진되는 ${esc(K.s)} 사업입니다.`;
    const s2 = r.st ? ` ${r.sd ? `${kdate(r.sd)} 기준 ` : '현재 '}<b>${esc(r.st)}</b> 단계에 있습니다.` : '';
    const s3 = r.hh ? ` 계획상 ${fl ? `지하 ${fl[0]}층·지상 ${fl[1]}층, ` : ''}${num(r.hh)}세대 규모입니다.` : '';
    const near = r.lat ? list.filter(o => o !== r && o.lat).sort((a, b) => dist(a, r) - dist(b, r)).slice(0, 6) : list.filter(o => o !== r && o.dong === r.dong).slice(0, 6);
    const faq = [
      [`${r.title} 정비사업은 지금 어느 단계인가요?`, r.st ? `서울시 정비사업 현황(${updK} 기준)에 따르면 ${r.sd ? kdate(r.sd) + ' ' : ''}${r.st} 단계입니다. ${S.d}` : '서울시 자료에 추진 단계가 등록되어 있지 않습니다. 구청에 확인해 주세요.'],
      ...(r.hh ? [[`${r.title} 정비사업은 몇 세대로 지어지나요?`, `계획상 ${num(r.hh)}세대${fl ? `, 지하 ${fl[0]}층·지상 ${fl[1]}층` : ''} 규모입니다. 계획은 인가 과정에서 바뀔 수 있습니다.`]] : []),
      ...(S.n ? [['다음 단계는 무엇인가요?', S.n]] : []),
    ];
    const body = `
<div class="hero"><div class="chips">${kchip(r.k)}${pill(r)}</div>
<p class="intro">${s1}${s2}${s3}</p>
<div class="btns">${mapUrl(r) ? `<a class="cta" href="${mapUrl(r)}">리얼맵 지도에서 보기</a>` : ''}${/^https:\/\/cleanup\.seoul\.go\.kr\//.test(r.url) ? `<a class="cta2" href="${esc(r.url)}" target="_blank" rel="noopener">조합 소식 (정비사업 정보몽땅)</a>` : ''}</div>
<div class="zrow" ${zattr(r)}>${zbtns()}</div>
<p class="znote">☆ 관심 구역은 회원 전용입니다. 🔔 추진 알림은 이메일로만 보내 드리며, 이 구역의 추진 단계가 바뀌면 알려 드립니다.</p></div>
<section><h2>추진 단계</h2>
<ol class="track">${steps.map((s, i) => `<li class="${done[i] ? 'on' : ''}${s === r.st || (done[i] && !done[i + 1]) ? ' cur' : ''}"><i></i><span>${esc(SHORT[s] || s)}</span></li>`).join('')}</ol>
${S.d ? `<p><b>${esc(r.st)}</b> — ${esc(S.d)}</p>` : ''}${S.n ? `<p class="next"><b>다음 단계</b> ${esc(S.n)}</p>` : ''}</section>
<section><h2>사업 개요</h2><dl class="facts">${facts.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
${K.d ? `<p class="note"><b>${esc(K.s)}</b> — ${esc(K.d)}</p>` : ''}</section>
${near.length ? `<section><h2>가까운 정비사업</h2><ul class="cards">${near.map(o => card(o)).join('')}</ul></section>` : ''}
<p class="more"><a href="/seoul/${r.slug}.html">${esc(r.gu)} 정비사업 전체 보기 (${list.length}곳) ›</a> · <a href="/seoul/">서울 25개 구 한눈에 보기 ›</a></p>`;
    const desc = `${r.gu} ${r.addr} ${r.title} ${K.s} 정비사업. ${r.st ? `추진 단계 ${r.st}${r.sd ? `(${ym(r.sd)})` : ''}` : ''}${r.hh ? `, 계획 ${num(r.hh)}세대` : ''}${fl ? `, 지상 ${fl[1]}층` : ''}. 위치·면적·용적률과 다음 단계를 정리했습니다.`.slice(0, 150);
    await writeFile(`seoul/${r.slug}/${r.id}.html`, page({
      path: zoneUrl(r), title: `${r.title} ${K.s} 추진 단계·계획 세대수 (${r.gu} ${r.dong}) | 리얼맵`, desc,
      h1: `${esc(r.title)} <small>${esc(K.s)}</small>`, lead: `서울특별시 ${esc(r.gu)} ${esc(r.addr)} 일대 · ${esc(updK)} 기준`,
      crumbs: [['리얼맵', '/'], ['서울 정비사업', '/seoul/'], [r.gu, `/seoul/${r.slug}.html`], [r.title, zoneUrl(r)]], body, faq,
    }));
    urls.push([zoneUrl(r), 0.6]);
  }

  // ---------- 구별 페이지 ----------
  const kc = kindCount(list);
  const big = list.filter(r => r.hh).sort((a, b) => b.hh - a.hh)[0];
  const going = list.filter(r => stageOf(r.st).g >= 2 && stageOf(r.st).g <= 3).length;
  const recent = list.filter(r => r.sd && r.sd >= `${+UPDATED.slice(0, 4) - 1}${UPDATED.slice(4, 10).replace(/-/g, '.')}`).sort((a, b) => b.sd.localeCompare(a.sd)).slice(0, 8);
  const hhSum = list.reduce((s, r) => s + (r.hh || 0), 0);
  const intro = `${gu}에는 서울시 정비사업 현황 기준 <b>${list.length}곳</b>의 정비사업이 있습니다. ${kc.map(([k, c]) => `${kindOf(k).s} ${c}곳`).join(', ')}입니다.`
    + (going ? ` 이 중 조합설립부터 공사 단계까지 사업이 본격적으로 진행 중인 곳이 ${going}곳입니다.` : '')
    + (big ? ` 계획 세대수가 가장 많은 곳은 <a href="${zoneUrl(big)}">${esc(big.title)}</a>(${num(big.hh)}세대)입니다.` : '')
    + (hhSum ? ` 세대수가 공개된 사업만 합쳐도 약 ${num(Math.round(hhSum / 100) * 100)}세대가 계획되어 있습니다.` : '');
  const groups = Object.keys(KIND).map(k => [k, sortRows(list.filter(r => r.k === k))]).filter(x => x[1].length);
  const others = sortRows(list.filter(r => !KIND[r.k]));
  if (others.length) groups.push(['기타', others]);
  const dongs = [...new Set(list.map(r => r.dong).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ko'));
  const body = `
<div class="hero"><p class="intro">${intro}</p><div class="btns"><a class="cta" href="/?from=seoul">리얼맵 지도에서 정비구역 보기</a></div></div>
<section><h2>추진 단계 한눈에</h2>${stageBar(list)}</section>
${recent.length ? `<section><h2>최근 1년 사이 단계가 진행된 곳</h2><ul class="cards">${recent.map(r => card(r)).join('')}</ul></section>` : ''}
<nav class="toc" aria-label="종류별 바로가기">${groups.map(([k, l], i) => `<a href="#k${i}">${esc(kindOf(k).s)} ${l.length}</a>`).join('')}</nav>
${groups.map(([k, l], i) => `<section id="k${i}"><h2>${esc(kindOf(k).s)} <small>${l.length}곳</small></h2>${kindOf(k).d ? `<p class="note">${esc(kindOf(k).d)}</p>` : ''}<ul class="cards">${l.map(r => card(r)).join('')}</ul></section>`).join('')}
${dongs.length ? `<section><h2>동별로 찾기</h2><p class="dongs">${dongs.map(d => `<span>${esc(d)} ${list.filter(r => r.dong === d).length}</span>`).join('')}</p></section>` : ''}
<section><h2>다른 구 보기</h2><p class="gus">${GU_ORDER.filter(g => byGu.get(g).length).map(g => g === gu ? `<b>${g}</b>` : `<a href="/seoul/${GU[g]}.html">${g}</a>`).join('')}</p></section>`;
  await writeFile(`seoul/${GU[gu]}.html`, page({
    path: `/seoul/${GU[gu]}.html`, title: `${gu} 재개발·재건축 정비사업 현황 ${list.length}곳 — 추진 단계·세대수 (${ym(ymdUpd)}) | 리얼맵`,
    desc: `${gu} 재개발·재건축·신속통합기획 정비사업 ${list.length}곳의 추진 단계, 계획 세대수, 위치를 한눈에. ${kc.slice(0, 3).map(([k, c]) => `${kindOf(k).s} ${c}곳`).join(', ')}. ${updK} 기준.`,
    h1: `${gu} 재개발·재건축 정비사업 현황`, lead: `${esc(updK)} 기준 · 서울시 정비사업 현황`,
    crumbs: [['리얼맵', '/'], ['서울 정비사업', '/seoul/'], [gu, `/seoul/${GU[gu]}.html`]], body, faq: STAGE_FAQ,
  }));
  urls.push([`/seoul/${GU[gu]}.html`, 0.8]);
}

// ---------- 서울 전체 페이지 (첫 화면: 움직이는 현황판) ----------
// 구 타일 지도 배치 (열, 행) — 실제 위치를 단순화
const TILE = { '은평구': [1, 0], '강북구': [3, 0], '도봉구': [4, 0], '노원구': [5, 0], '서대문구': [1, 1], '종로구': [2, 1], '성북구': [3, 1], '동대문구': [4, 1], '중랑구': [5, 1], '강서구': [0, 2], '마포구': [1, 2], '중구': [2, 2], '성동구': [3, 2], '광진구': [4, 2], '강동구': [5, 2], '양천구': [0, 3], '영등포구': [1, 3], '용산구': [2, 3], '서초구': [3, 3], '강남구': [4, 3], '송파구': [5, 3], '구로구': [0, 4], '동작구': [2, 4], '금천구': [1, 5], '관악구': [2, 5] };
// 첫 화면 배경: 실제 정비구역 경계로 그린 선 그림 (마포·서대문·중구 일대)
function heroArt() {
  const [la0, la1, ln0, ln1] = [37.515, 37.605, 126.89, 127.06], W = 1000, H = 560, kx = Math.cos(37.56 * Math.PI / 180);
  const sx = W / ((ln1 - ln0) * kx), sy = H / (la1 - la0), sc = Math.min(sx, sy);
  const P = ([x, y]) => [((x - ln0) * kx * sc).toFixed(1), (H - (y - la0) * sc).toFixed(1)];
  const cols = ['#F2B705', '#FF8A3D', '#FF6B2C', '#F2B705', '#FFD43B'];
  const out = [];
  JBF.forEach((f, i) => {
    const g = f.geometry, ps = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
    for (const p of ps) {
      const ring = p[0]; if (!ring || !ring.some(([x, y]) => y > la0 && y < la1 && x > ln0 && x < ln1)) continue;
      const step = Math.max(1, Math.floor(ring.length / 40));
      const pts = ring.filter((_, k) => k % step === 0).map(P);
      if (pts.length < 3) continue;
      out.push(`<path d="M${pts.map(q => q.join(' ')).join('L')}Z" style="--d:${(out.length % 24) * 0.09}s;--c:${cols[out.length % cols.length]}"/>`);
    }
  });
  return `<svg class="lh-art" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice" aria-hidden="true">${out.slice(0, 260).join('')}</svg>`;
}
{
  const kc = kindCount(rows);
  const recent = rows.filter(r => r.sd && r.st !== '준공').sort((a, b) => b.sd.localeCompare(a.sd)).slice(0, 9);
  const top = rows.filter(r => r.hh).sort((a, b) => b.hh - a.hh).slice(0, 10);
  const gtab = GU_ORDER.map(g => { const l = byGu.get(g); return { g, l, n: l.length, re: l.filter(r => /^재개발/.test(r.k)).length, rb: l.filter(r => /^재건축/.test(r.k)).length, st: l.filter(r => r.k === '신속통합기획').length, go: l.filter(r => [2, 3].includes(stageOf(r.st).g)).length }; }).filter(x => x.n);
  const going = rows.filter(r => [2, 3].includes(stageOf(r.st).g)).length;
  const hhMan = Math.round(rows.reduce((s, r) => s + (r.hh || 0), 0) / 10000);
  const stn = rows.filter(r => r.k === '신속통합기획').length;
  const gcnt = GROUP.map((_, g) => rows.filter(r => stageOf(r.st).g === g).length), gmax = Math.max(...gcnt);
  const GSUB = ['대상지선정·기획·정비계획', '구역지정·추진위원회', '조합설립·건축심의·사업시행인가', '관리처분·이주·착공', '공사 완료'];
  const nmax = Math.max(...gtab.map(x => x.n));
  const hero = `<section class="lhero"><div class="lh-bg">${heroArt()}</div><div class="lh-in">
  <p class="eyebrow">서울 정비사업 현황 · ${esc(updK)} 기준</p>
  <h1 class="lh-t"><span class="l1">서울 재개발·재건축,</span><span class="l2">지금 어디까지 왔을까?</span></h1>
  <p class="lh-s">정비사업 ${rows.length}곳의 추진 단계를 한눈에 보세요. 관심 구역을 담아 두면 단계가 바뀔 때 이메일로 알려 드립니다.</p>
  <div class="lh-nums">
    <div><b data-count="${rows.length}">${num(rows.length)}</b><span>정비사업</span></div>
    <div><b data-count="${going}">${num(going)}</b><span>본격 진행 중<small>조합설립~공사</small></span></div>
    <div><b><em data-count="${hhMan}">${num(hhMan)}</em>만</b><span>계획 세대수</span></div>
    <div><b data-count="${stn}">${num(stn)}</b><span>신속통합기획</span></div>
  </div>
  <div class="lh-btns"><a class="cta y" href="/?from=seoul">리얼맵 지도에서 보기</a><a class="cta2 w" href="#gumap">구별 현황 보기</a></div>
</div></section>`;
  const body = `
<section class="mine" data-myzones hidden><h2 class="my-hi">관심 구역</h2><p class="my-mail note"></p><ul class="my-list"></ul></section>
<section class="flow" data-anim><h2>추진 단계별 사업 수</h2><p class="note">서울 정비사업 ${rows.length}곳이 지금 어느 단계에 있는지 보여 드립니다.</p>
<div class="fl">${GROUP.map((g, i) => `<div class="fc"><b data-count="${gcnt[i]}">${num(gcnt[i])}</b><div class="fbar"><i style="--h:${Math.max(4, gcnt[i] / gmax * 100).toFixed(0)}%;--c:${GCOLOR[i]};--d:${i * 0.12}s"></i></div><span>${g}</span><small>${GSUB[i]}</small></div>`).join('')}</div></section>
<section id="gumap" class="gumap" data-anim><h2>구별 정비사업 지도</h2><p class="note">색이 진할수록 정비사업이 많은 구입니다. 구를 누르면 사업별 추진 단계를 보실 수 있습니다.</p>
<div class="tiles">${gtab.map(x => { const [c, r] = TILE[x.g] || [0, 0]; return `<a class="tile" href="/seoul/${GU[x.g]}.html" style="grid-column:${c + 1};grid-row:${r + 1};--a:${(0.12 + x.n / nmax * 0.78).toFixed(2)};--d:${((c + r) * 0.05).toFixed(2)}s"><b>${x.g.replace(/구$/, '')}</b><span>${x.n}곳</span><i style="--p:${(x.go / x.n * 100).toFixed(0)}%"></i></a>`; }).join('')}</div>
<p class="tleg"><i></i> 막대: 본격 진행(조합설립~공사) 비율</p></section>
<section class="howto" data-anim><h2>관심 구역 담고, 추진 알림 받기</h2>
<ol class="steps"><li><b>1</b><span>구역 찾기</span><small>구별 현황이나 리얼맵 지도에서 궁금한 구역을 찾습니다.</small></li><li><b>2</b><span>☆ 관심 구역</span><small>카카오로 3초 가입하고 관심 구역에 담습니다.</small></li><li><b>3</b><span>🔔 추진 알림</span><small>이메일을 남기면 추진 단계가 바뀔 때 알려 드립니다.</small></li></ol></section>
<section data-anim><h2>최근 단계가 진행된 곳</h2><ul class="cards">${recent.map(r => card(r, true)).join('')}</ul></section>
<section data-anim><h2>계획 세대수가 많은 곳</h2><ol class="rank">${top.map((r, i) => `<li><a href="${zoneUrl(r)}">${esc(r.title)}</a> <span>${esc(r.gu)} · ${esc(kindOf(r.k).s)} · ${esc(r.st)}</span><b>${num(r.hh)}세대</b><i style="--w:${(r.hh / top[0].hh * 100).toFixed(0)}%;--d:${i * 0.06}s"></i></li>`).join('')}</ol></section>
<section><h2>구별 정비사업 표</h2><div class="tblwrap"><table class="gt"><thead><tr><th>구</th><th>전체</th><th>재개발</th><th>재건축</th><th>신속통합기획</th><th>본격 진행</th></tr></thead><tbody>
${gtab.map(x => `<tr><th><a href="/seoul/${GU[x.g]}.html">${x.g}</a></th><td>${x.n}</td><td>${x.re}</td><td>${x.rb}</td><td>${x.st}</td><td>${x.go}</td></tr>`).join('')}</tbody></table></div>
<p class="note">${kc.map(([k, c]) => `${kindOf(k).s} ${c}곳`).join(' · ')}. 본격 진행은 조합설립인가부터 착공까지의 단계에 있는 사업 수입니다.</p></section>
<section><h2>단계별 뜻</h2><dl class="facts">${['구역지정', '추진위구성', '조합설립인가', '사업시행인가', '관리처분계획인가', '착공'].map(s => `<dt>${s}</dt><dd>${esc(STAGE[s].d)}</dd>`).join('')}</dl></section>`;
  await writeFile('seoul/index.html', page({
    path: '/seoul/', title: `서울 재개발·재건축 정비사업 현황 ${rows.length}곳 — 구별 추진 단계 (${ym(ymdUpd)}) | 리얼맵`,
    desc: `서울 25개 구 재개발·재건축·신속통합기획 정비사업 ${rows.length}곳의 추진 단계와 계획 세대수를 구별로 정리했습니다. ${updK} 기준, 분기마다 자동 갱신.`,
    h1: '', lead: '', hero,
    crumbs: [['리얼맵', '/'], ['서울 정비사업', '/seoul/']], body, faq: STAGE_FAQ,
  }));
  urls.unshift(['/seoul/', 0.9]);
}

// ---------- 스타일 ----------
await writeFile('seoul/seoul.css', `:root{--bg:#EEF1F4;--surface:#fff;--fg:#14212E;--muted:#5E6A77;--line:#DCE2E8;--soft:#F4F6F8;--accent:#F2B705;--navy:#14212E}
@media (prefers-color-scheme:dark){:root{--bg:#0E1317;--surface:#151C22;--fg:#E5EAEF;--muted:#94A1AE;--line:#26313A;--soft:#1B242C;--navy:#F2B705}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font-family:"IBM Plex Sans KR","Apple SD Gothic Neo","Malgun Gothic",sans-serif;line-height:1.75;font-size:16px;word-break:keep-all}
a{color:inherit}
.top{position:sticky;top:0;z-index:5;display:flex;justify-content:space-between;align-items:center;padding:10px 16px;background:var(--surface);border-bottom:1px solid var(--line)}
.brand{display:flex;align-items:center;gap:8px;text-decoration:none;font-size:18px}
.mapbtn{font-size:14px;font-weight:700;text-decoration:none;background:var(--navy);color:var(--surface);padding:7px 14px;border-radius:999px}
main{max-width:860px;margin:20px auto;background:var(--surface);padding:28px 36px 32px;border-radius:14px}
@media (max-width:640px){main{margin:0;border-radius:0;padding:18px 16px 24px}}
.crumb{font-size:13px;color:var(--muted)}.crumb a{text-decoration:none}.crumb a:hover{text-decoration:underline}
h1{font-size:28px;line-height:1.35;margin:10px 0 4px;letter-spacing:-.02em}h1 small{font-size:16px;color:var(--muted);font-weight:600;margin-left:6px}
.lead{color:var(--muted);margin:0 0 6px;font-size:14px}
h2{font-size:20px;margin:34px 0 12px;padding-top:20px;border-top:1px solid var(--line);letter-spacing:-.01em}h2 small{font-size:14px;color:var(--muted);font-weight:600}
.hero{margin-top:14px}.intro{font-size:17px;margin:10px 0}
.chips{display:flex;flex-wrap:wrap;gap:6px}
.kd{display:inline-block;font-size:12px;font-weight:700;padding:2px 9px;border-radius:6px;background:var(--c);color:#fff;vertical-align:middle}
.st{display:inline-block;font-size:12px;font-weight:700;padding:2px 9px;border-radius:6px;background:var(--soft);border:1px solid var(--line)}
.st.g1{background:#FFF7D6;border-color:#F2DB8A;color:#7A5B00}.st.g2{background:#FFF0DD;border-color:#F5C58A;color:#9A4B00}.st.g3{background:#FFE8E0;border-color:#F4B4A0;color:#A22E0A}.st.g4{background:#E3F6E8;border-color:#A9DDB6;color:#1E6B34}
@media (prefers-color-scheme:dark){.st.g1,.st.g2,.st.g3,.st.g4{background:var(--soft);color:var(--fg)}}
.btns{display:flex;flex-wrap:wrap;gap:8px;margin:14px 0 4px}
.cta{display:inline-block;background:var(--navy);color:var(--surface);padding:11px 20px;border-radius:999px;font-weight:700;text-decoration:none}
.cta2{display:inline-block;border:1px solid var(--line);padding:10px 18px;border-radius:999px;font-weight:700;text-decoration:none}
.track{list-style:none;display:flex;padding:0;margin:8px 0 14px;counter-reset:s}
.track li{flex:1;position:relative;text-align:center;font-size:12.5px;color:var(--muted);padding-top:22px;min-width:0}
.track li i{position:absolute;top:4px;left:50%;width:14px;height:14px;margin-left:-7px;border-radius:50%;background:var(--surface);border:3px solid var(--line);z-index:1}
.track li:before{content:"";position:absolute;top:9px;left:-50%;width:100%;height:4px;background:var(--line)}
.track li:first-child:before{display:none}
.track li.on i{background:var(--accent);border-color:var(--accent)}.track li.on:before{background:var(--accent)}
.track li.on{color:var(--fg)}.track li.cur span{font-weight:700;color:var(--fg)}.track li.cur i{box-shadow:0 0 0 5px rgba(242,183,5,.3)}
@media (max-width:520px){.track li{font-size:10.5px;letter-spacing:-.05em}.track li span{display:block;padding:0 1px}}
.next{background:var(--soft);border-radius:10px;padding:10px 14px}.next b{margin-right:6px}
.facts{display:grid;grid-template-columns:140px 1fr;margin:0;border-top:1px solid var(--line)}
.facts dt,.facts dd{margin:0;padding:10px 4px;border-bottom:1px solid var(--line)}.facts dt{color:var(--muted);font-size:14px}.facts dd{font-weight:600}
@media (max-width:520px){.facts{grid-template-columns:104px 1fr}}
.note{font-size:14px;color:var(--muted)}
.cards{list-style:none;padding:0;margin:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:10px}
.card{border:1px solid var(--line);border-radius:12px;padding:12px 14px;display:flex;flex-direction:column;gap:4px}
.card .nm{font-weight:700;font-size:16px;text-decoration:none;margin-right:6px}.card .nm:hover{text-decoration:underline}
.card .ad{font-size:13px;color:var(--muted)}
.card .hd{display:flex;flex-wrap:wrap;align-items:center;gap:4px 6px}.card .hd .nm{margin-right:0}
.card .row{display:flex;flex-wrap:wrap;align-items:center;gap:6px 8px}.card .dt{font-size:12px;color:var(--muted)}
.card .mt{font-size:13px}
.card .go{display:flex;gap:12px;font-size:13px;font-weight:700;margin-top:2px}.card .go a{text-decoration:none;color:#0B6E69}
@media (prefers-color-scheme:dark){.card .go a{color:#4BBDB2}}
.mini{display:inline-flex;gap:2px;margin-left:auto;flex:none}.mini i{width:10px;height:5px;border-radius:2px;background:var(--line)}.mini i.on{background:var(--accent)}
.sbar{display:flex;height:16px;border-radius:8px;overflow:hidden;background:var(--soft)}
.slegend{list-style:none;padding:0;margin:10px 0 0;display:flex;flex-wrap:wrap;gap:6px 16px;font-size:14px}.slegend i{display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:5px}
.toc{display:flex;flex-wrap:wrap;gap:6px;margin:26px 0 0}.toc a{font-size:14px;font-weight:600;text-decoration:none;border:1px solid var(--line);border-radius:999px;padding:4px 12px}
.dongs span{display:inline-block;margin:0 10px 6px 0;font-size:14px;color:var(--muted)}
.gus a,.gus b{display:inline-block;margin:0 12px 8px 0;font-size:15px}
.tblwrap{overflow-x:auto}
.gt{width:100%;border-collapse:collapse;font-size:14.5px;font-variant-numeric:tabular-nums}.gt th,.gt td{padding:8px 6px;border-bottom:1px solid var(--line);text-align:right;white-space:nowrap}.gt th:first-child{text-align:left}.gt thead th{color:var(--muted);font-weight:600}
.rank{padding-left:22px}.rank li{margin:6px 0}.rank span{font-size:13px;color:var(--muted);margin:0 8px}.rank b{float:right}
.more{margin-top:26px;font-weight:600}
.faq details{border-bottom:1px solid var(--line);padding:10px 0}.faq summary{cursor:pointer;font-weight:700}.faq p{margin:8px 0 0;color:var(--muted)}
.src{margin-top:30px;font-size:13px;color:var(--muted);background:var(--soft);border-radius:10px;padding:12px 14px}
footer{max-width:860px;margin:0 auto 30px;padding:0 16px;font-size:13px;color:var(--muted)}
`);

await writeFile('seoul/seoul.css', (await readFile('seoul/seoul.css', 'utf8')) + `
/* 관심 구역 · 알림 버튼 */
.zrow{display:flex;flex-wrap:wrap;gap:8px;margin:10px 0 0}
.zb{font:inherit;font-size:14px;font-weight:700;cursor:pointer;border:1.5px solid var(--line);background:var(--surface);color:var(--fg);padding:9px 16px;border-radius:999px}
.zb:hover{border-color:var(--accent)}
.zb.on{background:#FFF4CC;border-color:var(--accent);color:#7A5B00}
@media (prefers-color-scheme:dark){.zb.on{background:#3A3010;color:#FFD43B}}
.zb.sm{font-size:12px;padding:3px 9px;border-width:1px}
.zbs{display:inline-flex;gap:6px;margin-left:auto}
.card .go{align-items:center;flex-wrap:wrap}
.znote{font-size:13px;color:var(--muted);margin:8px 0 0}
#ztoast{position:fixed;left:50%;bottom:28px;transform:translateX(-50%) translateY(20px);background:#14212E;color:#fff;padding:11px 18px;border-radius:999px;font-size:14px;font-weight:600;opacity:0;pointer-events:none;transition:.25s;z-index:50;max-width:calc(100% - 32px)}
#ztoast.show{opacity:1;transform:translateX(-50%)}
#zmodal{position:fixed;inset:0;z-index:40;display:flex;align-items:center;justify-content:center;padding:16px}
#zmodal .zm-bg{position:absolute;inset:0;background:rgba(10,16,22,.55)}
#zmodal .zm-box{position:relative;background:var(--surface);border-radius:16px;padding:24px 22px 18px;max-width:400px;width:100%;box-shadow:0 20px 50px rgba(0,0,0,.3)}
#zmodal h3{margin:0 0 8px;font-size:19px}#zmodal p{margin:6px 0;font-size:15px}
.zm-x{position:absolute;right:12px;top:10px;border:0;background:var(--soft);width:30px;height:30px;border-radius:50%;font-size:18px;cursor:pointer;color:var(--fg)}
.zm-kakao,.zm-go{display:block;width:100%;text-align:center;margin:14px 0 6px;padding:13px;border-radius:12px;font:inherit;font-weight:700;font-size:16px;text-decoration:none;border:0;cursor:pointer}
.zm-kakao{background:#FEE500;color:#191919}.zm-go{background:var(--navy);color:var(--surface)}
.zm-l{display:block;font-size:14px;font-weight:600;margin-top:12px}.zm-l input{display:block;width:100%;margin-top:6px;font:inherit;font-size:16px;padding:11px 12px;border:1.5px solid var(--line);border-radius:10px;background:var(--surface);color:var(--fg)}
.zm-c{display:flex;gap:8px;align-items:flex-start;font-size:13px;color:var(--muted);margin-top:10px}.zm-c input{margin-top:3px}
.zm-s{font-size:12.5px!important;color:var(--muted)}
.lnk{border:0;background:none;color:inherit;text-decoration:underline;font:inherit;cursor:pointer;padding:0}
/* 내 관심 구역 */
.mine{border:2px solid var(--accent);border-radius:14px;padding:4px 18px 14px;margin-top:4px}.mine h2{border:0;padding-top:10px;margin-top:6px}
.my-list{list-style:none;padding:0;margin:8px 0 0}.my-list li{display:flex;align-items:center;gap:8px;padding:9px 0;border-top:1px solid var(--line)}
.my-list a{text-decoration:none;flex:1;min-width:0}.my-list a span{font-size:13px;color:var(--muted);margin-left:6px}.my-list .empty{color:var(--muted);font-size:14px}
/* 첫 화면 */
.lhero{position:relative;overflow:hidden;background:#0E1823;color:#fff}
.lh-bg{position:absolute;inset:0;opacity:.9}
.lh-art{width:100%;height:100%}
.lh-art path{fill:var(--c);fill-opacity:0;stroke:var(--c);stroke-width:1.4;stroke-opacity:.85;stroke-dasharray:1200;stroke-dashoffset:1200;animation:draw 2.2s cubic-bezier(.3,.6,.3,1) forwards,fillin 1.2s ease forwards;animation-delay:var(--d),calc(var(--d) + 1.2s)}
@keyframes draw{to{stroke-dashoffset:0}}@keyframes fillin{to{fill-opacity:.12}}
.lhero:after{content:"";position:absolute;inset:0;background:linear-gradient(90deg,rgba(14,24,35,.92) 0%,rgba(14,24,35,.7) 45%,rgba(14,24,35,.35) 100%),linear-gradient(180deg,transparent 70%,rgba(14,24,35,.9))}
.lh-in{position:relative;z-index:1;max-width:860px;margin:0 auto;padding:64px 24px 56px}
.eyebrow{display:inline-block;font-size:13px;font-weight:700;color:#F2B705;letter-spacing:.02em;margin:0 0 14px;animation:up .7s .1s both}
.lh-t{margin:0;font-size:clamp(32px,6.4vw,56px);line-height:1.2;letter-spacing:-.03em}
.lh-t span{display:block;animation:up .8s both}.lh-t .l1{animation-delay:.2s}.lh-t .l2{color:#F2B705;animation-delay:.45s}
.lh-s{font-size:clamp(16px,2.3vw,19px);color:#C9D3DE;max-width:560px;margin:16px 0 0;animation:up .8s .7s both}
.lh-nums{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:32px 0 0;animation:up .8s .9s both}
.lh-nums div{background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.12);border-radius:14px;padding:14px 12px;backdrop-filter:blur(4px)}
.lh-nums b{display:block;font-size:clamp(26px,4.6vw,40px);line-height:1.1;color:#fff;font-variant-numeric:tabular-nums}.lh-nums b em{font-style:normal}
.lh-nums span{display:block;font-size:13px;color:#AFC0D1;margin-top:4px}.lh-nums small{display:block;font-size:11px;color:#7F93A8}
@media (max-width:600px){.lh-nums{grid-template-columns:repeat(2,1fr)}.lh-in{padding:44px 18px 40px}}
.lh-btns{display:flex;flex-wrap:wrap;gap:10px;margin-top:26px;animation:up .8s 1.1s both}
.cta.y{background:#F2B705;color:#14212E}.cta2.w{color:#fff;border-color:rgba(255,255,255,.35)}
@keyframes up{from{opacity:0;transform:translateY(18px)}to{opacity:1;transform:none}}
/* 화면에 들어오면 나타나기 */
.js [data-anim]{opacity:0;transform:translateY(26px);transition:opacity .7s ease,transform .7s ease}
.js [data-anim].in{opacity:1;transform:none}
/* 단계 흐름 */
.fl{display:grid;grid-template-columns:repeat(5,1fr);gap:10px;align-items:start;margin-top:14px}
.fc{text-align:center}.fc b{display:block;font-size:26px;font-variant-numeric:tabular-nums}
.fbar{height:150px;display:flex;align-items:flex-end;justify-content:center;margin:6px 0 8px;background:linear-gradient(transparent 49%,var(--line) 50%,transparent 51%) 0 0/100% 30px}
.fbar i{display:block;width:62%;max-width:70px;border-radius:10px 10px 4px 4px;background:var(--c);height:var(--h)}
.js .flow .fbar i{height:0;transition:height 1s cubic-bezier(.2,.7,.2,1) var(--d)}.js .flow.in .fbar i{height:var(--h)}
.fc span{display:block;font-weight:700;font-size:14px}.fc small{display:block;font-size:11.5px;color:var(--muted);line-height:1.4;margin-top:2px}
@media (max-width:560px){.fc b{font-size:20px}.fbar{height:110px}.fc span{font-size:12px}.fc small{display:none}}
/* 구 타일 지도 */
.tiles{display:grid;grid-template-columns:repeat(6,1fr);gap:6px;margin-top:14px;max-width:620px}
.tile{position:relative;aspect-ratio:1.15;border-radius:10px;text-decoration:none;padding:8px 9px;display:flex;flex-direction:column;justify-content:space-between;background:rgba(217,72,15,var(--a));color:var(--fg);overflow:hidden;transition:transform .15s}
.tile:hover{transform:translateY(-2px);box-shadow:0 6px 14px rgba(0,0,0,.12)}
.tile b{font-size:clamp(12px,2.2vw,15px)}.tile span{font-size:clamp(11px,2vw,14px);font-weight:700;font-variant-numeric:tabular-nums}
.tile i{position:absolute;left:0;bottom:0;height:4px;width:var(--p);background:#14212E;opacity:.55}
.js .gumap .tile{opacity:0;transform:scale(.85);transition:opacity .4s var(--d),transform .4s var(--d)}.js .gumap.in .tile{opacity:1;transform:none}
@media (prefers-color-scheme:dark){.tile{color:#fff}.tile i{background:#F2B705}}
.tleg{font-size:12.5px;color:var(--muted)}.tleg i{display:inline-block;width:18px;height:4px;background:#14212E;opacity:.55;vertical-align:middle;margin-right:4px}
/* 이용 방법 */
.steps{list-style:none;padding:0;display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin:12px 0 0}
.steps li{background:var(--soft);border-radius:14px;padding:16px 14px}.steps b{display:inline-flex;width:28px;height:28px;border-radius:50%;background:var(--accent);color:#14212E;align-items:center;justify-content:center;font-size:14px}
.steps span{display:block;font-weight:700;font-size:16px;margin-top:8px}.steps small{display:block;font-size:13px;color:var(--muted);margin-top:4px;line-height:1.55}
@media (max-width:560px){.steps{grid-template-columns:1fr}}
/* 세대수 순위 막대 */
.rank li{position:relative;padding-bottom:6px}.rank li i{position:absolute;left:0;bottom:0;height:3px;border-radius:2px;background:var(--accent);width:var(--w)}
.js .rank li i{width:0;transition:width .9s var(--d)}.js section.in .rank li i{width:var(--w)}
@media (prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}.js [data-anim]{opacity:1;transform:none}.lh-art path{stroke-dashoffset:0;fill-opacity:.12}.js .flow .fbar i{height:var(--h)}.js .gumap .tile{opacity:1;transform:none}.js .rank li i{width:var(--w)}}
`);
await copyFile('scripts/seoul.client.js', 'seoul/seoul.js');

// ---------- 사이트맵 ----------
const base = [['/', 1.0], ['/guide.html', 0.8], ['/privacy.html', 0.2]];
await writeFile('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${[...base, ...urls].map(([u, p]) => `  <url><loc>${SITE}${u}</loc><lastmod>${UPDATED}</lastmod><priority>${p.toFixed(1)}</priority></url>`).join('\n')}
</urlset>
`);
console.log(`정비사업 페이지 ${urls.length}개 · 사이트맵 ${urls.length + base.length}개 주소`);
