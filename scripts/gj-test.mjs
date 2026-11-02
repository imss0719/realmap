// 11/2 시험: 광주 실거래 코드 확인 — 2026년 전남·광주 통합으로 지역 코드가 29xxx → 12xxx 로 바뀐 것으로 보임
//   옛 코드(29110 동구 …)와 새 코드(12210 동구 …)로 아파트·분양권·연립다세대·토지 실거래를 각각 불러 월별 건수 비교
//   청약홈 공고의 지역 이름(광주 / 전남광주…)도 확인. 결과는 Actions 실행 화면 요약표에만 (저장·지도 반영 없음)
import { appendFile } from 'node:fs/promises';
import { monthsBack } from '../api/trades.js';
import { dataGoKrAll, DATA_KEY } from '../api/_lib.js';

if (!DATA_KEY) { console.log('DATA_GO_KR_KEY 비밀값이 비어 있습니다.'); process.exit(1); }
const B = 'https://apis.data.go.kr/1613000/';
const API = {
  아파트: B + 'RTMSDataSvcAptTradeDev/getRTMSDataSvcAptTradeDev',
  분양권: B + 'RTMSDataSvcSilvTrade/getRTMSDataSvcSilvTrade',
  연립다세대: B + 'RTMSDataSvcRHTrade/getRTMSDataSvcRHTrade',
  토지: B + 'RTMSDataSvcLandTrade/getRTMSDataSvcLandTrade',
};
const GU = [['동구', '29110', '12210'], ['서구', '29140', '12240'], ['남구', '29155', '12270'], ['북구', '29170', '12300'], ['광산구', '29200', '12330']];
const yms = monthsBack(8).slice(1);   // 지난달부터 7개월
const out = [], md = [];
const say = s => { console.log(s); md.push(s); };
say(`## 광주 실거래 코드 시험 (${yms[yms.length - 1]} ~ ${yms[0]})`);
say('| 구 | 자료 | 코드 | ' + yms.join(' | ') + ' | 합계 |');
say('|---|---|---|' + yms.map(() => '---:').join('|') + '|---:|');
for (const [nm, oldc, newc] of GU) {
  for (const [k, url] of Object.entries(API)) {
    if (k !== '아파트' && nm !== '광산구' && nm !== '서구') continue;   // 아파트는 5개 구 모두, 나머지는 2개 구만
    for (const c of [oldc, newc]) {
      const row = [];
      for (const ym of yms) {
        try { row.push((await dataGoKrAll(url, { LAWD_CD: c, DEAL_YMD: ym }, { pageSize: 1000, maxPages: 5 })).length); }
        catch (e) { row.push('오류'); console.log(nm, k, c, ym, String(e.message).slice(0, 120)); }
      }
      const sum = row.reduce((a, b) => a + (typeof b === 'number' ? b : 0), 0);
      say(`| ${nm} | ${k} | ${c} | ${row.join(' | ')} | **${sum}** |`);
      out.push({ nm, k, c, sum });
    }
  }
}
// 청약홈 지역 이름
try {
  const u = new URL('https://api.odcloud.kr/api/ApplyhomeInfoDetailSvc/v1/getAPTLttotPblancDetail');
  u.searchParams.set('page', 1); u.searchParams.set('perPage', 1000); u.searchParams.set('serviceKey', DATA_KEY);
  u.searchParams.set('cond[RCRIT_PBLANC_DE::GTE]', '2025-01-01');
  const j = await (await fetch(u)).json();
  const cnt = {};
  for (const x of j.data || []) { const a = x.SUBSCRPT_AREA_CODE_NM || '?'; if (/광주|전남|전라/.test(a) || /광주/.test(x.HSSPLY_ADRES || '')) cnt[a] = (cnt[a] || 0) + 1; }
  say('\n### 청약홈 공고 지역 이름 (2025년~, 광주·전남 관련)');
  say(Object.entries(cnt).map(([a, n]) => `- ${a}: ${n}건`).join('\n') || '- 없음');
} catch (e) { say('청약홈 확인 실패: ' + e.message); }
if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, md.join('\n') + '\n');
