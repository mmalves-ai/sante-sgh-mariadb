# Brief comum: lotes de domínio do conector (F4 L5 a L8)

Brief idêntico para todo agente (protocolo de tokens, regra 3). A parte variável é a fatia `<lote>-<n>.md`.

## Objetivo
Carregar no banco próprio do cliente as tabelas da sua fatia, pela ordem do mapa, com conciliação por contagem e
soma de controle, hash por bloco e medição de linhas por segundo (plano `docs/obra/passagens/F4-plano.md`, seções
6, 6.1 e 8). O L3 (`conector/sante_conector/carga.py`) é o modelo: `conector_origem`, recusa com pendência no mesmo
commit, SAVEPOINT por linha, linha igual pulada, alterada/apagada/editada no destino como pendência.

## O que a fatia traz (não busque de novo)
1. Trecho do mapa: destino, tabelas físicas, chave, estratégia de diferencial, dependências e ordem.
2. Dependências de fora da fatia: pais já carregados antes (lote e ordem).
3. Colunas de origem: forma (só nome e tipo), regra de sentinela, referência e de-para **gerados por nome e tipo:
   confirme ou declare outra**.
4. DDL de destino: CREATE TABLE, ALTER de colunas e FKs.

## Como declarar
- Cada coluna aproveitada vai para `conector/mapa/declarado/colunas.tsv`
  (`tabela, coluna, destino=tabela.coluna, regra, depara, via, motivo`); a declarada vale por cima da gerada.
- Regras válidas: `sentinela.REGRAS`; de-para oficial: `depara.CATALOGOS` (cid10, sigtap, cbo, ibge_municipio,
  ibge_uf, banco). Catálogo oficial **nunca é criado**: código ausente vira pendência `catalogo_codigo_*`.
- Referência a linha pendente ou recusada: `pendencia.Propagador` (`pai_pendente`, com a raiz da cadeia).
- Ciclo novo: `conector/mapa/declarado/ciclos.tsv` (duas fases, com motivo). Nunca edite os `.tsv` gerados.

## Regras de ouro (AGENTS.md)
- Só o `conector/` fala com o Firebird, e só lê. O `.fdb` nunca é alterado nem copiado inteiro.
- Nada de nome da origem no modelo, no código fora do mapa, nas telas nem nas saídas do painel (regra 1).
- Dados reais nunca vão para código, testes, logs, commit ou chat: só contagens. Pendência = tabela, chave
  original e regra, sem valor. Testes só com a imagem SINTÉTICA do "cliente de exemplo" (`sintetica.py`).
- Nenhuma regra de negócio em gatilho; nada instalado na VM (containers).

## Autoconferência (um comando cada, devolvem ok ou a lista de erros)
- `python3 -I conector/verificar_mapa.py` (também na esteira: `conector:mapa`)
- `python3 -I tools/obra/fatiar_conector.py --conferir`
- `conector/conector.sh testes` (suíte do conector, no container)

## Saída do agente
Código e testes no `conector/`, declarações em `conector/mapa/declarado/`, resumo curto (contagens, regras novas,
pendências por regra). Logs longos em `/tmp/claude-1000/`, nunca no chat.
