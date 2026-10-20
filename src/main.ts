import './styles.css';
import { App } from './app/app';
import { bindShortcuts, buildHeader, buildLeftPanel, buildRightPanel, buildViewportOverlay } from './ui/panels';
import { toast } from './ui/toast';

function boot(): void {
  const viewport = document.getElementById('viewport');
  const left = document.getElementById('panel-left');
  const right = document.getElementById('panel-right');
  const top = document.getElementById('topbar');
  if (!viewport || !left || !right || !top) return;

  let app: App;
  try {
    app = new App(viewport);
  } catch (e) {
    const msg = h1(`Impossible d'initialiser le rendu 3D (WebGL) : ${(e as Error).message}`);
    viewport.appendChild(msg);
    return;
  }
  buildHeader(app, top);
  buildLeftPanel(app, left);
  buildRightPanel(app, right);
  buildViewportOverlay(app, viewport);
  bindShortcuts(app);

  document.getElementById('scrim')?.addEventListener('click', () => document.body.classList.remove('show-left', 'show-right'));
  window.addEventListener('unhandledrejection', (e) => toast(`Erreur inattendue : ${String(e.reason?.message ?? e.reason)}`, 'error'));
}

function h1(text: string): HTMLElement {
  const el = document.createElement('div');
  el.className = 'cf-fatal';
  el.textContent = text;
  return el;
}

boot();
