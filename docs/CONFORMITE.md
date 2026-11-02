# Conformité de la facturation

> Atelier Mission aide à respecter les règles courantes de facturation entre professionnels en France.
> Ce n'est pas un logiciel certifié ni un conseil juridique ou comptable : faites valider vos modèles par votre expert-comptable.

## Ce que l'application applique
| Règle | Mise en œuvre |
|---|---|
| Numérotation unique, chronologique, sans trou | `F-AAAA-NNNN` attribué **à l'émission** dans la transaction (table `counters`) ; date d'émission antérieure à la dernière facture refusée ; un brouillon supprimé ne consomme pas de numéro |
| Facture émise non modifiable | lignes, client et montants verrouillés (409) ; correction par **avoir** numéroté `A-AAAA-NNNN` qui reprend les lignes en négatif |
| Identité du vendeur et du client au jour de l'émission | coordonnées **figées** sur la facture (`seller_snapshot`, `client_snapshot`) |
| Mentions du vendeur | nom (avec « EI » pour un entrepreneur individuel), adresse, SIREN/SIRET, n° de TVA s'il existe — émission refusée sans nom, SIREN/SIRET et adresse |
| Mentions du client | nom, adresse (obligatoire pour émettre), SIREN et n° de TVA s'ils sont connus |
| Dates | date d'émission, période de la prestation, échéance |
| Lignes | désignation, quantité, unité, prix unitaire HT, taux de TVA, total HT ; TVA calculée par taux |
| Franchise en base | « TVA non applicable, art. 293 B du CGI » |
| Retard de paiement | taux des pénalités (texte réglable, au moins 3 fois le taux d'intérêt légal) et **indemnité forfaitaire de 40 €** (art. L441-10 du Code de commerce) |
| Escompte | « Pas d'escompte pour paiement anticipé » |
| Catégorie de l'opération | « Prestation de services » (mention de la réforme de la facturation électronique) |

## Missions Malt
Malt émet la facture au nom du freelance (mandat de facturation) et l'envoie au client ; il prélève ses frais de
service, TVA de 20 % en sus. Dans Atelier Mission, une facture Malt n'a donc **pas de numéro légal propre** (on saisit le
numéro Malt) et son impression est un « récapitulatif de mission » interne, pas une facture.

## Facturation électronique (réforme 2026-2027)
Calendrier en vigueur au moment de l'écriture :
- **1er septembre 2026** : toutes les entreprises, micro-entreprises comprises (même en franchise de TVA), doivent pouvoir
  **recevoir** des factures électroniques ; grandes entreprises et ETI les **émettent**.
- **1er septembre 2027** : **émission** et e-reporting pour les PME, TPE et micro-entreprises.

Les factures PDF d'Atelier Mission ne sont pas des factures électroniques au sens de la réforme (format structuré
Factur-X / UBL / CII transmis par une plateforme agréée). Feuille de route avant septembre 2027 :
1. export **Factur-X** (PDF/A-3 + XML CII) des factures émises ;
2. transmission via la **plateforme agréée** choisie (API) et suivi des statuts du cycle de vie ;
3. e-reporting des encaissements de prestations de services.

Les données nécessaires sont déjà là (SIREN du client, catégorie de l'opération, coordonnées figées, montants par taux).
