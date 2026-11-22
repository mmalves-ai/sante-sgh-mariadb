# Orçamento: cadeia-mapa

estimativa_M: 14
teto_M: 18

- **Achado do conferidor da liberacao-prontocardio (22/11, 20h05),** no recorte real da cadeia: entidades principais
  zeradas na carga pelo mapa.
  - Inscrição no conselho, TBCBOPRO: 0 de 1.907, por pai_inexistente na referência encadeada
    `ref:TBCBOPRO>ID_TBPROFIS>TBPROFIS`. Em cascata ficam zerados profissional por convênio (90.455),
    especialidades, lotação e preço particular.
  - Marcação de horário, REPACAGD: 0 de 24.030, por 1048 (NOT NULL).
  - Parcela a pagar, MFCONPAG: 0 de 71.267, por pai_pendente e 1048.
  - Conta bancária, TBCTABAN: 0 de 489, por 4025.
  - Preço de referência de mat/med do hospital, TBMATMED: 0 de 20.000, por licenca_nao_comprovada.
  - Menores: TBPROCTO 9.941 (1048); TBMEDSOL 3.752 (1048) e 1.250 (1062); RPRPA 431; FCCTAEXT e RECONTAS com cerca
    de 3.170 pai_pendente cada; C8 telefones inválidos.
- **Objetivo:** corrigir na causa, com prova num recorte só das tabelas afetadas e dos seus pais (1 gravador, porque
  a carga real roda ao lado). Depois, uma passada `CONECTOR_SO` dessas tabelas no cliente real, ao fim da carga.
- **Agentes por papel:**
  - motor (referência encadeada): 1 × 2,5 M;
  - correções por fatia: até 4 × 1,3 M;
  - revisões adversariais em 2 lentes: 2 × 0,7 M;
  - corretor: 1 × 1,2 M;
  - conferidor: 1 × 2 M.
  - Soma 12,3 M × 1,2 = **14 M**; teto 30% acima = **18 M**.
