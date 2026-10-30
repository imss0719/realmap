// 10/30 인천 재개발·재건축 정비사업 페이지 만들기 (검색 노출용 · GitHub Actions에서 ic-zones-build.mjs 다음에 실행)
// 경기 gg-pages.mjs를 그대로 가져와 인천에 맞게 고친 것 (자료가 국토부 전국 자료뿐이라 단계별 일자·평형 구성·조합원 수는 없음)
// 입력: data/ic-zones.json  출력: incheon/index.html · incheon/<구>.html · incheon/<구>/<번호>.html · incheon/t/<테마>.html · sitemap-ic.xml
// 모양·움직임은 서울 /seoul/seoul.css · /seoul/seoul.js + 경기 /gyeonggi/gg.css 를 같이 씀 · 관심 구역 ☆만 (추진 알림 🔔은 서울만)
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';

const SITE = 'https://realmap.online';
const D = JSON.parse(await readFile('data/ic-zones.json', 'utf8'));
const UPDATED = D.updated || new Date().toISOString().slice(0, 10);
const ymdUpd = UPDATED.replace(/-/g, '.');
const kdate = s => { const m = String(s || '').match(/^(\d{4})\.(\d{2})\.(\d{2})/); return m ? `${+m[1]}년 ${+m[2]}월 ${+m[3]}일` : ''; };
const ym = s => { const m = String(s || '').match(/^(\d{4})\.(\d{2})/); return m ? `${m[1]}.${m[2]}` : ''; };
const updK = kdate(ymdUpd);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = (v, d = 0) => Number(v).toLocaleString('ko-KR', { minimumFractionDigits: d, maximumFractionDigits: d });
const py = m2 => num(m2 * 0.3025, 0);

const SI_ORDER = ['중구', '동구', '미추홀구', '연수구', '남동구', '부평구', '계양구', '서구', '강화군', '옹진군'];   // 인천 구·군 (변수 이름은 경기 것 그대로 si)

// ---------- 사업 종류 ----------
const KIND = {
  '재개발': { c: '#D9480F', d: '노후·불량 건축물이 밀집한 주거지역을 정비해 새 주택과 도로·공원 같은 기반시설을 함께 만드는 사업입니다.' },
  '재건축': { c: '#1971C2', d: '기반시설은 비교적 양호하지만 노후된 아파트 같은 공동주택을 허물고 새로 짓는 사업입니다.' },
  '주거환경개선': { c: '#2F9E44', d: '기반시설이 열악한 저소득 주거지를 공공(시·LH 등)이 주도해 정비하는 사업입니다.' },
  '가로주택정비': { c: '#7048E8', d: '도로로 둘러싸인 작은 블록(가로구역)의 노후 주택을 정비하는 소규모주택정비사업입니다. 정비구역 지정이나 추진위원회 없이 조합을 만들고, 관리처분계획은 사업시행계획에 함께 담아 일반 재개발보다 절차가 짧습니다.' },
  '소규모재건축': { c: '#0B7285', d: '대지 1만㎡ 미만·노후 200세대 미만 공동주택을 다시 짓는 소규모주택정비사업입니다. 정비구역 지정 없이 진행해 일반 재건축보다 절차가 짧습니다.' },
};
const kindOf = k => KIND[k] || { c: '#868E96', d: '' };
const SMALL = k => k === '가로주택정비' || k === '소규모재건축';

// ---------- 추진 단계 (경기 페이지와 같은 이름 · ic-zones-build.mjs가 국토부 단계 이름을 바꿔 둠) ----------
const ORDER = ['예정구역', '정비구역', '추진위원회', '조합설립', '사업시행', '관리처분', '착공', '준공', '청산'];
const rank = st => ORDER.indexOf(st);
const STAGE = {
  '예정구역': { g: 0, d: '시·군의 도시·주거환경정비 기본계획에 정비예정구역으로 반영된 단계입니다. 아직 정비구역으로 지정되지는 않았습니다.', n: '정비계획을 세워 주민 공람과 심의를 거치면 정비구역으로 지정됩니다.' },
  '정비구역': { g: 1, d: '정비계획이 결정되고 정비구역으로 지정·고시된 단계입니다. 사업 범위와 계획 규모가 공식적으로 정해졌다는 뜻입니다.', n: '토지등소유자 과반수 동의로 조합설립추진위원회를 구성하는 것이 다음 단계입니다.', nPub: '주거환경개선사업은 시·LH 같은 공공이 사업시행자가 되어 사업시행계획을 세웁니다.' },
  '추진위원회': { g: 1, d: '토지등소유자 과반수 동의로 조합설립추진위원회가 승인된 단계입니다. 추진위원회가 조합 설립을 준비합니다.', n: '법에서 정한 비율 이상의 소유자 동의를 받으면 조합설립인가를 신청합니다.' },
  '조합설립': { g: 2, d: '토지등소유자의 동의를 받아 조합이 설립 인가된 단계입니다. 이때부터 조합이 사업 주체가 되어 시공사 선정 등을 진행합니다.', n: '건축심의를 거쳐 사업시행계획인가를 받는 것이 다음 큰 고비입니다.', nSmall: '건축심의를 거쳐 사업시행계획인가(관리처분계획 포함)를 받습니다.' },
  '사업시행': { g: 2, d: '건축계획과 정비기반시설 계획 등을 담은 사업시행계획이 인가된 단계입니다. 사업의 구체적인 모습이 확정됩니다.', n: '조합원 분양신청을 받은 뒤 관리처분계획인가를 받게 됩니다.', nSmall: '소규모주택정비사업은 관리처분계획이 사업시행계획에 포함되어, 이주·철거를 거쳐 바로 착공으로 넘어갑니다.' },
  '관리처분': { g: 3, d: '조합원별 종전자산 가치와 분양받을 주택, 분담금 등을 정한 관리처분계획이 인가된 단계입니다.', n: '이주와 철거를 거쳐 착공에 들어갑니다.' },
  '착공': { g: 3, d: '이주·철거를 마치고 공사를 시작한 단계입니다.', n: '공사가 끝나면 준공 인가와 입주, 이전고시·청산 절차가 이어집니다.' },
  '준공': { g: 4, d: '공사가 끝나 준공된 사업입니다.', n: '이전고시와 조합 청산·해산 절차가 남아 있을 수 있습니다.' },
  '청산': { g: 4, d: '준공 후 이전고시까지 마치고 조합 청산·해산 단계에 들어간 사업입니다.', n: '' },
};
const GROUP = ['준비 단계', '구역지정·추진위', '조합·인가', '이주·공사', '준공'];
const GCOLOR = ['#ADB5BD', '#F2B705', '#F08C00', '#D9480F', '#2F9E44'];
const stageOf = (st, k) => { const S = STAGE[st] || { g: 0, d: '', n: '' }; if (SMALL(k) && S.nSmall) return { ...S, n: S.nSmall }; if (k === '주거환경개선' && S.nPub) return { ...S, n: S.nPub }; return S; };
const SHORT = { '예정구역': '예정구역', '정비구역': '구역지정', '추진위원회': '추진위', '조합설립': '조합설립', '사업시행': '사업시행', '관리처분': '관리처분', '착공': '착공', '준공': '준공', '청산': '청산' };
function track(r) {
  let steps = SMALL(r.k) ? ['조합설립', '사업시행', '착공', '준공'] : r.k === '주거환경개선' ? ['예정구역', '정비구역', '사업시행', '착공', '준공'] : ['예정구역', '정비구역', '추진위원회', '조합설립', '사업시행', '관리처분', '착공', '준공'];
  if (SMALL(r.k) && r.dates && r.dates.comm) steps = ['추진위원회', ...steps];
  const cr = rank(r.st === '청산' ? '준공' : r.st);
  return { steps, done: steps.map(s => rank(s) <= cr) };
}
// 단계별 일자 표 (국토부 자료엔 일자가 없어 지금은 안 나옴)
const DLABEL = [['pre', '정비예정구역 고시'], ['zone', '정비구역 지정'], ['zoneChg', '정비구역 변경'], ['safe', '안전진단'], ['eval', '사전 타당성'], ['comm', '추진위원회 승인'], ['union', '조합설립인가'], ['impl', '사업시행인가'], ['mgmt', '관리처분인가'], ['build', '착공'], ['sale', '일반분양'], ['done', '준공'], ['close', '이전고시·청산']];
const CUR_KEY = { '예정구역': 'pre', '정비구역': 'zone', '추진위원회': 'comm', '조합설립': 'union', '사업시행': 'impl', '관리처분': 'mgmt', '착공': 'build', '준공': 'done', '청산': 'close' };

