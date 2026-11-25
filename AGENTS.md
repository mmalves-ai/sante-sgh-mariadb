# Instruções para agentes de IA (qualquer ferramenta)

Projeto `sante-sgh`: sistema hospitalar sobre **banco próprio em MariaDB 12.3**, construído a partir de um
**modelo base trazido do `new-sgh`** (pasta irmã) e melhorado para o banco novo. Os hospitais que vêm do
SPDATA entram por um **conector diferencial**. A decisão de fundo é o
[ADR 0001](docs/adr/0001-banco-proprio-e-virada-por-conector-diferencial.md).

## Comece por aqui

1. `docs/ESTADO.md`: em que pé está a obra, o marco atual, os bloqueios e as decisões pendentes.
2. A ficha do marco em `docs/fases/` e o ADR 0001. Leia só o necessário para o marco.
3. **Tarefa longa: siga o [protocolo de tokens](docs/obra/protocolo-tokens.md).** É regra obrigatória
   (2026-11-20), replicada do `new-sgh`.
   - Ao começar, avise: **"Rodando sob o protocolo de otimização de tokens e reports periódicos"**.
   - **Todo relatório no chat** durante orquestração com subagentes tem o cabeçalho **"Orquestrando com
     otimização do uso de tokens"**.
   - **Subagentes sem leitura de contexto em duplicidade:**
     - fatias pequenas por agente, geradas por script;
     - brief comum num arquivo, citado e não repetido;
     - saídas longas em arquivo, com só o resumo devolvido;
     - referência comum em versão compacta;
     - conferência determinística antes de qualquer agente verificador.
   - Relatório ao dono a cada 50 minutos: tarefas em termos da área hospitalar, % e tempo de cada uma,
     completude e previsão geral.
   - **Regras padrão de economia sem perda de qualidade** (dono, 2026-11-20; detalhe nas regras 15 a 19 do
     protocolo):
     1. **Sessão contínua do orquestrador (dono, 2026-11-23, troca a regra dos 150 turnos).**
        - Começa pela `docs/obra/passagens/RETOMADA.md` e pelo `docs/ESTADO.md`.
        - A sessão segue até o dono mandar recomeçar em outro chat. O orquestrador **não** pede chat novo por número
          de turnos: o Claude Code resume o contexto sozinho, e o ganho medido de recomeçar a cada 150 turnos era de
          5 a 8% do gasto total (cerca de 1 M a cada 2 horas), contra o custo de o dono abrir chat de madrugada.
        - A passagem continua gravada e com commit a cada bloco fechado, para o caso de recomeço.
     2. **Poucos turnos do orquestrador:**
        - uma verificação é um script com saída compacta;
        - status só no relatório de 50 minutos;
        - nunca carregue no chat um arquivo grande de resultados ou achados: filtre por script.
     3. **Prefixo comum idêntico nos prompts dos subagentes.** O brief vai colado **no início** do prompt,
        palavra por palavra igual para todos, e a parte variável no **fim**. Assim os agentes reaproveitam o
        mesmo prefixo pelo cache.
     4. **Fatia autossuficiente e autoconferência em um comando:**
        - a fatia já traz o que o agente precisaria buscar, como os campos dos contratos extraídos por script;
        - a autoconferência é um único comando que devolve "ok" ou a lista de erros;
        - o agente gera a saída com um script numa chamada só;
        - antes de lançar a rodada, o orquestrador confere 2 ou 3 fatias.
     5. **Reprocessar só o que mudou.** A correção vai só ao lote afetado, e o validador global roda sempre
        sobre tudo.
     - **Mantidos sempre**, porque são a qualidade: conferência determinística por script, verificação
       adversarial, amostra conferida no início da rodada e conferência final independente.
     - **Modelo:** todos os agentes usam o modelo da sessão. Não se troca por modelo mais leve (decisão do
       dono).

## Orquestração com orçamento: obrigatória e com travas (dono, 2026-11-21)

