import type { App } from '../../app/app';
import { FORMS, MATERIALS, PROCESSES, SHORTCUTS } from '../../core/presets/presets';
import { h, icon } from '../dom';
import { badge, QUALITY_LABEL, QUALITY_MARK, section } from '../widgets';
import type { PanelDef } from './panel';

/** Teinte indicative de chaque matière (pastille de couleur). */
export const MATERIAL_SWATCH: Record<string, string> = {
  acier: '#8c939d',
  inox: '#c3c9d1',
  titane: '#8d879c',
  laiton: '#c9a548',
  plastique: '#e4dfd0',
  aluminium: '#d9dde2',
  cuivre: '#c8784a',
  superalliage: '#4f6c9e',
};

export const PROCESS_ICON: Record<string, string> = {
  tournage: 'turning',
  gorge: 'groove',
  fraisage: 'milling',
  percage: 'drilling',
};

export function swatch(material: string): HTMLElement {
  const el = h('span', { class: 'cf-swatch', attrs: { 'aria-hidden': 'true' } });
  el.style.setProperty('--swatch', MATERIAL_SWATCH[material] ?? '#888');
  return el;
}

/** Bibliothèque : matière, procédé, forme ISO 3685 et raccourcis atelier. */
export function buildLibraryPanel(app: App): PanelDef {
  // --- Preset courant
  const curBadge = h('div');
  const curTitle = h('div', { class: 'cf-current-title' });
  const curSub = h('div', { class: 'cf-current-sub' });
  const curDesc = h('p', { class: 'cf-current-desc' });
  const current = h('div', { class: 'cf-current' }, [curBadge, curTitle, curSub, curDesc]);

  // --- Matières
  const matButtons = MATERIALS.map((m) => {
    const b = h('button', { class: 'cf-tile', title: m.description, attrs: { type: 'button' } }, [
      swatch(m.id),
      h('span', { class: 'cf-tile-text' }, [h('span', { class: 'cf-tile-name', text: m.name }), h('span', { class: 'cf-tile-sub', text: m.grade })]),
    ]);
    b.addEventListener('click', () => app.applySelection({ material: m.id }));
    return { id: m.id, b };
  });

  // --- Procédés
  const procButtons = PROCESSES.map((p) => {
    const b = h('button', { class: 'cf-tile', title: p.description, attrs: { type: 'button' } }, [
      h('span', { class: 'cf-tile-icon' }, [icon(PROCESS_ICON[p.id] ?? 'turning', 'w-4 h-4')]),
      h('span', { class: 'cf-tile-text' }, [h('span', { class: 'cf-tile-name', text: p.name })]),
    ]);
    b.addEventListener('click', () => app.applySelection({ process: p.id }));
    return { id: p.id, b };
  });

  // --- Formes ISO, groupées par famille
  const families = new Map<number, typeof FORMS>();
  for (const f of FORMS) families.set(f.family, [...(families.get(f.family) ?? []), f]);
  const formButtons: { id: string; b: HTMLButtonElement }[] = [];
  const isoRows = [...families.entries()].map(([fam, forms]) =>
    h('div', { class: 'cf-iso-row' }, [
      h('span', { class: 'cf-iso-fam' }, [h('span', { class: 'cf-iso-num', text: String(fam) }), h('span', { text: forms[0].familyName })]),
      h(
        'div',
        { class: 'cf-pills' },
        forms.map((f) => {
          const b = h(
            'button',
            {
              class: `cf-pill cf-pill-${f.quality}`,
              title: `ISO ${f.id} — ${f.familyName} ${f.variant} (${QUALITY_LABEL[f.quality]})\n${f.description}`,
              attrs: { type: 'button' },
            },
            [h('span', { class: 'cf-pill-mark', text: QUALITY_MARK[f.quality] }), h('span', { text: f.variant })],
          );
          b.addEventListener('click', () => app.applySelection({ form: f.id }));
          formButtons.push({ id: f.id, b });
          return b;
        }),
      ),
    ]),
  );

  // --- Raccourcis atelier
  const scButtons = SHORTCUTS.map((sc) => {
    const b = h('button', { class: `cf-pill cf-pill-${sc.quality}`, title: `${sc.description} (ISO ${sc.form})`, attrs: { type: 'button' } }, [
      h('span', { class: 'cf-pill-mark', text: QUALITY_MARK[sc.quality] }),
      h('span', { text: sc.name }),
    ]);
    b.addEventListener('click', () => app.applySelection({ form: sc.form, shortcut: sc.id }));
    return { id: sc.id, b, quality: sc.quality };
  });
  const scGroup = (label: string, list: typeof scButtons) =>
    h('div', { class: 'cf-sc-group' }, [h('div', { class: 'cf-sc-label', text: label }), h('div', { class: 'cf-pills' }, list.map((s) => s.b))]);

  const legend = h('div', { class: 'cf-legend' }, [badge('bon', 'bon'), badge('acceptable', 'acceptable'), badge('mauvais', 'mauvais')]);

  const body = h('div', {}, [
    current,
    section({ icon: 'ingot', title: 'Matière', body: [h('div', { class: 'cf-tiles' }, matButtons.map((x) => x.b))] }).el,
    section({ icon: 'turning', title: 'Procédé', body: [h('div', { class: 'cf-tiles' }, procButtons.map((x) => x.b))] }).el,
    section({
      icon: 'coil',
      title: 'Forme ISO 3685',
      hint: 'Typologie normalisée des copeaux, classée selon leur comportement à l’usinage.',
      body: [legend, h('div', { class: 'cf-iso' }, isoRows)],
    }).el,
    section({
      icon: 'bolt',
      title: 'Raccourcis atelier',
      hint: 'Formes courantes, désignées par leur nom d’atelier.',
      body: [
        scGroup('Bons', scButtons.filter((s) => s.quality !== 'mauvais')),
        scGroup('Mauvais', scButtons.filter((s) => s.quality === 'mauvais')),
      ],
    }).el,
  ]);

  const refresh = () => {
    const sel = app.state.selection;
    for (const x of matButtons) x.b.classList.toggle('is-active', x.id === sel.material);
    for (const x of procButtons) x.b.classList.toggle('is-active', x.id === sel.process);
    for (const x of formButtons) x.b.classList.toggle('is-active', x.id === sel.form && !sel.shortcut);
    for (const x of scButtons) x.b.classList.toggle('is-active', x.id === sel.shortcut);
    for (const x of [...matButtons, ...procButtons, ...formButtons, ...scButtons]) x.b.setAttribute('aria-pressed', String(x.b.classList.contains('is-active')));
    const d = app.describeSelection();
    curBadge.replaceChildren(badge(d.quality));
    const sc = sel.shortcut ? SHORTCUTS.find((s) => s.id === sel.shortcut) : undefined;
    curTitle.textContent = sc ? `${sc.name} (ISO ${sel.form})` : d.title;
    curSub.replaceChildren(swatch(sel.material), h('span', { text: d.subtitle }));
    curDesc.textContent = d.description;
  };
  app.on((what) => {
    if (what.has('preset')) refresh();
  });
  refresh();

  return {
    id: 'preset',
    icon: 'preset',
    label: 'Preset',
    title: 'Preset',
    subtitle: 'Matière × procédé × forme ISO 3685',
    body,
  };
}
