import { defineConfig, type Plugin } from 'vite';
import tailwindcss from '@tailwindcss/vite';
import securityHeaders from './security/headers.json';

/**
 * Politique de sécurité : la même source (security/headers.json) sert aux en-têtes HTTP
 * Vercel (vercel.json, vérifié par les tests), au serveur `vite preview` et à une balise
 * <meta> CSP injectée au build (défense en profondeur si le site est servi ailleurs).
 */
const csp = securityHeaders['Content-Security-Policy'];
// frame-ancestors et upgrade-insecure-requests n'ont pas d'effet dans une balise <meta>.
const metaCsp = csp
  .split(';')
  .map((d) => d.trim())
  .filter((d) => d && !d.startsWith('frame-ancestors') && !d.startsWith('upgrade-insecure-requests'))
  .join('; ');

function cspMeta(): Plugin {
  return {
    name: 'chipforge-csp-meta',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace('<meta charset="UTF-8" />', `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${metaCsp}" />`);
    },
  };
}

export default defineConfig({
  base: '/',
  plugins: [tailwindcss(), cspMeta()],
  worker: { format: 'es' },
  build: {
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 2500,
    modulePreload: { polyfill: false },
  },
  preview: {
    // En local (http) : mêmes en-têtes, sans HSTS ni upgrade-insecure-requests.
    headers: {
      ...securityHeaders,
      'Content-Security-Policy': csp.replace(/;\s*upgrade-insecure-requests/, ''),
      'Strict-Transport-Security': 'max-age=0',
    },
  },
});
