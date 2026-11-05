// 11/5 서울 학교 정보 (나이스 교육정보 개방포털 · 비밀값 NEIS_KEY) — GitHub Actions에서 실행 (해마다 + 수동)
//   schoolInfo(학교기본정보): 남녀공학 · 개교일 · 고교 구분(일반고·특목고·자율고·특성화고) · 특목고 계열 · 홈페이지 · 전화
//   classInfo(학급정보, 올해): 학년별 반 수 → 학급 수
//   → data/school-11.json { updated, ay, n, s: { 학교명: [나이스코드, 공학(남·여·공), 개교연도, 고교구분, 특목계열, 홈페이지, 전화, 학급계, [1~6학년 반 수]] } }
//   학구도(data/hakgu-11.json) 학교와 이름으로 짝지은 결과를 요약에 남김 (못 찾은 학교 확인용)
// 아직 화면에서 쓰지 않음 — 선배가 확인한 뒤 학군 정보창에 붙임. 파일에 키를 적지 마세요 (공개 저장소).
import { readFile, writeFile, appendFile } from 'node:fs/promises';

const KEY = (process.env.NEIS_KEY || '').trim();
if (!KEY) { console.log('NEIS_KEY 비밀값이 필요합니다.'); process.exit(1); }
const OFC = 'B10';   // 서울특별시교육청
const sleep = ms => new Promise(r => setTimeout(r, ms));
const clean = s => String(s ?? '').replace(/\s+/g, ' ').trim();
const KST = new Date(Date.now() + 9 * 3600e3), AY = String(KST.getUTCMonth() < 2 ? KST.getUTCFullYear() - 1 : KST.getUTCFullYear());   // 1~2월은 지난 학년도

async function page(svc, extra, i) {
  const u = `https://open.neis.go.kr/hub/${svc}?KEY=${KEY}&Type=json&pIndex=${i}&pSize=1000&ATPT_OFCDC_SC_CODE=${OFC}${extra}`;
  for (let t = 0; t < 4; t++) {
    try {
      const j = await (await fetch(u, { signal: AbortSignal.timeout(30000) })).json();
      if (j.RESULT) { if (j.RESULT.CODE === 'INFO-200') return { total: 0, rows: [] }; throw new Error(`${j.RESULT.CODE} ${j.RESULT.MESSAGE}`); }
      const b = j[svc]; if (!b) throw new Error('응답 형식 다름: ' + JSON.stringify(j).slice(0, 200));
      const code = b[0].head[1]?.RESULT?.CODE; if (code && code !== 'INFO-000') throw new Error(`${code} ${b[0].head[1].RESULT.MESSAGE}`);
      return { total: +b[0].head[0].list_total_count || 0, rows: b[1]?.row || [] };
    } catch (e) { if (t === 3 || /^(ERROR|INFO)-/.test(e.message)) throw e; await sleep(3000 * (t + 1)); }
  }
}
async function all(svc, extra = '') {
  const first = await page(svc, extra, 1), rows = [...first.rows];
  for (let i = 2; (i - 1) * 1000 < first.total; i++) { rows.push(...(await page(svc, extra, i)).rows); await sleep(300); }
  console.log(`${svc}${extra}: ${rows.length} / ${first.total}건`);
  return rows;
}

const info = await all('schoolInfo');
if (info[0]) console.log('schoolInfo 항목:', Object.keys(info[0]).join(', '));
// 학급정보는 학교코드가 꼭 있어야 해서 학교마다 따로 조회 (동시 4곳)
const KIND = /초등학교|중학교|고등학교|특수학교|각종학교/;
const targets = info.filter(r => KIND.test(clean(r.SCHUL_KND_SC_NM))).map(r => clean(r.SD_SCHUL_CODE)).filter(Boolean);
async function clsOf(ayx) {
  const rows = [], bad = []; let k = 0;
  const work = async () => { while (k < targets.length) { const code = targets[k++];
    try { rows.push(...(await page('classInfo', `&SD_SCHUL_CODE=${code}&AY=${ayx}`, 1)).rows); } catch (e) { bad.push(code + ' ' + e.message); }
    await sleep(150); } };
  await Promise.all([work(), work(), work(), work()]);
  console.log(`classInfo ${ayx}: 학교 ${targets.length}곳 · ${rows.length}줄 · 실패 ${bad.length}곳`, bad.slice(0, 5));
  return rows;
}
let ay = AY, cls = await clsOf(AY);
if (cls.length < 1000) { ay = String(+AY - 1); cls = await clsOf(ay); }   // 올해 자료가 아직 없으면 지난해
if (cls[0]) console.log('classInfo 항목:', Object.keys(cls[0]).join(', '), '\n첫 줄:', JSON.stringify(cls[0]).slice(0, 400));

