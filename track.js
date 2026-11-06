/* 11/6 홍보 페이지 방문·가입 버튼 집계 (운영 화면 [방문·가입] → 홍보 페이지 성과)
   <script src="/track.js" data-pg="pro" defer></script> 처럼 붙입니다.
   지도·정비사업 페이지와 같은 임의 번호(rm.vid)만 씁니다 — 이름·연락처 같은 개인정보 없음 · 운영자 기기는 세지 않음 */
(function () {
  var me = document.currentScript, pg = me && me.getAttribute('data-pg');
  if (!pg) return;
  var v = '';
  try { if (localStorage.getItem('rm.op') === '1') return; v = localStorage.getItem('rm.vid') || ''; if (!v) { v = Math.random().toString(36).slice(2) + Date.now().toString(36); localStorage.setItem('rm.vid', v); } } catch (e) { /* 저장 불가 */ }
  var ua = navigator.userAgent || '', h = '', p = '';
  try { if (document.referrer) { var u = new URL(document.referrer); h = u.hostname; p = u.pathname; } } catch (e) { /* 없음 */ }
  var ext = /Instagram/i.test(ua) ? 'insta' : /KAKAOTALK/i.test(ua) ? 'kakao' : !h || h === location.hostname ? 'direct'
    : /blog\.naver\.com$/.test(h) ? 'blog' : /search\.naver\.com$/.test(h) ? 'nsearch' : /naver\.(com|me)$/.test(h) ? 'naver'
    : /google\./.test(h) ? 'google' : /daum\.net$/.test(h) ? 'daum' : /instagram\.com$/.test(h) ? 'insta' : /youtube\.com$|youtu\.be$/.test(h) ? 'youtube' : 'etc';
  try { var f = new URLSearchParams(location.search).get('from'); if (/^(blog|insta|kakao|youtube|news)$/.test(f || '')) ext = f; } catch (e) { /* 무시 */ }
  // 이 페이지로 바로 앞에 어디서 왔는지 (리얼맵 안이면 지도·정비사업·다른 홍보 페이지)
  var ref = h && h === location.hostname ? (/^\/(seoul|gyeonggi|incheon)\//.test(p) ? 'seoul' : /^\/(pro|promo|apt|pro-guide|guide|news)\.html/.test(p) ? 'in' : 'map') : ext;
  var src = '';   // 방문(세션)의 첫 화면일 때만 → 전체 유입 경로
  try { if (!sessionStorage.getItem('rm.gsrc')) { src = ext; sessionStorage.setItem('rm.gsrc', src); } } catch (e) { /* 무시 */ }
  var send = function (q) { try { fetch('/api/auth?action=hit&' + q + '&pg=' + pg + '&v=' + encodeURIComponent(v), { keepalive: true }).catch(function () {}); } catch (e) { /* 무시 */ } };
  send('k=g&r=' + ref + (src ? '&src=' + src : ''));
  // 가입 버튼: [시작하기] · 카카오 로그인 · ?go=1 (같은 방문에서 한 번만)
  var done = false;
  document.addEventListener('click', function (e) {
    var t = e.target && e.target.closest && e.target.closest('[data-start],[data-go],a[href*="go=1"],a[href*="/auth/login"]');
    if (!t || done) return; done = true; send('k=c');
  }, true);
})();
