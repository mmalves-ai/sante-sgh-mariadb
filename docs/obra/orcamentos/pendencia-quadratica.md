# Orçamento: pendencia-quadratica

estimativa_M: 3.4
teto_M: 4.4

- **Sintoma medido (23/11, 22h20, execução 12 da ProntoCardio, continuação da 11):** na carga antiga das entidades
  do L3 (conector/sante_conector/carga.py, entidade "atendimento", ATCABECATEND com 209.147 linhas), o MariaDB recebeu
  cerca de 9.400 INSERTs por segundo em conector_ctl_prontocardio.pendencia por 50 min. O AUTO_INCREMENT da tabela
  subiu cerca de 21 milhões, mas só ficaram 204.944 linhas (uma por chave, regra carater_estimado). Ou seja, cada
  lote regrava as pendências já gravadas (descartadas como duplicadas, mas gastando INSERT e AUTO_INCREMENT): custo
  quadrático. O batimento não foi atualizado durante a tabela (o vigia acusou parada falsa). Carga parada pelo
  orquestrador às 22h22 para corrigir.
- **Rodada:** (a) achar e corrigir na causa a regravação de pendências já gravadas (cada pendência é gravada uma vez);
  (b) na continuação, a carga antiga do L3 que a execução anterior já concluiu não roda de novo, se o controle
  comprovar a conclusão (senão continua rodando, pulando pelo hash); (c) batimento atualizado durante tabela longa
  (a cada lote ou a cada N segundos), nos dois caminhos (carga.py e paralelo/carga_mapa), para o vigia enxergar
  progresso.
- **Agentes:** construtor do conector 1 × 1,5 M; revisor só do diff 1 × 0,5 M; corretor 1 × 0,8 M. Soma 2,8 M × 1,2
  = **3,4 M**; teto **4,4 M**.
