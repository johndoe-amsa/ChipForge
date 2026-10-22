# ChipForge

Générateur paramétrique de **copeaux d'usinage / décolletage** en 3D, destiné au rendu (Blender, KeyShot).
L'application tourne entièrement dans le navigateur : aucune donnée ne quitte le poste de l'utilisateur.

- **Typologie ISO 3685** complète (8 familles, 17 variantes), classées *bon / acceptable / mauvais*, avec les raccourcis atelier (virgule, aiguille, arc, hélice courte, ruban, enchevêtré, longue hélice, rondelles imbriquées).
- **Presets Matière × Procédé** : acier, inox, titane, laiton, plastique, aluminium, cuivre, superalliage/trempé × tournage/décolletage, gorge/tronçonnage, fraisage, perçage.
- **46 paramètres** (curseurs + saisie numérique) : macro-géométrie, section, bords, profil longitudinal, micro-reliefs, bruit.
- **Mode tas** : jusqu'à 200 copeaux variés autour du preset, chute physique réaliste et déterministe.
- **Exports** : OBJ (+ MTL, archive .zip) et **STEP AP214 en B-Rep NURBS**.

---

## Utilisation

| Zone | Rôle |
|---|---|
| Panneau gauche | Presets (matière, procédé, forme ISO, raccourcis, presets personnels JSON) puis paramètres en accordéons. Un paramètre modifié s'affiche en bleu ; ↺ (ou double-clic sur son nom) le remet à la valeur du preset. |
| Centre | Vue 3D : rotation (clic gauche), panoramique (clic droit), zoom (molette). Barre d'outils : recadrer, grille, axes, filaire, damier UV, MatCap, qualité d'aperçu *Rapide / Détaillé*. |
| Haut | Mode *Copeau unique / Tas*, **seed** (🎲 = nouvelle variation), export rapide OBJ / STEP. |
| Panneau droit | Réglages du tas, statistiques (quads, triangles, sommets), options d'export. |

Raccourcis clavier : `R` nouvelle seed · `F` recadrer · `W` filaire · `U` damier UV · `Échap` ferme les tiroirs (tablette).

**Seed** : toute la part aléatoire (bruit, crans, cassures, dispersion du tas, chute physique) dérive de la seed.
Mêmes réglages + même seed = exactement la même géométrie, à l'aperçu comme à l'export.

**Aperçu et export** : l'aperçu *Rapide* lisse les micro-reliefs trop fins pour sa résolution (indiqué dans les statistiques),
puis s'affine automatiquement en qualité détaillée dès que les réglages ne bougent plus.
L'export recalcule la géométrie à sa propre résolution, plus fine (*Standard / Fin / Ultra* pour l'OBJ, *Léger / Standard / Fin* pour le STEP).

## Géométrie

Chaque copeau est un **solide fermé et étanche** obtenu par balayage d'une section le long d'une fibre :

- **Fibre** : intégrée à partir de sa courbure et de sa torsion (vecteur de Darboux). Une hélice de rayon R et de pas p a
  une courbure κ = R/(R²+c²) et une torsion τ = c/(R²+c²), avec c = p/2π. Avec la croissance du rayon, le bruit et un confinement,
  le même modèle produit spirales, hélices coniques, rubans, arcs liés et pelotes enchevêtrées.
