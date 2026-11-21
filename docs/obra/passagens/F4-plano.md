# F4 — Plano do conector: painel de onboarding + motor de importação (2026-11-21)

Base: ADR 0001 (item 3), ADR 0002, ADR 0003 (itens 4–6), `docs/fases/F4-conector.md`, F0.5, F1.5. Medição:
`python3 -I tools/obra/medir_origem_fb.py meta|stats|resumo` (só metadados e o resumo do gstat; 1 min 32 s
sobre a cópia `redesante-fb-pc`, transação READ ONLY). Resultado por tabela: `docs/analise/origem-fb/volume-pc-20261019.tsv`.

## 1. O que o dono quer (correções de 21/11)
- **Onboarding genérico**, num **painel** da administração da plataforma (web, sessão de administrador da
  plataforma). Nada fixo para um cliente: sem nome, caminho ou de-para codificado por cliente. A ProntoCardio é
  só o primeiro uso.
- Fluxo por cliente: **Criar cliente** (a lógica do `tools/db/criar_cliente.py` vira serviço chamado pelo
  painel) → opcional **Vincular arquivo Firebird** (.fdb) → **Importar** (1ª vez) ou **Sincronizar**
  (diferencial), com progresso, pendências e conciliação na tela.
- Linha de comando só como ferramenta interna de teste do motor, nunca como fluxo do dono.
- Testes só com "cliente de exemplo" e imagem sintética; nunca dados reais.

## 2. Arquitetura
- **Painel** (`apps/web`, módulo `plataforma/onboarding`) + **rotas de administração da plataforma**
  (`apps/api`, módulo `plataforma-onboarding`, só sessão de administrador da plataforma):
  - `GET /plataforma/clientes`: lista com situação, origem vinculada, última execução (tipo, estado, %, fim) e
    pendências abertas;
  - `POST /plataforma/clientes`: cria (chama o serviço de criação de cliente);
  - `PUT /plataforma/clientes/:id/origem`: vincula o arquivo; valida (seção 3) e registra;
  - `POST /plataforma/clientes/:id/execucoes {tipo: importar|sincronizar}`: enfileira (409 se já há uma
    ativa para o cliente);
  - `GET .../execucoes/:eid`: progresso por etapa e entidade; `GET .../conciliacao` e `.../pendencias`
    (só agregados e chaves, sem valores).
- **Plataforma (banco `plataforma`, migração nova `db/plataforma/0003_*`):**
  - `cliente_origem`: cliente, tipo `firebird_arquivo`, caminho relativo à pasta autorizada, tamanho, sha256,
    cabeçalho (ODS, página), vinculado_em/por, ativo;
  - `conector_execucao`: cliente, tipo, estado (`fila|abrindo|lendo|gravando|conciliando|concluida|falhou|
    cancelada`), etapa, % e contadores, versão do mapa e do schema, hash da imagem, início e fim;
  - histórico em `cliente_evento` (`conector_vinculo`, `conector_carga`, `conector_diferencial`), na mesma
    transação da mudança de estado.
- **Motor** (`conector/`, Python 3 em container próprio `sante-sgh-conector`, sem rede de saída, só loopback para o
  MariaDB): um **worker** que retira execuções de `conector_execucao` (`SELECT ... FOR UPDATE SKIP LOCKED`).
  - **Trava por cliente:** índice único parcial por cliente ativo, mais o lock da fila. Uma execução por cliente.
  - **Paralelismo entre clientes:** `CONECTOR_MAX_PARALELO` (padrão 1 nesta VM, conforme CPU, RAM e disco
    livre). O worker recusa iniciar se o disco livre estimado após a carga ficar abaixo de 100 GB.
  - **Isolamento:** a execução recebe só o `banco_nome` do seu cliente, e o usuário MariaDB do motor é criado
    por execução com GRANT só em `cliente_<codigo>` e `conector_ctl_<codigo>`. Nunca grava em outro banco.
  - **Base de controle por cliente** `conector_ctl_<codigo>`: `conector_origem` (tabela, chave original,
    entidade e id de destino, hash xxh128, última imagem vista), `pendencia`, `conciliacao`, `imagem`.
