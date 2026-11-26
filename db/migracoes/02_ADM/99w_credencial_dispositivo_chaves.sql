-- Chaves da 99w_credencial_dispositivo (só para frente e idempotente).
ALTER TABLE credencial_dispositivo ADD CONSTRAINT fk_credencial_dispositivo_usuario_id FOREIGN KEY IF NOT EXISTS (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE credencial_dispositivo ADD CONSTRAINT fk_credencial_dispositivo_revogada_por FOREIGN KEY IF NOT EXISTS (revogada_por) REFERENCES usuario (id) ON DELETE RESTRICT;
