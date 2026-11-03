# ADR 0004 — Factur-X généré par l'application, validé par Mustang

**Statut** : accepté · **Date** : 2026-11-03

## Contexte
Les micro-entreprises devront **émettre** des factures électroniques au 1er septembre 2027. Factur-X (PDF/A-3 + XML CII)
est le format le plus simple pour un freelance : lisible comme un PDF, exploitable par le logiciel du client et par une
plateforme agréée.

## Décision
- Génération **dans le backend** (Node) : `pdf-lib` + `fontkit` pour le PDF/A-3b, XML écrit à la main (aucune dépendance
  XML) dans l'ordre exigé par le XSD.
- Profil **EN 16931** (facture complète avec lignes), `/AFRelationship /Data` (convention Factur-X française).
- Polices DejaVu incorporées (licence libre), profil sRGB généré par Little CMS : rien de propriétaire dans le dépôt.
- Le document reflète la facture **émise** (coordonnées figées, pas les encaissements) et il est déterministe.
- **Validation par Mustang** (référence open source, inclut veraPDF), version épinglée avec empreinte SHA-256, en local
  (`npm run facturx:validate`) et dans un job CI dédié.

## Points à surveiller
- Franchise en base sans n° de TVA : le SIREN est porté en BT-32 (`FC`) pour satisfaire BR-E-02 ; à confirmer avec la
  plateforme agréée retenue.
- Les règles françaises complémentaires (`EXTENDED-CTC-FR`, adresses électroniques de facturation) pourront demander
  un profil ou des champs supplémentaires.
