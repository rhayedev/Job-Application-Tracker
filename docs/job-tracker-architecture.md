# Job Tracker — Conception architecture hexagonale (double implémentation)

## 0. Stack technique

**Deux implémentations, un seul domaine.** Le projet expose la même logique métier via deux frameworks différents — c'est la meilleure preuve concrète de ce que promet l'architecture hexagonale.

| Domaine                       | Choix                                                                                            | Raison                                                                                                                                                                                                                                                           |
| ----------------------------- | ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Langage                       | TypeScript (partout)                                                                             | Cohérence sur tout le monorepo                                                                                                                                                                                                                                   |
| Monorepo                      | pnpm workspaces                                                                                  | Permet de partager `packages/core` et `packages/infrastructure` entre les deux apps sans dupliquer de code                                                                                                                                                       |
| **App 1 — Framework**         | Next.js (App Router)                                                                             | Décidé en amont du projet                                                                                                                                                                                                                                        |
| **App 1 — UI**                | React                                                                                            | Décidé en amont du projet                                                                                                                                                                                                                                        |
| **App 1 — UI ↔ use cases**    | Server Actions                                                                                   | Plus simple pour un projet solo (cf. section 6)                                                                                                                                                                                                                  |
| **App 2 — Backend**           | NestJS                                                                                           | Refresh de compétence + contraste architectural intéressant (contrôleurs REST comme adapter piloté)                                                                                                                                                              |
| **App 2 — Frontend**          | Angular (dernière version)                                                                       | Refresh de compétence demandé                                                                                                                                                                                                                                    |
| Tests / TDD — domaine et core | Vitest                                                                                           | Rapide, framework-agnostic                                                                                                                                                                                                                                       |
| Tests / TDD — Next.js         | Vitest                                                                                           | Standard actuel de l'écosystème Next.js/Vite                                                                                                                                                                                                                     |
| Tests / TDD — Angular         | Vitest                                                                                           | **Angular a changé son défaut** : depuis Angular 21 (stable en Angular 22, juin 2026), Vitest remplace Karma/Jasmine comme testeur par défaut. Bonne nouvelle : toute ta stack tourne sur le même outil de test, sauf NestJS                                     |
| Tests / TDD — NestJS          | Jest                                                                                             | Reste l'outil idiomatique par défaut de NestJS — pas de raison de forcer Vitest ici, ça ne touche que la glue applicative, pas le domaine partagé                                                                                                                |
| Persistance                   | MongoDB                                                                                          | Modèle document adapté à l'agrégat `Candidature` (cf. section 5), expérience déjà solide dessus, **partagé entre les deux apps**                                                                                                                                 |
| Accès MongoDB                 | Driver natif (`mongodb`), pas d'ODM                                                              | Reste au plus près du hexagonal pur — le mapping domaine ↔ document se fait explicitement dans l'adapter, sans magie de schéma cachée par un ODM                                                                                                                 |
| Node.js                       | 20 LTS minimum recommandé                                                                        | Cohérent avec les exigences actuelles de Next.js/NestJS/Vitest                                                                                                                                                                                                   |
| Composants UI                 | Atomic Design (atoms / molecules / organisms)                                                    | Structure identique sur les deux apps, même si le code des composants n'est pas partageable entre React et Angular                                                                                                                                               |
| Design tokens                 | Package partagé `packages/design-tokens` (JSON/CSS custom properties)                            | Couleurs, espacements, typographie — partagés entre Next.js et Angular. Ce sont des données, pas du code framework-spécifique, donc ça respecte la même logique que `packages/core` : ce qui peut être partagé sans dépendance à un framework l'est              |
| Documentation composants      | Storybook, sur les deux apps                                                                     | Développement isolé des atoms/molecules/organisms, indépendamment des pages ; catalogue visuel réutilisable pour du contenu LinkedIn                                                                                                                             |
| Tests frontend                | Storybook Test (`@storybook/addon-vitest`) — les stories deviennent des tests Vitest exécutables | Une story avec une fonction `play` sert à la fois de documentation visuelle et de test d'interaction — pas de duplication entre Storybook et une suite de tests séparée. Fonctionne pareil sur React et Angular (via `@analogjs/storybook-angular` côté Angular) |
| Accessibilité                 | `@storybook/addon-a11y` (axe-core, WCAG)                                                         | S'intègre nativement à l'addon Vitest déjà choisi — les vérifications a11y tournent dans les mêmes tests que les stories, pas d'outil séparé. Détecte automatiquement ~57% des problèmes WCAG (contraste, rôles ARIA manquants, etc.)                            |
| Documentation frontend        | Storybook Autodocs + MDX                                                                         | Doc générée automatiquement depuis les stories (props, variantes) pour chaque atom/molecule/organism, complétée par des pages MDX pour les guidelines transverses (principes d'accessibilité, règles d'usage du design system)                                   |
| Tests visuels (régression)    | `@chromatic-com/storybook` (Chromatic)                                                           | Détecte les régressions pixel par pixel (couleur, layout) que les tests d'interaction et d'accessibilité ne couvrent pas. Service cloud externe, compte à créer, palier gratuit pour un usage perso                                                              |
| Couverture de code            | Coverage natif de l'addon Vitest (pas `@storybook/addon-coverage`)                               | Puisque le projet utilise déjà l'addon Vitest (section précédente), le coverage est inclus nativement — le paquet `@storybook/addon-coverage` séparé est fait pour l'ancien test-runner Jest+Playwright et serait redondant ici                                  |

**Note sur le driver MongoDB natif** : sans ODM, c'est à l'adapter (`candidature-repository.mongodb.ts`) de faire la conversion explicite entre l'entité `Candidature` du domaine et le document MongoDB stocké. Un peu plus de code à écrire au début, mais aucune fuite d'un concept d'infrastructure vers le domaine — et comme cet adapter est partagé entre Next.js et NestJS, tu ne l'écris qu'une seule fois.

## 1. Contexte métier (bounded context)

Une seule responsabilité claire : suivre des candidatures d'emploi, de la découverte d'une offre jusqu'à l'issue finale (offre reçue, refus, abandon).

Hors scope volontaire pour le MVP : gestion multi-utilisateurs, authentification, notifications automatiques. On les ajoutera une fois le cœur solide.

---

## 2. Domain layer (le cœur, zéro dépendance externe)

### Entité racine : `Candidature`

