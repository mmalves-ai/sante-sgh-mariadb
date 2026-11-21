-- F2.4 (dívida da migração), 2ª volta: DDL pedido pelos lotes, só para frente (ADR 0002).
-- Origem e decisões: docs/obra/fatias/f24/saida/ddl-aplicado-v2.md

ALTER TABLE registro_assistencial_extensao ADD CONSTRAINT fk_registro_assistencial_extensao_registro_assistencial_id FOREIGN KEY IF NOT EXISTS (registro_assistencial_id) REFERENCES registro_assistencial (id) ON DELETE RESTRICT;
ALTER TABLE acionamento_resposta_rapida_evento ADD CONSTRAINT fk_acionamento_resposta_rapida_evento_acionamento FOREIGN KEY IF NOT EXISTS (acionamento_resposta_rapida_id) REFERENCES acionamento_resposta_rapida (id) ON DELETE RESTRICT;
ALTER TABLE acionamento_resposta_rapida_evento ADD CONSTRAINT fk_acionamento_resposta_rapida_evento_anterior_evento_id FOREIGN KEY IF NOT EXISTS (anterior_evento_id) REFERENCES acionamento_resposta_rapida_evento (id) ON DELETE RESTRICT;
ALTER TABLE notificacao_agravo ADD CONSTRAINT fk_notificacao_agravo_exame_id FOREIGN KEY IF NOT EXISTS (exame_id) REFERENCES exame (id) ON DELETE RESTRICT;
ALTER TABLE notificacao_agravo ADD CONSTRAINT fk_notificacao_agravo_encerrado_por_usuario_id FOREIGN KEY IF NOT EXISTS (encerrado_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE gatilho_exame_agravo ADD CONSTRAINT fk_gatilho_exame_agravo_estabelecimento_id FOREIGN KEY IF NOT EXISTS (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT;
