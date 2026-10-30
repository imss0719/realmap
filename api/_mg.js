// 10/30 주거용 관리비 세분화 (국토부 2024.5.30 「관리비 부과내역 세분화 표시」) — 서버용
//   화면용은 mgmt.js (window.Mg) — 이름·순서를 똑같이 맞춰 둘 것
//   mg2 = { t: 부과타입, b: 부과기준, bTx, s: 기타부과 세부타입, sTx, inc: 포함 항목, it: 정액 항목별 { v: 만원, r: 실비 }, na: 확인불가 사유, naTx }
//   주거용(아파트·빌라·오피스텔·주택 · 재개발·재건축의 물건 형태 포함)만 씀 · 그 밖의 종류는 월평균 관리비 금액(x.mgmt) 하나
export const MG_T = { fix: '정액관리비', etc: '기타부과', na: '확인불가', nod: '정액관리비 (세부내역 미고지)' };
export const MG_B = { m1: '직전월 관리비', m3: '최근 3개월 평균', y1: '최근 1년 평균', etc: '기타' };
export const MG_S = { rule: '관리규약 등에 따라 부과', area: '공용관리비는 면적·세대별, 사용료는 사용량에 따라 부과', split: '전체 사용량을 세대수로 나누어 부과', meter: '세대별 사용량(별도 계량기)에 따라 부과', lt10: '정액관리비가 10만원 미만인 경우', etc: '기타' };
export const MG_NA = { house: '단독주택 (건축법 시행령 별표1 제1호 가목)', shop: '오피스텔 제외 상가 건물', unreg: '미등기·신축 등 관리비 내역 확인 불가', none: '관리비 없음' };
export const MG_INC = { elec: '전기', gas: '가스', water: '수도', heat: '난방', net: '인터넷', tv: 'TV', gen: '공용관리비', etc: '기타관리비' };
export const MG_IT = { gen: '공용관리비', elec: '전기', water: '수도', gas: '가스', heat: '난방', net: '인터넷', tv: 'TV', etc: '기타관리비' };

const str = (v, n) => String(v ?? '').replace(/[<>"]/g, '').trim().slice(0, n);
const man = v => { const x = Number(String(v ?? '').replace(/[^\d.]/g, '')); return x > 0 && x < 1e5 ? Math.round(x * 100) / 100 : null; };

export function mgClean(o) {
  if (!o || typeof o !== 'object' || !MG_T[o.t]) return null;
  const it = {};
  if (o.t === 'fix') for (const k of Object.keys(MG_IT)) { const z = (o.it || {})[k] || {}; const v = man(z.v), r = !!z.r && !v; if (v || r) it[k] = r ? { r: true } : { v }; }
  return {
    t: o.t, b: MG_B[o.b] ? o.b : '', bTx: o.b === 'etc' ? str(o.bTx, 30) : '',
    s: o.t === 'etc' && MG_S[o.s] ? o.s : '', sTx: o.t === 'etc' && o.s === 'etc' ? str(o.sTx, 50) : '',
    inc: ['etc', 'nod'].includes(o.t) ? (Array.isArray(o.inc) ? o.inc : []).filter(k => MG_INC[k]).slice(0, 8) : [],
    ...(o.t === 'fix' ? { it } : {}),
    na: o.t === 'na' && MG_NA[o.na] ? o.na : '', naTx: o.t === 'na' && o.na === 'none' ? str(o.naTx, 50) : '',
  };
}
// 저장된 값이 없으면 예전 값에서 옮김 → 그래도 없으면 아파트 대부분인 '기타부과 · 최근 1년 평균 · 관리규약 등에 따라'
export function mgNorm(a) {
  a = a || {};
  if (a.mg2 && MG_T[a.mg2.t]) return a.mg2;
  if (a.nomgmt) return { t: 'na', b: '', bTx: '', s: '', sTx: '', inc: [], na: 'none', naTx: '' };
  const inc = (Array.isArray(a.mgmtInc) ? a.mgmtInc : []).filter(k => MG_INC[k]);
  if (a.mgmtT === 'fix') return { t: 'nod', b: 'y1', bTx: '', s: '', sTx: '', inc, na: '', naTx: '' };
  return { t: 'etc', b: 'y1', bTx: '', s: a.mgmtT === 'use' ? 'area' : 'rule', sTx: '', inc, na: '', naTx: '' };
}
export const mgSum = mg => Math.round(Object.values((mg && mg.it) || {}).reduce((s, z) => s + (+z.v || 0), 0) * 100) / 100;
// 주거용 광고에 빠진 것
export function mgMiss(x) {
  const mg = mgNorm(x.ad), out = [];
  if (mg.t !== 'na' && !mg.b) out.push('관리비 부과기준');
  if (mg.t === 'na') { if (!mg.na || (mg.na === 'none' && !mg.naTx)) out.push('관리비 세부내역'); return out; }
  if (mg.t === 'fix') { if (!Object.keys(mg.it || {}).length) out.push('관리비 세부내역'); return out; }
  if (!x.mgmt) out.push('관리비');
  if (mg.t === 'etc' && (!mg.s || (mg.s === 'etc' && !mg.sTx))) out.push('관리비 세부내역');
  return out;
}
// 공개 화면에 보일 한 덩어리 (app.js가 그대로 씀)
export function mgPub(x) {
  const mg = mgNorm(x.ad);
  return { t: mg.t, tx: MG_T[mg.t], sum: mg.t === 'fix' ? mgSum(mg) : null, b: mg.b === 'etc' ? mg.bTx || '기타' : MG_B[mg.b] || '', s: mg.s === 'etc' ? mg.sTx || '기타' : MG_S[mg.s] || '',
    inc: (mg.inc || []).map(k => MG_INC[k]), it: mg.t === 'fix' ? Object.entries(mg.it || {}).map(([k, z]) => [MG_IT[k], z.r ? '실비' : `${z.v}만원`]) : [],
    na: mg.na === 'none' ? `관리비 없음${mg.naTx ? ' (' + mg.naTx + ')' : ''}` : MG_NA[mg.na] || '' };
}
