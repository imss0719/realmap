// 10/30 리얼맵 장부(휴대폰) — 홈 화면에 추가용 최소 서비스워커 (저장하지 않고 늘 서버에서 새로 받음)
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', e => { if (e.request.mode === 'navigate') e.respondWith(fetch(e.request).catch(() => new Response('<meta charset="utf-8"><p style="font:18px sans-serif;padding:40px;text-align:center">인터넷 연결을 확인해 주세요.</p>', { headers: { 'Content-Type': 'text/html; charset=utf-8' } }))); });
