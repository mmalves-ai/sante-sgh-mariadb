-- Tipo da ligação tarifada gravado no registro (06-FAT linha 23, F8, 24/11/2026): só para frente e idempotente.

ALTER TABLE ligacao_tarifada
  ADD CONSTRAINT fk_ligacao_tarifada_tipo_ligacao_tarifada_id FOREIGN KEY IF NOT EXISTS (tipo_ligacao_tarifada_id) REFERENCES tipo_ligacao_tarifada (id) ON DELETE RESTRICT;
