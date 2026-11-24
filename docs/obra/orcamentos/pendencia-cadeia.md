# Orçamento: pendencia-cadeia

estimativa_M: 4.8
teto_M: 6.2

- **Medido (24/11, 03h35):** a continuação copia todas as pendências abertas da execução anterior para a nova
  (continuar.repetir_pendencias): a execução 13 copiou 35.980.210 linhas da 11, e a 14 estava copiando as da 13 (6,7
  milhões em 1 h). A tabela conector_ctl_prontocardio.pendencia está em 18,5 GB. Cada pedaço da cópia faz
  `SELECT id ... WHERE execucao_id=? AND situacao='aberta' AND tabela_origem IN (...)` com "Creating sort index" de 190 s
  (sem índice adequado): a cópia da 14 levaria mais de um dia. Execução 14 parada pelo orquestrador às 03h40 (estava só
  na cópia).
- **Rodada:** (a) a pendência fica na execução em que nasceu: a continuação NÃO copia; quem lê pendências (resumo,
  conciliação, L10, painel do administrador, sincronizar, reemissão) segue a cadeia continuar_de (a execução vale com
  as pendências das anteriores da cadeia, sem dupla contagem); (b) índice próprio no controle para as leituras por
  execução/situação/tabela (migração do controle, idempotente); (c) as cópias já feitas (execuções 12, 13 e 14 da
  ProntoCardio) são duplicatas exatas das da 11: a leitura pela cadeia não pode contá-las duas vezes (descartar só o
  que for duplicata exata de uma execução anterior da cadeia, com contagem antes e depois; nada que exista só na
  cópia).
- **Agentes:** construtor do conector 1 × 2,5 M; revisor só do diff 1 × 0,5 M; corretor 1 × 1,0 M. Soma 4 M × 1,2 =
  **4,8 M**; teto **6,2 M**.
