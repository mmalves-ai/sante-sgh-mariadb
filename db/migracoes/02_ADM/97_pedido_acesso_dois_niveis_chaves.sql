-- Chaves da 97_pedido_acesso_dois_niveis (só para frente e idempotente).
ALTER TABLE pedido_acesso ADD CONSTRAINT fk_pedido_acesso_bloco_internacao_id FOREIGN KEY IF NOT EXISTS (bloco_internacao_id) REFERENCES bloco_internacao (id) ON DELETE RESTRICT;
ALTER TABLE pedido_acesso ADD CONSTRAINT fk_pedido_acesso_aprovado_setor_por_usuario_id FOREIGN KEY IF NOT EXISTS (aprovado_setor_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE pedido_acesso ADD CONSTRAINT fk_pedido_acesso_aprovado_acessos_por_usuario_id FOREIGN KEY IF NOT EXISTS (aprovado_acessos_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE pedido_acesso ADD CONSTRAINT fk_pedido_acesso_fechado_por_usuario_id FOREIGN KEY IF NOT EXISTS (fechado_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
ALTER TABLE pedido_acesso ADD CONSTRAINT fk_pedido_acesso_usuario_perfil_id FOREIGN KEY IF NOT EXISTS (usuario_perfil_id) REFERENCES usuario_perfil (id) ON DELETE RESTRICT;