Esta é uma ordem do dono, dada depois do gasto de cerca de 1,4 bilhão de tokens equivalentes em 21/11/2026, dos
quais de 600 a 700 milhões eram evitáveis.

- **Vale para toda sessão e todo agente.**
- **Plano completo:** [`docs/obra/plano-orquestracao.md`](docs/obra/plano-orquestracao.md). Em caso de
  conflito, ele **prevalece** sobre o protocolo.

### Travas técnicas

O guardião `tools/obra/guardiao.py` é um gancho do `.claude/settings.json` que **recusa** o que estiver fora do
plano:

| Regra | Recusa quando |
|---|---|
| **G1** | Um Workflow não declara `// ORCAMENTO: <id>`, ou não existe `docs/obra/orcamentos/<id>.md` com `estimativa_M` e `teto_M` |
| **G2** | Uma chamada de subagente não começa pelo `PREFIXO` idêntico (cache compartilhado) |
| **G3** | O script não tem `LIMITE_AGENTES` e o invólucro `chamar(...)`, ou chama `agent(` direto |
| **G4** | O `PREFIXO` não traz o brief da tarefa nem as regras de economia |
| **G5** | Um subagente avulso não traz `ORCAMENTO: <id>` válido (os tipos só de leitura Explore, claude-code-guide e web-fetch passam) |
| **G6** | Um subagente passa de 60 ferramentas: recebe aviso para fechar (gravar o que fez e devolver a lista do que falta); a partir de 80, só a devolução do resultado passa. O orquestrador não é contado. `tools/obra/teto_turnos.py`, autorizada pelo dono em 2026-11-21 |

**Proibido contornar o guardião:**
- desligar o gancho;
- editar `.claude/settings.json`;
- renomear arquivos;
- lançar trabalho por outro caminho.

Mudar o guardião ou o plano só com pedido explícito do dono.

### Regras do plano

1. **Orçamento antes de lançar.**
   - É análise do **orquestrador**: o dono não aprova orçamento (decisão de 2026-11-21).
   - A estimativa sai da tabela da seção 6 do plano, e o teto fica 30% acima dela.
   - Ao passar do teto, o orquestrador para, analisa a causa, otimiza e só depois segue.
   - Ao fechar, registra em `consumo.md` o que foi estimado e o que foi gasto.
2. **Cache.**
   - O `PREFIXO` é idêntico byte a byte em todos os agentes, com o brief colado nele. A parte que varia vai no
     fim.
   - Agentes do mesmo papel são lançados juntos, porque o cache expira em 5 minutos.
   - Nunca usar fork.
3. **Leitura mínima.**
   - A fatia é gerada por script e já traz os trechos necessários.
   - O construtor segue um roteiro fixo:
     - lê tudo num comando só;
     - grava o resultado com 1 a 3 scripts;
     - meta de 15 a 40 turnos, teto de 100.
   - O revisor lê só o diff.
   - O corretor recebe só os achados.
   - O orquestrador lê só resumos gerados por script.
4. **Ordem de toda rodada.**
   1. Mudança compartilhada primeiro, por um agente só, em sequência.
   2. Fatias uma vez só, com o verificador de completude ativo.
   3. Conferência enxuta, com no máximo uma volta de correção.
   4. Lotes de até cerca de 15 arquivos.
5. **A qualidade não se troca por economia.**
   - Revisão adversarial, verificação por script e conferência final independente são mantidas sempre.
   - Se a qualidade cair, a regra de economia que causou a queda é desfeita.
6. **Relatório de 50 minutos com a seção Economia:**
   - gasto contra o orçamento;
   - custo por papel;
   - percentual em relação à linha de base;
   - efeito na qualidade.

## Produto, não projeto de um cliente (ADR 0002)

- Nada é engessado para a Rede Santé. Ela é **um cliente**. A única exceção é a identidade visual, por
  configuração.
- **Fases F3, F7 e F8 são só ordem de construção.** Todo recurso fica disponível, e nada é bloqueado por
  cliente.
- **O administrador da plataforma pode tudo.**
- A virada é **operacional** e decidida pelo cliente: o sistema dá ferramentas, alertas e relatórios, sem
  travas automáticas.
