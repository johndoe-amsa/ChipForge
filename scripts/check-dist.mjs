#!/usr/bin/env node
/**
 * Contrôle de sécurité du build (dist/) :
 *  - aucune URL externe hors liste blanche (pas de CDN, traceur ni appel réseau caché),
 *  - aucun script inline dans le HTML,
 *  - présence de la balise CSP.
 * Échoue (code 1) au moindre écart. Utilisé en CI après `npm run build`.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { inlineScriptProblems } from './html-guard.mjs';

const DIST = new URL('../dist/', import.meta.url).pathname;

// URLs présentes dans les bibliothèques sous forme de simples chaînes (jamais chargées).
const ALLOWED = [
  /^http:\/\/www\.w3\.org\/2000\/svg$/, // espace de noms SVG
  /^http:\/\/www\.w3\.org\/1999\/xhtml$/, // espace de noms XHTML
  /^https:\/\/jcgt\.org\/published\/0007\/04\/01\/$/, // citation dans un shader three.js
];

function walk(dir) {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const errors = [];
const files = walk(DIST);
for (const file of files) {
  const ext = extname(file);
  if (!['.js', '.css', '.html', '.svg', '.json', '.mjs'].includes(ext)) continue;
  const text = readFileSync(file, 'utf8');
  for (const m of text.matchAll(/https?:\/\/[^\s"'`)<>\\]+/g)) {
    const url = m[0];
    if (!ALLOWED.some((re) => re.test(url))) errors.push(`${file}: URL externe non autorisée : ${url}`);
  }
  if (ext === '.html') {
    for (const problem of inlineScriptProblems(text)) errors.push(`${file}: ${problem}`);
    if (/\son[a-z]+\s*=/i.test(text)) errors.push(`${file}: attribut de gestionnaire d'événement inline interdit`);
    if (!text.includes('http-equiv="Content-Security-Policy"')) errors.push(`${file}: balise CSP absente`);
  }
}

if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log(`check-dist : ${files.length} fichiers contrôlés, aucun problème.`);
