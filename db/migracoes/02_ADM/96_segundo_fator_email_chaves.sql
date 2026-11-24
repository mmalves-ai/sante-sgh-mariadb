-- Chaves da 96_segundo_fator_email (só para frente e idempotente).
ALTER TABLE preferencia_segundo_fator ADD CONSTRAINT fk_preferencia_segundo_fator_usuario_id FOREIGN KEY IF NOT EXISTS (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
