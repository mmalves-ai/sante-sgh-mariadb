-- SADT, recoleta (F3.5, 05-SADT linha 7; 25/11/2026): a chave de quem cancelou a recoleta. Idempotente.
ALTER TABLE nova_coleta DROP FOREIGN KEY IF EXISTS fk_nova_coleta_cancelada_por_usuario_id;
ALTER TABLE nova_coleta
  ADD CONSTRAINT fk_nova_coleta_cancelada_por_usuario_id FOREIGN KEY (cancelada_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
