# Orçamento: carga-painel

estimativa_M: 27
teto_M: 35

- **Por quê:** o dono pediu (24/11) a tela "Carga e sincronismo" no painel técnico:
  - iniciar, pausar e retomar;
  - progresso por tabela com barra segmentada e erros;
  - serviço independente da tela e log baixável;
  - leitura direta do servidor Firebird, configurável pela tela e simulada em dev.
  A carga da ProntoCardio expôs que a conciliação não enxergava 63% de recusas no prontuário.
- **Brief:** `sante-sgh-wt/autor-registro/docs/obra/fatias/carga-painel/brief.md` (worktree próprio, branch `conector-autor-registro`).
- **Agentes:**
  - 1 sequencial de mudança compartilhada (migração 0093, contratos, estados no Python e interface da origem): 3,5 M
  - 5 construtores (conector-origem 2,5; conector-motor 2,5; API 1,5; web 1,5; infra+ADR 1,2): 9,2 M
  - 5 revisores só do diff: 2,5 M
  - até 5 corretores: 4 M
  - 1 integrador com prova ponta a ponta no painel de teste (portas 3311/5311): 3,5 M
  - Soma 22,7 M × 1,2 ≈ 27 M; teto 35 M (+30%).
- **Fechamento:**
  - testes do conector, da API e da web verdes;
  - carga real iniciada pela tela no servidor simulado, com pausa e retomada provadas;
  - o dono clica.
