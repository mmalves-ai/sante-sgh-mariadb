-- Origem do lançamento "diagnóstico" na conta do paciente (05-SADT linha 4, F3.5-02, 26/11/2026): só para frente e
-- idempotente (ADR 0002, parte 2). Sem gatilho.
--   - O exame pedido no setor de diagnóstico entra na conta com esta origem (aplicacao/pedido-conta.ts lê o código
--     'diagnostico'); antes da semente o item entrava sem origem. Lançamento automático (o sistema gera a partir do
--     pedido) que aponta o evento de origem (o exame pedido, na memória de cálculo 'exame_pedido').
--   - O hospital pode renomear ou inativar; inativa, o item volta a entrar sem origem.
INSERT INTO origem_lancamento (codigo, descricao, ativo, automatica, exige_evento_origem, criado_em)
  SELECT 'diagnostico', 'Diagnóstico (exame pedido no setor)', TRUE, TRUE, TRUE, CURRENT_TIMESTAMP(3) FROM DUAL
   WHERE NOT EXISTS (SELECT 1 FROM origem_lancamento WHERE codigo = 'diagnostico');