```ts
type StatutCandidature =
  | "a_contacter"
  | "offre_ouverte"
  | "candidature_envoyee"
  | "relance_envoyee"
  | "entretien_rh"
  | "entretien_technique"
  | "offre_recue"
  | "refuse"
  | "en_pause"
  | "abandonne";

type Candidature = {
  id: CandidatureId; // value object, ex: UUID
  entreprise: NomEntreprise; // value object, non vide
  poste: string;
  statut: StatutCandidature;
  source: "manuelle" | "suggérée"; // provenance - anticipé dès le MVP, coût de migration évité plus tard (cf. Roadmap section 11)
  dateCandidature: Date | null;
  prochaineRelance: Date | null;
  lienOffre: string | null;
  notes: string;
  historique: ChangementStatut[]; // trace des transitions
};

type ChangementStatut = {
  statutPrecedent: StatutCandidature;
  nouveauStatut: StatutCandidature;
  date: Date;
};
```

### Règles métier à encoder dans l'entité (pas dans l'UI ni la base)

- Une candidature ne peut pas passer directement de `a_contacter` à `offre_recue` (transitions valides à définir — cf. tableau ci-dessous)
- `dateCandidature` ne peut pas être dans le futur
- `prochaineRelance` ne peut être définie que si le statut est `candidature_envoyee` ou `relance_envoyee`
- Changer le statut doit toujours ajouter une entrée à `historique`

### Transitions de statut valides (à valider avec toi, c'est un point de règle métier)

```
a_contacter        → offre_ouverte, candidature_envoyee, abandonne
offre_ouverte       → candidature_envoyee, abandonne
candidature_envoyee → relance_envoyee, entretien_rh, refuse, en_pause, abandonne
relance_envoyee     → entretien_rh, refuse, en_pause, abandonne
entretien_rh        → entretien_technique, refuse, en_pause
entretien_technique → offre_recue, refuse, en_pause
en_pause            → (retour à n'importe quel statut précédent)
offre_recue, refuse, abandonne → statuts terminaux, aucune transition
```

C'est le genre de règle qu'il vaut mieux figer avant de coder — dis-moi si cette logique te convient ou si tu veux l'ajuster.

---

## 3. Application layer (use cases — les "ports d'entrée" / driving ports)

Chaque use case = une classe/fonction avec une seule responsabilité, qui orchestre le domaine et appelle les ports de sortie.

```ts
interface CreerCandidatureUseCase {
  executer(commande: CreerCandidatureCommande): Promise<Candidature>;
}

interface ChangerStatutUseCase {
  executer(id: CandidatureId, nouveauStatut: StatutCandidature): Promise<Candidature>;
  // doit rejeter si la transition n'est pas valide (cf. règles ci-dessus)
}

interface ListerCandidaturesUseCase {
  executer(filtre?: FiltreCandidatures): Promise<Candidature[]>;
}

interface PlanifierRelanceUseCase {
  executer(id: CandidatureId, date: Date): Promise<Candidature>;
}

interface SupprimerCandidatureUseCase {
  executer(id: CandidatureId): Promise<void>;
}
```

---

## 4. Ports de sortie (driven ports — interfaces, pas d'implémentation ici)

```ts
interface CandidatureRepository {
  sauvegarder(candidature: Candidature): Promise<void>;
  trouverParId(id: CandidatureId): Promise<Candidature | null>;
  lister(filtre?: FiltreCandidatures): Promise<Candidature[]>;
  supprimer(id: CandidatureId): Promise<void>;
}

interface HorlogeService {
  maintenant(): Date;
  // abstraction indispensable pour tester les règles de dates sans dépendre de Date.now()
}
```

---

## 5. Adapters (infrastructure — à implémenter en dernier, et PARTAGÉS entre les deux apps)

| Port                       | Adapter MVP                              | Partagé ?                                                                           |
| -------------------------- | ---------------------------------------- | ----------------------------------------------------------------------------------- |
| `CandidatureRepository`    | Adapter en mémoire (tests) puis MongoDB  | Oui — vit dans `packages/infrastructure`, utilisé tel quel par Next.js et NestJS    |
| `HorlogeService`           | Implémentation simple `() => new Date()` | Oui — même raisonnement                                                             |
| UI (driving adapter) App 1 | Server Actions Next.js                   | Non — spécifique à l'app Next.js                                                    |
| UI (driving adapter) App 2 | Contrôleurs REST NestJS                  | Non — spécifique à l'app NestJS, consommés ensuite par le frontend Angular via HTTP |

**Choix MongoDB** : l'entité `Candidature` est un agrégat avec un tableau `historique` imbriqué — structure naturellement adaptée au modèle document, sans jointure nécessaire. Ce choix reste un détail d'implémentation derrière le port `CandidatureRepository` : le changer plus tard n'impacterait ni le domaine ni les use cases, dans aucune des deux apps.

L'adapter en mémoire n'est pas un détail : c'est lui qui te permet de tester tous les use cases sans base de données, en TDD, dès le premier jour — et il ne sera écrit qu'une fois pour les deux implémentations.

**Différence de nature entre les deux driving adapters** : les Server Actions Next.js appellent directement un use case en mémoire serveur (même processus). Les contrôleurs NestJS exposent les use cases via HTTP, et c'est Angular qui les consomme comme un vrai client distant. C'est un bon sujet d'article à lui seul : deux façons différentes d'exposer la même application layer.

---

## 6. Structure de dossiers proposée (monorepo)

**Décision UI → use cases App 1 (Next.js) : Server Actions.** Plus simple à mettre en place pour un projet solo, pas de fichier `route.ts` nécessaire. Si un jour tu ouvres une API publique, tu ajouteras des Route Handlers à côté, sans toucher au domaine.

**Décision UI → use cases App 2 (NestJS + Angular) : contrôleurs REST.** Ici pas le choix — Angular est un client séparé, il doit forcément parler HTTP à NestJS.

Deux points de convention Next.js App Router à respecter (vérifiés sur la doc officielle, juin 2026) :

- `app/layout.tsx` est **obligatoire**, pas optionnel — c'est le layout racine, il doit contenir `<html>` et `<body>`
- Les dossiers non-routés à l'intérieur de `app/` (composants co-localisés) doivent être préfixés d'un underscore (`_components`) pour ne pas être interprétés comme des routes

