import './style.css';
import { savedHostRoom, startHost } from './host';
import { getBackend } from './net';
import { startPlayer } from './player';
import { delegate, esc, stars } from './ui/common';

const app = document.getElementById('app')!;
const params = new URLSearchParams(location.search);
const backend = getBackend();

const roomCode = params.get('room')?.toUpperCase().replace(/[^A-Z0-9]/g, '');
const hostCode = params.get('host')?.toUpperCase().replace(/[^A-Z0-9]/g, '');

if (roomCode) {
  startPlayer(app, backend, roomCode);
} else if (hostCode || params.has('narator')) {
  startHost(app, backend, hostCode ?? null);
} else {
  renderHome();
}

function renderHome() {
  const last = savedHostRoom();
  app.innerHTML = `${stars()}<main class="wrap home">
    <header class="hero"><div class="moon-big">🌕</div><div class="title">WEREWOLF</div>
      <div class="subtitle">Permainan pesta tebak serigala — narator otomatis, semua pemain pakai HP masing-masing</div></header>
    <div class="card">
      <h3>🎙️ Buat Ruang</h3>
      <p class="muted small">Buat ruang, bagikan link/QR ke pemain, lalu ikut main dengan narator otomatis (atau jadi narator manual).</p>
      <a class="btn primary block" href="?narator">Buat Permainan</a>
      ${last ? `<a class="btn block" href="?host=${esc(last)}">Lanjutkan ruang ${esc(last)}</a>` : ''}
    </div>
    <div class="card">
      <h3>🙋 Saya Pemain</h3>
      <label class="field"><span>Kode ruang</span><input id="code" maxlength="6" autocapitalize="characters" placeholder="mis. K7QWE"></label>
      <button class="btn block" data-act="join">Masuk</button>
    </div>
    <p class="muted tiny center">Mode realtime: ${esc(backend.label)}</p>
  </main>`;
  const go = () => {
    const v = (document.getElementById('code') as HTMLInputElement).value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (v) location.href = `?room=${v}`;
  };
  delegate(app, { join: go });
  document.getElementById('code')!.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
}