// ---------- 자료 ----------
const rows = D.rows.filter(r => r.slug);
rows.forEach(r => {
  r.gk = r.k; r.title = r.n.replace(/\(주환개선\)/, '');
  r.siteAddr = r.addr || r.si;
  r.place = `인천광역시 ${r.siteAddr}`;
});
const dupe = new Map(); rows.forEach(r => { const k = r.si + '|' + r.title; dupe.set(k, (dupe.get(k) || 0) + 1); });
const seen = new Map(); rows.forEach(r => { const k = r.si + '|' + r.title; if (dupe.get(k) > 1) { const i = (seen.get(k) || 0) + 1; seen.set(k, i); if (i > 1) r.title = `${r.title} ${i}`; } });   // 남촌동 · 남촌동 2
const SIS = SI_ORDER.filter(s => rows.some(r => r.si === s));
const bySi = new Map(SIS.map(s => [s, rows.filter(r => r.si === s)]));
const SLUG = Object.fromEntries(rows.map(r => [r.si, r.slug]));
const zoneUrl = r => `/incheon/${r.slug}/${r.id}.html`;
const mapUrl = r => r.lat ? `/?lat=${r.lat}&lng=${r.lng}&from=ic` : '';
const dist = (a, b) => Math.hypot((a.lat - b.lat) * 111, (a.lng - b.lng) * 88);
const rk2 = r => { const i = rank(r.st); return i < 0 ? 99 : i; };
const sortEarly = a => a.slice().sort((x, y) => rk2(x) - rk2(y) || (y.hh || 0) - (x.hh || 0) || x.n.localeCompare(y.n, 'ko'));
const oneYear = `${+UPDATED.slice(0, 4) - 1}.${UPDATED.slice(5, 7)}.${UPDATED.slice(8, 10)}`;
const LIVE = r => !['준공', '청산'].includes(r.st);

