# Orçamento: faixa-carga

estimativa_M: 8
teto_M: 11

- **Medição na carga real (execução 4, 22/11, de 8h49 a 9h25):** 3.400 linhas por segundo no total, cerca de 570 por
  gravador. As ondas têm poucas tabelas grandes de cada vez. As 5 maiores do plano somam 78 milhões de linhas:
  - TBCABTRILHA, 33 milhões;
  - TBLANTRILHASGH, 17 milhões;
  - PREVOLPAC, 14 milhões;
  - PREVOLPACTMP, 7,5 milhões;
  - PRCHKGERAL, 6,3 milhões.
  - Previsão nesse ritmo: carga até cerca de 22h.
- **Objetivo:** dividir a tabela grande (acima de 500 mil linhas, sem autorreferência e sem adotar ou agrupar
  dependente da ordem) por faixa de chave entre os gravadores, com reserva de id por faixa. Meta: 12 mil linhas por
  segundo ou mais na carga completa. O resultado continua idêntico (conciliação, pendências, idempotência, L9).
- **Agentes por papel:** construtor 1 × 4 M; revisor 1 × 0,6 M; corretor 1 × 1,5 M. Soma 6,1 M × 1,2 = **8 M**;
  teto 30% acima = **11 M**.
