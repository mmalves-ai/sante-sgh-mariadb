-- F2.4 (dívida da migração): DDL pendente dos pedidos da F2.2, só para frente (ADR 0002).
-- Origem e decisões: docs/obra/fatias/f24/saida/ddl-aplicado.md

ALTER TABLE aviso_valor_critico_tentativa
  ADD COLUMN IF NOT EXISTS conta_portal_profissional_externo_id BIGINT UNSIGNED NULL COMMENT 'Conta do portal do médico externo notificada',
  ADD COLUMN IF NOT EXISTS envio VARCHAR(20) NULL COMMENT 'Como a notificação saiu: simulador, plataforma ou desligado',
  DROP CONSTRAINT IF EXISTS ck_aviso_valor_critico_tentativa_envio,
  ADD CONSTRAINT ck_aviso_valor_critico_tentativa_envio CHECK (envio IS NULL OR envio IN ('simulador','plataforma','desligado')),
  ADD UNIQUE KEY IF NOT EXISTS uq_aviso_valor_critico_tentativa_conta_portal (aviso_valor_critico_id, conta_portal_profissional_externo_id),
  ADD KEY IF NOT EXISTS ix_aviso_valor_critico_tentativa_conta_portal (conta_portal_profissional_externo_id);

