/**
 * Détection des scripts inline dans un document HTML.
 *
 * Volontairement sans expression régulière sur les balises (fragile : casse, espaces,
 * attributs dans la balise fermante…) : le document est parcouru en minuscules et chaque
 * élément <script> est examiné. Une balise sans attribut `src`, ou dont le contenu n'est pas
 * vide, est signalée. Utilisé par scripts/check-dist.mjs et par les tests.
 *
 * @param {string} html
 * @returns {string[]} problèmes détectés (vide si aucun)
 */
export function inlineScriptProblems(html) {
  const lower = html.toLowerCase();
  const problems = [];
  let i = 0;
  while ((i = lower.indexOf('<script', i)) !== -1) {
    const next = lower.charAt(i + 7);
    // « <scripts », « <script-x »… ne sont pas des balises <script>
    if (next && next !== '>' && next !== '/' && next.trim() !== '') {
      i += 7;
      continue;
    }
    const end = lower.indexOf('>', i);
    if (end === -1) {
      problems.push('balise <script> non fermée');
      break;
    }
    const openTag = lower.slice(i + 7, end);
    if (!hasAttribute(openTag, 'src')) problems.push('script inline (balise <script> sans attribut src)');
    if (openTag.trimEnd().endsWith('/')) {
      i = end + 1;
      continue;
    }
    const close = lower.indexOf('</script', end);
    if (close === -1) {
      problems.push('balise </script> manquante');
      break;
    }
    if (lower.slice(end + 1, close).trim() !== '') problems.push('contenu inline dans une balise <script>');
    i = close + 8;
  }
  return problems;
}

/** Vrai si la liste d'attributs (en minuscules) contient l'attribut `name`. */
function hasAttribute(attrs, name) {
  let k = 0;
  while ((k = attrs.indexOf(name, k)) !== -1) {
    const before = k === 0 ? ' ' : attrs.charAt(k - 1);
    let j = k + name.length;
    while (attrs.charAt(j) === ' ' || attrs.charAt(j) === '\t' || attrs.charAt(j) === '\n' || attrs.charAt(j) === '\r') j++;
    if (before.trim() === '' && attrs.charAt(j) === '=') return true;
    k += name.length;
  }
  return false;
}
