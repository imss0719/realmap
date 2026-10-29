// 국토교통부_전국 도시정비사업 통합 데이터 받아 오기 (GitHub Actions에서 실행) — 10/29 경기·인천 정비사업 페이지용
// 인증키는 저장소 비밀값 DATA_GO_KR_KEY (공공데이터포털 계정 키 · Vercel과 같은 값). 파일에 키를 적지 마세요 (공개 저장소).
// 결과: data/nat-zones-raw.json (전국 원본 · 시도별 건수·항목은 Actions 기록에 남김)
import { writeFile } from 'node:fs/promises';
const KEY = (process.env.DATA_GO_KR_KEY || '').trim();
if (!KEY) { console.log('DATA_GO_KR_KEY 비밀값이 비어 있습니다.'); process.exit(1); }
const BASE = 'https://api.odcloud.kr/api/15160169/v1/uddi:4d7f16a9-b0fd-4d07-b266-d0ad82aeaf34';
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function page(n) {
  const u = new URL(BASE); u.searchParams.set('page', n); u.searchParams.set('perPage', 1000); u.searchParams.set('returnType', 'JSON'); u.searchParams.set('serviceKey', KEY);
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(u, { signal: AbortSignal.timeout(30000) }), t = await r.text();
      let j; try { j = JSON.parse(t); } catch { throw new Error(`JSON 아님 (HTTP ${r.status}) ${t.slice(0, 200)}`); }
      if (!Array.isArray(j.data)) throw new Error(`응답 형식 다름 (HTTP ${r.status}) ${t.slice(0, 300)}`);
      return j;
    } catch (e) { if (i === 2) throw e; await sleep(3000); }
  }
}
const first = await page(1), rows = [...first.data], total = first.totalCount || first.matchCount || rows.length;
for (let n = 2; rows.length < total && n <= 20; n++) { rows.push(...(await page(n)).data); await sleep(300); }
console.log(`전체 ${total}건 · 받은 ${rows.length}건`);
console.log(`항목: ${Object.keys(rows[0] || {}).join(', ')}`);
console.log(`첫 줄: ${JSON.stringify(rows[0] || {})}`);
const by = (k) => { const m = {}; rows.forEach(r => { const v = r[k] ?? ''; m[v] = (m[v] || 0) + 1; }); return Object.entries(m).sort((a, b) => b[1] - a[1]); };
const ks = Object.keys(rows[0] || {});
for (const k of ks.filter(k => /시도|단계|유형/.test(k))) console.log(`[${k}] ${by(k).map(([v, n]) => `${v}:${n}`).join(' · ')}`);
await writeFile('data/nat-zones-raw.json', JSON.stringify({ source: '국토교통부_전국 도시정비사업 통합 데이터 (공공데이터포털 15160169)', updated: new Date().toISOString().slice(0, 10), total, rows }));
