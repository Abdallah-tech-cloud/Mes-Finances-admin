# Mes Finances — application avec comptes utilisateurs

Application de suivi de dépenses, recettes et épargne (Orange Money, Wave, Yas Money, espèces). Même design qu'avant, mais :
- chaque personne a **son compte** (e-mail + mot de passe) ; ses données sont enregistrées **dans son compte**, plus dans le navigateur ;
- l'appli est **installable** sur téléphone et ordinateur (PWA) ;
- les accès sont protégés par des **règles de sécurité** côté base de données et côté site.

Site statique (HTML, CSS, JavaScript) + service gratuit **Supabase** (comptes + base de données). Aucun serveur à écrire.

## Mise en place (environ 30 minutes)

### 1. Créer le projet Supabase
1. Créez un compte sur supabase.com, puis **New project**. Choisissez la région la plus proche de vos utilisateurs et un mot de passe de base de données solide (rangez-le dans un gestionnaire de mots de passe).
2. **SQL Editor → New query**, collez le contenu de `supabase/schema.sql`, puis **Run**. Cela crée les tables, les règles d'accès par utilisateur (RLS) et la suppression de compte.
3. Le fichier se termine par une vérification qui s'exécute toute seule : sous l'éditeur, vous devez voir **3 lignes** (`goals`, `profiles`, `transactions`) avec **`rls_active` = `true`**. C'est un résultat à lire, pas une requête à taper. Le fichier peut être relancé sans risque autant de fois que nécessaire.

### 2. Régler l'authentification (Authentication)
- **Sign In / Providers → Email** : gardez **Confirm email** activé (chaque compte doit confirmer son adresse).
- **Password** : longueur minimale **10**. Si votre offre le permet, activez la protection contre les mots de passe déjà divulgués.
- **URL Configuration** : *Site URL* = l'adresse de votre site (ex. `https://mes-finances-nu.vercel.app`) ; *Redirect URLs* = la même adresse (c'est là que les liens des e-mails reviennent).
- **E-mails** : le service d'envoi intégré est très limité. Pour de vrais utilisateurs, configurez votre propre service d'envoi (SMTP) dans *Authentication → SMTP*.
- Ne désactivez pas les limitations de tentatives (rate limits) proposées par Supabase.

### 3. Relier le site
Ouvrez `config.js` et renseignez `SUPABASE_URL` et `SUPABASE_ANON_KEY` (*Project Settings → API*). La clé « anon / publishable » est publique par conception. **Ne mettez jamais la clé « service_role » (ou « secret ») dans ce dossier ni sur GitHub.**

### 4. Mettre en ligne (Vercel)
Remplacez les fichiers de votre dépôt GitHub par ceux de ce dossier (en gardant vos propres modifications) et envoyez-les : Vercel redéploie. `vercel.json` ajoute les en-têtes de sécurité.

### 5. Tester avant d'ouvrir à d'autres
1. Créez deux comptes avec deux adresses e-mail, confirmez-les.
2. Ajoutez une transaction dans chaque compte : **chacun ne doit voir que la sienne**.
3. Testez « Mot de passe oublié », la déconnexion, puis « Supprimer mon compte » avec un compte de test.
4. Ouvrez le site en navigation privée : sans connexion, rien ne doit s'afficher.

### 6. Activer l'espace administrateur (facultatif)
1. **SQL Editor → New query** : collez le contenu de `supabase/admin.sql` (après `schema.sql`) et **Run**. Le fichier peut être relancé sans risque.
2. Créez **votre propre compte** dans l'application et confirmez votre e-mail.
3. Dans le SQL Editor, lancez cette requête en remplaçant l'adresse par la vôtre (elle figure aussi, en commentaire, dans `admin.sql`) :
   `insert into public.admins (user_id, note) select id, 'propriétaire' from auth.users where email = 'votre.adresse@exemple.sn';`
4. Reconnectez-vous : **Administration** apparaît dans le menu (ordinateur) et dans **Réglages** (téléphone). Même design, mêmes écrans sur téléphone et PC.

Pour retirer un administrateur : `delete from public.admins where user_id = (select id from auth.users where email = 'adresse@exemple.sn');`

**Ce que l'espace administrateur permet** : tableau de bord (comptes, nouveaux, actifs, confirmés, nombre de transactions, inscriptions et saisies sur 14 jours, répartition par établissement), liste des comptes avec recherche par e-mail, suspension / réactivation, suppression d'un compte et de ses données, journal des actions.

