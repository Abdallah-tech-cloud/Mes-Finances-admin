/* Connexion au compte utilisateur et à la base de données (Supabase).
   La clé "anon" (ou "publishable") est publique par conception : elle peut être dans ce fichier.
   Ne mettez JAMAIS la clé "service_role" (ou "secret") ici ni dans le dépôt GitHub. */
window.MF_CONFIG = {
  SUPABASE_URL: 'https://mflutosykjiuuaoljkst.supabase.co',        // exemple : 'https://abcdefghijkl.supabase.co'
  SUPABASE_ANON_KEY: 'sb_publishable_viQJLeM4_QkN9LZPA34ENg_Tx6RhyAF',   // clé "anon" / "publishable" du projet
  APP_URL: 'https://abdallah-tech-cloud.github.io/Mes-Finances-admin/'              // facultatif : adresse du site, ex. 'https://mes-finances-nu.vercel.app/'
};