- **Sem S3 (ADR 0004, dono, 2026-11-21).**
  - Todo arquivo fica no disco da máquina que hospeda o sistema: a EC2 da hospedagem ou a máquina local do cliente.
  - O acesso é pela porta de armazenamento de arquivos, com imutabilidade e retenção garantidas pelo sistema.
  - Nada de S3, nem na AWS nem compatível.
- **Um banco por cliente,** criado pelo comando "criar novo cliente". A Rede Santé usa o mesmo comando, e o
  conector importa e limpa o SPDATA.
- **Melhor prática, não o SPDATA.** Chaves e obrigatoriedades vão no banco (PK, FK, NOT NULL, UNIQUE,
  CHECK). Onde o MV traz mais, segue-se o MV, com estrutura própria.
- **Convenções do DDL:** [ADR 0002, parte 2](docs/adr/0002-decisoes-do-dono-e-principios-do-modelo.md).

## O projeto é independente do `new-sgh`

- As regras do `new-sgh` (coexistência no Firebird, "não existe banco novo", teste de assinatura, tabelas
  `SGH_` no legado) **não valem aqui**.
- O `new-sgh` é **fonte de código**, só para leitura: nunca edite, faça commit nem rode a obra dele a
  partir desta pasta.
- **O que vem do `new-sgh`:** domínios, contratos, UI, API, web, worker, testes e verificadores, a partir
  de um commit de partida registrado no `ESTADO.md`.
- **O que não vem:** o `packages/legado`. Vem só o núcleo de infraestrutura que mora nele, extraído para
  `packages/nucleo` (F2.1).
- **Correções feitas lá** depois do commit de partida são avaliadas pelo relatório mensal e trazidas ou
  recusadas, com registro.

## Regras de ouro

### 1. Modelo próprio: nada do SPDATA nem do MV no nome

- Tabelas, colunas, descritivos, código e telas usam **nomes de negócio em português**, `snake_case` no
  banco.
- **Proibido** usar nome de tabela, coluna ou descritivo do SPDATA ou do MV, e qualquer menção a "MV",
  "Soul", "MV2000", "SPDATA" no modelo, no código ou nas telas. O verificador de nomes proibidos roda na
  esteira.
- **Uso permitido das duas origens:** o MV serve **só como referência de recursos** (o que um hospital
  precisa). O SPDATA é **a base de dados** de onde a Rede Santé migra. A estrutura dos dois nunca é
  molde.
- Onde os nomes do MV e do SPDATA podem aparecer:
  - em `docs/analise/` e `referencias/`, como evidência interna;
  - no mapa do conector, como origem.
- O modelo **não se deforma para facilitar a migração.** A diferença que sobrar é do conector.

### 2. Regra de negócio no domínio, nunca no banco

- **Nenhum gatilho com regra de negócio** no MariaDB (verificador na esteira).
- As regras que o SPDATA tinha em gatilhos e procedures são **lidas no PSQL** e escritas no domínio, com
  teste.
- Cada operação de gravação tem **contrato de efeito**: o que deixa no banco, em teste automatizado.
- O contrato de uma operação que existe no SPDATA **deriva da captura de assinatura** (do `new-sgh` ou
  nova). Divergência intencional fica registrada, com o motivo.

### 3. Fronteiras

- `packages/dominio-*` não importam banco nem infraestrutura de I/O.
- **Só o `packages/persistencia`** fala com o MariaDB.
- **Só o `conector/`** fala com o Firebird, e só lê.
- Portas e contratos usam **vocabulário neutro:** booleano, data, id, número de negócio. Nada de S/N, HHMM
  ou sentinelas.

### 4. O SPDATA nunca é alterado

- O conector **nunca grava na origem.** Ele lê de dois jeitos:
  - **imagens:** cópias restauradas em container sem rede de saída e em somente leitura;
  - **leitura direta do servidor Firebird do hospital** (decisão do dono, 24/11/2026,
    [ADR 0010](docs/adr/0010-leitura-direta-do-servidor-firebird.md)): usuário só leitura (role só com `SELECT`)
    e uma transação somente leitura (`SNAPSHOT` + `READ`) por execução. Em dev, simulada por
    `infra/firebird-simulado/`.