// ---------- 테마 ----------
const THEMES = [
  { g: '규모', slug: 'big', name: '대단지 (1,000세대 이상)', short: '대단지', f: r => r.hh >= 1000 && LIVE(r), d: '계획 세대수가 1,000세대 이상인 진행 중 정비사업입니다. 단지 규모가 커서 커뮤니티 시설과 학교·상권 형성에 유리하고 관심이 많이 모입니다.' },
  { g: '규모', slug: 'mega', name: '초대형 (3,000세대 이상)', short: '초대형', f: r => r.hh >= 3000 && LIVE(r), d: '계획 세대수가 3,000세대 이상인 진행 중 초대형 정비사업입니다. 일대 주거지 모습을 크게 바꾸는 사업들입니다.' },
  { g: '단계', slug: 'early', name: '막 시작한 곳 (예정구역~추진위원회)', short: '막 시작한 곳', f: r => rank(r.st) >= 0 && rank(r.st) <= rank('추진위원회'), d: '정비예정구역, 정비구역 지정, 추진위원회 단계에 있는 사업입니다. 사업 초기라 기간과 계획이 바뀔 여지가 크고, 그만큼 확인할 것도 많습니다.' },
  { g: '단계', slug: 'union', name: '조합설립 완료 (조합설립~사업시행인가)', short: '조합설립 완료', f: r => ['조합설립', '사업시행'].includes(r.st), d: '조합설립인가를 받아 조합이 사업 주체가 된 곳들입니다. 시공사 선정, 건축심의, 사업시행계획인가를 거쳐 관리처분으로 넘어갑니다.' },
  { g: '단계', slug: 'move', name: '관리처분·이주 (관리처분인가)', short: '관리처분·이주', f: r => r.st === '관리처분', d: '조합원별 분양 주택과 분담금이 정해진 관리처분계획인가 단계입니다. 이주와 철거를 거쳐 착공으로 넘어갑니다.' },
  { g: '단계', slug: 'build', name: '공사 중 (착공)', short: '공사 중', f: r => r.st === '착공', d: '이주·철거를 마치고 공사에 들어간 사업입니다. 입주 시기가 가까워진 곳들입니다.' },
  { g: '단계', slug: 'done', name: '완료된 사업 (준공·청산)', short: '완료된 사업', f: r => !LIVE(r), d: '공사가 끝나 준공했거나 청산 단계에 들어간 사업입니다. 같은 동네에서 진행 중인 사업과 세대수·용적률을 비교해 보실 때 참고가 됩니다.' },
  { g: '종류', slug: 'redev', name: '재개발', short: '재개발', f: r => r.k === '재개발', d: KIND['재개발'].d },
  { g: '종류', slug: 'rebuild', name: '재건축', short: '재건축', f: r => r.k === '재건축', d: KIND['재건축'].d },
  { g: '종류', slug: 'living', name: '주거환경개선사업', short: '주거환경개선', f: r => r.k === '주거환경개선', d: KIND['주거환경개선'].d },
].map(t => ({ ...t, list: rows.filter(t.f) }));
const TG = ['규모', '단계', '종류'];
const themeUrl = t => `/incheon/t/${t.slug}.html`;
const LOGO = `<svg width="26" height="26" viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" rx="14" fill="#F2B705"/><g transform="translate(6.4 9) scale(0.72)"><g fill="#14212E"><path d="M10 2H22V17.5L10 19Z"/><path d="M10 21 22 19.5V40L10 41.5Z"/><path d="M10 43.5 22 42V62H10Z"/><path d="M24 2H40.5L40 13H24Z"/><path d="M42.5 2H48L54 8V25L42.5 26.3Z"/><path d="M24 29.6 33 28.8V38H24Z"/><path d="M31 40.5H44L51.5 50 39.5 51.5Z"/><path d="M41 53.5 53 52 61 62H47Z"/></g><path d="M35 28.6 54 27V30L47 38H35Z" fill="#fff"/></g></svg>`;
const viewNav = cur => `<nav class="vw" aria-label="보는 방법"><div class="vw-in">
  <a href="/seoul/">서울</a><a href="/gyeonggi/">경기</a><a href="/incheon/"${cur === 'idx' ? ' aria-current="page"' : ''}>인천 전체</a><span class="vs">구별</span>
  <details class="vd"><summary${cur === 'si' ? ' class="on"' : ''}>${SIS.length}개 구 ▾</summary><div class="vdm">${SIS.map(s => `<a href="/incheon/${SLUG[s]}.html">${s}<small>${bySi.get(s).length}</small></a>`).join('')}</div></details>
  ${TG.map(g => `<span class="vs">${g}</span>${THEMES.filter(t => t.g === g && t.list.length).map(t => `<a href="${themeUrl(t)}"${cur === t.slug ? ' aria-current="page"' : ''}>${esc(t.short)}</a>`).join('')}`).join('')}
</div></nav>`;
function page({ path, title, desc, crumbs, h1, sub = '', body, faq = [], cur = '', zrow = null }) {
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
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css">
<link rel="stylesheet" href="/seoul/seoul.css?v=${UPDATED}">
<link rel="stylesheet" href="/gyeonggi/gg.css?v=${UPDATED}">
<script>document.documentElement.classList.add('js')</script>
<script src="/seoul/seoul.js?v=${UPDATED}g" defer></script>
${zrow ? `<script type="application/json" id="zrow">${JSON.stringify(zrow).replace(/</g, '\\u003c')}</script>\n` : ''}${ld.map(x => `<script type="application/ld+json">${JSON.stringify(x).replace(/</g, '\\u003c')}</script>`).join('\n')}
</head><body class="gg">
<header class="top"><a class="brand" href="/">${LOGO}<b>리얼맵</b></a><nav class="crumb" aria-label="현재 위치">${crumbs.slice(1).map((c, i, a) => i < a.length - 1 ? `<a href="${c[1]}">${esc(c[0])}</a>` : `<span>${esc(c[0])}</span>`).join('<i>›</i>')}</nav>
<span class="sp"></span><span class="upd">${esc(ymdUpd)} 기준 · 분기 갱신</span><a class="mapbtn" href="/?from=ic">지도에서 보기</a></header>
${viewNav(cur)}
<main>
<div class="ph"><h1>${h1}</h1>${sub ? `<p class="sub">${sub}</p>` : ''}</div>
${body}
${faq.length ? `<section class="pn faq"><h2>자주 묻는 질문</h2>${faq.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join('')}</section>` : ''}
<p class="src">자료: 국토교통부 「전국 도시정비사업 통합 데이터」(${esc(updK)} 받음), 국토교통부 정비구역 연속주제도. 리얼맵이 분기마다 자동으로 갱신합니다. 위치는 정비구역 경계와 장소 검색으로 찾은 대략적인 위치이고, 단계·세대수는 지자체가 올린 값이라 늦게 반영되거나 비어 있는 곳이 있습니다. 계약 등 중요한 결정 전에는 구청이나 조합에 꼭 확인해 주세요.</p>
</main>
<footer>리얼맵 · 운영 주식회사 드림인베스트 · 문의 contact@realmap.online · <a href="/guide.html">이용 안내</a> · <a href="/privacy.html">개인정보처리방침</a></footer>
</body></html>
`;
}
// ---------- 조각 ----------
const pill = r => `<span class="st g${stageOf(r.st).g}">${esc(r.st || '단계 미상')}</span>`;
const kchip = k => `<span class="kd" style="--c:${kindOf(k).c}">${esc(k)}</span>`;
const KSHORT = { '가로주택정비': '가로주택', '주거환경개선': '주거환경' };
const kshort = k => `<span class="kd" style="--c:${kindOf(k).c}">${esc(KSHORT[k] || k)}</span>`;
function mini(r) { const { done } = track(r); return `<span class="mini" aria-hidden="true">${done.map(d => `<i${d ? ' class="on"' : ''}></i>`).join('')}</span>`; }
const zattr = r => `data-z data-id="${r.id}" data-n="${esc(r.title)}" data-gu="${esc(r.si)}" data-st="${esc(r.st || '')}"`;
const zicon = () => `<button type="button" class="zi" data-act="fav" aria-pressed="false" title="관심 구역에 담기" aria-label="관심 구역에 담기">☆</button>`;
const gcount = list => GROUP.map((_, g) => list.filter(r => stageOf(r.st).g === g).length);
const sbar = list => { const cnt = gcount(list), tot = list.length || 1; return `<span class="sbar" role="img" aria-label="${GROUP.map((g, i) => `${g} ${cnt[i]}곳`).join(', ')}">${cnt.map((c, i) => c ? `<i style="width:${(c / tot * 100).toFixed(1)}%;background:${GCOLOR[i]}"></i>` : '').join('')}</span>`; };
const kpis = (list, extra = []) => { const c = gcount(list); return `<div class="kp"><div><small>전체</small><b>${num(list.length)}</b><span>곳</span></div>${GROUP.map((g, i) => `<div><small><i style="background:${GCOLOR[i]}"></i>${g}</small><b>${num(c[i])}</b></div>`).join('')}${extra.map(([t, v]) => `<div><small>${t}</small><b>${v}</b></div>`).join('')}</div>`; };
const kindsIn = list => Object.keys(KIND).map(k => [k, list.filter(r => r.k === k).length]).filter(x => x[1]);
function ztable(list, { withSi = false, sortKey = 'st' } = {}) {
  const L = sortKey === 'sd' ? list.slice().sort((a, b) => String(b.sd || '').localeCompare(String(a.sd || '')) || rk2(a) - rk2(b)) : sortEarly(list);
  const kinds = kindsIn(list), gc = gcount(list), sis = withSi ? SIS.filter(s => list.some(r => r.si === s)) : [];
  const flt = list.length > 6 ? `<div class="flt" data-flt>
    <span class="fg"><button type="button" class="on" data-fk="">종류 전체</button>${kinds.map(([k, c]) => `<button type="button" data-fk="${esc(k)}">${esc(KSHORT[k] || k)} ${c}</button>`).join('')}</span>
    <span class="fg"><button type="button" class="on" data-fs="">단계 전체</button>${GROUP.map((g, i) => gc[i] ? `<button type="button" data-fs="${i}"><i style="background:${GCOLOR[i]}"></i>${g} ${gc[i]}</button>` : '').join('')}</span>
    <span class="fr">${withSi && sis.length > 1 ? `<select data-fgu aria-label="구 고르기"><option value="">모든 구</option>${sis.map(s => `<option>${s}</option>`).join('')}</select>` : ''}<input type="search" data-fq placeholder="구역명·동 찾기" aria-label="구역명·동 찾기"><b class="fn" data-fn>${list.length}곳</b></span></div>` : '';
  const th = (t, s, cls = '') => `<th${cls ? ` class="${cls}"` : ''}${s ? ` data-s="${s}"` : ''}>${t}</th>`;
  return `${flt}<div class="tw"><table class="zt${withSi ? ' wg' : ''}"><thead><tr>${th('구역', 'n')}${withSi ? th('구', 'gu') : ''}${th('종류', 'k')}${th('추진 단계', 'st', sortKey === 'st' ? 'on' : '')}${th('진행', '')}${th('단계일', 'sd', sortKey === 'sd' ? 'on dn' : '')}${th('위치', 'a')}${th('세대', 'hh', 'n')}${th('용적률', 'far', 'n')}${th('면적(평)', 'ar', 'n')}${th('', '')}</tr></thead><tbody>
${L.map(r => `<tr ${zattr(r)} data-k="${esc(r.k)}" data-g="${stageOf(r.st).g}" data-q="${esc(`${r.title} ${r.addr} ${r.si}`)}"><td class="c-n" data-v="${esc(r.title)}"><a href="${zoneUrl(r)}">${esc(r.title)}</a></td>${withSi ? `<td class="c-gu" data-v="${esc(r.si)}"><a href="/incheon/${r.slug}.html">${esc(r.si)}</a></td>` : ''}<td class="c-k" data-v="${esc(r.k)}">${kshort(r.k)}</td><td class="c-st" data-v="${rk2(r)}">${pill(r)}</td><td class="c-p">${mini(r)}</td><td class="c-d" data-v="${esc(r.sd || '')}">${esc(ym(r.sd))}</td><td class="c-a" data-v="${esc(r.addr)}">${esc(r.dong || '-')}</td><td class="c-h n" data-v="${r.hh || 0}">${r.hh ? num(r.hh) : '-'}</td><td class="c-f n" data-v="${r.far || 0}">${r.far ? Math.round(r.far) + '%' : '-'}</td><td class="c-ar n" data-v="${r.ar || 0}">${r.ar ? py(r.ar) : '-'}</td><td class="c-ac">${zicon()}${mapUrl(r) ? `<a class="zm" href="${mapUrl(r)}">지도</a>` : ''}</td></tr>`).join('\n')}
</tbody></table></div><p class="tn">☆ 관심 구역에 담기 (회원 전용) · 머리글을 누르면 정렬이 바뀝니다.</p>`;
}
const stageLegend = list => { const c = gcount(list); return `${sbar(list)}<ul class="lg">${GROUP.map((g, i) => `<li><i style="background:${GCOLOR[i]}"></i>${g} <b>${c[i]}</b></li>`).join('')}</ul>`; };
const zlist = (L, sub) => `<ul class="zl">${L.map(r => `<li><a href="${zoneUrl(r)}">${esc(r.title)}</a>${pill(r)}<small>${sub(r)}</small></li>`).join('')}</ul>`;
const themeLinks = (exclude = '') => `<section class="pn"><h2>다른 방법으로 보기</h2><div class="tls">${TG.map(g => `<div><b>${g}</b>${THEMES.filter(t => t.g === g && t.list.length && t.slug !== exclude).map(t => `<a href="${themeUrl(t)}">${esc(t.short)} <small>${t.list.length}</small></a>`).join('')}</div>`).join('')}</div></section>`;
const STAGE_FAQ = [
  ['인천 재개발·재건축은 어떤 순서로 진행되나요?', '일반적으로 정비예정구역(기본계획) → 정비구역 지정 → 조합설립추진위원회 → 조합설립인가 → 사업시행계획인가 → 관리처분계획인가 → 이주·철거 → 착공 → 준공 → 이전고시·청산 순서로 진행됩니다.'],
  ['인천 정비사업 자료는 어디서 오나요?', '국토교통부가 공공데이터포털에 공개하는 「전국 도시정비사업 통합 데이터」의 인천 구역을 정리했습니다. 구역명, 사업 종류, 현재 추진 단계, 공급 예정 세대수, 사업시행자가 들어 있고, 리얼맵이 분기마다 다시 받아 갱신합니다.'],
  ['조합설립인가 이후에 사면 조합원이 될 수 있나요?', '투기과열지구에서는 재건축은 조합설립인가 후, 재개발은 관리처분계획인가 후부터 조합원 지위 양도가 원칙적으로 제한되며 예외 요건이 있습니다. 규제 지역 지정 여부는 시기마다 바뀌니 계약 전에 구청과 조합에 꼭 확인해 주세요.'],
];

await rm('incheon', { recursive: true, force: true });
await mkdir('incheon/t', { recursive: true });
const urls = [];

// ---------- 구역 페이지 ----------
const MIXL = ['40㎡ 이하', '40~60㎡', '60~85㎡', '85~135㎡', '135㎡ 초과'];
for (const [si, list] of bySi) {
  await mkdir(`incheon/${SLUG[si]}`, { recursive: true });
  for (const r of list) {
    const K = kindOf(r.k), S = stageOf(r.st, r.k), { steps, done } = track(r);
    const facts = [
      ['사업 구분', r.k],
      ['추진 단계', `${r.st}${r.sd ? ` · ${kdate(r.sd)}` : ''}`],
      ['위치', `${r.place} 일대`],
      ['구역 면적', r.ar ? `${num(r.ar)}㎡ (약 ${py(r.ar)}평)` : ''],
      ['사업시행자', r.impl && r.impl !== '미정' ? r.impl : ''],
      ['계획 세대수', r.hh ? `${num(r.hh)}세대${r.sale || r.rent ? ` (분양 ${num(r.sale)} · 임대 ${num(r.rent)})` : ''}` : ''],
      ['분양 나눔', r.memSale || r.genSale ? `조합원 ${num(r.memSale)} · 일반 ${num(r.genSale)}` : ''],
      ['조합원 수', r.mem ? `${num(r.mem)}명` : ''],
      ['토지등소유자', r.owners ? `${num(r.owners)}명` : ''],
      ['기존 주택', r.oldHH ? `${num(r.oldHH)}세대${r.oldDong ? ` · ${num(r.oldDong)}동` : ''}${r.oldYear ? ` · ${r.oldYear}${/\d$/.test(r.oldYear) ? '년' : ''} 준공` : ''}` : ''],
      ['용적률', r.far ? (r.oldFar ? `${num(r.oldFar)}% → ${num(r.far, r.far % 1 ? 2 : 0)}%` : `${num(r.far, r.far % 1 ? 2 : 0)}%`) : ''],
      ['건폐율', r.bcr ? `${num(r.bcr, 2)}%` : ''],
      ['건축 계획', r.dongs || ''],
      ['사업 기간(예정)', r.period ? r.period.replace('~', ' ~ ') + '년' : ''],
    ].filter(x => x[1]);
    const half = Math.ceil(facts.length / 2);
    const curK = CUR_KEY[r.st];
    const dl = DLABEL.filter(([k]) => r.dates && r.dates[k]);
    const timeline = dl.length ? `<section class="pn"><h2>단계별 일자</h2><ul class="tl">${dl.map(([k, l]) => `<li class="${k === curK ? 'cur' : ''}"><b>${l}</b><span>${esc(r.dates[k])}</span></li>`).join('')}</ul><p class="tn">시·군이 입력한 날짜라 일부 단계는 비어 있거나 늦게 반영될 수 있습니다.</p></section>` : '';
    const mix = r.mix ? `<section class="pn"><h2>신축 평형 구성 <small>전용면적 기준</small></h2><div class="tw"><table class="zt gtb mx"><thead><tr><th></th>${MIXL.map(l => `<th class="n">${l}</th>`).join('')}<th class="n">합계</th></tr></thead><tbody>
<tr><td><b>분양</b></td>${r.mix.s.map(v => `<td class="n">${v ? num(v) : '-'}</td>`).join('')}<td class="n"><b>${num(r.mix.s.reduce((a, b) => a + b, 0))}</b></td></tr>
${r.mix.r.some(Boolean) ? `<tr><td><b>임대</b></td>${[...r.mix.r, 0, 0].map(v => `<td class="n">${v ? num(v) : '-'}</td>`).join('')}<td class="n"><b>${num(r.mix.r.reduce((a, b) => a + b, 0))}</b></td></tr>` : ''}
${r.oldMix ? `<tr class="old"><td>기존 세대</td>${r.oldMix.map(v => `<td class="n">${v ? num(v) : '-'}</td>`).join('')}<td class="n">${num(r.oldMix.reduce((a, b) => a + b, 0))}</td></tr>` : ''}
</tbody></table></div><p class="tn">59㎡형은 '40~60㎡', 84㎡형은 '60~85㎡' 칸에 들어갑니다.</p></section>` : '';
    const s1 = `${esc(r.title)} 정비사업은 ${esc(r.place)} 일대에서 추진되는 ${esc(r.k)} 사업입니다.`;
    const s2 = r.st ? ` ${r.sd ? `${kdate(r.sd)} 기준 ` : '현재 '}<b>${esc(r.st)}</b> 단계에 있습니다.` : '';
    const s3 = r.hh ? ` 계획 세대수는 <b>${num(r.hh)}세대</b>${r.mem ? `, 조합원은 ${num(r.mem)}명` : ''}입니다.` : '';
    const near = r.lat ? rows.filter(o => o !== r && o.lat && LIVE(o)).sort((a, b) => dist(a, r) - dist(b, r)).slice(0, 8) : list.filter(o => o !== r && o.dong && o.dong === r.dong).slice(0, 8);
    const myThemes = THEMES.filter(t => t.g !== '권역' && t.f(r));
    const faq = [
      [`${r.title} 정비사업은 지금 어느 단계인가요?`, `국토교통부 전국 도시정비사업 통합 데이터(${updK} 받음)에 따르면 ${r.sd ? kdate(r.sd) + ' ' : ''}${r.st} 단계입니다. ${S.d}`],
      ...(r.hh ? [[`${r.title} 정비사업은 몇 세대로 지어지나요?`, `계획상 ${num(r.hh)}세대${r.sale ? `(분양 ${num(r.sale)}, 임대 ${num(r.rent)})` : ''} 규모입니다. 계획은 인가 과정에서 바뀔 수 있습니다.`]] : []),
      ...(S.n ? [['다음 단계는 무엇인가요?', S.n]] : []),
    ];
    const body = `<p class="intro">${s1}${s2}${s3}</p>
<div class="g2"><div class="gm">
<section class="pn"><h2>추진 단계 <small>${r.sd ? esc(kdate(r.sd)) : ''}</small></h2>
<ol class="track">${steps.map((s, i) => `<li class="${done[i] ? 'on' : ''}${done[i] && !done[i + 1] ? ' cur' : ''}"><i></i><span>${esc(SHORT[s] || s)}</span></li>`).join('')}</ol>
${S.d ? `<p class="now"><b>지금 · ${esc(r.st)}</b> ${esc(S.d)}</p>` : ''}${S.n ? `<p class="next"><b>다음 단계</b> ${esc(S.n)}</p>` : ''}</section>
${timeline}
<section class="pn"><h2>사업 개요</h2><div class="fx"><dl>${facts.slice(0, half).map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('')}</dl><dl>${facts.slice(half).map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('')}</dl></div>
${K.d ? `<p class="kn">${kchip(r.k)} ${esc(K.d)}</p>` : ''}</section>
${mix}
</div><aside class="gs">
<section class="pn act" ${zattr(r)}><h2>이 구역</h2>${mapUrl(r) ? `<a class="cta" href="${mapUrl(r)}">리얼맵 지도에서 보기</a>` : ''}<div class="two one"><button type="button" class="zb" data-act="fav" aria-pressed="false">☆ 관심 구역</button></div><p class="tn">관심 구역은 회원 전용입니다.</p></section>
${near.length ? `<section class="pn"><h2>가까운 정비사업</h2>${zlist(near, o => `${o.si !== r.si ? esc(o.si) + ' · ' : ''}${o.hh ? num(o.hh) + '세대' : esc(o.k)}`)}</section>` : ''}
<section class="pn"><h2>함께 보기</h2><div class="lk"><a href="/incheon/${r.slug}.html">인천 ${esc(si)} 정비사업 ${list.length}곳 ›</a>${myThemes.map(t => `<a href="${themeUrl(t)}">인천 ${esc(t.name)} ${t.list.length}곳 ›</a>`).join('')}<a href="/incheon/">인천 전체 ${rows.length}곳 ›</a></div></section>
</aside></div>`;
    const zrow = { id: r.id, sido: '28', n: r.title, gu: si, si, a: r.dong || '', ar: r.ar || 0, hh: r.hh || 0, sale: r.sale || 0, rent: r.rent || 0, mem: r.mem || 0, mix: r.mix || null, st: r.st, far: r.far || 0, bcode: r.bcode || '', lat: r.lat || 0, lng: r.lng || 0, ring: r.ring || null, late: ['관리처분', '착공', '준공', '청산'].includes(r.st) };
    const desc = `인천 ${r.siteAddr} ${r.title} ${r.k} 정비사업. 추진 단계 ${r.st}${r.sd ? `(${ym(r.sd)})` : ''}${r.hh ? `, 계획 ${num(r.hh)}세대` : ''}${r.mem ? `, 조합원 ${num(r.mem)}명` : ''}. 위치·가까운 정비사업·예상 분담금까지 정리했습니다.`.slice(0, 150);
    await writeFile(`incheon/${r.slug}/${r.id}.html`, page({
      path: zoneUrl(r), title: `인천 ${r.title} ${r.k} 추진 단계·계획 세대수 (${si} ${r.dong || ''}) | 리얼맵`.replace(/\s+\)/, ')'), desc,
      h1: `${esc(r.title)} ${kchip(r.k)} ${pill(r)}`, sub: esc(r.place) + ' 일대',
      crumbs: [['리얼맵', '/'], ['인천 정비사업', '/incheon/'], [si, `/incheon/${r.slug}.html`], [r.title, zoneUrl(r)]], body, faq, cur: 'si', zrow,
    }));
    urls.push([zoneUrl(r), 0.6]);
  }

  // ---------- 구별 페이지 ----------
  const kc = kindsIn(list);
  const big = list.filter(r => r.hh && LIVE(r)).sort((a, b) => b.hh - a.hh)[0];
  const going = list.filter(r => [2, 3].includes(stageOf(r.st).g)).length;
  const recent = list.filter(r => r.sd && r.sd >= oneYear && LIVE(r)).sort((a, b) => b.sd.localeCompare(a.sd)).slice(0, 8);
  const hhSum = list.filter(LIVE).reduce((s, r) => s + (r.hh || 0), 0);
  const intro = `${si}에는 <b>${list.length}곳</b>의 정비사업이 있습니다. ${kc.map(([k, c]) => `${k} ${c}곳`).join(', ')}입니다.`
    + (going ? ` 이 중 조합설립부터 공사 단계까지 본격적으로 진행 중인 곳이 ${going}곳입니다.` : '')
    + (big ? ` 진행 중인 사업 가운데 계획 세대수가 가장 많은 곳은 <a href="${zoneUrl(big)}">${esc(big.title)}</a>(${num(big.hh)}세대)입니다.` : '')
    + (hhSum ? ` 진행 중인 사업만 합쳐도 약 ${num(Math.round(hhSum / 100) * 100)}세대가 계획되어 있습니다.` : '');
  const gt = THEMES.filter(t => t.g !== '권역').map(t => [t, list.filter(t.f).length]).filter(x => x[1]);
  const body = `<p class="intro">${intro}</p>
${kpis(list, [['진행 중 계획 세대', hhSum ? (hhSum >= 10000 ? `${num(Math.round(hhSum / 1000) / 10, 1)}만` : num(hhSum)) : '-']])}
<div class="g2"><div class="gm"><section class="pn"><h2>정비구역 목록 <small>초기 단계부터 · ${list.length}곳</small></h2>${ztable(list)}</section></div>
<aside class="gs">
<section class="pn"><h2>단계 분포</h2>${stageLegend(list)}</section>
${recent.length ? `<section class="pn"><h2>최근 1년 단계 진행 <small>${recent.length}곳</small></h2>${zlist(recent, r => esc(ym(r.sd)))}</section>` : ''}
${gt.length ? `<section class="pn"><h2>${esc(si)} 테마별</h2><div class="lk">${gt.map(([t, n]) => `<a href="${themeUrl(t)}">${esc(t.short)} <small>${si} ${n}곳 · 인천 ${t.list.length}곳</small></a>`).join('')}</div></section>` : ''}
<section class="pn"><h2>다른 구</h2><p class="gus">${SIS.map(s => s === si ? `<b>${s}</b>` : `<a href="/incheon/${SLUG[s]}.html">${s}</a>`).join('')}</p></section>
</aside></div>`;
  await writeFile(`incheon/${SLUG[si]}.html`, page({
    path: `/incheon/${SLUG[si]}.html`, title: `인천 ${si} 재개발·재건축 정비사업 현황 ${list.length}곳 — 추진 단계·세대수 (${ym(ymdUpd)}) | 리얼맵`,
    desc: `인천 ${si} 재개발·재건축 정비사업 ${list.length}곳의 추진 단계, 계획 세대수, 조합원 수, 위치를 한눈에. ${kc.slice(0, 3).map(([k, c]) => `${k} ${c}곳`).join(', ')}. ${updK} 기준.`,
    h1: `인천 ${si} 재개발·재건축 정비사업 현황`, sub: `${esc(updK)} 기준 · 국토교통부 전국 도시정비사업 통합 데이터`,
    crumbs: [['리얼맵', '/'], ['인천 정비사업', '/incheon/'], [si, `/incheon/${SLUG[si]}.html`]], body, faq: STAGE_FAQ, cur: 'si',
  }));
  urls.push([`/incheon/${SLUG[si]}.html`, 0.8]);
}

// ---------- 테마 페이지 ----------
for (const t of THEMES) {
  const list = t.list; if (!list.length) continue;
  const byS = SIS.map(s => [s, list.filter(r => r.si === s).length]).filter(x => x[1]).sort((a, b) => b[1] - a[1]);
  const hhSum = list.reduce((s, r) => s + (r.hh || 0), 0), mx = byS.length ? byS[0][1] : 1;
  const top = list.filter(r => r.hh).sort((a, b) => b.hh - a.hh).slice(0, 8);
  const body = `<p class="intro">${esc(t.d)} 인천 전체 <b>${list.length}곳</b>${hhSum ? `, 계획 세대수는 합쳐서 약 ${num(Math.round(hhSum / 100) * 100)}세대` : ''}입니다.</p>
${kpis(list, [['계획 세대', hhSum ? (hhSum >= 10000 ? `${num(Math.round(hhSum / 1000) / 10, 1)}만` : num(hhSum)) : '-']])}
<div class="g2"><div class="gm"><section class="pn"><h2>${esc(t.name)} <small>${t.sort === 'sd' ? '최근 바뀐 순' : '초기 단계부터'} · ${list.length}곳</small></h2>${ztable(list, { withSi: true, sortKey: t.sort || 'st' })}</section></div>
<aside class="gs">
<section class="pn"><h2>구별 분포</h2><ul class="gb">${byS.map(([s, n]) => `<li><a href="/incheon/${SLUG[s]}.html">${s}</a><i style="width:${(n / mx * 100).toFixed(0)}%"></i><b>${n}</b></li>`).join('')}</ul></section>
<section class="pn"><h2>단계 분포</h2>${stageLegend(list)}</section>
${top.length && t.slug !== 'big' && t.slug !== 'mega' ? `<section class="pn"><h2>세대수 많은 곳</h2>${zlist(top, r => `${esc(r.si)} · ${num(r.hh)}세대`)}</section>` : ''}
</aside></div>
${themeLinks(t.slug)}`;
  await writeFile(`incheon/t/${t.slug}.html`, page({
    path: themeUrl(t), title: `인천 ${t.name} ${list.length}곳 — 구별·추진 단계 (${ym(ymdUpd)}) | 리얼맵`,
    desc: `인천 ${t.name} ${list.length}곳을 구별·추진 단계별로 정리했습니다. 계획 세대수, 용적률, 위치까지 한 표로. ${updK} 기준.`.slice(0, 150),
    h1: `인천 ${esc(t.name)}`, sub: `${esc(t.g)}별로 보기 · ${esc(updK)} 기준`,
    crumbs: [['리얼맵', '/'], ['인천 정비사업', '/incheon/'], [t.short, themeUrl(t)]], body, faq: STAGE_FAQ.slice(0, 2), cur: t.slug,
  }));
  urls.push([themeUrl(t), 0.7]);
}

// ---------- 인천 전체 페이지 ----------
{
  const live = rows.filter(LIVE);
  const kc = kindsIn(rows);
  const recent = live.filter(r => r.sd).sort((a, b) => b.sd.localeCompare(a.sd)).slice(0, 10);
  const top = live.filter(r => r.hh).sort((a, b) => b.hh - a.hh).slice(0, 10);
  const hhLive = live.reduce((s, r) => s + (r.hh || 0), 0);
  const stab = SIS.map(s => { const l = bySi.get(s); return { s, l, n: l.length, c: gcount(l), re: l.filter(r => r.k === '재개발').length, rb: l.filter(r => r.k === '재건축').length, sm: l.filter(r => SMALL(r.k)).length, big: l.filter(r => r.hh >= 1000 && LIVE(r)).length, hh: l.filter(LIVE).reduce((a, r) => a + (r.hh || 0), 0) }; });
  const body = `<p class="intro">인천 ${SIS.length}개 구의 재개발·재건축·주거환경개선 정비사업 <b>${rows.length}곳</b>을 구별·테마별로 정리했습니다. 국토교통부 전국 도시정비사업 통합 데이터에 올라온 인천 구역이며, 진행 중인 곳이 <b>${live.length}곳</b>입니다.</p>
${kpis(rows, [['진행 중 계획 세대', `${num(Math.round(hhLive / 10000))}만`]])}
<section class="pn mine" data-myzones hidden><h2 class="my-hi">관심 구역</h2><p class="my-mail tn"></p><ul class="my-list"></ul></section>
<section class="pn"><h2>구별로 보기</h2><div class="sg">${stab.slice().sort((a, b) => b.n - a.n).map(x => `<a href="/incheon/${SLUG[x.s]}.html"><span>${x.s}</span><em>${x.n}</em>${sbar(x.l)}</a>`).join('')}</div></section>
<section class="pn"><h2>테마별로 보기</h2><div class="tcards">${TG.map(g => `<div class="tg"><b>${g}</b>${THEMES.filter(t => t.g === g && t.list.length).map(t => `<a href="${themeUrl(t)}"><span>${esc(t.short)}</span><em>${num(t.list.length)}</em>${sbar(t.list)}</a>`).join('')}</div>`).join('')}</div></section>
<div class="g2"><div class="gm">
<section class="pn"><h2>구별 정비사업 <small>구 이름을 누르면 구역별 표</small></h2><div class="tw"><table class="zt gtb"><thead><tr><th data-s="gu">구</th><th data-s="n" class="n on dn">전체</th><th>추진 단계 분포</th>${GROUP.map((g, i) => `<th data-s="g${i}" class="n" title="${g}"><i class="dot" style="background:${GCOLOR[i]}"></i>${g.split('·')[0]}</th>`).join('')}<th class="n">재개발</th><th class="n">재건축</th><th class="n">대단지</th><th class="n">진행 중 세대</th></tr></thead><tbody>
${stab.sort((a, b) => b.n - a.n).map(x => `<tr><td data-v="${x.s}"><a href="/incheon/${SLUG[x.s]}.html"><b>${x.s}</b></a></td><td class="n" data-v="${x.n}"><b>${x.n}</b></td><td>${sbar(x.l)}</td>${x.c.map(c => `<td class="n" data-v="${c}">${c || '-'}</td>`).join('')}<td class="n" data-v="${x.re}">${x.re || '-'}</td><td class="n" data-v="${x.rb}">${x.rb || '-'}</td><td class="n" data-v="${x.big}">${x.big || '-'}</td><td class="n" data-v="${x.hh}">${x.hh ? num(x.hh) : '-'}</td></tr>`).join('\n')}
</tbody></table></div><p class="tn">${kc.map(([k, c]) => `${k} ${c}곳`).join(' · ')}. 대단지는 계획 1,000세대 이상(진행 중).</p></section>
<section class="pn"><h2>단계별 뜻</h2><dl class="dfn">${['예정구역', '정비구역', '추진위원회', '조합설립', '사업시행', '관리처분', '착공', '청산'].map(s => `<dt>${pill({ st: s })}</dt><dd>${esc(STAGE[s].d)}</dd>`).join('')}</dl></section>
</div><aside class="gs">
<section class="pn"><h2>단계 분포</h2>${stageLegend(rows)}</section>
${recent.length ? `<section class="pn"><h2>최근 단계가 진행된 곳</h2>${zlist(recent, r => `${esc(r.si)} · ${esc(ym(r.sd))}`)}</section>` : ''}
<section class="pn"><h2>계획 세대수가 많은 곳</h2><ol class="rank">${top.map(r => `<li><span><a href="${zoneUrl(r)}">${esc(r.title)}</a><b>${num(r.hh)}세대</b><small>${esc(r.si)} · ${esc(r.st)}</small></span></li>`).join('')}</ol><p class="more"><a href="/incheon/t/big.html">대단지 전체 ›</a></p></section>
</aside></div>`;
  await writeFile('incheon/index.html', page({
    path: '/incheon/', title: `인천 재개발·재건축 정비사업 현황 ${rows.length}곳 — 구별·테마별 추진 단계 (${ym(ymdUpd)}) | 리얼맵`,
    desc: `인천 ${SIS.length}개 구 재개발·재건축·주거환경개선 정비사업 ${rows.length}곳의 추진 단계, 계획 세대수, 위치를 구별·단계별로 정리했습니다. ${updK} 기준, 분기마다 자동 갱신.`,
    h1: '인천 재개발·재건축 정비사업 현황', sub: `${esc(updK)} 기준 · 국토교통부 전국 도시정비사업 통합 데이터 · 분기마다 자동 갱신`,
    crumbs: [['리얼맵', '/'], ['인천 정비사업', '/incheon/']], body, faq: STAGE_FAQ, cur: 'idx',
  }));
  urls.unshift(['/incheon/', 0.9]);
}

// ---------- 사이트맵 (서울·경기와 따로 · robots.txt에 등록) ----------
await writeFile('sitemap-ic.xml', `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(([u, p]) => `  <url><loc>${SITE}${u}</loc><lastmod>${UPDATED}</lastmod><priority>${p.toFixed(1)}</priority></url>`).join('\n')}
</urlset>
`);
try {
  const rb = await readFile('robots.txt', 'utf8');
  if (!rb.includes('sitemap-ic.xml')) await writeFile('robots.txt', rb.trimEnd() + `\nSitemap: ${SITE}/sitemap-ic.xml\n`);
} catch { /* robots 없음 */ }
console.log(`인천 정비사업 페이지 ${urls.length}개`);
