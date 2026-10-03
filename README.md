# Minha biblioteca de jogos

Site estático para GitHub Pages. O catálogo inicial reúne os títulos que consegui identificar com segurança razoável nas fotos. Cada jogo em cada plataforma é um registro independente. Revise os títulos, acrescente os ausentes e ajuste o formato físico/digital: uma foto da biblioteca da PSN não comprova, sozinha, qual licença é sua.

## Usar antes da publicação

Abra a pasta com um servidor local. Clicar diretamente no arquivo HTML pode impedir o navegador de carregar `data/games.json`. O catálogo funciona e salva neste navegador, mesmo antes de configurar a nuvem. O indicador no topo mostra quando a sincronização estiver ativa.

## Ativar sincronização

1. Crie um projeto em [Supabase](https://supabase.com/).
2. No SQL Editor, execute `supabase.sql`.
3. A URL do projeto e a chave **publishable** ficam em `boot.js`. Se mudar de projeto, atualize esses dois valores ali. Nunca coloque a chave `secret` ou `service_role` no site.
4. Em **Authentication → URL Configuration**, informe a URL final do GitHub Pages em **Site URL** e **Redirect URLs**. O link de acesso por e-mail precisa voltar para essa URL.
5. Publique no GitHub Pages. Entre pelo botão **Sincronizar**. A primeira conexão envia o catálogo inicial e suas alterações locais para sua conta.

Visitantes usam a visualização pública, sem botões de edição, e veem as alterações salvas pelo proprietário (status, notas, anotações). Somente a conta proprietária pode alterar e sincronizar esta biblioteca: o banco só aceita escrita dessa conta e novos cadastros estão bloqueados. As capas enviadas usam um bucket público e ficam acessíveis por link; não envie fotos privadas inteiras. As fotos originais em `fotos-consulta` não precisam ser publicadas. Antes de criar o repositório público, mova essa pasta para fora do repositório ou mantenha-a ignorada pelo Git.

## Publicar no GitHub Pages

Crie um repositório para esta pasta, envie os arquivos e, nas configurações do repositório, abra **Pages → Build and deployment → Deploy from a branch**. Escolha a branch principal e a pasta **/(root)**. A pasta `fotos-consulta` é ignorada por `.gitignore`.

## Capas

No editor de cada jogo, informe uma URL HTTPS, escreva um caminho para uma imagem colocada em `covers/`, ou envie um JPG/PNG/WebP depois de entrar na conta. As fotos originais não são usadas como capas automaticamente porque várias incluem cômodos e metadados de localização; os recortes também não são nítidos o bastante para vários jogos.

## Dados

A lista inicial está em `data/games.json`. Após o primeiro acesso, as edições são salvas no navegador e, quando a conta estiver configurada e conectada, no Supabase. O site nunca envia suas fotos originais. Uma entrada de PlayStation e outra de Switch do mesmo jogo podem ter notas e progresso diferentes.

## Troféus

`data/trophies.json` guarda, para cada jogo de PlayStation, os troféus obtidos e o total, também separados em platina, ouro, prata e bronze. Os dados vêm do perfil público no Exophase (Gryphonn) e são importados de uma vez; para atualizar, peça uma nova importação. Os campos de troféus no editor continuam disponíveis para anotações manuais. Capas desses jogos, em `covers/`, vêm das imagens das listas de troféus. As demais capas (`covers/rawg-*.jpg`) vieram do [RAWG](https://rawg.io/), cujo plano gratuito exige o link de crédito que fica no rodapé do site.

## Versões do mesmo jogo

Com **Versões juntas** (padrão), o mesmo jogo em vários consoles da mesma plataforma aparece num único card, com um botão para cada versão. Cada versão continua com status, nota e anotações próprios. **Versões separadas** volta a mostrar um card por versão.

## Classificação rápida

O botão **Classificar rapidamente** (só para o proprietário) mostra um jogo por vez entre os que ainda estão sem console, sem formato ou "Para organizar". Na mesma tela dá para marcar console, formato, status, prioridade, nota, campanha, expansões, impressões e escrever anotações. Tudo é salvo na hora; o próximo jogo só abre quando você toca em **Próximo**.

Em todo o site (classificação rápida e editor), tocar numa opção já marcada desmarca, inclusive as estrelas da nota.

## Backup

- **Manual:** em **Minha conta**, baixe o backup completo (JSON) ou uma planilha (CSV).
- **Automático:** desativado de propósito. Como o repositório é público, uma cópia diária aqui ficaria visível e guardaria no histórico versões antigas das anotações, mesmo depois de editadas ou apagadas no site. Para backup automático, use um repositório privado separado.

## Segurança

Veja [SECURITY.md](SECURITY.md) para a revisão OWASP Top 10, os testes feitos e o que é público de propósito.
