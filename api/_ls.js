// 매물장 저장 (10/27 저장 구조 변경) — '_'로 시작해 Vercel 함수 수에 들어가지 않음
//
// 예전: realmap:ls:<회원id> = 매물 전체를 JSON 한 덩어리 (저장할 때마다 통째로 덮어씀 → 동시에 저장하면 서로 덮어쓸 수 있음, 수천 건이면 느림)
// 지금: realmap:lsh:<회원id> = 해시 · 필드 = 매물 id · 값 = 'v1:' + AES-256-GCM 암호문 (LEDGER_KEY · 단지 장부·고객관리와 같은 방식)
//       realmap:lsv:<회원id> = '2' → 새 방식으로 옮겨 둔 회원
//       realmap:lsbak:<회원id> = 옮길 때 예전 덩어리 그대로 백업 (2단계에서 정리)
// 저장은 '바뀐 매물만' HSET · '지운 매물만' HDEL → 다른 매물을 동시에 고쳐도 서로 덮어쓰지 않음
// 1단계(지금): 새 방식으로 읽고 쓰되, 되돌리기 쉽게 예전 덩어리(realmap:ls)도 같이 저장(DUAL). 2단계: DUAL = false 로 끄고 백업 정리.
import { seal, unseal, ledgerReady } from './_ledger.js';

const DUAL = true;
const K = { h: u => `realmap:lsh:${u}`, v: u => `realmap:lsv:${u}`, old: u => `realmap:ls:${u}`, bak: u => `realmap:lsbak:${u}` };
const enc = x => (ledgerReady() ? seal(x) : 'p:' + JSON.stringify(x));   // 키가 없을 때(시범 서버 등)만 평문
const dec = v => { const s = String(v || ''); try { return s.startsWith('v1:') ? unseal(s) : s.startsWith('p:') ? JSON.parse(s.slice(2)) : null; } catch { return null; } };
const newest = a => a.sort((x, y) => String(y.at || '').localeCompare(String(x.at || '')) || String(y.id).localeCompare(String(x.id)));
const flat = raw => (Array.isArray(raw) ? raw : Object.entries(raw || {}).flat());

async function hsetMany(redis, key, pairs) {   // 한 번에 너무 길지 않게 200건씩
  for (let i = 0; i < pairs.length; i += 200) await redis(['HSET', key, ...pairs.slice(i, i + 200).flat()]);
}

// 읽기 → { items(새 것부터), prev(Map id→저장된 JSON 글자) , bad(읽지 못한 수) }
export async function lsLoad(redis, uid) {
  if ((await redis(['GET', K.v(uid)])) !== '2') await migrate(redis, uid);
  const arr = flat(await redis(['HGETALL', K.h(uid)]));
  const items = [], prev = new Map(); let bad = 0;
  for (let i = 0; i + 1 < arr.length; i += 2) { const x = dec(arr[i + 1]); if (!x || !x.id) { bad++; continue; } items.push(x); prev.set(String(x.id), JSON.stringify(x)); }
  prev.bad = bad;   // 읽지 못한 매물이 있으면(암호화 키 문제 등) 저장을 막아 예전 덩어리·목록을 줄어든 채로 덮어쓰지 않게
  if (bad) console.error(`[ls] ${uid}: ${bad}건을 읽지 못함 (LEDGER_KEY 확인)`);
  return { items: newest(items), prev, bad };
}
// 저장: 바뀐 것만 쓰고, 없어진 것만 지움
export async function lsSave(redis, uid, items, prev) {
  if (prev && prev.bad) throw new Error('매물 일부를 읽지 못해 저장을 멈췄습니다. 자료는 그대로 있으니 운영자에게 알려 주세요.');
  const now = new Map(items.map(x => [String(x.id), x]));
  const put = [], del = [];
  for (const [id, x] of now) { const j = JSON.stringify(x); if (!prev || prev.get(id) !== j) put.push([id, enc(x)]); }
  if (prev) for (const id of prev.keys()) if (!now.has(id)) del.push(id);
  if (put.length) await hsetMany(redis, K.h(uid), put);
  for (let i = 0; i < del.length; i += 500) await redis(['HDEL', K.h(uid), ...del.slice(i, i + 500)]);
  if (DUAL) { try { await redis(['SET', K.old(uid), JSON.stringify(newest([...items]))]); } catch { /* 예전 덩어리는 되돌리기용일 뿐 */ } }
  if (prev) { prev.clear(); for (const [id, x] of now) prev.set(id, JSON.stringify(x)); }   // 같은 요청에서 또 저장해도 바뀐 것만
  return { put: put.length, del: del.length };
}
// 읽고 → 고치고(fn) → 바뀐 것만 저장. fn이 false를 돌려주면 저장 안 함
export async function lsMutate(redis, uid, fn) {
  const L = await lsLoad(redis, uid);
  const r = await fn(L.items);
  if (r !== false) await lsSave(redis, uid, L.items, L.prev);
  return L.items;
}
// 전부 지움 (해지·탈퇴) — 사진 정리용으로 지우기 전 목록을 돌려줌
export async function lsDrop(redis, uid) {
  let items = [];
  try { items = (await lsLoad(redis, uid)).items; } catch { /* 이미 비었음 */ }
  for (const k of [K.h(uid), K.v(uid), K.old(uid), K.bak(uid)]) { try { await redis(['DEL', k]); } catch { /* 다음 */ } }
  return items;
}
// 처음 한 번: 예전 덩어리 → 해시 (덩어리는 백업으로 남김)
async function migrate(redis, uid) {
  // 동시에 두 요청이 옮기지 않게 30초 잠금 — 잠금을 못 잡으면 다른 요청이 끝내기를 잠깐 기다림
  if ((await redis(['SET', `realmap:lsm:${uid}`, '1', 'NX', 'EX', 30])) !== 'OK') {
    for (let i = 0; i < 20; i++) { await new Promise(r => setTimeout(r, 300)); if ((await redis(['GET', K.v(uid)])) === '2') return; }
    throw new Error('매물장을 준비하는 중입니다. 잠시 뒤 다시 열어 주세요.');
  }
  const raw = await redis(['GET', K.old(uid)]);
  let old = [];
  if (raw) { try { old = JSON.parse(raw); } catch { old = null; } if (!Array.isArray(old)) throw new Error('예전 매물장 자료를 읽지 못했습니다. 운영자에게 알려 주세요.'); }   // 깨진 자료는 옮기지 않음(원본 보존)
  if (old.length) {
    const seen = new Set(), pairs = [];
    for (const x of old) { if (!x || !x.id || seen.has(String(x.id))) continue; seen.add(String(x.id)); pairs.push([String(x.id), enc(x)]); }   // 같은 id가 두 번이면 앞(새 것)만
    await hsetMany(redis, K.h(uid), pairs);
    await redis(['SET', K.bak(uid), raw]);
  }
  await redis(['SET', K.v(uid), '2']);
  await redis(['DEL', `realmap:lsm:${uid}`]);
}
