// better-auth chuyển hướng tới /login kèm query đã ký. Gửi nguyên query đó trong `oauth_query`
// để plugin oauth-provider tiếp tục luồng authorize sau khi đăng nhập.
const form = document.getElementById('auth-form');
const errorEl = document.getElementById('error');
const nameField = document.getElementById('name-field');
const submit = document.getElementById('submit');
const toggle = document.getElementById('toggle-mode');
let mode = 'sign-in';

toggle.addEventListener('click', () => {
  mode = mode === 'sign-in' ? 'sign-up' : 'sign-in';
  const signUp = mode === 'sign-up';
  nameField.hidden = !signUp;
  nameField.querySelector('input').required = signUp;
  submit.textContent = signUp ? 'Tạo tài khoản' : 'Đăng nhập';
  toggle.textContent = signUp ? 'Đã có tài khoản? Đăng nhập' : 'Chưa có tài khoản? Tạo tài khoản';
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  errorEl.hidden = true;
  submit.disabled = true;
  const data = new FormData(form);
  const body = {
    email: data.get('email'),
    password: data.get('password'),
    oauth_query: location.search.slice(1),
  };
  if (mode === 'sign-up') body.name = data.get('name');
  try {
    const res = await fetch(`/api/auth/${mode}/email`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(payload.message || 'Đăng nhập thất bại.');
    if (payload.redirect && payload.url) {
      location.href = payload.url;
      return;
    }
    throw new Error('Không có phiên kết nối đang chờ. Hãy bắt đầu kết nối lại từ Claude hoặc ChatGPT.');
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.hidden = false;
    submit.disabled = false;
  }
});
