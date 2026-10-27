import type { ChipQuality } from '../core/presets/presets';
import { h, icon } from './dom';

/**
 * Éléments d'interface partagés par les panneaux : sections repliables à icône, pastilles de
 * qualité, boîtes de dialogue modales et menus déroulants.
 */

export const QUALITY_LABEL: Record<ChipQuality, string> = { bon: 'Bon copeau', acceptable: 'Acceptable', mauvais: 'Mauvais copeau' };
export const QUALITY_MARK: Record<ChipQuality, string> = { bon: '✓', acceptable: '~', mauvais: '✗' };

export function badge(q: ChipQuality, text?: string): HTMLElement {
  return h('span', { class: `cf-badge cf-badge-${q}`, text: `${QUALITY_MARK[q]} ${text ?? QUALITY_LABEL[q]}` });
}

export interface Section {
  el: HTMLDetailsElement;
  /** Pastille « n modifié(s) » dans l'en-tête (0 = masquée). */
  setCount(n: number): void;
}

/** Section repliable : icône, titre, compteur de modifications, aide sous le titre. */
export function section(opts: { icon: string; title: string; hint?: string; open?: boolean; body: Node[]; actions?: Node[] }): Section {
  const count = h('span', { class: 'cf-count', attrs: { hidden: '' } });
  const el = h('details', { class: 'cf-section' }, [
    h('summary', { class: 'cf-section-title' }, [
      icon('chevron', 'cf-chevron w-3 h-3'),
      icon(opts.icon, 'cf-section-icon w-4 h-4'),
      h('span', { class: 'cf-section-name', text: opts.title }),
      count,
      ...(opts.actions ?? []),
    ]),
    h('div', { class: 'cf-section-body' }, [opts.hint ? h('p', { class: 'cf-hint', text: opts.hint }) : null, ...opts.body]),
  ]);
  el.open = opts.open ?? true;
  return {
    el,
    setCount(n) {
      count.hidden = n === 0;
      count.textContent = String(n);
      count.title = `${n} paramètre(s) modifié(s) par rapport au preset`;
    },
  };
}

/** Champ libellé (au-dessus) + contrôle. */
export function field(label: string, control: HTMLElement, hint?: string): HTMLElement {
  return h('div', { class: 'cf-field', title: hint }, [h('div', { class: 'cf-field-label', text: label }), control]);
}

export function button(opts: { label?: string; icon?: string; title?: string; variant?: 'primary' | 'ghost' | 'danger'; size?: 'sm' | 'lg'; block?: boolean; onClick: () => void }): HTMLButtonElement {
  const cls = ['cf-btn'];
  if (opts.variant) cls.push(`cf-btn-${opts.variant}`);
  if (opts.size) cls.push(`cf-btn-${opts.size}`);
  if (opts.block) cls.push('cf-btn-block');
  if (!opts.label) cls.push('cf-btn-icon');
  const b = h('button', { class: cls.join(' '), title: opts.title, attrs: { type: 'button', ...(opts.label ? {} : { 'aria-label': opts.title ?? '' }) } }, [
    opts.icon ? icon(opts.icon) : null,
    opts.label ? h('span', { text: opts.label }) : null,
  ]);
  b.addEventListener('click', opts.onClick);
  return b;
}

/** Raccourci clavier affiché (touche). */
export function kbd(key: string): HTMLElement {
  return h('kbd', { class: 'cf-kbd', text: key });
}

// ---------------------------------------------------------------------------- dialogues

export interface Dialog {
  el: HTMLDialogElement;
  open(): void;
  close(): void;
}

/** Boîte de dialogue modale native : en-tête (icône, titre, fermer), corps, pied. */
export function dialog(opts: { icon: string; title: string; subtitle?: string; body: Node[]; footer?: Node[]; wide?: boolean; onOpen?: () => void }): Dialog {
  const closeBtn = h('button', { class: 'cf-btn cf-btn-ghost cf-btn-icon', title: 'Fermer (Échap)', attrs: { type: 'button', 'aria-label': 'Fermer' } }, [icon('close')]);
  const el = h('dialog', { class: `cf-dialog ${opts.wide ? 'cf-dialog-wide' : ''}`, attrs: { 'aria-label': opts.title, tabindex: '-1' } }, [
    h('header', { class: 'cf-dialog-head' }, [
      h('span', { class: 'cf-dialog-icon' }, [icon(opts.icon, 'w-4 h-4')]),
      h('div', { class: 'cf-dialog-titles' }, [h('h2', { class: 'cf-dialog-title', text: opts.title }), opts.subtitle ? h('p', { class: 'cf-dialog-sub', text: opts.subtitle }) : null]),
      closeBtn,
    ]),
    h('div', { class: 'cf-dialog-body' }, opts.body),
    opts.footer ? h('footer', { class: 'cf-dialog-foot' }, opts.footer) : null,
  ]);
  closeBtn.addEventListener('click', () => el.close());
  // Clic sur le fond : fermeture.
  el.addEventListener('click', (e) => {
    if (e.target === el) el.close();
  });
  document.body.appendChild(el);
  return {
    el,
    open() {
      if (el.open) return;
      el.showModal();
      // Focus sur la boîte elle-même (pas sur « Fermer ») ; onOpen peut le placer ailleurs.
      el.focus();
      opts.onOpen?.();
    },
    close() {
      el.close();
    },
  };
}

// ---------------------------------------------------------------------------- menus

export interface MenuItem {
  icon: string;
  label: string;
  hint?: string;
  shortcut?: string;
  onClick: () => void;
}

/** Menu déroulant (API popover : fermeture au clic extérieur et à Échap). */
export function menu(trigger: HTMLButtonElement, items: (MenuItem | 'sep')[]): HTMLElement {
  const el = h('div', { class: 'cf-menu', attrs: { popover: 'auto', role: 'menu' } });
  for (const it of items) {
    if (it === 'sep') {
      el.append(h('div', { class: 'cf-menu-sep', attrs: { role: 'separator' } }));
      continue;
    }
    const b = h('button', { class: 'cf-menu-item', attrs: { type: 'button', role: 'menuitem' } }, [
      icon(it.icon, 'w-4 h-4 shrink-0'),
      h('span', { class: 'cf-menu-text' }, [h('span', { text: it.label }), it.hint ? h('span', { class: 'cf-menu-hint', text: it.hint }) : null]),
      it.shortcut ? kbd(it.shortcut) : null,
    ]);
    b.addEventListener('click', () => {
      el.hidePopover();
      it.onClick();
    });
    el.append(b);
  }
  document.body.appendChild(el);
  trigger.setAttribute('aria-haspopup', 'menu');
  trigger.addEventListener('click', () => {
    const r = trigger.getBoundingClientRect();
    el.style.top = `${Math.round(r.bottom + 6)}px`;
    el.style.right = `${Math.round(window.innerWidth - r.right)}px`;
    el.togglePopover();
  });
  el.addEventListener('toggle', (e) => trigger.setAttribute('aria-expanded', String((e as ToggleEvent).newState === 'open')));
  return el;
}