```
job-tracker/
  pnpm-workspace.yaml
  package.json

  packages/
    core/                              # domaine + use cases - ZÉRO dépendance à un framework
      src/
        domain/
          candidature.ts               # entité + règles métier + transitions valides
          candidature.test.ts
          value-objects/
            candidature-id.ts
            nom-entreprise.ts
        application/
          use-cases/
            creer-candidature.ts
            creer-candidature.test.ts
            changer-statut.ts
            changer-statut.test.ts
            lister-candidatures.ts
            planifier-relance.ts
          ports/
            candidature-repository.ts
            horloge-service.ts
      package.json
      vitest.config.ts

    infrastructure/                     # adapters PARTAGÉS - dépend de core, pas des frameworks web
      src/
        repositories/
          candidature-repository.in-memory.ts
          candidature-repository.in-memory.test.ts
          candidature-repository.mongodb.ts   # plus tard
        services/
          horloge-service.impl.ts
      package.json
      vitest.config.ts

    design-tokens/                      # PARTAGÉ - données pures, pas de framework
      src/
        colors.json
        spacing.json
        typography.json
        index.ts                        # export CSS custom properties + objet TS typé
      package.json

  apps/
    web-next/                           # App 1 : Next.js
      .storybook/
        main.ts
        preview.ts
      src/
        components/                     # Atomic Design - transverse, pas lié à une feature
          atoms/
            button/
              button.tsx
              button.stories.tsx
            badge/
              badge.tsx
              badge.stories.tsx
          molecules/
            statut-badge/
              statut-badge.tsx
              statut-badge.stories.tsx
          organisms/
            candidature-card/
              candidature-card.tsx
              candidature-card.stories.tsx
        app/
          layout.tsx                    # obligatoire - layout racine
          page.tsx                      # page d'accueil
          candidatures/
            page.tsx                    # liste des candidatures - assemble les organisms
            actions.ts                  # Server Actions - appellent les use cases de packages/core
            [id]/
              page.tsx                  # détail d'une candidature
      package.json

    api-nest/                           # App 2a : NestJS (backend)
      src/
        candidatures/
          candidatures.controller.ts    # adapter piloté - appelle les use cases de packages/core
          candidatures.controller.spec.ts
          candidatures.module.ts
        main.ts
      package.json

    web-angular/                        # App 2b : Angular (frontend, consomme api-nest)
      .storybook/
        main.ts
        preview.ts
      src/
        app/
          components/                   # Atomic Design - transverse
            atoms/
              button/
                button.component.ts
                button.stories.ts
              badge/
                badge.component.ts
                badge.stories.ts
            molecules/
              statut-badge/
                statut-badge.component.ts
                statut-badge.stories.ts
            organisms/
              candidature-card/
                candidature-card.component.ts
                candidature-card.stories.ts
          candidatures/
            candidatures.component.ts    # assemble les organisms
            candidatures.component.spec.ts
            candidature-detail.component.ts
          services/
            candidatures-api.service.ts  # client HTTP vers api-nest, PAS d'accès direct au domaine
      package.json
```

**Point clé à ne pas rater** : `web-angular` n'importe jamais `packages/core` directement — elle ne connaît que l'API HTTP exposée par `api-nest`. C'est `api-nest` seul qui a le droit d'importer `packages/core` et `packages/infrastructure`, exactement comme `web-next`. Si Angular se met à importer le domaine directement, tu casses la frontière hexagonale et tu perds l'intérêt de la démo.

`packages/design-tokens` fait exception à cette règle de frontière : les deux apps (et même `web-angular`) peuvent l'importer librement, parce que ce sont des données statiques (couleurs, espacements), pas de la logique métier ni un framework. Ça n'entre pas en conflit avec la frontière hexagonale, qui concerne le domaine, pas le design.

---

## 7. Stratégie TDD — ordre d'implémentation

L'ordre compte doublement ici : d'abord pour rester en contrôle, ensuite pour éviter de dupliquer du travail entre les deux apps.

**Phase A — Le cœur partagé, une seule fois (`packages/core` + `packages/infrastructure`)**

1. **Value objects du domaine** (`CandidatureId`, `NomEntreprise`) — tests unitaires purs, aucune dépendance
2. **Entité `Candidature`** — tests des règles métier (transitions valides/invalides, validation des dates) AVANT le code
3. **Ports** — juste les interfaces, pas de test
4. **Adapter en mémoire du repository** — tests d'intégration légers
5. **Use cases un par un**, chacun avec ses tests, en injectant le repository en mémoire et un `HorlogeService` factice
6. **Adapter MongoDB** — une fois que les use cases sont fiables, pour la persistance réelle

À ce stade, `packages/core` et `packages/infrastructure` sont testés et fiables, et n'ont encore jamais vu Next.js, NestJS ou Angular.

**Phase B — Les deux apps, en parallèle ou l'une après l'autre**

7. **App Next.js** : Server Actions qui appellent les use cases, puis UI React par-dessus. Construis les composants dans l'ordre atomic design : atoms d'abord (Button, Badge — chacun avec sa story Storybook dès sa création, pas après), puis molecules (StatutBadge), puis organisms (CandidatureCard), enfin assemblage dans les pages
8. **App NestJS** : contrôleurs REST qui appellent les mêmes use cases, avec leurs propres tests (Jest, cette fois)
9. **App Angular** : composants qui consomment l'API NestJS via HTTP — aucun accès direct à `packages/core`. Même logique atomic design + Storybook que Next.js, en parallèle

**Sur l'ordre atoms → molecules → organisms** : écris la story Storybook en même temps que le composant, pas en différé — la story sert de terrain d'essai isolé avant même de brancher le composant dans une vraie page, un peu comme le test unitaire sert de terrain d'essai avant l'intégration. `packages/design-tokens` doit exister et être stable avant le premier atom, puisque chaque atom s'appuie dessus pour ses couleurs/espacements.

**Stratégie de test frontend, par couche :**

