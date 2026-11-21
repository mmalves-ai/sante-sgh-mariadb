-- F2.4 (dívida da migração), 3ª etapa, 4ª leva: DDL pedido pelos lotes das portas (p-*), só para frente (ADR 0002).
-- Origem e decisões: docs/obra/fatias/f24/saida/ddl-aplicado-v4.md

ALTER TABLE protocolo_acesso_portal ADD CONSTRAINT fk_protocolo_acesso_portal_estabelecimento FOREIGN KEY IF NOT EXISTS (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT;
ALTER TABLE protocolo_acesso_portal ADD CONSTRAINT fk_protocolo_acesso_portal_paciente FOREIGN KEY IF NOT EXISTS (paciente_id) REFERENCES paciente (id) ON DELETE RESTRICT;
ALTER TABLE protocolo_acesso_portal ADD CONSTRAINT fk_protocolo_acesso_portal_atendimento FOREIGN KEY IF NOT EXISTS (atendimento_id) REFERENCES atendimento (id) ON DELETE RESTRICT;
ALTER TABLE protocolo_acesso_portal ADD CONSTRAINT fk_protocolo_acesso_portal_emitido_por FOREIGN KEY IF NOT EXISTS (emitido_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
