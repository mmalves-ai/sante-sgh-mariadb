-- SADT, aviso crítico com origem no laudo (F3.5, 05-SADT linha 16, 25/11/2026). Só para frente e idempotente
-- (ADR 0002, parte 2).
-- O achado crítico do laudo de imagem e de métodos gráficos abre o mesmo aviso do valor crítico do laboratório (o mesmo
-- painel, o mesmo prazo, a mesma comunicação com leitura confirmada). Esse laudo não tem resultado de laboratório: a
-- origem do aviso passa a ser o resultado OU o laudo, exatamente um dos dois.
ALTER TABLE aviso_valor_critico
  MODIFY COLUMN resultado_exame_id BIGINT UNSIGNED NULL
    COMMENT 'Resultado de laboratório que gerou o aviso (nulo quando a origem é o laudo)',
  ADD COLUMN IF NOT EXISTS laudo_diagnostico_id BIGINT UNSIGNED NULL
    COMMENT 'Laudo de imagem ou de métodos gráficos cujo achado crítico gerou o aviso (nulo quando a origem é o resultado)'
    AFTER resultado_analito_id;
ALTER TABLE aviso_valor_critico
  ADD KEY IF NOT EXISTS ix_aviso_valor_critico_laudo_diagnostico_id (laudo_diagnostico_id);
ALTER TABLE aviso_valor_critico
  DROP CONSTRAINT IF EXISTS ck_aviso_valor_critico_fonte;
ALTER TABLE aviso_valor_critico
  ADD CONSTRAINT ck_aviso_valor_critico_fonte CHECK (
    (resultado_exame_id IS NOT NULL AND laudo_diagnostico_id IS NULL)
    OR (resultado_exame_id IS NULL AND laudo_diagnostico_id IS NOT NULL AND resultado_analito_id IS NULL));
