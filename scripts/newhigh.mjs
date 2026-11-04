// 11/5 아파트 신고가 · 새 실거래 (매일 새벽 GitHub Actions) — 서울 25개 구
//   신고가 = 같은 단지(필지)·같은 평형(전용 ㎡ 소수점 버림)에서 그때까지 최고가보다 1% 이상 비싼 거래
//            · 해제·직거래 제외(판단·비교 모두) · 그 전 거래 3건 미만인 평형은 빼기 · 2006년 1월부터 비교
//   새 실거래 = 이 작업이 그 거래를 처음 본 날 (지도 N 표시 7일 · 신고가 ▲ 14일 · 상세 3개월은 화면에서 정함)
//   구마다 상태 파일 data/nh/s-<구>.json: base = 오래된 달까지의 단지·평형별 [최고가, 최고가 날짜, 건수] · seen = 최근 거래를 처음 본 날
//     · 처음 한 번은 2006년부터 전부 받음(구 하나에 약 250번 호출) → 시간 안에 못 끝낸 구는 다음 실행에 이어서
//     · 그 뒤로는 최근 4개월만 매일 다시 받음(늦게 신고되는 거래 · 해제 반영) · 4개월 지난 달은 base에 합침
//   결과: data/nh-11.json (화면이 읽음 · 단지 열쇠 = 필지번호(PNU), 없으면 '동|지번')
// 필요한 비밀값: DATA_GO_KR_KEY
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { month, monthsBack } from '../api/trades.js';
import { num } from '../api/_lib.js';

const GUS = ['11440', '11410', '11380', '11110', '11140', '11170', '11200', '11215', '11230', '11260', '11290', '11305', '11320', '11350', '11470', '11500', '11530', '11545', '11560', '11590', '11620', '11650', '11680', '11710', '11740'];
const FROM = '200601', RECENT = 4, MIN_PRIOR = 3, MIN_UP = 0.01, KEEP_DAYS = 92;
const DEADLINE = +(process.env.MINUTES || 50) * 60e3, t0 = Date.now();
const CAP = +(process.env.CALL_CAP || 2000);   // 하루 호출 상한 — 리얼맵 지도도 같은 공공데이터 키를 쓰므로 처음 쌓을 때도 하루 2,000번까지만 (서울 전체는 3~4일에 걸쳐 완성)
let calls = 0;
const late = () => Date.now() - t0 > DEADLINE || calls >= CAP;
const clean = s => String(s ?? '').trim();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
if (!process.env.DATA_GO_KR_KEY) { console.log('DATA_GO_KR_KEY 비밀값이 비어 있습니다.'); process.exit(1); }

const kst = new Date(Date.now() + 9 * 3600e3), TODAY = kst.toISOString().slice(0, 10).replace(/-/g, '');
const dayAdd = (d, n) => { const x = new Date(Date.UTC(+d.slice(0, 4), +d.slice(4, 6) - 1, +d.slice(6, 8)) + n * 86400e3); return x.toISOString().slice(0, 10).replace(/-/g, ''); };
const ymNext = ym => { let y = +ym.slice(0, 4), m = +ym.slice(4) + 1; if (m > 12) { m = 1; y++; } return `${y}${String(m).padStart(2, '0')}`; };
const ymRange = (a, b) => { const out = []; for (let ym = a; ym <= b; ym = ymNext(ym)) out.push(ym); return out; };
const CUR = monthsBack(1)[0], CUT = monthsBack(RECENT + 1)[RECENT];   // CUT 달까지는 base로 합침 (최근 4개월은 매일 다시)
const readJ = async (f, d) => { try { return JSON.parse(await readFile(f, 'utf8')); } catch { return d; } };

async function fetchMonth(gu, ym) {
  calls++;
  for (let t = 0; t < 5; t++) {
    try { return await month('apt', gu, ym); } catch (e) { if (t === 4) throw e; await sleep(2000 * (t + 1)); }
  }
}
// 거래 한 줄 → { k: 단지·평형 열쇠, cx: 단지 열쇠, id, price, d } · 해제·직거래·값 없음은 null
function rowOf(x, gu) {
  if (clean(x.cdealType) === 'O' || clean(x.cdealDay)) return null;
  if (/직거래/.test(clean(x.dealingGbn))) return null;
  const price = num(x.dealAmount), ar = num(x.excluUseAr), umd = clean(x.umdNm), jibun = clean(x.jibun);
  if (!price || !ar || ar < 10 || !umd || !jibun) return null;
  const sg = clean(x.sggCd) || gu, ud = clean(x.umdCd), jm = jibun.replace(/^산\s*/, '').match(/^(\d+)(?:-(\d+))?$/);
  const cx = /^\d{5}$/.test(sg) && /^\d{5}$/.test(ud) && jm ? sg + ud + (/^산/.test(jibun) ? '2' : '1') + jm[1].padStart(4, '0') + (jm[2] || '0').padStart(4, '0') : `${umd}|${jibun}`;
  const a = Math.floor(ar), d = `${x.dealYear}${String(x.dealMonth).padStart(2, '0')}${String(x.dealDay || '').padStart(2, '0')}`;
  return { cx, k: `${cx}|${a}`, a, price, d, id: `${cx}|${a}|${d}|${price}|${clean(x.floor)}` };
}
const fold = (base, r) => { const s = base[r.k] || (base[r.k] = [0, '', 0]); if (r.price > s[0]) { s[0] = r.price; s[1] = r.d; } s[2]++; };

