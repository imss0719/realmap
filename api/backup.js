// 11/2 회원 자료 자동 백업 → 선배 구글 드라이브 '리얼맵 백업' 폴더 (매일 새벽 3시 · vercel.json crons)
//   Upstash 저장소 전체(잠깐 쓰는 조회 저장분 rmc:* 은 빼고, 좌표장 rmc:geo:* 는 넣음)를 한 파일로 → gzip → 드라이브에 올림
//   보관: 최근 30일은 매일치 · 그보다 오래된 것은 매월 1일치만 남기고 지움 · 실패하면 운영자 휴대폰 문자
//   실행: Vercel Cron(Authorization: Bearer CRON_SECRET) 또는 운영자 카카오로 로그인한 브라우저에서 /api/backup (시험용)
//   필요한 환경변수(Vercel): GDRIVE_CLIENT_ID · GDRIVE_CLIENT_SECRET · GDRIVE_REFRESH_TOKEN · CRON_SECRET
//   권한은 drive.file — 이 백업이 만든 파일·폴더만 보고 고칠 수 있음 (선배 드라이브의 다른 파일은 못 봄)
import zlib from 'node:zlib';
import { readSession, opSms } from './auth.js';

const R_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || Object.entries(process.env).find(([k]) => /_REST_API_URL$/.test(k))?.[1] || '';
const R_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || Object.entries(process.env).find(([k]) => /_REST_API_TOKEN$/.test(k) && !/READ_ONLY/.test(k))?.[1] || '';
const G = { id: String(process.env.GDRIVE_CLIENT_ID || '').trim(), secret: String(process.env.GDRIVE_CLIENT_SECRET || '').trim(), refresh: String(process.env.GDRIVE_REFRESH_TOKEN || '').trim() };   // 11/3 붙여 넣을 때 딸려 온 빈칸·줄바꿈 제거
const ADMIN_ID = String(process.env.ADMIN_KAKAO_ID || '').trim();
const FOLDER = '리얼맵 백업';
const KEEP_DAYS = 30;

async function pipe(cmds) {
  const r = await fetch(R_URL.replace(/\/$/, '') + '/pipeline', { method: 'POST', headers: { Authorization: `Bearer ${R_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify(cmds) });
  if (!r.ok) throw new Error(`저장소 HTTP ${r.status}`);
  return (await r.json()).map(x => x.result);
}
// 저장소 전체 읽기
async function dump() {
  const keys = [];
  let cur = '0';
  do {
    const [res] = await pipe([['SCAN', cur, 'COUNT', '1000']]);
    cur = String(res[0]);
    for (const k of res[1]) if (!k.startsWith('rmc:') || k.startsWith('rmc:geo:')) keys.push(k);
  } while (cur !== '0');
  const out = {};
  for (let i = 0; i < keys.length; i += 200) {
    const ks = keys.slice(i, i + 200);
    const types = await pipe(ks.map(k => ['TYPE', k]));
    const cmds = [];
    ks.forEach((k, j) => {
      const t = types[j];
      cmds.push(t === 'string' ? ['GET', k] : t === 'hash' ? ['HGETALL', k] : t === 'set' ? ['SMEMBERS', k] : t === 'list' ? ['LRANGE', k, '0', '-1'] : t === 'zset' ? ['ZRANGE', k, '0', '-1', 'WITHSCORES'] : ['TYPE', k]);
      cmds.push(['PTTL', k]);
    });
    const vals = await pipe(cmds);
    ks.forEach((k, j) => { const t = types[j]; if (t === 'none') return; out[k] = { t, v: vals[j * 2], ttl: vals[j * 2 + 1] > 0 ? vals[j * 2 + 1] : -1 }; });
  }
  return out;
}

// 구글 드라이브
async function token() {
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: G.id, client_secret: G.secret, refresh_token: G.refresh, grant_type: 'refresh_token' }) });
  const j = await r.json();
  if (!j.access_token) throw new Error(`구글 로그인 실패 (${j.error || r.status}${j.error_description ? ' · ' + j.error_description : ''}) — 클라이언트 ID ${G.id.slice(0, 12)}… 로 시도 · 구글 연결을 다시 해야 할 수 있습니다`);
  return j.access_token;
}
const gd = async (tk, url, opt = {}) => { const r = await fetch(url, { ...opt, headers: { Authorization: `Bearer ${tk}`, ...(opt.headers || {}) } }); if (!r.ok) throw new Error(`드라이브 HTTP ${r.status} ${(await r.text()).slice(0, 120)}`); return r; };
async function folderId(tk) {
  const q = encodeURIComponent(`name='${FOLDER}' and mimeType='application/vnd.google-apps.folder' and trashed=false`);
  const j = await (await gd(tk, `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id)`)).json();
  if (j.files && j.files[0]) return j.files[0].id;
  const c = await (await gd(tk, 'https://www.googleapis.com/drive/v3/files?fields=id', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: FOLDER, mimeType: 'application/vnd.google-apps.folder' }) })).json();
  return c.id;
}
async function upload(tk, parent, name, buf) {
  const s = await gd(tk, 'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,size', { method: 'POST', headers: { 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': 'application/gzip', 'X-Upload-Content-Length': String(buf.length) }, body: JSON.stringify({ name, parents: [parent] }) });
  const loc = s.headers.get('location');
  return (await gd(tk, loc, { method: 'PUT', headers: { 'Content-Type': 'application/gzip' }, body: buf })).json();
}
// 보관 규칙: 30일 넘은 것 중 매월 1일치가 아닌 것은 휴지통으로
async function prune(tk, parent) {
  const q = encodeURIComponent(`'${parent}' in parents and name contains 'realmap-backup-' and trashed=false`);
  const j = await (await gd(tk, `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)&pageSize=1000`)).json();
  const lim = new Date(Date.now() + 9 * 3600e3 - KEEP_DAYS * 864e5).toISOString().slice(0, 10);
  let n = 0;
  for (const f of j.files || []) {
    const d = (f.name.match(/(\d{4}-\d{2}-\d{2})/) || [])[1];
    if (!d || d >= lim || d.endsWith('-01')) continue;
    await gd(tk, `https://www.googleapis.com/drive/v3/files/${f.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ trashed: true }) });
    n++;
  }
  return n;
}

