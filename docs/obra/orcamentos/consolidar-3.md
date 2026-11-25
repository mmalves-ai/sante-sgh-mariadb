# Orçamento: consolidar-3

estimativa_M: 5
teto_M: 6.5

- **Por quê:** a verificação completa depois das rodadas f3-provas, f3-fechar e f3-integrar (25/11 02h20) ficou
  vermelha em pouco: 2 de 170 tarefas do nx (api:test e dominio-sadt:typecheck), sem-coexistencia (2 arquivos), combos
  (5 locator('select') em E2E), anexo de implantação e testes de privilégios (regenerados pelo orquestrador), .env com
  data nova (perguntado às outras sessões) e pastas globais (provável execução concorrente).
- **Agentes:** 1 corretor × 4 M (rodar os alvos, corrigir na causa) + margem; teto 6,5 M.
