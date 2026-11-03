# ADR 0003 — Brevo, seul flux sortant, derrière le mode « En ligne »

**Statut** : accepté, étendu par l'ADR 0005 (SUPER PDP, second flux sortant sous la même règle) · **Date** : 2026-11-03

## Contexte
Principe de la suite : local d'abord, hors ligne par défaut (`docs/SUITE.md` §5.1 d'Atelier Projets). Les relances
doivent pourtant partir par e-mail, ce qui envoie des données (client, montant) à un tiers.

## Décision
- Un interrupteur **Hors ligne / En ligne** dans la barre latérale, hors ligne par défaut, changeable uniquement par
  `PUT /api/settings/online-mode` (garde `local-only`, jamais par `PATCH /settings` ni par le nœud Atelier).
- Passer en ligne affiche **exactement** ce qui partira chez Brevo.
- Clé `BREVO_API_KEY` dans `backend/.env` uniquement : jamais en base, jamais dans une réponse.
- Envoi manuel par défaut ; envoi automatique optionnel (planificateur), toujours soumis au mode en ligne.
- Projets et Trésorerie restent joints en bouclage dans les deux modes.
