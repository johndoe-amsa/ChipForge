import type { App } from '../app/app';
import type { NumberDef } from '../core/params';
import { numberControl, segmented, toggleControl } from './controls';
import { formatCount, h, icon } from './dom';
import { button, dialog, field, type Dialog } from './widgets';

type Format = 'obj' | 'step';

const FORMAT_KEY = 'chipforge.exportFormat';

function loadFormat(): Format {
  try {
    return localStorage.getItem(FORMAT_KEY) === 'obj' ? 'obj' : 'step';
  } catch {
    return 'step';
  }
}

const NOTES: Record<Format, string[]> = {
  obj: [
    'Quads, UV, normales lisses, un objet par copeau, groupes face_coupe / face_libre / flancs / extremites + fichier MTL. Axe vertical Y.',
    'Couleurs de revenu : couleurs de sommets (blocs #MRGB, lus par Blender : attribut « Color ») et un matériau MTL par teinte.',
  ],
  step: [
    'AP214 : solides B-Rep NURBS fermés (6 faces par copeau), assemblage nommé pour un tas, couleur par groupe de faces. Millimètres, axe vertical Z.',
    'Couleurs de revenu : teinte moyenne de chaque face.',
  ],
};

/** Boîte de dialogue d'export : choix du format, options propres au format, nom du fichier. */
export function buildExportDialog(app: App): Dialog {
  let format: Format = loadFormat();

  const card = (f: Format, title: string, sub: string, desc: string) => {
    const b = h('button', { class: 'cf-format', attrs: { type: 'button', role: 'radio' } }, [
      h('span', { class: 'cf-format-icon' }, [icon(f === 'obj' ? 'wire' : 'preset', 'w-5 h-5')]),
      h('span', { class: 'cf-format-text' }, [
        h('span', { class: 'cf-format-title' }, [h('span', { text: title }), h('span', { class: 'cf-format-ext', text: sub })]),
        h('span', { class: 'cf-format-desc', text: desc }),
      ]),
    ]);
    b.addEventListener('click', () => {
      format = f;
      try {
        localStorage.setItem(FORMAT_KEY, f);
      } catch {
        /* préférence non mémorisée */
      }
      refresh();
    });
    return b;
  };
  const objCard = card('obj', 'OBJ', '.zip', 'Maillage quad + MTL, pour le rendu (Blender, KeyShot).');
  const stepCard = card('step', 'STEP', '.stp', 'Surfaces NURBS B-Rep, pour la CAO et KeyShot.');
  const formats = h('div', { class: 'cf-formats', attrs: { role: 'radiogroup', 'aria-label': 'Format' } }, [stepCard, objCard]);

  // --- Options OBJ
  const unit = segmented(
    [
      { value: 'mm', label: 'mm', title: '1 unité = 1 mm (CAO, KeyShot)' },
      { value: 'm', label: 'm', title: '1 unité = 1 m (Blender : taille réelle à l’import)' },
    ],
    () => app.state.exp.unit,
    (v) => app.setExport({ unit: v }),
    'cf-seg-block',
  );
  const uvMode = segmented(
    [
      { value: 'reel', label: 'Échelle réelle', title: 'Densité de texels constante sur tous les copeaux' },
      { value: 'normalise', label: '0–1 par copeau', title: 'Chaque copeau occupe tout l’espace UV' },
    ],
    () => app.state.exp.uvMode,
    (v) => app.setExport({ uvMode: v }),
    'cf-seg-block',
  );
  const defUv: NumberDef = { kind: 'number', key: 'length', label: '1 unité UV =', section: 'macro', hint: 'Nombre de millimètres couverts par une répétition de texture.', unit: 'mm', min: 0.5, max: 100, step: 0.1, hardMin: 0.01, hardMax: 10000, log: true };
  const uvScale = numberControl(defUv, () => app.state.exp.uvScaleMM, (v) => app.setExport({ uvScaleMM: Math.min(10000, Math.max(0.01, v)) }), () => app.state.exp.uvScaleMM !== 10, () => app.setExport({ uvScaleMM: 10 }), 'uv-scale');
  const meshDetail = segmented(
    [
      { value: 'standard', label: 'Standard', title: 'Jusqu’à 600 k sommets par copeau' },
      { value: 'fin', label: 'Fin', title: 'Micro-reliefs résolus, jusqu’à 1,5 M sommets par copeau' },
      { value: 'ultra', label: 'Ultra', title: 'Très dense, jusqu’à 4 M sommets par copeau (fichiers lourds)' },
    ],
    () => app.state.exp.meshDetail,
    (v) => app.setExport({ meshDetail: v }),
    'cf-seg-block',
  );
  const objOpts = h('div', { class: 'cf-grid-2' }, [
    field('Résolution du maillage', meshDetail.el),
    field('Unité', unit.el),
    field('Coordonnées UV', uvMode.el),
    h('div', { class: 'cf-uv-scale' }, [uvScale.el]),
  ]);

  // --- Options STEP
  const stepDetail = segmented(
    [
      { value: 'leger', label: 'Léger', title: 'Forme globale, fichiers compacts' },
      { value: 'standard', label: 'Standard', title: 'Forme + bords, bon compromis' },
      { value: 'fin', label: 'Fin', title: 'Micro-reliefs inclus dans les NURBS (fichiers lourds)' },
    ],
    () => app.state.exp.stepDetail,
    (v) => app.setExport({ stepDetail: v }),
    'cf-seg-block',
  );
  const stepOpts = h('div', {}, [
    field('Détail des surfaces', stepDetail.el),
    h('p', { class: 'cf-hint', text: 'Toujours en millimètres. Le niveau Fin intègre les micro-reliefs dans les NURBS : fichiers nettement plus lourds.' }),
  ]);

  // --- Commun
  const nameInput = h('input', { class: 'cf-text', attrs: { type: 'text', maxlength: '80', 'aria-label': 'Nom du fichier', spellcheck: 'false' } });
  nameInput.addEventListener('change', () => app.setExport({ baseName: nameInput.value.trim() }));
  const ext = h('span', { class: 'cf-input-suffix' });
  const exportBin = toggleControl('Inclure le bac', 'Ajoute le bac (objet « bac ») à l’export, à sa place sous le tas.', () => app.state.pile.exportBin, (v) => app.setPile({ exportBin: v }));
  const binWrap = h('div', {}, [exportBin.el]);

  const stale = h('div', { class: 'cf-callout cf-callout-warn' }, [
    icon('alert', 'w-4 h-4 shrink-0'),
    h('span', { text: 'Les réglages ont changé depuis la génération du tas : générez-le avant d’exporter.' }),
    button({ label: 'Générer le tas', icon: 'play', size: 'sm', onClick: () => app.generatePile() }),
  ]);

  const notes = h('ul', { class: 'cf-notes' });
  const summary = h('span', { class: 'cf-dialog-summary' });
  const cancel = button({ label: 'Annuler', variant: 'ghost', onClick: () => dlg.close() });
  const go = h('button', { class: 'cf-btn cf-btn-primary', attrs: { type: 'button' } }, [icon('download'), h('span')]);
  go.addEventListener('click', () => {
    if (document.activeElement === nameInput) app.setExport({ baseName: nameInput.value.trim() });
    dlg.close();
    void app.exportAs(format);
  });

  const dlg = dialog({
    icon: 'download',
    title: 'Exporter',
    subtitle: 'Tout est calculé dans votre navigateur : aucune donnée ne quitte votre poste.',
    body: [
      stale,
      h('div', { class: 'cf-dialog-label', text: 'Format' }),
      formats,
      h('div', { class: 'cf-dialog-label', text: 'Options' }),
      objOpts,
      stepOpts,
      field('Nom du fichier', h('div', { class: 'cf-input-group' }, [nameInput, ext])),
      binWrap,
      h('details', { class: 'cf-disclosure' }, [h('summary', { text: 'Contenu du fichier' }), notes]),
    ],
    footer: [summary, cancel, go],
    onOpen: () => refresh(),
  });

  const refresh = () => {
    const obj = format === 'obj';
    objCard.classList.toggle('is-active', obj);
    stepCard.classList.toggle('is-active', !obj);
    objCard.setAttribute('aria-checked', String(obj));
    stepCard.setAttribute('aria-checked', String(!obj));
    objOpts.hidden = !obj;
    stepOpts.hidden = obj;
    for (const c of [unit, uvMode, uvScale, meshDetail, stepDetail, exportBin]) c.refresh();
    (uvScale.el.parentElement as HTMLElement).hidden = app.state.exp.uvMode !== 'reel';
    nameInput.placeholder = app.defaultBaseName();
    if (document.activeElement !== nameInput) nameInput.value = app.state.exp.baseName;
    ext.textContent = obj ? '.zip' : '.stp';
    const tas = app.state.mode === 'tas';
    binWrap.hidden = !(tas && app.state.pile.container === 'bac');
    stale.hidden = !(tas && app.stale);
    notes.replaceChildren(...NOTES[format].map((t) => h('li', { text: t })));
    const n = tas ? app.state.pile.count : 1;
    summary.textContent = `${formatCount(n)} copeau${n > 1 ? 'x' : ''}${tas && app.state.pile.exportBin && app.state.pile.container === 'bac' ? ' + bac' : ''}`;
    (go.lastChild as HTMLElement).textContent = `Exporter ${obj ? 'OBJ' : 'STEP'}`;
    go.disabled = app.exporting || (tas && app.stale);
  };
  app.on(() => {
    if (dlg.el.open) refresh();
  });
  return dlg;
}
