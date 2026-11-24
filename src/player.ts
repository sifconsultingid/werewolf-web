// Layar pemain: masuk ke ruang, lihat kartu sendiri, lakukan aksi malam, voting.

import { spellSentence, THIEF_NOTICE, winnerSubtitle, winnerTitle, type SpellMode, type StepInput } from './game/engine';
import type { PlayerAction, PrivateView, PublicSeat, PublicView } from './game/room';
import { ROLE_INFO, TEAM_NAME, WAKE_SCRIPT, type Role } from './game/roles';
import type { Backend } from './net/backend';
import {
  causeText, chip, delegate, discussionRemaining, esc, fmtTime, patch, roleGradient, roleTag, stars, vibrate,
} from './ui/common';

export function startPlayer(app: HTMLElement, backend: Backend, code: string): void {
  let uid = '';
  let pub: PublicView | null = null;
  let priv: PrivateView | null = null;
  let waitedLong = false;
  /** Kapan tampilan publik terakhir diterima (host mengirim detak tiap ~10 detik) */
  let lastPubAt = 0;
  let hostLost = false;
  let sending = false;
  const ui = {
    flipped: false,
    flipAnimUntil: 0,
    showCard: false,
    key: '',
    sel: [] as string[],
    heal: false,
    poison: false,
    necro: false,
    spell: 'mute' as SpellMode,
    editName: false,
  };

  const send = async (a: PlayerAction) => {
    sending = true;
    render();
    await backend.sendAction(code, a);
    setTimeout(() => { sending = false; render(); }, 1500);
  };

  const seat = (pid: string | null | undefined): PublicSeat | undefined => pub?.seats.find((s) => s.pid === pid);
  const nameOf = (pid: string | null | undefined) => seat(pid)?.name ?? '?';

  function resetSelection(key: string) {
    if (ui.key === key) return;
    ui.key = key;
    ui.sel = [];
    ui.heal = false;
    ui.poison = false;
    ui.necro = false;
    ui.spell = 'mute';
  }

  function toggleSel(pid: string, max: number) {
    const i = ui.sel.indexOf(pid);
    if (i >= 0) ui.sel.splice(i, 1);
    else {
      if (ui.sel.length >= max) ui.sel.shift();
      ui.sel.push(pid);
    }
    vibrate(15);
    render();
  }

  const handlers: Record<string, (arg: string, el: HTMLElement) => void> = {
    join: () => {
      const input = document.getElementById('name') as HTMLInputElement | null;
      const name = input?.value.trim() ?? '';
      if (!name) { input?.focus(); return; }
      try { localStorage.setItem('ww:name', name); } catch { /* */ }
      ui.editName = false;
      void send({ type: 'join', name });
    },
    editName: () => { ui.editName = true; render(); },
    flip: () => {
      ui.flipped = !ui.flipped;
      if (ui.flipped) {
        ui.flipAnimUntil = Date.now() + 750;
        setTimeout(render, 800);
      }
      vibrate(40);
      render();
    },
    ready: () => { void send({ type: 'ready' }); },
    card: () => { ui.showCard = !ui.showCard; ui.flipped = true; render(); },
    sel1: (pid) => toggleSel(pid, 1),
    sel2: (pid) => toggleSel(pid, 2),
    wolfConfirm: () => {
      if (!ui.sel[0]) return;
      vibrate(30);
      void send({ type: 'wolfVote', target: ui.sel[0] });
    },
    wolf: (pid) => {
      const mine = priv?.wolfVotes?.[priv.pid!];
      vibrate(20);
      void send({ type: 'wolfVote', target: mine === pid ? null : pid });
    },
    heal: () => { ui.heal = !ui.heal; render(); },
    poison: () => { ui.poison = !ui.poison; if (!ui.poison) ui.sel = []; render(); },
    necro: () => { ui.necro = !ui.necro; if (!ui.necro) ui.sel = []; render(); },
    spell: (m) => { ui.spell = m as SpellMode; render(); },
    submit: () => {
      const a = priv?.action;
      if (!a) return;
      const input: StepInput = {};
      switch (a.kind) {
        case 'cupid': input.lovers = [ui.sel[0], ui.sel[1]]; break;
        case 'bodyguard': case 'seer': case 'diseased': case 'thief': input.target = ui.sel[0]; break;
        case 'witch': input.heal = ui.heal; input.poison = ui.poison ? ui.sel[0] ?? null : null; break;
        case 'necromancer': input.revive = ui.necro ? ui.sel[0] ?? null : null; break;
        case 'spellcaster': input.spell = { target: ui.sel[0] ?? null, mode: ui.spell }; break;
      }
      if (a.kind === 'hunter') { void send({ type: 'hunter', target: ui.sel[0] ?? null }); return; }
      void send({ type: 'night', input });
    },
    walk: (arg) => { void send({ type: 'peek', walk: arg === 'yes' }); },
    peekSeer: () => { if (ui.sel[0]) { vibrate(60); void send({ type: 'peek', target: ui.sel[0] }); } },
    sleep: () => { void send({ type: 'night', input: {} }); },
    hunterSkip: () => { if (confirm('Yakin tidak menembak siapa pun?')) void send({ type: 'hunter', target: null }); },
    vote: (pid) => {
      const mine = pub?.ballots[priv?.pid ?? ''];
      vibrate(20);
      void send({ type: 'vote', target: mine === pid ? null : pid });
    },
    newIdentity: () => {
      if (!confirm('Masuk sebagai pemain baru di tab ini?')) return;
      (backend as any).resetIdentity?.();
      location.reload();
    },
  };

  // MARK: Tampilan

  function roleCard(role: Role, flipped: boolean): string {
    const info = ROLE_INFO[role];
    const state = !flipped ? '' : Date.now() < ui.flipAnimUntil ? 'flipped animating' : 'flipped static';
    return `<div class="flip ${state}" data-act="flip" role="button" tabindex="0">
      <div class="flip-inner">
        <div class="face back"><div class="back-moon">🌕</div><div>Ketuk untuk melihat peranmu</div><div class="muted tiny">Pastikan tidak ada yang mengintip</div></div>
        <div class="face front" style="background:${roleGradient(role)}">
          <div class="card-icon">${info.icon}</div>
          <div class="card-name">${esc(info.name)}</div>
          <div class="card-team">${TEAM_NAME[info.team]}</div>
          <div class="card-desc">${esc(info.short)}</div>
          <div class="card-tip">💡 ${esc(info.tips)}</div>
        </div>
      </div></div>`;
  }

  function secretNotes(): string {
    if (!priv?.role) return '';
    const notes: string[] = [];
    if (priv.pack && priv.pack.length > 1) {
      notes.push(`🐺 Kawananmu: ${priv.pack.filter((w) => w.pid !== priv!.pid).map((w) => `<b>${esc(w.name)}</b>${w.alive ? '' : ' 💀'}`).join(', ')}`);
    } else if (priv.pack) {
      notes.push('🐺 Kamu satu-satunya serigala.');
    }
    if (priv.lover) notes.push(`💘 Kamu jatuh cinta pada <b>${esc(nameOf(priv.lover))}</b>. Jika dia mati, kamu ikut mati.`);
    if (priv.coupled?.length) notes.push(`💘 Pasangan yang kamu satukan: <b>${priv.coupled.map((c) => esc(nameOf(c))).join(' & ')}</b>`);
    if (priv.thief) notes.push(thiefNote(priv.thief));
    for (const s of priv.seerHistory ?? []) {
      notes.push(`👁️ Malam ${s.night}: <b>${esc(nameOf(s.pid))}</b> ${s.isWolf ? '<span class="bad">adalah WEREWOLF 👎</span>' : '<span class="good">BUKAN werewolf 👍</span>'}`);
    }
    for (const h of priv.insomniacHistory ?? []) {
      notes.push(h.walked
        ? `🚶 Malam ${h.night}: ${h.nearestWolves.length ? `Werewolf terdekat: <b>${h.nearestWolves.map((w) => esc(nameOf(w))).join(' / ')}</b>` : 'Tidak ada werewolf di dekatmu.'}`
        : `🛌 Malam ${h.night}: kamu tetap tidur.`);
    }
    return notes.length ? `<div class="notes">${notes.map((n) => `<div>${n}</div>`).join('')}</div>` : '';
  }

  function thiefNote(t: NonNullable<PrivateView['thief']>): string {
    const r = ROLE_INFO[t.stolenRole];
    return t.stole
      ? `🦹 Kamu mencuri kartu <b>${esc(nameOf(t.otherPid))}</b>: sekarang kamu <b>${r.icon} ${esc(r.name)}</b> (${TEAM_NAME[r.team]}).`
      : `🦹 Kartumu (${r.icon} ${esc(r.name)}) dicuri Pencuri! Sekarang kamu <b>Warga Desa</b>.`;
  }

  function cardOverlay(): string {
    if (!ui.showCard || !priv?.role) return '';
    return `<div class="overlay"><div class="overlay-bg" data-act="card"></div><div class="overlay-box">
      ${roleCard(priv.role, ui.flipped)}${secretNotes()}
      <button class="btn block" data-act="card">Tutup</button></div></div>`;
  }

  function grid(cands: string[], act: string, opts: { tint?: string; badges?: Record<string, string> } = {}): string {
    return `<div class="chips">${cands.map((pid) => {
      const s = seat(pid);
      return chip({
        pid, name: s?.name ?? '?', alive: s?.alive, act, selected: ui.sel.includes(pid), tint: opts.tint,
        badge: opts.badges?.[pid] ?? (priv?.lover === pid ? '♥' : undefined),
        role: s?.role,
      });
    }).join('')}</div>`;
  }

  const sleepBtn = () =>
    `<button class="btn primary block" data-act="sleep" ${sending ? 'disabled' : ''}>${sending ? 'Mengirim…' : '😴 Tidur kembali'}</button>`;

  const submitBtn = (label: string, enabled: boolean) =>
    `<button class="btn primary block" data-act="submit" ${enabled && !sending ? '' : 'disabled'}>${sending ? 'Mengirim…' : label}</button>`;

  function actionView(): string {
    const a = priv!.action!;
    resetSelection(a.key);
    const role = a.kind === 'hunter' ? 'hunter' : a.kind;
    const info = ROLE_INFO[role];
    const head = `<div class="step-role"><div class="role-icon big" style="background:${roleGradient(role)}">${info.icon}</div>
      <h2>${a.kind === 'hunter' ? 'Kamu PEMBURU!' : `${esc(info.name)}, bangunlah`}</h2></div>
      <p class="center">${esc(a.kind === 'hunter' ? 'Sebelum mati, tembak satu orang untuk ikut mati bersamamu.' : WAKE_SCRIPT[role] ?? '')}</p>`;
    let body = '';
    switch (a.kind) {
      case 'cupid':
        body = `<p class="center small">Pilih 2 kekasih (${ui.sel.length}/2)</p>${grid(a.candidates, 'sel2', { tint: '#ff6fb1' })}
          ${ui.sel.length === 2 ? `<p class="center big">${esc(nameOf(ui.sel[0]))} 💘 ${esc(nameOf(ui.sel[1]))}</p>` : ''}
          ${submitBtn('Satukan mereka', ui.sel.length === 2)}`;
        break;
      case 'bodyguard':
        body = `${a.lastProtected ? `<p class="warn small center">Tidak boleh melindungi ${esc(nameOf(a.lastProtected))} lagi (dilindungi tadi malam)</p>` : ''}
          ${grid(a.candidates, 'sel1', { tint: '#4cc3ff' })}${submitBtn('🛡️ Lindungi', ui.sel.length === 1)}`;
        break;
      case 'werewolf': {
        const votes = priv!.wolfVotes ?? {};
        const badges: Record<string, string> = {};
        for (const t of Object.values(votes)) badges[t] = (badges[t] ? badges[t] + ' ' : '') + '🐺';
        const mine = votes[priv!.pid!];
        if (!ui.sel.length && mine) ui.sel = [mine];
        const pick = ui.sel[0];
        const pack = priv!.pack?.filter((w) => w.alive) ?? [];
        body = `<p class="center small">Pilih satu korban lalu konfirmasi. Semua serigala harus memilih orang yang sama.</p>
          ${grid(a.candidates, 'sel1', { tint: '#ff4d4d', badges })}
          <button class="btn primary block" data-act="wolfConfirm" ${pick && pick !== mine && !sending ? '' : 'disabled'}>${!pick ? '🐺 Pilih korban' : pick === mine ? `✅ Kamu memilih ${esc(nameOf(pick))}` : `🐺 Konfirmasi: mangsa ${esc(nameOf(pick))}`}</button>
          <ul class="plain small">${pack.map((w) => `<li>🐺 ${esc(w.name)}${w.pid === priv!.pid ? ' (kamu)' : ''} → ${votes[w.pid] ? `<b>${esc(nameOf(votes[w.pid]))}</b>` : '<span class="muted">belum memilih</span>'}</li>`).join('')}</ul>`;
        break;
      }
      case 'witch':
        body = `${a.victim ? `<p class="center">🐾 Korban serigala malam ini: <b>${esc(nameOf(a.victim))}</b></p>` : '<p class="center muted">Tidak ada korban serigala malam ini.</p>'}
          ${a.canHeal ? `<button class="toggle-btn ${ui.heal ? 'on heal' : ''}" data-act="heal">💚 Gunakan ramuan penyembuh</button>` : a.victim ? '<p class="muted small center">Ramuan penyembuh sudah terpakai.</p>' : ''}
          ${a.canPoison ? `<button class="toggle-btn ${ui.poison ? 'on poison' : ''}" data-act="poison">☠️ Gunakan racun</button>` : '<p class="muted small center">Racun sudah terpakai.</p>'}
          ${ui.poison ? grid(a.candidates, 'sel1', { tint: '#b36bff' }) : ''}
          ${submitBtn('Selesai', !ui.poison || ui.sel.length === 1)}`;
        break;
      case 'seer':
        if (a.peeked) {
          body = `<div class="result ${a.peeked.isWolf ? 'bad' : 'good'} center"><div class="big-emoji">${a.peeked.isWolf ? '👎' : '👍'}</div>
            <b>${esc(nameOf(a.peeked.pid))}</b> ${a.peeked.isWolf ? 'adalah WEREWOLF!' : 'BUKAN werewolf'}</div>
            ${sleepBtn()}`;
        } else {
          body = `${grid(a.candidates, 'sel1', { tint: '#8c66ff' })}
            <button class="btn primary block" data-act="peekSeer" ${ui.sel.length === 1 && !sending ? '' : 'disabled'}>${ui.sel[0] ? `👁️ Terawang ${esc(nameOf(ui.sel[0]))}` : '👁️ Pilih satu orang'}</button>`;
        }
        break;
      case 'necromancer':
        if (a.used || a.candidates.length === 0) {
          body = `<p class="muted center">${a.used ? 'Kekuatanmu sudah terpakai.' : 'Belum ada pemain yang mati.'}</p>${submitBtn('Tidur kembali', true)}`;
        } else {
          body = `<button class="toggle-btn ${ui.necro ? 'on necro' : ''}" data-act="necro">🖐️ Bangkitkan seseorang (sekali saja)</button>
            ${ui.necro ? grid(a.candidates, 'sel1', { tint: '#5fd9d9' }) : ''}
            ${submitBtn(ui.necro ? 'Bangkitkan' : 'Tidak sekarang', !ui.necro || ui.sel.length === 1)}`;
        }
        break;
      case 'spellcaster':
        body = `<div class="segmented"><button class="${ui.spell === 'mute' ? 'on' : ''}" data-act="spell" data-arg="mute">🤐 Bungkam</button>
          <button class="${ui.spell === 'noVote' ? 'on' : ''}" data-act="spell" data-arg="noVote">🚫 Larang voting</button></div>
          <p class="center small muted">${ui.sel[0] ? esc(spellSentence(ui.spell, nameOf(ui.sel[0]))) : 'Ketuk pemain (boleh diri sendiri) atau lanjut tanpa mantra'}</p>
          ${grid(a.candidates, 'sel1', { tint: '#d96bf2' })}${submitBtn(ui.sel[0] ? 'Rapalkan mantra' : 'Tanpa mantra', true)}`;
        break;
      case 'insomniac':
        if (a.walked) {
          body = `<div class="result center">${!a.walked.walked ? '🛌 Kamu memilih tetap tidur.'
            : a.walked.nearestWolves.length ? `🐺 Werewolf yang duduk paling dekat denganmu: <b>${a.walked.nearestWolves.map((w) => esc(nameOf(w))).join(' / ')}</b>`
            : 'Tidak ada werewolf di dekatmu.'}</div>${sleepBtn()}`;
        } else {
          body = `<div class="row center"><button class="btn" data-act="walk" data-arg="no" ${sending ? 'disabled' : ''}>🛌 Tetap tidur</button>
            <button class="btn primary" data-act="walk" data-arg="yes" ${sending ? 'disabled' : ''}>🚶 Jalan-jalan</button></div>`;
        }
        break;
      case 'thief':
        body = `<p class="center small">Kamu akan jadi peran orang itu, dan dia jadi Warga Desa. Peran curianmu belum kelihatan sampai kamu mencuri.</p>
          ${grid(a.candidates, 'sel1', { tint: '#9aa0b4' })}
          ${submitBtn(ui.sel[0] ? `🦹 Curi kartu ${esc(nameOf(ui.sel[0]))}` : '😴 Tidak mencuri', true)}`;
        break;
      case 'diseased':
        body = `<p class="center small">Pilih serigala yang tertular (ikut mati saat pagi)</p>${grid(a.candidates, 'sel1', { tint: '#a6cc33' })}${submitBtn('🦠 Tulari', ui.sel.length === 1)}`;
        break;
      case 'hunter':
        body = `${grid(a.candidates, 'sel1', { tint: '#ff8c26' })}${submitBtn('🎯 Tembak!', ui.sel.length === 1)}
          <button class="btn ghost block" data-act="hunterSkip">Lewati</button>`;
        break;
    }
    return `<div class="card action">${head}${body}</div>`;
  }

  function deaths(list: { pid: string; cause: any; role?: Role }[]): string {
    return list.map((d) => `<div class="death"><div class="avatar" style="background:${d.role ? roleGradient(d.role) : '#333'}">${d.role ? ROLE_INFO[d.role].icon : '💀'}</div>
      <div><b>${esc(nameOf(d.pid))}</b>${d.role ? ` — ${roleTag(d.role)}` : ''}<div class="muted small">${causeText(d.cause)}</div></div></div>`).join('');
  }

  function spellNotice(onlyVote = false): string {
    const s = pub!.spell;
    if (!s || (onlyVote && s.mode !== 'noVote')) return '';
    const me = s.pid === priv?.pid;
    return `<p class="spell ${me ? 'me' : ''}">🤫 ${esc(spellSentence(s.mode, me ? 'Kamu' : nameOf(s.pid)))}</p>`;
  }

  /** Pagi pertama: korban/Pencuri lihat lagi perubahan perannya di layar sendiri (tanpa getar, biar gak ketahuan) */
  const myStolenNotice = () => pub!.cardStolen && priv?.thief ? `<div class="result">${thiefNote(priv.thief)}</div>` : '';
  const stolenNotice = () => pub!.cardStolen ? `<p class="spell">🦹 ${esc(THIEF_NOTICE)}</p>` : '';

  function hunterPublic(): string {
    let out = '';
    if (pub!.pendingHunter && pub!.pendingHunter !== priv?.pid) out += `<p class="center">🎯 <b>${esc(nameOf(pub!.pendingHunter))}</b> adalah Pemburu dan sedang membidik…</p>`;
    if (pub!.hunterDeaths.length) out += `<h3>Korban tembakan Pemburu</h3>${deaths(pub!.hunterDeaths)}`;
    return out;
  }

  function seatsChips(): string {
    return `<div class="chips">${pub!.seats.map((s) => chip({ pid: s.pid, name: s.name, alive: s.alive, role: s.role, badge: s.pid === priv?.pid ? 'kamu' : undefined })).join('')}</div>`;
  }

  function gameView(): string {
    const p = pub!;
    const me = priv!;
    if (me.action) return actionView();
    switch (p.phase) {
      case 'reveal': {
        const ready = p.seats.find((s) => s.pid === me.pid)?.ready;
        return `<div class="center"><h2>Kartu Peranmu</h2>${roleCard(me.role!, ui.flipped)}
          ${ui.flipped ? secretNotes() : ''}
          <button class="btn primary block" data-act="ready" ${ready || sending ? 'disabled' : ''}>${ready ? `✅ Siap — menunggu ${p.auto ? 'pemain lain' : 'narator'}` : 'Saya Siap'}</button></div>`;
      }
      case 'night': {
        const myResult = secretNotesTonight();
        return `<div class="card center sleeping"><div class="zzz">🌙</div><h2>Malam ${p.nightNumber}</h2>
          <p>${me.alive ? 'Tutup matamu… dengarkan narator.' : 'Kamu sudah mati. Tetap diam ya 🤫'}</p>
          ${p.night ? `<p class="muted small">Sekarang: ${ROLE_INFO[p.night.role].icon} ${esc(ROLE_INFO[p.night.role].name)} beraksi</p>` : ''}
          ${myResult}</div>`;
      }
      case 'morning':
        return `<div class="card"><h2>🌅 Pagi Hari ke-${p.dayNumber}</h2>
          ${p.lastDeaths.length ? deaths(p.lastDeaths) : '<p class="peace">☀️ Malam yang damai. Tidak ada yang mati.</p>'}
          ${p.lastRevived ? `<p class="good">🖐️ ${esc(nameOf(p.lastRevived))} bangkit kembali dari kematian!</p>` : ''}
          ${stolenNotice()}${myStolenNotice()}${spellNotice()}${hunterPublic()}</div>${seatsChips()}`;
      case 'day': {
        const rem = discussionRemaining(p.discussionEndsAt, p.discussionPausedRemaining);
        return `<div class="card center"><h2>☀️ Hari ${p.dayNumber} • Diskusi</h2>${stolenNotice()}${spellNotice()}
          <div class="timer" data-timer>${fmtTime(rem)}</div>
          ${p.discussionPausedRemaining !== null ? '<p class="muted">⏸ Dijeda narator</p>' : ''}
          <p class="muted small">Diskusikan siapa yang mencurigakan. Voting dilakukan di HP masing-masing.</p></div>${seatsChips()}`;
      }
      case 'vote': return voteView();
      case 'gameOver': {
        const w = p.winner!;
        return `<div class="card center gameover"><div class="winner-icon">${{ village: '☀️', wolves: '🌕', lovers: '💘', tanner: '🪦', draw: '💤' }[w.kind]}</div>
          <h1>${esc(winnerTitle(w))}</h1><p>${esc(winnerSubtitle(w))}</p>
          <div class="chips">${p.seats.map((s) => chip({ pid: s.pid, name: s.name, alive: s.alive, role: s.role, badge: p.lovers.includes(s.pid) ? '♥' : s.pid === me.pid ? 'kamu' : undefined })).join('')}</div>
          <p class="muted small">Tunggu ${p.hostPid ? (p.hostPid === me.pid ? 'kamu (host) menekan 🔁 Main lagi' : 'host') : 'narator'} memulai permainan baru.</p></div>`;
      }
      default: return '';
    }
  }

  /** Status narator otomatis: jeda, batas waktu, voting ulang, host terputus. */
  function autoStrip(): string {
    const p = pub!;
    let out = '';
    if (hostLost && p.phase !== 'gameOver') out += '<div class="dead-banner">📡 Koneksi ke host terputus… menunggu host kembali</div>';
    if (!p.auto) return out;
    if (p.auto.paused) out += '<div class="dead-banner">⏸ Permainan dijeda host</div>';
    else if (p.auto.endsAt) out += `<p class="center small">⏱️ Sisa waktu <b data-deadline="${p.auto.endsAt}">…</b></p>`;
    if (p.auto.revote && !p.executionDone) out += '<p class="warn center">Seri! Voting diulang sekali lagi.</p>';
    return out;
  }

  function secretNotesTonight(): string {
    const n = pub!.nightNumber;
    const s = priv?.seerHistory?.find((x) => x.night === n);
    const h = priv?.insomniacHistory?.find((x) => x.night === n);
    if (s) {
      return `<div class="result ${s.isWolf ? 'bad' : 'good'}">${s.isWolf ? '👎' : '👍'} <b>${esc(nameOf(s.pid))}</b> ${s.isWolf ? 'adalah WEREWOLF!' : 'BUKAN werewolf'}</div>`;
    }
    if (h?.walked) {
      return `<div class="result">${h.nearestWolves.length ? `🐺 Werewolf terdekat: <b>${h.nearestWolves.map((w) => esc(nameOf(w))).join(' / ')}</b>` : 'Tidak ada werewolf di dekatmu.'}</div>`;
    }
    if (n === 1 && priv?.thief) return `<div class="result">${thiefNote(priv.thief)}</div>`;
    if (n === 1 && priv?.lover) return `<div class="result">💘 Kamu jatuh cinta pada <b>${esc(nameOf(priv.lover))}</b>!</div>`;
    return '';
  }

  function voteView(): string {
    const p = pub!;
    const me = priv!;
    if (p.executionDone) {
      let res = '';
      if (p.princeSaved) res = `<p class="good big center">👑 ${esc(nameOf(p.princeSaved))} ternyata PANGERAN dan selamat!</p>`;
      else if (p.executionDeaths.length) res = deaths(p.executionDeaths);
      else res = '<p class="peace">✋ Tidak ada yang dieksekusi hari ini.</p>';
      return `<div class="card"><h2>⚖️ Hasil Voting</h2>${res}${hunterPublic()}</div>`;
    }
    const canVote = p.eligible.includes(me.pid!);
    const mine = p.ballots[me.pid!];
    const cast = Object.values(p.tally).reduce((a, b) => a + b, 0);
    const alive = p.seats.filter((s) => s.alive);
    return `<div class="card"><div class="row between"><h2>✋ Voting Hari ${p.dayNumber}</h2><b>${cast}/${p.eligible.length}</b></div>
      ${spellNotice(true)}
      ${!me.alive ? '<p class="muted">Kamu sudah mati dan tidak bisa memilih.</p>'
        : !canVote ? '<p class="warn">Kamu dilarang ikut voting hari ini.</p>'
        : `<p class="small">${mine ? `Pilihanmu: <b>${esc(nameOf(mine))}</b>. Ketuk orang lain untuk mengganti, atau ketuk lagi untuk membatalkan.` : 'Ketuk orang yang kamu curigai sebagai serigala.'}</p>`}
      <div class="chips">${alive.map((s) => chip({
        pid: s.pid, name: s.name, role: s.role, selected: mine === s.pid, tint: '#ff4d4d',
        act: me.alive && canVote && s.pid !== me.pid ? 'vote' : undefined,
        disabled: s.pid === me.pid,
        badge: p.tally[s.pid] ? String(p.tally[s.pid]) : s.pid === me.pid ? 'kamu' : undefined,
      })).join('')}</div></div>`;
  }

  function render() {
    document.body.dataset.phase = pub?.phase ?? 'lobby';
    let html = '';
    const header = `<header class="topbar"><div><b>${priv?.joined ? esc(priv.name) : 'Werewolf'}</b> <span class="muted">• Ruang ${esc(code)}</span></div>
      ${priv?.role ? '<button class="btn small" data-act="card">🃏 Kartu saya</button>' : ''}</header>`;
    if (!pub) {
      html = `<div class="card center"><div class="spinner"></div><p>Menghubungkan ke ruang <b>${esc(code)}</b>…</p>
        ${waitedLong ? `<p class="warn small">Ruang belum ditemukan. Pastikan kode benar dan narator sudah membuat ruang${backend.localOnly ? ' di browser yang sama (mode lokal)' : ''}.</p>` : ''}</div>`;
    } else if (!priv?.joined || ui.editName) {
      const started = pub.phase !== 'lobby' && !priv?.joined;
      let saved = '';
      try { saved = localStorage.getItem('ww:name') ?? ''; } catch { /* */ }
      html = `<header class="hero"><div class="title">WEREWOLF</div><div class="subtitle">Ruang ${esc(code)}</div></header>
        <div class="card">${started ? '<p class="warn">Permainan sedang berlangsung. Kamu bisa ikut di permainan berikutnya.</p>' : ''}
        <label class="field"><span>Nama kamu</span><input id="name" maxlength="20" autocomplete="nickname" placeholder="mis. Budi" value="${esc(priv?.name ?? saved)}"></label>
        <button class="btn primary block" data-act="join" ${sending ? 'disabled' : ''}>${priv?.joined ? 'Simpan nama' : 'Masuk ke ruang'}</button>
        ${priv?.notice ? `<p class="warn small">${esc(priv.notice)}</p>` : ''}</div>
        <div class="card"><h3>Sudah masuk (${pub.seats.length})</h3>${pub.seats.length ? `<div class="chips">${pub.seats.map((s) => chip({ pid: s.pid, name: s.name })).join('')}</div>` : '<p class="muted">Belum ada.</p>'}</div>`;
    } else if (pub.phase === 'lobby') {
      html = `${header}<div class="card center"><div class="zzz">🏕️</div><h2>Halo, ${esc(priv.name)}!</h2>
        <p>Kamu sudah masuk. Tunggu ${pub.hostPid ? 'host' : 'narator'} menekan <b>Mulai</b>.</p>
        <button class="btn small ghost" data-act="editName">✏️ Ganti nama</button></div>
        <div class="card"><h3>Pemain di ruang (${pub.seats.length})</h3><div class="chips">${pub.seats.map((s) => chip({ pid: s.pid, name: s.name, badge: s.pid === priv!.pid ? 'kamu' : undefined })).join('')}</div></div>`;
    } else if (!priv.role) {
      html = `${header}<div class="card center"><p>Permainan sedang berlangsung tanpa kamu. Tunggu permainan berikutnya.</p></div>`;
    } else {
      html = `${header}${priv.alive === false && pub.phase !== 'gameOver' ? '<div class="dead-banner">💀 Kamu sudah mati — tetap diam & tonton permainan</div>' : ''}
        ${priv.notice ? `<p class="warn small center">${esc(priv.notice)}</p>` : ''}${autoStrip()}${gameView()}`;
    }
    const footer = backend.localOnly ? `<p class="muted tiny center">Mode lokal • <a href="#" data-act="newIdentity">jadi pemain baru di tab ini</a></p>` : '';
    const screen = `${pub?.phase}-${pub?.nightNumber}-${pub?.dayNumber}-${priv?.joined}-${priv?.action?.key ?? ''}-${pub?.executionDone}-${pub?.auto?.revote ?? ''}`;
    patch(app, `${stars()}<main class="wrap player">${html}${footer}</main>${cardOverlay()}`, screen);
    tick();
  }

  function tick() {
    if (!pub) return;
    const lost = lastPubAt > 0 && pub.phase !== 'lobby' && Date.now() - lastPubAt > 25000;
    if (lost !== hostLost) { hostLost = lost; render(); return; }
    app.querySelectorAll<HTMLElement>('[data-deadline]').forEach((el) => {
      el.textContent = `${Math.max(0, Math.ceil((Number(el.dataset.deadline) - Date.now()) / 1000))} dtk`;
    });
    app.querySelectorAll<HTMLElement>('[data-timer]').forEach((el) => {
      const rem = discussionRemaining(pub!.discussionEndsAt, pub!.discussionPausedRemaining);
      el.textContent = rem <= 0 ? 'Waktu habis!' : fmtTime(rem);
      el.classList.toggle('low', rem <= 10);
    });
  }

  delegate(app, handlers);
  app.addEventListener('keydown', (e) => {
    if ((e.target as HTMLElement).id === 'name' && e.key === 'Enter') handlers.join('', e.target as HTMLElement);
  });
  setInterval(tick, 500);
  setTimeout(() => { waitedLong = true; render(); }, 4000);

  let lastPhaseKey = '';
  void (async () => {
    uid = await backend.uid();
    backend.watchPublic(code, (d) => {
      pub = d as PublicView | null;
      lastPubAt = Date.now();
      hostLost = false;
      const k = pub ? `${pub.phase}-${pub.nightNumber}-${pub.dayNumber}-${pub.night?.index ?? ''}` : '';
      if (k !== lastPhaseKey) {
        lastPhaseKey = k;
        if (pub?.phase === 'reveal') ui.flipped = false;
        vibrate(60);
      }
      render();
    });
    backend.watchPrivate(code, uid, (d) => {
      priv = d as PrivateView | null;
      sending = false;
      render();
    });
    await backend.sendAction(code, { type: 'hello' } satisfies PlayerAction);
    render();
  })();
}
