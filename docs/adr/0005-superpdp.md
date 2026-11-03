# ADR 0005 — Plateforme agréée : SUPER PDP par son API

**Statut** : accepté · **Date** : 2026-11-03

## Contexte
Au 1er septembre 2027, les micro-entreprises doivent émettre leurs factures B2B par une plateforme agréée et transmettre
les données de paiement de leurs prestations de services. Atelier Mission produit déjà un Factur-X valide (ADR 0004).
Il faut une plateforme qui accepte un dépôt par API, à un coût compatible avec un freelance.

## Décision
- **SUPER PDP**, choisie par l'utilisateur : plateforme agréée, API REST ouverte (OpenAPI, bac à sable), compte gratuit
  jusqu'à 1 000 factures par mois et API facturée à l'unité. Les plateformes gratuites tout-en-un (Tiime, Indy, Abby…)
  n'exposent pas d'API publique de dépôt ; l'API de Pennylane est réservée à ses paliers payants.
- On dépose **notre** Factur-X (pas de conversion par la plateforme) : le document que voit le client est celui de l'app.
- **Second flux sortant**, sous la règle de l'ADR 0003 : mode En ligne obligatoire, identifiants dans `.env` seulement,
  la fenêtre « Passer en ligne » dit ce qui part chez SUPER PDP.
- Robustesse avant tout : dépôt unique (`external_id`, état `UNKNOWN` et recherche avant redépôt), statuts par curseur
  persistant, déclaration d'encaissement unique, automatismes qui ne bloquent jamais l'action de l'utilisateur.

## Conséquences et limites
- Développé contre le contrat publié, **sans appel réel** à la plateforme (réseau inaccessible depuis l'environnement de
  développement) : première mise en service à faire dans le **bac à sable** SUPER PDP.
- L'API est en `v1.beta` : un changement de forme est possible ; tout est isolé dans `integrations/superpdp.ts`.
- Changer de plateforme = nouveau client dans `integrations/` derrière la même interface de service.