- **Atoms et molecules** — une story avec une fonction `play` (interaction : clic, saisie, assertion sur le rendu) suffit. Pas besoin d'une suite de tests séparée en plus — `@storybook/addon-vitest` exécute la story comme un vrai test Vitest, y compris en CI
- **Organisms** (ex. `CandidatureCard` qui affiche le bon badge selon le statut) — même approche, avec des stories couvrant chaque état métier significatif (un statut par story, ou au moins les statuts terminaux et les cas limites)
- **Ce qui n'est pas un composant visuel** (Server Actions Next.js, service HTTP Angular `candidatures-api.service.ts`) — tests Vitest classiques, avec les use cases ou l'API mockés, comme n'importe quelle fonction. Storybook ne s'applique pas ici, ce n'est pas de l'UI
- **End-to-end (Playwright)** — implémenté dans `apps/web-next` (`playwright.config.ts` + `e2e/`), couvre les parcours principaux de bout en bout : créer une candidature, faire avancer son statut (avec vérification de l'auto-remplissage de la date d'envoi), planifier une relance (date par défaut J+15, modifiable), supprimer une candidature (confirmation puis suppression réelle). Tourne contre une base MongoDB **éphémère et isolée** via `mongodb-memory-server` (pas la base de dev sur `27017`) : un `globalSetup` (`e2e/global-setup.ts`) démarre l'instance en mémoire, lance `next dev` sur le port `3100` avec les variables d'environnement pointées dessus, attend qu'il réponde, puis retourne sa propre fonction de teardown — aucune donnée résiduelle à nettoyer après coup, et aucun conflit avec un `pnpm dev` déjà lancé manuellement sur le port `3000`. Commande : `pnpm --filter @job-tracker/web-next test:e2e`. Volontairement séparé du script `test` (Vitest) — pas dans la boucle rapide du TDD composant/domaine, à lancer à la demande ou en CI comme étape dédiée

**Accessibilité — vérifiée au même niveau que les tests, pas après coup**

Chaque story (atom/molecule/organism) est automatiquement vérifiée par `@storybook/addon-a11y` (axe-core) au moment où elle tourne comme test Vitest — même mécanisme que les tests d'interaction, pas un audit séparé fait à la fin. `parameters.a11y.test = 'error'` est actif **globalement dès le premier composant** (`apps/web-next/.storybook/preview.ts`) plutôt qu'une progression `'todo' → 'error'` composant par composant : une violation d'accessibilité est traitée comme n'importe quel autre test rouge, jamais laissée de côté "pour plus tard".

**Documentation frontend — intégrée à Storybook, pas un document séparé**

Chaque atom/molecule/organism génère sa page de doc automatiquement (Autodocs) à partir de sa story et de ses `argTypes` — props, variantes, exemples. Les guidelines transverses (principes d'accessibilité du projet, règles d'usage du design system, contraintes de la section 12) vivent dans des pages MDX dédiées, consultables au même endroit. Ça évite un doc frontend qui vieillit mal en étant déconnecté du code réel — la doc et le composant sont mis à jour ensemble, dans le même commit.

**Tests visuels — Chromatic, en complément, pas en remplacement**

`npx storybook add @chromatic-com/storybook` ajoute la détection de régression visuelle pixel par pixel : utile pour attraper une dérive de couleur par rapport aux tokens exacts de la section 12, ou un décalage de layout qu'aucun test fonctionnel ne verrait. Nécessite un compte Chromatic (service cloud, palier gratuit suffisant pour un usage perso) — à créer avant la première exécution. Ne remplace ni les tests d'interaction (`addon-vitest`) ni l'accessibilité (`addon-a11y`), ce sont trois couches différentes qui attrapent des classes de bugs différentes.

**Couverture de code — via le coverage natif de Vitest, pas un addon séparé**

Le coverage s'active dans la config Vitest déjà en place (`coverage: { enabled: true, provider: 'v8' }` dans `vitest.config.ts` de chaque package/app, ou l'équivalent dans la config de l'addon Vitest de Storybook) — pas besoin d'installer `@storybook/addon-coverage`, qui cible l'ancien test-runner Jest+Playwright et ferait doublon avec ce qui est déjà natif à l'approche Vitest retenue.

Ne commence jamais la phase B avant que la phase A soit complète et testée. C'est le seul moyen de vraiment vérifier que le domaine est réutilisable tel quel.

À chaque étape : test rouge → code minimal pour passer au vert → refactor si besoin, avant de passer à l'étape suivante.

---

## 8. Comment piloter Claude Code avec ce document (garder le contrôle)

Suggestion de séquence de prompts, un par étape ci-dessus — ne demande jamais "fais tout le projet" d'un coup, et surtout ne demande jamais les deux apps en même temps :

1. _"Voici mon document de conception [colle la section 2]. Crée uniquement le value object CandidatureId avec son test, en TDD : écris d'abord le test, montre-le moi, puis implémente."_
2. _"Maintenant l'entité Candidature avec les règles de transition de statut de la section 2. Teste d'abord les cas invalides (transition interdite) avant les cas valides."_
3. Continue étape par étape en collant la section correspondante à chaque fois, jusqu'à la fin de la Phase A (section 7).
4. Une fois la Phase A terminée et validée : _"packages/core et packages/infrastructure sont testés et complets. Maintenant, dans une session séparée, on attaque uniquement apps/web-next."_ — puis fais de même plus tard pour `api-nest` et `web-angular` dans une nouvelle session dédiée.

Utilise le **Plan Mode** de Claude Code sur les étapes 2, 5, et à chaque démarrage de nouvelle app (les moments les plus riches en décisions) pour valider son plan avant qu'il touche au code.

## 9. Suivi de performance

Deux outils, choisis pour rester proportionnés à un side project tout en produisant des résultats exploitables (y compris pour du contenu LinkedIn) :

### Lighthouse CI — performance web frontend

Mesure les Core Web Vitals (LCP, CLS, INP) automatiquement, sur `apps/web-next` **et** `apps/web-angular`. Intégré en CI (GitHub Actions), il peut faire échouer une pipeline si un budget de performance est dépassé.

```
.github/workflows/
  lighthouse-web-next.yml
  lighthouse-web-angular.yml
```

Intérêt direct : comparaison chiffrée entre un rendu Next.js (Server Components) et un rendu Angular (SSR ou client), sur la même fonctionnalité métier.

### k6 — tests de charge sur les driving adapters

Comme `packages/core` est identique entre les deux apps, un scénario k6 qui appelle "créer une candidature puis changer son statut" via Server Actions vs via l'API REST NestJS isole vraiment la performance de l'adapter, pas de la logique métier. Comparaison équitable, rare à pouvoir faire aussi proprement.

```
tests/
  performance/
    k6-scenario-candidatures.js
    README.md   # comment lancer, comment lire les résultats
```

### Hors scope MVP (à ajouter plus tard si déploiement réel)

Observabilité continue (OpenTelemetry, APM) — pertinente uniquement avec du vrai trafic en production. Pas de valeur ajoutée sur un projet vitrine sans utilisateurs, donc volontairement écartée pour l'instant.

**Où ça s'insère dans la séquence** : après la Phase B (section 7) — une fois les deux apps fonctionnelles, pas avant. Mesurer la performance d'un code qui n'existe pas encore n'a pas de sens.

