# F2-L: login pelo navegador sobre o MariaDB (plano)

Gravado em 2026-11-20, antes da F2.2. Objetivo do dono: abrir `https://192.168.0.104:5310` na rede local e
entrar com usuário e senha guardados no banco `cliente_<codigo>` (MariaDB `127.0.0.1:3410`). Depende da F2.1
(`@sgh/nucleo`, em construção por outro agente: este plano só **consome** o pacote).

## 1. Situação medida

- `main.ts`, `nucleo.ts`, `configuracao.ts` e `app.module.ts` (3.946 linhas, **um** `AppModule.com()` com 369
  controladores numa lista só) importam `@sgh/legado`. São 513 arquivos de produção da API com esse import
  (2.862 nomes de valor, 1.371 de tipo). O build (`vite build`) junta tudo: hoje **não compila**.
- O fecho de imports do login (`sessao/*`, `autorizacao/*`, `acesso.controller.ts`, `sistema.controller.ts`,
  `problema.filter.ts`) tem 77 arquivos, e 39 deles importam o legado. Os principais são `sessao/` (6),
  `autorizacao/` (4) e `modulos/acesso/` (sintéticos e `senha/porta-senha.ts`). Os demais vêm de `config/`,
  `cadastro/` e `assinatura/`, puxados pelo `acesso.controller`.
- Porta `FonteAcesso` (`sessao/fonte-acesso.ts`): `rede`, `estabelecimentos`, `saude()`,
  `autenticar(codigo, login, senha, fixa?)`, `configLogin(codigo)`, `dadosDeSessao(codigo, login, config)`,
  `contaAlvo?()`, mais `dadosDeAutorizacao(codigo, login, flags)` (`FonteAutorizacao`). Os tipos (`Autenticacao`,
  `ContaLegado`, `ConfigLogin`, `DadosSessao`, `SituacaoTermoLegado`, `ContaAlvo`, `SaudeEstabelecimento` e
  `Combinacao`) moravam no legado: `new-sgh/packages/legado/src/acesso/repositorios/{credencial,politica,sessao,alvos}.ts`
  e `nucleo/legado.ts`.
- `montar.ts`: com `AMBIENTE=dev`, `escolherFonteAcesso` devolve a **fonte sintética** (senhas no repositório).
  A fonte real só entra fora de dev/ci ou com `ACESSO_FONTE_DEV=copia`. É preciso um terceiro valor.
- Cifra: `@sgh/dominio-acesso/cifra-plataforma.ts` já faz `cifrarSenha` / `conferirSenha` em argon2id (formato
  PHC `$argon2id$v=19$m=65536,t=3,p=1$...`). É o padrão do caminho novo do login. As combinações SHA-1
  (`Combinacao`) são do SPDATA e ficam para o conector.
- O web (`apps/web/vite.config.ts`) já tem `WEB_ESCUTA`, `WEB_PORTA`, `API_PORTA`, `WEB_HTTPS_CERT` e
  `WEB_HTTPS_CHAVE`. A API fica em `127.0.0.1` atrás do proxy `/api`, com `xfwd`. O cookie de sessão é **sempre**
  `Secure` (`sessao/cookies.ts`; em dev, o nome fica sem o prefixo `__Host-`), então o acesso de fora exige https.
- Certificado já existente (feito na obra de 17/11):
  - `/home/mmalves/workspace/redesante/obra-sgh/certs/dev.crt` e `dev.key`, com SAN `192.168.0.104`,
    `127.0.0.1` e `localhost`, válido até 2029;
  - AC em `ca.crt`, que o navegador do dono provavelmente já confia.
  - Use os arquivos **pelo caminho**, sem copiar para o repositório.
- Telas de login chamam `/api/estabelecimentos`, `/api/sessao` (POST, GET e DELETE) e `/api/sessao/senha`.
  As rotas ficam no `AcessoController` (21 rotas, 697 linhas).
- Portas: 3310 e 5310 estão **livres** (`ss -ltn`); 3410 é o `sante-sgh-mariadb`. Valkey: em dev, sem
  `VALKEY_URL`, a sessão fica em memória, o que basta.