await mkdir('data/nh', { recursive: true });
const out = {}, stat = [];
for (const gu of GUS) {
  const sf = `data/nh/s-${gu}.json`;
  let S = await readJ(sf, null);
  if ((!S || S.upto < CUT) && late()) { stat.push(`${gu}: 오늘 호출 상한·시간 · 다음 실행에 이어서`); continue; }   // 이미 쌓인 구는 상한과 관계없이 최근 4개월만
  const first = !S;
  if (first) S = { upto: '', base: {}, seen: {} };
  // ① 오래된 달을 base로 (처음이면 2006년부터 · 아니면 새로 4개월이 지난 달)
  const oldMonths = ymRange(S.upto ? ymNext(S.upto) : FROM, CUT);
  let failed = false;
  for (const ym of oldMonths) {
    if (late()) { failed = true; break; }
    try { for (const x of await fetchMonth(gu, ym)) { const r = rowOf(x, gu); if (r) fold(S.base, r); } S.upto = ym; }
    catch (e) { stat.push(`${gu} ${ym}: ${e.message.slice(0, 60)}`); failed = true; break; }
    await sleep(80);
  }
  if (failed && S.upto !== CUT) { await writeFile(sf, JSON.stringify(S)); stat.push(`${gu}: ${S.upto || '-'}까지 쌓음 · 다음 실행에 이어서`); continue; }
  // ② 최근 4개월 (매일 다시)
  const recent = [];
  let ok = true;
  for (const ym of ymRange(ymNext(CUT), CUR)) {
    try { for (const x of await fetchMonth(gu, ym)) { const r = rowOf(x, gu); if (r) recent.push(r); } } catch (e) { ok = false; stat.push(`${gu} ${ym}: ${e.message.slice(0, 60)}`); }
    await sleep(80);
  }
  if (!ok) { await writeFile(sf, JSON.stringify(S)); continue; }
  recent.sort((p, q) => p.d.localeCompare(q.d));
  // 처음 본 날: 처음 쌓는 날은 계약일로 (한꺼번에 '새 거래'로 보이지 않게)
  const seen = {};
  for (const r of recent) seen[r.id] = S.seen[r.id] || (first ? r.d : TODAY);
  S.seen = seen;
  // ③ 신고가 찾기 (base 위에 최근 거래를 날짜순으로)
  const run = {};
  for (const r of recent) {
    const b = run[r.k] || (run[r.k] = [...(S.base[r.k] || [0, '', 0])]);
    const sn = seen[r.id], o = out[r.cx] || (out[r.cx] = {});
    if (b[2] >= MIN_PRIOR && r.price >= b[0] * (1 + MIN_UP) && sn >= dayAdd(TODAY, -KEEP_DAYS)) (o.h || (o.h = [])).push([r.a, r.price, r.d, b[0], b[1], sn]);
    if (sn >= dayAdd(TODAY, -10) && (!o.n || sn > o.n)) o.n = sn;   // 새 실거래 (화면은 7일)
    if (r.price > b[0]) { b[0] = r.price; b[1] = r.d; } b[2]++;
  }
  await writeFile(sf, JSON.stringify(S));
  stat.push(`${gu}: ${first ? '처음 쌓음 · ' : ''}최근 ${recent.length}건`);
}
for (const k of Object.keys(out)) if (!out[k].h && !out[k].n) delete out[k];
// 다른 구가 이번에 실패했으면 지난 결과를 그대로 (그 구 단지는 지난 파일에서 가져옴)
const prev = await readJ('data/nh-11.json', { d: {} });
const done = new Set(stat.filter(s => /최근 \d+건/.test(s)).map(s => s.slice(0, 5)));
for (const [k, v] of Object.entries(prev.d || {})) { const gu = /^\d{5}/.test(k) ? k.slice(0, 5) : ''; if (gu && !done.has(gu) && !out[k]) out[k] = v; }
await writeFile('data/nh-11.json', JSON.stringify({ updated: TODAY, rule: { minPrior: MIN_PRIOR, minUp: MIN_UP, from: FROM }, d: out }));
log(stat.join('\n'));
log(`호출 ${calls}번 · 단지 ${Object.keys(out).length}곳 · 신고가 ${Object.values(out).filter(v => v.h).length}곳 · 새 거래 ${Object.values(out).filter(v => v.n).length}곳`);
