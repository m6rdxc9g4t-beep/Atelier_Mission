# ADR 0001 — Backend : Fastify + Drizzle + SQLite (better-sqlite3)

**Statut** : accepté · **Date** : 2026-11-03

## Contexte
Les apps de la suite sont locales. Atelier Projets utilise Fastify + Prisma 7 (SQLite). Mission manipule de l'argent :
numérotation légale sans trou, encaissements, avoirs — tout doit être atomique.

## Décision
- **Fastify 5 + TypeBox** comme Projets (validation stricte, mêmes gardes `local-only`).
- **Drizzle ORM + better-sqlite3** plutôt que Prisma :
  - transactions **synchrones** : numéro de facture, statut, relances et événement sont écrits dans la même transaction
    sans `await` intermédiaire, donc sans entrelacement possible ;
  - migrations SQL générées par `drizzle-kit` sans binaire de moteur à télécharger (installation hors ligne, CI simple) ;
  - les migrations sont appliquées à l'ouverture de la base (`openDatabase`), y compris en mémoire pour les tests.

## Conséquences
- Les tests construisent l'app sur une base `:memory:` en quelques millisecondes (56 tests en ~1 s).
- Un changement de schéma = `npm run db:generate` ; la CI vérifie qu'aucune migration ne manque.
