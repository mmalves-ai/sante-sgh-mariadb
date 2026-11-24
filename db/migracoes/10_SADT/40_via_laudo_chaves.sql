-- SADT, vias do laudo (F3.5, correção da revisão, 24/11/2026): a via seguinte aponta a emissão original. Idempotente.
ALTER TABLE emissao_laudo
  DROP FOREIGN KEY IF EXISTS fk_emissao_laudo_emissao_original_id;
ALTER TABLE emissao_laudo
  ADD CONSTRAINT fk_emissao_laudo_emissao_original_id FOREIGN KEY (emissao_original_id) REFERENCES emissao_laudo (id) ON DELETE RESTRICT;
