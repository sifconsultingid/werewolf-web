// Layar narator (host). Browser ini memegang state permainan lengkap dan mengirim tampilan yang
// sudah disaring ke tiap pemain.

import QRCode from 'qrcode';
import {
  balanceScore, beginFirstRound, changeCount, commitStep, computeWinner, currentStep, DEFAULT_SETTINGS,
  eligibleVoters, execute, finishDay, goToDiscussion, goToVote, hunterShoots, MAX_PLAYERS, MIN_PLAYERS,
  morningAnnouncement, player, resetBallots, setupError, spellSentence, totalRoles, voteLeaders, votes,
  winnerSubtitle, winnerTitle, autoAssignRoles, type GameState, type Settings,
} from './game/engine';
import {
  applyPlayerAction, backToLobby, buildPrivateView, buildPublicView, createRoom, moveSeat, randomCode,
  removeSeat, startGame, syncAutoCounts, type PlayerAction, type Room,
} from './game/room';
import { ROLES, ROLE_INFO, sleepScript, WAKE_SCRIPT, type Role, type RoleCounts } from './game/roles';
import type { Backend } from './net/backend';
import {
  causeText, chip, delegate, discussionRemaining, esc, fmtTime, patch, roleGradient, roleTag, stars, teamTag,
} from './ui/common';

const STORE = (code: string) => `ww:host:${code}`;
export const LAST_HOST_KEY = 'ww:host:last';

export function savedHostRoom(): string | null {
  try {
    const code = localStorage.getItem(LAST_HOST_KEY);
    return code && localStorage.getItem(STORE(code)) ? code : null;
  } catch { return null; }
}

interface SetupDraft { expected: number; counts: RoleCounts; auto: boolean; settings: Settings }