- **Só o `conector/` fala com o Firebird** (regra 3). A API só lê a fila, o progresso e os agregados.

## 3. Abrir o .fdb sem alterar e sem copiar 48 GB
- **Provado hoje:** com o arquivo montado `:ro` num container descartável, o Firebird 3 recusa abrir
  (`no permission for read-write access`), porque o cabeçalho não está em modo read-only. Marcar
  `gfix -mode read_only` alteraria o arquivo, o que é proibido. O mtime e o tamanho continuaram iguais.
  Overlay do Docker também não serve: na abertura RDWR ele copia o arquivo inteiro para a camada de cima.
- **Escolha: snapshot de bloco copy-on-write.** Um container "abridor" descartável e privilegiado faz:
  - `losetup --read-only` sobre o .fdb;
  - um arquivo COW esparso, de 1 a 4 GB, num volume temporário da execução;
  - `dmsetup create ... snapshot` sobre os dois;
  - o Firebird 3.0.14 da execução, sem rede, abre o dispositivo `/dev/mapper/...` (base em dispositivo bruto).
  - Escritas de cabeçalho e TIP caem no COW. O original nunca é aberto para escrita: o kernel garante pelo
    loop read-only.
  - O motor conecta com transação READ ONLY. No fim, remove o snapshot e o COW.
  - Prova do lote L1: sha256 do arquivo antes e depois é igual; COW usado abaixo de 1 GB.
- **Plano B:** cópia integral para um volume temporário (exige +48 GB livres e reserva de 100 GB, conferidos
  antes), apagada no fim. **Contraria o ADR 0003 item 7**, por isso nunca é recuo automático: a falha do
  snapshot é erro (inclusive a da conferência de somente leitura). Só roda com pedido explícito (`modo copia`)
  e `CONECTOR_PLANO_B_AUTORIZADO=sim`, que só se liga com decisão do dono registrada para aquele ambiente ou
  cliente. **Pendente de decisão do dono** se o plano B deve existir.
- **Plano C, só no dev:** ler a cópia já restaurada `redesante-fb-pc` (127.0.0.1:3351), só com transação READ
  ONLY e sem parar nem alterar nada, como fez a medição.
- **Validação do caminho:**
  - só arquivos dentro de `CONECTOR_ORIGENS_DIR` (no dev, `../banco-dev/backups`, montado `:ro`);
  - `realpath` dentro da raiz, arquivo regular, sem symlink, extensão `.fdb`, dono legível;
  - cabeçalho lido pelos primeiros bytes (ODS 12, página 8192) antes de aceitar;
  - sha256 e tamanho registrados em `cliente_origem` e na `imagem` (horário de corte = mtime declarado);
  - o painel só lista o conteúdo da pasta autorizada; não aceita caminho livre.

## 4. Volume medido (imagem `pc-20261019`)
- **Dicionário:** 4.419 tabelas, 1.524 com registros, **195,75 M registros**.
  - 34,7 GB em páginas de dados, mais 14,8 GB em blobs, num arquivo de 48 GB.
  - 2.612 generators, 2.538 triggers, 181 procedures.
- **Mapa F1.5 sobre as tabelas com dados:**

  | Destino | Tabelas | Registros |
  |---|---:|---:|
  | TABELA | 1.403 | 165,1 M |
  | NAO (descarte) | 58 | 25,3 M, entre eles `PRMAQUINABUSCA` (24,7 M) |
  | MECANISMO | 42 | 5,0 M |
  | sem mapa | 21 | 0,48 M |

  As 21 sem mapa são todas `SGH_*`, tabelas do new-sgh na cópia neutralizada: descartar. O arquivo
  original não deve tê-las; conferir no L1.
