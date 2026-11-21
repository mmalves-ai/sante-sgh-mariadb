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
- Container `sante-sgh-conector` sempre `--network none`; `--privileged` só nos comandos que abrem o arquivo.
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
`CONECTOR_MAX_PARALELO`, `CONECTOR_SHA256` (`sim`; `nao` só para teste), `CONECTOR_FATOR_DISCO_IMPORTAR`,
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
