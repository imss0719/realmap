// 휴대폰 문자 인증 칸 (가입 창 pro.html · 중개사무소 정보 창 listings.html 공통)
// SmsAuth.attach(휴대폰 입력칸, { done: '이미 인증된 번호(숫자)' }) → 입력칸 아래에 [인증번호 받기] · 인증번호 칸이 붙습니다.
// 반환값.ok() = 지금 입력된 번호가 인증됐는지. 서버(api/auth.js action=sms)가 꺼져 있으면(me.sms=false) 붙이지 않습니다.
window.SmsAuth = (() => {
  const digits = v => String(v || '').replace(/\D/g, '');
  async function post(body) {
    const r = await fetch('/api/auth?action=sms', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.ok === false) throw new Error(j.message || '잠시 연결이 원활하지 않습니다.');
    return j;
  }
  function attach(input, opt = {}) {
    let done = digits(opt.done), sent = '', timer = null, left = 0;
    const box = document.createElement('div');
    box.className = 'smsbox';
    input.insertAdjacentElement('afterend', box);
    const draw = msg => {
      const d = digits(input.value), ok = !!d && d === done;
      clearInterval(timer); timer = null;
      if (ok) { box.innerHTML = '<span class="sms-ok">✓ 휴대폰 인증됨</span>'; return; }
      const waiting = sent && sent === d && left > 0;
      box.innerHTML = `<div class="sms-row"><button type="button" class="sms-send">${waiting ? '다시 받기' : '인증번호 받기'}</button>
        ${waiting ? `<input class="sms-code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="인증번호 6자리"><button type="button" class="sms-check">확인</button><span class="sms-t"></span>` : ''}</div>
        <div class="sms-msg">${msg || (waiting ? '' : '문의 문자를 받을 번호라 인증이 필요합니다')}</div>`;
      const send = box.querySelector('.sms-send'), code = box.querySelector('.sms-code'), chk = box.querySelector('.sms-check'), t = box.querySelector('.sms-t'), m = box.querySelector('.sms-msg');
      send.onclick = async () => {
        const p = digits(input.value);
        if (!/^01\d{8,9}$/.test(p)) { m.textContent = '휴대폰 번호를 먼저 정확히 넣어 주세요'; return; }
        send.disabled = true; m.textContent = '보내는 중…';
        try { const j = await post({ op: 'send', phone: p }); sent = p; left = j.sec || 300; draw('문자로 받은 6자리를 넣어 주세요'); const c = box.querySelector('.sms-code'); if (c) c.focus(); }
        catch (e) { send.disabled = false; m.textContent = e.message; }
      };
      if (!waiting) return;
      const tick = () => { left--; if (t) t.textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`; if (left <= 0) { sent = ''; draw('시간이 지났습니다. 인증번호를 다시 받아 주세요'); } };
      tick(); timer = setInterval(tick, 1000);
      let tried = '';
      const check = async () => {
        const c = digits(code.value); if (c.length !== 6) { m.textContent = '6자리를 넣어 주세요'; return; }
        if (c === tried || chk.disabled) return; tried = c;   // 같은 번호로 두 번 확인하지 않음 (틀린 횟수 아낌)
        chk.disabled = true;
        try { await post({ op: 'check', phone: sent, code: c }); done = sent; sent = ''; draw(); if (opt.onDone) opt.onDone(); }
        catch (e) { chk.disabled = false; m.textContent = e.message; if (/다시 받아/.test(e.message)) { sent = ''; setTimeout(() => draw(e.message), 1200); } }
      };
      chk.onclick = check;
      code.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); check(); } };
      code.oninput = () => { if (digits(code.value).length === 6) check(); };
    };
    input.addEventListener('input', () => { const d = digits(input.value); if (d !== done && !(sent && d === sent)) { if (box.querySelector('.sms-ok') || (sent && d !== sent)) { sent = ''; draw(); } } });
    draw();
    return { ok: () => !!digits(input.value) && digits(input.value) === done, el: box };
  }
  return { attach };
})();
