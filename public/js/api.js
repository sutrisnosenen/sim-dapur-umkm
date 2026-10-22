// Klien API untuk frontend (fetch + cookie) dan helper UI
const api = {
  async request(method, url, body) {
    const opt = { method, headers: {} };
    if (body !== undefined) {
      opt.headers['Content-Type'] = 'application/json';
      opt.body = JSON.stringify(body);
    }
    const res = await fetch(url, opt);
    let data = null;
    try { data = await res.json(); } catch { /* respons bukan JSON */ }
    if (res.status === 401 && !location.pathname.includes('index')) {
      // sesi berakhir → kembali ke login
      window.location.href = '/index.html';
      return new Promise(() => {});
    }
    if (!res.ok) throw new Error((data && data.error) || `Gagal ${method} ${url}`);
    return data;
  },
  get: (url) => api.request('GET', url),
  post: (url, body) => api.request('POST', url, body ?? {}),
  put: (url, body) => api.request('PUT', url, body ?? {}),
  del: (url) => api.request('DELETE', url),
};

// ===== Helper UI =====
function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}
function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function toast(msg, type = 'info', ms = 3800) {
  const area = document.getElementById('toast-area');
  const node = el(`<div class="toast ${type}">${esc(msg)}</div>`);
  area.appendChild(node);
  setTimeout(() => node.remove(), ms);
}
function openModal(title, bodyHtml, { wide = false, onMount } = {}) {
  closeModal();
  const root = document.getElementById('modal-root');
  const m = el(`
    <div class="modal-overlay">
      <div class="modal ${wide ? 'wide' : ''}">
        <h3>${esc(title)}</h3>
        <div class="modal-body">${bodyHtml}</div>
      </div>
    </div>`);
  m.addEventListener('mousedown', (e) => { if (e.target === m) closeModal(); });
  root.appendChild(m);
  if (onMount) onMount(m);
  return m;
}
function closeModal() {
  document.getElementById('modal-root').innerHTML = '';
}
function confirmDialog(message, onYes) {
  openModal('Konfirmasi', `
    <p>${esc(message)}</p>
    <div class="modal-actions">
      <button class="btn" id="c-no">Batal</button>
      <button class="btn danger" id="c-yes">Ya, lanjutkan</button>
    </div>`, {
    onMount: (m) => {
      m.querySelector('#c-no').onclick = closeModal;
      m.querySelector('#c-yes').onclick = () => { closeModal(); onYes(); };
    },
  });
}
function statusBadge(s) {
  if (!s) return '';
  return `<span class="badge st-${esc(s.replace(/\s/g, '-'))}">${esc(s)}</span>`;
}
function priorityBadge(p) {
  if (!p) return '';
  return `<span class="badge pr-${esc(p)}">${esc(p)}</span>`;
}
function criticalBadge(isCritical) {
  return isCritical ? '<span class="badge critical">KRITIS</span>' : '';
}
function progressBar(pct) {
  const p = Number(pct || 0);
  return `<div style="display:flex;align-items:center;gap:8px;">
    <div class="progress-bar"><div class="progress-fill ${p >= 100 ? 'done' : ''}" style="width:${p}%"></div></div>
    <span style="font-size:.75rem;min-width:38px">${p}%</span>
  </div>`;
}
function fmtDate(s) {
  if (!s) return '-';
  const [y, m, d] = s.split('-');
  const nm = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Ags', 'Sep', 'Okt', 'Nov', 'Des'];
  return `${d} ${nm[Number(m) - 1]} ${y}`;
}
function fmtRp(n) {
  return Number(n || 0).toLocaleString('id-ID');
}