- **Faixas:**

  | Registros por tabela | Tabelas | Registros |
  |---|---:|---:|
  | ≥ 10 M | 4 | 89,0 M |
  | 1 M a 10 M | 29 | 79,6 M |
  | 100 mil a 1 M | 63 | 23,8 M |
  | < 100 mil | 1.428 | 3,4 M |

- **Top:**

  | Tabela | Registros | Observação |
  |---|---:|---|
  | `TBCABTRILHA` | 32,9 M | auditoria |
  | `PRMAQUINABUSCA` | 24,7 M | descarte |
  | `TBLANTRILHASGH` | 17,1 M | sem PK |
  | `PREVOLPAC` | 14,2 M | 2,1 GB de blob |
  | `PREVOLPACTMP` | 7,5 M | |
  | `PRCHKGERAL` | 6,3 M | |
  | `TBVLRMEM` | 6,2 M | |
  | `FCLANEXT` | 4,3 M | |
  | `SIRES01` | 3,6 M | |
  | `GELANSAI` | 3,6 M | |
  | `PRASSINATURA_DOC` | 1,4 M | 4,7 GB de blob |

- **Entidades do lote ponta a ponta:**

  | Tabela | Registros | PK | Data de alteração |
  |---|---:|---|---|
  | `TBHOSPIT` | 1 | — | — |
  | `TBTPEMP` | 2 | — | — |
  | `RICADPAC` | 47.063 | inteira | sim |
  | `ATCABECATEND` | 209.147 | inteira | sim |
  | `RECADATE` | 199.417 | inteira | sim |
  | `REALTA` | 782 | — | — |
  | `TBUSERS` | 1.087 | PK = NOME | — |

## 5. Disco
- **Estimativa central no MariaDB:**
  - linhas + índices: ~41 GB (registros × (comprimento médio do gstat × 1,1 + 30) / 0,75 × 1,5);
  - blobs: ~10 GB (prontuário assinado e anexos; no armazenamento de objetos ou no disco local);
  - `conector_origem`: ~20 a 25 GB (165 M linhas × ~140 B);
  - total: **~75 GB**, com faixa de 55 a 110 GB. O teto ingênuo, pelo comprimento descomprimido, é 237 GB e
    está superestimado pelo CHAR com espaços.
  - A carga roda com binlog desligado; o redo é temporário.
- **Hoje:** 142 GB livres em `/`. Depois da carga sobrariam ~65 GB, **abaixo do mínimo de 100/120 GB**. Não
  cabe sem liberar espaço.
- **Liberável:** nada foi apagado; tudo depende de decisão do dono.

  | O quê | Tamanho | Situação |
  |---|---:|---|
  | volume `sgh-ensaio-fb5-pc-dados` | 102 GB | container parado há 3 semanas |
  | `redesante-fb-pc2-data` | 48 GB | declarado temporário no README do banco-dev |
  | `sante-api_firebird_data` | 48 GB | |
  | imagens Docker sem uso | 15,5 GB | |
  | build cache | 2 GB | |
  | bancos `cliente_f22_o1..4` e `cliente_teste_*` | ~2,3 GB | |

- **Para provar o motor antes disso:** importação parcial por domínio, com o L1–L3 em ~3 GB.

## 6. Ordem de carga e diferencial
- **Ordem:**
  - o grafo de dependência vem das 6.848 FKs declaradas (625 tabelas com FK) mais as dependências do mapa;
  - ordenação topológica por entidade de destino; ciclos quebrados por carga em duas fases (insere sem a FK
    opcional e depois atualiza);
  - **usuários primeiro** (F4.4), depois estabelecimento, catálogos próprios, cadastros (paciente,
    profissional, convênio), movimento (atendimento, prescrição, estoque, conta) e por fim auditoria e
    histórico;
  - o verificador do mapa (F4.2) recusa ciclo não declarado.