// 학급 수: 학교 → 학년 → 반 이름 (중복 제거 · 특수학급은 따로)
const C = new Map();
for (const r of cls) {
  const code = clean(r.SD_SCHUL_CODE), g = +clean(r.GRADE) || 0, nm = clean(r.CLASS_NM); if (!code || !nm) continue;
  const e = C.get(code) || C.set(code, { g: {}, sp: new Set() }).get(code);
  if (/특수|통합|순회|도움|희망|사랑/.test(nm) || !g) { e.sp.add(nm); continue; }
  (e.g[g] || (e.g[g] = new Set())).add(`${clean(r.DGHT_CRSE_SC_NM)}|${clean(r.DDDEP_NM)}|${nm}`);
}
const KO = { 남: '남', 여: '여', 남여공학: '공', 남녀공학: '공' };
const out = {};
for (const r of info) {
  const nm = clean(r.SCHUL_NM), knd = clean(r.SCHUL_KND_SC_NM);
  if (!nm || !/초등학교|중학교|고등학교|특수학교|각종학교/.test(knd)) continue;
  const code = clean(r.SD_SCHUL_CODE), c = C.get(code);
  const grades = c ? Object.keys(c.g).map(Number).sort((a, b) => a - b) : [];
  const per = grades.length ? Array.from({ length: Math.max(...grades) }, (_, k) => (c.g[k + 1] ? c.g[k + 1].size : 0)) : [];
  out[nm] = [code, KO[clean(r.COEDU_SC_NM)] || clean(r.COEDU_SC_NM).slice(0, 4), clean(r.FOND_YMD).slice(0, 4), clean(r.HS_SC_NM), clean(r.SPCLY_PURPS_HS_ORD_NM), clean(r.HMPG_ADRES).replace(/^http:\/\//, 'https://').slice(0, 120), clean(r.ORG_TELNO), per.reduce((a, b) => a + b, 0), per, c ? c.sp.size : 0];
}
const today = KST.toISOString().slice(0, 10);
await writeFile('data/school-11.json', JSON.stringify({ source: '나이스 교육정보 개방포털 학교기본정보·학급정보', updated: today, ay, n: Object.keys(out).length, s: out }));

// 학구도 학교와 짝 맞추기 (이름이 같아야 붙음)
let msg = `## 서울 학교 정보 (나이스 · ${today} · 학급은 ${ay}학년도)\n학교 ${Object.keys(out).length}곳 · 학급 자료 있는 곳 ${[...Object.values(out)].filter(x => x[7]).length}곳\n\n`;
try {
  const H = JSON.parse(await readFile('data/hakgu-11.json', 'utf8'));
  for (const [lab, M] of [['초등학교(배정)', H.e], ['중·고등학교', H.m]]) {
    const names = Object.values(M).map(x => x[0]), miss = names.filter(n => !out[n]), noC = names.filter(n => out[n] && !out[n][7]);
    msg += `- ${lab}: 학구도 ${names.length}곳 중 짝 찾음 ${names.length - miss.length}곳 · 못 찾음 ${miss.length}곳${miss.length ? ' (' + miss.slice(0, 30).join(', ') + (miss.length > 30 ? ' …' : '') + ')' : ''} · 학급 자료 없음 ${noC.length}곳\n`;
  }
} catch (e) { msg += `학구도 파일을 읽지 못함: ${e.message}\n`; }
const ex = ['서울아현초등학교', '아현중학교', '한성고등학교', '대원외국어고등학교', '하나고등학교'].filter(n => out[n]).map(n => { const x = out[n]; return `- ${n}: ${x[7]}학급 (학년별 ${x[8].join('·')}) · ${x[1]} · ${x[2]}년 개교 · ${x[3] || '-'} ${x[4] || ''}`; });
msg += `\n예시\n${ex.join('\n')}\n`;
const hs = {}; Object.values(out).forEach(x => { if (x[3]) hs[x[3]] = (hs[x[3]] || 0) + 1; }); msg += `\n고교 구분: ${Object.entries(hs).map(([k, v]) => `${k} ${v}`).join(' · ')}\n`;
if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, msg); console.log(msg);
