# Conector (F4)

Motor que lê a base Firebird de origem de um cliente e a traz para o banco próprio. Plano:
`docs/obra/passagens/F4-plano.md`. O fluxo do dono é o **painel da plataforma** (L3); a linha de comando
daqui é só ferramenta interna de teste.

## Regras que o código garante

- Só este pacote fala com o Firebird, e **só lê**: transação `SNAPSHOT READ ONLY`, banco marcado read-only
  no snapshot antes da abertura.
- **O arquivo apontado nunca é alterado nem copiado inteiro** (plano A): o abridor monta o original num loop
  `--read-only` (o kernel recusa escrita; conferido por `blockdev --getro`) e põe por cima um snapshot
  copy-on-write do device-mapper. O que o Firebird escreve (cabeçalho, `gfix -mode read_only`) cai num COW
  esparso no volume de trabalho da execução, apagado no fim.
- **Plano B** (host sem dm/loop): cópia integral para o volume de trabalho. Contraria o ADR 0003 item 7, por
  isso **nunca é recuo automático** (não existe `--modo auto`; a falha do snapshot, inclusive da conferência
  de somente leitura, é erro). Só roda com `--modo copia` **e** `CONECTOR_PLANO_B_AUTORIZADO=sim`, decisão do
  dono registrada para o ambiente, e só se o disco livre depois da cópia continuar >= `CONECTOR_RESERVA_GB`
  (padrão 100); apagada no fim.
- **Leitura:** faixa de PK inteira; keyset só sobre chave provada única e NOT NULL (PK ou índice único com
  colunas NOT NULL), senão recusa; tabela sem chave única é lida em passada única (`ler_tudo`), no mesmo
  SNAPSHOT. O confronto com o gstat conta como divergência também a tabela presente num só lado.
- **Pasta autorizada** `CONECTOR_ORIGENS_DIR` (padrão: `banco-dev/backups` da área de trabalho), montada
  somente leitura em `/origens`. Só caminho relativo, sem `..`, sem symlink, arquivo regular `.fdb`,
  cabeçalho Firebird ODS 12 e tamanho múltiplo da página.
- Container `sante-sgh-conector` com `--network none`, salvo os comandos da fila e do motor, que entram só na rede
  interna `sante-sgh-conector-int` (sem saída). `--privileged` só nos comandos que abrem o arquivo.
- **Trabalhador separado** (`conector.sh worker` → `separado.py`): o **abridor** (`servico_abridor.py`) é o único
  processo privilegiado e roda numa rede vazia (`unshare --net`, só `lo`) e sem credencial no ambiente; atende por
  soquete Unix 0600 (par conferido por SO_PEERCRED), revalida o caminho, monta o snapshot e entrega o dispositivo ao
  usuário do motor. O **motor** roda sem privilégio (`setpriv`: uid do usuário, sem capacidades, `no_new_privs`), é
  o único com rede e usa a conta restrita `sscon_motor_<ficha>` (DML na plataforma, `CREATE USER` e, com GRANT
  OPTION, só os padrões `cliente\_%` e `conector\_ctl\_%`, sem DROP), criada/renovada a cada partida por
  `conta-motor` num container sem privilégio, com senha aleatória nova. O worker nunca recebe a senha root.
- Saídas só com metadados, contagens e hashes. Texto sai em bytes crus (`CAST ... CHARACTER SET OCTETS`);
  o hash da linha (BLAKE2b-128) é sobre os bytes crus, antes da conversão CP1252 → Unicode (`texto.py`).

## Uso interno

```bash
conector/conector.sh testes                       # autoconferência L1+L2 sobre a imagem sintética (ok ou erros)
conector/conector.sh listar                       # .fdb da pasta autorizada, com aceite e motivo
conector/conector.sh validar pc-AAAAMMDD.fdb
conector/conector.sh registrar pc-AAAAMMDD.fdb --saida /saida/registro.json   # contagens + gstat
conector/conector.sh sintetica /saida/exemplo.fdb # imagem sintética do "cliente de exemplo"
conector/provar-l1-real.sh pc-AAAAMMDD.fdb        # prova: sha256/mtime antes e depois + contagens agregadas
```

Variáveis: `CONECTOR_ORIGENS_DIR`, `CONECTOR_SAIDA_DIR` (padrão `.tmp/conector`, fora do git),
`CONECTOR_COW_MB` (padrão 2048), `CONECTOR_RESERVA_GB` (padrão 100).

## Fila, plataforma e motor (L2)

- **Banco `plataforma`, migração `db/plataforma/0003_conector_fila.sql`:** `cliente_origem` (arquivo vinculado:
  caminho relativo, tamanho, sha256, cabeçalho; uma origem ativa por cliente) e `conector_execucao` (fila e
  histórico: tipo `importar|sincronizar`, estado `fila|abrindo|lendo|gravando|conciliando|concluida|falhou|cancelada`,
  etapa, %, contadores, sha256 da imagem). **Uma execução ativa por cliente** pelo índice único
  `uq_conector_execucao_cliente_ativo` (coluna gerada só nos estados ativos); o enfileirar devolve 409.
