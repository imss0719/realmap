// 화면에서 쓰는 공개 설정 (카카오 JavaScript 키는 원래 브라우저에 노출되는 키입니다)
import { send } from './_lib.js';

export default function (req, res) {
  send(res, 200, {
    ok: true,
    kakaoKey: process.env.KAKAO_JS_KEY || '',
    siteName: process.env.SITE_NAME || '리얼맵',
    has: {
      kakao: !!process.env.KAKAO_JS_KEY,
      vworld: !!process.env.VWORLD_KEY,
      data: !!process.env.DATA_GO_KR_KEY,
    },
  }, 300);
}
