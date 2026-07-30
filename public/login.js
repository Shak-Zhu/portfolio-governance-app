// 登录页逻辑：只调用 /api/auth/login，成功跳转 /，失败显示错误。
(function () {
  'use strict';

  const form = document.getElementById('loginForm');
  const emailEl = document.getElementById('email');
  const pwdEl = document.getElementById('password');
  const errEl = document.getElementById('loginError');
  const submitBtn = document.getElementById('loginSubmit');

  function showError(msg) {
    errEl.textContent = msg;
    errEl.hidden = false;
  }

  function hideError() {
    errEl.textContent = '';
    errEl.hidden = true;
  }

  async function checkExistingSession() {
    try {
      const r = await fetch('/api/auth/session', { credentials: 'include', cache: 'no-store' });
      if (r.ok) {
        // 已登录，直接回到主页
        window.location.replace('/');
      }
    } catch {
      /* ignore */
    }
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    hideError();
    submitBtn.disabled = true;
    const email = (emailEl.value || '').trim();
    const password = pwdEl.value || '';
    if (!email || !password) {
      showError('邮箱和密码不能为空');
      submitBtn.disabled = false;
      return;
    }
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        credentials: 'include',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      if (res.ok) {
        // 不在 DOM 上回显 token / password / session
        window.location.replace('/');
        return;
      }
      const data = await res.json().catch(() => ({}));
      showError(data.error || '登录失败');
    } catch (err) {
      showError('网络错误：' + (err && err.message ? err.message : ''));
    } finally {
      submitBtn.disabled = false;
    }
  });

  checkExistingSession();
})();