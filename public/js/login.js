// Halaman login
document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = document.getElementById('login-btn');
  const errBox = document.getElementById('login-error');
  errBox.classList.add('hidden');
  btn.disabled = true;
  btn.textContent = 'Memproses…';
  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        identifier: document.getElementById('identifier').value.trim(),
        password: document.getElementById('password').value,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      errBox.textContent = data.error || 'Login gagal.';
      errBox.classList.remove('hidden');
      btn.disabled = false;
      btn.textContent = 'Login';
      return;
    }
    window.location.href = '/app.html';
  } catch {
    errBox.textContent = 'Tidak dapat menghubungi server.';
    errBox.classList.remove('hidden');
    btn.disabled = false;
    btn.textContent = 'Login';
  }
});
