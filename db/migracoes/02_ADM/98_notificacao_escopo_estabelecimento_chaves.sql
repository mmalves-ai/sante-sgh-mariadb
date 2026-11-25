-- Chaves da 98_notificacao_escopo_estabelecimento (só para frente e idempotente).
ALTER TABLE regra_alerta_estabelecimento ADD CONSTRAINT fk_regra_alerta_estabelecimento_regra_alerta_id FOREIGN KEY IF NOT EXISTS (regra_alerta_id) REFERENCES regra_alerta (id) ON DELETE RESTRICT;
ALTER TABLE regra_alerta_estabelecimento ADD CONSTRAINT fk_regra_alerta_estabelecimento_estabelecimento_id FOREIGN KEY IF NOT EXISTS (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT;
ALTER TABLE regra_alerta_destinatario ADD CONSTRAINT fk_regra_alerta_destinatario_estabelecimento_id FOREIGN KEY IF NOT EXISTS (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT;
ALTER TABLE envio_notificacao_aviso ADD CONSTRAINT fk_envio_notificacao_aviso_envio_notificacao_id FOREIGN KEY IF NOT EXISTS (envio_notificacao_id) REFERENCES envio_notificacao (id) ON DELETE RESTRICT;
ALTER TABLE envio_notificacao_aviso ADD CONSTRAINT fk_envio_notificacao_aviso_notificacao_usuario_id FOREIGN KEY IF NOT EXISTS (notificacao_usuario_id) REFERENCES notificacao_usuario (id) ON DELETE RESTRICT;
ALTER TABLE envio_notificacao_aviso ADD CONSTRAINT fk_envio_notificacao_aviso_canal_notificacao_id FOREIGN KEY IF NOT EXISTS (canal_notificacao_id) REFERENCES canal_notificacao (id) ON DELETE RESTRICT;
