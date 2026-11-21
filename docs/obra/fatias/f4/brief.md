# Brief comum: lotes de domínio do conector (F4 L5 a L8)

Brief idêntico para todo agente (protocolo de tokens, regra 3). A parte variável é a fatia `<lote>-<n>.md`.

## Objetivo
Carregar no banco próprio do cliente as tabelas da sua fatia, pela ordem do mapa, com conciliação por contagem e
soma de controle, hash por bloco e medição de linhas por segundo (plano `docs/obra/passagens/F4-plano.md`, seções
6, 6.1 e 8). A carga é **dirigida pelo mapa** (`conector/sante_conector/carga_mapa.py`, sem código por tabela): a
fatia DECLARA colunas, não escreve carregador. Ela já faz `conector_origem`, recusa com pendência no mesmo commit,
SAVEPOINT por linha, linha igual pulada, alterada/apagada/editada no destino como pendência, de-para oficial,
referência pelo `conector_origem` (`pai_pendente` em cadeia), autorreferência e ciclo em duas fases, vários destinos,
conciliação por entidade e linhas por segundo. Leia o cabeçalho dele uma vez. Código novo no motor só se uma regra
genérica faltar (registre o motivo); nunca código por tabela.

## Arquivos SÓ da sua fatia (lotes em paralelo: não edite os compartilhados)
- `conector/mapa/declarado/colunas.d/<fatia>.tsv` (ex.: `L5-01.tsv`): as colunas aproveitadas, mesmo formato de
  `declarado/colunas.tsv`. Cada tabela da origem fica num só arquivo (tabela em dois arquivos = erro do verificador).
  Especiais: coluna `=<texto>` grava o literal (ex.: `=migracao`, código fixo); `@id` grava o id do destino principal
  (o primeiro destino declarado) numa tabela secundária. Valor nulo em coluna NOT NULL com padrão fica com o padrão.
- `conector/sante_conector/sintetica_d/<fatia>.py` (ex.: `l5_01.py`): as tabelas da origem da fatia (`DDL`, mesmos
  nomes e tipos da fatia) e `linhas(r, ins)` com dados 100% falsos e as anomalias, devolvendo o esperado
  `{tabela: {"gravados": n, "pendencias": {regra: n}}}`; opcionais `PAIS_EXTERNOS` (pais de fora da fatia, dados como
  já carregados), `PREPARO_DESTINO` (SQL no destino: ex. códigos do catálogo oficial usados), `REQUER`. Modelo:
  `sintetica_d/exemplo.py` (o contrato está em `sintetica.py`). Nunca edite `sintetica.py`.
- `conector/testes/test_<fatia>.py` (ex.: `test_l5_01.py`): testes da fatia (regras próprias, de-para de valores).
- Saída do agente (resumo curto): `docs/obra/fatias/f4/saida/<fatia>.md`.

## O que a fatia traz (não busque de novo)
1. Trecho do mapa: destino, tabelas físicas, chave, estratégia de diferencial, dependências e ordem.
2. Dependências de fora da fatia: pais já carregados antes (lote e ordem).
3. Colunas de origem: forma (só nome e tipo), regra de sentinela, referência e de-para **gerados por nome e tipo:
   confirme ou declare outra**.
4. DDL de destino: CREATE TABLE, ALTER de colunas e FKs.

## Como declarar
- Cada coluna aproveitada vai para `conector/mapa/declarado/colunas.d/<fatia>.tsv`
  (`tabela, coluna, destino=tabela.coluna, regra, depara, via, motivo`); a declarada vale por cima da gerada.
- Regras válidas: `sentinela.REGRAS`; de-para oficial: `depara.CATALOGOS` (cid10, sigtap, cbo, ibge_municipio,
  ibge_uf, banco). Catálogo oficial **nunca é criado**: código ausente vira pendência `catalogo_codigo_*`.
- Catálogo oficial **nunca é gravado** (regra 7): tabela do modelo com `versao_fonte` ou declarada em
  `declarado/oficiais.tsv`. Ela sai de `tabelas_destino` e aparece em `destinos_oficiais`: a parte oficial é de-para
  pelo código (declare a coluna em `declarado/catalogos.tsv`); só o resto da tabela é carregado. O verificador recusa
  destino oficial em coluna declarada.
- Texto: `texto` só apara as pontas (quebras de linha e espaços internos ficam); `texto_nome` colapsa espaços;
  `texto_char` apara só o preenchimento; `texto_longo` (BLOB SUB_TYPE 1) converte CP1252 sem mexer em nada; `blob`
  (SUB_TYPE 0) fica em bytes. `codigo_char` preserva a caixa ('a' e 'A' são códigos distintos): colisão de caixa num
  domínio vira pendência `codigo_colisao_caixa` (`sentinela.colisoes_caixa`).
