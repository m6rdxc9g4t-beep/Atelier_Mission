# UX — parcours et principes

## Persona
**Camille, développeuse freelance (micro-entreprise, franchise de TVA), 70 % de ses missions via Malt.**
Elle saisit déjà son temps dans Atelier Projets et suit ses comptes dans Atelier Trésorerie. Ce qu'elle veut :
ne plus rien oublier (relancer un prospect, facturer un mois de travail, relancer un impayé) et voir d'un coup d'œil
où en est l'argent. Ce qu'elle ne veut pas : ressaisir trois fois la même chose, ou envoyer un mail au mauvais moment.

Contextes d'usage : le lundi matin sur l'ordinateur (planifier la semaine, facturer), et en déplacement sur le téléphone
(vérifier un paiement, déplacer une carte après un appel).

## Parcours clés

### 1. Une demande arrive sur Malt → devis
1. *Pipeline › Nouveau prospect* : client (nouveau ou existant), intitulé, **TJM × jours** (le montant se calcule), lien Malt.
2. Après l'appel de cadrage : glisser la carte en *Qualifié*, noter la prochaine action et sa date (elle remonte dans « À faire »).
3. *Créer le devis* depuis la carte : la ligne TJM × jours est déjà là. *Marquer envoyé* → la carte passe en *Devis envoyé*.
4. *Accepté* → l'opportunité est **gagnée** (100 %).

### 2. Fin de mois : le temps devient une facture
1. *Tableau de bord* : « 38 h 30 non facturées dans Atelier Projets » → *Facturer*.
2. *Temps* : *Importer depuis Projets*, les saisies non facturées sont cochées. *Facturer 38 h 30*.
3. Fenêtre : client (prérempli si le projet est lié à une opportunité), jours ou heures, TJM, regroupement. **Aperçu des lignes** avant de créer.
4. Le brouillon s'ouvre : ajuster, puis *Émettre* (numéro, date, coordonnées figées). Pour Malt : saisir le n° de la facture Malt.

### 3. Le client paie → Trésorerie
1. Facture › *Encaissement* : le reste à payer est prérempli.
2. La facture passe *Payée*, les relances sont annulées, **l'opération apparaît dans Trésorerie** (et les frais Malt en dépense).

### 4. Un client ne paie pas → relance
1. J+3 après l'échéance, la relance apparaît dans *À faire* et dans *Relances › À envoyer*.
2. *Aperçu* : l'e-mail exact (destinataire, objet, corps). *Envoyer* → Brevo. Le niveau suivant attend son tour.
3. Hors ligne, le bouton reste visible mais désactivé, avec la raison : rien ne part par surprise.

## Principes
1. **Une seule saisie.** Le temps vient de Projets, les encaissements vont dans Trésorerie, les coordonnées du client
   alimentent factures et relances.
2. **Le bon geste au bon endroit.** Chaque écran propose l'action suivante (*Créer le devis*, *Transformer en facture*,
   *Facturer*, *Encaissement*), et le tableau de bord ne montre que ce qui demande une action.
3. **Rien d'irréversible sans prévenir.** Émettre fige la facture (fenêtre explicative) ; une facture émise s'annule par
   un avoir, jamais en silence ; passer *En ligne* affiche exactement ce qui sera envoyé à Brevo.
4. **Les erreurs disent quoi faire.** « Ajoutez l'adresse du client « X » (mention obligatoire) », « Atelier Projets ne
   répond pas : lancez-le pour réimporter », « Choisissez le compte bancaire Trésorerie dans Paramètres ».
5. **Hors ligne par défaut, local d'abord.** Le seul flux sortant (Brevo) est derrière un interrupteur visible en permanence.
6. **Clavier et mobile.** Chaque glisser-déposer a son équivalent (menu « Déplacer vers ») ; fenêtres `<dialog>` natives
   (Échap, focus piégé) ; navigation repliable sous 1024 px ; indicateurs sur deux colonnes au téléphone.

## États vides et dégradés
| Situation | Ce que voit l'utilisatrice |
|---|---|
| Pipeline vide | Invitation à ajouter un prospect Malt, avec le bouton |
| Projets arrêté | Bandeau d'avertissement, saisies déjà importées toujours facturables, bouton *Importer* désactivé |
| Trésorerie arrêtée | Encaissement enregistré quand même, état *Échec* + bouton *Envoyer* ; compteur sur le tableau de bord |
| Brevo non configuré | Raison précise et lien vers *Paramètres › Connexions* |
| Saisie modifiée après facturation | Badge *À vérifier* sur la facture et dans *Temps › À vérifier* |
