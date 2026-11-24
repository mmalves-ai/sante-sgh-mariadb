-- Glosa e recurso por item (06-FAT linha 34, F3.7, 24/11/2026): só para frente e idempotente (ADR 0002, parte 2).
-- As chaves estrangeiras do motivo do retorno e de quem o registrou.

ALTER TABLE recurso_glosa_item
  ADD CONSTRAINT fk_recurso_glosa_item_motivo_retorno_glosa_id FOREIGN KEY IF NOT EXISTS (motivo_retorno_glosa_id) REFERENCES motivo_glosa (id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_recurso_glosa_item_retornado_por_usuario_id FOREIGN KEY IF NOT EXISTS (retornado_por_usuario_id) REFERENCES usuario (id) ON DELETE RESTRICT;
