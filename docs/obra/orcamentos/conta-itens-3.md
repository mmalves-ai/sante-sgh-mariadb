# Orçamento: conta-itens-3

estimativa_M: 6
teto_M: 8

- **Sobra da conta-itens-2 (23/11, 3h40; commits c3be2be6, a237af65, 7451ca71, 6805f08b, de8e4129, ce084c18):**
  repasse por grupo de ato e ligação ao espelho feitos; material e medicamento na conta (FCLANEXT TIPO 4, 6.776
  recusas 1048 no recorte) esperando escolha entre as propostas A e B.
- **Decisão do orquestrador: proposta B.** Na origem, o item da conta aponta o item da tabela de preço
  (TBMATMED), não o produto de estoque; no mercado (TISS), mat/med é cobrado pelo código da tabela de referência.
  A ligação ao estoque (GEITENS) não está declarada na origem e seria estimativa (proposta A). Migração só para frente
  em 12_FAT: item_faturavel.item_referencia_matmed_id (FK, única), CHECK do insumo passa a aceitar insumo OU item de
  referência (nunca nenhum dos dois).
- **Agentes:** construtor em worktree isolado 1 × 3 M; revisor 1 × 0,7 M; conferidor 1 × 1,5 M. Soma 5,2 M × 1,15 =
  **6 M**; teto **8 M**.
