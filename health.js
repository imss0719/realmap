// 연결 점검: 키마다 실제로 한 번씩 호출해 보고 결과를 알려 줍니다.
// GET /api/health
import { send, settle, vworldNed, vworldData, dataGoKr, DATA_KEY, VWORLD_KEY, VWORLD_DOMAIN } from './_lib.js';

// 점검용 표본: 서울 마포구청 부지 (성산동 370-1)
const PNU0 = '1144012500103700001';
const PT = { lng: 126.9015, lat: 37.5663 };
const HUB = 'https://apis.data.go.kr/1613000/BldRgstHubService/';
const RT = 'https://apis.data.go.kr/1613000/';

function lastMonth() {
  const k = new Date(Date.now() + 9 * 3600e3); let y = k.getUTCFullYear(), m = k.getUTCMonth();
  if (!m) { m = 12; y--; } return `${y}${String(m).padStart(2, '0')}`;
}

export default async function (req, res) {
  const t = async (label, group, fn) => { const s = Date.now(); const r = await settle(fn); return { label, group, ms: Date.now() - s, ...r, data: r.ok ? r.data : undefined }; };
  const ym = lastMonth();
  const checks = [];

  checks.push({ label: '카카오 JavaScript 키 (KAKAO_JS_KEY)', group: 'env', ok: !!process.env.KAKAO_JS_KEY, message: process.env.KAKAO_JS_KEY ? '입력됨 · 지도가 안 뜨면 카카오에 사이트 도메인 등록을 확인하세요' : '비어 있음' });
  checks.push({ label: '브이월드 키 (VWORLD_KEY)', group: 'env', ok: !!VWORLD_KEY, message: VWORLD_KEY ? `입력됨 · 도메인 ${VWORLD_DOMAIN || '(VWORLD_DOMAIN 비어 있음)'}` : '비어 있음' });
  checks.push({ label: '공공데이터포털 키 (DATA_GO_KR_KEY)', group: 'env', ok: !!DATA_KEY, message: DATA_KEY ? '입력됨' : '비어 있음' });

  const jobs = [];
  // 표본 좌표에서 실제 PNU를 받아 이후 점검에 사용
  let PNU = PNU0;
  if (VWORLD_KEY) {
    const first = await t('브이월드 · 연속지적도', 'vworld', async () => { const f = await vworldData({ data: 'LP_PA_CBND_BUBUN', geomFilter: `POINT(${PT.lng} ${PT.lat})` }); if (!f.length) throw new Error('결과 0건'); PNU = f[0].properties?.pnu || PNU0; return `${f[0].properties?.addr} (PNU ${PNU})`; });
    jobs.push(Promise.resolve(first));
    jobs.push(t('브이월드 · 토지특성', 'vworld', async () => { const y = new Date().getFullYear(); let r = await vworldNed('getLandCharacteristics', { pnu: PNU, stdrYear: y }); if (!r.length) r = await vworldNed('getLandCharacteristics', { pnu: PNU, stdrYear: y - 1 }); if (!r.length) throw new Error('결과 0건'); return `${r[0].lndcgrCodeNm} · ${r[0].prposArea1Nm}`; }));
    jobs.push(t('브이월드 · 토지이용계획', 'vworld', async () => { const r = await vworldNed('getLandUseAttr', { pnu: PNU }); if (!r.length) throw new Error('결과 0건'); return `${r.length}건`; }));
    jobs.push(t('브이월드 · 토지소유정보', 'vworld', async () => { const r = await vworldNed('getPossessionAttr', { pnu: PNU }); if (!r.length) throw new Error('결과 0건'); return r[0].posesnSeCodeNm; }));
    jobs.push(t('브이월드 · 개별공시지가', 'vworld', async () => { const y = new Date().getFullYear() - 1; const r = await vworldNed('getIndvdLandPriceAttr', { pnu: PNU, stdrYear: y }); if (!r.length) throw new Error('결과 0건'); return `${y}년 ${Number(r[0].pblntfPclnd).toLocaleString()}원/㎡`; }));
    jobs.push(t('브이월드 · 토지이동이력 (선택)', 'vworld', async () => { const r = await vworldNed('getLandMoveAttr', { pnu: PNU }); return `${r.length}건`; }));
  }
  if (DATA_KEY) {
    const q = { sigunguCd: PNU.slice(0, 5), bjdongCd: PNU.slice(5, 10), platGbCd: PNU[10] === '2' ? '1' : '0', bun: PNU.slice(11, 15), ji: PNU.slice(15, 19), _type: 'json', numOfRows: 5, pageNo: 1 };
    jobs.push(t('건축HUB · 건축물대장 표제부', 'data', async () => { const r = await dataGoKr(HUB + 'getBrTitleInfo', q); if (!r.total) throw new Error(`결과 0건 · 응답 원문: ${r.raw}`); return `${r.total}건 · ${r.items[0]?.mainPurpsCdNm || ''}`; }));
    const rt = (label, path) => jobs.push(t(label, 'data', async () => { const r = await dataGoKr(RT + path, { LAWD_CD: '11440', DEAL_YMD: ym, numOfRows: 1, pageNo: 1 }); if (!r.total) throw new Error(`${ym.slice(0, 4)}.${ym.slice(4)} 마포구 0건 · 응답 원문: ${r.raw}`); return `${ym.slice(0, 4)}.${ym.slice(4)} 마포구 ${r.total}건`; }));
    rt('실거래 · 아파트 매매', 'RTMSDataSvcAptTradeDev/getRTMSDataSvcAptTradeDev');
    rt('실거래 · 아파트 전월세', 'RTMSDataSvcAptRent/getRTMSDataSvcAptRent');
    rt('실거래 · 연립다세대 매매', 'RTMSDataSvcRHTrade/getRTMSDataSvcRHTrade');
    rt('실거래 · 연립다세대 전월세', 'RTMSDataSvcRHRent/getRTMSDataSvcRHRent');
    rt('실거래 · 단독다가구 매매', 'RTMSDataSvcSHTrade/getRTMSDataSvcSHTrade');
    rt('실거래 · 단독다가구 전월세', 'RTMSDataSvcSHRent/getRTMSDataSvcSHRent');
    rt('실거래 · 오피스텔 매매', 'RTMSDataSvcOffiTrade/getRTMSDataSvcOffiTrade');
    rt('실거래 · 오피스텔 전월세', 'RTMSDataSvcOffiRent/getRTMSDataSvcOffiRent');
    rt('실거래 · 상업업무용 매매', 'RTMSDataSvcNrgTrade/getRTMSDataSvcNrgTrade');
    rt('실거래 · 토지 매매', 'RTMSDataSvcLandTrade/getRTMSDataSvcLandTrade');
  }
  const hasStore = !!((process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL) && (process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN));
  checks.push({ label: '개발정보 저장소 (Upstash Redis) (선택)', group: 'env', ok: hasStore, message: hasStore ? '연결됨' : '연결 안 됨 · 개발지도 구역을 등록하려면 Vercel Storage에서 연결하세요' });
  checks.push({ label: '관리자 비밀번호 (ADMIN_PASSWORD) (선택)', group: 'env', ok: !!(process.env.ADMIN_PASSWORD || '').trim(), message: (process.env.ADMIN_PASSWORD || '').trim() ? '입력됨' : '비어 있음 · 관리자 화면을 쓰려면 입력하세요' });
  const results = await Promise.all(jobs);
  for (const r of results) checks.push({ label: r.label, group: r.group, ok: r.ok, message: r.ok ? String(r.data ?? '정상') : r.message, ms: r.ms });

  send(res, 200, { ok: checks.every(c => c.ok || c.label.includes('(선택)')), time: new Date().toISOString(), checks });
}