**Ses garde-fous**
- Le droit d'administrateur est vérifié **par la base de données à chaque appel** : l'écran ne fait que l'afficher. Un compte normal reçoit « forbidden », même s'il appelle les fonctions à la main. Aucune clé secrète n'est utilisée dans l'application.
- L'espace n'affiche **jamais** les montants, comptes, catégories ni notes des transactions : seulement des nombres.
- Un administrateur ne peut pas se suspendre ni se supprimer lui-même, ni viser un autre administrateur. Chaque suspension ou suppression est inscrite dans un journal que personne ne peut modifier depuis l'application.
- À vérifier après mise en place : connecté avec un **compte normal**, ouvrez la console du navigateur (F12) et tapez `MF.admin.stats()` : la réponse doit être une erreur « Accès réservé aux administrateurs ».

**À savoir**
- Le propriétaire du projet Supabase peut, lui, tout voir depuis la console Supabase : précisez dans la politique de confidentialité qui y a accès et dans quel cadre (champ à compléter dans l'article « Qui peut accéder à vos données ? »).
- Il n'y a pas d'authentification à deux facteurs : protégez les comptes administrateurs avec un mot de passe long et unique, et gardez-en peu.
- Suspendre un compte coupe ses sessions, mais un jeton déjà émis peut rester valable jusqu'à une heure.
- « Actifs » s'appuie sur la dernière connexion par mot de passe : les personnes restées connectées sont sous-estimées.

## Ce qui est en place pour la sécurité
- **Cloisonnement par utilisateur** (RLS) : la base refuse tout accès aux lignes d'un autre compte, même si quelqu'un modifie le code du navigateur. Les visiteurs non connectés n'ont aucun droit sur les tables.
- **Politique de sécurité du contenu (CSP)** stricte : seul le code de ce site s'exécute (aucun script en ligne, aucune bibliothèque externe). Le texte saisi est échappé et l'export CSV neutralise les formules.
- **Mots de passe** : jamais stockés ni lisibles par l'application ; règles de longueur côté interface et côté serveur ; messages d'erreur identiques pour un e-mail inconnu ou un mauvais mot de passe ; attente après 5 échecs.
- **Session** : jeton à durée limitée, renouvelé automatiquement ; « Rester connecté » décoché = session effacée à la fermeture ; déconnexion et suppression de compte dans Réglages → Mon compte.
- **Données minimales** : e-mail, transactions, objectif ; profil et photo facultatifs. Aucun traceur, aucune publicité.
- Contrôles de validité côté base (montants, comptes, catégories, longueurs).
- Code de verrouillage à 4 chiffres facultatif **par appareil** (il protège l'accès depuis l'appareil, pas le compte).

## Ce que j'ai testé, et ce que vous devez vérifier
Le code a été testé de bout en bout contre un **serveur de simulation** de Supabase (inscription, connexion, session expirée, cloisonnement entre deux comptes, suppression, import, hors ligne, espace administrateur avec refus pour les comptes normaux, aucune violation de la politique de sécurité). Je n'ai **pas pu tester contre un vrai projet Supabase** : les règles RLS des fichiers SQL et l'envoi réel des e-mails sont à valider avec la checklist de l'étape 5 (et le test de l'étape 6 pour l'administration).

## Conformité (Sénégal) — à traiter avant l'ouverture
Avec des comptes et un hébergement des données chez des prestataires, vous devenez **responsable de traitement** au sens de la loi sénégalaise n° 2008-12 sur les données personnelles. Vérifiez auprès de la **CDP** (Commission de Protection des Données Personnelles) les formalités à accomplir (déclaration ou autorisation) et le cadre applicable à l'hébergement hors du Sénégal. Si des élèves mineurs utilisent l'appli, prévoyez l'accord des parents ou tuteurs. Complétez les `[à compléter]` des pages `confidentialite.html` et `conditions.html` (qui sont aussi dans Réglages → Légal), et faites relire le tout par un juriste. Ce guide n'est pas un avis juridique.

## Limites actuelles
- Les données ne sont pas modifiables hors ligne : hors connexion, l'écran s'ouvre mais un message indique que le réseau manque.
- Les 5 000 dernières transactions sont chargées ; pas d'authentification à deux facteurs ; pas de changement d'adresse e-mail dans l'appli.
- Les projets Supabase du plan gratuit peuvent être mis en pause après une période d'inactivité et ont des quotas : surveillez-les.
- Vos données d'avant les comptes (stockées dans ce navigateur) peuvent être importées dans le compte : Réglages → Mon compte.

## Fichiers
```
index.html  style.css  app.js  api.js  config.js   l'application (api.js = comptes et données)
confidentialite.html  conditions.html               pages légales publiques
manifest.webmanifest  sw.js  icons/  logo.svg       installation de l'appli et hors ligne
vercel.json                                          en-têtes de sécurité
supabase/schema.sql                                  base de données et règles de sécurité
supabase/admin.sql                                   espace administrateur (facultatif)
```
