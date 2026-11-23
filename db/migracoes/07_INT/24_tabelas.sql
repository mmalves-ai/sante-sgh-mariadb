-- NIR (núcleo interno de regulação de leitos): "excluir" a solicitação e a reserva de leito vira cancelamento com
-- motivo, quem e quando (decisão do dono, 23/11/2026; SBIS-26: o registro clínico nunca é apagado). Só para frente
-- e idempotente (ADR 0002, parte 2). Origem: docs/obra/orcamentos/nir-cancelamento.md.

-- Solicitação de leito: quem cancelou ou rejeitou (o quando e o motivo já existiam). Pelo sistema, o cancelamento
-- leva os três juntos; o que veio da migração ou da integração pode não trazer quem (a origem não o tinha).
ALTER TABLE pedido_leito
  ADD COLUMN IF NOT EXISTS cancelado_por_usuario_id BIGINT UNSIGNED NULL COMMENT 'Usuário que cancelou ou rejeitou a solicitação' AFTER motivo_cancelamento,
  ADD KEY IF NOT EXISTS ix_pedido_leito_cancelado_por_usuario_id (cancelado_por_usuario_id),
  DROP CONSTRAINT IF EXISTS ck_pedido_leito_cancelado_por,
  ADD CONSTRAINT ck_pedido_leito_cancelado_por CHECK (cancelado_por_usuario_id IS NULL OR (data_hora_cancelamento IS NOT NULL AND motivo_cancelamento IS NOT NULL)),
  DROP CONSTRAINT IF EXISTS ck_pedido_leito_cancelamento,
  ADD CONSTRAINT ck_pedido_leito_cancelamento CHECK (origem <> 'sistema' OR (data_hora_cancelamento IS NULL AND motivo_cancelamento IS NULL AND cancelado_por_usuario_id IS NULL) OR (data_hora_cancelamento IS NOT NULL AND motivo_cancelamento IS NOT NULL AND cancelado_por_usuario_id IS NOT NULL));

-- Reserva de leito: o motivo do encerramento cabe os 500 caracteres do cancelamento; a cancelada pelo sistema leva
-- motivo, quem e quando (a expirada continua sem usuário: quem a encerra é o vencimento).
ALTER TABLE reserva_leito
  MODIFY COLUMN motivo_encerramento VARCHAR(500) NULL,
  DROP CONSTRAINT IF EXISTS ck_reserva_leito_cancelada,
  ADD CONSTRAINT ck_reserva_leito_cancelada CHECK (situacao <> 'cancelada' OR origem <> 'sistema' OR (encerrada_em IS NOT NULL AND motivo_encerramento IS NOT NULL AND encerrada_por_usuario_id IS NOT NULL));
