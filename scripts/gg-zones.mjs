// 경기데이터드림 「정비사업 추진현황」(GenrlimprvBizpropls) 받아 오기 (GitHub Actions에서 실행) — 10/30 경기 정비사업 페이지용
// 인증키는 저장소 비밀값 GG_OPENAPI_KEY (경기데이터드림 인증키). 파일에 키를 적지 마세요 (공개 저장소).
// 결과: data/gg-zones-raw.json (원본 · 건수·항목·첫 줄은 Actions 기록에 남김)
import { writeFile } from 'node:fs/promises';
const KEY = (process.env.GG_OPENAPI_KEY || '').trim();
if (!KEY) { console.log('GG_OPENAPI_KEY 비밀값이 비어 있습니다.'); process.exit(1); }
const SVC = 'GenrlimprvBizpropls';
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function page(n) {
  const u = new URL('https://openapi.gg.go.kr/' + SVC);
  u.searchParams.set('KEY', KEY); u.searchParams.set('Type', 'json'); u.searchParams.set('pIndex', n); u.searchParams.set('pSize', 1000);
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(u, { signal: AbortSignal.timeout(30000) }), t = await r.text();
      let j; try { j = JSON.parse(t); } catch { throw new Error(`JSON 아님 (HTTP ${r.status}) ${t.slice(0, 200)}`); }
      if (j.RESULT) return { total: 0, rows: [], msg: `${j.RESULT.CODE} ${j.RESULT.MESSAGE}` };
      const b = j[SVC]; if (!Array.isArray(b)) throw new Error(`응답 형식 다름 ${t.slice(0, 300)}`);
      const head = b[0]?.head || [], total = head.find(h => h.list_total_count)?.list_total_count || 0;
      const res = head.find(h => h.RESULT)?.RESULT;
      return { total, rows: b[1]?.row || [], msg: res ? `${res.CODE} ${res.MESSAGE}` : '' };
    } catch (e) { if (i === 2) throw e; await sleep(3000); }
  }
}
const first = await page(1);
console.log(`응답: ${first.msg}`);
const rows = [...first.rows], total = first.total || rows.length;
for (let n = 2; rows.length < total && n <= 30; n++) { rows.push(...(await page(n)).rows); await sleep(300); }
console.log(`전체 ${total}건 · 받은 ${rows.length}건`);
if (!rows.length) process.exit(1);
console.log(`항목: ${Object.keys(rows[0]).join(', ')}`);
console.log(`첫 줄: ${JSON.stringify(rows[0])}`);
await writeFile('data/gg-zones-raw.json', JSON.stringify({ source: '경기데이터드림 정비사업 추진현황 (' + SVC + ')', updated: new Date().toISOString().slice(0, 10), total, rows }));