- **Diferencial por tabela** (campo `estrategia` no mapa, gerado por script a partir do TSV):
  - **< 100 mil registros (1.428 tabelas, 3,4 M):** hash completo de cada linha sobre os bytes crus, comparado
    com `conector_origem`.
  - **PK inteira única e crescente (1.074 das mapeadas):** faixa nova (`ID > último`), mais margem de
    reabertura, mais hash por bloco de 10 mil IDs nas faixas antigas. Desce à linha só nos blocos alterados.
    Exclusão = id ausente no bloco.
  - **Com `DATA_HORA_ULTIMA_ATUALIZACAO` ou equivalente (41 mapeadas,** entre elas `RICADPAC`, `ATCABECATEND`,
    `RECADATE`, `FCLANEXT`, `GELANSAI`, `SILANEXA`): filtro por data como atalho. A confiabilidade da data é
    verificada antes; o hash por bloco continua periódico, porque trigger e carga manual podem não atualizar a
    data.
  - **PK composta ou não inteira (341) e sem PK (26, por exemplo `TBLANTRILHASGH` e `FCLANEXTSEQITEM`):** hash
    por bloco ordenado pela chave natural declarada no mapa. Sem chave: recarga inteira da tabela ou
    append-only verificado por contagem e hash de bloco.
  - **Generators (F4.7):** leitura no fim de cada execução para ajustar as sequências próprias.
  - A imagem nova de cada sincronização é outro arquivo vinculado (outro corte); o hash de bloco compara com
    o estado guardado em `conector_ctl`, não com a imagem anterior.

### 6.1 O que o Sincronizar garante (dono, 2026-11-21)

**Caso de uso:**
1. Carga inicial.
2. A equipe navega por dias, sem produção, e sugere correções.
3. O Sincronizar traz os dias que faltam **e as alterações em dados antigos**.

**O que o Sincronizar captura:**
- **Alteração só de coluna,** por exemplo a presença da consulta que passa a "S":
  - o hash da linha muda, e a linha é reaplicada no destino;
  - a data de alteração do Firebird nunca é a única prova, porque gatilho e carga manual podem não atualizá-la.
- **Linhas novas e linhas apagadas na origem.** O apagamento vira exclusão lógica no destino (`excluido_em`),
  com rastreio.
- **Linhas antigas alteradas,** em qualquer data. A comparação é feita contra o estado guardado da última
  execução, não por janela de datas.

**Correções sugeridas pela equipe na avaliação:**
- **Correção de regra de conversão** (de-para, limpeza, sentinela): vira regra no mapa do conector e vale em
  toda execução seguinte. É o caminho preferido.
- **Edição manual no banco novo durante a avaliação:** o motor detecta quando uma linha foi alterada no destino
  depois da última execução, pela `versao` e pelo `alterado_em` do próprio sistema.
  - Se a mesma linha também mudou na origem, ela vira **conflito**.
  - **Padrão: a origem vence** (dono, 2026-11-21). Durante a avaliação, o Firebird ainda é a produção.
  - A edição do destino fica guardada no conflito e aparece no painel, para conferência e, se for o caso, para
    reaplicar.
  - Nunca há sobrescrita silenciosa.

**Prova (lote L9):**
- duas imagens de teste do "cliente de exemplo", com alterações só de coluna, linhas novas, apagadas e
  antigas alteradas;
- uma edição manual no destino;
- conciliação 100% e conflito exibido.

## 7. Riscos
- **LGPD:**
  - dados reais passam só dentro do motor;
  - logs, pendências e conciliação só com tabela, chave original e regra;
  - o painel mostra agregados;
  - testes só com imagem sintética do "cliente de exemplo", gerada por script com DDL real e dados falsos;
  - homologação real só após os 4 pré-requisitos da F5.1.
- **Desempenho:**
  - ~195 M registros: com 20 a 50 mil linhas/s em `LOAD DATA`/`INSERT` em lote (meta a medir no L2), a
    carga leva de 1 h 10 min a 3 h;
  - o gstat leu tudo em 92 s;
  - FKs e índices secundários são criados ou ativados depois de cada domínio;
  - a leitura é por faixas de PK, em vários cursores.