- Hora: TIMESTAMP que guarda só hora (1899-12-30 HH:MM) usa `hora_em_timestamp` (destino TIME; o verificador exige
  regra de hora para destino TIME). `data_hora` com data sentinela e hora preenchida vira pendência `hora_sem_data`.
- Pendências: `pendencia.Propagador` guarda um conjunto por linha (própria por regra + uma `pai_pendente` por pai).
- Referência a linha pendente ou recusada: `pendencia.Propagador` (`pai_pendente`, com a raiz da cadeia).
- Ciclo novo: `conector/mapa/declarado/ciclos.tsv` (duas fases, com motivo). Nunca edite os `.tsv` gerados.

## Mecanismos da rodada de cobertura (use; prova em `sintetica_d/exemplo_cob.py`)
- Referência na `via`: `ref:T` (chave), `ref:T.K` (chave alternativa: coluna K do pai; repetido = `pai_ambiguo`),
  `ref:T(C1,C2)` (chave composta montada por colunas desta linha), `ref:T>X>U` (encadeada: coluna X do pai leva a U;
  terminada em coluna, o valor segue para a regra/de-para, ex. código de catálogo oficial guardado no pai).
- Especiais: `=@data_carga`; `@vigencia_carga` (vigência sem fonte, pendência baixa `vigencia_sem_fonte`);
  `#sha256:C`; `#codigo_derivado:C:n[:prefixo]` (prefixo de domínio e código que não cabe); `#cofre:C` (segredo
  NUNCA gravado: NULL + `segredo_aguarda_cofre`); `#retrato` (JSON da linha, sem segredo); `#data:ANO,MES[,DIA]`.
- Regras: `piso:<n>`, `faixa:<min>,<max>`, `texto_resumo:<n>`, `minutos_em_timestamp` (além das anteriores).
- Opções do destino (na `via` de uma coluna dele): `opcional` (secundário sem valor não grava), `adotar:<c1>,<c2>`
  (adota a linha que já existe, ex. CPF, sem sobrescrever), `desdobrar:COL=rot,...` com `#item`/`#rotulo` (uma linha
  por coluna com valor), `complementa` (coluna com `ref:` e destino `<tabela>.id`: UPDATE da linha do pai).
- De-para oficial `codigo_esocial:<tabela oficial>`; dependência nova de ordem em `declarado/dependencias.tsv`;
  descarte de produto em `declarado/sem_carga.tsv` (causas `sem_valor`, `duplicado`, `licenciado`,
  `catalogo_oficial`, `mecanismo_do_produto`). Decisões de destino: `docs/obra/passagens/F4-decisoes-destino.md`.
- Cobertura: `python3 -I tools/obra/cobertura_conector.py --fatia <F>` diz o que da fatia ainda não carrega e por quê.

## Regras de ouro (AGENTS.md)
- Só o `conector/` fala com o Firebird, e só lê. O `.fdb` nunca é alterado nem copiado inteiro.
- Nada de nome da origem no modelo, no código fora do mapa, nas telas nem nas saídas do painel (regra 1).
- Dados reais nunca vão para código, testes, logs, commit ou chat: só contagens. Pendência = tabela, chave
  original e regra, sem valor. Testes só com a imagem SINTÉTICA do "cliente de exemplo" (`sintetica.py`).
- Nenhuma regra de negócio em gatilho; nada instalado na VM (containers).

## Autoconferência (UM comando; devolve ok ou a lista de erros; no máximo 3 vezes)
- `tools/obra/conferir-fatia-f4.sh <fatia>`: verificador do mapa + `fatiar_conector --conferir` + declarações +
  testes da fatia + carga e conciliação da fatia na imagem sintética, duas vezes (idempotência), num banco
  descartável. Logs em `/tmp/claude-1000/conferir-fatia-f4/<fatia>/` (leia só o necessário).
- A suíte inteira (`conector/conector.sh testes`) é o validador global do orquestrador.

## Saída do agente
Declarações em `colunas.d/<fatia>.tsv`, imagem sintética em `sintetica_d/<fatia>.py`, testes em
`testes/test_<fatia>.py`; resumo curto em `docs/obra/fatias/f4/saida/<fatia>.md` (contagens, regras novas,
pendências por regra, linhas por segundo da conferência). Logs longos em `/tmp/claude-1000/`, nunca no chat.

## Mecanismos da rodada 2 (integrador; prova em `sintetica_d/exemplo_r2.py`, `testes/test_carga_mapa_r2.py`)
- `cod:<tabela>.<coluna>` na `via`: o valor (da coluna, depois da regra/de-para; ou literal `=x`/`=~x`) acha o id no
  cadastro do DESTINO pela coluna (ex.: tipo do produto pelo código); ausente: `codigo_inexistente_destino`; repetido:
  `pai_ambiguo` (NULL; coluna NOT NULL recusa a linha). Substitui os pedidos `@dominio:`, `cadastro:` e `cod:`.