- **Eventos:** toda mudança de estado grava em `cliente_evento` na mesma transação (`conector_vinculo`,
  `conector_carga` para importar, `conector_diferencial` para sincronizar), só com ids, estados e contagens.
- **Trabalhador** (`trabalhador.py`): `CONECTOR_MAX_PARALELO` vagas (padrão 1) por trava nomeada `GET_LOCK`;
  retirada por `SELECT ... FOR UPDATE SKIP LOCKED`; trava nomeada por execução enquanto roda; execução rodando
  sem trava viva vira `falhou` (órfã), e snapshot `sscon-e<id>-<ficha>` sem dono é desmontado.
- **Isolamento:** base de controle `conector_ctl_<codigo>` (`imagem`, `imagem_tabela`, `conector_origem`,
  `pendencia`, `conciliacao`) e um usuário MariaDB **por execução** (`sscon_e<id>_<ficha>`, senha aleatória em
  memória, só do endereço do motor) com GRANT só no banco do cliente e na base de controle dele; removido no fim.
- **Guarda de disco** (`disco.py`): recusa (estado `falhou`) se o livre depois da carga estimada (tamanho da
  origem × 1,6 para importar, × 0,2 para sincronizar) ficar abaixo de `CONECTOR_RESERVA_GB` (100).
- **Motor** (`motor.py`, L2): confere tamanho e sha256 contra o vínculo, abre por snapshot, conta as tabelas em
  READ ONLY com progresso, grava a imagem pela conta restrita, concilia e confere o sha256 depois. A carga das
  entidades entra no L3.
- **Rede:** os comandos da fila e o trabalhador rodam só na rede Docker interna `sante-sgh-conector-int`
  (`--internal`, sem saída); o `conector.sh` liga o `sante-sgh-mariadb` a ela (alias `mariadb`) se preciso.

```bash
conector/conector.sh vincular <codigo> <relativo.fdb>      # origem ativa do cliente
conector/conector.sh enfileirar <codigo> importar          # 409 se já há execução ativa
conector/conector.sh worker --uma                          # processa no máximo uma
conector/conector.sh execucao <id> | fila | cancelar <id>
```

Variáveis L2: `CONECTOR_PLATAFORMA_BANCO` (padrão `plataforma`; os testes usam `plataforma_teste_conector`),
`CONECTOR_MAX_PARALELO`, `CONECTOR_FATOR_DISCO_IMPORTAR`,
`CONECTOR_FATOR_DISCO_SINCRONIZAR`.

## Módulos

| Módulo | Papel |
|---|---|
| `caminho.py` | pasta autorizada, validação de caminho e cabeçalho, lista para o painel, sha256 |
| `abridor.py` | snapshot dm (plano A) e cópia com guarda de disco (plano B), sempre com limpeza |
| `leitor.py` | catálogo, contagem, leitura por faixa de PK inteira e por keyset, hash de linha e de bloco |
| `imagem.py` | registro da imagem (contagens por tabela, corte = mtime) e confronto com o gstat |
| `texto.py` | CP1252 → Unicode determinístico (0x81/0x8D/0x8F/0x90/0x9D viram o controle C1) |
| `sintetica.py` | gerador da imagem sintética do cliente de exemplo (dados falsos, semente fixa) |
| `banco.py` | conexão com o MariaDB (rede interna), nomes seguros, ficha da plataforma |
| `plataforma.py` | vincular origem, enfileirar, transições de estado com evento, progresso, cancelar |
| `controle.py` | base `conector_ctl_<codigo>` e usuário restrito por execução |
| `disco.py` | guarda de disco (< 100 GB depois da carga recusa) |
| `trabalhador.py` | vagas, `SKIP LOCKED`, travas, órfãs e snapshots órfãos |
| `motor.py` | uma execução de `abrindo` a `concluida`/`falhou` |
| `cli.py` | ferramenta interna de teste |
- **Prova do arquivo, obrigatória:** sha256 no início (igual ao do vínculo) e no fim, mais tamanho e mtime; não há
  variável que a desligue. Sem prova, a execução não termina `concluida`.
- **Conciliação da imagem com fonte independente:** o gstat roda no mesmo snapshot (leitor fechado) e a contagem
  gravada na base de controle, lida de volta, é comparada com ele tabela a tabela (soma de controle sha256 da lista
  `tabela=registros`). Contagem errada na leitura sai `conferido=0` e a execução `falhou`. Do L3 em diante a
  conciliação passa a ser contra o destino real, por entidade.
- **GRANT sem curinga:** o `_` do nome do banco é escapado (`cliente\_a\_b`), e o banco tem de ser
  `cliente_<codigo>`; o teste prova que o usuário de `ex_l2` não alcança `exxl2`.

## Carga das entidades e painel (L3)

- `carga.py`: mapa `l3-2026-11-21` (só as colunas listadas são lidas; credenciais nunca). Estabelecimento, usuários,
  pacientes (pessoa física, documento, endereço, telefones) e atendimentos (fichas e altas), no mesmo snapshot,
  pelo usuário restrito da execução. Conciliação por entidade: lidos = gravados (relidos do destino) + recusados, e
  soma de controle da origem = a do destino; divergência faz a execução falhar.