- **Encoding:**
  - charset NONE com CP1252; leitura em bytes crus;
  - conversão CP1252 → utf8mb4 determinística, com teste de tabela de bytes 0x80–0x9F;
  - o hash é calculado antes da conversão.
- **Sentinelas:**
  - S/N, 'T'/'F', 0/1 viram booleano;
  - datas 1899-12-30, 1900-01-01 e 0001 viram NULL ou pendência;
  - hora em HHMM inteiro vira TIME;
  - CHAR com espaços vira trim;
  - tudo declarado por coluna no mapa F4.3; nenhum vai para a porta do domínio.
- **Chaves:**
  - `TBUSERS` tem PK = NOME (texto): o de-para de usuário vai para id próprio, com pendência de duplicidade;
  - 26 tabelas sem PK;
  - reaproveitamento de chave vira exclusão + inclusão + pendência crítica.
- **Arquivo:**
  - snapshot dm exige um container privilegiado restrito ao abridor; sem isso, o plano B pede 48 GB;
  - um arquivo truncado ou incompleto é barrado por cabeçalho, sha256 e alerta de exclusão em massa (ADR
    0002: alerta operado pelo cliente).
- **Concorrência:** duas abas ou dois administradores disparando ao mesmo tempo são resolvidos pela trava por
  cliente no banco, não pela tela.
- **Paralelo F2.2:** o L1 a L3 tocam `apps/api` e `apps/web` só em módulos novos (`plataforma-onboarding`), e só
  depois de a F2.2 liberar a árvore.

## 8. Lotes de construção (≤ 6 itens cada; brief comum + fatia por script)
- **L1 Abridor e leitura:**
  1. `conector/` esqueleto (pyproject, Dockerfile, container sem rede);
  2. abridor dm-snapshot com prova de sha256 igual antes e depois;
  3. validação de caminho e cabeçalho;
  4. leitor em bytes crus por faixa de PK, READ ONLY;
  5. registro da imagem (contagens por tabela e confronto com o gstat);
  6. gerador de imagem sintética do "cliente de exemplo".
- **L2 Fila, plataforma e motor:**
  1. `db/plataforma/0003` (`cliente_origem`, `conector_execucao`);
  2. worker com `SKIP LOCKED`, trava por cliente e limite de paralelo;
  3. `conector_ctl_<codigo>` com usuário de GRANT restrito;
  4. eventos em `cliente_evento`;
  5. guarda de disco (<100 GB recusa);
  6. CLI interna de teste.
- **L3 Painel mínimo e ponta a ponta:**
  1. rotas `plataforma-onboarding` (listar, criar, vincular, importar, progresso);
  2. telas web: lista de clientes com estado, novo cliente, vincular arquivo (lista da pasta autorizada),
     Importar e barra de progresso;
  3. criar cliente como serviço, reaproveitando `criar_cliente.py`;
  4. de-para `TBHOSPIT`/`TBTPEMP` → `estabelecimento`;
  5. `TBUSERS` → `usuario` e `RICADPAC` → `paciente` + `pessoa_fisica` + documento, endereço e telefone;
  6. `ATCABECATEND`/`RECADATE`/`REALTA` → `atendimento`, com conciliação por contagem e soma de controle,
     vista nas telas já religadas.
- **L4 Mapa declarativo e verificador:**
  1. gerar o mapa F4.2 do `mapa-spdata.tsv` e do TSV de volume (chave, estratégia, dependências);
  2. ordenação topológica e ciclos;
  3. verificador na esteira;
  4. de-para de valores com catálogos oficiais;
  5. regras de sentinela por coluna;
  6. pendências com propagação "pai pendente".
- **L5 a L8 Domínios em ondas,** por script, com fatias de cerca de 25 tabelas por agente:
  - cadastros e ADM;
  - PEP e assinatura (blobs em bytes originais com hash);
  - SADT e SUP;
  - FAT e restantes.
  - Cada onda traz conciliação, hash por bloco e medição de linhas por segundo.
