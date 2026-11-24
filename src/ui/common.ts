import { DEATH_CAUSE_ICON, DEATH_CAUSE_TEXT, type DeathCause } from '../game/engine';
import { ROLE_INFO, TEAM_COLOR, TEAM_NAME, type Role } from '../game/roles';

/** Escape teks agar aman dimasukkan ke HTML (nama pemain diketik bebas). */
export function esc(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

export function initials(name: string): string {
  const words = name.split(' ').filter(Boolean);
  const last = words[words.length - 1];
  if (words.length > 1 && last && /^\d+$/.test(last)) return last;
  const letters = words.slice(0, 2).map((w) => [...w][0]?.toUpperCase() ?? '');
  return letters.join('') || '?';
}

export function roleGradient(role: Role): string {
  const [a, b] = ROLE_INFO[role].colors;
  return `linear-gradient(135deg, ${a}, ${b})`;
}

export function roleTag(role: Role): string {
  const info = ROLE_INFO[role];
  return `<span class="role-tag" style="background:${roleGradient(role)}">${info.icon} ${esc(info.name)}</span>`;
}

export function teamTag(role: Role): string {
  const t = ROLE_INFO[role].team;
  return `<span class="team-tag" style="color:${TEAM_COLOR[t]};border-color:${TEAM_COLOR[t]}">${TEAM_NAME[t]}</span>`;
}

export function causeText(c: DeathCause): string {
  return `${DEATH_CAUSE_ICON[c]} ${DEATH_CAUSE_TEXT[c]}`;
}

export interface ChipOpts {
  pid: string;
  name: string;
  alive?: boolean;
  role?: Role;
  selected?: boolean;
  act?: string;
  badge?: string;
  sub?: string;
  disabled?: boolean;
  tint?: string;
}

/** Avatar pemain bulat + nama, bisa diketuk jika `act` diisi. */
export function chip(o: ChipOpts): string {
  const cls = ['chip', o.alive === false ? 'dead' : '', o.selected ? 'selected' : '', o.act ? 'tap' : '', o.disabled ? 'disabled' : '']
    .filter(Boolean).join(' ');
  const bg = o.role ? roleGradient(o.role) : 'linear-gradient(135deg,#2b2f55,#4a4f86)';
  const attrs = o.act && !o.disabled
    ? `data-act="${o.act}" data-arg="${esc(o.pid)}" role="button" tabindex="0" aria-pressed="${o.selected ? 'true' : 'false'}" aria-label="${esc(o.name)}"`
    : '';
  const style = o.tint ? `style="--tint:${o.tint}"` : '';
  return `<div class="${cls}" ${attrs} ${style}>
    <div class="avatar" style="background:${bg}">${o.role ? ROLE_INFO[o.role].icon : esc(initials(o.name))}${o.badge ? `<span class="badge">${esc(o.badge)}</span>` : ''}</div>
    <div class="chip-name">${esc(o.name)}</div>
    ${o.sub ? `<div class="chip-sub">${o.sub}</div>` : o.role ? `<div class="chip-sub">${esc(ROLE_INFO[o.role].name)}</div>` : ''}
  </div>`;
}

export function fmtTime(sec: number): string {
  const s = Math.max(0, Math.ceil(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Sisa detik diskusi dari state publik. */
export function discussionRemaining(endsAt: number | null, paused: number | null, now = Date.now()): number {
  if (paused !== null) return paused;
  if (endsAt === null) return 0;
  return Math.max(0, (endsAt - now) / 1000);
}

/**
 * Ganti isi elemen dengan HTML baru, tetapi pertahankan fokus & isi input yang sedang diketik,
 * dan posisi gulir — supaya pembaruan realtime tidak mengganggu pengguna.
 */
export function patch(root: HTMLElement, html: string, screenKey = ''): void {
  // Layar baru (fase/langkah berganti) → mulai dari atas; pembaruan biasa → posisi gulir dipertahankan
  const newScreen = (root as any)._screenKey !== screenKey;
  (root as any)._screenKey = screenKey;
  if ((root as any)._lastHtml === html) return;
  (root as any)._lastHtml = html;
  const active = document.activeElement as HTMLInputElement | null;
  const focusId = active && root.contains(active) ? active.id : '';
  const values = new Map<string, string>();
  root.querySelectorAll<HTMLInputElement>('input[id]:not([type=checkbox]),textarea[id]').forEach((el) => values.set(el.id, el.value));
  const sel = focusId && active ? [active.selectionStart, active.selectionEnd] : null;
  const scrollY = window.scrollY;
  root.innerHTML = html;
  values.forEach((v, id) => {
    const el = document.getElementById(id) as HTMLInputElement | null;
    if (el && el.dataset.keep !== 'false') el.value = v;
  });
  if (focusId) {
    const el = document.getElementById(focusId) as HTMLInputElement | null;
    if (el) {
      el.focus();
      if (sel && sel[0] !== null) try { el.setSelectionRange(sel[0], sel[1]); } catch { /* bukan input teks */ }
    }
  }
  window.scrollTo(0, newScreen ? 0 : scrollY);
}

/** Delegasi klik: elemen dengan data-act memanggil handler[act](arg, el). */
export function delegate(root: HTMLElement, handlers: Record<string, (arg: string, el: HTMLElement) => void>): void {
  const run = (e: Event) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
    if (!el || !root.contains(el) || el.classList.contains('disabled') || (el as HTMLButtonElement).disabled) return;
    const fn = handlers[el.dataset.act!];
    if (fn) { e.preventDefault(); fn(el.dataset.arg ?? '', el); }
  };
  root.addEventListener('click', run);
  root.addEventListener('keydown', (e) => {
    if ((e as KeyboardEvent).key === 'Enter' && (e.target as HTMLElement).getAttribute('role') === 'button') run(e);
  });
}

export function stars(): string {
  return `<div class="sky" aria-hidden="true"><div class="stars s1"></div><div class="stars s2"></div><div class="moon"></div></div>`;
}

export function vibrate(ms = 30): void {
  try { navigator.vibrate?.(ms); } catch { /* tidak didukung */ }
}
