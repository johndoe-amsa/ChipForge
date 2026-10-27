import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parsePreset, serializePreset, MAX_PRESET_BYTES } from '../src/app/presetFile';
import { DEFAULT_PARAMS } from '../src/core/params';
import { DEFAULT_PILE, DEFAULT_SELECTION, MAX_PILE_COUNT } from '../src/core/presets/presets';
import { safeFileName } from '../src/core/export/transform';
import { inlineScriptProblems } from '../scripts/html-guard.mjs';

const root = new URL('..', import.meta.url).pathname;
const read = (p: string) => readFileSync(join(root, p), 'utf8');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

describe('en-têtes et politique de sécurité', () => {
  const headers = JSON.parse(read('security/headers.json')) as Record<string, string>;
  const vercel = JSON.parse(read('vercel.json'));

  it('vercel.json applique exactement les en-têtes de security/headers.json', () => {
    const global = vercel.headers.find((h: { source: string }) => h.source === '/(.*)');
    const map = Object.fromEntries(global.headers.map((h: { key: string; value: string }) => [h.key, h.value]));
    expect(map).toEqual(headers);
  });

  it('la CSP est stricte (pas d’inline, pas d’eval, pas de domaine tiers)', () => {
    const csp = headers['Content-Security-Policy'];
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).not.toMatch(/'unsafe-inline'|'unsafe-eval'|\*|https?:/);
    const script = csp.split(';').find((d) => d.trim().startsWith('script-src'))!;
    expect(script.trim()).toBe("script-src 'self' 'wasm-unsafe-eval'");
  });

  it('les en-têtes de durcissement sont présents', () => {
    for (const k of ['Strict-Transport-Security', 'X-Content-Type-Options', 'X-Frame-Options', 'Referrer-Policy', 'Permissions-Policy', 'Cross-Origin-Opener-Policy']) {
      expect(headers[k], k).toBeTruthy();
    }
  });
});

describe('hygiène du code et des dépendances', () => {
  it("n'utilise aucune API d'injection HTML ni d'évaluation de code", () => {
    const forbidden = /\.innerHTML\b|\.outerHTML\b|insertAdjacentHTML|document\.write|\beval\s*\(|new Function\s*\(|setTimeout\s*\(\s*['"`]/;
    for (const f of walk(join(root, 'src'))) {
      expect(forbidden.test(readFileSync(f, 'utf8')), f).toBe(false);
    }
  });

  it("index.html ne contient ni script inline ni ressource externe", () => {
    const html = read('index.html');
    expect(inlineScriptProblems(html)).toEqual([]);
    expect(html).not.toMatch(/https?:\/\//);
  });

  it('le détecteur de scripts inline résiste aux variantes de balises', () => {
    expect(inlineScriptProblems('<script type="module" src="/a.js"></script>')).toEqual([]);
    expect(inlineScriptProblems('<SCRIPT SRC="/a.js"></SCRIPT >')).toEqual([]);
    for (const bad of [
      '<script>alert(1)</script>',
      '<SCRIPT>alert(1)</SCRIPT>',
      '<Script >alert(1)</script >',
      '<script\n>alert(1)</script\t foo="bar">',
      '<script src="/a.js">alert(1)</script>',
      '<script data-src="/a.js"></script>',
      '<script',
    ]) {
      expect(inlineScriptProblems(bad).length, bad).toBeGreaterThan(0);
    }
    expect(inlineScriptProblems('<scripts></scripts>')).toEqual([]);
  });

  it('les dépendances d’exécution sont limitées et figées', () => {
    const pkg = JSON.parse(read('package.json'));
    expect(Object.keys(pkg.dependencies).sort()).toEqual(['@dimforge/rapier3d-compat', 'fflate', 'three']);
    for (const v of [...Object.values(pkg.dependencies), ...Object.values(pkg.devDependencies)] as string[]) {
      expect(v).toMatch(/^\d+\.\d+\.\d+$/);
    }
    expect(read('.npmrc')).toMatch(/^ignore-scripts=true$/m);
  });
});

describe('import de presets (données non fiables)', () => {
  const parse = (o: unknown) => parsePreset(typeof o === 'string' ? o : JSON.stringify(o), DEFAULT_PARAMS, DEFAULT_SELECTION);

  it('relit un preset exporté', () => {
    const text = serializePreset({ name: 'Test', selection: DEFAULT_SELECTION, params: { ...DEFAULT_PARAMS, length: 42 }, seed: 7, mode: 'tas', pile: DEFAULT_PILE });
    const p = parse(text);
    expect(p.params.length).toBe(42);
    expect(p.seed).toBe(7);
    expect(p.mode).toBe('tas');
  });

  it('refuse les fichiers qui ne sont pas des presets', () => {
    expect(() => parse('pas du json')).toThrow();
    expect(() => parse({ hello: 1 })).toThrow();
    expect(() => parse([1, 2, 3])).toThrow();
    expect(() => parse({ format: 'chipforge-preset', version: 999 })).toThrow();
    expect(() => parse('x'.repeat(MAX_PRESET_BYTES + 1))).toThrow();
  });

  it('borne les valeurs et ignore les clés inconnues ou dangereuses', () => {
    const evil = `{"format":"chipforge-preset","version":1,"name":"<img src=x onerror=alert(1)>",
      "__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}},
      "selection":{"material":"../../etc","form":"9.9","process":"tournage"},
      "params":{"length":1e308,"thickness":-5,"width":"12","burrSide":"<script>","__proto__":{"polluted":true},"evil":1},
      "seed":-12.7,"pile":{"count":100000,"variability":5,"physics":"oui"}}`;
    const p = parse(evil);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(p.name).not.toMatch(/[<>]/);
    expect(p.selection.material).toBe(DEFAULT_SELECTION.material);
    expect(p.selection.form).toBe(DEFAULT_SELECTION.form);
    expect(p.params.length).toBe(5000);
    expect(p.params.thickness).toBe(0.005);
    expect(p.params.width).toBe(DEFAULT_PARAMS.width);
    expect(p.params.burrSide).toBe(DEFAULT_PARAMS.burrSide);
    expect((p.params as unknown as Record<string, unknown>).evil).toBeUndefined();
    expect(p.seed).toBe(12);
    expect(p.pile.count).toBe(MAX_PILE_COUNT);
    expect(p.pile.variability).toBe(1);
    expect(p.pile.physics).toBe(DEFAULT_PILE.physics);
  });

  it('produit des noms de fichiers sûrs', () => {
    expect(safeFileName('../../etc/passwd')).toBe('etc_passwd');
    expect(safeFileName('Tas d’acier éprouvé')).toMatch(/^[A-Za-z0-9._-]+$/);
    expect(safeFileName('')).toBe('chipforge');
  });
});
