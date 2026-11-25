-- SADT, recoleta (F3.5, 05-SADT linha 7; 25/11/2026). Só para frente e idempotente (ADR 0002, parte 2); nenhuma
-- tabela nova. Quem cancelou a recoleta passa a ficar na própria recoleta (antes só no evento de cada exame e na
-- trilha): a lista de recoletas canceladas responde "quem cancelou" sem depender de haver exame à espera.
ALTER TABLE nova_coleta
  ADD COLUMN IF NOT EXISTS cancelada_por_usuario_id BIGINT UNSIGNED NULL
    COMMENT 'Usuário que cancelou a recoleta' AFTER cancelada_em;
ALTER TABLE nova_coleta
  ADD INDEX IF NOT EXISTS ix_nova_coleta_cancelada_por_usuario (cancelada_por_usuario_id);
-- As recoletas já canceladas: o cancelamento é o último ato sobre a linha, logo quem a alterou por último cancelou.
UPDATE nova_coleta
   SET cancelada_por_usuario_id = alterado_por
 WHERE situacao = 'cancelada' AND cancelada_por_usuario_id IS NULL AND alterado_por IS NOT NULL;
