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

### Factur-X (fait)
Chaque facture directe émise et chaque avoir se téléchargent en **Factur-X** (bouton *Factur-X* de la fiche facture,
`GET /api/invoices/:id/facturx.pdf`, XML seul : `…/facturx.xml`) :

| Élément | Choix |
|---|---|
| Conteneur | PDF/A-3b : polices DejaVu incorporées, profil sRGB (OutputIntent), XMP `pdfaid` + schéma d'extension Factur-X |
| Données | `factur-x.xml`, CII D16B, profil **EN 16931** (`urn:cen.eu:en16931:2017`), fichier associé `/AFRelationship /Data` (convention française) |
| Cadre de facturation (BT-23) | `S1` — prestations de services |
| Franchise en base | catégorie **E**, code **VATEX-FR-FRANCHISE**, motif « TVA non applicable, art. 293 B du CGI » ; sans n° de TVA, le SIREN est déclaré en identifiant fiscal du vendeur (BT-32, `FC`) pour satisfaire la règle BR-E-02 |
| Identifiants | SIREN (`0002`) vendeur et acheteur, SIRET vendeur (`0009`), n° de TVA (`VA`) s'ils existent |
| Avoir | type `381`, montants positifs, référence à la facture annulée (BT-25/26) |
| Mentions | pénalités (`PMD`), indemnité de 40 € (`PMT`), escompte (`AAB`), date de réalisation (BT-72), période (BT-73/74), IBAN (moyen `58`) |
| Contenu | la facture **telle qu'émise** (coordonnées figées), sans les encaissements ultérieurs ; sortie déterministe |

**Validation** : `npm run facturx:validate --workspace=@atelier-mission/backend` (et un job de la CI) passe des factures
d'exemple — franchise, assujetti multi-taux sur trois pages, avoir, et une facture + son avoir produits par l'API —
dans **Mustang 2.22** (validateur de référence open source : XSD Factur-X, schématron EN 16931, PDF/A-3b par veraPDF).
Résultat : 0 erreur, 0 avertissement.

### Reste à faire avant septembre 2027
1. transmission via la **plateforme agréée** choisie (API) et suivi des statuts du cycle de vie ;
2. **e-reporting** des encaissements de prestations de services ;
3. surveiller les règles françaises complémentaires (profils `EXTENDED-CTC-FR`, adresse électronique de facturation
   des parties) au fur et à mesure de leur publication.
