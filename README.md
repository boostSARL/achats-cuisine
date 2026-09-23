# Achats Cuisine

Gestion des achats de légumes et fruits (Node.js + Express, Bootstrap 5, jQuery AJAX, stockage JSON).

## Lancer en local

```bash
npm install
npm start
```

Ouvrir http://localhost:3000 — compte initial : `admin` / `admin123` (à changer après la 1re connexion).

## Déployer sur Render

1. Pousser ce dossier sur GitHub.
2. Sur Render : **New → Blueprint** → choisir le dépôt (le fichier `render.yaml` est détecté).
3. Renseigner `ADMIN_PASSWORD` (mot de passe initial du compte admin).

Le plan `starter` + disque persistant (`/var/data`) garde vos données entre les redémarrages.
Avec le plan **free** (sans disque), supprimez les blocs `plan`, `disk` et `DATA_DIR` du `render.yaml`,
mais les données seront **effacées** à chaque redémarrage / mise en veille.

## Variables d'environnement

| Variable | Rôle |
|---|---|
| `SESSION_SECRET` | Clé de signature des sessions (générée par Render) |
| `ADMIN_PASSWORD` | Mot de passe initial de `admin` (seulement à la 1re création) |
| `USER_PASSWORD` | Mot de passe initial de `cuisine` (rôle utilisateur) |
| `DATA_DIR` | Dossier des fichiers JSON (défaut : `./data`) |
| `TZ` | Fuseau horaire (défaut : `Africa/Casablanca`) |