## 2. Menor caminho

**A. Boot por lista de módulos, sem apagar código.**
- Novo `apps/api/src/app-base.module.ts`, com a mesma assinatura `com(configuracao, nucleo, env, opcoes)`. Ele
  monta só:
  - **saúde/sistema:** `SistemaController`;
  - **sessão:** `AcessoController` e `ServicoSessao`;
  - **autorização:** `GuardaPermissao`, `ResolvedorSessao` e `InterceptadorAuditoria`;
  - `ProblemaFilter`.
- Novo `apps/api/src/modulos/registro.ts`: um mapa `nome → () => import('./<modulo>/modulo.js')`, vazio na F2-L.
  - A F2.2/F2.3 inclui cada módulo migrado.
  - `API_MODULOS=sessao,autorizacao,sistema` (padrão) ou `todos`.
  - Um nome desconhecido ou ainda não migrado **recusa a partida**, com mensagem.
- O `app.module.ts` fica **intocado**, fora do grafo do build, como referência para desmontar. O `main.ts` passa
  a usar o `app-base` e o `criarApp` em `app.ts` recebe o módulo.
- Typecheck da F2-L: `apps/api/tsconfig.login.json`, que inclui só o fecho do login. Na F2.3 ele volta ao
  `tsconfig.json` cheio.

**B. Cortar o legado no fecho do login (39 arquivos).**
- Tipos neutros em `apps/api/src/sessao/tipos-acesso.ts`, copiados e renomeados a partir do new-sgh:
  - `ContaLegado` passa a ser `ContaAcesso`, sem `criptografada` nem `doisFatoresLegado`;
  - `Combinacao` sai do contrato.
- `ErroOperacao`, `ContextoOperacao`, `executarComo` e as funções de ambiente (`aplicarArquivoAmbiente`,
  `caminhoArquivoAmbiente`) vêm do `@sgh/nucleo`. `recusaDePartida` vira `verificarNeutralizacao` ou
  `formatarNeutralizacao`.
- O `acesso.controller` deixa de puxar `config/`, `cadastro/` e `assinatura/`:
  - os serviços opcionais (login por certificado, troca rápida, recuperação) entram como `@Optional()`, só por
    tipo;
  - o que sobrar vira porta injetada, nula na F2-L, que responde 501 "módulo não migrado".

**C. `FonteAcessoPropria` (`apps/api/src/sessao/fonte-propria.ts`), com SQL sobre `cliente_<codigo>` pelo
`Leitor` do `@sgh/nucleo`.**
- `estabelecimentos` e `saude()`: `estabelecimento` (`ativo`, `excluido_em IS NULL`) e o estado do pool.
- `autenticar`:
  - lê `usuario` por `login` (`situacao`, `bloqueado_em`, `expira_em`, `excluido_em`) e `credencial_usuario`
    (`algoritmo='argon2id'`, `resumo_senha`, `troca_obrigatoria`, `senha_alterada_em`);
  - confere com `conferirSenha`;
  - desfechos `ok`, `credencial-invalida`, `conta-impedida` e `sem-cifra` (sem credencial).
- `configLogin`: `politica_senha` do estabelecimento. Sem linha, usa um padrão seguro declarado no código, com
  aviso no log.
- `dadosDeSessao`:
  - unidades de `usuario_estabelecimento` (vigente);
  - papéis de `usuario_perfil` com `perfil_acesso`;
  - termo de `aceite_termo_uso` com `termo_uso_versao`.
- `dadosDeAutorizacao`: concessões de `perfil_acao` com `acao_sistema.codigo` e escopos de `usuario_escopo`.
  - `perfil_acesso.administrador=1` ou `usuario.administrador_plataforma=1` dá o catálogo inteiro
    (`PERMISSOES_*` de `@sgh/contratos`): **o administrador da plataforma pode tudo**.
- `montar.ts`: novo valor `ACESSO_FONTE_DEV=propria`, que é o padrão quando o `NucleoProprio` está configurado.
  A sintética fica só para ci e testes.
