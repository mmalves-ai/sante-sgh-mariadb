# Orçamento: f4-rodada5

estimativa_M: 67
teto_M: 87

- **Objetivo e critério de pronto:** aplicar o ADR 0006 (importação é continuidade) no conector, branch `f4-conector`.
  Pronto quando:
  - os 287 descartes da rodada 4 (16,9 milhões de registros) foram revistos todos;
  - cada tabela da origem **carrega** ou tem **prova de conciliação** de que a informação continua no sistema novo
    (derivado recalculado que bate linha a linha, ou estado carregado no mecanismo novo);
  - os rascunhos clínicos entram como rascunho do autor, que pode finalizá-lo ou apagá-lo;
  - o espelho padrão da base existe:
    - catálogos oficiais e licenciados, versionados por edição;
    - semente dos licenciados a partir da cópia da origem;
    - carregador por arquivo do fornecedor para as edições seguintes;
    - o "criar novo cliente" leva o espelho;
  - o conector liga as referências ao espelho, sem copiar o licenciado;
  - os itens de catálogo próprios do hospital entram ativos;
  - `cobertura_conector.py --falhar-se-bloqueada` passa;
  - `conferir-fatia-f4.sh` dá ok em todas as fatias;
  - `conector.sh testes`, `verificar_mapa` e `validar_migracoes.py` passam.
- **Escopo:**
  1. Compartilhado 1 (modelo e plataforma): situação "rascunho" nos registros clínicos, itens de catálogo do
     hospital, espelho padrão da base (banco da plataforma), carregadores dos licenciados e o "criar cliente" levando o
     espelho.
  2. Compartilhado 2 (motor do conector): rascunho para o autor, ligação ao espelho pelo código e pela edição, semente
     do espelho a partir da origem, e a prova de "não copiar" no relatório de conciliação.
  3. Revisão dos descartes por fatia, em cerca de 8 lotes de cerca de 35 tabelas.
  4. Conferidor.
- **Agentes por papel:**

  | Papel | Agentes | Custo por agente | Total |
  |---|---|---|---|
  | Compartilhado | 2 | 4,5 M | 9 M |
  | Listar | 1 | 0,3 M | 0,3 M |
  | Construtor | 8 | 2,5 M | 20 M |
  | Revisor | 8 | 0,5 M | 4 M |
  | Corretor | cerca de 5 | 0,8 M | 4 M |
  | Conferidor | 2 | 3,5 M | 7 M |

- **Absorve a sobra da rodada 4** (fechou em cerca de 60 M de 69 M, sem o Sincronizar e a conciliação, porque a conferência não fechou):
  - a chave composta de `TBPACTHM`, a última bloqueada;
  - as 4 fatias com conciliação falhando (L5-04, L5-05, L5-12 e L6-11);
  - o Sincronizar (L9) e o relatório de conciliação (L10), cada um com construtor, revisor e corretor: 2 × 5,8 M = 11,6 M.
- **Estimativa:** (44,3 + 11,6) × 1,2 ≈ 67 M. Teto: 87 M. `LIMITE_AGENTES` = 38.
- **Banco próprio por agente:** as fatias usam o banco descartável do `conferir-fatia`, e o espelho de teste é
  `espelho_f4r5`.
- **Fora do escopo:** a carga completa da ProntoCardio (passo do orquestrador, depois do merge).
- **Riscos:**
  - `criar_cliente.py` também é editado pela F2.4 (sementes) no `main`. O orquestrador resolve no merge.
  - Volume da semente licenciada: cerca de 6,2 milhões de linhas, com o disco medido antes.
