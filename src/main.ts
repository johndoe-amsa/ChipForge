import './styles.css';
import { App } from './app/app';
import { bindShortcuts, buildShell } from './ui/shell';
import { toast } from './ui/toast';

function boot(): void {
  const viewport = document.getElementById('viewport');
  const sidebar = document.getElementById('sidebar');
  const rail = document.getElementById('rail');
  const top = document.getElementById('topbar');
  const status = document.getElementById('statusbar');
  if (!viewport || !sidebar || !rail || !top || !status) return;

  let app: App;
  try {
    app = new App(viewport);
  } catch (e) {
    const msg = h1(`Impossible d'initialiser le rendu 3D (WebGL) : ${(e as Error).message}`);
    viewport.appendChild(msg);
    return;
  }
  const shell = buildShell(app, { top, rail, sidebar, viewport, status });
  bindShortcuts(app, shell);

  window.addEventListener('unhandledrejection', (e) => toast(`Erreur inattendue : ${String(e.reason?.message ?? e.reason)}`, 'error'));
}

function h1(text: string): HTMLElement {
  const el = document.createElement('div');
  el.className = 'cf-fatal';
  el.textContent = text;
  return el;
}

boot();