---

## 10. Sécurité by design (MVP sans authentification)

Pas d'auth pour le MVP ne veut pas dire pas de sécurité. Voici ce qui s'applique dès la Phase A, sans complexité inutile.

### Validation en profondeur (defense in depth)

Deux couches, pas une seule :

1. **Domaine** — les value objects (`NomEntreprise`, etc.) rejettent déjà les valeurs invalides à la construction. À étendre avec des limites de longueur et un refus des caractères de contrôle, pas seulement "non vide"
2. **Adapters d'entrée** — les Server Actions (Next.js) et les DTOs NestJS (avec `class-validator`) valident la forme des données **avant** qu'elles atteignent le domaine. Le domaine ne doit jamais faire confiance à ce qui vient de l'extérieur, même si l'adapter a déjà validé — la validation domaine reste la dernière ligne de défense.

Ces deux couches se testent en TDD comme le reste : cas invalides d'abord (chaîne vide, trop longue, caractères suspects), cas valides ensuite.

### Prévention des injections NoSQL

Le driver MongoDB natif (décision de la section 0) aide déjà, à condition de respecter une règle stricte : **jamais de valeur utilisateur non typée directement dans un objet de requête**. Concrètement :

- Ne jamais faire `collection.find(req.body)` ou équivalent — construire les filtres explicitement, champ par champ, avec des types connus
- Aucune valeur ne doit pouvoir devenir un opérateur MongoDB (`$where`, `$ne`, etc.) — ce risque existe si un objet JSON brut venant du client est utilisé tel quel comme filtre de requête
- Les DTOs NestJS et les Server Actions Next.js, en validant la _forme_ des données (string attendu, pas objet), bloquent déjà une bonne partie de cette classe d'attaque

### Secrets et configuration

- `.env` jamais committé (`.gitignore` dès le premier commit du monorepo), un `.env.example` documenté à la place
- URL de connexion MongoDB, jamais en dur dans le code, y compris dans `packages/infrastructure`
- Valider les variables d'environnement au démarrage de chaque app (échec rapide et explicite si une variable requise manque, plutôt qu'un plantage silencieux plus tard)

### En-têtes de sécurité HTTP

- **NestJS** : middleware `helmet` — quelques lignes, protège contre plusieurs classes d'attaques par défaut (X-Frame-Options, X-Content-Type-Options, etc.)
- **Next.js** : en-têtes de sécurité configurables dans `next.config.ts` (CSP, HSTS) — Next.js expose une API dédiée pour ça

### CORS strict entre Angular et NestJS

