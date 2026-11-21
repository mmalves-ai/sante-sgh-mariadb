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
