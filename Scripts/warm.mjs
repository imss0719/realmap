// 리얼맵 미리 불러오기 (GitHub Actions에서 매일 새벽 자동 실행)
// 마포·서대문·은평의 최근 거래가 있는 아파트·오피스텔을 골라, 건축물대장·층별·동별 호 목록·토지 정보를
// 리얼맵 서버에 한 번씩 요청해 둡니다. 서버는 받은 결과를 창고(Upstash)에 30일 보관하므로
// 이용자가 처음 눌러도 바로 뜹니다. 이미 창고에 있는 건물은 공공데이터포털을 다시 부르지 않습니다.
const SITE = process.env.SITE || 'https://realmap.online';
const GU = [['11440', '서울특별시 마포구'], ['11410', '서울특별시 서대문구'], ['11380', '서울특별시 은평구']];
const KINDS = ['apt', 'offi'];
const DAYS = 7;                 // 전체 목록을 7일에 나눠 한 바퀴 (하루 공공데이터 사용량을 낮게 유지)
const GAP = 400;                // 요청 사이 쉬는 시간(ms)
const LIMIT_MIN = 80;           // 한 번 실행 최대 시간(분)

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

// 1) 대상 필지 모으기
const want = new Map();
for (const [lawd, r] of GU) for (const kind of KINDS) {
  const j = await get(`/api/aptmap?kind=${kind}&lawd=${lawd}&r=${encodeURIComponent(r)}`);
  for (const it of (j && j.items) || []) if (it.pnu) want.set(it.pnu, (want.get(it.pnu) || 0) + (it.c || 1));
}
const all = [...want.keys()].sort();
const day = Math.floor(Date.now() / 864e5);
const todays = process.env.ALL ? all : all.filter((p, i) => i % DAYS === day % DAYS);
console.log(`대상 필지 전체 ${all.length}곳 · 오늘 ${todays.length}곳`);

// 2) 필지마다 미리 요청
let done = 0;
for (const pnu of todays) {
  if (Date.now() - t0 > LIMIT_MIN * 60e3) { console.log('시간 한도 도달, 다음에 이어서 합니다'); break; }
  const b = await get(`/api/building?pnu=${pnu}&w=1`);
  const titles = b && b.titles && b.titles.ok ? b.titles.data : [];
  if (titles.length) {
    await get(`/api/building?pnu=${pnu}&part=floors&w=1`);
    const dongs = [...new Set(titles.map(t => String(t.dong || '').trim()).filter(Boolean))];
    if (dongs.length >= 2) for (const d of dongs) await get(`/api/units?pnu=${pnu}&dong=${encodeURIComponent(d)}&w=1`);
    else await get(`/api/units?pnu=${pnu}&w=1`);
  }
  await get(`/api/land?pnu=${pnu}&w=1`);
  done++;
  if (done % 25 === 0) console.log(`${done}/${todays.length} 완료 · 요청 ${calls}회`);
}
console.log(`끝: ${done}곳 · 요청 ${calls}회 · 실패 ${fails}회 · ${Math.round((Date.now() - t0) / 60e3)}분`);