- `@unico:<tabela>`: id da única linha ativa da tabela do destino; nenhuma ou várias: recusa `cadastro_unico_indefinido`.
- `ref:T.(K1,K2)=(C1,C2)`: chave alternativa COMPOSTA (colunas C desta linha casam com as colunas K do pai; repetido:
  `pai_ambiguo`). `ref:T/<destino>` (também no fim da encadeada): id do destino SECUNDÁRIO que o pai gravou.
- Opção de destino `antes` (secundário gravado antes do principal; com `adotar:`) e especial `@id:<destino>` (id da
  linha gravada ou adotada nesse secundário). Ex.: a pessoa física do profissional criada pelo nome e CPF da linha.
- `tipar`: data em coluna DATETIME (meia-noite), data e hora em coluna DATE, literal em TIME/DATE/DATETIME convertido.
- Regras `minutos_hhmm` (duração HHMM -> minutos) e `email`; `hora_hhmm` aceita o texto cru (bytes) da origem.
- `PREPARO_DOS_REQUERIDOS = True` na sintética da fatia: o `PREPARO_DESTINO` das fatias de `REQUER` roda antes do dela.
- A autoconferência acusa cada tabela BLOQUEADA da fatia (passo 6); `complementa` não exige as NOT NULL do destino;
  coluna obrigatória por referência a pai BLOQUEADO ou DESCARTADO deixa a tabela BLOQUEADA (`pai_nao_carregado`).

## Mecanismos da rodada 3, grupo 1: data e hora (integrador; prova em `sintetica_d/exemplo_r3.py`, `testes/test_carga_mapa_r3.py`)
- Data + hora HHMM em outra coluna: `#data_hora:<DATA>,<HORA>` (já existia; hora em inteiro, texto 'HHMM'/'HH:MM'
  ou texto cru, TIME ou TIMESTAMP de só hora). NOVO: `#data_hora:<DATA>,<HORA>,<HORA_REF>`: a hora menor que a hora
  de referência válida da mesma data (ex.: fim antes do início) passa para o dia seguinte, com a pendência baixa
  `virada_de_dia` (ato cirúrgico que atravessa a meia-noite). Data DATE em DATETIME e o contrário: `tipar` (rodada 2).
- Quantidade com a unidade em outra coluna: `#dias:<VALOR>,<UNIDADE>` (ou `#dias:<VALOR>,=ano` para unidade fixa)
  grava dias inteiros: minuto, hora, dia, semana (7), mes (30), ano (365). A unidade aceita nome, plural ou letra
  (D, S, M = mês, A, H), sem caixa; pode vir do pai por `ref:T>COLUNA` na via (encadeada TERMINADA EM COLUNA, ex.:
  `ref:TBUNID_IDADE>UNIDADE_CALCULO`) e passar pelo de-para de valores da linha (`depara=valores`, pares em
  `valores.d/<fatia>.tsv` com a coluna `#dias:V,U`: valor da origem -> unidade canônica). A regra declarada na linha
  vale para o VALOR antes da conta (ex.: `inteiro_zero_nulo`, 0 = sem limite). Mês, ano e fração de dia truncada:
  pendência baixa `periodo_aproximado`; sem unidade: NULL com `unidade_ausente`; unidade desconhecida, sem par ou
  valor negativo: NULL com `valor_fora_do_dominio`; pai da unidade ausente: `pai_inexistente`.
- Recorrência de datas (ex.: feriado com ano-marca 9999 = todo ano): regras `ano_recorrente:<ano>` (TRUE/FALSE; com
  `depara=valores` 1 -> anual, 0 -> data_unica), `data_nao_recorrente:<ano>` (a data; NULL no ano-marca),
  `dia_recorrente:<ano>` e `mes_recorrente:<ano>` (dia e mês só no ano-marca). Declare a MESMA coluna de data uma vez
  por destino (recorrencia, dia, mes, data). Data sentinela: `data_sentinela`.