- Gravações do login (tentativas, bloqueio, `ultimo_acesso_em`, troca de senha com `historico_senha`, eventos
  em `evento_sessao`): pelo `Executor` do núcleo, com trilha na mesma transação. Na F2-L basta a contagem de
  tentativas e a troca de senha; o resto, no lote 4.

**D. Semeador `tools/db/semear-acesso.ts`** (`./pnpm exec tsx`; idempotente; argumento `<codigo-cliente>`).
- Garante:
  - 1 `estabelecimento` (se o banco estiver vazio);
  - `politica_senha` padrão;
  - perfis `ADMIN` (`administrador=1`) e `TESTE` (`administrador=0`, com algumas ações de consulta);
  - os 2 usuários, com `usuario_estabelecimento`, `usuario_perfil` e `credencial_usuario`
    (`algoritmo='argon2id'`, `resumo_senha` gerado por `cifrarSenha`, `troca_obrigatoria=1` para o teste).
- Administrador da plataforma:
  - linha em `plataforma.administrador_plataforma` (nome e e-mail);
  - no banco do cliente, um `usuario` com `administrador_plataforma=1`.
- Variáveis no `.env`, lidas pelo código e **nunca impressas**: `SEMEAR_ADMIN_LOGIN`, `SEMEAR_ADMIN_SENHA`,
  `SEMEAR_ADMIN_EMAIL`, `SEMEAR_TESTE_LOGIN` e `SEMEAR_TESTE_SENHA`. Sem a senha, recusa.
- A saída tem só contagens.

**E. Rede e https.**
- Na API: `API_PORTA=3310` e `listen('127.0.0.1')`, sem mudança. `configuracao.portaApi` lê `API_PORTA`.
- No web, no `.env`:
  - `WEB_ESCUTA=0.0.0.0` e `WEB_PORTA=5310`;
  - `WEB_HTTPS_CERT` e `WEB_HTTPS_CHAVE` apontando para os `certs/dev.*` acima.
- Novo script `tools/dev/subir-login.sh`:
  - sobe a API (build e `node dist/main.js`) e o `vite` do web;
  - confere as portas livres antes e escreve as URLs.
- Se o navegador recusar o certificado, importe a `ca.crt` como AC confiável.
- Alternativa sem certificado: o túnel `ssh -L 5310:127.0.0.1:5310` para `localhost`, que é contexto confiável.
- O cliente de dev é `CLIENTE_PADRAO=<codigo>`; o pool do núcleo resolve o banco pela `plataforma.cliente`. A
  escolha de cliente pelo login fica para a F2.2.

## 3. Lotes para os construtores (ordem; cada um fecha com typecheck do fecho e testes)

| Lote | Itens |
|---|---|
| 1. Tipos e ambiente | `sessao/tipos-acesso.ts`; `sessao/fonte-acesso.ts` (importa os tipos novos); `autorizacao/servico-autorizacao.ts` (tipos); `problema.filter.ts` e `autorizacao/{guarda,trilha}.ts` → `ErroOperacao` do núcleo; `configuracao.ts` (ambiente do núcleo, `API_PORTA`) |
| 2. Sessão sem legado | `sessao/{montar,servico-sessao,porta-pin,rede,troca-rapida}.ts`; `modulos/acesso/senha/porta-senha.ts` (só argon2id) |
| 3. Fonte própria | `sessao/fonte-propria.ts` + `fonte-propria.int.spec.ts` (cliente `teste_login` criado por `criar_cliente.py`); `modulos/acesso/{fonte-sintetica,sessao-sintetica,estado-sintetico}.ts` ajustados aos tipos novos |
| 4. Boot mínimo | `app-base.module.ts`; `modulos/registro.ts` (`API_MODULOS`); `app.ts` (recebe o módulo); `nucleo.ts` (`NucleoProprio`); `main.ts`; `modulos/acesso/acesso.controller.ts` (dependências opcionais, 501 no não migrado) |
| 5. Semeador e build | `tools/db/semear-acesso.ts` + teste; `apps/api/tsconfig.login.json`; `apps/api/vite.config.ts` (entrada e externos sem o legado); verificador `tools/obra/contar-legado.sh` (imports restantes do `@sgh/legado`, meta 0 na F2.3) |
| 6. Subida e prova | `.env` (sem imprimir; só as chaves novas); `tools/dev/subir-login.sh`; prova: `curl -k https://192.168.0.104:5310/api/saude`, POST `/api/sessao` com o teste (200 + `Set-Cookie Secure`), senha errada (401, tentativa contada), e o dono entra pelo navegador |

