-- F2.4 (dívida da migração): DDL pendente dos pedidos da F2.2, só para frente (ADR 0002).
-- Origem e decisões: docs/obra/fatias/f24/saida/ddl-aplicado.md

ALTER TABLE resposta_pesquisa_satisfacao ADD CONSTRAINT fk_resposta_pesquisa_satisfacao_marcacao_horario_id FOREIGN KEY IF NOT EXISTS (marcacao_horario_id) REFERENCES marcacao_horario (id) ON DELETE RESTRICT;
ALTER TABLE resposta_pesquisa_satisfacao ADD CONSTRAINT fk_resposta_pesquisa_satisfacao_conta_portal_paciente_id FOREIGN KEY IF NOT EXISTS (conta_portal_paciente_id) REFERENCES conta_portal_paciente (id) ON DELETE RESTRICT;

