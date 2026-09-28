# Minha biblioteca de jogos

Site estático para GitHub Pages. O catálogo inicial reúne os títulos que consegui identificar com segurança razoável nas fotos. Cada jogo em cada plataforma é um registro independente. Revise os títulos, acrescente os ausentes e ajuste o formato físico/digital: uma foto da biblioteca da PSN não comprova, sozinha, qual licença é sua.

## Usar antes da publicação

Abra a pasta com um servidor local. Clicar diretamente no arquivo HTML pode impedir o navegador de carregar `data/games.json`. O catálogo funciona e salva neste navegador, mesmo antes de configurar a nuvem. O indicador no topo mostra quando a sincronização estiver ativa.

## Ativar sincronização

1. Crie um projeto em [Supabase](https://supabase.com/).
2. No SQL Editor, execute `supabase.sql`.
3. A URL do projeto e a chave **publishable** estão no início de `index.html`. Se mudar de projeto, atualize esses dois valores ali. Nunca coloque a chave `secret` ou `service_role` no site.
4. Em **Authentication → URL Configuration**, informe a URL final do GitHub Pages em **Site URL** e **Redirect URLs**. O link de acesso por e-mail precisa voltar para essa URL.
5. Publique no GitHub Pages. Entre pelo botão **Sincronizar**. A primeira conexão envia o catálogo inicial e suas alterações locais para sua conta.

Visitantes usam a visualização pública, sem botões de edição. Somente a conta proprietária configurada no aplicativo pode alterar e sincronizar esta biblioteca. O banco protege jogos e anotações por conta. As capas enviadas usam um bucket público e ficam acessíveis por link; não envie fotos privadas inteiras. As fotos originais em `fotos-consulta` não precisam ser publicadas. Antes de criar o repositório público, mova essa pasta para fora do repositório ou mantenha-a ignorada pelo Git.

## Publicar no GitHub Pages

Crie um repositório para esta pasta, envie os arquivos e, nas configurações do repositório, abra **Pages → Build and deployment → Deploy from a branch**. Escolha a branch principal e a pasta **/(root)**. A pasta `fotos-consulta` é ignorada por `.gitignore`.

## Capas

No editor de cada jogo, informe uma URL HTTPS, escreva um caminho para uma imagem colocada em `covers/`, ou envie um JPG/PNG/WebP depois de entrar na conta. As fotos originais não são usadas como capas automaticamente porque várias incluem cômodos e metadados de localização; os recortes também não são nítidos o bastante para vários jogos.

## Dados

A lista inicial está em `data/games.json`. Após o primeiro acesso, as edições são salvas no navegador e, quando a conta estiver configurada e conectada, no Supabase. O site nunca envia suas fotos originais. Uma entrada de PlayStation e outra de Switch do mesmo jogo podem ter notas e progresso diferentes.