- As cópias compartilhadas do `banco-dev` (`redesante-fb-pc`, `redesante-fb-pc2`) e o `sante-firebird`
  não são alterados nem parados por este projeto.

### 5. Dados reais

- Imagens do SPDATA e o dump do MV têm **dados reais de pessoas**.
- Nada sai das cópias para código, testes, logs, commits, documentos ou chat, a não ser **contagens e
  agregados**.
- Do dump do MV, use **só metadados** (dicionário: tabelas, colunas, comentários). Nunca leia conteúdo de
  linhas.
- Pendências e logs do conector registram tabela, chave original e regra violada, **nunca valores**.
- **Sem vetorização no conector** (ADR 0002). A busca vetorial é recurso do produto, nunca aplicada a texto clínico sem decisão registrada.
- **Homologação com dados reais** só depois dos quatro pré-requisitos de LGPD da F5.1.
  - **Exceção (dono, 2026-11-21):** o dono navega no painel desta VM com a carga completa da ProntoCardio num
    cliente de teste.
    - O ambiente é privado, e o dono tem as credenciais de segurança máxima dos hospitais.
    - Os dados ficam só no MariaDB local (loopback).
    - Chat, e-mail, commit e log continuam só com contagens e agregados.

### 6. Nenhuma mensagem externa fora de produção

- Desenvolvimento e homologação ficam **neutralizados:**
  - e-mail para captura local;
  - WhatsApp e SMS desligados;
  - TISS e laboratório para destinos falsos;
  - sem rede de saída.
- O envio para fora só existe com a chave de ambiente de produção.
- **Exceção: aviso da obra ao dono** (decisão do dono, 2026-11-21).
  - O `.env` tem credenciais do Amazon SES (`AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`), para enviar
    a partir de `noreply@hal-ai.com`.
  - Envie só por `python3 -I tools/obra/avisar_dono.py --assunto ... --texto ...`.
  - O destino é só o dono: avisos de marco e de "pronto para navegar". O produto não usa esse canal.
  - O conteúdo leva só contagens e agregados (regra 5). Nunca imprima nem copie as credenciais.
  - Teste de envio feito em 2026-11-21, aceito pelo SES.

### 7. Catálogos

- Dados públicos (TUSS, SIGTAP, CID-10, CBO, IBGE, CNES, terminologias TISS) vêm **das fontes oficiais**,
  por carregador versionado. Nunca do dump do MV nem do SPDATA.
- **Licenciados** (Simpro, Brasíndice, CBHPM, CEP dos Correios) fazem parte do **espelho padrão da base**
  (ADR 0006, dono, 2026-11-21).
  - Carregador versionado por edição, mantido pela plataforma.
  - Todo cliente, inclusive o novo, recebe o espelho.
  - Nunca entram pelo conector: o conector só liga as referências do hospital pelo código e pela edição.
  - A licença é condição comercial.
- **Importação é continuidade (ADR 0006, dono, 2026-11-21).** Tudo que o hospital usa entra vivo e utilizável. Não
  existe arquivo morto.
  - **Catálogo da origem:** entra ligado ao catálogo oficial pelo código. Os itens próprios do hospital entram
    ativos.
  - **Licenciado padrão:** vem do espelho padrão da base, nunca do conector. Preço próprio do hospital entra pelo
    conector.
  - **Rascunho clínico:** volta como rascunho ao autor, que pode finalizá-lo ou apagá-lo.
  - **Não copiar uma tabela** só vale com prova, pela conciliação, de que a informação continua disponível. Nunca
    por julgamento do agente.

### 8. Segredos e ambiente

- O `.env` desta pasta tem segredos (Oracle, AWS). **Nunca imprima valores**, nunca copie para outro
  arquivo e nunca faça commit dele.
