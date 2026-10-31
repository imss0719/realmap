// 10/30 주거용 관리비 세분화 (국토부 2024.5.30 「관리비 부과내역 세분화 표시」) — 화면용 (중개장부 입력창 · 리얼맵 올리기 · 지도 매물 상세)
//   서버용은 api/_mg.js — 이름·순서를 똑같이 맞춰 둘 것
//   mg2 = { t: 부과타입, b: 부과기준, bTx, s: 기타부과 세부타입, sTx, inc: 포함 항목, it: 정액 항목별 { v: 만원 } 또는 { r: 실비 }, na: 확인불가 사유, naTx }
//   주거용만 씀 · 상가·사무실·건물 등은 월평균 관리비 금액(x.mgmt) 하나 (그 줄은 각 입력창이 그림)
window.Mg = (() => {
  const T = { fix: '정액관리비', etc: '기타부과', na: '확인불가', nod: '정액관리비 (세부내역 미고지)' };
  const TS = { fix: '정액', etc: '기타부과', na: '확인불가', nod: '정액·세부 미고지' };   // 버튼 글자
  const B = { m1: '직전월 관리비', m3: '최근 3개월 평균', y1: '최근 1년 평균', etc: '기타' };
  const BS = { m1: '직전월', m3: '최근 3개월 평균', y1: '최근 1년 평균', etc: '기타' };
  const S = { rule: '관리규약 등에 따라 부과', area: '공용관리비는 면적·세대별, 사용료는 사용량에 따라 부과', split: '전체 사용량을 세대수로 나누어 부과', meter: '세대별 사용량(별도 계량기)에 따라 부과', lt10: '정액관리비가 10만원 미만인 경우', etc: '기타 (직접 입력)' };
  const NA = { house: '단독주택 (건축법 시행령 별표1 제1호 가목)', shop: '오피스텔 제외 상가 건물', unreg: '미등기·신축 등 관리비 내역 확인 불가', none: '관리비 없음' };
  const INC = { elec: '전기', gas: '가스', water: '수도', heat: '난방', net: '인터넷', tv: 'TV', gen: '공용관리비', etc: '기타관리비' };
  const IT = { gen: '공용관리비', elec: '전기', water: '수도', gas: '가스', heat: '난방', net: '인터넷', tv: 'TV', etc: '기타관리비' };
  const RES = ['아파트', '빌라', '오피스텔', '주택'];
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const str = (v, n) => String(v ?? '').replace(/[<>"]/g, '').trim().slice(0, n);
  const man = v => { const x = Number(String(v ?? '').replace(/[^\d.]/g, '')); return x > 0 && x < 1e5 ? Math.round(x * 100) / 100 : null; };
  const isRes = tb => RES.includes(tb || '');

  function clean(o) {
    if (!o || !T[o.t]) return null;
    const it = {};
    if (o.t === 'fix') for (const k of Object.keys(IT)) { const z = (o.it || {})[k] || {}; const v = man(z.v), r = !!z.r && !v; if (v || r) it[k] = r ? { r: true } : { v }; }
    return {
      t: o.t, b: B[o.b] ? o.b : '', bTx: o.b === 'etc' ? str(o.bTx, 30) : '',
      s: o.t === 'etc' && S[o.s] ? o.s : '', sTx: o.t === 'etc' && o.s === 'etc' ? str(o.sTx, 50) : '',
      inc: ['etc', 'nod'].includes(o.t) ? (Array.isArray(o.inc) ? o.inc : []).filter(k => INC[k]).slice(0, 8) : [],
      ...(o.t === 'fix' ? { it } : {}),
      na: o.t === 'na' && NA[o.na] ? o.na : '', naTx: o.t === 'na' && o.na === 'none' ? str(o.naTx, 50) : '',
    };
  }
  // 저장된 값이 없으면 예전 값에서 옮김 → 그래도 없으면 '기타부과 · 최근 1년 평균 · 관리규약 등에 따라' (선배 10/30: 미리 골라 둠)
  function norm(a) {
    a = a || {};
    if (a.mg2 && T[a.mg2.t]) return a.mg2;
    if (a.nomgmt) return { t: 'na', b: '', bTx: '', s: '', sTx: '', inc: [], na: 'none', naTx: '' };
    const inc = (Array.isArray(a.mgmtInc) ? a.mgmtInc : []).filter(k => INC[k]);
    if (a.mgmtT === 'fix') return { t: 'nod', b: 'y1', bTx: '', s: '', sTx: '', inc, na: '', naTx: '' };
    return { t: 'etc', b: 'y1', bTx: '', s: a.mgmtT === 'use' ? 'area' : 'rule', sTx: '', inc, na: '', naTx: '' };
  }
  const sum = mg => Math.round(Object.values((mg && mg.it) || {}).reduce((s, z) => s + (+z.v || 0), 0) * 100) / 100;
  // 광고에 빠진 것 (amt: 관리비 금액 · 만원)
  function miss(a, amt) {
    const mg = norm(a), out = [];
    if (mg.t !== 'na' && !mg.b) out.push('관리비 부과기준');
    if (mg.t === 'na') { if (!mg.na || (mg.na === 'none' && !mg.naTx)) out.push('관리비 세부내역'); return out; }
    if (mg.t === 'fix') { if (!Object.keys(mg.it || {}).length) out.push('관리비 세부내역'); return out; }
    if (!amt) out.push('관리비');
    if (mg.t === 'etc' && (!mg.s || (mg.s === 'etc' && !mg.sTx))) out.push('관리비 세부내역');
    return out;
  }
  // 입력창 줄 3개: 관리비(부과타입) · 부과기준 · 세부내역(또는 사유)
  //   o.row(label, inner, cls) — 각 입력창의 줄 모양 · o.amt — 그 입력창의 관리비 금액 칸 · o.dis · o.nd(빠진 것 목록)
  function rows(a, amt, o) {
    const mg = norm(a), d = o.dis || '', nd = o.nd || [];
    const seg = (attr, list, cur) => `<span class="rpseg">${list.map(([k, t]) => `<button type="button" ${attr}="${k}" aria-pressed="${cur === k}" ${d}>${t}</button>`).join('')}</span>`;
    const inp = (attr, v, w, ph = '') => `<input class="rpi" ${attr} data-fk="mg:${attr}" value="${esc(v || '')}" placeholder="${esc(ph)}" style="width:${w}px" ${d}>`;
    const sel = (attr, L, cur, ph) => `<select class="rpi mgsel" ${attr} ${d}><option value="">${ph}</option>${Object.entries(L).map(([k, t]) => `<option value="${k}" ${cur === k ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>`;
    const incH = `<span class="mginc">${Object.entries(INC).map(([k, t]) => `<label><input type="checkbox" data-mginc="${k}" ${(mg.inc || []).includes(k) ? 'checked' : ''} ${d}>${t}</label>`).join('')}</span>`;
    const ndc = k => nd.includes(k) ? ' nd' : '';
    let det = '', dl = '세부내역';
    if (mg.t === 'fix') {
      det = `<span class="mgit">${Object.entries({ ...IT, gen: '공용', etc: '기타' }).map(([k, t]) => { const z = (mg.it || {})[k] || {}; return `<span><em>${t}</em><input class="rpi" data-mgit="${k}" data-fk="mg:it:${k}" value="${z.v || ''}" inputmode="decimal" style="width:42px" ${z.r ? 'disabled' : d}><i class="u">만</i><span class="rpseg sm"><button type="button" tabindex="-1" data-mgr="${k}" data-v="" aria-pressed="${!z.r && !!z.v}" ${d}>정액</button><button type="button" tabindex="-1" data-mgr="${k}" data-v="r" aria-pressed="${!!z.r}" ${d}>실비</button></span></span>`; }).join('')}</span><b class="mgsum">합계 월 ${sum(mg) ? sum(mg) + '만원' : '-'}</b>`;
    } else if (mg.t === 'etc') {
      det = `${sel('data-mgs', S, mg.s, '세부타입 선택')}${mg.s === 'etc' ? inp('data-mgstx', mg.sTx, 160, '기타 부과 사유 (필수)') : ''} ${amt}${incH}`;
    } else if (mg.t === 'nod') {
      det = `${amt}${incH}`;
    } else {
      dl = '사유';
      det = `${sel('data-mgna', NA, mg.na, '확인불가 사유 선택')}${mg.na === 'none' ? inp('data-mgnatx', mg.naTx, 160, '세부 사유 (필수)') : ''}`;
    }
    return o.row('관리비', seg('data-mgt2', Object.entries(TS), mg.t), '')
      + o.row('부과기준', `${seg('data-mgb', Object.entries(BS), mg.b)}${mg.b === 'etc' ? inp('data-mgbtx', mg.bTx, 120, '직접 입력') : ''}${mg.t === 'na' ? '<i class="u">선택</i>' : ''}`, ndc('관리비 부과기준'))
      + o.row(dl, det, ndc('관리비 세부내역') || ndc('관리비'));
  }
  // 칸을 고치면 save(새 mg2, 정액이면 항목 합계)
  function wire(root, cur, save) {
    const up = f => { const mg = JSON.parse(JSON.stringify(norm(cur()))); f(mg); const c = clean(mg); save(c, c.t === 'fix' && sum(c) ? sum(c) : null); };   // 정액은 항목 합계가 관리비 금액 (항목이 비면 금액은 그대로)
    root.querySelectorAll('[data-mgt2]').forEach(b => b.onclick = () => up(m => { if (m.t !== b.dataset.mgt2) { m.t = b.dataset.mgt2; if (m.t === 'etc' && !m.s) m.s = 'rule'; if (m.t !== 'na' && !m.b) m.b = 'y1'; } }));
    root.querySelectorAll('[data-mgb]').forEach(b => b.onclick = () => up(m => { m.b = m.b === b.dataset.mgb && m.t === 'na' ? '' : b.dataset.mgb; }));
    // 10/31 고침: 칸마다 data-fk(매물장 입력창이 다시 그려도 Tab으로 간 칸에 커서 유지) · 고르는 칸(세부타입·사유)은 고르면 바로 손을 떼서 '기타' 입력칸이 바로 나타나게
    //   정액·실비 단추는 Tab에서 건너뜀 (항목 금액 칸끼리 Tab으로 이어 적게)
    const ch = (sel, f) => root.querySelectorAll(sel).forEach(i => i.onchange = () => { if (i.tagName === 'SELECT') i.blur(); setTimeout(() => up(m => f(m, i)), 0); });   // setTimeout: Tab으로 다음 칸에 커서가 옮겨 간 뒤에 저장·다시 그리기
    ch('[data-mgbtx]', (m, i) => { m.bTx = i.value; });
    ch('[data-mgs]', (m, i) => { m.s = i.value; });
    ch('[data-mgstx]', (m, i) => { m.sTx = i.value; });
    ch('[data-mgna]', (m, i) => { m.na = i.value; });
    ch('[data-mgnatx]', (m, i) => { m.naTx = i.value; });
    ch('[data-mginc]', m => { m.inc = [...root.querySelectorAll('[data-mginc]:checked')].map(c => c.dataset.mginc); });
    ch('[data-mgit]', (m, i) => { m.it = m.it || {}; m.it[i.dataset.mgit] = { v: i.value }; });
    root.querySelectorAll('[data-mgit]').forEach(i => i.onkeydown = e => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); i.blur(); } });
    root.querySelectorAll('[data-mgr]').forEach(b => b.onclick = () => up(m => { m.it = m.it || {}; const k = b.dataset.mgr; m.it[k] = b.dataset.v === 'r' ? (m.it[k] && m.it[k].r ? {} : { r: true }) : { v: (m.it[k] || {}).v || '' }; }));
  }
  // 공개 화면 글 (서버 mgPub 결과를 그대로 받아 씀)
  function pubLines(p, amt) {
    if (!p) return [];
    if (p.t === 'na') return [['관리비', p.na || '확인불가']];
    const head = p.t === 'fix' ? `월 ${p.sum ? p.sum + '만원' : '-'} (정액관리비)` : `월 ${amt ? amt + '만원' : '-'} (${p.tx}${p.s ? ' · ' + p.s : ''})`;
    const L = [['관리비', head]];
    if (p.b) L.push(['부과기준', p.b]);
    if (p.t === 'fix' && p.it.length) L.push(['관리비 세부내역', p.it.map(([k, v]) => `${k} ${v}`).join(' · ')]);
    if (p.inc && p.inc.length) L.push(['포함 항목', p.inc.join(' · ')]);
    return L;
  }
  return { T, B, S, NA, INC, IT, isRes, clean, norm, sum, miss, rows, wire, pubLines };
})();
