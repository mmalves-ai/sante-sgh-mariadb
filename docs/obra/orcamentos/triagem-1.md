# Orçamento: triagem-1

estimativa_M: 47
teto_M: 61

- **Por quê:** na f3-fechar metade dos construtores trabalhou em função que não fecha por agente (decisão de produto ou
  outro módulo inteiro) e custou o mesmo: 7,4 M por função pronta. A triagem, só de leitura, separa antes de construir.
- **Escopo:** 294 funções ainda não cobertas (F3: 123 parciais e 9 sem situação reconhecida; F7: 80; F8: 91), em 39
  lotes de até 10 funções da mesma ficha (`sante-sgh-dados/obra/triagem/lotes.json`), para ler o módulo uma vez só.
- **Classes:** A (agente fecha sozinho, com o esforço P/M/G), B (depende de outra função ou módulo, dizendo qual), C
  (decisão de produto: a pergunta exata, com a recomendação de mercado), D (já coberta de fato no código; falta só a
  ficha), E (sai: contorno do sistema antigo ou duplicada).
- **Agentes:** 39 triadores × 1,2 M ≈ 47 M; teto 61 M. Sem revisor (não muda código); a amostra é conferida pelo
  orquestrador por script (classes D e E valem só com o caminho e a prova no código).
- **Saída:** `sante-sgh-dados/obra/triagem/<lote>.json`; a construção seguinte pega só A e D, por esforço; C vira a
  lista de decisões para o dono.