- `sintetica.py --mapa`: acrescenta as tabelas com a forma da origem do mapa, com anomalias anotadas no manifesto
  (`esperado_destino`).
- O painel (`/plataforma/clientes`) chama `criar_cliente.py --json` e `conector.sh listar|vincular --admin`; o
  enfileirar é da API. Prova: `apps/api/src/modulos/plataforma-onboarding/ponta-a-ponta.int.spec.ts`.

## Agenda estruturada a partir do texto (ADR 0009)

- **Mapa:** `REAGENDA.ID` e `SIAGENDA.ID` → `agenda_servico.codigo_origem`; `REAGENDA.PERINI/PERFIN` →
  `agenda_servico.vigencia_inicio/fim`; `TBCONVEN.PERMITE_ATEND` → `fonte_pagadora.codigo_permissao_atendimento`;
  `fonte_pagadora.credencia_todos_ao_criar` ligado no cliente importado (decisão 26). As observações da agenda entram
  sem corte (MEDIUMTEXT).
- **Extrator** (`sante_conector/estrutura_agenda.py`, funções puras, versão `conector-1`): os formatos da seção 2 da
  resposta do agente de marcação (valor particular, convênio aceito ou recusado, subplano, convênio com condição,
  preparo, restrições) viram regras **estimadas** (já valem). Cada trecho fica em `trecho_texto_agenda`, e o não
  interpretado leva o motivo e continua valendo pelo texto.
- **Gravação** (`sante_conector/estruturar.py`): o motor a chama depois da carga do mapa, em toda execução, sobre as
  agendas migradas. O texto inteiro fica em `texto_origem_agenda`, com o hash.
  - Subplano citado vira `plano_fonte_pagadora` dentro do convênio.
  - **Sincronizar:** quando o hash muda, as estimadas daquele texto saem (exclusão lógica) e o texto é extraído de
    novo. As confirmadas ficam (`confirmadas_a_rever`) e não ganham estimada repetida.
  - O resumo só traz contagens, em `contadores.agenda_estruturada`.
- **Prova:** `conector/testes/test_estrutura_agenda.py`, com textos sintéticos e as perguntas de aceite num banco
  descartável.

## Continuar uma importação interrompida (rodada retomar-importacao, 2026-11-23)

- **Pedido:** `conector.sh enfileirar <cliente> importar --continuar` (no código: `plataforma.enfileirar(conn, codigo,
  "importar", continuar=True)`). Aceito só se a ÚLTIMA importação do cliente terminou em `falhou` (interrompida) e com
  a mesma origem vinculada; a execução nova leva `contadores.continuar_de`. Ao subir, o worker marca a execução órfã
  como `falhou` **continuável**: etapa `interrompida: <etapa em que parou>` e `contadores.interrompida`.
- **O que o motor faz** (`continuar.py`): confere o mesmo arquivo (sha256 da imagem gravada pela interrompida), conta,
  confronta com o gstat e grava a imagem como sempre, refaz a carga própria do L3 (pula pelo hash), e na carga pelo
  mapa pula as tabelas concluídas; a tabela do meio e as seguintes rodam normalmente (linha já vista pulada pelo hash,
  nunca regravada). CONECTOR_ADIAR e CONECTOR_SO valem como sempre. As pendências abertas da interrompida nas tabelas
  puladas são repetidas, e o estado da conciliação delas vem do conector_origem (nunca da origem).
- **Tabelas concluídas:** pela marca `conector_tabela_concluida` (gravada a cada onda commitada; a continuação marca as
  puladas como `continuada`); sem marca (execução anterior a esta versão), por dedução: a imagem da interrompida
  registrou n > 0 linhas da tabela, a contagem de agora também é n, e o conector_origem tem exatamente n chaves
  principais da tabela com a imagem da interrompida. Nas duas regras, tabela com mais chaves principais (de qualquer
  imagem) que linhas no arquivo roda de novo. O resto roda de novo (seguro: pula pelo hash).
- **Fase 2:** tabela com coluna em duas fases (autorreferência, ciclo declarado) nunca é pulada: a referência adiada
  vive só na memória até o `_fase2`. Ela roda de novo, e na linha "igual" cuja coluna ficou NULL no destino a
  referência é refeita da linha lida e gravada só se a coluna continuar NULL (vale também para importar de novo).
- **Cadeia:** continuação que falhou cedo (sem imagem, ou antes de marcar o que herdou) não perde a anterior: o
  `--continuar` seguinte herda as concluídas pela cadeia `contadores.continuar_de`.
- **Memória** (`paralelo.py`, cabeçalho): de-para sob demanda e liberado depois da última onda que o usa (tabela com
  CONECTOR_ESTADO_MIN linhas ou mais, padrão 20 mil); chaves vistas e soma da origem compactadas ao fim da onda; linha
  `conector memoria onda N: {...}` no stderr do worker e `carga.memoria` (pico e última) no resumo.
