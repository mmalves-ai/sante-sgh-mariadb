-- SADT, retificação dos laudos estruturados de mamografia e de anatomia patológica (F7, 05-SADT linha 18, função
-- C2-071; 25/11/2026). Só para frente e idempotente (ADR 0002, parte 2). Sem gatilho: a regra fica no domínio
-- (@sgh/dominio-sadt, mama-patologia/laudos.ts: conferirRetificacao) e na porta própria.
-- O laudo liberado não muda: a retificação o marca 'retificado' (com motivo, quando e quem) e abre um laudo novo do
-- mesmo exame pedido, ligado a ele. Um só laudo vigente por exame (o retificado e o cancelado saem da unicidade).

ALTER TABLE laudo_mama
  ADD COLUMN IF NOT EXISTS laudo_retificado_id BIGINT UNSIGNED NULL
    COMMENT 'Laudo liberado que este laudo retifica' AFTER laudo_diagnostico_id,
  ADD COLUMN IF NOT EXISTS motivo_retificacao VARCHAR(500) NULL COMMENT 'Motivo da retificação deste laudo',
  ADD COLUMN IF NOT EXISTS retificado_em DATETIME(3) NULL,
  ADD COLUMN IF NOT EXISTS retificado_por_usuario_id BIGINT UNSIGNED NULL,
  ADD COLUMN IF NOT EXISTS exame_item_vigente BIGINT UNSIGNED
    AS (IF(situacao IN ('retificado','cancelado') OR excluido_em IS NOT NULL, NULL, exame_item_id)) PERSISTENT
    COMMENT 'Só para a unicidade: um laudo vigente por exame pedido',
  ADD KEY IF NOT EXISTS ix_laudo_mama_exame_item (exame_item_id),
  ADD UNIQUE KEY IF NOT EXISTS uq_laudo_mama_exame_item_vigente (exame_item_vigente),
  ADD KEY IF NOT EXISTS ix_laudo_mama_laudo_retificado (laudo_retificado_id),
  ADD KEY IF NOT EXISTS ix_laudo_mama_retificado_por_usuario (retificado_por_usuario_id),
  ADD CONSTRAINT IF NOT EXISTS ck_laudo_mama_retificacao
    CHECK (situacao <> 'retificado' OR (retificado_em IS NOT NULL AND motivo_retificacao IS NOT NULL));
ALTER TABLE laudo_mama DROP INDEX IF EXISTS uq_laudo_mama_exame_item;

ALTER TABLE laudo_anatomopatologico
  ADD COLUMN IF NOT EXISTS laudo_retificado_id BIGINT UNSIGNED NULL
    COMMENT 'Laudo liberado que este laudo retifica' AFTER descricao_cirurgica_id,
  ADD COLUMN IF NOT EXISTS motivo_retificacao VARCHAR(500) NULL COMMENT 'Motivo da retificação deste laudo',
  ADD COLUMN IF NOT EXISTS retificado_em DATETIME(3) NULL,
  ADD COLUMN IF NOT EXISTS retificado_por_usuario_id BIGINT UNSIGNED NULL,
  ADD COLUMN IF NOT EXISTS exame_item_vigente BIGINT UNSIGNED
    AS (IF(situacao IN ('retificado','cancelado') OR excluido_em IS NOT NULL, NULL, exame_item_id)) PERSISTENT
    COMMENT 'Só para a unicidade: um laudo vigente por exame pedido',
  ADD KEY IF NOT EXISTS ix_laudo_anatomopatologico_exame_item (exame_item_id),
  ADD UNIQUE KEY IF NOT EXISTS uq_laudo_anatomopatologico_exame_item_vigente (exame_item_vigente),
  ADD KEY IF NOT EXISTS ix_laudo_anatomopatologico_laudo_retificado (laudo_retificado_id),
  ADD KEY IF NOT EXISTS ix_laudo_anatomopatologico_retificado_por_usuario (retificado_por_usuario_id),
  ADD CONSTRAINT IF NOT EXISTS ck_laudo_anatomopatologico_retificacao
    CHECK (situacao <> 'retificado' OR (retificado_em IS NOT NULL AND motivo_retificacao IS NOT NULL));
ALTER TABLE laudo_anatomopatologico DROP INDEX IF EXISTS uq_laudo_anatomopatologico_exame_item;