- **Section** : 4 zones nommées — `face_coupe` (convexe, frottée sur l'outil), `face_libre` (concave, lamellaire), deux `flancs` —
  avec trapèze, cambrure en arc ou en V, amincissement des bords, arrondi d'arête, bavures et craquelures.
- **Micro-reliefs** : lamelles de cisaillement, stries de l'outil, ondulation, segmentation en dents de scie, bruit de surface.
- **Extrémités** (`extremites`) : faces de rupture irrégulières fermées par des carreaux de Coons.
- **Éviter les auto-intersections** (option, active par défaut) : aucune portion du copeau ne traverse une autre, y compris
  dans les pelotes enchevêtrées.
  1. *Pendant la croissance*, la pointe anticipe sa trajectoire et glisse sur les portions déjà formées ; pour les hélices,
     le tube entier contourne ses passages précédents. La flexion reste bornée (aucune pliure de la section).
  2. *Relaxation finale* des contacts restants : déplacement lisse (B-spline) de la fibre, quasi inextensible, à courbure
     ajoutée bornée, jusqu'à ce qu'aucun pavé englobant les sections réellement maillées n'en recouvre un autre.
  Le résultat est contrôlé dans l'aperçu (statistique « Auto-intersections ») et, dans les tests, par une vérification
  indépendante sur le maillage final (aucun sommet d'une portion à l'intérieur d'une autre, aucune pliure ajoutée).

## Exports

### OBJ (archive `.zip` = `.obj` + `.mtl`)
- Maillage **quad** soudé, **normales lisses** (séparées aux faces de rupture), **UV** sans recouvrement :
  - *échelle réelle* (défaut) : 1 unité UV = *n* mm, donc densité de texels identique sur tous les copeaux d'un tas ;
  - *0–1 par copeau* : îlots empilés (face de coupe, face libre, flancs, extrémités).
- Un objet `o copeau_###` par copeau ; 4 groupes de faces avec `usemtl face_coupe | face_libre | flancs | extremites`.
  Il suffit d'assigner un matériau par groupe dans Blender ou KeyShot.
- Unité **mm** (défaut) ou **m** (taille réelle à l'import Blender). Axe vertical **+Y** (import Blender par défaut).

### STEP (`.stp`) — solution retenue
Le STEP est écrit par un **exporteur maison en TypeScript, sans dépendance** (aucun WebAssembly lourd à télécharger).
Chaque copeau devient un `MANIFOLD_SOLID_BREP` de **6 faces NURBS** :

- 4 surfaces **B-spline bicubiques** le long de la fibre (face de coupe, flanc B, face libre, flanc A) ;
- 2 faces de rupture (carreaux de Coons B-spline).

Les points de la grille servent de pôles de contrôle (approximation B-spline sans dépassement).
Les surfaces voisines partagent exactement leurs pôles de bord et leurs nœuds, si bien que les arêtes
(`B_SPLINE_CURVE_WITH_KNOTS`) sont rigoureusement communes et le solide est étanche.
Un tas est écrit comme un **assemblage** (un produit nommé par copeau).
Chaque groupe de faces porte une **couleur distincte**, ce qui permet de séparer les matériaux dans KeyShot.
Unité mm, axe vertical **Z** (convention CAO).

La validité est vérifiée automatiquement en CI : chaque fichier STEP généré est **relu par OpenCascade**
(`occt-import-js`, dépendance de test uniquement, jamais livrée au navigateur). Le test contrôle succès de lecture,
6 faces par copeau, orientation (volume positif) et écart de volume < 3 % avec le maillage.

> Le niveau *Fin* intègre les micro-reliefs dans les NURBS : fichiers nettement plus lourds.
> Pour le rendu, *Léger / Standard* + textures de relief dans KeyShot donnent souvent le meilleur compromis.

## Déploiement (Vercel)

1. Sur [vercel.com](https://vercel.com) : *Add New → Project → Import* le dépôt GitHub `ChipForge`.
2. Vercel lit `vercel.json` (framework Vite, `npm ci`, `npm run build`, dossier `dist`) : aucun réglage à saisir.
3. Choisir la branche de production (par défaut la branche principale du dépôt).

Le site est 100 % statique : pas de serveur, pas de variable d'environnement, pas de base de données.

## Sécurité

| Mesure | Détail |
|---|---|
| Aucune ressource tierce | Pas de CDN, de police externe, d'analytics ni de cookie. Tout est empaqueté et servi depuis le même domaine. `scripts/check-dist.mjs` fait échouer le build si une URL externe apparaît dans `dist/`. |
| En-têtes HTTP stricts | `vercel.json` (source unique : `security/headers.json`, cohérence vérifiée par les tests) : CSP `default-src 'none'`, scripts `'self'` uniquement (+ `'wasm-unsafe-eval'` pour le moteur physique), aucun `unsafe-inline` ni `unsafe-eval`, `frame-ancestors 'none'`, HSTS, `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `Permissions-Policy` (caméra, micro, géolocalisation… désactivés), COOP/COEP/CORP. Une balise CSP `<meta>` est aussi injectée au build. |
| Code défensif | Aucun `innerHTML`, `eval`, `new Function` ni script inline (vérifié par les tests). Le DOM est construit avec `textContent` uniquement. |
| Import de presets | JSON limité à 256 Ko. Seules les clés connues sont lues (protection contre la pollution de prototype), les valeurs sont bornées et les identifiants vérifiés contre les listes internes. Rien n'est exécuté. |
| Dépendances | 3 bibliothèques d'exécution (`three`, `fflate`, `@dimforge/rapier3d-compat`), versions **figées** + `package-lock.json`. `.npmrc` : `ignore-scripts=true` (aucun script d'installation tiers exécuté). `npm audit` : 0 vulnérabilité. |
| CI | `.github/workflows/ci.yml` : audit, typage, tests, build et contrôle du bundle, à chaque push. Droits en lecture seule, actions GitHub figées par SHA de commit. `.github/dependabot.yml` : pas de montée de version automatique (versions figées) ; activer « Dependabot security updates » dans *Settings → Code security* pour recevoir les correctifs de sécurité. |
| Fichiers générés | OBJ, MTL et STEP sont du texte pur. Les noms de fichiers sont assainis. Les téléchargements se font en local (Blob), sans réseau. |

## Développement

```bash
npm ci            # installation (scripts d'installation bloqués par .npmrc)
npm run dev       # serveur de développement
npm test          # tests : géométrie, OBJ, STEP relu par OpenCascade, sécurité
npm run build     # typage + build + contrôle de sécurité du bundle
npm run preview   # sert dist/ avec les mêmes en-têtes de sécurité que la production
```

Prérequis : Node.js ≥ 20.

### Architecture

```
src/
  core/                 cœur pur (sans DOM), partagé par l'interface, les workers et les tests
    params.ts           paramètres, bornes, métadonnées d'interface, validation
    rng.ts, noise.ts    aléatoire déterministe et bruits (gradient / valeur)
    geometry/spine.ts   fibre : intégration courbure/torsion, errance, confinement des pelotes, évitement en croissance
    geometry/contact.ts contacts entre portions du copeau : pavés orientés (axes séparateurs), grilles spatiales
    geometry/relax.ts   relaxation finale des auto-intersections (déplacement B-spline lisse et inextensible)
    geometry/chip.ts    section, micro-reliefs, grille structurée, carreaux de Coons, collisions
    geometry/mesh.ts    maillage quad : îlots UV, normales, groupes
    presets/presets.ts  ISO 3685, matières, procédés, raccourcis, variabilité du tas
    export/obj.ts       OBJ/MTL en flux
    export/step.ts      STEP AP214 B-Rep NURBS en flux
  worker/               génération et export hors du thread d'interface
  physics/pile.ts       chute physique (Rapier, chargé à la demande)
  viewer/               Three.js : MatCaps procéduraux, grille, filaire, damier UV
  ui/, app/             interface et orchestration
security/headers.json   politique de sécurité HTTP (source unique)
scripts/check-dist.mjs  contrôle de sécurité du bundle
tests/                  Vitest
```
