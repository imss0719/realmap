// 서울 열린데이터광장 정비사업 자료 받아 오기 (GitHub Actions에서 실행)
// 인증키는 저장소 비밀값 SEOUL_KEY 에서 읽습니다. 파일에 키를 적지 마세요 (공개 저장소).
// 받은 원본은 data/seoul-raw/<서비스이름>.json 에 저장합니다. (1단계: 항목 구성 확인용)
import { mkdir, writeFile } from 'node:fs/promises';

const KEY = (process.env.SEOUL_KEY || '').trim();
const SERVICES = (process.env.SERVICES || 'vnBsnsNmtn').split(',').map(s => s.trim()).filter(Boolean);
if (!KEY) { console.log('SEOUL_KEY 비밀값이 비어 있습니다.'); process.exit(1); }

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function page(svc, from, to) {
  const url = `http://openapi.seoul.go.kr:8088/${KEY}/json/${svc}/${from}/${to}/`;
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(30000) });
      const t = await r.text();
      let j; try { j = JSON.parse(t); } catch { throw new Error(`JSON 아님 (HTTP ${r.status}) ${t.slice(0, 200)}`); }
      const body = j[svc];
      if (!body) throw new Error(`응답 형식 다름: ${JSON.stringify(j).slice(0, 300)}`);
      const code = body.RESULT?.CODE || '';
      if (code && code !== 'INFO-000') throw new Error(`${code} ${body.RESULT?.MESSAGE || ''}`);
      return { total: +body.list_total_count || 0, rows: body.row || [] };
    } catch (e) { if (i === 2) throw e; await sleep(3000); }
  }
}

await mkdir('data/seoul-raw', { recursive: true });
let failed = 0;
for (const svc of SERVICES) {
  try {
    const first = await page(svc, 1, 1000);
    const rows = [...first.rows];
    for (let s = 1001; s <= first.total; s += 1000) { rows.push(...(await page(svc, s, s + 999)).rows); await sleep(300); }
    console.log(`[${svc}] 전체 ${first.total}건 · 받은 ${rows.length}건`);
    console.log(`[${svc}] 항목: ${Object.keys(rows[0] || {}).join(', ')}`);
    console.log(`[${svc}] 첫 줄: ${JSON.stringify(rows[0] || {})}`);
    await writeFile(`data/seoul-raw/${svc}.json`, JSON.stringify({ service: svc, updated: new Date().toISOString().slice(0, 10), total: first.total, rows }));
  } catch (e) { failed++; console.log(`[${svc}] 실패: ${e.message}`); }
}
if (failed === SERVICES.length) process.exit(1);
