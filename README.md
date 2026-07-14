# ParkRadar — guide de déploiement

App de recherche de parkings gratuits/payants avec GPS, comptes utilisateurs et
base de données réelle. 100 % gratuit à héberger (Supabase + Vercel).

Suis ces étapes dans l'ordre. Compte environ 30-40 minutes la première fois.

---

## Étape 1 — Créer la base de données (Supabase)

1. Va sur https://supabase.com et clique sur **Start your project**.
2. Crée un compte (avec GitHub ou email).
3. Clique sur **New project**. Choisis un nom (ex. `parkradar`), un mot de
   passe de base de données (garde-le de côté), et une région proche de toi.
4. Attends 1-2 minutes que le projet soit prêt.
5. Dans le menu de gauche, ouvre **SQL Editor** → **New query**.
6. Ouvre le fichier `supabase/schema.sql` de ce projet, copie tout son
   contenu, colle-le dans l'éditeur SQL, puis clique sur **Run**.
   → Cela crée les tables `parkings` et `profiles`, la sécurité, et la
   fonction de recherche géographique.
7. Dans le menu de gauche, va dans **Settings → API**. Note deux valeurs :
   - **Project URL** (ex. `https://xxxxx.supabase.co`)
   - **anon public key** (une longue clé)

---

## Étape 2 — Configurer le projet en local

1. Installe [Node.js](https://nodejs.org) (version 18 ou plus) si ce n'est
   pas déjà fait.
2. Dans le dossier `parkradar`, copie `.env.example` vers un nouveau fichier
   nommé `.env` :
   ```
   cp .env.example .env
   ```
3. Ouvre `.env` et remplace les deux valeurs par celles notées à l'étape 1 :
   ```
   VITE_SUPABASE_URL=https://xxxxx.supabase.co
   VITE_SUPABASE_ANON_KEY=ta-cle-anon-ici
   ```
4. Installe les dépendances puis lance l'app en local pour tester :
   ```
   npm install
   npm run dev
   ```
   Ouvre le lien affiché (ex. `http://localhost:5173`) dans ton navigateur
   pour vérifier que tout s'affiche (le GPS ne marchera qu'en HTTPS, donc pas
   encore ici — c'est normal).

---

## Étape 3 — Créer ton compte GitHub et y envoyer le code

1. Va sur https://github.com et crée un compte gratuit.
2. Clique sur **New repository**. Nomme-le `parkradar`, laisse-le en
   **Public** ou **Private**, ne coche aucune case d'initialisation, puis
   **Create repository**.
3. Sur ta machine, dans le dossier `parkradar`, exécute :
   ```
   git init
   git add .
   git commit -m "Première version de ParkRadar"
   git branch -M main
   git remote add origin https://github.com/TON-PSEUDO/parkradar.git
   git push -u origin main
   ```
   (Remplace `TON-PSEUDO` par ton nom d'utilisateur GitHub. Le fichier
   `.gitignore` exclut déjà `.env` et `node_modules`, donc tes clés secrètes
   ne seront pas publiées.)

---

## Étape 4 — Héberger l'app (Vercel)

1. Va sur https://vercel.com et crée un compte (connecte-toi avec GitHub,
   c'est le plus simple).
2. Clique sur **Add New → Project**, puis choisis ton repo `parkradar`.
3. Vercel détecte automatiquement que c'est un projet Vite — ne change rien
   aux réglages de build.
4. Avant de déployer, ouvre la section **Environment Variables** et ajoute :
   - `VITE_SUPABASE_URL` → ton URL Supabase
   - `VITE_SUPABASE_ANON_KEY` → ta clé anon Supabase
5. Clique sur **Deploy**. Après 1-2 minutes, Vercel te donne une URL du type
   `https://parkradar-xxxx.vercel.app`.

---

## Étape 5 — Tester sur ton téléphone

1. Ouvre l'URL Vercel sur ton téléphone (envoie-toi le lien par SMS/email).
2. Crée un compte avec ton email dans l'app.
3. Autorise l'accès à la position quand le navigateur le demande.
4. Appuie sur **Activer le GPS** → les parkings alentour s'affichent.
5. Optionnel : dans le menu de partage du navigateur, choisis **Ajouter à
   l'écran d'accueil** pour l'utiliser comme une vraie app.

---

## Pour aller plus loin

- **Modération des ajouts communautaires** : tu peux ajouter une colonne
  `verified boolean default false` dans `parkings` et n'afficher que les
  parkings vérifiés, ou créer une interface admin.
- **Notifications, favoris, historique** : ce sont des tables Supabase
  supplémentaires à créer selon le même principe que `parkings`.
- **App installable native (PWA)** : ajoute un plugin comme
  `vite-plugin-pwa` pour un vrai manifest + service worker.
- **Limites du plan gratuit** : Supabase gratuit = 500 Mo de base de données
  et le projet se met en pause après 7 jours d'inactivité (il suffit de le
  relancer depuis le dashboard). Vercel gratuit = largement suffisant pour
  un usage personnel ou un lancement.
