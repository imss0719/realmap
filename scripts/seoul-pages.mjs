// 서울 재개발·재건축 정비사업 현황 페이지 만들기 (검색 노출용, GitHub Actions에서 seoul-zones.mjs 다음에 실행)
// 입력: data/seoul-zones.json(화면용) · data/seoul-raw/vnBsnsNmtn.json(원본) · data/jeongbi-seoul.json(국토부 경계)
// 출력: seoul/index.html · seoul/<구>.html · seoul/<구>/<사업번호>.html · seoul/t/<테마>.html(10/28) · seoul/seoul.css · sitemap.xml
import { readFile, writeFile, mkdir, rm, copyFile } from 'node:fs/promises';

const SITE = 'https://realmap.online';
const readJson = async f => JSON.parse(await readFile(f, 'utf8'));
const sz = await readJson('data/seoul-zones.json');
const raw = new Map(((await readJson('data/seoul-raw/vnBsnsNmtn.json')).rows || []).map(r => [r.BASIC_INFO_SEQ, r]));
const JBF = (await readJson('data/jeongbi-seoul.json')).features || [];
const jb = new Map(JBF.map(f => [f.properties.id, f.properties]));
// 10/30 구역 페이지에 그 구역 자료만 넣음 (예전: 화면이 서울 전체 구역 266KB + 경계 1MB를 통째로 받아서 골라 씀) — 경기 페이지와 같은 방식
const JBG = new Map(JBF.map(f => [f.properties.id, f.geometry]));
const thinR = R => { const step = Math.max(1, Math.ceil(R.length / 160)); return R.filter((_, i) => i % step === 0 || i === R.length - 1).map(([x, y]) => [+(+x).toFixed(6), +(+y).toFixed(6)]); };
const ringsOf = ids => (ids || []).flatMap(id => { const g = JBG.get(id) || {}; return (g.type === 'MultiPolygon' ? g.coordinates : g.type === 'Polygon' ? [g.coordinates] : []).filter(p => p && p[0]).map(p => thinR(p[0])); });
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


// ==================== 10/28 촘촘한 화면으로 개편 ====================
// 모든 페이지: 위 남색 줄(리얼맵 · 위치 · 기준일 · 지도) + '보는 방법' 줄(구별 · 대단지 · 단계별 · 최근 진행 · 고층 · 권역 · 사업 종류)
// 목록은 카드 대신 표 한 장 (종류·단계 거르기 · 찾기 · 머리글 정렬은 seoul.js) — JS가 없어도 표는 그대로 보임(검색 노출)
// 기본 순서 = 초기 단계부터 (대상지선정 → 준공), 같은 단계 안에서는 세대수 많은 순 (선배 결정)
const kindCount = list => Object.keys(KIND).map(k => [k, list.filter(r => r.k === k).length]).filter(x => x[1]);
const LOGO = `<svg width="26" height="26" viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" rx="14" fill="#F2B705"/><g transform="translate(6.4 9) scale(0.72)"><g fill="#14212E"><path d="M10 2H22V17.5L10 19Z"/><path d="M10 21 22 19.5V40L10 41.5Z"/><path d="M10 43.5 22 42V62H10Z"/><path d="M24 2H40.5L40 13H24Z"/><path d="M42.5 2H48L54 8V25L42.5 26.3Z"/><path d="M24 29.6 33 28.8V38H24Z"/><path d="M31 40.5H44L51.5 50 39.5 51.5Z"/><path d="M41 53.5 53 52 61 62H47Z"/></g><path d="M35 28.6 54 27V30L47 38H35Z" fill="#fff"/></g></svg>`;
const rk2 = r => { const i = rank(r.st); return i < 0 ? 99 : i; };
const sortEarly = a => a.slice().sort((x, y) => rk2(x) - rk2(y) || (y.hh || 0) - (x.hh || 0) || x.n.localeCompare(y.n, 'ko'));
const oneYear = `${+UPDATED.slice(0, 4) - 1}${UPDATED.slice(4, 10).replace(/-/g, '.')}`;
const flTop = r => { const f = floors(r.fl); return f ? +f[1] : 0; };

