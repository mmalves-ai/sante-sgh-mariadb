# Orçamento: retomar-importacao

estimativa_M: 7.2
teto_M: 9.4

- **Causa (23/11, 20h07):** o vigia de memória v3 parou a execução 11 da ProntoCardio na onda 177 de 218 (63,1 milhões
  de linhas, cerca de 55%). O coordenador do worker chegou a 34 GB, e o gravador nasce por fork com todo o estado dele
  (conector/sante_conector/paralelo.py ~645). Ao escrever, as páginas se copiam e o par passou de 70 GB.
- **Por que não dá para continuar hoje:** o sincronizar exige importação concluída (plataforma.py:108). Um importar
  novo relê tudo desde o começo (pula pelo hash o que já entrou, mas gasta a releitura e reconstrói o estado). Ao subir,
  o worker marca a execução órfã como falhou (trabalhador.py:90, recuperar_orfas).
- **Rodada:** (a) a importação interrompida continua de onde parou: as tabelas concluídas são puladas pelo controle,
  e a tabela pela metade é completada. Serve também ao hospital real. (b) A memória do coordenador fica limitada:
  o estado por tabela é liberado ao fim da tabela, e o gravador não herda o estado inteiro.
- **Agentes:** construtor de mudança compartilhada 1 × 4 M; revisor só do diff 1 × 0,5 M; corretor 1 × 1,5 M.
  Soma 6 M × 1,2 = **7,2 M**; teto **9,4 M**.
- **Depois (orquestrador):** juntar no worktree `velocidade`, continuar a execução 11 a partir da onda 177 sem recriar o
  cliente, medir a memória do coordenador.
