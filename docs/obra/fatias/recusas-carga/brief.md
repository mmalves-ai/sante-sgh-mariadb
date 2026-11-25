# Brief comum: análise das recusas da carga da ProntoCardio (fase 1, só leitura)

Orçamento: `recusas-carga` (docs/obra/orcamentos/recusas-carga.md, árvore principal). Pedido do dono, devolvido a esta sessão em 25/11, 0h25.

## Problema
- A carga da ProntoCardio recusou linhas: **12,4 M próprias em 242 tabelas** e **24 M em cascata** (filho de pai recusado).
- O banco recusou por restrição:
  - `restricao_destino_1048`: NOT NULL;
  - `1062`: chave única;
  - `4025`: CHECK.
- O conector gravou a pendência e seguiu, e a conciliação antiga dizia "0 divergentes".
- Efeito: o dono abre prontuários e vê vazio. Exemplo: 482.757 registros clínicos recusados por falta do login do autor. Na origem, 415 de 871 profissionais não têm login.
- Lista por tabela: `/home/mmalves/workspace/redesante/sante-sgh-dados/obra/recusas/recusas-distintas.tsv` (contagem por chave distinta) e `recusas-detalhe.tsv` (por coluna).

## Princípios que decidem a correção (AGENTS.md e ADR)
- **Importação é continuidade (ADR 0006, regra 7):** tudo que o hospital usa entra vivo e utilizável. Nunca "não copiar" sem prova pela conciliação de que a informação continua disponível.
- **Melhor prática, não o SPDATA (ADR 0002):** a obrigatoriedade no banco é boa. Ela só se relaxa quando o dado **legítimo** da origem não a cumpre e a informação continua representada de outro jeito. Exemplo: o autor é o profissional, e o login é opcional só no registro **migrado**, com CHECK `col IS NOT NULL OR origem='migracao'`, como o precedente de `db/migracoes/06_PEP/40_tabelas.sql:7`.
- **Regra no domínio, nunca gatilho.** O modelo não se deforma para facilitar a migração (regra 1): a diferença que sobrar é do conector (mapa, valor presumido com pendência visível, ligação a catálogo).
- **Catálogo:** a ligação é pelo código e pela edição ao catálogo oficial ou ao espelho licenciado (regra 7, ADR 0006). Item próprio do hospital entra ativo.
- **Dados reais (regra 5):** da origem só se consultam **contagens**, pelo utilitário `/home/mmalves/workspace/redesante/sante-sgh-dados/obra/recusas/origem-contagem.sh`, que aceita só `SELECT COUNT(...)` sem GROUP BY e metadados RDB$:

  ```
  echo "SELECT COUNT(*) FROM TBPROFIS WHERE ID_TBUSERS IS NULL;" | origem-contagem.sh
  ```

  No banco de destino `cliente_prontocardio` e no controle `conector_ctl_prontocardio` (MariaDB, container sante-sgh-mariadb, `mariadb -uroot -p"$MARIADB_ROOT_PASSWORD"` dentro do container), também só contagens e metadados. Nunca valores de linha em arquivo, saída ou resumo.
  - A tabela `conector_ctl_prontocardio.pendencia` tem cerca de 170 M linhas: consulte só pelo índice `ix_pendencia_mesma (tabela_origem, regra, chave_original, execucao_id)`, filtrando por `tabela_origem`. Nada de varredura.

## Onde ler (worktree `/home/mmalves/workspace/redesante/sante-sgh-wt/autor-registro`, SÓ LEITURA nesta fase)
- Mapa:
  - `conector/mapa/tabelas.tsv`: tabela de origem, destinos, lote e estratégia;
  - `conector/mapa/declarado/colunas.d/<lote>.tsv`: coluna de origem → destino, referência `ref:`, opções (`autor`, `presumida`, `senao` etc.);
  - `valores.d`: de-para.
- Opções de coluna e pendências: `conector/sante_conector/mapa.py` (OPCOES_COLUNA) e `carga_mapa.py`.
- DDL do destino: `db/migracoes/**` (CREATE TABLE e ALTER). Para o destino real, também `information_schema` do `cliente_prontocardio`.

## O que cada analista entrega
Para **cada tabela da sua fatia**, por ordem de recusas:
1. **Causa provada:** a coluna de destino recusada, o que a origem tem (contagens: nulos, código sem par, duplicatas) e por que o mapa não resolveu.
2. **Categoria da correção:**
   - `modelo`: migração que relaxa só para o migrado, ou que acrescenta coluna;
   - `mapa`: outra fonte, outra corrente de referência, opção `presumida` ou `autor` com pendência de aviso, de-para;
   - `catalogo`: carregar o catálogo, ou ligar pelo código e pela edição;
   - `ordem`: a dependência carrega depois;
   - `conector`: defeito no motor;
   - `dado-invalido`: a origem tem lixo, a recusa é correta e fica a pendência para o hospital decidir, com prova de que não perde informação útil.
3. **Correção exata proposta:** arquivo e linha, ou o texto da migração e da linha do mapa, e o **contrato de efeito** (o que fica no banco).
4. **Linhas recuperadas** (estimativa por contagem) e **cascata destravada**.
5. **Risco:**
   - quebra de regra de negócio, de tela ou de API que supõe o campo obrigatório: liste o código que lê a coluna (`grep` em `apps/api`, `packages`);
   - efeito na produção.

**Saída:**
- arquivo JSON em `/home/mmalves/workspace/redesante/sante-sgh-dados/obra/recusas/analise/<fatia>.json`, uma entrada por tabela, com as chaves `tabela_origem`, `destino`, `coluna`, `causa`, `prova_contagens`, `categoria`, `correcao`, `contrato_efeito`, `linhas_recuperadas`, `cascata`, `risco`, `confianca` (alta, media ou baixa);
- resumo final ao orquestrador de no máximo 25 linhas.

## ECONOMIA (regras 15 a 24 do protocolo e do plano)
- Leia a fatia e o necessário num comando só. Agrupe as consultas de contagem por arquivo SQL, numa chamada.
- Tabela pequena (menos de 1.000 recusas) com causa evidente leva análise curta.
- Meta de 20 a 50 ferramentas; aviso em 60.
- Não edite nenhum arquivo do repositório nesta fase. Outra rodada está editando o conector.