Le frontend Angular consomme l'API NestJS via HTTP (décision de la section 6) — la configuration CORS de NestJS doit lister explicitement l'origine autorisée (l'URL de `web-angular`), jamais un wildcard `*`, même en développement si évitable.

### Limitation de débit (rate limiting)

Même sans authentification, une API ouverte sans limite est un vecteur d'abus (spam de création de candidatures, déni de service basique). NestJS propose un module de throttling prêt à l'emploi (`@nestjs/throttler`) — quelques lignes suffisent pour un MVP.

### Dépendances

- Lockfile (`pnpm-lock.yaml`) toujours committé — reproductibilité et surface d'attaque connue
- `pnpm audit` de temps en temps, ou Dependabot/Renovate activé sur le repo si tu le mets sur GitHub

### Logging prudent

Ne jamais logger le contenu brut du champ `notes` d'une candidature (il peut contenir des informations personnelles sur ta recherche) ni la chaîne de connexion MongoDB complète. Logger les identifiants (`CandidatureId`) et les événements, pas le contenu métier sensible.

### Ce qu'on ne fait volontairement pas maintenant

Pas d'authentification, pas de gestion de rôles — hors scope MVP (décidé en section 1). Le point d'extension existe déjà naturellement : le jour où l'auth arrive, elle s'ajoute comme un nouveau port/adapter (ex. un `AuthGuard` NestJS, un middleware Next.js), sans toucher au domaine. Pas besoin de préparer un champ `userId` dès maintenant "au cas où" — ce serait de la spéculation, pas du secure by design.

---

**Conseil supplémentaire pour ce monorepo** : garde un `CLAUDE.md` à la racine qui rappelle la règle du point clé de la section 6 (Angular n'importe jamais `packages/core` directement) — c'est le genre de règle qu'il vaut mieux répéter explicitement à chaque session plutôt que d'espérer que Claude Code la déduise seul.

---

## 13. CI/CD — GitHub Actions

### Architecture générale

Deux workflows séparés, avec des runners différents et des déclencheurs différents — c'est la décision de sécurité la plus importante de cette section.

| Workflow     | Déclencheur                                           | Runner                          | Rôle                                                             |
| ------------ | ----------------------------------------------------- | ------------------------------- | ---------------------------------------------------------------- |
| `ci.yml`     | `push` (toutes branches) + `pull_request` vers `main` | GitHub-hosted (`ubuntu-latest`) | Lint, format, typecheck, tests, audit, build                     |
| `deploy.yml` | `push` sur `main` (prod) ou `develop` (dev)           | **Self-hosted** (home server)   | Build des images Docker et déploiement, un job par environnement |

**Règle de sécurité non négociable** : le runner self-hosted ne se déclenche jamais sur `pull_request`. Un repo public avec un runner self-hosted exposé aux PR permettrait à n'importe qui d'exécuter du code sur le réseau domestique via une PR malveillante. Le déploiement se déclenche uniquement après un `push` direct sur `main` ou `develop` — donc après qu'une PR a déjà été relue et mergée.

**Toute contribution passe par une PR** : `main` est protégée côté GitHub (PR obligatoire, `ci.yml` doit être vert avant de merger, push direct bloqué). Pas d'exigence de review approuvée — le repo est solo.

### Deux environnements : dev et prod

|          | Branche   | Domaine web-next                             | Domaine api-nest                            | Domaine web-angular                        | Base MongoDB                                   |
| -------- | --------- | -------------------------------------------- | ------------------------------------------- | ------------------------------------------ | ---------------------------------------------- |
| **Prod** | `main`    | `next-job-app-tracker.romainh-craft.com`     | `api-job-app-tracker.romainh-craft.com`     | `ng-job-app-tracker.romainh-craft.com`     | conteneur `mongo-prod`, réseau `prod-internal` |
| **Dev**  | `develop` | `dev.next-job-app-tracker.romainh-craft.com` | `dev.api-job-app-tracker.romainh-craft.com` | `dev.ng-job-app-tracker.romainh-craft.com` | conteneur `mongo-dev`, réseau `dev-internal`   |

Les deux environnements tournent sur le **même home server**, isolés l'un de l'autre par des réseaux Docker internes distincts (`prod-internal` / `dev-internal`) — la base de dev ne peut pas atteindre la base de prod et inversement. Un unique réseau `edge` (partagé) relie Caddy à tous les conteneurs d'apps des deux environnements pour le reverse proxy.

`web-angular` n'a pas encore de code applicatif (`apps/web-angular/src` est vide) — ses services Docker Compose et ses blocs Caddy existent déjà mais sont **commentés**, à activer quand l'app démarrera en Phase B.

### CI (`ci.yml`) — sur GitHub-hosted runners

1. Checkout + setup pnpm avec cache
2. `pnpm install --frozen-lockfile`
3. Lint : `pnpm lint` (ESLint)
4. Format : `pnpm format:check` (Prettier, échoue si non formaté)
5. Typecheck : `pnpm typecheck` (`pnpm -r --if-present run typecheck`, `tsc --noEmit` par package)
6. Tests : `pnpm test`
7. Audit sécurité : `pnpm audit --audit-level=high` (cf. section 10)
8. Build : `pnpm build` (`pnpm -r --if-present run build`)

### CD (`deploy.yml`) — sur le runner self-hosted

Deux jobs, chacun gated par un [Environment GitHub](https://docs.github.com/actions/deployment/targeting-different-environments/using-environments-for-deployment) qui porte ses propres secrets :

- **`deploy-prod`** (`if: github.ref == 'refs/heads/main'`, `environment: production`) : `docker compose -f docker-compose.edge.yml -f docker-compose.prod.yml up -d --build` — démarre/maintient à jour Caddy + le DDNS Cloudflare (infra partagée) **et** la stack prod.
- **`deploy-dev`** (`if: github.ref == 'refs/heads/develop'`, `environment: development`) : `docker compose -f docker-compose.dev.yml up -d --build` — ne touche que la stack dev, suppose que le réseau `edge` existe déjà (créé par `deploy-prod`).

**Piège de séquencement** : au tout premier déploiement, il faut pousser sur `main` avant `develop` (ou démarrer `docker-compose.edge.yml` manuellement sur le serveur), sinon `deploy-dev` échoue faute de réseau `edge`.

Pas de registre d'images (ghcr.io) : le runner tourne déjà sur la machine cible, construire et déployer sont la même étape.

**Purge du build cache** : chaque `--build` accumule des layers Docker (BuildKit) sans jamais les libérer tout seul. Sur une VM à disque contraint (ex. 20G), ça finit par épuiser l'espace disque et faire échouer le build en plein milieu (`ENOSPC`), avec un runner qui plante sans log exploitable. Chaque job `deploy-*` termine donc par une étape `docker builder prune -f --filter "until=24h"` + `docker image prune -f --filter "until=24h"` (avec `if: always()`, pour purger même si le déploiement a échoué). Le seuil de 24h a été resserré depuis 72h car la marge disque réelle sur `job-tracker-dev` (VM à 20G) s'est révélée trop faible avec un seuil plus large.

### Secrets par Environment GitHub

| Secret                                        | `production`                               | `development`                 | Consommé par                                              |
| --------------------------------------------- | ------------------------------------------ | ----------------------------- | --------------------------------------------------------- |
| `MONGO_ROOT_USERNAME` / `MONGO_ROOT_PASSWORD` | ✅ (valeurs prod)                          | ✅ (valeurs dev, différentes) | `mongo-prod` / `mongo-dev`, construction de `MONGODB_URI` |
| `MONGODB_DB_NAME`                             | ✅                                         | ✅                            | `api-nest-*`, `web-next-*`                                |
| `WEB_ANGULAR_ORIGIN`                          | ✅                                         | ✅                            | CORS `api-nest-*`                                         |
| `CLOUDFLARE_API_TOKEN`                        | ✅ (scope Zone.DNS Edit)                   | —                             | conteneur `cloudflare-ddns`                               |
| `CLOUDFLARE_DOMAINS`                          | ✅ (liste les 6 sous-domaines, prod + dev) | —                             | conteneur `cloudflare-ddns`                               |

Le DDNS est un unique conteneur partagé (déployé avec l'Environment `production`), pas besoin de le dupliquer par environnement.

### Installer le runner self-hosted

Dans GitHub : **Settings → Actions → Runners → New self-hosted runner**, suivre les instructions pour ton OS. Le runner s'installe comme un service qui interroge GitHub en continu (sortant uniquement — aucun port entrant à ouvrir pour ça).

**Label obligatoire par environnement** : `deploy-prod` cible `runs-on: [self-hosted, prod]` et `deploy-dev` cible `runs-on: [self-hosted, dev]`. Enregistrer chaque runner avec le label correspondant (`--labels self-hosted,dev` pour le runner de la VM dev, `--labels self-hosted,prod` pour celui de la VM prod). Sans cette distinction, `runs-on: self-hosted` seul matche n'importe quel runner du repo — un runner dev peut alors hériter d'un job `deploy-prod` en attente et déployer la stack prod (Caddy, DDNS Cloudflare) sur la mauvaise machine.

### DNS : domaine chez amen.fr, gestion déléguée à Cloudflare

Le domaine `romainh-craft.com` reste **enregistré chez amen.fr** — seule la gestion DNS est déléguée à **Cloudflare (plan Free, gratuit)** en changeant les serveurs de noms côté amen.fr. Les 6 sous-domaines restent en mode **"DNS only"** (non proxifiés) pour ne pas interférer avec le renouvellement automatique Let's Encrypt de Caddy (le mode proxifié intercepterait le challenge HTTP-01). Le conteneur `cloudflare-ddns` (image `favonia/cloudflare-ddns`, maintenue) garde les 6 enregistrements A à jour automatiquement, vu que l'IP publique du home server n'est probablement pas fixe.

### Architecture réseau du home server

```
Internet
   │
   ▼
Routeur (port forward 443 + 80 → Caddy uniquement)
   │
   ▼
Caddy (reverse proxy, TLS automatique via Let's Encrypt, réseau `edge`)
   │
   ├──► web-next-prod / api-nest-prod   (réseaux edge + prod-internal)
   ├──► web-next-dev  / api-nest-dev    (réseaux edge + dev-internal)
   ├──► mongo-prod   (réseau prod-internal uniquement, jamais sur edge)
   └──► mongo-dev    (réseau dev-internal uniquement, jamais sur edge)
```

**Règles de sécurité pour l'exposition publique (prolongement direct de la section 10) :**

- Seuls les ports 443 (HTTPS) et 80 (challenge ACME HTTP-01) sont redirigés sur le routeur — vers Caddy, rien d'autre
- MongoDB (prod et dev) reste sur son réseau Docker interne respectif, jamais accessible depuis l'extérieur ni depuis l'autre environnement
- Caddy gère la terminaison TLS automatiquement (certificat Let's Encrypt, renouvellement automatique)

### Ce qui reste à faire de ton côté avant que `deploy.yml` fonctionne

- Créer la zone Cloudflare pour `romainh-craft.com` et basculer les serveurs de noms côté amen.fr
- Créer un token API Cloudflare (scope Zone.DNS Edit) pour le secret `CLOUDFLARE_API_TOKEN`
- Installer Docker + Docker Compose sur le home server
- Installer et enregistrer le runner self-hosted GitHub
- Rediriger les ports 443 et 80 sur le routeur vers le home server
- Le `Dockerfile` de `web-angular` (à écrire en Phase B, une fois le code de l'app réel — pas avant)

### Hors scope pour l'instant

Path-filtering / exécution sélective par package (ex. Turborepo avec cache distant) — prématuré à 5 packages, à reconsidérer si le monorepo grossit significativement et que la CI devient lente. Lighthouse CI et k6 (section 9) s'ajoutent après la Phase B, pas dans cette première mise en place.

### Étape ultérieure — migration vers MicroK8s

Décidé mais volontairement **séquencé après** un premier déploiement fonctionnel via Docker Compose, pour deux raisons : obtenir quelque chose qui marche rapidement plutôt que de risquer de bloquer sur la complexité K8s dès le départ, et transformer la migration elle-même en exercice d'apprentissage délibéré et documenté (bon sujet d'article : "de Docker Compose à Kubernetes sur mon home server — ce qui a changé et pourquoi"). Motivation : Kubernetes est une compétence fréquemment demandée pour des postes seniors, et ça recoupe directement la formation Systèmes/Réseaux/Cybersécurité en cours.

**Ce qui migre vers MicroK8s** : `web-next`, `api-nest`, `web-angular` — trois apps stateless, terrain idéal pour apprendre Deployments, Services, Ingress, rolling updates et scaling sans risque sur des données réelles.

**Ce qui reste hors du cluster (décision prise maintenant)** : MongoDB reste en simple conteneur Docker, à côté du cluster, pas en StatefulSet. Sur un MicroK8s mono-nœud, un volume persistant K8s n'est jamais qu'un `hostPath` sur le même disque physique — la complexité d'un StatefulSet n'apporte pas encore le vrai bénéfice (réplication, haute disponibilité multi-nœud) qui la justifierait. Faire tourner des données réelles (ton propre suivi de candidatures) dans un cluster encore en cours d'apprentissage serait un risque évitable. Le passage de MongoDB en StatefulSet devient un exercice à part entière, plus tard, idéalement avec des données de test.

**Ce que ça change dans l'architecture réseau** : l'Ingress Controller de MicroK8s (addon `ingress`, basé sur nginx) remplace le rôle de Caddy pour le routage vers les apps ; `cert-manager` (addon MicroK8s) reprend la gestion automatique des certificats Let's Encrypt à la place de la gestion native de Caddy. MongoDB, en dehors du cluster, continue d'être joint depuis `api-nest` via le réseau Docker/hôte, jamais exposé publiquement — la règle de la section 10 ne change pas.

**Pas de Helm ni de GitOps (ArgoCD/Flux) pour cette première migration** — des manifests YAML simples (Deployment/Service/Ingress par app) suffisent pour apprendre les concepts de base. Package manager K8s et déploiement continu déclaratif sont de bons candidats pour une itération suivante, une fois le cluster manuel maîtrisé.

---

## 11. Roadmap — Vision v2 (explicitement hors scope du MVP)

**Idée** : agrégation automatique d'offres depuis des plateformes sélectionnées par l'utilisateur, upload de CV, description des ambitions (poste, prétentions salariales, secteurs), suggestion automatique d'offres correspondantes, complétion voire candidature automatique, le tout propulsé par IA.

**Pourquoi c'est noté ici et pas construit maintenant :**

- Complexité d'un ordre de grandeur supérieur au MVP (intégrations multi-plateformes, parsing CV, matching IA, remplissage de formulaires tiers)
- Risque concret : la plupart des plateformes emploi interdisent l'automatisation de candidatures dans leurs CGU — un compte personnel utilisé pour ça s'expose à un bannissement, au pire moment possible pendant une recherche d'emploi active
- Coût d'opportunité : le temps disponible (déjà partagé entre recherche d'emploi, formation, OpenTiko) vaut mieux investi dans un MVP livré et solide que dans un projet ambitieux qui traîne inachevé

**Pourquoi ce n'est pas bloquant pour le MVP :** l'architecture hexagonale absorbe cette extension sans réécriture — ce sont de nouveaux use cases (`SuggererOffresUseCase`, `AnalyserCvUseCase`) et de nouveaux ports (`JobBoardGateway`, `CvParserService`, `AiMatchingService`) implémentés par de nouveaux adapters, sans toucher à `packages/core` existant.

**Seule décision prise dès maintenant pour faciliter la transition future** : le champ `source` sur l'entité `Candidature` (section 2), pour distinguer une candidature créée manuellement d'une suggérée automatiquement — cheap à faire maintenant, coûteux à migrer plus tard.

**Ce qui reste volontairement non spécifié** : la forme exacte des ports `JobBoardGateway`/`CvParserService`/`AiMatchingService`. Les écrire maintenant sans adapter concret pour les valider serait deviner une interface dans le vide — à faire au moment où un premier agrégateur réel sera intégré, pas avant.

---

## 12. Design System — référence (Claude Design)

Un design system complet a été produit dans Claude Design ("JobTracker — Design System"), suivant exactement la nomenclature atomic design déjà décidée. **Ce document fait référence, ce n'est pas une redéfinition** — les valeurs exactes des tokens (couleurs OKLCH précises) doivent être copiées directement depuis Claude Design ou son export, pas retranscrites depuis une capture d'écran.

### 01 — Fondations / Tokens

**Valeurs vérifiées depuis le code source HTML (fiables, pas une transcription d'image).**

**Couleurs neutres**

| Token              | Valeur OKLCH                  | Usage                                |
| ------------------ | ----------------------------- | ------------------------------------ |
| Surface            | `oklch(99% .002 250)`         | Fond des cartes, inputs, header      |
| Fond de page       | `oklch(97.5% .003 250)`       | Arrière-plan général                 |
| Bordure            | `oklch(90% .004 250)`         | Bordures standard                    |
| Bordure input      | `oklch(88% .005 250)`         | Bordures de champs de formulaire     |
| Texte primaire     | `oklch(22% .01 250)`          | Texte principal                      |
| Texte secondaire   | `oklch(48% .01 250)`          | Labels, texte atténué                |
| Texte label        | `oklch(38% .01 250)`          | Labels de formulaire                 |
| Texte caption/meta | `oklch(55–58% .01 250)`       | Dates, méta-infos                    |
| Texte désactivé    | `oklch(68% .006 250)`         | Champs/boutons disabled              |
| Fond désactivé     | `oklch(93–95% .003–.004 250)` | Champs/boutons disabled, hover       |
| Accent             | `oklch(52% .17 262)`          | Boutons primaires, liens, focus ring |
| Accent hover       | `oklch(46% .17 262)`          | État hover de l'accent               |

**Couleurs de statut** — chaque statut a 4 variantes (texte / fond / bordure / pastille), et la clé correspond exactement à `StatutCandidature` (section 2) :

| Statut (clé domaine)  | Texte                 | Fond                  | Pastille              |
| --------------------- | --------------------- | --------------------- | --------------------- |
| `a_contacter`         | `oklch(35% .01 250)`  | `oklch(95% .005 250)` | `oklch(55% .01 250)`  |
| `offre_ouverte`       | `oklch(38% .08 235)`  | `oklch(94% .025 235)` | `oklch(55% .09 235)`  |
| `candidature_envoyee` | `oklch(38% .14 255)`  | `oklch(93% .035 255)` | `oklch(55% .16 255)`  |
| `relance_envoyee`     | `oklch(38% .11 210)`  | `oklch(93% .035 210)` | `oklch(58% .13 210)`  |
| `entretien_rh`        | `oklch(38% .14 300)`  | `oklch(93% .035 300)` | `oklch(55% .16 300)`  |
| `entretien_technique` | `oklch(38% .15 325)`  | `oklch(93% .035 325)` | `oklch(55% .17 325)`  |
| `offre_recue`         | `oklch(38% .12 145)`  | `oklch(93% .045 145)` | `oklch(55% .14 145)`  |
| `refuse`              | `oklch(40% .15 25)`   | `oklch(93% .04 25)`   | `oklch(55% .17 25)`   |
| `en_pause`            | `oklch(40% .12 80)`   | `oklch(93% .05 80)`   | `oklch(60% .14 80)`   |
| `abandonne`           | `oklch(30% .005 250)` | `oklch(92% .005 250)` | `oklch(45% .005 250)` |

Chaque statut a aussi une valeur de bordure (visible dans le HTML source, légèrement plus saturée que le fond) — à reprendre telle quelle depuis le fichier `.html` fourni plutôt que retranscrite ici pour éviter toute erreur de recopie.

**Typographie** — police Inter (texte), JetBrains Mono (valeurs de tokens, labels techniques) :

| Niveau  | Poids | Taille (échelle atome)                 |
| ------- | ----- | -------------------------------------- |
| H1      | 800   | 38px (52px en cover/hero)              |
| H2      | 700   | 26px                                   |
| H3      | 600   | 18px                                   |
| Body    | 400   | 15px                                   |
| Caption | 500   | 12px, uppercase, letter-spacing 0.04em |

**Rayons et hauteurs** — boutons : 40px (standard) / 32px (petit) / 36px (icône), border-radius 8px (7px pour le petit bouton) ; inputs : 42px de hauteur, border-radius 8px ; cartes : border-radius 10–16px ; badges/chips : border-radius 100px (pilule).

**Boutons — mapping des variantes** : primaire = fond Accent + texte blanc ; secondaire = bordure + fond Surface ; tertiaire ("Ignorer") = transparent, texte secondaire ; destructif ("Supprimer") = réutilise la teinte 25 (même famille que le statut `refuse`) ; désactivé = fond/texte désactivés définis ci-dessus.

**Fichier source de référence** : `Job_Tracker_Design_System__standalone_.html` — c'est le fichier à donner tel quel à Claude Code en référence pour extraire `packages/design-tokens`, plutôt que de recopier les valeurs de ce document (risque de coquille de recopie manuelle, même minime).

### 02 — Atoms

- **Boutons** : primaire, secondaire, tertiaire ("Ignorer"), destructif ("Supprimer", rouge), petit bouton, icon buttons
- **Badge de statut** — un par valeur de `StatutCandidature`, couleur dédiée par statut
- **Champs** — input texte, champ désactivé, textarea (notes)
- **Chip/Tag** — avec bouton de suppression (ex. "Remote ×", "TypeScript ×")
- **Avatar entreprise** — initiales sur fond coloré

### 03 — Molecules

- **Champ de formulaire** (label + input + texte d'aide)
- **Barre de recherche & filtres** (recherche + filtre statut + filtre relance + tri)
- **Carte candidature** (avatar + titre + sous-titre + indicateur de statut)
- **Cartes statistiques** (métriques : candidatures actives, entretiens à venir, taux de réponse)
- **État vide** (message + CTA)

### 04 — Organisms

- **Header/Navigation** (logo, onglets Tableau de bord / Candidatures / Statistiques, CTA, avatar utilisateur)
- **Kanban — pipeline de candidatures** (une colonne par statut, compteur, cartes, bouton "+ Ajouter" par colonne)
- **Panneau détail candidature** (header + méta-données + notes + historique en timeline + formulaire d'édition)

### 05 — Templates (écrans complets)

- Tableau de bord (vue Kanban + cartes stats + barre de recherche)
- Détail d'une candidature
- Nouvelle candidature (formulaire)

### Consigne pour Claude Code

Chaque atom/molecule/organism de ce catalogue doit être implémenté avec sa story Storybook dès sa création (cohérent avec la section 9 — Storybook Test), en respectant exactement cette nomenclature et cette hiérarchie — pas de composant inventé hors de ce catalogue sans validation explicite au préalable. Les valeurs de tokens doivent être importées depuis `packages/design-tokens`, jamais codées en dur dans un composant.
