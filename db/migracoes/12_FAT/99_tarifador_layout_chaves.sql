-- Layout do arquivo do tarifador telefônico (06-FAT linha 23, F8, 25/11/2026): só para frente e idempotente.

ALTER TABLE layout_tarifador
  ADD CONSTRAINT fk_layout_tarifador_estabelecimento_id FOREIGN KEY IF NOT EXISTS (estabelecimento_id) REFERENCES estabelecimento (id) ON DELETE RESTRICT;
