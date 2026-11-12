/* Connexion au compte utilisateur et à la base de données (Supabase).
   La clé "anon" (ou "publishable") est publique par conception : elle peut être dans ce fichier.
   Ne mettez JAMAIS la clé "service_role" (ou "secret") ici ni dans le dépôt GitHub. */
window.MF_CONFIG = {
  SUPABASE_URL: '',        // exemple : 'https://abcdefghijkl.supabase.co'
  SUPABASE_ANON_KEY: '',   // clé "anon" / "publishable" du projet
  APP_URL: ''              // facultatif : adresse du site, ex. 'https://mes-finances-nu.vercel.app/'
};