- **L9 Sincronizar (diferencial):**
  1. estratégias da seção 6;
  2. inclusão, atualização e exclusão lógica com reativação;
  3. alerta de exclusão em massa;
  4. botão Sincronizar e histórico de execuções no painel;
  5. diferencial entre duas imagens, medido;
  6. generators e sequências (F4.7).
- **L10 Conciliação e relatório:** relatório por entidade em toda execução, com pendências abertas, críticas e
  resolvidas, e saídas externas = 0. Prova do portão F4: carga completa real com disco liberado.

## 9. Estado do L1 (2026-11-21): concluído, prova verde

Código em `conector/` (README lá). Autoconferência: `conector/conector.sh testes` (7 testes, imagem sintética
do cliente de exemplo, container privilegiado sem rede). Prova real: `conector/provar-l1-real.sh pc-20261019.fdb`.

- **Plano A funciona nesta VM:** `losetup --read-only` + `dmsetup snapshot` (não persistente, COW esparso no
  volume da execução) dentro do container `sante-sgh-conector` (`--privileged --network none`). O kernel
  carregou o alvo `snapshot` sozinho. Firebird 3.0.14 embarcado abre o `/dev/mapper/sscon-<execução>` como
  dispositivo bruto; `gfix -mode read_only` cai no COW. O plano B (cópia com guarda de disco) está
  implementado e testado na imagem sintética, mas **sem recuo automático** (correção pós-avaliação, 21/11):
  o padrão é `snapshot`, não há `auto`, e a cópia só roda com `--modo copia` e `CONECTOR_PLANO_B_AUTORIZADO=sim`
  (decisão do dono pendente).
- **Prova sobre `pc-20261019.fdb` (48 GB), só agregados:**
  - sha256, mtime e tamanho iguais antes e depois; sha256 confere com o `.sha256` lateral;
  - COW usado: 16 KiB (limite 2 GiB); banco read-only na abertura;
  - 3.756 tabelas, 195.277.217 registros por `COUNT(*)` em transação READ ONLY; 2.046 generators;
  - gstat (`-d -r`) no mesmo snapshot: 3.756 tabelas, 195.277.217 registros, **0 divergências**;
  - contra o TSV da medição (feito na cópia viva `redesante-fb-pc`): 3.754 tabelas iguais; 2 trilhas de
    auditoria com 18 registros a mais na cópia viva (gravadas depois da restauração), o que confirma que a
    medição de volume deve ser refeita sobre a imagem, não sobre a cópia em execução;
  - tempos: contagem 108 s, gstat 72 s, registro completo 180 s; prova inteira (2 × sha256 de 48 GB) 345 s.
- **Decisões de implementação:**
  - o gstat roda depois de fechar o leitor: o Firebird embarcado não divide o arquivo entre dois processos;
  - hash da linha em BLAKE2b-128 (biblioteca padrão), no lugar do xxh128 citado na seção 2, sobre os bytes
    crus com separação de tipo e tamanho;
  - CP1252: os 5 bytes sem caractere viram o controle C1 de mesmo código (conversão total e reversível);
  - a imagem sintética usa tabelas neutras `EX_*` com as formas da origem (PK inteira com lacunas, composta,
    sem PK, FK, CP1252 0x80–0x9F, CHAR preenchido, BLOB binário e de texto, sentinelas, generator); o L3
    acrescenta as tabelas do mapa na mesma especificação (`sintetica.py`).
- **Correções da avaliação do L1 (21/11):**
  - keyset (`ler_por_chave`) só sobre chave provada única e NOT NULL; recusava nada e pulava empates
    (EX_TRILHA: 70 de 150 linhas pelo keyset em `TEXTO`). Tabela sem chave única: `ler_tudo`, passada única
    no mesmo SNAPSHOT, com teste que exige total = `COUNT(*)`;
  - confronto com o gstat conta como divergência a tabela que só um dos lados vê; total do gstat soma todas.
