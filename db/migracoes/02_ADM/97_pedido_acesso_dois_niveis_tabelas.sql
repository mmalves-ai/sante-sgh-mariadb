-- Pedido de acesso no banco próprio (01-ADM L57, 2ª volta da F3): a aprovação em dois níveis por pessoas diferentes
-- (o 1º nível confere o uso no setor; o 2º, a concessão), o setor de internação onde o acesso será usado, quem fechou
-- (recusa ou cancelamento) com o motivo e a concessão de perfil que o pedido gerou. Cada decisão fica na própria linha
-- (quem e quando), nada se apaga. Só para frente e idempotente (ADR 0002, parte 2).

ALTER TABLE pedido_acesso
  ADD COLUMN IF NOT EXISTS bloco_internacao_id BIGINT UNSIGNED NULL COMMENT 'Setor de internação onde o acesso será usado' AFTER setor_funcional_id,
  ADD COLUMN IF NOT EXISTS aprovado_setor_por_usuario_id BIGINT UNSIGNED NULL COMMENT 'Quem aprovou o 1º nível (uso no setor)',
  ADD COLUMN IF NOT EXISTS aprovado_setor_em DATETIME(3) NULL,
  ADD COLUMN IF NOT EXISTS aprovado_acessos_por_usuario_id BIGINT UNSIGNED NULL COMMENT 'Quem aprovou o 2º nível (concessão)',
  ADD COLUMN IF NOT EXISTS aprovado_acessos_em DATETIME(3) NULL,
  ADD COLUMN IF NOT EXISTS fechado_por_usuario_id BIGINT UNSIGNED NULL COMMENT 'Quem recusou ou cancelou',
  ADD COLUMN IF NOT EXISTS fechado_em DATETIME(3) NULL,
  ADD COLUMN IF NOT EXISTS motivo_fechamento VARCHAR(500) NULL,
  ADD COLUMN IF NOT EXISTS usuario_perfil_id BIGINT UNSIGNED NULL COMMENT 'Concessão de perfil gerada pelo pedido',
  ADD KEY IF NOT EXISTS ix_pedido_acesso_bloco (bloco_internacao_id),
  ADD KEY IF NOT EXISTS ix_pedido_acesso_aprovado_setor_por (aprovado_setor_por_usuario_id),
  ADD KEY IF NOT EXISTS ix_pedido_acesso_aprovado_acessos_por (aprovado_acessos_por_usuario_id),
  ADD KEY IF NOT EXISTS ix_pedido_acesso_fechado_por (fechado_por_usuario_id),
  ADD KEY IF NOT EXISTS ix_pedido_acesso_usuario_perfil (usuario_perfil_id);

ALTER TABLE pedido_acesso
  DROP CONSTRAINT IF EXISTS ck_pedido_acesso_dois_niveis,
  DROP CONSTRAINT IF EXISTS ck_pedido_acesso_fechamento,
  DROP CONSTRAINT IF EXISTS ck_pedido_acesso_concessao;
ALTER TABLE pedido_acesso
  ADD CONSTRAINT ck_pedido_acesso_dois_niveis CHECK (aprovado_acessos_por_usuario_id IS NULL
    OR (aprovado_setor_por_usuario_id IS NOT NULL AND aprovado_setor_por_usuario_id <> aprovado_acessos_por_usuario_id)),
  ADD CONSTRAINT ck_pedido_acesso_fechamento CHECK (situacao NOT IN ('reprovado','cancelado')
    OR (fechado_por_usuario_id IS NOT NULL AND fechado_em IS NOT NULL AND motivo_fechamento IS NOT NULL)),
  ADD CONSTRAINT ck_pedido_acesso_concessao CHECK (situacao <> 'executado' OR usuario_perfil_id IS NOT NULL);
