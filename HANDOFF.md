# 리얼맵 인수인계 문서 (새 대화방에서 이어서 작업할 때 먼저 읽기)

마지막 정리: 2026-10-20 (밤, 지도 실거래가 좌표장 추가)

## 0. 일하는 방식 (가장 중요)
- 운영자: 선배 (리얼워커스 공인중개사사무소 대표, 마포). 존댓말, "선배"로 부름, 비개발자.
- 선배는 **GitHub 웹에서 파일을 직접 덮어 올리는 방식**으로 배포함 (휴대폰에서도 올림). 그래서
  - 수정한 파일은 **완성된 파일 통째로** 보내 주고, "맨 바깥(최상위)" / "api 폴더" 처럼 **올릴 위치를 꼭 같이 안내**.
  - 한 번에 여러 파일을 올림. 같은 파일을 연달아 고치면 마지막 파일만 올리면 된다고 알려 줌.
- 에러 메시지·기술 용어는 이용자 화면에 보이지 않게 (신뢰 문제). 일시 장애는 조용히 다시 시도.
- 무리하거나 더 급한 일이 있으면 솔직하게 먼저 말하기를 원함. 기능은 손이 덜 가는 쪽을 선호.
- 검증 못 한 부분(카카오 지도처럼 실제 사이트에서만 되는 것)은 "확인 못 했다"고 분명히 말하기.

## 1. 서비스 개요
- 주소: https://realmap.online (Vercel, 프로젝트명 realmap, 팀 realwalkers, **Hobby 무료 요금제**, 지역 icn1)
- 운영 법인: 주식회사 드림인베스트 · 문의 realwalkers@naver.com
- 디스코부동산 업그레이드판: 지도에서 필지를 누르면 토지·이용계획·건축물대장·동호수·실거래·관리비·입점업종·전세 안전 점검·입지정보·브리핑 자료.
- 회원: 카카오 로그인 (무료). 운영자(ADMIN_KAKAO_ID)는 자동 PRO.

## 2. 파일 구조
- 화면: `index.html` + `app.js` + `app.css` (한 페이지 스크롤형, 무거운 칸은 늦게 불러옴)
- `listings.html` + `listings.js`: **내 매물장 (PRO 전용, 새 창)**
- `briefing.html` + `briefing.js`: 매물 브리핑 자료 편집기
- `members.html`: 운영자 회원관리·방문 통계·유입 경로·지역별 필지 조회·창고 사용량
- `guide.html`, `privacy.html`, `sitemap.xml`, `robots.txt`, `og.png`, `favicon.svg`
- `api/` (Vercel 서버 함수 11개 + `_lib.js` — Hobby 한도 12개라 **새 파일 대신 기존 파일에 기능을 붙임**)
  - `_lib.js` 공통: 공공데이터 호출(일시 장애 3회 재시도), `cached()` 메모리+Upstash 창고(KEEP 접두사별 보관일, MAX_KEYS 15000 넘으면 저장 중지), `pool()`, `rcmd()`(창고 직접 명령)
  - `auth.js`: 카카오 로그인, 방문 통계(hit), 관심 부동산, **매물장(listings/listing, 사진 op=photo/photodel)**, 탈퇴
  - `building.js`: 건축물대장(+part=floors), **K-apt 관리비(part=kapt, kaptTrend)**
  - `land.js` 토지·공시지가·개별주택가격 / `units.js` 동·호 / `trades.js` 실거래
  - `aptmap.js` 지도 위 실거래가 라벨. 건물 좌표는 구별 **좌표장**(창고 `rmc:geo:<시군구코드>` 해시, 180일)에서 먼저 꺼내 쓰고, 없으면 브이월드 주소검색 → 그래도 없으면 화면이 카카오로 찾아서 `POST /api/aptmap`으로 좌표장에 보탬. 원인 확인용 `?debug=geo`
  - `stores.js`: 입점 업종, **버스정류장(near=bus: 서울 ws.bus.go.kr → 없으면 TAGO)**
  - `members.js`: 운영자 통계 (지역 이름은 브이월드 LT_C_ADSIGG_INFO로 찾음)
  - `parcel.js`, `config.js`, `health.js`
  - `zones.js`·`layer.js`는 10/17 삭제(함수 한도). 개발지도 정비구역은 정적 파일 `data/jeongbi-seoul.json`에서 바로 읽음. `app.js`의 `/api/zones` 호출과 `admin.html`·`admin.js`는 남은 흔적(조용히 실패, 이용자 영향 없음)
- `scripts/warm.mjs` + `.github/workflows/warm.yml`: 매일 새벽 3시 마포·서대문·은평 아파트·오피스텔 미리 불러오기 (7일에 한 바퀴)
- `package.json`: 의존성 `@vercel/blob` 하나 (사진). auth.js에서 사진 기능 쓸 때만 동적 import.