- Pares de colunas que viram linhas, também no destino PRINCIPAL: `desdobrar:SEG_I+SEG_F=2|0,...,FER_I+FER_F=|1`
  na via de `#item`; `#item` recebe a 1ª coluna do par, `#item2` a 2ª (cada uma pela regra declarada na própria
  linha `#itemN`, ex. `hora` ou `hora_hhmm`); `#rotulo`, `#rotulo2` recebem as partes do rótulo separadas por '|'
  (parte vazia = NULL; literal convertido ao tipo do destino). Item sem valor em nenhuma das colunas não gera linha.
  No principal: cada item é `<chave>/<destino>/<rótulo>` no conector_origem, a conciliação confere linhas e itens
  ("gravados" = itens), linha sem item é recusada com a pendência baixa `sem_item_a_gravar`, e uma restrição do
  destino num item (ex.: fim <= início) recusa a linha inteira. Desdobrado não combina com `complementa`; rótulo
  repetido ou par sem `#item2` declarado é erro do verificador. Ex.: TBLOCALHORA, FCHORATE (sem `complementa` nem
  destino extra: o próprio horário é o principal).

## Mecanismos da rodada 3, grupo 2: estrutura (integrador; prova em `sintetica_d/exemplo_r3b.py`, `testes/test_carga_mapa_r3b.py`)
- Retrato COMPLETO da linha (históricos HT*, exclusões): `#retrato:*` grava o JSON de TODAS as colunas da tabela da
  origem (dicionário vivo; entram também no hash da linha), `#retrato:*-A,B` todas menos A e B, `#retrato:A,B` as
  colunas lidas mais A e B. Nunca leva segredo: colunas de `#cofre` e nomes de segredo (`mapa.SEGREDO_NOME`: SENHA,
  PASSW, TOKEN, SECRET, SEGREDO, CHAVE_PRIVADA). Coluna sem regra gerada: BLOB binário em `sha256:<hex>`, BLOB de
  texto convertido, o resto texto. `#sha256:#retrato[...]` grava o SHA-256 hex do MESMO texto JSON (o produto
  deduplica versões pelo hash dos dados, ex.: `paciente_versao.hash_dados`). Ex.: HTPACIENTE, HTPACTELEFONE, HTPROFIS,
  HTPROFISTEL, HTATENDRESP, HTATENDIMENTO, REEXCATE.
- Referência ao destino SECUNDÁRIO do pai (`ref:T/<destino>`, rodada 2) em colunas CONCORRENTES: várias colunas da
  origem declaradas para a MESMA coluna do destino gravam a primeira com valor, na ordem declarada (as outras só
  deixam a pendência própria, ex.: `pai_inexistente`). Ex.: FCLANEXT `item_faturavel_id` por ID_TBPROCTO
  (`ref:TBPROCTO/item_faturavel`), ID_TBTABDTH e ID_TBMATMED; TBHISTTAB* `ref:TBCONVEN/contrato_fonte_pagadora` com o
  acordo declarado como destino secundário de TBCONVEN. Item ou `@id` não pode ser concorrente (erro do verificador).
- Cópia de coluna de outra tabela: `ref:T@<coluna>` (também `ref:T/<destino>@<coluna>` e no fim da encadeada,
  `ref:T>X>U/<destino>@<coluna>`) grava o VALOR da coluna da linha do DESTINO que o pai gravou (lido do banco: o que o
  cliente vê), não o id. Pai pendente ou inexistente como na referência comum. Não combina com `cod:`. Ex.: FCCTRLANCIHA
  `ref:FCLANEXT@item_faturavel_id`.
- Divisão do destino principal com o item FALSO: opção `com_falso` (na via do `#item`, junto do `desdobrar:`): o
  valor falso (o 'N' de uma marcação S/N pela `booleano_sn`) também gera a linha; vazio continua sem linha; tabela sem
  chave funciona (chave pelo hash). Ex.: REPARATE (`regra_heranca_campo`, herda = falso), ATPARAMGERAL.
- Agrupamento de linhas sob um cabeçalho (parcelas de um título): opção `antes;agrupar:C1,C2,...` (colunas da
  ORIGEM) num destino SECUNDÁRIO. As linhas com os mesmos valores em C1, C2 (texto aparado; todas vazias: a linha é o
  próprio grupo) gravam UM cabeçalho: a primeira linha gravada do grupo cria, as outras usam (sem pendência; recusa da
  primeira desfaz o cabeçalho e a seguinte cria). O principal (a parcela) liga por `@id:<destino>`. Agregados de todas
  as linhas LIDAS do grupo: `#grupo_contar`, `#grupo_seq` (posição na ordem da chave), `#grupo_somar:C`,
  `#grupo_min:C`, `#grupo_max:C` (regra declarada na linha especial, ou a gerada da coluna). Cabeçalho de execução
  anterior com agregado diferente (parcela nova na origem): usado como está, pendência
  `grupo_divergente_aguarda_sincronizar`. Só um destino agrupado por tabela; não combina com `adotar`, `desdobrar`,
  `complementa` nem `opcional`. Ex.: MFCONPAG (`titulo_pagar` agrupado por EMPRESA, FORN, DOC, SERIE, TIPO;
  `parcela_pagar` principal), MFCTAREC.
