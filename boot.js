// Carregado antes do app: aplica o tema salvo (evita piscar) e define a configuração pública do Supabase.
// A chave abaixo é a "publishable", feita para ficar no navegador. Nunca coloque aqui a chave secret/service_role.
window.APP_CONFIG={supabaseUrl:"https://yasqxdskeawmpexwwmjj.supabase.co",publishableKey:"sb_publishable_uv9mC4MnKO0SMSDt-N6Opg_SgfjOC24"};
try {
  const theme = localStorage.getItem('biblioteca-jogos-theme-v1');
  document.documentElement.dataset.theme = ['original', 'dark', 'light', 'console'].includes(theme) ? theme : 'original';
} catch { document.documentElement.dataset.theme = 'original'; }
