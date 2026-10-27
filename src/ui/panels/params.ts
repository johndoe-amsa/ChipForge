import type { App } from '../../app/app';
import { PARAM_DEFS, PARAM_DEF_MAP, SECTIONS, clampParam, type ChipParams, type NumberDef, type ParamKey, type SectionId } from '../../core/params';
import { h } from '../dom';
import { numberControl, selectControl, toggleControl, type Control } from '../controls';
import { section, button, type Section } from '../widgets';
import type { PanelDef } from './panel';

const SECTION_ICON: Record<SectionId, string> = {
  macro: 'coil',
  section: 'section',
  profil: 'taper',
  bords: 'edge',
  micro: 'wave',
  bruit: 'noise',
  couleur: 'flame',
};

/** Répartition des sections de paramètres dans les onglets du volet latéral. */
const TABS: { id: string; icon: string; label: string; subtitle: string; sections: SectionId[] }[] = [
  { id: 'geometrie', icon: 'coil', label: 'Géométrie', subtitle: 'Forme globale, section et profil du copeau', sections: ['macro', 'section', 'profil'] },
  { id: 'surface', icon: 'waves', label: 'Surface', subtitle: 'Bords, micro-reliefs et irrégularités', sections: ['bords', 'micro', 'bruit'] },
  { id: 'couleurs', icon: 'flame', label: 'Couleurs', subtitle: 'Teintes de revenu (oxydation à la coupe)', sections: ['couleur'] },
];

function paramControl(app: App, key: ParamKey): Control {
  const def = PARAM_DEF_MAP[key];
  if (def.kind === 'number') {
    return numberControl(
      def,
      () => app.state.params[key] as number,
      (v) => app.setParam(key, clampParam(def as NumberDef, v) as ChipParams[typeof key]),
      () => app.isModified(key),
      () => app.setParam(key, app.state.base[key]),
    );
  }
  if (def.kind === 'bool') {
    return toggleControl(def.label, def.hint, () => app.state.params[key] as boolean, (v) => app.setParam(key, v as ChipParams[typeof key]));
  }
  return selectControl(def.label, def.hint, def.options, () => String(app.state.params[key]), (v) => app.setParam(key, v as ChipParams[typeof key]), () => app.isModified(key));
}

/** Onglets Géométrie, Surface et Couleurs : paramètres du copeau par sections repliables. */
export function buildParamPanels(app: App): PanelDef[] {
  return TABS.map((tab) => {
    const controls: Control[] = [];
    const groups: { sec: Section; keys: ParamKey[] }[] = [];
    for (const id of tab.sections) {
      const meta = SECTIONS.find((s) => s.id === id)!;
      const defs = PARAM_DEFS.filter((d) => d.section === id);
      const items = defs.map((d) => {
        const c = paramControl(app, d.key);
        controls.push(c);
        return c.el;
      });
      groups.push({ sec: section({ icon: SECTION_ICON[id], title: meta.title, hint: meta.hint, body: items }), keys: defs.map((d) => d.key) });
    }
    const keys = groups.flatMap((g) => g.keys);
    const modified = () => keys.filter((k) => app.isModified(k)).length;
    const reset = button({ label: 'Réinitialiser', icon: 'reset', variant: 'ghost', size: 'sm', title: 'Remettre les paramètres de cet onglet aux valeurs du preset', onClick: () => app.resetParams(keys) });

    const refresh = () => {
      for (const c of controls) c.refresh();
      for (const g of groups) g.sec.setCount(g.keys.filter((k) => app.isModified(k)).length);
      reset.disabled = modified() === 0;
    };
    app.on((what) => {
      if (what.has('params') || what.has('preset')) refresh();
    });
    refresh();

    return {
      id: tab.id,
      icon: tab.icon,
      label: tab.label,
      title: tab.label,
      subtitle: tab.subtitle,
      body: h('div', {}, groups.map((g) => g.sec.el)),
      actions: [reset],
      modified,
    };
  });
}

