// 리얼맵 미리 불러오기 (GitHub Actions에서 일주일에 한 번 새벽 자동 실행)
// 요즘 필지 조회가 많은 시·군·구 상위 5곳에서 거래가 많은 대단지 아파트를 골라, 건축물대장·층별·토지 정보와
// 단지 전체 동·호 목록을 리얼맵 서버에 한 번씩 요청해 둡니다. 서버는 결과를 창고(Upstash)에 보관하므로
// 이용자가 처음 눌러도 바로 뜹니다. 창고가 거의 찼으면(새로 저장이 안 되면) 요청만 쓰므로 그냥 건너뜁니다.
const SITE = process.env.SITE || 'https://realmap.online';
const PER_GU = +(process.env.PER_GU || 25);   // 구마다 대단지 몇 곳
const GAP = +(process.env.GAP || 400);                              // 요청 사이 쉬는 시간(ms)
const LIMIT_MIN = 60;                          // 한 번 실행 최대 시간(분)
const FALLBACK = ['11440', '11410', '11380'];  // 통계가 없을 때: 마포·서대문·은평

const sleep = ms => new Promise(r => setTimeout(r, ms));
const t0 = Date.now();
let calls = 0, fails = 0;
async function get(path) {
  calls++;
  for (let i = 0; i < 2; i++) {
    try {
      const r = await fetch(SITE + path, { headers: { 'User-Agent': 'realmap-warm' } });
      const j = await r.json();
      await sleep(GAP);
      return j;
    } catch (e) { await sleep(2000); }
  }
  fails++; return null;
}

// 1) 계획: 많이 보는 지역 + 창고 상태
const plan = await get('/api/auth?action=warmplan');
if (plan && plan.max && plan.keys >= plan.max * 0.95) {
  console.log(`창고가 거의 찼습니다 (${plan.keys}/${plan.max}). 새로 저장되지 않으니 이번 주는 건너뜁니다.`);
  process.exit(0);
}
const gus = plan && plan.gus && plan.gus.length ? plan.gus.map(g => g.lawd) : FALLBACK;
console.log(`대상 지역: ${gus.join(', ')} (${plan && plan.gus && plan.gus.length ? '최근 14일 조회 많은 순' : '기본 지역'})`);

// 2) 지역마다 최근 6개월 거래가 많은 아파트 = 대단지 순
const want = [];
for (const lawd of gus) {
  const j = await get(`/api/aptmap?kind=apt&lawd=${lawd}`);
  const items = ((j && j.items) || []).filter(x => x.pnu).sort((a, b) => (b.c || 0) - (a.c || 0)).slice(0, PER_GU);
  items.forEach(x => want.push(x.pnu));
  console.log(`${lawd}: ${items.length}곳 (${items.slice(0, 3).map(x => x.n).join(', ')} …)`);
}
const todo = [...new Set(want)];

// 3) 단지마다 미리 요청: 건축물대장 · 층별 · 토지 · 단지 전체 동·호(차례 받기, 다 받으면 서버가 동별로 저장)
let done = 0;
for (const pnu of todo) {
  if (Date.now() - t0 > LIMIT_MIN * 60e3) { console.log('시간 한도 도달, 다음 주에 이어서 합니다'); break; }
  const b = await get(`/api/building?pnu=${pnu}&w=1`);
  const titles = b && b.titles && b.titles.ok ? b.titles.data : [];
  if (titles.length) {
    await get(`/api/building?pnu=${pnu}&part=floors&w=1`);
    let from = 1;
    for (let k = 0; k < 40; k++) {
      const s = await get(`/api/units?pnu=${pnu}&scan=1&from=${from}&w=1`);
      if (!s || s.cached || s.done || !s.pages) break;
      from = s.next || from + 1;
    }
  }
  await get(`/api/land?pnu=${pnu}&w=1`);
  done++;
  if (done % 10 === 0) console.log(`${done}/${todo.length} 완료 · 요청 ${calls}회`);
}
console.log(`끝: ${done}곳 · 요청 ${calls}회 · 실패 ${fails}회 · ${Math.round((Date.now() - t0) / 60e3)}분`);