export function startHost(app: HTMLElement, backend: Backend, resumeCode: string | null): void {
  let room: Room | null = null;
  let draft: SetupDraft = { expected: 8, counts: autoAssignRoles(8), auto: true, settings: { ...DEFAULT_SETTINGS } };
  let showSecrets = true;
  let qrUrl = '';
  let unsubActions: (() => void) | null = null;
  const knownUids = new Set<string>();
  const lastSent = new Map<string, string>();
  let autoTimer: { key: string; at: number; handle: number } | null = null;

  if (resumeCode) {
    try {
      const raw = localStorage.getItem(STORE(resumeCode));
      if (raw) room = JSON.parse(raw) as Room;
    } catch { /* abaikan */ }
  }

  const joinLink = () => {
    const u = new URL(location.href);
    u.search = `?room=${room!.code}`;
    u.hash = '';
    return u.toString();
  };

  function persist() {
    if (!room) return;
    try {
      localStorage.setItem(STORE(room.code), JSON.stringify(room));
      localStorage.setItem(LAST_HOST_KEY, room.code);
    } catch { /* penyimpanan penuh/diblokir */ }
  }

  async function publish() {
    if (!room) return;
    const now = Date.now();
    const pub = JSON.stringify(buildPublicView(room, now));
    if (lastSent.get('*') !== stripTime(pub)) {
      lastSent.set('*', stripTime(pub));
      await backend.publishPublic(room.code, JSON.parse(pub));
    }
    const uids = new Set<string>([...room.seats.map((s) => s.uid), ...Object.keys(room.notices), ...knownUids]);
    for (const uid of uids) {
      const priv = JSON.stringify(buildPrivateView(room, uid, now));
      if (lastSent.get(uid) !== stripTime(priv)) {
        lastSent.set(uid, stripTime(priv));
        await backend.publishPrivate(room.code, uid, JSON.parse(priv));
      }
    }
  }

  const stripTime = (s: string) => s.replace(/"updatedAt":\d+/, '');

  /** Simpan, kirim ke semua pemain, jadwalkan langkah otomatis, lalu gambar ulang. */
  function commit() {
    persist();
    scheduleAuto();
    publish().catch((e) => { console.error(e); toast("Gagal sinkron: " + (e?.message ?? e)); });
    render();
  }

  function guard(fn: () => void) {
    try { fn(); } catch (e) { alert(e instanceof Error ? e.message : String(e)); }
    commit();
  }

  function listen() {
    if (!room || unsubActions) return;
    unsubActions = backend.onActions(room.code, (uid, action) => {
      if (!room) return;
      knownUids.add(uid);
      lastSent.delete(uid); // pastikan pemain ini menerima tampilan terbaru
      applyPlayerAction(room, uid, action as PlayerAction);
      commit();
    });
  }

  /** Langkah malam yang pemegang perannya sudah mati: lanjut otomatis setelah jeda acak. */
  function scheduleAuto() {
    const g = room?.game;
    const step = g ? currentStep(g) : undefined;
    const key = g && step ? `${g.nightNumber}-${g.stepIndex}` : '';
    if (!step || step.active) {
      if (autoTimer) { clearTimeout(autoTimer.handle); autoTimer = null; }
      return;
    }
    if (autoTimer?.key === key) return;
    if (autoTimer) clearTimeout(autoTimer.handle);
    const delay = 5000 + Math.random() * 4000;
    autoTimer = {
      key, at: Date.now() + delay,
      handle: window.setTimeout(() => {
        autoTimer = null;
        const gg = room?.game;
        if (gg && `${gg.nightNumber}-${gg.stepIndex}` === key && currentStep(gg) && !currentStep(gg)!.active) {
          guard(() => commitStep(gg, {}));
        }
      }, delay),
    };
  }

  // MARK: Aksi narator

  const handlers: Record<string, (arg: string, el: HTMLElement) => void> = {
    expected: (arg) => {
      draft.expected = Math.max(MIN_PLAYERS, Math.min(MAX_PLAYERS, draft.expected + Number(arg)));
      if (draft.auto) draft.counts = autoAssignRoles(draft.expected);
      render();
    },
    count: (arg) => {
      const [role, d] = arg.split(':') as [Role, string];
      if (room && !room.game) {
        room.counts = changeCount(room.counts, role, Number(d), Math.max(room.seats.length, 1));
        room.autoCounts = false;
        commit();
      } else {
        draft.counts = changeCount(draft.counts, role, Number(d), draft.expected);
        draft.auto = false;
        render();
      }
    },
    autoCounts: () => {
      if (room && !room.game) {
        room.autoCounts = true;
        room.counts = autoAssignRoles(Math.max(4, room.seats.length));
        commit();
      } else {
        draft.auto = true;
        draft.counts = autoAssignRoles(draft.expected);
        render();
      }
    },
    setting: (arg, el) => {
      const s = room ? room.settings : draft.settings;
      const input = el as HTMLInputElement;
      if (arg === 'discussionSeconds') {
        s.discussionSeconds = Math.max(30, Math.min(900, s.discussionSeconds + Number(input.dataset.delta)));
      } else {
        (s as any)[arg] = !(s as any)[arg];
      }
      room ? commit() : render();
    },
    createRoom: () => {
      const code = randomCode();
      room = createRoom(code, draft.expected, draft.settings);
      room.counts = draft.counts;
      room.autoCounts = draft.auto;
      history.replaceState(null, '', `?host=${code}`);
      listen();
      makeQr();
      commit();
    },
    copyLink: async () => {
      try { await navigator.clipboard.writeText(joinLink()); toast('Link disalin'); } catch { prompt('Salin link ini:', joinLink()); }
    },
    openTab: () => { window.open(joinLink(), '_blank', 'noopener'); },
    kick: (pid) => { if (room && confirm('Keluarkan pemain ini dari ruang?')) { removeSeat(room, pid); commit(); } },
    up: (pid) => { if (room) { moveSeat(room, pid, -1); commit(); } },
    down: (pid) => { if (room) { moveSeat(room, pid, 1); commit(); } },
    start: () => guard(() => {
      if (!room) return;
      syncAutoCounts(room);
      const err = setupError(room.seats.length, room.counts);
      if (err) throw new Error(err);
      startGame(room);
    }),
    beginRound: () => guard(() => beginFirstRound(room!.game!)),
    skipStep: () => {
      if (!confirm('Lewati langkah ini tanpa aksi?')) return;
      guard(() => commitStep(room!.game!, {}, Date.now(), true));
    },
    nextNow: () => guard(() => commitStep(room!.game!, {})),
    forceWolf: () => guard(() => {
      const g = room!.game!;
      const target = majority(Object.values(g.wolfVotes));
      commitStep(g, { target: target ?? undefined });
    }),
    skipHunter: () => {
      if (!confirm('Pemburu tidak menembak?')) return;
      guard(() => hunterShoots(room!.game!, null));
    },
    toDiscussion: () => guard(() => goToDiscussion(room!.game!)),
    toVote: () => guard(() => goToVote(room!.game!)),
    timerToggle: () => guard(() => {
      const g = room!.game!;
      if (g.discussionPausedRemaining !== null) {
        g.discussionEndsAt = Date.now() + g.discussionPausedRemaining * 1000;
        g.discussionPausedRemaining = null;
      } else {
        g.discussionPausedRemaining = discussionRemaining(g.discussionEndsAt, null);
        g.discussionEndsAt = null;
      }
    }),
    timerAdd: () => guard(() => {
      const g = room!.game!;
      if (g.discussionPausedRemaining !== null) g.discussionPausedRemaining += 30;
      else g.discussionEndsAt = Math.max(Date.now(), g.discussionEndsAt ?? Date.now()) + 30000;
    }),
    timerReset: () => guard(() => {
      const g = room!.game!;
      g.discussionPausedRemaining = null;
      g.discussionEndsAt = Date.now() + g.settings.discussionSeconds * 1000;
    }),
    execute: (pid) => {
      const g = room!.game!;
      if (!confirm(`Eksekusi ${player(g, pid)?.name}?`)) return;
      guard(() => execute(g, pid));
    },
    noExecution: () => guard(() => execute(room!.game!, null)),
    revote: () => guard(() => resetBallots(room!.game!)),
    finishDay: () => guard(() => finishDay(room!.game!)),
    toggleSecrets: () => { showSecrets = !showSecrets; render(); },
    playAgain: () => { if (room) { backToLobby(room); commit(); } },
    endRoom: () => {
      if (!confirm('Tutup ruang ini? Pemain tidak bisa melanjutkan.')) return;
      try { if (room) localStorage.removeItem(STORE(room.code)); localStorage.removeItem(LAST_HOST_KEY); } catch { /* */ }
      location.href = location.pathname;
    },
  };

  function majority(list: string[]): string | null {
    const c: Record<string, number> = {};
    for (const t of list) c[t] = (c[t] ?? 0) + 1;
    let best: string | null = null;
    for (const [k, v] of Object.entries(c)) if (best === null || v > c[best]) best = k;
    return best;
  }

  function toast(text: string) {
    const t = document.createElement('div');
    t.className = 'toast';
    t.textContent = text;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 1800);
  }

  async function makeQr() {
    if (!room) return;
    try {
      qrUrl = await QRCode.toDataURL(joinLink(), { margin: 1, width: 240, color: { dark: '#0b0d24', light: '#ffffff' } });
    } catch { qrUrl = ''; }
    render();
  }

  // MARK: Tampilan

  function compositionEditor(counts: RoleCounts, n: number, auto: boolean): string {
    const total = totalRoles(counts);
    const score = balanceScore(counts);
    const err = setupError(n, counts);
    const pct = Math.max(0, Math.min(100, 50 + score * 4));
    const verdict = score > 4 ? 'Condong ke desa' : score < -3 ? 'Condong ke serigala' : 'Seimbang';
    return `<div class="card">
      <div class="row between"><h3>Komposisi Peran</h3>
        <button class="btn small ${auto ? 'on' : ''}" data-act="autoCounts">✨ Otomatis${auto ? ' (aktif)' : ''}</button></div>
      <p class="muted small">${total} peran untuk ${n} pemain. ${auto ? 'Mengikuti jumlah pemain secara otomatis.' : 'Diatur manual.'}</p>
      <div class="balance"><div class="balance-bar"><div class="balance-mark" style="left:${pct}%"></div></div>
        <div class="row between small"><span>🐺 Serigala</span><b>${verdict} (${score > 0 ? '+' : ''}${score})</b><span>Desa 🏠</span></div></div>
      <div class="roles-grid">
        ${ROLES.map((r) => {
          const c = counts[r] ?? 0;
          const info = ROLE_INFO[r];
          return `<div class="role-row ${c ? 'active' : ''}">
            <div class="role-icon" style="background:${roleGradient(r)}">${info.icon}</div>
            <div class="role-meta"><b>${esc(info.name)}</b> ${teamTag(r)}<div class="muted tiny">${esc(info.short)}</div></div>
            <div class="stepper"><button data-act="count" data-arg="${r}:-1" ${c === 0 ? 'disabled' : ''}>−</button><span>${c}</span><button data-act="count" data-arg="${r}:1" ${!info.allowsMultiple && c >= 1 ? 'disabled' : ''}>+</button></div>
          </div>`;
        }).join('')}
      </div>
      ${err ? `<p class="warn">⚠️ ${esc(err)}</p>` : '<p class="ok">✅ Komposisi siap.</p>'}
    </div>`;
  }

  function settingsCard(s: Settings): string {
    const toggle = (key: keyof Settings, label: string) =>
      `<label class="toggle"><input type="checkbox" data-act="setting" data-arg="${key}" ${s[key] ? 'checked' : ''}><span>${label}</span></label>`;
    return `<div class="card"><h3>Pengaturan</h3>
      ${toggle('skipDiscussion', 'Langsung voting (tanpa diskusi bertimer)')}
      ${s.skipDiscussion ? '' : `<div class="row between"><span>Lama diskusi</span><div class="stepper">
        <button data-act="setting" data-arg="discussionSeconds" data-delta="-30">−</button><span>${fmtTime(s.discussionSeconds)}</span>
        <button data-act="setting" data-arg="discussionSeconds" data-delta="30">+</button></div></div>`}
      ${toggle('startWithNight', 'Mulai dari malam pertama')}
      ${toggle('revealRoleOnDeath', 'Tampilkan peran saat pemain mati')}
    </div>`;
  }

  function renderSetup(): string {
    return `<header class="hero"><div class="title">WEREWOLF</div><div class="subtitle">Mode Narator</div></header>
      <div class="card"><h3>Perkiraan jumlah pemain</h3>
        <div class="row center big-stepper"><button class="btn round" data-act="expected" data-arg="-1">−</button>
        <span class="big-num">${draft.expected}</span><button class="btn round" data-act="expected" data-arg="1">+</button></div>
        <p class="muted small">Komposisi akan menyesuaikan otomatis dengan jumlah pemain yang benar-benar masuk, kecuali kamu mengaturnya manual.</p>
      </div>
      ${compositionEditor(draft.counts, draft.expected, draft.auto)}
      ${settingsCard(draft.settings)}
      <button class="btn primary block" data-act="createRoom">🌕 Buat Ruang</button>
      <p class="muted small center">Mode realtime: ${esc(backend.label)}</p>`;
  }

  function renderLobby(r: Room): string {
    const n = r.seats.length;
    const err = setupError(n, r.counts);
    return `<header class="topbar"><div><b>Ruang ${esc(r.code)}</b> <span class="muted">• Lobi</span></div>
      <button class="btn small ghost" data-act="endRoom">Tutup ruang</button></header>
      <div class="grid2">
        <div>
          <div class="card center">
            <h3>Ajak pemain masuk</h3>
            ${qrUrl ? `<img class="qr" src="${qrUrl}" alt="QR code link ruang">` : '<div class="qr placeholder">QR…</div>'}
            <div class="code">${esc(r.code)}</div>
            <div class="link">${esc(joinLink())}</div>
            <div class="row center wrap"><button class="btn small" data-act="copyLink">📋 Salin link</button>
            ${backend.localOnly ? '<button class="btn small" data-act="openTab">➕ Buka tab pemain</button>' : ''}</div>
            ${backend.localOnly ? '<p class="warn small">Mode lokal: link hanya berfungsi di browser ini (buka di tab lain untuk mencoba). Lihat README untuk mengaktifkan mode online.</p>' : ''}
          </div>
          <div class="card">
            <h3>Pemain masuk (${n})</h3>
            ${n === 0 ? '<p class="muted">Belum ada pemain. Bagikan link atau QR di atas.</p>' : ''}
            <ol class="seat-list">${r.seats.map((s, i) => `<li><span class="seat-no">${i + 1}</span><span class="grow">${esc(s.name)}</span>
              <button class="icon" data-act="up" data-arg="${s.pid}" ${i === 0 ? 'disabled' : ''} title="Naik">▲</button>
              <button class="icon" data-act="down" data-arg="${s.pid}" ${i === n - 1 ? 'disabled' : ''} title="Turun">▼</button>
              <button class="icon danger" data-act="kick" data-arg="${s.pid}" title="Keluarkan">✕</button></li>`).join('')}</ol>
            <p class="muted tiny">Urutan ini = urutan duduk melingkar (dipakai Insomnia untuk mencari Werewolf terdekat).</p>
          </div>
        </div>
        <div>
          ${compositionEditor(r.counts, n, r.autoCounts)}
          ${settingsCard(r.settings)}
          <button class="btn primary block" data-act="start" ${err ? 'disabled' : ''}>🎲 Mulai &amp; Acak Peran</button>
          ${err ? `<p class="muted small center">${esc(err)}</p>` : ''}
        </div>
      </div>`;
  }

  function secretsPanel(g: GameState): string {
    if (!showSecrets) return `<button class="btn small ghost block" data-act="toggleSecrets">🔒 Tampilkan catatan rahasia</button>`;
    const flags: string[] = [];
    if (g.players.some((p) => p.role === 'witch')) flags.push(`🧪 Penyembuh: ${g.witchHealUsed ? 'terpakai' : 'ada'} • Racun: ${g.witchPoisonUsed ? 'terpakai' : 'ada'}`);
    if (g.players.some((p) => p.role === 'necromancer')) flags.push(`🖐️ Nekromancer: ${g.necromancerUsed ? 'terpakai' : 'belum'}`);
    if (g.lastProtected) flags.push(`🛡️ Dilindungi malam lalu: ${esc(player(g, g.lastProtected)?.name)}`);
    if (g.lovers.length) flags.push(`💘 Kekasih: ${g.lovers.map((l) => esc(player(g, l)?.name)).join(' & ')}`);
    return `<div class="card secrets">
      <div class="row between"><h3>🔒 Catatan Rahasia Narator</h3><button class="btn small ghost" data-act="toggleSecrets">Sembunyikan</button></div>
      <table class="roster">${g.players.map((p, i) => `<tr class="${p.isAlive ? '' : 'dead'}">
        <td class="muted">${i + 1}</td><td>${esc(p.name)}${g.lovers.includes(p.id) ? ' 💘' : ''}${p.princeRevealed ? ' 👑' : ''}</td>
        <td>${roleTag(p.role)}</td><td>${p.isAlive ? '' : '💀'}${g.phase === 'reveal' ? (g.ready.includes(p.id) ? '✅' : '⏳') : ''}</td></tr>`).join('')}</table>
      ${flags.length ? `<div class="flags">${flags.map((f) => `<div>${f}</div>`).join('')}</div>` : ''}
      <details><summary>Log permainan (${g.log.length})</summary><ul class="log">${g.log.slice().reverse().map((l) => `<li>${l.icon} ${esc(l.text)}</li>`).join('')}</ul></details>
    </div>`;
  }

  function script(text: string): string {
    return `<div class="script"><div class="script-label">📢 NARATOR, BACAKAN</div>“${esc(text)}”</div>`;
  }

  function deathList(g: GameState, list: { playerId: string; cause: any }[]): string {
    return list.map((d) => {
      const p = player(g, d.playerId)!;
      return `<div class="death"><div class="avatar" style="background:${roleGradient(p.role)}">${ROLE_INFO[p.role].icon}</div>
        <div><b>${esc(p.name)}</b> — ${roleTag(p.role)}<div class="muted small">${causeText(d.cause)}</div></div></div>`;
    }).join('');
  }

  function hunterBlock(g: GameState): string {
    const h = g.pendingHunters[0];
    let out = '';
    if (h) {
      out += `<div class="card hunter"><h3>🎯 ${esc(player(g, h)?.name)} adalah PEMBURU!</h3>
        ${script('Pemburu, sebelum mati, tembak satu orang!')}
        <p class="muted">Menunggu Pemburu memilih target di HP-nya…</p>
        <button class="btn small ghost" data-act="skipHunter">Lewati tembakan</button></div>`;
    }
    if (g.hunterDeaths.length) out += `<div class="card"><h3>Korban tembakan Pemburu</h3>${deathList(g, g.hunterDeaths)}</div>`;
    return out;
  }

  function renderNight(g: GameState): string {
    const step = currentStep(g)!;
    const info = ROLE_INFO[step.role];
    const holders = g.players.filter((p) => p.role === step.role);
    const prev = g.nightSteps[g.stepIndex - 1];
    let body = '';
    if (!step.active) {
      body = `<p class="muted">💤 Pemegang peran ini sudah mati. Tetap bacakan narasinya agar pemain tidak curiga.</p>
        <p>Lanjut otomatis dalam <b data-countdown="${autoTimer?.at ?? 0}">…</b></p>
        <button class="btn" data-act="nextNow">Lanjut sekarang</button>`;
    } else if (step.role === 'werewolf') {
      const pack = holders.filter((p) => p.isAlive);
      body = `<p>Menunggu para serigala sepakat di HP masing-masing (semua serigala hidup harus memilih target yang sama).</p>
        <ul class="plain">${pack.map((w) => `<li>🐺 ${esc(w.name)} → ${g.wolfVotes[w.id] ? `<b>${esc(player(g, g.wolfVotes[w.id])?.name)}</b>` : '<span class="muted">belum memilih</span>'}</li>`).join('')}</ul>
        <div class="row wrap">${Object.keys(g.wolfVotes).length ? '<button class="btn small" data-act="forceWolf">Pakai pilihan terbanyak</button>' : ''}
        <button class="btn small ghost" data-act="skipStep">Lewati (tanpa korban)</button></div>`;
    } else {
      body = `<p>Menunggu <b>${esc(holders.filter((p) => p.isAlive).map((p) => p.name).join(', '))}</b> memilih di HP-nya…</p>
        <button class="btn small ghost" data-act="skipStep">Lewati langkah ini</button>`;
    }
    const dots = g.nightSteps.map((_, i) => `<span class="dot ${i < g.stepIndex ? 'done' : i === g.stepIndex ? 'now' : ''}"></span>`).join('');
    return `<div class="card night-step">
      <div class="row between"><h2>🌙 Malam ${g.nightNumber}</h2><div class="dots">${dots}</div></div>
      ${prev ? `<p class="muted small">Sebelumnya: “${esc(sleepScript(prev.role))}”</p>` : script('Malam telah tiba. Semua warga desa, tutup mata kalian.')}
      <div class="step-role"><div class="role-icon big" style="background:${roleGradient(step.role)}">${info.icon}</div><h2>${esc(info.name)}</h2></div>
      ${script(WAKE_SCRIPT[step.role] ?? '')}
      ${body}
    </div>`;
  }

  function renderMorning(g: GameState): string {
    const decided = computeWinner(g) !== null;
    const pending = g.pendingHunters.length > 0;
    const spelled = player(g, g.spellTarget);
    return `<div class="card">
      <h2>🌅 Pagi Hari ke-${g.dayNumber}</h2>
      ${script('Pagi telah tiba. Semua warga desa, buka mata kalian. ' + morningAnnouncement(g))}
      ${g.lastDeaths.length ? deathList(g, g.lastDeaths) : '<p class="peace">☀️ Malam yang damai. Tidak ada yang mati.</p>'}
      ${g.lastRevived ? `<p class="good">🖐️ ${esc(player(g, g.lastRevived)?.name)} bangkit kembali!</p>` : ''}
      ${spelled && spelled.isAlive ? `<p class="spell">🤫 ${esc(spellSentence(g.spellMode, spelled.name))}</p>` : ''}
    </div>
    ${hunterBlock(g)}
    <button class="btn primary block" data-act="toDiscussion" ${pending ? 'disabled' : ''}>
      ${decided ? '🏁 Lihat Hasil' : g.settings.skipDiscussion ? '✋ Mulai Voting' : '💬 Mulai Diskusi'}</button>`;
  }

  function renderDay(g: GameState): string {
    const spelled = player(g, g.spellTarget);
    const paused = g.discussionPausedRemaining !== null;
    return `<div class="card center">
      <h2>☀️ Hari ${g.dayNumber} • Diskusi</h2>
      ${spelled && spelled.isAlive ? `<p class="spell">🤫 ${esc(spellSentence(g.spellMode, spelled.name))}</p>` : ''}
      <div class="timer" data-timer>${fmtTime(discussionRemaining(g.discussionEndsAt, g.discussionPausedRemaining))}</div>
      <div class="row center wrap">
        <button class="btn small" data-act="timerToggle">${paused ? '▶️ Lanjut' : '⏸ Jeda'}</button>
        <button class="btn small" data-act="timerAdd">+30 dtk</button>
        <button class="btn small" data-act="timerReset">↺ Ulang</button>
      </div>
      <div class="chips">${g.players.map((p) => chip({ pid: p.id, name: p.name, alive: p.isAlive })).join('')}</div>
    </div>
    <button class="btn primary block" data-act="toVote">✋ Mulai Voting</button>`;
  }

  function renderVote(g: GameState): string {
    if (g.executionDone) {
      const decided = g.winner !== null || computeWinner(g) !== null;
      let result = '';
      if (g.princeSaved) result = `<p class="good big">👑 ${esc(player(g, g.princeSaved)?.name)} ternyata PANGERAN dan selamat!</p>`;
      else if (g.executionDeaths.length) result = deathList(g, g.executionDeaths);
      else result = '<p class="peace">✋ Tidak ada yang dieksekusi hari ini.</p>';
      return `<div class="card"><h2>⚖️ Hasil Voting Hari ${g.dayNumber}</h2>${result}</div>
        ${hunterBlock(g)}
        <button class="btn primary block" data-act="finishDay" ${g.pendingHunters.length ? 'disabled' : ''}>${decided ? '🏁 Lihat Hasil' : '🌙 Malam Tiba'}</button>`;
    }
    const tally = votes(g);
    const max = Math.max(1, ...Object.values(tally));
    const eligible = eligibleVoters(g);
    const notVoted = eligible.filter((p) => !g.ballots[p.id] || !tally[g.ballots[p.id]]);
    const cast = Object.values(tally).reduce((a, b) => a + b, 0);
    const leaders = voteLeaders(g);
    const spelled = player(g, g.spellTarget);
    let decision = '';
    if (leaders.length === 1) {
      decision = `<button class="btn danger block" data-act="execute" data-arg="${leaders[0]}">🔨 Eksekusi ${esc(player(g, leaders[0])?.name)}</button>`;
    } else if (leaders.length > 1) {
      decision = `<p class="warn center">Seri! ${leaders.map((l) => esc(player(g, l)?.name)).join(' vs ')}</p>
        <div class="row center"><button class="btn" data-act="revote">🔁 Voting Ulang</button></div>`;
    }
    if (leaders.length !== 1) decision += `<button class="btn ghost block" data-act="noExecution">Lewati — tidak ada eksekusi hari ini</button>`;
    return `<div class="card">
      <div class="row between"><h2>✋ Voting Hari ${g.dayNumber}</h2><b class="${cast === eligible.length ? 'ok' : 'warn'}">${cast}/${eligible.length} suara</b></div>
      ${script('Saatnya voting. Pilih orang yang kalian curigai sebagai serigala di HP masing-masing.')}
      ${spelled && spelled.isAlive && g.spellMode === 'noVote' ? `<p class="spell">🤫 ${esc(spellSentence(g.spellMode, spelled.name))}</p>` : ''}
      <div class="bars">${g.players.filter((p) => p.isAlive).map((p) => {
        const v = tally[p.id] ?? 0;
        const voters = Object.entries(g.ballots).filter(([, t]) => t === p.id).map(([vId]) => player(g, vId)?.name).filter(Boolean);
        return `<div class="bar-row ${leaders.includes(p.id) && leaders.length === 1 ? 'leader' : ''}">
          <div class="bar-name">${esc(p.name)}</div>
          <div class="bar"><div class="bar-fill" style="width:${(v / max) * 100}%"></div><span>${v}</span></div>
          <div class="bar-voters muted tiny">${voters.map(esc).join(', ')}</div></div>`;
      }).join('')}</div>
      ${notVoted.length ? `<p class="muted small">Belum memilih: ${notVoted.map((p) => esc(p.name)).join(', ')}</p>` : ''}
    </div>
    ${decision}`;
  }

  function renderReveal(g: GameState): string {
    const ready = g.ready.length;
    return `<div class="card center">
      <h2>🃏 Bagikan Peran</h2>
      <p>Peran sudah diacak. Minta setiap pemain membuka HP-nya, membalik kartu, lalu menekan <b>Saya Siap</b>.</p>
      <div class="big-num">${ready}/${g.players.length}</div><p class="muted">pemain siap</p>
      <div class="chips">${g.players.map((p) => chip({ pid: p.id, name: p.name, sub: g.ready.includes(p.id) ? '✅ siap' : '⏳' })).join('')}</div>
    </div>
    <button class="btn primary block" data-act="beginRound">${g.settings.startWithNight ? '🌙 Mulai Malam Pertama' : '☀️ Mulai Hari Pertama'}</button>
    ${ready < g.players.length ? '<p class="muted small center">Kamu tetap bisa mulai walau belum semua menekan siap.</p>' : ''}`;
  }

  function renderGameOver(g: GameState): string {
    const w = g.winner!;
    return `<div class="card center gameover">
      <div class="winner-icon">${{ village: '☀️', wolves: '🌕', lovers: '💘', tanner: '🪦', draw: '💤' }[w.kind]}</div>
      <h1>${esc(winnerTitle(w))}</h1>
      ${script(winnerTitle(w) + ' ' + winnerSubtitle(w))}
      <div class="chips">${g.players.map((p) => chip({ pid: p.id, name: p.name, alive: p.isAlive, role: p.role, badge: g.lovers.includes(p.id) ? '♥' : undefined })).join('')}</div>
    </div>
    <div class="row center wrap"><button class="btn primary" data-act="playAgain">🔁 Main Lagi (pemain sama)</button>
    <button class="btn ghost" data-act="endRoom">Tutup ruang</button></div>`;
  }

  function renderGame(r: Room, g: GameState): string {
    let main = '';
    switch (g.phase) {
      case 'reveal': main = renderReveal(g); break;
      case 'night': main = renderNight(g); break;
      case 'morning': main = renderMorning(g); break;
      case 'day': main = renderDay(g); break;
      case 'vote': main = renderVote(g); break;
      case 'gameOver': main = renderGameOver(g); break;
    }
    const alive = g.players.filter((p) => p.isAlive).length;
    return `<header class="topbar"><div><b>Ruang ${esc(r.code)}</b> <span class="muted">• ${alive}/${g.players.length} hidup</span></div>
      <button class="btn small ghost" data-act="endRoom">Tutup ruang</button></header>
      <div class="grid2 game"><div>${main}</div><div>${secretsPanel(g)}</div></div>`;
  }

  function render() {
    document.body.dataset.phase = room?.game?.phase ?? 'setup';
    const html = !room ? renderSetup() : !room.game ? renderLobby(room) : renderGame(room, room.game);
    const g = room?.game;
    const screen = !room ? 'setup' : !g ? 'lobby' : `${g.phase}-${g.nightNumber}-${g.dayNumber}-${g.stepIndex}-${g.executionDone}`;
    patch(app, `${stars()}<main class="wrap host">${html}</main>`, screen);
    tick();
  }

  function tick() {
    const g = room?.game;
    app.querySelectorAll<HTMLElement>('[data-timer]').forEach((el) => {
      if (g) {
        const rem = discussionRemaining(g.discussionEndsAt, g.discussionPausedRemaining);
        el.textContent = rem <= 0 ? 'Waktu habis!' : fmtTime(rem);
        el.classList.toggle('low', rem <= 10);
      }
    });
    app.querySelectorAll<HTMLElement>('[data-countdown]').forEach((el) => {
      const at = Number(el.dataset.countdown);
      el.textContent = at ? `${Math.max(0, Math.ceil((at - Date.now()) / 1000))} dtk` : '…';
    });
  }

  delegate(app, handlers);
  setInterval(tick, 500);

  if (room) {
    listen();
    makeQr();
    commit();
  } else {
    render();
  }
}
