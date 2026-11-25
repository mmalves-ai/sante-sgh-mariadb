-- Suprimentos, o movimento que consumiu a etiqueta de identificação (C2-024, 05-SUP linha 14, 25/11/2026): só para
-- frente e idempotente (ADR 0002, parte 2). A saída do estoque e a dispensação dão baixa nas etiquetas lidas dentro da
-- própria operação (mesma transação) e gravam aqui o movimento que as consumiu; `movimento_estoque_id` continua sendo o
-- movimento que gerou a etiqueta. A regra é do domínio (proximaSituacaoEtiqueta); o banco só guarda.
ALTER TABLE etiqueta_identificacao
  ADD COLUMN IF NOT EXISTS movimento_consumo_id BIGINT UNSIGNED NULL
    COMMENT 'Movimento de saída ou dispensação que consumiu a etiqueta' AFTER movimento_estoque_id,
  ADD KEY IF NOT EXISTS ix_etiqueta_identificacao_movimento_consumo (movimento_consumo_id);