- O `.env` também guarda uma cópia do token do GitHub (variável `GITHUB`). Regras na seção
  [Git deste projeto](#git-deste-projeto).
- Credenciais de integração vão para o cofre de segredos, nunca para o banco nem para o código.
- Só loopback para bancos e serviços de desenvolvimento. Nada é instalado globalmente na VM: use
  containers e ferramentas do repositório.

### 9. Git e ações irreversíveis

- **Commit e push nesta pasta: o agente sempre faz** (autorização permanente do dono, 2026-11-20).
  - Feita uma alteração pronta, o agente faz o commit e o push para o `origin` sem perguntar.
  - Antes, confere que nada de `.env`, `dump/` ou dado de pessoa está entrando.
  - Não vale para o `new-sgh` nem para outros repositórios.
  - Não inclui `push --force`, reescrita de histórico nem apagar branch remota, que continuam
    precisando de autorização.
- **Push só sem falha, e sempre push (dono, 2026-11-23).** É proibido subir com falha e é proibido deixar de subir.
  - Antes de todo push, a esteira inteira passa na VM: `flock sante-sgh-dados/obra/pesado.lock
    tools/obra/ci-sim.sh <commit>` (worktree limpo, sem `.env`, os mesmos passos do `ci.yml`) termina em
    `RESULTADO: VERDE`. Commit que não passa fica local até ser reparado.
  - Toda falha da esteira do GitHub é reparada na causa, sem afrouxar teste, trava nem verificador.
  - Nunca fazer push com rodada de agentes aberta na mesma árvore (o push leva os commits pela metade).
- As demais ações irreversíveis ou externas (enviar e-mail, publicar, apagar volume ou imagem)
  continuam **só com autorização do dono**.
- Antes de apagar ou sobrescrever, olhe o alvo.

### 10. Provar antes de dizer pronto

- Um marco só fecha com a prova pedida na ficha: teste, relatório, medição.
- Use os números medidos e registrados. Não invente números.
- Relate falhas como são.

## Mapa da pasta

| Caminho | O que é |
|---|---|
| `AGENTS.md` | Estas instruções |
| `docs/ESTADO.md` | Estado da obra |
| `docs/adr/` | Decisões de arquitetura (0001 em diante) |
| `docs/fases/` | Roteiro de construção, F0 a F8 |
| `docs/analise/` | Matriz funcional MV × SPDATA × `new-sgh` (uso interno) |
| `referencias/` | Metadados de referência, como `mv-tabelas.tsv` (uso interno) |
| `docker-compose.yml`, `dump/`, `scripts/` | Oracle de referência com o dump do MV (só metadados interessam) |
| A criar na F0 | `apps/`, `packages/`, `db/migracoes/`, `catalogos/`, `conector/`, `tools/` |

## Ambiente nesta VM

- **Oracle de referência:** container `sante-sgh-oracle`, `127.0.0.1:1521/FREEPDB1`, senha em
  `.env` (`ORACLE_SENHA`). Detalhes no `README.md`.
- **Cópias do SPDATA para desenvolvimento:** a matriz fica em `../banco-dev/backups/` e não pode ser
  aberta direto. O conector usa um container próprio restaurado dela (F0.5).
- **Disco (pedido do dono, 2026-11-20):** a VM tinha cerca de 146 GB livres em 20/11.
  - Em tarefa longa, deixe rodando `tools/obra/vigia-disco.sh 130` em segundo plano. Ele avisa abaixo de 130 GB.
  - Abaixo de 100 GB, pare o que for pesado e avise o dono.
  - Antes de baixar, importar ou instalar algo grande (imagem, dump, `node_modules`, carga de catálogo), estime o tamanho.
  - Apague temporários assim que deixarem de servir.
- **Gestão do MariaDB pelo browser (dono, 2026-11-21):** Adminer atrás de Caddy com HTTPS em `https://192.168.1.75:5320 (o IP muda por DHCP: confira com `ip -4 addr show ens33`)`.
  - Publicado na rede local, por pedido do dono. É exceção à regra 8 ("só loopback"); o MariaDB continua só no
    loopback.
  - Usuário `dono_leitura`, somente leitura. A senha está em `MARIADB_GESTAO_SENHA` no `.env`.
  - Configuração em `infra/gestao/` (`docker compose up -d` na pasta).
  - **Tela do Mailpit** (captura de e-mail do desenvolvimento, pedido do dono, 2026-11-24) em `https://<IP>:5325`,
    no mesmo Caddy, só leitura e **com senha** (basic_auth): usuário `MAILPIT_GESTAO_USUARIO`, senha
    `MAILPIT_GESTAO_SENHA` no `.env`; o Caddy recebe só o resumo bcrypt (`MAILPIT_GESTAO_HASH`). A captura traz links de
    recuperação e códigos de acesso. Subir com `docker compose --env-file ../../.env up -d --no-deps caddy`.
- **Containers comuns da VM** (Gotenberg, Mailpit e outros de outros projetos): não pare, não altere.

## Git deste projeto

Decidido em 2026-11-20.

### Repositórios e pastas

| Pasta local | Repositório no GitHub | Papel |
|---|---|---|
| `sante-sgh` (esta) | `mmalves-ai/sante-sgh-mariadb` | Produto atual, banco próprio. **É o foco.** |
| `new-sgh` (+ worktrees em `new-sgh-wt/`) | `mmalves-ai/sante-sgh` | Legado. Só fonte de código, para leitura. |

- O repositório `mmalves-ai/sante-sgh` **não** é deste projeto, apesar do nome. Ele ficou com o
  `new-sgh` por histórico.
- O nome `sante-sgh-mariadb` foi escolhido de propósito, para lembrar que o foco agora é o banco
  próprio.
- **As pastas locais não são renomeadas.** As cerca de 150 worktrees do `new-sgh` guardam caminho
  absoluto, e os `.md` dos dois lados citam "new-sgh" como pasta e "sante-sgh" como produto.

### Configuração desta pasta

- Remote `origin`: `https://github.com/mmalves-ai/sante-sgh-mariadb.git`. Branch principal: `main`.
- **Autenticação (desde 2026-11-20, por decisão do dono):** HTTPS com o token fine-grained
  **"Santé Segh Mariadb"**, que fica na variável `GITHUB` do `.env` desta pasta e tem a permissão
  Workflows.
  - O `.git/config` local tem um `credential.helper` próprio. Primeiro ele anula o `store` global,
    cujo token antigo não tem a permissão Workflows. Depois lê o `GITHUB` do `.env` no momento do
    push.
  - O valor nunca é copiado: não vai para o `.git/config`, a URL do remote, a saída dos comandos nem o
    chat.
  - `git push` e `git pull` funcionam direto.
  - Se trocar o token, troque só o `.env`.
  - Não use chave SSH: o dono não usa mais.
- **Fora do git, pelo `.gitignore`:**
  - `.env` e `.env.*`;
  - `dump/` e `*.dmp`, por ter dados reais e arquivos de GB;
  - `node_modules/`, `__pycache__/`, `.venv/` e `*.log`.
- O repositório é **privado**. `docs/analise/` e `referencias/` têm nomes do MV e do SPDATA como
  evidência interna (regra 1).
- Antes de qualquer `git add`, confira que nada de `.env`, `dump/` ou dado de pessoa está sendo
  versionado (regra 5).
- Primeiro commit: `6976210` (2026-11-20).

### Relação com o `new-sgh`

- Daqui, o git do `new-sgh` é **só consultado**: `git log`, `git ls-remote`, `git cherry`. Nada de
  fetch, commit, push ou mudança de branch. Qualquer ação lá é feita numa sessão aberta na própria
  pasta.
- Situação conferida em 2026-11-20:
  - `fase0` e `main` do GitHub estão no mesmo commit, `d3f8b5d`;
  - 17 branches locais `dev/crud-W*` e `marco/M21` têm commits fora da `fase0` e só existem na VM;
  - o backup ou o descarte delas é decisão do dono.