## 4. Riscos

- **O fecho pode crescer:** o `acesso.controller` puxa `config`, `cadastro` e `assinatura`.
  - Se cortar por `@Optional()` não bastar, crie um `SessaoController` enxuto com as 6 rotas do login e deixe o
    `AcessoController` para a F2.2.
  - Meça com `python3 -I` sobre o fecho de imports (script em `scratchpad/fecho.py`; leve-o para
    `tools/obra/`).
- **Catálogo de ações vazio:** um cliente novo não tem linhas em `acao_sistema`, então o perfil `TESTE` sai sem
  permissão.
  - O semeador carrega os códigos de `@sgh/contratos` em `acao_sistema`.
  - Decisão pendente: isso é do semeador ou do `criar_cliente.py`?
- **Administrador da plataforma sem credencial na plataforma:** `plataforma.administrador_plataforma` não tem
  senha. Na F2-L, ele entra por um usuário-espelho no banco de cada cliente.
  - O login da plataforma, sem cliente, pede a migração `db/plataforma/0002` (criada na revisão do lote 4:
    `credencial_administrador_plataforma`, argon2id). Decisão do dono; falta a ligação (ver ESTADO.md).
  - **Pendência registrada na revisão do lote 3 (2026-11-20):** a decisão (b) do dono ainda não está ligada.
    `autorizacaoDoAtorPlataforma` (em `autorizacao/servico-autorizacao.ts`) só é usada no teste
    `servico-autorizacao-cliente.spec.ts`; não existem a `db/plataforma/0002` (credencial argon2id), a fonte de
    autenticação da plataforma com a escolha do cliente nem a ligação no `ServicoSessao`. Hoje o dono entra com uma
    conta do banco do cliente, e o acesso total vem do perfil `administrador` do cliente. Fica para o lote que fizer
    o login da plataforma (escolha de cliente, F2.2), com teste de ponta a ponta do login do ator da plataforma.
  - **Lote 5 (2026-11-20): ligada.** `sessao/fonte-plataforma.ts` (`FontePlataformaPropria`, banco plataforma) +
    `ServicoSessao.entrarPlataforma` + `POST /api/sessao/plataforma` (contrato `esquemaEntrarAdministradorPlataforma`):
    senha argon2id da 0002, cliente escolhido (ou o único da API), todas as permissões, troca obrigatória da senha
    inicial, reautenticação e troca pela senha da plataforma. Falta: `NucleoProprio.lerPlataforma/escreverPlataforma`
    no `@sgh/nucleo` (sem eles a rota responde 503) e a opção na tela de login do web.
- **`ServicoAutorizacao` amarrado ao legado:** ele traz `CATALOGO_LEGADO_ORIGEM.estabelecimento` (falha fechada
  HS-1) e as flags do legado.
  - Na fonte própria, troque o filtro por "estabelecimento do cliente".
  - Sem isso, a sessão abre sem permissões.
- **Cookie `Secure` em http:** o navegador o descarta calado. Confira que o acesso é https.
- **Trava de saídas:** a lista de `*_HOST` passa a ser conferida pelo `verificarNeutralizacao` do núcleo.
  `WEB_ESCUTA` foi nomeada assim de propósito.

## 5. Depois (F2.2/F2.3)

- Migrar os outros módulos um a um: portas, tabelas novas e entrada no `registro.ts`, até `API_MODULOS=todos`.
- O `app.module.ts` vai sendo desmontado e removido no fim.
- `ServicoIdentidade`, PIN, recuperação de senha, certificado, "login como" (`contaAlvo`), troca rápida, Valkey
  e escolha de cliente no login (multi-banco).
- Typecheck e build cheios, com o verificador `contar-legado` em 0.
