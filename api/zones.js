// 리얼워커스 개발정보 (재개발·재건축·신속통합기획·모아타운 등) 저장소
// GET  /api/zones                 → 공개 구역 목록
// POST /api/zones  (관리자 전용)   → { action: 'ping' | 'save' | 'delete', zone, id }
//   요청 헤더 x-admin-key 에 ADMIN_PASSWORD 와 같은 값이 있어야 합니다.
import { send, fail } from './_lib.js';

const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '';
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '';
const ADMIN = (process.env.ADMIN_PASSWORD || '').trim();
const KEY = 'realmap:zones';

async function redis(cmd) {
  const r = await fetch(URL_, { method: 'POST', headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify(cmd) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error(j.error || `저장소 응답 오류 (HTTP ${r.status})`);
  return j.result;
}
async function load() { const v = await redis(['GET', KEY]); try { return v ? JSON.parse(v) : []; } catch { return []; } }
async function save(list) { await redis(['SET', KEY, JSON.stringify(list)]); }

const clean = (s, n = 200) => String(s ?? '').trim().slice(0, n);

export default async function (req, res) {
  const storage = !!(URL_ && TOKEN);
  try {
    if (req.method === 'GET') {
      if (!storage) return send(res, 200, { ok: true, storage: false, zones: [] });
      const all = await load();
      const admin = ADMIN && req.headers['x-admin-key'] === ADMIN;
      return send(res, 200, { ok: true, storage: true, zones: admin ? all : all.filter(z => z.public !== false) }, admin ? 0 : 60);
    }
    if (req.method !== 'POST') return fail(res, 405, 'method', '허용되지 않는 요청입니다.');
    if (!ADMIN) return fail(res, 500, 'no_admin', 'Vercel 환경변수 ADMIN_PASSWORD 가 비어 있습니다.');
    if (req.headers['x-admin-key'] !== ADMIN) return fail(res, 401, 'auth', '관리자 비밀번호가 맞지 않습니다.');
    if (!storage) return fail(res, 500, 'no_storage', '저장소(Upstash Redis)가 연결되지 않았습니다. Vercel의 Storage 메뉴에서 연결해 주세요.');

    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    if (body.action === 'ping') return send(res, 200, { ok: true });

    const list = await load();
    if (body.action === 'delete') {
      const next = list.filter(z => z.id !== body.id);
      await save(next);
      return send(res, 200, { ok: true, count: next.length });
    }
    if (body.action === 'save') {
      const z = body.zone || {};
      if (!clean(z.name)) return fail(res, 400, 'bad_zone', '구역 이름을 입력해 주세요.');
      if (!z.geometry && !z.point) return fail(res, 400, 'bad_zone', '지도에서 구역이나 위치를 지정해 주세요.');
      const item = {
        id: clean(z.id, 40) || Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        name: clean(z.name, 80), type: clean(z.type, 30), stage: clean(z.stage, 30), stageDate: clean(z.stageDate, 20),
        households: clean(z.households, 20), area: Number(z.area) || null, builder: clean(z.builder, 60),
        note: clean(z.note, 2000), source: clean(z.source, 400), public: z.public !== false,
        pnus: Array.isArray(z.pnus) ? z.pnus.slice(0, 3000).map(p => clean(p, 19)) : [],
        geometry: z.geometry || null, point: z.point || null,
        updated: new Date().toISOString(),
      };
      const i = list.findIndex(x => x.id === item.id);
      if (i >= 0) list[i] = item; else list.push(item);
      await save(list);
      return send(res, 200, { ok: true, zone: item });
    }
    return fail(res, 400, 'bad_action', '알 수 없는 요청입니다.');
  } catch (e) {
    return fail(res, 502, 'storage', e.message || '저장소 처리 중 오류가 발생했습니다.');
  }
}
