# Orçamento: paralelismo-carga

estimativa_M: 9
teto_M: 12

- **Objetivo:** carga completa da ProntoCardio (195 milhões de registros) em 4 horas ou menos, pelo menos 25 mil linhas
  por segundo no total. O desenho é um leitor da origem e N gravadores (processos), cada um com sua conexão, em
  tabelas independentes da mesma onda do plano. A conciliação, a idempotência, as pendências e o L9 continuam iguais.
- **Medida de partida:** de 1.000 a 1.500 linhas por segundo na carga real. O lote sobe isso para cerca de 2 vezes,
  com teto de 5 a 7 mil por processo. A máquina tem 16 núcleos e 45 GB de memória.
- **Agentes por papel:** construtor 1 × 4 M; revisor 1 × 0,6 M; corretor 1 × 1,5 M; conferidor (equivalência na cópia
  real, testes e fatias) 1 × 1,5 M. Soma 7,6 M × 1,2 = **9 M**; teto 30% acima = **12 M**.
