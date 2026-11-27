-- Chaves da 99zd_usuario_grupo_sigtap (só para frente e idempotente).
ALTER TABLE usuario_grupo_sigtap ADD CONSTRAINT fk_usuario_grupo_sigtap_usuario_id FOREIGN KEY IF NOT EXISTS (usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE usuario_grupo_sigtap ADD CONSTRAINT fk_usuario_grupo_sigtap_grupo_sigtap_id FOREIGN KEY IF NOT EXISTS (grupo_sigtap_id) REFERENCES grupo_sigtap (id) ON DELETE RESTRICT;