## 3. 외부 서비스·환경변수 (Vercel)
- `KAKAO_JS_KEY`, `KAKAO_REST_KEY`, (`KAKAO_CLIENT_SECRET`), `SESSION_SECRET`
- `VWORLD_KEY`, `VWORLD_DOMAIN` (도메인 잠금 키 → 샌드박스에서 직접 호출 불가)
- `DATA_GO_KR_KEY` (공공데이터포털: 건축HUB, 실거래 전 종류, K-apt 목록4·기본V5·관리비V3, 상가정보, 서울 정류소, TAGO 정류소)
- Upstash Redis: `KV_REST_API_URL/TOKEN` — 회원 `realmap:*`, 캐시 `rmc:*`, 통계 `rm:st:YYYYMMDD:{pv,uv,pcl,mem,src,gu}`, 매물장 `realmap:ls:<카카오ID>`
- Vercel Blob `realmap-photo` (Public, icn1): `BLOB_READ_WRITE_TOKEN` — 매물 사진 `ls/<카카오ID>/...jpg`. **Revoke Token 누르면 안 됨.**
- `ADMIN_KAKAO_ID`, `ADMIN_PASSWORD` (members.html)

## 4. 매물장 데이터 형태 (auth.js save)
`{ id, no(매물번호 YYMM-순번, 직접 입력 가능·중복 금지), places[{pnu,addr,lat,lng,bname,dong,ho,area,site,arch,ak(ex|tot|land),land}], contacts[{role,name,phone}], rents[{label,deposit,rent,memo}], photos[{url}], kind(sale|jeonse|wolse|presale), ptype(+ptypeTx 기타), price, deposit, rent, mgmt, premium, curDep, curRent, loan, pr, paid, memo, status(on|hold|done), at, up }`
- 금액은 모두 만원. 세부 임대료는 자동 합산 안 함('합계 반영' 버튼).
- 대표값(pnu, addr, lat, lng, owner, phone, area 합계)은 첫 주소·첫 연락처에서 계산.

## 5. 결정된 것 / 하지 않기로 한 것
- 대표필지 자동 이동: 안 함 (없으면 없다고 표시).
- 호수 직접입력(본 화면): 뺌.
- 비회원 블러: 관리비 상세, 입점 업종 3번째부터, 3·5년 실거래 등.
- 회원가입 유도: 3번째 필지 볼 때 한 번 (joinNudge).
- 이메일 필수/재동의/직접입력: **보류** (가입 감소 우려). 카카오 채널 추가는 비즈앱 전환 때 검토.
- 광고: 구글 애드센스 안 함. 메일로 들어오는 맞춤 광고만.
- 유료화 1차 목표: 공인중개사 매물장. 유료 전환 시 사무소명·대표자·연락처·등록번호 입력 받기, 가격은 월 9,900~19,900원 검토(중개왕 월 3만 원 참고).

## 6. 남은 일 / 다음 후보
- 선배: 공공데이터포털 **운영계정 신청**(건축HUB·실거래·K-apt) — 이용자 늘면 가장 먼저 막히는 곳.
- 지역별 필지 조회가 쌓이면 미리 불러오기 지역 확대 (운영계정 승인 후).
- 창고 사용량 70% 넘으면 정리/한도 조정.
- 유료회원 시작 시: Vercel Pro(월 $20, 상업적 이용), 결제(토스페이먼츠/포트원), 매물 데이터 DB 이전(Supabase 등) 검토.
- 매물장: 손님(고객) 관리, 직원 계정, 매물→브리핑 자동 연결, 리얼맵 본 지도에 내 매물 핀 표시.
- 콘텐츠: 블로그 2편(전세 안전 점검, 중개사 후기) 게시, 릴스(관리비 편·입점 업종 편 등) 게시, 링크에 `?from=blog|insta|kakao|youtube` 붙이기.

## 7. 점검 요령
- 지도 실거래가가 새 브라우저(인스타 앱 등)에서 늦게 뜨면: `/api/aptmap?kind=apt&lawd=11440&r=서울특별시 마포구&debug=geo` 로 브이월드 주소검색 상태 확인. 10/20에 브이월드 좌표가 0건으로 오던 문제 때문에 좌표장을 만듦
- 실사이트 확인: `https://realmap.online/api/health`, `/api/building?pnu=..&part=kapt&debug=list`
- 공공데이터 일시 장애(01/02/04/05, 빈 응답)는 흔함 → 결과를 캐시에 넣지 않고 다시 시도.
- 영상(릴스)은 HTML render(t) + Playwright 캡처 + ffmpeg, 배경음악은 numpy로 만든 딥하우스(선배 선호), 사람 목소리는 선배 녹음 파일을 받는 게 최선.