- **Para o L2:** separar o abridor privilegiado do worker (hoje o comando inteiro roda privilegiado);
  limpeza de órfãos `sscon-*` após queda do container.

## 10. Estado do L2 (2026-11-21): concluído, prova verde

Código em `conector/` (README, seção "Fila, plataforma e motor"). Autoconferência: `conector/conector.sh testes`
(14 testes: 9 do L1 + 5 do L2, imagem sintética, banco de plataforma de teste `plataforma_teste_conector`, tudo
apagado no fim).

- **Migração `db/plataforma/0003_conector_fila.sql`** (`cliente_origem`, `conector_execucao`): idempotente
  (validador da plataforma, duas rodadas, 0 erros). **Aplicada no banco `plataforma` real** (127.0.0.1:3410) duas
  vezes e conferida: 2 tabelas, 18 e 24 colunas, 3 e 7 CHECKs, 2 e 3 FKs, os dois índices únicos de trava; 0 linhas.
- **Trava por cliente** no banco (índice único sobre coluna gerada nos estados ativos; MariaDB não tem índice
  parcial): o segundo enfileirar do mesmo cliente dá 409; outro cliente segue livre; trocar a origem durante uma
  execução ativa é recusado.
- **Trabalhador:** `SKIP LOCKED` provado com outra sessão segurando a primeira execução; limite de paralelo por
  vagas `GET_LOCK` (o servidor solta se o processo cair); execução rodando sem trava viva vira `falhou`; snapshot
  `sscon-e<id>-<ficha>` órfão é desmontado no início do laço.
- **Isolamento provado:** o usuário da execução só vê `information_schema`, o banco do cliente e
  `conector_ctl_<codigo>`; leitura de outro cliente, da plataforma, de `mysql.user`, `CREATE DATABASE` e
  `CREATE USER` são recusados; o usuário é removido no fim.
- **Eventos:** `conector_vinculo`, `conector_carga` (fila → abrindo → lendo → gravando → conciliando → concluida)
  e `conector_diferencial`, cada um na transação da mudança de estado.
- **Guarda de disco:** recusa com `falhou` e motivo "guarda de disco" (provado com reserva inalcançável).
- **Ponta a ponta na sintética:** importar e sincronizar concluídos; contagem lida = gravada na base de controle =
  manifesto; banco somente leitura na abertura; sha256 do arquivo igual antes e depois.
- **Rede:** rede Docker interna `sante-sgh-conector-int` (`--internal`, sem saída; conferido: resolução externa
  falha); o `sante-sgh-mariadb` é ligado a ela com alias `mariadb`.
- **Correções da avaliação do L2 (2026-11-21):**
  - GRANT do usuário da execução com `_` escapado (no MariaDB o `_` era curinga e dava acesso a outro cliente) e
    banco obrigatoriamente `cliente_<codigo>`; teste com `ex_l2` × `exxl2`.
  - Prova do arquivo obrigatória: sem a variável `CONECTOR_SHA256`; sha256 + tamanho + mtime no início e no fim.
  - Conciliação contra fonte independente: gstat no mesmo snapshot × contagem gravada lida de volta (soma de
    controle por tabela); teste com leitura adulterada sai `falhou`.
  - Abridor separado do motor: abridor privilegiado sem rede e sem credencial; motor sem privilégio, com a conta
    restrita `sscon_motor_<ficha>` (nunca a root). Provado no teste e no `conector.sh worker` real (fila vazia).
  - Autoconferência: 16 testes (9 do L1 + 7 do L2), verdes.
- **Para o L3:** a carga das entidades, a conciliação contra o destino real por entidade, as rotas e as telas do
  painel. A conta do motor tem `CREATE USER` global (necessário para criar o usuário de cada execução); em
  produção, avaliar conta própria por servidor de clientes.
