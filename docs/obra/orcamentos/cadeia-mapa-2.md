# Orçamento: cadeia-mapa-2

estimativa_M: 13
teto_M: 17

- **Sobra da cadeia-mapa (22/11, 21h55):**
  - marcações de horário (REPACAGD, 1048) e TBMEDSOL: o agente fechou na G6 sem commit; o trabalho de L5-05 e L6-04
    ficou no disco;
  - parcelas a pagar (MFCONPAG, pai_pendente) e contatos de paciente (C8);
  - 5 testes de ordem do plano desatualizados pela reordenação, e o teste do C3, que pede NOT NULL em
    `inscricao_conselho.profissional_id`;
  - a prova no recorte da cadeia não terminou.
- **Função nova:** reprocessar as linhas recusadas numa passada (`CONECTOR_REPROCESSAR_RECUSADAS=1`). Hoje a
  importação nunca regrava uma linha já vista, então uma correção do mapa não alcança um cliente já carregado. Vale
  para todo cliente e entra junto com a passada `CONECTOR_SO`.
- **Agentes por papel:**
  - corretores por item: até 3 × 1,5 M;
  - função de reprocessar: 1 × 2 M;
  - revisões em 2 lentes: 2 × 0,7 M;
  - conferidor com diag-cadeia: 1 × 2,5 M.
  - Soma 10,4 M × 1,2 = **13 M**; teto 30% acima = **17 M**.