// ---------- 테마 (보는 방법) ----------
const RGN = ['도심권', '동북권', '서북권', '서남권', '동남권'];
const RGN_SLUG = { '도심권': 'dosim', '동북권': 'dongbuk', '서북권': 'seobuk', '서남권': 'seonam', '동남권': 'dongnam' };
const RGN_GU = { '도심권': '종로구·중구·용산구', '동북권': '성동·광진·동대문·중랑·성북·강북·도봉·노원구', '서북권': '은평·서대문·마포구', '서남권': '양천·강서·구로·금천·영등포·동작·관악구', '동남권': '서초·강남·송파·강동구' };
const THEMES = [
  { g: '규모', slug: 'big', name: '대단지 (1,000세대 이상)', short: '대단지', f: r => r.hh >= 1000, d: '계획 세대수가 1,000세대 이상인 정비사업입니다. 단지 규모가 커서 커뮤니티 시설과 학교·상권 형성에 유리하고, 관심이 많이 모이는 곳들입니다.' },
  { g: '규모', slug: 'mega', name: '초대형 (3,000세대 이상)', short: '초대형', f: r => r.hh >= 3000, d: '계획 세대수가 3,000세대 이상인 초대형 정비사업입니다. 일대 주거지 모습을 크게 바꾸는 사업들입니다.' },
  { g: '규모', slug: 'tall', name: '고층 (지상 35층 이상)', short: '고층 35층+', f: r => flTop(r) >= 35, d: '계획 층수가 지상 35층 이상인 정비사업입니다. 서울시가 35층 높이 규제를 없앤 뒤 고층 계획이 늘고 있습니다.' },
  { g: '단계', slug: 'early', name: '막 시작한 곳 (대상지선정~구역지정)', short: '막 시작한 곳', f: r => rank(r.st) >= 0 && rank(r.st) <= rank('구역지정'), d: '신속통합기획 대상지선정·기획완료, 정비계획 수립, 정비구역 지정 단계에 있는 사업입니다. 사업 초기라 기간과 계획이 바뀔 여지가 크고, 그만큼 확인할 것도 많습니다.' },
  { g: '단계', slug: 'union', name: '조합설립 완료 (조합설립~사업시행인가)', short: '조합설립 완료', f: r => ['조합설립인가', '건축심의', '사업시행인가'].includes(r.st), d: '조합설립인가를 받아 조합이 사업 주체가 된 곳들입니다. 시공사 선정, 건축심의, 사업시행계획인가를 거쳐 관리처분으로 넘어갑니다. 투기과열지구 재건축은 조합설립인가 뒤 조합원 지위 양도가 원칙적으로 제한됩니다.' },
  { g: '단계', slug: 'move', name: '관리처분·이주 (관리처분계획인가)', short: '관리처분·이주', f: r => r.st === '관리처분계획인가', d: '조합원별 분양 주택과 분담금이 정해진 관리처분계획인가 단계입니다. 이주와 철거를 거쳐 착공으로 넘어갑니다.' },
  { g: '단계', slug: 'build', name: '공사 중 (착공)', short: '공사 중', f: r => ['착공', '준공(일부)'].includes(r.st), d: '이주·철거를 마치고 공사에 들어간 사업입니다. 입주 시기가 가까워진 곳들입니다.' },
  { g: '단계', slug: 'recent', name: '최근 1년 단계 진행', short: '최근 1년 진행', f: r => r.sd && r.sd >= oneYear && r.st !== '준공', sort: 'sd', d: '최근 1년 안에 추진 단계가 바뀐(새 단계로 들어선) 사업입니다. 사업이 활발하게 움직이는 곳을 볼 수 있습니다.' },
  ...RGN.map(g => ({ g: '권역', slug: RGN_SLUG[g], name: `${g} 정비사업`, short: g, f: r => r.rgn === g, d: `서울시 생활권 구분으로 ${g}(${RGN_GU[g]})에 있는 정비사업입니다.` })),
  { g: '종류', slug: 'redev', name: '재개발 (주택정비형)', short: '재개발', f: r => r.k === '재개발(주택정비형)', d: KIND['재개발(주택정비형)'].d },
  { g: '종류', slug: 'urban', name: '도시정비형 재개발', short: '도시정비형', f: r => r.k === '재개발(도시정비형)', d: KIND['재개발(도시정비형)'].d },
  { g: '종류', slug: 'rebuild', name: '재건축 (아파트·단독)', short: '재건축', f: r => /^재건축/.test(r.k), d: KIND['재건축(공동)'].d + ' 노후 단독주택지를 공동주택으로 짓는 단독주택 재건축도 함께 모았습니다.' },
  { g: '종류', slug: 'sintong', name: '신속통합기획', short: '신속통합기획', f: r => r.k === '신속통합기획', d: KIND['신속통합기획'].d },
  { g: '종류', slug: 'living', name: '주거환경개선사업', short: '주거환경개선', f: r => /^주거환경개선/.test(r.k), d: KIND['주거환경개선(관리형)'].d + ' 공공이 주도하는 정비형도 함께 모았습니다.' },
].map(t => ({ ...t, list: rows.filter(t.f) }));
const TG = ['규모', '단계', '권역', '종류'];
const themeUrl = t => `/seoul/t/${t.slug}.html`;
// 위쪽 '보는 방법' 줄
const viewNav = cur => `<nav class="vw" aria-label="보는 방법"><div class="vw-in">
  <a href="/seoul/"${cur === 'idx' ? ' aria-current="page"' : ''}>서울 전체</a><a href="/gyeonggi/">경기</a><a href="/incheon/">인천</a><span class="vs">구별</span>
  <details class="vd"><summary${cur === 'gu' ? ' class="on"' : ''}>25개 구 ▾</summary><div class="vdm">${GU_ORDER.filter(g => byGu.get(g).length).map(g => `<a href="/seoul/${GU[g]}.html">${g}<small>${byGu.get(g).length}</small></a>`).join('')}</div></details>
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
<script>document.documentElement.classList.add('js')</script>
<script src="/seoul/seoul.js?v=${UPDATED}" defer></script>
${zrow ? `<script type="application/json" id="zrow">${JSON.stringify(zrow).replace(/</g, '\\u003c')}</script>\n` : ''}${ld.map(x => `<script type="application/ld+json">${JSON.stringify(x).replace(/</g, '\\u003c')}</script>`).join('\n')}
</head><body>
<header class="top"><a class="brand" href="/">${LOGO}<b>리얼맵</b></a><nav class="crumb" aria-label="현재 위치">${crumbs.slice(1).map((c, i, a) => i < a.length - 1 ? `<a href="${c[1]}">${esc(c[0])}</a>` : `<span>${esc(c[0])}</span>`).join('<i>›</i>')}</nav>
<span class="sp"></span><span class="upd">${esc(ymdUpd)} 기준 · 분기 갱신</span><a class="mapbtn" href="/?from=seoul">지도에서 보기</a></header>
${viewNav(cur)}
<main>
<div class="ph"><h1>${h1}</h1>${sub ? `<p class="sub">${sub}</p>` : ''}</div>
${body}
${faq.length ? `<section class="pn faq"><h2>자주 묻는 질문</h2>${faq.map(([q, a]) => `<details><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join('')}</section>` : ''}
<p class="src">자료: 서울 열린데이터광장 「도시계획사업(서울플랜+) 정비사업 현황」(${esc(updK)} 받음), 국토교통부 정비구역 연속주제도. 리얼맵이 분기마다 자동으로 갱신합니다. 계획 수치와 추진 단계는 진행 중에 바뀔 수 있으니 계약 등 중요한 결정 전에는 구청이나 조합, <a href="https://cleanup.seoul.go.kr" target="_blank" rel="noopener">정비사업 정보몽땅</a>에서 꼭 확인해 주세요.</p>
</main>
<footer>리얼맵 · 운영 주식회사 드림인베스트 · 문의 contact@realmap.online · <a href="/guide.html">이용 안내</a> · <a href="/privacy.html">개인정보처리방침</a></footer>
</body></html>
`;
}
// ---------- 조각 ----------
const pill = r => `<span class="st g${stageOf(r.st).g}">${esc(r.st || '단계 미상')}</span>`;
const kchip = k => { const K = kindOf(k); return `<span class="kd" style="--c:${K.c}">${esc(K.s)}</span>`; };
const KSHORT = { '재개발(주택정비형)': '재개발', '재개발(도시정비형)': '도시정비형', '재건축(공동)': '재건축', '재건축(단독)': '단독 재건축', '신속통합기획': '신통기획', '주거환경개선(관리형)': '주거환경(관리)', '주거환경개선(정비형)': '주거환경(정비)' };
const kshort = k => `<span class="kd" style="--c:${kindOf(k).c}">${esc(KSHORT[k] || kindOf(k).s)}</span>`;
function mini(r) { const { done } = track(r); return `<span class="mini" aria-hidden="true">${done.map(d => `<i${d ? ' class="on"' : ''}></i>`).join('')}</span>`; }
const zattr = r => `data-z data-id="${r.id}" data-n="${esc(r.title)}" data-gu="${esc(r.gu)}" data-st="${esc(r.st || '')}"`;
const zbtns = () => `<button type="button" class="zb" data-act="fav" aria-pressed="false">☆ 관심 구역</button><button type="button" class="zb" data-act="alert" aria-pressed="false">🔔 추진 알림 받기</button>`;
const zicons = () => `<button type="button" class="zi" data-act="fav" aria-pressed="false" title="관심 구역에 담기" aria-label="관심 구역에 담기">☆</button><button type="button" class="zi" data-act="alert" aria-pressed="false" title="추진 알림 받기" aria-label="추진 알림 받기">🔔</button>`;
const sbar = list => { const cnt = GROUP.map((_, g) => list.filter(r => stageOf(r.st).g === g).length), tot = list.length || 1; return `<span class="sbar" role="img" aria-label="${GROUP.map((g, i) => `${g} ${cnt[i]}곳`).join(', ')}">${cnt.map((c, i) => c ? `<i style="width:${(c / tot * 100).toFixed(1)}%;background:${GCOLOR[i]}"></i>` : '').join('')}</span>`; };
const gcount = list => GROUP.map((_, g) => list.filter(r => stageOf(r.st).g === g).length);
const kpis = (list, extra = []) => { const c = gcount(list); return `<div class="kp"><div><small>전체</small><b>${num(list.length)}</b><span>곳</span></div>${GROUP.map((g, i) => `<div><small><i style="background:${GCOLOR[i]}"></i>${g}</small><b>${num(c[i])}</b></div>`).join('')}${extra.map(([t, v]) => `<div><small>${t}</small><b>${v}</b></div>`).join('')}</div>`; };
// 정비구역 표 (구 페이지 · 테마 페이지 공통). withGu: 구 칸 넣기 · sortKey: 기본 정렬
function ztable(list, { withGu = false, sortKey = 'st' } = {}) {
  const L = sortKey === 'sd' ? list.slice().sort((a, b) => String(b.sd || '').localeCompare(String(a.sd || '')) || rk2(a) - rk2(b)) : sortEarly(list);
  const kinds = Object.keys(KIND).map(k => [k, list.filter(r => r.k === k).length]).filter(x => x[1]);
  const gc = gcount(list), gus = withGu ? GU_ORDER.filter(g => list.some(r => r.gu === g)) : [];
  const flt = list.length > 6 ? `<div class="flt" data-flt>
    <span class="fg"><button type="button" class="on" data-fk="">종류 전체</button>${kinds.map(([k, c]) => `<button type="button" data-fk="${esc(k)}">${esc(KSHORT[k] || k)} ${c}</button>`).join('')}</span>
    <span class="fg"><button type="button" class="on" data-fs="">단계 전체</button>${GROUP.map((g, i) => gc[i] ? `<button type="button" data-fs="${i}"><i style="background:${GCOLOR[i]}"></i>${g} ${gc[i]}</button>` : '').join('')}</span>
    <span class="fr">${withGu && gus.length > 1 ? `<select data-fgu aria-label="구 고르기"><option value="">모든 구</option>${gus.map(g => `<option>${g}</option>`).join('')}</select>` : ''}<input type="search" data-fq placeholder="구역명·동 찾기" aria-label="구역명·동 찾기"><b class="fn" data-fn>${list.length}곳</b></span></div>` : '';
  const th = (t, s, cls = '') => `<th${cls ? ` class="${cls}"` : ''}${s ? ` data-s="${s}"` : ''}>${t}</th>`;
  return `${flt}<div class="tw"><table class="zt${withGu ? ' wg' : ''}"><thead><tr>${th('구역', 'n')}${withGu ? th('구', 'gu') : ''}${th('종류', 'k')}${th('추진 단계', 'st', sortKey === 'st' ? 'on' : '')}${th('진행', '')}${th('단계일', 'sd', sortKey === 'sd' ? 'on dn' : '')}${th('위치', 'a')}${th('세대', 'hh', 'n')}${th('층', 'fl', 'n')}${th('면적(평)', 'ar', 'n')}${th('', '')}</tr></thead><tbody>
${L.map(r => `<tr ${zattr(r)} data-k="${esc(r.k)}" data-g="${stageOf(r.st).g}" data-q="${esc(`${r.title} ${r.addr} ${r.gu}`)}"><td class="c-n" data-v="${esc(r.title)}"><a href="${zoneUrl(r)}">${esc(r.title)}</a></td>${withGu ? `<td class="c-gu" data-v="${esc(r.gu)}"><a href="/seoul/${r.slug}.html">${esc(r.gu)}</a></td>` : ''}<td class="c-k" data-v="${esc(r.k)}">${kshort(r.k)}</td><td class="c-st" data-v="${rk2(r)}">${pill(r)}</td><td class="c-p">${mini(r)}</td><td class="c-d" data-v="${esc(r.sd || '')}">${esc(ym(r.sd))}</td><td class="c-a" data-v="${esc(r.addr)}">${esc(r.addr)}</td><td class="c-h n" data-v="${r.hh || 0}">${r.hh ? num(r.hh) : '-'}</td><td class="c-f n" data-v="${flTop(r)}">${flTop(r) ? flTop(r) + '층' : '-'}</td><td class="c-ar n" data-v="${r.ar || 0}">${r.ar ? py(r.ar) : '-'}</td><td class="c-ac">${zicons()}${mapUrl(r) ? `<a class="zm" href="${mapUrl(r)}">지도</a>` : ''}</td></tr>`).join('\n')}
</tbody></table></div><p class="tn">☆ 관심 구역에 담기 · 🔔 추진 단계가 바뀌면 이메일 알림 (회원 전용) · 머리글을 누르면 정렬이 바뀝니다.</p>`;
}
const stageLegend = list => { const c = gcount(list); return `${sbar(list)}<ul class="lg">${GROUP.map((g, i) => `<li><i style="background:${GCOLOR[i]}"></i>${g} <b>${c[i]}</b></li>`).join('')}</ul>`; };
const zlist = (L, sub) => `<ul class="zl">${L.map(r => `<li><a href="${zoneUrl(r)}">${esc(r.title)}</a>${pill(r)}<small>${sub(r)}</small></li>`).join('')}</ul>`;
const themeLinks = (exclude = '') => `<section class="pn"><h2>다른 방법으로 보기</h2><div class="tls">${TG.map(g => `<div><b>${g}</b>${THEMES.filter(t => t.g === g && t.list.length && t.slug !== exclude).map(t => `<a href="${themeUrl(t)}">${esc(t.short)} <small>${t.list.length}</small></a>`).join('')}</div>`).join('')}</div></section>`;
const STAGE_FAQ = [
  ['재개발·재건축은 보통 어떤 순서로 진행되나요?', '일반적으로 정비계획 수립 → 정비구역 지정 → 조합설립추진위원회 → 조합설립인가 → 사업시행계획인가 → 관리처분계획인가 → 이주·철거 → 착공 → 준공 순서로 진행됩니다. 신속통합기획 대상지는 그 앞에 서울시의 기획 단계가 더해집니다.'],
  ['신속통합기획은 무엇인가요?', '서울시가 정비계획 수립 단계부터 공공성과 사업성을 함께 검토한 기획안을 제시해, 정비구역 지정까지 걸리는 기간을 줄이도록 지원하는 제도입니다. 기획이 끝나면 일반 재개발·재건축과 같은 절차를 밟습니다.'],
  ['조합설립인가 이후에 사면 조합원이 될 수 있나요?', '투기과열지구에서는 재건축은 조합설립인가 후, 재개발은 관리처분계획인가 후부터 조합원 지위 양도가 원칙적으로 제한되며 예외 요건이 있습니다. 지역과 시점에 따라 달라지므로 계약 전에 구청과 조합에 반드시 확인해 주세요.'],
  ['모아타운도 여기서 볼 수 있나요?', '모아타운(소규모주택정비 관리지역)은 이 목록에는 포함되지 않습니다. 리얼맵 지도에서 필지를 누르면 토지이용계획을 기준으로 모아타운·소규모정비 여부를 함께 표시해 드립니다.'],
];

await rm('seoul', { recursive: true, force: true });
await mkdir('seoul/t', { recursive: true });
const urls = [];

// ---------- 사업별 페이지 ----------
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
    const s1 = `${esc(r.title)} 정비사업은 서울특별시 ${esc(r.gu)} ${esc(r.addr)} 일대에서 추진되는 ${esc(K.s)} 사업입니다.`;
    const s2 = r.st ? ` ${r.sd ? `${kdate(r.sd)} 기준 ` : '현재 '}<b>${esc(r.st)}</b> 단계에 있습니다.` : '';
    const s3 = r.hh ? ` 계획상 ${fl ? `지하 ${fl[0]}층·지상 ${fl[1]}층, ` : ''}${num(r.hh)}세대 규모입니다.` : '';
    const near = r.lat ? rows.filter(o => o !== r && o.lat).sort((a, b) => dist(a, r) - dist(b, r)).slice(0, 8) : list.filter(o => o !== r && o.dong === r.dong).slice(0, 8);
    const myThemes = THEMES.filter(t => t.g !== '권역' && t.f(r));
    const faq = [
      [`${r.title} 정비사업은 지금 어느 단계인가요?`, r.st ? `서울시 정비사업 현황(${updK} 기준)에 따르면 ${r.sd ? kdate(r.sd) + ' ' : ''}${r.st} 단계입니다. ${S.d}` : '서울시 자료에 추진 단계가 등록되어 있지 않습니다. 구청에 확인해 주세요.'],
      ...(r.hh ? [[`${r.title} 정비사업은 몇 세대로 지어지나요?`, `계획상 ${num(r.hh)}세대${fl ? `, 지하 ${fl[0]}층·지상 ${fl[1]}층` : ''} 규모입니다. 계획은 인가 과정에서 바뀔 수 있습니다.`]] : []),
      ...(S.n ? [['다음 단계는 무엇인가요?', S.n]] : []),
    ];
    const half = Math.ceil(facts.length / 2);
    const body = `<p class="intro">${s1}${s2}${s3}</p>
<div class="g2"><div class="gm">
<section class="pn"><h2>추진 단계 <small>${r.sd ? esc(kdate(r.sd)) : ''}</small></h2>
<ol class="track">${steps.map((s, i) => `<li class="${done[i] ? 'on' : ''}${s === r.st || (done[i] && !done[i + 1]) ? ' cur' : ''}"><i></i><span>${esc(SHORT[s] || s)}</span></li>`).join('')}</ol>
${S.d ? `<p class="now"><b>지금 · ${esc(r.st)}</b> ${esc(S.d)}</p>` : ''}${S.n ? `<p class="next"><b>다음 단계</b> ${esc(S.n)}</p>` : ''}</section>
<section class="pn"><h2>사업 개요</h2><div class="fx"><dl>${facts.slice(0, half).map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('')}</dl><dl>${facts.slice(half).map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('')}</dl></div>
${K.d ? `<p class="kn">${kchip(r.k)} ${esc(K.d)}</p>` : ''}</section>
</div><aside class="gs">
<section class="pn act" ${zattr(r)}><h2>이 구역</h2>${mapUrl(r) ? `<a class="cta" href="${mapUrl(r)}">리얼맵 지도에서 보기</a>` : ''}${/^https:\/\/cleanup\.seoul\.go\.kr\//.test(r.url) ? `<a class="cta2" href="${esc(r.url)}" target="_blank" rel="noopener">조합 소식 (정비사업 정보몽땅)</a>` : ''}<div class="two">${zbtns()}</div><p class="tn">관심 구역은 회원 전용 · 추진 알림은 단계가 바뀌면 이메일로 보내 드립니다.</p></section>
${near.length ? `<section class="pn"><h2>가까운 정비사업</h2>${zlist(near, o => `${o.gu !== r.gu ? esc(o.gu) + ' · ' : ''}${o.hh ? num(o.hh) + '세대' : esc(kindOf(o.k).s)}`)}</section>` : ''}
<section class="pn"><h2>함께 보기</h2><div class="lk"><a href="/seoul/${r.slug}.html">${esc(r.gu)} 정비사업 ${list.length}곳 ›</a>${myThemes.map(t => `<a href="${themeUrl(t)}">${esc(t.name)} ${t.list.length}곳 ›</a>`).join('')}${r.rgn && RGN_SLUG[r.rgn] ? `<a href="/seoul/t/${RGN_SLUG[r.rgn]}.html">${esc(r.rgn)} 정비사업 ›</a>` : ''}<a href="/seoul/">서울 전체 ${rows.length}곳 ›</a></div></section>
</aside></div>`;
    const desc = `${r.gu} ${r.addr} ${r.title} ${K.s} 정비사업. ${r.st ? `추진 단계 ${r.st}${r.sd ? `(${ym(r.sd)})` : ''}` : ''}${r.hh ? `, 계획 ${num(r.hh)}세대` : ''}${fl ? `, 지상 ${fl[1]}층` : ''}. 위치·면적·용적률과 다음 단계를 정리했습니다.`.slice(0, 150);
    await writeFile(`seoul/${r.slug}/${r.id}.html`, page({
      path: zoneUrl(r), title: `${r.title} ${K.s} 추진 단계·계획 세대수 (${r.gu} ${r.dong}) | 리얼맵`, desc,
      h1: `${esc(r.title)} ${kchip(r.k)} ${pill(r)}`, sub: `서울특별시 ${esc(r.gu)} ${esc(r.addr)} 일대`,
      crumbs: [['리얼맵', '/'], ['서울 정비사업', '/seoul/'], [r.gu, `/seoul/${r.slug}.html`], [r.title, zoneUrl(r)]], body, faq, cur: 'gu',
      zrow: { id: r.id, sido: '11', n: r.title, gu: r.gu, a: r.a || r.dong || '', st: r.st || '', ar: r.ar || 0, hh: r.hh || 0, far: r.far || 0, lat: r.lat || 0, lng: r.lng || 0, ring: ringsOf(r.jb), late: /관리처분|이주|철거|착공|준공|이전고시|청산/.test(r.st || '') },
    }));
    urls.push([zoneUrl(r), 0.6]);
  }

  // ---------- 구별 페이지 ----------
  const kc = kindCount(list);
  const big = list.filter(r => r.hh).sort((a, b) => b.hh - a.hh)[0];
  const going = list.filter(r => [2, 3].includes(stageOf(r.st).g)).length;
  const recent = list.filter(r => r.sd && r.sd >= oneYear && r.st !== '준공').sort((a, b) => b.sd.localeCompare(a.sd)).slice(0, 8);
  const hhSum = list.reduce((s, r) => s + (r.hh || 0), 0);
  const intro = `${gu}에는 서울시 정비사업 현황 기준 <b>${list.length}곳</b>의 정비사업이 있습니다. ${kc.map(([k, c]) => `${kindOf(k).s} ${c}곳`).join(', ')}입니다.`
    + (going ? ` 이 중 조합설립부터 공사 단계까지 사업이 본격적으로 진행 중인 곳이 ${going}곳입니다.` : '')
    + (big ? ` 계획 세대수가 가장 많은 곳은 <a href="${zoneUrl(big)}">${esc(big.title)}</a>(${num(big.hh)}세대)입니다.` : '')
    + (hhSum ? ` 세대수가 공개된 사업만 합쳐도 약 ${num(Math.round(hhSum / 100) * 100)}세대가 계획되어 있습니다.` : '');
  const gt = THEMES.filter(t => t.g !== '권역').map(t => [t, list.filter(t.f).length]).filter(x => x[1]);
  const body = `<p class="intro">${intro}</p>
${kpis(list, [['계획 세대', hhSum ? `${num(Math.round(hhSum / 1000) / 10, 1)}만` : '-']])}
<div class="g2"><div class="gm"><section class="pn"><h2>정비구역 목록 <small>초기 단계부터 · ${list.length}곳</small></h2>${ztable(list)}</section></div>
<aside class="gs">
<section class="pn"><h2>단계 분포</h2>${stageLegend(list)}</section>
${recent.length ? `<section class="pn"><h2>최근 1년 단계 진행 <small>${recent.length}곳</small></h2>${zlist(recent, r => esc(ym(r.sd)))}</section>` : ''}
${gt.length ? `<section class="pn"><h2>${esc(gu)} 테마별</h2><div class="lk">${gt.map(([t, n]) => `<a href="${themeUrl(t)}">${esc(t.short)} <small>${gu} ${n}곳 · 서울 ${t.list.length}곳</small></a>`).join('')}</div></section>` : ''}
<section class="pn"><h2>다른 구</h2><p class="gus">${GU_ORDER.filter(g => byGu.get(g).length).map(g => g === gu ? `<b>${g.replace(/구$/, '')}</b>` : `<a href="/seoul/${GU[g]}.html">${g.replace(/구$/, '')}</a>`).join('')}</p></section>
</aside></div>`;
  await writeFile(`seoul/${GU[gu]}.html`, page({
    path: `/seoul/${GU[gu]}.html`, title: `${gu} 재개발·재건축 정비사업 현황 ${list.length}곳 — 추진 단계·세대수 (${ym(ymdUpd)}) | 리얼맵`,
    desc: `${gu} 재개발·재건축·신속통합기획 정비사업 ${list.length}곳의 추진 단계, 계획 세대수, 위치를 한눈에. ${kc.slice(0, 3).map(([k, c]) => `${kindOf(k).s} ${c}곳`).join(', ')}. ${updK} 기준.`,
    h1: `${gu} 재개발·재건축 정비사업 현황`, sub: `${esc(updK)} 기준 · 서울시 정비사업 현황`,
    crumbs: [['리얼맵', '/'], ['서울 정비사업', '/seoul/'], [gu, `/seoul/${GU[gu]}.html`]], body, faq: STAGE_FAQ, cur: 'gu',
  }));
  urls.push([`/seoul/${GU[gu]}.html`, 0.8]);
}

// ---------- 테마 페이지 ----------
for (const t of THEMES) {
  const list = t.list; if (!list.length) continue;
  const byG = GU_ORDER.map(g => [g, list.filter(r => r.gu === g).length]).filter(x => x[1]).sort((a, b) => b[1] - a[1]);
  const hhSum = list.reduce((s, r) => s + (r.hh || 0), 0), mx = byG.length ? byG[0][1] : 1;
  const top = list.filter(r => r.hh).sort((a, b) => b.hh - a.hh).slice(0, 8);
  const body = `<p class="intro">${esc(t.d)} 서울 전체 <b>${list.length}곳</b>${hhSum ? `, 계획 세대수는 합쳐서 약 ${num(Math.round(hhSum / 100) * 100)}세대` : ''}입니다.</p>
${kpis(list, [['계획 세대', hhSum ? `${num(Math.round(hhSum / 1000) / 10, 1)}만` : '-']])}
<div class="g2"><div class="gm"><section class="pn"><h2>${esc(t.name)} <small>${t.sort === 'sd' ? '최근 바뀐 순' : '초기 단계부터'} · ${list.length}곳</small></h2>${ztable(list, { withGu: true, sortKey: t.sort || 'st' })}</section></div>
<aside class="gs">
<section class="pn"><h2>구별 분포</h2><ul class="gb">${byG.map(([g, n]) => `<li><a href="/seoul/${GU[g]}.html">${g}</a><i style="width:${(n / mx * 100).toFixed(0)}%"></i><b>${n}</b></li>`).join('')}</ul></section>
<section class="pn"><h2>단계 분포</h2>${stageLegend(list)}</section>
${top.length && t.slug !== 'big' && t.slug !== 'mega' ? `<section class="pn"><h2>세대수 많은 곳</h2>${zlist(top, r => `${esc(r.gu)} · ${num(r.hh)}세대`)}</section>` : ''}
</aside></div>
${themeLinks(t.slug)}`;
  await writeFile(`seoul/t/${t.slug}.html`, page({
    path: themeUrl(t), title: `서울 ${t.name} 정비사업 ${list.length}곳 — 구별·추진 단계 (${ym(ymdUpd)}) | 리얼맵`,
    desc: `서울 ${t.name} 재개발·재건축 정비사업 ${list.length}곳을 구별·추진 단계별로 정리했습니다. 계획 세대수, 층수, 위치까지 한 표로. ${updK} 기준.`.slice(0, 150),
    h1: `서울 ${esc(t.name)}`, sub: `${esc(t.g)}별로 보기 · ${esc(updK)} 기준`,
    crumbs: [['리얼맵', '/'], ['서울 정비사업', '/seoul/'], [t.short, themeUrl(t)]], body, faq: STAGE_FAQ.slice(0, 3), cur: t.slug,
  }));
  urls.push([themeUrl(t), 0.7]);
}

// ---------- 서울 전체 페이지 ----------
{
  const kc = kindCount(rows);
  const recent = rows.filter(r => r.sd && r.st !== '준공').sort((a, b) => b.sd.localeCompare(a.sd)).slice(0, 10);
  const top = rows.filter(r => r.hh).sort((a, b) => b.hh - a.hh).slice(0, 10);
  const hhAll = rows.reduce((s, r) => s + (r.hh || 0), 0);
  const gtab = GU_ORDER.map(g => { const l = byGu.get(g); return { g, l, n: l.length, c: gcount(l), big: l.filter(r => r.hh >= 1000).length, hh: l.reduce((s, r) => s + (r.hh || 0), 0), re: l.filter(r => /^재개발/.test(r.k)).length, rb: l.filter(r => /^재건축/.test(r.k)).length, st: l.filter(r => r.k === '신속통합기획').length }; }).filter(x => x.n);
  const rgt = RGN.map(g => { const l = rows.filter(r => r.rgn === g); return { g, l, n: l.length }; });
  const body = `<p class="intro">서울 25개 구의 재개발·재건축·신속통합기획 정비사업 <b>${rows.length}곳</b>을 구별·테마별로 정리했습니다. 관심 구역을 담아 두면 추진 단계가 바뀔 때 이메일로 알려 드립니다.</p>
${kpis(rows, [['계획 세대', `${num(Math.round(hhAll / 10000))}만`]])}
<section class="pn mine" data-myzones hidden><h2 class="my-hi">관심 구역</h2><p class="my-mail tn"></p><ul class="my-list"></ul></section>
<section class="pn"><h2>테마별로 보기</h2><div class="tcards">${TG.map(g => `<div class="tg"><b>${g}</b>${THEMES.filter(t => t.g === g && t.list.length).map(t => `<a href="${themeUrl(t)}"><span>${esc(t.short)}</span><em>${num(t.list.length)}</em>${sbar(t.list)}</a>`).join('')}</div>`).join('')}</div></section>
<div class="g2"><div class="gm">
<section class="pn"><h2>구별 정비사업 <small>구 이름을 누르면 구역별 표</small></h2><div class="tw"><table class="zt gtb"><thead><tr><th data-s="gu">구</th><th data-s="n" class="n on dn">전체</th><th>추진 단계 분포</th>${GROUP.map((g, i) => `<th data-s="g${i}" class="n" title="${g}"><i class="dot" style="background:${GCOLOR[i]}"></i>${g.split('·')[0]}</th>`).join('')}<th data-s="re" class="n">재개발</th><th data-s="rb" class="n">재건축</th><th data-s="stt" class="n">신통</th><th data-s="big" class="n">대단지</th><th data-s="hh" class="n">계획 세대</th></tr></thead><tbody>
${gtab.sort((a, b) => b.n - a.n).map(x => `<tr><td data-v="${x.g}"><a href="/seoul/${GU[x.g]}.html"><b>${x.g}</b></a></td><td class="n" data-v="${x.n}"><b>${x.n}</b></td><td>${sbar(x.l)}</td>${x.c.map((c, i) => `<td class="n" data-v="${c}">${c || '-'}</td>`).join('')}<td class="n" data-v="${x.re}">${x.re || '-'}</td><td class="n" data-v="${x.rb}">${x.rb || '-'}</td><td class="n" data-v="${x.st}">${x.st || '-'}</td><td class="n" data-v="${x.big}">${x.big || '-'}</td><td class="n" data-v="${x.hh}">${x.hh ? num(x.hh) : '-'}</td></tr>`).join('\n')}
</tbody></table></div><p class="tn">${kc.map(([k, c]) => `${kindOf(k).s} ${c}곳`).join(' · ')}. 대단지는 계획 1,000세대 이상.</p></section>
<section class="pn"><h2>권역별</h2><div class="tw"><table class="zt"><thead><tr><th>권역</th><th>구</th><th class="n">정비사업</th><th>추진 단계 분포</th></tr></thead><tbody>${rgt.map(x => `<tr><td><a href="/seoul/t/${RGN_SLUG[x.g]}.html"><b>${x.g}</b></a></td><td class="c-a">${RGN_GU[x.g]}</td><td class="n"><b>${x.n}</b></td><td>${sbar(x.l)}</td></tr>`).join('')}</tbody></table></div></section>
<section class="pn"><h2>단계별 뜻</h2><dl class="dfn">${['대상지선정', '구역지정', '추진위구성', '조합설립인가', '사업시행인가', '관리처분계획인가', '착공'].map(s => `<dt>${pill({ st: s })}</dt><dd>${esc(STAGE[s].d)}</dd>`).join('')}</dl></section>
</div><aside class="gs">
<section class="pn"><h2>단계 분포</h2>${stageLegend(rows)}</section>
<section class="pn"><h2>최근 단계가 진행된 곳</h2>${zlist(recent, r => `${esc(r.gu)} · ${esc(ym(r.sd))}`)}<p class="more"><a href="/seoul/t/recent.html">최근 1년 진행 전체 ›</a></p></section>
<section class="pn"><h2>계획 세대수가 많은 곳</h2><ol class="rank">${top.map(r => `<li><span><a href="${zoneUrl(r)}">${esc(r.title)}</a><b>${num(r.hh)}세대</b><small>${esc(r.gu)} · ${esc(r.st)}</small></span></li>`).join('')}</ol><p class="more"><a href="/seoul/t/big.html">대단지 전체 ›</a></p></section>
</aside></div>`;
  await writeFile('seoul/index.html', page({
    path: '/seoul/', title: `서울 재개발·재건축 정비사업 현황 ${rows.length}곳 — 구별·테마별 추진 단계 (${ym(ymdUpd)}) | 리얼맵`,
    desc: `서울 25개 구 재개발·재건축·신속통합기획 정비사업 ${rows.length}곳의 추진 단계와 계획 세대수를 구별·대단지·단계·권역별로 정리했습니다. ${updK} 기준, 분기마다 자동 갱신.`,
    h1: '서울 재개발·재건축 정비사업 현황', sub: `${esc(updK)} 기준 · 서울시 정비사업 현황 · 분기마다 자동 갱신`,
    crumbs: [['리얼맵', '/'], ['서울 정비사업', '/seoul/']], body, faq: STAGE_FAQ, cur: 'idx',
  }));
  urls.unshift(['/seoul/', 0.9]);
}

// ---------- 스타일 ----------
await writeFile('seoul/seoul.css', `/* 서울 정비사업 안내 — 10/28 촘촘한 화면 (scripts/seoul-pages.mjs가 만듦) */
:root{--bg:#EEF1F5;--surface:#fff;--fg:#14212E;--muted:#5E6A77;--line:#DDE3EA;--line2:#EEF1F5;--soft:#F7F9FB;--accent:#F2B705;--navy:#14212E;--link:#1C64C8}
@media (prefers-color-scheme:dark){:root{--bg:#0E1317;--surface:#151C22;--fg:#E5EAEF;--muted:#94A1AE;--line:#26313A;--line2:#1E272F;--soft:#1A2229;--link:#6EA8FE}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font-family:"Pretendard Variable",Pretendard,"Apple SD Gothic Neo","Malgun Gothic",sans-serif;font-size:14px;line-height:1.6;letter-spacing:-.01em;word-break:keep-all;-webkit-font-smoothing:antialiased}
a{color:inherit}
.top{position:sticky;top:0;z-index:20;display:flex;align-items:center;gap:12px;padding:9px 20px;background:#14212E;color:#fff}
.brand{display:flex;align-items:center;gap:7px;text-decoration:none;font-size:16px;flex:none}
.crumb{display:flex;align-items:center;gap:6px;font-size:13px;color:#AEBBC8;min-width:0;overflow:hidden;white-space:nowrap}.crumb a{text-decoration:none}.crumb a:hover{color:#fff}.crumb span{color:#fff;font-weight:700;overflow:hidden;text-overflow:ellipsis}.crumb i{font-style:normal;opacity:.6}
.sp{flex:1}.upd{font-size:12px;color:#AEBBC8;white-space:nowrap}
.mapbtn{font-size:13px;font-weight:800;text-decoration:none;background:#F2B705;color:#14212E;padding:6px 13px;border-radius:999px;white-space:nowrap}
.vw{background:var(--surface);border-bottom:1px solid var(--line);position:sticky;top:46px;z-index:15}
.vw-in{max-width:1240px;margin:0 auto;padding:6px 20px;display:flex;flex-wrap:wrap;align-items:center;gap:3px 4px}
.vw a,.vd summary{flex:none;font-size:13px;font-weight:700;text-decoration:none;padding:4px 10px;border-radius:999px;white-space:nowrap;cursor:pointer;color:var(--fg)}
.vw a:hover,.vd summary:hover{background:var(--soft)}.vw a[aria-current],.vd summary.on{background:var(--navy);color:var(--surface)}
.vs{flex:none;font-size:11px;font-weight:800;color:var(--muted);margin:0 2px 0 10px;padding-left:10px;border-left:1px solid var(--line)}
.vd{position:relative;flex:none}.vd summary{list-style:none}.vd summary::-webkit-details-marker{display:none}
.vdm{position:fixed;margin-top:6px;background:var(--surface);border:1px solid var(--line);border-radius:10px;box-shadow:0 12px 30px rgba(0,0,0,.15);padding:6px;display:grid;grid-template-columns:repeat(5,auto);gap:2px;z-index:30}
.vdm a{display:flex;justify-content:space-between;gap:8px;padding:5px 10px;border-radius:6px}.vdm small{color:var(--muted);font-weight:600}
main{max-width:1240px;margin:0 auto;padding:16px 20px 10px}
.ph{display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 14px;margin:2px 0 6px}
h1{font-size:22px;line-height:1.35;margin:0;letter-spacing:-.03em;display:flex;flex-wrap:wrap;align-items:center;gap:8px}
.sub{margin:0;color:var(--muted);font-size:13px}
.intro{margin:0 0 12px;color:#3B4754;font-size:14px;max-width:980px}
@media (prefers-color-scheme:dark){.intro{color:var(--muted)}}
.intro a{color:var(--link)}
.kp{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));background:var(--surface);border:1px solid var(--line);border-radius:9px;overflow:hidden;margin-bottom:12px}
.kp div{padding:8px 14px;border-right:1px solid var(--line2)}.kp div:last-child{border-right:0}
.kp small{display:flex;align-items:center;gap:5px;color:var(--muted);font-size:11.5px;font-weight:700;white-space:nowrap}.kp small i{width:8px;height:8px;border-radius:2px}
.kp b{font-size:20px;font-variant-numeric:tabular-nums;letter-spacing:-.02em}.kp span{font-size:12px;color:var(--muted);margin-left:2px}
.g2{display:grid;grid-template-columns:minmax(0,1fr) 300px;gap:12px;align-items:start}
.gm,.gs{display:grid;gap:12px;min-width:0}
.pn{background:var(--surface);border:1px solid var(--line);border-radius:9px;overflow:hidden;margin:0 0 12px}.gm .pn,.gs .pn{margin:0}
.pn h2{margin:0;font-size:14px;padding:9px 12px;background:var(--soft);border-bottom:1px solid var(--line2);display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 8px;letter-spacing:-.02em}.pn h2 small{color:var(--muted);font-weight:600;font-size:12px}
.tn{margin:0;padding:7px 12px;font-size:12px;color:var(--muted)}
/* 거르기 */
.flt{display:flex;flex-wrap:wrap;gap:6px 10px;padding:8px 12px;border-bottom:1px solid var(--line2);align-items:center}
.fg{display:flex;flex-wrap:wrap;gap:4px}
.flt button{display:inline-flex;align-items:center;gap:4px;border:1px solid var(--line);background:var(--surface);color:var(--fg);border-radius:999px;padding:2px 10px;font:inherit;font-size:12.5px;font-weight:700;cursor:pointer}
.flt button i{width:7px;height:7px;border-radius:2px}
.flt button.on{background:var(--navy);color:var(--surface);border-color:var(--navy)}
.fr{display:flex;gap:6px;align-items:center;margin-left:auto}
.flt input,.flt select{border:1px solid var(--line);background:var(--surface);color:var(--fg);border-radius:6px;padding:4px 9px;font:inherit;font-size:13px}.flt input{width:170px}
.fn{font-size:12.5px;white-space:nowrap}
/* 표 */
.tw{overflow-x:auto}
.zt{border-collapse:collapse;width:100%;font-size:13px;font-variant-numeric:tabular-nums}
.zt th,.zt td{padding:0 7px;height:31px;border-bottom:1px solid var(--line2);white-space:nowrap;text-align:left}
.zt th{background:var(--soft);color:var(--muted);font-size:11.5px;font-weight:700;height:27px;position:sticky;top:0}
.zt th[data-s]{cursor:pointer;user-select:none}.zt th[data-s]:hover{color:var(--fg)}.zt th.on:after{content:" ▲";font-size:9px}.zt th.on.dn:after{content:" ▼"}
.zt tbody tr:nth-child(even) td{background:var(--soft)}.zt tbody tr:hover td{background:#FFF8E1}
@media (prefers-color-scheme:dark){.zt tbody tr:hover td{background:#2A2614}}
.zt .n{text-align:right}
.zt td.c-n a{font-weight:800;text-decoration:none}.zt td.c-n a:hover{text-decoration:underline}
.zt td.c-gu a{text-decoration:none;color:var(--muted);font-weight:700}
.zt td.c-d,.zt td.c-a{color:var(--muted);font-size:12.5px}.zt td.c-a{max-width:140px;overflow:hidden;text-overflow:ellipsis}
.zt td.c-ac{text-align:right}
.zt.wg td.c-p,.zt.wg th:nth-child(5){display:none}.zt.wg td.c-a{max-width:110px}
.zt tr[hidden]{display:none}
.zi{border:1px solid var(--line);background:var(--surface);color:var(--fg);border-radius:5px;padding:0 5px;height:22px;font-size:12px;cursor:pointer;margin-left:2px;line-height:20px}
.zi.on{background:#FFF4CC;border-color:var(--accent)}
.zm{font-size:12px;font-weight:700;color:var(--link);text-decoration:none;margin-left:6px}
.kd{display:inline-block;font-size:11px;font-weight:800;color:var(--c);border:1px solid var(--c);border-radius:4px;padding:0 5px;line-height:17px;white-space:nowrap}
h1 .kd{font-size:12.5px;padding:1px 7px}
.st{display:inline-block;font-size:11.5px;font-weight:800;padding:0 7px;border-radius:9px;line-height:19px;white-space:nowrap;background:#F1F3F5;color:#5E6A77}
.st.g1{background:#FFF4D6;color:#A16207}.st.g2{background:#FFE8CC;color:#C2410C}.st.g3{background:#FDE2D6;color:#B4231D}.st.g4{background:#E3F5E8;color:#1F7A4D}
@media (prefers-color-scheme:dark){.st{background:var(--soft);color:var(--fg)}}
h1 .st{font-size:12.5px;padding:1px 9px}
.mini{display:inline-flex;gap:2px;vertical-align:middle}.mini i{width:8px;height:5px;border-radius:2px;background:var(--line)}.mini i.on{background:#F08C00}
.dot{display:inline-block;width:7px;height:7px;border-radius:2px;margin-right:3px}
.sbar{display:flex;height:9px;border-radius:5px;overflow:hidden;background:var(--line2);min-width:90px}
.lg{list-style:none;margin:0;padding:0 12px 10px;display:flex;flex-wrap:wrap;gap:3px 12px;font-size:12px;color:var(--muted)}.lg i{display:inline-block;width:8px;height:8px;border-radius:2px;margin-right:4px}.lg b{color:var(--fg)}
.gs .sbar{margin:10px 12px 7px}
.zl{list-style:none;margin:0;padding:0}.zl li{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:2px 8px;align-items:center;padding:6px 12px;border-bottom:1px solid var(--line2)}.zl li:last-child{border-bottom:0}
.zl a{font-weight:800;text-decoration:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.zl a:hover{text-decoration:underline}.zl small{grid-column:1/-1;color:var(--muted);font-size:11.5px;margin-top:-2px}
.lk{display:grid}.lk a{display:flex;justify-content:space-between;gap:8px;padding:7px 12px;border-bottom:1px solid var(--line2);text-decoration:none;font-weight:700;font-size:13px}.lk a:last-child{border-bottom:0}.lk a:hover{background:var(--soft)}.lk small{color:var(--muted);font-weight:600}
.gus{display:flex;flex-wrap:wrap;gap:4px;margin:0;padding:10px 12px}.gus a,.gus b{font-size:12.5px;padding:2px 8px;border:1px solid var(--line);border-radius:999px;text-decoration:none}.gus b{background:var(--navy);color:var(--surface);border-color:var(--navy)}
.gb{list-style:none;margin:0;padding:6px 12px 10px}.gb li{display:grid;grid-template-columns:64px 1fr 30px;align-items:center;gap:8px;font-size:12.5px;padding:2px 0}.gb a{text-decoration:none;font-weight:700}.gb i{height:8px;border-radius:4px;background:#F08C00;display:block}.gb b{text-align:right;font-variant-numeric:tabular-nums}
.rank{margin:0;padding:4px 12px 4px 34px}.rank li{padding:5px 0;border-bottom:1px solid var(--line2);font-size:13px}.rank li:last-child{border:0}.rank li>span{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:0 8px}.rank a{font-weight:800;text-decoration:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.rank small{grid-column:1;color:var(--muted);font-size:11.5px}.rank b{grid-column:2;grid-row:1;font-variant-numeric:tabular-nums}
.more{margin:0;padding:7px 12px;border-top:1px solid var(--line2);font-size:12.5px;font-weight:700}.more a{color:var(--link);text-decoration:none}
/* 서울 전체: 테마 카드 */
.tcards{display:grid;grid-template-columns:repeat(4,minmax(0,1fr))}
.tcards .tg{padding:8px 10px 10px;border-right:1px solid var(--line2);display:grid;gap:4px;align-content:start}.tcards .tg:last-child{border-right:0}
.tcards .tg>b{font-size:11.5px;color:var(--muted);padding:0 4px}
.tcards a{display:grid;grid-template-columns:1fr auto;gap:3px 8px;align-items:center;text-decoration:none;padding:6px 8px;border:1px solid var(--line2);border-radius:7px}.tcards a:hover{border-color:var(--accent);background:#FFFBEB}
@media (prefers-color-scheme:dark){.tcards a:hover{background:#2A2614}}
.tcards a span{font-weight:800;font-size:13px}.tcards a em{font-style:normal;font-weight:800;font-variant-numeric:tabular-nums}.tcards a .sbar{grid-column:1/-1;height:5px;min-width:0}
.tls{display:grid;grid-template-columns:repeat(4,minmax(0,1fr))}.tls div{padding:8px 12px;border-right:1px solid var(--line2);display:flex;flex-wrap:wrap;gap:4px;align-content:start}.tls div:last-child{border:0}.tls b{width:100%;font-size:11.5px;color:var(--muted)}
.tls a{font-size:12.5px;font-weight:700;text-decoration:none;border:1px solid var(--line);border-radius:999px;padding:2px 9px}.tls a:hover{border-color:var(--accent)}.tls small{color:var(--muted);font-weight:600}
.dfn{display:grid;grid-template-columns:120px 1fr;margin:0}.dfn dt,.dfn dd{margin:0;padding:7px 12px;border-bottom:1px solid var(--line2);font-size:13px}.dfn dd{color:var(--muted)}
/* 구역 상세 */
.track{list-style:none;display:flex;padding:0;margin:14px 10px 6px}
.track li{flex:1;position:relative;text-align:center;font-size:11.5px;color:var(--muted);padding-top:20px;min-width:0;font-weight:700}
.track li i{position:absolute;top:2px;left:50%;width:14px;height:14px;margin-left:-7px;border-radius:50%;background:var(--surface);border:3px solid var(--line);z-index:1}
.track li:before{content:"";position:absolute;top:7px;left:-50%;width:100%;height:3px;background:var(--line)}.track li:first-child:before{display:none}
.track li.on i{background:#F08C00;border-color:#F08C00}.track li.on:before{background:#F08C00}.track li.on{color:var(--fg)}.track li.cur i{box-shadow:0 0 0 4px rgba(240,140,0,.25)}
.now,.next{margin:6px 12px;font-size:13px;line-height:1.6}.now b,.next b{margin-right:6px}
.next{background:#FFF8E1;border-radius:6px;padding:7px 10px;margin-bottom:12px}
@media (prefers-color-scheme:dark){.next{background:#2A2614}}
.fx{display:grid;grid-template-columns:1fr 1fr}.fx dl{display:grid;grid-template-columns:96px 1fr;margin:0;align-content:start}.fx dl+dl{border-left:1px solid var(--line2)}
.fx dt,.fx dd{margin:0;padding:6px 12px;border-bottom:1px solid var(--line2);font-size:13px}.fx dt{color:var(--muted);padding-right:0}.fx dd{font-weight:700}
.kn{margin:0;padding:9px 12px;font-size:12.5px;color:var(--muted);line-height:1.6}
.act{padding-bottom:4px}
.cta,.cta2{display:block;text-align:center;font-weight:800;text-decoration:none;border-radius:7px;margin:10px 12px 0;padding:9px;font-size:13.5px}
.cta{background:var(--navy);color:var(--surface)}.cta2{border:1px solid var(--line)}
.two{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin:6px 12px 0}
.zb{font:inherit;font-size:12.5px;font-weight:700;cursor:pointer;border:1px solid var(--line);background:var(--surface);color:var(--fg);padding:7px 4px;border-radius:7px}
.zb:hover{border-color:var(--accent)}.zb.on{background:#FFF4CC;border-color:var(--accent);color:#7A5B00}
@media (prefers-color-scheme:dark){.zb.on,.zi.on{background:#3A3010;color:#FFD43B}}
.faq details{border-bottom:1px solid var(--line2);padding:8px 12px}.faq details:last-child{border:0}.faq summary{cursor:pointer;font-weight:700;font-size:13.5px}.faq p{margin:6px 0 0;color:var(--muted);font-size:13px}
.src{margin:0 0 12px;font-size:12px;color:var(--muted);background:var(--surface);border:1px solid var(--line);border-radius:9px;padding:9px 12px}.src a{color:var(--link)}
footer{max-width:1240px;margin:0 auto 26px;padding:0 20px;font-size:12px;color:var(--muted)}
/* 관심 구역 · 알림 창 */
#ztoast{position:fixed;left:50%;bottom:28px;transform:translateX(-50%) translateY(20px);background:#14212E;color:#fff;padding:10px 18px;border-radius:999px;font-size:14px;font-weight:600;opacity:0;pointer-events:none;transition:.25s;z-index:50;max-width:calc(100% - 32px)}
#ztoast.show{opacity:1;transform:translateX(-50%)}
#zmodal{position:fixed;inset:0;z-index:40;display:flex;align-items:center;justify-content:center;padding:16px}
#zmodal .zm-bg{position:absolute;inset:0;background:rgba(10,16,22,.55)}
#zmodal .zm-box{position:relative;background:var(--surface);border-radius:14px;padding:22px 20px 16px;max-width:400px;width:100%;box-shadow:0 20px 50px rgba(0,0,0,.3);font-size:15px}
#zmodal h3{margin:0 0 8px;font-size:18px}#zmodal p{margin:6px 0}
.zm-x{position:absolute;right:12px;top:10px;border:0;background:var(--soft);width:30px;height:30px;border-radius:50%;font-size:18px;cursor:pointer;color:var(--fg)}
.zm-kakao,.zm-go{display:block;width:100%;text-align:center;margin:14px 0 6px;padding:12px;border-radius:10px;font:inherit;font-weight:800;font-size:15px;text-decoration:none;border:0;cursor:pointer}
.zm-kakao{background:#FEE500;color:#191919}.zm-go{background:var(--navy);color:var(--surface)}
.zm-l{display:block;font-size:14px;font-weight:600;margin-top:12px}.zm-l input{display:block;width:100%;margin-top:6px;font:inherit;font-size:16px;padding:10px 12px;border:1px solid var(--line);border-radius:8px;background:var(--surface);color:var(--fg)}
.zm-c{display:flex;gap:8px;align-items:flex-start;font-size:13px;color:var(--muted);margin-top:10px}.zm-c input{margin-top:3px}
.zm-s{font-size:12.5px!important;color:var(--muted)}
.lnk{border:0;background:none;color:inherit;text-decoration:underline;font:inherit;cursor:pointer;padding:0}
.mine{border:2px solid var(--accent)}
.my-list{list-style:none;padding:0;margin:0}.my-list li{display:flex;align-items:center;gap:8px;padding:6px 12px;border-top:1px solid var(--line2)}
.my-list a{text-decoration:none;flex:1;min-width:0;font-weight:700}.my-list a span{font-size:12px;color:var(--muted);margin-left:6px;font-weight:600}.my-list .empty{color:var(--muted);font-size:13px}
.my-list .zb{padding:3px 9px}
/* 좁은 화면 */
@media (max-width:1100px){.g2{grid-template-columns:1fr}.kp{grid-template-columns:repeat(4,minmax(0,1fr))}.kp div{border-bottom:1px solid var(--line2)}.tcards,.tls{grid-template-columns:repeat(2,minmax(0,1fr))}.tcards .tg,.tls div{border-bottom:1px solid var(--line2)}}
@media (max-width:760px){
  .top{padding:8px 14px;gap:8px}.upd,.crumb{display:none}.vw{top:43px}.vw-in{padding:6px 14px;flex-wrap:nowrap;overflow-x:auto;scrollbar-width:none}.vw-in::-webkit-scrollbar{display:none}
  main{padding:12px 12px 6px}h1{font-size:19px}.kp{grid-template-columns:repeat(4,minmax(0,1fr))}.kp small{font-size:10.5px}.kp b{font-size:17px}.kp div{padding:6px 10px}
  .fr{margin-left:0;width:100%}.flt input{flex:1;width:auto}
  .tcards,.tls{grid-template-columns:1fr}.fx{grid-template-columns:1fr}.fx dl+dl{border-left:0}
  .zt:not(.gtb) thead{display:none}
  .zt:not(.gtb),.zt:not(.gtb) tbody{display:block}
  .zt:not(.gtb) tr{display:grid;grid-template-columns:auto auto 1fr auto;gap:3px 6px;align-items:center;padding:8px 12px;border-bottom:1px solid var(--line2)}
  .zt:not(.gtb) td{height:auto;padding:0;border:0;background:none!important}
  .zt:not(.gtb) td.c-n{grid-column:1/4;font-size:14px}.zt:not(.gtb) td.c-ac{grid-column:4;grid-row:1}
  .zt:not(.gtb) td.c-gu{grid-column:1}.zt td.c-p,.zt td.c-ar{display:none}
  .zt:not(.gtb) td.c-a{max-width:none;font-size:12px}
  .zt:not(.gtb) td.c-a{grid-column:1/3}.zt:not(.gtb) td.c-h{grid-column:3;text-align:left}.zt:not(.gtb) td.c-f{grid-column:4}
  .zt:not(.gtb) td.c-h[data-v="0"],.zt:not(.gtb) td.c-f[data-v="0"]{visibility:hidden}
  .zt:not(.gtb) td.c-h:after{content:"세대"}.zt:not(.gtb) td.c-h,.zt:not(.gtb) td.c-f{font-size:12px;color:var(--muted)}
  .vdm{grid-template-columns:repeat(3,auto);left:12px;right:12px}
  .track li{font-size:10px;letter-spacing:-.05em}
}
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
