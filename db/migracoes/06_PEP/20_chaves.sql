-- F2.4 (dívida da migração): DDL pendente dos pedidos da F2.2, só para frente (ADR 0002).
-- Origem e decisões: docs/obra/fatias/f24/saida/ddl-aplicado.md

ALTER TABLE ciclo_quimioterapia ADD CONSTRAINT fk_ciclo_quimioterapia_validado_por_usuario_id FOREIGN KEY IF NOT EXISTS (validado_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE exame_oftalmologico ADD CONSTRAINT fk_exame_oftalmologico_internacao_id FOREIGN KEY IF NOT EXISTS (internacao_id) REFERENCES internacao (id) ON DELETE RESTRICT;
ALTER TABLE receita_medica ADD CONSTRAINT fk_receita_medica_protocolo_receita_enfermagem_id FOREIGN KEY IF NOT EXISTS (protocolo_receita_enfermagem_id) REFERENCES protocolo_receita_enfermagem (id) ON DELETE RESTRICT;

ALTER TABLE ciclo_quimioterapia_prescricao ADD CONSTRAINT fk_ciclo_quimioterapia_prescricao_ciclo_quimioterapia_id FOREIGN KEY IF NOT EXISTS (ciclo_quimioterapia_id) REFERENCES ciclo_quimioterapia (id) ON DELETE RESTRICT;
ALTER TABLE ciclo_quimioterapia_prescricao ADD CONSTRAINT fk_ciclo_quimioterapia_prescricao_prescricao_id FOREIGN KEY IF NOT EXISTS (prescricao_id) REFERENCES prescricao (id) ON DELETE RESTRICT;

ALTER TABLE evento_tratamento_oncologico ADD CONSTRAINT fk_evento_tratamento_oncologico_estabelecimento_id FOREIGN KEY IF NOT EXISTS (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT;
ALTER TABLE evento_tratamento_oncologico ADD CONSTRAINT fk_evento_tratamento_oncologico_protocolo_quimioterapia_id FOREIGN KEY IF NOT EXISTS (protocolo_quimioterapia_id) REFERENCES protocolo_quimioterapia (id) ON DELETE RESTRICT;
ALTER TABLE evento_tratamento_oncologico ADD CONSTRAINT fk_evento_tratamento_oncologico_ciclo_quimioterapia_id FOREIGN KEY IF NOT EXISTS (ciclo_quimioterapia_id) REFERENCES ciclo_quimioterapia (id) ON DELETE RESTRICT;
ALTER TABLE evento_tratamento_oncologico ADD CONSTRAINT fk_evento_tratamento_oncologico_prescricao_id FOREIGN KEY IF NOT EXISTS (prescricao_id) REFERENCES prescricao (id) ON DELETE RESTRICT;
ALTER TABLE evento_tratamento_oncologico ADD CONSTRAINT fk_evento_tratamento_oncologico_usuario_id FOREIGN KEY IF NOT EXISTS (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;

ALTER TABLE profilaxia_tev_decisao ADD CONSTRAINT fk_profilaxia_tev_decisao_profilaxia_tev_avaliacao_id FOREIGN KEY IF NOT EXISTS (profilaxia_tev_avaliacao_id) REFERENCES profilaxia_tev_avaliacao (id) ON DELETE RESTRICT;
ALTER TABLE profilaxia_tev_decisao ADD CONSTRAINT fk_profilaxia_tev_decisao_prescricao_item_id FOREIGN KEY IF NOT EXISTS (prescricao_item_id) REFERENCES prescricao_item (id) ON DELETE RESTRICT;
ALTER TABLE profilaxia_tev_decisao ADD CONSTRAINT fk_profilaxia_tev_decisao_usuario_id FOREIGN KEY IF NOT EXISTS (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;

ALTER TABLE contencao_paciente_avaliacao_adendo ADD CONSTRAINT fk_contencao_paciente_avaliacao_adendo_contencao_pacien_d8d0546b FOREIGN KEY IF NOT EXISTS (contencao_paciente_avaliacao_id) REFERENCES contencao_paciente_avaliacao (id) ON DELETE RESTRICT;
ALTER TABLE contencao_paciente_avaliacao_adendo ADD CONSTRAINT fk_contencao_paciente_avaliacao_adendo_usuario_id FOREIGN KEY IF NOT EXISTS (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;

ALTER TABLE protocolo_receita_enfermagem ADD CONSTRAINT fk_protocolo_receita_enfermagem_estabelecimento_id FOREIGN KEY IF NOT EXISTS (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT;

ALTER TABLE protocolo_receita_enfermagem_item ADD CONSTRAINT fk_protocolo_receita_enfermagem_item_protocolo_receita__1922fea6 FOREIGN KEY IF NOT EXISTS (protocolo_receita_enfermagem_id) REFERENCES protocolo_receita_enfermagem (id) ON DELETE RESTRICT;
ALTER TABLE protocolo_receita_enfermagem_item ADD CONSTRAINT fk_protocolo_receita_enfermagem_item_item_prescritivel_id FOREIGN KEY IF NOT EXISTS (item_prescritivel_id) REFERENCES item_prescritivel (id) ON DELETE RESTRICT;