// 11/3 복원 점검 (운영자만 · 읽기만): 드라이브의 가장 최근 백업을 받아 풀어 보고, 지금 저장소와 항목 수를 비교
//   /api/backup?check=1 → 자료를 되살리지는 않음 (실제 복원은 필요할 때 따로)
async function check(tk, fid) {
  const q = encodeURIComponent(`'${fid}' in parents and name contains 'realmap-backup-' and trashed=false`);
  const j = await (await gd(tk, `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,size,createdTime)&orderBy=createdTime desc&pageSize=1`)).json();
  const f = (j.files || [])[0]; if (!f) throw new Error('드라이브에 백업 파일이 아직 없습니다.');
  const buf = Buffer.from(await (await gd(tk, `https://www.googleapis.com/drive/v3/files/${f.id}?alt=media`)).arrayBuffer());
  const b = JSON.parse(zlib.gunzipSync(buf).toString('utf8'));
  const keys = Object.keys(b.data || {}), grp = {};
  for (const k of keys) { const g = k.split(':').slice(0, 2).join(':'); grp[g] = (grp[g] || 0) + 1; }
  let now = 0, cur = '0';
  do { const [r] = await pipe([['SCAN', cur, 'COUNT', '1000']]); cur = String(r[0]); now += r[1].filter(k => !k.startsWith('rmc:') || k.startsWith('rmc:geo:')).length; } while (cur !== '0');
  const ok = keys.length > 0 && keys.length >= now * 0.9;
  return { ok, file: f.name, made: f.createdTime, size: +f.size, backupKeys: keys.length, nowKeys: now, groups: Object.entries(grp).sort((a, c) => c[1] - a[1]).slice(0, 15),
    message: ok ? '백업 파일이 정상으로 열리고, 지금 저장소와 항목 수가 거의 같습니다. 필요할 때 이 파일로 되살릴 수 있습니다.' : '백업 파일 항목 수가 지금보다 많이 적습니다. 확인이 필요합니다.' };
}

export default async function (req, res) {
  res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Robots-Tag', 'noindex');
  const cron = process.env.CRON_SECRET && req.headers.authorization === `Bearer ${process.env.CRON_SECRET}`;
  const s = readSession(req), op = s && ADMIN_ID && String(s.id) === ADMIN_ID;
  if (!cron && !op) return res.status(403).json({ ok: false, message: '권한이 없습니다.' });
  const miss = [!R_URL || !R_TOKEN ? '저장소(Upstash)' : '', !G.id || !G.secret || !G.refresh ? '구글 드라이브 환경변수(GDRIVE_CLIENT_ID · GDRIVE_CLIENT_SECRET · GDRIVE_REFRESH_TOKEN)' : ''].filter(Boolean);
  if (miss.length) return res.status(500).json({ ok: false, message: `${miss.join(', ')} 설정이 비어 있습니다.` });
  const t0 = Date.now();
  if (op && req.query && req.query.check === '1') {
    try { const tk = await token(); return res.status(200).json(await check(tk, await folderId(tk))); }
    catch (e) { return res.status(500).json({ ok: false, message: String((e && e.message) || e).slice(0, 200) }); }
  }
  try {
    const data = await dump();
    const n = Object.keys(data).length;
    const day = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
    const buf = zlib.gzipSync(Buffer.from(JSON.stringify({ at: new Date().toISOString(), keys: n, data })));
    const tk = await token(), fid = await folderId(tk);
    const f = await upload(tk, fid, `realmap-backup-${day}${cron ? '' : '-수동'}.json.gz`, buf);
    const pruned = await prune(tk, fid);
    return res.status(200).json({ ok: true, day, keys: n, size: buf.length, file: f.id, pruned, sec: Math.round((Date.now() - t0) / 1000) });
  } catch (e) {
    const m = String((e && e.message) || e).slice(0, 160);
    try { await opSms(`[리얼맵] 자동 백업 실패: ${m.slice(0, 60)}`, 'backupfail'); } catch { /* 문자는 보조 */ }
    return res.status(500).json({ ok: false, message: m });
  }
}
