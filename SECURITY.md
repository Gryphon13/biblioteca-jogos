# Segurança — revisão OWASP Top 10 (2021)

Revisão feita em 29/09/2026 sobre o site (GitHub Pages) e o back-end (Supabase: Postgres + Auth + Storage).

## Arquitetura e onde está a autoridade

O front-end é estático e roda no navegador; **a autoridade é o banco**. Toda regra de acesso é imposta no Postgres por Row Level Security (RLS), não pelo JavaScript. Alterar o código no navegador só muda a tela de quem alterou.

| Ação | Visitante (anon) | Outra conta logada | Dono |
|---|---|---|---|
| Ler jogos do dono | sim | sim | sim |
| Inserir / editar / excluir jogos | não | não | sim |
| Enviar / alterar / apagar capas | não | não | sim |
| Criar conta | não (bloqueado por trigger) | — | — |

O dono é definido em `public.library_owner` (tabela sem políticas: não é legível nem gravável pela API). As funções auxiliares ficam no schema `private`, que não é exposto pela API.

## Testes executados

**Controle de acesso (A01)**, simulando os papéis `anon` e `authenticated` (com outro usuário) diretamente no banco, dentro de transação desfeita ao final:

- anon insert → bloqueado (42501); anon update/delete → 0 linhas afetadas
- outra conta: insert bloqueado (42501); update/delete → 0 linhas
- outra conta: upload de capa → bloqueado (42501)
- anon lendo `library_owner` → 0 linhas; anon listando objetos do bucket → 0
- criação de usuário em `auth.users` → recusada pelo trigger

**XSS (A03)**, com um navegador automatizado recebendo dados maliciosos do "banco" (título, anotações, status, prioridade, id e capa com HTML/JS):

- **Antes:** 2 de 6 vetores executavam JavaScript (campos `status` e `prioridade` iam para o HTML sem escape). Explorável apenas por quem consegue gravar no banco, ou seja, o próprio dono, mas era uma falha real.
- **Depois:** 0 de 6.

## Achados e correções

| # | OWASP | Achado | Situação |
|---|---|---|---|
| 1 | A03 Injeção (XSS) | `status`, `prioridade` e `id` inseridos no HTML sem escape | **Corrigido**: todo dado passa por validação com lista de valores permitidos (`normalized`) e todos os campos são escapados na renderização |
| 2 | A05 Configuração | Sem Content Security Policy; scripts e handlers inline | **Corrigido**: CSP (`script-src 'self'`, `connect-src` só para o Supabase, `object-src`/`base-uri`/`frame-src` bloqueados); scripts inline movidos para `boot.js`; `onerror` inline trocado por listener |
| 3 | A04 Design inseguro | Banco aceitava qualquer JSON na coluna `data` | **Corrigido**: restrições `CHECK` (id igual ao da linha, tamanho ≤ 16 KB, valores permitidos para plataforma/console/formato/status/prioridade, título 1–160 caracteres, capa só em formatos seguros) |
| 4 | A07 Autenticação | "Sair" apagava a sessão só no aparelho | **Corrigido**: sair agora revoga a sessão no Supabase (todas as sessões) |
| 5 | A07 Autenticação | Qualquer e-mail podia criar conta | **Corrigido antes** (trigger + login com `create_user:false`) |
| 6 | A01 Controle de acesso | Outras contas podiam usar o bucket de capas | **Corrigido antes** (políticas restritivas: só o dono) |
| 7 | A02 Falhas criptográficas | Sessão (token) guardada em `localStorage` | **Aceito**: é o padrão do Supabase para sites estáticos. O risco é roubo via XSS, mitigado pelos itens 1 e 2. Token de acesso expira em 1 h |
| 8 | A08 Integridade | GitHub Action usa `actions/checkout@v4` por tag | **Baixo risco**: ação oficial; pode ser fixada por SHA se desejado |
| 9 | A05 Configuração | Aviso "Leaked password protection" | **Não se aplica**: login é por link no e-mail, sem senha |
| 10 | A03 Injeção (SQL) | — | **Sem achados**: nenhuma consulta é montada com texto do usuário; a API (PostgREST) usa parâmetros |
| 11 | A06 Componentes | — | **Sem achados**: nenhuma biblioteca de terceiros é carregada no navegador |
| 12 | A10 SSRF | — | **Não se aplica**: não há servidor que busque URLs |
| 13 | A09 Logs | — | Logs de API e Auth ficam no painel do Supabase |

## Sobre separar um back-end próprio

O Supabase já é o back-end: autenticação, autorização (RLS), validação (CHECK) e armazenamento acontecem no servidor. Um servidor intermediário próprio não acrescentaria controles que o banco não aplique hoje, e traria custo de hospedagem e mais superfície de ataque. Faria sentido se o site passasse a ter vários usuários, pagamentos ou regras de negócio que não caibam em políticas do banco.

## O que é público de propósito

- A chave `publishable` do Supabase (em `boot.js`): feita para o navegador; sozinha só permite o que as políticas deixam.
- O catálogo, notas e anotações: a biblioteca é pública para leitura por decisão do dono.
- As capas enviadas (bucket público, acessíveis por link).
