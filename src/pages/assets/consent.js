const SCOPE_LABELS = {
  'finance:read': 'Xem dữ liệu tài chính (ví, giao dịch, ngân sách, báo cáo)',
  'finance:write': 'Ghi, sửa và xoá dữ liệu tài chính',
  offline_access: 'Giữ kết nối khi bạn không mở trang này',
};

const params = new URLSearchParams(location.search);
const clientId = params.get('client_id') ?? '';
const scopes = (params.get('scope') ?? '').split(' ').filter(Boolean);
const clientName = document.getElementById('client-name');
const list = document.getElementById('scopes');
const errorEl = document.getElementById('error');
const buttons = [document.getElementById('accept'), document.getElementById('deny')];

// textContent (không innerHTML): tên client do bên ngoài đăng ký.
clientName.textContent = clientId || 'Ứng dụng không xác định';
for (const scope of scopes) {
  const item = document.createElement('li');
  item.textContent = SCOPE_LABELS[scope] ?? scope;
  list.append(item);
}

fetch(`/api/auth/oauth2/public-client?client_id=${encodeURIComponent(clientId)}`, { credentials: 'include' })
  .then((res) => (res.ok ? res.json() : null))
  .then((client) => {
    if (client?.client_name) clientName.textContent = client.client_name;
  })
  .catch(() => {});

async function decide(accept) {
  errorEl.hidden = true;
  for (const button of buttons) button.disabled = true;
  try {
    const res = await fetch('/api/auth/oauth2/consent', {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ accept, oauth_query: location.search.slice(1) }),
    });
    const payload = await res.json().catch(() => ({}));
    if (res.ok && payload.url) {
      location.href = payload.url;
      return;
    }
    throw new Error(payload.message || payload.error_description || 'Không xử lý được yêu cầu cấp quyền.');
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.hidden = false;
    for (const button of buttons) button.disabled = false;
  }
}

buttons[0].addEventListener('click', () => decide(true));
buttons[1].addEventListener('click', () => decide(false));
