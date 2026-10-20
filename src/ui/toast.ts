import { h, icon } from './dom';

export type ToastKind = 'ok' | 'info' | 'warn' | 'error';

let host: HTMLElement | null = null;

/** Notification non bloquante (texte uniquement). */
export function toast(message: string, kind: ToastKind = 'info', ms = 5200): void {
  host ??= document.getElementById('toasts');
  if (!host) return;
  const ic = kind === 'ok' ? 'check' : kind === 'info' ? 'info' : 'alert';
  const el = h('div', { class: `cf-toast cf-toast-${kind}`, attrs: { role: kind === 'error' ? 'alert' : 'status' } }, [
    icon(ic, 'w-4 h-4 shrink-0 mt-0.5'),
    h('span', { text: message }),
  ]);
  host.appendChild(el);
  requestAnimationFrame(() => el.classList.add('is-in'));
  setTimeout(() => {
    el.classList.remove('is-in');
    setTimeout(() => el.remove(), 300);
  }, ms);
}
