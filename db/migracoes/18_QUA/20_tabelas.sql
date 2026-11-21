-- F2.4 (dívida da migração): DDL pendente dos pedidos da F2.2, só para frente (ADR 0002).
-- Origem e decisões: docs/obra/fatias/f24/saida/ddl-aplicado.md

ALTER TABLE resposta_pesquisa_satisfacao
  ADD COLUMN IF NOT EXISTS marcacao_horario_id BIGINT UNSIGNED NULL COMMENT 'Marcação avaliada (uma resposta por marcação)',
  ADD COLUMN IF NOT EXISTS conta_portal_paciente_id BIGINT UNSIGNED NULL,
  ADD UNIQUE KEY IF NOT EXISTS uq_resposta_pesquisa_satisfacao_marcacao (marcacao_horario_id),
  ADD KEY IF NOT EXISTS ix_resposta_pesquisa_satisfacao_conta_portal (conta_portal_paciente_id);

