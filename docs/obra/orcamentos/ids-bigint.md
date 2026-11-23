# Orçamento: ids-bigint

estimativa_M: 7.2
teto_M: 9.4

- **Defeito (achado em 23/11, 12h05):** o espelho põe todo item próprio do hospital nas tabelas de catálogo com
  id >= 10^12 (`tools/db/espelho.py`, BASE_LOCAL), mas 65 arquivos de `packages/contratos` limitam o id a
  2.147.483.647 (32 bits). Toda gravação que referencie item próprio é recusada com entrada-invalida. Na ProntoCardio:
  43 tabelas com AUTO_INCREMENT >= 10^12; item_referencia_matmed com 713.571 linhas acima de 10^12.
- **Decisão do orquestrador:** o id aceita BIGINT até Number.MAX_SAFE_INTEGER (convenção do DDL: BIGINT UNSIGNED),
  sem mudar o BASE_LOCAL (mudar exigiria refazer a carga). Um esquema de id único em contratos, usado por todos.
- **Alcance medido:** 65 arquivos de contratos; cerca de 16 controllers e esquemas da API com o teto; expressões
  `\d{1,9}`/`\d{1,10}` em parâmetros (separar id de versão e de número de negócio); web (parse de id); persistência
  (BIGINT devolvido como número, nunca como texto, sem perda acima de 2^53 não ocorre: MAX_SAFE_INTEGER).
- **Agentes:** construtor de mudança compartilhada 1 × 4 M; revisor só do diff 1 × 0,5 M; corretor/conferidor
  1 × 1,5 M. Soma 6 M × 1,2 = **7,2 M**; teto **9,4 M**.
- **Memória:** carga real em curso com 4 a 6 GB livres. Teste pesado só por
  `flock sante-sgh-dados/obra/pesado.lock sante-sgh-dados/obra/com-memoria.sh <cmd>`; o verificar:tudo fica com o
  orquestrador.
- **Fora:** cliente_prontocardio e worktree da carga.
