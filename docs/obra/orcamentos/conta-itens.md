# Orçamento: conta-itens

estimativa_M: 10
teto_M: 13

- **Sobra da rodada plano-conta (23/11, 1h25; commit 20c4b234: plano genérico, cascata da conta resolvida,
  conta_hospitalar de 618 para 3.790 no recorte):**
  - glosa: GLOSADO T/F na origem, T em 3,38 de 4,32 milhões de itens e 2,97 milhões sem motivo; o CHECK
    `ck_conta_hospitalar_item_glosa` recusa 12.963 no recorte. Decisão do orquestrador (prática de mercado: glosa
    exige motivo, TISS): glosado só com motivo; sem motivo, item lançado com pendência e o original na trilha;
  - itens de material e medicamento (FCLANEXT TIPO 4, 6.776 no recorte, 1048 em `item_faturavel_id`): falta o
    caminho do material ao item faturável (`item_faturavel.insumo_id`);
  - produção de repasse (FCINTEGRPA): ATO casa com TBTABATO em 10.689 de 10.726, com TBGRAUPARTPROC só em 6.319.
  - Revisão do diff de 20c4b234, que não teve revisor.
- **Agentes por papel:** corretores 3 × 1,5 M; revisões em 2 lentes 2 × 0,7 M; conferidor com diag-cadeia 2,5 M.
  Soma 8,4 M × 1,15 = **10 M**; teto 30% acima = **13 M**.
